#!/usr/bin/env python3
"""dump_gids.py — 裁指定 gid 拼联系表，标注 gid 与平均色，供目视判身份。

用法:
  python dump_gids.py --mapset <地图集目录> --gids 7865 9298 ... [--sheet out.png]
"""
import argparse, json, pathlib
from PIL import Image, ImageDraw


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mapset", required=True)
    ap.add_argument("--gids", nargs="+", type=int, required=True)
    ap.add_argument("--sheet", default=None)
    args = ap.parse_args()

    ms = pathlib.Path(args.mapset)
    img = Image.open(ms / "images/compiled_tileset_32x32.png").convert("RGBA")
    meta = json.loads((ms / "images/compiled_tileset_32x32.json").read_text(encoding="utf-8"))
    cols = int(meta.get("columns", 120))

    gids = args.gids
    cols_n = 8
    rows = (len(gids) + cols_n - 1) // cols_n
    cell, labelh = 40, 22
    sheet = Image.new("RGBA", (cols_n * cell, rows * (cell + labelh)), (34, 34, 40, 255))
    d = ImageDraw.Draw(sheet)
    for i, g in enumerate(gids):
        idx = g - 1
        x, y = (idx % cols) * 32, (idx // cols) * 32
        tile = img.crop((x, y, x + 32, y + 32))
        cx, cy = (i % cols_n) * cell, (i // cols_n) * (cell + labelh)
        sheet.paste(tile, (cx + 4, cy + 4))
        rgb = [p for p in tile.getdata() if p[3] > 0]
        if rgb:
            ar = sum(p[0] for p in rgb) // len(rgb)
            ag = sum(p[1] for p in rgb) // len(rgb)
            ab = sum(p[2] for p in rgb) // len(rgb)
            d.rectangle([cx + 30, cy + 4, cx + 38, cy + 12], fill=(ar, ag, ab, 255))
        d.text((cx + 2, cy + 34), str(g), fill=(230, 230, 230, 255))
    sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST)
    out = pathlib.Path(args.sheet) if args.sheet else ms / ".cache/gid_sheet.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
