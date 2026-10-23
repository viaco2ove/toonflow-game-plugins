/**
 * ai/scheduler.ts — AI 大脑调度器
 * ============================================
 * 解决的问题：多个托管角色同拍发起 LLM 请求 → `state.chatResult` 是**单槽位**
 * （后写覆盖先写）→ 除最后一个外全部 reqId 失配 → **静默丢失决策**。
 *
 * 现状 `tickAllAIs()` 是「逐角色 fire-and-forget」，用户一次勾选 3 个角色
 * 就必然丢 2 次决策。本模块把「谁想决策」（触发）与「谁能决策」（执行）解耦：
 *
 *   · 触发侧：角色只往队列里**入队**，不直接发起请求
 *   · 执行侧：pump() 每 tick 最多取出**一个**任务发起 LLM（全局单槽位）
 *
 * 同时承载成本控制：
 *   · 每分钟 / 每小时预算（角色数动态）
 *   · 全局失败冷却（一次失败全员停 30s，而不是每个角色各烧一次 8s 超时）
 *   · 熔断（连续失败 3 次 → 2 分钟内完全不发 LLM，全员走兜底）
 *
 * ★ 紧急层不受任何影响：`sensor.checkEmergency()` 是纯程序化的，在
 *   调度器之前执行 —— 预算耗尽/熔断时 AI 在关键时刻依然会逃跑/用药。
 *
 * 设计文档：md/curr_design/toonflow-field-survival/ai/ai托管/ai托管.agent.触发频率.md
 */

import type { AIGameEvent, AICombatLevel } from "./types";

/** 队列任务 */
export interface BrainTask {
  entityId: string;
  entityName: string;
  priority: "P0" | "P1" | "P2";
  reason: string;
  /** 入队时刻（含抖动），用于同优先级先进先出 */
  enqueuedAt: number;
}

/** 调度器内部状态 */
interface SchedulerState {
  queue: BrainTask[];
  /** 全局单槽位：是否有 brain 请求在途 */
  inFlight: boolean;
  /** 本分钟已发出的请求数 */
  minuteCount: number;
  minuteWindowStart: number;
  /** 本小时已发出的请求数 */
  hourCount: number;
  hourWindowStart: number;
  /** 全局失败冷却截止时刻 */
  cooldownUntil: number;
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 熔断截止时刻 */
  breakerUntil: number;
  /** 实际发出的请求总数（诊断用） */
  totalIssued: number;
}

const state: SchedulerState = {
  queue: [],
  inFlight: false,
  minuteCount: 0,
  minuteWindowStart: Date.now(),
  hourCount: 0,
  hourWindowStart: Date.now(),
  cooldownUntil: 0,
  consecutiveFailures: 0,
  breakerUntil: 0,
  totalIssued: 0,
};

/** 预算参数（按托管角色数动态） */
export const BRAIN_BUDGET = {
  /** 每分钟最大请求数 */
  perMinute: (n: number) => Math.max(10, n * 12),
  /** 每小时最大请求数 */
  perHour: (n: number) => Math.max(120, n * 400),
  /** 全局失败冷却（ms） */
  failureCooldownMs: 30000,
  /** 连续失败多少次后熔断 */
  breakerThreshold: 3,
  /** 熔断持续时长（ms） */
  breakerDurationMs: 120000,
  /** 入队抖动（ms）：打散同拍入队的角色，避免 reqId 冲突 */
  staggerJitterMs: 1500,
  /** 战斗态只让最近的 N 个角色进 LLM 队列（其余走兜底） */
  combatLLMRoles: 2,
};

/** 优先级权重 */
const PRIORITY_WEIGHT: Record<"P0" | "P1" | "P2", number> = { P0: 0, P1: 1, P2: 2 };

/** 入队（去重：同一角色已在队列中则只提升优先级，不重复入队） */
export function enqueueBrainTask(entityId: string, entityName: string, priority: "P0" | "P1" | "P2", reason: string): void {
  const existing = state.queue.find((t) => t.entityId === entityId);
  if (existing) {
    // 已在队列：只在新任务优先级更高时提升，并更新原因
    if (PRIORITY_WEIGHT[priority] < PRIORITY_WEIGHT[existing.priority]) {
      existing.priority = priority;
      existing.reason = reason;
      existing.enqueuedAt = Date.now() + Math.random() * BRAIN_BUDGET.staggerJitterMs;
    }
    return;
  }
  state.queue.push({
    entityId,
    entityName,
    priority,
    reason,
    // ★ 抖动：同拍勾选 3 个角色时，打散它们的实际发起时刻
    enqueuedAt: Date.now() + Math.random() * BRAIN_BUDGET.staggerJitterMs,
  });
}

/** 移除某角色的待办任务（角色被取消托管时） */
export function removeBrainTask(entityId: string): void {
  state.queue = state.queue.filter((t) => t.entityId !== entityId);
}

/** 任务被筛掉时放回队列（战斗态「最近 N 个」之外的角色） */
export function requeueBrainTask(task: BrainTask): void {
  if (state.queue.some((t) => t.entityId === task.entityId)) return;
  // 放回时保持原优先级，但重新计算抖动时刻（避免立刻又被打回）
  state.queue.push({ ...task, enqueuedAt: Date.now() + Math.random() * BRAIN_BUDGET.staggerJitterMs });
}

