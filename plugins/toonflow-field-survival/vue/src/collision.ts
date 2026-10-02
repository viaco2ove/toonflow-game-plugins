/**
 * collision.ts —— 网格碰撞（对齐 Rotten-Soup 的 Tile.blocked() 语义）
 *
 * ── 为什么需要这个文件 ────────────────────────────────────────────────
 * 本插件此前**没有任何 tile 级碰撞**：
 *   - 地图（maps/*.json 的 tilelayer）只是被 mapBake 一次性烘焙成一张图贴到屏幕上；
 *   - App.vue 里那段"碰撞检测"只遍历 mapCfg.decorations 里 kind=tree/dead_tree/fence
 *     的圆形推挤 —— 而 normalizeTiledMap 只会把 NPC / portal 写进 decorations，
 *     所有 Tiled 真实关卡里 decorations 根本没有 tree/fence（已核实 22 张图 0 命中），
 *     所以实际效果 = 玩家可以穿墙。
 *   - 唯一的"边界"是 ±worldLimit（地图外一圈）。
 *
 * ── Rotten-Soup 是怎么做的（本文档的实现依据）────────────────────────
 *   1. 墙的定义**不在代码里**，而在美术资源 public/compiled_dawnlike.json：
 *      每个 tile 有一组 properties，其中 `blocked: true` 就是"不可通行"。
 *   2. GameMap.processTileLayer():  id = layer.data[i] - 1，逐格 push 进 tile.obstacles
 *   3. Tile.blocked():             obstacles.some(o => o.blocked)
 *      → 只看地形，不看格子上的角色（actor 碰撞由 tryMove 单独遍历 actors 处理）
 *   4. Tile.visible():             有 obstacle 带 blocks_vision → 挡视线（FOV / 弓箭用）
 *   5. Actor.tryMove():            越界 / 地形 blocked → 拒绝；否则 move
 *
 * 本文件做的就是 1+2+3 三步的等价物，并把结果压成两个 Uint8Array（blocked / vision）。
 * 视觉层（mapBake 烘焙、sprite 渲染）完全不动。
 *
 * ── 坐标约定（与 mapConfig.ts / mapBake.ts 严格一致）────────────────
 *   世界格 (gx, gz)，gx ∈ [0, cols)，gz ∈ [0, rows)，原点在左上；
 *   世界米 = (gx - cols/2, gz - rows/2)，即地图中心为原点、1 米 = 1 格 = 1 个 32px tile。
 *   所以 gx = floor(mx + cols/2)，gz = floor(mz + rows/2)。
 *   （对照 normalizeTiledMap：playerSpawn.x = obj.x/32 - W/2，即 gx = obj.x/32）
 */

import { assetUrl } from "./assets";

/** 单个 tile id 的碰撞标记 */
export interface TileFlags {
  /** 不可通行（Rotten-Soup 的 tileproperties.blocked） */
  blocked: boolean;
  /** 挡视线 / 挡箭（Rotten-Soup 的 tileproperties.blocks_vision） */
  vision: boolean;
}

/** 全量 tile 标记表：tile id → flags */
export type TileFlagTable = Record<number, TileFlags>;

/** 烘焙好的可行走网格 */
export interface WalkGrid {
  cols: number;
  rows: number;
  /** cols×rows，1 = 不可通行（下标 gz*cols+gx） */
  blocked: Uint8Array;
  /** cols×rows，1 = 挡视线（下标 gz*cols+gx） */
  vision: Uint8Array;
  /** Tiled firstgid（本插件地图均为 1） */
  firstGid: number;
  /** 统计：被标 blocked 的格数（调试用） */
  blockedCount: number;
  /** 统计：被标 blocks_vision 的格数（调试用） */
  visionCount: number;
}

/* ============================================================
   1. 加载 tileset 属性表（compiled_dawnlike.json）
   ============================================================ */

const FLAG_URLS = [
  assetUrl("compiled_dawnlike.json"),
  "/compiled_dawnlike.json",
  "./compiled_dawnlike.json",
];

let flagsPromise: Promise<TileFlagTable> | null = null;

/**
 * 读 compiled_dawnlike.json → { [tileId]: { blocked, vision } }。
 *
 * ★ 相对 Rotten-Soup 的一处加固：Tiled 里 bool 属性可能被存成**字符串**
 *   （实测该文件里 blocked 有 7 个、blocks_vision 有 216 个值是 "true"）。
 *   JS 中 "false" 也是 truthy，若哪天有人写成字符串 "false"，
 *   Rotten-Soup 的 `some(o => o.blocked)` 会把它当成墙。这里统一解析成真 bool，
 *   把这类隐性坑挡在数据入口。
 *
 * 结果进程内缓存（2.3MB，只解析一次）。
 */
export function loadTileFlags(): Promise<TileFlagTable> {
  if (flagsPromise) return flagsPromise;
  flagsPromise = (async (): Promise<TileFlagTable> => {
    for (const url of FLAG_URLS) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const d = (await r.json()) as any;
        const out: TileFlagTable = {};
        for (const t of d?.tiles ?? []) {
          if (t?.id == null) continue;
          let blocked = false;
          let vision = false;
          for (const p of t.properties ?? []) {
            const v = toBool(p?.value);
            if (p?.name === "blocked") blocked = v;
            else if (p?.name === "blocks_vision") vision = v;
          }
          // 只记录有用的项：两个都 false 的 tile 等同于"无属性"，省内存
          if (blocked || vision) out[Number(t.id)] = { blocked, vision };
        }
        console.info(
          `[field-survival] tileset 碰撞属性已加载（${url}）：` +
            `带 blocked/blocks_vision 的 tile = ${Object.keys(out).length}`,
        );
        return out;
      } catch {
        /* try next */
      }
    }
    console.warn(
      "[field-survival] compiled_dawnlike.json 未取到 → 网格碰撞降级为「无阻挡」" +
        "（玩家仍可到处走，与旧行为一致）",
    );
    return {};
  })();
  return flagsPromise;
}

