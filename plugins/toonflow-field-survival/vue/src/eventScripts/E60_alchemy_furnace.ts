/**
 * E60_alchemy_furnace — 炼丹炉交互
 * =====================================
 * 「走进炼丹炉，弹出"炼丹"按钮，点击进入 多标签页"炼丹"面板」
 *
 * 面板（ForgeAlchemyPanel.vue）3 个标签：
 *   ① 物品售卖 — 展示 data/shop.alchemy.json 的商品，可直接购买
 *   ② 开始炼丹 — 输入名称 / 随机 / 选药方 → AI 生成 → 扣 10 金钱
 *   ③ 溶解丹药 — 选已有丹药 → 按恢复量返还药材
 *
 * ★ 商品清单属于本地图集的数据（data/shop.alchemy.json，由
 *   vue/scripts/gen-shop-goods.mjs 从设计文档生成），插件本体不存任何商品。
 */
import type { Ctx, ShopGood } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  // ★ 读本地图集的货单（路径相对故事根目录）
  const raw = await ctx.story.readJson<{ goods?: ShopGood[] } | ShopGood[]>("data/shop.alchemy.json");
  const goods: ShopGood[] = Array.isArray(raw) ? raw : Array.isArray(raw?.goods) ? raw.goods : [];
  if (!goods.length) {
    ctx.ui.toast("炼丹炉的货架空了：故事包缺少 data/shop.alchemy.json", "red");
  }
  // ★ 打开多标签「炼丹」面板（售卖 / 炼丹 / 溶解）
  ctx.ui.openShopPanel({ mode: "alchemy", tab: "sell", goods });
  ctx.ui.event(`打开炼丹面板（${goods.length} 件商品）`);
}
