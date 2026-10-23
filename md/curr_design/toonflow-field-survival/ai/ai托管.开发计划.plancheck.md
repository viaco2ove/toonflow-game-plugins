# AI 托管 · 开发计划（plancheck）

> **目标**：让 AI 托管的 LLM 大脑真正上线（当前是纯程序化兜底），并修复两个真实缺陷。
> **现状基线**：见 [ai托管.运行机制.md](ai托管/ai托管.运行机制.md)——感知/执行/紧急反应/#ai 快速通道全部在跑，唯一断点是 `sys_brain` 通道无人接。
> **文档配套**：[agent.系统提示词](ai托管/ai托管.agent.系统提示词.md) / [用户提示词](ai托管/ai托管.agent.用户提示词.md) / [传入参数](ai托管/ai托管.agent.传入参数.md) / [传出参数](ai托管/ai托管.agent.传出参数.md)

---

## 0. 总览：5 个任务

| 阶段 | 任务 | 文件 | 优先级 | 依赖 |
|---|---|---|---|---|
| P0-① | 注册 `PROMPT_FIELD_SURVIVAL_AI_BRAIN` | `plugins/toonflow-field-survival/src/agents/plugins.prompts.ts` | P0 | 无 |
| P0-② | `entry.ts` 加 `case "sys_brain"` | `plugins/toonflow-field-survival/entry.ts` | P0 | ① |
| P0-③ | 前端并发闸门 + 超时 15s→8s | `plugins/toonflow-field-survival/vue/src/App.vue` | P0 | ② |
| P0-④ | ally 移动复用 `navStep` 避障 | `plugins/toonflow-field-survival/entry.ts` | P0 | 无 |
| P2-① | 删除前端 prompt 重复段 | `plugins/toonflow-field-survival/vue/src/ai/brain.ts` | P2 | ① |

**验收方式**：改完 `npm run build` → esbuild 编 `entry.js` → `md5sum` 三方一致 → dev 服务器实际验证 LLM 决策产出。

---

## P0-① 注册 AI 大脑提示词

**文件**：`plugins/toonflow-field-survival/src/agents/plugins.prompts.ts`

**改动**：在文件末尾（`PLUGIN_AGENT_PROMPT_CODES` 之前）追加常量 + 在 `PLUGIN_AGENT_PROMPT_CODES` 和 `pluginAgentPromptCode()` 里加映射。

提示词全文见 [ai托管.agent.系统提示词.md](ai托管/ai托管.agent.系统提示词.md) §2。

**为什么不用宿主 `DEFAULT_PROMPTS`**：`promptHelper.getPromptByCode()` 只查宿主 `def.prompts.ts`，插件的 `plugins.prompts.ts` 不在这条解析链上（2026-10-20 架构：「宿主不持有插件提示词」）。所以必须走 `input.systemPrompt` 传入。

**验收**：
```bash
grep -n "PROMPT_FIELD_SURVIVAL_AI_BRAIN" plugins/toonflow-field-survival/src/agents/plugins.prompts.ts
grep -n "fieldSurvivalAiBrain" plugins/toonflow-field-survival/src/agents/plugins.prompts.ts
```

---

## P0-② entry.ts 加 case "sys_brain"

**文件**：`plugins/toonflow-field-survival/entry.ts`（在 `case "sys_chat"` 之后插入）

**关键点**：
1. `entry.ts:26` 已经 `import { ... } from "./src/agents/plugins.prompts"` → **直接 import `PROMPT_FIELD_SURVIVAL_AI_BRAIN` 用**，不必让前端传（省 1200 token × 每拍）
2. 复用 `str()` / `okResp()` / `persistSys()` 既有工具
3. 结果写 `s.chatResult = { reqId, ok, text, error }`，前端 `notifyBrainResult` 已实现按 reqId 配对唤醒
4. **异常必须写回包**，否则前端永久 pending 到超时

**验收**：`grep -n 'case "sys_brain"' entry.ts` 有输出；esbuild 编译无错。

---

## P0-③ 前端并发闸门 + 超时收短

**文件**：`plugins/toonflow-field-survival/vue/src/App.vue`

**两个改动**：

1. **`waitBrainResult(reqId, timeoutMs = 15000)` → 默认 8000**（`App.vue:6191`）
   - 宿主 `runPluginAgent` 超时是 15s；前端 8s 先放弃，避免 7 秒无效挂起
2. **加全局闸门 `brainBusy`**（`callBrainLLM`，`App.vue:6213`）
   - `state.chatResult` 是**单槽位**，两个 brain 请求并发会互相覆盖 → 一个成功一个必超时
   - 闸门：有别人在决策，本角色直接返回 `""` 走兜底，不发起请求

```typescript
let brainBusy = false;
async function callBrainLLM(entityName, systemPrompt, userPrompt) {
  if (brainBusy) return "";
  brainBusy = true;
  try {
    const reqId = `brain_...`;
    sendTick("sys_brain", { reqId, entityName, systemPrompt, userPrompt });
    const res = await waitBrainResult(reqId);   // 默认 8s
    if (!res?.ok) { console.warn(...); return ""; }
    return String(res.text || "");
  } catch (e) { return ""; }
  finally { brainBusy = false; }
}
```

**验收**：`grep -n "brainBusy" App.vue` 有 3 处（声明 / 检查 / 释放）；`grep -n "timeoutMs = 8000" App.vue`。

---

## P0-④ ally 移动避障（修复卡死）

