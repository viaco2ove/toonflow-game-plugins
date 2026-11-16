async function main(ctx) {
  const raw = await ctx.story.readJson("data/shop.forge.json");
  const goods = Array.isArray(raw) ? raw : Array.isArray(raw?.goods) ? raw.goods : [];
  if (!goods.length) {
    ctx.ui.toast("锻造大师的货架空了：故事包缺少 data/shop.forge.json", "red");
  }
  ctx.ui.openShopPanel({ mode: "forge", tab: "sell", goods });
  ctx.ui.event(`打开锻造面板（${goods.length} 件商品）`);
}
export {
  main as default
};
