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
}