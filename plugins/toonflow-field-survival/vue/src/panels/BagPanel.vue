<script setup lang="ts">
import { ref, computed } from "vue";

const props = defineProps<{
  items: any[];
  skills: any[];
  currentMp: number;
  currentMaxMp: number;
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

const RARITY_COLOR: Record<string, string> = { common: "#9aa4ad", fine: "#4aa3ff", rare: "#a76bff", epic: "#ff9a3c", legend: "#ff4d4d" };
const RARITY_NAME: Record<string, string> = { common: "普通", fine: "精良", rare: "稀有", epic: "史诗", legend: "传说" };

const selectedName = ref("");
const sellCount = ref(1);
const selected = computed(() => props.items.find((it) => it.name === selectedName.value) || null);
const unitPrice = computed(() => (selected.value ? Math.max(1, Math.round(selected.value.price || 0)) : 0));
const sellTotal = computed(() => unitPrice.value * Math.max(1, sellCount.value));

function pick(it: any) {
  selectedName.value = it.name;
  sellCount.value = 1;
}
function step(d: number) {
  if (!selected.value) return;
  sellCount.value = Math.max(1, Math.min(selected.value.count, sellCount.value + d));
}
function doSell() {
  if (!selected.value) return;
  emit("sell", selected.value, Math.max(1, sellCount.value));
}
function doUse(it?: any) {
  const target = it || selected.value;
  if (target) emit("use-item", target);
}

let dragFrom = -1;
function onDragStart(i: number) { dragFrom = i; }
function onDragOver(e: DragEvent) { e.preventDefault(); }
function onDrop(i: number) {
  if (dragFrom >= 0 && dragFrom !== i) emit("sort", dragFrom, i);
  dragFrom = -1;
}
</script>

<template>
  <div class="bp">
    <div class="bp-bar">
      <span>背包（{{ items.length }} 种）</span>
      <button class="bp-mini" @click="emit('sort-auto')">按名称排序</button>
    </div>
    <div v-if="!items.length" class="bp-empty">背包空空如也，去地图上打怪或到商城采购吧。</div>
    <div class="bp-grid">
      <div
        v-for="(it, i) in items"
        :key="it.name"
        class="bp-cell"
        :class="{ 'bp-cell--on': selectedName === it.name }"
        :style="{ borderColor: RARITY_COLOR[it.rarity] || '#9aa4ad' }"
        draggable="true"
        @dragstart="onDragStart(i)"
        @dragover="onDragOver"
        @drop="onDrop(i)"
        @click="pick(it)"
      >
        <div class="bp-cell__name">{{ it.name }}</div>
        <div class="bp-cell__meta">×{{ it.count }} · {{ RARITY_NAME[it.rarity] || it.rarity }}</div>
      </div>
    </div>

    <div v-if="selected" class="bp-detail">
      <div class="bp-detail__title">{{ selected.name }}</div>
      <div class="bp-detail__desc">
        {{ selected.desc || (selected.kind === "consumable" ? "使用后恢复 " + selected.heal + " 点生命" : "可用于交易或合成") }}
      </div>
      <div class="bp-detail__ops">
        <button class="bp-btn" @click="doUse()">使用</button>
        <button class="bp-btn bp-btn--warn" @click="doSell()">卖出（+{{ unitPrice }}金/个）</button>
      </div>
      <div class="bp-detail__sell">
        <button class="bp-mini" @click="step(-1)">-</button>
        <span class="bp-count">{{ sellCount }} / {{ selected.count }}</span>
        <button class="bp-mini" @click="step(1)">+</button>
        <button class="bp-mini bp-mini--go" @click="doSell()">卖出 {{ sellCount }} 个（+{{ sellTotal }}金）</button>
      </div>
    </div>

    <div class="bp-sec">技能栏（点击使用 / 切换）</div>
    <div class="bp-grid">
      <div
        v-for="(s, i) in skills"
        :key="s.name + i"
        class="bp-cell bp-cell--skill"
        :class="{ 'bp-cell--cd': s.cdLeft > 0 }"
        @click="emit('use-skill', s, i)"
      >
        <div class="bp-cell__name">{{ s.name }}</div>
        <div class="bp-cell__meta">威力{{ s.power }} · CD{{ (s.cd / 10).toFixed(1) }}s{{ s.cdLeft > 0 ? "（" + (s.cdLeft / 10).toFixed(1) + "s）" : "" }}</div>
      </div>
    </div>
    <div class="bp-hint">MP {{ currentMp }}/{{ currentMaxMp }}；无专属特效时统一走「小跳 + 飘字」通用特效。</div>
  </div>
</template>

<style scoped>
.bp { display: flex; flex-direction: column; gap: 8px; }
.bp-bar { display: flex; align-items: center; justify-content: space-between; color: #cfd8e3; font-size: 12px; }
.bp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.bp-cell { border: 1px solid #9aa4ad; border-radius: 6px; background: rgba(255, 255, 255, 0.04); padding: 6px; cursor: pointer; }
.bp-cell--on { background: rgba(90, 155, 255, 0.22); box-shadow: 0 0 0 1px #5a9bff inset; }
.bp-cell--cd { opacity: 0.45; }
.bp-cell__name { font-size: 12px; color: #e8eef5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-cell__meta { font-size: 10px; color: #93a2b3; margin-top: 2px; }
.bp-detail { border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; padding: 8px; background: rgba(0, 0, 0, 0.22); }
.bp-detail__title { font-weight: 700; }
.bp-detail__desc { font-size: 11px; color: #9fb0c2; margin: 4px 0 8px; }
.bp-detail__ops { display: flex; gap: 6px; }
.bp-detail__sell { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11px; }
.bp-count { color: #ffd76a; }
.bp-btn { flex: 1 1 auto; padding: 6px; border-radius: 6px; border: 1px solid #5a9bff; background: #2f6fd0; color: #fff; cursor: pointer; font-size: 12px; }
.bp-btn--warn { border-color: #ffb04a; background: #a8631a; }
.bp-mini { padding: 3px 8px; border-radius: 5px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.06); color: #cfd8e3; cursor: pointer; font-size: 11px; }
.bp-mini--go { border-color: #ffb04a; color: #ffd76a; }
.bp-sec { margin-top: 4px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); color: #9fd0ff; font-size: 12px; }
.bp-empty, .bp-hint { color: #93a2b3; font-size: 11px; }
</style>
