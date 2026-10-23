/**
 * HT_P1_morning — 黑塔 · phase_1「清晨·闹钟与一个名字」
 * ================================================================
 * 起始图（陈曦的卧室）enter_map 触发：闹钟 → 妈妈的早餐 → 留下第一个谜题
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("phase_1_active", true);

  ctx.ui.subtitle("清晨 · 闹钟响了", 2400);

  setTimeout(() => {
    ctx.ui.toast("七点二十。你从上铺翻下来，数学卷子还摊在书桌上。", "white");
    ctx.ui.event("【phase 1】闹钟响了");
  }, 1200);

  setTimeout(() => {
    ctx.ui.toast("妈妈在厨房：‘早餐给你双份了——对了，你那个同桌，今天不来吗？’", "gold");
    ctx.ui.event("【phase 1】妈妈的双份早餐");
  }, 3200);

  setTimeout(() => {
    ctx.ui.toast("你想不起来她说的是谁。", "red");
    ctx.ui.event("【phase 1】记忆的裂缝");
    ctx.save.setFlag("phase_1_done", true);
  }, 5600);
}
