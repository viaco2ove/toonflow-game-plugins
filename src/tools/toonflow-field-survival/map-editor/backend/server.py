"""
地图编辑器后端 — FastAPI
=========================

提供地图集目录的 REST API：
  GET  /api/collections                                - 列出 map_design/ 下所有地图集
  GET  /api/collections/{name}                        - 加载地图集元数据（地图列表 + 元信息）
  GET  /api/collections/{name}/maps/{map_name}        - 读取某张地图（Tiled JSON）
  POST /api/collections/{name}/maps/{map_name}        - 保存某张地图（Tiled JSON）
  POST /api/collections/{name}/maps                    - 创建新地图（空白模板）
  DELETE /api/collections/{name}/maps/{map_name}      - 删除地图
  POST /api/collections/{name}/tileset                - tileset.png（直接以二进制流返回）
  GET  /api/collections/{name}/dawnlike              - 编译后的碰撞属性表

  POST /api/collections                               - 创建新地图集目录
  DELETE /api/collections/{name}                      - 删除地图集目录

默认根目录：D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/workshops/toonflow-field-survival/map_design/
（可通过环境变量 TFS_MAP_ROOT 覆盖）
"""

import base64
import datetime
import io
import json
import os
import shutil
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from PIL import Image

# ───────────────────────── 路径常量 ─────────────────────────
DEFAULT_ROOT = Path(
    "D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/"
    "workshops/toonflow-field-survival/map_design"
)
MAP_ROOT = Path(os.environ.get("TFS_MAP_ROOT", str(DEFAULT_ROOT)))

# 素材库根目录（compiled_tileset_32x32 等）：与 map_design 平级
RESOURCE_ROOT = MAP_ROOT.parent / "resource_library" / "toonflow-field-survival" / "base"

# 插件 ui/ 目录（预览用：挂载静态文件 + deploy 目标）
PLUGIN_UI_DIR = Path(
    "D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/"
    "plugins/toonflow-field-survival/ui"
)
# 插件根目录（dev-host 启动用：vue/ 子目录含 vite.config.ts）
PLUGIN_ROOT = Path(
    "D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/"
    "plugins/toonflow-field-survival"
)

