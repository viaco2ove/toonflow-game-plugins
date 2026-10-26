#!/usr/bin/env python3
"""inspect_tileset.py — 认知瓦片图集：总览拼图 + 分类目录 + 按需裁图。

用法:
  python inspect_tileset.py <atlas.png> [--out <dir>] [--category prop_large] [--ids 5444,5445]
  python inspect_tileset.py <atlas.png> --sheet prop_large --ids 5444-5576 --out <dir>

输出:
  overview.png            全图集缩略拼图（每格 16px，带 tile id 标注的放大版另存）
  categories.md           每个分类的 tile id 区间 + 数量 + 颜色分布
  <category>.png          指定分类的瓦片拼图（含 id 标注）
  crops/                  --ids 指定单格裁图（32x32 放大 4 倍）
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tilemap import TileSet, default_out_dir, find_font  # noqa: E402

from PIL import Image, ImageDraw  # noqa: E402

CELL = 16          # overview cell size
PAD = 2
LABEL = 18         # label row height


def parse_ids(spec: str):
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


def sheet(ts: TileSet, ids, cell: int = 32, label: bool = True, cols: int = 16):
    """Build a labelled sheet PNG for the given tile ids."""
    if not ids:
        return None
    cols = max(1, min(cols, len(ids)))
    rows = (len(ids) + cols - 1) // cols
    lh = LABEL if label else 0
    img = Image.new("RGBA", (cols * (cell + PAD), rows * (cell + PAD + lh)), (28, 26, 32, 255))
    draw = ImageDraw.Draw(img)
    font = find_font(11)
    for i, tid in enumerate(ids):
        x = (i % cols) * (cell + PAD)
        y = (i // cols) * (cell + PAD + lh)
        try:
            tile = ts.crop(tid).resize((cell, cell), Image.NEAREST)
        except Exception:
            continue
        img.alpha_composite(tile, (x, y))
        draw.rectangle([x, y, x + cell - 1, y + cell - 1], outline=(90, 90, 100, 255))
        if label:
            draw.text((x + 1, y + cell + 2), str(tid), fill=(220, 220, 230, 255), font=font)
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("atlas")
    ap.add_argument("--out", default=None)
    ap.add_argument("--category", default=None, help="只输出该分类的拼图")
    ap.add_argument("--ids", default=None, help="tile id 列表，支持 5444-5576 区间")
    ap.add_argument("--cols", type=int, default=16)
    ap.add_argument("--cell", type=int, default=32)
    args = ap.parse_args()

    atlas = Path(args.atlas)
    desc = atlas.with_suffix(".json")
    if not desc.exists():
        desc = atlas.parent / "compiled_tileset_32x32.json"
    ts = TileSet.load(atlas, desc if desc.exists() else None)

    out_dir = Path(args.out) if args.out else default_out_dir(atlas, "tileset")
    out_dir.mkdir(parents=True, exist_ok=True)

    cats = ts.categories()
    used = set(ts.tiles.keys())

    # ---- overview: every non-empty tile, thumbnail grid ------------------ #
    ids = sorted(used)
    cols = args.cols
    rows = (len(ids) + cols - 1) // cols
    ov = Image.new("RGBA", (cols * (CELL + PAD), rows * (CELL + PAD)), (24, 22, 28, 255))
    for i, tid in enumerate(ids):
        x = (i % cols) * (CELL + PAD)
        y = (i // cols) * (CELL + PAD)
        try:
            t = ts.crop(tid).resize((CELL, CELL), Image.NEAREST)
        except Exception:
            continue
        ov.alpha_composite(t, (x, y))
    ov.save(out_dir / "overview.png")

    # ---- categories.md --------------------------------------------------- #
    rep = [
        f"# 瓦片图集认知：{atlas.name}",
        "",
        f"- 图集：{ts.image_width}x{ts.image_height}px, {ts.columns} 列 x {ts.rows()} 行, "
        f"{ts.tile_size}px/格, tilecount={ts.tile_count}",
        f"- 非空格数：{len(used)}（空 {ts.tile_count - len(used)}）",
        f"- 描述文件：{ts.desc_path}",
        "",
        "## 分类目录（tile id 直接可用于地图 gid = id + firstgid）",
        "",
        "| 分类 | 数量 | id 区间（连续段） |",
        "|---|---|---|",
    ]
    for cat, cat_ids in cats.items():
        segs = []
        start = prev = cat_ids[0]
        for t in cat_ids[1:]:
            if t == prev + 1:
                prev = t
                continue
            segs.append((start, prev))
            start = prev = t
        segs.append((start, prev))
        seg_txt = ", ".join(f"{a}" if a == b else f"{a}-{b}" for a, b in segs[:12])
        if len(segs) > 12:
            seg_txt += f" …(共{len(segs)}段)"
        rep.append(f"| {cat} | {len(cat_ids)} | {seg_txt} |")
    rep.append("")
    rep.append("## 颜色速查（各分类主色，用于按颜色筛候选）")
    for cat, cat_ids in cats.items():
        colors = Counter(ts.tiles[t].avg_color for t in cat_ids if ts.tiles[t].avg_color)
        top = ", ".join(f"{c}({n})" for c, n in colors.most_common(4))
        rep.append(f"- {cat}: {top}")
    rep.append("")
    rep.append("## 空段（可用于新增瓦片）")
    empties = sorted(ts._empty)
    segs = []
    if empties:
        start = prev = empties[0]
        for t in empties[1:]:
            if t == prev + 1:
                prev = t
                continue
            segs.append((start, prev))
            start = prev = t
        segs.append((start, prev))
    rep.append(", ".join(f"{a}" if a == b else f"{a}-{b}" for a, b in segs[:20]))
    (out_dir / "categories.md").write_text("\n".join(rep), encoding="utf-8")

    # ---- category sheet --------------------------------------------------- #
    target_cat = args.category
    if target_cat:
        if target_cat not in cats:
            print(f"[warn] 未知分类 {target_cat}；可选: {list(cats)}")
        else:
            s = sheet(ts, cats[target_cat], cell=args.cell, cols=args.cols)
            s.save(out_dir / f"{target_cat}.png")
            print(f"[ok] 分类拼图: {out_dir / (target_cat + '.png')} ({len(cats[target_cat])} 个)")

    # ---- explicit id crops ------------------------------------------------ #
    if args.ids:
        want = parse_ids(args.ids)
        crops_dir = out_dir / "crops"
        crops_dir.mkdir(exist_ok=True)
        for tid in want:
            try:
                c = ts.crop(tid).resize((128, 128), Image.NEAREST)
            except Exception:
                continue
            c.save(crops_dir / f"tile_{tid}.png")
        s = sheet(ts, want, cell=args.cell, cols=args.cols)
        s.save(out_dir / "selection.png")
        print(f"[ok] 裁图 {len(want)} 个 → {crops_dir}/  拼图 → {out_dir / 'selection.png'}")

    print(f"[ok] 图集认知产物写入: {out_dir}")
    print(f"     分类: " + ", ".join(f"{k}({len(v)})" for k, v in cats.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())