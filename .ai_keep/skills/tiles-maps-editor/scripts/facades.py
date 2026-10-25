#!/usr/bin/env python3
"""facades.py — 识别并导出图集里的「建筑立面 / 墙边」素材家族。

为什么需要这个脚本（上一轮踩的坑）：
  我把建筑墙当成"纯色砖纹贴图"去程序化生成，做出来完全不对。
  实际 dawnlike 图集里**本来就有完整的建筑立面素材**：
  每栋房子 = 「屋顶 + 墙边立柱 + 带窗墙面 + 拐角 + 门」多格拼出来，
  而且分成好几套配色家族（青蓝 / 米黄 / 橙棕 / 绿…）。

  所以「什么是墙边」不能靠看单格判断，要靠**看家族结构**：
  一个立面家族 = 图集某块矩形区域里，按固定节奏重复的
  「立柱 + 窗墙 + 拐角」组合。

识别原理（结构特征，不是颜色猜测）：
  立面家族在图集里有三个可测的特征：
    1. **成片密集**  —— 4~8 列宽、3~30 行高的矩形实心块
    2. **周期性**    —— 纵向每 2~4 行重复一次（同一层楼）
    3. **同色系**    —— 块内所有格子的主色落在同一个色系标签里
  三者同时满足 = 一个立面家族。

本脚本：
  1. 扫出图集里所有立面家族（位置 + 色系 + 每个格的 index/gid）
  2. 生成带 index 标注的索引图，供人眼确认
  3. 导出 gid 对照表 json，可直接喂给改地图的脚本

用法：
  python facades.py <atlas.png>
  python facades.py <atlas.png> --sheet out.png             # 全部家族的索引图
  python facades.py <atlas.png> --sheet out.png --family 1  # 只画第 1 个
  python facades.py <atlas.png> --json facades.json
"""
from __future__ import annotations

import argparse
import colorsys
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

TILE = 32


# ---------------------------------------------------------------- 工具 ---- #
def cell_box(t: int, cols: int):
    x, y = (t % cols) * TILE, (t // cols) * TILE
    return x, y, x + TILE, y + TILE


def tile_stats(img: Image.Image, t: int, cols: int):
    """(主色, 非透明覆盖率, 颜色种类数, 亮度标准差)"""
    x, y, x1, y1 = cell_box(t, cols)
    c = img.crop((x, y, x1, y1))
    px = [p for p in c.getdata() if p[3] > 200]
    if not px:
        return None, 0.0, 0, 0.0
    r = sum(p[0] for p in px) / len(px)
    g = sum(p[1] for p in px) / len(px)
    b = sum(p[2] for p in px) / len(px)
    lum = [0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] for p in px]
    mean = sum(lum) / len(lum)
    var = sum((v - mean) ** 2 for v in lum) / len(lum)
    return (int(r), int(g), int(b)), len(px) / (TILE * TILE), len(set(px)), var ** 0.5


def color_family(rgb):
    """主色 → 配色家族标签（HSV 色相，比 RGB 差值稳得多）。

    实测校准（dawnlike 图集立面素材）：
      青蓝 teal   hue 160~200   （实测 162,166,167,180,183,188,189,192）
      蓝   blue   hue 200~265
      紫   purple hue 265~345
      绿   green  hue 75~160
      橙   orange hue 20~48     （实测 30,33,37,38）
      红   red    hue >=345 或 <20
      灰   grey   饱和度 < 0.16
    """
    if rgb is None:
        return None
    r, g, b = (v / 255.0 for v in rgb)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    hue = h * 360
    if s < 0.16:
        return "grey"
    if 160 <= hue < 200:
        return "teal"
    if 200 <= hue < 265:
        return "blue"
    if 265 <= hue < 345:
        return "purple"
    if 75 <= hue < 160:
        return "green"
    if 20 <= hue < 48:
        return "orange"
    if hue >= 345 or hue < 20:
        return "red"
    if 48 <= hue < 75:
        return "yellow"
    return "grey"


