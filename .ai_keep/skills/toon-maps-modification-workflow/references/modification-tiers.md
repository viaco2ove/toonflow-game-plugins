# modification-tiers.md — 改造档位、命令与验证同步清单

## 1. 三档判定

| 档 | 改动面 | 适用条件 | 成本/可逆性 | 产物 |
|---|---|---|---|---|
| **A 纯数据重排** | 只改 `maps/*.json`：gid 替换、Actors 增删移动、eventZones 位置 | 图集现有 tile 与实体已够用，只是布局/配色选择不对 | 小，可逆；备份 json 即可 | 改后的地图 JSON |
| **B 关键贴图替换** | 改图集 png：保形换色，或程序化补少量缺失 tile | 现状素材形状可用但颜色不符；或缺 1–N 个关键道具/地形 tile | 中；自动备份图集；可回退 `overrides/originals/` | 换皮图集 + 新 tile 对照表 |
| **C 整体重绘** | 大规模新素材、重构布局或多个场景重做 | 现有骨架与目标题材差异过大，A/B 无法覆盖 | 高；需先出分区概念稿逐区确认 | 新图集/新布局 + 概念稿留档 |

### 选档规则

1. 先做第 1–2 步认知与分级，统计 R/C/M/E 各多少项。
2. M/E 项少且集中 → B 档；M/E 项多、布局也需重排 → C 档。
3. 不要把 C 档拆成一堆盲目的 B 档硬凑；骨架不对时换皮越多越乱。
4. 档位由用户拍板，脚本只提供现状与取舍说明。

## 2. A 档执行命令

```sh
PY="<workbuddy python>"
SK="<skills 根>"
MAPSET="<地图集>"

# 元素构成（树/墙/地板/屋顶/路/围栏/家具各用哪些 gid）
"$PY" "$SK/tiles-maps-editor/scripts/elements.py" "$MAPSET/maps/<slug>.json"
# 墙边（楼体外圈那一圈）标注
"$PY" "$SK/tiles-maps-editor/scripts/mark_edges.py" "$MAPSET/maps/<slug>.json"
# 候选瓦片筛选（路面/墙面加 --min-uniform 0.62 滤掉杂物）
"$PY" "$SK/cognitive-tiles-maps/scripts/find_tiles.py" "$MAPSET/images/compiled_tileset_32x32.png" \
  --grey --min-uniform 0.62 --sheet /tmp/floor
```

落子约束：
- 坐标以 `material.txt` 逐格材质图为准，不靠 bbox 猜。
- 道路整条统一替换，别只取中心线，否则混排成碎花。
- 砖墙/围栏只砌一格厚；上下沿都砌会变两格厚的「浴缸框」。
- 不同层同一格含义不同（L1 的 9305 是路面，L2 的 9305 是室内地板）。

Actors：

```sh
# 列出现有对象与可用类型
"$PY" "$SK/tiles-maps-editor/scripts/actors.py" "$MAPSET/maps/<slug>.json" --list
"$PY" "$SK/tiles-maps-editor/scripts/actors.py" "$MAPSET/maps/<slug>.json" --list-types

# 加 NPC（复用 entity_types 已有类型；uid 复用已有角色）
"$PY" "$SK/.../actors.py" "$MAPSET/maps/<slug>.json" --add-npc \
  --entity-type "<TYPE>" --name "显示名" --full-name "头顶名" --at <x,y> --uid <uid>

# 加野怪刷怪点
"$PY" "$SK/.../actors.py" "$MAPSET/maps/<slug>.json" --add-spawn \
  --entity-type "<TYPE>" --at <x,y>
```

> `--at` 是格子坐标（脚本内部 ×32 转像素）；Actors 坐标本身存像素。

## 3. B 档执行命令

### 3.1 保形换色（C 类要素）

```sh
# 先预览联系图，不落盘
"$PY" "$SK/tile-style-change/scripts/skin_recolor.py" --story "<故事名>" \
  --name "<对象英文名，如 stone wall>" --palette dark --preview /tmp/p.png
# 确认后落盘（自动备份、存档原像素、同步副本）
"$PY" "$SK/tile-style-change/scripts/skin_recolor.py" --story "<故事名>" \
  --name "stone wall" --palette dark
```

内置 palette：`modern` `neon` `nature` `ice` `volcanic` `dark`；
自定义：`--palette custom:#1a1a1a,#555,#aaa,#fff`。

