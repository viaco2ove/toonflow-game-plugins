/**
 * entry.js — 野外生存插件主入口（JS 版，与 entry.ts 逻辑一致）
 *
 * 历史：本文件原是 "JS+Unicode 转义" 编译后的镜像。
 * 现在 entry.ts 改为 v3（3000×3000 米世界 / origin 0,0 / 米单位 / scale 配置），
 * 本文件保持与 entry.ts 行为完全一致，作为非 TS 运行时（如纯 JS 宿主）的兜底。
 *
 * 关键差异（相对旧版 v2）：
 *   - WORLD = { w: 3000, h: 3000 } 改为元信息；坐标系：origin (0,0)，X/Z 范围 ±1500
 *   - 玩家出生 = PLAYER_SPAWN = (0, 0)
 *   - speed = 3 米/帧（原 3.2 像素/帧）
 *   - 距离参数全部按米：mob view 80m / mob atk 2m / ally atk 2m / chest 2m / potion 2m / skill 30m
 *   - state.version 改为 3（v4 起为 4）
 *   - 新增 spawn / scale 字段
 *
 * ★ v4（区域刷新 Region Respawn）：
 *   - 世界划分：晨曦镇（安全区，位于原点）+ 6 个野区（环半径 480m，区域半径 240m）
 *   - 刷怪不再由 enemies.length===0 触发，改为「每个区域各自维护刷新计时」：
 *     玩家离开某区域 45 秒后，该区域刷新一次（补满配额）；城镇永不刷新野怪
 *   - 敌人探测半径改为 10 米（原 MOB_VIEW_M=80 从未被敌人分支引用）→ 12 米脱战归位游荡
 *   - 敌人复活 = 区域刷新机制重新生成（死亡实体当帧移除，不再残留 alive=false）
 */

const TERRAIN_BLOCK_SIZE_M = 0.5;
const CHUNK_SIZE_BLOCKS = 32;
const CHUNK_SIZE_M = CHUNK_SIZE_BLOCKS * TERRAIN_BLOCK_SIZE_M; // 16 米
const TERRAIN_GROUND_SIZE_M = 3000;
const TERRAIN_GROUND_HEIGHT_M = 100;
const TERRAIN_SCALE_METER = 1.0;

const WORLD_X_RANGE = [-1500, 1500];
const WORLD_Z_RANGE = [-1500, 1500];
const PLAYER_SPAWN = { x: 0, y: 0 };

const MOVE_SPEED_M = 3.0;   // 米/秒
const TICK_DT_S = 0.1;     // 一次 tick = 100ms（与前端 TICK_MS 对齐）
const MOB_VIEW_M = 80;
const MOB_ATK_M = 2;
const ALLY_ATK_M = 2;
const ALLY_FOLLOW_GAP_M = 12;
const CHEST_PICKUP_M = 2;
const POTION_PICKUP_M = 2;
const SKILL_RANGE_M = 30;

/* ---- ★ v4 区域刷新（Region Respawn）+ 城镇安全区 + 敌人探测/脱战 ----
   1) 世界 = 晨曦镇（安全区）+ 6 个野区（正六边形拓扑：环半径 480m，区域半径 240m）
   2) 每个野区各自维护刷新计时：玩家离开该区域 45 秒后刷新一次（补满该区域配额）
   3) 敌人探测半径 = MOB_DETECT_M（10 米），超出 MOB_DISENGAGE_M（12 米）脱战 → 归位巢点游荡
   4) 敌人复活 = 区域刷新机制重新生成（死亡实体当帧从 entities 移除，不再残留 alive=false）
*/
const REGION_RESPAWN_SEC = 45;
const REGION_RESPAWN_TICKS = REGION_RESPAWN_SEC * 10;   // TICK_DT_S = 0.1
const MOB_DETECT_M = 10;      // ★ 敌人探测半径（米）—— v4 修复项
const MOB_DISENGAGE_M = 12;   // 脱战阈值（米）：探测半径 +2 米迟滞
const MOB_LEASH_R_M = 8;      // 离巢超过此距离 → 归位
const MOB_WANDER_R_M = 8;     // 归位后游荡半径
const TOWN_SPAWN_BUFFER_M = 20;  // 野怪落点距城镇边界的最小缓冲

