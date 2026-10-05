/**
 * 野外生存插件 — 入口文件（2.5D 动作生存）
 *
 * 后端通过 PluginExecutor 动态 import 本模块，调用
 *   handle_action(action, params, state, context)
 *
 * 动作：
 *   init    -> 返回选人阶段状态（roles / playerCard 由后端注入 ctx）
 *   start   -> params { participants, spectators, enemies } 开局
 *   tick    -> params { input:{ dx, dy, moveTo, attack } } 实时推进一帧
 *   skill   -> params { index } 释放技能（取用户参数卡技能）
 *   item    -> params { index } 使用物品格
 *   page    -> params { kind: "skill"|"item", delta } 翻页
 *   sys     -> 打开系统面板（上报关卡列表 / 当前地图，初始化商城）
 *   sys_sell / sys_use_item / sys_sort / sys_ring_move
 *           -> 背包卖出 / 使用 / 排序 / 纳戒存取（与用户动态参数卡同步）
 *   sys_shop_refresh / sys_shop_buy -> 商城刷新 / 购买（消耗货币）
 *   sys_party / sys_teleport / sys_travel -> 组队跟随 / 传送角色 / 大地图传送
 *   sys_chat -> 对话功能：调用角色发言器 agent，台词同步到 Toonflow-game-web 聊天框
 *   exit    -> 主动退出，产出 result（奖励汇总）
 */

interface PluginGameContext {
  pluginId: string;
  pluginDir: string;
  manifest: any;
  userId?: number;
  sessionId?: string;
  roles?: Array<Record<string, unknown>>;
  playerCard?: Record<string, unknown>;
  /** 后端插件 API（toonflowTsApi）：pluginData（t_plugin_session_data）+ agent */
  tsApi?: {
    pluginData: {
      get(dataKey: string): Promise<any>;
      set(dataKey: string, value: unknown): Promise<void>;
      list(): Promise<string[]>;
      remove(dataKey: string): Promise<void>;
    };
    agent: {
      run(
        agentName: string,
        input: Record<string, unknown>
      ): Promise<{ ok: boolean; output?: Record<string, any>; error?: string }>;
    };
  };
}

/* ============================================================
   地图 / 比例尺 / 土块 / Chunk 常量（对齐 25d_ai_game 风格）
   ============================================================

   25d_ai_game (Godot 3D) 的关键参数：
     ground_size = 300.0 (m), ground_height = 5.0 (m)
     block_size  = 0.5 (m, 0.5m 立方体)
     chunk_size  = 32 blocks = 16 m/chunk

   toonflow-field-survival 改造后：
     ground_size = 3000 (m)              ← 整体可玩区扩 10×
     ground_height= 100 (m)（暂未对顶视图生效，预留挖地）
     block_size  = 0.5 (m)               ← 单方块
     chunk_size  = 32 blocks = 16 m/chunk
     scale_meter = 1.0 (默认 1 米 = 1 单位)

   内部坐标系：
     WORLD = {w: 3000, h: 3000} 单位：米。
     所有角色 / 装饰物 / 宝箱 / 血瓶 / 怪物的 x/y 现在都是「米」。
     前端 canvas 通过 scale_meter * zoom 把米 → 屏幕像素绘制。
*/

const TERRAIN_BLOCK_SIZE_M = 0.5;       // 单个土块 0.5 m
const CHUNK_SIZE_BLOCKS = 32;            // 每个 chunk 32 块
const CHUNK_SIZE_M = CHUNK_SIZE_BLOCKS * TERRAIN_BLOCK_SIZE_M; // 16 m
const TERRAIN_GROUND_SIZE_M = 3000;      // 总地面 3000 m × 3000 m
const TERRAIN_GROUND_HEIGHT_M = 100;     // 地下 100 m（预留）
const TERRAIN_SCALE_METER = 1.0;         // 1 米 = 1 单位（与 chunk 16m 对齐）

/** map-gener agent 产出的地图数据（sanitize 后的结构） */
interface MapData {
  theme: string;
  narration: string;
  zones: Array<{ name: string; x: number; y: number; r: number; kind: string; desc: string }>;
  enemy_archetypes: Array<{
    id: string; name: string; lv: number; hp: number; atk: number; def: number;
    speed: number; bounty: { exp: number; money: number }; color: string;
  }>;
  chests: Array<{ x: number; y: number; tier: number; loot: { exp: number; money: number; item: string } }>;
  potions: Array<{ x: number; y: number; heal: number }>;
  waves: Array<{ archetype: string; count: number; interval: number }>;
  notes: string;
}

/** 保底地图（ctx.tsApi / agent 不可用时）——坐标全部以「米」为单位 */
function fallbackMap(): MapData {
  // 玩家出生 (1500, 1500) = 地图中心
  return {
    theme: "野外·清晨",
    narration: "薄雾笼罩着这片荒野，远处传来低沉的嘶吼。收拢心神，活下去。",
    zones: [
      { name: "营地", x: 1500, y: 1500, r: 200, kind: "safe",   desc: "相对开阔的临时营地" },
      { name: "荒地", x: 2100, y: 1900, r: 260, kind: "danger", desc: "视野开阔的危险荒地" },
      { name: "废墟", x:  800, y: 1000, r: 220, kind: "loot",   desc: "可能残留物资的废墟" },
    ],
    enemy_archetypes: [
      { id: "enemy_1", name: "荒野游荡者", lv: 1, hp: 40, atk: 6, def: 2, speed: 1.4, bounty: { exp: 10, money: 8 }, color: "#9b3a3a" },
    ],
    chests: [
      { x:  800, y: 1000, tier: 1, loot: { exp: 15, money: 12, item: "干粮"   } },
      { x: 2200, y:  900, tier: 2, loot: { exp: 20, money: 18, item: "急救包" } },
      { x: 1700, y: 2400, tier: 1, loot: { exp: 12, money:  9, item: "工具卷" } },
    ],
    potions: [
      { x:  600, y: 1800, heal: 40 },
      { x: 1900, y:  900, heal: 40 },
      { x: 2400, y: 2300, heal: 40 },
    ],
    waves: [{ archetype: "enemy_1", count: 3, interval: 600 }],
    notes: `fallback map（agent 不可用）- 世界 ${TERRAIN_GROUND_SIZE_M}m，块 ${TERRAIN_BLOCK_SIZE_M}m，chunk ${CHUNK_SIZE_M}m`,
  };
}

/** 从故事动态数据拼 storyDigest（喂给 map-gener agent） */
function buildStoryDigest(ctx?: PluginGameContext): string {
  const parts: string[] = [];
  const card = (ctx?.playerCard || {}) as Record<string, any>;
  const roles = Array.isArray(ctx?.roles) ? ctx!.roles! : [];
  const roleLines = roles.slice(0, 12).map((r) => {
    const rr = (r || {}) as Record<string, any>;
    const skills = Array.isArray(rr.skills) ? rr.skills.map(String).slice(0, 4).join("/") : "";
    return `- ${String(rr.name || rr.id || "?")}（${String(rr.roleType || "?")}）lv${Number(rr.level || 1)} hp${Number(rr.hp || 100)}${skills ? " 技能:" + skills : ""}`;
  });
  parts.push("[参战/候选角色]\n" + (roleLines.join("\n") || "（无）"));
  const playerName = String(card.name || "");
  const cardSkills = Array.isArray(card.skills) ? card.skills.map((s: any) => String(typeof s === "string" ? s : s?.name)).filter(Boolean) : [];
  const cardItems = Array.isArray(card.items) ? card.items.map((s: any) => String(typeof s === "string" ? s : s?.name)).filter(Boolean) : [];
  parts.push(
    `[用户参数卡]\n名称:${playerName || "（无名）"} lv${Number(card.level || 1)} hp${Number(card.hp || 100)} 金钱${Number(card.money || 0)} 经验${Number(card.exp || 0)}\n技能:${cardSkills.slice(0, 8).join("/") || "（无）"}\n物品:${cardItems.slice(0, 12).join("/") || "（无）"}`
  );
  return parts.join("\n\n");
}

/**
 * 生成/维护地图数据：
 *  1) ctx.tsApi 可用 → 调 field-survival-map-gener agent（故事动态数据 → 地图 JSON），
 *     结果 sanitize 后存 t_plugin_session_data.map_data；
 *  2) 不可用/失败 → 保底地图（也存 map_data，保证可玩）。
 * 地图数据不进 plugin_state（plugin_state 每帧全量写回，地图只在开局/维护时写）。
 */
/** ★ fix③：宿主 agent 超时上限——/plugin/tick(action=start) 不能被地图生成无限期挂住，
 *  超时即抛错走 fallback 分支，保证 web 端「开始游戏」一定有响应。 */
const MAP_AGENT_TIMEOUT_MS = 12000;

/** 给 Promise 加超时（宿主 agent 卡死时的兜底） */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    p.finally(() => { if (timer) clearTimeout(timer as any); }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms);
    }),
  ]);
}

