# Toonflow game-plugins 项目长期记忆

> 只留跨天有效的结论；细节以 `.workbuddy-ai/memory/YYYY-MM-DD.md` 各日日志为准。

## 用户约定与偏好
- 本项目本质是 ai agent 项目：尽量不写硬编码，用 ai agent 实现功能。
- 报错先找根源不暴力解决；看不到日志别想当然没开 debug，勿删 `DebugLogUtil.isDebugLogEnabled()`。
- 测试脚本/临时文档只放 `.cache/`。任务状态标记：`[]`/`[suc]`/`[skip]`/`[wait]`/`[ing]`/`[fail]`/`[check]`。
- 换行符：git 存 LF、工作区 CRLF（core.autocrlf）。用 Write 重写文件会写成 LF → `git diff` 整文件全变但内容一致，**改完必须 python 转回 CRLF**。

## 构建部署：唯一入口
```bash
python -m toon_plugins plugins -i toonflow-field-survival   # build vue + 重编 entry.js + 打 tpg 上传
```
- ⚠️ **禁止手跑 esbuild、手拷 `entry.js` / `ui/game.html`**（规范 §8.2）。手编会造出「比源更新的产物」，
  下次 CLI 重编即覆盖且差异不可追溯（实测踩过：`--format=iife` + 副本不一致 → 分类页全空查半天）。
- 供理解的产物约束：esbuild 必须 `--bundle`（缺则安卓开局超时）、产物 ESM 单文件、
  中文被转义成 `\uXXXX`（校验先 `src.encode().decode('unicode_escape')` 再 grep）。
- **dev-host（`--conn`）进程内永久缓存 entry.js**（`loadEntryModule` 的 `if (entryMod) return`）
  → 改 `entry.ts` 必须重启 dev-server；前端 src 走 vite HMR 不用重启。

## vite.config.ts 的 PAGE 模板字符串（三陷阱）
`const PAGE = \`…\`` 是整块 JS 模板字符串：① 反引号会提前闭合模板（esbuild 报错行号误导）；
② **单反斜杠被直接丢弃**：`\/`→裸 `/` 让正则提前闭合→SyntaxError 整页白屏，`\s`/`\d`→裸字母则静默失配（零报错更难查）；
③ `${}` 插值内是真 TS，规则不同别一起改。修法：正则反斜杠双写或改 `new RegExp("...")`。
- 永久门禁 `vue/scripts/check-page-template.mjs`（`npm run check:page`，已挂 build 前置），改 PAGE 必跑。
- 浏览器报 `localhost/:1536` 的数字是**渲染后 JS 行号**不是端口；dev-host 实际 3000 端口。

## ★ 地图集是数据，前端代码表全局共享（改地图集头号陷阱）
`map_design/<故事>/` 只是数据目录；`mapConfig.ts`/`mockHost.ts`/`entry.ts` 的表被所有故事共用。
- 禁止往 `QUEST_MAP_SLUGS`/`MAP_MOB_LEVEL_RANGE` 加「某故事专属显示名映射」：slug 跨故事共享，重复 key 后者覆盖前者会打坏别的故事。显示名一律写地图 JSON 顶层 `name`（`getLevelDisplayName` 优先读）。
- 表「只增不删」但追加前必查重（esbuild Duplicate key）。
- `THEME_BY_MAPNAME`/`currentTheme()` 查表 key 是**关卡 key（slug）**不是显示名；`dungeon_themes` 四槽位名 `RUINS/CATACOMBS/MINE/ICE` 不能改。
- 地图名三套写法：关卡 key（唯一能喂 switchLevel）/归一英文名/中文显示名。
  `toLowerCase().replace(/[^0-9a-z]/g,"")` 对纯中文名返回空串 → 前缀匹配恒真、相等比较误判，两处都要 `if (!compact) return 原值`。
- 坐标 1 米/格、以图心为原点（`gx=floor(x+cols/2)`），写超不报错只「寻路后原地不动」。
- teleport 指向不存在关卡静默失败；`forestDungeon.json` 这类无层号文件可能不存在。

