<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { api } from './api.js'
import TileStylePanel from './tile-style-change/TileStylePanel.vue'
import ModelSettingsModal from './tile-style-change/ModelSettingsModal.vue'
import MaterialPicker from './tile-style-change/MaterialPicker.vue'
import TilesetWorkspace from './tile-style-change/TilesetWorkspace.vue'
import SpritePicker from './SpritePicker.vue'

// ─── 常量 ───
const TILE_SIZE = 32
const DEFAULT_FILL_TILE = 7865

const OBJ_META = {
  NPC:              { label: 'NPC（可对话）',   color: '#4fc3f7', icon: '●', sprite: 4334 },
  GOBLIN:           { label: '哥布林',          color: '#ef5350', icon: '◆', sprite: 7440 },
  LOOT_GOBLIN:      { label: '拾荒哥布林',      color: '#ef5350', icon: '◆', sprite: 7440 },
  ORC:              { label: '半兽人',          color: '#ef5350', icon: '◆', sprite: 5292 },
  ORC_BOSS:         { label: '兽人首领',        color: '#ef5350', icon: '◆', sprite: 5292 },
  SKELETON:         { label: '骷髅兵',          color: '#ef5350', icon: '◆', sprite: 2552 },
  ZOMBIE:           { label: '僵尸',            color: '#ef5350', icon: '◆', sprite: 2552 },
  GHOST:            { label: '幽灵',            color: '#ef5350', icon: '◆', sprite: 2552 },
  LICH:             { label: '巫妖',            color: '#ef5350', icon: '◆', sprite: 2552 },
  RAT:              { label: '老鼠',            color: '#ef5350', icon: '◆', sprite: 2365 },
  BAT:              { label: '蝙蝠',            color: '#ef5350', icon: '◆', sprite: 3704 },
  SNAKE:            { label: '毒蛇',            color: '#ef5350', icon: '◆', sprite: 4360 },
  WOLF:             { label: '巨狼',            color: '#ef5350', icon: '◆', sprite: 5292 },
  BOAR:             { label: '野猪',            color: '#ef5350', icon: '◆', sprite: 2365 },
  WILD_GOAT:        { label: '山羊',            color: '#ef5350', icon: '◆', sprite: 2600 },
  IMP:              { label: '小恶魔',          color: '#ef5350', icon: '◆', sprite: 7440 },
  LEVEL_TRANSITION: { label: '出口（切换地图）', color: '#66bb6a', icon: '↗', sprite: 0 },
  LADDER:           { label: '梯子（地下层）',   color: '#66bb6a', icon: '↓', sprite: 0 },
  SPAWN_POINT:      { label: '地图出生点',       color: '#4caf50',     // 进入地图后玩家出现的位置（=传送点）
                              icon: '🟢', sprite: 0 },
  DOOR:             { label: '门',              color: '#ffb74d', icon: '🚪', sprite: 569 },
  LOCKED_DOOR:      { label: '锁门',            color: '#ffb74d', icon: '🔒', sprite: 810 },
  ZOMBIE_CORPSE:    { label: '僵尸尸体',        color: '#a1887f', icon: '☠', sprite: 0 },
  SKELETON_CORPSE:  { label: '骷髅尸体',        color: '#a1887f', icon: '☠', sprite: 0 },
  CORPSE:           { label: '尸体',            color: '#a1887f', icon: '☠', sprite: 0 },
  CHEST:            { label: '宝箱',            color: '#ffd54f', icon: '📦', sprite: 57 },
  ITEM:             { label: '物品（药水等）',   color: '#ce93d8', icon: '💎', sprite: 0 },
  TREE:             { label: '树木（装饰）',     color: '#81c784', icon: '🌲', sprite: 0 },
  ROCK:             { label: '岩石（装饰）',     color: '#b0bec5', icon: '🪨', sprite: 0 },
  GOLD:             { label: '金币',            color: '#ffd54f', icon: '🪙', sprite: 0 },
  KEY:              { label: '钥匙',            color: '#ffd54f', icon: '🔑', sprite: 0 },
  // ── 文字标识类（建筑名称显示，见 tiles-maps-editor/references/building-labels.md）──
  FLOAT_LABEL:      { label: '悬浮文字（仿入口）', color: '#f48fb1', icon: '🗨', sprite: 0 },
  SIGNBOARD:        { label: '路标（仿任务板）',   color: '#ffd54a', icon: '🪧', sprite: 0 },
  GROUND_TEXT:      { label: '地表文字（贴地）',   color: '#a5d6a7', icon: '🔤', sprite: 0 },
}

const PALETTE_CATS = [
  { key: 'ground', label: '地面' },
  { key: 'wall', label: '墙壁' },
  { key: 'water', label: '水面' },
  { key: 'road', label: '道路' },
  { key: 'decor', label: '装饰' },
  { key: 'farm', label: '建筑' },
]

// ─── 状态 ───
const collections = ref([])
const currentColl = ref(null)         // CollectionDetail
const currentMapName = ref(null)      // string
const currentMap = ref(null)          // Tiled JSON
const tileset = ref({ img: null, loaded: false })
const dawnlike = ref(null)            // { tilewidth, tileheight, tiles: {id: {...}} }
/** ★ 人物/怪物动画帧清单（换实体形象用；/dawnlike 不含无 description 的人物帧） */
const spritesData = ref(null)         // { tilewidth, tileheight, columns, sprites: [...] }
const isDirty = ref(false)
const collectionsLoading = ref(false)
const mapLoading = ref(false)
const error = ref('')

// 工具
const tool = ref('select')
const brushTileId = ref(DEFAULT_FILL_TILE)
const placingType = ref('NPC')
const placingCamp = ref('neutral')
const placingLevel = ref(1)
// ★ 文字类实体（悬浮文字/路标/地表文字）的显示文本
const placingText = ref('')
// ★ 实体类型可搜索下拉框
const etypeQuery = ref('')
const etypeOpen = ref(false)
const etypePlaceholder = computed(() => {
  const m = OBJ_META[placingType.value]
  return m ? `${m.icon} ${m.label}` : '选择类型'
})
/** 文字类类型：不需要阵营/等级，需要显示文本输入框 */
const TEXT_LIKE = new Set(['FLOAT_LABEL', 'SIGNBOARD', 'GROUND_TEXT'])
const isTextLikeType = computed(() => TEXT_LIKE.has(placingType.value))
/** 过滤：中文 label / 英文 key / 图标 都能搜（不区分大小写） */
const filteredEtypes = computed(() => {
  const q = etypeQuery.value.trim().toLowerCase()
  const keys = Object.keys(OBJ_META)
  if (!q) return keys
  return keys.filter((k) => {
    const m = OBJ_META[k]
    return k.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
  })
})
function pickEtype(key) {
  placingType.value = key
  etypeOpen.value = false
  etypeQuery.value = ''
}
function pickFirstFiltered() {
  const list = filteredEtypes.value
  if (list.length) pickEtype(list[0])
}
function onEtypeBlur() {
  // 延迟关闭，让 mousedown 的选项点击先触发
  setTimeout(() => { etypeOpen.value = false }, 120)
}
const showGrid = ref(false)
const showCollision = ref(false)

// 视图
const zoom = ref(1)
const camX = ref(0)
const camY = ref(0)
const activeLayerIdx = ref(0)   // 绘制目标 tilelayer 索引（0=最底层）

// 选中
const selectedObj = ref(null)

// 调色板
const activeCat = ref('ground')

// 历史
const history = ref([])
const histIdx = ref(-1)

// 模态框
const showNewCollModal = ref(false)
const showNewMapModal = ref(false)
const showPreviewModal = ref(false)
const newCollName = ref('')
const newCollDisplay = ref('')
const newMapName = ref('')
const newMapDisplay = ref('')
const newMapW = ref(30)
const newMapH = ref(20)
const saving = ref(false)

// 提示
const toastMsg = ref('')
let toastTimer = null
function toast(msg) {
  toastMsg.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastMsg.value = ''), 2200)
}

// ─── Tile Style Change ───
const showTileStylePanel = ref(false)
const showModelSettings = ref(false)
const selectedTileId = ref(null)
const selectedTileIds = ref([])     // 当前选区（单选长度1，框选为多格）
const selectedTileImage = ref('')   // 当前选中格的精灵图（dataURL）
const tileStylePanelRef = ref(null) // TileStylePanel 组件引用（切格时清候选）

// 贴图替换工作区（图集视图）状态
const showMaterialPicker = ref(false)
const tileStyleMode = ref(false)        // true = 中间区切换为图集工作区
const currentMaterial = ref(null)       // 素材集名（如 compiled_tileset_32x32）
const materialMeta = ref(null)          // compiled_tileset_32x32.json
const materialTilesetUrl = ref('')      // 当前工作区图集图（初始为后端 png，替换后为 canvas dataURL）
const styleDirty = ref(false)
let workCanvas = null                   // 离屏画布：原生分辨率图集，用于写回 32×32
let workImage = null                    // 图集 Image（用于从工作区提取单格）

async function openTileStyle() {
  showMaterialPicker.value = true
}

async function onMaterialSelected(name) {
  showMaterialPicker.value = false
  // 贴图替换必须作用于「当前打开的地图集」——每个地图集持有自己的图集副本
  if (currentColl.value && name !== currentColl.value.name) {
    toast(`⚠️ 已切换到地图集「${name}」，与当前打开的「${currentColl.value.name}」不同`)
  }
  currentMaterial.value = name
  window.__tileStyleMaterial = name   // ★ 系列换皮面板从这里读地图集名
  showTileStylePanel.value = true
  tileStyleMode.value = true
  selectedTileId.value = null
  selectedTileImage.value = ''
  try {
    const [meta, url] = await Promise.all([
      api.getMaterialMeta(name),
      Promise.resolve(api.getMaterialTilesetUrl(name)),
    ])
    materialMeta.value = meta
    materialTilesetUrl.value = url
    // 载入图集到离屏画布（用于写回 + 提取单格）
    await loadWorkCanvas(url)
  } catch (e) {
    toast('加载素材集失败：' + e.message)
  }
}

