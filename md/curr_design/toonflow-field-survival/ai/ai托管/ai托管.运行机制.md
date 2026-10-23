# AI 托管：运行机制（现状实证 2026-10-23）

> 结论先行：**AI 托管整体架构已落地（感知→决策→执行三层都在跑），但大脑的 LLM 通道（`sys_brain`）是一条"发出去没人接"的死信通道**。
> `plugins.prompts.ts` 里没有 AI 托管 agent 提示词，是因为大脑 prompt **不在这里**——它写死在插件前端 `vue/src/ai/brain.ts` 里，每次决策现场拼接。而它本该走的宿主 agent 通道后端没有对应实现，导致：**LLM 决策实际从未成功过，线上跑的一直是"小脑 + 兜底决策"（纯程序化）**。
> 本文逐层实证，最后给出修复路径。

---

## 0. 为什么 plugins.prompts.ts 里没有 AI 托管提示词

`plugins/prompts`（`src/agents/plugins.prompts.ts`）目前注册了 5 个 agent：

| agent | 提示词常量 | 调用处 | 状态 |
|---|---|---|---|
| field-survival-map-gener | `PROMPT_FIELD_SURVIVAL_MAP_GENER` | entry.ts（开局生成地图） | ✅ 在用 |
| field-survival-shop-gener | `PROMPT_FIELD_SURVIVAL_SHOP_GENER` | entry.ts（商城物资） | ✅ 在用 |
| field-survival-quest-gener | `PROMPT_FIELD_SURVIVAL_QUEST_GENER` | entry.ts（任务板） | ✅ 在用 |
| field-survival-sprite-gener | `PROMPT_FIELD_SURVIVAL_SPRITE_GENER(_SAFE)` | entry.ts（实体形象生图） | ✅ 在用 |
| task-speaker-agent | （复用 def.prompts.ts 的 code） | entry.ts `sys_chat`（NPC 对话） | ✅ 在用 |

**AI 托管的大脑 prompt 不在这张表里**——它在插件前端的 `vue/src/ai/brain.ts` 的 `buildSystemPrompt` / `buildUserPrompt` 里，每次决策现场拼接。设计上它不注册为插件 agent，而是通过 `registerAILLM` 注入一个**调用器函数**（App.vue 的 `callBrainLLM`），走 `sendTick("sys_brain", ...)` 让宿主代为调用 LLM。

**问题就在这**：`sys_brain` 这个 action 在宿主 `entry.ts` 的 `handle_action` 里**没有对应的 case**（43 个 case 里查无此名），mockHost 明确返回「preview 无 AI 托管大脑通道」，唯一"接住"它的地方是前端自己的 `notifyBrainResult`——但那个函数只处理 `chatResult`（`sys_chat` 的回包）。**所以大脑 LLM 调用必然 15 秒超时失败 → 降级兜底**。

## 1. 正确的部分：三层架构都在跑

### 1.1 开关（UI → entry.ts）

```
角色面板 checkbox「AI托管」 (panels/RolePanel.vue:169)
  → App.vue onAiToggle (App.vue:1177)
  → sendTick("ai_command", { roleId, action:"_mark_managed" })  // entry.ts 设 _aiManaged=true
  → 前端 enableAI(entity)  (ai/index.ts)  → AIState.enabled=true, lastBrainTick=0（下一拍立即决策）
```

`#ai 指令`（聊天框临时触发）：`issueAIChatCommand`（chatCommand.ts）→ 不要求勾选托管，临时 `setAIEnabled(true)` → 快速通道（12 组关键词正则）→ LLM 通道 → 兜底。
“ai 指令” 不是“ai 托管”！ ai 脑子瓦特了。有交集但是不是同一个东西。

### 1.2 感知层（每拍实时派生）

`sensor.ts updatePerception()` 收集：

```
self:      HP/MP/等级/攻防/位置/背包（队伍背包+_aiBag 私藏合并）/技能(含CD)/buff
nearby:    13米内 敌/友/NPC（按距离排序）
resources: 26米内可采集 zone（mapKnowledge 从 eventZones + events.json trigger.ai.gather 派生）
world:     当前地图/时间
```

### 1.3 决策层（本应是大脑，实际是兜底）

