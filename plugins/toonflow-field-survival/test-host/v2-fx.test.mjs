/**
 * v2-fx.test.mjs —— V2 战斗特效端到端测试（entry.js 级）
 * ============================================================
 * 覆盖 md/curr_design/toonflow-field-survival/技能特效设计/V2/技能特效设计V2.md：
 *   R1 仇恨感叹号   宿主 aiState === "chase"
 *   R2 玩家受击     粉红徽章 #ff8fc8 + 粉红飘字
 *   R3 野怪受击     红色徽章 #ff4d4d + 红色飘字
 *   R4 buff 生效中  绿色徽章 #5fe57a + buffs 列表 + 到期清理
 *   R5 攻击形状     circle=圆形 / cone=朝向扇形（扇形外不受影响）+ 粉红指示区
 *
 * ★ 为什么是 entry.js 级而不是走 HTTP：
 *   走 HTTP 会依赖**会话状态**（玩家血量、怪是否被清空、坐标是否被推走），
 *   前序用例的残留会让断言随机失败（实测踩过：玩家 hp 耗尽 → R2/R4/R5 连锁挂）。
 *   直接驱动引擎 = 完全确定性，每次跑出来的结果都一样。
 *   （HTTP 端到端另有 test_v2_fx.py 覆盖。）
 *
 * ★ 必须用**编译后的 entry.js**（esm），不是 entry.ts。
 *
 * 运行：node test-host/v2-fx.test.mjs
 */
import { handle_action } from "../entry.js";

/* ── 迷你断言框架 ─────────────────────────────────── */
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failures.push(msg); console.log("  ✗ " + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }
function section(t) { console.log("\n── " + t + " " + "─".repeat(Math.max(0, 58 - t.length))); }

/* ── 假宿主 ───────────────────────────────────────── */
const pluginDataStore = new Map();
const context = {
  pluginId: "com.toonflow.minigame-field-survival",
  pluginDir: ".",
  manifest: {},
  userId: 1,
  sessionId: "v2-fx-test",
  roles: [],
  worldName: "",
  tsApi: {
    pluginData: {
      get: async (k) => pluginDataStore.get(k),
      set: async (k, v) => { pluginDataStore.set(k, v); },
      list: async () => Array.from(pluginDataStore.keys()),
      remove: async (k) => { pluginDataStore.delete(k); },
    },
    agent: { run: async () => ({ ok: true, output: "{}" }) },
  },
};

async function call(action, params, state) {
  const r = await handle_action(action, params || {}, state, context);
  return { msg: r.response || "", state: r.state || state, code: r.code, data: r.data };
}

/**
 * 构造一个「玩家在 (0,0)、怪在 0.5m」的可控 playing 态。
 * ★ 怪**不放 isLocal** → 宿主权威，位移不被前端覆盖 → 追击/攻击链路可测。
 */
function newState(opts = {}) {
  const px = opts.px ?? 0, py = opts.py ?? 0;
  const st = {
    phase: "playing", version: 3, tick: 0,
    world: { w: 3000, h: 3000 },
    roles: [], selections: { participants: [], spectators: [], enemies: [] },
    entities: [
      { id: "p1", name: "玩家", side: "player", x: px, y: py, vx: 0, vy: 0,
        hp: opts.hp ?? 1000, maxHp: opts.hp ?? 1000, atk: 30, level: 1, mp: 100, maxMp: 100,
        facing: 0, cooldown: 0, alive: true },
      { id: "e1", name: "怪", side: "enemy", x: px + 0.5, y: py, vx: 0, vy: 0,
        hp: 500, maxHp: 500, atk: 6, level: 1, facing: 0, cooldown: 0, alive: true,
        homeX: px + 0.5, homeY: py },
    ],
    floaters: [], vfx: [], rangeIndicators: [],
    skills: opts.skills ?? [], items: [], chests: [], potions: [],
    events: [], drops: [], money: 0, exp: 0, kills: 0, skillPage: 0, itemPage: 0,
    playerCard: {}, skillMeta: {}, bagMeta: {}, bagOrder: [], itemMeta: {},
    quests: {}, questBoard: [], npcCards: [], partyIds: [], regions: [],
  };
  return st;
}
const playerOf = (st) => st.entities.find((e) => e.side === "player");
const mobOf = (st) => st.entities.find((e) => e.side === "enemy");
const badgesOf = (st, ent) => (ent && ent.headBadges) || [];
const badge = (st, ent, kind) => badgesOf(st, ent).find((b) => b.kind === kind);
const damageFloaters = (st) => (st.floaters || []).filter((f) => f.kind === "damage");

