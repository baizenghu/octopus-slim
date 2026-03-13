import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeartbeatForwarder } from '../HeartbeatForwarder';

describe('HeartbeatForwarder', () => {
  const sendToUser = vi.fn();
  const scheduledTaskFindFirst = vi.fn();
  const agentFindFirst = vi.fn();

  const bridge = {
    trackedRunIds: new Set<string>(),
    on: vi.fn(),
    off: vi.fn(),
  } as any;

  const imService = {
    sendToUser,
  } as any;

  const prisma = {
    agent: { findFirst: agentFindFirst },
    scheduledTask: { findFirst: scheduledTaskFindFirst },
  } as any;

  beforeEach(() => {
    sendToUser.mockReset();
    agentFindFirst.mockReset();
    scheduledTaskFindFirst.mockReset();
  });

  it('forwards result when enabled heartbeat task exists for the agent', async () => {
    agentFindFirst.mockResolvedValue({ id: 'agent-db-1' });
    scheduledTaskFindFirst.mockResolvedValue({ enabled: true });
    sendToUser.mockResolvedValue(1);

    const forwarder = new HeartbeatForwarder(bridge, imService, prisma);
    await (forwarder as any).forwardIfHeartbeat('ent_user-001_default', '磁盘空间不足');

    expect(agentFindFirst).toHaveBeenCalledWith({
      where: { ownerId: 'user-001', name: 'default' },
      select: { id: true },
    });
    expect(scheduledTaskFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-001',
        taskConfig: { path: '$.agentId', equals: 'agent-db-1' },
        taskType: 'heartbeat',
        enabled: true,
      },
    });
    expect(sendToUser).toHaveBeenCalledWith('user-001', '[心跳巡检] ent_user-001_default 执行结果:\n\n磁盘空间不足');
  });

  it('skips forwarding when no enabled heartbeat task exists', async () => {
    agentFindFirst.mockResolvedValue({ id: 'agent-db-1' });
    scheduledTaskFindFirst.mockResolvedValue(null);

    const forwarder = new HeartbeatForwarder(bridge, imService, prisma);
    await (forwarder as any).forwardIfHeartbeat('ent_user-001_default', '普通任务输出');

    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('skips HEARTBEAT_OK responses', async () => {
    agentFindFirst.mockResolvedValue({ id: 'agent-db-1' });
    scheduledTaskFindFirst.mockResolvedValue({ enabled: true });

    const forwarder = new HeartbeatForwarder(bridge, imService, prisma);
    await (forwarder as any).forwardIfHeartbeat('ent_1234567890_default', 'HEARTBEAT_OK');

    expect(sendToUser).not.toHaveBeenCalled();
  });
});
