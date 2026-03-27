/**
 * node-id.ts — 进程级唯一节点标识
 *
 * RedisLock 和 LeaderElection 共享同一 nodeId，
 * 避免各自生成导致不一致。
 */

import { randomUUID } from 'crypto';

export const NODE_ID = `node-${process.pid}-${randomUUID().slice(0, 8)}`;
