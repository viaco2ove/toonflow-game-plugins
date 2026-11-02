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

import type { AIGameEvent, AIState, AIAction, LLMDecision } from "./types";
import type { Entity, GameState } from "../types";
import { getOrCreateAIState, setAIEnabled, isAIEnabled, removeAIState, callBrain, callBrainDetailed, evaluateBrainTrigger, notifyAIEvent, getAllAIStates, getAIStateSnapshot, setLLMCaller, pushAIEvent } from "./brain";
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
// ★ 通信(短信)：短信意图分发（放在 sms/dispatch.ts 以避开与 chatCommand 的循环依赖）
import {
  dispatchSmsDecision,
  hasPendingReply,
  getPendingReplyTarget,
  clearPendingReply,
} from "../sms/dispatch";
import { listPendingReplyRoleIds, listConversations as listSmsConversations } from "../sms/store";
import { registerProactiveWake } from "../sms/proactivePoller";
import { toonflowJsApi } from "../toonflowJsApi";

/** ★ 短信回复链路诊断（宿主 /plugin/data op=get dataKey=brain_diag 可读）：
 *  5175 下 iframe 跨域 → console 抓不到，只能靠插件数据通道暴露阶段。 */
async function diagSms(stage: string, extra?: Record<string, unknown>): Promise<void> {
  try {
    await toonflowJsApi.pluginData.set("brain_diag", { stage, ...(extra || {}), at: Date.now() });
  } catch {
    /* ignore */
  }
}

/** ★ 正在补回短信的角色（防重入：心跳每 tick 都扫，不能反复发起同一角色的 LLM 调用） */
const brainReplyInflight = new Set<string>();
/** ★ 角色首次进入待补回扫描的时间（3s 内不重复发起，给首次直连调用让路） */
const brainReplyFirstSeen = new Map<string, number>();

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

  // ★ 通信(短信)心跳兜底：发短信那一刻角色不在场/闸门被占 → 保留待回复登记。
  //   这里每 tick 扫一遍登记表，角色可见（在场上/角色卡/地图配置）就补回一次；
  //   都找不到也**不放弃**——用会话名构造幽灵实体纯短信回复（玩家点名必回）。
  //   被动回复不需要托管（allowUnmanaged），每角色防重入，发完清登记。
  //   ★ 防抖 30s：首次直连调用（wakeAiForPlayerSms）deadline 是 25s，
  //     兜底必须等它彻底放弃后才接管，否则两个并发抢 chatResult 单槽位互相覆盖。
  try {
    const now = Date.now();
    for (const roleId of listPendingReplyRoleIds()) {
      if (brainReplyInflight.has(roleId)) continue;      // 首次/上次还在飞 → 不插手
      const first = brainReplyFirstSeen.get(roleId) || 0;
      if (now - first < 30_000) continue;                // 30s 防抖（见上注释）
      let entity = findEntityById(state, roleId);
      if (!entity) {
        const target = getPendingReplyTarget(roleId);
        const conv = target
          ? listSmsConversations().find((c) => c.id === target.convId)
          : undefined;
        const ghostName = conv?.type === "private" ? conv.name : roleId;
        if (!ghostName) continue;
        entity = {
          id: roleId,
          name: ghostName,
          side: "neutral",
          x: 0, y: 0, hp: 50, maxHp: 50, mp: 30, maxMp: 30,
          level: 1, atk: 10, def: 5, alive: true,
          mapName: "__sms_ghost__",
        } as any;
      }
      brainReplyFirstSeen.set(roleId, now);
      brainReplyInflight.add(roleId);
      void replyToPlayerSms(entity, state).finally(() => {
        brainReplyInflight.delete(roleId);
        brainReplyFirstSeen.delete(roleId);
      });
    }
  } catch (e) {
    console.warn("[sms] 心跳兜底扫描异常:", e);
  }

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
      // ★ 通信(短信)：先分发短信（与动作执行解耦 —— 短信失败不影响动作）
      dispatchSmsDecision(decision, entity);
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


/* ============================================================
   ★ 通信(短信)：玩家发消息 → 唤醒 AI
   ============================================================ */

