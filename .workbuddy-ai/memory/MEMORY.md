# Toonflow game-plugins 项目长期记忆

## 改插件的三步收尾（务必都做）
1. `plugins/toonflow-field-survival/vue` 下 `npm run build` → 产出 `../ui/game.html`
2. `entry.ts` 用 esbuild 编成 `entry.js`（ESM 单文件，无 import / `import.meta`）
3. 把 `entry.js` 与 `ui/game.html` 同步到两份 installed 副本：
   - `toonflow-app-run-db/plugins/1/com.toonflow.minigame-field-survival/`
   - `toonflow-game-app/Toonflow-game/plugins/1/com.toonflow.minigame-field-survival/`
   校验方式：`md5sum` 三方一致。**真宿主**后端影子模块按 `<pluginKey>.<mtime>.mjs` 热重载，
   不用重启；**dev-host（`--conn`）例外：`loadEntryModule()` 里 `if (entryMod) return entryMod;`
   进程内永久缓存 entry.js，改了 entry.ts 必须重启 dev-server**。
   前端 src（含 eventScripts / mockHost）走 vite HMR，刷新页面即可；vite.config.ts 要重启。

## vite.config.ts 反引号陷阱（2026-10-17 踩过）
`vue/vite.config.ts` 在 207→1572 行之间有一个超长 HTML 模板字符串
`const PAGE = \`<!doctype html>…\``。在这个区间写注释/代码**任何反引号都会把模板提前闭合**，
esbuild 报的错误位置是「下一个反引号之后」，极具误导性（如 `Expected ";" but found "python"`）。
排查：`grep -n '`' vite.config.ts`，207 之前和 1572 之后应各有一个，中间必须是 0 个。

## dev-host 拟真宿主桩（`--conn` 模式）与真宿主的差异点
真宿主机由 CLI `python -m toon_plugins plugin_session_data -u … -story …` 把
`map_visual:<story>`（sessionId="all"）写进 `t_plugin_session_data`；dev-host 桩**不会**，需要
`seedStoryVisualMap()` 从 `/story-data/toonflow-field-survival/map_design/<STORY>.tbg` 主动播种。
entry.js 侧 `ensureStoryVisualMap()` 依赖 3 个前提，缺一个就静默退化到「只有当前关」：
`ctx.worldName` 非空、`tsApi.pluginData.getTemplate` 存在、模板里确有 `map_visual:<story>`。

## 地图数据三条链
- `storyMap.ts`（前端）：`getTemplate("map_visual:<story>")` → 退路 `get("map_visual")`
  → `normalizeBundle`（`format==="tbg"` 走 `zipTbg.tbgToVisFiles(base64)`，跳过 `bak/` 与 `test_data/`）
- `mapConfig.ts`：`listLevelNames()` 优先 `getStoryLevelNames()`（=bundle.mapFiles），兜底 `LEVEL_FILES`（已清空）
- `entry.ts`：`ensureStoryVisualMap()` 把模板注入本会话 `map_visual`，并透出 `worldName`/`worldId` 到 state 顶层
- `reportLevels()` 兜底**只能报当前关**，绝不能拼 `sysMapNodes`（后端回显 → 回声环，地图面板出现一排同名关卡）

## 插件里「参数卡是唯一权威源」
`s.items` / `s.skills` 全部由 `buildItems/buildSkills(playerCard)` 重建；排序类需求（背包/技能 ↑↓）
要落到 `patchCard` 改参数卡，再靠 `s.skillOrder` + `persistSys`/`restoreSys` 在断线重连时还原。

## story-data 中间件必须区分文本/二进制
`vite.config.ts` 的 `/story-data` 中间件默认 `readFileSync(...,"utf-8")` + `application/json`，
对 `.tbg`（zip）会损坏字节。已加二进制分支（octet-stream 原样回），新增加静态资源类型时记得同步。

