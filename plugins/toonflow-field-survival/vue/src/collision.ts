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
