/**
 * 宿主下发 state 的字段补齐（normalize）
 *
 * 背景（2026-10-21）：安卓端运行期反复抛
 *   TypeError: Cannot read properties of undefined (reading 'find')
 *   at SX.fn (computed) ← set value ← postMessage(tf_plugin_state)
 * 根因：宿主（entry.js 编排路径 / stateJson 指针自愈后的旧存档 / phase=select
 * 精简 state）下发的 state 缺 entities 等数组字段，App.vue 里
 * state.value.entities.find(...) 等裸数组访问直接炸。
 * 早上只修了 `.find(` 带 `?? []` 的写法，`.some/.filter/.push` 以及运行时
 * 推来的残缺 state 没覆盖 —— 逐个修几百处不现实，**在 state 唯一入口
 * （bridge.onHostState）统一补齐**才是治本。
 *
 * 原则：
 * - 只补"缺的/类型不对的"，绝不覆盖已有值；
 * - 返回浅拷贝新对象，不 mutate 宿主消息体；
 * - 同时返回 patched 字段清单，供调用方打字段体检日志。
 */
import type { GameState } from "./types";

/** 必须为数组的顶层字段 */
const ARRAY_FIELDS: readonly (keyof GameState)[] = [
  "roles",
  "entities",
  "chests",
  "potions",
  "floaters",
  "skills",
  "items",
  "drops",
  "events",
  "vfx",
  "regions",
];

/** 必须为数字的顶层字段 */
const NUM_FIELDS: readonly (keyof GameState)[] = [
  "version",
  "tick",
  "exp",
  "money",
  "kills",
  "skillPage",
  "itemPage",
];

/** 合法 phase 值 */
const PHASES = new Set(["select", "playing", "over"]);

export interface NormalizeResult {
  state: GameState;
  /** 被补齐的字段名（空数组 = 宿主 state 完整，无需日志） */
  patched: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * 把宿主下发的 state 补齐为结构完整的 GameState。
 * raw 非对象时返回一份 select 阶段的最小 state（调用方一般已有判空，双保险）。
 */
export function normalizeHostState(raw: unknown): NormalizeResult {
  const patched: string[] = [];
  if (!isPlainObject(raw)) {
    patched.push("<non-object>");
    return { state: buildMinimalState(), patched };
  }

  // 浅拷贝：不 mutate postMessage 克隆出来的消息体
  const s: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  // phase：非法值归一为 select（select 阶段 state 本就允许缺数组）
  if (typeof s.phase !== "string" || !PHASES.has(s.phase)) {
    s.phase = "select";
    patched.push("phase");
  }

  // 数组字段
  for (const k of ARRAY_FIELDS) {
    if (!Array.isArray(s[k])) {
      s[k] = [];
      patched.push(String(k));
    }
  }

  // selections：对象 + 三个子数组
  {
    const sel = s.selections;
    if (!isPlainObject(sel)) {
      s.selections = { participants: [], spectators: [], enemies: [] };
      patched.push("selections");
    } else {
      const fixed: Record<string, string[]> = {};
      let touched = false;
      for (const sub of ["participants", "spectators", "enemies"] as const) {
        if (Array.isArray(sel[sub])) fixed[sub] = sel[sub] as string[];
        else {
          fixed[sub] = [];
          touched = true;
        }
      }
      if (touched) {
        s.selections = { ...sel, ...fixed };
        patched.push("selections.*");
      }
    }
  }

  // world：{ w, h } 数字
  {
    const w = s.world;
    if (!isPlainObject(w) || typeof w.w !== "number" || typeof w.h !== "number") {
      s.world = { w: 0, h: 0 };
      patched.push("world");
    }
  }

  // 可空字段：缺省统一为 null
  for (const k of ["map", "result", "town"] as const) {
    if (s[k] === undefined) {
      s[k] = null;
      patched.push(String(k));
    }
  }

  // 数字字段：非数字补 0
  for (const k of NUM_FIELDS) {
    if (typeof s[k] !== "number" || !Number.isFinite(s[k] as number)) {
      s[k] = 0;
      patched.push(String(k));
    }
  }

  return { state: s as unknown as GameState, patched };
}

/** select 阶段最小 state（raw 完全不可用时兜底） */
function buildMinimalState(): GameState {
  return {
    phase: "select",
    version: 0,
    tick: 0,
    world: { w: 0, h: 0 },
    roles: [],
    selections: { participants: [], spectators: [], enemies: [] },
    entities: [],
    chests: [],
    potions: [],
    floaters: [],
    skills: [],
    items: [],
    skillPage: 0,
    itemPage: 0,
    map: null,
    exp: 0,
    money: 0,
    drops: [],
    kills: 0,
    events: [],
    result: null,
  } as GameState;
}

/** state 字段体检日志（每次宿主推 state 打一条，排障用） */
export function logStateHealth(state: GameState, patched: string[]): void {
  const s = state as unknown as Record<string, unknown>;
  const len = (k: string) => (Array.isArray(s[k]) ? `${k}=${(s[k] as unknown[]).length}` : `${k}=<${typeof s[k]}>`);
  const summary = ["roles", "entities", "chests", "potions", "floaters", "skills", "items", "drops", "events"]
    .map(len)
    .join(" ");
  if (patched.length) {
    console.warn(
      `[field-survival] state 字段体检❗补齐[${patched.join(",")}] → phase=${String(s.phase)} v=${String(s.version)} tick=${String(s.tick)} ${summary}`,
    );
  } else {
    console.info(
      `[field-survival] state 字段体检✓ → phase=${String(s.phase)} v=${String(s.version)} tick=${String(s.tick)} ${summary}`,
    );
  }
}
