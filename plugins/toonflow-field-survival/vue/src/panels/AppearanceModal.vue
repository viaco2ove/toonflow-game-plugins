<script setup lang="ts">
/**
 * ★ 实体形象弹窗（系统 → 角色 → 实体形象）
 *
 * 三个来源：
 *   1) 预选：player_sprites 内置像素形象（点击即绑定）
 *   2) AI 生成：提示词 + 可选参考图（内置形象 / 角色头像 / 上传图片，≤3 张）
 *   3) 我的生成：生成结果图库 —— 可选用为「用户」或任意角色，可删除
 *
 * 所有落库动作都走 App.vue → runSysCmd → entry.ts（sys_sprite_*），
 * 本组件只负责交互与图片压缩，不直接改 state。
 */
import { computed, ref, watch } from "vue";
import { SPRITE_PRESETS } from "../spritePresets";
import { resolveAssetPath } from "../assets";

interface Target {
  id: string;
  name: string;
  avatarPath?: string;
  isPlayer?: boolean;
}

const props = defineProps<{
  open: boolean;
  targetId: string;
  targets: Target[];
  gallery: any[];
  /** 角色 → 绑定条目（含 image / prompt / source / createdAt） */
  binds: Record<string, { image: string; prompt?: string; source?: string; createdAt?: number }>;
  gen: { status?: string; message?: string } | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "pick-target", id: string): void;
  /** 绑定：image 是 data:URL 或插件内相对路径；source/prompt 透传给后端 */
  (e: "bind", target: string, image: string, meta?: { source?: string; prompt?: string; createdAt?: number }): void;
  (e: "unbind", target: string): void;
  (e: "generate", prompt: string, refs: string[]): void;
  (e: "delete", id: string): void;
  (e: "clear"): void;
  /** 上传图片并立即绑定（不走 AI） */
  (e: "upload-bind", target: string, dataUrl: string): void;
}>();

const MAX_REFS = 3;

const tab = ref<"preset" | "ai" | "mine">("preset");
const prompt = ref("银发黑衣的游侠，背负长弓，眼神冷峻，2.5D 俯视像素风");
/** 参考图：preset = 内置形象路径；upload = 已压成 data:URL 的上传图；avatar = 角色头像 */
const refs = ref<Array<{ key: string; url: string; kind: "preset" | "upload" | "avatar" }>>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const uploadFileInput = ref<HTMLInputElement | null>(null);
const preparing = ref(false);

const busy = computed(() => String(props.gen && props.gen.status || "") === "running");
const current = computed<Target | null>(() => props.targets.find((t) => t.id === props.targetId) || null);
const currentAvatar = computed(() => (current.value && current.value.avatarPath) || "");
/** ★ 实体形象预览位只展示「已绑定的实体形象」；无绑定时显示占位（默认形象由 canvas tileset 渲染）。
 *  禁止回落展示角色头像——实体形象与悬浮头像是两个独立通道（用户明确要求）。 */
const currentImage = computed(() => {
  const b = (props.binds || {})[props.targetId];
  if (b && b.image) return b.image;
  return "";
});
const hasBind = computed(() => !!(props.binds || {})[props.targetId]);
const gallery = computed(() => (Array.isArray(props.gallery) ? props.gallery : []));
const extraRefs = computed(() => refs.value.filter((r) => r.kind !== "preset"));

function imgSrc(p: string): string {
  return p ? resolveAssetPath(p) : "";
}
function isRefOn(key: string): boolean {
  return refs.value.some((r) => r.key === key);
}
function togglePresetRef(p: { id: string; path: string }): void {
  const key = "preset:" + p.id;
  const i = refs.value.findIndex((r) => r.key === key);
  if (i >= 0) { refs.value.splice(i, 1); return; }
  if (refs.value.length >= MAX_REFS) return;
  refs.value.push({ key, url: p.path, kind: "preset" });
}
function removeRef(key: string): void {
  const i = refs.value.findIndex((r) => r.key === key);
  if (i >= 0) refs.value.splice(i, 1);
}
/** 直接把当前目标角色的头像作为参考图（用户要求：可上传，也可直接用角色头像） */
function toggleAvatarRef(): void {
  const key = "avatar:" + props.targetId;
  const i = refs.value.findIndex((r) => r.key === key);
  if (i >= 0) { refs.value.splice(i, 1); return; }
  if (refs.value.length >= MAX_REFS) return;
  const p = currentAvatar.value;
  if (!p) return;
  refs.value.push({ key, url: p, kind: "avatar" });
}
function onPickTarget(ev: Event): void {
  const v = (ev.target as HTMLSelectElement).value;
  if (v) emit("pick-target", v);
}
function pickFile(): void {
  if (fileInput.value) fileInput.value.click();
}
function pickUploadFile(): void {
  // ★ 上传作为形象：单独走隐藏 input（避免与「上传参考图」共用而误进 refs）
  if (uploadFileInput.value) uploadFileInput.value.click();
}

