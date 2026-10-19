# 地图事件 API 文档（toonflow-field-survival）

> 权威类型契约：`plugins/toonflow-field-survival/vue/src/eventScripts/_ctx.ts`
> 运行时实现：`plugins/toonflow-field-survival/vue/src/eventEngine.ts`
> 本文所有「实现状态」以 `eventEngine.ts` 当前代码为准（2026-10-19）。

事件系统是「简化版魔兽触发器」：JSON 声明触发器 + TS 脚本写复杂逻辑，
所有进度 flag 存玩家卡，不碰地图集源文件。

```
events/
├── maps/<map>.events.json   # 声明式：trigger + conditions + actions
├── scripts/<name>.ts        # 命令式：default export async main(ctx)
├── shared/_ctx.ts           # ctx API 类型契约（引擎导出，脚本 import type）
└── 任务事件/quests.json      # 任务板数据（后端 questList 消费）
```

---

## 1. 事件文件 events/maps/<map>.events.json

### 1.1 文件结构

```json
{
  "version": 1,
  "map": "mulberryTown",
  "events": [ { "...": "见下" } ]
}
```

- **文件名必须与地图 JSON 主名一致**（`mulberryTown.events.json` 配 `maps/mulberryTown.json`），
  切图时按 mapFile 名 fetch。
- `version` 必须为 1；`events` 必须是数组，否则整份文件被跳过。

### 1.2 EventDef 单条事件

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 事件唯一 id（同文件内唯一；调试面板按它手动 fire） |
| `trigger` | object | 触发器，见 §1.3 |
| `conditions?` | array | 条件，全部满足才 fire，见 §1.4 |
| `actions` | array | 动作，**顺序执行**，见 §1.5 |
| `repeat?` | bool | true = 可重复触发（3 秒冷却，不占一次性名额）——采集类必填 |
| `comment?` | string | 备注（只读显示，不参与运行） |

**防重入规则**（fireEvent）：

- `repeat: true` → 3 秒冷却 Map；条件不满足也会进冷却（别把条件写在 repeat 事件里挡路）。
- 默认（无 repeat）→ **每次加载地图只 fire 一次**；firedIds 在 `loadMapEvents` 时重置，
  所以「同一张图同一次进入内只触发一次」，且**条件不满足也消耗这次机会**
  （firedIds 在条件判定之前就记入）。调试面板 `fireEventManually` 可绕过。

### 1.3 trigger 白名单（8 种，引擎只实现 3 种）

| type | 参数 | 实现状态 | 触发时机 |
|------|------|----------|----------|
| `enter_map` | 无 | ✅ 已实现 | 切图后 `onMapEntered`：先清 flag 缓存 → 加载本图事件 → 按定义顺序 fire 所有 enter_map |
| `interact` | `uid`（Tiled 对象 id，数字） | ✅ 已实现 | 玩家与对象交互时 `onInteract(tiledId)`，字符串比较 |
| `area_enter` | `zone`（区域名） + `ai?{gather}` | ✅ 已实现 | `tickZones` 每 tick 检测玩家进出 eventZones，**只在新进入的那一拍触发** |
| `step_on` | `x, y` | ❌ 未实现（v0.2） | 写了不会触发——死事件 |
| `flag_set` | `key` | ❌ 未实现（v0.2） | 写了不会触发 |
| `kill_count` | `gte` | ❌ 未实现（v0.2） | 写了不会触发；击杀进度走后端任务系统/对象属性 |
| `turn_count` | `gte` | ❌ 未实现（v0.2） | 写了不会触发 |
| `custom` | `name` | ❌ 未实现（v0.2） | 写了不会触发 |

`area_enter` 的 `ai.gather` 是给 AI 托管的采集声明（可选）：取值
`herb / fish / wood / ore / other`，`mapKnowledge` 据此派生采集点；
缺省时按「事件 id → zone 名」顺序推断。见 §5。

### 1.4 conditions 白名单（4 种，只有 1 种生效）

| type | 参数 | 实现状态 |
|------|------|----------|
| `flag_check` | `key` + `value?` + `op?` | ✅ 已实现。op：`eq`/`ne`/`exists`/`missing`；**缺省 op = `value !== undefined ? "eq" : "exists"`** |
| `phase_done` | `phaseId` | ❌ v0.2（直接查 `phase_x_done` flag 代替） |
| `level_gte` | `level` | ❌ v0.2 |
| `random` | `p` | ❌ v0.2（要随机请写 TS 脚本） |

```json
{ "type": "flag_check", "key": "phase_1_done", "op": "missing" }
{ "type": "flag_check", "key": "met_luwenzhao", "value": true }
```

