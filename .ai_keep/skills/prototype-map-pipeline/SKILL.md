---
name: prototype-map-pipeline
description: 从地图原型概念图出发，规划切图并落地到 toonflow 地图集、在本地地图编辑器(5176)直接出图的流水线。先分析原型图要素与地图现状，逐项判定「复用现有 tile / 换色 / 新增素材」，再按通道落到地图 JSON 或图集，最后在编辑器刷新看图验证。当用户要求「按原型图把地图做出来」「原型切图落到地图」「分析这张原型图该用哪些素材」「替换还是新增素材」「改完在编辑器里看效果」时使用。上游复用 cognitive-tiles-maps（认知）、tiles-maps-editor（落子/补 tile）、tile-style-change（换色）、toon-maps-modification-workflow（缺口分级）。
agent_created: true
---

# prototype-map-pipeline — 原型图 → 切图规划 → 落地地图 → 编辑器出图

## 定位

编排层技能：把一张原型概念图（或故事设定）变成编辑器里可见的地图。
核心闭环：**看清现状 → 拆原型要素 → 判定素材去向 → 落地 → 在 5176 编辑器出图自查**。

| 阶段 | 复用上游 | 产出 |
|---|---|---|
| 认知现状 | `cognitive-tiles-maps` | 整图/分层/材质图、gid 联系表 |
| 要素拆解 | 本技能 `scripts/plan_from_prototype.py` | 原型要素 → 区域 → 素材判定规划表 |
| 素材落地 | `tiles-maps-editor` / `tile-style-change` / 后端 API | 改 JSON、补 tile、override 贴图 |
| 出图验证 | 编辑器 5176 + `inspect_map.py` | 编辑器可见渲染 + 局部对比 |

## 环境约定

```sh
# 后端（FastAPI，读 MAP_ROOT）
#   GET  http://127.0.0.1:8000/api/health
#   前端 http://127.0.0.1:5176/
PY="<带 PIL/fastapi 的解释器>"   # 后端实际用 miniconda3 python；脚本侧可用项目 venv
ROOT="<插件仓库根>"
SK="$ROOT/.workbuddy-ai/skills"
MAPSET="$ROOT/workshops/toonflow-field-survival/map_design/<故事名>"
```

后端 `MAP_ROOT = workshops/toonflow-field-survival/map_design/`，编辑器 5176 直接读该目录的
`maps/*.json` 与 `images/compiled_tileset_32x32.png`。**文件落盘后编辑器刷新即见**，无需重新构建。

## 硬约束（踩过坑，别违反）

1. **原型图不能直接切成 32px tile。** 原型是大尺寸俯视插画，直接切块缩到 32×32 会有上千色渐变、糊边，和原版像素风（每格 12–16 色、硬边）不搭。原型只用于定**布局、分区、配色锚点**；tile 只能走三条通道（见第 4 步）。
2. **gid ≠ tile index**：`firstgid=1`，地图 JSON 里用 **gid = index + 1**；后端 override 的 `tileId` 是 **index（0-based）**，别再 +1。
3. **禁止靠 gid 猜长相**：先裁 gid 联系表目视确认；禁止靠 bbox 猜坐标，坐标以 `material.txt` 为准。
4. **改图层数据必须回写 raw**：`MapFile.load()` 会拷贝 `data`，只改内存层不落盘；直接 `json.load → 改 layers[].data → json.dump`，或走后端保存接口。
5. **落地前备份**：地图 json、图集 png 改动前确认 `maps/bak/`、`images/bak/` 有备份；后端保存接口会自动备份到 `maps/bak/<map>.json.bak`。
6. **每步必须看图**：脚本统计的 gid/格数全对，也可能砖块乱飞；落地后在 5176 刷新 + `inspect_map.py` 渲染，局部放大核对。
7. **Actors / 事件区数量不得无故增删**；落地后校验 `len(data)=width*height`、所有 gid < tilecount。

## 工作流

### 第 0 步：确认编辑器在线、定位地图集

