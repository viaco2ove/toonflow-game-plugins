/**
 * E02_broom_pickup — phase_1 节拍1「扫帚与石阶」
 * =================================================
 * 玩家在祖师堂 interact 扫帚物件（uid=271）：
 *   拾起《扫地神功》玉简 → 系统提示 → 解锁 E03 玄尘长老对话
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("broom_picked", true);

  ctx.ui.toast("你弯腰拾起那把秃了大半的扫帚。", "white");
  setTimeout(() => {
    ctx.ui.subtitle("《扫地神功》· 残篇", 2200);
    ctx.ui.toast("扫帚柄里滑出一枚磨旧的玉简——《扫地神功》残篇。", "white");
  }, 600);

  setTimeout(() => {
    ctx.ui.toast("【收徒系统】检测到宿主接过扫地神功。", "gold");
    ctx.ui.toast("【收徒系统】绑定完成。系统认定：宿主=师父。", "gold");
    ctx.ui.event("《扫地神功》已拾取，系统绑定完成");
  }, 1800);

  setTimeout(() => {
    ctx.ui.toast("玄尘长老在祖师堂前等你——去讨个说法。", "blue");
    ctx.ui.event("任务指引：与祖师堂前的玄尘长老对话");
  }, 3200);
}