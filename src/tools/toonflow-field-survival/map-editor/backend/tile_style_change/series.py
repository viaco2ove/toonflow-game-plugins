"""
系列换皮路由（/api/tile-style/series/*）
==========================================
以「对象 / 系列」为单位换皮相：
  · GET  /series            列出全部系列（物件/建筑/地形 + 角色，角色自动补动画帧）
  · POST /series/suggest    AI 挑选：聊天选系列 + 想要的风格 → 推荐系列 + 生成方案
  · POST /series/recolor    保形换色生成 1~N 套皮相候选（不落盘）
  · POST /series/apply      选定一套候选落盘（备份→存档→整格替换→styleOverrides→同步）
  · POST /series/revert     还原某系列的格子到 overrides/originals 存档

设计要点（来自 2026-10-22 的实测教训）：
  · 32×32 像素贴图**不能用 AI 生图**（1024 缩 32 后 400~650 色全糊）→ 候选一律保形换色；
  · 落盘必须**整格替换**（paste），alpha_composite 会透出 alpha=1 幽灵像素残影；
  · 角色的 textures 只含首帧，动画第二帧必须从 animated/animated_id 补全，否则跳变。
"""
import base64
import io
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent))
import ai_store
import ai_clients

router = APIRouter(prefix="/api/tile-style/series", tags=["tile-style-series"])

TILE = 32


def _server():
    """延迟导入 server（server 启动时 import 本模块，直接 import 会循环）"""
    import server
    return server


# ─── 系列/对象识别（与 workbuddy-ai/skills/tile-style-change/scripts/tile_groups.py 同逻辑）───
ZH_ALIAS = {
    "半兽人": "orc", "地精": "goblin", "僵尸": "zombie", "骷髅": "skeleton",
    "小恶魔": "imp", "老鼠": "rat", "蝙蝠": "bat", "蛇": "snake",
    "狗头人": "kobold", "冰元素": "ice elemental", "白骨人": "boneman",
    "恶魔": "demon", "鬼魂": "ghost", "幽灵": "ghost", "木乃伊": "mummy",
    "海妖": "siren", "巨魔": "troll", "女妖": "banshee", "魔像": "golem",
    "独眼巨人": "cyclops", "牛魔王": "minotaur", "牛头人": "minotaur", "吸血鬼": "vampire",
    "石墙": "stone wall", "木墙": "wooden wall", "土墙": "dirt wall",
    "石地板": "stone floor", "木地板": "wooden floor", "草地": "grass",
    "树": "tree", "枯树": "dead tree", "栅栏": "fence", "地毯": "carpet",
    "书架": "bookcase", "火把": "torch", "招牌": "sign", "墓碑": "grave",
    "棺材": "coffin", "桌": "table", "桌子": "table", "椅子": "chair", "床": "bed",
    "木桶": "barrel", "板条箱": "crate", "灌木": "shrub", "花": "flowers",
    "蘑菇": "mushroom", "原木": "logs", "王座": "throne", "喷泉": "fountain",
    "蜘蛛网": "cobwebs", "酒馆": "bar", "陶罐": "pot",
}
ZH_CATEGORY = {
    "建筑": ["wall", "floor", "roof", "house", "window", "door", "fence", "carpet", "bookcase", "bar"],
    "建筑物": ["wall", "floor", "roof", "house", "window", "door", "fence", "carpet", "bookcase", "bar"],
    "地形": ["floor", "grass", "dirt", "water", "ground", "sand", "path"],
    "家具": ["table", "chair", "bed", "barrel", "crate", "throne", "pot", "bookcase", "carpet"],
    "植物": ["tree", "grass", "shrub", "flower", "mushroom", "cabbage", "logs"],
    "装饰": ["torch", "sign", "grave", "bones", "coffin", "pedestal", "fountain", "cobweb", "pot"],
}


def _is_cjk(s):
    return any("\u4e00" <= ch <= "\u9fff" for ch in s)


