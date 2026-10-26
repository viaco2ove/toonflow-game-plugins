#!/usr/bin/env python3
"""ctm.py — 统一入口：给一个路径，自动判断是地图还是图集并执行认知。

用法:
  python ctm.py <path> [--out <dir>] [--sheet <name>] [--category <cat>]
                  [--grey] [--dark] [--warm] [--min-uniform 0.6] [--ids 5555-5576]

<path> 可以是:
  - 地图 JSON (*.json, 在 maps/ 下)      -> 渲染整图 + 分层图 + 材质图 + 结构报告
  - 瓦片图集 PNG (*.png, 在 images/ 下)  -> 图集总览 + 分类目录
  - 地图集目录 (含 maps/ 与 images/)     -> 里面所有地图都跑一遍
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable


def run(script: str, args: list) -> int:
    cmd = [PY, str(HERE / script)] + args
    print(f"$ {' '.join(cmd)}")
    return subprocess.call(cmd)


def is_map_json(p: Path) -> bool:
    return p.suffix.lower() == ".json" and p.name.endswith(".json") and "maps" in p.parts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--out", default=None)
    ap.add_argument("--sheet", default="candidates")
    ap.add_argument("--category", default=None)
    ap.add_argument("--ids", default=None)
    ap.add_argument("--grey", action="store_true")
    ap.add_argument("--dark", action="store_true")
    ap.add_argument("--warm", action="store_true")
    ap.add_argument("--min-uniform", type=float, default=0.0)
    ap.add_argument("--min-luma", type=float, default=0)
    ap.add_argument("--max-luma", type=float, default=255)
    ap.add_argument("--max-sat", type=float, default=1.0)
    ap.add_argument("--color", default=None)
    ap.add_argument("--scale", type=int, default=1)
    args = ap.parse_args()

    target = Path(args.path)
    if not target.exists():
        print(f"[err] 路径不存在: {target}")
        return 2

    if target.is_dir():
        maps_dir = target / "maps"
        if maps_dir.is_dir():
            maps = sorted(maps_dir.glob("*.json"))
            print(f"[info] 地图集目录，{len(maps)} 张地图")
            for m in maps:
                run("inspect_map.py", [str(m)] + (["--out", args.out] if args.out else []))
            return 0
        images = target / "images"
        if images.is_dir():
            pngs = sorted(images.glob("*.png"))
            print(f"[info] 图集目录，{len(pngs)} 张图")
            for png in pngs:
                run("inspect_tileset.py", [str(png)] + (["--out", args.out] if args.out else []))
            return 0
        print("[err] 目录下既没有 maps/ 也没有 images/")
        return 2

    if target.suffix.lower() == ".json":
        return run("inspect_map.py", [str(target)] + (
            ["--out", args.out] if args.out else []) + (["--scale", str(args.scale)] if args.scale != 1 else []))

    if target.suffix.lower() == ".png":
        rc = run("inspect_tileset.py", [str(target)] + (["--out", args.out] if args.out else []))
        # also run a candidate search on the same atlas
        fargs = ["--sheet", args.sheet]
        if args.category:
            fargs += ["--category", args.category]
        if args.ids:
            fargs += ["--ids", args.ids]
        if args.grey:
            fargs.append("--grey")
        if args.dark:
            fargs.append("--dark")
        if args.warm:
            fargs.append("--warm")
        if args.min_uniform:
            fargs += ["--min-uniform", str(args.min_uniform)]
        if args.min_luma:
            fargs += ["--min-luma", str(args.min_luma)]
        if args.max_luma != 255:
            fargs += ["--max-luma", str(args.max_luma)]
        if args.max_sat != 1.0:
            fargs += ["--max-sat", str(args.max_sat)]
        if args.color:
            fargs += ["--color", args.color]
        if args.out:
            fargs += ["--out", args.out]
        run("find_tiles.py", [str(target)] + fargs)
        return rc

    print(f"[err] 不支持的路径类型: {target}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())