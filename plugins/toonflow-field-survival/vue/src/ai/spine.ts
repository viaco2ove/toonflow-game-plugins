/**
 * ai/spine.ts — AI 脊椎层（动作执行 v0.3）
 * =====================================
 * 通过 ai_command 通道让 entry.js 真正执行：
 * - sendTick("ai_command", { roleId, action: "move", x, y })
 * - sendTick("ai_command", { roleId, action: "attack", targetId })
 *
 * entry.js 收到后改 state 里的实体位置/目标，状态回推让前端看到角色动
 *
 * v0.3 关键变化：spine 不再直接改 state（会被服务端覆盖），
 * 只发命令。entry.js 才是 state 的唯一权威。
 */

import type { AIAction, AIState, Entity, GameState } from "../types";
import { getOrCreateAIState } from "./brain";
import { sendTick } from "../bridge";

/** 动作执行结果 */
export interface ActionResult {
  success: boolean;
  message: string;
  nextAction?: AIAction;
}

/** 当前 AI 决策的 entityId → action 缓存（用于 tick 之间追踪） */
const pendingCommands: Map<string, { action: AIAction; sentAt: number }> = new Map();

/** 通过 sendTick 桥发 ai_command */
function sendAICommand(roleId: string, params: Record<string, unknown>): void {
  try {
    // ★ 走 sendTick 通道 → 宿主（dev-host 顶层 / 真实宿主 60002）
    //   宿主收到后调 entry.js handle_action("ai_command", { roleId, ...params }, state, ctx)
    //   entry.js 的 case "ai_command" 会改 state.ally._aiMoveTo / _aiAttackTarget
    //   状态回推让前端看到角色动
    sendTick("ai_command", { roleId, ...params });
  } catch (e) {
    console.warn("[ai] sendAICommand 失败：", e);
  }
}

/** 写一个本地预览 entity（仅用于 dev-host 调试显示，不持久） */
function patchEntityForDevPreview(entity: Entity, state: GameState, action: AIAction): void {
  // 尝试在 state.entities 中找 entity 真实副本（dev-host 模式下 entry.js 回推会覆盖，
  // 但在两次回推之间前端 entity 是镜像，能短暂看到动作）
  if (!state || !state.entities) return;
  const real = state.entities.find((e) => e.id === entity.id);
  if (real) {
    if (action.type === "move" && action.target) {
      // 不动 x/y（会被覆盖），仅显示 vx/vy 让动画有反馈
      const dx = action.target.x - real.x;
      const dy = action.target.y - real.y;
      const d = Math.hypot(dx, dy) || 1;
      real.vx = (dx / d) * 0.5;
      real.vy = (dy / d) * 0.5;
    } else if (action.type === "attack" && action.target?.id) {
      const tgt = state.entities.find((e) => e.id === action.target?.id);
      if (tgt) {
        const dx = tgt.x - real.x;
        const dy = tgt.y - real.y;
        const d = Math.hypot(dx, dy) || 1;
        real.vx = (dx / d) * 0.3;
        real.vy = (dy / d) * 0.3;
      }
    }
  }
}

/** 执行移动（通过 ai_command 通道发命令） */
export function executeMove(entity: Entity, action: AIAction, state: GameState): ActionResult {
  if (!action.target || action.target.x === undefined || action.target.y === undefined) {
    return { success: false, message: "移动目标无效" };
  }
  // ★ 关键：通过 ai_command 通道让 entry.js 改真实 state
  sendAICommand(entity.id, {
    action: "move",
    x: action.target.x,
    y: action.target.y,
  });
  // dev-host 调试用：短暂反馈（会被下一 tick state 覆盖）
  patchEntityForDevPreview(entity, state, action);
  return {
    success: true,
    message: `→ (${action.target.x.toFixed(1)}, ${action.target.y.toFixed(1)})`,
  };
}

/** 执行攻击（通过 ai_command 通道） */
export function executeAttack(entity: Entity, action: AIAction, state: GameState): ActionResult {
  if (!action.target?.id) {
    return { success: false, message: "攻击目标无效" };
  }
  // 检查目标是否还存在
  const target = (state.entities || []).find((e) => e.id === action.target?.id);
  if (!target) {
    // 目标已不在场 → 清除 AI 攻击目标
    sendAICommand(entity.id, { action: "stop" });
    return { success: true, message: `目标已离开视野` };
  }
  if (target.alive === false) {
    sendAICommand(entity.id, { action: "stop" });
    return { success: true, message: `目标已死亡` };
  }
  // 通过 ai_command 通道：entry.js 会处理追击 + 攻击判定
  sendAICommand(entity.id, {
    action: "attack",
    targetId: action.target.id,
  });
  patchEntityForDevPreview(entity, state, action);
  const dist = Math.hypot(target.x - entity.x, target.y - entity.y);
  return {
    success: true,
    message: `攻击 ${target.name} (${dist.toFixed(1)}米)`,
  };
}

