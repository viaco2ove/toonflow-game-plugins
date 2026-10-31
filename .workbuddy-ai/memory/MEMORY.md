# Toonflow game-plugins 项目长期记忆

> 只留跨天有效的结论；细节见 `.workbuddy-ai/memory/YYYY-MM-DD.md` 日日志。
> ★ 本文件有注入体积上限，超出会被截断。溢出内容已拆到 **`.workbuddy-ai/memory/MEMORY-APPENDIX.md`**（做浏览器 E2E 调试 / 动 map-editor、tiles-maps-editor 前必读）。

## 用户约定与偏好
- 本项目本质是 ai agent 项目：尽量不写硬编码，用 ai agent 实现功能。
- 报错先找根源不暴力解决；看不到日志别想当然没开 debug，勿删 `DebugLogUtil.isDebugLogEnabled()`。
- 测试脚本/临时文档只放 `.cache/`。任务状态标记：`[]`/`[suc]`/`[skip]`/`[wait]`/`[ing]`/`[fail]`/`[check]`。
- 换行符：git 存 LF、工作区 CRLF。Write 工具写 LF → `git diff` 全文件变但内容一致，**改完必须 python 转回 CRLF**。

## 构建部署：唯一入口
```bash
python -m toon_plugins plugins -i toonflow-field-survival   # build vue + 重编 entry.js + 打 tpg 上传
```
- ⚠️ **禁止手跑 esbuild、手拷 `entry.js` / `ui/game.html`**（规范 §8.2）：手编会造出「比源更新的产物」，下次 CLI 重编即覆盖且差异不可追溯（踩过：`--format=iife` + 副本不一致 → 分类页全空）。
- 产物约束：必须 `--bundle`（缺则安卓开局超时）、ESM 单文件、中文转义成 `\uXXXX`（校验先 `src.encode().decode('unicode_escape')` 再 grep）。
- **dev-host（`--conn`）进程内永久缓存 entry.js**（`loadEntryModule` 的 `if (entryMod) return`）→ 改 `entry.ts` 必须重启 dev-server；前端 src 走 vite HMR 不用重启。

## Vue / Vite 陷阱
- **白屏先查 `public/index.html` 覆盖**：public/ 同名文件覆盖根 index.html（本项目遗留 Rotten Soup 模板无 script → dev 白屏零报错，已改名 `rotten-soup.html`）；`viteSingleFile()` 只 production 启用。判别：curl `/index.html` 看有无 `<script type="module" src="/src/main.ts">`。
- **SFC 模板插新 `v-if` 块**：别插在自闭合组件标签紧后面 —— 该位置元素可能不归入根作用域，引用的 ref 不进 `__returned__` → `$setup.xxx` 恒 undefined → `v-if` 永远 false 无报错。排查：fetch('/src/App.vue') 搜 `__returned__ = {`。
- `setupState` 代理读 ref 是解包的，写它 = 写 ref.value，可用于 E2E 注入。
- ★ **「可拖拽 header 里的按钮点了没反应」= setPointerCapture 吞掉 click**：祖先在 pointerdown 里 `setPointerCapture` → pointerup 被重定向 → 浏览器不在按钮上合成 click。中招需同时满足：① 祖先 setPointerCapture；② 按钮是其后代。修法（双保险）：按钮 `@pointerdown.stop` + 拖拽启动时 `closest("button, a, input, select, textarea")` 排除。已修 `.forge-panel__close`、`.sp-close`。
- ★ **`<script setup>` 里不能写 `export function`** → esbuild "cannot contain ES module exports"。类型导出可以：`export interface Foo {}` + `import type`。
- ★ **只写 `overflow-y: auto` 时 `overflow-x` 会被算成 `auto`** → 出横向滚动条；要裁必须显式 `overflow-x: hidden`。⚠️ emoji 不一定有字形（🗑 渲染成豆腐块），图标按钮优先文字或 SVG。
- ★ **工程原本没有 `tsconfig.json`** → 已补 `vue/tsconfig.json`（`strict:false`）。基线 128 个既有类型错误，用 `git stash` 对比**净增减**。
- 默认参数类型会被推成**字面量**：`function f(delay = SMS_LIMITS.X)` → `delay` 是 `1000` 而非 `number`，传 `0` 报 TS2345。显式写 `delay: number = ...`。**重复 export 会挂构建**。
- **离线测 TS 模块**：esbuild 打包 + plugin 把 `../toonflowJsApi` 换桩 + Node 补 `globalThis.window = { setTimeout, clearTimeout }`。参考 `vue/scripts/test-sms-store.mjs`。

