# ai托管.agent.触发频率

> **问题**：请求返回时间（LLM 往返 1.5~4s），触发频率太多 token 不够用，触发频率太少没有体验感。
> **本文定位**：给出 AI 托管大脑**何时该醒**的完整设计——事件触发（一次性）、定时器触发（周期性）、以及把两者统一到一根预算管线上。
> **代码现状（2026-10-23 实证）**：
> - `brain.ts` 的 `calculateInterval()` 目前只按**AI 自己身边有没有敌人**判 3s/10s/15s，与**玩家**的战斗状态无关；
> - `eventEngine` 运行时只实现了 `enter_map` / `interact` / `area_enter` 三种触发器，**没有定时器触发器**；
> - `AIGameEvent` 的 9 种事件类型在代码里**从未被真正派发过**（`emitAIEvent` / `notifyAICombat` 只有定义没有调用点）。
>
> 本文把三块补齐。

---

## 0. 结论先行

### 0.1 五类触发源

| # | 触发源 | 性质 | 消耗 LLM | 频次 |
|---|---|---|---|---|
| ① | 勾选「AI 托管」 | 一次性 | ✅ 1 次 | 每次勾选 |
| ② | 用户进入新地图 | 一次性 | ✅ 1 次 | 每次切图 |
| ③ | 地图集事件（`area_enter` / `interact` / `flag_set` …） | 事件驱动 | ✅ 按优先级 | 事件发生时 |
| ④ | 玩家战斗状态跃迁 | 事件驱动 | ✅ 1 次（仅跃迁瞬间） | 状态**边沿** |
| ⑤ | **定时器（地图集可自定义）** | 周期 | ✅ 每拍 | 见 §4 |

**总原则**：

1. **紧急情况不走 LLM**——`sensor.checkEmergency()`（危急血量强制撤退、低血量用药、没蓝等待、被围撤退）已在 LLM 之前拦截。所以**战斗态的 LLM 间隔可以放宽到 5s 而不会丢安全性**。这是整套设计能压住 token 的关键前提。
2. **一切触发都过一根预算管线**——事件触发可以**插队**（绕过间隔），但不能**超并发**（`state.chatResult` 是单槽位，同时只能有 1 个 brain 请求在途）。
3. **定时器是唯一的成本大头**——事件触发是偶发的，定时器是持续的。成本控制的主战场在定时器。

### 0.2 推荐频率速查表

| 场景 | 玩家战斗等级 | 基础间隔 | 推荐范围 | 一拍成本 | 说明 |
|---|---|---|---|---|---|
| 城镇 / 安全区 | `none` | **30s** | 20~40s | 低 | 无威胁，AI 基本待命或采集 |
| 野外非战斗 | `none` | **20s** | 15~30s | 低 | 环境行为（游荡/采集/跟随） |
| 遭遇战（敌人靠近但未交手） | `skirmish` | **10s** | 8~15s | 中 | 战前准备、抢占位置 |
| 交战中 | `engaged` | **5s** | 3~8s | 高 | 战术调整、换目标、控蓝 |
| 玩家濒死 / 全队危机 | — | **即时 P0** | — | 中 | 走 emergency 层，不烧 LLM |
| 地图集自定义覆盖 | 任意 | 由地图集决定 | 建议不低于 `minInterval` | — | 见 §4.4 |

> ⚠️ **上表是"请求间隔"，不是"实际达成间隔"**。多角色并发时实际间隔会被容量上限拉长，见 §6.3。

---

## 1. 事件触发

### 1.1 ① 勾选「AI 托管」→ 立即 1 次

**现状**：`enableAI(entity)` → `setAIEnabled()` 把 `lastBrainTick = 0`，下一拍 `callBrain` 因 `now - 0 >= interval` 成立而立即决策。**单角色行为正确**。

**但有一个坑**：`enableAI` 是**逐角色**的。用户在 RolePanel 一次勾选 3 个角色 → 3 个角色在同一拍集体发起 brain 请求 → 由于 `chatResult` 是单槽位，后两个的 `reqId` 会被覆盖 → **必然丢 2 次决策**。

**修正**：勾选动作**不做立即决策**，只做「标记已启用 + 排入调度队列」。真正的首次决策由调度器**错峰**发起（见 §5.3）。

| 项 | 值 |
|---|---|
| 是否绕过间隔 | ✅ 是（首次必决策） |
| 延迟 | 错峰后 0~1 个基础间隔（≤30s） |
| 是否走预算 | ✅ 计入 |
| 并发保护 | 走全局闸门（单槽位） |

### 1.2 ② 用户进入新地图 → 立即 1 次

**现状**：前端 `switchMap()` → `eventEngine.onEnterMap()` 触发 `enter_map` 类事件。**AI 侧目前没有"新地图"事件**，`AIGameEvent` 里有 `"new_map"` 类型但**从未派发**。

**修正**：`switchMap` 成功后，向所有已托管角色派发 `AIGameEvent{ type: "new_map", priority: "P1" }`，携带新地图名。理由：切图后感知（资源点、地图知识）全部失效，大脑必须重建对本图的认知。

| 项 | 值 |
|---|---|
| 优先级 | P1（可被 P0 抢占） |
| 是否绕过间隔 | ✅ 是 |
| 是否走预算 | ✅ 计入（但**不占用**并发闸门的"插队权"，普通排队即可） |
| 附加动作 | 感知层 `updatePerception()` 强制刷新；`readMapKnowledge()` 重新派生本图采集点 |

### 1.3 ③ 地图集事件触发

地图集（`events/maps/<map>.events.json`）的事件目前**只驱动剧情**（toast / subtitle / set_flag / 剧情脚本），**不驱动 AI 大脑**。要让地图集能"指挥"AI，需要在事件定义里加一个 AI 调度动作。

**设计方案**：扩展 `EventDef.actions`，新增两种动作类型：

```jsonc
{
  "id": "E50_ambush_wave",
  "trigger": { "type": "enter_map" },
  "conditions": [{ "type": "flag_check", "key": "phase_7_active", "op": "exists" }],
  "actions": [
    { "type": "ai_trigger", "priority": "P0", "reason": "伏击战开始，所有托管角色进入战斗" },
    { "type": "ai_trigger", "priority": "P2", "target": "ally:萧肿", "reason": "你去守住北门" }
  ]
}
```

| 动作 | 语义 | 效果 |
|---|---|---|
| `ai_trigger` | 广播一次大脑决策请求 | 向所有（或指定）托管角色派发 `AIGameEvent`，`priority` 决定插队强度 |
| `ai_interval` | 覆盖定时器间隔 | 见 §4.4 |

**`ai_trigger` 的 `priority` 语义**（复用 `shouldTriggerFromEvent` 现有逻辑）：

