#!/usr/bin/env python3
"""
tile_groups — 以「对象 / 系列」为单位查询与操作图集格子。

图集世界里，一个可换皮的对象由两类数据标识：
  ① 物件/建筑/地形/家具 → compiled_dawnlike.json 的 tiles[].properties.description
     （英文短标签，如 'stone wall' / 'fence' / 'bookcase'）
  ② 角色（怪物/NPC）    → entity_types.json 的 enemies[].textures
     （entity_type 如 ORC / GOBLIN / ZOMBIE）

角色只列出「首帧」贴图，动画第二帧靠 compiled_dawnlike.json 的
animated / animated_id 属性关联 —— 必须一并算出，否则换皮会漏帧。

子命令：
  list                       列出所有对象/系列（含格子数与格子 id）
  find <关键词>              按名称查对象/系列（模糊匹配，中英文均可）
  tiles <名称>               打印某对象的完整格子清单（含动画配对）
  suggest <分类>             推荐「最值得换皮相」的系列
  export <名称> --out <dir>  导出某对象的格子小图（联络图 + 单格 PNG）

所有子命令都支持 --story 指定地图集目录（默认取当前唯一地图集）。
"""
import argparse
import json
import os
import re
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
MAP_ROOT = os.path.join(REPO, "workshops", "toonflow-field-survival", "map_design")

TILE = 32

# ── 中英名称映射（用户用中文提问，图集里是英文标签）────────────
ZH_ALIAS = {
    # 角色
    "半兽人": "orc", "地精": "goblin", "僵尸": "zombie", "骷髅": "skeleton",
    "史莱姆": "", "小恶魔": "imp", "老鼠": "rat", "蝙蝠": "bat", "蛇": "snake",
    "狗头人": "kobold", "狗头": "kobold", "冰元素": "ice elemental", "白骨": "boneman",
    "恶魔": "demon", "鬼魂": "ghost", "幽灵": "ghost", "木乃伊": "mummy",
    "海妖": "siren", "巨魔": "troll", "女妖": "banshee", "魔像": "golem",
    "独眼巨人": "cyclops", "牛魔王": "minotaur", "牛头人": "minotaur", "吸血鬼": "vampire",
    # 建筑 / 地形 / 家具
    "石墙": "stone wall", "木墙": "wooden wall", "土墙": "dirt wall",
    "石地板": "stone floor", "木地板": "wooden floor", "草地": "grass",
    "水": "water", "泥地": "dirt", "树": "tree", "枯树": "dead tree",
    "栅栏": "fence", "地毯": "carpet", "书架": "bookcase", "火把": "torch",
    "招牌": "sign", "墓碑": "grave", "骨头": "bones", "棺材": "coffin",
    "桌": "table", "桌���": "table", "椅": "chair", "椅子": "chair",
    "床": "bed", "木桶": "barrel", "板条箱": "crate", "灌木": "shrub",
    "花": "flowers", "蘑菇": "mushroom", "白菜": "cabbage", "原木": "logs",
    "王座": "throne", "喷泉": "fountain", "基座": "pedestal", "蜘蛛网": "cobwebs",
    "墓穴": "grave", "卵石地板": "cobble stone floor", "苔石墙": "mossy stone wall",
    "矿井墙": "mine wall", "野草": "wild grass", "酒馆": "bar", "陶罐": "pot",
}
# 「建筑」类关键词 → description 片段
ZH_CATEGORY = {
    "建筑": ["wall", "floor", "roof", "house", "window", "door", "fence", "carpet", "bookcase", "bar"],
    "建筑物": ["wall", "floor", "roof", "house", "window", "door", "fence", "carpet", "bookcase", "bar"],
    "地形": ["floor", "grass", "dirt", "water", "ground", "sand", "path"],
    "家具": ["table", "chair", "bed", "barrel", "crate", "throne", "pot", "bookcase", "carpet"],
    "植物": ["tree", "grass", "shrub", "flower", "mushroom", "cabbage", "logs"],
    "装饰": ["torch", "sign", "grave", "bones", "coffin", "pedestal", "fountain", "cobweb", "pot"],
    "墙": ["wall"],
    "地板": ["floor"],
}