`brain.ts callBrain()`：
1. 紧急检查（sensor.checkEmergency）：危急血量强制 flee、低血量找药、没蓝等待、被围撤退——**这些不走 LLM，直接覆盖**
2. 心跳/事件触发判断
3. 构建 systemPrompt + userPrompt（硬编码模板）→ `callLLM` → **走 sys_brain 通道（死信，见 §2）**
4. 失败 → `fallbackDecision`：有敌人打最近敌人 → 有资源去最近资源 → 否则等待

### 1.4 执行层（脊椎，工作正常）

`spine.ts executeAction` → `sendTick("ai_command", {...})` → 宿主 entry.ts `case "ai_command"`：
- `move` → 写 `ent._aiMoveTo`，宿主 ally 循环驱动移动
- `attack` → 写 `ent._aiAttackTarget`，宿主结算攻击
- `gather` → 写 `_aiMoveTo` + `_aiGather`，到达后宿主打 `_aiGatherArrived` 标记 → 前端 `consumeGatherArrivals` 按 reqId 去重消费 → `triggerZoneGather` → 地图集事件脚本产出（进 `_aiBag`）
- `interact` → 写 `_aiInteract` + 走向目标
- `useSkill` / `useItem` → 宿主查技能表扣蓝/上 CD/结算
- `stop` / `stopMove` / `_mark_managed` → 状态清理

这部分是**权威且正常**的：位置/战斗/采集全由宿主（entry.ts）持有和结算，前端只发命令。

## 2. 断裂的部分：大脑 LLM 通道（sys_brain）死信

### 2.1 完整链路（发出去之后的每一步）

```
brain.ts callLLM
  → App.vue callBrainLLM: sendTick("sys_brain", { reqId, entityName, systemPrompt, userPrompt })
  → 宿主收到 tf_plugin_tick（action=sys_brain）……
      ├─ dev/preview（mockHost.ts:1024）：明确回 {ok:false, error:"preview 无 AI 托管大脑通道"} ✓ 有明确失败
      ├─ 安装后真机（entry.ts handle_action）：43 个 case 无 sys_brain → 落到外层 default，不产生任何回包 ✗ 静默失败
      └─ vite dev-host（vite.config.ts）：actions 白名单里有 "sys_brain"（说明本打算支持），但没有任何实现分支 ✗
  → 前端 waitBrainResult(reqId) 15 秒超时 → { ok:false, error:"brain LLM 超时" }
  → callBrainLLM 返回 "" → parseLLMResponse 失败 → fallbackDecision
```

**唯一缺失的环节**：`sys_brain` 没有被翻译成一次真正的 LLM 调用。宿主收到后不产生任何回包，前端等满 15 秒才放弃。

### 2.2 参照系：sys_chat 是成熟范式

NPC 对话（`sys_chat`）走的是完整可用的通道：

```
entry.ts case "sys_chat"
  → context.tsApi.agent.run("task-speaker-agent", {...})        ← toonflowTsApi.agent.run
  → 后端 PluginAgentRunner（按 agentName 找 prompt code → 配模型 → 真实调 LLM）
  → 结果写 s.chatResult{reqId, ok, text}
  → persistSys → 状态回推
  → 前端 onHostState 读到 state.chatResult → notifyChatResult/notifyBrainResult → 唤醒等待者
```

这条链路的每一环都是现成的，AI 托管大脑完全可以复用。

### 2.3 缺的两块

**① 宿主侧没有把 sys_brain 接到 agent 通道**（entry.ts 缺 case）。这解释了为什么 `plugins.prompts.ts` 里没有 AI 托管提示词——**注册表和调用方是配套的**：调用方（entry.ts 的 agent.run）不存在，注册表里自然不会有人去填 AI 托管条目。你的直觉"压根就没有 AI 托管的 agent 提示词"是对的，只是因果方向和猜测相反：不是提示词漏写了，而是调用链这一环先断了。

**② prompt 分工需要明确**。当前大脑 prompt（角色设定/性格/实时感知/地图知识）全在前端 `brain.ts` 现场拼接，这是合理的——感知数据每拍都在变，不适合放进静态注册表。但修复后仍需一个 agent prompt 来承担**输出格式契约**（选一个动作、type 从枚举里选、参数必须在清单中真实存在）。分工应为：

```
前端 brain.ts（动态）   → 角色设定 + 性格 + 本图知识 + 实时感知 + 决策要求
后端 ai-brain-agent（静态）→ 输出格式约束 + 参数合法性规则 + 通用决策原则
两者拼接后送给 LLM
```

这与既有 5 个 agent 的模式一致（它们是纯静态，因为输入是完全结构化的动态数据、由 entry.ts 在调用时组装好传进去）。

