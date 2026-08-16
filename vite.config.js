import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Chrome 扩展页面(chrome-extension://)要求资源使用相对路径
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 目标环境为现代浏览器/Chrome 扩展，无需降级编译，减小产物体积
    target: 'esnext',
  },
  server: {
    host: true,
    port: 5173,
  },
});
