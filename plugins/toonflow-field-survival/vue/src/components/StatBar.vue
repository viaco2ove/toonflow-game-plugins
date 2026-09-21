<template>
  <div class="statbar">
    <span class="label">{{ label }}</span>
    <div class="track">
      <div class="fill" :style="{ width: pct + '%', background: color }" />
    </div>
    <span class="value">{{ Math.max(0, value) }}/{{ max }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{
  label: string;
  value: number;
  max: number;
  color: string;
}>();

const pct = computed(() =>
  Math.max(0, Math.min(100, Math.round((Number(props.value) / Math.max(1, Number(props.max))) * 100))),
);
</script>

<style scoped>
.statbar { display: flex; align-items: center; gap: 6px; }
.label { font-size: 10px; color: #8aa88a; width: 26px; flex-shrink: 0; }
.track { flex: 1; height: 8px; background: #333; border-radius: 4px; overflow: hidden; }
.fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
.value { font-size: 10px; color: #888; width: 44px; text-align: right; flex-shrink: 0; }
</style>