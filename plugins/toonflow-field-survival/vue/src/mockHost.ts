/**
 * 本地模拟宿主（standalone 模式）
 *
 * 触发条件：
 *   1. game.html 直接以 file:// 打开（无 location.href 中的 getAsset）
 *   2. 或者父窗口 600ms 内未推送 tf_plugin_state
 *
 * 行为：
 *   - 读取 /test_data/test_state.json（如果存在）覆盖默认角色
 *   - 推送完整的 select 状态（含 15 个 mock 角色）
 *   - 监听 iframe 的 tf_plugin_tick / tf_plugin_action / tf_plugin_fullscreen
 *   - 模拟一个极简的 playing 引擎：玩家移动 + 自动生成野怪 + 攻击结算
 *   - 演示 setFullscreen：响应全屏请求修改自身 URL hash 让 App.vue 看到变化
 */
import type { GameState, Entity, RoleOption, MonsterArchetype, MaterialItem, ItemSlot } from "./types";
// ★ 敌人碰撞：与玩家同一套网格（collision.ts），避免宿主各写一份解析
import {
  decodeWalkGridPacket,
  stepWithAvoidance,
  snapEnemySpawn,
  type WalkGrid,
} from "./collision";

/** ★ test_state.json 加载结果（同时含 roles/monsters/materials） */
interface TestDataBundle {
  roles: RoleOption[];
  monsters: MonsterArchetype[];
  materials: MaterialItem[];
}

/** ★ 静态兜底 safe zone（overworld.json 对应的城镇范围，野怪不得进入城镇） */
let mapSafeZones: Array<{ name: string; x: number; y: number; rx?: number; ry?: number; r?: number; kind: string }> | null = null;

/**
 * ★ 当前生效的 safe zone：优先采用 App 发布的"当前关卡"safe zone（window.__mapSafeZones），
 *   没有发布时才退回静态城镇兜底。
 *   修复点：此前无论玩家走到哪张图都套用城镇 safe 区，进 Mulberry Forest 后玩家仍被判为
 *   "在安全区"→ 波次不刷、野怪不追（森林里一只怪都没有）。
 */
function allowedSafeZones(): Array<{ name: string; x: number; y: number; rx?: number; ry?: number; r?: number; kind: string }> {
  const pub = (window as any).__mapSafeZones;
  if (Array.isArray(pub)) return pub.filter((z: any) => z?.kind === "safe");
  return mapSafeZones ?? [];
}

/** 当前关卡的半宽/半高（米）：由 App 通过 window.__mapHalfSize 发布，缺省 3000×3000 世界 */
function allowedMapHalf(): { lx: number; ly: number } {
  const b = (window as any).__mapHalfSize;
  if (b && Number.isFinite(b.lx) && Number.isFinite(b.ly)) {
    return { lx: Math.max(1, b.lx), ly: Math.max(1, b.ly) };
  }
  return { lx: 1490, ly: 1490 };
}

/** 把坐标推出所有 safe zone（安全区只保护玩家，不冻结世界刷新） */
function pushOutOfSafeZones(x: number, y: number): { x: number; y: number } {
  let px = x, py = y;
  for (const z of allowedSafeZones()) {
    if (z.rx !== undefined && z.ry !== undefined) {
      if (Math.abs(z.x - px) > z.rx || Math.abs(z.y - py) > z.ry) continue;
      const dx = px - z.x, dy = py - z.y;
      if (z.rx + 2 - Math.abs(dx) < z.ry + 2 - Math.abs(dy)) px = z.x + Math.sign(dx || 1) * (z.rx + 2);
      else py = z.y + Math.sign(dy || 1) * (z.ry + 2);
    } else {
      const r = (z.r ?? 30) + 2;
      const dd = Math.hypot(px - z.x, py - z.y);
      if (dd <= r) {
        const k = (r + 0.01) / (dd || 0.01);
        px = z.x + (px - z.x) * k;
        py = z.y + (py - z.y) * k;
      }
    }
  }
  return { x: px, y: py };
}

/**
 * ★ 合并 App 侧生成的地图怪物（mapmob_* / localmob_* / zone_*）。
 *   mock 每 100ms 用自己那份 state 整份覆盖前端，而它并不知道 App 加载出来的森林野怪
 *   → 会把它们当场抹掉。这里在推送前同步：App 侧新增的并入 mock（由 mock 统一驱动 AI/结算），
 *   App 侧已消失的（被击杀 / 切图清理）从 mock 中移除，避免复活。
 */
function syncAppEntities(): void {
  try {
    const collect = (window as any).__collectLocalEnemies;
    if (typeof collect !== "function") return;
    const appList: Entity[] = collect() || [];
    const appIds = new Set(
      appList.map((e) => e?.id).filter((v): v is string => typeof v === "string"),
    );
    const isAppOwned = (id: any) =>
      typeof id === "string" &&
      (id.startsWith("mapmob_") || id.startsWith("localmob_") || id.startsWith("zone_"));
    state.entities = state.entities.filter((e) => !(isAppOwned(e.id) && !appIds.has(e.id)));
    for (const e of appList) {
      if (e && typeof e.id === "string" && !state.entities.some((x) => x.id === e.id)) {
        state.entities.push(snapEnemy(e));
      }
    }
  } catch { /* ignore */ }
}

/* ============================================================
   ★ 敌人碰撞（与玩家同一套网格）
   ------------------------------------------------------------
   墙的位置只有 iframe 侧知道（tileset 属性表 + 地图 JSON 都在前端解），
   所以前端随 tick 把压缩位图传过来（params.walkGrid，仅切图那一次）。
   拿到网格后，敌人的每一步都过 stepWithAvoidance：
   撞墙不是原地抖，而是按"与期望方向最接近"的顺序试其余方向 → 沿墙绕行。
   没有网格（未收到 / 格式不符）→ 退化为原来的直线位移，行为与旧版一致。
   ============================================================ */
const ENEMY_COLLIDE_R = 0.38;
/** 当前关卡的可行走网格（由前端随 tick 上报） */
let walkGrid: WalkGrid | null = null;
/** 已应用的网格世代号（避免重复解析同一份 base64） */
let mockWalkGridEpoch = "";

/** 按 id 幂等更新网格（前端只在切图时发，稳态零开销） */
function applyWalkGridPacket(payload: any): void {
  if (!payload || typeof payload !== "object") return;
  const epoch = String((payload as any).epoch ?? "");
  if (epoch && epoch === mockWalkGridEpoch) return;
  const g = decodeWalkGridPacket((payload as any).grid);
  if (!g) {
    console.warn("[mockHost] walkGrid 载荷无法解析 → 敌人碰撞降级为无阻挡");
    return;
  }
  walkGrid = g;
  mockWalkGridEpoch = epoch;
  console.info(`[mockHost] 敌人碰撞网格已应用：${g.cols}×${g.rows}，阻挡 ${g.blockedCount} 格`);
}

/** 把一只怪吸附到最近的合法格（刷点可能压在墙上） */
function snapEnemy(e: Entity): Entity {
  if (!walkGrid) return e;
  const sp = snapEnemySpawn(walkGrid, e.x, e.y, ENEMY_COLLIDE_R);
  if (sp) { e.x = sp.x; e.y = sp.z; }
  return e;
}

/** 带碰撞的敌方位移（无网格 → 原样直线位移） */
function moveEnemyBy(e: Entity, dx: number, dy: number): void {
  if (!walkGrid) { e.x += dx; e.y += dy; return; }
  const step = Math.hypot(dx, dy);
  if (step < 1e-6) return;
  // ★ 注意：stepWithAvoidance 返回 { x, z }（collision.ts 用 z 表示深度轴），
  //   实体模型用 y —— 曾误写 r.y → y=undefined → 野怪全部从画面/小地图上消失。
  const r = stepWithAvoidance(walkGrid, e.x, e.y, dx, dy, step, ENEMY_COLLIDE_R);
  e.x = r.x;
  e.y = r.z;
}