/**
 * ★ 玩家发短信 → 立即唤醒目标 AI（P0，不等心跳间隔）
 *
 * 设计文档 §6.2 ②：
 *   玩家发消息后，AI 最长要等 20s 心跳才看到 —— 不可接受。
 *   这里走独立通道直接发起一次 LLM 调用（keepAction 模式，不打断角色当前动作）。
 *
 * ★ 为什么不用调度器的 P0 队列：
 *   调度器有预算/熔断/单槽位限制，且战斗态会筛掉"离玩家远"的角色 ——
 *   玩家刚发的消息如果正好被筛掉，就要再等 20s。这里走独立调用更符合直觉。
 *   代价是可能与调度器抢闸门（chatResult 单槽位）→ 抢不到就重试。
 *
 * @param convId   玩家发消息的会话ID
 * @param text     消息正文
 * @param state    当前游戏状态
 */
export async function wakeAiForPlayerSms(
  convId: string,
  text: string,
  state: GameState,
): Promise<void> {
  // 找到这个会话里的 AI 成员
  const { listConversations } = await import("../sms/store");
  const conv = listConversations().find((c) => c.id === convId);
  if (!conv) return;

  const members = conv.members.filter((m) => m !== "player");
  if (!members.length) return;

  for (const roleId of members) {
    // ① 记进 AI 记忆（prompt 里能看到"收到玩家短信"这个事件）
    notifyAIEvent(roleId, "dialog", `收到玩家短信：${text}`);

    // ★ 未托管角色也能回复短信（产品语义：被动应答不需要托管，托管只管主动决策）。
    let entity = findEntityById(state, roleId);
    if (!entity) {
      // ★ 会话存档里的角色（如陈南璇是另一张图上的地图 NPC mapnpc_163，
      //   当前图 cfg.npcs 里没有）—— 但**会话名就是角色名**：
      //   构造「幽灵实体」继续回复（只用于拼 prompt，不参与移动/战斗）。
      //   产品语义：玩家点名必回，找不到实体不是拒绝回复的理由。
      const ghostName = conv.type === "private" ? conv.name : roleId;
      console.info(`[sms] 角色 ${roleId}（${ghostName}）不在场，用幽灵实体回复（纯短信，不做动作）`);
      entity = {
        id: roleId,
        name: ghostName,
        side: "neutral",
        x: 0,
        y: 0,
        hp: 50,
        maxHp: 50,
        mp: 30,
        maxMp: 30,
        level: 1,
        atk: 10,
        def: 5,
        alive: true,
        mapName: "__sms_ghost__", // ★ 标记：buildUserPrompt 会声明「不在场，忽略环境数据」
      } as any;
    }

    // ② 已托管 → 置 P0，让调度器也知道（未托管角色没有 aiState.enabled，跳过这步）
    if (isAIEnabled(roleId)) {
      const aiState = getOrCreateAIState(entity);
      aiState.pendingTriggerReason = `收到玩家短信：${text.slice(0, 30)}`;
      aiState.pendingTriggerPriority = "P0";
    }
    // ③ 立刻同步发起一次短信回复（不等下一个 tick 的心跳判定）——
    //    replyToPlayerSms 内部用 allowUnmanaged 调 LLM，托管与否都能回。
    //    ★ 登记 inflight：避免心跳兜底在首次调用还在飞的时候插进来抢闸门
    //      （chatResult 是单槽位，两个并发必然互相覆盖 → 首次被判 "gate" 白重试）。
    void diagSms("wake_start", { roleId, entityName: entity.name, ghost: entity.mapName === "__sms_ghost__" });
    brainReplyInflight.add(roleId);
    void replyToPlayerSms(entity, state).finally(() => {
      brainReplyInflight.delete(roleId);
      brainReplyFirstSeen.delete(roleId);
    });
  }
}

/**
 * ★ P3 事件推送（2026-11-01，网络通信机制 v2 §4）：后端「唤醒事件」→ AI 主动发短信
 *
 * 与 wakeAiForPlayerSms（被动回复）的区别：
 *   - 被动回复：玩家发了消息在等 → prompt 里有"待回复消息"，AI 必须回；
 *   - 主动唤醒：后端判定"该角色到了主动说话的时间"（编排器/定时器 push 的
 *     wake_sms 事件）→ 无待回复登记，AI 自由决策——想说话就发 message，
 *     不想说就静默（dispatchSmsDecision 对无 message 的决策天然安全）。
 *
 * AI 状态（性格/记忆/感知）全在插件前端（v2 §4 方案 A，不迁移后端）——
 * 后端事件只是"该动了"的提示，决策质量与既有托管链路完全同源。
 */