async function ensureMapData(ctx?: PluginGameContext): Promise<MapData> {
  const tsApi = ctx?.tsApi;
  if (!tsApi?.agent?.run || !tsApi?.pluginData?.set) return fallbackMap();
  // ★ fix③：本会话已有可用地图 → 直接复用（start 立即返回，不再每次开局都等 LLM）
  try {
    const stored = await tsApi.pluginData.get("map_data");
    if (stored && Array.isArray((stored as any).enemy_archetypes) && (stored as any).enemy_archetypes.length) {
      return stored as MapData;
    }
  } catch { /* 读取失败 → 继续走生成 */ }
  try {
    const r = await withTimeout(
      tsApi.agent.run("field-survival-map-gener", {
        storyDigest: buildStoryDigest(ctx),
      }),
      MAP_AGENT_TIMEOUT_MS,
      `map agent 超时（>${MAP_AGENT_TIMEOUT_MS}ms）`,
    );
    const map = (r?.output || fallbackMap()) as MapData;
    if (!Array.isArray(map.enemy_archetypes) || !map.enemy_archetypes.length) {
      (map as any).enemy_archetypes = fallbackMap().enemy_archetypes;
    }
    await tsApi.pluginData.set("map_data", map);
    return map;
  } catch {
    const map = fallbackMap();
    try { await tsApi.pluginData.set("map_data", map); } catch { /* ignore */ }
    return map;
  }
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface Entity {
  id: string;
  name: string;
  /** 阵营：player=用户 / ally=友方角色 / enemy=敌对角色 / spectator=观战 */
  side: "player" | "ally" | "enemy" | "spectator";
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  atk: number;
  level: number;
  /** ★ game.md 等级系统：蓝量（满蓝 = 100 + 等级*10 + 道具/技能加成） */
  mp?: number;
  maxMp?: number;
  /** ★ game.md 等级系统：当前经验 / 下级所需经验（= 当前等级*100），玩家实体上同步 */
  exp?: number;
  expToNext?: number;
  /** ★ game.md 等级系统：防御（1 + 等级*10 + 道具/技能加成） */
  def?: number;
  avatarPath?: string;
  facing: number;
  cooldown: number;
  alive: boolean;
  /** 巢点/生成点（野怪 AI 归位用），宿主实体统一挂在字段上 */
  homeX?: number;
  homeY?: number;
}

interface Chest { id: string; x: number; y: number; opened: boolean; tier?: number; loot?: Record<string, any>; }
interface Potion { id: string; x: number; y: number; heal: number; }
interface SkillSlot { name: string; power: number; cost: number; cd: number; cdLeft: number;
  type?: "atk" | "heal" | "buff"; range?: "melee" | "ranged"; lv?: number; buff_type?: string; }
interface ItemSlot { name: string; count: number; heal: number; }

export interface FieldSurvivalState {
  phase: "select" | "playing" | "over";
  version: number;
  tick: number;
  world: { w: number; h: number };
  roles: Array<Record<string, unknown>>;
  selections: {
    participants: string[];
    spectators: string[];
    enemies: string[];
  };
  entities: Entity[];
  chests: Chest[];
  potions: Potion[];
  floaters: Array<{ id: string; text: string; x: number; y: number; life: number }>;
  /** ★ game.md 打击特效：宿主侧生成的战斗粒子（kind 与前端 drawVfxLayer 对齐） */
  vfx?: Array<Record<string, any>>;
  /** game.md 技能修改：用户改过的技能参数（按归一技能名存），持久化到 t_plugin_session_data */
  skillMeta?: Record<string, { power: number; cost: number; cd: number; type: string; range: string; lv: number; buff_type: string }>;
  /** ★ game.md 物品修改：用户改过的物品参数（按展示名存），持久化到 t_plugin_session_data */
  itemMeta?: Record<string, ItemMeta>;
  // 用户参数卡派生
  skills: SkillSlot[];
  items: ItemSlot[];
  skillPage: number;
  itemPage: number;
  playerCard: Record<string, unknown>;
  map?: MapData | null;
  mapSource?: "agent" | "fallback" | "stored";
  /** ★ v4：区域运行时状态（城镇 + 6 野区） */
  regions?: RegionState[];
  /** ★ v4：城镇（安全区）建筑与中立角色 */
  town?: TownData | null;
  /** ★ fix⑤：前端 localEnemies 上报的当前关卡边界（半宽/半高，米）；有值时野怪生成与 AI 均夹进该范围 */
  mapBounds?: { lx: number; ly: number } | null;
  /** ★ fix⑤：前端 localEnemies 世代号（同世代重复上报视为宿主状态回推，直接忽略） */
  localMobsEpoch?: number;
  /** ★ v5：系统面板 —— 当前地图名（前端上报） */
  levelName?: string;
  /** ★ v5：纳戒（存物品与技能） */
  ring?: RingStore;
  /** ★ 对话功能：最近一次 sys_chat 的结果（前端按 reqId 配对取回，走 state 通道而非 HTTP 回包）
   *  结构：{ reqId, ok, mode, speaker, text, options, error } */
  chatResult?: {
    reqId: string;
    ok: boolean;
    mode: string;
    speaker?: string;
    text?: string;
    options?: string[];
    error?: string;
  } | null;
  /** ★ v5：组队跟随的角色 id 列表 */
  partyIds?: string[];
  /** ★ v5：角色卡（含地图名与坐标，落 t_plugin_session_data） */
  npcCards?: NpcCard[];
  /** ★ v5：背包物品展示元数据（稀有度 / 类型 / 恢复量 / 估价） */
  bagMeta?: Record<string, BagItem>;
  /** ★ v5：背包自定义排列顺序（物品名数组） */
  bagOrder?: string[];
  /** ★ v5：商城商品 */
  shopGoods?: ShopGood[];
  shopSource?: "agent" | "builtin";
  /** ★ v5：大地图节点（前端上报的关卡列表） */
  mapNodes?: MapNode[];
  /** ★ v5：面板数据版本号（用于前端感知传送等一次性指令） */
  sysRevision?: number;
  teleportTarget?: TeleportTarget | null;
  travelTarget?: TeleportTarget | null;
  /** ★ v5：回写宿主的用户动态参数卡补丁（items / skills / money），宿主消费后清空 */
  writeback?: Record<string, any> | null;
  // 结算
  exp: number;
  money: number;
  drops: string[];
  kills: number;
  events: string[];
  result: null | {
    reason: "exit" | "death";
    exp: number;
    money: number;
    drops: string[];
    kills: number;
    survivedTicks: number;
  };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/* ============================================================
   世界边界（与 25d_ai_game 的 map_config.json 完全一致）

     size = 3000m × 3000m, origin = (0, 0), 范围 ±1500 米
     所有 entity / 装饰物 / 宝箱 / 血瓶坐标单位：米
   ============================================================ */

/** x/z 范围（米），±1500 */
const WORLD_X_RANGE: [number, number] = [-1500, 1500];
const WORLD_Z_RANGE: [number, number] = [-1500, 1500];
/** 玩家出生点：mulberryTown 中心（Rotten-Soup mulberryTown.json Actors 层 PLAYER 在 (34,32) tile → 世界 (12.5, 4) ≈ (13, 4)） */
const PLAYER_SPAWN = { x: 13, y: 4 };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clampX = (v: number) => clamp(v, WORLD_X_RANGE[0] + 10, WORLD_X_RANGE[1] - 10);
const clampY = (v: number) => clamp(v, WORLD_Z_RANGE[0] + 10, WORLD_Z_RANGE[1] - 10);
const rndX  = () => rnd(WORLD_X_RANGE[0] + 80, WORLD_X_RANGE[1] - 80);
const rndY  = () => rnd(WORLD_Z_RANGE[0] + 80, WORLD_Z_RANGE[1] - 80);

/* ---- 战斗距离参数（米） ----
   MOVE_SPEED_M = 3 米/秒（一 tick 位移 = MOVE_SPEED_M × TICK_DT_S = 0.3 米）
   ★ 修复：原注释写作"3 米/帧"，与前端 3 米/秒 相差 10 倍，是位移异常/瞬移的根因之一
   ★ v4：敌人探测半径 = MOB_DETECT_M = 10 米（此前 MOB_VIEW_M=80 从未被敌人分支引用，
         野怪无视距离全图直线追击 —— 现在 10 米探测 → 追击 → 12 米脱战归位）
   mob 攻击 = 2 米；盟友视野 = 80 米；盟友跟随 = 12 米；盟友攻击 = 2 米
   开箱/拾血瓶 = 2 米；技能作用范围 = 30 米
   */
const MOVE_SPEED_M = 3.0;      // 米/秒
const TICK_DT_S = 0.1;         // 一次 tick = 100ms（与前端 TICK_MS 对齐）
const MOB_VIEW_M   = 80;       // ★ v4：仅盟友 AI 追击射程兜底用（敌人改用 MOB_DETECT_M）
/** ★ game.md《野怪和攻击机制》：近战距离 0.5 米（玩家/其他角色/野怪通用） */
const MOB_ATK_M    = 0.5;
const ALLY_ATK_M   = 0.5;
/** ★ game.md：野怪发起攻击的距离 = 4 米 —— 怪不打进玩家身边 4m 内，友军（护卫）不动手，
 *  且友军索敌锚点是「玩家」而不是友军自身（此前锚在友军身上，友军阵位散开 12m 后
 *  会挑离自己近的远怪围殴，出现「面前的不打、打很远的」）。 */
const ALLY_ENGAGE_M = 4;
/** 友军跟随阵位半径：2.5m（此前 12m —— 友军站位散得太开，是「打远的」帮凶） */
const ALLY_FOLLOW_GAP_M = 2.5;
const CHEST_PICKUP_M  = 2;
const POTION_PICKUP_M = 2;
/** ★ game.md：远程野怪/远程武器/远程技能 距离 4 米（此前 30 米） */
const SKILL_RANGE_M   = 4;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/* ============================================================
   ★ v4 区域刷新（Region Respawn）+ 城镇安全区 + 敌人探测/脱战
   ------------------------------------------------------------
   1) 世界按「城镇（安全区） + 6 个野区」划分（正六边形拓扑，区域名见 WORLD_REGIONS）；
      主角出生地 = 晨曦镇（安全区），镇内布置建筑与中立角色，城镇永不刷新野怪。
   2) 每个野区各自维护刷新计时：玩家离开该区域 45 秒后刷新一次野怪
      （补满该区域配额）；玩家在场时计时挂起；不再用 enemies.length===0 触发。
   3) 敌人探测半径 = MOB_DETECT_M（10 米），超出 MOB_DISENGAGE_M（12 米）脱战，
      归位到巢点（homeX/homeY）附近游荡。
   4) 敌人复活 = 区域刷新机制重新生成（死亡实体当帧从世界移除，不再残留 alive=false）。
   ============================================================ */

/** 区域刷新间隔：玩家离开该区域 45 秒后刷新一次（45s / 0.1s = 450 tick） */
const REGION_RESPAWN_SEC = 45;
const REGION_RESPAWN_TICKS = REGION_RESPAWN_SEC * 10;    // TICK_DT_S = 0.1
/** ★ game.md：野怪发起攻击的距离 = 4 米（探测=进入战斗） */
const MOB_DETECT_M = 4;
/** ★ game.md：超过 4 米野怪自己回到出生点（脱战归位；与探测同值，无迟滞带） */
const MOB_DISENGAGE_M = 4;
/** 离出生点超过此距离 → 归位（game.md：超过 4 米回出生点） */
const MOB_LEASH_R_M = 4;
/** 巢点周围游荡半径（必须在 MOB_LEASH_R_M 之内，否则游荡本身就触发归位抖动） */
const MOB_WANDER_R_M = 3;
/** 野怪落点距城镇边界的最小缓冲（保证城镇安全区内部无野怪） */
const TOWN_SPAWN_BUFFER_M = 20;

type RegionKind = "safe" | "forest" | "shore" | "mine" | "ruin" | "marsh" | "wild";

interface RegionDef {
  id: string;
  name: string;
  /** 短名（小地图/世界图标签，2 字） */
  short: string;
  kind: RegionKind;
  x: number; y: number; r: number;
  safe: boolean;
  /** 区域等级（决定野怪血量/攻击成长） */
  lv: number;
  /** 野怪配额（区域刷新时补满到这个数量） */
  mobs: number;
  desc: string;
}

/** 区域划分方案：城镇居中（安全区），6 个野区环绕（环半径 480 m，区域半径 240 m） */
const WORLD_REGIONS: RegionDef[] = [
  { id: "town",  name: "晨曦镇",   short: "晨曦", kind: "safe",   x: 0,    y: 0,     r: 160, safe: true,  lv: 0, mobs: 0, desc: "玩家出生的城镇（安全区）：商铺、民居、水井与中立居民，不刷新野怪" },
  { id: "wood",  name: "东岭林场", short: "东岭", kind: "forest", x: 480,  y: 0,     r: 240, safe: false, lv: 1, mobs: 4, desc: "低矮林地，狼群与哥布林斥候游荡" },
  { id: "shore", name: "东北浅滩", short: "东北", kind: "shore",  x: 240,  y: 416,   r: 240, safe: false, lv: 1, mobs: 3, desc: "水边滩地，毒蛇与蝙蝠出没" },
  { id: "mine",  name: "西北矿丘", short: "西北", kind: "mine",   x: -240, y: 416,   r: 240, safe: false, lv: 2, mobs: 4, desc: "废弃矿丘，骷髅兵与哥布林盘踞" },
  { id: "ruin",  name: "西郊废墟", short: "西郊", kind: "ruin",   x: -480, y: 0,     r: 240, safe: false, lv: 2, mobs: 4, desc: "残垣断壁，骷髅兵与荒野游荡者" },
  { id: "marsh", name: "西南沼地", short: "西南", kind: "marsh",  x: -240, y: -416,  r: 240, safe: false, lv: 3, mobs: 5, desc: "沼泽泥地，毒蛇群与巨狼" },
  { id: "wild",  name: "东南荒原", short: "东南", kind: "wild",   x: 240,  y: -416,  r: 240, safe: false, lv: 3, mobs: 5, desc: "开阔荒原，成群野兽巡行" },
];

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : v == null ? d : String(v);
}
function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** 技能名归一：剥离「（lv2，描述…）」等后缀 / 对象残留 */
function cleanSkillName(v: unknown): string {
  let n = v && typeof v === "object" ? str((v as any).name ?? (v as any).skill ?? "") : str(v);
  n = n.replace(/\[object Object\]/g, " ");
  n = n.replace(/[（(][^）)]*[）)]/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  n = n.replace(/[·、,，;；:：]+$/, "").trim();
  return n;
}
function skillKey(v: unknown): string {
  return cleanSkillName(v).toLowerCase();
}
function sameSkill(a: unknown, b: unknown): boolean {
  const ka = skillKey(a);
  return !!ka && ka === skillKey(b);
}
/** 按名字推断默认 type/range（参数卡同步过来的技能未显式配置时用） */
function inferSkillType(name: string): { type: "atk" | "heal" | "buff"; range: "melee" | "ranged" } {
  const n = String(name || "");
  if (/治|疗|愈|回复|恢复|回春|奶|复苏/.test(n)) return { type: "heal", range: "melee" };
  if (/盾|护|祝福|增益|强化|加攻|加防|buff/i.test(n)) return { type: "buff", range: "melee" };
  if (/球|箭|弹|术|咒|射|火|冰|雷|电|风|毒|远程/.test(n)) return { type: "atk", range: "ranged" };
  return { type: "atk", range: "melee" };
}
/** game.md buff 类型：防御/攻击/持续伤害/晕眩/无敌/加速 */
const BUFF_TYPES = ["Defense", "Attack", "Sustained_Damage", "Stunning", "Invincible", "Accelerate"];
/** 括号深度感知拆分：只在括号外按分隔符切技能（「A（lv1，失控）（lv1）、B（lv2）」不会切烂注记） */
function splitSkillList(raw) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const ch of String(raw)) {
    if (ch === "\uFF08" || ch === "(") depth += 1;
    else if (ch === "\uFF09" || ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && "\u3001,\uFF0C;\uFF1B/|".includes(ch)) { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
/** 从用户参数卡取技能（拆分/去重/lv 解析），套用 skillMeta 用户修改，补足占位技能 */
function buildSkills(card: Record<string, unknown> | undefined, n = 8, meta?: Record<string, any>): SkillSlot[] {
  const raw = Array.isArray(card?.skills) ? (card!.skills as unknown[]) : [];
  const seen = new Map<string, number>();
  const names: string[] = [];
  const lvs: number[] = [];
  raw.forEach((s) => {
    const parts = typeof s === "string" ? splitSkillList(s) : [s];
    parts.forEach((p) => {
      const nm = cleanSkillName(p).slice(0, 12);
      if (!nm) return;
      const lvM = String(typeof p === "string" ? p : str((p as any)?.name)).match(/lv\s*(\d+)/i);
      const lv = lvM ? Math.max(1, Math.round(Number(lvM[1]))) : 1;
      const c = (seen.get(nm) || 0) + 1;
      seen.set(nm, c);
      names.push(c === 1 ? nm : `${nm}${c}`);
      lvs.push(lv);
    });
  });
  const out: SkillSlot[] = [];
  for (let i = 0; i < n; i++) {
    const name = names[i] || (i < 4 ? `技能${i + 1}` : `备用技${i - 3}`);
    const base = inferSkillType(name);
    const m = meta && meta[skillKey(name)];
    out.push({
      name,
      power: num(m?.power, 12 + i * 3),
      cost: num(m?.cost, 0),
      cd: num(m?.cd, 24 + i * 6),
      cdLeft: 0,
      type: m?.type || base.type,
      range: m?.range || base.range,
      lv: num(m?.lv, lvs[i] || 1),
      buff_type: m?.buff_type || "",
    });
  }
  return out;
}

/** 从用户参数卡取物品，补足占位物品 */
function buildItems(card: Record<string, unknown> | undefined, n = 8): ItemSlot[] {
  const raw = Array.isArray(card?.items) ? (card!.items as unknown[]) : [];
  const names = raw
    .map((s) => (typeof s === "string" ? s : str((s as any)?.name)))
    .filter(Boolean);
  const out: ItemSlot[] = [];
  for (let i = 0; i < n; i++) {
    const name = names[i] || (i < 4 ? `物品${i + 1}` : `备用物${i - 3}`);
    out.push({ name, count: names[i] ? 2 : 1, heal: 20 });
  }
  return out;
}

function makeEntity(
  role: Record<string, unknown> | undefined,
  side: Entity["side"],
  x: number,
  y: number,
  idx: number,
): Entity {
  const hp = num(role?.hp, side === "enemy" ? 60 : 100) || 100;
  return {
    id: str(role?.id, `${side}_${idx}`),
    name: str(role?.name, side === "enemy" ? `野兽${idx + 1}` : `角色${idx + 1}`),
    side,
    x,
    y,
    vx: 0,
    vy: 0,
    hp,
    maxHp: hp,
    atk: side === "enemy" ? 8 : 14,
    level: num(role?.level, 1) || 1,
    avatarPath: str(role?.avatarPath) || undefined,
    facing: 0,   // 角度制：0=右 90=下 180=左 270=上
    cooldown: 0,
    alive: true,
  };
}

function emptyState(ctx?: PluginGameContext): FieldSurvivalState {
  const card = (ctx?.playerCard || {}) as Record<string, unknown>;
  return {
    phase: "select",
    version: 3,                  // v3：3000m 世界 + 米单位 + scale 元数据
    tick: 0,
    world: { w: WORLD_X_RANGE[1] - WORLD_X_RANGE[0], h: WORLD_Z_RANGE[1] - WORLD_Z_RANGE[0] },
    /** v3 增强：玩家出生点 (0,0) */
    spawn: { ...PLAYER_SPAWN },
    /** v3 增强：scale / 视距配置 */
    scale: {
      meter: TERRAIN_SCALE_METER,
      block_size: TERRAIN_BLOCK_SIZE_M,
      chunk_size_blocks: CHUNK_SIZE_BLOCKS,
      chunk_size_meters: CHUNK_SIZE_M,
      ground_size: TERRAIN_GROUND_SIZE_M,
      ground_height: TERRAIN_GROUND_HEIGHT_M,
      x_range: [...WORLD_X_RANGE],
      z_range: [...WORLD_Z_RANGE],
    },
    roles: Array.isArray(ctx?.roles) ? ctx!.roles! : [],
    selections: { participants: [], spectators: [], enemies: [] },
    /** ★ fix⑤：前端 localEnemies 状态（开局未上报 bounds 时按世界边界处理） */
    mapBounds: null,
    localMobsEpoch: 0,
    entities: [],
    chests: [],
    potions: [],
    floaters: [],
    vfx: [],   // ★ game.md 打击特效：宿主侧生成的战斗粒子（spark/explosion/slash_arc/fireball/heal_ring/buff_ring）
    skills: buildSkills(card),
    items: buildItems(card),
    skillMeta: {},
    itemMeta: {},
    skillPage: 0,
    itemPage: 0,
    playerCard: card,
    exp: 0,
    money: 0,
    drops: [],
    kills: 0,
    events: [],
    map: null,
    mapSource: "fallback",
    regions: [],                 // ★ v4：由 initRegions() 填充（城镇 + 6 野区）
    town: null,                  // ★ v4：由 ensureTown() 填充（建筑 + 中立角色）
    result: null,
  };
}

// ---------------------------------------------------------------------------
// 战斗与推进
// ---------------------------------------------------------------------------

/** 按地图 archetypes 生成一波敌人/宝箱/血瓶（无地图时回退内置逻辑）
 *  ★ v3：怪物 spawn 在玩家周围 ±100 米（玩家在 (0,0)，开局就能看见） */
/** ★ fix③：波次/敌人落点统一围绕玩家当前位置（而不是全图随机） */
function spawnAnchor(s: FieldSurvivalState, minM: number, maxM: number): { x: number; y: number } {
  const p = s.entities.find((e) => e.side === "player");
  const cx = p ? p.x : PLAYER_SPAWN.x;
  const cy = p ? p.y : PLAYER_SPAWN.y;
  const angle = rnd(0, Math.PI * 2);
  const distM = minM + rnd(0, maxM - minM);
  return { x: clampX(cx + Math.cos(angle) * distM), y: clampY(cy + Math.sin(angle) * distM) };
}

function spawnWave(s: FieldSurvivalState, wave: number) {
  // 找玩家（怪物围着他刷）
  const player = s.entities.find((e) => e.side === "player");
  const px = player?.x ?? PLAYER_SPAWN.x;
  const py = player?.y ?? PLAYER_SPAWN.y;

  const archs = (s.map?.enemy_archetypes && s.map.enemy_archetypes.length)
    ? s.map.enemy_archetypes
    : null;
  if (archs) {
    const wavesCfg = (s.map?.waves && s.map.waves.length ? s.map.waves : [{ archetype: archs[0].id, count: 3, interval: 600 }]);
    const pick = wavesCfg[Math.min(wave - 1, wavesCfg.length - 1)] || wavesCfg[0];
    const arch = archs.find((a) => a.id === pick.archetype) || archs[0];
    const count = Math.max(1, Math.min(6, num(pick.count, 3) + Math.floor(wave / 3)));
    for (let i = 0; i < count; i++) {
      const angle = rnd(0, Math.PI * 2);
      const dist = 30 + rnd(0, 70);              // 30-100 米
      const e = makeEntity(
        { id: `${arch.id}_${wave}_${i}`, name: arch.name, hp: Math.round(arch.hp + (wave - 1) * 8), level: arch.lv },
        "enemy",
        clampX(px + Math.cos(angle) * dist),
        clampY(py + Math.sin(angle) * dist),
        i,
      );
      e.atk = Math.round(arch.atk + (wave - 1) * 1.5);
      (e as any).bounty = { ...arch.bounty };
      (e as any).def = arch.def;
      s.entities.push(e);
    }
    // 宝箱/血瓶只在第一波铺设（地图数据，x/y 已在 ±1500 范围内）
    if (wave === 1) {
      (s.map?.chests || []).forEach((c, i) => {
        s.chests.push({ id: `chest_map_${i}`, x: clampX(c.x), y: clampY(c.y), opened: false, ...(c as any) });
      });
      (s.map?.potions || []).forEach((p, i) => {
        s.potions.push({ id: `potion_map_${i}`, x: clampX(p.x), y: clampY(p.y), heal: num(p.heal, 40) });
      });
    }
    return;
  }
  // 内置回退
  const count = Math.min(2 + wave, 6);
  for (let i = 0; i < count; i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist = 30 + rnd(0, 70);
    const e = makeEntity(
      { id: `enemy_${s.tick}_${i}`, name: `野兽 ${i + 1}`, hp: 45 + wave * 12, level: wave },
      "enemy",
      clampX(px + Math.cos(angle) * dist),
      clampY(py + Math.sin(angle) * dist),
      i,
    );
    e.atk = 7 + wave * 2;
    s.entities.push(e);
  }
  for (let i = 0; i < 2; i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist = 25 + rnd(0, 30);
    s.chests.push({ id: `chest_${s.tick}_${i}`, x: clampX(px + Math.cos(angle) * dist), y: clampY(py + Math.sin(angle) * dist), opened: false });
  }
  for (let i = 0; i < 3; i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist = 20 + rnd(0, 25);
    s.potions.push({ id: `potion_${s.tick}_${i}`, x: clampX(px + Math.cos(angle) * dist), y: clampY(py + Math.sin(angle) * dist), heal: 18 });
  }
}

function pushEvent(s: FieldSurvivalState, text: string) {
  s.events.push(text);
  if (s.events.length > 40) s.events = s.events.slice(-40);
}

function floater(s: FieldSurvivalState, text: string, x: number, y: number) {
  s.floaters.push({ id: `f_${s.tick}_${Math.random().toString(36).slice(2, 6)}`, text, x, y, life: 24 });
  if (s.floaters.length > 30) s.floaters = s.floaters.slice(-30);
}

/** ★ game.md 打击特效：宿主侧推送 VFX 粒子（kind 与前端 drawVfxLayer 对齐） */
function pushVfx(s: FieldSurvivalState, p: Record<string, any>) {
  if (!Array.isArray((s as any).vfx)) (s as any).vfx = [];
  (s as any).vfx.push({ id: `vfx_${s.tick}_${Math.random().toString(36).slice(2, 6)}`, ...p });
  if ((s as any).vfx.length > 60) (s as any).vfx = (s as any).vfx.slice(-60);
}

/**
 * ★ game.md「默认 4 个技能特效沿用」：按技能名归类特效
 *   远程类 → 火球(atk/ranged)  治疗类 → 治疗(heal)
 *   加强类 → 护盾(buff)        其余 → 冲斩(atk/melee)
 */
function skillFxKind(skill: { name: string; type?: string; range?: string }): "melee" | "ranged" | "heal" | "buff" {
  // ★ game.md 技能修改：显式 type/range 优先（atk+melee→冲斩刀光 / atk+ranged→火球 / heal→治疗环 / buff→护盾环）
  const t = String((skill as any)?.type || "");
  if (t === "heal") return "heal";
  if (t === "buff") return "buff";
  if (t === "atk") return str((skill as any)?.range, "melee") === "ranged" ? "ranged" : "melee";
  const n = String(skill?.name || "");
  if (/治|疗|愈|回复|恢复|回春|奶|复苏/.test(n)) return "heal";
  if (/盾|护|祝福|增益|强化|加攻|加防|buff/i.test(n)) return "buff";
  if (/球|箭|弹|术|咒|射|火|冰|雷|电|风|毒|远程/.test(n)) return "ranged";
  return "melee";
}

function damage(s: FieldSurvivalState, target: Entity, amount: number, attacker?: Entity) {
  target.hp = clamp(target.hp - amount, 0, target.maxHp);
  // ★ game.md 普攻特效：被击者白闪 + 命中火花/爆炸；攻击者小跳（amount=0 的「未命中」占位不触发）
  if (amount > 0) {
    (target as any).hitFlashMs = 250;
    pushVfx(s, { kind: "spark", entityId: target.id, x: target.x, y: target.y, life: 8, total: 8, color: "#ff5a5a" });
    pushVfx(s, { kind: "explosion", entityId: target.id, x: target.x, y: target.y, life: 6, total: 6, color: "#ff8c3a" });
    if (attacker) (attacker as any).actionBobMs = 300;
    floater(s, `-${Math.round(amount)}`, target.x, target.y - 24);
  }
    if (target.hp <= 0 && target.alive) {
    target.alive = false;
    if (target.side === "enemy") {
      s.kills += 1;
      // 优先地图 archetype 的赏金（map-gener agent 产出）
      const bounty = (target as any).bounty as { exp?: number; money?: number } | undefined;
      const expGain = bounty?.exp != null ? Math.round(num(bounty.exp, 10)) : 8 + target.level * 4;
      const moneyGain = bounty?.money != null ? Math.round(num(bounty.money, 8)) : 5 + target.level * 3;
      gainPlayerExp(s, expGain);      // ★ 等级系统：经验累加 + 升级判定（满血满蓝重算）
      s.money += moneyGain;
      if (Math.random() < 0.5) {
        const drop = ["野兽皮", "锋利的爪", "兽骨"][Math.floor(Math.random() * 3)];
        s.drops.push(drop);
      }
      pushEvent(s, `击败 ${target.name}，获得 ${expGain} 经验、${moneyGain} 金钱`);
      // ★ v5：与用户组队的角色分享经验并升级
      grantPartyExp(s, expGain);
    } else {
      pushEvent(s, `${target.name} 倒下了`);
    }
  }
}

function moveTowards(e: Entity, tx: number, ty: number, speed: number) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = (dx / d) * speed;
  e.vy = (dy / d) * speed;
  if (Math.abs(dx) > 2) e.facing = dx > 0 ? 0 : 180;   // 角度制：0=右 180=左
}

/* ------------------------------------------------------------
   ★ v4 区域系统工具（区域判定 / 城镇 / 区域刷新 / 野怪生成）
   ------------------------------------------------------------ */

/** 判断坐标落在哪个区域（城镇优先；野区取最近中心 —— 与六边形拓扑等价） */
function regionAt(x: number, y: number): RegionDef {
  const p = { x, y };
  const town = WORLD_REGIONS[0];
  if (dist(p, town) <= town.r) return town;
  let best = WORLD_REGIONS[1];
  let bestD = Infinity;
  for (let i = 1; i < WORLD_REGIONS.length; i++) {
    const r = WORLD_REGIONS[i];
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/** 离给定坐标最近的野区（城镇出生点用：敌对角色落点不在城镇内） */
function nearestWildRegion(x: number, y: number): RegionDef {
  let best = WORLD_REGIONS[1];
  let bestD = Infinity;
  for (let i = 1; i < WORLD_REGIONS.length; i++) {
    const r = WORLD_REGIONS[i];
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/* ============================================================
   ★ fix⑤（缺口①）前端 localEnemies 载荷接管
   ------------------------------------------------------------
   前端 App.vue 在「本地敌怪集合结构性变化」时，把整份清单随 tick 上报：
     localEnemies = { epoch, bounds: { lx, ly }, list: [ 敌怪实体… ] }
     - list  ：mapmob_* / localmob_* / zone_* 三前缀的敌怪（前端权威集合）
     - bounds：当前关卡半宽/半高（米），如 Mulberry Forest 仅 ±29 m
   此前宿主对本载荷无任何处理逻辑 → 宿主实体表里没有这批怪，
   于是「玩家攻击不到野怪（恒未命中）」「野怪不攻击（宿主侧无此怪）」。
   本段实现：按 epoch 幂等重建宿主敌怪表，使其进入既有「野怪 AI + skill 命中判定」，
   并把野怪 AI 的游荡/追击/归位与生成落点夹进 bounds。
   ============================================================ */

/** 前端权威敌怪的 id 前缀（与 App.vue localEnemiesPayload 的过滤条件一致） */
const LOCAL_ENEMY_PREFIXES = ["mapmob_", "localmob_", "zone_"];

/** 是否「前端权威敌怪」的 id */
function isLocalEnemyId(id: unknown): boolean {
  const v = str(id);
  return LOCAL_ENEMY_PREFIXES.some((p) => v.startsWith(p));
}

/* ============================================================
   ★ 敌人碰撞（宿主侧）
   ------------------------------------------------------------
   墙的位置只有 iframe 侧知道（tileset 的 blocked 属性 + 地图 JSON 都在前端解），
   所以前端随 tick 把压缩位图传过来（params.walkGrid，只在切图那一次）：
     walkGrid = { epoch, grid: { v, cols, rows, firstGid, blocked, vision } }
   拿到网格后，敌人在 step() 的积分阶段改走带碰撞的位移：
   撞墙不是原地抖，而是按「与期望方向最接近」的顺序试其余方向 → 沿墙绕行。
   没收到网格 / 解码失败 → 完全退化为原来的直线位移（行为与旧版一致，不会崩）。

   ⚠️ 本段是 vue/src/collision.ts（stepWithAvoidance / resolveMove / isFreeAround）
      的**内联镜像**。宿主入口刻意不加任何 import：宿主加载器不一定支持相对/跨目录
      导入，一旦加载失败整个插件就挂，风险远大于这点重复。
      改算法时请同步三处：vue/src/collision.ts、entry.ts、entry.js。
   ============================================================ */

/** 宿主侧的最小网格（只需要挡住 / 不挡住；视野位图前端自己用） */
interface EnemyNavGrid { cols: number; rows: number; blocked: Uint8Array }
/** 当前关卡可行走网格；null = 无碰撞（与旧行为完全一致） */
let enemyNav: EnemyNavGrid | null = null;
/** 已应用的网格世代号（幂等，避免每 tick 重复解码同一份 base64） */
let enemyNavEpoch = "";
/** 敌人碰撞半径（米）。比玩家的 0.4 略小：1 米宽的窄门里不至于卡住 */
const ENEMY_NAV_R = 0.38;

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 → 字节。不依赖 atob（宿主运行时未必有） */
function b64ToBytes(b64: string): Uint8Array | null {
  const clean = String(b64 || "").replace(/[^A-Za-z0-9+/]/g, "");
  if (!clean) return null;
  const n = clean.length;
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const v = B64_ALPHABET.indexOf(clean.charAt(i));
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.slice(0, o);
}

/**
 * 应用前端上报的网格。epoch 幂等；解码失败 → 保留旧网格（不降级成"无碰撞"，
 * 否则一次坏包就会让敌人穿墙一整局）。
 */
function applyEnemyNavPayload(payload: any): void {
  if (!payload || typeof payload !== "object") return;
  const epoch = str((payload as any).epoch, "");
  if (epoch && epoch === enemyNavEpoch) return;
  const pkt = (payload as any).grid;
  if (!pkt || num((pkt as any).v, 0) !== 1) return;
  const cols = num((pkt as any).cols, 0);
  const rows = num((pkt as any).rows, 0);
  const total = cols * rows;
  if (!(cols > 0) || !(rows > 0) || total > 4000000) return;
  const bytes = b64ToBytes(str((pkt as any).blocked, ""));
  if (!bytes || bytes.length !== total) {
    console.warn("[field-survival] walkGrid 载荷解码失败，保持上一份网格：", bytes?.length, total);
    return;
  }
  enemyNav = { cols, rows, blocked: bytes };
  enemyNavEpoch = epoch;
}

function navBlocked(g: EnemyNavGrid, gx: number, gz: number): boolean {
  if (gx < 0 || gx >= g.cols || gz < 0 || gz >= g.rows) return true;   // 越界一律挡
  return g.blocked[gz * g.cols + gx] === 1;
}

/** 以 (x, y) 为中心、半径 r 的方内是否全可走（与玩家同一套判定） */
function navFree(g: EnemyNavGrid, x: number, y: number, r: number): boolean {
  const toGx = (mx: number) => Math.floor(mx + g.cols / 2);
  const toGz = (my: number) => Math.floor(my + g.rows / 2);
  if (r <= 0) return !navBlocked(g, toGx(x), toGz(y));
  const left = toGx(x - r);
  const right = toGx(x + r);
  const top = toGz(y - r);
  const bottom = toGz(y + r);
  return (
    !navBlocked(g, left, top) && !navBlocked(g, right, top) &&
    !navBlocked(g, left, bottom) && !navBlocked(g, right, bottom)
  );
}

/** 分轴求解：X 被挡只丢 X、Z 继续 → 撞墙可沿墙滑行；起点已在墙里则放行（自解困） */
function navResolve(
  g: EnemyNavGrid, x: number, y: number, nx: number, ny: number, r: number,
): { x: number; y: number } {
  if (!navFree(g, x, y, r)) return { x: nx, y: ny };
  let outX = x;
  let outY = y;
  if (navFree(g, nx, y, r)) outX = nx;
  if (navFree(g, outX, ny, r)) outY = ny;
  return { x: outX, y: outY };
}

/** 八向候选（顺序即"优先直行，然后偏 45°，最后偏 90°"） */
const NAV_DIRS: Array<[number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * 带局部避障的一步位移：期望方向优先，被挡就按点积（方向相似度）试其余方向。
 * 不做 A*（几十只怪每 tick 各跑一次 A* 开销太大）；效果是沿墙绕行而不是原地抖。
 */
function navStep(
  g: EnemyNavGrid, x: number, y: number, dx: number, dy: number, step: number, r: number,
): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return { x, y };
  const ux = dx / len;
  const uy = dy / len;
  const order = NAV_DIRS
    .map(([ax, ay]) => {
      const l = Math.hypot(ax, ay);
      const nx = ax / l;
      const ny = ay / l;
      return { nx, ny, dot: nx * ux + ny * uy };
    })
    .filter((c) => c.dot > -0.35)                 // 不往回走
    .sort((a, b) => b.dot - a.dot);
  for (const c of order) {
    const nx = x + c.nx * step;
    const ny = y + c.ny * step;
    if (navFree(g, nx, ny, r)) return { x: nx, y: ny };
  }
  return navResolve(g, x, y, x + ux * step, y + uy * step, r);
}

/** 环状 BFS 找最近可站格（刷点压在墙上时用） */
function navNearestFree(
  g: EnemyNavGrid, x: number, y: number, r: number, maxRing = 8,
): { x: number; y: number } | null {
  const cgx = Math.floor(x + g.cols / 2);
  const cgz = Math.floor(y + g.rows / 2);
  const center = (gx: number, gz: number) => ({
    x: gx - g.cols / 2 + 0.5,
    y: gz - g.rows / 2 + 0.5,
  });
  if (navFree(g, x, y, r)) return { x, y };
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let d = -ring; d <= ring; d++) {
      const cand: Array<[number, number]> = [
        [cgx + d, cgz - ring], [cgx + d, cgz + ring],
        [cgx - ring, cgz + d], [cgx + ring, cgz + d],
      ];
      for (const [gx, gz] of cand) {
        const c = center(gx, gz);
        if (navFree(g, c.x, c.y, r)) return c;
      }
    }
  }
  return null;
}

/** 带碰撞的一步敌方位移（无网格 → 原样直线位移，行为与旧版一致） */
function moveEnemyCollide(e: Entity, dx: number, dy: number): void {
  if (!enemyNav) { e.x += dx; e.y += dy; return; }
  const step = Math.hypot(dx, dy);
  if (step < 1e-6) return;
  const p = navStep(enemyNav, e.x, e.y, dx, dy, step, ENEMY_NAV_R);
  e.x = p.x;
  e.y = p.y;
}

/**
 * 把落在墙里 / 越界的敌怪挪到最近的合法格。
 * 刷点来源五花八门（Tiled 对象、环状随机、安全区推出），逐个改源头易漏 →
 * 统一在每 tick 的积分阶段做一次廉价纠正（合法位置的怪是 no-op）。
 */
function unstickEnemies(s: FieldSurvivalState): void {
  if (!enemyNav) return;
  for (const e of s.entities) {
    if (e.side !== "enemy" || !e.alive) continue;
    if (navFree(enemyNav, e.x, e.y, ENEMY_NAV_R)) continue;
    const c = navNearestFree(enemyNav, e.x, e.y, ENEMY_NAV_R);
    if (!c) continue;
    e.x = c.x;
    e.y = c.y;
    if ("homeX" in (e as any) && !navFree(enemyNav, num((e as any).homeX, c.y), ENEMY_NAV_R)) {
      (e as any).homeX = c.x;
    }
    if ("homeY" in (e as any) && !navFree(enemyNav, c.x, num((e as any).homeY), ENEMY_NAV_R)) {
      (e as any).homeY = c.y;
    }
  }
}

/**
 * 当前关卡 AI 边界（半宽/半高，米）：有前端 bounds 用 bounds，否则回退世界边界 ±1490
 */
function mapBound(s: FieldSurvivalState): { lx: number; ly: number } {
  const b = s.mapBounds;
  if (b && num(b.lx, 0) > 0 && num(b.ly, 0) > 0) return { lx: num(b.lx, 0), ly: num(b.ly, 0) };
  return { lx: WORLD_X_RANGE[1] - 10, ly: WORLD_Z_RANGE[1] - 10 };
}

/** 把坐标夹进当前关卡边界（仅用于野怪生成 / AI 落点，不改玩家位姿镜像） */
function clampToBound(s: FieldSurvivalState, x: number, y: number): { x: number; y: number } {
  const b = mapBound(s);
  return { x: clamp(x, -b.lx, b.lx), y: clamp(y, -b.ly, b.ly) };
}

/** 某野区是否完全落在当前关卡之外（是 → 本图不存在该野区，不排刷，避免"每张图都有野怪"） */
function regionOutOfMap(s: FieldSurvivalState, r: RegionDef): boolean {
  const b = s.mapBounds;
  if (!b || !(num(b.lx, 0) > 0) || !(num(b.ly, 0) > 0)) return false;
  return Math.abs(r.x) - r.r >= num(b.lx, 0) || Math.abs(r.y) - r.r >= num(b.ly, 0);
}

/**
 * 按前端上报重建「当前关卡敌怪表」：
 *   ① epoch 未变（宿主状态回推）→ 幂等跳过；
 *   ② 先移除旧的 mapmob_/localmob_/zone_ 敌怪（含死亡残留与上一张图的怪）；
 *   ③ 按 list 逐个重建为宿主 Entity（homeX/homeY 取上报值或当前位，均夹进 bounds）。
 * 返回实际重建数量。
 */
function applyLocalEnemies(s: FieldSurvivalState, payload: any): number {
  if (!payload || typeof payload !== "object") return 0;
  const epoch = num((payload as any).epoch, 0);
  if (epoch > 0 && num(s.localMobsEpoch, 0) === epoch) return 0;      // 该世代已接管，忽略回推
  const b = ((payload as any).bounds || {}) as Record<string, unknown>;
  const lx = num(b.lx, 0);
  const ly = num(b.ly, 0);
  if (lx > 0 && ly > 0) s.mapBounds = { lx, ly };
  const list: any[] = Array.isArray((payload as any).list) ? (payload as any).list : [];
  // ② 清旧（幂等：重建前先清，避免跨图 / 跨世代残留）
  s.entities = s.entities.filter((e) => !(e.side === "enemy" && isLocalEnemyId(e.id)));
  // ②b 清掉「宿主自行在世界野区（240~480 m）刷出的怪」中已经落到本图界外的那些：
  //     前端权威清单已代表当前关卡的敌怪，界外的宿主怪在小地图里既看不到也打不到
  if (lx > 0 && ly > 0) {
    s.entities = s.entities.filter(
      (e) => !(e.side === "enemy" && !isLocalEnemyId(e.id) && (Math.abs(e.x) > lx || Math.abs(e.y) > ly)),
    );
  }
  // ③ 重建
  let built = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const side = str((raw as any).side);
    if (side && side !== "enemy") continue;                          // 只接管敌怪
    if ((raw as any).alive === false) continue;                      // 已阵亡的不重建
    const id = str((raw as any).id);
    if (!id) continue;
    const lv = Math.max(1, Math.round(num((raw as any).level, 1)));
    const maxHp = Math.max(1, Math.round(num((raw as any).maxHp, num((raw as any).hp, 60)) || 60));
    const at = clampToBound(s, num((raw as any).x, 0), num((raw as any).y, 0));
    const e = makeEntity({ id, name: str((raw as any).name, "野怪"), hp: maxHp, level: lv }, "enemy", at.x, at.y, built);
    const ex = e as any;
    e.hp = clamp(Math.round(num((raw as any).hp, maxHp)), 1, maxHp);  // 保留前端当前血量
    e.maxHp = maxHp;
    e.atk = Math.max(1, Math.round(num((raw as any).atk, e.atk)));
    e.facing = num((raw as any).facing, e.facing);
    e.cooldown = Math.max(0, Math.round(num((raw as any).cooldown, 0)));
    const home = clampToBound(s, num((raw as any).homeX, at.x), num((raw as any).homeY, at.y));
    ex.isLocal = true;                                               // 标记：AI 受 bounds 约束
    ex.regionId = str((raw as any).regionId, "local");
    ex.homeX = home.x;
    ex.homeY = home.y;
    ex.aiState = "idle";
    ex.wanderTimer = 0;
    if ((raw as any).bounty && typeof (raw as any).bounty === "object") ex.bounty = { ...(raw as any).bounty };
    s.entities.push(e);
    built += 1;
  }
  s.localMobsEpoch = epoch > 0 ? epoch : num(s.localMobsEpoch, 0);
  return built;
}

/** 各区域野怪名称（刻意与前端 mobKeyFor 的精灵映射对齐：
 *  狼/兽→orc、蛇→snake、蝠→bat、骷髅→skeleton、默认→goblin） */
const REGION_MOB_NAMES: Record<string, string[]> = {
  wood:  ["巨狼", "哥布林斥候"],
  shore: ["毒蛇", "蝙蝠"],
  mine:  ["骷髅兵", "哥布林斥候"],
  ruin:  ["骷髅兵", "荒野游荡者"],
  marsh: ["毒蛇", "巨狼"],
  wild:  ["哥布林斥候", "巨狼", "荒野游荡者"],
};

/** 野怪属性模板（无地图数据时的内置保底，与前端兜底野怪同源） */
const MOB_PRESETS: Record<string, { hp: number; atk: number }> = {
  "哥布林斥候": { hp: 30, atk: 6 },
  "巨狼":       { hp: 60, atk: 10 },
  "毒蛇":       { hp: 25, atk: 8 },
  "蝙蝠":       { hp: 20, atk: 5 },
  "骷髅兵":     { hp: 50, atk: 12 },
  "荒野游荡者": { hp: 40, atk: 6 },
};

let _mobSeq = 0;

/** 初始化区域运行时状态（进入 playing 时调用；旧 state 缺 regions 时在 tick 里自愈补建） */
function initRegions(s: FieldSurvivalState): void {
  s.regions = WORLD_REGIONS.map((r) => ({
    id: r.id, name: r.name, short: r.short, kind: r.kind,
    x: r.x, y: r.y, r: r.r, safe: r.safe, lv: r.lv, mobs: r.mobs, desc: r.desc,
    aliveCount: 0, playerInside: false, leftTick: -1, nextSpawnTick: -1, spawnCount: 0,
  }));
}

/** 某区域内当前存活的野怪数量 */
function countAliveInRegion(s: FieldSurvivalState, regionId: string): number {
  let n = 0;
  for (const e of s.entities) {
    if (e.side === "enemy" && e.alive !== false && (e as any).regionId === regionId) n++;
  }
  return n;
}

/** 在区域内取一个合法落点（避让城镇安全缓冲；尽量不贴脸玩家） */
function regionSpawnPoint(s: FieldSurvivalState, region: RegionDef): { x: number; y: number } {
  const player = s.entities.find((e) => e.side === "player");
  const town = WORLD_REGIONS[0];
  let x = region.x, y = region.y;
  for (let t = 0; t < 8; t++) {
    const a = rnd(0, Math.PI * 2);
    const d = region.r * (0.35 + rnd(0, 0.55));      // 0.35r ~ 0.9r：落点留在本区域内
    // ★ fix⑤：落点同时夹进「当前关卡 bounds」（前端上报）与世界边界
    const cb = clampToBound(s, region.x + Math.cos(a) * d, region.y + Math.sin(a) * d);
    const cx = clampX(cb.x);
    const cy = clampY(cb.y);
    if (Math.hypot(cx - town.x, cy - town.y) < town.r + TOWN_SPAWN_BUFFER_M) continue;  // 不进城镇
    if (player && player.alive && Math.hypot(cx - player.x, cy - player.y) < 12) continue;  // 不贴脸
    x = cx; y = cy;
    break;
  }
  return { x, y };
}

/** 在指定区域生成 n 只野怪（★ v4：敌人复活即由此重新生成，不再依赖 alive=false 残留实体） */
function spawnRegionMobs(s: FieldSurvivalState, region: RegionDef, n: number): void {
  const names = REGION_MOB_NAMES[region.id] || ["荒野游荡者"];
  const archs = (s.map?.enemy_archetypes && s.map.enemy_archetypes.length) ? s.map.enemy_archetypes : null;
  const lv = Math.max(1, region.lv);
  for (let i = 0; i < n; i++) {
    const name = names[(_mobSeq + i) % names.length];
    const at = regionSpawnPoint(s, region);
    const preset = MOB_PRESETS[name] || { hp: 40, atk: 6 };
    const arch = archs ? archs[(_mobSeq + i) % archs.length] : null;
    const hp = Math.round((arch ? num(arch.hp, preset.hp) * 0.6 : preset.hp) + (lv - 1) * 10);
    const e = makeEntity({ id: `mob_${region.id}_${_mobSeq++}`, name, hp, level: lv }, "enemy", at.x, at.y, i);
    e.atk = Math.round((arch ? num(arch.atk, preset.atk) * 0.6 : preset.atk) + (lv - 1) * 2);
    (e as any).regionId = region.id;
    (e as any).homeX = at.x;
    (e as any).homeY = at.y;
    (e as any).aiState = "idle";
    (e as any).wanderTimer = 0;
    (e as any).bounty = (arch && (arch as any).bounty)
      ? { ...(arch as any).bounty }
      : { exp: 8 + lv * 4, money: 5 + lv * 3 };
    s.entities.push(e);
  }
}

/** 区域刷新计时器：玩家离开某区域 → 该区域 45 秒后刷新一次（补满配额） */
function regionTick(s: FieldSurvivalState, player: Entity): void {
  if (!Array.isArray(s.regions) || !s.regions.length) initRegions(s);
  if (!s.town || !(s.town as any).buildings) ensureTown(s);
  const cur = regionAt(player.x, player.y);
  for (const r of s.regions!) {
    const inside = r.id === cur.id;
    r.aliveCount = countAliveInRegion(s, r.id);
    if (inside) {
      // 玩家在场：刷新计时挂起（不刷新），清除"刚离开"排期
      r.playerInside = true;
      r.leftTick = -1;
      r.nextSpawnTick = -1;
      continue;
    }
    const wasInside = r.playerInside;
    r.playerInside = false;
    if (r.safe) continue;                              // 城镇（安全区）永不刷新野怪
    // ★ fix⑤（缺口①）：区域圆心落在当前关卡之外 → 本图不存在该野区，不排刷
    //   （否则任何一张小地图都会被宿主的世界级六野区持续补怪，表现为"每张图都有野怪"）
    if (regionOutOfMap(s, r)) {
      r.leftTick = -1;
      r.nextSpawnTick = -1;
      continue;
    }
    if (wasInside || r.nextSpawnTick < 0) {
      // 玩家刚离开该区域（或从未排期）→ 从此刻起 45 秒后刷新一次
      r.leftTick = s.tick;
      r.nextSpawnTick = s.tick + REGION_RESPAWN_TICKS;
      continue;
    }
    if (s.tick >= r.nextSpawnTick) {
      const gap = Math.max(0, r.mobs - r.aliveCount);
      if (gap > 0) {
        spawnRegionMobs(s, r, gap);
        r.spawnCount += 1;
        pushEvent(s, `「${r.name}」重新聚集了 ${gap} 只野怪`);
      }
      r.nextSpawnTick = s.tick + REGION_RESPAWN_TICKS;  // 持续驻留刷新（每 45s 一次）
    }
  }
}

/**
 * 城镇（安全区）建筑清单
 *
 * 坐标单位「米」，矩形中心 + 宽高。
 * w / h 现在是「瓦片数」（1 瓦片 ≈ 1 米，与 Rotten-Soup mulberryTown.json
 * 单格对齐），前端按 tileset 真实像素平铺绘制。
 *   - inn   6×7 大体量双段屋顶（与 RS 大屋相近）
 *   - shop  5×6 中型铺面
 *   - house 4×5 标准民居（mulberryTown.json 主要房屋尺寸）
 *   - well  2×2 水井
 */
const TOWN_BUILDINGS: Array<{ kind: string; name: string; x: number; y: number; w: number; h: number }> = [

];

/** 城镇中立角色（不参与战斗，仅作安全区氛围） */
const TOWN_NPCS: Array<{ name: string; x: number; y: number }> = [
];

/** 建立城镇（安全区）：建筑清单 + 中立角色实体（幂等） */
function ensureTown(s: FieldSurvivalState): void {
  const town = WORLD_REGIONS[0];
  if (!s.town || !(s.town as any).buildings) {
    s.town = {
      id: town.id, name: town.name, x: town.x, y: town.y, r: town.r, safe: true,
      buildings: TOWN_BUILDINGS.map((b, i) => ({ ...b, id: `b_${i}` })),
      npcs: TOWN_NPCS.map((n, i) => ({ id: `npc_${i}`, ...n })),
    };
  }
  if (!s.entities.some((e) => e.side === "neutral")) {
    TOWN_NPCS.forEach((n, i) => {
      const e = makeEntity({ id: `npc_${i}`, name: n.name, hp: 200 }, "neutral", n.x, n.y, i);
      e.atk = 0;
      e.facing = [0, 90, 180, 270][i % 4];
      (e as any).regionId = town.id;
      (e as any).homeX = n.x;
      (e as any).homeY = n.y;
      (e as any).aiState = "npc";
      s.entities.push(e);
    });
  }
}

function step(s: FieldSurvivalState, input: any, poseHint?: any) {
  // 速度统一为"米/秒"，位移按 MOVE_SPEED_M × TICK_DT_S 积分
  const speed = MOVE_SPEED_M;
  const player = s.entities.find((e) => e.side === "player");
  if (!player || !player.alive) return;

  /* ★ 关键修复（坐标双写）：玩家位姿的权威在客户端。
     game.html 每 100ms 已在本地推进一次玩家坐标，并通过 tick 参数的 player 字段上报；
     宿主侧只镜像该结果，不再用 input.dx/dy 重复积分玩家，
     避免双写导致位移被回退（走一小步就停）或松手后瞬移。 */
  const pose = poseHint || input?.player;
  if (pose && Number.isFinite(num(pose.x, NaN)) && Number.isFinite(num(pose.y, NaN))) {
    player.x = clampX(num(pose.x, player.x));
    player.y = clampY(num(pose.y, player.y));
    player.facing = num(pose.facing, player.facing);
    player.vx = 0;
    player.vy = 0;
  } else {
    // 兼容旧客户端（未上报 player）：退化为宿主侧积分，速度同样按 米/秒 × dt
    const dx = num(input?.dx, 0);
    const dy = num(input?.dy, 0);
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      const len = Math.hypot(dx, dy) || 1;
      player.vx = (dx / len) * speed;
      player.vy = (dy / len) * speed;
      player.facing = dx > 0 ? 0 : dx < 0 ? 180 : (dy > 0 ? 90 : 270);
    } else if (input?.moveTo) {
      const tx = num(input.moveTo.x, player.x);
      const ty = num(input.moveTo.y, player.y);
      if (dist(player, { x: tx, y: ty }) > 1.0) moveTowards(player, tx, ty, speed);   // 米/秒
      else { player.vx = 0; player.vy = 0; }
    } else {
      player.vx = 0;
      player.vy = 0;
    }
  }

  const enemies = s.entities.filter((e) => e.side === "enemy" && e.alive);
  // ★ v5：只有「组队跟随」勾选中的角色才跟随用户参战；未组队的原地待命
  const partyIds = Array.isArray(s.partyIds) ? s.partyIds : [];
  const allies = s.entities.filter((e) => e.side === "ally" && e.alive && partyIds.indexOf(e.id) >= 0);

  // 友方角色：跟随用户；只有「已威胁玩家（进入玩家身边 ALLY_ENGAGE_M=4m）」的敌人
  //           才出手，且目标选择锚点是玩家 —— 否则友军阵位散开后会挑离自己近的远怪围殴
  //           （表现：面前的怪不打，跑去打很远的）。
  allies.forEach((a, i) => {
    const target = enemies
      .filter((e) => dist(player, e) < ALLY_ENGAGE_M)
      .reduce<Entity | null>((best, e) =>
        !best || dist(player, e) < dist(player, best) ? e : best, null);
    const anchor = {
      x: player.x + Math.cos((i / Math.max(1, allies.length)) * Math.PI * 2) * ALLY_FOLLOW_GAP_M,
      y: player.y + Math.sin((i / Math.max(1, allies.length)) * Math.PI * 2) * ALLY_FOLLOW_GAP_M,
    };
    if (target) moveTowards(a, target.x, target.y, speed * 0.92);
    else moveTowards(a, anchor.x, anchor.y, speed * 0.8);
    if (target && dist(a, target) < ALLY_ATK_M && a.cooldown <= 0) {
      damage(s, target, a.atk, a);
      a.cooldown = 30;
    }
  });

  // ★ v4 敌人 AI：探测半径 10 米（MOB_DETECT_M）→ 追击 → 2 米攻击
  //          → 超出 12 米（MOB_DISENGAGE_M）脱战 → 归位巢点并在 8 米内游荡
  enemies.forEach((e) => {
    const ex = e as any;
    const prey = [player, ...allies].filter((t) => t.alive)
      .reduce<Entity | null>((best, t) => (!best || dist(e, t) < dist(e, best) ? t : best), null);
    const home = { x: num(ex.homeX, e.x), y: num(ex.homeY, e.y) };   // 巢点（无则取当前位）
    const preyIn = prey ? dist(e, prey) : Infinity;
    // ① 追击态：超出脱战半径 → 停止追击（转归位）；否则贴身攻击/继续接近
    if (ex.aiState === "chase") {
      if (!prey || preyIn > MOB_DISENGAGE_M) {
        ex.aiState = "return";
        e.vx = 0; e.vy = 0;
        return;
      }
      if (preyIn > MOB_ATK_M) { const t = clampToBound(s, prey!.x, prey!.y); moveTowards(e, t.x, t.y, speed * 0.72); return; }
      e.vx = 0; e.vy = 0;
      if (e.cooldown <= 0) { damage(s, prey, e.atk, e); e.cooldown = 45; }
      return;
    }
    // ② 巡逻态：探测半径内发现玩家/盟友 → 进入追击
    if (prey && preyIn <= MOB_DETECT_M) {
      ex.aiState = "chase";
      if (preyIn > MOB_ATK_M) { const t = clampToBound(s, prey.x, prey.y); moveTowards(e, t.x, t.y, speed * 0.72); return; }
      e.vx = 0; e.vy = 0;
      if (e.cooldown <= 0) { damage(s, prey, e.atk, e); e.cooldown = 45; }
      return;
    }
    // ③ 脱战/巡逻：离巢超过 8 米 → 归位；否则在巢点周围小范围游荡（绝不全图直线追）
    if (ex.aiState !== "idle" && ex.aiState !== "npc") { ex.aiState = "idle"; ex.wanderTimer = 0; }
    if (dist(e, home) > MOB_LEASH_R_M) {
      moveTowards(e, home.x, home.y, speed * 0.55);
      ex.wanderTimer = 0;
      return;
    }
    if (!(num(ex.wanderTimer, 0) > 0)) {
      const wa = rnd(0, Math.PI * 2);
      const wr = rnd(2, MOB_WANDER_R_M);
      // ★ fix⑤：游荡点同样夹进当前关卡边界（森林 ±29 m 时不再飘到界外）
      const w = clampToBound(s, home.x + Math.cos(wa) * wr, home.y + Math.sin(wa) * wr);
      ex.wanderX = w.x;
      ex.wanderY = w.y;
      ex.wanderTimer = Math.round(rnd(30, 90));
    }
    ex.wanderTimer = num(ex.wanderTimer, 0) - 1;
    const wx = num(ex.wanderX, home.x);
    const wy = num(ex.wanderY, home.y);
    if (Math.hypot(wx - e.x, wy - e.y) > 1) moveTowards(e, wx, wy, speed * 0.35);
    else { e.vx = 0; e.vy = 0; }
  });

  // 积分、冷却、越界（边界 ±1490 = WORLD ±1500 - 10，与前端 WORLD_LIMIT_M 一致；速度 m/s × dt）
  // ★ fix⑤：前端权威敌怪（isLocal）改用「当前关卡 bounds」夹取，避免被推出本图可行走区
  // ★ 敌人碰撞：先把上一帧落在墙里/界外的怪挪出来，再积分；位移走带避障的 navStep
  unstickEnemies(s);
  s.entities.forEach((e) => {
    if (e.cooldown > 0) e.cooldown -= 1;
    // ★ 打击特效衰减：hitFlashMs / actionBobMs 每 tick -100ms（与 dev-host 同步）
    if ((e as any).hitFlashMs > 0) (e as any).hitFlashMs = Math.max(0, (e as any).hitFlashMs - 100);
    if ((e as any).actionBobMs > 0) (e as any).actionBobMs = Math.max(0, (e as any).actionBobMs - 100);
    const nx = e.x + e.vx * TICK_DT_S;
    const ny = e.y + e.vy * TICK_DT_S;
    if (e.side === "enemy" && (e as any).isLocal) {
      const p = clampToBound(s, nx, ny);
      if (enemyNav) moveEnemyCollide(e, p.x - e.x, p.y - e.y);
      else { e.x = p.x; e.y = p.y; }
    } else if (e.side === "enemy" && enemyNav) {
      // 宿主自己刷的敌怪也走同一套碰撞（只加碰撞，边界夹取保持原逻辑不变）
      moveEnemyCollide(e, clampX(nx) - e.x, clampY(ny) - e.y);
    } else {
      e.x = clampX(nx);
      e.y = clampY(ny);
    }
  });
  s.skills.forEach((k) => { if (k.cdLeft > 0) k.cdLeft -= 1; });
  s.floaters = s.floaters.map((f) => ({ ...f, life: f.life - 1 })).filter((f) => f.life > 0);
  // ★ 打击特效衰减：vfx life 每 tick -1
  const _vfx = (s as any).vfx;
  if (Array.isArray(_vfx) && _vfx.length) (s as any).vfx = _vfx.filter((v: any) => { v.life -= 1; return v.life > 0; });

  // 宝箱：走过去开启（优先地图 loot）
  s.chests.forEach((c) => {
    if (c.opened) return;
    if (dist(player, c) < CHEST_PICKUP_M) {
      c.opened = true;
      const loot = (c as any).loot as { exp?: number; money?: number; item?: string } | undefined;
      const expGain = loot?.exp != null ? Math.round(num(loot.exp, 15)) : 12 + Math.floor(rnd(0, 10));
      const moneyGain = loot?.money != null ? Math.round(num(loot.money, 12)) : 15 + Math.floor(rnd(0, 20));
      const drop = loot?.item || ["生锈的钥匙", "干粮", "荧光石"][Math.floor(Math.random() * 3)];
      gainPlayerExp(s, expGain);      // ★ 等级系统：开箱经验同样走升级判定
      s.money += moneyGain;
      s.drops.push(drop);
      floater(s, `宝箱 +${expGain}exp`, c.x, c.y);
      pushEvent(s, `打开宝箱：${drop}，+${expGain} 经验，+${moneyGain} 金钱`);
    }
  });

  // 血瓶：走过去回血
  s.potions = s.potions.filter((p) => {
    if (dist(player, p) >= POTION_PICKUP_M) return true;
    const before = player.hp;
    player.hp = clamp(player.hp + p.heal, 0, player.maxHp);
    floater(s, `+${Math.round(player.hp - before)}`, player.x, player.y - 24);
    pushEvent(s, `拾取血瓶，恢复 ${Math.round(player.hp - before)} 点生命`);
    return false;
  });

  // ★ v4 区域刷新：敌人复活改为「随区域刷新机制重新生成」——
  //   先把本帧阵亡的敌人实体从世界移除（不再保留 alive=false 的残留实体）
  s.entities = s.entities.filter((e) => !(e.side === "enemy" && e.alive === false));

  // ★ v4 每个区域各自维护刷新计时：玩家离开该区域 45 秒后刷新一次野怪
  //   （城镇安全区不刷新；不再用 enemies.length===0 触发清场补波）
  regionTick(s, player);

  // 死亡判定
  if (!player.alive && s.phase === "playing") {
    s.phase = "over";
    s.result = {
      reason: "death",
      exp: s.exp, money: s.money, drops: [...s.drops], kills: s.kills, survivedTicks: s.tick,
    };
    pushEvent(s, "你倒下了……");
  }
}

/* ============================================================
   ★ v5：系统面板（背包 / 纳戒 / 商城 / 技能 / 地图 / 角色卡）
   ------------------------------------------------------------
   · 背包 / 技能 / 金钱 与用户「动态参数卡」双向同步：
       插件侧改动 → state.writeback → 宿主写回 stateJson 参数卡；
       宿主每 tick 注入的 ctx.playerCard 是外部改动的权威来源。
   · 纳戒 / 队伍 / 角色卡位置 / 背包顺序 / 商城 → t_plugin_session_data(sys_state)
   · 商城物资 = 商城 agent（故事动态数据 + 常驻世界书）+ 插件自带物资
   ============================================================ */

export interface BagItem {
  name: string; count: number; quantity?: number; kind: string; rarity: string; heal: number; price: number; desc?: string;
  /** ★ game.md 物品修改：战斗参数（mergeBag 时从 itemMeta / 推断默认合并） */
  power?: number; cost?: number; cd?: number; cdLeft?: number;
  type?: "atk" | "heal" | "buff" | "attribute"; range?: "melee" | "ranged";
  lv?: number; buff_type?: string;
  durability?: number; durabilityLeft?: number;
  attribute_type?: string; attribute_value?: number;
}
/** ★ game.md 物品修改：itemMeta 持久化结构（t_plugin_session_data） */
export interface ItemMeta {
  power: number; cost: number; cd: number;
  type: "atk" | "heal" | "buff" | "attribute"; range: "melee" | "ranged";
  lv: number; buff_type: string;
  durability: number; durabilityLeft: number;
  attribute_type: string; attribute_value: number;
  /** ★ game.md：数量与描述（描述保留参数卡原注记全文） */
  quantity: number; description: string;
}
export interface ShopGood { id: string; name: string; price: number; kind: string; rarity: string; heal: number; desc?: string; from: string; }
export interface NpcCard {
  id: string; name: string; side: string; enemy: boolean;
  level: number; hp: number; maxHp: number; exp: number; alive: boolean;
  /** ★ game.md 等级系统：蓝量 / 下级升级所需经验（= 等级*100） */
  mp?: number; maxMp?: number; next_level_exp?: number;
  mapName: string; x: number; y: number; inParty: boolean; avatarPath?: string;
  /** ★ game.md 角色卡：动态参数卡（结构化字段由前端展开渲染，实时值已由宿主覆盖） */
  parameterCardJson?: Record<string, any> | null;
}
export interface RingStore { items: BagItem[]; skills: string[]; }
export interface MapNode { name: string; x: number; y: number; }
export interface TeleportTarget { mapName: string; x: number; y: number; name: string; rev: number; }
export interface SysSnapshot {
  ring: RingStore; party: string[]; npcCards: NpcCard[];
  bagMeta: Record<string, BagItem>; bagOrder: string[];
  shop: ShopGood[]; level: string;
}

/** 系统面板持久化 dataKey（t_plugin_session_data） */
const SYS_DATA_KEY = "sys_state";
// ★ game.md 对话功能：AI 故事角色位置/地图信息的持久化键（写入 t_plugin_session_data 表）
const AI_STORY_ROLES_KEY = "ai_story_roles";
/** 每 N 帧把系统数据落一次库（避免每 tick 都写） */
const SYS_PERSIST_EVERY_TICKS = 20;
/** 稀有度 → 基础估价（卖出按 40% 折算） */
const RARITY_PRICE: Record<string, number> = { common: 8, fine: 22, rare: 60, epic: 180, legend: 520 };
const RARITY_LIST = ["common", "fine", "rare", "epic", "legend"];
const KIND_LIST = ["consumable", "material", "equipment", "skill_book", "quest"];

/** 插件自带商城物资（商城 agent 不可用时的常备补给） */
const BUILTIN_SHOP_GOODS: ShopGood[] = [
  { id: "b_huiqi", name: "回气散", price: 30, kind: "consumable", rarity: "common", heal: 30, desc: "恢复 30 点生命", from: "builtin" },
  { id: "b_jijiu", name: "急救包", price: 60, kind: "consumable", rarity: "fine", heal: 60, desc: "恢复 60 点生命", from: "builtin" },
  { id: "b_ganliang", name: "干粮", price: 12, kind: "consumable", rarity: "common", heal: 14, desc: "恢复 14 点生命", from: "builtin" },
  { id: "b_zhixuecao", name: "止血草", price: 20, kind: "material", rarity: "common", heal: 0, desc: "常见草药，可入药", from: "builtin" },
  { id: "b_yinguang", name: "荧光石", price: 45, kind: "material", rarity: "fine", heal: 0, desc: "泛着微光的矿石", from: "builtin" },
  { id: "b_duanjian", name: "精钢短剑", price: 220, kind: "equipment", rarity: "rare", heal: 0, desc: "攻击 +6", from: "builtin" },
  { id: "b_hufu", name: "皮甲护符", price: 160, kind: "equipment", rarity: "fine", heal: 0, desc: "防御 +4", from: "builtin" },
  { id: "b_xinde", name: "基础技能心得", price: 320, kind: "skill_book", rarity: "rare", heal: 0, desc: "习得一项基础技能", from: "builtin" },
];

function normRarity(v: any): string {
  const r = String(v ?? "").toLowerCase().trim();
  return RARITY_LIST.indexOf(r) >= 0 ? r : "common";
}

function guessKind(name: string): string {
  const n = String(name || "");
  if (/技能|秘籍|心得|卷轴|心法|功法/.test(n)) return "skill_book";
  if (/剑|刀|枪|弓|甲|盾|护符|戒|铠|斧|杖|靴/.test(n)) return "equipment";
  if (/丹|散|药|水|包|粮|汤|肉|鱼|果|酒|茶|露/.test(n)) return "consumable";
  return "material";
}

function defaultHeal(name: string, kind: string): number {
  if (kind !== "consumable") return 0;
  const n = String(name || "");
  if (/急救|大补|灵药|仙丹|回天/.test(n)) return 60;
  if (/回气|伤药|灵泉|清心|愈合/.test(n)) return 30;
  if (/干粮|粮|肉|果|汤|鱼/.test(n)) return 14;
  return 20;
}

/** 参数卡里的物品项（字符串 "干粮×3" / "干粮（备注）" 或对象）→ BagItem */
/** 物品名归一：剥离「×N」数量、「（描述…）」后缀、对象残留与货币尾注，限长 20（与 entry.js 同口径） */
function cleanName(v: any): string {
  let n = v && typeof v === "object" ? str(v.name ?? v.item ?? v.itemName ?? "") : str(v);
  n = n.replace(/\[object Object\]/g, " ");
  n = n.replace(/[（(][^）)]*[）)]/g, " ");
  n = n.replace(/[×xX*]\s*\d+\s*(个|件|尾|份|瓶|颗|张|本)?/g, " ");
  n = n.replace(/\s*单[尾个件份瓶颗张本]\s*\d*\s*金.*$/g, " ");
  n = n.replace(/\s*\d+\s*金.*$/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  n = n.replace(/[·、,，;；:：]+$/, "").trim();
  return n.slice(0, 20);
}
function itemKey(v: any): string {
  return cleanName(v).toLowerCase();
}
/** 展示名/参数名可能写法不同（带描述 vs 不带），匹配一律走归一键 */
function sameName(a: any, b: any): boolean {
  const ka = itemKey(a);
  return !!ka && ka === itemKey(b);
}
function parseItemRaw(raw: any): BagItem {
  if (raw && typeof raw === "object") {
    const name = str((raw as any).name ?? (raw as any).item ?? "");
    const kind = KIND_LIST.indexOf(String((raw as any).kind)) >= 0 ? String((raw as any).kind) : guessKind(name);
    return {
      name,
      count: Math.max(1, Math.round(num((raw as any).count, 1))),
      kind,
      rarity: normRarity((raw as any).rarity),
      heal: Math.max(0, Math.round(num((raw as any).heal, defaultHeal(name, kind)))),
      price: Math.max(0, Math.round(num((raw as any).price, 0))),
      desc: str((raw as any).desc, "") || undefined,
    };
  }
  const text = str(raw).trim();
  if (!text) return { name: "", count: 0, kind: "material", rarity: "common", heal: 0, price: 0 };
  const m = text.match(/^(.*?)[×xX*]\s*(\d+)\s*$/);
  if (m) {
    const name = m[1].trim();
    const kind = guessKind(name);
    return { name, count: Math.max(1, parseInt(m[2], 10) || 1), kind, rarity: "common", heal: defaultHeal(name, kind), price: 0 };
  }
  const p = text.match(/^(.*?)[（(](.*?)[)）]\s*$/);
  const name = (p ? p[1] : text).trim();
  const kind = guessKind(name);
  return { name, count: 1, kind, rarity: "common", heal: defaultHeal(name, kind), price: 0, desc: p ? p[2] : undefined };
}

function itemsFromCard(card: any): BagItem[] {
  const arr = Array.isArray(card?.items) ? card.items : [];
  return arr.map(parseItemRaw).filter((i) => i.name && i.count > 0);
}

/** 合并同名物品 + 套用元数据 + 按自定义顺序排列（imeta = 物品战斗参数元数据） */
function mergeBag(raw: BagItem[], meta?: Record<string, BagItem>, order?: string[], imeta?: Record<string, ItemMeta>): BagItem[] {
  const map = new Map<string, BagItem>();
  raw.forEach((it) => {
    const m = meta ? meta[it.name] : undefined;
    // ★ game.md 物品修改：战斗参数元数据（itemMeta，按展示名存）合并进背包项
    const im = imeta ? (imeta[it.name] || imeta[it.name.toLowerCase()]) : undefined;
    const bt = inferItemType(it.name, it.kind);
    const cur = map.get(it.name);
    if (cur) { cur.count += it.count; return; }
    map.set(it.name, {
      name: it.name,
      count: it.count,
      quantity: it.count,
      kind: it.kind !== "material" || !m ? it.kind : m.kind,
      rarity: it.rarity !== "common" || !m ? it.rarity : m.rarity,
      heal: it.heal || (m ? m.heal : 0) || defaultHeal(it.name, it.kind),
      price: it.price || (m ? m.price : 0),
      desc: im?.description || it.desc || (m ? m.desc : undefined),
      power: num(im?.power, it.kind === "equipment" ? 10 : 0),
      cost: num(im?.cost, 0),
      cd: Math.max(0, num(im?.cd, 0)),
      cdLeft: 0,
      type: (im?.type || bt.type) as BagItem["type"],
      range: (im?.range || bt.range) as BagItem["range"],
      lv: Math.max(1, num(im?.lv, 1)),
      buff_type: im?.buff_type || "",
      durability: num(im?.durability, -1),
      durabilityLeft: num(im?.durabilityLeft, num(im?.durability, -1)),
      attribute_type: im && "attribute_type" in im ? im.attribute_type : inferItemAttrType(it.name),
      attribute_value: num(im?.attribute_value, defaultItemAttrValue(it.name)),
    });
  });
  const list = Array.from(map.values());
  const idx = new Map<string, number>();
  (order || []).forEach((n, i) => idx.set(n, i));
  return list.sort((a, b) => {
    const ia = idx.has(a.name) ? (idx.get(a.name) as number) : 9999;
    const ib = idx.has(b.name) ? (idx.get(b.name) as number) : 9999;
    return ia - ib;
  });
}

function serializeBag(bag: BagItem[], cardItems?: any[]): string[] {
  // ★ game.md quantity/description：重写参数卡时保留原条目描述注记（「银鲤×3（钓鱼累积，暂未售出，单尾800金）」→「银鲤×7（钓鱼累积…）」）
  if (Array.isArray(cardItems)) {
    const flat: any[] = [];
    cardItems.forEach((x) => {
      if (typeof x === "string") splitSkillList(x).forEach((p) => { if (cleanName(p)) flat.push(p.trim()); });
      else flat.push(x);
    });
    const used = new Set<string>();
    const out: string[] = [];
    flat.forEach((x) => {
      const p = parseItemRaw(x);
      if (!p.name) return;
      const b = bag.find((y) => sameName(y.name, p.name) && !used.has(itemKey(y.name)));
      if (!b || !(b.count > 0)) return;
      used.add(itemKey(b.name));
      const d = p.desc ? `（${p.desc}）` : "";
      out.push(b.count > 1 ? `${b.name}×${b.count}${d}` : d ? `${b.name}${d}` : b.name);
    });
    bag.forEach((b) => {
      if (!b.count || used.has(itemKey(b.name))) return;
      used.add(itemKey(b.name));
      const d = b.desc ? `（${b.desc}）` : "";
      out.push(b.count > 1 ? `${b.name}×${b.count}${d}` : d ? `${b.name}${d}` : b.name);
    });
    return out;
  }
  return bag.filter((i) => i.name && i.count > 0).map((i) => (i.count > 1 ? `${i.name}×${i.count}` : i.name));
}

function sellPrice(it: BagItem): number {
  if (it.price > 0) return Math.max(1, Math.round(it.price * 0.4));
  const base = RARITY_PRICE[it.rarity] || RARITY_PRICE.common;
  const k = it.kind === "equipment" ? 1.5 : it.kind === "skill_book" ? 2 : 1;
  return Math.max(1, Math.round(base * k));
}

/** ★ game.md 背包物品：特效类型 [atk, heal, buff, attribute]（attribute = 纯属性点，使用不消耗） */
const ITEM_TYPES = ["atk", "heal", "buff", "attribute"] as const;
/** ★ game.md attribute_type：Defense/Attack/Life/Blue（放背包即被动加成） */
const ITEM_ATTR_TYPES = ["Defense", "Attack", "Life", "Blue"] as const;
type ItemType = (typeof ITEM_TYPES)[number];

/** 按名/品类推断默认 type/range（未显式修改过的物品走推断） */
function inferItemType(name: string, kind: string): { type: ItemType; range: "melee" | "ranged" } {
  const n = String(name || "");
  if (kind === "skill_book") return { type: "buff", range: "melee" };
  if (kind === "equipment" || /刀|剑|枪|弓|弩|斧|杖|匕|爪|锤/.test(n)) return { type: "atk", range: /弓|弩|杖/.test(n) ? "ranged" : "melee" };
  if (/力量|攻击|加攻/.test(n)) return { type: "attribute", range: "melee" };
  return { type: "heal", range: "melee" };
}
/** 按名推断被动属性类型（「力量+4」→ Attack 之类） */
function inferItemAttrType(name: string): string {
  const n = String(name || "");
  if (/防御|护甲|加防|体魄|磐/.test(n)) return "Defense";
  if (/蓝|法力|灵力|魔力/.test(n)) return "Blue";
  if (/生命|血量|体质/.test(n)) return "Life";
  if (/力量|攻击|加攻/.test(n)) return "Attack";
  return "";
}
/** 按名推断被动属性数值（「力量+4」→ 4；「魔力+10」→ 10） */
function defaultItemAttrValue(name: string): number {
  const m = String(name || "").match(/[＋+]\s*(\d+)/);
  return m ? Math.round(Number(m[1])) : 0;
}
/** 耐久剩余写回 itemMeta（背包每次从参数卡重建，durabilityLeft 必须落持久层） */
function setItemDurLeft(s: FieldSurvivalState, name: string, v: number): void {
  const cur = (s.itemMeta || {})[name] || ({} as Partial<ItemMeta>);
  s.itemMeta = { ...(s.itemMeta || {}), [name]: { ...cur, durabilityLeft: v } as ItemMeta };
}
/** ★ game.md 背包被动加成：bag 中 attribute_type ∈ Defense/Attack/Life/Blue 的物品按 attribute_value 累加 */
function bagAttributeBonus(s: FieldSurvivalState): Record<string, number> {
  const card = (s.playerCard || {}) as Record<string, any>;
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const bonus: Record<string, number> = { Defense: 0, Attack: 0, Life: 0, Blue: 0 };
  bag.forEach((it) => {
    const v = Math.round(num(it.attribute_value, 0));
    if (v !== 0 && (ITEM_ATTR_TYPES as readonly string[]).indexOf(it.attribute_type || "") >= 0) bonus[it.attribute_type as string] += v;
  });
  return bonus;
}
/* ============================================================================
   ★ game.md 等级系统（满血满蓝公式 / 经验阈值 / 升级 / 角色卡同步）
   ----------------------------------------------------------------------------
   满血HP = 100 + 等级*10 + 道具血量加成 + 技能永久血量加成
   满蓝MP = 100 + 等级*10 + 道具蓝量加成 + 技能永久蓝量加成
   攻击   = 10  + 等级*10 + 道具攻击加成 + 技能永久攻击加成
   防御   = 1   + 等级*10 + 道具防御加成 + 技能永久防御加成
   升级   = exp ≥ 当前level*100 → level+1 / 扣阈值保留溢出 / 阈值 = 新level*100 / 重算满血满蓝
   ========================================================================== */
const STAT_BASE = { hp: 100, mp: 100, atk: 10, def: 1 };
const STAT_PER_LEVEL = 10;                 // 每级四维成长
const PLAYER_ATTR_KEYS = ["Life", "Blue", "Attack", "Defense"] as const;
type PlayerAttrKey = (typeof PLAYER_ATTR_KEYS)[number];

/** 技能永久加成点数：skillMeta[技能].perm_{Life|Blue|Attack|Defense} 或参数卡 perm_bonus / permanent_attributes */
function permAttributeBonus(s: FieldSurvivalState): Record<string, number> {
  const out: Record<string, number> = { Life: 0, Blue: 0, Attack: 0, Defense: 0 };
  const card = (s.playerCard || {}) as Record<string, any>;
  const add = (k: string, v: any): void => {
    if ((PLAYER_ATTR_KEYS as readonly string[]).indexOf(k) >= 0) out[k] += Math.round(num(v, 0));
  };
  ["permanent_attributes", "perm_bonus", "perm_attr", "attribute_bonus"].forEach((key) => {
    const m = card[key];
    if (m && typeof m === "object") Object.keys(m).forEach((k) => add(k, (m as any)[k]));
  });
  const meta = (s.skillMeta || {}) as Record<string, any>;
  Object.keys(meta).forEach((k) => {
    const m = meta[k];
    if (!m || typeof m !== "object") return;
    PLAYER_ATTR_KEYS.forEach((ak) => {
      add(ak, m[`perm_${ak}`]);
      if (m.permanent && typeof m.permanent === "object") add(ak, m.permanent[ak]);
    });
  });
  return out;
}

/** 满血 / 满蓝 / 攻击 / 防御（公式值，不含当前 hp/mp） */
function playerMaxStats(s: FieldSurvivalState, level?: number): { maxHp: number; maxMp: number; atk: number; def: number } {
  const me = playerEntity(s);
  const lv = Math.max(1, Math.round(num(level, num(me?.level, 1))));
  const bag = bagAttributeBonus(s);
  const perm = permAttributeBonus(s);
  const sum = (k: PlayerAttrKey): number => Math.round(num(bag[k], 0) + num(perm[k], 0));
  return {
    maxHp: Math.max(1, STAT_BASE.hp + lv * STAT_PER_LEVEL + sum("Life")),
    maxMp: Math.max(0, STAT_BASE.mp + lv * STAT_PER_LEVEL + sum("Blue")),
    atk: Math.max(1, STAT_BASE.atk + lv * STAT_PER_LEVEL + sum("Attack")),
    def: Math.max(0, STAT_BASE.def + lv * STAT_PER_LEVEL + sum("Defense")),
  };
}

/** 升级阈值：next_level_exp = 当前 level * 100 */
function playerNextExp(level: number): number {
  return Math.max(1, Math.round(num(level, 1))) * 100;
}

/** 刷新玩家实体的经验显示字段（HUD：EXP me.exp/me.expToNext） */
function refreshPlayerExpFields(s: FieldSurvivalState): void {
  const me = playerEntity(s);
  if (!me) return;
  const card = (s.playerCard || {}) as Record<string, any>;
  const lv = Math.max(1, Math.round(num(me.level, 1)));
  const exp = Math.max(0, Math.round(num(s.exp, num(card.exp, 0))));
  s.exp = exp;
  me.exp = exp;
  me.expToNext = playerNextExp(lv);
}

/** 等级称号：优先读「等级-称号对照表」，无对应等级 → 空字符串；无对照表 → 返回 null（保留原称号） */
const LEVEL_DESC_MAP_KEYS = ["level_desc_map", "level_titles", "level_title_map", "level_desc_table", "等级称号表"];
function resolveLevelDesc(card: Record<string, any>, level: number): string | null {
  for (const key of LEVEL_DESC_MAP_KEYS) {
    const m = card?.[key];
    if (m && typeof m === "object") {
      const v = (m as any)[String(level)] ?? (m as any)[level];
      return v == null ? "" : String(v);
    }
  }
  return null;
}

/** 等级/经验/HP/MP 同步到「动态角色卡」（变化才回写，避免每帧 writeback） */
function syncPlayerCardStats(s: FieldSurvivalState, patch?: Record<string, any>): void {
  const me = playerEntity(s);
  if (!me) return;
  const lv = Math.max(1, Math.round(num(me.level, 1)));
  const exp = Math.max(0, Math.round(num(me.exp, num(s.exp, 0))));
  const next = playerNextExp(lv);
  const hp = Math.round(num(me.hp, 0));
  const maxHp = Math.round(num(me.maxHp, 0));
  const mp = Math.round(num(me.mp, 0));
  const maxMp = Math.round(num(me.maxMp, 0));
  const extra = patch || {};
  const sig = [lv, exp, next, hp, maxHp, mp, maxMp, JSON.stringify(extra)].join("|");
  if ((me as any)._cardStatSig === sig) return;
  (me as any)._cardStatSig = sig;
  patchCard(s, { level: lv, exp, next_level_exp: next, hp, maxHp, mp, maxMp, ...extra });
}

/** 升级判定：exp ≥ level*100 → 升级（支持连续多级），溢出经验保留，重算满血满蓝 + 写称号 */
function checkPlayerLevelUp(s: FieldSurvivalState): number {
  const me = playerEntity(s);
  if (!me) return 0;
  let lv = Math.max(1, Math.round(num(me.level, 1)));
  let exp = Math.max(0, Math.round(num(s.exp, 0)));
  let ups = 0;
  while (exp >= playerNextExp(lv)) {
    exp -= playerNextExp(lv);   // ② 扣除「升级前」阈值（③ 下一轮用新 level*100）
    lv += 1;                    // ① 等级 +1
    ups += 1;
  }
  if (!ups) { refreshPlayerExpFields(s); return 0; }
  me.level = lv;
  s.exp = exp;
  applyBagAttributes(s, { full: true });        // ⑤ 按满血满蓝公式重算 hp/mp
  const card = (s.playerCard || {}) as Record<string, any>;
  const desc = resolveLevelDesc(card, lv);      // ④ 等级称号
  syncPlayerCardStats(s, desc == null ? {} : { level_desc: desc });
  floater(s, `Lv.${lv} ↑`, me.x, me.y - 40);
  pushEvent(s, `升级到 Lv.${lv}（经验 ${exp}/${playerNextExp(lv)}，HP/MP 已按公式补满）`);
  return ups;
}

/** 玩家获得经验：累加 → 升级判定 → 角色卡同步（模糊描述不加经验，由 AI 层写 other） */
function gainPlayerExp(s: FieldSurvivalState, amount: number): void {
  const gain = Math.round(num(amount, 0));
  if (gain <= 0) return;
  s.exp = Math.max(0, Math.round(num(s.exp, 0)) + gain);
  checkPlayerLevelUp(s);
  syncPlayerCardStats(s);
}

/** 满血满蓝恢复（game.md 5：睡觉/住宿/药剂/恢复技能/剧情治愈 → 直接补满，描述写 other） */
function restorePlayerFull(s: FieldSurvivalState, reason: string): void {
  const me = playerEntity(s);
  if (!me) return;
  applyBagAttributes(s, { full: true });
  const card = (s.playerCard || {}) as Record<string, any>;
  const other = (Array.isArray(card.other) ? card.other.map((x: any) => String(x)) : []).slice(-20);
  const note = `${reason}：🎉 恭喜您已恢复到最佳状态（HP ${Math.round(me.hp)}/${Math.round(me.maxHp)}，MP ${Math.round(num(me.mp, 0))}/${Math.round(num(me.maxMp, 0))}）`;
  other.push(note);
  syncPlayerCardStats(s, { other });
  floater(s, "满血满蓝", me.x, me.y - 40);
  pushEvent(s, note);
}

/** 开局：等级/经验取「动态角色卡」，四维按公式重算，当前 hp/mp 取卡面值并夹进上限 */
function initPlayerFromCard(s: FieldSurvivalState, playerRole: any): void {
  const me = playerEntity(s);
  if (!me) return;
  const card = ((s.playerCard && Object.keys(s.playerCard).length)
    ? (s.playerCard as Record<string, any>)
    : ((playerRole?.parameterCardJson || playerRole?.parameter_card_json || {}) as Record<string, any>)) || {};
  if (!s.playerCard || !Object.keys(s.playerCard).length) s.playerCard = { ...card };
  me.level = Math.max(1, Math.round(num(card.level, num(playerRole?.initial_level, num(me.level, 1)))));
  s.exp = Math.max(0, Math.round(num(card.exp, num(s.exp, 0))));
  const st = playerMaxStats(s, me.level);
  me.maxHp = st.maxHp;
  me.maxMp = st.maxMp;
  me.atk = st.atk;
  me.def = st.def;
  me.hp = clamp(num(card.hp, st.maxHp), 0, st.maxHp);
  const cardMp = num(card.mp, NaN);
  me.mp = clamp(Number.isFinite(cardMp) ? cardMp : st.maxMp, 0, st.maxMp);
  refreshPlayerExpFields(s);
  syncPlayerCardStats(s);
}

/** 被动加成落到玩家实体（四维按 game.md 公式重算；full=true 时补满血满蓝） */
function applyBagAttributes(s: FieldSurvivalState, opts?: { full?: boolean }): void {
  const me = playerEntity(s);
  if (!me) return;
  const st = playerMaxStats(s);
  me.maxHp = st.maxHp;
  me.maxMp = st.maxMp;
  me.atk = st.atk;
  me.def = st.def;
  if (opts?.full) {
    me.hp = me.maxHp;
    me.mp = st.maxMp;
  } else {
    me.hp = clamp(num(me.hp, st.maxHp), 0, me.maxHp);
    me.mp = clamp(num(me.mp, st.maxMp), 0, st.maxMp);
  }
  refreshPlayerExpFields(s);
}
/**
 * ★ game.md 背包物品使用（HUD 物品栏 / 背包面板共用）：
 *   heal → 治疗环 + 回血；buff → 护盾环；atk/attribute → 普攻效果（近战冲斩 / 远程火球）
 *   无专属特效的统一走「角色小跳 + 飘字」（actionBobMs + floater）
 *   durability：-1 永久；>0 每用一次 -1，用完损毁 1 个；attribute 使用不消耗
 */
function useBagItem(s: FieldSurvivalState, name: string): string {
  const me = playerEntity(s);
  if (!me || !me.alive) return "角色不可用";
  const card = (s.playerCard || {}) as Record<string, any>;
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const it = bag.find((x) => x.name === name);
  if (!it || it.count <= 0) return `「${name}」不在背包中`;
  const t = it.type || "heal";
  (me as any).actionBobMs = 300;
  floater(s, `使用 ${it.name}`, me.x, me.y - 34);
  let consumed = true;
  let msg = `使用 ${it.name}`;
  if (t === "heal") {
    const heal = it.heal || defaultHeal(it.name, it.kind);
    const before = me.hp;
    if (heal > 0) me.hp = clamp(me.hp + heal, 0, me.maxHp);
    pushVfx(s, { kind: "heal_ring", entityId: me.id, x: me.x, y: me.y, life: 18, total: 18, color: "#7CFFB2", size: 1.0 });
    if (heal > 0) { floater(s, `+${Math.round(me.hp - before)}`, me.x, me.y - 52); msg += `，恢复 ${Math.round(me.hp - before)} 生命`; }
  } else if (t === "buff") {
    pushVfx(s, { kind: "buff_ring", entityId: me.id, x: me.x, y: me.y, life: 30, total: 30, color: "#9CCFFF", size: 1.0 });
    if (it.buff_type) msg += `（${it.buff_type}）`;
  } else {
    // atk / attribute：普攻效果；attribute 是纯属性点，使用不消耗但有小跳 + 普攻特效
    const targets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(me, e) < SKILL_RANGE_M);
    if ((it.range || "melee") === "ranged" && targets[0]) {
      pushVfx(s, { kind: "fireball", entityId: me.id, targetEntityId: targets[0].id, x: me.x, y: me.y, targetX: targets[0].x, targetY: targets[0].y, facing: me.facing, life: 16, total: 16, color: "#ff6a00", size: 1.0 });
    } else {
      pushVfx(s, { kind: "slash_arc", entityId: me.id, x: me.x, y: me.y, facing: me.facing, life: 12, total: 12, color: "#fff", size: 1.6 });
    }
    if (num(it.power, 0) > 0 && targets.length) {
      damage(s, targets[0], num(it.power, 0), me);
      msg += `，命中 ${targets[0].name}`;
    }
    if (t === "attribute") { consumed = false; msg += `（属性点 ${it.attribute_type || "-"}+${it.attribute_value || 0}）`; }
  }
  let nextBag = bag;
  if (consumed) {
    const dur = Math.round(num(it.durability, -1));
    let left = Math.round(num(it.durabilityLeft, dur));
    if (dur > 0) {
      left -= 1;
      if (left <= 0) {
        nextBag = bag
          .map((x) => (x.name === it.name ? { ...x, count: x.count - 1 } : x))
          .filter((x) => x.count > 0);
        setItemDurLeft(s, it.name, dur); // 换上新的一件，耐久重置
        pushEvent(s, `${it.name} 耐久耗尽，损毁 1 个`);
      } else {
        setItemDurLeft(s, it.name, left);
        pushEvent(s, `${it.name} 耐久 ${left}/${dur}`);
      }
    } else {
      nextBag = bag
        .map((x) => (x.name === it.name ? { ...x, count: x.count - 1 } : x))
        .filter((x) => x.count > 0);
    }
  }
  patchCard(s, { items: serializeBag(nextBag, card.items) });
  applyBagAttributes(s);
  return msg;
}

