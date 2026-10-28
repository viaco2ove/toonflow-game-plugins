/**
 * 从设计文档的 markdown 表格生成「地图集自带」的商品数据文件
 * 运行：node scripts/gen-shop-goods.mjs
 *
 * 输入：
 *   workshops/.../map_design_pre/通天传授-收徒系统/events/实体交互/物品售卖.list.md      → 锻造大师 149 种
 *   workshops/.../map_design_pre/通天传授-收徒系统/events/实体交互/物品售卖.炼丹.list.md  → 炼丹炉 163 种
 * 输出（★ 落在故事目录里，插件本体不存任何商品数据）：
 *   workshops/.../map_design/通天传授-收徒系统/data/shop.forge.json
 *   workshops/.../map_design/通天传授-收徒系统/data/shop.alchemy.json
 *
 * 为什么输出到故事目录：见 md/curr_design/toonflow-field-survival/maps_help/规范.md
 * 「严重违规事项」——商品清单是「通天传授-收徒系统」这张地图集的业务数据，
 * 必须随地图集走；插件只提供通用的「售卖面板 + 购买命令」能力。
 *
 * 运行时链路：
 *   故事包 data/shop.*.json
 *     → 事件脚本 ctx.story.readJson("data/shop.forge.json")
 *     → ctx.ui.openShopPanel({ mode, tab, goods })
 *     → 面板渲染 / sys_shop_buy 携带 good 落账
 *
 * ★ 每个商品附带 cat（售卖子标签页分类），由文档「##/### 章节标题」推导
 *   锻造：材料/武器/防具/饰品/图纸/技能/特殊
 *   炼丹：药草/辅料/材料/丹药/药方/器具/套装
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const STORY = "通天传授-收徒系统";
const docDir = join(repoRoot, `workshops/toonflow-field-survival/map_design_pre/${STORY}/events/实体交互`);
const outDir = join(repoRoot, `workshops/toonflow-field-survival/map_design/${STORY}/data`);

/** 章节标题 → 售卖子标签分类（关键词规则，顺序即优先级） */
function catFromTitle(rawTitle, isAlchemy) {
  const t = String(rawTitle || "").replace(/^第?[一二三四五六七八九十百]+[、．.]\s*/, "");
  // 「### 小节」（武器细分类：刀类/枪棍类/弓弩类/匕首拳套类）→ 归入武器
  if (/刀类|枪.{0,2}棍类|弓.{0,2}弩类|匕首.{0,2}拳套类/.test(t)) return "武器";
  if (/丹方|药方|图纸|配方/.test(t)) return isAlchemy ? "药方" : "图纸";
  if (/套装|礼盒/.test(t)) return "套装";
  if (/丹药|回血|回蓝|回气|增益|解毒/.test(t)) return "丹药";
  if (/器具/.test(t)) return "器具";
  if (/武器/.test(t)) return "武器";
  if (/防具|衣服/.test(t)) return "防具";
  if (/饰品/.test(t)) return "饰品";
  if (/技能/.test(t)) return "技能";
  if (/特殊/.test(t)) return "特殊";
  if (/草药|药草/.test(t)) return "药草";
  if (/辅料/.test(t)) return "辅料";
  if (/材料|矿石|木材|皮革|妖兽|布料/.test(t)) return "材料";
  return "其他";
}

/** 解析 markdown 表格 → 商品数组（带章节分类 cat） */
function parseGoods(mdPath, from, isAlchemy) {
  const md = readFileSync(mdPath, "utf-8");
  const lines = md.split(/\r?\n/);
  const goods = [];
  const seen = new Set();
  const re = /^\|\s*([a-z][a-z0-9_]*)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([a-z_]+)\s*\|\s*([a-z]+)\s*\|\s*([^|]+?)\s*\|\s*$/;
  let section = ""; // 当前「## / ###」章节标题
  for (const line of lines) {
    const hm = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (hm) { section = hm[1]; continue; }
    const m = line.match(re);
    if (!m) continue;
    const [, id, name, price, kind, rarity, desc] = m;
    if (seen.has(id)) continue;
    seen.add(id);
    // 消耗品的 heal 从描述里解析（「恢复 20 点生命」→ 20）
    let heal = 0;
    if (kind === "consumable") {
      const h1 = desc.match(/恢复\s*(\d+)\s*点生命/);
      if (h1) heal = Number(h1[1]);
      else {
        const h2 = desc.match(/恢复\s*(\d+)\s*点(内力|灵力|耐力)/);
        if (h2) heal = Number(h2[1]);
      }
    }
    goods.push({
      id,
      name: name.trim(),
      price: Number(price),
      kind,
      rarity,
      heal,
      desc: desc.trim(),
      from,
      cat: catFromTitle(section, isAlchemy),
    });
  }
  return goods;
}

const forge = parseGoods(join(docDir, "物品售卖.list.md"), "forge_master", false);
const alchemy = parseGoods(join(docDir, "物品售卖.炼丹.list.md"), "alchemy_furnace", true);

console.log(`锻造商品: ${forge.length} 种（文档标称 142）`);
console.log(`炼丹商品: ${alchemy.length} 种（文档标称 163）`);

// 按类型/分类统计，找漏解析的
const tally = (arr, key) => arr.reduce((m, g) => ((m[g[key]] = (m[g[key]] || 0) + 1), m), {});
console.log("锻造按类型:", JSON.stringify(tally(forge, "kind")));
console.log("锻造按分类:", JSON.stringify(tally(forge, "cat")));
console.log("炼丹按类型:", JSON.stringify(tally(alchemy, "kind")));
console.log("炼丹按分类:", JSON.stringify(tally(alchemy, "cat")));
const otherForge = forge.filter((g) => g.cat === "其他").map((g) => g.id);
const otherAlchemy = alchemy.filter((g) => g.cat === "其他").map((g) => g.id);
if (otherForge.length) console.log("⚠ 锻造未归类:", otherForge.join(","));
if (otherAlchemy.length) console.log("⚠ 炼丹未归类:", otherAlchemy.join(","));

/**
 * 生成故事包内 JSON。
 * 顶层保留 version/from/source 元信息，goods 是真正的清单；
 * 读取方（ctx.story.readJson）同时兼容「纯数组」与「{goods:[...]}」两种形态。
 */
function genJson(goods, from, sourceName, title) {
  return JSON.stringify(
    {
      version: 1,
      title,
      from,
      source: `map_design_pre/${STORY}/events/实体交互/${sourceName}`,
      note: "自动生成，勿手改；改设计文档后重跑 vue/scripts/gen-shop-goods.mjs",
      goods,
    },
    null,
    2,
  ) + "\n";
}

mkdirSync(outDir, { recursive: true });
const forgePath = join(outDir, "shop.forge.json");
const alchemyPath = join(outDir, "shop.alchemy.json");
writeFileSync(forgePath, genJson(forge, "forge_master", "物品售卖.list.md", "锻造大师"), "utf-8");
writeFileSync(alchemyPath, genJson(alchemy, "alchemy_furnace", "物品售卖.炼丹.list.md", "炼丹炉"), "utf-8");
console.log(`\n已生成:\n  ${forgePath}\n  ${alchemyPath}`);
