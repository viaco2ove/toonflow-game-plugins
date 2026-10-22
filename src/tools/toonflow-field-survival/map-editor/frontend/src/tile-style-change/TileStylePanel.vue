<template>
  <div class="tile-style-panel">
    <h4>🎨 贴图替换</h4>

    <!-- ★ 系列替换（以对象/系列为单位换皮相） -->
    <div class="series-section">
      <label class="series-toggle">
        <input type="checkbox" v-model="seriesMode" />
        <b>系列替换</b>
        <span class="series-hint">以对象/系列为单位换皮相（整套格子一起换）</span>
      </label>

      <template v-if="seriesMode">
        <!-- AI 挑选对话区 -->
        <div class="form-group">
          <label>AI 挑选系列（描述你想改成什么样）</label>
          <div class="chat-row">
            <input
              v-model="chatInput"
              placeholder="例：半兽人换成暗黑疾风狼 / 建筑物改成现代风"
              @keydown.enter="askSuggest"
            />
            <button class="btn" :disabled="suggesting || !chatInput.trim()" @click="askSuggest">
              {{ suggesting ? '…' : '发送' }}
            </button>
          </div>
          <div v-if="suggestReply" class="suggest-reply">{{ suggestReply }}</div>
        </div>

        <!-- 系列选择（勾选要换的系列） -->
        <div class="form-group" v-if="seriesMatches.length">
          <label>匹配到的系列（勾选要换皮相的）</label>
          <div class="series-list">
            <label v-for="g in seriesMatches" :key="g.name" class="series-item">
              <input type="checkbox" v-model="g.checked" @change="onSeriesChecked" />
              <span class="series-name">{{ g.name }}</span>
              <span class="series-meta">{{ g.kind === 'character' ? '角色' : '系列' }} · {{ g.count }} 格</span>
            </label>
          </div>
        </div>

        <!-- 手动选系列 -->
        <div class="form-group">
          <label>或手动选系列</label>
          <select v-model="manualSeries" @change="onManualSeries">
            <option :value="null">— 选择系列 —</option>
            <option v-for="g in allSeries" :key="g.name" :value="g.name">
              {{ g.name }}（{{ g.kind === 'character' ? '角色' : '系列' }}，{{ g.count }} 格）
            </option>
          </select>
        </div>

        <!-- 选中的系列 -->
        <div class="form-group" v-if="activeSeries">
          <label>
            目标系列：<b>{{ activeSeries.name }}</b>（{{ activeSeries.count }} 格）
            <button class="link-btn" @click="loadSeriesPreview">预览原格</button>
          </label>
          <img v-if="seriesPreviewOrig" :src="seriesPreviewOrig" class="series-sheet" />
        </div>

        <!-- 生成皮相候选 -->
        <div class="actions">
          <button
            class="btn btn-primary"
            :disabled="!activeSeries || recoloring"
            @click="genCandidates"
          >{{ recoloring ? '生成皮相中…' : '✨ 生成皮相候选' }}</button>
        </div>

        <!-- 候选（多套配色） -->
        <div class="form-group" v-if="seriesCandidates.length">
          <label>皮相候选（{{ seriesCandidates.length }} 套，点选一套后替换）</label>
          <div class="cand-list">
            <div
              v-for="cand in seriesCandidates"
              :key="cand.id"
              class="cand-thumb sheet-thumb"
              :class="{ selected: selectedSeriesCandidateId === cand.id }"
              :title="cand.label"
              @click="selectedSeriesCandidateId = cand.id"
            >
              <img :src="cand.sheet" />
              <span class="cand-idx">{{ cand.label }}</span>
            </div>
          </div>
        </div>

        <!-- 应用 / 还原 -->
        <div class="actions" v-if="seriesCandidates.length">
          <button
            class="btn btn-apply"
            :disabled="!selectedSeriesCandidate || applyingSeries"
            @click="applySeriesSkin"
          >{{ applyingSeries ? '替换中…' : `⬇ 替换整套（${activeSeries?.count ?? '?'} 格）` }}</button>
        </div>
        <div class="actions" v-if="activeSeries">
          <button class="btn" :disabled="revertingSeries" @click="revertSeriesSkin">
            {{ revertingSeries ? '还原中…' : '↺ 还原该系列' }}
          </button>
        </div>
      </template>
    </div>

    <div class="divider"></div>

    <!-- 绑定模型状态 -->
    <div class="bind-status" :class="boundModel ? 'on' : 'off'">
      <template v-if="boundModel">
        已绑定模型：<b>{{ boundModel.manufacturer }}</b> / {{ boundModel.model || '(未命名)' }}
      </template>
      <template v-else>
        ⚠️ 未绑定贴图替换模型，点右上角 ⚙️ 设置一个 image 模型
      </template>
    </div>

    <!-- 选中 tile 预览 -->
    <div class="tile-preview-section">
      <div class="preview-label">当前选中 tile</div>
      <div class="tile-preview">
        <img v-if="currentTileUrl" :src="currentTileUrl" class="tile-img" />
        <div v-else class="tile-empty">点击图集选择 tile</div>
      </div>
      <div class="tile-id" v-if="selectedTileId !== null">#{{ selectedTileId }}<span v-if="selectedTileIds.length > 1"> 等 {{ selectedTileIds.length }} 格</span></div>
    </div>

    <!-- 提示词 -->
    <div class="form-group">
      <label>提示词</label>
      <textarea v-model="prompt" rows="3" placeholder="描述你想要的新贴图，比如：现代城市人行道砖纹理"></textarea>
    </div>

    <!-- 参考图 -->
    <div class="form-group">
      <label>参考图（可选，最多3张）</label>
      <div class="ref-images">
        <!-- 原图作为参考图：显式可选，默认开启 -->
        <div v-if="selectedTileImage && useOriginalAsRef" class="ref-thumb original" title="当前格原图（作为参考图）">
          <img :src="selectedTileImage" />
          <span class="orig-tag">原图</span>
          <button class="remove-ref" title="不把原图作为参考图" @click="useOriginalAsRef = false">✕</button>
        </div>
        <label v-else-if="selectedTileImage" class="upload-btn orig-toggle" title="把当前格原图加入参考图">
          ＋原图
          <input type="checkbox" hidden :checked="false" @change="useOriginalAsRef = true" />
        </label>
        <div v-for="(img, idx) in refImages" :key="idx" class="ref-thumb">
          <img :src="img" />
          <button class="remove-ref" @click="removeRef(idx)">✕</button>
        </div>
        <label class="upload-btn" v-if="refImages.length < (useOriginalAsRef ? 2 : 3)">
          + 添加
          <input type="file" accept="image/*" multiple @change="onUpload" hidden />
        </label>
      </div>
      <p class="sub-hint">原图默认作为第一张参考图参与生成（保持构图），可点 ✕ 去掉。</p>
    </div>

    <!-- 生成尺寸（复刻 app：1K/2K/4K） -->
    <div class="form-group">
      <label>生成尺寸</label>
      <select v-model="genSize">
        <option value="1K">1K（1024×1024）</option>
        <option value="2K">2K（2048×2048）</option>
        <option value="4K">4K（4096×4096）</option>
      </select>
    </div>

    <!-- ① 生成：只生成候选，不直接替换 -->
    <div class="actions">
      <button class="btn btn-primary" @click="generate" :disabled="generating || !prompt.trim() || !boundModel">
        {{ generating ? '生成中...' : '✨ 生成候选' }}
      </button>
    </div>

    <!-- 候选列表：可生成多个，选一个替换 -->
    <div class="form-group" v-if="candidates.length">
      <label>生成候选（{{ candidates.length }} 张，点选一张后替换）</label>
      <div class="cand-list">
        <div
          v-for="(c, idx) in candidates"
          :key="c.id"
          class="cand-thumb"
          :class="{ selected: selectedCandidateId === c.id }"
          @click="selectedCandidateId = c.id"
        >
          <img :src="c.image" />
          <span class="cand-idx">{{ idx + 1 }}</span>
          <button class="cand-del" title="删除该候选" @click.stop="removeCandidate(c.id)">✕</button>
        </div>
      </div>
    </div>

    <!-- ② 替换：用选中候选写回图集（可多格） -->
    <div class="actions">
      <button
        class="btn btn-apply"
        :disabled="!selectedCandidate || applying || !selectedTileId && !selectedTileIds.length"
        @click="apply"
      >{{ applying ? '替换中...' : `⬇ 替换选中格${selectedTileIds.length > 1 ? `（${selectedTileIds.length} 格）` : ''}` }}</button>
      <button
        class="btn"
        :disabled="resetting || !selectedTileIds.length"
        @click="reset"
      >{{ resetting ? '重置中...' : '↺ 重置原图' }}</button>
    </div>

    <div class="hint" v-if="errorMsg">{{ errorMsg }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api.js'

const props = defineProps({
  selectedTileId: { type: Number, default: null },
  selectedTileIds: { type: Array, default: () => [] },  // 框选多格
  selectedTileImage: { type: String, default: '' },  // dataURL
})
const emit = defineEmits(['replace-tile', 'reset-tile'])

const prompt = ref('参考图1【原图】生成新的贴图，改成暗黑 疾风狼(图片格式要求用于RPG游戏实体也就是精灵方块游戏贴图)')
const refImages = ref([])
const useOriginalAsRef = ref(true)   // 原图默认作为参考图（显式可选）
const genSize = ref('1K')
const generating = ref(false)
const applying = ref(false)
const resetting = ref(false)
const errorMsg = ref('')

// 候选：可连续生成多张，点选一张替换
const candidates = ref([])           // [{ id, image }]
const selectedCandidateId = ref(null)
const selectedCandidate = computed(() =>
  candidates.value.find(c => c.id === selectedCandidateId.value) || null)

const boundModel = ref(null)   // { id, manufacturer, model }

// ═══════════ 系列替换（以对象/系列为单位换皮相）═══════════
const seriesMode = ref(true)             // ★ 默认勾选
const chatInput = ref('')
const suggesting = ref(false)
const suggestReply = ref('')
const seriesMatches = ref([])            // AI 推荐的系列 [{name,kind,count,ids,checked}]
const allSeries = ref([])                // 全部系列（手动下拉）
const manualSeries = ref(null)
const activeSeries = ref(null)           // 当前目标系列 {name,kind,count,ids}
const seriesPreviewOrig = ref('')        // 原格联络图
const recoloring = ref(false)
const seriesCandidates = ref([])         // [{id,palette,label,tiles,sheet,count}]
const selectedSeriesCandidateId = ref(null)
const applyingSeries = ref(false)
const revertingSeries = ref(false)
const selectedSeriesCandidate = computed(() =>
  seriesCandidates.value.find(c => c.id === selectedSeriesCandidateId.value) || null)

function materialName() {
  // 由父组件（App.vue）通过 provide/inject 或 props 传入；这里从 URL/location 拿不到，
  // 改用 window.__tileStyleMaterial（App.vue 在 openTileStyle 时写入）
  return window.__tileStyleMaterial || ''
}

async function loadAllSeries() {
  const m = materialName()
  if (!m) return
  try {
    const r = await api.listSeries(m)
    allSeries.value = r.groups || []
  } catch (e) { /* 静默 */ }
}

async function askSuggest() {
  const m = materialName()
  if (!m || !chatInput.value.trim()) return
  suggesting.value = true
  suggestReply.value = ''
  try {
    const r = await api.suggestSeries(m, chatInput.value.trim())
    suggestReply.value = r.reply || ''
    seriesMatches.value = (r.groups || []).map(g => ({ ...g, checked: true }))
    if (seriesMatches.value.length) {
      // 默认选第一个命中的
      activeSeries.value = seriesMatches.value[0]
    }
  } catch (e) {
    suggestReply.value = '挑选失败：' + e.message
  } finally {
    suggesting.value = false
  }
}

function onSeriesChecked() {
  const checked = seriesMatches.value.filter(g => g.checked)
  if (checked.length) activeSeries.value = checked[0]
}

function onManualSeries() {
  if (!manualSeries.value) return
  const g = allSeries.value.find(s => s.name === manualSeries.value)
  if (g) activeSeries.value = g
}

async function loadSeriesPreview() {
  const m = materialName()
  if (!m || !activeSeries.value) return
  try {
    const r = await api.seriesPreview(m, activeSeries.value.name)
    seriesPreviewOrig.value = r.sheet
  } catch (e) { /* 静默 */ }
}

async function genCandidates() {
  const m = materialName()
  if (!m || !activeSeries.value) return
  recoloring.value = true
  try {
    // 从聊天输入推断风格 → palettes；没输入就全 6 套
    const r = await api.recolorSeries(m, activeSeries.value.name, [])
    seriesCandidates.value = r.candidates
    selectedSeriesCandidateId.value = null
  } finally {
    recoloring.value = false
  }
}

async function applySeriesSkin() {
  const m = materialName()
  if (!m || !activeSeries.value || !selectedSeriesCandidate.value) return
  applyingSeries.value = true
  try {
    const r = await api.applySeries(m, activeSeries.value.name, selectedSeriesCandidate.value.tiles)
    window.dispatchEvent(new CustomEvent('tileset-updated'))
    alert(`已替换 ${activeSeries.value.name} 的 ${r.applied.length} 格`)
  } catch (e) {
    alert('替换失败：' + e.message)
  } finally {
    applyingSeries.value = false
  }
}

async function revertSeriesSkin() {
  const m = materialName()
  if (!m || !activeSeries.value) return
  if (!confirm(`确定还原「${activeSeries.value.name}」全部格子吗？`)) return
  revertingSeries.value = true
  try {
    const r = await api.revertSeries(m, activeSeries.value.name)
    window.dispatchEvent(new CustomEvent('tileset-updated'))
    alert(`已还原 ${r.reverted.length} 格`)
  } catch (e) {
    alert('还原失败：' + e.message)
  } finally {
    revertingSeries.value = false
  }
}
// ═══════════ 系列替换 END ═══════════

// 加载绑定的贴图替换模型（配置存后端，复刻 app 槽位绑定）
async function loadBindings() {
  try {
    const [bindings, list] = await Promise.all([api.getBindings(), api.listModels('image')])
    const cid = bindings.bindings?.textureReplaceModel
    if (cid != null) {
      boundModel.value = list.find(m => m.id === cid) || null
    } else {
      boundModel.value = null
    }
  } catch (e) {
    boundModel.value = null
  }
}

onMounted(() => {
  loadBindings()
  loadAllSeries()
})

const currentTileUrl = computed(() => props.selectedTileImage)

// 切换选中格时：清空候选（上一格的产物不该写到新格）
function onSelectionChanged() {
  candidates.value = []
  selectedCandidateId.value = null
  errorMsg.value = ''
  useOriginalAsRef.value = true
}
defineExpose({ onSelectionChanged })

function onUpload(e) {
  const files = Array.from(e.target.files)
  const cap = useOriginalAsRef.value ? 2 : 3
  files.forEach(file => {
    if (refImages.value.length >= cap) return
    const reader = new FileReader()
    reader.onload = (ev) => refImages.value.push(ev.target.result)
    reader.readAsDataURL(file)
  })
  e.target.value = ''
}

function removeRef(idx) {
  refImages.value.splice(idx, 1)
}

function removeCandidate(id) {
  candidates.value = candidates.value.filter(c => c.id !== id)
  if (selectedCandidateId.value === id) selectedCandidateId.value = null
}

// ① 生成：产出候选，不动图集
async function generate() {
  if (!prompt.value.trim()) return
  if (!boundModel.value) {
    errorMsg.value = '请先点 ⚙️ 设置并绑定一个 image 模型'
    return
  }
  generating.value = true
  errorMsg.value = ''
  try {
    const refs = []
    // 原图作为参考图：显式开关，默认开（与上传参考图一起送）
    if (useOriginalAsRef.value && props.selectedTileImage) refs.push(props.selectedTileImage)
    refs.push(...refImages.value)
    const resp = await api.generateTile({
      prompt: prompt.value,
      ref_images: refs,
      // current_tile 不再隐式必传 —— 原图已经作为显式参考图进入 refs
      current_tile: null,
      size: genSize.value,
    })
    const id = `c${Date.now()}${Math.floor(Math.random() * 1000)}`
    candidates.value.push({ id, image: resp.image_base64 })
    selectedCandidateId.value = id   // 新生成的自动选中，方便直接替换
  } catch (e) {
    errorMsg.value = '生成失败：' + e.message
  } finally {
    generating.value = false
  }
}

// ② 替换：把选中候选写回图集（交给 App.vue 的 onReplaceTile 落盘）
async function apply() {
  if (!selectedCandidate.value) {
    errorMsg.value = '请先在候选里点选一张'
    return
  }
  const ids = props.selectedTileIds && props.selectedTileIds.length ? props.selectedTileIds : (props.selectedTileId != null ? [props.selectedTileId] : [])
  if (!ids.length) {
    errorMsg.value = '请先在图集里选中格子'
    return
  }
  applying.value = true
  errorMsg.value = ''
  try {
    emit('replace-tile', {
      tileId: ids[0],
      imageBase64: selectedCandidate.value.image,
      tileIds: ids,
    })
  } finally {
    applying.value = false
  }
}

// 重置：交给 App.vue 的 onResetTile（后端从 originals 存档恢复）
async function reset() {
  const ids = props.selectedTileIds && props.selectedTileIds.length ? props.selectedTileIds : (props.selectedTileId != null ? [props.selectedTileId] : [])
  if (!ids.length) return
  resetting.value = true
  try {
    await emit('reset-tile', { tileId: ids[0], tileIds: ids })
  } finally {
    resetting.value = false
  }
}
</script>

<style scoped>
/* ── 系列替换 ── */
.series-section {
  border: 1px solid #3a4150;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 10px;
  background: rgba(30, 34, 44, 0.5);
}
.series-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.series-hint {
  font-size: 11px;
  opacity: 0.6;
  margin-left: 4px;
}
.chat-row {
  display: flex;
  gap: 6px;
}
.chat-row input {
  flex: 1;
}
.suggest-reply {
  margin-top: 6px;
  font-size: 12px;
  color: #9fc6e8;
  background: rgba(60, 90, 120, 0.2);
  border-radius: 6px;
  padding: 6px 8px;
}
.series-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
}
.series-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 5px;
}
.series-item:hover {
  background: rgba(80, 100, 130, 0.15);
}
.series-name {
  flex: 1;
}
.series-meta {
  opacity: 0.55;
  font-size: 11px;
}
.series-sheet {
  width: 100%;
  image-rendering: pixelated;
  border-radius: 6px;
  border: 1px solid #3a4150;
  margin-top: 6px;
}
.sheet-thumb img {
  max-height: 96px;
  object-fit: contain;
  image-rendering: pixelated;
}
.link-btn {
  background: none;
  border: none;
  color: #6ab0e8;
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
}
.divider {
  height: 1px;
  background: #3a4150;
  margin: 10px 0;
}