### 2.4 现在的"AI 托管"实际行为

由于 LLM 从未成功，线上行为是：

| 场景 | 实际行为 | 来源 |
|---|---|---|
| 平时 | 有敌人→攻击最近；无敌人有资源→去最近资源；都没有→等待 | brain.ts fallbackDecision |
| 血量 <15% | 强制撤退 | sensor.checkEmergency（不走 LLM） |
| 血量 <30% 且有药 | 用药 | sensor.checkEmergency |
| `#ai 帮我去收集木材` | 关键词正则命中 → 直接出动作（不走 LLM） | chatCommand.ts KEYWORD_RULES |
| `#ai 说句别的话` | 关键词不中 → LLM（超时 15s）→ 兜底 | chatCommand.ts → brain.callBrain |
| 托管多角色 | 每个独立感知/决策（无协调） | tickAllAIs 逐个循环 |

**也就是说：目前用户看到的"AI 托管"，本质是「规则引擎 + 兜底策略」，不是 LLM 决策。** 能跑、不穿帮，但 `personality`（性格）、记忆、复杂任务规划这些 LLM 才能带来的差异全部无效——它们只存在于从未被消费的 prompt 里。

## 3. 各文件职责一览（实证标注）

| 文件 | 职责 | 状态 |
|---|---|---|
| `vue/src/ai/types.ts` | AIActionType 9 种动作、AIState、感知结构 | ✅ |
| `vue/src/ai/sensor.ts` | 感知 + 紧急检查（程序化，直接覆盖决策） | ✅ 在跑 |
| `vue/src/ai/brain.ts` | 大脑：prompt 构建 + LLM 调用 + 兜底决策 | ⚠️ LLM 通道死信 |
| `vue/src/ai/spine.ts` | 执行：翻译成 ai_command 发宿主 | ✅ 在跑 |
| `vue/src/ai/mapKnowledge.ts` | 从 eventZones + events.json 派生本图采集/交互知识 | ✅ 在跑 |
| `vue/src/ai/chatCommand.ts` | #ai 指令：关键词快速通道 + LLM + 兜底 | ✅ 快速通道在跑 |
| `vue/src/ai/index.ts` | 主循环 tickAllAIs（动作完成检查、决策调度、采集消费） | ✅ 在跑 |
| `entry.ts` case "ai_command" | 宿主权威执行（move/attack/gather/interact/useSkill/useItem/stop） | ✅ 在跑 |
| `entry.ts` case "sys_chat" | NPC 对话 agent 通道（成功范式） | ✅ 在跑 |
| `entry.ts` case "sys_brain" | **不存在** | ❌ 缺失 |
| `src/agents/plugins.prompts.ts` | 5 个插件 agent 提示词注册表 | ⚠️ 无 ai-brain 条目 |
| 宿主 `PluginAgentRunner` + `toonflowTsApi.agent.run` | 插件 agent 执行器（配模型、真实调 LLM） | ✅ 成熟可用 |
| `mockHost.ts` | preview 宿主：sys_brain 明确回失败 | ⚠️ 预览不可用 |

## 4. 修复路径（让 LLM 大脑真正上线）

### P0：打通 sys_brain（两处改动，复用 sys_chat 范式）

**① `plugins.prompts.ts` 注册 `ai-brain-agent`**（静态部分：输出格式契约）

```typescript
export const PROMPT_FIELD_SURVIVAL_AI_BRAIN = `你是【野外生存】小游戏的 AI 角色托管大脑。

## 职责
根据输入的角色设定、实时感知、记忆与当前目标，选择**一个**可执行动作并输出 JSON。

## 输入说明
- entityName：角色名
- systemPrompt：角色设定 + 本图知识 + 背包/技能清单（前端实时拼接，直接采信）
- userPrompt：当前情况 + 可用动作清单 + 决策要求（前端实时拼接，直接采信）

## 输出要求（严格遵守）
只输出一个 JSON 对象，不要解释、不要 markdown 代码块：
{
  "reasoning": "决策理由（20字内）",
  "goal": "当前目标",
  "action": {
    "type": "move|attack|gather|interact|useSkill|useItem|flee|wait|follow",
    "target": {"id": "...", "x": 0, "y": 0, "name": "..."},
    "skillName": "技能名（useSkill 必填）",
    "itemName": "物品名（useItem 必填）",
    "zoneName": "区域名（gather 必填）",
    "context": "执行原因"
  }
}

