---
name: toon-maps-modification-workflow
description: 把一张概念原型图（或故事设定）落地成 toonflow 地图集的编排层工作流。先认知现状与素材，再把原型要素逐条做缺口分级（现成图块 / 可换色 / 需程序化补 tile / 需补实体），按 A 纯数据重排、B 关键贴图替换、C 整体重绘三档执行，改完必须渲染截图自查并同步。当用户要求「按原型图改造地图」「把概念图落到地图集」「这张图该怎么改进游戏」「营地/废墟/现代场景地图换皮落地」时使用。上游复用 cognitive-tiles-maps、tiles-maps-editor、tile-style-change、toon-maps-renderings。
agent_created: true
---

# toon-maps-modification-workflow — 原型图落地地图集工作流

## 定位

编排层技能：**不重复实现底层能力**，把上游技能串成一条可复核的落地流水线。

| 阶段 | 上游技能 / 脚本 | 提供什么 |
|---|---|---|
| 认知现状 | `cognitive-tiles-maps` | 地图整图/分层/逐格材质图、图集分类与空段、候选瓦片筛选 |
| 缺口分级 | 本技能 `scripts/gap_report.py` + `references/gap-analysis.md` | 原型要素 → 素材状态清单（现成 / 换色 / 缺 tile / 缺实体） |
| 执行改造 | `tiles-maps-editor` | 元素识别、墙边标注、落子、Actors 增删、程序化补 tile |
| 换皮相 | `tile-style-change` | 保形换色、程序化精灵换皮、落盘同步 |
| 概念稿 | `toon-maps-renderings` | 上游产物：改造前/后的概念效果图 |

**核心原则：先看清、再分级、后动手；每一步改完都要渲染看图。**
禁止在没看清现状和素材的前提下，凭 gid 猜瓦片长相、凭 bbox 猜坐标。

## 输入三要素（缺任一先补齐）

| 输入 | 典型位置 | 用途 |
|---|---|---|
| 故事设定 | `map_design_pre/<故事名>/*.md`、世界书 | 分区功能、角色、氛围关键词 |
| 原型概念图 | 地图集 `previews/*.png`（toon-maps-renderings 产物） | 目标布局、建筑功能、材质与氛围 |
| 地图集目录 | `workshops/toonflow-field-survival/map_design/<故事名>/` | 待改造的 maps/images/entity_types/events |

## 环境约定

```sh
PY="C:/Users/viaco/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe"
# 若该解释器不可用，回退项目内带 PIL 的 venv python（见仓库 .env / 既有脚本记录）
ROOT="<插件仓库根>"
SK="$ROOT/.aispace/workbuddy-ai/skills"
MAPSET="$ROOT/workshops/toonflow-field-survival/map_design/<故事名>"
```

地图集目录结构（`MAPSET`）：

```
MAPSET/
├─ maps/<slug>.json            # 地图本体（gid 扁平列表 + Actors 对象层 + eventZones）
├─ images/compiled_tileset_32x32.png     # 运行时图集（120 列 × 109 行，32px/tile）
├─ images/compiled_tileset_32x32.json   # 图集分类/空段描述
├─ entity_types.json           # 活物定义（enemies/special/non-hostile/item_types）
├─ events/                     # 事件脚本与任务
└─ previews/                   # 概念原型图（只读参考，不是游戏内贴图）
```

---

## 实践经验
prototype-map-pipeline 技能的 references/practice

## 工作流

### 第 0 步：定位地图集与原型

确认 `MAPSET` 下 `maps/`、`images/`、`entity_types.json` 就位；记录要改的地图 slug 清单。
原型图只作**布局与功能参考**，不是可直接贴进图集的素材——32px tile 必须程序化生成（见 `tiles-maps-editor/references/tilemaking.md`）。

### 第 1 步：认知现状（必做，不可跳过）