async function onUploadFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const f = input.files && input.files[0];
  input.value = "";
  if (!f || !/^image\//i.test(f.type || "")) return;
  try {
    const data = await shrinkImage(f);
    // 单图直接作为「形象」上传并绑定，不进 refs
    emit("upload-bind", props.targetId, data);
  } catch { /* 上传失败不提示，安静忽略 */ }
}

/** 上传图压到 ≤512px 的 JPEG：参考图不需要原图，压完 data:URL 约 20~60KB */
function shrinkImage(file: File, max = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || 1) * scale));
          const h = Math.max(1, Math.round((img.height || 1) * scale));
          const cv = document.createElement("canvas");
          cv.width = w;
          cv.height = h;
          const cx = cv.getContext("2d");
          if (!cx) return reject(new Error("canvas 不可用"));
          cx.drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", 0.85));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = String(fr.result || "");
    };
    fr.onerror = () => reject(new Error("读取失败"));
    fr.readAsDataURL(file);
  });
}

async function onFiles(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  for (const f of files) {
    if (refs.value.length >= MAX_REFS) break;
    if (!/^image\//i.test(f.type || "")) continue;
    try {
      const data = await shrinkImage(f);
      refs.value.push({
        key: "up:" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        url: data,
        kind: "upload",
      });
    } catch { /* 单张失败不影响其它 */ }
  }
}

/** 内置形象是插件内路径，后端读不到 → 生成前统一转 data:URL */
async function fetchAsDataUrl(url: string): Promise<string> {
  if (!url) throw new Error("空路径");
  if (url.startsWith("data:")) return url;
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const b = await r.blob();
  return await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ""));
    fr.onerror = () => rej(new Error("读取失败"));
    fr.readAsDataURL(b);
  });
}

async function onGenerate(): Promise<void> {
  const text = prompt.value.trim();
  if (!text || busy.value || preparing.value) return;
  preparing.value = true;
  try {
    const list: string[] = [];
    for (const r of refs.value) {
      try {
        list.push(await fetchAsDataUrl(imgSrc(r.url)));
      } catch { /* 单张参考图失败 → 跳过 */ }
    }
    emit("generate", text, list);
  } finally {
    preparing.value = false;
  }
}

/** 生成完成 → 自动切到「我的生成」，让用户马上看到结果 */
watch(
  () => String(props.gen && props.gen.status || ""),
  (st) => {
    if (st === "done") tab.value = "mine";
  },
);

