/**
 * SY_E18_forest_herb — 林中药丛采药
 * ==================================
 * area_enter 触发（repeat）；trigger.ai.gather = "herb"
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  const who = ctx.actor.ai ? ctx.actor.name : "你";
  const ok = await ctx.ui.confirm({
    title: "林中采药",
    detail: "腐叶下压着几株药草——要拨开看看吗？",
    confirmText: "拨开",
    cancelText: "走开",
  });
  if (!ok) return;
  const r = Math.random();
  if (r < 0.4) {
    ctx.bag.give("血参", 1);
    ctx.ui.toast(`${who}拨出根血参——长在被魔血浸过的土里。`, "blue");
    ctx.ui.event("林中采药获得 血参×1");
  } else if (r < 0.7) {
    ctx.bag.give("夜合花", 1);
    ctx.ui.toast(`${who}摘到一朵夜合花。`, "blue");
    ctx.ui.event("林中采药获得 夜合花×1");
  } else {
    ctx.ui.toast(`${who}只拨出一手的泥。`, "white");
    ctx.ui.event("林中采药：空手");
  }
}