// ★ 系列换皮（TileStylePanel 的 series 模式）落盘后刷新工作区预览：
//   加 cache-bust 重新拉后端图集 + 重载离屏画布（否则画布里还是旧像素，单格提取会错）
window.addEventListener('tileset-updated', async () => {
  if (!currentMaterial.value) return
  try {
    const url = api.getMaterialTilesetUrl(currentMaterial.value) + '&t=' + Date.now()
    materialTilesetUrl.value = url
    await loadWorkCanvas(url)
    styleDirty.value = true
  } catch (e) { /* 静默 */ }
})

async function loadWorkCanvas(url) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
    img.src = url
  })
  workImage = img
  workCanvas = document.createElement('canvas')
  workCanvas.width = img.naturalWidth
  workCanvas.height = img.naturalHeight
  const ctx = workCanvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
}

function extractFromMaterial(tileId) {
  if (!workCanvas) return ''
  const cols = materialMeta.value?.columns
    ?? Math.floor(workCanvas.width / (materialMeta.value?.tilewidth || 32))
  const col = tileId % cols
  const row = Math.floor(tileId / cols)
  const tw = materialMeta.value?.tilewidth || 32
  const th = materialMeta.value?.tileheight || 32
  const c = document.createElement('canvas')
  c.width = tw; c.height = th
  c.getContext('2d').drawImage(workCanvas, col * tw, row * th, tw, th, 0, 0, tw, th)
  return c.toDataURL('image/png')
}

function onTileSelected(sel) {
  selectedTileId.value = sel.tileId
  selectedTileIds.value = (sel.tileIds && sel.tileIds.length) ? sel.tileIds : [sel.tileId]
  selectedTileImage.value = extractFromMaterial(sel.tileId)
  // 通知面板：选区变了，清空上一格的生成候选
  tileStylePanelRef.value?.onSelectionChanged?.()
}

// 把一张 32×32 贴回工作区画布（支持多格批量）。先清空该格再贴 —— 替换而不是叠加
async function writeTile(tileId, imageBase64) {
  const cols = materialMeta.value?.columns
    ?? Math.floor(workCanvas.width / (materialMeta.value?.tilewidth || 32))
  const col = tileId % cols
  const row = Math.floor(tileId / cols)
  const tw = materialMeta.value?.tilewidth || 32
  const th = materialMeta.value?.tileheight || 32
  const ctx2d = workCanvas.getContext('2d')
  // 清空该格（含透明像素），避免旧图透过新图的透明区域形成叠加
  ctx2d.clearRect(col * tw, row * th, tw, th)
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = imageBase64 })
  ctx2d.drawImage(img, col * tw, row * th, tw, th)
}

async function onReplaceTile({ tileId, imageBase64, tileIds }) {
  if (!workCanvas) {
    toast('工作区未初始化')
    return
  }
  const ids = (tileIds && tileIds.length) ? tileIds : [tileId]
  try {
    for (const id of ids) {
      await writeTile(id, imageBase64)
      await api.saveOverride({
        material: currentMaterial.value,
        tileId: id,
        image_base64: imageBase64,
        prompt: '',
        model: '',
      })
    }
    // 实时刷新工作区预览
    materialTilesetUrl.value = workCanvas.toDataURL('image/png')
    styleDirty.value = true
    toast(`已替换并保存 ${ids.length} 格`)
  } catch (e) {
    toast('保存失败：' + e.message)
  }
}

// 重置格子：以后端 overrides/originals 存档为准（真实落盘恢复 + 删 styleOverrides 条目）
async function onResetTile(payload) {
  if (!workCanvas) {
    toast('工作区未初始化')
    return
  }
  const ids = Array.isArray(payload) ? payload
    : (payload?.tileIds && payload.tileIds.length) ? payload.tileIds
    : [payload]
  const cols = materialMeta.value?.columns
    ?? Math.floor(workCanvas.width / (materialMeta.value?.tilewidth || 32))
  const tw = materialMeta.value?.tilewidth || 32
  const th = materialMeta.value?.tileheight || 32
  const ctx2d = workCanvas.getContext('2d')
  let ok = 0, failed = 0
  for (const tileId of ids) {
    try {
      // 后端：从 originals 存档恢复 png 像素 + 删 styleOverrides 条目
      await api.resetTile({ material: currentMaterial.value, tileId })
      // 前端：从原始图集图（workImage 是进入工作区时加载的原图）回写该格
      const col = tileId % cols
      const row = Math.floor(tileId / cols)
      ctx2d.clearRect(col * tw, row * th, tw, th)
      ctx2d.drawImage(workImage, col * tw, row * th, tw, th, col * tw, row * th, tw, th)
      ok++
    } catch (e) {
      failed++
      console.warn('重置失败', tileId, e)
    }
  }
  materialTilesetUrl.value = workCanvas.toDataURL('image/png')
  styleDirty.value = ok > 0
  if (ok && !failed) toast(`已重置 ${ok} 格（已落盘）`)
  else if (ok && failed) toast(`重置 ${ok} 格成功，${failed} 格失败（可能本来没有覆盖记录）`)
  else toast('重置失败：所选格子没有覆盖记录')
}

function exitTileStyle() {
  tileStyleMode.value = false
  showTileStylePanel.value = false      // 关掉右侧贴图替换面板
  currentMaterial.value = null
  workCanvas = null
  workImage = null
  // 清空选区，避免下次进入时残留上一批 id
  selectedTileId.value = null
  selectedTileIds.value = []
  selectedTileImage.value = ''
  materialTilesetUrl.value = ''
  // canvas 用 v-show 常驻，这里只需在显示恢复后重绘一次（双保险）
  nextTick(() => {
    ctx = null
    resizeCanvas()
  })
}

// ─── 加载地图集列表 ───
async function loadCollections() {
  collectionsLoading.value = true
  error.value = ''
  try {
    collections.value = await api.listCollections()
  } catch (e) {
    error.value = e.message
  } finally {
    collectionsLoading.value = false
  }
}

// ─── 选择地图集 ───
async function selectCollection(name) {
  mapLoading.value = true
  error.value = ''
  try {
    const detail = await api.getCollection(name)
    currentColl.value = detail
    currentMapName.value = null
    currentMap.value = null
    selectedObj.value = null
    // 加载资源
    await loadResources(name)
    // 选中第一张地图
    if (detail.maps.length > 0) {
      await selectMap(detail.maps[0].name)
    } else {
      render()
    }
  } catch (e) {
    error.value = e.message
  } finally {
    mapLoading.value = false
  }
}

async function loadResources(collName) {
  // tileset
  tileset.value = { img: null, loaded: false }
  try {
    const url = api.tilesetUrl(collName)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = () => rej(new Error('tileset 加载失败'))
      img.src = url
    })
    tileset.value = { img, loaded: true }
  } catch (e) {
    console.warn('tileset load failed:', e)
  }
  // dawnlike（编译后的）
  try {
    dawnlike.value = await api.dawnlike(collName)
  } catch (e) {
    console.warn('dawnlike load failed:', e)
    dawnlike.value = { tilewidth: 32, tileheight: 32, tiles: {} }
  }
  // data.xlsx 资源注册表（Wall/Floor/Decor 族 + Enemies）
  dataSheets.value = null
  activeSheetIdx.value = 0
  activeFamilyId.value = null
  try {
    dataSheets.value = await api.dataSheets(collName)
  } catch (e) {
    console.warn('data-sheets load failed:', e)
  }
  // ★ 人物/怪物动画帧清单（换实体形象用）
  spritesData.value = null
  try {
    spritesData.value = await api.sprites(collName)
  } catch (e) {
    console.warn('sprites load failed:', e)
  }
}

// ─── 资源族（data.xlsx）───
const dataSheets = ref(null)          // { sheets: [{kind, name, families|enemies}] }
const activeSheetIdx = ref(0)         // 当前资源 sheet 索引
const activeFamilyId = ref(null)      // 当前展开的族 id

const activeSheet = computed(() => dataSheets.value?.sheets?.[activeSheetIdx.value] || null)
const sheetFamilies = computed(() => activeSheet.value?.families || [])
const activeFamily = computed(() =>
  sheetFamilies.value.find(f => f.id === activeFamilyId.value) || null
)

/** 族在图集上的整行预览：把族内 tileId 按图集列数排成连续片段 */
function familyTileRows(fam) {
  if (!fam) return []
  const tids = fam.tiles
  const out = []
  const CHUNK = 10
  for (let i = 0; i < tids.length; i += CHUNK) {
    out.push(tids.slice(i, i + CHUNK))
  }
  return out
}

function pickFamily(fam) {
  activeFamilyId.value = activeFamilyId.value === fam.id ? null : fam.id
}

// ─── 选择地图 ───
async function selectMap(mapName) {
  if (isDirty.value) {
    if (!confirm('当前地图有未保存的更改，是否继续？')) return
  }
  try {
    const data = await api.getMap(currentColl.value.name, mapName)
    currentMapName.value = mapName
    currentMap.value = data
    selectedObj.value = null
    activeLayerIdx.value = 0
    history.value = [JSON.parse(JSON.stringify(data))]
    histIdx.value = 0
    isDirty.value = false
    zoom.value = 1
    camX.value = (data.width || 30) / 2
    camY.value = (data.height || 20) / 2
    await nextTick()
    render()
  } catch (e) {
    error.value = e.message
  }
}