# ------------------------------------------------------------ 家族识别 ---- #
def find_families(img: Image.Image, cols: int, rows: int, tilecount: int):
    """找立面家族 —— 用「密集块 + 周期性 + 同色系」三个结构特征。"""
    feats = {}
    occ = [[False] * cols for _ in range(rows)]
    for t in range(tilecount):
        r, c = t // cols, t % cols
        if r >= rows or c >= cols:
            continue
        rgb, cover, nuniq, std = tile_stats(img, t, cols)
        if rgb is not None and cover > 0.35:
            feats[t] = (rgb, cover, nuniq, std)
            occ[r][c] = True

    # --- 1. 找「竖直实心带」：某列上连续 >=4 行非空（允许 1 格断裂）------ #
    col_runs = []      # (col, r0, r1)
    for c in range(cols):
        r = 0
        while r < rows:
            if occ[r][c]:
                r0 = r
                gap = 0
                while r < rows:
                    if occ[r][c]:
                        gap = 0
                    else:
                        gap += 1
                        if gap > 1:      # 连续 2 格空 → 带断
                            break
                    r += 1
                r1 = r - gap - 1
                if r1 - r0 >= 3:
                    col_runs.append((c, r0, r1))
            else:
                r += 1

    # --- 2. 横向聚类：相邻列的 run 若行区间重叠 >=50%，归为同一"列簇" --- #
    runs_by_col = defaultdict(list)
    for c, r0, r1 in col_runs:
        runs_by_col[c].append((r0, r1))

    clusters = []      # (c0, c1, r0, r1)
    for c0, r0, r1 in col_runs:
        c1 = c0
        r_lo, r_hi = r0, r1
        taken = {(c0, r0, r1)}
        c = c0 + 1
        while c < cols:
            hit = None
            for (a, b) in runs_by_col.get(c, []):
                if (c, a, b) in taken:
                    continue
                ov = min(b, r_hi) - max(a, r_lo) + 1
                if ov > 0 and ov / min(b - a + 1, r_hi - r_lo + 1) >= 0.5:
                    hit = (a, b)
                    break
            if hit is None:
                break
            taken.add((c, hit[0], hit[1]))
            r_lo, r_hi = min(r_lo, hit[0]), max(r_hi, hit[1])
            c1 = c
            c += 1
        if c1 - c0 >= 2:      # 至少 3 列宽
            clusters.append((c0, c1, r_lo, r_hi))

    # --- 2b. 合并重叠簇（同一家族被切成很多子簇）--- #
    merged = True
    while merged:
        merged = False
        out = []
        used = set()
        for i, a in enumerate(clusters):
            if i in used:
                continue
            c0, c1, r0, r1 = a
            group = [a]
            for j, b in enumerate(clusters):
                if j <= i or j in used:
                    continue
                d0, d1, s0, s1 = b
                # 列区间重叠 >=60% 且 行区间重叠 >=40% → 同一家族
                col_ov = min(c1, d1) - max(c0, d0) + 1
                row_ov = min(r1, s1) - max(r0, s0) + 1
                if col_ov > 0 and row_ov > 0:
                    if (col_ov / min(c1 - c0 + 1, d1 - d0 + 1) >= 0.6 and
                            row_ov / min(r1 - r0 + 1, s1 - s0 + 1) >= 0.4):
                        group.append(b)
                        used.add(j)
            for b in group[1:]:
                c0 = min(c0, b[0]); c1 = max(c1, b[1])
                r0 = min(r0, b[2]); r1 = max(r1, b[3])
            used.add(i)
            out.append((c0, c1, r0, r1))
        clusters = out

    # --- 3. 校验：密度 + 重复节奏（周期性）--- #
    #
    # 注意：**不要用"色系一致"做过滤**。
    # 一套立面家族里本来就含大量明暗/冷暖变体（受光面、背光面、
    # 描边、窗玻璃）。实测青蓝家族 col77-81 row61-99 里
    # teal 只占 24%，grey/red/blue/orange 各占一截 —— 用色系过滤会全灭。
    # 正确判据是**空间结构**：矩形块 + 纵向重复节奏 + 足够密。
    families = []
    for c0, c1, r0, r1 in clusters:
        if r1 - r0 < 3:
            continue
        members = []
        fam_count = defaultdict(int)
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                t = r * cols + c
                if t in feats:
                    members.append(t)
                    fam_count[color_family(feats[t][0])] += 1
        if len(members) < 12:
            continue

        # 密度：行均至少 55% 满
        row_counts = []
        for r in range(r0, r1 + 1):
            row_counts.append(sum(1 for c in range(c0, c1 + 1) if r * cols + c in feats))
        avg_row = sum(row_counts) / len(row_counts)
        if avg_row < (c1 - c0 + 1) * 0.55:
            continue

        # 周期性：存在 2~4 行的重复节奏
        periodic = False
        for period in (2, 3, 4):
            pat = row_counts[:period]
            if len(row_counts) >= period * 2 and all(
                    row_counts[i] == pat[i % period] for i in range(len(row_counts))):
                periodic = True
                break
        if not periodic and r1 - r0 < 5:
            continue

        main = max(fam_count, key=fam_count.get)
        ratio = fam_count[main] / len(members)

        families.append({
            "rows": [r0, r1], "cols": [c0, c1],
            "color_family": main,
            "color_ratio": round(ratio, 2),
            "color_spread": dict(sorted(fam_count.items(), key=lambda kv: -kv[1])),
            "members": members,
            "n": len(members),
        })
    return families


