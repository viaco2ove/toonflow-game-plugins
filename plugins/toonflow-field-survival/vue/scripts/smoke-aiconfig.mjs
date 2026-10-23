/**
 * smoke-aiconfig.mjs — AI 托管配置模块单测
 * ==============================================
 * 覆盖：
 *   1. 默认值（maxInterval 20s / minInterval 5s / engaged 5s / skirmish 10s / idle 20s）
 *   2. normalizeAISettings 钳制（越界 / 非法值 / 缺字段）
 *   3. 一致性修正（minInterval > maxInterval 时拉回；三档不低于 minInterval）
 *   4. applyAISettings 立即改运行时（brain.ts / mapInterval.ts 读的就是这里）
 *   5. saveAISettings → loadAISettings 往返（模拟 t_plugin_session_data）
 *   6. resetAISettings 恢复默认
 *   7. 地图集钳制读动态配置（mapInterval.clampInterval 的上下界）
 *
 * 用法：node scripts/smoke-aiconfig.mjs
 */
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AI_DIR = resolve(__dirname, "..", "src", "ai");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`✅ ${name}${detail ? " — " + detail : ""}`);
    pass++;
  } else {
    console.log(`❌ ${name}${detail ? " — " + detail : ""}`);
    fail++;
  }
}

/* ---------- 把 TS 模块转成可执行的 ESM ---------- */
const tmp = mkdtempSync(resolve(tmpdir(), "aiconf-"));
const esbuild = resolve(__dirname, "..", "node_modules", "@esbuild", "win32-x64", "esbuild.exe");
const outFile = resolve(tmp, "aiConfig.mjs");
try {
  execFileSync(esbuild, [resolve(AI_DIR, "aiConfig.ts"), "--format=esm", "--platform=node", `--outfile=${outFile}`], { stdio: "pipe" });
} catch (e) {
  console.error("✗ esbuild 编译 aiConfig.ts 失败:");
  console.error(e.stderr?.toString() || e.message);
  process.exit(1);
}
const mod = await import("file://" + outFile.replace(/\\/g, "/"));

const {
  DEFAULT_AI_SETTINGS,
  AI_SETTINGS_KEY,
  normalizeAISettings,
  applyAISettings,
  getAISettings,
  getRuntimeBrainConfig,
  getRuntimeIntervals,
  resetAISettings,
  loadAISettings,
  saveAISettings,
} = mod;

/* ---------- 1. 默认值 ---------- */
console.log("\n=== AI 托管配置（默认值）===");
const d = DEFAULT_AI_SETTINGS;
check("maxInterval 默认 20000（20s）", d.maxInterval === 20000, `${d.maxInterval}ms`);
check("minInterval 默认 5000", d.minInterval === 5000, `${d.minInterval}ms`);
check("engaged 默认 5000", d.engaged === 5000, `${d.engaged}ms`);
check("skirmish 默认 10000", d.skirmish === 10000, `${d.skirmish}ms`);
check("idle 默认 20000", d.idle === 20000, `${d.idle}ms`);
check("maxManagedCount 默认 5", d.maxManagedCount === 5);
check("adaptiveEnabled 默认 true", d.adaptiveEnabled === true);
check("持久化 key = ai_settings", AI_SETTINGS_KEY === "ai_settings", AI_SETTINGS_KEY);

/* ---------- 2. normalize 钳制 ---------- */
console.log("\n=== normalizeAISettings（钳制）===");
const n1 = normalizeAISettings({ maxInterval: 999999, minInterval: -5, engaged: 1, maxManagedCount: 999 });
check("maxInterval 越界被钳到 120000", n1.maxInterval === 120000, `${n1.maxInterval}`);
check("minInterval 负数被钳到 2000", n1.minInterval === 2000, `${n1.minInterval}`);
check("engaged 下界 2000", n1.engaged === 2000, `${n1.engaged}`);
check("maxManagedCount 上界 10", n1.maxManagedCount === 10, `${n1.maxManagedCount}`);

