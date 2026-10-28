/**
 * ★ 图纸 / 药方 → 产物名 解析测试
 * ------------------------------------------------------------
 * 背景（2026-10-28 用户反馈）：
 *   用图纸打造后，背包里增加的是「铁剑图纸」而不是「铁剑」，图纸还留在包里，
 *   越打越多。根因是把图纸名当 input 喂给 AI，AI 就照着生成了一件图纸。
 *   修法：blueprintProduct() 把图纸名解析成成品名，打造后消耗 1 张图纸。
 *
 * 运行：node scripts/test-blueprint-product.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vueSrc = join(__dirname, "..", "src");
const commonSrc = readFileSync(join(vueSrc, "eventScripts/forgeCommon.ts"), "utf-8");

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? `（${detail}）` : ""}`); }
}

/** 从 TS 源码里抽出单个函数（含类型标注，需要 stripTypes） */
function extractPure(name) {
  const m = commonSrc.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error("找不到函数 " + name);
  return stripTypes(m[0]);
}
function stripTypes(code) {
  return code
    .replace(/export\s+/g, "")
    .replace(/:\s*BagEntry\[\]/g, "")
    .replace(/:\s*string/g, "")
    .replace(/:\s*boolean/g, "");
}

/* 常量：图纸后缀表 / 无意义词表（从源码里抠出来，改源码即生效） */
const suffixesMatch = commonSrc.match(/const BP_SUFFIXES = \[[\s\S]*?\];/);
const meaninglessMatch = commonSrc.match(/const BP_MEANINGLESS = (\/.*?\/);/);
if (!suffixesMatch || !meaninglessMatch) throw new Error("找不到 BP_SUFFIXES / BP_MEANINGLESS");

const factory = new Function(`
  ${suffixesMatch[0]}
  const BP_MEANINGLESS = ${meaninglessMatch[1]};
  ${extractPure("blueprintProduct")}
  ${extractPure("looksLikeBlueprint")}
  ${extractPure("pickBlueprints")}
  ${extractPure("pickRecipes")}
  return { blueprintProduct, looksLikeBlueprint, pickBlueprints, pickRecipes };
`);
const { blueprintProduct, looksLikeBlueprint, pickBlueprints, pickRecipes } = factory();

/* ── 1. 锻造图纸（商品清单里全部 8 张）── */
console.log("\n=== 锻造图纸 → 成品 ===");
const forgeCases = [
  ["铁剑图纸", "铁剑"],
  ["精钢甲图纸", "精钢甲"],
  ["软剑锻造法", "软剑"],
  ["复合弓图纸", "复合弓"],
  ["明月剑铸造秘法", "明月剑"],
  ["龙鳞甲编缀图", "龙鳞甲"],
  ["虚空武器锻造术", "虚空武器"],
  ["神兵铸造总纲", ""],   // 没写明具体产物 → 交给 AI 自由发挥
];
for (const [input, expect] of forgeCases) {
  const got = blueprintProduct(input);
  check(`「${input}」→「${got || "（随机）"}」`, got === expect, `期望「${expect}」`);
}

/* ── 2. 炼丹药方 ── */
console.log("\n=== 炼丹药方 → 丹药 ===");
const alchemyCases = [
  ["止血散配方", "止血散"],
  ["九转回魂丹配方", "九转回魂丹"],
  ["万毒不侵丹配方", "万毒不侵丹"],
  ["随机丹方残卷", ""],
  ["上古丹方拓本", ""],
];
for (const [input, expect] of alchemyCases) {
  const got = blueprintProduct(input);
  check(`「${input}」→「${got || "（随机）"}」`, got === expect, `期望「${expect}」`);
}

/* ── 3. 反例：正常物品名不该被剥 ── */
console.log("\n=== 反例 ===");
check("「铁剑」原样返回", blueprintProduct("铁剑") === "铁剑");
check("「图纸」本身 → 空（产物未知）", blueprintProduct("图纸") === "");
check("空串 → 空", blueprintProduct("") === "");

/* ── 4. looksLikeBlueprint：拦 AI 把图纸当产物 ── */
console.log("\n=== 产物名拦截 ===");
for (const n of ["铁剑图纸", "九转回魂丹配方", "虚空武器锻造术", "龙鳞甲编缀图", "神兵铸造总纲"]) {
  check(`「${n}」判定为图纸`, looksLikeBlueprint(n));
}
for (const n of ["铁剑", "精钢甲", "九转还魂丹", "灵石碎屑", "铁矿石"]) {
  check(`「${n}」不是图纸`, !looksLikeBlueprint(n));
}

