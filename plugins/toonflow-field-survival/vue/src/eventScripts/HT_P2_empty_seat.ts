/**
 * HT_P2_empty_seat — 黑塔 · phase_2「教室·空着的座位」
 * ================================================================
 * 延城一中 enter_map：全班都到齐了，只有那个位置是空的——而且每天都空。
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("phase_2_active", true);
  if (await ctx.save.getFlag("phase_1_done")) {
    ctx.ui.subtitle("延城一中 · 早读", 2400);
    setTimeout(() => {
      ctx.ui.toast("所有人都在读书。翻页声整齐得像一个人发出的。", "white");
    }, 1200);
    setTimeout(() => {
      ctx.ui.toast("只有第三排靠窗那个位置是空的。老师说：「那个位置一直是空的。」", "red");
      ctx.ui.event("【phase 2】空着的座位");
      ctx.ui.toast("任务指引：去找班长苏晓问清楚。", "blue");
      ctx.save.setFlag("phase_2_done", true);
    }, 3400);
  }
}