## vite.config.ts 的 PAGE 模板字符串（三陷阱）
`const PAGE = \`…\`` 是整块 JS 模板字符串：① 反引号会提前闭合模板（esbuild 报错行号误导）；② **单反斜杠被直接丢弃**：`\/`→裸 `/` 让正则提前闭合→SyntaxError 整页白屏，`\s`/`\d`→裸字母则静默失配（零报错更难查）；③ `${}` 插值内是真 TS，规则不同别一起改。修法：正则反斜杠双写或改 `new RegExp("...")`。
- 永久门禁 `vue/scripts/check-page-template.mjs`（`npm run check:page`，已挂 build 前置），改 PAGE 必跑。
- 浏览器报 `localhost/:1536` 的数字是**渲染后 JS 行号**不是端口；dev-host 实际 3000 端口。

## ★ 地图集是数据，前端代码表全局共享
`map_design/<故事>/` 只是数据目录；`mapConfig.ts`/`mockHost.ts`/`entry.ts` 的表被所有故事共用。
- 禁止往 `QUEST_MAP_SLUGS`/`MAP_MOB_LEVEL_RANGE` 加「某故事专属显示名映射」：slug 跨故事共享，重复 key 后者覆盖前者会打坏别的故事。显示名写地图 JSON 顶层 `name`（`getLevelDisplayName` 优先读）。
- 表「只增不删」但追加前必查重（esbuild Duplicate key）。
- `THEME_BY_MAPNAME`/`currentTheme()` 查表 key 是**关卡 key（slug）**不是显示名；`dungeon_themes` 四槽位名 `RUINS/CATACOMBS/MINE/ICE` 不能改。
- 地图名三套写法：关卡 key（唯一能喂 switchLevel）/归一英文名/中文显示名。`toLowerCase().replace(/[^0-9a-z]/g,"")` 对纯中文名返回空串 → 前缀匹配恒真、相等比较误判，两处都要 `if (!compact) return 原值`。
- 坐标 1 米/格、以图心为原点（`gx=floor(x+cols/2)`），写超不报错只「寻路后原地不动」。teleport 指向不存在关卡静默失败。
- `maps/first.map.json` 的 `start_map.value` 写**关卡 key（slug）**最稳（写 "Lich Lair" 会落到 12×12 小图）。

