# 插件层 AI 能力落地清单（核对实际代码）

> 核对时间：2026-10-14 起，2026-10-15 更新（MapKnowledge 抽象完成）
> 核对范围：`plugins/toonflow-field-survival/vue/src/ai/*`、`vue/src/App.vue`、`entry.js`
> 结论一句话：**决策链路（大脑）100% 做了；执行链路（脊椎）follow/gather/useSkill/interact/useItem 全部接通；采集产出改由地图集事件脚本决定（不再插件硬编码）；地图专属知识（MapKnowledge）已抽象落地。唯一结构性待办是 `entry.ts` 双镜像未与 `entry.js` 对账。**

---

## 一、能力归属总表（插件 vs 地图集）

| 能力 | 归属 | 说明 |
|------|------|------|
| 大脑层 LLM 决策器（prompt 构造、JSON 解析、触发策略、冷却、兜底） | ✅ 插件 | 所有地图共用同一套决策逻辑 |
| 感知系统 sensor（HP/MP/背包/技能、敌我 NPC、资源点、世界信息） | ✅ 插件 | 来自实体 + 全局 state，地图无关 |
| 通用行为函数库（autoAttack/followPlayer/fleeFromEnemy/drinkPotion/startGathering/talkToNPC/depositToRing） | ✅ 插件 | 跨图通用 |
| 紧急反应系统（低血逃跑、蓝耗等待、背包满、被包围、目标死亡切换） | ✅ 插件 | 硬编码生存逻辑 |
| 脊椎执行引擎（NavMesh 寻路、碰撞避障、动画、攻击判定） | ✅ 插件 | 底层执行，地图无关 |
| AIBus 大脑↔小脑通信、`#ai xxx` 指令解析、AI 状态持久化 | ✅ 插件 | 基础设施 |
| 地图作息剧本（镇上早上打坐/中午药堂/傍晚演武场） | ✅ 地图集 | 仅本图适用 |
| 地图坐标与资源点 zone 配置 | ✅ 地图集 | 坐标是地图数据 |
| 地图特化采集优先级 | ✅ 地图集 | 优先级表按图配置 |
| 地图专用行为注册（`events/scripts/<map>_ai.ts`） | ✅ 地图集 | 由地图集导出 `mapKnowledge` |

**边界**：插件管「怎么想 + 怎么动 + 怎么活」；地图集管「在这张图该干什么」。

---

## 二、已完成项（代码在跑）

`vue/src/ai/` 共 **1917 行**，七模块齐全：

| 模块 | 行数 | 状态 |
|------|------|------|
| `types.ts` 类型 / 默认配置 | 240 | ✅ 含 `DEFAULT_BRAIN_CONFIG` |
| `sensor.ts` 感知 + 紧急检查 | 231 | ✅ 自身/敌我NPC/资源/世界 + 4 类紧急反射；资源感知改走 `mapKnowledge`（修药堂误判）|
| `brain.ts` 大脑层 | 423 | ✅ prompt 构造、JSON 解析、自适应间隔、事件触发、冷却、双层兜底、记忆；注入 `MapKnowledge.summary` |
| `spine.ts` 脊椎层 | 362 | ✅ move/attack/gather/flee/useItem/useSkill/interact/follow/stopMove 全部走通道 |
| `chatCommand.ts` `#ai` 指令 | 278 | ✅ 关键词快速通道 + LLM 通道 + 兜底 |
| `index.ts` 主循环 | 221 | ✅ `tickAllAIs` 每 tick 驱动；新增 `consumeGatherArrivals` 消费宿主到达标记 → 触发地图集脚本 |
| `mapKnowledge.ts` **地图知识派生（新增）** | 162 | ✅ 从 `eventEngine` 的 `getEventZones/getLoadedEvents` 实时派生采集点/交互点，注入大脑 |

集成点已验证：

