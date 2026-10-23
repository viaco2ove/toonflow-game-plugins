/**
 * ai/mapInterval.ts — 地图集 AI 间隔覆盖
 * ============================================
 * 职责：让「地图集可以个性自己的定时器」这条需求有落点。
 *
 * 两种配置方式（事件级 > 地图级 > 代码默认）：
 *   A. events.json 的 interval 事件里写 `ai_interval` 动作
 *        { "type": "ai_interval", "engaged": 5000, "skirmish": 8000, "idle": 25000 }
 *   B. events.json 顶层加 `ai` 字段
 *        { "ai": { "interval": { "engaged": 5000, "idle": 25000 }, "maxManaged": 3 } }
 *
 * ★ 硬钳制：地图集不能突破上下界，否则一张图就能把全局 token 打到破产：
 *   · 战斗态（engaged）下界 HARD_FLOOR_INTERVAL = 3000ms（LLM 往返 1.5~4s，低于 3s 决策会堆积）
 *   · 其他态下界 = brainConfig.minInterval = 5000ms
 *   · 上界 = brainConfig.maxInterval = 30000ms
 *
 * 设计文档：md/curr_design/toonflow-field-survival/ai/ai托管/ai托管.agent.触发频率.md
 */
import { getLoadedEventsFile } from "../eventEngine";
import {
  HARD_CEIL_INTERVAL,
  HARD_FLOOR_INTERVAL,
} from "./types";

/** 地图级 AI 配置（events.json 顶层 `ai` 字段） */
export interface MapAIConfig {
  /** 按战斗等级分别指定的间隔（ms） */
  interval?: {
    engaged?: number;
    skirmish?: number;
    idle?: number;
    /** 统一覆盖三档 */
    all?: number;
  };
  /** 本图最大托管角色数 */
  maxManaged?: number;
}

/** 事件级 `ai_interval` 动作 */
export interface AIIntervalAction {
  engaged?: number;
  skirmish?: number;
  idle?: number;
  all?: number;
}

/** 战斗等级 */
type CombatLevel = "none" | "skirmish" | "engaged";

/** 当前战斗等级（由调用方从感知传入，避免本模块依赖 React 状态） */
let currentLevel: CombatLevel = "none";

/** 事件级覆盖（由事件引擎执行 ai_interval 动作时写入，切图时清空） */
let eventLevelOverride: AIIntervalAction | null = null;

/** 设置当前战斗等级（每 tick 由 scheduler 更新） */
export function setCurrentCombatLevel(level: CombatLevel): void {
  currentLevel = level;
}

/** 钳制到合法区间 */
function clampInterval(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return raw;
  // 战斗态允许下探到 HARD_FLOOR（BOSS 图需要 3s 粒度）；其他态用 5000 下界
  const floor = currentLevel === "engaged" ? HARD_FLOOR_INTERVAL : 5000;
  const ceil = Math.min(HARD_CEIL_INTERVAL, 30000);
  return Math.min(Math.max(raw, floor), ceil);
}

/** 从已加载的 events.json 读取地图级 AI 配置（顶层 `ai` 字段） */
function readMapLevelConfig(): MapAIConfig | null {
  const file = getLoadedEventsFile() as any;
  const ai = file?.ai;
  if (ai && typeof ai === "object") return ai as MapAIConfig;
  return null;
}

/** 从已加载的事件里找 `ai_interval` 动作（事件级覆盖，优先级最高）
 *
 *  注意：事件引擎在执行 ai_interval 动作时会主动调 setMapIntervalOverride()
 *  把值写进 eventLevelOverride（避免这里再去反向 import eventEngine 形成循环依赖）。
 *  所以本函数读的是 eventLevelOverride，不是事件数组。
 */
function readEventLevelOverride(): AIIntervalAction | null {
  return eventLevelOverride;
}

/** 事件引擎在执行 `ai_interval` 动作时调用（切图时由 clearMapIntervalOverride 清空） */
export function setMapIntervalOverride(cfg: AIIntervalAction): void {
  eventLevelOverride = { ...(eventLevelOverride || {}), ...cfg };
}

/** 切图时清空事件级覆盖 */
export function clearMapIntervalOverride(): void {
  eventLevelOverride = null;
}

/** 读取当前地图的间隔覆盖（ms），null = 无覆盖，用代码默认值 */
export function readMapIntervalOverride(mapName?: string): number | null {
  // ① 事件级优先（ai_interval 动作，由事件引擎写入）
  const raw = pickByLevel(readEventLevelOverride());
  if (raw != null) return clampInterval(raw);

  // ② 地图级（events.json 顶层 ai 字段）
  const mapRaw = pickByLevel(readMapLevelConfig()?.interval);
  if (mapRaw != null) return clampInterval(mapRaw);

  return null;
}

/** 按当前战斗等级从配置里取值 */
function pickByLevel(cfg: AIIntervalAction | MapAIConfig["interval"] | null | undefined): number | null {
  if (!cfg) return null;
  const c = cfg as AIIntervalAction;
  const byLevel = c[currentLevel === "none" ? "idle" : currentLevel];
  if (typeof byLevel === "number" && Number.isFinite(byLevel)) return byLevel;
  if (typeof c.all === "number" && Number.isFinite(c.all)) return c.all;
  return null;
}

/** 读取当前地图的最大托管角色数（null = 用全局默认） */
export function readMapMaxManaged(): number | null {
  const cfg = readMapLevelConfig();
  const n = cfg?.maxManaged;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** 供调试：当前生效的间隔来源 */
export function debugMapInterval(): { level: CombatLevel; override: number | null; map: MapAIConfig | null } {
  return {
    level: currentLevel,
    override: readMapIntervalOverride(),
    map: readMapLevelConfig(),
  };
}
