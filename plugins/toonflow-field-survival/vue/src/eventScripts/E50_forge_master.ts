/**
 * E50_forge_master — 锻造大师交互
 * =====================================
 * 「走进锻造大师，弹出"锻造"按钮，点击进入 多标签页"锻造"面板」
 *
 * 面板（ForgeAlchemyPanel.vue）4 个标签：
 *   ① 物品售卖 — 展示 data/shop.forge.json 的商品，可直接购买
 *   ② 物品打造 — 输入名称 / 随机 / 选图纸 → AI 生成 → 扣 10 金钱
 *   ③ 升级物品 — 选已有装备 → AI 生成升级后属性 → 扣材料+金钱
 *   ④ 溶解物品 — 选已有装备 → 按品质算法返还材料
 *
 * ★ 商品清单属于本地图集的数据（data/shop.forge.json，由
 *   vue/scripts/gen-shop-goods.mjs 从设计文档生成），插件本体不存任何商品。
 *   改货单 = 改故事包 JSON + 重打包，不需要动插件。
 *
 * ★ 面板内各标签的操作逻辑在插件侧 forgeOps.ts（通用能力，按 mode 区分锻造/炼丹）。
 */
import type { Ctx, ShopGood } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  // ★ 读本地图集的货单（路径相对故事根目录，安装后从 .tbg 内读，dev 走 /story-data）
  const raw = await ctx.story.readJson<{ goods?: ShopGood[] } | ShopGood[]>("data/shop.forge.json");
  const goods: ShopGood[] = Array.isArray(raw) ? raw : Array.isArray(raw?.goods) ? raw.goods : [];
  if (!goods.length) {
    // 缺数据时明确告知（不要静默给一个空货架，也别去插件里找兜底）
    ctx.ui.toast("锻造大师的货架空了：故事包缺少 data/shop.forge.json", "red");
  }
  // ★ 打开多标签「锻造」面板（售卖 / 打造 / 升级 / 溶解）
  ctx.ui.openShopPanel({ mode: "forge", tab: "sell", goods });
  ctx.ui.event(`打开锻造面板（${goods.length} 件商品）`);
}