```sh
# 地图：整图渲染 + 分层 + 逐格材质图 + 结构报告
"$PY" "$SK/cognitive-tiles-maps/scripts/inspect_map.py" "$MAPSET/maps/<slug>.json"
# 图集：总览拼图 + 分类目录 + 可用空段
"$PY" "$SK/cognitive-tiles-maps/scripts/inspect_tileset.py" "$MAPSET/images/compiled_tileset_32x32.png"
```

必须亲自 Read 打开：整图 PNG、`material.txt`、`report.md`、`categories.md`。
看清：哪块是地面/建筑/树/路/对象，哪些格是空地，图集尾部有哪些连续空白格可补新 tile。

### 第 2 步：拆解原型要素并做缺口分级

把原型图 + 故事设定拆成要素清单（terrain / structure / prop / vegetation / actor / trigger），
逐条判定素材状态。先跑确定性脚本出骨架，再人工看图确认：

```sh
"$PY" "$SK/toon-maps-modification-workflow/scripts/gap_report.py" \
  --mapset "$MAPSET" --elements 原型要素清单.json --out "$MAPSET/../<故事名>.gap.md"
```

分级口径（详见 `references/gap-analysis.md`）：

| 状态 | 含义 | 后续动作 |
|---|---|---|
| **R** 现成 | 图集已有该图块，或 entity_types 已有该实体 | 直接在地图数据层落子/放置 |
| **C** 可换色 | 形状可复用，只需换配色 | 走 `tile-style-change` 保形换色 |
| **M** 缺 tile | 图集内没有该道具/地形图块 | 走 `tiles-maps-editor/scripts/make_tiles.py` 程序化补 tile |
| **E** 缺实体 | 活物类型未在 entity_types.json 定义 | 先补实体定义，再在 Actors 层放置 |

> 脚本只做名字/ gid 的机械匹配；「这块图块长得像不像」必须开候选拼图目视确认，不靠算法下结论。

### 第 3 步：定档并向用户说明（不要替用户拍板成本档）

对照 `references/modification-tiers.md`，给出三档方案与取舍：

- **A 纯数据重排**：只改 `maps/*.json` 的 gid / Actors，零贴图改动，最快、可逆。
- **B 关键贴图替换**：保形换色，或程序化补少量缺失 tile（中成本）。
- **C 整体重绘**：大规模新素材或重构布局（高成本，先补概念稿逐区确认）。

说清三件事：现状长什么样、目标长什么样、每档的代价与遗留风险。

### 第 4 步：执行改造

#### A 档：纯瓦片/对象重排（零贴图）

- 元素识别与墙边定位：
  ```sh
  "$PY" "$SK/tiles-maps-editor/scripts/elements.py" "$MAPSET/maps/<slug>.json"
  "$PY" "$SK/tiles-maps-editor/scripts/mark_edges.py" "$MAPSET/maps/<slug>.json"
  ```
- 候选瓦片：`cognitive-tiles-maps/scripts/find_tiles.py` 筛候选 → 开拼图目视确认 gid。
- 落子按 `material.txt` 逐格材质图定位，不靠 bbox 猜。
- 活物（NPC/野怪）走 `tiles-maps-editor/scripts/actors.py`：
  ```sh
  "$PY" "$SK/tiles-maps-editor/scripts/actors.py" "$MAPSET/maps/<slug>.json" --list
  "$PY" "$SK/.../actors.py" "$MAPSET/maps/<slug>.json" --add-npc \
      --entity-type "<TYPE>" --name "显示名" --at <x,y> --uid <复用uid>
  ```

#### B 档：关键贴图替换

- 保形换色（建筑/地形/家具，形状不变只换色）：
  ```sh
  "$PY" "$SK/tile-style-change/scripts/skin_recolor.py" --story "<故事名>" \
      --name "stone wall" --palette dark --preview /tmp/p.png   # 先预览
  "$PY" "$SK/tile-style-change/scripts/skin_recolor.py" --story "<故事名>" \
      --name "stone wall" --palette dark                         # 落盘
  ```
