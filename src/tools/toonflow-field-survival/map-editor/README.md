# 地图编辑器 v0.3 — Python (FastAPI) + Vue 3

> 日期：2026-10-10
> 路径：`src/tools/toonflow-field-survival/map-editor/`

## 架构

```
┌─────────────────────────────────┐    HTTP/JSON    ┌─────────────────────────┐
│  Frontend (Vue 3 + Vite)        │ ──────────────► │  Backend (FastAPI)      │
│  端口 5176                       │ ◄────────────── │  端口 8000              │
│  src/App.vue (Canvas + 面板)     │                 │  server.py              │
│  src/api.js (REST 客户端)        │                 │  文件读写（地图集目录） │
└─────────────────────────────────┘                 └─────────────────────────┘
                                                              │
                                                              ▼
                                            workshops/.../map_design/<地图集>/
                                            ├── maps/*.json
                                            ├── images/compiled_tileset_32x32.png
                                            └── compiled_dawnlike.json
```

## 目录结构

```
src/tools/toonflow-field-survival/map-editor/
├── backend/                    # Python FastAPI
│   ├── requirements.txt        # fastapi + uvicorn + pydantic
│   └── server.py               # REST API
├── frontend/                   # Vue 3 + Vite
│   ├── package.json
│   ├── vite.config.js          # 端口 5176
│   ├── index.html
│   └── src/
│       ├── main.js
│       ├── style.css           # 深色主题
│       ├── api.js              # 后端 API 客户端
│       └── App.vue             # 编辑器主组件
├── start.bat                   # 一键启动（双击）
├── README.md                   # 本文件
└── SPEC.md                     # API + 功能规格
```

## 启动

### 方式 1：一键启动（推荐）
双击 `start.bat`，自动：
1. 启动后端（端口 8000）
2. 启动前端 dev server（端口 5176）
3. 浏览器自动打开编辑器

### 方式 2：手动启动
```bash
# 终端 1：启动后端
cd src/tools/toonflow-field-survival/map-editor/backend
pip install -r requirements.txt
python server.py

# 终端 2：启动前端
cd src/tools/toonflow-field-survival/map-editor/frontend
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:5176/

## REST API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/collections` | 列出所有地图集 |
| GET | `/api/collections/{name}` | 地图集详情（地图列表） |
| POST | `/api/collections` | 新建地图集 |
| DELETE | `/api/collections/{name}` | 删除地图集 |
| GET | `/api/collections/{name}/maps/{map}` | 读取地图 JSON |
| POST | `/api/collections/{name}/maps/{map}` | 保存地图 JSON（自动备份） |
| POST | `/api/collections/{name}/maps` | 创建新地图（空白模板） |
| DELETE | `/api/collections/{name}/maps/{map}` | 删除地图（移到 bak/） |
| GET | `/api/collections/{name}/tileset` | 瓦片图集（PNG） |
| GET | `/api/collections/{name}/dawnlike` | 编译后的 tile 属性表 |

## 关键设计

### 1. 地图集根目录
默认 `workshops/toonflow-field-survival/map_design/`，可通过环境变量 `TFS_MAP_ROOT` 覆盖。

### 2. 路径安全
后端拒绝 `..` 和路径分隔符注入，每个路径拼接都用 `safe_path()` 校验在 base 目录内。

### 3. 自动备份
保存地图时，旧版本自动复制到 `maps/bak/<name>.json.bak`。
删除地图时，文件移到 `maps/bak/<name>.json.deleted`（而非直接删除）。

### 4. dawnlike 编译
后端 `GET /dawnlike` 端点将原始 Tiled tileset JSON 编译成 `{tile_id: {category, blocked, blocks_vision, ...}}`：
- `description` 字段映射到 `category`（ground/wall/water/road/decor/farm）
- 编译结果缓存到客户端（dawnlike.value），切换地图集时重新加载

### 5. 地图级碰撞掩码（编辑器可逐格编辑）

障碍判定分两层，运行时 `collision.ts buildWalkGrid()` 做叠加：

| 字段（地图 JSON 顶层） | 语义 | 优先级 |
|------|------|------|
| `blockedCells: number[]` | 手工强制障碍（row-major 0/1，长度 cols×rows），与图集 blocked 标志 OR 叠加 | 中 |
| `visionCells: number[]` | 手工挡视线掩码 | 中 |
| `walkableCells: number[]` | 强制可走白名单；标记格一律可通行、不挡视线，图集标志与上面两个掩码都压不过它 | 最高 |
| `collision.ignoreTileFlags: bool` | 为真时忽略图集自带 blocked/vision 标志，只信本图掩码 | — |

编辑器工具栏 🚧 障碍工具（快捷键 X）：`1` 设障碍 / `2` 清除标记 / `3` 强制可走 / `4` 挡视线，Shift+左键落笔、按住拖动连刷；右侧「碰撞 / 障碍」面板可切换忽略图集标志、从图集生成掩码、清空掩码。床格（bed）不在 walkableCells 覆写范围内。视线是独立标志，可与障碍共存；强制可走格会同时清掉障碍与视线标记。

### 5. 资源跨域
- tileset 通过 FastAPI 直接 serve，`<img>` 标签的 crossOrigin 已设置
- dawnlike 返回 application/json，无跨域问题（CORS 已在后端开放）

## 已知问题

1. **dawnlike 编译的 description → category 映射不完整**：仅基于已知的 description 字符串匹配，新瓦片需在 `server.py:DESC_TO_CAT` 中补充。
2. **瓦片图集跨域**：FastAPI 默认 allow_origins=["*"]，生产环境需收紧。
3. **tileset 跨域问题**：当前 tileset 作为二进制返回，`<img crossOrigin="anonymous">` 即可，但若浏览器缓存导致 canvas 被污染，drawImage 会失败——刷新页面即可。
