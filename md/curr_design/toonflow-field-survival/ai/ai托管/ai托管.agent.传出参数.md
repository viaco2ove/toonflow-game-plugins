# AI 托管 Agent · 传出参数（output 契约与校验）

> **产出方**：LLM（`u.ai.text.invoke`）
> **接收方**：`PluginAgentRunner` → `entry.ts` → `state.chatResult` → 前端 `notifyBrainResult` → `brain.ts parseLLMResponse`
> **对应代码**：`ai/brain.ts:226-254`（解析）+ `ai/spine.ts`（执行）

---

## 1. 完整流转

```
LLM 输出（文本）
  ↓ PluginAgentRunner 返回 { ok: true, output: { text: "raw LLM 文本" } }
  ↓
entry.ts case "sys_brain"：剥 markdown 围栏 → s.chatResult = { reqId, ok:true, text: raw }
  ↓
前端 notifyBrainResult → waitBrainResult 兑现 → callBrainLLM 返回 string
  ↓
brain.ts parseLLMResponse(raw)
  ├─ 正则抽 JSON：raw.match(/\{[\s\S]*\}/)
  ├─ JSON.parse
  ├─ 校验：obj.action && obj.action.type
  └─ 返回 LLMDecision | null
  ↓
null → fallbackDecision(perception)（兜底）
非 null → applyDecision：写回 AIState.goal / currentAction + addMemory
  ↓
spine.ts executeAction(entity, action, state)
  ├─ 参数校验（每个 executeXxx 开头）
  ├─ sendTick("ai_command", {...})
  └─ 返回 ActionResult{success, message}
  ↓
宿主 entry.ts case "ai_command"：执行并返回 okResp
```

---

## 2. LLM 期望输出格式

```json
{
  "reasoning": "决策理由，一句话，20字以内",
  "goal": "当前目标的一句话描述",
  "action": {
    "type": "move|attack|gather|interact|useSkill|useItem|flee|wait|follow",
    "target": { "id": "实体id", "x": 0, "y": 0, "name": "实体名" },
    "skillName": "仅 useSkill 需要",
    "itemName": "仅 useItem 需要",
    "zoneName": "仅 gather 需要",
    "duration": 3000,
    "priority": 50,
    "context": "执行这个动作的原因，会展示给玩家"
  }
}
```

### 字段说明

| 字段 | 类型 | 必需 | 消费方 | 说明 |
|---|---|---|---|---|
| `reasoning` | string | 建议 | `addMemory` | 决策理由，入 AI 记忆 |
| `goal` | string | 建议 | `AIState.goal` | 写入后成为下一拍的「当前目标」 |
| `action.type` | string | **必需** | `spine.executeAction` | 决定执行哪个分支 |
| `action.target` | object | 视 type | 各 executeXxx | `{id?, x?, y?, name?}` |
| `action.skillName` | string | useSkill 必需 | `entry.ts` 查技能表 | 必须与 `state.skills[].name` 完全一致 |
| `action.itemName` | string | useItem 必需 | `spine.lookupItemHeal` | 模糊匹配背包（name 双向 includes） |
| `action.zoneName` | string | gather 必需 | `entry.ts` + `mapKnowledge` | 必须与 eventZones 的 name 一致 |
| `action.duration` | number | wait 建议 | `isActionComplete` | 毫秒，默认 3000 |
| `action.priority` | number | 可选 | 记录用 | 0-100，`parseLLMResponse` 默认 50 |
| `action.context` | string | 建议 | `addMemory` + 日志 | 执行原因 |

---

## 3. 解析与校验（现有实现 + 缺口）

### 3.1 当前 `parseLLMResponse` 实现

```typescript
function parseLLMResponse(raw: string): LLMDecision | null {
  if (!raw) return null;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);   // ① 正则抽第一个 {...} 块
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]);
    if (!obj.action || !obj.action.type) return null;   // ② 唯一校验
    return {
      reasoning: String(obj.reasoning || ""),
      goal: String(obj.goal || ""),
      action: {
        type: obj.action.type,          // ⚠️ 未校验是否在 9 种枚举内
        target: obj.action.target || undefined,
        skillName: obj.action.skillName,
        itemName: obj.action.itemName,
        zoneName: obj.action.zoneName,
        priority: obj.action.priority || 50,
        context: String(obj.action.context || obj.reasoning || ""),
      },
    };
  } catch (e) {
    console.warn("[ai-brain] LLM响应解析失败:", e);
    return null;
  }
}
```

### 3.2 校验缺口（P2 补齐）

| # | 缺口 | 后果 | 校验方案 |
|---|---|---|---|
| 1 | **`type` 未校验枚举** | LLM 幻觉出 `"type":"teleport"`，`spine` 落到 `default` 返回「未知动作」，白跑一次决策 | `if (!VALID_TYPES.includes(type)) return null` |
| 2 | **`skillName` 未校验存在性** | 宿主返回 `技能「火球术」不可用`，但 `executeSkill` 仍返回 `success:true`，**AI 以为施放成功** | 前端校验 `skills.some(s => s.name === skillName)`，不存在走 fallback |
| 3 | **`itemName` 模糊匹配过宽** | 双向 `includes`，`"药水"` 可能匹配到 `"高级药水"` | 优先精确匹配，模糊仅当唯一命中时 |
| 4 | **`zoneName` 未校验** | 走到不存在的 zone，宿主写 `_aiGather` 后无产出，但 AI 一直在移动 | 校验 `zoneName` ∈ `perception.resources[].zoneName` |
| 5 | **`duration` 无上下限** | LLM 输出 `duration: 999999` → AI 干等 16 分钟 | `clamp(duration, 200, 10000)` |

