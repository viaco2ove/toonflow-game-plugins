/**
 * ai/aiConfig.ts — AI 托管运行时配置（持久化到 t_plugin_session_data）
 * ================================================================
 * 职责：让「AI 托管频率」可以在系统面板里调，而不是写死在代码常量里。
 *
 * 存储：t_plugin_session_data，key = "ai_settings"
 *   （与 player_flags / map_data 同一张表，宿主 pluginData.set/get 通道）
 *
 * 优先级（从高到低）：
 *   1. 地图集覆盖（events.json 的 ai 字段 / ai_interval 动作）—— 见 mapInterval.ts
 *   2. **本模块的用户配置**（系统面板 → AI 页签）
 *   3. 代码默认值（DEFAULT_BRAIN_CONFIG）
 *
 * ★ 注意配置项之间的关系：
 *   · maxInterval 是「非战斗态的实际上限」—— idle 间隔会被它钳住
 *   · engaged/skirmish 是三档间隔的**基线**，最终还要过 min/max 钳制
 *   · minInterval 是全局硬下界（地图集覆盖也压不过它，除非在 engaged 态）
 *
 * 设计文档：md/curr_design/toonflow-field-survival/ai/ai托管/ai托管.agent.触发频率.md
 */
import type { BrainConfig } from "./types";
import { DEFAULT_BRAIN_CONFIG } from "./types";

/** ★ 持久化 key（t_plugin_session_data） */
export const AI_SETTINGS_KEY = "ai_settings";

/** 用户可配的 AI 设置 */
export interface AISettings {
  /** 非战斗态最大决策间隔 ms（idle 会被它钳住） */
  maxInterval: number;
  /** 全局最小决策间隔 ms（硬下界） */
  minInterval: number;
  /** 交战中（玩家刚参与伤害）间隔 ms */
  engaged: number;
  /** 遭遇战（附近仍有敌人）间隔 ms */
  skirmish: number;
  /** 非战斗间隔 ms */
  idle: number;
  /** 最大托管角色数 */
  maxManagedCount: number;
  /** 是否启用自适应间隔（关掉则固定用 minInterval） */
  adaptiveEnabled: boolean;
}

/** 默认值（与 types.ts 的 DEFAULT_BRAIN_CONFIG 对齐） */
export const DEFAULT_AI_SETTINGS: AISettings = {
  maxInterval: 20000,
  minInterval: 5000,
  engaged: 5000,
  skirmish: 10000,
  idle: 20000,
  maxManagedCount: 5,
  adaptiveEnabled: true,
};

/** 可配范围（面板滑块边界 + 落库前钳制） */
export const AI_SETTINGS_RANGE = {
  maxInterval: { min: 10000, max: 120000, step: 1000 },
  minInterval: { min: 2000, max: 30000, step: 500 },
  engaged: { min: 2000, max: 60000, step: 500 },
  skirmish: { min: 2000, max: 120000, step: 500 },
  idle: { min: 2000, max: 120000, step: 500 },
  maxManagedCount: { min: 1, max: 10, step: 1 },
} as const;

/** ★ 运行时生效的配置（brain.ts / mapInterval.ts 读这里） */
let runtimeConfig: BrainConfig = {
  minInterval: DEFAULT_AI_SETTINGS.minInterval,
  maxInterval: DEFAULT_AI_SETTINGS.maxInterval,
  adaptiveEnabled: DEFAULT_AI_SETTINGS.adaptiveEnabled,
  maxManagedCount: DEFAULT_AI_SETTINGS.maxManagedCount,
};

/** ★ 三档间隔的运行时基线（brain.ts calculateInterval 读这里） */
let runtimeIntervals = {
  engaged: DEFAULT_AI_SETTINGS.engaged,
  skirmish: DEFAULT_AI_SETTINGS.skirmish,
  idle: DEFAULT_AI_SETTINGS.idle,
};

/** 数值钳制到 [min, max]，非法值回落到 fallback
 *  ★ 注意：Number(null) === 0、Number("") === 0、Number([]) === 0 —— 都是「有限数」，
 *    但都不是有效输入。所以要先用 typeof 排除非 number 类型，再钳制。
 */
function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.round(v), min), max);
}

/** 把任意来源的对象规整成合法的 AISettings */
export function normalizeAISettings(raw: unknown): AISettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_AI_SETTINGS;
  const s: AISettings = {
    maxInterval: clampNum(o.maxInterval, AI_SETTINGS_RANGE.maxInterval.min, AI_SETTINGS_RANGE.maxInterval.max, d.maxInterval),
    minInterval: clampNum(o.minInterval, AI_SETTINGS_RANGE.minInterval.min, AI_SETTINGS_RANGE.minInterval.max, d.minInterval),
    engaged: clampNum(o.engaged, AI_SETTINGS_RANGE.engaged.min, AI_SETTINGS_RANGE.engaged.max, d.engaged),
    skirmish: clampNum(o.skirmish, AI_SETTINGS_RANGE.skirmish.min, AI_SETTINGS_RANGE.skirmish.max, d.skirmish),
    idle: clampNum(o.idle, AI_SETTINGS_RANGE.idle.min, AI_SETTINGS_RANGE.idle.max, d.idle),
    maxManagedCount: clampNum(o.maxManagedCount, AI_SETTINGS_RANGE.maxManagedCount.min, AI_SETTINGS_RANGE.maxManagedCount.max, d.maxManagedCount),
    adaptiveEnabled: typeof o.adaptiveEnabled === "boolean" ? o.adaptiveEnabled : d.adaptiveEnabled,
  };
  // ★ 一致性修正：minInterval 不能大于 maxInterval
  if (s.minInterval > s.maxInterval) s.minInterval = s.maxInterval;
  // ★ 三档之间保持单调：交战 ≤ 遭遇战 ≤ 非战斗。
  //   这是「越危险越快」的语义保证 —— 玩家配出 engaged=30s / idle=5s 明显是笔误，
  //   直接纠正比让用户困惑更好。
  if (s.engaged > s.skirmish) s.skirmish = s.engaged;
  if (s.skirmish > s.idle) s.idle = s.skirmish;
  // ★ idle 不能低于 minInterval（minInterval 是非战斗态的硬下界）
  if (s.idle < s.minInterval) s.idle = s.minInterval;
  // ★ engaged/skirmish **不**抬到 minInterval —— 它们本就该比 minInterval 更快。
  //   minInterval 的语义是「非战斗态的最小间隔」；
  //   战斗态的下界由 AI_SETTINGS_RANGE.engaged.min（2000ms）兜底。
  return s;
}

