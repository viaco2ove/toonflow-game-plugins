#!/usr/bin/env python3
"""preview_map.py — 按映射表在内存副本上变换并渲染，不落盘，供落地前目视对比。

用法:
  python preview_map.py --mapset <目录> --map <slug>.json --mapping m.json --out after.png
"""
import argparse, copy, json, sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "cognitive-tiles-maps" / "scripts"))
from tilemap import MapFile, TileSet, resolve_tileset  # noqa: E402


def apply_rule(data, rule, clr, width):
    changed = 0
    for i, g in enumerate(data):
        if g in rule:
            tgt = rule[g]
            if isinstance(tgt, list):
                x, y = i % width, i // width
                tgt = tgt[(x + y) % len(tgt)]
            data[i] = tgt
            changed += 1
        elif g in clr:
            data[i] = 0
            changed += 1
    return changed


def render(mf, ts):
    full = Image.new("RGBA", (mf.width * ts.tile_size, mf.height * ts.tile_size),
                     (26, 24, 30, 255))
    for layer in mf.tile_layers:
        for i, gid in enumerate(layer.data):
            if not gid:
                continue
            try:
                tile = ts.crop(gid - 1)
            except Exception:
                continue
            cx = (i % layer.width) * ts.tile_size
            cy = (i // layer.width) * ts.tile_size
            full.alpha_composite(tile, (cx, cy))
    return full


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mapset", required=True)
    ap.add_argument("--map", required=True)
    ap.add_argument("--mapping", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    ms = Path(args.mapset)
    mp = ms / "maps" / args.map
    mf = MapFile.load(mp)
    png_path, desc_path = resolve_tileset(mp)
    ts = TileSet.load(png_path, desc_path)

    plan = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    layers_map = {}
    for k, v in plan.get("layers", {}).items():
        layers_map[int(k)] = {int(a): ([int(x) for x in b] if isinstance(b, list) else int(b))
                              for a, b in v.items()}
    clear_map = {int(k): set(v) for k, v in plan.get("clear", {}).items()}

    total = 0
    for li, layer in enumerate(mf.tile_layers):
        total += apply_rule(layer.data, layers_map.get(li, {}),
                            clear_map.get(li, set()), layer.width)

    actors = len(mf.objects())
    zones = len(mf.event_zones())
    img = render(mf, ts)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"[ok] 改动 {total} 格；Actors {actors}；事件区 {zones}；预览 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