```sh
curl http://127.0.0.1:8000/api/health
curl "http://127.0.0.1:8000/api/collections"          # 确认目标故事在列
```

- 后端没起：`cd src/tools/toonflow-field-survival/map-editor/backend && python server.py local`
- 前端没起：`cd .../map-editor/frontend && npm run dev`（端口 5176）
- 记录目标地图集名（collection，中文）与目标地图 slug。

### 第 1 步：认知现状（必做）

```sh
"$PY" "$SK/cognitive-tiles-maps/scripts/inspect_map.py" "$MAPSET/maps/<slug>.json"
```

Read 打开整图 PNG、`material.txt`、`report.md`。再用本技能 `scripts/dump_gids.py`（或上游 `find_tiles.py`）
把现状高频 gid 裁成联系表，**目视**判定每个 gid 是草地/土路/地板/墙/屋顶/树/灌木/装饰/栏杆/水面。

### 第 2 步：拆原型要素

打开原型图（`$MAPSET/previews/*.png`），按类别列要素清单，写成 JSON（模板见
`assets/elements_example.json`）：

| 类别 | 说明 |
|---|---|
| terrain | 地面、道路、水面 |
| structure | 墙体、屋顶、围栏、台阶 |
| vegetation | 树、灌木、草 |
| prop | 道具、车辆、帐篷、摊棚、塔、沙袋 |
| decoration | 花、落叶、蝴蝶、装饰 |
| actor / trigger | NPC、野怪、事件区（走实体表，不在 tile 层） |

每条要素记：名称、所在区域（对照事件区名/坐标）、原型里的样子、配色关键词。

### 第 3 步：规划切图 + 素材判定

跑规划脚本，把现状 gid 用量与要素清单对齐，出规划表：

```sh
"$PY" "$SK/prototype-map-pipeline/scripts/plan_from_prototype.py" \
  --mapset "$MAPSET" --map <slug>.json --elements elements.json \
  --out "$MAPSET/.cache/plan_<slug>.md"
```

逐条要素判定（口径同缺口分级）：

| 状态 | 含义 | 落地通道 |
|---|---|---|
| **R 复用** | 图集现有 tile 形状/配色可用 | 第 4 步 A：JSON gid 映射/落子 |
| **C 换色** | 形状可复用，配色不符 | 第 4 步 B：`tile-style-change` 保形换色 |
| **M 新增** | 图集没有该形状 | 第 4 步 C：程序化补 tile 或 override 贴图 |

> 脚本只做机械匹配；「长得像不像」必须开联系表目视确认后再定 R/M。

### 第 4 步：落地（三条通道）

#### A. 纯数据（R 复用，零贴图改动）

改 `maps/<slug>.json` 的 gid：地面/墙体/植被按规划表映射，道具落到空地格（L1 非空、L2=0）。
两种写盘方式：

- **走后端保存接口（推荐，自动备份）**：
  `POST /api/collections/<collection>/maps/<slug>`，body = 完整 Tiled JSON dict。
- **直接写 raw**：`json.load → 改 layers[].data → json.dump`，断言新 gid 进了数据再落盘。

#### B. 换色（C）

```sh
"$PY" "$SK/tile-style-change/scripts/skin_recolor.py" --story "<故事名>" \
  --name "<对象英文名>" --palette dark --preview /tmp/p.png   # 先预览
"$PY" "$SK/tile-style-change/scripts/skin_recolor.py" --story "<故事名>" \
  --name "<对象英文名>" --palette dark                         # 落盘
```

#### C. 新增素材（M）

- **程序化 32×32（首选）**：写配方 JSON，`make_tiles.py --dry-run` → `--preview` 看图 → 写入图集尾部空白格，产出 gid 对照表。规范见 `tiles-maps-editor/references/tilemaking.md`。
- **override 贴 32×32 小图**：后端接口把一张 32×32 透明 PNG 贴到图集指定格：
  ```
  POST /api/tile-style/override
  { "material": "<collection 名>", "tileId": <index 0-based>,
    "image_base64": "<dataURL 或裸 base64>", "prompt": "...", "model": "..." }
  ```
  后端自动备份整图集 + 存档该格原始像素，写 `overrides/<tileId>.png` 与 `styleOverrides`。

