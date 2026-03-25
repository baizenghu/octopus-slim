import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'packages/**/src/**/*.spec.ts',
      'apps/**/src/**/*.test.ts',
      'apps/**/src/**/*.spec.ts',
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // 引擎自带测试 — fork 后不维护，只跑企业层测试
      'packages/engine/src/**/*.test.ts',
      'packages/engine/src/**/*.spec.ts',
      'packages/engine/ui/**/*.test.ts',
      'packages/engine/ui/**/*.spec.ts',
      'packages/engine/extensions/**/*.test.ts',
      'packages/engine/extensions/**/*.spec.ts',
    ],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts',
        '**/index.ts',
        '**/dist/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    alias: {
      '@octopus/auth': path.resolve(__dirname, 'packages/auth/src'),
      '@octopus/workspace': path.resolve(__dirname, 'packages/workspace/src'),
      '@octopus/audit': path.resolve(__dirname, 'packages/audit/src'),
      '@octopus/quota': path.resolve(__dirname, 'packages/quota/src'),
      '@octopus/database': path.resolve(__dirname, 'packages/database/src'),
      '@octopus/engine': path.resolve(__dirname, 'packages/engine/src'),
    },
  },
});
