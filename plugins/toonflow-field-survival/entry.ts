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

/** 保底地图（ctx.tsApi / agent 不可用时） */
function fallbackMap(): MapData {
  return {
    theme: "野外·清晨",
    narration: "薄雾笼罩着这片荒野，远处传来低沉的嘶吼。收拢心神，活下去。",
    zones: [
      { name: "营地", x: 480, y: 300, r: 120, kind: "safe", desc: "相对开阔的临时营地" },
      { name: "荒地", x: 720, y: 420, r: 140, kind: "danger", desc: "视野开阔的危险荒地" },
      { name: "废墟", x: 240, y: 200, r: 110, kind: "loot", "desc": "可能残留物资的废墟" },
    ],
    enemy_archetypes: [
      { id: "enemy_1", name: "荒野游荡者", lv: 1, hp: 40, atk: 6, def: 2, speed: 1.4, bounty: { exp: 10, money: 8 }, color: "#9b3a3a" },
    ],
    chests: [
      { x: 240, y: 200, tier: 1, loot: { exp: 15, money: 12, item: "干粮" } },
      { x: 810, y: 180, tier: 2, loot: { exp: 20, money: 18, item: "急救包" } },
    ],
    potions: [
      { x: 300, y: 420, heal: 40 },
      { x: 660, y: 260, heal: 40 },
    ],
    waves: [{ archetype: "enemy_1", count: 3, interval: 600 }],
    notes: "fallback map（agent 不可用）",
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
async function ensureMapData(ctx?: PluginGameContext): Promise<MapData> {
  const tsApi = ctx?.tsApi;
  if (!tsApi?.agent?.run || !tsApi?.pluginData?.set) return fallbackMap();
  try {
    const r = await tsApi.agent.run("field-survival-map-gener", {
      storyDigest: buildStoryDigest(ctx),
    });
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
  /** 阵营：player=用户 / ally=参展角色 / enemy=敌对角色 / spectator=观战 */
  side: "player" | "ally" | "enemy" | "spectator";
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  atk: number;
  level: number;
  avatarPath?: string;
  facing: number;
  cooldown: number;
  alive: boolean;
}

interface Chest { id: string; x: number; y: number; opened: boolean; }
interface Potion { id: string; x: number; y: number; heal: number; }
interface SkillSlot { name: string; power: number; cost: number; cd: number; cdLeft: number; }
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
  // 用户参数卡派生
  skills: SkillSlot[];
  items: ItemSlot[];
  skillPage: number;
  itemPage: number;
  playerCard: Record<string, unknown>;
  map?: MapData | null;
  mapSource?: "agent" | "fallback" | "stored";
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

const WORLD = { w: 960, h: 600 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : v == null ? d : String(v);
}
function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** 从用户参数卡取前 N 个技能，补足占位技能 */
function buildSkills(card: Record<string, unknown> | undefined, n = 8): SkillSlot[] {
  const raw = Array.isArray(card?.skills) ? (card!.skills as unknown[]) : [];
  const names = raw
    .map((s) => (typeof s === "string" ? s : str((s as any)?.name)))
    .filter(Boolean);
  const out: SkillSlot[] = [];
  for (let i = 0; i < n; i++) {
    const name = names[i] || (i < 4 ? `技能${i + 1}` : `备用技${i - 3}`);
    out.push({ name, power: 12 + i * 3, cost: 0, cd: 24 + i * 6, cdLeft: 0 });
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
    facing: 1,
    cooldown: 0,
    alive: true,
  };
}

function emptyState(ctx?: PluginGameContext): FieldSurvivalState {
  const card = (ctx?.playerCard || {}) as Record<string, unknown>;
  return {
    phase: "select",
    version: 2,
    tick: 0,
    world: { ...WORLD },
    roles: Array.isArray(ctx?.roles) ? ctx!.roles! : [],
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
    result: null,
  };
}

// ---------------------------------------------------------------------------
// 战斗与推进
// ---------------------------------------------------------------------------

/** 按地图 archetypes 生成一波敌人/宝箱/血瓶（无地图时回退内置逻辑） */
function spawnWave(s: FieldSurvivalState, wave: number) {
  const archs = (s.map?.enemy_archetypes && s.map.enemy_archetypes.length)
    ? s.map.enemy_archetypes
    : null;
  if (archs) {
    const wavesCfg = (s.map?.waves && s.map.waves.length ? s.map.waves : [{ archetype: archs[0].id, count: 3, interval: 600 }]);
    const pick = wavesCfg[Math.min(wave - 1, wavesCfg.length - 1)] || wavesCfg[0];
    const arch = archs.find((a) => a.id === pick.archetype) || archs[0];
    const count = Math.max(1, Math.min(6, num(pick.count, 3) + Math.floor(wave / 3)));
    for (let i = 0; i < count; i++) {
      const e = makeEntity(
        { id: `${arch.id}_${wave}_${i}`, name: arch.name, hp: Math.round(arch.hp + (wave - 1) * 8), level: arch.lv },
        "enemy",
        rnd(60, WORLD.w - 60),
        rnd(60, WORLD.h - 60),
        i,
      );
      e.atk = Math.round(arch.atk + (wave - 1) * 1.5);
      (e as any).bounty = { ...arch.bounty };
      (e as any).def = arch.def;
      s.entities.push(e);
    }
    // 宝箱/血瓶只在第一波铺设（地图数据）
    if (wave === 1) {
      (s.map?.chests || []).forEach((c, i) => {
        s.chests.push({ id: `chest_map_${i}`, x: clamp(c.x, 40, WORLD.w - 40), y: clamp(c.y, 60, WORLD.h - 40), opened: false, ...(c as any) });
      });
      (s.map?.potions || []).forEach((p, i) => {
        s.potions.push({ id: `potion_map_${i}`, x: clamp(p.x, 40, WORLD.w - 40), y: clamp(p.y, 60, WORLD.h - 40), heal: num(p.heal, 40) });
      });
    }
    return;
  }
  // 内置回退
  const count = Math.min(2 + wave, 6);
  for (let i = 0; i < count; i++) {
    const e = makeEntity(
      { id: `enemy_${s.tick}_${i}`, name: `野兽 ${i + 1}`, hp: 45 + wave * 12, level: wave },
      "enemy",
      rnd(60, WORLD.w - 60),
      rnd(60, WORLD.h - 60),
      i,
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

function pushEvent(s: FieldSurvivalState, text: string) {
  s.events.push(text);
  if (s.events.length > 40) s.events = s.events.slice(-40);
}

function floater(s: FieldSurvivalState, text: string, x: number, y: number) {
  s.floaters.push({ id: `f_${s.tick}_${Math.random().toString(36).slice(2, 6)}`, text, x, y, life: 24 });
  if (s.floaters.length > 30) s.floaters = s.floaters.slice(-30);
}

function damage(s: FieldSurvivalState, target: Entity, amount: number) {
  target.hp = clamp(target.hp - amount, 0, target.maxHp);
  floater(s, `-${Math.round(amount)}`, target.x, target.y - 24);
    if (target.hp <= 0 && target.alive) {
    target.alive = false;
    if (target.side === "enemy") {
      s.kills += 1;
      // 优先地图 archetype 的赏金（map-gener agent 产出）
      const bounty = (target as any).bounty as { exp?: number; money?: number } | undefined;
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

function moveTowards(e: Entity, tx: number, ty: number, speed: number) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = (dx / d) * speed;
  e.vy = (dy / d) * speed;
  if (Math.abs(dx) > 2) e.facing = dx > 0 ? 1 : -1;
}

function step(s: FieldSurvivalState, input: any) {
  const speed = 3.2;
  const player = s.entities.find((e) => e.side === "player");
  if (!player || !player.alive) return;

  // 用户移动：摇杆向量优先，其次点地目标
  const dx = num(input?.dx, 0);
  const dy = num(input?.dy, 0);
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    const len = Math.hypot(dx, dy) || 1;
    player.vx = (dx / len) * speed;
    player.vy = (dy / len) * speed;
    if (Math.abs(dx) > 0.01) player.facing = dx > 0 ? 1 : -1;
  } else if (input?.moveTo) {
    const tx = num(input.moveTo.x, player.x);
    const ty = num(input.moveTo.y, player.y);
    if (dist(player, { x: tx, y: ty }) > 6) moveTowards(player, tx, ty, speed);
    else { player.vx = 0; player.vy = 0; }
  } else {
    player.vx = 0;
    player.vy = 0;
  }

  const enemies = s.entities.filter((e) => e.side === "enemy" && e.alive);
  const allies = s.entities.filter((e) => e.side === "ally" && e.alive);

  // 参展角色：跟随用户并自动攻击最近敌人
  allies.forEach((a, i) => {
    const target = enemies.reduce<Entity | null>((best, e) =>
      !best || dist(a, e) < dist(a, best) ? e : best, null);
    const anchor = { x: player.x + Math.cos((i / Math.max(1, allies.length)) * Math.PI * 2) * 70,
                     y: player.y + Math.sin((i / Math.max(1, allies.length)) * Math.PI * 2) * 70 };
    if (target && dist(a, target) < 260) moveTowards(a, target.x, target.y, speed * 0.92);
    else moveTowards(a, anchor.x, anchor.y, speed * 0.8);
    if (target && dist(a, target) < 34 && a.cooldown <= 0) {
      damage(s, target, a.atk);
      a.cooldown = 30;
    }
  });

  // 敌人 AI：追最近的参展单位（含用户）
  enemies.forEach((e) => {
    const prey = [player, ...allies].filter((t) => t.alive)
      .reduce<Entity | null>((best, t) => (!best || dist(e, t) < dist(e, best) ? t : best), null);
    if (!prey) return;
    if (dist(e, prey) > 30) moveTowards(e, prey.x, prey.y, speed * 0.72);
    else {
      e.vx = 0; e.vy = 0;
      if (e.cooldown <= 0) { damage(s, prey, e.atk); e.cooldown = 45; }
    }
  });

  // 积分、冷却、越界
  s.entities.forEach((e) => {
    if (e.cooldown > 0) e.cooldown -= 1;
    e.x = clamp(e.x + e.vx, 12, WORLD.w - 12);
    e.y = clamp(e.y + e.vy, 12, WORLD.h - 12);
  });
  s.skills.forEach((k) => { if (k.cdLeft > 0) k.cdLeft -= 1; });
  s.floaters = s.floaters.map((f) => ({ ...f, life: f.life - 1 })).filter((f) => f.life > 0);

  // 宝箱：走过去开启（优先地图 loot）
  s.chests.forEach((c) => {
    if (c.opened) return;
    if (dist(player, c) < 30) {
      c.opened = true;
      const loot = (c as any).loot as { exp?: number; money?: number; item?: string } | undefined;
      const expGain = loot?.exp != null ? Math.round(num(loot.exp, 15)) : 12 + Math.floor(rnd(0, 10));
      const moneyGain = loot?.money != null ? Math.round(num(loot.money, 12)) : 15 + Math.floor(rnd(0, 20));
      const drop = loot?.item || ["生锈的钥匙", "干粮", "荧光石"][Math.floor(Math.random() * 3)];
      s.exp += expGain;
      s.money += moneyGain;
      s.drops.push(drop);
      floater(s, `宝箱 +${expGain}exp`, c.x, c.y);
      pushEvent(s, `打开宝箱：${drop}，+${expGain} 经验，+${moneyGain} 金钱`);
    }
  });

  // 血瓶：走过去回血
  s.potions = s.potions.filter((p) => {
    if (dist(player, p) >= 28) return true;
    const before = player.hp;
    player.hp = clamp(player.hp + p.heal, 0, player.maxHp);
    floater(s, `+${Math.round(player.hp - before)}`, player.x, player.y - 24);
    pushEvent(s, `拾取血瓶，恢复 ${Math.round(player.hp - before)} 点生命`);
    return false;
  });

  // 清场补波
  if (enemies.length === 0) {
    const wave = Math.floor(s.tick / 600) + 1;
    spawnWave(s, wave);
    pushEvent(s, `第 ${wave} 波来袭`);
  }

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

// ---------------------------------------------------------------------------
// handle_action
// ---------------------------------------------------------------------------

export async function handle_action(
  action: string,
  params: Record<string, any>,
  state: Record<string, any>,
  context: PluginGameContext,
): Promise<{ code: number; message: string; state: FieldSurvivalState; response?: string; actions?: string[] }> {
  const s: FieldSurvivalState =
    state && Object.keys(state).length > 0 && (state as any).version === 2
      ? (state as unknown as FieldSurvivalState)
      : emptyState(context);

  const okResp = (msg: string) => ({ code: 0, message: "ok", state: s, response: msg });

  switch (action) {
    case "init":
    case "start_init": {
      const fresh = emptyState(context);
      fresh.roles = Array.isArray(context?.roles) ? context.roles : [];
      return { code: 0, message: "ok", state: fresh, response: "请选择参展 / 观战 / 敌对角色后开始" };
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
      s.entities.push(makeEntity(playerRole as any, "player", WORLD.w / 2, WORLD.h / 2, 0));
      participants.forEach((id, i) => {
        const r = byId(id);
        if (!r) return;
        s.entities.push(makeEntity(r, "ally", WORLD.w / 2 + (i + 1) * 46, WORLD.h / 2, i));
      });
      enemies.forEach((id, i) => {
        const r = byId(id);
        s.entities.push(
          r
            ? { ...makeEntity(r, "enemy", rnd(80, WORLD.w - 80), rnd(80, WORLD.h - 80), i) }
            : makeEntity({ id, name: id }, "enemy", rnd(80, WORLD.w - 80), rnd(80, WORLD.h - 80), i),
        );
      });
      spectators.forEach((id) => {
        const r = byId(id);
        if (r) s.entities.push({ ...makeEntity(r, "spectator", 40, 40 + s.entities.length * 4, 0), alive: true });
      });
      // ★ map-gener agent：用故事动态数据生成地图（存 t_plugin_session_data.map_data）
      s.map = await ensureMapData(context);
      s.mapSource = (s.map?.notes || "").includes("fallback") ? "fallback" : "agent";
      if (!s.entities.some((e) => e.side === "enemy")) spawnWave(s, 1);
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
      if (skill.cdLeft > 0) return okResp(`${skill.name} 冷却中`);
      const targets = s.entities.filter((e) => e.side === "enemy" && e.alive && dist(player, e) < 180);
      if (!targets.length) { damage(s, s.entities.filter(e=>e.side==="enemy"&&e.alive)[0] || player, 0); return okResp(`${skill.name} 未命中`); }
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
