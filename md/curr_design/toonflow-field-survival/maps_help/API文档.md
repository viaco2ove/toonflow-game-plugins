# 地图事件 API 文档（toonflow-field-survival）

> 权威类型契约：`plugins/toonflow-field-survival/vue/src/eventScripts/_ctx.ts`
> 运行时实现：`plugins/toonflow-field-survival/vue/src/eventEngine.ts`
> 后端命令实现：`plugins/toonflow-field-survival/entry.ts`（`case "sys_xxx"`）
> **本文所有「实现状态」以 2026-10-28 的代码为准**（上一版停在 10-19，缺 proximity / interval / ctx.story 等）。

事件系统是「简化版魔兽触发器」：JSON 声明触发器 + TS 脚本写复杂逻辑，
所有进度 flag 存玩家卡，不碰地图集源文件。

```
events/
├── maps/<map>.events.json   # 声明式：trigger + conditions + actions
├── scripts/<name>.ts        # 命令式：default export async main(ctx)
├── shared/_ctx.ts           # ctx API 类型契约（引擎导出，脚本 import type）
└── 任务事件/quests.json      # 任务板数据（后端 questList 消费）

data/                        # ★ 地图集自带业务数据（货单等），脚本用 ctx.story.readJson 读
├── shop.forge.json
└── shop.alchemy.json
```

**三条铁律**（违反=白写）：

1. 引擎只实现了 §1.3 标 ✅ 的触发器，其余写了是**死事件**（不报错、不触发）。
2. 地图集自己的业务数据（货单/配置/文案表）放 `<故事>/data/*.json`，
   用 `ctx.story.readJson()` 读，**不许硬编码进插件源码**（见 §2.5 与 [规范.md](规范.md) 严重违规事项）。
3. 写完必跑 `node .cache/validate_events.mjs <故事名>`，0 error 才算写完。

---

## 1. 事件文件 events/maps/<map>.events.json

### 1.1 文件结构

```json
{
  "version": 1,
  "map": "mulberryTown",
  "ai": { "interval": { "idle": 20000 }, "maxManaged": 3 },
  "events": [ { "...": "见下" } ]
}
```

- **文件名必须与地图 JSON 主名一致**（`mulberryTown.events.json` 配 `maps/mulberryTown.json`），
  切图时按 mapFile 名 fetch。
- `version` 必须为 1；`events` 必须是数组，否则整份文件被跳过。
- `ai` 是**地图级 AI 托管配置**（可选），见 §1.6。

### 1.2 EventDef 单条事件

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 事件唯一 id（同文件内唯一；调试面板按它手动 fire） |
| `trigger` | object | 触发器，见 §1.3 |
| `conditions?` | array | 条件，全部满足才 fire，见 §1.4 |
| `actions` | array | 动作，**顺序执行**，见 §1.5 |
| `proximity?` | object | ★ 仅 `trigger.type="proximity"` 用：`{ label, icon, hint }` —— 靠近时按钮的文案/图标/提示 |
| `repeat?` | bool | true = 可重复触发（3 秒冷却，不占一次性名额）——采集类/面板类必填 |
| `comment?` | string | 备注（只读显示，不参与运行） |

**防重入规则**（`fireEvent`，`eventEngine.ts:455`）：

| 事件类型 | 行为 |
|----------|------|
| `repeat: true` | 3 秒冷却 Map；**不占** firedIds；条件不满足也进冷却（别把 condition 写在 repeat 事件上挡路） |
| 默认（无 repeat） | **每次加载地图只 fire 一次**；firedIds 在 `loadMapEvents` 时重置；**条件不满足也算用掉这次机会**（firedIds 在条件判定之前记入） |
| `trigger.type="interval"` | 完全走定时器（`tickIntervalEvents`），不占 firedIds、不叠加 repeat 冷却 |

调试面板 `fireEventManually(evId)` 会临时清掉 firedIds/冷却，可反复手动触发。

### 1.3 trigger 白名单（10 种，引擎实现 5 种）

| type | 参数 | 实现状态 | 触发时机 |
|------|------|----------|----------|
| `enter_map` | 无 | ✅ | 切图后 `onMapEntered`：清 flag 缓存 → 加载本图事件 → 顺序 fire 所有 enter_map |
| `interact` | `uid`（Tiled 对象 id） | ✅ | 走近实体弹「💬 聊天」后点击 → `onInteract(tiledId)`，字符串比较 uid |
| `proximity` | `uid` + `radius?`（米，默认 2.8，最小 0.8） | ✅ | 玩家进入半径 → HUD 弹**专属按钮**（文案取自事件顶层 `proximity.label/icon/hint`），点击 → 同 `onInteract` 链路 |
| `area_enter` | `zone`（区域名） + `ai?{gather}` | ✅ | `tickZones` 每 tick 检测玩家进出地图 `eventZones`，**只在新进入那一拍触发** |
| `interval` | `everyMs` + `when?`（any/combat/idle） | ✅ | `tickIntervalEvents` 每 tick 判到期；`everyMs` 硬下界 2000ms，单图最多 3 个 |
| `step_on` | `x, y` | ❌ | 写了不触发（v0.2） |
| `flag_set` | `key` | ❌ | 写了不触发 |
| `kill_count` | `gte` | ❌ | 写了不触发；击杀进度走后端任务系统 / 对象属性 `bounty`/`dropTable` |
| `turn_count` | `gte` | ❌ | 写了不触发 |
| `custom` | `name` | ❌ | 写了不触发 |