## ★ 事件系统 ctx API 现状与缺口（2026-10-28 逐文件核对）
三层接口：声明层 `events/maps/<map>.events.json` / 脚本层 `events/scripts/*.ts`（`ctx`）/ 数据层 `<故事>/data/*.json`。
- trigger 声明 10 种**实现 5 种**：`enter_map`/`interact`/`proximity`/`area_enter`/`interval`；其余 5 种写了是死事件。
- condition 声明 4 种**实现 1 种**：`flag_check`（`eq`/`ne`/`exists`/`missing`），其余恒真通过。
- action 12 种：`call_action` ❌ 未实现（`registerAction` no-op）；`llm_speak` ⚠️ 占位返回空串；
  **`run_script` 的 `args` 不透传**（`runScript(a.script, actor)` 丢弃 args）→ 一脚本服务多对象只能「找最近实体」猜。
- ctx 空实现混在白名单里：`npc.setLabel/move/faceTo`、`audio.play`、`llm.speak`、`registerAction`。
  **`validate_events.mjs` 的 CTX_API 只查名字在不在表里，不查有没有真效果 → 校验通过 ≠ 功能可用。**
- `ctx.cmd` **不等后端回执**（立即 resolve 空串）；要结果必须前端实现（`forgeOps.ts` 的 `sendSysCmdAwait`）。
- `proximity` 运行时：半径 `Math.max(0.8, radius||2.8)`；按 uid 找 `mapnpc_<uid>[_*]`/`mapmob_<uid>[_*]`；
  半径内**最近者**胜；`alive===false` 跳过；挂 proximity 的 uid 被 `eventUidsHas` 排除出「💬 聊天」→ **一个 uid 只能一种入口**；
  `repeat` 硬编码 3 秒冷却且**条件不满足也进冷却**（设施类别叠 condition）。
- ★ **已知缺口**（改插件时优先补）：① `ctx.ui.notice` 运行时已有（`evNoticeOpen`/`forgeOpsDeps`）但**没进 `makeCtx`** → 脚本弹不出模态框；
  ② 脚本读不到 money/level（`hooks` 有 `playerLevel`/`money`，`Ctx` 无）；③ `proximity` 无 `maxUses`/动态 label；
  ④ `ctx.player` 是快照，改实体只能 `ctx.npc.setField`（走 `entityRef`）。
- 业务数据必须走 `ctx.story.readJson("data/x.json")`（按 path 缓存一局；安装态读 `.tbg`）；**`import` 数据会被编进 `ui/game.html`** = 头号严重违规。

## AI 托管（toonflow-field-survival）
- 链路：`brain.ts` → `sendTick("sys_brain")` → `entry.ts case "sys_brain"` → `ctx.tsApi.agent.run("field-survival-ai-brain",…)`
  → `s.chatResult{reqId,ok,text}` → persistSys。systemPrompt 用 entry.ts 顶部常量（宿主 `promptHelper` 只查 `def.prompts.ts`）；
  **异常也必须写回包**，否则前端永久 pending。
- `chatResult` 单槽位 → `brainBusy` 闸门 + 超时 8s；`tickAllAIs` 两阶段：`evaluateBrainTrigger()` + `scheduler.ts`
  （inFlight 闸门/P0-P2/抖动错峰/预算/失败冷却 30s/3 连败熔断 2min）。
- 战斗判据是**玩家**不是 AI 自己（感知半径仅 13m）：`damage()` 唯一入口打点 → engaged(30s)/skirmish(20m 内活敌)/none 三态，边沿触发。
  ⚠️ 第 4 参 attacker 曾有 3 处漏传（不传则状态机是死的）。
- 间隔可配（`ai/aiConfig.ts` 落 sessionId="all"）：默认 max 20s/min 5s/engaged 5s/skirmish 10s/idle 20s；
  用户配置优先于地图集覆写，HARD_CEIL 60s。紧急层 `checkEmergency()` 在调度器前，不受预算/熔断限制。
- 避障 `navStep()`（八向，AI_NAV_R=0.38，步长 TICK_DT_S）。测试基线：smoke-combat 11/11、smoke-aiconfig 48/48、smoke-entry 14 个既有失败。

