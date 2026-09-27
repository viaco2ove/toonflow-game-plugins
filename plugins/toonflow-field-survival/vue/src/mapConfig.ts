/**
 * mapConfig.ts
 * mulberryTown.json 地图数据加载器（对应 25d_ai_game 的 config/MapConfig.gd）
 *
 * 真实正本结构（来自 25d_ai_game 提供的 map_config.json 模板）：
 * {
 *   "size": [3000, 3000],
 *   "origin": [0, 0],
 *   "scale_meter": 1,
 *   "x_range": [-1500, 1500],
 *   "z_range": [-1500, 1500],
 *   "x_range_def_view": [-15, 15],
 *   "z_range_def_view": [-15, 15],
 *   "height_range": [-1, 8],
 *   "default_zoom": 20,
 *   "min_zoom": 10,
 *   "baseline": -10,
 *   "depth_underground_land": 5,
 *   "underground_x_range": [-150, 150],
 *   "underground_y_range": [-150, 150],
 *   "max_zoom": 30,
 *
 *   // 业务数据（不是 MapConfig.gd 的字段，是 mulberryTown.json 独有的运行时数据）
 *   "theme": "野外·清晨",
 *   "narration": "...",
 *   "decorations": [ { "id": "t1", "kind": "tree", "x": 50, "y": -200, "variant": 0 }, ... ],
 *   "chests":      [ { "id": "ch1", "x": 200, "y": 100, "tier": 1, "loot": {...} }, ... ],
 *   "potions":     [ { "id": "p1", "x": -200, "y": 300, "heal": 40 }, ... ],
 *   "zones":       [ { "name": "营地", "x": 0, "y": 0, "r": 30, "kind": "safe", "desc": "..." }, ... ],
 *   "chunks":      [ { "cx": 0, "cz": 0, "blocks": [..], "destroyed": [...] }, ... ],
 *   "notes": "..."
 * }
 */

import { TerrainScaleConfig, DEFAULT_SCALE } from "./terrainScale";
import { assetUrl } from "./assets";

/* ============================================================
   数据类型
   ============================================================ */

export type DecorationKind =
  | "tree" | "dead_tree"
  | "bush" | "mushroom" | "flower"
  | "water" | "rock" | "pot"
  | "building" | "npc" | "fence" | "furniture" | "farm";

export interface MapDecoration {
  id: string;
  kind: DecorationKind;
  /** 世界坐标 x（米） */
  x: number;
  /** 世界坐标 y = 世界 z（米） */
  y: number;
  variant?: number;
}

export interface MapChest {
  id: string;
  x: number;
  y: number;
  tier: number;
  loot?: { exp?: number; money?: number; item?: string };
}
export interface MapPotion {
  id: string;
  x: number;
  y: number;
  heal: number;
}
export interface MapZone {
  name: string;
  x: number;
  y: number;
  /** 圆形区域半径（米），rx/ry 不设置时使用 r */
  r?: number;
  /** 矩形区域半长宽（米），优先于 r */
  rx?: number;
  ry?: number;
  kind: string;
  desc?: string;
  /** 怪物刷新时间（秒），0=不刷新 */
  refresh_rate?: number;
  /** 该区域刷新的怪物类型列表 */
  mob_types?: string[];
}

/** 地图上的怪物对象（从 Tiled Actors 层提取） */
export interface MapMob {
  id: number;
  name: string;
  x: number;
  y: number;
  /** 瓦片 gid */
  gid?: number;
  /** 怪物类型（如 GOBLIN） */
  entity_type: string;
}

/**
 * ★ 野怪档案表（战斗数值单一数据源）
 *
 * 这张表同时是 Tiled 地图解析的「野怪白名单」：
 *   - 表内 type  → normalizeTiledMap 提取为 MapMob，进图后由 App 生成 mapmob_* 敌人；
 *   - 表外 type  → 若也不在 NON_MOB_ENTITY_TYPES，解析时 console.warn（不静默丢弃）。
 *
 * 修复点：此前只认 GOBLIN，mulberryForest 里的 ORC / mulberryGraveyard 里的 LICH、
 * GHOST 等会被静默丢弃 → 进图后这些野怪不存在。
 */
