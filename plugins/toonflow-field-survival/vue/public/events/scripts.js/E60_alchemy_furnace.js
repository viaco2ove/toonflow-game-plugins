async function main(ctx) {
  const raw = await ctx.story.readJson("data/shop.alchemy.json");
  const goods = Array.isArray(raw) ? raw : Array.isArray(raw?.goods) ? raw.goods : [];
  if (!goods.length) {
    ctx.ui.toast("炼丹炉的货架空了：故事包缺少 data/shop.alchemy.json", "red");
  }
  ctx.ui.openShopPanel({ mode: "alchemy", tab: "sell", goods });
  ctx.ui.event(`打开炼丹面板（${goods.length} 件商品）`);
}
export {
  main as default
};