// ─── 新建地图集 ───
function openNewCollModal() {
  newCollName.value = ''
  newCollDisplay.value = ''
  showNewCollModal.value = true
}
async function submitNewCollection() {
  if (!newCollName.value.trim()) return
  try {
    await api.createCollection(newCollName.value.trim(), newCollDisplay.value.trim() || newCollName.value.trim())
    showNewCollModal.value = false
    toast(`已创建：${newCollName.value}`)
    await loadCollections()
    await selectCollection(newCollName.value.trim())
  } catch (e) {
    error.value = e.message
  }
}

// ─── 新建地图 ───
function openNewMapModal() {
  newMapName.value = ''
  newMapDisplay.value = ''
  newMapW.value = 30
  newMapH.value = 20
  showNewMapModal.value = true
}
async function submitNewMap() {
  if (!newMapName.value.trim()) return
  try {
    await api.createMap(
      currentColl.value.name,
      newMapName.value.trim(),
      newMapDisplay.value.trim() || newMapName.value.trim(),
      newMapW.value,
      newMapH.value
    )
    showNewMapModal.value = false
    toast(`已创建地图：${newMapName.value}`)
    // 重新加载地图集详情
    const detail = await api.getCollection(currentColl.value.name)
    currentColl.value = detail
    await selectMap(newMapName.value.trim())
  } catch (e) {
    error.value = e.message
  }
}

// ─── 删除地图 ───
async function deleteMap(mapName) {
  if (!confirm(`确定删除地图「${mapName}」？`)) return
  try {
    await api.deleteMap(currentColl.value.name, mapName)
    toast(`已删除：${mapName}`)
    if (currentMapName.value === mapName) {
      currentMapName.value = null
      currentMap.value = null
    }
    const detail = await api.getCollection(currentColl.value.name)
    currentColl.value = detail
    if (!currentMap.value && detail.maps.length > 0) {
      await selectMap(detail.maps[0].name)
    } else {
      render()
    }
  } catch (e) {
    error.value = e.message
  }
}