/** 区域划分方案：城镇居中（安全区），6 个野区环绕（环半径 480 m，区域半径 240 m） */
const WORLD_REGIONS = [
  { id: "town",  name: "晨曦镇",   short: "晨曦", kind: "safe",   x: 0,    y: 0,    r: 160, safe: true,  lv: 0, mobs: 0, desc: "玩家出生的城镇（安全区）：商铺、民居、水井与中立居民，不刷新野怪" },
  { id: "wood",  name: "东岭林场", short: "东岭", kind: "forest", x: 480,  y: 0,    r: 240, safe: false, lv: 1, mobs: 4, desc: "低矮林地，狼群与哥布林斥候游荡" },
  { id: "shore", name: "东北浅滩", short: "东北", kind: "shore",  x: 240,  y: 416,  r: 240, safe: false, lv: 1, mobs: 3, desc: "水边滩地，毒蛇与蝙蝠出没" },
  { id: "mine",  name: "西北矿丘", short: "西北", kind: "mine",   x: -240, y: 416,  r: 240, safe: false, lv: 2, mobs: 4, desc: "废弃矿丘，骷髅兵与哥布林盘踞" },
  { id: "ruin",  name: "西郊废墟", short: "西郊", kind: "ruin",   x: -480, y: 0,    r: 240, safe: false, lv: 2, mobs: 4, desc: "残垣断壁，骷髅兵与荒野游荡者" },
  { id: "marsh", name: "西南沼地", short: "西南", kind: "marsh",  x: -240, y: -416, r: 240, safe: false, lv: 3, mobs: 5, desc: "沼泽泥地，毒蛇群与巨狼" },
  { id: "wild",  name: "东南荒原", short: "东南", kind: "wild",   x: 240,  y: -416, r: 240, safe: false, lv: 3, mobs: 5, desc: "开阔荒原，成群野兽巡行" },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const clampX = (v) => clamp(v, WORLD_X_RANGE[0] + 10, WORLD_X_RANGE[1] - 10);
const clampY = (v) => clamp(v, WORLD_Z_RANGE[0] + 10, WORLD_Z_RANGE[1] - 10);
const rndX = () => rnd(WORLD_X_RANGE[0] + 80, WORLD_X_RANGE[1] - 80);
const rndY = () => rnd(WORLD_Z_RANGE[0] + 80, WORLD_Z_RANGE[1] - 80);
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function fallbackMap() {
  return {
    theme: "野外·清晨",
    narration: "薄雾笼罩着这片荒野，远处传来低沉的嘶吼。收拢心神，活下去。",
    zones: [
      { name: "营地", x: 0,    y: 0,    r: 200,  kind: "safe",   desc: "玩家出生的安全区" },
      { name: "荒地", x: 300,  y: 200,  r: 260,  kind: "danger", desc: "野兽频繁出没" },
      { name: "废墟", x: -400, y: -300, r: 220,  kind: "loot",   desc: "可能残留物资" },
    ],
    enemy_archetypes: [
      { id: "enemy_1", name: "荒野游荡者", lv: 1, hp: 40, atk: 6, def: 2, speed: 1.4, bounty: { exp: 10, money: 8 }, color: "#9b3a3a" },
    ],
    chests: [
      { x:  100, y:  150, tier: 1, loot: { exp: 15, money: 12, item: "干粮" } },
      { x: -200, y:  100, tier: 2, loot: { exp: 20, money: 18, item: "急救包" } },
      { x: -500, y: -200, tier: 1, loot: { exp: 12, money:  9, item: "工具卷" } },
      { x:  450, y:  300, tier: 2, loot: { exp: 25, money: 20, item: "药剂" } },
    ],
    potions: [
      { x:   70, y: -120, heal: 40 },
      { x: -150, y:   50, heal: 40 },
      { x:  300, y: -300, heal: 30 },
      { x: -350, y:  150, heal: 30 },
    ],
    waves: [{ archetype: "enemy_1", count: 3, interval: 600 }],
    notes: `fallback map (agent 不可用) - 世界 ${TERRAIN_GROUND_SIZE_M}m，块 ${TERRAIN_BLOCK_SIZE_M}m，chunk ${CHUNK_SIZE_M}m`,
  };
}

function buildSkills(card) {
  const raw = Array.isArray(card?.skills) ? card.skills : [];
  const names = raw.map((s) => (typeof s === "string" ? s : str(s?.name))).filter(Boolean);
  const out = [];
  for (let i = 0; i < 8; i++) {
    const name = names[i] || (i < 4 ? `技能${i + 1}` : `备用技${i - 3}`);
    out.push({ name, power: 12 + i * 3, cost: 0, cd: 24 + i * 6, cdLeft: 0 });
  }
  return out;
}

function buildItems(card) {
  const raw = Array.isArray(card?.items) ? card.items : [];
  const names = raw.map((s) => (typeof s === "string" ? s : str(s?.name))).filter(Boolean);
  const out = [];
  for (let i = 0; i < 8; i++) {
    const name = names[i] || (i < 4 ? `物品${i + 1}` : `备用物${i - 3}`);
    out.push({ name, count: names[i] ? 2 : 1, heal: 20 });
  }
  return out;
}

function makeEntity(role, side, x, y, idx) {
  const hp = num(role?.hp, side === "enemy" ? 60 : 100) || 100;
  return {
    id: str(role?.id, `${side}_${idx}`),
    name: str(role?.name, side === "enemy" ? `野兽${idx + 1}` : `角色${idx + 1}`),
    side, x, y, vx: 0, vy: 0, hp, maxHp: hp,
    atk: side === "enemy" ? 8 : 14,
    level: num(role?.level, 1) || 1,
    avatarPath: str(role?.avatarPath) || void 0,
    facing: 0, cooldown: 0, alive: true,   // facing 角度制：0=右 90=下 180=左 270=上
  };
}

function emptyState(ctx) {
  const card = ctx?.playerCard || {};
  return {
    phase: "select",
    version: 4,   // v4：区域刷新（城镇安全区 + 6 野区，玩家离区 45s 刷新一次）
    tick: 0,
    world: { w: WORLD_X_RANGE[1] - WORLD_X_RANGE[0], h: WORLD_Z_RANGE[1] - WORLD_Z_RANGE[0] },
    spawn: { ...PLAYER_SPAWN },
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
    roles: Array.isArray(ctx?.roles) ? ctx.roles : [],
    selections: { participants: [], spectators: [], enemies: [] },
    entities: [],
    chests: [],
    potions: [],
    floaters: [],
    skills: buildSkills(card),
    items: buildItems(card),
    skillPage: 0,
    itemPage: 0,
    playerCard: card,
    exp: 0, money: 0, drops: [], kills: 0, events: [],
    map: null,
    mapSource: "fallback",
    regions: [],         // ★ v4：由 initRegions() 填充（城镇 + 6 野区）
    town: null,          // ★ v4：由 ensureTown() 填充（建筑 + 中立角色）
    result: null,
  };
}

/** ★ fix③：宿主 agent 超时上限（同 entry.ts）——/plugin/tick(start) 不能被地图生成挂住 */
const MAP_AGENT_TIMEOUT_MS = 12000;
function withTimeout(p, ms, msg) {
  let timer = null;
  return Promise.race([
    p.finally(() => { if (timer) clearTimeout(timer); }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(msg)), ms); }),
  ]);
}

