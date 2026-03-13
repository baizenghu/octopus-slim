/**
 * 心跳巡检结果转发服务
 *
 * @deprecated 此类是死代码。Native gateway 的嵌入式心跳 runner 不广播 WS `agent` 事件，
 * 因此 `_raw_event` 监听永远不会收到心跳相关事件。
 * 心跳结果通知已改用 `send_im_message` 工具：agent 在 HEARTBEAT.md 任务中主动调用
 * enterprise-mcp 的 send_im_message → 内部 API → IMService。
 * 保留此文件仅供参考，未来可安全删除。
 */

import type { OctopusBridge } from './OctopusBridge';
import type { IMService } from './im/IMService';

/** agent 事件 payload 类型（从 _raw_event 解构） */
interface AgentEventPayload {
  stream?: string;
  agentId?: string;
  runId?: string;
  idempotencyKey?: string;
  data?: {
    phase?: string;
    text?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** 清理模型输出中的 <think> 标签 */
function stripThinkTags(text: string): string {
  const thinkOpen = text.indexOf('<think>');
  if (thinkOpen === -1) return text;
  const thinkClose = text.indexOf('</think>');
  if (thinkClose === -1) return '';
  return text.slice(thinkClose + 8).replace(/<\/?final>/g, '').trim();
}

/** 飞书单条消息最大长度（FeishuAdapter 内部会分段，但摘要应控制在合理范围） */
const MAX_SUMMARY_LENGTH = 2000;

export class HeartbeatForwarder {
  /** 正在执行的心跳 runId → 累积的 assistant 文本 */
  private activeRuns = new Map<string, { agentId: string; content: string }>();

  constructor(
    private bridge: OctopusBridge,
    private imService: IMService,
    private prisma: any,
  ) {}

  /** 开始监听 bridge 事件 */
  start(): void {
    this.bridge.on('_raw_event', this.handleRawEvent);
    console.log('   HeartbeatForwarder: started');
  }

  /** 停止监听 */
  stop(): void {
    this.bridge.off('_raw_event', this.handleRawEvent);
    this.activeRuns.clear();
  }

  /**
   * 处理 bridge 的原始事件帧
   *
   * agent 事件按 stream 分类：
   * - lifecycle (phase: start/end/error) — 标识执行开始/结束
   * - assistant (data.text) — 累积文本内容
   */
  private handleRawEvent = (frame: { event: string; payload?: unknown }): void => {
    if (frame.event !== 'agent') return;

    const payload = frame.payload as AgentEventPayload | undefined;
    if (!payload) return;

    const { stream, agentId, runId, data } = payload;
    if (!agentId || !runId) return;

    // 只关心 ent_ 前缀的企业 agent
    if (!agentId.startsWith('ent_')) return;

    if (stream === 'lifecycle') {
      const phase = data?.phase;
      if (phase === 'start') {
        // 跳过由 callAgent 发起的 run（有 trackedRunIds 记录）
        if (this.bridge.trackedRunIds.has(runId)) return;
        // 记录新的 run（可能是心跳或 cron 触发的）
        this.activeRuns.set(runId, { agentId, content: '' });
      } else if (phase === 'end' || phase === 'error') {
        const run = this.activeRuns.get(runId);
        if (run) {
          this.activeRuns.delete(runId);
          if (phase === 'end' && run.content) {
            // 异步处理转发，不阻塞事件流
            this.forwardIfHeartbeat(run.agentId, run.content).catch((e: unknown) => {
              const msg = e instanceof Error ? e.message : String(e);
              console.error(`[heartbeat-forwarder] Forward error: ${msg}`);
            });
          }
        }
      }
    } else if (stream === 'assistant') {
      // 累积文本（data.text 是全量累积文本，取最新值）
      const run = this.activeRuns.get(runId);
      if (run && data?.text) {
        run.content = data.text as string;
      }
    }
  };

  /**
   * 检查是否是心跳执行的结果，如果是则转发到 IM
   *
   * 识别策略：心跳由 native gateway 内部发起，不经过企业 gateway 的 callAgent。
   * 企业 gateway 的 callAgent 会注册 idempotencyKey，所以没有被 callAgent
   * 跟踪的 agent 事件就是心跳或 cron 触发的。
   * 这里简化处理：所有不在 activeCallAgentRuns 中的完成事件都转发给用户。
   */
  private async forwardIfHeartbeat(agentId: string, rawContent: string): Promise<void> {
    // 从 agentId 提取 userId: ent_{userId}_{agentName}
    const match = agentId.match(/^ent_([^_]+)_/);
    if (!match) return;
    const userId = match[1];
    const agentName = agentId.slice(`ent_${userId}_`.length);
    if (!agentName) return;

    const dbAgent = await this.prisma.agent.findFirst({
      where: {
        ownerId: userId,
        name: agentName,
      },
      select: { id: true },
    }) as { id: string } | null;
    if (!dbAgent) return;

    // 只有存在且启用中的 heartbeat 任务时才转发，避免把普通 cron/native run 误判成心跳。
    const heartbeatTask = await this.prisma.scheduledTask.findFirst({
      where: {
        userId,
        taskConfig: { path: '$.agentId', equals: dbAgent.id },
        taskType: 'heartbeat',
        enabled: true,
      },
    }) as { enabled?: boolean } | null;
    if (!heartbeatTask) return;

    // 清理文本
    const cleaned = stripThinkTags(rawContent).trim();
    if (!cleaned) return;

    // HEARTBEAT_OK 表示一切正常，无需通知用户
    if (cleaned === 'HEARTBEAT_OK') {
      console.log(`[heartbeat-forwarder] Agent ${agentId} heartbeat OK, skipping notification`);
      return;
    }

    // 构造通知消息
    const summary = cleaned.length > MAX_SUMMARY_LENGTH
      ? cleaned.slice(0, MAX_SUMMARY_LENGTH) + '...(内容已截断)'
      : cleaned;
    const message = `[心跳巡检] ${agentId} 执行结果:\n\n${summary}`;

    // 发送给用户
    const sent = await this.imService.sendToUser(userId, message);
    if (sent > 0) {
      console.log(`[heartbeat-forwarder] Forwarded heartbeat result for ${agentId} to ${sent} IM channel(s)`);
    }
  }
}
