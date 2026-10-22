# Toonflow game-plugins 项目长期记忆

## 改插件的三步收尾（务必都做）
1. `plugins/toonflow-field-survival/vue` 下 `npm run build` → 产出 `../ui/game.html`
2. `entry.ts` 用 esbuild 编成 `entry.js`（ESM 单文件，无 import / `import.meta`）
3. 把 `entry.js` 与 `ui/game.html` 同步到两份 installed 副本：
   - `toonflow-app-run-db/plugins/1/com.toonflow.minigame-field-survival/`
   - `toonflow-game-app/Toonflow-game/plugins/1/com.toonflow.minigame-field-survival/`
   校验方式：`md5sum` 三方一致。**真宿主**后端影子模块按 `<pluginKey>.<mtime>.mjs` 热重载，
   不用重启；**dev-host（`--conn`）例外：`loadEntryModule()` 里 `if (entryMod) return entryMod;`
   进程内永久缓存 entry.js，改了 entry.ts 必须重启 dev-server**。
   前端 src（含 eventScripts / mockHost）走 vite HMR，刷新页面即可；vite.config.ts 要重启。

## vite.config.ts 反引号陷阱（2026-10-17 踩过）
`vue/vite.config.ts` 在 207→1572 行之间有一个超长 HTML 模板字符串
`const PAGE = \`<!doctype html>…\``。在这个区间写注释/代码**任何反引号都会把模板提前闭合**，
esbuild 报的错误位置是「下一个反引号之后」，极具误导性（如 `Expected ";" but found "python"`）。
排查：`grep -n '`' vite.config.ts`，207 之前和 1572 之后应各有一个，中间必须是 0 个。

## dev-host 拟真宿主桩（`--conn` 模式）与真宿主的差异点
真宿主机由 CLI `python -m toon_plugins plugin_session_data -u … -story …` 把
`map_visual:<story>`（sessionId="all"）写进 `t_plugin_session_data`；dev-host 桩**不会**，需要
`seedStoryVisualMap()` 从 `/story-data/toonflow-field-survival/map_design/<STORY>.tbg` 主动播种。
entry.js 侧 `ensureStoryVisualMap()` 依赖 3 个前提，缺一个就静默退化到「只有当前关」：
`ctx.worldName` 非空、`tsApi.pluginData.getTemplate` 存在、模板里确有 `map_visual:<story>`。

## 地图数据三条链
- `storyMap.ts`（前端）：`getTemplate("map_visual:<story>")` → 退路 `get("map_visual")`
  → `normalizeBundle`（`format==="tbg"` 走 `zipTbg.tbgToVisFiles(base64)`，跳过 `bak/` 与 `test_data/`）
- `mapConfig.ts`：`listLevelNames()` 优先 `getStoryLevelNames()`（=bundle.mapFiles），兜底 `LEVEL_FILES`（已清空）
- `entry.ts`：`ensureStoryVisualMap()` 把模板注入本会话 `map_visual`，并透出 `worldName`/`worldId` 到 state 顶层
- `reportLevels()` 兜底**只能报当前关**，绝不能拼 `sysMapNodes`（后端回显 → 回声环，地图面板出现一排同名关卡）

## 插件里「参数卡是唯一权威源」
`s.items` / `s.skills` 全部由 `buildItems/buildSkills(playerCard)` 重建；排序类需求（背包/技能 ↑↓）
要落到 `patchCard` 改参数卡，再靠 `s.skillOrder` + `persistSys`/`restoreSys` 在断线重连时还原。

## story-data 中间件必须区分文本/二进制
`vite.config.ts` 的 `/story-data` 中间件默认 `readFileSync(...,"utf-8")` + `application/json`，
对 `.tbg`（zip）会损坏字节。已加二进制分支（octet-stream 原样回），新增加静态资源类型时记得同步。

