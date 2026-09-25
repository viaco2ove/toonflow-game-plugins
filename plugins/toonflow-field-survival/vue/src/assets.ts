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
// ★ 取值依据：直接采样 compiled_tileset_32x32.png 中对应 tile 的平均色（草=绿系 / 泥=棕系 / 沙=黄系）
export const TILE_GROUND_ID = 7031;         // 深绿草地（暗）
export const TILE_GRASS_VIVID_ID = 7149;    // 鲜绿草地
export const TILE_GRASS_MID_ID = 9378;      // 中绿草地
export const TILE_GRASS_LIGHT_ID = 6834;    // 浅黄绿草地（亮）
export const TILE_DIRT_MID_ID = 512;        // 中棕泥土
export const TILE_DIRT_DARK_ID = 7030;      // 深棕泥土
export const TILE_SAND_ID = 10647;          // 沙地（偏黄）
export const TILE_SAND_MID_ID = 8940;       // 沙地（中）
export const TILE_SAND_PALE_ID = 8956;      // 沙地（浅）
// 以下三色保留（当前地表混布未使用，避免破坏其它可能引用）
export const TILE_GRASS_PALE_ID = 6710;     // 浅草坪
export const TILE_DIRT_LIGHT_ID = 7050;     // 浅棕泥土
export const TILE_DIRT_ORANGE_ID = 6833;    // 暖棕（农田）
export const TILE_WATER_ID = 4500;          // 水面（深水）
export const TILE_WATER_DEEP_ID = 6965;     // 深蓝水
export const TILE_WATER_SHALLOW_ID = 6963;  // 浅蓝水边
export const TILE_POTION_ID = 614;          // 药水瓶

/**
 * ★ v4 地表配色表（对照 Rotten-Soup：整片同色 + 大尺度分区，不做逐格跳色）
 *
 * 观感目标：同一片地貌内部"整片同色 + 细微暗纹"，只在大尺度上换地貌；
 * 逐格跳色（相邻格忽草忽沙）正是"棋盘格"观感的根因。
 *
 * 因此地表由两层噪声决定：
 *   - biome（约 26 米尺度）：决定该处是 草 / 泥 / 沙；
 *   - tone （约 7 米 + 3 米细节）：只在该地貌内部二选一（同色系深/浅），不跨色系。
 * 阈值用同一套噪声在 400 米见方区域内分位标定，得到草 ≈ 77% / 泥 ≈ 14% / 沙 ≈ 9%。
 */
export const GROUND_BIOME_SCALE_M = 26.0;      // 地貌尺度（米）
export const GROUND_TONE_SCALE_M = 7.0;        // 同色系色调尺度（米）
export const GROUND_TONE_FINE_SCALE_M = 3.0;   // 色调细节尺度（米）

/** 地表格边长（米）：1 格 = 1 米 = 1 张 32×32 图块（与 Rotten-Soup 的 tile 比例一致） */
export const GROUND_CELL_M = 1.0;

/** biome < 该值 → 沙地（分位标定：约占全图 9%） */
export const GROUND_SAND_MAX = 0.21;
/** biome < 该值 → 泥土（约占全图 14%），其余为草地（约 77%） */
export const GROUND_DIRT_MAX = 0.325;
/** tone < 该值 → 取同色系的较深一档 */
export const GROUND_TONE_SPLIT = 0.5;

/** 草地两档（鲜绿 / 中绿）——同色系，仅深浅不同 */
export const GROUND_GRASS_TILES: number[] = [TILE_GRASS_VIVID_ID, TILE_GRASS_MID_ID];
/** 泥土两档（中棕 / 深棕） */
export const GROUND_DIRT_TILES: number[] = [TILE_DIRT_MID_ID, TILE_DIRT_DARK_ID];
/** 沙地两档（中沙 / 偏黄沙） */
export const GROUND_SAND_TILES: number[] = [TILE_SAND_MID_ID, TILE_SAND_ID];

/* ★ v5：v3 的 8 档混布地表表（GROUND_TILES / GROUND_FALLBACK_TILE / GROUND_THRESHOLDS）
 *   已确认全仓库零引用（grep 覆盖 vue/src 全部 .ts/.vue），在此删除，
 *   避免"逐格跳色"的旧方案被再次误用；地表只走上面的两层噪声 + GROUND_*_TILES。 */

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