## map-editor 的 AI 模型配置（复刻 toonflow-game-app 的 t_config 方案）
- 配置存**后端 SQLite**（`map-editor/backend/ai_store.py` → 本地 `ai_models.db`），字段对齐 app 的 t_config；不再是 localStorage。
- 适配器在 `map-editor/backend/ai_clients.py`：镜像 app 的 u.ai.image/u.ai.text——openai/other(gpt-image-1+参考图走 /images/edits)、volcengine(Ark)、gemini(responseModalities IMAGE)、siliconflow(/v1/images/generations)；尺寸 1K/2K/4K=1024²/2048²/4096²；统一返回 base64 data URI。
- 路由 `/api/ai/{models,bindings,test}` 对齐 app 的 /setting/* 与 /other/testImage。
- 贴图替换的模型绑定槽位 key = `textureReplaceModel`；`tile_style_change/routes.py` 的 `generate_tile` 优先用请求 config，否则解析该槽位（复刻 app getPromptAi）。
- 前端设置弹窗 `ModelSettingsModal.vue`：type×manufacturer×model×baseUrl×apiKey（text 额外推理参数）+ 模型列表增删改 + 槽位绑定 + 测试连通。
- 快捷键（**必须对齐地图编辑器真实交互，别只翻 onKeyDown**）：编辑器鼠标约定——
  中键/【Ctrl+左键】=平移地图、`Alt+左键`(select工具)=移动对象、`T`切换坐标模式后左键查 (tile,world) xy、滚轮=缩放、
  `Shift+左键`(draw/erase)=笔刷连刷。贴图替换模式 TilesetWorkspace 复用同一套：左键单选 / Shift+左键拖动框选多格（tileset 语义，地图里本无框选）/ Ctrl+左键拖动平移 / 中键拖动·滚轮缩放 / T 切换坐标查看。tileStyleMode 下 App 的 onKeyDown 抑制画布工具键，仅保留 Ctrl+S 与 Esc；方向键/R/+- 作为次要键盘导航（输入框聚焦时让行）。

## 地图名有三套写法，切图只认 mapFiles key
① 关卡 key `mulberryDungeon1`（= bundle.mapFiles 的 key，唯一能喂 `switchLevel`）
② 归一的英文名 `Mulberry Dungeon`（`normQuestMap` 产物，层号可能丢）
③ 中文显示名 `冥夜走廊·一层`（Tiled `name` / 地图面板展示）
跨图寻路一律先过 `levelKeyOf()`（前端）/ `rawQuestMapKey()`（后端）再切图。
**`toLowerCase().replace(/[^0-9a-z]/g,"")` 对纯中文名返回空串** —— 用它做前缀匹配会恒真、
做相等比较会把「桑镇」「桑林」判成同图，两处都必须 `if (!compact) return 原值`。

## 坐标是「1 米/格、以图心为原点」
`metersToCell`：`gx = floor(x + cols/2)`。桑镇 43×56 → x∈[-21.5,21.5] / y∈[-28,28]；
森林 60×40 → x∈[-30,30] / y∈[-20,20]；冥夜走廊一层 31×23 → ±15.5 / ±11.5。
任务坐标写超了不会报错，只会「寻路后原地不动」——查任务数据时先按这个范围卡一遍。

## canvas 切换显示必须用 v-show，不能用 v-if（2026-10-22 踩过）
map-editor `App.vue` 里 canvas 的 2d context 是**模块级缓存**（`let ctx=null`，`render()` 里
`if(!ctx) ctx=canvasRef.getContext('2d')`）。中间区 canvas 与 TilesetWorkspace 切换时若用 `v-if`
销毁重建 canvas，`ctx` 会永久指向旧的已销毁 canvas → 退出后黑屏、点击无反应、任何 `render()` 都无效，
只能刷新页面。凡是持有「模块级缓存 context/实例」的 canvas/图表 DOM，切换显示一律用 `v-show` 常驻 DOM。

## 处理问题的方式
- 表查询出错的第一件事应该是去看看这个表的结构
- 看到一个报错或者问题应该去看看根源问题是什么。而不是暴力解决
- 看不到日志不要想当然日志没有开debug, 更不要去掉DebugLogUtil.isDebugLogEnabled() 的判断！！！
## 一个非常重点的事情-ai agent
这个项目实际是更多是个ai agent 项目，所以尽量不要写硬编码。
用ai agent 去实现各种功能！！！！

## 任务状态
[]:未开始 [suc]:已检查没有问题, [skip]:暂时跳过, [wait]:待检查,[ing] 实现中或处理中或修复中
[fail]:检查不通过，[check]:正在检测中

## 不允许随意放置测试和临时文档
测试脚本和文档和临时文档
只允许放置在.cache 文件夹下。

# vite.config.ts
要不让vite.config.ts 支持 \n 要不就不要写\n 