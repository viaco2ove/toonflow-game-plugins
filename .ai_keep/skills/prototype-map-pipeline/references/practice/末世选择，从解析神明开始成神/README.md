# 实践案例 —《末世选择，从解析神明开始成神》

> 原型概念图 → 切片落地地图集 → 锚点重排 → 地图级碰撞 → 图集压缩的完整落地记录。
> 供下一个末世/废墟/营地题材故事复用；脚本在本故事地图集 `.cache/slice/`，验证有效后可晋升到技能 `scripts/`。

## 1. 地图集与产物

- 地图集根：`workshops/toonflow-field-survival/map_design/末世选择，从解析神明开始成神/`
- 两张正式地图：
  | 地图 | 尺寸 | 非空格 | Actors | 事件区 | 阻挡格 |
  |---|---|---|---|---|---|
  | `maps/mulberryTown.json`（幸存者营地） | 43×56 | 2408 | 58 | 5 | 538 |
  | `maps/mulberryForest.json`（外围废墟带） | 60×40 | 2400 | 35 | 4 | 403 |
- 图集：`images/compiled_tileset_32x32.png`，3840×3488，120 列，32px/格，tilecount 13080；4808 个唯一切片格，压缩后 **1746.3 KB**（量化前 9382.1 KB，↓81.4%）。
- 原型只读参考：`previews/幸存者营地_原型图.png`、`previews/外围废墟带_原型图.png`。
- 备份：`images/bak/`、`maps/bak/`（pre-slice / pre-anchor / pre-collision / pre-compress 时间戳）。

## 2. 路线抉择：复制成品图集切片改造，而不是从零 AI 生 tile

**结论：32px 规则下，AI 插画/照片直接缩成 tile 必糊。** 原版 dawnlike 图集每格 12–16 色、硬边像素、深色描边；大尺寸俯视插画切块缩到 32×32 会带上千色渐变与抗锯齿糊边，放进地图一眼假。

本故事最终走的路线（在“复制成品图集改”与“从零定制图集”之间取前者）：
1. 原型图 resize 到地图像素尺寸；
2. 按 32px 切块，MD5 去重；
3. 唯一切片分配到图集尾部全透明空白格，贴入；
4. 地图层 gid 指向切片格；清空原 L1/L2 道具障碍层；Actors、eventZones 原样保留。

**已知代价**：切片格是插画质感，不是硬边像素风，与基础格画风存在差异；这是为“100% 还原原型布局/配色”接受的权衡。若要纯像素风，只能走 `make_tiles.py` 程序化逐像素画（见 `tiles-maps-editor/references/tilemaking.md`），不能用 AI 生图。

## 3. 落地流水线与关键做法

### 3.1 认知现状（必做，不可跳）
- `cognitive-tiles-maps/scripts/inspect_map.py <map.json>` 出整图 PNG、分层图、`material.txt`、`report.md`。
- **坑：`material.txt` 的材质符号和图集 `category` 标签在切片插画上不可靠。** 实测本故事废墟 L2 大量地面被误判成 `T`（树）。分类只能当弱提示，身份以网格原型图 + 图集联系表目视为准。

### 3.2 原型只做布局/锚点，不直接贴 tile
- 原型用于定房间分区、NPC/道具落点、配色氛围；不能作为游戏内贴图。
- 叠 32px 坐标网格（红粗线每 5 格、黄字号行列号）后再读坐标，避免凭 bbox 猜位置。网格产物：`.cache/slice/grid/<stem>_grid.png`。

### 3.3 切片进图集
- 脚本：`.workbuddy-ai/skills/prototype-map-pipeline/scripts/slice_to_atlas.py`（JOBS 内联两图宽高）。
- **gid ≠ tile index**：本项目 `firstgid=1`，`gid = tile_index + 1`；后端 override 的 `tileId` 是 0-based index，别再 +1。
- 新 tile 只落尾部连续全透明空白格；写入前断言落点 alpha 全 0；id 必须 < tilecount（13080）；写后校验图集尺寸不变。
- 整格替换用 `alpha_composite` + 不带 mask 的 `paste`（带 mask 是 alpha 混合，会留幽灵像素）。

