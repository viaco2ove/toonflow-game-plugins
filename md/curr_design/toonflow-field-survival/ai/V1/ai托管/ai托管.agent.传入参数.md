# AI 托管 Agent · 传入参数（input 契约）

> **调用方**：插件 `entry.ts` 的 `case "sys_brain"`
> **接收方**：宿主 `PluginAgentRunner.runPluginAgent()`
> **agentName**：`field-survival-ai-brain`
> **模型配置 key**：`storyMiniGameModel`（复用小游戏模型，无需新增配置项）

---

## 1. 调用链与参数流转

```
前端 brain.ts（构造 prompt）
  → App.vue callBrainLLM(entityName, systemPrompt, userPrompt)
  → sendTick("sys_brain", { reqId, entityName, systemPrompt, userPrompt })
        │  ← 前端 → 宿主的第一段传输（postMessage）
        ↓
宿主 entry.ts case "sys_brain"（待实现，P0-②）
  → ctx.tsApi.agent.run("field-survival-ai-brain", input)
        │  ← 宿主进程内函数调用（toonflowTsApi.agent.run → runPluginAgent）
        ↓
PluginAgentRunner.runPluginAgent(agentName, input)
  → 取 input.systemPrompt（必需）
  → 调 u.ai.text.invoke(model, messages)
        │  messages = [
        │    { role:"system", content: input.systemPrompt },
        │    { role:"user",   content: input.userPrompt }
        │  ]
        ↓
返回 { ok, output: { text }, error }
  → entry.ts 写 s.chatResult = { reqId, ok, text }
  → persistSys → 状态回推
  → 前端 onHostState 读到 state.chatResult → notifyBrainResult(reqId)
        │  ← 宿主 → 前端的第二段传输
        ↓
App.vue waitBrainResult(reqId) 兑现 Promise → brain.ts parseLLMResponse
```

**两个 reqId 机制说明**：
- 前端生成 `reqId = brain_<时间戳>_<随机>`，用于前端 `brainResultWaiters` 配对
- `state.chatResult` 是**单槽位**（后写入覆盖先写入），所以**同一时刻只能有一个 brain 请求在途**
  → 这就是 P0-③ 要求加**全局 brain 并发闸门**的原因（见 §6）

---

## 2. input 字段契约

```typescript
interface AiBrainInput {
  /** 角色名（如"萧肿"）。用于日志与 future 扩展，当前 LLM 不直接消费。 */
  entityName: string;

  /** ★ 必需。系统提示词全文，来自 PROMPT_FIELD_SURVIVAL_AI_BRAIN。 */
  systemPrompt: string;

  /** ★ 必需。动态感知全文，来自前端 buildSystemPrompt() + buildUserPrompt()。 */
  userPrompt: string;
}
```

**校验规则**（`PluginAgentRunner` 已有通用实现）：
```typescript
const systemPrompt = String((input as any)?.systemPrompt || "").trim()
  || (speakerCode ? await getPromptByCode(speakerCode) : "");
if (!systemPrompt) {
  return { ok: false, error: "提示词缺失：插件未通过 input.systemPrompt 提供…" };
}
```

⚠️ **只有 `systemPrompt` 是硬性必需的**，`userPrompt` 没有校验。若 `userPrompt` 为空字符串，LLM 会只收到 system prompt 而做出无依据的决策——**插件侧必须保证 userPrompt 非空**（`brain.ts` 的两个 build 函数即使无数据也会输出"暂无"占位，不会为空）。

---

## 3. 字段详解

### 3.1 `entityName`

| 项 | 说明 |
|---|---|
| 来源 | `entity.name`（`brain.ts` 的 `callBrainLLM(entity.name, ...)`） |
| 用途 | 调试日志、错误信息定位 |
| 空值风险 | 低。实体必有名字（无名实体在前端会被命名为 "NPC"） |

### 3.2 `systemPrompt`

| 项 | 说明 |
|---|---|
| 来源 | `PROMPT_FIELD_SURVIVAL_AI_BRAIN` 常量（`plugins.prompts.ts`） |
| 注入方式 | **必须走 `input.systemPrompt`**，不能注册到宿主 `DEFAULT_PROMPTS` |
| 原因 | `promptHelper.getPromptByCode()` 只查宿主 `def.prompts.ts`；插件提示词不在这条解析链上（2026-10-20 架构决定） |
| token | ~1200（恒定） |

**为什么不让用户在设置页改这份提示词**：它包含输出格式契约（JSON schema + 9 种动作定义），用户改坏了会导致整条链路解析失败。如果确实需要可配置，应该拆成「格式契约（静态，用户不可改）+ 决策偏好（可配置）」两段，后者作为 userPrompt 的一部分传入。

### 3.3 `userPrompt`