## ★ 事件系统 ctx API
三层：声明层 `events/maps/<map>.events.json` / 脚本层 `events/scripts/*.ts`（`ctx`）/ 数据层 `<故事>/data/*.json`。
- trigger 声明 10 种**实现 5 种**：`enter_map`/`interact`/`proximity`/`area_enter`/`interval`；其余是死事件。
- condition 声明 4 种**实现 1 种**：`flag_check`（`eq`/`ne`/`exists`/`missing`），其余恒真通过。
- action 12 种：`call_action` ❌ 未实现（`registerAction` no-op）；`llm_speak` ⚠️ 占位返回空串；`run_script` 的 `args` 已透传 → `ctx.event.args`。
- ctx 空实现混在白名单里：`npc.setLabel/move/faceTo`、`audio.play`、`llm.speak`、`registerAction`。**`validate_events.mjs` 的 CTX_API 只查名字在不在表里，不查有没有真效果 → 校验通过 ≠ 功能可用。**
- `ctx.cmd` **不等后端回执**（立即 resolve 空串）；要结果必须前端实现（`forgeOps.ts` 的 `sendSysCmdAwait`）。
- `proximity` 运行时：半径 `Math.max(0.8, radius||2.8)`；按 uid 找 `mapnpc_<uid>[_*]`/`mapmob_<uid>[_*]`；半径内**最近者**胜；`alive===false` 跳过；挂 proximity 的 uid 被 `eventUidsHas` 排除出「💬 聊天」→ **一个 uid 只能一种入口**；`repeat` 硬编码 3 秒冷却且**条件不满足也进冷却**。
- ★ **已补齐的通用能力**（2026-10-28 P0，随 v1.0.25；纯通用，不含业务语义）：
  - `ctx.ui.notice({title, detail?, confirmText?})` → Promise 模态弹窗（必须点确认）；**AI 执行者自动跳过**。用于「不能只用 toast（会飘走）」的结果反馈。
  - `ctx.event = { id, uid?, args }`：`uid`=触发实体（Tiled 对象 id，**仅 interact/proximity 有**）；`args`=run_script 透传（**非对象归一为 {}**）。→ 地图集侧**不再需要「找最近实体」猜目标**。已落地 E70 假人（`findTriggeredDummy(ctx)` 读 `ctx.event?.uid` → `ctx.npc.byUid`，uid 空才回退「找最近」）：同类对象挨近不选错、**新增同类对象只加事件不改脚本**。
  - `ctx.playerCard = { level, money, hp, maxHp }` → 只读快照（AI 拿到的也是玩家卡）；取不到时全 0/1。改数值仍要 `ctx.cmd`/`ctx.save`。
  - 三者已进 `validate_events.mjs` 的 CTX_API 白名单。
- ★ **剩余缺口**（改插件优先补）：① `proximity` 无 `maxUses`/动态 label；② `ctx.player` 是快照，改实体只能 `ctx.npc.setField`；③ `ctx.cmd` 不等回执；④ 空实现未标 `@deprecated`。
- 业务数据必须走 `ctx.story.readJson("data/x.json")`（按 path 缓存一局；安装态读 `.tbg`）；**`import` 数据会被编进 `ui/game.html`** = 头号严重违规。
- ⚠️ 事件 JSON 三份副本会悄悄落后正本（曾 8 条 vs 13 条）：跑 `.cache/validate_events.mjs <故事>` 看「源与副本不一致」⚠，同步 `vue/public/events/maps` + `ui/events/maps`（这两目录**全故事共享**，同时只放一个故事）。
- `_ctx.ts` 四份副本（插件侧 + 三故事 shared）必须 md5 一致，改接口先统一再改签名。
- ⚠️ 改故事目录内容后必须 `python -m toon_plugins plugin_session_data -i … -build <故事目录>`，否则安装态读不到（dev 由 vite 中间件自动重打）。

## ★ dev 免安装调试地图集
- **地图面板「全部地图」只显示当前关 = 磁盘缺 `<故事>.tbg`**：dev-host `seedStoryVisualMap()` 只认磁盘 .tbg → 目录形态播种失败 → `bundle=null` → `listLevelNames()` 空。
- 修法：`vite.config.ts` storyData 中间件加 `ensureTbgBuilt()`（零依赖手写 zip：local header + 中央目录 + EOCD，deflate-raw 用 `node:zlib` + crc32 查表），规则同 `cli.py build_tbg_file`。无 .tbg → 写标准文件；有但源更新 → 写旁路 `.tbg.devcache`。⚠️ 判断必须在 `existsSync(filePath)` **之前**，否则旧 .tbg 永远命中。
- dev 调试不需要安装：`npm run debug -- --story <故事名> --conn`。
- `/story-data` 中间件 `.tbg` 走二进制分支（utf-8 读会损坏 zip）；`s.items`/`s.skills` 由 buildItems/buildSkills(playerCard) 重建；`reportLevels()` 兜底只能报当前关，**绝不能拼 `sysMapNodes`**（后端回显→回声环→地图面板一排同名关卡）。

