---
name: cognitive-tiles-maps
description: 认知 Tiled 瓦片地图与 dawnlike 图集——在改动地图前先「看清」现状与素材。提供三个脚本：inspect_map.py 渲染地图整图/分层图/逐格材质图/结构报告，inspect_tileset.py 产出图集总览拼图与分类目录，find_tiles.py 按颜色/分类筛出候选瓦片并生成目视确认拼图。当用户要求「看地图现在长什么样」「这张图有什么」「图集里都有什么瓷砖」「有哪些瓦片可用」「这图该怎么改」或任何涉及 toonflow 地图/瓦片集（map_design/*.json、compiled_tileset_32x32.png）的诊断与改造任务时，先用本技能建立认知再动手，避免靠 gid 猜瓦片长相、靠 bbox 猜坐标导致瞎改。
agent_created: true
---

# cognitive-tiles-maps — 先看清，再动手

## 目的

在 toonflow 项目里改地图时，最大的浪费是**在没看清的前提下乱改**：靠 gid 猜瓦片长相
（9304/9305 看着像石板其实是橙木地板）、靠 bbox 猜坐标（连续 3 次把课桌放到图外）。
本技能把「看清地图」和「看清素材」变成可重复执行的三条命令，输出**图**而不是文字描述，
让改造前后的差异可直接目视比对。

## 何时使用

- 需要判断一张地图现在长什么样、哪里是空地、哪里是建筑
- 需要知道图集里有哪些瓦片可用、某一类素材在哪个 id 区间
- 改造地图前的前置勘察步骤（**强烈建议作为改造的第一步**）
- 改造后需要渲染验证效果

## 前置

Python 需带 PIL。推荐用 WorkBuddy 自带解释器：

```sh
PY="C:/Users/viaco/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe"
```

## 统一入口（推荐）

`scripts/ctm.py` 会自动判断路径类型（地图 JSON / 图集 PNG / 地图集目录）并执行对应流程：

```sh
"$PY" scripts/ctm.py <地图.json>                        # 认知地图
"$PY" scripts/ctm.py <图集.png> --grey --min-uniform 0.6  # 认知图集 + 筛候选
"$PY" scripts/ctm.py <地图集目录>                        # 目录内所有地图
```

产物统一写到 `<项目根>/.workbuddy-ai/cognition/` 下（地图集目录内不留垃圾文件）。

---

## 用法一：认知一张地图

```sh
"$PY" scripts/inspect_map.py <map.json> [--out <dir>] [--scale 2]
```

输入是 Tiled 格式地图 JSON，例如
`workshops/toonflow-field-survival/map_design/<故事>/maps/mulberryTown.json`。

**输出**（默认 `.workbuddy-ai/cognition/<地图显示名>/`）：

| 文件 | 内容 |
|---|---|
| `<文件名>.png` | 整图渲染，红框=事件区 eventZones，蓝框=对象（NPC/门）并标注名字 |
| `layer-L1.png` `L2` `L3` | 每层单独渲染（查层间遮挡、看清哪层是地面/墙/家具） |
| `material.txt` | **逐格材质图**：`(x,y)` 网格，符号含义 W=墙/屋顶 f=家具 F=地板 .=草地 T=树 o=对象格 |
| `report.md` | 结构报告：尺寸/层/事件区/对象清单/瓦片用量（按图集分类聚合） |

**必须做的事**：打开 `material.txt`，用它确认真实空隙在哪。**不要用 bbox 猜坐标**。

## 用法二：认知瓦片图集

```sh
"$PY" scripts/inspect_tileset.py <atlas.png> [--out <dir>] [--category building_wall]
```

- `<atlas.png>`：`<地图集>/images/compiled_tileset_32x32.png`（运行时用的）
  或 `compiled_tileset_32x32.original.png`（未改动的母版）
- `--category` 可选：额外输出该分类的带 id 标注拼图

**输出**：`overview.png`（全图集缩略拼图）、`categories.md`（分类目录 + 每类主色 +
可用空段区间）、`<category>.png`。

**必须做的事**：读 `categories.md` 的「颜色速查」和「空段」两节。
空段 = 可以新增瓦片的位置（必须全透明且 id < tilecount）。

## 用法三：按需求找瓦片（改地图的主力工具）

```sh
"$PY" scripts/find_tiles.py <atlas.png> --grey --min-luma 60 --max-luma 190 --sheet grey_floor
"$PY" scripts/find_tiles.py <atlas.png> --dark --sheet dark_board
"$PY" scripts/find_tiles.py <atlas.png> --color "#8a8a8a" --hue-tol 0.12 --sheet grey2
"$PY" scripts/find_tiles.py <atlas.png> --category building_wall --sheet walls
```

筛选维度：`--grey`（低饱和）/ `--dark` / `--warm` / `--color #rrggbb`（带 `--hue-tol`）/
`--min-luma` `--max-luma` / `--min-sat` `--max-sat` / `--category` /
`--min-uniform`（纹理均匀度 0~1，**找路面/墙面必用**）/ `--ids 5555-5576`（直接看指定 id）。

**`--min-uniform` 是关键**：`avg_color` 是整格平均色，按灰色筛会命中台灯、剑、角色等杂物。
路面/墙面是平坦色块（uniform > 0.6），家具/角色是杂色（< 0.5）。
找路面：`--min-uniform 0.62`；找道具：不要加这个限制。

**输出**：`<sheet>.png`（带 id 标注的候选拼图）+ `<sheet>.md`（id/分类/颜色/luma/sat/uniform/blocked 清单）。

**用法要点**：命中后**打开 `<sheet>.png` 目视确认**——算法只能筛出"颜色像"，
是不是"水泥路"必须用眼睛看。确认后的 id 才能写进地图。

---

## 铁律（都是踩过坑换来的）

0. **★ 改完必须自己看渲染图。** 脚本打印「砖墙 32 格」「旗杆(34,37..35)」
   全都是对的，但渲染出来是砖块乱飞、旗杆孤零零插在草地上——
   **只有看图才发现**。流程固定为：改 → `inspect_map.py` → **打开 PNG 看** → 再决定下一步。
   整图看不出问题时，裁局部放大看（3 倍）：

   ```sh
   "$PY" scripts/inspect_map.py <map.json>            # 整图
   # 局部：自己写 3 行 crop + resize(..., Image.NEAREST) 存 PNG 再读
   ```

1. **禁止靠 gid 猜瓦片长相。** dawnlike 图集分区被打乱，同类外观散落各处。
   正解：算法筛候选（**加 `--min-uniform` 滤掉杂物**）→ 裁图目视确认 → 再落子。
   ⚠️ 旧记录里的 id 区间结论也可能错（本技能实测推翻了「灰青砖在 5444~5574 段」——
   那段其实是深底白字的招牌贴图）。**任何 id 结论都要先目视验证。**
2. **禁止靠 bbox 猜坐标。** 先看 `material.txt` 逐格材质图，
   看清哪格是墙、哪格是地板、哪格是空地。
3. **原型村庄图的建筑是实心的。** L2 在建筑区是屋顶结构瓦片（如 5610/5730/5850），
   不是可进入的房间；要改室内**必须先清掉屋顶格**。
   ⚠️ 屋顶**可能压在真正的室内上面**（延城一中：屋顶 y=13~15 挡住 y=9~12 的房间），
   拆之前先确认上下哪边才是有门有家具的那一侧。
4. **加瓦片只能落图集内连续全透明空白格**，且 id < tilecount（13080）。
   写入前断言落点 alpha 全 0，防覆盖既有素材。
5. **32×32 贴图必须程序化生成**，不要用 AI 生图（原版每格仅 12~16 色，
   AI 插画缩到 32px 会糊）。
6. **整格替换用 `alpha_composite` + 不带 mask 的 `paste`**
   （`paste(img, box, mask)` 是 alpha 混合，会留幽灵像素）。
7. **地图文件名 slug 是跨故事共享的**；中文显示名写地图 JSON 顶层 `name`，
   不要往前端 slug 表里加故事专属映射。
8. **改图层数据后写文件前必须回写 raw。** `MapFile.load()` 会拷贝 `layer['data']`，
   直接改 `tile_layers` 不会影响 `raw`，序列化后等于没改。
   调用 `mf.commit_layers()`，并断言新 gid 真的出现在数据里再落盘。

## 地图数据结构速查

```
map.json
├─ width/height (格)   tilewidth/tileheight = 32
├─ layers[]
│   ├─ type=tilelayer   data[] 为扁平 gid 列表, gid 0 = 空
│   │      L1=地面  L2=墙/屋顶/树  L3=家具装饰  (层序自下而上)
│   └─ type=objectgroup  objects[] = NPC/门/触发器, 带 entity_type 属性
├─ tilesets[]  firstgid=1 → tile index = gid - 1
├─ name/theme/narration/notes   ← 显示名/主题/进图旁白/设计备注
└─ eventZones[]  {name, x, y, rx, ry}  ← 格子坐标的事件区域
```

图集侧（`images/compiled_tileset_32x32.json`）：`columns=120`、`tilecount=13080`、
只收录非空格（7246 个），每格带 `category`/`avg_color`/`dominant_hue`/`blocked` 属性。

## 改造工作流（推荐顺序）

1. `inspect_map.py` 认知现状 → 看整图 + `material.txt`
2. `inspect_tileset.py` 认知图集 → 看 `categories.md` 有哪些分类和空段
3. 用文字向用户描述「应该长什么样」，确认方向（**不要跳过这一步直接开改**）
4. `find_tiles.py` 筛候选 → 打开拼图目视确认 → 记下 id
5. 备份后按 `material.txt` 的真实空隙落子，每步渲染验证
6. 校验：JSON 合法、tileset 未损坏、最大 gid < tilecount、Actors 完好

## 参考

- `references/dawnlike-tileset.md` — 图集分类含义、颜色速查、空段、已知素材位置
- `references/map-format.md` — 地图 JSON 字段详解、事件区/对象层约定
