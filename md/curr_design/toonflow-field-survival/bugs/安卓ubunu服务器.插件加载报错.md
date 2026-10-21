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

**真凶是 CLI（commit 52ca722）**：用户安装走 `python -m toon_plugins plugins --install-all`，
而 `src/toon_plugins/cli.py` 的 `ensure_entry_js()` 每次打包都用**漏 --bundle 的命令**重编
entry.js 再上传——所以不管把修好的 entry.js 拷到哪里，一次 install-all 就被覆盖回坏版。
（宿主持 `pluginEntryConsistency.ts` 即 /plugin/rebuild 的 esbuild 早在 2026-10-20 就带了
`--bundle=true`，但 CLI 打包通道这一处一直没同步修。）
CLI 现已补 `--bundle --format=esm --platform=node --target=node18`，
函数级验证：产物 0 import、导出 handle_action、Node import 通过。

**部署机已就地修复（无需拷贝文件）**：用有效 token 调
`POST /plugin/rebuild {"pluginId":"com.toonflow.minigame-field-survival"}` → 宿主持自己
重编 entry.js（返回 `rebuilt:true, cacheCleared:true`），远端 entry.js 复测 0 import，
`POST /plugin/tick(start)` 返回 `phase:"playing"` 真实 state（player_0 / mob_wood_0…）。
宿主持按 mtime 热重载，修复立即生效；下次 install-all 会重新上传——CLI 修复后上传的即正确版本。

**附带发现**：日志里 iframe URL 的 token `iat` 比当前时间快 ~81 天（设备时钟快），该 token
调后端 API 全部 401「无效的token」——安卓设备时钟需校正（潜在独立问题）。

## 待办

- [x] 修复 CLI ensure_entry_js 的 esbuild 命令（52ca722）
- [x] 部署机 /plugin/rebuild 就地修复（已验证 tick 返回真实 state）
- [ ] 用户下次 install-all 后确认部署机 entry.js 仍是 0 import 版
- [ ] 复测「开始游戏」应直接进入游戏；前端新日志
      `[field-survival] 选人角色列表(宿主 state.roles)` 会打印注入的角色
      （为空则查后端 `[minigame roles]` / `[worldRoles]` 日志定位哪一级丢的）
