/**
 * SY_E01_night_open — 赦夜人冥夜走廊-第二季 · phase_1「黑夜」开局
 * ================================================================
 * enter_map 触发：播旁白 → 系统提示 → 指引夜采
 * 对应故事节拍：「夜采 → 用户发言」
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("phase_1_active", true);

  ctx.ui.subtitle("桑镇 · 夜", 2200);
  ctx.ui.toast("夜色压在桑镇的屋檐上。药铺的灯还亮着。", "white");

  setTimeout(() => {
    ctx.ui.toast("你——陈彦，提着空药篓站在街口。", "gold");
    ctx.ui.event("【黑夜】开场：夜采");
  }, 1400);

  setTimeout(() => {
    ctx.ui.toast("任务指引：去西边的夜采药圃，趁露水未干。", "blue");
    ctx.ui.event("任务指引：前往夜采药圃");
  }, 3000);
}