# ── 地图集定位 ──────────────────────────────────────────────
def find_story(story=None):
    """定位地图集目录；story 为空时取最近修改过的那一个"""
    if story:
        # 允许直接传路径
        if os.path.isdir(story) and os.path.isfile(os.path.join(story, "compiled_dawnlike.json")):
            return story
        p = os.path.join(MAP_ROOT, story)
        if not os.path.isdir(p):
            raise SystemExit(f"[ERR] 地图集不存在: {p}")
        return p
    if not os.path.isdir(MAP_ROOT):
        raise SystemExit(f"[ERR] 地图集根目录不存在: {MAP_ROOT}")
    cands = []
    for d in os.listdir(MAP_ROOT):
        p = os.path.join(MAP_ROOT, d)
        if not os.path.isdir(p):
            continue
        if not os.path.isfile(os.path.join(p, "compiled_dawnlike.json")):
            continue
        try:
            cands.append((os.path.getmtime(os.path.join(p, "images", "compiled_tileset_32x32.png"))
                          if os.path.isfile(os.path.join(p, "images", "compiled_tileset_32x32.png"))
                          else os.path.getmtime(p), d))
        except OSError:
            pass
    if not cands:
        raise SystemExit(f"[ERR] {MAP_ROOT} 下没有可用地图集")
    cands.sort(reverse=True)
    if len(cands) > 1:
        print(f"[i] 检测到 {len(cands)} 个地图集，默认取最近修改的: {cands[0][1]}"
              f"（其它: {', '.join(c[1] for c in cands[1:])}）", file=sys.stderr)
    return os.path.join(MAP_ROOT, cands[0][1])


# ── 数据加载 ────────────────────────────────────────────────
def _is_cjk(s):
    return any("\u4e00" <= ch <= "\u9fff" for ch in s)


def _match(hay, needle):
    """英文按词边界匹配（'orc' 不命中 'torch'）；中文按子串"""
    if not needle:
        return False
    if _is_cjk(needle):
        return needle in hay
    if needle in hay:
        # 词边界：前后不是字母
        for m in re.finditer(re.escape(needle), hay):
            b = m.start() == 0 or not hay[m.start() - 1].isalpha()
            e = m.end() == len(hay) or not hay[m.end()].isalpha()
            if b and e:
                return True
        return False
    return False


