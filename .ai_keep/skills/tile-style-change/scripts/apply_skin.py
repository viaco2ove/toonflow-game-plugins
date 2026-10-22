#!/usr/bin/env python3
"""
apply_skin — 把某个「对象 / 系列」的格子替换成新皮相。

两种输入方式：
  A. 程序化（--from-script <py>）：调用一个 Python 模块里的 draw(tile_id) -> PIL.Image，
     适合手写像素模板（32×32 像素贴图必须这样做，AI 生图不可用）。
  B. 图集源目录（--from-dir <dir>）：目录里放 <tileId>.png，直接贴回。

落盘逻辑与 map-editor 的 tile-style 一致：
  ① 首次覆盖时备份整张图集 → bak/compiled_tileset_32x32.png.bak
  ② 首次覆盖该格时存档原始像素 → overrides/originals/<tileId>.png
  ③ **整格替换**贴回（不能用 alpha_composite —— 原格残留的 alpha=1 幽灵像素会透出成彩色残影）
  ④ 写 overrides/<tileId>.png + compiled_dawnlike.json 的 styleOverrides

用法：
  python apply_skin.py --name orc --from-script my_sprites.py --story <故事名>
  python apply_skin.py --name "stone wall" --from-dir ./new_tiles
  python apply_skin.py --name orc --from-script my_sprites.py --dry    # 只检查不落盘
"""
import argparse
import importlib.util
import json
import os
import shutil
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tile_groups import Atlas, TILE  # noqa: E402


def load_drawer(path):
    """从 .py 加载 draw(tile_id) -> PIL.Image"""
    spec = importlib.util.spec_from_file_location("skin_mod", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fn = getattr(mod, "draw", None) or getattr(mod, "draw_orc", None) or getattr(mod, "draw_tile", None)
    if not fn:
        raise SystemExit(f"[ERR] {path} 里找不到 draw(tile_id) / draw_orc(tile_id) / draw_tile(tile_id) 函数")
    return fn


def main():
    ap = argparse.ArgumentParser(description="以对象/系列为单位换皮相")
    ap.add_argument("--story", help="地图集目录名")
    ap.add_argument("--name", required=True, help="对象/系列名（中文或英文，如 半兽人 / orc / 'stone wall'）")
    ap.add_argument("--from-script", help="提供 draw(tile_id)->PIL.Image 的 .py 文件")
    ap.add_argument("--from-dir", help="含 <tileId>.png 的目录")
    ap.add_argument("--dry", action="store_true", help="只检查不落盘")
    ap.add_argument("--no-sync", action="store_true", help="不同步 public/ui/数据库")
    a = ap.parse_args()

    if bool(a.from_script) == bool(a.from_dir):
        raise SystemExit("[ERR] --from-script 与 --from-dir 二选一")

    at = Atlas(a.story)
    hits = at.find(a.name)
    if not hits:
        raise SystemExit(f"[ERR] 找不到对象 {a.name!r}（用 tile_groups.py list 看全部）")
    key, grp = hits[0]
    ids = grp["all"]
    print(f"对象: {key}（{'角色' if grp['kind']=='character' else '系列'}）")
    print(f"格子: {len(ids)} 个 → {ids}")
    print(f"地图集: {at.story}")

    # 准备新图
    new_tiles = {}
    if a.from_script:
        draw = load_drawer(a.from_script)
        for tid in ids:
            im = draw(tid)
            if im is None:
                continue
            if im.size != (TILE, TILE):
                im = im.convert("RGBA").resize((TILE, TILE), Image.LANCZOS)
            else:
                im = im.convert("RGBA")
            new_tiles[tid] = im
        missing = [t for t in ids if t not in new_tiles]
        if missing:
            print(f"[WARN] 脚本未产出这些格子的图，将跳过: {missing}")
    else:
        for tid in ids:
            p = os.path.join(a.from_dir, f"{tid}.png")
            if os.path.isfile(p):
                im = Image.open(p).convert("RGBA")
                if im.size != (TILE, TILE):
                    im = im.resize((TILE, TILE), Image.LANCZOS)
                new_tiles[tid] = im
        missing = [t for t in ids if t not in new_tiles]
        if missing:
            print(f"[WARN] 目录里缺这些格子的图，将跳过: {missing}")
    if not new_tiles:
        raise SystemExit("[ERR] 没有可用的新图")

    if a.dry:
        print(f"\n[dry] 将替换 {len(new_tiles)} 格，未落盘")
        return

    # ── 落盘 ──
    png = at.png
    js = at.js
    bak_dir = os.path.join(at.dir, "bak")
    bak_png = os.path.join(bak_dir, "compiled_tileset_32x32.png.bak")
    if not os.path.exists(bak_png):
        os.makedirs(bak_dir, exist_ok=True)
        shutil.copy2(png, bak_png)
        print(f"已备份原图集 → {bak_png}")

    base = Image.open(png).convert("RGBA")
    with open(js, encoding="utf-8") as fp:
        meta = json.load(fp)

    ov_dir = os.path.join(at.dir, "overrides")
    orig_dir = os.path.join(ov_dir, "originals")
    os.makedirs(orig_dir, exist_ok=True)

    for tid, im in new_tiles.items():
        col, row = tid % at.columns, tid // at.columns
        box = (col * TILE, row * TILE, (col + 1) * TILE, (row + 1) * TILE)
        orig_path = os.path.join(orig_dir, f"{tid}.png")
        if not os.path.exists(orig_path):
            base.crop(box).save(orig_path)
        # ★ 整格替换（不是 alpha_composite）
        base.paste(im, (col * TILE, row * TILE))
        im.save(os.path.join(ov_dir, f"{tid}.png"))
        meta.setdefault("styleOverrides", {})[str(tid)] = {
            "overridePng": f"overrides/{tid}.png",
            "prompt": f"tile-style-change: {key}",
            "model": "procedural-pixel",
            "createdAt": "2026-10-22T00:00:00.000000Z",
        }
        print(f"  ✓ tile {tid} (col={col},row={row})")

    base.save(png)
    with open(js, "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)
    print(f"\n完成：{png}（{os.path.getsize(png)} bytes）")

    if not a.no_sync:
        sync_all(at)


def sync_all(at):
    """同步三处 + 数据库包"""
    repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
    src = at.png
    for rel in (
        os.path.join("plugins", "toonflow-field-survival", "vue", "public", "images", "compiled_tileset_32x32.png"),
        os.path.join("plugins", "toonflow-field-survival", "ui", "images", "compiled_tileset_32x32.png"),
    ):
        dst = os.path.join(repo, rel)
        if os.path.isfile(dst):
            shutil.copy2(src, dst)
            print(f"同步 → {rel}")
    # 数据库包（可选，失败不阻塞）
    try:
        import subprocess
        cli = [sys.executable, "-m", "src.toon_plugins.cli", "plugin_session_data",
               "-i", "toonflow-field-survival", "--session", "all", "-u", src, "-story", at.story]
        r = subprocess.run(cli, cwd=repo, capture_output=True, text=True, timeout=300)
        if r.returncode == 0:
            print("同步 → 数据库 map_visual 包")
        else:
            print(f"[WARN] 数据库同步失败（可稍后手动执行）: {r.stderr.strip()[:200]}")
    except Exception as e:
        print(f"[WARN] 数据库同步跳过: {e}")


if __name__ == "__main__":
    main()
