// 素材引用：Rotten-Soup 的 dawnlike 资源（32×32 像素艺术）
//
// ★ 图片内联策略：
//   使用 import.meta.url 让 Vite 在构建时自动将图片内联为 data URL。
//   这样 game.html 完全自包含，npm run dev 和直接打开都能工作。
//
//   注意：tileset 图片很大（1.9MB），data URL 约 2.5MB；
//   初次加载会慢，但在单机/插件场景可接受，且完全离线可用。

import tilesetUrl from "./assets/images/compiled_tileset_32x32.png?url";
import playerUrl from "./assets/images/player_sprites/4334.png?url";
import allyUrl from "./assets/images/player_sprites/3858.png?url";
import enemyUrl from "./assets/images/player_sprites/4213.png?url";

// import.meta.url 版本（Vite 构建时内联为 data URL）
export const TILESET_URL = tilesetUrl;

// 角色 / 野怪均改用 tileset 切片渲染（与 Rotten-Soup 动画帧一致）
// 兼容：保留单文件 URL 用于 chip 头像
export const IMG_PLAYER = playerUrl;
export const IMG_ALLY = allyUrl;
export const IMG_ENEMY_CHAR = enemyUrl;

/**
 * 角色 sprite 配置（从 tileset 切片，支持 2 帧 walk 动画）
 *
 * 来自 compiled_dawnlike.json 的 animated_id 字段：
 *   4334 ↔ 4342  玩家（金甲战士）
 *   3858 ↔ 3866  盟友（蓝袍法师）
 *   4213 ↔ 4221  敌对角色（持枪骑士）
 *   7440 ↔ 7448  哥布林
 *   5292 ↔ 5300  半兽人
 *   2365 ↔ 2373  巨鼠
 *   2600 ↔ 2608  野山羊
 *   4360 ↔ 4368  毒蛇
 *   3704 ↔ 3712  蝙蝠
 *   2552 ↔ 2560  骷髅
 *   7080 ↔ 7088  牛魔王
 */
export interface SpriteAnim {
  /** 站立/静态 */
  idle: number;
  /** 行走帧（2 帧交替） */
  walk: [number, number];
}
export const SPRITE_ANIM: Record<string, SpriteAnim> = {
  player:      { idle: 4334, walk: [4334, 4342] },
  ally:        { idle: 3858, walk: [3858, 3866] },
  enemy_char:  { idle: 4213, walk: [4213, 4221] },
  goblin:      { idle: 7440, walk: [7440, 7448] },
  orc:         { idle: 5292, walk: [5292, 5300] },
  rat:         { idle: 2365, walk: [2365, 2373] },
  goat:        { idle: 2600, walk: [2600, 2608] },
  snake:       { idle: 4360, walk: [4360, 4368] },
  bat:         { idle: 3704, walk: [3704, 3712] },
  skeleton:    { idle: 2552, walk: [2552, 2560] },
  minotaur:    { idle: 7080, walk: [7080, 7088] },
};

export const TILESET_COLS = 120;
export const TILE_SIZE = 32;

export function tileSrcRect(id: number) {
  return {
    sx: (id % TILESET_COLS) * TILE_SIZE,
    sy: Math.floor(id / TILESET_COLS) * TILE_SIZE,
    sw: TILE_SIZE,
    sh: TILE_SIZE,
  };
}

/**
 * 根据当前帧选择 sprite tile id
 *
 * 模仿 PIXI.AnimatedSprite：永远在 walk 2 帧间循环（不管是 idle 还是 moving），
 * 跟 Rotten-Soup 完全一致（animationSpeed=0.065，约 16 FPS）。
 *
 * 切换节奏：每 8 个 render tick 切一次帧（约 8 * 16ms = 128ms，符合像素 RPG 节奏）
 */
export function spriteTileId(key: string, frameIdx: number): number {
  const cfg = SPRITE_ANIM[key];
  if (!cfg) return 144; // 兜底：空 tile
  // 永远 2 帧 walk 循环（与 Rotten-Soup 行为一致：实体始终在动画）
  return cfg.walk[Math.floor(frameIdx / 8) % 2];
}

/** 兼容旧代码：getAsset 环境下的路径解析（dev 时需要） */
function pluginBase(): string | null {
  try {
    const u = new URL(location.href);
    if (!u.pathname.includes("getAsset")) return null;
    const pluginId = u.searchParams.get("pluginId") || "";
    const token = u.searchParams.get("token") || "";
    const tokenPart = token ? `&token=${encodeURIComponent(token)}` : "";
    return `${location.origin}/plugin/getAsset?pluginId=${encodeURIComponent(pluginId)}${tokenPart}&path=ui/`;
  } catch {
    return null;
  }
}

/** 解析素材路径：宿主 getAsset 环境下转成带 token 的 getAsset URL */
export function assetUrl(rel: string): string {
  const rel2 = rel.startsWith("./") ? rel.slice(2) : rel;
  const base = pluginBase();
  return base ? base + rel2 : `./${rel2}`;
}

// ---------------------------------------------------------------
// 野怪 / 装饰：全部用 tileset tile id（与 Rotten-Soup EntityFactory
// 和 RandomDungeon/RandomSimplex 的 id 一致）：
//   GOBLIN 7440  ORC 5292  RAT 2365  WILD_GOAT 2600  SNAKE 4360
//   BAT 3704  SKELETON 2552  MINOTAUR 7080
//   树 7355  枯树 7359  宝箱 57(开=58)  灌木 1722  蘑菇 1724  花 1482
// ---------------------------------------------------------------
export const MOB_TILES: Record<string, number> = {
  goblin: 7440,   // 哥布林
  orc: 5292,      // 半兽人
  rat: 2365,      // 巨鼠
  goat: 2600,     // 野山羊
  snake: 4360,    // 毒蛇
  bat: 3704,      // 蝙蝠
  skeleton: 2552, // 骷髅
  minotaur: 7080, // 牛魔王（boss）
};

export const TILE_TREE_ID = 7355;      // 绿树
export const TILE_DEADTREE_ID = 7359;  // 枯树
export const TILE_CHEST_ID = 57;       // 宝箱（关闭）
export const TILE_CHEST_OPEN_ID = 58;  // 宝箱（打开）
export const TILE_SHRUB_ID = 1722;     // 灌木
export const TILE_MUSHROOM_ID = 1724;  // 蘑菇
export const TILE_FLOWER_ID = 1482;    // 花

// tileset 中的地形 tile id（配合 tileSrcRect 使用）
export const TILE_GROUND_ID = 7031; // 纯深绿草地（可无缝平铺）
export const TILE_WATER_ID = 4500;  // 水面
export const TILE_POTION_ID = 614;  // 药水瓶

/** 野怪名字 → mob sprite key（后端命名里带这些关键字时命中） */
export function mobKeyFor(name: string): string {
  const n = name || "";
  if (n.includes("熊")) return "minotaur";    // 大体型怪
  if (n.includes("狼") || n.includes("兽")) return "orc";
  if (n.includes("蛇")) return "snake";
  if (n.includes("蝠")) return "bat";
  if (n.includes("鼠")) return "rat";
  if (n.includes("羊") || n.includes("鹿")) return "goat";
  if (n.includes("骷髅") || n.includes("亡灵")) return "skeleton";
  return "goblin"; // 默认：哥布林（游荡者/哥布林等）
}
