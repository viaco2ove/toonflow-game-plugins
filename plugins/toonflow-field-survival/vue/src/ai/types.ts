/**
 * ai/types.ts — AI 托管系统类型定义
 * ====================================
 * 定义 AI 状态、感知数据、动作等核心数据结构。
 */

/** 可执行的 AI 动作类型 */
export type AIActionType =
  | "move"       // 移动到坐标
  | "attack"     // 攻击目标
  | "gather"     // 进入采集区域
  | "interact"   // 与 NPC 对话
  | "useSkill"   // 使用技能
  | "useItem"    // 使用物品
  | "flee"       // 撤退
  | "wait"       // 原地等待
  | "follow";    // 跟随目标

/** AI 感知目标 */
export interface AIPosition {
  x: number;
  y: number;
  name?: string;
}

/** 动作参数 */
export interface AIActionTarget {
  id?: string;
  x?: number;
  y?: number;
  name?: string;
}

/** 一个 AI 可执行的动作 */
export interface AIAction {
  type: AIActionType;
  target?: AIPosition;
  skillName?: string;
  itemName?: string;
  zoneName?: string;
  duration?: number;        // 预估执行时长 ms
  priority: number;         // 0-100，越高越优先
  context: string;          // 执行原因（供大脑理解）
}

/** 记忆条目 */
export interface AIMemory {
  timestamp: number;
  type: "combat" | "gather" | "dialog" | "loot" | "damage" | "heal" | "system" | "move";
  description: string;
  data?: Record<string, unknown>;
}

/** 紧急状态标志 */
export interface EmergencyFlags {
  lowHp: boolean;        // HP < 30%
  criticalHp: boolean;   // HP < 15%
  lowMp: boolean;       // MP < 20%
  inventoryFull: boolean;
  targetDied: boolean;
  surrounded: boolean;
  newEnemy: boolean;
}

/** AI 托管开关状态（per entity） */
export interface AIEnabledState {
  entityId: string;
  enabled: boolean;
  personality?: string;   // AI 性格描述
  goals?: string[];       // 角色目标列表
}

/** ★ 完整的 AI 运行时状态（per entity） */
export interface AIState {
  /** 是否启用 AI 托管 */
  enabled: boolean;
  /** 当前模式 */
  mode: "idle" | "brain" | "emergency";
  /** 上次大脑决策时间戳 */
  lastBrainTick: number;
  /** 大脑决策间隔 ms（默认 5000） */
  brainInterval: number;
  /** 当前目标描述 */
  goal: string;
  /** 短期记忆（最近 10 条） */
  memory: AIMemory[];
  /** 当前正在执行的动作 */
  currentAction: AIAction | null;
  /** 动作队列 */
  actionQueue: AIAction[];
  /** 紧急状态标志 */
  emergency: EmergencyFlags;
  /** 性格设定 */
  personality: string;
  /** AI 角色名称 */
  characterName: string;
  /** AI 角色等级 */
  characterLevel: number;
  /** 是否正在冷却中 */
  cooldownUntil: number;
  /** 角色所在地图 */
  mapName: string;
  /** ★ v6：本次决策的触发原因（阶段一写入，阶段二消费后清空） */
  pendingTriggerReason?: string;
  /** ★ v6：本次决策的触发优先级 */
  pendingTriggerPriority?: "P0" | "P1" | "P2";
}

/** 自身感知数据 */
export interface AISelfPerception {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  hpPercent: number;
  mp: number;
  maxMp: number;
  mpPercent: number;
  level: number;
  atk: number;
  def: number;
  position: AIPosition;
  mapName: string;
  inventory: { name: string; count: number }[];
  skills: { name: string; cost: number; cdLeft: number }[];
  buffs: string[];
}

/** 周围实体感知 */
export interface AINearbyPerception {
  enemies: {
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    distance: number;
    position: AIPosition;
  }[];
  allies: {
    id: string;
    name: string;
    hp: number;
    distance: number;
    position: AIPosition;
  }[];
  npcs: {
    id: string;
    name: string;
    distance: number;
    position: AIPosition;
  }[];
  loot: {
    name: string;
    distance: number;
    position: AIPosition;
  }[];
}

/** 资源点感知（来自 eventZones） */
export interface AIResourcePerception {
  type: "herb" | "fish" | "wood" | "other";
  zoneName: string;
  position: AIPosition;
  distance: number;
  available: boolean;
}

