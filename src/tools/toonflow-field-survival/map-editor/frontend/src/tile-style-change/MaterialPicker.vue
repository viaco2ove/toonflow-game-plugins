<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-box">
      <h3>选择素材集</h3>
      <p class="hint">选择一个 compiled_tileset_32x32 素材集加载到工作区</p>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="!materials.length" class="empty">未找到任何素材集</div>
      <ul v-else class="mat-list">
        <li
          v-for="m in materials"
          :key="m.name"
          :class="{ selected: selected === m.name }"
          @click="selected = m.name"
        >
          <span class="radio"></span>
          <div class="mat-info">
            <div class="mat-name">{{ m.name }}</div>
            <div class="mat-sub">compiled_tileset_32x32 · {{ m.tileset }}</div>
          </div>
        </li>
      </ul>

      <div class="modal-actions">
        <button class="btn" @click="$emit('close')">取消</button>
        <button
          class="btn btn-primary"
          :disabled="!selected"
          @click="confirm"
        >加载</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api.js'

const emit = defineEmits(['close', 'select'])
const materials = ref([])
const selected = ref(null)
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const list = await api.listMaterials()
    materials.value = list || []
    if (materials.value.length) selected.value = materials.value[0].name
  } catch (e) {
    console.error('加载素材集失败', e)
  } finally {
    loading.value = false
  }
})

function confirm() {
  if (!selected.value) return
  emit('select', selected.value)
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal-box {
  background: #fff; border-radius: 8px; padding: 20px; width: 380px;
  box-shadow: 0 6px 24px rgba(0,0,0,.2);
}
h3 { margin: 0 0 4px; }
.hint { font-size: 12px; color: #888; margin: 0 0 12px; }
.loading, .empty { padding: 16px; text-align: center; color: #999; }
.mat-list { list-style: none; margin: 0 0 16px; padding: 0; max-height: 320px; overflow-y: auto; }
.mat-list li {
  display: flex; align-items: center; gap: 10px; padding: 10px;
  border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px; cursor: pointer;
}
.mat-list li.selected { border-color: #1976d2; background: #f0f7ff; }
.radio {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid #bbb; flex: none;
}
.mat-list li.selected .radio { border-color: #1976d2; background: #1976d2; }
.mat-name { font-weight: 600; }
.mat-sub { font-size: 11px; color: #999; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn {
  padding: 8px 16px; border: 1px solid #ddd; border-radius: 4px;
  background: #fff; cursor: pointer;
}
.btn-primary { background: #1976d2; color: #fff; border-color: #1976d2; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
