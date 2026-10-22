<template>
  <div class="tileset-workspace">
    <div class="ws-toolbar">
      <span class="ws-title">图集工作区 · 地图集 {{ materialName }}</span>
      <span class="ws-meta">{{ cols }}×{{ rows }} 格 · {{ tilewidth }}px</span>
      <div class="ws-zoom">
        <label>缩放</label>
        <input type="range" min="0.1" max="4" step="0.05" :value="scale" @input="onSlider($event)" />
        <span>{{ Math.round(scale * 100) }}%</span>
      </div>
      <button class="btn ghost" @click="$emit('close')">← 返回编辑器</button>
    </div>

    <div
      class="ws-viewport"
      ref="scrollRef"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @wheel="onWheel"
      @contextmenu.prevent
    >
      <div class="ws-canvas-wrap" :style="wrapStyle">
        <img
          :src="tilesetUrl"
          class="ws-img"
          :style="imgStyle"
          @load="onImgLoad"
          @click="onClick"
          draggable="false"
        />
        <!-- 单选高亮 -->
        <div v-if="singleSel && !rectSel" class="ws-sel" :style="selStyle"></div>
        <!-- 框选高亮 -->
        <div v-if="rectSel" class="ws-sel-rect" :style="rectStyle"></div>
      </div>
    </div>

    <div class="ws-status">
      <span v-if="coordText" class="ws-coord">📍 {{ coordText }}</span>
      <span v-else>{{ statusText }}</span>
      <span class="ws-selinfo" v-if="selectedCount > 1"> · 已选 {{ selectedCount }} 格</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  materialName: { type: String, required: true },
  tilesetUrl: { type: String, required: true },
  meta: { type: Object, default: null },   // compiled_tileset_32x32.json
})
const emit = defineEmits(['select', 'close', 'reset'])

const MIN_SCALE = 0.1
const MAX_SCALE = 4

const scrollRef = ref(null)
const scale = ref(0.5)
const panX = ref(0)
const panY = ref(0)
const naturalW = ref(0)
const naturalH = ref(0)

const singleSel = ref(null)   // { tileId, col, row, category }
const rectSel = ref(null)     // { c0, r0, c1, r1 }
const coordMode = ref(false)
const coordText = ref('')
const statusText = ref('左键单选 · Ctrl+左键拖动平移 · 中键拖动缩放 · Shift+左键框选多格 · T 切换坐标查看')

// ─── 交互状态 ───
let mode = null   // 'pan' | 'zoom' | 'select'
let startX = 0, startY = 0, startPanX = 0, startPanY = 0
let startScale = 1, zoomCX = 0, zoomCY = 0
let startCell = null

const cols = computed(() => {
  const m = props.meta
  return m?.columns ?? (naturalW.value ? Math.floor(naturalW.value / (m?.tilewidth || 32)) : 120)
})
const rows = computed(() => {
  const m = props.meta
  if (m?.tileheight) return Math.ceil((m.imageheight || naturalH.value) / m.tileheight)
  return Math.ceil((m?.tilecount || 0) / cols.value) || 0
})
const tilewidth = computed(() => props.meta?.tilewidth || 32)

const wrapStyle = computed(() => ({
  width: naturalW.value * scale.value + 'px',
  height: naturalH.value * scale.value + 'px',
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
}))
const imgStyle = computed(() => ({
  width: '100%',
  height: '100%',
  imageRendering: 'pixelated',
  display: 'block',
}))
const selStyle = computed(() => {
  if (!singleSel.value) return {}
  const cw = 100 / cols.value
  const ch = 100 / rows.value
  return {
    left: singleSel.value.col * cw + '%',
    top: singleSel.value.row * ch + '%',
    width: cw + '%',
    height: ch + '%',
  }
})
const rectStyle = computed(() => {
  if (!rectSel.value) return {}
  const { c0, r0, c1, r1 } = rectSel.value
  const cc0 = Math.min(c0, c1), cc1 = Math.max(c0, c1)
  const rr0 = Math.min(r0, r1), rr1 = Math.max(r0, r1)
  const cw = 100 / cols.value, ch = 100 / rows.value
  return {
    left: cc0 * cw + '%',
    top: rr0 * ch + '%',
    width: (cc1 - cc0 + 1) * cw + '%',
    height: (rr1 - rr0 + 1) * ch + '%',
  }
})
const selectedCount = computed(() => {
  if (rectSel.value) {
    const { c0, r0, c1, r1 } = rectSel.value
    return (Math.abs(c1 - c0) + 1) * (Math.abs(r1 - r0) + 1)
  }
  return singleSel.value ? 1 : 0
})

