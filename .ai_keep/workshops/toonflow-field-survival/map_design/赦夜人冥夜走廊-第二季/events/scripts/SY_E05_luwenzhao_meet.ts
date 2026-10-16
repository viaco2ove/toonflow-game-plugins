/**
 * SY_E05_luwenzhao_meet — phase_1 节拍「暮光者」：初见陆文昭
 * ==========================================================
 * interact uid=300 触发（前置 flag rumor_twilight）
 * 对应故事节拍：「暮光者 → 残忍」
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("met_luwenzhao", true);

  ctx.ui.subtitle("暮光教会 · 执事 陆文昭", 2600);
  ctx.ui.toast("白袍的人转过身：夜里采药的人，都在找同一种东西。", "gold");

  setTimeout(() => {
    ctx.ui.toast("陆文昭：血也是一种药——只是配方写歪了。", "gold");
    ctx.ui.event("初见暮光教会执事 陆文昭");
  }, 1600);

  setTimeout(() => {
    ctx.ui.toast("他往镇西空屋的方向去了，石板上留着一道没干的痕。", "red");
    ctx.ui.event("任务指引：前往暮光布道点");
  }, 3200);
}