```json
// ① 进图旁白
{ "id": "E01_enter", "trigger": { "type": "enter_map" }, "actions": [{ "type": "subtitle", "text": "晨雾未散" }] }

// ② 走近 NPC 弹聊天后点击
{ "id": "E03_meet", "trigger": { "type": "interact", "uid": "219" }, "actions": [{ "type": "run_script", "script": "E03_xuanchen_bainian" }] }

// ③ ★ 靠近自动弹专属按钮（锻造/炼丹/对打都用这个）
{
  "id": "E50_forge_master",
  "comment": "走近锻造大师：走进即弹「锻造」按钮",
  "trigger": { "type": "proximity", "uid": "256", "radius": 2.8 },
  "proximity": { "label": "锻造", "icon": "🔨", "hint": "走近锻造大师" },
  "repeat": true,
  "actions": [{ "type": "run_script", "script": "E50_forge_master" }]
}

// ④ 走进区域（采集类，repeat + ai.gather）
{
  "id": "E11_herb_at",
  "trigger": { "type": "area_enter", "zone": "农田", "ai": { "gather": "herb" } },
  "repeat": true,
  "actions": [{ "type": "run_script", "script": "E11_herb_at" }]
}

// ⑤ 定时器（每 20 秒戳一下 AI 托管，仅非战斗时）
{
  "id": "E90_ai_tick",
  "trigger": { "type": "interval", "everyMs": 20000, "when": "idle" },
  "actions": [{ "type": "ai_trigger", "priority": "P2", "reason": "例行巡视" }]
}
```

**`interact` vs `proximity` 怎么选**

| | `interact` | `proximity` |
|---|---|---|
| 玩家侧入口 | 「💬 聊天」通用按钮 | 事件自己定义的按钮（🔨锻造 / 🔥炼丹 / ⚔对打） |
| 有 proximity 事件的实体 | — | **不再显示「💬 聊天」**（按钮接管，避免两个入口打架） |
| 适合 | 剧情对话、拾取、门 | 功能设施（面板类）、可反复使用的交互点 |

`area_enter` 的 `ai.gather` 是给 AI 托管的采集声明（可选）：取值
`herb / fish / wood / ore / other`，`ai/mapKnowledge.ts` 据此派生采集点；
缺省时按「事件 id → zone 名」顺序推断。见 §4。

### 1.4 conditions 白名单（4 种，只有 1 种生效）

| type | 参数 | 实现状态 |
|------|------|----------|
| `flag_check` | `key` + `value?` + `op?` | ✅。op：`eq`/`ne`/`exists`/`missing`；**缺省 op = `value !== undefined ? "eq" : "exists"`** |
| `phase_done` | `phaseId` | ❌ 直接查 `phase_x_done` flag 代替 |
| `level_gte` | `level` | ❌ |
| `random` | `p` | ❌ 要随机请写 TS 脚本 |

```json
{ "type": "flag_check", "key": "phase_1_done", "op": "missing" }
{ "type": "flag_check", "key": "met_luwenzhao", "value": true }
```

### 1.5 actions 白名单（12 种，全部有实现或明确占位）

| type | 参数 | 实现状态 |
|------|------|----------|
| `set_flag` | `key`, `value` | ✅ |
| `del_flag` | `key` | ✅ |
| `toast` | `text`, `color?`（gold/red/white/blue） | ✅ 右下角飘字 |
| `subtitle` | `text`, `duration?`（ms） | ✅ 顶部大字幕 |
| `event_log` | `text` | ✅ HUD 事件流（state.events） |
| `teleport` | `map`（关卡英文名）, `x`, `y`（世界米） | ✅ 切图 + 落点（夹边界/避墙） |
| `run_script` | `script`（不含 .ts） | ⚠️ 执行已实现；**`args` 当前不透传**——要参数请读 flag 或写死在脚本里 |
| `wait` | `ms` | ✅ setTimeout 顺序阻塞 |
| `ai_trigger` | `priority?`（P0/P1/P2）, `reason?`, `target?` | ✅ 唤醒 AI 托管角色的大脑（见 §1.6） |
| `ai_interval` | `engaged?`/`skirmish?`/`idle?`/`all?`（ms） | ✅ 覆盖本图 AI 决策间隔（下界 3000/5000，上界 30000） |
| `call_action` | `name`, `args?` | ❌ console.warn；`registerAction` 也是 no-op |
| `llm_speak` | `npcId`, `npcName`, `userText` | ⚠️ 走 `ctx.llm.speak`，**当前占位返回空串** |

```json
{
  "id": "E07_to_forest",
  "comment": "镇口 → 桑林",
  "trigger": { "type": "interact", "uid": "219" },
  "conditions": [{ "type": "flag_check", "key": "phase_1_done", "value": true }],
  "actions": [
    { "type": "toast", "text": "夜色更深了……", "color": "gold" },
    { "type": "wait", "ms": 400 },
    { "type": "teleport", "map": "Mulberry Forest", "x": 1, "y": 25 }
  ]
}
```

### 1.6 地图级 AI 配置与 interval 约束

```json
{
  "version": 1,
  "map": "mulberryTown",
  "ai": {
    "interval": { "engaged": 5000, "skirmish": 10000, "idle": 20000 },
    "maxManaged": 3
  },
  "events": [ ... ]
}
```