async function ensureMapData(ctx) {
  const tsApi = ctx?.tsApi;
  if (!tsApi?.agent?.run || !tsApi?.pluginData?.set) return fallbackMap();
  // ★ fix③：本会话已有可用地图 → 直接复用（start 立即返回）
  try {
    const stored = await tsApi.pluginData.get("map_data");
    if (stored && Array.isArray(stored.enemy_archetypes) && stored.enemy_archetypes.length) return stored;
  } catch { /* 读取失败 → 继续生成 */ }
  try {
    const r = await withTimeout(
      tsApi.agent.run("field-survival-map-gener", { storyDigest: "" }),
      MAP_AGENT_TIMEOUT_MS,
      `map agent 超时（>${MAP_AGENT_TIMEOUT_MS}ms）`,
    );
    const map = (r?.output || fallbackMap());
    if (!Array.isArray(map.enemy_archetypes) || !map.enemy_archetypes.length) {
      map.enemy_archetypes = fallbackMap().enemy_archetypes;
    }
    await tsApi.pluginData.set("map_data", map);
    return map;
  } catch {
    const map = fallbackMap();
    try { await tsApi.pluginData.set("map_data", map); } catch {}
    return map;
  }
}

/** ★ fix③：波次落点统一围绕"玩家当前位置"，不再 rndX()/rndY() 全图随机
 *  （原实现怪物会落在 ±1420 米的任意位置：玩家既看不见也打不到，运气差还会
 *    恰好落在身边＝"怪物凭空出现在旁边"。此与 entry.ts 的同名逻辑保持一致。）*/
function spawnAnchor(s, minM, maxM) {
  const p = s.entities.find((e) => e.side === "player");
  const cx = p ? p.x : PLAYER_SPAWN.x;
  const cy = p ? p.y : PLAYER_SPAWN.y;
  const angle = rnd(0, Math.PI * 2);
  const distM = minM + rnd(0, maxM - minM);
  return { x: clampX(cx + Math.cos(angle) * distM), y: clampY(cy + Math.sin(angle) * distM) };
}

