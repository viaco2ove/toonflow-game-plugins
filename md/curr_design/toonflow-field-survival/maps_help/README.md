# 地图制作指南 · API 文档 · 规范

> toonflow-field-survival 插件「地图集（map collection）」三件套
> 正本数据：`workshops/toonflow-field-survival/map_design/<故事名>/`
> 运行时插件：`plugins/toonflow-field-survival/`

## 文档导读

| 文档 | 内容 | 读者 |
|------|------|------|
| [地图制作指南.md](地图制作指南.md) | 地图集目录结构、编辑器使用、Tiled JSON 格式、对象属性、坐标系统、新地图全流程、FAQ | 地图/剧情策划、AI 助手 |
| [API文档.md](API文档.md) | 事件 JSON schema（trigger/condition/action）、TS 脚本 ctx API、quests.json 任务 schema、校验器用法 | 写事件/脚本的人、AI 助手 |
| [规范.md](规范.md) | 目录/命名/内容/flag/同步发布的硬规则、引擎现状硬约束、反模式清单、发布检查单 | 所有人（动地图前必读） |

## 三十秒速览

1. **一个「地图集」= 一个故事文件夹**，放在 `workshops/toonflow-field-survival/map_design/<故事名>/`。
   现成参考：`base/`（空白模板）、`通天传授-收徒系统/`、`赦夜人冥夜走廊-第二季/`。
2. **地图是标准 Tiled JSON**（32×32 瓦片、zlib 压缩层、Actors 对象层），另加 5 个顶层自定义字段：
   `name`（中文显示名）/ `theme` / `narration` / `notes` / `eventZones`。
3. **事件与地图分离**：`events/maps/<map>.events.json`（声明式触发器）+ `events/scripts/*.ts`（复杂逻辑），
    flag 全部存玩家卡（`t_plugin_session_data`），story.json 不存任何进度。
4. **引擎只实现了 3 种触发器**（`enter_map` / `interact` / `area_enter`）和 1 种条件（`flag_check`），
   白名单里其余类型写了也不会触发——下笔前先看 [规范.md](规范.md) §4 的硬约束表。
5. **发布链路**：workshops 正本 → `node .cache/validate_events.mjs <故事名>` 校验 → 同步脚本刷副本 →
   CLI `-build` 打 `.tbg` → CLI `-u` 上传到 `map_visual:<故事名>` → dev 验证。

## 关键源文件索引

| 文件 | 作用 |
|------|------|
| `plugins/toonflow-field-survival/vue/src/mapConfig.ts` | Tiled JSON → MapConfig 解析、对象属性白名单、关卡名映射 |
| `plugins/toonflow-field-survival/vue/src/eventEngine.ts` | 事件运行时（加载/触发/ctx 构造） |
| `plugins/toonflow-field-survival/vue/src/eventScripts/_ctx.ts` | ctx API 类型契约（唯一权威） |
| `plugins/toonflow-field-survival/vue/src/storyMap.ts` | 故事视觉地图包加载（map_visual / .tbg 解包） |
| `plugins/toonflow-field-survival/vue/src/zipTbg.ts` | .tbg（zip）解析 |
| `.cache/validate_events.mjs` | 事件系统静态校验器 |
| `src/tools/toonflow-field-survival/map-editor/` | 地图编辑器（FastAPI + Vue） |
| `src/toon_plugins/cli.py` | CLI：安装插件 / 上传故事 / build .tbg |
