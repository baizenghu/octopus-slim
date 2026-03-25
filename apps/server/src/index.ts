/**
 * Octopus Enterprise Gateway
 *
 * 企业级 API 网关入口
 *
 * 功能：
 * - REST API（Express）：认证 + 对话 + 审计
 * - SSE 流式响应
 * - 集成 enterprise-auth, enterprise-workspace, enterprise-audit
 * - 通过 OpenAI 兼容接口代理到 DeepSeek API
 */

// 加载项目根 .env，确保不依赖外部 shell 注入环境变量
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

// 引擎 state 目录指向项目内（确保不读 ~/.octopus/）
const projectRoot = path.resolve(__dirname, '..', '..', '..');
if (!process.env.OCTOPUS_HOME) {
  process.env.OCTOPUS_HOME = path.join(projectRoot, '.octopus-state');
}
if (!process.env.OCTOPUS_STATE_DIR) {
  process.env.OCTOPUS_STATE_DIR = path.join(projectRoot, '.octopus-state');
}

import { loadConfig } from './config';
import { initServices } from './startup/init-services';
import { initIM } from './startup/init-im';
import { initEngineEvents } from './startup/init-engine-events';
import { initRoutes } from './startup/init-routes';

async function main() {
  console.log('🚀 Starting Octopus AI Gateway...');

  const config = loadConfig();
  const services = await initServices(config);

  // 启动 IM 服务（飞书、微信等）
  let imService;
  if (services.bridge && services.prismaClient) {
    try {
      imService = await initIM({
        bridge: services.bridge,
        prismaClient: services.prismaClient,
        authService: services.authService,
        workspaceManager: services.workspaceManager,
        auditLogger: services.auditLogger,
        config,
      });
    } catch (err: any) {
      console.warn('   Native Gateway: connection failed -', err.message);
      console.warn('   Chat will not work until native gateway is available');
    }
  }

  // 注册引擎事件监听（cron 日志 + heartbeat 告警）
  if (services.bridge) {
    initEngineEvents({
      bridge: services.bridge,
      prismaClient: services.prismaClient,
      imService,
    });
  }

  // 挂载路由，启动 HTTP 服务器
  const { server } = await initRoutes({
    config,
    ...services,
    imService,
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    server.close();
    services.bridge?.shutdown();
    await services.prismaClient?.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('❌ Gateway failed to start:', err);
  process.exit(1);
});
