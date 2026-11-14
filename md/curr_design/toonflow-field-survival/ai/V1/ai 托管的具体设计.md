# ai 托管的具体设计
## 1. 引言
架构设计已在
[ai_分类.md](ai_%E5%88%86%E7%B1%BB.md)
[ally 类型角色的ai 托管能力.md](ally%20%E7%B1%BB%E5%9E%8B%E8%A7%92%E8%89%B2%E7%9A%84ai%20%E6%89%98%E7%AE%A1%E8%83%BD%E5%8A%9B.md)

## 什么ai 能力做到插件，什么ai 能力做到地图集

按「三层神经架构」沿 **通用 vs 专用** 切分：**插件** 装「大脑 + 通用肢体 + 保命反射 + 执行脊椎 + 通信」；**地图集** 只装「这张地图的作息剧本、坐标、资源点、采集优先级」这类地图专属经验，通过 `events/scripts/<map>_ai.ts` 注册给小脑。

### 判定表：什么进插件 / 什么进地图集

| 能力 | 归属 | 依据 |
|------|------|------|
| **大脑层 LLM 决策器**（prompt 构造、决策 JSON 解析、触发策略、冷却、事件触发判断、错误兜底） | ✅ 插件 | 所有地图共用同一套"决策逻辑 + 大模型接口"，不依赖任何地图数据 |
| **感知系统 sensor**（自身 HP/MP/背包/技能、周围敌我 NPC、资源点、世界信息） | ✅ 插件 | 数据来自实体 + 全局 state，地图无关 |
| **通用行为函数库**（`autoAttack / followPlayer / fleeFromEnemy / drinkPotion / startGathering / talkToNPC / depositToRing` 等） | ✅ 插件 | 架构文档 3.1「所有地图通用」 |
| **紧急反应系统**（低血逃跑、蓝耗等待、背包满、被包围、目标死亡切换） | ✅ 插件 | 架构文档 3.3 硬编码，纯生存逻辑，跨图复用 |
| **脊椎执行引擎**（NavMesh 寻路、碰撞避障、动画、攻击判定） | ✅ 插件 | 架构文档模块4，底层执行，地图无关 |
| **大脑↔小脑通信 AIBus**、`#ai xxx` 触发指令解析、AI 状态持久化 | ✅ 插件 | 基础设施，全图共用 |
| **地图专用行为**（`events/scripts/<map>_ai.ts` 里注册） | ✅ 地图集 | 架构文档 3.2「某个地图专用」 |
| **地图本地坐标/资源点配置**（祖师堂(6,15)、药堂(6,37)、演武场(20,30)、农田/木材堆/喷水池 的 eventZones） | ✅ 地图集 | 坐标和 zone 名是地图数据，插件不知道某张图哪格是农田 |
| **地图特有的时序/作息行为**（镇上早上打坐/中午药堂/傍晚演武场） | ✅ 地图集 | "镇上才有"的剧本，森林/荒野不适用 |
| **地图特化资源采集优先级**（本图农田优先采药草） | ✅ 地图集 | 优先级表按图配置 |

### 边界一句话

**插件** 负责"怎么想 + 怎么动 + 怎么活"（大脑决策、通用肢体、保命反射、执行脊椎、通信协议）；**地图集** 负责"在**这张图**上该干啥"（作息脚本、坐标、资源点、采集优先级），把地图专属"经验值"注册给小脑。

### 数据流（大脑如何吃到地图知识）

```
地图集 events/scripts/<map>_ai.ts
   └─ 导出 mapKnowledge = { schedule, zones, gatherPriority }
        │
        ▼
插件 小脑层按当前 mapName 查 mapKnowledge
        │
        ▼
插件 大脑层构造 prompt 时，把 mapKnowledge 注入「当前地图信息」段
        │
        ▼
LLM 决策 → 调用通用行为函数 / 地图注册行为
```

### 待补规范（文档缺口）

