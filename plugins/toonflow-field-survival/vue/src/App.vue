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

function startGame() {
  sendTick("start", {
    selections: {
      participants: [...participants.value],
      spectators: [...spectators.value],
      enemies: [...enemies.value],
    },
  });
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

const avatarCache = new Map<string, HTMLImageElement>();
function loadAvatar(path: string): HTMLImageElement | null {
  if (!path) return null;
  if (avatarCache.has(path)) return avatarCache.get(path)!;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = path;
  avatarCache.set(path, img);
  return img;
}

/** 2.5D：屏幕 y = 世界 y * 0.62，营造俯视斜角 */
const DEPTH = 0.62;
function drawEntity(ctx: CanvasRenderingContext2D, e: Entity) {
  const sy = e.y * DEPTH;
  const bodyH = 52;
  const bw = e.side === "enemy" ? 26 : 28;

  // 影子
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(e.x, sy + 10, bw * 0.55, bw * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const color = e.side === "player" ? "#4ea1ff"
    : e.side === "ally" ? "#5fd28a"
    : e.side === "enemy" ? "#ff6b6b"
    : "#9aa4b2";

  // 身体（胶囊）
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.lineWidth = 2;
  const top = sy - bodyH + 18;
  ctx.beginPath();
  ctx.moveTo(e.x - bw / 2, sy + 6);
  ctx.lineTo(e.x - bw / 2, top + bw / 2);
  ctx.arc(e.x, top + bw / 2, bw / 2, Math.PI, 0);
  ctx.lineTo(e.x + bw / 2, sy + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 头（头像或圆）
  const headR = 15;
  const headY = top - headR - 2;
  const img = e.avatarPath ? loadAvatar(e.avatarPath) : null;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(e.x, headY, headR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, e.x - headR, headY - headR, headR * 2, headR * 2);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, headY, headR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = "#f2f5fa";
    ctx.strokeStyle = "rgba(0,0,0,.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#2b3240";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(e.name.slice(0, 1), e.x, headY + 5);
    ctx.restore();
  }

  // 名字 + 血条
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.fillText(e.name, e.x, headY - headR - 6);
  const barW = 42;
  const barH = 5;
  const barY = headY - headR - 2;
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(e.x - barW / 2, barY, barW, barH);
  ctx.fillStyle = e.side === "enemy" ? "#ff5c5c" : "#57d977";
  ctx.fillRect(e.x - barW / 2, barY, barW * Math.max(0, e.hp / e.maxHp), barH);
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

  ctx.clearRect(0, 0, W, H);
  // 地面
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#123024");
  g.addColorStop(1, "#08160f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

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
  [...s.entities]
    .filter((e) => e.alive !== false)
    .sort((a, b) => a.y - b.y)
    .forEach((e) => drawEntity(ctx, e));

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
function closeOver() { sendToHost("退出", {}); }

const me = computed(() => state.value?.entities.find((e) => e.side === "player"));
const hpPct = computed(() => (me.value ? Math.max(0, (me.value.hp / me.value.maxHp) * 100) : 0));
const lastEvents = computed(() => (state.value?.events || []).slice(-4));

/* ---------------- 生命周期 ---------------- */
let stopHost: (() => void) | null = null;

onMounted(() => {
  stopHost = onHostState((d) => {
    const prevPhase = state.value?.phase;
    state.value = d.state as GameState;
    ready.value = true;
    if (state.value?.phase === "select") {
      const p = state.value.roles.find((r) => r.roleType === "player");
      if (p && !participants.value.length) participants.value = [p.id];
      // 选人阶段：确保不是全屏（用户切回来好操作）
      toonflowJsApi.minigame.setFullscreen(false);
    }
    if (state.value?.phase === "playing" && prevPhase !== "playing") {
      // 进入战斗：自动切全屏（runtime 时机）
      toonflowJsApi.minigame.setFullscreen(true);
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

      <button class="start" @click="startGame">开始游戏</button>
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