/** 把设置应用到运行时（brain.ts / mapInterval.ts 立即生效） */
export function applyAISettings(s: AISettings): AISettings {
  const n = normalizeAISettings(s);
  runtimeConfig = {
    minInterval: n.minInterval,
    maxInterval: n.maxInterval,
    adaptiveEnabled: n.adaptiveEnabled,
    maxManagedCount: n.maxManagedCount,
  };
  runtimeIntervals = { engaged: n.engaged, skirmish: n.skirmish, idle: n.idle };
  return n;
}

/** 读取当前运行时配置（brain.ts 用） */
export function getRuntimeBrainConfig(): BrainConfig {
  return runtimeConfig;
}

/** 读取当前三档间隔基线（brain.ts calculateInterval 用） */
export function getRuntimeIntervals(): { engaged: number; skirmish: number; idle: number } {
  return runtimeIntervals;
}

/** 读取当前完整设置（面板显示用） */
export function getAISettings(): AISettings {
  return {
    maxInterval: runtimeConfig.maxInterval,
    minInterval: runtimeConfig.minInterval,
    engaged: runtimeIntervals.engaged,
    skirmish: runtimeIntervals.skirmish,
    idle: runtimeIntervals.idle,
    maxManagedCount: runtimeConfig.maxManagedCount,
    adaptiveEnabled: runtimeConfig.adaptiveEnabled,
  };
}

/** 恢复默认（面板「恢复默认」按钮） */
export function resetAISettings(): AISettings {
  return applyAISettings({ ...DEFAULT_AI_SETTINGS });
}

/* ============================================================
 * 持久化：t_plugin_session_data
 * ========================================================== */

/** pluginData 读写接口（与 eventEngine 的 hooks.pluginData 同形状）
 *  ★ scope 可选：t_plugin_session_data 的 sessionId 维度。
 *    不传 = 由宿主决定（dev-host 会用当前故事会话 ID）。
 *    传 "all" = 跨会话共享（用户偏好类数据应该用这个）。
 */
export interface AIConfigStore {
  get(key: string, scope?: string): Promise<unknown>;
  set(key: string, value: unknown, scope?: string): Promise<void>;
}

/**
 * ★ 跨 scope 读写（关键！）
 *
 *  t_plugin_session_data 的维度是 userId × sessionId × pluginId × dataKey。
 *  AI 配置是**用户偏好**，应该跨会话存活 → 落在 sessionId="all"。
 *
 *  为什么必须显式锁 "all"：
 *    - entry.js 侧 ctx.sessionId 用故事会话 ID（gs_xxx）
 *    - iframe 侧 SDK 默认也走宿主注入的故事会话
 *    - 而 __STORY_SESSION_ID__ 是在 iframe 加载**之后**才赋值的
 *      → iframe 在 onMounted 阶段读的时候可能拿到 "all"，稍后又变成 gs_xxx，
 *        读写分家（写 gs_xxx / 读 all），表现为「保存成功但刷新后丢」。
 *
 *  后端 POST /plugin/data 的 sessionId="all" 是跨会话共享的（跳过 t_gameSession 校验），
 *  所以锁 "all" 完全合法。
 */
const CONFIG_SCOPE = "all";

/** 从 t_plugin_session_data 读取配置并应用（启动时调用）
 *  ★ 没有存过配置（store 返回 null）时 → 用**默认值**重置运行时，
 *    不能保留「上一次 apply 的残留值」（比如用户点了恢复默认后保存失败）。
 */
export async function loadAISettings(store: AIConfigStore | null): Promise<AISettings> {
  if (!store) return getAISettings();
  try {
    const raw = await store.get(AI_SETTINGS_KEY, CONFIG_SCOPE);
    if (!raw || typeof raw !== "object") {
      // 没存过 → 回到默认
      return resetAISettings();
    }
    const n = applyAISettings(raw as AISettings);
    console.info("[ai-config] 已加载用户配置:", n);
    return n;
  } catch (e) {
    console.warn("[ai-config] 读取配置失败，用默认值:", e);
    return resetAISettings();
  }
}

/** 保存配置到 t_plugin_session_data 并立即应用（scope="all"，跨会话共享） */
export async function saveAISettings(store: AIConfigStore | null, s: AISettings): Promise<AISettings> {
  const n = applyAISettings(s);
  if (!store) return n;
  try {
    await store.set(AI_SETTINGS_KEY, n, CONFIG_SCOPE);
    console.info("[ai-config] 已保存配置:", n);
  } catch (e) {
    console.warn("[ai-config] 保存配置失败:", e);
  }
  return n;
}