// 默认角色（当 test_data/test_state.json 不存在时使用）
const DEFAULT_ROLES: RoleOption[] = [
  { id: "r01", name: "陈彦", roleType: "player", avatarPath: "./images/player_sprites/4334.png", initial_level: 1 },
  { id: "r02", name: "裴勇", roleType: "npc", avatarPath: "./images/player_sprites/3858.png" },
  { id: "r03", name: "夜见", roleType: "npc", avatarPath: "./images/player_sprites/4213.png" },
  { id: "r04", name: "聂小可", roleType: "npc" },
  { id: "r05", name: "武飞", roleType: "npc" },
  { id: "r06", name: "黑狼", roleType: "npc" },
  { id: "r07", name: "朱果", roleType: "npc" },
  { id: "r08", name: "骑士", roleType: "npc" },
  { id: "r09", name: "郭奉凯", roleType: "npc" },
  { id: "r10", name: "霍魁", roleType: "npc" },
  { id: "r11", name: "魏靖", roleType: "npc" },
  { id: "r12", name: "林佩雅", roleType: "npc" },
  { id: "r13", name: "暮光者", roleType: "npc" },
  { id: "r14", name: "某男子", roleType: "npc" },
  { id: "r15", name: "某女子", roleType: "npc" },
];

/** 默认野怪（test_state.json 缺失时兜底） */
const DEFAULT_MONSTERS: MonsterArchetype[] = [
  { monsterId: "m001", name: "哥布林斥候", rank: "一阶", monsterType: "普通", entity_type: "GOBLIN",  description: "低阶怪物", recommendLevel: 1, dropItems: [], weakness: [], feature: "" },
  { monsterId: "m002", name: "巨狼",       rank: "一阶", monsterType: "野兽", entity_type: "WILD_GOAT", description: "凶猛野兽",   recommendLevel: 2, dropItems: [], weakness: [], feature: "" },
  { monsterId: "m003", name: "骷髅兵",     rank: "二阶", monsterType: "亡灵", entity_type: "SKELETON", description: "骷髅兵",     recommendLevel: 4, dropItems: [], weakness: [], feature: "" },
];

/** 默认物资（test_state.json 缺失时兜底） */
const DEFAULT_MATERIALS: MaterialItem[] = [];

/** ★ 一次性加载 test_state.json（角色 + 野怪 + 物资），缺字段各自退回默认值
 *  优先级：当前 story（cross-env STORY 注入）> public/test_data/test_state.json > 默认 */
async function loadTestData(): Promise<TestDataBundle> {
  // ★ 故事目录专用 test_state.json 路径（dev/debug 模式下可用）
  // vite.config.ts 提供了 /story-data/ 中间件 → 映射到 workshops/ 目录
  const storyName = (import.meta as any).env?.VITE_STORY
    || (typeof __STORY__ !== "undefined" && __STORY__)
    || "";
  const candidates: string[] = [];
  if (storyName) {
    const enc = encodeURIComponent(storyName);
    candidates.push(
      `/story-data/toonflow-field-survival/map_design/${enc}/test_data/test_state.json`,
    );
  }
  candidates.push(
    "./test_data/test_state.json",
    "../test_data/test_state.json",
    "/test_data/test_state.json",
  );
  for (const p of candidates) {
    try {
      const r = await fetch(p);
      if (r.ok) {
        const d = await r.json();
        console.log("[mockHost] loaded test_state from:", p, "(story:", storyName || "(default)", ")");
        return {
          roles: Array.isArray(d?.roles) && d.roles.length > 0 ? d.roles : DEFAULT_ROLES,
          monsters: Array.isArray(d?.monsters) && d.monsters.length > 0 ? d.monsters : DEFAULT_MONSTERS,
          materials: Array.isArray(d?.materials) ? d.materials : DEFAULT_MATERIALS,
        };
      }
    } catch { /* ignore */ }
  }
  console.warn("[mockHost] no test_state.json found, using defaults");
  return { roles: DEFAULT_ROLES, monsters: DEFAULT_MONSTERS, materials: DEFAULT_MATERIALS };
}

/* ============================================================
   ★ entity_types.json 集成（Rotten-Soup 怪物数据源）
   ------------------------------------------------------------
   这个文件是野怪权威数据源（22 常规敌人 + 4 dungeon theme + 权重表），
   替代硬编码的 MOB_ARCHETYPES 和 DEFAULT_MONSTERS。
   数据流：entity_types.json → loadEntityTypes() → activeEntityTypes
          → spawnWave() 按当前关卡 theme 权重挑怪 → makeEnemyFromEntityType()
   ============================================================ */

/** entity_types.json 顶层结构（节选我们用到的） */
interface EntityTypesData {
  enemies: any[];
  special_enemies?: any[];
  dungeon_themes?: Record<string, { mob_distribution?: Record<string, number>; _deprecated?: boolean }>;
  summary?: any;
}

let activeEntityTypes: EntityTypesData | null = null;

/** 加载 entity_types.json（兜底 ./test_data/test_state.json 里的 monsters → DEFAULT_MONSTERS） */
async function loadEntityTypes(): Promise<EntityTypesData | null> {
  const urls = ["/entity_types.json", "./entity_types.json", "../entity_types.json"];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (r.ok) {
        const d = (await r.json()) as EntityTypesData;
        console.log("[mockHost] loaded entity_types.json (enemies:", d?.enemies?.length || 0,
          "themes:", Object.keys(d?.dungeon_themes || {}).length, ")");
        return d;
      }
    } catch { /* try next */ }
  }
  console.warn("[mockHost] entity_types.json not found, falling back to test_state.json monsters");
  return null;
}

/** 按当前关卡 theme 加权随机选一个敌人 entity_types.json 条目；theme 为 null 或总权重为 0 返回 null */
function pickMonsterByWeight(theme: string | null, et: EntityTypesData | null): any | null {
  if (!et || !theme || !et.dungeon_themes) return null;
  const themeData = et.dungeon_themes[theme];
  if (!themeData || themeData._deprecated) return null;
  const dist = themeData.mob_distribution || {};
  const total = Object.values(dist).reduce((a: number, b: any) => a + (typeof b === "number" ? b : 0), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [type, w] of Object.entries(dist)) {
    r -= (w as number);
    if (r <= 0) {
      // 找匹配的 enemy（普通敌人优先，special 也兜底）
      return et.enemies.find((e) => e.entity_type === type)
          || et.special_enemies?.find((e) => e.entity_type === type)
          || null;
    }
  }
  return null;
}

/** 当前关卡名（由 App.vue 通过 window.__currentLevelName 发布） */
function currentLevelName(): string | null {
  const v = (window as any).__currentLevelName;
  return typeof v === "string" ? v : null;
}

/** 当前关卡对应的 dungeon theme（mulberryTown=null 不刷怪） */
function currentTheme(): "RUINS" | "CATACOMBS" | "MINE" | "ICE" | null {
  // 动态 import 避免循环依赖（mapConfig 引用本文件吗？不引用，但保险起见用静态查表）
  const name = currentLevelName();
  if (!name) return "RUINS";
  // 直接查表（与 mapConfig.THEME_BY_MAPNAME 一致；避免运行时循环依赖）
  const TABLE: Record<string, any> = {
    "Mulberry Town": null,
    "Mulberry Forest": "RUINS",
    "Mulberry Graveyard": "CATACOMBS",
    "Lich Lair": "CATACOMBS",
    "Loot Goblin Lair": "RUINS",
    "Mulberry Dungeon": "RUINS", "Mulberry Dungeon 2": "RUINS", "Mulberry Dungeon 3": "RUINS",
    "Mulberry Dungeon 4": "RUINS", "Mulberry Dungeon 5": "RUINS",
    "Forest Dungeon": "RUINS", "Forest Dungeon 2": "RUINS", "Forest Dungeon 3": "RUINS",
    "Forest Dungeon 4": "RUINS", "Forest Dungeon 5": "RUINS",
    "Kingdom": null,
    "Lich Boss": "CATACOMBS",
  };
  if (TABLE[name] !== undefined) return TABLE[name];
  if (/graveyard|lich|crypt|catacomb|tomb/i.test(name)) return "CATACOMBS";
  if (/mine|cave/i.test(name)) return "MINE";
  if (/ice|frost|snow/i.test(name)) return "ICE";
  return "RUINS";
}

