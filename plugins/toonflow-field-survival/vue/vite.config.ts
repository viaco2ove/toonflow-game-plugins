import { defineConfig } from "vite";
// @ts-ignore
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * 构建为单个自包含 HTML（内联 JS/CSS），
 * 输出到插件 ui/game.html，由后端 /plugin/getAsset 提供给 iframe 加载。
 */
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  server: {
    port: 3000,      // 你想要的端口
    // strictPort: true,   // 加上这行：端口被占用时直接报错，而不是自动顺延到 3001
  },
  base: "./",
  build: {
    outDir: "../ui",
    emptyOutDir: true,   // 每次构建覆盖旧的 ui/game.html
    assetsInlineLimit: 100 * 1024 * 1024,
    target: "es2020",
  },
});