# ───────────────────────── 应用 ─────────────────────────
app = FastAPI(title="Toonflow Map Editor API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ───────────────────────── 工具 ─────────────────────────
def coll_path(name: str) -> Path:
    """地图集目录绝对路径（安全校验：不允许 .. 等）"""
    if not name or "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "invalid collection name")
    return MAP_ROOT / name


def safe_path(base: Path, *parts: str) -> Path:
    """拼接路径并确保在 base 之内"""
    p = (base / Path(*parts)).resolve()
    base_resolved = base.resolve()
    if not str(p).startswith(str(base_resolved)):
        raise HTTPException(400, "path escapes base directory")
    return p


def ensure_collection(name: str) -> Path:
    p = coll_path(name)
    if not p.exists():
        raise HTTPException(404, f"collection not found: {name}")
    if not (p / "maps").exists():
        raise HTTPException(400, f"not a valid map collection (no maps/ subdir): {name}")
    return p


# ───────────────────────── Schema ─────────────────────────
class CollectionInfo(BaseModel):
    name: str
    path: str
    map_count: int
    has_story: bool
    has_dawnlike: bool


class MapEntry(BaseModel):
    name: str             # 文件名不含 .json（"mulberryTown"）
    display_name: str     # "Mulberry Town"
    size: Optional[List[int]] = None  # [w, h]
    object_count: int = 0


class CollectionDetail(BaseModel):
    name: str
    path: str
    maps: List[MapEntry]
    first_map: Optional[str] = None   # maps/first.map.json 里的 start_map.value
    story: Optional[dict] = None       # story.json 内容


class NewCollectionReq(BaseModel):
    name: str
    display_name: Optional[str] = None


class NewMapReq(BaseModel):
    name: str
    display_name: Optional[str] = None
    width: int = 30
    height: int = 20


# ───────────────────────── 地图集 ─────────────────────────
@app.get("/api/collections")
def list_collections() -> List[CollectionInfo]:
    """列出 map_design/ 下所有地图集"""
    if not MAP_ROOT.exists():
        return []
    out = []
    for entry in sorted(MAP_ROOT.iterdir()):
        if not entry.is_dir():
            continue
        if entry.name.startswith(".") or entry.name == "bak":
            continue
        if not (entry / "maps").exists():
            continue
        map_count = sum(
            1 for f in (entry / "maps").iterdir()
            if f.is_file() and f.suffix == ".json" and f.name != "first.map.json"
        )
        out.append(CollectionInfo(
            name=entry.name,
            path=str(entry),
            map_count=map_count,
            has_story=(entry / "story.json").exists(),
            has_dawnlike=(entry / "compiled_dawnlike.json").exists(),
        ))
    return out


@app.get("/api/collections/{name}")
def get_collection(name: str) -> CollectionDetail:
    """加载地图集详情：地图列表 + 元信息"""
    p = ensure_collection(name)
    maps_dir = p / "maps"
    maps: List[MapEntry] = []
    for f in sorted(maps_dir.iterdir()):
        if not f.is_file() or f.suffix != ".json" or f.name == "first.map.json":
            continue
        map_name = f.stem
        # 解析尺寸
        size = None
        obj_count = 0
        display_name = map_name
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
            size = [data.get("width", 0), data.get("height", 0)]
            for layer in data.get("layers", []):
                if layer.get("type") == "objectgroup":
                    obj_count += len(layer.get("objects", []))
            # 显示名：从 layers 第一张 objectgroup 的对象上找 full_name，否则 pascal case
            n = data.get("name")
            if isinstance(n, str) and n.strip() and not n.isdigit():
                display_name = n
            else:
                # pascal case: "mulberryTown" -> "Mulberry Town"
                import re
                display_name = re.sub(r"([A-Z])", r" \1", map_name).strip().title()
        except Exception:
            pass
        maps.append(MapEntry(
            name=map_name, display_name=display_name,
            size=size, object_count=obj_count,
        ))

    # first.map.json
    first_map = None
    first_path = p / "maps" / "first.map.json"
    if first_path.exists():
        try:
            with open(first_path, "r", encoding="utf-8") as fp:
                data = json.load(fp)
            raw = data.get("start_map")
            first_map = raw.get("value") if isinstance(raw, dict) else raw
        except Exception:
            pass

    # story.json
    story = None
    story_path = p / "story.json"
    if story_path.exists():
        try:
            with open(story_path, "r", encoding="utf-8") as fp:
                story = json.load(fp)
        except Exception:
            pass

    return CollectionDetail(
        name=name, path=str(p),
        maps=maps, first_map=first_map, story=story,
    )


@app.post("/api/collections")
def create_collection(req: NewCollectionReq) -> dict:
    """新建地图集目录（含 story.json + first.map.json + 一张空白地图）"""
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "name required")
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "invalid name")

    p = coll_path(name)
    if p.exists():
        raise HTTPException(409, f"collection already exists: {name}")

    p.mkdir(parents=True, exist_ok=True)
    (p / "maps").mkdir(exist_ok=True)

    # story.json
    with open(p / "story.json", "w", encoding="utf-8") as fp:
        json.dump({
            "storyName": req.display_name or name,
            "sessionId": "",
            "worldId": 0,
        }, fp, ensure_ascii=False, indent=2)

    # first.map.json
    with open(p / "maps" / "first.map.json", "w", encoding="utf-8") as fp:
        json.dump({
            "start_map": {"name": "portalID", "type": "string", "value": req.display_name or name}
        }, fp, ensure_ascii=False, indent=2)

    # 空白地图
    blank = make_blank_map(req.display_name or name, 30, 20)
    with open(p / "maps" / f"{name}.json", "w", encoding="utf-8") as fp:
        json.dump(blank, fp, ensure_ascii=False, indent=2)

    return {"ok": True, "name": name, "path": str(p)}


@app.delete("/api/collections/{name}")
def delete_collection(name: str) -> dict:
    """删除整个地图集目录（危险操作，需要确认）"""
    p = ensure_collection(name)
    shutil.rmtree(p)
    return {"ok": True, "name": name}