/** 把 entity_types.json 一条 enemy 转成我们 Entity 对象 */
function makeEnemyFromEntityType(
  rs: any, x: number, y: number, lv: number,
): Entity {
  const hp = num(rs.hp, num(rs.maxhp, 30));
  const atk = num(rs.str, num(rs.def, 1));
  const def = num(rs.def, 1);
  const gid = Array.isArray(rs.textures) && rs.textures.length > 0 ? rs.textures[0] : null;
  const avatarPath = gid ? `./images/player_sprites/${gid}.webp` : undefined;
  const isRanged = typeof rs.range === "number" && rs.range > 5;
  const id = "e_" + (++mobIdSeq);
  // ★ game.md：头顶显示类型中文名（name_zh 与 mapConfig.ENTITY_TYPE_ZH 同口径），透传 camp/entity_type
  const name = String(rs.name_zh || rs.name || rs.entity_type || "野怪");
  return {
    id, name, side: "enemy",
    x, y, vx: 0, vy: 0,
    hp, maxHp: hp,
    mp: 0, maxMp: 0,
    exp: 0, expToNext: 0,
    level: lv,
    atk, def,
    facing: 180,
    cooldown: 0,
    alive: true,
    avatarPath,
    isRanged,
    camp: rs.camp === "neutral" || rs.camp === "friendly" ? rs.camp : "hostile",
    entity_type: String(rs.entity_type || ""),
  } as any;
}

/** 等级缩放公式（与 App.vue switchLevel 一致） */
function lvScale(lv: number): number { return 1 + (Math.max(1, lv) - 1) * 0.3; }

/** 推荐等级 → 战斗数值（HP/ATK/DEF 估算；recommendLevel=1 → 30/6/2） */
function mobStatsForLevel(lv: number): { hp: number; atk: number; def: number } {
  const s = lvScale(lv);
  return {
    hp: Math.floor(30 * s),
    atk: Math.floor(6 * s),
    def: Math.floor(2 * s),
  };
}

/** 把 materials[] 转成开局物品栏（所有 materials 都装入） */
function materialsToItems(materials: MaterialItem[]): ItemSlot[] {
  const slots: ItemSlot[] = [];
  for (const m of materials) {
    // 把 effectType 映射到 ItemSlot.type
    let slotType: ItemSlot["type"] = "utility";
    if (m.effectType === "heal_hp") slotType = "hp";
    else if (m.effectType === "heal_mp" || m.effectType === "heal_sp") slotType = "mp";
    else if (m.effectType === "attack") slotType = "atk";
    else if (m.effectType === "buff" || m.effectType === "defense") slotType = "buff";
    const heal = typeof m.stats?.heal === "number" ? m.stats.heal : 0;
    const mp = heal; // heal_sp/heal_mp 都用同一字段表达
    slots.push({
      name: m.name,
      count: m.count ?? 1,
      heal: m.effectType === "heal_mp" || m.effectType === "heal_sp" ? 0 : heal,
      mp: m.effectType === "heal_mp" || m.effectType === "heal_sp" ? heal : (typeof m.stats?.lightRadius === "number" ? 0 : 0),
      type: slotType,
      matId: m.matId,
      matType: m.type,
      description: m.description,
      priceBlack: m.priceBlack,
      stats: m.stats,
      singleUse: m.singleUse,
    });
  }
  return slots;
}

/* ============================================================
   模拟状态机（select → playing → over）
   ============================================================ */
let state: GameState;
let waveTimer = 0;
let mobIdSeq = 1000;
const WAVE_INTERVAL = 240; // 24 秒一波

/** 经验值表：每升一级所需 EXP（Rotten-Soup 风格指数增长） */
function expForLevel(lv: number): number {
  return Math.floor(50 * Math.pow(1.5, lv - 1));
}

/** 升级后属性成长 */
function levelUpEntity(e: Entity): void {
  e.level++;
  e.maxHp += 10; e.hp = e.maxHp; // 升级满血
  e.maxMp += 5; e.mp = e.maxMp;  // 升级满蓝
  e.atk += 2; e.def = (e.def || 0) + 1;
  e.expToNext = expForLevel(e.level);
  state.events.push("[mock] " + e.name + " 升级了！Lv." + e.level + "（HP+10 MP+5 ATK+2 DEF+1）");
}

function makeEntity(role: RoleOption, side: "player" | "ally" | "enemy", x: number, y: number): Entity {
  // ★ 等级：优先 test_state.json 的 initial_level，其次旧字段 level，最后 1
  const lv = role.initial_level ?? role.level ?? 1;
  const s = lvScale(lv);
  const maxHp = Math.floor(100 * s);
  const maxMp = Math.floor(30 + lv * 5); // 每级 +5 MP
  return {
    id: role.id,
    name: role.name,
    side,
    x, y,
    vx: 0, vy: 0,
    hp: maxHp, maxHp,
    mp: maxMp, maxMp,
    exp: 0,
    expToNext: expForLevel(lv),
    level: lv,
    atk: Math.floor(12 + (lv - 1) * 2),
    def: Math.floor(5 + (lv - 1) * 1),
    avatarPath: role.avatarPath,
    facing: 180,
    cooldown: 0,
    alive: true,
  };
}

function makeEnemy(name: string, x: number, y: number, baseHp: number, atk: number, lv: number): Entity {
  return {
    id: "m" + mobIdSeq++,
    name,
    side: "enemy",
    x, y,
    vx: 0, vy: 0,
    hp: baseHp, maxHp: baseHp,
    mp: 0, maxMp: 0,
    exp: Math.floor(baseHp * 0.5),
    expToNext: 0,
    level: lv,
    atk,
    def: Math.floor(atk * 0.3),
    facing: 180,
    cooldown: 0,
    alive: true,
  };
}

// ★ 当前生效的野怪档案表（test_state.json monsters → 全局白名单）
let activeMonsters: MonsterArchetype[] = DEFAULT_MONSTERS;

function spawnWave(): void {
  // ★ 优先 entity_types.json（按当前关卡 theme 权重）→ test_state.json monsters → 默认兜底
  const theme = currentTheme();
  const monster =
    pickMonsterByWeight(theme, activeEntityTypes)
    || activeMonsters[Math.floor(Math.random() * activeMonsters.length)]
    || DEFAULT_MONSTERS[Math.floor(Math.random() * DEFAULT_MONSTERS.length)];
  if (!monster) return;
  // 主题从 entity_types 来时 monster 是 RS 格式（hp/maxhp/str/def）；其他来源是 MonsterArchetype 格式
  const lv = Math.max(1, monster.recommendLevel || (theme === "ICE" ? 16 : theme === "MINE" ? 11 : theme === "CATACOMBS" ? 6 : 1));
  // 数量：从 2 开始、随时间缓慢增加（每 1200 tick +1，最大 5）
  const count = Math.min(5, 2 + Math.floor(state.tick / 1200));
  const me = state.entities.find((x) => x.side === "player");
  const cx = me?.x ?? 0;
  const cy = me?.y ?? 0;
  const half = allowedMapHalf();
  // ★ 城镇/null theme → 不刷怪（mulberryTown 等安全区）
  if (!theme) return;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    // spawn 距离 50-100 米（追踪视野 4m 之外，玩家不靠近不会触发）
    const dist = 50 + Math.random() * 50;
    const spot = pushOutOfSafeZones(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist);
    const x = Math.max(-half.lx, Math.min(half.lx, spot.x));
    const y = Math.max(-half.ly, Math.min(half.ly, spot.y));
    // 来源判定：RS 格式（hp/maxhp 字段）走 entity_types 路径，否则走 MonsterArchetype 路径
    if (typeof monster.hp === "number" || typeof monster.maxhp === "number") {
      state.entities.push(makeEnemyFromEntityType(monster, x, y, lv));
    } else {
      const stats = mobStatsForLevel(lv);
      state.entities.push(makeEnemyWithArch(monster, x, y, lv, stats));
    }
  }
  const tag = theme ? "[" + theme + "] " : "";
  state.events.push("[mock] 第 " + (Math.floor(state.tick / WAVE_INTERVAL) + 1) + " 波 " + tag + monster.name + " (Lv." + lv + ") x" + count);
}

/** 用完整 monster 档案生成 enemy（含 avatarPath/dropItems/isRanged 等元数据） */
function makeEnemyWithArch(m: MonsterArchetype, x: number, y: number, lv: number, stats: { hp: number; atk: number; def: number }): Entity {
  return {
    id: "m" + mobIdSeq++,
    name: m.name,
    side: "enemy",
    x, y,
    vx: 0, vy: 0,
    hp: stats.hp, maxHp: stats.hp,
    mp: 0, maxMp: 0,
    exp: Math.floor(stats.hp * 0.5), expToNext: 0,
    level: lv,
    atk: stats.atk,
    def: stats.def,
    facing: 180,
    cooldown: 0,
    alive: true,
    avatarPath: m.avatarPath,
    isRanged: m.isRanged === true,
  } as any;
}

/* ============================================================
   战斗特效（VFX）辅助
   ============================================================ */

