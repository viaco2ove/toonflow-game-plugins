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

import type { AIGameEvent, AIState, AIAction } from "./types";
import type { Entity, GameState } from "../types";
import { getOrCreateAIState, setAIEnabled, isAIEnabled, removeAIState, callBrain, notifyAIEvent, getAllAIStates, getAIStateSnapshot, setLLMCaller, pushAIEvent } from "./brain";
import { executeAction, isActionComplete } from "./spine";

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
  pushAIEvent(entityId, event);
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

  // ★ 消费宿主的采集到达标记 → 触发地图集事件脚本（产出权威在 events/scripts/*.ts）
  void consumeGatherArrivals(state);

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


/**
 * ★ 消费宿主打在实体上的采集到达标记（entry.js resolveAIGather 写入）。
 * 标记不自删（实体字段由宿主权威持有），故按 reqId 去重：
 * 同一 reqId 的标记被重复推送时不会二次触发采集。
 * 产出走 mapKnowledge.triggerZoneGather → 事件引擎 fireEventManually → 地图集脚本。
 */
const consumedGatherReqIds = new Set<string>();

async function consumeGatherArrivals(state: GameState): Promise<void> {
  const { triggerZoneGather } = await import("./mapKnowledge");
  for (const e of state.entities || []) {
    const arr = (e as any)._aiGatherArrived as { zoneName?: string; reqId?: string } | undefined;
    if (!arr) continue;
    const reqId = String(arr.reqId || "");
    if (reqId && consumedGatherReqIds.has(reqId)) continue; // 已消费过（宿主重复推送）
    if (reqId) {
      consumedGatherReqIds.add(reqId);
      // 防止集合无限增长：只保留最近 200 个
      if (consumedGatherReqIds.size > 200) {
        const it = consumedGatherReqIds.values();
        for (let i = 0; i < 100; i++) {
          const v = it.next().value;
          if (v !== undefined) consumedGatherReqIds.delete(v);
        }
      }
    }
    const zone = String(arr.zoneName || "");
    const ok = await triggerZoneGather(zone);
    console.info(`[ai] ${e.name} 采集到达 ${zone || "(未知区域)"} → ${ok ? "已触发地图集脚本" : "该 zone 无采集事件"}`);
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