<script setup lang="ts">
import { ref, computed } from "vue";

const props = defineProps<{
  nodes: any[];
  currentMap: string;
  playerX: number;
  playerY: number;
  cards: any[];
  player: any;
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

/** false = 细节（当前地图放大视图）；true = 大地图（各入口相连） */
const zoomed = ref(false);

const here = computed(() => {
  const list = (props.cards || []).filter((c) => (c.mapName || "") === props.currentMap);
  if (props.player && (props.player.mapName || "") === props.currentMap) {
    return [{ ...props.player, side: "player" }, ...list];
  }
  return list.length ? list : [{ id: "__me", name: "我", side: "player", x: props.playerX, y: props.playerY }];
});

function project(pts: any[]) {
  const xs = pts.map((p) => Number(p.x) || 0);
  const ys = pts.map((p) => Number(p.y) || 0);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  return pts.map((p) => ({
    ...p,
    lx: 8 + (((Number(p.x) || 0) - minX) / spanX) * 84,
    ly: 8 + (((Number(p.y) || 0) - minY) / spanY) * 84,
  }));
}

const norm = computed(() => project(here.value));
const mapPts = computed(() => project(props.nodes || []));
/** 入口相邻连线（成对预计算，避免 v-for i=0 时取 mapPts[-1] 崩渲染） */
const mapLinks = computed(() => mapPts.value.slice(1).map((n, i) => ({ a: mapPts.value[i], b: n })));
</script>

<template>
  <div class="mapp">
    <div class="mp-bar">
      <span>当前：{{ currentMap }}</span>
      <span class="mp-pos">({{ Math.round(playerX) }}, {{ Math.round(playerY) }})</span>
      <button class="mp-mini" @click="zoomed = !zoomed">{{ zoomed ? "放大" : "缩小" }}</button>
    </div>

    <div v-if="!zoomed" class="mp-stage">
      <div class="mp-title">{{ currentMap }}（细节视图）</div>
      <div class="mp-plot">
        <div
          v-for="(c, i) in norm"
          :key="c.id || i"
          class="mp-dot"
          :class="{ 'mp-dot--me': c.side === 'player', 'mp-dot--enemy': c.enemy }"
          :style="{ left: c.lx + '%', top: c.ly + '%' }"
        >
          <span class="mp-dot__label">{{ c.name }}</span>
        </div>
      </div>
      <div class="mp-legend">本图角色分布（金色=用户，红色=敌对）</div>
    </div>

    <div v-else class="mp-stage">
      <div class="mp-title">大地图（点击节点传送）</div>
      <div class="mp-plot">
        <svg class="mp-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            v-for="(l, i) in mapLinks"
            :key="'l' + i"
            :x1="l.a.lx"
            :y1="l.a.ly"
            :x2="l.b.lx"
            :y2="l.b.ly"
            stroke="rgba(255,255,255,0.22)"
            stroke-width="0.4"
          />
        </svg>
        <button
          v-for="n in mapPts"
          :key="n.name"
          class="mp-node"
          :class="{ 'mp-node--cur': n.name === currentMap }"
          :style="{ left: n.lx + '%', top: n.ly + '%' }"
          @click="emit('travel', n.name)"
        >
          {{ n.name }}
        </button>
      </div>
      <div class="mp-legend">连线为入口相邻关系；金色为当前所在地图，点击其它节点可传送</div>
    </div>

    <div class="mp-list">
      <div class="mp-list__head">全部地图（{{ mapPts.length }}）</div>
      <div v-for="n in mapPts" :key="'row' + n.name" class="mp-row" :class="{ 'mp-row--cur': n.name === currentMap }">
        <span class="mp-row__name">{{ n.name }}</span>
        <span v-if="n.name === currentMap" class="mp-row__tag">当前</span>
        <button class="mp-row__btn" :disabled="n.name === currentMap" @click="emit('travel', n.name)">传送</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mapp { display: flex; flex-direction: column; gap: 6px; }
.mp-bar { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #cfd8e3; }
.mp-pos { color: #93a2b3; }
.mp-mini { margin-left: auto; padding: 3px 10px; border-radius: 5px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.06); color: #cfd8e3; font-size: 11px; cursor: pointer; }
.mp-stage { border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(0, 0, 0, 0.2); padding: 6px; }
.mp-title { font-size: 11px; color: #9fd0ff; margin-bottom: 4px; }
.mp-plot { position: relative; width: 100%; height: 300px; background: radial-gradient(circle at 50% 50%, rgba(90, 155, 255, 0.1), transparent 70%); border-radius: 6px; }
.mp-lines { position: absolute; inset: 0; width: 100%; height: 100%; }
.mp-dot { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: #8fa6bd; }
.mp-dot--me { background: #ffd76a; box-shadow: 0 0 8px #ffd76a; }
.mp-dot--enemy { background: #ff6b6b; }
.mp-dot__label { position: absolute; left: 12px; top: -2px; font-size: 10px; color: #cfd8e3; white-space: nowrap; }
.mp-node { position: absolute; transform: translate(-50%, -50%); padding: 3px 8px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(30, 40, 55, 0.9); color: #cfd8e3; font-size: 10px; cursor: pointer; }
.mp-node--cur { border-color: #ffd76a; color: #ffd76a; background: rgba(90, 70, 20, 0.9); }
.mp-legend { margin-top: 4px; font-size: 10px; color: #6d7c8c; }
.mp-list { border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(0, 0, 0, 0.2); padding: 6px; max-height: 180px; overflow-y: auto; }
.mp-list__head { font-size: 11px; color: #9fd0ff; margin-bottom: 4px; }
.mp-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 4px; font-size: 11px; color: #cfd8e3; }
.mp-row:hover { background: rgba(255, 255, 255, 0.06); }
.mp-row--cur .mp-row__name { color: #ffd76a; }
.mp-row__name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-row__tag { font-size: 9px; color: #ffd76a; border: 1px solid rgba(255, 215, 106, 0.5); border-radius: 3px; padding: 0 3px; }
.mp-row__btn { padding: 2px 10px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(90, 155, 255, 0.18); color: #cfe3ff; font-size: 10px; cursor: pointer; }
.mp-row__btn:hover:not(:disabled) { background: rgba(90, 155, 255, 0.35); }
.mp-row__btn:disabled { opacity: 0.35; cursor: default; }
</style>
