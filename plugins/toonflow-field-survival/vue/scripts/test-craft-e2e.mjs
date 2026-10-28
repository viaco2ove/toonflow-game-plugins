/**
 * ★ 打造 / 炼丹 / 升级 / 溶解 —— 端到端逻辑验证（mock 依赖跑真 opCraft）
 * ------------------------------------------------------------
 * 覆盖 2026-10-28 用户反馈的两个问题：
 *   1. 购买、打造成功等应该弹窗提示（不只是飘字）
 *   2. 用图纸打造，产出的应该是图纸记载的成品（铁剑），
 *      而不是「铁剑图纸」本身，且图纸要被消耗
 *
 * 运行：node scripts/test-craft-e2e.mjs
 * 原理：esbuild 把 forgeOps.ts 打成临时 ESM → import 真函数 → 注入 mock 依赖。
 */
import { mkdirSync, existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vueRoot = join(__dirname, "..");
const pluginRoot = join(vueRoot, "..");
const cacheDir = join(pluginRoot, "..", "..", ".cache");
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

// 用 esbuild 的 JS API（比 .bin 可执行文件跨平台稳）
const esbuild = await import("esbuild");
const outFile = join(cacheDir, "_forgeOps_e2e.mjs");
await esbuild.build({
  entryPoints: [join(vueRoot, "src", "forgeOps.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
  logLevel: "warning",
});

const { opCraft, opUpgrade, opDissolve } = await import(pathToFileURL(outFile).href);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? `（${detail}）` : ""}`); }
};

/** 造一套 mock 依赖 */
function makeDeps(opts = {}) {
  const rec = { cmds: [], removed: [], notices: [], toasts: [], aiPrompts: [], selectOpts: null };
  const deps = {
    cmd: async (action, params) => { rec.cmds.push({ action, params }); return opts.cmdResp ?? "锻造完成！获得「铁剑」"; },
    aiGenerate: async (_agent, prompt) => {
      rec.aiPrompts.push(prompt);
      return opts.aiJson ?? JSON.stringify({ name: "铁剑", kind: "weapon", rarity: "fine", desc: "锋利的铁剑", price: 80, atk: 12, def: 0, durability: 100 });
    },
    bagList: async () => opts.bag ?? [],
    bagRemove: async (name, count) => { rec.removed.push({ name, count }); return true; },
    toast: (t) => rec.toasts.push(t),
    subtitle: () => {},
    event: () => {},
    confirm: async () => true,
    select: async (o) => { rec.selectOpts = o; return opts.picked ?? (o.options[0] && o.options[0].value); },
    prompt: async () => opts.typed ?? "寒铁软剑",
    notice: async (o) => { rec.notices.push(o); },
    playerLevel: () => 5,
    money: () => opts.money ?? 1000,
  };
  return { deps, rec };
}

const BAG = [
  { name: "铁剑图纸", kind: "material", count: 2, rarity: "common", heal: 0, price: 50 },
  { name: "明月剑铸造秘法", kind: "material", count: 1, rarity: "rare", heal: 0, price: 400 },
  { name: "基础锻造术", kind: "skill_book", count: 1, rarity: "fine", heal: 0, price: 200 },
  { name: "铁矿石", kind: "material", count: 5, rarity: "common", heal: 0, price: 10 },
];

/* ── 1. 图纸打造：产物=成品，图纸被消耗 ── */
console.log("\n=== 图纸打造（铁剑图纸）===");
{
  const { deps, rec } = makeDeps({ bag: BAG, picked: "铁剑图纸" });
  const ok = await opCraft(deps, "forge", "blueprint");
  const cmd = rec.cmds.find((c) => c.action === "sys_forge_create");
  check("操作成功返回 true", ok === true);
  check("发给后端的是 sys_forge_create", !!cmd);
  check("input = 成品「铁剑」（不是图纸名）", cmd?.params?.input === "铁剑", `实际 "${cmd?.params?.input}"`);
  check("blueprint = 「铁剑图纸」", cmd?.params?.blueprint === "铁剑图纸", `实际 "${cmd?.params?.blueprint}"`);
  check("提示词含【按图纸制造】", String(rec.aiPrompts[0] || "").includes("【按图纸制造】"));
  check("提示词点名成品「铁剑」", String(rec.aiPrompts[0] || "").includes("铁剑"));
  check("提示词禁止产出图纸", String(rec.aiPrompts[0] || "").includes("图纸是消耗品"));
  check("图纸被消耗 1 张", rec.removed.some((r) => r.name === "铁剑图纸" && r.count === 1), JSON.stringify(rec.removed));
  check("弹出「🔨 锻造成功」", rec.notices[0]?.title === "🔨 锻造成功", rec.notices[0]?.title);
  check("弹窗内容含获得「铁剑」", String(rec.notices[0]?.detail || "").includes("获得「铁剑」"), rec.notices[0]?.detail);
  check("弹窗内容含已消耗图纸", String(rec.notices[0]?.detail || "").includes("已消耗图纸「铁剑图纸」"));
  check("选择列表标出产物", String(rec.selectOpts?.options?.[0]?.desc || "").includes("制作「铁剑」"), rec.selectOpts?.options?.[0]?.desc);
  check("选择列表不含技能书", !(rec.selectOpts?.options || []).some((o) => o.label === "基础锻造术"));
}

/* ── 2. AI 仍返回图纸名 → 强制纠正 ── */
console.log("\n=== AI 返回图纸名时强制纠正 ===");
{
  const { deps, rec } = makeDeps({
    bag: BAG, picked: "铁剑图纸",
    aiJson: JSON.stringify({ name: "铁剑图纸", kind: "material", rarity: "fine", desc: "图纸", price: 50 }),
  });
  await opCraft(deps, "forge", "blueprint");
  const cmd = rec.cmds.find((c) => c.action === "sys_forge_create");
  const sent = JSON.parse(cmd.params.aiJson || "{}");
  check("产物名被改成「铁剑」", sent.name === "铁剑", sent.name);
  check("弹窗不把图纸当产物", !String(rec.notices[0]?.detail || "").includes("获得「铁剑图纸」"));
}

/* ── 3. 药方炼丹 ── */
console.log("\n=== 药方炼丹 ===");
{
  const { deps, rec } = makeDeps({
    bag: [{ name: "九转回魂丹配方", kind: "material", count: 1, rarity: "epic", heal: 0, price: 600 }],
    picked: "九转回魂丹配方",
    aiJson: JSON.stringify({ name: "九转回魂丹", kind: "consumable", rarity: "epic", heal: 800, desc: "起死回生", price: 600 }),
    cmdResp: "炼丹完成！获得「九转回魂丹」",
  });
  await opCraft(deps, "alchemy", "blueprint");
  const cmd = rec.cmds.find((c) => c.action === "sys_alchemy_create");
  check("input = 「九转回魂丹」", cmd?.params?.input === "九转回魂丹", cmd?.params?.input);
  check("药方被消耗", rec.removed.some((r) => r.name === "九转回魂丹配方"));
  check("弹出「🔥 炼丹成功」", rec.notices[0]?.title === "🔥 炼丹成功");
}

/* ── 4. 金钱不足 → 弹窗，不消耗图纸 ── */
console.log("\n=== 金钱不足 ===");
{
  const { deps, rec } = makeDeps({ bag: BAG, picked: "铁剑图纸", money: 3 });
  const ok = await opCraft(deps, "forge", "blueprint");
  check("返回 false", ok === false);
  check("没有发命令", rec.cmds.length === 0);
  check("没有消耗图纸", rec.removed.length === 0);
  check("弹出「💰 金钱不足」", rec.notices[0]?.title === "💰 金钱不足", rec.notices[0]?.title);
}

/* ── 5. 后端拒绝 → 失败弹窗，不消耗图纸 ── */
console.log("\n=== 后端拒绝 ===");
{
  const { deps, rec } = makeDeps({ bag: BAG, picked: "铁剑图纸", cmdResp: "金钱不足：打造需要 10 金钱" });
  const ok = await opCraft(deps, "forge", "blueprint");
  check("返回 false", ok === false);
  check("图纸没被消耗", rec.removed.length === 0, JSON.stringify(rec.removed));
  check("弹出「❌ 锻造失败」", rec.notices[0]?.title === "❌ 锻造失败", rec.notices[0]?.title);
}

/* ── 6. 手输打造：不消耗图纸，仍弹窗 ── */
console.log("\n=== 手输打造（无图纸）===");
{
  const { deps, rec } = makeDeps({
    bag: BAG, typed: "寒铁软剑",
    aiJson: JSON.stringify({ name: "寒铁软剑", kind: "weapon", rarity: "rare", desc: "寒气逼人", price: 300, atk: 30, def: 5, durability: 120 }),
  });
  const ok = await opCraft(deps, "forge", "input");
  const cmd = rec.cmds.find((c) => c.action === "sys_forge_create");
  check("返回 true", ok === true);
  check("input = 玩家输入", cmd?.params?.input === "寒铁软剑");
  check("blueprint 为空", cmd?.params?.blueprint === "");
  check("没消耗任何图纸", rec.removed.length === 0);
  check("弹出「🔨 锻造成功」", rec.notices[0]?.title === "🔨 锻造成功");
  check("弹窗带属性（攻击 +30）", String(rec.notices[0]?.detail || "").includes("攻击 +30"), rec.notices[0]?.detail);
}

/* ── 7. 升级 / 溶解也弹窗 ── */
console.log("\n=== 升级 / 溶解 ===");
{
  const { deps, rec } = makeDeps({
    bag: [{ name: "铁矿石", kind: "material", count: 10 }, { name: "灵石碎屑", kind: "material", count: 5 }],
    cmdResp: "升级完成！获得「铁剑+2」",
    aiJson: JSON.stringify({ name: "铁剑+2", atk: 20, def: 4, durability: 120, desc: "更锋利" }),
  });
  const ok = await opUpgrade(deps, { name: "铁剑", lv: 1, kind: "weapon", rarity: "fine", desc: "锋利的铁剑" });
  check("升级返回 true", ok === true);
  check("弹出「⬆ 升级成功」", rec.notices[0]?.title === "⬆ 升级成功", rec.notices[0]?.title);
}
{
  const { deps, rec } = makeDeps({ cmdResp: "溶解完成，获得 铁矿石×2" });
  const ok = await opDissolve(deps, "forge", { name: "铁剑", rarity: "common", lv: 1 });
  check("溶解返回 true", ok === true);
  check("弹出「⚒ 溶解完成」", rec.notices[0]?.title === "⚒ 溶解完成", rec.notices[0]?.title);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);