### 3.3 兜底决策（`fallbackDecision`）

解析失败或校验不通过时，走 `brain.ts:257-298` 的纯程序化兜底：

| 条件 | 兜底动作 |
|---|---|
| `perception.nearby.enemies.length > 0` | `attack` 最近敌人（priority 60） |
| 否则 `perception.resources.length > 0` | `gather` 最近资源（priority 50） |
| 都不满足 | `wait` 3000ms（priority 30） |

**兜底永远返回合法动作**，AI 永不停摆。这是当前 LLM 通道断链 15 秒后仍能工作的原因。

---

## 4. 动作执行结果（ActionResult）

```typescript
interface ActionResult { success: boolean; message: string; nextAction?: AIAction; }
```

**注意 `success` 语义是「命令是否发出」，不是「动作是否完成」**：

| 动作 | success=true 的条件 | 真正完成判定（`isActionComplete`） |
|---|---|---|
| `move` | target 坐标合法 | `dist < 0.8` |
| `attack` | target.id 存在（不检查死活） | `!target.alive` |
| `gather` | zoneName 或 target 存在 | `dist ≤ 1.2`（到达即结算） |
| `useSkill` | skillName 非空（不校验技能是否存在） | 瞬发 |
| `useItem` | 背包里能找到该物品 | 瞬发 |
| `flee` | 场上 ≥1 敌人 | `dist < 0.8` |
| `wait` | 总是 true | `Date.now() >= cooldownUntil` |
| `follow` | 玩家在场 | `dist ≤ 2.5` |
| `interact` | target.id 非空 | `dist ≤ 2.0` |

动作完成后 `tickAllAIs` 清空 `currentAction`，下一拍重新决策。

### 4.1 ⚠️ 卡死风险（真实缺陷，P0-④ 修复）

`move` / `flee` / `gather` 的完成判定都是「距离足够近」，但宿主 `moveTowards`（`entry.ts:1333`）是**直线冲、无避障**：

```typescript
function moveTowards(e, tx, ty, speed) {
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = (dx / d) * speed;    // 无寻路
  e.vy = (dy / d) * speed;
}
```

**被墙挡住时角色永远到不了目标** → `isActionComplete` 永不 true → `currentAction` 永不清空 → AI 卡在移动态，直到宿主 `_aiMoveTo` 60 秒超时（`entry.ts:1979`）才清除。**每次卡死浪费 60 秒。**

**修复**：ally 循环复用已有的 `navStep()`（`entry.ts:1508`，八向局部避障，注释明确「效果是沿墙绕行而不是原地抖」）。

---

## 5. 错误码与失败处理

| 失败点 | 表现 | 兜底 |
|---|---|---|
| `systemPrompt` 为空 | `runPluginAgent` 返回 `{ok:false, error:"提示词缺失…"}` | 不会发生（插件常量恒定非空） |
| LLM HTTP/网络失败 | `runPluginAgent` 抛错或 `{ok:false}` | `entry.ts` 写 `chatResult{ok:false}` → 前端 `""` → `fallbackDecision` |
| LLM 超 15s | 宿主 `withTimeout` 抛错 | 同上 |
| 前端等超 8s（P0-③ 后） | `waitBrainResult` resolve `{ok:false}` | 同上 |
| LLM 输出非 JSON | regex 匹配失败 → null | `fallbackDecision` |
| JSON 有但无 `action.type` | 同上 → null | `fallbackDecision` |
| `type` 不在枚举内 | `spine` 返回「未知动作」 | **P2 加校验后走 fallback** |
| 动作参数缺失（attack 无 target.id） | `executeAttack` 返回 `{success:false}` | `currentAction` 不设置，下拍重试 |

**核心保证**：从 LLM 输出到动作执行，任何环节失败都能退到 `fallbackDecision`，AI 永不停摆。

---

## 6. 数据流终点：state 变更

| 动作 | 宿主写入 | 后续效果 |
|---|---|---|
| `move` | `ent._aiMoveTo = {x,y}` + `_aiMoveToTick` | ally 循环驱动移动，60s 超时 |
| `attack` | `ent._aiAttackTarget = id` + `_aiAttackTick` | 追击 + 距离内结算伤害 |
| `gather` | `_aiMoveTo` + `_aiGather{zoneName,x,y,reqId,paid}` | 到达打 `_aiGatherArrived` → 前端消费 → 地图集脚本产出 → 进 `_aiBag` |
| `interact` | `ent._aiInteract = {targetId,done}` + `_aiMoveTo` | 到点触发交互事件 |
| `useSkill` | `sk.cdLeft = cd`、`ent.mp -= cost`、伤害结算 | 即时 |
| `useItem` | `ent.hp/mp` 增减 | 即时 |
| `flee` | `ent._aiMoveTo` | 同 move |
| `follow` | `ent._aiMoveTo`（持续刷新玩家坐标） | 前端每拍重发 |
| `wait` | 无（前端 `cooldownUntil` 控制） | 到时自动结束 |

**宿主是 state 的唯一权威**——`spine.ts` 从不直接改 `entity.x/y`（`patchEntityForDevPreview` 只改 `vx/vy` 且会被下一 tick 覆盖）。

---

## 7. 相关文档

- [ai托管.agent.系统提示词.md](./ai托管.agent.系统提示词.md) — 输出格式的规范来源
- [ai托管.agent.传入参数.md](./ai托管.agent.传入参数.md) — input 契约与并发约束
- [ai托管.agent.用户提示词.md](./ai托管.agent.用户提示词.md) — 动态感知结构
- [ai托管.开发计划.plancheck.md](../ai托管.开发计划.plancheck.md) — P0-④ 避障修复的落地步骤