# ───────────────────────── 地图 ─────────────────────────
@app.get("/api/collections/{name}/maps/{map_name}")
def get_map(name: str, map_name: str):
    """读取地图 Tiled JSON"""
    p = ensure_collection(name)
    if "/" in map_name or "\\" in map_name or ".." in map_name:
        raise HTTPException(400, "invalid map name")
    map_file = safe_path(p / "maps", f"{map_name}.json")
    if not map_file.exists():
        raise HTTPException(404, f"map not found: {map_name}")
    with open(map_file, "r", encoding="utf-8") as fp:
        return json.load(fp)


@app.post("/api/collections/{name}/maps/{map_name}")
def save_map(name: str, map_name: str, body: dict = Body(...)) -> dict:
    """保存地图 Tiled JSON"""
    p = ensure_collection(name)
    if "/" in map_name or "\\" in map_name or ".." in map_name:
        raise HTTPException(400, "invalid map name")
    map_file = safe_path(p / "maps", f"{map_name}.json")
    # 备份旧版本
    if map_file.exists():
        bak_dir = p / "maps" / "bak"
        bak_dir.mkdir(exist_ok=True)
        shutil.copy2(map_file, bak_dir / f"{map_name}.json.bak")
    with open(map_file, "w", encoding="utf-8") as fp:
        json.dump(body, fp, ensure_ascii=False, indent=2)
    return {"ok": True, "name": map_name, "size": [body.get("width", 0), body.get("height", 0)]}


@app.post("/api/collections/{name}/maps")
def create_map(name: str, req: NewMapReq) -> dict:
    """创建新地图（空白 Tiled JSON）"""
    p = ensure_collection(name)
    map_name = req.name.strip()
    if not map_name or "/" in map_name or "\\" in map_name or ".." in map_name:
        raise HTTPException(400, "invalid map name")
    map_file = safe_path(p / "maps", f"{map_name}.json")
    if map_file.exists():
        raise HTTPException(409, f"map already exists: {map_name}")
    blank = make_blank_map(req.display_name or map_name, req.width, req.height)
    with open(map_file, "w", encoding="utf-8") as fp:
        json.dump(blank, fp, ensure_ascii=False, indent=2)
    return {"ok": True, "name": map_name, "path": str(map_file)}


@app.delete("/api/collections/{name}/maps/{map_name}")
def delete_map(name: str, map_name: str) -> dict:
    """删除地图（移到 bak/）"""
    p = ensure_collection(name)
    if "/" in map_name or "\\" in map_name or ".." in map_name:
        raise HTTPException(400, "invalid map name")
    map_file = safe_path(p / "maps", f"{map_name}.json")
    if not map_file.exists():
        raise HTTPException(404, f"map not found: {map_name}")
    bak_dir = p / "maps" / "bak"
    bak_dir.mkdir(exist_ok=True)
    shutil.move(str(map_file), str(bak_dir / f"{map_name}.json.deleted"))
    return {"ok": True, "name": map_name}