function spawnWave(s, wave) {
  const archs = (s.map?.enemy_archetypes && s.map.enemy_archetypes.length) ? s.map.enemy_archetypes : null;
  if (archs) {
    const wavesCfg = (s.map?.waves && s.map.waves.length ? s.map.waves : [{ archetype: archs[0].id, count: 3, interval: 600 }]);
    const pick = wavesCfg[Math.min(wave - 1, wavesCfg.length - 1)] || wavesCfg[0];
    const arch = archs.find((a) => a.id === pick.archetype) || archs[0];
    const count = Math.max(1, Math.min(6, num(pick.count, 3) + Math.floor(wave / 3)));
    for (let i = 0; i < count; i++) {
      const at = spawnAnchor(s, 30, 100);      // ★ fix③：玩家周围 30~100 米
      const e = makeEntity(
        { id: `${arch.id}_${wave}_${i}`, name: arch.name, hp: Math.round(arch.hp + (wave - 1) * 8), level: arch.lv },
        "enemy", at.x, at.y, i,
      );
      e.atk = Math.round(arch.atk + (wave - 1) * 1.5);
      e.bounty = { ...arch.bounty };
      e.def = arch.def;
      s.entities.push(e);
    }
    if (wave === 1) {
      (s.map?.chests || []).forEach((c, i) => {
        s.chests.push({ id: `chest_map_${i}`, x: clampX(c.x), y: clampY(c.y), opened: false, ...c });
      });
      (s.map?.potions || []).forEach((p, i) => {
        s.potions.push({ id: `potion_map_${i}`, x: clampX(p.x), y: clampY(p.y), heal: num(p.heal, 40) });
      });
    }
    return;
  }
  const count = Math.min(2 + wave, 6);
  for (let i = 0; i < count; i++) {
    const at = spawnAnchor(s, 30, 100);        // ★ fix③
    const e = makeEntity({ id: `enemy_${s.tick}_${i}`, name: `野兽 ${i + 1}`, hp: 45 + wave * 12, level: wave },
      "enemy", at.x, at.y, i);
    e.atk = 7 + wave * 2;
    s.entities.push(e);
  }
  for (let i = 0; i < 2; i++) {
    const at = spawnAnchor(s, 25, 55);         // ★ fix③：宝箱
    s.chests.push({ id: `chest_${s.tick}_${i}`, x: at.x, y: at.y, opened: false });
  }
  for (let i = 0; i < 3; i++) {
    const at = spawnAnchor(s, 20, 45);         // ★ fix③：血瓶
    s.potions.push({ id: `potion_${s.tick}_${i}`, x: at.x, y: at.y, heal: 18 });
  }
}

function pushEvent(s, text) {
  s.events.push(text);
  if (s.events.length > 40) s.events = s.events.slice(-40);
}

function floater(s, text, x, y) {
  s.floaters.push({ id: `f_${s.tick}_${Math.random().toString(36).slice(2, 6)}`, text, x, y, life: 24 });
  if (s.floaters.length > 30) s.floaters = s.floaters.slice(-30);
}

function damage(s, target, amount) {
  target.hp = clamp(target.hp - amount, 0, target.maxHp);
  floater(s, `-${Math.round(amount)}`, target.x, target.y - 24);
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    if (target.side === "enemy") {
      s.kills += 1;
      const bounty = target.bounty;
      const expGain = bounty?.exp != null ? Math.round(num(bounty.exp, 10)) : 8 + target.level * 4;
      const moneyGain = bounty?.money != null ? Math.round(num(bounty.money, 8)) : 5 + target.level * 3;
      s.exp += expGain;
      s.money += moneyGain;
      if (Math.random() < 0.5) {
        const drop = ["野兽皮", "锋利的爪", "兽骨"][Math.floor(Math.random() * 3)];
        s.drops.push(drop);
      }
      pushEvent(s, `击败 ${target.name}，获得 ${expGain} 经验、${moneyGain} 金钱`);
    } else {
      pushEvent(s, `${target.name} 倒下了`);
    }
  }
}

