import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';

// public/ 是扩展配置的唯一来源；根目录入口引用同一份 dist 产物。
function rootExtensionEntry() {
  const root = new URL('.', import.meta.url);
  return {
    name: 'root-extension-entry',
    apply: 'build',
    writeBundle() {
      const manifest = JSON.parse(readFileSync(new URL('dist/manifest.json', root), 'utf8'));
      manifest.background.service_worker = `dist/${manifest.background.service_worker}`;
      for (const icons of [manifest.icons, manifest.action.default_icon]) {
        for (const size of Object.keys(icons)) icons[size] = `dist/${icons[size]}`;
      }
      cpSync(new URL('dist/_locales/', root), new URL('_locales/', root), { recursive: true });
      writeFileSync(new URL('manifest.json', root), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [react(), rootExtensionEntry()],
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
