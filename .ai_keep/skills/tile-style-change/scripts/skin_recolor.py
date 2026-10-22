#!/usr/bin/env python3
"""
skin_recolor — 「保形换色」换皮：保持原格子的**形状/明暗结构**不变，只换配色方案。

这是给建筑/地形/家具这类**没有固定角色造型**的系列用的通用手段：
  · 原版像素画得好（有细节、有材质），直接换色就能得到新风格，细节不丢；
  · 建筑换「现代风」时，把石墙的灰蓝改成混凝土灰+玻璃蓝、把木墙改成钢构+玻璃，
    就自然变成现代风格，而且 72 格各自不同的砖缝/破损细节全部保留。

用法：
  # 预览配色效果（不落盘）
  python skin_recolor.py --name "stone wall" --palette modern --preview out.png
  # 落盘
  python skin_recolor.py --name "stone wall" --palette modern

palette 可选：
  modern   现代都市（混凝土 + 玻璃蓝 + 钢构）
  neon     赛博霓虹（黑底 + 青/品红辉光）
  nature   荒野自然（土黄 + 苔绿 + 木棕）
  ice      寒冰（冷白 + 冰蓝）
  volcanic 熔岩火山（黑岩 + 橙红熔痕）
  dark     暗黑哥特（近黑 + 血红 + 冷灰）
  custom:<hex,hex,...>  自定义（按亮度分组：暗/中/亮/高光）

也可以自定义多个 palette 文件（JSON），格式见 references/palettes.md。
"""
import argparse
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tile_groups import Atlas, TILE  # noqa: E402

# ── 调色板 ──────────────────────────────────────────────────
# 每个 palette: {name, map: {原色hex: 新色hex}} 用「按亮度重新映射」的方式更通用
PALETTES = {
    "modern": {
        "label": "现代都市",
        "dark": (46, 50, 58), "mid": (108, 116, 128), "light": (172, 180, 192),
        "accent": (86, 156, 196), "accent2": (206, 214, 226), "warm": (150, 128, 96),
    },
    "neon": {
        "label": "赛博霓虹",
        "dark": (18, 12, 30), "mid": (58, 30, 92), "light": (140, 90, 190),
        "accent": (0, 240, 255), "accent2": (255, 60, 200), "warm": (255, 140, 40),
    },
    "nature": {
        "label": "荒野自然",
        "dark": (58, 48, 34), "mid": (110, 94, 62), "light": (162, 146, 100),
        "accent": (74, 106, 54), "accent2": (198, 186, 140), "warm": (140, 88, 48),
    },
    "ice": {
        "label": "寒冰",
        "dark": (58, 82, 106), "mid": (122, 158, 184), "light": (188, 214, 232),
        "accent": (216, 242, 255), "accent2": (140, 200, 235), "warm": (196, 222, 240),
    },
    "volcanic": {
        "label": "熔岩火山",
        "dark": (32, 26, 26), "mid": (74, 58, 54), "light": (124, 100, 90),
        "accent": (232, 96, 24), "accent2": (255, 176, 48), "warm": (200, 70, 20),
    },
    "dark": {
        "label": "暗黑哥特",
        "dark": (16, 14, 20), "mid": (54, 48, 62), "light": (104, 96, 116),
        "accent": (176, 32, 40), "accent2": (196, 190, 206), "warm": (128, 40, 44),
    },
}


def rgb_to_h(c):
    return "#%02x%02x%02x" % c[:3]


def h_to_rgb(s):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def build_lut(pal):
    """按亮度把任意原色映射到目标色的 5 档梯度"""
    def lerp(a, b, t):
        return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

    stops = [
        (0.00, pal["dark"]),
        (0.35, pal["mid"]),
        (0.62, pal["light"]),
        (0.85, pal["accent2"]),
        (1.00, pal["accent"]),
    ]

    def map_lum(lum):
        for i in range(len(stops) - 1):
            l0, c0 = stops[i]
            l1, c1 = stops[i + 1]
            if l0 <= lum <= l1:
                t = 0 if l1 == l0 else (lum - l0) / (l1 - l0)
                return lerp(c0, c1, t)
        return stops[-1][1]

    return map_lum


def recolor_tile(im, map_lum, pal):
    """按亮度重映射，同时给「暖色区域」加 accent2 提亮"""
    src = im.convert("RGBA")
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    sp, op = src.load(), out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = sp[x, y]
            if a == 0:
                continue
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            nr, ng, nb = map_lum(lum)
            # 原图偏暖（红>蓝）→ 用 accent2 替代高光，保持材质区分
            if r > b + 18 and lum > 0.5:
                nr, ng, nb = pal["accent2"]
            # 原图偏绿/偏冷（植被/水）→ 用 accent
            if g > r + 12 and g > b + 12:
                nr, ng, nb = pal["accent"]
            op[x, y] = (nr, ng, nb, a)
    return out