### 3.4 锚点重排（Actors / 事件区）
- 脚本：`.cache/slice/remap_anchors.py`，内联 `TOWN_ACTORS / FOREST_ACTORS` 格位字典与事件区字典。
- 做法：按对象 **id** 指定新格位，只改 `x/y` 像素（= 格×32）；保留 gid、properties、类型、名称、level、uid；未列入字典的对象保持原位。
- 流程：先 dry-run 对照新旧格位 → 修正重叠（曾出现 NPC 与餐桌撞同一格）→ `--apply` 落盘并备份。
- 事件区按 `x,y,rx,ry` 整体平移到对应房间。

### 3.5 碰撞（地图级位图，通用、不绑图集）
- 引擎改动：`plugins/toonflow-field-survival/vue/src/collision.ts`
  - 新增 `TiledCollisionSource`：`{ width?, height?, layers?, blockedCells?, visionCells? }`。
  - `buildWalkGrid` / `buildWalkGridAsync` 在叠加 tile 标志之后，再 OR 地图级 `blockedCells` / `visionCells`（Array.isArray 守卫，长度截到 cols×rows）。
  - 这样手绘地图/无图集标志的地图也能带碰撞，不必往图集属性表逐 gid 登记。
- 掩码脚本：`.cache/slice/gen_mask_v2.py`（v1 为 `gen_mask.py`）。
- **掩码规则**：
  - 外围 1 圈边界阻挡；
  - 建筑 `border`：只挡北/东/西墙，**南墙留作入口**，避免把室内封成死口袋；
  - `solid` 整格挡（水体、实心塔）；
  - `PROP_RECTS` 实心道具整格挡（车辆、帐篷、木料堆、市场摊棚、营火、沙袋）；
  - **所有对象格（NPC/怪/宝箱/门/传送/梯子/出生）一律排除、必须可走**——阻挡只来自几何与道具，不能压住对象自身站立格；
  - 树木、残墙碎块、路灯视为可穿行掩体，v1 不挡。
- **校验（每次落盘前必跑）**：
  - 4 邻接 BFS 从出生点扩散，报主连通域、孤立格数；
  - 列出被挡的交互格、不在主连通域的交互格；
  - 列出被压在阻挡格上的对象；
  - 校验每个事件区至少有一格在主连通域内。
- 本故事结果：营地 阻挡 538 / 可走 1870 / 孤立 0；废墟 阻挡 403 / 可走 1997 / 孤立 0；出生点与全部事件区可达。
- **坑：夜景亮度阈值分不开墙/地面/室内**（整体偏暗，p50≈53），纯像素分类不可靠；掩码走“手工矩形分区 + 边界 + 水体 + 对象排除”的可控规则。
- **坑：实心塔会把塔基出口门/传送封成孤岛。** 瞭望塔最初用 `solid`，导致营地口门与 Level Transition 不可达；改成 `border` 留南口后连通。