## 瓦片/贴图硬规矩
- **改地图前先跑认知技能** `.workbuddy-ai/skills/cognitive-tiles-maps`（`ctm.py <路径>`）：整图渲染 + 逐格材质图 + 图集目录 + 候选拼图。**先看清再动手。**
- **图集 `category` 标签不可信**（L1 草地 1580 格全标 `building_wall`）→ 判材质用**像素颜色**（绿 g>+12→树/草；低饱和中性灰→石/木；暖色→木/土）。`avg_color` 也会误判；找路面/墙面加 `--min-uniform 0.6`（路面/墙 >0.6，家具/角色 <0.5），候选 60→6 全对。
- **禁止靠 gid 猜长相**（dawnlike 分区被打乱，9304/9305 像石板实则橙木地板）：算法筛候选 → 裁图目视 → 再落子。⚠️ 旧结论已推翻：「灰青砖在 5444~5574」是错的（那批是深底白字招牌）。真路面组：**7029/7049/12440/12447**（深灰水泥）、**7148/7168/10031/12087**（灰蓝石板）、7033/7053（橄榄土面）。
- 改造前先打印逐格材质图（W 墙/屋顶、f 家具、F 地板、T 树/草、. 空地、o 对象）；原型村庄建筑 L2 是实心屋顶（5610/5730/5850），改室内必须先清屋顶格；按 bbox 猜坐标必错。
- 新瓦片只落图集内连续全透明空白格且 id < tilecount(13080)，写入前断言 alpha 全 0。32×32 贴图必须程序化生成（AI 生图缩到 32px 全糊；原版每格仅 12~16 色）。
- **PIL paste 是 alpha 混合不是替换**：整格替换须 `crop`→`alpha_composite`→不带 mask `paste`；canvas 等价 clearRect+drawImage。渲染多层地图**每层必须透明底**再 composite。
- 每地图集一份 `images/compiled_tileset_32x32.png`；`resource_library/.../base/` 只读。运行时三级：dev 读盘/安装后 .tbg 内 png/兜底 `vue/public/images/`（**禁放 `src/assets/images/`**）。

## ★ 实体外观 = object.gid
- 外观由 `object.gid`（tileId+firstgid）决定，`entity_type` 只决定**行为类**。链路：`obj.gid` → `normalizeTiledMap` 提取 `npc.gid` → `injectMapNpcsToState` 写 `entity.gid` → `drawEntity` 走 `walkTileId(gid-1)`（第二帧读 `animated_id`，不是猜 +8）。
- ⚠️ **gid 是对象顶层字段，不在 properties 里** → 编辑器改它不能走 `setProp`；`gid=0` = 回退按类型默认形象。
- 编辑器 `/api/collections/{name}/dawnlike` **会丢掉全部无 description 的 tile**（3770 个），而人物动画帧恰好无 description → 另建 `/api/collections/{name}/sprites`（有动画或有 description 才是可当形象；`animated_id < id` 是别人动画第二帧要跳过）。黑塔实测 1119 character + 1165 prop。
- 缩略图 = canvas 裁图集 → 放大（`imageSmoothingEnabled=false`）→ toDataURL；坐标 `col=tileId%120, row=floor(tileId/120)`。

