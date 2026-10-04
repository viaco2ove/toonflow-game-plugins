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
const CHUNK_SIZE_M = CHUNK_SIZE_BLOCKS * TERRAIN_BLOCK_SIZE_M;
const TERRAIN_GROUND_SIZE_M = 3e3;
const TERRAIN_GROUND_HEIGHT_M = 100;
const TERRAIN_SCALE_METER = 1;
function fallbackMap() {
  return {
    theme: "\u91CE\u5916\xB7\u6E05\u6668",
    narration: "\u8584\u96FE\u7B3C\u7F69\u7740\u8FD9\u7247\u8352\u91CE\uFF0C\u8FDC\u5904\u4F20\u6765\u4F4E\u6C89\u7684\u5636\u543C\u3002\u6536\u62E2\u5FC3\u795E\uFF0C\u6D3B\u4E0B\u53BB\u3002",
    zones: [
      { name: "\u8425\u5730", x: 1500, y: 1500, r: 200, kind: "safe", desc: "\u76F8\u5BF9\u5F00\u9614\u7684\u4E34\u65F6\u8425\u5730" },
      { name: "\u8352\u5730", x: 2100, y: 1900, r: 260, kind: "danger", desc: "\u89C6\u91CE\u5F00\u9614\u7684\u5371\u9669\u8352\u5730" },
      { name: "\u5E9F\u589F", x: 800, y: 1e3, r: 220, kind: "loot", desc: "\u53EF\u80FD\u6B8B\u7559\u7269\u8D44\u7684\u5E9F\u589F" }
    ],
    enemy_archetypes: [
      { id: "enemy_1", name: "\u8352\u91CE\u6E38\u8361\u8005", lv: 1, hp: 40, atk: 6, def: 2, speed: 1.4, bounty: { exp: 10, money: 8 }, color: "#9b3a3a" }
    ],
    chests: [
      { x: 800, y: 1e3, tier: 1, loot: { exp: 15, money: 12, item: "\u5E72\u7CAE" } },
      { x: 2200, y: 900, tier: 2, loot: { exp: 20, money: 18, item: "\u6025\u6551\u5305" } },
      { x: 1700, y: 2400, tier: 1, loot: { exp: 12, money: 9, item: "\u5DE5\u5177\u5377" } }
    ],
    potions: [
      { x: 600, y: 1800, heal: 40 },
      { x: 1900, y: 900, heal: 40 },
      { x: 2400, y: 2300, heal: 40 }
    ],
    waves: [{ archetype: "enemy_1", count: 3, interval: 600 }],
    notes: `fallback map\uFF08agent \u4E0D\u53EF\u7528\uFF09- \u4E16\u754C ${TERRAIN_GROUND_SIZE_M}m\uFF0C\u5757 ${TERRAIN_BLOCK_SIZE_M}m\uFF0Cchunk ${CHUNK_SIZE_M}m`
  };
}
function buildStoryDigest(ctx) {
  const parts = [];
  const card = ctx?.playerCard || {};
  const roles = Array.isArray(ctx?.roles) ? ctx.roles : [];
  const roleLines = roles.slice(0, 12).map((r) => {
    const rr = r || {};
    const skills = Array.isArray(rr.skills) ? rr.skills.map(String).slice(0, 4).join("/") : "";
    return `- ${String(rr.name || rr.id || "?")}\uFF08${String(rr.roleType || "?")}\uFF09lv${Number(rr.level || 1)} hp${Number(rr.hp || 100)}${skills ? " \u6280\u80FD:" + skills : ""}`;
  });
  parts.push("[\u53C2\u6218/\u5019\u9009\u89D2\u8272]\n" + (roleLines.join("\n") || "\uFF08\u65E0\uFF09"));
  const playerName = String(card.name || "");
  const cardSkills = Array.isArray(card.skills) ? card.skills.map((s) => String(typeof s === "string" ? s : s?.name)).filter(Boolean) : [];
  const cardItems = Array.isArray(card.items) ? card.items.map((s) => String(typeof s === "string" ? s : s?.name)).filter(Boolean) : [];
  parts.push(
    `[\u7528\u6237\u53C2\u6570\u5361]
\u540D\u79F0:${playerName || "\uFF08\u65E0\u540D\uFF09"} lv${Number(card.level || 1)} hp${Number(card.hp || 100)} \u91D1\u94B1${Number(card.money || 0)} \u7ECF\u9A8C${Number(card.exp || 0)}
\u6280\u80FD:${cardSkills.slice(0, 8).join("/") || "\uFF08\u65E0\uFF09"}
\u7269\u54C1:${cardItems.slice(0, 12).join("/") || "\uFF08\u65E0\uFF09"}`
  );
  return parts.join("\n\n");
}
const MAP_AGENT_TIMEOUT_MS = 12e3;
function withTimeout(p, ms, msg) {
  let timer = null;
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms);
    })
  ]);
}
async function ensureMapData(ctx) {
  const tsApi = ctx?.tsApi;
  if (!tsApi?.agent?.run || !tsApi?.pluginData?.set) return fallbackMap();
  try {
    const stored = await tsApi.pluginData.get("map_data");
    if (stored && Array.isArray(stored.enemy_archetypes) && stored.enemy_archetypes.length) {
      return stored;
    }
  } catch {
  }
  try {
    const r = await withTimeout(
      tsApi.agent.run("field-survival-map-gener", {
        storyDigest: buildStoryDigest(ctx)
      }),
      MAP_AGENT_TIMEOUT_MS,
      `map agent \u8D85\u65F6\uFF08>${MAP_AGENT_TIMEOUT_MS}ms\uFF09`
    );
    const map = r?.output || fallbackMap();
    if (!Array.isArray(map.enemy_archetypes) || !map.enemy_archetypes.length) {
      map.enemy_archetypes = fallbackMap().enemy_archetypes;
    }
    await tsApi.pluginData.set("map_data", map);
    return map;
  } catch {
    const map = fallbackMap();
    try {
      await tsApi.pluginData.set("map_data", map);
    } catch {
    }
    return map;
  }
}
const WORLD_X_RANGE = [-1500, 1500];
const WORLD_Z_RANGE = [-1500, 1500];
const PLAYER_SPAWN = { x: 13, y: 4 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const clampX = (v) => clamp(v, WORLD_X_RANGE[0] + 10, WORLD_X_RANGE[1] - 10);
const clampY = (v) => clamp(v, WORLD_Z_RANGE[0] + 10, WORLD_Z_RANGE[1] - 10);
const rndX = () => rnd(WORLD_X_RANGE[0] + 80, WORLD_X_RANGE[1] - 80);
const rndY = () => rnd(WORLD_Z_RANGE[0] + 80, WORLD_Z_RANGE[1] - 80);
const MOVE_SPEED_M = 3;
const TICK_DT_S = 0.1;
const MOB_VIEW_M = 80;
const MOB_ATK_M = 0.5;
const ALLY_ATK_M = 0.5;
/** ★ game.md：野怪发起攻击的距离 = 4 米 —— 怪不打进玩家身边 4m 内友军不动手；
 *  友军索敌锚点是「玩家」而非友军自身（此前锚在友军身上 → 打远的）。 */
const ALLY_ENGAGE_M = 4;
/** 友军跟随阵位半径 2.5m（此前 12m，站位散开是「打远的」帮凶） */
const ALLY_FOLLOW_GAP_M = 2.5;
const CHEST_PICKUP_M = 2;
const POTION_PICKUP_M = 2;
/** ★ game.md：远程野怪/远程武器/远程技能 距离 4 米（此前 30 米） */
const SKILL_RANGE_M = 4;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const REGION_RESPAWN_SEC = 45;
const REGION_RESPAWN_TICKS = REGION_RESPAWN_SEC * 10;
const MOB_DETECT_M = 4;
const MOB_DISENGAGE_M = 4;
const MOB_LEASH_R_M = 4;
const MOB_WANDER_R_M = 3;
const TOWN_SPAWN_BUFFER_M = 20;
const WORLD_REGIONS = [
  { id: "town", name: "\u6668\u66E6\u9547", short: "\u6668\u66E6", kind: "safe", x: 0, y: 0, r: 160, safe: true, lv: 0, mobs: 0, desc: "\u73A9\u5BB6\u51FA\u751F\u7684\u57CE\u9547\uFF08\u5B89\u5168\u533A\uFF09\uFF1A\u5546\u94FA\u3001\u6C11\u5C45\u3001\u6C34\u4E95\u4E0E\u4E2D\u7ACB\u5C45\u6C11\uFF0C\u4E0D\u5237\u65B0\u91CE\u602A" },
  { id: "wood", name: "\u4E1C\u5CAD\u6797\u573A", short: "\u4E1C\u5CAD", kind: "forest", x: 480, y: 0, r: 240, safe: false, lv: 1, mobs: 4, desc: "\u4F4E\u77EE\u6797\u5730\uFF0C\u72FC\u7FA4\u4E0E\u54E5\u5E03\u6797\u65A5\u5019\u6E38\u8361" },
  { id: "shore", name: "\u4E1C\u5317\u6D45\u6EE9", short: "\u4E1C\u5317", kind: "shore", x: 240, y: 416, r: 240, safe: false, lv: 1, mobs: 3, desc: "\u6C34\u8FB9\u6EE9\u5730\uFF0C\u6BD2\u86C7\u4E0E\u8759\u8760\u51FA\u6CA1" },
  { id: "mine", name: "\u897F\u5317\u77FF\u4E18", short: "\u897F\u5317", kind: "mine", x: -240, y: 416, r: 240, safe: false, lv: 2, mobs: 4, desc: "\u5E9F\u5F03\u77FF\u4E18\uFF0C\u9AB7\u9AC5\u5175\u4E0E\u54E5\u5E03\u6797\u76D8\u8E1E" },
  { id: "ruin", name: "\u897F\u90CA\u5E9F\u589F", short: "\u897F\u90CA", kind: "ruin", x: -480, y: 0, r: 240, safe: false, lv: 2, mobs: 4, desc: "\u6B8B\u57A3\u65AD\u58C1\uFF0C\u9AB7\u9AC5\u5175\u4E0E\u8352\u91CE\u6E38\u8361\u8005" },
  { id: "marsh", name: "\u897F\u5357\u6CBC\u5730", short: "\u897F\u5357", kind: "marsh", x: -240, y: -416, r: 240, safe: false, lv: 3, mobs: 5, desc: "\u6CBC\u6CFD\u6CE5\u5730\uFF0C\u6BD2\u86C7\u7FA4\u4E0E\u5DE8\u72FC" },
  { id: "wild", name: "\u4E1C\u5357\u8352\u539F", short: "\u4E1C\u5357", kind: "wild", x: 240, y: -416, r: 240, safe: false, lv: 3, mobs: 5, desc: "\u5F00\u9614\u8352\u539F\uFF0C\u6210\u7FA4\u91CE\u517D\u5DE1\u884C" }
];
function str(v, d = "") {
  return typeof v === "string" ? v : v == null ? d : String(v);
}
function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
/** 技能名归一：剥离「（lv2，描述…）」等后缀 / 对象残留，用于展示与匹配（不截断，
 *  截断放在按分隔符拆分之后，避免把「A、B、C」切出半个名字） */
function cleanSkillName(v) {
  let n = v && typeof v === "object" ? str(v.name ?? v.skill ?? "") : str(v);
  n = n.replace(/\[object Object\]/g, " ");
  n = n.replace(/[（(][^）)]*[）)]/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  n = n.replace(/[·、,，;；:：]+$/, "").trim();
  return n;
}
function skillKey(v) {
  return cleanSkillName(v).toLowerCase();
}
/** 技能名匹配（前端展示名已剥离「（lv2，…）」，参数卡里仍是原文，须归一后比较） */
function sameSkill(a, b) {
  const ka = skillKey(a);
  return !!ka && ka === skillKey(b);
}
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
function buildSkills(card, n = 8, meta) {
  const raw = Array.isArray(card?.skills) ? card.skills : [];
  const seen = /* @__PURE__ */ new Map();
  const names = [];
  const lvs = [];
  raw.forEach((s) => {
    const parts = typeof s === "string" ? splitSkillList(s) : [s];
    parts.forEach((p) => {
      const nm = cleanSkillName(p).slice(0, 12);
      if (!nm) return;
      const lvM = String(typeof p === "string" ? p : str(p?.name)).match(/lv\s*(\d+)/i);
      const lv = lvM ? Math.max(1, Math.round(Number(lvM[1]))) : 1;
      const c = (seen.get(nm) || 0) + 1;
      seen.set(nm, c);
      names.push(c === 1 ? nm : `${nm}${c}`);
      lvs.push(lv);
    });
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const name = names[i] || (i < 4 ? `\u6280\u80FD${i + 1}` : `\u5907\u7528\u6280${i - 3}`);
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
      buff_type: m?.buff_type || ""
    });
  }
  return out;
}
/** n=0（默认）返回全量解析结果；n>0 时用占位补足到 n 格（HUD 固定格子用） */
function buildItems(card, n = 0, imeta) {
  const bag = mergeBag(itemsFromCard(card), null, [], imeta);
  const list = bag.map((it) => ({ ...it }));
  if (n > 0) {
    for (let i = list.length; i < n; i++) {
      list.push({ name: i < 4 ? `\u7269\u54C1${i + 1}` : `\u5907\u7528\u7269${i - 3}`, count: 1, kind: "material", rarity: "common", heal: 20, price: 0 });
    }
  }
  return list;
}
function makeEntity(role, side, x, y, idx) {
  const card = role && typeof role === "object" ? role.parameterCardJson || role.parameter_card_json || role.card || null : null;
  const hp = num(role?.hp, NaN) || num(card?.hp, NaN) || (side === "enemy" ? 60 : 100);
  return {
    id: str(role?.id, `${side}_${idx}`),
    name: str(role?.name, side === "enemy" ? `\u91CE\u517D${idx + 1}` : `\u89D2\u8272${idx + 1}`),
    side,
    x,
    y,
    vx: 0,
    vy: 0,
    hp,
    maxHp: hp,
    atk: side === "enemy" ? 8 : 14,
    level: num(role?.level, 1) || 1,
    avatarPath: str(role?.avatarPath) || void 0,
    facing: 0,
    // 角度制：0=右 90=下 180=左 270=上
    cooldown: 0,
    alive: true
  };
}
function emptyState(ctx) {
  const card = ctx?.playerCard || {};
  return {
    phase: "select",
    version: 3,
    skillMeta: {},
    itemMeta: {},
    // v3：3000m 世界 + 米单位 + scale 元数据
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
      z_range: [...WORLD_Z_RANGE]
    },
    roles: Array.isArray(ctx?.roles) ? ctx.roles : [],
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
    regions: [],
    // ★ v4：由 initRegions() 填充（城镇 + 6 野区）
    town: null,
    // ★ v4：由 ensureTown() 填充（建筑 + 中立角色）
    result: null
  };
}
function spawnAnchor(s, minM, maxM) {
  const p = s.entities.find((e) => e.side === "player");
  const cx = p ? p.x : PLAYER_SPAWN.x;
  const cy = p ? p.y : PLAYER_SPAWN.y;
  const angle = rnd(0, Math.PI * 2);
  const distM = minM + rnd(0, maxM - minM);
  return { x: clampX(cx + Math.cos(angle) * distM), y: clampY(cy + Math.sin(angle) * distM) };
}
function spawnWave(s, wave) {
  const player = s.entities.find((e) => e.side === "player");
  const px = player?.x ?? PLAYER_SPAWN.x;
  const py = player?.y ?? PLAYER_SPAWN.y;
  const archs = s.map?.enemy_archetypes && s.map.enemy_archetypes.length ? s.map.enemy_archetypes : null;
  if (archs) {
    const wavesCfg = s.map?.waves && s.map.waves.length ? s.map.waves : [{ archetype: archs[0].id, count: 3, interval: 600 }];
    const pick = wavesCfg[Math.min(wave - 1, wavesCfg.length - 1)] || wavesCfg[0];
    const arch = archs.find((a) => a.id === pick.archetype) || archs[0];
    const count2 = Math.max(1, Math.min(6, num(pick.count, 3) + Math.floor(wave / 3)));
    for (let i = 0; i < count2; i++) {
      const angle = rnd(0, Math.PI * 2);
      const dist2 = 30 + rnd(0, 70);
      const e = makeEntity(
        { id: `${arch.id}_${wave}_${i}`, name: arch.name, hp: Math.round(arch.hp + (wave - 1) * 8), level: arch.lv },
        "enemy",
        clampX(px + Math.cos(angle) * dist2),
        clampY(py + Math.sin(angle) * dist2),
        i
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
    const angle = rnd(0, Math.PI * 2);
    const dist2 = 30 + rnd(0, 70);
    const e = makeEntity(
      { id: `enemy_${s.tick}_${i}`, name: `\u91CE\u517D ${i + 1}`, hp: 45 + wave * 12, level: wave },
      "enemy",
      clampX(px + Math.cos(angle) * dist2),
      clampY(py + Math.sin(angle) * dist2),
      i
    );
    e.atk = 7 + wave * 2;
    s.entities.push(e);
  }
  for (let i = 0; i < 2; i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist2 = 25 + rnd(0, 30);
    s.chests.push({ id: `chest_${s.tick}_${i}`, x: clampX(px + Math.cos(angle) * dist2), y: clampY(py + Math.sin(angle) * dist2), opened: false });
  }
  for (let i = 0; i < 3; i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist2 = 20 + rnd(0, 25);
    s.potions.push({ id: `potion_${s.tick}_${i}`, x: clampX(px + Math.cos(angle) * dist2), y: clampY(py + Math.sin(angle) * dist2), heal: 18 });
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
/** ★ game.md 打击特效：宿主侧推送 VFX 粒子（kind 与前端 drawVfxLayer 对齐） */
function pushVfx(s, p) {
  if (!Array.isArray(s.vfx)) s.vfx = [];
  s.vfx.push({ id: `vfx_${s.tick}_${Math.random().toString(36).slice(2, 6)}`, ...p });
  if (s.vfx.length > 60) s.vfx = s.vfx.slice(-60);
}
/**
 * ★ game.md「默认 4 个技能特效沿用」：按技能名归类特效
 *   远程类 → 火球(atk/ranged)  治疗类 → 治疗(heal)
 *   加强类 → 护盾(buff)        其余 → 冲斩(atk/melee)
 */
function skillFxKind(skill) {
  // ★ game.md 技能修改：显式 type/range 优先（atk+melee→冲斩刀光 / atk+ranged→火球 / heal→治疗环 / buff→护盾环）
  const t = String(skill?.type || "");
  if (t === "heal") return "heal";
  if (t === "buff") return "buff";
  if (t === "atk") return str(skill?.range, "melee") === "ranged" ? "ranged" : "melee";
  const n = String(skill?.name || "");
  if (/治|疗|愈|回复|恢复|回春|奶|复苏/.test(n)) return "heal";
  if (/盾|护|祝福|增益|强化|加攻|加防|buff/i.test(n)) return "buff";
  if (/球|箭|弹|术|咒|射|火|冰|雷|电|风|毒|远程/.test(n)) return "ranged";
  return "melee";
}
/** 按名字推断默认 type/range（参数卡同步过来的技能未显式配置时用） */
function inferSkillType(name) {
  const k = skillFxKind({ name });
  if (k === "heal") return { type: "heal", range: "melee" };
  if (k === "buff") return { type: "buff", range: "melee" };
  if (k === "ranged") return { type: "atk", range: "ranged" };
  return { type: "atk", range: "melee" };
}
/** game.md buff 类型：防御/攻击/持续伤害/晕眩/无敌/加速 */
const BUFF_TYPES = ["Defense", "Attack", "Sustained_Damage", "Stunning", "Invincible", "Accelerate"];
function damage(s, target, amount, attacker) {
  target.hp = clamp(target.hp - amount, 0, target.maxHp);
  // ★ game.md 普攻特效：被击者白闪 + 命中火花/爆炸；攻击者小跳（amount=0 的「未命中」占位不触发）
  if (amount > 0) {
    target.hitFlashMs = 250;
    pushVfx(s, { kind: "spark", entityId: target.id, x: target.x, y: target.y, life: 8, total: 8, color: "#ff5a5a" });
    pushVfx(s, { kind: "explosion", entityId: target.id, x: target.x, y: target.y, life: 6, total: 6, color: "#ff8c3a" });
    if (attacker) attacker.actionBobMs = 300;
    floater(s, `-${Math.round(amount)}`, target.x, target.y - 24);
  }
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    if (target.side === "enemy") {
      s.kills += 1;
      const bounty = target.bounty;
      const expGain = bounty?.exp != null ? Math.round(num(bounty.exp, 10)) : 8 + target.level * 4;
      const moneyGain = bounty?.money != null ? Math.round(num(bounty.money, 8)) : 5 + target.level * 3;
      gainPlayerExp(s, expGain);      // ★ 等级系统：经验累加 + 升级判定（满血满蓝重算）
      s.money += moneyGain;
      if (Math.random() < 0.5) {
        const drop = ["\u91CE\u517D\u76AE", "\u950B\u5229\u7684\u722A", "\u517D\u9AA8"][Math.floor(Math.random() * 3)];
        s.drops.push(drop);
      }
      pushEvent(s, `\u51FB\u8D25 ${target.name}\uFF0C\u83B7\u5F97 ${expGain} \u7ECF\u9A8C\u3001${moneyGain} \u91D1\u94B1`);
      grantPartyExp(s, expGain);
    } else {
      pushEvent(s, `${target.name} \u5012\u4E0B\u4E86`);
    }
  }
}
function moveTowards(e, tx, ty, speed) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = dx / d * speed;
  e.vy = dy / d * speed;
  if (Math.abs(dx) > 2) e.facing = dx > 0 ? 0 : 180;
}
function regionAt(x, y) {
  const p = { x, y };
  const town = WORLD_REGIONS[0];
  if (dist(p, town) <= town.r) return town;
  let best = WORLD_REGIONS[1];
  let bestD = Infinity;
  for (let i = 1; i < WORLD_REGIONS.length; i++) {
    const r = WORLD_REGIONS[i];
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}
function nearestWildRegion(x, y) {
  let best = WORLD_REGIONS[1];
  let bestD = Infinity;
  for (let i = 1; i < WORLD_REGIONS.length; i++) {
    const r = WORLD_REGIONS[i];
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}
const LOCAL_ENEMY_PREFIXES = ["mapmob_", "localmob_", "zone_"];
function isLocalEnemyId(id) {
  const v = str(id);
  return LOCAL_ENEMY_PREFIXES.some((p) => v.startsWith(p));
}
/* ============================================================
   敌人碰撞（宿主侧）
   ------------------------------------------------------------
   墙的位置只有 iframe 侧知道（tileset 的 blocked 属性 + 地图 JSON 都在前端解），
   所以前端随 tick 把压缩位图传过来（params.walkGrid，只在切图那一次）：
     walkGrid = { epoch, grid: { v, cols, rows, firstGid, blocked, vision } }
   拿到网格后，敌人在 step() 的积分阶段改走带碰撞的位移：
   撞墙不是原地抖，而是按「与期望方向最接近」的顺序试其余方向 → 沿墙绕行。
   没收到网格 / 解码失败 → 完全退化为原来的直线位移（行为与旧版一致，不会崩）。

   ⚠️ 本段是 entry.ts 同名段的 JS 镜像，也是 vue/src/collision.ts
      （stepWithAvoidance / resolveMove / isFreeAround）的内联镜像。
      宿主入口刻意不加任何 import：宿主加载器不一定支持相对/跨目录导入，
      一旦加载失败整个插件就挂，风险远大于这点重复。
      改算法时请同步三处：vue/src/collision.ts、entry.ts、entry.js。
   ============================================================ */

/** 宿主侧的最小网格（只需要挡住 / 不挡住；视野位图前端自己用） */
let enemyNav = null;
/** 已应用的网格世代号（幂等，避免每 tick 重复解码同一份 base64） */
let enemyNavEpoch = "";
/** 敌人碰撞半径（米）。比玩家的 0.4 略小：1 米宽的窄门里不至于卡住 */
const ENEMY_NAV_R = 0.38;

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 → 字节。不依赖 atob（宿主运行时未必有） */
function b64ToBytes(b64) {
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
function applyEnemyNavPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  const epoch = str(payload.epoch, "");
  if (epoch && epoch === enemyNavEpoch) return;
  const pkt = payload.grid;
  if (!pkt || num(pkt.v, 0) !== 1) return;
  const cols = num(pkt.cols, 0);
  const rows = num(pkt.rows, 0);
  const total = cols * rows;
  if (!(cols > 0) || !(rows > 0) || total > 4000000) return;
  const bytes = b64ToBytes(str(pkt.blocked, ""));
  if (!bytes || bytes.length !== total) {
    // 保持 ASCII：本文件按"Unicode 转义镜像"约定维护，未转义中文在旧运行时可能乱码
    console.warn("[field-survival] walkGrid payload decode failed, keeping previous grid:",
      bytes && bytes.length, total);
    return;
  }
  enemyNav = { cols, rows, blocked: bytes };
  enemyNavEpoch = epoch;
}

function navBlocked(g, gx, gz) {
  if (gx < 0 || gx >= g.cols || gz < 0 || gz >= g.rows) return true;   // 越界一律挡
  return g.blocked[gz * g.cols + gx] === 1;
}

/** 以 (x, y) 为中心、半径 r 的方内是否全可走（与玩家同一套判定） */
function navFree(g, x, y, r) {
  const toGx = (mx) => Math.floor(mx + g.cols / 2);
  const toGz = (my) => Math.floor(my + g.rows / 2);
  if (r <= 0) return !navBlocked(g, toGx(x), toGz(y));
  const left = toGx(x - r);
  const right = toGx(x + r);
  const top = toGz(y - r);
  const bottom = toGz(y + r);
  return !navBlocked(g, left, top) && !navBlocked(g, right, top) &&
         !navBlocked(g, left, bottom) && !navBlocked(g, right, bottom);
}

/** 分轴求解：X 被挡只丢 X、Z 继续 → 撞墙可沿墙滑行；起点已在墙里则放行（自解困） */
function navResolve(g, x, y, nx, ny, r) {
  if (!navFree(g, x, y, r)) return { x: nx, y: ny };
  let outX = x;
  let outY = y;
  if (navFree(g, nx, y, r)) outX = nx;
  if (navFree(g, outX, ny, r)) outY = ny;
  return { x: outX, y: outY };
}

/** 八向候选（顺序即"优先直行，然后偏 45°，最后偏 90°"） */
const NAV_DIRS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * 带局部避障的一步位移：期望方向优先，被挡就按点积（方向相似度）试其余方向。
 * 不做 A*（几十只怪每 tick 各跑一次 A* 开销太大）；效果是沿墙绕行而不是原地抖。
 */
function navStep(g, x, y, dx, dy, step, r) {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return { x, y };
  const ux = dx / len;
  const uy = dy / len;
  const order = NAV_DIRS.map(([ax, ay]) => {
    const l = Math.hypot(ax, ay);
    const nx = ax / l;
    const ny = ay / l;
    return { nx, ny, dot: nx * ux + ny * uy };
  }).filter((c) => c.dot > -0.35)                 // 不往回走
    .sort((a, b) => b.dot - a.dot);
  for (const c of order) {
    const nx = x + c.nx * step;
    const ny = y + c.ny * step;
    if (navFree(g, nx, ny, r)) return { x: nx, y: ny };
  }
  return navResolve(g, x, y, x + ux * step, y + uy * step, r);
}

/** 环状 BFS 找最近可站格（刷点压在墙上时用） */
function navNearestFree(g, x, y, r, maxRing = 8) {
  const cgx = Math.floor(x + g.cols / 2);
  const cgz = Math.floor(y + g.rows / 2);
  const center = (gx, gz) => ({ x: gx - g.cols / 2 + 0.5, y: gz - g.rows / 2 + 0.5 });
  if (navFree(g, x, y, r)) return { x, y };
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let d = -ring; d <= ring; d++) {
      const cand = [
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
function moveEnemyCollide(e, dx, dy) {
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
function unstickEnemies(s) {
  if (!enemyNav) return;
  for (const e of s.entities) {
    if (e.side !== "enemy" || !e.alive) continue;
    if (navFree(enemyNav, e.x, e.y, ENEMY_NAV_R)) continue;
    const c = navNearestFree(enemyNav, e.x, e.y, ENEMY_NAV_R);
    if (!c) continue;
    const badHomeX = "homeX" in e && !navFree(enemyNav, num(e.homeX), c.y, ENEMY_NAV_R);
    const badHomeY = "homeY" in e && !navFree(enemyNav, c.x, num(e.homeY), ENEMY_NAV_R);
    e.x = c.x;
    e.y = c.y;
    if (badHomeX) e.homeX = c.x;
    if (badHomeY) e.homeY = c.y;
  }
}

function mapBound(s) {
  const b = s.mapBounds;
  if (b && num(b.lx, 0) > 0 && num(b.ly, 0) > 0) return { lx: num(b.lx, 0), ly: num(b.ly, 0) };
  return { lx: WORLD_X_RANGE[1] - 10, ly: WORLD_Z_RANGE[1] - 10 };
}
function clampToBound(s, x, y) {
  const b = mapBound(s);
  return { x: clamp(x, -b.lx, b.lx), y: clamp(y, -b.ly, b.ly) };
}
function regionOutOfMap(s, r) {
  const b = s.mapBounds;
  if (!b || !(num(b.lx, 0) > 0) || !(num(b.ly, 0) > 0)) return false;
  return Math.abs(r.x) - r.r >= num(b.lx, 0) || Math.abs(r.y) - r.r >= num(b.ly, 0);
}
function applyLocalEnemies(s, payload) {
  if (!payload || typeof payload !== "object") return 0;
  const epoch = num(payload.epoch, 0);
  if (epoch > 0 && num(s.localMobsEpoch, 0) === epoch) return 0;
  const b = payload.bounds || {};
  const lx = num(b.lx, 0);
  const ly = num(b.ly, 0);
  if (lx > 0 && ly > 0) s.mapBounds = { lx, ly };
  const list = Array.isArray(payload.list) ? payload.list : [];
  s.entities = s.entities.filter((e) => !(e.side === "enemy" && isLocalEnemyId(e.id)));
  if (lx > 0 && ly > 0) {
    s.entities = s.entities.filter(
      (e) => !(e.side === "enemy" && !isLocalEnemyId(e.id) && (Math.abs(e.x) > lx || Math.abs(e.y) > ly))
    );
  }
  let built = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const side = str(raw.side);
    if (side && side !== "enemy") continue;
    if (raw.alive === false) continue;
    const id = str(raw.id);
    if (!id) continue;
    const lv = Math.max(1, Math.round(num(raw.level, 1)));
    const maxHp = Math.max(1, Math.round(num(raw.maxHp, num(raw.hp, 60)) || 60));
    const at = clampToBound(s, num(raw.x, 0), num(raw.y, 0));
    const e = makeEntity({ id, name: str(raw.name, "\u91CE\u602A"), hp: maxHp, level: lv }, "enemy", at.x, at.y, built);
    const ex = e;
    e.hp = clamp(Math.round(num(raw.hp, maxHp)), 1, maxHp);
    e.maxHp = maxHp;
    e.atk = Math.max(1, Math.round(num(raw.atk, e.atk)));
    e.facing = num(raw.facing, e.facing);
    e.cooldown = Math.max(0, Math.round(num(raw.cooldown, 0)));
    const home = clampToBound(s, num(raw.homeX, at.x), num(raw.homeY, at.y));
    ex.isLocal = true;
    ex.regionId = str(raw.regionId, "local");
    ex.homeX = home.x;
    ex.homeY = home.y;
    ex.aiState = "idle";
    ex.wanderTimer = 0;
    if (raw.bounty && typeof raw.bounty === "object") ex.bounty = { ...raw.bounty };
    s.entities.push(e);
    built += 1;
  }
  s.localMobsEpoch = epoch > 0 ? epoch : num(s.localMobsEpoch, 0);
  return built;
}
const REGION_MOB_NAMES = {
  wood: ["\u5DE8\u72FC", "\u54E5\u5E03\u6797\u65A5\u5019"],
  shore: ["\u6BD2\u86C7", "\u8759\u8760"],
  mine: ["\u9AB7\u9AC5\u5175", "\u54E5\u5E03\u6797\u65A5\u5019"],
  ruin: ["\u9AB7\u9AC5\u5175", "\u8352\u91CE\u6E38\u8361\u8005"],
  marsh: ["\u6BD2\u86C7", "\u5DE8\u72FC"],
  wild: ["\u54E5\u5E03\u6797\u65A5\u5019", "\u5DE8\u72FC", "\u8352\u91CE\u6E38\u8361\u8005"]
};
const MOB_PRESETS = {
  "\u54E5\u5E03\u6797\u65A5\u5019": { hp: 30, atk: 6 },
  "\u5DE8\u72FC": { hp: 60, atk: 10 },
  "\u6BD2\u86C7": { hp: 25, atk: 8 },
  "\u8759\u8760": { hp: 20, atk: 5 },
  "\u9AB7\u9AC5\u5175": { hp: 50, atk: 12 },
  "\u8352\u91CE\u6E38\u8361\u8005": { hp: 40, atk: 6 }
};
let _mobSeq = 0;
function initRegions(s) {
  s.regions = WORLD_REGIONS.map((r) => ({
    id: r.id,
    name: r.name,
    short: r.short,
    kind: r.kind,
    x: r.x,
    y: r.y,
    r: r.r,
    safe: r.safe,
    lv: r.lv,
    mobs: r.mobs,
    desc: r.desc,
    aliveCount: 0,
    playerInside: false,
    leftTick: -1,
    nextSpawnTick: -1,
    spawnCount: 0
  }));
}
function countAliveInRegion(s, regionId) {
  let n = 0;
  for (const e of s.entities) {
    if (e.side === "enemy" && e.alive !== false && e.regionId === regionId) n++;
  }
  return n;
}
function regionSpawnPoint(s, region) {
  const player = s.entities.find((e) => e.side === "player");
  const town = WORLD_REGIONS[0];
  let x = region.x, y = region.y;
  for (let t = 0; t < 8; t++) {
    const a = rnd(0, Math.PI * 2);
    const d = region.r * (0.35 + rnd(0, 0.55));
    const cb = clampToBound(s, region.x + Math.cos(a) * d, region.y + Math.sin(a) * d);
    const cx = clampX(cb.x);
    const cy = clampY(cb.y);
    if (Math.hypot(cx - town.x, cy - town.y) < town.r + TOWN_SPAWN_BUFFER_M) continue;
    if (player && player.alive && Math.hypot(cx - player.x, cy - player.y) < 12) continue;
    x = cx;
    y = cy;
    break;
  }
  return { x, y };
}
function spawnRegionMobs(s, region, n) {
  const names = REGION_MOB_NAMES[region.id] || ["\u8352\u91CE\u6E38\u8361\u8005"];
  const archs = s.map?.enemy_archetypes && s.map.enemy_archetypes.length ? s.map.enemy_archetypes : null;
  const lv = Math.max(1, region.lv);
  for (let i = 0; i < n; i++) {
    const name = names[(_mobSeq + i) % names.length];
    const at = regionSpawnPoint(s, region);
    const preset = MOB_PRESETS[name] || { hp: 40, atk: 6 };
    const arch = archs ? archs[(_mobSeq + i) % archs.length] : null;
    const hp = Math.round((arch ? num(arch.hp, preset.hp) * 0.6 : preset.hp) + (lv - 1) * 10);
    const e = makeEntity({ id: `mob_${region.id}_${_mobSeq++}`, name, hp, level: lv }, "enemy", at.x, at.y, i);
    e.atk = Math.round((arch ? num(arch.atk, preset.atk) * 0.6 : preset.atk) + (lv - 1) * 2);
    e.regionId = region.id;
    e.homeX = at.x;
    e.homeY = at.y;
    e.aiState = "idle";
    e.wanderTimer = 0;
    e.bounty = arch && arch.bounty ? { ...arch.bounty } : { exp: 8 + lv * 4, money: 5 + lv * 3 };
    s.entities.push(e);
  }
}
function regionTick(s, player) {
  if (!Array.isArray(s.regions) || !s.regions.length) initRegions(s);
  if (!s.town || !s.town.buildings) ensureTown(s);
  const cur = regionAt(player.x, player.y);
  for (const r of s.regions) {
    const inside = r.id === cur.id;
    r.aliveCount = countAliveInRegion(s, r.id);
    if (inside) {
      r.playerInside = true;
      r.leftTick = -1;
      r.nextSpawnTick = -1;
      continue;
    }
    const wasInside = r.playerInside;
    r.playerInside = false;
    if (r.safe) continue;
    if (regionOutOfMap(s, r)) {
      r.leftTick = -1;
      r.nextSpawnTick = -1;
      continue;
    }
    if (wasInside || r.nextSpawnTick < 0) {
      r.leftTick = s.tick;
      r.nextSpawnTick = s.tick + REGION_RESPAWN_TICKS;
      continue;
    }
    if (s.tick >= r.nextSpawnTick) {
      const gap = Math.max(0, r.mobs - r.aliveCount);
      if (gap > 0) {
        spawnRegionMobs(s, r, gap);
        r.spawnCount += 1;
        pushEvent(s, `\u300C${r.name}\u300D\u91CD\u65B0\u805A\u96C6\u4E86 ${gap} \u53EA\u91CE\u602A`);
      }
      r.nextSpawnTick = s.tick + REGION_RESPAWN_TICKS;
    }
  }
}
const TOWN_BUILDINGS = [
  { kind: "inn", name: "\u65C5\u5E97", x: -46, y: -42, w: 6, h: 7 },
  { kind: "shop", name: "\u6742\u8D27\u94FA", x: 46, y: -38, w: 5, h: 6 },
  { kind: "house", name: "\u6C11\u5C45", x: -78, y: 22, w: 4, h: 5 },
  { kind: "house", name: "\u6C11\u5C45", x: -50, y: 62, w: 4, h: 5 },
  { kind: "house", name: "\u6C11\u5C45", x: 56, y: 30, w: 4, h: 5 },
  { kind: "house", name: "\u6C11\u5C45", x: 82, y: -8, w: 4, h: 5 },
  { kind: "house", name: "\u6C11\u5C45", x: 0, y: -78, w: 5, h: 6 },
  { kind: "well", name: "\u6C34\u4E95", x: 0, y: 34, w: 2, h: 2 }
];
const TOWN_NPCS = [
  { name: "\u9547\u957F \u8001\u767D", x: -20, y: 14 },
  { name: "\u94C1\u5320 \u5927\u58EE", x: 30, y: -16 },
  { name: "\u5546\u4EBA \u963F\u798F", x: 20, y: 26 },
  { name: "\u5B88\u536B \u77F3\u5CA9", x: -32, y: -14 }
];
function ensureTown(s) {
  const town = WORLD_REGIONS[0];
  if (!s.town || !s.town.buildings) {
    s.town = {
      id: town.id,
      name: town.name,
      x: town.x,
      y: town.y,
      r: town.r,
      safe: true,
      buildings: TOWN_BUILDINGS.map((b, i) => ({ ...b, id: `b_${i}` })),
      npcs: TOWN_NPCS.map((n, i) => ({ id: `npc_${i}`, ...n }))
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
  const speed = MOVE_SPEED_M;
  const player = s.entities.find((e) => e.side === "player");
  if (!player || !player.alive) return;
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
      player.vx = dx / len * speed;
      player.vy = dy / len * speed;
      player.facing = dx > 0 ? 0 : dx < 0 ? 180 : dy > 0 ? 90 : 270;
    } else if (input?.moveTo) {
      const tx = num(input.moveTo.x, player.x);
      const ty = num(input.moveTo.y, player.y);
      if (dist(player, { x: tx, y: ty }) > 1) moveTowards(player, tx, ty, speed);
      else {
        player.vx = 0;
        player.vy = 0;
      }
    } else {
      player.vx = 0;
      player.vy = 0;
    }
  }
  const enemies = s.entities.filter((e) => e.side === "enemy" && e.alive);
  const partyIds = Array.isArray(s.partyIds) ? s.partyIds : [];
  const allies = s.entities.filter((e) => e.side === "ally" && e.alive && partyIds.indexOf(e.id) >= 0);
  allies.forEach((a, i) => {
    // ★ game.md：只有已威胁玩家（进入玩家身边 4m）的敌人才出手；目标选择锚点=玩家
    const target = enemies
      .filter((e) => dist(player, e) < ALLY_ENGAGE_M)
      .reduce((best, e) => (!best || dist(player, e) < dist(player, best) ? e : best), null);
    const anchor = {
      x: player.x + Math.cos(i / Math.max(1, allies.length) * Math.PI * 2) * ALLY_FOLLOW_GAP_M,
      y: player.y + Math.sin(i / Math.max(1, allies.length) * Math.PI * 2) * ALLY_FOLLOW_GAP_M
    };
    if (target) moveTowards(a, target.x, target.y, speed * 0.92);
    else moveTowards(a, anchor.x, anchor.y, speed * 0.8);
    if (target && dist(a, target) < ALLY_ATK_M && a.cooldown <= 0) {
      damage(s, target, a.atk, a);
      a.cooldown = 30;
    }
  });
  enemies.forEach((e) => {
    const ex = e;
    const prey = [player, ...allies].filter((t) => t.alive).reduce((best, t) => !best || dist(e, t) < dist(e, best) ? t : best, null);
    const home = { x: num(ex.homeX, e.x), y: num(ex.homeY, e.y) };
    const preyIn = prey ? dist(e, prey) : Infinity;
    if (ex.aiState === "chase") {
      if (!prey || preyIn > MOB_DISENGAGE_M) {
        ex.aiState = "return";
        e.vx = 0;
        e.vy = 0;
        return;
      }
      if (preyIn > MOB_ATK_M) {
        const t = clampToBound(s, prey.x, prey.y);
        moveTowards(e, t.x, t.y, speed * 0.72);
        return;
      }
      e.vx = 0;
      e.vy = 0;
      if (e.cooldown <= 0) {
        damage(s, prey, e.atk, e);
        e.cooldown = 45;
      }
      return;
    }
    if (prey && preyIn <= MOB_DETECT_M) {
      ex.aiState = "chase";
      if (preyIn > MOB_ATK_M) {
        const t = clampToBound(s, prey.x, prey.y);
        moveTowards(e, t.x, t.y, speed * 0.72);
        return;
      }
      e.vx = 0;
      e.vy = 0;
      if (e.cooldown <= 0) {
        damage(s, prey, e.atk, e);
        e.cooldown = 45;
      }
      return;
    }
    if (ex.aiState !== "idle" && ex.aiState !== "npc") {
      ex.aiState = "idle";
      ex.wanderTimer = 0;
    }
    if (dist(e, home) > MOB_LEASH_R_M) {
      moveTowards(e, home.x, home.y, speed * 0.55);
      ex.wanderTimer = 0;
      return;
    }
    if (!(num(ex.wanderTimer, 0) > 0)) {
      const wa = rnd(0, Math.PI * 2);
      const wr = rnd(2, MOB_WANDER_R_M);
      const w = clampToBound(s, home.x + Math.cos(wa) * wr, home.y + Math.sin(wa) * wr);
      ex.wanderX = w.x;
      ex.wanderY = w.y;
      ex.wanderTimer = Math.round(rnd(30, 90));
    }
    ex.wanderTimer = num(ex.wanderTimer, 0) - 1;
    const wx = num(ex.wanderX, home.x);
    const wy = num(ex.wanderY, home.y);
    if (Math.hypot(wx - e.x, wy - e.y) > 1) moveTowards(e, wx, wy, speed * 0.35);
    else {
      e.vx = 0;
      e.vy = 0;
    }
  });
  unstickEnemies(s);
  s.entities.forEach((e) => {
    if (e.cooldown > 0) e.cooldown -= 1;
    // ★ 打击特效衰减：hitFlashMs / actionBobMs 每 tick -100ms（与 dev-host 同步）
    if (e.hitFlashMs > 0) e.hitFlashMs = Math.max(0, e.hitFlashMs - 100);
    if (e.actionBobMs > 0) e.actionBobMs = Math.max(0, e.actionBobMs - 100);
    const nx = e.x + e.vx * TICK_DT_S;
    const ny = e.y + e.vy * TICK_DT_S;
    if (e.side === "enemy" && e.isLocal) {
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
  s.skills.forEach((k) => {
    if (k.cdLeft > 0) k.cdLeft -= 1;
  });
  s.floaters = s.floaters.map((f) => ({ ...f, life: f.life - 1 })).filter((f) => f.life > 0);
  // ★ 打击特效衰减：vfx life 每 tick -1
  if (Array.isArray(s.vfx) && s.vfx.length) s.vfx = s.vfx.filter((v) => { v.life -= 1; return v.life > 0; });
  s.chests.forEach((c) => {
    if (c.opened) return;
    if (dist(player, c) < CHEST_PICKUP_M) {
      c.opened = true;
      const loot = c.loot;
      const expGain = loot?.exp != null ? Math.round(num(loot.exp, 15)) : 12 + Math.floor(rnd(0, 10));
      const moneyGain = loot?.money != null ? Math.round(num(loot.money, 12)) : 15 + Math.floor(rnd(0, 20));
      const drop = loot?.item || ["\u751F\u9508\u7684\u94A5\u5319", "\u5E72\u7CAE", "\u8367\u5149\u77F3"][Math.floor(Math.random() * 3)];
      gainPlayerExp(s, expGain);      // ★ 等级系统：开箱经验同样走升级判定
      s.money += moneyGain;
      s.drops.push(drop);
      floater(s, `\u5B9D\u7BB1 +${expGain}exp`, c.x, c.y);
      pushEvent(s, `\u6253\u5F00\u5B9D\u7BB1\uFF1A${drop}\uFF0C+${expGain} \u7ECF\u9A8C\uFF0C+${moneyGain} \u91D1\u94B1`);
    }
  });
  s.potions = s.potions.filter((p) => {
    if (dist(player, p) >= POTION_PICKUP_M) return true;
    const before = player.hp;
    player.hp = clamp(player.hp + p.heal, 0, player.maxHp);
    floater(s, `+${Math.round(player.hp - before)}`, player.x, player.y - 24);
    pushEvent(s, `\u62FE\u53D6\u8840\u74F6\uFF0C\u6062\u590D ${Math.round(player.hp - before)} \u70B9\u751F\u547D`);
    return false;
  });
  s.entities = s.entities.filter((e) => !(e.side === "enemy" && e.alive === false));
  regionTick(s, player);
  if (!player.alive && s.phase === "playing") {
    s.phase = "over";
    s.result = {
      reason: "death",
      exp: s.exp,
      money: s.money,
      drops: [...s.drops],
      kills: s.kills,
      survivedTicks: s.tick
    };
    pushEvent(s, "\u4F60\u5012\u4E0B\u4E86\u2026\u2026");
  }
}
const SYS_DATA_KEY = "sys_state";
// ★ game.md 对话功能：AI 故事角色位置/地图信息的持久化键（写入 t_plugin_session_data 表）
const AI_STORY_ROLES_KEY = "ai_story_roles";
const SYS_PERSIST_EVERY_TICKS = 20;
const RARITY_PRICE = { common: 8, fine: 22, rare: 60, epic: 180, legend: 520 };
const RARITY_LIST = ["common", "fine", "rare", "epic", "legend"];
const KIND_LIST = ["consumable", "material", "equipment", "skill_book", "quest"];
const BUILTIN_SHOP_GOODS = [
  { id: "b_huiqi", name: "\u56DE\u6C14\u6563", price: 30, kind: "consumable", rarity: "common", heal: 30, desc: "\u6062\u590D 30 \u70B9\u751F\u547D", from: "builtin" },
  { id: "b_jijiu", name: "\u6025\u6551\u5305", price: 60, kind: "consumable", rarity: "fine", heal: 60, desc: "\u6062\u590D 60 \u70B9\u751F\u547D", from: "builtin" },
  { id: "b_ganliang", name: "\u5E72\u7CAE", price: 12, kind: "consumable", rarity: "common", heal: 14, desc: "\u6062\u590D 14 \u70B9\u751F\u547D", from: "builtin" },
  { id: "b_zhixuecao", name: "\u6B62\u8840\u8349", price: 20, kind: "material", rarity: "common", heal: 0, desc: "\u5E38\u89C1\u8349\u836F\uFF0C\u53EF\u5165\u836F", from: "builtin" },
  { id: "b_yinguang", name: "\u8367\u5149\u77F3", price: 45, kind: "material", rarity: "fine", heal: 0, desc: "\u6CDB\u7740\u5FAE\u5149\u7684\u77FF\u77F3", from: "builtin" },
  { id: "b_duanjian", name: "\u7CBE\u94A2\u77ED\u5251", price: 220, kind: "equipment", rarity: "rare", heal: 0, desc: "\u653B\u51FB +6", from: "builtin" },
  { id: "b_hufu", name: "\u76AE\u7532\u62A4\u7B26", price: 160, kind: "equipment", rarity: "fine", heal: 0, desc: "\u9632\u5FA1 +4", from: "builtin" },
  { id: "b_xinde", name: "\u57FA\u7840\u6280\u80FD\u5FC3\u5F97", price: 320, kind: "skill_book", rarity: "rare", heal: 0, desc: "\u4E60\u5F97\u4E00\u9879\u57FA\u7840\u6280\u80FD", from: "builtin" }
];
function normRarity(v) {
  const r = String(v ?? "").toLowerCase().trim();
  return RARITY_LIST.indexOf(r) >= 0 ? r : "common";
}
function guessKind(name) {
  const n = String(name || "");
  if (/技能|秘籍|心得|卷轴|心法|功法/.test(n)) return "skill_book";
  if (/剑|刀|枪|弓|甲|盾|护符|戒|铠|斧|杖|靴/.test(n)) return "equipment";
  if (/丹|散|药|水|包|粮|汤|肉|鱼|果|酒|茶|露/.test(n)) return "consumable";
  return "material";
}
function defaultHeal(name, kind) {
  if (kind !== "consumable") return 0;
  const n = String(name || "");
  if (/急救|大补|灵药|仙丹|回天/.test(n)) return 60;
  if (/回气|伤药|灵泉|清心|愈合/.test(n)) return 30;
  if (/干粮|粮|肉|果|汤|鱼/.test(n)) return 14;
  return 20;
}
/** 物品名归一：剥离「×N」数量、「（描述…）」后缀、对象残留与货币尾注，限长 20。
 *  服务器参数卡的物品是 AI 生成的自由文本（如「银鲤×3（钓鱼累积，单尾800金）」），
 *  展示名与匹配键必须走同一归一器，否则会出现「背包里没有该物品」的误判。 */
function cleanName(v) {
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
function itemKey(v) {
  return cleanName(v).toLowerCase();
}
/** 展示名/参数名可能写法不同（带描述 vs 不带），匹配一律走归一键 */
function sameName(a, b) {
  const ka = itemKey(a);
  return !!ka && ka === itemKey(b);
}
function parseItemRaw(raw) {
  if (raw && typeof raw === "object") {
    const name2 = cleanName(raw);
    if (!name2) return { name: "", count: 0, kind: "material", rarity: "common", heal: 0, price: 0 };
    const kind2 = KIND_LIST.indexOf(String(raw.kind)) >= 0 ? String(raw.kind) : guessKind(name2);
    return {
      name: name2,
      count: Math.max(1, Math.round(num(raw.count, 1))),
      kind: kind2,
      rarity: normRarity(raw.rarity),
      heal: Math.max(0, Math.round(num(raw.heal, defaultHeal(name2, kind2)))),
      price: Math.max(0, Math.round(num(raw.price, 0))),
      desc: str(raw.desc, "") || void 0
    };
  }
  const text = str(raw).trim();
  if (!text) return { name: "", count: 0, kind: "material", rarity: "common", heal: 0, price: 0 };
  // 数量：任意位置的 ×N / xN / *N（取第一个）
  const cnt = text.match(/[×xX*]\s*(\d+)/);
  const count = cnt ? Math.max(1, parseInt(cnt[1], 10) || 1) : 1;
  // 价格：文本里首个「NNN金」
  const pm = text.match(/(\d+)\s*金/);
  const price = pm ? Math.max(0, parseInt(pm[1], 10) || 0) : 0;
  // 描述：首个括号组
  const dm = text.match(/[（(]([^）)]*)[）)]/);
  const desc = dm ? dm[1].trim() : void 0;
  const name2 = cleanName(text);
  if (!name2) return { name: "", count: 0, kind: "material", rarity: "common", heal: 0, price: 0 };
  const kind2 = guessKind(name2);
  const rm = desc ? desc.match(/史诗|传说|稀有|精良/) : null;
  const rarity = rm ? normRarity({ 精良: "fine", 稀有: "rare", 史诗: "epic", 传说: "legend" }[rm[0]]) : "common";
  return { name: name2, count, kind: kind2, rarity, heal: defaultHeal(name2, kind2), price, desc };
}
function itemsFromCard(card) {
  const arr = Array.isArray(card?.items) ? card.items : [];
  const out = [];
  // 参数卡物品条目可能是顿号串（「银鲤×3（…）、银鲤×4」）→ 先按分隔符拆（括号深度感知）再解析
  arr.forEach((x) => {
    if (typeof x === "string") {
      splitSkillList(x).forEach((p) => {
        const it = parseItemRaw(p);
        if (it.name && it.count > 0) out.push(it);
      });
    } else {
      const it = parseItemRaw(x);
      if (it.name && it.count > 0) out.push(it);
    }
  });
  return out;
}
function mergeBag(raw, meta, order, imeta) {
  const map = /* @__PURE__ */ new Map();
  raw.forEach((it) => {
    const key = itemKey(it.name);
    if (!key) return;
    const m = meta ? meta[it.name] : void 0;
    // ★ game.md 物品修改：战斗参数元数据（itemMeta，按展示名存）合并进背包项
    const im = imeta ? (imeta[it.name] || imeta[key]) : void 0;
    const bt = inferItemType(it.name, it.kind);
    const cur = map.get(key);
    if (cur) {
      cur.count += it.count;
      return;
    }
    map.set(key, {
      name: it.name,
      count: it.count,
      quantity: it.count,
      kind: it.kind !== "material" || !m ? it.kind : m.kind,
      rarity: it.rarity !== "common" || !m ? it.rarity : m.rarity,
      heal: it.heal || (m ? m.heal : 0) || defaultHeal(it.name, it.kind),
      price: it.price || (m ? m.price : 0),
      desc: im?.description || it.desc || (m ? m.desc : void 0),
      power: num(im?.power, it.kind === "equipment" ? 10 : 0),
      cost: num(im?.cost, 0),
      cd: Math.max(0, num(im?.cd, 0)),
      cdLeft: 0,
      type: im?.type || bt.type,
      range: im?.range || bt.range,
      lv: Math.max(1, num(im?.lv, 1)),
      buff_type: im?.buff_type || "",
      durability: num(im?.durability, -1),
      durabilityLeft: num(im?.durabilityLeft, num(im?.durability, -1)),
      attribute_type: im && "attribute_type" in im ? im.attribute_type : inferItemAttrType(it.name),
      attribute_value: num(im?.attribute_value, defaultItemAttrValue(it.name))
    });
  });
  const list = Array.from(map.values());
  const idx = /* @__PURE__ */ new Map();
  (order || []).forEach((n, i) => idx.set(itemKey(n), i));
  return list.sort((a, b) => {
    const ia = idx.has(itemKey(a.name)) ? idx.get(itemKey(a.name)) : 9999;
    const ib = idx.has(itemKey(b.name)) ? idx.get(itemKey(b.name)) : 9999;
    return ia - ib;
  });
}
function serializeBag(bag, cardItems) {
  // ★ game.md quantity/description：重写参数卡时保留原条目描述注记（「银鲤×3（钓鱼累积，暂未售出，单尾800金）」→「银鲤×7（钓鱼累积…）」）
  if (Array.isArray(cardItems)) {
    const flat = [];
    cardItems.forEach((x) => {
      if (typeof x === "string") splitSkillList(x).forEach((p) => { if (cleanName(p)) flat.push(p.trim()); });
      else flat.push(x);
    });
    const used = /* @__PURE__ */ new Set();
    const out = [];
    flat.forEach((x) => {
      const p = parseItemRaw(x);
      if (!p.name) return;
      const b = bag.find((y) => sameName(y.name, p.name) && !used.has(itemKey(y.name)));
      if (!b || !(b.count > 0)) return;
      used.add(itemKey(b.name));
      const d = p.desc ? `\uFF08${p.desc}\uFF09` : "";
      out.push(b.count > 1 ? `${b.name}\xD7${b.count}${d}` : d ? `${b.name}${d}` : b.name);
    });
    bag.forEach((b) => {
      if (!b.count || used.has(itemKey(b.name))) return;
      used.add(itemKey(b.name));
      const d = b.desc ? `\uFF08${b.desc}\uFF09` : "";
      out.push(b.count > 1 ? `${b.name}\xD7${b.count}${d}` : d ? `${b.name}${d}` : b.name);
    });
    return out;
  }
  return bag.filter((i) => i.name && i.count > 0).map((i) => i.count > 1 ? `${i.name}\xD7${i.count}` : i.name);
}
function sellPrice(it) {
  if (it.price > 0) return Math.max(1, Math.round(it.price * 0.4));
  const base = RARITY_PRICE[it.rarity] || RARITY_PRICE.common;
  const k = it.kind === "equipment" ? 1.5 : it.kind === "skill_book" ? 2 : 1;
  return Math.max(1, Math.round(base * k));
}
/** ★ game.md 背包物品：特效类型 [atk, heal, buff, attribute]（attribute = 纯属性点，使用不消耗） */
const ITEM_TYPES = ["atk", "heal", "buff", "attribute"];
/** ★ game.md attribute_type：Defense/Attack/Life/Blue（放背包即被动加成） */
const ITEM_ATTR_TYPES = ["Defense", "Attack", "Life", "Blue"];
/** 按名/品类推断默认 type/range（未显式修改过的物品走推断） */
function inferItemType(name, kind) {
  const n = String(name || "");
  if (kind === "skill_book") return { type: "buff", range: "melee" };
  if (kind === "equipment" || /刀|剑|枪|弓|弩|斧|杖|匕|爪|锤/.test(n)) return { type: "atk", range: /弓|弩|杖/.test(n) ? "ranged" : "melee" };
  if (/力量|攻击|加攻/.test(n)) return { type: "attribute", range: "melee" };
  return { type: "heal", range: "melee" };
}
/** 按名推断被动属性类型（「力量+4」→ Attack 之类） */
function inferItemAttrType(name) {
  const n = String(name || "");
  if (/防御|护甲|加防|体魄|磐/.test(n)) return "Defense";
  if (/蓝|法力|灵力|魔力/.test(n)) return "Blue";
  if (/生命|血量|体质|体魄/.test(n)) return "Life";
  if (/力量|攻击|加攻/.test(n)) return "Attack";
  return "";
}
/** 按名推断被动属性数值（「力量+4」→ 4；「魔力+10」→ 10） */
function defaultItemAttrValue(name) {
  const m = String(name || "").match(/[＋+]\s*(\d+)/);
  return m ? Math.round(Number(m[1])) : 0;
}
/** 耐久剩余写回 itemMeta（背包每次从参数卡重建，durabilityLeft 必须落持久层） */
function setItemDurLeft(s, name, v) {
  const cur = (s.itemMeta || {})[name] || {};
  s.itemMeta = { ...s.itemMeta || {}, [name]: { ...cur, durabilityLeft: v } };
}
/** ★ game.md 背包被动加成：bag 中 attribute_type ∈ Defense/Attack/Life/Blue 的物品按 attribute_value 累加 */
function bagAttributeBonus(s) {
  const card = s.playerCard || {};
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const bonus = { Defense: 0, Attack: 0, Life: 0, Blue: 0 };
  bag.forEach((it) => {
    const v = Math.round(num(it.attribute_value, 0));
    if (v !== 0 && ITEM_ATTR_TYPES.indexOf(it.attribute_type) >= 0) bonus[it.attribute_type] += v;
  });
  return bonus;
}
/* ============================================================================
   ★ game.md 等级系统（满血满蓝公式 / 经验阈值 / 升级 / 角色卡同步）
   满血HP = 100 + 等级*10 + 道具血量加成 + 技能永久血量加成
   满蓝MP = 100 + 等级*10 + 道具蓝量加成 + 技能永久蓝量加成
   攻击   = 10  + 等级*10 + 道具攻击加成 + 技能永久攻击加成
   防御   = 1   + 等级*10 + 道具防御加成 + 技能永久防御加成
   升级   = exp ≥ 当前level*100 → level+1 / 扣阈值保留溢出 / 阈值 = 新level*100 / 重算满血满蓝
   ========================================================================== */
const STAT_BASE = { hp: 100, mp: 100, atk: 10, def: 1 };
const STAT_PER_LEVEL = 10;
const PLAYER_ATTR_KEYS = ["Life", "Blue", "Attack", "Defense"];

/** 技能永久加成点数：skillMeta[技能].perm_* 或参数卡 perm_bonus / permanent_attributes */
function permAttributeBonus(s) {
  const out = { Life: 0, Blue: 0, Attack: 0, Defense: 0 };
  const card = s.playerCard || {};
  const add = (k, v) => { if (PLAYER_ATTR_KEYS.indexOf(k) >= 0) out[k] += Math.round(num(v, 0)); };
  ["permanent_attributes", "perm_bonus", "perm_attr", "attribute_bonus"].forEach((key) => {
    const m = card[key];
    if (m && typeof m === "object") Object.keys(m).forEach((k) => add(k, m[k]));
  });
  const meta = s.skillMeta || {};
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
function playerMaxStats(s, level) {
  const me = playerEntity(s);
  const lv = Math.max(1, Math.round(num(level, num(me && me.level, 1))));
  const bag = bagAttributeBonus(s);
  const perm = permAttributeBonus(s);
  const sum = (k) => Math.round(num(bag[k], 0) + num(perm[k], 0));
  return {
    maxHp: Math.max(1, STAT_BASE.hp + lv * STAT_PER_LEVEL + sum("Life")),
    maxMp: Math.max(0, STAT_BASE.mp + lv * STAT_PER_LEVEL + sum("Blue")),
    atk: Math.max(1, STAT_BASE.atk + lv * STAT_PER_LEVEL + sum("Attack")),
    def: Math.max(0, STAT_BASE.def + lv * STAT_PER_LEVEL + sum("Defense")),
  };
}

/** 升级阈值：next_level_exp = 当前 level * 100 */
function playerNextExp(level) { return Math.max(1, Math.round(num(level, 1))) * 100; }

/** 刷新玩家实体的经验显示字段（HUD：EXP me.exp/me.expToNext） */
function refreshPlayerExpFields(s) {
  const me = playerEntity(s);
  if (!me) return;
  const card = s.playerCard || {};
  const lv = Math.max(1, Math.round(num(me.level, 1)));
  const exp = Math.max(0, Math.round(num(s.exp, num(card.exp, 0))));
  s.exp = exp;
  me.exp = exp;
  me.expToNext = playerNextExp(lv);
}

/** 等级称号：有对照表 → 取对应项（无对应等级=空串）；无对照表 → null（保留原称号） */
const LEVEL_DESC_MAP_KEYS = ["level_desc_map", "level_titles", "level_title_map", "level_desc_table", "等级称号表"];
function resolveLevelDesc(card, level) {
  for (const key of LEVEL_DESC_MAP_KEYS) {
    const m = card && card[key];
    if (m && typeof m === "object") {
      const v = m[String(level)] != null ? m[String(level)] : m[level];
      return v == null ? "" : String(v);
    }
  }
  return null;
}

/** 等级/经验/HP/MP 同步到动态角色卡（变化才回写） */
function syncPlayerCardStats(s, patch) {
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
  if (me._cardStatSig === sig) return;
  me._cardStatSig = sig;
  patchCard(s, { level: lv, exp, next_level_exp: next, hp, maxHp, mp, maxMp, ...extra });
}

/** 升级判定：exp ≥ level*100 → 升级（支持连续多级），溢出保留，重算满血满蓝 + 写称号 */
function checkPlayerLevelUp(s) {
  const me = playerEntity(s);
  if (!me) return 0;
  let lv = Math.max(1, Math.round(num(me.level, 1)));
  let exp = Math.max(0, Math.round(num(s.exp, 0)));
  let ups = 0;
  while (exp >= playerNextExp(lv)) {
    exp -= playerNextExp(lv);
    lv += 1;
    ups += 1;
  }
  if (!ups) { refreshPlayerExpFields(s); return 0; }
  me.level = lv;
  s.exp = exp;
  applyBagAttributes(s, { full: true });
  const card = s.playerCard || {};
  const desc = resolveLevelDesc(card, lv);
  syncPlayerCardStats(s, desc == null ? {} : { level_desc: desc });
  floater(s, `Lv.${lv} ↑`, me.x, me.y - 40);
  pushEvent(s, `升级到 Lv.${lv}（经验 ${exp}/${playerNextExp(lv)}，HP/MP 已按公式补满）`);
  return ups;
}

/** 玩家获得经验：累加 → 升级判定 → 角色卡同步 */
function gainPlayerExp(s, amount) {
  const gain = Math.round(num(amount, 0));
  if (gain <= 0) return;
  s.exp = Math.max(0, Math.round(num(s.exp, 0)) + gain);
  checkPlayerLevelUp(s);
  syncPlayerCardStats(s);
}

/** 满血满蓝恢复（game.md 5：睡觉/住宿/药剂/恢复技能/剧情治愈 → 直接补满，描述写 other） */
function restorePlayerFull(s, reason) {
  const me = playerEntity(s);
  if (!me) return;
  applyBagAttributes(s, { full: true });
  const card = s.playerCard || {};
  const other = (Array.isArray(card.other) ? card.other.map((x) => String(x)) : []).slice(-20);
  const note = `${reason}：🎉 恭喜您已恢复到最佳状态（HP ${Math.round(me.hp)}/${Math.round(me.maxHp)}，MP ${Math.round(num(me.mp, 0))}/${Math.round(num(me.maxMp, 0))}）`;
  other.push(note);
  syncPlayerCardStats(s, { other });
  floater(s, "满血满蓝", me.x, me.y - 40);
  pushEvent(s, note);
}

/** 开局：等级/经验取参数卡，四维按公式重算，当前 hp/mp 取卡面值并夹进上限 */
function initPlayerFromCard(s, playerRole) {
  const me = playerEntity(s);
  if (!me) return;
  const card = ((s.playerCard && Object.keys(s.playerCard).length)
    ? s.playerCard
    : ((playerRole && (playerRole.parameterCardJson || playerRole.parameter_card_json)) || {})) || {};
  if (!s.playerCard || !Object.keys(s.playerCard).length) s.playerCard = { ...card };
  me.level = Math.max(1, Math.round(num(card.level, num(playerRole && playerRole.initial_level, num(me.level, 1)))));
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
function applyBagAttributes(s, opts) {
  const me = playerEntity(s);
  if (!me) return;
  const st = playerMaxStats(s);
  me.maxHp = st.maxHp;
  me.maxMp = st.maxMp;
  me.atk = st.atk;
  me.def = st.def;
  if (opts && opts.full) {
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
function useBagItem(s, name) {
  const me = playerEntity(s);
  if (!me || !me.alive) return "角色不可用";
  const card = s.playerCard || {};
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const it = bag.find((x) => sameName(x.name, name));
  if (!it || it.count <= 0) return `「${name}」不在背包中`;
  const t = it.type || "heal";
  me.actionBobMs = 300;
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
    if (it.power > 0 && targets.length) {
      damage(s, targets[0], it.power, me);
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
        nextBag = bag.map((x) => sameName(x.name, it.name) ? { ...x, count: x.count - 1 } : x).filter((x) => x.count > 0);
        setItemDurLeft(s, it.name, dur); // 换上新的一件，耐久重置
        pushEvent(s, `${it.name} 耐久耗尽，损毁 1 个`);
      } else {
        setItemDurLeft(s, it.name, left);
        pushEvent(s, `${it.name} 耐久 ${left}/${dur}`);
      }
    } else {
      nextBag = bag.map((x) => sameName(x.name, it.name) ? { ...x, count: x.count - 1 } : x).filter((x) => x.count > 0);
    }
  }
  patchCard(s, { items: serializeBag(nextBag, card.items) });
  applyBagAttributes(s);
  return msg;
}
function playerEntity(s) {
  return s.entities.find((e) => e.side === "player");
}
function patchCard(s, patch) {
  const card = { ...s.playerCard || {}, ...patch };
  s.playerCard = card;
  s.writeback = { ...s.writeback || {}, ...patch };
  s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
  if (Array.isArray(patch.items)) s.items = buildItems(card, 0, s.itemMeta);
  if (Array.isArray(patch.skills)) s.skills = buildSkills(card, 8, s.skillMeta);
}
function syncCardFromContext(s, ctx) {
  const card = ctx?.playerCard || {};
  if (!card || !Object.keys(card).length) return;
  const cur = s.playerCard || {};
  const sig = (c) => JSON.stringify([
    c?.items ?? null, c?.money ?? null, c?.skills ?? null,
    c?.level ?? null, c?.exp ?? null, c?.hp ?? null, c?.mp ?? null,   // ★ 等级系统字段
  ]);
  if (sig(card) === sig(cur)) return;
  s.playerCard = card;
  s.items = buildItems(card, 0, s.itemMeta);
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
function ensureNpcCards(s, levelName) {
  const prev = new Map((s.npcCards || []).map((c) => [String(c.id), c]));
  const party = s.partyIds || [];
  // ★ game.md 角色卡面板：主体 = 当前 AI 故事对话的动态角色卡（s.roles，
  //   与 Toonflow-game-web play-role-strip / play-inline-card 同一数据源），
  //   无论有没有在开始游戏被选择上场，全部显示（友方/中立/敌对）。
  //   地图实体只用于合并运行时信息（位置/血量/经验/组队），不再是卡片来源。
  const roles = Array.isArray(s.roles) ? s.roles : [];
  const entByKey = /* @__PURE__ */ new Map();
  (s.entities || []).forEach((e) => {
    entByKey.set(String(e.id), e);
    if (!entByKey.has(String(e.name))) entByKey.set(String(e.name), e);
  });
  // ★ 停车实体（停在别的地图）也参与匹配：角色卡要显示"他在哪张图哪个位置"
  const parkedMap = s.parked && typeof s.parked === "object" ? s.parked : {};
  Object.keys(parkedMap).forEach((k) => {
    (Array.isArray(parkedMap[k]) ? parkedMap[k] : []).forEach((e) => {
      if (!entByKey.has(String(e.id))) entByKey.set(String(e.id), e);
      if (!entByKey.has(String(e.name))) entByKey.set(String(e.name), e);
    });
  });
  const sel = s.selections || {};
  const inSel = (arr, r) => Array.isArray(arr) && arr.some((x) => String(x) === String(r.id) || String(x) === String(r.name));
  const sideOfRole = (r) => {
    const e = entByKey.get(String(r.id)) || entByKey.get(String(r.name));
    if (e) return e.side;
    if (String(r.roleType) === "player") return "player";
    if (inSel(sel.participants, r)) return "ally";
    if (inSel(sel.enemies, r)) return "enemy";
    if (inSel(sel.spectators, r)) return "spectator";
    return "neutral";
  };
  const buildCard = (role, forcedSide) => {
    const e = entByKey.get(String(role.id)) || entByKey.get(String(role.name)) || null;
    const old = prev.get(String(role.id));
    const side = forcedSide || sideOfRole(role);
    const onMap = !!e;
    const onStage = onMap && (side !== "enemy" || e.alive);
    const pcRaw = side === "player" && s.playerCard && Object.keys(s.playerCard).length
      ? s.playerCard
      : role.parameterCardJson || role.parameter_card_json || (old && old.parameterCardJson) || null;
    let pc = null;
    if (pcRaw && typeof pcRaw === "object") {
      pc = { ...pcRaw };
      pc.level = Math.max(1, Math.round(num(e ? e.level : num(role.initial_level, num(pc.level, 1)), 1)));
      if (e) {
        pc.hp = Math.round(num(e.hp, num(pc.hp, 0)));
        pc.maxHp = Math.round(num(e.maxHp, num(pc.maxHp, pc.hp)));
        // ★ 等级系统：蓝量以实体为权威（满蓝公式 = 100 + 等级*10 + 加成）
        pc.mp = Math.round(num(e.mp, num(pc.mp, 0)));
        pc.maxMp = Math.round(num(e.maxMp, num(pc.maxMp, pc.mp)));
      }
      if (side === "player") {
        pc.money = num(s.playerCard?.money, num(pc.money, 0));
        pc.exp = Math.round(num(s.playerCard?.exp, num(s.exp, 0)));
        // ★ 等级系统：与玩家实体保持一致（等级/经验/满血满蓝）
        pc.level = Math.max(1, Math.round(num(e ? e.level : pc.level, 1)));
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
      roleType: String(role.roleType || ""),
      onMap,
      level: Math.max(1, Math.round(num(e ? e.level : num(role.initial_level, num(old?.level, 1)), 1))),
      hp: Math.round(e ? e.hp : num(old?.hp, num(pc?.hp, 0))),
      maxHp: Math.round(e ? e.maxHp : num(old?.maxHp, num(pc?.maxHp, 0))),
      exp: Math.round(num(old?.exp, 0)),
      alive: e ? !!e.alive : (old ? old.alive !== false : true),
      mapName: side === "player" ? (levelName || old?.mapName || "") : ((e && e.mapName) || old?.mapName || ""),
      x: Math.round(e ? e.x : num(old?.x, 0)),
      y: Math.round(e ? e.y : num(old?.y, 0)),
      inParty: party.indexOf(String(role.id)) >= 0,
      avatarPath: (e && e.avatarPath) || role.avatarPath || (old && old.avatarPath) || void 0,
      parameterCardJson: pc
    };
  };
  const cards = [];
  const seen = /* @__PURE__ */ new Set();
  const pushCard = (role, forcedSide) => {
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
// ★ game.md 角色位置问题：没有位置信息的角色，默认生成到可活动区域（不能在墙里/障碍物里）。
//   默认落点 (0,0) 附近 2.5m 半径（town 区附近），避开玩家出生点；clamp 边界 + enemyNav 可用时
//   用 navNearestFree 找最近可站格，绝不落进障碍。
const ROLE_SPAWN_R_M = 2.5;
function spawnRoleEntity(s, role) {
  if (!role) return null;
  const exist = s.entities.find((x) => x.id === String(role.id) || x.name === String(role.name));
  if (exist) return exist;
  const sel = s.selections || {};
  const inSel = (arr) => Array.isArray(arr) && arr.some((x) => String(x) === String(role.id) || String(x) === String(role.name));
  // ★ AI 故事角色区分：roleType 决定阵营（player→player, npc/system/general→ally）
  const roleType = str(role?.roleType);
  let side;
  if (roleType === "player") side = "player";
  else if (inSel(sel.enemies)) side = "enemy";
  else if (inSel(sel.participants)) side = "ally";
  else if (roleType === "npc" || roleType === "system" || roleType === "general") side = "ally";
  else side = "spectator";
  // ★ 默认落点 (0,0) 附近 2.5m 环形随机分布，与 town 区对齐
  const ang = rnd(0, Math.PI * 2);
  let target = {
    x: Math.cos(ang) * ROLE_SPAWN_R_M,
    y: Math.sin(ang) * ROLE_SPAWN_R_M
  };
  // 边界钳制
  target = clampToBound(s, target.x, target.y);
  // 优先 enemyNav 避障，没拿到网格就退而求其次
  if (enemyNav) {
    const free = navNearestFree(enemyNav, target.x, target.y, 0.4, 8);
    if (free) target = free;
  }
  const e = makeEntity(role, side, target.x, target.y, s.entities.length);
  e.homeX = e.x;
  e.homeY = e.y;
  e.mapName = s.levelName || "";
  e.roleType = roleType;
  // ★ 中立/通用角色保持非攻击状态（不会主动追玩家）
  if (side === "enemy") {
    e.aiState = "idle";
    e.regionId = (nearestWildRegion(e.x, e.y) || {}).id;
  } else {
    e.aiState = "idle";
  }
  s.entities.push(e);
  return e;
}
// ★ game.md 角色位置：角色驻留地图 —— 他在哪个地图就在哪个地图，不因玩家切图而改变。
//   只有组队中的角色跟随玩家跨图（落点 = 玩家身边）；脱离队伍就地留下（留在当前坐标）。
//   非组队角色从当前实体表摘除、停进 s.parked[地图名]，玩家回到该图时原坐标归队。
function handleLevelChange(s, snapParty) {
  if (!Array.isArray(s.entities)) return;
  const lv = s.levelName || "";
  s.parked = s.parked && typeof s.parked === "object" ? s.parked : {};
  const party = s.partyIds || [];
  const player = s.entities.find((e) => e.side === "player");
  const stay = [];
  (s.entities || []).forEach((e) => {
    if (e.side === "player") { e.mapName = lv; stay.push(e); return; }
    if (String(e.side) === "enemy") { stay.push(e); return; } // 野怪由前端 localEnemies 按图管理，不动
    if (!e.mapName) e.mapName = lv; // 存量实体兜底：视为当前图
    if (party.indexOf(String(e.id)) >= 0) {
      // 组队：跟随玩家到当前图，落在玩家身边
      e.mapName = lv;
      if (snapParty && player) {
        const ang = Math.random() * Math.PI * 2;
        const cb = clampToBound(s, player.x + Math.cos(ang) * ALLY_FOLLOW_GAP_M, player.y + Math.sin(ang) * ALLY_FOLLOW_GAP_M);
        e.x = cb.x;
        e.y = cb.y;
      }
      stay.push(e);
    } else if (e.mapName === lv) {
      stay.push(e);
    } else {
      (s.parked[e.mapName] = s.parked[e.mapName] || []).push(e);
    }
  });
  const back = s.parked[lv];
  if (Array.isArray(back) && back.length) {
    back.forEach((e) => { e.mapName = lv; });
    s.entities = stay.concat(back);
    s.parked[lv] = [];
  } else {
    s.entities = stay;
  }
}
function grantPartyExp(s, expGain) {
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
      e.level = c.level;
      e.maxHp = c.maxHp;
      e.hp = c.hp;
    }
  });
  const lead = s.entities.find((e) => e.id === party[0]);
  if (lead) floater(s, `\u961F\u4F0D +${share}exp`, lead.x, lead.y - 26);
}
async function persistSys(context, s) {
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
      itemMeta: s.itemMeta || {}
    });
    // ★ game.md 对话功能：AI 故事角色位置/地图信息单独持久化（dataKey=ai_story_roles → t_plugin_session_data），
    //   后续开新局时 AI 聊天窗口能直接读到「陈彦现在在 mulberry_forest 地图 (12.3, -5.6)」，不用再遍历 entities。
    const aiRoles = collectAiStoryRoles(s);
    await api.set(AI_STORY_ROLES_KEY, {
      roles: aiRoles,
      level: s.levelName || "",
      updatedAt: Date.now()
    });
  } catch {
  }
}
/** ★ game.md 对话功能：收集所有 AI 故事角色的位置/地图信息（写入 t_plugin_session_data） */
function collectAiStoryRoles(s) {
  const arr = [];
  const ents = Array.isArray(s.entities) ? s.entities : [];
  for (const e of ents) {
    if (!e) continue;
    const rt = String(e.roleType || "");
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
      mapName: String(e.mapName || s.levelName || ""),
      alive: e.alive !== false,
      updatedAt: Date.now()
    });
  }
  return arr;
}
async function restoreSys(context, s) {
  const api = context?.tsApi?.pluginData;
  if (!api?.get) return;
  try {
    const d = await api.get(SYS_DATA_KEY);
    if (!d || typeof d !== "object") return;
    if (d.skillMeta && typeof d.skillMeta === "object") s.skillMeta = d.skillMeta;
    if (d.itemMeta && typeof d.itemMeta === "object") s.itemMeta = d.itemMeta;
    if (d.ring && typeof d.ring === "object") {
      s.ring = {
        items: Array.isArray(d.ring.items) ? d.ring.items : [],
        skills: Array.isArray(d.ring.skills) ? d.ring.skills.map(String) : []
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
  } catch {
  }
}
async function refreshShop(context, s) {
  const notes = [];
  const builtin = BUILTIN_SHOP_GOODS.map((g) => ({ ...g }));
  let story = [];
  const run = context?.tsApi?.agent?.run;
  if (run) {
    try {
      const r = await withTimeout(
        run("field-survival-shop-gener", {
          storyDigest: buildStoryDigest(context),
          worldBookDigest: str(context?.worldBookDigest, ""),
          playerCard: s.playerCard || {}
        }),
        2e4,
        "shop agent timeout"
      );
      const goods = r?.output?.goods;
      if (Array.isArray(goods)) {
        story = goods.slice(0, 14).map((g, i) => {
          const rawName = String(g?.name || `\u7269\u8D44${i + 1}`).slice(0, 20);
          const kind = KIND_LIST.indexOf(String(g?.kind)) >= 0 ? String(g.kind) : guessKind(rawName);
          return {
            id: `s_${i}_${rawName}`,
            name: rawName,
            price: Math.max(1, Math.round(num(g?.price, 50))),
            kind,
            rarity: normRarity(g?.rarity),
            heal: Math.max(0, Math.round(num(g?.heal, defaultHeal(rawName, kind)))),
            desc: String(g?.desc || "").slice(0, 60),
            from: "story"
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
  if (notes.length) pushEvent(s, `\u5546\u57CE\u751F\u6210\u964D\u7EA7\uFF1A${notes[0]}`);
  return notes;
}
function isPlayerRole(cand, playerRole) {
  const cid = str(cand?.id);
  const cname = str(cand?.name);
  const pid = str(playerRole?.id);
  const pname = str(playerRole?.name);
  if (pid && cid && cid === pid) return true;
  if (pname && cname && cname === pname) return true;
  return false;
}
async function handle_action(action, params, state, context) {
  const s = state && Object.keys(state).length > 0 && (state.version === 2 || state.version === 3 || state.version === 4) ? state : emptyState(context);
  const okResp = (msg) => ({ code: 0, message: "ok", state: s, response: msg });
  switch (action) {
    case "init":
    case "start_init": {
      const fresh = emptyState(context);
      fresh.roles = Array.isArray(context?.roles) ? context.roles : [];
      return { code: 0, message: "ok", state: fresh, response: "\u8BF7\u9009\u62E9\u53CB\u65B9 / \u89C2\u6218 / \u654C\u5BF9\u89D2\u8272\u540E\u5F00\u59CB" };
    }
    case "start": {
      const sel = params?.selections || params || {};
      const participants = Array.isArray(sel.participants) ? sel.participants.map(String) : [];
      const spectators = Array.isArray(sel.spectators) ? sel.spectators.map(String) : [];
      const enemies = Array.isArray(sel.enemies) ? sel.enemies.map(String) : [];
      const roles = Array.isArray(context?.roles) ? context.roles : [];
      const byId = (id) => roles.find((r) => String(r.id) === id || String(r.name) === id);
      const playerRole = roles.find((r) => String(r.roleType) === "player") || roles[0];
      s.selections = { participants, spectators, enemies };
      s.entities = [];
      s.entities.push(makeEntity(playerRole, "player", PLAYER_SPAWN.x, PLAYER_SPAWN.y, 0));
      // ★ game.md 等级系统：等级/经验取参数卡，四维按公式重算（HP/MP 取卡面值并夹进满值上限）
      initPlayerFromCard(s, playerRole);
      participants.forEach((id, i) => {
        const r = byId(id);
        if (!r) return;
        if (isPlayerRole(r, playerRole)) return;
        const angle = i / Math.max(1, participants.length) * Math.PI * 2;
        s.entities.push(makeEntity(
          r,
          "ally",
          PLAYER_SPAWN.x + Math.cos(angle) * ALLY_FOLLOW_GAP_M,
          PLAYER_SPAWN.y + Math.sin(angle) * ALLY_FOLLOW_GAP_M,
          i
        ));
      });
      const startRegion = nearestWildRegion(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
      enemies.forEach((id, i) => {
        const r = byId(id);
        if (r && isPlayerRole(r, playerRole)) return;
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
      // ★ game.md 对话功能：AI 故事角色（非玩家、非 enemies、非参与者、非 spectators）也生成到地图上 (0,0) 附近。
      //   不再只生成在地图外（-40,-40），方便玩家走近时触发对话按钮。
      //   玩家已在前面 spawn 过了；participants 已经在 allies 里；spectators 已经在 spectator 里；
      //   enemies 也已在 enemies 里；这里补剩下的"无明确阵营"的 AI 故事角色。
      const alreadySpawned = new Set(s.entities.map((e) => String(e.id) || String(e.name)));
      const seen = new Set([playerRole?.id, ...participants, ...spectators, ...enemies].map((x) => String(x || "")));
      roles.forEach((r) => {
        if (!r) return;
        const id = String(r.id || r.name || "");
        if (!id || seen.has(id) || alreadySpawned.has(id)) return;
        if (isPlayerRole(r, playerRole)) return;
        spawnRoleEntity(s, r);
      });
      s.map = await ensureMapData(context);
      s.mapSource = (s.map?.notes || "").includes("fallback") ? "fallback" : "agent";
      if (s.map) {
        s.map.zones = WORLD_REGIONS.map((r) => ({
          name: r.name,
          x: r.x,
          y: r.y,
          r: r.r,
          kind: r.kind,
          desc: r.desc
        }));
      }
      ensureTown(s);
      initRegions(s);
      WORLD_REGIONS.forEach((r) => {
        if (!r.safe && r.mobs > 0) spawnRegionMobs(s, r, r.mobs);
      });
      if (!s.chests.length) {
        (s.map?.chests || []).forEach((c, i) => {
          s.chests.push({
            ...c,
            id: `chest_map_${i}`,
            x: clampX(num(c.x, 0)),
            y: clampY(num(c.y, 0)),
            opened: false
          });
        });
      }
      if (!s.potions.length) {
        (s.map?.potions || []).forEach((p, i) => {
          s.potions.push({
            id: `potion_map_${i}`,
            x: clampX(num(p.x, 0)),
            y: clampY(num(p.y, 0)),
            heal: num(p.heal, 40)
          });
        });
      }
      if (!s.chests.length) {
        ["wood", "ruin", "wild"].forEach((rid, i) => {
          const r = WORLD_REGIONS.find((z) => z.id === rid);
          const at = regionSpawnPoint(s, r);
          s.chests.push({ id: `chest_${rid}_${i}`, x: at.x, y: at.y, opened: false, loot: { exp: 12 + i * 5, money: 10 + i * 4, item: "\u5E72\u7CAE" } });
        });
      }
      if (!s.potions.length) {
        ["shore", "mine", "marsh"].forEach((rid, i) => {
          const r = WORLD_REGIONS.find((z) => z.id === rid);
          const at = regionSpawnPoint(s, r);
          s.potions.push({ id: `potion_${rid}_${i}`, x: at.x, y: at.y, heal: 24 + i * 6 });
        });
      }
      await restoreSys(context, s);
      syncCardFromContext(s, context); // ★ start 也同步参数卡（宿主可能在 init 后才注入 playerCard）
      if (str(params?.levelName)) s.levelName = str(params.levelName, s.levelName || "");
      if (!s.levelName) s.levelName = str(s.map?.theme, "");
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
      const theme = str(s.map?.theme, "\u91CE\u5916");
      const narration = str(s.map?.narration, "");
      s.events = [
        narration || `\u8FDB\u5165\u300C${theme}\u300D\uFF1A\u64CD\u4F5C\u4F60\u7684\u89D2\u8272\uFF0C\u51FB\u6740\u654C\u4EBA\u3001\u5F00\u542F\u5B9D\u7BB1\u3001\u62FE\u53D6\u8840\u74F6\u3002`
      ];
      return okResp(`\u8FDB\u5165\u300C${theme}\u300D`);
    }
    case "tick": {
      if (s.phase !== "playing") return okResp("");
      s.writeback = null;
      // ★ teleportTarget 一次性：下发一拍后立刻清除，否则每次 tick 响应都会
      //   重新触发前端传送 watch，把玩家反复拉回目标点（表现 = 被绑住）
      if (s.teleportTarget) s.teleportTarget = null;
      s.tick += 1;
      const localBuilt = applyLocalEnemies(s, params?.localEnemies);
      applyEnemyNavPayload(params?.walkGrid);
      if (str(params?.levelName)) s.levelName = str(params.levelName, s.levelName || "");
      syncCardFromContext(s, context);
      applyBagAttributes(s); // ★ game.md 背包被动属性加成（Defense/Attack/Life/Blue）
      syncPlayerCardStats(s); // ★ game.md 等级系统：等级/经验/HP/MP → 动态角色卡（变化才回写）
      ensureNpcCards(s, s.levelName || "");
      if (s.tick % SYS_PERSIST_EVERY_TICKS === 0) void persistSys(context, s);
      step(s, params?.input || params, params?.player);
      // ★ 角色驻留地图：检测到玩家换图后，非组队角色留在原图（停车），组队角色跟来
      if (s.levelName && s.levelName !== s._levelAt) {
        handleLevelChange(s, true);
        s._levelAt = s.levelName;
        ensureNpcCards(s, s.levelName || "");
      }
      if (localBuilt > 0) pushEvent(s, `\u5F53\u524D\u5173\u5361\u654C\u602A\u5DF2\u63A5\u5165\u5BBF\u4E3B AI\uFF08${localBuilt} \u53EA\uFF09`);
      return okResp("");
    }
    case "skill": {
      if (s.phase !== "playing") return okResp("");
      const idx = num(params?.index, 0);
      const slotIdx = s.skillPage * 4 + idx;
      const skill = s.skills[slotIdx];
      const player = s.entities.find((e) => e.side === "player");
      if (!skill || !player || !player.alive) return okResp("");
      if (skill.cdLeft > 0) return okResp(`${skill.name} \u51B7\u5374\u4E2D`);
      const targets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(player, e) < SKILL_RANGE_M);
      if (!targets.length) {
        damage(s, s.entities.filter((e) => e.side === "enemy" && e.alive)[0] || player, 0);
        return okResp(`${skill.name} \u672A\u547D\u4E2D`);
      }
      skill.cdLeft = skill.cd;
      player.actionBobMs = 300;
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
      pushEvent(s, `\u65BD\u653E ${skill.name}\uFF0C\u547D\u4E2D ${Math.min(3, targets.length)} \u4E2A\u76EE\u6807`);
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
    case "sys": {
      const levels = Array.isArray(params?.levels) ? params.levels.map(String).filter(Boolean) : [];
      if (levels.length) {
        s.mapNodes = levels.map((n, i) => ({ name: n, x: 160 + i % 4 * 260, y: 140 + Math.floor(i / 4) * 200 }));
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
      const card = s.playerCard || {};
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder);
      const it = bag.find((x) => sameName(x.name, name));
      if (!it) return okResp(`\u80CC\u5305\u91CC\u6CA1\u6709\u300C${name}\u300D`);
      const sold = Math.min(ask, it.count);
      const gain = sellPrice(it) * sold;
      const nextBag = bag.map((x) => sameName(x.name, name) ? { ...x, count: x.count - sold } : x).filter((x) => x.count > 0);
      patchCard(s, { items: serializeBag(nextBag, card.items), money: Math.round(num(card.money, 0)) + gain });
      pushEvent(s, `\u5356\u51FA ${name}\xD7${sold}\uFF0C\u83B7\u5F97 ${gain} \u91D1\u94B1`);
      const me = playerEntity(s);
      if (me) floater(s, `+${gain} \u91D1`, me.x, me.y - 30);
      await persistSys(context, s);
      return okResp(`\u5356\u51FA ${name}\xD7${sold}\uFF08+${gain} \u91D1\uFF09`);
    }
    case "sys_use_item": {
      const name = str(params?.name);
      const msg = useBagItem(s, name);
      await persistSys(context, s);
      return okResp(msg);
    }
    case "sys_sort": {
      const order = Array.isArray(params?.order) ? params.order.map(String) : [];
      const card = s.playerCard || {};
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, order.length ? order : s.bagOrder);
      s.bagOrder = bag.map((x) => x.name);
      patchCard(s, { items: serializeBag(bag, card.items) });
      await persistSys(context, s);
      return okResp("\u80CC\u5305\u987A\u5E8F\u5DF2\u66F4\u65B0");
    }
    case "sys_ring_move": {
      const kind = str(params?.kind, "item");
      const name = str(params?.name);
      const to = str(params?.to, "ring") === "bag" ? "bag" : "ring";
      const ask = Math.max(1, Math.round(num(params?.count, 1)));
      if (!name) return okResp("\u7F3A\u5C11\u540D\u79F0");
      if (!s.ring) s.ring = { items: [], skills: [] };
      const card = s.playerCard || {};
      if (kind === "skill") {
        const skills = Array.isArray(card.skills) ? card.skills.map((x) => typeof x === "string" ? x : str(x?.name)).filter(Boolean) : [];
        const ringSkills = s.ring.skills || [];
        if (to === "ring") {
          if (!skills.some((x) => sameSkill(x, name))) return okResp(`\u6280\u80FD\u300C${name}\u300D\u4E0D\u5728\u6280\u80FD\u680F`);
          s.ring.skills = Array.from(/* @__PURE__ */ new Set([...ringSkills.filter((x) => !sameSkill(x, name)), cleanSkillName(name)]));
          patchCard(s, { skills: skills.filter((x) => !sameSkill(x, name)) });
          pushEvent(s, `\u6280\u80FD ${name} \u5DF2\u5B58\u5165\u7EB3\u6212`);
        } else {
          if (!ringSkills.some((x) => sameSkill(x, name))) return okResp(`\u7EB3\u6212\u91CC\u6CA1\u6709\u6280\u80FD\u300C${name}\u300D`);
          s.ring.skills = ringSkills.filter((x) => !sameSkill(x, name));
          const back = skills.find((x) => sameSkill(x, name)) || cleanSkillName(name);
          patchCard(s, { skills: Array.from(/* @__PURE__ */ new Set([...skills.filter((x) => !sameSkill(x, name)), back])) });
          pushEvent(s, `\u6280\u80FD ${name} \u5DF2\u4ECE\u7EB3\u6212\u53D6\u51FA`);
        }
        await persistSys(context, s);
        return okResp(to === "ring" ? `\u5DF2\u5B58\u5165\u7EB3\u6212\uFF1A${name}` : `\u5DF2\u53D6\u51FA\uFF1A${name}`);
      }
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder);
      if (to === "ring") {
        const it = bag.find((x) => sameName(x.name, name));
        if (!it) return okResp(`\u80CC\u5305\u91CC\u6CA1\u6709\u300C${name}\u300D`);
        const moved = Math.min(ask, it.count);
        const ringItems = s.ring.items || [];
        const exist = ringItems.find((x) => sameName(x.name, name));
        if (exist) exist.count += moved;
        else ringItems.push({ ...it, count: moved });
        s.ring.items = ringItems;
        const nextBag = bag.map((x) => sameName(x.name, name) ? { ...x, count: x.count - moved } : x).filter((x) => x.count > 0);
        patchCard(s, { items: serializeBag(nextBag, card.items) });
        pushEvent(s, `${name}\xD7${moved} \u5DF2\u5B58\u5165\u7EB3\u6212`);
      } else {
        const ringItems = s.ring.items || [];
        const it = ringItems.find((x) => sameName(x.name, name));
        if (!it) return okResp(`\u7EB3\u6212\u91CC\u6CA1\u6709\u300C${name}\u300D`);
        const moved = Math.min(ask, it.count);
        const exist = bag.find((x) => sameName(x.name, name));
        if (exist) exist.count += moved;
        else bag.push({ ...it, count: moved });
        s.ring.items = ringItems.map((x) => sameName(x.name, name) ? { ...x, count: x.count - moved } : x).filter((x) => x.count > 0);
        s.bagMeta = { ...s.bagMeta || {}, [it.name]: { ...it, count: 0 } };
        patchCard(s, { items: serializeBag(bag, card.items) });
        pushEvent(s, `${name}\xD7${moved} \u5DF2\u4ECE\u7EB3\u6212\u53D6\u51FA`);
      }
      await persistSys(context, s);
      return okResp(to === "ring" ? `\u5DF2\u5B58\u5165\u7EB3\u6212\uFF1A${name}` : `\u5DF2\u53D6\u51FA\uFF1A${name}`);
    }
    case "sys_rest": {
      // ★ game.md 5：睡觉 / 住宿 / 休息过夜 → 直接满血满蓝，恢复描述写入角色卡 other
      if (s.phase !== "playing") return okResp("");
      const meRest = playerEntity(s);
      if (!meRest || !meRest.alive) return okResp("角色不可用");
      meRest.actionBobMs = 300;
      restorePlayerFull(s, str(params?.reason, "休息"));
      return okResp(`🎉 恭喜您已恢复到最佳状态！HP ${Math.round(meRest.hp)}/${Math.round(meRest.maxHp)}，MP ${Math.round(num(meRest.mp, 0))}/${Math.round(num(meRest.maxMp, 0))}`);
    }

    case "sys_use_skill": {
      const skName = str(params?.name);
      const skIdx = num(params?.index, -1);
      const meSk = playerEntity(s);
      if (!meSk || !meSk.alive) return okResp("\u89D2\u8272\u4E0D\u53EF\u7528");
      const si = skIdx >= 0 ? skIdx : s.skills.findIndex((k) => sameName(k.name, skName));
      const sk = s.skills[si];
      if (!sk) return okResp(`\u6280\u80FD\u300C${skName}\u300D\u4E0D\u5B58\u5728`);
      if (sk.cdLeft > 0) return okResp(`${sk.name} \u51B7\u5374\u4E2D`);
      sk.cdLeft = sk.cd;
      meSk.actionBobMs = 300;
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
        pushEvent(s, `\u65BD\u653E ${sk.name}\uFF0C\u672A\u547D\u4E2D\u76EE\u6807`);
        return okResp(`${sk.name} \u672A\u547D\u4E2D`);
      }
      skTargets.slice(0, 3).forEach((t) => damage(s, t, sk.power));
      pushEvent(s, `\u65BD\u653E ${sk.name}\uFF0C\u547D\u4E2D ${Math.min(3, skTargets.length)} \u4E2A\u76EE\u6807`);
      return okResp(`${sk.name}`);
    }
    case "sys_skill_edit": {
      // ★ game.md 技能修改：修改后保存到 t_plugin_session_data（skillMeta + 参数卡技能名列表）
      const idx = Math.round(num(params?.index, -1));
      const sk = s.skills[idx];
      if (!sk) return okResp("\u6280\u80FD\u4E0D\u5B58\u5728");
      const oldKey = skillKey(sk.name);
      const nm = cleanSkillName(str(params?.name, sk.name)).slice(0, 12) || sk.name;
      sk.name = nm;
      sk.power = Math.max(0, Math.round(num(params?.power, sk.power)));
      sk.cost = Math.max(0, Math.round(num(params?.cost, sk.cost)));
      sk.cd = Math.max(1, Math.round(num(params?.cd, sk.cd)));
      sk.type = ["atk", "heal", "buff"].includes(str(params?.type)) ? str(params?.type) : (sk.type || "atk");
      sk.range = str(params?.range) === "ranged" ? "ranged" : "melee";
      sk.lv = Math.max(1, Math.round(num(params?.lv, sk.lv || 1)));
      sk.buff_type = BUFF_TYPES.includes(str(params?.buff_type)) ? str(params?.buff_type) : "";
      s.skillMeta = { ...s.skillMeta || {}, [skillKey(nm)]: { power: sk.power, cost: sk.cost, cd: sk.cd, type: sk.type, range: sk.range, lv: sk.lv, buff_type: sk.buff_type } };
      // 参数卡「技能」只保存技能名称列表：先展平（括号深度感知拆分）再替换原条目（带 lv 注记）
      const card = s.playerCard || {};
      const flat = [];
      (Array.isArray(card.skills) ? card.skills : []).forEach((x) => {
        if (typeof x === "string") splitSkillList(x).forEach((p) => { if (cleanSkillName(p)) flat.push(p.trim()); });
        else { const n = str(x?.name); if (n) flat.push(n); }
      });
      const at = flat.findIndex((x) => skillKey(x) === oldKey);
      const annotated = sk.lv > 1 ? `${nm}\uFF08lv${sk.lv}\uFF09` : nm;
      if (at >= 0) flat[at] = annotated; else flat.push(annotated);
      patchCard(s, { skills: flat });
      pushEvent(s, `\u6280\u80FD\u300C${nm}\u300D\u53C2\u6570\u5DF2\u4FEE\u6539\u5E76\u4FDD\u5B58`);
      await persistSys(context, s);
      const tLabel = sk.type === "heal" ? "\u6CBB\u7597" : sk.type === "buff" ? `\u5F3A\u5316(${sk.buff_type || "-"})` : sk.range === "ranged" ? "\u8FDC\u7A0B" : "\u8FD1\u6218";
      return okResp(`\u300C${nm}\u300D\u5DF2\u4FDD\u5B58\uFF08${tLabel}\u00B7lv${sk.lv}\uFF09`);
    }
    case "sys_item_edit": {
      // ★ game.md 物品修改：修改后保存到 t_plugin_session_data（itemMeta + 参数卡物品名列表）
      const idx = Math.round(num(params?.index, -1));
      const card = s.playerCard || {};
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
      const it = idx >= 0 ? bag[idx] : bag.find((x) => sameName(x.name, str(params?.name)));
      if (!it) return okResp("\u7269\u54C1\u4E0D\u5B58\u5728");
      const oldName = it.name;
      const nm = cleanName(str(params?.name, it.name)).slice(0, 20) || it.name;
      it.name = nm;
      it.power = Math.max(0, Math.round(num(params?.power, it.power || 0)));
      it.cost = Math.max(0, Math.round(num(params?.cost, it.cost || 0)));
      it.cd = Math.max(0, Math.round(num(params?.cd, it.cd || 0)));
      it.type = ITEM_TYPES.includes(str(params?.type)) ? str(params?.type) : (it.type || "heal");
      it.range = str(params?.range) === "ranged" ? "ranged" : "melee";
      it.lv = Math.max(1, Math.round(num(params?.lv, it.lv || 1)));
      it.buff_type = BUFF_TYPES.includes(str(params?.buff_type)) ? str(params?.buff_type) : "";
      it.durability = clamp(Math.round(num(params?.durability, it.durability == null ? -1 : it.durability)), -1, 99999);
      it.attribute_type = ITEM_ATTR_TYPES.includes(str(params?.attribute_type)) ? str(params?.attribute_type) : "";
      it.attribute_value = Math.round(num(params?.attribute_value, it.attribute_value || 0));
      // ★ game.md quantity/description：先汇总原条目数量与描述，再决定写回值
      const flat = [];
      (Array.isArray(card.items) ? card.items : []).forEach((x) => {
        if (typeof x === "string") splitSkillList(x).forEach((p) => { if (cleanName(p)) flat.push(p.trim()); });
        else flat.push(x);
      });
      let total = 0;
      let desc = "";
      flat.forEach((x) => {
        if (itemKey(x) !== itemKey(oldName)) return;
        const p = parseItemRaw(x);
        total += p.count;
        if (p.desc && !desc) desc = p.desc;
      });
      if (!total) total = it.count;
      const qty = params?.quantity != null ? Math.max(1, Math.round(num(params.quantity, total))) : total;
      const descNew = str(params?.description, "");
      const descFinal = descNew || desc;
      const metaEntry = { power: it.power, cost: it.cost, cd: it.cd, type: it.type, range: it.range, lv: it.lv, buff_type: it.buff_type, durability: it.durability, durabilityLeft: it.durability, attribute_type: it.attribute_type, attribute_value: it.attribute_value, quantity: qty, description: descFinal };
      s.itemMeta = { ...s.itemMeta || {} };
      if (oldName !== nm) delete s.itemMeta[oldName];
      s.itemMeta[nm] = metaEntry;
      // 参数卡「物品」只保存名称列表：展平后替换同名条目（数量取 qty、lv>1 加 lv 注记、描述注记保留/更新）
      const annotated = `${nm}${qty > 1 ? `\u00D7${qty}` : ""}${it.lv > 1 ? `\uFF08lv${it.lv}\uFF09` : ""}${descFinal ? `\uFF08${descFinal}\uFF09` : ""}`;
      const at = flat.findIndex((x) => itemKey(x) === itemKey(oldName));
      const kept = flat.filter((x) => itemKey(x) !== itemKey(oldName));
      kept.splice(Math.max(0, Math.min(at < 0 ? kept.length : at, kept.length)), 0, annotated);
      patchCard(s, { items: kept });
      applyBagAttributes(s);
      pushEvent(s, `\u7269\u54C1\u300C${nm}\u300D\u53C2\u6570\u5DF2\u4FEE\u6539\u5E76\u4FDD\u5B58`);
      await persistSys(context, s);
      const tLabel2 = it.type === "heal" ? "\u6CBB\u7597" : it.type === "buff" ? `\u5F3A\u5316(${it.buff_type || "-"})` : it.type === "attribute" ? `\u5C5E\u6027(${it.attribute_type || "-"})` : it.range === "ranged" ? "\u8FDC\u7A0B" : "\u8FD1\u6218";
      const dLabel = it.durability < 0 ? "\u6C38\u4E45" : `\u8010\u4E45${it.durability}`;
      return okResp(`\u300C${nm}\u300D\u5DF2\u4FDD\u5B58\uFF08${tLabel2}\u00B7${dLabel}\u00B7\u00D7${qty}\uFF09`);
    }
    case "sys_shop_refresh": {
      await refreshShop(context, s);
      await persistSys(context, s);
      const src = s.shopSource === "agent" ? "\u5546\u57CEagent\u00B7\u6545\u4E8B\u7269\u8D44" : "\u63D2\u4EF6\u5E38\u5907\u7269\u8D44";
      // ★ 回复带时间戳：连续两次刷新若货源一致，文本不同才能触发前端 response watch
      const ts = new Date().toTimeString().slice(0, 8);
      return okResp(`\u5546\u57CE\u5DF2\u5237\u65B0 ${ts}\uFF08${(s.shopGoods || []).length} \u4EF6\u5546\u54C1\uFF0C\u8D27\u6E90\uFF1A${src}\uFF09`);
    }
    case "sys_shop_buy": {
      const id = str(params?.id);
      const ask = Math.max(1, Math.round(num(params?.count, 1)));
      const good = (s.shopGoods || []).find((g) => g.id === id) || BUILTIN_SHOP_GOODS.find((g) => g.id === id);
      if (!good) return okResp("\u5546\u54C1\u4E0D\u5B58\u5728");
      const card = s.playerCard || {};
      const money = Math.round(num(card.money, 0));
      const cost = Math.round(good.price) * ask;
      if (money < cost) return okResp(`\u91D1\u94B1\u4E0D\u8DB3\uFF1A\u9700\u8981 ${cost}\uFF0C\u73B0\u6709 ${money}`);
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
      const exist = bag.find((x) => x.name === good.name);
      if (exist) exist.count += ask;
      else bag.push({ name: good.name, count: ask, kind: good.kind, rarity: good.rarity, heal: good.heal, price: good.price, desc: good.desc });
      s.bagMeta = {
        ...s.bagMeta || {},
        [good.name]: { name: good.name, count: 0, kind: good.kind, rarity: good.rarity, heal: good.heal, price: good.price, desc: good.desc }
      };
      patchCard(s, { items: serializeBag(bag, card.items), money: money - cost });
      pushEvent(s, `\u8D2D\u4E70 ${good.name}\xD7${ask}\uFF0C\u82B1\u8D39 ${cost} \u91D1\u94B1`);
      const me = playerEntity(s);
      if (me) floater(s, `-${cost} \u91D1`, me.x, me.y - 30);
      await persistSys(context, s);
      return okResp(`\u8D2D\u4E70 ${good.name}\xD7${ask}`);
    }
    case "sys_party": {
      const rid = str(params?.roleId);
      if (!rid) return okResp("\u7F3A\u5C11\u89D2\u8272");
      const flag = params?.follow;
      const follow = !(flag === false || flag === 0 || flag === "0" || flag === "false");
      const e0 = s.entities.find((x) => x.id === rid || x.name === rid);
      if (e0 && e0.side === "enemy") return okResp("\u654C\u5BF9\u89D2\u8272\u65E0\u6CD5\u7EC4\u961F");
      // ★ 组队跟随：角色停在别的地图（s.parked）→ 先接回当前图
      let e = e0;
      if (!e && follow) {
        const parked = s.parked || {};
        for (const k of Object.keys(parked)) {
          const arr = Array.isArray(parked[k]) ? parked[k] : [];
          const idx = arr.findIndex((x) => String(x.id) === rid || String(x.name) === rid);
          if (idx >= 0) {
            e = arr.splice(idx, 1)[0];
            s.entities.push(e);
            break;
          }
        }
      }
      // ★ game.md 组队跟随：角色还没上场（无实体）时，先按角色位置规则生成到可活动区域
      if (!e && follow) {
        const role = (s.roles || []).find((r) => String(r?.id) === rid || String(r?.name) === rid);
        e = spawnRoleEntity(s, role);
      }
      if (e && follow) e.mapName = s.levelName || e.mapName;
      const set = new Set(s.partyIds || []);
      if (follow) set.add(rid);
      else set.delete(rid);
      s.partyIds = Array.from(set);
      if (e) {
        if (follow) {
          // 记住入队前的阵营（ally/neutral/spectator），退队时还原——中立 NPC 退队不能变成敌人样
          if (!e._baseSide) e._baseSide = e.side;
          e.side = "ally";
          if (!e.alive) {
            e.alive = true;
            e.hp = e.maxHp;
          }
        } else {
          e.side = e._baseSide || "spectator";
        }
      }
      ensureNpcCards(s, s.levelName || "");
      pushEvent(s, `${e?.name || rid} ${follow ? "\u52A0\u5165\u961F\u4F0D\uFF0C\u5F00\u59CB\u8DDF\u968F\u4F60\u6218\u6597" : "\u5DF2\u8131\u79BB\u961F\u4F0D"}`);
      await persistSys(context, s);
      return okResp(follow ? "\u5DF2\u7EC4\u961F\u8DDF\u968F" : "\u5DF2\u53D6\u6D88\u8DDF\u968F");
    }
    case "sys_teleport": {
      const rid = str(params?.roleId);
      ensureNpcCards(s, s.levelName || "");
      let c = (s.npcCards || []).find((x) => x.id === rid || x.name === rid);
      if (!c) return okResp("\u89D2\u8272\u4E0D\u5B58\u5728");
      // ★ game.md 角色位置问题：没有位置信息的角色，默认生成到可活动区域再传送
      if (!c.onMap) {
        const role = (s.roles || []).find((r) => String(r?.id) === String(c.id) || String(r?.name) === String(c.name));
        const e = spawnRoleEntity(s, role);
        if (e) {
          ensureNpcCards(s, s.levelName || "");
          c = (s.npcCards || []).find((x) => x.id === String(c.id)) || c;
          pushEvent(s, `${c.name} \u5DF2\u751F\u6210\u5230\u53EF\u6D3B\u52A8\u533A\u57DF`);
        }
      }
      s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
      s.teleportTarget = {
        mapName: c.mapName || s.levelName || "",
        x: c.x,
        y: c.y,
        name: c.name,
        rev: s.sysRevision
      };
      pushEvent(s, `\u4F20\u9001\u5230 ${c.name} \u8EAB\u8FB9\uFF08${c.mapName || "\u5F53\u524D\u5730\u56FE"}\uFF09`);
      await persistSys(context, s);
      return okResp(`\u5DF2\u4F20\u9001\u5230 ${c.name} \u8EAB\u8FB9`);
    }
    case "sys_travel": {
      const target = str(params?.mapName);
      if (!target) return okResp("\u7F3A\u5C11\u76EE\u6807\u5730\u56FE");
      s.levelName = target;
      handleLevelChange(s, false);
      s._levelAt = s.levelName;
      ensureNpcCards(s, target);
      s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
      // ★ 大地图传送统一走 teleportTarget 通道（前端只 watch 它；travelTarget 从无人消费，是死代码）
      s.teleportTarget = { mapName: target, x: 0, y: 0, name: target, rev: s.sysRevision };
      pushEvent(s, `\u4F20\u9001\u81F3\u300C${target}\u300D`);
      await persistSys(context, s);
      return okResp(`\u5DF2\u4F20\u9001\u81F3\u300C${target}\u300D`);
    }
    case "sys_chat": {
      // ★ game.md 对话功能：调用角色发言器 agent（task-speaker-agent）
      const npcId = str(params?.npcId, "");
      const npcName = str(params?.npcName, "???");
      const userText = params?.userText ?? null;
      const lastResp = str(params?.lastResp, "");
      if (!npcId) return okResp("\u7F3A\u5C11\u89D2\u8272\u6807\u8BC6");
      // 查找角色
      const npcEntity = s.entities.find((e) => e.id === npcId);
      const npcSide = npcEntity?.side;
      // game.md 中立npc：查找通用角色或旁白
      const isNeutral = npcSide === "neutral";
      const roleEntry = ((s.roles ?? [])).find(
        (r) => String(r?.id) === npcId || String(r?.name) === npcId,
      );
      // 中立npc用通用角色扮演，否则用该角色
      const roleName = isNeutral
        ? "\u65C1\u767D" // 没有通用角色时用旁白
        : str(roleEntry?.name || npcName, npcName);
      const roleCard = isNeutral ? null : (roleEntry || null);

      // 调用角色发言器 agent
      try {
        if (context?.tsApi?.agent) {
          const result = await context.tsApi.agent.run("task-speaker-agent", {
            npcId,
            npcName: roleName,
            npcCard: roleCard,
            isNeutral,
            userText: userText ?? null,
            lastResp: lastResp || null,
            context: {
              storyDigest: context?.sessionId ? `session:${context.sessionId}` : "",
              playerLevel: (s.entities.find((e) => e.side === "player")?.level) ?? 1,
            },
          });
          if (result?.ok && result?.output?.text) {
            const text = String(result.output.text).trim();
            pushEvent(s, `${roleName}\uFF1A${text}`);
            // ★ 台词同步到 Toonflow-game-web 聊天框（response 携带 JSON 给前端转发）
            await persistSys(context, s);
            return okResp(JSON.stringify({ speaker: roleName, text, avatar: roleEntry?.avatarPath ?? undefined }));
          }
          if (result?.error) console.warn("[field-survival] sys_chat agent error:", result.error);
        }
      } catch (e) {
        console.warn("[field-survival] sys_chat agent call failed:", e);
      }
      // 降级：若无 agent 或调用失败，给一条旁白
      const fallbackText = userText
        ? `${roleName}\u82E5\u6709\u6240\u601D\u5730\u56DE\u5E94\u4E86\u4F60\u7684\u8BDD\u3002`
        : `\u4F60\u4E0E${roleName}\u5BF9\u89C6\u3002${roleName}\u5FAE\u5FAE\u70B9\u5934\uFF0C\u5374\u672A\u53D1\u4E00\u8A00\u3002`;
      pushEvent(s, `${roleName}\uFF1A${fallbackText}`);
      await persistSys(context, s);
      return okResp(JSON.stringify({ speaker: roleName, text: fallbackText }));
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
      pushEvent(s, `\u4F60\u5728\u539F\u5730\u590D\u6D3B\uFF08\u751F\u547D ${Math.round(player.hp)}/${Math.round(player.maxHp)}\uFF09`);
      return { code: 0, message: "revive", state: s, response: "\u590D\u6D3B\u6210\u529F" };
    }
    case "exit":
    case "quit": {
      if (s.phase !== "playing") return okResp("");
      s.phase = "over";
      s.result = {
        reason: "exit",
        exp: s.exp,
        money: s.money,
        drops: [...s.drops],
        kills: s.kills,
        survivedTicks: s.tick
      };
      pushEvent(s, "\u4F60\u4E3B\u52A8\u7ED3\u675F\u4E86\u672C\u6B21\u91CE\u5916\u751F\u5B58\u3002");
      return { code: 0, message: "exit", state: s, response: "\u91CE\u5916\u751F\u5B58\u7ED3\u675F" };
    }
    default:
      if (s.phase === "select") {
        return {
          code: 0,
          message: "select_phase",
          state: s,
          response: "\u8BF7\u5148\u5728\u5DE6\u4FA7\u9762\u677F\u9009\u62E9\u89D2\u8272\u5E76\u70B9\u51FB\u300C\u5F00\u59CB\u300D\u6765\u542F\u52A8\u91CE\u5916\u751F\u5B58\u3002"
        };
      }
      return okResp("");
  }
}
export {
  handle_action
};