export const MOB_ARCHETYPES: Record<string, { name: string; hp: number; atk: number }> = {
  GOBLIN:      { name: "哥布林斥候", hp: 30,  atk: 6 },
  LOOT_GOBLIN: { name: "拾荒哥布林", hp: 40,  atk: 8 },
  ORC:         { name: "半兽人",     hp: 80,  atk: 12 },
  ORC_BOSS:    { name: "兽人首领",   hp: 200, atk: 18 },
  SKELETON:    { name: "骷髅兵",     hp: 50,  atk: 12 },
  ZOMBIE:      { name: "僵尸",       hp: 60,  atk: 10 },
  GHOST:       { name: "幽灵",       hp: 35,  atk: 9 },
  LICH:        { name: "巫妖",       hp: 160, atk: 20 },
  WOLF:        { name: "巨狼",       hp: 60,  atk: 10 },
  BOAR:        { name: "野猪",       hp: 50,  atk: 8 },
  SNAKE:       { name: "毒蛇",       hp: 25,  atk: 8 },
  BAT:         { name: "蝙蝠",       hp: 20,  atk: 5 },
};

/** 野怪白名单（由 MOB_ARCHETYPES 派生，避免两处维护不一致） */
export const MOB_ENTITY_TYPES: Set<string> = new Set(Object.keys(MOB_ARCHETYPES));

/** 已知的非怪物类型（玩家/ NPC / 出口机关 / 掉落物 / 尸体等）：未进白名单也不告警 */
export const NON_MOB_ENTITY_TYPES: Set<string> = new Set([
  "PLAYER",
  "NPC",
  "LEVEL_TRANSITION",
  "LADDER",
  "DOOR",
  "LOCKED_DOOR",
  "CHEST",
  "KEY",
  "GOLD",
  "ITEM",
  "TREE",
  "ROCK",
  "WALL",
  "ZOMBIE_CORPSE",
  "SKELETON_CORPSE",
  "CORPSE",
]);

/** 单个 chunk 的方块数据（可选，不存就视为默认全泥土块） */
export interface MapChunk {
  cx: number;
  cz: number;
  /** 块的 1D 数组（按 x * blocks_per_chunk + z 索引） */
  blocks?: number[];
  destroyed?: Array<{ x: number; y: number; z?: number }>;
}

/**
 * mulberryTown.json 的完整 schema（核心 + 运行时数据）
 *
 * 字段命名沿用 25d_ai_game 的 x/z（不是 x/y），前端代码内部统一处理。
 * 几乎所有坐标都是「米」，不是像素。
 */
export interface MapConfig {
  // — 比例尺 / 视距（与 map_config.json 完全一致） —
  size: [number, number];
  origin: [number, number];
  scale_meter: number;
  x_range: [number, number];
  z_range: [number, number];
  x_range_def_view: [number, number];
  z_range_def_view: [number, number];
  height_range: [number, number];
  default_zoom: number;
  min_zoom: number;
  max_zoom: number;
  baseline: number;
  depth_underground_land: number;
  underground_x_range: [number, number];
  underground_y_range: [number, number];

  // — 运行时数据（mulberryTown.json 独有） —
  name: string;
  theme: string;
  narration: string;
  notes?: string;
  decorations: MapDecoration[];
  chests: MapChest[];
  potions: MapPotion[];
  zones: MapZone[];
  chunks?: MapChunk[];
  /** ★ Tiled 格式时玩家出生点（mulberryTown 自己的 PLAYER 对象） */
  playerSpawn?: { x: number; y: number };
  /** ★ Tiled Actors 层的怪物列表（如 GOBLIN） */
  mobs?: MapMob[];
}

