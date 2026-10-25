# Toonflow game-plugins 项目长期记忆

> 只留跨天有效的结论；细节以 `.workbuddy-ai/memory/YYYY-MM-DD.md` 各日日志为准。

## 用户约定与偏好
- 本项目本质是 ai agent 项目：尽量不写硬编码，用 ai agent 实现功能。
- 表查询出错先看表结构；报错先找根源，不暴力解决；看不到日志别想当然没开 debug，勿删 `DebugLogUtil.isDebugLogEnabled()` 判断。
- 测试脚本/临时文档只放 `.cache/`。任务状态：`[]`/`[suc]`/`[skip]`/`[wait]`/`[ing]`/`[fail]`/`[check]`。
- vite.config.ts：要么支持 `\n`，要么就不要写 `\n`。

## 构建部署三步收尾（缺一不可）
1. `plugins/toonflow-field-survival/vue` 下 `npm run build` → `../ui/game.html`
2. esbuild 编 entry.js：`vue/node_modules/.bin/esbuild ../entry.ts --bundle --format=esm --platform=node --target=node18 --outfile=../entry.js`（参数同 `src/toon_plugins/cli.py:112`，少 `--bundle` 安卓开局超时；产物须 ESM 单文件；esbuild 把中文转义 `\uXXXX`，校验先 `src.encode().decode('unicode_escape')` 再 grep）
3. 同步 entry.js + ui/game.html 到 installed 副本 `toonflow-app-run-db/plugins/1/com.toonflow.minigame-field-survival/`，md5 一致。
- dev-host（`--conn`）进程内永久缓存 entry.js：改 entry.ts 必须重启 dev-server；前端 src 走 vite HMR。

## vite.config.ts PAGE 模板字符串三陷阱
`const PAGE = \`…\``（约 257→1893 行）是整块 JS 模板字符串：① 反引号会提前闭合模板（esbuild 报错行号误导）② **单反斜杠被直接丢弃**：`\/`→裸 `/` 让正则提前闭合 → SyntaxError 整页白屏；`\s`/`\d`→裸字母则静默失配（零报错更难查）。修法：正则反斜杠双写，或改 `new RegExp("...")`。③ `${}` 插值内是真 TS，规则不同别一起改。
- 永久门禁：`vue/scripts/check-page-template.mjs`（`npm run check:page`，已挂 build 前置），改 PAGE 必跑。
- 浏览器报 `localhost/:1536` 的数字是**渲染后 JS 行号**不是端口；dev-host 实际在 3000 端口。

## ★ 地图集是数据，前端代码表全局共享（改地图集头号陷阱）
`map_design/<故事>/<地图集>/` 只是数据目录；`mapConfig.ts`/`mockHost.ts`/`entry.ts` 的表被所有故事共用。
- 禁止往 `QUEST_MAP_SLUGS`/`MAP_MOB_LEVEL_RANGE` 加「某故事专属显示名映射」：slug 是跨故事共享 key，重复 key 后者覆盖前者会打坏别的故事。显示名一律写地图 JSON 顶层 `name`（`getLevelDisplayName` 优先读）。
- 表「只增不删」但追加前必查重（esbuild Duplicate key）。
- `THEME_BY_MAPNAME`/`currentTheme()` 查表 key 是关卡 key（slug）不是显示名；`dungeon_themes` 四槽位名 `RUINS/CATACOMBS/MINE/ICE` 不能改。
- 地图名三套写法：关卡 key（唯一能喂 switchLevel）/归一英文名/中文显示名。`toLowerCase().replace(/[^0-9a-z]/g,"")` 对纯中文名返回空串——前缀匹配恒真、相等比较误判，两处都要 `if (!compact) return 原值`。
- `forestDungeon.json` 无层号文件可能不存在；teleport 指向不存在关卡静默失败。
- 坐标 1 米/格、以图心为原点（`gx=floor(x+cols/2)`），写超不报错只「寻路后原地不动」。

