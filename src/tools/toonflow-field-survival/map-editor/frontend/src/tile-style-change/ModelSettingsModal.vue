<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-box">
      <div class="modal-head">
        <h3>AI 模型设置</h3>
        <button class="x" @click="$emit('close')">✕</button>
      </div>

      <div class="tabs">
        <button :class="{active: tab==='models'}" @click="tab='models'">模型管理</button>
        <button :class="{active: tab==='bind'}" @click="tab='bind'">功能绑定</button>
        <button :class="{active: tab==='matting'}" @click="switchTab('matting')">背景分离</button>
      </div>

      <!-- 模型管理 -->
      <div v-if="tab==='models'" class="tab-body">
        <div class="toolbar">
          <button class="btn primary" @click="startAdd">{{ editingId ? '取消编辑' : '＋ 新增模型' }}</button>
        </div>

        <!-- 表单 -->
        <div v-if="showForm" class="form-card">
          <div class="row">
            <label>类型</label>
            <select v-model="form.type">
              <option value="text">文本大模型 (text)</option>
              <option value="image">生图模型 (image)</option>
              <option value="voice">语音 (voice)</option>
              <option value="video">视频 (video)</option>
            </select>
          </div>
          <div class="row">
            <label>厂商</label>
            <select v-model="form.manufacturer">
              <option v-for="m in manufacturerOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </div>
          <div class="row" v-if="formWebsite">
            <label></label>
            <a :href="formWebsite" target="_blank" rel="noreferrer" class="hint link">官网 / 获取 Key ↗</a>
          </div>
          <div class="row" v-if="isLocalMattingManufacturer(form.manufacturer)">
            <label>模型名</label>
            <select v-model="form.model">
              <option v-for="m in modelOptionsForManufacturer(form.manufacturer)" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </div>
          <div class="row" v-else-if="form.type==='image'">
            <label>模型名</label>
            <input v-model="form.model" :placeholder="formModelPlaceholder" />
          </div>
          <div class="row" v-else>
            <label>模型名</label>
            <input v-model="form.model" :placeholder="form.type==='image' ? '如 gpt-image-1 / doubao-seedream-4-0-250828' : '如 gpt-4o / deepseek-chat'" />
          </div>
          <div class="row" v-if="isLocalMattingManufacturer(form.manufacturer)">
            <label>BaseURL</label>
            <input v-model="form.baseUrl" disabled placeholder="本地模型无需 BaseURL" />
          </div>
          <div class="row" v-else>
            <label>BaseURL</label>
            <input v-model="form.baseUrl" :placeholder="'默认 ' + (defaultBaseUrlFor(form.manufacturer, form.type) || '留空')" />
            <p v-if="formBaseUrlHint" class="hint sub inline">{{ formBaseUrlHint }}</p>
          </div>
          <div class="row" v-if="!isLocalMattingManufacturer(form.manufacturer)">
            <label>API Key</label>
            <input v-model="form.apiKey" type="password" :placeholder="formApiKeyHint || '明文保存（同 app）'" />
            <p v-if="formApiKeyHint" class="hint sub inline">{{ formApiKeyHint }}</p>
          </div>

          <!-- 本地背景分离模型的安装状态（对齐 app） -->
          <template v-if="usesLocalMatting">
            <div class="local-model-card">
              <div class="local-model-copy">
                <div class="local-model-title">{{ mattingTitle }}</div>
                <div class="local-model-text">{{ formMattingStatus?.message || '首次使用需要安装 Python 依赖和模型文件。' }}</div>
              </div>
              <button
                v-if="formMattingStatus?.status !== 'installed'"
                class="btn outline"
                :disabled="formMattingInstalling || formMattingStatus?.canInstall === false"
                @click="installFormMatting"
              >{{ formMattingInstalling ? '安装中…' : (formMattingStatus?.status === 'failed' ? '重新安装' : '立即安装') }}</button>
            </div>
          </template>

          <!-- 仅 text 类型显示推理参数 -->
          <template v-if="form.type==='text'">
            <div class="row">
              <label>推理强度</label>
              <select v-model="form.reasoningEffort">
                <option :value="null">—</option>
                <option value="none">none</option>
                <option value="minimal">minimal</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div class="row two">
              <div><label>温度</label><input v-model.number="form.temperature" type="number" step="0.1" min="0" max="2" /></div>
              <div><label>topP</label><input v-model.number="form.topP" type="number" step="0.1" min="0" max="1" /></div>
            </div>
          </template>

          <div class="form-actions">
            <button class="btn" @click="testConnection" :disabled="testing">{{ testing ? '测试中…' : '测试连通' }}</button>
            <button class="btn primary" @click="save" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
          </div>
          <div v-if="testMsg" :class="['test-msg', testOk ? 'ok' : 'err']">{{ testMsg }}</div>
        </div>

        <!-- 列表 -->
        <ul class="model-list" v-if="models.length">
          <li v-for="m in models" :key="m.id">
            <span class="badge" :class="m.type">{{ m.type }}</span>
            <span class="m-name">{{ m.model || '(未命名)' }}</span>
            <span class="m-mfr">{{ m.manufacturer }}</span>
            <span class="m-actions">
              <button class="link" @click="startEdit(m)">编辑</button>
              <button class="link danger" @click="remove(m)">删除</button>
            </span>
          </li>
        </ul>
        <div v-else class="empty">暂无模型，点击「新增模型」添加（配置存于后端 SQLite，复刻 app t_config）。</div>
      </div>

      <!-- 功能绑定 -->
      <div v-else-if="tab==='bind'" class="tab-body">
        <p class="hint">将各功能绑定到某个 <b>image</b> 类型模型（复刻 app 的 t_aiModelMap 槽位）。执行时若未显式传配置，则使用此绑定。</p>

        <div class="row">
          <label>贴图替换模型</label>
          <select v-model.number="bindId">
            <option :value="null">— 未绑定 —</option>
            <option v-for="m in imageModels" :key="m.id" :value="m.id">{{ m.manufacturer }} / {{ m.model || '(未命名)' }}</option>
          </select>
        </div>

        <div class="row">
          <label>背景分离模型</label>
          <select v-model.number="mattingBindId">
            <option :value="null">— 未绑定 —</option>
            <option v-for="m in imageModels" :key="m.id" :value="m.id">{{ m.manufacturer }} / {{ m.model || '(未命名)' }}</option>
          </select>
        </div>
        <p class="hint sub">可绑定本地模型（local_birefnet / local_modnet / local_u2net，离线不耗额度）或云端厂商（Bria / 阿里云视觉 / 腾讯云数据万象，按量计费）；绑定后在「背景分离」页完成安装或填 Key。</p>

        <button class="btn primary" @click="saveBind" :disabled="savingBind">{{ savingBind ? '保存中…' : '保存绑定' }}</button>
        <div v-if="bindMsg" :class="['test-msg', bindOk ? 'ok' : 'err']">{{ bindMsg }}</div>
      </div>

      <!-- 背景分离（本地 + 云端抠图模型，对齐 app 全集） -->
      <div v-else class="tab-body">
        <p class="hint">
          背景分离模型用于把角色/物件图片的背景抠成透明。
          <b>本地</b>推理不联网、不消耗额度；<b>云端</b>（Bria / 阿里云视觉 / 腾讯云数据万象）需要 API Key，按量计费。
        </p>

        <div class="row">
          <label>厂商</label>
          <select v-model="mattingManufacturer">
            <optgroup v-for="g in mattingManufacturerGroups" :key="g.label" :label="g.label">
              <option v-for="m in g.items" :key="m.value" :value="m.value">{{ m.label }}</option>
            </optgroup>
          </select>
        </div>
        <div class="row">
          <label>模型</label>
          <select v-model="mattingModel">
            <option v-for="m in mattingModelOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </div>

        <!-- 云端厂商：凭据填写（本地模型不需要） -->
        <template v-if="isCloudMatting">
          <div class="row">
            <label>API Key</label>
            <input
              v-model="mattingApiKey"
              type="password"
              :placeholder="cloudKeyPlaceholder"
              style="flex:1"
            />
          </div>
          <div class="row" v-if="mattingManufacturer === 'tencent_ci'">
            <label>Base URL</label>
            <input
              v-model="mattingBaseUrl"
              placeholder="https://bucket-appid.cos.ap-shanghai.myqcloud.com"
              style="flex:1"
            />
          </div>
          <p class="hint sub">{{ cloudKeyPlaceholder }}</p>
          <p class="hint sub" v-if="mattingManufacturer === 'tencent_ci'">
            腾讯云的 Base URL 必须是标准 COS 桶域名；抠图时源图会临时上传到该桶，完成后自动删除。
          </p>
          <p class="hint sub" v-if="mattingManufacturer === 'bria'">
            Bria 默认走 <code>https://engine.prod.bria-api.com/v2/image/edit/remove_background</code>，无需改 Base URL。
          </p>
          <p class="hint sub" v-if="mattingManufacturer === 'aliyun_imageseg'">
            阿里云的 region 从服务地址自动提取（如 imageseg.cn-shanghai.aliyuncs.com → cn-shanghai）；模型决定 Action（通用/高清/人体）。
          </p>
        </template>

        <p class="hint sub" v-else>
          选型建议：<b>U2Net</b> 面向非生物的通用显著对象（道具 / 建筑 / 纹理 / 布料），u2net 已随 app 预置、开箱即用；
          <b>BiRefNet</b> 边缘最干净、偏通用与人物；<b>MODNet</b> 专精人像。
        </p>

        <!-- 本地安装卡片（云端厂商不显示） -->
        <div class="local-model-card" v-if="!isCloudMatting">
          <div class="local-model-copy">
            <div class="local-model-title">{{ mattingTitle }}</div>
            <div class="local-model-text">{{ mattingStatus?.message || '首次使用需要安装 Python 依赖和模型文件。' }}</div>
          </div>
          <button
            v-if="mattingStatus?.status !== 'installed'"
            class="btn outline"
            :disabled="mattingInstalling || mattingStatus?.canInstall === false"
            @click="installMatting"
          >{{ mattingInstalling ? '安装中…' : (mattingStatus?.status === 'failed' ? '重新安装' : '立即安装') }}</button>
        </div>

        <!-- 运行目录 / TEMP_OSS 信息（仅本地） -->
        <div class="info-box" v-if="!isCloudMatting">
          <div class="info-row"><span>运行目录</span><code>{{ mattingInfo.rootDir || '—' }}</code></div>
          <div class="info-row"><span>TEMP_OSS</span><code>{{ mattingInfo.tempOss?.providers?.join(', ') || '—' }}</code></div>
          <div class="info-row" v-if="mattingInfo.tempOss?.aliyunConfigured"><span>OSS Bucket</span><code>{{ mattingInfo.tempOss.aliyunBucket }} / {{ mattingInfo.tempOss.aliyunRegion }}</code></div>
        </div>

        <!-- 抠图试用 -->
        <div class="row">
          <label>测试图片</label>
          <input type="file" accept="image/*" @change="onPickImage" />
        </div>
        <div v-if="mattingPreview" class="preview-box">
          <div class="preview-col">
            <div class="preview-label">原图</div>
            <img :src="mattingSource" alt="原图" />
          </div>
          <div class="preview-col">
            <div class="preview-label">透明前景</div>
            <div class="checker"><img :src="mattingPreview" alt="抠图结果" /></div>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn primary" :disabled="!canRunMatting" @click="runMatting">
            {{ mattingRunning ? '抠图中…' : (isCloudMatting ? '云端抠图（消耗额度）' : '试跑抠图') }}
          </button>
        </div>
        <div v-if="mattingMsg" :class="['test-msg', mattingOk ? 'ok' : 'err']">{{ mattingMsg }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { api } from '../api.js'
import {
  MODEL_MANUFACTURERS,
  manufacturersFor,
  defaultBaseUrlFor,
  defaultModelNameFor,
  defaultModelTypeFor,
  defaultManufacturerFor,
  apiKeyHintFor,
  baseUrlHintFor,
  DEDICATED_MATTING_MANUFACTURERS,
} from './modelConfigCatalog.js'

const emit = defineEmits(['close', 'saved'])

// 厂商目录来自 modelConfigCatalog.js（移植 app/web 的 MODEL_MANUFACTURERS，含默认 baseUrl）
// 不再硬编码字符串数组——之前那份漏掉了 Bria/阿里云视觉/腾讯云数据万象，
// 还混入了 app 里根本不存在的 key（doubao / qwen / anthropic）。
const manufacturers = computed(() => manufacturersFor(form.type))
const manufacturerOptions = computed(() =>
  MODEL_MANUFACTURERS.filter(m => (m.kinds || []).includes(form.type)))
const formApiKeyHint = computed(() => apiKeyHintFor(form.manufacturer))
const formBaseUrlHint = computed(() => baseUrlHintFor(form.manufacturer))
const formWebsite = computed(() =>
  MODEL_MANUFACTURERS.find(m => m.value === form.manufacturer)?.website || '')

const LOCAL_BIREFNET = 'local_birefnet'
const LOCAL_MODNET = 'local_modnet'
const LOCAL_U2NET = 'local_u2net'

const FALLBACK_MATTING_MFG = [
  // 云端三家（对齐 app 的 DEDICATED_AVATAR_MATTING_MANUFACTURERS）
  { value: 'bria', label: 'Bria', cloud: true, models: [
    { label: 'RMBG-2.0', value: 'RMBG-2.0' },
  ] },
  { value: 'aliyun_imageseg', label: '阿里云视觉', cloud: true, models: [
    { label: 'SegmentCommonImage（通用主体）', value: 'SegmentCommonImage' },
    { label: 'SegmentHDCommonImage（高清通用）', value: 'SegmentHDCommonImage' },
    { label: 'SegmentBody（人体）', value: 'SegmentBody' },
    { label: 'SegmentHDBody（高清人体）', value: 'SegmentHDBody' },
  ] },
  { value: 'tencent_ci', label: '腾讯云数据万象', cloud: true, models: [
    { label: 'AIPortraitMatting', value: 'AIPortraitMatting' },
  ] },
  // 本地三家
  { value: LOCAL_BIREFNET, label: 'BiRefNet 本地', models: [
    { label: 'birefnet-portrait', value: 'birefnet-portrait' },
    { label: 'birefnet-general', value: 'birefnet-general' },
    { label: 'birefnet-general-lite', value: 'birefnet-general-lite' },
  ] },
  { value: LOCAL_MODNET, label: 'MODNet 本地', models: [
    { label: 'modnet-photographic-portrait', value: 'modnet-photographic-portrait' },
  ] },
  { value: LOCAL_U2NET, label: 'U2Net 本地（非生物）', models: [
    { label: 'u2net', value: 'u2net' },
    { label: 'u2netp', value: 'u2netp' },
    { label: 'u2net-general', value: 'u2net-general' },
    { label: 'u2net_cloth_seg', value: 'u2net_cloth_seg' },
    { label: 'u2net_human_seg', value: 'u2net_human_seg' },
  ] },
]

const tab = ref('models')
const models = ref([])
const showForm = ref(false)
const editingId = ref(null)
const testing = ref(false)
const saving = ref(false)
const testMsg = ref('')
const testOk = ref(false)

const bindId = ref(null)
const mattingBindId = ref(null)
const savingBind = ref(false)
const bindMsg = ref('')
const bindOk = ref(false)

// ── 背景分离（本地 + 云端抠图）──
const mattingManufacturers = ref(FALLBACK_MATTING_MFG)
const mattingManufacturer = ref(LOCAL_BIREFNET)
const mattingModel = ref('birefnet-portrait')
const mattingApiKey = ref('')          // 云端厂商的凭据（Bria token / 阿里云 AK|SK / 腾讯云 SID|SK）
const mattingBaseUrl = ref('')         // 腾讯云必填 COS 桶域名；其他厂商留空用默认
const mattingStatus = ref(null)
const mattingInstalling = ref(false)
const mattingInfo = ref({})
const mattingSource = ref('')
const mattingPreview = ref('')
const mattingRunning = ref(false)
const mattingMsg = ref('')
const mattingOk = ref(false)

// 云端厂商判定 + 分组下拉
const isCloudMatting = computed(() =>
  ['bria', 'aliyun_imageseg', 'tencent_ci'].includes(String(mattingManufacturer.value || '')))
const mattingManufacturerGroups = computed(() => [
  { label: '云端（需 API Key）', items: FALLBACK_MATTING_MFG.filter(m => m.cloud) },
  { label: '本地（离线推理）', items: FALLBACK_MATTING_MFG.filter(m => !m.cloud) },
])
const cloudKeyPlaceholder = computed(() => {
  switch (mattingManufacturer.value) {
    case 'bria': return 'Bria 平台生成的 API token'
    case 'aliyun_imageseg': return 'AccessKeyId|AccessKeySecret 或 JSON'
    case 'tencent_ci': return 'SecretId|SecretKey[|SessionToken] 或 JSON'
    default: return ''
  }
})
const canRunMatting = computed(() => {
  if (!mattingSource.value || mattingRunning.value) return false
  if (isCloudMatting.value && !mattingApiKey.value.trim()) return false
  return true
})

// 表单内的本地模型安装状态
const formMattingStatus = ref(null)
const formMattingInstalling = ref(false)

const form = reactive({
  type: 'image',
  manufacturer: 'openai',
  model: '',
  baseUrl: '',
  apiKey: '',
  modelType: '',
  reasoningEffort: null,
  temperature: null,
  topP: null,
  remark: '',
})

const imageModels = computed(() => models.value.filter(m => m.type === 'image'))

function isLocalMattingManufacturer(mfr) {
  const v = String(mfr || '').trim().toLowerCase()
  // 本地推理厂商（需要 venv + 模型文件，走 /api/matting/status|install）
  return v === LOCAL_BIREFNET || v === LOCAL_MODNET || v === LOCAL_U2NET
}

/** 云端抠图厂商（Bria / 阿里云视觉 / 腾讯云数据万象）—— 与本地厂商互斥，不能绑成普通生图 */
function isCloudMattingManufacturer(mfr) {
  const v = String(mfr || '').trim().toLowerCase()
  return v === 'bria' || v === 'aliyun_imageseg' || v === 'tencent_ci'
}

/** 是否是任意「抠图专用」厂商（本地 + 云端）—— 对齐 app 的 DEDICATED_AVATAR_MATTING_MANUFACTURERS */
function isMattingOnlyManufacturer(mfr) {
  return DEDICATED_MATTING_MANUFACTURERS.has(String(mfr || '').trim().toLowerCase())
}

const usesLocalMatting = computed(() => isLocalMattingManufacturer(form.manufacturer))
const isLocalModnet = computed(() =>
  String(form.manufacturer || '').trim().toLowerCase() === LOCAL_MODNET
  || String(form.model || '').trim().toLowerCase().startsWith('modnet'))

const mattingTitle = computed(() => {
  const mfr = String(mattingManufacturer.value).toLowerCase()
  const mdl = String(mattingModel.value).toLowerCase()
  if (mfr === 'bria') return 'Bria 云端抠图（RMBG-2.0）'
  if (mfr === 'aliyun_imageseg') return '阿里云视觉（云端）'
  if (mfr === 'tencent_ci') return '腾讯云数据万象（云端）'
  if (mfr === LOCAL_MODNET || mdl.startsWith('modnet')) return 'MODNet 本地模型'
  if (mfr === LOCAL_U2NET || mdl.startsWith('u2net')) return 'U2Net 本地模型（非生物通用）'
  return 'BiRefNet 本地模型'
})

const mattingModelOptions = computed(() => {
  const found = mattingManufacturers.value.find(m => m.value === mattingManufacturer.value)
  if (found?.models?.length) return found.models
  if (mattingManufacturer.value === LOCAL_MODNET) {
    return [{ label: 'modnet-photographic-portrait', value: 'modnet-photographic-portrait' }]
  }
  if (mattingManufacturer.value === LOCAL_U2NET) {
    return FALLBACK_MATTING_MFG.find(m => m.value === LOCAL_U2NET)?.models || []
  }
  return FALLBACK_MATTING_MFG[0].models
})

// 图像模型的占位提示：把该厂商的默认模型显示出来（对齐 app 的 defaultModelNameFor）
const formModelPlaceholder = computed(() => {
  const d = defaultModelNameFor(form.manufacturer, form.type, form.modelType)
  return d ? `默认 ${d}（可直接用，也可自己改）` : '如 gpt-image-1 / doubao-seedream-4-0-250828'
})

function modelOptionsForManufacturer(mfr) {
  const found = mattingManufacturers.value.find(m => m.value === mfr)
  return found?.models || []
}

function defaultModelFor(mfr) {
  return modelOptionsForManufacturer(mfr)[0]?.value || ''
}

function resetForm() {
  const type = 'image'
  const manufacturer = defaultManufacturerFor(type)
  Object.assign(form, {
    type,
    manufacturer,
    model: defaultModelNameFor(manufacturer, type, defaultModelTypeFor(type)),
    baseUrl: defaultBaseUrlFor(manufacturer, type, defaultModelTypeFor(type)),
    apiKey: '',
    modelType: defaultModelTypeFor(type),
    reasoningEffort: null, temperature: null, topP: null, remark: '',
  })
  formMattingStatus.value = null
}

async function load() {
  models.value = await api.listModels()
  const b = await api.getBindings()
  bindId.value = b.bindings?.textureReplaceModel ?? null
  mattingBindId.value = b.bindings?.storyAvatarMattingModel ?? null
}

async function loadMattingCatalog() {
  try {
    const info = await api.listMattingModels()
    if (Array.isArray(info?.manufacturers) && info.manufacturers.length) {
      mattingManufacturers.value = info.manufacturers
    }
    mattingInfo.value = { rootDir: info?.rootDir || '', tempOss: info?.tempOss || null }
  } catch {
    // 后端未就绪时用前端兜底选项
  }
}

async function refreshMattingStatus() {
  // 云端厂商没有「安装」概念，直接给就绪状态
  if (isCloudMatting.value) {
    mattingStatus.value = { status: 'installed', installed: true, canInstall: false, message: '云端厂商就绪，填入 API Key 即可使用' }
    return
  }
  try {
    mattingStatus.value = await api.getMattingStatus({
      manufacturer: mattingManufacturer.value,
      model: mattingModel.value,
    })
  } catch (e) {
    mattingStatus.value = { status: 'not_installed', message: '读取状态失败：' + e.message }
  }
}

function switchTab(next) {
  tab.value = next
  if (next === 'matting') {
    loadMattingCatalog().then(refreshMattingStatus)
  }
}

async function installMatting() {
  mattingInstalling.value = true
  mattingMsg.value = ''
  try {
    const r = await api.installMatting({
      manufacturer: mattingManufacturer.value,
      model: mattingModel.value,
    })
    mattingStatus.value = r
    mattingOk.value = true
    mattingMsg.value = r.message || '安装完成'
  } catch (e) {
    mattingOk.value = false
    mattingMsg.value = '安装失败：' + e.message
    await refreshMattingStatus()
  } finally {
    mattingInstalling.value = false
  }
}

async function refreshFormMattingStatus() {
  if (!isLocalMattingManufacturer(form.manufacturer)) {
    formMattingStatus.value = null
    return
  }
  try {
    formMattingStatus.value = await api.getMattingStatus({
      manufacturer: form.manufacturer,
      model: form.model,
    })
  } catch {
    formMattingStatus.value = null
  }
}

async function installFormMatting() {
  formMattingInstalling.value = true
  try {
    formMattingStatus.value = await api.installMatting({
      manufacturer: form.manufacturer,
      model: form.model,
    })
  } catch (e) {
    testMsg.value = '本地模型安装失败：' + e.message
    testOk.value = false
  } finally {
    formMattingInstalling.value = false
  }
}

function onPickImage(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    mattingSource.value = String(reader.result || '')
    mattingPreview.value = ''
    mattingMsg.value = ''
  }
  reader.readAsDataURL(file)
}

