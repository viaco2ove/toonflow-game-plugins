/**
 * 锻造/炼丹完整功能验证（不依赖浏览器）
 * 运行：node scripts/test-forge-alchemy.mjs
 *
 * 覆盖：
 *   1. forgeCommon 的工具函数（JSON 解析、校验、筛选、返还算法、Prompt）
 *   2. 两个事件脚本的菜单结构（4 功能 / 3 功能）
 *   3. entry.ts 后端 cmd 齐全性
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const pluginRoot = join(repoRoot, "plugins/toonflow-field-survival");
const vueScripts = join(pluginRoot, "vue/src/eventScripts");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " → " + detail : ""}`); }
}

/* ============================================================
   1. 工具函数测试（直接跑 forgeCommon 的纯逻辑）
   ============================================================ */
console.log("\n=== forgeCommon 工具函数 ===");

// 从源文件抽出纯函数（无 import 依赖的），用 TS→JS 的轻量剥离
const commonSrc = readFileSync(join(vueScripts, "forgeCommon.ts"), "utf-8");

/** 把 TS 源码片段剥成可执行 JS：
 *  - 去掉 export
 *  - 去掉参数/返回值类型标注
 *  - 去掉泛型实参
 */
function stripTypes(src) {
  return src
    .replace(/export\s+/g, "")
    // 泛型实参 <T,> / <T>（在参数位置）
    .replace(/<\s*[A-Za-z_$][\w$]*\s*(,\s*[A-Za-z_$][\w$]*\s*)*>/g, "")
    // 参数类型标注： name: Type
    .replace(/([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$]*\s*(?=[,)=])/g, "$1")
    // 参数类型标注： name: Type | Type2
    .replace(/([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$]*\s*\|\s*[A-Za-z_$][\w$]*(?=[,)=])/g, "$1")
    // 剩余可选参数 ?: Type
    .replace(/\?\s*:\s*[A-Za-z_$][\w$]*/g, "")
    // 返回值类型：) : Type {
    .replace(/\)\s*:\s*[A-Za-z_$][\w$]*\s*(\|\s*[A-Za-z_$][\w$]*)?\s*\{/g, ") {")
    // 返回值类型：) : Type | null {
    .replace(/\)\s*:\s*[A-Za-z_$][\w$]*\s*\|\s*null\s*\{/g, ") {")
    // 返回值类型：) : Array<...> {
    .replace(/\)\s*:\s*[A-Za-z_$][\w$]*\s*<[^>]*>\s*\{/g, ") {")
    // 返回值类型：) : { a: T; b: T } {  （对象字面量类型）
    .replace(/\)\s*:\s*\{[^}]*\}\s*\{/g, ") {")
    // 变量类型标注：const x: Type = / const x: Record<...> =
    .replace(/:\s*Record<string,\s*number>/g, "")
    .replace(/:\s*Partial<[^>]+>/g, "")
    .replace(/:\s*BagEntry\[\]/g, "")
    .replace(/:\s*GeneratedItem\s*\|\s*null/g, "")
    .replace(/:\s*GeneratedItem/g, "")
    .replace(/:\s*string\[\]/g, "")
    .replace(/:\s*string/g, "")
    .replace(/:\s*number/g, "")
    .replace(/:\s*boolean/g, "")
    .replace(/:\s*any/g, "")
    .replace(/:\s*void/g, "");
}

function extractPure(name) {
  const m = commonSrc.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error("找不到函数 " + name);
  return stripTypes(m[0]);
}

// extractJsonObject
const extractJsonObject = new Function(`
  ${extractPure("extractJsonObject")}
  return extractJsonObject;
`)();

check("解析裸 JSON", extractJsonObject('{"name":"玄天剑"}')?.name === "玄天剑");
check("解析 ```json 围栏", extractJsonObject('```json\n{"name":"寒铁刀"}\n```')?.name === "寒铁刀");
check("解析带前后文", extractJsonObject('好的：{"name":"流云剑"} 完毕')?.name === "流云剑");
check("非法 JSON 返回 null", extractJsonObject("not json") === null);
check("空串返回 null", extractJsonObject("") === null);

// normalizeGenerated（需要常量）
const normalizeGenerated = new Function(`
  const ITEM_KINDS = ["material","equipment","weapon","armor","skill_book","consumable"];
  const RARITY_VALUES = ["common","fine","rare","epic","legend"];
  ${extractPure("normalizeGenerated")}
  return normalizeGenerated;
`)();

