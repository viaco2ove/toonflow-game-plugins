/**
 * tick-cooldown.test.mjs —— 冷却递减 / 特效衰减 的宿主 tick 路径测试
 * ============================================================
 * 背景（用户实测）：施放技能后，技能格倒计时数字长时间不减少，
 *   技能特效也不消失。两者在代码里都由**宿主 tick** 驱动：
 *     · cdLeft -= 1        → entry.ts step() 末尾（s.skills.forEach）
 *     · vfx.life -= 1      → entry.ts step() 末尾（_vfx.filter）
 *   前端只负责渲染（slot__cd 显示 Math.ceil(cdLeft/10)）。
 *   ⇒ 只要宿主 tick 不再推进，冷却数字与特效就**同时**卡住 —— 与截图症状一致。
 *
 * 本测试用真实 entry.js（handle_action）验证：
 *   ① tick 会推进 s.tick
 *   ② tick 会让 cdLeft 每 tick -1
 *   ③ tick 会让 vfx.life 每 tick -1（特效到点消失）
 *   ④ 前端渲染口径：cdLeft 是「tick 数」，显示秒 = cdLeft/10
 *   ⑤ 回归：skill action 设 cdLeft = cd（即 N tick = N/10 秒）
 *
 * 运行：node test-host/tick-cooldown.test.mjs
 */
import { handle_action } from "../entry.js";

let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failures.push(msg); console.log("  ✗ " + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }
function section(t) { console.log("\n── " + t + " " + "─".repeat(Math.max(0, 56 - t.length))); }

/* ── 假宿主 ───────────────────────────────────────── */
const pluginDataStore = new Map();
const context = {
  roles: [],
  worldName: "冷却测试",
  tsApi: {
    pluginData: {
      get: async (k) => pluginDataStore.get(k),
      set: async (k, v) => { pluginDataStore.set(k, v); },
    },
  },
};

/** 造一个最小可玩状态：phase=playing、玩家存活、一个技能槽（cd=24 → 2.4 秒） */
function newState(overrides = {}) {
  return {
    version: 4,
    phase: "playing",
    tick: 0,
    world: { w: 3000, h: 3000 },
    roles: [],
    selections: { participants: [], spectators: [], enemies: [] },
    entities: [
      {
        id: "p1", name: "玩家", side: "player",
        x: 0, y: 0, vx: 0, vy: 0,
        hp: 100, maxHp: 100, mp: 50, maxMp: 50,
        exp: 0, expToNext: 100, level: 1, atk: 10, def: 5,
        facing: 0, cooldown: 0, alive: true,
      },
    ],
    chests: [], potions: [], floaters: [], drops: [], events: [],
    skills: [
      { name: "冲斩", power: 18, cost: 0, cd: 24, cdLeft: 0, type: "atk", range: "melee", lv: 1 },
      { name: "", power: 0, cost: 0, cd: 0, cdLeft: 0, empty: true },
      { name: "", power: 0, cost: 0, cd: 0, cdLeft: 0, empty: true },
      { name: "", power: 0, cost: 0, cd: 0, cdLeft: 0, empty: true },
    ],
    items: [],
    skillPage: 0, itemPage: 0,
    exp: 0, money: 0, kills: 0,
    map: null, result: null, town: null, regions: [],
    vfx: [],
    ...overrides,
  };
}

async function call(action, params, state) {
  const r = await handle_action(action, params, state, context);
  return { msg: r.response || "", state: r.state, code: r.code };
}

/* ══════════════════════════════════════════════════════
   1) tick 推进 s.tick
   ══════════════════════════════════════════════════════ */
section("1. 宿主 tick 推进");
{
  const st = newState();
  const r = await call("tick", { input: {} }, st);
  eq(r.state.tick, 1, "tick 后 s.tick = 1");
  const r2 = await call("tick", { input: {} }, r.state);
  eq(r2.state.tick, 2, "再 tick 后 s.tick = 2");
}

/* ══════════════════════════════════════════════════════
   2) cdLeft 每 tick -1
   ══════════════════════════════════════════════════════ */
section("2. 技能冷却 cdLeft 每 tick -1");
{
  const st = newState();
  const r = await call("tick", { input: {} }, st);
  eq(r.state.skills[0].cdLeft, 0, "初始 cdLeft=0 不变");

  // 手动置 cdLeft=24（等价于刚施放完技能）
  const st2 = newState();
  st2.skills[0].cdLeft = 24;
  const a = await call("tick", { input: {} }, st2);
  eq(a.state.skills[0].cdLeft, 23, "1 tick 后 cdLeft 24 → 23");

  const b = await call("tick", { input: {} }, a.state);
  eq(b.state.skills[0].cdLeft, 22, "2 tick 后 cdLeft → 22");

  // 连续 24 tick 后归零
  let s = b.state;
  for (let i = 0; i < 22; i++) {
    const r = await call("tick", { input: {} }, s);
    s = r.state;
  }
  eq(s.skills[0].cdLeft, 0, "24 tick 后 cdLeft 归零（24 tick = 2.4 秒）");
}

/* ══════════════════════════════════════════════════════
   3) vfx 特效 life 每 tick -1，到点消失
   ══════════════════════════════════════════════════════ */