| priority | 行为 | 典型用途 |
|---|---|---|
| `P0` | 无条件立即决策，可打断任何进行中的动作 | 剧情转折、玩家遇袭、任务关键节点 |
| `P1` | 可打断 `move` / `wait` / `follow` 类动作，不可打断 `attack` / `gather` | 切图、新任务、可采集点出现 |
| `P2` | 不打断任何动作，只在当前动作结束后补一次决策 | 氛围事件、提示类 |

**这个机制是"地图集可以个性自己的定时器"的实现基础**——地图集不只改间隔，还能精确地在剧情节点上"戳"一下 AI。

### 1.4 ④ 玩家战斗状态跃迁 → 立即 1 次（仅边沿）

**现状**：完全没有。`AIGameEvent` 里的 `"enemy_spotted"` / `"ally_need_help"` 从未派发；`state` 里没有 `playerInCombat` 字段。

**这是最需要补的一块**，因为 §0.2 的整张频率表都建立在"知道玩家是不是在战斗"之上。

**检测方案（宿主权威）**：在 `entry.ts` 的 `damage()` 函数里打点。`damage()` 是**所有**伤害的唯一入口（普攻 `case "attack"`、技能 `case "skill"`、AI 攻击、怪物攻击都走它），是天然的埋点位置：

```typescript
function damage(s: FieldSurvivalState, target: Entity, amount: number, attacker?: Entity) {
  // ★ 玩家战斗状态打点：damage() 是所有伤害的唯一入口
  const isPlayerInvolved = target?.side === "player" || attacker?.side === "player";
  if (isPlayerInvolved && amount > 0) {
    s.lastCombatTick = s.tick;          // 记录最后一次交战时刻
    s.playerEngaged = true;             // 战斗等级：engaged
  }
  // ...原有伤害结算不变
}
```

**战斗等级三态**（`none` / `skirmish` / `engaged`）判定：

| 等级 | 判据 | 保持时长 |
|---|---|---|
| `engaged` | 玩家参与过伤害，且在 `COMBAT_HOLD_TICKS` 内 | 300 tick = **30s** |
| `skirmish` | `engaged` 超时，但 20m 内有存活敌人且敌人已锁定玩家 | 持续到敌人死亡/离开 |
| `none` | 以上都不满足 | — |

> **为什么 `engaged` 保持 30s**：战斗不是打一下就结束的。玩家打完一波、清完怪、走几步就该退出战斗态。30s 是「这场仗算结束了」的合理窗口——比战斗持续时间短会让频率抖动，比战斗长会让恢复期一直烧 5s 间隔的 token。

**跃迁边沿触发**（而不是"战斗中每 5s 都触发一次"）：

```
none → skirmish   派发 P1 事件（敌人靠近，做战前准备）
skirmish → engaged 派发 P0 事件（开打，立即决策）
engaged → skirmish 派发 P2 事件（脱离接触，收尾）
skirmish → none   不派发（靠定时器自然降频）
```

**为什么用边沿而不是电平**：如果按电平（"战斗中每 5s 触发"），那和定时器没区别，多一套机制没有意义。边沿的价值在于**「战斗开始的那一刻」能立即响应**——玩家被偷袭，AI 必须立刻做出反应，而不是等到下一个 5s 窗口。

| 项 | 值 |
|---|---|
| 是否绕过间隔 | ✅ 是 |
| 触发次数 | 每次状态跃迁 **1 次**（不是每 tick） |
| 是否走预算 | ✅ 计入 |
| 并发保护 | ✅ |

### 1.5 事件触发汇总

| 事件 | 优先级 | 绕过间隔 | 打断进行中动作 | 频率 |
|---|---|---|---|---|
| 地图集 `ai_trigger` P0 | P0 | ✅ | ✅ 任何动作 | 剧情节点 |
| 玩家 `none→skirmish` | P1 | ✅ | 仅 move/wait/follow | 每场战斗 1 次 |
| 玩家 `skirmish→engaged` | P0 | ✅ | ✅ 任何动作 | 每场战斗 1 次 |
| 玩家 `engaged→skirmish` | P2 | ❌ | ❌ | 每场战斗 1 次 |
| 切图 `new_map` | P1 | ✅ | 仅 move/wait/follow | 每次切图 |
| 勾选托管 | P1 | ✅ | ✅（无进行中动作） | 每次勾选 |
| 地图集 `ai_trigger` P1 | P1 | ✅ | 仅 move/wait/follow | 剧情节点 |
| 地图集 `ai_trigger` P2 | P2 | ❌ | ❌ | 剧情节点 |

---

## 2. 玩家战斗状态（新增机制详解）

### 2.1 状态字段

宿主 `FieldSurvivalState` 新增：

```typescript
/** ★ 玩家战斗状态（AI 托管频率判据）。level: none | skirmish | engaged */
playerCombat?: {
  level: "none" | "skirmish" | "engaged";
  /** 最后一次玩家参与的伤害结算时刻（tick） */
  lastCombatTick: number;
  /** 战斗等级升起的时刻（tick） */
  sinceTick: number;
  /** 最近 20m 内敌人数（skirmish 判据） */
  nearbyEnemies: number;
};
```

前端 `GameState` 同步该字段（`AIPerception.world` 派生）：

```typescript
// sensor.ts
world: {
  currentMap: ...,
  timeOfDay: ...,
  /** ★ 玩家战斗等级 */
  playerCombatLevel: (state as any).playerCombat?.level || "none",
  /** ★ 距离上次交战秒数 */
  secondsSinceCombat: ...,
}
```

### 2.2 为什么要用「玩家战斗状态」而不是「AI 自己身边有敌人」

现状 `calculateInterval()` 判的是 `perception.nearby.enemies.length > 0`——**AI 身边有敌人**。这和"玩家在不在战斗"是两件不同的事：

| 场景 | AI 身边有敌人 | 玩家在战斗 | 现状判定 | 应有判定 |
|---|---|---|---|---|
| 玩家在打，AI 在旁边采药 | ❌ | ✅ | 15s（idle） | 5~10s |
| AI 主动去啃野怪，玩家在安全区闲逛 | ✅ | ❌ | 3s（combat） | 15~20s |
| 玩家被 3 只怪围，AI 在 20m 外 | ❌ | ✅ | 15s | 10~15s |
| 全场无敌人，AI 站着发呆 | ❌ | ❌ | 15s | 20~30s |

第三行是最要命的：**AI 看不到玩家被围（感知半径 13m vs 敌人在 20m 外），玩家在挨打，AI 却按 15s 的闲散节奏在思考**。玩家感受到的就是"我的队友反应好慢"。

**结论**：战斗等级应该由**玩家**的状态决定（玩家是主视角，AI 是辅助），AI 自身的敌人密度作为**次级修正**（AI 自己有危险时也要快点决策）。

### 2.3 新的间隔计算公式

