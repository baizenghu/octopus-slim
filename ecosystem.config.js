/**
 * PM2 生态配置文件 — Octopus Enterprise
 *
 * 用法:
 *   pm2 start ecosystem.config.js
 *   pm2 stop all
 *   pm2 restart all
 *   pm2 logs
 *
 * 注意: native-gateway 必须最先启动，gateway 依赖它的 WebSocket 连接。
 */

const path = require('path');

const ROOT_DIR = __dirname;
const STATE_DIR = path.join(ROOT_DIR, '.octopus-state');
const LOG_DIR = path.join(ROOT_DIR, '.dev-logs');

// 从 .env 读取的默认值（PM2 会自动加载 .env）
const NATIVE_PORT = process.env.OCTOPUS_NATIVE_PORT || '19791';
const GATEWAY_PORT = process.env.GATEWAY_PORT || '18790';
const ADMIN_PORT = process.env.ADMIN_CONSOLE_PORT || '3001';
const GW_TOKEN = process.env.OCTOPUS_GATEWAY_TOKEN;
if (!GW_TOKEN) {
  console.error('OCTOPUS_GATEWAY_TOKEN 环境变量未设置');
  process.exit(1);
}

module.exports = {
  apps: [
    // ─── Native Octopus Gateway ───────────────────────────
    {
      name: 'native-gateway',
      script: '/home/baizh/octopus-main/octopus.mjs',
      args: `--profile enterprise gateway run --force --port ${NATIVE_PORT}`,
      cwd: ROOT_DIR,
      interpreter: 'node',

      // 环境变量（与 start-dev.sh 保持一致）
      env: {
        OCTOPUS_STATE_DIR: STATE_DIR,
        OCTOPUS_HOME: STATE_DIR,
        OCTOPUS_GATEWAY_TOKEN: GW_TOKEN,
        DATABASE_URL: process.env.DATABASE_URL || '',
      },

      // 自动重启策略
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,

      // 日志
      out_file: path.join(LOG_DIR, 'native-gateway-out.log'),
      error_file: path.join(LOG_DIR, 'native-gateway-err.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // 文件监听（config 变更时自动重启）
      watch: [path.join(STATE_DIR, 'octopus.json')],
      watch_delay: 2000,
      ignore_watch: ['node_modules', '.dev-logs', 'data'],

      // 资源限制
      max_memory_restart: '1G',
    },

    // ─── Enterprise Gateway (Express API) ──────────────────
    {
      name: 'gateway',
      script: 'src/index.ts',
      cwd: path.join(ROOT_DIR, 'apps', 'gateway'),
      interpreter: path.join(ROOT_DIR, 'node_modules', '.bin', 'tsx'),

      env: {
        NODE_ENV: 'production',
        GATEWAY_PORT: GATEWAY_PORT,
        OCTOPUS_GATEWAY_TOKEN: GW_TOKEN,
        OCTOPUS_GATEWAY_URL: `ws://127.0.0.1:${NATIVE_PORT}`,
      },

      // 启动延迟：等待 native gateway 就绪
      // PM2 不原生支持 depends_on，通过 restart_delay 间接保证
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,

      // 日志
      out_file: path.join(LOG_DIR, 'gateway-out.log'),
      error_file: path.join(LOG_DIR, 'gateway-err.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // 开发模式监听源码变更
      watch: false,
      // 开发时可设为 true:
      // watch: [path.join(ROOT_DIR, 'apps', 'gateway', 'src')],

      max_memory_restart: '512M',
    },

    // ─── Admin Console (Vite dev server) ───────────────────
    {
      name: 'admin-console',
      script: path.join(ROOT_DIR, 'node_modules', '.bin', 'vite'),
      args: `--port ${ADMIN_PORT}`,
      cwd: path.join(ROOT_DIR, 'apps', 'admin-console'),

      env: {
        NODE_ENV: 'development',
      },

      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,

      // 日志
      out_file: path.join(LOG_DIR, 'admin-console-out.log'),
      error_file: path.join(LOG_DIR, 'admin-console-err.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      watch: false,
      max_memory_restart: '256M',
    },
  ],
};
