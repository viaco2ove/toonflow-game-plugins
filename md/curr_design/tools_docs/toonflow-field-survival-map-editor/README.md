# 地图编辑器设计方案 v2

> 日期：2026-10-10（修订版）
> 目标：加载/新建**地图集**（故事文件夹），管理其中多张地图

---
## 技术栈
Python (FastAPI) + Vue 3。
## ai 协助
先直接把整个编辑器代码地址给到workbuddy , claude code cli
效果不太好再考虑编写mcp
## 一、核心概念

### 1.1 地图集结构

一个"地图集"就是一个故事文件夹，例如：
`workshops/toonflow-field-survival/map_design/通天传授-收徒系统/`

```
地图集名/                           ← 用户在编辑器中命名/选择
├── compiled_dawnlike.json          # tile 碰撞属性（只读）
├── entity_types.json               # 实体类型定义（只读）
├── favicon.png                     # 图标（可选）
├── images/
│   ├── compiled_tileset_32x32.png  # 瓦片图集（编辑器渲染用）
│   ├── player_sprites/
│   ├── inventory_sprites/
│   └── ...
├── maps/
│   ├── first.map.json              # 起始地图声明 { start_map: "Mulberry Town" }
│   ├── mulberryTown.json           # 地图 1（Tiled JSON）
│   ├── mulberryForest.json         # 地图 2
│   └── ...其他地图
├── story.json                      # 元数据 { storyName, sessionId, worldId }
└── test_data/
    └── test_state.json
```

### 1.2 与旧版的关键区别

| 旧版（单文件） | 新版（地图集） |
|---------------|---------------|
| 打开一个 .json | 打开整个文件夹 |
| 无新建功能 | 新建地图集 → 自动生成完整目录结构 |
| 手动下载 JSON 再复制 | 直接写入文件系统（File System Access API） |
| 无地图列表 | 左侧显示地图列表，可切换 |

---

## 二、编辑器目标

### 2.1 核心功能

1. **打开地图集**：用 `showDirectoryPicker()` 打开 `workshops/...` 下的任意地图集文件夹
2. **新建地图集**：输入名称 → 在 `workshops/toonflow-field-survival/map_design/` 下创建完整目录
3. **地图列表**：左侧显示当前地图集所有地图，切换地图
4. **编辑地图**：瓦片绘制、对象放置/属性编辑（与旧版一致）
5. **保存**：直接写回文件系统（不下载再手动复制）
6. **预览**：在 game.html 中预览当前地图

### 2.2 新建地图集自动生成内容

```
新地图集名/
├── compiled_dawnlike.json     ← 复制 base/ 的版本
├── entity_types.json          ← 复制 base/ 的版本
├── favicon.png                ← 复制 base/ 的版本
├── images/                    ← 复制全部图片资源
│   ├── compiled_tileset_32x32.png
│   └── ...完整 images/ 目录
├── maps/
│   ├── first.map.json         ← 模板 { start_map: "新地图" }
│   └── 新地图.json            ← 一张空白 20×15 地图（Tiled JSON）
└── story.json                 ← { storyName: "新地图集名" }
```

---

## 三、技术方案

### 3.1 文件系统访问

**File System Access API**（Chrome/Edge 支持）：
```javascript
// 打开地图集目录
const dirHandle = await window.showDirectoryPicker();
// 读取文件
const fileHandle = await dirHandle.getFileHandle("maps/town.json");
const file = await fileHandle.getFile();
const text = await file.text();
// 写入文件
const writable = await fileHandle.createWritable();
await writable.write(jsonString);
await writable.close();
```

**不支持时的降级**：
- Chromium 不支持 → alert 提示使用 Chrome/Edge
- 实际上绝大多数目标用户都是 Windows Chrome 用户，忽略降级

### 3.2 文件结构

```
src/tools/toonflow-field-survival/map-editor/
├── index.html          # 单文件编辑器（内联 CSS/JS）
├── SPEC.md             # 实现规格
└── 运行时资源（通过 maps/ 目录加载，无本地副本）
```

### 3.3 数据结构

```typescript
interface MapCollection {
  dirHandle: FileSystemDirectoryHandle;  // 地图集根目录句柄
  name: string;                          // 地图集名称
  maps: MapEntry[];                      // 地图列表
  tilesetImg: HTMLImageElement | null;   // 当前 tileset
  dawnlike: DawnlikeData | null;         // 碰撞表
}

interface MapEntry {
  name: string;           // 文件名不含 .json（"mulberryTown"）
  displayName: string;    // 显示名（"Mulberry Town"）
  handle: FileSystemFileHandle;
}
```

