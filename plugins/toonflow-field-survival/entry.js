function fallbackMap() {
  return {
    theme: "\u91CE\u5916\xB7\u6E05\u6668",
    narration: "\u8584\u96FE\u7B3C\u7F69\u7740\u8FD9\u7247\u8352\u91CE\uFF0C\u8FDC\u5904\u4F20\u6765\u4F4E\u6C89\u7684\u5636\u543C\u3002\u6536\u62E2\u5FC3\u795E\uFF0C\u6D3B\u4E0B\u53BB\u3002",
    zones: [
      { name: "\u8425\u5730", x: 480, y: 300, r: 120, kind: "safe", desc: "\u76F8\u5BF9\u5F00\u9614\u7684\u4E34\u65F6\u8425\u5730" },
      { name: "\u8352\u5730", x: 720, y: 420, r: 140, kind: "danger", desc: "\u89C6\u91CE\u5F00\u9614\u7684\u5371\u9669\u8352\u5730" },
      { name: "\u5E9F\u589F", x: 240, y: 200, r: 110, kind: "loot", "desc": "\u53EF\u80FD\u6B8B\u7559\u7269\u8D44\u7684\u5E9F\u589F" }
    ],
    enemy_archetypes: [
      { id: "enemy_1", name: "\u8352\u91CE\u6E38\u8361\u8005", lv: 1, hp: 40, atk: 6, def: 2, speed: 1.4, bounty: { exp: 10, money: 8 }, color: "#9b3a3a" }
    ],
    chests: [
      { x: 240, y: 200, tier: 1, loot: { exp: 15, money: 12, item: "\u5E72\u7CAE" } },
      { x: 810, y: 180, tier: 2, loot: { exp: 20, money: 18, item: "\u6025\u6551\u5305" } }
    ],
    potions: [
      { x: 300, y: 420, heal: 40 },
      { x: 660, y: 260, heal: 40 }
    ],
    waves: [{ archetype: "enemy_1", count: 3, interval: 600 }],
    notes: "fallback map\uFF08agent \u4E0D\u53EF\u7528\uFF09"
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
async function ensureMapData(ctx) {
  const tsApi = ctx?.tsApi;
  if (!tsApi?.agent?.run || !tsApi?.pluginData?.set) return fallbackMap();
  try {
    const r = await tsApi.agent.run("field-survival-map-gener", {
      storyDigest: buildStoryDigest(ctx)
    });
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
const WORLD = { w: 960, h: 600 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function str(v, d = "") {
  return typeof v === "string" ? v : v == null ? d : String(v);
}
function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function buildSkills(card, n = 8) {
  const raw = Array.isArray(card?.skills) ? card.skills : [];
  const names = raw.map((s) => typeof s === "string" ? s : str(s?.name)).filter(Boolean);
  const out = [];
  for (let i = 0; i < n; i++) {
    const name = names[i] || (i < 4 ? `\u6280\u80FD${i + 1}` : `\u5907\u7528\u6280${i - 3}`);
    out.push({ name, power: 12 + i * 3, cost: 0, cd: 24 + i * 6, cdLeft: 0 });
  }
  return out;
}
function buildItems(card, n = 8) {
  const raw = Array.isArray(card?.items) ? card.items : [];
  const names = raw.map((s) => typeof s === "string" ? s : str(s?.name)).filter(Boolean);
  const out = [];
  for (let i = 0; i < n; i++) {
    const name = names[i] || (i < 4 ? `\u7269\u54C1${i + 1}` : `\u5907\u7528\u7269${i - 3}`);
    out.push({ name, count: names[i] ? 2 : 1, heal: 20 });
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
    facing: 1,
    cooldown: 0,
    alive: true
  };
}
function emptyState(ctx) {
  const card = ctx?.playerCard || {};
  return {
    phase: "select",
    version: 2,
    tick: 0,
    world: { ...WORLD },
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
    exp: 0,
    money: 0,
    drops: [],
    kills: 0,
    events: [],
    map: null,
    mapSource: "fallback",
    result: null
  };
}
function spawnWave(s, wave) {
  const archs = s.map?.enemy_archetypes && s.map.enemy_archetypes.length ? s.map.enemy_archetypes : null;
  if (archs) {
    const wavesCfg = s.map?.waves && s.map.waves.length ? s.map.waves : [{ archetype: archs[0].id, count: 3, interval: 600 }];
    const pick = wavesCfg[Math.min(wave - 1, wavesCfg.length - 1)] || wavesCfg[0];
    const arch = archs.find((a) => a.id === pick.archetype) || archs[0];
    const count2 = Math.max(1, Math.min(6, num(pick.count, 3) + Math.floor(wave / 3)));
    for (let i = 0; i < count2; i++) {
      const e = makeEntity(
        { id: `${arch.id}_${wave}_${i}`, name: arch.name, hp: Math.round(arch.hp + (wave - 1) * 8), level: arch.lv },
        "enemy",
        rnd(60, WORLD.w - 60),
        rnd(60, WORLD.h - 60),
        i
      );
      e.atk = Math.round(arch.atk + (wave - 1) * 1.5);
      e.bounty = { ...arch.bounty };
      e.def = arch.def;
      s.entities.push(e);
    }
    if (wave === 1) {
      (s.map?.chests || []).forEach((c, i) => {
        s.chests.push({ id: `chest_map_${i}`, x: clamp(c.x, 40, WORLD.w - 40), y: clamp(c.y, 60, WORLD.h - 40), opened: false, ...c });
      });
      (s.map?.potions || []).forEach((p, i) => {
        s.potions.push({ id: `potion_map_${i}`, x: clamp(p.x, 40, WORLD.w - 40), y: clamp(p.y, 60, WORLD.h - 40), heal: num(p.heal, 40) });
      });
    }
    return;
  }
  const count = Math.min(2 + wave, 6);
  for (let i = 0; i < count; i++) {
    const e = makeEntity(
      { id: `enemy_${s.tick}_${i}`, name: `\u91CE\u517D ${i + 1}`, hp: 45 + wave * 12, level: wave },
      "enemy",
      rnd(60, WORLD.w - 60),
      rnd(60, WORLD.h - 60),
      i
    );
    e.atk = 7 + wave * 2;
    s.entities.push(e);
  }
  for (let i = 0; i < 2; i++) {
    s.chests.push({ id: `chest_${s.tick}_${i}`, x: rnd(60, WORLD.w - 60), y: rnd(60, WORLD.h - 60), opened: false });
  }
  for (let i = 0; i < 3; i++) {
    s.potions.push({ id: `potion_${s.tick}_${i}`, x: rnd(60, WORLD.w - 60), y: rnd(60, WORLD.h - 60), heal: 18 });
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
        const drop = ["\u91CE\u517D\u76AE", "\u950B\u5229\u7684\u722A", "\u517D\u9AA8"][Math.floor(Math.random() * 3)];
        s.drops.push(drop);
      }
      pushEvent(s, `\u51FB\u8D25 ${target.name}\uFF0C\u83B7\u5F97 ${expGain} \u7ECF\u9A8C\u3001${moneyGain} \u91D1\u94B1`);
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
  if (Math.abs(dx) > 2) e.facing = dx > 0 ? 1 : -1;
}
function step(s, input) {
  const speed = 3.2;
  const player = s.entities.find((e) => e.side === "player");
  if (!player || !player.alive) return;
  const dx = num(input?.dx, 0);
  const dy = num(input?.dy, 0);
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    const len = Math.hypot(dx, dy) || 1;
    player.vx = dx / len * speed;
    player.vy = dy / len * speed;
    if (Math.abs(dx) > 0.01) player.facing = dx > 0 ? 1 : -1;
  } else if (input?.moveTo) {
    const tx = num(input.moveTo.x, player.x);
    const ty = num(input.moveTo.y, player.y);
    if (dist(player, { x: tx, y: ty }) > 6) moveTowards(player, tx, ty, speed);
    else {
      player.vx = 0;
      player.vy = 0;
    }
  } else {
    player.vx = 0;
    player.vy = 0;
  }
  const enemies = s.entities.filter((e) => e.side === "enemy" && e.alive);
  const allies = s.entities.filter((e) => e.side === "ally" && e.alive);
  allies.forEach((a, i) => {
    const target = enemies.reduce((best, e) => !best || dist(a, e) < dist(a, best) ? e : best, null);
    const anchor = {
      x: player.x + Math.cos(i / Math.max(1, allies.length) * Math.PI * 2) * 70,
      y: player.y + Math.sin(i / Math.max(1, allies.length) * Math.PI * 2) * 70
    };
    if (target && dist(a, target) < 260) moveTowards(a, target.x, target.y, speed * 0.92);
    else moveTowards(a, anchor.x, anchor.y, speed * 0.8);
    if (target && dist(a, target) < 34 && a.cooldown <= 0) {
      damage(s, target, a.atk);
      a.cooldown = 30;
    }
  });
  enemies.forEach((e) => {
    const prey = [player, ...allies].filter((t) => t.alive).reduce((best, t) => !best || dist(e, t) < dist(e, best) ? t : best, null);
    if (!prey) return;
    if (dist(e, prey) > 30) moveTowards(e, prey.x, prey.y, speed * 0.72);
    else {
      e.vx = 0;
      e.vy = 0;
      if (e.cooldown <= 0) {
        damage(s, prey, e.atk);
        e.cooldown = 45;
      }
    }
  });
  s.entities.forEach((e) => {
    if (e.cooldown > 0) e.cooldown -= 1;
    e.x = clamp(e.x + e.vx, 12, WORLD.w - 12);
    e.y = clamp(e.y + e.vy, 12, WORLD.h - 12);
  });
  s.skills.forEach((k) => {
    if (k.cdLeft > 0) k.cdLeft -= 1;
  });
  s.floaters = s.floaters.map((f) => ({ ...f, life: f.life - 1 })).filter((f) => f.life > 0);
  s.chests.forEach((c) => {
    if (c.opened) return;
    if (dist(player, c) < 30) {
      c.opened = true;
      const loot = c.loot;
      const expGain = loot?.exp != null ? Math.round(num(loot.exp, 15)) : 12 + Math.floor(rnd(0, 10));
      const moneyGain = loot?.money != null ? Math.round(num(loot.money, 12)) : 15 + Math.floor(rnd(0, 20));
      const drop = loot?.item || ["\u751F\u9508\u7684\u94A5\u5319", "\u5E72\u7CAE", "\u8367\u5149\u77F3"][Math.floor(Math.random() * 3)];
      s.exp += expGain;
      s.money += moneyGain;
      s.drops.push(drop);
      floater(s, `\u5B9D\u7BB1 +${expGain}exp`, c.x, c.y);
      pushEvent(s, `\u6253\u5F00\u5B9D\u7BB1\uFF1A${drop}\uFF0C+${expGain} \u7ECF\u9A8C\uFF0C+${moneyGain} \u91D1\u94B1`);
    }
  });
  s.potions = s.potions.filter((p) => {
    if (dist(player, p) >= 28) return true;
    const before = player.hp;
    player.hp = clamp(player.hp + p.heal, 0, player.maxHp);
    floater(s, `+${Math.round(player.hp - before)}`, player.x, player.y - 24);
    pushEvent(s, `\u62FE\u53D6\u8840\u74F6\uFF0C\u6062\u590D ${Math.round(player.hp - before)} \u70B9\u751F\u547D`);
    return false;
  });
  if (enemies.length === 0) {
    const wave = Math.floor(s.tick / 600) + 1;
    spawnWave(s, wave);
    pushEvent(s, `\u7B2C ${wave} \u6CE2\u6765\u88AD`);
  }
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
async function handle_action(action, params, state, context) {
  const s = state && Object.keys(state).length > 0 && state.version === 2 ? state : emptyState(context);
  const okResp = (msg) => ({ code: 0, message: "ok", state: s, response: msg });
  switch (action) {
    case "init":
    case "start_init": {
      const fresh = emptyState(context);
      fresh.roles = Array.isArray(context?.roles) ? context.roles : [];
      return { code: 0, message: "ok", state: fresh, response: "\u8BF7\u9009\u62E9\u53C2\u5C55 / \u89C2\u6218 / \u654C\u5BF9\u89D2\u8272\u540E\u5F00\u59CB" };
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
      s.entities.push(makeEntity(playerRole, "player", WORLD.w / 2, WORLD.h / 2, 0));
      participants.forEach((id, i) => {
        const r = byId(id);
        if (!r) return;
        s.entities.push(makeEntity(r, "ally", WORLD.w / 2 + (i + 1) * 46, WORLD.h / 2, i));
      });
      enemies.forEach((id, i) => {
        const r = byId(id);
        s.entities.push(
          r ? { ...makeEntity(r, "enemy", rnd(80, WORLD.w - 80), rnd(80, WORLD.h - 80), i) } : makeEntity({ id, name: id }, "enemy", rnd(80, WORLD.w - 80), rnd(80, WORLD.h - 80), i)
        );
      });
      spectators.forEach((id) => {
        const r = byId(id);
        if (r) s.entities.push({ ...makeEntity(r, "spectator", 40, 40 + s.entities.length * 4, 0), alive: true });
      });
      s.map = await ensureMapData(context);
      s.mapSource = (s.map?.notes || "").includes("fallback") ? "fallback" : "agent";
      if (!s.entities.some((e) => e.side === "enemy")) spawnWave(s, 1);
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
      s.tick += 1;
      step(s, params?.input || params);
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
      const targets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(player, e) < 180);
      if (!targets.length) {
        damage(s, s.entities.filter((e) => e.side === "enemy" && e.alive)[0] || player, 0);
        return okResp(`${skill.name} \u672A\u547D\u4E2D`);
      }
      skill.cdLeft = skill.cd;
      targets.slice(0, 3).forEach((t) => damage(s, t, skill.power));
      pushEvent(s, `\u65BD\u653E ${skill.name}\uFF0C\u547D\u4E2D ${Math.min(3, targets.length)} \u4E2A\u76EE\u6807`);
      return okResp(`${skill.name}`);
    }
    case "item": {
      if (s.phase !== "playing") return okResp("");
      const idx = num(params?.index, 0);
      const slotIdx = s.itemPage * 4 + idx;
      const item = s.items[slotIdx];
      const player = s.entities.find((e) => e.side === "player");
      if (!item || !player || !player.alive) return okResp("");
      if (item.count <= 0) return okResp(`${item.name} \u5DF2\u7528\u5B8C`);
      item.count -= 1;
      const before = player.hp;
      player.hp = clamp(player.hp + item.heal, 0, player.maxHp);
      pushEvent(s, `\u4F7F\u7528 ${item.name}\uFF0C\u6062\u590D ${Math.round(player.hp - before)} \u70B9\u751F\u547D`);
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
      return okResp("");
  }
}
export {
  handle_action
};