## 决策规则
1. type 必须从枚举中选；useSkill/useItem/gather 的参数名必须在输入清单中真实存在
2. HP<30% 优先治疗或撤退；背包将满优先处理物品；有明确目标时保持专注
3. 无合适动作时输出 {"type":"wait","context":"待命"}`;
```

配套：`PLUGIN_AGENT_PROMPT_CODES` 加 `fieldSurvivalAiBrain: "plugin-field-survival-ai-brain"`、`pluginAgentPromptCode()` 加映射、宿主 `def.prompts.ts` 的 `DEFAULT_PROMPTS` 注册同 code（设置页可查/可改，customValue 优先）。

**② `entry.ts` 加 `case "sys_brain"`**（约 30 行，对照 sys_chat）

```typescript
case "sys_brain": {
  // ★ AI 托管大脑：把前端拼好的 prompt 交给 LLM，结果写 chatResult 按 reqId 配对
  const reqId = str(params?.reqId, "");
  const entityName = str(params?.entityName, "???");
  const systemPrompt = str(params?.systemPrompt, "");
  const userPrompt = str(params?.userPrompt, "");
  try {
    if (context?.tsApi?.agent) {
      const result = await context.tsApi.agent.run("ai-brain-agent", {
        entityName, systemPrompt, userPrompt,
      });
      const raw = result?.ok && result?.output?.text
        ? String(result.output.text).replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/\s*```\s*$/, "").trim()
        : "";
      s.chatResult = raw
        ? { reqId, ok: true, text: raw }
        : { reqId, ok: false, error: String(result?.error || "empty response") };
      await persistSys(context, s);
      return okResp(raw ? "brain ok" : JSON.stringify({ error: result?.error }));
    }
  } catch (e) {
    s.chatResult = { reqId, ok: false, error: String((e as any)?.message || e) };
    await persistSys(context, s);
    return okResp(JSON.stringify({ error: "brain agent exception" }));
  }
  s.chatResult = { reqId, ok: false, error: "ai-brain agent 不可用" };
  await persistSys(context, s);
  return okResp(JSON.stringify({ error: "agent unavailable" }));
}
```

**③ 前端超时收短**：`waitBrainResult` 15s → 8s。15 秒等待会卡住整个决策节奏（tickAllAIs 是同步遍历），超时即兜底，别让一个角色的大脑停摆拖累其他角色。

### P1：预览模式可用

mockHost 的 sys_brain 分支改为调 `window.top.__agentRun_impl("field-survival-ai-brain", ...)`（dev-host 已有 agent 通道，shop/quest 已在用），preview 里 `#ai` 和托管决策就能真实出 LLM 结果。

### P2：决策节奏与成本控制

- **失败冷却**：LLM 失败后冷却 30s 再试。现在每次心跳都会重试 → 每个角色每 3~15s 白烧一次 15s 超时，多角色并发时会把请求队列打满
- 并发上限：同时托管 ≤5 角色（设计文档既定，代码未见强制，需补）
- 心跳自适应已有（combat 3s / idle 15s），保留

### P3：能力清单（Capability Manifest）

见 [ai托管.ai怎么知道可以做什么.md](./ai托管.ai怎么知道可以做什么.md) —— LLM 通道打通后，下一步是把"LLM 看到的能力"与"宿主真实支持的能力"对齐，避免 LLM 喊出不存在的技能/动作。

## 5. 一句话总结

> **AI 托管现在是「骨架健全、大脑断线」**：感知、执行、紧急反应、#ai 快速通道全部真实在跑（都工作正常），但 LLM 决策通道（sys_brain）从设计上指向一个不存在的宿主分支——所以当前的"智能"全是程序化兜底，性格/记忆/规划从未生效。
>
> 修复只需两处：`plugins.prompts.ts` 注册 `ai-brain-agent` + `entry.ts` 加 `case "sys_brain"`，完全复用 sys_chat 的成熟通道，LLM 大脑即可上线。

## 6. 相关文档

- [ai托管.ai怎么知道可以做什么.md](./ai托管.ai怎么知道可以做什么.md) — 能力感知机制 + Capability Manifest 设计
- [ally 类型角色的ai 托管能力.md](../ally%20类型角色的ai%20托管能力.md) — 托管能力整体设计（触发时机、prompt 设计）
- [ai托管.插件.行为list.md](./ai托管.插件.行为list.md) — 插件行为清单