def main():
    ap = argparse.ArgumentParser(description="保形换色：按对象/系列批量换配色")
    ap.add_argument("--story")
    ap.add_argument("--name", required=True)
    ap.add_argument("--palette", required=True, help="modern/neon/nature/ice/volcanic/dark 或 custom:<hex,hex,...>")
    ap.add_argument("--preview", help="只导出联络图到该路径，不落盘")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--no-sync", action="store_true")
    a = ap.parse_args()

    at = Atlas(a.story)
    hits = at.find(a.name)
    if not hits:
        raise SystemExit(f"[ERR] 找不到对象 {a.name!r}")
    key, grp = hits[0]
    ids = grp["all"]
    print(f"对象: {key}  {len(ids)} 格")

    # 解析 palette
    if a.palette.startswith("custom:"):
        hexes = [h for h in a.palette[7:].split(",") if h.strip()]
        if len(hexes) < 3:
            raise SystemExit("[ERR] custom 至少要 3 个颜色: custom:#111,#555,#aaa,#fff")
        cols = [h_to_rgb(h) for h in hexes]
        pal = {"label": "custom", "dark": cols[0], "mid": cols[len(cols) // 3],
               "light": cols[(2 * len(cols)) // 3], "accent": cols[-1],
               "accent2": cols[-2] if len(cols) > 1 else cols[-1]}
    else:
        if a.palette not in PALETTES:
            raise SystemExit(f"[ERR] 未知 palette {a.palette!r}，可选: {', '.join(PALETTES)}")
        pal = PALETTES[a.palette]
    print(f"配色: {pal['label']}")

    map_lum = build_lut(pal)
    base = Image.open(at.png).convert("RGBA")
    new_tiles = {}
    for tid in ids:
        c, r = tid % at.columns, tid // at.columns
        crop = base.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE))
        new_tiles[tid] = recolor_tile(crop, map_lum, pal)

    # 联络图预览
    if a.preview:
        S = 5
        minc = min(t % at.columns for t in ids); maxc = max(t % at.columns for t in ids)
        minr = min(t // at.columns for t in ids); maxr = max(t // at.columns for t in ids)
        w = (maxc - minc + 1) * TILE * S
        h = (maxr - minr + 1) * TILE * S
        sheet = Image.new("RGBA", (w, h), (26, 26, 30, 255))
        for tid in ids:
            c, r = tid % at.columns, tid // at.columns
            cell = new_tiles[tid].resize((TILE * S, TILE * S), Image.NEAREST)
            sheet.paste(cell, ((c - minc) * TILE * S, (r - minr) * TILE * S), cell)
        sheet.save(a.preview)
        print(f"预览 → {a.preview}")
        if not a.dry:
            return

    if a.dry:
        print("[dry] 未落盘")
        return

    # 落盘
    import shutil
    bak_dir = os.path.join(at.dir, "bak")
    bak_png = os.path.join(bak_dir, "compiled_tileset_32x32.png.bak")
    if not os.path.exists(bak_png):
        os.makedirs(bak_dir, exist_ok=True)
        shutil.copy2(at.png, bak_png)
        print(f"已备份 → {bak_png}")

    ov_dir = os.path.join(at.dir, "overrides")
    orig_dir = os.path.join(ov_dir, "originals")
    os.makedirs(orig_dir, exist_ok=True)
    with open(at.js, encoding="utf-8") as fp:
        meta = json.load(fp)

    for tid, im in new_tiles.items():
        c, r = tid % at.columns, tid // at.columns
        box = (c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE)
        op = os.path.join(orig_dir, f"{tid}.png")
        if not os.path.exists(op):
            base.crop(box).save(op)
        base.paste(im, (c * TILE, r * TILE))
        im.save(os.path.join(ov_dir, f"{tid}.png"))
        meta.setdefault("styleOverrides", {})[str(tid)] = {
            "overridePng": f"overrides/{tid}.png",
            "prompt": f"tile-style-change: {key} → {pal['label']}",
            "model": "recolor",
            "createdAt": "2026-10-22T00:00:00.000000Z",
        }
    base.save(at.png)
    with open(at.js, "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)
    print(f"完成：{len(ids)} 格已换成「{pal['label']}」 → {at.png}")

    if not a.no_sync:
        repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
        for rel in (
            os.path.join("plugins", "toonflow-field-survival", "vue", "public", "images", "compiled_tileset_32x32.png"),
            os.path.join("plugins", "toonflow-field-survival", "ui", "images", "compiled_tileset_32x32.png"),
        ):
            dst = os.path.join(repo, rel)
            if os.path.isfile(dst):
                shutil.copy2(at.png, dst)
                print(f"同步 → {rel}")


if __name__ == "__main__":
    main()
