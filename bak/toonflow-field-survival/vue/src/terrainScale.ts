/**
 * terrainScale.ts
 * 地图比例尺 / 土块 / Chunk 配置（对应 25d_ai_game 的 terrain_scale_config.gd）
 *
 * 真实正本（来自 25d_ai_game 的 config/map_config.json）：
 *
 *   world size    = 3000 × 3000 米        ← 总游戏地图尺寸
 *   origin        = (0, 0)                ← 世界中心（玩家在此出生）
 *   x_range       = [-1500, +1500]        ← 米
 *   z_range       = [-1500, +1500]        ← 米
 *   def_view      = ±15 米                ← 默认相机看到 30×30 米
 *   default_zoom  = 20
 *   min_zoom      = 10                    ← 看到更广（60×60 米）
 *   max_zoom      = 30                    ← 看到更近（20×20 米）
 *   block_size    = 0.5 米                ← 单个土块
 *   chunk_size    = 32 blocks = 16 米     ← 一个 chunk
 *
 * 渲染数学：
 *   view_radius_m = def_view_max * (default_zoom / zoom)
 *                 = 15 * (20 / zoom) 米
 *   pixels_per_meter = canvas_size_px / (2 * view_radius_m)
 *
 *   在 canvas 上看的是「玩家周围 ±view_radius_m」米，相机永远居中。
 *   zoom 越大 → 看到的米数越小（放大看脚下），zoom 越小 → 看到的米数越大（缩小看全图）。
 *
 *   玩家位置坐标全部用「米」，存的是世界坐标 [−1500, +1500] × [−1500, +1500]。
 */

/** Canvas 内部逻辑像素（鼠标坐标按这个算，默认竖屏 600×960） */
export const CANVAS_DEFAULT_W = 600;
export const CANVAS_DEFAULT_H = 960;

/** 单个土块边长（米），跟 25d_ai_game 一致 = 0.5m */
export const BLOCK_SIZE_M = 0.5;

/** 每 chunk 多块（25d_ai_game 的 CHUNK_SIZE_BITS=5 → 2^5=32） */
export const CHUNK_SIZE_BITS = 5;
export const CHUNK_SIZE_BLOCKS = 1 << CHUNK_SIZE_BITS;     // 32
export const CHUNK_SIZE_M = CHUNK_SIZE_BLOCKS * BLOCK_SIZE_M; // 16 m

/** 加载/卸载半径（与 25d_ai_game 保持一致） */
export const CHUNK_LOAD_RADIUS = 2;
export const CHUNK_UNLOAD_RADIUS = 3;
export const CHUNK_MAX_PER_FRAME = 4;

/**
 * 地图比例尺配置（一份跟 MapConfig 同结构的数据类，对应 25d_ai_game 的
 * TerrainScaleConfig + MapConfig 的合并视图）。
 */
export class TerrainScaleConfig {
  /** 世界总尺寸 [w, h] 米。默认 [3000, 3000] */
  size: [number, number];

  /** 世界原点（玩家出生点）。默认 [0, 0] */
  origin: [number, number];

  /** 比例尺：1 米 = scale_meter 游戏单位。默认 1.0 */
  scale_meter: number;

  /** 世界 X/Z 范围（米）。默认 ±1500。 */
  x_range: [number, number];
  z_range: [number, number];

  /** 默认相机视野（米）。在 default_zoom 下，玩家能看到 [±15, ±15] 米 = 30×30 */
  def_view: { x: [number, number]; z: [number, number] };

  /** zoom 范围 */
  default_zoom: number;
  min_zoom: number;
  max_zoom: number;

  /** 高度/地下相关 */
  height_range: [number, number];
  baseline: number;               // 通常 -10
  underground_depth: number;      // 通常 5 米（地下泥土层厚度）

  /** 地下区块范围（与 chunk 渲染相关） */
  underground_x_range: [number, number];
  underground_z_range: [number, number];

  /** 单个土块边长（米） */
  block_size: number;

  /** 派生字段：每 chunk 多少块 / 多少米 */
  chunk_size_blocks: number;
  chunk_size_m: number;