async function runMatting() {
  if (!mattingSource.value) return
  if (isCloudMatting.value && !mattingApiKey.value.trim()) {
    mattingOk.value = false
    mattingMsg.value = '云端厂商需要先填 API Key'
    return
  }
  mattingRunning.value = true
  mattingMsg.value = ''
  try {
    const r = await api.runMatting({
      image_base64: mattingSource.value,
      manufacturer: mattingManufacturer.value,
      model: mattingModel.value,
      api_key: mattingApiKey.value.trim() || undefined,
      base_url: mattingBaseUrl.value.trim() || undefined,
    })
    mattingPreview.value = r.image_base64
    mattingOk.value = true
    mattingMsg.value = r.tempUrl
      ? `抠图成功 ✓（已上传 TEMP_OSS）`
      : '抠图成功 ✓'
  } catch (e) {
    mattingOk.value = false
    mattingMsg.value = '抠图失败：' + e.message
  } finally {
    mattingRunning.value = false
  }
}

onMounted(load)

// 背景分离页：切厂商时自动带出该厂商的默认模型并刷新状态（云端厂商跳过本地状态检查）
watch(mattingManufacturer, () => {
  mattingModel.value = mattingModelOptions.value[0]?.value || ''
  refreshMattingStatus()
})
watch(mattingModel, refreshMattingStatus)

