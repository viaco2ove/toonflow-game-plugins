# map-editor.md — map-editor 详解

源码位置：`src/tools/toonflow-field-survival/map-editor/`

图形化瓦片地图编辑器。**用于精细拖拽**，批量规则性改动仍建议走脚本。

## 架构

```
map-editor/
├─ backend/     FastAPI（端口 8000）
│  ├─ server.py 所有 API
│  └─ ...
└─ frontend/    Vue3 + Vite（端口 5176）
```

## 启动

```sh
cd src/tools/toonflow-field-survival/map-editor

# 后端
cd backend && python server.py local

# 前端（另开一个终端）
cd ../frontend && npm run dev
```

后端 `server.py local` 的 `local` 参数表示本地模式（读工作区目录，不连数据库）。

## 核心 API

### 地图集与地图

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/collections` | 列出所有地图集 |
| GET | `/api/collections/{name}` | 地图集详情 |
| POST | `/api/collections` | 新建地图集 |
| DELETE | `/api/collections/{name}` | 删除地图集 |
| GET | `/api/collections/{name}/maps/{map}` | 读地图 Tiled JSON |
| POST | `/api/collections/{name}/maps/{map}` | **保存地图** |
| POST | `/api/collections/{name}/maps` | 新建空白地图 |
| DELETE | `/api/collections/{name}/maps/{map}` | 删除（移到 `maps/bak/*.deleted`） |

### 资源

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/collections/{name}/tileset` | 取图集 PNG |
| GET | `/api/collections/{name}/dawnlike` | 取 tile-style 索引（对象/系列） |
| GET | `/api/collections/{name}/data-sheets` | 取数据表 |
| POST | `/api/collections/{name}/preview` | 写入地图 + 返回预览提示 |

### 换皮（tile-style）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tile-style/materials` | 列出可换皮的材质系列 |
| GET | `/api/tile-style/materials/{name}/meta` | 该系列元信息 |
| GET | `/api/tile-style/materials/{name}/tileset` | 该系列瓦片图集 |
| POST | `/api/tile-style/override` | **覆盖某格贴图**（base64 PNG） |
| POST | `/api/tile-style/reset` | 重置某格覆盖 |

### 其他

`/api/devhost/start|status|stop`、`/api/ai/models`、`/api/ai/bindings`、`/api/health`

## 坑（重要）

### 1. `save_map` 的备份是**固定名**，会覆盖

```python
shutil.copy2(map_file, bak_dir / f"{map_name}.json.bak")
```

每次保存都写同一个 `mulberryTown.json.bak`——**只保留最近一次**。
上一轮的备份如果也在那里，第二次保存就没了。

**对策**：动手前先自己复制一份带时间戳的备份，或把 `maps/bak/` 里已有的 `.bak` 改名。

### 2. `tile-style/override` 会改**图集本体**

它把新 PNG 贴回 `compiled_tileset_32x32.png` 的对应坐标，并在
`compiled_dawnlike.json` 写 `styleOverrides`（只存引用路径，不塞 base64）。

备份行为：
- `bak/compiled_tileset_32x32.png.bak` —— **首次覆盖时才建**（整图集备份）
- `overrides/originals/` —— 每格首次覆盖前的原始像素（用于单格重置）

**对策**：改图集前确认 `bak/` 里已有整体备份；否则先手动备份。

### 3. 覆盖后 gid 不变，贴图变了

`override` 是"在原位置换皮"，**不是新增瓦片**。
所以 `styleOverrides` 只影响渲染，地图 JSON 的 gid 不用动。

想**新增**瓦片（比如生成一个图集里没有的黑板），用 `make_tiles.py` 而不是 override。

### 4. 路径参数不能含分隔符

`get_map` / `save_map` 都显式拒绝含 `/`、`\`、`..` 的地图名。
`map_name` 不带 `.json` 后缀。

## 用 API 代替点 UI

批量改动时直接调 REST 比点 UI 快得多，也更可控：

```sh
curl -s http://localhost:8000/api/collections | python -m json.tool
curl -s http://localhost:8000/api/collections/黑塔：从超忆症开始成神/maps/mulberryTown.json -o /tmp/map.json
# 改完写回（会自动备份到 maps/bak/）
curl -s -X POST http://localhost:8000/api/collections/黑塔：从超忆症开始成神/maps/mulberryTown.json \
     -H "Content-Type: application/json" -d @/tmp/map.json
```

## 与脚本的分工

| 场景 | 用什么 |
|---|---|
| 改 200+ 格的规则性布局（路面、围墙、房间） | **脚本**（`elements.py` 定位 + 自写改造脚本） |
| 精细拖单个物件、调家具位置 | map-editor UI |
| 换某格贴图外观（配色） | `tile-style/override` 或 `tile-style-change` 技能 |
| 新增图集里没有的素材 | `make_tiles.py`（程序化生成） |
| 改完验证 | **一律** `inspect_map.py` 渲染 + 用 Read 看图 |

> 铁律 #0：无论用 UI 还是脚本改完，**都要渲染截图亲眼看**。
> 上一轮脚本输出「砖墙 32 格」「旗杆(34,37..35)」全对，
> 渲染出来是砖块乱飞、旗杆插在草地上。