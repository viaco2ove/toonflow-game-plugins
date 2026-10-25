---
name: tiles-maps-editor
description: 编排层技能——编辑 toonflow 瓦片地图（maps/*.json + 图集 png）。在动手改之前先建立完整认知：这张图现在长什么样、每个元素（房子/道路/树木/围栏/家具）用什么瓦片、对应材质是什么、活物（NPC/怪物）怎么加进来；然后用数据驱动方式改瓦片布局、街道走向、建筑结构与墙面材质，改完**必须渲染截图自查**。当用户要求「改地图」「换成更贴合主题的风格」「修改街道布局」「把房子改结构」「加/改 NPC 或怪物」「这图该长什么样」时使用。也适用于用 map-editor 图形界面做同样的编辑。
agent_created: true
---

# tiles-maps-editor — 瓷砖地图编辑器（编排层）

## 定位

这是一个**编排层**技能：不重复实现底层能力，而是把三个上游技能串成一条可靠的工作流。

| 上游技能 | 提供什么 | 什么时候用 |
|---|---|---|
| `cognitive-tiles-maps` | 地图/图集认知、逐格材质图、候选瓦片筛选 | **每次开工前**（必做） |
| `tile-style-change` | 按「对象/系列」给图集换皮相 | 需改**贴图本身**（不只是布局） |
| `map-editor`（图形界面） | 可视化手工编辑 | 适合精细拖拽；脚本改不动时 |

**核心原则：先看清，再动手；改完必须看图。**
上一轮的教训——脚本输出「砖墙 32 格」「旗杆(34,37..35)」全对，
但渲染出来是砖块乱飞、旗杆插在草地上——**只有看图才发现**。

---

## 第 0 步：定位地图集（必做）

给定地图 JSON 路径时，先解析出地图集根目录（三个上游技能都以它为单位工作）：

```
<地图集>/
├─ maps/<name>.json          ← 地图本体
├─ images/compiled_tileset_32x32.png      ← 运行时图集（改这个）
├─ images/compiled_tileset_32x32.original.png  ← 未改动母版（只读）
├─ images/compiled_tileset_32x32.json    ← 图集描述（含每格 category/avg_color）
├─ compiled_dawnlike.json                ← tile-style-change 用的对象/系列索引
├─ entity_types.json                     ← 角色定义（活物）
├─ events/                               ← 事件脚本
└─ maps/bak/  images/bak/                ← 备份目录
```

地图集目录 = 地图 JSON 的 `../..`。

---

## 第 1 步：认知（必做，不可跳过）

```sh
PY="C:/Users/viaco/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe"
SK=".workbuddy-ai/skills/cognitive-tiles-maps/scripts"

"$PY" "$SK/inspect_map.py" <地图集>/maps/<name>.json
"$PY" "$SK/inspect_tileset.py" <地图集>/images/compiled_tileset_32x32.png
```

产出（默认 `<项目根>/.workbuddy-ai/cognition/<地图名>/`）：
- `<name>.png` 整图渲染（红框=事件区，蓝框=对象并标名）
- `layer-L1/L2/L3.png` 分层渲染
- `material.txt` **逐格材质图**（W=墙/屋顶 f=家具 F=地板 T=树/草 .=空地 o=对象）
- `report.md` 结构报告
- `categories.md` 图集分类目录 + 每类主色 + **可用空段**

**必须读的东西**：整图 PNG（用 Read 看图）、`material.txt`、`report.md`。

---

## 第 2 步：识别元素（房子/道路/树木/围栏/家具各是什么瓦片）

用 `scripts/elements.py` 一次性盘清地图里所有元素的构成：

```sh
"$PY" .workbuddy-ai/skills/tiles-maps-editor/scripts/elements.py <地图集>/maps/<name>.json
```

输出：
- **元素清单**：树 / 建筑墙体 / 建筑地板 / 屋顶 / 道路 / 围栏 / 家具，各用哪些 gid、各多少格
- **每个 gid 的真实身份**（按像素色判定，不靠 `category` 标签——那标签实测不可靠：
  L1 地面 1580 格草地全被标成 `building_wall`）
- **道路走向**：每条路的起止格、宽几格
- **建筑轮廓**：每栋房子的外框矩形、是否实心屋顶

> ⚠️ 判别口诀：绿 (109,170,44)/(71,112,76)/(86,104,65) = 植物，
> 橙 (211,125,44) = 木/土，暖棕 (180,114,53) = 建筑构件。

---

## 第 2.5 步：认「墙边」（★ 必做，别跳过）

**「墙边」是什么**（实测结论，别再猜）：

一栋楼 = 「楼面（室内地面）」+「外圈一圈墙边」。在 L2 上：

| 位置 | 延城一中 gid | 说明 |
|---|---|---|
| **包围盒边界那一圈** | `13024` | **墙边**（左右两列 + 上下两行） |
| 内部那些格 | `13021` | **楼面**（室内地面，家具叠在上面） |

**墙边不是某个固定 gid，而是「楼体外圈」这个几何位置。**
判据 = 楼体格聚成连通块 → 取包围盒 → 边界那一圈。

**在图上标出来看**（这一步不做，后面全白干）：

```sh
"$PY" .workbuddy-ai/skills/tiles-maps-editor/scripts/mark_edges.py <地图集>/maps/<name>.json
```

产出：
- `<前缀>_轮廓红线.png` — 整图，每栋楼一个红框
- `<前缀>_墙边高亮.png` — **墙边格红色半透明覆盖**（这是关键产物）
- `<前缀>_墙边_NN_*.png` — 每栋楼局部放大

> 🔥 **上一轮的重大错误**：我把 `13021`（楼面）当成墙去程序化生成砖纹贴图，
> 结果整间教室铺满砖，像贴了瓷砖的浴缸 —— 而 `13024`（真正的墙边）被忽略了。
> **画红线看一遍，5 秒钟就能避免这种错。**

### 图集里的「立面家族」

要换墙的贴图时，图集里**本来就有成套立面素材**，不用自己画：

| 家族 | 位置（col/row） | 内容 |
|---|---|---|
| **teal 青蓝** | col 77..81, row 61+ | c77 立柱(发光边) / c78 带框砖墙 / c79 砖墙 / c80 墙角 / c81 窗墙 |
| **砖墙** | col 63..66，每 3 行一色 | 米白 r73 / 橙 r76 / 灰绿 r79 / 红棕 r82 |
| 其他立面家族 | 用 `scripts/facades.py` 扫 | 自动列出 col/row 范围 + 色系 |

```sh
"$PY" .workbuddy-ai/skills/tiles-maps-editor/scripts/facades.py <图集.png> --sheet /tmp/f.png
```

> ⚠️ 立面家族里**色系很杂**（同一套里含受光面/背光面/描边/窗玻璃），
> 实测青蓝家族 teal 只占 24%。**别用"色系一致"过滤家族**，用空间结构（矩形块+重复节奏+密度）。

---

## 第 3 步：确认改法（先说清楚，别直接开改）

改之前必须先向用户讲明白三件事：

1. **现状**：现在长什么样（基于第 1 步的图，不是想象）
2. **应该长什么样**：逐区对照（哪栋楼是什么功能、路面什么材质、围墙什么样式）
3. **分档方案**：A 纯瓦片重排（零贴图改动，快）/ B 关键贴图替换（中成本）/ C 全面重绘（高成本）
   —— 让用户选，别替他选

---

## 第 4 步：改（按 A/B/C 选路线）

### A 档：纯瓦片重排（零贴图改动）

只改 `maps/*.json` 的 gid，**不动 png**。要素：
- 路面：土路/木栈道 → 石板或水泥（**整条统一替换**，别只取中心线，否则橙白混排成碎花）
- 建筑外墙：木色构件 → 砖墙/其他立面瓦片
- 室内：拆实心屋顶 → 砌墙围出房间 → 摆家具
- 围栏：绿篱/木栅栏 → 铁栏杆（留校门缺口）

### B 档：关键贴图替换（改图集 png）

需要图集里**没有**对应素材时（黑板、水泥路、砖墙）：

```sh
"$PY" .workbuddy-ai/skills/tiles-maps-editor/scripts/make_tiles.py --mapset <地图集> \
    --plan .workbuddy-ai/skills/tiles-maps-editor/assets/plan_example.json
```

- 素材必须**程序化生成**（32×32 绝不用 AI 生图：原版每格仅 12–16 色，AI 插画缩到 32px 会糊）
- 只能落**图集内连续全透明空白格**，id < tilecount（13080）
- 整格替换用 `alpha_composite` + **不带 mask** 的 `paste`（带 mask 是 alpha 混合，留幽灵像素）
- 写入前断言落点 alpha 全 0；写后校验图集尺寸未变
- 参考 `assets/plan_example.json` 与 `references/tilemaking.md`

**若只是"换配色"而不是"造新素材"**，用 `tile-style-change`：
```sh
python .workbuddy-ai/skills/tile-style-change/scripts/tile_groups.py --story <地图集名> suggest 建筑
python .workbuddy-ai/skills/tile-style-change/scripts/skin_recolor.py --name "stone wall" --palette modern --preview /tmp/p.png
```

### 改数据的铁律

1. **`MapFile.load()` 拷贝了 `layer['data']`** —— 直接改 `tile_layers` 不会影响 `raw`，
   写回文件等于没改。**必须调 `mf.commit_layers()`**，并断言新 gid 真的进了数据再落盘。
2. **屋顶可能压在真正的室内上面**（延城一中：屋顶 y=13~15 挡住 y=9~12 的房间）。
   拆之前先确认上下哪边才是有门有家具的那一侧。
3. **砖墙只砌一格厚** —— 上下沿都砌会变成 2 格厚的"浴缸框"，房间显空。
4. **坐标靠 `material.txt` 的逐格材质图**，绝不靠 bbox 猜。
5. **不同层的同一格，含义不同**（L1 的 9305 是路面，L2 的 9305 是室内地板）。

---

## 第 5 步：加活物（NPC / 怪物）

活物不在瓦片层，在**对象层**（`Actors`）。用 `scripts/actors.py`：

```sh
# 看现有活物
"$PY" .../actors.py <地图集>/maps/<name>.json --list
# 加一个 NPC（复用 entity_types 里已有的类型）
"$PY" .../actors.py <地图集>/maps/<name>.json --add-npc \
    --entity-type "HT_FAKE_STUDENT" --name "值日生" --at 12,20 --full-name "值日生·林"
# 加一个野怪（刷怪点）
"$PY" .../actors.py <地图集>/maps/<name>.json --add-spawn \
    --entity-type "HT_FAKE_ELITE" --at 30,44
```

**关键约束**：
- 坐标是**像素**（`cell * 32`），不是格子
- 瓦片对象必须带 `gid`（指向图集某格）+ `entity_type` 属性
- **NPC 复用 uid**：同一角色的 uid 在全地图集唯一且可复用，不要新造
- 野怪必须**三处一致**：`entity_types.json` 的定义、`entity_type` 字段、
  头顶显示名（`full_name`）
- 改完要同步 `entity_types.json`（否则游戏里认不出这个类型）

---

## 第 6 步：验证（必做，看图）

```sh
"$PY" "$SK/inspect_map.py" <地图集>/maps/<name>.json
```

然后 **用 Read 打开渲染 PNG 亲眼看**。整图看不出问题就裁局部放大（3 倍）看。

**自检清单**：
- [ ] 整图 PNG 里，改动落在预期位置（不是"某处变了"而是"该变的地方变了"）
- [ ] 局部特写没有穿帮（悬空的物件、被墙挡住的桌子、孤立的旗杆）
- [ ] 道路连续、不断头、不混色
- [ ] JSON 合法、每层 `len(data) == width*height`
- [ ] 所有 gid < tilecount
- [ ] 对象数、事件区数与改前一致（除非有意增删）
- [ ] 图集尺寸未变、新瓦片非空、旧关键瓦片未被覆盖
- [ ] **备份存在**：`maps/bak/`、`images/bak/`

---

## 第 7 步：同步（如果跑的是 installed 副本）

- 图集 png 改了 → 要同步 `toonflow-app-run-db/plugins/1/com.toonflow.minigame-field-survival/`
  对应位置（或重打 `.tbg`）
- 纯数据层改动（只改 json）→ dev 模式刷新即生效，不用重新构建
- 改了 `entry.ts` → 必须走三步收尾：`npm run build` → esbuild entry.js → 同步 md5

---

## 附：用 map-editor 图形界面

当需要精细拖拽、或脚本搞不定的自由布局时：

```sh
cd src/tools/toonflow-field-survival/map-editor
# 后端（8000）
cd backend && python server.py local
# 前端（5176）
cd ../frontend && npm run dev
```

关键 API（可直接脚本调用，比点 UI 快）：

| 接口 | 作用 |
|---|---|
| `GET /api/collections` | 列出地图集 |
| `GET /api/collections/{name}/maps/{map}` | 读地图 JSON |
| `POST /api/collections/{name}/maps/{map}` | **保存地图**（自动备份到 `maps/bak/`） |
| `GET /api/collections/{name}/tileset` | 取图集 |
| `GET /api/collections/{name}/dawnlike` | 取 tile-style 索引 |
| `POST /api/tile-style/override` | 覆盖某格贴图 |
| `GET /api/collections/{name}/preview` | 生成预览 |

> map-editor 的 `save_map` 会自动备份，比手写脚本更安全。
> 但**批量改动仍建议走脚本**——UI 拖拽无法保证 200+ 格的规则性。

---

## 参考

- `references/elements.md` — 元素识别结果怎么读、各类瓦片的身份对照
- `references/tilemaking.md` — 程序化生成 32×32 瓦片的规范与模板
- `references/map-editor.md` — map-editor 详解（架构、API、快捷键、坑）
- `references/walledges.md` — **墙边（建筑物外圈）怎么认、怎么换**
- `use.example.md` — 用例档