/* ============================================================
   默认（保底）配置 —— 等同于用户提供的 map_config.json 模板
   ============================================================ */

export function fallbackMapConfig(): MapConfig {
  return {
    // 比例尺 / 视距
    size: [3000, 3000],
    origin: [0, 0],
    scale_meter: 1,
    x_range: [-1500, 1500],
    z_range: [-1500, 1500],
    x_range_def_view: [-15, 15],
    z_range_def_view: [-15, 15],
    height_range: [-1, 8],
    default_zoom: 20,
    min_zoom: 10,
    max_zoom: 100,
    baseline: -10,
    depth_underground_land: 5,
    underground_x_range: [-150, 150],
    underground_y_range: [-150, 150],

    // 运行时数据
    name: "overworld",
    theme: "野外·清晨",
    narration: "薄雾笼罩着这片荒野，远处传来低沉的嘶吼。收拢心神，活下去。",
    notes: "fallback（未找到 mulberryTown.json 时使用）",
    decorations: [
      { id: "t01", kind: "tree", x: 50,    y: -200, variant: 0 },
      { id: "t02", kind: "tree", x: -120,  y:  80,  variant: 1 },
      { id: "t03", kind: "tree", x: 200,   y:  150, variant: 0 },
      { id: "t04", kind: "tree", x: -60,   y:  220, variant: 1 },
      { id: "t05", kind: "tree", x:  90,   y: -100, variant: 0 },
      { id: "w01", kind: "water", x: -200, y: -50 },
      { id: "b01", kind: "bush", x:  30,   y:  170 },
      { id: "b02", kind: "bush", x: -80,   y:  -20 },
      { id: "m01", kind: "mushroom", x:  10,   y:  100 },
      { id: "f01", kind: "flower", x:  60,   y:  -40 },
    ],
    chests: [
      { id: "ch1", x:  100, y:  150, tier: 1, loot: { exp: 15, money: 12, item: "干粮" } },
      { id: "ch2", x: -200, y:  100, tier: 2, loot: { exp: 20, money: 18, item: "急救包" } },
    ],
    potions: [
      { id: "p1", x:  70,  y: -120, heal: 40 },
      { id: "p2", x: -150, y:  50,  heal: 40 },
    ],
    zones: [
      { name: "城镇", x:   0,   y:   0,   r: 30, kind: "safe",   desc: "玩家出生的安全区，无怪物刷新", refresh_rate: 0 },
      { name: "荒地", x: 300,   y: 200,   r: 80, kind: "danger", desc: "野兽出没，每45秒刷新", refresh_rate: 45, mob_types: ["wolf", "boar"] },
      { name: "废墟", x:-400,   y:-300,   r: 60, kind: "loot",   desc: "可能残留物资", refresh_rate: 60, mob_types: ["skeleton"] },
    ],
    chunks: [],
  };
}

/** ★ 最近一次 normalize 的 Tiled 原始 JSON（供 mapBake 烘焙用） */
let tiledRawCache: Record<string, unknown> | null = null;
export function getTiledRaw(): Record<string, unknown> | null {
  return tiledRawCache;
}

/* ============================================================
   Tiled 格式 → MapConfig（mulberryTown / Forest / Lair 等）
   与 Rotten-Soup 的 createMapFromJSON 等价：
   - tilelayer → 保留原始数据（mapBake 一次性烘焙，逐格 decoration 已废弃）
   - objectgroup：PLAYER → 玩家出生点；NPC/LEVEL_TRANSITION/LADDER → decorations
   - 城镇中心 = safe zone
   ============================================================ */