- `App.vue:5647` `registerAILLM(callBrainLLM)` → `sendTick("sys_brain")` → 宿主 LLM → 决策回传
- `App.vue:3084` `tickAllAIs` 每 tick 执行
- `RolePanel.vue:167` AI 托管开关
- `entry.js:2856` `case "ai_command"` 处理 `move/attack/stop/useItem/_mark_managed`，写 `_aiMoveTo/_aiAttackTarget/_aiManaged`

**架构约束已落地（正确）**：spine 不直接改 state（会被服务端覆盖），只发 `ai_command`；entry.js 是 state 唯一权威。

---

## 三、落地进度

> 2026-10-14 已实施 P0 + P1（除MapKnowledge）+ P2；2026-10-15 完成 MapKnowledge 抽象，`vite build` 与 `node --check entry.js` 均通过，6 项派生测试全过。

### P0 — 明显失效（✅ 已完成）

- [x] **follow 跟随玩家** — `spine.ts` 新增 `executeFollow()`：查玩家实体，>2.5m 发 `move` 追玩家，≤2.5m 发新命令 `stopMove`（只清 `_aiMoveTo`，**不清 `_aiManaged`**，否则会被踢出托管）。`isActionComplete` 补 follow 到位判定。
- [x] **gather 真实产出** — 双端改造：
  - `spine.ts` `executeGather()` 改发 `action:"gather"`（不再降级为纯 move），带 `zoneName`。
  - `entry.js` 新增 `case "gather"` 写 `ent._aiGather = { zoneName, x, y, startedTick, paid }`（到达标记）。
  - 新增 `tickAIOrders(s)` 在 ally 移动循环**之后**执行（要用到达后的位置）：到达后**不再插件硬编码掉落**，改打 `_aiGatherArrived` 标记（带 `zoneName + reqId`）→ 前端 `consumeGatherArrivals` 消费 → `mapKnowledge.triggerZoneGather` → `eventEngine.fireEventManually` 触发**地图集 `events/scripts/E11_herb_at.ts` 等脚本**决定产出（落 `ent._aiBag`）。
  - `isActionComplete` 的 gather 从读**从未被写入的 `gatherStartedAt`**（导致永远不完成）改为**到达判定** `dist ≤ GATHER_ARRIVE_M`。
- [x] **useSkill 技能执行** — `spine.ts` `executeSkill()` 发 `action:"useSkill"`；`entry.js` 新增 `case "useSkill"`：以 `s.skills` 为技能池校验存在/CD(`cdLeft`)/蓝耗(`cost`)，扣蓝 + 置 `cdLeft`（CD 由既有 `entry.js:1242` 每 tick 递减），按 `type/range` 分派 heal / buff / ranged / melee 四套结算与 VFX，复用 `damage()`。

### P1 — 功能残缺

- [x] **interact / NPC 对话** — `spine.ts` 新增 `executeInteract()` 发 `action:"interact"`；`entry.js` 写 `_aiInteract` 并把移动目标设为 NPC 坐标，`tickAIOrders` 到达 ≤ `AI_INTERACT_M`(2m) 后 `resolveAIInteract()` 推事件 + 气泡 + `s.aiTalks`。
- [x] **useItem 回血数值** — `spine.ts` 新增 `lookupItemHeal()` 按名称（精确/模糊）读背包真实 `heal`/`mp`，找不到则返回失败而非假成功；`entry.js` 按下发值结算 HP/MP 并回显实际增量（`+12HP`），附 `heal_ring` VFX。
- [x] **MapKnowledge 抽象落地** — 新增 `vue/src/ai/mapKnowledge.ts`，从 `eventEngine` 的 `getEventZones/getLoadedEvents` **实时派生**当前地图知识（采集点 kind 三级推断 + 交互点 uid 列表 + `summary` 段），`brain.ts` 注入 prompt、`sensor.ts` 替换旧的 `includes("药")` 硬编码资源感知、`index.ts` 消费 `_aiGatherArrived` 走事件脚本产出。`events.json` 加 `trigger.ai.gather` 显式声明，`_ctx.ts` 补类型。详见第七节验证。

### P2 — 代码卫生（✅ 已完成）