function buildTile(col, row) {
  const tileId = row * cols.value + col
  return { tileId, col, row, category: categoryOf(tileId) }
}
function categoryOf(tileId) {
  const t = props.meta?.tiles?.find(x => x.id === tileId)
  if (!t) return ''
  const p = (t.properties || []).find(p => p.name === 'category')
  return p?.value ?? ''
}

function cellAt(clientX, clientY) {
  const sc = scrollRef.value
  if (!sc || !cols.value) return null
  const img = sc.querySelector('.ws-img')
  const rect = img.getBoundingClientRect()
  const nx = (clientX - rect.left) / rect.width
  const ny = (clientY - rect.top) / rect.height
  const col = Math.min(cols.value - 1, Math.max(0, Math.floor(nx * cols.value)))
  const row = Math.min(rows.value - 1, Math.max(0, Math.floor(ny * rows.value)))
  return { col, row }
}

// 以容器内某点为锚做光标居中缩放（与编辑器滚轮缩放同语义）
function zoomAt(clientX, clientY, ns) {
  const sc = scrollRef.value
  if (!sc) return
  const rect = sc.getBoundingClientRect()
  const cx = clientX - rect.left
  const cy = clientY - rect.top
  const imgX = (cx - panX.value) / scale.value
  const imgY = (cy - panY.value) / scale.value
  scale.value = ns
  panX.value = cx - imgX * ns
  panY.value = cy - imgY * ns
}
function zoomBy(delta) {
  const sc = scrollRef.value
  if (!sc) return
  const r = sc.getBoundingClientRect()
  const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value + delta))
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, ns)
}
function onSlider(e) {
  const sc = scrollRef.value
  if (!sc) return
  const r = sc.getBoundingClientRect()
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, +e.target.value)
}

function onImgLoad(e) {
  naturalW.value = e.target.naturalWidth
  naturalH.value = e.target.naturalHeight
  // 居中显示
  const sc = scrollRef.value
  if (sc) {
    const r = sc.getBoundingClientRect()
    panX.value = Math.max(0, (r.width - naturalW.value * scale.value) / 2)
    panY.value = Math.max(0, (r.height - naturalH.value * scale.value) / 2)
  }
}

// ─── 鼠标交互（对齐地图编辑器）───
function onPointerDown(e) {
  const sc = scrollRef.value
  const rect = sc.getBoundingClientRect()
  if (e.button === 1) {                         // 中键 → 缩放拖拽（用户约定：中键缩放）
    mode = 'zoom'
    startY = e.clientY
    startScale = scale.value
    zoomCX = rect.left + rect.width / 2
    zoomCY = rect.top + rect.height / 2
    e.preventDefault()
    return
  }
  if (e.button === 0 && e.ctrlKey) {           // Ctrl+左键 → 平移（与编辑器一致）
    mode = 'pan'
    startX = e.clientX; startY = e.clientY
    startPanX = panX.value; startPanY = panY.value
    e.preventDefault()
    return
  }
  if (e.button === 0 && e.shiftKey) {           // Shift+左键 → 框选多格（地图里是笔刷，tileset 里改为框选）
    const c = cellAt(e.clientX, e.clientY)
    if (!c) return
    mode = 'select'
    startCell = c
    rectSel.value = { c0: c.col, r0: c.row, c1: c.col, r1: c.row }
    singleSel.value = null
    e.preventDefault()
    return
  }
  if (e.button === 0 && e.altKey) {            // Alt+左键 → 图集无对象，保留为 no-op
    e.preventDefault()
    return
  }
  // 普通左键交给 @click 处理单选
}
function onPointerMove(e) {
  const sc = scrollRef.value
  if (!sc) return
  const rect = sc.getBoundingClientRect()
  if (mode === 'pan') {
    panX.value = startPanX + (e.clientX - startX)
    panY.value = startPanY + (e.clientY - startY)
  } else if (mode === 'zoom') {
    const dy = startY - e.clientY
    const factor = Math.exp(dy * 0.004)
    const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale * factor))
    zoomAt(zoomCX, zoomCY, ns)
  } else if (mode === 'select') {
    const c = cellAt(e.clientX, e.clientY)
    if (c) rectSel.value = { c0: startCell.col, r0: startCell.row, c1: c.col, r1: c.row }
  }
}
function onPointerUp() {
  if (mode === 'select' && rectSel.value) {
    const { c0, r0, c1, r1 } = rectSel.value
    const cc0 = Math.min(c0, c1), cc1 = Math.max(c0, c1)
    const rr0 = Math.min(r0, r1), rr1 = Math.max(r0, r1)
    const tileIds = []
    for (let r = rr0; r <= rr1; r++)
      for (let c = cc0; c <= cc1; c++) tileIds.push(r * cols.value + c)
    const anchor = buildTile(c1, r1)
    emit('select', { ...anchor, tileIds })
    statusText.value = `已框选 ${tileIds.length} 格（${cc1 - cc0 + 1}×${rr1 - rr0 + 1}）`
  }
  mode = null
}
function onWheel(e) {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
  const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))
  zoomAt(e.clientX, e.clientY, ns)
}
function onClick(e) {
  if (e.shiftKey || e.ctrlKey || e.altKey || e.button !== 0) return
  const c = cellAt(e.clientX, e.clientY)
  if (!c) return
  const t = buildTile(c.col, c.row)
  singleSel.value = t
  rectSel.value = null
  emit('select', { ...t, tileIds: [t.tileId] })
  if (coordMode.value) {
    coordText.value = `格 (col=${c.col}, row=${c.row})  #${t.tileId}`
  }
}

