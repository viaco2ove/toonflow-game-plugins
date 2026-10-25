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
import { getStoryMapRaw, getStoryFirstMap, getStoryLevelNames } from "./storyMap";

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
  /** ★ 来源 Tiled 对象 id（kind="npc" 用）：实体层已生成 mapnpc_<id> 时装饰层跳过，防双重绘制 */
  npcObjId?: number;
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
  /** 野怪等级（从 Tiled 对象属性读取；地图未标注则为 1） */
  level: number;
  /** ★ 阵营 neutral/hostile/friendly；地图对象未标注 camp 时按 entity_type 推断（白名单内 → hostile） */
  camp: "neutral" | "hostile" | "friendly";
  /** ★ 姓名（如「低阶湮物」）：头顶显示为「哥布林(低阶湮物)」；未标注则只显示类型中文名 */
  full_name?: string;
  /** ★ 击杀赏金（Tiled 对象属性 bounty(JSON)，如 {"exp":60,"money":40}） */
  bounty?: { exp?: number; money?: number };
  /** ★ 击杀掉落表（Tiled 对象属性 dropTable(JSON)，如 [{"name":"暗核","w":100}]）。
   *  dropKillChest 优先用它，缺省落回全局 DEFAULT_DROP_TABLE。 */
  dropTable?: Array<{ name: string; w: number }>;
}

/**
 * ★ 地图上的中立 NPC（从 Tiled Actors 层提取 entity_type=NPC 的对象）。
 *   与装饰物（kind="npc"，只用于头像 sprite）不同——npcs[] 用于生成 side=neutral 实体，
 *   让玩家走近时能触发"💬 聊天"按钮 + 头顶完整显示中文名。
 */