function normalizeTiledMap(obj: Record<string, unknown>, levelName?: string): MapConfig {
  const f = fallbackMapConfig();
  const W = num(obj.width, 43);
  const H = num(obj.height, 56);
  const decorations: MapDecoration[] = [];
  const mobs: MapMob[] = [];
  let decIdx = 0;
  let playerSpawn: { x: number; y: number } | null = null;

  // ★ 性能：tilelayer 不再逐格生成 decoration（上万 drawImage/帧 = 卡顿主因），
  //   保留原始 JSON 供 mapBake 一次性烘焙（见 App.vue render()）
  tiledRawCache = obj;

  for (const layer of obj.layers as any[]) {
    if (layer?.type === "tilelayer" && Array.isArray(layer.data)) {
      // tilelayer → 全部走烘焙，不生成逐格 decoration
    } else if (layer?.type === "objectgroup" && Array.isArray(layer.objects)) {
      // 每个 object → entity（只处理 PLAYER，其它作为 NPC 装饰）
      for (const obj of layer.objects) {
        const props = Array.isArray(obj.properties)
          ? Object.fromEntries(obj.properties.map((p: any) => [p.name, p.value]))
          : {};
        if (props.entity_type === "PLAYER") {
          // 玩家出生点：Tiled 对象 y 是 1-indexed，需要减 1
          playerSpawn = {
            x: obj.x / 32 - W / 2,
            y: obj.y / 32 - 1 - H / 2,
          };
        } else if (props.entity_type === "NPC") {
          // NPC → 装饰物（kind=npc），App.vue 已有 NPC 渲染逻辑
          const npcName = String(props.name || obj.name || "NPC");
          const wx = obj.x / 32 - W / 2;
          const wz = obj.y / 32 - 1 - H / 2;
          decorations.push({
            id: `n_${decIdx++}`,
            kind: "npc",
            x: wx,
            y: wz,
            name: npcName,
            variant: obj.gid ? obj.gid - 1 : 0,
            // ★ NPC 行为数据（渲染层做游走动画用）
            wanders: props.wanders === true,
            seed: (decIdx * 7919) % 1000,   // 每个 NPC 独立相位
          } as any);
        } else if (MOB_ENTITY_TYPES.has(String(props.entity_type))) {
          // ★ 怪物 → 记录位置和类型，App.vue switchLevel 时加载到 entities
          //   白名单见 MOB_ENTITY_TYPES（含 ORC / LICH / GHOST / LOOT_GOBLIN），
          //   此前只认 GOBLIN，ORC 等类型会被静默丢弃 → 进图后看不到对应野怪。
          const wx = obj.x / 32 - W / 2;
          const wz = obj.y / 32 - 1 - H / 2;
          const mobName = String(props.name || obj.name || "野怪");
          mobs.push({
            id: obj.id,
            name: mobName,
            x: wx,
            y: wz,
            gid: obj.gid,
            entity_type: props.entity_type,
          });
        } else if (props.entity_type === "LEVEL_TRANSITION" || props.entity_type === "LADDER") {
          // ★ 出口/传送点 → kind=portal（App.vue 画箭头提示"从这里出去"）
          const wx = obj.x / 32 - W / 2;
          const wz = obj.y / 32 - 1 - H / 2;
          decorations.push({
            id: `p_${decIdx++}`,
            kind: "portal" as any,
            x: wx,
            y: wz,
            name: String(props.portalID || props.entity_type),
          } as any);
        } else if (!NON_MOB_ENTITY_TYPES.has(String(props.entity_type))) {
          // ★ 未识别类型不得静默丢弃：至少告警，便于新增地图时及时补进白名单
          console.warn(
            `[mapConfig] 未识别的 entity_type，已跳过：entity_type=${String(props.entity_type)}` +
              ` name=${obj.name ?? ""} id=${obj.id}（如需作为野怪，请加入 MOB_ARCHETYPES）`,
          );
        }
      }
    }
  }

  // 默认玩家出生点：地图中心
  if (!playerSpawn) playerSpawn = { x: 0, y: 0 };

  // ★ 城镇 safe zone：只给「城镇类」关卡生成。
  //   此前对每张 Tiled 图都无条件生成中央城镇 safe 区，导致森林/墓地/地牢里玩家
  //   进图即落在 safe 区（→ 兜底刷怪被抑制、野怪不追人）。野外/地牢地图 zones 为空。
  const isTownLevel = !levelName || /town|overworld/i.test(levelName);
  const zones: MapZone[] = isTownLevel
    ? [
        {
          name: "城镇",
          x: 0,
          y: -2,
          rx: Math.min(W / 2, 15),
          ry: Math.min(H / 2, 17),
          kind: "safe",
          desc: "玩家出生点（mulberryTown）",
          refresh_rate: 0,
          mob_types: [],
        },
      ]
    : [];

  return {
    ...f,
    name: String(obj.name ?? "overworld"),
    // ★ 按地图实际大小（不强制 ±1500 大地图）
    size: [W, H],
    x_range: [-W / 2, W / 2],
    z_range: [-H / 2, H / 2],
    x_range_def_view: [-W / 2, W / 2],
    z_range_def_view: [-H / 2, H / 2],
    decorations,
    zones,
    chunks: [],
    playerSpawn: playerSpawn ?? undefined,
    mobs,
  };
}