- [x] **删除死代码** — `index.ts` 删 `syncBrain` / `fallbackDecisionSync` / `tickSyncAIs`（共 72 行）；`emitAIEventSimple` 改为直接调用 `pushAIEvent`（去掉运行时 `require` / 动态 `import`）；`brain.ts` 的 `tickAI` 空壳保留（对外 API 兼容）。清理未使用的 `AIPerception` / `updatePerception` / `checkEmergency` 导入。

### 顺带修掉的隐性缺陷

| 缺陷 | 位置 | 说明 |
|------|------|------|
| AI 角色背包恒为空 | `sensor.ts:27` `senseSelf()` | 原来直接拿**玩家**的 `state.items` 当 AI 的背包 → 大脑永远认为「背包是空的」，采集产出后也不知道。改为优先读 `entity._aiBag`（entry.js 权威写入），无则回退玩家背包。 |
| 采集动作永不完成 | `spine.ts` `isActionComplete` | 原判据 `state2.gatherStartedAt` 从未被任何代码赋值 → `if (!x) return false` 恒成立 → gather 动作永久占用 `currentAction`，大脑再也不会决策。 |

---

## 四、新增的宿主侧 AI 状态字段

| 字段 | 挂在哪 | 生命周期 | 用途 |
|------|--------|----------|------|
| `_aiGatherArrived` | `entity` | 前端消费后清除（按 `reqId` 去重，标记不自删） | 采集到达标记（含 `zoneName` + `reqId`），前端据此触发地图集脚本 |
| `_aiInteract` | `entity` | 触发或超时后删除 | 交互在途状态 |
| `_aiBag` | `entity` | 持久（随 entities 回推） | AI 自己的背包 |
| `buffs` | `entity` | 持久 | buff 技能加持记录 |
| `aiGatherCd` | `state` | 持久 | `角色id|zone名` → 冷却截止 tick |
| `aiTalks` | `state` | 滑动窗口 20 条 | AI↔NPC 交谈气泡 |

常量（`entry.js:156` 附近）：`AI_GATHER_TICKS=30`、`AI_GATHER_COOLDOWN_TICKS=200`、`AI_GATHER_ARRIVE_M=1.2`、`AI_INTERACT_M=2`。

**采集产出已不在插件硬编码**：`entry.js` 的 `resolveAIGather()` 只打 `_aiGatherArrived` 标记（带 `zoneName + reqId`），前端 `consumeGatherArrivals` 消费后调用 `mapKnowledge.triggerZoneGather(zone)` → `eventEngine.fireEventManually(evId)` → 触发 `events/scripts/E11_herb_at.ts` 等**地图集脚本**决定掉什么。这样玩家走进农田和 AI 走进农田走同一套产出逻辑，插件零重复实现。

**通道扩展**：`ai_command` 支持的动作从`move/attack/stop/useItem/_mark_managed` 扩展为
`move / attack / stop / stopMove / gather / interact / useSkill / useItem / _mark_managed`。

其中 `stopMove` 是新概念：**只清移动目标，保留托管标记**；原有 `stop` 会`delete ent._aiManaged`，导致跟随到位/采集到点时AI 被踢出托管。

---

## 五、数据流（当前实现）

```
sensor.updatePerception()读 entity + state + eventZones
   ↓
brain.callBrain() prompt + LLM →决策 JSON（含兜底策略）
   ↓
spine.executeAction() 发 ai_command
   ↓
sendTick("ai_command") →宿主 → entry.js handle_action
   ↓
entry.js:写 _aiMoveTo / _aiAttackTarget / _aiGatherArrived(标记) / _aiInteract / _aiBag
   ↓
entry.js 每 tick: ally 移动循环 → tickAIOrders() 仅打到达标记（不结算产出）
   ↓
state 回推 → 前端 consumeGatherArrivals 读 _aiGatherArrived
   ↓
mapKnowledge.triggerZoneGather(zone) → eventEngine 触发地图集采集脚本 → 产出落 _aiBag
   ↓
state 回推 → 下轮 sensor 读到 _aiBag
```

