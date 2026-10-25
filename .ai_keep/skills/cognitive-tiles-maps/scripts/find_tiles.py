#!/usr/bin/env python3
"""find_tiles.py — 按「语义需求」检索可用瓦片，并给出目视确认用的拼图。

这个脚本存在的理由：dawnlike 图集分区被打乱，**靠 gid 猜瓦片长相必错**
（9304/9305 看着像石板其实是橙木地板；真正的灰青砖在 5444~5574 段）。
正确姿势是：先按颜色/分类算法筛候选 → 裁图渲染目视确认 → 再落子。

用法:
  # 按颜色找：深色（黑板/板墙）、灰色（水泥/石砖）、砖红
  python find_tiles.py --dark --sheet dark_candidates --out <dir>
  python find_tiles.py --color "#8a8a8a" --sheet grey --out <dir>
  python find_tiles.py --category building_wall --sheet walls --out <dir>
  # 混合：颜色 + 排除太暗/太亮
  python find_tiles.py --grey --max-luma 200 --min-luma 40 --sheet grey_mid
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tilemap import TileSet, default_out_dir, find_font, hex_to_rgb  # noqa: E402

from PIL import Image, ImageDraw  # noqa: E402

PAD = 2
LABEL = 18


def luma(rgb):
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def saturation(rgb):
    mx, mn = max(rgb), min(rgb)
    return 0 if mx == 0 else (mx - mn) / mx


def hue_dist(rgb, ref_rgb):
    """crude hue distance via normalized r,g dominance"""
    def norm(c):
        s = sum(c) or 1
        return (c[0] / s, c[1] / s, c[2] / s)
    a, b = norm(rgb), norm(ref_rgb)
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def texture_uniformity(ts: TileSet, tile_id: int) -> float:
    """0..1 — how uniform the tile's pixels are.

    Floors / walls / roads are flat colour blocks (high uniformity).
    Props, characters and mixed objects are speckled (low uniformity).
    avg_color alone cannot tell them apart — this can.
    """
    try:
        tile = ts.crop(tile_id).convert("RGB")
    except Exception:
        return 0.0
    px = list(tile.getdata())
    if not px:
        return 0.0
    mean = tuple(sum(c[i] for c in px) / len(px) for i in range(3))
    var = sum(sum((c[i] - mean[i]) ** 2 for i in range(3)) for c in px) / len(px)
    std = var ** 0.5
    # 0 std -> 1.0,  >=60 -> ~0
    return max(0.0, min(1.0, 1.0 - std / 60.0))


def parse_ids(spec: str):
    """'5555-5576,12937' -> [5555, ..., 5576, 12937]"""
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


def build_sheet(ts: TileSet, ids, out_png: Path, cell: int = 32, cols: int = 16):
    if not ids:
        return
    cols = max(1, min(cols, len(ids)))
    rows = (len(ids) + cols - 1) // cols
    img = Image.new("RGBA", (cols * (cell + PAD), rows * (cell + PAD + LABEL)), (28, 26, 32, 255))
    draw = ImageDraw.Draw(img)
    font = find_font(11)
    for i, tid in enumerate(ids):
        x = (i % cols) * (cell + PAD)
        y = (i // cols) * (cell + PAD + LABEL)
        try:
            t = ts.crop(tid).resize((cell, cell), Image.NEAREST)
        except Exception:
            continue
        img.alpha_composite(t, (x, y))
        info = ts.info(tid)
        draw.rectangle([x, y, x + cell - 1, y + cell - 1], outline=(90, 90, 100, 255))
        draw.text((x + 1, y + cell + 2), str(tid), fill=(220, 220, 230, 255), font=font)
    img.save(out_png)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("atlas", nargs="?", help="tileset png (default: 用 --atlas-dir 推断)")
    ap.add_argument("--atlas-dir", default=None, help="地图集目录（含 images/）")
    ap.add_argument("--out", default=None)
    ap.add_argument("--category", default=None)
    ap.add_argument("--ids", default=None, help="只看这些 tile id，支持 5555-5576 区间（跳过颜色筛选）")
    ap.add_argument("--color", default=None, help="目标颜色 #rrggbb")
    ap.add_argument("--grey", action="store_true", help="灰色系（低饱和）")
    ap.add_argument("--dark", action="store_true", help="深色（黑板/板墙/深色水泥）")
    ap.add_argument("--warm", action="store_true", help="暖色（砖红/土黄/木色）")
    ap.add_argument("--min-luma", type=float, default=0)
    ap.add_argument("--max-luma", type=float, default=255)
    ap.add_argument("--max-sat", type=float, default=1.0)
    ap.add_argument("--min-sat", type=float, default=0.0)
    ap.add_argument("--hue-tol", type=float, default=0.12, help="--color 的色相容差")
    ap.add_argument("--min-uniform", type=float, default=0.0,
                    help="纹理均匀度下限 0~1：路面/墙面=高，道具/角色=低。0.5 可滤掉大部分杂物")
    ap.add_argument("--sheet", default="candidates")
    ap.add_argument("--cell", type=int, default=32)
    ap.add_argument("--cols", type=int, default=16)
    ap.add_argument("--limit", type=int, default=256)
    args = ap.parse_args()

    atlas = Path(args.atlas) if args.atlas else None
    if atlas is None:
        if not args.atlas_dir:
            print("[err] 需要 atlas 路径或 --atlas-dir")
            return 2
        atlas = Path(args.atlas_dir) / "images" / "compiled_tileset_32x32.png"
    desc = atlas.with_suffix(".json")
    if not desc.exists():
        desc = atlas.parent / "compiled_tileset_32x32.json"
    ts = TileSet.load(atlas, desc if desc.exists() else None)

    out_dir = Path(args.out) if args.out else default_out_dir(atlas, "tileset")
    out_dir.mkdir(parents=True, exist_ok=True)

    pool = set(ts.tiles.keys())
    if args.category:
        if args.category not in ts.categories():
            print(f"[warn] 未知分类 {args.category}，可选 {list(ts.categories())}")
            return 1
        pool &= set(ts.categories()[args.category])

    ref_rgb = hex_to_rgb(args.color) if args.color else None

    if args.ids:
        # Explicit id list: skip all colour heuristics, just show what they look like.
        want = parse_ids(args.ids)
        hits = []
        for tid in want:
            info = ts.tiles.get(tid)
            rgb = info.rgb if info else None
            hits.append((tid, rgb, luma(rgb) if rgb else 0, saturation(rgb) if rgb else 0,
                         texture_uniformity(ts, tid)))
    else:
        hits = []
        for tid in sorted(pool):
            info = ts.tiles.get(tid)
            if not info:
                continue
            rgb = info.rgb
            if rgb is None:
                continue
            l = luma(rgb)
            s = saturation(rgb)
            if not (args.min_luma <= l <= args.max_luma):
                continue
            if not (args.min_sat <= s <= args.max_sat):
                continue
            if args.grey and s > 0.22:
                continue
            if args.warm and s > 0.45:
                continue
            if ref_rgb is not None:
                if hue_dist(rgb, ref_rgb) > args.hue_tol:
                    continue
            u = texture_uniformity(ts, tid)
            if u < args.min_uniform:
                continue
            hits.append((tid, rgb, l, s, u))
        hits.sort(key=lambda h: (h[2], h[0]))
        hits = hits[: args.limit]
    ids = [h[0] for h in hits]
    sheet_path = out_dir / f"{args.sheet}.png"
    build_sheet(ts, ids, sheet_path, cell=args.cell, cols=args.cols)

    lines = [
        f"# 候选瓦片：{args.sheet}",
        "",
        f"- 图集：{atlas}",
        f"- 筛选条件：category={args.category or '全部'} color={args.color or '-'} "
        f"grey={args.grey} dark={args.dark} warm={args.warm} "
        f"luma=[{args.min_luma},{args.max_luma}] sat=[{args.min_sat},{args.max_sat}] "
        f"min_uniform={args.min_uniform}",
        f"- 命中 {len(ids)} 个（已截断至 limit={args.limit}）",
        "",
        "| id | category | avg_color | luma | sat | hue | uniform | blocked |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for tid, rgb, l, s, u in hits:
        info = ts.tiles.get(tid)
        lines.append(
            f"| {tid} | {info.category if info else '(未收录)'} | "
            f"{info.avg_color if info else '-'} | {l:.0f} | {s:.2f} | "
            f"{info.dominant_hue if info else '-'} | {u:.2f} | "
            f"{'Y' if info and info.blocked else '-'} |"
        )
    lines.append("")
    lines.append(f"目视确认拼图：`{sheet_path}`")
    (out_dir / f"{args.sheet}.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"[ok] 命中 {len(ids)} 个候选")
    print(f"     拼图: {sheet_path}")
    print(f"     清单: {out_dir / (args.sheet + '.md')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())