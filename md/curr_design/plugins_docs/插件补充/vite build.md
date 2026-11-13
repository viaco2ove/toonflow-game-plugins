# vite build

> 前端产物构建（`ui/game.html`）。**后端逻辑不走这条路**——后端跑的是 `entry.js`（entry.ts 的 esbuild 产物）。
> 最后更新：2026-11-12

## 构建

```bash
cd plugins/toonflow-field-survival/vue
npx vite build
```

目的：把 `src/` 下所有 TS/Vue 文件 + 依赖编译压缩成单个静态文件，输出到 `../ui/index.html`
（`vite.config.ts` 的 `viteSingleFile` 插件内联成单文件 HTML）。

> ⚠️ 构建产物名是 `index.html`，**不是** `game.html`。
> `npm run build` 脚本里会在 vite build 之后 `renameSync('../ui/index.html','../ui/game.html')`——
> 宿主 `getAsset` 取的是 `ui/game.html`。手动 `npx vite build` 后记得改名，否则前端拿不到产物。

## 两套产物，别搞混

| 产物 | 由谁生成 | 跑在哪 | 改它意味着 |
|---|---|---|---|
| `ui/game.html` | **vite build**（vue/src → 内联 bundle） | 浏览器 iframe（前端 UI/渲染/输入） | 改前端 |
| `entry.js` | **esbuild**（entry.ts → bundle） | 60002 后端（`entry.handle_action`） | 改后端游戏逻辑 |

两条链路**独立**：前端完全不读 entry.js，后端完全不读 game.html。
详见 [`entry.js和entry.ts 的关系和说明.md`](./entry.js和entry.ts%20的关系和说明(2026-10-07).md)。

## 开发模式（不用构建）

```bash
cd plugins/toonflow-field-survival/vue
npm run dev                                        # 普通 dev
npm run debug -- --story=赦夜人冥夜走廊-第二季 --conn   # 带拟真宿主桩（本地选人开局，无需 5175）
```

- `--conn` 模式在 3000 端口起「拟真宿主桩」：浏览器打开 `http://localhost:3000/` 即可选人开局，
  **不需要另起 5175 宿主**。
- ⚠️ 桩**不接 60002**：状态全在 vite 进程内存里，且其 tick 由客户端 tick 消息驱动
  （客户端不发 → 桩不推进 → 前端画面冻结）。验证真实链路必须打 60002。
- vite 启动时会 `fetch /plugin/rebuild` 触发 60002 侧 esbuild 现编 + 清 entry 缓存，
  保证 dev-host 与安装副本同源。

## 相关

- 插件整体运行机制：[`插件工作机制(2026-10-07).md`](./插件工作机制(2026-10-07).md)
- 数据存储（含内存态）：[`数据储存.t_plugin_session_data.md`](./数据储存.t_plugin_session_data.md)
