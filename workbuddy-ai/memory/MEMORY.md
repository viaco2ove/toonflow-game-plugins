# Toonflow game-plugins 项目长期记忆

> 只留跨天有效的**规则型**结论；细节见 `.workbuddy-ai/memory/YYYY-MM-DD.md` 日日志。
> ★ 本文件有注入体积上限。2026-10-30~11-06 各次修复的完整原文、浏览器 E2E / map-editor / tiles-maps-editor 要点，已整体归档到 **`MEMORY-APPENDIX.md`**（末章「历史详情归档」），需要明细时按需查阅。

## 用户约定与偏好
- 本项目本质是 ai agent 项目：尽量不写硬编码，用 ai agent 实现功能。
- 报错先找根源不暴力解决；看不到日志别想当然没开 debug，勿删 `DebugLogUtil.isDebugLogEnabled()`。
- 测试脚本/临时文档只放 `.cache/`。任务状态标记：`[]`/`[suc]`/`[skip]`/`[wait]`/`[ing]`/`[fail]`/`[check]`。
- 换行符：git 存 LF、工作区 CRLF。Write 工具写 LF → `git diff` 全文件变但内容一致，**改完必须 python 转回 CRLF**。

## 构建部署：唯一入口
```bash
python -m toon_plugins plugins -i toonflow-field-survival   # build vue + 重编 entry.js + 打 tpg 上传
```
- ⚠️ **禁止手跑 esbuild、手拷 `entry.js` / `ui/game.html`**（规范 §8.2）：手编会造出「比源更新的产物」，下次 CLI 重编即覆盖且差异不可追溯。验证前端可跑 `npm run build`（check:page + vite build + rename 到 `ui/game.html`）；**裸 `npx vite build` 只产出 `ui/index.html`**，会留下与 game.html 不一致的产物。
- 产物约束：必须 `--bundle`（缺则安卓开局超时）、ESM 单文件、中文转义成 `\uXXXX`；`entry.js` 必须 ESM 导出（宿主走 `import()`）。改 game.html 后必须刷新页面（iframe 不热重载）。
- **dev-host（`--conn`）进程内永久缓存 entry.js**（`loadEntryModule` 的 `if (entryMod) return`）→ 改 `entry.ts` 必须重启 dev-server；前端 src 走 vite HMR 不用重启；改 `vite.config.ts` 也必须重启 vite。

## Vue / Vite 陷阱
- **白屏先查 `public/index.html` 覆盖**：public/ 同名文件覆盖根 index.html（遗留 Rotten Soup 模板无 script → dev 白屏零报错，已改名 `rotten-soup.html`）；`viteSingleFile()` 只 production 启用。判别：curl `/index.html` 看有无 `<script type="module" src="/src/main.ts">`。
- ★ **SFC 模板插新 `v-if` 块**：别插在自闭合组件标签紧后面 —— 该位置元素可能不归入根作用域，引用的 ref/函数不进 `__returned__` → `$setup.xxx` 恒 undefined → `v-if` 永远 false 且零报错。**排查铁律**：起 vite dev，curl `/src/panels/Xxx.vue` 搜 `__returned__ = {` 与 `$setup.xxx`；production build 会 minify 掉这些名字，验不出来。
- `setupState` 代理读 ref 是解包的，写它 = 写 ref.value，可用于 E2E 注入。
- ★ **「可拖拽 header 里的按钮点了没反应」= setPointerCapture 吞掉 click**：祖先在 pointerdown 里 `setPointerCapture` → pointerup 被重定向 → 不在按钮上合成 click。修法：按钮 `@pointerdown.stop` + 拖拽启动时 `closest("button, a, input, select, textarea")` 排除。
- ★ `<script setup>` 里不能写 `export function`（esbuild 报错），类型导出可以；**重复 export 会挂构建**。
- ★ 只写 `overflow-y: auto` 时 `overflow-x` 会被算成 `auto` → 出横向滚动条，要裁必须显式 `overflow-x: hidden`。⚠️ emoji 不一定有字形，图标按钮优先文字或 SVG。
- ★ `vue/tsconfig.json`（`strict:false`）是后补的，既有类型错误有基线，用 `git stash` 对比**净增减**；默认参数类型会被推成字面量（`f(delay = X)` → 传 0 报 TS2345），要显式写 `: number`。
- 离线测 TS 模块：esbuild 打包 + plugin 把 `../toonflowJsApi` 换桩；bundle 会内联该模块，mock 必须走 `postMessage` 链路。参考 `vue/scripts/test-sms-store.mjs`。

