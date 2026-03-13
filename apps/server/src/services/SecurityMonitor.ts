import { EventEmitter } from 'events';

interface SecurityEvent {
  type: 'login_failure_burst' | 'suspicious_api_pattern' | 'sandbox_anomaly' | 'auth_bypass_attempt';
  severity: 'warning' | 'critical';
  message: string;
  details: Record<string, any>;
  timestamp: Date;
}

/**
 * 安全事件监控服务
 * 检测可疑行为模式并发送告警
 */
export class SecurityMonitor extends EventEmitter {
  private loginFailures = new Map<string, { count: number; firstAt: number }>();
  private apiCallCounts = new Map<string, { count: number; windowStart: number }>();

  // 阈值配置
  private readonly LOGIN_BURST_THRESHOLD = 10; // 10 次失败
  private readonly LOGIN_BURST_WINDOW = 60 * 1000; // 1 分钟内
  private readonly API_RATE_THRESHOLD = 200; // 200 次调用
  private readonly API_RATE_WINDOW = 60 * 1000; // 1 分钟内
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 分钟清理

  private cleanupTimer: NodeJS.Timeout | null = null;
  private alertCooldowns = new Map<string, number>(); // 防止告警风暴
  private readonly ALERT_COOLDOWN = 5 * 60 * 1000; // 同类告警 5 分钟冷却

  constructor() {
    super();
    this.cleanupTimer = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  /**
   * 记录登录失败事件
   */
  recordLoginFailure(ip: string, username: string): void {
    const key = `${ip}:${username}`;
    const now = Date.now();
    const entry = this.loginFailures.get(key);

    if (!entry || now - entry.firstAt > this.LOGIN_BURST_WINDOW) {
      this.loginFailures.set(key, { count: 1, firstAt: now });
      return;
    }

    entry.count++;
    if (entry.count >= this.LOGIN_BURST_THRESHOLD) {
      this.raiseAlert({
        type: 'login_failure_burst',
        severity: 'warning',
        message: `检测到暴力破解尝试：IP ${ip} 在 1 分钟内对用户 "${username}" 登录失败 ${entry.count} 次`,
        details: { ip, username, count: entry.count },
        timestamp: new Date(),
      });
      this.loginFailures.delete(key); // 重置计数
    }
  }

  /**
   * 记录 API 调用（检测异常频率）
   */
  recordApiCall(ip: string, path: string): void {
    const key = `${ip}:${path}`;
    const now = Date.now();
    const entry = this.apiCallCounts.get(key);

    if (!entry || now - entry.windowStart > this.API_RATE_WINDOW) {
      this.apiCallCounts.set(key, { count: 1, windowStart: now });
      return;
    }

    entry.count++;
    if (entry.count >= this.API_RATE_THRESHOLD) {
      this.raiseAlert({
        type: 'suspicious_api_pattern',
        severity: 'warning',
        message: `异常 API 调用频率：IP ${ip} 在 1 分钟内调用 ${path} ${entry.count} 次`,
        details: { ip, path, count: entry.count },
        timestamp: new Date(),
      });
      this.apiCallCounts.delete(key);
    }
  }

  /**
   * 记录认证绕过尝试（如使用过期/伪造 token）
   */
  recordAuthBypassAttempt(ip: string, reason: string): void {
    this.raiseAlert({
      type: 'auth_bypass_attempt',
      severity: 'critical',
      message: `认证绕过尝试：IP ${ip}，原因: ${reason}`,
      details: { ip, reason },
      timestamp: new Date(),
    });
  }

  /**
   * 发送安全告警
   */
  private raiseAlert(event: SecurityEvent): void {
    // 冷却检查
    const cooldownKey = `${event.type}:${JSON.stringify(event.details)}`;
    const lastAlert = this.alertCooldowns.get(cooldownKey);
    if (lastAlert && Date.now() - lastAlert < this.ALERT_COOLDOWN) {
      return; // 冷却期内，跳过
    }
    this.alertCooldowns.set(cooldownKey, Date.now());

    // 记录到日志
    const prefix = event.severity === 'critical' ? 'CRITICAL' : 'WARNING';
    console.warn(`[SecurityMonitor] ${prefix}: ${event.message}`);

    // 发出事件（可被外部监听）
    this.emit('alert', event);

    // 尝试通过内部 IM API 发送通知（fire-and-forget）
    this.sendImAlert(event).catch(() => {});
  }

  /**
   * 通过内部 IM API 发送告警到管理员
   */
  private async sendImAlert(event: SecurityEvent): Promise<void> {
    const token = process.env['INTERNAL_API_TOKEN'];
    const port = process.env['PORT'] || '18790';
    if (!token) return; // 无 token 时跳过 IM 通知

    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/_internal/im/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': token,
        },
        body: JSON.stringify({
          userId: 'admin', // 发送给管理员
          message: `[安全告警] ${event.message}`,
        }),
      });
      if (!resp.ok) {
        console.warn(`[SecurityMonitor] IM 告警发送失败: ${resp.status}`);
      }
    } catch {
      // 静默失败，不阻塞主流程
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, val] of this.loginFailures) {
      if (now - val.firstAt > this.LOGIN_BURST_WINDOW * 2) this.loginFailures.delete(key);
    }
    for (const [key, val] of this.apiCallCounts) {
      if (now - val.windowStart > this.API_RATE_WINDOW * 2) this.apiCallCounts.delete(key);
    }
    for (const [key, val] of this.alertCooldowns) {
      if (now - val > this.ALERT_COOLDOWN * 2) this.alertCooldowns.delete(key);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// 单例
export const securityMonitor = new SecurityMonitor();