/** 世界感知数据 */
export interface AIWorldPerception {
  currentMap: string;
  nearbyMaps: string[];
  timeOfDay: string;
  /** ★ 玩家战斗等级（宿主权威，AI 频率判据） */
  playerCombatLevel: AICombatLevel;
  /** ★ 距离上次交战多少秒（宿主 tick 派生） */
  secondsSinceCombat: number;
}

/** ★ 玩家战斗等级（宿主 entry.ts 维护，AI 侧只读） */
export type AICombatLevel = "none" | "skirmish" | "engaged";

/** 完整的感知数据 */
export interface AIPerception {
  self: AISelfPerception;
  nearby: AINearbyPerception;
  resources: AIResourcePerception[];
  world: AIWorldPerception;
}

/** LLM 决策结果 */
export interface LLMDecision {
  reasoning: string;
  goal: string;
  action: AIAction;
}

/** AI 事件（触发大脑决策） */
export interface AIGameEvent {
  type: "hp_change" | "mp_empty" | "target_death" | "new_map" | "inventory_change" | "heartbeat" | "player_command" | "enemy_spotted" | "ally_need_help";
  priority: "P0" | "P1" | "P2";
  data?: Record<string, unknown>;
  timestamp: number;
}

/** 大脑配置 */
export interface BrainConfig {
  /** 最小决策间隔 ms */
  minInterval: number;
  /** 最大决策间隔 ms */
  maxInterval: number;
  /** 自适应间隔开关 */
  adaptiveEnabled: boolean;
  /** 最大托管角色数 */
  maxManagedCount: number;
}

/* ============================================================
   ★ 触发频率常量（见 md/curr_design/.../ai托管.agent.触发频率.md）
   判据是「玩家战斗状态」而不是「AI 自己身边有敌人」——
   原因：AI 感知半径只有 13m，敌人在 20m 外时 AI 看不到玩家被围，
   按自己的敌人判会让「玩家挨打、队友反应慢」。
   ============================================================ */

/** 交战中（玩家刚参与过伤害，30s 内） */
export const COMBAT_INTERVAL_ENGAGED = 5000;
/** 遭遇战（交战中但已过保持窗口，附近仍有敌人） */
export const COMBAT_INTERVAL_SKIRMISH = 10000;
/** 非战斗（野外） */
export const IDLE_INTERVAL_BASE = 20000;
/** 非战斗但附近有资源点（略快，让 AI 去找东西） */
export const IDLE_INTERVAL_WITH_RESOURCES = 15000;
/** 城镇 / 安全区（最慢，AI 基本待命） */
export const TOWN_INTERVAL_BASE = 30000;

/** 地图集可覆盖的绝对下界（战斗态允许下探到此，防止决策堆积） */
export const HARD_FLOOR_INTERVAL = 3000;
/** 地图集可覆盖的绝对上界 */
export const HARD_CEIL_INTERVAL = 60000;

/** 默认大脑配置
 *  ★ maxInterval = 20000（非战斗态的实际间隔上限）。
 *    这些值现在可以在「系统 → AI」页签里调，落库到 t_plugin_session_data，
 *    运行时配置见 ai/aiConfig.ts（DEFAULT_AI_SETTINGS 是权威副本）。
 *    20s 是「token 成本」与「AI 存在感」的折中：
 *      15s → 5 角色 = 20 次/分（偏吵，且非战斗时决策内容重复度高）
 *      20s → 5 角色 = 15 次/分（当前默认）
 *      30s → 5 角色 = 10 次/分（省得多，但玩家容易察觉 AI「迟钝」） */
export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  minInterval: 5000,
  maxInterval: 20000,
  adaptiveEnabled: true,
  maxManagedCount: 5,
};

/** 默认 AI 状态 */
export function createDefaultAIState(entityId: string): AIState {
  return {
    enabled: false,
    mode: "idle",
    lastBrainTick: 0,
    brainInterval: 5000,
    goal: "待命",
    memory: [],
    currentAction: null,
    actionQueue: [],
    emergency: {
      lowHp: false,
      criticalHp: false,
      lowMp: false,
      inventoryFull: false,
      targetDied: false,
      surrounded: false,
      newEnemy: false,
    },
    personality: "普通",
    characterName: "",
    characterLevel: 1,
    cooldownUntil: 0,
    mapName: "",
  };
}
