# Toonflow game-plugins 项目长期记忆

## 插件构建部署三步收尾（缺一不可）
1. `plugins/toonflow-field-survival/vue` 下 `npm run build` → `../ui/game.html`
2. esbuild 编 entry.js：`vue/node_modules/.bin/esbuild ../entry.ts --bundle --format=esm --platform=node --target=node18 --outfile=../entry.js`
   （参数与 `src/toon_plugins/cli.py:112` 一致，少 `--bundle` 会安卓端开局超时；产物须 ESM 单文件、无 import / `import.meta`）
3. 同步 entry.js + ui/game.html 到 installed 副本 `toonflow-app-run-db/plugins/1/com.toonflow.minigame-field-survival/`，md5 一致。
   真宿主后端影子模块按 `<pluginKey>.<mtime>.mjs` 热重载不用重启；**dev-host（`--conn`）进程内永久缓存 entry.js，改了 entry.ts 必须重启 dev-server**；前端 src（含 eventScripts/mockHost）走 vite HMR 刷新即可，vite.config.ts 要重启。
- esbuild 会把中文转义成 `\uXXXX`，校验产物先 `src.encode().decode('unicode_escape')` 再 grep。

## vite.config.ts 模板字符串三大陷阱（2026-10-17 / 2026-10-23）
`const PAGE = \`<!doctype html>…\`` 是一整块 JS **模板字符串**（现约 257→1893 行），内有三个坑：
1. **反引号**（2026-10-17）：区间内写注释/代码出现任何反引号都会把模板提前闭合，esbuild 报错位置是「下一个反引号之后」，极具误导性。排查：`grep -n '`' vite.config.ts`，起始前和结束行各一个、中间必须 0 个。
2. **单反斜杠**（2026-10-23）：模板对「非法转义的单个反斜杠」**直接丢弃**——`\s→s`、`\d→d`、`\/→/`。`\/`→裸 `/` 会让正则提前闭合 → SyntaxError → **整页白屏**；`\s`/`\d`→裸字母则**静默失配**（兜底算错但零报错，更难查）。修法：正则字面量把反斜杠**双写**（`\\s`/`\\/`），或改用 `new RegExp("...")` 字符串形式（更稳）。
3. **`${}` 插值**：插值内是**真 TS 代码**，反斜杠规则与模板不同（`\\` 是正常双写）；改模板时别把插值区一起处理。

**永久门禁**：`vue/scripts/check-page-template.mjs`（`npm run check:page`，已挂进 `npm run build` 前置）——扫非法转义 + 渲染后 `<script>` 做 `node --check` + 正则语义比对。改 PAGE 模板后必跑。

**排查要领**：浏览器报 `localhost/:1536 Uncaught SyntaxError` 里的数字是**渲染后 JS 的行号**（不是端口）。dev-host 实际跑在 **3000** 端口；`localhost/:1536` → 直接把 PAGE 模板渲染出来看第 1536 行是哪句。

## dev-host 桩（--conn）与真宿主差异
真宿主由 CLI `python -m toon_plugins plugin_session_data -u … -story …` 把 `map_visual:<story>`（sessionId="all"）写进 `t_plugin_session_data`；dev-host 不会，需 `seedStoryVisualMap()` 从 `/story-data/toonflow-field-survival/map_design/<STORY>.tbg` 播种。entry.js 侧 `ensureStoryVisualMap()` 依赖 3 前提，缺一个即静默退化成「只有当前关」：`ctx.worldName` 非空、`tsApi.pluginData.getTemplate` 存在、模板里确有 `map_visual:<story>`。

## 地图数据三条链
- `storyMap.ts`：`getTemplate("map_visual:<story>")` → 退路 `get("map_visual")` → `normalizeBundle`（`format==="tbg"` 走 `zipTbg.tbgToVisFiles(base64)`，跳过 `bak/` 与 `test_data/`）
- `mapConfig.ts`：`listLevelNames()` 优先 `getStoryLevelNames()`（=bundle.mapFiles），兜底 `LEVEL_FILES`（已清空）
- `entry.ts`：`ensureStoryVisualMap()` 注入本会话 `map_visual`，透出 `worldName`/`worldId` 到 state 顶层
- `reportLevels()` 兜底**只能报当前关**，绝不能拼 `sysMapNodes`（后端回显 → 回声环，地图面板一排同名关卡）