# ───────────────────────── 资源 ─────────────────────────
@app.get("/api/collections/{name}/data-sheets")
def get_data_sheets(name: str):
    """
    解析地图集的 data.xlsx（资源注册表），返回结构化的瓦片族/怪物表。
    sheet 约定（见 expand_data_xlsx.py）：
      Enemies         - id,name,description,hp,... （怪物属性）
      Wall Textures   - id,name,<variant>*n        （数值 = tileId）
      Floor Textures  - 同上
      Decor Textures  - id,name,name_zh,count,used_in_maps,tiles（tiles 逗号分隔 tileId）
    """
    p = ensure_collection(name)
    xlsx = p / "data.xlsx"
    if not xlsx.exists():
        raise HTTPException(404, f"data.xlsx not found in collection: {name}")
    try:
        import openpyxl
        wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    except Exception as e:
        raise HTTPException(500, f"cannot open data.xlsx: {e}")

    sheets: List[dict] = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        hdr = [str(c).strip() if c is not None else "" for c in rows[0]]
        if sheet_name == "Decor Textures":
            # 族表：一行一族，tiles 列逗号分隔 tileId
            fams = []
            for r in rows[1:]:
                fam_id = r[0]
                if fam_id is None or str(fam_id).startswith("="):
                    continue
                tids = []
                for tok in str(r[5] or "").split(","):
                    tok = tok.strip()
                    if tok.isdigit():
                        tids.append(int(tok))
                fams.append({
                    "id": str(fam_id), "name": str(r[1] or fam_id),
                    "name_zh": str(r[2] or ""), "count": len(tids),
                    "used": int(r[4] or 0) if isinstance(r[4], (int, float)) else 0,
                    "tiles": tids,
                })
            sheets.append({"kind": "decor", "name": sheet_name, "families": fams})
        elif sheet_name == "Enemies":
            # 怪物表：id 列可能是公式（缓存丢失时为 None）——跳过空行
            enemies = []
            for r in rows[1:]:
                eid = r[0]
                if eid is None or not str(eid).strip():
                    continue
                def num(i):
                    v = r[i] if i < len(r) else None
                    try: return float(v) if v is not None else None
                    except (TypeError, ValueError): return None
                enemies.append({
                    "id": str(eid), "name": str(r[1] or ""),
                    "hp": num(3), "str": num(5), "def": num(6),
                })
            sheets.append({"kind": "enemies", "name": sheet_name, "enemies": enemies})
        else:
            # Wall/Floor 族表：一行一族，数值列即 tileId 变体
            # 注意 id 列是公式（=UPPER(...)），data_only 读回 None → 用 name 列推导 id
            fams = []
            tilecols = [i for i, h in enumerate(hdr)
                        if h not in ("id", "name", "description") and i >= 2]
            for r in rows[1:]:
                vals = [(hdr[i], int(r[i])) for i in tilecols
                        if i < len(r) and isinstance(r[i], (int, float))]
                if not vals:
                    continue
                name_val = str(r[1] or "").strip()
                id_val = str(r[0] or "").strip()
                fam_id = id_val if id_val and not id_val.startswith("=") \
                    else name_val.upper().replace(" ", "_")
                # 变体名列表（upperLeft/top/center/...），前端 tooltip 用
                fams.append({
                    "id": fam_id, "name": name_val or fam_id, "name_zh": "",
                    "count": len(vals), "used": 0,
                    "tiles": [v for _, v in vals], "variants": vals,
                })
            sheets.append({"kind": "variants", "name": sheet_name, "families": fams})
    wb.close()
    return {"sheets": sheets}


@app.get("/api/collections/{name}/tileset")
def get_tileset(name: str):
    """返回地图集的 compiled_tileset_32x32.png"""
    p = ensure_collection(name)
    for candidate in [
        p / "images" / "compiled_tileset_32x32.png",
        p / "compiled_tileset_32x32.png",
    ]:
        if candidate.exists():
            return FileResponse(candidate, media_type="image/png")
    raise HTTPException(404, "tileset not found")