| 项 | 说明 |
|---|---|
| 来源 | `brain.ts` 的 `buildSystemPrompt(state, perception)` + `"\n---\n\n"` + `buildUserPrompt(state, perception)` |
| 内容 | 角色设定（名字/等级/性格/地图/HP/MP/背包/技能/位置）+ 当前情况（周围实体/战斗状态/资源/记忆/目标） |
| token | ~600-900（随战况变化） |
| 更新频率 | 每次决策（3~15 秒） |

详见 [ai托管.agent.用户提示词.md](./ai托管.agent.用户提示词.md)。

---

## 4. 前端 → 宿主 的传输参数（sendTick 载荷）

```typescript
sendTick("sys_brain", {
  reqId:        `brain_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  entityName:   entity.name,
  systemPrompt: systemPrompt,   // ~1200 token 的长字符串
  userPrompt:   userPrompt,     // ~900 token 的长字符串
});
```

**注意载荷体积**：`systemPrompt + userPrompt` 合计约 8-10 KB 字符，走 postMessage 每 3~15 秒发一次。虽然 postMessage 是同进程结构化克隆（不走网络），但在多角色场景下（5 个角色 × 每拍）仍值得注意——P2 可考虑只传 `userPrompt`，由宿主侧从常量取 `systemPrompt`（宿主加载的是同一份 `plugins.prompts.ts` 编译产物）。

**优化方案（P2，强烈建议）**：
```typescript
// entry.ts 侧直接 import，不用前端传
case "sys_brain": {
  const reqId = str(params?.reqId, "");
  const entityName = str(params?.entityName, "");
  const userPrompt = str(params?.userPrompt, "");
  // entry.ts 顶部 import { PROMPT_FIELD_SURVIVAL_AI_BRAIN } from "./src/agents/plugins.prompts"
  const systemPrompt = PROMPT_FIELD_SURVIVAL_AI_BRAIN;
  // ...
}
```
这样每帧只传 ~4 KB，且 system prompt 可被模型侧缓存命中。

---

## 5. 超时与重试

| 层 | 超时 | 超时后行为 |
|---|---|---|
| 宿主 `runPluginAgent` | 15s（`AGENT_TIMEOUT_MS`） | 抛错 → `entry.ts` 写 `chatResult{ok:false}` |
| 前端 `waitBrainResult` | 15s（`App.vue:6191`，`timeoutMs=15000`） | resolve `{ok:false, error:"brain LLM 超时"}` |
| `brain.ts callBrain` | 无独立超时 | 收到空串 → `parseLLMResponse` 返回 null → `fallbackDecision` |

**两个 15s 几乎同时到期**，存在竞态：宿主可能刚好在 15.0s 返回，前端已判超时。这种情况下 `notifyBrainResult` 找不到 waiter（已被移除），结果被丢弃——**行为正确**（本来就该走兜底），但会留下一条无主日志。

**改进（P0-③）**：前端超时改 **8s**（早于宿主 15s），确保宿主超时前前端已放弃，不浪费 7 秒挂起时间。

---

## 6. 并发约束（重要）

`state.chatResult` 是**单槽位**，`notifyBrainResult` 按 `reqId` 精确配对。推论：

| 场景 | 后果 |
|---|---|
| 两个 AI 角色**同时**发起 brain 请求 | A 的请求写 chatResult → B 的请求覆盖 → A 的 waiter 15s 超时；B 正常。**A 每次都会超时** |
| 5 个托管角色，idle 间隔 15s | 心跳几乎同步 → 大概率持续互相覆盖 → **大部分角色永远走兜底** |

**这是 P0-③ 的核心约束**：brain 请求必须**全局串行化**。

```typescript
// App.vue 新增
let brainBusy = false;   // 全局闸门：同一时刻只允许一个 brain 请求在途

async function callBrainLLM(entityName, systemPrompt, userPrompt) {
  if (brainBusy) return "";              // 有别人在决策 → 本角色直接走兜底，不发起请求
  brainBusy = true;
  try {
    const reqId = `brain_...`;
    sendTick("sys_brain", { reqId, entityName, systemPrompt, userPrompt });
    const res = await waitBrainResult(reqId, 8000);   // ← 超时 15s → 8s
    return res?.ok ? String(res.text || "") : "";
  } finally {
    brainBusy = false;
  }
}
```

配合 `brain.ts` 的 `cooldownUntil`（失败后冷却），避免单个角色连续占用闸门。

---

## 7. 相关文档

- [ai托管.agent.系统提示词.md](./ai托管.agent.系统提示词.md) — `systemPrompt` 全文与设计依据
- [ai托管.agent.用户提示词.md](./ai托管.agent.用户提示词.md) — `userPrompt` 结构与数据来源
- [ai托管.agent.传出参数.md](./ai托管.agent.传出参数.md) — 输出解析与校验
- [ai托管.运行机制.md](./ai托管.运行机制.md) — `sys_brain` 断链的现状分析