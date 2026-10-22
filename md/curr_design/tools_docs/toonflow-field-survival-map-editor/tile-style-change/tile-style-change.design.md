# Tile Style Change（贴图风格替换）设计方案

> 工具：`toonflow-field-survival-map-editor`
> 模块：map-editor 的「贴图替换」新功能
> 设计稿版本：v2（基于代码现状重写，2026-10-22）
> 关联需求：`md/curr_design/tools_docs/toonflow-field-survival-map-editor/tile-style-change/readme.md` + 图1（`img.png`）

---

## 1. 功能需求（来自图1 与 readme.md）

1. 顶栏「设置」右侧新增两个按钮：**`贴图替换`** 和紧挨它右侧的 **`设置`**。
2. 点击「贴图替换」→ 弹出素材选择（暂只有 `compiled_tileset_32x32`）→ 加载该素材的
   `compiled_tileset_32x32.png` 与其 `.json` 到**工作区**（图集视图）。
3. 在图集视图上**点击某个格子**即选中该 tile，进入风格变化模式。
4. 右侧控制区输入**提示词**、上传**参考图**（可多张），点生成即**替换这一格的精灵贴图**。
5. **必须把生成的贴图扣掉背景，输出透明背景**（像素风必须是硬边透明，不能羽化糊边）。
6. 「设置」按钮：复刻 `toonflow-game-app` 的**文本大模型 + 生图模型**配置方案与接口对接方案。

---

## 2. 现状盘点（v2 重写的理由：用户反馈「感觉没完成任务」）

现有代码已搭出 UI 骨架，但**核心链路全部断裂**。下表基于仓库真实代码逐条核对：

### ✅ 已完成（保留）
| 项 | 位置 | 说明 |
|---|---|---|
| 工具栏按钮 | `frontend/src/App.vue:1122-1125` | 🎨 贴图替换 + ⚙️ 设置 已插入「撤销/重做」组之后 |
| 面板组件 | `frontend/src/tile-style-change/TileStylePanel.vue` | 提示词框、参考图上传、尺寸选择、生成/重置按钮齐全 |
| 设置弹窗 | `frontend/src/tile-style-change/ModelSettingsModal.vue` | 生图模型表单（localStorage 存储） |
| 后端路由 | `backend/tile_style_change/routes.py` | `POST /api/tile-style/generate`（OpenAI 兼容 + 色键抠图） |
| API 客户端 | `frontend/src/api.js:53-56` | `api.generateTile()` |
| tileset 已加载 | `frontend/src/App.vue:418-446` | `tileset.value.img` + `extractTileToDataUrl(id)` 切 32×32 |
| 分类数据 | `compiled_tileset_32x32.json` | 标准 Tiled tileset + `regions.categories` + 每 tile `properties`（category/grid_x/grid_y/avg_color/dominant_hue） |

### ❌ 未完成 / 缺口（= 任务真正要补的）
| # | 缺口 | 现状 | 影响 |
|---|---|---|---|
| G1 | **生成结果无法写回图集** | `TileStylePanel` emit `replace-tile` / `reset-tile`，但 `App.vue:1265-1269` **没有监听事件**（仅传 prop，无 `@replace-tile`） | 生成成功也只是预览，图集永远不变 |
| G2 | **没有素材选择 + 加载流程** | 按钮仅 `showTileStylePanel=true` 直接弹面板，没有「选素材→加载 png+json 到工作区」 | 违背需求第 2 步 |
| G3 | **没有 tileset 图集视图**，无法点格子 | 只能从右侧调色板（`slice(0,80)` 分组）选 tile，没有整张图集网格视图 | 违背需求第 3 步「点击某个格」 |
| G4 | **参考图后端实现为空** | `routes.py:44-47` 是 `if ref_images: pass # TODO` | 多参考图功能完全失效 |
| G5 | **current_tile 未下传生图** | 后端收了参数但 `call_openai_compatible()` 没用 | 无法保持原构图 |
| G6 | **配置没复刻 app 方案** | 现状是 localStorage 单配置、仅生图、仅 openai/other 两厂商、**无文本模型**、无厂商下拉、无测试连接 | 违背需求第 6 步，且无法接入多厂商/多模型 |
| G7 | **抠图算法太弱** | 四角采样色键法（`routes.py:73-111`），AI 生成图背景非纯色会误抠主体 | 透明背景质量差 |
| G8 | **没有落盘 / 导出** | 改完 tileset 内存变化无保存路径，json 也不记录 | 工作成果丢失 |
| G9 | **32×32 缩放与像素风保持缺失** | 出图 1024×1024 直接丢回，无缩小 + 像素化策略 | tile 尺寸/风格不对 |
| G10 | **无提示词预设** | `../../../../../.doubao/skills/bak/tile-style-change/references/style-prompts.md` 现成分类 prompt 库未接入 | 每次手敲提示词 |