const g1 = normalizeGenerated({ name: "玄天剑", kind: "weapon", rarity: "legend", atk: 99999, desc: "很长的描述".repeat(20) });
check("正常归一化", g1?.name === "玄天剑" && g1?.rarity === "legend" && g1?.kind === "weapon");
check("攻击值被钳制到 9999", g1?.atk === 9999, String(g1?.atk));
check("描述被截断到 60 字", (g1?.desc || "").length === 60, String(g1?.desc?.length));
check("空名返回 null", normalizeGenerated({ name: "" }) === null);
check("非法品质回退 common", normalizeGenerated({ name: "X", rarity: "ultra" })?.rarity === "common");
check("非法 kind 回退 material", normalizeGenerated({ name: "X", kind: "weird" })?.kind === "material");
check("负数被钳到 0", normalizeGenerated({ name: "X", heal: -50 })?.heal === 0);
check("名称被截断到 20 字", (normalizeGenerated({ name: "x".repeat(50) })?.name || "").length === 20);

// 溶解返还算法
const calcDissolveReturns = new Function(`
  const DISSOLVE_MULT = { common: 1, fine: 2, rare: 4, epic: 8, legend: 15 };
  ${extractPure("calcDissolveReturns")}
  return calcDissolveReturns;
`)();
check("common lv1 → 铁矿石1", calcDissolveReturns("common", 1).ore === 1);
check("rare lv3 → 铁矿石12", calcDissolveReturns("rare", 3).ore === 12);
check("legend lv10 → 铁矿石150", calcDissolveReturns("legend", 10).ore === 150);
check("灵石碎屑 = floor(ore/3)", calcDissolveReturns("rare", 3).stone === 4);
check("未知品质按 common", calcDissolveReturns("unknown", 5).ore === 5);

const calcPillDissolveReturns = new Function(`
  ${extractPure("calcPillDissolveReturns")}
  return calcPillDissolveReturns;
`)();
check("丹药 heal100 → 草药5", calcPillDissolveReturns(100).herb === 5);
check("丹药 heal100 → 灵芝1", calcPillDissolveReturns(100).lingzhi === 1);
check("丹药 heal10 → 草药1（保底）", calcPillDissolveReturns(10).herb === 1);

// 背包筛选
const pickEquipments = new Function(`
  ${extractPure("pickEquipments")}
  return pickEquipments;
`)();
const bag = [
  { name: "精钢剑", kind: "equipment", rarity: "fine", heal: 0, count: 1 },
  { name: "基础锻造术", kind: "skill_book", rarity: "fine", heal: 0, count: 1 },
  { name: "铁矿石", kind: "material", rarity: "common", heal: 0, count: 5 },
  { name: "皮甲", kind: "armor", rarity: "common", heal: 0, count: 1 },
  { name: "铁剑图纸", kind: "material", rarity: "common", heal: 0, count: 1 },
];
const eqs = pickEquipments(bag);
check("装备筛选只留装备/护甲", eqs.length === 2, JSON.stringify(eqs.map(e => e.name)));
check("装备筛选排除技能书", !eqs.find(e => e.name.includes("锻造术")));
check("装备筛选排除材料", !eqs.find(e => e.name === "铁矿石"));
check("装备筛选排除图纸", !eqs.find(e => e.name.includes("图纸")));

const pickPills = new Function(`${extractPure("pickPills")} return pickPills;`)();
const pills = pickPills([
  { name: "止血散", kind: "consumable", rarity: "common", heal: 20, count: 1 },
  { name: "大还丹", kind: "consumable", rarity: "rare", heal: 200, count: 1 },
  { name: "止血散配方", kind: "material", rarity: "common", heal: 0, count: 1 },
  { name: "铁矿石", kind: "material", rarity: "common", heal: 0, count: 5 },
]);
check("丹药筛选只留消耗品", pills.length === 2, JSON.stringify(pills.map(p => p.name)));
check("丹药筛选排除药方", !pills.find(p => p.name.includes("配方")));

const pickBlueprints = new Function(`${extractPure("pickBlueprints")} return pickBlueprints;`)();
check("图纸筛选识别「图纸」", pickBlueprints(bag).length === 1);
check("图纸筛选排除「药方」", pickBlueprints([{ name: "大还丹配方" }]).length === 0);

const pickRecipes = new Function(`${extractPure("pickRecipes")} return pickRecipes;`)();
check("药方筛选识别「药方」", pickRecipes([{ name: "大还丹配方" }]).length === 1);
check("药方筛选识别「药方」字样", pickRecipes([{ name: "止血散药方" }]).length === 1);
check("药方筛选排除「图纸」", pickRecipes([{ name: "铁剑图纸" }]).length === 0);

/* ============================================================
   2. 事件脚本 + 面板 + 操作逻辑（v3 面板模式）
   ============================================================ */
console.log("\n=== 事件脚本 & 面板（v3 面板模式） ===");

const forge = readFileSync(join(vueScripts, "E50_forge_master.ts"), "utf-8");
const alchemy = readFileSync(join(vueScripts, "E60_alchemy_furnace.ts"), "utf-8");
const panelPath = join(pluginRoot, "vue/src/panels/ForgeAlchemyPanel.vue");
const panel = readFileSync(panelPath, "utf-8");
const opsPath = join(pluginRoot, "vue/src/forgeOps.ts");
const ops = readFileSync(opsPath, "utf-8");

