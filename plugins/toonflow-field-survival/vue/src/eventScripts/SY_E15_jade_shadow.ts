/**
 * SY_E15_jade_shadow — phase_3 节拍「玉简留影」
 * =============================================
 * area_enter 月蚀石阵触发
 * 对应故事节拍：「玉简留影 → 凿」
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("jade_shadow", true);

  ctx.ui.subtitle("月蚀 · 玉简留影", 3000);
  ctx.ui.toast("石阵中央那枚玉简自己亮了，映出一道人影——不是你。", "blue");

  setTimeout(() => {
    ctx.bag.give("月蚀残简", 1);
    ctx.ui.toast("玉简里刻着半句口诀，后半句被人生生凿掉了。", "gold");
    ctx.ui.event("获得 月蚀残简×1（玉简留影）");
  }, 1600);

  setTimeout(() => {
    ctx.ui.toast("凿痕很新——有人不想让后半句留下来。", "red");
    ctx.ui.event("玉简留影：后半句被凿去");
  }, 3200);
}