// ─── 保存当前地图 ───
async function saveCurrentMap() {
  if (!currentMap.value || !currentMapName.value) return
  saving.value = true
  try {
    await api.saveMap(currentColl.value.name, currentMapName.value, currentMap.value)
    isDirty.value = false
    toast(`已保存：${currentMapName.value}`)
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

// ─── 预览：保存 + 启动 dev-host（--conn 拟真宿主，等价 npm run debug -- --story X --conn） ───
const previewLoading = ref(false)
const previewUrl = ref('')

async function openPreview() {
  if (!currentMap.value || !currentMapName.value || !currentColl.value) return
  // 1. 保存当前地图（dev-host 读 workshops 源文件）
  try {
    await api.saveMap(currentColl.value.name, currentMapName.value, currentMap.value)
    isDirty.value = false
  } catch (e) {
    error.value = e.message
    return
  }
  // ★ 独立（standalone）预览：浏览器新标签页直接打开游戏本体，URL 带 storyId+mapId，
  //   游戏以 mock 宿主模式从本地 workshops 读地图自己跑 —— 不调用 storyInfo、无服务端鉴权。
  //   同步先开一个空白标签页（受用户点击信任，避免被弹窗拦截），随后填入真实地址。
  const w = (() => { try { return window.open('', '_blank') } catch { return null } })()
  previewLoading.value = true
  showPreviewModal.value = false
  previewUrl.value = ''
  try {
    // 重启 dev server，确保最新 vite.config.ts（含 ?__standalone 路由）生效
    try { await api.devhostStop() } catch { /* 无进程可忽略 */ }
    await api.devhostStart(currentColl.value.name)
    // 轮询等 vite 就绪（冷启动可能要十几秒）
    for (let i = 0; i < 40; i++) {
      await new Promise(res => setTimeout(res, 1000))
      try {
        const st = await api.devhostStatus()
        if (st.port_up) break
      } catch { /* keep waiting */ }
    }
    const story = encodeURIComponent(currentColl.value.name)
    const map = encodeURIComponent(currentMapName.value)
    // 游戏本体（standalone）：?__standalone=1 直载游戏、强制 mock 宿主；
    //   story=地图集名（对应 workshops 目录）、map=正在编辑的地图文件名
    previewUrl.value = `http://localhost:3000/?__standalone=1&story=${story}&map=${map}`
    if (w) { w.location.href = previewUrl.value; w.focus() }
    else { showPreviewModal.value = true }  // 弹窗被拦截 → 模态框提供手动链接
    toast('已在浏览器新标签页打开预览（独立模式，无需鉴权）')
  } catch (e) {
    if (w) try { w.close() } catch {}
    error.value = e.message
    showPreviewModal.value = false
  } finally {
    previewLoading.value = false
  }
}

async function closePreview() {
  showPreviewModal.value = false
  // 关预览不杀 dev server（复用：下次打开秒开）。要停服务用工具栏「停止预览服务」
}

// ─── 工具切换 ───
function setTool(t) { tool.value = t }

// ─── 撤销/重做 ───
function pushHistory() {
  history.value = history.value.slice(0, histIdx.value + 1)
  history.value.push(JSON.parse(JSON.stringify(currentMap.value)))
  histIdx.value = history.value.length - 1
  isDirty.value = true
}
function undo() {
  if (histIdx.value <= 0) return
  histIdx.value--
  currentMap.value = JSON.parse(JSON.stringify(history.value[histIdx.value]))
  selectedObj.value = null
  isDirty.value = true
  render()
}
function redo() {
  if (histIdx.value >= history.value.length - 1) return
  histIdx.value++
  currentMap.value = JSON.parse(JSON.stringify(history.value[histIdx.value]))
  selectedObj.value = null
  isDirty.value = true
  render()
}

// ─── 调色板 ───
const tilesByCat = computed(() => {
  const out = {}
  if (!dawnlike.value?.tiles) return out
  for (const [id, t] of Object.entries(dawnlike.value.tiles)) {
    const cat = t.category || 'ground'
    if (!out[cat]) out[cat] = []
    out[cat].push({ id: parseInt(id), ...t })
  }
  return out
})

const visiblePaletteTiles = computed(() => {
  return (tilesByCat.value[activeCat.value] || []).slice(0, 80)
})

function selectTile(id) {
  brushTileId.value = id
  // 同步到 TileStylePanel
  selectedTileId.value = id
  extractTileToDataUrl(id)
}

function extractTileToDataUrl(tileId) {
  if (!tileset.value.loaded) return
  const cols = Math.floor(tileset.value.img.width / TILE_SIZE)
  const col = tileId % cols
  const row = Math.floor(tileId / cols)

  const canvas = document.createElement('canvas')
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    tileset.value.img,
    col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE,
    0, 0, TILE_SIZE, TILE_SIZE
  )
  selectedTileImage.value = canvas.toDataURL('image/png')
}

// 调色板缩略图：使用 backgroundPosition 切出单瓦片
const paletteBgUrl = computed(() =>
  tileset.value.loaded && currentColl.value ? api.tilesetUrl(currentColl.value.name) : ''
)
function paletteTileStyle(tileId) {
  if (!tileset.value.loaded || !currentColl.value) {
    // fallback 纯色
    const cat = dawnlike.value?.tiles?.[tileId]?.category
    const colorMap = { wall: '#6d4c41', water: '#1565c0', road: '#795548', decor: '#388e3c', farm: '#f57f17' }
    return { backgroundColor: colorMap[cat] || '#4caf50', backgroundImage: 'none' }
  }
  // tileset 是 3840×3488px，每瓦片 32px，列数 = 3840/32 = 120
  const cols = Math.floor(tileset.value.img.width / TILE_SIZE)
  const col = tileId % cols
  const row = Math.floor(tileId / cols)
  const sx = -(col * 38)   // 38 是 .palette-tile 的 width
  const sy = -(row * 38)
  return {
    backgroundImage: `url(${paletteBgUrl.value})`,
    backgroundSize: `${120 * 38}px auto`,  // 整张图按 120 列缩放到 38px/格
    backgroundPosition: `${sx}px ${sy}px`,
    backgroundRepeat: 'no-repeat',
  }
}

// ─── Canvas 渲染 ───
const canvasRef = ref(null)
const canvasWrapRef = ref(null)
let ctx = null
let isPanning = false
let isDragging = false
let mouseDownAt = null
let mouseMoved = false
let lastDrawTiles = []
let shiftHeld = false
let ctrlHeld = false
let altHeld = false
let tHeld = false
let movingObj = null        // 拖动中的对象 { obj, origX, origY }
let movingStartTile = null  // 拖动起始 tile { tx, ty }

// ★ T 键：toggle「坐标显示」模式——开启时左键单击显示 tile/world 坐标（飘字）
const showCoordInspector = ref(false)

/** Shift 按住 → 笔刷绘制模式；Ctrl 按住 → 平移模式；Alt 按住 → 移动实体 */
function updateCursor() {
  const el = canvasRef.value
  if (!el) return
  if (isPanning) el.style.cursor = 'grabbing'
  else if (isDragging) el.style.cursor = 'crosshair'
  else if (movingObj) el.style.cursor = 'grabbing'
  else if (altHeld) el.style.cursor = 'move'
  else if (ctrlHeld) el.style.cursor = 'grab'
  else if (shiftHeld) el.style.cursor = 'crosshair'
  else el.style.cursor = ''
}

function screenToTile(sx, sy) {
  if (!canvasRef.value) return { tx: 0, ty: 0 }
  const rect = canvasRef.value.getBoundingClientRect()
  const cx = canvasRef.value.width / 2
  const cy = canvasRef.value.height / 2
  const tx = (sx - rect.left - cx) / (TILE_SIZE * zoom.value) + camX.value
  const ty = (sy - rect.top - cy) / (TILE_SIZE * zoom.value) + camY.value
  return { tx: Math.floor(tx), ty: Math.floor(ty) }
}

function tileToScreen(tx, ty) {
  if (!canvasRef.value) return { sx: 0, sy: 0 }
  const cx = canvasRef.value.width / 2
  const cy = canvasRef.value.height / 2
  return {
    sx: (tx - camX.value) * TILE_SIZE * zoom.value + cx,
    sy: (ty - camY.value) * TILE_SIZE * zoom.value + cy,
  }
}

function getTileLayer() {
  return tileLayers.value[activeLayerIdx.value] || null
}
function getObjLayer() {
  return currentMap.value?.layers?.find(l => l.type === 'objectgroup') || null
}
// 所有 tilelayer（渲染用，全层叠加）
const tileLayers = computed(() =>
  currentMap.value?.layers?.filter(l => l.type === 'tilelayer') || []
)
// Tiled gid → 图像索引偏移（map 数据存 gid = 图像索引 + firstgid）
const firstGid = computed(() => currentMap.value?.tilesets?.[0]?.firstgid ?? 1)

function propsMap(obj) {
  if (!Array.isArray(obj?.properties)) return {}
  return Object.fromEntries(obj.properties.map(p => [p.name, p.value]))
}
function getProp(obj, name, def) {
  const p = obj?.properties?.find(p => p.name === name)
  return p !== undefined ? p.value : def
}
function setProp(obj, name, value) {
  const props = obj.properties || []
  const existing = props.find(p => p.name === name)
  if (existing) existing.value = value
  else props.push({ name, value, type: typeof value === 'number' ? 'int' : 'string' })
  obj.properties = props
}
function newObjId() {
  const L = getObjLayer()
  if (!L) return 1
  return L.objects.reduce((m, o) => Math.max(m, o.id || 0), 0) + 1
}

function render() {
  if (!canvasRef.value) return
  const W = canvasRef.value.width
  const H = canvasRef.value.height
  if (!ctx) ctx = canvasRef.value.getContext('2d')
  ctx.clearRect(0, 0, W, H)

  if (!currentMap.value) {
    ctx.fillStyle = '#080808'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#333'
    ctx.font = '16px Consolas'
    ctx.textAlign = 'center'
    ctx.fillText('请选择地图集 → 左侧选地图开始编辑', W / 2, H / 2)
    return
  }

  const map = currentMap.value
  const cols = map.width, rows = map.height
  ctx.fillStyle = '#080808'
  ctx.fillRect(0, 0, W, H)

  // tilelayer 全层叠加（与游戏运行时 mapBake 一致）
  if (tileLayers.value.length && tileset.value.loaded) {
    const tsCols = tileset.value.img.width / TILE_SIZE
    const visL = camX.value - (W / 2) / (TILE_SIZE * zoom.value) - 1
    const visR = camX.value + (W / 2) / (TILE_SIZE * zoom.value) + 1
    const visT = camY.value - (H / 2) / (TILE_SIZE * zoom.value) - 1
    const visB = camY.value + (H / 2) / (TILE_SIZE * zoom.value) + 1
    const ty0 = Math.max(0, Math.floor(visT)), ty1 = Math.min(rows - 1, Math.ceil(visB))
    const tx0 = Math.max(0, Math.floor(visL)), tx1 = Math.min(cols - 1, Math.ceil(visR))
    const sz = TILE_SIZE * zoom.value
        for (let li = 0; li < tileLayers.value.length; li++) {
      const layer = tileLayers.value[li]
      const isActive = li === activeLayerIdx.value
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const idx = ty * cols + tx
          const gid = layer.data[idx] || 0
          if (!gid) continue
          const tileId = gid - firstGid.value  // Tiled gid → 图像索引（与 mapBake 一致）
          if (tileId < 0) continue
          const { sx, sy } = tileToScreen(tx, ty)
          const sx2 = (tileId % tsCols) * TILE_SIZE
          const sy2 = Math.floor(tileId / tsCols) * TILE_SIZE
          ctx.drawImage(tileset.value.img, sx2, sy2, TILE_SIZE, TILE_SIZE, sx, sy, sz, sz)
          if (showCollision.value && dawnlike.value?.tiles?.[tileId]?.blocked) {
            ctx.fillStyle = 'rgba(255,0,0,0.25)'
            ctx.fillRect(sx, sy, sz, sz)
          }
        }
      }
      // ★ 激活层高亮：Draw/Erase 模式下给该层非空格描金色细边
      if (isActive && (tool.value === 'draw' || tool.value === 'erase') && zoom.value >= 0.3) {
        ctx.strokeStyle = 'rgba(212,161,62,0.55)'
        ctx.lineWidth = 1
        for (let ty = ty0; ty <= ty1; ty++) {
          for (let tx = tx0; tx <= tx1; tx++) {
            if (layer.data[ty * cols + tx]) {
              const { sx, sy } = tileToScreen(tx, ty)
              ctx.strokeRect(sx + 0.5, sy + 0.5, sz - 1, sz - 1)
            }
          }
        }
      }
    }
  } else if (tileLayers.value.length) {
    // 无 tileset：只渲染当前激活层的色块
    const layer = getTileLayer()
    if (layer) {
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const idx = ty * cols + tx
          const tileId = layer.data[idx] || 0
          const { sx, sy } = tileToScreen(tx, ty)
          const sz = TILE_SIZE * zoom.value
          ctx.fillStyle = tileColorFallback(tileId)
          ctx.fillRect(sx, sy, sz, sz)
        }
      }
    }
  }

  // 网格
  if (showGrid.value) {
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth = 1
    const sz = TILE_SIZE * zoom.value
    const startX = canvasRef.value.width / 2 - (camX.value - Math.floor(camX.value)) * sz
    const startY = canvasRef.value.height / 2 - (camY.value - Math.floor(camY.value)) * sz
    for (let x = startX; x < canvasRef.value.width; x += sz) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasRef.value.height); ctx.stroke()
    }
    for (let y = startY; y < canvasRef.value.height; y += sz) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasRef.value.width, y); ctx.stroke()
    }
  }

  // 对象层
  const objLayer = getObjLayer()
  if (objLayer) {
    const tsCols2 = tileset.value.loaded ? tileset.value.img.width / TILE_SIZE : 0
    for (const obj of objLayer.objects) {
      const props = propsMap(obj)
      const meta = OBJ_META[props.entity_type] || OBJ_META.ITEM
      const tx = obj.x / TILE_SIZE
      const ty = obj.y / TILE_SIZE - 1
      const { sx, sy } = tileToScreen(tx, ty)
      const sz = TILE_SIZE * zoom.value
      if (selectedObj.value === obj) {
        ctx.strokeStyle = '#ffd54f'
        ctx.lineWidth = 2
        ctx.strokeRect(sx - 2, sy - 2, sz + 4, sz + 4)
      }
      // ★ sprite 优先：obj.gid（Tiled 对象指向图集）> OBJ_META.sprite（按类型映射）
      const spriteId = obj.gid ? (obj.gid - (map.tilesets?.[0]?.firstgid ?? 1)) : (meta.sprite || 0)
      if (tileset.value.loaded && spriteId > 0 && spriteId * TILE_SIZE < tileset.value.img.width * (tileset.value.img.height / TILE_SIZE)) {
        const sx2 = (spriteId % tsCols2) * TILE_SIZE
        const sy2 = Math.floor(spriteId / tsCols2) * TILE_SIZE
        ctx.drawImage(tileset.value.img, sx2, sy2, TILE_SIZE, TILE_SIZE, sx, sy, sz, sz)
        // 半透明底色圈标记类型（sprite 之上可辨识阵营）
        ctx.fillStyle = meta.color + '55'
        ctx.beginPath()
        ctx.arc(sx + sz / 2, sy + sz * 0.85, sz * 0.18, 0, Math.PI * 2)
        ctx.fill()
      } else {
        // 降级：色圆 + 图标字符
        ctx.fillStyle = meta.color + 'bb'
        ctx.beginPath()
        ctx.arc(sx + sz / 2, sy + sz / 2, sz * 0.36, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = `${Math.round(sz * 0.42)}px serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(meta.icon, sx + sz / 2, sy + sz / 2)
      }
      // ★ 文字类实体：按类型画预览样式（引擎内同款外观）
      if (props.entity_type === 'FLOAT_LABEL') {
        // 悬浮文字：粉字+黑影（同引擎 portal label）
        const label = props.full_name || '文字'
        ctx.font = `bold ${Math.round(12 * zoom.value)}px 'Microsoft YaHei'`
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(0,0,0,.85)'
        ctx.fillText(label, sx + sz / 2 + 1, sy - sz * 0.1 + 1)
        ctx.fillStyle = '#ff9999'
        ctx.fillText(label, sx + sz / 2, sy - sz * 0.1)
        continue
      }
      if (props.entity_type === 'SIGNBOARD') {
        // 路标：深底黄边圆角牌（同任务板）
        const label = props.full_name || '路标'
        const k = Math.max(0.6, Math.min(2, zoom.value))
        ctx.font = `bold ${Math.round(12 * k)}px 'Microsoft YaHei'`
        ctx.textAlign = 'center'
        const tw = ctx.measureText(label).width
        const lx = sx + sz / 2, ly = sy - 4
        ctx.fillStyle = 'rgba(20,16,8,.88)'
        ctx.beginPath()
        ctx.roundRect(lx - tw / 2 - 6, ly - 14, tw + 12, 18, 5)
        ctx.fill()
        ctx.strokeStyle = '#ffd54a'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = '#ffe9a8'
        ctx.fillText(label, lx, ly)
        continue
      }
      if (props.entity_type === 'GROUND_TEXT') {
        // 地表文字：贴地（画在格子中线，半透明绿字，像地图注记）
        const label = props.full_name || '文字'
        ctx.font = `bold ${Math.round(11 * zoom.value)}px 'Microsoft YaHei'`
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(0,0,0,.5)'
        ctx.fillText(label, sx + sz / 2 + 1, sy + sz * 0.62 + 1)
        ctx.fillStyle = '#c8e6c9'
        ctx.fillText(label, sx + sz / 2, sy + sz * 0.62)
        continue
      }
      if (zoom.value >= 0.5) {
        const name = props.full_name || props.name || obj.name || props.entity_type || ''
        if (name) {
          const label = name.length > 8 ? name.slice(0, 7) + '…' : name
          ctx.font = `${Math.max(8, Math.round(9 * zoom.value))}px Consolas`
          const lw = ctx.measureText(label).width
          ctx.fillStyle = 'rgba(0,0,0,0.6)'
          ctx.fillRect(sx + sz / 2 - lw / 2 - 2, sy - 12 * zoom.value, lw + 4, 11 * zoom.value)
          ctx.fillStyle = '#fff'
          ctx.fillText(label, sx + sz / 2, sy - 6 * zoom.value)
        }
      }
    }
  }
}

function tileColorFallback(tileId) {
  if (!dawnlike.value?.tiles) return '#555'
  const t = dawnlike.value.tiles[tileId]
  if (!t) return '#555'
  const map = { wall: '#6d4c41', water: '#1565c0', road: '#795548', decor: '#388e3c', farm: '#f57f17' }
  return map[t.category] || '#4caf50'
}

// ─── Canvas 事件 ───
function findObjAt(tx, ty) {
  const L = getObjLayer()
  if (!L) return null
  for (const obj of L.objects) {
    const ox = Math.floor(obj.x / TILE_SIZE)
    const oy = Math.floor(obj.y / TILE_SIZE) - 1
    if (tx === ox && ty === oy) return obj
  }
  return null
}

function onPointerDown(e) {
  mouseDownAt = { x: e.clientX, y: e.clientY }
  mouseMoved = false
  // ★ 中键 / Ctrl+左键 → 平移；Shift+左键 → 笔刷绘制；Alt+左键 → 移动实体；普通左键 → 选择
  if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
    isPanning = true
    updateCursor()
    e.preventDefault()
    return
  }
  if (e.button !== 0 || !currentMap.value) return
  if (e.shiftKey && (tool.value === 'draw' || tool.value === 'erase')) {
    // ★ Shift+左键 = 笔刷开始（按住 Shift 拖动连刷，单击 Shift 也画一格）
    isDragging = true
    lastDrawTiles = []
    const { tx, ty } = screenToTile(e.clientX, e.clientY)
    const L = getTileLayer()
    if (!L) return
    pushHistory()
    const idx = ty * currentMap.value.width + tx
    if (idx >= 0 && idx < L.data.length) {
      L.data[idx] = tool.value === 'erase' ? DEFAULT_FILL_TILE : brushTileId.value + firstGid.value
    }
    isDirty.value = true
    render()
    updateCursor()
    return
  }
  if (e.altKey && tool.value === 'select') {
    // ★ Alt+左键 → 移动实体（选中或拾起：指针处有对象就拖动，没有就抓最远的）
    const t = screenToTile(e.clientX, e.clientY)
    let obj = findObjAt(t.tx, t.ty)
    // SPAWN_POINT 的 tile 是从对象层查；如果直接点在 polygon 内部也能找到
    if (!obj) {
      const L = getObjLayer()
      if (L) {
        const wx = t.tx - (currentMap.value.width / 2)  // tile → 世界坐标转换（与 normalizeMapConfig 一致）
        const wy = t.ty - (currentMap.value.height / 2)
        obj = L.objects.find(o => {
          const ox = o.x / 32 - (currentMap.value.width / 2)
          const oy = o.y / 32 - 1 - (currentMap.value.height / 2)
          return Math.abs(ox - wx) < 0.6 && Math.abs(oy - wy) < 0.6
        })
      }
    }
    if (obj) {
      movingObj = obj
      movingStartTile = t
      pushHistory()
      selectedObj.value = obj
      updateCursor()
      e.preventDefault()
      return
    }
  }
  canvasRef.value?.setPointerCapture(e.pointerId)
}

/** 左键释放：结束笔刷（Shift+左键拖动时） */
function onPointerUpBrush(e) {
  if (e.button !== 0) return
  if (isDragging) {
    if (tool.value === 'draw' || tool.value === 'erase') pushHistory()
    isDragging = false
    lastDrawTiles = []
    updateCursor()
  }
}

function onPointerMove(e) {
  const dx = e.clientX - (mouseDownAt?.x || e.clientX)
  const dy = e.clientY - (mouseDownAt?.y || e.clientY)
  if (mouseDownAt && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) mouseMoved = true
  if (isPanning) {
    const sz = TILE_SIZE * zoom.value
    camX.value -= dx / sz
    camY.value -= dy / sz
    mouseDownAt = { x: e.clientX, y: e.clientY }
    render()
    return
  }
  // ★ Shift+左键按住拖动时（isDragging）连刷；鼠标单纯移动不再绘制
  if (isDragging && e.buttons & 1 && e.shiftKey && (tool.value === 'draw' || tool.value === 'erase')) {
    const { tx, ty } = screenToTile(e.clientX, e.clientY)
    const L = getTileLayer()
    if (!L) return
    const idx = ty * currentMap.value.width + tx
    if (idx < 0 || idx >= L.data.length) return
    if (lastDrawTiles.includes(idx)) return
    lastDrawTiles.push(idx)
    L.data[idx] = tool.value === 'erase' ? DEFAULT_FILL_TILE : brushTileId.value + firstGid.value
    isDirty.value = true
    render()
    return
  }
  // ★ Alt+左键拖动 → 移动选中的对象（每帧按 tile 吸附）
  if (movingObj && e.buttons & 1) {
    const dx = e.clientX - (mouseDownAt?.x || e.clientX)
    const dy = e.clientY - (mouseDownAt?.y || e.clientY)
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) mouseMoved = true
    const { tx, ty } = screenToTile(e.clientX, e.clientY)
    const cm = currentMap.value
    movingObj.x = tx * TILE_SIZE
    movingObj.y = (ty + 1) * TILE_SIZE
    isDirty.value = true
    render()
  }
}

function onPointerUp(e) {
  if (isPanning) { isPanning = false; updateCursor(); return }
  if (e.button !== 0) return
  canvasRef.value?.releasePointerCapture(e.pointerId)
  // ★ Alt+左键拖动结束
  if (movingObj) {
    movingObj = null
    movingStartTile = null
    updateCursor()
    mouseDownAt = null
    mouseMoved = false
    return
  }
  if (!mouseMoved && mouseDownAt) {
    const { tx, ty } = screenToTile(e.clientX, e.clientY)
    handleClick(tx, ty)
    // ★ T 键坐标显示模式：左键单击也显示坐标（与选择行为兼容）
    maybeShowCoord(e.clientX, e.clientY)
  } else if (isDragging) {
    if (tool.value === 'draw' || tool.value === 'erase') pushHistory()
    isDragging = false
    lastDrawTiles = []
  }
  mouseDownAt = null
  mouseMoved = false
}

function onWheel(e) {
  e.preventDefault()
  const { tx, ty } = screenToTile(e.clientX, e.clientY)
  const factor = e.deltaY < 0 ? 1.12 : 0.89
  zoom.value = Math.max(0.15, Math.min(10, zoom.value * factor))
  const rect = canvasRef.value.getBoundingClientRect()
  camX.value = tx - (e.clientX - rect.left - canvasRef.value.width / 2) / (TILE_SIZE * zoom.value)
  camY.value = ty - (e.clientY - rect.top - canvasRef.value.height / 2) / (TILE_SIZE * zoom.value)
  render()
}

function handleClick(tx, ty) {
  if (!currentMap.value) return
  switch (tool.value) {
    case 'select': {
      const obj = findObjAt(tx, ty)
      selectedObj.value = obj
      render()
      break
    }
    case 'draw':
    case 'erase':
      // ★ 绘制/擦除已改为 Shift+左键（onPointerDown 里）；左键单击不再落笔
      break
    case 'place': {
      const L = getObjLayer()
      if (!L) return
      pushHistory()
      // ★ 文字类实体（悬浮文字/路标/地表文字）：带 full_name 显示文本
      const props = placingType.value === 'LEVEL_TRANSITION'
        ? { entity_type: placingType.value, portalID: 'Mulberry Town' }
        : placingType.value === 'CHEST'
        ? { entity_type: placingType.value, tier: 1 }
        : placingType.value === 'ITEM'
        ? { entity_type: placingType.value, heal: 40 }
        : placingType.value === 'SPAWN_POINT'
        ? { entity_type: placingType.value }
        : TEXT_LIKE.has(placingType.value)
        ? {
            entity_type: placingType.value,
            full_name: placingText.value.trim() || '文字',
          }
        : { entity_type: placingType.value, camp: placingCamp.value, level: placingLevel.value }
      const newObj = {
        id: newObjId(), name: '', type: '',
        x: tx * TILE_SIZE, y: (ty + 1) * TILE_SIZE,
        width: TILE_SIZE, height: TILE_SIZE,
        properties: Object.entries(props).map(([k, v]) => ({
          name: k, value: v, type: typeof v === 'number' ? 'int' : 'string'
        }))
      }
      L.objects.push(newObj)
      selectedObj.value = newObj
      isDirty.value = true
      render()
      break
    }
    case 'erase-obj': {
      const obj = findObjAt(tx, ty)
      if (obj) {
        selectedObj.value = obj
        deleteSelectedObj()
      }
      break
    }
  }
}

function deleteSelectedObj() {
  if (!selectedObj.value) return
  const L = getObjLayer()
  if (!L) return
  pushHistory()
  const idx = L.objects.indexOf(selectedObj.value)
  if (idx >= 0) L.objects.splice(idx, 1)
  selectedObj.value = null
  isDirty.value = true
  render()
}

// 应用属性修改
function applyObjProps(props) {
  if (!selectedObj.value) return
  pushHistory()
  for (const [k, v] of Object.entries(props)) {
    setProp(selectedObj.value, k, v)
  }
  isDirty.value = true
  render()
}

/**
 * ★ 换实体形象（外观）—— 写 object.gid。
 *
 * 约定（game.md）：外观由 object.gid 指向图集，entity_type 只决定行为类。
 * gid 是 Tiled 对象的**顶层字段**（不在 properties 数组里），所以不能走 setProp。
 *
 * gid = tileId + firstgid（Tiled 惯例：gid 从 firstgid 起算，图集内索引 = gid - firstgid）。
 * gid = 0 表示「无图集贴图」→ runtime 回退按 entity_type/side 选默认形象。
 */
function onPickSprite({ gid, tileId, sprite }) {
  if (!selectedObj.value) return
  pushHistory()
  selectedObj.value.gid = gid || undefined
  // gid 变化时同时清掉旧的「按类型默认形象」标记，避免运行时两边打架
  isDirty.value = true
  render()
  if (tileId) {
    const name = sprite?.label && sprite.label !== `#${tileId}` ? sprite.label : `#${tileId}`
    toast(`形象已换：${name}（tile ${tileId}）`)
  } else {
    toast('形象已恢复默认（按类型）')
  }
}

// ─── 键盘 ───
function onKeyDown(e) {
  if (e.key === 'Shift') { shiftHeld = true; updateCursor() }
  if (e.key === 'Control') { ctrlHeld = true; updateCursor() }
  if (e.key === 'Alt') { altHeld = true; updateCursor() }
  if (e.key === 't' || e.key === 'T') { tHeld = true }

  // ─── 贴图替换模式下的快捷键策略 ───
  // 鼠标交互（Ctrl+左键平移 / 中键·滚轮缩放 / Shift+左键框选 / T 坐标）由 TilesetWorkspace 自行处理，
  // 沿用地图编辑器语义；此处仅保留 Ctrl+S（保存）与 Esc（退出，弹窗约定）。
  // 画布工具键 (V/B/E/P/D/G/C/T)、撤销/重做、删除对象等改图快捷键在此模式下全部抑制，避免误触。
  if (tileStyleMode.value) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); saveCurrentMap(); return
    }
    if (e.key === 'Escape') { e.preventDefault(); exitTileStyle(); return }
    return
  }

  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
  switch (e.key.toLowerCase()) {
    case 'v': setTool('select'); break
    case 'b': setTool('draw'); break
    case 'e': setTool('erase'); break
    case 'p': setTool('place'); break
    case 'd': setTool('erase-obj'); break
    case 'g': showGrid.value = !showGrid.value; render(); break
    case 'c': showCollision.value = !showCollision.value; render(); break
    case 't':
      // ★ T 键（独立按，非组合）→ toggle 坐标显示模式
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        showCoordInspector.value = !showCoordInspector.value
        updateCursor()
        e.preventDefault()
        coordToast(`坐标显示 ${showCoordInspector.value ? '开' : '关'}（左键查看）`)
      }
      break
    case 'z': if (e.ctrlKey || e.metaKey) { e.preventDefault(); undo() } break
    case 'y': if (e.ctrlKey || e.metaKey) { e.preventDefault(); redo() } break
    case 's': if (e.ctrlKey || e.metaKey) { e.preventDefault(); saveCurrentMap() } break
    case 'delete':
    case 'backspace': if (selectedObj.value) deleteSelectedObj(); break
  }
}