## 瓦片/贴图硬规矩
- **改地图前先跑认知技能** `.workbuddy-ai/skills/cognitive-tiles-maps`（`ctm.py <路径>`）：整图渲染 + 逐格材质图 + 图集目录 + 候选拼图。**先看清再动手。**
- **图集 `category` 标签不可信**（L1 草地 1580 格全标 `building_wall`）→ 判材质用**像素颜色**（绿 g>+12→树/草；低饱和中性灰→石/木；暖色→木/土）。
- `avg_color` 也会误判（整格平均色）；找路面/墙面加 `--min-uniform 0.6`（路面/墙 >0.6，家具/角色 <0.5），候选 60→6 全对。
- **禁止靠 gid 猜长相**（dawnlike 分区被打乱，9304/9305 像石板实则橙木地板）：算法筛候选 → 裁图目视 → 再落子。
- ⚠️ 旧结论已推翻：「灰青砖在 5444~5574」是错的（那批是深底白字招牌）。真路面组：**7029/7049/12440/12447**（深灰水泥）、**7148/7168/10031/12087**（灰蓝石板）、7033/7053（橄榄土面）。
- 改造前先打印逐格材质图（W 墙/屋顶、f 家具、F 地板、T 树/草、. 空地、o 对象）；原型村庄建筑 L2 是实心屋顶（5610/5730/5850），改室内必须先清屋顶格；按 bbox 猜坐标必错。
- 新瓦片只落图集内连续全透明空白格且 id < tilecount(13080)，写入前断言 alpha 全 0。
- 32×32 贴图必须程序化生成（AI 生图缩到 32px 全糊；原版每格仅 12~16 色）。
- **PIL paste 是 alpha 混合不是替换**：整格替换须 `crop`→`alpha_composite`→不带 mask `paste`；canvas 等价 clearRect+drawImage。
- 渲染多层地图**每层必须透明底**再 composite（铺不透明底会把下层涂黑）。ORC 半兽人 16 格在 row 44/col 12–27（5292–5307），换贴图必须整套换。
- 每地图集一份 `images/compiled_tileset_32x32.png`；`resource_library/.../base/` 是只读母版。运行时三级：dev 读盘/安装后 .tbg 内 png/兜底 `vue/public/images/`（**禁放 `src/assets/images/`**）。

## ★ 实体外观 = object.gid
- 外观由 `object.gid`（tileId+firstgid）决定，`entity_type` 只决定**行为类**。链路：`obj.gid` → `normalizeTiledMap` 提取 `npc.gid`
  → `injectMapNpcsToState` 写 `entity.gid` → `drawEntity` 走 `walkTileId(gid-1)`（第二帧读 `animated_id`，不是猜 +8）。
- ⚠️ **gid 是对象顶层字段，不在 properties 里** → 编辑器改它不能走 `setProp`；`gid=0` = 回退按类型默认形象。
- 编辑器 `/api/collections/{name}/dawnlike` **会丢掉全部无 description 的 tile**（3770 个），而人物动画帧恰好无 description
  → 另建 `/api/collections/{name}/sprites`（有动画或有 description 才是可当形象；`animated_id < id` 是别人动画第二帧要跳过）。黑塔实测 1119 character + 1165 prop。
- 缩略图 = canvas 裁图集 → 放大（`imageSmoothingEnabled=false`）→ toDataURL；坐标 `col=tileId%120, row=floor(tileId/120)`。

## ★ dev 免安装调试地图集
- **地图面板「全部地图」只显示当前关 = 磁盘缺 `<故事>.tbg`**（不是前端 bug）：dev-host `seedStoryVisualMap()` 只认磁盘 .tbg
  → 目录形态播种失败 → `bundle=null` → `listLevelNames()` 空 → 只剩当前关。
- 修法：`vite.config.ts` storyData 中间件加 `ensureTbgBuilt()`（零依赖手写 zip：local header + 中央目录 + EOCD，deflate-raw 用 `node:zlib` + crc32 查表），
  规则同 `cli.py build_tbg_file`。无 .tbg → 写标准 `<故事>.tbg`；有但源更新 → 写旁路 `.tbg.devcache`（零破坏）。
  ⚠️ 判断必须在 `existsSync(filePath)` **之前**，否则旧 .tbg 永远命中、源改动不生效。
- `maps/first.map.json` 的 `start_map.value` 写**关卡 key（slug）**最稳（写 "Lich Lair" 会落到 12×12 小图）。
- dev 调试不需要安装：`npm run debug -- --story <故事名> --conn`，.tbg 现场自动打包。
- `/story-data` 中间件 `.tbg` 走二进制分支（utf-8 读会损坏 zip）；`s.items`/`s.skills` 由 buildItems/buildSkills(playerCard) 重建；
  `reportLevels()` 兜底只能报当前关，**绝不能拼 `sysMapNodes`**（后端回显→回声环→地图面板一排同名关卡）。

