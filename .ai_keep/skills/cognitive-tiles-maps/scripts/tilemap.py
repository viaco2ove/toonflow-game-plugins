"""Shared helpers for reading Tiled JSON maps + dawnlike tilesets in toonflow projects.

Conventions this project relies on (verified against
workshops/toonflow-field-survival/map_design/*/maps/*.json):
  - Map JSON: Tiled format. `layers` = N * tilelayer (each has flat `data` list of gid,
    gid 0 = empty) followed by one or more *objectgroup layers (Actors etc).
  - Gid -> tileset tile index = gid - firstgid (firstgid is 1 for dawnlike).
  - Tileset atlas: columns x rows of 32x32 cells, margin=0, spacing=0.
    tile index -> (grid_x, grid_y) = (index % columns, index // columns).
  - The atlas descriptor `images/compiled_tileset_32x32.json` lists ONLY non-empty
    tiles (7246 of 13080; the rest are the 'empty' category), each with properties:
    category / grid_x / grid_y / avg_color / dominant_hue / (optional) blocked.
  - The runtime atlas for a map set is `<mapset>/images/compiled_tileset_32x32.png`;
    `compiled_tileset_32x32.original.png` next to it is the untouched master.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "PIL (Pillow) is required. Use a python that has it, e.g.\n"
        "  C:/Users/viaco/workbuddy-ai/binaries/python/versions/3.13.12/python.exe"
    ) from exc


# --------------------------------------------------------------------------- #
# generic helpers
# --------------------------------------------------------------------------- #
def load_json(path: Path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def find_font(size: int = 12):
    for cand in (
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(cand, size)
        except Exception:
            continue
    return ImageFont.load_default()


def hex_to_rgb(value: str):
    value = (value or "").lstrip("#")
    if len(value) != 6:
        return None
    try:
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def mapset_dir_for(map_json: Path) -> Path:
    """<mapset>/maps/xxx.json  ->  <mapset>"""
    return Path(map_json).resolve().parent.parent


def project_root_for(path: Path) -> Path:
    """Walk up from `path` until a dir containing `workbuddy-ai` is found.

    Falls back to 4 levels up (workshops/<story>/map_design/<mapset> -> project root).
    """
    p = Path(path).resolve()
    if p.is_file():
        p = p.parent
    for cand in [p, *p.parents]:
        if (cand / "workbuddy-ai").is_dir():
            return cand
        if (cand / "workshops").is_dir() and (cand / "plugins").is_dir():
            return cand
    # fallback: mapset dir is <root>/workshops/<story>/map_design/<mapset>
    return p


def default_out_dir(path: Path, name: str) -> Path:
    return project_root_for(path) / "workbuddy-ai" / "cognition" / name


def resolve_tileset(map_json: Path, prefer: str | None = None) -> tuple[Path, Path | None]:
    """Return (atlas png, descriptor json) for a map json.

    Prefers the live runtime atlas (`images/compiled_tileset_32x32.png`) because that
    is what the game actually renders. `compiled_tileset_32x32.original.png` is the
    untouched master and is only used when the live one is missing.
    """
    base = mapset_dir_for(map_json)
    imgs = base / "images"
    if prefer:
        cand = Path(prefer)
        if cand.is_absolute() and cand.exists():
            png, desc = cand, cand.with_suffix(".json")
            if not desc.exists():
                desc = imgs / "compiled_tileset_32x32.json"
            return png, desc if desc.exists() else None
    live = imgs / "compiled_tileset_32x32.png"
    if live.exists():
        desc = imgs / "compiled_tileset_32x32.json"
        return live, desc if desc.exists() else None
    for name in ("compiled_tileset_32x32.original.png", "compiled_tileset_32x32.original.png"):
        cand = imgs / name
        if cand.exists():
            desc = imgs / "compiled_tileset_32x32.json"
            return cand, desc if desc.exists() else None
    raise SystemExit(f"no tileset png found under {imgs}")


# --------------------------------------------------------------------------- #
# tileset
# --------------------------------------------------------------------------- #
@dataclass
class TileInfo:
    id: int
    category: str = "unknown"
    avg_color: str = ""
    dominant_hue: str = ""
    blocked: bool = False
    grid_x: int = 0
    grid_y: int = 0

    @property
    def rgb(self):
        return hex_to_rgb(self.avg_color)


@dataclass
class TileSet:
    png_path: Path
    columns: int = 120
    tile_size: int = 32
    tile_count: int = 0
    image_width: int = 0
    image_height: int = 0
    desc_path: Path | None = None
    tiles: dict = field(default_factory=dict)
    _image: Image.Image | None = None
    _empty: set = field(default_factory=set)
    _pixel_cache: dict = field(default_factory=dict)

    @classmethod
    def load(cls, png_path: Path, desc_path: Path | None = None) -> "TileSet":
        png_path = Path(png_path)
        if not png_path.exists():
            raise SystemExit(f"tileset image not found: {png_path}")
        if desc_path is None:
            for cand in (
                png_path.with_suffix(".json"),
                png_path.parent / "compiled_tileset_32x32.json",
            ):
                if cand.exists() and cand != png_path:
                    desc_path = cand
                    break
        ts = cls(png_path=png_path, desc_path=desc_path)
        with Image.open(png_path) as im:
            ts.image_width, ts.image_height = im.size
        if desc_path and desc_path.exists():
            desc = load_json(desc_path)
            ts.columns = desc.get("columns") or 120
            ts.tile_size = desc.get("tilewidth") or 32
            ts.tile_count = desc.get("tilecount") or 0
            for entry in desc.get("tiles", []):
                props = {p["name"]: p.get("value") for p in entry.get("properties", [])}
                ts.tiles[entry["id"]] = TileInfo(
                    id=entry["id"],
                    category=props.get("category", "unknown"),
                    avg_color=props.get("avg_color", "") or "",
                    dominant_hue=props.get("dominant_hue", "") or "",
                    blocked=bool(props.get("blocked", False)),
                    grid_x=props.get("grid_x", entry["id"] % ts.columns) or 0,
                    grid_y=props.get("grid_y", entry["id"] // ts.columns) or 0,
                )
        else:
            ts.columns = max(1, ts.image_width // ts.tile_size)
        ts._empty = {tid for tid in range(ts.tile_count) if tid not in ts.tiles}
        return ts

    @property
    def image(self) -> Image.Image:
        if self._image is None:
            self._image = Image.open(self.png_path).convert("RGBA")
        return self._image

    def rows(self) -> int:
        return (self.image_height + self.tile_size - 1) // self.tile_size

    def cell_pos(self, tile_id: int):
        info = self.tiles.get(tile_id)
        if info is not None:
            return info.grid_x * self.tile_size, info.grid_y * self.tile_size
        return (tile_id % self.columns) * self.tile_size, (tile_id // self.columns) * self.tile_size

    def crop(self, tile_id: int) -> Image.Image:
        x, y = self.cell_pos(tile_id)
        x = max(0, min(x, self.image_width - self.tile_size))
        y = max(0, min(y, self.image_height - self.tile_size))
        return self.image.crop((x, y, x + self.tile_size, y + self.tile_size))

    def is_empty(self, tile_id: int) -> bool:
        return tile_id in self._empty

    def info(self, tile_id: int) -> TileInfo:
        return self.tiles.get(tile_id) or TileInfo(id=tile_id)

    def categories(self) -> dict:
        out: dict = {}
        for tid, info in self.tiles.items():
            out.setdefault(info.category, []).append(tid)
        for key in out:
            out[key].sort()
        return dict(sorted(out.items(), key=lambda kv: -len(kv[1])))

    def used_category_counts(self, tile_ids) -> dict:
        counter = Counter()
        for tid in tile_ids:
            counter[self.info(tid).category] += 1
        return dict(counter.most_common())

    def avg_pixel(self, tile_id: int):
        """Average RGB of a tile's opaque pixels (cached).

        The tileset `category` labels are unreliable (L1 grass is tagged
        `building_wall`), so pixel content is the ground truth for classifying
        what a cell actually looks like.
        """
        if tile_id in self._pixel_cache:
            return self._pixel_cache[tile_id]
        try:
            tile = self.crop(tile_id).convert("RGB")
        except Exception:
            self._pixel_cache[tile_id] = None
            return None
        data = list(tile.getdata())
        if not data:
            self._pixel_cache[tile_id] = None
            return None
        n = len(data)
        avg = tuple(sum(c[i] for c in data) / n for i in range(3))
        self._pixel_cache[tile_id] = avg
        return avg


# --------------------------------------------------------------------------- #
# map
# --------------------------------------------------------------------------- #
@dataclass
class TileLayer:
    name: str
    width: int
    height: int
    data: list
    index: int


@dataclass
class MapFile:
    path: Path
    raw: dict
    tile_layers: list = field(default_factory=list)
    object_layers: list = field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> "MapFile":
        path = Path(path)
        if not path.exists():
            raise SystemExit(f"map json not found: {path}")
        raw = load_json(path)
        mf = cls(path=path, raw=raw)
        for idx, layer in enumerate(raw.get("layers", [])):
            if layer.get("type") == "tilelayer":
                mf.tile_layers.append(
                    TileLayer(
                        name=layer.get("name") or f"layer{idx}",
                        width=layer.get("width") or raw.get("width", 0),
                        height=layer.get("height") or raw.get("height", 0),
                        data=list(layer.get("data") or []),
                        index=idx,
                    )
                )
            elif layer.get("type") == "objectgroup":
                mf.object_layers.append(layer)
        return mf

    @property
    def width(self) -> int:
        return self.raw.get("width") or (self.tile_layers[0].width if self.tile_layers else 0)

    @property
    def height(self) -> int:
        return self.raw.get("height") or (self.tile_layers[0].height if self.tile_layers else 0)

    @property
    def name(self) -> str:
        return self.raw.get("name") or ""

    @property
    def theme(self) -> str:
        return self.raw.get("theme") or ""

    @property
    def narration(self) -> str:
        return self.raw.get("narration") or ""

    @property
    def notes(self) -> str:
        return self.raw.get("notes") or ""

    def event_zones(self) -> list:
        return self.raw.get("eventZones") or []

    def all_gids(self) -> set:
        out = set()
        for layer in self.tile_layers:
            out.update(g for g in layer.data if g)
        return out

    def objects(self) -> list:
        out = []
        for layer in self.object_layers:
            for obj in layer.get("objects", []):
                props = {p["name"]: p.get("value") for p in obj.get("properties", [])}
                out.append({
                    "id": obj.get("id"),
                    "name": obj.get("name", ""),
                    "gid": obj.get("gid"),
                    "type": obj.get("type", ""),
                    "x": obj.get("x", 0),
                    "y": obj.get("y", 0),
                    "width": obj.get("width", 0),
                    "height": obj.get("height", 0),
                    "entity_type": props.get("entity_type", ""),
                    "props": props,
                })
        return out

    def object_cells(self, tile_size: int = 32):
        """Yield (obj, cell_x, cell_y) for tile-anchored objects (gid set)."""
        for obj in self.objects():
            if not obj.get("gid"):
                continue
            cx = int(obj["x"] // tile_size)
            cy = int(obj["y"] // tile_size)
            yield obj, cx, cy

    def commit_layers(self) -> int:
        """Write the edited tile-layer data back into the raw dict.

        `load()` copies each layer's `data` list, so editing `tile_layers`
        does NOT change `raw`. Serialising `raw` without this call silently
        writes the ORIGINAL data — a real bug that produced "no visible change"
        once. Always call this before saving.

        Returns the number of layers written back.
        """
        raw_tiles = [l for l in self.raw.get("layers", []) if l.get("type") == "tilelayer"]
        written = 0
        for layer in self.tile_layers:
            for raw_layer in raw_tiles:
                if raw_layer.get("name") == layer.name:
                    raw_layer["data"] = layer.data
                    written += 1
                    break
        return written
