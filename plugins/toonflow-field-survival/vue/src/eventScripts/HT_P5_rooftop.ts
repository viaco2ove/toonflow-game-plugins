/**
 * HT_P5_rooftop — 黑塔 · phase_5「天台·校花的秘密」
 * ================================================================
 * 张晚意（引路人）第一次现身：她知道黑塔，也知道你是谁。
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("met_zhangwanyi", true);

  ctx.ui.subtitle("天台 · 风很大", 2400);
  ctx.ui.toast("张晚意：‘你终于来了。我找了五个能不被塔吃掉的人，你是第六个。’", "gold");
  ctx.ui.event("【phase 5】张晚意现身");

  setTimeout(() => {
    ctx.ui.toast("张晚意：‘你的超忆症不是病。是钥匙。’", "gold");
  }, 2800);

  setTimeout(() => {
    ctx.ui.toast("张晚意递来一张空白卡：‘填上你的名字，你就能看见别人看不见的东西。’", "blue");
    ctx.ui.event("获得：空白身份卡");
    ctx.save.setFlag("has_empty_card", true);
    ctx.save.setFlag("phase_5_done", true);
  }, 5600);
}