**文件**：`plugins/toonflow-field-survival/entry.ts`（ally 循环，`entry.ts:2000-2001`）

**问题**：`moveTowards` 直线冲，被 `walkGrid` 墙挡住时 `isActionComplete` 的 `dist < 0.8` 永不满足 → AI 卡 60 秒（`_aiMoveTo` 超时才清）。

**修复**：复用已有的 `navStep()`（`entry.ts:1508`，八向局部避障，注释写明「沿墙绕行而不是原地抖」）+ `navFree()`（`entry.ts:1473`）。

```typescript
// 当前
if (target) moveTowards(a, target.x, target.y, speed * 0.92);
else if (doMove) moveTowards(a, moveX, moveY, speed * 0.8);

// 改为
if (enemyNav) {
  const dst = target ? { x: target.x, y: target.y } : (doMove ? { x: moveX, y: moveY } : null);
  if (dst) {
    const step = speed * 0.8 * (TICK_MS / 1000);
    const p = navStep(enemyNav, a.x, a.y, dst.x - a.x, dst.y - a.y, step, AI_NAV_R);
    a.x = p.x; a.y = p.y;
    if (Math.abs(dst.x - a.x) > 2) a.facing = dst.x > a.x ? 0 : 180;
  }
} else {
  if (target) moveTowards(a, target.x, target.y, speed * 0.92);
  else if (doMove) moveTowards(a, moveX, moveY, speed * 0.8);
}
```

**注意**：
- `enemyNav` 是模块级变量（`entry.ts:1414`），由前端 `applyEnemyNavPayload` 填充；无网格时（切图首拍）退回原直线行为
- 需新增常量 `AI_NAV_R`（ally 碰撞半径，参考 `ENEMY_NAV_R`）
- 同样改 `#ai` 通用应用器（`entry.ts:2012-2017`）那段，让 NPC 也能避障

**验收**：`grep -n "navStep(enemyNav" entry.ts` 有 2 处以上；观察 AI 托管角色不再卡墙。

---

## P2-① 删除前端 prompt 重复段

**文件**：`plugins/toonflow-field-survival/vue/src/ai/brain.ts`

**问题**：`buildUserPrompt()`（`brain.ts:172-223`）末尾的「## 决策要求」和「可用动作类型：move, attack, ...」与新系统提示词重复。

**改动**：删掉这两段，保留 `## 当前情况` 全段 + 输出格式 JSON 示例。

```typescript
// 删除：
//   "## 决策要求\n\n1. **生存优先**...4. **资源管理**..."
//   "可用动作类型：move, attack, gather, interact, useSkill, useItem, flee, wait, follow"
// 保留：
//   "## 输出格式\n\n请以JSON格式输出决策：\n{...}"
```

**收益**：每拍省 ~150 token，且消除两处规则不一致的风险。

---

## 验收清单（全部完成后）

| # | 检查项 | 命令 / 方法 |
|---|---|---|
| 1 | 提示词已注册 | `grep -c "PROMPT_FIELD_SURVIVAL_AI_BRAIN" plugins/toonflow-field-survival/src/agents/plugins.prompts.ts` ≥ 3 |
| 2 | sys_brain case 已加 | `grep -n 'case "sys_brain"' plugins/toonflow-field-survival/entry.ts` |
| 3 | 并发闸门已加 | `grep -c "brainBusy" plugins/toonflow-field-survival/vue/src/App.vue` ≥ 3 |
| 4 | 超时已改 8s | `grep -n "timeoutMs = 8000" plugins/toonflow-field-survival/vue/src/App.vue` |
| 5 | 避障已接 | `grep -c "navStep(enemyNav" plugins/toonflow-field-survival/entry.ts` ≥ 2 |
| 6 | 前端构建通过 | `cd plugins/toonflow-field-survival/vue && npm run build` |
| 7 | entry.js 已重编 | esbuild 编 `entry.js`，无 import / import.meta |
| 8 | 三处 MD5 一致 | workshops 副本 / toonflow-app-run-db / toonflow-game-app 三份 `entry.js` |
| 9 | 端到端 LLM 决策 | dev 服务器勾选 AI托管 → 控制台看 `[ai] <角色>: <type> - <message>` 不再是兜底文案 |

---

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| LLM 决策质量差（幻觉动作多） | `fallbackDecision` 永不停摆；P2-① 后再补 P2 的参数校验（见传出参数文档 §3.2） |
| token 成本（每角色 3-15s 一次 × ~2000 token） | P0-③ 闸门串行化；后续可加失败冷却与角色数上限（≤5） |
| `navStep` 半径不当导致 ally 卡在狭窄处 | `AI_NAV_R` 取与 `ENEMY_NAV_R` 同值先验证，再按需调小 |
| esbuild 编译失败（import 路径） | `plugins.prompts.ts` 已被 `entry.ts:26` 现有 import 引用，加一个常量不改变依赖图 |

---

## 相关文档

- [ai托管.运行机制.md](ai托管/ai托管.运行机制.md) — 三层架构现状与 sys_brain 断链分析
- [ai托管.ai怎么知道可以做什么.md](ai托管/ai托管.ai怎么知道可以做什么.md) — 能力感知 + Capability Manifest
- [ai托管.agent.系统提示词.md](ai托管/ai托管.agent.系统提示词.md) — 提示词全文
- [ai托管.agent.传入参数.md](ai托管/ai托管.agent.传入参数.md) / [传出参数.md](ai托管/ai托管.agent.传出参数.md)