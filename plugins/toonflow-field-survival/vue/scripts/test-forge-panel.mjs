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

/* 1. 商品数据文件（★ 属于地图集的故事包，插件本体不许存） */
console.log("\n=== 商品数据（地图集故事包 data/shop.*.json） ===");
const storyDataDir = join(repoRoot, "workshops/toonflow-field-survival/map_design/通天传授-收徒系统/data");
const forgeJsonPath = join(storyDataDir, "shop.forge.json");
const alchemyJsonPath = join(storyDataDir, "shop.alchemy.json");
check("锻造货单在故事包 data/shop.forge.json", existsSync(forgeJsonPath));
check("炼丹货单在故事包 data/shop.alchemy.json", existsSync(alchemyJsonPath));
const forgeJson = existsSync(forgeJsonPath) ? JSON.parse(readFileSync(forgeJsonPath, "utf-8")) : { goods: [] };
const alchemyJson = existsSync(alchemyJsonPath) ? JSON.parse(readFileSync(alchemyJsonPath, "utf-8")) : { goods: [] };
const forgeGoodsArr = Array.isArray(forgeJson) ? forgeJson : forgeJson.goods || [];
const alchemyGoodsArr = Array.isArray(alchemyJson) ? alchemyJson : alchemyJson.goods || [];
check("锻造商品 ≥140 种（文档 149）", forgeGoodsArr.length >= 140, String(forgeGoodsArr.length));
check("炼丹商品 ≥160 种（文档 163）", alchemyGoodsArr.length >= 160, String(alchemyGoodsArr.length));
// ★ 售卖子标签页：cat 分类字段
check("锻造商品全部带 cat 分类", forgeGoodsArr.every((g) => !!g.cat), `${forgeGoodsArr.filter((g) => !g.cat).length} 件缺 cat`);
check("炼丹商品全部带 cat 分类", alchemyGoodsArr.every((g) => !!g.cat), `${alchemyGoodsArr.filter((g) => !g.cat).length} 件缺 cat`);
const forgeCats = new Set(forgeGoodsArr.map((g) => g.cat));
const alchemyCats = new Set(alchemyGoodsArr.map((g) => g.cat));
check("锻造 7 分类齐全（材料/武器/防具/饰品/图纸/技能/特殊）",
  ["材料", "武器", "防具", "饰品", "图纸", "技能", "特殊"].every((c) => forgeCats.has(c)), [...forgeCats].join("/"));
check("炼丹 7 分类齐全（药草/辅料/材料/丹药/药方/器具/套装）",
  ["药草", "辅料", "材料", "丹药", "药方", "器具", "套装"].every((c) => alchemyCats.has(c)), [...alchemyCats].join("/"));
check("锻造 from=forge_master", forgeGoodsArr.every((g) => g.from === "forge_master"));
check("炼丹 from=alchemy_furnace", alchemyGoodsArr.every((g) => g.from === "alchemy_furnace"));
check("含铁剑（锻造代表）", forgeGoodsArr.some((g) => g.name.includes("铁剑")));
check("含天问剑（legend 品）", forgeGoodsArr.some((g) => g.name.includes("天问剑")));
check("含人参（炼丹代表）", alchemyGoodsArr.some((g) => g.name.includes("人参")));
check("含不死药（legend 品）", alchemyGoodsArr.some((g) => g.name.includes("不死药")));
check("生成脚本存在", existsSync(join(pluginRoot, "vue/scripts/gen-shop-goods.mjs")));
// ★ 违规回归：插件本体不许再出现商品数据文件
check("插件内无 src/shop/ 商品数据", !existsSync(join(pluginRoot, "src/shop/forgeGoods.ts")) && !existsSync(join(pluginRoot, "src/shop/alchemyGoods.ts")));

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

/* 5. 事件脚本（读故事包货单 + 打开面板） */
console.log("\n=== 事件脚本 ===");
const forgeScript = readFileSync(join(vueSrc, "eventScripts/E50_forge_master.ts"), "utf-8");
const alchemyScript = readFileSync(join(vueSrc, "eventScripts/E60_alchemy_furnace.ts"), "utf-8");
check("锻造脚本读 data/shop.forge.json", forgeScript.includes('readJson<') && forgeScript.includes('"data/shop.forge.json"'));
check("炼丹脚本读 data/shop.alchemy.json", alchemyScript.includes('readJson<') && alchemyScript.includes('"data/shop.alchemy.json"'));
check("锻造脚本打开面板(mode=forge)并带货单", forgeScript.includes('mode: "forge"') && forgeScript.includes("goods"));
check("炼丹脚本打开面板(mode=alchemy)并带货单", alchemyScript.includes('mode: "alchemy"') && alchemyScript.includes("goods"));

/* 6. entry.ts / mockHost 数据接入（★ 插件侧不留商品数据） */
console.log("\n=== 数据接入 ===");
const entry = readFileSync(join(pluginRoot, "entry.ts"), "utf-8");
check("entry 不再 import 商品数据", !entry.includes("./src/shop/forgeGoods") && !entry.includes("./src/shop/alchemyGoods"));
check("entry 不再有 forgeGoods 状态字段", !entry.includes("forgeGoods?: ShopGood[]"));
check("entry 不再无条件覆盖货单", !entry.includes("s.forgeGoods = FORGE_SHOP_GOODS"));
check("sys_shop_buy 接受前端回传的 good", entry.includes("normalizeShopGoodParam(params?.good)"));
check("normalizeShopGoodParam 校验价格为正", entry.includes("function normalizeShopGoodParam") && entry.includes("!(price > 0)"));
const mock = readFileSync(join(vueSrc, "mockHost.ts"), "utf-8");
check("mockHost 不再 import 商品数据", !mock.includes('from "../../src/shop/'));
check("mockHost 购买走 params.good 回传", mock.includes("params?.good && typeof params.good"));

