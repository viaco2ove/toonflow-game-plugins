<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-box">
      <h3>选择地图集</h3>
      <p class="hint">
        贴图替换作用于<strong>地图集自己的</strong> compiled_tileset_32x32.png
        （<code>map_design/&lt;地图集&gt;/images/</code>），每个地图集一份，互不影响。
      </p>

      <div v-if="currentCollection" class="current-hint">
        当前地图集：<b>{{ currentCollection }}</b>
      </div>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="!materials.length" class="empty">未找到任何带图集的地图集</div>
      <ul v-else class="mat-list">
        <li
          v-for="m in materials"
          :key="m.name"
          :class="{ selected: selected === m.name, current: m.name === currentCollection }"
          @click="selected = m.name"
        >
          <span class="radio"></span>
          <div class="mat-info">
            <div class="mat-name">
              {{ m.name }}
              <span v-if="m.name === currentCollection" class="tag">当前</span>
            </div>
            <div class="mat-sub">{{ m.png }}</div>
          </div>
        </li>
      </ul>

      <div class="warn" v-if="selected && selected !== currentCollection">
        ⚠️ 你改的不是当前打开的地图集「{{ currentCollection }}」，保存后当前地图看不到变化。
      </div>

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

const props = defineProps({
  // 当前打开的地图集名（来自 App.vue 的 currentColl.name）
  currentCollection: { type: String, default: '' },
})
const emit = defineEmits(['close', 'select'])
const materials = ref([])
const selected = ref(null)
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const list = await api.listMaterials()
    materials.value = list || []
    // 默认选中当前地图集；当前地图集不在列表里时才退回第一个
    if (materials.value.some(m => m.name === props.currentCollection)) {
      selected.value = props.currentCollection
    } else if (materials.value.length) {
      selected.value = materials.value[0].name
    }
  } catch (e) {
    console.error('加载地图集列表失败', e)
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
  background: #fff; border-radius: 8px; padding: 20px; width: 460px;
  box-shadow: 0 6px 24px rgba(0,0,0,.2);
}
h3 { margin: 0 0 4px; }
.hint { font-size: 12px; color: #888; margin: 0 0 10px; line-height: 1.6; }
.hint code { background: #f5f5f5; padding: 1px 4px; border-radius: 3px; }
.current-hint {
  font-size: 12px; padding: 6px 10px; border-radius: 4px;
  background: #e8f5e9; color: #2e7d32; margin-bottom: 10px;
}
.loading, .empty { padding: 16px; text-align: center; color: #999; }
.mat-list { list-style: none; margin: 0 0 12px; padding: 0; max-height: 320px; overflow-y: auto; }
.mat-list li {
  display: flex; align-items: center; gap: 10px; padding: 10px;
  border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px; cursor: pointer;
}
.mat-list li.selected { border-color: #1976d2; background: #f0f7ff; }
.mat-list li.current .mat-name { color: #2e7d32; }
.radio {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid #bbb; flex: none;
}
.mat-list li.selected .radio { border-color: #1976d2; background: #1976d2; }
.mat-name { font-weight: 600; }
.mat-sub { font-size: 11px; color: #999; word-break: break-all; }
.tag {
  font-size: 10px; background: #2e7d32; color: #fff; padding: 1px 5px;
  border-radius: 3px; margin-left: 6px; vertical-align: middle;
}
.warn {
  font-size: 12px; color: #e65100; background: #fff3e0;
  padding: 6px 10px; border-radius: 4px; margin-bottom: 12px;
}
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn {
  padding: 8px 16px; border: 1px solid #ddd; border-radius: 4px;
  background: #fff; cursor: pointer;
}
.btn-primary { background: #1976d2; color: #fff; border-color: #1976d2; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
</style>