/** 每次打开都回到预选页，避免上次的提示词/参考图误用 */
watch(
  () => props.open,
  (on) => {
    if (!on) return;
    tab.value = "preset";
    preparing.value = false;
  },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="apm-mask" @pointerdown.self="emit('close')">
      <div class="apm" @pointerdown.stop>
        <div class="apm-head">
          <span class="apm-title">实体形象</span>
          <select class="apm-sel" :value="targetId" @change="onPickTarget">
            <option v-for="t in targets" :key="t.id" :value="t.id">
              {{ t.isPlayer ? "用户 · " : "" }}{{ t.name }}
            </option>
          </select>
          <button class="apm-btn apm-btn--upload" title="选一张本地图片直接作为该角色的实体形象" @click="pickUploadFile">📁 上传</button>
          <button class="apm-x" title="关闭" @click="emit('close')">×</button>
        </div>

        <div class="apm-preview">
          <img v-if="currentImage" class="apm-cur" :src="imgSrc(currentImage)" alt="" />
          <div v-else class="apm-cur apm-cur--ph">?</div>
          <div class="apm-prev-main">
            <div class="apm-prev-name">{{ current ? current.name : "未选择角色" }}</div>
            <div class="apm-prev-tip">{{ hasBind ? "已使用自定义实体形象" : "当前为默认实体形象" }}</div>
            <button v-if="hasBind" class="apm-btn apm-btn--ghost" @click="emit('unbind', targetId)">恢复默认实体形象</button>
          </div>
        </div>

        <div class="apm-tabs">
          <button class="apm-tab" :class="{ 'apm-tab--on': tab === 'preset' }" @click="tab = 'preset'">预选形象</button>
          <button class="apm-tab" :class="{ 'apm-tab--on': tab === 'ai' }" @click="tab = 'ai'">AI 生成</button>
          <button class="apm-tab" :class="{ 'apm-tab--on': tab === 'mine' }" @click="tab = 'mine'">
            我的生成 ({{ gallery.length }})
          </button>
        </div>

        <div class="apm-body">
          <!-- ① 预选：player_sprites 内置形象 -->
          <div v-if="tab === 'preset'" class="apm-grid">
            <button
              v-for="p in SPRITE_PRESETS"
              :key="p.id"
              class="apm-cell"
              :class="{ 'apm-cell--on': currentImage === p.path }"
              :title="p.label + '（点击使用）'"
              @click="emit('bind', targetId, p.path, { source: 'preset' })"
            >
              <img :src="imgSrc(p.path)" alt="" />
            </button>
          </div>

          <!-- ② AI 生成 -->
          <div v-else-if="tab === 'ai'" class="apm-ai">
            <textarea
              v-model="prompt"
              class="apm-ta"
              rows="3"
              maxlength="300"
              placeholder="描述想要的形象，例如：银发黑衣的游侠，背负长弓，眼神冷峻，2.5D 俯视像素风"
            ></textarea>
            <div class="apm-refs-head">参考图（最多 {{ MAX_REFS }} 张：可点内置形象、用角色头像、或上传）</div>
            <div class="apm-grid apm-grid--refs">
              <button
                v-for="p in SPRITE_PRESETS"
                :key="'r' + p.id"
                class="apm-cell apm-cell--ref"
                :class="{ 'apm-cell--on': isRefOn('preset:' + p.id) }"
                :title="'作为参考：' + p.label"
                @click="togglePresetRef(p)"
              >
                <img :src="imgSrc(p.path)" alt="" />
              </button>
            </div>
            <div v-if="extraRefs.length" class="apm-ups">
              <div v-for="r in extraRefs" :key="r.key" class="apm-up">
                <img :src="r.kind === 'avatar' ? imgSrc(r.url) : r.url" alt="" />
                <button class="apm-up__x" title="移除" @click="removeRef(r.key)">×</button>
              </div>
            </div>
            <div class="apm-ai-ops">
              <button
                class="apm-btn apm-btn--ghost"
                :disabled="!currentAvatar || isRefOn('avatar:' + targetId) || refs.length >= MAX_REFS"
                title="把当前角色的头像作为外观参考发给图片模型"
                @click="toggleAvatarRef"
              >用角色头像作参考</button>
              <button class="apm-btn apm-btn--ghost" :disabled="refs.length >= MAX_REFS" @click="pickFile">上传参考图</button>
              <span class="apm-count">{{ refs.length }}/{{ MAX_REFS }}</span>
              <button
                class="apm-btn apm-btn--go"
                :disabled="busy || preparing || !prompt.trim()"
                @click="onGenerate"
              >
                {{ busy ? "生成中…" : (preparing ? "准备参考图…" : "生成形象") }}
              </button>
            </div>
            <div v-if="busy" class="apm-tip">图片模型推理通常需要 30~90 秒，请勿关闭面板…</div>
            <div v-else-if="gen && gen.status === 'error'" class="apm-tip apm-tip--err">
              上次生成失败：{{ gen.message || "未知错误" }}
            </div>
            <div v-else class="apm-tip apm-tip--dim">
              参考图会作为「角色外观参考」发给图片模型；只用文字也能生成。
            </div>
            <input ref="fileInput" class="apm-file" type="file" accept="image/*" multiple @change="onFiles" />
            <input ref="uploadFileInput" class="apm-file" type="file" accept="image/*" @change="onUploadFile" />
          </div>

          <!-- ③ 我的生成 -->
          <div v-else class="apm-mine">
            <div v-if="!gallery.length" class="apm-empty">还没有生成过形象。切到「AI 生成」试试。</div>
            <div v-else class="apm-grid">
              <div v-for="g in gallery" :key="g.id" class="apm-gitem">
                <img :src="imgSrc(g.image)" alt="" />
                <div class="apm-gitem__ops">
                  <button class="apm-btn apm-btn--mini" @click="emit('bind', targetId, g.image, { source: g.source || 'ai', prompt: g.prompt, createdAt: g.createdAt })">选用</button>
                  <button class="apm-btn apm-btn--mini apm-btn--del" @click="emit('delete', g.id)">删除</button>
                </div>
                <div class="apm-gitem__p" :title="g.prompt">
                  <span v-if="g.matting && g.matting !== 'skipped'" class="apm-gitem__m" :title="'背景已透明化（' + g.matting + '）'">透明底</span>
                  {{ g.prompt }}
                </div>
              </div>
            </div>
            <div v-if="gallery.length" class="apm-mine-foot">
              <button class="apm-btn apm-btn--del" @click="emit('clear')">清空全部</button>
            </div>
          </div>
        </div>

        <div class="apm-foot">形象只影响外观，不改角色属性；绑定会随存档持久化（刷新不丢）。</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.apm-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(6, 10, 16, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.apm {
  width: min(560px, 96vw);
  max-height: min(680px, 92vh);
  display: flex;
  flex-direction: column;
  background: #141b24;
  border: 1px solid rgba(120, 170, 230, 0.35);
  border-radius: 10px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
  color: #e8eef5;
  font-size: 13px;
  overflow: hidden;
}
.apm-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  background: rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.apm-title { font-weight: 700; }
.apm-sel {
  margin-left: auto;
  max-width: 190px;
  background: #1d2733;
  color: #e8eef5;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
}
.apm-x {
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.08);
  color: #cfd8e3;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.apm-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.apm-cur {
  width: 76px;
  height: 76px;
  border-radius: 8px;
  object-fit: cover;
  background: #1d2733;
  border: 1px solid rgba(255, 255, 255, 0.14);
  image-rendering: pixelated;
}
.apm-cur--ph { display: flex; align-items: center; justify-content: center; color: #6f7d8d; font-size: 22px; }
.apm-prev-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.apm-prev-name { font-weight: 700; }
.apm-prev-tip { font-size: 11px; color: #93a2b3; }
.apm-tabs {
  display: flex;
  gap: 4px;
  padding: 7px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.apm-tab {
  flex: 1 1 0;
  padding: 5px 4px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #cfd8e3;
  font-size: 12px;
  cursor: pointer;
}
.apm-tab--on { background: #2f6fd0; border-color: #5a9bff; color: #fff; }
.apm-body { flex: 1 1 auto; overflow: auto; padding: 10px; }
.apm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 6px;
}
.apm-grid--refs { grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); max-height: 132px; overflow: auto; }
.apm-cell {
  aspect-ratio: 1 / 1;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.apm-cell img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.apm-cell--on { border-color: #5a9bff; background: rgba(90, 155, 255, 0.2); box-shadow: 0 0 0 1px #5a9bff inset; }
.apm-cell--ref.apm-cell--on { border-color: #ffd76a; box-shadow: 0 0 0 1px #ffd76a inset; }
.apm-ai { display: flex; flex-direction: column; gap: 7px; }
.apm-ta {
  width: 100%;
  resize: vertical;
  min-height: 62px;
  background: #0f151d;
  color: #e8eef5;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  padding: 7px 8px;
  font-size: 12px;
  line-height: 1.5;
  font-family: inherit;
}
.apm-ta:focus { outline: none; border-color: #5a9bff; }
.apm-refs-head { font-size: 11px; color: #93a2b3; }
.apm-ups { display: flex; gap: 6px; flex-wrap: wrap; }
.apm-up { position: relative; width: 52px; height: 52px; }
.apm-up img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.18); }
.apm-up__x {
  position: absolute;
  right: -5px;
  top: -5px;
  width: 17px;
  height: 17px;
  padding: 0;
  border-radius: 50%;
  border: none;
  background: #b8433f;
  color: #fff;
  font-size: 12px;
  line-height: 17px;
  cursor: pointer;
}
.apm-ai-ops { display: flex; align-items: center; gap: 8px; }
.apm-count { font-size: 11px; color: #93a2b3; margin-right: auto; }
.apm-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #5a9bff;
  background: #2f6fd0;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.apm-btn:disabled { border-color: #3d4650; background: #333c46; color: #7d8896; cursor: not-allowed; }
.apm-btn--ghost { border-color: rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.06); color: #cfd8e3; }
.apm-btn--go { min-width: 96px; }
.apm-btn--mini { padding: 2px 6px; font-size: 11px; }
.apm-btn--upload { padding: 2px 8px; font-size: 11px; border-color: #5a9bff; background: rgba(90, 155, 255, 0.15); color: #cfe2ff; }
.apm-btn--del { border-color: #a4443f; background: #7d2f2b; }
.apm-tip { font-size: 11px; color: #9fd0ff; }
.apm-tip--err { color: #ff9c9c; }
.apm-tip--dim { color: #93a2b3; }
.apm-file { display: none; }
.apm-empty { color: #93a2b3; font-size: 12px; padding: 18px 4px; text-align: center; }
.apm-gitem {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.apm-gitem > img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 5px;
  background: #0f151d;
}
.apm-gitem__ops { display: flex; gap: 3px; }
.apm-gitem__ops .apm-btn { flex: 1 1 0; padding: 2px 2px; font-size: 10px; }
.apm-gitem__p {
  font-size: 10px;
  color: #8c9aab;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.apm-gitem__m {
  display: inline-block;
  margin-right: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(63, 176, 122, 0.22);
  border: 1px solid rgba(63, 176, 122, 0.45);
  color: #8fe0b8;
  font-size: 9px;
}
.apm-mine-foot { margin-top: 8px; display: flex; justify-content: flex-end; }
.apm-foot {
  padding: 6px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: #93a2b3;
  font-size: 11px;
}
</style>
