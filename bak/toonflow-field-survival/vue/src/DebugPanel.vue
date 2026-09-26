<script setup lang="ts">
/**
 * Debug 面板（仅 debug 模式可见）
 *
 * 三个 tab：
 *   - 角色：列出存活 entities，点击高亮并在 canvas 画包围框
 *   - 日志：游戏事件流（state.events）+ console 拦截
 *   - 变量：state 快照 JSON 视图
 *
 * 🛠 按钮可拖动改变位置（pointer events + 阈值判断 click vs drag）
 */
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import type { GameState, Entity } from "./types";

const props = defineProps<{ state: GameState | null }>();
const emit = defineEmits<{ (e: "select-entity", entity: Entity | null): void }>();

const open = ref(false);
const tab = ref<"role" | "log" | "var">("role");
const selectedEntityId = ref<string | null>(null);

/* ----------------- 拖动定位 ----------------- */
/**
 * 按钮位置（CSS px，相对于窗口）
 * 默认右下角 12px 处（与初始 CSS 一致）
 */
const pos = ref({ x: window.innerWidth - 56, y: window.innerHeight - 56 });

const DRAG_THRESHOLD = 6; // 超过 6px 视为拖动，不触发 click
let dragStart: { x: number; y: number; px: number; py: number } | null = null;
let dragMoved = false;

function onDragStart(e: PointerEvent) {
  // 仅在 🛠 按钮本体，不在 panel 内
  if (!(e.target as HTMLElement).classList.contains("debug__toggle")) return;
  dragStart = { x: e.clientX, y: e.clientY, px: pos.value.x, py: pos.value.y };
  dragMoved = false;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  e.stopPropagation();
}

function onDragMove(e: PointerEvent) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (!dragMoved && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragMoved = true;
  if (!dragMoved) return;
  // 限制不超出窗口边界
  const W = window.innerWidth;
  const H = window.innerHeight;
  pos.value.x = Math.max(0, Math.min(W - 44, dragStart.px + dx));
  pos.value.y = Math.max(0, Math.min(H - 44, dragStart.py + dy));
}

function onDragEnd() {
  dragStart = null;
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
}

