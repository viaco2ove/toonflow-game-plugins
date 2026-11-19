#!/usr/bin/env python3
"""slice_to_atlas.py — 把原型概念图按 32px 切片写进图集空白格，地图底图层指向切片 gid。

路线依据（已核实）：
  - 渲染器 mapBake.ts 只按 gid 从图集逐格 drawImage，无背景图/图片层。
  - 图集 120 列，tilecount 13080，gid = tile_index + 1（firstgid=1）。
  - 空白格中被现有其它地图引用的 59 个 gid 本来就渲染为空，保留不动；其余可复用。

用法：
  python slice_to_atlas.py --dry-run
  python slice_to_atlas.py --preview <dir>
  python slice_to_atlas.py --apply
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
MAPSET = HERE.parent.parent  # map_design/<故事名>
IMGS = MAPSET / "images"
MAPS = MAPSET / "maps"
ATLAS = IMGS / "compiled_tileset_32x32.png"
DESC = IMGS / "compiled_tileset_32x32.json"
PREV = MAPSET / "previews"

TILE = 32

JOBS = [
    {"stem": "mulberryTown", "preview": "幸存者营地_原型图.png", "W": 43, "H": 56},
    {"stem": "mulberryForest", "preview": "外围废墟带_原型图.png", "W": 60, "H": 40},
]


def load_desc():
    d = json.loads(DESC.read_text(encoding="utf-8"))
    return int(d.get("columns", 120)), int(d.get("tilecount", 13080))


def blank_indices(img: Image.Image, cols: int, tilecount: int) -> set[int]:
    out = set()
    for t in range(tilecount):
        x, y = (t % cols) * TILE, (t // cols) * TILE
        if x + TILE > img.width or y + TILE > img.height:
            continue
        if img.crop((x, y, x + TILE, y + TILE)).getchannel("A").getextrema()[1] == 0:
            out.add(t)
    return out


def referenced_blank_indices(blank: set[int]) -> set[int]:
    """现有地图引用到的、落在空白格上的 gid → 这些格保留不动。"""
    protected: set[int] = set()
    for mp in MAPS.glob("*.json"):
        d = json.loads(mp.read_text(encoding="utf-8-sig"))
        for layer in d.get("layers", []):
            if layer.get("type") != "tilelayer":
                continue
            for g in layer.get("data", []):
                try:
                    g = int(g)
                except (TypeError, ValueError):
                    continue
                if g:
                    idx = g - 1
                    if idx in blank:
                        protected.add(idx)
    return protected


def slice_prototype(job: dict) -> list[Image.Image]:
    im = Image.open(PREV / job["preview"]).convert("RGB")
    im = im.resize((job["W"] * TILE, job["H"] * TILE), Image.LANCZOS)
    tiles: list[Image.Image] = []
    for y in range(job["H"]):
        for x in range(job["W"]):
            c = im.crop((x * TILE, y * TILE, x * TILE + TILE, y * TILE + TILE))
            tiles.append(c.convert("RGBA"))
    return tiles


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--preview", metavar="DIR")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    cols, tilecount = load_desc()
    atlas = Image.open(ATLAS).convert("RGBA")
    blank = blank_indices(atlas, cols, tilecount)
    protected = referenced_blank_indices(blank)
    free = sorted(blank - protected, key=lambda t: (t < 12900, t))  # 尾部优先
    print(f"[info] 图集 tilecount={tilecount} cols={cols} 空白={len(blank)} 保护={len(protected)} 可用={len(free)}")

    # 全局切片 + 去重
    hash_to_slot: dict[str, int] = {}
    plan: dict[str, list[int]] = {}   # stem -> [gid per cell]
    unique_tiles: dict[int, Image.Image] = {}  # slot -> tile
    cursor = 0
    shortage = False

    for job in JOBS:
        tiles = slice_prototype(job)
        gids: list[int] = []
        for c in tiles:
            h = hashlib.md5(c.tobytes()).hexdigest()
            if h in hash_to_slot:
                slot = hash_to_slot[h]
            else:
                if cursor >= len(free):
                    shortage = True
                    slot = -1
                else:
                    slot = free[cursor]
                    cursor += 1
                    hash_to_slot[h] = slot
                    unique_tiles[slot] = c
            gids.append(slot + 1 if slot >= 0 else 0)
        plan[job["stem"]] = gids
        print(f"[info] {job['stem']}: 格 {len(tiles)} 累计分配 {cursor} 格")

    print(f"[info] 全局唯一切片 {len(unique_tiles)}，可用空位 {len(free)}，"
          f"{'缺口!' if shortage else '够用'}")

    if args.dry_run:
        return 1 if shortage else 0

    # ---- 预览：内存图集 + 重排渲染 ----
    if args.preview:
        out = Path(args.preview)
        out.mkdir(parents=True, exist_ok=True)
        preview_atlas = atlas.copy()
        for slot, tile in unique_tiles.items():
            x, y = (slot % cols) * TILE, (slot // cols) * TILE
            preview_atlas.paste(tile, (x, y))
        for job in JOBS:
            W, H = job["W"], job["H"]
            canvas = Image.new("RGBA", (W * TILE, H * TILE), (26, 24, 30, 255))
            for i, gid in enumerate(plan[job["stem"]]):
                if not gid:
                    continue
                slot = gid - 1
                tile = preview_atlas.crop(((slot % cols) * TILE, (slot // cols) * TILE,
                                           (slot % cols) * TILE + TILE,
                                           (slot // cols) * TILE + TILE))
                canvas.alpha_composite(tile, ((i % W) * TILE, (i // W) * TILE))
            canvas.save(out / f"{job['stem']}_slice.png")
            # 并排：左原型 右切片重排
            proto = Image.open(PREV / job["preview"]).convert("RGB").resize(
                (W * TILE, H * TILE), Image.LANCZOS)
            combo = Image.new("RGB", (W * TILE * 2 + 16, H * TILE), (20, 20, 24))
            combo.paste(proto, (0, 0))
            combo.paste(canvas.convert("RGB"), (W * TILE + 16, 0))
            combo.save(out / f"{job['stem']}_compare.png")
            print(f"[ok] 预览 {out / (job['stem'] + '_compare.png')}")
        if not args.apply:
            return 0

    if not args.apply:
        print("[err] 需要 --dry-run / --preview / --apply 之一")
        return 2

    if shortage:
        print("[err] 空位不足，中止（未写盘）")
        return 1

    # ---- 备份 ----
    stamp = time.strftime("%Y%m%d%H%M%S")
    (IMGS / "bak").mkdir(exist_ok=True)
    (MAPS / "bak").mkdir(exist_ok=True)
    shutil.copy2(ATLAS, IMGS / "bak" / f"{ATLAS.stem}.pre-slice-{stamp}.png")
    for job in JOBS:
        mp = MAPS / f"{job['stem']}.json"
        shutil.copy2(mp, MAPS / "bak" / f"{mp.stem}.pre-slice-{stamp}.json")
    print("[ok] 备份完成")

    # ---- 写图集 ----
    for slot, tile in unique_tiles.items():
        x, y = (slot % cols) * TILE, (slot // cols) * TILE
        region = atlas.crop((x, y, x + TILE, y + TILE))
        if region.getchannel("A").getextrema()[1] != 0:
            print(f"[err] 落点 {slot} 非空，中止（图集未保存）")
            return 1
        atlas.paste(tile, (x, y))
    if atlas.size != (3840, 3488):
        print(f"[err] 图集尺寸变化 {atlas.size}，不保存")
        return 1
    tmp = ATLAS.with_name(ATLAS.stem + ".tmp.png")
    with open(tmp, "wb") as fh:
        atlas.save(fh, format="PNG")
    os.replace(tmp, ATLAS)
    print(f"[ok] 图集已写入 {len(unique_tiles)} 个切片格")

    # ---- 重写地图 ----
    for job in JOBS:
        mp = MAPS / f"{job['stem']}.json"
        body = json.loads(mp.read_text(encoding="utf-8-sig"))
        tl = [l for l in body["layers"] if l.get("type") == "tilelayer"]
        actors_before = sum(len(l.get("objects", [])) for l in body["layers"]
                            if l.get("type") == "objectgroup")
        zones_before = len(body.get("eventZones", []) or [])
        gids = plan[job["stem"]]
        assert len(tl[0]["data"]) == len(gids), "底图层长度不符"
        tl[0]["data"] = gids
        for layer in tl[1:]:
            layer["data"] = [0] * len(layer["data"])
        actors_after = sum(len(l.get("objects", [])) for l in body["layers"]
                            if l.get("type") == "objectgroup")
        zones_after = len(body.get("eventZones", []) or [])
        assert actors_after == actors_before, f"Actors 变化 {actors_before}→{actors_after}"
        assert zones_after == zones_before, f"事件区变化 {zones_before}→{zones_after}"
        for layer in tl:
            for g in layer["data"]:
                if g and g > tilecount:
                    raise SystemExit(f"越界 gid {g}")
        tmpf = mp.with_name(mp.stem + ".tmp.json")
        with open(tmpf, "w", encoding="utf-8") as fh:
            json.dump(body, fh, ensure_ascii=False, indent=2)
        os.replace(tmpf, mp)
        print(f"[ok] {mp.name} 底图层 {len(gids)} 格；Actors {actors_after}；事件区 {zones_after}")

    # 审计对照表
    report = {
        "cols": cols, "tilecount": tilecount,
        "unique_slices": len(unique_tiles),
        "gid_by_map": {k: v for k, v in plan.items()},
    }
    (IMGS / "slice_tiles.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[done] 落盘完成，对照表 images/slice_tiles.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
