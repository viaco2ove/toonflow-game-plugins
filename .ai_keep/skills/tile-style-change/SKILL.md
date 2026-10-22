---
name: tile-style-change
description: 以「对象 / 系列」为单位给游戏图集换皮相。当用户要查某对象占哪些格子（如「半兽人 有哪些格子」）、把某对象换成新造型（如「半兽人 皮相换成 暗黑疾风狼」）、或问哪些格子最值得换风格（如「建筑物改成现代风，哪些格子最值得换」）时使用。触发词：tile-style-change、换皮相、换皮、改风格、有哪些格子、哪些格子最值得换。产物是换皮后的 32×32 像素图集。
---

# tile-style-change

以**对象 / 系列**为单位定位并替换图集（tileset）里的格子。

## 核心概念

一个可换皮的对象由两类数据标识：

| 类型 | 数据源 | 标识方式 | 例 |
|---|---|---|---|
| **角色**（怪物/NPC） | `entity_types.json` | `enemies[].entity_type` + `textures` | ORC 半兽人、GOBLIN 地精、ZOMBIE 僵尸 |
| **系列**（物件/建筑/地形/家具） | `compiled_dawnlike.json` | `tiles[].properties.description` | `stone wall` `fence` `bookcase` `grass` |

⚠️ **角色必须补动画帧**：`entity_types.textures` 只列首帧。动画第二帧靠
`compiled_dawnlike.json` 的 `animated` / `animated_id` 属性关联 —— **不补就会漏帧**，
游戏里会出现「新造型 ↔ 旧造型」跳变。例：ORC 的 textures 有 7 格，
补上动画帧后是 16 格（5292–5307）。`tile_groups.py` 已自动处理。

## 用法

```
/tile-style-change 半兽人 有哪些格子
/tile-style-change 半兽人 皮相换成 暗黑疾风狼
/tile-style-change 建筑物改成现代风，哪些格子最值得换皮相
/tile-style-change 把你说的建筑物格子改成现代风
```

## 工作流程

### 第 1 步：定位地图集

所有命令都作用于**某个地图集**目录：
`workshops/toonflow-field-survival/map_design/<地图集名>/`

```bash
cd <repo>
python .workbuddy-ai/skills/tile-style-change/scripts/tile_groups.py list
```

不带 `--story` 时自动取最近修改过的地图集；有多个会打印提示，**必要时显式指定**：

```bash
python .../tile_groups.py --story 赦夜人冥夜走廊-第二季 tiles 半兽人
```

### 第 2 步：回答「有哪些格子」

```bash
python .../tile_groups.py find 半兽人
python .../tile_groups.py tiles 半兽人
```

`find` 查对象（含中文别名映射），`tiles` 打印完整格子清单 + 坐标 + 动画配对。
英文名也认（`orc` / `stone wall`）。

### 第 3 步：回答「哪些格子最值得换」

```bash
python .../tile_groups.py suggest 建筑
```

按格数排序（格数多 = 换皮后画面变化最明显）。分类支持：
建筑 / 地形 / 家具 / 植物 / 装饰（也可直接给任意关键词）。

**给建议时要连带说出取舍** —— 格数多不等于最值得换：
- `stone floor` 147 格：铺满地面，视觉冲击最大，但全换会显得单调
- `stone wall` 72 格：建筑主体，换现代风收益最高
- `fence` 70 格：场景点缀，换不换都成立
- `bookcase` 16 格：细节彩蛋，量小但很显眼

### 第 4 步：换皮相

**两条路线，按对象类型选**：

#### A. 保形换色（建筑/地形/家具 —— 推荐先用这个试）

保持原格子形状与明暗结构不变，只换配色。原版像素画得好，细节不丢。

```bash
python .../skin_recolor.py --name "stone wall" --palette modern --preview /tmp/p.png   # 先预览
python .../skin_recolor.py --name "stone wall" --palette modern                          # 落盘
```

