# tilemaking.md — 程序化生成 32×32 瓦片规范

B 档（关键贴图替换）的标准做法。工具：`scripts/make_tiles.py`，配方：`assets/plan_example.json`。

## 为什么必须程序化生成

原版 dawnlike 图集每格 32×32 px，只用 **12~16 色**，风格是像素风。
AI 生图（或照片缩放）到 32px 会产生上千色渐变 + 抗锯齿糊边，跟原版完全不是一个画风，
放进地图里一眼假。

**所以**：只允许用 PIL 代码逐像素画。颜色取自图集实测色，保证风格统一。

## 铁律

1. **只落图集尾部连续全透明空白格**。`make_tiles.py` 默认从 id ≥ 12900 找
   （之前区域可能是引擎保留区）。写入前断言落点 alpha 全 0。
2. **id < tilecount（13080）**。引擎硬上限，超了整张图集不加载。
3. **整格替换 = `alpha_composite` + 不带 mask 的 `paste`**。
   `paste(tile, box, mask)` 带 mask 是 alpha 混合——原格有半透明像素时会留下幽灵像素。
4. **写后校验图集尺寸未变**（3840×3488）。变了 = 坐标算错，别保存。
5. **写入前必须 `--preview` 出联系表 PNG 并亲眼看**（铁律 #0：改完自己看）。
6. **先备份**。`make_tiles.py` 自动备份到 `images/bak/`，别跳过。
7. **⚠️ gid ≠ tile index**。地图 JSON 里用的是 **gid**，图集里的格是 **tile index**。
   本项目 `firstgid = 1`，即 **gid = tile_index + 1**。
   把 index 直接当 gid 用 → 全部新瓦片错位一格 → 渲染出来是**黑色墙面**（错位到相邻的深色瓦片）。
   `make_tiles.py` 的 id 对照表**直接输出 gid**，别再手动 +1。

   验证方法（改完必查）：
   ```sh
   # 取 gid 对应的格，看它是不是你刚画的那块
   python -c "
   from PIL import Image
   img=Image.open('images/compiled_tileset_32x32.png').convert('RGBA')
   cols=120; g=13021          # 你要用的 gid
   x,y=(g-1)%cols*32,(g-1)//cols*32
   img.crop((x,y,x+32,y+32)).resize((128,128)).save('/tmp/chk.png')
   print('gid',g,'-> index',g-1)
   "
   ```

## 配方 JSON 格式

```jsonc
{
  "palette": "school",              // 内置调色板名，或直接内联 {...}
  "colors": { "NAME": [r,g,b] },    // 可选：覆盖个别色
  "mapping": "xxx_tiles.json",      // 可选：id 对照表文件名（默认 <配方名>_tiles.json）
  "tiles": [
    {
      "name": "blackboard",         // 唯一名，写入 id 对照表
      "desc": "黑板（带粉笔字）",
      "ops": [                      // 按顺序叠画
        { "op": "rect", "box": [0,0,31,31], "fill": "$WOOD_D", "outline": "$OUTLINE" },
        { "op": "rect", "box": [1,1,30,30], "fill": [46,62,48] },
        { "op": "chalk", "lines": [[4,9,16,9], [4,14,22,14]] }
      ]
    }
  ]
}
```

**颜色写法**：`"$NAME"` 查调色板 / `"#rrggbb"` / `[r,g,b]` 或 `[r,g,b,a]`。

## op 一览

| op | 参数 | 说明 |
|---|---|---|
| `fill` | `color` | 整格填充 |
| `rect` | `box`, `fill?`, `outline?` | 矩形。box = [x0,y0,x1,y1] 含端点 |
| `line` | `from`, `to`, `color` | 直线（粉笔字、接缝） |
| `dither` | `color`, `density?`, `box?` | 棋盘撒点噪点。density 越大越稀 |
| `brick` | `base`, `mortar`, `bw?`, `bh?` | 错缝砖墙 |
| `plank` | `base`, `seam`, `n?`, `vertical?` | 木板条 |
| `fence` | `rail?`, `bar?`, `outline?`, `bars?` | 栏杆（横杆+竖栅） |
| `tri` | `points`, `fill?`, `outline?` | 三角（旗面） |
| `chalk` | `lines`, `color?` | 一组短线，模拟板书 |

## school 内置调色板（图集实测色）

| 名 | RGB | 用途 |
|---|---|---|
| OUTLINE | (20,12,28) | 描边 |
| GRASS / GRASS_D | (109,170,44)/(52,101,36) | 草地 |
| WOOD / WOOD_D | (211,125,44)/(134,77,48) | 木 |
| GREY | (117,113,97) | 中性石 |
| SLATE / SLATE_D | (134,150,162)/(77,73,77) | 石板/水泥 |
| WHITE / CHALK | (233,228,214)/(238,236,220) | 纸/粉笔 |
| BRICK / MORTAR | (168,88,68)/(126,60,46) | 砖 |
| RED | (178,48,44) | 红旗 |
| IRON / IRON_D | (108,112,120)/(92,96,104) | 铁件 |

## 工作流

```sh
PY="C:/Users/viaco/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe"
SK=".workbuddy-ai/skills/tiles-maps-editor/scripts"

# 1. dry-run：看落点分配，确认没有撞掉已有瓦片
"$PY" $SK/make_tiles.py --mapset <地图集> --plan 配方.json --dry-run

# 2. preview：出联系表 PNG，用 Read 亲眼看每一格
"$PY" $SK/make_tiles.py --mapset <地图集> --plan 配方.json --preview /tmp/preview.png

# 3. 正式写入（自动备份）
"$PY" $SK/make_tiles.py --mapset <地图集> --plan 配方.json

# 4. 写完后再截一次图集尾部确认（铁律 #0）
```

产出 `images/<mapping>.json`：`{瓦片名: 图集id}`——后续改地图查 gid 用。

## 画 32×32 的构图技巧

- **先整体后细节**：先 `rect` 打底 + `outline` 描边，再加 `dither` 质感，最后点睛
- **色阶 ≤ 3**：每格用色 12~16，单个物件 2~3 个色阶足够（底色+暗部+高光）
- **描边决定质感**：原版瓦片全带深色描边，没有描边会显得"飘"
- **地板类**别画中心对称图案，接缝线放边缘（0/16/31），铺起来才连续
- **立式物件**（黑板/篮球架/公告栏）底部留 2~3px 空或画支架，别顶满格
- **俯视物件**（课桌/床）尺寸占格 70~85%，四周留空，摆出来才有"物件放在地上"感