const n2 = normalizeAISettings({ maxInterval: "abc", minInterval: null });
check("非法值回落默认 maxInterval", n2.maxInterval === 20000, `${n2.maxInterval}`);
check("null 回落默认 minInterval", n2.minInterval === 5000, `${n2.minInterval}`);

const n3 = normalizeAISettings({});
check("空对象全用默认值", n3.maxInterval === 20000 && n3.engaged === 5000 && n3.idle === 20000);

/* ---------- 3. 一致性修正 ---------- */
console.log("\n=== 一致性修正 ===");
const n4 = normalizeAISettings({ minInterval: 15000, maxInterval: 8000, engaged: 2000, skirmish: 3000, idle: 4000 });
check("minInterval > maxInterval → 拉回相等", n4.minInterval === n4.maxInterval, `min=${n4.minInterval} max=${n4.maxInterval}`);
check("idle 被抬到 >= minInterval", n4.idle >= n4.minInterval, `idle=${n4.idle}`);

// ★ engaged/skirmish **不**受 minInterval 抬高（它们本就该比 minInterval 快）
const n5 = normalizeAISettings({ minInterval: 8000, maxInterval: 30000, engaged: 3000, skirmish: 5000, idle: 20000 });
check("engaged 不被 minInterval 抬高", n5.engaged === 3000, `engaged=${n5.engaged}`);
check("skirmish 不被 minInterval 抬高", n5.skirmish === 5000, `skirmish=${n5.skirmish}`);
check("idle 仍受 minInterval 约束", n5.idle === 20000, `idle=${n5.idle}`);

// ★ 单调性：交战 ≤ 遭遇战 ≤ 非战斗（用户配反了要纠正）
const n6 = normalizeAISettings({ engaged: 30000, skirmish: 20000, idle: 5000, minInterval: 2000, maxInterval: 60000 });
check("engaged > skirmish → skirmish 被抬高", n6.skirmish >= n6.engaged, `engaged=${n6.engaged} skirmish=${n6.skirmish}`);
check("skirmish > idle → idle 被抬高", n6.idle >= n6.skirmish, `skirmish=${n6.skirmish} idle=${n6.idle}`);

/* ---------- 4. apply 立即改运行时 ---------- */
console.log("\n=== applyAISettings（立即生效）===");
applyAISettings({ maxInterval: 45000, minInterval: 8000, engaged: 3000, skirmish: 7000, idle: 40000, maxManagedCount: 3, adaptiveEnabled: false });
const rc = getRuntimeBrainConfig();
const ri = getRuntimeIntervals();
check("运行时 maxInterval 生效", rc.maxInterval === 45000, `${rc.maxInterval}`);
check("运行时 minInterval 生效", rc.minInterval === 8000, `${rc.minInterval}`);
check("运行时 maxManagedCount 生效", rc.maxManagedCount === 3);
check("运行时 adaptiveEnabled 生效", rc.adaptiveEnabled === false);
check("运行时三档生效（engaged 可低于 minInterval）", ri.engaged === 3000 && ri.skirmish === 7000 && ri.idle === 40000, JSON.stringify(ri));
check("getAISettings 与运行时一致", getAISettings().maxInterval === 45000);

/* ---------- 5. 落库往返 ---------- */
console.log("\n=== save/load 往返（模拟 t_plugin_session_data）===");
const store = new Map();
const scopeLog = [];
const fakeStore = {
  get: async (k, scope) => { scopeLog.push(["get", k, scope]); return store.has(k) ? store.get(k) : null; },
  set: async (k, v, scope) => { scopeLog.push(["set", k, scope]); store.set(k, JSON.parse(JSON.stringify(v))); },
};
const saved = await saveAISettings(fakeStore, { maxInterval: 30000, minInterval: 6000, engaged: 4000, skirmish: 9000, idle: 25000, maxManagedCount: 4, adaptiveEnabled: true });
check("save 写入 store", store.has(AI_SETTINGS_KEY));
check("save 后运行时已更新", getAISettings().maxInterval === 30000, `${saved.maxInterval}`);
check("save 保留 engaged=4000（不被 minInterval 抬高）", saved.engaged === 4000, `${saved.engaged}`);
check("★ save 用 scope='all'（跨会话共享）", scopeLog.some((x) => x[0] === "set" && x[2] === "all"), JSON.stringify(scopeLog.filter(x=>x[0]==="set")));

