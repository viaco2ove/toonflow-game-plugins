export type Side = "player" | "ally" | "enemy" | "spectator" | "neutral";

export interface Entity {
  id: string;
  name: string;
  side: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  mp: number;       // 蓝
  maxMp: number;    // 最大蓝
  exp: number;      // 当前经验
  expToNext: number; // 升级所需经验
  level: number;
  atk: number;
  def: number;
  avatarPath?: string;
  facing: number;
  cooldown: number;
  alive: boolean;
  /** ★ v4：所属区域 id（enemy / neutral 使用） */
  regionId?: string;
  /** ★ v4：巢点（脱战归位目标） */
  homeX?: number;
  homeY?: number;
  /** ★ v4：敌人 AI 状态 idle | chase | return | npc */
  aiState?: string;
  wanderX?: number;
  wanderY?: number;
  wanderTimer?: number;
  bounty?: { exp?: number; money?: number };
  /** ★ 远程怪（默认 false；远程攻击范围 4 米） */
  isRanged?: boolean;
  /** ★ 受击红闪剩余毫秒（渲染时叠加红色 tint） */
  hitFlashMs?: number;
  /** ★ 动作小跳剩余毫秒（释放技能/使用物品/发动攻击时） */
  actionBobMs?: number;
}

export interface Chest { id: string; x: number; y: number; opened: boolean; }
export interface Potion { id: string; x: number; y: number; heal: number; mp?: number; }

/** ★ VFX 粒子（屏幕像素空间：x/y 都是已转换的屏幕像素） */
export interface VfxParticle {
  id: string;
  kind: "slash_arc" | "fireball" | "heal_ring" | "buff_ring" | "explosion" | "spark";
  x: number;
  y: number;
  life: number;
  total: number;
  /** 弹体类终点（fireball 飞向此点） */
  targetX?: number;
  targetY?: number;
  color?: string;
  scale?: number;
}
/** ★ 飘字（伤害 / 治疗 / 补蓝 / 增益），按 kind 决定颜色 */
export interface Floater {
  id: string;
  text: string;
  x: number;
  y: number;
  life: number;
  kind?: "damage" | "heal_hp" | "heal_mp" | "buff" | "miss";
  color?: string;
}
export interface SkillSlot {
  name: string;
  power: number;
  cost: number;
  cd: number;
  cdLeft: number;
  type: "atk" | "heal" | "buff";
  /** ★ 近战 / 远程（影响 VFX：melee=弧形斩波 / ranged=火球轨迹） */
  range: "melee" | "ranged";
}
export interface ItemSlot {
  name: string;
  count: number;
  heal: number;
  mp: number;
  type: "hp" | "mp" | "atk" | "buff" | "utility";
  /** 物资原始 matId（test_state.json） */
  matId?: string;
  /** 物资大类（weapon/armor/light/consumable/resource/tool） */
  matType?: string;
  /** 详细描述 */
  description?: string;
  /** 价格（黑市价；正式价 0 = 不可购买） */
  priceBlack?: number;
  /** 额外属性（atk/def/lightRadius/stunTurns 等） */
  stats?: Record<string, number | string | boolean>;
  /** 一次性使用 */
  singleUse?: boolean;
}

export interface RoleOption {
  id: string;
  name: string;
  roleType: "player" | "ally" | "enemy" | "spectator" | "neutral";
  avatarPath?: string;
  /** 角色初始等级（test_state.json 的 initial_level） */
  initial_level?: number;
  /** @deprecated 保留旧 level 字段兼容 */
  level?: number;
  skills?: unknown[];
}

/** ★ 野怪档案（test_state.json monsters[] 的完整数据） */
export interface MonsterArchetype {
  monsterId: string;
  name: string;
  /** 等级描述，如 "零阶｜碎屑湮体" */
  rank: string;
  monsterType: string;
  /** ★ 绑定 Rotten-Soup 怪物类型（取值见 public/entity_types.json 的 enemies[].entity_type，如 RAT / ORC / GHOST）
   *  用于把本故事怪物档案与 Rotten-Soup 权威数值/贴图表打通；缺省时按 name 兜底 */
  entity_type?: string;
  description: string;
  avatarPath?: string;
  recommendLevel: number;
  dropItems: string[];
  weakness: string[];
  feature: string;
  /** ★ 远程怪（默认 false；远程攻击范围 4 米） */
  isRanged?: boolean;
  /** 战斗数值（从 recommendLevel 推算或外部指定，可选） */
  hp?: number;
  atk?: number;
}

/** ★ 物资条目（test_state.json materials[]） */
export interface MaterialItem {
  matId: string;
  name: string;
  type: "weapon" | "armor" | "light" | "consumable" | "resource" | "tool";
  subType?: string;
  description: string;
  effect: string;
  effectType: string;
  stats: Record<string, number | string | boolean>;
  priceOfficial: number;
  priceBlack: number;
  usable: boolean;
  singleUse?: boolean;
  note?: string;
  /** 装入物品栏的数量（默认 1） */
  count?: number;
}

export interface GameResult {
  reason: string;
  exp: number;
  money: number;
  drops: string[];
  kills: number;
  survivedTicks: number;
}

export interface MapZone {
  name: string;
  x: number;
  y: number;
  r?: number;
  rx?: number;
  ry?: number;
  kind: "safe" | "danger" | "boss";
  color?: string;
}

export interface MapData {
  theme: string;
  zones: MapZone[];
  mobs?: Array<{ name: string; count: number; arch?: string }>;
  chests: Array<{ x: number; y: number; tier: number; loot: { exp: number; money: number; item: string } }>;
  potions: Array<{ x: number; y: number; heal: number }>;
}

export interface GameState {
  phase: "select" | "playing" | "over";
  version: number;
  tick: number;
  world: { w: number; h: number };
  /** v3 增强：玩家出生点（米，origin (0,0)） */
  spawn?: { x: number; y: number };
  /** v3 增强：scale 配置（来自 mulberryTown.json / map_config.json） */
  scale?: {
    meter: number;
    block_size: number;
    chunk_size_blocks: number;
    chunk_size_meters: number;
    ground_size: number;
    ground_height: number;
    x_range?: [number, number];
    z_range?: [number, number];
  };
  roles: RoleOption[];
  selections: { participants: string[]; spectators: string[]; enemies: string[] };
  entities: Entity[];
  chests: Chest[];
  potions: Potion[];
  floaters: Floater[];
  /** ★ VFX 粒子层（战斗特效） */
  vfx?: VfxParticle[];
  skills: SkillSlot[];
  items: ItemSlot[];
  skillPage: number;
  itemPage: number;
  /** map-gener agent 生成的地图（null = 未生成/不可用） */
  map: MapData | null;
  mapSource?: "agent" | "fallback" | "stored";
  /** ★ v4：区域运行时状态（城镇 + 6 野区，各自维护刷新计时） */
  regions?: unknown[];
  /** ★ v4：城镇（安全区）建筑与中立角色清单 */
  town?: unknown | null;
  exp: number;
  money: number;
  drops: string[];
  kills: number;
  events: string[];
  result: GameResult | null;
}

export interface HandleResult {
  code: number;
  message: string;
  state: GameState;
  response?: string;
  actions?: string[];
}
