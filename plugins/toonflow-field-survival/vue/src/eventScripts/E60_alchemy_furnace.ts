/**
 * E60_alchemy_furnace — 炼丹炉交互
 * =====================================
 * 「走进炼丹炉，弹出"炼丹"按钮，点击进入 多标签页"炼丹"面板」
 *
 * 面板（ForgeAlchemyPanel.vue）3 个标签：
 *   ① 物品售卖 — 展示 物品售卖.炼丹.list.md 的 163 种商品，可直接购买
 *   ② 开始炼丹 — 输入名称 / 随机 / 选药方 → AI 生成 → 扣 10 金钱
 *   ③ 溶解丹药 — 选已有丹药 → 按恢复量返还药材
 *
 * ★ 本脚本只做一件事：打开多标签面板。
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  // ★ 打开多标签「炼丹」面板（售卖 / 炼丹 / 溶解）
  ctx.ui.openShopPanel({ mode: "alchemy", tab: "sell" });
  ctx.ui.event("打开炼丹面板");
}