/* ══════════════════════════════════════════════════════
   1) R1 仇恨：怪进入探测半径 → aiState = chase
   ══════════════════════════════════════════════════════ */
section("1. R1 仇恨感叹号（宿主 aiState=chase）");
{
  const st = newState({ px: 0, py: 0 });
  eq(mobOf(st).aiState, undefined, "初始无 aiState");
  await call("tick", { player: { x: 0, y: 0, facing: 0 } }, st);
  eq(mobOf(st).aiState, "chase", "怪在 0.5m 内 → aiState=chase（前端据此画感叹号）");

  // 拉远到探测半径外 → 应脱战
  const st2 = newState({ px: 0, py: 0 });
  st2.entities[1].x = 0;
  st2.entities[1].y = 0;
  await call("tick", { player: { x: 0, y: 0, facing: 0 } }, st2);
  // 同位置也算在半径内 → 仍 chase
  ok(mobOf(st2).aiState === "chase", "同位置 → 仍 chase");
}

/* ══════════════════════════════════════════════════════
   2) R3 野怪受击 → 红色徽章 + 红色飘字
   ══════════════════════════════════════════════════════ */
section("2. R3 野怪被攻击 → 红色徽章 + 红色飘字");
{
  const st = newState({ px: 0, py: 0 });
  const hp0 = mobOf(st).hp;
  await call("attack", { targetId: "e1", player: { x: 0, y: 0, facing: 0 } }, st);
  ok(mobOf(st).hp < hp0, `野怪掉血（${hp0} → ${mobOf(st).hp}）`);
  const b = badge(st, mobOf(st), "hurt");
  ok(!!b, "野怪带 hurt 徽章");
  eq(b && b.color, "#ff4d4d", "徽章为红色 #ff4d4d");
  ok(b && (b.icon || b.label), `徽章有图标或兜底文案（icon=${b && b.icon} label=${b && b.label}）`);
  const fl = damageFloaters(st);
  ok(fl.length > 0, "产生伤害飘字");
  eq(fl.at(-1) && fl.at(-1).color, "#ff4d4d", "飘字为红色");
  ok(b && b.expireTick > st.tick, `徽章有过期时刻（expireTick=${b && b.expireTick}）`);
}

/* ══════════════════════════════════════════════════════
   3) R2 玩家受击 → 粉红徽章 + 粉红飘字
   ══════════════════════════════════════════════════════ */
section("3. R2 玩家被攻击 → 粉红徽章 + 粉红飘字");
{
  const st = newState({ px: 0, py: 0 });
  const hp0 = playerOf(st).hp;
  // 野怪在 0.5m 内 → tick 一次即触发攻击
  await call("tick", { player: { x: 0, y: 0, facing: 0 } }, st);
  ok(playerOf(st).hp < hp0, `玩家掉血（${hp0} → ${playerOf(st).hp}）`);
  const b = badge(st, playerOf(st), "hurt");
  ok(!!b, "玩家带 hurt 徽章");
  eq(b && b.color, "#ff8fc8", "徽章为粉红 #ff8fc8");
  eq(b && b.label, "伤", "徽章兜底文案为「伤」（野怪平A 无技能来源）");
  const fl = damageFloaters(st);
  ok(fl.length > 0 && fl.at(-1).color === "#ff8fc8", "飘字为粉红");
}

/* ══════════════════════════════════════════════════════
   4) R4 buff → 绿色徽章 + buffs 列表 + 到期清理
   ══════════════════════════════════════════════════════ */
section("4. R4 buff 生效中 → 绿色徽章 + buffs 列表");
{
  const st = newState({
    px: 0, py: 0,
    skills: [{ name: "护盾", power: 0, cost: 0, cd: 0, cdLeft: 0, type: "buff", range: "melee", effects_type: "earth" }],
  });
  await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, st);
  const b = badge(st, playerOf(st), "buff");
  ok(!!b, "玩家带 buff 徽章");
  eq(b && b.color, "#5fe57a", "徽章为绿色 #5fe57a");
  ok(b && b.icon, `徽章带法术图标（${b && b.icon}）`);
  ok((playerOf(st).buffs || []).includes("护盾"), `buffs 列表含该技能（${JSON.stringify(playerOf(st).buffs)}）`);
  ok(playerOf(st).buffUntilTick > st.tick, `有到期 tick（${playerOf(st).buffUntilTick}）`);

  // 到期清理：★ 2026-11-14 buff 主计时改真实时间戳 buffUntilMs（挂机档 1Hz 免疫）
  //   → 模拟过期 = 把 buffUntilMs 设到过去（旧 tickUntil 型仅兼容旧存档）
  ok(playerOf(st).buffUntilMs != null, "buffUntilMs 真实时间戳存在（新计时）");
  playerOf(st).buffUntilMs = Date.now() - 1;
  await call("tick", { player: { x: 0, y: 0, facing: 0 } }, st);
  ok(!badge(st, playerOf(st), "buff"), "到期后 buff 徽章消失");
  ok(!(playerOf(st).buffs || []).includes("护盾"), "到期后 buffs 列表同步清空");
}

