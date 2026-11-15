/**
 * ai/dynamic.ts —— 行为链「留空 = 执行时 AI 动态生成」（2026-11-15，用户需求）
 * ==============================================================
 * 用户在行为链里写「发短信」但不写内容 → 执行到这一步时，AI 按**当前上下文**
 * （角色身份/性格、玩家战况、最近的短信往来、行为链已完成的历史与当前计划）现场生成内容。
 *
 * 三种动作的动态内容：
 *   - sendSms   → 短信正文
 *   - sayLine   → 台词
 *   - updateCard→ 角色卡字段（关键信息/当前任务/其他）
 *
 * 复用 brain.ts 的 LLM 桥（setLLMCaller 注入的 llmCaller）——
 * 与单步决策、计划生成同一条通道（宿主 sys_brain → agent.run → chatResult 回传）。
 */
import type { AIAction, AIState, Entity, GameState } from "../types";
import { getPlan, getHistory } from "./plan";

/** LLM 调用桥（brain.ts 注入）——这里单独持有引用，避免与 brain 形成循环依赖 */
let dynamicLlmCaller: ((entityName: string, systemPrompt: string, userPrompt: string) => Promise<string>) | null = null;
export function setDynamicLlmCaller(fn: typeof dynamicLlmCaller): void {
  dynamicLlmCaller = fn;
}

/** 从 AI 记忆里取最近的短信/对话上下文（behavior 视角的"最近聊了什么"） */
function recentChatContext(st: AIState | undefined): string {
  try {
    const mem = st?.memory || [];
    const chat = mem.filter((m) => m.type === "dialog" || m.type === "system").slice(-3);
    if (!chat.length) return "- （暂无近期对话记录）";
    return chat.map((m) => `- ${m.description}`).join("\n");
  } catch {
    return "- （上下文不可用）";
  }
}

/** 行为链上下文：已完成的历史 + 当前计划剩余步骤 */
function chainContext(st: AIState | undefined): string {
  if (!st) return "- （无行为链记录）";
  const hist = getHistory(st).slice(0, 5);
  const plan = getPlan(st).filter((p) => p.status !== "done");
  const h = hist.length ? hist.map((x) => `- [${x.result}] ${x.note}`).join("\n") : "- （无）";
  const p = plan.length ? plan.map((x, i) => `${i + 1}. ${x.note}（${x.action.type}）`).join("\n") : "- （无）";
  return `### 已做的事（最近 5 条）\n${h}\n\n### 计划中剩余步骤\n${p}`;
}

/** 玩家战况摘要 */
function worldContext(state: GameState): string {
  const s = state as any;
  const pc = s?.playerCombat;
  const level = pc?.level || "none";
  const txt = level === "engaged" ? "交战中" : level === "skirmish" ? "遭遇战" : "未在战斗";
  const enemies = (s?.entities || []).filter((e: any) => e.side === "enemy" && e.alive !== false).length;
  return `- 玩家战况：${txt}（附近敌人 ${enemies} 只）`;
}

const DYNAMIC_SYSTEM = `你是一个游戏角色行为链的执行助手。
用户只给了动作类型（如「发短信」「发台词」「更新角色卡」），**没有给内容**。
你要根据该角色的身份、性格、当前处境、最近的对话与行为链进展，**现场生成**符合角色的内容。

要求：
- 内容要像该角色会说的/会记的（符合性格与身份，不要模板腔）
- 只输出 JSON 对象，不要解释、不要代码块围栏
- 短信/台词控制在 60 字以内；角色卡字段控制在 40 字以内`;

/**
 * 动态生成动作内容。
 * @returns 填充好内容的 action（失败返回原 action，由调用方按失败处理）
 */
export async function generateDynamicContent(
  entity: Entity,
  action: AIAction,
  state: GameState,
  st?: AIState,
): Promise<AIAction> {
  if (!dynamicLlmCaller) {
    console.warn("[ai-dynamic] LLM 桥未注册，跳过动态生成");
    return action;
  }
  let need = "";
  let schema = "";
  if (action.type === "sendSms") {
    need = "生成一条**短信正文**（角色要发给玩家的消息）";
    schema = `{"smsText": "短信正文"}`;
  } else if (action.type === "sayLine") {
    need = "生成该角色在故事里说的一句**台词**（当众开口说的话）";
    schema = `{"lineText": "台词"}`;
  } else if (action.type === "updateCard") {
    need = "生成要写进角色卡的**关键信息**（该角色这轮经历中值得记住的事）";
    schema = `{"role_key_information": "关键信息", "executing_task": "该角色当前在做的事（可空）"}`;
  } else {
    return action;
  }

  const userPrompt = `## 你的身份
- 名字：${entity.name}
- 等级：Lv.${(entity as any).level ?? "?"}
- 性格：${st?.personality || "普通"}

## 当前处境
${worldContext(state)}

## 最近的对话往来
${recentChatContext(st)}

${chainContext(st)}

## 本次任务
${need}

## 输出格式
${schema}`;

  try {
    const raw = await dynamicLlmCaller(entity.name, DYNAMIC_SYSTEM, userPrompt);
    if (!raw) return action;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return action;
    let obj: any;
    try { obj = JSON.parse(jsonMatch[0]); } catch { return action; }
    const next: AIAction = { ...action };
    if (action.type === "sendSms" && typeof obj.smsText === "string" && obj.smsText.trim()) {
      next.smsText = obj.smsText.trim().slice(0, 200);
    }
    if (action.type === "sayLine" && typeof obj.lineText === "string" && obj.lineText.trim()) {
      next.lineText = obj.lineText.trim().slice(0, 200);
    }
    if (action.type === "updateCard" && obj && typeof obj === "object") {
      const cf: Record<string, string> = {};
      for (const k of ["role_key_information", "executing_task", "other"]) {
        if (typeof obj[k] === "string" && obj[k].trim()) cf[k] = obj[k].trim().slice(0, 200);
      }
      if (Object.keys(cf).length) next.cardFields = cf;
    }
    next.dynamic = false;
    return next;
  } catch (e) {
    console.warn("[ai-dynamic] 生成失败:", e);
    return action;
  }
}