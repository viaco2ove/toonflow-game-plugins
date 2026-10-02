<script setup lang="ts">
const props = defineProps<{
  goods: any[];
  gold: number;
  source: string;
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

const RARITY_COLOR: Record<string, string> = { common: "#9aa4ad", fine: "#4aa3ff", rare: "#a76bff", epic: "#ff9a3c", legend: "#ff4d4d" };
const KIND_NAME: Record<string, string> = { consumable: "消耗品", material: "材料", equipment: "装备", skill_book: "技能书", quest: "任务物品" };

function kindName(k: string) { return KIND_NAME[k] || k || "物资"; }
</script>

<template>
  <div class="shp">
    <div class="shp-bar">
      <span class="shp-gold">金币 {{ gold }}</span>
      <span class="shp-src">货源：{{ source === "agent" ? "商城 agent（故事物资）" : "插件常备物资" }}</span>
      <button class="shp-mini" @click="emit('refresh')">刷新货源</button>
    </div>

    <div v-for="g in goods" :key="g.id" class="shp-row" :class="{ 'shp-row--no': gold < g.price }">
      <div class="shp-info">
        <div class="shp-name" :style="{ color: RARITY_COLOR[g.rarity] || '#e8eef5' }">{{ g.name }}</div>
        <div class="shp-desc">{{ g.desc || kindName(g.kind) }}</div>
      </div>
      <div class="shp-price">{{ g.price }} 金</div>
      <button class="shp-btn" :disabled="gold < g.price" @click="emit('buy', g, 1)">购买</button>
    </div>

    <div v-if="!goods.length" class="shp-empty">暂无货源，点击「刷新货源」重新生成。</div>
  </div>
</template>

<style scoped>
.shp { display: flex; flex-direction: column; gap: 6px; }
.shp-bar { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #cfd8e3; }
.shp-gold { color: #ffd76a; }
.shp-src { color: #93a2b3; margin-left: auto; }
.shp-row { display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(0, 0, 0, 0.18); }
.shp-row--no { opacity: 0.55; }
.shp-info { flex: 1 1 auto; min-width: 0; }
.shp-name { font-size: 12px; }
.shp-desc { font-size: 10px; color: #93a2b3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shp-price { color: #ffd76a; font-size: 12px; }
.shp-btn { padding: 4px 10px; border-radius: 5px; border: 1px solid #5a9bff; background: #2f6fd0; color: #fff; font-size: 11px; cursor: pointer; }
.shp-btn:disabled { border-color: #4a5563; background: #3a434f; color: #8b98a6; cursor: not-allowed; }
.shp-mini { padding: 3px 8px; border-radius: 5px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.06); color: #cfd8e3; font-size: 11px; cursor: pointer; }
.shp-empty { color: #93a2b3; font-size: 11px; }
</style>
