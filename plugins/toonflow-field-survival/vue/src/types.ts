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
}

export interface Chest { id: string; x: number; y: number; opened: boolean; }
export interface Potion { id: string; x: number; y: number; heal: number; mp?: number; }
export interface Floater { id: string; text: string; x: number; y: number; life: number; }
export interface SkillSlot { name: string; power: number; cost: number; cd: number; cdLeft: number; type: "atk" | "heal" | "buff"; }
export interface ItemSlot { name: string; count: number; heal: number; mp: number; type: "hp" | "mp" | "atk"; }

export interface RoleOption {
  id: string;
  name: string;
  roleType: "player" | "ally" | "enemy" | "spectator" | "neutral";
  avatarPath?: string;
  level?: number;
  skills?: unknown[];
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