function playerEntity(s: FieldSurvivalState): Entity | undefined {
  return s.entities.find((e) => e.side === "player");
}

/** 写回宿主 + 本地参数卡同步（patch 含 items / skills 时同步快捷栏） */
function patchCard(s: FieldSurvivalState, patch: Record<string, any>): void {
  const card = { ...((s.playerCard || {}) as Record<string, any>), ...patch };
  s.playerCard = card;
  s.writeback = { ...((s.writeback || {}) as Record<string, any>), ...patch };
  s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
  if (Array.isArray(patch.items)) s.items = buildItems(card, 8);
  if (Array.isArray(patch.skills)) s.skills = buildSkills(card, 8, s.skillMeta);
}

/** 宿主注入的参数卡若被外部改动，以宿主为准（保证与动态参数卡同步） */
function syncCardFromContext(s: FieldSurvivalState, ctx?: PluginGameContext): void {
  const card = (ctx?.playerCard || {}) as Record<string, any>;
  if (!card || !Object.keys(card).length) return;
  const cur = (s.playerCard || {}) as Record<string, any>;
  const sig = (c: any) => JSON.stringify([
    c?.items ?? null, c?.money ?? null, c?.skills ?? null,
    c?.level ?? null, c?.exp ?? null, c?.hp ?? null, c?.mp ?? null,   // ★ 等级系统字段
  ]);
  if (sig(card) === sig(cur)) return;
  s.playerCard = card;
  s.items = buildItems(card, 8);
  s.skills = buildSkills(card, 8, s.skillMeta);
  // ★ 等级系统：AI 剧情在角色卡上直接改动的 等级/经验/HP/MP 回灌到玩家实体（数据一致性）
  const me = playerEntity(s);
  if (me) {
    if (card.level != null) me.level = Math.max(1, Math.round(num(card.level, me.level)));
    if (card.exp != null) s.exp = Math.max(0, Math.round(num(card.exp, s.exp)));
    if (card.hp != null) me.hp = Math.max(0, Math.round(num(card.hp, me.hp)));
    if (card.mp != null) me.mp = Math.max(0, Math.round(num(card.mp, me.mp)));
    refreshPlayerExpFields(s);
  }
}