### 1.5 actions 白名单（10 种）

| type | 参数 | 实现状态 |
|------|------|----------|
| `set_flag` | `key`, `value` | ✅ |
| `del_flag` | `key` | ✅ |
| `toast` | `text`, `color?`（gold/red/white/blue） | ✅ 右下角飘字 |
| `subtitle` | `text`, `duration?`（ms） | ✅ 顶部大字幕 |
| `event_log` | `text` | ✅ HUD 事件流（state.events） |
| `teleport` | `map`（关卡英文名）, `x`, `y`（世界米） | ✅ 切图 + 落点（freeEnemySpot 夹边界/避墙） |
| `run_script` | `script`（不含 .ts）, `args?` | ⚠️ 执行已实现；**`args` 当前不透传**（runScript 只收 name+actor，预留） |
| `wait` | `ms` | ✅ setTimeout 顺序阻塞 |
| `call_action` | `name`, `args?` | ❌ 未实现（console.warn；registerAction 也是 no-op） |
| `llm_speak` | `npcId`, `npcName`, `userText` | ⚠️ 走 ctx.llm.speak，**当前是占位实现，返回空串**（v0.2 接 sys_chat） |

```json
{
  "id": "E07_to_forest",
  "comment": "镇口 → 桑林",
  "trigger": { "type": "interact", "uid": "219" },
  "conditions": [{ "type": "flag_check", "key": "phase_1_done", "value": true }],
  "actions": [
    { "type": "toast", "text": "夜色更深了……", "color": "gold" },
    { "type": "teleport", "map": "Mulberry Forest", "x": 1, "y": 25 }
  ]
}
```

### 1.6 加载链路（排查「事件不触发」看这里）