  constructor(opts?: Partial<TerrainScaleConfig>) {
    this.size = [3000, 3000];
    this.origin = [0, 0];
    this.scale_meter = 1.0;
    this.x_range = [-1500, 1500];
    this.z_range = [-1500, 1500];
    this.def_view = { x: [-15, 15], z: [-15, 15] };
    this.default_zoom = 20;
    this.min_zoom = 10;
    this.max_zoom = 100;
    this.height_range = [-1, 8];
    this.baseline = -10;
    this.underground_depth = 5;
    this.underground_x_range = [-150, 150];
    this.underground_z_range = [-150, 150];
    this.block_size = BLOCK_SIZE_M;
    this.chunk_size_blocks = CHUNK_SIZE_BLOCKS;
    this.chunk_size_m = CHUNK_SIZE_M;

    Object.assign(this, opts || {});
    // derived
    this.chunk_size_blocks = CHUNK_SIZE_BLOCKS;
    this.chunk_size_m = CHUNK_SIZE_M;
  }

  // ─── 单位换算 ────────────────────────────────────────────

  /** 米 → 块坐标（向下取整，保证方块唯一归属） */
  metersToBlocks(m: number): number {
    return Math.floor(m / this.block_size);
  }
  blocksToMeters(b: number): number {
    return b * this.block_size + this.block_size / 2;
  }

  // ─── 坐标转换：世界米 ↔ Chunk 索引 ────────────────────────

  worldToChunkX(mx: number): number {
    return Math.floor(mx / this.chunk_size_m);
  }
  worldToChunkZ(mz: number): number {
    return Math.floor(mz / this.chunk_size_m);
  }
  worldToChunk(mx: number, mz: number): { cx: number; cz: number } {
    return { cx: this.worldToChunkX(mx), cz: this.worldToChunkZ(mz) };
  }
  chunkToWorldMinX(cx: number): number {
    return cx * this.chunk_size_m;
  }
  chunkToWorldMinZ(cz: number): number {
    return cz * this.chunk_size_m;
  }
  blockToChunk(bx: number, bz: number): { cx: number; cz: number } {
    return { cx: bx >> CHUNK_SIZE_BITS, cz: bz >> CHUNK_SIZE_BITS };
  }

  // ─── 边界判定 ────────────────────────────────────────────

  isInWorld(mx: number, mz: number): boolean {
    return mx >= this.x_range[0] && mx <= this.x_range[1]
      && mz >= this.z_range[0] && mz <= this.z_range[1];
  }
  isBlockInWorld(bx: number, bz: number): boolean {
    const s = Math.floor(this.size[0] / this.block_size);
    return bx >= 0 && bz >= 0 && bx < s && bz < s;
  }

  // ─── 缩放 / 视距数学 ──────────────────────────────────────

  /**
   * 当前 zoom 下，相机能看到的世界半边长（米）。
   * view_radius_m = max(|def_view|) * (default_zoom / zoom)
   *   zoom = default_zoom → 等于 def_view（±15 米）
   *   zoom 越小 → 看到越广（越小则 1/zoom 越大）
   *   zoom 越大 → 看到越近（越大则 1/zoom 越小）
   */
  viewRadiusMeters(zoom: number): number {
    const base = Math.max(
      Math.abs(this.def_view.x[0]),
      Math.abs(this.def_view.x[1]),
      Math.abs(this.def_view.z[0]),
      Math.abs(this.def_view.z[1]),
    );
    return base * (this.default_zoom / zoom);
  }

  /** 当前 zoom 下，玩家可见的世界尺寸（米）— 一个 (w, h) 二元组 */
  viewSizeMeters(zoom: number): [number, number] {
    // X/Z 维度可以不同（更精确），但简单起见用同一个 view_radius
    const rx = this.viewRadiusMeters(zoom) * (Math.abs(this.def_view.x[1]) / Math.abs(this.def_view.x[0] || 1));
    const rz = this.viewRadiusMeters(zoom) * (Math.abs(this.def_view.z[1]) / Math.abs(this.def_view.z[0] || 1));
    return [rx * 2, rz * 2];
  }

