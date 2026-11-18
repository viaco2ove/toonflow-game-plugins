#!/usr/bin/env python3
"""
一次性给三个仓库升 patch 版本号（+0.0.01）：

  后端 toonflow-game-app/package.json
  前端 Toonflow-game-web/package.json
  插件 toonflow-game-plugins/plugins/toonflow-field-survival/manifest.json

规则：
  · patch 位 +1，其余位不动（1.0.31 → 1.0.32）
  · 只认 x.y.z 三段式；不认的（如 "1.0" / "1.0.0-beta"）一律跳过并报错，不猜
  · 只改 version 字段本身，不动文件其它内容与缩进
  · --dry-run 只报告不改
  · --set 指定目标版本（如 2.0.0），则三个仓库统一设为该版本
  · 缺省自动定位仓库根：脚本所在目录向上三级 = toonflow-game-plugins，
    其父目录 = Toonflow-game/（三个仓库的公共父目录）

用法：
  python bump_version.py [--dry-run] [--set X.Y.Z] [--root <Toonflow-game 目录>]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

# ── 三个版本位（相对 Toonflow-game 根目录）──────────────────────────────────
TARGETS = [
    ("后端", os.path.join("toonflow-game-app", "package.json")),
    ("前端", os.path.join("Toonflow-game-web", "package.json")),
    ("插件", os.path.join("toonflow-game-plugins", "plugins",
                          "toonflow-field-survival", "manifest.json")),
]

SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def find_root(explicit: str | None) -> str:
    if explicit:
        return os.path.abspath(explicit)
    # 脚本在 <plugins>/.zcode/skills/increase-version-all/scripts/ → 上溯 4 级到 plugins，
    # 再上一级到 Toonflow-game 根。
    here = os.path.abspath(os.path.dirname(__file__))
    plugins_root = os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
    root = os.path.dirname(plugins_root)
    if os.path.isdir(os.path.join(root, "toonflow-game-app")):
        return root
    # 兜底：插件仓库的父目录
    return os.path.dirname(plugins_root)


def read_version(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return str(data.get("version", ""))


def write_version(path: str, new_ver: str) -> None:
    """原地替换 version 字段，保留其余内容与缩进风格。"""
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    # 只替换顶层的 "version": "..."（第一个匹配即可——package.json 的 version 恒在顶层，
    # 依赖树里的 "version" 在更深的缩进层级）
    pattern = re.compile(r'("version"\s*:\s*")([^"]*)(")')
    m = pattern.search(text)
    if not m:
        raise RuntimeError(f"{path}: 找不到 version 字段")
    text = text[: m.start()] + m.group(1) + new_ver + m.group(3) + text[m.end():]
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def bump_patch(cur: str) -> str:
    m = SEMVER.match(cur.strip())
    if not m:
        raise RuntimeError(f"版本号不是 x.y.z 三段式，无法自动升 patch：{cur!r}")
    major, minor, patch = (int(x) for x in m.groups())
    return f"{major}.{minor}.{patch + 1}"


def main() -> int:
    ap = argparse.ArgumentParser(description="给后端/前端/插件三个仓库升 patch 版本号")
    ap.add_argument("--root", help="Toonflow-game 根目录（默认自动定位）")
    ap.add_argument("--dry-run", action="store_true", help="只报告，不写文件")
    ap.add_argument("--set", dest="fixed", help="三个仓库统一设为该版本（如 2.0.0）")
    args = ap.parse_args()

    root = find_root(args.root)
    print(f"仓库根: {root}")

    if args.fixed:
        if not SEMVER.match(args.fixed.strip()):
            print(f"[FAIL] --set 版本号必须是 x.y.z 三段式：{args.fixed!r}")
            return 1
        target_ver = args.fixed.strip()
    else:
        target_ver = None  # 各仓库各自 +1

    changes = []
    errors = []

    for label, rel in TARGETS:
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            errors.append(f"[MISS] {label}: {path} 不存在")
            continue
        try:
            cur = read_version(path)
            new = target_ver if target_ver else bump_patch(cur)
        except Exception as e:  # noqa: BLE001
            errors.append(f"[FAIL] {label}: {e}")
            continue
        if new == cur:
            print(f"[SKIP] {label}: 已是 {cur}")
            continue
        changes.append((label, rel, path, cur, new))

    if errors:
        for e in errors:
            print(e)

    if not changes:
        print("没有需要变更的版本号。")
        return 1 if errors else 0

    print()
    for label, rel, _path, cur, new in changes:
        print(f"[{'DRY' if args.dry_run else 'BUMP'}] {label:4s} {rel}")
        print(f"        {cur}  ->  {new}")

    if args.dry_run:
        print("\n(--dry-run：未写入)")
        return 0

    for label, _rel, path, _cur, new in changes:
        try:
            write_version(path, new)
            # 回读校验
            got = read_version(path)
            if got != new:
                raise RuntimeError(f"回读不一致：期望 {new}，实际 {got}")
            print(f"[OK] {label} 已改为 {new}")
        except Exception as e:  # noqa: BLE001
            print(f"[FAIL] {label}: {e}")
            return 1

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