| 项 | 说明 |
|----|------|
| `ai.interval` | 本图 AI 决策间隔（ms）。玩家配置（`ai/aiConfig.ts`，落 sessionId="all"）**优先于**地图集覆写；`ai_interval` 动作可在运行中再覆盖 |
| `ai.maxManaged` | 本图最多托管几个角色 |
| interval 硬下界 | `everyMs ≥ 2000`，写更小会被钳制并打 warn（LLM 决策会堆积而不是变快） |
| interval 数量上限 | 单图最多 3 个，超出只前 3 个生效 |
| interval 冷却 | 相邻两次触发至少间隔 1000ms |
| `when` | `any`（默认）/ `combat`（玩家处于遭遇/战斗才触发）/ `idle`（非战斗才触发） |
| 清理时机 | 切图时重建定时器 + 清空 `ai_interval` 覆盖 |

`ai_trigger.priority`：`P0` 无条件立即决策（紧急）／`P1` 可打断 move·wait·follow／`P2` 不打断（默认）。
`target` 可选：`"ally:名字"` / 角色 id / 纯名字，缺省 = 全部托管角色。

### 1.7 加载链路（排查「事件不触发」看这里）

```
切图 → App.vue afterMapSwitchForEvents(mapFile)
     → eventEngine.onMapEntered(mapFile)
         → invalidateFlagCache()                      # 后端/面板可能改过 flag，先丢缓存
         → loadMapEvents(mapFile)                     # firedIds 重置 + fetch 事件文件
             fetch 前缀链（按序尝试，失败静默下一个）：
               dev:        /story-data/toonflow-field-survival/map_design/<url编码故事名>/events/maps/
               getAsset 环境: assetUrl("events/maps/") → "events/maps/" → "./events/maps/"
         → 顺序 fire 所有 enter_map 事件
         → resetIntervalTimers(events)                # 重建 interval 定时器 + 清空 ai_interval
玩家交互 → onInteract(tiledId)        # interact 与 proximity 都走这里
玩家靠近 → getProximityPoints()       # App.vue 每帧取点位 → 最近的弹按钮
玩家移动 → tickZones(px, py)          # 仅新进入的区域名 → onAreaEnter(zone)
每 tick  → tickIntervalEvents()       # interval 到期判定
```

**dev 与真宿主读的不是同一份文件**：dev 走 `/story-data` 中间件直读 workshops 源文件；
真宿主走 `.tbg`/static 副本。改了 workshops 不同步/不重传 = 真机不生效。

---

## 2. TS 脚本 ctx API

### 2.1 脚本骨架（照抄这个结构）

```ts
/**
 * SY_E01_night_open — 一句话说明
 * trigger: enter_map；flag: phase_1_active / phase_1_done
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("phase_1_active", true);
  ctx.ui.subtitle("桑镇 · 夜", 2200);
  ctx.ui.toast("夜色压在桑镇的屋檐上。", "white");

  const ok = await ctx.ui.confirm({
    title: "取木",
    detail: "木堆码得整齐，边上散着几根短料——要取些吗？",
    confirmText: "取一根",
    cancelText: "算了",
  });
  if (!ok) return;
  ctx.bag.give("松木", 1);
}
```

硬性要求：

1. **default export** 一个 `async (ctx: Ctx) => Promise<void>`。
2. `import type { Ctx } from "../shared/_ctx"`（type-only，不参与构建）；
   同步到 `vue/src/eventScripts/` 时 import 要改写成 `./_ctx`。
3. 文件名 = `run_script` 引用的名字（不含 .ts），**且所有故事共用一个运行目录**，
   必须加故事前缀避免撞名：赦夜人 `SY_`，通天传授 `E01_`/`E50_`/`E70_`。
4. 只允许调 §2.2 表内的 ctx API（校验器正则扫描白名单，白名单外直接 error）。
5. 禁止 `while(true)` / `for(;;)`（校验器报错）；异步等待用 `await`，脚本异常会被
   fireEvent 的 try/catch 吞掉打 console.error，不会崩游戏——但事件就断了。

### 2.2 ctx 全量 API

**身份与上下文**

| API | 签名 | 行为与坑 |
|-----|------|----------|
| `ctx.player` | `Entity`（只读快照） | 改数值请走 save/level API / `ctx.cmd`；取不到玩家时有兜底假对象 |
| `ctx.mapName` | `string` | 当前地图文件名（不含 .json） |
| `ctx.actor` | `{ roleId: string; ai: boolean; name: string }` | 执行者。`roleId=""` = 玩家本人；非空 = AI 托管角色。**采集/交互脚本必须据此分流**，见 §2.3 |
| `ctx.event` | `{ id: string; uid?: string; args: Record<string, unknown> }` | ★ **当前触发事件上下文**。`id` = 事件 id；`uid` = 触发实体（Tiled 对象 id，`proximity`/`interact` 才有）；`args` = `run_script` 动作里透传的参数。详见 §2.8 |
| `ctx.playerCard` | `{ level: number; money: number; hp: number; maxHp: number }` | ★ **玩家卡只读快照**。用于按等级/金币/血量分支。取不到时返回 `{level:1, money:0, hp:0, maxHp:0}`。详见 §2.8 |

**存档（flag）**