## vite.config.ts 的 PAGE 模板字符串
`const PAGE = \`…\`` 是整块 JS 模板字符串：① 反引号会提前闭合；② **单反斜杠被直接丢弃**（`\/`→裸 `/` 让正则提前闭合→SyntaxError 白屏；`\s`/`\d`→裸字母静默失配）；③ `${}` 插值内是真 TS。修法：正则反斜杠双写或改 `new RegExp("...")`。
- 永久门禁 `vue/scripts/check-page-template.mjs`（`npm run check:page`，已挂 build 前置），改 PAGE 必跑。
- 浏览器报 `localhost/:1536` 的数字是渲染后 JS 行号不是端口；dev-host 实际 3000 端口。

## ★ 地图集是数据，前端代码表全局共享
`map_design/<故事>/` 只是数据目录；`mapConfig.ts`/`mockHost.ts`/`entry.ts` 的表被所有故事共用。
- 禁止往 `QUEST_MAP_SLUGS`/`MAP_MOB_LEVEL_RANGE` 加某故事专属显示名映射（slug 跨故事共享，重复 key 会打坏别的故事），显示名写地图 JSON 顶层 `name`。表「只增不删」但追加前必查重（esbuild Duplicate key）。
- `THEME_BY_MAPNAME`/`currentTheme()` 查表 key 是**关卡 key（slug）**不是显示名；`dungeon_themes` 四槽位名 `RUINS/CATACOMBS/MINE/ICE` 不能改。
- 地图名三套写法（关卡 key / 归一英文名 / 中文显示名）；`toLowerCase().replace(/[^0-9a-z]/g,"")` 对纯中文返回空串 → 要 `if (!compact) return 原值`。
- 坐标 1 米/格、以图心为原点（`gx=floor(x+cols/2)`），写超不报错只「寻路后原地不动」；teleport 指向不存在关卡静默失败。`maps/first.map.json` 的 `start_map.value` 写关卡 key。
- ⚠️ 改故事目录内容后必须 `python -m toon_plugins plugin_session_data -i … -build <故事目录>`，否则安装态读不到（dev 由 vite 中间件自动重打）。

## ★ 事件系统 ctx API
三层：声明层 `events/maps/<map>.events.json` / 脚本层 `events/scripts/*.ts` / 数据层 `<故事>/data/*.json`。
- trigger 声明 10 种**实现 5 种**（`enter_map`/`interact`/`proximity`/`area_enter`/`interval`）；condition 4 种**实现 1 种**（`flag_check`）；action 里 `call_action` ❌ 未实现、`llm_speak` ⚠️ 占位返回空串、`run_script.args` 已透传。
- `validate_events.mjs` 的 CTX_API **只查名字在不在表里，不查有没有真效果 → 校验通过 ≠ 可用**；白名单里混着空实现：`npc.setLabel/move/faceTo`、`audio.play`、`llm.speak`、`registerAction`。
- `ctx.cmd` **不等后端回执**（要结果须前端 `forgeOps.ts` 的 `sendSysCmdAwait`）；`ctx.player` 是快照，改实体只能 `ctx.npc.setField`。
- `proximity`：半径 `max(0.8, radius||2.8)`；按 uid 找 `mapnpc_<uid>[_*]`/`mapmob_<uid>[_*]`；半径内最近者胜；`alive===false` 跳过；挂 proximity 的 uid 被排除出「💬 聊天」→ 一个 uid 只能一种入口；`repeat` 硬编码 3s 冷却且条件不满足也进冷却；无 `maxUses`/动态 label。
- 已补齐通用能力：`ctx.ui.notice({title,detail?,confirmText?})`（Promise 模态，AI 执行者自动跳过）、`ctx.event={id,uid?,args}`（uid 仅 interact/proximity 有，args 非对象归一 {}）、`ctx.playerCard`（只读快照）。三者已进 CTX_API 白名单。
- **业务数据必须走 `ctx.story.readJson("data/x.json")`**；`import` 数据会被编进 `ui/game.html` = 头号严重违规。
- ⚠️ 事件 JSON 三份副本会悄悄落后正本：跑 `.cache/validate_events.mjs <故事>` 看「源与副本不一致」，同步 `vue/public/events/maps` + `ui/events/maps`（全故事共享，同时只放一个故事）；`_ctx.ts` 四份副本 md5 必须一致。

