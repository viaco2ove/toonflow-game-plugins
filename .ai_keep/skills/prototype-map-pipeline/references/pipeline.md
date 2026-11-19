# pipeline.md — 落地通道与 API 细节

## 后端服务

- 健康检查：`GET http://127.0.0.1:8000/api/health`
- 地图集根：`MAP_ROOT = workshops/toonflow-field-survival/map_design/`（可用环境变量 `TFS_MAP_ROOT` 覆盖）
- 前端：`http://127.0.0.1:5176/`，Vite 端口 5176，代理/直连后端 8000。

## 地图读写 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/collections` | 列出 map_design/ 下所有地图集 |
| GET | `/api/collections/{name}` | 地图集元数据 + 地图列表 |
| GET | `/api/collections/{name}/maps/{map_name}` | 读取 Tiled JSON |
| POST | `/api/collections/{name}/maps/{map_name}` | 保存地图；body = 完整 Tiled JSON；自动备份到 `maps/bak/<map>.json.bak` |
| POST | `/api/collections/{name}/maps` | 新建空白地图 |
| DELETE | `/api/collections/{name}/maps/{map_name}` | 删图（移 bak） |

- `{name}` 是中文地图集名，URL 传输需 `encodeURIComponent`。
- 保存接口 body 必须是**完整 JSON**（不是 diff）；直接把 GET 拿到的 dict 改完回传即可。

## 图集贴图 API（override）

```
POST /api/tile-style/override
Content-Type: application/json
{
  "material": "<collection 名>",
  "tileId": <tile index, 0-based>,
  "image_base64": "data:image/png;base64,... 或裸 base64",
  "prompt": "可选，记录来源",
  "model": "可选"
}
```

行为：
- 图被 resize 到 32×32，`alpha_composite` 贴到图集对应格（整格替换，不做 mask 混合）。
- 首次覆盖整图集备份到 `bak/`；该格原始像素存 `overrides/originals/<tileId>.png`。
- 覆盖图存 `overrides/<tileId>.png`，引用写进 `compiled_dawnlike.json` 的 `styleOverrides`。
- 重置：`POST /api/tile-style/reset`，body `{material, tileId}`，从 originals 还原。

> 注意：`tileId` 是 **index**；地图 JSON 里的 **gid = index + 1**。换算别搞反。

## 数据结构速查

```
map.json
├─ width/height (格)  tilewidth/tileheight = 32
├─ layers[]
│   ├─ type=tilelayer  data[] 扁平 gid，0=空；L1 地面 / L2 墙树家具 / L3 装饰
│   └─ type=objectgroup objects[] = NPC/门/触发器（坐标存像素 = 格*32）
├─ tilesets[] firstgid=1 → index = gid - 1
└─ eventZones[] {name,x,y,rx,ry}
```

图集：`images/compiled_tileset_32x32.png`，120 列，32px/tile，tilecount 13080。

## 落地校验清单（保存前必过）

- [ ] JSON 合法；每层 `len(data) == width*height`
- [ ] 所有非零 gid < tilecount（13080）
- [ ] Actors 数量、事件区数量与改前一致（除非有意增删）
- [ ] 图集尺寸未变（3840×3488）；新 tile 非空；旧关键 tile 未被覆盖
- [ ] 备份存在：`maps/bak/`、`images/bak/`
- [ ] 编辑器 5176 刷新后，改动落在预期位置；局部放大无悬空/穿帮/混色

## 落地方式选择

| 场景 | 通道 |
|---|---|
| 只换地面/墙/树的 gid，不动贴图 | 改 JSON（POST maps 或写 raw） |
| 现有 tile 形状对、配色不对 | `tile-style-change` 换色 |
| 图集缺该形状，能用代码画出来 | `make_tiles.py` 程序化补 tile |
| 已有一张 32×32 小图要贴进某格 | override API |
| 大插画想当贴图 | 不允许直接贴；先缩成 32×32 程序化重绘或选现有 tile |
