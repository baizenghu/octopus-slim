/**
 * init-engine-events.ts — 引擎事件监听
 * cron 调试日志 + heartbeat 异常 IM 告警推送
 */

import { EngineAdapter } from '../services/EngineAdapter';
import { IMService } from '../services/im';
import type { AppPrismaClient } from '../types/prisma';
import { createLogger } from '../utils/logger';

const logger = createLogger('engine-events');

export function initEngineEvents(params: {
  bridge: EngineAdapter;
  prismaClient?: AppPrismaClient;
  imService?: IMService;
}): void {
  const { bridge, prismaClient, imService } = params;

  // 监听 native cron 事件（仅用于调试/日志）
  bridge.on('cron_finished', (payload: any) => {
    if (payload?.action === 'started' || payload?.action === 'finished') {
      logger.info(`job ${payload.jobId} ${payload.action}`);
    }
  });

  // heartbeat 事件需要 imService + prismaClient 才能推送告警
  if (!imService || !prismaClient) return;

  // 监听引擎心跳事件 — 异常时自动推送 IM 告警
  // 事件字段：status(completed/skipped), reason(target-none等), preview(回复摘要), agentId, durationMs
  const heartbeatImService = imService; // 局部变量避免 TypeScript 闭包 narrowing 问题
  bridge.on('heartbeat', (evt: any) => {
    const content = evt.preview || evt.reply || '';
    const isAlert = content && !content.includes('HEARTBEAT_OK');
    logger.info('heartbeat event', { status: evt.status, reason: evt.reason || 'n/a', alert: isAlert, agent: evt.agentId || 'default' });

    // 推送条件：有内容且不含 HEARTBEAT_OK
    if (isAlert) {
      // 从 agentId 提取 userId（ent_{userId}_{agentName}）
      const match = evt.agentId?.match(/^ent_(user-[^_]+)_(.+)$/);
      let userIds: string[] = [];
      if (match?.[1]) {
        userIds = [match[1]];
      } else {
        // agentId 为 default 或无法解析 — 查 DB 找有心跳任务的所有用户
        prismaClient.scheduledTask.findMany({
          where: { taskType: 'heartbeat', enabled: true },
          select: { userId: true },
        }).then((hbTasks: any[]) => {
          const uids = [...new Set(hbTasks.map((t: any) => t.userId))];
          const alert = `🚨 心跳巡检告警\n时间: ${new Date().toLocaleString('zh-CN')}\n\n${content.slice(0, 2000)}`;
          for (const uid of uids) {
            heartbeatImService.sendToUser(uid, alert).then(sent => {
              if (sent > 0) logger.info(`Alert pushed to ${uid} via IM`);
            }).catch((e2: any) => logger.warn(`IM push to ${uid} failed`, { error: e2.message }));
          }
        }).catch((e: unknown) => logger.warn('[init-engine-events] DB query failed:', { error: e instanceof Error ? e.message : String(e) }));
        return; // 异步处理，提前返回
      }
      const alertText = `🚨 心跳巡检告警\n时间: ${new Date().toLocaleString('zh-CN')}\n\n${content.slice(0, 2000)}`;
      for (const uid of userIds) {
        heartbeatImService.sendToUser(uid, alertText).then(sent => {
          if (sent > 0) logger.info(`Alert pushed to ${uid} via IM`);
        }).catch((e: any) => logger.warn(`IM push to ${uid} failed`, { error: e.message }));
      }
    }
  });
}