function onKeyUp(e) {
  if (e.key === 'Shift') { shiftHeld = false; updateCursor() }
  if (e.key === 'Control') { ctrlHeld = false; updateCursor() }
  if (e.key === 'Alt') { altHeld = false; updateCursor() }
  if (e.key === 't' || e.key === 'T') { tHeld = false }
}

// ★ 坐标显示模式提示（复用现有 toast 系统）
const coordToastMsg = ref('')
let coordToastTimer = 0
function coordToast(msg) {
  coordToastMsg.value = msg
  if (coordToastTimer) clearTimeout(coordToastTimer)
  coordToastTimer = setTimeout(() => { coordToastMsg.value = '' }, 5000)
}

/** 左键单击时若 showCoordInspector 开：显示 (tile x, tile y) + 世界坐标 */
function maybeShowCoord(sx, sy) {
  if (!showCoordInspector.value) return
  if (!currentMap.value) return
  const { tx, ty } = screenToTile(sx, sy)
  const wx = tx - Math.floor(currentMap.value.width / 2)
  const wy = ty - Math.floor(currentMap.value.height / 2)
  coordToast(`tile【json】 (${tx}, ${ty})  世界 (${wx}, ${wy})`)
}

// ─── Canvas resize ───
function resizeCanvas() {
  if (!canvasRef.value || !canvasWrapRef.value) return
  const rect = canvasWrapRef.value.getBoundingClientRect()
  canvasRef.value.width = rect.width
  canvasRef.value.height = rect.height
  render()
}

