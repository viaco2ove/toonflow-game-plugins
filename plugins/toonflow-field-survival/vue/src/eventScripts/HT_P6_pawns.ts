/**
 * HT_P6_pawns — 黑塔 · phase_6「深夜教室·伪人的爪牙」
 * ================================================================
 * 记忆回廊·早自习：第 N 次早上七点二十。这一次，你带着球。
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  if (!(await ctx.save.getFlag("has_empty_card"))) {
    ctx.ui.toast("你还进不去这里。先把名字写在卡上。", "blue");
    return;
  }
  await ctx.save.setFlag("phase_6_active", true);

  ctx.ui.subtitle("记忆回廊 · 早自习", 2400);
  ctx.ui.toast("铃响了三遍。所有座位都满了，只有那个位置还是空的。", "white");
  ctx.ui.event("【phase 6】第 N 次早自习");

  setTimeout(() => {
    ctx.ui.toast("走廊尽头传来低语。它们在互相叫错名字——像在排练。", "red");
    ctx.ui.toast("任务指引：清掉八只爪牙。", "blue");
  }, 2600);

  setTimeout(() => {
    ctx.ui.save.setFlag("phase_6_done", true);
  }, 5200);
}