```typescript
function calculateInterval(state: AIState, perception: AIPerception): number {
  if (!brainConfig.adaptiveEnabled) return brainConfig.minInterval;

  // ① 玩家战斗等级（主判据）
  const level = perception.world.playerCombatLevel || "none";
  let base: number;
  switch (level) {
    case "engaged":  base = COMBAT_INTERVAL_ENGAGED;  break;  // 5000
    case "skirmish": base = COMBAT_INTERVAL_SKIRMISH; break;  // 10000
    default:         base = IDLE_INTERVAL_BASE;      break;  // 20000
  }

  // ② 地图集覆盖（最高优先级，见 §4.4）
  const override = readMapIntervalOverride(state.mapName);
  if (override != null) return override;

  // ③ AI 自身的次级修正：AI 自己有危险 → 缩短一档
  if (perception.nearby.enemies.length > 0) {
    base = Math.max(brainConfig.minInterval, base * 0.7);
  }

  // ④ 资源点在附近 → 中等（只在完全空闲时生效，避免拉长战斗节奏）
  if (perception.resources.length > 0 && level === "none") {
    base = Math.min(base, IDLE_INTERVAL_WITH_RESOURCES);   // 15000
  }

  return clamp(base, brainConfig.minInterval, brainConfig.maxInterval);
}
```

**关键点**：`base * 0.7` 的次级修正保证了"AI 自己在挨打"时不会因为玩家状态是 `none` 而变慢；而 `resources` 修正只在 `level === "none"` 时生效，避免把战斗节奏拉长。

### 2.4 配置常量

```typescript
// types.ts
export const COMBAT_INTERVAL_ENGAGED  = 5000;   // 交战中
export const COMBAT_INTERVAL_SKIRMISH = 10000;  // 遭遇战
export const IDLE_INTERVAL_BASE       = 20000;  // 野外非战斗
export const IDLE_INTERVAL_WITH_RESOURCES = 15000;
export const COMBAT_HOLD_TICKS = 300;  // engaged 保持 30s
```

`DEFAULT_BRAIN_CONFIG` 的 `minInterval` / `maxInterval` 语义不变：
- `minInterval = 5000` → **所有情况下的下界**（战斗 5s、地图集覆盖低于 5s 会被夹回 5s）
- `maxInterval = 30000`（**从 15000 上调**）→ 允许地图集把非战斗间隔拉到 30s

> `maxInterval` 从 15s 上调到 30s 是本次设计的**核心降本杠杆**。现状非战斗就是 15s 上限，5 个角色 = 20 次/分。改成 30s 后同样 5 个角色 = 10 次/分，**直接砍半**，而玩家几乎察觉不到差别（反正 AI 在非战斗时大多在采集/跟随，决策内容重复度高）。

---

## 3. 定时器触发（地图集可自定义）


### 3.1 为什么需要「定时器触发器」进 eventEngine

现状 `eventEngine` 的三种触发器全是**离散事件**（`enter_map` / `interact` / `area_enter`）。但 AI 托管的本质诉求是**周期性唤醒**——它需要"每隔一段时间想一下"。这个需求现在完全没有落点：

- `brain.ts` 的 `calculateInterval()` 只是个**间隔计算器**，它决定"这一拍要不要决策"，但它**不是触发器**——它是被 `tickAllAIs` 每 tick 被动调用的。
- 换句话说，AI 的"心跳"是**插件前端自己走的**，跟地图集无关。地图集想改这个节奏，**没有任何接口**。

**所以"地图集可以个性自己的定时器"这条需求的落点，是一个新的事件触发器类型：**

```typescript
// events/shared/_ctx.ts
export interface EventDef {
  trigger:
    | { type: "enter_map" }
    | { type: "interact"; uid: string }
    | { type: "area_enter"; zone: string; ai?: {...} }
    | { type: "step_on"; x: number; y: number }
    | { type: "flag_set"; key: string }
    | { type: "kill_count"; gte: number }
    | { type: "turn_count"; gte: number }
    // ★ 新增：定时器触发器
    | { type: "interval"; everyMs: number; when?: "any" | "combat" | "idle" }
    | { type: "custom"; name: string };
}
```

### 3.2 `interval` 触发器语义

| 字段 | 含义 | 默认 |
|---|---|---|
| `everyMs` | 触发周期（ms） | 必填 |
| `when` | 触发条件：<br>• `any` — 任何状态都触发<br>• `combat` — 仅玩家处于 `skirmish`/`engaged` 时<br>• `idle` — 仅玩家处于 `none` 时 | `any` |

**语义**：`interval` 事件**每次触发都执行 `actions`**，而 `actions` 里通过 `ai_trigger` 去唤醒 AI。所以典型写法是：

```jsonc
{
  "id": "E60_corridor_patrol",
  "comment": "冥夜走廊巡逻：本图 AI 每 8s 醒一次（战斗态 4s）",
  "trigger": { "type": "interval", "everyMs": 8000, "when": "any" },
  "actions": [
    { "type": "ai_trigger", "priority": "P2", "reason": "走廊巡逻：常规巡视" }
  ]
}
```

**`interval` 事件的三条约束**（否则会成为成本黑洞）：

1. **必须配 `ai_trigger` 或 UI 类动作**——纯 `interval` + `set_flag` 的组合是合理的（比如倒计时），但如果它每次都 `ai_trigger`，就等于用事件系统**重新实现**了 `calculateInterval`，造成**两套节奏叠加**（双倍 token）。→ **规则**：`interval` 事件的 `ai_trigger` 优先级若为 P0/P1，会**覆盖**而非叠加 `calculateInterval` 的判定；只有 P2 才是"叠加在定时器之上"。

2. **不进 `firedIds` 防重入**——和 `area_enter` 采集事件一样（`eventEngine.ts:295` 的注释已说明），`interval` 是重复事件，每次都要能 fire。但要加**冷却**防连点。

3. **必须能被 `ai_interval` 覆盖**——见 §4。

### 3.3 运行时实现

`eventEngine.ts` 需要的最小改动：

```typescript
// ① 运行时状态
const intervalTimers = new Map<string, number>();   // eventId → 下次触发时刻
const lastIntervalFire = new Map<string, number>();  // eventId → 上次触发时刻

// ② 切图时重建（onEnterMap 里）
function resetIntervalTimers(events: EventDef[]) {
  intervalTimers.clear();
  lastIntervalFire.clear();
  const now = Date.now();
  for (const ev of events) {
    if (ev.trigger.type === "interval") {
      intervalTimers.set(ev.id, now + ev.trigger.everyMs);
    }
  }
}

// ③ 每 tick 检查（挂在现有 tick 循环里，与 tickAllAIs 同拍）
export function tickIntervalEvents(state: GameState) {
  if (!loadedEvents.value) return;
  const now = Date.now();
  for (const ev of loadedEvents.value.events) {
    if (ev.trigger.type !== "interval") continue;
    const t = ev.trigger;
    if (now < (intervalTimers.get(ev.id) || 0)) continue;

    // when 条件判定
    const level = (state as any).playerCombat?.level || "none";
    if (t.when === "combat" && level === "none") { intervalTimers.set(ev.id, now + t.everyMs); continue; }
    if (t.when === "idle" && level !== "none")   { intervalTimers.set(ev.id, now + t.everyMs); continue; }

    // 冷却防连点（复用 area_enter 的冷却机制）
    const last = lastIntervalFire.get(ev.id) || 0;
    if (now - last < INTERVAL_MIN_COOLDOWN_MS) {   // 建议 1000ms
      intervalTimers.set(ev.id, now + t.everyMs);
      continue;
    }
    lastIntervalFire.set(ev.id, now);
    intervalTimers.set(ev.id, now + t.everyMs);

    void fireEvent(ev);
  }
}
```

