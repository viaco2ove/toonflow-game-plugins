# entry.js 和 entry.ts 的关系和说明（2026-10-07 版）

## 设计初衷（参考插件设计.md）

插件系统的双入口模式：

- **`entry.ts`** — 后端 TypeScript 入口，宿主在 `/plugin/tick` 时由 `PluginExecutor.loadEntryModule` 动态 import，调 `handle_action(action, params, state, context)` 处理游戏逻辑（AI 攻击判定、战利品掉落、存档读写等）。
- **`entry.js`** — **前端 minigame 入口脚本**，被宿主 `getAsset` 取出通过 iframe 加载（或被前端 Vue/App 引用），是玩家在浏览器里实际看到的游戏代码。

设计文档原始表述（[`插件设计.md` § 2.1 22-24](../../../../toonflow-game-app/md/curr_design/插件设计/插件设计.md#21-目录结构)）：

```
toonflow-field-survival/
├── manifest.json
├── entry.js          # 前端入口脚本（minigame 插件必须）
├── entry.ts          # 后端 TypeScript 入口（编译为 entry.js）
├── ui/game.html      # 小游戏 HTML（iframe 加载）
└── ...
```

第 7.2 节的 entry.js 示例是**纯 JavaScript class**（`class GuessNumberGame`），**没用 TypeScript**——印证了"前端入口用 JS 写"的设计意图。

后端 PluginExecutor（[代码](file:///D:/Users/viaco/tools/Toonflow-game/toonflow-game-app/src/lib/PluginExecutor.ts)）loadEntryModule 优先尝试 `.js`、回退到 `.ts`（line 188-199），其注释明确写：

```
// 优先 .js（编译产物），其次 .ts（运行时支持）
```

——这里**已经在混淆**：它说 `.js` 是"编译产物"，但设计上 `.js` 是"前端入口"。

## 实际演化（以 toonflow-field-survival 为例）

toonflow-field-survival 是"野外生存"插件，开发中发生了**约定漂移**：

| 实际表现 | 体现 |
|---|---|
| 游戏核心逻辑全在 `entry.ts`（TypeScript 编写，3624 行） | 后端"打怪掉血"+前端 Vue `App.vue` 通过 `toonflowJsApi` 调到 entry.js 的逻辑全集中在此 |
| `entry.js` 与 `entry.ts` **行数不等、内容不同**（2838 vs 3624 行） | 独立手写的两份，不是编译关系 |
| `entry.js` 主要函数（`buildStoryDigest`、`ensureMapData` 等）**没有任何代码引用它** | 实际运行时是"死代码" |
| 前端实际跑的是 `ui/game.html`（vite build 把 `vue/src/App.vue` 等打包内联进去） | 前端根本不读 entry.js |
| 后端 60002 `PluginExecutor.loadEntryModule` 读 entry.js 来 import `handle_action` | **后端也不读 entry.ts**——tsx loader 没用上 |

**约定的无声漂移路径**：
1. AI 助手接到"实现野外生存"任务时，把核心游戏逻辑（战斗 AI、随机生成、战利品计算等）写在 `entry.ts`——这是宿主能直接通过 tsx loader 跑的格式。
2. vite build 把 `vue/src/App.vue` 整体打包成内联 JS 进 `ui/game.html`——**游戏 UI/交互/渲染都跑在 game.html 里**。
3. 开发者为了兼容 PluginExecutor（按 manifest 找 `entry.js` 加载），用 esbuild 把 entry.ts **同时编译成 entry.js**——但 vite build 用的不是这个 entry.js，game.html 里有内联的等价代码。
4. entry.js 因此变成"满足 PluginExecutor 加载契约"和"作为 esbuild 编译产物"两重身份的产物，但**真正被 import 跑的就是后端这条**。
5. CLI 安装时 `python -m toon_plugins plugins -i xxx` 会把整个插件目录打成 zip（包含 entry.js 和 entry.ts），后端解压后照常通过 `loadEntryModule` 跑 entry.js。

**结果**：entry.js 既**碰巧是后端运行时需要的产物**（这点跟原设计一致），又**碰巧看起来像 entry.ts 的编译产物**（其实行数都不一样），但**前端根本不读它**——前端 minigame 入口在 ui/game.html 内联的 vite bundle 里。

`entry.js` 上游备份命名（`entry.js.bak_20261005`、`entry.js.bak_before_tsc_20261006_1830`、`entry.js.new`）证实历史上**至少多次手工编辑过 entry.js 而不是只跑 tsc/esbuild**——这是 entry.js 失守的另一证据。

## 为什么"设计初衷"和"实际现状"在文档层面被混淆

`插件设计.md` 同一份文档内**自相矛盾**：
- § 2.1（22-24 行）：把 entry.js 写为"前端入口脚本"（设计原意），entry.ts 是"后端 TS 入口"
- § 4（172-173 行）：写 `entry.js ← tsc 编译产物`、`entry.ts ← 插件源码（TypeScript）`（混淆后的事实）
- § 5.1（448 行附近）："动态 import() entry.js（file:// URL，ESM，模块缓存）"——只字未提 entry.ts
- § 6.1（492 行附近）："优先 .js（编译产物），其次 .ts（运行时支持）"——`entry.ts` 退化为"应急 fallback"

**根因**：`entry.js` 既是设计原意的"前端入口"、又是事实上的"后端 import 目标"、还是 esbuild 的"编译产物"——**三个角色同一个文件**。toonflow-field-survival 实际跑通了"前端用 game.html + 后端用 entry.js（从 entry.ts 编译）"这条路，**但本质上只用到了其中两个角色（后端 import + 编译产物），前端那个角色空转**。AI 在实现时观察到这个表面模式，**把"前端入口"角色剥离**到 game.html，然后**把剩下的两个角色写进文档**——`entry.js` = 编译产物，`entry.ts` = 源码。

**`entry.ts` 兼三职的真相**：
- **真正的源码**（用 TS 类型、前后端共享业务规则）
- **后端运行时直接 import 的模块**（但运行时**不**直接 import .ts——它 import .js，由 esbuild 现编的 .js）
- **前端"占位"**——前端根本不用它，但 manifest 仍然把它声明为后端入口

## 现状与建议

**当前能工作是因为**：
- 5175 宿主加载 `ui/game.html`（内联 vite bundle）→ 前端游戏
- 60002 后端 `loadEntryModule("entry.js")` → 拿到 esbuild 编译出的 `handle_action` → 处理 /plugin/tick
- 两条链路是**独立**的，entry.js 只服务于后端

**潜在风险**：
1. esbuild 必须现编 entry.js 才能跑，但仓库里 entry.js 是手写版本——一旦有 AI 改 entry.ts 不重编译，**前端仍然用 game.html 跑（不受影响）**，但**后端会跑老 entry.js**——出现"前端行为正确 / 后端行为错乱"的诡异 bug
2. entry.js 与 entry.ts 内容已经漂移（行数差 786 行），谁也不知道改 entry.ts 的人同步没同步 entry.js
3. `entry.js.bak_*` / `entry.js.new` 这些备份名说明历史上手工直接编辑过 entry.js，**回滚时连带的 entry.ts 改动会丢失**

**建议（按改动量排序）**：

1. **在仓库 README 显式写明"双入口分离 + 编译关系"**——把现状文档化，避免下一个 AI 再误解。当前文档（`插件的拟真安装一致性问题.md`）的描述是对的但过于技术化。
2. **加一个 `sync-entry` 脚本**（参见 `插件的拟真安装一致性问题.md` § 解决方向 ①）：`esbuild entry.ts → entry.js` + 拷贝到安装副本 + 提示重启 60002。
3. **PluginExecutor 加缓存失效入口**：`clearEntryCache` API，按 pluginDir 清 entryModuleCache，命中文件 mtime 变化时自动 reload（参见同文档 § 3）。
4. **长期**：要么把 entry.js 改成"esbuild 唯一编译产物，不允许手编辑"（git hook 检查 entry.js 是否由 entry.ts 编译而来），要么把后端 import 改成读 entry.ts（tsx loader 路径）——消灭"双身份同一个文件"的歧义。