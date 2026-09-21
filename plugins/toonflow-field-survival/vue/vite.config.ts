import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * 构建为单个自包含 HTML（内联 JS/CSS），
 * 输出到插件 ui/game.html，由后端 /plugin/getAsset 提供给 iframe 加载。
 */
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  base: "./",
  build: {
    outDir: "../ui",
    emptyOutDir: false,
    assetsInlineLimit: 100 * 1024 * 1024,
    target: "es2020",
  },
});
