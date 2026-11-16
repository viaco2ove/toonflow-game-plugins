async function main(ctx) {
  const ok = await ctx.ui.confirm({
    title: "垂钓",
    detail: "池水清幽，鱼线一甩——是否在此垂钓？",
    confirmText: "钓一次",
    cancelText: "离去"
  });
  if (!ok) {
    ctx.ui.toast("你收起鱼线，背手离去。", "white");
    return;
  }
  const r = Math.random();
  if (r < 0.5) {
    ctx.bag.give("鲫鱼", 1);
    ctx.ui.toast("竿尖一沉——一尾鲫鱼跃出水面。", "blue");
    ctx.ui.event("钓鱼获得 鲫鱼×1");
  } else if (r < 0.8) {
    ctx.bag.give("鲤鱼", 1);
    ctx.ui.toast("竿尾弯弯——拉起一尾金鳞大鲤鱼！", "blue");
    ctx.ui.event("钓鱼获得 鲤鱼×1");
  } else {
    ctx.ui.toast("鱼线微颤——空钩，无渔获。", "white");
    ctx.ui.event("垂钓无渔获");
  }
}
export {
  main as default
};