## AI 托管（toonflow-field-survival）
- 链路：brain.ts → `sendTick("sys_brain")` → entry.ts `case "sys_brain"` → `ctx.tsApi.agent.run("field-survival-ai-brain",…)` → `s.chatResult{reqId,ok,text}` → persistSys。systemPrompt 用 entry.ts 顶部常量（宿主 `promptHelper` 只查 `def.prompts.ts`，插件 prompts.ts 不在解析链）；异常也必须写回包，否则前端永久 pending。
- `chatResult` 单槽位 → `brainBusy` 闸门 + 超时 8s；`tickAllAIs` 两阶段：`evaluateBrainTrigger()` + `scheduler.ts`（inFlight 闸门/P0-P2/抖动错峰/预算/失败冷却 30s/3 连败熔断 2min）。
- 战斗判据是**玩家**不是 AI 自己（感知半径仅 13m）：`damage()` 唯一入口打点 → engaged(30s)/skirmish(20m 内活敌)/none 三态，边沿触发。⚠️ 第 4 参 attacker 曾有 3 处漏传（不传则状态机是死的）。
- 间隔可配（`ai/aiConfig.ts` 落 sessionId="all"）：默认 max 20s/min 5s/engaged 5s/skirmish 10s/idle 20s；用户配置优先于地图集覆写，HARD_CEIL 60s。紧急层 `checkEmergency()` 在调度器前，不受预算/熔断限制。
- 事件引擎 `interval` 触发器（下界 2000ms/单图上限 3）+ `ai_trigger`/`ai_interval` 动作；避障走 `navStep()`（八向，AI_NAV_R=0.38，步长 TICK_DT_S）。
- 测试：smoke-combat 11/11、smoke-aiconfig 48/48、smoke-entry 14 个既有失败作基线。

## 瓦片/贴图/地图数据硬规矩
- **改地图前先跑认知技能** `.workbuddy-ai/skills/cognitive-tiles-maps`（`ctm.py <路径>`）：
  出整图渲染 + 逐格材质图 + 图集分类目录 + 候选瓦片拼图。**先看清再动手，别瞎改。**
- **图集 `category` 标签不可信**：实测 L1 地面 1580 格草地全标成 `building_wall`、L2 的 228 格树同理。
  判材质必须用**像素颜色**（绿>g+12→树/草；低饱和中性灰→石/木；暖色→木/土），别信 category。
- **`avg_color` 也会误判**（整格平均色，混合素材被当灰色）。找路面/墙面加
  **`--min-uniform 0.6`**（纹理均匀度）：路面/墙面 >0.6，家具/角色 <0.5。灰路面候选 60→6 全部正确。
- **禁止靠 gid 猜瓦片长相**：dawnlike 图集分区被打乱（9304/9305 像石板实则橙木地板）。
  正解=算法筛候选→裁图渲染目视确认→再落子。
- ⚠️ **旧结论已推翻**：「灰青砖在 5444~5574 段」是错的，那批是**深底白字招牌贴图**。
  真正的路面组：**7029/7049/12440/12447**（深灰水泥地）、**7148/7168/10031/12087**（灰蓝石板）、
  7033/7053（橄榄土面）。
- 改造前先打印逐格材质图（W 墙/屋顶、f 家具、F 地板、T 树/草、. 空地、o 对象格）；
  原型村庄建筑 L2 是实心屋顶（5610/5730/5850），改室内必须先清屋顶格；按 bbox 猜坐标必错。
- 新瓦片只落图集内连续全透明空白格且 id < tilecount(13080)，写入前断言 alpha 全 0。
- 32×32 贴图必须程序化生成（AI 生图缩到 32px 全糊；原版每格仅 12~16 色）。
- **PIL paste 是 alpha 混合不是替换**：整格替换必须 `crop`→`alpha_composite`→不带 mask `paste`；
  canvas 等价 clearRect+drawImage。
- 渲染多层地图时**每层必须透明底**再逐层 composite；给每层铺不透明底会把下层涂黑。
- ORC 半兽人 16 格在 row 44/col 12–27（5292–5307），换贴图必须整套换。
- 每地图集一份 `images/compiled_tileset_32x32.png`（描述 compiled_tileset_32x32.json）；
  `resource_library/.../base/` 是素材母版只读。运行时三级：dev 实时读盘/安装后数据库包内 png/
  兜底 `vue/public/images/`（禁放 `src/assets/images/`）。
