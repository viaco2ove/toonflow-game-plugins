/**
 * E11_herb_at — 走进药堂采药
 * ========================================
 * area_enter 触发（重复事件，冷却 3s）：
 *   弹窗「是否采药？」→ 选是按概率得药材（黄芪 40% / 灵芝 20% / 当归 30% / 空手 10%）
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  const ok = await ctx.ui.confirm({
    title: "采药",
    detail: "草叶青翠，露珠未干——是否就地采药？",
    confirmText: "采一次",
    cancelText: "离去",
  });
  if (!ok) {
    ctx.ui.toast("你收回手，转身离去。", "white");
    return;
  }
  const r = Math.random();
  if (r < 0.4) {
    ctx.bag.give("黄芪", 1);
    ctx.ui.toast("挖得一根粗实黄芪，根须完整。", "blue");
    ctx.ui.event("采药获得 黄芪×1");
  } else if (r < 0.6) {
    ctx.bag.give("灵芝", 1);
    ctx.ui.toast("树桩背阴面，一朵紫色灵芝悄悄冒头。", "blue");
    ctx.ui.event("采药获得 灵芝×1");
  } else if (r < 0.9) {
    ctx.bag.give("当归", 1);
    ctx.ui.toast("一簇当归，叶细香浓。", "blue");
    ctx.ui.event("采药获得 当归×1");
  } else {
    ctx.ui.toast("翻遍草丛，一无所获。", "white");
    ctx.ui.event("采药空手而归");
  }
}