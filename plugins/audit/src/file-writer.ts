import * as fs from 'fs';
import * as path from 'path';
import { createHmac } from 'crypto';
import { todayDateStr } from './utils';

// 审计日志 HMAC 签名密钥（生产环境必须通过环境变量设置）
const AUDIT_HMAC_KEY = process.env.AUDIT_HMAC_KEY || 'default-audit-key-change-me';

/**
 * JSONL 文件审计写入器
 *
 * 每天一个文件: native-audit-YYYY-MM-DD.jsonl
 * 追加写入，不阻塞主流程
 */
export class AuditFileWriter {
  private logDir: string;
  private currentDate: string = '';
  private stream: fs.WriteStream | null = null;
  /** HMAC 签名链：上一条记录的 hash，用于检测日志篡改和删除 */
  private prevHash: string = '0'.repeat(64); // 创世 hash

  constructor(logDir: string) {
    this.logDir = logDir;
    // 审计日志目录权限收紧：仅所有者可读写执行
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }

  /**
   * 清理超过 retentionDays 的 JSONL 审计文件
   * 文件名格式: native-audit-YYYY-MM-DD.jsonl，通过文件名中的日期判断
   * 返回清理的文件数量
   */
  cleanupExpired(retentionDays: number): number {
    if (retentionDays <= 0) return 0;
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffStr = cutoffDate.toISOString().slice(0, 10); // YYYY-MM-DD

      const files = fs.readdirSync(this.logDir);
      let cleaned = 0;
      for (const file of files) {
        // 匹配 native-audit-YYYY-MM-DD.jsonl 格式
        const match = file.match(/^native-audit-(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!match) continue;
        const fileDate = match[1];
        if (fileDate < cutoffStr) {
          fs.unlinkSync(path.join(this.logDir, file));
          cleaned++;
        }
      }
      return cleaned;
    } catch {
      return 0;
    }
  }

  /**
   * 追加一条审计记录到 JSONL 文件
   */
  write(record: Record<string, unknown>): void {
    try {
      const today = todayDateStr();

      // 日期切换时重建 stream
      if (today !== this.currentDate) {
        this.stream?.end();
        this.currentDate = today;
        const filepath = path.join(this.logDir, `native-audit-${today}.jsonl`);
        this.stream = fs.createWriteStream(filepath, { flags: 'a' });
      }

      const enriched = {
        ...record,
        _ts: new Date().toISOString(),
      };

      // HMAC-SHA256 签名链：每条记录包含前一条的 hash，可检测篡改和删除
      const hmac = createHmac('sha256', AUDIT_HMAC_KEY);
      hmac.update(this.prevHash);
      hmac.update(JSON.stringify(enriched));
      const hash = hmac.digest('hex');

      const signed = {
        ...enriched,
        _prevHash: this.prevHash,
        _hash: hash,
      };
      this.prevHash = hash;

      const line = JSON.stringify(signed);
      this.stream!.write(line + '\n');
    } catch (err) {
      console.error('[enterprise-audit] file write failed:', err);
    }
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}