## AI 托管（toonflow-field-survival）
- 链路：`brain.ts` → `sendTick("sys_brain")` → `entry.ts case "sys_brain"` → `ctx.tsApi.agent.run("field-survival-ai-brain",…)` → `s.chatResult{reqId,ok,text}` → persistSys。systemPrompt 用 entry.ts 顶部常量（宿主 `promptHelper` 只查 `def.prompts.ts`）；**异常也必须写回包**，否则前端永久 pending。
- `chatResult` 单槽位 → `brainBusy` 闸门 + 超时 8s；`tickAllAIs` 两阶段：`evaluateBrainTrigger()` + `scheduler.ts`（inFlight 闸门/P0-P2/抖动错峰/预算/失败冷却 30s/3 连败熔断 2min）。
- 战斗判据是**玩家**不是 AI 自己（感知半径仅 13m）：`damage()` 唯一入口打点 → engaged(30s)/skirmish(20m 内活敌)/none 三态，边沿触发。⚠️ 第 4 参 attacker 曾有 3 处漏传（不传则状态机是死的）。
- 间隔可配（`ai/aiConfig.ts` 落 sessionId="all"）：默认 max 20s/min 5s/engaged 5s/skirmish 10s/idle 20s；用户配置优先于地图集覆写，HARD_CEIL 60s。紧急层 `checkEmergency()` 在调度器前，不受预算/熔断限制。
- 避障 `navStep()`（八向，AI_NAV_R=0.38，步长 TICK_DT_S）。测试基线：smoke-combat 11/11、smoke-aiconfig 48/48、smoke-entry 14 个既有失败。
- ★ `callBrain()` 有**三个**调用点（调度器 pump / `#ai` 指令 / 短信回复通道）——任何「消费 brain 产出」的逻辑必须接在**全部三个**上，只接 App.vue 会漏。短信分发因此独立成 `sms/dispatch.ts`（放 `ai/index.ts` 会循环依赖：index → chatCommand → index）。
- ★ **prompt 契约双份**：静态 systemPrompt 在 `src/agents/plugins.prompts.ts`，动态 userPrompt 在 `vue/src/ai/brain.ts` 的 `buildUserPrompt`。**改输出字段必须两边同时改** —— 曾因 systemPrompt 只写了 `action` 没写 `message`，LLM 永不输出短信字段（前端 parse 拿到 undefined，AI 永远不回消息）。

