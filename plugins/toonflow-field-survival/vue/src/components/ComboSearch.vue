<template>
  <div class="cs" :class="{ 'cs--open': open }">
    <input
      ref="inputEl"
      class="cs__input"
      :value="modelValue"
      :placeholder="placeholder"
      @input="onInput"
      @focus="openList"
      @keydown.enter.prevent="pickFirst"
      @keydown.esc.prevent="open = false"
    />
    <button class="cs__arrow" type="button" tabindex="-1" @click.prevent="toggleList">▾</button>
    <div v-if="open" class="cs__list" :style="{ maxHeight: (maxHeight || 180) + 'px' }">
      <div v-if="!filtered.length" class="cs__none">无匹配项（可直接手输）</div>
      <div
        v-for="(o, i) in filtered"
        :key="o.value + i"
        class="cs__opt"
        :class="{ 'cs__opt--hl': i === 0 }"
        @mousedown.prevent="pick(o)"
      >
        <span class="cs__opt__label">{{ o.label }}</span>
        <span v-if="o.desc" class="cs__opt__desc">{{ o.desc }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ComboSearch —— 可搜索下拉框（2026-11-16，行为链表单「NPC 名/区域名」改造，用户需求）
 * ==============================================================
 * 输入框 + 下拉候选 + 关键字过滤；同时保留**自由手输**（候选没有的名字照旧可填，
 * 行为链允许指向场上暂无的 NPC）。点击选项把 option.value 写回 modelValue。
 * 选项 value 约定 = 要写入输入框的文本（行为链按名字解析目标，故 value 即名字）。
 */
import { ref, computed } from "vue";

export interface ComboOption {
  /** 选中后写回输入框的文本 */
  value: string;
  /** 下拉列表里显示的主文本 */
  label: string;
  /** 右侧次要说明（距离/等级/HP 等） */
  desc?: string;
}

const props = defineProps<{
  modelValue: string;
  options: ComboOption[];
  placeholder?: string;
  maxHeight?: number;
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const inputEl = ref<HTMLInputElement | null>(null);
const open = ref(false);
/** 输入框当前文本（过滤关键字；选中后与 modelValue 同步） */
const draft = ref("");

const filtered = computed<ComboOption[]>(() => {
  const kw = draft.value.trim().toLowerCase();
  const src = props.options || [];
  if (!kw) return src.slice(0, 80);
  const hit = src.filter(
    (o) => o.label.toLowerCase().includes(kw) || o.value.toLowerCase().includes(kw) || (o.desc || "").toLowerCase().includes(kw),
  );
  return hit.slice(0, 80);
});

function openList(): void {
  draft.value = String(props.modelValue || "");
  open.value = true;
}
function toggleList(): void {
  if (open.value) { open.value = false; return; }
  inputEl.value?.focus();
  openList();
}
function onInput(e: Event): void {
  const v = (e.target as HTMLInputElement).value;
  draft.value = v;
  emit("update:modelValue", v);
  open.value = true;
}
function pick(o: ComboOption): void {
  emit("update:modelValue", o.value);
  draft.value = o.value;
  open.value = false;
  inputEl.value?.blur();
}
function pickFirst(): void {
  if (open.value && filtered.value.length) pick(filtered.value[0]);
  else open.value = false;
}
</script>

<style scoped>
/* 容器占 flex:1（面板 .bc-row 内与 .bc-input 同宽） */
.cs { position: relative; flex: 1; min-width: 0; }
.cs__input { flex: 1; width: 100%; background: #1a1c24; color: #e8eaf2; border: 1px solid #454b60; border-radius: 6px; padding: 5px 24px 5px 8px; font-size: 13px; outline: none; box-sizing: border-box; }
.cs__input:focus { border-color: #4a7bd6; }
.cs__arrow {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: #9aa0b5; font-size: 11px; cursor: pointer; padding: 2px 4px;
}
.cs__arrow:hover { color: #fff; }
.cs__list {
  position: absolute; left: 0; right: 0; top: calc(100% + 3px); z-index: 30;
  background: #20232c; border: 1px solid #4a4f63; border-radius: 7px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .5); overflow-y: auto; padding: 3px;
}
.cs__opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px; border-radius: 5px; cursor: pointer; font-size: 12px; color: #e8eaf2; }
.cs__opt:hover, .cs__opt--hl { background: rgba(74, 123, 214, .18); }
.cs__opt__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs__opt__desc { flex: none; font-size: 11px; color: #8b92a8; }
.cs__none { padding: 7px 8px; font-size: 12px; color: #7d8398; text-align: center; }
</style>
