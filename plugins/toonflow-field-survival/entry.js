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
 *   - state.version 改为 3
 *   - 新增 spawn / scale 字段
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
    version: 3,
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
    result: null,
  };
}

async function ensureMapData(ctx) {
  const tsApi = ctx?.tsApi;
  if (!tsApi?.agent?.run || !tsApi?.pluginData?.set) return fallbackMap();
  try {
    const r = await tsApi.agent.run("field-survival-map-gener", { storyDigest: "" });
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

  enemies.forEach((e) => {
    const prey = [player, ...allies].filter((t) => t.alive)
      .reduce((best, t) => (!best || dist(e, t) < dist(e, best) ? t : best), null);
    if (!prey) return;
    if (dist(e, prey) > MOB_ATK_M) moveTowards(e, prey.x, prey.y, speed * 0.72);
    else {
      e.vx = 0; e.vy = 0;
      if (e.cooldown <= 0) { damage(s, prey, e.atk); e.cooldown = 45; }
    }
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

  if (enemies.length === 0) {
    const wave = Math.floor(s.tick / 600) + 1;
    spawnWave(s, wave);
    pushEvent(s, `第 ${wave} 波来袭`);
  }

  if (!player.alive && s.phase === "playing") {
    s.phase = "over";
    s.result = { reason: "death", exp: s.exp, money: s.money, drops: [...s.drops], kills: s.kills, survivedTicks: s.tick };
    pushEvent(s, "你倒下了……");
  }
}

export async function handle_action(action, params, state, context) {
  const s = state && Object.keys(state).length > 0 && (state.version === 2 || state.version === 3)
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
      enemies.forEach((id, i) => {
        const r = byId(id);
        const at = spawnAnchor(s, 30, 100);   // ★ fix③：初始敌对角色同样落在玩家周围 30~100 米，不再全图随机
        s.entities.push(
          r ? { ...makeEntity(r, "enemy", at.x, at.y, i) } : makeEntity({ id, name: id }, "enemy", at.x, at.y, i),
        );
      });
      spectators.forEach((id) => {
        const r = byId(id);
        if (r) s.entities.push({ ...makeEntity(r, "spectator", -40, -40 + s.entities.length * 4, 0), alive: true });
      });
      s.map = await ensureMapData(context);
      s.mapSource = (s.map?.notes || "").includes("fallback") ? "fallback" : "agent";
      if (!s.entities.some((e) => e.side === "enemy")) spawnWave(s, 1);
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
