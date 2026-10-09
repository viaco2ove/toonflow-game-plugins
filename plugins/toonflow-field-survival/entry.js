var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// entry.ts
var entry_exports = {};
__export(entry_exports, {
  handle_action: () => handle_action
});
module.exports = __toCommonJS(entry_exports);
var TERRAIN_BLOCK_SIZE_M = 0.5;
var CHUNK_SIZE_BLOCKS = 32;
var CHUNK_SIZE_M = CHUNK_SIZE_BLOCKS * TERRAIN_BLOCK_SIZE_M;
var TERRAIN_GROUND_SIZE_M = 3e3;
var TERRAIN_GROUND_HEIGHT_M = 100;
var TERRAIN_SCALE_METER = 1;
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
var MAP_AGENT_TIMEOUT_MS = 12e3;
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
var WORLD_X_RANGE = [-1500, 1500];
var WORLD_Z_RANGE = [-1500, 1500];
var PLAYER_SPAWN = { x: 13, y: 4 };
var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
var rnd = (a, b) => a + Math.random() * (b - a);
var clampX = (v) => clamp(v, WORLD_X_RANGE[0] + 10, WORLD_X_RANGE[1] - 10);
var clampY = (v) => clamp(v, WORLD_Z_RANGE[0] + 10, WORLD_Z_RANGE[1] - 10);
var MOVE_SPEED_M = 3;
var TICK_DT_S = 0.1;
var MOB_ATK_M = 1;
var ALLY_ATK_M = 0.5;
var ALLY_ENGAGE_M = 4;
var ALLY_FOLLOW_GAP_M = 2.5;
var CHEST_PICKUP_M = 2;
var POTION_PICKUP_M = 2;
var SKILL_RANGE_M = 4;
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var REGION_RESPAWN_SEC = 45;
var REGION_RESPAWN_TICKS = REGION_RESPAWN_SEC * 10;
var MOB_DETECT_M = 4;
var MOB_DISENGAGE_M = 4;
var MOB_LEASH_R_M = 4;
var MOB_WANDER_R_M = 3;
var TOWN_SPAWN_BUFFER_M = 20;
var WORLD_REGIONS = [
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
function inferSkillType(name) {
  const n = String(name || "");
  if (/治|疗|愈|回复|恢复|回春|奶|复苏/.test(n)) return { type: "heal", range: "melee" };
  if (/盾|护|祝福|增益|强化|加攻|加防|buff/i.test(n)) return { type: "buff", range: "melee" };
  if (/球|箭|弹|术|咒|射|火|冰|雷|电|风|毒|远程/.test(n)) return { type: "atk", range: "ranged" };
  return { type: "atk", range: "melee" };
}
var BUFF_TYPES = ["Defense", "Attack", "Sustained_Damage", "Stunning", "Invincible", "Accelerate"];
function splitSkillList(raw) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const ch of String(raw)) {
    if (ch === "\uFF08" || ch === "(") depth += 1;
    else if (ch === "\uFF09" || ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && "\u3001,\uFF0C;\uFF1B/|".includes(ch)) {
      out.push(buf);
      buf = "";
      continue;
    }
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
      buff_type: m?.buff_type || "",
      effects_type: m?.effects_type || ""
    });
  }
  return out;
}
function buildItems(card, n = 8) {
  const raw = Array.isArray(card?.items) ? card.items : [];
  const parsed = raw.map(parseItemRaw).filter((p) => p && p.name && p.count > 0);
  const seen = /* @__PURE__ */ new Map();
  const names = [];
  const counts = [];
  parsed.forEach((p) => {
    const k = itemKey(p.name);
    if (!k) return;
    const c = (seen.get(k) || 0) + 1;
    seen.set(k, c);
    if (c === 1) {
      names.push(p.name);
      counts.push(p.count);
    } else {
      counts[counts.length - 1] += p.count;
    }
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    if (names[i]) {
      const meta = parsed.find((p) => itemKey(p.name) === itemKey(names[i]));
      const kind = meta?.kind || guessKind(names[i]);
      const heal = meta?.heal ?? defaultHeal(names[i], kind);
      out.push({ name: names[i], count: counts[i], kind, heal });
    } else {
      out.push({ name: i < 4 ? `\u7269\u54C1${i + 1}` : `\u5907\u7528\u7269${i - 3}`, count: 1, heal: 20 });
    }
  }
  return out;
}
function makeEntity(role, side, x, y, idx) {
  const hp = num(role?.hp, side === "enemy" ? 60 : 100) || 100;
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
    vfx: [],
    // ★ game.md 打击特效：宿主侧生成的战斗粒子（spark/explosion/slash_arc/fireball/heal_ring/buff_ring）
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
    regions: [],
    // ★ v4：由 initRegions() 填充（城镇 + 6 野区）
    town: null,
    // ★ v4：由 ensureTown() 填充（建筑 + 中立角色）
    result: null
  };
}
function pushEvent(s, text) {
  s.events.push(text);
  if (s.events.length > 40) s.events = s.events.slice(-40);
}
function floater(s, text, x, y) {
  s.floaters.push({ id: `f_${s.tick}_${Math.random().toString(36).slice(2, 6)}`, text, x, y, life: 24 });
  if (s.floaters.length > 30) s.floaters = s.floaters.slice(-30);
}
function pushVfx(s, p) {
  if (!Array.isArray(s.vfx)) s.vfx = [];
  s.vfx.push({ id: `vfx_${s.tick}_${Math.random().toString(36).slice(2, 6)}`, ...p });
  if (s.vfx.length > 60) s.vfx = s.vfx.slice(-60);
}
function skillFxKind(skill) {
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
function damage(s, target, amount, attacker) {
  target.hp = clamp(target.hp - amount, 0, target.maxHp);
  if (amount > 0) {
    target.hitFlashMs = 250;
    pushVfx(s, { kind: "spark", entityId: target.id, x: target.x, y: target.y, life: 8, total: 8, color: "#ff5a5a" });
    pushVfx(s, { kind: "explosion", entityId: target.id, x: target.x, y: target.y, life: 6, total: 6, color: "#ff8c3a" });
    if (attacker) attacker.actionBobMs = 300;
    floater(s, `-${Math.round(amount)}`, target.x, target.y - 24);
    s.screenShake = 6;
    s.screenShakeIntensity = 4;
    s.hitStopFrames = 3;
    if (attacker) {
      const dx = target.x - attacker.x, dy = target.y - attacker.y;
      const d = Math.hypot(dx, dy) || 1;
      target.knockbackVx = dx / d * 0.4;
      target.knockbackVy = dy / d * 0.4;
    }
  }
  if (target.hp <= 0 && target.alive) {
    target.deathMs = 400;
    if (target.side === "enemy") {
      s.kills += 1;
      const bounty = target.bounty;
      const expGain = bounty?.exp != null ? Math.round(num(bounty.exp, 10)) : 8 + target.level * 4;
      const moneyGain = bounty?.money != null ? Math.round(num(bounty.money, 8)) : 5 + target.level * 3;
      gainPlayerExp(s, expGain);
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
var LOCAL_ENEMY_PREFIXES = ["mapmob_", "localmob_", "zone_"];
function isLocalEnemyId(id) {
  const v = str(id);
  return LOCAL_ENEMY_PREFIXES.some((p) => v.startsWith(p));
}
var enemyNav = null;
var enemyNavEpoch = "";
var ENEMY_NAV_R = 0.38;
var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64ToBytes(b64) {
  const clean = String(b64 || "").replace(/[^A-Za-z0-9+/]/g, "");
  if (!clean) return null;
  const n = clean.length;
  const out = new Uint8Array(Math.floor(n * 3 / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const v = B64_ALPHABET.indexOf(clean.charAt(i));
    if (v < 0) continue;
    buf = buf << 6 | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = buf >> bits & 255;
    }
  }
  return o === out.length ? out : out.slice(0, o);
}
function applyEnemyNavPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  const epoch = str(payload.epoch, "");
  if (epoch && epoch === enemyNavEpoch) return;
  const pkt = payload.grid;
  if (!pkt || num(pkt.v, 0) !== 1) return;
  const cols = num(pkt.cols, 0);
  const rows = num(pkt.rows, 0);
  const total = cols * rows;
  if (!(cols > 0) || !(rows > 0) || total > 4e6) return;
  const bytes = b64ToBytes(str(pkt.blocked, ""));
  if (!bytes || bytes.length !== total) {
    console.warn("[field-survival] walkGrid \u8F7D\u8377\u89E3\u7801\u5931\u8D25\uFF0C\u4FDD\u6301\u4E0A\u4E00\u4EFD\u7F51\u683C\uFF1A", bytes?.length, total);
    return;
  }
  enemyNav = { cols, rows, blocked: bytes };
  enemyNavEpoch = epoch;
}
function navBlocked(g, gx, gz) {
  if (gx < 0 || gx >= g.cols || gz < 0 || gz >= g.rows) return true;
  return g.blocked[gz * g.cols + gx] === 1;
}
function navFree(g, x, y, r) {
  const toGx = (mx) => Math.floor(mx + g.cols / 2);
  const toGz = (my) => Math.floor(my + g.rows / 2);
  if (r <= 0) return !navBlocked(g, toGx(x), toGz(y));
  const left = toGx(x - r);
  const right = toGx(x + r);
  const top = toGz(y - r);
  const bottom = toGz(y + r);
  return !navBlocked(g, left, top) && !navBlocked(g, right, top) && !navBlocked(g, left, bottom) && !navBlocked(g, right, bottom);
}
function navResolve(g, x, y, nx, ny, r) {
  if (!navFree(g, x, y, r)) return { x: nx, y: ny };
  let outX = x;
  let outY = y;
  if (navFree(g, nx, y, r)) outX = nx;
  if (navFree(g, outX, ny, r)) outY = ny;
  return { x: outX, y: outY };
}
var NAV_DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1]
];
function navStep(g, x, y, dx, dy, step2, r) {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return { x, y };
  const ux = dx / len;
  const uy = dy / len;
  const order = NAV_DIRS.map(([ax, ay]) => {
    const l = Math.hypot(ax, ay);
    const nx = ax / l;
    const ny = ay / l;
    return { nx, ny, dot: nx * ux + ny * uy };
  }).filter((c) => c.dot > -0.35).sort((a, b) => b.dot - a.dot);
  for (const c of order) {
    const nx = x + c.nx * step2;
    const ny = y + c.ny * step2;
    if (navFree(g, nx, ny, r)) return { x: nx, y: ny };
  }
  return navResolve(g, x, y, x + ux * step2, y + uy * step2, r);
}
function navNearestFree(g, x, y, r, maxRing = 8) {
  const cgx = Math.floor(x + g.cols / 2);
  const cgz = Math.floor(y + g.rows / 2);
  const center = (gx, gz) => ({
    x: gx - g.cols / 2 + 0.5,
    y: gz - g.rows / 2 + 0.5
  });
  if (navFree(g, x, y, r)) return { x, y };
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let d = -ring; d <= ring; d++) {
      const cand = [
        [cgx + d, cgz - ring],
        [cgx + d, cgz + ring],
        [cgx - ring, cgz + d],
        [cgx + ring, cgz + d]
      ];
      for (const [gx, gz] of cand) {
        const c = center(gx, gz);
        if (navFree(g, c.x, c.y, r)) return c;
      }
    }
  }
  return null;
}
function moveEnemyCollide(e, dx, dy) {
  if (!enemyNav) {
    e.x += dx;
    e.y += dy;
    return;
  }
  const step2 = Math.hypot(dx, dy);
  if (step2 < 1e-6) return;
  const p = navStep(enemyNav, e.x, e.y, dx, dy, step2, ENEMY_NAV_R);
  e.x = p.x;
  e.y = p.y;
}
function unstickEnemies(s) {
  if (!enemyNav) return;
  for (const e of s.entities) {
    if (e.side !== "enemy" || !e.alive) continue;
    if (navFree(enemyNav, e.x, e.y, ENEMY_NAV_R)) continue;
    const c = navNearestFree(enemyNav, e.x, e.y, ENEMY_NAV_R);
    if (!c) continue;
    e.x = c.x;
    e.y = c.y;
    if ("homeX" in e && !navFree(enemyNav, num(e.homeX, c.y), ENEMY_NAV_R)) {
      e.homeX = c.x;
    }
    if ("homeY" in e && !navFree(enemyNav, c.x, num(e.homeY), ENEMY_NAV_R)) {
      e.homeY = c.y;
    }
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
function defaultSpawnPoint(s, i, n) {
  const cnt = Math.max(1, n | 0);
  const ang = i % cnt / cnt * Math.PI * 2 + rnd(0, Math.PI * 0.35);
  const rad = 6 + Math.random() * 14;
  return clampToBound(s, Math.cos(ang) * rad, Math.sin(ang) * rad);
}
function fixSpawnWithNav(s) {
  if (!enemyNav || !Array.isArray(s.entities)) return;
  for (const e of s.entities) {
    if (!e || !e._needNavFix) continue;
    const free = navNearestFree(enemyNav, e.x, e.y, 0.4, 12) || navNearestFree(enemyNav, e.x, e.y, 0.4, 24);
    if (free) {
      e.x = free.x;
      e.y = free.y;
      e.homeX = free.x;
      e.homeY = free.y;
    }
    delete e._needNavFix;
  }
}
function regionOutOfMap(s, r) {
  const b = s.mapBounds;
  if (!b || !(num(b.lx, 0) > 0) || !(num(b.ly, 0) > 0)) return false;
  return Math.abs(r.x) - r.r >= num(b.lx, 0) || Math.abs(r.y) - r.r >= num(b.ly, 0);
}
function applyLocalEnemies(s, payload) {
  if (!payload || typeof payload !== "object") {
    if (num(s.localMobsEpoch, 0) > 0) return -1;
    return 0;
  }
  const epoch = num(payload.epoch, 0);
  if (epoch > 0 && num(s.localMobsEpoch, 0) === epoch) {
    const alive = s.entities.filter((e) => e.side === "enemy" && isLocalEnemyId(e.id)).length;
    if (alive > 0) return 0;
  }
  const b = payload.bounds || {};
  const lx = num(b.lx, 0);
  const ly = num(b.ly, 0);
  if (lx > 0 && ly > 0) s.mapBounds = { lx, ly };
  const list = Array.isArray(payload.list) ? payload.list : [];
  s.entities = s.entities.filter((e) => !(e.side === "enemy" && isLocalEnemyId(e.id)));
  if (lx > 0 && ly > 0) {
    s.entities = s.entities.filter((e) => {
      if (e.side !== "enemy" || isLocalEnemyId(e.id)) return true;
      return String(e.id).startsWith("mob_") ? false : Math.abs(e.x) <= lx && Math.abs(e.y) <= ly;
    });
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
var REGION_MOB_NAMES = {
  wood: ["\u5DE8\u72FC", "\u54E5\u5E03\u6797\u65A5\u5019"],
  shore: ["\u6BD2\u86C7", "\u8759\u8760"],
  mine: ["\u9AB7\u9AC5\u5175", "\u54E5\u5E03\u6797\u65A5\u5019"],
  ruin: ["\u9AB7\u9AC5\u5175", "\u8352\u91CE\u6E38\u8361\u8005"],
  marsh: ["\u6BD2\u86C7", "\u5DE8\u72FC"],
  wild: ["\u54E5\u5E03\u6797\u65A5\u5019", "\u5DE8\u72FC", "\u8352\u91CE\u6E38\u8361\u8005"]
};
var MOB_PRESETS = {
  "\u54E5\u5E03\u6797\u65A5\u5019": { hp: 30, atk: 6 },
  "\u5DE8\u72FC": { hp: 60, atk: 10 },
  "\u6BD2\u86C7": { hp: 25, atk: 8 },
  "\u8759\u8760": { hp: 20, atk: 5 },
  "\u9AB7\u9AC5\u5175": { hp: 50, atk: 12 },
  "\u8352\u91CE\u6E38\u8361\u8005": { hp: 40, atk: 6 }
};
var _mobSeq = 0;
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
  if (num(s.localMobsEpoch, 0) > 0) return;
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
var TOWN_BUILDINGS = [];
var TOWN_NPCS = [];
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
    const target = enemies.filter((e) => dist(player, e) < ALLY_ENGAGE_M).reduce((best, e) => !best || dist(player, e) < dist(player, best) ? e : best, null);
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
    if (e.hitFlashMs > 0) e.hitFlashMs = Math.max(0, e.hitFlashMs - 100);
    if (e.actionBobMs > 0) e.actionBobMs = Math.max(0, e.actionBobMs - 100);
    if (e.knockbackVx != null || e.knockbackVy != null) {
      e.vx += e.knockbackVx || 0;
      e.vy += e.knockbackVy || 0;
      e.knockbackVx = (e.knockbackVx || 0) * 0.75;
      e.knockbackVy = (e.knockbackVy || 0) * 0.75;
      if (Math.abs(e.knockbackVx) < 1e-3) e.knockbackVx = void 0;
      if (Math.abs(e.knockbackVy) < 1e-3) e.knockbackVy = void 0;
    }
    if (e.deathMs != null && e.deathMs > 0) {
      e.deathMs = Math.max(0, e.deathMs - 100);
      if (e.deathMs === 0) e.alive = false;
    }
    const nx = e.x + e.vx * TICK_DT_S;
    const ny = e.y + e.vy * TICK_DT_S;
    if (e.side === "enemy" && e.isLocal) {
      const p = clampToBound(s, nx, ny);
      if (enemyNav) moveEnemyCollide(e, p.x - e.x, p.y - e.y);
      else {
        e.x = p.x;
        e.y = p.y;
      }
    } else if (e.side === "enemy" && enemyNav) {
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
  const _vfx = s.vfx;
  if (Array.isArray(_vfx) && _vfx.length) s.vfx = _vfx.filter((v) => {
    v.life -= 1;
    return v.life > 0;
  });
  s.chests.forEach((c) => {
    if (c.opened) return;
    if (dist(player, c) < CHEST_PICKUP_M) {
      c.opened = true;
      const loot = c.loot;
      const expGain = loot?.exp != null ? Math.round(num(loot.exp, 15)) : 12 + Math.floor(rnd(0, 10));
      const moneyGain = loot?.money != null ? Math.round(num(loot.money, 12)) : 15 + Math.floor(rnd(0, 20));
      const drop = loot?.item || ["\u751F\u9508\u7684\u94A5\u5319", "\u5E72\u7CAE", "\u8367\u5149\u77F3"][Math.floor(Math.random() * 3)];
      gainPlayerExp(s, expGain);
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
var SYS_DATA_KEY = "sys_state";
var AI_STORY_ROLES_KEY = "ai_story_roles";
var SYS_PERSIST_EVERY_TICKS = 20;
var EFFECT_COLOR = {
  normal: "#eeeeee",
  fire: "#ff4422",
  water: "#33bbff",
  thunder: "#f8ff33",
  wind: "#a8ffdd",
  earth: "#b88646",
  metal: "#ffdd66",
  wood: "#46cc55",
  light: "#fffcd0",
  dark: "#662288",
  poison: "#88dd22",
  bleed: "#bb1122"
};
function effectColor(effectsType, fallback) {
  const c = EFFECT_COLOR[String(effectsType || "")];
  return c || fallback;
}
var EFFECT_ICON = {
  normal: "images/spells/enchantment/sure_blade.png",
  fire: "images/spells/fire/fireball.png",
  water: "images/spells/ice/freeze.png",
  thunder: "images/spells/air/lightning_bolt.png",
  wind: "images/spells/air/tornado.png",
  earth: "images/spells/earth/iron_shot.png",
  metal: "images/spells/earth/iron_shot.png",
  wood: "images/spells/poison/poison_arrow.png",
  light: "images/spells/restoration/minor_heal.png",
  dark: "images/spells/necromancy/agony.png",
  poison: "images/spells/poison/alistairs_intoxication.png",
  bleed: "images/spells/necromancy/bolt_of_draining.png"
};
function effectIcon(effectsType) {
  return EFFECT_ICON[String(effectsType || "")] || "";
}
var RARITY_PRICE = { common: 8, fine: 22, rare: 60, epic: 180, legend: 520 };
var RARITY_LIST = ["common", "fine", "rare", "epic", "legend"];
var KIND_LIST = ["consumable", "material", "equipment", "skill_book", "quest"];
var BUILTIN_SHOP_GOODS = [
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
function sameName(a, b) {
  const ka = itemKey(a);
  return !!ka && ka === itemKey(b);
}
function parseItemRaw(raw) {
  if (raw && typeof raw === "object") {
    const name2 = str(raw.name ?? raw.item ?? "");
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
  const noParen = text.replace(/[（(][^）)]*[）)]\s*$/, "").trim() || text;
  const m = noParen.match(/^(.*?)[×xX*]\s*(\d+)\s*$/);
  if (m) {
    const name2 = m[1].replace(/\[object Object\]/g, " ").replace(/\s+/g, " ").trim();
    if (!name2) return { name: "", count: 0, kind: "material", rarity: "common", heal: 0, price: 0 };
    const kind2 = guessKind(name2);
    return { name: name2, count: Math.max(1, parseInt(m[2], 10) || 1), kind: kind2, rarity: "common", heal: defaultHeal(name2, kind2), price: 0 };
  }
  const p = text.match(/[（(](.*?)[)）]\s*$/);
  const name = noParen.replace(/\[object Object\]/g, " ").replace(/\s+/g, " ").trim();
  const kind = guessKind(name);
  return { name, count: 1, kind, rarity: "common", heal: defaultHeal(name, kind), price: 0, desc: p ? p[1] : void 0 };
}
function itemsFromCard(card) {
  const arr = Array.isArray(card?.items) ? card.items : [];
  return arr.map(parseItemRaw).filter((i) => i.name && i.count > 0);
}
function mergeBag(raw, meta, order, imeta) {
  const map = /* @__PURE__ */ new Map();
  raw.forEach((it) => {
    const m = meta ? meta[it.name] : void 0;
    const im = imeta ? imeta[it.name] || imeta[it.name.toLowerCase()] : void 0;
    const bt = inferItemType(it.name, it.kind);
    const cur = map.get(it.name);
    if (cur) {
      cur.count += it.count;
      return;
    }
    map.set(it.name, {
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
      attribute_value: num(im?.attribute_value, defaultItemAttrValue(it.name)),
      effects_type: im?.effects_type || ""
    });
  });
  const list = Array.from(map.values());
  const idx = /* @__PURE__ */ new Map();
  (order || []).forEach((n, i) => idx.set(n, i));
  return list.sort((a, b) => {
    const ia = idx.has(a.name) ? idx.get(a.name) : 9999;
    const ib = idx.has(b.name) ? idx.get(b.name) : 9999;
    return ia - ib;
  });
}
function serializeBag(bag, cardItems) {
  if (Array.isArray(cardItems)) {
    const flat = [];
    cardItems.forEach((x) => {
      if (typeof x === "string") splitSkillList(x).forEach((p) => {
        if (cleanName(p)) flat.push(p.trim());
      });
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
var ITEM_TYPES = ["atk", "heal", "buff", "attribute"];
var ITEM_ATTR_TYPES = ["Defense", "Attack", "Life", "Blue"];
function inferItemType(name, kind) {
  const n = String(name || "");
  if (kind === "skill_book") return { type: "buff", range: "melee" };
  if (kind === "equipment" || /刀|剑|枪|弓|弩|斧|杖|匕|爪|锤/.test(n)) return { type: "atk", range: /弓|弩|杖/.test(n) ? "ranged" : "melee" };
  if (/力量|攻击|加攻/.test(n)) return { type: "attribute", range: "melee" };
  return { type: "heal", range: "melee" };
}
function inferItemAttrType(name) {
  const n = String(name || "");
  if (/防御|护甲|加防|体魄|磐/.test(n)) return "Defense";
  if (/蓝|法力|灵力|魔力/.test(n)) return "Blue";
  if (/生命|血量|体质/.test(n)) return "Life";
  if (/力量|攻击|加攻/.test(n)) return "Attack";
  return "";
}
function defaultItemAttrValue(name) {
  const m = String(name || "").match(/[＋+]\s*(\d+)/);
  return m ? Math.round(Number(m[1])) : 0;
}
function setItemDurLeft(s, name, v) {
  const cur = (s.itemMeta || {})[name] || {};
  s.itemMeta = { ...s.itemMeta || {}, [name]: { ...cur, durabilityLeft: v } };
}
function bagAttributeBonus(s) {
  const card = s.playerCard || {};
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const bonus = { Defense: 0, Attack: 0, Life: 0, Blue: 0 };
  bag.forEach((it) => {
    const v = Math.round(num(it.attribute_value, 0));
    if (v !== 0 && ITEM_ATTR_TYPES.indexOf(it.attribute_type || "") >= 0) bonus[it.attribute_type] += v;
  });
  return bonus;
}
var STAT_BASE = { hp: 100, mp: 100, atk: 10, def: 1 };
var STAT_PER_LEVEL = 10;
var PLAYER_ATTR_KEYS = ["Life", "Blue", "Attack", "Defense"];
function permAttributeBonus(s) {
  const out = { Life: 0, Blue: 0, Attack: 0, Defense: 0 };
  const card = s.playerCard || {};
  const add = (k, v) => {
    if (PLAYER_ATTR_KEYS.indexOf(k) >= 0) out[k] += Math.round(num(v, 0));
  };
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
function playerMaxStats(s, level) {
  const me = playerEntity(s);
  const lv = Math.max(1, Math.round(num(level, num(me?.level, 1))));
  const bag = bagAttributeBonus(s);
  const perm = permAttributeBonus(s);
  const sum = (k) => Math.round(num(bag[k], 0) + num(perm[k], 0));
  return {
    maxHp: Math.max(1, STAT_BASE.hp + lv * STAT_PER_LEVEL + sum("Life")),
    maxMp: Math.max(0, STAT_BASE.mp + lv * STAT_PER_LEVEL + sum("Blue")),
    atk: Math.max(1, STAT_BASE.atk + lv * STAT_PER_LEVEL + sum("Attack")),
    def: Math.max(0, STAT_BASE.def + lv * STAT_PER_LEVEL + sum("Defense"))
  };
}
function playerNextExp(level) {
  return Math.max(1, Math.round(num(level, 1))) * 100;
}
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
var LEVEL_DESC_MAP_KEYS = ["level_desc_map", "level_titles", "level_title_map", "level_desc_table", "\u7B49\u7EA7\u79F0\u53F7\u8868"];
function resolveLevelDesc(card, level) {
  for (const key of LEVEL_DESC_MAP_KEYS) {
    const m = card?.[key];
    if (m && typeof m === "object") {
      const v = m[String(level)] ?? m[level];
      return v == null ? "" : String(v);
    }
  }
  return null;
}
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
  if (!ups) {
    refreshPlayerExpFields(s);
    return 0;
  }
  me.level = lv;
  s.exp = exp;
  applyBagAttributes(s, { full: true });
  const card = s.playerCard || {};
  const desc = resolveLevelDesc(card, lv);
  syncPlayerCardStats(s, desc == null ? {} : { level_desc: desc });
  floater(s, `Lv.${lv} \u2191`, me.x, me.y - 40);
  pushEvent(s, `\u5347\u7EA7\u5230 Lv.${lv}\uFF08\u7ECF\u9A8C ${exp}/${playerNextExp(lv)}\uFF0CHP/MP \u5DF2\u6309\u516C\u5F0F\u8865\u6EE1\uFF09`);
  return ups;
}
function gainPlayerExp(s, amount) {
  const gain = Math.round(num(amount, 0));
  if (gain <= 0) return;
  s.exp = Math.max(0, Math.round(num(s.exp, 0)) + gain);
  checkPlayerLevelUp(s);
  syncPlayerCardStats(s);
}
function restorePlayerFull(s, reason) {
  const me = playerEntity(s);
  if (!me) return;
  applyBagAttributes(s, { full: true });
  const card = s.playerCard || {};
  const other = (Array.isArray(card.other) ? card.other.map((x) => String(x)) : []).slice(-20);
  const note = `${reason}\uFF1A\u{1F389} \u606D\u559C\u60A8\u5DF2\u6062\u590D\u5230\u6700\u4F73\u72B6\u6001\uFF08HP ${Math.round(me.hp)}/${Math.round(me.maxHp)}\uFF0CMP ${Math.round(num(me.mp, 0))}/${Math.round(num(me.maxMp, 0))}\uFF09`;
  other.push(note);
  syncPlayerCardStats(s, { other });
  floater(s, "\u6EE1\u8840\u6EE1\u84DD", me.x, me.y - 40);
  pushEvent(s, note);
}
function initPlayerFromCard(s, playerRole) {
  const me = playerEntity(s);
  if (!me) return;
  const card = (s.playerCard && Object.keys(s.playerCard).length ? s.playerCard : playerRole?.parameterCardJson || playerRole?.parameter_card_json || {}) || {};
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
function applyBagAttributes(s, opts) {
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
function useBagItem(s, name) {
  const me = playerEntity(s);
  if (!me || !me.alive) return "\u89D2\u8272\u4E0D\u53EF\u7528";
  const card = s.playerCard || {};
  const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
  const it = bag.find((x) => x.name === name);
  if (!it || it.count <= 0) return `\u300C${name}\u300D\u4E0D\u5728\u80CC\u5305\u4E2D`;
  const t = it.type || "heal";
  me.actionBobMs = 300;
  floater(s, `\u4F7F\u7528 ${it.name}`, me.x, me.y - 34);
  let consumed = true;
  let msg = `\u4F7F\u7528 ${it.name}`;
  if (t === "heal") {
    const heal = it.heal || defaultHeal(it.name, it.kind);
    const before = me.hp;
    if (heal > 0) me.hp = clamp(me.hp + heal, 0, me.maxHp);
    pushVfx(s, { kind: "heal_ring", entityId: me.id, x: me.x, y: me.y, life: 18, total: 18, color: effectColor(it.effects_type, "#7CFFB2"), icon: effectIcon(it.effects_type), size: 1 });
    if (heal > 0) {
      floater(s, `+${Math.round(me.hp - before)}`, me.x, me.y - 52);
      msg += `\uFF0C\u6062\u590D ${Math.round(me.hp - before)} \u751F\u547D`;
    }
  } else if (t === "buff") {
    pushVfx(s, { kind: "buff_ring", entityId: me.id, x: me.x, y: me.y, life: 30, total: 30, color: effectColor(it.effects_type, "#9CCFFF"), icon: effectIcon(it.effects_type), size: 1 });
    if (it.buff_type) msg += `\uFF08${it.buff_type}\uFF09`;
  } else {
    const targets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(me, e) < SKILL_RANGE_M);
    if ((it.range || "melee") === "ranged" && targets[0]) {
      pushVfx(s, { kind: "fireball", entityId: me.id, targetEntityId: targets[0].id, x: me.x, y: me.y, targetX: targets[0].x, targetY: targets[0].y, facing: me.facing, life: 16, total: 16, color: effectColor(it.effects_type, "#ff6a00"), icon: effectIcon(it.effects_type), size: 1 });
    } else {
      pushVfx(s, { kind: "slash_arc", entityId: me.id, x: me.x, y: me.y, facing: me.facing, life: 12, total: 12, color: effectColor(it.effects_type, "#fff"), icon: effectIcon(it.effects_type), size: 1.6 });
    }
    if (num(it.power, 0) > 0 && targets.length) {
      damage(s, targets[0], num(it.power, 0), me);
      msg += `\uFF0C\u547D\u4E2D ${targets[0].name}`;
    }
    if (t === "attribute") {
      consumed = false;
      msg += `\uFF08\u5C5E\u6027\u70B9 ${it.attribute_type || "-"}+${it.attribute_value || 0}\uFF09`;
    }
  }
  let nextBag = bag;
  if (consumed) {
    const dur = Math.round(num(it.durability, -1));
    if (dur < 0) {
      nextBag = bag;
    } else if (dur === 0) {
      nextBag = bag.map((x) => x.name === it.name ? { ...x, count: x.count - 1 } : x).filter((x) => x.count > 0);
    } else {
      let left = Math.round(num(it.durabilityLeft, dur));
      left -= 1;
      if (left <= 0) {
        nextBag = bag.map((x) => x.name === it.name ? { ...x, count: x.count - 1 } : x).filter((x) => x.count > 0);
        setItemDurLeft(s, it.name, dur);
        pushEvent(s, `${it.name} \u8010\u4E45\u8017\u5C3D\uFF0C\u635F\u6BC1 1 \u4E2A`);
      } else {
        setItemDurLeft(s, it.name, left);
        pushEvent(s, `${it.name} \u8010\u4E45 ${left}/${dur}`);
      }
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
  if (Array.isArray(patch.items)) s.items = buildItems(card, 8);
  if (Array.isArray(patch.skills)) s.skills = buildSkills(card, 8, s.skillMeta);
}
function syncCardFromContext(s, ctx) {
  const card = ctx?.playerCard || {};
  if (!card || !Object.keys(card).length) return;
  const cur = s.playerCard || {};
  const sig = (c) => JSON.stringify([
    c?.items ?? null,
    c?.money ?? null,
    c?.skills ?? null,
    c?.level ?? null,
    c?.exp ?? null,
    c?.hp ?? null,
    c?.mp ?? null
    // ★ 等级系统字段
  ]);
  if (sig(card) === sig(cur)) return;
  s.playerCard = card;
  s.items = buildItems(card, 8);
  s.skills = buildSkills(card, 8, s.skillMeta);
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
  const roles = Array.isArray(s.roles) ? s.roles : [];
  const entByKey = /* @__PURE__ */ new Map();
  (s.entities || []).forEach((e) => {
    entByKey.set(String(e.id), e);
    if (!entByKey.has(String(e.name))) entByKey.set(String(e.name), e);
  });
  const parkedObj = s.parked || {};
  Object.keys(parkedObj).forEach((k) => {
    (Array.isArray(parkedObj[k]) ? parkedObj[k] : []).forEach((e) => {
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
    const pcRaw = side === "player" && s.playerCard && Object.keys(s.playerCard || {}).length ? s.playerCard : role.parameterCardJson || role.parameter_card_json || old && old.parameterCardJson || null;
    let pc = null;
    if (pcRaw && typeof pcRaw === "object") {
      pc = { ...pcRaw };
      pc.level = Math.max(1, Math.round(num(e ? e.level : num(role.initial_level, num(pc.level, 1)), 1)));
      if (e) {
        pc.hp = Math.round(num(e.hp, num(pc.hp, 0)));
        pc.maxHp = Math.round(num(e.maxHp, num(pc.maxHp, pc.hp)));
        pc.mp = Math.round(num(e.mp, num(pc.mp, 0)));
        pc.maxMp = Math.round(num(e.maxMp, num(pc.maxMp, pc.mp)));
      }
      if (side === "player") {
        pc.money = num(s.playerCard?.money, num(pc.money, 0));
        pc.exp = Math.round(num(s.playerCard?.exp, num(s.exp, 0)));
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
      level: Math.max(1, Math.round(num(e ? e.level : num(role.initial_level, num(old?.level, 1)), 1))),
      hp: Math.round(e ? e.hp : num(old?.hp, num(pc?.hp, 0))),
      maxHp: Math.round(e ? e.maxHp : num(old?.maxHp, num(pc?.maxHp, 0))),
      exp: Math.round(num(old?.exp, 0)),
      alive: e ? !!e.alive : old ? old.alive !== false : true,
      mapName: side === "player" ? levelName || old?.mapName || "" : e && e.mapName || old?.mapName || "",
      x: Math.round(e ? e.x : num(old?.x, Math.random() * 100)),
      y: Math.round(e ? e.y : num(old?.y, Math.random() * 100)),
      inParty: party.indexOf(String(role.id)) >= 0,
      avatarPath: e && e.avatarPath || role.avatarPath || old && old.avatarPath || void 0,
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
    (s.entities || []).forEach((e) => pushCard({ id: e.id, name: e.name, avatarPath: e.avatarPath }, e.side));
  }
  s.npcCards = cards;
}
function spawnRoleEntity(s, role) {
  if (!role) return null;
  const exist = s.entities.find((x) => x.id === String(role.id) || x.name === String(role.name));
  if (exist) return exist;
  const sel = s.selections || {};
  const inSel = (arr) => Array.isArray(arr) && arr.some((x) => String(x) === String(role.id) || String(x) === String(role.name));
  const roleType = str(role?.roleType);
  let side;
  if (roleType === "player") side = "player";
  else if (inSel(sel.enemies)) side = "enemy";
  else if (inSel(sel.participants)) side = "ally";
  else if (roleType === "npc" || roleType === "system" || roleType === "general") side = "ally";
  else side = "spectator";
  const allyCount0 = s.entities.filter((x) => x.side === "ally").length;
  const dp = defaultSpawnPoint(s, allyCount0, Math.max(6, allyCount0 + 1));
  let target = { x: dp.x, y: dp.y };
  if (enemyNav) {
    const free = navNearestFree(enemyNav, target.x, target.y, 0.4, 8) || navNearestFree(enemyNav, target.x, target.y, 0.4, 20);
    if (free) target = free;
  }
  const e = makeEntity(role, side, target.x, target.y, s.entities.length);
  e.homeX = e.x;
  e.homeY = e.y;
  e.mapName = s.levelName || "";
  e.roleType = roleType;
  if (side === "enemy") {
    e.aiState = "idle";
    e.regionId = (nearestWildRegion(e.x, e.y) || {}).id;
  } else {
    e.aiState = "idle";
  }
  s.entities.push(e);
  return e;
}
var START_MAP_NAME = "Mulberry Town";
function roleKeyOf(e) {
  return String(e && (e.id || e.name) || "");
}
function unparkRole(s, rid) {
  if (!s || !s.parked || typeof s.parked !== "object") return null;
  const key = String(rid || "");
  if (!key) return null;
  let hit = null;
  Object.keys(s.parked).forEach((k) => {
    const arr = Array.isArray(s.parked[k]) ? s.parked[k] : [];
    s.parked[k] = arr.filter((x) => {
      const same = String(x && (x.id || x.name)) === key;
      if (same && !hit) hit = x;
      return !same;
    });
  });
  return hit;
}
function parkRole(s, e, mapName) {
  if (!s || !e) return;
  const key = String(mapName || e.mapName || s.levelName || "");
  if (!key) return;
  if (!s.parked || typeof s.parked !== "object") s.parked = {};
  unparkRole(s, roleKeyOf(e));
  let x = num(e.x, NaN), y = num(e.y, NaN);
  if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 1e3 || Math.abs(y) > 1e3) {
    x = num(e.homeX, 0);
    y = num(e.homeY, 0);
    if (!isFinite(x) || !isFinite(y)) {
      x = 0;
      y = 0;
    }
  }
  e.x = x;
  e.y = y;
  e.mapName = key;
  if (!Array.isArray(s.parked[key])) s.parked[key] = [];
  s.parked[key].push(e);
}
function dedupeRoles(s) {
  if (!s) return;
  const seen = /* @__PURE__ */ new Set();
  if (Array.isArray(s.entities)) {
    s.entities = s.entities.filter((e) => {
      if (!e) return false;
      if (String(e.side) === "enemy") return true;
      const k = roleKeyOf(e);
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (s.parked && typeof s.parked === "object") {
    Object.keys(s.parked).forEach((k) => {
      const arr = Array.isArray(s.parked[k]) ? s.parked[k] : [];
      s.parked[k] = arr.filter((e) => {
        if (!e) return false;
        const key = roleKeyOf(e);
        if (!key) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
  }
}
function handleLevelChange(s, snapParty) {
  if (!Array.isArray(s.entities)) return;
  const lv = s.levelName || "";
  const parkedAny = s;
  parkedAny.parked = parkedAny.parked && typeof parkedAny.parked === "object" ? parkedAny.parked : {};
  dedupeRoles(s);
  const party = (s.partyIds || []).map((x) => String(x));
  const player = s.entities.find((e2) => e2.side === "player");
  const seen = /* @__PURE__ */ new Set();
  const stay = [];
  (s.entities || []).forEach((e2) => {
    if (e2.side === "player") {
      e2.mapName = lv;
      stay.push(e2);
      seen.add(roleKeyOf(e2));
      return;
    }
    if (String(e2.side) === "enemy") {
      if (e2.isLocal || isLocalEnemyId(e2.id)) return;
      stay.push(e2);
      return;
    }
    if (!e2.mapName) e2.mapName = s.startMapName || START_MAP_NAME;
    if (party.indexOf(String(e2.id)) >= 0) {
      e2.mapName = lv;
      if (snapParty && player) {
        const ang = rnd(0, Math.PI * 2);
        const cb = clampToBound(s, player.x + Math.cos(ang) * ALLY_FOLLOW_GAP_M, player.y + Math.sin(ang) * ALLY_FOLLOW_GAP_M);
        e2.x = cb.x;
        e2.y = cb.y;
      }
      stay.push(e2);
      seen.add(roleKeyOf(e2));
    } else if (e2.mapName === lv) {
      stay.push(e2);
      seen.add(roleKeyOf(e2));
    } else {
      parkRole(s, e2, e2.mapName);
    }
  });
  const back = Array.isArray(parkedAny.parked[lv]) ? parkedAny.parked[lv] : [];
  back.forEach((e2) => {
    const k = roleKeyOf(e2);
    if (k && seen.has(k)) return;
    e2.mapName = lv;
    stay.push(e2);
    seen.add(k);
  });
  parkedAny.parked[lv] = [];
  s.entities = stay;
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
      c.exp -= playerNextExp(num(c.level, 1));
      c.level = Math.max(1, Math.round(num(c.level, 1))) + 1;
      ups += 1;
    }
    c.maxHp = STAT_BASE.hp + c.level * STAT_PER_LEVEL;
    c.maxMp = STAT_BASE.mp + c.level * STAT_PER_LEVEL;
    if (ups > 0) {
      c.hp = c.maxHp;
      c.mp = c.maxMp;
    } else {
      c.hp = clamp(num(c.hp, c.maxHp), 0, c.maxHp);
      c.mp = clamp(num(c.mp, c.maxMp), 0, c.maxMp);
    }
    c.next_level_exp = playerNextExp(c.level);
    const e = s.entities.find((x) => x.id === pid);
    if (e) {
      e.level = c.level;
      e.maxHp = c.maxHp;
      e.hp = c.hp;
      e.maxMp = c.maxMp;
      e.mp = c.mp;
      e.exp = c.exp;
      e.expToNext = playerNextExp(c.level);
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
      itemMeta: s.itemMeta || {},
      // ★ 角色驻留地图：ally/spectator 角色停在别的地图（s.parked）→ 持久化到 t_plugin_session_data
      parked: s.parked || {}
    });
    const aiRoles = collectAiStoryRoles(s);
    await api.set(AI_STORY_ROLES_KEY, {
      roles: aiRoles,
      level: s.levelName || "",
      updatedAt: Date.now()
    });
  } catch {
  }
}
function collectAiStoryRoles(s) {
  const arr = [];
  const ents = Array.isArray(s.entities) ? s.entities : [];
  for (const e of ents) {
    if (!e) continue;
    const rt = String(e.roleType || "");
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
  const parkedObj = s.parked || {};
  const roleMap = new Map((Array.isArray(s.roles) ? s.roles : []).map((r) => [String(r.id), r]));
  Object.keys(parkedObj).forEach((k) => {
    (Array.isArray(parkedObj[k]) ? parkedObj[k] : []).forEach((pe) => {
      if (!pe || !pe.id) return;
      const role = roleMap.get(String(pe.id)) || roleMap.get(String(pe.name));
      const rt2 = role ? String(role.roleType || "") : "";
      if (!rt2) return;
      const side2 = String(pe._baseSide || pe.side || "ally");
      arr.push({
        id: String(pe.id),
        name: String(pe.name || pe.id),
        roleType: rt2,
        side: side2,
        x: Math.round(num(pe.x, 0) * 100) / 100,
        y: Math.round(num(pe.y, 0) * 100) / 100,
        mapName: String(pe.mapName || k || ""),
        alive: pe.alive !== false,
        updatedAt: Date.now()
      });
    });
  });
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
    if (Array.isArray(d.party)) s.partyIds = [];
    if (Array.isArray(d.npcCards)) s.npcCards = d.npcCards;
    if (d.bagMeta && typeof d.bagMeta === "object") s.bagMeta = d.bagMeta;
    if (Array.isArray(d.bagOrder)) s.bagOrder = d.bagOrder.map(String);
    if (Array.isArray(d.shop) && d.shop.length) s.shopGoods = d.shop;
    if (str(d.level)) s.levelName = str(d.level, "");
    if (d.parked && typeof d.parked === "object") s.parked = d.parked;
    try {
      const rd = await api.get(AI_STORY_ROLES_KEY);
      if (rd && Array.isArray(rd.roles)) {
        const m = {};
        for (const r of rd.roles) {
          const k = String(r?.id || r?.name || "");
          const nm = String(r?.name || "");
          if (!k && !nm) continue;
          const rec = {
            x: num(r.x, 0),
            y: num(r.y, 0),
            mapName: str(r.mapName, ""),
            name: nm || k
          };
          if (k) m[k] = rec;
          if (nm) m["name:" + nm] = rec;
        }
        s._savedRolePos = m;
        if (!s.levelName && str(rd.level)) s.levelName = str(rd.level, "");
      }
    } catch {
    }
  } catch {
  }
}
function savedRolePos(s, r) {
  const m = s?._savedRolePos;
  if (!m || typeof m !== "object" || !r) return null;
  return m[String(r.id || "")] || m["name:" + String(r.name || "")] || null;
}
async function refreshShop(context, s, forceAgent = false) {
  const notes = [];
  const builtin = BUILTIN_SHOP_GOODS.map((g) => ({ ...g }));
  let story = [];
  const run = context?.tsApi?.agent?.run;
  if (run) {
    try {
      console.log("[\u5546\u57CE] \u8C03\u7528 field-survival-shop-gener agent, context.tsApi.agent.run \u5B58\u5728:", typeof run);
      const r = await withTimeout(
        run("field-survival-shop-gener", {
          storyDigest: buildStoryDigest(context),
          worldBookDigest: str(context?.worldBookDigest, ""),
          playerCard: s.playerCard || {}
        }),
        2e4,
        "shop agent timeout"
      );
      console.log("[\u5546\u57CE] agent \u8FD4\u56DE\u539F\u59CB\u6570\u636E:", JSON.stringify(r).slice(0, 300));
      const goods = r?.output?.goods;
      if (Array.isArray(goods) && goods.length > 0) {
        story = goods.slice(0, 14).map((g, i) => {
          const rawName = str(g?.name, `\u7269\u8D44${i + 1}`).slice(0, 20);
          const kind = KIND_LIST.indexOf(String(g?.kind)) >= 0 ? String(g.kind) : guessKind(rawName);
          return {
            id: `s_${i}_${rawName}`,
            name: rawName,
            price: Math.max(1, Math.round(num(g?.price, 50))),
            kind,
            rarity: normRarity(g?.rarity),
            heal: Math.max(0, Math.round(num(g?.heal, defaultHeal(rawName, kind)))),
            desc: str(g?.desc, "").slice(0, 60),
            from: "story"
          };
        });
        console.log("[\u5546\u57CE] agent \u6545\u4E8B\u7269\u8D44\u751F\u6210\u6210\u529F\uFF0C\u5171", story.length, "\u4EF6:", story.map((x) => x.name).join(", "));
      } else {
        const errMsg = r?.error ? String(r.error).slice(0, 60) : goods ? "agent \u8FD4\u56DE\u7A7A\u6570\u7EC4" : "agent \u672A\u8FD4\u56DE goods \u5B57\u6BB5";
        console.log("[\u5546\u57CE] agent \u8FD4\u56DE\u5F02\u5E38:", errMsg);
        notes.push(errMsg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80);
      console.error("[\u5546\u57CE] agent \u8C03\u7528\u5F02\u5E38:", msg);
      notes.push(msg);
    }
  } else {
    console.warn("[\u5546\u57CE] context.tsApi.agent.run \u4E0D\u5B58\u5728\uFF0C\u5546\u57CE agent \u4E0D\u53EF\u7528\uFF0C\u964D\u7EA7\u4E3A\u5185\u7F6E\u7269\u8D44");
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
      await restoreSys(context, s);
      s._sysRestored = true;
      if (!s.parked || typeof s.parked !== "object") s.parked = {};
      const curLv = str(str(params?.levelName) || s.levelName || "", "") || "Mulberry Town";
      s.levelName = curLv;
      s.entities = [];
      s.localMobsEpoch = 0;
      const startMapName = "Mulberry Town";
      const playerEnt = makeEntity(playerRole, "player", PLAYER_SPAWN.x, PLAYER_SPAWN.y, 0);
      playerEnt.mapName = curLv;
      s.entities.push(playerEnt);
      initPlayerFromCard(s, playerRole);
      participants.forEach((id, i) => {
        const r = byId(id);
        if (!r) return;
        if (isPlayerRole(r, playerRole)) return;
        const dp = defaultSpawnPoint(s, i, participants.length);
        const allyEntity = makeEntity(r, "ally", dp.x, dp.y, i);
        const savedPos = savedRolePos(s, r);
        if (savedPos) {
          allyEntity.x = savedPos.x;
          allyEntity.y = savedPos.y;
          allyEntity.mapName = savedPos.mapName || startMapName;
        } else {
          allyEntity.mapName = startMapName;
          if (enemyNav) {
            const free = navNearestFree(enemyNav, dp.x, dp.y, 0.4, 8);
            if (free) {
              allyEntity.x = free.x;
              allyEntity.y = free.y;
            }
          } else {
            allyEntity._needNavFix = true;
          }
        }
        if (allyEntity.mapName !== curLv) {
          const pk = String(allyEntity.mapName);
          (s.parked[pk] = s.parked[pk] || []).push(allyEntity);
        } else {
          s.entities.push(allyEntity);
        }
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
        if (!r) return;
        const se = { ...makeEntity(r, "spectator", -40, -40 + s.entities.length * 4, 0), alive: true, mapName: startMapName };
        const sp = savedRolePos(s, r);
        if (sp) {
          se.x = sp.x;
          se.y = sp.y;
          se.mapName = sp.mapName || startMapName;
        }
        if (se.mapName !== curLv) {
          s.parked[String(se.mapName)] = s.parked[String(se.mapName)] || [];
          s.parked[String(se.mapName)].push(se);
        } else {
          s.entities.push(se);
        }
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
      if (!s._sysRestored) await restoreSys(context, s);
      s.skills = buildSkills(s.playerCard || {}, 8, s.skillMeta);
      syncCardFromContext(s, context);
      if (str(params?.levelName)) s.levelName = str(params.levelName, s.levelName || "");
      if (!s.levelName) s.levelName = startMapName;
      dedupeRoles(s);
      await persistSys(context, s);
      s._levelAt = s.levelName || startMapName;
      if (s.levelName && s.levelName !== startMapName) {
        const me0 = s.entities.find((e2) => e2.side === "player");
        s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
        s.teleportTarget = {
          mapName: s.levelName,
          x: me0 ? me0.x : 0,
          y: me0 ? me0.y : 0,
          name: s.levelName,
          rev: s.sysRevision
        };
      }
      const finalStartMap = s.levelName || startMapName;
      (s.entities || []).forEach((e) => {
        if (e.side === "enemy") return;
        if (!e.mapName || e.mapName === startMapName) e.mapName = finalStartMap;
      });
      if (!Array.isArray(s.partyIds)) s.partyIds = [];
      ensureNpcCards(s, s.levelName || "");
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
      if (s.screenShake !== void 0 && s.screenShake > 0) {
        s.screenShake -= 1;
        if (s.screenShake === 0) s.screenShakeIntensity = 0;
      }
      if (s.hitStopFrames !== void 0 && s.hitStopFrames > 0) s.hitStopFrames -= 1;
      s.writeback = null;
      if (s.teleportTarget) s.teleportTarget = null;
      s.tick += 1;
      const localBuilt = applyLocalEnemies(s, params?.localEnemies);
      applyEnemyNavPayload(params?.walkGrid);
      fixSpawnWithNav(s);
      if (str(params?.levelName)) {
        const incomingLv = str(params.levelName);
        const ackLv = s._levelAt || "";
        if (s._travelPending) {
          if (incomingLv === s.levelName) s._travelPending = false;
        } else {
          s.levelName = incomingLv;
          void ackLv;
        }
      }
      syncCardFromContext(s, context);
      applyBagAttributes(s);
      syncPlayerCardStats(s);
      ensureNpcCards(s, s.levelName || "");
      if (s.tick % SYS_PERSIST_EVERY_TICKS === 0) void persistSys(context, s);
      step(s, params?.input || params, params?.player);
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
      skill.cdLeft = skill.cd;
      player.actionBobMs = 300;
      floater(s, skill.name, player.x, player.y - 34);
      const fx = skillFxKind(skill);
      if (fx === "heal") {
        pushVfx(s, { kind: "heal_ring", entityId: player.id, x: player.x, y: player.y, life: 18, total: 18, color: effectColor(skill.effects_type, "#7CFFB2"), icon: effectIcon(skill.effects_type), size: 1 });
      } else if (fx === "buff") {
        pushVfx(s, { kind: "buff_ring", entityId: player.id, x: player.x, y: player.y, life: 30, total: 30, color: effectColor(skill.effects_type, "#9CCFFF"), icon: effectIcon(skill.effects_type), size: 1 });
      } else if (fx === "ranged") {
        const t0 = targets[0];
        pushVfx(s, {
          kind: "fireball",
          entityId: player.id,
          targetEntityId: t0?.id,
          x: player.x,
          y: player.y,
          targetX: t0?.x ?? player.x,
          targetY: t0?.y ?? player.y,
          facing: player.facing,
          life: 16,
          total: 16,
          color: effectColor(skill.effects_type, "#ff6a00"),
          icon: effectIcon(skill.effects_type),
          size: 1
        });
      } else {
        pushVfx(s, { kind: "slash_arc", entityId: player.id, x: player.x, y: player.y, facing: player.facing, life: 12, total: 12, color: effectColor(skill.effects_type, "#fff"), icon: effectIcon(skill.effects_type), size: 1.6 });
      }
      targets.slice(0, 3).forEach((t) => damage(s, t, skill.power));
      pushEvent(s, targets.length ? `\u65BD\u653E ${skill.name}\uFF0C\u547D\u4E2D ${Math.min(3, targets.length)} \u4E2A\u76EE\u6807` : `\u65BD\u653E ${skill.name}`);
      return okResp(targets.length ? `${skill.name}` : `${skill.name}\uFF08\u7A7A\u653E\uFF09`);
    }
    /* ============ ★ 方案一 + 三：点击自动逼近 & 普攻 ============ */
    case "goto_enemy": {
      if (s.phase !== "playing") return okResp("");
      const targetId = str(params?.targetId, "");
      const skillIdx = num(params?.skillIdx, 0);
      const target = s.entities.find((e) => e.id === targetId && e.alive !== false);
      if (!target) return okResp("\u76EE\u6807\u5DF2\u6D88\u5931");
      s.autoApproach = { targetId, skillIdx, phase: "moving" };
      return okResp(`\u6B63\u5728\u63A5\u8FD1 ${target.name}\u2026`);
    }
    case "attack": {
      if (s.phase !== "playing") return okResp("");
      const player = s.entities.find((e) => e.side === "player");
      if (!player || !player.alive) return okResp("");
      const enemies = s.entities.filter((e) => e.side === "enemy" && e.alive !== false);
      const inRange = enemies.filter((e) => dist(player, e) < SKILL_RANGE_M);
      if (!inRange.length) return okResp("\u9644\u8FD1\u6CA1\u6709\u654C\u4EBA");
      const target = inRange.reduce((best, e) => !best || dist(player, e) < dist(player, best) ? e : best, inRange[0]);
      const dmg = Math.max(1, Math.round(player.atk * 0.6));
      player.actionBobMs = 200;
      floater(s, "\u666E\u653B", player.x, player.y - 34);
      const mainItem = mergeBag(itemsFromCard(s.playerCard || {}), s.bagMeta, s.bagOrder, s.itemMeta).find((x) => (x.type || "") === "atk");
      pushVfx(s, { kind: "slash_arc", entityId: player.id, x: player.x, y: player.y, facing: player.facing, life: 12, total: 12, color: effectColor(mainItem?.effects_type, "#fff"), size: 1.2 });
      damage(s, target, dmg);
      pushEvent(s, `\u666E\u653B\u547D\u4E2D ${target.name}\uFF0C\u4F24\u5BB3 ${dmg}`);
      return okResp(`\u666E\u653B \u2192 ${target.name} -${dmg}`);
    }
    case "item": {
      if (s.phase !== "playing") return okResp("");
      const idx = num(params?.index, 0);
      const slotIdx = s.itemPage * 4 + idx;
      const item = s.items[slotIdx];
      if (!item) return okResp("");
      return okResp(useBagItem(s, item.name));
    }
    /* ============ ★ v5：系统面板（背包 / 纳戒 / 商城 / 技能 / 地图 / 角色卡）============ */
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
      const it = bag.find((x) => x.name === name);
      if (!it) return okResp(`\u80CC\u5305\u91CC\u6CA1\u6709\u300C${name}\u300D`);
      const sold = Math.min(ask, it.count);
      const gain = sellPrice(it) * sold;
      const nextBag = bag.map((x) => x.name === name ? { ...x, count: x.count - sold } : x).filter((x) => x.count > 0);
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
          const nameKey2 = skillKey(name);
          const at = skills.findIndex((x) => skillKey(x) === nameKey2);
          if (at < 0) return okResp(`\u6280\u80FD\u300C${name}\u300D\u4E0D\u5728\u6280\u80FD\u680F`);
          const realName = cleanSkillName(skills[at]) || name;
          s.ring.skills = Array.from(/* @__PURE__ */ new Set([...ringSkills, realName]));
          patchCard(s, { skills: skills.filter((_, i) => i !== at) });
          pushEvent(s, `\u6280\u80FD ${realName} \u5DF2\u5B58\u5165\u7EB3\u6212`);
          await persistSys(context, s);
          return okResp(`\u5DF2\u5B58\u5165\u7EB3\u6212\uFF1A${realName}`);
        } else {
          const nameKey2 = skillKey(name);
          const at = ringSkills.findIndex((x) => skillKey(x) === nameKey2);
          if (at < 0) return okResp(`\u7EB3\u6212\u91CC\u6CA1\u6709\u6280\u80FD\u300C${name}\u300D`);
          const realName = cleanSkillName(ringSkills[at]) || name;
          s.ring.skills = ringSkills.filter((_, i) => i !== at);
          patchCard(s, { skills: Array.from(/* @__PURE__ */ new Set([...skills, realName])) });
          pushEvent(s, `\u6280\u80FD ${realName} \u5DF2\u4ECE\u7EB3\u6212\u53D6\u51FA`);
          await persistSys(context, s);
          return okResp(`\u5DF2\u53D6\u51FA\uFF1A${realName}`);
        }
      }
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder);
      const nameKey = itemKey(name);
      if (to === "ring") {
        const at = bag.findIndex((x) => itemKey(x.name) === nameKey);
        if (at < 0) return okResp(`\u80CC\u5305\u91CC\u6CA1\u6709\u300C${name}\u300D`);
        const it = bag[at];
        const realName = it.name;
        const moved = Math.min(ask, it.count);
        const ringItems = s.ring.items || [];
        const exist = ringItems.find((x) => itemKey(x.name) === nameKey);
        if (exist) exist.count += moved;
        else ringItems.push({ ...it, count: moved });
        s.ring.items = ringItems;
        const nextBag = bag.map((x, i) => i === at ? { ...x, count: x.count - moved } : x).filter((x) => x.count > 0);
        patchCard(s, { items: serializeBag(nextBag, card.items) });
        pushEvent(s, `${realName}\xD7${moved} \u5DF2\u5B58\u5165\u7EB3\u6212`);
        await persistSys(context, s);
        return okResp(`\u5DF2\u5B58\u5165\u7EB3\u6212\uFF1A${realName}`);
      } else {
        const ringItems = s.ring.items || [];
        const at = ringItems.findIndex((x) => itemKey(x.name) === nameKey);
        if (at < 0) return okResp(`\u7EB3\u6212\u91CC\u6CA1\u6709\u300C${name}\u300D`);
        const it = ringItems[at];
        const realName = it.name;
        const moved = Math.min(ask, it.count);
        const exist = bag.find((x) => itemKey(x.name) === nameKey);
        if (exist) exist.count += moved;
        else bag.push({ ...it, count: moved });
        s.ring.items = ringItems.filter((_, i) => i !== at);
        s.bagMeta = { ...s.bagMeta || {}, [realName]: { ...it, count: 0 } };
        patchCard(s, { items: serializeBag(bag, card.items) });
        pushEvent(s, `${realName}\xD7${moved} \u5DF2\u4ECE\u7EB3\u6212\u53D6\u51FA`);
        await persistSys(context, s);
        return okResp(`\u5DF2\u53D6\u51FA\uFF1A${realName}`);
      }
    }
    case "sys_rest": {
      if (s.phase !== "playing") return okResp("");
      const meRest = playerEntity(s);
      if (!meRest || !meRest.alive) return okResp("\u89D2\u8272\u4E0D\u53EF\u7528");
      meRest.actionBobMs = 300;
      restorePlayerFull(s, str(params?.reason, "\u4F11\u606F"));
      return okResp(`\u{1F389} \u606D\u559C\u60A8\u5DF2\u6062\u590D\u5230\u6700\u4F73\u72B6\u6001\uFF01HP ${Math.round(meRest.hp)}/${Math.round(meRest.maxHp)}\uFF0CMP ${Math.round(num(meRest.mp, 0))}/${Math.round(num(meRest.maxMp, 0))}`);
    }
    case "sys_use_skill": {
      const skName = str(params?.name);
      const skIdx = num(params?.index, -1);
      const meSk = playerEntity(s);
      if (!meSk || !meSk.alive) return okResp("\u89D2\u8272\u4E0D\u53EF\u7528");
      const si = skIdx >= 0 ? skIdx : s.skills.findIndex((k) => k.name === skName);
      const sk = s.skills[si];
      if (!sk) return okResp(`\u6280\u80FD\u300C${skName}\u300D\u4E0D\u5B58\u5728`);
      if (sk.cdLeft > 0) return okResp(`${sk.name} \u51B7\u5374\u4E2D`);
      sk.cdLeft = sk.cd;
      meSk.actionBobMs = 300;
      floater(s, sk.name, meSk.x, meSk.y - 34);
      const skTargets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(meSk, e) < SKILL_RANGE_M);
      const _fx = skillFxKind(sk);
      if (_fx === "heal") {
        pushVfx(s, { kind: "heal_ring", entityId: meSk.id, x: meSk.x, y: meSk.y, life: 18, total: 18, color: effectColor(sk.effects_type, "#7CFFB2"), icon: effectIcon(sk.effects_type), size: 1 });
      } else if (_fx === "buff") {
        pushVfx(s, { kind: "buff_ring", entityId: meSk.id, x: meSk.x, y: meSk.y, life: 30, total: 30, color: effectColor(sk.effects_type, "#9CCFFF"), icon: effectIcon(sk.effects_type), size: 1 });
      } else if (_fx === "ranged") {
        const _t0 = skTargets[0];
        pushVfx(s, {
          kind: "fireball",
          entityId: meSk.id,
          targetEntityId: _t0?.id,
          x: meSk.x,
          y: meSk.y,
          targetX: _t0?.x ?? meSk.x,
          targetY: _t0?.y ?? meSk.y,
          facing: meSk.facing,
          life: 16,
          total: 16,
          color: effectColor(sk.effects_type, "#ff6a00"),
          icon: effectIcon(sk.effects_type),
          size: 1
        });
      } else {
        pushVfx(s, { kind: "slash_arc", entityId: meSk.id, x: meSk.x, y: meSk.y, facing: meSk.facing, life: 12, total: 12, color: effectColor(sk.effects_type, "#fff"), icon: effectIcon(sk.effects_type), size: 1.6 });
      }
      if (!skTargets.length) {
        pushEvent(s, `\u65BD\u653E ${sk.name}\uFF08\u7A7A\u653E\uFF0C\u65E0\u76EE\u6807\uFF09`);
        return okResp(`${sk.name}\uFF08\u7A7A\u653E\uFF09`);
      }
      skTargets.slice(0, 3).forEach((t) => damage(s, t, sk.power));
      pushEvent(s, `\u65BD\u653E ${sk.name}\uFF0C\u547D\u4E2D ${Math.min(3, skTargets.length)} \u4E2A\u76EE\u6807`);
      return okResp(`${sk.name}`);
    }
    case "sys_skill_edit": {
      const idx = Math.round(num(params?.index, -1));
      const sk = s.skills[idx];
      if (!sk) return okResp("\u6280\u80FD\u4E0D\u5B58\u5728");
      const oldKey = skillKey(sk.name);
      const nm = cleanSkillName(str(params?.name, sk.name)).slice(0, 12) || sk.name;
      sk.name = nm;
      sk.power = Math.max(0, Math.round(num(params?.power, sk.power)));
      sk.cost = Math.max(0, Math.round(num(params?.cost, sk.cost)));
      sk.cd = Math.max(1, Math.round(num(params?.cd, sk.cd)));
      sk.type = ["atk", "heal", "buff"].includes(params?.type) ? str(params?.type) : sk.type || "atk";
      sk.range = str(params?.range) === "ranged" ? "ranged" : "melee";
      sk.lv = Math.max(1, Math.round(num(params?.lv, sk.lv || 1)));
      sk.buff_type = BUFF_TYPES.includes(str(params?.buff_type)) ? str(params?.buff_type) : "";
      sk.effects_type = typeof params?.effects_type === "string" ? params.effects_type : sk.effects_type || "";
      s.skillMeta = { ...s.skillMeta || {}, [skillKey(nm)]: { power: sk.power, cost: sk.cost, cd: sk.cd, type: sk.type, range: sk.range, lv: sk.lv, buff_type: sk.buff_type, effects_type: sk.effects_type } };
      const card = s.playerCard || {};
      const flat = [];
      (Array.isArray(card.skills) ? card.skills : []).forEach((x) => {
        if (typeof x === "string") splitSkillList(x).forEach((p) => {
          if (cleanSkillName(p)) flat.push(p.trim());
        });
        else {
          const n = str(x?.name);
          if (n) flat.push(n);
        }
      });
      const at = flat.findIndex((x) => skillKey(x) === oldKey);
      const annotated = sk.lv > 1 ? `${nm}\uFF08lv${sk.lv}\uFF09` : nm;
      if (at >= 0) flat[at] = annotated;
      else flat.push(annotated);
      patchCard(s, { skills: flat });
      pushEvent(s, `\u6280\u80FD\u300C${nm}\u300D\u53C2\u6570\u5DF2\u4FEE\u6539\u5E76\u4FDD\u5B58`);
      await persistSys(context, s);
      const tLabel = sk.type === "heal" ? "\u6CBB\u7597" : sk.type === "buff" ? `\u5F3A\u5316(${sk.buff_type || "-"})` : sk.range === "ranged" ? "\u8FDC\u7A0B" : "\u8FD1\u6218";
      return okResp(`\u300C${nm}\u300D\u5DF2\u4FDD\u5B58\uFF08${tLabel}\xB7lv${sk.lv}\uFF09`);
    }
    case "sys_item_edit": {
      const idx = Math.round(num(params?.index, -1));
      const card = s.playerCard || {};
      const bag = mergeBag(itemsFromCard(card), s.bagMeta, s.bagOrder, s.itemMeta);
      const it = idx >= 0 ? bag[idx] : bag.find((x) => x.name === str(params?.name));
      if (!it) return okResp("\u7269\u54C1\u4E0D\u5B58\u5728");
      const oldName = it.name;
      const nm = str(params?.name, it.name).trim().slice(0, 20) || it.name;
      it.name = nm;
      it.power = Math.max(0, Math.round(num(params?.power, it.power || 0)));
      it.cost = Math.max(0, Math.round(num(params?.cost, it.cost || 0)));
      it.cd = Math.max(0, Math.round(num(params?.cd, it.cd || 0)));
      it.type = ITEM_TYPES.includes(str(params?.type)) ? str(params?.type) : it.type || "heal";
      it.range = str(params?.range) === "ranged" ? "ranged" : "melee";
      it.lv = Math.max(1, Math.round(num(params?.lv, it.lv || 1)));
      it.buff_type = BUFF_TYPES.includes(str(params?.buff_type)) ? str(params?.buff_type) : "";
      it.durability = clamp(Math.round(num(params?.durability, it.durability == null ? -1 : it.durability)), -1, 99999);
      it.attribute_type = ITEM_ATTR_TYPES.includes(str(params?.attribute_type)) ? str(params?.attribute_type) : "";
      it.attribute_value = Math.round(num(params?.attribute_value, it.attribute_value || 0));
      it.effects_type = typeof params?.effects_type === "string" ? params.effects_type : it.effects_type || "";
      const flat = [];
      (Array.isArray(card.items) ? card.items : []).forEach((x) => {
        if (typeof x === "string") splitSkillList(x).forEach((p) => {
          if (p.trim()) flat.push(p.trim());
        });
        else {
          const n2 = str(x?.name);
          if (n2) flat.push(n2);
        }
      });
      let total = 0;
      let desc = "";
      const normName = (v) => String(v || "").replace(/[（(][^）)]*[）)]/g, " ").replace(/[×xX*]\s*\d+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
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
      const metaEntry = {
        power: it.power,
        cost: it.cost,
        cd: it.cd,
        type: it.type,
        range: it.range,
        lv: it.lv,
        buff_type: it.buff_type,
        durability: it.durability,
        durabilityLeft: it.durability,
        attribute_type: it.attribute_type,
        attribute_value: it.attribute_value,
        quantity: qty,
        description: descFinal,
        effects_type: it.effects_type
      };
      s.itemMeta = { ...s.itemMeta || {} };
      if (oldName !== nm) delete s.itemMeta[oldName];
      s.itemMeta[nm] = metaEntry;
      const annotated = `${nm}${qty > 1 ? `\xD7${qty}` : ""}${it.lv > 1 ? `\uFF08lv${it.lv}\uFF09` : ""}${descFinal ? `\uFF08${descFinal}\uFF09` : ""}`;
      const at = flat.findIndex((x) => normName(parseItemRaw(x).name) === oldNk);
      const kept = flat.filter((x) => normName(parseItemRaw(x).name) !== oldNk);
      kept.splice(Math.max(0, Math.min(at < 0 ? kept.length : at, kept.length)), 0, annotated);
      patchCard(s, { items: kept });
      applyBagAttributes(s);
      pushEvent(s, `\u7269\u54C1\u300C${nm}\u300D\u53C2\u6570\u5DF2\u4FEE\u6539\u5E76\u4FDD\u5B58`);
      await persistSys(context, s);
      const tLabel2 = it.type === "heal" ? "\u6CBB\u7597" : it.type === "buff" ? `\u5F3A\u5316(${it.buff_type || "-"})` : it.type === "attribute" ? `\u5C5E\u6027(${it.attribute_type || "-"})` : it.range === "ranged" ? "\u8FDC\u7A0B" : "\u8FD1\u6218";
      const dLabel = it.durability < 0 ? "\u6C38\u4E45" : `\u8010\u4E45${it.durability}`;
      return okResp(`\u300C${nm}\u300D\u5DF2\u4FDD\u5B58\uFF08${tLabel2}\xB7${dLabel}\xB7\xD7${qty}\uFF09`);
    }
    case "sys_shop_refresh": {
      const forceAgent = params?.agent === true;
      if (forceAgent) {
        s.shopGoods = BUILTIN_SHOP_GOODS.map((g) => ({ ...g }));
        s.shopSource = "builtin";
      }
      await refreshShop(context, s, forceAgent);
      await persistSys(context, s);
      const src = s.shopSource === "agent" ? "\u5546\u57CEagent\xB7\u6545\u4E8B\u7269\u8D44" : "\u63D2\u4EF6\u5E38\u5907\u7269\u8D44";
      const ts = (/* @__PURE__ */ new Date()).toTimeString().slice(0, 8);
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
      const summon = !!params?.summon;
      const flag = params?.follow;
      const follow = !(flag === false || flag === 0 || flag === "0" || flag === "false");
      let e = s.entities.find((x) => x.id === rid || x.name === rid);
      if (e && e.side === "enemy") return okResp("\u654C\u5BF9\u89D2\u8272\u65E0\u6CD5\u7EC4\u961F");
      if (!e && (follow || summon)) {
        const parkedObj = s.parked || {};
        for (const k of Object.keys(parkedObj)) {
          const arr = Array.isArray(parkedObj[k]) ? parkedObj[k] : [];
          const idx = arr.findIndex((x) => String(x.id) === rid || String(x.name) === rid);
          if (idx >= 0) {
            e = arr.splice(idx, 1)[0];
            s.entities.push(e);
            break;
          }
        }
      }
      if (!e && (follow || summon)) {
        const role = (s.roles || []).find((r) => String(r?.id) === rid || String(r?.name) === rid);
        e = spawnRoleEntity(s, role) || void 0;
      }
      if (e && (follow || summon)) e.mapName = s.levelName || e.mapName;
      if (summon) {
        if (e) {
          if (!e._baseSide) e._baseSide = e.side;
          e.side = "ally";
          if (!e.alive) {
            e.alive = true;
            e.hp = e.maxHp;
          }
          const me = playerEntity(s);
          if (me) {
            const allyCount = s.entities.filter((ee) => ee.side === "ally" && ee.id !== e.id).length;
            const ang = allyCount / Math.max(1, allyCount + 1) * Math.PI * 2 + rnd(0, Math.PI * 0.5);
            const dist2 = 2 + Math.random() * 2;
            const allyXBase = 0;
            const allyYBase = 0;
            const p = clampToBound(s, allyXBase + Math.cos(ang) * dist2, allyYBase + Math.sin(ang) * dist2);
            e.x = p.x;
            e.y = p.y;
            e.homeX = e.x;
            e.homeY = e.y;
          }
        }
        ensureNpcCards(s, s.levelName || "");
        pushEvent(s, `${e?.name || rid} \u5DF2\u53EC\u5524\u5230\u4F60\u8EAB\u8FB9\uFF08\u4E0D\u52A0\u5165\u961F\u4F0D\uFF09`);
        await persistSys(context, s);
        return okResp(`\u5DF2\u53EC\u5524 ${e?.name || rid} \u5230\u8EAB\u8FB9`);
      }
      const set = new Set(s.partyIds || []);
      if (follow) set.add(rid);
      else set.delete(rid);
      s.partyIds = Array.from(set);
      if (e) {
        if (follow) {
          if (!e._baseSide) e._baseSide = e.side;
          e.side = "ally";
          if (!e.alive) {
            e.alive = true;
            e.hp = e.maxHp;
          }
        } else {
          const mapName = e.mapName || s.levelName || "";
          if (!s.parked) s.parked = {};
          if (!s.parked[mapName]) s.parked[mapName] = [];
          s.parked[mapName] = s.parked[mapName].filter((x) => String(x.id) !== String(e.id));
          s.parked[mapName].push({ id: e.id, name: e.name, x: e.x, y: e.y, mapName });
          e.side = e._baseSide || "spectator";
          e.vx = 0;
          e.vy = 0;
          e.wanderTimer = 0;
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
      s._levelAt = target;
      s._travelPending = true;
      handleLevelChange(s, false);
      ensureNpcCards(s, target);
      s.sysRevision = Math.round(num(s.sysRevision, 0)) + 1;
      s.teleportTarget = { mapName: target, x: 0, y: 0, name: target, rev: s.sysRevision };
      pushEvent(s, `\u4F20\u9001\u81F3\u300C${target}\u300D`);
      await persistSys(context, s);
      return okResp(`\u5DF2\u4F20\u9001\u81F3\u300C${target}\u300D`);
    }
    case "sys_chat": {
      const npcId = str(params?.npcId, "");
      const npcName = str(params?.npcName, "???");
      const userText = params?.userText;
      const lastResp = str(params?.lastResp, "");
      const mode = str(params?.mode, "response");
      const reqId = str(params?.reqId, "");
      if (!npcId) return okResp("\u7F3A\u5C11\u89D2\u8272\u6807\u8BC6");
      const npcEntity = s.entities.find((e) => e.id === npcId);
      const npcSide = String(npcEntity?.side || "");
      const roleEntry = (s.roles || []).find(
        (r) => String(r?.id) === npcId || String(r?.name) === npcId
      );
      const entityName = String(npcEntity?.name || "").trim();
      const hasIdentity = !!roleEntry?.name || entityName !== "" && entityName !== "NPC" || npcName !== "" && npcName !== "???" && npcName !== "NPC";
      const isNeutral = npcSide === "neutral" && !hasIdentity;
      const roleName = isNeutral ? "\u65C1\u767D" : str(roleEntry?.name || entityName || npcName, npcName);
      const npcCard = isNeutral ? null : roleEntry || {
        id: npcId,
        name: roleName,
        roleType: npcSide === "ally" ? "ally" : "npc",
        description: String(npcEntity?.desc || npcEntity?.dialog || ""),
        level: npcEntity?.level ?? 1,
        entity_type: npcEntity?.entity_type,
        gid: npcEntity?.gid,
        mapName: s.levelName || "",
        x: npcEntity?.x,
        y: npcEntity?.y
      };
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
              playerLevel: s.entities.find((e) => e.side === "player")?.level ?? 1
            }
          });
          if (result?.ok && result?.output?.text) {
            const raw = String(result.output.text).replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/\s*```\s*$/, "").trim();
            if (mode === "options") {
              let options = [];
              try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) options = parsed.slice(0, 3);
              } catch {
                options = raw.split(/\n/).map((l) => l.replace(/^[0-9a-zA-Z一二三四五六七七八九十]+[.、)）]+/, "").trim()).filter(Boolean).slice(0, 3);
              }
              if (options.length === 0) throw new Error("agent \u672A\u8FD4\u56DE\u6709\u6548\u9009\u9879");
              s.chatResult = { reqId, ok: true, mode, speaker: roleName, options };
              await persistSys(context, s);
              return okResp(JSON.stringify({ options }));
            }
            s.chatResult = { reqId, ok: true, mode, speaker: roleName, text: raw };
            pushEvent(s, `${roleName}\uFF1A${raw}`);
            await persistSys(context, s);
            return okResp(JSON.stringify({ speaker: roleName, text: raw, avatar: roleEntry?.avatarPath ?? void 0 }));
          }
          if (result?.error) {
            console.warn("[field-survival] sys_chat agent error:", result.error);
            s.chatResult = { reqId, ok: false, mode, error: String(result.error) };
            await persistSys(context, s);
            return okResp(JSON.stringify({ error: String(result.error), mode, npcName: roleName }));
          }
        }
      } catch (e) {
        console.warn("[field-survival] sys_chat agent call failed:", e);
        const msg = String(e?.message || e || "\u89D2\u8272\u53D1\u8A00\u5668\u8C03\u7528\u5F02\u5E38");
        s.chatResult = { reqId, ok: false, mode, error: msg };
        await persistSys(context, s);
        return okResp(JSON.stringify({ error: msg, mode, npcName: roleName }));
      }
      const errMsg = `\u89D2\u8272\u53D1\u8A00\u5668 agent \u672A\u914D\u7F6E\u6216\u8C03\u7528\u5931\u8D25\uFF08${mode}\uFF09`;
      s.chatResult = { reqId, ok: false, mode, error: errMsg };
      await persistSys(context, s);
      return okResp(JSON.stringify({
        error: errMsg,
        fallback: false,
        mode,
        npcName: roleName
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
