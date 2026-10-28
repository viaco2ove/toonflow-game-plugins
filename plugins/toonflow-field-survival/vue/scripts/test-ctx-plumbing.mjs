/**
 * P0 能力缺口（G1/G2/G3）落地验证
 * -----------------------------------------------
 *  G1  ctx.ui.notice        —— 脚本能弹「必须点确认」的模态框
 *  G2  run_script.args      —— 透传 + ctx.event{id,uid,args}
 *  G3  ctx.playerCard       —— 只读快照 {level,money,hp,maxHp}
 *
 * 运行：node scripts/test-ctx-plumbing.mjs
 * 说明：引擎跑在 Vite 里（import.meta.glob 无法在 node 直接加载），
 *      所以这里做「源码级断言」——确保接口、实现、注入点、白名单四处都在，
 *      任何一处漏掉都会被这条测试挡住。
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const pluginRoot = join(repoRoot, "plugins/toonflow-field-survival");
const stories = ["通天传授-收徒系统", "赦夜人冥夜走廊-第二季", "黑塔：从超忆症开始成神"];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " → " + detail : ""}`); }
}

const ctxTs = readFileSync(join(pluginRoot, "vue/src/eventScripts/_ctx.ts"), "utf-8");
const engine = readFileSync(join(pluginRoot, "vue/src/eventEngine.ts"), "utf-8");
const app = readFileSync(join(pluginRoot, "vue/src/App.vue"), "utf-8");

/* ── 1. 类型契约 _ctx.ts ── */
console.log("\n=== 1. 类型契约 _ctx.ts ===");
check("Ctx.event 已声明", /\bevent:\s*\{/.test(ctxTs));
check("Ctx.event.id", /id:\s*string;/.test(ctxTs) && ctxTs.includes("事件 id（events.json 里的 id）"));
check("Ctx.event.uid 可选", /uid\?:\s*string;/.test(ctxTs));
check("Ctx.event.args", /args:\s*Record<string,\s*unknown>;/.test(ctxTs));
check("Ctx.playerCard 已声明", /\bplayerCard:\s*\{/.test(ctxTs));
for (const f of ["level", "money", "hp", "maxHp"]) {
  check(`playerCard.${f}`, new RegExp(`\\b${f}:\\s*number;`).test(ctxTs.slice(ctxTs.indexOf("playerCard: {"))));
}
check("ui.notice 已声明", /notice\(opts:\s*\{\s*title:\s*string;\s*detail\?:\s*string;\s*confirmText\?:\s*string\s*\}\):\s*Promise<void>;/.test(ctxTs));
check("EventDef.run_script 有 args", /type:\s*"run_script";\s*script:\s*string;\s*args\?:\s*Record<string,\s*unknown>/.test(ctxTs));

/* ── 2. 四份 _ctx.ts 必须一致 ── */
console.log("\n=== 2. 四份 _ctx.ts md5 一致 ===");
const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");
const baseMd5 = md5(join(pluginRoot, "vue/src/eventScripts/_ctx.ts"));
check("插件副本存在", !!baseMd5);
for (const s of stories) {
  const p = join(repoRoot, "workshops/toonflow-field-survival/map_design", s, "events/shared/_ctx.ts");
  check(`${s} 与插件副本一致`, md5(p) === baseMd5, md5(p));
}

/* ── 3. 引擎实现 eventEngine.ts ── */
console.log("\n=== 3. 引擎实现 ===");
check("EventCtxInfo 已导出", engine.includes("export interface EventCtxInfo"));
check("runScript 接收 info", /async function runScript\([\s\S]{0,200}info: EventCtxInfo/.test(engine));
check("makeCtx 接收 info", /function makeCtx\([^)]*info: EventCtxInfo/.test(engine));
check("ctx.event 由 info 填充", /event:\s*\{\s*id:\s*info\.id,\s*uid:\s*info\.uid,\s*args:\s*info\.args\s*\|\|\s*\{\}\s*\}/.test(engine));
check("ctx.playerCard 走 hooks", engine.includes("playerCard: hooks?.playerCard?.()"));
check("EventHooks.notice 可选声明", /notice\?\(opts:\s*\{\s*title:\s*string;\s*detail\?:\s*string;\s*confirmText\?:\s*string\s*\}\):\s*Promise<void>;/.test(engine));
check("EventHooks.playerCard 可选声明", engine.includes("playerCard?(): { level: number; money: number; hp: number; maxHp: number }"));
check("ui.notice 对 AI 自动跳过", /notice:\s*\(opts\)\s*=>\s*\{\s*if \(isAi\)/.test(engine));
check("run_script 传事件 id", engine.includes('id: String(ev.id || "")'));
check("run_script 传 trigger.uid", engine.includes("uid: (ev.trigger as any)?.uid"));
check("run_script 传 args", engine.includes("args: (a.args && typeof a.args === \"object\""));
check("eventEngine 的 Ctx 类型来自插件副本", engine.includes('from "./eventScripts/_ctx"'));

/* ── 4. App.vue 注入 ── */
console.log("\n=== 4. App.vue 注入 ===");
check("hooks.notice → evNoticeOpen", /notice:\s*\(opts\)\s*=>\s*evNoticeOpen\(/.test(app));
check("hooks.playerCard 已注入", /playerCard:\s*\(\)\s*=>\s*\{/.test(app));
check("playerCard.money 取 sysGold", app.includes("money: sysGold.value"));
check("playerCard.hp 取玩家实体", /hp:\s*Math\.round\(Number\(me\?\.hp/.test(app));

/* ── 5. 校验器白名单 ── */
console.log("\n=== 5. 校验器白名单 ===");
const val = readFileSync(join(repoRoot, ".cache/validate_events.mjs"), "utf-8");
for (const api of ["ui.notice", "event.id", "event.uid", "event.args", "playerCard.level", "playerCard.money", "playerCard.hp", "playerCard.maxHp"]) {
  check(`CTX_API 含 ${api}`, val.includes(`'${api}'`));
}

/* ── 6. 向后兼容：老脚本不传 args 也能跑 ── */
console.log("\n=== 6. 向后兼容 ===");
check("EMPTY_EVENT_INFO 兜底存在", engine.includes("const EMPTY_EVENT_INFO: EventCtxInfo = { id: \"\", args: {} }"));
check("runScript 的 info 参数有默认值", engine.includes("info: EventCtxInfo = EMPTY_EVENT_INFO"));
check("makeCtx 的 info 参数有默认值", engine.includes("info: EventCtxInfo = EMPTY_EVENT_INFO"));
check("args 非对象时归空", engine.includes("!Array.isArray(a.args)"));

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
