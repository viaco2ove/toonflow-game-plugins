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
  /** ★ 斧头破坏用：保留烘焙时的 tilelayer 数据与 tileset，供单格重绘（障碍擦除） */
  layers: any[];
  firstGid: number;
  tilesetImg: HTMLImageElement;
  /** ★ 斧头破坏用：单格全为障碍（如边界墙）擦除后的兜底色（≈地图主地面色） */
  fallbackColor: string;
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

  // ★ 斧头破坏用：兜底色 = 出现次数最多的瓦片的中心像素（≈地图主地面色）。
  //   全障碍格（如地图边界墙）被劈开后没有底层可画，用它填，避免透明洞。
  const gidCount = new Map<number, number>();
  for (const layer of tiledJson.layers ?? []) {
    if (layer.type !== "tilelayer" || !Array.isArray(layer.data)) continue;
    for (const gid of layer.data) if (gid) gidCount.set(gid, (gidCount.get(gid) || 0) + 1);
  }
  let topGid = 0;
  let topCount = 0;
  for (const [gid, c] of gidCount) if (c > topCount) { topGid = gid; topCount = c; }
  let fallbackColor = "#014a01";
  if (topGid) {
    const id = topGid - firstGid;
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const pctx = probe.getContext("2d");
    if (pctx) {
      pctx.drawImage(
        tilesetImg,
        (id % cols) * TILE_SIZE + (TILE_SIZE >> 1),
        Math.floor(id / cols) * TILE_SIZE + (TILE_SIZE >> 1),
        1, 1, 0, 0, 1, 1,
      );
      const d = pctx.getImageData(0, 0, 1, 1).data;
      if (d[3] > 0) fallbackColor = `rgb(${d[0]},${d[1]},${d[2]})`;
    }
  }

  bakedCache = { canvas: cv, cols: W, rows: H, meterToBakePx: TILE_SIZE, layers: tiledJson.layers ?? [], firstGid, tilesetImg, fallbackColor };
  bakedKey = mapUrl;
  return bakedCache;
}

/**
 * ★ 斧头破坏：把烘焙图里 (gx, gz) 这一格的障碍瓦片擦掉，只保留底层非障碍瓦片。
 *
 * 碰撞侧（walkGrid.blocked=0）改了但烘焙图不动 → 树还画在屏幕上（点击能过、
 * 视觉仍在的 bug）。这里直接改内存中的烘焙图：清掉该格 32×32 像素，再按原层序
 * 重绘所有**非 blocked** 瓦片（底层地面露出来）。
 *
 * 还原：切图换 key → bakeTiledMap 整体重烘焙 → 障碍自动还原（符合事件文档约定）。
 *
 * @param isBlockedGid gid → 是否 blocked（App.vue 用 tileFlags 提供）
 * @returns 该格是否真的有障碍被擦除
 */
export function eraseBakedObstacle(
  gx: number,
  gz: number,
  isBlockedGid: (gid: number) => boolean,
): boolean {
  if (!bakedCache) return false;
  const b = bakedCache;
  if (gx < 0 || gx >= b.cols || gz < 0 || gz >= b.rows) return false;
  const idx = gz * b.cols + gx;
  // 这一格烘焙时到底有没有画过 blocked 瓦片（没有就别动图）
  let hadObstacle = false;
  for (const layer of b.layers) {
    if (layer.type !== "tilelayer" || !Array.isArray(layer.data)) continue;
    const gid = layer.data[idx];
    if (gid && isBlockedGid(gid)) { hadObstacle = true; break; }
  }
  if (!hadObstacle) return false;
  const ctx = b.canvas.getContext("2d");
  if (!ctx) return false;
  ctx.clearRect(gx * TILE_SIZE, gz * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  const tcols = b.tilesetImg.naturalWidth / TILE_SIZE;
  let drewSomething = false;
  for (const layer of b.layers) {
    if (layer.type !== "tilelayer" || !Array.isArray(layer.data)) continue;
    const gid = layer.data[idx];
    if (!gid || isBlockedGid(gid)) continue; // 障碍跳过 → 只画地面等底层
    const id = gid - b.firstGid;
    const sx = (id % tcols) * TILE_SIZE;
    const sy = Math.floor(id / tcols) * TILE_SIZE;
    ctx.drawImage(b.tilesetImg, sx, sy, TILE_SIZE, TILE_SIZE, gx * TILE_SIZE, gz * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    drewSomething = true;
  }
  if (!drewSomething) {
    // 全障碍格（如边界墙）没有底层可画 → 主地面色兜底
    ctx.fillStyle = b.fallbackColor;
    ctx.fillRect(gx * TILE_SIZE, gz * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }
  return true;
}

/** 换关卡时清缓存 */
export function invalidateBake(): void {
  bakedCache = null;
  bakedKey = "";
}
