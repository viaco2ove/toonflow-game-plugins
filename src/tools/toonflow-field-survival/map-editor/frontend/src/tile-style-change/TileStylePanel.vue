<template>
  <div class="tile-style-panel">
    <h4>🎨 贴图替换</h4>

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
      <div class="tile-id" v-if="selectedTileId !== null">#{{ selectedTileId }}</div>
    </div>

    <!-- 生成结果预览 -->
    <div class="tile-preview-section" v-if="generatedImage">
      <div class="preview-label">生成结果（自动抠背景）</div>
      <div class="tile-preview result">
        <img :src="generatedImage" class="tile-img" />
      </div>
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
        <div v-for="(img, idx) in refImages" :key="idx" class="ref-thumb">
          <img :src="img" />
          <button class="remove-ref" @click="removeRef(idx)">✕</button>
        </div>
        <label class="upload-btn" v-if="refImages.length < 3">
          + 添加
          <input type="file" accept="image/*" multiple @change="onUpload" hidden />
        </label>
      </div>
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

    <!-- 操作按钮 -->
    <div class="actions">
      <button class="btn btn-primary" @click="generate" :disabled="generating || !prompt.trim() || !boundModel">
        {{ generating ? '生成中...' : '✨ 生成并替换' }}
      </button>
      <button class="btn" @click="reset" :disabled="!hasOriginal">重置原图</button>
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
const genSize = ref('1K')
const generating = ref(false)
const generatedImage = ref('')
const hasOriginal = ref(false)
const errorMsg = ref('')

const boundModel = ref(null)   // { id, manufacturer, model }

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

onMounted(loadBindings)

const currentTileUrl = computed(() => props.selectedTileImage)

function onUpload(e) {
  const files = Array.from(e.target.files)
  files.forEach(file => {
    if (refImages.value.length >= 3) return
    const reader = new FileReader()
    reader.onload = (ev) => refImages.value.push(ev.target.result)
    reader.readAsDataURL(file)
  })
  e.target.value = ''
}

function removeRef(idx) {
  refImages.value.splice(idx, 1)
}

async function generate() {
  if (!prompt.value.trim()) return
  if (!boundModel.value) {
    errorMsg.value = '请先点 ⚙️ 设置并绑定一个 image 模型'
    return
  }
  generating.value = true
  generatedImage.value = ''
  errorMsg.value = ''
  try {
    // 不传 config：后端按绑定的 textureReplaceModel 槽位解析（复刻 app getPromptAi）
    const resp = await api.generateTile({
      prompt: prompt.value,
      ref_images: refImages.value,
      current_tile: props.selectedTileImage || null,
      size: genSize.value,
    })
    generatedImage.value = resp.image_base64
    hasOriginal.value = true
    emit('replace-tile', {
      tileId: props.selectedTileId,
      imageBase64: resp.image_base64,
      tileIds: props.selectedTileIds && props.selectedTileIds.length ? props.selectedTileIds : [props.selectedTileId],
    })
  } catch (e) {
    errorMsg.value = '生成失败：' + e.message
  } finally {
    generating.value = false
  }
}

function reset() {
  generatedImage.value = ''
  emit('reset-tile', {
    tileId: props.selectedTileId,
    tileIds: props.selectedTileIds && props.selectedTileIds.length ? props.selectedTileIds : [props.selectedTileId],
  })
}
</script>

<style scoped>
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
.tile-preview.result { border-color: #1976d2; }
.tile-img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
.tile-empty { font-size: 11px; color: #999; }
.tile-id { font-size: 11px; color: #999; margin-top: 4px; }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; }
.form-group textarea, .form-group select {
  width: 100%; padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px;
  font-size: 13px; box-sizing: border-box;
}
.ref-images { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.ref-thumb { position: relative; width: 40px; height: 40px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
.ref-thumb img { width: 100%; height: 100%; object-fit: cover; }
.remove-ref {
  position: absolute; top: 0; right: 0; width: 14px; height: 14px; font-size: 10px;
  line-height: 1; padding: 0; border: none; background: rgba(0,0,0,0.6); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.upload-btn {
  width: 40px; height: 40px; border: 1px dashed #ccc; border-radius: 4px; display: flex;
  align-items: center; justify-content: center; font-size: 12px; color: #999; cursor: pointer;
}
.actions { display: flex; gap: 8px; margin-top: 12px; }
.btn { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 13px; }
.btn-primary { background: #1976d2; color: #fff; border-color: #1976d2; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hint { margin-top: 12px; padding: 8px; background: #fdecea; border-radius: 4px; font-size: 12px; color: #c62828; }
</style>