export async function wakeAiForProactiveSms(
  roleId: string,
  state: GameState,
  hint?: string,
): Promise<void> {
  if (brainReplyInflight.has(roleId)) return; // 该角色已有短信决策在飞 → 不叠加

  // 构造决策实体：优先在场实体；不在场用幽灵（与被动回复同规则——地图 NPC 也能主动发）
  let entity = findEntityById(state, roleId);
  if (!entity) {
    const conv = listSmsConversations().find(
      (c) => c.type === "private" && c.members.includes(roleId),
    );
    const ghostName = conv?.name || roleId;
    if (!ghostName) return;
    entity = {
      id: roleId,
      name: ghostName,
      side: "neutral",
      x: 0, y: 0, hp: 50, maxHp: 50, mp: 30, maxMp: 30,
      level: 1, atk: 10, def: 5, alive: true,
      mapName: "__sms_ghost__",
    } as any;
  }

  // ★ 主动消息语境：写进记忆（会进入 prompt 的「角色记忆」块）。
  //   hint 来自事件的 payload（编排器可带场景提示，如"刚进地图打个招呼"）；
  //   没有 hint 给通用语境。明确告诉 LLM「这次决策的重点是短信意图」，
  //   否则输出格式契约里 message 是可选项，LLM 会倾向省略（实测 3 次 silent）。
  const hintLine = hint ? `场景提示：${hint}` : "若你恰好有想告诉玩家的事（见闻/提醒/关心），就用 message 发一条短信；实在没有就保持安静。";
  notifyAIEvent(roleId, "dialog", `（系统）系统提示你现在可以主动联系玩家。${hintLine}如果要发，把内容写进输出的 message 字段。`);

  void diagSms("p3_proactive_start", { roleId, entityName: entity.name });
  brainReplyInflight.add(roleId);
  try {
    const { decision, gotLLM } = await callBrainDetailed(entity, state, {
      keepAction: true,
      allowUnmanaged: true, // 主动消息也不要求托管（与被动回复同语义）
      proactiveSms: true,   // ★ P3：把 message 提升为本次决策的主要产出
    });
    if (gotLLM && decision) {
      const sent = dispatchSmsDecision(decision, entity);
      void diagSms(sent ? "p3_proactive_sent" : "p3_proactive_silent", {
        entity: entity.name, hasMsg: !!decision.message,
        reasoning: decision.reasoning,
      });
      // ★ 只消费短信意图，不执行动作：幽灵实体不在场，executeAction 无意义；
      //   在场实体的动作决策留给既有 tick 调度器（避免双通道抢动作）。
    } else {
      void diagSms("p3_proactive_no_llm", { entity: entity.name });
    }
  } finally {
    brainReplyInflight.delete(roleId);
  }
}

/** ★ 把 P3 唤醒处理函数接到轮询器（模块加载即生效；App.vue 只需启停轮询器） */
registerProactiveWake(wakeAiForProactiveSms);

/**
 * ★ 立即为玩家的一条短信发起一次 LLM 决策（只取 message，不动动作）
 */
