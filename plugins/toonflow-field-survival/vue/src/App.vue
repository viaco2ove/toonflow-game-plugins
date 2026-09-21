<template>
  <div class="survival-game">
    <!-- 顶栏 -->
    <header class="topbar">
      <button class="btn ghost" @click="exit">退出</button>
      <div class="title">🌲 野外生存</div>
      <div class="wave">第 {{ state.day }} 天 · 第 {{ state.wave }} 波</div>
    </header>

    <!-- 主区域 -->
    <main class="main">
      <!-- 左侧状态 -->
      <aside class="stats">
        <div class="stat-card you" :class="{ dead: !state.alive }">
          <div class="stat-name">你</div>
          <StatBar label="生命" :value="state.hp" :max="100" color="#4ade80" />
          <StatBar label="饥饿" :value="state.hunger" :max="100" color="#facc15" />
          <StatBar label="干渴" :value="state.thirst" :max="100" color="#38bdf8" />
          <div class="score">积分 {{ state.score }}</div>
        </div>

        <!-- 敌人列表 -->
        <div v-if="aliveEnemies.length" class="enemies">
          <div class="section-title">威胁</div>
          <div v-for="e in aliveEnemies" :key="e.id" class="stat-card enemy">
            <div class="stat-name">{{ e.type === "boss" ? "👹" : "🐺" }} {{ e.name }}</div>
            <StatBar label="HP" :value="e.hp" :max="e.maxHp" color="#f87171" />
            <div class="score">攻击 {{ e.attack }}</div>
          </div>
        </div>
      </aside>

      <!-- 事件流 -->
      <section class="events">
        <div class="section-title">荒野日志</div>
        <div ref="logBox" class="log">
          <div v-for="(ev, i) in state.events.slice().reverse()" :key="state.events.length - i" class="log-line">
            {{ ev }}
          </div>
        </div>
      </section>
    </main>

    <!-- 死亡遮罩 -->
    <div v-if="!state.alive" class="overlay">
      <div class="overlay-box">
        <div class="overlay-title">💀 你倒下了</div>
        <div class="overlay-desc">存活 {{ state.day }} 天 · 积分 {{ state.score }}</div>
        <button class="btn primary" @click="restart">重新开始</button>
      </div>
    </div>

    <!-- 底部动作 -->
    <footer class="actions">
      <button
        v-for="a in actions"
        :key="a"
        class="btn action"
        :disabled="busy || !state.alive"
        @click="doAction(a)"
      >{{ a }}</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import StatBar from "./components/StatBar.vue";
import { sendToHost, notifyLoaded, onHostState } from "./bridge";
import type { GameState } from "./types";

/** 初始状态：与后端 entry.ts emptyState() 一致（宿主接入前显示用） */
function initialState(): GameState {
  return {
    hp: 100, hunger: 100, thirst: 100,
    day: 1, wave: 0, enemies: [],
    inventory: [], score: 0, alive: true,
    events: ["你从昏迷中醒来，发现自己身处荒野……（等待后端开始游戏）"],
  };
}

const state = reactive<GameState>(initialState());
const actions = ref<string[]>(["寻找食物", "寻找水源", "搜索周围", "攻击", "防御"]);
const busy = ref(false);
const logBox = ref<HTMLElement | null>(null);

const aliveEnemies = computed(() => state.enemies.filter((e) => e.hp > 0));

let offHostState: (() => void) | null = null;

function syncFromHost(data: { state: GameState; actions?: string[]; response?: string }): void {
  const s = data.state || {} as GameState;
  state.hp = Number(s.hp ?? 100);
  state.hunger = Number(s.hunger ?? 100);
  state.thirst = Number(s.thirst ?? 100);
  state.day = Number(s.day ?? 1);
  state.wave = Number(s.wave ?? 0);
  state.enemies = Array.isArray(s.enemies) ? s.enemies : [];
  state.inventory = Array.isArray(s.inventory) ? s.inventory : [];
  state.score = Number(s.score ?? 0);
  state.alive = s.alive !== false;
  state.events = Array.isArray(s.events) ? s.events : [];
  if (Array.isArray(data.actions) && data.actions.length) {
    actions.value = data.actions.filter((x: unknown) => typeof x === "string");
  }
  busy.value = false;
}