/** 角色卡：主体 = 当前 AI 故事对话的动态角色卡（s.roles，与 web 端 play-role-strip 同源），
 *  无论有没有被选择上场全部显示；地图实体只合并运行时信息（位置/血量/经验/组队） */
function ensureNpcCards(s: FieldSurvivalState, levelName: string): void {
  const prev = new Map<string, NpcCard>((s.npcCards || []).map((c) => [String(c.id), c]));
  const party = s.partyIds || [];
  const roles = Array.isArray(s.roles) ? (s.roles as any[]) : [];
  const entByKey = new Map<string, any>();
  (s.entities || []).forEach((e) => {
    entByKey.set(String(e.id), e);
    if (!entByKey.has(String(e.name))) entByKey.set(String(e.name), e);
  });
  // ★ 停车实体（停在别的地图）也参与匹配：角色卡要显示"他在哪张图哪个位置"
  const parkedObj: any = (s as any).parked || {};
  Object.keys(parkedObj).forEach((k) => {
    (Array.isArray(parkedObj[k]) ? parkedObj[k] : []).forEach((e: any) => {
      if (!entByKey.has(String(e.id))) entByKey.set(String(e.id), e);
      if (!entByKey.has(String(e.name))) entByKey.set(String(e.name), e);
    });
  });
  const sel: any = (s as any).selections || {};
  const inSel = (arr: any, r: any): boolean =>
    Array.isArray(arr) && arr.some((x) => String(x) === String(r.id) || String(x) === String(r.name));
  const sideOfRole = (r: any): string => {
    const e = entByKey.get(String(r.id)) || entByKey.get(String(r.name));
    if (e) return e.side;
    if (String(r.roleType) === "player") return "player";
    if (inSel(sel.participants, r)) return "ally";
    if (inSel(sel.enemies, r)) return "enemy";
    if (inSel(sel.spectators, r)) return "spectator";
    return "neutral";
  };
  const buildCard = (role: any, forcedSide?: string): NpcCard => {
    const e = entByKey.get(String(role.id)) || entByKey.get(String(role.name)) || null;
    const old = prev.get(String(role.id));
    const side = forcedSide || sideOfRole(role);
    const onMap = !!e;
    const pcRaw = side === "player" && s.playerCard && Object.keys(s.playerCard || {}).length
      ? (s.playerCard as Record<string, any>)
      : (role.parameterCardJson || role.parameter_card_json) || (old && (old as any).parameterCardJson) || null;
    let pc: Record<string, any> | null = null;
    if (pcRaw && typeof pcRaw === "object") {
      pc = { ...pcRaw };
      pc.level = Math.max(1, Math.round(num(e ? (e as any).level : num(role.initial_level, num(pc.level, 1)), 1)));
      if (e) {
        pc.hp = Math.round(num((e as any).hp, num(pc.hp, 0)));
        pc.maxHp = Math.round(num((e as any).maxHp, num(pc.maxHp, pc.hp)));
        // ★ 等级系统：蓝量以实体为权威（满蓝公式 = 100 + 等级*10 + 加成）
        pc.mp = Math.round(num((e as any).mp, num(pc.mp, 0)));
        pc.maxMp = Math.round(num((e as any).maxMp, num(pc.maxMp, pc.mp)));
      }
      if (side === "player") {
        pc.money = num((s.playerCard as any)?.money, num(pc.money, 0));
        pc.exp = Math.round(num((s.playerCard as any)?.exp, num(s.exp, 0)));
        // ★ 等级系统：与玩家实体保持一致（等级/经验/满血满蓝）
        pc.level = Math.max(1, Math.round(num(e ? (e as any).level : pc.level, 1)));
      } else if (e) {
        pc.exp = Math.round(num(old?.exp, num(pc.exp, 0)));
      }
      pc.next_level_exp = pc.level * 100;
    }
    return {
      id: String(role.id),
      name: role.name,
      side,
      enemy: side === "enemy",
      level: Math.max(1, Math.round(num(e ? (e as any).level : num(role.initial_level, num(old?.level, 1)), 1))),
      hp: Math.round(e ? (e as any).hp : num(old?.hp, num(pc?.hp, 0))),
      maxHp: Math.round(e ? (e as any).maxHp : num(old?.maxHp, num(pc?.maxHp, 0))),
      exp: Math.round(num(old?.exp, 0)),
      alive: e ? !!(e as any).alive : (old ? old.alive !== false : true),
      mapName: side === "player" ? (levelName || old?.mapName || "") : (((e as any) && (e as any).mapName) || old?.mapName || ""),
      x: Math.round(e ? (e as any).x : num(old?.x, Math.random() * 100)),
      y: Math.round(e ? (e as any).y : num(old?.y, Math.random() * 100)),
      inParty: party.indexOf(String(role.id)) >= 0,
      avatarPath: (e && (e as any).avatarPath) || role.avatarPath || (old && old.avatarPath) || undefined,
      parameterCardJson: pc,
    } as NpcCard;
  };
  const cards: NpcCard[] = [];
  const seen = new Set<string>();
  const pushCard = (role: any, forcedSide?: string): void => {
    if (!role || seen.has(String(role.id))) return;
    seen.add(String(role.id));
    seen.add(String(role.name));
    cards.push(buildCard(role, forcedSide));
  };
  if (roles.length) {
    const playerRole = roles.find((r) => String(r?.roleType) === "player") || null;
    if (playerRole) pushCard(playerRole, "player");
    roles.forEach((r) => pushCard(r));
  } else {
    // 兜底：故事角色列表缺失时退回地图实体（避免空面板）
    (s.entities || []).forEach((e) => pushCard({ id: e.id, name: e.name, avatarPath: e.avatarPath }, e.side));
  }
  s.npcCards = cards;
}