1. **地图知识注入结构**：`events/scripts/<map>_ai.ts` 统一导出 `mapKnowledge`，作为大脑 prompt 的"当前地图信息"段来源：

   ```typescript
   export interface MapKnowledge {
     schedule: Array<{ timeRange: string; behavior: string; target?: { x: number; y: number } }>; // 作息剧本
     zones:    Array<{ name: string; x: number; y: number; type: "herb" | "fish" | "wood" | "safe" | "combat" }>;
     gatherPriority: Array<{ zone: string; priority: number; when?: string }>; // 采集优先级表
   }
   ```

2. **大脑 prompt 的地图注入点**：架构文档 system prompt 里的 `{{当前地图}}` 必须替换成"地图名 + `mapKnowledge` 摘要"，否则大脑不知道本图该干嘛。建议在 plugin 大脑层留 `{{mapSpecificHint}}` 占位，由地图集行为脚本填。

---

## 5. 设计评审（2026-10-23）

对照实际代码逐条核验，本文 §2 的判定表和 §4 的数据流**方向正确，但有 6 处与实现脱节**。结论：**文档描述的是"目标态"，代码实现的是"另一个更简的方案"，两者需要对齐**。

### 5.1 ✅ 判断正确的部分

- **插件/地图集的职责切分**（§2 判定表）方向完全正确，且代码已经按这个方向实现了——`mapKnowledge.ts` 的注释明确写着「插件不硬编码任何地图数据」，`chatCommand.ts` 的采集规则也走数据驱动。
- **不重复实现地图产出逻辑**：采集产出交给 `events/scripts/*.ts`，插件只负责「走到 zone」——这个决策很对，避免了 N 个地图 N 份采集代码。
- **待补规范 §4.2 的 `{{mapSpecificHint}}` 占位**：代码里**已经实现了**（`brain.ts` buildSystemPrompt 有 `## 本图知识（地图集提供）` 段，读 `readMapKnowledge().summary`）。文档把它列为"待补"，实际已做。

### 5.2 ❌ 问题 1：地图知识的数据结构与代码完全不同（最严重）

**文档设想**（§4.1）：
```typescript
// events/scripts/<map>_ai.ts 导出
export interface MapKnowledge {
  schedule: [...]        // 作息剧本
  zones: [...]           // 区域
  gatherPriority: [...]  // 采集优先级
}
```

**代码实际**（`ai/mapKnowledge.ts`）：
```typescript
// 无地图专属 AI 脚本，实时从 eventEngine 派生
export interface MapKnowledge {
  mapName: string;
  gatherZones: ZoneKnowledge[];  // 从 eventZones + area_enter 事件派生
  interactUids: string[];         // 从 interact 事件派生
  summary: string;
}
```

实证：**全仓库 `find workshops -name "*_ai.ts"` 结果为空**——§3.2 和 §4.1 设想的地图集 AI 脚本**一个都没写**，也没有任何 `schedule` / `gatherPriority` / `registerBehavior` / `registerPriority` 的代码。

**实际机制完全不同**：地图集通过 `events.json` 的 `trigger.ai.gather` 字段声明「这个 zone 能采什么」，插件的 `mapKnowledge.ts` 实时读取并推断：

```
地图集 events.json: { trigger: { type:"area_enter", zone:"农田", ai:{ gather:"herb" } } }
       ↓ eventEngine.getLoadedEvents()
   mapKnowledge.resolveGatherKind()  优先级：
       ① 显式声明 trigger.ai.gather  ② 事件 id 推断  ③ zone 名关键词推断
       ↓
   gatherZones[] → sensor 感知 → prompt「本图可采集地点」
```

**这个方案其实比文档设想的更好**：不需要地图集作者额外写一个 `<map>_ai.ts`，只要在既有事件上多写一个字段。文档的 `schedule`（作息剧本）和 `gatherPriority`（优先级表）能力目前**完全缺失**——没有任何代码支持。

