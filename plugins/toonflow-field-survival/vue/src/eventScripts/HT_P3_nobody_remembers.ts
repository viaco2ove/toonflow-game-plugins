/**
 * HT_P3_nobody_remembers — 黑塔 · phase_3「走廊·无人记得的少年」
 * ================================================================
 * 小满（收容物引路化身）首次接触：她只在「被遗忘者」附近出现。
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("met_xiaoman", true);

  ctx.ui.subtitle("走廊尽头 · 抱着网球的女孩", 2600);
  ctx.ui.toast("小满：‘你记得他，对吧？这里只有你会记得。’", "gold");
  ctx.ui.event("【phase 3】小满：这里只有你记得");

  setTimeout(() => {
    ctx.ui.toast("小满：‘他没被吃掉。他只是被所有人忘掉了。这两件事不一样。’", "gold");
  }, 2600);

  setTimeout(() => {
    ctx.ui.toast("小满把球递给你：‘拿着。别弄丢。’", "blue");
    ctx.ui.event("获得：神秘网球（收容物）");
    ctx.save.setFlag("has_ball", true);
    ctx.save.setFlag("phase_3_done", true);
  }, 5200);
}