onMounted(async () => {
  await loadCollections()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('resize', resizeCanvas)
  await nextTick()
  resizeCanvas()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('resize', resizeCanvas)
})

// 渲染触发
watch([zoom, camX, camY, showGrid, showCollision, currentMap, activeLayerIdx, () => tileset.value.loaded], () => {
  render()
})

// ─── Computed ───
const currentMapInfo = computed(() => {
  if (!currentMap.value) return null
  const L = getTileLayer()
  const O = getObjLayer()
  return {
    name: currentMapName.value,
    size: `${currentMap.value.width} × ${currentMap.value.height}`,
    tile: `${currentMap.value.tilewidth}×${currentMap.value.tileheight}`,
    count: L ? L.data.length : 0,
    objs: O ? O.objects.length : 0,
    layers: tileLayers.value.length,
  }
})

const selectedObjInfo = computed(() => {
  if (!selectedObj.value) return null
  const props = propsMap(selectedObj.value)
  return {
    id: selectedObj.value.id,
    props,
    entityType: props.entity_type || 'ITEM',
    // ★ gid：Tiled 对象顶层字段（外观贴图，指向图集）—— 供「形象」选择器回显
    gid: Number(selectedObj.value.gid) || 0,
  }
})

// 修改属性
function onPropInput(key, value) {
  if (!selectedObj.value) return
  if (!selectedObj.value._props) selectedObj.value._props = { ...propsMap(selectedObj.value) }
  selectedObj.value._props[key] = value
}
function onPropApply() {
  if (!selectedObj.value?._props) return
  applyObjProps(selectedObj.value._props)
  selectedObj.value._props = null
  isDirty.value = true
}
</script>