// 脚本只负责打开面板
check("锻造脚本打开多标签面板", forge.includes('openShopPanel({ mode: "forge"'));
check("炼丹脚本打开多标签面板", alchemy.includes('openShopPanel({ mode: "alchemy"'));

// 面板结构
["物品售卖", "物品打造", "升级物品", "溶解物品"].forEach((label) => {
  check(`锻造面板标签「${label}」`, panel.includes(label));
});
["物品售卖", "开始炼丹", "溶解丹药"].forEach((label) => {
  check(`炼丹面板标签「${label}」`, panel.includes(label));
});
check("面板售卖页按类型分组", panel.includes("grouped"));
check("面板有购买按钮", panel.includes('emit("buy"'));

// 操作逻辑（在 forgeOps.ts）
check("打造调用 AI（aiGenerate）", ops.includes("deps.aiGenerate"));
check("打造有输入名称路径", ops.includes('way === "input"'));
check("打造有选图纸路径", ops.includes('way === "blueprint"') && ops.includes("pickBlueprints"));
check("炼丹有选药方路径", ops.includes("pickRecipes"));
check("升级路径（sys_item_upgrade）", ops.includes("sys_item_upgrade"));
check("溶解路径（sys_item_dissolve）", ops.includes("sys_item_dissolve"));
check("锻造扣 10 金钱（FORGE_COST）", ops.includes("FORGE_COST = 10"));
check("AI 失败回退随机（randomForgeItem/randomPill）", ops.includes("randomForgeItem") && ops.includes("randomPill"));

/* ============================================================
   3. entry.ts 后端 cmd 齐全性
   ============================================================ */
console.log("\n=== entry.ts 后端 cmd ===");
const entry = readFileSync(join(pluginRoot, "entry.ts"), "utf-8");
["sys_agent_run", "sys_bag_list", "sys_bag_remove", "sys_forge_create", "sys_alchemy_create", "sys_item_upgrade", "sys_item_dissolve"]
  .forEach((cmd) => check(`cmd「${cmd}」已实现`, entry.includes(`case "${cmd}"`)));
check("agentResult 通道已定义", entry.includes("agentResult"));
check("AI 解析函数已实现", entry.includes("extractJsonObject"));
check("物品校验函数已实现", entry.includes("normalizeGeneratedItem"));

/* ============================================================
   4. 引擎能力测试
   ============================================================ */
console.log("\n=== 事件引擎能力 ===");
const ctxTs = readFileSync(join(vueScripts, "_ctx.ts"), "utf-8");
check("Ctx 有 select()", ctxTs.includes("select(opts:"));
check("Ctx 有 prompt()", ctxTs.includes("prompt(opts:"));
check("Ctx 有 ai.generate()", ctxTs.includes("generate(agentName:"));
check("Ctx 有 bag.list()", ctxTs.includes("list():"));
check("Ctx 有 bag.remove()", ctxTs.includes("remove(name:"));

const engine = readFileSync(join(pluginRoot, "vue/src/eventEngine.ts"), "utf-8");
check("EventHooks 有 select", engine.includes("select(opts:"));
check("EventHooks 有 prompt", engine.includes("prompt(opts:"));
check("EventHooks 有 agentRun", engine.includes("agentRun(agentName:"));
check("EventHooks 有 bagList", engine.includes("bagList()"));
check("EventHooks 有 bagRemove", engine.includes("bagRemove(name:"));

const appVue = readFileSync(join(pluginRoot, "vue/src/App.vue"), "utf-8");
check("App 有 evSelectOpen", appVue.includes("function evSelectOpen"));
check("App 有 evPromptOpen", appVue.includes("function evPromptOpen"));
check("App 有 eventAgentRun", appVue.includes("function eventAgentRun"));
check("App 有 eventBagList", appVue.includes("function eventBagList"));
check("App 有 eventBagRemove", appVue.includes("function eventBagRemove"));
check("App 模板含 select 面板", appVue.includes("ev-select__list"));
check("App 模板含 prompt 输入框", appVue.includes("ev-prompt__input"));
check("App 消费 agentResult", appVue.includes("notifyAgentResult"));

/* ============================================================
   5. workshops 同步一致性
   ============================================================ */
console.log("\n=== workshops 同步 ===");
const wsScripts = join(repoRoot, "workshops/toonflow-field-survival/map_design/通天传授-收徒系统/events/scripts");
["E50_forge_master.ts", "E60_alchemy_furnace.ts", "forgeCommon.ts"].forEach((f) => {
  check(`${f} 已同步到 workshops`, (() => {
    try { readFileSync(join(wsScripts, f), "utf-8"); return true; } catch { return false; }
  })());
});
const wsCommon = readFileSync(join(wsScripts, "forgeCommon.ts"), "utf-8");
check("workshops 版 import 指向 shared/_ctx", wsCommon.includes('from "../shared/_ctx"'));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);