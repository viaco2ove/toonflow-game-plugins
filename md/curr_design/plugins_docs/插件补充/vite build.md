# vite build
cd plugins/toonflow-field-survival/vue
npx vite build
目的: 这是 Vite 的生产打包命令，把 src/ 下的所有 TS/Vue 文件 + 依赖编译压缩成单个静态文件，输出到 ../ui/index.html（看 vite.config.ts 配置）。