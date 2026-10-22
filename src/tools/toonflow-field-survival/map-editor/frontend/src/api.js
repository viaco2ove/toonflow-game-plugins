// 地图编辑器后端 API 客户端
const BASE = 'http://127.0.0.1:8000/api'

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const e = await res.json(); msg = e.detail || msg } catch {}
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // 地图集
  listCollections: () => req('/collections'),
  getCollection: (name) => req(`/collections/${encodeURIComponent(name)}`),
  createCollection: (name, displayName) => req('/collections', {
    method: 'POST',
    body: JSON.stringify({ name, display_name: displayName }),
  }),
  deleteCollection: (name) => req(`/collections/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // 地图
  getMap: (coll, map) => req(`/collections/${encodeURIComponent(coll)}/maps/${encodeURIComponent(map)}`),
  saveMap: (coll, map, data) => req(`/collections/${encodeURIComponent(coll)}/maps/${encodeURIComponent(map)}`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  createMap: (coll, name, displayName, width, height) => req(`/collections/${encodeURIComponent(coll)}/maps`, {
    method: 'POST',
    body: JSON.stringify({ name, display_name: displayName, width, height }),
  }),
  deleteMap: (coll, map) => req(`/collections/${encodeURIComponent(coll)}/maps/${encodeURIComponent(map)}`, {
    method: 'DELETE',
  }),

  // 资源（返回 URL，不是 JSON）
  tilesetUrl: (coll) => `${BASE}/collections/${encodeURIComponent(coll)}/tileset`,
  dawnlikeUrl: (coll) => `${BASE}/collections/${encodeURIComponent(coll)}/dawnlike`,
  dawnlike: (coll) => req(`/collections/${encodeURIComponent(coll)}/dawnlike`),
  dataSheets: (coll) => req(`/collections/${encodeURIComponent(coll)}/data-sheets`),

  // dev-host（--conn 拟真宿主预览）
  devhostStart: (coll) => req(`/devhost/start?name=${encodeURIComponent(coll)}`, { method: 'POST' }),
  devhostStatus: () => req('/devhost/status'),
  devhostStop: () => req('/devhost/stop', { method: 'POST' }),

  // Tile Style Change
  generateTile: (data) => req('/tile-style/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // 素材集（compiled_tileset_32x32）
  listMaterials: () => req('/tile-style/materials'),
  getMaterialMeta: (name) => req(`/tile-style/materials/${encodeURIComponent(name)}/meta`),
  getMaterialTilesetUrl: (name) => `${BASE}/tile-style/materials/${encodeURIComponent(name)}/tileset`,

  // 覆盖落盘
  saveOverride: (data) => req('/tile-style/override', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // ── AI 模型配置（复刻 app t_config + 槽位绑定）──
  listModels: (type) => req(`/ai/models${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  addModel: (data) => req('/ai/models', { method: 'POST', body: JSON.stringify(data) }),
  updateModel: (id, data) => req(`/ai/models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteModel: (id) => req(`/ai/models/${id}`, { method: 'DELETE' }),
  getBindings: () => req('/ai/bindings'),
  bindSlot: (slot, configId) => req('/ai/bindings', {
    method: 'POST', body: JSON.stringify({ slot, configId }),
  }),
  testModel: (data) => req('/ai/test', { method: 'POST', body: JSON.stringify(data) }),

  // ── 背景分离模型（复刻 app localAvatarMatting）──
  listMattingModels: () => req('/matting/models'),
  getMattingStatus: (data) => req('/matting/status', {
    method: 'POST', body: JSON.stringify(data || {}),
  }),
  installMatting: (data) => req('/matting/install', {
    method: 'POST', body: JSON.stringify(data || {}),
  }),
  runMatting: (data) => req('/matting/run', {
    method: 'POST', body: JSON.stringify(data),
  }),
}