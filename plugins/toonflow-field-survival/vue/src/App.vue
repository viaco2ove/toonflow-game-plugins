<script setup lang="ts">
/**
 * 野外生存 —— 2.5D 动作生存（全屏）
 *
 * 阶段：select（选人）→ playing（全屏战斗）→ over（结算）
 * 实时推进通过宿主代发 /plugin/tick（见 bridge.sendTick）。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { onHostState, sendToHost, sendTick, notifyLoaded } from "./bridge";
import { toonflowJsApi } from "./toonflowJsApi";
import type { GameState, Entity, RoleOption, MapData } from "./types";
import DebugPanel from "./DebugPanel.vue";
import {
  TILESET_URL, TILESET_COLS, TILE_SIZE, tileSrcRect, assetUrl, mobKeyFor,
  TILE_GROUND_ID, TILE_WATER_ID, TILE_POTION_ID,
  TILE_TREE_ID, TILE_DEADTREE_ID, TILE_CHEST_ID, TILE_CHEST_OPEN_ID,
  TILE_SHRUB_ID, TILE_MUSHROOM_ID, TILE_FLOWER_ID,
  MOB_TILES, IMG_PLAYER, IMG_ALLY, IMG_ENEMY_CHAR,
  spriteTileId,
} from "./assets";

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
  // 绝对 URL（http/https）直接用
  if (p.startsWith("http")) return p;
  // 相对路径走 assetUrl：dev 用 Vite server，prod 用 data URL 内联
  return assetUrl(p.startsWith("./") ? p.slice(2) : p);
}

const starting = ref(false);

function startGame() {
  if (starting.value) return;
  starting.value = true;
  sendTick("start", {
    selections: {
      participants: [...participants.value],
      spectators: [...spectators.value],
      enemies: [...enemies.value],
    },
  });
  // 兜底：宿主未连接时，2 秒后自动重置按钮状态
  setTimeout(() => { starting.value = false; }, 2000);
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
/** 世界尺寸：横竖屏独立（横屏 960×600，竖屏 372×990），sprite 比例不变形 */
const world = computed(() => state.value?.world || currentWorld.value);

/**
 * 横竖屏模式
 *
 * 关键：每种方向用独立的 canvas 内部分辨率和世界坐标，sprite 不变形。
 * 切换时重新生成地图装饰（rng 范围按对应世界）。
 *
 * - landscape（默认 PC 浏览器）：canvas 960×372，世界宽高 960×600
 * - portrait （手机 App 嵌入）：canvas 372×614，世界宽高 372×990）
 *
 * 两种方向都用同一个 viewport（最高 64 像素的 sprite），不拉伸。
 */
type Orientation = "landscape" | "portrait";
const orientation = ref<Orientation>("landscape");

const WORLD_LANDSCAPE = { w: 960, h: 600 };
const WORLD_PORTRAIT  = { w: 372, h: 990 };
const canvasW = computed(() => orientation.value === "landscape" ? WORLD_LANDSCAPE.w : WORLD_PORTRAIT.w);
const canvasH = computed(() => Math.round((orientation.value === "landscape" ? WORLD_LANDSCAPE.h : WORLD_PORTRAIT.h) * 0.62));

/** 当前方向的世界尺寸（用于初始化装饰、生成敌人位置）*/
const currentWorld = computed(() => orientation.value === "landscape" ? WORLD_LANDSCAPE : WORLD_PORTRAIT);

function toggleOrientation() {
  orientation.value = orientation.value === "landscape" ? "portrait" : "landscape";
  // 切换时按新方向重新生成装饰、敌人初始位置
  initDecorations();
  applyOrientation();
}

function applyOrientation() {
  if (!canvasEl.value) return;
  requestAnimationFrame(() => render());
}

/**
 * 判断是否应该强制竖屏（手机 App 嵌入）
 */
