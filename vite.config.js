import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Chrome 扩展页面(chrome-extension://)要求资源使用相对路径
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
