#!/usr/bin/env python3
"""程序化生成 32×32 瓦片并写入地图集（B 档贴图工作的通用工具）。

设计原则（血泪教训，别改）：
  - 32×32 必须程序化生成。不用 AI 生图：原版每格仅 12~16 色，插画缩到 32px 必糊。
  - 新瓦片只落图集尾部**连续全透明空白格**（--from-id 起，默认 12900），
    id 必须 < tilecount（引擎硬上限 13080）。
  - 整格替换 = alpha_composite + **不带 mask** 的 paste（带 mask 是 alpha 混合，留幽灵像素）。
  - 写入前断言落点 alpha 全 0；写后校验图集尺寸未变。

用法：
  # 预览（只出联系表 PNG，不动图集）
  python make_tiles.py --mapset <地图集> --plan plan.json --preview /tmp/tiles.png
  # 正式写入（自动备份图集）
  python make_tiles.py --mapset <地图集> --plan plan.json

配方 JSON 格式见 assets/plan_example.json。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw

# ---------------------------------------------------------------- 调色板 ---- #
# 摘自 dawnlike 图集实测色，保证新瓦片与原版风格统一
PALETTES: dict[str, dict] = {
    "school": {
        "OUTLINE": (20, 12, 28, 255),
        "GRASS": (109, 170, 44, 255),
        "GRASS_D": (52, 101, 36, 255),
        "WOOD": (211, 125, 44, 255),
        "WOOD_D": (134, 77, 48, 255),
        "GREY": (117, 113, 97, 255),
        "SLATE": (134, 150, 162, 255),
        "SLATE_D": (77, 73, 77, 255),
        "WHITE": (233, 228, 214, 255),
        "CHALK": (238, 236, 220, 255),
        "BRICK": (168, 88, 68, 255),
        "MORTAR": (126, 60, 46, 255),
        "RED": (178, 48, 44, 255),
        "IRON": (108, 112, 120, 255),
        "IRON_D": (92, 96, 104, 255),
    },
}


def resolve_color(c, pal):
    """颜色引用："$NAME" 查调色板 / "#aabbcc" / [r,g,b(,a)]"""
    if isinstance(c, str) and c.startswith("$"):
        name = c[1:]
        if name not in pal:
            raise KeyError(f"调色板里没有 ${name}")
        return tuple(pal[name])
    if isinstance(c, str) and c.startswith("#"):
        v = c.lstrip("#")
        return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    if isinstance(c, (list, tuple)):
        return tuple(c) if len(c) == 4 else tuple(c) + (255,)
    raise ValueError(f"非法颜色: {c!r}")


# ---------------------------------------------------------------- 绘制 op ---- #
def op_fill(d, img, o, pal):
    d.rectangle([0, 0, 31, 31], fill=resolve_color(o["color"], pal))


def op_dither(d, img, o, pal):
    """棋盘撒点做噪点质感。density 越大越稀。"""
    color = resolve_color(o["color"], pal)
    density = int(o.get("density", 2))
    x0, y0, x1, y1 = o.get("box", [0, 0, 32, 32])
    for y in range(y0, y1, density):
        for x in range(x0, x1, density):
            if (x // density + y // density) % 2 == 0:
                d.point((x, y), fill=color)


def op_rect(d, img, o, pal):
    kw = {}
    if "fill" in o:
        kw["fill"] = resolve_color(o["fill"], pal)
    if "outline" in o:
        kw["outline"] = resolve_color(o["outline"], pal)
    d.rectangle(o["box"], **kw)


def op_line(d, img, o, pal):
    d.line([tuple(o["from"]), tuple(o["to"])],
           fill=resolve_color(o["color"], pal))


def op_brick(d, img, o, pal):
    """错缝砖墙。bw=砖宽，bh=砖高。"""
    base = resolve_color(o["base"], pal)
    mortar = resolve_color(o["mortar"], pal)
    bw, bh = int(o.get("bw", 16)), int(o.get("bh", 8))
    d.rectangle([0, 0, 31, 31], fill=mortar)
    for row, y in enumerate(range(0, 32, bh)):
        offset = 0 if row % 2 == 0 else bw // 2
        for x in range(-offset, 32, bw):
            d.rectangle([x + 1, y + 1, x + bw - 2, y + bh - 2],
                        fill=base, outline=mortar)


def op_tri(d, img, o, pal):
    kw = {}
    if "fill" in o:
        kw["fill"] = resolve_color(o["fill"], pal)
    if "outline" in o:
        kw["outline"] = resolve_color(o["outline"], pal)
    d.polygon([tuple(p) for p in o["points"]], **kw)


def op_chalk(d, img, o, pal):
    """粉笔字：lines 是一组 [x0,y0,x1,y1] 短线。"""
    color = resolve_color(o.get("color", "$CHALK"), pal)
    for x0, y0, x1, y1 in o["lines"]:
        d.line([(x0, y0), (x1, y1)], fill=color)


def op_plank(d, img, o, pal):
    """木板：横条板 + 缝。n=板数，vertical=True 竖板。"""
    base = resolve_color(o["base"], pal)
    seam = resolve_color(o["seam"], pal)
    n = int(o.get("n", 4))
    vertical = bool(o.get("vertical", False))
    d.rectangle([0, 0, 31, 31], fill=base)
    for i in range(1, n):
        p = i * 32 // n
        if vertical:
            d.line([(p, 0), (p, 31)], fill=seam)
        else:
            d.line([(0, p), (31, p)], fill=seam)


def op_fence(d, img, o, pal):
    """栏杆：上下横杆 + 竖栅。bars = 竖栅 x 坐标列表。"""
    rail = resolve_color(o.get("rail", "$IRON_D"), pal)
    bar = resolve_color(o.get("bar", "$IRON"), pal)
    outline = resolve_color(o.get("outline", "$OUTLINE"), pal)
    d.rectangle([0, 4, 31, 6], fill=rail)
    d.rectangle([0, 25, 31, 27], fill=rail)
    for x in o.get("bars", [4, 13, 22, 28]):
        d.rectangle([x, 2, x + 2, 29], fill=bar, outline=outline)


OPS = {
    "fill": op_fill, "dither": op_dither, "rect": op_rect, "line": op_line,
    "brick": op_brick, "tri": op_tri, "chalk": op_chalk, "plank": op_plank,
    "fence": op_fence,
}


def build_tile(ops: list, pal: dict) -> Image.Image:
    """按 ops 顺序叠画一张 32×32 瓦片。"""
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, o in enumerate(ops):
        kind = o.get("op")
        if kind not in OPS:
            raise ValueError(f"tile op[{i}] 未知类型: {kind!r}")
        OPS[kind](d, img, o, pal)
    return img


# ---------------------------------------------------------------- 主流程 ---- #
def cell_box(t: int, columns: int):
    x, y = (t % columns) * 32, (t // columns) * 32
    return x, y, x + 32, y + 32


def is_blank(img: Image.Image, t: int, columns: int) -> bool:
    x0, y0, x1, y1 = cell_box(t, columns)
    if x1 > img.width or y1 > img.height:
        return False
    return img.crop((x0, y0, x1, y1)).getchannel("A").getextrema()[1] == 0


def main() -> int:
    ap = argparse.ArgumentParser(description="程序化生成 32×32 瓦片写入图集")
    ap.add_argument("--mapset", required=True, help="地图集目录（含 images/）")
    ap.add_argument("--plan", required=True, help="配方 JSON（见 assets/plan_example.json）")
    ap.add_argument("--from-id", type=int, default=12900,
                    help="可用空白格起始 id（默认 12900，之前区域可能是引擎保留区）")
    ap.add_argument("--dry-run", action="store_true", help="只打印落点分配")
    ap.add_argument("--preview", metavar="PNG",
                    help="生成联系表 PNG 用于人工检查（不动图集）")
    args = ap.parse_args()

    mapset = Path(args.mapset).resolve()
    imgs = mapset / "images"
    png = imgs / "compiled_tileset_32x32.png"
    desc = imgs / "compiled_tileset_32x32.json"
    plan_path = Path(args.plan)
    if not png.exists():
        print(f"[err] 找不到 {png}")
        return 2
    if not plan_path.exists():
        print(f"[err] 找不到配方 {plan_path}")
        return 2

    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    pal_spec = plan.get("palette", "school")
    if isinstance(pal_spec, dict):           # 内联调色板
        pal = dict(pal_spec)
    else:                                     # 内置调色板名
        pal = dict(PALETTES.get(pal_spec, {}))
    for k, v in plan.get("colors", {}).items():        # 局部覆盖
        pal[k] = v

    tiles = plan["tiles"]
    names = [t["name"] for t in tiles]
    dup = {n for n in names if names.count(n) > 1}
    if dup:
        print(f"[err] 配方内重名: {dup}")
        return 1

    meta = json.loads(desc.read_text(encoding="utf-8"))
    columns = int(meta["columns"])
    tilecount = int(meta["tilecount"])
    img = Image.open(png).convert("RGBA")
    orig_size = img.size

    # ---- 找连续空白段 ------------------------------------------------ #
    segments, cur = [], []
    for t in range(args.from_id, tilecount):
        if is_blank(img, t, columns):
            cur.append(t)
        else:
            if len(cur) >= 2:
                segments.append((cur[0], cur[-1]))
            cur = []
    if len(cur) >= 2:
        segments.append((cur[0], cur[-1]))
    print(f"[info] id>={args.from_id} 可用空白段: {segments}")

    need = len(tiles)
    slots = [t for a, b in segments for t in range(a, b + 1)][:need]
    if len(slots) < need:
        print(f"[err] 空白格不足：需要 {need}，只有 {len(slots)}")
        return 1

    assignment = dict(zip(slots, tiles))
    print(f"[info] 落点分配（{need} 个）:")
    for tid, t in sorted(assignment.items()):
        print(f"   {tid}  {t['name']:<20} {t.get('desc', '')}")

    built = {tid: build_tile(t["ops"], pal) for tid, t in assignment.items()}

    if args.preview:
        cols = min(need, 8)
        rows = (need + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * 36 + 4, rows * 36 + 4), (34, 34, 40, 255))
        for i, (tid, tile) in enumerate(sorted(built.items())):
            sheet.paste(tile, (4 + (i % cols) * 36, 4 + (i // cols) * 36))
        sheet = sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST)
        Path(args.preview).parent.mkdir(parents=True, exist_ok=True)
        sheet.save(args.preview)
        print(f"[ok] 预览联系表（4 倍）: {args.preview}")

    if args.dry_run or args.preview:      # preview 只出联系表，绝不动图集
        return 0

    # ---- 备份 + 写入 -------------------------------------------------- #
    bak_dir = imgs / "bak"
    bak_dir.mkdir(exist_ok=True)
    bak = bak_dir / f"{png.stem}.pre-{plan_path.stem}-{time.strftime('%Y%m%d%H%M%S')}.png"
    shutil.copy2(png, bak)
    print(f"[ok] 备份 {bak.name}")

    for tid, tile in built.items():
        x0, y0, x1, y1 = cell_box(tid, columns)
        region = img.crop((x0, y0, x1, y1)).convert("RGBA")
        if region.getchannel("A").getextrema()[1] != 0:
            print(f"[err] 落点 {tid} 非空，中止（图集未保存）")
            return 1
        merged = Image.alpha_composite(region, tile)
        img.paste(merged, (x0, y0))          # 不带 mask = 整格替换
        print(f"[ok] 写入 {tid} ({assignment[tid]['name']})")

    if img.size != orig_size:
        print(f"[err] 图集尺寸变了 {orig_size} -> {img.size}，不保存")
        return 1
    # 原子写：先写同目录临时文件再替换。
    # Windows 上 PIL 直接 save 到含非 ASCII 的路径可能报 Errno 22，
    # 走文件句柄写更稳。临时文件与目标同盘，os.replace 才是原子操作。
    tmp = png.with_name(png.stem + ".tmp.png")
    with open(tmp, "wb") as fh:
        img.save(fh, format="PNG")
    os.replace(tmp, png)
    print(f"[done] 图集已保存: {png}")

    # ---- id 对照表（后续改地图时查 gid 用） ----------------------------- #
    # 关键：图集里的格是 **tile index**，但地图 JSON 里用的是 **gid**，
    # 而本项目 firstgid = 1，即 gid = tile_index + 1。
    # 这里直接输出 gid，别让下游再手动 +1（踩过一次：全部新瓦片错位一格，
    # 渲染出来是黑色墙面）。
    mapping_name = plan.get("mapping", f"{plan_path.stem}_tiles.json")
    firstgid = int(plan.get("firstgid", 1))
    mapping = {t["name"]: tid + firstgid for tid, t in assignment.items()}
    (imgs / mapping_name).write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] id 对照表（gid = tile_index + {firstgid}）: {imgs / mapping_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
