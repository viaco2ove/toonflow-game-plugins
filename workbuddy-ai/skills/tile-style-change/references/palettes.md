# 配色方案（palettes）

`skin_recolor.py` 的保形换色：保持原格子形状/明暗结构，只按**亮度**重新映射颜色。
原版像素画的细节（砖缝、破损、木纹、砌石）全部保留，只换色 → 风格立刻改变。

## 内置 palette

| 名称 | 标签 | dark | mid | light | accent | accent2 | 适合 |
|---|---|---|---|---|---|---|---|
| `modern` | 现代都市 | #2e323a | #6c7480 | #acb4c0 | #569cc4 | #ced6e2 | 建筑→现代风 |
| `neon` | 赛博霓虹 | #120c1e | #3a1e5c | #8c5abe | #00f0ff | #ff3cc8 | 科技/地下城 |
| `nature` | 荒野自然 | #3a3022 | #6e5e3e | #a29264 | #4a6a36 | #c6ba8c | 森林/乡村 |
| `ice` | 寒冰 | #3a526a | #7a9eb8 | #bcd6e8 | #d8f2ff | #8cc8eb | 冰原/洞穴 |
| `volcanic` | 熔岩火山 | #201a1a | #4a3a36 | #7c645a | #e86018 | #ffb030 | 熔岩/地狱 |
| `dark` | 暗黑哥特 | #100e14 | #36303e | #686074 | #b02028 | #c4becE | 暗黑/亡灵 |

其中：
- `accent` 用于原图里**偏绿/偏冷**的区域（植被、水面）
- `accent2` 用于原图里**偏暖**的高光区域（金属、砖石高光），保留材质区分

## 自定义配色

```bash
--palette custom:#1a1a1a,#4a4a55,#8a8a99,#c8c8d4,#5fb8e8
```

颜色按**由暗到亮**排列，至少 3 个。脚本会这样映射：

```
第 1 个 → 最暗档
中间 1/3 处 → 中间档
2/3 处 → 亮档
倒数第 2 个 → accent2（暖高光）
最后 1 个 → accent（冷/绿高光）
```

## 亮度映射曲线

```
亮度 0.00 ──────── 0.35 ────── 0.62 ────── 0.85 ──── 1.00
       dark         mid          light       accent2    accent
```

源像素的亮度 = `0.299R + 0.587G + 0.114B`，再线性插值到目标色的相邻两档之间。

## 用法

```bash
# 先预览（不落盘）
python scripts/skin_recolor.py --name "stone wall" --palette modern --preview /tmp/p.png

# 落盘（自动备份 + 存档原始像素 + 同步三处）
python scripts/skin_recolor.py --name "stone wall" --palette modern

# 多个对象一起换（逐条执行即可）
python scripts/skin_recolor.py --name "wooden wall" --palette modern
python scripts/skin_recolor.py --name "stone floor" --palette modern
```

## 换建筑为现代风的推荐组合

| 对象 | 格数 | palette | 说明 |
|---|---|---|---|
| `stone wall` | 72 | `modern` | 混凝土+玻璃蓝，主体收益最大 |
| `wooden wall` | 72 | `modern` | 木纹→钢构灰 |
| `mine wall` | 72 | `modern` | |
| `dirt wall` | 72 | `modern` | 土黄→混凝土 |
| `mossy stone wall` | 72 | `modern` | 苔绿→玻璃青 |
| `fence` | 70 | `modern` | 木栅→金属护栏 |
| `bookcase` | 16 | `modern` | 木架→金属书架（细节彩蛋） |
| `barrel` | 4 | `modern` | 木桶→金属桶 |

想更彻底：把 `stone floor`（147 格）也换掉 —— 铺满地面，视觉冲击最大，
但全换会显单调，建议 floor 保持原色、只换墙和家具。

## 回退

- 单格回退：删 `overrides/<tileId>.png` 的 styleOverrides 条目 + 从
  `overrides/originals/<tileId>.png` 恢复像素（map-editor 的「重置」按钮同款逻辑）
- 整体回退：`bak/compiled_tileset_32x32.png.bak`（首次覆盖时的整图集备份）