## 参数卡是唯一权威源
`s.items`/`s.skills` 全由 `buildItems/buildSkills(playerCard)` 重建；排序类需求（背包/技能 ↑↓）落 `patchCard` 改参数卡，再靠 `s.skillOrder` + `persistSys`/`restoreSys` 断线还原。

## story-data 中间件必须区分文本/二进制
`vite.config.ts` 的 `/story-data` 默认 `readFileSync(...,"utf-8")` + `application/json`，对 `.tbg`（zip）会损坏字节；已加二进制分支（octet-stream 原样回），新增加静态资源类型记得同步。

## 地图名三套写法，切图只认 mapFiles key
① 关卡 key `mulberryDungeon1`（=bundle.mapFiles key，唯一能喂 `switchLevel`）② 归一英文名 `Mulberry Dungeon`（`normQuestMap` 产物，层号可能丢）③ 中文显示名 `冥夜走廊·一层`（Tiled `name`）。跨图寻路一律先过 `levelKeyOf()`（前端）/`rawQuestMapKey()`（后端）。
**`toLowerCase().replace(/[^0-9a-z]/g,"")` 对纯中文名返回空串**——做前缀匹配恒真、做相等比较会把「桑镇」「桑林」判成同图，两处都必须 `if (!compact) return 原值`。

## ★ 地图集是数据，前端代码表是全局共享的（改地图集的头号陷阱）
`workshops/<故事>/map_design/<地图集>/` 只是数据目录；`mapConfig.ts`/`mockHost.ts`/`entry.ts` 里的表被**所有故事共用**（黑塔/赦夜人/通天传授等）。
- **禁止**往 `QUEST_MAP_SLUGS`、`MAP_MOB_LEVEL_RANGE` 等表里加「某故事专属的显示名映射」：slug/文件名是跨故事共享的 key，重复 key 在 TS 对象里后者覆盖前者，会**打坏别的故事**。各故事的中文显示名一律写在自己地图 JSON 的顶层 `name` 字段（`getLevelDisplayName` 已优先读它）。
- 表的增补原则「只增不删」，但**追加前必须查重**（同一 key 已在表里 → 改值而非新增行；否则 esbuild 报 Duplicate key）。
- `THEME_BY_MAPNAME` / mockHost `currentTheme()` 的查表 key 是**关卡 key（slug，来自 App.vue `currentLevelName`）**，不是中文显示名。新增地图集时按 slug 登记（可再补一份中文名双写兜底）。
- `dungeon_themes` 的四个槽位名 `RUINS`/`CATACOMBS`/`MINE`/`ICE` 由引擎按名查权重，**不能改名**；换题材时只换 `mob_distribution` 里的怪物与槽位语义说明。
- 地图集里 `forestDungeon.json` 这类「无层号」文件可能**不存在**（只有 1~5），旧图靠对象属性 `createDungeon:true` 动态生成。事件里的 `teleport` 是固定目标，指向不存在的关卡会静默切图失败。

## 坐标：1 米/格、以图心为原点
`metersToCell`：`gx = floor(x + cols/2)`。桑镇 43×56 → x∈[-21.5,21.5]/y∈[-28,28]；森林 60×40 → ±30/±20；冥夜走廊一层 31×23 → ±15.5/±11.5。任务坐标写超不报错，只会「寻路后原地不动」——查任务数据先按范围卡一遍。

## 图集 compiled_tileset：每地图集一份副本
- 实际使用：`workshops/<故事>/map_design/<地图集>/images/compiled_tileset_32x32.png`；描述文件叫 `compiled_dawnlike.json`（columns=120、tile 32px、tilecount=13080），不是 `compiled_tileset_32x32.json`。
- `resource_library/toonflow-field-survival/base/<name>/compiled_tileset_32x32.*` 是**素材母版**，只读；写操作（贴图替换/bak/overrides）一律按当前地图集定位（map-editor `resolve_tileset_target(collection)`），落母版会污染且当前地图看不到变化。
- 运行时三级来源：dev（`npm run debug -- --story <故事> --conn`）= workshops 本地最新（vite `/story-data` 实时读盘，改完刷新即生效，不用复制/构建）；安装后 = 数据库 `map_visual:<故事>` 包内 png（`getStoryTilesetObjectUrl()`→Blob→blobURL，`App.vue applyTilesetImage()` 替换）；兜底 = `vue/public/images/`（随 ui 部署）。**禁放** `vue/src/assets/images/`（readme 明令禁止，assets.ts 的 png import 早已失效）。
- ORC 半兽人 16 格全在 row 44、col 12–27（tileId 5292–5307）；动画配对 5292→5300、…、5299→5307，每格有第二帧；地图 JSON `firstgid=1`，mulberryForest.json 实际用 tile 5299（+帧 5307）。**换半兽人贴图必须整套 16 格一起换**。
- **32×32 像素贴图必须程序化生成，不要用 AI 生图**：原版每格仅 12~16 色，AI 产出 1024px 高细节插画缩到 32px 变 400~650 色完全糊掉。落盘整格替换 `base.paste(new_tile, pos)`，**不能** `alpha_composite`——原格残留 alpha=1 幽灵像素会透出（实测 430 个残留像素）。

