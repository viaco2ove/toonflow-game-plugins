/**
 * ai/index.ts — AI 托管系统主入口
 * ==================================
 * 对外 API：
 * - enableAI(entityId, personality): 启用 AI
 * - disableAI(entityId): 关闭 AI
 * - tickAI(state, currentTick): 每 tick 调用
 * - registerAILLM(fn): 注册 LLM 调用实现
 *
 * 内部模块：
 * - types.ts: 类型定义
 * - sensor.ts: 感知系统
 * - brain.ts: 大脑层
 * - spine.ts: 脊椎层
 */

import type { AIGameEvent, AIState, AIAction, AIPerception } from "./types";
import type { Entity, GameState } from "../types";
import { getOrCreateAIState, setAIEnabled, isAIEnabled, removeAIState, callBrain, notifyAIEvent, getAllAIStates, getAIStateSnapshot, setLLMCaller } from "./brain";
import { executeAction, isActionComplete } from "./spine";
import { updatePerception, checkEmergency } from "./sensor";

/** 启动 AI 托管（对外 API） */
export function enableAI(entity: Entity, personality: string = "勇敢冲锋型"): boolean {
  // ★ 先创建 state（确保后续操作的对象已存在）
  const s = getOrCreateAIState(entity);
  s.characterName = entity.name || "";
  s.characterLevel = entity.level || 1;
  s.mapName = (entity as any).mapName || "";
  s.personality = personality;
  // ★ 关键：lastBrainTick=0 + 短间隔，让下一次 tick 立即决策
  s.lastBrainTick = 0;
  s.brainInterval = 3000;  // 首次启用用 3 秒间隔
  s.cooldownUntil = 0;
  // ★ 立即设置 enabled
  setAIEnabled(entity.id, true, personality);
  console.info(`[ai] ✅ 启用 AI 托管: ${entity.name} (${entity.id})`, { level: entity.level, hp: entity.hp, mp: entity.mp });
  return true;
}

/** 停止 AI 托管 */
export function disableAI(entityId: string): void {
  setAIEnabled(entityId, false);
  // 不立即删除，保留状态以便重新启用
}

/** 移除 AI 状态（实体消失时） */
export function cleanupAI(entityId: string): void {
  removeAIState(entityId);
}

/** 推入 AI 事件（外部通知） */
export function emitAIEvent(entityId: string, event: AIGameEvent): void {
  if (isAIEnabled(entityId)) {
    const list = (require("./brain") as any).pendingEvents as Map<string, AIGameEvent[]>;
    if (list) {
      const l = list.get(entityId) || [];
      l.push(event);
      list.set(entityId, l);
    }
  }
}

/** 简化的 emitAIEvent（避免运行时 require） */
export function emitAIEventSimple(entityId: string, event: Omit<AIGameEvent, "timestamp">): void {
  if (!isAIEnabled(entityId)) return;
  // 直接调用 brain 内部的事件队列
  import("./brain").then((mod) => {
    mod.pushAIEvent(entityId, { ...event, timestamp: Date.now() });
  });
}

/** 外部通知战斗/系统事件 */
export function notifyAICombat(entityId: string, description: string, data?: Record<string, unknown>): void {
  notifyAIEvent(entityId, "combat", description, data);
}

export function notifyAILoot(entityId: string, description: string, data?: Record<string, unknown>): void {
  notifyAIEvent(entityId, "loot", description, data);
}

/** 注册 LLM 调用器（由 App.vue 在 init 时调用） */
export function registerAILLM(
  fn: (entityName: string, systemPrompt: string, userPrompt: string) => Promise<string>,
): void {
  setLLMCaller(fn);
}

/** ★ 主循环入口：每 tick 由 App.vue 调用（同步版本，fire-and-forget LLM 调用） */
export function tickAllAIs(state: GameState, currentTick: number): void {
  if (!state) return;

  // 收集所有候选实体（在场的 ally + npcCards 中已托管的）
  const candidates: import("../types").Entity[] = [];
  for (const e of (state.entities || [])) {
    if (e.side === "ally" && e.alive !== false) candidates.push(e);
  }
  // 补上 npcCards 中已托管但未上场的（enableAI 时创建的临时实体）
  const allStates = getAllAIStates();
  for (const [eid, _ast] of allStates.entries()) {
    if (!isAIEnabled(eid)) continue;
    if (candidates.some(c => c.id === eid)) continue;  // 已在场
    // 在 npcCards 里找
    const npcCards = ((state as any).npcCards || []) as any[];
    const card = npcCards.find((c: any) => String(c?.id) === eid);
    if (card) {
      candidates.push({
        id: card.id,
        name: card.name,
        side: "ally",
        x: 0, y: 0,
        hp: card.hp || 50, maxHp: card.maxHp || 50,
        mp: card.mp || 30, maxMp: card.maxMp || 30,
        level: card.level || 1,
        atk: 10, def: 5,
        alive: true,
        mapName: card.mapName || (state as any).levelName || "",
      } as any);
    }
  }

  for (const entity of candidates) {
    if (!isAIEnabled(entity.id)) continue;

    const aiState = getOrCreateAIState(entity);

    // 检查当前动作是否完成
    if (aiState.currentAction && isActionComplete(entity, state, aiState.currentAction)) {
      aiState.currentAction = null;
    }

    // 决策（v0.2 异步：尝试 LLM，失败降级到兜底）
    if (!aiState.currentAction) {
      // 发起异步决策（不阻塞 tick）
      void (async () => {
        try {
          const decision = await callBrain(entity, state);
          if (decision) {
            const result = executeAction(entity, decision.action, state);
            console.info(`[ai] ${entity.name}(${entity.id}): ${decision.action.type} - ${result.message}`);
            if (result.success) {
              const cd = decision.action.type === "wait" ? 2000 : 500;
              aiState.cooldownUntil = Date.now() + cd;
              aiState.currentAction = decision.action;
            }
          }
        } catch (e) {
          console.warn("[ai] brain 决策异常:", e);
        }
      })();
    } else {
      // ★ 当前动作未完成：继续执行
      try {
        const result = executeAction(entity, aiState.currentAction, state);
        if (aiState.currentAction.type === "attack" || aiState.currentAction.type === "move" || aiState.currentAction.type === "gather" || aiState.currentAction.type === "flee") {
          // 高频动作：每 tick 都输出
          // console.info(`[ai] ${entity.name}: ${aiState.currentAction.type} - ${result.message}`);
        }
        // 检查完成
        if (isActionComplete(entity, state, aiState.currentAction)) {
          console.info(`[ai] ${entity.name}: ${aiState.currentAction.type} 完成`);
          aiState.currentAction = null;
          aiState.gatherStartedAt = undefined;
        }
      } catch (e) {
        console.warn("[ai] continue action 异常:", e);
      }
    }
  }
}

