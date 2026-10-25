<script setup>
/**
 * SpritePicker — 实体形象（外观）选择器
 * ====================================
 * 用途：地图编辑器「对象属性」面板里换实体形象（换成别的人物样子）。
 *
 * 背景（2026-10-25）：
 *   runtime 约定（game.md）：**外观由 object.gid 指向图集，entity_type 只决定行为类**。
 *   但编辑器的属性面板只有「类型 / 名称 / 显示名 / 阵营 / 等级 / 对话ID / 目标地图」，
 *   没有任何地方能改 gid → 用户看到的 NPC 形象永远是 OBJ_META.NPC.sprite(4334)，
 *   换不了人。
 *
 *   所以本组件：列出图集里的**人物/怪物动画帧**（含缩略图），
 *   选中后写 object.gid = tileId + firstgid，编辑器画布与 runtime 立即生效。
 *
 * 数据源：GET /api/collections/{name}/sprites
 *   （不能用 /dawnlike —— 那个端点会丢掉全部无 description 的 tile，
 *    而人物动画帧恰好没有 description，只有 animated / animated_id）
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  /** 图集图片（HTMLImageElement），null = 还没加载好 */
  tilesetImg: { type: Object, default: null },
  /** /sprites 接口返回的数据 */
  spritesData: { type: Object, default: null },
  /** Tiled firstgid（gid = tileId + firstgid） */
  firstGid: { type: Number, default: 1 },
  /** 当前对象的 gid（0 = 未设置） */
  modelValue: { type: Number, default: 0 },
  /** 图集列数（用来算 tile 在图里的位置） */
  columns: { type: Number, default: 120 },
})

const emit = defineEmits(['update:modelValue', 'pick'])

const TILE_SIZE = 32
const open = ref(false)
const query = ref('')
const onlyCharacter = ref(true)
const rootRef = ref(null)

// 缩略图缓存：tileId → dataURL（避免每次重绘都 drawImage 一次）
const thumbCache = new Map()

const allSprites = computed(() => props.spritesData?.sprites || [])

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  let list = allSprites.value
  if (onlyCharacter.value) list = list.filter(s => s.category === 'character')
  if (!q) return list
  return list.filter(s =>
    String(s.label).toLowerCase().includes(q) ||
    String(s.id).includes(q))
})

/** 当前选中的 sprite（modelValue 是 gid，反查 tileId） */
const currentTileId = computed(() => {
  const gid = Number(props.modelValue) || 0
  return gid > 0 ? gid - (props.firstGid || 1) : 0
})

const currentSprite = computed(() => {
  const id = currentTileId.value
  if (!id) return null
  return allSprites.value.find(s => s.id === id) || null
})

/** 当前形象缩略图（dataURL） */
const currentThumb = computed(() => {
  const id = currentTileId.value
  if (!id) return ''
  return thumbFor(id)
})

/**
 * 取 tile 缩略图 dataURL。
 * 走 canvas 裁剪 → 放大 2 倍（32px 太小看不清人物）→ toDataURL。
 */