---

## 3. 整体架构与数据流

```
[工具栏: 贴图替换] ──点击──> [素材选择弹窗]
                                  │ 选 compiled_tileset_32x32
                                  ▼
                          [加载到工作区]
                  png(3840×3488) + json(13080 tiles, 7246 非空)
                                  │
                                  ▼
                   [Tileset 工作区视图: 分页/缩放浏览, 点格子]
                                  │ 点击 (gx, gy) → tileId = gy*120 + gx
                                  ▼
                   [右侧控制区]  提示词 + 参考图(≤3) + 尺寸 + 风格预设
                                  │ 生成并替换
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ 前端 fetch  /ai/image/generate   (复刻 app 的 /game/generateImage)│
   │  body: { prompt, refImages[], currentTileBase64, size, config } │
   └───────────────────────────────┬──────────────────────────────┘
                                    ▼
                      后端 AI 代理 (按 manufacturer 分发适配器)
                      volcengine / openai兼容(other) / gemini / siliconflow
                                    │ 返回 base64 (RGBA)
                                    ▼
                      抠图服务 (AI 抠图优先 + 色键兜底) → 透明 PNG
                                    │
                                    ▼
                      缩放 LANCZOS → 32×32 → 像素化采样 (硬边)
                                    │
                        ┌───────────┴────────────┐
                        ▼                        ▼
              [实时贴回工作区画布]        [落盘: overrides/<tileId>.png
                                              + json.styleOverrides 记录]
```

---

## 4. UI 设计

### 4.1 工具栏入口（`App.vue` 1122 附近，保留并微调）

```
... [撤销] [重做] | [🎨 贴图替换] [⚙️ 设置] | [💾 保存]
```

- `🎨 贴图替换`：切换「贴图替换工作模式」（打开素材选择弹窗 / 切换工作区视图）
- `⚙️ 设置`：打开模型配置弹窗（复刻 app 的 `AI 模型配置`）

### 4.2 素材选择弹窗（**新增**，解决 G2）

首次点「贴图替换」弹出，列出 `resource_library/<plugin>/base/` 下所有 `<name>/` 目录：

```
┌──────────────────────────┐
│ 选择素材集               │
├──────────────────────────┤
│ ◉ compiled_tileset_32x32 │  (120×109, 13080 格, 32px)
│ ○ (其他素材，后续扩展)    │
├──────────────────────────┤
│ [取消]              [加载] │
└──────────────────────────┘
```

加载动作：
1. 读 `compiled_tileset_32x32.png` → 作为工作区底图
2. 读 `compiled_tileset_32x32.json` → 存 `tileset.value.meta`（columns=120, tilecount, tiles[]）
3. 计算分页数（3840×3488 太大需分页/缩放）

> 数据/格式可按需变动：json 已含 `regions.categories` 与每 tile `properties`，足够支持按分类批量与单格替换；无需改现有字段结构。

### 4.3 Tileset 工作区视图（**新增**，解决 G3）

替换右侧地图画布，显示整张图集，支持：

- **缩放**：适配窗口 / 100% / 200% 三档，32px 格可放大检视
- **分页**：按 8×8 屏（约 960 格/页）浏览，避免一次性渲染 13080 格卡顿
- **点选格子**：`click` 命中 `(gx, gy)` → `tileId = gy * columns + gx`，高亮选中框
- **选中同步**：选中后右侧控制区显示该格放大预览（带透明棋盘格背景，参照 `TileStylePanel` 既有样式）

### 4.4 右侧控制区（基于 `TileStylePanel.vue`，补齐 G1/G4/G9）

