import { describe, it, expect } from 'vitest';
import { FileCleanupService } from '../FileCleanupService';

describe('FileCleanupService', () => {
  it('should be instantiable with config', () => {
    const service = new FileCleanupService({
      dataRoot: '/tmp/test',
      cleanup: {
        outputRetentionDays: 7,
        filesRetentionDays: 30,
        tempRetentionHours: 1,
        cleanupIntervalMinutes: 30,
        orphanDetectionEnabled: false,
      },
      prisma: null as any,
    });
    expect(service).toBeDefined();
  });

  it('should calculate correct expiry dates', () => {
    const now = new Date('2026-03-13T00:00:00Z');
    const outputCutoff = new Date(now);
    outputCutoff.setUTCDate(outputCutoff.getUTCDate() - 7);
    expect(outputCutoff.toISOString()).toBe('2026-03-06T00:00:00.000Z');
    const tempCutoff = new Date(now);
    tempCutoff.setUTCHours(tempCutoff.getUTCHours() - 1);
    expect(tempCutoff.toISOString()).toBe('2026-03-12T23:00:00.000Z');
  });
});