/** 同步大脑决策：直接走兜底策略（无 LLM 调用） */
function syncBrain(entity: Entity, state: GameState): import("./types").LLMDecision | null {
  const aiState = getOrCreateAIState(entity);
  if (!aiState.enabled) return null;

  // 1. 紧急检查（覆盖）
  const perception: AIPerception = updatePerception(entity, state);
  const emergency = checkEmergency(entity, perception);
  aiState.emergency = emergency.flags;
  if (emergency.shouldOverride && emergency.action) {
    aiState.goal = "紧急响应";
    return { reasoning: "紧急响应", goal: aiState.goal, action: emergency.action };
  }

  // 2. 检查心跳间隔
  const now = Date.now();
  const interval = Math.max(3000, aiState.brainInterval);
  if (now - aiState.lastBrainTick < interval) return null;
  if (now < aiState.cooldownUntil) return null;

  // 3. 同步决策（兜底）
  aiState.lastBrainTick = now;
  const decision = fallbackDecisionSync(perception);
  aiState.goal = decision.goal;
  return decision;
}

function fallbackDecisionSync(perception: import("./types").AIPerception): import("./types").LLMDecision {
  if (perception.nearby.enemies.length > 0) {
    const e = perception.nearby.enemies[0];
    return {
      reasoning: "兜底：攻击最近敌人",
      goal: "战斗",
      action: {
        type: "attack",
        target: { id: e.id, x: e.position.x, y: e.position.y, name: e.name },
        priority: 60,
        context: `攻击 ${e.name}`,
      },
    };
  }
  if (perception.resources.length > 0) {
    const r = perception.resources[0];
    return {
      reasoning: "兜底：前往最近资源",
      goal: "采集",
      action: {
        type: "gather",
        target: { x: r.position.x, y: r.position.y, name: r.zoneName },
        zoneName: r.zoneName,
        priority: 50,
        context: `前往 ${r.zoneName}`,
      },
    };
  }
  return {
    reasoning: "兜底：待命",
    goal: "待命",
    action: { type: "wait", duration: 3000, priority: 30, context: "待命" },
  };
}

/** 同步版本（无 LLM 调用，仅程序化行为） */
export function tickSyncAIs(state: GameState, _currentTick: number): void {
  if (!state || !state.entities) return;

  for (const entity of state.entities) {
    if (entity.side !== "ally" || !entity.alive) continue;
    if (!isAIEnabled(entity.id)) continue;
    // 同步部分：仅更新状态标记，不做 LLM 调用
  }
}

/** 调试：获取所有 AI 状态 */
export function debugGetAllAI(): Map<string, AIState> {
  return getAllAIStates();
}

/** 调试：获取单个 AI 状态 */
export function debugGetAI(entityId: string): AIState | null {
  return getAIStateSnapshot(entityId);
}

// 重新导出核心 API
export { isAIEnabled, getOrCreateAIState };
export type { AIState, AIAction, AIGameEvent };

// ★ 聊天指令 #ai：无论是否勾选 AI 托管，让对话角色做一次 AI 决策并执行
export { issueAIChatCommand } from "./chatCommand";
export type { AIChatOutcome } from "./chatCommand";

/** 占位符：实际 LLM 调用器（由 App.vue 替换） */
const defaultLLMCaller = async (
  entityName: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> => {
  // ★ 默认实现：返回空字符串，brain.ts 会走兜底策略
  //   App.vue 在初始化时应调用 registerAILLM 替换为真实实现
  console.info(`[ai] 默认LLM调用 (${entityName}) - 等待真实实现注册`);
  return "";
};

// 自动注册默认 LLM（无操作）
registerAILLM(defaultLLMCaller);