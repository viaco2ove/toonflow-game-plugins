#!/usr/bin/env python3
"""actors.py — 管理地图对象层（Actors）：查看 / 添加 / 移动 / 删除 NPC 与野怪。

活物不在瓦片层，而在 objectgroup 层。加活物的正确姿势：
  1. 坐标是**像素**（cell * 32），不是格子
  2. 瓦片对象必须带 `gid`（图集某格）+ `entity_type` 属性
  3. NPC 复用 uid：同一角色在全地图集唯一且可复用
  4. 野怪必须**三处一致**：entity_types.json 定义 / entity_type 字段 / full_name 头顶名
  5. `entity_types.json` 里没有的类型要先加定义，否则游戏认不出

用法:
  python actors.py <map.json> --list
  python actors.py <map.json> --list-types
  python actors.py <map.json> --add-npc --entity-type HT_FAKE_STUDENT --name 值日生 --at 12,20
  python actors.py <map.json> --add-spawn --entity-type HT_FAKE_ELITE --at 30,44
  python actors.py <map.json> --move <id> --at 20,20
  python actors.py <map.json> --remove <id>
  python actors.py <map.json> --sprite <id> --gid 4341      # 换造型（换图集格）
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "cognitive-tiles-maps" / "scripts"))
from tilemap import MapFile  # noqa: E402

TILE = 32


def load_entity_types(mapset: Path) -> dict:
    p = mapset / "entity_types.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def find_type_index(et: dict, entity_type: str) -> int | None:
    """entity_type in enemies[] -> index, or None."""
    for i, e in enumerate(et.get("enemies", [])):
        if e.get("entity_type") == entity_type:
            return i
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("map_json")
    ap.add_argument("--list", action="store_true", help="列出全部对象")
    ap.add_argument("--list-types", action="store_true", help="列出 entity_types.json 里可用类型")
    ap.add_argument("--add-npc", action="store_true")
    ap.add_argument("--add-spawn", action="store_true")
    ap.add_argument("--entity-type", default=None)
    ap.add_argument("--name", default="NPC")
    ap.add_argument("--full-name", default=None, help="头顶显示名（默认同 name）")
    ap.add_argument("--at", default=None, help="格子坐标 x,y（如 12,20）")
    ap.add_argument("--gid", type=int, default=None, help="图集格 gid（精灵造型）")
    ap.add_argument("--uid", type=int, default=None, help="NPC uid（复用已有角色时给）")
    ap.add_argument("--move", type=int, default=None, help="移动指定 id 的对象")
    ap.add_argument("--remove", type=int, default=None)
    ap.add_argument("--sprite", type=int, default=None, help="给指定 id 换造型（gid）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    map_path = Path(args.map_json)
    mf = MapFile.load(map_path)
    mapset = map_path.resolve().parent.parent
    et = load_entity_types(mapset)
    actors = mf.objects()

    # ---- 查 ------------------------------------------------------------- #
    if args.list or not (args.add_npc or args.add_spawn or args.move
                          or args.remove or args.sprite or args.list_types):
        print(f"# {mf.name} 对象层（{len(actors)} 个）")
        print(f"{'id':>5} {'uid':>5}  {'cell':>8}  {'entity':<28} {'gid':>6}  name")
        for a in actors:
            cx, cy = int(a["x"] // TILE), int(a["y"] // TILE)
            uid = a["props"].get("uid", "-")
            print(f"{a['id']:>5} {str(uid):>5}  ({cx:>3},{cy:>3})  "
                  f"{(a['entity_type'] or a['type'] or '-'):<28} {str(a['gid'] or '-'):>6}  {a['name']}")
        return 0

    if args.list_types:
        print(f"# entity_types.json（{mapset}）")
        for i, e in enumerate(et.get("enemies", [])):
            tex = [str(t) for t in (e.get("textures") or [])]
            print(f"[{i}] {e.get('entity_type')}  full_name={e.get('full_name', '')}  "
                  f"textures={tex[:4]}{'...' if len(tex) > 4 else ''}")
        print(f"共 {len(et.get('enemies', []))} 个类型")
        return 0

    # ---- 定位对象层（raw 里的 objectgroup）----------------------------- #
    obj_layers = [l for l in mf.raw.get("layers", []) if l.get("type") == "objectgroup"]
    if not obj_layers:
        print("[err] 没有 objectgroup 层")
        return 1
    layer = obj_layers[0]
    objs = layer.setdefault("objects", [])
    next_id = mf.raw.get("nextobjectid", max([o.get("id", 0) for o in objs], default=0) + 1)

    # ---- 增 ------------------------------------------------------------- #
    if args.add_npc or args.add_spawn:
        if not args.at:
            print("[err] 需要 --at x,y（格子坐标）")
            return 1
        cx, cy = [int(v) for v in args.at.split(",")]
        if not (0 <= cx < mf.width and 0 <= cy < mf.height):
            print(f"[err] 坐标越界: ({cx},{cy}) 不在 {mf.width}x{mf.height} 内")
            return 1

        et_key = args.entity_type
        if et_key and find_type_index(et, et_key) is None:
            print(f"[warn] entity_types.json 里没有 {et_key}，可用的见 --list-types")
            print("       （仍会写入对象，但游戏可能认不出这个类型）")

        gid = args.gid
        if gid is None:
            # 用 entity_types 里该类型的首帧
            idx = find_type_index(et, et_key) if et_key else None
            if idx is not None and et["enemies"][idx].get("textures"):
                gid = et["enemies"][idx]["textures"][0]
                print(f"[info] 未指定 --gid，取 {et_key} 的首帧: {gid}")
            else:
                print("[err] 未指定 --gid，且类型无 textures 可用")
                return 1

        full_name = args.full_name or args.name
        obj = {
            "id": next_id,
            "name": args.name,
            "gid": gid,
            "height": TILE,
            "width": TILE,
            "type": "",
            "rotation": 0,
            "visible": True,
            "x": cx * TILE,
            "y": cy * TILE,
            "properties": [
                {"name": "entity_type", "type": "string", "value": et_key or ""},
                {"name": "full_name", "type": "string", "value": full_name},
            ],
        }
        if args.uid:
            obj["properties"].append({"name": "uid", "type": "int", "value": args.uid})
        if args.add_spawn:
            obj["properties"].append({"name": "spawn", "type": "bool", "value": True})
        print(f"[info] 新增对象 id={next_id} `{args.name}` @({cx},{cy}) "
              f"gid={gid} entity={et_key} full_name={full_name}")
        if args.dry_run:
            return 0
        objs.append(obj)
        mf.raw["nextobjectid"] = next_id + 1

    # ---- 改 ------------------------------------------------------------- #
    if args.move is not None or args.remove is not None or args.sprite is not None:
        target_id = args.move if args.move is not None else (
            args.remove if args.remove is not None else args.sprite)
        hit = next((o for o in objs if o.get("id") == target_id), None)
        if hit is None:
            print(f"[err] 找不到 id={target_id}")
            return 1

        if args.move is not None:
            if not args.at:
                print("[err] 需要 --at x,y")
                return 1
            cx, cy = [int(v) for v in args.at.split(",")]
            print(f"[info] 移动 id={target_id}: ({hit['x']//TILE},{hit['y']//TILE}) -> ({cx},{cy})")
            if args.dry_run:
                return 0
            hit["x"] = cx * TILE
            hit["y"] = cy * TILE

        elif args.remove is not None:
            print(f"[info] 删除 id={target_id} `{hit.get('name')}`")
            if args.dry_run:
                return 0
            objs.remove(hit)

        elif args.sprite is not None:
            if args.gid is None:
                print("[err] 需要 --gid")
                return 1
            print(f"[info] 换造型 id={target_id}: gid {hit.get('gid')} -> {args.gid}")
            if args.dry_run:
                return 0
            hit["gid"] = args.gid

    # ---- 写回 ----------------------------------------------------------- #
    bak = map_path.with_suffix(f".json.bak-{time.strftime('%Y%m%d%H%M%S')}")
    shutil.copy2(map_path, bak)
    map_path.write_text(json.dumps(mf.raw, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] 备份 {bak.name}")
    print(f"[ok] 已写入 {map_path}（对象数 {len(objs)}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
