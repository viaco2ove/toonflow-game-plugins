/**
 * ai/plan.ts — 行为链 V2：计划解析 / 兜底计划 / 状态机纯函数
 * ============================================================
 * 设计（md/curr_design/toonflow-field-survival/ai/V2/ai托管V2.md）：
 *   - 托管后 LLM 一次生成 ≥5 步行为计划，角色按序执行
 *   - 紧急/临时行为只「插队」（发生在动作完成后的空档），计划保留
 *   - 历史记录滚动保留（默认可见 5 条，可往前翻），上限 HISTORY_MAX
 *   - 用户编辑过的计划（planSource="user"）AI 不自动覆盖
 *
 * 本文件只放**纯数据逻辑**（解析、校验、状态机），prompt 构建在 brain.ts
 * （需要复用感知/身份块等私有组件）。全部函数无 DOM/window 依赖，可 node 测。
 */
import { AIAction, AIActionType, AIState, PlanStep, HistoryEntry, PlanSource } from "./types";

export const PLAN_MIN = 5;
export const PLAN_MAX = 8;
export const HISTORY_MAX = 50;

/** 合法动作类型白名单（与 AIActionType 一致） */
const ACTION_TYPES: ReadonlySet<string> = new Set<string>([
  "move", "attack", "gather", "interact", "useSkill", "useItem", "flee", "wait", "follow",
]);

let idSeq = 0;
export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(idSeq++).toString(36)}`;
}

/** 取计划数组（懒初始化，AIState.plan 为 optional 兼容旧状态） */
export function getPlan(s: AIState): PlanStep[] {
  if (!s.plan) s.plan = [];
  return s.plan;
}

/** 取历史数组（懒初始化） */
export function getHistory(s: AIState): HistoryEntry[] {
  if (!s.history) s.history = [];
  return s.history;
}

/* ============================================================
   计划步构造 / 解析
   ============================================================ */

/** 裁剪 target 到 AIPosition 白名单字段 */
function sanitizeTarget(raw: any): { id?: string; x?: number; y?: number; name?: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t: { id?: string; x?: number; y?: number; name?: string } = {};
  const x = Number(raw.x), y = Number(raw.y);
  if (Number.isFinite(x)) t.x = x;
  if (Number.isFinite(y)) t.y = y;
  if (raw.id != null && String(raw.id).trim()) t.id = String(raw.id).slice(0, 40);
  if (raw.name != null && String(raw.name).trim()) t.name = String(raw.name).slice(0, 30);
  return Object.keys(t).length ? t : undefined;
}

/** 单个动作对象 → 白名单裁剪后的 AIAction（非法返回 null） */
export function sanitizeAction(raw: any): AIAction | null {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "").trim();
  if (!ACTION_TYPES.has(type)) return null;
  const action: AIAction = {
    type: type as AIActionType,
    priority: Math.max(0, Math.min(100, Math.round(Number(raw.priority) || 50))),
    context: String(raw.context || raw.note || "").slice(0, 60),
  };
  const t = sanitizeTarget(raw.target);
  if (t) action.target = t;
  if (raw.skillName) action.skillName = String(raw.skillName).slice(0, 30);
  if (raw.itemName) action.itemName = String(raw.itemName).slice(0, 30);
  if (raw.zoneName) action.zoneName = String(raw.zoneName).slice(0, 30);
  if (type === "wait" && Number.isFinite(Number(raw.duration))) {
    action.duration = Math.max(500, Math.min(30000, Math.round(Number(raw.duration))));
  }
  return action;
}

export interface PlanZone { zoneName: string; position: { x: number; y: number } }

/**
 * 解析 LLM 的计划响应 → PlanStep[]
 * - 自动剥 ```json 围栏 / 提取最外层 JSON
 * - type 白名单外的步丢弃；move/gather 只有 zoneName 时用 zones 补坐标
 * - 步数 < PLAN_MIN → 追加兜底步凑满；0 步 → null（调用方走 buildFallbackPlan）
 */
