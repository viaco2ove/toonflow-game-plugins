#!/usr/bin/env python3
"""apply_map.py — 按映射表安全落地地图 JSON（备份→改 data→校验→写盘/POST 后端）。

映射 JSON 格式:
{
  "layers": {
    "0": { "7865": [12901, 12910], "9298": 12911 },
    "1": { "7356": [12913, 12914, 0, 0], "1243": 12903 }
  },
  "clear": { "1": [1483, 1485, 1487] }
}
  layers: 层索引(0-based) → 旧 gid → 新 gid，或变体列表（按 (x+y)%len 轮换；
          列表里放 0 表示该格清空，可用于稀疏化植被）
  clear : 层索引 → 要清 0 的 gid 列表

用法:
  # 直接写 raw 文件（本地）
  python apply_map.py --mapset <目录> --map <slug>.json --mapping m.json --via file
  # 走后端保存接口（编辑器在线，自动备份）
  python apply_map.py --mapset <目录> --map <slug>.json --mapping m.json \
      --via api --collection "<地图集名>"
"""
import argparse, json, os, shutil, sys, time, urllib.request, pathlib


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mapset", required=True)
    ap.add_argument("--map", required=True)
    ap.add_argument("--mapping", required=True)
    ap.add_argument("--via", choices=["file", "api"], default="file")
    ap.add_argument("--collection", default=None)
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    args = ap.parse_args()

    ms = pathlib.Path(args.mapset)
    mp = ms / "maps" / args.map
    body = json.loads(mp.read_text(encoding="utf-8-sig"))
    plan = json.loads(pathlib.Path(args.mapping).read_text(encoding="utf-8"))

    meta = json.loads((ms / "images/compiled_tileset_32x32.json").read_text(encoding="utf-8"))
    tilecount = int(meta.get("tilecount", 13080))

    tl = [l for l in body["layers"] if l["type"] == "tilelayer"]
    actors_before = sum(len(l.get("objects", [])) for l in body["layers"] if l["type"] == "objectgroup")
    zones_before = len(body.get("eventZones", []) or [])
    lens_before = [len(l["data"]) for l in tl]

    layers_map = {}
    for k, v in plan.get("layers", {}).items():
        rule = {}
        for a, b in v.items():
            if isinstance(b, list):
                rule[int(a)] = [int(x) for x in b]   # 变体列表，按坐标轮换
            else:
                rule[int(a)] = int(b)
        layers_map[int(k)] = rule
    clear_map = {int(k): set(v) for k, v in plan.get("clear", {}).items()}

    changed = 0
    for li, layer in enumerate(tl):
        mp_layer = layers_map.get(li, {})
        clr = clear_map.get(li, set())
        w = int(layer.get("width", body.get("width", 0)))
        for i, g in enumerate(layer["data"]):
            if g in mp_layer:
                tgt = mp_layer[g]
                if isinstance(tgt, list):
                    x, y = i % w, i // w
                    tgt = tgt[(x + y) % len(tgt)]
                layer["data"][i] = tgt
                changed += 1
            elif g in clr:
                layer["data"][i] = 0
                changed += 1

    # ---- 校验 ----
    assert [len(l["data"]) for l in tl] == lens_before, "层长度被改变"
    actors_after = sum(len(l.get("objects", [])) for l in body["layers"] if l["type"] == "objectgroup")
    zones_after = len(body.get("eventZones", []) or [])
    assert actors_after == actors_before, f"Actors 数量变化 {actors_before}→{actors_after}"
    assert zones_after == zones_before, f"事件区数量变化 {zones_before}→{zones_after}"
    for layer in tl:
        for g in layer["data"]:
            if g and g >= tilecount:
                raise SystemExit(f"越界 gid {g} >= tilecount {tilecount}")

    print(f"[ok] 映射改动 {changed} 格；Actors {actors_after}；事件区 {zones_after}")

    if args.via == "api":
        if not args.collection:
            raise SystemExit("--via api 需要 --collection")
        from urllib.parse import quote
        url = f"{args.api}/api/collections/{quote(args.collection)}/maps/{mp.stem}"
        req = urllib.request.Request(
            url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[ok] 后端保存: {resp.status} {resp.read().decode('utf-8')}")
    else:
        bak = ms / "maps" / "bak"
        bak.mkdir(exist_ok=True)
        stamp = time.strftime("%Y%m%d%H%M%S")
        shutil.copy2(mp, bak / f"{mp.stem}.pre-apply-{stamp}.json")
        tmp = mp.with_name(mp.stem + ".tmp.json")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(body, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, mp)
        print(f"[ok] 已写回 {mp}（备份 {bak.name}/{mp.stem}.pre-apply-{stamp}.json）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