.tile-style-panel { padding: 12px; font-size: 13px; }
h4 { margin: 0 0 12px 0; }
.bind-status { font-size: 12px; padding: 6px 8px; border-radius: 4px; margin-bottom: 12px; }
.bind-status.on { background: #e8f5e9; color: #2e7d32; }
.bind-status.off { background: #fff3e0; color: #e65100; }
.tile-preview-section { margin-bottom: 12px; }
.preview-label { font-size: 12px; color: #666; margin-bottom: 4px; }
.tile-preview {
  width: 64px; height: 64px; border: 1px solid #ddd; border-radius: 4px;
  background:
    linear-gradient(45deg, #eee 25%, transparent 25%),
    linear-gradient(-45deg, #eee 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eee 75%),
    linear-gradient(-45deg, transparent 75%, #eee 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.tile-img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
.tile-empty { font-size: 11px; color: #999; }
.tile-id { font-size: 11px; color: #999; margin-top: 4px; }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; }
.form-group textarea, .form-group select {
  width: 100%; padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px;
  font-size: 13px; box-sizing: border-box;
}
.sub-hint { font-size: 11px; color: #999; margin: 4px 0 0; }
.ref-images { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.ref-thumb { position: relative; width: 40px; height: 40px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
.ref-thumb.original { border-color: #2e7d32; }
.ref-thumb img { width: 100%; height: 100%; object-fit: cover; }
.orig-tag {
  position: absolute; left: 0; bottom: 0; font-size: 9px; line-height: 1.2;
  background: rgba(46,125,50,.85); color: #fff; padding: 0 3px;
}
.remove-ref {
  position: absolute; top: 0; right: 0; width: 14px; height: 14px; font-size: 10px;
  line-height: 1; padding: 0; border: none; background: rgba(0,0,0,0.6); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.upload-btn {
  width: 40px; height: 40px; border: 1px dashed #ccc; border-radius: 4px; display: flex;
  align-items: center; justify-content: center; font-size: 12px; color: #999; cursor: pointer;
}
.upload-btn.orig-toggle { font-size: 10px; color: #2e7d32; border-color: #2e7d32; }
/* 候选列表 */
.cand-list { display: flex; gap: 8px; flex-wrap: wrap; }
.cand-thumb {
  position: relative; width: 64px; height: 64px; border: 2px solid #ddd; border-radius: 4px;
  overflow: hidden; cursor: pointer; background:
    linear-gradient(45deg, #eee 25%, transparent 25%),
    linear-gradient(-45deg, #eee 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eee 75%),
    linear-gradient(-45deg, transparent 75%, #eee 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
}
.cand-thumb.selected { border-color: #1976d2; box-shadow: 0 0 0 2px rgba(25,118,210,.25); }
.cand-thumb img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.cand-idx {
  position: absolute; left: 0; top: 0; font-size: 9px; line-height: 1.3;
  background: rgba(0,0,0,.55); color: #fff; padding: 0 4px;
}
.cand-del {
  position: absolute; right: 0; top: 0; width: 14px; height: 14px; font-size: 10px; line-height: 1;
  padding: 0; border: none; background: rgba(0,0,0,.55); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.actions { display: flex; gap: 8px; margin-top: 12px; }
.btn { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 13px; }
.btn-primary { background: #1976d2; color: #fff; border-color: #1976d2; }
.btn-apply { background: #2e7d32; color: #fff; border-color: #2e7d32; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hint { margin-top: 12px; padding: 8px; background: #fdecea; border-radius: 4px; font-size: 12px; color: #c62828; }
</style>