- dev-host 不写 `map_visual:<story>`，需 `seedStoryVisualMap()`；`ensureStoryVisualMap()` 缺 3 前提
  （worldName 非空/getTemplate 存在/模板有该 key）即静默退化。
- `/story-data` 中间件 `.tbg` 走二进制分支（utf-8 读损坏 zip）；`s.items`/`s.skills` 全由
  buildItems/buildSkills(playerCard) 重建，排序落 patchCard + `s.skillOrder` + persistSys/restoreSys；
  `reportLevels()` 兜底只能报当前关，绝不能拼 `sysMapNodes`（回声环）。

## ★ dev 免安装调试地图集（2026-10-25）
- **地图面板「全部地图」只显示当前关 = 磁盘缺 `<故事>.tbg`**（不是前端 bug）。
  根因链：dev-host `seedStoryVisualMap()` 只认磁盘 .tbg → 目录形态地图集播种失败 →
  `bundle=null` → `listLevelNames()` 空（LEVEL_FILES 已清空）→ 只剩当前关。
- 修法：`vue/vite.config.ts` storyData 中间件加 `ensureTbgBuilt()`，零依赖手写 zip
  （local header + 中央目录 + EOCD，deflate-raw 用 `node:zlib`，配 crc32 查表），
  规则同 `cli.py build_tbg_file`（ZIP_DEFLATED、跳 test_data/__pycache__/node_modules/.git）。
  - 磁盘**无** .tbg → 写标准 `<故事>.tbg`（与 CLI -build 同名同位置）。
  - 磁盘**有**但源更新 → 写旁路 `<故事>.tbg.devcache`，**不覆盖用户已有 .tbg**（零破坏）。
  - ⚠️ 判断必须放在 `existsSync(filePath)` **之前**，否则旧 .tbg 永远命中、源改动不生效。
- `maps/first.map.json` 的 `start_map.value` 决定起始图：写**关卡 key（slug）**最稳
  （"Lich Lair"→lichLair→陈曦的卧室 12x12 小图；应写 "mulberryTown"→延城一中 43x56）。
- dev 调试地图集**不需要安装**：`npm run debug -- --story <故事名> --conn`，.tbg 会自动现场打包。
  需要安装的只有「装到真宿主跑」。

## map-editor / AI 厂商目录（次要子项目）
- AI 模型配置存后端 SQLite（`backend/ai_store.py`→ai_models.db）；canvas 切换显示必须 v-show 不能 v-if（模块级缓存 ctx，v-if 重建后永久黑屏）。
- 厂商目录权威源在 Toonflow-game-web `src/utils/modelConfigCatalog.ts`（22 家，已移植 map-editor）。坑：voice+asr 的 baseUrl 硬编码 dashscope；tencent_ci/local_* 要手填；`manufacturer=="aliyun"`（无 _direct）是死分支；抠图厂商 {bria, aliyun_imageseg, tencent_ci, local_*} 只能绑背景分离槽位；别在 env 写占位 MODEL_path。

## tiles-maps-editor（编排层技能，2026-10-24 建）
- 位置 .workbuddy-ai/skills/tiles-maps-editor/；串 cognitive-tiles-maps（认知）+ tile-style-change（换皮）+ map-editor（UI）
- scripts：elements.py（像素判材质/道路段/建筑轮廓/活物清单）、actors.py（对象层 CRUD，坐标是像素、NPC 复用 uid、野怪三处一致）、make_tiles.py（配方驱动程序化瓦片，id>=12900 空白段）
- 铁律承袭：改完必须看渲染图；commit_layers() 必须；屋顶可能压住真房间；路要整段统一替换
- map-editor API：POST /api/collections/{name}/maps/{map} 保存（备份固定名会覆盖）；POST /api/tile-style/override 换格贴图（改图集本体，gid 不变）
