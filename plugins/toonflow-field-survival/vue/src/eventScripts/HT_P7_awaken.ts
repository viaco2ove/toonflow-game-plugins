/**
 * HT_P7_awaken — 黑塔 · phase_7「觉醒·第二序列·农民」
 * ================================================================
 * 黑塔一层门厅：第二序列是"农民"——最难觉醒的一档，但活得最久。
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("phase_7_active", true);

  ctx.ui.subtitle("黑塔 · 一层 · 门厅", 2600);
  ctx.ui.toast("整面墙都是名字。有的还在，有的正在变淡。", "white");
  ctx.ui.event("【phase 7】塔的名册墙");

  setTimeout(() => {
    ctx.ui.toast("登记台上刻着一行字：‘第二序列·农民。觉醒最难，寿命最长。’", "gold");
    ctx.ui.toast("张晚意：‘所以它们盯上你。农民序列的塔，最喜欢收。’", "gold");
  }, 2800);

  setTimeout(() => {
    ctx.ui.toast("你的名字卡开始发烫。你看见了——塔在找的东西，你身上正好有。", "red");
    ctx.ui.event("【phase 7】觉醒：第二序列·农民");
    ctx.save.setFlag("phase_7_done", true);
    ctx.ui.toast("任务指引：往二层走，把名字写回去。", "blue");
  }, 6000);
}