/** 添加一个 VFX（屏幕像素空间，调用方已转换坐标） */
function pushVfx(p: import("./types").VfxParticle): void {
  if (!state.vfx) state.vfx = [];
  state.vfx.push(p);
  // ★ 防止累积超过 60 条（最长寿命 3 秒 × 2-3 个 VFX/帧 ≈ 100-200 帧上限）
  if (state.vfx.length > 60) state.vfx = state.vfx.slice(-60);
}

/** 让实体"小跳一下"（释放技能/使用物品时） */
function bobEntity(e: Entity): void {
  e.actionBobMs = 300;
}

/** 让实体"挨打闪红"（受到伤害时） */
function flashEntity(e: Entity, ms = 250): void {
  e.hitFlashMs = ms;
}

/** 在两个实体之间生成 VFX（弹体类用 fireball） */
function pushAttackVfx(from: Entity, to: Entity, ranged: boolean): void {
  if (ranged) {
    pushVfx({
      id: "vfb" + state.tick + "_" + Math.random().toString(36).slice(2, 6),
      kind: "fireball",
      x: from.x, y: from.y,
      targetX: to.x, targetY: to.y,
      life: 12, total: 12,
      color: "#ff8c3a",
    });
  } else {
    // 近战：在目标位置生成弧形斩波
    pushVfx({
      id: "vfb" + state.tick + "_" + Math.random().toString(36).slice(2, 6),
      kind: "slash_arc",
      x: to.x, y: to.y,
      life: 10, total: 10,
      color: "#ffffff",
    });
  }
}

/** 治疗 / 补蓝 / buff 环（自身位置） */
function pushRingVfx(e: Entity, kind: "heal_ring" | "buff_ring", color: string): void {
  pushVfx({
    id: "vring" + state.tick + "_" + Math.random().toString(36).slice(2, 6),
    kind,
    x: e.x, y: e.y,
    life: 18, total: 18,
    color,
  });
}

/** 范围爆炸（炸药） */
function pushExplosion(x: number, y: number): void {
  pushVfx({
    id: "vexp" + state.tick + "_" + Math.random().toString(36).slice(2, 6),
    kind: "explosion",
    x, y,
    life: 14, total: 14,
    color: "#ff8c3a",
  });
}

/** tick 内每帧推进 VFX 寿命 */
function tickVfx(): void {
  if (!state.vfx || state.vfx.length === 0) return;
  for (const p of state.vfx) p.life--;
  state.vfx = state.vfx.filter((p) => p.life > 0);
}

function buildInitialState(roles: RoleOption[], materials: MaterialItem[] = [], mapPlayerSpawn?: { x: number; y: number }): GameState {
  const playerRole = roles.find((r) => r.roleType === "player") || roles[0];
  const entities: Entity[] = [];
  const sp = mapPlayerSpawn ?? { x: 0, y: 0 };
  entities.push(makeEntity(playerRole, "player", sp.x, sp.y));
  if (roles.length > 1) entities.push(makeEntity(roles[1], "ally", sp.x - 12, sp.y + 12));

  // ★ 物品栏：test_state.json 的 materials[] 全部装入（resource/tool 也显示，
  //   effectType=heal_hp/heal_mp/attack/buff 才有实际效果；其他只显示信息）
  const itemSlots: ItemSlot[] = materials.length > 0
    ? materialsToItems(materials)
    : [
        // 兜底（test_state.json 缺失时）
        { name: "血瓶", count: 3, heal: 30, mp: 0, type: "hp" as const },
        { name: "蓝瓶", count: 2, heal: 0, mp: 20, type: "mp" as const },
        { name: "炸药", count: 1, heal: 0, mp: 0, type: "atk" as const },
        { name: "力量+4", count: 1, heal: 0, mp: 0, type: "utility" as const },
      ];

  return {
    phase: "select",
    version: 3,
    tick: 0,
    world: { w: 3000, h: 3000 },
    spawn: { x: 0, y: 0 },
    scale: {
      meter: 1,
      block_size: 0.5,
      chunk_size_blocks: 32,
      chunk_size_meters: 16,
      ground_size: 3000,
      ground_height: 100,
      x_range: [-1500, 1500],
      z_range: [-1500, 1500],
    },
    roles,
    selections: { participants: playerRole ? [playerRole.id] : [], spectators: [], enemies: [] },
    entities,
    chests: [
      { id: "ch1", x:  100, y:  150, opened: false },
      { id: "ch2", x: -200, y:  100, opened: false },
    ],
    potions: [
      { id: "p1", x:   70, y: -120, heal: 30 },
      { id: "p2", x: -150, y:   50, heal: 30 },
      { id: "p3", x:  300, y: -300, heal: 30 },
    ],
    floaters: [],
    vfx: [],
    skills: [
      { name: "冲斩", power: 18, cost: 10, cd: 30, cdLeft: 0, type: "atk" as const, range: "melee" as const },
      { name: "火球", power: 25, cost: 20, cd: 60, cdLeft: 0, type: "atk" as const, range: "ranged" as const },
      { name: "治疗", power: -40, cost: 25, cd: 90, cdLeft: 0, type: "heal" as const, range: "melee" as const },
      { name: "护盾", power: 0, cost: 15, cd: 120, cdLeft: 0, type: "buff" as const, range: "melee" as const },
    ],
    items: itemSlots,
    // ★ 对齐真实宿主：mock 也下发 playerCard（背包面板 sysBagItems 以参数卡 items 为数据源）
    playerCard: {
      name: roles[0]?.name || "玩家",
      money: 128,
      items: itemSlots.map((it) => (it.count > 1 ? `${it.name}×${it.count}` : it.name)),
    },
    // ★ 对齐真实宿主 refreshShop：mock 无 tsApi.agent → builtin 兜底货源
    shopSource: "builtin",
    shopGoods: [
      { id: "b_huiqi", name: "回气散", price: 30, kind: "consumable", rarity: "common", heal: 30, desc: "恢复 30 点生命", from: "builtin" },
      { id: "b_jijiu", name: "急救包", price: 60, kind: "consumable", rarity: "fine", heal: 60, desc: "恢复 60 点生命", from: "builtin" },
      { id: "b_ganliang", name: "干粮", price: 12, kind: "consumable", rarity: "common", heal: 14, desc: "恢复 14 点生命", from: "builtin" },
      { id: "b_zhixuecao", name: "止血草", price: 20, kind: "material", rarity: "common", heal: 0, desc: "常见草药，可入药", from: "builtin" },
      { id: "b_yinguang", name: "萤光石", price: 45, kind: "material", rarity: "fine", heal: 0, desc: "泛着微光的矿石", from: "builtin" },
      { id: "b_duanjian", name: "精钢短剑", price: 220, kind: "equipment", rarity: "rare", heal: 0, desc: "攻击 +6", from: "builtin" },
      { id: "b_hufu", name: "皮甲护符", price: 160, kind: "equipment", rarity: "fine", heal: 0, desc: "防御 +4", from: "builtin" },
      { id: "b_xinde", name: "基础技能心得", price: 320, kind: "skill_book", rarity: "rare", heal: 0, desc: "习得一项基础技能", from: "builtin" },
    ],
    skillPage: 0,
    itemPage: 0,
    map: null,
    mapSource: "fallback",
    exp: 0,
    money: 0,
    drops: [],
    kills: 0,
    events: ["[mock] 本地模拟模式已启动（未检测到宿主）"],
    result: null,
  };
}

/** 暴露给 App.vue 的 monsters 档案表（供 switchLevel 用） */
const MONSTER_ARCHETYPES: Record<string, MonsterArchetype> = (window as any).__monsterArchetypes || {};

function push(): void {
  // ★ 同 window postMessage 不会触发自己的 message 事件 —— 用 dispatchEvent 兜底
  const payload = { type: "tf_plugin_state", state: JSON.parse(JSON.stringify(state)) };
  window.postMessage(payload, "*");
  window.dispatchEvent(new MessageEvent("message", { data: payload }));
}

/* ============================================================
   监听 iframe 的请求
   ============================================================ */