class Atlas:
    def __init__(self, story=None):
        self.dir = find_story(story)
        self.story = os.path.basename(self.dir)
        self.png = os.path.join(self.dir, "images", "compiled_tileset_32x32.png")
        self.js = os.path.join(self.dir, "compiled_dawnlike.json")
        self.ent = os.path.join(self.dir, "entity_types.json")
        with open(self.js, encoding="utf-8") as fp:
            self.meta = json.load(fp)
        self.columns = int(self.meta.get("columns", 120))
        self.tiles = {t["id"]: t for t in self.meta.get("tiles", [])}
        self.entities = []
        if os.path.isfile(self.ent):
            with open(self.ent, encoding="utf-8") as fp:
                self.entities = json.load(fp).get("enemies", [])
        self._groups = None

    # ── 属性读取 ──
    @staticmethod
    def prop(tile_id, name):
        for pr in Atlas.tiles[tile_id].get("properties", []) if False else []:
            pass
        return None

    def get_prop(self, tile_id, name):
        for pr in self.tiles.get(tile_id, {}).get("properties", []):
            if pr.get("name") == name:
                return pr.get("value")
        return None

    # ── 动画关系 ──
    def animated_partner(self, tile_id):
        """返回该格的动画配对格 id（非动画首帧返回 None）"""
        if not self.get_prop(tile_id, "animated"):
            return None
        v = self.get_prop(tile_id, "animated_id")
        return int(v) if isinstance(v, (int, float)) and v > 0 else None

    def animated_family(self, tile_ids):
        """把首帧集合扩展成「首帧 + 动画第二帧」的完整集合"""
        out = set()
        for tid in tile_ids:
            out.add(tid)
            p = self.animated_partner(tid)
            if p:
                out.add(p)
        # 反向：若集合里含某格是别格的第二帧，也把那个首帧拉进来
        second_of = {}
        for tid in self.tiles:
            p = self.animated_partner(tid)
            if p:
                second_of.setdefault(p, tid)
        for tid in list(out):
            if tid in second_of:
                out.add(second_of[tid])
        return sorted(out)

    # ── 分组 ──
    def groups(self):
        """返回 {对象名: {kind, tiles, ...}}"""
        if self._groups is not None:
            return self._groups
        g = {}
        # ① description 系列
        for tid, t in self.tiles.items():
            d = None
            for pr in t.get("properties", []):
                if pr.get("name") == "description":
                    d = str(pr.get("value", "")).strip()
                    break
            if not d:
                continue
            e = g.setdefault(d, {"kind": "series", "base": set(), "ids": []})
            e["base"].add(tid)
            e["ids"].append(tid)
        # ② 角色（entity_types）
        for en in self.entities:
            name = en.get("name") or en.get("entity_type")
            key = f"{name} ({en.get('entity_type')})"
            tex = [int(x) for x in (en.get("textures") or []) if isinstance(x, (int, float))]
            if not tex:
                continue
            e = g.setdefault(key, {"kind": "character", "base": set(), "ids": []})
            e["base"].update(tex)
            e["ids"].extend(tex)
            e["entity_type"] = en.get("entity_type")
            e["display"] = name
        # 补动画帧
        for key, e in g.items():
            e["all"] = self.animated_family(e["base"])
            e["count"] = len(e["all"])
            e["rows"] = sorted({tid // self.columns for tid in e["all"]})
            e["cols"] = sorted({tid % self.columns for tid in e["all"]})
        self._groups = g
        return g

    def find(self, keyword):
        """模糊查找对象/系列：匹配 key / entity_type / display，支持中文别名"""
        kw = keyword.lower().strip()
        # 中文别名 → 英文关键词
        en_kw = ZH_ALIAS.get(keyword, keyword).lower().strip()
        gs = self.groups()
        hits = []
        for key, e in gs.items():
            hay = [key.lower()]
            if e.get("entity_type"):
                hay.append(str(e["entity_type"]).lower())
            if e.get("display"):
                hay.append(str(e["display"]).lower())
            # 英文用词边界匹配（避免 'orc' 命中 'torch'）；中文直接子串
            for h in hay:
                if _match(h, kw) or _match(h, en_kw):
                    hits.append((key, e))
                    break
        # 精确匹配优先
        hits.sort(key=lambda x: (0 if (x[0].lower() == kw or x[0].lower() == en_kw) else 1, -x[1]["count"]))
        return hits


# ── 命令 ────────────────────────────────────────────────────
def cmd_list(a):
    at = Atlas(a.story)
    gs = at.groups()
    print(f"地图集: {at.story}")
    print(f"图集: {os.path.relpath(at.png, REPO)}")
    print()
    print(f"── 系列（物件/建筑/地形，description）{'':─<40}")
    series = sorted([(k, v) for k, v in gs.items() if v["kind"] == "series"], key=lambda x: -x[1]["count"])
    for k, v in series:
        print(f"  {v['count']:4d} 格  {k}")
    print()
    print(f"── 角色（entity_types）{'':─<45}")
    chars = sorted([(k, v) for k, v in gs.items() if v["kind"] == "character"], key=lambda x: -x[1]["count"])
    for k, v in chars:
        print(f"  {v['count']:4d} 格  {k}")
    print()
    print(f"共 {len(series)} 个系列 + {len(chars)} 个角色")


def cmd_find(a):
    at = Atlas(a.story)
    hits = at.find(a.keyword)
    if not hits:
        print(f"[未找到] {a.keyword!r}")
        print()
        print("可用关键词（部分）：")
        for k, v in list(at.groups().items())[:20]:
            print(f"  {k}")
        return
    print(f"匹配 {a.keyword!r} → {len(hits)} 个对象：")
    for k, v in hits:
        kind = "角色" if v["kind"] == "character" else "系列"
        print(f"  [{kind}] {k}  —— {v['count']} 格")
        print(f"        格子: {v['all']}")


def cmd_tiles(a):
    at = Atlas(a.story)
    hits = at.find(a.name)
    if not hits:
        print(f"[未找到] {a.name!r}")
        return
    key, v = hits[0]
    print(f"对象: {key}  （{'角色' if v['kind']=='character' else '系列'}）")
    print(f"总格数: {v['count']}")
    print()
    print(f"{'tile id':>8}  {'col':>4} {'row':>4}   动画配对")
    for tid in v["all"]:
        c, r = tid % at.columns, tid // at.columns
        p = at.animated_partner(tid)
        print(f"{tid:>8}  {c:>4} {r:>4}   {('→ %d（第二帧）' % p) if p else '首帧'}")
    print()
    print(f"行分布: {v['rows']}")
    print(f"列分布: {v['cols']}")


def cmd_suggest(a):
    """推荐「最值得换皮相」的系列 —— 按体量 + 视觉占比排序"""
    at = Atlas(a.story)
    gs = at.groups()
    kw = a.category.lower().strip()
    # 分类关键词 → 命中的 description 模式
    CATS = ZH_CATEGORY
    pats = CATS.get(kw) or CATS.get(a.category) or [kw]
    hits = []
    for k, v in gs.items():
        if v["kind"] != "series":
            continue
        kl = k.lower()
        if any(p in kl for p in pats):
            hits.append((k, v))
    hits.sort(key=lambda x: -x[1]["count"])
    if not hits:
        print(f"[未找到] 分类 {a.category!r} 匹配不到系列")
        print("可用分类:", ", ".join(CATS.keys()))
        return
    print(f"分类 {a.category!r} → {len(hits)} 个系列，按格数排序（格数多 = 换皮后画面变化最明显）：")
    print()
    total = sum(v["count"] for _, v in hits)
    for i, (k, v) in enumerate(hits, 1):
        print(f"{i:2d}. {k:26s} {v['count']:4d} 格   tile {v['all'][0]} ~ {v['all'][-1]}")
    print()
    print(f"合计 {total} 格（占全图集 {len(at.tiles)} 个已标注 tile 的 {total*100//max(len(at.tiles),1)}%）")


def cmd_export(a):
    from PIL import Image
    at = Atlas(a.story)
    hits = at.find(a.name)
    if not hits:
        print(f"[未找到] {a.name!r}")
        return
    key, v = hits[0]
    os.makedirs(a.out, exist_ok=True)
    im = Image.open(at.png).convert("RGBA")
    ids = v["all"]
    safe = re.sub(r"[^\w\-]+", "_", key)[:40]
    # 单格 PNG
    for tid in ids:
        c, r = tid % at.columns, tid // at.columns
        im.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE)).save(
            os.path.join(a.out, f"{tid}.png")
        )
    # 联络图（放大 6 倍，按网格位置排布，标 id）
    S = 6
    maxc = max(tid % at.columns for tid in ids) + 1
    minc = min(tid % at.columns for tid in ids)
    maxr = max(tid // at.columns for tid in ids) + 1
    minr = min(tid // at.columns for tid in ids)
    w = (maxc - minc) * TILE * S
    h = (maxr - minr) * TILE * S
    sheet = Image.new("RGBA", (w, h), (26, 26, 30, 255))
    for tid in ids:
        c, r = tid % at.columns, tid // at.columns
        crop = im.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE)).resize((TILE * S, TILE * S), Image.NEAREST)
        sheet.paste(crop, ((c - minc) * TILE * S, (r - minr) * TILE * S), crop)
    sheet_path = os.path.join(a.out, f"{safe}_sheet.png")
    sheet.save(sheet_path)
    print(f"对象: {key}（{v['count']} 格）")
    print(f"单格 PNG → {a.out}/<tileId>.png")
    print(f"联络图   → {sheet_path}")
    print()
    print("格子清单:")
    for tid in ids:
        p = at.animated_partner(tid)
        print(f"  {tid}  col={tid%at.columns} row={tid//at.columns}" + (f"  →动画帧 {p}" if p else ""))


def main():
    ap = argparse.ArgumentParser(description="以对象/系列为单位查询图集格子")
    ap.add_argument("--story", help="地图集目录名（默认取唯一那个）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="列出所有对象/系列")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("find", help="按名称查找")
    p.add_argument("keyword")
    p.set_defaults(fn=cmd_find)

    p = sub.add_parser("tiles", help="打印某对象的格子清单")
    p.add_argument("name")
    p.set_defaults(fn=cmd_tiles)

    p = sub.add_parser("suggest", help="推荐最值得换皮相的系列")
    p.add_argument("category", help="分类：建筑/地形/家具/植物/装饰 或任意关键词")
    p.set_defaults(fn=cmd_suggest)

    p = sub.add_parser("export", help="导出对象的小图与联络图")
    p.add_argument("name")
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_export)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