> **注意**：`fireEvent` 里的 `conditions` 判定仍然生效——所以地图集可以用 `flag_check` 让某个 `interval` 事件在特定剧情阶段才生效。

### 3.4 与 `calculateInterval` 的关系（重要）

这是最容易搞混的地方，明确区分：

| | `calculateInterval`（brain.ts） | `interval` 触发器（eventEngine） |
|---|---|---|
| 层次 | 插件前端 AI 层 | 地图集事件层 |
| 谁决定 | 代码里的固定公式 + 玩家战斗等级 | 地图集作者 |
| 粒度 | **每个角色**独立 | **整张地图**统一 |
| 作用 | "这一拍这个角色要不要思考" | "到点了，让全图 AI 醒一次" |
| 优先级 | 基础值 | `ai_interval` 可覆盖 |

**正确的工作顺序**（调度器视角）：

```
每个 tick:
  1. 事件引擎 tickIntervalEvents() → 派发 interval 事件的 ai_trigger
  2. tickAllAIs() 遍历托管角色:
       a. 紧急检查（checkEmergency）—— 不烧 LLM，直接出动作
       b. 事件队列检查 —— 有 P0/P1 事件 → 插队决策
       c. 间隔检查 —— now - lastBrainTick >= calculateInterval() → 常规决策
       d. 动作未完成 → 继续执行（不决策）
  3. 调度器：从待决策队列里按优先级取一个 → 走 LLM → 兑现结果
```

### 3.5 地图集自定义定时的推荐写法

```jsonc
// 野外图：非战斗 20s，战斗 6s
{
  "id": "E70_野外节奏",
  "trigger": { "type": "interval", "everyMs": 20000, "when": "any" },
  "actions": [
    { "type": "ai_interval", "combat": 6000, "idle": 20000 }
  ]
}
```

```jsonc
// BOSS 图：全程 8s，但因为都是 P2，不会打断战斗中的动作
{
  "id": "E71_boss_rhythm",
  "trigger": { "type": "interval", "everyMs": 8000, "when": "any" },
  "actions": [
    { "type": "ai_trigger", "priority": "P2", "reason": "BOSS 战：每 8s 重新评估站位" }
  ]
}
```

```jsonc
// 剧情密集图：只在中后期开一个快节奏
{
  "id": "E72_phase_7_fast",
  "trigger": { "type": "interval", "everyMs": 6000, "when": "any" },
  "conditions": [{ "type": "flag_check", "key": "phase_7_active", "op": "exists" }],
  "actions": [
    { "type": "ai_trigger", "priority": "P1", "reason": "终局阶段：加快决策节奏" }
  ]
}
```

---

## 4. 地图集覆盖机制（`ai_interval`）

### 4.1 两种覆盖方式

**方式 A：`ai_interval` 动作（推荐，事件驱动）**

在 `interval` 事件的 `actions` 里写：

```jsonc
{ "type": "ai_interval", "combat": 5000, "skirmish": 8000, "idle": 25000 }
```

**方式 B：地图集根级配置（更简单）**

在 `events/maps/<map>.events.json` 顶层加一个 `ai` 字段：

```jsonc
{
  "version": 1,
  "map": "mulberryDungeon3",
  "ai": {
    "interval": {
      "engaged": 5000,
      "skirmish": 10000,
      "idle": 25000
    },
    "maxManaged": 3
  },
  "events": [ ... ]
}
```

> 两种方式**同时存在时，`ai_interval` 动作优先**（事件级 > 地图级 > 代码默认）。

### 4.2 `ai_interval` 字段

| 字段 | 含义 | 缺省 |
|---|---|---|
| `engaged` | 交战中间隔（ms） | 5000 |
| `skirmish` | 遭遇战间隔（ms） | 10000 |
| `idle` | 非战斗间隔（ms） | 20000 |
| `all` | 统一覆盖三档 | 无 |

### 4.3 生效范围

**当前地图内生效**。切图时 `readMapIntervalOverride()` 重新读取当前图的 `events.json`，旧图的覆盖自动失效。

**只影响该地图上所有托管角色**（不区分角色性格/等级）——角色级的差异化由 `AIState` 里的 `personality` 和紧急层处理，不在频率层做。

### 4.4 钳制规则（防止地图集把 token 烧穿）

```typescript
function readMapIntervalOverride(mapName: string): number | null {
  const cfg = readMapAIConfig(mapName);          // 从 events.json 读 ai 字段
  if (!cfg?.interval) return null;
  const level = currentPlayerCombatLevel();
  const raw = cfg.interval[level] ?? cfg.interval.all;
  if (raw == null) return null;
  // ★ 硬钳制：地图集不能突破上下界
  return clamp(raw, brainConfig.minInterval, brainConfig.maxInterval);
}
```

| 钳制 | 值 | 理由 |
|---|---|---|
| 下界 | `minInterval = 5000` | 低于 5s 的单角色决策会让 LLM 响应追不上（往返 1.5~4s），决策会**堆积**而不是变快 |
| 上界 | `maxInterval = 30000` | 高于 30s，AI 存在感消失 |
| 地图集绕过钳制 | **不允许** | 成本是全局的，不能让单张图突破预算 |

> **这是"地图集可以个性自己的定时器"必须带的那道锁**。没有它，一张图写 `everyMs: 500` 就能把全局 token 打到破产，而作者完全意识不到。

### 4.5 地图集作者的推荐区间

| 图类型 | engaged | skirmish | idle | 理由 |
|---|---|---|---|---|
| 城镇 / 安全区 | 8000 | 15000 | 30000 | 几乎无威胁，AI 多在待命/摆摊 |
| 野外采集图 | 6000 | 12000 | 20000 | 采集为主，非战斗需要不频繁 |
| 精英怪 / 剧情战斗 | 5000 | 8000 | 15000 | 战斗占比高 |
| BOSS 图 | 4000 | 6000 | 12000 | 战况变化快，需要细粒度调整 |
| 逃脱 / 追逐图 | 3000 | 5000 | 10000 | 局势瞬息万变 |

> ⚠️ 上表 `engaged` 列有 3000~4000 的值，**低于 `minInterval=5000`**。这是**有意的**：BOSS 图确实需要 3s 粒度。→ 说明 `minInterval` 应该**不是硬下界**，而应允许地图集在"战斗态"下探到 3000。

**修正后的钳制规则**：

