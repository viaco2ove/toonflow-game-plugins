/**
 * chunkTerrain.ts
 * 2D Canvas 版的 Chunk 地形系统（对应 25d_ai_game 的 chunk_terrain_system.gd）
 *
 * 设计要点（与 25d_ai_game 一致）：
 *   - CHUNK_SIZE_BLOCKS = 32, BLOCK_SIZE = 0.5 米 → CHUNK_SIZE_M = 16 米
 *   - chunks_cache：根据 x_range / z_range 预计算全部合法 chunk 坐标
 *   - loaded_chunks：当前玩家视野内的 chunk（用于 cull 装饰物 / 方块）
 *   - blocks_data：每个 chunk 的额外数据（destroyed 方块等）
 *   - 加载半径 2 chunk，卸载半径 3 chunk（防止抖动）
 *
 * 与 2D Canvas 侧的差异：
 *   - 不实际生成 3D mesh，仅保留「逻辑 chunk 数据」用于：
 *     ① spawn / 装饰物 culling（chunk 内的实体才渲染）
 *     ② 玩家挖掘系统未来扩展（destroyed_blocks 记录）
 *     ③ LOD 系统未来扩展（chunks 在视距内的渲染层级）
 *
 * 坐标：以世界米为基准，origin = (0, 0)，X/Z 范围 ±1500 米（与 map_config.json 一致）。
 */

import {
  TerrainScaleConfig,
  enumerateChunksAround,
  CHUNK_LOAD_RADIUS,
  CHUNK_UNLOAD_RADIUS,
  CHUNK_MAX_PER_FRAME,
  CHUNK_SIZE_BLOCKS,
  BLOCK_SIZE_M,
  CHUNK_SIZE_M,
} from "./terrainScale";

/** chunk 索引坐标 */
export type ChunkCoord = { cx: number; cz: number };

export interface ChunkTerrainSystemOptions {
  checkIntervalMs?: number;
}

/**
 * Chunk 地形系统（2D 版）
 */
export class ChunkTerrainSystem {
  readonly scale: TerrainScaleConfig;

  /** chunks_cache: 全部合法 chunk 坐标的集合，初始化时一次填好 */
  chunks_cache: Set<string> = new Set();

  /** loaded_chunks: 当前已加载的 chunk（在玩家视野半径内） */
  loaded_chunks: Set<string> = new Set();

  /** 玩家当前所在 chunk 坐标 */
  player_chunk_pos: ChunkCoord = { cx: 0, cz: 0 };

  /** 已破坏的方块（世界方块坐标 —→ true） */
  destroyed_blocks: Set<string> = new Set();

  /** 按 chunk 存储的额外数据（destroyed 列表等） */
  blocks_data: Record<string, { destroyed: Array<{ x: number; y: number; z?: number }> }> = {};

  /** 加载半径 chunk 数（默认 2） */
  load_radius = CHUNK_LOAD_RADIUS;

  /** 卸载半径 chunk 数（默认 3） */
  unload_radius = CHUNK_UNLOAD_RADIUS;

  private _checkIntervalMs: number;
  private _lastCheckAt = 0;
  private _pendingChunks: ChunkCoord[] = [];
  private _maxPerFrame = CHUNK_MAX_PER_FRAME;

  constructor(scale: TerrainScaleConfig, opts?: ChunkTerrainSystemOptions) {
    this.scale = scale;
    this._checkIntervalMs = opts?.checkIntervalMs ?? 500;
  }

  /**
   * 初始化：根据当前 scale 的 x_range / z_range 计算并预填 chunks_cache。
   * 与 25d_ai_game 的 init_terrain() 行为一致。
   */
  init(): void {
    const s = this.scale;
    const size = s.chunk_size_m;
    const minCX = Math.floor(s.x_range[0] / size);
    const maxCX = Math.ceil(s.x_range[1] / size);
    const minCZ = Math.floor(s.z_range[0] / size);
    const maxCZ = Math.ceil(s.z_range[1] / size);

    this.chunks_cache.clear();
    this.loaded_chunks.clear();
    this.blocks_data = {};
    this.destroyed_blocks.clear();
    this._pendingChunks = [];

    for (let cx = minCX; cx < maxCX; cx++) {
      for (let cz = minCZ; cz < maxCZ; cz++) {
        this.chunks_cache.add(this._key(cx, cz));
      }
    }
  }

  /**
   * 由地图数据注入 chunk 级数据（destroyed 方块）
   */
  ingestMapData(chunks?: Array<{ cx: number; cz: number; destroyed?: Array<{ x: number; y: number; z?: number }> }>): void {
    if (!Array.isArray(chunks)) return;
    for (const c of chunks) {
      const k = this._key(c.cx, c.cz);
      if (!this.chunks_cache.has(k)) continue;
      this.blocks_data[k] = {
        destroyed: Array.isArray(c.destroyed) ? c.destroyed.slice() : [],
      };
      for (const d of c.destroyed ?? []) {
        this.destroyed_blocks.add(this._blockKey(d.x, d.y, d.z ?? 0));
      }
    }
  }