/** ★ game.md 角色位置问题：没有位置信息的角色，默认生成到 (0,0) 附近可活动区域（不落障碍） */
const ROLE_SPAWN_R_M = 2.5;
function spawnRoleEntity(s: FieldSurvivalState, role: any): Entity | null {
  if (!role) return null;
  const exist = s.entities.find((x) => x.id === String(role.id) || x.name === String(role.name));
  if (exist) return exist;
  const sel: any = (s as any).selections || {};
  const inSel = (arr: any): boolean =>
    Array.isArray(arr) && arr.some((x) => String(x) === String(role.id) || String(x) === String(role.name));
  // ★ AI 故事角色区分：roleType 决定阵营（player→player, npc/system/general→ally）
  const roleType = str((role as any)?.roleType);
  let side: string;
  if (roleType === "player") side = "player";
  else if (inSel(sel.enemies)) side = "enemy";
  else if (inSel(sel.participants)) side = "ally";
  else if (roleType === "npc" || roleType === "system" || roleType === "general") side = "ally";
  else side = "spectator";
  // ★ 默认落点：以玩家为中心、50 米半径内随机分布（避开 5 米内挤堆）
  const player0 = s.entities.find((e) => e.side === "player");
  const pcx = player0?.x ?? PLAYER_SPAWN.x;
  const pcy = player0?.y ?? PLAYER_SPAWN.y;
  const ang = rnd(0, Math.PI * 2);
  const dist_x = 100 + Math.random() * 50;
  const dist_y = 100 + Math.random() * 50;
  let target: { x: number; y: number } = {
    x: pcx + Math.cos(ang) * dist_x,
    y: pcy + Math.sin(ang) * dist_y
  };
  // 边界钳制
  target = clampToBound(s, target.x, target.y);
  // 优先 enemyNav 避障；搜不到时加大半径重试（maxRing=8 对 50 米外随机落点太容易漏）
  if (enemyNav) {
    const free = navNearestFree(enemyNav, target.x, target.y, 0.4, 8)
      || navNearestFree(enemyNav, target.x, target.y, 0.4, 20);
    if (free) target = free;
  }
  const e = makeEntity(role, side as any, target.x, target.y, s.entities.length);
  e.homeX = e.x;
  e.homeY = e.y;
  (e as any).mapName = s.levelName || "";
  (e as any).roleType = roleType;
  // ★ 中立/通用角色保持非攻击状态（不会主动追玩家）
  if (side === "enemy") {
    (e as any).aiState = "idle";
    (e as any).regionId = (nearestWildRegion(e.x, e.y) || ({} as any)).id;
  } else {
    (e as any).aiState = "idle";
  }
  s.entities.push(e);
  return e;
}