@app.get("/api/collections/{name}/dawnlike")
def get_dawnlike(name: str):
    """返回 compiled_dawnlike.json 编译后的 {tile_id: {category, blocked, ...}}"""
    p = ensure_collection(name)
    src = p / "compiled_dawnlike.json"
    if not src.exists():
        raise HTTPException(404, "dawnlike not found")
    with open(src, "r", encoding="utf-8") as fp:
        raw = json.load(fp)

    # 编译成 {tile_id: {category, blocked, blocks_vision, name, animated, ...}}
    out = {
        "tilewidth": raw.get("tilewidth", 32),
        "tileheight": raw.get("tileheight", 32),
        "image": raw.get("image", ""),
        "tiles": {},
    }
    # description → category 映射（基于 compiled_dawnlike.json 实际 1236 个带描述 tile 统计）
    DESC_TO_CAT = {
        # 地面
        "stone floor": "ground", "dirt": "ground", "wooden floor": "ground",
        "grass": "ground", "carpet": "ground", "cobble stone floor": "ground",
        "wild grass": "ground", "sand": "ground", "snow": "ground",
        # 墙壁
        "stone wall": "wall", "wooden wall": "wall", "mine wall": "wall",
        "dirt wall": "wall", "mossy stone wall": "wall", "rock wall": "wall",
        # 水面
        "water": "water", "sea water": "water", "shallow water": "water",
        # 道路（当前数据里没有，保留扩展位）
        "road": "road", "stone path": "road", "bridge": "road",
        # 装饰
        "sign": "decor", "bones": "decor", "grave": "decor",
        "tree": "decor", "dead tree": "decor", "flowers": "decor",
        "bookcase": "decor", "torch": "decor", "pot": "decor",
        "bar": "decor", "coffin": "decor", "cobwebs": "decor",
        "chair": "decor", "barrel": "decor", "table": "decor",
        "bed": "decor", "crate": "decor", "sleeping bag": "decor",
        "shrub": "decor", "pedestal": "decor", "bloody pedestal": "decor",
        "cabbage": "decor", "mushroom": "decor", "throne": "decor",
        "logs": "decor", "fountain": "decor", "weird sharp object": "decor",
        "flail": "decor", "whip": "decor", "armor": "decor",
        # 建筑/家具
        "fence": "farm",
    }
    for t in raw.get("tiles", []):
        tid = t.get("id")
        if tid is None:
            continue
        props = {p["name"]: p["value"] for p in t.get("properties", [])}
        desc = (props.get("description") or "").lower()
        # ★ 无 description 的 tile（3770 个，多为武器/装备/图标）不进调色板
        if not desc:
            continue
        cat = DESC_TO_CAT.get(desc, "other")
        out["tiles"][str(tid)] = {
            "category": cat,
            "blocked": props.get("blocked", False) is True,
            "blocks_vision": props.get("blocks_vision", False) is True,
            "description": props.get("description", ""),
            "name": desc,
            "animated": props.get("animated", False) is True,
        }
    return out


