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

/**
 * ★ fix②：统一的素材/头像路径解析（修 getAsset 404）
 *
 * 问题：宿主下发的 avatarPath 有两类——
 *   1) 插件自身资源：`./ui/...` 或 `images/...`（在插件包内，必须走 getAsset + token）；
 *   2) 宿主站内资源：`/1/game/scene/xxx.webp` 这种「以 / 开头的站内绝对路径」
 *      （文件由宿主 uploads 目录托管，压根不在插件包内）。
 * 旧实现把 (2) 无脑拼到 `getAsset?path=ui/` 后面，服务端按插件目录解析 → 404：
 *   /plugin/getAsset?...&path=ui//1/game/scene/8fe50371-....webp
 * 正确做法：(2) 直接用宿主 origin 直取（宿主静态目录已托管 /1/...，实测 200 image/webp）。
 */
export function resolveAssetPath(p: string): string {
  const s = (p || "").trim();
  if (!s) return "";
  // 绝对 URL / data URL / blob 原样返回
  if (/^(https?:)?\/\//i.test(s) || s.startsWith("data:") || s.startsWith("blob:")) return s;
  // 站内绝对路径：直取宿主静态目录（不再经过 getAsset）
  if (s.startsWith("/")) {
    try {
      const base = pluginBase();
      // getAsset 环境下 iframe 的 origin 就是宿主服务端 origin
      const origin = base ? new URL(base).origin : location.origin;
      return `${origin}${s}`;
    } catch {
      return s;
    }
  }
  // 相对路径：插件自身资源 → 仍走 assetUrl（getAsset + token / Vite dev / data URL）
  return assetUrl(s.startsWith("./") ? s.slice(2) : s);
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
// ★ v6 取值依据：本插件的 compiled_tileset_32x32.png 与参照项目 Rotten-Soup 的
//   public/images/compiled_tileset_32x32.png 是同一份文件（3840×3488，MD5 一致），
//   因此地表 id 直接对齐 Rotten-Soup 全部地图（public/maps/*.json）真实使用的地表 id：
//     id=7864 主草（RS 各地图地表层占比 76.9%，占其全部地表 tile 35.8%）
//     id=7984 干草浅色变体（RS 518 格）   id=7765 泥土/土路（RS 241 格）
//   并用「3×3 平铺 + 4 倍放大」自检筛掉放大后出现方格格线、不可大面积平铺的图块：
//     id=8940 边界落差/内部梯度≈6.7、id=10647≈4.4（旧沙地，带硬边框）、id=512（旧泥土）、
//     id=7149 为纯色平滑块（内部无梯度，与纹理块混铺即形成逐块跳变的棋盘格）。
export const TILE_GRASS_MAIN_ID = 7864;     // 草地（RS 主草，无缝平铺）
export const TILE_GRASS_DRY_ID = 7984;      // 草地（干草浅色变体，与主草色距 25）
export const TILE_DIRT_MAIN_ID = 7765;      // 泥土 / 土路（棕色，无缝平铺）
export const TILE_SAND_MAIN_ID = 7395;      // 沙地（浅沙，平铺无格线）
export const TILE_SAND_ALT_ID = 8937;       // 沙地（暖沙变体，与主沙色距 15）
export const TILE_GRASS_LIGHT_ID = 6834;    // 浅黄绿草地（亮）
export const TILE_SAND_PALE_ID = 8956;      // 沙地（浅）
// 以下三色保留（当前地表混布未使用，避免破坏其它可能引用）
export const TILE_GRASS_PALE_ID = 6710;     // 浅草坪
export const TILE_DIRT_LIGHT_ID = 7050;     // 浅棕泥土
export const TILE_DIRT_ORANGE_ID = 6833;    // 暖棕（农田）
export const TILE_WATER_ID = 4500;          // 水面（深水）
export const TILE_WATER_DEEP_ID = 6965;     // 深蓝水
export const TILE_WATER_SHALLOW_ID = 6963;  // 浅蓝水边
export const TILE_POTION_ID = 614;          // 药水瓶

// 建筑相关 tiles（来自 Dawnlike tileset，与 Rotten-Soup mulberryTown.json 一致）
export const TILE_HOUSE_ROOF_LEFT_ID = 9184;   // 屋顶左
export const TILE_HOUSE_ROOF_MID_ID = 9185;    // 屋顶中
export const TILE_HOUSE_ROOF_RIGHT_ID = 9186;  // 屋顶右
export const TILE_HOUSE_TOP_LEFT_ID = 9304;    // 墙体左上
export const TILE_HOUSE_TOP_MID_ID = 9305;     // 墙体上中
export const TILE_HOUSE_TOP_RIGHT_ID = 9306;   // 墙体右上
export const TILE_HOUSE_BOTTOM_ID = 9310;      // 墙体底部
export const TILE_HOUSE_DOOR_ID = 9425;        // 门
export const TILE_HOUSE_WINDOW_ID = 9424;      // 窗户
export const TILE_HOUSE_WINDOW_RIGHT_ID = 9426;// 窗（右）
// NPC 头顶气泡
export const TILE_DIALOG_BUBBLE_ID = 8623;
// 木栅栏
export const TILE_FENCE_POST_ID = 9298;        // 木桩
export const TILE_FENCE_RAIL_ID = 8297;        // 横梁
// 农田
export const TILE_FARM_DIRT_ID = 8005;         // 农田泥土
export const TILE_FARM_GREEN_ID = 7766;        // 绿色作物
export const TILE_FARM_TOP_ID = 7745;          // 田地上沿

/**
 * ★ v6 地表配色表（对照 Rotten-Soup 实测地表构成：整片同色 + 大尺度稀疏变体）
 *
 * 观感目标：地表由「一个无缝主图块」铺满，变体只在 10 米级尺度上稀疏出现且与主块
 * 同色系；严禁把「纯色块」与「强纹理块」按小尺度噪声对半混铺 —— 那是 v4/v5 仍能看到
 * 棋盘格的根因（每 3 格出现一次纯色/纹理跳变，等于把图块的方形边界画在地上）。
 *
 * 地表由两层噪声决定：
 *   - biome（约 26 米尺度）：决定该处是 草 / 泥 / 沙；
 *   - tone （约 12 米尺度）：只在该地貌内部二选一，取自同色系相邻图块。
 */
export const GROUND_BIOME_SCALE_M = 26.0;      // 地貌尺度（米）
export const GROUND_TONE_SCALE_M = 12.0;       // 同色系色调尺度（米）★ v6：7 → 12，变体成片更大

/** 地表格边长（米）：1 格 = 1 米 = 1 张 32×32 图块（与 Rotten-Soup 的 tile 比例一致） */
export const GROUND_CELL_M = 1.0;

/** biome < 该值 → 沙地（分位标定：约占全图 8%） */
export const GROUND_SAND_MAX = 0.21;
/** biome < 该值 → 泥土（约占全图 11%），其余为草地（约 81%） */
export const GROUND_DIRT_MAX = 0.325;
/** tone < 该值 → 取同色系的较浅一档（★ v6：0.5 → 0.62，变体占比降到约 1/4，主块占主导） */
export const GROUND_TONE_SPLIT = 0.62;

/** 草地两档（主草 7864 / 干草浅色变体 7984），同色系、均无缝平铺 */
export const GROUND_GRASS_TILES: number[] = [TILE_GRASS_MAIN_ID, TILE_GRASS_DRY_ID];
/** 泥土（单一主块 7765：Rotten-Soup 的土路块，大面积平铺不产生格线） */
export const GROUND_DIRT_TILES: number[] = [TILE_DIRT_MAIN_ID];
/** 沙地两档（浅沙 7395 / 暖沙 8937） */
export const GROUND_SAND_TILES: number[] = [TILE_SAND_MAIN_ID, TILE_SAND_ALT_ID];

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