/** ★ game.md 角色位置：角色驻留地图 —— 他在哪个地图就在哪个地图，不因玩家切图而改变。
 *  只有组队中的角色跟随玩家跨图（落点 = 玩家身边）；脱离队伍就地留下。
 *  非组队角色从当前实体表摘除、停进 s.parked[地图名]，玩家回到该图时原坐标归队。 */
function handleLevelChange(s: FieldSurvivalState, snapParty: boolean): void {
  if (!Array.isArray(s.entities)) return;
  const lv = s.levelName || "";
  const parkedAny = s as any;
  parkedAny.parked = parkedAny.parked && typeof parkedAny.parked === "object" ? parkedAny.parked : {};
  const party = s.partyIds || [];
  const player = s.entities.find((e2) => e2.side === "player");
  const stay: Entity[] = [];
  (s.entities || []).forEach((e2) => {
    if (e2.side === "player") { (e2 as any).mapName = lv; stay.push(e2); return; }
    if (String(e2.side) === "enemy") { stay.push(e2); return; } // 野怪由前端 localEnemies 按图管理，不动
    if (!(e2 as any).mapName) (e2 as any).mapName = lv; // 存量实体兜底：视为当前图
    if (party.indexOf(String(e2.id)) >= 0) {
      // 组队：跟随玩家到当前图，落在玩家身边
      (e2 as any).mapName = lv;
      if (snapParty && player) {
        const ang = rnd(0, Math.PI * 2);
        const cb = clampToBound(s, player.x + Math.cos(ang) * ALLY_FOLLOW_GAP_M, player.y + Math.sin(ang) * ALLY_FOLLOW_GAP_M);
        e2.x = cb.x;
        e2.y = cb.y;
      }
      stay.push(e2);
    } else if ((e2 as any).mapName === lv) {
      stay.push(e2);
    } else {
      (parkedAny.parked[(e2 as any).mapName] = parkedAny.parked[(e2 as any).mapName] || []).push(e2);
    }
  });
  const back = parkedAny.parked[lv];
  if (Array.isArray(back) && back.length) {
    back.forEach((e2: any) => { e2.mapName = lv; });
    s.entities = stay.concat(back);
    parkedAny.parked[lv] = [];
  } else {
    s.entities = stay;
  }
}

/** 组队角色随击杀获得经验并升级 */
function grantPartyExp(s: FieldSurvivalState, expGain: number): void {
  const party = s.partyIds || [];
  if (!party.length || expGain <= 0) return;
  const share = Math.max(1, Math.round(expGain * 0.6));
  party.forEach((pid) => {
    const c = (s.npcCards || []).find((x) => x.id === pid);
    if (!c) return;
    c.exp = Math.round(num(c.exp, 0)) + share;
    let ups = 0;
    while (c.exp >= playerNextExp(num(c.level, 1))) {
      c.exp -= playerNextExp(num(c.level, 1));   // 扣「升级前」阈值，溢出保留
      c.level = Math.max(1, Math.round(num(c.level, 1))) + 1;
      ups += 1;
    }
    // ★ 等级系统：NPC 也按满血满蓝公式重算（无背包/技能永久加成 → 走基础公式）
    c.maxHp = STAT_BASE.hp + c.level * STAT_PER_LEVEL;
    c.maxMp = STAT_BASE.mp + c.level * STAT_PER_LEVEL;
    if (ups > 0) { c.hp = c.maxHp; c.mp = c.maxMp; }
    else {
      c.hp = clamp(num(c.hp, c.maxHp), 0, c.maxHp);
      c.mp = clamp(num(c.mp, c.maxMp), 0, c.maxMp);
    }
    c.next_level_exp = playerNextExp(c.level);
    const e = s.entities.find((x) => x.id === pid);
    if (e) {
      e.level = c.level; e.maxHp = c.maxHp; e.hp = c.hp;
      e.maxMp = c.maxMp; e.mp = c.mp;
      e.exp = c.exp; e.expToNext = playerNextExp(c.level);
    }
  });
  const lead = s.entities.find((e) => e.id === party[0]);
  if (lead) floater(s, `队伍 +${share}exp`, lead.x, lead.y - 26);
}

/** 系统数据 → t_plugin_session_data */
async function persistSys(context: PluginGameContext | undefined, s: FieldSurvivalState): Promise<void> {
  const api = context?.tsApi?.pluginData;
  if (!api?.set) return;
  try {
    await api.set(SYS_DATA_KEY, {
      ring: s.ring || { items: [], skills: [] },
      party: s.partyIds || [],
      npcCards: s.npcCards || [],
      bagMeta: s.bagMeta || {},
      bagOrder: s.bagOrder || [],
      shop: s.shopGoods || [],
      level: s.levelName || "",
      skillMeta: s.skillMeta || {},
      itemMeta: s.itemMeta || {},
    });
    // ★ game.md 对话功能：AI 故事角色位置/地图信息单独持久化（dataKey=ai_story_roles → t_plugin_session_data），
    //   后续开新局时 AI 聊天窗口能直接读到「陈彦现在在 mulberry_forest 地图 (12.3, -5.6)」，不用再遍历 entities。
    const aiRoles = collectAiStoryRoles(s);
    await api.set(AI_STORY_ROLES_KEY, {
      roles: aiRoles,
      level: s.levelName || "",
      updatedAt: Date.now(),
    });
  } catch { /* 落库失败不阻断玩法 */ }
}

/** ★ game.md 对话功能：收集所有 AI 故事角色的位置/地图信息（写入 t_plugin_session_data） */
function collectAiStoryRoles(s: FieldSurvivalState): Array<{
  id: string; name: string; roleType: string; side: string;
  x: number; y: number; mapName: string; alive: boolean; updatedAt: number;
}> {
  const arr: Array<{
    id: string; name: string; roleType: string; side: string;
    x: number; y: number; mapName: string; alive: boolean; updatedAt: number;
  }> = [];
  const ents = Array.isArray(s.entities) ? s.entities : [];
  for (const e of ents) {
    if (!e) continue;
    const rt = String((e as any).roleType || "");
    // 玩家自己 / 地图内置 NPC (TOWN_NPCS, side=neutral) / 怪物 都不进 AI 故事角色列表
    if (e.side === "player") continue;
    if (e.side === "enemy") continue;
    if (e.side === "neutral") continue;
    if (!rt) continue;
    arr.push({
      id: String(e.id || e.name || ""),
      name: String(e.name || e.id || ""),
      roleType: rt,
      side: String(e.side || ""),
      x: Math.round(num(e.x, 0) * 100) / 100,
      y: Math.round(num(e.y, 0) * 100) / 100,
      mapName: String((e as any).mapName || s.levelName || ""),
      alive: (e as any).alive !== false,
      updatedAt: Date.now(),
    });
  }
  return arr;
}

/** t_plugin_session_data → 系统数据 */
async function restoreSys(context: PluginGameContext | undefined, s: FieldSurvivalState): Promise<void> {
  const api = context?.tsApi?.pluginData;
  if (!api?.get) return;
  try {
    const d: any = await api.get(SYS_DATA_KEY);
    if (!d || typeof d !== "object") return;
    if (d.skillMeta && typeof d.skillMeta === "object") s.skillMeta = d.skillMeta;
    if (d.itemMeta && typeof d.itemMeta === "object") s.itemMeta = d.itemMeta;
    if (d.ring && typeof d.ring === "object") {
      s.ring = {
        items: Array.isArray(d.ring.items) ? d.ring.items : [],
        skills: Array.isArray(d.ring.skills) ? d.ring.skills.map(String) : [],
      };
    }
    // ★ game.md 组队跟随：队伍只在本次会话内由角色卡面板勾选决定，
    //   不再恢复旧存档（旧版本曾把全部友方角色自动编入队伍，恢复会继承错误的自动跟随）
    if (Array.isArray(d.party)) s.partyIds = [];
    if (Array.isArray(d.npcCards)) s.npcCards = d.npcCards;
    if (d.bagMeta && typeof d.bagMeta === "object") s.bagMeta = d.bagMeta;
    if (Array.isArray(d.bagOrder)) s.bagOrder = d.bagOrder.map(String);
    if (Array.isArray(d.shop) && d.shop.length) s.shopGoods = d.shop;
    if (str(d.level)) s.levelName = str(d.level, "");
  } catch { /* 读取失败走默认 */ }
}

/** 商城：商城 agent（故事动态数据 + 常驻世界书）→ 商品；失败/为空则用插件自带物资 */
async function refreshShop(context: PluginGameContext | undefined, s: FieldSurvivalState): Promise<string[]> {
  const notes: string[] = [];
  const builtin = BUILTIN_SHOP_GOODS.map((g) => ({ ...g }));
  let story: ShopGood[] = [];
  const run = context?.tsApi?.agent?.run;
  if (run) {
    try {
      const r: any = await withTimeout(
        run("field-survival-shop-gener", {
          storyDigest: buildStoryDigest(context),
          worldBookDigest: str((context as any)?.worldBookDigest, ""),
          playerCard: s.playerCard || {},
        }),
        20000,
        "shop agent timeout",
      );
      const goods = r?.output?.goods;
      if (Array.isArray(goods)) {
        story = goods.slice(0, 14).map((g: any, i: number): ShopGood => {
          const rawName = String(g?.name || `物资${i + 1}`).slice(0, 20);
          const kind = KIND_LIST.indexOf(String(g?.kind)) >= 0 ? String(g.kind) : guessKind(rawName);
          return {
            id: `s_${i}_${rawName}`,
            name: rawName,
            price: Math.max(1, Math.round(num(g?.price, 50))),
            kind,
            rarity: normRarity(g?.rarity),
            heal: Math.max(0, Math.round(num(g?.heal, defaultHeal(rawName, kind)))),
            desc: String(g?.desc || "").slice(0, 60),
            from: "story",
          };
        });
      }
      if (!story.length && r?.error) notes.push(String(r.error).slice(0, 60));
    } catch (err) {
      notes.push(err instanceof Error ? err.message.slice(0, 60) : "shop agent failed");
    }
  }
  s.shopGoods = [...story, ...builtin];
  s.shopSource = story.length ? "agent" : "builtin";
  if (notes.length) pushEvent(s, `商城生成降级：${notes[0]}`);
  return notes;
}

// ---------------------------------------------------------------------------
// handle_action
// ---------------------------------------------------------------------------

/** ★ fix④（缺口②）：候选角色是否就是玩家本人（宿主 roles 里混入了用户角色，按 id / name 双判） */
function isPlayerRole(cand: any, playerRole: any): boolean {
  const cid = str(cand?.id);
  const cname = str(cand?.name);
  const pid = str(playerRole?.id);
  const pname = str(playerRole?.name);
  if (pid && cid && cid === pid) return true;
  if (pname && cname && cname === pname) return true;
  return false;
}

