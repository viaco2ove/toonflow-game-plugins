#!/usr/bin/env python3
"""plan_from_prototype.py — 读地图现状 gid 用量 + 原型要素清单，输出 R/C/M 规划表。

只做机械匹配与粗分类；候选 gid 必须开联系表目视确认后再落地。

用法:
  python plan_from_prototype.py --mapset <目录> --map <slug>.json \
      [--elements elements.json] [--out plan.md]
"""
import argparse, json, pathlib
from collections import Counter
from PIL import Image


def coarse_tag(rgb):
    if rgb is None:
        return "empty"
    r, g, b = rgb
    mx, mn = max(rgb), min(rgb)
    sat = 0 if mx == 0 else (mx - mn) / mx
    if g > r + 12 and g > b + 12:
        return "植物/绿"
    if b > r + 12 and b > g + 4:
        return "水面/蓝"
    if r > b + 18:
        return "木/土/砖(暖)"
    if sat < 0.18:
        return "石/灰"
    return "其他"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mapset", required=True)
    ap.add_argument("--map", required=True)
    ap.add_argument("--elements", default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    ms = pathlib.Path(args.mapset)
    mp = ms / "maps" / args.map
    data = json.loads(mp.read_text(encoding="utf-8-sig"))
    atlas = Image.open(ms / "images/compiled_tileset_32x32.png").convert("RGBA")
    meta = json.loads((ms / "images/compiled_tileset_32x32.json").read_text(encoding="utf-8"))
    cols = int(meta.get("columns", 120))
    tilecount = int(meta.get("tilecount", 13080))

    def avg(g):
        idx = g - 1
        x, y = (idx % cols) * 32, (idx // cols) * 32
        c = atlas.crop((x, y, x + 32, y + 32))
        px = [p for p in c.getdata() if p[3] > 0]
        if not px:
            return None
        return tuple(sum(p[i] for p in px) // len(px) for i in range(3))

    tl = [l for l in data["layers"] if l["type"] == "tilelayer"]
    lines = [f"# 落地规划表 — `{args.map}`（{data['width']}×{data['height']}）", ""]

    # 现状 gid 用量（按层）
    for li, layer in enumerate(tl):
        c = Counter(g for g in layer["data"] if g)
        lines.append(f"## L{li+1} `{layer.get('name','?')}` 非空 {sum(c.values())} 格 / {len(c)} 种")
        lines.append("")
        lines.append("| gid | 格数 | 平均色 | 粗分类 |")
        lines.append("|---|---|---|---|")
        for g, n in c.most_common():
            a = avg(g)
            lines.append(f"| {g} | {n} | {a} | {coarse_tag(a)} |")
        lines.append("")

    # 要素清单 → 候选（机械匹配 dawnlike 描述）
    dawn = []
    dl = ms / "compiled_dawnlike.json"
    if dl.exists():
        dj = json.loads(dl.read_text(encoding="utf-8"))
        for t in dj.get("tiles", []):
            desc = ""
            for pr in t.get("properties", []):
                if pr.get("name") == "description":
                    desc = str(pr.get("value", "")).lower()
            dawn.append({"id": t.get("id"), "desc": desc})

    if args.elements:
        edoc = json.loads(pathlib.Path(args.elements).read_text(encoding="utf-8"))
        for m in edoc.get("maps", []):
            if m.get("file") != args.map:
                continue
            lines.append(f"## 原型要素判定（{args.map}）")
            lines.append("")
            lines.append("| 要素 | 类别 | 区域 | 候选 gid(待目视) | 状态 | 备注 |")
            lines.append("|---|---|---|---|---|---|")
            for el in m.get("elements", []):
                kws = [k.lower() for k in el.get("keywords", []) if k]
                hits = []
                for t in dawn:
                    if any(k in t["desc"] for k in kws):
                        hits.append(t["id"] + 1)
                    if len(hits) >= 5:
                        break
                cand = ", ".join(str(i) for i in hits) or "无候选 → M 新增"
                status = "R 候选(需目视)" if hits else "M 缺素材"
                lines.append(
                    f"| {el.get('name','')} | {el.get('kind','')} | {el.get('zone','')} | "
                    f"{cand} | {status} | {el.get('note','')} |"
                )
            lines.append("")

    lines.append(f"> 校验上限：tilecount={tilecount}；gid=index+1。候选 gid 必须开联系表目视确认。")
    report = "\n".join(lines)
    if args.out:
        out = pathlib.Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(report, encoding="utf-8")
        print(f"[ok] {out}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
