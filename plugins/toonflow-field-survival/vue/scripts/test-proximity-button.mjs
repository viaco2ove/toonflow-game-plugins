/**
 * 「走近自动弹出交互按钮」机制验证
 * 运行：node scripts/test-proximity-button.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const pluginRoot = join(repoRoot, "plugins/toonflow-field-survival");
const wsRoot = join(repoRoot, "workshops/toonflow-field-survival/map_design/通天传授-收徒系统");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " → " + detail : ""}`); }
}

/* 1. 事件配置：proximity 触发器 */
console.log("\n=== 事件配置（proximity 触发器） ===");
const evf = JSON.parse(readFileSync(join(wsRoot, "events/maps/mulberryTown.events.json"), "utf-8"));
const prox = evf.events.filter(e => e.trigger?.type === "proximity");
check("有 6 条 proximity 事件（锻造1+炼丹1+假人4）", prox.length === 6, String(prox.length));

const byUid = {};
for (const e of prox) byUid[e.trigger.uid] = e;

check("uid=256 锻造大师 → 按钮「锻造」", byUid["256"]?.proximity?.label === "锻造", JSON.stringify(byUid["256"]?.proximity));
check("uid=256 有图标", !!byUid["256"]?.proximity?.icon);
check("uid=257 炼丹炉 → 按钮「炼丹」", byUid["257"]?.proximity?.label === "炼丹");
check("uid=257 有图标", !!byUid["257"]?.proximity?.icon);
for (const uid of ["251", "252", "253", "254"]) {
  check(`uid=${uid} 假人 → 按钮「对打」`, byUid[uid]?.proximity?.label === "对打");
}
check("proximity 事件都有 radius", prox.every(e => typeof e.trigger.radius === "number" && e.trigger.radius > 0));
check("proximity 事件都是 repeat", prox.every(e => e.repeat === true));
check("锻造事件指向 E50_forge_master", byUid["256"]?.actions?.[0]?.script === "E50_forge_master");
check("炼丹事件指向 E60_alchemy_furnace", byUid["257"]?.actions?.[0]?.script === "E60_alchemy_furnace");
check("假人事件指向 E70_training_dummy", byUid["251"]?.actions?.[0]?.script === "E70_training_dummy");
check("旧 interact 版 E50/E60/E70 已移除", !evf.events.some(e => e.trigger?.type === "interact" && ["256","257","251","252","253","254"].includes(e.trigger.uid)));

/* 2. 事件引擎 */
console.log("\n=== 事件引擎 ===");
const engine = readFileSync(join(pluginRoot, "vue/src/eventEngine.ts"), "utf-8");
check("导出 getProximityPoints()", engine.includes("export function getProximityPoints"));
check("getProximityPoints 读 proximity 字段", engine.includes("ev.proximity") || engine.includes("(ev as any).proximity"));
check("onInteract 支持 proximity 触发", engine.includes('t?.type === "proximity"'));
check("eventUidsHas 认 proximity", engine.includes('t?.type === "proximity"'));
check("ProximityPoint 接口定义", engine.includes("export interface ProximityPoint"));

const ctxTs = readFileSync(join(pluginRoot, "vue/src/eventScripts/_ctx.ts"), "utf-8");
check("EventDef 支持 proximity 触发器", ctxTs.includes('{ type: "proximity"; uid: string; radius?: number }'));
check("EventDef 有 proximity 展示字段", ctxTs.includes("proximity?: {"));
check("workshops 版 _ctx 也支持 proximity", readFileSync(join(wsRoot, "events/shared/_ctx.ts"), "utf-8").includes('type: "proximity"'));

/* 3. App.vue：按钮渲染与逻辑 */
console.log("\n=== App.vue 按钮机制 ===");
const app = readFileSync(join(pluginRoot, "vue/src/App.vue"), "utf-8");
check("import getProximityPoints", app.includes("getProximityPoints } from \"./eventEngine\""));
check("有 nearInteraction 状态", app.includes("const nearInteraction = ref<"));
check("有 interactionDismissed 状态", app.includes("const interactionDismissed = ref(false)"));
check("有 updateNearInteraction()", app.includes("function updateNearInteraction()"));
check("tick 循环调用 updateNearInteraction", app.includes("updateNearInteraction();"));
check("onInteractionClick 触发事件", app.includes("async function onInteractionClick()"));
check("onInteractionClick 调 fireInteractEvent", app.includes("await fireInteractEvent(it.tiledId)"));
check("模板渲染 .btn--action 按钮", app.includes('class="btn btn--action"'));
check("按钮文案用 nearInteraction.label", app.includes("{{ nearInteraction.icon }} {{ nearInteraction.label }}"));
check("按钮受 interactionDismissed 控制", app.includes("nearInteraction && !interactionDismissed"));
check("有 .btn--action 样式", app.includes(".btn--action {"));
check("nearChat 排除 proximity 实体", app.includes("proximityUids.has(tiledId)"));
check("匹配 mapnpc_ 与 mapmob_ 实体", app.includes("mapnpc_${p.uid}") && app.includes("mapmob_${p.uid}_"));

/* 4. 脚本仍可用（点击按钮 → 脚本弹菜单） */
console.log("\n=== 脚本侧 ===");
const forge = readFileSync(join(pluginRoot, "vue/src/eventScripts/E50_forge_master.ts"), "utf-8");
const alchemy = readFileSync(join(pluginRoot, "vue/src/eventScripts/E60_alchemy_furnace.ts"), "utf-8");
const dummy = readFileSync(join(pluginRoot, "vue/src/eventScripts/E70_training_dummy.ts"), "utf-8");
check("锻造脚本打开多标签面板", forge.includes("openShopPanel"));
check("炼丹脚本打开多标签面板", alchemy.includes("openShopPanel"));
check("假人脚本弹模式菜单", dummy.includes("ctx.ui.select"));
check("锻造脚本有 4 功能", ["物品售卖", "物品打造", "升级物品", "溶解物品"].every(k => forge.includes(k)));
check("炼丹脚本有 3 功能", ["物品售卖", "开始炼丹", "溶解丹药"].every(k => alchemy.includes(k)));
check("假人脚本有站桩/实战", dummy.includes("站桩模式") && dummy.includes("模拟实战"));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);