/* ============================================================
   把 MapConfig 应用到 TerrainScaleConfig
   ============================================================ */

export function makeScaleFromMap(map: MapConfig): TerrainScaleConfig {
  return new TerrainScaleConfig({
    size:                   map.size,
    origin:                 map.origin,
    scale_meter:            map.scale_meter,
    x_range:                map.x_range,
    z_range:                map.z_range,
    def_view: {
      x: [...map.x_range_def_view] as [number, number],
      z: [...map.z_range_def_view] as [number, number],
    },
    default_zoom:           map.default_zoom,
    min_zoom:               map.min_zoom,
    max_zoom:               map.max_zoom,
    height_range:           map.height_range,
    baseline:               map.baseline,
    underground_depth:      map.depth_underground_land,
    underground_x_range:    [...map.underground_x_range] as [number, number],
    underground_z_range:    [...map.underground_y_range] as [number, number],
  });
}

/* ============================================================
   异步加载 mulberryTown.json（与 map_config.json 完全一致 + 运行时数据）
   ============================================================ */

export const OVERWORLD_URLS = [
  assetUrl("maps/mulberryTown.json"),
  "/maps/mulberryTown.json",
  "./maps/mulberryTown.json",
];

export async function loadMapConfig(): Promise<MapConfig> {
  for (const url of OVERWORLD_URLS) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      const n = normalizeMapConfig(d, "Mulberry Town");
      if (n) return n;
    } catch { /* try next */ }
  }
  return fallbackMapConfig();
}

/**
 * ★ 关卡表：portalID（地图 JSON 里出口对象的 portalID 属性）→ 文件名
 *
 * 维护须知：地图里每个出口的 portalID 都必须能在这里（或命名规则）解析出文件名，
 * 否则走到该出口时 loadLevelByName 返回 null，switchLevel 只打一条 console.warn，
 * 外部表现就是"走到出口不切图"。新增地图时请在此登记，或保证名字符合
 * "Foo Bar 2" → "fooBar2" 的命名规则。
 *
 * Rotten-Soup 对照：src/assets/js/game/Game.js changeLevels() 用 levels[mapID] 取图；
 * 地牢（LADDER + createDungeon=true）原版是 createDungeonFloors() 运行时随机生成 5 层，
 * 本项目用预生成的静态 JSON 等价替代（mulberryDungeon1..5 / forestDungeon1..5）：
 *   城镇/森林的下行梯 portalID = "Mulberry Dungeon" / "Forest Dungeon"（进第 1 层）
 *   第 2..4 层的下行梯 portalID = "Mulberry Dungeon 2" .. "4"
 *   第 5 层的 LEVEL_TRANSITION 回到起点地图（"Mulberry Town" / "Mulberry Forest"）
 */
