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
  "sendSms", "sayLine", "updateCard",
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
  // ★ V2.1 三种社交/沉淀动作的参数裁剪
  //   ★ 内容留空 → dynamic=true（执行时由 AI 现场生成，用户需求）
  if (type === "sendSms") {
    const to = String(raw.smsTo || raw.to || "player").trim() || "player";
    action.smsTo = to.startsWith("group:") || to === "player" ? to.slice(0, 40) : "player";
    action.smsText = String(raw.smsText || raw.text || "").slice(0, 200);
    if (!action.smsText) action.dynamic = true;
  }
  if (type === "sayLine") {
    action.lineText = String(raw.lineText || raw.text || "").slice(0, 200);
    if (!action.lineText) action.dynamic = true;
  }
  if (type === "updateCard") {
    const f = raw.cardFields || raw.fields;
    const out: Record<string, string> = {};
    if (f && typeof f === "object") {
      for (const k of ["role_key_information", "executing_task", "other"]) {
        const v = (f as any)[k];
        if (typeof v === "string" && v.trim()) out[k] = v.slice(0, 200);
      }
    }
    action.cardFields = Object.keys(out).length ? out : undefined;
    if (!action.cardFields) action.dynamic = true;
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
    // ★ 2026-11-15 丢弃「参数缺失」的动作（LLM 不听话时的兜底）：
//   - gather 无 zoneName 且无坐标 → 无法执行（会走去 (0,0)）
//   - interact 无 target（既无 id 也无 name）→ 无法执行
//   - attack 无 target（既无 id 也无 name）→ 无法执行
//   ★ V2.1 变更：sendSms/sayLine/updateCard **内容留空不再丢弃** —— 标记 dynamic=true，
//     执行时由 AI 按上下文现场生成内容（用户需求：「留空代表执行时 ai 动态生成」）。
//     但「收件目标」缺失（短信连发给谁都没说）仍丢弃。
if ((action.type === "gather" && action.target?.x === undefined && !action.zoneName)
  || (action.type === "interact" && !action.target?.id && !action.target?.name)
  || (action.type === "attack" && !action.target?.id && !action.target?.name)
  || (action.type === "sendSms" && !action.smsTo)) {
  continue;
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
  let plan = getPlan(s);
  // ★ 2026-11-15 修复「两步同时执行中」：active 步必须唯一。
  //   存档恢复的旧 active 步（刷新前中断的执行）没有 activeStepId 归属，
  //   会与新取的步并存 → 面板显示两个「执行中」，finishPlanStep 只清第一个。
  //   规则：已有 active 步时不再取新步（执行完自然接下一步）；孤儿 active 步
  //   （activeStepId 为空 = 恢复自存档）先归位为 pending。
  const activeIdx = plan.findIndex((p) => p.status === "active");
  if (activeIdx >= 0) {
    const activeStep = plan[activeIdx];
    if (!s.activeStepId || s.activeStepId !== activeStep.id) {
      // ★ 孤儿 active 步（存档恢复）：目标坐标是**恢复前的旧位置**，角色早已走远
      //   → isActionComplete（0.8m）永远不满足 → 这一步永久卡住、后续全部排队。
      //   故直接作废（记 failed 历史）并继续取下一步，而不是归位等它完成。
      s.plan = [...plan.slice(0, activeIdx), ...plan.slice(activeIdx + 1)];
      plan = s.plan;
      pushHistory(s, activeStep.note, activeStep.action.type, "interrupted");
      bumpPlanVersion();
    } else {
      return null;   // 已有在执行的步 → 本拍不取新步
    }
  }
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
      } else if (!(action.type === "interact" && action.target?.x !== undefined)) {
        // 目标不在场上 → 该步记 failed，取再下一个
        // ★ interact 有坐标的例外：降级为「走到坐标」（地图 NPC/镇民不在服务端实体表，
        //   但 LLM 会给出坐标——executeInteract 降级发 move，走到 2m 内算完成）
        s.plan = [...plan.slice(0, idx), ...plan.slice(idx + 1)];
        plan = s.plan;
        pushHistory(s, step.note, action.type, "failed");
        idx = s.plan.findIndex((p) => p.status === "pending");
        continue;
      }
    }
    // move/flee 无坐标 → 转 wait（瞬完成步没有意义）
    if ((action.type === "move" || action.type === "flee") && action.target?.x === undefined) {
      action.type = "wait";
      action.duration = 2000;
      step.note = `${step.note}（目标无效，原地等待）`;
    }
    // ★ 2026-11-15 gather 无区域/坐标 → 无效步（executeGather 会去 (0,0) 乱跑）
    //   → 记 failed 跳过（LLM 偶尔产出「采集 资源」这种没有 zoneName 的空步）
    if (action.type === "gather" && action.target?.x === undefined && !action.zoneName) {
      s.plan = [...plan.slice(0, idx), ...plan.slice(idx + 1)];
      plan = s.plan;
      pushHistory(s, step.note, action.type, "failed");
      idx = s.plan.findIndex((p) => p.status === "pending");
      continue;
    }
    // ★ 2026-11-15 interact 无目标 id：有坐标 → 保留（executeInteract 降级为走到坐标，
