import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts: ['localhost', '127.0.0.1', 'zhthink.dpdns.org'],
    proxy: {
      '/api': {
        target: process.env.GATEWAY_URL || 'http://localhost:18790',
        changeOrigin: true,
        timeout: 0,           // 禁用代理超时（SSE 长连接）
        proxyTimeout: 0,      // 禁用代理响应超时
      },
      '/health': {
        target: process.env.GATEWAY_URL || 'http://localhost:18790',
        changeOrigin: true,
      },
    },
  },
});