function autoDetectOrientation(): Orientation {
  const urlParam = new URLSearchParams(location.search).get("orientation");
  if (urlParam === "portrait" || urlParam === "landscape") return urlParam;
  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iOS|Mobile|ToonflowApp|Toonflow/i.test(ua);
  const screenType = (screen.orientation as any)?.type || "";
  const isPortraitScreen = screenType.includes("portrait");
  return isMobile && isPortraitScreen ? "portrait" : "landscape";
}

function onCanvasClick(e: MouseEvent) {
  const c = canvasEl.value;
  if (!c) return;
  const r = c.getBoundingClientRect();
  const sx = world.value.w / r.width;
  const sy = world.value.h / r.height;
  input.value.moveTo = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  input.value.dx = 0;
  input.value.dy = 0;
}

// loadAvatar 已移除（角色身体改用 sprite sheet）

/** 2.5D：屏幕 y = 世界 y * 0.62，营造俯视斜角 */
const DEPTH = 0.62;

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
) {
  if (!SHEET_TILESET.ready) return;
  const { sx, sy, sw, sh } = tileSrcRect(tileId);
  ctx.drawImage(SHEET_TILESET.img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// ★ 像素艺术：用 imageSmoothingEnabled=false 保证像素清晰（不模糊）
function applyPixelPerfect(ctx: CanvasRenderingContext2D) {
  ctx.imageSmoothingEnabled = false;
}

// 地图装饰物（树木、水体、花木）位置
interface Decoration { x: number; y: number; kind: "tree" | "water" | "bush" | "mushroom" | "flower" | "pot"; id: string; variant?: number }
const mapDecorations = ref<Decoration[]>([]);

// 初始化地图装饰物（按当前方向的世界尺寸生成）
function initDecorations() {
  const decs: Decoration[] = [];
  const rng = (a: number, b: number) => Math.random() * (b - a) + a;
  const W = currentWorld.value.w;
  const H = currentWorld.value.h;
  // 树木（9 棵，绿树/枯树交替）
  for (let i = 0; i < 9; i++) {
    decs.push({ x: rng(W * 0.06, W * 0.94), y: rng(H * 0.13, H * 0.87), kind: "tree", id: `tree_${i}`, variant: i % 2 });
  }
  // 水体（4 处）
  for (let i = 0; i < 4; i++) {
    decs.push({ x: rng(W * 0.08, W * 0.92), y: rng(H * 0.13, H * 0.87), kind: "water", id: `water_${i}` });
  }
  // 灌木（5 丛）
  for (let i = 0; i < 5; i++) {
    decs.push({ x: rng(W * 0.06, W * 0.94), y: rng(H * 0.13, H * 0.90), kind: "bush", id: `bush_${i}` });
  }
  // 蘑菇（4 朵）
  for (let i = 0; i < 4; i++) {
    decs.push({ x: rng(W * 0.06, W * 0.94), y: rng(H * 0.13, H * 0.90), kind: "mushroom", id: `mush_${i}` });
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

// 方向索引（pixi_game 约定）：0=下 1=左 2=右 3=上
function dirIndex(facing: number): number {
  const d = ((facing % 360) + 360) % 360;
  if (d >= 315 || d < 45)  return 2;  // 右
  if (d >= 45  && d < 135) return 1;  // 左
  if (d >= 135 && d < 225) return 0;  // 下
  return 3;                             // 上
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

// ----------------------------------------------------------
// 绘制角色（保持 sprite 实际像素比例，不变形）
// ★ 关键：sprite 实际内容比例（来自 PIL 测量）:
//   player=0.857(高22%)  ally=0.846(高18%)  enemy_char=0.750(高33%)
//   bear=0.800(高25%)     beast=1.067(高-7%,微宽)
// ★ 目标：保留原图比例，目标高度 48px，宽度按比例计算
// 例如 player content 24×28 → 比例 0.857 → dh=48 → dw=48*0.857=41
// 用整数对齐像素: dh=48, dw=42（player）, dw=40(ally), dw=36(enemy), dw=40(bear), dw=52(beast)
// ----------------------------------------------------------

/**
 * 角色尺寸配置（保持 sprite 原始宽高比，不变形）
 *
 * ★ 关键原则：横纵缩放系数必须相同，否则会变形。
 *   sprite 文件尺寸都是 32×32（整张图含透明边距）。
 *   我们用统一的目标高度 dh，再按 sprite 自身宽高比计算 dw：
 *     scale = dh / 32   →   dw = 32 * scale
 *
 *   这样 sprite 里的所有像素都被等比缩放（横纵缩放系数相同），
 *   内容形状（人形/兽形）保持原样，只整体放大。
 *
 * ★ 选不同 dh 是为了视觉层级（玩家大、野怪小、装饰更小）：
 *   - 玩家角色：dh=64（最大，最显眼）
 *   - 盟友角色：dh=56（略小）
 *   - 敌对角色：dh=64（跟玩家同等，视觉对等）
 *   - 野怪：dh=48（中等等）
 *   - 装饰（树/水/花）：在各自 draw 调用里单独指定
 */
const ENTITY_BASE = 32;  // sprite 原图尺寸 32×32

/** 角色显示高度（用于等比缩放）*/
const ENTITY_DIMS: Record<string, number> = {
  player:      64,  // 金甲战士
  ally:        56,  // 蓝袍法师
  enemy_char:  64,  // 持枪骑士
  // 野怪
  goblin:   48,
  orc:      48,
  rat:      48,
  goat:     48,
  snake:    48,
  bat:      48,
  skeleton: 48,
  minotaur: 56,
};

/** 计算等比缩放后的尺寸（宽高比固定 = 原图宽高比 = 1:1）*/
function fitDim(key: string): { w: number; h: number } {
  const h = ENTITY_DIMS[key] || 48;
  // 等比缩放：原图 32×32（1:1），所以 w = h
  return { w: h, h };
}

function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, avatarImg?: HTMLImageElement) {
  const sy = e.y * DEPTH;
  // ★ 根据 side 选择 sprite key（角色从 tileset 切片，支持 2 帧 walk 动画）
  const key = e.side === "player" ? "player"
            : e.side === "ally"   ? "ally"
            : "enemy_char";
  // ★ 永远 walk 帧循环（与 Rotten-Soup 一致：sprite.animationSpeed=0.065）
  const tileId = spriteTileId(key, _animTick);
  const dim = fitDim(key);
  const dw = dim.w;
  const dh = dim.h;
  const dx = e.x - dw / 2;
  const dy = sy - dh + 4; // 略微下沉，让脚站在地面上

  applyPixelPerfect(ctx);

  // 阴影（脚底）
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(e.x, sy + 4, dw * 0.55, dw * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 精灵本体（从 tileset 切片，按移动状态切换 walk 帧）
  if (SHEET_TILESET.ready) {
    drawTile(ctx, tileId, dx, dy, dw, dh);
  } else {
    // 兜底彩色胶囊
    const color = e.side === "player" ? "#4ea1ff"
      : e.side === "ally" ? "#5fd28a"
      : e.side === "enemy" ? "#ff6b6b"
      : "#9aa4b2";
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(e.x, sy - 24, 16, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ★ 角色头像（req.md：2.5D 小人模型上方显示头像 + 角色名）
  // 布局自上而下：头像(32) → 名字 → sprite
  const avatarSize = 30;
  const avatarX = e.x - avatarSize / 2;
  const avatarY = dy - avatarSize - 16; // 头像底部与名字留 16px（放名字）
  const hasAvatar = avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0;
  if (hasAvatar) {
    applyPixelPerfect(ctx);
    ctx.save();
    // 头像底色（遮住背后内容）
    ctx.fillStyle = "#1e1f1f";
    ctx.beginPath();
    ctx.arc(e.x, avatarY + avatarSize / 2, avatarSize / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    // 圆形裁剪绘制头像
    ctx.beginPath();
    ctx.arc(e.x, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatarImg!, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
    // 头像边框（不同阵营不同颜色）
    ctx.save();
    ctx.strokeStyle = e.side === "player" ? "#4ea1ff" : e.side === "ally" ? "#5fd28a" : "#ff4c4c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 头顶名字：有头像时放头像下方，无头像时贴 sprite 上方
  const headY = hasAvatar ? avatarY + avatarSize + 11 : dy - 6;
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "bold 11px 'Microsoft YaHei', sans-serif";
  ctx.fillStyle = "rgba(0,0,0,.85)";
  ctx.fillText(e.name.slice(0, 4), e.x + 1, headY + 1);
  ctx.fillStyle = e.side === "enemy" ? "#ffd4d4" : "#fff";
  ctx.fillText(e.name.slice(0, 4), e.x, headY);
  ctx.restore();

  // 血条 - 紧贴 sprite 下边缘（dy + dh 是 sprite 底部）
  const barW = Math.max(40, dw + 4), barH = 4;
  const barX = e.x - barW / 2;
  const barY = sy + 8; // 在脚底（sy = e.y * DEPTH）
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
function drawMonster(ctx: CanvasRenderingContext2D, e: Entity) {
  const sy = e.y * DEPTH;
  // ★ 根据野怪名字映射到 tileset monster tile
  const key = mobKeyFor(e.name);
  // ★ 永远 walk 帧循环（Rotten-Soup 风格）
  const tileId = spriteTileId(key, _animTick);
  // 等比缩放（tileset 每个 tile 32×32 → dw = dh）
  const targetH = ENTITY_DIMS[key] || 48;
  const dw = targetH;
  const dh = targetH;
  const dx = e.x - dw / 2;
  const dy = sy - dh + 4;

  applyPixelPerfect(ctx);

  // 阴影
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(e.x, sy + 4, dw * 0.55, dw * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (SHEET_TILESET.ready) {
    drawTile(ctx, tileId, dx, dy, dw, dh);
  } else {
    // 兜底：棕色圆
    ctx.save();
    ctx.fillStyle = "#8b5a2b";
    ctx.beginPath();
    ctx.ellipse(e.x, sy - 16, 14, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 血条
  const barW = 36, barH = 4;
  const barX = e.x - barW / 2;
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

function render() {
  const c = canvasEl.value;
  const s = state.value;
  if (!c || !s) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const W = c.width;
  const H = c.height;
  const sx = W / world.value.w;
  const sy = H / (world.value.h * DEPTH);

  // ★ 动态同步 ready 状态（data URL 图片解码完成时）
  for (const sheet of [SHEET_TILESET, SHEET_PLAYER, SHEET_ALLY, SHEET_ENEMY_CHAR]) {
    if (!sheet.ready && sheet.img.complete && sheet.img.naturalWidth > 0) {
      sheet.ready = true;
    }
  }

  ctx.clearRect(0, 0, W, H);

  // 地面：dawnlike tileset 草地 tile（id 116）平铺
  if (SHEET_TILESET.ready) {
    const tw = TILE_SIZE * sx;
    const th = TILE_SIZE * DEPTH * sy;
    for (let tx = 0; tx < W; tx += tw) {
      for (let ty = 0; ty < H; ty += th) {
        drawTile(ctx, TILE_GROUND_ID, tx, ty, tw, th);
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

  // ★ 地图 zones（map-gener agent 产出）：不同 kind 不同色调椭圆区域
  const kindColors: Record<string, string> = {
    safe: "rgba(94, 210, 138, .18)",
    danger: "rgba(255, 80, 80, .18)",
    loot: "rgba(224, 178, 74, .2)",
    quest: "rgba(110, 168, 254, .18)",
  };
  (s.map?.zones || []).forEach((z) => {
    const zy = z.y * DEPTH;
    ctx.save();
    ctx.fillStyle = kindColors[z.kind] || "rgba(255,255,255,.06)";
    ctx.strokeStyle = "rgba(255,255,255,.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(z.x, zy, z.r, z.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.font = "bold 12px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(z.name, z.x, zy - 4);
    ctx.restore();
  });

  ctx.save();
  ctx.scale(sx, sy);

  // ★ 地图装饰物（严格保持 sprite 实际内容比例，不变形）
  // tile 内容实测比例：tree 28×32 → dw35/dh40；shrub 22×18 → dw27/dh22；
  //                     mushroom 16×16 → dw24/dh24；flower 28×28 → dw21/dh21
  //                     water 32×32（1:1）
  mapDecorations.value.forEach((dec) => {
    const sy2 = dec.y * DEPTH;

    if (dec.kind === "tree" && SHEET_TILESET.ready) {
      // 树（绿树 7355 / 枯树 7359，交替）
      const dh = 40, dw = 35;
      const dx = dec.x - dw / 2;
      const dy = sy2 - dh + 4;
      drawTile(ctx, dec.variant === 0 ? TILE_TREE_ID : TILE_DEADTREE_ID, dx, dy, dw, dh);
    } else if (dec.kind === "water" && SHEET_TILESET.ready) {
      // 水tile（tileset id 4500）→ 32×32
      const ts = 32;
      const dx = dec.x - ts / 2;
      const dy = sy2 - ts + 4;
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawTile(ctx, TILE_WATER_ID, dx, dy, ts, ts);
      ctx.restore();
    } else if (dec.kind === "bush" && SHEET_TILESET.ready) {
      // 灌木（1722）content 22×18 → dh=22, dw=27
      const dh = 22, dw = 27;
      const dx = dec.x - dw / 2;
      const dy = sy2 - dh + 4;
      drawTile(ctx, TILE_SHRUB_ID, dx, dy, dw, dh);
    } else if (dec.kind === "mushroom" && SHEET_TILESET.ready) {
      // 蘑菇（1724）1:1 → dh=24, dw=24
      const dh = 24, dw = 24;
      const dx = dec.x - dw / 2;
      const dy = sy2 - dh + 4;
      drawTile(ctx, TILE_MUSHROOM_ID, dx, dy, dw, dh);
    } else if (dec.kind === "flower" && SHEET_TILESET.ready) {
      // 花（1482）content 28×28，散落小花 → dh=21, dw=21
      const dh = 21, dw = 21;
      const dx = dec.x - dw / 2;
      const dy = sy2 - dh + 4;
      drawTile(ctx, TILE_FLOWER_ID, dx, dy, dw, dh);
    } else if (dec.kind === "pot" && SHEET_TILESET.ready) {
      // 药水（tileset id 614）: content 16×24, ratio 0.667 → dh=24, dw=16
      const dh = 24, dw = 16;
      const dx = dec.x - dw / 2;
      const dy = sy2 - dh + 4;
      drawTile(ctx, TILE_POTION_ID, dx, dy, dw, dh);
    } else {
      // 兜底形状
      ctx.save();
      ctx.globalAlpha = 0.5;
      if (dec.kind === "tree") {
        ctx.fillStyle = "#2d5a27";
        ctx.beginPath();
        ctx.arc(dec.x, sy2, 14, 0, Math.PI * 2);
        ctx.fill();
      } else if (dec.kind === "water") {
        ctx.fillStyle = "#4a90d9";
        ctx.beginPath();
        ctx.arc(dec.x, sy2, 12, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#8b7355";
        ctx.beginPath();
        ctx.arc(dec.x, sy2, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  });

  // 宝箱（Rotten-Soup RandomDungeon 的 chest tile：关=57，开=58）
  // chest content 28×26 → dh=32, dw=34
  s.chests.forEach((ch) => {
    const dh = 32, dw = 34;
    const cx = ch.x;
    const cy = ch.y * DEPTH;
    ctx.save();
    if (ch.opened) {
      ctx.globalAlpha = 0.55;
    }
    if (SHEET_TILESET.ready) {
      drawTile(ctx, ch.opened ? TILE_CHEST_OPEN_ID : TILE_CHEST_ID, cx - dw/2, cy - dh + 4, dw, dh);
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
    ctx.fillText(ch.opened ? "空" : "宝箱", ch.x, ch.y * DEPTH - 20);
    ctx.restore();
  });

  // 血瓶（实体 from state.potions，tileset 药水 tile id 614）
  // potion content 16×24, ratio 0.667 → dh=24, dw=16
  s.potions.forEach((p) => {
    const dh = 24, dw = 16;
    const cx = p.x;
    const cy = p.y * DEPTH;
    if (SHEET_TILESET.ready) {
      drawTile(ctx, TILE_POTION_ID, cx - dw/2, cy - dh + 4, dw, dh);
    } else {
      ctx.save();
      ctx.fillStyle = "#ff5d7a";
      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("+", p.x, p.y * DEPTH + 4);
    ctx.restore();
  });

  // 单位（按 y 排序做前后遮挡）
  //  - enemy 阵营（且不在 roles 列表中）→ 野怪
  //  - 其余（player/ally/有 role id 的 enemy）→ 角色
  const roleIds = new Set(s.roles.map((r) => r.id));
  [...s.entities]
    .filter((e) => e.alive !== false)
    .sort((a, b) => a.y - b.y)
    .forEach((e) => {
      if (e.side === "enemy" && !roleIds.has(e.id)) {
        drawMonster(ctx, e);
      } else {
        // ★ 传入头像图片用于显示
        drawEntity(ctx, e, getEntityAvatar(e));
      }
    });

  // 飘字
  s.floaters.forEach((f) => {
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.life / 12);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.lineWidth = 3;
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.strokeText(f.text, f.x, f.y * DEPTH - 40);
    ctx.fillText(f.text, f.x, f.y * DEPTH - 40);
    ctx.restore();
  });

  // ★ Debug 高亮：选中实体画黄色包围框 + ID 标签
  if (selectedEntityId.value) {
    const sel = s.entities.find((e) => e.id === selectedEntityId.value);
    if (sel) {
      const sy = sel.y * DEPTH;
      ctx.save();
      ctx.strokeStyle = "#ffe79e";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sel.x - 28, sy - 56, 56, 64);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 231, 158, 0.9)";
      ctx.fillRect(sel.x - 28, sy - 76, 56, 16);
      ctx.fillStyle = "#1e1f1f";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(sel.id, sel.x, sy - 64);
      ctx.restore();
    }
  }

  ctx.restore();
}

/* ---------------- 主循环 ---------------- */
let raf = 0;
let lastTickAt = 0;
const TICK_MS = 100;

function loop(ts: number) {
  raf = requestAnimationFrame(loop);
  _animTick++;
  const s = state.value;
  if (!s || s.phase !== "playing") return;
  render();
  if (ts - lastTickAt >= TICK_MS) {
    lastTickAt = ts;
    sendTick("tick", {
      input: {
        dx: input.value.dx,
        dy: input.value.dy,
        moveTo: input.value.moveTo,
      },
    });
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
function closeOver() { toonflowJsApi.minigame.abort(); }

const me = computed(() => state.value?.entities.find((e) => e.side === "player"));
const hpPct = computed(() => (me.value ? Math.max(0, (me.value.hp / me.value.maxHp) * 100) : 0));
const lastEvents = computed(() => (state.value?.events || []).slice(-4));

/* ---------------- 生命周期 ---------------- */
let stopHost: (() => void) | null = null;


onMounted(() => {
  // ★ 初始化地图装饰物（树木、水体等）
  initDecorations();

  // ★ 横竖屏自动检测（手机 App 嵌入时强制 portrait，PC 默认 landscape）
  orientation.value = autoDetectOrientation();

  // ★ CSS 自适应：监听 resize 强制刷新 flex 布局（Safari 等对 aspect-ratio 支持不全时）
  // 注：我们不修改 canvas.width/height——保持内部分辨率 960×372，
  //     sprite 在 CSS 缩放下自然等比缩放，不会模糊。
  const onResize = () => {
    // 触发 layout reflow（CSS 已经处理 aspect-ratio，这里只是兜底）
    if (canvasEl.value) {
      canvasEl.value.style.maxWidth = window.innerWidth + "px";
      canvasEl.value.style.maxHeight = window.innerHeight + "px";
    }
  };
  window.addEventListener("resize", onResize);
  onResize();

  // ★ 监听屏幕方向变化（移动设备旋转/横竖屏切换）
  // 注意：这里只做视觉提示，不自动重置 orientation——用户已点 🔄 后保持他的选择
  if (screen.orientation && "addEventListener" in screen.orientation) {
    screen.orientation.addEventListener("change", () => {
      // 屏幕物理方向变化时记录日志（不强制切换）
    });
  }

  stopHost = onHostState((d) => {
    const prevPhase = state.value?.phase;
    const newPhase = (d.state as GameState)?.phase;
    state.value = d.state as GameState;
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
      // 重置开始按钮 loading 状态
      starting.value = false;
    }
    if (newPhase === "playing" && prevPhase !== "playing") {
      // 进入战斗：自动切全屏（runtime 时机）
      toonflowJsApi.minigame.setFullscreen(true);
      // 确保地图装饰物已初始化
      if (mapDecorations.value.length === 0) initDecorations();
      // 成功进入战斗，清除 loading
      starting.value = false;
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
  raf = requestAnimationFrame(loop);
  notifyLoaded();
  // 兜底：宿主未推送状态时也要显示，避免白屏
  setTimeout(() => { if (!state.value) ready.value = true; }, 1200);
});

onBeforeUnmount(() => {
  stopHost?.();
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("resize", onResize);
  cancelAnimationFrame(raf);
});

watch(() => state.value?.phase, (p) => {
  if (p === "playing") requestAnimationFrame(() => render());
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
    </section>

    <!-- ===== 战斗阶段 ===== -->
    <section v-else-if="state.phase === 'playing'" class="play">
      <!-- 🔄 横竖屏切换按钮（绝对定位，不挤占 HUD 空间；req.md:57-58 要求左上角） -->
      <button class="btn btn--rotate" @click="toggleOrientation" :title="'切换' + (orientation === 'landscape' ? '竖屏' : '横屏')">
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
      </div>

      <canvas
        ref="canvasEl"
        class="stage"
        :class="'stage--' + orientation"
        :width="canvasW" :height="canvasH"
        @click="onCanvasClick"
      ></canvas>

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
      <button class="start" @click="closeOver">关闭</button>
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

/* canvas 内部按方向独立尺寸（横屏 960×372，竖屏 372×614）*/
/* CSS 用 min(100vw, 100vh×比例) 算最大填充尺寸，max 限制避免溢出 */
.stage--landscape {
  width: min(100%, calc((100vh - 90px) * 960 / 372));
  aspect-ratio: 960 / 372;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  object-fit: contain;
}

.stage--portrait {
  height: min(100%, calc((100vw - 90px) * 614 / 372));
  aspect-ratio: 372 / 614;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  object-fit: contain;
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
  background: rgba(30, 31, 31, 0.85);
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
  gap: 12px;
  font-size: 12px;
  color: #d0d0d0;
  flex: 1;
  align-items: center;
  flex-wrap: wrap;
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
  padding: 6px 14px;
  cursor: pointer;
  background: #c0392b;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  box-shadow: 0 2px 0 #6a1f1f;
}

.btn--exit:active {
  transform: translateY(2px);
  box-shadow: 0 0 0 #6a1f1f;
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
  top: 60px;
  z-index: 4;
  font-size: 12px;
  color: #ececec;
  text-shadow: 0 1px 2px #000;
  display: flex;
  flex-direction: column;
  gap: 3px;
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
  bottom: 18px;
  z-index: 6;
  width: 116px;
  height: 116px;
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
  gap: 6px;
}

.slots--skill {
  right: 18px;
}

.slots--item {
  right: 18px;
  bottom: 70px;
}

.slot {
  width: 52px;
  height: 48px;
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
  width: 56px;
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

.over .start {
  width: 240px;
  margin-top: 0;
}
</style>
