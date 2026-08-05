import { defineConfig } from 'vite'

export default defineConfig({
  // 相对路径 —— build 产物可放到任意目录/子路径，kiosk 静态托管最稳
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        // 动态 import 的 chunk（pixi 的 renderer 等）全部并入主 bundle。
        // 否则打包后的动态 chunk 依赖主 bundle，而主 bundle 求值期间
        // 若顶层逻辑挂起会形成模块求值死锁（app.init 永不返回）。
        inlineDynamicImports: true,
      },
    },
  },
})