function moveTowards(e, tx, ty, speed) {
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

/** 判断坐标落在哪个区域（城镇优先；野区取最近中心） */
function regionAt(x, y) {
  const town = WORLD_REGIONS[0];
  if (Math.hypot(x - town.x, y - town.y) <= town.r) return town;
  let best = WORLD_REGIONS[1];
  let bestD = Infinity;
  for (let i = 1; i < WORLD_REGIONS.length; i++) {
    const r = WORLD_REGIONS[i];
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/** 离给定坐标最近的野区（城镇出生点用：敌对角色落点不落在城镇内） */
function nearestWildRegion(x, y) {
  let best = WORLD_REGIONS[1];
  let bestD = Infinity;
  for (let i = 1; i < WORLD_REGIONS.length; i++) {
    const r = WORLD_REGIONS[i];
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/** 各区域野怪名称（与前端 mobKeyFor 精灵映射对齐：狼/兽→orc、蛇→snake、蝠→bat、骷髅→skeleton、默认→goblin） */
const REGION_MOB_NAMES = {
  wood:  ["巨狼", "哥布林斥候"],
  shore: ["毒蛇", "蝙蝠"],
  mine:  ["骷髅兵", "哥布林斥候"],
  ruin:  ["骷髅兵", "荒野游荡者"],
  marsh: ["毒蛇", "巨狼"],
  wild:  ["哥布林斥候", "巨狼", "荒野游荡者"],
};

/** 野怪属性模板（无地图数据时的内置保底，与前端兜底野怪同源） */
const MOB_PRESETS = {
  "哥布林斥候": { hp: 30, atk: 6 },
  "巨狼":       { hp: 60, atk: 10 },
  "毒蛇":       { hp: 25, atk: 8 },
  "蝙蝠":       { hp: 20, atk: 5 },
  "骷髅兵":     { hp: 50, atk: 12 },
  "荒野游荡者": { hp: 40, atk: 6 },
};

let _mobSeq = 0;

/** 初始化区域运行时状态（进入 playing 时调用；旧 state 缺 regions 时在 tick 里自愈补建） */
function initRegions(s) {
  s.regions = WORLD_REGIONS.map((r) => ({
    id: r.id, name: r.name, short: r.short, kind: r.kind,
    x: r.x, y: r.y, r: r.r, safe: r.safe, lv: r.lv, mobs: r.mobs, desc: r.desc,
    aliveCount: 0, playerInside: false, leftTick: -1, nextSpawnTick: -1, spawnCount: 0,
  }));
}

/** 某区域内当前存活的野怪数量 */
function countAliveInRegion(s, regionId) {
  let n = 0;
  for (const e of s.entities) {
    if (e.side === "enemy" && e.alive !== false && e.regionId === regionId) n++;
  }
  return n;
}

/** 在区域内取一个合法落点（避让城镇安全缓冲；尽量不贴脸玩家） */
function regionSpawnPoint(s, region) {
  const player = s.entities.find((e) => e.side === "player");
  const town = WORLD_REGIONS[0];
  let x = region.x, y = region.y;
  for (let t = 0; t < 8; t++) {
    const a = rnd(0, Math.PI * 2);
    const d = region.r * (0.35 + rnd(0, 0.55));      // 0.35r ~ 0.9r：落点留在本区域内
    const cx = clampX(region.x + Math.cos(a) * d);
    const cy = clampY(region.y + Math.sin(a) * d);
    if (Math.hypot(cx - town.x, cy - town.y) < town.r + TOWN_SPAWN_BUFFER_M) continue;   // 不进城镇
    if (player && player.alive && Math.hypot(cx - player.x, cy - player.y) < 12) continue;  // 不贴脸
    x = cx; y = cy;
    break;
  }
  return { x: x, y: y };
}

/** 在指定区域生成 n 只野怪（★ v4：敌人复活即由此重新生成，不再依赖 alive=false 残留实体） */
function spawnRegionMobs(s, region, n) {
  const names = REGION_MOB_NAMES[region.id] || ["荒野游荡者"];
  const archs = (s.map && s.map.enemy_archetypes && s.map.enemy_archetypes.length) ? s.map.enemy_archetypes : null;
  const lv = Math.max(1, region.lv);
  for (let i = 0; i < n; i++) {
    const name = names[(_mobSeq + i) % names.length];
    const at = regionSpawnPoint(s, region);
    const preset = MOB_PRESETS[name] || { hp: 40, atk: 6 };
    const arch = archs ? archs[(_mobSeq + i) % archs.length] : null;
    const hp = Math.round((arch ? num(arch.hp, preset.hp) * 0.6 : preset.hp) + (lv - 1) * 10);
    const e = makeEntity({ id: `mob_${region.id}_${_mobSeq++}`, name: name, hp: hp, level: lv }, "enemy", at.x, at.y, i);
    e.atk = Math.round((arch ? num(arch.atk, preset.atk) * 0.6 : preset.atk) + (lv - 1) * 2);
    e.regionId = region.id;
    e.homeX = at.x;
    e.homeY = at.y;
    e.aiState = "idle";
    e.wanderTimer = 0;
    e.bounty = (arch && arch.bounty) ? { ...arch.bounty } : { exp: 8 + lv * 4, money: 5 + lv * 3 };
    s.entities.push(e);
  }
}

/** 区域刷新计时器：玩家离开某区域 → 该区域 45 秒后刷新一次（补满配额） */
function regionTick(s, player) {
  if (!Array.isArray(s.regions) || !s.regions.length) initRegions(s);
  if (!s.town || !s.town.buildings) ensureTown(s);
  const cur = regionAt(player.x, player.y);
  for (const r of s.regions) {
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
const TOWN_BUILDINGS = [
  { kind: "inn",   name: "旅店",   x: -46, y: -42, w: 6, h: 7 },
  { kind: "shop",  name: "杂货铺", x:  46, y: -38, w: 5, h: 6 },
  { kind: "house", name: "民居",   x: -78, y:  22, w: 4, h: 5 },
  { kind: "house", name: "民居",   x: -50, y:  62, w: 4, h: 5 },
  { kind: "house", name: "民居",   x:  56, y:  30, w: 4, h: 5 },
  { kind: "house", name: "民居",   x:  82, y:  -8, w: 4, h: 5 },
  { kind: "house", name: "民居",   x:   0, y: -78, w: 5, h: 6 },
  { kind: "well",  name: "水井",   x:   0, y:  34, w: 2, h: 2 },
];

/** 城镇中立角色（不参与战斗，仅作安全区氛围） */
const TOWN_NPCS = [
  { name: "镇长 老白", x: -20, y:  14 },
  { name: "铁匠 大壮", x:  30, y: -16 },
  { name: "商人 阿福", x:  20, y:  26 },
  { name: "守卫 石岩", x: -32, y: -14 },
];

/** 建立城镇（安全区）：建筑清单 + 中立角色实体（幂等） */
function ensureTown(s) {
  const town = WORLD_REGIONS[0];
  if (!s.town || !s.town.buildings) {
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
      e.regionId = town.id;
      e.homeX = n.x;
      e.homeY = n.y;
      e.aiState = "npc";
      s.entities.push(e);
    });
  }
}

function step(s, input, poseHint) {
  const speed = MOVE_SPEED_M;   // 米/秒
  const player = s.entities.find((e) => e.side === "player");
  if (!player || !player.alive) return;

  // ★ 关键修复（坐标双写）：玩家位姿权威在客户端，宿主只镜像 tick 参数里的 player
  const pose = poseHint || input?.player;
  if (pose && Number.isFinite(num(pose.x, NaN)) && Number.isFinite(num(pose.y, NaN))) {
    player.x = clampX(num(pose.x, player.x));
    player.y = clampY(num(pose.y, player.y));
    player.facing = num(pose.facing, player.facing);
    player.vx = 0;
    player.vy = 0;
  } else {
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
      if (dist(player, { x: tx, y: ty }) > 1.0) moveTowards(player, tx, ty, speed);
      else { player.vx = 0; player.vy = 0; }
    } else {
      player.vx = 0;
      player.vy = 0;
    }
  }

  const enemies = s.entities.filter((e) => e.side === "enemy" && e.alive);
  const allies = s.entities.filter((e) => e.side === "ally" && e.alive);

  allies.forEach((a, i) => {
    const target = enemies.reduce((best, e) => (!best || dist(a, e) < dist(a, best) ? e : best), null);
    const anchor = {
      x: player.x + Math.cos((i / Math.max(1, allies.length)) * Math.PI * 2) * ALLY_FOLLOW_GAP_M,
      y: player.y + Math.sin((i / Math.max(1, allies.length)) * Math.PI * 2) * ALLY_FOLLOW_GAP_M,
    };
    if (target && dist(a, target) < MOB_VIEW_M) moveTowards(a, target.x, target.y, speed * 0.92);
    else moveTowards(a, anchor.x, anchor.y, speed * 0.8);
    if (target && dist(a, target) < ALLY_ATK_M && a.cooldown <= 0) {
      damage(s, target, a.atk);
      a.cooldown = 30;
    }
  });

  // ★ v4 敌人 AI：探测半径 10 米（MOB_DETECT_M）→ 追击 → 2 米攻击
  //          → 超出 12 米（MOB_DISENGAGE_M）脱战 → 归位巢点并在 8 米内游荡
  enemies.forEach((e) => {
    const prey = [player, ...allies].filter((t) => t.alive)
      .reduce((best, t) => (!best || dist(e, t) < dist(e, best) ? t : best), null);
    const home = { x: num(e.homeX, e.x), y: num(e.homeY, e.y) };   // 巢点（无则取当前位）
    const preyIn = prey ? dist(e, prey) : Infinity;
    // ① 追击态：超出脱战半径 → 停止追击（转归位）；否则贴身攻击 / 继续接近
    if (e.aiState === "chase") {
      if (!prey || preyIn > MOB_DISENGAGE_M) {
        e.aiState = "return";
        e.vx = 0; e.vy = 0;
        return;
      }
      if (preyIn > MOB_ATK_M) { moveTowards(e, prey.x, prey.y, speed * 0.72); return; }
      e.vx = 0; e.vy = 0;
      if (e.cooldown <= 0) { damage(s, prey, e.atk); e.cooldown = 45; }
      return;
    }
    // ② 巡逻态：探测半径内发现玩家/盟友 → 进入追击
    if (prey && preyIn <= MOB_DETECT_M) {
      e.aiState = "chase";
      if (preyIn > MOB_ATK_M) { moveTowards(e, prey.x, prey.y, speed * 0.72); return; }
      e.vx = 0; e.vy = 0;
      if (e.cooldown <= 0) { damage(s, prey, e.atk); e.cooldown = 45; }
      return;
    }
    // ③ 脱战/巡逻：离巢超过 8 米 → 归位；否则在巢点周围小范围游荡（绝不全图直线追）
    if (e.aiState !== "idle" && e.aiState !== "npc") { e.aiState = "idle"; e.wanderTimer = 0; }
    if (dist(e, home) > MOB_LEASH_R_M) {
      moveTowards(e, home.x, home.y, speed * 0.55);
      e.wanderTimer = 0;
      return;
    }
    if (!(num(e.wanderTimer, 0) > 0)) {
      const wa = rnd(0, Math.PI * 2);
      const wr = rnd(2, MOB_WANDER_R_M);
      e.wanderX = clampX(home.x + Math.cos(wa) * wr);
      e.wanderY = clampY(home.y + Math.sin(wa) * wr);
      e.wanderTimer = Math.round(rnd(30, 90));
    }
    e.wanderTimer = num(e.wanderTimer, 0) - 1;
    const wx = num(e.wanderX, home.x);
    const wy = num(e.wanderY, home.y);
    if (Math.hypot(wx - e.x, wy - e.y) > 1) moveTowards(e, wx, wy, speed * 0.35);
    else { e.vx = 0; e.vy = 0; }
  });

  // 速度 m/s × dt（修复：原先按『米/帧』直接加，10 倍误差）
  s.entities.forEach((e) => {
    if (e.cooldown > 0) e.cooldown -= 1;
    e.x = clampX(e.x + e.vx * TICK_DT_S);
    e.y = clampY(e.y + e.vy * TICK_DT_S);
  });
  s.skills.forEach((k) => { if (k.cdLeft > 0) k.cdLeft -= 1; });
  s.floaters = s.floaters.map((f) => ({ ...f, life: f.life - 1 })).filter((f) => f.life > 0);

  s.chests.forEach((c) => {
    if (c.opened) return;
    if (dist(player, c) < CHEST_PICKUP_M) {
      c.opened = true;
      const loot = c.loot;
      const expGain = loot?.exp != null ? Math.round(num(loot.exp, 15)) : 12 + Math.floor(rnd(0, 10));
      const moneyGain = loot?.money != null ? Math.round(num(loot.money, 12)) : 15 + Math.floor(rnd(0, 20));
      const drop = loot?.item || ["生锈的钥匙", "干粮", "荧光石"][Math.floor(Math.random() * 3)];
      s.exp += expGain; s.money += moneyGain; s.drops.push(drop);
      floater(s, `宝箱 +${expGain}exp`, c.x, c.y);
      pushEvent(s, `打开宝箱：${drop}，+${expGain} 经验，+${moneyGain} 金钱`);
    }
  });

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

  if (!player.alive && s.phase === "playing") {
    s.phase = "over";
    s.result = { reason: "death", exp: s.exp, money: s.money, drops: [...s.drops], kills: s.kills, survivedTicks: s.tick };
    pushEvent(s, "你倒下了……");
  }
}

export async function handle_action(action, params, state, context) {
  const s = state && Object.keys(state).length > 0 && (state.version === 2 || state.version === 3 || state.version === 4)
    ? state : emptyState(context);

  const okResp = (msg) => ({ code: 0, message: "ok", state: s, response: msg });

  switch (action) {
    case "init":
    case "start_init": {
      const fresh = emptyState(context);
      fresh.roles = Array.isArray(context?.roles) ? context.roles : [];
      return { code: 0, message: "ok", state: fresh, response: "请选择参展 / 观战 / 敌对角色后开始" };
    }
    case "start": {
      const sel = (params?.selections || params || {});
      const participants = Array.isArray(sel.participants) ? sel.participants.map(String) : [];
      const spectators = Array.isArray(sel.spectators) ? sel.spectators.map(String) : [];
      const enemies = Array.isArray(sel.enemies) ? sel.enemies.map(String) : [];
      const roles = Array.isArray(context?.roles) ? context.roles : [];
      const byId = (id) => roles.find((r) => String(r.id) === id || String(r.name) === id);
      const playerRole = roles.find((r) => String(r.roleType) === "player") || roles[0];
      s.selections = { participants, spectators, enemies };
      s.entities = [];
      s.entities.push(makeEntity(playerRole, "player", PLAYER_SPAWN.x, PLAYER_SPAWN.y, 0));
      participants.forEach((id, i) => {
        const r = byId(id);
        if (!r) return;
        const angle = (i / Math.max(1, participants.length)) * Math.PI * 2;
        s.entities.push(makeEntity(
          r, "ally",
          PLAYER_SPAWN.x + Math.cos(angle) * ALLY_FOLLOW_GAP_M,
          PLAYER_SPAWN.y + Math.sin(angle) * ALLY_FOLLOW_GAP_M,
          i,
        ));
      });
      // ★ v4：敌对角色落在「最近的野区」内（玩家出生于城镇安全区，
      //   沿用"围绕玩家 30~100 米"的落点会落进城镇内部，破坏安全区规则）
      const startRegion = nearestWildRegion(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
      enemies.forEach((id, i) => {
        const r = byId(id);
        const at = regionSpawnPoint(s, startRegion);
        const e = r ? makeEntity(r, "enemy", at.x, at.y, i) : makeEntity({ id, name: id }, "enemy", at.x, at.y, i);
        e.regionId = startRegion.id;
        e.homeX = at.x;
        e.homeY = at.y;
        e.aiState = "idle";
        s.entities.push(e);
      });
      spectators.forEach((id) => {
        const r = byId(id);
        if (r) s.entities.push({ ...makeEntity(r, "spectator", -40, -40 + s.entities.length * 4, 0), alive: true });
      });
      s.map = await ensureMapData(context);
      s.mapSource = (s.map?.notes || "").includes("fallback") ? "fallback" : "agent";

      // ★ v4：区域划分（晨曦镇 + 6 野区）写入 map.zones —— 主地图与小地图据此显示区域名称
      if (s.map) {
        s.map.zones = WORLD_REGIONS.map((r) => ({ name: r.name, x: r.x, y: r.y, r: r.r, kind: r.kind, desc: r.desc }));
      }
      // ★ v4：建立城镇（安全区：建筑 + 中立角色）与区域运行时状态
      ensureTown(s);
      initRegions(s);
      // ★ v4：初始铺怪 —— 每个野区各刷满自己的配额（城镇配额 0，安全区内无野怪）
      WORLD_REGIONS.forEach((r) => { if (!r.safe && r.mobs > 0) spawnRegionMobs(s, r, r.mobs); });
      // ★ v4：宝箱 / 血瓶仍按地图数据铺设一次（区域刷新只补野怪，不重置宝箱）
      if (!s.chests.length) {
        (s.map?.chests || []).forEach((c, i) => {
          s.chests.push({ ...c, id: `chest_map_${i}`, x: clampX(num(c.x, 0)), y: clampY(num(c.y, 0)), opened: false });
        });
      }
      if (!s.potions.length) {
        (s.map?.potions || []).forEach((p, i) => {
          s.potions.push({ id: `potion_map_${i}`, x: clampX(num(p.x, 0)), y: clampY(num(p.y, 0)), heal: num(p.heal, 40) });
        });
      }
      // 兜底：地图数据没给宝箱 / 血瓶时，按野区（非城镇）各铺 3 个
      if (!s.chests.length) {
        ["wood", "ruin", "wild"].forEach((rid, i) => {
          const r = WORLD_REGIONS.find((z) => z.id === rid);
          const at = regionSpawnPoint(s, r);
          s.chests.push({ id: `chest_${rid}_${i}`, x: at.x, y: at.y, opened: false, loot: { exp: 12 + i * 5, money: 10 + i * 4, item: "干粮" } });
        });
      }
      if (!s.potions.length) {
        ["shore", "mine", "marsh"].forEach((rid, i) => {
          const r = WORLD_REGIONS.find((z) => z.id === rid);
          const at = regionSpawnPoint(s, r);
          s.potions.push({ id: `potion_${rid}_${i}`, x: at.x, y: at.y, heal: 24 + i * 6 });
        });
      }
      s.phase = "playing";
      s.tick = 0;
      const theme = str(s.map?.theme, "野外");
      const narration = str(s.map?.narration, "");
      s.events = [narration || `进入「${theme}」：操作你的角色，击杀敌人、开启宝箱、拾取血瓶。`];
      return okResp(`进入「${theme}」`);
    }
    case "tick": {
      if (s.phase !== "playing") return okResp("");
      s.tick += 1;
      step(s, params?.input || params, params?.player);   // ★ fix③：把客户端上报的权威位姿透传给 step
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
      if (!targets.length) {
        damage(s, s.entities.filter((e) => e.side === "enemy" && e.alive)[0] || player, 0);
        return okResp(`${skill.name} 未命中`);
      }
      skill.cdLeft = skill.cd;
      targets.slice(0, 3).forEach((t) => damage(s, t, skill.power));
      pushEvent(s, `施放 ${skill.name}，命中 ${Math.min(3, targets.length)} 个目标`);
      return okResp(`${skill.name}`);
    }
    case "item": {
      if (s.phase !== "playing") return okResp("");
      const idx = num(params?.index, 0);
      const slotIdx = s.itemPage * 4 + idx;
      const item = s.items[slotIdx];
      const player = s.entities.find((e) => e.side === "player");
      if (!item || !player || !player.alive) return okResp("");
      if (item.count <= 0) return okResp(`${item.name} 已用完`);
      item.count -= 1;
      const before = player.hp;
      player.hp = clamp(player.hp + item.heal, 0, player.maxHp);
      pushEvent(s, `使用 ${item.name}，恢复 ${Math.round(player.hp - before)} 点生命`);
      return okResp(`${item.name}`);
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
      if (s.phase === "playing" && player.alive) return okResp("");
      player.alive = true;
      player.hp = player.maxHp;
      player.vx = 0;
      player.vy = 0;
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
      s.result = { reason: "exit", exp: s.exp, money: s.money, drops: [...s.drops], kills: s.kills, survivedTicks: s.tick };
      pushEvent(s, "你主动结束了本次野外生存。");
      return { code: 0, message: "exit", state: s, response: "野外生存结束" };
    }
    default:
      if (s.phase === "select") {
        return { code: 0, message: "select_phase", state: s,
                 response: "请先在左侧面板选择角色并点击「开始」来启动野外生存。" };
      }
      return okResp("");
  }
}