/* ── 5. 背包筛选：图纸/药方要筛全，技能书不能混进来 ── */
console.log("\n=== 背包筛选 ===");
const bag = [
  { name: "铁剑图纸", kind: "material", count: 1 },
  { name: "精钢甲图纸", kind: "material", count: 1 },
  { name: "软剑锻造法", kind: "material", count: 1 },
  { name: "复合弓图纸", kind: "material", count: 1 },
  { name: "明月剑铸造秘法", kind: "material", count: 1 },
  { name: "龙鳞甲编缀图", kind: "material", count: 1 },
  { name: "虚空武器锻造术", kind: "material", count: 1 },
  { name: "神兵铸造总纲", kind: "material", count: 1 },
  { name: "铁剑", kind: "weapon", count: 1 },
  { name: "铁矿石", kind: "material", count: 5 },
  { name: "基础锻造术", kind: "skill_book", count: 1 },
];
const bps = pickBlueprints(bag);
check("8 张图纸全部筛出", bps.length === 8, `实际 ${bps.length}`);
check("技能书「基础锻造术」不算图纸", !bps.find((b) => b.name === "基础锻造术"));
check("装备「铁剑」不算图纸", !bps.find((b) => b.name === "铁剑"));

const bag2 = [
  { name: "止血散配方", kind: "material", count: 1 },
  { name: "九转回魂丹配方", kind: "material", count: 1 },
  { name: "随机丹方残卷", kind: "material", count: 1 },
  { name: "上古丹方拓本", kind: "material", count: 1 },
  { name: "铁剑图纸", kind: "material", count: 1 },
  { name: "回春丹", kind: "consumable", count: 1 },
  { name: "初级炼丹术", kind: "skill_book", count: 1 },
];
const recs = pickRecipes(bag2);
check("4 张药方全部筛出", recs.length === 4, `实际 ${recs.length}`);
check("图纸「铁剑图纸」不算药方", !recs.find((b) => b.name === "铁剑图纸"));
check("丹药「回春丹」不算药方", !recs.find((b) => b.name === "回春丹"));
check("技能书「初级炼丹术」不算药方", !recs.find((b) => b.name === "初级炼丹术"));

/* ── 6. 源码结构：前端 + 后端都要有这套逻辑 ── */
console.log("\n=== 源码接线 ===");
const forgeOps = readFileSync(join(vueSrc, "forgeOps.ts"), "utf-8");
const appSrc = readFileSync(join(vueSrc, "App.vue"), "utf-8");
const entrySrc = readFileSync(join(vueSrc, "..", "..", "entry.ts"), "utf-8");

check("forgeOps 用 blueprintProduct 解析产物", forgeOps.includes("input = blueprintProduct(picked)"));
// 图纸消耗只由后端做（前端再扣一次 = 双重扣除，实测 2 张图纸打一件归零）
check("前端不重复扣图纸（交给后端）", !forgeOps.includes("await deps.bagRemove(blueprint, 1)"));
check("blueprint 参数传给后端", forgeOps.includes("blueprint,"));
check("后端 sys_forge_create 扣图纸", entrySrc.includes("if (fBlueprint) removeFromPlayerBag(s, fBlueprint, 1)"));
check("mockHost 也扣图纸（standalone 调试）", readFileSync(join(vueSrc, "mockHost.ts"), "utf-8").includes("blueprintName"));
check("forgeOps 拦 AI 返回图纸名", forgeOps.includes("if (looksLikeBlueprint(final.name))"));
check("提示词含图纸约束", commonSrc.includes("【按图纸制造】") && commonSrc.includes("【按药方炼制】"));
check("后端有 blueprintProductName", entrySrc.includes("function blueprintProductName("));
check("后端 forge 消耗图纸", entrySrc.includes("if (fBlueprint) removeFromPlayerBag(s, fBlueprint, 1)"));
check("后端 alchemy 消耗药方", entrySrc.includes("if (aBlueprint) removeFromPlayerBag(s, aBlueprint, 1)"));
check("结果弹窗已接入（打造成功）", appSrc.includes("const evNotice = ref<") && forgeOps.includes("🔨 锻造成功"));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);