## ★ dev 免安装调试地图集
- 「全部地图」只显示当前关 = 磁盘缺 `<故事>.tbg`（`seedStoryVisualMap()` 只认磁盘 .tbg → `bundle=null`）。修法：`vite.config.ts` storyData 中间件 `ensureTbgBuilt()`（零依赖手写 zip），判断必须在 `existsSync(filePath)` **之前**。
- `/story-data` 中间件 `.tbg` 走二进制分支（utf-8 读会损坏 zip）；`s.items`/`s.skills` 由 buildItems/buildSkills 重建；`reportLevels()` 兜底只报当前关，**绝不能拼 `sysMapNodes`**（回声环 → 一排同名关卡）。
- dev 调试不需要安装：`npm run debug -- --story <故事名> --conn`。

## 瓦片/贴图 / 实体外观（数值明细见 APPENDIX 归档原文）
- **改地图前先跑认知技能** `.workbuddy-ai/skills/cognitive-tiles-maps`（`ctm.py <路径>`）：整图渲染 + 逐格材质图 + 候选拼图。
- 图集 `category` 标签不可信 → 判材质用**像素颜色**（`--min-uniform 0.6` 找路面/墙面）；**禁止靠 gid 猜长相**：算法筛候选 → 裁图目视 → 再落子。真路面组 7029/7049/12440/12447（深灰水泥）、7148/7168/10031/12087（灰蓝石板）、7033/7053（橄榄土面）。
- 新瓦片只落图集内连续全透明空白格且 id < tilecount(13080)，写入前断言 alpha 全 0；32×32 贴图必须程序化生成。**PIL paste 是 alpha 混合不是替换**（整格替换须 `crop`→`alpha_composite`→不带 mask `paste`）；多层地图每层透明底再 composite。兜底 png 放 `vue/public/images/`（禁放 `src/assets/images/`）。
- 外观由 **`object.gid`** 决定（`entity_type` 只定行为）：`obj.gid` → `normalizeTiledMap` → `entity.gid` → `drawEntity` 的 `walkTileId(gid-1)`（第二帧读 `animated_id`）。⚠️ gid 是对象顶层字段、不在 properties 里，编辑器改它不能走 `setProp`；`gid=0` 回退按类型默认。
- 编辑器 `/api/collections/{name}/dawnlike` 会丢掉无 description 的 tile（人物动画帧恰好无）→ 另建 `/sprites`（有动画或有 description 才可当形象，`animated_id < id` 跳过）。缩略图 canvas 裁图集放大（`imageSmoothingEnabled=false`），`col=tileId%120, row=floor(tileId/120)`。

## AI 托管 / 短信 / 网络（详情见 APPENDIX）
- 链路：`brain.ts` → `sys_brain` → `ctx.tsApi.agent.run("field-survival-ai-brain")` → `s.chatResult{reqId,ok,text}` → persistSys。**异常也必须写回包**，否则前端永久 pending；`chatResult` 单槽位 → `brainBusy` 闸门 + 8s 超时。
- ★ `callBrain()` 有**三个**调用点（调度器 / `#ai` 指令 / 短信回复），消费 brain 产出的逻辑必须接全部三个。★ **prompt 契约双份**（`src/agents/plugins.prompts.ts` 静态 + `vue/src/ai/brain.ts` 动态），改输出字段两边同时改。
- 短信唯一数据源 `vue/src/sms/store.ts`（`sessionId="all"` + `dataKey="sms_conversations:<story>"`）；**先判冷却再建会话**；未读数／「★ 未回复」是派生状态（`lastReadMsgId=null` 时 findIndex 返回 -1 必须 `+1`）。★★ **被动回复不需要托管**（`allowUnmanaged`），AI 托管只管主动决策；心跳兜底 30s 防抖 + `brainReplyInflight` 防重入。
- 诊断 `brain_diag` pluginData + 宿主 `logs/app-*.log`（`action=sys_brain`）；sys 持久化 key `sys_state`、chatResult 在 `plugin_state`。**standalone 无 LLM 通道 → AI 必然不回，属预期**。网络已收口：plugin_state 2s 节流、帧 tick 无变化回 `state=null`、活跃 10Hz/停手 1Hz、`sys_` 慢锁、回合制 `interaction=turn-based` 不发 tick。自测 `test-sms-*.mjs`(34/26/20)。