<template>
  <!-- 顶部工具栏 -->
  <div class="toolbar">
    <div class="toolbar-group">
      <button class="btn" @click="loadCollections">📂 刷新</button>
      <button class="btn" @click="openNewCollModal">📁 新建地图集</button>
    </div>
    <div class="sep"></div>
    <span class="coll-name">{{ currentColl?.name || '— 未选择 —' }}</span>
    <div class="sep"></div>
    <div class="toolbar-group">
      <label class="inline">工具：</label>
      <button class="btn" :class="{active: tool==='select'}" @click="setTool('select')" title="选择 (V)，ctrl +左键 移动地图,alt +左键 移动对象,T +左键 查看xy 坐标">🖱</button>
      <button class="btn" :class="{active: tool==='draw'}" @click="setTool('draw')" title="绘制 (B)，Shift+左键连刷">🖌</button>
      <button class="btn" :class="{active: tool==='erase'}" @click="setTool('erase')" title="擦除 (E)">🧹</button>
      <button class="btn" :class="{active: tool==='place'}" @click="setTool('place')" title="放置 (P)">➕</button>
      <button class="btn" :class="{active: tool==='erase-obj'}" @click="setTool('erase-obj')" title="删除对象 (D)">❌</button>
    </div>
    <div class="toolbar-group" v-show="tool==='draw' || tool==='erase'">
      <label class="inline">层：</label>
      <select v-model.number="activeLayerIdx" style="max-width:130px">
        <option v-for="(l, i) in tileLayers" :key="i" :value="i">L{{ i + 1 }}: {{ l.name || '未命名' }}</option>
      </select>
    </div>
    <div class="toolbar-group" v-show="tool==='place'">
      <label class="inline">类型：</label>
      <!-- ★ 可搜索的实体类型选择器：输入关键字过滤（拼音首字/中文/英文 key 都能搜） -->
      <div class="etype-combo" :class="{ open: etypeOpen }">
        <input
          class="etype-input"
          type="text"
          v-model="etypeQuery"
          @focus="etypeOpen = true"
          @blur="onEtypeBlur"
          @keydown.esc="etypeOpen = false"
          @keydown.enter.prevent="pickFirstFiltered"
          :placeholder="etypePlaceholder"
          title="输入关键字搜索实体类型（如：门、NPC、路标）"
        >
        <div class="etype-list" v-show="etypeOpen">
          <div
            v-for="key in filteredEtypes"
            :key="key"
            class="etype-item"
            :class="{ active: key === placingType }"
            @mousedown.prevent="pickEtype(key)"
          >
            <span class="etype-icon">{{ OBJ_META[key].icon }}</span>
            <span class="etype-label">{{ OBJ_META[key].label }}</span>
            <span class="etype-key">{{ key }}</span>
          </div>
          <div class="etype-empty" v-if="!filteredEtypes.length">无匹配类型</div>
        </div>
      </div>
      <select v-model="placingCamp" style="width:60px" v-show="!isTextLikeType">
        <option value="hostile">敌对</option>
        <option value="neutral">中立</option>
        <option value="friendly">友好</option>
      </select>
      <input type="number" v-model.number="placingLevel" min="1" max="999" style="width:46px" title="等级" v-show="!isTextLikeType">
      <!-- 文字类实体的显示文本 -->
      <input
        type="text"
        v-model="placingText"
        v-show="isTextLikeType"
        style="width:130px"
        placeholder="显示文字，如：高三教学楼"
        title="悬浮/贴地显示的文字"
      >
    </div>
    <div class="sep"></div>
    <div class="toolbar-group">
      <button class="btn" :class="{active: showGrid}" @click="showGrid=!showGrid;render()" title="网格 (G)">📏</button>
      <button class="btn" :class="{active: showCollision}" @click="showCollision=!showCollision;render()" title="碰撞 (C)">🧱</button>
      <button class="btn" :disabled="histIdx <= 0" @click="undo" title="撤销 (Ctrl+Z)">↩</button>
      <button class="btn" :disabled="histIdx >= history.length - 1" @click="redo" title="重做 (Ctrl+Y)">↪</button>
    </div>
    <div class="toolbar-group">
      <button class="btn" :class="{active: tileStyleMode}" @click="openTileStyle" title="贴图替换">🎨</button>
      <button class="btn" @click="showModelSettings=true" title="AI 模型设置">⚙️</button>
    </div>
    <div class="sep"></div>
    <div class="toolbar-group">
      <button class="btn" :disabled="!currentMapName || saving" @click="saveCurrentMap" title="保存 (Ctrl+S)">
        {{ saving ? '保存中…' : '💾 保存' }}
      </button>
      <button class="btn" :disabled="!currentMapName" @click="openPreview" title="保存并在游戏中预览">🎮 预览</button>
    </div>
    <div style="flex:1"></div>
    <span style="font-size:10px;color:#444">地图编辑器 v0.3</span>
  </div>

  <!-- 主区域 -->
  <div class="main">
    <!-- 左侧：地图列表 -->
    <div class="map-list-panel">
      <div class="map-list-header">
        <span>📋 {{ currentColl ? currentColl.name : '地图集' }}</span>
        <span style="font-size:10px">{{ currentColl ? currentColl.maps.length + ' 张' : collections.length + ' 个' }}</span>
      </div>

      <!-- 选了地图集：顶部放返回按钮 -->
      <div class="coll-back-row" v-if="currentColl">
        <button class="btn" @click="currentColl = null; currentMap = null; currentMapName = null">← 返回地图集列表</button>
      </div>

      <!-- 未选地图集：列出所有地图集 -->
      <div class="map-list" v-if="!currentColl">
        <div v-if="collectionsLoading" class="map-list-empty">加载中…</div>
        <div v-else-if="collections.length === 0" class="map-list-empty">暂无地图集<br>点击「新建地图集」</div>
        <div
          v-for="c in collections" :key="c.name"
          class="map-item"
          @click="selectCollection(c.name)"
        >
          <span class="icon">📁</span>
          <span class="name">{{ c.name }}</span>
          <span class="meta">{{ c.map_count }}张</span>
        </div>
      </div>

      <!-- 选了地图集：列出地图 -->
      <div class="map-list" v-else>
        <div v-if="!currentColl.maps || currentColl.maps.length === 0" class="map-list-empty">
          暂无地图<br>点击下方 + 添加
        </div>
        <div
          v-for="m in currentColl.maps" :key="m.name"
          class="map-item"
          :class="{selected: m.name === currentMapName}"
          @click="selectMap(m.name)"
        >
          <div class="map-item-line">
           <span class="icon">🗺</span>
            <span class="name">{{ m.display_name }}</span>
            <span class="meta">{{ m.size ? m.size.join('×') : '' }}</span>
            <button class="del-btn" @click.stop="deleteMap(m.name)" title="删除">✕</button>
          </div>
         <div class="map-item-line-little">
          <span class="portal-id" :title="'portal_id / 文件名'">（{{ m.name }}）</span>
         </div>
        </div>
      </div>

      <div class="add-map-row" v-if="currentColl">
        <button class="btn" @click="openNewMapModal" style="width:100%">+ 添加地图</button>
      </div>
    </div>

    <!-- 中间：画布 / 贴图替换图集工作区 -->
    <!-- 注意：canvas 用 v-show 常驻 DOM，不能用 v-if 销毁重建 ——
         模块级缓存的 ctx 会指向已销毁的旧 canvas，导致退出后黑屏、点击无反应 -->
    <div class="canvas-wrap" ref="canvasWrapRef">
      <TilesetWorkspace
        v-if="tileStyleMode && currentMaterial"
        :material-name="currentMaterial"
        :tileset-url="materialTilesetUrl"
        :meta="materialMeta"
        @select="onTileSelected"
        @close="exitTileStyle"
        @reset="onResetTile"
      />
      <canvas
        v-show="!(tileStyleMode && currentMaterial)"
        ref="canvasRef"
        id="canvas"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @wheel="onWheel"
      ></canvas>
    </div>

    <!-- 右侧：属性面板 -->
    <div class="side-panel">
      <div class="panel-section">
        <div class="panel-title">地图信息</div>
        <div class="info-row"><span class="info-key">文件</span><span class="info-val">{{ currentMapInfo?.name || '—' }}</span></div>
        <div class="info-row"><span class="info-key">尺寸</span><span class="info-val">{{ currentMapInfo?.size || '—' }}</span></div>
        <div class="info-row"><span class="info-key">瓦片</span><span class="info-val">{{ currentMapInfo?.tile || '—' }}</span></div>
        <div class="info-row"><span class="info-key">格数</span><span class="info-val">{{ currentMapInfo?.count || '—' }}</span></div>
        <div class="info-row"><span class="info-key">对象</span><span class="info-val">{{ currentMapInfo?.objs || '—' }}</span></div>
        <div class="info-row"><span class="info-key">图层</span><span class="info-val">{{ currentMapInfo?.layers || '—' }} 层</span></div>
      </div>

      <!-- 选中对象属性 -->
      <div class="panel-section" v-if="selectedObjInfo">
        <div class="panel-title">对象属性</div>
        <div class="info-row" style="margin-bottom:6px">
          <span class="info-key">ID</span><span class="info-val">#{{ selectedObjInfo.id }}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">类型</span>
          <select class="prop-input" :value="selectedObjInfo.entityType" @change="(e) => onPropInput('entity_type', e.target.value)">
            <option v-for="key in Object.keys(OBJ_META)" :key="key" :value="key">{{ key }}</option>
          </select>
        </div>
        <div class="prop-row">
          <span class="prop-label">名称</span>
          <input class="prop-input" type="text" :value="selectedObjInfo.props.name || ''" @input="(e) => onPropInput('name', e.target.value)">
        </div>
        <div class="prop-row">
          <span class="prop-label">显示名</span>
          <input class="prop-input" type="text" :value="selectedObjInfo.props.full_name || ''" @input="(e) => onPropInput('full_name', e.target.value)">
        </div>
        <!-- ★ 形象（外观）：从图集里挑人物贴图 → 写 object.gid（runtime 按 gid 出图） -->
        <SpritePicker
          :tileset-img="tileset.img"
          :sprites-data="spritesData"
          :first-gid="firstGid"
          :columns="spritesData?.columns || 120"
          :model-value="selectedObjInfo.gid || 0"
          @pick="onPickSprite"
        />
        <div class="prop-row" v-if="'camp' in selectedObjInfo.props || selectedObjInfo.entityType !== 'LEVEL_TRANSITION'">
          <span class="prop-label">阵营</span>
          <select class="prop-input" :value="selectedObjInfo.props.camp || 'neutral'" @change="(e) => onPropInput('camp', e.target.value)">
            <option value="hostile">hostile</option>
            <option value="neutral">neutral</option>
            <option value="friendly">friendly</option>
          </select>
        </div>
        <div class="prop-row" v-if="'level' in selectedObjInfo.props || selectedObjInfo.entityType !== 'LEVEL_TRANSITION'">
          <span class="prop-label">等级</span>
          <input class="prop-input" type="number" :value="selectedObjInfo.props.level || 1" min="0" @input="(e) => onPropInput('level', parseInt(e.target.value) || 0)">
        </div>
        <div class="prop-row" v-if="'dialog' in selectedObjInfo.props || selectedObjInfo.entityType === 'NPC'">
          <span class="prop-label">对话ID</span>
          <input class="prop-input" type="text" :value="selectedObjInfo.props.dialog || ''" @input="(e) => onPropInput('dialog', e.target.value)">
        </div>
        <div class="prop-row" v-if="'portalID' in selectedObjInfo.props">
          <span class="prop-label">目标地图</span>
          <input class="prop-input" type="text" :value="selectedObjInfo.props.portalID || ''" @input="(e) => onPropInput('portalID', e.target.value)">
        </div>
        <div style="display:flex;gap:4px;margin-top:6px">
          <button class="btn" @click="onPropApply" style="flex:1">应用</button>
          <button class="btn btn-danger" @click="deleteSelectedObj" style="flex:1">删除</button>
        </div>
      </div>

      <!-- 贴图替换面板 -->
      <div class="panel-section" v-if="showTileStylePanel">
        <TileStylePanel
          ref="tileStylePanelRef"
          :selected-tile-id="selectedTileId"
          :selected-tile-ids="selectedTileIds"
          :selected-tile-image="selectedTileImage"
          @replace-tile="onReplaceTile"
          @reset-tile="onResetTile"
        />
      </div>

      <!-- 调色板 -->
      <div class="panel-section">
        <div class="panel-title">调色板</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">
          <button
            v-for="c in PALETTE_CATS" :key="c.key"
            class="palette-cat-btn"
            :class="{active: activeCat === c.key}"
            @click="activeCat = c.key"
          >{{ c.label }}</button>
        </div>
        <div style="font-size:10px;color:var(--dim);margin-bottom:4px">
          笔刷: <span style="color:var(--accent)">{{ brushTileId }}</span>
        </div>
        <div class="palette-tiles" style="flex-wrap:wrap;max-height:140px;overflow-y:auto">
          <div
            v-for="t in visiblePaletteTiles" :key="t.id"
            class="palette-tile"
            :class="{selected: t.id === brushTileId}"
            :title="`${t.id}: ${t.name}${t.blocked ? ' [不可通行]' : ''}`"
            @click="selectTile(t.id)"
            :style="paletteTileStyle(t.id)"
          ></div>
        </div>
      </div>

      <!-- 资源族（data.xlsx 注册表：墙/地板/装饰按族浏览，含全部变体） -->
      <div class="panel-section" v-if="dataSheets">
        <div class="panel-title">资源族（data.xlsx）</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">
          <button
            v-for="(s, i) in dataSheets.sheets" :key="s.name"
            class="palette-cat-btn"
            :class="{active: activeSheetIdx === i}"
            @click="activeSheetIdx = i; activeFamilyId = null"
          >{{ {variants:'墙/地板', decor:'装饰', enemies:'怪物'}[s.kind] || s.name }}</button>
        </div>
        <!-- 怪物表：只读参考 -->
        <div v-if="activeSheet?.kind === 'enemies'" style="font-size:10px;color:var(--dim);max-height:200px;overflow-y:auto">
          <div v-for="en in activeSheet.enemies" :key="en.id" style="padding:2px 0;border-bottom:1px solid #222">
            <b style="color:var(--accent)">{{ en.id }}</b>
            <span style="color:#777"> HP{{ en.hp ?? '?' }} 攻{{ en.str ?? '?' }} 防{{ en.def ?? '?' }}</span>
          </div>
        </div>
        <!-- 族列表：已用族排前，点族名展开变体瓦片 -->
        <template v-else>
          <div style="font-size:10px;color:var(--dim);max-height:210px;overflow-y:auto">
            <div v-for="fam in sheetFamilies" :key="fam.id" style="border-bottom:1px solid #1e1e1e">
              <div
                style="display:flex;align-items:center;gap:6px;padding:3px 2px;cursor:pointer"
                @click="pickFamily(fam)"
              >
                <!-- 族首瓦片缩略 -->
                <div class="palette-tile" style="width:22px;height:22px;flex:none"
                     :style="paletteTileStyle(fam.tiles[0])"></div>
                <span style="flex:1;font-size:11px">
                  {{ fam.name_zh || fam.name }}
                  <span style="color:#555">{{ fam.tiles.length }}瓦</span>
                  <span v-if="fam.used" style="color:var(--accent)"> ✓在用</span>
                </span>
                <span style="color:#555">{{ activeFamilyId === fam.id ? '▾' : '▸' }}</span>
              </div>
              <!-- 展开族：全部变体 -->
              <div v-if="activeFamilyId === fam.id" class="palette-tiles"
                   style="flex-wrap:wrap;max-height:180px;overflow-y:auto;padding:2px 0 6px 26px">
                <div
                  v-for="tid in fam.tiles" :key="tid"
                  class="palette-tile"
                  :class="{selected: tid === brushTileId}"
                  :title="`${tid}: ${fam.name_zh || fam.name}${dawnlike?.tiles?.[tid]?.blocked ? ' [不可通行]' : ''}`"
                  @click="selectTile(tid)"
                  :style="paletteTileStyle(tid)"
                ></div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 快捷键 -->
      <div class="panel-section">
        <div class="panel-title">快捷键</div>
        <div style="font-size:10px;color:#555;line-height:1.9">
          V/B/E/P/D = 工具切换<br>
          G = 网格 &nbsp; C = 碰撞 &nbsp; T = 坐标<br>
          Ctrl+Z/Y = 撤销/重做<br>
          Ctrl+S = 保存<br>
          Del = 删除对象<br>
          滚轮 = 缩放 &nbsp; 中键拖拽 = 平移
        </div>
        <div style="font-size:10px;color:#1976d2;line-height:1.9;margin-top:6px">
          <b>贴图替换模式（与地图编辑器一致）</b><br>
          左键 = 选一格 &nbsp; Shift+左键拖动 = 框选多格<br>
          Ctrl+左键拖动 = 平移 &nbsp; 中键拖动 / 滚轮 = 缩放<br>
          T = 切换坐标（左键查看格行列）<br>
          R = 重置选中格 &nbsp; Esc = 退出
        </div>
      </div>
    </div>
  </div>

  <!-- 底部调色板已合并到右侧 -->

  <!-- 状态栏 -->
  <div class="statusbar">
    <span>工具: {{ {select:'Select',draw:'Draw',erase:'Erase',place:'Place','erase-obj':'EraseObj'}[tool] }}</span>
    <span>缩放: {{ zoom.toFixed(2) }}×</span>
    <span>相机: {{ camX.toFixed(1) }}, {{ camY.toFixed(1) }}</span>
    <span>选中: {{ selectedObjInfo ? (selectedObjInfo.props.full_name || selectedObjInfo.props.name || selectedObjInfo.entityType) : '无' }}</span>
    <span v-if="showCoordInspector" style="color:var(--accent)" title="按 T 切换；开启时左键查看坐标">📍 坐标模式</span>
    <span v-if="coordToastMsg" style="color:var(--accent)">{{ coordToastMsg }}</span>
    <span v-if="error" style="color:var(--red)">⚠ {{ error }}</span>
  </div>

  <!-- 模态框：新建地图集 -->
  <div v-if="showNewCollModal" class="modal-overlay" @click.self="showNewCollModal = false">
    <div class="modal">
      <h3>📁 新建地图集</h3>
      <p>在默认目录 <code style="color:var(--accent)">workshops/.../map_design/</code> 下创建新地图集</p>
      <div class="prop-row" style="margin:12px 0">
        <span class="prop-label">文件夹名</span>
        <input v-model="newCollName" placeholder="例如：新故事地图" autofocus>
      </div>
      <div class="prop-row">
        <span class="prop-label">显示名</span>
        <input v-model="newCollDisplay" placeholder="留空则与文件夹名相同">
      </div>
      <div class="modal-btns">
        <button class="btn" @click="showNewCollModal = false">取消</button>
        <button class="btn active" @click="submitNewCollection">创建</button>
      </div>
    </div>
  </div>

  <!-- 模态框：新建地图 -->
  <div v-if="showNewMapModal" class="modal-overlay" @click.self="showNewMapModal = false">
    <div class="modal">
      <h3>➕ 新建地图</h3>
      <div class="prop-row" style="margin:12px 0">
        <span class="prop-label">文件名</span>
        <input v-model="newMapName" placeholder="mulberryTown" autofocus>
      </div>
      <div class="prop-row">
        <span class="prop-label">显示名</span>
        <input v-model="newMapDisplay" placeholder="Mulberry Town">
      </div>
      <div class="prop-row" style="margin-top:8px">
        <span class="prop-label">尺寸</span>
        <input type="number" v-model.number="newMapW" min="5" max="200" style="width:60px"> ×
        <input type="number" v-model.number="newMapH" min="5" max="200" style="width:60px">
      </div>
      <div class="modal-btns">
        <button class="btn" @click="showNewMapModal = false">取消</button>
        <button class="btn active" @click="submitNewMap">创建</button>
      </div>
    </div>
  </div>

  <!-- 模态框：游戏预览（dev-host --conn 拟真宿主） -->
  <div v-if="showPreviewModal" class="modal-overlay" style="background:rgba(0,0,0,0.85)">
    <div class="modal" style="width:90vw;height:90vh;max-width:none;max-height:none;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h3 style="flex:1;margin:0">🎮 独立预览：{{ currentColl?.name }}</h3>
        <span style="font-size:10px;color:var(--dim)">
          {{ previewLoading ? '正在启动 dev server（独立预览模式，首次约 5-15 秒）…' : '游戏本体直接运行（standalone / mock 宿主，无需鉴权）' }}
        </span>
        <button class="btn" @click="api.devhostStop(); closePreview()" title="停止 dev server">⏹ 停止服务</button>
        <button class="btn" @click="closePreview">✕ 关闭</button>
      </div>
      <div v-if="previewLoading" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:14px">
        ⏳ 启动 vite dev server（STORY={{ currentColl?.name }} CONN=1）…
      </div>
      <div v-else-if="previewUrl" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center">
        <p style="font-size:14px">🎮 预览已在浏览器新标签页打开（独立模式，无需鉴权）。</p>
        <p style="color:var(--dim);font-size:12px">若浏览器拦截了弹窗未自动打开，请手动点击：</p>
        <a :href="previewUrl" target="_blank" rel="noopener" class="btn active" style="max-width:92%;word-break:break-all">{{ previewUrl }}</a>
      </div>
    </div>
  </div>

  <!-- 模型设置弹窗 -->
  <ModelSettingsModal v-if="showModelSettings" @close="showModelSettings = false" @saved="showModelSettings = false" />

  <!-- 贴图替换：地图集选择（作用于当前地图集自己的 compiled_tileset_32x32.png） -->
  <MaterialPicker
    v-if="showMaterialPicker"
    :current-collection="currentColl?.name || ''"
    @select="onMaterialSelected"
    @close="showMaterialPicker = false"
  />

  <!-- 提示 -->
  <div class="toast" :class="{visible: !!toastMsg}">{{ toastMsg }}</div>
</template>