<script setup lang="ts">
/**
 * sms/SmsPanel.vue — 通信面板主组件
 * =================================================
 * 落地形态：SystemPanel.vue 的 `.sp-body` 内的子面板（不是独立浮窗）
 *
 * 职责：
 *   1. 左：会话列表（SmsConversationList）
 *   2. 右：聊天窗口（消息流 + 输入框）
 *   3. 玩家发消息 → emit("send", convId, text) → App.vue 负责唤醒 AI
 *   4. 新建群聊 → emit("create-group", { name, memberIds })
 *
 * 设计文档：通信(短信).design.md §5.4 / §5.5
 */
import { computed, nextTick, ref, watch } from "vue";
import SmsConversationList from "./SmsConversationList.vue";
import SmsNewGroupModal, { type SmsContact } from "./SmsNewGroupModal.vue";
import type { Conversation, Message } from "./types";
import { PLAYER_ID } from "./types";

const props = defineProps<{
  conversations: Conversation[];
  activeId: string;
  /** 通讯录（新建群聊选人用） */
  contacts: SmsContact[];
  /** ★ roleId → 头像 URL（无头像的角色回退名字首字） */
  avatarMap?: Record<string, string>;
  /** ★ 玩家自己的头像 URL（空串回退 emoji） */
  playerAvatar?: string;
}>();

const emit = defineEmits<{
  (e: "select", convId: string): void;
  /** ★ 玩家从通讯录点某人 → 主动发起单聊 */
  (e: "start-chat", roleId: string): void;
  (e: "send", convId: string, text: string): void;
  (e: "create-group", payload: { name: string; memberIds: string[] }): void;
  (e: "remove", convId: string): void;
  (e: "rename", convId: string, name: string): void;
}>();

/** 当前打开的会话 */
const current = computed(() =>
  props.conversations.find((c) => c.id === props.activeId) || null,
);

/** 消息流容器（用于自动滚到底） */
const msgBox = ref<HTMLElement | null>(null);

/** 输入框内容 */
const draft = ref("");

/** 新建群聊弹窗开关 */
const showNewGroup = ref(false);

/** 群名编辑 */
const renaming = ref(false);
const renameText = ref("");

/**
 * ★ 左侧会话列表折叠开关（2026-11-02）：
 * 聊天时列表固定占 240px 宽，窄面板下聊天区太挤 —— 折叠后列表收起，
 * 聊天区占满整行；点把手再展开。折叠态下选中会话自动收起（选完就该看聊天）。
 */
const listCollapsed = ref(false);

/** 当前会话的消息（按时间升序） */
const messages = computed<Message[]>(() => current.value?.messages || []);

/** 是否显示"等回复"提示（玩家发了但 AI 还没回） */
const showAwait = computed(() => !!current.value?.awaitingReply);

/** 新消息到达 / 切换会话 → 滚到底 */
watch(
  () => [props.activeId, messages.value.length] as const,
  async () => {
    await nextTick();
    scrollToBottom();
  },
);

function scrollToBottom(): void {
  const el = msgBox.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/** 发送（Enter 发送 / Shift+Enter 换行） */
function onSend(): void {
  const text = draft.value.trim();
  if (!text || !current.value) return;
  emit("send", current.value.id, text);
  draft.value = "";
  nextTick(scrollToBottom);
}

/** 输入框 keydown */
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter") return;
  if (e.shiftKey) return;   // Shift+Enter → 换行（textarea 默认行为）
  e.preventDefault();
  onSend();
}

/** 是否是玩家自己发的 */
function isMine(m: Message): boolean {
  return m.from === PLAYER_ID;
}

/** 头像 URL：优先 avatarMap 里的真实头像图；空串 = 无图（模板回退首字/emoji） */
function avatarUrlOf(m: Message): string {
  if (isMine(m)) return props.playerAvatar || "";
  return (props.avatarMap || {})[m.from] || "";
}

/** 头像 */
function avatarOf(m: Message): string {
  if (isMine(m)) return props.playerAvatar ? "" : "🧑";
  const n = String(m.fromName || m.from || "?").trim();
  return n ? n.slice(0, 1) : "?";
}