```
┌─────────────────────────┐
│ 🎨 贴图替换              │
├─────────────────────────┤
│ 素材集: compiled_tileset_32x32 │
│ 选中格: #7865  (gx=45, gy=65) │
│ ┌─────────┐             │
│ │ 透明棋盘 │ (32×32 放大) │
│ └─────────┘             │
│                         │
│ 风格预设: [现代都市▾][自定义] │
│ 提示词:                  │
│ ┌─────────────────────┐ │
│ │ 现代公寓楼外墙...    │ │
│ └─────────────────────┘ │
│ 参考图(可选,≤3):         │
│ [缩略图][缩略图][+添加]  │
│ 生成尺寸: [1024×1024 ▾]  │
│ [✨ 生成并替换] [重置原图] │
│ 🔄 保留原构图(用当前格作参考) │
└─────────────────────────┘
```

- **生成并替换**：经 `api.generateTile()` 拿回透明 32×32 → 触发 `emit('replace-tile', {tileId, imageBase64})`
- **App.vue 必须监听该事件**（G1）并将其 `drawImage` 到工作区 canvas 对应 `(gx*32, gy*32)` 位置，标记 dirty
- **重置原图**：`emit('reset-tile', tileId)` → 从 `overrides/` 删文件 + 恢复底图像素

### 4.5 设置弹窗（基于 `ModelSettingsModal.vue`，补齐 G6）

复刻 app 的两段式配置（**文本模型 + 生图模型**），含厂商下拉（来自 `/setting/getAiModelList`）、测试连接、默认绑定：

- 生图模型：厂商 [openai / volcengine / gemini / siliconflow / other]、模型名、API Key、Base URL、默认尺寸
- 文本模型（用于**自动生成/优化提示词、按分类批量**）：厂商、模型、API Key、Base URL、温度/TopP
- 底部：`[测试连接] [保存]`，保存后写 `t_config` + 绑定 `t_ai_model_map` 槽位

---

## 5. 数据设计

### 5.1 `compiled_tileset_32x32.json` 扩展（解决 G8 落盘）

**不把 base64 塞进 json**（4.9MB json 会爆炸）。新增 `styleOverrides` 仅存**元数据 + 引用**：

```json
{
  "columns": 120,
  "image": "compiled_tileset_32x32.png",
  "tilewidth": 32, "tileheight": 32,
  "tilecount": 13080,
  "tiles": [ ... 原结构不动 ... ],
  "styleOverrides": {
    "7865": {
      "overridePng": "overrides/7865.png",   // 新增的 32×32 透明 PNG 路径
      "prompt": "现代公寓楼外墙...",
      "refImages": ["<sha256>.png", ...],     // 存到 overrides/refs/，不塞 base64
      "model": "dall-e-3",
      "createdAt": "2026-10-22T00:23:00Z"
    }
  }
}
```

- 覆盖图目录：`resource_library/<plugin>/base/compiled_tileset_32x32/overrides/`
- **一键导出**：把 `overrides/<id>.png` 贴回 `compiled_tileset_32x32.png` 对应坐标，产出「换皮后」新图集

### 5.2 模型配置三表（复刻 app，解决 G6）

后端引入 SQLite `map_editor.db`，建与 app 同构的三张表：

```sql
-- 模型配置主表（与 app t_config 对齐，type 区分模型类别）
CREATE TABLE t_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,                 -- text | image | voice | video
  model TEXT,
  modelType TEXT,
  apiKey TEXT,              -- 明文（同 app 做法）
  baseUrl TEXT,
  manufacturer TEXT,
  inputPricePer1M REAL, outputPricePer1M REAL, cacheReadPricePer1M REAL,
  currency TEXT, reasoningEffort TEXT, temperature REAL, topP REAL,
  remark TEXT,
  createTime INTEGER, userId INTEGER DEFAULT 1
);

-- 槽位映射（与 app t_ai_model_map 对齐）
CREATE TABLE t_ai_model_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT,                 -- mapTextureStyleImage / mapTextureStyleText
  name TEXT, configId INTEGER
);

-- 默认绑定（与 app t_setting.languageModel 对齐，JSON 文本列）
CREATE TABLE t_setting ( userId INTEGER PRIMARY KEY, languageModel TEXT );
```

---

## 6. 模型配置与接口对接方案（复刻 app，★重点）

### 6.1 app 端现状要点（调研自 `toonflow-game-app`）

