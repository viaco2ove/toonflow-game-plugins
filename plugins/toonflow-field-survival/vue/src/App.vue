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
import { IMG_GROUND, IMG_PERSON, IMG_BEAR, IMG_TREE, IMG_WATER, IMG_LAND } from "./assets";

const state = ref<GameState | null>(null);
const ready = ref(false);

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
  img.crossOrigin = "anonymous";
  img.src = avatarPath.startsWith("http") ? avatarPath : location.origin + avatarPath;
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
  return p.startsWith("http") ? p : location.origin + p;
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
const world = computed(() => state.value?.world || { w: 960, h: 600 });

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
// 内置精灵表（Base64 内联，不依赖外部文件，iframe 内可正常加载）
// ground.png  128×128  地面tile
// tree.png    128×128  树（整体图）
// bear.png    192/3×256/4  小动物（横3帧×竖4方向）
// person.png  300/4×450/4  角色（横4帧×竖4方向）
// water.png   128×128  水面tile
// land.png    128×128  陆地tile
// -------------------------------------------------------
const SHEET_PERSON  = loadSheet(IMG_PERSON,  75, 112, 4); // 300/4, 450/4
const SHEET_BEAR    = loadSheet(IMG_BEAR,    64,  64, 3); // 192/3, 256/4
const SHEET_GROUND  = loadSheet(IMG_GROUND,  128, 128);
const SHEET_TREE    = loadSheet(IMG_TREE,    128, 128);
const SHEET_WATER   = loadSheet(IMG_WATER,  128, 128);
const SHEET_LAND    = loadSheet(IMG_LAND,    128, 128);

// 地图装饰物（树木、水体）位置
interface Decoration { x: number; y: number; kind: "tree" | "water" | "land"; id: string }
const mapDecorations = ref<Decoration[]>([]);