section("3. 技能特效 vfx 每 tick -1");
{
  const st = newState();
  st.vfx = [{ id: "vfx_1", kind: "slash_arc", entityId: "p1", x: 0, y: 0, life: 18, total: 18 }];
  const r = await call("tick", { input: {} }, st);
  eq(r.state.vfx.length, 1, "特效仍在");
  eq(r.state.vfx[0].life, 17, "1 tick 后 life 18 → 17");

  // 推到 life 归零
  let s = r.state;
  for (let i = 0; i < 20; i++) {
    const rr = await call("tick", { input: {} }, s);
    s = rr.state;
    if (!s.vfx || s.vfx.length === 0) break;
  }
  eq((s.vfx || []).length, 0, "life 耗尽后特效被移除（不会残留）");
}

/* ══════════════════════════════════════════════════════
   4) skill action：施放即进入冷却
   ══════════════════════════════════════════════════════ */
section("4. 施放技能进入冷却");
{
  const st = newState();
  const r = await call("skill", { index: 0 }, st);
  eq(r.state.skills[0].cdLeft, 24, "施放后 cdLeft = cd = 24 tick");

  // 冷却中再放 → 拒绝
  const r2 = await call("skill", { index: 0 }, r.state);
  ok(/冷却中/.test(r2.msg), "冷却中再施放被拒：" + r2.msg);
}

/* ══════════════════════════════════════════════════════
   5) 前端显示口径：cdLeft(tick) → 秒 = cdLeft/10
   ══════════════════════════════════════════════════════ */
section("5. 前端显示口径");
{
  // App.vue: Math.ceil(s.cdLeft / 10) → 秒
  const cd = 24;
  eq(Math.ceil(cd / 10), 3, "cd=24 tick → 面板显示 3 秒");
  eq(Math.ceil(1 / 10), 1, "cdLeft=1 tick → 面板显示 1 秒");
  eq(Math.ceil(0 / 10), 0, "cdLeft=0 → 不显示倒计时");
  // SkillPanel.vue: (cdLeft/10).toFixed(1) + "s"
  eq((24 / 10).toFixed(1), "2.4", "技能面板显示 2.4s");
}

/* ══════════════════════════════════════════════════════
   6) ★ 挂机档回归（真实 bug 场景）
   ------------------------------------------------------------
   宿主 tick 不是恒定 10Hz：前端 3 秒无输入后把上报降到 SEND_IDLE_MS=1000ms（1Hz）。
   旧实现「每 tick 减 1」在 1Hz 下让 cd=24 要 24 秒才归零（UI 却显示「3 秒」），
   特效 life=18 要 18 秒才消失 —— 与用户实测症状一致。
   修复后：递减量按真实墙钟差值折算，1Hz tick 一次就减 10 格。
   ══════════════════════════════════════════════════════ */
section("6. 挂机档（1Hz）冷却与特效按真实秒数走");
{
  // 模拟 1Hz：第一次 tick 建立时间基准，第二次 tick 时把墙上时钟往前拨 1000ms
  const st = newState();
  st.skills[0].cdLeft = 24;
  st.vfx = [{ id: "vfx_1", kind: "slash_arc", entityId: "p1", x: 0, y: 0, life: 18, total: 18 }];

  // 第 1 次 tick：建立时间基准（按 1 tick 计）
  const t1 = await call("tick", { input: {} }, st);
  eq(t1.state.skills[0].cdLeft, 23, "首次 tick 建立基准：cdLeft 24 → 23");
  eq(t1.state.vfx[0].life, 17, "首次 tick：life 18 → 17");

  // 把 state 上的时间戳往前拨 1000ms，模拟「距上次 tick 已过 1 秒」
  t1.state._tickAtMs = Date.now() - 1000;

  // 第 2 次 tick：真实间隔 1000ms → 应减 10 格（1000/100）
  const t2 = await call("tick", { input: {} }, t1.state);
  eq(t2.state.skills[0].cdLeft, 13, "1Hz tick 一次减 10 格：cdLeft 23 → 13");
  eq(t2.state.vfx[0].life, 7, "1Hz tick 一次减 10 格：life 17 → 7");

  // 再过 1 秒 → cdLeft 归零（24 tick = 2.4 秒 ≈ 3 次 1Hz tick 之内）
  t2.state._tickAtMs = Date.now() - 1000;
  const t3 = await call("tick", { input: {} }, t2.state);
  eq(t3.state.skills[0].cdLeft, 3, "再 1 秒：cdLeft 13 → 3");
  ok(t3.state.vfx.length === 0, "特效在真实时长内消失（不再残留）");
}

/* ══════════════════════════════════════════════════════
   7) 递增递减：cdLeft 不会变负
   ══════════════════════════════════════════════════════ */
section("7. cdLeft 不越界");
{
  const st = newState();
  st.skills[0].cdLeft = 3;
  st._tickAtMs = Date.now() - 5000;   // 模拟 5 秒间隔
  const r = await call("tick", { input: {} }, st);
  eq(r.state.skills[0].cdLeft, 0, "cdLeft 归零且不为负");
}

console.log("\n════════════════════════════════════════════════════════════");
if (failures.length) {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
  failures.forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
} else {
  console.log(`通过 ${passed} 项，失败 0 项`);
  console.log("全部通过 ✓");
}
