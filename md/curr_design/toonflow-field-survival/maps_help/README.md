# 地图制作指南 · API 文档 · 规范

> toonflow-field-survival 插件「地图集（map collection）」三件套
> 正本数据：`workshops/toonflow-field-survival/map_design/<故事名>/`
> 运行时插件：`plugins/toonflow-field-survival/`

## 严重违规事项
- 把地图集独有的业务写到插件里（地图集自己的ai 和触发器和事件和ui 设计应该在地图集里面编写）
- 在编辑地图集时，插件尽量不改，改也得按着通用函数和接口的方向修改

## 文档导读

| 文档 | 内容 | 读者 |
|------|------|------|
| [地图制作指南.md](地图制作指南.md) | 地图集目录结构、编辑器使用、Tiled JSON 格式、对象属性、坐标系统、新地图全流程、FAQ | 地图/剧情策划、AI 助手 |
| [API文档.md](API文档.md) | 事件 JSON schema（trigger/condition/action）、TS 脚本 ctx API、故事包数据读取、后端命令、quests.json、校验器 | 写事件/脚本的人、AI 助手 |
| [规范.md](规范.md) | 目录/命名/内容/flag/同步发布的硬规则、引擎现状硬约束、反模式清单、发布检查单 | 所有人（动地图前必读） |
| [地图集事件案例/](地图集事件案例/) | ★ **照抄级案例**：怎么用插件接口做地图集自己的交互与 UI | 想加功能设施的人 |

### 地图集事件案例（建议按需逐个抄）

| 案例 | 做出什么 |
|------|----------|
| [触发性事件.靠近目标](地图集事件案例/触发性事件.靠近目标.地图集制作案例.md) | 走近目标 → 弹专属按钮 → 点击弹面板；**★ 含插件接口全量清单、规范逐条审计、接口缺口与补接口建议** |
| [锻造师or炼丹炉](地图集事件案例/锻造师or炼丹炉.地图集制作案例.md) | 售卖 + 打造 + 升级 + 溶解 全套面板；货单放 `data/shop.*.json` |
| [假人交互事件](地图集事件案例/假人交互事件.地图集制作案例.md) | 练习假人：站桩（回血/无经验）与模拟实战（反击/击碎给经验） |

## 三十秒速览

1. **一个「地图集」= 一个故事文件夹**，放在 `workshops/toonflow-field-survival/map_design/<故事名>/`。
   现成参考：`base/`（空白模板）、`通天传授-收徒系统/`（含设施/假人/货单）、`赦夜人冥夜走廊-第二季/`。
2. **地图是标准 Tiled JSON**（32×32 瓦片、zlib 压缩层、Actors 对象层），另加 5 个顶层自定义字段：
   `name`（中文显示名）/ `theme` / `narration` / `notes` / `eventZones`。
   实体**外观由对象 `gid` 决定**，`entity_type` 只管行为类。
3. **事件与地图分离**：`events/maps/<map>.events.json`（声明式触发器）+ `events/scripts/*.ts`（复杂逻辑），
   flag 全部存玩家卡（`t_plugin_session_data`），story.json 不存任何进度。
4. **引擎实现了 5 种触发器**（`enter_map` / `interact` / `proximity` / `area_enter` / `interval`）
   和 1 种条件（`flag_check`），白名单里其余类型写了也不会触发——下笔前先看 [规范.md](规范.md) §4。
5. **地图集自己的数据放 `data/*.json`**（货单、文案表、配置），脚本用
   `ctx.story.readJson("data/x.json")` 读；**不要写进插件源码**（那是全故事共用的）。
6. **发布链路**：workshops 正本 → `node .cache/validate_events.mjs <故事名>` 校验 → 同步脚本刷副本 →
   CLI `-build` 打 `.tbg`（含 data/）→ CLI `-u` 上传到 `map_visual:<故事名>` → dev 验证。
   改了插件本体（`entry.ts` / `vue/`）只跑 `python -m toon_plugins plugins -i toonflow-field-survival`，
   **不要手跑 esbuild、不要手拷 `entry.js` / `ui/game.html`**（它们是编译产物，见 [规范.md](规范.md) §8.2）。

## 关键源文件索引

| 文件 | 作用 |
|------|------|
| `plugins/toonflow-field-survival/vue/src/mapConfig.ts` | Tiled JSON → MapConfig 解析、对象属性白名单、关卡名映射 |
| `plugins/toonflow-field-survival/vue/src/eventEngine.ts` | 事件运行时（加载/触发/ctx 构造/interval 定时器/proximity 点位） |
| `plugins/toonflow-field-survival/vue/src/eventScripts/_ctx.ts` | ctx API 类型契约（唯一权威） |
| `plugins/toonflow-field-survival/vue/src/storyMap.ts` | 故事视觉地图包加载 + `readStoryJson`（data/*.json 读取） |
| `plugins/toonflow-field-survival/vue/src/panels/ForgeAlchemyPanel.vue` | 锻造/炼丹面板（售卖分类子标签/打造/升级/溶解） |
| `plugins/toonflow-field-survival/vue/src/forgeOps.ts` | 面板操作逻辑（调后端命令 + AI 生成 + 结果弹窗） |
| `plugins/toonflow-field-survival/entry.ts` | 后端命令（`sys_*`：购买/打造/升级/溶解/假人奖励/任务…） |
| `plugins/toonflow-field-survival/vue/scripts/gen-shop-goods.mjs` | 设计文档 md 表格 → `data/shop.*.json` 货单生成器 |
| `plugins/toonflow-field-survival/vue/src/zipTbg.ts` | .tbg（zip）解析 |
| `.cache/validate_events.mjs` | 事件系统静态校验器 |
| `src/tools/toonflow-field-survival/map-editor/` | 地图编辑器（FastAPI + Vue） |
| `src/toon_plugins/cli.py` | CLI：安装插件 / 上传故事 / build .tbg |
