/**
 * mapBake.ts —— Tiled 地图一次性烘焙到离屏 canvas
 *
 * 为什么：mulberryTown 5 层 × 2488 格 ≈ 上万个 tile，Canvas 2D 逐帧逐格
 * drawImage 是主要卡顿源（Rotten-Soup 用 PIXI 的 GPU 批渲染所以流畅）。
 * 地图是静态的 → 烘焙一次，每帧只做 1 次 drawImage，快 2~3 个数量级。
 *
 * 坐标约定与 mapConfig.normalizeTiledMap 一致：
 *   世界格 (x, z)，x ∈ [0, W)，z ∈ [0, H)，原点左上；
 *   世界米 = (x - W/2, z - H/2)，即地图中心为原点。
 * 烘焙图：每格 TILE_SIZE(32)px，所以图尺寸 = W×32 × H×32（mulberryTown ≈ 1376×1792）。
 */

import { TILE_SIZE } from "./assets";

export interface BakedMap {
  /** 离屏画布（含全部 tilelayer 叠加结果） */
  canvas: HTMLCanvasElement;
  /** 地图格数 */
  cols: number;
  rows: number;
  /** 世界米 → 烘焙图像素：地图中心为烘焙图中心 */
  meterToBakePx: number; // 恒为 TILE_SIZE（1 米 = 1 格 = 32px）
}

let bakedCache: BakedMap | null = null;
let bakedKey = ""; // 地图 url（换图时重新烘焙）

/**
 * 烘焙 Tiled JSON 的全部 tilelayer。
 * @param tiledJson  Tiled 格式（layers[].data）
 * @param mapUrl     缓存键（同图不重复烘焙）
 * @param tilesetImg 已加载的 compiled_tileset_32x32.png
 * @param firstGid   Tiled tileset 的 firstgid（mulberryTown.json = 1）
 */
export function bakeTiledMap(
  tiledJson: { width: number; height: number; layers: any[] },
  mapUrl: string,
  tilesetImg: HTMLImageElement,
  firstGid = 1,
): BakedMap | null {
  if (bakedCache && bakedKey === mapUrl) return bakedCache;
  const W = tiledJson.width;
  const H = tiledJson.height;
  const cv = document.createElement("canvas");
  cv.width = W * TILE_SIZE;
  cv.height = H * TILE_SIZE;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false; // 像素风：禁插值

  const cols = tilesetImg.naturalWidth / TILE_SIZE;
  for (const layer of tiledJson.layers ?? []) {
    if (layer.type !== "tilelayer" || !Array.isArray(layer.data)) continue;
    for (let i = 0; i < layer.data.length; i++) {
      const gid = layer.data[i];
      if (!gid) continue;
      const id = gid - firstGid; // Tiled gid → tileset 行主序索引
      const sx = (id % cols) * TILE_SIZE;
      const sy = Math.floor(id / cols) * TILE_SIZE;
      const gx = i % W;
      const gz = Math.floor(i / W);
      ctx.drawImage(tilesetImg, sx, sy, TILE_SIZE, TILE_SIZE, gx * TILE_SIZE, gz * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  bakedCache = { canvas: cv, cols: W, rows: H, meterToBakePx: TILE_SIZE };
  bakedKey = mapUrl;
  return bakedCache;
}

/** 换关卡时清缓存 */
export function invalidateBake(): void {
  bakedCache = null;
  bakedKey = "";
}