onMounted(() => {
  notifyLoaded();
  offHostState = onHostState(syncFromHost);
});

onUnmounted(() => {
  offHostState?.();
});

/** 动作按钮：postMessage 给宿主 → 宿主把文本送进聊天输入框 → 后端 entry.ts */
function doAction(label: string): void {
  if (busy.value) return;
  busy.value = true;
  sendToHost("action", { text: label });
}

function restart(): void {
  sendToHost("action", { text: "重新开始" });
}

function exit(): void {
  sendToHost("action", { text: "退出" });
}
</script>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }
.survival-game {
  position: fixed; inset: 0;
  background: #0a0a1a;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #e2e8f0;
  user-select: none;
  display: flex; flex-direction: column;
}

/* 顶栏 */
.topbar {
  height: 48px; flex-shrink: 0;
  background: rgba(10, 10, 30, 0.9);
  border-bottom: 1px solid #2a5a2a;
  display: flex; align-items: center;
  padding: 0 12px; gap: 12px;
}
.title { color: #4ade80; font-weight: bold; font-size: 16px; flex: 1; text-align: center; }
.wave { color: #facc15; font-size: 12px; }

/* 主区域 */
.main { flex: 1; display: flex; min-height: 0; padding: 12px; gap: 12px; }
.stats { width: 150px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
.events { flex: 1; min-width: 0; display: flex; flex-direction: column; background: rgba(15, 25, 15, 0.4); border: 1px solid #2a4a2a; border-radius: 10px; }

.section-title { font-size: 11px; color: #6b8f6b; margin-bottom: 6px; letter-spacing: 2px; }

.stat-card {
  background: rgba(10, 10, 30, 0.85);
  border: 1px solid #2a4a2a; border-radius: 10px;
  padding: 8px 10px; display: flex; flex-direction: column; gap: 4px;
}
.stat-card.enemy { border-color: #5a2a2a; }
.stat-card.dead { opacity: 0.5; }
.stat-name { color: #4ade80; font-size: 12px; font-weight: bold; }
.stat-card.enemy .stat-name { color: #f87171; }
.score { font-size: 10px; color: #888; }

/* 日志 */
.log { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.log-line { font-size: 12px; color: #a8c8a8; line-height: 1.6; border-bottom: 1px dashed rgba(74, 222, 128, 0.1); padding-bottom: 4px; }

/* 底部动作 */
.actions {
  flex-shrink: 0; padding: 10px 12px;
  display: flex; gap: 8px; flex-wrap: wrap;
  background: rgba(10, 10, 30, 0.9);
  border-top: 1px solid #2a5a2a;
  justify-content: center;
}

/* 按钮 */
.btn {
  background: rgba(74, 222, 128, 0.15);
  border: 1px solid #4ade80;
  color: #4ade80;
  border-radius: 8px;
  padding: 8px 18px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}
.btn:hover:not(:disabled) { background: rgba(74, 222, 128, 0.3); }
.btn:active:not(:disabled) { transform: scale(0.95); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.ghost { border-color: #555; color: #aaa; background: transparent; }
.btn.primary { font-weight: bold; font-size: 15px; padding: 10px 32px; }

/* 死亡遮罩 */
.overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0, 0, 0, 0.85);
  display: flex; align-items: center; justify-content: center;
}
.overlay-box { text-align: center; display: flex; flex-direction: column; gap: 14px; align-items: center; }
.overlay-title { font-size: 36px; color: #ef4444; font-weight: bold; }
.overlay-desc { color: #ccc; font-size: 14px; }
</style>