**建议**：改文档而不是改代码——把 §4.1 的「待补规范」替换为实际的数据流（`trigger.ai.gather` 声明制），并明确标注 `schedule`/`gatherPriority` 为**未实现的未来能力**（见 §5.2 补充方案）。

### 5.3 ❌ 问题 2：`AIBus` 通信机制完全未实现

§2 判定表列了「大脑↔小脑通信 AIBus ✅ 插件」，架构文档还给了完整代码（`AIMessage` 联合类型 + `AIBus` 类 + `queues` Map）。

**代码实证**：`grep -n "AIBus" ai/*.ts` → **零结果**。`AIState.actionQueue` 字段定义了但**从未被读写**（只在 `getOrCreateAIState` 初始化为 `[]`、在 `setAIEnabled(false)` 时清空）。

**实际机制**：`brain.ts` 直接改 `aiState.currentAction` 单个字段，没有消息队列、没有优先级仲裁。`spine.ts` 每 tick 读 `currentAction` 执行。

**影响**：架构文档描述的「小脑上报紧急事件给大脑、大脑覆盖小脑指令」这种双向通信，目前是**单向的**——紧急事件由 `sensor.checkEmergency` 在决策前直接覆盖，不需要经过通信层。

**建议**：从 §2 判定表删掉 AIBus，或降级标注为"未实现，当前用 AIState 单字段直连替代"。保留它会让人误以为系统有消息总线能力。

### 5.4 ❌ 问题 3：「脊椎执行引擎 = NavMesh 寻路 + 碰撞避障」与实现严重不符

§2 判定表和架构文档模块 4 都描述了完整的 NavMesh 寻路 + 碰撞检测 + 路径点跟随，架构文档甚至给了 `AISpineExecutor.executeMove` 的实现代码（含 `findPath(entity.x, entity.y, target.x, target.y, state.navMesh)`）。

**代码实证**：
```typescript
// entry.ts:1333 实际实现
function moveTowards(e: Entity, tx: number, ty: number, speed: number) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = (dx / d) * speed;   // ← 直接朝目标方向给速度
  e.vy = (dy / d) * speed;
  if (Math.abs(dx) > 2) e.facing = dx > 0 ? 0 : 180;
}
```

`grep -n "NavMesh|findPath" ai/*.ts entry.ts` → **零结果**。

**实际是直线朝目标冲，没有寻路、没有避障**。这意味着：
- 角色会被墙挡住（`walkGrid` 阻挡处停住）
- 多个角色会互相穿模（无角色间避让）
- `isActionComplete` 里 `dist < 0.8` 判定到达，但被墙挡住时永远到不了 → **AI 陷入永久"移动中"状态**（`_aiMoveTo` 60 秒超时才清除，见 entry.ts:1979）

**建议**：这是真实缺陷而非文档问题。要么补简易避障（如 A* 或至少沿墙滑动），要么在文档里把"NavMesh"降级为"直线移动 + 网格碰撞"，并把「被阻挡时如何决策」列入待补。

### 5.5 ⚠️ 问题 4：`depositToRing`（存入纳戒）在能力表里但无实现

§2 判定表列出通用行为函数包含 `depositToRing`（存入纳戒），架构文档 3.1 也有 `depositToRing: () => AIAction`。

**代码实证**：`grep -rn "depositToRing|纳戒" ai/*.ts` → 零结果。背包满时 `checkEmergency` 的 `inventoryFull` flag 置位，但**没有任何动作消费这个 flag**——AI 背包满了之后会继续采集，然后在 `entry.ts` 里撞到 `AI_BAG_MAX_SLOTS` 上限被拒绝（`私藏已满（8格），X 未能收入`），白白走一趟。

**建议**：要么实现 `depositToRing`，要么把 `inventoryFull` 从 `EmergencyFlags` 移除，避免"检测到了但没人处理"的假信号。