const LEVEL_FILES: Record<string, string> = {
  "Mulberry Town": "mulberryTown",
  "Mulberry Forest": "mulberryForest",
  "Mulberry Graveyard": "mulberryGraveyard",
  "Lich Lair": "lichLair",
  "Loot Goblin Lair": "lootGoblinLair",
  "Mulberry Dungeon": "mulberryDungeon1",
  "Mulberry Dungeon 2": "mulberryDungeon2",
  "Mulberry Dungeon 3": "mulberryDungeon3",
  "Mulberry Dungeon 4": "mulberryDungeon4",
  "Mulberry Dungeon 5": "mulberryDungeon5",
  "Forest Dungeon": "forestDungeon1",
  "Forest Dungeon 2": "forestDungeon2",
  "Forest Dungeon 3": "forestDungeon3",
  "Forest Dungeon 4": "forestDungeon4",
  "Forest Dungeon 5": "forestDungeon5",
};

/**
 * 关卡名 → 文件名："Mulberry Graveyard" → "mulberryGraveyard"。
 * 先查 LEVEL_FILES（权威表），查不到再按命名规则推导——保证新地图只要命名一致即可加载，
 * 不再出现"表里没登记就静默不切图"的隐性失效。
 */
export function levelNameToFile(levelName: string): string {
  const key = String(levelName ?? "").trim();
  if (!key) return "";
  const hit = LEVEL_FILES[key];
  if (hit) return hit;
  const slug = key
    .replace(/[^0-9A-Za-z]+(.)/g, (_m, c: string) => c.toUpperCase())
    .replace(/[^0-9A-Za-z]/g, "");
  if (!slug) return "";
  return slug.charAt(0).toLowerCase() + slug.slice(1);
}

/**
 * ★ 关卡切换：按名字加载对应 Tiled 地图（Rotten-Soup 的 changeLevels 等价）
 *   "Mulberry Forest" → maps/mulberryForest.json（顺带尝试 assetUrl/绝对/相对三个前缀）
 */
export async function loadLevelByName(levelName: string): Promise<MapConfig | null> {
  const file = levelNameToFile(levelName);
  if (!file) return null;
  for (const prefix of [assetUrl("maps/"), "/maps/", "./maps/"]) {
    try {
      const r = await fetch(prefix + file + ".json");
      if (!r.ok) continue;
      const d = await r.json();
      const n = normalizeMapConfig(d, levelName);
      if (n) return n;
    } catch { /* try next */ }
  }
  // 走到这里说明关卡名无法映射到任何可用地图：明确报出期望文件名，避免无声失效
  console.warn(
    `[field-survival] 关卡地图缺失：portalID="${levelName}" → 期望 maps/${file}.json` +
      `（请确认文件已放入 ui/maps 与 vue/public/maps）`,
  );
  return null;
}

/**
 * 把任意 JSON 归一化成 MapConfig（兼容旧 Tiled 格式：检测到 layers/tilewidth 就走兜底）
 */