// 模拟重启：运行时重置成默认，再 load
resetAISettings();
check("reset 后回到默认 20s", getAISettings().maxInterval === 20000);
const loaded = await loadAISettings(fakeStore);
check("load 从 store 读回 30s", loaded.maxInterval === 30000, `${loaded.maxInterval}`);
check("load 后运行时恢复 30s", getRuntimeBrainConfig().maxInterval === 30000);
check("load 恢复 minInterval", getRuntimeBrainConfig().minInterval === 6000);
check("load 恢复三档", getRuntimeIntervals().idle === 25000 && getRuntimeIntervals().engaged === 4000);
check("★ load 用 scope='all'", scopeLog.some((x) => x[0] === "get" && x[2] === "all"), JSON.stringify(scopeLog.filter(x=>x[0]==="get")));

// 空 store → 用默认值重置运行时，不保留残留
const emptyStore = { get: async () => null, set: async () => {} };
const l2 = await loadAISettings(emptyStore);
check("空配置重置为默认 20s", l2.maxInterval === 20000, `${l2.maxInterval}`);
check("空配置不保留运行时残留", getAISettings().maxInterval === 20000);

// store 抛异常 → 不崩，且重置为默认
const badStore = { get: async () => { throw new Error("boom"); }, set: async () => { throw new Error("boom"); } };
const l3 = await loadAISettings(badStore);
check("store 异常不崩且重置为默认", l3.maxInterval === 20000, `${l3.maxInterval}`);
const s3 = await saveAISettings(badStore, { ...DEFAULT_AI_SETTINGS, maxInterval: 12000 });
check("save 异常不崩且运行时仍生效", s3.maxInterval === 12000 && getAISettings().maxInterval === 12000);

/* ---------- 6. reset ---------- */
console.log("\n=== resetAISettings ===");
resetAISettings();
const r = getAISettings();
check("reset 全部回默认", r.maxInterval === 20000 && r.minInterval === 5000 && r.engaged === 5000 && r.skirmish === 10000 && r.idle === 20000 && r.maxManagedCount === 5 && r.adaptiveEnabled === true, JSON.stringify(r));

/* ---------- 7. mapInterval 钳制读动态配置 ---------- */
console.log("\n=== mapInterval 钳制（读动态配置）===");
{
  const miOut = resolve(tmp, "mapInterval.mjs");
  // mapInterval 依赖 eventEngine（浏览器 API），这里只做「钳制函数」的静态验证：
  // 读源码确认 ceil 不再硬编码 30000，而是走 getRuntimeBrainConfig()
  const src = readFileSync(resolve(AI_DIR, "mapInterval.ts"), "utf8");
  check("clampInterval 使用 getRuntimeBrainConfig", src.includes("getRuntimeBrainConfig()"));
  check("clampInterval 不再硬编码 30000 上界", !/Math\.min\(HARD_CEIL_INTERVAL,\s*30000\)/.test(src), "已改为动态");
  check("clampInterval 上界取 cfg.maxInterval", src.includes("cfg.maxInterval"));
  check("clampInterval 下界取 cfg.minInterval", src.includes("cfg.minInterval"));
  void miOut;
}

/* ---------- 8. types.ts 默认值一致性 ---------- */
console.log("\n=== types.ts 与 aiConfig.ts 默认值一致 ===");
{
  const typesSrc = readFileSync(resolve(AI_DIR, "types.ts"), "utf8");
  const m = typesSrc.match(/maxInterval:\s*(\d+),/);
  check("types.ts DEFAULT_BRAIN_CONFIG.maxInterval = 20000", m && m[1] === "20000", m ? m[1] : "未找到");
}

try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);