function install(): void {
  // 监听 tick 动作
  window.addEventListener("message", (e: MessageEvent) => {
    const d: any = e?.data;
    if (!d || typeof d !== "object") return;

    if (d.type === "tf_plugin_loaded") {
      // 插件说"我加载好了"，立即推一次初始状态
      push();
      return;
    }

    if (d.type === "tf_plugin_tick" && state.phase === "playing") {
      const { action, params } = d;
      if (action === "start") {
        // 已经在 playing，忽略
        return;
      }
      if (action === "tick") {
        state.tick++;
        // ★ 修复（mock 根因②）：把 App 加载出来的地图怪物并入 mock 的 state，
        //   否则下一次 push() 整份覆盖会把它们当场抹掉（森林野怪"闪一下就消失"）。
        syncAppEntities();
        const params2 = params || {};
        // ★ 敌人碰撞：前端只在切图那一次带上网格，这里按 epoch 幂等应用
        applyWalkGridPacket(params2.walkGrid);
        const me = state.entities.find((x) => x.side === "player");
        // ★ 修复：玩家位姿由 game.html 本地 tick 权威推进并随 tick 上报（params.player），
        //   mock 宿主只镜像、不再按 input.dx/dy 重复积分（原先 +3 米/帧 与前端 0.3 米/帧 双写，
        //   造成"走一小步就停 / 松手瞬移"）。
        if (me && me.alive) {
          const pose = params2.player;
          if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.y)) {
            me.x = Math.max(-1490, Math.min(1490, pose.x));
            me.y = Math.max(-1490, Math.min(1490, pose.y));
            if (Number.isFinite(pose.facing)) me.facing = pose.facing;
          }
          me.vx = 0;
          me.vy = 0;
          // MP 自然回复：每 10 tick +3（Rotten-Soup: manaRecovery=2.5/10tick）
          if (state.tick % 10 === 0) me.mp = Math.min(me.maxMp, me.mp + 3);
          // HP 自然回复：每 30 tick +1
          if (state.tick % 30 === 0) me.hp = Math.min(me.maxHp, me.hp + 1);
        }

        // 全技能 CD 冷却（每 tick -1）
        for (const s of state.skills) { if (s.cdLeft > 0) s.cdLeft--; }

        // ★ 敌人"解困"：刷点（makeEntity / mapmob / zone_）与安全区推出都可能把怪
        //   放进墙里 → 每 tick 做一次廉价纠正。已经在合法位置的怪是 no-op。
        if (walkGrid) {
          for (const e of state.entities) {
            if (e.side !== "enemy" || !e.alive) continue;
            const sp = snapEnemySpawn(walkGrid, e.x, e.y, ENEMY_COLLIDE_R);
            if (sp) { e.x = sp.x; e.y = sp.z; }
          }
        }

        // 敌人 AI：朝玩家移动 + 攻击（米单位）
        const target = me;
        // ★ 安全区判定：玩家在 safe zone 内时，野怪不能进入/追击
        //   来源：App 按"当前关卡"发布（window.__mapSafeZones，森林关卡为空数组）；
        //   未发布时退回静态城镇兜底。此前恒用城镇 safe 区 → 森林里也被判为安全区。
        const safeZones = allowedSafeZones();
        const playerInSafe = !!target && safeZones.some((z: any) => {
          if (z.rx !== undefined && z.ry !== undefined) {
            return Math.abs(z.x - target.x) <= z.rx && Math.abs(z.y - target.y) <= z.ry;
          }
          return Math.hypot(z.x - target.x, z.y - target.y) <= (z.r ?? 0);
        });
        state.entities.forEach((e) => {
          if (e.side !== "enemy" || !e.alive) return;
          if (!target || !target.alive) return;
          const dx = target.x - e.x;
          const dy = target.y - e.y;
          const d2 = Math.hypot(dx, dy);
          // ★ 玩家在安全区 → 野怪停止追击并撤退到安全区外
          if (playerInSafe) {
            // 计算该野怪自身是否在某个安全区内，若是 → 立即推出
            const meInSafe = safeZones.some((z: any) => {
              if (z.rx !== undefined && z.ry !== undefined) {
                return Math.abs(z.x - e.x) <= z.rx && Math.abs(z.y - e.y) <= z.ry;
              }
              return Math.hypot(z.x - e.x, z.y - e.y) <= (z.r ?? 0);
            });
            if (meInSafe) {
              // ★ 统一安全区推出（矩形区按边长推、圆形区按半径推）：
              //   此前只按圆形半径 z.r ?? 30 处理，矩形城镇区会把野怪推到错误位置
              const out = pushOutOfSafeZones(e.x, e.y);
              e.x = out.x;
              e.y = out.y;
            }
            return; // 不追、不攻
          }
          // ★ 看见玩家 4 米；近战 0.5 米内攻击；远程 4 米内攻击
          const isRanged = (e as any).isRanged === true;
          if (d2 < 4) {
            if (isRanged) {
              // ★ 远程怪保持在 3-4 米的安全距离（不贴身，但保留锁定姿态）
              const desiredDist = 3.5;
              if (d2 > 4) {
                // 太远：逼近
                const sp = 2.0 * 0.1;
                moveEnemyBy(e, (dx / (d2 || 1)) * sp, (dy / (d2 || 1)) * sp);
              } else if (d2 < 2.5) {
                // 太近：后退（保持距离）
                const sp = 1.5 * 0.1;
                moveEnemyBy(e, -(dx / (d2 || 1)) * sp, -(dy / (d2 || 1)) * sp);
              }
              e.facing = dx > 0 ? 0 : 180;
            } else {
              // 近战：冲过去
              const sp = 2.0 * 0.1;  // 2.0 米/秒 × 0.1 秒/帧 = 0.2 米/帧（步行追赶，与 entry 对齐）
              moveEnemyBy(e, (dx / (d2 || 1)) * sp, (dy / (d2 || 1)) * sp);
              e.facing = dx > 0 ? 0 : 180;   // 角度制：0=右 180=左
            }
          }
          e.cooldown--;
          // ★ 攻击判定：近战 0.5 米，远程 4 米
          const attackRange = isRanged ? 4 : 0.5;
          if (d2 < attackRange && e.cooldown <= 0) {
            // ★ 护盾 buff 减免：有护盾时 def 更高
            const damage = Math.max(1, e.atk - (target.def || 0));
            target.hp = Math.max(0, target.hp - damage);
            // ★ VFX：远程怪打玩家 → 火球飞向玩家；近战怪打玩家 → 玩家位置斩波
            pushAttackVfx(e, target, isRanged);
            flashEntity(target);
            state.floaters.push({ id: "f" + state.tick, text: "-" + damage, x: target.x, y: target.y - 10, life: 12, kind: "damage", color: "#ff5a5a" });
            e.cooldown = 40;
            if (target.hp <= 0) {
              target.alive = false;
              state.events.push("[mock] 玩家被 " + e.name + " 击倒");
              state.phase = "over";
              state.result = { reason: "death", exp: state.exp, money: state.money, drops: state.drops, kills: state.kills, survivedTicks: state.tick };
            }
          }
        });
        // 玩家自动攻击最近的敌人（每 30 tick，30 米内）
        if (me && me.alive && state.tick % 30 === 0) {
          let closest: Entity | null = null;
          let minD = Infinity;
          state.entities.forEach((e) => {
            if (e.side !== "enemy" || !e.alive) return;
            const dd = Math.hypot(e.x - me.x, e.y - me.y);
            // ★ 近战 0.5 米范围；远程怪（isRanged）按 4 米
            const reach = (e as any).isRanged === true ? 4 : 0.5;
            if (dd < reach && dd < minD) { minD = dd; closest = e; }
          });
          if (closest) {
            const dmg = Math.max(1, me.atk - (closest.def || 0));
            closest.hp = Math.max(0, closest.hp - dmg);
            // ★ VFX：玩家打敌人 → 斩波在敌人位置 + 敌人闪红
            pushAttackVfx(me, closest, false);
            flashEntity(closest);
            bobEntity(me);
            state.floaters.push({ id: "f" + state.tick, text: "-" + dmg, x: closest.x, y: closest.y - 10, life: 12, kind: "damage", color: "#ff5a5a" });
            state.events.push("[mock] 攻击 " + closest.name + " (-" + dmg + "HP)");
            if (closest.hp <= 0) {
              closest.alive = false;
              state.kills++;
              state.money += 3;
              me.exp += closest.level * 5;
              if (me.exp >= me.expToNext) levelUpEntity(me);
              state.events.push("[mock] 击杀 " + closest.name + " (+" + (closest.level * 5) + "exp +3money)");
            }
          }
        }
        // 浮动文字生命衰减
        state.floaters = state.floaters.filter((f) => { f.life--; return f.life > 0; });
        // VFX 粒子衰减
        tickVfx();
        // ★ 实体 hitFlashMs / actionBobMs 按 ms 衰减（tick 约 100ms）
        state.entities.forEach((e) => {
          if (e.hitFlashMs && e.hitFlashMs > 0) e.hitFlashMs = Math.max(0, e.hitFlashMs - 100);
          if (e.actionBobMs && e.actionBobMs > 0) e.actionBobMs = Math.max(0, e.actionBobMs - 100);
        });
        // 波次生成
        waveTimer++;
        if (waveTimer >= WAVE_INTERVAL) {
          waveTimer = 0;
          spawnWave();
        }
        // 推回前端
        push();
        return;
      }
      if (action === "skill") {
        const idx = params?.index;
        const slot = state.skills[idx];
        const me = state.entities.find((x) => x.side === "player");
        if (!slot || !me || !me.alive) { push(); return; }
        if (slot.cdLeft > 0) {
          state.events.push("[mock] " + slot.name + " 冷却中（剩余 " + Math.ceil(slot.cdLeft / 10) + " 秒）");
          push(); return;
        }
        if (me.mp < slot.cost) {
          state.events.push("[mock] MP 不足！" + slot.name + " 需要 " + slot.cost + "，当前 " + Math.floor(me.mp));
          push(); return;
        }

        me.mp -= slot.cost;
        slot.cdLeft = slot.cd;

        if (slot.type === "heal") {
          // 治疗：恢复 HP（power 负数表示回血量）
          const healAmt = Math.abs(slot.power);
          const actual = Math.min(healAmt, me.maxHp - me.hp);
          me.hp = Math.min(me.maxHp, me.hp + actual);
          pushRingVfx(me, "heal_ring", "#5fe57a");
          bobEntity(me);
          state.floaters.push({ id: "f" + state.tick, text: "+" + actual + "HP", x: me.x, y: me.y - 10, life: 20, kind: "heal_hp", color: "#5fe57a" });
          state.events.push("[mock] " + slot.name + "，恢复 " + actual + "HP");
        } else if (slot.type === "atk") {
          // 攻击技能：找最近的敌人，50 米内
          let target: Entity | null = null;
          let minD = Infinity;
          state.entities.forEach((e) => {
            if (e.side !== "enemy" || !e.alive) return;
            const dd = Math.hypot(e.x - me.x, e.y - me.y);
            if (dd < 50 && dd < minD) { minD = dd; target = e; }
          });
          if (target) {
            const dmg = Math.max(1, slot.power - (target.def || 0));
            target.hp = Math.max(0, target.hp - dmg);
            // ★ VFX：按技能的 range 选 fireball（远程）或 slash_arc（近战）
            pushAttackVfx(me, target, slot.range === "ranged");
            flashEntity(target);
            bobEntity(me);
            state.floaters.push({ id: "f" + state.tick, text: "-" + dmg, x: target.x, y: target.y - 10, life: 20, kind: "damage", color: "#ff5a5a" });
            state.events.push("[mock] " + slot.name + " 对 " + target.name + " 造成 " + dmg + " 伤害");
            if (target.hp <= 0) {
              target.alive = false;
              state.kills++;
              state.money += 3;
              me.exp += target.level * 5;
              if (me.exp >= me.expToNext) levelUpEntity(me);
            }
          } else {
            state.events.push("[mock] " + slot.name + "，但周围没有敌人");
          }
        } else if (slot.type === "buff") {
          // 护盾：临时加 def（持续 60 tick ≈ 6 秒）
          me.def = (me.def || 0) + 10;
          setTimeout(() => { if (me) me.def = Math.max(0, (me.def || 0) - 10); }, 6000);
          pushRingVfx(me, "buff_ring", "#f5c542");
          bobEntity(me);
          state.floaters.push({ id: "f" + state.tick, text: "+DEF", x: me.x, y: me.y - 10, life: 20, kind: "buff", color: "#f5c542" });
          state.events.push("[mock] " + slot.name + "，DEF+10（持续 6 秒）");
        }
        push();
        return;
      }
      if (action === "item") {
        const idx = params?.index;
        const slot = state.items[idx];
        const me = state.entities.find((x) => x.side === "player");
        if (!slot || !me || !me.alive) { push(); return; }
        if (slot.count <= 0) { push(); return; }
        // ★ 武器类（matType=weapon）/ 非消耗类（type=utility）点击不消耗、不执行
        //   仅作为展示；防具/光源/工具也只是 equip-only，目前全部不消耗
        const isWeapon = (slot as any).matType === "weapon";
        const isArmor = (slot as any).matType === "armor";
        const isLight = (slot as any).matType === "light";
        const isTool = (slot as any).matType === "tool";
        const isResource = (slot as any).matType === "resource";
        if (isWeapon || isArmor || isLight || isTool || isResource || slot.type === "utility") {
          state.events.push("[mock] " + slot.name + " 是装备/材料，点击不消耗（仅展示）");
          push();
          return;
        }
        slot.count--;
        if (slot.type === "hp") {
          const actual = Math.min(slot.heal, me.maxHp - me.hp);
          me.hp = Math.min(me.maxHp, me.hp + actual);
          pushRingVfx(me, "heal_ring", "#5fe57a");
          bobEntity(me);
          state.floaters.push({ id: "f" + state.tick, text: "+" + actual + "HP", x: me.x, y: me.y - 10, life: 20, kind: "heal_hp", color: "#5fe57a" });
          state.events.push("[mock] " + slot.name + "，恢复 " + actual + "HP");
        } else if (slot.type === "mp") {
          const actual = Math.min(slot.mp, me.maxMp - me.mp);
          me.mp = Math.min(me.maxMp, me.mp + actual);
          pushRingVfx(me, "heal_ring", "#5eb5ff");
          bobEntity(me);
          state.floaters.push({ id: "f" + state.tick, text: "+" + actual + "MP", x: me.x, y: me.y - 10, life: 20, kind: "heal_mp", color: "#5eb5ff" });
          state.events.push("[mock] " + slot.name + "，恢复 " + actual + "MP");
        } else if (slot.type === "atk") {
          // 炸药：5 米内所有敌人受到范围伤害
          pushExplosion(me.x, me.y);
          bobEntity(me);
          let hit = 0;
          state.entities.forEach((e) => {
            if (e.side !== "enemy" || !e.alive) return;
            const dd = Math.hypot(e.x - me.x, e.y - me.y);
            if (dd < 5) {
              const dmg = Math.max(1, 40 - (e.def || 0));
              e.hp = Math.max(0, e.hp - dmg);
              flashEntity(e);
              state.floaters.push({ id: "f" + state.tick + e.id, text: "-" + dmg, x: e.x, y: e.y - 10, life: 20, kind: "damage", color: "#ff8c3a" });
              if (e.hp <= 0) {
                e.alive = false;
                state.kills++;
                me.exp += e.level * 5;
                if (me.exp >= me.expToNext) levelUpEntity(me);
              }
              hit++;
            }
          });
          state.events.push("[mock] " + slot.name + "，炸到 " + hit + " 个敌人");
        }
        push();
        return;
      }
      if (action === "page") {
        const k = params?.kind;
        const d2 = params?.delta || 0;
        if (k === "skill") {
          const total = Math.ceil(state.skills.length / 4);
          state.skillPage = ((state.skillPage + d2) % total + total) % total;
        } else if (k === "item") {
          const total = Math.ceil(state.items.length / 4);
          state.itemPage = ((state.itemPage + d2) % total + total) % total;
        }
        push();
        return;
      }
      if (action === "sys") {
        // ★ 对齐 entry.js case "sys"：记录关卡列表 → 大地图节点（地图面板缩小视图）
        const levels = Array.isArray(params?.levels) ? params.levels.map(String).filter(Boolean) : [];
        if (levels.length) {
          state.mapNodes = levels.map((n: string, i: number) => ({ name: n, x: 160 + (i % 4) * 260, y: 140 + Math.floor(i / 4) * 200 }));
        }
        if (params?.levelName) state.levelName = String(params.levelName);
        push();
        return;
      }
      if (action === "sys_skill_edit") {
        // ★ 对齐 entry.js case "sys_skill_edit"：修改技能参数（mock 下直接改 state.skills）
        const idx = Math.max(0, Math.round(Number(params?.index) || 0));
        const sk = state.skills[idx];
        if (sk) {
          if (params?.name) sk.name = String(params.name).slice(0, 12);
          if (Number.isFinite(Number(params?.power))) sk.power = Math.max(0, Math.round(Number(params.power)));
          if (Number.isFinite(Number(params?.cost))) sk.cost = Math.max(0, Math.round(Number(params.cost)));
          if (Number.isFinite(Number(params?.cd)) && Number(params.cd) >= 1) sk.cd = Math.round(Number(params.cd));
          if (["atk", "heal", "buff"].includes(params?.type)) sk.type = params.type;
          if (params?.range === "ranged" || params?.range === "melee") sk.range = params.range;
          if (Number.isFinite(Number(params?.lv))) (sk as any).lv = Math.max(1, Math.round(Number(params.lv)));
          (sk as any).buff_type = typeof params?.buff_type === "string" ? params.buff_type : "";
          state.events.push(`[mock] 技能「${sk.name}」参数已修改并保存`);
        }
        push();
        return;
      }
      // ★ mock 镜像 entry.js patchCard：数量/描述写回参数卡（UI sysBagItems 以 playerCard.items 为数据源）
      const rewriteCardItem = (nm: string, cnt: number, dsc: string) => {
        const pc = (state as any).playerCard || ((state as any).playerCard = {});
        const arr: string[] = Array.isArray(pc.items) ? pc.items : (pc.items = []);
        const clean = (v: string) => String(v || "").replace(/[（(][^）)]*[）)]/g, " ").replace(/[×xX*]\s*\d+/g, " ").trim().toLowerCase();
        const kept = arr.filter((x) => clean(x) !== clean(nm));
        if (cnt > 0) kept.push(`${nm}${cnt > 1 ? `×${cnt}` : ""}${dsc ? `（${dsc}）` : ""}`);
        pc.items = kept;
      };
      if (action === "sys_use_item") {
        // ★ 对齐 entry.js useBagItem：扣耐久（durability>0），耗尽损毁 1 个
        const name = String(params?.name || "");
        const it = (state.items || []).find((x: any) => x.name === name);
        const im = (state as any).itemMeta || {};
        const meta = im[name] || {};
        const dur = Math.round(Number(meta.durability ?? -1));
        if (it && Number(it.count) > 0 && dur !== 0) {
          if (dur > 0) {
            const left = Math.round(Number(meta.durabilityLeft ?? dur)) - 1;
            if (left <= 0) {
              it.count -= 1;
              im[name] = { ...meta, durabilityLeft: dur };
              state.events.push(`[mock] ${name} 耐久耗尽，损毁 1 个`);
            } else {
              im[name] = { ...meta, durabilityLeft: left };
              state.events.push(`[mock] 使用 ${name}（耐久 ${left}/${dur}）`);
            }
          } else {
            it.count -= 1;
            state.events.push(`[mock] 使用 ${name}（剩余 ${it.count}）`);
          }
          (state as any).itemMeta = im;
          rewriteCardItem(name, Math.max(0, Number(it.count) || 0), String((it as any).desc || ""));
        } else {
          state.events.push(`[mock] 「${name}」不在背包中`);
        }
        push();
        return;
      }
      if (action === "sys_item_edit") {
        // ★ 对齐 entry.js case "sys_item_edit"：修改物品参数（mock 下直接改 state.items + itemMeta）
        const idx = Math.max(0, Math.round(Number(params?.index) || 0));
        (state as any).itemMeta = (state as any).itemMeta || {};
        const it = state.items?.[idx];
        if (it) {
          if (params?.name) it.name = String(params.name).slice(0, 20);
          if (Number.isFinite(Number(params?.power))) (it as any).power = Math.max(0, Math.round(Number(params.power)));
          if (Number.isFinite(Number(params?.cost))) (it as any).cost = Math.max(0, Math.round(Number(params.cost)));
          if (Number.isFinite(Number(params?.cd))) (it as any).cd = Math.max(0, Math.round(Number(params.cd)));
          if (["atk", "heal", "buff", "attribute"].includes(params?.type)) (it as any).type = params.type;
          if (params?.range === "ranged" || params?.range === "melee") (it as any).range = params.range;
          if (Number.isFinite(Number(params?.lv))) (it as any).lv = Math.max(1, Math.round(Number(params.lv)));
          (it as any).buff_type = typeof params?.buff_type === "string" ? params.buff_type : "";
          if (Number.isFinite(Number(params?.durability))) {
            (it as any).durability = Math.max(-1, Math.round(Number(params.durability)));
            (it as any).durabilityLeft = (it as any).durability;
          }
          (it as any).attribute_type = typeof params?.attribute_type === "string" ? params.attribute_type : "";
          if (Number.isFinite(Number(params?.attribute_value))) (it as any).attribute_value = Math.round(Number(params.attribute_value));
          // ★ game.md quantity/description：mock 同步镜像
          const qty = Number.isFinite(Number(params?.quantity)) ? Math.max(1, Math.round(Number(params.quantity))) : Math.max(1, Number(it.count) || 1);
          const descFinal = typeof params?.description === "string" && params.description.trim() ? params.description.trim() : String((it as any).desc || "");
          it.count = qty;
          (it as any).quantity = qty;
          if (descFinal) (it as any).desc = descFinal;
          (state as any).itemMeta[it.name] = {
            power: (it as any).power || 0, cost: (it as any).cost || 0, cd: (it as any).cd || 0,
            type: (it as any).type || "heal", range: (it as any).range || "melee",
            lv: (it as any).lv || 1, buff_type: (it as any).buff_type || "",
            durability: (it as any).durability ?? -1, durabilityLeft: (it as any).durability ?? -1,
            attribute_type: (it as any).attribute_type || "", attribute_value: (it as any).attribute_value || 0,
            quantity: qty, description: descFinal,
          };
          rewriteCardItem(it.name, qty, descFinal);
          state.events.push(`[mock] 物品「${it.name}」参数已修改并保存`);
        }
        push();
        return;
      }
      if (action === "sys_shop_refresh") {
        // ★ 对齐 entry.js case "sys_shop_refresh"：mock 无 agent，保持 builtin 货源
        (state as any).shopSource = "builtin";
        state.events.push(`[mock] 商城已刷新（${((state as any).shopGoods || []).length} 件商品）`);
        push();
        return;
      }
      if (action === "sys_shop_buy") {
        // ★ 对齐 entry.js case "sys_shop_buy"：扣 money（playerCard）+ 入背包（ItemSlot + 参数卡条目）
        const good = ((state as any).shopGoods || []).find((g: any) => g.id === params?.id);
        if (!good) {
          state.events.push("[mock] 商品不存在");
          push();
          return;
        }
        const ask = Math.max(1, Math.round(Number(params?.count) || 1));
        const pc = (state as any).playerCard || ((state as any).playerCard = {});
        const money = Math.round(Number(pc.money) || 0);
        const cost = Math.round(Number(good.price) || 0) * ask;
        if (money < cost) {
          state.events.push(`[mock] 金钱不足：需要 ${cost}，现有 ${money}`);
          push();
          return;
        }
        pc.money = money - cost;
        const slot = (state.items || []).find((x: any) => x.name === good.name);
        if (slot) slot.count += ask;
        else (state.items || []).push({ name: good.name, count: ask, heal: good.heal || 0, mp: 0, type: good.kind === "equipment" ? "atk" : "hp" });
        const arr: string[] = Array.isArray(pc.items) ? pc.items : (pc.items = []);
        const clean = (v: string) => String(v || "").replace(/[（(][^）)]*[）)]/g, " ").replace(/[×xX*]\s*\d+/g, " ").trim().toLowerCase();
        const old = arr.findIndex((x) => clean(x) === clean(good.name));
        let base = ask;
        if (old >= 0) {
          const m = arr[old].match(/[×xX*]\s*(\d+)/);
          base = (m ? Number(m[1]) : 1) + ask;
          arr.splice(old, 1);
        }
        arr.push(base > 1 ? `${good.name}×${base}` : good.name);
        state.events.push(`[mock] 购买 ${good.name}×${ask}，花费 ${cost} 金钱`);
        push();
        return;
      }
      if (action === "sys_travel") {
        // ★ 对齐 entry.js case "sys_travel"：走 teleportTarget 一次性通道（前端 watch 消费）
        const target = String(params?.mapName || "");
        if (!target) return;
        state.levelName = target;
        state.sysRevision = Math.round(Number(state.sysRevision) || 0) + 1;
        (state as any).teleportTarget = { mapName: target, x: 0, y: 0, name: target, rev: state.sysRevision };
        state.events.push(`[mock] 传送至「${target}」`);
        push();
        return;
      }
      if (action === "exit") {
        state.phase = "over";
        state.result = { reason: "exit", exp: state.exp, money: state.money, drops: state.drops, kills: state.kills, survivedTicks: state.tick };
        state.events.push("[mock] 玩家主动退出");
        push();
        return;
      }
    }

    if (d.type === "tf_plugin_action") {
      const k = d.kind;
      if (k === "done" || k === "abort") {
        state.phase = "over";
        state.result = { reason: "exit", exp: state.exp, money: state.money, drops: state.drops, kills: state.kills, survivedTicks: state.tick };
        state.events.push(`[mock] ${k === "abort" ? "放弃游戏" : "游戏完成"}`);
        push();
      }
      return;
    }

    if (d.type === "tf_plugin_fullscreen") {
      // ★ 关键修复：全屏切换是"宿主面板"的纯 UI 信令，真实宿主只切 CSS，不会回推 state。
      //   此前 mock 在此无条件 push()，而 App 收到 select 状态的 state 后会再调
      //   setFullscreen(false) → 与本次 push 形成消息死循环；又因 push() 同时走
      //   postMessage + dispatchEvent 双通道（App 一次 push 会被触发两次），循环指数放大。
      //   结果：select 状态被每秒上万次重推，App 在此分支清空 participants，
      //   用户点中的角色卡片立即被重置 → 表现为"点击无反应、无法选人"。
      //   此处只记录事件 + 更新可见 hash，不再回推 state。
      if (state.events.length < 200) {
        state.events.push(`[mock] setFullscreen(${!!d.fullscreen})`);
      }
      // 在测试页面上用一个可见标志：写 hash 让开发者看到
      location.hash = d.fullscreen ? "fullscreen" : "";
      return;
    }

    // ★ 死亡弹窗「复活」：原地复活（玩家坐标不变、满血满蓝、over → playing）
    if (d.type === "tf_plugin_tick" && d.action === "revive" && state.phase === "over") {
      const me = state.entities.find((x) => x.side === "player");
      if (me) {
        me.alive = true;
        me.hp = me.maxHp;
        me.mp = me.maxMp;
        me.vx = 0;
        me.vy = 0;
        // 复活保护：场上存活敌人进入 2 秒攻击冷却，避免复活即被秒
        state.entities.forEach((e) => {
          if (e.side === "enemy" && e.alive) e.cooldown = Math.max(e.cooldown || 0, 20);
        });
        state.result = null;
        state.phase = "playing";
        state.events.push("[mock] 你在原地复活");
        push();
      }
      return;
    }

    // ★ over 状态兜底：玩家死亡/退出后再点"开始游戏" → 重置回选人面板
    //   必须先看 phase === "over" 再判断 select，否则初次 start 会被这条截胡。
    if (d.type === "tf_plugin_tick" && d.action === "start" && state.phase === "over") {
      state.phase = "select";
      state.result = null;
      state.entities = [];
      state.events.push("[mock] 重置回选人面板，可重新开始");
      push();
      return;
    }

    // 真正开局：从 select → playing
    if (d.type === "tf_plugin_tick" && d.action === "start" && state.phase === "select") {
      // 应用选择
      const sel = (d.params?.selections) || {};
      state.selections = {
        participants: Array.isArray(sel.participants) ? sel.participants : [],
        spectators: Array.isArray(sel.spectators) ? sel.spectators : [],
        enemies: Array.isArray(sel.enemies) ? sel.enemies : [],
      };
      // 重置实体：只保留友方角色作为玩家/盟友
      state.entities = state.entities.filter((e) => e.side !== "player" && e.side !== "ally");
      // participants 可能是 id(r02) 也可能是 name(裴勇)，两种都尝试匹配
      const partR = state.selections.participants
        .map((id) => state.roles.find((r) => r.id === id) || state.roles.find((r) => r.name === id))
        .filter(Boolean) as RoleOption[];
      partR.forEach((r, i) => {
        // ★ v3：玩家出生 origin (0,0)，盟友环绕（半径 12 米 = ALLY_FOLLOW_GAP_M）
        const isPlayer = i === 0;
        const angle = (i / Math.max(1, partR.length)) * Math.PI * 2;
        state.entities.push(makeEntity(
          r, isPlayer ? "player" : "ally",
          isPlayer ? 0 : Math.cos(angle) * 12,
          isPlayer ? 0 : Math.sin(angle) * 12,
        ));
      });
      // 敌对角色：作为敌人 NPC 上场（而不是野兽）— 玩家附近 ±80 米环形分布
      // participants 可能是 id(r02) 也可能是 name(裴勇)，两种都尝试匹配
      const enR = state.selections.enemies
        .map((id) => state.roles.find((r) => r.id === id) || state.roles.find((r) => r.name === id))
        .filter(Boolean) as RoleOption[];
      const eCount = enR.length;
      enR.forEach((r, i) => {
        const angle = eCount > 1 ? (i / eCount) * Math.PI * 2 : 0;
        const dist = 50 + (i % 3) * 10;   // 50-70 米
        const e = makeEntity(r, "enemy", Math.cos(angle) * dist, Math.sin(angle) * dist);
        e.hp = 80; e.maxHp = 80; e.atk = 10; e.def = 3;
        state.entities.push(e);
      });
      // 如果没有敌对角色，会在 wave 中生成野兽
      state.phase = "playing";
      state.tick = 0;
      waveTimer = 0;
      state.events.push(`[mock] 战斗开始：友方 ${partR.length}，敌对 ${enR.length || "自动生成"}`);
      push();
      return;
    }
  });
}