function thumbFor(tileId) {
  if (thumbCache.has(tileId)) return thumbCache.get(tileId)
  const img = props.tilesetImg
  if (!img || !img.width) return ''
  const cols = props.columns || Math.floor(img.width / TILE_SIZE)
  const sx = (tileId % cols) * TILE_SIZE
  const sy = Math.floor(tileId / cols) * TILE_SIZE
  if (sx >= img.width || sy >= img.height) return ''
  const canvas = document.createElement('canvas')
  const SCALE = 2
  canvas.width = TILE_SIZE * SCALE
  canvas.height = TILE_SIZE * SCALE
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false   // 像素风：不要插值模糊
  ctx.drawImage(img, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/png')
  thumbCache.set(tileId, url)
  return url
}

/** 图集换了 → 缩略图缓存作废 */
watch(() => props.tilesetImg, () => { thumbCache.clear() })
watch(() => props.spritesData, () => { thumbCache.clear() })

function pick(sprite) {
  if (!sprite) return
  const gid = sprite.id + (props.firstGid || 1)
  emit('update:modelValue', gid)
  emit('pick', { gid, tileId: sprite.id, sprite })
  open.value = false
}

/** 清空形象（回到「按类型默认」） */
function clearSprite() {
  emit('update:modelValue', 0)
  emit('pick', { gid: 0, tileId: 0, sprite: null })
  open.value = false
}

function onDocClick(e) {
  if (!open.value) return
  if (rootRef.value && !rootRef.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

/** 键盘：↑↓ 选，Enter 确认，Esc 关闭 */
function onKey(e) {
  if (!open.value) return
  if (e.key === 'Escape') { open.value = false; e.stopPropagation() }
}

const countLabel = computed(() => {
  const total = allSprites.value.filter(s => s.category === 'character').length
  return onlyCharacter.value ? `人物 ${total}` : `全部 ${allSprites.value.length}`
})
</script>

<template>
  <div ref="rootRef" class="spk">
    <div class="prop-row">
      <span class="prop-label">形象</span>
      <button class="spk-trigger" @click="open = !open" :title="'选择图集里的人物贴图作为实体外观'">
        <img v-if="currentThumb" :src="currentThumb" class="spk-thumb" alt="">
        <span v-else class="spk-thumb spk-thumb--empty">?</span>
        <span class="spk-trigger__label">
          {{ currentSprite ? (currentSprite.label || ('#' + currentSprite.id)) : '默认（按类型）' }}
        </span>
        <span class="spk-trigger__caret">{{ open ? '▴' : '▾' }}</span>
      </button>
    </div>

    <div v-if="open" class="spk-pop" @keydown="onKey">
      <div class="spk-pop__bar">
        <input
          v-model="query"
          class="spk-search"
          type="text"
          placeholder="搜索名称或 tile id…"
          @keydown.stop="onKey"
        >
        <label class="spk-check">
          <input v-model="onlyCharacter" type="checkbox">
          只看人物
        </label>
        <span class="spk-count">{{ countLabel }}</span>
      </div>

      <div class="spk-grid">
        <button
          v-for="s in filtered"
          :key="s.id"
          class="spk-cell"
          :class="{ 'spk-cell--on': s.id === currentTileId }"
          :title="`${s.label || '#' + s.id}（tile ${s.id}${s.animId ? ' → 帧 ' + s.animId : ''}）`"
          @click="pick(s)"
        >
          <img v-if="thumbFor(s.id)" :src="thumbFor(s.id)" class="spk-cell__img" alt="">
          <span v-else class="spk-cell__img spk-cell__img--empty">{{ s.id }}</span>
          <span class="spk-cell__id">{{ s.id }}</span>
        </button>
        <div v-if="!filtered.length" class="spk-empty">没有匹配的形象</div>
      </div>

      <div class="spk-foot">
        <button class="spk-clear" @click="clearSprite">恢复默认（按类型）</button>
        <span class="spk-hint">形象 = 图集贴图（写 object.gid）；类型只决定行为</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.spk { position: relative; }

/* 触发按钮 */
.spk-trigger {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 3px 6px;
  background: #1a1a1a; color: #e8e8e8;
  border: 1px solid #444; border-radius: 3px;
  cursor: pointer; font-size: 11px; text-align: left;
}
.spk-trigger:hover { border-color: #6a9fd8; }
.spk-thumb {
  width: 22px; height: 22px; flex: none;
  image-rendering: pixelated;
  background: #0d0d0d; border: 1px solid #333;
}
.spk-thumb--empty {
  display: flex; align-items: center; justify-content: center;
  color: #666; font-size: 11px;
}
.spk-trigger__label {
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.spk-trigger__caret { flex: none; color: #888; font-size: 9px; }

/* 弹出面板 */
.spk-pop {
  position: absolute; z-index: 60; right: 0;
  width: 100%; margin-top: 4px;
  background: #161616; border: 1px solid #444; border-radius: 4px;
  box-shadow: 0 6px 22px rgba(0,0,0,.65);
  padding: 6px;
}
.spk-pop__bar { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.spk-search {
  flex: 1; min-width: 0; padding: 3px 6px;
  background: #0d0d0d; color: #e8e8e8;
  border: 1px solid #444; border-radius: 3px; font-size: 11px;
}
.spk-search:focus { outline: none; border-color: #6a9fd8; }
.spk-check { display: flex; align-items: center; gap: 3px; font-size: 10px; color: #aaa; white-space: nowrap; }
.spk-count { font-size: 10px; color: #666; white-space: nowrap; }

/* 缩略图网格 */
.spk-grid {
  display: grid; grid-template-columns: repeat(6, 1fr);
  gap: 4px; max-height: 232px; overflow-y: auto;
  background: #0d0d0d; padding: 4px; border-radius: 3px;
}
.spk-cell {
  position: relative; padding: 2px;
  background: #1c1c1c; border: 1px solid #333; border-radius: 3px;
  cursor: pointer; display: flex; flex-direction: column; align-items: center;
}
.spk-cell:hover { border-color: #6a9fd8; background: #243040; }
.spk-cell--on { border-color: #ffd54f; background: #3a3010; }
.spk-cell__img {
  width: 100%; aspect-ratio: 1; display: block;
  image-rendering: pixelated; background: #0a0a0a;
}
.spk-cell__img--empty {
  display: flex; align-items: center; justify-content: center;
  color: #555; font-size: 8px;
}
.spk-cell__id { font-size: 8px; color: #777; line-height: 1.2; }
.spk-cell--on .spk-cell__id { color: #ffd54f; }
.spk-empty { grid-column: 1 / -1; text-align: center; color: #666; font-size: 11px; padding: 12px 0; }

/* 底部 */
.spk-foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.spk-clear {
  padding: 2px 8px; font-size: 10px; cursor: pointer;
  background: #2a1a1a; color: #e08a8a;
  border: 1px solid #633; border-radius: 3px;
}
.spk-clear:hover { background: #3a2020; }
.spk-hint { font-size: 9px; color: #666; flex: 1; text-align: right; }
</style>
