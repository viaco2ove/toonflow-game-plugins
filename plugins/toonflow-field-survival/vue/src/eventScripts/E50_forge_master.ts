/**
 * E50_forge_master — 锻造大师交互
 * =====================================
 * 「走进锻造大师，弹出"锻造"按钮，点击进入 多标签页"锻造"面板」
 *
 * 面板（ForgeAlchemyPanel.vue）4 个标签：
 *   ① 物品售卖 — 展示 物品售卖.list.md 的 149 种商品，可直接购买
 *   ② 物品打造 — 输入名称 / 随机 / 选图纸 → AI 生成 → 扣 10 金钱
 *   ③ 升级物品 — 选已有装备 → AI 生成升级后属性 → 扣材料+金钱
 *   ④ 溶解物品 — 选已有装备 → 按品质算法返还材料
 *
 * ★ 本脚本只做一件事：打开多标签面板。
 *   面板内各标签的逻辑在 vue/src/forgeOps.ts（前端侧实现，
 *   可直接调 ctx.cmd / ctx.bag / ctx.ai）。
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  // ★ 打开多标签「锻造」面板（售卖 / 打造 / 升级 / 溶解）
  ctx.ui.openShopPanel({ mode: "forge", tab: "sell" });
  ctx.ui.event("打开锻造面板");
}