```typescript
const HARD_FLOOR = 3000;   // 绝对下界（防止决策堆积）
const HARD_CEIL  = 60000;  // 绝对上界（防止 AI 消失）

function clampMapInterval(raw: number): number {
  // 非战斗态用 minInterval 兜底，战斗态允许地图集下探到 HARD_FLOOR
  const floor = currentPlayerCombatLevel() === "engaged" ? HARD_FLOOR : brainConfig.minInterval;
  return clamp(raw, floor, Math.min(HARD_CEIL, brainConfig.maxInterval));
}
```

| 状态 | 有效下界 | 有效上界 |
|---|---|---|
| `engaged` | 3000 | 30000 |
| `skirmish` | 5000 | 30000 |
| `idle` | 5000 | 30000 |

---

## 5. 调度器设计（把触发和执行解耦）

### 5.1 为什么需要调度器

现状 `tickAllAIs()` 里的决策是**同步遍历 + fire-and-forget**：

```typescript
for (const entity of candidates) {
  if (!aiState.currentAction) {
    void (async () => {
      const decision = await callBrain(entity, state);   // ← 每个角色独立发起
      ...
    })();
  }
}
```

问题：
1. **N 个角色同拍发起 → N 个并发 LLM 请求**，但 `state.chatResult` 是**单槽位**（后写覆盖先写）→ 除最后一个外全部 `reqId` 失配 → **静默丢失决策**。
2. **没有全局闸门**——`brainBusy` 已在上一轮实现中加进 `App.vue` 的 `callBrainLLM`，但 `tickAllAIs` 这一层**没有做排队**，只是靠闸门把后来的请求**拒掉**（返回空 → 走兜底）。结果是"该决策的时候不决策"。

**调度器要做的事**：把"谁想决策"（触发）和"谁能决策"（执行）分开。

### 5.2 调度器状态

```typescript
interface BrainScheduler {
  /** 待决策队列（按优先级排序） */
  queue: Array<{
    entityId: string;
    priority: "P0" | "P1" | "P2";
    reason: string;
    enqueuedAt: number;
  }>;
  /** 是否有请求在途（全局单槽位） */
  inFlight: boolean;
  /** 上次 LLM 完成时刻 */
  lastCompleteAt: number;
  /** 本分钟已发出的请求数（预算计数） */
  minuteCount: number;
  minuteWindowStart: number;
}
```

### 5.3 调度流程

```
每 tick:
  ① 事件引擎 tickIntervalEvents() → 可能派发 ai_trigger
  ② tickAllAIs() 收集"想决策"的角色 → 全部入 queue（不立即发起）
  ③ 调度器 pump():
       if (inFlight) return;                    // 单槽位，已有请求在途
       if (minuteCount >= BUDGET_PER_MIN) return;   // 预算耗尽，等下一秒
       const task = queue.sort(byPriority).shift();
       if (!task) return;
       inFlight = true;
       void executeBrainTask(task);            // → callBrain → LLM → 兑现
  ④ executeBrainTask 完成 → inFlight = false → 下一 tick 继续 pump
```

### 5.4 优先级排序

```typescript
function sortQueue(q: BrainScheduler["queue"]): BrainScheduler["queue"] {
  const weight = { P0: 0, P1: 1, P2: 2 } as const;
  return q.sort((a, b) => {
    const w = weight[a.priority] - weight[b.priority];
    if (w !== 0) return w;
    return a.enqueuedAt - b.enqueuedAt;   // 同优先级先进先出（防饿死）
  });
}
```

**防饿死**：P0 事件不会让 P2 永远排不上——因为单槽位一次只出一个，而 P0 的产生频率远低于容量。

### 5.5 错峰（解决"一次勾选 3 个角色"）

**问题**：勾选 3 个角色 → 3 个角色同时入队 → 调度器一次只出一个 → 后两个要等 `interval` 才被处理 → 玩家等 15~20s 才看到 AI 动起来。

**解法**：**"首次决策"降级为 P2**，并给每个角色一个**错峰偏移**：

```typescript
// 错峰偏移：按角色 index 分配 0 / 1/3 / 2/3 个间隔
const staggerSlots = 3;
const slot = hashEntityId(entityId) % staggerSlots;
const staggerDelay = Math.floor((interval * (slot + 1)) / (staggerSlots + 1));
```

或者更简单：**用"入队时间 + 小随机抖动"**打散同拍入队的任务：

```typescript
enqueuedAt: Date.now() + Math.random() * 1500,   // 0~1500ms 抖动
```

**推荐用抖动方案**——它不需要维护角色→槽位的映射，且天然适配"任意数量角色同时入队"。

**实际效果**：勾选 3 个角色 → 3 个任务错开 0~1.5s 入队 → 调度器在 3 个 tick 内（300ms）依次发出 → 玩家几乎感觉不到延迟，但**不再有 reqId 冲突**。

### 5.6 `inFlight` 的粒度

`state.chatResult` 是**全局单槽位**，所以 `inFlight` 必须是**全局的**，不能是 per-entity。

```typescript
// ❌ 错误：per-entity 闸门
if (brainBusy[entityId]) return;   // 3 个角色可以同时发 → chatResult 互相覆盖

// ✅ 正确：全局闸门
if (scheduler.inFlight) return;    // 全局只允许 1 个 brain 请求在途
```

这与上一轮实现中 `App.vue` 的 `brainBusy` 全局变量一致（已在 `callBrainLLM` 层面兜住），调度器这层是**更上游的排队**——闸门是最后一道保险，调度器是第一道。

---

## 6. Token 成本分析

### 6.1 一次决策的 token 成本

`buildSystemPrompt` + `buildUserPrompt` 的实测规模（基于当前代码模板）：

| 部分 | 估算 token |
|---|---|
| 角色设定 + 基础信息 | ~120 |
| 本图知识（mapHint） | ~80~200（随地图采集点数量） |
| 核心能力 + 背包 + 技能列表 | ~80~300（随背包/技能数） |
| 当前位置 + 资源点列表 | ~60~250 |
| User Prompt：环境感知 + 战斗状态 + 资源状态 | ~150~400 |
| 记忆（最近 3 条）+ 当前目标 | ~80~150 |
| 输出格式 JSON 模板 | ~120 |
| **输出（LLM 生成）** | ~80~150 |
| **合计（单次决策）** | **≈ 800~1500 token** |

按中位 **1100 token/次** 估。

### 6.2 不同策略的每分钟请求数

假设 **5 个托管角色**（`maxManagedCount` 上限）：

| 策略 | 非战斗间隔 | 战斗间隔 | 非战斗 req/min | 战斗 req/min | token/min（非战斗） |
|---|---|---|---|---|---|
| **现状**（3s/15s 按 AI 自己敌人判） | 15000 | 3000 | 20 | 100 | 22000 |
| **本文方案**（5s/20s 按玩家战斗判） | 20000 | 5000 | 15 | 60 | 16500 |
| **本文 + 地图集 idle=30s** | 30000 | 5000 | 10 | 60 | 11000 |
| **本文 + 地图集 idle=30s + maxManaged=3** | 30000 | 5000 | 6 | 36 | 6600 |