## Vue / Vite 陷阱
- **白屏先查 `public/index.html` 覆盖**：Vite 的 public/ 同名文件会覆盖根 index.html。本项目遗留 Rotten Soup 模板（无 script）→ dev 白屏零报错，已改名 `rotten-soup.html`；`viteSingleFile()` 只在 production 启用。判别：curl `/index.html` 看有没有 `<script type="module" src="/src/main.ts">`。
- **SFC 模板插新 `v-if` 块**：不要插在自闭合组件标签（`<Xxx ... />`）紧后面 —— 该位置元素可能不归入根作用域，引用的 ref 不进 `__returned__` → `$setup.xxx` 恒 undefined → `v-if` 永远 false 且无报错。排查：fetch('/src/App.vue') 编译产物搜 `__returned__ = {`。修复：挪到明确顶层兄弟位置。
- `setupState` 代理读 ref 是解包的（直接得 boolean），写它 = 写 ref.value，可用于 E2E 注入。

## 锻造/炼丹/假人事件体系
- **商品数据属于地图集**：设计 md → `gen-shop-goods.mjs` → `<故事>/data/shop.{forge,alchemy}.json` → 脚本 `ctx.story.readJson`
  → `ctx.ui.openShopPanel({mode,tab,goods})` → App.vue `forgePanelGoods` → 按 `cat` 分组；购买走 `sys_shop_buy` 的 `params.good`（后端校验 price>0）。插件 `src/shop/` 已删；改货单只改故事包 + 重建 .tbg。
- ⚠️ 改故事目录内容后必须 `python -m toon_plugins plugin_session_data -i … -build <故事目录>`，否则安装态读不到（dev 由 vite 中间件自动重打）。
- ⚠️ 事件 JSON 三份副本会悄悄落后正本（曾 8 条 vs 13 条，缺 E50/E60/E70）：跑 `.cache/validate_events.mjs <故事>` 看「源与副本不一致」⚠，
  同步 `vue/public/events/maps` + `ui/events/maps`（这两目录**全故事共享**，同时只放一个故事，校验非当前故事时报「副本缺文件」是预期的）。
- `_ctx.ts` 四份副本（插件侧 + 三故事 shared）必须 md5 一致，改接口先统一再改签名。
- 练习假人：地图属性 `training_dummy=true` + `camp=neutral`（写 hostile 会主动打人，站桩失效）→ mapConfig 特批进 mobs；
  脚本用 `ctx.npc.setField(uid, patch)` 改 side/hp。状态合并必须**客户端权威优先**，否则事件脚本改的实体会被每 tick 回滚。

### 三条硬规矩（实战踩出来）
1. **消耗类只能扣一次**：图纸/药方/材料由**后端**在命令 case 里扣，前端只传参数（`blueprint`）；前后端都扣 = 双重扣除（实测 2 张图纸打一件归零）。
2. **三处同步**：`entry.ts`（真宿主）/ `mockHost.ts`（standalone）/ `vue/src`；mockHost 常有一套平行实现，漏改只在 mock 模式下错。
3. **mockHost 不回推 `state.response`** → `sendSysCmdAwait` 等满超时；mock 分支要显式 `(state as any).response = ...`。
- 反馈分级：`showToast` 飘字（过程）+ `evNotice` 模态框（购买/打造/升级/溶解的最终结果，必须点确认）；判定成功要用后端 response，不能只看前端乐观值。
- 用图纸打造：`blueprintProduct(图纸名)` 剥后缀得成品名，`looksLikeBlueprint` 拦 AI 把图纸当产物；三处都要有兜底。

## 次要子项目
- **map-editor**：AI 模型配置存后端 SQLite（`backend/ai_store.py`）；canvas 切换必须 `v-show` 不能 `v-if`（模块级缓存 ctx，v-if 重建后永久黑屏）。
  厂商目录权威源在 Toonflow-game-web `src/utils/modelConfigCatalog.ts`（22 家）。坑：voice+asr 的 baseUrl 硬编码 dashscope；`manufacturer=="aliyun"` 是死分支；抠图厂商只能绑背景分离槽位。
- **tiles-maps-editor**（`.workbuddy-ai/skills/`）：串 cognitive-tiles-maps（认知）+ tile-style-change（换皮）+ map-editor（UI）。
  scripts：`elements.py`（像素判材质/道路/建筑/活物）、`actors.py`（对象层 CRUD，坐标是像素）、`make_tiles.py`（程序化瓦片，id>=12900 空白段）。
  API：`POST /api/collections/{name}/maps/{map}` 保存（备份固定名会覆盖）；`POST /api/tile-style/override` 换格贴图（改图集本体，gid 不变）。