### 3.6 图集压缩（调色板量化）
- 脚本：`.cache/slice/compress_atlas.py`；候选实验 `compress_experiment.py`，色差指标 `compress_metrics.py`、`base_diff.py`、`render_diff.py`。
- 前提：先统计 alpha 分布。本图集半透明像素仅 1485 / 13.4M（0.011%），基本二值，可安全走调色板。
- 做法：alpha 二值化（≥128 归 255，否则 0）→ `convert("P", ADAPTIVE, colors=256, FLOYDSTEINBERG)` → optimize + compress_level=9，原子替换。
- 选型对比：rgba optimize 只降到 9191 KB；pal256/192/128/96 体积都在 1.72–1.75 MB（切片渐变主导熵，颜色数对体积影响很小）；**pal256 色差最小**。
- 落盘前断言：尺寸不变 3840×3488；非空格数不减少（12110 格零丢失）；空白格回读仍全透明。
- 色差核验（orig vs 量化后，不透明像素 RGB 三通道绝对差）：切片 mean 8.49 / p95 22 / max 84；基础格 mean 6.49 / p95 21；仅 2 个基础格均值差 >30（max 39），严重像素(>60) 占比 0.0%。两图整图重渲 mean ≈11（单通道约 3.7），p95≈24，无结构性掉块。
- 运行时图集走 `new Image()` + `drawImage`，浏览器自动解码调色板 PNG，无 RGBA 模式强制要求。

### 3.7 打包上传 .tbg 防 413 Payload Too Large

- 现象：`plugin_session_data -u <地图集目录>` 把目录打成 .tbg 再 base64 塞进 `/plugin/data` 的 JSON body；临时/备份素材被一起打进包，包涨到 ~104MB，base64 后 ~139MB，服务端 express jsonParser 直接 **HTTP 413**。
- 根因：CLI `build_tbg_file` 与 vite dev-host `zipDirToBuffer` 原先只跳过 `test_data/__pycache__/node_modules/.git`；`.cache/`（切片/渲染临时图 ~85MB）、`images/bak/`、`maps/bak/`、`previews/`、`*.original.png` 原图 master、已生成的旧 `.tbg/.tbg.devcache` 全被打包。
- 修法（两边口径一致，已落到 `cli.py` 与 `vite.config.ts`）：
  - 跳过目录：追加 `.cache`、`bak`、`previews`；
  - 跳过单文件：`*.original.png`、`*.tbg`、`*.tbg.devcache`、`*.bak`、`*.pre-*`、`data.xlsx`；
  - 运行时只消费 `maps/ images/ events/ data/ overrides/ maps/prefabs maps/utils/` 与根 `story.json/entity_types.json/compiled_dawnlike.json`，备份与参考稿不随包分发。
- 本故事实测：瘦身前 1255 文件 / 104MB；瘦身后 **1069 文件 / tbg 4.02MB（base64 ~5.62MB）**，`map_visual:<故事>` 与兼容 `map_data:<故事>` 均落库成功，`chain_defs` 补种 8 条、`quest_defs` 12 条。
- 校验：解包 .tbg 确认无 `.cache/ bak/ previews/` 混入、关键运行时文件（story/entity_types/compiled_dawnlike/图集 png/两张正式地图）齐全；服务端 body 上限默认 100mb（`JSON_BODY_LIMIT` 可配），包体务必留足余量。

### 3.8 碰撞开关 ignoreTileFlags 与采集寻路的通用口径

**碰撞：图集旧标志挡 vs 地图级掩码。**
- 基础 dawnlike 图集把原版墙/栅栏/废墟/树木/水瓦片都标了 `blocked`；切片换皮后旧墙瓦片被铺到开放地面，旧标志仍判挡，在废墟路面连成多条横向长条空气墙。本故事的几何/道具障碍已由地图级手工掩码 `blockedCells` 表达，图集旧标志反而成为误挡来源。
- 通用修法（`vue/src/collision.ts`）：碰撞网格加可选开关 `ignoreTileFlags`，默认 `false`（保留旧图集标志叠加，旧关卡行为不变）；地图 JSON 顶层声明 `"collision": {"ignoreTileFlags": true}` 时跳过旧图集 blocked/vision/bed 标志，只叠加地图级掩码。
- 本故事两张正式地图（mulberryTown / mulberryForest）写了该开关；旧保留关卡不写，行为不变。掩码-only 连通性校验：镇 阻挡 538 / 可走 1870 / 孤立 0；林 阻挡 403 / 可走 1997 / 孤立 0，出生点、事件区、对象格全部可达。

