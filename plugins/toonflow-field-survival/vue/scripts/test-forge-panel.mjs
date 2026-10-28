/**
 * 锻造/炼丹多标签面板验证
 * 运行：node scripts/test-forge-panel.mjs
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const pluginRoot = join(repoRoot, "plugins/toonflow-field-survival");
const vueSrc = join(pluginRoot, "vue/src");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " → " + detail : ""}`); }
}

/* 1. 商品数据文件（从设计文档生成） */
console.log("\n=== 商品数据（自动生成） ===");
const forgeTs = readFileSync(join(pluginRoot, "src/shop/forgeGoods.ts"), "utf-8");
const alchemyTs = readFileSync(join(pluginRoot, "src/shop/alchemyGoods.ts"), "utf-8");
const countGoods = (ts) => (ts.match(/id: "/g) || []).length;
check("锻造商品 ≥140 种（文档 149）", countGoods(forgeTs) >= 140, String(countGoods(forgeTs)));
check("炼丹商品 ≥160 种（文档 163）", countGoods(alchemyTs) >= 160, String(countGoods(alchemyTs)));
// ★ 售卖子标签页：cat 分类字段
const catCount = (ts) => (ts.match(/cat: "/g) || []).length;
check("锻造商品全部带 cat 分类", catCount(forgeTs) >= 140, String(catCount(forgeTs)));
check("炼丹商品全部带 cat 分类", catCount(alchemyTs) >= 160, String(catCount(alchemyTs)));
check("锻造 7 分类齐全（材料/武器/防具/饰品/图纸/技能/特殊）",
  ["材料", "武器", "防具", "饰品", "图纸", "技能", "特殊"].every((c) => forgeTs.includes(`cat: "${c}"`)));
check("炼丹 7 分类齐全（药草/辅料/材料/丹药/药方/器具/套装）",
  ["药草", "辅料", "材料", "丹药", "药方", "器具", "套装"].every((c) => alchemyTs.includes(`cat: "${c}"`)));
check("锻造 from=forge_master", forgeTs.includes('from: "forge_master"'));
check("炼丹 from=alchemy_furnace", alchemyTs.includes('from: "alchemy_furnace"'));
check("含铁剑（锻造代表）", forgeTs.includes("铁剑"));
check("含天问剑（legend 品）", forgeTs.includes("天问剑"));
check("含人参（炼丹代表）", alchemyTs.includes("人参"));
check("含不死药（legend 品）", alchemyTs.includes("不死药"));
check("生成脚本存在", existsSync(join(pluginRoot, "vue/scripts/gen-shop-goods.mjs")));

/* 2. 多标签面板组件 */
console.log("\n=== ForgeAlchemyPanel 组件 ===");
const panel = readFileSync(join(vueSrc, "panels/ForgeAlchemyPanel.vue"), "utf-8");
check("锻造 4 标签（售卖/打造/升级/溶解）",
  ["物品售卖", "物品打造", "升级物品", "溶解物品"].every(k => panel.includes(k)));
check("炼丹 3 标签（售卖/炼丹/溶解）",
  panel.includes("开始炼丹") && panel.includes("溶解丹药"));
check("商品按类型分组", panel.includes("grouped"));
check("售卖分类子标签栏（fap-cats）", panel.includes("fap-cats") && panel.includes("fap-cat"));
check("锻造子标签顺序含全部/武器/防具", panel.includes('"全部", "材料", "武器", "防具", "饰品", "图纸", "技能", "特殊"'));
check("炼丹子标签顺序含全部/药草/丹药", panel.includes('"全部", "药草", "辅料", "材料", "丹药", "药方", "器具", "套装"'));
check("子标签选中态 activeCat", panel.includes("activeCat") && panel.includes("activeCatGoods"));
check("跨分类搜索兜底", panel.includes("searchFallback"));
check("售卖搜索框", panel.includes("fap-search"));
check("品质颜色区分", panel.includes("RARITY_COLOR"));
check("买不起置灰", panel.includes("fap-row--no") && panel.includes("disabled"));
check("打造三入口（输入/随机/图纸）",
  panel.includes("craft-input") && panel.includes("craft-random") && panel.includes("craft-blueprint"));
check("购买 emit", panel.includes('emit("buy"'));

/* 3. App.vue 集成 */
console.log("\n=== App.vue 集成 ===");
const app = readFileSync(join(vueSrc, "App.vue"), "utf-8");
check("import ForgeAlchemyPanel", app.includes('import ForgeAlchemyPanel from "./panels/ForgeAlchemyPanel.vue"'));
check("import forgeOps", app.includes('from "./forgeOps"'));
check("面板模板（forge-panel）", app.includes('class="forge-panel"'));
check("v-if=forgePanelOpen", app.includes('v-if="forgePanelOpen"'));
check("打开函数 openForgeAlchemyPanel", app.includes("function openForgeAlchemyPanel"));
check("购买走 onSysBuyItem", app.includes("function onForgeBuy"));
check("sysForgeGoods computed", app.includes("const sysForgeGoods = computed"));
check("sysAlchemyGoods computed", app.includes("const sysAlchemyGoods = computed"));
check("opsDeps 依赖注入", app.includes("function forgeOpsDeps"));
check("面板可拖拽", app.includes("onForgePanelDragStart"));

/* 4. forgeOps 操作逻辑 */
console.log("\n=== forgeOps 操作逻辑 ===");
const ops = readFileSync(join(vueSrc, "forgeOps.ts"), "utf-8");
check("opCraft 打造（输入/随机/图纸）", ops.includes('way === "input"') && ops.includes('way === "blueprint"'));
check("opUpgrade 升级（材料校验+AI）", ops.includes("sys_item_upgrade"));
check("opDissolve 溶解（装备/丹药双模式）", ops.includes("isPill"));
check("AI 回退随机兜底", ops.includes("randomForgeItem") && ops.includes("randomPill"));
check("锻造扣 10 金", ops.includes("FORGE_COST = 10"));

/* 5. 事件脚本（打开面板） */
console.log("\n=== 事件脚本 ===");
const forgeScript = readFileSync(join(vueSrc, "eventScripts/E50_forge_master.ts"), "utf-8");
const alchemyScript = readFileSync(join(vueSrc, "eventScripts/E60_alchemy_furnace.ts"), "utf-8");
check("锻造脚本打开面板(mode=forge)", forgeScript.includes('openShopPanel({ mode: "forge", tab: "sell" })'));
check("炼丹脚本打开面板(mode=alchemy)", alchemyScript.includes('openShopPanel({ mode: "alchemy", tab: "sell" })'));

/* 6. entry.ts / mockHost 数据接入 */
console.log("\n=== 数据接入 ===");
const entry = readFileSync(join(pluginRoot, "entry.ts"), "utf-8");
check("entry import FORGE_GOODS", entry.includes('from "./src/shop/forgeGoods"'));
check("entry import ALCHEMY_GOODS", entry.includes('from "./src/shop/alchemyGoods"'));
check("state 有 forgeGoods 字段", entry.includes("forgeGoods?: ShopGood[]"));
check("start 时写入 forgeGoods", entry.includes("s.forgeGoods = FORGE_SHOP_GOODS"));
check("sys_shop_buy 查 forge 表", entry.includes("ALCHEMY_SHOP_GOODS.find"));
const mock = readFileSync(join(vueSrc, "mockHost.ts"), "utf-8");
check("mockHost 三源查找商品", mock.includes("forgeGoods || []).find"));
check("mockHost 写入完整商品", mock.includes("forgeGoods: FORGE_GOODS"));

/* 7. ctx.ui.openShopPanel API */
console.log("\n=== 引擎 API ===");
const ctxTs = readFileSync(join(vueSrc, "eventScripts/_ctx.ts"), "utf-8");
check("Ctx 有 openShopPanel", ctxTs.includes("openShopPanel(opts:"));
const engine = readFileSync(join(vueSrc, "eventEngine.ts"), "utf-8");
check("EventHooks 有 openShopPanel", engine.includes("openShopPanel?(opts:"));
check("makeCtx 实现 openShopPanel", engine.includes("hooks?.openShopPanel?.(opts)"));
check("App 注册 openShopPanel hook", app.includes('openShopPanel: (opts) => openForgeAlchemyPanel'));

/* 8. ★ 结果弹窗（购买/打造/升级/溶解成功） */
console.log("\n=== 结果弹窗 ===");
check("App 有结果弹窗 evNotice", app.includes("const evNotice = ref<"));
check("App 有 evNoticeOpen / evNoticeClose", app.includes("function evNoticeOpen(") && app.includes("function evNoticeClose("));
check("模板渲染 evNotice 弹窗", app.includes('class="ev-confirm ev-notice"'));
check("结果弹窗样式 .ev-notice", app.includes(".ev-notice__detail"));
check("购买成功弹窗", app.includes("✅ 购买成功"));
check("购买金钱不足弹窗", app.includes("💰 金钱不足"));
check("购买失败弹窗", app.includes("❌ 购买失败"));
check("deps 注入 notice", app.includes("notice: (opts) => evNoticeOpen(opts)"));
check("deps 注入 money", app.includes("money: () => sysGold.value"));
check("cmd 等后端回执 sendSysCmdAwait", app.includes("function sendSysCmdAwait(") && app.includes("cmd: (action, params) => sendSysCmdAwait("));

const forgeOpsSrc = readFileSync(join(vueSrc, "forgeOps.ts"), "utf-8");
check("forgeOps 有 notice 依赖", forgeOpsSrc.includes("notice(opts: { title: string; detail?: string; okText?: string })"));
check("锻造成功弹窗", forgeOpsSrc.includes("🔨 锻造成功"));
check("炼丹成功弹窗", forgeOpsSrc.includes("🔥 炼丹成功"));
check("升级成功弹窗", forgeOpsSrc.includes("⬆ 升级成功"));
check("溶解完成弹窗", forgeOpsSrc.includes("⚒ 溶解完成"));
check("打造失败弹窗", forgeOpsSrc.includes("❌ 锻造失败"));

/* 9. ★ 图纸打造：产出图纸记载的成品，并消耗图纸 */
console.log("\n=== 图纸打造 ===");
const common = readFileSync(join(vueSrc, "eventScripts/forgeCommon.ts"), "utf-8");
check("forgeCommon 有 blueprintProduct", common.includes("export function blueprintProduct("));
check("forgeCommon 有 looksLikeBlueprint", common.includes("export function looksLikeBlueprint("));
check("forgeOps 用 blueprintProduct 解析产物", forgeOpsSrc.includes("input = blueprintProduct(picked)"));
// 图纸消耗只由后端做（前端再扣一次 = 双重扣除，实测 2 张图纸打一件归零）
check("图纸不在前端重复扣除", !forgeOpsSrc.includes("await deps.bagRemove(blueprint, 1)"));
check("blueprint 参数传给后端", forgeOpsSrc.includes("blueprint,") && forgeOpsSrc.includes("input,"));
check("提示词带图纸约束", common.includes("【按图纸制造】") && common.includes("【按药方炼制】"));
check("buildForgePrompt 支持 blueprint 参数", common.includes('typeHint = "", blueprint = ""'));
check("图纸筛选覆盖 总纲/编缀/锻造术", common.includes("总纲|编缀"));
check("后端有 blueprintProductName", entry.includes("function blueprintProductName("));
check("后端有 looksLikeBlueprintName", entry.includes("function looksLikeBlueprintName("));
check("后端 forge_create 消耗图纸", entry.includes("if (fBlueprint) removeFromPlayerBag(s, fBlueprint, 1)"));
check("后端 alchemy_create 消耗药方", entry.includes("if (aBlueprint) removeFromPlayerBag(s, aBlueprint, 1)"));
check("后端拦截产物=图纸", entry.includes("if (looksLikeBlueprintName(fItem.name))") && entry.includes("if (looksLikeBlueprintName(aPill.name))"));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);