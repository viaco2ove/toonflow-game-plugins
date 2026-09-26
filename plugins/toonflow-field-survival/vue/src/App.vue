<script setup lang="ts">
/**
 * 野外生存 —— 2.5D 动作生存（全屏）
 *
 * 阶段：select（选人）→ playing（全屏战斗）→ over（结算）
 * 实时推进通过宿主代发 /plugin/tick（见 bridge.sendTick）。
 *
 * 世界数据模型（与 25d_ai_game / map_config.json 一致）：
 *   - 整个游戏地图 3000×3000 米，origin (0,0)，X/Z 范围 ±1500
 *   - 单个土块 0.5 米；一个 chunk = 32 块 = 16 米
 *   - 默认 zoom = 20，相机看到 ±15 米（30×30 米窗口）
 *   - zoom ∈ [10, 30]：zoom 越大 → 视野越小（放大看脚下）
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { onHostState, sendToHost, sendTick, notifyLoaded } from "./bridge";
import { toonflowJsApi } from "./toonflowJsApi";
import type { GameState, Entity, RoleOption, MapData } from "./types";
import DebugPanel from "./DebugPanel.vue";
import {
  TILESET_URL, TILESET_COLS, TILE_SIZE, tileSrcRect, assetUrl, mobKeyFor,
  TILE_WATER_ID, TILE_POTION_ID,
  TILE_TREE_ID, TILE_DEADTREE_ID, TILE_CHEST_ID, TILE_CHEST_OPEN_ID,
  TILE_SHRUB_ID, TILE_MUSHROOM_ID, TILE_FLOWER_ID,
  TILE_GRASS_MAIN_ID,
  TILE_DIRT_MAIN_ID,
  TILE_HOUSE_ROOF_LEFT_ID, TILE_HOUSE_ROOF_MID_ID, TILE_HOUSE_ROOF_RIGHT_ID,
  TILE_HOUSE_TOP_LEFT_ID, TILE_HOUSE_TOP_MID_ID, TILE_HOUSE_TOP_RIGHT_ID,
  TILE_HOUSE_BOTTOM_ID, TILE_HOUSE_DOOR_ID, TILE_HOUSE_WINDOW_ID, TILE_HOUSE_WINDOW_RIGHT_ID,
  TILE_DIALOG_BUBBLE_ID, TILE_FENCE_POST_ID, TILE_FENCE_RAIL_ID,
  TILE_FARM_DIRT_ID, TILE_FARM_GREEN_ID, TILE_FARM_TOP_ID,
  GROUND_CELL_M, GROUND_BIOME_SCALE_M, GROUND_TONE_SCALE_M,
  GROUND_SAND_MAX, GROUND_DIRT_MAX, GROUND_TONE_SPLIT,
  GROUND_GRASS_TILES, GROUND_DIRT_TILES, GROUND_SAND_TILES,
  MOB_TILES, IMG_PLAYER, IMG_ALLY, IMG_ENEMY_CHAR,
  spriteTileId, resolveAssetPath,
} from "./assets";
import {
  TerrainScaleConfig, DEFAULT_SCALE,
} from "./terrainScale";
import { ChunkTerrainSystem } from "./chunkTerrain";
import { loadMapConfig, makeScaleFromMap } from "./mapConfig";
import type { MapConfig } from "./mapConfig";

const state = ref<GameState | null>(null);
const ready = ref(false);

/**
 * Debug 模式：
 *   - npm run dev  → 默认开启（Vite 启动时 import.meta.env.DEV = true）
 *   - npm run debug→ 强制开启（mode=debug）
 *   - npm run build→ 关闭（import.meta.env.PROD = true）
 *   也可通过 URL ?debug=0 强制关闭
 */
const debugMode = ref(
  (import.meta.env.DEV || import.meta.env.MODE === "debug") &&
  new URLSearchParams(location.search).get("debug") !== "0",
);

/** debug 面板选中的实体（用于在 canvas 上画高亮框）*/
const selectedEntityId = ref<string | null>(null);
function onSelectEntity(e: Entity | null) {
  selectedEntityId.value = e?.id || null;
}

/**
 * 🔄 横竖屏切换：false=横屏(960×372), true=竖屏(旋转90°用372×960显示)
 * */
const isRotated = ref(false);
/**
 * 屏幕元素是否旋转90 度
 */
const  isStageRotateOn =ref(false);

/** 地图主题（开局后从 state.map 取；也演示 toonflowJsApi 从插件数据表读 map_data） */
const mapTheme = ref("");
const mapZones = computed(() => state.value?.map?.zones || []);
const mapSourceLabel = computed(() => {
  const s = state.value?.mapSource;
  return s === "agent" ? "AI 地图" : s === "stored" ? "缓存地图" : s === "fallback" ? "默认地图" : "";
});

/* ---------------- 选人 ---------------- */
const participants = ref<string[]>([]);
const spectators = ref<string[]>([]);
const enemies = ref<string[]>([]);

// 头像缓存（entityId -> HTMLImageElement）
const avatarCache = new Map<string, HTMLImageElement>();

function loadAvatar(avatarPath: string): HTMLImageElement {
  const cached = avatarCache.get(avatarPath);
  if (cached) return cached;
  const img = new Image();
  // ★ 头像路径解析：
  //   http(s) → 完整 URL（AI 故事角色头像）
  //   ./ 开头 → 插件自身资源（走 assetUrl：dev=Vite，prod=data URL）
  //   / 开头 → 宿主站内资源（补 origin）
  //   其他    → 当作相对路径走 assetUrl
  if (avatarPath.startsWith("http")) {
    img.src = avatarPath;
  } else if (avatarPath.startsWith("./")) {
    img.src = assetUrl(avatarPath.slice(2));
  } else if (avatarPath.startsWith("/")) {
    img.src = location.origin + avatarPath;
  } else {
    img.src = assetUrl(avatarPath);
  }
  avatarCache.set(avatarPath, img);
  return img;
}

function getEntityAvatar(e: Entity): HTMLImageElement | undefined {
  // 优先用 entity 上的 avatarPath
  if (e.avatarPath) return loadAvatar(e.avatarPath);
  // 否则从 roles 里找
  const role = roles.value.find((r) => r.id === e.id);
  if (role?.avatarPath) return loadAvatar(role.avatarPath);
  return undefined;
}

/** 取实体的头像路径（与 getEntityAvatar 同源，供动图解码使用） */
function entityAvatarPath(e: Entity): string | undefined {
  if (e.avatarPath) return e.avatarPath;
  const role = roles.value.find((r) => r.id === e.id);
  return role?.avatarPath || undefined;
}

/** 与 loadAvatar 完全一致的路径解析（http / ./ / 站内绝对路径 / 相对路径） */
function avatarUrlOf(avatarPath: string): string {
  if (avatarPath.startsWith("http")) return avatarPath;
  if (avatarPath.startsWith("./")) return assetUrl(avatarPath.slice(2));
  if (avatarPath.startsWith("/")) return location.origin + avatarPath;
  return assetUrl(avatarPath);
}

/**
 * ★ fix⑥（动图头像不播放的根因）：头像此前统一走 new Image() + ctx.drawImage()，
 *   而 drawImage 只绘制图像的「当前帧」—— 动画 WebP 经它画出来必然是一张静止图。
 *   这不是 canvas 不支持动图，而是这条绘制路径根本不驱动动画帧。
 *
 *   这里用 ImageDecoder（Chromium 94+，宿主运行在 127.0.0.1 属 secure context）
 *   把动图逐帧解码成 VideoFrame 缓存，绘制时按各帧 duration 自行轮播。
 *   解码失败 / 非动图 / 环境不支持 ImageDecoder 时标记为 "static"，
 *   自动回退到原来的静态 img 绘制，行为与改动前一致。
 */
interface AvatarAnim {
  frames: any[];
  /** 各帧时长（ms） */
  durations: number[];
  /** 各帧起始时刻（ms，累加） */
  starts: number[];
  /** 一轮总时长（ms） */
  total: number;
}
const avatarAnimCache = new Map<string, AvatarAnim | "static" | "pending">();

function ensureAvatarAnim(avatarPath: string): void {
  if (avatarAnimCache.has(avatarPath)) return;
  const Decoder = (window as any).ImageDecoder;
  if (typeof Decoder === "undefined") {
    avatarAnimCache.set(avatarPath, "static");
    return;
  }
  avatarAnimCache.set(avatarPath, "pending");
  const url = avatarUrlOf(avatarPath);
  void (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.arrayBuffer();
      const decoder = new Decoder({ data, type: res.headers.get("content-type") || "image/webp" });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      const n: number = track?.frameCount || 0;
      if (n <= 1) {
        avatarAnimCache.set(avatarPath, "static");
        return;
      }
      const frames: any[] = [];
      const durations: number[] = [];
      for (let i = 0; i < n; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        frames.push(image);
        durations.push(Math.max(16, Math.round((image.duration || 100000) / 1000)));
      }
      const starts: number[] = [];
      let acc = 0;
      for (const d of durations) { starts.push(acc); acc += d; }
      avatarAnimCache.set(avatarPath, { frames, durations, starts, total: acc || 1 });
    } catch {
      // 解码失败（跨域 / 非动图 / 旧内核）→ 回退静态，绝不影响主流程
      avatarAnimCache.set(avatarPath, "static");
    }
  })();
}

/** 返回该路径当前应绘制的那一帧；不是动图时返回 null（调用方回退静态 img） */
function avatarAnimFrame(avatarPath: string | undefined): any | null {
  if (!avatarPath) return null;
  ensureAvatarAnim(avatarPath);
  const entry = avatarAnimCache.get(avatarPath);
  if (!entry || entry === "static" || entry === "pending") return null;
  const t = performance.now() % entry.total;
  for (let i = entry.starts.length - 1; i >= 0; i--) {
    if (t >= entry.starts[i]) return entry.frames[i];
  }
  return entry.frames[0];
}

const roles = computed<RoleOption[]>(() => state.value?.roles || []);
const playerRole = computed(() => roles.value.find((r) => r.roleType === "player") || roles.value[0]);

function toggle(list: string[], id: string) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
}

function roleAvatar(r: RoleOption): string {
  const p = r?.avatarPath || "";
  if (!p) return "";
  // ★ fix②：统一用 resolveAssetPath。
  //   旧实现把宿主站内绝对路径（/1/game/scene/xxx.webp）也塞给 assetUrl，
  //   于是被拼成 /plugin/getAsset?pluginId=...&path=ui//1/game/scene/xxx.webp，
  //   服务端按插件目录解析 → 404（该 webp 实际由宿主 uploads 静态目录托管，
  //   /1/game/scene/xxx.webp 直取为 200 image/webp）。
  return resolveAssetPath(p);
}

const starting = ref(false);
/** ★ fix③：开始游戏后的状态提示（宿主 /plugin/tick 响应慢时给出可解释的反馈） */
const startHint = ref("");
let startTimerSlow = 0;
let startTimerFail = 0;
function clearStartTimers() {
  if (startTimerSlow) { window.clearTimeout(startTimerSlow); startTimerSlow = 0; }
  if (startTimerFail) { window.clearTimeout(startTimerFail); startTimerFail = 0; }
}

/**
 * ★ fix④：像素风开关（复选框放在「退出」按钮旁）
 *  默认 true = 保持原有像素风渲染；取消勾选后：
 *    ① 画布 CSS 去掉 image-rendering: pixelated / crisp-edges；
 *    ② canvas 2D 打开双线性平滑（imageSmoothingEnabled=true + quality=high）。
 *  用户反馈的"整个界面都很模糊"正是低分辨率画布被像素化放大所致：关闭像素风后
 *  交给浏览器做平滑插值，观感立刻变清晰（代价是像素细节略柔）。
 */
const pixelMode = ref(localStorage.getItem("fs_pixel_mode") !== "0");
function onPixelModeChange() {
  try { localStorage.setItem("fs_pixel_mode", pixelMode.value ? "1" : "0"); } catch { /* ignore */ }
  applyCanvasSmoothing();
}
/** 按当前像素风开关同步 canvas 采样方式 */
function applyCanvasSmoothing() {
  const c = canvasEl.value;
  const g = c?.getContext("2d");
  if (!g) return;
  g.imageSmoothingEnabled = !pixelMode.value;
  try { (g as any).imageSmoothingQuality = pixelMode.value ? "low" : "high"; } catch { /* ignore */ }
}

function init_game(){
  // 初始化游戏
  // 例如生成地图数据，设置为游戏状态刚开始
}

function startGame() {
  if (starting.value) {
    console.log("starting.value not null");
    return
  };
  init_game();
  starting.value = true;
  sendTick("start", {
    selections: {
      participants: [...participants.value],
      spectators: [...spectators.value],
      enemies: [...enemies.value],
    },
  });
  // ★ fix③：原实现 2 秒后无条件重置按钮——宿主侧开始游戏要生成地图（较慢），
  //   「加载中…」在等待期凭空消失，用户看到的就是“点了开始、/plugin/tick 没返回、
  //   加载中效果就没了”。改为：
  //     · 加载态一直保持到宿主真的回包（onHostState 收到 playing/over 才清除）；
  //     · 8 秒未回包 → 提示“宿主响应较慢”（继续加载）；
  //     · 20 秒仍未回包 → 判定失败，恢复按钮并给出可重试的错误提示。
  startTimerSlow = window.setTimeout(() => {
    if (starting.value) startHint.value = "宿主响应较慢（正在生成地图），请稍候…";
  }, 8000);
  startTimerFail = window.setTimeout(() => {
    if (!starting.value) return;
    starting.value = false;
    startHint.value = "开始超时：宿主未返回 /plugin/tick(start) 响应，请检查服务端与插件会话后重试";
  }, 20000);
}

/* ---------------- 操作输入 ---------------- */
const input = ref({ dx: 0, dy: 0, moveTo: null as null | { x: number; y: number } });
const keys = new Set<string>();

function onKeyDown(e: KeyboardEvent) {
  keys.add(e.key.toLowerCase());
  syncKeys();
}
function onKeyUp(e: KeyboardEvent) {
  keys.delete(e.key.toLowerCase());
  syncKeys();
}
function syncKeys() {
  let dx = 0;
  let dy = 0;
  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;
  input.value.dx = dx;
  input.value.dy = dy;
  if (dx || dy) input.value.moveTo = null;
}

/* 虚拟摇杆 */
const stick = ref<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
const STICK_R = 52;
function stickStart(e: PointerEvent) {
  stick.value.active = true;
  stickMove(e);
}
function stickMove(e: PointerEvent) {
  if (!stick.value.active) return;
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  let x = e.clientX - (r.left + r.width / 2);
  let y = e.clientY - (r.top + r.height / 2);
  const d = Math.hypot(x, y);
  if (d > STICK_R) { x = (x / d) * STICK_R; y = (y / d) * STICK_R; }
  stick.value.x = x;
  stick.value.y = y;
  const nx = x / STICK_R;
  const ny = y / STICK_R;
  input.value.dx = Math.abs(nx) > 0.18 ? nx : 0;
  input.value.dy = Math.abs(ny) > 0.18 ? ny : 0;
  if (input.value.dx || input.value.dy) input.value.moveTo = null;
}
function stickEnd() {
  stick.value.active = false;
  stick.value.x = 0;
  stick.value.y = 0;
  input.value.dx = 0;
  input.value.dy = 0;
}

/* ---------------- 画布渲染 ---------------- */
const canvasEl = ref<HTMLCanvasElement | null>(null);

/* ============================================================
   地图 / 比例尺 / 缩放（来自 map_config.json）

   world_size = 3000 × 3000 米，origin = (0,0)，X/Z 范围 ±1500
   scale_meter = 1.0，block_size = 0.5 米，chunk_size = 32 块 = 16 米
   zoom ∈ [10, 30]，default = 20
   view_radius_m = 15 * (20/zoom) 米（地图配置 def_view 决定）

   显示区域算法：
     canvas 永远居中显示玩家世界坐标
     pixel_per_meter = min(canvas_w / view_w, canvas_h / (view_h * DEPTH))
     view_w, view_h 米 = def_view ± view_radius
   ============================================================ */

const mapCfg = ref<MapConfig | null>(null);
const terrainScale = computed<TerrainScaleConfig>(() =>
  mapCfg.value ? makeScaleFromMap(mapCfg.value) : DEFAULT_SCALE,
);

/** 当前 zoom（10-30, default 20） */
const zoom = ref(20);

/** 玩家世界坐标（米），从 state.entities[player] 派生 */
const playerPos = computed(() => {
  const s = state.value;
  if (!s) return { x: terrainScale.value.origin[0], y: terrainScale.value.origin[1] };
  const me = s.entities.find((e) => e.side === "player");
  if (me) return { x: me.x, y: me.y };
  // 兜底：用 state.spawn (entry.ts v3 引入) 或 origin
  if (s.spawn) return { x: s.spawn.x, y: s.spawn.y };
  return { x: terrainScale.value.origin[0], y: terrainScale.value.origin[1] };
});

/* 兼容旧变量（虽然名字难听，留着不破坏其它代码路径） */
let mapscale = 1;
let mapsize_def = { weight: 3000, height: 3000 };
let user_birth_location: [number, number] = [0, 0];
let _zoom_legacy = 2; // 旧值，已被 ref zoom 取代

