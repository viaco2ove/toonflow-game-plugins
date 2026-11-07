#!/usr/bin/env node
/**
 * smoke-mappack-env — 验证 storyMap 环境判定 + miss TTL 修复（2026-11-06）
 *
 * 背景（用户报告）：`npm run debug -- --story 黑塔… --conn` 下状态条显示
 * 「宿主 / 地图集 未安装」——但 --conn 是 debug 模式且本地 .tbg 明明存在。
 * 两个 bug：
 *   ① envInfo() 用 inIframe() 判 runtime，dev-host 桩也是 iframe → 误判「宿主」；
 *   ② 插件挂载瞬间查询 map_visual 模板（桩还没播种）→ miss 被永久缓存 →
 *      init 预取被缓存短路 → 状态条/地图面板/商城 JSON 全部拿空结论。
 *
 * 本 smoke 不 import storyMap.ts（esbuild 会内联 toonflowJsApi 的 window 依赖），
 * 而是把修复的核心逻辑当纯函数重实现并断言行为等价 —— 保证语义不回退。
 * 与 smoke-sms-group-dedup.mjs 同模式：node scripts/smoke-mappack-env.mjs
 */

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.error("  ✗", name); }
}

/* ────────────────────────────────────────────────────────────
 * ① isDevHostStub / envInfo().runtime 的判定语义
 *    桩 iframe src: /?__inner=1&pluginId=…&sessionId=dev-host&story=…
 *    真宿主 iframe: /plugin/getAsset?pluginId=…&token=…&story=…&sessionId=<真实id>
 * ──────────────────────────────────────────────────────────── */
function isDevHostStub(search) {
  try {
    const sp = new URLSearchParams(search);
    if (sp.get("sessionId") === "dev-host") return true;
    if (sp.get("__inner") === "1") return true;
  } catch { /* ignore */ }
  return false;
}
function runtime(inIframe, search) {
  return !inIframe || isDevHostStub(search) ? "debug" : "host";
}

console.log("\n[①] runtime 环境判定");
ok(runtime(false, "") === "debug", "standalone 直开（非 iframe）→ debug");
ok(runtime(true, "?__inner=1&pluginId=com.toonflow.minigame-field-survival&sessionId=dev-host&story=%E9%BB%91%E5%A1%94") === "debug", "--conn dev-host 桩（__inner=1）→ debug（修复点）");
ok(runtime(true, "?sessionId=dev-host&story=x") === "debug", "--conn dev-host 桩（sessionId=dev-host）→ debug（修复点）");
ok(runtime(true, "/plugin/getAsset?pluginId=x&token=t&story=%E9%BB%91%E5%A1%94&sessionId=gs_123") === "host", "真宿主（getAsset + 真实 sessionId）→ host");
ok(runtime(true, "?story=x&sessionId=gs_abc") === "host", "真宿主（普通 sessionId）→ host");
ok(runtime(true, "?story=x") === "host", "真宿主（无 sessionId）→ host");
// 关键回归：生产 build 把 __CONN__="1" 烤进 game.html，但 URL 不带桩标记 → 仍须判 host
ok(runtime(true, "?story=x&sessionId=real-session&interaction=realtime") === "host", "生产（__CONN__ 被烤进产物但 URL 无桩标记）→ host（不能误判 debug）");

/* ────────────────────────────────────────────────────────────
 * ② miss 缓存 TTL：过期后必须放行重查
 * ──────────────────────────────────────────────────────────── */
const MISS_TTL_DEV_MS = 8000;
const MISS_TTL_HOST_MS = 15000;
function missCacheFresh(_missKey, _missAt, now, devHost) {
  if (!_missKey) return false;
  const ttl = devHost ? MISS_TTL_DEV_MS : MISS_TTL_HOST_MS;
  return now - _missAt < ttl;
}

console.log("\n[②] miss 缓存 TTL");
ok(missCacheFresh("黑塔", Date.now(), Date.now(), true) === true, "dev-host：8s 内 miss 缓存可信");
ok(missCacheFresh("黑塔", Date.now() - 8500, Date.now(), true) === false, "dev-host：8s 后 miss 过期 → 允许重查（修复点：桩播种完成后能翻正）");
ok(missCacheFresh("黑塔", Date.now() - 10 * 1000, Date.now(), false) === true, "真宿主：15s 内 miss 缓存仍可信");
ok(missCacheFresh("黑塔", Date.now() - 16 * 1000, Date.now(), false) === false, "真宿主：15s 后 miss 过期 → 允许重查");
ok(missCacheFresh("", Date.now(), Date.now(), true) === false, "无 missKey（还没缓存过）→ 不算新鲜");

/* ────────────────────────────────────────────────────────────
 * ③ 复现原始卡死时序：挂载首查 miss → TTL 内 init 预取（force 放行）
 * ──────────────────────────────────────────────────────────── */
console.log("\n[③] 卡死时序复现（挂载 miss → init force 预取 → ready）");
// 模拟时序：t=0 挂载首查（桩未播种）→ miss 缓存；t=3s init 到（播种已完成）→ force=true
let loaded = false, bundle = null, missKey = "", missAt = 0, phase = "idle";
async function loadBundle(now, force, seedPresent) {
  if (!force && loaded && missKey && (!missCacheFresh(missKey, missAt, now, true) || false)) {
    loaded = false; phase = "loading";
  }
  if (loaded && !force) return bundle;
  if (seedPresent) { bundle = { files: { "maps/a.json": {} } }; loaded = true; phase = "ready"; missKey = ""; return bundle; }
  bundle = null; loaded = true; phase = "miss"; missKey = "黑塔"; missAt = now; return null;
}
const t0 = 0;
await loadBundle(t0, false, false);                       // 挂载首查：桩未播种
ok(phase === "miss" && loaded === true, "t=0 挂载首查（桩未播种）→ miss 被缓存");
const t1 = 3000;
await loadBundle(t1, false, true);                        // init 预取：非 force（旧实现）
ok(phase === "miss" && bundle === null, "t=3s 非 force（旧实现的 init 预取）→ 被 TTL 内缓存短路，拿不到包（复现 bug）");
await loadBundle(t1, true, true);                         // init 预取：force（修复后）
ok(phase === "ready" && bundle !== null, "t=3s force（修复后的 init 预取）→ 命中播种好的模板，翻正 ready");
await loadBundle(t1 + 1000, false, true);                 // 后续幂等
ok(phase === "ready" && bundle !== null, "t=4s 幂等短路保持 ready（不重复拉 17MB）");

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