/** 清空队列（切图 / 重置） */
export function clearBrainQueue(): void {
  state.queue = [];
}

/** 队列长度（诊断用） */
export function getQueueLength(): number {
  return state.queue.length;
}

/** 是否在熔断中 */
export function isBreakerOpen(): boolean {
  return Date.now() < state.breakerUntil;
}

/** 是否在全局冷却中 */
export function isCoolingDown(): boolean {
  return Date.now() < state.cooldownUntil;
}

/** 预算是否耗尽 */
export function isBudgetExhausted(managedCount: number): boolean {
  rollWindows();
  if (state.minuteCount >= BRAIN_BUDGET.perMinute(managedCount)) return true;
  if (state.hourCount >= BRAIN_BUDGET.perHour(managedCount)) return true;
  return false;
}

/** 滑动窗口重置 */
function rollWindows(): void {
  const now = Date.now();
  if (now - state.minuteWindowStart >= 60000) {
    state.minuteWindowStart = now;
    state.minuteCount = 0;
  }
  if (now - state.hourWindowStart >= 3600000) {
    state.hourWindowStart = now;
    state.hourCount = 0;
  }
}

/**
 * 调度器主泵：每 tick 调用一次。
 * 最多取出一个任务执行（全局单槽位）。
 *
 * @param managedCount 当前托管角色数（用于预算计算）
 * @param executor 执行器：真正发起 LLM 请求并返回结果
 * @returns 本次是否发起了请求
 */
export function pumpBrainScheduler(
  managedCount: number,
  executor: (task: BrainTask) => Promise<void>,
): boolean {
  if (state.inFlight) return false;              // 已有请求在途
  if (isBreakerOpen()) return false;            // 熔断中
  if (isCoolingDown()) return false;            // 失败冷却中
  if (isBudgetExhausted(managedCount)) return false;  // 预算耗尽

  const task = pickNextTask();
  if (!task) return false;

  state.inFlight = true;
  state.minuteCount += 1;
  state.hourCount += 1;
  state.totalIssued += 1;

  void (async () => {
    try {
      await executor(task);
      // 成功 → 清零连续失败
      state.consecutiveFailures = 0;
    } catch (e) {
      state.consecutiveFailures += 1;
      state.cooldownUntil = Date.now() + BRAIN_BUDGET.failureCooldownMs;
      console.warn("[ai-scheduler] brain 任务失败:", e);
      if (state.consecutiveFailures >= BRAIN_BUDGET.breakerThreshold) {
        state.breakerUntil = Date.now() + BRAIN_BUDGET.breakerDurationMs;
        console.warn(
          `[ai-scheduler] 连续失败 ${state.consecutiveFailures} 次 → 熔断 ${BRAIN_BUDGET.breakerDurationMs / 1000}s，期间全员走兜底`,
        );
      }
    } finally {
      state.inFlight = false;
    }
  })();

  return true;
}

/** 取出下一个任务：按优先级 + 入队时间排序 */
function pickNextTask(): BrainTask | null {
  if (!state.queue.length) return null;
  const now = Date.now();
  // 抖动未到点的任务暂不发出
  const ready = state.queue.filter((t) => t.enqueuedAt <= now);
  if (!ready.length) return null;
  ready.sort((a, b) => {
    const w = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (w !== 0) return w;
    return a.enqueuedAt - b.enqueuedAt;   // 同优先级先进先出（防饿死）
  });
  const task = ready[0];
  state.queue = state.queue.filter((t) => t !== task);
  return task;
}

/** 战斗态：筛出「最近的 N 个」角色进 LLM 队列（其余走兜底）
 *  ★ 理由：单槽位吞吐上限 ≈ 1/LLM往返 ≈ 24 req/min，5 角色 × 5s = 60 req/min
 *    根本达不到。与其让队列积压，不如只让**离玩家最近**的少数角色用 LLM ——
 *    玩家只关心身边队友的反应速度。
 */
export function pickCombatRoles(
  candidates: Array<{ id: string; name: string; x: number; y: number }>,
  playerX: number,
  playerY: number,
  limit: number = BRAIN_BUDGET.combatLLMRoles,
): Set<string> {
  const sorted = [...candidates].sort(
    (a, b) => Math.hypot(a.x - playerX, a.y - playerY) - Math.hypot(b.x - playerX, b.y - playerY),
  );
  return new Set(sorted.slice(0, limit).map((c) => c.id));
}

/** 诊断快照 */
export function debugScheduler(): {
  queue: number;
  inFlight: boolean;
  minuteCount: number;
  hourCount: number;
  totalIssued: number;
  breakerOpen: boolean;
  coolingDown: boolean;
  consecutiveFailures: number;
} {
  rollWindows();
  return {
    queue: state.queue.length,
    inFlight: state.inFlight,
    minuteCount: state.minuteCount,
    hourCount: state.hourCount,
    totalIssued: state.totalIssued,
    breakerOpen: isBreakerOpen(),
    coolingDown: isCoolingDown(),
    consecutiveFailures: state.consecutiveFailures,
  };
}
