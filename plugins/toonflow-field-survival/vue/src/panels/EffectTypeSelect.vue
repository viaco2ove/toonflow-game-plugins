<script setup lang="ts">
/**
 * ★ V2_2（2026-11-13）改造1：属性特效「带图标」下拉框
 * ------------------------------------------------------------------
 * 需求（技能特效设计/V2/V2_2.md 改造1）：
 *   · 下拉框把图标也显示出来（原生 <select> 画不了图片 → 自定义下拉）
 *   · 图标 = effects_type 对应的 spells 26×26 像素图（与特效内叠加的同一批）
 *
 * 交互：点开 → 图标+文字的列表（网格两列）→ 点选 → 回传 v-model。
 * 图标走 spellIcon 缓存 + resolveAssetPath（getAsset 安装态自动拼 token）。
 */
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { EFFECT_ICON, spellIcon } from "../spellIcon";

const props = defineProps<{ modelValue?: string }>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

/** 选项列表（与 SkillPanel/BagPanel 原下拉同序） */
const OPTIONS: Array<{ v: string; label: string }> = [
  { v: "", label: "默认" },
  { v: "normal", label: "普通" },
  { v: "fire", label: "火" }, { v: "water", label: "水" }, { v: "thunder", label: "雷" },
  { v: "wind", label: "风" }, { v: "earth", label: "土" }, { v: "metal", label: "金" }, { v: "wood", label: "木" },
  { v: "light", label: "光明" }, { v: "dark", label: "黑暗" },
  { v: "bleed", label: "出血" }, { v: "poison", label: "毒素" },
];

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const current = computed(() => OPTIONS.find((o) => o.v === (props.modelValue || "")) || OPTIONS[0]);
const iconOf = (v: string) => EFFECT_ICON[v] || "";

function toggle() { open.value = !open.value; }
function pick(v: string) {
  emit("update:modelValue", v);
  open.value = false;
}
/** 图标已就绪则返回 true（spellIcon 未加载完返回 null → 显示占位底色） */
function iconReady(v: string): boolean {
  const p = EFFECT_ICON[v];
  if (!p) return false;
  return !!spellIcon(p);
}
function iconSrc(v: string): string {
  return EFFECT_ICON[v] || "";
}
function onDocClick(ev: MouseEvent) {
  if (!open.value) return;
  if (rootEl.value && !rootEl.value.contains(ev.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div ref="rootEl" class="ets">
    <button type="button" class="ets-btn" @click="toggle">
      <img v-if="iconOf(current.v)" class="ets-ico" :src="iconSrc(current.v)" alt="" />
      <span class="ets-ico ets-ico--empty" v-else></span>
      <span>{{ current.label }}（{{ current.v || "空" }}）</span>
    </button>
    <div v-if="open" class="ets-pop">
      <button v-for="o in OPTIONS" :key="o.v" type="button" class="ets-opt"
              :class="{ 'ets-opt--on': o.v === (modelValue || '') }" @click="pick(o.v)">
        <img v-if="iconOf(o.v)" class="ets-ico" :src="iconSrc(o.v)" alt="" />
        <span class="ets-ico ets-ico--empty" v-else></span>
        <span class="ets-lb">{{ o.label }}</span>
        <span class="ets-key">{{ o.v || "空" }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ets { position: relative; display: block; }
.ets-btn {
  display: flex; align-items: center; gap: 5px; width: 100%;
  background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px; color: #e6eef6; font-size: 11px; padding: 3px 6px; cursor: pointer;
  text-align: left;
}
.ets-btn:hover { border-color: rgba(255, 255, 255, 0.32); }
.ets-pop {
  position: absolute; z-index: 30; top: calc(100% + 2px); left: 0; right: 0;
  background: #10151c; border: 1px solid rgba(255,255,255,0.22); border-radius: 6px;
  padding: 4px; display: grid; grid-template-columns: 1fr 1fr; gap: 3px;
  box-shadow: 0 8px 20px rgba(0,0,0,.5); max-height: 240px; overflow-y: auto;
}
.ets-opt {
  display: flex; align-items: center; gap: 5px;
  background: rgba(255,255,255,0.04); border: 1px solid transparent;
  border-radius: 4px; color: #cfd8e3; font-size: 11px; padding: 4px 5px; cursor: pointer;
  text-align: left;
}
.ets-opt:hover { background: rgba(255,255,255,0.1); }
.ets-opt--on { border-color: rgba(120, 180, 255, 0.7); color: #fff; }
.ets-ico { width: 18px; height: 18px; image-rendering: pixelated; flex: 0 0 auto; }
.ets-ico--empty { display: inline-block; background: rgba(255,255,255,0.12); border-radius: 3px; }
.ets-lb { flex: 1 1 auto; }
.ets-key { color: #6d7c8c; font-size: 9px; }
</style>