| API | 签名 | 行为与坑 |
|-----|------|----------|
| `ctx.save.getFlag<T>(key)` | `Promise<T \| null>` | 读玩家卡 flag（`t_plugin_session_data` 的 `player_flags`） |
| `ctx.save.setFlag(key, value)` | `Promise<void>` | 写 flag（立即落库） |
| `ctx.save.delFlag(key)` | `Promise<void>` | 删 flag |
| `ctx.save.all()` | `Promise<Record<string, unknown>>` | 一次读全部 flags |

**NPC / 实体**

| API | 签名 | 行为与坑 |
|-----|------|----------|
| `ctx.npc.byUid(uid)` | `Entity \| null` | 按 Tiled 对象 id 查实体（认 `mapnpc_*` 与 `mapmob_*`），返回**快照** |
| `ctx.npc.setField(uid, patch)` | `boolean` | ★ 直接改实体字段（`side`/`hp`/`alive`/`dummyMode`…），走 `entityRef` 可变引用。改快照没用，必须用它。返回是否改成功 |
| `ctx.npc.setLabel / move / faceTo` | — | ❌ **TODO 空实现，调用不报错但什么都不发生** |

**UI 反馈**

| API | 签名 | 行为与坑 |
|-----|------|----------|
| `ctx.ui.toast(text, color?)` | `void` | 右下角飘字；color: gold/red/white/blue |
| `ctx.ui.subtitle(text, durationMs?)` | `void` | 顶部大字幕（剧情节点） |
| `ctx.ui.event(text)` | `void` | HUD 事件流（state.events，EventPanel 可见） |
| `ctx.ui.confirm(opts)` | `Promise<boolean>` | 确认弹窗 `{title, detail?, confirmText?, cancelText?}`。**AI 执行者自动 resolve(true)** |
| `ctx.ui.select(opts)` | `Promise<string \| null>` | ★ 多选面板 `{title, detail?, options:[{label,value,desc?}]}`。取消 → null。**AI 自动选第一个** |
| `ctx.ui.prompt(opts)` | `Promise<string \| null>` | ★ 文本输入 `{title, detail?, placeholder?, defaultValue?}`。取消 → null。**AI 自动返回 defaultValue/空串** |
| `ctx.ui.openShopPanel(opts)` | `void` | ★ 打开锻造/炼丹多标签面板，见 §2.7。**AI 执行者自动忽略** |
| `ctx.ui.notice(opts)` | `Promise<void>` | ★ **结果模态弹窗** `{title, detail?, confirmText?}`。用于「购买成功 / 打造成功」这类需要明确反馈的结果。**AI 执行者自动跳过（立即 resolve）**。见 §2.8 |

**AI 生成 / 背包**

| API | 签名 | 行为与坑 |
|-----|------|----------|
| `ctx.ai.generate(agent, prompt, opts?)` | `Promise<string>` | 调宿主 agent，返回纯文本（通常是 JSON）。失败返回空串。**AI 执行者自动返回空串**（不烧玩家资源） |
| `ctx.bag.give(name, count?)` | `void` | 发物品。玩家 → 背包（`sys_item_add` 链）；**AI → 该角色 `_aiBag` 私藏** |
| `ctx.bag.list()` | `Promise<Item[]>` | ★ 读背包（`{name,count,kind,rarity,heal,lv?,desc?}`）；AI 时读它自己的私藏 |
| `ctx.bag.remove(name, count?)` | `Promise<boolean>` | ★ 移除物品（升级/溶解替换用）；AI 时跳过并返回 false |

**关卡 / 音效 / LLM / 杂项**

| API | 签名 | 行为与坑 |
|-----|------|----------|
| `ctx.level.switchTo(mapFile, x, y)` | `void` | 切图 + 落点（世界米，会夹边界/避墙）。参数吃关卡英文名（过 levelNameToFile） |
| `ctx.level.setLocked(mapFile, locked)` | `void` | 写 flag `map_locked_<mapFile>`（portal 可用性） |
| `ctx.audio.play(name)` | `void` | ❌ no-op 占位 |
| `ctx.llm.speak(npcId, npcName, userText, opts?)` | `Promise<string>` | ⚠️ **占位实现，返回空串**；NPC 对话请用 toast/subtitle |
| `ctx.registerAction(name, fn)` | `void` | ❌ no-op 占位 |
| `ctx.cmd(action, params?)` | `Promise<string>` | ★ 调后端命令（`sendTick` 通道）。⚠️ **不等回执**（立即 resolve 空串）——要拿后端结果得写在前端（如 `forgeOps.ts` 的 `sendSysCmdAwait`）。命令清单见 §2.6 |
| `ctx.story.readJson<T>(path)` | `Promise<T \| null>` | ★ 读故事包内任意 JSON，见 §2.5 |

Entity 类型：

```ts
interface Entity {
  id: string; name: string;
  side: "player" | "ally" | "enemy" | "neutral";
  x: number; y: number;          // 世界米
  hp: number; maxHp: number;
  level?: number;
  camp?: "hostile" | "neutral" | "friendly";
  [key: string]: unknown;        // 后端实体的其它字段原样透出
}
```

### 2.3 AI 托管分流（写采集/设施脚本必读）

玩家触发 vs AI 托管角色触发，走的是同一条链（fireEvent → runActions → runScript），
差别只在 `ctx.actor`：

