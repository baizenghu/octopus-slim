/**
 * 微信扫码登录入口脚本
 *
 * 用法: ./start.sh weixin-login
 *       npx tsx scripts/weixin-login.ts
 */

import { weixinLogin } from '../apps/server/src/services/im/weixin/login';

async function main() {
  console.log('[微信登录] 正在启动...');
  console.log('[微信登录] 请使用微信扫描下方二维码\n');

  try {
    await weixinLogin({ verbose: true });
    console.log('\n[微信登录] ✅ 连接成功！');
    console.log('[微信登录] 请在 .env 中设置 WEIXIN_ENABLED=true');
    console.log('[微信登录] 然后重启 gateway: ./start.sh restart');
  } catch (err: any) {
    console.error(`\n[微信登录] ❌ 登录失败: ${err.message}`);
    console.error('[微信登录] 可重新执行: ./start.sh weixin-login');
    process.exit(1);
  }
}

main();
