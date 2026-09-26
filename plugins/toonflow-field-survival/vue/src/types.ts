/** ★ v4：新增 neutral（城镇中立角色，不参与战斗） */
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
  atk: number;
  level: number;
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
  def?: number;
}

export interface Chest { id: string; x: number; y: number; opened: boolean; }
export interface Potion { id: string; x: number; y: number; heal: number; }
export interface Floater { id: string; text: string; x: number; y: number; life: number; }
export interface SkillSlot { name: string; power: number; cost: number; cd: number; cdLeft: number; }
export interface ItemSlot { name: string; count: number; heal: number; }

export interface RoleOption {
  id: string;
  name: string;
  roleType: string;
  avatarPath?: string;
  avatarBgPath?: string;
  description?: string;
  hp?: number;
  level?: number;
  skills?: unknown[];
}

export interface GameResult {
  reason: "exit" | "death";
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
  r: number;
  kind: string;
  desc: string;
}

/** map-gener agent 产出的地图数据（存 t_plugin_session_data.map_data） */
export interface MapData {
  theme: string;
  narration: string;
  zones: MapZone[];
  enemy_archetypes: Array<Record<string, unknown>>;
  chests: Array<{ x: number; y: number; tier: number; loot: { exp: number; money: number; item: string } }>;
  potions: Array<{ x: number; y: number; heal: number }>;
  waves: Array<{ archetype: string; count: number; interval: number }>;
  notes: string;
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
  skills: SkillSlot[];
  items: ItemSlot[];
  skillPage: number;
  itemPage: number;
  /** map-gener agent 生成的地图（null = 未生成/不可用） */
  map: MapData | null;
  mapSource?: "agent" | "fallback" | "stored";
  /** ★ v4：区域运行时状态（城镇 + 6 野区，各自维护刷新计时） */
  regions?: RegionState[];
  /** ★ v4：城镇（安全区）建筑与中立角色清单 */
  town?: TownData | null;
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