| | 玩家（roleId=""） | AI 托管（roleId 非空） |
|----|------------------|-----------------------|
| `ctx.actor.ai` | false | true |
| `ctx.ui.confirm` | 真弹窗等玩家点 | **自动同意** |
| `ctx.ui.select` | 真面板等玩家选 | **自动选第一个选项** |
| `ctx.ui.prompt` | 真输入框 | **自动返回 defaultValue/空串** |
| `ctx.ui.openShopPanel` | 真开面板 | **自动忽略**（只留日志） |
| `ctx.ai.generate` | 真调模型 | **返回空串**（不烧资源） |
| `ctx.bag.give` | 进玩家背包 | 进该角色 `_aiBag`（`ai_bag_add` 通道） |
| `ctx.bag.remove` | 真扣 | 跳过（AI 不动玩家背包） |
| `ctx.cmd` | 真发命令 | 只记日志，不发 |
| 叙事人称 | 「你」 | 用 `ctx.actor.name` |

```ts
const who = ctx.actor.ai ? ctx.actor.name : "你";
const ok = await ctx.ui.confirm({ title: "取木", detail: `${who}伸手去够那根短料…` });
if (!ok) return;
ctx.bag.give("松木", 1);   // AI 采集自动进它自己的私藏
```

### 2.4 flag 存储约定

- 事件引擎的 flag 全量存在一个 key 下：`t_plugin_session_data` 的 `player_flags`（一个对象）。
- 与后端 `entry.ts` 的 `persistSys`/`sys_state` 同库不同 key，互不干扰；但**后端/系统面板
  也会写 flag**（如假人摧毁 `dummy_destroyed_<实体id>`、任务完成 `q01_done`），这些写入绕过
  前端缓存 → 切图时 `invalidateFlagCache()` 强制重读。
- **不要在脚本里直接调 pluginData**，一律走 `ctx.save.*`，否则缓存不一致导致判定读陈旧值。
- 保留前缀：`map_locked_<mapFile>`、`phase_<n>_done/active`、`q<n>_done`、
  `dummy_mode_<tiledId>` / `dummy_destroyed_<实体id>`。

### 2.5 ctx.story.readJson —— 地图集自带数据（★ 新）

地图集自己的业务数据（货单、文案表、配置）**放在故事目录里**，不要写进插件源码：

```
workshops/toonflow-field-survival/map_design/<故事名>/data/xxx.json
```

脚本里这样读：

```ts
const raw = await ctx.story.readJson<{ goods?: ShopGood[] } | ShopGood[]>("data/shop.forge.json");
const goods = Array.isArray(raw) ? raw : Array.isArray(raw?.goods) ? raw.goods : [];
```

| 项 | 说明 |
|----|------|
| 路径 | **相对故事根目录**，如 `"data/shop.forge.json"`、`"maps/mulberryTown.json"` |
| 安装后通道 | 读 `map_visual` 的 `.tbg` 包内同名条目（zip 里的 `.json` 已解析成对象） |
| dev 通道 | `fetch /story-data/toonflow-field-survival/map_design/<story>/<path>`（回退 `map_design_pre`） |
| 返回值 | JSON 对象/数组；**文件不存在或解析失败返回 `null`**（脚本必须自己兜底，不要静默造假数据） |
| 缓存 | 按 path 缓存（一局内不变）；重打包后需刷新页面 |
| ⚠️ 必做 | 改了 `data/` 下的文件 → **必须重建 `.tbg`**（`-build`），否则安装态读不到；dev-host 由 vite 中间件自动重打 |

**为什么不用 import**：脚本会被构建期内联进 `ui/game.html`，`import` 会把数据复制进插件产物——
那就是「把地图集业务写进插件」，下次改数据还得重编插件。

### 2.6 ctx.cmd 可用后端命令（节选，全量见 entry.ts）

| 命令 | 参数 | 作用 |
|------|------|------|
| `sys_item_add` | `name, count` | 发物品（= `ctx.bag.give` 底层） |
| `sys_bag_remove` | `name, count` | 扣物品 |
| `sys_shop_buy` | `id, count, good?` | 购买。`good` 是**地图集自带货单**那一件商品（插件侧没有权威副本，必须带上来），后端校验 `name` 非空 + `price>0` |
| `sys_forge_create` | `input, level, aiJson?, blueprint?` | 锻造打造（扣 10 金；`blueprint` 由后端扣 1 张，产物按图纸记载） |
| `sys_alchemy_create` | `input, level, aiJson?, blueprint?` | 炼丹（同上，药方） |
| `sys_item_upgrade` | `oldName, cost, aiJson` | 升级装备（旧件换新件；前端已扣铁矿石/灵石碎屑） |
| `sys_item_dissolve` | `name, rarity, lv, heal, isPill` | 溶解返还材料（装备返还铁矿石/灵石碎屑，丹药返还草药） |
| `sys_dummy_reward` | `exp, name` | 练习假人击碎奖励（发经验） |
| `sys_quest_board` / `sys_quest_accept` / `sys_quest_turnin` | — | 任务板 |
| `sys_rest` / `sys_teleport` / `sys_party` / `sys_use_item` | — | 休息/传送/组队/使用物品 |

### 2.7 ctx.ui.openShopPanel —— 锻造/炼丹面板（★ 新）