export async function startMockHostIfStandalone(): Promise<boolean> {
  // 仅在 game.html 直接以 file:// 打开时启用 mock
  const isStandalone = !location.href.includes("getAsset") && window.parent === window;
  if (!isStandalone) return false;
  // ★ 一次性加载 test_state.json（roles + monsters + materials）
  const { roles, monsters, materials } = await loadTestData();
  activeMonsters = monsters;
  // ★ 加载 entity_types.json（Rotten-Soup 怪物权威数据源，用于按 theme 加权刷怪）
  activeEntityTypes = await loadEntityTypes();
  // ★ v5：尝试读 overworld.json 拿 playerSpawn + safe zones（mulberryTown 等 Tiled 格式地图）
  let mapSpawn: { x: number; y: number } | undefined;
  try {
    const r = await fetch("./maps/overworld.json");
    if (r.ok) {
      const d = await r.json();
      // 找 objectgroup 里 entity_type=PLAYER 的对象
      for (const layer of d.layers ?? []) {
        if (layer.type !== "objectgroup") continue;
        for (const obj of layer.objects ?? []) {
          const props = Object.fromEntries((obj.properties ?? []).map((p: any) => [p.name, p.value]));
          if (props.entity_type === "PLAYER") {
            mapSpawn = {
              x: (obj.x / 32) - (d.width / 2),
              y: (obj.y / 32 - 1) - (d.height / 2),
            };
            break;
          }
        }
        if (mapSpawn) break;
      }
      // ★ 兜底 safe zone（仅在 App 还没发布 window.__mapSafeZones 时生效）。
      //   此前直接把整张 overworld 图当作城镇 safe 区（=整图安全区），既失真又容易被
      //   误用成"整图不刷怪"的依据。这里收敛为城镇中心的小范围安全区；
      //   App 启动/切图后会用真实关卡的 zones 覆盖它。
      mapSafeZones = [{
        name: "城镇",
        x: 0, y: 0,
        rx: Math.min(d.width / 2, 15), ry: Math.min(d.height / 2, 17),
        kind: "safe",
      }];
    }
  } catch { /* ignore */ }
  state = buildInitialState(roles, materials, mapSpawn);
  // ★ 把怪物档案表暴露给 App.vue，供 switchLevel 时按 monsterId 查数值
  (window as any).__monsterArchetypes = monsters.reduce<Record<string, MonsterArchetype>>((acc, m) => {
    acc[m.monsterId] = m;
    return acc;
  }, {});
  // ★ standalone：把初始 state 暴露到 window，App.vue 启动时一次性取走
  //   （postMessage 在同 window 不触发自己的 message 事件）
  (window as any).__initialState = JSON.parse(JSON.stringify(state));
  install();
  // 兜底：插件可能没发 loaded，直接推一次
  setTimeout(() => push(), 100);
  console.info("[mockHost] standalone mode active，roles=", roles.length, "monsters=", monsters.length, "materials=", materials.length, "spawn=", mapSpawn);
  return true;
}