- **存储**：`t_config` 单表，`type∈{text,image,voice,video}` 区分；`apiKey`/`baseUrl` **明文**。
- **路由**（无统一 `/api` 前缀）：`POST /setting/addModel`、`/setting/delModel`、`/setting/configurationModel`、`/setting/getAiModelList`、`/setting/getAiModelMap`、`/other/testAI`、`/other/testImage`、`/game/generateImage`。
- **生图契约**：`POST /game/generateImage { projectId, type:'role'|'scene', prompt, base64?, base64List?[], size:'1K'|'2K'|'4K', aspectRatio }` → 返回 `{ path, filePath, ... }`（先 base64 再落 OSS 转 url）。
- **适配器分发**（按 `manufacturer`）：`volcengine`（`ark.cn-beijing.volces.com/api/v3/images/generations`，`response_format:url`，`size` 像素、`aspect_ratio`、参考图走 `image` 数组）；`other`→OpenAI 兼容透传；`gemini`→`generateText` + `responseModalities:["IMAGE"]`。
- **size 换算**：1K→1024²、2K→2048²、4K→4096²。
- **文本模型**：Vercel AI SDK（`u.ai.text.invoke/stream`），`temperature` 默认 0.3、`topP` 0.5。
- **鉴权**：JWT(HS256)，Header `Authorization` 或 `?token=`，密钥为用户 `t_setting.tokenKey`；`/other/*` 整组免 token。

### 6.2 map-editor 复刻契约（路径对齐 app）

| 方法 & 路径 | 请求体 | 响应 | 对应 app |
|---|---|---|---|
| `POST /setting/addModel` | `{type, model, baseUrl, apiKey, modelType, manufacturer, ...}` | `{code:200, data:"新增成功"}` | `/setting/addModel` |
| `POST /setting/delModel` | `{id}` | `{code:200}` | `/setting/delModel` |
| `POST /setting/configurationModel` | `{id, configId}` | `{code:200}` | `/setting/configurationModel` |
| `POST /setting/getAiModelList` | `{type:"text"\|"image"}` | `{manufacturerKey:[{label,value}]}` | `/setting/getAiModelList` |
| `POST /setting/getAiModelMap` | `{}` | `[{id,key,name,configId,...}]` | `/setting/getAiModelMap` |
| `POST /other/testImage` | `{modelName, apiKey, baseURL, manufacturer}` | `{code:200}` / 错误 | `/other/testImage` |
| `POST /other/testAI` | `{modelName, apiKey, baseURL, manufacturer, reasoningEffort?}` | `{code:200}` | `/other/testAI` |
| `POST /ai/image/generate` | `{prompt, refImages[]?, currentTile?, size, config}` | `{imageBase64, width, height}` | `/game/generateImage` |
| `POST /ai/text/invoke` | `{prompt, config}` | `{text}` | `u.ai.text.invoke` |

- **包格式**：所有响应统一 `{code, data, message}`（对齐 app 的 `success()` 包裹）。
- **鉴权**：工具为本地单用户，简化为 `?token=local` 或直接放行本地回环；`/other/*` 仍设为免校验（同 app）。

### 6.3 生图适配器分发（复刻 `src/utils/ai/image/index.ts`）

后端 `ai/image.py` 按 `config.manufacturer` 分发：

```python
ADAPTERS = {
  "volcengine": volcengine_generate,   # ark.cn-beijing.volces.com/api/v3/images/generations
  "other":      openai_compatible,     # OpenAI Images API 兼容
  "gemini":     gemini_generate,       # generateText + responseModalities IMAGE
  "siliconflow": openai_compatible,    # 复用兼容分支
}
```

- **参考图**：`volcengine` 走 `image` 数组（解决 G4）；`openai兼容` 走 `gpt-image-1` edits 分支或 `image[]`；`gemini` 走多模态输入。
- **size 换算**：`1K→1024² / 2K→2048² / 4K→4096²`（像素风固定用 1K 即可，出图后缩放）。
- **超时**：`requests` 默认 `timeout=180s`；配额错误归一化文案（复刻 app `QUOTA_ERROR_PATTERNS`）。

### 6.4 文本模型对接（新增，app 有而现状缺失）

用于两处：
1. **提示词优化**：把用户输入的草描扩写成贴图生图 prompt（复用 `style-prompts.md` 通用约束）。
2. **按分类批量**（后续）：读 `regions.categories`，让文本模型产出每类一组 prompt。

