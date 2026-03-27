/**
 * EventRelay.ts — Redis Pub/Sub 事件传播
 *
 * 解决多节点场景下 SSE 客户端与 agent 执行不在同一节点的问题。
 * subscriber 使用独立连接（Redis Pub/Sub 要求）。
 */

import type Redis from 'ioredis';
import { createLogger } from '../../utils/logger';

const logger = createLogger('event-relay');

type EventHandler = (channel: string, message: string) => void;

export class RedisEventRelay {
  private subscriber: Redis;
  private publisher: Redis;
  private handlers = new Map<string, Set<EventHandler>>();

  constructor(private redis: Redis) {
    // subscriber 需要独立连接（进入 subscribe 模式后不能执行其他命令）
    this.subscriber = redis.duplicate();
    this.publisher = redis;

    this.subscriber.on('message', (channel: string, message: string) => {
      const handlers = this.handlers.get(channel);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(channel, message);
          } catch (err) {
            logger.warn('Event handler error', { channel, error: (err as Error).message });
          }
        }
      }
    });

    this.subscriber.on('error', (err) => {
      logger.warn('Subscriber connection error', { error: err.message });
    });
  }

  /**
   * 发布事件到指定 channel
   */
  async publish(channel: string, data: unknown): Promise<void> {
    try {
      await this.publisher.publish(channel, JSON.stringify(data));
    } catch (err) {
      logger.warn('Failed to publish event', { channel, error: (err as Error).message });
    }
  }

  /**
   * 订阅 channel，返回取消订阅函数
   */
  subscribe(channel: string, handler: EventHandler): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      this.subscriber.subscribe(channel).catch((err) => {
        logger.warn('Failed to subscribe', { channel, error: (err as Error).message });
      });
    }
    this.handlers.get(channel)!.add(handler);

    // 返回取消订阅函数
    return () => {
      const channelHandlers = this.handlers.get(channel);
      if (channelHandlers) {
        channelHandlers.delete(handler);
        // 该 channel 无 handler 时取消 Redis 订阅
        if (channelHandlers.size === 0) {
          this.handlers.delete(channel);
          this.subscriber.unsubscribe(channel).catch(() => {});
        }
      }
    };
  }

  /**
   * 关闭所有订阅并断开 subscriber 连接
   */
  async shutdown(): Promise<void> {
    try {
      await this.subscriber.unsubscribe();
      this.handlers.clear();
      await this.subscriber.quit();
    } catch (err) {
      logger.warn('Shutdown error', { error: (err as Error).message });
    }
  }
}
