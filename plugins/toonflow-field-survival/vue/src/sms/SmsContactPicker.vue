<script setup lang="ts">
/**
 * sms/SmsContactPicker.vue — 通讯录选择器（搜索框 + 下拉）
 * =================================================
 * ★ 为什么做成「搜索框 + 下拉」而不是「列表里直接列全部角色」：
 *   - 列表里塞全部角色（可能几十个）→ 真正的会话被淹没在噪音里
 *   - 微信/QQ 都是这个交互：列表只放已有会话，找人走搜索
 *   - 空列表时（开局一个会话都没有）也有明确的入口，不会卡死
 *
 * 交互：
 *   - 点搜索框 / 输入 → 展开下拉
 *   - 下拉分三段：已有群聊 / 全部角色 / 创建群聊
 *   - 点角色 → emit("start-chat", roleId)
 *   - 点群聊 → emit("select", convId)
 *   - Esc / 点外部 → 收起
 *
 * 设计文档：通信(短信).design.md §5.4 / §7
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { Conversation } from "./types";
import type { SmsContact } from "./SmsNewGroupModal.vue";
import { getConvUnread } from "./store";

const props = defineProps<{
  conversations: Conversation[];
  contacts: SmsContact[];
  activeId: string;
}>();

const emit = defineEmits<{
  (e: "select", convId: string): void;
  (e: "start-chat", roleId: string): void;
  (e: "create-group"): void;
}>();

const keyword = ref("");
const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

/** 已有群聊（用于下拉里快速切换） */
const groups = computed(() => props.conversations.filter((c) => c.type === "group"));

/** ★ 过滤后的角色：
 *   - 已建过单聊的 → 已在列表里，不重复出现在"全部角色"段
 *   - 其余的按名字过滤
 */
const roleList = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const existing = new Set(
    props.conversations
      .filter((c) => c.type === "private")
      .flatMap((c) => c.members),
  );
  return (props.contacts || []).filter((c) => {
    if (existing.has(c.id)) return false;
    if (!kw) return true;
    return c.name.toLowerCase().includes(kw);
  });
});

/** 过滤后的群聊 */
const groupList = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return groups.value;
  return groups.value.filter((c) => c.name.toLowerCase().includes(kw));
});

/** 有没有可显示的内容 */
const hasResult = computed(() => groupList.value.length > 0 || roleList.value.length > 0);

/** 下拉里整体没内容（连"创建群聊"都不该显示时） */
const showDropdown = computed(() => open.value);

function toggle(): void {
  open.value = !open.value;
  if (open.value) {
    // 打开时清掉搜索词 → 显示全量；输入后再过滤
    keyword.value = "";
  }
}

function close(): void {
  open.value = false;
}

function onInput(): void {
  open.value = true;
}

/** 点角色 → 发起单聊 */
function startChat(roleId: string): void {
  emit("start-chat", roleId);
  close();
}

/** 点群聊 → 打开 */
function selectConv(convId: string): void {
  emit("select", convId);
  close();
}

/** 点外部 → 收起 */
function onDocPointer(e: PointerEvent): void {
  if (!rootEl.value) return;
  if (rootEl.value.contains(e.target as Node)) return;
  close();
}

/**
 * ★ 选项按下时就选中（不等 click）
 *
 * 背景：本组件挂在可拖拽的系统面板里，父层用了 setPointerCapture，
 *   一旦 pointerdown 被捕获，浏览器可能不再在选项上合成 click，
 *   导致「点角色没反应」。所以选择动作在 pointerdown 阶段完成。
 *   pointerdown 比 click 早 → 不会重复触发（click 里不再做选择）。
 */
function onItemPointerDown(e: PointerEvent, action: () => void): void {
  // 只响应主键，避免右键菜单打开时误选
  if (e.button !== 0) return;
  action();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer);
  document.removeEventListener("keydown", onKeydown);
});

/** 头像（群聊用 👥，角色取名字首字） */
function avatarOf(c: Conversation): string {
  if (c.avatar) return c.avatar;
  if (c.type === "group") return "👥";
  const n = String(c.name || "?").trim();
  return n ? n.slice(0, 1) : "?";
}

function unreadOf(c: Conversation): number {
  return getConvUnread(c);
}
</script>