/** 宽松 bool：真 bool 原样；字符串 "true"/"1"/"yes" → true；"false"/"0"/"" → false */
function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "" || s === "no") return false;
    return Boolean(s);
  }
  return false;
}

/* ============================================================
   2. Tiled 地图 → WalkGrid
   ============================================================ */

/**
 * 把 Tiled JSON 的全部 tilelayer 叠成一张 blocked / vision 网格。
 *
 * 逐格逻辑与 Rotten-Soup 的 GameMap.processTileLayer 对齐：
 *   id = gid - firstGid；相同 id 出现在多层时，任一层 blocked 即整格 blocked
 *   （Rotten-Soup 是 push 进 obstacles 后 some()，等价于"或"）。
 *
 * ★ 保留 Rotten-Soup 的 `if (id > 1)` 守卫：id 0/1 会被跳过。
 *   实测本插件 22 张地图的最小非零 gid 均 ≥ 25（kingdom.json 为 base64 编码，已单独解码核对），
 *   所以该守卫当前不丢弃任何真实格子；保留它只是为了与参照实现保持逐行可比。
 *
 * @param tiled   Tiled JSON（来自 mapConfig.getTiledRaw()）
 * @param flags   loadTileFlags() 的结果
 * @param firstGid Tiled tileset 的 firstgid，本插件地图为 1
 */
export function buildWalkGrid(
  tiled: { width?: number; height?: number; layers?: any[] } | null | undefined,
  flags: TileFlagTable,
  firstGid = 1,
): WalkGrid | null {
  if (!tiled || !Array.isArray(tiled.layers)) return null;
  const cols = Number(tiled.width) || 0;
  const rows = Number(tiled.height) || 0;
  if (!cols || !rows) return null;

  const blocked = new Uint8Array(cols * rows);
  const vision = new Uint8Array(cols * rows);
  const total = cols * rows;

  for (const layer of tiled.layers) {
    if (layer?.type !== "tilelayer") continue;
    const data = decodeLayerData(layer);
    if (!data) continue;
    const n = Math.min(data.length, total);
    for (let i = 0; i < n; i++) {
      const gid = data[i];
      if (!gid) continue;
      const id = gid - firstGid;
      if (id <= 1) continue; // 与 Rotten-Soup 的 `if (id > 1)` 保持一致
      const f = flags[id];
      if (!f) continue;
      if (f.blocked) blocked[i] = 1;
      if (f.vision) vision[i] = 1;
    }
  }

  let blockedCount = 0;
  let visionCount = 0;
  for (let i = 0; i < total; i++) {
    if (blocked[i]) blockedCount++;
    if (vision[i]) visionCount++;
  }

  const g: WalkGrid = { cols, rows, blocked, vision, firstGid, blockedCount, visionCount };
  console.info(
    `[field-survival] 碰撞网格已构建：${cols}×${rows}，` +
      `阻挡格 ${blockedCount}（${((blockedCount / total) * 100).toFixed(1)}%）、` +
      `挡视线格 ${visionCount}`,
  );
  return g;
}

/**
 * 取 tilelayer 的 data。支持三种 Tiled 导出：
 *   ① 明文数组（本插件绝大多数地图）
 *   ② base64 + "compression": "zlib"   （kingdom.json）
 *   ③ base64 + "compression": "gzip"
 * ②③ 走浏览器的 DecompressionStream（Chrome 80+/iOS 16.4+ 均可用）；
 * 不支持时返回 null（该层跳过，不会抛错）。
 */
function decodeLayerData(layer: any): number[] | null {
  const data = layer?.data;
  if (Array.isArray(data)) return data;
  if (typeof data !== "string" || layer?.encoding !== "base64") return null;
  try {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (layer?.compression === "zlib" || layer?.compression === "gzip") {
      // 同步路径：用 pako 风格的纯 JS 解压不可得，这里改由 ensureGridForLevel 预解压
      // —— 见 decodeBase64LayerAsync()。同步路径只处理明文数组。
      return null;
    }
    const out = new Array(bytes.length / 4);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < out.length; i++) out[i] = dv.getUint32(i * 4, true);
    return out;
  } catch {
    return null;
  }
}

/**
 * 异步版 tilelayer 解压（kingdom.json 这类 base64+zlib 地图走这里）。
 * 返回 null 表示无法解压 → 调用方应把该层当作"全可走"并 console.warn。
 */
async function decodeBase64LayerAsync(layer: any): Promise<number[] | null> {
  const data = layer?.data;
  if (Array.isArray(data)) return data;
  if (typeof data !== "string" || layer?.encoding !== "base64") return null;
  try {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    let raw: Uint8Array = bytes;
    const comp = layer?.compression;
    if (comp === "zlib" || comp === "gzip") {
      const DS = (globalThis as any).DecompressionStream;
      if (!DS) return null;
      const stream = new Blob([bytes]).stream().pipeThrough(new DS(comp === "gzip" ? "gzip" : "deflate"));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const n = Math.floor(raw.byteLength / 4);
    const out = new Array(n);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, true);
    return out;
  } catch {
    return null;
  }
}

/**
 * 异步构建（会先把 base64+zlib 的 tilelayer 解压成明文数组再交给 buildWalkGrid）。
 * App.vue 走这一个入口即可。
 */
