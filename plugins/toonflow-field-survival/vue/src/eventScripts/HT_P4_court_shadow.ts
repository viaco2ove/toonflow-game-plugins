/**
 * HT_P4_court_shadow — 黑塔 · phase_4「网球场·不该存在的阴影」
 * ================================================================
 * 网球场中央：黄昏的影子拉得太长，长到不属于这个太阳。
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  if (!(await ctx.save.getFlag("has_ball"))) {
    ctx.ui.toast("你还没拿到那颗球。先去问问小满。", "blue");
    return;
  }
  await ctx.save.setFlag("phase_4_active", true);

  ctx.ui.subtitle("网球场 · 黄昏", 2400);
  ctx.ui.toast("球网的影子被拉长了。长到不像这个太阳能投出来的。", "white");
  ctx.ui.event("【phase 4】不该存在的阴影");

  setTimeout(() => {
    ctx.ui.toast("你手里的球开始发烫。影子那头有人站着——你看不见脸。", "red");
  }, 2400);

  setTimeout(() => {
    ctx.ui.toast("那东西开口了，用你同桌的声音说：‘接球啊。’", "gold");
    ctx.ui.event("【phase 4】影子开口");
    ctx.save.setFlag("phase_4_done", true);
    ctx.ui.toast("任务指引：去天台。有人在那里等你。", "blue");
  }, 5000);
}
