// 地图编辑器后端 API 客户端
const BASE = 'http://127.0.0.1:8000/api'

async function req(path, options = {}) {
  // ★ 默认禁缓存：编辑器读的都是会被外部改写的磁盘文件（地图 JSON / 图集 / dawnlike），
  //   fetch 默认会走 HTTP 缓存 → 存了旧版本却以为没变。
  //   POST 一律绕过缓存（options.cache = 'no-store'）。
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
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
  // ★ tilesetUrl 必须带 cache-busting 参数：
  //   图集 PNG 内容会变（补瓦片/贴图替换），但路径固定 → 浏览器按 etag 缓存住旧图集，
  //   编辑器就会用「旧图集 + 新地图数据」渲染 → 新 gid 在旧图集里是空槽 → 棋盘格空洞。
  //   加 ?_=<时间戳> 强制每次重新拉取。
  tilesetUrl: (coll) => `${BASE}/collections/${encodeURIComponent(coll)}/tileset?_=${Date.now()}`,
  dawnlikeUrl: (coll) => `${BASE}/collections/${encodeURIComponent(coll)}/dawnlike?_=${Date.now()}`,
  dawnlike: (coll) => req(`/collections/${encodeURIComponent(coll)}/dawnlike?_=${Date.now()}`),
  // ★ 人物/怪物动画帧清单（换实体形象用；/dawnlike 不含无 description 的人物帧）
  sprites: (coll) => req(`/collections/${encodeURIComponent(coll)}/sprites?_=${Date.now()}`),
  dataSheets: (coll) => req(`/collections/${encodeURIComponent(coll)}/data-sheets?_=${Date.now()}`),

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

  // 重置某格到覆盖前（后端从 overrides/originals 存档恢复 + 删 styleOverrides 条目）
  resetTile: (data) => req('/tile-style/reset', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // ── 系列换皮（tile-style-change v2：以对象/系列为单位）──
  listSeries: (material) => req(`/tile-style/series?material=${encodeURIComponent(material)}`),
  suggestSeries: (material, message) => req('/tile-style/series/suggest', {
    method: 'POST', body: JSON.stringify({ material, message }),
  }),
  recolorSeries: (material, group, palettes) => req('/tile-style/series/recolor', {
    method: 'POST', body: JSON.stringify({ material, group, palettes }),
  }),
  applySeries: (material, group, tiles) => req('/tile-style/series/apply', {
    method: 'POST', body: JSON.stringify({ material, group, tiles }),
  }),
  revertSeries: (material, group) => req('/tile-style/series/revert', {
    method: 'POST', body: JSON.stringify({ material, group }),
  }),
  seriesPreview: (material, group) => req('/tile-style/series/preview', {
    method: 'POST', body: JSON.stringify({ material, group }),
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