export async function buildWalkGridAsync(
  tiled: { width?: number; height?: number; layers?: any[] } | null | undefined,
  flags: TileFlagTable,
  firstGid = 1,
): Promise<WalkGrid | null> {
  if (!tiled || !Array.isArray(tiled.layers)) return null;
  // 就地补齐 layer.data（只动 tilelayer 且 only-if-string），后续 buildWalkGrid 走同步路径
  for (const layer of tiled.layers) {
    if (layer?.type !== "tilelayer") continue;
    if (Array.isArray(layer.data)) continue;
    const decoded = await decodeBase64LayerAsync(layer);
    if (decoded) layer.data = decoded;
    else {
      console.warn(
        `[field-survival] tilelayer「${layer.name ?? "?"}」为 ${layer.encoding}+${layer.compression ?? "none"}，` +
          "当前环境无法解压 → 该层不参与碰撞",
      );
    }
  }
  return buildWalkGrid(tiled, flags, firstGid);
}

/* ============================================================
   3. 世界米 ↔ 格索引
   ============================================================ */

export function metersToCell(g: WalkGrid, mx: number, mz: number): { gx: number; gz: number } {
  return {
    gx: Math.floor(mx + g.cols / 2),
    gz: Math.floor(mz + g.rows / 2),
  };
}

/** 该格是否不可通行；越界一律视为"挡"（与 GameMap.inbounds + blocked 的组合语义一致） */
export function isBlockedCell(g: WalkGrid, gx: number, gz: number): boolean {
  if (gx < 0 || gx >= g.cols || gz < 0 || gz >= g.rows) return true;
  return g.blocked[gz * g.cols + gx] === 1;
}

/** 该格是否挡视线；越界视为挡（FOV 用） */
export function isVisionBlockedCell(g: WalkGrid, gx: number, gz: number): boolean {
  if (gx < 0 || gx >= g.cols || gz < 0 || gz >= g.rows) return true;
  return g.vision[gz * g.cols + gx] === 1;
}

/** 某点的米坐标是否落在不可通行格上 */
export function isBlockedMeters(g: WalkGrid, mx: number, mz: number): boolean {
  const { gx, gz } = metersToCell(g, mx, mz);
  return isBlockedCell(g, gx, gz);
}

/**
 * 以 (mx, mz) 为中心、半径 r 的方形内是否全部可通行。
 * r = 0 时退化为"该点在不在可走格"。玩家半径取 0.4 米（沿用 App.vue 原 PLAYER_R）。
 */
export function isFreeAround(g: WalkGrid, mx: number, mz: number, r: number): boolean {
  if (r <= 0) return !isBlockedMeters(g, mx, mz);
  return (
    !isBlockedMeters(g, mx - r, mz - r) &&
    !isBlockedMeters(g, mx + r, mz - r) &&
    !isBlockedMeters(g, mx - r, mz + r) &&
    !isBlockedMeters(g, mx + r, mz + r)
  );
}

/* ============================================================
   4. 移动求解（分轴，可沿墙滑行）
   ============================================================ */

export interface MoveResult {
  x: number;
  z: number;
  /** X 轴被挡 */
  hitX: boolean;
  /** Z 轴被挡 */
  hitZ: boolean;
}

/**
 * 分轴求解一次位移 —— 与 Rotten-Soup 的 tryMove 同思路（挡就不动），
 * 但因为是连续坐标，拆成 X / Z 两轴独立判定，好处是撞墙后仍能沿墙滑行
 * （贴着墙面斜向走不会卡住，手感与格子回合制等价）。
 *
 * ★ 自解困：若当前位置本身已在阻挡格里（例如旧存档 / 关卡切换落到墙里），
 *   直接放行本次位移，避免"出生在墙里 → 永远出不来"。这一条是 Rotten-Soup
 *   没有的（它是回合制格子制，不会出现半格卡住），连续坐标下必须有。
 *
 * @param g       WalkGrid
 * @param x, z    当前米坐标
 * @param nx, nz  目标米坐标（本帧位移，通常 ≤ 0.3 米）
 * @param r       碰撞半径（米）
 */
export function resolveMove(
  g: WalkGrid,
  x: number,
  z: number,
  nx: number,
  nz: number,
  r: number,
): MoveResult {
  // 自解困：起点已在墙里 → 不阻挡，让玩家走出来
  if (!isFreeAround(g, x, z, r)) {
    return { x: nx, z: nz, hitX: false, hitZ: false };
  }
  let outX = x;
  let outZ = z;
  // 先 X（用旧 Z），再 Z（用已确定的 X）→ 两轴各自独立，撞墙可滑行
  if (isFreeAround(g, nx, z, r)) outX = nx;
  if (isFreeAround(g, outX, nz, r)) outZ = nz;
  return { x: outX, z: outZ, hitX: outX !== nx, hitZ: outZ !== nz };
}

/**
 * 从 (mx, mz) 起做环形 BFS，找最近的"四角都可走"的米坐标。
 * 用途：关卡切换时把玩家从墙里/图外挪到最近可站点（mulberryForest / oldForest /
 * oldGraveyard 的地图中心恰好是墙 —— 见 README 的验证结论）。
 *
 * @param maxRingCells 最大搜索半径（格），默认 40
 * @returns 找到的可走米坐标；搜不到则返回 null（调用方保留原坐标）
 */