// ─── 键盘导航（次要，仅焦点不在输入框时生效）───
function currentIds() {
  if (rectSel.value) {
    const { c0, r0, c1, r1 } = rectSel.value
    const cc0 = Math.min(c0, c1), cc1 = Math.max(c0, c1)
    const rr0 = Math.min(r0, r1), rr1 = Math.max(r0, r1)
    const ids = []
    for (let r = rr0; r <= rr1; r++)
      for (let c = cc0; c <= cc1; c++) ids.push(r * cols.value + c)
    return ids
  }
  if (singleSel.value) return [singleSel.value.tileId]
  return []
}
function moveSel(dx, dy) {
  if (!cols.value) return
  const s0 = singleSel.value || { col: 0, row: 0 }
  const col = Math.min(cols.value - 1, Math.max(0, s0.col + dx))
  const row = Math.min(rows.value - 1, Math.max(0, s0.row + dy))
  const t = buildTile(col, row)
  singleSel.value = t
  rectSel.value = null
  emit('select', { ...t, tileIds: [t.tileId] })
}
function onKeyNav(e) {
  const tag = (e.target.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  const k = e.key
  if ((k === 't' || k === 'T') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    coordMode.value = !coordMode.value
    statusText.value = `坐标查看 ${coordMode.value ? '开' : '关'}（左键查看格行列）`
    e.preventDefault()
    return
  }
  if (k === 'ArrowUp') { e.preventDefault(); moveSel(0, -1) }
  else if (k === 'ArrowDown') { e.preventDefault(); moveSel(0, 1) }
  else if (k === 'ArrowLeft') { e.preventDefault(); moveSel(-1, 0) }
  else if (k === 'ArrowRight') { e.preventDefault(); moveSel(1, 0) }
  else if (k === 'Enter') {
    if (singleSel.value) { e.preventDefault(); emit('select', { ...singleSel.value, tileIds: [singleSel.value.tileId] }) }
  }
  else if (k === 'r' || k === 'R') {
    const ids = currentIds()
    if (ids.length) { e.preventDefault(); emit('reset', { tileIds: ids }) }
  }
  else if (k === '+' || k === '=') { e.preventDefault(); zoomBy(0.1) }
  else if (k === '-' || k === '_') { e.preventDefault(); zoomBy(-0.1) }
}

onMounted(() => window.addEventListener('keydown', onKeyNav))
onUnmounted(() => window.removeEventListener('keydown', onKeyNav))

watch(() => props.materialName, () => {
  singleSel.value = null
  rectSel.value = null
  coordText.value = ''
})
</script>

<style scoped>
.tileset-workspace { display: flex; flex-direction: column; height: 100%; }
.ws-toolbar {
  display: flex; align-items: center; gap: 12px; padding: 6px 10px;
  border-bottom: 1px solid var(--border, #e0e0e0); background: #fafafa; flex: none;
}
.ws-title { font-weight: 600; }
.ws-meta { font-size: 12px; color: #888; }
.ws-zoom { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-left: auto; }
.ws-zoom input[type=range] { width: 140px; }
.btn.ghost { padding: 4px 10px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; }
.ws-viewport {
  flex: 1; overflow: hidden; background: #2b2b2b;
  position: relative; touch-action: none; cursor: crosshair;
}
.ws-canvas-wrap { position: absolute; top: 0; left: 0; flex: none; }
.ws-img { user-select: none; pointer-events: auto; }
.ws-sel {
  position: absolute; box-sizing: border-box;
  border: 2px solid #ff3b30; background: rgba(255,59,48,.15); pointer-events: none;
}
.ws-sel-rect {
  position: absolute; box-sizing: border-box;
  border: 2px dashed #ffd60a; background: rgba(255,214,10,.18); pointer-events: none;
}
.ws-status {
  padding: 6px 10px; font-size: 13px; border-top: 1px solid var(--border, #e0e0e0);
  display: flex; gap: 8px; align-items: center;
}
.ws-coord { color: #1976d2; font-weight: 600; }
.ws-selinfo { color: #e65100; }
</style>
