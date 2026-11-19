#!/usr/bin/env python3
"""gap_report.py — 原型要素缺口分级报告（确定性骨架，视觉判断由人看图确认）。

读取地图集现状（maps/*.json、entity_types.json、compiled_dawnlike.json、
compiled_tileset_32x32.json），对照原型要素清单 JSON，输出 Markdown 分级报告：

  - R  现成：实体已定义 / 图集有候选图块（候选仍需开拼图目视确认）
  - C  可换色：形状可复用、配色不符（人工判定，脚本仅标注待评估）
  - M  缺 tile：图集描述里查不到候选形状
  - E  缺实体：Actors 引用或原型要素在 entity_types.json 查不到

用法：
  python gap_report.py --mapset <地图集目录> [--elements <要素清单.json>] [--out <report.md>]

要素清单格式见 references/gap-analysis.md。不给 --elements 时只出现状核对与实体交叉检查。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ENTITY_ARRAYS = ("enemies", "special_enemies", "non_hostile_entity_types",
                 "corpse_entity_types", "item_types")


def load_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8-sig"))


def collect_entities(et: dict | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not et:
        return out
    for arr in ENTITY_ARRAYS:
        for row in et.get(arr, []) or []:
            if isinstance(row, str):
                etype = row.strip()
                out[etype] = {"name": "", "name_zh": "", "camp": "", "textures": [], "array": arr}
                continue
            etype = str(row.get("entity_type") or row.get("name") or "").strip()
            if not etype:
                continue
            out[etype] = {
                "name": row.get("name", ""),
                "name_zh": row.get("name_zh") or row.get("description_zh", ""),
                "camp": row.get("camp", ""),
                "textures": row.get("textures", []),
                "array": arr,
            }
    # npc_dialogs 是 {entity_type: 中文名} 的 dict，通用 NPC 的显示名挂在这里
    nd = et.get("npc_dialogs") or {}
    if isinstance(nd, dict):
        for k, v in nd.items():
            out[str(k).strip()] = {
                "name": "",
                "name_zh": str(v).strip() if isinstance(v, str) else "",
                "camp": "npc",
                "textures": [],
                "array": "npc_dialogs",
            }
    return out


def load_dawnlike(dawn: dict | None) -> list[dict]:
    tiles: list[dict] = []
    if not dawn:
        return tiles
    for t in dawn.get("tiles", []):
        desc = ""
        blocked = False
        for pr in t.get("properties", []):
            if pr.get("name") == "description":
                desc = str(pr.get("value", "")).lower()
            elif pr.get("name") == "blocked":
                blocked = bool(pr.get("value"))
        tiles.append({"id": t.get("id"), "desc": desc, "blocked": blocked})
    return tiles


def coerce_gid(g) -> int:
    """地图 data 偶发混入字符串/空值，统一折算成 int；无法解析返回 0（空）。"""
    if g is None:
        return 0
    try:
        return int(g)
    except (TypeError, ValueError):
        return 0


def analyze_map(map_path: Path) -> dict:
    data = load_json(map_path)
    info: dict = {"file": map_path.name, "width": 0, "height": 0, "layers": [],
                  "zones": [], "actors": [], "gids": Counter(), "ok": False}
    if not data:
        return info
    info["width"], info["height"] = data.get("width", 0), data.get("height", 0)
    for layer in data.get("layers", []):
        if layer.get("type") == "tilelayer":
            info["layers"].append(layer.get("name", "?"))
            for raw in layer.get("data", []):
                g = coerce_gid(raw)
                if g:
                    info["gids"][g & 0x1FFFFFFF] += 1
        elif layer.get("type") == "objectgroup":
            for obj in layer.get("objects", []):
                props = {p.get("name"): p.get("value") for p in obj.get("properties", [])}
                info["actors"].append({
                    "id": obj.get("id"),
                    "entity_type": props.get("entity_type") or "",
                    "name": props.get("name") or obj.get("name") or "",
                    "full_name": props.get("full_name") or "",
                    "uid": props.get("uid"),
                    "x": obj.get("x"),
                    "y": obj.get("y"),
                    "gid": obj.get("gid"),
                })
    for z in data.get("eventZones", []) or []:
        info["zones"].append({"name": z.get("name", ""), "x": z.get("x"), "y": z.get("y")})
    info["ok"] = True
    return info


def match_entity(entities: dict, element: dict) -> tuple[str | None, dict | None]:
    eid = str(element.get("entity") or "").strip()
    if eid and eid in entities:
        return eid, entities[eid]
    needle = str(element.get("name", "")).strip().lower()
    if not needle:
        return None, None
    for etype, row in entities.items():
        hay = " ".join([etype, str(row["name"]), str(row["name_zh"])]).lower()
        if needle in hay:
            return etype, row
    return None, None


def match_local_actor(actors: list[dict], element: dict) -> dict | None:
    """在本图 Actors 里按显示名模糊命中（复用通用 NPC 类型、无独立实体定义的角色）。"""
    needle = str(element.get("name", "")).strip().lower()
    if not needle:
        return None
    for ac in actors:
        hay = f"{ac['entity_type']} {ac['name']} {ac['full_name']}".lower()
        if needle in hay:
            return ac
    return None


def match_tiles(dawn: list[dict], element: dict, limit: int = 5) -> list[int]:
    kws = [str(k).lower() for k in element.get("keywords", []) if str(k).strip()]
    if not kws:
        return []
    hits: list[int] = []
    for t in dawn:
        if any(k in t["desc"] for k in kws):
            hits.append(t["id"])
        if len(hits) >= limit:
            break
    return hits


def status_for(kind: str, entity_hit, tile_hits, zone_hit) -> str:
    if kind == "actor":
        return "R 现成实体" if entity_hit else "E 缺实体定义"
    if kind == "trigger":
        return "R 事件区已存在" if zone_hit else "M 缺事件区/入口"
    return "R 候选图块（需目视确认）" if tile_hits else "M 缺 tile"


def actor_resolved(entities: dict, actors: list[dict], element: dict) -> str:
    """返回 actor 解析级别：entity / local / none。"""
    _, row = match_entity(entities, element)
    if row is not None:
        return "entity"
    if match_local_actor(actors, element) is not None:
        return "local"
    return "none"


def main() -> int:
    ap = argparse.ArgumentParser(description="原型要素缺口分级报告")
    ap.add_argument("--mapset", required=True, help="地图集目录")
    ap.add_argument("--elements", help="原型要素清单 JSON")
    ap.add_argument("--out", help="输出 Markdown 路径（默认 stdout）")
    args = ap.parse_args()

    mapset = Path(args.mapset).resolve()
    entities = collect_entities(load_json(mapset / "entity_types.json"))
    dawn = load_dawnlike(load_json(mapset / "compiled_dawnlike.json"))
    tileset_meta = load_json(mapset / "images" / "compiled_tileset_32x32.json")
    tilecount = (tileset_meta or {}).get("tilecount", "?")

    maps_dir = mapset / "maps"
    maps = sorted(maps_dir.glob("*.json")) if maps_dir.exists() else []
    analyses = [analyze_map(p) for p in maps]
    by_file = {a["file"]: a for a in analyses}

    elements_doc = load_json(Path(args.elements)) if args.elements else None

    lines: list[str] = []
    push = lines.append
    push(f"# 缺口分级报告 — `{mapset.name}`")
    push("")
    push(f"- 图集 tilecount：`{tilecount}`；实体类型：{len(entities)}；图集描述条目：{len(dawn)}")
    push("- 状态口径：R 现成 / C 可换色（人工评估）/ M 缺 tile / E 缺实体。候选 gid 必须开拼图目视确认后再落子。")
    push("")

    # 现状概览 + 实体交叉检查
    push("## 1. 现状概览")
    for a in analyses:
        push(f"### `{a['file']}`（{a['width']}×{a['height']}）")
        push(f"- 图层：{', '.join(a['layers']) or '无 tilelayer'}；事件区 {len(a['zones'])} 个；Actors {len(a['actors'])} 个")
        if a["zones"]:
            push("- 事件区：" + "、".join(f"{z['name']}({z['x']},{z['y']})" for z in a["zones"]))
        missing = []
        for ac in a["actors"]:
            if ac["entity_type"] and ac["entity_type"] not in entities:
                missing.append(f"{ac['entity_type']}（{ac['full_name'] or ac['name']}）")
        if missing:
            push("- ⚠️ Actors 引用了实体表未定义的类型：" + "、".join(missing))
        top = ", ".join(f"gid {g}×{n}" for g, n in a["gids"].most_common(8))
        push(f"- 用量 Top gid：{top or '—'}")
        push("")

    # 原型要素分级
    push("## 2. 原型要素分级")
    if not elements_doc:
        push("（未提供要素清单 `--elements`；仅完成现状核对。清单格式见 references/gap-analysis.md。）")
    else:
        for m in elements_doc.get("maps", []):
            fname = m.get("file", "")
            a = by_file.get(fname)
            push(f"### `{fname}`")
            if not a:
                push("- ⚠️ 地图文件不在地图集 maps/ 目录。")
                push("")
                continue
            zone_names = {z["name"] for z in a["zones"]}
            push("")
            push("| 要素 | 类别 | 匹配结果 | 状态 | 备注 |")
            push("|---|---|---|---|---|")
            for el in m.get("elements", []):
                kind = el.get("kind", "prop")
                name = el.get("name", "")
                if kind == "actor":
                    etype, row = match_entity(entities, el)
                    level = actor_resolved(entities, a["actors"], el)
                    if level == "entity":
                        match = f"{etype} / {row['name_zh']}"
                        status = "R 现成实体"
                        note = ""
                    elif level == "local":
                        local = match_local_actor(a["actors"], el)
                        match = f"图上已有：{local['full_name'] or local['name']}（{local['entity_type']}）"
                        status = "R 已在图上（复用通用类型）"
                        note = "无独立实体定义；复用通用 NPC，改造型时再评估是否补定义"
                    else:
                        match = "实体表与本图 Actors 均未命中"
                        status = "E 缺实体定义"
                        note = "需先补 entity_types/npc_dialogs 定义再放 Actors"
                elif kind == "trigger":
                    zone = str(el.get("zone") or name)
                    hit = zone in zone_names
                    match = f"事件区「{zone}」" if hit else f"未找到「{zone}」"
                    status = status_for(kind, False, [], hit)
                    note = "" if hit else "需在地图补 eventZone 或门对象"
                else:
                    hits = match_tiles(dawn, el)
                    match = "候选 id：" + ", ".join(str(i + 1) for i in hits) if hits else "描述无命中"
                    status = status_for(kind, False, hits, False)
                    note = "候选需目视确认；形状不符再判 M 补 tile" if hits else "需程序化补 tile"
                push(f"| {name} | {kind} | {match} | {status} | {note} |")
            push("")

    # 缺口汇总
    push("## 3. 缺口汇总")
    if elements_doc:
        missing_tiles, missing_entities = [], []
        for m in elements_doc.get("maps", []):
            a = by_file.get(m.get("file", ""))
            actors = a["actors"] if a else []
            for el in m.get("elements", []):
                kind = el.get("kind", "prop")
                if kind == "actor":
                    if actor_resolved(entities, actors, el) == "none":
                        missing_entities.append(f"{m['file']}：{el.get('name')}")
                else:
                    hits = match_tiles(dawn, el)
                    if kind != "trigger" and not hits:
                        missing_tiles.append(f"{m['file']}：{el.get('name')}")
        push(f"- **M 缺 tile**（{len(missing_tiles)}）：" + ("、".join(missing_tiles) or "无"))
        push(f"- **E 缺实体**（{len(missing_entities)}）：" + ("、".join(missing_entities) or "无"))
    else:
        push("（提供 --elements 后自动汇总缺口。）")
    push("")
    push("> 注意：gid = tile_index + 1（firstgid=1）；本报告候选 id 已换算为 gid。")

    report = "\n".join(lines)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(report, encoding="utf-8")
        print(f"[ok] 报告已写入 {out}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
