/**
 * SY_E08_wood_at — 木材堆取木
 * ============================
 * area_enter 触发（repeat）；trigger.ai.gather = "wood"
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  const who = ctx.actor.ai ? ctx.actor.name : "你";
  const ok = await ctx.ui.confirm({
    title: "取木",
    detail: "木堆码得整齐，边上散着几根短料——要取些吗？",
    confirmText: "取一根",
    cancelText: "算了",
  });
  if (!ok) return;
  const r = Math.random();
  if (r < 0.45) {
    ctx.bag.give("松木", 1);
    ctx.ui.toast(`${who}抽出一根松木，还带着树脂味。`, "blue");
    ctx.ui.event("取木获得 松木×1");
  } else if (r < 0.75) {
    ctx.bag.give("沉香木", 1);
    ctx.ui.toast(`${who}翻到一节沉香，压手。`, "blue");
    ctx.ui.event("取木获得 沉香木×1");
  } else {
    ctx.ui.toast(`${who}只摸到一把朽木，一捏就碎。`, "white");
    ctx.ui.event("取木：朽木，无收获");
  }
}