`MapKnowledge` 已实现（`vue/src/ai/mapKnowledge.ts`，实际结构）：

```ts
interface MapKnowledge {
  mapName: string;
  gatherZones: ZoneKnowledge[];   // 可采集点（从 events.json 的 area_enter 事件派生）
  interactUids: string[];         // 可交互 NPC uid 列表
  summary: string;                // 注入大脑 prompt 的「本图知识」段
}
interface ZoneKnowledge {
  name: string; x: number; y: number;
  kind: "herb" | "fish" | "wood" | "ore" | "other";
  eventId: string; repeat: boolean;
}
```

派生规则（三级推断，已在 `tmp/test_map_knowledge.cjs` 6 项测试覆盖）：
1. **显式声明优先** — `events.json` 的 `trigger.ai.gather`（如 `"ai": { "gather": "herb" }`）；
2. **事件 id 推断** — `E11_herb_at` → herb，`E10_fishing_at` → fish；
3. **zone 名兜底** — `农田/药/草` → herb，`木材/树` → wood 等。
特别：**无显式声明且解析为兜底 `other` 的 area_enter 事件（如「拾扫帚」剧情）不算采集点**，避免 AI 跑去无产出的 zone。

---

## 六、剩余工作

1. **⚠️ `entry.ts` 双镜像对账（结构性，最高优先）** — `entry.ts`（git 跟踪的「主 TS 宿主」）与 `entry.js`（dev-host 实际加载）**已严重分歧**：
   - `entry.ts` 无 `ai_command` switch、无 `_aiManaged/_aiAttackTarget`、无本次新增的 `follow/gather/useSkill/interact/stopMove/_aiGatherArrived` 任何逻辑（grep 0 匹配）。
   - 它走另一套 AI 机制（`_aiMoveTo` 通用应用器 + ally 循环），结构完全不同。
   - 后果：本地 dev-host 用 `entry.js`（已生效）；但**推送到已安装副本 / 手机真机时若用 `entry.ts` 则会丢失全部 AI 托管能力**。
   - 处置建议（需用户决策，不要盲改）：① 确认真机/已安装副本到底加载哪个文件；② 若加载 `entry.js` 则 `entry.ts` 可废弃或重新从 `entry.js` 反向生成；③ 若加载 `entry.ts` 则必须把 `entry.js` 的整套 `ai_command` 机制移植过去。**这是一笔独立对账工程，不属本次 MapKnowledge 范围。**
2. **坐标单位隐患**（未动，仅记录）— `App.vue:2312` 的 `setEventZones` 只做 `x - W/2` 平移，**不乘/除 TILE_SIZE(32)**，zone 坐标仍是「格」；而实体坐标是「米」（`WORLD_X_RANGE=±1500`）。`sensor.ts` 拿两者直接 `Math.hypot` 比较，单位不一致 —— 表现为「感知半径 26m」实际覆盖范围随地图大小漂移。落地采集时若出现「AI 走不到 zone」优先查这里。
3. **药堂误判为 herb（已修）** — 旧 `sensor.ts` 用 `includes("药")` 判 herb，会把「药堂」（打坐地点）当药材点。现 `senseResources` 改走 `mapKnowledge`：`药堂` 若无 `area_enter` 采集事件则根本不出现在 `gatherZones`，彻底消除误判。

---

## 七、验证记录（2026-10-15）

- `tmp/test_map_knowledge.cjs`：**6 项全过**（显式声明读取 / id 推断 / zone 名兜底+声明优先 / 无事件空知识 / reqId 去重 / repeat 优先）。
- `node --check entry.js`：通过。
- `vite build`：71 modules 通过，产物 `ui/game.html`（2.80MB），grep 确认含 `本图可采集地点` / `triggerZoneGather` / `_aiGatherArrived`。
- 三处 `mulberryTown.events.json`（workshops / ui/events / vue/public/events）均加 `trigger.ai.gather` 声明，JSON 合法。
- `events/shared/_ctx.ts` 的 `EventDef.trigger` 加 `ai?: { gather?: string }` 字段。