export interface MapNpc {
  id: number;
  /** Tiled 对象名（Mayor Leonard / NPC / Bar 等） */
  name: string;
  /** 显示用名字：Tiled.full_name 优先，其次中文翻译/对象名 */
  displayName: string;
  x: number;
  y: number;
  /** 瓦片 gid（用于 sprite 选 frame） */
  gid?: number;
  /** 是否 wanders（绕 home 小范围漂移） */
  wanders: boolean;
  /** dialog key（如 BARTENDER / DWARF_BILI / MAYOR_LEONARD）— 留扩展位 */
  dialog?: string;
  /** ★ 未具名 NPC（Tiled 里只有 entity_type=NPC，无 full_name/name/dialog，含农场动物）：
   *  仍会生成可对话实体，但头顶不画名字（避免刷屏），聊天面板里显示「镇民#<id>」 */
  unnamed?: boolean;
  /** ★ 可拾取物（Tiled 对象带 pickup_item 属性）：靠近触发「是否拾取」提示，
   *  确认后发放对应物品（走 evGiveItem → sys_item_add）并令该实体 alive=false 消失。
   *  地图每次进入都会重新注入（注入逻辑忽略已死实体，但切图会清掉旧图 mapnpc_*，故会刷新）。 */
  pickupItem?: string;
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
export const MOB_ARCHETYPES: Record<string, { name: string; hp: number; atk: number; level: number }> = {
  // ★ 黑塔伪人系（map_design/黑塔：从超忆症开始成神）
  HT_FAKE_STUDENT: { name: "伪人·学生", hp: 45,  atk: 9,  level: 1 },
  HT_FAKE_PAW:     { name: "伪人·爪牙", hp: 75,  atk: 14, level: 3 },
  HT_FAKE_ELITE:   { name: "伪人·精英", hp: 150, atk: 20, level: 5 },
  HT_FAKE_TEACHER: { name: "伪人·教师", hp: 110, atk: 16, level: 4 },
  HT_FAKE_HOST:    { name: "伪人·宿主", hp: 260, atk: 26, level: 7 },
  HT_FAKE_MR:      { name: "先生",     hp: 420, atk: 34, level: 9 },
  RAT:         { name: "老鼠",       hp: 12,  atk: 4,  level: 1 },
  GOBLIN:      { name: "哥布林",     hp: 30,  atk: 6,  level: 1 },
  LOOT_GOBLIN: { name: "拾荒哥布林", hp: 40,  atk: 8,  level: 2 },
  ORC:         { name: "半兽人",     hp: 80,  atk: 12, level: 3 },
  ORC_BOSS:    { name: "兽人首领",   hp: 200, atk: 18, level: 8 },
  SKELETON:    { name: "骷髅兵",     hp: 50,  atk: 12, level: 2 },
  ZOMBIE:      { name: "僵尸",       hp: 60,  atk: 10, level: 1 },
  IMP:         { name: "小恶魔",     hp: 30,  atk: 7,  level: 2 },
  GHOST:       { name: "幽灵",       hp: 35,  atk: 9,  level: 3 },
  LICH:        { name: "巫妖",       hp: 160, atk: 20, level: 7 },
  WOLF:        { name: "巨狼",       hp: 60,  atk: 10, level: 2 },
  BOAR:        { name: "野猪",       hp: 50,  atk: 8,  level: 1 },
  SNAKE:       { name: "毒蛇",       hp: 25,  atk: 8,  level: 2 },
  BAT:         { name: "蝙蝠",       hp: 20,  atk: 5,  level: 1 },
  WILD_GOAT:   { name: "山羊",       hp: 45,  atk: 9,  level: 2 },
};

/**
 * ★ entity_type → 头顶显示中文名（与 entity_types.json 的 name_zh 同口径）。
 *   头顶规则：无 full_name 显示「哥布林」；有 full_name 显示「哥布林(低阶湮物)」。
 *   表里没有的类型回退 MOB_ARCHETYPES[].name。
 */
export const ENTITY_TYPE_ZH: Record<string, string> = {
  // ★ 黑塔伪人系
  HT_FAKE_STUDENT: "伪人·学生",
  HT_FAKE_PAW: "伪人·爪牙",
  HT_FAKE_ELITE: "伪人·精英",
  HT_FAKE_TEACHER: "伪人·教师",
  HT_FAKE_HOST: "伪人·宿主",
  HT_FAKE_MR: "先生",
  RAT: "老鼠",
  BAT: "暗夜生物",
  SNAKE: "爬虫",
  WILD_GOAT: "山羊",
  GOBLIN: "哥布林",
  ZOMBIE: "人形亡者",
  IMP: "小恶魔",
  SKELETON: "骷髅兵",
  KOBOLD: "狗头人",
  ICE_ELEMENTAL: "冰元素",
  ORC: "半兽人",
  BONEMAN: "白骨人",
  EMPOWERED_ORC: "强化半兽人",
  DEMON: "恶魔",
  GHOST: "幽灵",
  MUMMY: "木乃伊",
  SIREN: "塞壬",
  TROLL: "巨魔",
  BANSHEE: "报丧女妖",
  GOLEM: "石魔",
  CYCLOPS: "独眼巨人",
  MINOTAUR: "牛头人",
  VAMPIRE: "血族",
  LICH: "巫妖",
  LOOT_GOBLIN: "拾荒哥布林",
  ORC_BOSS: "兽人首领",
};

/**
 * ★ NPC dialog key → 头顶显示中文名（与 vite.config.ts dev-host DIALOGUE_MAP 的 speaker 同口径）。
 *   Tiled 地图里 DWARF_BILI / BARTENDER 这类 NPC 只带 dialog key、对象名叫 "NPC"，
 *   不查这张表的话头顶会显示难看的 "NPC"；表里没有的 key 回退原值。
 */
export const NPC_DIALOG_ZH: Record<string, string> = {
  DWARF_BILI: "矮人比利",
  BARTENDER: "酒馆老板",
  MAYOR_LEONARD: "镇长 Leonard",
  LEONARD: "镇长 Leonard",
  BARKEEP: "酒馆老板",
  // mulberryForest：Nani 与 Dwarf Bili 在森林的营救剧情触发 NPC
  NANI_AND_BILI_RESCUE: "娜妮",
  // ★ ：大罗宗人物（map_design/ 地图集）
  // ★ 黑塔：从超忆症开始成神（map_design/黑塔：从超忆症开始成神）
  SU_XIAO_CLASS_PRESIDENT: "苏晓",
  XIAO_MAN_GUIDE: "小满",
  WEI_SHU_COACH: "魏叔",
  ZHANG_WANYI_GUIDE: "张晚意",
  OLD_ZHOU_HINT: "老周",
  BAI_XIAOSHENG_INFO: "百晓生",
  BAI_ZIXUAN: "白子轩",
  MOM_BREAKFAST: "妈妈",
  CLASS_TEACHER: "班主任",
  PE_COMMITTEE: "体育委员",
  MR_XIANSHENG: "先生",
  XUANCHEN: "玄尘长老",
  MO_LAO: "墨老",
  SU_MO: "苏沫",
  XIAO_ZHONG: "萧肿",
  CHEN_NANXUAN: "陈南璇",
};

/** 阵营规范化：非法值返回 null（调用方回退 entity_type 推断） */
export function normalizeCamp(v: any): "neutral" | "hostile" | "friendly" | null {
  const s = String(v || "").trim().toLowerCase();
  return s === "neutral" || s === "hostile" || s === "friendly" ? s : null;
}

/**
 * ★ entity_type → sprite key（assets.ts 的 mob key：rat/bat/snake/goat/goblin/skeleton/orc/minotaur）。
 *   头顶显示中文名后，中文名不再承担 sprite 关键字匹配职责，按 entity_type 精确映射；
 *   表外类型回退 mobKeyFor(名字)。
 */
export const ENTITY_SPRITE_KEY: Record<string, string> = {
  // ★ 黑塔伪人系：复用已验证的人物动画帧（TILE_ANIM_ID 有映射的优先）
  HT_FAKE_STUDENT: "ht_student",
  HT_FAKE_PAW: "ht_paw",
  HT_FAKE_ELITE: "ht_elite",
  HT_FAKE_TEACHER: "ht_teacher",
  HT_FAKE_HOST: "ht_host",
  HT_FAKE_MR: "ht_mr",
  RAT: "rat", BAT: "bat", SNAKE: "snake", WILD_GOAT: "goat",
  GOBLIN: "goblin", LOOT_GOBLIN: "goblin", IMP: "goblin", KOBOLD: "goblin",
  SKELETON: "skeleton", ZOMBIE: "skeleton", BONEMAN: "skeleton",
  MUMMY: "skeleton", VAMPIRE: "skeleton", BANSHEE: "skeleton", GHOST: "skeleton", LICH: "skeleton",
  ORC: "orc", ORC_BOSS: "orc", EMPOWERED_ORC: "orc", DEMON: "orc", WOLF: "orc",
  TROLL: "minotaur", GOLEM: "minotaur", CYCLOPS: "minotaur", MINOTAUR: "minotaur",
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
  "SIGN",
  // ★ 文字标识类（建筑名称显示；编辑器侧同名类型，见 building-labels.md）
  "FLOAT_LABEL",
  "SIGNBOARD",
  "GROUND_TEXT",
]);