**采集寻路：物品→采集区映射必须运行时从故事包推导，禁止写进插件源码。**
- 旧做法是在插件 `questGatherMap.ts` 里维护一张静态硬编码表（物品名→区名），换故事就得改插件源码，且会把故事业务漏进通用代码——已废弃。
- 通用契约：采集区与产出物由故事包事件定义声明，插件只读不写：
  - 事件触发器 `trigger.type = "area_enter"`、`trigger.zone`（与地图 `eventZones[].name` 逐字一致）、`trigger.ai.gather`（herb/fish/wood/ore/other）、`trigger.ai.items`（该采集区实际产出的物品名清单）。
  - 插件侧 `gatherZonesFromEvents(target, events, mapKey?)` 从已加载事件里反查：目标物品与 `ai.items` 精确相等或双向包含即命中该区；未声明 `items` 的区不臆测产出物。
  - AI 地图知识（`mapKnowledge.ts`）同样读 `ai.items`，在采集区摘要里带上产出清单，不写死物品名。
- 本故事三张采集事件的 `ai.items`（故事包 `events/maps/*.events.json`）：
  - mulberryTown `食堂补给区` herb：药草、止血草药、当归草、药品（SY_E02）
  - mulberryTown `木料堆` wood：木料、加固木料（SY_E08；朽木仅 toast 不入包，不登记）
  - mulberryForest `废墟药草` herb：止血草药、药草（SY_E18）
- 配套：宿主构造前端任务视图时必须透传 objective 的 `uid`（`questView`/`chainView` 两处映射），对话寻路才能按 uid 精确命中，退化到名字匹配只是兜底。
- 边界：当前只解析当前图已加载事件；跨图采集区寻路需落地新图后事件重载再解析，v1 不做跨图预取。

## 4. 数据与接口约定

- 后端 `GET/POST /api/collections/{name}/maps/{map}`；`{name}` 是中文地图集名，URL 必须 `encodeURIComponent`。
- 保存接口 body 是**完整 Tiled JSON**（不是 diff）：GET 拿到 dict → 改完整体回传；后端原样 `json.dump`，未知顶层字段（如 `blockedCells`/`visionCells`）不会被丢弃。
- 改图层数据必须回写 raw：`MapFile.load()` 会拷贝 `layer.data`，只改内存层不落盘；直接 `json.load → 改 layers[].data → json.dump`，或走后端保存接口。
- dev 模式后端每次请求直读 workshops 磁盘，本地文件改动刷新即生效，无需重构建。

## 5. 踩坑清单（铁律）

1. 禁止靠 gid 猜瓦片长相：先算法筛候选，再开联系表目视确认。
2. 禁止靠 bbox 猜坐标：坐标以叠网格的原型图 / `material.txt` 为准；切片插画上材质分类不可靠。
3. 32×32 tile 必须程序化生成或复用成品，不用 AI 生图；每格 ≤20 色、硬边、描边完整。
4. 新 tile 只落尾部连续全透明空白格，id < tilecount；写前断言 alpha 全 0。
5. 整格替换 `alpha_composite` 不带 mask；写后校验图集尺寸未变。
6. 落地前先备份到 `maps/bak/`、`images/bak/`。
7. Actors / 事件区数量不得无故增删；落地后校验 `len(data)=width*height`、所有 gid < tilecount。
8. `kingdom.json` 是 base64+zlib 编码，gid 高位带 Tiled 翻转标志位；真实 gid = `g & 0x1FFFFFFF`，扫描脚本未掩码时会报假越界，勿当回归。
9. 图集描述 `compiled_tileset_32x32.json` 的 `category`/`avg_color` 仅供弱提示；像素内容才是判断依据。
10. 上传 .tbg 前先确认 `.cache/ bak/ previews/`、原图 master、旧包本体都被打包器排除；否则包体暴涨触发服务端 413（详见 3.7）。

