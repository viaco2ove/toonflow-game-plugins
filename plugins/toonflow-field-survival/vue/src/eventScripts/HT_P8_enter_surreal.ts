/**
 * HT_P8_enter_surreal — 黑塔 · phase_8「尾声·踏入超凡世界」
 * ================================================================
 * 塔心：一切开始的地方，也是可以走进去的地方。
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("phase_8_active", true);

  ctx.ui.subtitle("塔心", 2800);
  ctx.ui.toast("镜子里的那个人，动作比你慢半拍。它在学你。", "white");
  ctx.ui.event("【phase 8】塔心的镜子");

  setTimeout(() => {
    ctx.ui.toast("张晚意：‘你现在可以走了。往回走是延城，往前是界域。’", "gold");
  }, 2800);

  setTimeout(() => {
    ctx.ui.toast("张晚意：‘记住——被抹掉的人还在塔里。你能听见他们。’", "gold");
    ctx.ui.event("【phase 8】自由行动开启");
  }, 5600);

  setTimeout(() => {
    ctx.save.setFlag("phase_8_done", true);
    ctx.ui.toast("【尾声】超凡的门已经开了。剩下的路，你自己走。", "blue");
  }, 8400);
}