<template>
  <div ref="rootEl" class="picker">
    <!-- 搜索框（点击展开下拉） -->
    <div class="picker-search" :class="{ open }">
      <span class="picker-search__icon">🔍</span>
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索角色 / 群聊"
        @focus="open = true"
        @input="onInput"
      />
      <button v-if="keyword" class="picker-search__clear" title="清空" @pointerdown="onItemPointerDown($event, () => { keyword = ''; })">×</button>
      <button
        class="picker-search__toggle"
        :title="open ? '收起' : '展开'"
        @pointerdown="onItemPointerDown($event, toggle)"
      >
        {{ open ? "▴" : "▾" }}
      </button>
    </div>

    <!-- 下拉面板 -->
    <div v-if="showDropdown" class="picker-drop">
      <!-- 已有群聊 -->
      <template v-if="groupList.length">
        <div class="picker-group">群聊</div>
        <button
          v-for="c in groupList"
          :key="c.id"
          class="picker-item"
          :class="{ active: c.id === activeId }"
          @pointerdown="onItemPointerDown($event, () => selectConv(c.id))"
        >
          <span class="picker-avatar group">👥</span>
          <span class="picker-name">{{ c.name }}</span>
          <span v-if="unreadOf(c) > 0" class="picker-badge">{{ unreadOf(c) > 99 ? "99+" : unreadOf(c) }}</span>
        </button>
      </template>

      <!-- 全部角色（还没建过会话的） -->
      <template v-if="roleList.length">
        <div class="picker-group">角色</div>
        <button
          v-for="c in roleList"
          :key="c.id"
          class="picker-item"
          @pointerdown="onItemPointerDown($event, () => startChat(c.id))"
        >
          <span class="picker-avatar">{{ c.name.slice(0, 1) }}</span>
          <span class="picker-name">{{ c.name }}</span>
          <span v-if="c.managed" class="picker-tag">托管</span>
          <span class="picker-action">发消息</span>
        </button>
      </template>

      <!-- 空态 -->
      <div v-if="!hasResult" class="picker-empty">
        没有匹配的角色
      </div>

      <!-- 底部：创建群聊 -->
      <button
        class="picker-create"
        @pointerdown="onItemPointerDown($event, () => { emit('create-group'); close(); })"
      >
        ＋ 新建群聊
      </button>
    </div>
  </div>
</template>

<style scoped>
.picker { position: relative; flex-shrink: 0; }

/* ---------- 搜索框 ---------- */
.picker-search {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}
.picker-search.open { background: rgba(47, 111, 208, 0.1); }
.picker-search__icon { font-size: 11px; opacity: 0.6; flex-shrink: 0; }
.picker-search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: #e8eef5;
  font-size: 12px;
  font-family: inherit;
}
.picker-search input::placeholder { color: #5b6672; }
.picker-search__clear,
.picker-search__toggle {
  background: transparent;
  border: none;
  color: #93a2b3;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px 3px;
  flex-shrink: 0;
}
.picker-search__clear:hover,
.picker-search__toggle:hover { color: #e8eef5; }

/* ---------- 下拉面板 ---------- */
.picker-drop {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 320px;
  overflow-y: auto;
  overflow-x: hidden;
  background: #232424;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-top: none;
  border-radius: 0 0 6px 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
  padding: 4px 0;
}
.picker-group {
  font-size: 10px;
  color: #5b6672;
  padding: 6px 10px 3px;
}
.picker-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: none;
  color: #e8eef5;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  font-family: inherit;
}
.picker-item:hover { background: rgba(255, 255, 255, 0.07); }
.picker-item.active { background: rgba(47, 111, 208, 0.2); }
.picker-avatar {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
  background: rgba(47, 111, 208, 0.25);
  color: #e8eef5;
}
.picker-avatar.group { background: rgba(143, 176, 255, 0.18); }
.picker-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-badge {
  background: #e04a4a;
  color: #fff;
  font-size: 9px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  flex-shrink: 0;
}
.picker-tag {
  font-size: 9px;
  background: rgba(47, 111, 208, 0.25);
  color: #7fb0ff;
  padding: 1px 4px;
  border-radius: 2px;
  flex-shrink: 0;
}
.picker-action {
  font-size: 10px;
  color: #5b6672;
  flex-shrink: 0;
  opacity: 0;
}
.picker-item:hover .picker-action { opacity: 1; }
.picker-empty {
  padding: 14px 10px;
  text-align: center;
  color: #5b6672;
  font-size: 11px;
}
.picker-create {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 8px 10px;
  background: rgba(47, 111, 208, 0.14);
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: #9fc4ff;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  font-family: inherit;
}
.picker-create:hover { background: rgba(47, 111, 208, 0.28); }
</style>