---

## 7. 贴图替换主链路（端到端，解决 G1/G4/G5/G7/G9）

### 7.1 时序

```
用户点格子(#7865)
  → TileStylePanel 拿到 selectedTileImage (当前 32×32 dataURL)
输入提示词 + 参考图(可选)
点 [生成并替换]
  → api.generateTile({
        prompt,
        refImages: [dataURL,...],     // 解决 G4
        currentTile: selectedTileImage, // 解决 G5
        size: "1024x1024",
        config: { manufacturer, model, apiKey, baseURL }
    })
  → 后端 /ai/image/generate
      1) 适配器生图（含参考图）
      2) 抠图服务（G7）
      3) LANCZOS 缩放到 32×32 + 像素化（G9）
      4) 返回透明 PNG base64
  → 前端 generatedImage 预览
  → emit('replace-tile', {tileId:7865, imageBase64})
  → App.vue 监听（G1）: drawImage 到工作区 canvas (gx*32, gy*32)
  → 标记 dirty + 写 styleOverrides（G8）
```

### 7.2 抠图方案（G7，像素风硬边）

- **优先 AI 抠图**：接入 `RMBG-2.0` / `BiRefNet`（复刻 app `storyAvatarMattingModel` 槽位思路）。本地可走 `rembg`（需 `onnxruntime`）。
- **兜底色键**：当无 AI 抠图服务时，改进 `routes.py` 的 `chroma_key_removal`：
  - 背景采样改为**中心权重**：以四角 + 边缘 2px 环采样均值，避免主体占角落时误判；
  - **硬边阈值**：像素风 tile **不要羽化**（羽化会把硬像素边抹糊），改用 `dist < threshold → alpha=0`，`dist >= threshold → alpha=255`；
  - `threshold` 默认 30，提供滑块（5~80）让用户针对该格微调。
- **输出**：严格 RGBA，非透明区域 alpha=255。

### 7.3 缩放与像素风保持（G9）

```python
gen = Image.open(buf).convert("RGBA")
gen = gen.resize((32, 32), Image.LANCZOS)   # 先高质量缩小
# 像素化：对缩后图不做抗锯齿，可再按原 tile 做最近邻二次采样保持硬边
```

- 若用户勾选「保留原构图」，把 `currentTile` 作为生图参考图（`currentTile` 已下传，G5），让 AI 在原始轮廓内重绘。

### 7.4 写回与落盘（G1/G8）

- **内存**：`replace-tile` → 工作区 canvas `ctx.drawImage(decoded, gx*32, gy*32)`。
- **落盘**：同时 `overrides/<tileId>.png` 落盘 + `styleOverrides[tileId]` 写 json。
- **导出新图集**：脚本把 overrides 贴回 `compiled_tileset_32x32.png` 对应坐标，产出换皮图集。
- **重置**：删 `overrides/<id>.png` + json 记录 + 从底图重绘该格。

---

## 8. 提示词工程（解决 G10）

复用 `../../../../../.doubao/skills/bak/tile-style-change/references/style-prompts.md` 的**分类 prompt 库**，
在「风格预设」下拉提供：现代都市 / 像素奇幻 / 手绘卡通 等；选择后自动按 `tile.category` 填好 prompt 模板，
用户可微改。通用约束（每条都追加）：

```
保持像素画美术风格和 32px tile 尺寸感，不要变成写实照片风。
输出尺寸与输入完全一致，网格位置不变，只改内容风格。
背景必须透明（无填充）。
```

文本模型（G6 的 text 配置）可用于把用户中文草描扩写为上述英文/结构化 prompt。

---

## 9. 文件变更清单