// 模型表单：切厂商/切类型时自动补默认 BaseURL + 默认模型（对齐 app SettingsModelManagerDialog L424-435）
// 编辑已有配置时不覆盖用户已填的 baseUrl。
watch(() => [form.manufacturer, form.type, form.modelType], ([mfr, type, modelType], prev) => {
  const changed = !prev || mfr !== prev[0] || type !== prev[1] || modelType !== prev[2]
  if (!changed) return

  // 本地厂商：baseUrl 留空、模型从下拉选
  if (isLocalMattingManufacturer(mfr)) {
    form.baseUrl = ''
    form.model = defaultModelFor(mfr)
    refreshFormMattingStatus()
    return
  }
  formMattingStatus.value = null

  // baseUrl：编辑已有配置且已填 → 保留；否则填默认
  if (!editingId.value || !(form.baseUrl || '').trim()) {
    form.baseUrl = defaultBaseUrlFor(mfr, type, modelType)
  }
  // 模型名：新增时直接填默认值；编辑时仅在空的情况下补
  const defModel = defaultModelNameFor(mfr, type, modelType)
  if (defModel && !editingId.value) {
    form.model = defModel
  } else if (defModel && !(form.model || '').trim()) {
    form.model = defModel
  }
})

// type 变化时补默认 modelType（对齐 app 的 defaultModelTypeFor）
watch(() => form.type, (type) => {
  if (!form.modelType) form.modelType = defaultModelTypeFor(type)
})

