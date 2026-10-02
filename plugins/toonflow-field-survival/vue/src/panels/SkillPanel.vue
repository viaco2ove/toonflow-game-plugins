<script setup lang="ts">
const props = defineProps<{
  skills: any[];
  currentMp: number;
  currentMaxMp: number;
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

function cdText(cd: number) { return (cd / 10).toFixed(1) + "s"; }
function cdLeftText(cdLeft: number) { return (cdLeft / 10).toFixed(1) + "s"; }
</script>

<template>
  <div class="skp">
    <div class="skp-bar">MP {{ currentMp }}/{{ currentMaxMp }} · 技能 {{ skills.length }} 项</div>

    <div v-for="(s, i) in skills" :key="s.name + i" class="skp-row" :class="{ 'skp-row--cd': s.cdLeft > 0 }">
      <div class="skp-info">
        <div class="skp-name">{{ s.name }}</div>
        <div class="skp-desc">威力 {{ s.power }} · 冷却 {{ cdText(s.cd) }}{{ s.cdLeft > 0 ? "（剩余 " + cdLeftText(s.cdLeft) + "）" : "" }}</div>
      </div>
      <button class="skp-btn" @click="emit('use-skill', s, i)">{{ s.cdLeft > 0 ? "冷却中" : "使用" }}</button>
    </div>

    <div v-if="!skills.length" class="skp-empty">尚未习得技能，可通过商城技能书或剧情获得。</div>
    <div class="skp-hint">点击「使用」即切换为当前技能并施放，与技能栏（快捷栏）同步。</div>
  </div>
</template>

<style scoped>
.skp { display: flex; flex-direction: column; gap: 6px; }
.skp-bar { font-size: 11px; color: #9fd0ff; }
.skp-row { display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(0, 0, 0, 0.18); }
.skp-row--cd { opacity: 0.6; }
.skp-info { flex: 1 1 auto; min-width: 0; }
.skp-name { font-size: 12px; }
.skp-desc { font-size: 10px; color: #93a2b3; }
.skp-btn { padding: 4px 10px; border-radius: 5px; border: 1px solid #5a9bff; background: #2f6fd0; color: #fff; font-size: 11px; cursor: pointer; }
.skp-empty { color: #93a2b3; font-size: 11px; }
.skp-hint { color: #6d7c8c; font-size: 10px; }
</style>