**结论**：
- 单纯把判据从"AI 自己有敌人"改成"玩家在战斗" → 省 25%
- 加上 `maxInterval` 15s→30s → 再省 33%
- 加上地图集按图定制 → 城镇图能再省
- 累计：**从 22000 token/min 降到 11000 token/min（省 50%）**，战斗峰值从 100 req/min 降到 60 req/min

### 6.3 多角色并发的实际达成间隔

**这是最容易被忽略的问题**：5 个角色、5s 间隔，看起来是 60 req/min，但**单槽位一次只能跑 1 个**，LLM 往返 1.5~4s。

```
单槽位吞吐上限 = 1 / LLM往返时间 = 1 / 2.5s ≈ 24 req/min
```

**所以 5 个角色 × 5s 间隔 = 60 req/min 的需求 > 24 req/min 的供给** → 队列会持续积压 → 实际达成间隔被拉长到：

```
实际间隔 ≈ (角色数 × 目标间隔) / 1  ... 加上 LLM 往返
实际间隔 ≈ 5 角色 × 5s = 25s  (+ LLM 往返 2.5s) ≈ 27.5s
```

**这意味着"战斗态 5s 间隔"在 5 角色场景下根本达不到**。必须正视这一点，有三条路：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A. 限流** | 达到预算就停发，角色靠兜底策略运转 | 战斗中的 AI 变成"规则引擎"，失去 LLM 的战术能力 |
| **B. 降并发** | 战斗态只让**最近的 1~2 个**角色用 LLM，其余走兜底 | 远处 AI 变笨，但最近的响应快 |
| **C. 缩短 prompt** | 砍掉记忆、砍掉本图知识（改用轻量版） | 单次成本降 30~50%，吞吐翻倍 |

**推荐组合：B + C**。

- **B 的具体做法**：战斗态下，按"与玩家的距离"排序，**只有最近的 2 个托管角色**进入 LLM 队列；其余角色走 `fallbackDecision`（有敌人打最近敌人）。这符合直觉——**玩家只关心身边队友的反应速度**。
- **C 的具体做法**：战斗态用**精简 prompt**（砍掉「本图知识」和「角色记忆」两段，保留感知 + 动作清单 + 输出格式），从 1100 token 降到 ~600 token。

### 6.4 分级预算（建议落地）

```typescript
const BUDGET = {
  // 每分钟最大请求数（按 maxManagedCount 动态算）
  perMinute: (n: number) => Math.max(10, n * 12),
  // 每小时最大请求数
  perHour:  (n: number) => Math.max(120, n * 400),
  // 战斗态可参与 LLM 的角色数上限
  combatLLMRoles: 2,
  // 战斗态精简 prompt
  combatSlimPrompt: true,
};
```

| 托管角色数 | 每分钟预算 | 每小时预算 | 战斗态 LLM 角色数 |
|---|---|---|---|
| 1 | 12 | 400 | 1 |
| 3 | 36 | 1200 | 2 |
| 5 | 60 | 2000 | 2 |

**预算耗尽时的降级**：不是"停止决策"，而是**降级到兜底 + 延长间隔**：

```typescript
if (scheduler.minuteCount >= budget.perMinute) {
  // 预算耗尽：把所有角色的 interval 临时拉长到 maxInterval
  aiState.brainInterval = brainConfig.maxInterval;
  // 但 emergency 层不受影响（checkEmergency 仍每 tick 跑）
}
```

**关键**：紧急层永远不受预算影响——血量危急时 AI 必须立刻逃跑，这不需要 LLM（`checkEmergency` 是纯程序化的），所以**预算耗尽不会导致 AI 在关键时刻失能**。

### 6.5 全局失败冷却

上一轮实现中提到「LLM 失败后冷却 30s 再试」——这个在频率层必须落实：

```typescript
// 任何 LLM 失败（超时 / 解析失败 / agent 不可用）→ 全局冷却
if (!result.ok) {
  scheduler.globalCooldownUntil = Date.now() + 30000;   // 30s
  scheduler.consecutiveFailures++;
} else {
  scheduler.consecutiveFailures = 0;
}
```

**为什么是全局而非 per-entity**：如果宿主 agent 通道挂了（`sys_brain` 死信那种情况），per-entity 冷却意味着每个角色各自烧一次 8s 超时 → 5 角色 = 40s 白等。全局冷却 = 一次失败，全员停 30s。

**连续失败 3 次 → 熔断**：

```typescript
if (scheduler.consecutiveFailures >= 3) {
  scheduler.breakerOpen = true;
  scheduler.breakerUntil = Date.now() + 120000;   // 2 分钟
  // 熔断期间：全员走 fallbackDecision，彻底不烧 token
}
```

熔断是**成本的最后一道保险**——LLM 通道挂掉时，不会每个角色每隔几秒就烧一次 8s 超时。

---

## 7. 完整实现清单

### 7.1 宿主侧（`entry.ts`）

| # | 改动 | 位置 | 优先级 |
|---|---|---|---|
| H1 | `FieldSurvivalState` 加 `playerCombat?: { level, lastCombatTick, sinceTick, nearbyEnemies }` | 类型定义 | P0 |
| H2 | `damage()` 里打点：玩家参与伤害 → `lastCombatTick = s.tick; playerCombat.level = "engaged"` | `damage()` L1268 | P0 |
| H3 | 每 tick 更新战斗等级：`engaged` 超 30s → 降 `skirmish`；`skirmish` 且 20m 无敌人 → 降 `none` | tick 主循环 | P0 |
| H4 | 等级变化时**派发 AI 事件**（跃迁边沿）→ 走 `ai_command` 通道或新的 `ai_event` 通道 | tick 主循环 | P1 |

### 7.2 事件引擎侧（`eventEngine.ts` + `_ctx.ts`）

| # | 改动 | 优先级 |
|---|---|---|
| E1 | `EventDef.trigger` 加 `{ type: "interval"; everyMs: number; when?: "any"\|"combat"\|"idle" }` | P0 |
| E2 | `EventDef.actions` 加 `{ type: "ai_trigger"; priority; reason; target? }` | P0 |
| E3 | `EventDef.actions` 加 `{ type: "ai_interval"; engaged?; skirmish?; idle?; all? }` | P0 |
| E4 | `EventsFile` 顶层加 `ai?: { interval?: {...}; maxManaged?: number }` | P1 |
| E5 | 运行时：`intervalTimers` / `lastIntervalFire` / `resetIntervalTimers()` / `tickIntervalEvents()` | P0 |
| E6 | `fireEvent` 里实现 `ai_trigger` / `ai_interval` 两个动作 | P0 |
| E7 | 切图时 `resetIntervalTimers()` + 清空 interval 覆盖 | P0 |

### 7.3 AI 层（`vue/src/ai/`）