/* 当前可见世界尺寸（米）—— 由 zoom 决定 */
const viewSizeMeters = computed<[number, number]>(() =>
  terrainScale.value.viewSizeMeters(zoom.value),
);

let canvas_direction_def={
  horizontal_screen:{canvas_w:960, canvas_h:600},
  vertical_screen:{canvas_w:600, canvas_h:960}
}
let canvas_w =canvas_direction_def.vertical_screen.canvas_w;
let canvas_h = canvas_direction_def.vertical_screen.canvas_h;
/* 兜底常量（drawEntity / drawMonster 在未传入屏幕像素时的 fallback） */
const W_DEFAULT = canvas_w;
const H_DEFAULT = canvas_h;

const canvas_w_ref = ref(canvas_w);
const canvas_h_ref = ref(canvas_h);
/**
 * ★ fix⑤（画面模糊根因）：位图缓冲 / 逻辑坐标系 的比例系数 k。
 *
 * 逻辑坐标系（render() 里的 W×H、以及头像 40px / 字号 / 线宽等一切像素常量）
 * 始终保持原设计值不变；canvas 元素的 width/height 属性（= 真实位图密度）
 * 按「CSS 显示尺寸 × devicePixelRatio」放大，绘制时用 ctx.setTransform(k,…)
 * 一次性映射回逻辑坐标系。
 *
 * 这样视觉尺寸与所有绘制语义完全不变，只是位图从「1 个 CSS 像素 = 1 个位图像素」
 * 提升到「1 个物理像素 = 1 个位图像素」，彻底消除被浏览器放大数倍后的发虚。
 */
const renderScale = ref(1);
/** 设计基准：横屏 960×600 */
const DESIGN_W = 960;
const DESIGN_H = 600;
const MAX_LONG = 12000; // 画布长边上限，防爆显存


const world = computed(() => state.value?.world || { w: canvas_direction_def.vertical_screen.canvas_w, h: canvas_direction_def.vertical_screen.canvas_h });
/**
 * 🔄 按钮（req.md:57-58）：横竖屏切换
 *
 * 设计：手机默认竖屏 → 画布直接 960×600 纵向铺满屏幕（无黑边）
 *      点击 🔄 → 切横屏 → 画布旋转 90° 显示成 600×960（适合安卓 H5 横屏）
 * 内部分辨率与渲染坐标永不改变，只调 CSS 大小和 transform。
 */

function fitCanvas() {
  rotated_fun();
  fitCanvas_v5();
}

function fitCanvas_v5() {
  const c = canvasEl.value;
  if (!c) return;
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  if (availW <= 0 || availH <= 0) return;

  const BUF_H = canvas_h;
  const BUF_W = canvas_w;

  // 正常横屏：直接填满（cover）
  const scale = Math.max(availW / BUF_W, availH / BUF_H);
  const cssW = Math.max(1, Math.floor(BUF_W * scale));
  const cssH = Math.max(1, Math.floor(BUF_H * scale));
  c.style.width  = cssW + "px";
  c.style.height = cssH + "px";

  // ★ fix⑤（画面模糊根因修复）：旧实现把 canvas 的 width/height 属性直接设成
  //   BUF_W / BUF_H（逻辑尺寸，手机竖屏约 390×244），而 CSS 又把这块小位图放大到
  //   cssW×cssH（1300+ px）来铺满屏幕 —— 相当于一张 390px 宽的位图被浏览器
  //   放大数倍（且是非整数倍）显示。所以宿主下发的清晰头像 webp、像素精灵
  //   全都会被二次插值搞糊，跟素材本身清晰度没有任何关系。
  //   现改为：位图缓冲 = 实际显示尺寸 × devicePixelRatio，配合 render() 里的
  //   ctx.setTransform(k) 做到 1 个位图像素 = 1 个物理像素。
  //   上限取 2：手机 DPR 普遍是 2~3，取满 3 会让每帧填充像素涨到 9 倍，
  //   和上一轮做的移动端 30fps / 限频优化互相打架；DPR=2 已基本消除肉眼模糊。
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bufW = Math.max(1, Math.round(cssW * dpr));
  const bufH = Math.max(1, Math.round(cssH * dpr));
  canvas_w_ref.value = bufW;
  canvas_h_ref.value = bufH;
  renderScale.value = bufW / BUF_W;
  console.log("[fitCanvas_v5] css", cssW, cssH, "buffer", bufW, bufH, "dpr", window.devicePixelRatio, "k", renderScale.value.toFixed(3));
}



/**
 * 根据当前视口，算出横屏/竖屏两种模式下的逻辑画布尺寸
 * 横竖屏比例严格保持 16:10，只是宽高互换
 */
function calcCanvasDirection() {
  const vp = window.visualViewport ?? { width: window.innerWidth, height: window.innerHeight };
  const screenW = vp.width;
  const screenH = vp.height;

  const aspect = DESIGN_W / DESIGN_H; // 1.6

  // 横屏：宽>高，比例 1.6
  let hW: number, hH: number;
  if (screenW / screenH >= aspect) {
    hH = Math.min(screenH, MAX_LONG / aspect);
    hW = hH * aspect;
  } else {
    hW = Math.min(screenW, MAX_LONG);
    hH = hW / aspect;
  }

  // 竖屏：宽<高，比例 0.625（横屏宽高互换）
  let vW: number, vH: number;
  if (screenW / screenH <= 1 / aspect) {
    vW = Math.min(screenW, MAX_LONG * (1 / aspect));
  } else {
    vH = Math.min(screenH, MAX_LONG);
  }

  return {
    screen: { canvas_w: Math.round(hW), canvas_h: Math.round(hH) }
  };
}

function rotated_fun() {
  rotated_fun_v1();
}
function rotated_fun_v1() {
  const canvas_direction = calcCanvasDirection();
    // CSS hack旋转模式，使用竖屏配置
  canvas_w = canvas_direction.screen.canvas_w;
  canvas_h = canvas_direction.screen.canvas_h;
  console.log("set canvas size", canvas_w, canvas_h);
}



/** 🔄 按钮：横竖屏切换 */
/** 判断是否安卓App内嵌H5(WebView) */
function isAndroidAppWebView(): boolean {
  const ua = navigator.userAgent;
  const isAndroid = /android/i.test(ua);
  const isWebView = /; wv\)/.test(ua); // WebView标识
  return isAndroid && isWebView;
}

/** 🔄 横竖屏切换入口 */
async function toggleOrientation() {
  await toggleOrientation_android_app_h5();
}

async function toggleOrientation_android_app_h5() {
  // 目标状态：isRotated=false → 期望真实系统横竖屏；true → CSS旋转hack
  const wantLandscape = !isRotated.value;

  // ✅ 不是安卓App‑WebView，直接跳过系统锁屏，直接切CSS hack
  if (!isAndroidAppWebView()) {
    console.log("不是安卓App WebView，跳过系统方向锁，使用CSS rotate hack");
    isRotated.value = !isRotated.value;
    // pc 元素也不旋转
    //isStageRotateOn.value = !isRotated.value;
    rotated_fun();
    requestAnimationFrame(fitCanvas);
    return;
  }

  // 只有安卓App WebView才尝试调用系统锁API
  try {
    if (!window.screen?.orientation) {
      throw new Error("WebView环境不支持screen.orientation");
    }
    if (wantLandscape) {
      await screen.orientation.lock("landscape-primary");
    } else {
      await screen.orientation.lock("portrait-primary");
    }
    // 锁屏成功，关闭CSS旋转标记
    isRotated.value = false;
    console.log("✅ WebView系统方向锁定成功", wantLandscape ? "横屏" : "竖屏");
  } catch (err) {
    console.warn("⚠️ WebView系统锁屏失败，降级CSS rotate hack：", err);
    isRotated.value = !isRotated.value;
  }

  rotated_fun();
  requestAnimationFrame(fitCanvas);
}

function onCanvasClick(e: MouseEvent) {
  const c = canvasEl.value;
  if (!c) return;
  const r = c.getBoundingClientRect();

  // 屏幕点 → canvas 内部像素
  const cssX = e.clientX - r.left;
  const cssY = e.clientY - r.top;
  // CSS 显示尺寸 vs canvas 内部尺寸的比例
  const ratioX = c.width / r.width;
  const ratioY = c.height / r.height;
  const px = cssX * ratioX;
  const py = cssY * ratioY;

  // ★ v3：用相机反推 canvas 像素 → 世界米（playerPos + zoom 决定）
  const ts = terrainScale.value;
  const [vw, vh] = ts.viewSizeMeters(zoom.value);
  // canvas 内部坐标系里，px,py 转世界米
  const ppm = Math.min(c.width / vw, c.height / (vh * DEPTH));
  const dx = (px - c.width / 2) / ppm;
  const dy = (py - c.height / 2) / (ppm * DEPTH);
  // dx, dy 是相对玩家的偏移，加 playerPos 即世界米
  const me = state.value?.entities.find((e) => e.side === "player");
  const ppx = me?.x ?? 0;
  const ppy = me?.y ?? 0;
  input.value.moveTo = {
    x: ppx + dx,
    y: ppy + dy,
  };

  input.value.dx = 0;
  input.value.dy = 0;
}


// loadAvatar 已移除（角色身体改用 sprite sheet）

/**
 * 纵向压缩系数（2.5D 斜视角）。
 * Rotten-Soup 是正俯视：地块为正方形、纵向不做压缩。toonflow 旧值 0.62 把画面纵向压扁，
 * 表现为"地块变扁、树变矮胖"，与参照画面差距明显。v4 改为 1.0（等距俯视、正方形地块）。
 */
const DEPTH = 1.0;

// ============================================================
// 精灵资源管理（参考 pixi_game 的 PNG sprite sheet 方案）
// ============================================================

interface SpriteSheet {
  img: HTMLImageElement;
  fw: number;   // 单帧宽
  fh: number;   // 单帧高
  cols: number; // 列数
  ready: boolean;
}

/** 通用 PNG 精灵（单图或多帧横排，frameH=单帧高度） */
function loadSheet(src: string, fw: number, fh: number, cols = 1): SpriteSheet {
  const img = new Image();
  // ★ 不设置 crossOrigin（base64 data URL 在 iframe 中不需要 CORS）
  img.onload = () => { (sheet as any).ready = true; };
  img.onerror = () => {
    console.warn('[field-survival] sprite load failed', src.substring(0, 30));
  };
  img.src = src;
  // ★ 同步检查：如果图片已经缓存（complete=true），立即标记 ready
  const sheet: SpriteSheet = { img, fw, fh, cols, ready: !!(img.complete && img.naturalWidth > 0) };
  return sheet;
}

function onReady(s: SpriteSheet, cb: () => void) {
  if (s.ready) { cb(); return; }
  if (s.img.complete && s.img.naturalWidth > 0) {
    s.ready = true; cb();
  } else {
    s.img.onload = () => { s.ready = true; cb(); };
  }
}

