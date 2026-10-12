/**
 * E12_wood_at — 走到木材堆取木
 * ==========================================================
 * area_enter 触发（重复事件，冷却 3s）：
 *   弹窗「是否取木？」→ 选是按概率得木材（松木 70% / 沉香 20% / 朽木 10%）
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  const ok = await ctx.ui.confirm({
    title: "取木",
    detail: "木堆叠得齐整，斧痕犹新——是否取些木料？",
    confirmText: "取一块",
    cancelText: "离去",
  });
  if (!ok) {
    ctx.ui.toast("你收回手，转身离去。", "white");
    return;
  }
  const r = Math.random();
  if (r < 0.7) {
    ctx.bag.give("松木", 2);
    ctx.ui.toast("抱起两块松木，质地紧实。", "blue");
    ctx.ui.event("取木获得 松木×2");
  } else if (r < 0.9) {
    ctx.bag.give("沉香", 1);
    ctx.ui.toast("一抹沉香暗藏木心，香气扑鼻。", "blue");
    ctx.ui.event("取木获得 沉香×1");
  } else {
    ctx.bag.give("朽木", 1);
    ctx.ui.toast("翻出一块朽木，中空有虫蛀。", "white");
    ctx.ui.event("取木仅得 朽木×1");
  }
}