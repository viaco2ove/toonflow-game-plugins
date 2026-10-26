#!/usr/bin/env python3
"""mark_edges.py — 在渲染图上用**红线**标出建筑物的边缘（墙边）。

「墙边」是什么（实测，别再猜）：
  一栋楼 = 「楼面（室内地面）」+「外圈一圈墙边」。
  在 L2 上：
    墙边 = 包围盒的**边界那一圈**（左右两列 + 上下两行）
    楼面 = 内部那些格（家具叠在楼面上）
  所以墙边**不是某个固定 gid**，而是「楼体外圈」这个几何位置。
  判据：先把楼体格聚成连通块，再取每个块的包围盒边界。

  延城一中实测 gid（供参考）：
    13024 = 墙边   13021 = 楼面   13027 = 门/黑板
    9304/9305/9306 = 楼面(原橙砖)  9184/9186 = 楼面带框

用法：
  python mark_edges.py <地图.json> [--out 目录]
  python mark_edges.py <地图.json> --layer 1     # 指定看哪一层
  python mark_edges.py <地图.json> --min-size 10  # 连通块最小格数
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

TILE = 32
COLS = 120

# 楼体结构 gid（延城一中实测；其它地图用 --structure 自定义）
DEFAULT_STRUCTURE = {
    # 墙边
    13024, 13022, 13023, 13025, 13026, 13028, 13029,
    7765, 7766, 7767, 8005, 8006, 8007, 8008, 7769, 7886,
    7884, 7885, 7887,
    # 楼面
    13021, 13027, 9304, 9305, 9306, 9424, 9425, 9426,
    9184, 9185, 9186, 9189,
}


def render(atlas_path: Path, layers: list[list[int]], W: int, H: int) -> Image.Image:
    atlas = Image.open(atlas_path).convert("RGBA")
    base = Image.new("RGBA", (W * TILE, H * TILE), (0, 0, 0, 0))
    for data in layers:
        for i, v in enumerate(data):
            if v == 0:
                continue
            t = v - 1
            x, y = (t % COLS) * TILE, (t // COLS) * TILE
            base.paste(atlas.crop((x, y, x + TILE, y + TILE)),
                       ((i % W) * TILE, (i // W) * TILE))
    return base


def find_blocks(data: list[int], W: int, H: int, structure: set[int],
                min_size: int, layer: int = 0) -> list[tuple]:
    seen: set[tuple[int, int]] = set()
    blocks = []
    for y in range(H):
        for x in range(W):
            if (x, y) in seen or data[y * W + x] not in structure:
                continue
            stack = [(x, y)]
            seen.add((x, y))
            comp = []
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if (0 <= nx < W and 0 <= ny < H
                            and (nx, ny) not in seen
                            and data[ny * W + nx] in structure):
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if len(comp) >= min_size:
                blocks.append((layer, comp))
    blocks.sort(key=lambda c: (min(p[1] for p in c[1]), min(p[0] for p in c[1])))
    return blocks


def main() -> int:
    ap = argparse.ArgumentParser(description="红线标出建筑物边缘（墙边）")
    ap.add_argument("map_json")
    ap.add_argument("--out", default="workbuddy-ai/cognition")
    ap.add_argument("--layer", type=int, default=2,
                    help="看第几层（1 起）；延城一中楼体在 L2")
    ap.add_argument("--min-size", type=int, default=10, help="连通块最小格数")
    ap.add_argument("--structure", default="", help="逗号分隔的自定义结构 gid")
    ap.add_argument("--prefix", default="建筑", help="输出文件名前缀")
    ap.add_argument("--teaching", default="",
                    help="教学楼的格外框（层,x0,y0,x1,y1），逗号分隔多组；"
                         "这些楼用黄线，其余用红线")
    args = ap.parse_args()

    # 教学楼名单：(层, x0, y0, x1, y1)
    teaching = set()
    for grp in filter(None, args.teaching.split(";")):
        parts = grp.split(",")
        if len(parts) == 5:
            teaching.add(tuple(int(v) for v in parts))

    map_path = Path(args.map_json)
    d = json.loads(map_path.read_text(encoding="utf-8"))
    W, H = d["width"], d["height"]
    layers = [l for l in d["layers"] if l.get("type") == "tilelayer"]
    if not layers:
        print("[err] 没有瓦片层")
        return 1
    li = min(max(args.layer, 1), len(layers)) - 1
    data = layers[li]["data"]

    mapset = map_path.parent.parent
    atlas_path = mapset / "images" / "compiled_tileset_32x32.png"
    if not atlas_path.exists():
        print(f"[err] 找不到图集 {atlas_path}")
        return 1

    structure = set(DEFAULT_STRUCTURE)
    if args.structure:
        structure = {int(v) for v in args.structure.split(",") if v.strip()}

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    base = render(atlas_path, [l["data"] for l in layers], W, H)
    blocks = find_blocks(data, W, H, structure, args.min_size, li)

    # ---- 1) 红框总览 --------------------------------------------------- #
    img1 = base.copy()
    d1 = ImageDraw.Draw(img1)
    for blk_layer, comp in blocks:
        li = blk_layer
        xs = [p[0] for p in comp]
        ys = [p[1] for p in comp]
        bx = (min(xs), min(ys), max(xs), max(ys))
        is_teach = any(t[0] == li and t[1:] == bx for t in teaching)
        col = (255, 200, 0) if is_teach else (255, 40, 40)
        d1.rectangle([min(xs) * TILE - 2, min(ys) * TILE - 2,
                      (max(xs) + 1) * TILE + 1, (max(ys) + 1) * TILE + 1],
                     outline=col, width=3)
    p1 = out / f"{args.prefix}_轮廓红线.png"
    img1.save(p1)
    print(f"[ok] 红框总览: {p1}")

    # ---- 2) 墙边格高亮（外圈一圈）------------------------------------- #
    img2 = base.copy()
    overlay = Image.new("RGBA", img2.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    edge_count = 0
    for blk_layer, comp in blocks:
        xs = [p[0] for p in comp]
        ys = [p[1] for p in comp]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        for (x, y) in comp:
            if x in (x0, x1) or y in (y0, y1):
                od.rectangle([x * TILE, y * TILE,
                              (x + 1) * TILE - 1, (y + 1) * TILE - 1],
                             fill=(255, 30, 30, 130),
                             outline=(255, 70, 70, 255), width=1)
                edge_count += 1
    img2 = Image.alpha_composite(img2, overlay)
    d2 = ImageDraw.Draw(img2)
    for blk_layer, comp in blocks:
        xs = [p[0] for p in comp]
        ys = [p[1] for p in comp]
        d2.rectangle([min(xs) * TILE - 3, min(ys) * TILE - 3,
                      (max(xs) + 1) * TILE + 2, (max(ys) + 1) * TILE + 2],
                     outline=(255, 0, 0), width=3)
    p2 = out / f"{args.prefix}_墙边高亮.png"
    img2.save(p2)
    print(f"[ok] 墙边高亮: {p2}  （{edge_count} 格墙边 / {len(blocks)} 栋楼）")

    # ---- 3) 每栋楼局部放大 -------------------------------------------- #
    for idx, (blk_layer, comp) in enumerate(blocks):
        xs = [p[0] for p in comp]
        ys = [p[1] for p in comp]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        pad = 1
        box = (max(0, x0 - pad) * TILE, max(0, y0 - pad) * TILE,
               min(W, x1 + 1 + pad) * TILE, min(H, y1 + 1 + pad) * TILE)
        c = img2.crop(box)
        s = max(1, min(4, 900 // max(1, c.width)))
        c = c.resize((c.width * s, c.height * s), Image.NEAREST)
        c.save(out / f"{args.prefix}_墙边_{idx:02d}_x{x0}-{x1}_y{y0}-{y1}.png")
    print(f"[ok] 局部放大 {len(blocks)} 张 → {out}")

    # ---- 报告 ---------------------------------------------------------- #
    print(f"\n=== {len(blocks)} 栋楼（L{li+1}）===")
    for i, (blk_layer, comp) in enumerate(blocks):
        xs = [p[0] for p in comp]
        ys = [p[1] for p in comp]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        edge = sum(1 for (x, y) in comp if x in (x0, x1) or y in (y0, y1))
        print(f"  [{i:2d}] x{x0}..{x1} y{y0}..{y1}  "
              f"({x1-x0+1}x{y1-y0+1})  墙边 {edge} 格 / 共 {len(comp)} 格")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