/** 绘制单帧：(sx,sy)为源图帧坐标 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  s: SpriteSheet,
  sx: number, sy: number,
  dx: number, dy: number, dw: number, dh: number,
) {
  if (!s.ready) return;
  ctx.drawImage(s.img, sx * s.fw, sy * s.fh, s.fw, s.fh, dx, dy, dw, dh);
}

// ----------------------------------------------------------
// 精灵加载（Rotten-Soup dawnlike 资源，相对路径引用 public/images/）
// 角色走 player_sprites/<id>.png 单图；地面/水/药水从 tileset 按 tile id 切片
// -------------------------------------------------------
const SHEET_PLAYER      = loadSheet(IMG_PLAYER, 32, 32);
const SHEET_ALLY        = loadSheet(IMG_ALLY, 32, 32);
const SHEET_ENEMY_CHAR  = loadSheet(IMG_ENEMY_CHAR, 32, 32);

// ★ tileset 大图只加载一次，所有 tile id 共用（同 Rotten-Soup 的 GameDisplay 方案）
const SHEET_TILESET    = loadSheet(TILESET_URL, TILE_SIZE, TILE_SIZE, TILESET_COLS);

/** 从 tileset 绘制指定 tile id */
function drawTile(
  ctx: CanvasRenderingContext2D,
  tileId: number,
  dx: number, dy: number, dw: number, dh: number,
  flipX: boolean = false,
) {
  if (!SHEET_TILESET.ready) return;
  const { sx, sy, sw, sh } = tileSrcRect(tileId);
  if (flipX) {
    // 水平翻转：先把目标区域缩放为 (-dw, dh)，再 drawImage
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(SHEET_TILESET.img, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(SHEET_TILESET.img, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

/* ============================================================
 * ★ 城镇建筑像素艺术绘制（与 Rotten-Soup mulberryTown.json 同构）
 *
 * 瓦片类型：
 *   - 屋顶（顶行）：左 / 中 / 右 = 9184 / 9185 / 9186（带斜面封边）
 *   - 墙体（中间行）：左 / 中 / 右 = 9304 / 9305 / 9306
 *   - 墙底（最底行）：9310（带阴影描边）
 *   - 门：9425（占 2 行高，靠最底，门口朝南）
 *   - 窗：9424 / 9426
 *   - 室内地面：9189（用于最底行中间 / 室内细节）
 *
 * 每种建筑 kind 有不同的尺寸与内部格局：
 *   - inn   6×7 大屋：屋顶 2 行 + 墙 4 行（含 2 行门面）+ 底 1 行
 *   - shop  5×6 中型铺面
 *   - house 4×5 标准民居
 *   - well  2×2 水井（特殊：圆顶石井）
 * ============================================================ */
interface TownBuilding {
  id: string;
  kind?: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 选瓦片：列索引 → (左/中/右) 屋顶 / 墙顶 / 墙底
 * 行索引：
 *   0        = 屋顶顶行（只有左 / 中 / 右三块）
 *   1        = 屋顶中行（同 0）
 *   2..h-2   = 墙身
 *   h-1      = 墙底
 *   门窗放 2..h-2 中间一行（朝南/朝相机）。
 */
function drawTownBuildingTiles(
  ctx: CanvasRenderingContext2D,
  b: TownBuilding,
  ppm: number,                 // pixels per meter（=每瓦片边长）
  wx2px: (x: number) => number,
  wz2py: (z: number) => number,
) {
  const kind = b.kind || "house";
  const w = Math.max(2, b.w | 0);
  const h = Math.max(2, b.h | 0);
  const cx = wx2px(b.x);
  const cy = wz2py(b.y);
  const tile = Math.max(4, Math.round(ppm)); // 单瓦片像素边长（与角色同尺度）
  const bw = w * tile;     // 建筑总宽（像素）
  const bh = h * tile;     // 建筑总高（像素）
  const x0 = cx - bw / 2;  // 建筑最左
  const y0 = cy - bh + 4;  // 建筑最上（与原"building"装饰物同一锚点）

  // —— 水井：单独绘制（圆顶石井 + 水面），不画方屋 ——
  if (kind === "well") {
    drawWellPixel(ctx, x0, y0, bw, bh, tile);
    return;
  }

  // 行类型：
  //   0            → 屋顶顶行
  //   1            → 屋顶中行
  //   2 .. h-2     → 墙身（门窗在此）
  //   h-1          → 墙底
  for (let row = 0; row < h; row++) {
    const ty = y0 + row * tile;
    for (let col = 0; col < w; col++) {
      const tx = x0 + col * tile;
      const isLeft   = col === 0;
      const isRight  = col === w - 1;
      const isMiddle = !isLeft && !isRight;
      const doorCol  = (w / 2) | 0;        // 朝南的门在中列
      const isDoorCol = isMiddle && col === doorCol;

      // 行 0/1：屋顶
      if (row === 0 || row === 1) {
        const tileId = isLeft
          ? TILE_HOUSE_ROOF_LEFT_ID
          : (isRight ? TILE_HOUSE_ROOF_RIGHT_ID : TILE_HOUSE_ROOF_MID_ID);
        drawTile(ctx, tileId, tx, ty, tile, tile);
        continue;
      }

      // 行 h-1：墙底
      if (row === h - 1) {
        drawTile(ctx, TILE_HOUSE_BOTTOM_ID, tx, ty, tile, tile);
        continue;
      }

      // 行 2 .. h-2：墙身
      //   - 左 / 右：墙顶左 / 右（带尖角）
      //   - 中列 + 是"门面行"：门（占两行 → 第二行重复画门，营造 2 格高门洞）
      //   - 中列 + 是"窗行"：窗（仅 shop / inn 偶数行放窗）
      //   - 其余：墙顶中
      const facadeRow = row === h - 2;       // 紧贴墙底的那行 = 门面行
      const windowRow = (kind === "shop" || kind === "inn") && !facadeRow && (row % 2 === 0);

      if (isLeft) {
        drawTile(ctx, TILE_HOUSE_TOP_LEFT_ID, tx, ty, tile, tile);
      } else if (isRight) {
        drawTile(ctx, TILE_HOUSE_TOP_RIGHT_ID, tx, ty, tile, tile);
      } else if (isDoorCol && facadeRow) {
        drawTile(ctx, TILE_HOUSE_DOOR_ID, tx, ty, tile, tile);
      } else if (isDoorCol && row === h - 3) {
        // 门洞上方再画一行门（与门面行连成 2 格高门洞）
        drawTile(ctx, TILE_HOUSE_DOOR_ID, tx, ty, tile, tile);
      } else if (windowRow && (col === doorCol - 1 || col === doorCol + 1)) {
        // 门两侧的格子放窗
        drawTile(ctx, col < doorCol ? TILE_HOUSE_WINDOW_ID : TILE_HOUSE_WINDOW_RIGHT_ID, tx, ty, tile, tile);
      } else {
        drawTile(ctx, TILE_HOUSE_TOP_MID_ID, tx, ty, tile, tile);
      }
    }
  }
}

/**
 * 水井像素艺术：
 *   - 2×2 水井用 4 个瓦片拼出"石井 + 水面"：
 *     [木井栏顶] [木井栏顶]
 *     [石块环]   [水面]
 *   - tileset 中没有专用井 tile，借用屋顶中（9185）+ 墙底（9310）+ 水（4500）组合。
 */
function drawWellPixel(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, bw: number, bh: number, tile: number,
) {
  // 左上 / 右上：木井栏顶（屋顶中瓦片作为占位；没有专用井栏 tile，借用屋顶木纹）
  drawTile(ctx, TILE_HOUSE_ROOF_MID_ID, x0,             y0,             tile, tile);
  drawTile(ctx, TILE_HOUSE_ROOF_MID_ID, x0 + tile,     y0,             tile, tile);
  // 左下：石块（墙底瓦片带阴影边）
  drawTile(ctx, TILE_HOUSE_BOTTOM_ID,   x0,             y0 + tile,      tile, tile);
  // 右下：水面
  drawTile(ctx, TILE_WATER_ID,          x0 + tile,     y0 + tile,      tile, tile);
  // 井口轮廓：在水面中心画一个深色圆点（井口黑眼）
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.beginPath();
  const cx = x0 + tile + tile / 2;
  const cy = y0 + tile + tile / 2;
  ctx.arc(cx, cy, tile * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ★ 像素艺术：用 imageSmoothingEnabled=false 保证像素清晰（不模糊）
function applyPixelPerfect(ctx: CanvasRenderingContext2D) {
  // ★ fix④：跟随「像素风」复选框——关闭时若仍强制 imageSmoothingEnabled=false，
  //   每帧绘制都会把它改回去，复选框就失效了。
  ctx.imageSmoothingEnabled = !pixelMode.value;
  if (!pixelMode.value) {
    try { (ctx as any).imageSmoothingQuality = "high"; } catch { /* ignore */ }
  }
}

// 地图装饰物（树木、水体、花木）位置 —— 优先从 mulberryTown.json 加载
interface Decoration { x: number; y: number; kind: "tree" | "water" | "bush" | "mushroom" | "flower" | "pot" | "rock" | "dead_tree" | "building" | "npc" | "fence" | "furniture" | "farm" | "road"; id: string; variant?: number; name?: string; tileId?: number; layer?: number }
const mapDecorations = ref<Decoration[]>([]);
/** 装饰物按 chunk 索引（key = "cx,cz"）——按区域加载时只取当前 loaded_chunks 内的 */
const decorationsByChunk = new Map<string, Decoration[]>();

/** Chunk 系统（按玩家位置动态加载/卸载装饰物） */
let chunkSystem: ChunkTerrainSystem | null = null;

// 初始化地图装饰物（从 mapCfg.decorations 读，fallback 用 §文件 hard-coded）
function initDecorations() {
  if (mapCfg.value?.decorations?.length) {
    // ★ 按 chunk 索引所有装饰（不一次性 push 到 mapDecorations.value）
    decorationsByChunk.clear();
    for (const d of mapCfg.value.decorations) {
      const dec = d as Decoration;
      const cx = Math.floor(dec.x / 16);  // CHUNK_SIZE_M = 16
      const cz = Math.floor(dec.y / 16);
      const key = `${cx},${cz}`;
      if (!decorationsByChunk.has(key)) decorationsByChunk.set(key, []);
      decorationsByChunk.get(key)!.push(dec);
    }
    mapDecorations.value = [];
    return;
  }
  const decs: Decoration[] = [];
  const rng = (a: number, b: number) => Math.random() * (b - a) + a;
  // 兜底用米范围（±1500）
  const W = 3000;
  const H = 3000;
  // 树木（9 棵，绿树/枯树交替）
  for (let i = 0; i < 9; i++) {
    decs.push({ x: rng(-W*0.45, W*0.45), y: rng(-H*0.45, H*0.45), kind: "tree", id: `tree_${i}`, variant: i % 2 });
  }
  // 水体（4 处）
  for (let i = 0; i < 4; i++) {
    decs.push({ x: rng(-W*0.4, W*0.4), y: rng(-H*0.4, H*0.4), kind: "water", id: `water_${i}` });
  }
  // 灌木（5 丛）
  for (let i = 0; i < 5; i++) {
    decs.push({ x: rng(-W*0.45, W*0.45), y: rng(-H*0.4, H*0.4), kind: "bush", id: `bush_${i}` });
  }
  // 蘑菇（4 朵）
  for (let i = 0; i < 4; i++) {
    decs.push({ x: rng(-W*0.45, W*0.45), y: rng(-H*0.4, H*0.4), kind: "mushroom", id: `mush_${i}` });
  }
  // 花（7 处）
  for (let i = 0; i < 7; i++) {
    decs.push({ x: rng(W * 0.06, W * 0.94), y: rng(H * 0.13, H * 0.90), kind: "flower", id: `flower_${i}` });
  }
  // 血瓶（3 个）
  for (let i = 0; i < 3; i++) {
    decs.push({ x: rng(W * 0.08, W * 0.92), y: rng(H * 0.13, H * 0.87), kind: "pot", id: `pot_${i}` });
  }
  mapDecorations.value = decs;
}

/**
 * ★ v3 兜底：外部 mockHost 未启动时（被 Toonflow 编辑器 wrapper iframe 包装），
 *   state.entities 里只有玩家/盟友，看不到怪物。在玩家位置周围 30-100 米
 *   环形补 spawn 4-6 只野兽，让玩家开局立刻能看到。重复调用安全：检查
 *   state.entities 里是否已有 enemy，若有则跳过。
 */
/**
 * 区域刷新野怪
 * @param zoneData 区域数据（包含 refresh_rate, mob_types）
 * @param cx 玩家 x 坐标
 * @param cy 玩家 y 坐标
 */
function spawnZoneMobs(zoneData: any, cx: number, cy: number): void {
  const mobTypeMap: Record<string, { name: string; hp: number; atk: number }> = {
    wolf:     { name: "巨狼",       hp: 60, atk: 10 },
    boar:     { name: "野猪",       hp: 50, atk: 8 },
    skeleton: { name: "骷髅兵",     hp: 50, atk: 12 },
    goblin:   { name: "哥布林斥候", hp: 30, atk: 6 },
    snake:    { name: "毒蛇",       hp: 25, atk: 8 },
    bat:      { name: "蝙蝠",       hp: 20, atk: 5 },
  };
  const defaultTypes = ["wolf", "boar", "goblin"];
  const types = (zoneData.mob_types?.length ? zoneData.mob_types : defaultTypes);
  let seq = 0;
  for (let i = 0; i < 4; i++) {
    const typeKey = types[i % types.length];
    const arch = mobTypeMap[typeKey] ?? mobTypeMap["wolf"];
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 40;   // 20-60 米环形
    const id = `zone_${zoneData.name}_${Date.now()}_${seq++}`;
    state.value.entities.push({
      id, name: arch.name, side: "enemy",
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
      vx: 0, vy: 0,
      hp: arch.hp, maxHp: arch.hp,
      atk: arch.atk, level: 1,
      facing: 180, cooldown: 0, alive: true,
    });
  }
}

/**
 * 区域野怪刷新主逻辑
 */
function spawnLocalMobsIfNeeded(): void {
  if (!state.value || state.value.phase !== "playing") return;
  const me = state.value.entities.find((e) => e.side === "player");
  if (!me) return;

  const zones = ((state.value?.map?.zones?.length ? state.value.map.zones : mapCfg.value?.zones) || []) as Array<any>;
  const currentZone = zones.find((z) => {
    if (z.rx !== undefined && z.ry !== undefined) {
      return Math.abs(z.x - me.x) <= z.rx && Math.abs(z.y - me.y) <= z.ry;
    }
    return Math.hypot(z.x - me.x, z.y - me.y) <= z.r;
  });

  // 安全区不刷新
  if (currentZone?.kind === "safe" || currentZone?.refresh_rate === 0) return;

  // 检查该区域野怪是否已全死
  const zoneEnemies = state.value.entities.filter((e) => {
    if (e.side !== "enemy") return false;
    const zoneName = (e as any).zoneName;
    return zoneName === currentZone?.name;
  });
  const allDead = zoneEnemies.length > 0 && zoneEnemies.every((e) => !e.alive);

  // 有活着的怪，不刷新
  if (zoneEnemies.some((e) => e.alive)) return;

  // 根据区域配置决定是否刷新
  if (currentZone) {
    // 有区域配置：检查刷新计时
    if (!zoneRespawnReady && !allDead) return;
    spawnZoneMobs(currentZone, me.x, me.y);
    zoneRespawnReady = false;
    state.value.events.push(`[${currentZone.name}] 野怪刷新！`);
  } else {
    // 野外（无区域配置）：每 60 秒自动刷新
    const hasEnemy = state.value.entities.some((e) => e.side === "enemy");
    if (hasEnemy) return;
    const archetypes = [
      { name: "哥布林斥候", hp: 30, atk: 6 },
      { name: "巨狼",       hp: 60, atk: 10 },
      { name: "毒蛇",       hp: 25, atk: 8 },
      { name: "蝙蝠",       hp: 20, atk: 5 },
      { name: "骷髅兵",     hp: 50, atk: 12 },
    ];
    let seq = 0;
    for (let i = 0; i < 5; i++) {
      const arch = archetypes[i % archetypes.length];
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 70;
      const id = `localmob_${Date.now()}_${seq++}`;
      state.value.entities.push({
        id, name: arch.name, side: "enemy",
        x: me.x + Math.cos(angle) * dist,
        y: me.y + Math.sin(angle) * dist,
        vx: 0, vy: 0,
        hp: arch.hp, maxHp: arch.hp,
        atk: arch.atk, level: 1,
        facing: 180, cooldown: 0, alive: true,
      });
    }
    state.value.events.push(`[local-mob] 已 spawn 5 只野兽`);
  }
}

/**
 * 客户端权威 tick（★ 单一数据源）
 *
 * 设计：玩家位姿（x/y/facing）只在 game.html 内推进一次（每 100ms 一 tick），
 *   再把结果通过 sendTick 的 player 字段上报宿主；宿主只做镜像、不再重复积分，
 *   消除"前端 0.3 米/帧 + 宿主 3 米/帧"双写导致的位移回退 / 松手瞬移。
 * 速度：与 entry.ts 的 MOVE_SPEED_M 同为 3 米/秒（一 tick 位移 0.3 米）。
 * 边界：与 entry.ts clampX/clampY 对齐，取 ±1490 米。
 */
const LOCAL_MOVE_SPEED_M = 3;     // 米/秒（与 entry.ts MOVE_SPEED_M 一致）
const TICK_DT = 0.1;              // 与 loop() 的 TICK_MS=100 对应
const WORLD_LIMIT_M = 1490;       // 与 entry.ts WORLD_X_RANGE(±1500) - 10 对齐
/** 区域刷新机制 */
const DETECTION_RADIUS_M = 10;      // 脱战检测半径（米）
const ZONE_RESPAWN_SEC = 45;       // 离开区域后刷新野怪时间（秒）
const TICK_RATE_MS = 100;          // tick 间隔（毫秒）
/** 本地权威位姿缓存：宿主 state 推回时用它覆盖宿主侧玩家坐标（防回退） */
let lastLocalPose: { x: number; y: number; facing: number } | null = null;
/** 区域刷新追踪 */
let currentZoneName: string | null = null;       // 玩家当前所在区域
let zoneLeftTick: number = 0;                    // 离开区域的 tick 时间
let zoneRespawnReady = false;                    // 是否可以刷新该区域野怪

function localTick(): void {
  if (!state.value || state.value.phase !== "playing") return;
  const s = state.value;
  // 1. 推进玩家位置（全流程唯一积分点）
  const me = s.entities.find((e) => e.side === "player");
  if (me) {
    const dx = input.value.dx;
    const dy = input.value.dy;
    if (dx !== 0 || dy !== 0) {
      // 斜向归一化：任意方向速度一致
      const len = Math.hypot(dx, dy) || 1;
      me.x += (dx / len) * LOCAL_MOVE_SPEED_M * TICK_DT;
      me.y += (dy / len) * LOCAL_MOVE_SPEED_M * TICK_DT;
      // facing 统一角度制：0=右 90=下 180=左 270=上（与渲染层 dirIndex / facingLeft 一致）
      me.facing = (dx > 0 ? 0 : dx < 0 ? 180 : dy > 0 ? 90 : 270);
      input.value.moveTo = null;
    } else if (input.value.moveTo) {
      // 朝 moveTo 走一步
      const tx = input.value.moveTo.x;
      const ty = input.value.moveTo.y;
      const ddx = tx - me.x;
      const ddy = ty - me.y;
      const dist = Math.hypot(ddx, ddy);
      if (dist < 0.3) {
        input.value.moveTo = null;
      } else {
        const step = Math.min(dist, LOCAL_MOVE_SPEED_M * TICK_DT);
        me.x += (ddx / dist) * step;
        me.y += (ddy / dist) * step;
        me.facing = (Math.abs(ddx) > Math.abs(ddy))
          ? (ddx > 0 ? 0 : 180)
          : (ddy > 0 ? 90 : 270);
      }
    }
    // 松手立即停止：清空速度，宿主侧不会再产生余速滑行
    me.vx = 0;
    me.vy = 0;
    // 限制玩家在世界范围内（±1490，与 entry.ts 一致）
    me.x = Math.max(-WORLD_LIMIT_M, Math.min(WORLD_LIMIT_M, me.x));
    me.y = Math.max(-WORLD_LIMIT_M, Math.min(WORLD_LIMIT_M, me.y));

    // —— 碰撞检测：树/枯树/木桩不可穿越 —— 玩家半径 0.4 米，障碍半径 0.5 米
    const PLAYER_R = 0.4;
    const OBSTACLE_R = 0.5;
    const decos = mapCfg.value?.decorations || [];
    for (const dec of decos) {
      // mulberry 风格：9298 木桩作为边界围墙（与树同效）
      if (dec.kind !== "tree" && dec.kind !== "dead_tree" && dec.kind !== "fence") continue;
      const dx = me.x - dec.x;
      const dy = me.y - dec.y;
      const d = Math.hypot(dx, dy);
      const minDist = PLAYER_R + OBSTACLE_R;
      if (d < minDist && d > 0.001) {
        // 推回到刚好不撞的位置
        const push = (minDist - d);
        me.x += (dx / d) * push;
        me.y += (dy / d) * push;
      } else if (d <= 0.001) {
        // 玩家与障碍完全重合，极端情况，往上推 0.1 米
        me.y += 0.1;
      }
    }

    // 记录本地权威位姿，供 onHostState 覆盖宿主回推值
    lastLocalPose = { x: me.x, y: me.y, facing: me.facing };
  }

  // 区域刷新追踪（支持圆形和矩形区域）
  const meForZone = s.entities.find((e) => e.side === "player");
  const zones = (state.value?.map?.zones?.length ? state.value.map.zones : mapCfg.value?.zones) || [];
  const zone = zones.find((z: any) => {
    if (!meForZone) return false;
    // 优先用矩形范围（rx/ry），否则用圆形（r）
    if (z.rx !== undefined && z.ry !== undefined) {
      return meForZone.x >= z.x - z.rx && meForZone.x <= z.x + z.rx &&
             meForZone.y >= z.y - z.ry && meForZone.y <= z.y + z.ry;
    }
    return Math.hypot(z.x - meForZone.x, z.y - meForZone.y) <= z.r;
  });
  const zoneName = zone?.name ?? null;
  if (zoneName !== currentZoneName) {
    if (currentZoneName !== null && zoneRespawnReady === false) {
      // 离开了区域，启动 45 秒计时器
      zoneLeftTick = s.tick;
      zoneRespawnReady = false;
    }
    currentZoneName = zoneName;
  }
  // 检查是否 45 秒已过（每 tick = 100ms）
  if (zoneLeftTick > 0 && !zoneRespawnReady) {
    const elapsedSec = ((s.tick - zoneLeftTick) * TICK_DT);
    if (elapsedSec >= ZONE_RESPAWN_SEC) {
      zoneRespawnReady = true;
      zoneLeftTick = 0;
    }
  }

  // ★ chunk 系统：每 tick 推进一次（玩家移动后更新 loaded_chunks）
  if (chunkSystem && lastLocalPose) {
    chunkSystem.updateAroundPlayer(lastLocalPose.x, lastLocalPose.y, performance.now());
    chunkSystem.tick();
  }
  // 2. 推进 tick 计数
  s.tick = (s.tick || 0) + 1;
  // 3. 定期补 spawn 野兽（每 600 tick = 60 秒一波）— mockHost 跑的时候这步无效（会跳过已有 enemy）
  if (s.tick % 600 === 0) spawnLocalMobsIfNeeded();
}

// 方向索引（pixi_game 约定）：0=下 1=左 2=右 3=上
// ★ facing 统一角度制：0=右 90=下 180=左 270=上（与 localTick / 渲染层一致，原映射左右互换）
function dirIndex(facing: number): number {
  const d = ((facing % 360) + 360) % 360;
  if (d >= 315 || d < 45)  return 2;  // 右
  if (d >= 45  && d < 135) return 0;  // 下
  if (d >= 135 && d < 225) return 1;  // 左
  return 3;                            // 上
}

// 动画帧索引（用时间戳循环）
let _animTick = 0;
function animFrame(phase: "walk" | "idle"): number {
  if (phase === "idle") return 0;
  // 4帧循环
  return Math.floor(_animTick / 8) % 4;
}

/* ---------------- 动画（与 Rotten-Soup 一致：永远 2 帧 walk 循环） ---------------- */
// 不需要 isMoving——所有 sprite 都用 walk 帧循环播放（约 16 FPS）。
// _animTick 在 loop() 里每帧 ++，每 8 tick 切换一次帧。

/* ---------------- 尺寸基准（★ v4：以「地格」为唯一尺度基准，对齐 Rotten-Soup） ----------------
 * Rotten-Soup 的 sprite 与地面图块同为 32×32：角色、树、灌木在画面里都占「1 格」，
 * 所以人与树差不多高、剪影都清晰可辨 —— 比例天然协调。
 * toonflow v1~v3 曾用"米 × ppm"给角色定 1.6~1.8 米、树定 2.6×3.0 米，
 * 两者都远离"1 格"这一基准，于是"比例完全失衡、各种东西都很诡异"。
 * v4 起一律用格数描述尺寸：屏幕像素 = 格数 × sx（每格像素），随 zoom 等比缩放。
 * ----------------------------------------------------------------------------------- */
/**
 * 角色显示尺寸（单位：地表格，1 格 = 1 米）
 *
 * 对照 Rotten-Soup（32×32 图块）：角色、树、灌木在画面里都占「1 格」——
 * 所以人与树差不多高、各自剪影清晰可辨。toonflow 旧实现把角色放大到 1.6~1.8 格、
 * 树放大到 2.6×3.0 格，两者都远离 1 格基准，于是"比例完全失衡、各种东西都很诡异"。
 * v4 改为以「格」为唯一尺度基准：屏幕像素 = 格数 × sx（每格像素），随 zoom 等比缩放。
 */
const ENTITY_DIM_TILES: Record<string, number> = {
  player:      1.00,  // 金甲战士（与地格同尺寸，与树同级）
  ally:        1.00,  // 蓝袍法师
  enemy_char:  1.05,  // 持枪骑士
  // 野怪：族内保留体型差，但不偏离"1 格级"，避免大小怪一样大
  goblin:   0.95,
  orc:      1.15,
  rat:      0.70,
  goat:     1.00,
  snake:    0.85,
  bat:      0.75,
  skeleton: 1.05,
  minotaur: 1.45,     // boss
};

/**
 * 场景道具显示尺寸（单位：地表格）——树 / 灌木 / 水面都是 1 格级，与角色同一尺度基准。
 * 树略高（1.15 格）以保证剪影可读，但与角色同量级，不再出现"树比人高一倍"的失衡。
 */
const SCENE_PROP_DIM_TILES: Record<string, { w: number; h: number }> = {
  tree:  { w: 1.15, h: 1.15 },
  bush:  { w: 1.00, h: 1.00 },
  water: { w: 1.00, h: 1.00 },
};

/** 实体显示尺寸（格 → 屏幕像素，1:1 宽高；取整保证"每格整数像素"，避免非整数缩放接缝） */
function fitDim(key: string, sx: number): { w: number; h: number } {
  const t = ENTITY_DIM_TILES[key] ?? 1.0;
  const px = Math.max(4, Math.round(t * sx));
  return { w: px, h: px };
}

/** 道具尺寸（格 → 屏幕像素；minPx 仅防极端情况归零） */
function propDimPx(kind: "tree" | "bush" | "water", sx: number, minPx = 8): { w: number; h: number } {
  const t = SCENE_PROP_DIM_TILES[kind] || { w: 1.0, h: 1.0 };
  return { w: Math.max(minPx, Math.round(t.w * sx)), h: Math.max(minPx, Math.round(t.h * sx)) };
}

/**
 * ★ fix③：实体"显示位置"插值
 *
 * 宿主推送（postMessage / HTTP 桥）的到达节奏与渲染帧率（60fps）不一致，且可能成批补发；
 * 直接把推送坐标画出来，就是"长时间不动 → 一帧跳一段"的瞬移观感（用户反馈的
 * "松手后野怪瞬间跳到旁边"正是这种阶跃）。
 * 这里给每个实体维护一个显示位置，按帧向权威位置收敛：
 *   - 常规移动：指数收敛（时间常数 DISPLAY_TAU_S），把阶跃磨成平滑滑动；
 *   - 位移较大（推送成批补发）：按 DISPLAY_MAX_STEP_MPS 限速滑动，绝不出现"一帧跳一段"；
 *   - 位移超过 DISPLAY_SNAP_M（真传送 / 新实体）：直接吸附，避免长距离拖尾。
 *   - 玩家本身不插值（相机用的就是它的权威坐标，插值会导致画面与相机错位）。
 */
/**
 * ★ fix①：移动端性能档位
 *  判定：UA 含 Android/iPhone/iPad/… 或「触摸设备 + 短边 ≤ 820px」（手机/平板 WebView）。
 *  该档位下：渲染帧率封顶 30fps、tick 上报降到 5Hz、插值时间常数放宽。
 */
const IS_MOBILE = (() => {
  try {
    const ua = navigator.userAgent || "";
    const mobileUA = /Android|iPhone|iPad|iPod|HarmonyOS|Windows Phone|Mobile/i.test(ua);
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const sw = (window.screen && window.screen.width) || 9999;
    const sh = (window.screen && window.screen.height) || 9999;
    return mobileUA || (touch && Math.min(sw, sh) <= 820);
  } catch { return false; }
})();

/** ★ fix①：移动端渲染帧间隔（约 30fps）；桌面端 0 = 不限制（跟随 rAF） */
const MIN_FRAME_MS = IS_MOBILE ? 33 : 0;
/** ★ fix①：移动端向宿主上报 tick 的间隔（宿主只镜像位姿，5Hz 足够；本地 tick 仍 10Hz） */
const SEND_MS = IS_MOBILE ? 200 : 100;

const DISPLAY_TAU_S = IS_MOBILE ? 0.16 : 0.08;  // 收敛时间常数（秒）：移动端上报更稀，放宽以免一顿一顿
const DISPLAY_MAX_STEP_MPS = 15;    // 显示位置追赶速度上限（米/秒）：位移大时限速，磨掉阶跃
const DISPLAY_SNAP_M = 25;          // 单帧位移阈值（米）：超过视为真传送，直接吸附
const displayPos = new Map<string, { x: number; y: number }>();
let lastRenderAt = 0;

function entityDisplayPos(e: Entity, dtSec: number): { x: number; y: number } {
  let cur = displayPos.get(e.id);
  if (!cur) {
    // 新出现的实体：首次直接落在权威位置（不做从原点滑入）
    cur = { x: e.x, y: e.y };
    displayPos.set(e.id, cur);
    return cur;
  }
  const dx = e.x - cur.x;
  const dy = e.y - cur.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.0001) return cur;
  if (d > DISPLAY_SNAP_M) {
    // 真传送：一步到位
    cur.x = e.x;
    cur.y = e.y;
    return cur;
  }
  const dt = Math.max(dtSec, 0.001);
  let k = 1 - Math.exp(-dt / DISPLAY_TAU_S);
  const maxK = (DISPLAY_MAX_STEP_MPS * dt) / d;   // 单帧追赶上限
  if (k > maxK) k = maxK;
  cur.x += dx * k;
  cur.y += dy * k;
  return cur;
}

function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, avatarImg?: HTMLImageElement, sx?: number, sy?: number, ppm?: number) {
  // ★ v3：sx/sy 是外部算好的屏幕像素位置（不参与 ctx.scale）
  // 缺省时回退到 e.x / e.y（米），保证非世界变换下的旧调用仍能工作
  const px = (sx ?? (e.x + W_DEFAULT / 2));
  const py = (sy ?? (e.y * DEPTH + H_DEFAULT / 2));
  // ★ v3：sprite 尺寸 = 米数 × ppm（与 zoom 关联，随 zoom 缩放）
  const pixelsPerMeter = (ppm ?? 20);
  // ★ 根据 side 选择 sprite key（角色从 tileset 切片，支持 2 帧 walk 动画）
  const key = e.side === "player" ? "player"
            : e.side === "ally"   ? "ally"
            : e.side === "neutral" ? "ally"     // ★ v4：城镇中立角色用友方 sprite，避免显示成敌人
            : "enemy_char";
  // ★ 永远 walk 帧循环（与 Rotten-Soup 一致：sprite.animationSpeed=0.065）
  const tileId = spriteTileId(key, _animTick);
  // ★ v5 修正：fitDim 返回的已是「屏幕像素」（格数 × sx），此处严禁再乘一次
  //   pixelsPerMeter（历史 bug：tile 数 × sx² 会把角色放大到 400~1024px）。
  //   与 drawMonster 的 dw = 格数 × ppm 保持完全一致的口径。
  const dim = fitDim(key, pixelsPerMeter);
  const dw = dim.w;
  const dh = dim.h;
  const dx = px - dw / 2;
  const dy = py - dh + 4; // 略微下沉，让脚站在地面上

  // ★ 朝向：facing 在 135-315（朝左）时水平翻转 sprite
  const facingLeft = (e.facing >= 135 && e.facing < 315);

  applyPixelPerfect(ctx);

  // 阴影（脚底）
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(px, py + 4, dw * 0.55, dw * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 精灵本体（从 tileset 切片，按移动状态切换 walk 帧；facing 决定翻转）
  if (SHEET_TILESET.ready) {
    drawTile(ctx, tileId, dx, dy, dw, dh, !facingLeft);
  } else {
    // 兜底彩色胶囊
    const color = e.side === "player" ? "#4ea1ff"
      : e.side === "ally" ? "#5fd28a"
      : e.side === "enemy" ? "#ff6b6b"
      : e.side === "neutral" ? "#e0c86a"
      : "#9aa4b2";
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(px, py - 24, facingLeft ? -16 : 16, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ★ 角色头像（req.md：2.5D 小人模型上方显示头像 + 角色名）
  // 布局自上而下：头像(30) → 名字 → sprite
  const avatarSize = Math.max(14, Math.min(40, Math.round(dw * 0.8)));  // ★ v4：随角色尺寸（≈0.8 格）
  const avatarX = px - avatarSize / 2;
  const avatarY = dy - avatarSize - 16;
  // ★ fix⑥：动图头像优先取「当前动画帧」，静态图仍走 HTMLImageElement
  const avatarPath = entityAvatarPath(e);
  const animFrame = avatarAnimFrame(avatarPath);
  const hasAvatar = !!animFrame || (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0);
  if (hasAvatar) {
    applyPixelPerfect(ctx);
    ctx.save();
    // 头像底色（遮住背后内容）
    ctx.fillStyle = "#1e1f1f";
    ctx.beginPath();
    ctx.arc(px, avatarY + avatarSize / 2, avatarSize / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    // 圆形裁剪绘制头像
    ctx.beginPath();
    ctx.arc(px, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(animFrame ?? avatarImg!, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
    // 头像边框（不同阵营不同颜色）
    ctx.save();
    ctx.strokeStyle = e.side === "player" ? "#4ea1ff" : e.side === "ally" ? "#5fd28a" : "#ff4c4c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 头顶名字：有头像时放头像下方，无头像时贴 sprite 上方
  const headY = hasAvatar ? avatarY + avatarSize + 11 : dy - 6;
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "bold 11px 'Microsoft YaHei', sans-serif";
  ctx.fillStyle = "rgba(0,0,0,.85)";
  ctx.fillText(e.name.slice(0, 4), px + 1, headY + 1);
  ctx.fillStyle = e.side === "enemy" ? "#ffd4d4" : "#fff";
  ctx.fillText(e.name.slice(0, 4), px, headY);
  ctx.restore();

  // 血条 - 紧贴 sprite 下边缘（屏幕像素）
  const barW = Math.max(24, Math.round(dw) + 2), barH = 4;
  const barX = px - barW / 2;
  const barY = py + 8; // 在脚底
  ctx.save();
  // 边框
  ctx.fillStyle = "rgba(0,0,0,.85)";
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
  // 背景
  ctx.fillStyle = "#3a0d0d";
  ctx.fillRect(barX, barY, barW, barH);
  // 前景
  const hpRatio = Math.max(0, e.hp / e.maxHp);
  ctx.fillStyle = e.side === "enemy" ? "#d63b3b" : "#4ec74e";
  ctx.fillRect(barX, barY, barW * hpRatio, barH);
  ctx.restore();
}

// ----------------------------------------------------------
// 绘制野怪（Rotten-Soup 32×32 像素艺术）
// ★ 严格保持原图比例（不变形）：
//   bear content 24×30 → 0.8 → dh=40 → dw=32
//   beast content 32×30 → 1.067 → dh=40 → dw=42
// ----------------------------------------------------------
function drawMonster(ctx: CanvasRenderingContext2D, e: Entity, sx?: number, sy?: number, ppm?: number) {
  // ★ v3：sx/sy 是屏幕像素位置
  const px = (sx ?? (e.x + W_DEFAULT / 2));
  const py = (sy ?? (e.y * DEPTH + H_DEFAULT / 2));
  // ★ v3：sprite 尺寸 = 米数 × pixelsPerMeter（随 zoom 缩放）
  const pixelsPerMeter = (ppm ?? 20);
  // ★ 根据野怪名字映射到 tileset monster tile
  const key = mobKeyFor(e.name);
  // ★ 永远 walk 帧循环（Rotten-Soup 风格）
  const tileId = spriteTileId(key, _animTick);
  // 等比缩放（米数 × pixelsPerMeter → 屏幕像素）
  const targetTiles = ENTITY_DIM_TILES[key] ?? 1.0;   // ★ v4：格数基准（与角色/树同尺度）
  const dw = Math.max(4, Math.round(targetTiles * pixelsPerMeter));
  const dh = Math.max(4, Math.round(targetTiles * pixelsPerMeter));
  const dx = px - dw / 2;
  const dy = py - dh + 4;

  applyPixelPerfect(ctx);

  // 阴影
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(px, py + 4, dw * 0.55, dw * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (SHEET_TILESET.ready) {
    drawTile(ctx, tileId, dx, dy, dw, dh);
  } else {
    // 兜底：棕色圆
    ctx.save();
    ctx.fillStyle = "#8b5a2b";
    ctx.beginPath();
    ctx.ellipse(px, py - 16, 14, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 血条
  const barW = Math.max(24, Math.round(dw) + 2), barH = 4;
  const barX = px - barW / 2;
  const barY = dy - 6;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.85)";
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
  ctx.fillStyle = "#3a0d0d";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = "#d63b3b";
  ctx.fillRect(barX, barY, barW * Math.max(0, e.hp / e.maxHp), barH);
  ctx.restore();
}
/* ---------------- 地表噪声（多样化地表，模块级纯函数） ---------------- */

/** 二维格点 hash → [0,1) */
function hash2(ix: number, iz: number, seed: number): number {
  const s = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 二维 value-noise（双线性 + smoothstep 插值）→ [0,1)，cell 为米 */
function valueNoise2D(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

/**
 * 世界坐标（米）→ 地表 tile id（草地 / 泥土 / 沙地）
 *
 * ★ v6：对照 Rotten-Soup 的实测地表构成（其 maps 里主草图块 id=7864 占各地图地表
 *   76.9%，其余图块都只占几个百分点）——即"一个无缝主块铺满 + 大尺度稀疏变体"。
 *   - biome（约 26 米）决定该处是 草 / 泥 / 沙；
 *   - tone （约 12 米）只在该地貌内部二选一，且必须是同色系、无缝平铺的相邻块。
 * v5 仍出现棋盘格的根因：旧表把「纯色平滑块 7149」与「强纹理块 9378」按 3 米噪声
 * 对半混铺，每 3 格就跳一次"纯色 ↔ 纹理"，等于把图块的方形边界画在地上；v6 换用
 * Rotten-Soup 自己的主草块并把变体降到约 1/4、尺度拉到 12 米，消除该跳变。
 */
function pickGroundTile(tiles: number[], t: number): number {
  const idx = t < GROUND_TONE_SPLIT ? 0 : 1;
  return tiles[Math.min(tiles.length - 1, idx)];
}

function groundTileAt(wx: number, wz: number): number {
  const biome = valueNoise2D(wx, wz, GROUND_BIOME_SCALE_M, 11);
  const tone = valueNoise2D(wx, wz, GROUND_TONE_SCALE_M, 23);
  if (biome < GROUND_SAND_MAX) return pickGroundTile(GROUND_SAND_TILES, tone);
  if (biome < GROUND_DIRT_MAX) return pickGroundTile(GROUND_DIRT_TILES, tone);
  return pickGroundTile(GROUND_GRASS_TILES, tone);
}

/* ---------------- ★ fix① 地面图块记忆化缓存 ---------------- */
/** 缓存键 = (gx+32768)*65536 + (gz+32768)；世界格号 ±1500 ≪ 32768，无碰撞 */
const groundTileCache = new Map<number, number>();
const GROUND_TILE_CACHE_MAX = 20000;
function groundTileAtFast(gx: number, gz: number): number {
  const key = (gx + 32768) * 65536 + (gz + 32768);
  const hit = groundTileCache.get(key);
  if (hit !== undefined) return hit;
  const v = groundTileAt(gx * GROUND_CELL_M, gz * GROUND_CELL_M);
  if (groundTileCache.size >= GROUND_TILE_CACHE_MAX) groundTileCache.clear();
  groundTileCache.set(key, v);
  return v;
}

function render() {
  const c = canvasEl.value;
  const s = state.value;
  if (!c || !s) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  // ★ fix⑤：位图缓冲 = 逻辑尺寸 × k（k = 显示尺寸 × DPR / 逻辑尺寸）。
  //   逻辑坐标系保持原设计值，下面所有像素常量（头像 40px、字号、线宽）视觉大小
  //   完全不变，只是位图密度提到物理像素级 → 不再被浏览器放大搞糊。
  const k = renderScale.value > 0 ? renderScale.value : 1;
  const W = Math.round(c.width / k);
  const H = Math.round(c.height / k);
  ctx.setTransform(k, 0, 0, k, 0, 0);

  /* ============================================================
     相机数学（来自 map_config.json + zoom 系统）
       view_radius_m = def_view_max * (default_zoom / zoom)
       在 zoom=20 时，看到 ±15 米（30×30）窗口
       玩家坐标 → 屏幕坐标：pixel = (entity.x - player.x) * ppm + W/2
       使用 ctx.transform 把世界米坐标自动投影为屏幕像素
     ============================================================ */
  const ts = terrainScale.value;
  const pp = playerPos.value;
  const [vw, vh] = ts.viewSizeMeters(zoom.value);
  // pixel-per-meter：纵向按 DEPTH 做视角压缩（DEPTH=1 即等距俯视）
  const ppm_x = W / vw;
  const ppm_y = H / (vh * DEPTH);
  // ★ v4：取整为"每米整数像素"——地块 / 精灵都落在整数像素边界上，
  //   避免非整数缩放带来的接缝、摩尔纹与逐像素游动（世界格与地表格严格对齐）。
  // ★ v5：改为「覆盖式」取较大比值（对应 Rotten-Soup 的 stage 缩放基准 px/米），
  //   保证 1 格 = 1 米 = 整数像素时精灵与图块 1:1 贴图（默认 zoom=20 → 32px，
  //   与 Rotten-Soup tileSize=32 一致）；若取 min 会得到 20px，
  //   画布两侧多出 9m 无实体区域且图块被 0.625 非整数缩小，产生新接缝。
  const sx = Math.max(4, Math.round(Math.max(ppm_x, ppm_y)));
  const sy = sx;

  // ★ 动态同步 ready 状态（data URL 图片解码完成时）
  for (const sheet of [SHEET_TILESET, SHEET_PLAYER, SHEET_ALLY, SHEET_ENEMY_CHAR]) {
    if (!sheet.ready && sheet.img.complete && sheet.img.naturalWidth > 0) {
      sheet.ready = true;
    }
  }

  ctx.clearRect(0, 0, W, H);

  // 地面：dawnlike tileset 平铺（★ v4：1 格 = 1 米 = 1 张 32×32 图块，严格对齐世界格）
  //   与 Rotten-Soup 同构：地块恒定 1 格、格边固定在世界坐标上；
  //   移动时整片地貌随世界滚动，不会出现贴图逐像素游动 / 摩尔纹；
  //   配色见 groundTileAt：大尺度分草/泥/沙，同一地貌内部只换深浅 → 不再有棋盘格。
  if (SHEET_TILESET.ready) {
    const cellPx = Math.max(4, Math.round(GROUND_CELL_M * sx));  // 1 格在屏幕上的像素（整数，无接缝）
    const minWX = (pp?.x ?? 0) - W / (2 * sx);                   // 屏幕左边缘的世界 X（米）
    const minWZ = (pp?.y ?? 0) - H / (2 * sx);                   // 屏幕上边缘的世界 Z（米）
    const gx0 = Math.floor(minWX / GROUND_CELL_M);               // 起始世界格号
    const gz0 = Math.floor(minWZ / GROUND_CELL_M);
    // 起始格左上角的屏幕像素（取整后按整数像素步进 → 与世界格对齐且无累积误差）
    const originX = Math.round((gx0 * GROUND_CELL_M - minWX) * sx);
    const originZ = Math.round((gz0 * GROUND_CELL_M - minWZ) * sx);
    const nx = Math.ceil(W / cellPx) + 2;
    const nz = Math.ceil(H / cellPx) + 2;
    // ★ fix①（性能）：地面图块走记忆化缓存。
    //   groundTileAt 每格要做两次二维 value-noise（各 4 次哈希 + 双线性插值），
    //   而同一格在静止/缓慢移动时会被反复求值（每帧 nx×nz ≈ 700~900 次），
    //   手机上这是每帧最大的 CPU 开销之一。地貌是确定性的 → 同格只算一次。
    for (let j = 0; j < nz; j++) {
      const gzj = gz0 + j;
      const ty = originZ + j * cellPx;
      for (let i = 0; i < nx; i++) {
        drawTile(ctx, groundTileAtFast(gx0 + i, gzj), originX + i * cellPx, ty, cellPx, cellPx);
      }
    }
  } else {
    // 兜底渐变（暗泥土色，Rotten-Soup 风格）
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#3a2418");
    g.addColorStop(1, "#1a1208");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ★ 地图 zones（map-gener agent 产出 + mulberryTown.json 静态数据）：
  // 不同 kind 不同色调椭圆区域。画在相机变换内。
  // ★ v4：新增区域 kind 配色（城镇安全区 + 6 个野区；旧 kind 保留兼容）
  const kindColors: Record<string, string> = {
    safe: "rgba(94, 210, 138, .18)",
    danger: "rgba(255, 80, 80, .18)",
    loot: "rgba(224, 178, 74, .2)",
    quest: "rgba(110, 168, 254, .18)",
    forest: "rgba(94, 178, 106, .14)",
    shore: "rgba(96, 176, 196, .14)",
    mine: "rgba(178, 150, 96, .14)",
    ruin: "rgba(168, 132, 168, .14)",
    marsh: "rgba(110, 156, 128, .14)",
    wild: "rgba(196, 156, 96, .14)",
  };
  const allZones = (s.map?.zones?.length ? s.map.zones : mapCfg.value?.zones) || [];

  /* ============================================================
     关键修复：放弃 ctx.scale 世界变换，全部改用屏幕像素空间画
     每个 item 自己算 worldToScreen(mx, mz) → 屏幕 (px, py)
     sprite 尺寸常量保持「像素」单位（不会再被 sx 缩放成几十米）
     ============================================================ */
  const wx2px = (mx: number) => (mx - pp.x) * sx + W / 2;       // 世界米 X → 屏幕像素 X
  const wz2py = (mz: number) => (mz - pp.y) * sx * DEPTH + H / 2; // 世界米 Z → 屏幕像素 Y（带 2.5D 压缩）
  const m2px = (m: number) => m * sx;                           // 任意米数 → 屏幕像素

  // —— zones（米 → 像素）——
  allZones.forEach((z) => {
    const zx_px = wx2px(z.x);
    const zy_px = wz2py(z.y);
    const r_px  = m2px(z.r);
    const ry_px  = r_px;   // ★ v4：DEPTH=1 → 正圆，不再纵向压扁
    ctx.save();
    ctx.fillStyle = kindColors[(z as any).kind] || "rgba(255,255,255,.06)";
    ctx.strokeStyle = "rgba(255,255,255,.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(zx_px, zy_px, r_px, ry_px, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.font = "bold 12px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(z.name, zx_px, zy_px - 4);
    ctx.restore();
  });

  // ★ v4：城镇（安全区）建筑 —— 由宿主 state.town.buildings 驱动
  //   w/h 现在是瓦片数（与 Rotten-Soup mulberryTown.json 同构），
  //   按 Dawnlike tileset 真实像素平铺绘制：屋顶 + 墙体 + 门 / 窗 + 地面。
  const townExtra = (s as unknown as {
    town?: { name?: string; x?: number; y?: number; r?: number; buildings?: Array<{ id: string; kind?: string; name?: string; x: number; y: number; w: number; h: number }> };
  }).town;
  if (townExtra && Array.isArray(townExtra.buildings) && townExtra.buildings.length) {
    // 远景：缩放过小（< 8 px / tile）时只画一个色块 + 名字，避免 4x4 像素的屋顶拼出来全是噪点
    const lowDetail = sx < 8;
    if (lowDetail) {
      const blockColor: Record<string, string> = {
        inn:   "#7c4b3a",
        shop:  "#5c5340",
        house: "#6b4a3a",
        well:  "#3f4a52",
      };
      townExtra.buildings.forEach((b) => {
        const bxx = wx2px(b.x);
        const byy = wz2py(b.y);
        const bw = Math.max(4, m2px(b.w));
        const bh = Math.max(4, m2px(b.h));
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#000";
        ctx.fillRect(bxx - bw / 2 + 2, byy - bh / 2 + 3, bw, bh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = blockColor[b.kind || "house"] || blockColor.house;
        ctx.fillRect(bxx - bw / 2, byy - bh / 2, bw, bh);
        ctx.strokeStyle = "rgba(20,14,8,.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bxx - bw / 2, byy - bh / 2, bw, bh);
        ctx.restore();
      });
    } else if (SHEET_TILESET.ready) {
      // tileset 已就绪 → 用真实像素艺术（与 Rotten-Soup mulberryTown.json 同构）
      townExtra.buildings.forEach((b) => drawTownBuildingTiles(ctx, b, sx, wx2px, wz2py));
    } else {
      // 兜底：tileset 未就绪时的纯色块（与旧版一致）
      const blockColor: Record<string, string> = {
        inn:   "#7c4b3a",
        shop:  "#5c5340",
        house: "#6b4a3a",
        well:  "#3f4a52",
      };
      townExtra.buildings.forEach((b) => {
        const bxx = wx2px(b.x);
        const byy = wz2py(b.y);
        const bw = Math.max(4, m2px(b.w));
        const bh = Math.max(4, m2px(b.h));
        const fill = blockColor[b.kind || "house"] || blockColor.house;
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#000";
        ctx.fillRect(bxx - bw / 2 + 2, byy - bh / 2 + 3, bw, bh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = fill;
        ctx.fillRect(bxx - bw / 2, byy - bh / 2, bw, bh);
        ctx.strokeStyle = "rgba(20,14,8,.85)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bxx - bw / 2, byy - bh / 2, bw, bh);
        ctx.restore();
      });
    }
    // 建筑名（任意缩放都画，缩放过小时省略字体）
    if (sx >= 8) {
      townExtra.buildings.forEach((b) => {
        const bxx = wx2px(b.x);
        const byy = wz2py(b.y);
        const bw = Math.max(4, m2px(b.w));
        const bh = Math.max(4, m2px(b.h));
        ctx.save();
        ctx.fillStyle = "rgba(255,246,214,.92)";
        ctx.font = `bold ${Math.max(9, Math.min(13, Math.round(sx * 0.55)))}px 'Microsoft YaHei', sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(b.name || "", bxx, byy - bh / 2 - 4);
        ctx.restore();
      });
    }
  }

  // —— 土路（道路网络）——
  // 绘制十字形土路：水平 y=0 和垂直 x=0，宽 1.5 米
  if (SHEET_TILESET.ready) {
    const roadW = Math.max(1, Math.round(1.5 * sx));
    // 水平路
    ctx.save();
    for (let x = -30; x <= 30; x++) {
      const pxr = wx2px(x);
      drawTile(ctx, 7765, pxr, wz2py(0) - roadW / 2, sx, roadW);
    }
    // 垂直路
    for (let z = -30; z <= 30; z++) {
      const pyr = wz2py(z);
      drawTile(ctx, 7765, wx2px(0) - roadW / 2, pyr, roadW, sx);
    }
    ctx.restore();
  } else {
    // 兜底：纯色棕色
    const roadW = Math.max(2, Math.round(1.5 * sx));
    ctx.fillStyle = "#6b4423";
    ctx.fillRect(0, wz2py(0) - roadW / 2, W, roadW);
    ctx.fillRect(wx2px(0) - roadW / 2, 0, roadW, H);
  }

  // —— 装饰物（树/枯树/灌木/蘑菇/花/水/石/药水，按像素尺寸）——
  // ★ 视野过滤：只渲染屏幕可见范围附近的装饰（mulberry 后总量 4369+，否则每帧遍历爆卡）
  const viewRadiusX_m = vw / 2 + 4;  // 米
  const viewRadiusY_m = vh / 2 + 4;
  const pxCenter = pp?.x ?? 0;
  const pyCenter = pp?.y ?? 0;
  // ★ 按区域加载 + 视野渲染：只遍历当前 loaded_chunks 内的装饰（mulberry 4369 → 当前 ~几十）
  //   双层循环：chunk × 装饰，每层都做距离粗筛
  if (chunkSystem) {
    for (const chunkKey of chunkSystem.loaded_chunks) {
      const chunkDecs = decorationsByChunk.get(chunkKey);
      if (!chunkDecs) continue;
      for (const dec of chunkDecs) {
        if (Math.abs(dec.x - pxCenter) > viewRadiusX_m) continue;
        if (Math.abs(dec.y - pyCenter) > viewRadiusY_m) continue;
        renderOneDecoration(ctx, dec, wx2px(dec.x), wz2py(dec.y), sx);
      }
    }
  } else {
    // 兜底：chunkSystem 未初始化时退化为遍历全量
    for (const dec of mapDecorations.value) {
      if (Math.abs(dec.x - pxCenter) > viewRadiusX_m) continue;
      if (Math.abs(dec.y - pyCenter) > viewRadiusY_m) continue;
      renderOneDecoration(ctx, dec, wx2px(dec.x), wz2py(dec.y), sx);
    }
  }

  // —— 宝箱（像素尺寸 32×34）——
  s.chests.forEach((ch) => {
    const dh = Math.round(1.10 * sx), dw = Math.round(1.15 * sx);
    const cx = wx2px(ch.x);
    const cy = wz2py(ch.y);
    ctx.save();
    if (ch.opened) ctx.globalAlpha = 0.55;
    if (SHEET_TILESET.ready) {
      drawTile(ctx, ch.opened ? TILE_CHEST_OPEN_ID : TILE_CHEST_ID, cx - dw / 2, cy - dh + 4, dw, dh);
    } else {
      ctx.fillStyle = ch.opened ? "rgba(160,150,120,.5)" : "#e0b24a";
      ctx.strokeStyle = "rgba(0,0,0,.5)";
      ctx.lineWidth = 2;
      ctx.fillRect(cx - 14, cy - 14, 28, 22);
      ctx.strokeRect(cx - 14, cy - 14, 28, 22);
    }
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.7)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(ch.opened ? "空" : "宝箱", cx, cy - 20);
    ctx.restore();
  });

  // —— 血瓶（像素尺寸 16×24）——
  s.potions.forEach((p) => {
    const dh = Math.round(0.90 * sx), dw = Math.round(0.60 * sx);
    const cx = wx2px(p.x);
    const cy = wz2py(p.y);
    if (SHEET_TILESET.ready) {
      drawTile(ctx, TILE_POTION_ID, cx - dw / 2, cy - dh + 4, dw, dh);
    } else {
      ctx.save();
      ctx.fillStyle = "#ff5d7a";
      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("+", cx, cy + 4);
    ctx.restore();
  });

  // —— 实体（按 y 排序做前后遮挡，sprite 像素尺寸直接 draw）——
  const roleIds = new Set(s.roles.map((r) => r.id));
  const _nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const dtSec = Math.max(0.001, Math.min(0.1, lastRenderAt ? (_nowMs - lastRenderAt) / 1000 : 0.016));
  lastRenderAt = _nowMs;
  const aliveIds = new Set<string>();
  s.entities.forEach((e) => { if (e.alive !== false) aliveIds.add(e.id); });
  Array.from(displayPos.keys()).forEach((id) => { if (!aliveIds.has(id)) displayPos.delete(id); });
  [...s.entities]
    .filter((e) => e.alive !== false)
    .map((e) => {
      const d = e.side === "player" ? { x: e.x, y: e.y } : entityDisplayPos(e, dtSec);
      return { e, drawX: d.x, drawY: d.y };
    })
    .sort((a, b) => a.drawY - b.drawY)
    .forEach(({ e, drawX, drawY }) => {
      const ex = wx2px(drawX);
      const ey = wz2py(drawY);
      if (e.side === "enemy" && !roleIds.has(e.id)) {
        drawMonster(ctx, e, ex, ey, sx);
      } else {
        drawEntity(ctx, e, getEntityAvatar(e), ex, ey, sx);
      }
    });

  // —— 飘字（屏幕像素）——
  s.floaters.forEach((f) => {
    const fx = wx2px(f.x);
    const fy = wz2py(f.y);
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.life / 12);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.lineWidth = 3;
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.strokeText(f.text, fx, fy - 40);
    ctx.fillText(f.text, fx, fy - 40);
    ctx.restore();
  });

  // —— Debug 高亮（屏幕像素）——
  if (selectedEntityId.value) {
    const sel = s.entities.find((e) => e.id === selectedEntityId.value);
    if (sel) {
      const sxsel = wx2px(sel.x);
      const sysel = wz2py(sel.y);
      ctx.save();
      ctx.strokeStyle = "#ffe79e";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sxsel - 28, sysel - 56, 56, 64);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 231, 158, 0.9)";
      ctx.fillRect(sxsel - 28, sysel - 76, 56, 16);
      ctx.fillStyle = "#1e1f1f";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(sel.id, sxsel, sysel - 64);
      ctx.restore();
    }
  }
}

/** 单个装饰物的渲染（按区域加载后调用） */
function renderOneDecoration(
  ctx: CanvasRenderingContext2D,
  dec: Decoration,
  px: number,
  py: number,
  sx: number,
): void {
  {
    if (dec.kind === "tree" && SHEET_TILESET.ready) {
      // ★ fix①：树改走"米 × ppm"，与角色同一尺度基准（zoom=20 时 ≈60px，高于 1.6 米的小人）
      const d = propDimPx("tree", sx);
      drawTile(ctx, dec.variant === 0 ? TILE_TREE_ID : TILE_DEADTREE_ID, px - d.w / 2, py - d.h + 4, d.w, d.h);
    } else if (dec.kind === "ground" && SHEET_TILESET.ready) {
      // ★ mulberry 地表 tile（手工铺贴的特殊地块，比如路、广场、房屋地基）
      const tid = (dec as any).tileId ?? TILE_GRASS_MAIN_ID;
      const d = propDimPx("road", sx);
      drawTile(ctx, tid, px - d.w / 2, py - d.h + 4, d.w, d.h);
    } else if (dec.kind === "water" && SHEET_TILESET.ready) {
      // ★ fix①：水面同样按米（2 米 ≈ 40px）
      const d = propDimPx("water", sx);
      ctx.save(); ctx.globalAlpha = 0.9;
      drawTile(ctx, TILE_WATER_ID, px - d.w / 2, py - d.h + 4, d.w, d.h);
      ctx.restore();
    } else if (dec.kind === "bush" && SHEET_TILESET.ready) {
      // ★ fix①：灌木按米（1.1 米 ≈ 22px，与原像素尺寸接近，仅补上 zoom 联动）
      const d = propDimPx("bush", sx);
      drawTile(ctx, TILE_SHRUB_ID, px - d.w / 2, py - d.h + 4, d.w, d.h);
    } else if (dec.kind === "mushroom" && SHEET_TILESET.ready) {
      const dh = Math.round(0.90 * sx), dw = dh;
      drawTile(ctx, TILE_MUSHROOM_ID, px - dw / 2, py - dh + 4, dw, dh);
    } else if (dec.kind === "flower" && SHEET_TILESET.ready) {
      const dh = Math.round(0.80 * sx), dw = dh;
      drawTile(ctx, TILE_FLOWER_ID, px - dw / 2, py - dh + 4, dw, dh);
    } else if (dec.kind === "pot" && SHEET_TILESET.ready) {
      const dh = Math.round(0.90 * sx), dw = Math.round(0.60 * sx);
      drawTile(ctx, TILE_POTION_ID, px - dw / 2, py - dh + 4, dw, dh);
    } else if (dec.kind === "road" && SHEET_TILESET.ready) {
      // 土路 tile（用泥土 tile）
      drawTile(ctx, TILE_DIRT_MAIN_ID, px - sx / 2, py - sx / 2, sx, sx);
    } else if (dec.kind === "building" && SHEET_TILESET.ready) {
      // ★ mulberry 风格：用每个 tile 的真实 tileId（不是固定 3x3 模板）
      const tid = (dec as any).tileId;
      if (tid) {
        drawTile(ctx, tid, px - sx / 2, py - sx + 4, sx, sx);
      } else {
        // Fallback: 用模板（兼容旧的装饰物）
        const v = dec.variant || 0;
        const bw = sx * 3;
        const bh = sx * 3;
        const x0 = px - bw / 2;
        const y0 = py - bh + 4;
        drawTile(ctx, TILE_HOUSE_ROOF_LEFT_ID, x0, y0 - sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_MID_ID, x0 + sx, y0 - sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_RIGHT_ID, x0 + sx * 2, y0 - sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_LEFT_ID, x0, y0, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_MID_ID, x0 + sx, y0, sx, sx);
        drawTile(ctx, TILE_HOUSE_ROOF_RIGHT_ID, x0 + sx * 2, y0, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_LEFT_ID, x0, y0 + sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_MID_ID, x0 + sx, y0 + sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_RIGHT_ID, x0 + sx * 2, y0 + sx, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_LEFT_ID, x0, y0 + sx * 2, sx, sx);
        drawTile(ctx, TILE_HOUSE_DOOR_ID, x0 + sx, y0 + sx * 2, sx, sx);
        drawTile(ctx, TILE_HOUSE_TOP_RIGHT_ID, x0 + sx * 2, y0 + sx * 2, sx, sx);
        drawTile(ctx, TILE_HOUSE_BOTTOM_ID, x0, y0 + sx * 3, sx, sx);
        drawTile(ctx, TILE_HOUSE_DOOR_ID, x0 + sx, y0 + sx * 3, sx, sx);
        drawTile(ctx, TILE_HOUSE_BOTTOM_ID, x0 + sx * 2, y0 + sx * 3, sx, sx);
      }
    } else if (dec.kind === "building") {
      // Fallback: 纯色方块
      const bw = sx * 3, bh = sx * 3;
      const x0 = px - bw / 2, y0 = py - bh + 4;
      ctx.save();
      ctx.fillStyle = "#8a7a6a";
      ctx.fillRect(x0, y0, bw, bh);
      ctx.restore();
    } else if (dec.kind === "npc" && SHEET_TILESET.ready) {
      // NPC 用 tileset 绘制（头顶对话框 + 身体）
      const npcName = (dec as any).name || "NPC";
      // 对话气泡
      drawTile(ctx, TILE_DIALOG_BUBBLE_ID, px - sx * 0.5, py - sx * 2.2, sx, sx * 0.7);
      // NPC 身体（用树 tile 作为占位，后续可替换为 NPC tile）
      drawTile(ctx, TILE_SHRUB_ID, px - sx * 0.5, py - sx, sx, sx * 2);
      // 名字
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.font = "bold " + Math.max(6, Math.round(sx * 0.25)) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(npcName, px, py + sx * 1.2);
      ctx.restore();
    } else if (dec.kind === "npc") {
      // Fallback: 简化圆形
      const sz = Math.round(0.8 * sx);
      ctx.save();
      ctx.fillStyle = "#d4a574";
      ctx.beginPath();
      ctx.arc(px, py - sz * 0.3, sz * 0.4, 0, Math.PI * 2);
      ctx.fill();
      const npcName = (dec as any).name || "NPC";
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.font = "bold " + Math.max(6, Math.round(sx * 0.25)) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(npcName, px, py + sz * 0.4);
      ctx.restore();
    } else if (dec.kind === "fence" && SHEET_TILESET.ready) {
      // 用 tileset 木桩绘制栅栏（连续多个桩）
      const v = dec.variant || 0;
      // ★ mulberry 风格：有 tileId 用真实 tileId，否则用 3 桩模板
      const tid = (dec as any).tileId;
      if (tid) {
        drawTile(ctx, tid, px - sx / 2, py - sx + 4, sx, sx);
      } else {
        const gap = sx * 1.5;
        const numPosts = 3;
        for (let i = 0; i < numPosts; i++) {
          drawTile(ctx, TILE_FENCE_POST_ID, px - sx / 2 + i * gap, py - sx, sx, sx);
        }
        drawTile(ctx, TILE_FENCE_RAIL_ID, px - sx / 2, py - sx * 0.7, sx * 3, sx * 0.3);
      }
    } else if (dec.kind === "fence") {
      // Fallback: 棕色竖线
      const dh = Math.round(0.8 * sx), dw = Math.round(0.22 * sx);
      ctx.save();
      ctx.fillStyle = "#7a5a3a";
      ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
      ctx.restore();
    } else if (dec.kind === "furniture") {
      // 家具：根据 variant 显示不同物品
      const dh = Math.round(0.5 * sx), dw = Math.round(0.8 * sx);
      ctx.save();
      const variant = dec.variant || 0;
      if (variant === 0) {
        // 锻造台（铁匠）
        ctx.fillStyle = "#3a3a3a";
        ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
        ctx.fillStyle = "#ff6b1a";
        ctx.fillRect(px - dw / 4, py - dh + 4, dw / 2, dh / 2);
      } else if (variant === 1) {
        // 柜台（杂货）
        ctx.fillStyle = "#8b6914";
        ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
        ctx.fillStyle = "#d4a13e";
        ctx.fillRect(px - dw / 2 + 1, py - dh + 4, dw - 2, 1);
      } else if (variant === 2) {
        // 地毯（长者）
        ctx.fillStyle = "#a02828";
        ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
        ctx.fillStyle = "#ffd700";
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(px - dw / 2 + 1, py - dh + 5 + i * 2, dw - 2, 0.5);
        }
      } else {
        // 床（旅馆）
        ctx.fillStyle = "#a0826d";
        ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
        ctx.fillStyle = "#e0c8a8";
        ctx.fillRect(px - dw / 2 + 2, py - dh + 6, dw - 4, dh - 4);
      }
      ctx.restore();
    } else if (dec.kind === "farm" && SHEET_TILESET.ready) {
      // 农田用 tileset 绘制（与 Rotten-Soup 风格一致）
      // ★ mulberry 风格：每个 tile 用真实 tileId
      const tid = (dec as any).tileId;
      if (tid) {
        drawTile(ctx, tid, px - sx / 2, py - sx + 4, sx, sx);
      } else {
      const fw = sx * 3, fh = sx * 2;
      const x0 = px - fw / 2, y0 = py - fh + 4;
      // 3×2 农田格子
      drawTile(ctx, TILE_FARM_DIRT_ID, x0, y0, sx, sx);
      drawTile(ctx, TILE_FARM_GREEN_ID, x0 + sx, y0, sx, sx);
      drawTile(ctx, TILE_FARM_TOP_ID, x0 + sx * 2, y0, sx, sx);
      drawTile(ctx, TILE_FARM_DIRT_ID, x0, y0 + sx, sx, sx);
      drawTile(ctx, TILE_FARM_GREEN_ID, x0 + sx, y0 + sx, sx, sx);
      drawTile(ctx, TILE_FARM_TOP_ID, x0 + sx * 2, y0 + sx, sx, sx);
      }
    } else if (dec.kind === "farm") {
      // Fallback: 棕色田地
      const dh = Math.round(2 * sx), dw = dh;
      ctx.save();
      ctx.fillStyle = "#5c3a1e";
      ctx.fillRect(px - dw / 2, py - dh + 4, dw, dh);
      ctx.restore();
    } else if (dec.kind === "rock" && SHEET_TILESET.ready) {
      const dh = Math.round(0.9 * sx), dw = dh;
      drawTile(ctx, TILE_ROCK_ID, px - dw / 2, py - dh + 4, dw, dh);
    } else {
      // 兜底形状（屏幕像素）
      ctx.save(); ctx.globalAlpha = 0.5;
      if (dec.kind === "tree") {
        ctx.fillStyle = "#2d5a27";
        ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.fill();
      } else if (dec.kind === "water") {
        ctx.fillStyle = "#4a90d9";
        ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "#8b7355";
        ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
}
/* ---------------- ★ fix⑤/⑥ 迷你小地图 + 玩家坐标 ---------------- */
/** 小地图画布像素尺寸（CSS 同尺寸） */
const MINIMAP_PX = 110;
/** 小地图半径（米）：超出范围的目标钳制在边缘并描白边提示方位 */
const MINIMAP_RANGE_M = 150;  // ★加大到 150 米，完整显示城镇矩形 + 外部区域
const minimapEl = ref<HTMLCanvasElement | null>(null);

/**
 * 绘制迷你小地图：以玩家为中心，显示野怪/盟友/宝箱/血瓶的相对位置。
 * 独立于主画布的 ctx，由 loop()/`watch(phase)` 以 10Hz 调用。
 */
function drawMinimap() {
  const c = minimapEl.value;
  const s = state.value;
  if (!c || !s) return;
  const g = c.getContext("2d");
  if (!g) return;
  const N = MINIMAP_PX;
  const half = N / 2;
  const ppm = half / MINIMAP_RANGE_M;        // 像素/米
  const meE = s.entities.find((e) => e.side === "player");
  const px = meE ? meE.x : 0;
  const py = meE ? meE.y : 0;

  g.save();
  g.clearRect(0, 0, N, N);
  // 底色 + 刻度网格（四等分）
  g.fillStyle = "rgba(12,16,12,0.78)";
  g.fillRect(0, 0, N, N);
  g.strokeStyle = "rgba(190,205,170,0.16)";
  g.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    const t = Math.round((N / 4) * k) + 0.5;
    g.beginPath(); g.moveTo(t, 0); g.lineTo(t, N); g.stroke();
    g.beginPath(); g.moveTo(0, t); g.lineTo(N, t); g.stroke();
  }
  // 视野圈
  g.strokeStyle = "rgba(200,220,180,0.22)";
  g.beginPath();
  g.arc(half, half, half - 2, 0, Math.PI * 2);
  g.stroke();

  const dot = (x: number, y: number, color: string, r: number) => {
    let dx = (x - px) * ppm;
    let dy = (y - py) * ppm;
    const d = Math.hypot(dx, dy);
    const lim = half - 4;
    let clamped = false;
    if (d > lim) { const k = lim / d; dx *= k; dy *= k; clamped = true; }
    g.beginPath();
    g.fillStyle = color;
    g.arc(half + dx, half + dy, r, 0, Math.PI * 2);
    g.fill();
    if (clamped) { g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1; g.stroke(); }
  };

  // 宝箱 / 血瓶（宿主 state 有则画，没有则跳过）
  const extra = s as unknown as { chests?: Array<{ x: number; y: number }>; potions?: Array<{ x: number; y: number }> };
  if (Array.isArray(extra.chests)) extra.chests.forEach((o) => dot(o.x, o.y, "rgba(224,178,74,0.9)", 1.6));
  if (Array.isArray(extra.potions)) extra.potions.forEach((o) => dot(o.x, o.y, "rgba(228,132,196,0.9)", 1.6));

  // 野怪 / 盟友
  s.entities.forEach((e) => {
    if (e.alive === false) return;
    if (e.side === "enemy") dot(e.x, e.y, "#ff5b5b", 3);
    else if (e.side === "ally") dot(e.x, e.y, "#5b9bff", 2.4);
    else if (e.side === "neutral") dot(e.x, e.y, "#e0c86a", 2.2);   // ★ v4：城镇中立角色
  });

  // 玩家：恒在正中，有 facing 则画朝向箭头
  g.fillStyle = "#8ce07a";
  const face = (meE as unknown as { facing?: { x?: number; y?: number } } | undefined)?.facing;
  g.beginPath();
  if (face && typeof face === "object") {
    const ang = Math.atan2(face.y ?? 0, face.x ?? 1);
    g.moveTo(half + Math.cos(ang) * 5.4, half + Math.sin(ang) * 5.4);
    g.lineTo(half + Math.cos(ang + 2.4) * 4, half + Math.sin(ang + 2.4) * 4);
    g.lineTo(half + Math.cos(ang - 2.4) * 4, half + Math.sin(ang - 2.4) * 4);
    g.closePath();
  } else {
    g.arc(half, half, 3.2, 0, Math.PI * 2);
  }
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.65)";
  g.lineWidth = 1;
  g.stroke();

  // ★ v4：区域名称 —— 当前区域徽标（顶部）+ 邻近区域名称（按方位贴边指示）
  const zoneList = ((s.map?.zones?.length ? s.map.zones : mapCfg.value?.zones) || []) as Array<
    { name: string; x: number; y: number; r: number; kind?: string }
  >;
  if (zoneList.length) {
    const curZone = zoneList.find((z) => {
      if (z.rx !== undefined && z.ry !== undefined) {
        return Math.abs(z.x - px) <= z.rx && Math.abs(z.y - py) <= z.ry;
      }
      return Math.hypot(z.x - px, z.y - py) <= z.r;
    });
    g.save();
    // 绘制区域范围圆圈（边界）
    zoneList.forEach((z) => {
      const dxw = (z.x - px) * ppm;
      const dyw = (z.y - py) * ppm;
      const lx = half + dxw;
      const ly = half + dyw;
      // 安全区=绿色半透明，危险区=红色半透明，普通=棕色半透明
      g.beginPath();
      if (z.kind === "safe") {
        g.strokeStyle = "rgba(140,224,122,0.5)";
        g.fillStyle = "rgba(140,224,122,0.12)";
      } else if (z.kind === "danger") {
        g.strokeStyle = "rgba(255,90,90,0.5)";
        g.fillStyle = "rgba(255,90,90,0.12)";
      } else {
        g.strokeStyle = "rgba(226,216,186,0.5)";
        g.fillStyle = "rgba(226,216,186,0.10)";
      }
      g.lineWidth = 1;
      // 矩形区域用矩形绘制
      if (z.rx !== undefined && z.ry !== undefined) {
        const rxw = z.rx * ppm;
        const ryw = z.ry * ppm;
        g.fillRect(lx - rxw, ly - ryw, rxw * 2, ryw * 2);
        g.lineWidth = 2;
        g.strokeRect(lx - rxw, ly - ryw, rxw * 2, ryw * 2);
      } else {
        const rr = z.r * ppm;
        g.lineWidth = 1;
        g.arc(lx, ly, rr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    });
    g.font = "bold 9px 'Microsoft YaHei', sans-serif";
    g.textAlign = "center";
    // 邻近区域：沿玩家 → 区域中心方向贴边，显示区域名
    zoneList.forEach((z) => {
      if (curZone && z.name === curZone.name) return;
      const dxw = z.x - px;
      const dyw = z.y - py;
      const dd = Math.hypot(dxw, dyw) || 1;
      const lim = half - 12;
      const lx = half + (dxw / dd) * lim;
      const ly = half + (dyw / dd) * lim;
      const txt = z.name.length > 4 ? z.name.slice(0, 4) : z.name;
      const tw = g.measureText(txt).width;
      g.fillStyle = "rgba(8,10,8,0.62)";
      g.fillRect(lx - tw / 2 - 2, ly - 6, tw + 4, 11);
      g.fillStyle = z.kind === "safe" ? "#8ce07a" : "rgba(226,216,186,0.82)";
      g.fillText(txt, lx, ly + 3);
    });
    // 当前区域徽标（左上角）
    const curName = curZone ? curZone.name : "荒野";
    const isSafe = !!curZone && curZone.kind === "safe";
    const badge = isSafe ? `${curName}（安全区）` : curName;
    g.font = "bold 10px 'Microsoft YaHei', sans-serif";
    g.textAlign = "left";
    const bw2 = g.measureText(badge).width;
    g.fillStyle = isSafe ? "rgba(24,60,34,0.82)" : "rgba(20,18,14,0.72)";
    g.fillRect(2, 2, bw2 + 8, 14);
    g.fillStyle = isSafe ? "#9df08a" : "#f0e2b4";
    g.fillText(badge, 6, 12.5);
    g.restore();
  }
  g.restore();
}

/* ---------------- 主循环 ---------------- */
let raf = 0;
let lastTickAt = 0;
let lastSendAt = 0;
let lastMinimapAt = 0;
let lastFrameAt = 0;
const TICK_MS = 100;

function loop(ts: number) {
  raf = requestAnimationFrame(loop);
  _animTick++;
  const s = state.value;
  if (!s || s.phase !== "playing") return;
  // ★ fix①（性能）：页面切到后台（锁屏 / 切走）时既不应渲染也不应上报 tick
  if (typeof document !== "undefined" && document.hidden) return;
  // ★ fix①（性能）：手机端把渲染帧率封顶 30fps（渲染内已按 dt 归一，速度不受影响）
  // 注意：lastFrameAt 与 render() 内部的 lastRenderAt（显示位置插值时钟）是两个独立变量
  if (!MIN_FRAME_MS || ts - lastFrameAt >= MIN_FRAME_MS) { lastFrameAt = ts; render(); }
  // ★ fix⑤：迷你小地图独立低频刷新（10Hz 足够，避免与主画面抢 CPU）
  if (ts - lastMinimapAt >= 100) {
    lastMinimapAt = ts;
    drawMinimap();
  }
  if (ts - lastTickAt >= TICK_MS) {
    lastTickAt = ts;
    // ★ v3：本地兜底推进（外部 mockHost 未启动时玩家也能移动）——本地仍保持 10Hz
    localTick();
    // ★ fix①（性能）：上报单独限频（移动端 5Hz），宿主只镜像玩家位姿，不影响判定
    if (ts - lastSendAt >= SEND_MS) {
      lastSendAt = ts;
      sendTick("tick", {
        input: {
          dx: input.value.dx,
          dy: input.value.dy,
          moveTo: input.value.moveTo,
        },
        // ★ 上报本地权威位姿：宿主侧只镜像、不再积分玩家输入（消除坐标双写）
        player: lastLocalPose ? { ...lastLocalPose } : undefined,
      });
    }
  }
}

/* ---------------- 技能 / 物品 ---------------- */
const skillPage = computed(() => state.value?.skills.slice((state.value.skillPage || 0) * 4, (state.value.skillPage || 0) * 4 + 4) || []);
const itemPage = computed(() => state.value?.items.slice((state.value.itemPage || 0) * 4, (state.value.itemPage || 0) * 4 + 4) || []);
const skillPages = computed(() => Math.max(1, Math.ceil((state.value?.skills.length || 0) / 4)));
const itemPages = computed(() => Math.max(1, Math.ceil((state.value?.items.length || 0) / 4)));

function castSkill(i: number) { sendTick("skill", { index: i }); }
function useItem(i: number) { sendTick("item", { index: i }); }
function pageSkill(d: number) { sendTick("page", { kind: "skill", delta: d }); }
function pageItem(d: number) { sendTick("page", { kind: "item", delta: d }); }
function exitGame() { sendTick("exit", {}); }

/**
 * 结算页「退出」：回到选人阶段（主菜单）
 */
function exitOver() {
  if (state.value) state.value.phase = 'select';
}

/**
 * 结算页「复活」：原地复活 —— 位置不变，血量与状态恢复为可正常游玩。
 *   主路径：sendTick("revive") → 宿主（entry.ts / entry.js）或本地模拟宿主（mockHost.ts）
 *           把玩家 alive=true、hp=maxHp，phase 由 over 回到 playing，玩家坐标保持死亡处不变。
 *   兜底：宿主未接入 revive 动作时（旧宿主 / 纯静态打开 game.html），前端本地自愈，
 *         保证「复活」按钮在任何环境下都能继续游玩。
 */
function reviveGame() {
  sendTick("revive", {});
  window.setTimeout(localReviveIfStillOver, 300);
}

function localReviveIfStillOver() {
  const s = state.value;
  if (!s || s.phase !== "over") return;      // 宿主已完成复活，无需兜底
  const me0 = s.entities.find((e) => e.side === "player");
  if (!me0) return;
  me0.alive = true;
  me0.hp = me0.maxHp;                        // 满血
  me0.vx = 0;
  me0.vy = 0;
  s.result = null;
  s.phase = "playing";                       // 回到可正常游玩
  lastLocalPose = { x: me0.x, y: me0.y, facing: me0.facing };   // 位置不变，并接管本地权威位姿
}

/* ---------------- 生命周期 ---------------- */
let stopHost: (() => void) | null = null;

/** 应用启动：加载地图 → 初始化 chunk / 装饰 → 开启渲染循环 */
onMounted(async () => {
  // ★ v3：先加载地图配置（mulberryTown.json），得到 scale / zoom / 装饰物 / chunk 数据
  try {
    const cfg = await loadMapConfig();
    mapCfg.value = cfg;
    zoom.value = cfg.default_zoom;
    // 初始化 chunk 系统（基于新 scale）
    chunkSystem = new ChunkTerrainSystem(makeScaleFromMap(cfg));
    chunkSystem.init();
    if (cfg.chunks) chunkSystem.ingestMapData(cfg.chunks);
    // ★ 立即加载玩家初始 chunk（否则 updateAroundPlayer 因同 chunk 提前 return，loaded_chunks 一直为空）
    chunkSystem.updateAroundPlayer(0, 0, performance.now());
    for (let i = 0; i < 30; i++) chunkSystem.tick();  // 一次消费完 pending 队列
    // 装饰物：按 chunk 索引
    initDecorations();
  } catch (err) {
    console.warn("[field-survival] loadMapConfig 失败，使用兜底数据：", err);
    initDecorations();
  }

  // ★ 画布等比缩放：窗口变化 / 旋转 / 全屏切换后重新适配
  // window.addEventListener("resize", fitCanvas);
  // fitCanvas();

  window.addEventListener("orientationchange", ()=>{
    rotated_fun();
    requestAnimationFrame(fitCanvas);
  })
  window.visualViewport?.addEventListener("resize", ()=>{
    rotated_fun();
    requestAnimationFrame(fitCanvas);
  })

  stopHost = onHostState((d) => {
    const prevPhase = state.value?.phase;
    const incoming = d.state as GameState;
    const newPhase = incoming?.phase;
    // ★ 关键修复：玩家位姿以本地 tick 为唯一数据源。
    //   宿主推送的 state 中玩家 x/y/facing 是宿主侧镜像值（宿主已不再积分玩家输入），
    //   若整份替换会把本地刚推进的位移回退 → 表现为"走一小步被拖回 / 松手瞬移"。
    if (newPhase === "playing" && prevPhase === "playing" && lastLocalPose) {
      const meHost = incoming?.entities?.find((e) => e.side === "player");
      if (meHost) {
        meHost.x = lastLocalPose.x;
        meHost.y = lastLocalPose.y;
        meHost.facing = lastLocalPose.facing;
      }
    } else if (newPhase !== "playing") {
      // 回到选人 / 结算：清空本地位姿缓存，下一局以宿主 spawn 为准
      lastLocalPose = null;
    }
    state.value = incoming;
    ready.value = true;

    // ★ 收到 init/init_start 时，强制重置所有选择状态
    // 这样第二次进入游戏时能正确显示选人面板
    if (newPhase === "select") {
      participants.value = [];
      spectators.value = [];
      enemies.value = [];
      const p = state.value.roles.find((r) => r.roleType === "player");
      if (p) participants.value = [p.id];
      // 选人阶段：确保不是全屏（用户切回来好操作）
      toonflowJsApi.minigame.setFullscreen(false);
      // 重新初始化地图装饰物（每次进入都重新生成）
      initDecorations();
      // 重置开始按钮 loading 状态（★ fix③：同时清掉超时计时与提示）
      starting.value = false;
      clearStartTimers();
      startHint.value = "";
      // 重置区域追踪变量
      currentZoneName = null;
      zoneLeftTick = 0;
      zoneRespawnReady = false;
    }
    if (newPhase === "playing" && prevPhase !== "playing") {
      // 进入战斗：自动切全屏（runtime 时机）
      toonflowJsApi.minigame.setFullscreen(true);
      // 确保地图装饰物已初始化
      if (mapDecorations.value.length === 0) initDecorations();
      // 重置区域追踪（开局立即可刷新）
      currentZoneName = null;
      zoneLeftTick = 0;
      zoneRespawnReady = true;
      // ★ v3 兜底：如果外部 mockHost 没启动（被 Toonflow wrapper 包了 iframe），
      //   state.entities 里只有玩家/盟友，没有 enemy。在玩家 (0,0) 周围 30-100 米
      //   环形补 spawn 4-6 只野兽，保证开局立刻能看到怪物。
      setTimeout(() => spawnLocalMobsIfNeeded(), 300);
      // 成功进入战斗，清除 loading（★ fix③：同时清掉超时计时与提示）
      starting.value = false;
      clearStartTimers();
      startHint.value = "";
    }
    // ★ 开局后：优先 state.map；缺失时用 toonflowJsApi 从插件数据表拉 map_data 兜底
    const m = (state.value as any)?.map as MapData | null | undefined;
    if (m?.theme) {
      mapTheme.value = m.theme;
    } else if (state.value?.phase === "playing") {
      void toonflowJsApi.pluginData.get("map_data")
        .then((v) => {
          const md = v as MapData | null;
          if (md?.theme && !mapTheme.value) {
            mapTheme.value = md.theme;
            if (!state.value?.map && md) state.value = { ...state.value!, map: md, mapSource: "stored" } as GameState;
          }
        })
        .catch(() => { /* 宿主未接入 /plugin/data 时静默 */ });
    }
  });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  // ★ fix④：按持久化的像素风开关初始化画布采样方式
  applyCanvasSmoothing();
  raf = requestAnimationFrame(loop);
  notifyLoaded();
  // 兜底：宿主未推送状态时也要显示，避免白屏
  setTimeout(() => { if (!state.value) ready.value = true; }, 1200);
});

onBeforeUnmount(() => {
  stopHost?.();
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("resize", fitCanvas);
  cancelAnimationFrame(raf);
});

watch(() => state.value?.phase, (p) => {
  if (p === "playing") requestAnimationFrame(() => { fitCanvas(); applyCanvasSmoothing(); render(); drawMinimap(); });
});
</script>

<template>
  <div class="fs">
    <!-- ===== 选人阶段 ===== -->
    <section v-if="!state || state.phase === 'select'" class="select">
      <header class="select__head">
        <h2>🌲 野外生存</h2>
        <p>选择参展 / 观战 / 敌对角色，然后点击开始游戏</p>
      </header>

      <div class="select__group">
        <h3>参展角色（多选）</h3>
        <div class="chips">
          <button
            v-for="r in roles" :key="r.id"
            class="chip" :class="{ 'chip--on': participants.includes(r.id) }"
            @click="toggle(participants, r.id)"
          >
            <img v-if="roleAvatar(r)" :src="roleAvatar(r)" alt="" />
            <span>{{ r.name }}</span>
          </button>
        </div>
      </div>

      <div class="select__group">
        <h3>观战角色（多选）</h3>
        <div class="chips">
          <button
            v-for="r in roles" :key="r.id"
            class="chip" :class="{ 'chip--on': spectators.includes(r.id) }"
            @click="toggle(spectators, r.id)"
          >
            <span>{{ r.name }}</span>
          </button>
        </div>
      </div>

      <div class="select__group">
        <h3>敌对角色（多选）</h3>
        <div class="chips">
          <button
            v-for="r in roles" :key="r.id"
            class="chip chip--danger" :class="{ 'chip--on': enemies.includes(r.id) }"
            @click="toggle(enemies, r.id)"
          >
            <span>{{ r.name }}</span>
          </button>
        </div>
        <p class="hint">不选敌对角色时，系统会按波次自动生成野兽。</p>
      </div>

      <button class="start" @click="startGame" :disabled="starting">
        <span v-if="starting" class="start__loading">
          <span class="start__spinner"></span>加载中…
        </span>
        <span v-else>开始游戏</span>
      </button>
      <!-- ★ fix③：开始游戏的等待/超时提示（宿主 /plugin/tick 未回包时不再静默） -->
      <p v-if="startHint" class="start-hint">{{ startHint }}</p>
    </section>

    <!-- ===== 战斗阶段 ===== -->
    <section v-else-if="state.phase === 'playing'" class="play { 'stage-rotate--on': isStageRotateOn }">
      <!-- 🔄 横屏按钮（左上角；手机上锁定横屏+全屏，PC 上全屏；req.md:57-58） -->
      <button class="btn btn--rotate" @click="toggleOrientation" title="横竖屏切换">
        🔄
      </button>
      <div class="hud">
        <div class="hud__left">
          <div class="hp"><div class="hp__bar" :style="{ width: hpPct + '%' }"></div></div>
          <div class="hud__txt">{{ me?.name || '你' }} · {{ Math.round(me?.hp || 0) }}/{{ me?.maxHp || 0 }}</div>
        </div>
        <div class="hud__mid">
          <span v-if="mapTheme" class="hud__map" :title="mapSourceLabel">🗺 {{ mapTheme }}</span>
          <span>击杀 {{ state.kills }}</span>
          <span>经验 +{{ state.exp }}</span>
          <span>金钱 +{{ state.money }}</span>
        </div>
        <button class="btn btn--exit" @click="exitGame">退出</button>
        <!-- ★ fix④：像素风开关（默认开；取消勾选 → 关闭像素化渲染，界面变清晰） -->
        <label class="pixel-toggle" title="像素风渲染开关：取消勾选可关闭像素化，画面更平滑清晰">
          <input type="checkbox" v-model="pixelMode" @change="onPixelModeChange" />
          <span>像素风</span>
        </label>
      </div>

      <!-- ★ v3 缩放控制（右上角，对应 25d_ai_game 的相机 zoom），上下限由 mulberryTown.json 决定 -->
      <div class="zoom-ctrl" :title="`zoom=${zoom}（${viewSizeMeters[0]}m × ${viewSizeMeters[1]}m）`">
        <button class="zoom-btn" @click="zoomIn" :disabled="zoom >= terrainScale.max_zoom">+</button>
        <div class="zoom-val">{{ zoom }}</div>
        <button class="zoom-btn" @click="zoomOut" :disabled="zoom <= terrainScale.min_zoom">−</button>
      </div>

      <!-- ★ fix⑤/⑥：右侧信息列（zoom-ctrl 下方）：迷你小地图 + 玩家当前坐标 -->
      <div class="right-col">
        <div class="minimap" :title="`迷你小地图：绿=你 / 蓝=盟友 / 红=野怪 / 黄=宝箱 / 粉=血瓶｜半径 ${MINIMAP_RANGE_M}m`">
          <canvas ref="minimapEl" class="minimap__cv" :width="MINIMAP_PX" :height="MINIMAP_PX"></canvas>
          <div class="minimap__legend">
            <span class="lg lg--me">你</span>
            <span class="lg lg--ally">盟友</span>
            <span class="lg lg--enemy">野怪</span>
          </div>
        </div>
        <div class="coord-box" :title="`当前世界坐标（米）：X ${(me?.x ?? 0).toFixed(1)} / Z ${(me?.y ?? 0).toFixed(1)}`">
          <div class="coord-box__row">X <b>{{ (me?.x ?? 0).toFixed(1) }}</b> m</div>
          <div class="coord-box__row">Z <b>{{ (me?.y ?? 0).toFixed(1) }}</b> m</div>
          <div class="coord-box__sub">区块 {{ Math.floor((me?.x ?? 0) / terrainScale.chunk_size_m) }}, {{ Math.floor((me?.y ?? 0) / terrainScale.chunk_size_m) }}</div>
        </div>
      </div>

      <!-- ★ v3 比例尺与方块刻度（右下角 scale ruler，对应 25d_ai_game 的 grid system） -->
      <div class="scale-ruler" :title="`block=${terrainScale.block_size}m, chunk=${terrainScale.chunk_size_m}m`">
        <div class="scale-ruler__pct">{{ viewSizeMeters[0].toFixed(1) }}m</div>
        <div class="scale-ruler__bar"></div>
        <div class="scale-ruler__lbl">
          1m × {{ zoom }} | 比例 1:{{ (1 / terrainScale.scale_meter).toFixed(2) }} | world {{ terrainScale.size[0] }}m
        </div>
      </div>

      <div class="stage-rotate" >
        <canvas
          ref="canvasEl"
          class="stage"
          :class="{ 'stage--smooth': !pixelMode }"
            :width="canvas_w_ref"
            :height="canvas_h_ref"
          @click="onCanvasClick"
        ></canvas>
      </div>

      <div class="events">
        <div v-for="(e, i) in lastEvents" :key="i">{{ e }}</div>
      </div>

      <!-- 半透明控制层 -->
      <div class="pad" @pointerdown="stickStart" @pointermove="stickMove"
           @pointerup="stickEnd" @pointercancel="stickEnd" @pointerleave="stickEnd">
        <div class="pad__knob" :style="{ transform: `translate(${stick.x}px, ${stick.y}px)` }"></div>
      </div>

      <div class="slots slots--skill">
        <button v-for="(s, i) in skillPage" :key="i" class="slot"
                :class="{ 'slot--cd': s.cdLeft > 0 }" @click="castSkill(i)">
          <span class="slot__name">{{ s.name }}</span>
          <span v-if="s.cdLeft > 0" class="slot__cd">{{ Math.ceil(s.cdLeft / 10) }}</span>
        </button>
        <button class="slot slot--page" @click="pageSkill(1)">切换</button>
      </div>

      <div class="slots slots--item">
        <button v-for="(it, i) in itemPage" :key="i" class="slot"
                :class="{ 'slot--empty': it.count <= 0 }" @click="useItem(i)">
          <span class="slot__name">{{ it.name }}</span>
          <span class="slot__count">×{{ it.count }}</span>
        </button>
        <button class="slot slot--page" @click="pageItem(1)">切换</button>
      </div>

      <div class="tips">方向键 / WASD 移动，点击空地指定目标，摇杆可拖动</div>
    </section>

    <!-- ===== 结算 ===== -->
    <section v-else class="over">
      <h2>{{ state.result?.reason === 'death' ? '你倒下了……' : '野外生存结束' }}</h2>
      <ul>
        <li>存活帧数：{{ state.result?.survivedTicks }}</li>
        <li>击杀：{{ state.result?.kills }}</li>
        <li>获得经验：{{ state.result?.exp }}</li>
        <li>获得金钱：{{ state.result?.money }}</li>
        <li>掉落物品：{{ (state.result?.drops || []).join('、') || '无' }}</li>
      </ul>
      <div class="over__actions">
        <button class="start over__revive" @click="reviveGame">复活</button>
        <button class="start over__exit" @click="exitOver">退出</button>
      </div>
    </section>

    <!-- 调试面板（仅 debug 模式可见） -->
    <DebugPanel
      v-if="debugMode"
      :state="state"
      @select-entity="onSelectEntity"
    />
  </div>
</template>

<style>
/* ============================================================
   Rotten-Soup 风格暗色 roguelike 主题
   ============================================================ */
* {
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  margin: 0;
}

body {
  font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif;
  background: #1e1f1f;
  color: #e8eef7;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}

.fs {
  height: 100%;
  width: 100%;
  position: relative;
  overflow: hidden;
  background: #1e1f1f;
}

/* 通用：暗色像素边框风格 */
.ui-panel {
  background: #1e1f1f;
  border: 3px solid #4f4f4f;
  border-radius: 4px;
  color: #ececec;
}

/* ============== 选人阶段 ============== */
.select {
  height: 100%;
  overflow: auto;
  padding: 18px 20px;
  background: #1e1f1f;
}

.select__head h2 {
  margin: 0 0 6px;
  font-size: 22px;
  color: #ffe79e;
  letter-spacing: 1px;
  text-shadow: 0 2px 0 #6a4f1f;
}

.select__head p {
  margin: 0 0 16px;
  font-size: 13px;
  color: #9aa0a6;
}

.select__group {
  margin-bottom: 14px;
  background: #2a2b2b;
  border: 2px solid #3d3d3d;
  border-radius: 4px;
  padding: 10px 12px;
}

.select__group h3 {
  font-size: 14px;
  margin: 0 0 8px;
  color: #ffe79e;
  letter-spacing: 1px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 0;
  cursor: pointer;
  border: 2px solid #4f4f4f;
  background: #2a2b2b;
  color: #d0d0d0;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s;
}

.chip:hover {
  background: #3a3b3b;
  border-color: #6a6a6a;
}

.chip img {
  width: 24px;
  height: 24px;
  border-radius: 0;
  object-fit: cover;
  image-rendering: pixelated;
}

.chip--on {
  background: #d4a13e;
  border-color: #ffe79e;
  color: #1e1f1f;
  font-weight: 700;
}

.chip--danger.chip--on {
  background: #c0392b;
  border-color: #ff6b6b;
  color: #fff;
}

.hint {
  font-size: 12px;
  color: #8a8e93;
  margin: 6px 0 0;
}

.start {
  display: block;
  width: 100%;
  padding: 14px;
  margin-top: 12px;
  border: 2px solid #6a4f1f;
  border-radius: 0;
  background: #d4a13e;
  color: #1e1f1f;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  cursor: pointer;
  transition: all 0.15s;
  text-transform: uppercase;
  box-shadow: 0 3px 0 #6a4f1f;
}

.start:hover:not(:disabled) {
  background: #ffe79e;
}

.start:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #6a4f1f;
}

.start:disabled {
  background: #3a3b3b;
  border-color: #4f4f4f;
  box-shadow: 0 3px 0 #2a2b2b;
  color: #8a8e93;
  cursor: not-allowed;
}

.start__loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.start__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(30, 31, 31, 0.3);
  border-top-color: #1e1f1f;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ============== 战斗阶段 ============== */
.play {
  position: absolute;
  inset: 0;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* 🔄 旋转 wrapper：居中 + 可选 90° 旋转 */
.stage-rotate {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;            /* 旋转后超出部分裁掉，绝不显示黑边 */
}


.stage-rotate--on {
  transform: rotate(90deg);
  /* 旋转 90° 后，原本"宽度"变成"高度"——再 transform-origin: center */
}
.stage {
  display: block;
  background: #0a0a0a;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

/* ★ fix④：取消勾选「像素风」后，画布交给浏览器做平滑插值（界面立刻变清晰） */
.stage--smooth {
  image-rendering: auto;
  image-rendering: smooth;
  image-rendering: -webkit-optimize-contrast;
}

/* ★ fix④：像素风复选框（HUD 的「退出」按钮旁） */
.pixel-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding: 3px 8px;
  font-size: 12px;
  line-height: 1.2;
  color: #e8e2d0;
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.pixel-toggle input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: #8ce07a;
  cursor: pointer;
}
.pixel-toggle:active { transform: scale(0.97); }

/* ★ fix③：开始游戏的等待/超时提示 */
.start-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #f0c674;
  text-align: center;
}

/* ★ fix⑤/⑥：右侧信息列（迷你小地图 + 坐标），位于 zoom-ctrl 下方 */
.right-col {
  position: absolute;
  right: 8px;
  top: 121px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  pointer-events: none;
}
/* 短屏（手机横屏）缩放，保证小地图 + 坐标不会被裁掉 */
@media (max-height: 460px) {
  .right-col { transform: scale(0.78); transform-origin: top right; }
}
@media (max-height: 380px) {
  .right-col { transform: scale(0.68); transform-origin: top right; }
}
.minimap {
  width: 110px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.minimap__cv {
  display: block;
  width: 110px;
  height: 110px;
}
.minimap__legend {
  display: flex;
  justify-content: space-around;
  padding: 2px 0 3px;
  font-size: 6px;
  color: #cfd6c4;
}
.lg::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 3px;
  border-radius: 50%;
  vertical-align: middle;
}
.lg--me::before { background: #8ce07a; }
.lg--ally::before { background: #5b9bff; }
.lg--enemy::before { background: #ff5b5b; }
.coord-box {
  min-width: 69px;
  padding: 4px 8px;
  font-size: 6px;
  line-height: 1.2;
  color: #e8e2d0;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 6px;
}
.coord-box__row b {
  color: #ffe9a8;
  font-variant-numeric: tabular-nums;
}
.coord-box__sub {
  font-size: 6px;
  color: #a9b39c;
}

/* HUD */
.hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #1e1f1f4d;
  border-bottom: 3px solid #4f4f4f;
  color: #ececec;
  font-size: 12px;
}

.hud__left {
  min-width: 200px;
}

.hp {
  width: 180px;
  height: 12px;
  border: 2px solid #4f4f4f;
  background: #1e0e0e;
  position: relative;
  overflow: hidden;
}

.hp__bar {
  height: 100%;
  background: linear-gradient(180deg, #6ee06e 0%, #2fa85a 100%);
  transition: width 0.2s;
}

.hud__txt {
  font-size: 11px;
  color: #ececec;
  margin-top: 4px;
  font-weight: 600;
}

.hud__mid {
  display: flex;
  gap: 1px;
  font-size: 12px;
  color: #d0d0d0;
  flex: 1;
  align-items: center;
  flex-wrap: wrap;
  position: absolute;
  top:42px;
  left: 38px;
}

.hud__mid > span {
  padding: 2px 8px;
  background: #2a2b2b;
  border: 1px solid #4f4f4f;
  border-radius: 2px;
}

.hud__map {
  color: #ffe79e !important;
  font-weight: 600;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-color: #d4a13e !important;
}

.btn--exit {
  border: 2px solid #c0392b;
  border-radius: 0;
  padding: 2px 6px;
  cursor: pointer;
  background: #c0392b;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  box-shadow: 0 2px 0 #6a1f1f;
}

.btn--exit:active {
  transform: translateY(2px);
  box-shadow: 0 0 0 #6a1f1f;
}

/* ===== 缩放控制（右上角：zoom+ / zoom- 按钮，对应 25d_ai_game 的 camera zoom） ===== */
.zoom-ctrl {
  position: absolute;
  right: 8px;
  top: 44px;          /* 避开 HUD 顶部 */
  z-index: 7;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: rgba(30, 31, 31, 0.85);
  border: 2px solid #4f4f4f;
  border-radius: 4px;
  box-shadow: 0 2px 0 #1e1f1f;
  user-select: none;
}
.zoom-ctrl .zoom-btn {
  width: 2rem;
  height: 1rem;
  border: 2px solid #6a4f1f;
  background: #d4a13e;
  color: #1e1f1f;
  font-size: 10px;
  font-weight: 700;
  border-radius: 2px;
  cursor: pointer;
  line-height: 1;
}
.zoom-ctrl .zoom-btn:hover:not(:disabled) {
  background: #ffe79e;
}
.zoom-ctrl .zoom-btn:active:not(:disabled) {
  transform: translateY(1px);
}
.zoom-ctrl .zoom-btn:disabled {
  background: #3a3b3b;
  color: #6a6a6a;
  border-color: #4f4f4f;
  cursor: not-allowed;
}
.zoom-ctrl .zoom-val {
  font-size: 14px;
  font-weight: 700;
  color: #ffe79e;
  background: #1e1f1f;
  padding: 2px 6px;
  border: 1px solid #4f4f4f;
  min-width: 28px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* ===== 比例尺标尺（右下角，对应 25d_ai_game 的 grid system） ===== */
.scale-ruler {
  position: absolute;
  right: 53px;
  top: 44px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  padding: 4px 6px;
  background: rgba(30, 31, 31, 0.85);
  border: 2px solid #4f4f4f;
  border-radius: 4px;
  color: #ececec;
  font-size: 6px;
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.scale-ruler__bar {
  width: 80px;
  height: 6px;
  background: linear-gradient(90deg, #ffe79e 50%, #d4a13e 50%);
  border: 1px solid #1e1f1f;
  margin-top: 1px;
}
.scale-ruler__pct {
  font-weight: 700;
  color: #ffe79e;
}
.scale-ruler__lbl {
  font-size: 6x;
  color: #9aa0a6;
  margin-top: 1px;
  text-align: right;
  white-space: nowrap;
}

/* 🔄 横竖屏切换按钮（左上角，要求 req.md:57-58） */
.btn--rotate {
  position: absolute;
  left: 8px;
  top: 50px; /* 避开 HUD */
  z-index: 6;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 2px solid #d4a13e;
  border-radius: 0;
  background: rgba(30, 31, 31, 0.85);
  color: #ffe79e;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 2px 0 #6a4f1f;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.3s ease;
}
.btn--rotate:active {
  transform: translateY(2px) rotate(180deg);
  box-shadow: 0 0 0 #6a4f1f;
}
.btn--rotate:hover {
  background: #3a3b3b;
}

.events {
  position: absolute;
  left: 12px;
  top: 78px;
  z-index: 5;
  font-size: 8px;
  color: #ececec;
  text-shadow: 0 1px 2px #000;
  display: flex;
  flex-direction: column;
  gap: 1px;
  pointer-events: none;
  background: rgba(30, 31, 31, 0.7);
  padding: 6px 10px;
  border: 2px solid #4f4f4f;
  border-radius: 2px;
  max-width: 260px;
}

.events > div {
  color: #d0d0d0;
}

.events > div:first-child {
  color: #ffe79e;
  font-weight: 600;
}

/* 摇杆 */
.pad {
  position: absolute;
  left: 18px;
  bottom: 100px;
  z-index: 6;
  width: 73px;
  height: 73px;
  border-radius: 50%;
  background: rgba(30, 31, 31, 0.7);
  border: 3px solid #4f4f4f;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.5);
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pad__knob {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: #d4a13e;
  border: 2px solid #ffe79e;
  box-shadow: 0 0 0 2px #6a4f1f;
}

/* 技能 / 物品 */
.slots {
  position: absolute;
  bottom: 18px;
  z-index: 6;
  display: flex;
  gap: 2px;
}

.slots--skill {
  right: 2px;
}

.slots--item {
  right: 2px;
  bottom: 70px;
}

.slot {
  width: 2.5rem;
  height: 2rem;
  border-radius: 0;
  cursor: pointer;
  border: 2px solid #4f4f4f;
  background: #2a2b2b;
  color: #ececec;
  font-size: 9px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  position: relative;
  padding: 2px;
  transition: all 0.1s;
}

.slot:hover {
  background: #3a3b3b;
  border-color: #6a6a6a;
}

.slot__name {
  max-width: 46px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.slot__count {
  font-size: 10px;
  color: #ffe79e;
  font-weight: 700;
}

.slot__cd {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  font-size: 18px;
  font-weight: 700;
  color: #ff6b6b;
}

.slot--empty {
  opacity: 0.35;
}

.slot--page {
  width: 34px;
  background: #3a3b3b;
  border-color: #6a6a6a;
  color: #d4a13e;
  font-weight: 700;
}

.slot--page:hover {
  background: #4a4b4b;
}

.tips {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: rgba(236, 236, 236, 0.5);
  z-index: 4;
  letter-spacing: 1px;
}

/* ============== 结算 ============== */
.over {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #1e1f1f;
}

.over h2 {
  margin: 0;
  font-size: 28px;
  color: #ffe79e;
  letter-spacing: 2px;
  text-shadow: 0 3px 0 #6a4f1f;
}

.over ul {
  list-style: none;
  padding: 12px 24px;
  margin: 0;
  font-size: 14px;
  line-height: 2;
  color: #ececec;
  background: #2a2b2b;
  border: 2px solid #4f4f4f;
  border-radius: 4px;
  min-width: 280px;
}

.over ul li {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
}

.over ul li::before {
  content: "▸ ";
  color: #d4a13e;
  margin-right: 8px;
}

.over__actions {
  display: flex;
  gap: 14px;
}

.over .start {
  width: 150px;
  margin-top: 0;
}

/* 「退出」：沿用结算页原有的中性暗色样式，与「复活」主按钮区分 */
.over__exit {
  background: #3a3b3b;
  border-color: #4f4f4f;
  color: #cfd6df;
  box-shadow: 0 3px 0 #2a2b2b;
}

.over__exit:hover:not(:disabled) {
  background: #4a4b4b;
}
</style>