## map-editor 的 AI 模型配置（复刻 toonflow-game-app 的 t_config 方案）
- 配置存**后端 SQLite**（`map-editor/backend/ai_store.py` → 本地 `ai_models.db`），字段对齐 app 的 t_config；不再是 localStorage。
- 适配器在 `map-editor/backend/ai_clients.py`：镜像 app 的 u.ai.image/u.ai.text——openai/other(gpt-image-1+参考图走 /images/edits)、volcengine(Ark)、gemini(responseModalities IMAGE)、siliconflow(/v1/images/generations)；尺寸 1K/2K/4K=1024²/2048²/4096²；统一返回 base64 data URI。
- 路由 `/api/ai/{models,bindings,test}` 对齐 app 的 /setting/* 与 /other/testImage。
- 贴图替换的模型绑定槽位 key = `textureReplaceModel`；`tile_style_change/routes.py` 的 `generate_tile` 优先用请求 config，否则解析该槽位（复刻 app getPromptAi）。
- 前端设置弹窗 `ModelSettingsModal.vue`：type×manufacturer×model×baseUrl×apiKey（text 额外推理参数）+ 模型列表增删改 + 槽位绑定 + 测试连通。
- 快捷键（**必须对齐地图编辑器真实交互，别只翻 onKeyDown**）：编辑器鼠标约定——
  中键/【Ctrl+左键】=平移地图、`Alt+左键`(select工具)=移动对象、`T`切换坐标模式后左键查 (tile,world) xy、滚轮=缩放、
  `Shift+左键`(draw/erase)=笔刷连刷。贴图替换模式 TilesetWorkspace 复用同一套：左键单选 / Shift+左键拖动框选多格（tileset 语义，地图里本无框选）/ Ctrl+左键拖动平移 / 中键拖动·滚轮缩放 / T 切换坐标查看。tileStyleMode 下 App 的 onKeyDown 抑制画布工具键，仅保留 Ctrl+S 与 Esc；方向键/R/+- 作为次要键盘导航（输入框聚焦时让行）。

## 地图名有三套写法，切图只认 mapFiles key
① 关卡 key `mulberryDungeon1`（= bundle.mapFiles 的 key，唯一能喂 `switchLevel`）
② 归一的英文名 `Mulberry Dungeon`（`normQuestMap` 产物，层号可能丢）
③ 中文显示名 `冥夜走廊·一层`（Tiled `name` / 地图面板展示）
跨图寻路一律先过 `levelKeyOf()`（前端）/ `rawQuestMapKey()`（后端）再切图。
**`toLowerCase().replace(/[^0-9a-z]/g,"")` 对纯中文名返回空串** —— 用它做前缀匹配会恒真、
做相等比较会把「桑镇」「桑林」判成同图，两处都必须 `if (!compact) return 原值`。

## 坐标是「1 米/格、以图心为原点」
`metersToCell`：`gx = floor(x + cols/2)`。桑镇 43×56 → x∈[-21.5,21.5] / y∈[-28,28]；
森林 60×40 → x∈[-30,30] / y∈[-20,20]；冥夜走廊一层 31×23 → ±15.5 / ±11.5。
任务坐标写超了不会报错，只会「寻路后原地不动」——查任务数据时先按这个范围卡一遍。

## 云端背景分离（map-editor cloud_matting.py）
- 三家适配器复刻 app `separateRoleAvatar.ts`：Bria（`api_token` header + remove_background，回 URL 要下载）、
  阿里云视觉（Python SDK `alibabacloud_imageseg20191230`）、腾讯云数据万象（`cos-python-sdk-v5`，上传→`?ci-process=`→删源图）。
- **Python SDK 与 Node SDK 差异大**：openapi Config 在 `alibabacloud_tea_openapi.models`；AdvanceRequest 字段全小写
  `image_urlobject`（Node 是 `imageURLObject`，hdcommon 特例 `imageUrlObject`——Python 无此特例）；方法名 snake_case
  `segment_hdbody_advance`。**阿里云响应的图片 URL 字段有 camelCase 小写开头形态**（`imageURL`/`imageUrl`），提取要大小写都试。
- 错误分级：MattingConfigError→400（配置错）、MattingProviderError→502（云端失败）；云端没 key 时 400 提示去模型管理配置。

## PIL paste(img, box, mask) 是 alpha 混合，不是替换！
半透明图 paste 到有内容的区域，结果 = 两者混合（实测 α128 纯红贴出 (128,0,0,64)，旧像素透过）。
「先 paste 透明块清场再 paste 新图」也救不了——第二次 paste 带 mask 仍然混合。
**要整格替换必须：`region = base.crop(格子)` → `Image.alpha_composite(region, 新图)` → `base.paste(合成结果, box)`（不带 mask）**。
前端 canvas 等价做法：`clearRect(格子)` + `drawImage`（clear 后 draw 是纯替换）。
同理重置类操作：恢复像素用不带 mask 的 paste 或 composite 后回贴，别用带 mask 的 paste。

## compiled_tileset 是「每地图集一份副本」，不是全局唯一
- 实际使用的图集：`workshops/toonflow-field-survival/map_design/<地图集>/images/compiled_tileset_32x32.png`
- **描述文件叫 `compiled_dawnlike.json`**（不是 `compiled_tileset_32x32.json`），
  内含 `columns=120 / tilewidth=tileheight=32 / tilecount=13080 / imagewidth=3840 / imageheight=3488 / tiles[]`。
- `resource_library/toonflow-field-survival/base/<name>/compiled_tileset_32x32.{png,json}` 是**素材母版**，
  只当只读预览/兜底，**任何写操作都不该落到这里**（会污染母版且当前地图看不到变化）。
- 所以贴图替换等写操作必须按当前地图集定位；map-editor 已抽出 `resolve_tileset_target(collection)`
  （`server.py`），复用既有 `/api/collections/{name}/tileset` 的路径解析约定（先 `images/` 再退回集合根）。
  `bak/` `overrides/` 也放在**地图集目录**下。

### 图集运行时来源（2026-10-22，三级）
- dev（`npm run debug -- --story <故事> --conn`）→ **workshops 本地最新**
  `workshops/<故事>/map_design/<故事>/images/compiled_tileset_32x32.png`
  （经 vite `/story-data` 中间件实时读盘；改完重跑 debug + 刷新浏览器即生效，**不需要复制/构建**）。
- 安装插件后 → **数据库** `map_visual:<故事>` 包内 `images/compiled_tileset_32x32.png`
  （`storyMap.getStoryTilesetObjectUrl()` 取 Uint8Array→Blob→blobURL，`App.vue applyTilesetImage()` 替换）。
- 兜底 → `plugins/toonflow-field-survival/vue/public/images/compiled_tileset_32x32.png`（随 ui/ 部署，走 `/images/...` 外部路径，不内联）。
- **禁放** `vue/src/assets/images/`（该目录 readme.md 明令禁止；git 里该 png 状态是 `D`，
  `assets.ts` 的 png import 早已失效报 "Failed to resolve import"）。

### 半兽人（ORC）占用的图集格子（2026-10-22 实测）
- **全部 16 格在 row 44，col 12–27 连续**（120 列 × 32px 图集，tileId = row*120 + col）：
  第 1 行 `5292 5293 5294 5295 5296 5297 5298 5299`
  第 2 行 `5300 5301 5302 5303 5304 5305 5306 5307`
- **动画配对（compiled_dawnlike.json 的 animated/animated_id 属性）**：
  5292→5300、5293→5301、5294→5302、5295→5303、5296→5304、5297→5305、5299→5307。
  即每个半兽人外观格子都有自己的第二帧，不能只改一个。
- `entity_types.json` 的 ORC 定义里 `textures: [5292,5293,5294,5295,5296,5297,5299]`（7 格，不含 5298）；
  `assets.ts` 的 `SPRITE_ANIM.orc = { idle: 5292, walk: [5292, 5300] }` 只覆盖 2 格。
- 地图 JSON 的 `firstgid = 1`，所以 gid 5300 → tileId 5299；mulberryForest.json 里实际摆的半兽人用的是 **tile 5299**（+ 帧 5307）。
- ⚠️ 换半兽人贴图必须**整套 16 格一起换**，只换 5292/5300 会导致其他帧还是旧造型（动画跳变）。

### 32×32 像素贴图不能用 AI 生图（2026-10-22 实测结论）
- **32×32 像素贴图每格只有 12~16 色**（原版半兽人实测 12-16 色）；硬边像素、有限调色板。
- AI 生图（Qwen/Qwen-Image-Edit-2509 等）产出 1024×1024 高细节插画，缩到 32×32 后变成 **400~650 色**，
  缩略图上完全糊掉；且图生图会把参考图当"内容参考"而非"构图约束"，产出狼脸特写而非立绘。
  → **这类贴图必须程序化生成**（手写像素模板 + 调色板），不要浪费额度试 AI。
- **落盘必须整格替换**：`base.paste(new_tile, pos)`，**不能** `alpha_composite` ——
  原格残留的 alpha=1 幽灵像素（历史 paste+mask 留下的）会在叠加时透出，放大看是彩色残影（实测 430 个残留像素）。
- 本次产出：`.cache/pixel_orc.py`（精灵绘制）+ `.cache/apply_orc_wolf.py`（落盘），共 16 格暗黑疾风狼，
  每格 14~19 色，8 组姿势与原版逐格对应（站立/盾锤/双剑/双匕首/法杖书/法师袍/骑士/发光盾）。

## AI 厂商目录的权威源在 Toonflow-game-web，不在 app
厂商表（含默认 baseUrl / 默认模型）唯一可读源码是
`Toonflow-game-web/src/utils/modelConfigCatalog.ts` → `MODEL_MANUFACTURERS`（22 家）+ `defaultBaseUrlFor()` /
`defaultModelNameFor()` / `defaultManufacturerFor()` / `MODEL_TYPE_OPTIONS`。
`toonflow-game-app/src` 里**没有任何 .vue**，厂商表只存在于已构建 bundle `app/scripts/web/assets/index-*.js`
（且是 2025-07 的旧版，比 web 少一个 `moka_m3e_small`）—— 要改/抄厂商数据一律去 web 仓库。
map-editor 侧已移植到 `map-editor/frontend/src/tile-style-change/modelConfigCatalog.js`。

三个坑：① `defaultBaseUrlFor` 有 defaults 表**之外**的硬编码分支（voice+asr → `dashscope.aliyuncs.com/compatible-mode`）；
② `tencent_ci` 与 local_* 的 defaults 为空，腾讯云 baseUrl 必须手填 COS 桶域名；
③ `defaultModelNameFor` 里 `manufacturer==="aliyun"`（无 `_direct`）是**死分支**，注册表只有 `aliyun_direct`。

抠图专用厂商集合 = `{bria, aliyun_imageseg, tencent_ci, local_birefnet, local_modnet}`（+ map-editor 自增 `local_u2net`），
**只能绑背景分离槽位**，不能绑普通 image/text 槽位（app 的 `configurationModel.ts` SLOT_CONFIG_RULES 互斥矩阵）。
注意 app 前端 `SettingsModelManagerDialog.vue:72-80` 误把 `moss_tts_nano` 也算进去了，与后端不一致，别照抄。

## 本地抠图模型（map-editor 背景分离）复用 app 的权重，不重复下载
- `map-editor/backend/avatar_matting.py` 复刻 app 的 localAvatarMatting；`tool_root_dir()` 会**自动探测**
  `D:\Users\viaco\tools\Toonflow-game\toonflow-game-app\Toonflow-game\tools`（与 toonflow-game-plugins 是兄弟目录），
  共用 `avatar-matting/birefnet/{venv,model-cache}`。`model-cache` 里已预置
  birefnet-portrait/birefnet/modnet/u2net/u2netp 五个权重。
- 厂商 key：`local_birefnet` / `local_modnet` / `local_u2net`（各自独立字符串，不存在统一 `local`）。
- **u2net = 非生物通用显著对象分割**（道具/建筑/纹理/布料），走 rembg 同一条路（`U2NET_HOME` 指向 model-cache），
  无独立 runner；rembg 内置 session：u2net / u2netp / u2net-general / u2net_cloth_seg / u2net_human_seg。
- 注意：`backend/env/.env.*` 里的 `MODEL_path` 曾是占位目录 `D:\Users\xxx\...`，导致所有本地抠图模型静默 not_installed；
  现在靠 autodetect 兜底，但**新增 env 文件时别再写占位路径**。

## canvas 切换显示必须用 v-show，不能用 v-if（2026-10-22 踩过）
map-editor `App.vue` 里 canvas 的 2d context 是**模块级缓存**（`let ctx=null`，`render()` 里
`if(!ctx) ctx=canvasRef.getContext('2d')`）。中间区 canvas 与 TilesetWorkspace 切换时若用 `v-if`
销毁重建 canvas，`ctx` 会永久指向旧的已销毁 canvas → 退出后黑屏、点击无反应、任何 `render()` 都无效，
只能刷新页面。凡是持有「模块级缓存 context/实例」的 canvas/图表 DOM，切换显示一律用 `v-show` 常驻 DOM。

## 处理问题的方式
- 表查询出错的第一件事应该是去看看这个表的结构
- 看到一个报错或者问题应该去看看根源问题是什么。而不是暴力解决
- 看不到日志不要想当然日志没有开debug, 更不要去掉DebugLogUtil.isDebugLogEnabled() 的判断！！！
## 一个非常重点的事情-ai agent
这个项目实际是更多是个ai agent 项目，所以尽量不要写硬编码。
用ai agent 去实现各种功能！！！！

## 任务状态
[]:未开始 [suc]:已检查没有问题, [skip]:暂时跳过, [wait]:待检查,[ing] 实现中或处理中或修复中
[fail]:检查不通过，[check]:正在检测中

## 不允许随意放置测试和临时文档
测试脚本和文档和临时文档
只允许放置在.cache 文件夹下。

# vite.config.ts
要不让vite.config.ts 支持 \n 要不就不要写\n 