# ───────────────────────── 工具 ─────────────────────────
def make_blank_map(display_name: str, width: int, height: int) -> dict:
    """生成空白 Tiled JSON 地图（默认全草地 tile）"""
    DEFAULT_TILE = 7865  # 草地
    TILE_SIZE = 32
    data = [DEFAULT_TILE] * (width * height)
    return {
        "width": width,
        "height": height,
        "tilewidth": TILE_SIZE,
        "tileheight": TILE_SIZE,
        "name": display_name,
        "tilesets": [
            {"firstgid": 1, "source": "compiled_dawnlike.json"}
        ],
        "layers": [
            {
                "type": "tilelayer",
                "name": "Ground",
                "data": data,
            },
            {
                "type": "objectgroup",
                "name": "Actors",
                "objects": [
                    {
                        "id": 1,
                        "name": "Player",
                        "x": (width // 2) * TILE_SIZE,
                        "y": (height // 2 + 1) * TILE_SIZE,
                        "properties": [
                            {"name": "entity_type", "value": "PLAYER", "type": "string"}
                        ]
                    }
                ]
            }
        ]
    }


# ───────────────────────── 预览（dev-host 拟真宿主） ─────────────────────────
class PreviewReq(BaseModel):
    map_name: str
    data: dict


# dev server 进程句柄（全局单例：同一地图集复用，切地图集才重启）
_devhost_proc: dict = {"proc": None, "story": None}


@app.post("/api/devhost/start")
def devhost_start(name: str) -> dict:
    """
    启动（或复用）插件的 vite dev server（--conn 拟真宿主模式）：
      等价 npm run debug:conn，但 STORY 用当前编辑的地图集：
      cross-env STORY=<name> CONN=1 vite --mode debug
    端口 3000。返回前端可 iframe 的 URL。
    """
    import subprocess
    import sys

    p = ensure_collection(name)

    # 已有进程且同地图集 → 复用
    if _devhost_proc["proc"] and _devhost_proc["proc"].poll() is None and _devhost_proc["story"] == name:
        return {"ok": True, "url": "http://localhost:3000/", "reused": True}

    # 旧进程还在但地图集变了 → 杀掉重启
    if _devhost_proc["proc"] and _devhost_proc["proc"].poll() is None:
        _devhost_proc["proc"].kill()
        _devhost_proc["proc"] = None

    vue_dir = PLUGIN_ROOT / "vue"
    if not (vue_dir / "vite.config.ts").exists():
        raise HTTPException(500, f"插件 vue 目录不存在: {vue_dir}")

    env = os.environ.copy()
    env["STORY"] = name          # 地图集名（workshops/.../map_design/<STORY>）
    env["CONN"] = "1"            # 拟真宿主模式（连后端 60002 + 读 workshops 源）
    env.setdefault("BROWSER", "none")  # 不自动开浏览器

    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    # ★ Windows: npx 是 npx.cmd（不是 .exe），Popen 直接找不到 → shell=True 走 cmd 解析
    proc = subprocess.Popen(
        "npx vite --mode debug --port 3000" if sys.platform == "win32" else ["npx", "vite", "--mode", "debug", "--port", "3000"],
        cwd=str(vue_dir),
        env=env,
        shell=(sys.platform == "win32"),
        creationflags=creationflags,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _devhost_proc["proc"] = proc
    _devhost_proc["story"] = name
    return {"ok": True, "url": "http://localhost:3000/", "reused": False, "pid": proc.pid}


@app.get("/api/devhost/status")
def devhost_status() -> dict:
    """dev server 健康状态（前端轮询等待启动完成）"""
    proc = _devhost_proc["proc"]
    alive = proc is not None and proc.poll() is None
    # vite 起来后 3000 端口可访问
    port_up = False
    if alive:
        import urllib.request
        try:
            urllib.request.urlopen("http://localhost:3000/", timeout=1)
            port_up = True
        except Exception:
            pass
    return {"alive": alive, "port_up": port_up, "story": _devhost_proc["story"]}


@app.post("/api/devhost/stop")
def devhost_stop() -> dict:
    proc = _devhost_proc["proc"]
    if proc and proc.poll() is None:
        proc.kill()
    _devhost_proc["proc"] = None
    _devhost_proc["story"] = None
    return {"ok": True}


# ───────────────────────── 预览（旧：静态 game.html，保留兼容） ─────────────────────────
@app.post("/api/collections/{name}/preview")
def deploy_preview(name: str, req: PreviewReq) -> dict:
    """
    把当前编辑的地图写到地图集的 maps/（已是保存行为），并生成预览说明。
    """
    p = ensure_collection(name)
    if "/" in req.map_name or "\\" in req.map_name or ".." in req.map_name:
        raise HTTPException(400, "invalid map name")
    map_file = safe_path(p / "maps", f"{req.map_name}.json")
    with open(map_file, "w", encoding="utf-8") as fp:
        json.dump(req.data, fp, ensure_ascii=False, indent=2)
    return {"ok": True, "map": req.map_name, "hint": "已写入 maps/，可在游戏中切换到该地图查看"}


@app.get("/api/plugin-ui/{file_path:path}")
def serve_plugin_ui(file_path: str):
    """
    serve 插件 ui/ 目录静态文件（game.html、images/ 等），供预览 iframe 使用。
    只读，不允许路径逃逸。
    """
    target = safe_path(PLUGIN_UI_DIR, file_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"not found: {file_path}")
    # 常见 MIME
    MIME = {
        ".html": "text/html", ".png": "image/png", ".json": "application/json",
        ".js": "text/javascript", ".css": "text/css", ".gif": "image/gif",
        ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
    }
    ext = target.suffix.lower()
    return FileResponse(target, media_type=MIME.get(ext, "application/octet-stream"))


# ───────────────────────── Tile Style Change（贴图替换） ─────────────────────────
# 素材集目录约定：RESOURCE_ROOT/<material_name>/compiled_tileset_32x32.{png,json}

@app.get("/api/tile-style/materials")
def list_materials() -> List[dict]:
    """列出素材库下所有素材集（含 compiled_tileset_32x32.png + .json 的目录）"""
    if not RESOURCE_ROOT.exists():
        return []
    out = []
    for entry in sorted(RESOURCE_ROOT.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        png = entry / "compiled_tileset_32x32.png"
        js = entry / "compiled_tileset_32x32.json"
        if png.exists() and js.exists():
            out.append({
                "name": entry.name,
                "tileset": "compiled_tileset_32x32",
                "png": f"{entry.name}/compiled_tileset_32x32.png",
                "json": f"{entry.name}/compiled_tileset_32x32.json",
            })
    return out


@app.get("/api/tile-style/materials/{name}/meta")
def get_material_meta(name: str):
    """返回素材集的 compiled_tileset_32x32.json（含 columns / tilewidth / tiles[]）"""
    p = safe_path(RESOURCE_ROOT, name)
    js = p / "compiled_tileset_32x32.json"
    if not js.exists():
        raise HTTPException(404, f"material json not found: {name}")
    with open(js, "r", encoding="utf-8") as fp:
        return json.load(fp)


@app.get("/api/tile-style/materials/{name}/tileset")
def get_material_tileset(name: str):
    """返回素材集的 compiled_tileset_32x32.png"""
    p = safe_path(RESOURCE_ROOT, name)
    png = p / "compiled_tileset_32x32.png"
    if not png.exists():
        raise HTTPException(404, f"material png not found: {name}")
    return FileResponse(png, media_type="image/png")


class OverrideReq(BaseModel):
    material: str
    tileId: int
    image_base64: str          # data URL 或裸 base64（32×32 透明 PNG）
    prompt: str = ""
    model: str = ""


@app.post("/api/tile-style/override")
def save_override(req: OverrideReq) -> dict:
    """
    把新生成的 32×32 透明 PNG 贴回 compiled_tileset_32x32.png 对应坐标，
    并写 styleOverrides 到 json（只存引用路径，不塞 base64）。
    """
    p = safe_path(RESOURCE_ROOT, req.material)
    png = p / "compiled_tileset_32x32.png"
    js = p / "compiled_tileset_32x32.json"
    if not png.exists() or not js.exists():
        raise HTTPException(404, "material not found")

    # 解析 base64
    b64 = req.image_base64
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(b64)
        new_tile = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    except Exception as e:
        raise HTTPException(400, f"图片解析失败: {e}")

    with open(js, "r", encoding="utf-8") as fp:
        meta = json.load(fp)
    cols = int(meta.get("columns", meta.get("imagewidth", 3840) // 32))
    tw = int(meta.get("tilewidth", 32))
    th = int(meta.get("tileheight", 32))

    col = req.tileId % cols
    row = req.tileId // cols

    # 备份原 png（首次覆盖时）
    bak_dir = p / "bak"
    if not (bak_dir / "compiled_tileset_32x32.png.bak").exists():
        bak_dir.mkdir(exist_ok=True)
        shutil.copy2(png, bak_dir / "compiled_tileset_32x32.png.bak")

    # 贴回图集
    base = Image.open(png).convert("RGBA")
    resized = new_tile.resize((tw, th), Image.LANCZOS)
    base.paste(resized, (col * tw, row * th), resized)
    base.save(png)

    # 落盘单格覆盖图 + 更新 json
    overrides_dir = p / "overrides"
    overrides_dir.mkdir(exist_ok=True)
    tile_path = overrides_dir / f"{req.tileId}.png"
    new_tile.save(tile_path)

    meta.setdefault("styleOverrides", {})[str(req.tileId)] = {
        "overridePng": f"overrides/{req.tileId}.png",
        "prompt": req.prompt,
        "model": req.model,
        "createdAt": datetime.datetime.utcnow().isoformat() + "Z",
    }
    with open(js, "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)

    return {
        "ok": True,
        "tileId": req.tileId,
        "col": col,
        "row": row,
        "overridePng": str(tile_path),
    }


# ───────────────────────── AI 模型配置（复刻 app t_config + 槽位绑定） ─────────────────────────
# 配置存本地 SQLite（ai_store.py），接口契约对齐 app 的 /setting/* 与 /other/testImage。
import ai_store
import ai_clients

# 厂商可选项（镜像 app getAiModelList）
MANUFACTURERS = ["openai", "other", "volcengine", "doubao", "gemini", "siliconflow",
                 "deepseek", "qwen", "zhipu", "anthropic", "lmstudio", "minimax"]
MODEL_TYPES = ["text", "image", "voice", "video"]


class AiModelReq(BaseModel):
    type: str                                   # text | image | voice | video
    manufacturer: str
    model: str = ""
    baseUrl: str = ""
    apiKey: str = ""
    modelType: str = ""
    inputPricePer1M: Optional[float] = None
    outputPricePer1M: Optional[float] = None
    cacheReadPricePer1M: Optional[float] = None
    currency: str = "CNY"
    reasoningEffort: Optional[str] = None
    temperature: Optional[float] = None
    topP: Optional[float] = None
    remark: str = ""


class AiBindingReq(BaseModel):
    slot: str
    configId: int = None


class AiTestReq(BaseModel):
    type: str = "image"
    manufacturer: str = "openai"
    model: str = ""
    baseUrl: str = ""
    apiKey: str = ""
    prompt: str = "a red apple on white background"
    size: str = "1K"
    ref_images: List[str] = []


@app.get("/api/ai/models")
def api_list_models(type: str = None):
    return ai_store.list_models(type)


@app.post("/api/ai/models")
def api_add_model(req: AiModelReq):
    if req.type not in MODEL_TYPES:
        raise HTTPException(400, f"type 必须为 {MODEL_TYPES}")
    if not req.manufacturer:
        raise HTTPException(400, "manufacturer 必填")
    data = req.model_dump()
    new_id = ai_store.add_model(data)
    return {"id": new_id, **ai_store.get_model(new_id)}


@app.put("/api/ai/models/{model_id}")
def api_update_model(model_id: int, req: AiModelReq):
    if not ai_store.get_model(model_id):
        raise HTTPException(404, "model not found")
    ai_store.update_model(model_id, req.model_dump())
    return ai_store.get_model(model_id)


@app.delete("/api/ai/models/{model_id}")
def api_delete_model(model_id: int):
    if not ai_store.get_model(model_id):
        raise HTTPException(404, "model not found")
    ai_store.delete_model(model_id)
    return {"ok": True}


@app.get("/api/ai/bindings")
def api_get_bindings():
    return {"bindings": ai_store.get_bindings(), "slots": ai_store.KNOWN_SLOTS}


@app.post("/api/ai/bindings")
def api_bind_slot(req: AiBindingReq):
    bindings = ai_store.bind_slot(req.slot, req.configId)
    return {"bindings": bindings}


@app.post("/api/ai/test")
def api_test_model(req: AiTestReq):
    """免鉴权连通性测试（镜像 app /other/testImage、/other/testAI）。"""
    cfg = req.model_dump()
    try:
        if req.type == "text":
            out = ai_clients.call_text(
                cfg, messages=[{"role": "user", "content": req.prompt}],
                reasoning_effort=req.reasoning_effort,
            )
            return {"ok": True, "type": "text", "sample": out[:200]}
        else:
            b64uri = ai_clients.call_image(
                cfg, prompt=req.prompt, ref_images=req.ref_images, size=req.size,
            )
            return {"ok": True, "type": "image", "dataUri": b64uri[:80] + "…"}
    except Exception as e:
        raise HTTPException(502, f"调用失败: {e}")


# ───────────────────────── Tile Style Change（贴图替换） ─────────────────────────
import sys
sys.path.insert(0, str(Path(__file__).parent))
from tile_style_change.routes import router as tile_style_router
app.include_router(tile_style_router)


# ───────────────────────── 健康检查 ─────────────────────────
@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "map_root": str(MAP_ROOT),
        "map_root_exists": MAP_ROOT.exists(),
    }


if __name__ == "__main__":
    import uvicorn
    print(f"[map-editor] TFS_MAP_ROOT = {MAP_ROOT}")
    print(f"[map-editor] exists: {MAP_ROOT.exists()}")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