### 5.6 ⚠️ 问题 5：多角色并发无隔离，且大脑调用串行化风险

`ai/index.ts tickAllAIs` 是同步 for 循环遍历所有托管角色，每个角色独立 fire-and-forget 一个 `callBrain` 的 Promise。文档 §5「注意事项」提到"限制同时托管的 AI 角色数量（建议最多5个）"——**代码里没有这个限制**。

更要紧的是：结合 [ai托管.运行机制.md](./ai托管.运行机制.md) 发现的 `sys_brain` 通道死信，每个角色每次决策都会等满 **15 秒超时**。5 个角色托管 = 每轮决策周期里 5 个 15 秒悬挂的 Promise，而且 LLM 失败后**没有冷却**，下一轮心跳（idle 状态 15 秒后）又全部重试。

**建议**（与运行机制文档 P2 合并）：
- 实现并发上限（≤5）
- LLM 失败后 30s 冷却，避免持续白烧
- `waitBrainResult` 超时 15s → 8s

### 5.7 ⚠️ 问题 6：`#ai xxx` 触发路径与"插件行为库"设计不一致

§2 判定表把「`#ai xxx` 触发指令解析」归为插件基础设施（✅ 正确），但没说清它**不走大脑**。

**代码实证**（`ai/chatCommand.ts`）：`#ai` 走的是**关键词正则 → 直接出动作**的快速通道（12 组 KEYWORD_RULES），命中就 `executeAction`，**根本不经过 LLM**。只有关键词全不命中才落到 `callBrainForCommand`。

这意味着文档里描述的「用户与角色对话时输入 `#ai 帮我去收集木材` → AI 理解意图 → 决策」在实现上是**正则匹配**，不是 AI 理解。

这本身没问题（快速通道省 token、响应快），但文档应该明确说明这条设计决策，否则会让人误以为 `#ai` 是自然语言理解。

### 5.8 补充建议：`schedule`（作息剧本）能力值得补，但换一种实现

文档设想地图集导出 `schedule`（早上打坐/中午药堂/傍晚演武场）。当前代码**完全没有时间驱动的行为**——`AIWorldPerception.timeOfDay` 字段存在（读 `state.timeOfDay`），但 brain.ts 的 prompt 里**从未使用它**。

如果要实现作息剧本，建议**不要**走 `<map>_ai.ts` 新文件，而是复用现有的 `events.json` 事件系统：地图集用 `trigger: { type: "time_range", from: "06:00", to: "08:00", zone: "祖师堂" }` 声明时段行为，`mapKnowledge.ts` 派生为 `schedule` 注入 prompt。这样与采集点声明保持同一套机制，地图集作者只需学一种语法。

### 5.9 评审结论

| 分类 | 条目 |
|---|---|
| ✅ 设计正确、代码已实现 | 插件/地图集职责切分、产出逻辑归属地图集、`{{mapSpecificHint}}` 注入点 |
| ❌ 文档需改（代码更优） | 地图知识数据结构（`trigger.ai.gather` 声明制优于 `<map>_ai.ts`）、AIBus（未实现）、NavMesh（未实现）、`depositToRing`（未实现） |
| ⚠️ 需决策 | 作息剧本是否补（建议用 events.json 复用）、多角色并发上限、`#ai` 快速通道需在文档注明 |
| 🔴 真实缺陷（非文档问题） | 无避障导致被墙阻挡时 AI 卡死、背包满 flag 无消费、sys_brain 通道死信（见运行机制文档） |

**总评**：分层职责的**设计判断力很强**（尤其"产出逻辑归地图集、插件不硬编码"这一条，代码执行得很到位），主要问题是文档写于实现之前，部分设计（NavMesh、AIBus、`<map>_ai.ts`）在实现时被简化了，而文档没有回填。**建议以本文 §5.2 的实际机制为准回填文档，并优先修复 §5.4（卡死）和运行机制文档里的 sys_brain 断链。**