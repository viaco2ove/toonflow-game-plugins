<script setup lang="ts">
const props = defineProps<{
  bagItems: any[];
  bagSkills: any[];
  ringItems: any[];
  ringSkills: string[];
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();
</script>

<template>
  <div class="rp">
    <div class="rp-hint">纳戒用于收纳多余物资与技能（数据保存在插件会话数据表）。</div>

    <div class="rp-cols">
      <div class="rp-col">
        <div class="rp-col__title">背包物品（{{ bagItems.length }}）</div>
        <div v-for="it in bagItems" :key="it.name" class="rp-row">
          <span class="rp-name">{{ it.name }} ×{{ it.count }}</span>
          <button class="rp-btn" @click="emit('move', it.name, 'ring')">存入</button>
        </div>
        <div v-if="!bagItems.length" class="rp-empty">无</div>
      </div>
      <div class="rp-col">
        <div class="rp-col__title">纳戒物品（{{ ringItems.length }}）</div>
        <div v-for="it in ringItems" :key="it.name" class="rp-row">
          <span class="rp-name">{{ it.name }} ×{{ it.count }}</span>
          <button class="rp-btn" @click="emit('move', it.name, 'bag')">取出</button>
        </div>
        <div v-if="!ringItems.length" class="rp-empty">无</div>
      </div>
    </div>

    <div class="rp-cols">
      <div class="rp-col">
        <div class="rp-col__title">技能栏技能（{{ bagSkills.length }}）</div>
        <div v-for="(s, i) in bagSkills" :key="s.name + i" class="rp-row">
          <span class="rp-name">{{ s.name }}</span>
          <button class="rp-btn" @click="emit('move-skill', s.name, 'ring')">存入</button>
        </div>
        <div v-if="!bagSkills.length" class="rp-empty">无</div>
      </div>
      <div class="rp-col">
        <div class="rp-col__title">纳戒技能（{{ ringSkills.length }}）</div>
        <div v-for="(n, i) in ringSkills" :key="n + i" class="rp-row">
          <span class="rp-name">{{ n }}</span>
          <button class="rp-btn" @click="emit('move-skill', n, 'bag')">取出</button>
        </div>
        <div v-if="!ringSkills.length" class="rp-empty">无</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rp { display: flex; flex-direction: column; gap: 8px; }
.rp-hint { color: #93a2b3; font-size: 11px; }
.rp-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rp-col { border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 6px; background: rgba(0, 0, 0, 0.18); min-height: 80px; }
.rp-col__title { font-size: 11px; color: #9fd0ff; margin-bottom: 4px; }
.rp-row { display: flex; align-items: center; gap: 4px; padding: 3px 0; border-bottom: 1px dashed rgba(255, 255, 255, 0.08); }
.rp-name { flex: 1 1 auto; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-btn { padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.06); color: #cfd8e3; font-size: 10px; cursor: pointer; }
.rp-empty { color: #6d7c8c; font-size: 11px; }
</style>