### 第 5 步：编辑器出图

- 地图 JSON 改动：编辑器左侧选图，点「刷新」或重进地图，5176 即见。
- 图集 png 改动：编辑器刷新 tileset 面板；若前端缓存旧图集，硬刷新页面。
- 再跑 `inspect_map.py` 出整图/局部放大，对照原型检查：改动落在预期位置、道路连续、无悬空/穿帮、Actors 与事件区数量不变。

### 第 6 步：不达标就回第 3 步

局部放大仍穿帮（砖块乱飞、道具悬空、配色突兀）→ 回到规划表调整映射/素材，不要在错误素材上继续铺。

## 脚本清单

| 脚本 | 作用 |
|---|---|
| `scripts/plan_from_prototype.py` | 读地图现状 gid 用量 + 要素清单，输出 R/C/M 规划表 Markdown |
| `scripts/dump_gids.py` | 裁指定 gid 拼带标注联系表，目视判身份 |
| `scripts/preview_map.py` | 按映射表在内存副本变换并渲染，不落盘，落地前出对比图 |
| `scripts/apply_map.py` | 按映射表改 JSON（备份→改 data→校验），可走后端保存接口；支持变体列表轮换与稀疏化 |

## 边界

- 只改当前地图集；跨图集 gid 不通用，禁止从别的图集盲抄 gid。
- 角色/NPC 走 Actors 层与 `entity_types.json`，不在 tile 层处理。
- 原型图 ≠ 游戏内贴图；原型里出现而图集/实体表都没有的要素，先判 M/E 补素材，不能在 JSON 里凭空放 gid。

## 道路和任务寻路修复
### 例子：
- 1.很多通道和路有空气墙，这个需要检查一下
  - 先把碰撞掩码的现状量化：两张图的 `blockedCells`/`visionCells` 长度、阻挡格数、主连通域、以及阻挡来源（图集标志 vs 手工掩码）。
  - 验证连通性参数
  连通域基本完整（镇 0 孤立，废墟 1 个孤立格）。废墟有 195 格是图集标志单独判挡、镇 36 格 —— 这些可能是路面 / 地面被误标阻挡。我把阻挡网格打成 ASCII，对照通道走向看哪里被堵。
废墟带的红色图集阻挡在中部路面连成多条横带 —— 这是旧图集把废墟 / 石墙瓦片判成阻挡，但本图这些位置是可走地面，正是空气墙主因。我先确认图集属性表是走故事包内副本还是公共文件，能不能只在本故事侧放开。
  查找目标配置文件
  本故事有独立的 `compiled_dawnlike.json`，可以只在本故事描述表里放开误挡瓦片，不影响别的图。先统计两张图里图集标志判挡的去重 gid、数量和周边成墙密度，再裁小图目识。
  地图瓦片使用情况
  每个 gid 只出现一格，密度判断没意义。我把废墟带这些被图集标志判挡的瓦片裁成联系表，目识哪些是真墙、哪些是误挡地面

- 2.主线任务我接了。但是没有寻路。怀疑是采集和钓鱼事件等没做好和主线任务没有做验证和适配。
  采集映射表对不上：目标叫「药草」没登记，区名还是旧故事的「夜采药圃 / 木材堆」，本故事实际区名是「食堂补给区 / 木料堆 / 废墟药草」。接着看 App.vue 怎么解析 talk 目标坐标（navTargets）。

## 参考

- `references/pipeline.md` — 后端 API 细节、落地通道参数、校验清单
- `references/practice/<故事名>/README.md` — 各故事落地实践案例：路线抉择、碰撞/压缩做法、踩坑清单与可复用脚本
- `assets/elements_example.json` — 原型要素清单模板
- 上游：`../cognitive-tiles-maps/`、`../tiles-maps-editor/`、`../tile-style-change/`、`../toon-maps-modification-workflow/`
