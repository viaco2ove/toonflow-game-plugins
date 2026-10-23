// AI 托管触发频率：玩家战斗状态（P0 阶段）冒烟测试
// 验证：entry.ts 的 damage() 打点 + updatePlayerCombatState 三态跃迁
import { handle_action } from "../../entry.js";

const ctx = { roles: [
  { id: "p1", name: "玩家", roleType: "player", initial_level: 5 },
  { id: "r02", name: "裴勇", initial_level: 10 },
]};

let s = null;
const run = async (action, params) => {
  const res = await handle_action(action, params || {}, s, ctx);
  if (res?.state) s = res.state;
  return res;
};

const P = () => s.entities.find((e) => e.side === "player");
const spawnMob = (id, dx, dy) => {
  s.entities.push({
    id, name: "影怪", side: "enemy",
    x: P().x + dx, y: P().y + dy, vx: 0, vy: 0,
    hp: 500, maxHp: 500, atk: 8, def: 1, level: 2,
    facing: 0, cooldown: 0, alive: true, isLocal: true,
    homeX: P().x + dx, homeY: P().y + dy,
  });
};
const tick = () => run("tick", { levelName: "Mulberry Forest", player: { x: P().x, y: P().y, facing: 0 } });
const pc = () => s.playerCombat || {};

let pass = 0, fail = 0;
const check = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
};

// ── 初始化 ──
await run("init", {});
await run("start", { selections: { participants: ["r02"], spectators: [], enemies: [] } });
console.log("\n=== AI 托管 · 玩家战斗状态（触发频率判据）===\n");

// ── 1) 初始状态：无威胁 → none ──
await tick();
check("1. 初始为 none", pc().level === "none", `level=${pc().level}`);

// ── 2) 玩家出手（普攻）→ engaged ──
spawnMob("mob_a", 1.2, 0);
await tick();                                  // 先让怪进入感知/追击
const before2 = pc().level;
await run("attack", {});                       // 玩家普攻 → damage() 打点
await tick();
check("2. 玩家普攻后 → engaged", pc().level === "engaged", `${before2} → ${pc().level}`);

// ── 3) 跃迁边沿被记录（前端据此派发 AI 事件）──
check("3. 记录了 combatTransition", !!pc().combatTransition,
  pc().combatTransition ? `${pc().combatTransition.from} → ${pc().combatTransition.to}` : "无");

// ── 4) 战斗持续：多次 tick 保持 engaged ──
for (let i = 0; i < 20; i++) await tick();
check("4. 交战中保持 engaged", pc().level === "engaged", `level=${pc().level}`);

// ── 5) 清掉敌人 + 推进 30s（300 tick）→ 降级 ──
//    先只留 engaged 超时场景：清怪 → engaged 超 300 tick → none
s.entities = s.entities.filter((e) => e.side !== "enemy");
// 先推进到 engaged 超时（但此时附近无怪，会直接掉到 none）
for (let i = 0; i < 310; i++) await tick();
check("5. 超时且无敌人 → none", pc().level === "none", `level=${pc().level}`);

// ── 6) skirmish：engaged 超时但附近仍有敌人 ──
//   ★ 关键：把怪的 atk 设为 0 并锁住冷却，否则它会主动追过来打玩家，
//     每 tick 都刷新 lastCombatTick → 永远停在 engaged，测不出"超时降级"。
const spawnDummy = (id, dx, dy) => {
  spawnMob(id, dx, dy);
  const m = s.entities.find((e) => e.id === id);
  if (m) { m.atk = 0; m.cooldown = 999999; m.aiState = "idle"; }
  return m;
};

const dummy = spawnDummy("mob_b", 1.2, 0);      // 1.2m：玩家能打到
await run("attack", {});                        // 打一下 → engaged
await tick();
check("6a. 打怪后 engaged", pc().level === "engaged", `level=${pc().level}`);

for (let i = 0; i < 310; i++) await tick();     // 推进 31s，怪不打人 → engaged 超时
check("6b. 超时但附近有敌 → skirmish", pc().level === "skirmish", `level=${pc().level}`);
check("6c. nearbyEnemies 已统计", pc().nearbyEnemies >= 1, `nearbyEnemies=${pc().nearbyEnemies}`);

// ── 7) 远离的怪不计入 skirmish（>20m）──
if (dummy) { dummy.x = P().x + 60; dummy.y = P().y; }
await tick();
check("7. 60m 外的怪不计入 → none", pc().level === "none",
  `level=${pc().level}, nearbyEnemies=${pc().nearbyEnemies}`);

// ── 8) 玩家挨打（怪物攻击玩家）也算 engaged ──
//   注意：6/7 用的是 atk=0 的 dummy（防它打断超时判定），这里要换成真怪
s.playerCombat = { level: "none", lastCombatTick: -999999, sinceTick: 0, nearbyEnemies: 0 };
s.entities = s.entities.filter((e) => e.id !== "mob_b");
const realMob = spawnMob("mob_c", 0.6, 0);       // 贴身，atk=8（真怪）
if (realMob) { realMob.atk = 8; realMob.cooldown = 0; realMob.aiState = "chase"; }
const hpBefore = P().hp;
let hurt = false;
for (let i = 0; i < 30; i++) {
  await tick();
  if (P().hp < hpBefore) { hurt = true; break; }
}
check("8a. 怪物打到了玩家", hurt, `HP ${Math.round(hpBefore)} → ${Math.round(P().hp)}`);
check("8b. 玩家挨打 → engaged", pc().level === "engaged", `level=${pc().level}`);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail > 0 ? 1 : 0);