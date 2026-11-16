async function main(ctx) {
  await ctx.save.setFlag("phase_1_active", true);
  ctx.ui.subtitle("大罗宗 · 山门", 2e3);
  ctx.ui.toast("晨雾未散，石阶自山门蜿蜒而上。", "white");
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
export {
  main as default
};