function startAdd() {
  editingId.value = null
  resetForm()
  showForm.value = !showForm.value
}

function startEdit(m) {
  editingId.value = m.id
  Object.assign(form, {
    type: m.type, manufacturer: m.manufacturer, model: m.model || '',
    baseUrl: m.baseUrl || '', apiKey: m.apiKey || '', modelType: m.modelType || '',
    reasoningEffort: m.reasoningEffort ?? null, temperature: m.temperature ?? null,
    topP: m.topP ?? null, remark: m.remark || '',
  })
  showForm.value = true
  if (isLocalMattingManufacturer(form.manufacturer)) {
    if (!form.model) form.model = defaultModelFor(form.manufacturer)
    refreshFormMattingStatus()
  }
}

function payload() {
  const p = { ...form }
  if (p.type !== 'text') { p.reasoningEffort = null; p.temperature = null; p.topP = null }
  if (isLocalMattingManufacturer(p.manufacturer)) {
    // 本地模型不需要接入地址与密钥
    p.baseUrl = ''
    p.apiKey = ''
    if (!p.model) p.model = defaultModelFor(p.manufacturer)
  }
  return p
}

async function save() {
  saving.value = true
  testMsg.value = ''
  try {
    if (editingId.value) await api.updateModel(editingId.value, payload())
    else await api.addModel(payload())
    showForm.value = false
    editingId.value = null
    await load()
    emit('saved')
  } catch (e) {
    testMsg.value = '保存失败：' + e.message
    testOk.value = false
  } finally {
    saving.value = false
  }
}