  /**
   * 当前 canvas 像素尺寸下，1 米对应多少 canvas 像素。
   * 取较短边的限制以保证 viewport 在短轴也完整可见。
   */
  pixelPerMeter(zoom: number, canvasW = CANVAS_DEFAULT_W, canvasH = CANVAS_DEFAULT_H): number {
    const [vw, vh] = this.viewSizeMeters(zoom);
    const ppX = canvasW / vw;
    const ppY = canvasH / vh;
    return Math.min(ppX, ppY);
  }

  meterToPixel(m: number, zoom: number, canvasW = CANVAS_DEFAULT_W, canvasH = CANVAS_DEFAULT_H): number {
    return m * this.pixelPerMeter(zoom, canvasW, canvasH);
  }
  pixelToMeter(px: number, zoom: number, canvasW = CANVAS_DEFAULT_W, canvasH = CANVAS_DEFAULT_H): number {
    return px / this.pixelPerMeter(zoom, canvasW, canvasH);
  }

  /**
   * 世界米 → canvas 像素坐标（玩家为画面中心）
   */
  worldToCanvas(
    mx: number, mz: number,
    playerMx: number, playerMz: number,
    zoom: number,
    canvasW = CANVAS_DEFAULT_W, canvasH = CANVAS_DEFAULT_H,
  ): { x: number; y: number } {
    const ppm = this.pixelPerMeter(zoom, canvasW, canvasH);
    const dx = mx - playerMx;
    const dy = mz - playerMz;
    return {
      x: canvasW / 2 + dx * ppm,
      // ⚠️ Canvas 2D 的 y 轴向下增长，世界坐标 z 通常向上增长（25d_ai_game 也是这样），
      // 这里反一下 z：玩家在屏幕中央，世界 z 增加 → 屏幕 y 减小。
      y: canvasH / 2 - dy * ppm,
    };
  }

  /** canvas 像素 → 世界米（用于点击 canvas 反查世界坐标） */
  canvasToWorld(
    px: number, py: number,
    playerMx: number, playerMz: number,
    zoom: number,
    canvasW = CANVAS_DEFAULT_W, canvasH = CANVAS_DEFAULT_H,
  ): { x: number; z: number } {
    const ppm = this.pixelPerMeter(zoom, canvasW, canvasH);
    return {
      x: playerMx + (px - canvasW / 2) / ppm,
      z: playerMz - (py - canvasH / 2) / ppm,
    };
  }

  /** clamp zoom 到合法范围 */
  clampZoom(zoom: number): number {
    return Math.max(this.min_zoom, Math.min(this.max_zoom, Math.round(zoom)));
  }

  /** 人话描述当前视图宽 × 高（米） */
  describeView(zoom: number): string {
    const [w, h] = this.viewSizeMeters(zoom);
    return `${Math.round(w)}m × ${Math.round(h)}m`;
  }

  /** 人话描述整个世界 */
  describeWorld(): string {
    return `世界 ${this.size[0]}m × ${this.size[1]}m (origin ${this.origin.join(",")}, 比例 1:${1 / this.scale_meter})`;
  }
}

/** 默认实例（与用户给的 map_config.json 等价） */
export const DEFAULT_SCALE = new TerrainScaleConfig();

/**
 * 枚举玩家周围 radius 个 chunk 的所有 chunk 索引，按距离排序。
 * 用于 chunk 加载系统（与 25d_ai_game 的 enumerateChunksAround 等价）。
 */
export function enumerateChunksAround(
  playerMx: number, playerMz: number,
  radius: number,
  scale: TerrainScaleConfig = DEFAULT_SCALE,
): Array<{ cx: number; cz: number }> {
  const center = scale.worldToChunk(playerMx, playerMz);
  const out: Array<{ cx: number; cz: number; d: number }> = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const cx = center.cx + dx;
      const cz = center.cz + dz;
      const minX = scale.chunkToWorldMinX(cx);
      const minZ = scale.chunkToWorldMinZ(cz);
      if (
        minX < scale.x_range[0] - scale.chunk_size_m ||
        minZ < scale.z_range[0] - scale.chunk_size_m ||
        minX > scale.x_range[1] + scale.chunk_size_m ||
        minZ > scale.z_range[1] + scale.chunk_size_m
      ) continue;
      out.push({ cx, cz, d: Math.max(Math.abs(dx), Math.abs(dz)) });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out.map(({ cx, cz }) => ({ cx, cz }));
}