---

## 四、界面布局 v2

```
┌──────────────────────────────────────────────────────────────────────┐
│  [📂 打开地图集] [📁 新建地图集]  地图集：通天传授-收徒系统  [💾 保存] [🎮 预览] │  ← 顶部工具栏
├────────────────┬───────────────────────────────────────┬────────────┤
│  📋 地图列表   │                                       │  属性面板  │
│  ──────────── │                                       │  ────────  │
│  mulberryTown │           Canvas 编辑区                │ 地图信息   │
│  mulberryForest│   （可缩放/拖拽，网格线）              │ 尺寸：43×56│
│  mulberryGraveyard│ ★ = NPC  ◆ = 野怪  ↗ = 出口      │            │
│  mulberryDungeon1│                                      │ ───────── │
│  + 添加地图    │   碰撞遮罩（红色半透明）               │ 对象属性   │
│                │                                       │ [选中...]  │
│                │                                       │            │
├────────────────┴───────────────────────────────────────┴────────────┤
│  图块调色板：[草地][泥土][石头][水面][木地板][...] ← brushTileId     │
└──────────────────────────────────────────────────────────────────────┘
```

**左侧地图列表**（220px）：
- 当前地图集所有 `.json` 文件（排除 `first.map.json`）
- 当前选中地图高亮
- `+ 添加地图` 按钮：输入地图名 → 生成空白 Tiled JSON → 加入列表
- 右键删除地图

---

## 五、实施步骤

### Step 1：界面框架（v2 布局）

- 顶部工具栏：打开/新建地图集 + 地图集名 + 保存/预览
- 左侧：地图列表（220px 宽）
- 中间：Canvas 编辑区
- 右侧：属性面板
- 底部：调色板

### Step 2：File System Access API

- `openCollection()`：调用 `showDirectoryPicker()` → 验证目录结构（必须有 maps/）→ 加载地图列表
- `createCollection(name)`：在 `workshops/toonflow-field-survival/map_design/<name>/` 创建完整目录
- `saveMap(mapName, json)`：直接写回文件（不下载）

### Step 3：地图列表

- 读取 `maps/` 下所有 `.json` 文件（排除 first.map.json）
- 显示为可点击列表项
- 切换时保存当前地图 → 加载新地图

### Step 4：添加地图

- 输入地图名（用于 Tiled JSON 的 `name` 字段 + 文件名）
- 生成空白 20×15 Tiled JSON（草地 tile + 基础 layers）
- 自动添加到 maps/ 并刷新列表

### Step 5：旧版编辑器核心（平移保留）

- Draw / Erase / Select / Place / Erase-Obj 工具
- 对象属性编辑
- Undo/Redo
- 缩放/平移/网格/碰撞预览
- 调色板

---

## 六、Tiled JSON 空白地图模板

```json
{
  "width": 20,
  "height": 15,
  "tilewidth": 32,
  "tileheight": 32,
  "tilesets": [{ "firstgid": 1, "source": "compiled_dawnlike.json" }],
  "layers": [
    {
      "type": "tilelayer",
      "name": "Ground",
      "data": [7865, 7865, ...]  // 20×15 = 300 个草地 tile
    },
    {
      "type": "objectgroup",
      "name": "Actors",
      "objects": [
        {
          "id": 1,
          "name": "Player",
          "x": 320,
          "y": 480,
          "properties": [{ "name": "entity_type", "value": "PLAYER", "type": "string" }]
        }
      ]
    }
  ]
}
```

---

## 七、参考文件

| 文件 | 用途 |
|------|------|
| `workshops/toonflow-field-survival/map_design/通天传授-收徒系统/` | 地图集结构参考 |
| `plugins/toonflow-field-survival/vue/src/mapConfig.ts` | MapConfig 类型、normalizeTiledMap |
| `plugins/toonflow-field-survival/ui/maps/mulberryTown.json` | Tiled JSON 格式参考 |
| `plugins/toonflow-field-survival/ui/compiled_dawnlike.json` | tile 碰撞属性表 |
| `plugins/toonflow-field-survival/ui/images/compiled_tileset_32x32.png` | 瓦片图集 |