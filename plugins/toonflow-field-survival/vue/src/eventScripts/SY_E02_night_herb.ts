/**
 * SY_E02_night_herb — 夜采药圃采药
 * ==================================
 * area_enter 触发（repeat，冷却 3s）；trigger.ai.gather = "herb"
 *
 * ★ AI 托管：ctx.actor.ai 时 confirm 自动通过、产出进该角色 _aiBag，
 *   不弹窗打断玩家、不污染玩家背包（见 eventEngine.makeCtx）。
 */
import type { Ctx } from "./_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  const who = ctx.actor.ai ? ctx.actor.name : "你";
  const ok = await ctx.ui.confirm({
    title: "夜采",
    detail: "露水刚上，草叶青翠——是否就地采药？",
    confirmText: "采一次",
    cancelText: "离去",
  });
  if (!ok) {
    ctx.ui.toast(`${who}收回手，转身离去。`, "white");
    return;
  }
  const r = Math.random();
  if (r < 0.35) {
    ctx.bag.give("夜合花", 1);
    ctx.ui.toast(`${who}掐下一朵夜合花，只在子时开。`, "blue");
    ctx.ui.event("夜采获得 夜合花×1");
  } else if (r < 0.6) {
    ctx.bag.give("血参", 1);
    ctx.ui.toast(`${who}挖出一根血参，断面发暗红。`, "blue");
    ctx.ui.event("夜采获得 血参×1");
  } else if (r < 0.85) {
    ctx.bag.give("当归", 1);
    ctx.ui.toast(`${who}采到一簇当归，叶细香浓。`, "blue");
    ctx.ui.event("夜采获得 当归×1");
  } else {
    ctx.ui.toast(`${who}翻遍草丛，一无所获。`, "white");
    ctx.ui.event("夜采空手而归");
  }
}
