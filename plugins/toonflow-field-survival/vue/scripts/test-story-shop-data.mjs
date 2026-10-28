/**
 * test-story-shop-data.mjs — 地图集自带货单链路验证
 * =====================================================
 * 验证「商品数据属于地图集，插件不存」这条规范落地的完整链路：
 *
 *   故事包 data/shop.forge.json / data/shop.alchemy.json
 *     → 事件脚本 ctx.story.readJson(...)
 *     → ctx.ui.openShopPanel({ mode, tab, goods })
 *     → 面板按 cat 分子标签（每个分类都必须有货，否则就是用户反馈过的
 *       「只有『全部』有物品，其他分类都是空的」）
 *
 * 做法：用 esbuild 把 E50/E60 打成 ESM，喂一个 mock ctx（story.readJson 直接读盘），
 *      断言 openShopPanel 收到的 goods。跑的是真脚本，不是正则猜。
 *
 * 运行：node scripts/test-story-shop-data.mjs
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const vueSrc = join(repoRoot, "plugins/toonflow-field-survival/vue/src");
const storyDir = join(repoRoot, "workshops/toonflow-field-survival/map_design/通天传授-收徒系统");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " → " + detail : ""}`); }
}

const esbuild = await import("esbuild");
const outDir = mkdtempSync(join(tmpdir(), "shopdata-"));

/** 打包一个事件脚本（它只 import type，产物无外部依赖） */
async function bundleScript(rel) {
  const outfile = join(outDir, rel.replace(/[\\/]/g, "_") + ".mjs");
  await esbuild.build({
    entryPoints: [join(vueSrc, rel)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile,
    logLevel: "silent",
  });
  return await import(pathToFileURL(outfile).href);
}

/** mock ctx：只实现脚本用到的部分，readJson 真读故事目录 */
function makeCtx(log) {
  return {
    player: { id: "p", name: "测试", side: "player", x: 0, y: 0, hp: 1, maxHp: 1 },
    mapName: "mulberryTown",
    actor: { roleId: "", ai: false, name: "player" },
    save: { getFlag: async () => null, setFlag: async () => {}, delFlag: async () => {}, all: async () => ({}) },
    npc: { byUid: () => null, setLabel: () => {}, move: () => {}, faceTo: () => {}, setField: () => false },
    ui: {
      toast: (t, c) => log.toasts.push(`${t}|${c || ""}`),
      subtitle: () => {},
      event: (t) => log.events.push(t),
      confirm: async () => true,
      select: async () => null,
      prompt: async () => "",
      openShopPanel: (opts) => log.panels.push(opts),
    },
    story: {
      readJson: async (p) => {
        const fp = join(storyDir, p);
        if (!existsSync(fp)) return null;
        return JSON.parse(readFileSync(fp, "utf-8"));
      },
    },
    ai: { generate: async () => "" },
    bag: { give: () => {}, list: async () => [], remove: async () => false },
    level: { switchTo: () => {}, setLocked: () => {} },
    audio: { play: () => {} },
    llm: { speak: async () => "" },
    registerAction: () => {},
    cmd: async () => "",
  };
}

/* ───────── 1. 数据文件 ───────── */
console.log("\n=== 故事包货单 ===");
const forgeFile = join(storyDir, "data/shop.forge.json");
const alchemyFile = join(storyDir, "data/shop.alchemy.json");
check("data/shop.forge.json 存在", existsSync(forgeFile));
check("data/shop.alchemy.json 存在", existsSync(alchemyFile));
const forgeRaw = JSON.parse(readFileSync(forgeFile, "utf-8"));
const alchemyRaw = JSON.parse(readFileSync(alchemyFile, "utf-8"));
const forgeGoods = Array.isArray(forgeRaw) ? forgeRaw : forgeRaw.goods;
const alchemyGoods = Array.isArray(alchemyRaw) ? alchemyRaw : alchemyRaw.goods;
check("锻造 149 件", forgeGoods.length === 149, String(forgeGoods.length));
check("炼丹 163 件", alchemyGoods.length === 163, String(alchemyGoods.length));
check("字段齐全（id/name/price/kind/rarity/from/cat）",
  [...forgeGoods, ...alchemyGoods].every((g) => g.id && g.name && g.price > 0 && g.kind && g.rarity && g.from && g.cat));
check("id 无重复", new Set([...forgeGoods, ...alchemyGoods].map((g) => g.id)).size === forgeGoods.length + alchemyGoods.length);

/* ───────── 2. E50 锻造脚本 ───────── */
console.log("\n=== E50_forge_master（真脚本执行） ===");
const e50 = await bundleScript("eventScripts/E50_forge_master.ts");
const log1 = { toasts: [], events: [], panels: [] };
await e50.default(makeCtx(log1));
const p1 = log1.panels[0];
check("打开了面板", log1.panels.length === 1);
check("mode=forge", p1?.mode === "forge", String(p1?.mode));
check("tab=sell", p1?.tab === "sell", String(p1?.tab));
check("货单 149 件随面板下发", (p1?.goods || []).length === 149, String((p1?.goods || []).length));
check("没有空货架告警", log1.toasts.length === 0, log1.toasts.join(";"));
check("事件日志带件数", String(log1.events[0] || "").includes("149"), String(log1.events[0]));

/* ───────── 3. E60 炼丹脚本 ───────── */
console.log("\n=== E60_alchemy_furnace（真脚本执行） ===");
const e60 = await bundleScript("eventScripts/E60_alchemy_furnace.ts");
const log2 = { toasts: [], events: [], panels: [] };
await e60.default(makeCtx(log2));
const p2 = log2.panels[0];
check("mode=alchemy", p2?.mode === "alchemy", String(p2?.mode));
check("货单 163 件随面板下发", (p2?.goods || []).length === 163, String((p2?.goods || []).length));
check("没有空货架告警", log2.toasts.length === 0, log2.toasts.join(";"));

/* ───────── 4. 分类子标签每页都要有货 ───────── */
console.log("\n=== 售卖分类子标签（用户曾反馈「只有全部有物品」） ===");
const FORGE_CATS = ["全部", "材料", "武器", "防具", "饰品", "图纸", "技能", "特殊"];
const ALCHEMY_CATS = ["全部", "药草", "辅料", "材料", "丹药", "药方", "器具", "套装"];
for (const cat of FORGE_CATS) {
  const n = cat === "全部" ? p1.goods.length : p1.goods.filter((g) => g.cat === cat).length;
  check(`锻造「${cat}」有货（${n} 件）`, n > 0);
}
for (const cat of ALCHEMY_CATS) {
  const n = cat === "全部" ? p2.goods.length : p2.goods.filter((g) => g.cat === cat).length;
  check(`炼丹「${cat}」有货（${n} 件）`, n > 0);
}

/* ───────── 5. 缺数据时不静默 ───────── */
console.log("\n=== 故事包缺文件时的行为 ===");
const ctxNoData = makeCtx({ toasts: [], events: [], panels: [] });
ctxNoData.story.readJson = async () => null;
const log3 = { toasts: [], events: [], panels: [] };
ctxNoData.ui.openShopPanel = (o) => log3.panels.push(o);
ctxNoData.ui.toast = (t, c) => log3.toasts.push(`${t}|${c || ""}`);
await e50.default(ctxNoData);
check("缺文件时给出红色告警", log3.toasts.some((t) => t.includes("data/shop.forge.json") && t.includes("red")), log3.toasts.join(";"));
check("缺文件时面板仍打开（不崩）", log3.panels.length === 1);
check("缺文件时货单为空数组", (log3.panels[0]?.goods || []).length === 0);

/* ───────── 6. 插件本体不含商品数据 ───────── */
console.log("\n=== 违规回归：插件不许存商品数据 ===");
const pluginRoot = join(repoRoot, "plugins/toonflow-field-survival");
check("无 src/shop/forgeGoods.ts", !existsSync(join(pluginRoot, "src/shop/forgeGoods.ts")));
check("无 src/shop/alchemyGoods.ts", !existsSync(join(pluginRoot, "src/shop/alchemyGoods.ts")));
const entrySrc = readFileSync(join(pluginRoot, "entry.ts"), "utf-8");
check("entry.ts 不含商品清单 import", !/from\s+"\.\/src\/shop\//.test(entrySrc));
const appSrc = readFileSync(join(vueSrc, "App.vue"), "utf-8");
check("App.vue 不含商品清单 import", !/from\s+"\.\.\/\.\.\/src\/shop\//.test(appSrc));
check("App.vue 货单来自 openShopPanel 下发", appSrc.includes("const forgePanelGoods = ref"));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
