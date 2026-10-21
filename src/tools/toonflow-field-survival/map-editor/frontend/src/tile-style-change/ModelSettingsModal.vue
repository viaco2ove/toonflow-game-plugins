<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-box">
      <div class="modal-head">
        <h3>AI 模型设置</h3>
        <button class="x" @click="$emit('close')">✕</button>
      </div>

      <div class="tabs">
        <button :class="{active: tab==='models'}" @click="tab='models'">模型管理</button>
        <button :class="{active: tab==='bind'}" @click="tab='bind'">贴图替换绑定</button>
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
              <option v-for="m in manufacturers" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="row">
            <label>模型名</label>
            <input v-model="form.model" :placeholder="form.type==='image' ? '如 gpt-image-1 / doubao-seedream-4-0-250828' : '如 gpt-4o / deepseek-chat'" />
          </div>
          <div class="row">
            <label>BaseURL</label>
            <input v-model="form.baseUrl" :placeholder="form.manufacturer==='volcengine' ? 'https://ark.cn-beijing.volces.com/api/v3' : 'https://api.openai.com/v1'" />
          </div>
          <div class="row">
            <label>API Key</label>
            <input v-model="form.apiKey" type="password" placeholder="明文保存（同 app）" />
          </div>

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

      <!-- 绑定 -->
      <div v-else class="tab-body">
        <p class="hint">将「贴图替换」功能绑定到某个 <b>image</b> 类型模型（复刻 app 的 t_aiModelMap 槽位）。生成时若未显式传配置，则使用此绑定。</p>
        <div class="row">
          <label>贴图替换模型</label>
          <select v-model.number="bindId">
            <option :value="null">— 未绑定 —</option>
            <option v-for="m in imageModels" :key="m.id" :value="m.id">{{ m.manufacturer }} / {{ m.model || '(未命名)' }}</option>
          </select>
        </div>
        <button class="btn primary" @click="saveBind" :disabled="savingBind">{{ savingBind ? '保存中…' : '保存绑定' }}</button>
        <div v-if="bindMsg" :class="['test-msg', bindOk ? 'ok' : 'err']">{{ bindMsg }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '../api.js'

const emit = defineEmits(['close', 'saved'])

const manufacturers = ['openai', 'other', 'volcengine', 'doubao', 'gemini', 'siliconflow',
  'deepseek', 'qwen', 'zhipu', 'anthropic', 'lmstudio', 'minimax']

const tab = ref('models')
const models = ref([])
const showForm = ref(false)
const editingId = ref(null)
const testing = ref(false)
const saving = ref(false)
const testMsg = ref('')
const testOk = ref(false)

const bindId = ref(null)
const savingBind = ref(false)
const bindMsg = ref('')
const bindOk = ref(false)

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

function resetForm() {
  Object.assign(form, {
    type: 'image', manufacturer: 'openai', model: '', baseUrl: '', apiKey: '',
    modelType: '', reasoningEffort: null, temperature: null, topP: null, remark: '',
  })
}

async function load() {
  models.value = await api.listModels()
  const b = await api.getBindings()
  bindId.value = b.bindings?.textureReplaceModel ?? null
}

onMounted(load)

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
}

function payload() {
  const p = { ...form }
  if (p.type !== 'text') { p.reasoningEffort = null; p.temperature = null; p.topP = null }
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
    bindOk.value = true
    bindMsg.value = bindId.value ? '已绑定 ✓' : '已解绑'
    emit('saved')
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
.row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
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
</style>