```ts
ctx.ui.openShopPanel({
  mode: "forge",        // "forge" 锻造（售卖/打造/升级/溶解）| "alchemy" 炼丹（售卖/炼丹/溶解）
  tab: "sell",          // 初始标签：sell / craft / alchemy / upgrade / dissolve
  goods,                // ★ 售卖清单，来自 data/shop.*.json（插件不存商品数据）
});
```

`goods` 单件结构（`ShopGood`）：

```ts
{
  id: string; name: string; price: number;
  kind: "consumable" | "material" | "equipment" | "skill_book" | "quest";
  rarity: "common" | "fine" | "rare" | "epic" | "legend";
  heal?: number; desc?: string;
  from?: string;        // 货源标记（forge_master / alchemy_furnace…）
  cat?: string;         // ★ 售卖子标签分类（材料/武器/防具/饰品/图纸/技能/特殊 或 药草/辅料/…）
}
```

- `cat` 决定售卖页的子标签分组；**没写 `cat` 时前端按名称关键词兜底猜**，但会猜错（尤其武器/饰品），
  所以生成器必须写全。
- `goods` 省略 = 该面板售卖页为空（不会去插件里找兜底数据）。
- 面板里的打造/升级/溶解走 `vue/src/forgeOps.ts`（前端，直接调后端命令 + `ctx.ai.generate`），
  脚本只负责「读货单 + 开面板」。
- 完整制作步骤见 [地图集事件案例/锻造师or炼丹炉.地图集制作案例.md](地图集事件案例/锻造师or炼丹炉.地图集制作案例.md)。

---

### 2.8 ★ 事件上下文与结果反馈（ctx.event / ctx.playerCard / ctx.ui.notice）

> 这三项是「引擎内部状态/通道」，地图集侧无法绕过，因此放在插件里；**但它们是通用能力，
> 不含任何故事的业务语义**（没有 `ctx.forge.open()` 这种东西）。

#### 2.8.1 ctx.event —— 当前触发事件上下文

```ts
ctx.event: {
  id: string;                    // 事件 id（events.json 里那条的 id）
  uid?: string;                  // 触发实体的 Tiled 对象 id；interact / proximity 才有
  args: Record<string, unknown>; // run_script 动作里写的 args（透传，原样）
}
```

**为什么需要**：以前 `run_script` 的 `args` 被引擎直接丢弃，且脚本不知道是哪个对象触发的，
只能「猜目标」（例如训练假人脚本里写死 `uids = [251,252,253,254]` 再取最近的一个）。
现在这两个信息都能直接拿到：

```ts
// events/maps/xxx.events.json
{
  "id": "dummy_hit",
  "trigger": { "type": "interact", "uid": "253" },
  "actions": [
    { "type": "run_script", "script": "E70_training_dummy", "args": { "mode": "duel" } }
  ]
}
```

```ts
// events/scripts/E70_training_dummy.ts
export default async function (ctx: Ctx) {
  // ★ 不用再猜：直接用触发事件的 uid
  const uid = ctx.event.uid;                  // "253"
  const mode = String(ctx.event.args.mode || "stand");   // "duel"

  const target = uid ? ctx.npc.byUid(uid) : null;
  if (!target) { ctx.ui.toast("没找到目标", "red"); return; }
  ...
}
```

**坑**：

| 坑 | 说明 |
|----|------|
| `args` 非对象会被归空 | `args: "abc"` / `args: []` → 一律变成 `{}`，脚本里直接当空对象用 |
| `uid` 只有 interact/proximity 有 | `enter_map` / `area_enter` / `interval` 触发时 `uid` 是 `undefined` |
| 同一个脚本服务多个对象时 | 用 `ctx.event.uid` 区分，别写死 uid 列表 |
| 手动调 `runScript`（脚本内调脚本） | `ctx.event` 会是空上下文（`id=""`、`args={}`），脚本要能容忍 |

#### 2.8.2 ctx.playerCard —— 玩家卡只读快照

```ts
ctx.playerCard: {
  level: number;   // 玩家等级，>= 1
  money: number;   // 金币
  hp: number;      // 当前血量
  maxHp: number;   // 最大血量
}
```

用途：**按玩家状态分支**，而不必先去 `ctx.cmd` 拿回执（`ctx.cmd` 不等回执，见 §2.2）。

```ts
if (ctx.playerCard.level >= 20) {
  ctx.ui.toast("你的修为已足以挑战掌门", "gold");
} else if (ctx.playerCard.money < 100) {
  ctx.ui.toast("盘缠不足", "red");
}
```

**坑**：

- 这是**只读快照**，改数值要走 `ctx.cmd` / `ctx.save`；改了不会回写。
- 取不到玩家实体时 hp/maxHp 为 0，level 兜底 1，money 取当前金币。
- **AI 执行者拿到的是同一个玩家卡快照**（不是 AI 自己的属性）。AI 自己的属性在 `ctx.actor` / `ctx.npc.byUid(roleId)`。

#### 2.8.3 ctx.ui.notice —— 结果模态弹窗

```ts
await ctx.ui.notice({
  title: "打造成功",
  detail: "获得【精铁剑】×1",
  confirmText: "确定",     // 可选，默认「确定」
});
```

用途：**结果反馈不能只用 toast**（toast 会飘走、玩家看不见），凡「购买成功 / 打造成功 /
任务完成 / 重要奖励」这类必须让玩家确认的结果，都用 `notice`。

**坑**：