export function nearestFreeMeters(
  g: WalkGrid,
  mx: number,
  mz: number,
  r: number,
  maxRingCells = 40,
): { x: number; z: number } | null {
  const start = metersToCell(g, mx, mz);
  // 格中心 → 米：gx 格的左边界是 gx - cols/2，中心 +0.5
  const cellCenter = (gx: number, gz: number) => ({
    x: gx - g.cols / 2 + 0.5,
    z: gz - g.rows / 2 + 0.5,
  });
  const test = (gx: number, gz: number) => {
    const c = cellCenter(gx, gz);
    return isFreeAround(g, c.x, c.z, r);
  };
  if (test(start.gx, start.gz)) return { x: mx, z: mz }; // 原位置就能站，保持不动

  for (let ring = 1; ring <= maxRingCells; ring++) {
    // 按"环上曼哈顿顺序"扫；先返回的即最接近的（对角顺序略有偏差，可接受）
    for (let d = -ring; d <= ring; d++) {
      const cand: Array<[number, number]> = [
        [start.gx + d, start.gz - ring],
        [start.gx + d, start.gz + ring],
        [start.gx - ring, start.gz + d],
        [start.gx + ring, start.gz + d],
      ];
      for (const [gx, gz] of cand) {
        if (test(gx, gz)) return cellCenter(gx, gz);
      }
    }
  }
  return null;
}

/* ============================================================
   4b. 连通域索引（出生点安全化的前提）
   ------------------------------------------------------------
   为什么需要：只把玩家挪到"最近的可走格"是不够的。实测 mulberryForest 的
   地图中心旁边确实有一小块可走区域，但它是一个只有 4 格的**封闭口袋** ——
   玩家进图后能动、却永远走不出去（离线仿真：6000 tick 随机游走只经过 4 格）。
   所以落点必须落在"主连通域"里。
   ============================================================ */

export interface WalkIndex {
  /** 半径 */
  radius: number;
  /** cols×rows，1 = 玩家中心站得下（四角都可走） */
  standable: Uint8Array;
  /** cols×rows，连通域标签；0 = 不可站 */
  label: Int32Array;
  /** 每个标签对应的格数，下标 = 标签 */
  sizes: number[];
  /** 最大连通域的标签（无任何可站格时为 0） */
  largest: number;
}

/**
 * 对 WalkGrid 做一次预处理：标出"站得下"的格，并按 4-邻接求连通域。
 * 复杂度 O(cols×rows)，地图最大 3600 格，可忽略；结果由调用方缓存。
 */
export function buildWalkIndex(g: WalkGrid, radius: number): WalkIndex {
  const total = g.cols * g.rows;
  const standable = new Uint8Array(total);
  const center = (i: number) => {
    const gx = i % g.cols;
    const gz = Math.floor(i / g.cols);
    return { x: gx - g.cols / 2 + 0.5, z: gz - g.rows / 2 + 0.5 };
  };
  for (let i = 0; i < total; i++) {
    const c = center(i);
    if (isFreeAround(g, c.x, c.z, radius)) standable[i] = 1;
  }

  const label = new Int32Array(total);
  const sizes: number[] = [0]; // 下标 0 保留给"不可站"
  let next = 1;
  const stack: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!standable[i] || label[i]) continue;
    const id = next++;
    let count = 0;
    stack.length = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const cur = stack.pop()!;
      count++;
      const gx = cur % g.cols;
      const gz = Math.floor(cur / g.cols);
      // 4-邻接：与玩家的实际移动一致（分轴位移不能穿墙角）
      const push = (ni: number) => {
        if (standable[ni] && !label[ni]) {
          label[ni] = id;
          stack.push(ni);
        }
      };
      if (gx > 0) push(cur - 1);
      if (gx < g.cols - 1) push(cur + 1);
      if (gz > 0) push(cur - g.cols);
      if (gz < g.rows - 1) push(cur + g.cols);
    }
    sizes.push(count);
  }

  let largest = 0;
  for (let id = 1; id < sizes.length; id++) if (sizes[id] > (sizes[largest] ?? -1)) largest = id;
  return { radius, standable, label, sizes, largest };
}

/** 格索引 → 格中心米坐标 */
export function cellToMeters(g: WalkGrid, gx: number, gz: number): { x: number; z: number } {
  return { x: gx - g.cols / 2 + 0.5, z: gz - g.rows / 2 + 0.5 };
}

/**
 * 把米坐标吸附到所在格的**中心**。
 *
 * ★ 为什么必须做这一步：Tiled 对象坐标转世界米的公式（mapConfig.normalizeTiledMap）
 *   是 `obj.x/32 - W/2`，得到的是该格的**左边界**，不是中心。于是
 *   mulberryTown 的 PLAYER 换算成 (12.5, 4.0)，正好落在格边界上；
 *   玩家半径 0.4 米时会同时压在相邻两列的格上，只要隔壁是墙
 *   → isFreeAround 判定失败 → 玩家出生即"半身入墙"。
 *   吸附到格中心后，站得下/连通域这些结论（都按格中心算）才与实际位姿一致。
 *
 * 副作用：位移 < 1 米（半格），肉眼不可见，但让碰撞判定自洽。
 */
export function snapToCellCenter(g: WalkGrid, mx: number, mz: number): { x: number; z: number } {
  const c = metersToCell(g, mx, mz);
  return cellToMeters(g, c.gx, c.gz);
}

/**
 * 在指定连通域里，找离 (mx, mz) 最近的"站得下"格中心。
 * @param label  目标连通域标签；省略则用最大连通域
 * @param accept 额外过滤（例如"必须离传送门 ≥ N 米"），不满足则继续往外找
 * @returns 米坐标；该连通域不存在时返回 null
 */