// 初始化地图装饰物
function initDecorations() {
  const decs: Decoration[] = [];
  const rng = (a: number, b: number) => Math.random() * (b - a) + a;
  // 树木（8-12棵）
  for (let i = 0; i < 10; i++) {
    decs.push({ x: rng(80, 880), y: rng(80, 520), kind: "tree", id: `tree_${i}` });
  }
  // 水体（2-4处）
  for (let i = 0; i < 3; i++) {
    decs.push({ x: rng(100, 860), y: rng(100, 500), kind: "water", id: `water_${i}` });
  }
  // 陆地斑块（4-6处）
  for (let i = 0; i < 5; i++) {
    decs.push({ x: rng(60, 900), y: rng(60, 540), kind: "land", id: `land_${i}` });
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

// ----------------------------------------------------------
// 绘制角色（复用 pixi_game 的 sprite sheet 切帧逻辑）
// ----------------------------------------------------------
function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, avatarImg?: HTMLImageElement) {
  const sy = e.y * DEPTH;
  const s = SHEET_PERSON;

  // 缩放：人物约 48×72 像素（比原来稍大，更接近 2.5D）
  const dw = 48, dh = 72;
  const dx = e.x - dw / 2;
  const dy = sy - dh;

  // 动作帧
  const moving = e.vx !== 0 || e.vy !== 0;
  const frame = animFrame(moving ? "walk" : "idle");
  const dir = dirIndex(e.facing);

  // 阴影
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(e.x, sy + 4, dw * 0.38, dw * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 精灵本体
  if (s.ready) {
    ctx.drawImage(s.img,
      frame * s.fw, dir * s.fh, s.fw, s.fh,
      dx, dy, dw, dh,
    );
  } else {
    // 兜底彩色胶囊
    const color = e.side === "player" ? "#4ea1ff"
      : e.side === "ally" ? "#5fd28a"
      : e.side === "enemy" ? "#ff6b6b"
      : "#9aa4b2";
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(e.x, sy - 36, 20, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ★ 角色头像（req.md 要求：2.5D 小人模型上方显示适合比例的头像）
  const avatarSize = 28;
  const avatarX = e.x - avatarSize / 2;
  const avatarY = dy - avatarSize - 4;
  if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
    // 有头像图片时绘制圆形裁剪的头像
    ctx.save();
    ctx.beginPath();
    ctx.arc(e.x, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
    // 头像边框
    ctx.save();
    ctx.strokeStyle = e.side === "player" ? "#4ea1ff" : e.side === "ally" ? "#5fd28a" : "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 头顶名字（角色名优先用 avatar，无则用首字）
  const headY = dy - 6;
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "bold 11px sans-serif";
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillText(e.name.slice(0, 3), e.x + 1, headY + 1);
  ctx.fillStyle = "#fff";
  ctx.fillText(e.name.slice(0, 3), e.x, headY);
  ctx.restore();

  // 血条
  const barW = 44, barH = 4;
  const barX = e.x - barW / 2;
  const barY = dy - 10;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.5)";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = e.side === "enemy" ? "#ff4c4c" : "#57d977";
  ctx.fillRect(barX, barY, barW * Math.max(0, e.hp / e.maxHp), barH);
  ctx.restore();
}

// ----------------------------------------------------------
// 绘制野怪（用 bear.png sprite sheet）
// ----------------------------------------------------------
function drawMonster(ctx: CanvasRenderingContext2D, e: Entity) {
  const sy = e.y * DEPTH;
  const s = SHEET_BEAR;
  const dw = 42, dh = 56;
  const dx = e.x - dw / 2;
  const dy = sy - dh;

  const moving = e.vx !== 0 || e.vy !== 0;
  const frame = animFrame(moving ? "walk" : "idle");
  const dir = dirIndex(e.facing);

  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(e.x, sy + 4, dw * 0.36, dw * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (s.ready) {
    ctx.drawImage(s.img,
      frame * s.fw, dir * s.fh, s.fw, s.fh,
      dx, dy, dw, dh,
    );
  } else {
    // 兜底：棕色圆
    ctx.save();
    ctx.fillStyle = "#8b5a2b";
    ctx.beginPath();
    ctx.ellipse(e.x, sy - 28, 18, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 血条
  const barW = 36, barH = 4;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.5)";
  ctx.fillRect(e.x - barW / 2, dy - 8, barW, barH);
  ctx.fillStyle = "#ff4c4c";
  ctx.fillRect(e.x - barW / 2, dy - 8, barW * Math.max(0, e.hp / e.maxHp), barH);
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
  for (const sheet of [SHEET_GROUND, SHEET_PERSON, SHEET_BEAR, SHEET_TREE, SHEET_WATER, SHEET_LAND]) {
    if (!sheet.ready && sheet.img.complete && sheet.img.naturalWidth > 0) {
      sheet.ready = true;
    }
  }

  ctx.clearRect(0, 0, W, H);
  // 地面：用 ground.png tile 铺满（参考 pixi_game 方案）
  if (SHEET_GROUND.ready) {
    const tw = SHEET_GROUND.fw * sx;
    const th = SHEET_GROUND.fh * DEPTH * sy;
    for (let tx = 0; tx < W; tx += tw) {
      for (let ty = 0; ty < H; ty += th) {
        ctx.drawImage(SHEET_GROUND.img, 0, 0, SHEET_GROUND.fw, SHEET_GROUND.fh, tx, ty, tw, th);
      }
    }
  } else {
    // 兜底渐变
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1a3a1f");
    g.addColorStop(1, "#0a1a0d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ★ 地图 zones（map-gener agent 产出）：不同 kind 不同色调椭圆区域
  const kindColors: Record<string, string> = {
    safe: "rgba(94, 210, 138, .16)",
    danger: "rgba(255, 107, 107, .14)",
    loot: "rgba(224, 178, 74, .16)",
    quest: "rgba(110, 168, 254, .14)",
  };
  (s.map?.zones || []).forEach((z) => {
    const zy = z.y * DEPTH;
    ctx.save();
    ctx.fillStyle = kindColors[z.kind] || "rgba(255,255,255,.06)";
    ctx.strokeStyle = "rgba(255,255,255,.14)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(z.x, zy, z.r, z.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(z.name, z.x, zy - 4);
    ctx.restore();
  });

  // 网格
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < world.value.w; x += 60) {
    ctx.beginPath(); ctx.moveTo(x * sx, 0); ctx.lineTo(x * sx, H); ctx.stroke();
  }
  for (let y = 0; y < world.value.h; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y * DEPTH * sy); ctx.lineTo(W, y * DEPTH * sy); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.scale(sx, sy);

  // ★ 地图装饰物（树木、水体、陆地斑块）
  mapDecorations.value.forEach((dec) => {
    const sy2 = dec.y * DEPTH;
    const dSize = dec.kind === "tree" ? 40 : 32;
    const dx = dec.x - dSize / 2;
    const dy = sy2 - dSize;

    if (dec.kind === "tree" && SHEET_TREE.ready) {
      ctx.drawImage(SHEET_TREE.img, dx, dy, dSize, dSize);
    } else if (dec.kind === "water" && SHEET_WATER.ready) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.drawImage(SHEET_WATER.img, dx, dy, dSize, dSize);
      ctx.restore();
    } else if (dec.kind === "land" && SHEET_LAND.ready) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.drawImage(SHEET_LAND.img, dx, dy, dSize, dSize);
      ctx.restore();
    } else {
      // 兜底形状
      ctx.save();
      ctx.globalAlpha = 0.5;
      if (dec.kind === "tree") {
        ctx.fillStyle = "#2d5a27";
        ctx.beginPath();
        ctx.arc(dec.x, sy2, 16, 0, Math.PI * 2);
        ctx.fill();
      } else if (dec.kind === "water") {
        ctx.fillStyle = "#4a90d9";
        ctx.beginPath();
        ctx.arc(dec.x, sy2, 14, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#8b7355";
        ctx.beginPath();
        ctx.arc(dec.x, sy2, 12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  });

  // 宝箱
  s.chests.forEach((ch) => {
    ctx.save();
    ctx.fillStyle = ch.opened ? "rgba(160,150,120,.5)" : "#e0b24a";
    ctx.strokeStyle = "rgba(0,0,0,.5)";
    ctx.lineWidth = 2;
    ctx.fillRect(ch.x - 14, ch.y * DEPTH - 14, 28, 22);
    ctx.strokeRect(ch.x - 14, ch.y * DEPTH - 14, 28, 22);
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(ch.opened ? "空" : "宝箱", ch.x, ch.y * DEPTH - 20);
    ctx.restore();
  });

  // 血瓶
  s.potions.forEach((p) => {
    ctx.save();
    ctx.fillStyle = "#ff5d7a";
    ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y * DEPTH, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("+", p.x, p.y * DEPTH + 4);
    ctx.restore();
  });

  // 单位（按 y 排序做前后遮挡）
  //  - enemy 阵营（且不在 roles 列表中）→ 野怪，用 bear.png
  //  - 其余（player/ally/有 role id 的 enemy）→ 角色，用 person.png
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
        :width="world.w" :height="Math.round(world.h * 0.62)"
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
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  margin: 0;
}

body {
  font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif;
  background: #0b1118;
  color: #e8eef7;
}

.fs {
  height: 100%;
  width: 100%;
  position: relative;
  overflow: hidden;
}

/* 选人 */
.select {
  height: 100%;
  overflow: auto;
  padding: 18px 20px;
}

.select__head h2 {
  margin: 0 0 4px;
  font-size: 20px;
}

.select__head p {
  margin: 0 0 14px;
  font-size: 13px;
  color: #9fb0c6;
}

.select__group {
  margin-bottom: 14px;
}

.select__group h3 {
  font-size: 14px;
  margin: 0 0 8px;
  color: #cfe0f5;
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
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
  border: 1px solid rgba(160, 190, 230, .3);
  background: rgba(255, 255, 255, .05);
  color: #dce7f5;
  font-size: 13px;
}

.chip img {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
}

.chip--on {
  background: #2f6fd0;
  border-color: #4ea1ff;
  color: #fff;
}

.chip--danger.chip--on {
  background: #c0392b;
  border-color: #ff6b6b;
}

.hint {
  font-size: 12px;
  color: #8fa2ba;
  margin: 6px 0 0;
}

.start {
  display: block;
  width: 100%;
  padding: 12px;
  margin-top: 6px;
  border: 0;
  border-radius: 10px;
  background: #2f6fd0;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.start:disabled {
  background: #1e4a8a;
  cursor: not-allowed;
  opacity: 0.85;
}

.start__loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.start__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 战斗 */
.play {
  position: absolute;
  inset: 0;
}

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
  background: rgba(4, 10, 18, .55);
  backdrop-filter: blur(4px);
}

.hud__left {
  min-width: 180px;
}

.hp {
  width: 160px;
  height: 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, .16);
  overflow: hidden;
}

.hp__bar {
  height: 100%;
  background: linear-gradient(90deg, #57d977, #2fa85a);
}

.hud__txt {
  font-size: 11px;
  color: #cfe0f5;
  margin-top: 3px;
}

.hud__mid {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #cfe0f5;
  flex: 1;
}

.hud__map {
  color: #ffe9a8;
  font-weight: 600;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn--exit {
  border: 0;
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  background: rgba(255, 90, 90, .9);
  color: #fff;
  font-size: 13px;
}

.stage {
  display: block;
  width: 100%;
  height: 100%;
  background: #0d1a12;
}

.events {
  position: absolute;
  left: 12px;
  top: 52px;
  z-index: 4;
  font-size: 12px;
  color: #cfe0f5;
  text-shadow: 0 1px 2px #000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
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
  background: rgba(255, 255, 255, .10);
  border: 1px solid rgba(255, 255, 255, .22);
  backdrop-filter: blur(3px);
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pad__knob {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .35);
  border: 1px solid rgba(255, 255, 255, .5);
}

/* 技能 / 物品 */
.slots {
  position: absolute;
  bottom: 18px;
  z-index: 6;
  display: flex;
  gap: 8px;
}

.slots--skill {
  right: 18px;
}

.slots--item {
  right: 18px;
  bottom: 78px;
}

.slot {
  width: 47px;
  height: 35px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, .22);
  background: rgba(10, 18, 30, .55);
  backdrop-filter: blur(3px);
  color: #e8eef7;
  font-size: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  position: relative;
}

.slot__name {
    max-width: 41px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: normal;
}

.slot__count {
  font-size: 10px;
  color: #9fb0c6;
}

.slot__cd {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .5);
  border-radius: 10px;
  font-size: 14px;
}

.slot--empty {
  opacity: .45;
}

.slot--page {
  width: 56px;
  background: rgba(47, 111, 208, .65);
}

.tips {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: rgba(220, 232, 247, .55);
  z-index: 4;
}

/* 结算 */
.over {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.over h2 {
  margin: 0;
  font-size: 20px;
}

.over ul {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 14px;
  line-height: 1.9;
  color: #cfe0f5;
}

.over .start {
  width: 220px;
}
</style>