async function replyToPlayerSms(entity: Entity, state: GameState): Promise<void> {
  const deadline = Date.now() + 25_000;
  // 闸门被占 → 稍后重试（最多等到 deadline）
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    void diagSms("reply_attempt", { attempt, entity: entity.name });
    try {
      const { decision, gotLLM, failReason } = await callBrainDetailed(entity, state, {
        keepAction: true,
        allowUnmanaged: true, // ★ 被动回复不需要托管（产品语义）
      });
      if (!decision) {
        // 拿不到决策（不在场等）→ 清登记，等下一次心跳兜底
        void diagSms("no_decision", { attempt, entity: entity.name });
        clearPendingReply(entity.id);
        return;
      }
      // ★ 没拿到 LLM 响应 → 不发短信，也不清登记
      if (!gotLLM) {
        void diagSms("no_llm:" + String(failReason || "unknown"), {
          attempt,
          entity: entity.name,
          emergency: JSON.stringify(getOrCreateAIState(entity).emergency || {}),
          hp: entity.hp, maxHp: entity.maxHp, mp: entity.mp, maxMp: entity.maxMp,
          ghost: (entity as any).mapName === "__sms_ghost__",
        });
        // 紧急层接管 → 别重试（重试也没用，紧急层优先）
        if (failReason === "emergency") {
          console.info(`[sms] ${entity.name} 处于紧急状态，本轮不回复短信`);
          return;
        }
        // 闸门被占 → 等一会儿重试（这是最常见的情况，值得等）
        if (failReason === "gate") {
          console.info(`[sms] ${entity.name} 未拿到 LLM 响应（闸门/超时），稍后重试`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        // 解析失败 → 再试一次；但也不能无限试（次数上限）
        if (failReason === "parse") {
          console.warn(`[sms] ${entity.name} LLM 响应解析失败（尝试 ${attempt} 次）`);
          if (attempt >= 3) return;
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return;
      }
      const sent = dispatchSmsDecision(decision, entity);
      void diagSms(sent ? "replied" : "dispatch_no", { entity: entity.name, hasMsg: !!decision.message });
      if (sent) return;
      // 拿到了 LLM 响应但没有 message → AI 这次不想回
      //   → 保留待回复登记，等下一次心跳兜底（玩家那条 ★ 还在 prompt 里）
      if (!decision.message) {
        console.info(`[sms] ${entity.name} 未生成回复内容，保留待回复登记待下次心跳`);
        return;
      }
      // 有 message 但被冷却挡了 → 清登记，避免死循环
      clearPendingReply(entity.id);
      return;
    } catch (e) {
      console.warn("[sms] 短信回复失败:", e);
      break;
    }
  }
  console.info(`[sms] 等待 ${entity.name} 回复超时（尝试 ${attempt} 次），留待下一次心跳`);
}

/**
 * ★ 地图 NPC 解析器（App.vue 注册）：id → { name, level, hp, maxHp } | null。
 * 短信场景：玩家可以给「不在玩家 50m 内」的地图 NPC 发短信（通讯录来自 entities，
 * 会话存档里的 members 是 mapnpc_*；切图/距离过远后实体被清掉）——
 * 回复链路必须还能把 mapnpc_<id> 还原成实体，否则 findEntityById 返回 null → 静默不回。
 */
let mapNpcResolver: ((id: string) => { name?: string; level?: number; hp?: number; maxHp?: number } | null) | null = null;

export function registerMapNpcResolver(fn: NonNullable<typeof mapNpcResolver>): void {
  mapNpcResolver = fn;
}

/** 从 state 里找实体（entities → npcCards → 地图 NPC 配置表） */
function findEntityById(state: GameState, id: string): Entity | null {
  const ents = (state?.entities || []) as Entity[];
  let hit = ents.find((e) => e.id === id) || null;
  if (hit) return hit;
  // 场外的托管角色 → 从 npcCards 补一个临时实体
  const cards = ((state as any)?.npcCards || []) as any[];
  const card = cards.find((c) => String(c?.id) === id);
  if (card) {
    hit = {
      id: card.id,
      name: card.name,
      side: "ally",
      x: 0,
      y: 0,
      hp: card.hp || 50,
      maxHp: card.maxHp || 50,
      mp: card.mp || 30,
      maxMp: card.maxMp || 30,
      level: card.level || 1,
      atk: 10,
      def: 5,
      alive: true,
      mapName: card.mapName || (state as any).levelName || "",
    } as any;
    return hit;
  }
  // ★ 地图 NPC（mapnpc_*）：不在场/不在角色卡 → 从地图配置表还原（被动短信回复专用，
  //   只用于拼 prompt，不参与移动/战斗）。
  if (mapNpcResolver) {
    try {
      const npc = mapNpcResolver(id);
      if (npc) {
        return {
          id,
          name: npc.name || id,
          side: "neutral",
          x: 0,
          y: 0,
          hp: npc.hp || 50,
          maxHp: npc.maxHp || 50,
          mp: 30,
          maxMp: 30,
          level: npc.level || 1,
          atk: 10,
          def: 5,
          alive: true,
          mapName: (state as any).levelName || "",
        } as any;
      }
    } catch (e) {
      console.warn("[sms] 地图 NPC 解析失败:", id, e);
    }
  }
  return null;
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

// ★ 通信(短信)：对外暴露短信分发入口（App.vue 消费 decision.message 用）
export { dispatchSmsDecision };

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