export function normalizeMapConfig(raw: unknown, levelName?: string): MapConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // ★ Tiled 格式（mulberryTown / mulberryForest 等）：把所有 tile 转成 decorations；
  //   levelName 决定是否生成城镇 safe zone（野外/地牢图不生成）
  if (Array.isArray(obj.layers) && (obj.tilewidth || obj.tileheight)) {
    return normalizeTiledMap(obj, levelName);
  }
  const f = fallbackMapConfig();
  return {
    size: arr2(obj.size, f.size),
    origin: arr2(obj.origin, f.origin),
    scale_meter: num(obj.scale_meter, f.scale_meter),
    x_range: arr2(obj.x_range, f.x_range),
    z_range: arr2(obj.z_range, f.z_range),
    x_range_def_view: arr2(obj.x_range_def_view, f.x_range_def_view),
    z_range_def_view: arr2(obj.z_range_def_view, f.z_range_def_view),
    height_range: arr2(obj.height_range, f.height_range),
    default_zoom: num(obj.default_zoom, f.default_zoom),
    min_zoom: num(obj.min_zoom, f.min_zoom),
    max_zoom: num(obj.max_zoom, f.max_zoom),
    baseline: num(obj.baseline, f.baseline),
    depth_underground_land: num(obj.depth_underground_land, f.depth_underground_land),
    underground_x_range: arr2(obj.underground_x_range, f.underground_x_range),
    underground_y_range: arr2(obj.underground_y_range, f.underground_y_range),

    name: str(obj.name, f.name),
    theme: str(obj.theme, f.theme),
    narration: str(obj.narration, f.narration),
    notes: obj.notes != null ? String(obj.notes) : undefined,
    decorations: Array.isArray(obj.decorations)
      ? (obj.decorations as unknown[])
          // 过滤掉 "_note" 注释对象（保留为可读注释用，但不算装饰物）
          .filter((d: any) => d && (d.id || d.kind) && d.x != null && d.y != null)
          .map((d: any, i: number) => ({
            id: String(d?.id ?? `dec_${i}`),
            kind: String(d?.kind ?? "tree") as DecorationKind,
            x: num(d?.x, 0),
            y: num(d?.y, 0),
            variant: d?.variant != null ? num(d.variant, 0) : undefined,
          }))
      : [],
    chests: Array.isArray(obj.chests)
      ? (obj.chests as unknown[])
          .filter((c: any) => c && c.id && c.x != null && c.y != null)
          .map((c: any, i: number) => ({
            id: String(c?.id ?? `ch_${i}`),
            x: num(c?.x, 0),
            y: num(c?.y, 0),
            tier: num(c?.tier, 1),
            loot: c?.loot
              ? {
                  exp: c.loot.exp != null ? num(c.loot.exp, 0) : undefined,
                  money: c.loot.money != null ? num(c.loot.money, 0) : undefined,
                  item: c.loot.item != null ? String(c.loot.item) : undefined,
                }
              : undefined,
          }))
      : [],
    potions: Array.isArray(obj.potions)
      ? (obj.potions as unknown[])
          .filter((p: any) => p && p.id && p.x != null && p.y != null)
          .map((p: any, i: number) => ({
            id: String(p?.id ?? `p_${i}`),
            x: num(p?.x, 0),
            y: num(p?.y, 0),
            heal: num(p?.heal, 40),
          }))
      : [],
    zones: Array.isArray(obj.zones)
      ? (obj.zones as unknown[]).map((z: any) => ({
          name: str(z?.name, ""),
          x: num(z?.x, 0),
          y: num(z?.y, 0),
          r: z?.r != null ? num(z.r, 30) : undefined,
          rx: z?.rx != null ? num(z.rx, undefined) : undefined,
          ry: z?.ry != null ? num(z.ry, undefined) : undefined,
          kind: str(z?.kind, "safe"),
          desc: z?.desc != null ? String(z.desc) : undefined,
          refresh_rate: z?.refresh_rate != null ? num(z.refresh_rate, 0) : undefined,
          mob_types: Array.isArray(z?.mob_types) ? z.mob_types.map(String) : undefined,
        }))
      : [],
    chunks: Array.isArray(obj.chunks)
      ? (obj.chunks as unknown[]).map((c: any) => ({
          cx: num(c?.cx, 0),
          cz: num(c?.cz, 0),
          blocks: Array.isArray(c?.blocks) ? c.blocks.map(num) : undefined,
          destroyed: Array.isArray(c?.destroyed)
            ? c.destroyed.map((d: any) => ({ x: num(d?.x, 0), y: num(d?.y, 0), z: num(d?.z, 0) }))
            : undefined,
        }))
      : undefined,
  };
}

// ────── helpers ──────
function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : v == null ? d : String(v);
}
function arr2(v: unknown, d: [number, number]): [number, number] {
  if (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))) {
    return [Number(v[0]), Number(v[1])];
  }
  return d;
}