export function nearestStandableInComponent(
  g: WalkGrid,
  idx: WalkIndex,
  mx: number,
  mz: number,
  label?: number,
  accept?: (x: number, z: number) => boolean,
): { x: number; z: number } | null {
  const want = label ?? idx.largest;
  if (!want || want >= idx.sizes.length || idx.sizes[want] === 0) return null;
  const start = metersToCell(g, mx, mz);
  const hit = (gx: number, gz: number): { x: number; z: number } | null => {
    if (gx < 0 || gx >= g.cols || gz < 0 || gz >= g.rows) return null;
    if (idx.label[gz * g.cols + gx] !== want) return null;
    const c = cellToMeters(g, gx, gz);
    if (accept && !accept(c.x, c.z)) return null;
    return c;
  };
  const direct = hit(start.gx, start.gz);
  if (direct) return direct;
  for (let ring = 1; ring <= Math.max(g.cols, g.rows); ring++) {
    for (let d = -ring; d <= ring; d++) {
      const cand: Array<[number, number]> = [
        [start.gx + d, start.gz - ring],
        [start.gx + d, start.gz + ring],
        [start.gx - ring, start.gz + d],
        [start.gx + ring, start.gz + d],
      ];
      for (const [gx, gz] of cand) {
        const r = hit(gx, gz);
        if (r) return r;
      }
    }
  }
  return null;
}

/** 某米坐标是否落在"主连通域"的站得下格上 */
export function isInMainComponent(g: WalkGrid, idx: WalkIndex, mx: number, mz: number): boolean {
  const c = metersToCell(g, mx, mz);
  if (c.gx < 0 || c.gx >= g.cols || c.gz < 0 || c.gz >= g.rows) return false;
  return idx.label[c.gz * g.cols + c.gx] === idx.largest;
}

/** 到 avoid 里最近一个点的距离；avoid 为空 → Infinity */
export function nearestAvoidDist(
  avoid: ReadonlyArray<{ x: number; z: number }> | undefined,
  mx: number,
  mz: number,
): number {
  if (!avoid || avoid.length === 0) return Infinity;
  let best = Infinity;
  for (const p of avoid) {
    const d = Math.hypot(p.x - mx, p.z - mz);
    if (d < best) best = d;
  }
  return best;
}

/** 落点约束：avoid 里的点（典型是 portal / 切图触发点）必须保持 ≥ clearance 米 */
export interface SpawnConstraints {
  avoid?: ReadonlyArray<{ x: number; z: number }>;
  clearance?: number;
}

/** pickSpawn 的结果 */
export interface SpawnPick {
  x: number;
  z: number;
  /** 是否发生了位移（false = 原坐标本身就可用，只做了格中心吸附） */
  relocated: boolean;
  /** 最终落点是否满足净空约束（false = 净空无解，退化为只保连通域） */
  clearanceOk: boolean;
  /** 最终落点到最近 avoid 点的距离（无 avoid 时为 Infinity） */
  avoidDist: number;
}

/**
 * 选一个可用落点 —— 关卡进入/切换时的"落点安全化"策略（**唯一真相源**，
 * App.vue 的 settleSpawn 与 onMounted 初始化都调它，避免两处规则漂移）。
 *
 * 规则（按优先级）：
 *   ① 原坐标吸附到格中心后，若在主连通域且满足净空 → 原样返回（relocated:false）
 *   ② 主连通域内离原坐标最近、且满足净空的站得下格
 *   ③ 主连通域内离原坐标最近的站得下格（**放弃净空**，仅用于极小图无解时兜底）
 *   ④ 全失败 → 返回吸附后的原坐标（不返回 null；此时调用方的"自解困"会放行移动）
 *
 * ★ 为什么必须做连通域过滤：仿真发现 mulberryForest 的地图中心旁有一个
 *   **仅 4 格的封闭口袋**，只按"最近可走格"落点会让玩家 6000 tick 只走过 4 格。
 * ★ 为什么必须做净空：mulberryForest / mulberryGraveyard / lichLair 的地图标注
 *   PLAYER 离切图触发点只有 1.00 米，而触发半径 2.5 米 → 一进图就反复切图。
 *   注意连通域过滤解决不了这个问题（那些点确实在主连通域里）。
 */
export function pickSpawn(
  g: WalkGrid,
  idx: WalkIndex,
  mx: number,
  mz: number,
  constraints?: SpawnConstraints,
): SpawnPick {
  const base = snapToCellCenter(g, mx, mz);
  const avoid = constraints?.avoid;
  const clearance = constraints?.clearance ?? 0;
  const ok = (x: number, z: number) => nearestAvoidDist(avoid, x, z) >= clearance;
  const ret = (x: number, z: number, relocated: boolean): SpawnPick => ({
    x,
    z,
    relocated,
    clearanceOk: ok(x, z),
    avoidDist: nearestAvoidDist(avoid, x, z),
  });

  // ① 原坐标可用
  if (isInMainComponent(g, idx, base.x, base.z) && ok(base.x, base.z)) {
    return ret(base.x, base.z, false);
  }

  // ② 优先满足净空；③ 退化为只保连通域
  const free =
    (clearance > 0 ? nearestStandableInComponent(g, idx, base.x, base.z, undefined, ok) : null) ??
    nearestStandableInComponent(g, idx, base.x, base.z);
  if (!free) return ret(base.x, base.z, false); // ④ 网格全是墙 → 保持原位

  return ret(free.x, free.z, free.x !== base.x || free.z !== base.z);
}

/* ============================================================
   5. 调试辅助
   ============================================================ */

/** 网格 → ASCII（'#' = 挡人；'·' = 可走；'x' = 越界） */
export function gridToAscii(g: WalkGrid): string {
  const lines: string[] = [];
  for (let gz = 0; gz < g.rows; gz++) {
    let s = "";
    for (let gx = 0; gx < g.cols; gx++) s += g.blocked[gz * g.cols + gx] ? "#" : "·";
    lines.push(s);
  }
  return lines.join("\n");
}