//   支持地图 NPC/镇民——它们不在服务端实体表）；既无 id 也无坐标 → 跳过
if (action.type === "interact" && !action.target?.id && action.target?.x === undefined) {
  s.plan = [...plan.slice(0, idx), ...plan.slice(idx + 1)];
  plan = s.plan;
  pushHistory(s, step.note, action.type, "failed");
  idx = s.plan.findIndex((p) => p.status === "pending");
  continue;
}
    step.status = "active";
    s.activeStepId = step.id;
    s.awaitingPlan = false;
    bumpPlanVersion();
    return action;
  }
  return null;
}

/** 当前 active 步完成：写历史 + 从计划移除
 *  ★ 用新数组替换（原地 splice 不会触发面板 computed 重算 —— 见 removePlanStep 注释） */
export function finishPlanStep(s: AIState, result: "done" | "failed" | "interrupted" = "done"): void {
  const plan = getPlan(s);
  const idx = plan.findIndex((p) => p.status === "active");
  if (idx < 0) { s.activeStepId = undefined; return; }
  const step = plan[idx];
  step.status = result === "done" ? "done" : "failed";
  s.plan = [...plan.slice(0, idx), ...plan.slice(idx + 1)];
  s.activeStepId = undefined;
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
/** 删除计划步
 *  ★ 2026-11-15：用**新数组替换**而不是 splice 原地改 —— 面板的 plan 是 computed，
 *    依赖 aiStates 里同一个数组引用；原地改引用不变 → Vue 认为值没变 → 面板不刷新
 *    （实测：删掉了但界面仍显示 5 步）。
 *  ★ 2026-11-15（用户需求）：**执行中的步也允许删** —— 删时清掉 currentAction，
 *    返回 true 表示「动了执行中的步」，调用方应向 entry 发 stop（清残留移动目标，
 *    否则角色会继续走向旧目标最多 60s）。 */
export function removePlanStep(s: AIState, stepId: string): boolean {
  const plan = getPlan(s);
  const idx = plan.findIndex((p) => p.id === stepId);
  if (idx < 0) return false;
  const wasActive = plan[idx].status === "active";
  if (wasActive) {
    s.currentAction = null;
    s.activeStepId = undefined;
    s.actionStartedTick = undefined;
    pushHistory(s, plan[idx].note, plan[idx].action.type, "interrupted");
  }
  s.plan = [...plan.slice(0, idx), ...plan.slice(idx + 1)];
  // ★ 2026-11-15 修正：删完最后一步 → 计划为空。此时**不能**标记 planSource="user"：
  //   「用户编辑过 → AI 不自动重排」的保护规则会让空计划永远不重排 → AI 空转死循环
  //   （实测：夜见/聂小可 plan=0 + source=user，ai_command 发了 8107 次）。
  //   只有计划里还剩步（用户真的改过内容）才标记 user。
  if (s.plan.length) s.planSource = "user";
  bumpPlanVersion();
  return wasActive;
}

/** 替换计划步内容（编辑保存）
 *  ★ 执行中的步也允许改：改后重置为 pending 并清当前动作 → 下一拍重新取它执行。 */
export function replacePlanStep(s: AIState, stepId: string, action: AIAction, note: string): boolean {
  const plan = getPlan(s);
  const idx = plan.findIndex((p) => p.id === stepId);
  if (idx < 0) return false;
  const wasActive = plan[idx].status === "active";
  if (wasActive) {
    s.currentAction = null;
    s.activeStepId = undefined;
    s.actionStartedTick = undefined;
  }
  const next = plan.slice();
  next[idx] = { ...next[idx], action, note: note.slice(0, 24), status: wasActive ? "pending" : next[idx].status };
  s.plan = next;
  s.planSource = "user";
  bumpPlanVersion();
  return wasActive;
}

/** 在 afterId 之后插入新步（afterId=null = 插到最前）；返回新步 id */
export function insertPlanStep(s: AIState, afterId: string | null, action: AIAction, note: string): string | null {
  const plan = getPlan(s);
  if (plan.length >= PLAN_MAX) return null;
  const step: PlanStep = { id: genId("step"), note: note.slice(0, 24), action, status: "pending", createdAt: Date.now() };
  let next: PlanStep[];
  if (afterId == null) {
    next = [step, ...plan];
  } else {
    const idx = plan.findIndex((p) => p.id === afterId);
    if (idx < 0) return null;
    next = [...plan.slice(0, idx + 1), step, ...plan.slice(idx + 1)];
  }
  s.plan = next;
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

/** 清空计划并请求 AI 重排（面板「交给 AI 重排」按钮）——主循环空档时自动入队 plan_exhausted
 *  ★ 2026-11-15：清上次失败信息 + 记录请求时刻（面板显示「重排中…已等待 Xs」） */
export function requestAIReplan(s: AIState): void {
  s.plan = [];
  s.planSource = "ai";
  s.awaitingPlan = false;
  s.planReqAt = undefined;
  s.planError = undefined;
  bumpPlanVersion();
}
