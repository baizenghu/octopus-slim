import { describe, it, expect, vi } from 'vitest';
import { asyncHandler } from '../async-handler';

describe('asyncHandler', () => {
  it('calls next with error when async handler rejects', async () => {
    const error = new Error('test error');
    const handler = asyncHandler(async () => { throw error; });

    const req = {} as any;
    const res = {} as any;
    const next = vi.fn();

    handler(req, res, next);
    await new Promise(r => setTimeout(r, 0));

    expect(next).toHaveBeenCalledWith(error);
  });

  it('does not call next when handler resolves', async () => {
    const handler = asyncHandler(async (_req, res) => {
      res.json({ ok: true });
    });

    const req = {} as any;
    const res = { json: vi.fn() } as any;
    const next = vi.fn();

    handler(req, res, next);
    await new Promise(r => setTimeout(r, 0));

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});