## PIL paste(img, box, mask) 是 alpha 混合，不是替换
半透明图 paste 到有内容区域 = 两者混合（实测 α128 纯红贴出 (128,0,0,64)）；「先 paste 透明块清场」也救不了。整格替换必须：`base.crop(格子)` → `Image.alpha_composite(region, 新图)` → 不带 mask `base.paste(合成结果, box)`。canvas 等价：`clearRect(格子)` + `drawImage`。重置类操作同理。

## map-editor 要点
- AI 模型配置存**后端 SQLite**（`backend/ai_store.py` → `ai_models.db`），字段对齐 app t_config；适配器 `ai_clients.py` 镜像 app u.ai.image/u.ai.text；路由 `/api/ai/{models,bindings,test}`；贴图替换槽位 key=`textureReplaceModel`；前端 `ModelSettingsModal.vue`（type×manufacturer×model×baseUrl×apiKey）。
- 快捷键必须对齐真实交互（别只翻 onKeyDown）：中键/【Ctrl+左键】=平移、`Alt+左键`(select)=移动对象、`T` 切坐标模式后左键查 (tile,world) xy、滚轮=缩放、`Shift+左键`(draw/erase)=笔刷连刷；tileset 模式 Shift+左键=框选多格；tileStyleMode 下 App.onKeyDown 抑制画布工具键，仅留 Ctrl+S 与 Esc。
- **canvas 切换显示必须 v-show 不能 v-if**：2d context 是模块级缓存（`let ctx=null`），v-if 销毁重建后 ctx 永久指向旧 canvas → 黑屏、点击无反应，只能刷新页面。凡持有模块级缓存 context/实例的 canvas/图表 DOM 都用 v-show 常驻。
- 云端背景分离 `cloud_matting.py`：Bria（api_token header）/阿里云视觉/腾讯云数据万象（cos-python-sdk-v5）三家。Python SDK 与 Node 差异大：Config 在 `alibabacloud_tea_openapi.models`、AdvanceRequest 字段全小写 `image_urlobject`、方法 snake_case `segment_hdbody_advance`、响应图片 URL 字段大小写都要试。错误分级：MattingConfigError→400、MattingProviderError→502。
- 本地抠图复用 app 权重不重复下载：`avatar_matting.py` 的 `tool_root_dir()` 自动探测 `toonflow-game-app/Toonflow-game/tools`，共用 `avatar-matting/birefnet/{venv,model-cache}`（已预置 birefnet-portrait/birefnet/modnet/u2net/u2netp）。厂商 key：`local_birefnet`/`local_modnet`/`local_u2net`；u2net=非生物通用分割走 rembg（`U2NET_HOME` 指向 model-cache）。**别在 env 文件写占位 `MODEL_path`**（曾导致全部本地模型静默 not_installed）。

## AI 厂商目录权威源在 Toonflow-game-web，不在 app
唯一可读源码：`Toonflow-game-web/src/utils/modelConfigCatalog.ts`（`MODEL_MANUFACTURERS` 22 家 + `defaultBaseUrlFor`/`defaultModelNameFor` 等）。app 的 src 无 .vue，厂商表只在旧 bundle `app/scripts/web/assets/index-*.js`（2025-07，少一个 `moka_m3e_small`）。已移植到 `map-editor/frontend/src/tile-style-change/modelConfigCatalog.js`。
三个坑：① `defaultBaseUrlFor` 有 defaults 表外硬编码分支（voice+asr→`dashscope.aliyuncs.com/compatible-mode`）；② `tencent_ci`/`local_*` defaults 为空，腾讯云 baseUrl 必须手填 COS 桶域名；③ `defaultModelNameFor` 里 `manufacturer==="aliyun"`（无 `_direct`）是死分支，注册表只有 `aliyun_direct`。
抠图专用厂商集合 `{bria, aliyun_imageseg, tencent_ci, local_birefnet, local_modnet}`（+map-editor 自增 `local_u2net`），只能绑背景分离槽位（app `configurationModel.ts` SLOT_CONFIG_RULES 互斥矩阵）；app 前端 `SettingsModelManagerDialog.vue:72-80` 误含 `moss_tts_nano`，与后端不一致，别照抄。