- 程序化补 tile（图集缺的道具/地形）：先写配方 JSON，dry-run → preview 看图 → 写入：
  ```sh
  "$PY" "$SK/tiles-maps-editor/scripts/make_tiles.py" --mapset "$MAPSET" --plan 配方.json --dry-run
  "$PY" "$SK/tiles-maps-editor/scripts/make_tiles.py" --mapset "$MAPSET" --plan 配方.json --preview /tmp/tiles.png
  "$PY" "$SK/tiles-maps-editor/scripts/make_tiles.py" --mapset "$MAPSET" --plan 配方.json
  ```
  末世/废墟题材可复制本技能 `assets/post_apoc_plan.json` 改色与构图。

#### C 档：整体重绘

先回到 `toon-maps-renderings` 出分区概念稿并逐区确认，再按 B 档补素材、A 档重排。
不要在概念稿未确认前批量生成 tile 或重排布局。

### 第 5 步：验证（必做，看图）

```sh
"$PY" "$SK/cognitive-tiles-maps/scripts/inspect_map.py" "$MAPSET/maps/<slug>.json"
```

Read 打开渲染 PNG 亲眼看；整图看不出问题就裁局部 3 倍放大（NEAREST）再看。
自检清单见 `references/modification-tiers.md` 的「验证清单」。

### 第 6 步：同步（仅当改动落到 installed 副本）

- 纯数据层（只改 json）：dev 模式刷新即生效，不用重构建。
- 图集 png 改了：同步 `vue/public/images/` 等副本；必要时重打 `.tbg` 上传。
- 改了 `entry.ts`：`npm run build` → esbuild `entry.js` → 同步 md5。
- 野怪/新实体三处一致：`entity_types.json` 定义、Actors 的 `entity_type`、头顶 `full_name`。

---

## 铁律（踩过坑换来的，详见上游技能）

1. **改完必须看渲染图**。脚本打印的 gid/格数全对，也可能砖块乱飞、物件悬空——只有看图能发现。
2. **禁止靠 gid 猜瓦片长相**；先算法筛候选（路面/墙面加 `--min-uniform` 滤杂物），再目视确认。
3. **禁止靠 bbox 猜坐标**；坐标以 `material.txt` 逐格材质图为准。
4. **gid ≠ tile index**：本项目 `firstgid=1`，即 `gid = tile_index + 1`；新瓦片对照表直接用 make_tiles 输出的 gid。
5. **32×32 tile 必须程序化生成**，不用 AI 生图；每格 ≤20 色、硬边像素、描边完整。
6. **新 tile 只落图集尾部连续全透明空白格**，id < tilecount（13080）；写入前断言 alpha 全 0。
7. **跨图集 gid 不通用**：同一 gid 在不同 tileset 变体里像素含义可能不同，禁止从别的图集盲抄 gid。
8. **改图层数据必须回写 raw**：`MapFile.load()` 拷贝了 `layer['data']`，直接改内存层不落盘；用 `commit_layers()` 并断言新 gid 进了数据再保存。
9. **备份优先**：地图 json / 图集 png 改动前先确认 `maps/bak/`、`images/bak/` 有备份。
10. **原型图 ≠ 游戏内贴图**：原型里出现而图集与实体表都没有的要素（车辆、帐篷、瞭望塔、黑雾等），必须先判定为 M/E 档补素材，不能在 JSON 里凭空放置。

## 参考

- `references/gap-analysis.md` — 原型要素拆解模板、四级状态判定、末世题材要素清单
- `references/modification-tiers.md` — A/B/C 档位判定、命令、数据铁律、验证与同步清单
- `assets/post_apoc_plan.json` — 末世废墟 tile 程序化配方示例（沥青/残墙/枯丛/帐篷/沙袋/瞭望塔/翻修车/黑雾）
- 上游：`../cognitive-tiles-maps/`、`../tiles-maps-editor/`、`../tile-style-change/`、`../toon-maps-renderings/`