## 6. 本故事遗留（v1 近似，未做）

- 物体级碰撞是 v1：车辆/帐篷/摊棚/木料堆/营火已挡；树木、残墙碎块、散落碎石、路灯仍可穿行。要逐件挡需再定掩膜来源（手工分区 vs 像素启发式比例）。
- 室内家具（桌椅/货架/床铺）目前不逐格挡，室内整体可绕行。
- `collision.ts` 是插件源码：打包进宿主后，下次构建/同步才会在正式游戏强制碰撞；5176 编辑器只读地图数据，不跑这套碰撞。
- 数据库 / 打包宿主同步本轮未做（用户明确后置）；当前改动只在本地 dev 生效。
- 早期遗留：`data.xlsx` 未随 entity_types 重生成；遗留空图去留未定；黑市是否独立成图；林悦是否在地图集落实体；`images.json` 备用角色帧标签未对应新角色；图集描述 json 未补新切片条目。
- 包内保留底图故事的旧关卡地图（`oldForest/overworld/*Dungeon*/kingdom/...` 共约 20 张）及 prefabs/utils，**按要求全部保留**，不做精简；本次瘦身只排除 `.cache/ bak/ previews/` 临时与备份素材，正式地图与既有关卡一律随包分发。
- 后端 `entry.ts` 的 `QUEST_GATHER_ALIAS` 仍是旧故事「上位词→具体物名」硬编码别名表（木材/药材/草药 → 松木/夜合花/血参…）。本故事 MCQ101「药草」与脚本产出精确相等，不依赖该表；但按「故事业务不入插件」口径，后续应把别名展开也改为运行时从事件 `ai.items` 推导（后端需先能读到已加载事件）。保留期间旧关卡采集任务仍依赖它，删除前先确认无旧关引用。
- 碰撞开关已在 :3000 调试宿主实况确认：日志「43×56 阻挡 538（22.3%）、主连通域 1870 / 共 1 连通域」=掩码-only 计数（叠加旧图集标志应为并集 574），证明 `ignoreTileFlags` 运行时生效、旧图集标志未再压路面；dev 通道 `mulberryTown.events.json` 实测下发 `ai.items`（E02 药草/止血草药/当归草/药品，E08 木料/加固木料）。
- 采集寻路推导、`uid` 透传已在源码/数据/打包/resolver 单测层校验通过；**仅剩宿主点击实测**：玩家出生点距任务板(768,1504) 约 11 格，需走近任务板出「📜 任务」按钮、接 MCQ101「药草×3」后，观察采集寻路「前往」按钮是否命中食堂补给区；跨图采集区待进图后事件重载再解析。

## 7. 可复用脚本（位于地图集 `.cache/slice/`）

| 脚本 | 作用 | 晋升建议 |
|---|---|---|
| `gen_mask_v2.py` | 生成/校验/落盘地图级碰撞掩码（边界+建筑边框+实心+道具+对象排除，连通域校验） | 晋升为技能通用脚本，矩形/道具表走外部 JSON 配置 |
| `remap_anchors.py` | 按对象 id 字典重排 Actors 与事件区，dry-run/--apply | 晋升；字典改外部 JSON |
| `compress_atlas.py` | 图集 alpha 二值化 + pal256 量化落盘，非空格零丢失断言 | 晋升到 tile 样式/图集工具集 |
| `compress_experiment.py` / `compress_metrics.py` / `base_diff.py` / `render_diff.py` | 压缩候选生成与色差/整图对比指标 | 随压缩脚本一并晋升 |
| `check_actor_block.py` / `check_zone_reach.py` | 对象是否被挡、事件区是否可达校验 | 并入掩码脚本的校验段 |
| `gid_scan.py` | 全图 gid 边界扫描（注意翻转位掩码） | 修正翻转位后晋升 |
| `final_stats.py` | 汇总地图尺寸/对象/区/阻挡/图集体积 | 可选 |
