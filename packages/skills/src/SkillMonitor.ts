/**
 * SkillMonitor — 运行时行为监控
 *
 * 监控 Skill 执行过程中的资源使用情况，
 * 在超限时发出警告或终止执行。
 *
 * 目前基于 /proc 文件系统读取进程资源使用（Linux），
 * Docker 模式下通过 docker stats 获取。
 */

import type { ResourceMetrics, ResourceLimits } from './types';
import { DEFAULT_RESOURCE_LIMITS } from './types';

/** 监控回调 */
export interface MonitorCallbacks {
  /** 资源使用超过阈值时触发 */
  onThresholdExceeded?: (metrics: ResourceMetrics, limits: ResourceLimits) => void;
  /** 周期性指标上报 */
  onMetrics?: (metrics: ResourceMetrics) => void;
}

/** 监控会话 */
interface MonitorSession {
  pid: number;
  limits: ResourceLimits;
  callbacks: MonitorCallbacks;
  intervalId: ReturnType<typeof setInterval> | null;
  startTime: number;
}

export class SkillMonitor {
  private sessions: Map<string, MonitorSession> = new Map();
  /** 监控采样间隔(ms) */
  private sampleInterval: number;

  constructor(sampleInterval = 2000) {
    this.sampleInterval = sampleInterval;
  }

  /**
   * 开始监控一个进程
   *
   * @param executionId - 执行 ID（唯一标识）
   * @param pid - 进程 PID
   * @param limits - 资源限制
   * @param callbacks - 监控回调
   */
  startMonitoring(
    executionId: string,
    pid: number,
    limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
    callbacks: MonitorCallbacks = {},
  ): void {
    // 防止重复监控
    if (this.sessions.has(executionId)) {
      this.stopMonitoring(executionId);
    }

    const session: MonitorSession = {
      pid,
      limits,
      callbacks,
      intervalId: null,
      startTime: Date.now(),
    };

    // 定时采样
    session.intervalId = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics(pid);
        callbacks.onMetrics?.(metrics);

        // 检查是否超限
        if (this.isExceeded(metrics, limits)) {
          callbacks.onThresholdExceeded?.(metrics, limits);
        }
      } catch {
        // 进程可能已退出，停止监控
        this.stopMonitoring(executionId);
      }
    }, this.sampleInterval);

    this.sessions.set(executionId, session);
  }

  /**
   * 停止监控
   */
  stopMonitoring(executionId: string): void {
    const session = this.sessions.get(executionId);
    if (session?.intervalId) {
      clearInterval(session.intervalId);
    }
    this.sessions.delete(executionId);
  }

  /**
   * 停止所有监控
   */
  stopAll(): void {
    for (const [id] of this.sessions) {
      this.stopMonitoring(id);
    }
  }

  /**
   * 获取当前活跃监控数
   */
  getActiveCount(): number {
    return this.sessions.size;
  }

  /**
   * 收集进程资源指标
   */
  private async collectMetrics(pid: number): Promise<ResourceMetrics> {
    // 尝试从 /proc 读取（Linux）
    try {
      const { readFile } = await import('fs/promises');

      // 读取 /proc/[pid]/stat 获取 CPU
      const stat = await readFile(`/proc/${pid}/stat`, 'utf-8');
      const statFields = stat.split(' ');
      const utime = parseInt(statFields[13] || '0');
      const stime = parseInt(statFields[14] || '0');
      const totalTime = utime + stime;

      // 读取 /proc/[pid]/status 获取内存
      const status = await readFile(`/proc/${pid}/status`, 'utf-8');
      const vmRssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
      const memoryKb = vmRssMatch ? parseInt(vmRssMatch[1]) : 0;

      return {
        cpuPercent: totalTime, // 简化：返回累计 CPU 时间
        memoryBytes: memoryKb * 1024,
        diskWriteBytes: 0, // TODO: 从 /proc/[pid]/io 读取
        networkOutBytes: 0, // TODO: 从 /proc/[pid]/net/dev 读取
      };
    } catch {
      // 非 Linux 或进程不存在，返回零值
      return {
        cpuPercent: 0,
        memoryBytes: 0,
        diskWriteBytes: 0,
        networkOutBytes: 0,
      };
    }
  }

  /**
   * 检查是否超过资源限制
   */
  private isExceeded(metrics: ResourceMetrics, limits: ResourceLimits): boolean {
    if (metrics.memoryBytes > limits.memoryLimit) return true;
    if (limits.diskWriteLimit > 0 && metrics.diskWriteBytes > limits.diskWriteLimit) return true;
    if (limits.networkDisabled && metrics.networkOutBytes > 0) return true;
    return false;
  }
}