  /** 每帧调用一次：推进 chunk 加载队列（避免同帧处理大量 chunk 阻塞 UI） */
  tick(): void {
    if (this._pendingChunks.length === 0) return;
    const batch = this._pendingChunks.splice(0, this._maxPerFrame);
    for (const c of batch) {
      const k = this._key(c.cx, c.cz);
      if (!this.loaded_chunks.has(k) && this.chunks_cache.has(k)) {
        this.loaded_chunks.add(k);
      }
    }
  }

  /**
   * 玩家移动后调用：触发远/近 chunk 的加载/卸载判定（与 25d_ai_game 的
   * check_and_update_chunks 等价，但用 now 替代 delta 时长避免重算）。
   */
  updateAroundPlayer(playerMx: number, playerMz: number, now: number): void {
    if (now - this._lastCheckAt < this._checkIntervalMs && this.loaded_chunks.size > 0) {
      // 间隔未到，忽略；首次进入（loaded_chunks 为空）会绕过此判断
    }
    this._lastCheckAt = now;

    const newPos = this.scale.worldToChunk(playerMx, playerMz);
    if (newPos.cx === this.player_chunk_pos.cx && newPos.cz === this.player_chunk_pos.cz) {
      return;
    }
    this.player_chunk_pos = newPos;

    // 卸载超出半径的 chunk
    const toUnload: string[] = [];
    for (const k of this.loaded_chunks) {
      const [cxS, czS] = k.split(",");
      const cx = Number(cxS), cz = Number(czS);
      const d = Math.max(Math.abs(cx - newPos.cx), Math.abs(cz - newPos.cz));
      if (d > this.unload_radius) toUnload.push(k);
    }
    for (const k of toUnload) this.loaded_chunks.delete(k);

    // 加载半径内的新 chunk（加入 pending，由 tick() 平滑消费）
    const candidates = enumerateChunksAround(playerMx, playerMz, this.load_radius, this.scale);
    for (const c of candidates) {
      const k = this._key(c.cx, c.cz);
      if (!this.chunks_cache.has(k)) continue;
      if (this.loaded_chunks.has(k)) continue;
      if (this._pendingChunks.some((p) => p.cx === c.cx && p.cz === c.cz)) continue;
      this._pendingChunks.push(c);
    }
  }

  /** 给定玩家世界米坐标 + 视距（米），返回当前可见 chunk 列表 */
  getLoadedChunksAround(playerMx: number, playerMz: number, visibleRadiusMeters: number): ChunkCoord[] {
    const out: ChunkCoord[] = [];
    const viewRadiusChunk = Math.ceil(visibleRadiusMeters / this.scale.chunk_size_m) + 1;
    for (const k of this.loaded_chunks) {
      const [cxS, czS] = k.split(",");
      const cx = Number(cxS), cz = Number(czS);
      const d = Math.max(
        Math.abs(cx - this.player_chunk_pos.cx),
        Math.abs(cz - this.player_chunk_pos.cz),
      );
      if (d <= viewRadiusChunk) out.push({ cx, cz });
    }
    return out;
  }

  /** 给定装饰物 / 宝箱 / 怪物的世界米坐标，判断它是否在玩家当前加载的 chunk 内（用于 culling） */
  isPointVisibleInChunks(mx: number, mz: number, extraMeters = 0): boolean {
    const target = this.scale.worldToChunk(mx, mz);
    const k = this._key(target.cx, target.cz);
    if (this.loaded_chunks.has(k)) return true;
    // 允许「视距外一格」也保留可见（防止 chunk 边界处闪烁）
    const marginChunk = Math.ceil(extraMeters / this.scale.chunk_size_m) + 1;
    for (let dx = -marginChunk; dx <= marginChunk; dx++) {
      for (let dz = -marginChunk; dz <= marginChunk; dz++) {
        if (this.loaded_chunks.has(this._key(target.cx + dx, target.cz + dz))) return true;
      }
    }
    return false;
  }

  isChunkLoaded(cx: number, cz: number): boolean {
    return this.loaded_chunks.has(this._key(cx, cz));
  }

  getChunkForPos(mx: number, mz: number): ChunkCoord {
    return this.scale.worldToChunk(mx, mz);
  }

  blockToChunk(bx: number, bz: number): ChunkCoord {
    return this.scale.blockToChunk(bx, bz);
  }

  /** 标记一个方块为已破坏（玩家挖掘）。返回是否新破坏 */
  destroyBlock(bx: number, by: number, bz = 0): boolean {
    const key = this._blockKey(bx, by, bz);
    if (this.destroyed_blocks.has(key)) return false;
    this.destroyed_blocks.add(key);
    const chunk = this.blockToChunk(bx, by);
    const ck = this._key(chunk.cx, chunk.cz);
    if (!this.blocks_data[ck]) this.blocks_data[ck] = { destroyed: [] };
    this.blocks_data[ck].destroyed.push({ x: bx, y: by, z: bz });
    return true;
  }

  /** 调试 */
  loadedCount(): number { return this.loaded_chunks.size; }
  cachedCount(): number { return this.chunks_cache.size; }
  pendingCount(): number { return this._pendingChunks.length; }

  private _key(cx: number, cz: number): string { return `${cx},${cz}`; }
  private _blockKey(bx: number, by: number, bz: number): string { return `${bx},${by},${bz}`; }
}

// 一些工具常量（导出供外层使用）
export { CHUNK_SIZE_BLOCKS, BLOCK_SIZE_M, CHUNK_SIZE_M };
