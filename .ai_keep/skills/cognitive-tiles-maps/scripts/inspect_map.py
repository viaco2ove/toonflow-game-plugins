#!/usr/bin/env python3
"""inspect_map.py — 认知一张 Tiled 地图：渲染 PNG + 结构清单 + 逐格材质图。

用法:
  python inspect_map.py <map.json> [--out <dir>] [--no-png] [--legend]

输出（默认写到 workbuddy-ai/cognition/<地图名>/）:
  <地图名>.png        分层渲染整图（L1/L2/L3 叠加，事件区/对象标记）
  layer-L1.png ...    每层单独渲染（排查层间遮挡用）
  report.md           结构报告：尺寸/层/NPC对象/事件区/瓦片用量（含图集分类映射）
  material.txt        逐格材质图（W=墙/屋顶 f=家具 F=地板 .=草地）+ 坐标系说明
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tilemap import MapFile, TileSet, default_out_dir, find_font, mapset_dir_for, resolve_tileset  # noqa: E402

from PIL import Image, ImageDraw  # noqa: E402

SCHEMA = {
    "W": ("wall/roof/structure", (60, 60, 70)),
    "f": ("furniture/prop", (170, 130, 60)),
    "F": ("floor", (150, 150, 160)),
    "T": ("tree/plant", (40, 110, 50)),
    ".": ("ground/grass", (110, 170, 90)),
    "o": ("object(NPC/door) cell", (220, 60, 60)),
}


def classify_tile(info, layer_idx: int, pixel=None) -> str:
    """Map a tile to a material symbol.

    IMPORTANT: the tileset `category` labels are auto-generated and **unreliable**
    — measured on 延城一中: L1 ground (1580 grass cells) is all tagged
    `building_wall`, and L2 trees (228 cells) too. So category is used ONLY as a
    weak hint; the actual pixel content decides the symbol.

    pixel: (r,g,b) average of the rendered tile, or None.
    """
    cat = (info.category or "").lower()
    if pixel is not None:
        r, g, b = pixel
        mx, mn = max(pixel), min(pixel)
        sat = 0 if mx == 0 else (mx - mn) / mx
        # green-dominant -> vegetation / grass
        if g > r + 12 and g > b + 12:
            return "T" if layer_idx >= 1 else "."
        # neutral grey-blue -> stone / concrete
        if sat < 0.18 and 55 <= (r + g + b) / 3 <= 190:
            return "W" if layer_idx == 1 else "F"
        # warm brown/orange -> wood floor / path
        if r > b + 18:
            return "F" if layer_idx == 0 else "f"
    # fallback on category when pixels are unavailable
    if layer_idx == 0:
        return "." if "grass" in cat else "F"
    if layer_idx == 1:
        if "tree" in cat or "plant" in cat:
            return "T"
        return "W"
    if "tree" in cat or "plant" in cat:
        return "T"
    if "prop" in cat or "decoration" in cat:
        return "f"
    return "f" if layer_idx == 2 else "W"


def render_layer(map_file: MapFile, layer, ts: TileSet, scale: int = 1, transparent_bg: bool = True) -> Image.Image:
    """Render one tile layer.

    transparent_bg=True keeps empty cells fully transparent so the layer can be
    composited over the layer below. Must NOT paint an opaque background here —
    doing so erases the lower layers (a mistake that made the first render look
    like a floorless village).
    """
    bg = (34, 32, 40, 0) if transparent_bg else (34, 32, 40, 255)
    img = Image.new(
        "RGBA",
        (map_file.width * ts.tile_size, map_file.height * ts.tile_size),
        bg,
    )
    for i, gid in enumerate(layer.data):
        if not gid:
            continue
        tile_id = gid - 1  # firstgid == 1
        try:
            tile_img = ts.crop(tile_id)
        except Exception:
            continue
        cx = (i % layer.width) * ts.tile_size
        cy = (i // layer.width) * ts.tile_size
        img.alpha_composite(tile_img, (cx, cy))
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("map_json")
    ap.add_argument("--out", default=None, help="output dir (default workbuddy-ai/cognition/<name>)")
    ap.add_argument("--no-png", action="store_true")
    ap.add_argument("--scale", type=int, default=1)
    args = ap.parse_args()

    map_path = Path(args.map_json)
    mf = MapFile.load(map_path)
    png_path, desc_path = resolve_tileset(map_path)
    ts = TileSet.load(png_path, desc_path)

    out_dir = Path(args.out) if args.out else default_out_dir(map_path, mf.name or map_path.stem)
    out_dir.mkdir(parents=True, exist_ok=True)

    gids = mf.all_gids()
    cat_counts = ts.used_category_counts({g - 1 for g in gids})
    known = {tid for tid in (g - 1 for g in gids) if tid in ts.tiles}
    # tiles absent from the descriptor may still be real (transparent) cells —
    # only flag ones that are neither described nor visually empty.
    unknown = {g - 1 for g in gids} - known
    blank_unknown = {t for t in unknown if ts.is_empty(t)}
    real_unknown = unknown - blank_unknown

    # ---- PNG renders ----------------------------------------------------- #
    if not args.no_png:
        # Composite layer by layer, bottom to top. Each layer is transparent where
        # it is empty, so lower layers stay visible through the gaps.
        full = Image.new(
            "RGBA",
            (mf.width * ts.tile_size, mf.height * ts.tile_size),
            (26, 24, 30, 255),
        )
        for layer in mf.tile_layers:
            li = render_layer(mf, layer, ts, scale=1, transparent_bg=True)
            full.alpha_composite(li)
            # per-layer preview on its own dark background for readability
            solo = Image.new("RGBA", li.size, (26, 24, 30, 255))
            solo.alpha_composite(li)
            solo.save(out_dir / f"layer-L{layer.index + 1}.png")
        draw = ImageDraw.Draw(full)
        font = find_font(13)
        # event zones (map-level, cell coords)
        for zone in mf.event_zones():
            x, y = zone.get("x", 0), zone.get("y", 0)
            rx, ry = zone.get("rx", 1), zone.get("ry", 1)
            draw.rectangle(
                [x * ts.tile_size, y * ts.tile_size,
                 (x + rx) * ts.tile_size - 1, (y + ry) * ts.tile_size - 1],
                outline=(255, 80, 80, 255), width=3,
            )
            label = zone.get("name", "")
            if label:
                draw.text((x * ts.tile_size + 2, y * ts.tile_size + 2),
                          label, fill=(255, 220, 80, 255), font=font)
        # objects with gid (NPC/door sprites)
        for obj, cx, cy in mf.object_cells(ts.tile_size):
            draw.rectangle(
                [cx * ts.tile_size, cy * ts.tile_size,
                 cx * ts.tile_size + 31, cy * ts.tile_size + 31],
                outline=(80, 180, 255, 255), width=2,
            )
            if obj.get("name"):
                draw.text((cx * ts.tile_size + 1, cy * ts.tile_size + 1),
                          obj["name"][:8], fill=(200, 235, 255, 255), font=font)
        if args.scale != 1:
            full = full.resize((full.width * args.scale, full.height * args.scale), Image.NEAREST)
        full.save(out_dir / f"{map_path.stem}.png")

    # ---- material map ---------------------------------------------------- #
    header = [
        f"# 逐格材质图 — {mf.name or map_path.stem}  ({mf.width}x{mf.height} 格, 1格=32px)",
        "",
        "图例: " + "  ".join(f"{k}={v[0]}" for k, v in SCHEMA.items()),
        "坐标系: 行首是 y=0（地图最北），列首是 x=0（最西）。每行前缀是 y 值。",
        "",
        "## 合成视图（最上层优先 = 玩家实际所见）",
        "",
    ]
    symbol = {}  # (x, y) -> symbol
    # Walk layers top-down: the topmost non-empty layer decides what the player
    # actually sees / stands on. This is the view that matters for editing.
    for layer in reversed(mf.tile_layers):
        li = layer.index
        for i, gid in enumerate(layer.data):
            if not gid:
                continue
            x, y = i % layer.width, i // layer.width
            key = (x, y)
            if key in symbol:
                continue  # a higher layer already claimed this cell
            symbol[key] = classify_tile(ts.info(gid - 1), li, ts.avg_pixel(gid - 1))
    for obj, cx, cy in mf.object_cells(ts.tile_size):
        symbol[(cx, cy)] = "o"
    lines = list(header)
    for y in range(mf.height):
        row = "".join(symbol.get((x, y), ".") for x in range(mf.width))
        lines.append(f"y={y:>2} {row}")

    # per-layer views (ground layout / building layout are the two you need most)
    for layer in mf.tile_layers:
        lines.append("")
        lines.append(f"## 仅 L{layer.index + 1} `{layer.name}`")
        lines.append("")
        lsym = {}
        for i, gid in enumerate(layer.data):
            if not gid:
                continue
            lsym[(i % layer.width, i // layer.width)] = classify_tile(
                ts.info(gid - 1), layer.index, ts.avg_pixel(gid - 1)
            )
        for y in range(mf.height):
            row = "".join(lsym.get((x, y), ".") for x in range(mf.width))
            lines.append(f"y={y:>2} {row}")
    (out_dir / "material.txt").write_text("\n".join(lines), encoding="utf-8")

    # ---- report ---------------------------------------------------------- #
    rep = [
        f"# 地图认知报告：{mf.name or map_path.stem}",
        "",
        f"- 文件：`{map_path}`",
        f"- 尺寸：{mf.width} x {mf.height} 格（32px/格）",
        f"- 显示名：{mf.name}  主题：{mf.theme}",
        f"- 进图旁白：{mf.narration}",
        f"- notes：{mf.notes}",
        "",
        "## 图层",
    ]
    for layer in mf.tile_layers:
        nonempty = sum(1 for g in layer.data if g)
        rep.append(
            f"- L{layer.index + 1} `{layer.name}`: {nonempty}/{len(layer.data)} 格非空"
        )
    rep.append("")
    rep.append("## 事件区 eventZones（格子坐标 x,y 起 rx×ry 格）")
    for zone in mf.event_zones():
        rep.append(
            f"- {zone.get('name','?')}: ({zone.get('x')},{zone.get('y')}) {zone.get('rx')}x{zone.get('ry')}"
        )
    rep.append("")
    objs = mf.objects()
    rep.append(f"## 对象层（共 {len(objs)} 个）")
    by_type = Counter(o["entity_type"] or o["type"] or "unnamed" for o in objs)
    rep.append("类型分布: " + ", ".join(f"{k}×{v}" for k, v in by_type.most_common()))
    rep.append("")
    rep.append("具名对象（NPC/门等）:")
    for o in objs:
        if o["name"]:
            cx, cy = int(o["x"] // 32), int(o["y"] // 32)
            rep.append(f"- id={o['id']} `{o['name']}` @({cx},{cy}) entity={o['entity_type'] or '-'}")
    rep.append("")
    rep.append("## 瓦片用量（按图集分类聚合）")
    for cat, n in cat_counts.items():
        rep.append(f"- {cat}: {n} 格")
    if real_unknown:
        rep.append("")
        rep.append(f"⚠️ {len(real_unknown)} 个 gid 既不在图集描述里、图集内也不是空白（疑似越界/损坏）: "
                   + ", ".join(str(t) for t in sorted(real_unknown)[:30]))
    if blank_unknown:
        rep.append("")
        rep.append(f"（另有 {len(blank_unknown)} 个 gid 指向图集空白格，属正常占位）")
    rep.append("")
    rep.append(f"## 产物（{out_dir}）")
    rep.append(f"- `{map_path.stem}.png` 整图渲染（红框=事件区，蓝框=对象）")
    for layer in mf.tile_layers:
        rep.append(f"- `layer-L{layer.index + 1}.png` 单层渲染")
    rep.append("- `material.txt` 逐格材质图")
    (out_dir / "report.md").write_text("\n".join(rep), encoding="utf-8")

    print(f"[ok] 认知产物写入: {out_dir}")
    print(f"     地图: {mf.name} ({mf.width}x{mf.height})  事件区 {len(mf.event_zones())}  对象 {len(objs)}")
    print(f"     瓦片分类 Top5: {list(cat_counts.items())[:5]}")
    if real_unknown:
        print(f"     ⚠️ 异常 gid {len(real_unknown)} 个: {sorted(real_unknown)[:10]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
