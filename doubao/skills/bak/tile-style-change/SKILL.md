---
name: tile-style-change
description: 游戏 Tileset 图集批量风格替换。当用户需要把像素游戏 tileset（如 compiled_tileset_32x32.png）整体改成现代都市风格、按分类分批生成新素材并贴回原位时使用。触发词：改风格、现代社会、tileset 换皮、现代都市素材、tile 风格替换。输入为原 PNG + 分类 JSON，输出为新风格 PNG。
---

# Tileset Style Change

按分类批量替换游戏 tileset 的视觉风格，保持 tile 位置和网格不变。

## 输入

- 原图：`compiled_tileset_32x32.png`（3840×3488，32px tile，120列×109行）
- 索引：`compiled_tileset_32x32.json`（Tiled 格式，含每个 tile 的 category 分类）

## 输出

- 新 PNG：输出到用户指定目录（如 `Modern society/`）
- 同名 JSON 副本

## 工作流程

### 1. 确认替换范围

读取 JSON 中的 `regions.categories`，和用户确认要替换的 category 列表。

默认替换范围：
- `terrain_grass` / `terrain_water` / `terrain_ground` / `terrain_edge` / `terrain_other` → 地面地形
- `building_wall` / `building_part` / `special_structure` / `structure_edge` → 建筑结构
- `prop_small` / `prop_large` / `decoration` → 装饰物道具
- `tree_plant` → 植物树木

不替换：`empty`（透明空块）

### 2. 提取分组 tile 小图

运行脚本按 category 分组提取 tile，拼成临时小图：

```bash
python scripts/extract_tiles.py \
  --png <原PNG路径> \
  --json <原JSON路径> \
  --outdir <临时输出目录> \
  --categories terrain_grass terrain_water terrain_ground building_wall special_structure prop_small
```

输出：每个 category 一张 PNG 小图，附一个 `.mapping.json` 记录每个 tile 在小图中的位置和原图坐标。

### 3. 逐组调用 image_edit 改风格

对每一组小图调用 `image_edit`，风格 prompt 见 [references/style-prompts.md](references/style-prompts.md)。

每组独立调用，串行执行：先交付上一组结果，再做下一组。

### 4. 贴回合成

把所有生成的新 tile 贴回原 PNG 对应位置，合成完整新 tileset：

```bash
python scripts/compose_tiles.py \
  --base-png <原PNG路径> \
  --json <原JSON路径> \
  --generated-dir <生成图所在目录> \
  --mapping-dir <mapping.json所在目录> \
  --out-png <输出PNG路径>
```

### 5. 验证输出

- 确认输出 PNG 尺寸 = 原图尺寸（3840×3488）
- 确认未替换区域（如 tree_plant）保持原样
- 复制原 JSON 到输出目录

## 关键约束

- **位置不变**：所有 tile 的 grid_x / grid_y 坐标严格对应原图
- **尺寸不变**：输出 PNG 宽高与原图一致
- **透明保留**：空 tile 保持全透明，不生成内容
- **像素风格**：保持像素美术质感，不要变成写实照片风