内置 palette：`modern`（现代都市）`neon`（赛博霓虹）`nature`（荒野自然）
`ice`（寒冰）`volcanic`（熔岩火山）`dark`（暗黑哥特）
自定义：`--palette custom:#1a1a1a,#555,#aaa,#fff`

#### B. 程序化重绘（角色 —— 有固定造型时用）

**32×32 像素贴图绝不能用 AI 生图**：原版每格只有 12–16 色，而 AI 出的 1024×1024
插画缩到 32×32 后是 400–650 色，完全糊掉；且图生图会把参考图当"内容参考"而非
"构图约束"，产出狼脸特写而非立绘。**必须手写像素模板。**

写一个提供 `draw(tile_id) -> PIL.Image` 的 .py：

```python
from PIL import Image
def draw(tile_id):
    im = Image.new("RGBA", (32, 32), (0,0,0,0))
    px = im.load()
    ...  # 按 tile_id 画对应姿势
    return im
```

然后落盘：

```bash
python .../apply_skin.py --name 半兽人 --from-script ./my_sprites.py
```

`scripts/skin_examples_dark_wolf.py` 是完整可用的范例（暗黑疾风狼 16 格，
含调色板、描边、8 组姿势）。

也可以用目录方式：`--from-dir ./new_tiles`（里面放 `<tileId>.png`）。

### 第 5 步：落盘与同步

两个脚本落盘时都会自动做：

1. 备份整图集 → `<地图集>/bak/compiled_tileset_32x32.png.bak`（首次）
2. 存档原始像素 → `<地图集>/overrides/originals/<tileId>.png`（首次覆盖该格）
3. **整格替换**贴回 → `paste(new_tile, pos)`
   ⚠️ **不能用 `alpha_composite`** —— 那是半透明叠加，原格残留的 alpha=1 幽灵像素
   （历史 paste+mask 留下的）会透出，放大看是彩色残影（实测 430 个残留像素）
4. 写 `overrides/<tileId>.png` + `compiled_dawnlike.json` 的 `styleOverrides`
5. 同步 `vue/public/images/` 与 `ui/images/` 两份副本
6. 同步数据库 `map_visual:<故事名>` 包（重打 tbg 上传）

### 第 6 步：验证

```bash
# 与原始图集逐格比对：应只有目标对象的格子变化
python - <<'EOF'
from PIL import Image
base = 'workshops/toonflow-field-survival/map_design/<地图集>/images/'
new = Image.open(base+'compiled_tileset_32x32.png').convert('RGBA')
old = Image.open(base+'compiled_tileset_32x32.original.png').convert('RGBA')
changed=[]
for y in range(0,3488,32):
    for x in range(0,3840,32):
        if new.crop((x,y,x+32,y+32)).tobytes()!=old.crop((x,y,x+32,y+32)).tobytes():
            changed.append(y//32*120+x//32)
print(len(changed), changed)
EOF
```

再检查单格颜色数（像素风标准 ≤ 20 色）与额外残留像素数（应为 0）。

## 脚本清单

| 脚本 | 作用 |
|---|---|
| `scripts/tile_groups.py` | 查询：list / find / tiles / suggest / export |
| `scripts/skin_recolor.py` | 保形换色（建筑/地形/家具） |
| `scripts/apply_skin.py` | 程序化/目录换皮（角色），落盘 + 同步 |
| `scripts/skin_examples_dark_wolf.py` | 范例：暗黑疾风狼 16 格精灵 |

## 边界

- **只改图集像素，不改地图数据**（gid、firstgid、entity_type 都不动）
- **不改 tile 位置**，格数与坐标严格不变
- `overrides/originals/` 里的存档可用于回退（也可调 map-editor 的「重置」接口）
- 不要动 `vue/src/assets/images/`（readme.md 明令禁止放图集）
- 32×32 贴图 → 每格 ≤ 20 色、硬边像素、不透明背景外全透明

## 参考

- [references/palettes.md](references/palettes.md) —— 配色方案详解与自定义格式
- [references/atlases.md](references/atlases.md) —— 图集数据格式、坐标换算、动画帧规则
