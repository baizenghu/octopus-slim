/**
 * SkillScanner — 静态代码安全扫描器
 *
 * 对 Skill 代码进行安全分析，检查：
 * - 危险系统调用（rm -rf, 修改系统文件等）
 * - 网络外连（fetch, http 请求等）
 * - 环境变量访问（窃取密钥）
 * - 文件系统越权（路径穿越、访问 /etc 等）
 * - 恶意代码模式（反弹 shell、挖矿等）
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { ScanReport, ScanFinding, ScanSeverity } from './types';

// ========== 扫描规则 ==========

interface ScanRule {
  id: string;
  severity: ScanSeverity;
  description: string;
  /** 匹配的文件扩展名 */
  extensions: string[];
  /** 正则匹配模式 */
  pattern: RegExp;
}

/** 内置安全扫描规则 */
const SCAN_RULES: ScanRule[] = [
  // === 危险系统调用 ===
  {
    id: 'SYS001',
    severity: 'critical',
    description: '检测到危险的系统删除命令',
    extensions: ['.py', '.sh', '.js', '.ts', '.bash'],
    pattern: /\brm\s+(-[rf]+\s+|--force\s+|--recursive\s+)*(\/|~|\$HOME|\$\{HOME\})/gi,
  },
  {
    id: 'SYS002',
    severity: 'critical',
    description: '检测到修改系统文件操作',
    extensions: ['.py', '.sh', '.js', '.ts'],
    pattern: /(?:open|write|chmod|chown)\s*\(?\s*['"`]\/?(?:etc|usr|boot|sys|proc)\//gi,
  },
  {
    id: 'SYS003',
    severity: 'warning',
    description: '检测到执行系统命令',
    extensions: ['.py', '.js', '.ts'],
    pattern: /\b(?:os\.system|subprocess\.(?:call|run|Popen)|child_process\.(?:exec|spawn))\b/g,
  },

  // === 网络外连 ===
  {
    id: 'NET001',
    severity: 'warning',
    description: '检测到 HTTP 网络请求',
    extensions: ['.py', '.js', '.ts'],
    pattern: /\b(?:requests\.(?:get|post|put|delete)|urllib\.request|fetch|axios|http\.request)\b/g,
  },
  {
    id: 'NET002',
    severity: 'critical',
    description: '检测到 Socket 网络连接',
    extensions: ['.py', '.js', '.ts'],
    pattern: /\b(?:socket\.connect|net\.createConnection|dgram\.createSocket)\b/g,
  },
  {
    id: 'NET003',
    severity: 'critical',
    description: '检测到反弹 Shell 模式',
    extensions: ['.py', '.sh', '.js', '.ts'],
    pattern: /\b(?:reverse.?shell|bind.?shell|nc\s+-[el]|\/dev\/tcp\/|bash\s+-i\s+>&)/gi,
  },

  // === 环境变量 / 密钥 ===
  {
    id: 'ENV001',
    severity: 'warning',
    description: '检测到访问环境变量',
    extensions: ['.py', '.js', '.ts'],
    pattern: /\b(?:os\.environ|process\.env|getenv)\b/g,
  },
  {
    id: 'ENV002',
    severity: 'critical',
    description: '检测到访问敏感环境变量（API 密钥等）',
    extensions: ['.py', '.js', '.ts'],
    // 使用 \b 词边界，避免 max_tokens / token_count 等正常变量名误报
    pattern: /\b(?:API_KEY|SECRET_KEY|PASSWORD|PRIVATE_KEY|DATABASE_URL|AWS_SECRET_ACCESS_KEY)\b|(?:['"`])(?:SECRET|TOKEN|PASSWORD)(?:['"`])/gi,
  },

  // === 文件系统越权 ===
  {
    id: 'FS001',
    severity: 'critical',
    description: '检测到路径穿越模式',
    extensions: ['.py', '.sh', '.js', '.ts'],
    pattern: /(?:\.\.\/){2,}|(?:\.\.\\){2,}/g,
  },
  {
    id: 'FS002',
    severity: 'warning',
    description: '检测到访问用户主目录或根目录',
    extensions: ['.py', '.sh', '.js', '.ts'],
    pattern: /(?:expanduser|Path\.home|os\.path\.expanduser|\$HOME|~\/)/g,
  },

  // === 恶意行为 ===
  {
    id: 'MAL001',
    severity: 'critical',
    description: '检测到动态代码执行',
    extensions: ['.py', '.js', '.ts'],
    // 排除 re.compile()、regex.exec() 等正常用法（负向后行断言）
    pattern: /(?<!\w\.)(?:eval|exec)\s*\(|(?<!re\.)compile\s*\(|\b(?:__import__|importlib\.import_module)\s*\(/g,
  },
  {
    id: 'MAL002',
    severity: 'critical',
    description: '检测到加密货币挖矿相关代码',
    extensions: ['.py', '.js', '.ts'],
    pattern: /\b(?:cryptonight|stratum|mining|xmrig|coinhive)\b/gi,
  },
  {
    id: 'MAL003',
    severity: 'critical',
    description: '检测到 Base64 编码的疑似混淆代码',
    extensions: ['.py', '.js', '.ts'],
    pattern: /(?:base64\.b64decode|atob|Buffer\.from)\s*\(\s*['"`][A-Za-z0-9+/=]{100,}/g,
  },
];

// ========== 扫描器 ==========

export class SkillScanner {
  private rules: ScanRule[];

  constructor(customRules?: ScanRule[]) {
    this.rules = customRules || SCAN_RULES;
  }

  /**
   * 扫描整个 Skill 目录
   */
  async scan(skillId: string, skillDir: string): Promise<ScanReport> {
    const startTime = Date.now();
    const findings: ScanFinding[] = [];
    let totalFiles = 0;
    let totalLines = 0;

    // 递归获取所有文件
    const files = await this.collectFiles(skillDir);

    for (const filePath of files) {
      const ext = path.extname(filePath).toLowerCase();
      const relativePath = path.relative(skillDir, filePath);

      // 跳过二进制文件、压缩 JS 和无关文件
      if (this.isBinaryExtension(ext)) continue;
      if (filePath.endsWith('.min.js') || filePath.endsWith('.min.css')) continue;

      try {
        const content = await fsp.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        totalFiles++;
        totalLines += lines.length;

        // 对每一行应用匹配规则
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx];

          for (const rule of this.rules) {
            if (!rule.extensions.includes(ext)) continue;

            // 重置 lastIndex（全局正则需要重置）
            rule.pattern.lastIndex = 0;
            if (rule.pattern.test(line)) {
              findings.push({
                ruleId: rule.id,
                severity: rule.severity,
                message: rule.description,
                file: relativePath,
                line: lineIdx + 1,
                snippet: line.trim().substring(0, 200),
              });
            }
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    }

    const summary = {
      info: findings.filter(f => f.severity === 'info').length,
      warning: findings.filter(f => f.severity === 'warning').length,
      critical: findings.filter(f => f.severity === 'critical').length,
    };

    return {
      skillId,
      scannedAt: new Date(),
      passed: summary.critical === 0,
      duration: Date.now() - startTime,
      totalFiles,
      totalLines,
      findings,
      summary,
    };
  }

  /**
   * 递归收集目录下所有文件
   */
  private async collectFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    if (!fs.existsSync(dir)) return files;

    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // 跳过隐藏目录和 node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      if (entry.isDirectory()) {
        const subFiles = await this.collectFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 判断是否为二进制文件扩展名
   */
  private isBinaryExtension(ext: string): boolean {
    return [
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
      '.woff', '.woff2', '.ttf', '.eot',
      '.zip', '.tar', '.gz', '.rar',
      '.exe', '.dll', '.so', '.dylib',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    ].includes(ext);
  }
}