export async function handle_action(
  action: string,
  params: Record<string, any>,
  state: Record<string, any>,
  context: PluginGameContext,
): Promise<{ code: number; message: string; state: FieldSurvivalState; response?: string; actions?: string[] }> {
  const s: FieldSurvivalState =
    state && Object.keys(state).length > 0 && ((state as any).version === 2 || (state as any).version === 3 || (state as any).version === 4)
      ? (state as unknown as FieldSurvivalState)
      : emptyState(context);

  const okResp = (msg: string) => ({ code: 0, message: "ok", state: s, response: msg });

  switch (action) {
    case "init":
    case "start_init": {
      // ★ 强制重置为初始选人状态，不依赖旧 state
      // 无论之前是 playing/over，第二次进入都必须回到 select 阶段
      const fresh = emptyState(context);
      fresh.roles = Array.isArray(context?.roles) ? context.roles : [];
      return { code: 0, message: "ok", state: fresh, response: "请选择友方 / 观战 / 敌对角色后开始" };
    }

    case "start": {
      const sel = (params?.selections || params || {}) as Record<string, any>;
      const participants: string[] = Array.isArray(sel.participants) ? sel.participants.map(String) : [];
      const spectators: string[] = Array.isArray(sel.spectators) ? sel.spectators.map(String) : [];
      const enemies: string[] = Array.isArray(sel.enemies) ? sel.enemies.map(String) : [];
      const roles = Array.isArray(context?.roles) ? context.roles : [];
      const byId = (id: string) => roles.find((r) => String((r as any).id) === id || String((r as any).name) === id);
      const playerRole = roles.find((r) => String((r as any).roleType) === "player") || roles[0];

      s.selections = { participants, spectators, enemies };
      s.entities = [];
      // ★ v3: 玩家出生在 origin (0, 0)，与 map_config.json 一致
      s.entities.push(makeEntity(playerRole as any, "player", PLAYER_SPAWN.x, PLAYER_SPAWN.y, 0));
      // ★ game.md 等级系统：等级/经验取参数卡，四维按公式重算（HP/MP 取卡面值并夹进满值上限）
      initPlayerFromCard(s, playerRole as any);
      participants.forEach((id, i) => {
        const r = byId(id);
        if (!r) return;
        // ★ fix④（缺口②）：参展列表里若混入玩家本人（宿主 roles 含用户角色、前端默认 push 玩家 id），
        //   不再生成一份同名友方 —— 否则开局即出现"另一个我"跟着自己跑
        if (isPlayerRole(r, playerRole)) return;
        // ★ v3: 盟友环绕半径 = 2.5 米 + 随机 0~50 米（避开 5 米内挤堆）
        const angle = (i / Math.max(1, participants.length)) * Math.PI * 2;
        const rawAllyX = PLAYER_SPAWN.x + Math.cos(angle) * (ALLY_FOLLOW_GAP_M + Math.random() * 10);
        const rawAllyY = PLAYER_SPAWN.y + Math.sin(angle) * (ALLY_FOLLOW_GAP_M + Math.random() * 10);
        const allyEntity = makeEntity(r, "ally", rawAllyX, rawAllyY, i);
        // ★ navNearestFree 兜底：落墙时推最近可走格；enemyNav 在 start 时为 null → clampToBound 保底
        if (enemyNav) {
          const free = navNearestFree(enemyNav, rawAllyX, rawAllyY, 0.4, 8);
          if (free) { allyEntity.x = free.x; allyEntity.y = free.y; }
        } else {
          const cb = clampToBound(s, rawAllyX, rawAllyY);
          allyEntity.x = cb.x; allyEntity.y = cb.y;
        }
        s.entities.push(allyEntity);
      });
      // ★ v4：敌对角色落在「最近的野区」内
      //   （玩家出生于城镇安全区，若沿用"围绕玩家 30~60 米"的落点会落进城镇内部）
      const startRegion = nearestWildRegion(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
      enemies.forEach((id, i) => {
        const r = byId(id);
        // ★ fix④（缺口②）：玩家本人不会被复制成"敌对角色"（同 id / 同名的 1:1 排除）
        if (r && isPlayerRole(r, playerRole)) return;
        const at = regionSpawnPoint(s, startRegion);
        const e = r
          ? makeEntity(r, "enemy", at.x, at.y, i)
          : makeEntity({ id, name: id }, "enemy", at.x, at.y, i);
        (e as any).regionId = startRegion.id;
        (e as any).homeX = at.x;
        (e as any).homeY = at.y;
        (e as any).aiState = "idle";
        s.entities.push(e);
      });
      spectators.forEach((id) => {
        const r = byId(id);
        if (r) s.entities.push({ ...makeEntity(r, "spectator", -40, -40 + s.entities.length * 4, 0), alive: true });
      });
      // ★ 不再自动 spawn 无明确阵营的 AI 故事角色（避免地图上冒出莫名 NPC）；
      //   玩家自己 / participants / spectators / enemies 已在上方生成；
      //   角色卡面板仍会展示所有 AI 故事角色（仅位置为空 → 不会出实体）。
      // ★ map-gener agent：用故事动态数据生成地图（存 t_plugin_session_data.map_data）
      s.map = await ensureMapData(context);
      s.mapSource = (s.map?.notes || "").includes("fallback") ? "fallback" : "agent";

      // ★ v4：区域划分（晨曦镇 + 6 野区）写入 map.zones —— 主地图与小地图据此显示区域名称
      if (s.map) {
        s.map.zones = WORLD_REGIONS.map((r) => ({
          name: r.name, x: r.x, y: r.y, r: r.r, kind: r.kind, desc: r.desc,
        }));
      }
      // ★ v4：建立城镇（安全区：建筑 + 中立角色）与区域运行时状态
      ensureTown(s);
      initRegions(s);
      // ★ v4：初始铺怪 —— 每个野区各刷满自己的配额（城镇配额 0，安全区内无野怪）
      WORLD_REGIONS.forEach((r) => { if (!r.safe && r.mobs > 0) spawnRegionMobs(s, r, r.mobs); });
      // ★ v4：宝箱 / 血瓶仍按地图数据铺设一次（区域刷新只补野怪，不重置宝箱）
      if (!s.chests.length) {
        (s.map?.chests || []).forEach((c, i) => {
          s.chests.push({
            ...(c as any),
            id: `chest_map_${i}`,
            x: clampX(num((c as any).x, 0)),
            y: clampY(num((c as any).y, 0)),
            opened: false,
          });
        });
      }
      if (!s.potions.length) {
        (s.map?.potions || []).forEach((p, i) => {
          s.potions.push({
            id: `potion_map_${i}`,
            x: clampX(num((p as any).x, 0)),
            y: clampY(num((p as any).y, 0)),
            heal: num((p as any).heal, 40),
          });
        });
      }
      // 兜底：地图数据没给宝箱 / 血瓶时，按野区（非城镇）各铺 3 个
      if (!s.chests.length) {
        ["wood", "ruin", "wild"].forEach((rid, i) => {
          const r = WORLD_REGIONS.find((z) => z.id === rid) as RegionDef;
          const at = regionSpawnPoint(s, r);
          s.chests.push({ id: `chest_${rid}_${i}`, x: at.x, y: at.y, opened: false, loot: { exp: 12 + i * 5, money: 10 + i * 4, item: "干粮" } });
        });
      }
      if (!s.potions.length) {
        ["shore", "mine", "marsh"].forEach((rid, i) => {
          const r = WORLD_REGIONS.find((z) => z.id === rid) as RegionDef;
          const at = regionSpawnPoint(s, r);
          s.potions.push({ id: `potion_${rid}_${i}`, x: at.x, y: at.y, heal: 24 + i * 6 });
        });
      }
      // ★ v5：恢复系统面板持久化数据（纳戒 / 队伍 / 角色卡 / 背包顺序 / 商城）
      await restoreSys(context, s);
      syncCardFromContext(s, context); // ★ start 也同步参数卡
      if (str((params as any)?.levelName)) s.levelName = str((params as any).levelName, s.levelName || "");
      if (!s.levelName) s.levelName = str((s.map as any)?.theme, "");
      // ★ game.md 对话功能：AI 故事角色 spawn 完毕 → 立即把位置/地图信息写入 t_plugin_session_data
      await persistSys(context, s);
      // ★ game.md 组队跟随：开局默认【不】组队——只有角色卡面板勾选「组队跟随」的角色
      //   才会跟随用户帮打怪（未组队角色原地待命，绝不自动跟随）
      if (!Array.isArray(s.partyIds)) s.partyIds = [];
      ensureNpcCards(s, s.levelName || "");
      // ★ game.md 商城：开局即建货源（商城 agent 故事物资 + 插件自带物资），不等第一次 tick
      if (!s.shopGoods || !s.shopGoods.length) await refreshShop(context, s);
      s.writeback = null;
      s.phase = "playing";
      s.tick = 0;
      const theme = str(s.map?.theme, "野外");
      const narration = str(s.map?.narration, "");
      s.events = [
        narration || `进入「${theme}」：操作你的角色，击杀敌人、开启宝箱、拾取血瓶。`,
      ];
      return okResp(`进入「${theme}」`);
    }

    case "tick": {
      if (s.phase !== "playing") return okResp("");
      s.writeback = null;          // ★ v5：上一帧回写已由宿主消费，清空避免重复写
      // ★ teleportTarget 一次性：下发一拍后立刻清除，否则每次 tick 响应都会
      //   重新触发前端传送 watch，把玩家反复拉回目标点（表现 = 被绑住）
      if ((s as any).teleportTarget) (s as any).teleportTarget = null;
      s.tick += 1;
      // ★ fix⑤（缺口①）：前端上报 localEnemies（{epoch,bounds,list}）时，先据此重建当前关卡敌怪表
      const localBuilt = applyLocalEnemies(s, (params as any)?.localEnemies);
      // ★ 敌人碰撞：前端只在切图那一次带上可行走网格（tileset 属性只有 iframe 侧解过）
      applyEnemyNavPayload((params as any)?.walkGrid);
      // ★ v5：同步系统面板（当前地图名 / 参数卡外部改动 / 角色卡位置 / 队伍）
      if (str((params as any)?.levelName)) s.levelName = str((params as any).levelName, s.levelName || "");
      syncCardFromContext(s, context);
      applyBagAttributes(s); // ★ game.md 背包被动属性加成（Defense/Attack/Life/Blue）
      syncPlayerCardStats(s); // ★ game.md 等级系统：等级/经验/HP/MP → 动态角色卡（变化才回写）
      ensureNpcCards(s, s.levelName || "");
      if (s.tick % SYS_PERSIST_EVERY_TICKS === 0) void persistSys(context, s);
      step(s, params?.input || params, params?.player);   // ★ fix③：把客户端上报的权威位姿透传给 step
      // ★ 角色驻留地图：检测到玩家换图后，非组队角色留在原图（停车），组队角色跟来
      if (s.levelName && s.levelName !== (s as any)._levelAt) {
        handleLevelChange(s, true);
        (s as any)._levelAt = s.levelName;
        ensureNpcCards(s, s.levelName || "");
      }
      if (localBuilt > 0) pushEvent(s, `当前关卡敌怪已接入宿主 AI（${localBuilt} 只）`);
      return okResp("");
    }

    case "skill": {
      if (s.phase !== "playing") return okResp("");
      const idx = num(params?.index, 0);
      const slotIdx = s.skillPage * 4 + idx;
      const skill = s.skills[slotIdx];
      const player = s.entities.find((e) => e.side === "player");
      if (!skill || !player || !player.alive) return okResp("");
      if (skill.cdLeft > 0) return okResp(`${skill.name} 冷却中`);
      const targets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(player, e) < SKILL_RANGE_M);
      if (!targets.length) { damage(s, s.entities.filter(e=>e.side==="enemy"&&e.alive)[0] || player, 0); return okResp(`${skill.name} 未命中`); }
      skill.cdLeft = skill.cd;
      // ★ v5：通用特效（无专属特效时）—— 角色小跳 + 飘字
      (player as any).actionBobMs = 300;
      floater(s, skill.name, player.x, player.y - 34);
      // ★ game.md 技能特效：远程→火球 / 治疗→治疗环 / 加强→护盾环 / 其余→冲斩刀光
      const fx = skillFxKind(skill);
      if (fx === "heal") {
        pushVfx(s, { kind: "heal_ring", entityId: player.id, x: player.x, y: player.y, life: 18, total: 18, color: "#7CFFB2", size: 1.0 });
      } else if (fx === "buff") {
        pushVfx(s, { kind: "buff_ring", entityId: player.id, x: player.x, y: player.y, life: 30, total: 30, color: "#9CCFFF", size: 1.0 });
      } else if (fx === "ranged") {
        const t0 = targets[0];
        pushVfx(s, {
          kind: "fireball", entityId: player.id, targetEntityId: t0?.id,
          x: player.x, y: player.y, targetX: t0?.x ?? player.x, targetY: t0?.y ?? player.y,
          facing: player.facing, life: 16, total: 16, color: "#ff6a00", size: 1.0,
        });
      } else {
        pushVfx(s, { kind: "slash_arc", entityId: player.id, x: player.x, y: player.y, facing: player.facing, life: 12, total: 12, color: "#fff", size: 1.6 });
      }
      targets.slice(0, 3).forEach((t) => damage(s, t, skill.power));
      pushEvent(s, `施放 ${skill.name}，命中 ${Math.min(3, targets.length)} 个目标`);
      return okResp(`${skill.name}`);
    }

    case "item": {
      if (s.phase !== "playing") return okResp("");
      const idx = num(params?.index, 0);
      const slotIdx = s.itemPage * 4 + idx;
      const item = s.items[slotIdx];
      if (!item) return okResp("");
      // ★ game.md 物品栏使用：与背包面板同一套 type 分路特效 / 耐久 / 属性逻辑
      return okResp(useBagItem(s, item.name));
    }

    /* ============ ★ v5：系统面板（背包 / 纳戒 / 商城 / 技能 / 地图 / 角色卡）============ */

    case "sys": {
      // 前端打开系统面板时上报已知关卡（大地图）与当前地图名
      const levels = Array.isArray(params?.levels) ? params.levels.map(String).filter(Boolean) : [];
      if (levels.length) {
        s.mapNodes = levels.map((n, i) => ({ name: n, x: 160 + (i % 4) * 260, y: 140 + Math.floor(i / 4) * 200 }));
      }
      if (str(params?.levelName)) s.levelName = str(params.levelName, s.levelName || "");
      if (!s.ring) s.ring = { items: [], skills: [] };
      if (!Array.isArray(s.partyIds)) s.partyIds = [];
      if (!s.shopGoods || !s.shopGoods.length) await refreshShop(context, s);
      ensureNpcCards(s, s.levelName || "");
      await persistSys(context, s);
      return okResp("");
    }

    case "sys_sell": {
      const name = str(params?.name);
      const ask = Math.max(1, Math.round(num(params?.count, 1)));
      const card = (s.playerCard || {}) as Record<string, any>;
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder);
      const it = bag.find((x) => x.name === name);
      if (!it) return okResp(`背包里没有「${name}」`);
      const sold = Math.min(ask, it.count);
      const gain = sellPrice(it) * sold;
      const nextBag = bag
        .map((x) => (x.name === name ? { ...x, count: x.count - sold } : x))
        .filter((x) => x.count > 0);
      patchCard(s, { items: serializeBag(nextBag, card.items), money: Math.round(num(card.money, 0)) + gain });
      pushEvent(s, `卖出 ${name}×${sold}，获得 ${gain} 金钱`);
      const me = playerEntity(s);
      if (me) floater(s, `+${gain} 金`, me.x, me.y - 30);
      await persistSys(context, s);
      return okResp(`卖出 ${name}×${sold}（+${gain} 金）`);
    }

    case "sys_use_item": {
      // 背包 / 物品栏点击使用：type 分路特效 / 耐久 / 属性逻辑统一在 useBagItem
      const name = str(params?.name);
      const msg = useBagItem(s, name);
      await persistSys(context, s);
      return okResp(msg);
    }

    case "sys_sort": {
      // 背包排列顺序（前端上移/下移/置顶后提交）
      const order = Array.isArray(params?.order) ? params.order.map(String) : [];
      const card = (s.playerCard || {}) as Record<string, any>;
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, order.length ? order : s.bagOrder);
      s.bagOrder = bag.map((x) => x.name);
      patchCard(s, { items: serializeBag(bag, card.items) });
      await persistSys(context, s);
      return okResp("背包顺序已更新");
    }

    case "sys_ring_move": {
      // 背包 ⇄ 纳戒（物品 / 技能）
      const kind = str(params?.kind, "item");
      const name = str(params?.name);
      const to = str(params?.to, "ring") === "bag" ? "bag" : "ring";
      const ask = Math.max(1, Math.round(num(params?.count, 1)));
      if (!name) return okResp("缺少名称");
      if (!s.ring) s.ring = { items: [], skills: [] };
      const card = (s.playerCard || {}) as Record<string, any>;
      if (kind === "skill") {
        const skills = Array.isArray(card.skills)
          ? card.skills.map((x: any) => (typeof x === "string" ? x : str((x as any)?.name))).filter(Boolean)
          : [];
        const ringSkills = s.ring.skills || [];
        if (to === "ring") {
          if (skills.indexOf(name) < 0) return okResp(`技能「${name}」不在技能栏`);
          s.ring.skills = Array.from(new Set([...ringSkills, name]));
          patchCard(s, { skills: skills.filter((x) => x !== name) });
          pushEvent(s, `技能 ${name} 已存入纳戒`);
        } else {
          if (ringSkills.indexOf(name) < 0) return okResp(`纳戒里没有技能「${name}」`);
          s.ring.skills = ringSkills.filter((x) => x !== name);
          patchCard(s, { skills: Array.from(new Set([...skills, name])) });
          pushEvent(s, `技能 ${name} 已从纳戒取出`);
        }
        await persistSys(context, s);
        return okResp(to === "ring" ? `已存入纳戒：${name}` : `已取出：${name}`);
      }
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder);
      if (to === "ring") {
        const it = bag.find((x) => x.name === name);
        if (!it) return okResp(`背包里没有「${name}」`);
        const moved = Math.min(ask, it.count);
        const ringItems = s.ring.items || [];
        const exist = ringItems.find((x) => x.name === name);
        if (exist) exist.count += moved;
        else ringItems.push({ ...it, count: moved });
        s.ring.items = ringItems;
        const nextBag = bag
          .map((x) => (x.name === name ? { ...x, count: x.count - moved } : x))
          .filter((x) => x.count > 0);
        patchCard(s, { items: serializeBag(nextBag, card.items) });
        pushEvent(s, `${name}×${moved} 已存入纳戒`);
      } else {
        const ringItems = s.ring.items || [];
        const it = ringItems.find((x) => x.name === name);
        if (!it) return okResp(`纳戒里没有「${name}」`);
        const moved = Math.min(ask, it.count);
        const exist = bag.find((x) => x.name === name);
        if (exist) exist.count += moved;
        else bag.push({ ...it, count: moved });
        s.ring.items = ringItems
          .map((x) => (x.name === name ? { ...x, count: x.count - moved } : x))
          .filter((x) => x.count > 0);
        s.bagMeta = { ...(s.bagMeta || {}), [it.name]: { ...it, count: 0 } };
        patchCard(s, { items: serializeBag(bag, card.items) });
        pushEvent(s, `${name}×${moved} 已从纳戒取出`);
      }
      await persistSys(context, s);
      return okResp(to === "ring" ? `已存入纳戒：${name}` : `已取出：${name}`);
    }

    case "sys_rest": {
      // ★ game.md 5：睡觉 / 住宿 / 休息过夜 → 直接满血满蓝，恢复描述写入角色卡 other
      if (s.phase !== "playing") return okResp("");
      const meRest = playerEntity(s);
      if (!meRest || !meRest.alive) return okResp("角色不可用");
      (meRest as any).actionBobMs = 300;
      restorePlayerFull(s, str(params?.reason, "休息"));
      return okResp(`🎉 恭喜您已恢复到最佳状态！HP ${Math.round(meRest.hp)}/${Math.round(meRest.maxHp)}，MP ${Math.round(num(meRest.mp, 0))}/${Math.round(num(meRest.maxMp, 0))}`);
    }

    case "sys_use_skill": {
      // 系统面板「技能」页 / 快捷栏点击使用：无专属特效时统一走「小跳 + 飘字」
      const skName = str(params?.name);
      const skIdx = num(params?.index, -1);
      const meSk = playerEntity(s);
      if (!meSk || !meSk.alive) return okResp("角色不可用");
      const si = skIdx >= 0 ? skIdx : s.skills.findIndex((k) => k.name === skName);
      const sk = s.skills[si];
      if (!sk) return okResp(`技能「${skName}」不存在`);
      if (sk.cdLeft > 0) return okResp(`${sk.name} 冷却中`);
      sk.cdLeft = sk.cd;
      (meSk as any).actionBobMs = 300;
      floater(s, sk.name, meSk.x, meSk.y - 34);
      const skTargets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(meSk, e) < SKILL_RANGE_M);
      // ★ game.md 技能特效（与「skill」共用一套归类）：远程→火球 / 治疗→治疗环 / 加强→护盾环 / 其余→冲斩刀光
      const _fx = skillFxKind(sk);
      if (_fx === "heal") {
        pushVfx(s, { kind: "heal_ring", entityId: meSk.id, x: meSk.x, y: meSk.y, life: 18, total: 18, color: "#7CFFB2", size: 1.0 });
      } else if (_fx === "buff") {
        pushVfx(s, { kind: "buff_ring", entityId: meSk.id, x: meSk.x, y: meSk.y, life: 30, total: 30, color: "#9CCFFF", size: 1.0 });
      } else if (_fx === "ranged") {
        const _t0 = skTargets[0];
        pushVfx(s, {
          kind: "fireball", entityId: meSk.id, targetEntityId: _t0?.id,
          x: meSk.x, y: meSk.y, targetX: _t0?.x ?? meSk.x, targetY: _t0?.y ?? meSk.y,
          facing: meSk.facing, life: 16, total: 16, color: "#ff6a00", size: 1.0,
        });
      } else {
        pushVfx(s, { kind: "slash_arc", entityId: meSk.id, x: meSk.x, y: meSk.y, facing: meSk.facing, life: 12, total: 12, color: "#fff", size: 1.6 });
      }
      if (!skTargets.length) {
        pushEvent(s, `施放 ${sk.name}，未命中目标`);
        return okResp(`${sk.name} 未命中`);
      }
      skTargets.slice(0, 3).forEach((t) => damage(s, t, sk.power));
      pushEvent(s, `施放 ${sk.name}，命中 ${Math.min(3, skTargets.length)} 个目标`);
      return okResp(`${sk.name}`);
    }

    case "sys_skill_edit": {
      // ★ game.md 技能修改：修改后保存到 t_plugin_session_data（skillMeta + 参数卡技能名列表）
      const idx = Math.round(num(params?.index, -1));
      const sk = s.skills[idx];
      if (!sk) return okResp("技能不存在");
      const oldKey = skillKey(sk.name);
      const nm = cleanSkillName(str(params?.name, sk.name)).slice(0, 12) || sk.name;
      sk.name = nm;
      sk.power = Math.max(0, Math.round(num(params?.power, sk.power)));
      sk.cost = Math.max(0, Math.round(num(params?.cost, sk.cost)));
      sk.cd = Math.max(1, Math.round(num(params?.cd, sk.cd)));
      sk.type = (["atk", "heal", "buff"] as const).includes(params?.type as any) ? (str(params?.type) as any) : (sk.type || "atk");
      sk.range = str(params?.range) === "ranged" ? "ranged" : "melee";
      sk.lv = Math.max(1, Math.round(num(params?.lv, sk.lv || 1)));
      sk.buff_type = BUFF_TYPES.includes(str(params?.buff_type)) ? str(params?.buff_type) : "";
      s.skillMeta = { ...(s.skillMeta || {}), [skillKey(nm)]: { power: sk.power, cost: sk.cost, cd: sk.cd, type: sk.type, range: sk.range, lv: sk.lv, buff_type: sk.buff_type } };
      // 参数卡「技能」只保存技能名称列表：改名/升级时替换原条目（带 lv 注记）
      const card = (s.playerCard || {}) as Record<string, any>;
      const flat: string[] = [];
      (Array.isArray(card.skills) ? card.skills : []).forEach((x: any) => {
        if (typeof x === "string") splitSkillList(x).forEach((p: string) => { if (cleanSkillName(p)) flat.push(p.trim()); });
        else { const n = str(x?.name); if (n) flat.push(n); }
      });
      const at = flat.findIndex((x) => skillKey(x) === oldKey);
      const annotated = sk.lv! > 1 ? `${nm}（lv${sk.lv}）` : nm;
      if (at >= 0) flat[at] = annotated; else flat.push(annotated);
      patchCard(s, { skills: flat });
      pushEvent(s, `技能「${nm}」参数已修改并保存`);
      await persistSys(context, s);
      const tLabel = sk.type === "heal" ? "治疗" : sk.type === "buff" ? `强化(${sk.buff_type || "-"})` : sk.range === "ranged" ? "远程" : "近战";
      return okResp(`「${nm}」已保存（${tLabel}·lv${sk.lv}）`);
    }

    case "sys_item_edit": {
      // ★ game.md 物品修改：修改后保存到 t_plugin_session_data（itemMeta + 参数卡物品名列表）
      const idx = Math.round(num(params?.index, -1));
      const card = (s.playerCard || {}) as Record<string, any>;
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
      const it = idx >= 0 ? bag[idx] : bag.find((x) => x.name === str(params?.name));
      if (!it) return okResp("物品不存在");
      const oldName = it.name;
      const nm = str(params?.name, it.name).trim().slice(0, 20) || it.name;
      it.name = nm;
      it.power = Math.max(0, Math.round(num(params?.power, it.power || 0)));
      it.cost = Math.max(0, Math.round(num(params?.cost, it.cost || 0)));
      it.cd = Math.max(0, Math.round(num(params?.cd, it.cd || 0)));
      it.type = ((ITEM_TYPES as readonly string[]).includes(str(params?.type)) ? str(params?.type) : (it.type || "heal")) as ItemType;
      it.range = str(params?.range) === "ranged" ? "ranged" : "melee";
      it.lv = Math.max(1, Math.round(num(params?.lv, it.lv || 1)));
      it.buff_type = (BUFF_TYPES as readonly string[]).includes(str(params?.buff_type)) ? str(params?.buff_type) : "";
      it.durability = clamp(Math.round(num(params?.durability, it.durability == null ? -1 : it.durability)), -1, 99999);
      it.attribute_type = (ITEM_ATTR_TYPES as readonly string[]).includes(str(params?.attribute_type)) ? str(params?.attribute_type) : "";
      it.attribute_value = Math.round(num(params?.attribute_value, it.attribute_value || 0));
      // ★ game.md quantity/description：先汇总原条目数量与描述，再决定写回值
      const flat: string[] = [];
      (Array.isArray(card.items) ? card.items : []).forEach((x: any) => {
        if (typeof x === "string") splitSkillList(x).forEach((p: string) => { if (p.trim()) flat.push(p.trim()); });
        else { const n2 = str(x?.name); if (n2) flat.push(n2); }
      });
      let total = 0;
      let desc = "";
      // 参数卡物品是自由文本（「银鲤×3（钓鱼累积…）」），比对前先归一（剥注记/×N）
      const normName = (v: string) => String(v || "").replace(/[（(][^）)]*[）)]/g, " ").replace(/[×xX*]\s*\d+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      const oldNk = normName(oldName);
      flat.forEach((x) => {
        const p = parseItemRaw(x);
        if (!p.name || normName(p.name) !== oldNk) return;
        total += p.count;
        if (p.desc && !desc) desc = p.desc;
      });
      if (!total) total = it.count;
      const qty = params?.quantity != null ? Math.max(1, Math.round(num(params.quantity, total))) : total;
      const descNew = str(params?.description, "");
      const descFinal = descNew || desc;
      const metaEntry: ItemMeta = {
        power: it.power!, cost: it.cost!, cd: it.cd!,
        type: it.type as ItemType, range: it.range as "melee" | "ranged",
        lv: it.lv!, buff_type: it.buff_type!,
        durability: it.durability!, durabilityLeft: it.durability!,
        attribute_type: it.attribute_type!, attribute_value: it.attribute_value!,
        quantity: qty, description: descFinal,
      };
      s.itemMeta = { ...(s.itemMeta || {}) };
      if (oldName !== nm) delete s.itemMeta[oldName];
      s.itemMeta[nm] = metaEntry;
      // 参数卡「物品」只保存名称列表：展平后替换同名条目（数量取 qty、lv>1 加 lv 注记、描述注记保留/更新）
      const annotated = `${nm}${qty > 1 ? `×${qty}` : ""}${it.lv! > 1 ? `（lv${it.lv}）` : ""}${descFinal ? `（${descFinal}）` : ""}`;
      const at = flat.findIndex((x) => normName(parseItemRaw(x).name) === oldNk);
      const kept = flat.filter((x) => normName(parseItemRaw(x).name) !== oldNk);
      kept.splice(Math.max(0, Math.min(at < 0 ? kept.length : at, kept.length)), 0, annotated);
      patchCard(s, { items: kept });
      applyBagAttributes(s);
      pushEvent(s, `物品「${nm}」参数已修改并保存`);
      await persistSys(context, s);
      const tLabel2 = it.type === "heal" ? "治疗" : it.type === "buff" ? `强化(${it.buff_type || "-"})` : it.type === "attribute" ? `属性(${it.attribute_type || "-"})` : it.range === "ranged" ? "远程" : "近战";
      const dLabel = it.durability! < 0 ? "永久" : `耐久${it.durability}`;
      return okResp(`「${nm}」已保存（${tLabel2}·${dLabel}·×${qty}）`);
    }

    case "sys_shop_refresh": {
      await refreshShop(context, s);
      await persistSys(context, s);
      const src = s.shopSource === "agent" ? "商城agent·故事物资" : "插件常备物资";
      // ★ 回复带时间戳：连续两次刷新若货源一致，文本不同才能触发前端 response watch
      const ts = new Date().toTimeString().slice(0, 8);
      return okResp(`商城已刷新 ${ts}（${(s.shopGoods || []).length} 件商品，货源：${src}）`);
    }

    case "sys_shop_buy": {
      const id = str(params?.id);
      const ask = Math.max(1, Math.round(num(params?.count, 1)));
      const good = (s.shopGoods || []).find((g) => g.id === id) || BUILTIN_SHOP_GOODS.find((g) => g.id === id);
      if (!good) return okResp("商品不存在");
      const card = (s.playerCard || {}) as Record<string, any>;
      const money = Math.round(num(card.money, 0));
      const cost = Math.round(good.price) * ask;
      if (money < cost) return okResp(`金钱不足：需要 ${cost}，现有 ${money}`);
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
      const exist = bag.find((x) => x.name === good.name);
      if (exist) exist.count += ask;
      else bag.push({ name: good.name, count: ask, kind: good.kind, rarity: good.rarity, heal: good.heal, price: good.price, desc: good.desc });
      s.bagMeta = {
        ...(s.bagMeta || {}),
        [good.name]: { name: good.name, count: 0, kind: good.kind, rarity: good.rarity, heal: good.heal, price: good.price, desc: good.desc },
      };
      patchCard(s, { items: serializeBag(bag, card.items), money: money - cost });
      pushEvent(s, `购买 ${good.name}×${ask}，花费 ${cost} 金钱`);
      const me = playerEntity(s);
      if (me) floater(s, `-${cost} 金`, me.x, me.y - 30);
      await persistSys(context, s);
      return okResp(`购买 ${good.name}×${ask}`);
    }

    case "sys_party": {
      // 组队跟随开关（敌对角色与用户自身不可组队）
      const rid = str(params?.roleId);
      if (!rid) return okResp("缺少角色");
      const summon = !!params?.summon;
      const flag = params?.follow;
      const follow = !(flag === false || flag === 0 || flag === "0" || flag === "false");
      let e = s.entities.find((x) => x.id === rid || x.name === rid);
      if (e && e.side === "enemy") return okResp("敌对角色无法组队");
      // ★ 组队/召唤：角色停在别的地图（s.parked）→ 先接回当前图
      if (!e && (follow || summon)) {
        const parkedObj: any = (s as any).parked || {};
        for (const k of Object.keys(parkedObj)) {
          const arr = Array.isArray(parkedObj[k]) ? parkedObj[k] : [];
          const idx = arr.findIndex((x: any) => String(x.id) === rid || String(x.name) === rid);
          if (idx >= 0) {
            e = arr.splice(idx, 1)[0];
            s.entities.push(e);
            break;
          }
        }
      }
      // ★ game.md 组队/召唤：角色还没上场（无实体）时，先按角色位置规则生成到可活动区域
      if (!e && (follow || summon)) {
        const role = (s.roles as any[] || []).find((r) => String(r?.id) === rid || String(r?.name) === rid);
        e = spawnRoleEntity(s, role) || undefined as any;
      }
      if (e && (follow || summon)) (e as any).mapName = s.levelName || (e as any).mapName;

      // ★ 召唤模式：只把角色传到玩家旁边并设为友方，不入队、不跟随
      if (summon) {
        if (e) {
          if (!(e as any)._baseSide) (e as any)._baseSide = e.side;
          e.side = "ally";
          if (!e.alive) { e.alive = true; e.hp = e.maxHp; }
          // TP 到玩家身边
          const me = playerEntity(s);
          if (me) {
            // ★ 紧贴玩家身边（约 2 米，玩家视野 13m 能直接看到）
            const p = clampToBound(s, me.x + 2, me.y + 2);
            e.x = p.x;
            e.y = p.y;
            (e as any).homeX = e.x;
            (e as any).homeY = e.y;
          }
        }
        ensureNpcCards(s, s.levelName || "");
        pushEvent(s, `${e?.name || rid} 已召唤到你身边（不加入队伍）`);
        await persistSys(context, s);
        return okResp(`已召唤 ${e?.name || rid} 到身边`);
      }

      const set = new Set(s.partyIds || []);
      if (follow) set.add(rid); else set.delete(rid);
      s.partyIds = Array.from(set);
      if (e) {
        if (follow) {
          // 记住入队前的阵营（ally/neutral/spectator），退队时还原——中立 NPC 退队不能变成敌人样
          if (!(e as any)._baseSide) (e as any)._baseSide = e.side;
          e.side = "ally";
          if (!e.alive) { e.alive = true; e.hp = e.maxHp; }
        } else {
          // ★ 取消组队：保存角色当前位置到 parked，下次召唤/入队时可以恢复位置
          const mapName = (e as any).mapName || s.levelName || "";
          if (!s.parked) s.parked = {};
          if (!s.parked[mapName]) s.parked[mapName] = [];
          // 去重（同一角色只保留最新位置）
          (s.parked[mapName] as any[]) = (s.parked[mapName] as any[]).filter((x) => String(x.id) !== String(e.id));
          (s.parked[mapName] as any[]).push({ id: e.id, name: e.name, x: e.x, y: e.y, mapName });
          e.side = (e as any)._baseSide || "spectator";
          // ★ 清零速度：取消组队后 tick 还会按残留 vx/vy 继续位移，必须归零才能就地停留
          e.vx = 0; e.vy = 0;
          (e as any).wanderTimer = 0;
        }
      }
      ensureNpcCards(s, s.levelName || "");
      pushEvent(s, `${e?.name || rid} ${follow ? "加入队伍，开始跟随你战斗" : "已脱离队伍"}`);
      await persistSys(context, s);
      return okResp(follow ? "已组队跟随" : "已取消跟随");
    }

    case "sys_teleport": {
      // 传送到角色身边：把目标地图/坐标交给前端（前端负责切图与落点）
      const rid = str(params?.roleId);
      ensureNpcCards(s, s.levelName || "");
      let c = (s.npcCards || []).find((x) => x.id === rid || x.name === rid);
      if (!c) return okResp("角色不存在");
      // ★ game.md 角色位置问题：没有位置信息的角色，默认生成到可活动区域再传送
      if (!(c as any).onMap) {
        const role = ((s.roles as any[]) || []).find((r) => String(r?.id) === String(c!.id) || String(r?.name) === String(c!.name));
        const e = spawnRoleEntity(s, role);
        if (e) {
          ensureNpcCards(s, s.levelName || "");
          c = (s.npcCards || []).find((x) => x.id === String(c!.id)) || c;
          pushEvent(s, `${c!.name} 已生成到可活动区域`);
        }
      }
      s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
      s.teleportTarget = {
        mapName: c.mapName || s.levelName || "",
        x: c.x,
        y: c.y,
        name: c.name,
        rev: s.sysRevision,
      };
      pushEvent(s, `传送到 ${c.name} 身边（${c.mapName || "当前地图"}）`);
      await persistSys(context, s);
      return okResp(`已传送到 ${c.name} 身边`);
    }

    case "sys_travel": {
      // 大地图传送：目标关卡交给前端 switchLevel
      const target = str(params?.mapName);
      if (!target) return okResp("缺少目标地图");
      s.levelName = target;
      handleLevelChange(s, false);
      (s as any)._levelAt = s.levelName;
      ensureNpcCards(s, target);
      s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
      // ★ 大地图传送统一走 teleportTarget 通道（前端只 watch 它；travelTarget 从无人消费，是死代码）
      (s as any).teleportTarget = { mapName: target, x: 0, y: 0, name: target, rev: s.sysRevision };
      pushEvent(s, `传送至「${target}」`);
      await persistSys(context, s);
      return okResp(`已传送至「${target}」`);
    }

    case "sys_chat": {
      // ★ game.md 对话功能：调用角色发言器 agent（task-speaker-agent）
      // mode="options" → 返回 AI 生成的3个发言选项（不显示角色台词）
      // mode="response" → 返回角色台词，用户选了选项或发了自定义消息后调用
      const npcId = str(params?.npcId, "");
      const npcName = str(params?.npcName, "???");
      const userText = params?.userText as string | null | undefined;
      const lastResp = str(params?.lastResp, "");
      const mode = str(params?.mode, "response");
      /** ★ 前端生成的请求 id：结果写进 state.chatResult，前端按它配对取回（HTTP 回包会被 tick 覆盖） */
      const reqId = str(params?.reqId, "");
      if (!npcId) return okResp("缺少角色标识");

      // 查找角色
      const npcEntity = s.entities.find((e) => e.id === npcId);
      // ★ 用 string 化：Entity.side 的联合类型不含 "neutral"（地图 NPC 是运行时扩展阵营），
      //   直接比较会触发 TS2367（与既有基线同类），转 string 避免新增类型错误。
      const npcSide = String(npcEntity?.side || "");
      const roleEntry = ((s.roles as any[]) || []).find(
        (r) => String(r?.id) === npcId || String(r?.name) === npcId,
      );
      const entityName = String((npcEntity as any)?.name || "").trim();
      /** ★ 身份判定：有角色卡 / 有实体名 / 调用方传了真名 → 都以自己的身份说话。
       *   只有「既无卡又无名的中立实体」才算旁白 —— 城镇地图 NPC（side=neutral）不是旁白！ */
      const hasIdentity =
        !!roleEntry?.name ||
        (entityName !== "" && entityName !== "NPC") ||
        (npcName !== "" && npcName !== "???" && npcName !== "NPC");
      const isNeutral = npcSide === "neutral" && !hasIdentity;
      const roleName = isNeutral
        ? "旁白"
        : str(roleEntry?.name || entityName || npcName, npcName);
      /** ★ 角色卡：故事角色用动态卡；地图 NPC 用实体信息现拼（让 agent 知道它是谁、在哪） */
      const npcCard = isNeutral
        ? null
        : (roleEntry || {
            id: npcId,
            name: roleName,
            roleType: npcSide === "ally" ? "ally" : "npc",
            description: String((npcEntity as any)?.desc || (npcEntity as any)?.dialog || ""),
            level: (npcEntity as any)?.level ?? 1,
            entity_type: (npcEntity as any)?.entity_type,
            gid: (npcEntity as any)?.gid,
            mapName: s.levelName || "",
            x: (npcEntity as any)?.x,
            y: (npcEntity as any)?.y,
          });

      // 调用角色发言器 agent
      try {
        if (context?.tsApi?.agent) {
          const result = await context.tsApi.agent.run("task-speaker-agent", {
            npcId,
            npcName: roleName,
            npcCard,
            isNeutral,
            userText: userText ?? null,
            lastResp: lastResp || null,
            mode,
            context: {
              storyDigest: context?.sessionId ? `session:${context.sessionId}` : "",
              playerLevel: (s.entities.find((e) => e.side === "player")?.level) ?? 1,
            },
          });
          if (result?.ok && result?.output?.text) {
            // ★ 模型常把内容包进 ```json 代码围栏 → 先剥围栏再解析/展示
            const raw = String(result.output.text)
              .replace(/^\s*```[a-zA-Z]*\s*/, "")
              .replace(/\s*```\s*$/, "")
              .trim();
            // mode=options → 解析3个选项返回（agent 应返回 JSON array 或逗号分隔的3行）
            if (mode === "options") {
              let options: string[] = [];
              try {
                // 尝试 JSON array
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) options = parsed.slice(0, 3);
              } catch {
                // 尝试每行一个选项（去掉编号前缀如 "1. " / "① " 等）
                options = raw.split(/\n/).map((l: string) => l.replace(/^[0-9a-zA-Z一二三四五六七七八九十]+[.、)）]+/, "").trim()).filter(Boolean).slice(0, 3);
              }
              if (options.length === 0) throw new Error("agent 未返回有效选项");
              // ★ 写回 state：前端 watch state.chatResult 按 reqId 取回
              s.chatResult = { reqId, ok: true, mode, speaker: roleName, options };
              await persistSys(context, s);
              return okResp(JSON.stringify({ options }));
            }
            // mode=response → 返回角色台词
            s.chatResult = { reqId, ok: true, mode, speaker: roleName, text: raw };
            pushEvent(s, `${roleName}：${raw}`);
            await persistSys(context, s);
            return okResp(JSON.stringify({ speaker: roleName, text: raw, avatar: roleEntry?.avatarPath ?? undefined }));
          }
          if (result?.error) {
            console.warn("[field-survival] sys_chat agent error:", result.error);
            // ★ 失败也要回包，否则前端一直 pending
            s.chatResult = { reqId, ok: false, mode, error: String(result.error) };
            await persistSys(context, s);
            return okResp(JSON.stringify({ error: String(result.error), mode, npcName: roleName }));
          }
        }
      } catch (e) {
        console.warn("[field-survival] sys_chat agent call failed:", e);
        const msg = String((e as any)?.message || e || "角色发言器调用异常");
        s.chatResult = { reqId, ok: false, mode, error: msg };
        await persistSys(context, s);
        return okResp(JSON.stringify({ error: msg, mode, npcName: roleName }));
      }

      // ★ 角色发言器 agent 不可用时 → 直接报错，不兜底
      const errMsg = `角色发言器 agent 未配置或调用失败（${mode}）`;
      s.chatResult = { reqId, ok: false, mode, error: errMsg };
      await persistSys(context, s);
      return okResp(JSON.stringify({
        error: errMsg,
        fallback: false,
        mode,
        npcName: roleName,
      }));
    }

    case "page": {
      const kind = str(params?.kind, "skill");
      const delta = num(params?.delta, 1);
      if (kind === "item") {
        const pages = Math.ceil(s.items.length / 4) || 1;
        s.itemPage = (s.itemPage + delta + pages) % pages;
      } else {
        const pages = Math.ceil(s.skills.length / 4) || 1;
        s.skillPage = (s.skillPage + delta + pages) % pages;
      }
      return okResp("");
    }

    case "revive": {
      // ★ 死亡弹窗「复活」：原地复活 —— 玩家坐标保持死亡处不变，
      //   血量恢复满、alive 复位、冷却与速度清零，phase 回到 playing 继续可玩。
      const player = s.entities.find((e) => e.side === "player");
      if (!player) return okResp("");
      // 仅死亡/结算态可复活；仍在战斗中且存活时忽略（避免当作回血道具滥用）
      if (s.phase === "playing" && player.alive) return okResp("");
      player.alive = true;
      player.hp = player.maxHp;
      player.vx = 0;
      player.vy = 0;
      // 复活保护：给场上存活敌人一段攻击冷却（2 秒），避免复活瞬间被贴脸秒杀
      s.entities.forEach((e) => {
        if (e.side === "enemy" && e.alive) e.cooldown = Math.max(e.cooldown || 0, 20);
      });
      s.result = null;
      s.phase = "playing";
      pushEvent(s, `你在原地复活（生命 ${Math.round(player.hp)}/${Math.round(player.maxHp)}）`);
      return { code: 0, message: "revive", state: s, response: "复活成功" };
    }

    case "exit":
    case "quit": {
      if (s.phase !== "playing") return okResp("");
      s.phase = "over";
      s.result = {
        reason: "exit",
        exp: s.exp, money: s.money, drops: [...s.drops], kills: s.kills, survivedTicks: s.tick,
      };
      pushEvent(s, "你主动结束了本次野外生存。");
      return { code: 0, message: "exit", state: s, response: "野外生存结束" };
    }

    default:
      // ★ 防御：用户聊天消息触发 handle_action 时，若仍处于选人阶段则提示用户先选人开始
      if (s.phase === "select") {
        return { code: 0, message: "select_phase", state: s,
                 response: "请先在左侧面板选择角色并点击「开始」来启动野外生存。" };
      }
      return okResp("");
  }
}
