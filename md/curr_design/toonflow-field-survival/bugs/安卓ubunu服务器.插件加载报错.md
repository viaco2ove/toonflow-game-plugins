# 安卓ubunu服务器.插件加载报错.md（2026/10/21）

## 症状

安卓 ubuntu 部署（http://10.10.2.195:8088/ ）进入故事游玩野外生存小游戏：选人界面能出来，
但点「开始游戏」后永远卡住，显示「开始超时：宿主未返回 /plugin/tick(start) 响应，
请检查服务端与插件会话后重试」。localhost:5175 dev 模式完全正常。

## 诊断过程（bsk 浏览器实测 + 代码链路）

1. `bsk` 打开 8088 → 故事大厅 → 赦夜人冥夜走廊-第二季 → 游玩，小游戏 iframe 正常渲染
   （地图包 23 关 / 碰撞网格 / eventEngine 都 OK，说明 getAsset 链路没问题）。
2. 点「开始游戏」→ iframe console 有 `[bridge] sendTick → start`，页面 message 监听
   也收到 `tf_plugin_tick`（origin :60002）→ SPA 中继正常发出 `POST /plugin/tick`（XHR 插桩证实）。
3. 手动 `POST /plugin/tick {sessionId, pluginId, action:'start'}` → 后端返回：
   `{"code":200,"data":{"state":{},"actions":[],"code":1,"message":"entry 模块加载失败"}}`
   —— state 恒为 {}，所以前端 state 字段体检把全部字段都补齐、phase 永远是 select。

## 根因

**部署机上的 `entry.js` 不是 bundle 产物**，残留静态 import：

```js
import { PROMPT_FIELD_SURVIVAL_MAP_GENER, ... } from "./src/agents/plugins.prompts";
```

- 宿主持 `PluginExecutor.importEntryModule()`：entry.js 含 import → `isSelfContainedEntry()`
  返回 false → 跳过影子模块 → 直接 `import(file:///…/entry.js)` → Node ESM 解析
  `./src/agents/plugins.prompts` 失败（① 扩展名缺失，Node ESM 必须写全 `.js`；
  ② 部署机 `src/agents/` 下只有 `.ts` 没有 `.js`）→ `ERR_MODULE_NOT_FOUND`
  → 模块加载失败 → `handle_action` 兜底返回空 state。
- 本地实测旧 entry.js：`LOAD FAIL: ERR_MODULE_NOT_FOUND - Cannot find module
  '...src\agents\plugins.prompts' imported from ...entry.js`。
- 远端 entry.js 与本地旧版 MD5 完全一致（e2ddcf40），排除拷贝损坏。

## 修复

构建命令漏了 `--bundle`（entry.js.md 里写的是 `npx esbuild entry.ts --outfile=entry.js`，
esbuild 只做转译不打包，import 原样保留）。正确命令：

```
npx esbuild entry.ts --bundle --format=esm --platform=node --target=node18 --outfile=entry.js
```

重建后验证：
- 0 处 import / 无 import.meta，导出 `handle_action`
- Node 直接 import 成功；`handle_action('init', ...)` 返回 `code:0 phase=select 37 字段`
- 新 MD5：`6017e45e179d3338d526a205fa35c7ad`，已同步 run-db installed 副本

## 待办

- [ ] 把新 entry.js 拷到安卓 ubuntu 部署机插件目录
      （`plugins/1/com.toonflow.field-survival/entry.js`，宿主持按 mtime 热重载，无需重启后端）
- [ ] 拷完后复测：点开始游戏应直接进入游戏，console 不再有
      「state 字段体检❗补齐[全部字段]」，tick 返回真实 state