| # | 改动 | 文件 | 优先级 |
|---|---|---|---|
| A1 | `calculateInterval()` 重写：玩家战斗等级为主判据，地图集覆盖次之，AI 自身敌人作次级修正 | `brain.ts` | P0 |
| A2 | `DEFAULT_BRAIN_CONFIG.maxInterval` 15000 → 30000 | `types.ts` | P0 |
| A3 | 新增 `COMBAT_INTERVAL_*` / `IDLE_INTERVAL_*` 常量 | `types.ts` | P0 |
| A4 | `AIPerception.world` 加 `playerCombatLevel` / `secondsSinceCombat` | `types.ts` + `sensor.ts` | P0 |
| A5 | `readMapIntervalOverride(mapName)` + 钳制 | 新建 `mapKnowledge.ts` 内或新文件 | P0 |
| A6 | 调度器（队列 + `inFlight` + 预算计数 + 熔断） | 新建 `scheduler.ts` | P0 |
| A7 | `tickAllAIs` 改为"入队"而非"直接发起" | `index.ts` | P0 |
| A8 | `emitAIEvent` / `notifyAICombat` 真正接上调用点 | `index.ts` | P1 |
| A9 | 战斗态精简 prompt（省 ~45% token） | `brain.ts` | P1 |
| A10 | 战斗态只让最近 2 个角色进 LLM 队列 | `scheduler.ts` | P1 |

### 7.4 落地顺序与进度

```
第 1 步（P0，不可拆）：H1+H2+H3 → A1+A2+A3+A4 ✅ 已完成（2026-10-23）
      └─ 收益：非战斗 20s、战斗 5s，省 25% token，且战斗响应更快

第 2 步（P0）：A5+A6+A7 → E5+E6 ✅ 已完成（2026-10-23）
      └─ 收益：解决多角色 reqId 冲突（真 bug），成本可控

第 3 步（P0）：E1+E2+E3+E7 ✅ 已完成（2026-10-23）
      └─ 收益：开放"地图集个性自己的定时器"

第 4 步（P1）：A8 部分完成（new_map 已接）· A9+A10 + E4 + H4 ⬜ 未做
      └─ 收益：再省 30~45% token，战斗峰值降 40%
```

## 7.5 已实现清单（2026-10-23 落地）

| # | 项 | 落地位置 | 状态 |
|---|---|---|---|
| H1 | `playerCombat` 状态字段 | `entry.ts` `FieldSurvivalState` | ✅ |
| H2 | `damage()` 打点 | `entry.ts:1284` `damage()` | ✅ |
| H3 | 三态跃迁 `updatePlayerCombatState()` | `entry.ts` + `step()` 内调用 | ✅ |
| A1 | `calculateInterval()` 重写 | `vue/src/ai/brain.ts` | ✅ |
| A2 | `maxInterval` 15000→30000 | `vue/src/ai/types.ts` | ✅ |
| A3 | 频率常量 | `vue/src/ai/types.ts` | ✅ |
| A4 | `playerCombatLevel` 感知 | `types.ts` + `sensor.ts: senseWorld()` | ✅ |
| A5 | `readMapIntervalOverride()` + 钳制 | 新建 `vue/src/ai/mapInterval.ts` | ✅ |
| A6 | 调度器（队列/闸门/预算/熔断） | 新建 `vue/src/ai/scheduler.ts` | ✅ |
| A7 | `tickAllAIs` 改入队 | `vue/src/ai/index.ts` | ✅ |
| E1 | `interval` 触发器类型 | `eventScripts/_ctx.ts` + `eventEngine.ts` | ✅ |
| E2 | `ai_trigger` 动作 | `_ctx.ts` + `runActions()` + `broadcastAIEvent()` | ✅ |
| E3 | `ai_interval` 动作 | `_ctx.ts` + `runActions()` + `setMapIntervalOverride()` | ✅ |
| E5 | interval 运行时（定时器/冷却/上限） | `eventEngine.ts: tickIntervalEvents()` | ✅ |
| E6 | `fireEvent` 跳过 firedIds | `eventEngine.ts` | ✅ |
| E7 | 切图重建定时器 + 清覆盖 | `eventEngine.ts: onMapEntered()` | ✅ |
| A8 | `new_map` 事件接线 | `broadcastAINewMap()` + App.vue `afterMapSwitchForEvents()` | ✅ |
| — | 战斗跃迁事件广播 | `tickAllAIs()` 内读 `combatTransition` | ✅ |
| E4 | 地图集根级 `ai` 配置 | `_ctx.ts EventsFile.ai` + `getLoadedEventsFile()` | ✅ |
| — | 示例配置 | `mulberryDungeon5.events.json`（BOSS 图：4000/6000/12000） | ✅ |
| — | 冒烟测试 | `vue/scripts/smoke-combat.mjs`（11/11 通过） | ✅ |
| A9 | 战斗态精简 prompt | — | ⬜ 未做 |
| A10 | `combatLLMRoles` 距离筛选 | `scheduler.ts: pickCombatRoles()` | ✅ |

### 7.6 落地时发现并修掉的既有 bug

**`damage()` 的三处调用点没传 `attacker`**（`entry.ts`）：

| 行 | 原代码 | 影响 |
|---|---|---|
| 5186 | `damage(s, target, dmg)` | 玩家普攻不触发战斗打点 |
| 5155 | `damage(s, t, skill.power)` | 玩家技能不触发战斗打点 |
| 5832 | `damage(s, t, sk.power)` | 另一处玩家技能同样漏传 |

这三个是**本次实现前就存在的调用疏漏**（`damage()` 的第 4 参数一直没人传）。没有它们，`damage()` 里基于 `attacker.side === "player"` 的判据永远不成立 —— 测试直接暴露了这个问题。已全部补上。

### 7.7 验证结果

| 验证 | 方法 | 结果 |
|---|---|---|
| 战斗状态机 | `smoke-combat.mjs` | ✅ 11/11 |
| 既有功能回归 | `smoke-entry.mjs` 改动前后对比 | ✅ 14 → 14 失败（全部为既有失败，零新增） |
| 前端构建 | `vite build` | ✅ 通过（453.62 kB） |
| 宿主构建 | `esbuild entry.ts → entry.js` | ✅ 通过（230.1 kB） |
| 类型检查 | `tsc --noEmit` | ✅ 本次改动零新增错误 |

---

## 8. 频率速查（给实现者的一页纸）

