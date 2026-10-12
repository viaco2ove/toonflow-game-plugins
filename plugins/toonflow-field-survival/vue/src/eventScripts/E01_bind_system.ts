/**
 * E01_bind_system — phase_1 开局过场
 * =====================================
 * 进图后 1.2s 触发：显示【收徒系统】绑定提示 → 飘字 → 指引找扫帚
 * 对应故事节拍：「扫帚与石阶 → 系统绑定完成」
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("phase_1_active", true);

  // 开场字幕（1.2s 延迟由引擎 trigger 侧的节拍控制，这里只负责内容）
  ctx.ui.subtitle("大罗宗 · 山门", 2000);
  ctx.ui.toast("晨雾未散，石阶自山门蜿蜒而上。", "white");

  // 系统绑定过场
  setTimeout(() => {
    ctx.ui.subtitle("【收徒系统】已激活", 2600);
    ctx.ui.toast("识海深处，一道金色光字静静悬浮：", "gold");
  }, 1200);

  setTimeout(() => {
    ctx.ui.toast("【收徒系统】宿主：陆川（大罗宗宗主）", "gold");
    ctx.ui.toast("【收徒系统】今日宜收徒，忌大破财。", "gold");
    ctx.ui.event("【收徒系统】已绑定宿主：陆川");
  }, 2600);

  setTimeout(() => {
    ctx.ui.toast("系统提示：去祖师堂拿起那把扫帚。", "blue");
    ctx.ui.event("任务指引：前往祖师堂拾起扫帚");
  }, 4200);
}