# ------------------------------------------------------------ 索引图 ---- #
def draw_index(img: Image.Image, cols: int, fam: dict, out: Path, scale: int = 5):
    r0, r1 = fam["rows"]
    c0, c1 = fam["cols"]
    W = (c1 - c0 + 1) * TILE * scale
    H = (r1 - r0 + 1) * TILE * scale
    sh = Image.new("RGBA", (W, H), (20, 20, 26, 255))
    d = ImageDraw.Draw(sh)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            t = r * cols + c
            x, y, x1, y1 = cell_box(t, cols)
            tile = img.crop((x, y, x1, y1)).resize(
                (TILE * scale, TILE * scale), Image.NEAREST)
            px = (c - c0) * TILE * scale
            py = (r - r0) * TILE * scale
            sh.paste(tile, (px, py))
            d.rectangle([px, py, px + TILE * scale - 1, py + TILE * scale - 1],
                        outline=(255, 60, 60), width=2)
            d.rectangle([px, py + TILE * scale - 15, px + TILE * scale - 1,
                         py + TILE * scale - 1], fill=(0, 0, 0))
            d.text((px + 3, py + TILE * scale - 14), f"{t}", fill=(255, 255, 0))
            d.rectangle([px, py, px + TILE * scale - 1, py + 13], fill=(0, 0, 0))
            d.text((px + 3, py + 1), f"c{c}r{r}", fill=(255, 255, 255))
    sh.save(out)
    return W, H


def main() -> int:
    ap = argparse.ArgumentParser(description="识别图集里的建筑立面/墙边素材家族")
    ap.add_argument("atlas")
    ap.add_argument("--sheet", metavar="PNG", help="生成索引图")
    ap.add_argument("--family", type=int, help="只处理第 N 个家族（0 起）")
    ap.add_argument("--json", metavar="FILE", help="导出家族信息 json")
    ap.add_argument("--firstgid", type=int, default=1,
                    help="图集 firstgid（gid = index + firstgid），默认 1")
    args = ap.parse_args()

    img = Image.open(args.atlas).convert("RGBA")
    cols = img.width // TILE
    rows = img.height // TILE
    tilecount = cols * rows
    desc = Path(args.atlas).with_suffix(".json")
    if desc.exists():
        try:
            tilecount = int(json.loads(desc.read_text(encoding="utf-8")).get("tilecount", tilecount))
        except Exception:
            pass

    print(f"图集 {img.size}  {cols}列 x {rows}行  tilecount={tilecount}")
    fams = find_families(img, cols, rows, tilecount)
    print(f"\n=== 找到 {len(fams)} 个立面家族 ===\n")

    for i, f in enumerate(fams):
        r0, r1 = f["rows"]
        c0, c1 = f["cols"]
        print(f"[{i}] 色系={f['color_family']:7s} 一致度{f['color_ratio']}  "
              f"col{c0}..{c1} row{r0}..{r1}  非空 {f['n']} 格")

    if args.sheet:
        idxs = [args.family] if args.family is not None else range(len(fams))
        for i in idxs:
            if i >= len(fams):
                print(f"[warn] 没有第 {i} 个家族")
                continue
            out = Path(args.sheet)
            if len(fams) > 1:
                out = out.with_name(f"{out.stem}_fam{i}{out.suffix}")
            wh = draw_index(img, cols, fams[i], out)
            print(f"[ok] 索引图: {out}  {wh[0]}x{wh[1]}")

    if args.json:
        data = []
        for f in fams:
            data.append({
                "rows": f["rows"], "cols": f["cols"],
                "color_family": f["color_family"],
                "n": f["n"],
                "members_index": f["members"],
                "members_gid": [t + args.firstgid for t in f["members"]],
            })
        Path(args.json).write_text(json.dumps(data, ensure_ascii=False, indent=2),
                                   encoding="utf-8")
        print(f"[ok] {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())