## 通信(短信)（2026-10-30 落地）
- 存储：`t_plugin_session_data`，`sessionId="all"` + `dataKey="sms_conversations:<story>"`（story=`state.worldName`）。**禁止裸 key + "all"**（跨故事覆盖）。旧存档回退读裸 key 并迁移。
- 唯一数据源在 `vue/src/sms/store.ts`；App.vue（系统按钮角标）与 SystemPanel.vue（tab 角标）都从 store 读，**不各维护一份**。
- 未读数 = `slice(startIdx).filter(m => m.from !== "player" && m.type !== "system").length`。⚠️ `lastReadMsgId=null` 时 `findIndex` 返回 -1 → 必须 `+1` 再 slice，否则玩家自己发的也算未读。
- 「★ 标记未回复」= **最后一条 AI 回复之后的所有玩家消息**（O(n)）。玩家连发 3 条 AI 一条没回 → 3 条都标 ★；AI 回一条 → 这批全算已回复。`awaitingReply` 是**派生状态**，每次改完消息重算。
- 判定顺序：**先判频率冷却再建会话**，否则被冷却挡掉却建出空会话。频率：单聊主动 60s/条、群聊 180s/条；**回复玩家不受限**（但刷新计时）。
- 玩家发短信 → `wakeAiForPlayerSms()` 走**独立 LLM 调用**（`keepAction:true` 只取 message，不打断当前动作），**不塞调度器 P0 队列**（队列有预算/熔断，战斗态还会筛掉离玩家远的角色）。抢不到闸门就重试（≤25s）。
- 区分「没拿到 LLM」vs「LLM 没说 message」：靠 `callBrainDetailed()` 的 `gotLLM`。前者**保留**待回复登记等下次心跳。`failReason="gate"` → 等 1.5s 重试；`"parse"` → 最多 3 次；`"emergency"` → 直接返回。
- 落库时机：新消息防抖 1s / 阅读状态防抖 500ms / 切图与 pagehide **强制同步写**。
- **standalone（mockHost）没有 LLM 通道**：`sys_brain` 立即回 `ok:false, error:"standalone 预览无 LLM 通道"` → AI 必然不回复，看到「等待对方回复…」不消失属预期，需 `--conn` 或安装后宿主验证。
- ★★ **产品语义（用户明确）：被动回复不需要托管**。玩家发短信 = 点名应答，未托管角色也必须回（`callBrainDetailed` 加 `allowUnmanaged` 选项绕过 `!aiState.enabled` 闸门；`replyToPlayerSms` 传 true）；**AI 托管只管主动决策**（自己寻路/战斗/主动发短信）。心跳兜底扫描（`tickAllAIs` 里 `listPendingReplyRoleIds`）处理「发消息瞬间不在场/闸门被占」的补回，与托管无关，**30s 防抖 + `brainReplyInflight` 防重入（首次直连调用也登记 inflight）**——防抖必须 ≥ 首次调用的 25s deadline，否则两路并发抢 chatResult 单槽位互相覆盖（实测首次被判 gate 白重试 3 次）。
- ★★ **dev-host 桩 `tsApi.agent.run` 曾漏 ai-brain 分支**（2026-10-31 修，vite.config.ts PAGE 模板内）：桩只处理了 speaker/quest/sprite/shop，`ai-brain` 落到末尾 throw → **localhost:3000 发短信永远不回**（但直调宿主 /plugin/agentRun 却正常，极具迷惑性）。已补 ai-brain 分支走真 LLM。**改 vite.config.ts 必须重启 vite（配置不热重载）**。
- ★ 端到端自测脚本：`vue/scripts/e2e-sms-reply.mjs`（Playwright 驱动真实页面：进游戏 → 调 setupState 的 onSysSmsStartChat/onSysSmsSend → 监听 console 的「→ player（回复）」判定）。UI 气泡选择器不可靠（面板未必开着），**判定落库以 console 日志为准**。chromium 用 1243 版 exe（playwright 全局版要 1208，需显式 executablePath）。
- ★★ **宿主 runPluginAgent 曾整体撕碎 brain 决策**（2026-10-30 修，宿主仓库 `toonflow-game-app/src/lib/plugins/PluginAgentRunner.ts`）：① 输出无 `isAiBrain` 分支 → 决策 JSON 被 `sanitizeMap` 撕成地图结构；② userPrompt 由宿主自拼 parts、从不读 `input.userPrompt`（短信上下文全丢）；③ 插件 entry.ts 只读 `result.output.text`，而宿主返回的是**已解析对象** `output:{reasoning,action,...}` → 永远 undefined。三处全修：brain 分支直通 parsed + 透传 userPrompt + entry.ts 兼容 `output.text`(string) 与 output(object) 双形态。**宿主 tsx 直跑进程需重启才生效**；确认调用是否到达宿主看 `logs/app-*.log` 有无 `POST /plugin/agentRun 200`。
- 离线自测：`node scripts/test-sms-store.mjs`（30 项）/ `test-sms-dispatch.mjs`（26 项）/ `test-sms-prompt.mjs`（20 项 prompt 契约锁：断言源码+entry.js 产物双层契约，改 prompt 必重建）；可视化预览：`npx vite --port 8799` → `/scripts/sms-preview.html`。