/** 时间文本 */
function timeText(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 发起群聊创建 */
function onCreateGroup(payload: { name: string; memberIds: string[] }): void {
  emit("create-group", payload);
  showNewGroup.value = false;
}

/** 开始改名 */
function startRename(): void {
  if (!current.value || current.value.type !== "group") return;
  renaming.value = true;
  renameText.value = current.value.name;
}

/** 提交改名 */
function commitRename(): void {
  const name = renameText.value.trim();
  if (current.value && name) emit("rename", current.value.id, name);
  renaming.value = false;
}
</script>

<template>
  <div class="sms" :class="{ 'sms--collapsed': listCollapsed }">
    <!-- 左侧：会话列表（顶部带通讯录选择器）—— 折叠时只留一条把手 -->
    <button
      class="list-handle"
      :title="listCollapsed ? '展开会话列表' : '折叠会话列表'"
      @click="listCollapsed = !listCollapsed"
    >{{ listCollapsed ? "☰" : "‹" }}</button>

    <SmsConversationList
      v-show="!listCollapsed"
      :conversations="conversations"
      :active-id="activeId"
      :contacts="contacts"
      :avatar-map="avatarMap"
      @select="(id: string) => emit('select', id)"
      @start-chat="(id: string) => emit('start-chat', id)"
      @create-group="() => (showNewGroup = true)"
    />

    <!-- 右侧：聊天窗口 -->
    <div class="chat">
      <!-- 空态 -->
      <div v-if="!current" class="chat-empty">
        <div class="chat-empty__icon">💬</div>
        <div class="chat-empty__text">选择一个会话开始聊天</div>
        <div class="chat-empty__hint">
          AI 托管角色会主动给你发短信；你发的消息也会立刻叫醒它回复。
        </div>
      </div>

      <template v-else>
        <div class="chat-head">
          <!-- ★ 折叠态：头部放展开把手 + 当前会话名（点名字也能展开列表） -->
          <button
            v-if="listCollapsed"
            class="chat-head__expand"
            title="展开会话列表"
            @click="listCollapsed = false"
          >☰</button>
          <template v-if="renaming">
            <input
              v-model="renameText"
              class="chat-title-input"
              maxlength="20"
              @keyup.enter="commitRename"
              @keyup.esc="renaming = false"
            />
            <button class="chat-head__btn" @click="commitRename">保存</button>
          </template>
          <template v-else>
            <span class="chat-title" :title="current.name">{{ current.name }}</span>
            <span class="chat-members">
              {{ current.type === "group" ? `${current.members.length}人` : "单聊" }}
            </span>
          </template>

          <div class="chat-head__actions">
            <button
              v-if="current.type === 'group' && !renaming"
              class="chat-head__btn"
              title="修改群名"
              @click="startRename"
            >
              ✎
            </button>
            <!-- ★ 用文字而不是 🗑 emoji —— 部分环境（部分 Linux / 精简字体）没有该字形，
                 会渲染成豆腐块。文字标签在任何环境都能显示。 -->
            <button class="chat-head__btn chat-head__btn--text" title="删除会话" @click="emit('remove', current.id)">
              删除
            </button>
            <button class="btn-new-group" @click="showNewGroup = true">+ 新建群聊</button>
          </div>
        </div>

        <div ref="msgBox" class="chat-messages">
          <template v-for="m in messages" :key="m.id">
            <!-- system 消息：居中，不计入未读 -->
            <div v-if="m.type === 'system'" class="msg-sys">{{ m.text }}</div>

            <!-- 普通消息 -->
            <div v-else class="msg-row" :class="isMine(m) ? 'me' : 'them'">
              <div class="msg-avatar" :class="{ me: isMine(m) }">
                <img v-if="avatarUrlOf(m)" :src="avatarUrlOf(m)" alt="" class="msg-avatar-img" />
                <template v-else>{{ avatarOf(m) }}</template>
              </div>
              <div class="msg-wrap">
                <!-- ★ 发送者名：群聊全员显示；单聊显示对方名（玩家自己的不标） -->
                <div
                  v-if="current.type === 'group' || (!isMine(m) && (m.fromName || m.from))"
                  class="msg-sender"
                >
                  {{ isMine(m) ? "我" : m.fromName || m.from }}
                </div>
                <div class="msg-bubble">{{ m.text }}</div>
                <div class="msg-time">{{ timeText(m.timestamp) }}</div>
              </div>
            </div>
          </template>

          <!-- 等待回复提示 -->
          <div v-if="showAwait" class="msg-await">✦ 等待对方回复…</div>
        </div>

        <div class="chat-input-area">
          <textarea
            v-model="draft"
            class="chat-input"
            rows="2"
            placeholder="输入消息…（Enter 发送 / Shift+Enter 换行）"
            @keydown="onKeydown"
          ></textarea>
          <button class="btn-send" @click="onSend">发送</button>
        </div>
      </template>
    </div>

    <!-- 新建群聊弹窗 -->
    <SmsNewGroupModal
      :open="showNewGroup"
      :contacts="contacts"
      @close="showNewGroup = false"
      @create="onCreateGroup"
    />
  </div>
</template>

<style scoped>
.sms {
  height: 100%;
  width: 100%;
  overflow: hidden;
  display: flex;
  position: relative;
  background: #1e1f1f;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
}

/* ---------- 左栏折叠（2026-11-02） ---------- */
/* ★ 折叠把手：贴在左缘的窄竖条；展开态显示 ‹（收起），折叠态显示 ☰（展开） */
.list-handle {
  width: 18px;
  align-self: stretch;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.05);
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  color: #93a2b3;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.list-handle:hover { background: rgba(255, 255, 255, 0.1); color: #e8eef5; }
/* ★ 折叠态：聊天区占满（列表 v-show 隐藏后 flex:1 自动铺满，这里只改把手视觉） */
.sms--collapsed .list-handle { border-right-color: rgba(255, 255, 255, 0.06); }
/* ★ 折叠态聊天头部的展开按钮 */
.chat-head__expand {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #cfd8e3;
  min-width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.chat-head__expand:hover { background: rgba(255, 255, 255, 0.12); }

/* ---------- 右侧聊天窗口 ---------- */
.chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chat-head {
  min-height: 40px;
  flex-shrink: 0;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  gap: 8px;
}
.chat-title {
  font-size: 13px;
  font-weight: 600;
  color: #e8eef5;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-title-input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid #2f6fd0;
  border-radius: 4px;
  padding: 3px 8px;
  color: #e8eef5;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  width: 150px;
}
.chat-members { font-size: 11px; color: #93a2b3; flex-shrink: 0; }
.chat-head__actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.chat-head__btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #cfd8e3;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-head__btn--text { font-size: 11px; white-space: nowrap; }
.chat-head__btn:hover { background: rgba(255, 255, 255, 0.12); }
.btn-new-group {
  background: rgba(47, 111, 208, 0.2);
  border: 1px solid rgba(47, 111, 208, 0.55);
  color: #9fc4ff;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
}
.btn-new-group:hover { background: rgba(47, 111, 208, 0.35); }

.chat-messages {
  flex: 1;
  min-height: 0;
  padding: 14px;
  overflow-y: auto;
  overflow-x: hidden;   /* ★ 显式 hidden：只写 overflow-y:auto 时 overflow-x 会被算成 auto */
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.msg-row { display: flex; gap: 8px; max-width: 78%; }
.msg-row.them { align-self: flex-start; }
.msg-row.me { align-self: flex-end; flex-direction: row-reverse; }
.msg-avatar {
  width: 30px;
  height: 30px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  color: #e8eef5;
}
.msg-avatar.me { background: rgba(47, 111, 208, 0.35); }
/* ★ 真实头像图：填满头像框，圆角同框 */
.msg-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 5px;
  object-fit: cover;
  display: block;
}
.msg-wrap { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.msg-row.me .msg-wrap { align-items: flex-end; }
.msg-sender { font-size: 10px; color: #7fb0ff; }
.msg-row.me .msg-sender { text-align: right; color: #5b6672; }
.msg-bubble {
  padding: 7px 11px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}
.msg-row.them .msg-bubble {
  background: rgba(255, 255, 255, 0.08);
  color: #e8eef5;
  border-bottom-left-radius: 2px;
}
.msg-row.me .msg-bubble {
  background: #2f6fd0;
  color: #fff;
  border-bottom-right-radius: 2px;
}
.msg-time { font-size: 9px; color: #5b6672; }
.msg-sys {
  align-self: center;
  font-size: 10px;
  color: #7a848f;
  background: rgba(255, 255, 255, 0.04);
  padding: 3px 10px;
  border-radius: 10px;
}
.msg-await {
  align-self: center;
  font-size: 10px;
  color: #ffd76a;
  border: 1px dashed rgba(255, 215, 106, 0.45);
  padding: 2px 9px;
  border-radius: 10px;
}

.chat-input-area {
  flex-shrink: 0;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.chat-input {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 7px 10px;
  color: #e8eef5;
  font-size: 12px;
  outline: none;
  font-family: inherit;
  resize: none;
  line-height: 1.5;
}
.chat-input:focus { border-color: #2f6fd0; }
.chat-input::placeholder { color: #5b6672; }
.btn-send {
  background: #2f6fd0;
  color: #fff;
  border: none;
  padding: 8px 18px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
}
.btn-send:hover { background: #3d80e8; }

/* 空态 */
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #5b6672;
  padding: 20px;
  text-align: center;
}
.chat-empty__icon { font-size: 34px; opacity: 0.5; }
.chat-empty__text { font-size: 13px; color: #93a2b3; }
.chat-empty__hint { font-size: 11px; line-height: 1.7; max-width: 280px; }
</style>