export function gridStats(g: WalkGrid): string {
  const total = g.cols * g.rows;
  return (
    `${g.cols}×${g.rows} 共 ${total} 格；` +
    `阻挡 ${g.blockedCount}（${((g.blockedCount / total) * 100).toFixed(1)}%）、` +
    `挡视线 ${g.visionCount}`
  );
}

/* ============================================================
   6. 视野（FOV）—— 对齐 Rotten-Soup 的 Tile.visible() + ROT.FOV
   ------------------------------------------------------------
   阻塞判定与 Rotten-Soup 的 `Tile.visible()` 完全一致，都来自
   tileset 的 `blocks_vision` 属性（本文件压到 `g.vision` 位图）。

   ★ 为什么用 shadowcasting 而不是"圆形可见"：
     圆形可见会让玩家隔着墙看见墙后的怪，且拐角处会"透墙"。

   ★ 移植自 ROT 的 RecursiveShadowcasting（Rotten-Soup 的
     `Player.js` / `HelperFunctions.js` 用的就是它）。移植时有两个
     极易踩的坑，都会表现为"光贴着厚墙表面渗透进墙后的空地"：
       ① 进入遮挡时**不能**改 start，只能记「最后遮挡斜率」；
          恢复通畅时才用它收紧 start。若在进入遮挡时就收紧，
          start 会随行号以 0.5/(j+0.5) 缓慢递减，每行恰好挤进两格。
       ② 行末若仍处于遮挡，必须 break 终止整个 octant。
     两处都对齐 ROT 后，玩家 (16,14) 左侧那道 9 格厚墙后面的
     (5,13)/(5,14) 不再被点亮（见 tmp_verify.mjs E 段）。
   ============================================================ */

/**
 * 以 (mx, mz) 为中心、半径 radius 米的可见格掩码（1 = 可见）。
 * 阻挡来自 g.vision（与 Rotten-Soup 的 blocks_vision 一致）；起点格永远可见。
 */
