/**
 * E03_xuanchen_bainian — phase_1 节拍2「讨个说法」→ 拜师礼成
 * ============================================================
 * 玩家持《扫地神功》与玄尘长老（uid=225）对话：
 *   玄尘善后 → 正式接任宗主 → phase_1 收尾
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("sect_join", true);
  await ctx.save.setFlag("master", "陆川");
  await ctx.save.setFlag("phase_1_done", true);
  await ctx.save.delFlag("phase_1_active");

  // 玄尘善后
  ctx.ui.toast("玄尘长老：「掌门，祖师堂的落叶……您都扫出神功来了。」", "white");
  setTimeout(() => {
    ctx.ui.toast("玄尘长老：「罢了罢了，老朽去替您圆个场。」", "white");
  }, 1000);

  // 拜师礼成
  setTimeout(() => {
    ctx.ui.subtitle("拜师礼成 · 陆川接任大罗宗宗主", 2600);
    ctx.ui.event("phase_1 完成：系统绑定 + 拜师");
  }, 2200);

  setTimeout(() => {
    ctx.ui.toast("【收徒系统】已激活。今日宜收徒。", "gold");
    ctx.ui.toast("山门已开——青云竹海历练已解锁。", "blue");
    ctx.ui.event("解锁：青云竹海（山门牌坊）");
  }, 3600);
}