/**
 * Node.js preload script: 设置 undici 全局代理
 * 让 native gateway 的 fetch 请求走 HTTP_PROXY/HTTPS_PROXY
 *
 * Node.js 22 内置 undici，通过 node:内部路径加载
 */
const proxyUrl = (
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.https_proxy ||
  process.env.http_proxy ||
  ''
).trim();

if (proxyUrl) {
  try {
    // Node.js 22 的 fetch 基于内置 undici，从 octopus-main 的 node_modules 加载
    const undici = await import('/home/baizh/octopus-main/node_modules/undici/index.js');
    undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
    console.log(`[proxy-preload] global proxy set via EnvHttpProxyAgent (${proxyUrl})`);
  } catch (e1) {
    // fallback: 试从 global 加载
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire('/home/baizh/octopus-main/octopus.mjs');
      const undici = require('undici');
      undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
      console.log(`[proxy-preload] global proxy set via require fallback (${proxyUrl})`);
    } catch (e2) {
      console.warn(`[proxy-preload] failed to set global proxy: ${e1.message} / ${e2.message}`);
    }
  }
}