```
┌─ 事件触发（一次性 / 偶发）──────────────────────────────┐
│ 勾选托管        → 首次决策（P2 + 抖动错峰）            │
│ 切图            → new_map 事件（P1，强制刷新感知）      │
│ 战斗跃迁        → none→skirmish(P1) / →engaged(P0)     │
│ 地图集 ai_trigger → 按 priority 插队                   │
└─────────────────────────────────────────────────────────┘

┌─ 定时器触发（周期）─────────────────────────────────────┐
│ 基础间隔（按玩家战斗等级）：                            │
│   engaged  → 5000ms（地图集可下探到 3000）             │
│   skirmish → 10000ms                                  │
│   none     → 20000ms（地图集可上拉到 30000）            │
│ 地图集覆盖优先级：ai_interval 动作 > 地图级 ai.interval │
└─────────────────────────────────────────────────────────┘

┌─ 硬约束────────────────────────────────────────────────┐
│ 并发      : 全局 1 个 brain 请求在途（chatResult 单槽位）│
│ 下界      : engaged 3000ms / 其他 5000ms                │
│ 上界      : 30000ms                                     │
│ 每分钟预算 : max(10, 角色数 × 12)                       │
│ 失败冷却  : 全局 30s；连续 3 次失败 → 熔断 2 分钟        │
│ 紧急层    : 不受任何预算/熔断影响（纯程序化）            │
└─────────────────────────────────────────────────────────┘
```

---

## 9. 与已有文档的关系

| 文档 | 关系 |
|---|---|
| [ai托管.运行机制.md](./ai托管.运行机制.md) | 描述三层架构现状与 `sys_brain` 死信问题；本文是它的**频率层补充** |
| [ai托管.agent.系统提示词.md](./ai托管.agent.系统提示词.md) | 静态输出契约；本文决定**何时**调用它 |
| [ai托管.agent.传入参数.md](./ai托管.agent.传入参数.md) | `sys_brain` 的 input 契约；本文的调度器直接消费它 |
| [ai托管.agent.传出参数.md](./ai托管.agent.传出参数.md) | `chatResult` 单槽位机制；本文的 `inFlight` 闸门就是为它设计的 |
| [ai托管.ai怎么知道可以做什么.md](./ai托管.ai怎么知道可以做什么.md) | 能力清单；战斗态精简 prompt（A9）会裁剪它，但不能删 |
| [ai托管.插件.行为list.md](./ai托管.插件.行为list.md) | 插件行为清单（**待填**） |
| [ai托管.地图集.public.行为list.md](./ai托管.地图集.public.行为list.md) | 地图集行为清单（**待填**）——`ai_trigger` / `ai_interval` 应登记在此 |

---

## 10. 待决问题

1. **`maxInterval` 从 15s 上调到 30s 是否可接受？** 收益是省 33% token，但非战斗时 AI 的"存在感"下降。建议：**只对 `idle` 档用 30s，`skirmish` 保持 10s**，这样折中。
2. **战斗态精简 prompt 会裁掉"本图知识"，LLM 会不会做出"这里没有采集点"的错误决策？** 折中：战斗态保留**当前区域**的采集点（只裁掉全图知识），或让精简版 prompt 明确声明"战斗期间不采集"。
3. **`ai_interval` 覆盖是全局生效还是 per-角色？** 当前设计是全局（整张图统一）。若要 per-角色，需在 `AIState` 加 `intervalOverride` 字段，复杂度上升。
4. **战斗等级的"20m 内有敌人"判据谁来算？** 宿主有全部实体 → 宿主算最准。前端 `sensor` 只看 13m 感知半径内的，判不准。
5. **`interval` 触发器是否需要独立的"每图最大触发次数"上限？** 例如地图集写 `everyMs: 1000` 会造成灾难性的成本。建议：**加一个每图 `interval` 事件数上限（如 3 个）** + `everyMs` 硬下界 2000ms，在事件引擎加载时就校验并打警告。

---

## 11. 附录：现状代码索引（2026-10-23）

写这份设计时核对过的代码位置，方便实现时定位：

| 关注点 | 位置 | 现状 |
|---|---|---|
| 间隔计算 | `vue/src/ai/brain.ts:95-108` `calculateInterval()` | 按 **AI 自己的敌人**判 3s/10s/15s；本文 §2.3 改写 |
| 默认配置 | `vue/src/ai/types.ts:207-212` `DEFAULT_BRAIN_CONFIG` | `min 5000 / max 15000 / adaptive true / maxManaged 5`；本文改 `max → 30000` |
| 决策入口 | `vue/src/ai/brain.ts:293+` `callBrain()` | 紧急检查 → 事件检查 → 间隔检查 → LLM；**已具备本文需要的骨架** |
| 事件判定 | `vue/src/ai/brain.ts:110+` `shouldTriggerFromEvent()` | P0 无条件 / P1 可打断 move·wait·follow；**本文直接复用** |
| 主循环 | `vue/src/ai/index.ts:76+` `tickAllAIs()` | 逐角色 fire-and-forget 发起 LLM；**本文 §5 改为入队** |
| AI 事件 | `vue/src/ai/index.ts:52,57` `emitAIEvent` / `notifyAICombat` | **只有定义，没有调用点**；本文 §7.3-A8 接上 |
| 事件类型 | `vue/src/ai/types.ts:187-192` `AIGameEvent` | 9 种类型，含 `new_map` / `enemy_spotted` / `ally_need_help`，**均未派发** |
| 感知半径 | `vue/src/ai/sensor.ts:24-29` | 敌 13m / 资源 26m；**玩家被围在 20m 外时 AI 看不到** |
| 战斗感知 | `vue/src/ai/sensor.ts` `perception.nearby` | 只有 AI 自身视角；**无玩家战斗状态** |
| 事件引擎触发器 | `vue/src/eventEngine.ts:365,373,383` | `enter_map` / `interact` / `area_enter` 三种；**无 `interval`** |
| 事件引擎重复事件 | `vue/src/eventEngine.ts:295` 注释 | `area_enter` 采集类不进 `firedIds`，用冷却防连点 → `interval` 照此办理 |
| 触发器类型定义 | `workshops/.../events/shared/_ctx.ts:88-99` | `EventDef.trigger` 联合类型；**需加 `interval`** |
| 事件动作类型 | `workshops/.../events/shared/_ctx.ts:108-121` | `EventDef.actions` 联合类型；**需加 `ai_trigger` / `ai_interval`** |
| 伤害结算 | `entry.ts:1268` `damage()` | **所有伤害的唯一入口** → 玩家战斗状态的天然埋点 |
| 玩家普攻 | `entry.ts:5080` `case "attack"` | 走 `damage()` ✅ |
| 玩家技能 | `entry.ts:5050-5066` `case "skill"` | 走 `damage()` ✅ |
| tick 节奏 | `entry.ts:604` `TICK_DT_S = 0.1` / `App.vue:5910` `TICK_MS = 100` | 100ms/tick → `COMBAT_HOLD_TICKS = 300` = 30s |
| 地图集事件文件 | `workshops/.../events/maps/*.events.json` | 现只有 `enter_map` / `area_enter`；**根级 `ai` 字段待加** |
| 地图集脚本 | `workshops/.../events/scripts/*.ts` | 采集类脚本在跑（`E10_fishing_at` 等） |

---

*本文档为设计稿，代码改动清单见 §7。落地时建议按 §7.4 的四步顺序推进——第 1 步（玩家战斗状态 + 新间隔公式）不依赖任何新机制，可独立上线。*