/** 点击 toggle：若本次 pointerdown->up 移动超过阈值，则视为拖动，不切换 open */
function onToggleClick(e: MouseEvent) {
  if (dragMoved) {
    // 拖动后阻止 click 触发 toggle
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  open.value = !open.value;
}

/* ----------------- Tab: 角色 ----------------- */
const entities = computed(() => (props.state?.entities || []).filter((e) => e.alive !== false));
const eventLog = computed(() => (props.state?.events || []).slice(-30).reverse());

function selectEntity(e: Entity) {
  selectedEntityId.value = e.id;
  emit("select-entity", e);
}

/* ----------------- Tab: 日志（console 拦截） ----------------- */
const consoleLogs = ref<{ ts: number; level: string; text: string }[]>([]);

let origLog: typeof console.log | null = null;
let origWarn: typeof console.warn | null = null;
let origErr: typeof console.error | null = null;
let origInfo: typeof console.info | null = null;

function installConsoleInterceptor() {
  const ts = () => Date.now();
  const wrap = (level: string, fn: any) => (...args: any[]) => {
    consoleLogs.value.push({ ts: Date.now(), level, text: args.map(String).join(" ") });
    if (consoleLogs.value.length > 200) consoleLogs.value.shift();
    return fn.apply(console, args);
  };
  origLog = console.log;
  origWarn = console.warn;
  origErr = console.error;
  origInfo = console.info;
  console.log = wrap("log", console.log);
  console.warn = wrap("warn", console.warn);
  console.error = wrap("error", console.error);
  console.info = wrap("info", console.info);
}

function uninstallConsoleInterceptor() {
  if (origLog) console.log = origLog;
  if (origWarn) console.warn = origWarn;
  if (origErr) console.error = origErr;
  if (origInfo) console.info = origInfo;
}

/* ----------------- Tab: 变量 ----------------- */
const varFilter = ref("");
const varFiltered = computed(() => {
  if (!props.state) return "";
  const json = JSON.stringify(props.state, null, 2);
  if (!varFilter.value) return json;
  // 简单高亮：找出包含关键字的行
  return json
    .split("\n")
    .map((line) => (line.includes(varFilter.value) ? ">> " + line : line))
    .join("\n");
});

onMounted(() => {
  installConsoleInterceptor();
});
onBeforeUnmount(() => {
  uninstallConsoleInterceptor();
  emit("select-entity", null);
});

function levelClass(level: string) {
  if (level === "error") return "log--err";
  if (level === "warn") return "log--warn";
  if (level === "info") return "log--info";
  return "log--log";
}
function tsText(ts: number) {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}
</script>

<template>
  <div
    class="debug"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', right: 'auto', bottom: 'auto' }"
  >
    <button class="debug__toggle" @click="onToggleClick" @pointerdown="onDragStart" :title="open ? '关闭调试' : '打开调试（拖动可移动位置）'">
      {{ open ? "✕" : "🛠" }}
    </button>

    <div v-if="open" class="debug__panel">
      <div class="debug__tabs">
        <button :class="{ on: tab === 'role' }" @click="tab = 'role'">角色 ({{ entities.length }})</button>
        <button :class="{ on: tab === 'log' }" @click="tab = 'log'">日志 ({{ consoleLogs.length + eventLog.length }})</button>
        <button :class="{ on: tab === 'var' }" @click="tab = 'var'">变量</button>
      </div>

      <!-- Tab: 角色 -->
      <div v-if="tab === 'role'" class="debug__body">
        <div class="role-list">
          <div
            v-for="e in entities"
            :key="e.id"
            class="role-item"
            :class="{ 'role-item--on': selectedEntityId === e.id, ['side-' + e.side]: true }"
            @click="selectEntity(e)"
          >
            <span class="role-item__name">{{ e.name }}</span>
            <span class="role-item__side">{{ e.side }}</span>
            <span class="role-item__hp">{{ Math.round(e.hp) }}/{{ e.maxHp }}</span>
            <span class="role-item__pos">({{ Math.round(e.x) }}, {{ Math.round(e.y) }})</span>
          </div>
        </div>
      </div>

      <!-- Tab: 日志 -->
      <div v-if="tab === 'log'" class="debug__body">
        <div class="log-section">
          <h4>游戏事件</h4>
          <div class="log-list">
            <div v-for="(ev, i) in eventLog" :key="'ev' + i" class="log log--ev">{{ ev }}</div>
          </div>
        </div>
        <div class="log-section">
          <h4>Console ({{ consoleLogs.length }})</h4>
          <div class="log-list">
            <div v-for="(l, i) in consoleLogs.slice().reverse()" :key="'cl' + i" :class="['log', levelClass(l.level)]">
              <span class="log__ts">{{ tsText(l.ts) }}</span>
              <span class="log__lvl">{{ l.level }}</span>
              <span class="log__txt">{{ l.text }}</span>
            </div>
            <div v-if="consoleLogs.length === 0" class="log log--empty">（暂无 console 日志）</div>
          </div>
        </div>
      </div>

      <!-- Tab: 变量 -->
      <div v-if="tab === 'var'" class="debug__body">
        <input v-model="varFilter" class="var-filter" placeholder="搜索字段名..." />
        <pre class="var-pre">{{ varFiltered }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debug {
  position: fixed;
  /* left/top 由 inline style 控制（可拖动） */
  z-index: 9999;
  font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace;
  font-size: 12px;
  color: #d0d0d0;
  touch-action: none;       /* 防止拖动时触发滚动 */
  user-select: none;
}

.debug__toggle {
  cursor: grab;             /* 暗示可拖动 */
  width: 44px;
  height: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid #d4a13e;
  background: rgba(30, 31, 31, 0.92);
  color: #ffe79e;
  font-size: 20px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.debug__toggle:hover {
  background: rgba(60, 61, 61, 0.95);
}

.debug__panel {
  position: absolute;
  left: 0;
  bottom: 52px;          /* 在 toggle 上方弹出 */
  width: 480px;
  max-height: 70vh;
  background: #1e1f1f;
  border: 2px solid #4f4f4f;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}

.debug__tabs {
  display: flex;
  border-bottom: 2px solid #4f4f4f;
  background: #2a2b2b;
}
.debug__tabs button {
  flex: 1;
  background: transparent;
  border: 0;
  color: #9aa0a6;
  padding: 8px 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.debug__tabs button.on {
  background: #1e1f1f;
  color: #ffe79e;
  border-bottom: 2px solid #d4a13e;
}

.debug__body {
  flex: 1;
  overflow: auto;
  padding: 8px;
  min-height: 200px;
}

/* 角色列表 */
.role-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.role-item {
  display: grid;
  grid-template-columns: 1fr 60px 80px 80px;
  gap: 6px;
  padding: 6px 8px;
  background: #2a2b2b;
  border: 1px solid #3d3d3d;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
  align-items: center;
}
.role-item:hover {
  background: #3a3b3b;
}
.role-item--on {
  border-color: #ffe79e;
  background: #3a2f1a;
}
.role-item__name {
  font-weight: 600;
  color: #ececec;
}
.role-item.side-player .role-item__side { color: #4ea1ff; }
.role-item.side-ally .role-item__side { color: #5fd28a; }
.role-item.side-enemy .role-item__side { color: #ff6b6b; }
.role-item__hp {
  text-align: right;
  color: #5fd28a;
  font-variant-numeric: tabular-nums;
}
.role-item.side-enemy .role-item__hp {
  color: #ff6b6b;
}
.role-item__pos {
  text-align: right;
  color: #8a8e93;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* 日志 */
.log-section { margin-bottom: 12px; }
.log-section h4 {
  margin: 0 0 4px;
  font-size: 11px;
  color: #d4a13e;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.log-list {
  background: #0c0c0c;
  border: 1px solid #3d3d3d;
  border-radius: 2px;
  max-height: 180px;
  overflow: auto;
  padding: 4px;
}
.log {
  font-size: 11px;
  padding: 2px 4px;
  border-bottom: 1px dotted #2a2b2b;
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-all;
}
.log--ev {
  color: #b0c4d6;
}
.log--log { color: #d0d0d0; }
.log--info { color: #5fd28a; }
.log--warn { color: #d4a13e; background: rgba(212, 161, 62, 0.08); }
.log--err { color: #ff6b6b; background: rgba(255, 107, 107, 0.1); }
.log--empty { color: #6a6a6a; font-style: italic; }
.log__ts { color: #6a6a6a; margin-right: 4px; }
.log__lvl { color: #888; margin-right: 4px; font-weight: 700; }

/* 变量 */
.var-filter {
  width: 100%;
  background: #0c0c0c;
  border: 1px solid #3d3d3d;
  color: #ececec;
  padding: 4px 6px;
  font-family: inherit;
  font-size: 11px;
  margin-bottom: 4px;
  box-sizing: border-box;
}
.var-pre {
  margin: 0;
  padding: 6px;
  background: #0c0c0c;
  border: 1px solid #3d3d3d;
  border-radius: 2px;
  font-size: 10px;
  color: #b0c4d6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 50vh;
  overflow: auto;
}
</style>