## 野怪/战斗
- ★ **城镇凭空刷野怪的根因**：兜底刷怪守卫 `mobs.length>0` 被「练习假人进 mobs」破坏（城镇放假人 → mobs.length=4 → 守卫失效 → 每 60s 凭空刷 5 只 `localmob_*`）。修：守卫按**非假人 mob 数**判定 `filter(m=>m.trainingDummy!==true).length`。**教训**：给集合加新成员必须 grep 所有 `.length` 消费点。
- 野怪 id 前缀速查：`zone_<区名>_` = 区域刷怪（地图 zones 配置）；`localmob_<ts>_` = **兜底刷怪**（城镇本不该有）；`mapmob_<uid>_<ts>` = 地图 Actors 层 Tiled 对象（野怪+练习假人）。
- ★ **UI 层级约定（App.vue）**：`.ev-confirm-overlay`（确认/多选/输入/结果/拾取 5 类共用）= **10000 / fixed**，`.hud-toast` = **10001 / fixed**，面板一律 ≤9998（forge-panel/sys-btn 9998、sys-panel/quest-panel 9997、chat-panel 9996）。根容器 `.fs` 是 `position:relative` 无 z-index → **不产生层叠上下文**。改层级后跑 `vue/scripts/check-zindex.mjs`。
- ★ **画布图层顺序（App.vue render()）**：迷雾 → 实体(含血条) → **VFX** → 飘字/点击特效。VFX 原本完全不透明盖死怪和血条，修法两条缺一不可：① `const VFX_ALPHA_SCALE = 0.45` + `vfxA(alpha)` 辅助，斩击弧/火花/爆炸/火球/治疗环/Buff环/图标**逐个**套（★ 外层 `ctx.globalAlpha` 会被各特效内部绝对赋值覆盖）；② 血条挪到 VFX 之后：实体绘制只 `recordHpBar()`，VFX 后 `drawHpBarsOverlay()` 统一补画。回归锁在 `test-training-dummy.mjs`。
- ★ **四处同步**：`entry.ts`（真宿主 + dev-host 优先路径）/ `vue/vite.config.ts` 内嵌 dev-host stub（entry.js 失败时回退）/ `mockHost.ts`（standalone）/ `vue/src` —— **stub 是第四份平行实现**，改战斗逻辑漏它只在回退模式下错。
- ★ **mockHost 不回推 `state.response`** → `sendSysCmdAwait` 等满超时；mock 分支要显式 `(state as any).response = ...`。
- ★ **showToast(msg, ms) 第二参是毫秒不是颜色**：传 "white" → setTimeout 0ms → toast 在 Vue 渲染前被清空 →「提示一闪不见」。deps 适配层不得转传 color。
- ★ **宿主 epoch 机制**：前端实体集合变化必须 `bumpLocalMobsEpoch()` 宿主才重建敌怪表；entityRef（App.vue）已加 Proxy set 守卫。**epoch bump 字段只留 side/dummyMode** —— hp/alive 是宿主权威，带上它们会让站桩回血每秒触发宿主重建。
- 反馈分级：`showToast` 飘字（过程）+ `evNotice` 模态框（购买/打造/升级/溶解的最终结果，必须点确认）；判定成功要用后端 response，不能只看前端乐观值。

## 锻造/炼丹
- **商品数据属于地图集**：设计 md → `gen-shop-goods.mjs` → `<故事>/data/shop.{forge,alchemy}.json` → 脚本 `ctx.story.readJson` → `ctx.ui.openShopPanel({mode,tab,goods})` → App.vue `forgePanelGoods` → 按 `cat` 分组；购买走 `sys_shop_buy` 的 `params.good`（后端校验 price>0）。插件 `src/shop/` 已删；改货单只改故事包 + 重建 .tbg。
- **消耗类只能扣一次**：图纸/药方/材料由**后端**在命令 case 里扣，前端只传参数（`blueprint`）；前后端都扣 = 双重扣除（实测 2 张图纸打一件归零）。
- 用图纸打造：`blueprintProduct(图纸名)` 剥后缀得成品名，`looksLikeBlueprint` 拦 AI 把图纸当产物；三处都要有兜底。