查某对象占哪些格、哪些格最值得换：

```sh
"$PY" "$SK/tile-style-change/scripts/tile_groups.py" --story "<故事名>" find <对象>
"$PY" "$SK/tile-style-change/scripts/tile_groups.py" --story "<故事名>" suggest 建筑
```

### 3.2 程序化补 tile（M 类要素）

配方格式与 op 一览见 `tiles-maps-editor/references/tilemaking.md`；
末世题材示例见本技能 `assets/post_apoc_plan.json`。

```sh
# 1. dry-run：看落点分配，确认没撞已有瓦片
"$PY" "$SK/tiles-maps-editor/scripts/make_tiles.py" --mapset "$MAPSET" --plan 配方.json --dry-run
# 2. preview：联系表 PNG，Read 亲眼看每一格
"$PY" "$SK/tiles-maps-editor/scripts/make_tiles.py" --mapset "$MAPSET" --plan 配方.json --preview /tmp/tiles.png
# 3. 写入（自动备份图集；输出 id 对照表，gid = tile_index + 1）
"$PY" "$SK/tiles-maps-editor/scripts/make_tiles.py" --mapset "$MAPSET" --plan 配方.json
```

补 tile 约束：
- 只落图集尾部连续全透明空白格（默认 id≥12900），id < tilecount（13080）。
- 整格替换：`alpha_composite` + 不带 mask 的 `paste`，不留幽灵像素。
- 写入前断言落点 alpha 全 0；写后校验图集尺寸仍为 3840×3488。
- 每格 ≤20 色、硬边像素、深色描边；地板类接缝放边缘保证平铺连续。

### 3.3 补实体（E 类要素）

在 `entity_types.json` 对应数组（`enemies` / `special_enemies` / `non_hostile_entity_types`）补定义：
`entity_type`、`name`、`name_zh`、`hp/maxhp`、`textures`（首帧 + 动画帧 gid）、`camp`、`ai`、`wanders`、`spawn`。
通用 NPC（无独立 sprite、复用通用类型）不用进怪物数组，在 `npc_dialogs` dict 加一条 `entity_type: 中文名` 即可。
补完再回 Actors 层放置；新实体必须三处一致：定义的 `entity_type`、Actors 字段、头顶 `full_name`。

## 4. C 档前置

1. 先用 `toon-maps-renderings` 出分区概念稿（现状截图为布局锚点、tileset 为风格锚点）。
2. 逐区与用户确认：功能分区、建筑结构、路面材质、氛围版本。
3. 概念稿冻结后，再按 3.2 批量补素材、按 2 重排布局；每完成一区渲染验证一次。

## 5. 验证清单（改完必跑必看）

```sh
"$PY" "$SK/cognitive-tiles-maps/scripts/inspect_map.py" "$MAPSET/maps/<slug>.json"
```

- [ ] 整图 PNG 里，改动落在预期位置（不是「某处变了」而是「该变的地方变了」）
- [ ] 局部特写无穿帮：悬空物件、被墙挡住的桌子、孤立道具、错位黑墙
- [ ] 道路连续不断头、不混色
- [ ] JSON 合法；每层 `len(data) == width*height`
- [ ] 所有 gid < tilecount；新 gid 对照表里的格子目视就是新 tile
- [ ] Actors 数、事件区数与改前一致（除非有意增删）
- [ ] 图集尺寸未变；新瓦片非空；旧关键瓦片未被覆盖
- [ ] 实体引用全部命中 entity_types；野怪三处一致
- [ ] 备份存在：`maps/bak/`、`images/bak/`（或 `overrides/originals/`）

## 6. 同步收尾

| 改动类型 | 同步动作 |
|---|---|
| 纯 json 数据层 | dev 模式刷新即生效，不用重构建 |
| 图集 png | 同步 `vue/public/images/`（及 `ui/images/` 等既有副本）；必要时重打 `.tbg` 上传 |
| `entry.ts` | `npm run build` → esbuild 生成 `entry.js` → 同步 md5 |
| 新实体/新 tile | 随图集包一起上传；服务端 `map_visual:<故事名>` 包需重打 |

上传/打包命令以仓库既有脚本为准（`toon_plugins plugin_session_data` 的 `-u` 图集目录、`-build` tbg）；不要在技能里硬编码未核实的服务端地址。
