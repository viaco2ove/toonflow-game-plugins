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
import { getOrCreateAIState, setAIEnabled, isAIEnabled, removeAIState, callBrain, evaluateBrainTrigger, notifyAIEvent, getAllAIStates, getAIStateSnapshot, setLLMCaller, pushAIEvent } from "./brain";
import { executeAction, isActionComplete } from "./spine";
import {
  BRAIN_BUDGET,
  enqueueBrainTask,
  pickCombatRoles,
  pumpBrainScheduler,
  requeueBrainTask,
  removeBrainTask,
} from "./scheduler";
import { setCurrentCombatLevel } from "./mapInterval";

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
  // ★ v6：同时清掉该角色在调度器队列里的待办任务，避免关掉后还在排队
  removeBrainTask(entityId);
  // 不立即删除，保留状态以便重新启用
}

/** 移除 AI 状态（实体消失时） */
export function cleanupAI(entityId: string): void {
  removeAIState(entityId);
  removeBrainTask(entityId);
}

/** 推入 AI 事件（外部通知） */
export function emitAIEvent(entityId: string, event: AIGameEvent): void {
  pushAIEvent(entityId, event);
}

/** 外部通知战斗/系统事件 */
export function notifyAICombat(entityId: string, description: string, data?: Record<string, unknown>): void {
  notifyAIEvent(entityId, "combat", description, data);
}

/**
 * ★ v6：切图后广播 new_map 事件给所有托管角色（App.vue afterMapSwitchForEvents 调用）
 *
 * 理由：切图后 AI 的全部感知都失效了 —— 资源点来自 mapKnowledge（读 events.json），
 * 地图知识摘要也换了。不通知的话，AI 会拿着上一张图的信息对新图做决策，
 * 出现「跑去一个本图不存在的采集点」这类穿帮。
 *
 * P1 优先级：可打断 move/wait/follow，但不打断 attack/gather（正在打的架不打断）。
 */
export function broadcastAINewMap(mapFile: string): void {
  const allStates = getAllAIStates();
  let n = 0;
  for (const [eid, st] of allStates.entries()) {
    if (!isAIEnabled(eid)) continue;
    // 更新角色所在地图（mapInterval 覆盖按 mapName 查）
    st.mapName = mapFile;
    pushAIEvent(eid, {
      type: "new_map",
      priority: "P1",
      data: { map: mapFile },
      timestamp: Date.now(),
    });
    n += 1;
  }
  if (n > 0) console.info(`[ai] 切图广播 new_map → ${n} 个托管角色（${mapFile}）`);
}

/**
 * ★ v6：通用事件广播（事件引擎的 `ai_trigger` 动作调用）
 *
 * 这是「地图集可以精确地在剧情节点上戳一下 AI」的落点：
 *   { "type": "ai_trigger", "priority": "P0", "reason": "伏击战开始" }
 *
 * @param priority 插队强度（P0 无条件 / P1 可打断移动类 / P2 不打断）
 * @param reason 触发原因（写进 AI 记忆，LLM 能看到）
 * @param target 可选：只唤醒指定角色（角色 id 或 "ally:名字"）；缺省 = 所有托管角色
 */
export function broadcastAIEvent(
  priority: "P0" | "P1" | "P2",
  reason: string,
  target?: string,
): void {
  const allStates = getAllAIStates();
  let n = 0;
  for (const [eid, st] of allStates.entries()) {
    if (!isAIEnabled(eid)) continue;
    if (target && !matchAITarget(eid, st.characterName, target)) continue;
    pushAIEvent(eid, {
      type: "player_command",
      priority,
      data: { reason, source: "map_event" },
      timestamp: Date.now(),
    });
    n += 1;
  }
  if (n > 0) {
    console.info(`[ai] 地图集 ai_trigger → ${n} 个托管角色（P${priority[1]}）：${reason}`);
  }
}

