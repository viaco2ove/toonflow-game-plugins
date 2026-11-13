/**
 * v2-geo.test.mjs —— V2 头顶徽章几何断言（2026-11-13）
 * ============================================================
 * 背景（用户反馈）：仇恨感叹号等徽章「位置太高了，并不符合实体的头上
 * （刚刚好在头上）这个要求」。
 *
 * 修复内容（vue/src/headStatus.ts + App.vue）：
 *   1. 锚点语义统一为「名字文字上沿」：
 *      · 角色：headY - 9（旧：avatarY - avatarSize - 6，比名字高 avatarSize+2，最高 100px+）
 *      · 野怪：dy - 26 - 9 = dy - 35（旧：dy - 40）
 *   2. 徽章圆下缘 = 锚点 - 2px → 视觉上「刚好在头上」
 *      （旧几何叠加行高后距名字 30px 以上）
 *   3. 仇恨感叹号与徽章同行并排（旧：单独抬高一行 22px）
 *   4. 徽章尺寸上限收敛 k ≤ 1.25（名字字号固定 11px，徽章无限放大会重新「飘起来」）
 *
 * 本测试把 headStatus.ts 用 esbuild 打包成 Node 可加载的模块，mock Canvas ctx，
 * 对**真代码**做几何断言（不是测试副本）。
 *
 * 运行：node test-host/v2-geo.test.mjs
 */
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/* ── 把 headStatus.ts 打包成 Node 可加载的 CJS（png 内联成 dataurl）── */
const outDir = mkdtempSync(resolve(tmpdir(), "v2geo-"));
const outFile = resolve(outDir, "headstatus.cjs");
execSync(
  `npx esbuild vue/src/headStatus.ts --bundle --format=cjs --outfile="${outFile}" ` +
  `--loader:.png=dataurl --loader:.json=json`,
  { cwd: resolve(__dirname, ".."), stdio: "pipe" },
);
const { recordHeadBadge, drawHeadStatusLayer, resetHeadStatusLayer } = require(outFile);

/* ── 断言框架 ── */
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failures.push(msg); console.log("  ✗ " + msg); }
}
function section(t) { console.log("\n── " + t + " " + "─".repeat(Math.max(0, 56 - t.length))); }

/* ── mock Canvas ctx：记录 arc / roundRect 调用 ── */
function makeCtx() {
  const ops = [];
  const base = {
    ops,
    save() {}, restore() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {},
    arc(x, y, r) { ops.push({ op: "arc", x, y, r }); },
    roundRect() { ops.push({ op: "roundRect" }); },
    fill() {}, stroke() {}, fillRect() {},
    drawImage() { ops.push({ op: "drawImage" }); },
    fillText() { ops.push({ op: "fillText" }); },
  };
  return new Proxy(base, {
    get(t, k) { return t[k]; },
    set(t, k, v) { const key = "set_" + String(k); if (typeof t[key] === "function") t[key](v); else t[k] = v; return true; },
  });
}

const ANCHOR_Y = 100;   // 锚点 = 名字文字上沿（App.vue: headY - 9 / dy - 35）

/* ══════════════════════════════════════════════════════
   ① 徽章紧贴名字上沿
   ══════════════════════════════════════════════════════ */
section("① 徽章圆下缘距名字上沿 2px（「刚好在头上」）");
{
  resetHeadStatusLayer();
  const ctx = makeCtx();
  recordHeadBadge(
    { headBadges: [{ kind: "hurt", color: "#ff4d4d", label: "伤", bornTick: 0, expireTick: 100 }], aiState: "" },
    200, ANCHOR_Y, 0, 20);
  drawHeadStatusLayer(ctx, 0);
  const badgeCircle = ctx.ops.find((o) => o.op === "arc" && o.r === 11);
  ok(!!badgeCircle, "画出了徽章圆环（r=11）");
  ok(badgeCircle && Math.abs(badgeCircle.y - (ANCHOR_Y - 2 - 11)) <= 1,
    `徽章圆心 y=${badgeCircle && badgeCircle.y}（期望 ${ANCHOR_Y - 2 - 11}）`);
  ok(badgeCircle && badgeCircle.y + badgeCircle.r <= ANCHOR_Y,
    `徽章不越过名字上沿（下缘 ${badgeCircle.y + badgeCircle.r} ≤ ${ANCHOR_Y}）`);
  const dist = ANCHOR_Y - (badgeCircle.y + badgeCircle.r);
  ok(dist >= 0 && dist <= 4, `徽章底距名字上沿 ${dist}px ≤ 4px（旧几何为 30~96px）`);
}

/* ══════════════════════════════════════════════════════
   ② 仇恨感叹号与徽章同一行（不再单独抬高一行）
   ══════════════════════════════════════════════════════ */
section("② 仇恨感叹号与徽章同行");
{
  resetHeadStatusLayer();
  const ctx = makeCtx();
  recordHeadBadge({ headBadges: [], aiState: "chase" }, 200, ANCHOR_Y, 0, 20);
  drawHeadStatusLayer(ctx, 0);
  ok(ctx.ops.some((o) => o.op === "roundRect"), "画出了感叹号竖条（roundRect）");
  const dot = ctx.ops.filter((o) => o.op === "arc" && o.r < 3);
  ok(dot.length >= 1, "感叹号有圆点");
  if (dot.length) {
    // 圆点画在竖条下方 barH/2 + dotR + 1 ≈ 7.6px 处，容差 ±9
    ok(Math.abs(dot[0].y - (ANCHOR_Y - 13)) <= 9,
      `感叹号组中心与徽章行同高（圆点 y=${dot[0].y} ≈ ${ANCHOR_Y - 13}）`);
  }
}

/* ══════════════════════════════════════════════════════
   ③ 徽章 + 仇恨并排：都不高于名字上沿
   ══════════════════════════════════════════════════════ */
section("③ 徽章 + 仇恨并排都不高于名字上沿");
{
  resetHeadStatusLayer();
  const ctx = makeCtx();
  recordHeadBadge(
    { headBadges: [{ kind: "buff", color: "#5fe57a", label: "buff", bornTick: 0 }], aiState: "chase" },
    200, ANCHOR_Y, 0, 20);
  drawHeadStatusLayer(ctx, 0);
  const allY = ctx.ops.filter((o) => o.op === "arc" && o.r >= 7).map((a) => a.y);
  ok(allY.length >= 1 && allY.every((y) => y + 11 <= ANCHOR_Y + 1),
    "所有徽章圆下缘 ≤ 名字上沿+1px");
}

/* ── 汇总 ── */
console.log(`\n几何断言 ${passed + failures.length} 项，FAIL ${failures.length} 项`);
if (failures.length) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("全部通过 ✅");