## AI 托管（toonflow-field-survival）架构要点
- LLM 链路：brain.ts → App.vue `callBrainLLM` → `sendTick("sys_brain")` → entry.ts `case "sys_brain"` → `ctx.tsApi.agent.run("field-survival-ai-brain", {entityName, systemPrompt, userPrompt})` → 写 `s.chatResult{reqId,ok,text}` → persistSys。**systemPrompt 直接用 entry.ts 顶部常量**（不靠前端传，省 ~1200 token/拍）；宿主 `promptHelper.getPromptByCode()` 只查 `def.prompts.ts`，插件的 `plugins.prompts.ts` 不在解析链上，提示词必须走 `input.systemPrompt`。异常也必须写回包，否则前端永久 pending。
- `chatResult` 是**单槽位**：并发 brain 请求互相覆盖 → App.vue `brainBusy` 闸门 + `waitBrainResult` 超时 15s→8s；`tickAllAIs` 已拆两阶段：`evaluateBrainTrigger()`（每 tick 纯本地评估）+ `scheduler.ts` 队列（全局 inFlight 闸门 + P0/P1/P2 优先级 + 0~1500ms 抖动错峰 + 每分钟/小时预算 + 全局失败冷却 30s + 连 3 次失败熔断 2min）。
- **战斗判据是「玩家」不是「AI 自己」**（AI 感知半径仅 13m）：`entry.ts` `damage()`（所有伤害唯一入口）打点 → `s.playerCombat` 三态：engaged（刚交火 30s 保持）/ skirmish（超时但 20m 内有活敌）/ none；跃迁**边沿触发**。⚠️ `damage()` 第 4 参数 `attacker` 历史上有 3 处漏传（玩家普攻+两处技能，已修），不传则战斗状态机是死的。
- 间隔表：engaged 5s / skirmish 10s / idle 20s / 城镇 30s；`maxInterval` 15000→30000；硬钳制（`mapInterval.ts`）engaged≥3000ms、其他≥5000ms、上界 30000ms；地图集可覆写 events.json 顶层 `ai.interval`。紧急层 `checkEmergency()` 纯程序化跑在调度器**之前**，不受预算/熔断限制。`pickCombatRoles` 战斗态只让离玩家最近 2 个角色进 LLM，其余走兜底。
- 事件引擎新增 `interval` 触发器（`{type,everyMs,when?:any|combat|idle}`，硬下界 2000ms、单图上限 3 个、按重复事件不进 firedIds）+ `ai_trigger`/`ai_interval` 动作；示例 `mulberryDungeon5.events.json`（BOSS 图 engaged=4000/skirmish=6000/idle=12000）。
- NavMesh/避障：`moveTowards` 是直线给速度，ally 循环与 `#ai` NPC 应用器已改用 `navStep()`（八向局部避障，`AI_NAV_R=0.38`，步长用 `TICK_DT_S`）。
- 测试：`vue/scripts/smoke-combat.mjs`（战斗状态机 11/11）、`smoke-entry.mjs`（14 个既有失败作基线，改动前后对比防回归）。

## 用户约定与偏好
- **这个项目本质是 ai agent 项目，尽量不要写硬编码，用 ai agent 实现功能。**
- 表查询出错先看表结构；看到报错先找根源，不暴力解决；看不到日志别想当然没开 debug，更不要去掉 `DebugLogUtil.isDebugLogEnabled()` 的判断。
- 测试脚本/临时文档只允许放 `.cache/` 下，不随意放置。
- 任务状态标记：`[]` 未开始 / `[suc]` 已检查无问题 / `[skip]` 暂时跳过 / `[wait]` 待检查 / `[ing]` 实现中 / `[fail]` 检查不通过 / `[check]` 检测中。
- vite.config.ts：要么支持 `\n`，要么就不要写 `\n`。