/** target 匹配：支持角色 id、"ally:名字"、纯名字 */
function matchAITarget(entityId: string, characterName: string, target: string): boolean {
  const t = String(target || "").trim();
  if (!t) return true;
  if (t === entityId) return true;
  if (t.startsWith("ally:")) return characterName === t.slice(5).trim();
  return characterName === t;
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

  // ★ v6：把宿主权威的玩家战斗状态同步给地图集覆盖模块（用于钳制与选档）
  const pc = (state as any).playerCombat;
  setCurrentCombatLevel(
    pc?.level === "engaged" || pc?.level === "skirmish" ? pc.level : "none",
  );

  // ★ v6：玩家战斗状态跃迁（边沿触发）→ 向所有托管角色派发 AI 事件
  //   只在「等级变化的那一刻」派发，不是战斗中每 tick 都派。
  //   none→skirmish(P1) / skirmish→engaged(P0) / engaged→skirmish(P2)
  const transition = (pc as any)?.combatTransition;
  if (transition) {
    const { from, to } = transition;
    let prio: "P0" | "P1" | "P2" | null = null;
    if (to === "engaged") prio = "P0";            // 开打：立即决策
    else if (from === "none" && to === "skirmish") prio = "P1";  // 敌人靠近：战前准备
    else if (to === "skirmish") prio = "P2";       // 脱离接触：收尾
    if (prio) {
      const allStates = getAllAIStates();
      for (const eid of allStates.keys()) {
        if (!isAIEnabled(eid)) continue;
        pushAIEvent(eid, {
          type: "enemy_spotted",
          priority: prio,
          data: { from, to, combatLevel: to },
          timestamp: Date.now(),
        });
      }
      console.info(`[ai] 玩家战斗状态跃迁: ${from} → ${to}（P${prio[1]}，广播给托管角色）`);
    }
    // 消费一次后清空，避免每 tick 重复派发
    if (pc) pc.combatTransition = undefined;
  }

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

  // ★ v6：收集候选托管角色（供调度器做战斗态「最近 N 个」筛选）
  const managed = candidates.filter((e) => isAIEnabled(e.id));

  for (const entity of candidates) {
    if (!isAIEnabled(entity.id)) continue;

    const aiState = getOrCreateAIState(entity);

    // 检查当前动作是否完成
    if (aiState.currentAction && isActionComplete(entity, state, aiState.currentAction)) {
      aiState.currentAction = null;
    }

    if (!aiState.currentAction) {
      // ★ v6 阶段一：评估「该不该思考」（纯本地，不烧 token）
      const trigger = evaluateBrainTrigger(entity, state);

      if (trigger.emergency) {
        // 紧急层：直接执行，不排队、不烧 LLM、不受预算/熔断限制
        aiState.mode = "emergency";
        aiState.currentAction = trigger.emergency;
        try {
          executeAction(entity, trigger.emergency, state);
        } catch (e) {
          console.warn("[ai] 紧急动作执行异常:", e);
        }
        continue;
      }

      if (trigger.should) {
        // ★ 入队（不立即发起）—— 由 pumpBrainScheduler 逐个发起，避免 chatResult 单槽位冲突
        enqueueBrainTask(entity.id, entity.name, trigger.priority, trigger.reason);
      }
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

  // ★ v6 阶段二：调度器泵（每 tick 最多发起一个 LLM 请求）
  //   战斗态只让「离玩家最近」的少数角色进 LLM 队列（其余靠 emergency/兜底/后续心跳）。
  const combatLevel = (state as any).playerCombat?.level || "none";
  const player = (state.entities || []).find((e) => e.side === "player");
  let llmAllowed: Set<string> | null = null;
  if (combatLevel !== "none" && player && managed.length > BRAIN_BUDGET.combatLLMRoles) {
    llmAllowed = pickCombatRoles(
      managed.map((e) => ({ id: e.id, name: e.name, x: e.x, y: e.y })),
      player.x,
      player.y,
      BRAIN_BUDGET.combatLLMRoles,
    );
  }

  pumpBrainScheduler(managed.length, async (task) => {
    // 战斗态筛选：不在「最近 N 个」里的角色，本次不出 LLM（退回队列等待下一轮）
    if (llmAllowed && !llmAllowed.has(task.entityId)) {
      requeueBrainTask(task);
      return;
    }
    const entity = candidates.find((e) => e.id === task.entityId);
    if (!entity) return;
    const aiState = getOrCreateAIState(entity);
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
  });
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
    // ★ 传 actor：脚本内 confirm 自动通过、bag.give 落进该角色的 _aiBag
    const ok = await triggerZoneGather(zone, { roleId: e.id, name: e.name });
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