/** ★ 文字标识类实体：解析成 kind="text_label" 的装饰（App.vue 按 textKind 分三种画法） */
export const TEXT_ENTITY_TYPES: Set<string> = new Set([
  "FLOAT_LABEL",
  "SIGNBOARD",
  "GROUND_TEXT",
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
  /** ★ Tiled Actors 层的中立 NPC（Mayor Leonard / 城镇 Bar 等）—— 进入 entities 让玩家可对话 */
  npcs?: MapNpc[];
  /** ★ 该地图野怪等级范围（null = 无野怪，[min, max] = 等级区间） */
  mobLevelRange?: [number, number] | null;
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
export function normalizeTiledMap(obj: Record<string, unknown>, levelName?: string): MapConfig {
  // ★ 防御：非 Tiled 格式（缺 layers / width / tilewidth）直接走 fallback 而不是 throw
  if (!obj || typeof obj !== "object" || !Array.isArray((obj as any).layers)
      || (!((obj as any).tilewidth || (obj as any).tilewidth === 0)
          && !((obj as any).tileheight || (obj as any).tileheight === 0))) {
    console.warn("[mapConfig] normalizeTiledMap 收到非 Tiled 格式（缺 layers/tilewidth），走 fallback：", levelName);
    return fallbackMapConfig();
  }
  const f = fallbackMapConfig();
  const W = num(obj.width, 43);
  const H = num(obj.height, 56);
  const decorations: MapDecoration[] = [];
  const mobs: MapMob[] = [];
  const npcs: MapNpc[] = [];
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
        if (props.entity_type === "PLAYER" || props.entity_type === "SPAWN_POINT") {
          // ★ 玩家出生点：Tiled 对象 y 是 1-indexed，需要减 1。
          //   PLAYER（旧命名，mulberryTown 等原版地图用）和 SPAWN_POINT（新命名，编辑器专用）
          //   都作为出生点；多个 SPAWN_POINT 取最后一个，编辑时注意避免重复放置。
          playerSpawn = {
            x: obj.x / 32 - W / 2,
            y: obj.y / 32 - 1 - H / 2,
          };
        } else if (props.entity_type === "NPC") {
          // ★ 分层处理（game.md：entity_type 只决定行为类，外观由 object.gid 指向图集）：
          //   - 无名占位 NPC（含农场动物：mulberryTown id 190/191/192 的牛）→ 只进装饰层，
          //     用 obj.gid 选贴图 + wanders 游走，**不生成实体、不画头顶名字**，
          //     避免「莫名奇妙的 NPC」刷屏，同时动物也能以正确的牛贴图出现。
          //   - 有名字或有 dialog 的 NPC → 装饰层 + npcs[]（App.vue 生成 mapnpc_* 实体，
          //     支持走近触发「💬 聊天」+ 头顶中文名）。
          const fullName = props.full_name != null ? String(props.full_name) : "";
          const propName = String(props.name || "").trim();
          const objName = String(obj.name || "").trim();
          const hasDialog = typeof props.dialog === "string" && props.dialog.length > 0;
          const hasMeaningfulName =
            (fullName && fullName !== "NPC") ||
            (propName && propName !== "NPC") ||
            (objName && objName !== "NPC");
          const interactable = hasMeaningfulName || hasDialog;
          // ★ 完整中文名：full_name 优先 > props.name（Mayor Leonard） > dialog key 中文名 > obj.name > 兜底
          //   （「Bar」这种位置占位名不能盖过 dialog 的角色名——酒馆老板不该显示成 "Bar"）
          const isAscii = /^[\x00-\x7F]+$/.test(propName);
          const dialogZh = hasDialog ? (NPC_DIALOG_ZH[String(props.dialog).trim().toUpperCase()] || "") : "";
          const displayName = fullName
            || (propName && !isAscii ? propName : "")
            || dialogZh
            || (objName && objName !== "NPC" ? objName : "")
            || (propName ? propName : "")
            || "NPC";
          const wx = obj.x / 32 - W / 2;
          const wz = obj.y / 32 - 1 - H / 2;
          // ★ 可拾取物（pickup_item）：斧头等
          const isPickup = typeof props.pickup_item === "string" && String(props.pickup_item).length > 0;
          // ★ 装饰层：普通 NPC 都画（variant = gid-1 → 图集 tile id，绘制层按 gid 出图）；
          //   可拾取物**不进装饰层**——由实体层 drawPickupAxe 绘制，拾取后实体 alive=false，
          //   若残留装饰层会在拾取点画出多余的 tile-0 残图（装饰层去重只看 alive!==false 的实体）。
          if (!isPickup) decorations.push({
            id: `n_${decIdx++}`,
            kind: "npc",
            x: wx,
            y: wz,
            // 无名 NPC 不带名字（绘制层据此不画标签），只有 gid 贴图 + 游走
            name: interactable ? displayName : "",
            variant: obj.gid ? obj.gid - 1 : 0,
            // ★ Tiled 对象 id：实体层已生成 mapnpc_<id> 时装饰层跳过，避免同一 NPC 画两遍
            npcObjId: obj.id,
            // ★ NPC 行为数据（渲染层做游走动画用）
            wanders: props.wanders === true,
            seed: (decIdx * 7919) % 1000,   // 每个 NPC 独立相位
          } as any);
          // ★ 全部 28 个 NPC（含无名镇民与农场动物）都进 npcs[] → App.vue 生成 mapnpc_* 实体，
          //   走近即可「💬 聊天」（用户要求：地图 NPC 与 ally 一样都能对话）。
          //   无名者 displayName 用「镇民#<Tiled id>」占位，并标 unnamed=true：
          //   头顶不画名字（避免刷屏），但聊天面板里能显示身份，LLM 按其所在位置自行演绎。
          npcs.push({
            id: obj.id,
            name: objName || propName || displayName,
            displayName: interactable ? displayName : `镇民#${obj.id}`,
            x: wx,
            y: wz,
            gid: obj.gid,
            wanders: props.wanders === true,
            dialog: typeof props.dialog === "string" ? props.dialog : undefined,
            unnamed: !interactable,
            pickupItem: isPickup ? String(props.pickup_item) : undefined,
          });
        } else if (normalizeCamp(props.camp) !== "neutral"
                   && (MOB_ENTITY_TYPES.has(String(props.entity_type)) || normalizeCamp(props.camp) === "hostile")) {
          // ★ 怪物 → 记录位置、类型、等级，App.vue switchLevel 时加载到 entities
          //   阵营判定（game.md 优化）：对象带 camp 属性时以 camp 为准；
          //   没有 camp 时回退 entity_type 白名单推断（白名单内 → hostile），原地图无需修改依然可用。
          //   camp=hostile 还允许白名单外的类型也能成为野怪（走兜底档案），消除 entity_type 判定的不可靠性。
          //   等级优先取 Tiled 属性 props.level，未标注时用 MOB_ARCHETYPES 默认值。
          const wx = obj.x / 32 - W / 2;
          const wz = obj.y / 32 - 1 - H / 2;
          const mobName = String(props.name || obj.name || "野怪");
          const archLevel = MOB_ARCHETYPES[props.entity_type]?.level ?? 1;
          const mobLevel = Number.isFinite(props.level) ? Number(props.level) : archLevel;
          // ★ 击杀奖励：Tiled 对象属性里可写 bounty / dropTable（JSON 字符串）——
          //   这是「地图集参与击杀奖励」的唯一入口（事件引擎没有 kill_count 挂载点，见
          //   野怪击杀奖励.事件.md §1）。解析失败静默忽略，回退全局默认表。
          const bountyProp = parseJsonProp(props.bounty);
          const dropProp = parseJsonProp(props.dropTable) ?? parseJsonProp(props.drops);
          mobs.push({
            id: obj.id,
            name: mobName,
            x: wx,
            y: wz,
            gid: obj.gid,
            entity_type: props.entity_type,
            level: mobLevel,
            camp: normalizeCamp(props.camp) || "hostile",
            full_name: props.full_name != null ? String(props.full_name) : undefined,
            bounty: bountyProp && typeof bountyProp === "object" && !Array.isArray(bountyProp)
              ? {
                  exp: bountyProp.exp != null ? num(bountyProp.exp, 0) : undefined,
                  money: bountyProp.money != null ? num(bountyProp.money, 0) : undefined,
                }
              : undefined,
            dropTable: Array.isArray(dropProp)
              ? dropProp
                  .filter((d: any) => d && d.name != null)
                  .map((d: any) => ({ name: String(d.name), w: num(d.w, 1) }))
              : undefined,
          });
        } else if (normalizeCamp(props.camp) === "neutral" && !NON_MOB_ENTITY_TYPES.has(String(props.entity_type))) {
          // ★ camp=neutral 的实体型对象（如中立野怪/商人怪）→ NPC 装饰物（不参战、头顶显示姓名）
          const wx = obj.x / 32 - W / 2;
          const wz = obj.y / 32 - 1 - H / 2;
          const zh = ENTITY_TYPE_ZH[String(props.entity_type)] || MOB_ARCHETYPES[props.entity_type]?.name || obj.name || "路人";
          const fullName = props.full_name != null ? String(props.full_name) : "";
          decorations.push({
            id: `n_${decIdx++}`,
            kind: "npc",
            x: wx,
            y: wz,
            name: fullName ? `${zh}(${fullName})` : zh,
            variant: obj.gid ? obj.gid - 1 : 0,
            wanders: props.wanders === true,
            seed: (decIdx * 7919) % 1000,
          } as any);
        } else if (props.entity_type === "LEVEL_TRANSITION" || props.entity_type === "LADDER") {
          // ★ 出口/传送点 → kind=portal（App.vue 画箭头提示"从这里出去"）
          //   name：切换目标（喂给 switchLevel → levelNameToFile）；
          //   label：画面显示文字（full_name 优先，如"山门牌坊·往大罗宗外门"）。
          const wx = obj.x / 32 - W / 2;
          const wz = obj.y / 32 - 1 - H / 2;
          const portalName = String(props.portalID || props.entity_type);
          // 显示文字：full_name 优先 → 关卡中文显示名（"Mulberry Dungeon"→"锁灵塔·1层"）→ portalID
          const portalLabel = props.full_name != null ? String(props.full_name)
            : (LEVEL_DISPLAY_NAMES[portalName] ?? portalName);
          decorations.push({
            id: `p_${decIdx++}`,
            kind: "portal" as any,
            x: wx,
            y: wz,
            name: portalName,
            ...({ label: portalLabel } as any),
          } as any);
        } else if (TEXT_ENTITY_TYPES.has(String(props.entity_type))) {
          // ★ 文字标识类（建筑名称）：
          //   FLOAT_LABEL 悬浮文字（仿入口粉字，永远显示）
          //   SIGNBOARD   路标（仿任务板黄边牌，永远显示）
          //   GROUND_TEXT 地表文字（贴地注记，永远显示）
          //   full_name = 显示文字；纯标注，无交互。
          const wx = obj.x / 32 - W / 2;
          const wz = obj.y / 32 - 1 - H / 2;
          const label = String(props.full_name || props.name || "文字");
          decorations.push({
            id: `t_${decIdx++}`,
            kind: "text_label" as any,
            textKind: String(props.entity_type),   // FLOAT_LABEL / SIGNBOARD / GROUND_TEXT
            x: wx,
            y: wz,
            name: label,
            ...({ label } as any),
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
  //   ★ 中文关卡名（修真地图集，如"大罗宗外门"）按文件名判断。
  const levelFile = levelName ? levelNameToFile(levelName) : "";
  const isTownLevel = !levelName || /town|overworld/i.test(levelName) || /mulberryTown|^overworld$/.test(levelFile);
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

  // ★ 计算野怪等级范围（标注有没有野怪、野怪分布的等级区间）
  //   此前完全没有这个字段 → HUD 无法提示"该地图难度"。
  const mobLevelRange: [number, number] | null = mobs.length > 0
    ? mobs.reduce<[number, number]>(
        (acc, m) => [Math.min(acc[0], m.level), Math.max(acc[1], m.level)],
        [Infinity, -Infinity],
      )
    : null;

  // ★ 占位名字兜底：Tiled JSON 通常不带顶层 name 字段（mulberryTown.json 就是 null），
  //   之前 `obj.name ?? "overworld"` 永远回落到 "overworld" → 地图主题面板错把 Mulberry Town 显示成 overworld。
  //   修复：当 Tiled 没写 name 时，回退到调用方传入的 levelName（小写驼峰 → Pascal Case 友好显示）。
  const tiledName = (obj && typeof obj.name === "string" && obj.name.trim()) ? obj.name.trim() : "";
  const finalName = tiledName || (levelName ? levelName : "overworld");
  // ★ 地图集自定义主题/旁白（map_design 地图集改造：顶层 theme/narration/notes 由编辑器写入）
  const tiledTheme = (obj && typeof obj.theme === "string" && obj.theme.trim()) ? obj.theme.trim() : "";
  const tiledNarration = (obj && typeof obj.narration === "string" && obj.narration.trim()) ? obj.narration.trim() : "";
  const tiledNotes = (obj && typeof obj.notes === "string" && obj.notes.trim()) ? obj.notes.trim() : "";
  return {
    ...f,
    name: finalName,
    theme: tiledTheme || f.theme,
    narration: tiledNarration || f.narration,
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
    npcs,
    mobLevelRange,
    // ★ 地图集 notes（改造脚本写入的故事定位说明）；无则清掉 fallback 诊断字段
    notes: tiledNotes || undefined,
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

/**
 * ★ 地图 JSON fetch 前缀链（优先级从高到低）：
 *   1. /story-data/<repoPath>/ —— dev（vite）模式直读 workshops 地图集源文件
 *      （storyDataPlugin 中间件，vite.config.ts）。改造地图集时无需手动同步 public/。
 *   2. assetUrl("maps/") —— 生产：插件资产通道（getAsset+token）
 *   3. /maps/ 、 ./maps/ —— dev-host / 本地静态副本兜底
 * 失败依次回退，与 loadLevelByName 的"多前缀尝试"语义一致。
 *
 * ★ 修复 401 噪声：/story-data 中间件只在 vite dev 存在；真宿主（getAsset 环境）下该路径
 *   不存在且需鉴权 → fetch 返回 401（控制台刷红）。故 getAsset 环境下 STORY_MAP_BASE 置空，
 *   前缀链跳过 dev 路径、直接用 assetUrl（带 token 的 getAsset 通道，200）。
 */
/** 是否在宿主 getAsset 环境（生产/真机 iframe）。该环境下 /story-data 不可用且需鉴权→401。 */
function inGetAssetEnv(): boolean {
  try {
    return location.href.includes("getAsset");
  } catch {
    return false;
  }
}
/**
 * 解析当前 dev iframe 的故事名（?story= 或 window.__STORY__）。
 * ai:取不到时回退到默认故事「xxxx」（兼容历史测试用例）。
 * 我：你他妈人工智障！！！
 */
function resolveDevStoryName(): string {
  try {
    const sp = new URLSearchParams(location.search);
    const s = sp.get("story") || (window as any).__STORY__ || "";
    if (s) return s;
  } catch { /* ignore */ }
  return "";
}

const STORY_MAP_BASE_DEV: string = `/story-data/toonflow-field-survival/map_design/${encodeURIComponent(resolveDevStoryName())}/maps/`;
/** dev 模式下 events 子目录前缀（与 STORY_MAP_BASE_DEV 故事名保持一致；eventEngine 复用） */
export const STORY_EVENT_BASE_DEV: string = `/story-data/toonflow-field-survival/map_design/${encodeURIComponent(resolveDevStoryName())}/events/maps/`;
/** getAsset 环境返回空（前缀链跳过 /story-data，避免 401）；dev 返回 story-data 中间件路径 */
const STORY_MAP_BASE = inGetAssetEnv() ? "" : STORY_MAP_BASE_DEV;

/** 统一构建地图 fetch 前缀链（过滤空串，避免 getAsset 环境下拼出相对脏 URL） */
function mapPrefixes(): string[] {
  const list: string[] = [];
  if (STORY_MAP_BASE) list.push(STORY_MAP_BASE);
  list.push(assetUrl("maps/"), "/maps/", "./maps/");
  return list;
}

export const OVERWORLD_URLS = [
  ...(STORY_MAP_BASE ? [STORY_MAP_BASE + "mulberryTown.json"] : []),
  assetUrl("maps/mulberryTown.json"),
  "/maps/mulberryTown.json",
  "./maps/mulberryTown.json",
];

/* ============================================================
   ★ 起始地图声明（回归修复）
   ------------------------------------------------------------
   maps/first.map.json 只声明"开局进哪张图"：
     { "start_map": { "name": "portalID", "type": "string", "value": "Mulberry Town" } }
   起始关卡 = start_map.value（缺失 / 读取失败 / 字段为空 → DEFAULT_START_LEVEL）。
   除此之外，运行期关卡切换只允许由场景内 portal（LEVEL_TRANSITION）触发；
   宿主下发的氛围字段 map.theme 不再参与任何关卡决策（详见 App.vue）。
   ============================================================ */
export const FIRST_MAP_URLS = [
  ...(STORY_MAP_BASE ? [STORY_MAP_BASE + "first.map.json"] : []),
  assetUrl("maps/first.map.json"),
  "/maps/first.map.json",
  "./maps/first.map.json",
];

/** 起始关卡回退值（first.map.json 不可用时的兜底） */
export const DEFAULT_START_LEVEL = "Mulberry Town";

/* ============================================================
   ★ 关卡名 → Dungeon theme（用于按权重刷怪）
   ------------------------------------------------------------
   数据来源：public/entity_types.json 的 dungeon_themes
     - RUINS      (≤5)   Rat/Bat/Snake/Goblin/Orc/LootGoblin
     - CATACOMBS  (≤10)  Zombie/Skeleton/Mummy/Ghost/Banshee/Vampire
     - MINE       (≤15)  Kobold/Minotaur/Goblin/Orc/EmpoweredOrc/Boneman/Golem
     - ICE        (>15)  Cyclops/Troll/Minotaur/IceElemental/Skeleton/Imp/Siren
   城镇 / 王国映射为 null → 不刷怪（保留 safe zone 行为）
   ============================================================ */
export const THEME_BY_MAPNAME: Record<string, "RUINS" | "CATACOMBS" | "MINE" | "ICE" | null> = {
  // ★ 黑塔：从超忆症开始成神（map_design/黑塔：从超忆症开始成神）
  //   运行期传入的是关卡 key（slug，来自 App.vue currentLevelName），
  //   中文显示名一并登记，两种写法都能命中。
  lichLair:              null,
  mulberryTown:          null,
  mulberryForest:        "RUINS",
  mulberryGraveyard:     "CATACOMBS",
  forestDungeon1:        "RUINS",
  forestDungeon2:        "RUINS",
  forestDungeon3:        "CATACOMBS",
  forestDungeon4:        "MINE",
  forestDungeon5:        "MINE",
  mulberryDungeon1:      "MINE",
  mulberryDungeon2:      "MINE",
  mulberryDungeon3:      "ICE",
  mulberryDungeon4:      "ICE",
  mulberryDungeon5:      "ICE",
  lootGoblinLair:        "RUINS",
  oldForest:             null,
  taintedForest:         "CATACOMBS",
  oldGraveyard:          null,
  lichBoss:              "ICE",
  oldlichBoss:           "ICE",
  orcCastle:             null,
  overworld:             null,
  "陈曦的卧室":             null,
  "延城一中":               null,
  "网球场·黄昏":            "RUINS",
  "旧教学楼·天台":          "CATACOMBS",
  "记忆回廊·一层·早自习":    "RUINS",
  "记忆回廊·二层·课间十分钟": "RUINS",
  "记忆回廊·三层·运动会":    "CATACOMBS",
  "记忆回廊·四层·那天下午":  "MINE",
  "记忆回廊·五层·被改写的放学": "MINE",
  "黑塔·一层·门厅":          "MINE",
  "黑塔·二层·名册室":        "MINE",
  "黑塔·三层·咀嚼室":        "ICE",
  "黑塔·四层·剥忆室":        "ICE",
  "黑塔·五层·塔心":          "ICE",
  "旧货市场":               "RUINS",
  "旧书店":                 null,
  "认知污染带":             "CATACOMBS",
  "被遗忘者名录":            null,
  "伪人总部·收容课教室":     "ICE",
  "伪人总部·拟态间":         "ICE",
  "黑塔·降临旧址":           null,
  "超凡界·界域":             null,
  "延城·地表":              null,
  "Mulberry Town":          null,
  "Mulberry Forest":        "RUINS",
  "Mulberry Graveyard":     "CATACOMBS",
  "Lich Lair":              "CATACOMBS",
  "Loot Goblin Lair":       "RUINS",
  "Mulberry Dungeon":       "RUINS",
  "Mulberry Dungeon 2":     "RUINS",
  "Mulberry Dungeon 3":     "RUINS",
  "Mulberry Dungeon 4":     "RUINS",
  "Mulberry Dungeon 5":     "RUINS",
  "Forest Dungeon":         "RUINS",
  "Forest Dungeon 2":       "RUINS",
  "Forest Dungeon 3":       "RUINS",
  "Forest Dungeon 4":       "RUINS",
  "Forest Dungeon 5":       "RUINS",
  "Kingdom":                null,
  "Lich Boss":              "CATACOMBS",
};

/** 按关卡名查 theme，未登记则回退 RUINS（最弱怪） */
export function getThemeForMapName(levelName: string | null | undefined): "RUINS" | "CATACOMBS" | "MINE" | "ICE" | null {
  if (!levelName) return "RUINS";
  const hit = THEME_BY_MAPNAME[levelName];
  if (hit !== undefined) return hit;
  // 含 "graveyard"/"lich"/"crypt"/"catacomb" 关键字 → CATACOMBS
  if (/graveyard|lich|crypt|catacomb|tomb/i.test(levelName)) return "CATACOMBS";
  // 含 "mine"/"cave" 关键字 → MINE
  if (/mine|cave/i.test(levelName)) return "MINE";
  // 含 "ice"/"frost"/"snow" 关键字 → ICE
  if (/ice|frost|snow/i.test(levelName)) return "ICE";
  return "RUINS";
}

/** 读取 maps/first.map.json 的 start_map.value（永不抛错，最差返回 DEFAULT_START_LEVEL） */
export async function loadStartLevelName(): Promise<string> {
  // ★ 故事绑定：当前会话有视觉地图包时，起始图声明优先取包内 first.map.json
  const first = getStoryFirstMap();
  if (first) {
    const raw0 = (first as any)?.start_map;
    const v0 = typeof raw0 === "string" ? raw0 : raw0?.value;
    const name0 = String(v0 ?? "").trim();
    if (name0) return name0;
  }
  for (const url of FIRST_MAP_URLS) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = (await r.json()) as any;
      const raw = d?.start_map;
      const v = typeof raw === "string" ? raw : raw?.value;
      const name = String(v ?? "").trim();
      if (name) return name;
      console.warn(`[field-survival] first.map.json 未声明 start_map.value（${url}）→ 回退 ${DEFAULT_START_LEVEL}`);
      return DEFAULT_START_LEVEL;
    } catch { /* try next */ }
  }
  console.warn(`[field-survival] 起始地图声明缺失：maps/first.map.json 未取到 → 回退 ${DEFAULT_START_LEVEL}`);
  return DEFAULT_START_LEVEL;
}

/**
 * 加载"开局地图"（起点关卡）配置。
 * @param levelName 起始关卡名，来自 loadStartLevelName()；缺省 Mulberry Town
 * 关卡名 → 文件名复用 levelNameToFile（与 portal 切图同一条映射链，避免两套规则）。
 */
export async function loadMapConfig(levelName: string = DEFAULT_START_LEVEL): Promise<MapConfig> {
  const file = levelNameToFile(levelName) || "mulberryTown";
  // ★ 故事绑定：优先用会话视觉地图包里的原始 JSON，缺失才回退 fetch 前缀链
  const sraw = getStoryMapRaw(file);
  if (sraw) {
    const n = normalizeMapConfig(sraw, levelName);
    if (n) return n;
  }
  for (const prefix of mapPrefixes()) {
    try {
      const r = await fetch(prefix + file + ".json");
      if (!r.ok) continue;
      const d = await r.json();
      const n = normalizeMapConfig(d, levelName);
      if (n) return n;
    } catch { /* try next */ }
  }
  console.warn(`[field-survival] 起始关卡地图缺失：${levelName} → 期望 maps/${file}.json（回退 fallback）`);
  return fallbackMapConfig();
}

/**
 * ★ 关卡表：portalID（地图 JSON 里出口对象的 portalID 属性）→ 文件名
 *
 *  不再使用硬编码！！！
 *  而是 自动识别 "Mulberry Town": "mulberryTown",
 */
const LEVEL_FILES: Record<string, string> = {
};

/** 关卡英文名 → 中文显示名（地图面板展示用）。与 LEVEL_FILES 的 key 一一对应。
 * 以地图的json 数据为准。这里只是默认值。
 * */
const LEVEL_DISPLAY_NAMES: Record<string, string> = {
  "Mulberry Town": "城镇",
  "Mulberry Forest": "森林",
  "Mulberry Graveyard": "乱葬岗",
  "Lich Lair": "尸祖洞府",
  "Loot Goblin Lair": "藏宝洞",
  "Mulberry Dungeon": "锁灵塔·1层",
  "Mulberry Dungeon 2": "锁灵塔·2层",
  "Mulberry Dungeon 3": "锁灵塔·3层",
  "Mulberry Dungeon 4": "锁灵塔·4层",
  "Mulberry Dungeon 5": "锁灵塔·5层",
  "Forest Dungeon": "竹海秘境·1层",
  "Forest Dungeon 2": "竹海秘境·2层",
  "Forest Dungeon 3": "竹海秘境·3层",
  "Forest Dungeon 4": "竹海秘境·4层",
  "Forest Dungeon 5": "竹海秘境·5层",
};

/** 全部已登记关卡名（用于上报插件，生成大地图节点）。
 *
 * 优先级：
 *   ① 当前故事的 map_visual 包（storyMap.mapFiles）—— 23 关，来自 .tbg 解包
 *   ② LEVEL_FILES 硬编码（兜底，仅 mulberryTown / 模板默认关卡）
 *   ③ 空数组（都拿不到就退到 ui/maps 兜底，关卡列表只有当前关）
 */
export function listLevelNames(): string[] {
  // ① 优先：当前故事 .tbg 解出来的 mapFiles（mulberryTown, mulberryForest, ..., overworld 共 23 关）
  const fromStory = getStoryLevelNames();
  if (fromStory.length) return fromStory;
  // ② 兜底：硬编码 LEVEL_FILES
  return Object.keys(LEVEL_FILES);
}

/** 根据关卡英文名获取中文显示名。
 *
 * 优先级：
 *   ① Tiled JSON 顶层 name 字段（如 "大罗宗外门"，来自 map_design/maps/xxx.json 的 name）
 *   ② LEVEL_DISPLAY_NAMES 硬编码（如 "Mulberry Town" → "城镇"）
 *   ③ 原文（裸文件名如 "mulberryTown"）
 */
export function getLevelDisplayName(levelName: string): string {
  // ① 从故事包（Tiled JSON）的顶层 name 取中文显示名
  const tiled = getStoryMapRaw(levelName);
  const tiledName = tiled && typeof tiled === "object" ? String(tiled.name || "").trim() : "";
  if (tiledName) return tiledName;
  // ② 硬编码
  return LEVEL_DISPLAY_NAMES[levelName] ?? levelName;
}

/**
 * ★ 地图野怪等级区间（文件名 → [lo, hi]），地图面板在地图名旁显示「Lv.lo-hi」。
 *
 * 与 .cache/set_map_mob_levels.py 的 MAP_LEVEL_RANGE 同源维护：改地图 level 后
 * 两边要同步（脚本负责改 JSON，这里只管显示）。表里没有的关卡（无野怪，如城镇）
 * 返回空字符串，不显示标签。
 */
export const MAP_MOB_LEVEL_RANGE: Record<string, [number, number]> = {
  // ★ 黑塔：从超忆症开始成神 —— 旧货市场只有一只宿主（见 map_design/黑塔：…/lootGoblinLair.json）
  lootGoblinLair: [25, 25],
  mulberryForest: [1, 10],
  mulberryGraveyard: [10, 20],
  forestDungeon1: [10, 20],
  forestDungeon2: [20, 30],
  forestDungeon3: [30, 40],
  forestDungeon4: [40, 50],
  forestDungeon5: [50, 60],
  mulberryDungeon1: [60, 70],
  mulberryDungeon2: [70, 80],
  mulberryDungeon3: [80, 90],
  mulberryDungeon4: [90, 100],
  mulberryDungeon5: [100, 110],
};

/** 关卡显示名 → 等级范围标签（如 "Lv.10-20"）；无野怪/未登记返回 ""。 */
export function levelRangeLabel(levelName: string): string {
  const file = levelNameToFile(levelName);
  const r = file ? MAP_MOB_LEVEL_RANGE[file] : undefined;
  return r ? `Lv.${r[0]}-${r[1]}` : "";
}

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
  // ★ 故事绑定：优先用会话视觉地图包（切换关卡走 portal 时同样生效），缺失才回退 fetch
  const sraw = getStoryMapRaw(file);
  if (sraw) {
    const n = normalizeMapConfig(sraw, levelName);
    if (n) return n;
  }
  for (const prefix of mapPrefixes()) {
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
            npcObjId: d?.npcObjId != null ? num(d.npcObjId, 0) || undefined : undefined,
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
/** 解析 Tiled 对象属性里的 JSON（对象/数组字面量）。Tiled 的 string 属性是纯文本，
 *  设计师写 bounty/dropTable 时只能填 JSON 串，这里统一解析；已是对象则原样返回；
 *  解析失败返回 undefined（调用方静默回退默认值）。 */
function parseJsonProp(v: unknown): any {
  if (v == null) return undefined;
  if (typeof v === "object") return v;
  const s = String(v).trim();
  if (!s) return undefined;
  const c = s[0];
  if (c !== "{" && c !== "[") return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}
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