/* 7. ctx.ui.openShopPanel / ctx.story.readJson API */
console.log("\n=== 引擎 API ===");
const ctxTs = readFileSync(join(vueSrc, "eventScripts/_ctx.ts"), "utf-8");
check("Ctx 有 openShopPanel", ctxTs.includes("openShopPanel(opts:"));
check("openShopPanel 支持 goods", ctxTs.includes("goods?: ShopGood[]"));
check("Ctx 有 story.readJson", ctxTs.includes("readJson<T = unknown>(path: string)"));
const engine = readFileSync(join(vueSrc, "eventEngine.ts"), "utf-8");
check("EventHooks 有 openShopPanel", engine.includes("openShopPanel?(opts:"));
check("EventHooks 有 readStoryJson", engine.includes("readStoryJson?(path: string)"));
check("makeCtx 实现 openShopPanel", engine.includes("hooks?.openShopPanel?.(opts)"));
check("makeCtx 实现 story.readJson", engine.includes("hooks.readStoryJson(path)"));
check("App 注册 openShopPanel hook", app.includes('openShopPanel: (opts) => openForgeAlchemyPanel'));
check("App 注册 readStoryJson hook", app.includes("readStoryJson: (path: string) => readStoryJson(path)"));
check("storyMap 提供 readStoryJson（.tbg + /story-data 双通道）",
  readFileSync(join(vueSrc, "storyMap.ts"), "utf-8").includes("export async function readStoryJson"));

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

/* 10. ★ 面板关闭按钮可点（setPointerCapture 吞掉 click 的坑） */
console.log("\n=== 面板关闭按钮 ===");
check("锻造面板有 close 按钮", app.includes('class="forge-panel__close"'));
check("close 按钮绑定 closeForgeAlchemyPanel", app.includes("@click=\"closeForgeAlchemyPanel\""));
// ★ 根因：header 上有 @pointerdown 拖拽 + setPointerCapture，
//   会把 pointerup 重定向到 header → 浏览器不在按钮上合成 click → 点关闭毫无反应。
//   修法：按钮上加 @pointerdown.stop，并且拖拽启动时排除可交互元素。
const closeBtnMatch = app.match(/<button[^>]*class="forge-panel__close"[\s\S]*?>/);
check("close 按钮带 @pointerdown.stop", !!closeBtnMatch && closeBtnMatch[0].includes("@pointerdown.stop"));
check("拖拽启动排除可交互元素（isInteractiveTarget 用 closest 判定）",
  app.includes("function isInteractiveTarget(") && app.includes('el.closest("button, a, input, select, textarea")'));
check("有共享 isInteractiveTarget 守卫", app.includes("function isInteractiveTarget(") && app.includes("if (isInteractiveTarget(e.target)) return;"));
check("三个拖拽启动都用了守卫",
  app.includes("function onSysBtnDragStart") &&
  /function onSysBtnDragStart[\s\S]{0,200}isInteractiveTarget/.test(app) &&
  /function onSysPanelDragStart[\s\S]{0,260}isInteractiveTarget/.test(app) &&
  /function onForgePanelDragStart[\s\S]{0,300}isInteractiveTarget/.test(app));
// ★ 同一个坑在 SystemPanel 也存在（.sp-head 拖拽 + sp-close 按钮）→ 同步修
const sysPanelSrc = readFileSync(join(vueSrc, "SystemPanel.vue"), "utf-8");
const spCloseMatch = sysPanelSrc.match(/<button[^>]*class="sp-close"[\s\S]*?>/);
check("系统面板 sp-close 带 @pointerdown.stop", !!spCloseMatch && spCloseMatch[0].includes("@pointerdown.stop"));
check("系统面板 sp-head 有拖拽（坑的前提）", sysPanelSrc.includes('class="sp-head" @pointerdown="emit(\'drag-start\', $event)"'));
// 面板根有 @pointerdown.stop（防止拖拽面板时点到游戏层）
check("面板根有 @pointerdown.stop", /class="forge-panel"[\s\S]{0,200}@pointerdown\.stop/.test(app));
// 关闭后不应被 runForgeOp 的 finally 立刻重开（重开逻辑只在操作入口路径）
check("closeForgeAlchemyPanel 只置 false", /function closeForgeAlchemyPanel\(\): void \{\s*forgePanelOpen\.value = false;\s*\}/.test(app));
// 对照：聊天/任务板面板的 header 没有拖拽 → 它们的 ✕ 一直是好的
check("聊天面板 header 无拖拽（对照）", app.includes("class=\"chat-panel__header\"") && !/class="chat-panel__header"[^>]*@pointerdown/.test(app));
check("任务板 header 无拖拽（对照）", app.includes("class=\"quest-panel__header\"") && !/class="quest-panel__header"[^>]*@pointerdown/.test(app));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);