### 前端（`frontend/src/`）
| 文件 | 动作 | 内容 |
|---|---|---|
| `App.vue` | 修改 | ① 素材选择弹窗挂载 ② tileset 工作区视图（分页/缩放/点选） ③ **监听 `replace-tile`/`reset-tile` 并写回 canvas + json**（G1） ④ 工具栏按钮微调 |
| `tile-style-change/MaterialPicker.vue` | **新增** | 素材集选择弹窗（G2） |
| `tile-style-change/TilesetWorkspace.vue` | **新增** | 图集网格视图（G3） |
| `tile-style-change/TileStylePanel.vue` | 修改 | 加风格预设下拉、保留原构图勾选、尺寸默认 1024²、绑定 G1 事件流 |
| `tile-style-change/ModelSettingsModal.vue` | 修改 | 拆分文本/生图两段、厂商下拉拉 `/setting/getAiModelList`、测试连接调 `/other/testImage|testAI`、绑定槽位调 `/setting/configurationModel`（G6） |
| `api.js` | 修改 | 加 `getAiModelList`/`getAiModelMap`/`addModel`/`delModel`/`configModel`/`testImage`/`testAI`/`imageGenerate`/`textInvoke` |

### 后端（`backend/`）
| 文件 | 动作 | 内容 |
|---|---|---|
| `server.py` | 修改 | 挂载新路由 `/setting/*`、`/other/*`、`/ai/*`；引入 SQLite `map_editor.db` |
| `tile_style_change/routes.py` | 修改 | `generate` 接 `refImages`+`currentTile`；抠图改用 7.2 方案 |
| `tile_style_change/config_routes.py` | **新增** | 复刻 app 的配置 CRUD（`t_config`/`t_ai_model_map`/`t_setting`） |
| `tile_style_change/ai_image.py` | **新增** | 生图适配器分发（volcengine/other/gemini/siliconflow）+ 参考图 |
| `tile_style_change/ai_text.py` | **新增** | 文本模型 invoke（Vercel AI SDK 或裸 HTTP） |
| `tile_style_change/matting.py` | **新增** | AI 抠图(rembg/RMBG-2.0) + 色键兜底(硬边) |
| `tile_style_change/export_overrides.py` | **新增** | overrides → 贴回图集导出 |
| `requirements.txt` | 修改 | + aiosqlite / onnxruntime / rembg（按需） |

---

## 10. 分阶段实施计划（验收标准）

### Phase 1 — 打通主链路（MVP，先解决“能替换”）
- [ ] G2 素材选择弹窗 + 加载 png/json 到工作区
- [ ] G3 tileset 工作区视图 + 点选格子
- [ ] G1 App.vue 监听 `replace-tile` 写回 canvas
- [ ] G4/G5 后端接 `refImages`+`currentTile`，OpenAI 兼容生效
- [ ] G8 落盘 `overrides/` + json.styleOverrides
- 验收：选一格 → 输提示词 → 生成 → 画布该格变化 → 刷新后仍生效

### Phase 2 — 配置方案复刻（G6）
- [ ] 后端 SQLite 三表 + `/setting/*` + `/other/test*`
- [ ] 前端 `ModelSettingsModal` 两段式 + 厂商下拉 + 测试连接 + 槽位绑定
- [ ] 文本模型 `/ai/text/invoke` 接入提示词优化
- 验收：设置里配置 volcengine/openai 生图 + 文本模型，点测试连接成功，生成可用

### Phase 3 — 质量与扩展
- [ ] G7 AI 抠图（rembg）+ 硬边色键兜底 + threshold 滑块
- [ ] G9 像素化缩放 + 保留原构图
- [ ] G10 风格预设下拉（复用 style-prompts.md）
- [ ] 导出新图集脚本
- 验收：生成 tile 透明硬边、32×32 对齐像素风；可一键导出整套换皮图集

---

## 11. 风险与注意事项

1. **像素风抠图 ≠ 写实抠图**：羽化会糊边，必须硬边（见 7.2）。这是和 app 通用抠图最大的差异点。
2. **json 体积**：`styleOverrides` 只存引用不存 base64，否则 json 从 4.9MB 爆到数十 MB。
3. **tileset 太大**：3840×3488 必须分页/缩放浏览，一次性渲染 13080 格会卡死（见 4.3）。
4. **配置明文**：apiKey 同 app 做法明文存储，工具为本地使用可接受，但需提示用户。
5. **多参考图兼容性**：各厂商参考图传参不同（volcengine `image[]`、openai edits、`gemini` 多模态），适配器要分别处理（见 6.3），这是 G4 真正的工作量所在。
6. **复用既有资产**：`resource_library/.../compiled_tileset_32x32/` 已含 png+json+分类；`../../../../../.doubao/skills/bak/tile-style-change/` 的 `extract_tiles.py`/`compose_tiles.py` 可作批量与单格提取的参考实现。
