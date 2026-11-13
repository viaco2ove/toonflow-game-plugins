/**
 * v2-item-spam.test.mjs —— 连点消耗品（干粮）特效堆积/卡顿回归测试
 * ============================================================
 * 背景（用户实测提问，2026-11-13）：「连续点击干粮是不是产生了特效堆积和卡顿问题」
 *
 * 场景：干粮 = heal 类物品，每次使用 push 1 个 heal_ring（entityId=玩家）。
 *   连点 10Hz × 若干次 → 旧实现 heal_ring 会堆积（life=18 tick = 1.8s，
 *   连点期间同时存在 ~9-18 个）；V2_2 改造5/6 的密度控制应把玩家身上
 *   特效限制在 ≤3（第 4 个到达时立即挤掉最旧）。
 *
 * ★ 关键夹具细节：playerCard.items 必须放**两个**物品（银锭 + 干粮）——
 *   只放干粮时，第 1 次使用后 patchCard→buildItems 重建快捷栏会把干粮
 *   从 index=1 挪到 index=0，第 2 次起点 index=1 命中空格静默无效
 *   （特效「不堆积」是假阳性）。真实参数卡有多物品、顺序稳定，才会每次生效。
 *
 * 运行：node test-host/v2-item-spam.test.mjs
 */
import { createRequire } from "module";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/* 编译最新 entry.ts（保证测的永远是当前源码，而不是可能过期的 entry.js） */
const outDir = mkdtempSync(resolve(tmpdir(), "itemspam-"));
const outFile = resolve(outDir, "entry.cjs");
execSync(
  `npx esbuild entry.ts --bundle --format=cjs --outfile="${outFile}" --external:path --external:fs`,
  { cwd: resolve(__dirname, ".."), stdio: "pipe" },
);
const { handle_action } = require(outFile);

let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failures.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n── " + t + " " + "─".repeat(Math.max(0, 56 - t.length))); }

const context = {
  pluginId: "com.toonflow.minigame-field-survival", pluginDir: ".", manifest: {},
  userId: 1, sessionId: "item-spam-test",
  tsApi: { pluginData: { get: async () => null, set: async () => {}, list: async () => [], remove: async () => {} },
           agent: { run: async () => ({ ok: true, output: "{}" }) } },
};

function freshState() {
  return {
    phase: "playing", version: 3, tick: 0, world: { w: 3000, h: 3000 },
    entities: [{ id: "p1", name: "玩家", side: "player", x: 0, y: 0, vx: 0, vy: 0,
                 hp: 500, maxHp: 1000, atk: 20, level: 1, mp: 100, maxMp: 100,
                 facing: 0, cooldown: 0, alive: true }],
    // ★ 干粮在快捷栏 index=1（第 2 格，与真实 HUD 一致）；银锭占 index=0 保持顺序稳定
    items: [{ name: "银锭", count: 29, heal: 0 }, { name: "干粮", count: 999, heal: 14 }],
    itemPage: 0,
    playerCard: { items: [
      { name: "银锭", count: 29, kind: "resource", rarity: "common", price: 0 },
      { name: "干粮", count: 999, heal: 14, kind: "consumable", rarity: "common", price: 0 },
    ] },
    floaters: [], vfx: [], skills: [], chests: [], potions: [], events: [], drops: [],
    money: 0, exp: 0, kills: 0, skillPage: 0, bagMeta: {}, bagOrder: [], itemMeta: {},
    quests: {}, questBoard: [], npcCards: [], partyIds: [], regions: [], roles: [],
  };
}

section("① 连点干粮 10 次（每次生效 → 10 个 heal_ring）");
{
  const st = freshState();
  const responses = [];
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    const r = await handle_action("item", { index: 1 }, st, context);
    responses.push(r.response || "");
  }
  const elapsed = Date.now() - t0;
  ok(responses.filter((s) => s.includes("干粮")).length === 10,
    `10 次点击全部生效（${responses.filter((s) => s.includes("干粮")).length}/10）`);
  const onPlayer = (st.vfx || []).filter((v) => v.entityId === "p1");
  ok(onPlayer.length <= 3, `玩家身上特效 ${onPlayer.length} ≤ 3（第 4 个起立即清除旧残留）`);
  ok((st.vfx || []).length <= 60, `特效总数 ${(st.vfx || []).length} ≤ 60`);
  ok(elapsed < 2000, `10 次结算总耗时 ${elapsed}ms < 2000ms`);
}

section("② 边点边 tick（模拟真实连点节奏：10Hz tick + 5Hz 点击）");
{
  const st = freshState();
  let tickCount = 0, itemCount = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    await handle_action("tick", { player: { x: 0, y: 0, facing: 0 } }, st, context);
    tickCount++;
    if (tickCount % 2 === 0) { await handle_action("item", { index: 1 }, st, context); itemCount++; }
    await new Promise((r) => setTimeout(r, 100));
  }
  ok(tickCount >= 25, `3 秒 tick 推进 ${tickCount} 次（≥25 ≈ 10Hz 无卡顿）`);
  const onPlayer = (st.vfx || []).filter((v) => v.entityId === "p1");
  ok(onPlayer.length <= 3, `混合负载后玩家特效 ${onPlayer.length} ≤ 3（不堆积）`);
  ok((st.vfx || []).length <= 60, `特效总数 ${(st.vfx || []).length} ≤ 60`);
  ok(st.phase === "playing", "连点+tick 混合负载后状态正常（phase=playing）");
}

console.log(`\n${passed + failures.length} 项断言，FAIL ${failures.length} 项`);
if (failures.length) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("全部通过 ✅");
