"""
扩充每个地图集的 data.xlsx，使其成为完整资源注册表
====================================================

现有 sheet：
  Enemies         - 怪物属性表（22 种）
  Wall Textures   - 墙族（每行一族，列 = 变体 gid）
  Floor Textures  - 地板族（每行一族，列 = 变体 gid）

本脚本补充：
  Decor Textures  - 装饰族：compiled_dawnlike.json 里按 description 分组的全部
                    装饰瓦片（树/枯树/水/墓碑/火把/栅栏…）。
                    地图实际使用但无 description 的瓦片（树冠等）按「tileset 中
                    正下方/正上方相邻瓦片的 description」归入对应族；
                    无法归族的进「未登记杂项」。
  Extra Tiles     - 未登记杂项（无描述且无法归族的已用瓦片）。

  Enemies 缺失行补齐：LOOT_GOBLIN / ORC_BOSS / WOLF / BOAR（与插件
  MOB_ARCHETYPES 同口径）。

注意：Excel 里存的是 tileId（图像索引，与渲染 tileId 一致；不是 Tiled gid）。
验证：Floor STONE left=7856 ↔ desc(7856)='stone floor'；Wall LIGHT_STONE upperLeft=7397
↔ desc(7397)='stone wall'，均直接命中。

用法：
  python expand_data_xlsx.py            # 处理全部地图集
  python expand_data_xlsx.py 通天传授-收徒系统   # 只处理指定地图集
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl
from openpyxl.styles import Font, PatternFill

MAP_ROOT = Path(
    "D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/"
    "workshops/toonflow-field-survival/map_design"
)

# description → 中文名（调色板显示用）
DESC_ZH = {
    "stone floor": "石地板", "dirt": "泥土", "wooden floor": "木地板",
    "grass": "草地", "carpet": "地毯", "cobble stone floor": "鹅卵石地板",
    "wild grass": "野草", "sand": "沙地", "snow": "雪地",
    "stone wall": "石墙", "wooden wall": "木墙", "mine wall": "矿墙",
    "dirt wall": "土墙", "mossy stone wall": "苔石墙", "rock wall": "岩墙",
    "water": "水面", "sea water": "海水", "shallow water": "浅水",
    "sign": "招牌", "bones": "骨头", "grave": "墓碑",
    "tree": "树", "dead tree": "枯树", "flowers": "花丛",
    "bookcase": "书架", "torch": "火把", "pot": "陶罐",
    "bar": "栏杆", "coffin": "棺材", "cobwebs": "蛛网",
    "chair": "椅子", "barrel": "木桶", "table": "桌子",
    "bed": "床", "crate": "木箱", "sleeping bag": "睡袋",
    "shrub": "灌木", "pedestal": "基座", "bloody pedestal": "血染基座",
    "cabbage": "白菜", "mushroom": "蘑菇", "throne": "王座",
    "logs": "原木", "fountain": "喷泉", "weird sharp object": "锐器",
    "flail": "连枷", "whip": "鞭子", "armor": "盔甲", "fence": "栅栏",
}

# Enemies 表补充行（与插件 vue/src/mapConfig.ts MOB_ARCHETYPES 同口径）
ENEMY_ADDITIONS = {
    "LOOT_GOBLIN": ("loot goblin", "A goblin that scavenges for treasure.", 40, 5, 8, 2, 7, 0.2),
    "ORC_BOSS":    ("orc boss",    "The chief of the orc warband.", 200, 5, 18, 4, 7, 0.1),
    "WOLF":        ("wolf",        "A pack hunter with keen senses.", 60, 5, 10, 2, 7, 0.6),
    "BOAR":        ("boar",        "A tusked beast that charges.", 50, 5, 8, 3, 7, 0.0),
}

# 「已在地图中使用」优先展示的族（其余按字母序排后面）
PRIORITY_DESCS = [
    "tree", "dead tree", "water", "grave", "sign", "torch", "flowers",
    "fence", "bookcase", "bones", "carpet", "pot", "bar", "coffin",
    "cobwebs", "chair", "barrel", "table", "bed", "crate", "sleeping bag",
]


def load_tileset(coll_dir: Path):
    """compiled_dawnlike.json → {tileId: {desc, blocked, ...}}"""
    src = coll_dir / "compiled_dawnlike.json"
    if not src.exists():
        return {}
    raw = json.loads(src.read_text(encoding="utf-8"))
    out = {}
    for t in raw.get("tiles", []):
        tid = t.get("id")
        if tid is None:
            continue
        props = {p["name"]: p.get("value") for p in t.get("properties", [])}
        out[tid] = props
    return out


def load_covered_gids(coll_dir: Path):
    """现有 Wall/Floor sheet 已登记的 tileId 集合（表内数值即 tileId）"""
    wb = openpyxl.load_workbook(coll_dir / "data.xlsx", read_only=True, data_only=True)
    covered = set()
    for name in ("Wall Textures", "Floor Textures"):
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        hdr = [str(c) if c else "" for c in rows[0]]
        tilecols = [i for i, h in enumerate(hdr) if h not in ("id", "name", "description") and i >= 2]
        for r in rows[1:]:
            # id 列是公式（保存后 data_only 读回是 None），按数值列有无 int 判断行有效
            vals = [int(r[i]) for i in tilecols if isinstance(r[i], (int, float))]
            covered.update(vals)
    wb.close()
    return covered


def load_used_tile_ids(coll_dir: Path):
    """maps/ 里实际用到的 tileId 集合（去翻转标志位）"""
    maps_dir = coll_dir / "maps"
    used = set()
    if not maps_dir.is_dir():
        return used
    for f in maps_dir.iterdir():
        if not f.is_file() or f.suffix != ".json":
            continue
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue

        def scan(layer):
            if layer.get("type") == "tilelayer":
                for v in layer.get("data") or []:
                    if isinstance(v, int) and v:
                        used.add((v & 0xFFFFFFFE) - 1)
            elif layer.get("type") == "group":
                for sub in layer.get("layers") or []:
                    scan(sub)

        for l in j.get("layers", []):
            scan(l)
    return used


def build_decor_groups(tiles: dict, covered: set, used: set):
    """→ {family_id: {"name": str, "zh": str, "tiles": set(tileId), "used": int}}"""
    groups = {}

    def add(fam_id, name, zh, tid):
        g = groups.setdefault(fam_id, {"name": name, "zh": zh, "tiles": set(), "used": 0})
        g["tiles"].add(tid)
        if tid in used:
            g["used"] += 1

    # 1) 有 description 的瓦片：未被 Wall/Floor 覆盖的全部入族
    for tid, props in tiles.items():
        desc = (props.get("description") or "").strip().lower()
        if not desc or tid in covered:
            continue
        add(desc.upper().replace(" ", "_"), desc, DESC_ZH.get(desc, desc), tid)

    # 2) 无 description 的已用瓦片：按 tileset 中相邻瓦片的 description 归族
    misc = set()
    for tid in sorted(used):
        if tid in tiles and not (tiles[tid].get("description") or "").strip():
            anchor = None
            below = tiles.get(tid + 120)   # tileset 网格正下方（120 列/行）
            above = tiles.get(tid - 120) if tid >= 120 else None
            for nb in (below, above):
                d = ((nb or {}).get("description") or "").strip().lower()
                if d:
                    anchor = d
                    break
            if anchor:
                add(anchor.upper().replace(" ", "_"), anchor,
                    DESC_ZH.get(anchor, anchor) + "(含冠部)", tid)
            else:
                misc.add(tid)
        elif tid not in tiles:
            misc.add(tid)  # compiled_dawnlike 里完全没登记的瓦片

    if misc:
        groups["MISC"] = {"name": "unregistered", "zh": "未登记杂项",
                          "tiles": misc, "used": len(misc & used)}
    return groups


def expand_collection(coll_name: str) -> None:
    coll_dir = MAP_ROOT / coll_name
    xlsx = coll_dir / "data.xlsx"
    if not xlsx.exists():
        print(f"  ! {coll_name}: data.xlsx 不存在，跳过")
        return

    tiles = load_tileset(coll_dir)
    covered = load_covered_gids(coll_dir)
    used = load_used_tile_ids(coll_dir)
    print(f"  · {coll_name}: tileset={len(tiles)} covered={len(covered)} used={len(used)}")

    groups = build_decor_groups(tiles, covered, used)

    wb = openpyxl.load_workbook(xlsx)
    hdr_font = Font(bold=True)
    hdr_fill = PatternFill("solid", fgColor="DDE8F5")

    # ── Enemies 补行 ──
    if "Enemies" in wb.sheetnames:
        ws = wb["Enemies"]
        existing_ids = {ws.cell(row=r, column=1).value for r in range(2, ws.max_row + 1)}
        for eid, (name, desc, hp, mana, s, dfn, rng, morale) in ENEMY_ADDITIONS.items():
            if eid in existing_ids:
                continue
            row = ws.max_row + 1
            vals = [eid, name, desc, hp, mana, s, dfn, rng, morale, True, hp, mana]
            for c, v in enumerate(vals, start=1):
                ws.cell(row=row, column=c, value=v)
            print(f"  + Enemies: {eid}")

    # ── Decor Textures ──
    if "Decor Textures" in wb.sheetnames:
        del wb["Decor Textures"]
    ws = wb.create_sheet("Decor Textures")
    ws.append(["id", "name", "name_zh", "count", "used_in_maps", "tiles"])
    for c in range(1, 7):
        ws.cell(row=1, column=c).font = hdr_font
        ws.cell(row=1, column=c).fill = hdr_fill
    fams = sorted(
        groups.items(),
        key=lambda kv: (
            0 if kv[1]["used"] > 0 else 1,
            PRIORITY_DESCS.index(kv[1]["name"]) if kv[1]["name"] in PRIORITY_DESCS else 99,
            kv[0],
        ),
    )
    for fam_id, g in fams:
        tids = sorted(g["tiles"])  # 表内数值 = tileId
        ws.append([fam_id, g["name"], g["zh"], len(tids), g["used"],
                   ",".join(str(x) for x in tids)])
    print(f"  + Decor Textures: {len(fams)} 族, "
          f"{sum(len(g['tiles']) for g in groups.values())} 瓦片")

    wb.save(xlsx)
    wb.close()


def main():
    targets = sys.argv[1:] or [d.name for d in sorted(MAP_ROOT.iterdir()) if d.is_dir()]
    print(f"map_root = {MAP_ROOT}")
    for name in targets:
        if not (MAP_ROOT / name / "maps").exists():
            continue
        expand_collection(name)
    print("完成")


if __name__ == "__main__":
    main()