## 练习假人
- 配置：地图属性 `training_dummy=true` + `camp=neutral`（写 hostile 会主动打人）→ mapConfig 特批进 mobs；脚本用 `ctx.npc.setField(uid, patch)` 改 side/hp。
- ★ **字段权威方必须分清**（修「站桩不掉血/实战不来打我」）：**客户端权威**= `side`/`dummyMode`/位置/标签（否则每 tick 回滚，side=enemy 1s 内被打回 neutral）；**宿主权威**= `hp`/`alive`/伤害/经验/金钱/掉落（否则前端无脑覆盖会把宿主 damage() 掉的血改回满血 → 打了没反应）。合并：App.vue `onHostState` 先取 `hostDummyStates`，剔除 incoming 同 id，再 `{...前端版, hp/alive/maxHp/deathMs: 宿主版}`。
- ★ **假人 hp 归属按模式分流**：**duel 假人 hp 跟宿主**；**stand 假人 hp 跟客户端**（站桩回血由 E70 每秒回 5%，宿主只降不升 → 用宿主 hp 会 50/59 震荡）。entry.ts 侧 epoch 相同（不重建）时把 stand 假人 hp/alive 同步进宿主实体。
- ★ **宿主重建实体（`applyLocalEnemies` 走 makeEntity）会丢自定义字段** → 新增字段（trainingDummy/dummyMode）必须显式透传，否则 `damage()` 的 `target.trainingDummy===true` 永不成立 → 击碎不写 flag（没经验）。
- 站桩模式假人**不追击不攻击**：宿主敌怪 AI 开头判 `trainingDummy && dummyMode==="stand"` 直接 return。站桩回血在**宿主**（`standDummyRegen`），前端 E70 只管模式切换 + UI（伤害与回血必须同源）。
- ★ **击碎奖励不发的真根因 = eventEngine 的 flagCache**：`damage()` 击碎时写 flag `dummy_destroyed_<实体id>`，E70 用 `ctx.save.getFlag()` 轮询，但 `flagCache` 只在切图/重载事件/面板写 flag 时 invalidate，**战斗中的写入没有失效时机** → 永远读旧快照 → 经验永不发（现象：正常扣血、正常「散架了」，exp 纹丝不动）。修：`FLAG_CACHE_TTL_MS=1000` + `flagCacheAt` + `getFlag` 改**强制重读** `loadFlags(true)` + `saveFlags` 落库后刷新 `flagCacheAt`。
- ✅ 实测基线（2026-10-29）：stand 185 HP → 一刀 -72 → 113，**每次回 +9**（185×5%），**严格每 10 个宿主 tick**；打死原地复活满血 + 事件；duel 会追击（aiState=chase、vx>0、距离递减），脱离回原地。等级显示 `e.side === "enemy" && e.level`（App.vue ~4805）。
- ⚠️ **4m 边缘「抽搐」是设计不是 bug**：`MOB_DETECT_M = MOB_DISENGAGE_M = 4`（无迟滞带），玩家在边缘时 chase↔return 反复切换，追击速度只 0.72 倍。
- ★ **测按 tick 计的频率必须用宿主 tick 差值，不能用墙钟**：iframe 内 rAF 被节流到 ~1Hz → 游戏 tick 实际 1 次/秒 →「10 tick 一次」在墙钟上是 10 秒。**看到「回血 10 秒一次」不是 bug，是节流。**
- ★ 日志「当前关卡敌怪已接入宿主 AI（N 只）」只在真变化时 pushEvent（`_lastLocalBuilt`/`_lastLocalEpoch`），否则刷屏。

## ★ 调试铁律（摘要，全文见 `MEMORY-APPENDIX.md`）
- **「点了没反应」先浏览器复现再改代码**：曾凭静态阅读误判 z-index，真根因是 color 被当 ms。
- 通道：iframe → `canvas.__vueParentComponent` 向上找根 → `root.setupState`（ref 可读写）；发命令 `parent.postMessage({type:'tf_plugin_tick',action,params},'*')`。读宿主真实 state 靠拦 iframe 的 `postMessage`（`__devHostPluginState()` 不给 x/y/aiState）。
- ★ 采样前先看 `phase`：玩家一死前端停发 tick → 窗口冻结成「AI 没动」。★ 别只看合并后的 entities，x/y 要用 `hostDrives` 判定来源。
- 复活 `setupState.reviveGame()`；玩家瞬移改 `state.entities` 的 player x/y，但**绕过 entityRef Proxy → epoch 不 bump → 宿主不重建**，测「脚本改 side」必须走正规 UI（⚔对打→模拟实战）。
- canvas 渲染 → 查 DOM 找不到文字，只能截图目视；随机事件弹窗（如「采药」）会挡视野先点「离去」。
- 浏览器工具（bsk / ego-browser）命令与坑、以及 map-editor / tiles-maps-editor 子项目要点：见 `MEMORY-APPENDIX.md`。