- `notice` 是 `Promise`，**要 await**（不 await 也能弹，但 await 后面的代码在玩家点确认前不会执行）。
- **AI 执行者自动跳过**（立即 resolve），不会打断 AI 托管流程。
- 字段名兼容 `confirmText`（脚本侧）/ `okText`（面板侧），传 `confirmText` 即可。
- 无 `detail` 时就是一个只有标题 + 确定按钮的提示框。

#### 2.8.4 校验器白名单

上述三项已加入 `validate_events.mjs` 的 `CTX_API` 白名单：

```
ui.notice
event.id  event.uid  event.args
playerCard.level  playerCard.money  playerCard.hp  playerCard.maxHp
```

未在白名单里的 ctx 调用会被判 **error**（注释里写非法调用原文**同样**会被扫到）。

---

## 3. quests.json 任务 API

后端 `entry.ts` 每 tick 消费（questList / syncQuest*），任务板 UI 展示。

### 3.1 文件结构

```json
{ "version": 1, "quests": [ { "id": "Q01", "...": "见下" } ] }
```

### 3.2 quest 字段表

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 任务 id（Q01…） |
| `title` / `desc` | string | ✅ | 标题 / 描述 |
| `type` | string | ✅ | `kill` / `gather` / `escort` / `deliver` / `explore` / `talk`（缺省按首个 objective 推） |
| `giver` | string | | 发布者（如「任务板」） |
| `map` | string | | 关联地图，写**关卡 key ①**（如 `mulberryGraveyard`） |
| `level` | int | | 推荐等级 |
| `objectives` | array | ✅ | 目标列表，见 §3.3 |
| `reward` | object | | `{ exp, money, items: [{name, count}] }` |
| `repeat` | bool | | 可重复接取 |
| `flags` | object | | `{ done: "q01_done" }`——完成后端回写该 flag |
| `timeLimitTicks` | int | | 限时（**1 tick = 100ms**，6000 = 600 秒）；超时 status=failed |
| `cargo` | object | | 护送货物 `{ name, hp }`；接取时在玩家身边生成，跨图跟随 |
| `consume` | array | | 完成时消耗物品 `[{name, count}]`（deliver 类） |

### 3.3 objective kind（5 种）

| kind | 字段 | 说明 |
|------|------|------|
| `kill` | `target`（怪名）, `count` | 击杀计数（后端 p.kill） |
| `gather` | `target`（物品名）, `count` | 采集/持有计数（购买也算进度） |
| `talk` | `uid` 或 `target` | 对话计数（p.talked） |
| `arrive` | `map`, `x`, `y`, `radius?`, `confirm?` | 到达目标点（**世界米**）；`confirm:true` = 需玩家点「到达」 |
| `explore` | 同 arrive | 语义同 arrive；提示走 questMapKey 归一化 |

arrive 判定：radius 默认 `QUEST_ARRIVE_DEFAULT_R`（最小 0.5 米）；`map` 用 `questMapKey()`
归一化后比较——**写中文图名会被归一化，可能对上**，但跨图任务建议写关卡 key ①。

### 3.4 与事件/flag 的联动

- 任务完成 → 后端写 `flags.done` → 事件里 `flag_check` 可读（如 `q06_done` 触发 E09）。
- `repeat: true` 任务不写 done flag。
- 护送货物丢失 → 任务板显示「货物：已丢失」。

---

## 4. ai.gather 采集声明与采集寻路

| 环节 | 文件 | 作用 |
|------|------|------|
| 声明 | 事件 JSON `trigger.ai.gather`（herb/fish/wood/ore/other） | 告诉 AI 托管「这个 zone 能采什么」；`ai/mapKnowledge.ts` 读取并派生采集点 |
| 推断 | 缺省时按「事件 id → zone 名」顺序推断 | 例：事件 id 含 herb → herb |
| 寻路 | `vue/src/questGatherMap.ts` `GATHER_ZONES_BY_ITEM` | 物品名 → 采集区 zone 名 + gatherKind + mapKey；采集任务寻路按它找最近采集点 |

**三处名字必须一致**：地图 `eventZones[].name` = 事件 `trigger.zone` = questGatherMap 的 `zone`。
新增采集区：地图加 zone → 事件加 area_enter(repeat + ai.gather) → 脚本给物品 → questGatherMap 登记。

---

## 5. 校验器 validate_events.mjs

```
node .cache/validate_events.mjs [collection_dir]
# collection_dir 缺省 = 通天传授-收徒系统；ROOT 硬编码 workshops/toonflow-field-survival/map_design
```

检查项（白名单与 `_ctx.ts` 同步维护，改接口时两边一起改）：