export function parsePlanResponse(
  raw: string,
  opts?: { zones?: PlanZone[]; characterName?: string },
): { goal: string; steps: PlanStep[] } | null {
  if (!raw) return null;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let obj: any;
  try {
    obj = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  const rawPlan = Array.isArray(obj?.plan) ? obj.plan : null;
  if (!rawPlan || !rawPlan.length) return null;

  const zones = opts?.zones || [];
  const steps: PlanStep[] = [];
  for (const rawStep of rawPlan.slice(0, PLAN_MAX * 2)) {   // 防爆：最多看 16 条
    if (!rawStep || typeof rawStep !== "object") continue;
    const action = sanitizeAction(rawStep);
    if (!action) continue;
    // move/gather 只有区域名没坐标 → 用感知资源表补齐（否则 isActionComplete 瞬完成跳过）
    if ((action.type === "move" || action.type === "gather") && action.target?.x === undefined && action.zoneName) {
      const z = zones.find((zz) => zz.zoneName === action.zoneName);
      if (z) action.target = { ...(action.target || {}), x: z.position.x, y: z.position.y, name: z.zoneName };
    }
    const note = String(rawStep.note || rawStep.context || action.context || action.type).slice(0, 24);
    steps.push({
      id: genId("step"),
      note,
      action,
      status: "pending",
      createdAt: Date.now(),
    });
    if (steps.length >= PLAN_MAX) break;
  }
  if (!steps.length) return null;
  // 不足 PLAN_MIN → wait 兜底步凑满（面板与需求都要求「不少于 5 件事」）
  while (steps.length < PLAN_MIN) {
    steps.push({
      id: genId("step"),
      note: "原地警戒待命",
      action: { type: "wait", duration: 3000, priority: 30, context: "计划步不足，程序化补齐" },
      status: "pending",
      createdAt: Date.now(),
    });
  }
  return { goal: String(obj.goal || "").slice(0, 40), steps };
}

/** 程序化兜底计划（LLM 失败/超时时）：按感知拼 5 步连贯日程 */
export function buildFallbackPlan(
  perception: { nearby?: { enemies?: any[] }; resources?: Array<{ zoneName: string; position: { x: number; y: number } }> },
  playerPos?: { x: number; y: number },
): PlanStep[] {
  const steps: PlanStep[] = [];
  const enemies = perception?.nearby?.enemies || [];
  const resources = perception?.resources || [];
  if (enemies.length) {
    const e = enemies[0];
    steps.push({
      id: genId("step"), note: `攻击 ${e.name}`, status: "pending", createdAt: Date.now(),
      action: { type: "attack", target: { id: e.id, x: e.position?.x, y: e.position?.y, name: e.name }, priority: 60, context: "兜底：攻击附近敌人" },
    });
  }
  for (const r of resources.slice(0, 2)) {
    steps.push({
      id: genId("step"), note: `前往 ${r.zoneName} 采集`, status: "pending", createdAt: Date.now(),
      action: { type: "gather", target: { x: r.position.x, y: r.position.y, name: r.zoneName }, zoneName: r.zoneName, priority: 50, context: "兜底：采集资源" },
    });
  }
  if (playerPos) {
    steps.push({
      id: genId("step"), note: "回到玩家身边", status: "pending", createdAt: Date.now(),
      action: { type: "move", target: { x: playerPos.x, y: playerPos.y, name: "player" }, priority: 40, context: "兜底：跟随玩家" },
    });
  }
  while (steps.length < PLAN_MIN) {
    steps.push({
      id: genId("step"), note: "原地警戒待命", status: "pending", createdAt: Date.now(),
      action: { type: "wait", duration: 3000, priority: 30, context: "兜底：等待" },
    });
  }
  return steps.slice(0, PLAN_MAX);
}

/* ============================================================
   状态机（面板编辑操作 + tick 推进共用）
   ============================================================ */

/** 全局计划版本号：任何增删改/推进都 bump，面板据此刷新（aiStates 是普通 Map 非 reactive） */
let planVersion = 0;
export function bumpPlanVersion(): void { planVersion++; }
export function getPlanVersion(): number { return planVersion; }

/** 整体设置计划（LLM 产出 / 用户重排 / 交给 AI） */
export function setPlan(s: AIState, steps: PlanStep[], source: PlanSource, goal?: string): void {
  s.plan = steps;
  s.planSource = source;
  s.awaitingPlan = false;
  if (goal) s.goal = goal;
  bumpPlanVersion();
}

/**
 * 取下一个 pending 步并标 active，返回其 action（设为 currentAction 由调用方执行）。
 * - attack/interact 步缺 target.id 时按名字在场上解析；解析不到 → 移除该步（记 failed 历史）并继续找
 * - move 步缺坐标 → 转成 wait（否则 isActionComplete 瞬完成）
 */
export function takeNextPlanStep(
  s: AIState,
  world: { entities?: Array<{ id?: string; name?: string; side?: string; x?: number; y?: number; alive?: boolean }> },
): AIAction | null {
  const plan = getPlan(s);
  let idx = plan.findIndex((p) => p.status === "pending");
  while (idx >= 0) {
    const step = plan[idx];
    const action = step.action;
    // attack/interact：名字 → 场上实体 id（完成判定依赖 id）
    if ((action.type === "attack" || action.type === "interact") && !action.target?.id) {
      const name = action.target?.name || action.zoneName || "";
      const ent = (world.entities || []).find(
        (e) => e && String(e.name) === String(name) && e.alive !== false && e.side !== "player",
      );
      if (ent && ent.id) {
        action.target = { ...(action.target || {}), id: String(ent.id), name: String(ent.name || name) };
        if (action.target.x === undefined && Number.isFinite(ent.x)) action.target.x = ent.x;
        if (action.target.y === undefined && Number.isFinite(ent.y)) action.target.y = ent.y;
      } else {
        // 目标不在场上 → 该步记 failed，取再下一个
        plan.splice(idx, 1);
        pushHistory(s, step.note, action.type, "failed");
        idx = plan.findIndex((p) => p.status === "pending");
        continue;
      }
    }
    // move/flee 无坐标 → 转 wait（瞬完成步没有意义）
    if ((action.type === "move" || action.type === "flee") && action.target?.x === undefined) {
      action.type = "wait";
      action.duration = 2000;
      step.note = `${step.note}（目标无效，原地等待）`;
    }
    step.status = "active";
    s.awaitingPlan = false;
    bumpPlanVersion();
    return action;
  }
  return null;
}

/** 当前 active 步完成：写历史 + 从计划移除 */
export function finishPlanStep(s: AIState, result: "done" | "failed" | "interrupted" = "done"): void {
  const plan = getPlan(s);
  const idx = plan.findIndex((p) => p.status === "active");
  if (idx < 0) return;
  const step = plan[idx];
  step.status = result === "done" ? "done" : "failed";
  plan.splice(idx, 1);
  pushHistory(s, step.note, step.action.type, result);
  bumpPlanVersion();
}

function pushHistory(s: AIState, note: string, type: string, result: HistoryEntry["result"]): void {
  const history = getHistory(s);
  history.unshift({ id: genId("hist"), note, type, finishedAt: Date.now(), result });
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
}

/* —— 面板编辑操作（全部同步生效 + 落库由调用方防抖） —— */

/** 删除计划步 */
export function removePlanStep(s: AIState, stepId: string): void {
  const plan = getPlan(s);
  const idx = plan.findIndex((p) => p.id === stepId);
  if (idx < 0) return;
  if (plan[idx].status === "active") return;   // 执行中的步不允许删（等它完成/失败）
  plan.splice(idx, 1);
  bumpPlanVersion();
}

/** 替换计划步内容（编辑保存） */
export function replacePlanStep(s: AIState, stepId: string, action: AIAction, note: string): void {
  const plan = getPlan(s);
  const idx = plan.findIndex((p) => p.id === stepId);
  if (idx < 0) return;
  if (plan[idx].status === "active") return;
  plan[idx].action = action;
  plan[idx].note = note.slice(0, 24);
  s.planSource = "user";
  bumpPlanVersion();
}

/** 在 afterId 之后插入新步（afterId=null = 插到最前）；返回新步 id */
export function insertPlanStep(s: AIState, afterId: string | null, action: AIAction, note: string): string | null {
  const plan = getPlan(s);
  if (plan.length >= PLAN_MAX) return null;
  const step: PlanStep = { id: genId("step"), note: note.slice(0, 24), action, status: "pending", createdAt: Date.now() };
  if (afterId == null) {
    plan.unshift(step);
  } else {
    const idx = plan.findIndex((p) => p.id === afterId);
    if (idx < 0) return null;
    plan.splice(idx + 1, 0, step);
  }
  s.planSource = "user";
  s.awaitingPlan = false;
  bumpPlanVersion();
  return step.id;
}

/** 清空历史 */
export function clearHistory(s: AIState): void {
  s.history = [];
  bumpPlanVersion();
}

/** 清空计划并请求 AI 重排（面板「交给 AI 重排」按钮）——主循环空档时自动入队 plan_exhausted */
export function requestAIReplan(s: AIState): void {
  s.plan = [];
  s.planSource = "ai";
  s.awaitingPlan = false;
  s.planReqAt = undefined;
  bumpPlanVersion();
}