def _match(hay, needle):
    if not needle:
        return False
    if _is_cjk(needle):
        return needle in hay
    if needle in hay:
        for m in re.finditer(re.escape(needle), hay):
            b = m.start() == 0 or not hay[m.start() - 1].isalpha()
            e = m.end() == len(hay) or not hay[m.end()].isalpha()
            if b and e:
                return True
    return False


def load_series(material: str) -> dict:
    """返回 {name: {kind, ids(含动画帧), base, entity_type}}"""
    _, _, js = _server().resolve_tileset_target(material)
    with open(js, encoding="utf-8") as fp:
        meta = json.load(fp)
    columns = int(meta.get("columns", 120))
    tiles = {t["id"]: t for t in meta.get("tiles", [])}

    def prop(tid, name):
        for pr in tiles.get(tid, {}).get("properties", []):
            if pr.get("name") == name:
                return pr.get("value")
        return None

    # 动画关系
    partner = {}
    reverse = {}
    for tid in tiles:
        if prop(tid, "animated"):
            v = prop(tid, "animated_id")
            if isinstance(v, (int, float)) and v > 0:
                partner[tid] = int(v)
                reverse.setdefault(int(v), tid)

    def family(ids_):
        out = set(ids_)
        for tid in list(out):
            if tid in partner:
                out.add(partner[tid])
            if tid in reverse:
                out.add(reverse[tid])
        return sorted(out)

    groups: Dict[str, dict] = {}
    # ① description 系列
    for tid, t in tiles.items():
        d = prop(tid, "description")
        if not d:
            continue
        e = groups.setdefault(str(d).strip(), {"kind": "series", "base": set()})
        e["base"].add(tid)
    # ② 角色
    ent_path = os.path.join(os.path.dirname(js), "entity_types.json")
    if os.path.isfile(ent_path):
        with open(ent_path, encoding="utf-8") as fp:
            enemies = json.load(fp).get("enemies", [])
        for en in enemies:
            tex = [int(x) for x in (en.get("textures") or []) if isinstance(x, (int, float))]
            if not tex:
                continue
            key = f"{en.get('name')} ({en.get('entity_type')})"
            e = groups.setdefault(key, {"kind": "character", "base": set(),
                                        "entity_type": en.get("entity_type"),
                                        "display": en.get("name"),
                                        "zh": en.get("description_zh", "")})
            e["base"].update(tex)
    # 补动画帧 + 行列
    for key, e in groups.items():
        ids = family(e["base"])
        # ★ 连续块补全：角色素材在图集里按行连续排布，textures 常漏格
        #   （实测 ORC textures 缺 5298，但 5298/5306 是骑士造型，同属半兽人家族）。
        #   把同一行内「间距 ≤ 2」的格子之间的洞补上。
        by_row = {}
        for t in ids:
            by_row.setdefault(t // columns, set()).add(t % columns)
        filled = set(ids)
        for row, cols in by_row.items():
            cs = sorted(cols)
            run_start = prev = cs[0]
            runs = []
            for c in cs[1:]:
                if c - prev <= 2:
                    prev = c
                    continue
                runs.append((run_start, prev))
                run_start = prev = c
            runs.append((run_start, prev))
            for a, b in runs:
                for c in range(a, b + 1):
                    filled.add(row * columns + c)
        e["ids"] = sorted(filled)
        e["count"] = len(e["ids"])
        rows = sorted({t // columns for t in e["ids"]})
        cols = sorted({t % columns for t in e["ids"]})
        e["rows"], e["cols"] = rows, cols
        del e["base"]
    return groups, meta, columns


def find_group(groups: dict, keyword: str):
    kw = keyword.lower().strip()
    en_kw = ZH_ALIAS.get(keyword, keyword).lower().strip()
    hits = []
    for key, e in groups.items():
        hay = [key.lower()]
        if e.get("entity_type"):
            hay.append(str(e["entity_type"]).lower())
        if e.get("display"):
            hay.append(str(e["display"]).lower())
        for h in hay:
            if _match(h, kw) or _match(h, en_kw):
                hits.append((key, e))
                break
    hits.sort(key=lambda x: (0 if (x[0].lower() == kw or x[0].lower() == en_kw) else 1, -x[1]["count"]))
    return hits


# ─── 调色板（与 skill 的 skin_recolor.py 一致）───
PALETTES = {
    "modern":   {"label": "现代都市", "dark": (46, 50, 58), "mid": (108, 116, 128), "light": (172, 180, 192), "accent": (86, 156, 196), "accent2": (206, 214, 226)},
    "neon":     {"label": "赛博霓虹", "dark": (18, 12, 30), "mid": (58, 30, 92), "light": (140, 90, 190), "accent": (0, 240, 255), "accent2": (255, 60, 200)},
    "nature":   {"label": "荒野自然", "dark": (58, 48, 34), "mid": (110, 94, 62), "light": (162, 146, 100), "accent": (74, 106, 54), "accent2": (198, 186, 140)},
    "ice":      {"label": "寒冰", "dark": (58, 82, 106), "mid": (122, 158, 184), "light": (188, 214, 232), "accent": (216, 242, 255), "accent2": (140, 200, 235)},
    "volcanic": {"label": "熔岩火山", "dark": (32, 26, 26), "mid": (74, 58, 54), "light": (124, 100, 90), "accent": (232, 96, 24), "accent2": (255, 176, 48)},
    "dark":     {"label": "暗黑哥特", "dark": (16, 14, 20), "mid": (54, 48, 62), "light": (104, 96, 116), "accent": (176, 32, 40), "accent2": (196, 190, 206)},
}
# 描述词 → palette
STYLE_KEYWORDS = [
    ("现代|都市|city|modern", ["modern"]),
    ("赛博|霓虹|cyber|neon", ["neon"]),
    ("自然|森林|荒野|nature", ["nature"]),
    ("冰|寒|ice|frozen", ["ice"]),
    ("火山|熔岩|lava|volcan", ["volcanic"]),
    ("暗黑|哥特|dark|gothic|黑", ["dark"]),
    ("白雪|雪|snow", ["ice"]),
]


def palettes_for_style(style_text: str):
    """从风格描述推断 palette 列表（1~N 套候选）"""
    s = style_text or ""
    for pat, pals in STYLE_KEYWORDS:
        if re.search(pat, s, re.I):
            return pals
    # 没命中就给全部 6 套作为候选
    return list(PALETTES.keys())


def build_lut(pal):
    def lerp(a, b, t):
        return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    stops = [(0.00, pal["dark"]), (0.35, pal["mid"]), (0.62, pal["light"]),
             (0.85, pal["accent2"]), (1.00, pal["accent"])]

    def map_lum(lum):
        for i in range(len(stops) - 1):
            l0, c0 = stops[i]
            l1, c1 = stops[i + 1]
            if l0 <= lum <= l1:
                t = 0 if l1 == l0 else (lum - l0) / (l1 - l0)
                return lerp(c0, c1, t)
        return stops[-1][1]
    return map_lum


def recolor_tile(im: Image.Image, map_lum, pal) -> Image.Image:
    src = im.convert("RGBA")
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    sp, op = src.load(), out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = sp[x, y]
            if a == 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            nr, ng, nb = map_lum(lum)
            if r > b + 18 and lum > 0.5:
                nr, ng, nb = pal["accent2"]
            if g > r + 12 and g > b + 12:
                nr, ng, nb = pal["accent"]
            op[x, y] = (nr, ng, nb, a)
    return out


def tile_to_dataurl(im: Image.Image) -> str:
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def make_contact_sheet(images: List[Image.Image], cols=8, scale=5) -> str:
    """多格拼一张联络图 dataURL（前端预览用）"""
    if not images:
        return ""
    n = len(images)
    rows = (n + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * TILE * scale, rows * TILE * scale), (26, 26, 30, 255))
    for i, im in enumerate(images):
        cell = im.resize((TILE * scale, TILE * scale), Image.NEAREST)
        sheet.paste(cell, ((i % cols) * TILE * scale, (i // cols) * TILE * scale), cell)
    return tile_to_dataurl(sheet)


# ─── Schemas ───
class SuggestReq(BaseModel):
    material: str
    message: str            # 用户聊天输入，如「建筑物改成现代风」


class SuggestResp(BaseModel):
    reply: str              # AI 回复（推荐 + 理由）
    groups: List[dict]      # 推荐的系列 [{name, kind, count, ids, reason}]
    palettes: List[str]     # 建议的配色
    needSeries: list = []   # 需要用户澄清的（可选）


class RecolorReq(BaseModel):
    material: str
    group: str              # 系列名
    palettes: List[str]     # 1~N 套配色，每套生成一个候选


class RecolorCandidate(BaseModel):
    id: str
    palette: str
    label: str
    tiles: Dict[str, str]   # {tileId: dataURL}（32×32 单格）
    sheet: str              # 联络图 dataURL
    count: int


class RecolorResp(BaseModel):
    groupId: str
    count: int
    candidates: List[RecolorCandidate]


class ApplyReq(BaseModel):
    material: str
    group: str
    tiles: Dict[str, str]   # {tileId: dataURL}（选中的那套候选）


class RevertReq(BaseModel):
    material: str
    group: str              # 还原该系列全部格子（或 --ids）


class PreviewReq(BaseModel):
    material: str
    group: str


# ─── 路由 ───
@router.get("")
def list_series(material: str):
    try:
        groups, meta, columns = load_series(material)
    except Exception as e:
        raise HTTPException(400, f"读取地图集失败: {e}")
    items = [{"name": k, "kind": v["kind"], "count": v["count"], "ids": v["ids"],
              "entity_type": v.get("entity_type"), "zh": v.get("zh", "")}
             for k, v in sorted(groups.items(), key=lambda x: (-x[1]["count"], x[0]))]
    return {"material": material, "total": len(items), "groups": items}


@router.post("/suggest", response_model=SuggestResp)
async def suggest_series(req: SuggestReq):
    """AI 挑选：把系列清单 + 用户聊天输入交给文本模型，返回推荐系列与理由。
    无文本模型时降级为关键词匹配。"""
    groups, meta, columns = load_series(req.material)
    # 系列清单（给 LLM 的紧凑列表）
    lines = []
    for k, v in sorted(groups.items(), key=lambda x: -x[1]["count"]):
        tag = "角色" if v["kind"] == "character" else "系列"
        lines.append(f"- {k} [{tag}] {v['count']}格")
    catalog = "\n".join(lines)

    reply, chosen, palettes = "", [], []
    # 尝试 LLM
    try:
        bound = ai_store.get_bound_config(ai_store.SLOT_TEXTURE_REPLACE)
        # 文本模型：找 t_config 里 type=text 的第一个
        text_cfg = None
        for c in ai_store.list_models("text"):
            text_cfg = c
            break
        if text_cfg and text_cfg.get("apiKey"):
            sys_p = (
                "你是像素游戏地图集的换皮顾问。下面是图集里全部对象/系列清单（名称 [类型] 格数）。\n"
                "用户会用中文提出换皮需求。你的任务：\n"
                "1) 判断用户想改哪些对象/系列（宁少勿多，别把地形全搭进去除非用户明说）；\n"
                "2) 从清单里精确选出相关项（用清单里的原名）；\n"
                "3) 给出配色方向（modern/neon/nature/ice/volcanic/dark 中选 1~3 个）。\n"
                "严格输出 JSON：{\"groups\":[\"系列名1\",...],\"palettes\":[\"modern\"],\"reply\":\"一句话说明\"}\n"
                "不要输出 JSON 以外的任何文字。\n\n清单：\n" + catalog
            )
            txt = ai_clients.call_text(text_cfg, [{"role": "user", "content": req.message}], system=sys_p)
            m = re.search(r"\{.*\}", txt, re.S)
            if m:
                data = json.loads(m.group(0))
                chosen = [g for g in (data.get("groups") or []) if g in groups]
                palettes = [p for p in (data.get("palettes") or []) if p in PALETTES]
                reply = data.get("reply", "")
    except Exception as e:
        _server().logger.info(f"[series/suggest] LLM 降级: {e}")

    # 降级：关键词匹配
    if not chosen:
        msg = req.message
        direct = find_group(groups, msg)
        if direct:
            chosen = [direct[0][0]]
        else:
            for cat, pats in ZH_CATEGORY.items():
                if cat in msg:
                    pats2 = pats
                    break
            else:
                pats2 = ["wall", "floor", "fence", "bookcase"]
            chosen = [k for k, v in groups.items()
                      if v["kind"] == "series" and any(p in k.lower() for p in pats2)][:8]
        palettes = palettes_for_style(msg)
        reply = reply or f"按关键词匹配到 {len(chosen)} 个系列。"

    out = [{"name": k, "kind": groups[k]["kind"], "count": groups[k]["count"],
            "ids": groups[k]["ids"]} for k in chosen if k in groups]
    if not palettes:
        palettes = palettes_for_style(req.message)
    return SuggestResp(reply=reply, groups=out, palettes=palettes)


@router.post("/preview")
def preview_series(req: PreviewReq):
    """原格联络图（换皮前长什么样）"""
    groups, meta, columns = load_series(req.material)
    hits = find_group(groups, req.group)
    if not hits:
        raise HTTPException(404, f"找不到系列 {req.group!r}")
    key, grp = hits[0]
    _, png_path, _ = _server().resolve_tileset_target(req.material)
    base = Image.open(png_path).convert("RGBA")
    imgs = []
    for tid in grp["ids"]:
        c, r = tid % columns, tid // columns
        imgs.append(base.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE)))
    return {"groupId": key, "count": grp["count"], "sheet": make_contact_sheet(imgs)}


@router.post("/recolor", response_model=RecolorResp)
def recolor_series(req: RecolorReq):
    """保形换色生成候选：每套 palette 一个候选，含全部格子的 32×32 图 + 联络图。"""
    groups, meta, columns = load_series(req.material)
    hits = find_group(groups, req.group)
    if not hits:
        raise HTTPException(404, f"找不到系列 {req.group!r}")
    key, grp = hits[0]
    _, png_path, _ = _server().resolve_tileset_target(req.material)
    base = Image.open(png_path).convert("RGBA")

    pals = [p for p in req.palettes if p in PALETTES] or ["modern"]
    cands = []
    for pid in pals:
        pal = PALETTES[pid]
        lut = build_lut(pal)
        tiles = {}
        imgs = []
        for tid in grp["ids"]:
            c, r = tid % columns, tid // columns
            crop = base.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE))
            t = recolor_tile(crop, lut, pal)
            tiles[str(tid)] = tile_to_dataurl(t)
            imgs.append(t)
        cands.append(RecolorCandidate(
            id=f"c_{pid}", palette=pid, label=pal["label"],
            tiles=tiles, sheet=make_contact_sheet(imgs), count=len(imgs)))
    return RecolorResp(groupId=key, count=grp["count"], candidates=cands)


@router.post("/apply")
def apply_series(req: ApplyReq):
    """选定候选落盘：备份→存档原始像素→整格替换→styleOverrides→同步副本。"""
    if not req.tiles:
        raise HTTPException(400, "没有要落盘的格子")
    coll_dir, png_path, js_path = _server().resolve_tileset_target(req.material)
    # 备份（首次）
    bak_dir = coll_dir / "bak"
    bak_png = bak_dir / "compiled_tileset_32x32.png.bak"
    if not bak_png.exists():
        bak_dir.mkdir(exist_ok=True)
        shutil.copy2(png_path, bak_png)
    base = Image.open(png_path).convert("RGBA")
    with open(js_path, encoding="utf-8") as fp:
        meta = json.load(fp)
    columns = int(meta.get("columns", 120))
    ov_dir = coll_dir / "overrides"
    orig_dir = ov_dir / "originals"
    orig_dir.mkdir(parents=True, exist_ok=True)

    applied = []
    for tid_s, du in req.tiles.items():
        tid = int(tid_s)
        b64 = du.split(",", 1)[1] if "," in du else du
        im = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")
        if im.size != (TILE, TILE):
            im = im.resize((TILE, TILE), Image.LANCZOS)
        col, row = tid % columns, tid // columns
        box = (col * TILE, row * TILE, (col + 1) * TILE, (row + 1) * TILE)
        orig = orig_dir / f"{tid}.png"
        if not orig.exists():
            base.crop(box).save(orig)
        base.paste(im, (col * TILE, row * TILE))   # ★ 整格替换
        im.save(ov_dir / f"{tid}.png")
        meta.setdefault("styleOverrides", {})[str(tid)] = {
            "overridePng": f"overrides/{tid}.png",
            "prompt": f"series-recolor: {req.group}",
            "model": "recolor",
            "createdAt": "2026-10-22T00:00:00.000000Z",
        }
        applied.append(tid)
    base.save(png_path)
    with open(js_path, "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)
    # 同步副本（public/ui）
    synced = _sync_copies(coll_dir)
    _server().logger.info(f"[series/apply] {req.group}: {len(applied)} 格落盘, synced={synced}")
    return {"ok": True, "applied": applied, "synced": synced}


def _sync_copies(coll_dir: Path) -> list:
    """同步 public/ui 两份副本（数据库包由前端已有的部署流程处理）"""
    repo = Path(__file__).resolve().parents[5]
    synced = []
    src = coll_dir / "images" / "compiled_tileset_32x32.png"
    for rel in ("plugins/toonflow-field-survival/vue/public/images/compiled_tileset_32x32.png",
                "plugins/toonflow-field-survival/ui/images/compiled_tileset_32x32.png"):
        dst = repo / rel
        try:
            if dst.exists() and src.exists():
                shutil.copy2(src, dst)
                synced.append(rel)
        except Exception:
            pass
    return synced


@router.post("/revert")
def revert_series(req: RevertReq):
    """还原该系列格子：优先 overrides/originals 存档，缺失时退回 .original.png 基线。"""
    coll_dir, png_path, js_path = _server().resolve_tileset_target(req.material)
    groups, meta, columns = load_series(req.material)
    hits = find_group(groups, req.group)
    if not hits:
        raise HTTPException(404, f"找不到系列 {req.group!r}")
    key, grp = hits[0]
    orig_dir = coll_dir / "overrides" / "originals"
    # 基线图集（从未改过的原始版本）—— 存档缺失时的退路
    baseline_path = coll_dir / "images" / "compiled_tileset_32x32.original.png"
    baseline = Image.open(baseline_path).convert("RGBA") if baseline_path.exists() else None
    if not orig_dir.exists() and baseline is None:
        raise HTTPException(400, "没有存档可还原（overrides/originals 与 .original.png 均缺失）")
    base = Image.open(png_path).convert("RGBA")
    reverted = []
    for tid in grp["ids"]:
        f = orig_dir / f"{tid}.png" if orig_dir.exists() else None
        col, row = tid % columns, tid // columns
        if f and f.exists():
            im = Image.open(f).convert("RGBA")
        elif baseline is not None:
            im = baseline.crop((col * TILE, row * TILE, (col + 1) * TILE, (row + 1) * TILE))
        else:
            continue
        base.paste(im, (col * TILE, row * TILE))
        (coll_dir / "overrides" / f"{tid}.png").unlink(missing_ok=True)
        meta.get("styleOverrides", {}).pop(str(tid), None)
        reverted.append(tid)
    base.save(png_path)
    with open(js_path, "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)
    synced = _sync_copies(coll_dir)
    return {"ok": True, "reverted": reverted, "synced": synced}