| # | 检查 | 失败级别 |
|---|------|----------|
| 1 | events/maps/*.events.json JSON 语法 + schema（trigger/condition/action 白名单；version=1；events 是数组；map 在 maps/ 存在） | ✗ error |
| 2 | interact/proximity 的 uid 在 `maps/<map>.json` Actors 层对象里真实存在 | ✗ error |
| 3 | teleport 目标经 `levelNameToFile` 可解析为 maps/ 下文件 | ✗ error |
| 4 | run_script 的 .ts 在 events/scripts/ 存在 | ✗ error |
| 5 | flag key 被写入多种类型 | ⚠ warn |
| 6 | TS 脚本 `ctx.*` 调用在白名单（CTX_API）+ 禁 while(true)/for(;;) | ✗ error |
| 7 | 副本一致性：events/scripts ↔ vue/src/eventScripts；events/maps ↔ vue/public/events/maps 和 ui/events/maps（对比时把 `../shared/_ctx` 归一成 `./_ctx`、行尾 CRLF/LF 归一） | ⚠ warn |

CTX_API 白名单（当前）：

```
save.getFlag/setFlag/delFlag/all
npc.byUid/setLabel/move/faceTo/setField
ui.toast/subtitle/event/confirm/select/prompt/openShopPanel/notice
ai.generate
bag.give/list/remove
story.readJson
level.switchTo/setLocked
audio.play   llm.speak   registerAction
actor.roleId/ai/name
event.id/event.uid/event.args
playerCard.level/playerCard.money/playerCard.hp/playerCard.maxHp
```

退出码：有 ✗ → exit 1。**写完/改完事件必跑，跑到 0 error 再同步、再打 .tbg。**
⚠️ 项要看：副本不一致通常意味着「插件里跑的是旧脚本」，dev 看不出来、真机一定出问题。
但 `vue/public/events/maps`、`ui/events/maps` 是**全故事共享目录**（同时只放一个故事），
校验非当前故事时的「副本缺文件」是预期的。

---

## 6. API 速查：一张图从数据到表现

| 你想让游戏发生什么 | 用哪个 API |
|------------------|-----------|
| 进图播旁白/指引 | `enter_map` 事件 + toast/subtitle/event_log，或 run_script |
| NPC 对话/交互 | `interact {uid}`；复杂对话写脚本；`llm.speak` 目前是占位 |
| 走近设施弹专属按钮（锻造/炼丹/对打） | `proximity {uid, radius}` + 顶层 `proximity {label,icon,hint}` |
| 打开锻造/炼丹面板 | `ctx.ui.openShopPanel({mode,tab,goods})`，goods 来自 `data/shop.*.json` |
| 玩家走进某区域触发 | 地图 `eventZones` + `area_enter {zone}` |
| 每隔一段时间做事 | `interval {everyMs, when}` + `ai_trigger` / toast |
| 让 AI 托管立刻想一下 | 动作 `ai_trigger {priority, reason, target}` |
| 改本图 AI 决策频率 | 事件文件顶层 `ai.interval` 或动作 `ai_interval` |
| 传送玩家 | `teleport {map,x,y}`（英文图名+世界米）或 `ctx.level.switchTo` |
| 记录剧情进度 | `set_flag` / `ctx.save.setFlag`，命名 `phase_<n>_done` |
| 发物品 | `ctx.bag.give(name,count)`（走 sys_item_add 链） |
| 要玩家确认/选择/输入 | `ctx.ui.confirm` / `select` / `prompt`（AI 自动通过） |
| 购买/打造成功后弹窗告知 | `await ctx.ui.notice({title, detail})`（AI 自动跳过） |
| 脚本要知道自己被谁触发 | `ctx.event.uid`（interact/proximity 才有）+ `ctx.event.id` |
| 脚本要拿 run_script 里配的参数 | `ctx.event.args`（透传，非对象归空为 `{}`） |
| 按玩家等级/金币/血量分支 | `ctx.playerCard.{level,money,hp,maxHp}`（只读快照） |
| 读地图集自己的数据文件 | `ctx.story.readJson("data/xxx.json")` |
| 改实体阵营/血量（假人） | `ctx.npc.setField(uid, {side, hp, dummyMode})` |
| 击杀奖励/掉落 | 野怪对象属性 `bounty` / `dropTable`（**不是** kill_count 事件） |
| 随机/循环/多步分支 | 只能写 TS 脚本（条件白名单里没有 random） |
| 锁图/解锁 | `ctx.level.setLocked`（flag `map_locked_<map>`） |

---

## 7. 变更记录

**2026-10-28**

- 新增 `proximity` 触发器（靠近弹专属按钮）+ 事件顶层 `proximity{label,icon,hint}`。
- 新增 `interval` 触发器 + `ai_trigger` / `ai_interval` 动作 + 事件文件顶层 `ai` 配置。
- 新增 ctx API：`actor`、`ui.select`、`ui.prompt`、`ui.openShopPanel`、`ai.generate`、
  `bag.list`、`bag.remove`、`npc.setField`、`cmd`、`story.readJson`。
- 新增 `data/` 目录约定：地图集业务数据（货单等）随故事包走，插件不再存商品数据。
- 修正 §1.3/§1.5 实现状态表（原文档只写了 3 种触发器）。
- 校验器白名单同步：trigger 增 `proximity`/`interval`，action 增 `ai_trigger`/`ai_interval`，
  CTX_API 增 `npc.setField`/`ui.select`/`ui.prompt`/`ui.openShopPanel`/`ai.generate`/`bag.list`/`bag.remove`/`story.readJson`。
- 新增 §2.8：`ctx.event`（事件上下文 `{id,uid,args}`）、`ctx.playerCard`（玩家卡只读快照）、
  `ctx.ui.notice`（结果模态弹窗）三项通用 ctx API；`run_script` 动作的 `args` 现已透传到
  `ctx.event.args`，触发实体的 uid 透传到 `ctx.event.uid`。
- 校验器白名单同步：CTX_API 增 `ui.notice`/`event.id`/`event.uid`/`event.args`/
  `playerCard.level`/`playerCard.money`/`playerCard.hp`/`playerCard.maxHp`。