/** 采集区半径内视为「到达并可开采」（zone 的 rx/ry 单位是格≈米） */
const GATHER_ARRIVE_M = 1.2;
/** 跟随玩家时保持的距离（米） */
const FOLLOW_GAP_M = 2.5;
/** 与 NPC 交互的到达距离（米） */
const INTERACT_M = 2;

/** 执行采集：走到 zone，到达后由前端触发地图集事件脚本产出 */
export function executeGather(entity: Entity, action: AIAction, state: GameState): ActionResult {
  if (!action.zoneName && !action.target) {
    return { success: false, message: "采集区域无效" };
  }
  const tx = action.target?.x ?? 0;
  const ty = action.target?.y ?? 0;
  // ★ reqId 去重：宿主到达后写 _aiGatherArrived 标记且不自删（实体字段被宿主权威持有），
  //   前端按 reqId 消费，重复推送同一标记不会重复触发采集。
  const reqId = `g_${entity.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  // 一次命令同时表达「走到哪」+「采什么」：宿主负责移动 + 到达打标记，
  // 产出（掉什么/给多少）由前端 mapKnowledge.triggerZoneGather → 地图集脚本决定。
  sendAICommand(entity.id, {
    action: "gather",
    x: tx,
    y: ty,
    zoneName: action.zoneName || action.target?.name || "",
    reqId,
  });
  patchEntityForDevPreview(entity, state, action);
  return {
    success: true,
    message: `采集中 → ${action.zoneName} (${tx.toFixed(1)}, ${ty.toFixed(1)})`,
  };
}

/** 执行技能：走 useSkill 通道，由宿主查技能表扣蓝/放 CD/结算伤害 */
export function executeSkill(entity: Entity, action: AIAction, state: GameState): ActionResult {
  if (!action.skillName) {
    return { success: false, message: "技能名无效" };
  }
  sendAICommand(entity.id, {
    action: "useSkill",
    skillName: action.skillName,
    targetId: action.target?.id,
  });
  return { success: true, message: `施放 ${action.skillName}` };
}

/** 执行交互（与 NPC 对话）：走 interact 通道，宿主到点后触发对话事件 */
export function executeInteract(entity: Entity, action: AIAction, state: GameState): ActionResult {
  const tid = action.target?.id;
  if (!tid) return { success: false, message: "交互目标无效" };
  sendAICommand(entity.id, {
    action: "interact",
    targetId: tid,
  });
  return { success: true, message: `与 ${action.target?.name || tid} 交互` };
}

/** 找玩家实体（跟随目标） */
function findPlayer(state: GameState): Entity | null {
  return (state.entities || []).find((e) => e.side === "player") || null;
}

/** 执行跟随：持续把移动目标刷新到玩家身后（宿主每次决策都会重新下发） */
export function executeFollow(entity: Entity, action: AIAction, state: GameState): ActionResult {
  const player = findPlayer(state);
  if (!player) {
    // 玩家不在场（切图/死亡）→ 停下等待
    sendAICommand(entity.id, { action: "stopMove" });
    return { success: false, message: "玩家不在场，跟随暂停" };
  }
  const d = Math.hypot(player.x - entity.x, player.y - entity.y);
  if (d <= FOLLOW_GAP_M) {
    // 已到位，清掉移动目标避免抖动
    sendAICommand(entity.id, { action: "stopMove" });
    return { success: true, message: `已跟随（距玩家 ${d.toFixed(1)}米）` };
  }
  sendAICommand(entity.id, {
    action: "move",
    x: player.x,
    y: player.y,
  });
  patchEntityForDevPreview(entity, state, {
    ...action,
    type: "move",
    target: { x: player.x, y: player.y, name: player.name },
  });
  return { success: true, message: `跟随 ${player.name}（${d.toFixed(1)}米）` };
}

/** 读取物品真实回复值（优先按名称精确/模糊匹配背包） */
function lookupItemHeal(itemName: string, state: GameState): { heal: number; mp: number; found: boolean } {
  const items = (state.items || []) as any[];
  const key = itemName.trim();
  const hit =
    items.find((it) => it?.name === key) ||
    items.find((it) => typeof it?.name === "string" && (it.name.includes(key) || key.includes(it.name)));
  if (!hit) return { heal: 0, mp: 0, found: false };
  return {
    heal: Number(hit.heal) || 0,
    mp: Number(hit.mp) || 0,
    found: true,
  };
}

/** 执行物品：读真实 heal/mp 值下发，不再硬编码 30 */
export function executeItem(entity: Entity, action: AIAction, state: GameState): ActionResult {
  if (!action.itemName) {
    return { success: false, message: "物品名无效" };
  }
  const { heal, mp, found } = lookupItemHeal(action.itemName, state);
  if (!found) {
    return { success: false, message: `背包里没有 ${action.itemName}` };
  }
  sendAICommand(entity.id, {
    action: "useItem",
    itemName: action.itemName,
    heal,
    mp,
  });
  const parts: string[] = [];
  if (heal > 0) parts.push(`+${heal}HP`);
  if (mp > 0) parts.push(`+${mp}MP`);
  return { success: true, message: `使用 ${action.itemName}${parts.length ? "（" + parts.join(" ") + "）" : ""}` };
}

/** 执行撤退 */
export function executeFlee(entity: Entity, state: GameState): ActionResult {
  const me = entity;
  const enemies = (state.entities || []).filter((e) => e.side === "enemy" && e.alive !== false);
  if (!enemies.length) {
    return { success: false, message: "无敌人，无需撤退" };
  }
  // 远离敌人合力方向
  let awayX = 0, awayY = 0;
  for (const e of enemies) {
    const dx = me.x - e.x;
    const dy = me.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    awayX += dx / d;
    awayY += dy / d;
  }
  const norm = Math.hypot(awayX, awayY) || 1;
  const targetX = me.x + (awayX / norm) * 8;
  const targetY = me.y + (awayY / norm) * 8;
  // 边界保护
  sendAICommand(entity.id, { action: "move", x: targetX, y: targetY });
  return {
    success: true,
    message: `撤退到 (${targetX.toFixed(1)}, ${targetY.toFixed(1)})`,
  };
}

/** 执行等待 */
export function executeWait(action: AIAction): ActionResult {
  return { success: true, message: `待命` };
}

/** ★ 主编排 */
export function executeAction(
  entity: Entity,
  action: AIAction,
  state: GameState,
): ActionResult {
  // 记录当前命令（用于 tick 之间追踪）
  pendingCommands.set(entity.id, { action, sentAt: Date.now() });
  switch (action.type) {
    case "move":
      return executeMove(entity, action, state);
    case "attack":
      return executeAttack(entity, action, state);
    case "gather":
      return executeGather(entity, action, state);
    case "interact":
      return executeInteract(entity, action, state);
    case "useSkill":
      return executeSkill(entity, action, state);
    case "useItem":
      return executeItem(entity, action, state);
    case "flee":
      return executeFlee(entity, state);
    case "wait":
      return executeWait(action);
    case "follow":
      return executeFollow(entity, action, state);
    default:
      return { success: false, message: `未知动作: ${action.type}` };
  }
}

/** 判断当前动作是否完成 */
export function isActionComplete(entity: Entity, state: GameState, action: AIAction | null): boolean {
  if (!action) return true;

  if (action.type === "wait") {
    const state2 = getOrCreateAIState(entity);
    return Date.now() >= state2.cooldownUntil;
  }

  if (action.type === "gather") {
    // 采集完成 = 走到 zone 内（到达即由宿主结算产出）
    if (action.target?.x === undefined || action.target?.y === undefined) return true;
    const dist = Math.hypot(action.target.x - entity.x, action.target.y - entity.y);
    return dist <= GATHER_ARRIVE_M;
  }

  if (action.type === "follow") {
    // 跟随是持续行为：到位也算「完成」，让大脑下一拍重新决定去留
    const player = (state.entities || []).find((e) => e.side === "player");
    if (!player) return true;
    return Math.hypot(player.x - entity.x, player.y - entity.y) <= FOLLOW_GAP_M;
  }

  if (action.type === "interact") {
    if (!action.target?.id) return true;
    const t = (state.entities || []).find((e) => e.id === action.target?.id);
    if (!t || t.alive === false) return true;
    // 走到 NPC 身边即可完成交互（宿主在同一 tick 结算对话）
    return Math.hypot(t.x - entity.x, t.y - entity.y) <= INTERACT_M;
  }

  if (action.type === "useSkill" || action.type === "useItem") {
    // 瞬发动作：发一次即完成
    return true;
  }

  if (action.type === "move" || action.type === "flee") {
    if (action.target?.x === undefined || action.target?.y === undefined) return true;
    const dist = Math.hypot(action.target.x - entity.x, action.target.y - entity.y);
    return dist < 0.8;  // 0.8米内视为到达
  }

  if (action.type === "attack") {
    if (!action.target?.id) return true;
    const target = (state.entities || []).find((e) => e.id === action.target?.id);
    if (!target || target.alive === false) return true;
    return false; // 攻击中
  }

  return true;
}

/** 获取 AI 角色当前状态摘要（用于调试） */
export function getActionSummary(entity: Entity): string {
  const state = getOrCreateAIState(entity);
  if (!state.enabled) return "未托管";
  if (!state.currentAction) return "待决策";
  return `${state.currentAction.type}: ${state.currentAction.context}`;
}