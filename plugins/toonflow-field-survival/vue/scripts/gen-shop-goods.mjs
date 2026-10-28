/**
 * 从设计文档的 markdown 表格生成 ShopGood 数据文件
 * 运行：node scripts/gen-shop-goods.mjs
 *
 * 输入：
 *   workshops/.../events/实体交互/物品售卖.list.md        → 锻造大师 142 种
 *   workshops/.../events/实体交互/物品售卖.炼丹.list.md    → 炼丹炉 163 种
 * 输出：
 *   plugins/toonflow-field-survival/src/shop/forgeGoods.ts
 *   plugins/toonflow-field-survival/src/shop/alchemyGoods.ts
 *
 * ★ v2：每个商品附带 cat（售卖子标签页分类），由文档「##/### 章节标题」推导
 *   锻造：材料/武器/防具/饰品/图纸/技能/特殊
 *   炼丹：药草/辅料/材料/丹药/药方/器具/套装
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const docDir = join(repoRoot, "workshops/toonflow-field-survival/map_design_pre/通天传授-收徒系统/events/实体交互");
const outDir = join(repoRoot, "plugins/toonflow-field-survival/src/shop");

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

/** 生成 TS 文件 */
function genTs(goods, constName, title, alchemySuffix) {
  const lines = [];
  lines.push(`/**`);
  lines.push(` * ★ ${title}商品清单（自动生成，勿手改）`);
  lines.push(` *   来源：workshops/.../events/实体交互/物品售卖${alchemySuffix}.list.md`);
  lines.push(` *   重新生成：node scripts/gen-shop-goods.mjs`);
  lines.push(` */`);
  lines.push(`export interface ShopGood {`);
  lines.push(`  id: string;`);
  lines.push(`  name: string;`);
  lines.push(`  price: number;`);
  lines.push(`  kind: "consumable" | "material" | "equipment" | "skill_book" | "quest";`);
  lines.push(`  rarity: "common" | "fine" | "rare" | "epic" | "legend";`);
  lines.push(`  heal: number;`);
  lines.push(`  desc: string;`);
  lines.push(`  from: string;`);
  lines.push(`  /** 售卖子标签页分类（由文档章节标题推导） */`);
  lines.push(`  cat: string;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const ${constName}: ShopGood[] = [`);
  for (const g of goods) {
    const desc = g.desc.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(`  { id: "${g.id}", name: "${g.name}", price: ${g.price}, kind: "${g.kind}", rarity: "${g.rarity}", heal: ${g.heal}, desc: "${desc}", from: "${g.from}", cat: "${g.cat}" },`);
  }
  lines.push(`];`);
  lines.push(``);
  return lines.join("\n");
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "forgeGoods.ts"), genTs(forge, "FORGE_GOODS", "锻造大师", ""), "utf-8");
writeFileSync(join(outDir, "alchemyGoods.ts"), genTs(alchemy, "ALCHEMY_GOODS", "炼丹炉", ".炼丹"), "utf-8");
console.log(`\n已生成:\n  ${join(outDir, "forgeGoods.ts")}\n  ${join(outDir, "alchemyGoods.ts")}`);