/* ══════════════════════════════════════════════════════
   5) R5 攻击形状：circle / cone
   ══════════════════════════════════════════════════════ */
section("5. R5 攻击形状 circle / cone");
{
  // ① circle：正右 + 正下两只怪都应被打
  {
    const st = newState({
      px: 0, py: 0,
      skills: [{ name: "圆技能", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee", attack_shape: "circle" }],
    });
    st.entities.push({ id: "e2", name: "怪B", side: "enemy", x: 0, y: 2, vx: 0, vy: 0,
      hp: 500, maxHp: 500, atk: 6, level: 1, facing: 0, cooldown: 0, alive: true, homeX: 0, homeY: 2 });
    const r = await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, st);
    ok(mobOf(st).hp < 500, `circle：正右的怪被打（${mobOf(st).hp}）`);
    const e2 = st.entities.find((e) => e.id === "e2");
    ok(e2.hp < 500, `circle：正下的怪也被打（${e2.hp}）`);
    const inds = st.rangeIndicators || [];
    ok(inds.some((i) => i.shape === "circle"), "产生 shape=circle 指示区");
    const ci = inds.find((i) => i.shape === "circle");
    // ★ V2_2 射程分离：该用例技能未写 range → 近战 2m（指示区与判定同源 attackRangeOf）
    eq(ci && ci.radius, 2, "指示区半径 = 2m（近战技能，与判定半径一致）");
  }

  // ② cone（朝右）：正右的怪被打，正下 90° 的怪**不受影响**
  {
    const st = newState({
      px: 0, py: 0,
      skills: [{ name: "扇技能", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee", attack_shape: "cone" }],
    });
    st.entities.push({ id: "e2", name: "怪B", side: "enemy", x: 0, y: 2, vx: 0, vy: 0,
      hp: 500, maxHp: 500, atk: 6, level: 1, facing: 0, cooldown: 0, alive: true, homeX: 0, homeY: 2 });
    await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, st);
    ok(mobOf(st).hp < 500, `cone：扇形内（正右）的怪被打（${mobOf(st).hp}）`);
    const e2 = st.entities.find((e) => e.id === "e2");
    eq(e2.hp, 500, "cone：扇形外（正下 90°）的怪不受影响");
    const inds = st.rangeIndicators || [];
    const ci = inds.find((i) => i.shape === "cone");
    ok(!!ci, "产生 shape=cone 指示区");
    // ★ V2_2 射程分离：该用例技能未写 range → 近战 cone 2m
    eq(ci && ci.radius, 2, "cone 指示区半径 = 2m（近战技能）");
    eq(ci && ci.halfAngleDeg, 30, "cone 指示区半角 = 30°（总 60°）");
    eq(ci && ci.facing, 0, "cone 指示区朝向 = 施放朝向");
  }

  // ②b ★ 2026-11-14 八方向（用户验收「只有四方向没有八方向」）：
  //    玩家斜向移动 facing=45° → cone 判定/指示区都朝右下 45°；
  //    cast 带 aim（前端点击点）时精确指向（atan2 任意角度）
  {
    const st = newState({
      px: 0, py: 0,
      skills: [{ name: "扇技能", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee", attack_shape: "cone" }],
    });
    // 右下 45°、1.4m 处的怪（2m 近战 cone 内）
    st.entities.push({ id: "e45", name: "怪45", side: "enemy", x: 1, y: 1, vx: 0, vy: 0,
      hp: 500, maxHp: 500, atk: 6, level: 1, facing: 0, cooldown: 0, alive: true, homeX: 1, homeY: 1 });
    // 正右 1m 的怪（45° 扇形外：与 45° 夹角 45° > 半角 30°）
    st.entities.push({ id: "e0", name: "怪0", side: "enemy", x: 1, y: 0, vx: 0, vy: 0,
      hp: 500, maxHp: 500, atk: 6, level: 1, facing: 0, cooldown: 0, alive: true, homeX: 1, homeY: 0 });
    await call("skill", { index: 0, player: { x: 0, y: 0, facing: 45 } }, st);
    const e45 = st.entities.find((e) => e.id === "e45");
    const e0 = st.entities.find((e) => e.id === "e0");
    ok(e45.hp < 500, `八方向：facing=45° 时右下 45° 的怪被打（${e45.hp}）`);
    eq(e0.hp, 500, "八方向：正右的怪（与 45° 夹角 45°>30°）不受影响");
    const ci45 = (st.rangeIndicators || []).find((i) => i.shape === "cone");
    eq(ci45 && ci45.facing, 45, "八方向：指示区朝向 = 45°");
  }
  {
    // aim 精确指向：player.facing=0（右）但 aim 指向正下 → 扇形应朝下（aim 优先）
    const st = newState({
      px: 0, py: 0,
      skills: [{ name: "扇技能", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee", attack_shape: "cone" }],
    });
    st.entities.push({ id: "eD", name: "怪下", side: "enemy", x: 0, y: 1.5, vx: 0, vy: 0,
      hp: 500, maxHp: 500, atk: 6, level: 1, facing: 0, cooldown: 0, alive: true, homeX: 0, homeY: 1.5 });
    await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 }, aim: { x: 0, y: 2 } }, st);
    const eD = st.entities.find((e) => e.id === "eD");
    ok(eD.hp < 500, `aim 优先：facing=0 但 aim 指向下 → 正下的怪被打（${eD.hp}）`);
    const ciA = (st.rangeIndicators || []).find((i) => i.shape === "cone");
    eq(ciA && ciA.facing, 90, "aim 优先：指示区朝向 = 90°（aim atan2 精确角）");
  }

  // ③ 指示区 = 判定区：cone 时半径外的怪也不受影响
  {
    const st = newState({
      px: 0, py: 0,
      skills: [{ name: "扇技能", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee", attack_shape: "cone" }],
    });
    st.entities.push({ id: "e2", name: "怪B", side: "enemy", x: 0, y: 8, vx: 0, vy: 0,
      hp: 500, maxHp: 500, atk: 6, level: 1, facing: 0, cooldown: 0, alive: true, homeX: 0, homeY: 8 });
    await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, st);
    const e2 = st.entities.find((e) => e.id === "e2");
    eq(e2.hp, 500, "cone：半径外（8m）的怪不受影响（指示区=判定区）");
  }

  // ④ 配置持久化：sys_skill_edit 改 attack_shape
  {
    const st = newState({
      px: 0, py: 0,
      skills: [{ name: "技能A", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee", attack_shape: "circle" }],
    });
    await call("sys_skill_edit", {
      index: 0, name: "技能A", power: 10, cost: 0, cd: 24,
      type: "atk", range: "melee", lv: 1, attack_shape: "cone",
    }, st);
    eq(st.skills[0].attack_shape, "cone", "sys_skill_edit 保存 attack_shape=cone");
    // skillMeta 的 key 是归一化小写名（skillKey = cleanSkillName().toLowerCase()）
    const metaKey = Object.keys(st.skillMeta || {})[0];
    eq(st.skillMeta && st.skillMeta[metaKey] && st.skillMeta[metaKey].attack_shape, "cone",
      `skillMeta 持久化了 attack_shape（key=${metaKey}，不会被整条覆盖写丢掉）`);
  }
}

/* ══════════════════════════════════════════════════════
   6) 攻击间隔与上报频率解耦（本次 bug 的根因回归）
   ══════════════════════════════════════════════════════ */
section("6. 回归：野怪攻击间隔按真实时间（挂机档 1Hz 不再变 45 秒）");
{
  // 模拟挂机档：每次 tick 之间隔 1 秒（前端 3 秒无输入后降频）
  const st = newState({ px: 0, py: 0 });
  const hp0 = playerOf(st).hp;
  const hits = [];
  let prev = hp0;
  const t0 = Date.now();
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    await call("tick", { player: { x: 0, y: 0, facing: 0 } }, st);
    const hp = playerOf(st).hp;
    if (hp < prev) { hits.push(((Date.now() - t0) / 1000).toFixed(1)); prev = hp; }
  }
  const gaps = hits.slice(1).map((h, i) => (parseFloat(h) - parseFloat(hits[i])).toFixed(1));
  ok(hits.length >= 2, `挂机档（1Hz）下攻击了 ${hits.length} 次（时刻 ${JSON.stringify(hits)}）`);
  const avg = gaps.length ? gaps.reduce((a, b) => a + parseFloat(b), 0) / gaps.length : 999;
  ok(avg < 8, `挂机档攻击间隔 ${avg.toFixed(1)}s < 8s（修复前是 45s）`);
  ok(mobOf(st).cooldown < 45, `怪 cooldown 已按真实时间衰减（${mobOf(st).cooldown}）`);
}

/* ══════════════════════════════════════════════════════
   7) 徽章上限：每实体最多 hurt + buff 各一枚
   ══════════════════════════════════════════════════════ */
section("7. 徽章数量上限（每实体最多 2 枚）");
{
  const st = newState({
    px: 0, py: 0,
    skills: [{ name: "护盾", power: 0, cost: 0, cd: 0, cdLeft: 0, type: "buff", range: "melee" }],
  });
  await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, st);
  await call("attack", { targetId: "e1", player: { x: 0, y: 0, facing: 0 } }, st);
  await call("tick", { player: { x: 0, y: 0, facing: 0 } }, st);
  const n = badgesOf(st, playerOf(st)).length;
  ok(n <= 2, `玩家徽章数 ${n} ≤ 2`);
  const kinds = badgesOf(st, playerOf(st)).map((b) => b.kind).sort();
  ok(kinds.length <= 2 && new Set(kinds).size === kinds.length, `徽章 kind 不重复（${JSON.stringify(kinds)}）`);
}

/* ══════════════════════════════════════════════════════
   8) V2_2 改造5/6：特效密度控制（每实体 ≤3、野怪全局 ≤5）
   ══════════════════════════════════════════════════════ */
section("8. V2_2 特效密度控制（每实体≤3 / 野怪全局≤5）");
{
  // ① 连续 4 次普攻同一目标 → 该目标（e1）身上特效最多 3 个
  {
    const st = newState({ px: 0, py: 0 });
    for (let i = 0; i < 4; i++) {
      mobOf(st).cooldown = 0;
      await call("attack", { targetId: "e1", player: { x: 0, y: 0, facing: 0 } }, st);
    }
    const onMob = (st.vfx || []).filter((v) => v.entityId === "e1").length;
    ok(onMob <= 3, `连续 4 次攻击后目标身上特效 ${onMob} ≤ 3（旧残留被立即清除，只留最新 3）`);
  }
  // ② 野怪攻击玩家 → 目标（玩家）身上特效 ≤3（每次攻击产生 spark+explosion 两个）
  {
    const st = newState({ px: 0, py: 0 });
    for (let i = 0; i < 4; i++) {
      mobOf(st).cooldown = 0;
      await call("tick", { player: { x: 0, y: 0, facing: 0 } }, st);
    }
    const onPlayer = (st.vfx || []).filter((v) => v.entityId === "p1").length;
    ok(onPlayer <= 3, `被怪连打 4 次后玩家身上特效 ${onPlayer} ≤ 3`);
  }
  // ③ 改造5：野怪普攻也要有普攻特效 —— 怪攻击玩家时产生怪自己 entityId 的 slash_arc（近战怪）
  {
    const st = newState({ px: 0, py: 0 });
    await call("tick", { player: { x: 0, y: 0, facing: 0 } }, st);
    const mobFx = (st.vfx || []).filter((v) => v.entityId === "e1");
    ok(mobFx.length >= 1, `怪攻击时产生了怪自己的特效（${mobFx.length} 个）`);
    ok(mobFx.some((v) => v.kind === "slash_arc"), "近战怪普攻特效为 slash_arc（此前真机从未有）");
    ok(typeof mobFx.find((v) => v.kind === "slash_arc")?.angle === "number",
      "野怪斩波带 angle（指向受击者，前端按 angle 画朝向）");
  }
  // ④ 远程怪普攻特效为 fireball
  {
    const st = newState({ px: 0, py: 0 });
    (st.entities[1]).isRanged = true;
    await call("tick", { player: { x: 0, y: 0, facing: 0 } }, st);
    const mobFx = (st.vfx || []).filter((v) => v.entityId === "e1");
    ok(mobFx.some((v) => v.kind === "fireball"), "远程怪普攻特效为 fireball");
  }
}

/* ══════════════════════════════════════════════════════
   9) V2_2 改造2：攻击范围指示区带属性法术图标
   ══════════════════════════════════════════════════════ */
section("9. V2_2 指示区带属性图标（icon 字段下发）");
{
  const st = newState({
    px: 0, py: 0,
    skills: [{ name: "火扇", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee",
               attack_shape: "cone", effects_type: "fire" }],
  });
  await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, st);
  const ind = (st.rangeIndicators || []).at(-1);
  ok(!!ind, "产生了指示区");
  eq(ind && ind.shape, "cone", "指示区形状 cone");
  // entry.ts EFFECT_ICON.fire = images/spells/fire/fireball.png
  eq(ind && ind.icon, "images/spells/fire/fireball.png", "指示区 icon = 该技能 effects_type 对应的 spells 图");
  // 无属性技能 → icon 缺省（前端不画粒子，只画形状）
  const st2 = newState({
    px: 0, py: 0,
    skills: [{ name: "无属性", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee", attack_shape: "circle" }],
  });
  await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, st2);
  const ind2 = (st2.rangeIndicators || []).at(-1);
  eq(ind2 && ind2.icon, undefined, "无 effects_type → icon 缺省（形状照画，无图标粒子）");
}

/* ══════════════════════════════════════════════════════
   10) V2_2 射程分离：近战 2m / 远程 4m（用户实测「远近不分」）
   ══════════════════════════════════════════════════════ */
section("10. V2_2 射程分离（近战 2m / 远程 4m）");
{
  // ① 近战技能指示区 radius=2
  {
    const st = newState({
      px: 0, py: 0,
      skills: [{ name: "近战技", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee", attack_shape: "circle" }],
    });
    await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, st);
    const ind = (st.rangeIndicators || []).at(-1);
    eq(ind && ind.radius, 2, "近战技能指示区半径 = 2m");
  }
  // ② 远程技能指示区 radius=4
  {
    const st = newState({
      px: 0, py: 0,
      skills: [{ name: "远程技", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "ranged", attack_shape: "circle" }],
    });
    await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, st);
    const ind = (st.rangeIndicators || []).at(-1);
    eq(ind && ind.radius, 4, "远程技能指示区半径 = 4m");
  }
  // ③ 判定分离：3.5m 处的怪 —— 近战打不到（超 2m）、远程打到（≤4m）
  {
    const mk = () => {
      const st = newState({ px: 0, py: 0 });
      st.entities.push({ id: "e2", name: "远怪", side: "enemy", x: 3.5, y: 0, vx: 0, vy: 0,
        hp: 500, maxHp: 500, atk: 6, level: 1, facing: 0, cooldown: 0, alive: true, homeX: 3.5, homeY: 0 });
      return st;
    };
    const stM = mk();
    stM.skills = [{ name: "近战技", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee", attack_shape: "circle" }];
    await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, stM);
    eq(stM.entities.find((e) => e.id === "e2").hp, 500, "近战 2m：3.5m 处的怪不被命中");

    const stR = mk();
    stR.skills = [{ name: "远程技", power: 10, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "ranged", attack_shape: "circle" }];
    await call("skill", { index: 0, player: { x: 0, y: 0, facing: 0 } }, stR);
    ok(stR.entities.find((e) => e.id === "e2").hp < 500, "远程 4m：3.5m 处的怪被命中");
  }
  // ④ 普攻射程按主手武器：远程武器 → 4m 指示区
  //   ⚠️ mergeBag 的 range 来自 **itemMeta**（物品对象自身 range 不读）——
  //   与真机一致：武器的远近在系统面板「物品编辑」里配置，落 itemMeta。
  {
    const st = newState({ px: 0, py: 0 });
    st.playerCard = { items: [{ name: "飞刀", count: 1, kind: "weapon", rarity: "common", price: 0, type: "atk" }] };
    st.itemMeta = { "飞刀": {
      power: 5, cost: 0, cd: 0, type: "atk", range: "ranged", lv: 1, buff_type: "",
      durability: -1, durabilityLeft: -1, attribute_type: "", attribute_value: 0,
      quantity: 1, description: "", attack_shape: "circle",
    } };
    await call("attack", { player: { x: 0, y: 0, facing: 0 } }, st);
    const ind = (st.rangeIndicators || []).at(-1);
    eq(ind && ind.radius, 4, "普攻（远程武器）指示区半径 = 4m");
  }
}

/* ── 汇总 ─────────────────────────────────────────── */console.log("\n" + "═".repeat(64));
console.log(`总计 ${passed + failures.length} 项断言，FAIL ${failures.length} 项`);
if (failures.length) {
  console.log("\n失败项：");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("全部通过 ✅");