export function computeFov(g: WalkGrid, mx: number, mz: number, radius: number): Uint8Array {
  const total = g.cols * g.rows;
  const vis = new Uint8Array(total);
  const c0 = metersToCell(g, mx, mz);
  const mark = (gx: number, gz: number) => {
    if (gx < 0 || gx >= g.cols || gz < 0 || gz >= g.rows) return;
    vis[gz * g.cols + gx] = 1;
  };
  const blocks = (gx: number, gz: number) => isVisionBlockedCell(g, gx, gz);
  // ★ ROT 的 `_renderOctant` 会把半径 +1 再传进 `_castVisibility`
  //   （rot.js v0.7：`this._castVisibility(x, y, 1, 1.0, 0.0, radius + 1, ...)`），
  //   且这个值同时用作 for 上界与 `i < radius` 的递归条件。这里照抄 ——
  //   否则最外圈会少一层（实测 23 张图共少标 703 格，与官方实现对拍不齐）。
  const R = Math.max(1, Math.round(radius)) + 1;
  const cx = c0.gx;
  const cz = c0.gz;
  mark(cx, cz);

  // 8 个八分圆（xx, xy, yx, yy）—— 与 ROT.FOV.RecursiveShadowcasting 的 octants 一致
  const octants: Array<[number, number, number, number]> = [
    [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
    [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
  ];

  const cast = (
    row: number, start: number, end: number,
    xx: number, xy: number, yx: number, yy: number,
  ): void => {
    if (start < end) return;
    for (let j = row; j <= R; j++) {
      let dx = -j - 1;
      const dy = -j;
      let blocked = false;
      /** 本行内「最近一个遮挡格」的右斜率；恢复通畅时用它当新的 start。
       *  ★ 必须与 `blocked` 一样每行重置 —— 见下方注释。 */
      let lastBlockR = 0;
      while (dx <= 0) {
        dx += 1;
        const X = cx + dx * xx + dy * xy;
        const Y = cz + dx * yx + dy * yy;
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (rSlope > start) continue;
        if (lSlope < end) break;
        if (dx * dx + dy * dy < R * R) mark(X, Y);
        if (blocked) {
          if (blocks(X, Y)) {
            lastBlockR = rSlope;      // 仍被遮挡：只更新「最后遮挡斜率」
          } else {
            blocked = false;
            start = lastBlockR;       // ★ 恢复通畅：start 收到「最后遮挡斜率」
          }                           //   （不是当前格的 rSlope —— 那会每行漏 2 格）
        } else if (blocks(X, Y) && j < R) {
          blocked = true;
          cast(j + 1, start, lSlope, xx, xy, yx, yy);   // 递归用「收紧前」的 start
          lastBlockR = rSlope;        // ★ 进入遮挡时只记斜率，不动 start
        }
      }
      // ★ 本行结束时仍在遮挡中 → 该方向的 45° 扇区已被墙封死，
      //   更远的行必然也被封死，直接终止整个 octant。
      //   漏掉这一行会让光锥贴着厚墙表面一路「渗透」到视野尽头。
      if (blocked) break;
    }
  };

  for (const [xx, xy, yx, yy] of octants) cast(1, 1.0, 0.0, xx, xy, yx, yy);
  return vis;
}

/* ============================================================
   7. 寻路（A*）—— 替代"朝目标直走、撞墙就放弃"
   ------------------------------------------------------------
   Rotten-Soup 玩家用 `ROT.Path.AStar`，阻塞判定 `!tile.blocked()`。
   本实现同源，但走的是"站得下"掩码（四角都能走），并禁止斜穿墙角
   （两条正交边都可走才允许斜走）—— 因为玩家的移动是分轴求解的，
   允许斜穿会让寻路给出实际走不出来的路径。

   ★ 地图最大 60×60 = 3600 格，A* 全展开也不到 1ms；
     仍设 maxNodes 上限兜底，防止未来的超大图卡帧。
   ============================================================ */

export interface PathOptions {
  /** 最多展开的节点数（默认 6000） */
  maxNodes?: number;
  /** 允许斜走（默认 true；禁止斜穿墙角） */
  diagonal?: boolean;
}

/**
 * 在站得下格上做 A*。返回从起点之后开始的路点（格中心米坐标），
 * 已做视线拉直（string pulling）；无解返回 null。
 *
 * 目标格站不下时（例如玩家点了墙）自动换到主连通域内最近的可站格。
 */
export function findPath(
  g: WalkGrid,
  idx: WalkIndex,
  sx: number,
  sz: number,
  tx: number,
  tz: number,
  opts: PathOptions = {},
): { x: number; z: number }[] | null {
  const diagonal = opts.diagonal !== false;
  const maxNodes = opts.maxNodes ?? 6000;
  const a = metersToCell(g, sx, sz);
  let b = metersToCell(g, tx, tz);
  const at = (gx: number, gz: number) =>
    gx >= 0 && gx < g.cols && gz >= 0 && gz < g.rows && idx.standable[gz * g.cols + gx] === 1;

  // 目标不可站 → 退回主连通域里离它最近的站得下格（"点了墙也要走过去"）
  if (!at(b.gx, b.gz)) {
    const near = nearestStandableInComponent(g, idx, tx, tz);
    if (!near) return null;
    b = metersToCell(g, near.x, near.z);
  }
  // 起点不可站 → 同样退让（自解困：让角色先走出墙）
  if (!at(a.gx, a.gz)) {
    const near = nearestStandableInComponent(g, idx, sx, sz);
    if (!near) return null;
    const na = metersToCell(g, near.x, near.z);
    if (!at(na.gx, na.gz)) return null;
    return findPath(g, idx, near.x, near.z, tx, tz, opts);
  }
  if (a.gx === b.gx && a.gz === b.gz) return [];

  const cols = g.cols;
  const total = cols * g.rows;
  const gScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const startIdx = a.gz * cols + a.gx;
  const goalIdx = b.gz * cols + b.gx;
  gScore[startIdx] = 0;

  // 简易二叉堆（避免引入依赖）
  const heap: number[] = [];
  const prio: number[] = [];
  const push = (i: number, p: number) => {
    heap.push(i); prio.push(p);
    let c = heap.length - 1;
    while (c > 0) {
      const p2 = (c - 1) >> 1;
      if (prio[p2] <= prio[c]) break;
      [heap[p2], heap[c]] = [heap[c], heap[p2]];
      [prio[p2], prio[c]] = [prio[c], prio[p2]];
      c = p2;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const lastI = heap.pop()!;
    const lastP = prio.pop()!;
    if (heap.length) {
      heap[0] = lastI; prio[0] = lastP;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < heap.length && prio[l] < prio[m]) m = l;
        if (r < heap.length && prio[r] < prio[m]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        [prio[m], prio[c]] = [prio[c], prio[m]];
        c = m;
      }
    }
    return top;
  };

  const hx = Math.abs(b.gx - a.gx);
  const hz = Math.abs(b.gz - a.gz);
  const heur = (i: number): number => {
    const gx = i % cols;
    const gz = (i / cols) | 0;
    const dx = Math.abs(gx - b.gx);
    const dz = Math.abs(gz - b.gz);
    // octile 距离（与允许斜走时的真实代价一致 → 启发式可采纳）
    if (!diagonal) return dx + dz;
    return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  push(startIdx, heur(startIdx));

  const DIRS4: Array<[number, number, number]> = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
  const DIRS8: Array<[number, number, number]> = [
    ...DIRS4,
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  const DIRS = diagonal ? DIRS8 : DIRS4;

  let expanded = 0;
  let found = false;
  while (heap.length) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) { found = true; break; }
    if (++expanded > maxNodes) break;
    const gx = cur % cols;
    const gz = (cur / cols) | 0;
    for (const [ox, oz, cost] of DIRS) {
      const nx = gx + ox;
      const nz = gz + oz;
      if (!at(nx, nz)) continue;
      // 禁止斜穿墙角：两条正交邻格都必须能站
      if (ox !== 0 && oz !== 0 && (!at(gx + ox, gz) || !at(gx, gz + oz))) continue;
      const ni = nz * cols + nx;
      if (closed[ni]) continue;
      const ng = gScore[cur] + cost;
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        cameFrom[ni] = cur;
        push(ni, ng + heur(ni));
      }
    }
  }
  if (!found) return null;

  // 回溯 → 格路径（含起点）
  const cells: number[] = [];
  for (let i = goalIdx; i !== -1; i = cameFrom[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map((i) => cellToMeters(g, i % cols, (i / cols) | 0));
  return simplifyPath(g, pts, 0.4).slice(1);
}

/**
 * 视线拉直：能直连就跳过中间点（把格子锯齿路径变成直段）。
 * 采样步长 0.25 米，用 isFreeAround 判定。
 */
export function simplifyPath(
  g: WalkGrid,
  pts: Array<{ x: number; z: number }>,
  r: number,
): Array<{ x: number; z: number }> {
  if (pts.length <= 2) return pts.slice();
  const clear = (a: { x: number; z: number }, b: { x: number; z: number }): boolean => {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / 0.25));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!isFreeAround(g, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r)) return false;
    }
    return true;
  };
  const out: Array<{ x: number; z: number }> = [pts[0]];
  let anchor = 0;
  for (let i = 2; i < pts.length; i++) {
    if (!clear(pts[anchor], pts[i])) {
      out.push(pts[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ============================================================
   8. 局部避障（给敌人用）
   ------------------------------------------------------------
   敌人不做 A*（60 只怪每 tick 一次 A* 开销过大），改成：
   直接朝目标走 → 被挡住就按"与期望方向最接近"的顺序试其余 7 个方向。
   效果是沿墙绕行而不是贴着墙原地抖，成本恒定 O(8)。
   ============================================================ */

export interface AvoidResult {
  x: number;
  z: number;
  /** 是否发生了方向偏折（用于敌人 AI 决定要不要降低前进速度） */
  detoured: boolean;
  /** 完全无路可走 */
  stuck: boolean;
}

const AVOID_DIRS: Array<[number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * 带局部避障的一步位移。
 * @param dirX,dirZ 期望方向（不必归一化）
 * @param step      本步长度（米）
 */
export function stepWithAvoidance(
  g: WalkGrid,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  step: number,
  r: number,
): AvoidResult {
  const len = Math.hypot(dirX, dirZ);
  if (!(len > 1e-6)) return { x, z, detoured: false, stuck: true };
  const ux = dirX / len;
  const uz = dirZ / len;

  // 期望方向优先，其余按方向相似度（点积）排序
  const cands = AVOID_DIRS
    .map(([dx, dz]) => {
      const l2 = Math.hypot(dx, dz);
      const nx2 = dx / l2;
      const nz2 = dz / l2;
      return { nx: nx2, nz: nz2, dot: nx2 * ux + nz2 * uz };
    })
    .filter((c) => c.dot > -0.35)              // 不往回走
    .sort((a, b) => b.dot - a.dot);

  for (const c of cands) {
    const nx = x + c.nx * step;
    const nz = z + c.nz * step;
    if (isFreeAround(g, nx, nz, r)) {
      // ★ detoured 的语义是「因墙被迫放弃首选方向」，而不是「方向与期望不完全对齐」。
      //   只有 8 个离散候选，任意角度期望方向的最优点积也只有 cos(22.5°)≈0.924，
      //   用 `dot < 0.999` 判定会让近乎每一步都算偏折（实测 98%，毫无信息量）。
      return { x: nx, z: nz, detoured: c !== cands[0], stuck: false };
    }
  }
  // 全被挡 → 退化为分轴滑行（能贴墙蹭出去）
  const res = resolveMove(g, x, z, x + ux * step, z + uz * step, r);
  const moved = Math.abs(res.x - x) > 1e-6 || Math.abs(res.z - z) > 1e-6;
  return { x: res.x, z: res.z, detoured: moved, stuck: !moved };
}

/* ============================================================
   9. 网格传输（前端算一次 → 传给宿主）
   ------------------------------------------------------------
   敌人位姿由宿主推进（entry.ts / entry.js / mockHost.ts），
   而 tileset 属性表 + 地图 JSON 只在 iframe 侧解过。
   与其让宿主各自重复实现一遍解析（三份代码、三处漂移），
   不如把压缩后的位图随 tick 上报一次（按关卡名做世代号）。

   体积：60×40 的图 = 2400 字节/层，base64 后 3.2KB，两层 6.4KB；
   只在切图那一次发送，稳态零开销。
   ============================================================ */

export interface WalkGridPacket {
  v: 1;
  cols: number;
  rows: number;
  firstGid: number;
  /** base64(blocked 位图) */
  blocked: string;
  /** base64(vision 位图) */
  vision: string;
}

function bytesToBase64(arr: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < arr.length; i += CH) {
    s += String.fromCharCode.apply(null, Array.from(arr.subarray(i, i + CH)) as unknown as number[]);
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeWalkGridPacket(g: WalkGrid): WalkGridPacket {
  return {
    v: 1,
    cols: g.cols,
    rows: g.rows,
    firstGid: g.firstGid,
    blocked: bytesToBase64(g.blocked),
    vision: bytesToBase64(g.vision),
  };
}

/** 解析上报的网格包；格式不对 / 长度不符 → null（宿主降级为"无碰撞"） */
export function decodeWalkGridPacket(pkt: unknown): WalkGrid | null {
  const p = pkt as WalkGridPacket | null | undefined;
  if (!p || p.v !== 1) return null;
  const cols = Number(p.cols);
  const rows = Number(p.rows);
  if (!(cols > 0) || !(rows > 0) || cols * rows > 4_000_000) return null;
  try {
    const blocked = base64ToBytes(String(p.blocked));
    const vision = base64ToBytes(String(p.vision));
    if (blocked.length !== cols * rows || vision.length !== cols * rows) return null;
    let blockedCount = 0;
    let visionCount = 0;
    for (let i = 0; i < blocked.length; i++) if (blocked[i]) blockedCount++;
    for (let i = 0; i < vision.length; i++) if (vision[i]) visionCount++;
    return { cols, rows, blocked, vision, firstGid: Number(p.firstGid) || 1, blockedCount, visionCount };
  } catch {
    return null;
  }
}

/**
 * 宿主侧：把 (mx, mz) 夹进网格范围内并吸附到最近的"站得下"格。
 * 敌人刷点来自 Tiled 对象坐标，换算后可能正好压在半墙上 —— 不吸附会一直卡着。
 * 找不到就返回 null（调用方保留原坐标）。
 */
export function snapEnemySpawn(
  g: WalkGrid,
  mx: number,
  mz: number,
  r: number,
): { x: number; z: number } | null {
  if (isFreeAround(g, mx, mz, r)) return { x: mx, z: mz };
  return nearestFreeMeters(g, mx, mz, r, 8);
}
