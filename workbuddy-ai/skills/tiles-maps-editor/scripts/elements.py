#!/usr/bin/env python3
"""elements.py — 识别一张地图里「房子/道路/树木/围栏/家具」各由哪些瓦片构成。

存在的理由：图集描述文件里的 `category` 标签**不可靠**（实测延城一中
L1 地面 1580 格草地全被标成 `building_wall`，L2 的 228 格树也是）。
判断一个格是什么，只能靠**像素颜色**。

用法:
  python elements.py <map.json> [--out <dir>] [--json]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "cognitive-tiles-maps" / "scripts"))
from tilemap import MapFile, TileSet, resolve_tileset  # noqa: E402

# ---- 像素特征分类（依据实测色板）-------------------------------------- #
GRASS_GREEN = (109, 170, 44)
PLANT_DARK = (52, 101, 36)
HEDGE_GREEN = (71, 112, 76)
TREE_GREEN = (86, 104, 65)
WOOD_ORANGE = (211, 125, 44)
WOOD_DARK = (134, 77, 48)
BUILD_WARM = (180, 114, 53)
NEUTRAL_GREY = (117, 113, 97)
SLATE = (134, 150, 162)
CONCRETE = (77, 73, 77)


def classify(rgb):
    """Return a coarse material tag for an average RGB triple."""
    if rgb is None:
        return "empty"
    r, g, b = rgb
    mx, mn = max(rgb), min(rgb)
    sat = 0 if mx == 0 else (mx - mn) / mx
    lum = (r + g + b) / 3
    # 植物：绿占优
    if g > r + 10 and g > b + 10:
        if abs(r - HEDGE_GREEN[0]) < 22 and abs(g - HEDGE_GREEN[1]) < 22:
            return "hedge"          # 绿篱灌木
        if abs(r - TREE_GREEN[0]) < 22 and abs(g - TREE_GREEN[1]) < 22:
            return "tree"           # 树冠
        if abs(r - GRASS_GREEN[0]) < 26 and abs(g - GRASS_GREEN[1]) < 26:
            return "grass"          # 草地
        return "plant"
    # 暖色 = 木/土
    if r > b + 16:
        if abs(r - WOOD_ORANGE[0]) < 22 and abs(g - WOOD_ORANGE[1]) < 26:
            return "wood"           # 木地板 / 土路 / 木构件
        if abs(r - BUILD_WARM[0]) < 24 and abs(g - BUILD_WARM[1]) < 24:
            return "building"       # 建筑暖棕构件
        return "earth"
    # 低饱和中性 = 石/灰
    if sat < 0.20:
        if abs(lum - CONCRETE[0]) < 26:
            return "concrete"       # 深灰水泥
        if abs(r - SLATE[0]) < 26 and abs(g - SLATE[1]) < 26:
            return "slate"          # 蓝灰石板
        return "stone"
    return "other"


# 元素名 → 允许的材质标签
ELEMENT_TAGS = {
    "地面/草地": {"grass", "plant"},
    "道路/栈道": {"wood", "earth"},
    "建筑地板": {"wood", "building"},
    "建筑墙体/构件": {"building", "stone", "slate"},
    "屋顶(实心)": {"building"},
    "树": {"tree"},
    "绿篱/灌木": {"hedge"},
    "石块/围墙": {"stone", "slate", "concrete"},
    "家具/装饰": {"other", "plant", "wood"},
}


def contiguous_runs(cells):
    """Group (x,y) cells into horizontal runs -> list of (y, x0, x1)."""
    by_row = defaultdict(list)
    for x, y in cells:
        by_row[y].append(x)
    out = []
    for y, xs in sorted(by_row.items()):
        xs.sort()
        s = pr = xs[0]
        for x in xs[1:]:
            if x == pr + 1:
                pr = x
                continue
            out.append((y, s, pr))
            s = pr = x
        out.append((y, s, pr))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("map_json")
    ap.add_argument("--out", default=None)
    ap.add_argument("--json", action="store_true", help="只输出 JSON")
    args = ap.parse_args()

    map_path = Path(args.map_json)
    mf = MapFile.load(map_path)
    png, desc = resolve_tileset(map_path)
    ts = TileSet.load(png, desc)
    W, H = mf.width, mf.height

    # ---- 逐格分类 -------------------------------------------------------- #
    layer_cells = []
    for layer in mf.tile_layers:
        cells = {}
        for i, gid in enumerate(layer.data):
            if not gid:
                continue
            x, y = i % layer.width, i // layer.width
            tag = classify(ts.avg_pixel(gid - 1))
            cells[(x, y)] = (gid, tag)
        layer_cells.append(cells)

    # ---- 元素归类 -------------------------------------------------------- #
    elements = defaultdict(lambda: {"count": 0, "gids": Counter(), "cells": []})
    gid_tag = {}
    for layer, cells in zip(mf.tile_layers, layer_cells):
        for (x, y), (gid, tag) in cells.items():
            gid_tag.setdefault(gid, set()).add(tag)
            for name, tags in ELEMENT_TAGS.items():
                if tag in tags:
                    elements[name]["count"] += 1
                    elements[name]["gids"][gid] += 1
                    elements[name]["cells"].append((layer.index, x, y, gid))
                    break

    # ---- 道路走向 -------------------------------------------------------- #
    road_cells = [(x, y) for (x, y), (g, t) in layer_cells[0].items()
                  if t in ("wood", "earth") and len(gid_tag.get(g, ())) <= 2]
    road_runs = contiguous_runs(road_cells)

    # ---- 建筑轮廓（实心屋顶块）---------------------------------------- #
    roof_cells = []
    for layer, cells in zip(mf.tile_layers, layer_cells):
        for (x, y), (gid, tag) in cells.items():
            if tag != "building":
                continue
            # 屋顶：被上下左右同类格包围（形成实心块）
            nb = sum(1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                     if (x + dx, y + dy) in cells
                     and cells[(x + dx, y + dy)][1] == "building")
            if nb == 4:
                roof_cells.append((x, y))

    seen = set()
    blocks = []
    for c in roof_cells:
        if c in seen:
            continue
        stack = [c]
        seen.add(c)
        comp = []
        while stack:
            cx, cy = stack.pop()
            comp.append((cx, cy))
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (cx + dx, cy + dy)
                if n in roof_cells and n not in seen:
                    seen.add(n)
                    stack.append(n)
        blocks.append(comp)
    blocks.sort(key=len, reverse=True)

    # ---- 活物 ------------------------------------------------------------ #
    actors = mf.objects()
    actor_types = Counter(a["entity_type"] or a["type"] or "unnamed" for a in actors)

    # ---- 输出 ------------------------------------------------------------ #
    report = []
    report.append(f"# 元素识别报告 — {mf.name or map_path.stem}")
    report.append("")
    report.append(f"- 地图：`{map_path}`")
    report.append(f"- 尺寸：{W} x {H} 格")
    report.append(f"- 地图集：`{map_path.resolve().parent.parent}`")
    report.append("")

    report.append("## 元素构成（按像素材质判定，不信 category 标签）")
    report.append("")
    report.append("| 元素 | 格数 | 涉及 gid（gid=格数） |")
    report.append("|---|---|---|")
    for name, _ in sorted(ELEMENT_TAGS.items(), key=lambda kv: -elements[kv[0]]["count"]):
        info = elements[name]
        if not info["count"]:
            continue
        gids = ", ".join(f"{g}({n})" for g, n in info["gids"].most_common(8))
        report.append(f"| {name} | {info['count']} | {gids} |")
    report.append("")

    report.append("## 道路走向（L1 层，水平连续段）")
    report.append("")
    report.append("| y | x 范围 | 宽 |")
    report.append("|---|---|---|")
    for y, x0, x1 in road_runs:
        if x1 - x0 < 1:
            continue
        report.append(f"| {y} | {x0}..{x1} | {x1 - x0 + 1} |")
    report.append("")

    report.append("## 建筑实心块（屋顶，4 邻均为建筑构件）")
    report.append("")
    if blocks:
        for comp in blocks[:12]:
            xs = [c[0] for c in comp]
            ys = [c[1] for c in comp]
            report.append(f"- {len(comp)} 格  x[{min(xs)}..{max(xs)}] y[{min(ys)}..{max(ys)}]")
    else:
        report.append("（无整块实心屋顶）")
    report.append("")

    report.append("## 活物（对象层）")
    report.append("")
    report.append(f"总数 {len(actors)}，类型分布：")
    for t, n in actor_types.most_common():
        report.append(f"- {t}: {n}")
    report.append("")
    report.append("具名对象：")
    for a in actors:
        if a["name"]:
            cx, cy = int(a["x"] // 32), int(a["y"] // 32)
            report.append(f"- id={a['id']} `{a['name']}` @({cx},{cy}) entity={a['entity_type'] or '-'} gid={a['gid']}")
    report.append("")
    report.append("## gid → 材质对照（本次地图用到的全部）")
    report.append("")
    report.append("| gid | tile id | 材质 | 像素 |")
    report.append("|---|---|---|---|")
    used = set()
    for layer in mf.tile_layers:
        used.update(g for g in layer.data if g)
    for gid in sorted(used):
        tags = gid_tag.get(gid, set())
        tag = sorted(tags)[0] if tags else "?"
        rgb = ts.avg_pixel(gid - 1)
        rgb_s = f"({rgb[0]:.0f},{rgb[1]:.0f},{rgb[2]:.0f})" if rgb else "-"
        report.append(f"| {gid} | {gid - 1} | {tag} | {rgb_s} |")

    text = "\n".join(report)
    out = Path(args.out) if args.out else map_path.resolve().parent.parent / "images" / "elements.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")

    if args.json:
        print(json.dumps({
            "map": str(map_path),
            "size": [W, H],
            "elements": {k: v["count"] for k, v in elements.items()},
            "gids": {str(g): sorted(t) for g, t in gid_tag.items()},
            "blocks": [[[c[0], c[1]] for c in b] for b in blocks[:12]],
            "actors": len(actors),
        }, ensure_ascii=False, indent=2))
    else:
        print(text)
    print(f"\n[ok] 报告已写入: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