## ★ 主线任务链（2026-11-08 落地）
- **故事包负责业务**（`events/任务事件/main-quests.json`：10 链 34 节点、onSuccess/onFail/lockedBy/side），**插件负责通用机制**（链状态机、暂停继续、超时/放弃失败、分支选择、持久化、UI）；插件不硬编码剧情文案。
- 链节点通过 `from: "chain:<chainId>:<nodeId>"` 注入既有委托系统 → 复用 `questGoToDest` 寻路；`buildQuestView` 输出 `from/isChain/chainId`（系统「任务」页据此显示金色「★ 主线」徽章），`buildChainView` 输出 `questId/destX/destY/destMapRaw/objectives`（主线页据此显示「🧭 寻路」）。
- 链状态 `locked|available|running|awaiting_choice|failed|completed`；每条链同一时间最多一个 active/paused 节点；单后继自动推进、多后继 awaiting_choice；**平行分支走完任一路径终点即完成链**；`onFail` 目标识别为失败分支。
- 命令族 `sys_chain_pool/board/start/choose/node_accept/turnin/pause/resume/abandon/retry`；链节点过滤出普通委托「可接」页但保留在「进行中」页。
- Mermaid 图由 JSON 生成器 `生成主线任务图.py` 产出（章节子图纵向、章内横向，跨章用子图到子图连线，终点标签写「🔓 解锁 X」）；`--render` 出 png/svg。
- ★ **刷新后主线页空白 / 「🧭 寻路」全消失 = `ensureChainDefs()` 守卫写错**：`chainState` 随 `sys_state` 存档恢复，`chainBoard` 是**运行时字段、不进存档**；拿 `chainState` 非空当「链定义已载入」→ 刷新后永不重载 → `sys_chain_*` 全回「没有这条主线」。守卫只能看 `chainBoard`。⚠️ 改 `entry.ts` 后 `npm run build` **不重编** `entry.js`，须重启 dev-host（configure 钩子会现编 `entry.ts → entry.js`），否则真机仍跑旧入口。
- ★ 纯 talk 任务也能寻路：`App.vue` 的 `talkNavTargets` 按数据解析 NPC（当前图实体优先 → 故事地图包 `maps/*.json` 的 objectgroup，Tiled 坐标换算 `x/32-W/2`、`y/32-1-H/2`），`QuestPanel`/`QuestLogPanel` 用 `navTargets[questId]` 决定按钮；禁止硬编码 NPC 坐标。跨图时 tooltip「将先传送」是对的，别误改比较口径。
- 回归：`node plugins/toonflow-field-survival/test-host/chain-engine.test.mjs`（70 项：链引擎 51 + 主线标识/寻路 16 + 刷新重载守卫 3）。

## 野怪/战斗 / 锻造 / 假人（详情见 APPENDIX）
- 兜底刷怪守卫 `mobs.length>0` 必须按**非假人**过滤；给集合加新成员要 grep 所有 `.length` 消费点。野怪 id：`zone_*`（区域）/`localmob_*`（兜底）/`mapmob_<uid>_*`（Tiled 对象）。
- UI 层级：`.ev-confirm-overlay` 10000 / `.hud-toast` 10001 / 面板 ≤9998（改完跑 `vue/scripts/check-zindex.mjs`）；画布层序 迷雾→实体→VFX→血条/飘字，VFX 要 `VFX_ALPHA_SCALE=0.45` **逐特效**套（外层 `globalAlpha` 会被内部绝对赋值覆盖）。
- **四处同步**：`entry.ts` / `vite.config.ts` 内嵌 dev-host stub / `mockHost.ts` / `vue/src`；mockHost **不回推 `state.response`**，await 分支要显式赋值。`showToast(msg, ms)` 第二参是**毫秒**不是颜色；反馈分级 toast 过程、`evNotice` 模态结果（判定用后端 response）。
- 宿主 epoch：实体集合变化必须 `bumpLocalMobsEpoch()`，bump 字段只留 side/dummyMode（hp/alive 宿主权威）。锻造商品数据属地图集，消耗类**只能后端扣一次**。假人：客户端权威 = side/dummyMode/位置/标签，宿主权威 = hp/alive/伤害/经验/掉落；stand 跟客户端、duel 跟宿主；`makeEntity` 重建丢自定义字段须显式透传；flagCache 需 1s TTL + 强制重读。测按 tick 计频率必须用**宿主 tick 差值**（iframe rAF 节流到 ~1Hz）。

## ★ 调试铁律（全文见 APPENDIX）
- **「点了没反应」先浏览器复现再改代码**；曾凭静态阅读误判 z-index，真根因是 color 被当 ms。
- 通道：iframe → `canvas.__vueParentComponent` 向上找根 → `root.setupState`（ref 可读写）；发命令 `parent.postMessage({type:'tf_plugin_tick',action,params},'*')`；读宿主 state 靠拦 iframe 的 `postMessage`。采样前先看 `phase`（玩家一死前端停发 tick → 窗口冻结成「AI 没动」），x/y 用 `hostDrives` 判定来源；canvas 文字只能截图目视；复活 `setupState.reviveGame()`；浏览器工具坑见 APPENDIX。