async function remove(m) {
  if (!confirm(`确认删除模型「${m.model || m.id}」？`)) return
  await api.deleteModel(m.id)
  await load()
}

async function testConnection() {
  testing.value = true
  testMsg.value = ''
  try {
    const r = await api.testModel(payload())
    testOk.value = true
    testMsg.value = r.type === 'text' ? '文本连通成功 ✓' : '生图连通成功 ✓'
  } catch (e) {
    testOk.value = false
    testMsg.value = '连通失败：' + e.message
  } finally {
    testing.value = false
  }
}

async function saveBind() {
  savingBind.value = true
  bindMsg.value = ''
  try {
    await api.bindSlot('textureReplaceModel', bindId.value)
    await api.bindSlot('storyAvatarMattingModel', mattingBindId.value)
    bindOk.value = true
    bindMsg.value = '绑定已保存 ✓'
  } catch (e) {
    bindOk.value = false
    bindMsg.value = '绑定失败：' + e.message
  } finally {
    savingBind.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center; z-index: 1200;
}
.modal-box {
  background: #fff; border-radius: 8px; width: 520px; max-width: 92vw;
  max-height: 88vh; overflow: auto; box-shadow: 0 6px 24px rgba(0,0,0,.25);
  display: flex; flex-direction: column;
}
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #eee; }
.modal-head h3 { margin: 0; }
.x { border: none; background: none; font-size: 16px; cursor: pointer; color: #888; }
.tabs { display: flex; gap: 4px; padding: 8px 18px 0; }
.tabs button { padding: 6px 12px; border: 1px solid #ddd; border-bottom: none; background: #f5f5f5; border-radius: 6px 6px 0 0; cursor: pointer; }
.tabs button.active { background: #fff; border-color: #1976d2; color: #1976d2; font-weight: 600; }
.tab-body { padding: 14px 18px 18px; }
.toolbar { margin-bottom: 10px; }
.row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.row > label { width: 76px; font-size: 13px; color: #555; flex: none; }
.row > select, .row > input { flex: 1; padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; box-sizing: border-box; }
.row.two > div { flex: 1; }
.row.two label { width: auto; margin-right: 6px; }
.form-card { border: 1px solid #eee; border-radius: 6px; padding: 12px; background: #fafafa; margin-bottom: 12px; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
.btn { padding: 6px 14px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 13px; }
.btn.primary { background: #1976d2; color: #fff; border-color: #1976d2; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.test-msg { font-size: 12px; margin-top: 8px; padding: 6px 8px; border-radius: 4px; }
.test-msg.ok { background: #e8f5e9; color: #2e7d32; }
.test-msg.err { background: #fdecea; color: #c62828; }
.model-list { list-style: none; margin: 0; padding: 0; }
.model-list li { display: flex; align-items: center; gap: 10px; padding: 8px; border: 1px solid #eee; border-radius: 6px; margin-bottom: 6px; }
.badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; color: #fff; text-transform: uppercase; }
.badge.text { background: #7e57c2; }
.badge.image { background: #26a69a; }
.badge.voice { background: #ef6c00; }
.badge.video { background: #ec407a; }
.m-name { font-weight: 600; flex: 1; }
.m-mfr { color: #888; font-size: 12px; }
.m-actions .link { border: none; background: none; color: #1976d2; cursor: pointer; font-size: 12px; margin-left: 6px; }
.m-actions .link.danger { color: #c62828; }
.empty { color: #999; font-size: 13px; padding: 12px; text-align: center; }
.hint { font-size: 12px; color: #666; margin: 0 0 12px; line-height: 1.6; }
.hint.sub { color: #888; margin: 2px 0 12px; }
/* 字段下方的提示语：独占一行（.row 是 flex，需换行占满宽度） */
.hint.sub.inline { flex-basis: 100%; margin: 2px 0 6px; line-height: 1.5; }
.hint.link { color: #1976d2; text-decoration: none; margin: 0; }
.hint.link:hover { text-decoration: underline; }
.btn.outline { border-color: #7aa86a; color: #31562d; background: #fff; }
.btn.outline:disabled { opacity: .5; cursor: not-allowed; }

/* 本地模型安装卡片（对齐 app SettingsModelManagerDialog 的 settings-local-model-card） */
.local-model-card {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border: 1px solid #d9e5cf; border-radius: 14px;
  background: #f6fbef; margin: 10px 0;
}
.local-model-copy { display: grid; gap: 6px; }
.local-model-title { font-size: 13px; font-weight: 900; color: #31562d; }
.local-model-text { font-size: 12px; line-height: 1.6; color: #567052; }

/* 配置信息展示 */
.info-box {
  border: 1px solid #dfe8f6; border-radius: 12px; background: #f8fbff;
  padding: 10px 12px; margin: 10px 0;
}
.info-row { display: flex; gap: 8px; font-size: 12px; padding: 3px 0; align-items: baseline; }
.info-row > span { color: #6b7a90; flex: none; width: 72px; }
.info-row > code { color: #304764; word-break: break-all; font-size: 11px; }

/* 抠图试跑预览 */
.preview-box { display: flex; gap: 12px; margin: 10px 0; }
.preview-col { flex: 1; min-width: 0; }
.preview-label { font-size: 12px; color: #666; margin-bottom: 4px; }
.preview-col img { width: 100%; border: 1px solid #eee; border-radius: 8px; display: block; }
.checker {
  border: 1px solid #eee; border-radius: 8px; padding: 4px;
  /* 棋盘格底衬托透明区域 */
  background-image:
    linear-gradient(45deg, #e9edf2 25%, transparent 25%, transparent 75%, #e9edf2 75%),
    linear-gradient(45deg, #e9edf2 25%, transparent 25%, transparent 75%, #e9edf2 75%);
  background-size: 14px 14px;
  background-position: 0 0, 7px 7px;
  background-color: #f7f9fb;
}
.checker img { border: none; }
</style>