```
切图 → App.vue afterMapSwitchForEvents(mapFile)
     → eventEngine.onMapEntered(mapFile)
         → invalidateFlagCache()                      # 后端/面板可能改过 flag，先丢缓存
         → loadMapEvents(mapFile)                     # firedIds 重置 + fetch 事件文件
             fetch 前缀链（按序尝试，失败静默下一个）：
               dev:        /story-data/toonflow-field-survival/map_design/<url编码故事名>/events/maps/
               getAsset 环境: assetUrl("events/maps/") → "events/maps/" → "./events/maps/"
         → 顺序 fire 所有 enter_map 事件
玩家交互 → onInteract(tiledId)        # 仅 trigger.type=interact 且 uid 字符串相等
玩家移动 → tickZones(px, py)          # 仅新进入的区域名 → onAreaEnter(zone)
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
   同步到 `vue/src/eventScripts/` 时脚本会把 import 改写成 `./_ctx`。
3. 文件名 = `run_script` 引用的名字（不含 .ts），**且两个故事共用同一个运行目录**，
   必须加故事前缀避免撞名：赦夜人 `SY_`，通天传授 `E01_`。
4. 只允许调 §2.2 表内的 ctx API（校验器正则扫描，白名单外直接报错）。
5. 禁止 `while(true)` / `for(;;)`（校验器报错）；异步等待用 `await`，脚本异常会被
   fireEvent 的 try/catch 吞掉打 console.error，不会崩游戏——但事件就断了。

### 2.2 ctx 全量 API

| API | 签名 | 行为与坑 |
|-----|------|----------|
| `ctx.player` | `Entity`（只读快照） | 改数值请走 save/level API，不要直接写这个对象；取不到玩家时有兜底假对象 |
| `ctx.mapName` | `string` | 当前地图文件名（不含 .json） |
| `ctx.actor` | `{ roleId: string; ai: boolean; name: string }` | 执行者。`roleId=""` = 玩家本人；非空 = AI 托管角色。**采集脚本必须据此分流**，见 §2.3 |
| `ctx.save.getFlag<T>(key)` | `Promise<T \| null>` | 读玩家卡 flag（t_plugin_session_data，key=`player_flags`） |
| `ctx.save.setFlag(key, value)` | `Promise<void>` | 写 flag（立即落库） |
| `ctx.save.delFlag(key)` | `Promise<void>` | 删 flag |
| `ctx.save.all()` | `Promise<Record<string, unknown>>` | 一次读全部 flags |
| `ctx.npc.byUid(uid)` | `Entity \| null` | 按 Tiled 对象 id 查实体（可用） |
| `ctx.npc.setLabel / move / faceTo` | — | ❌ **TODO 空实现，调用不报错但什么都不发生**（v0.2） |
| `ctx.ui.toast(text, color?)` | `void` | 右下角飘字；color: gold/red/white/blue |
| `ctx.ui.subtitle(text, durationMs?)` | `void` | 顶部大字幕（剧情节点） |
| `ctx.ui.event(text)` | `void` | HUD 事件流（state.events，EventPanel 可见） |
| `ctx.ui.confirm(opts)` | `Promise<boolean>` | 确认弹窗；`{title, detail?, confirmText?, cancelText?}`。**AI 执行者自动 resolve(true)**，只留日志 |
| `ctx.bag.give(name, count?)` | `void` | 发物品。玩家 → 背包（sys_item_add 链）；**AI → 该角色 `_aiBag` 私藏**（不污染玩家背包） |
| `ctx.level.switchTo(mapFile, x, y)` | `void` | 切图 + 落点（世界米，会夹边界/避墙）。注意参数名是 mapFile，实际吃关卡英文名（过 levelNameToFile） |
| `ctx.level.setLocked(mapFile, locked)` | `void` | 写 flag `map_locked_<mapFile>`（portal 可用性） |
| `ctx.audio.play(name)` | `void` | ❌ no-op 占位（v0.2 音频通道） |
| `ctx.llm.speak(npcId, npcName, userText, opts?)` | `Promise<string>` | ⚠️ **占位实现，直接返回空串**（v0.2 接 sys_chat agent）；opts.mode: response/options |
| `ctx.registerAction(name, fn)` | `void` | ❌ no-op 占位（v0.2 自定义动作表） |

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

### 2.3 AI 托管分流（写采集脚本必读）

玩家走进区域 vs AI 托管角色走进区域，走的是同一条链（fireEvent → runActions → runScript），
差别只在 `ctx.actor`：

| | 玩家（roleId=""） | AI 托管（roleId 非空） |
|----|------------------|-----------------------|
| `ctx.actor.ai` | false | true |
| `ctx.ui.confirm` | 真弹窗等玩家点 | **自动同意**（不等玩家，避免 Promise 悬挂） |
| `ctx.bag.give` | 进玩家背包 | 进该角色 `_aiBag`（`giveItemToAi` 通道） |
| 叙事人称 | 「你」 | 用 `ctx.actor.name` |

典型写法（SY_E08_wood_at）：

```ts
const who = ctx.actor.ai ? ctx.actor.name : "你";
const ok = await ctx.ui.confirm({ title: "取木", detail: "…" });
if (!ok) return;
ctx.bag.give("松木", 1);   // AI 采集自动进它自己的私藏
```

### 2.4 flag 存储约定

- 事件引擎的 flag 全量存在一个 key 下：`t_plugin_session_data` 的 `player_flags`（一个对象）。
- 与后端 `entry.ts` 的 `persistSys`/`sys_state` 同库不同 key，互不干扰；但**后端/系统面板
  也会写 flag**，这些写入绕过前端缓存 → 切图时 `invalidateFlagCache()` 强制重读。
- **不要在脚本里直接调 pluginData**，一律走 `ctx.save.*`，否则缓存不一致导致判定读陈旧值。
- 保留前缀：`map_locked_<mapFile>`（level.setLocked 用）、`phase_<n>_done/active`（剧情阶段）、
  `q<n>_done`（任务完成回写）。

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
| `type` | string | ✅ | `kill` / `gather` / `escort` / `deliver` / `explore` / `talk`（与首个 objective 的 kind 派生关系：缺 type 时按首个 objective 推） |
| `giver` | string | | 发布者（如「任务板」） |
| `map` | string | | 关联地图，写**关卡 key ①**（如 `mulberryGraveyard`），不是英文名/中文名 |
| `level` | int | | 推荐等级 |
| `objectives` | array | ✅ | 目标列表，见 §3.3 |
| `reward` | object | | `{ exp, money, items: [{name, count}] }` |
| `repeat` | bool | | 可重复接取 |
| `flags` | object | | `{ done: "q01_done" }`——完成后端回写该 flag（事件里可查） |
| `timeLimitTicks` | int | | 限时（**1 tick = 100ms**，6000 = 600 秒）；超时 status=failed，可放弃重接 |
| `cargo` | object | | 护送货物 `{ name, hp }`；接取时在玩家身边生成货物实体，跨图跟随 |
| `consume` | array | | 完成时消耗物品 `[{name, count}]`（deliver 类） |

### 3.3 objective kind（5 种）

| kind | 字段 | 说明 |
|------|------|------|
| `kill` | `target`（怪名）, `count` | 击杀计数（后端 p.kill） |
| `gather` | `target`（物品名）, `count` | 采集/持有计数 |
| `talk` | `uid` 或 `target` | 对话计数（p.talked） |
| `arrive` | `map`, `x`, `y`, `radius?`, `confirm?` | 到达目标点（**世界米**）；`confirm:true` = 需玩家点「到达」按钮手动确认；缺省自动判定 |
| `explore` | 同 arrive | 语义同 arrive（探查类）；「还没到 <map>」提示走 questMapKey 归一化 |

arrive 判定细节（syncQuestArriveAuto / questArriveOk）：radius 默认 `QUEST_ARRIVE_DEFAULT_R`（最小 0.5 米）；
`map` 与当前图用 `questMapKey()` 归一化后比较——**写中文图名会被归一化，仍可能对上**，
但跨图任务建议直接写关卡 key ①；纯 gather 任务没有 arrive 目标，不会弹「到达」。

### 3.4 与事件/flag 的联动

- 任务完成 → 后端写 `flags.done` 指定的 flag → 事件里 `flag_check` 可读（如 `q06_done` 触发 E09）。
- `repeat: true` 任务不写 done flag（可反复接）。
- 护送任务货物丢失（玩家传送到位但货物没了）→ 任务板显示「货物：已丢失」。

---

## 4. ai.gather 采集声明与采集寻路

| 环节 | 文件 | 作用 |
|------|------|------|
| 声明 | 事件 JSON `trigger.ai.gather`（herb/fish/wood/ore/other） | 告诉 AI 托管「这个 zone 能采什么」；mapKnowledge 读取并派生采集点 |
| 推断 | 缺省时按「事件 id → zone 名」顺序推断 | 例：事件 id 含 herb → herb |
| 寻路 | `vue/src/questGatherMap.ts` `GATHER_ZONES_BY_ITEM` | 物品名 → 采集区 zone 名 + gatherKind + mapKey；采集类任务寻路按钮按它找最近采集点 |

**三处名字必须一致**：地图 `eventZones[].name` = 事件 `trigger.zone` = questGatherMap 的 `zone`。
新增采集区时：地图加 zone → 事件加 area_enter(repeat + ai.gather) → 脚本给物品 →
questGatherMap 登记物品→zone 映射。

---

## 5. 校验器 validate_events.mjs

```
node .cache/validate_events.mjs [collection_dir]
# collection_dir 缺省 = 通天传授-收徒系统；ROOT 硬编码 workshops/toonflow-field-survival/map_design
```

检查项（对应 _ctx.ts 白名单，两边同步维护）：

| # | 检查 | 失败级别 |
|---|------|----------|
| 1 | events/maps/*.events.json JSON 语法 + schema（trigger/condition/action 白名单；version=1；events 是数组；map 在 maps/ 存在） | ✗ error |
| 2 | interact uid 在 `maps/<map>.json` Actors 层对象里真实存在 | ✗ error |
| 3 | teleport 目标经 `levelNameToFile` 可解析为 maps/ 下文件 | ✗ error |
| 4 | run_script 的 .ts 在 events/scripts/ 存在 | ✗ error |
| 5 | flag key 被写入多种类型 | ⚠ warn |
| 6 | TS 脚本 `ctx.*` 调用在白名单（CTX_API）+ 禁 while(true)/for(;;) | ✗ error |
| 7 | 副本一致性：events/scripts ↔ vue/src/eventScripts；events/maps ↔ vue/public/events/maps 和 ui/events/maps（对比时把 `../shared/_ctx` 归一成 `./_ctx`） | ⚠ warn |

退出码：有 ✗ → exit 1。**写完/改完事件必跑，跑到 0 error 再同步、再打 .tbg。**

---

## 6. API 速查：一张图从数据到表现

| 你想让游戏发生什么 | 用哪个 API |
|------------------|-----------|
| 进图播旁白/指引 | `enter_map` 事件 + toast/subtitle/event_log，或 run_script |
| NPC 对话/交互 | `interact {uid}`；复杂对话写脚本；llm.speak 目前是占位 |
| 玩家走进某区域触发 | 地图 `eventZones` + `area_enter {zone}` |
| 传送玩家 | `teleport {map,x,y}`（英文图名+世界米）或 `ctx.level.switchTo` |
| 记录剧情进度 | `set_flag` / `ctx.save.setFlag`，命名 `phase_<n>_done` |
| 发物品 | `ctx.bag.give(name,count)`（走 sys_item_add 链） |
| 要玩家确认 | `ctx.ui.confirm`（AI 自动同意） |
| 击杀奖励/掉落 | 野怪对象属性 `bounty` / `dropTable`（**不是** kill_count 事件） |
| 随机/循环/多步分支 | 只能写 TS 脚本（条件白名单里没有 random） |
| 锁图/解锁 | `ctx.level.setLocked`（flag `map_locked_<map>`） |
