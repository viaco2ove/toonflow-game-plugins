/**
 * SY_E22_soul_devour — phase_3 节拍「灵魂吞噬」
 * =============================================
 * area_enter 灵魂祭坛触发
 * 对应故事节拍：「灵魂吞噬」
 *
 * ★ 当前 ctx 没有直接改 HP/MP 的 API（game.md 等级系统里 HP/MP 由公式派生），
 *   这里只写 flag + 叙事表现；要做真扣血换 MP 上限需等 ctx 扩展（v0.2）。
 */
import type { Ctx } from "../shared/_ctx";

export default async function main(ctx: Ctx): Promise<void> {
  await ctx.save.setFlag("soul_devour", true);

  ctx.ui.subtitle("灵魂吞噬", 3000);
  ctx.ui.toast("祭坛上的凹痕正好放下一只手掌。你还没放，它就先握紧了。", "red");

  setTimeout(() => {
    ctx.ui.toast("有什么从脊椎那头被抽走了一点——换来一阵清凉。", "blue");
    ctx.ui.event("灵魂吞噬：被抽走一部分，换来一阵清凉");
  }, 1600);

  setTimeout(() => {
    ctx.ui.toast("你松开手。凹痕里多了一道不属于你的指印。", "white");
    ctx.ui.event("灵魂祭坛：留下不属于你的指印");
  }, 3200);
}
