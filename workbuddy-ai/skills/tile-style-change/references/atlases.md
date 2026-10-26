# 图集数据格式与换皮规则

## 文件位置

地图集目录（一个故事一份）：

```
workshops/toonflow-field-survival/map_design/<地图集名>/
├── compiled_dawnlike.json          # ★ tileset 属性表（Tiled 格式）
├── entity_types.json               # ★ 角色定义（textures → tile id）
├── images/
│   ├── compiled_tileset_32x32.png  # ★ 图集本体（3840×3488，120列×109行）
│   └── compiled_tileset_32x32.original.png   # 原始图集（比对基线）
├── overrides/
│   ├── <tileId>.png                # 单格替换图存档
│   └── originals/<tileId>.png      # 首次覆盖前的原始像素（供「重置」）
├── bak/compiled_tileset_32x32.png.bak   # 首次覆盖时的整图集备份
└── styleOverrides                  # 在 compiled_dawnlike.json 里（引用，不存 base64）
```

## 坐标换算

图集 3840×3488，tile 32×32，120 列 × 109 行（= 13080 格，其中 5006 格有属性）。

```
tile_id = row * 120 + col
col = tile_id % 120
row = tile_id // 120
像素坐标 = (col*32, row*32)
```

Tiled 地图 JSON 里用的是 `gid`，关系是 `gid = tile_id + firstgid`。
本地图集的 `firstgid = 1`，所以 gid 5300 → tile_id 5299。

## 属性表结构

`compiled_dawnlike.json` 的 `tiles[]`：

```json
{
  "id": 5292,
  "properties": [
    { "name": "animated",      "type": "bool", "value": true  },
    { "name": "animated_id",   "type": "int",  "value": 5300  },
    { "name": "blocked",       "type": "bool", "value": false },
    { "name": "blocks_vision", "type": "bool", "value": false },
    { "name": "bg",            "type": "bool", "value": true  },
    { "name": "description",   "type": "str",  "value": "torch" }
  ]
}
```

属性名出现频次（实测）：

| 属性 | 数量 | 用途 |
|---|---|---|
| `animated` / `animated_id` | 3229 / 3228 | 动画帧配对 |
| `blocked` | 2418 | 阻挡 |
| `bg` | 2381 | 背景层 |
| `blocks_vision` | 1667 | 遮挡视线 |
| `description` | 1236 | **系列分组依据**（44 个唯一值） |
| `activated_id` | 17 | 交互物 |

## 动画帧规则（★ 换皮最容易漏的地方）

`animated_id` 指向该格的**动画第二帧**。半兽人实测：

```
5292 → 5300    5293 → 5301    5294 → 5302    5295 → 5303
5296 → 5304    5297 → 5305    5299 → 5307
```

`entity_types.json` 里 ORC 的 `textures` 只写了 7 个首帧
`[5292,5293,5294,5295,5296,5297,5299]`，**不含 5300/5301/5302/5303/5304/5305/5307**
—— 这些第二帧只能从 `animated_id` 关系推出来。

补全规则（`tile_groups.py` 的 `animated_family`）：
1. 每个首帧 → 加入它自己的 `animated_id`
2. 反向：若集合里有某格是别格的第二帧 → 把那个首帧也拉进来

不补全的后果：游戏里怪物走动画时在「新造型 ↔ 旧造型」之间跳变。

## 角色定义

`entity_types.json` 的 `enemies[]`：

```json
{
  "entity_type": "ORC",
  "name": "orc",
  "description_zh": "体型庞大、绿皮獠牙的蛮兽。",
  "textures": [5292, 5293, 5294, 5295, 5296, 5297, 5299],
  "spawn": [{ "theme": "RUINS", "weight": 7, "generatable": true }],
  "playable_now": true
}
```

本地图集共 23 个角色（ORC / GOBLIN / ZOMBIE / SKELETON / MINOTAUR / VAMPIRE …）。

## 落盘规则（★ 别踩 alpha_composite 的坑）

`skin_recolor.py` / `apply_skin.py` 都用**整格替换**：

```python
base.paste(new_tile, (col*TILE, row*TILE))     # ✅ 替换
# base.paste(Image.alpha_composite(region, new_tile), ...)   # ❌ 半透明叠加
```

原因：原格里有 430 个 `alpha=1` 的幽灵像素（历史上用 paste+mask 覆盖留下的）。
`alpha_composite` 会让这些极淡的像素透出 → 放大看是彩色残影（绿/黄边缘）。
`paste` 直接丢弃原像素，残留为 0。

## 像素风量化标准

| 指标 | 原版半兽人 | 要求 |
|---|---|---|
| 单格颜色数 | 12–16 | ≤ 20 |
| 边缘 | 1px 暗色描边 | 必须有 |
| 背景 | 全透明 | 必须 |
| 放大方式 | NEAREST | 禁止 LANCZOS 糊化 |

## 为什么不能用 AI 生图

实测用 map-editor 的生图通道（Qwen/Qwen-Image-Edit-2509）：

| | 原版像素贴图 | AI 生成结果 |
|---|---|---|
| 单格颜色数 | 12–16 | 400–650 |
| 32×32 下 | 清晰 | 完全糊掉 |
| 构图 | 严格对应姿势 | 变成狼脸特写，姿势全丢 |

图像模型把参考图当"内容参考"而非"构图约束"。**32×32 像素贴图必须程序化生成。**
