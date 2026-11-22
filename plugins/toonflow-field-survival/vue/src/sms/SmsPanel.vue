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

/**
 * ★ 2026-11-22 群聊编排：排队中的发言（编排器一次产出多人 → 逐条冒泡）。
 *   pendingSpeaking[0] = 正在冒泡的那条；其余 = 还在排队。
 *   界面据此显示「沉默的角色头像 + 正在输入…」。
 */
const pendingSpeaking = computed(() => current.value?.pendingSpeaking || []);

/** 正在冒泡的那条（队首） */
const speakingNow = computed(() => pendingSpeaking.value[0] || null);

/** 还在排队的（队首之后）—— 显示为沉默头像 */
const speakingQueued = computed(() => pendingSpeaking.value.slice(1));

/**
 * ★ 2026-11-23 沉默占位：编排器还在调 LLM（返回前）显示「灰色头像 + 沉默：A、B、C」。
 * 编排返回后 pendingSpeaking 有内容（或占位被清除）→ 自动隐藏。
 */
const silentPlaceholder = computed(() => current.value?.silentPlaceholder || null);

/** 队首的角色头像（没有头像回退名字首字） */
function pendingAvatarUrl(roleId: string): string {
  return props.avatarMap?.[roleId] || "";
}
function pendingAvatarText(roleId: string, roleName: string): string {
  return (roleName || roleId || "?").slice(0, 1);
}

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

/** ★ 排队中的发言变化 → 也要滚到底（让「正在输入」那一行始终可见） */
watch(
  () => (current.value?.pendingSpeaking || []).length,
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
  // ★ 引用回复：拼「回复 @名字：摘要」前缀 —— @点名机制自动生效（被引用者必回）
  const q = replyTo.value;
  const payload = q ? `「回复 @${q.name}：${q.preview}」\n${text}` : text;
  emit("send", current.value.id, payload);
  draft.value = "";
  replyTo.value = null;
  mentionOpen.value = false;
  nextTick(scrollToBottom);
}

/* ---------- ★ @点名候选（2026-11-22）：输入 @ 弹出成员选择 ---------- */
const mentionOpen = ref(false);
const mentionQuery = ref("");
const mentionIdx = ref(0);
const inputEl = ref<HTMLTextAreaElement | null>(null);

/** 当前会话可 @ 的成员（除玩家）：contacts 优先，memberNames/历史消息兜底 */
const mentionCandidates = computed(() => {
  const conv = current.value;
  if (!conv) return [];
  const contactMap = new Map(props.contacts.map((c) => [c.id, c.name]));
  const out: Array<{ id: string; name: string }> = [];
  for (const id of conv.members) {
    if (id === PLAYER_ID) continue;
    const name = contactMap.get(id) || conv.memberNames?.[id] || lastFromName(conv, id) || id;
    if (!out.some((x) => x.id === id)) out.push({ id, name });
  }
  return out;
});

function lastFromName(conv: Conversation, id: string): string {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i];
    if (m.from === id && m.fromName) return m.fromName;
  }
  return "";
}

/** 按光标前的 @ 未完词过滤候选 */
const mentionFiltered = computed(() => {
  const q = mentionQuery.value.trim().toLowerCase();
  if (!q) return mentionCandidates.value;
  return mentionCandidates.value.filter((m) => m.name.toLowerCase().includes(q));
});

/** 检测光标前是否有「@未完词」→ 开/关候选浮层 */
function detectMention(): void {
  const el = inputEl.value;
  if (!el) return;
  const pos = el.selectionStart ?? draft.value.length;
  const before = draft.value.slice(0, pos);
  const m = before.match(/@([^\s@]{0,12})$/);
  if (m) {
    if (!mentionOpen.value || m[1] !== mentionQuery.value) mentionIdx.value = 0;
    mentionOpen.value = true;
    mentionQuery.value = m[1];
  } else {
    mentionOpen.value = false;
  }
}

/** 选中候选：把「@未完词」替换为「@名字 」并回落光标 */
function pickMention(cand: { id: string; name: string }): void {
  const el = inputEl.value;
  mentionOpen.value = false;
  if (!el) return;
  const pos = el.selectionStart ?? draft.value.length;
  const before = draft.value.slice(0, pos);
  const at = before.lastIndexOf("@");
  if (at < 0) return;
  const after = draft.value.slice(pos);
  draft.value = before.slice(0, at) + "@" + cand.name + " " + after;
  const caret = at + cand.name.length + 2;
  void nextTick(() => { el.focus(); el.setSelectionRange(caret, caret); });
}

/** 输入框 keydown（候选浮层优先接管 ↑↓/Enter/Tab/Esc） */
function onKeydown(e: KeyboardEvent): void {
  if (mentionOpen.value && mentionFiltered.value.length) {
    const n = mentionFiltered.value.length;
    if (e.key === "ArrowDown") { e.preventDefault(); mentionIdx.value = (mentionIdx.value + 1) % n; return; }
    if (e.key === "ArrowUp") { e.preventDefault(); mentionIdx.value = (mentionIdx.value - 1 + n) % n; return; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionFiltered.value[Math.min(mentionIdx.value, n - 1)]); return; }
    if (e.key === "Escape") { e.preventDefault(); mentionOpen.value = false; return; }
  }
  if (e.key !== "Enter") return;
  if (e.shiftKey) return;   // Shift+Enter → 换行（textarea 默认行为）
  e.preventDefault();
  onSend();
}

/** 是否是玩家自己发的 */
function isMine(m: Message): boolean {
  return m.from === PLAYER_ID;
}

/** ★ 沉默行头像（按 roleId 直接查 avatarMap） */
function avatarUrlOf2(roleId: string): string {
  return (props.avatarMap || {})[roleId] || "";
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

/* ---------- ★ 2026-11-23 消息复制 / 引用（PC 左键点击 / 手机长按） ---------- */
const msgAction = ref<{ msg: Message; x: number; y: number } | null>(null);
/** 引用中的消息（输入框上方显示引用条，发送时拼「回复 @名字：摘要」前缀） */
const replyTo = ref<{ from: string; name: string; preview: string } | null>(null);
let longPressTimer: number | null = null;

/** 菜单弹出位置（视口内边界约束） */
const msgActionStyle = computed(() => {
  const a = msgAction.value;
  if (!a) return {};
  const W = 140, H = 110, M = 8;
  const x = Math.min(Math.max(M, a.x - 10), window.innerWidth - W - M);
  const y = Math.min(Math.max(M, a.y - 10), window.innerHeight - H - M);
  return { left: `${x}px`, top: `${y}px` };
});

/** ★ PC：右键气泡弹菜单（手机：长按 500ms，见 onBubbleTouchStart） */
function onBubbleContextMenu(m: Message, e: MouseEvent): void {
  if (m.type === "system") return;
  msgAction.value = { msg: m, x: e.clientX, y: e.clientY };
}

function onBubbleTouchStart(m: Message, e: TouchEvent): void {
  if (m.type === "system") return;
  const t = e.touches[0];
  const x = t?.clientX ?? 0;
  const y = t?.clientY ?? 0;
  if (longPressTimer != null) window.clearTimeout(longPressTimer);
  longPressTimer = window.setTimeout(() => {
    msgAction.value = { msg: m, x, y };
  }, 500);
}

function onBubbleTouchEnd(): void {
  if (longPressTimer != null) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function closeMsgAction(): void {
  msgAction.value = null;
}

/** 复制消息文本（clipboard API 优先，老环境回退 execCommand） */
async function copyMsgText(): Promise<void> {
  const m = msgAction.value?.msg;
  if (!m) return;
  const text = String(m.text || "");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    console.info("[sms] 已复制消息");
  } catch (e) {
    console.warn("[sms] 复制失败:", e);
  }
  msgAction.value = null;
}

/** 引用消息 → 输入框上方出现引用条；发送时拼「回复 @名字：摘要」前缀（@点名机制生效） */
function quoteMsg(): void {
  const m = msgAction.value?.msg;
  if (!m) return;
  replyTo.value = {
    from: m.from,
    name: isMine(m) ? "我" : String(m.fromName || m.from || "?"),
    preview: String(m.text || "").replace(/\s+/g, " ").slice(0, 60),
  };
  msgAction.value = null;
  void nextTick(() => inputEl.value?.focus());
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
            <!-- ★ 2026-11-23 编排沉默行：本轮没发言的成员，持久保留 -->
            <div v-if="m.type === 'system' && m.silent && m.silent.length" class="msg-row them msg-row--silent-final">
              <div
                v-for="sp in m.silent"
                :key="sp.roleId"
                class="msg-avatar msg-avatar--silent"
                :title="sp.roleName"
              >
                <img v-if="avatarUrlOf2(sp.roleId)" :src="avatarUrlOf2(sp.roleId)" alt="" class="msg-avatar-img" />
                <template v-else>{{ (sp.roleName || sp.roleId || "?").slice(0, 1) }}</template>
              </div>
              <div class="msg-wrap">
                <div class="msg-sender msg-sender--muted">{{ m.text }}</div>
              </div>
            </div>

            <!-- system 消息：居中，不计入未读 -->
            <div v-else-if="m.type === 'system'" class="msg-sys">{{ m.text }}</div>

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
                <div
                  class="msg-bubble"
                  :class="{ 'msg-bubble--mine': isMine(m) }"
                  title="右键复制 / 引用（手机长按）"
                  @contextmenu.prevent="onBubbleContextMenu(m, $event)"
                  @touchstart="onBubbleTouchStart(m, $event)"
                  @touchend="onBubbleTouchEnd"
                  @touchmove="onBubbleTouchEnd"
                  @touchcancel="onBubbleTouchEnd"
                >{{ m.text }}<span v-if="m.streaming" class="type-cursor">▍</span></div>
                <div class="msg-time">{{ timeText(m.timestamp) }}</div>
              </div>
            </div>
          </template>

          <!-- ★ 2026-11-23 沉默占位：编排器调 LLM 期间立刻显示（发完消息不再空屏等待） -->
          <div v-if="silentPlaceholder && !speakingNow" class="msg-row them msg-row--silent-ph">
            <div
              v-for="(rid, i) in silentPlaceholder.roleIds"
              :key="rid"
              class="msg-avatar msg-avatar--silent"
              :title="silentPlaceholder.roleNames[i]"
            >
              <img v-if="pendingAvatarUrl(rid)" :src="pendingAvatarUrl(rid)" alt="" class="msg-avatar-img" />
              <template v-else>{{ pendingAvatarText(rid, silentPlaceholder.roleNames[i]) }}</template>
            </div>
            <div class="msg-wrap">
              <div class="msg-sender msg-sender--muted">
                思考中：{{ silentPlaceholder.roleNames.join("、") }}
              </div>
            </div>
          </div>

          <!-- ★ 2026-11-22 群聊编排：先显示「沉默的角色头像 + 正在输入…」，
               发言者再逐个冒泡（队首 = 正在说的，后面 = 排队的） -->
          <div v-if="speakingNow" class="msg-row them msg-row--typing">
            <div class="msg-avatar msg-avatar--silent">
              <img v-if="pendingAvatarUrl(speakingNow.roleId)" :src="pendingAvatarUrl(speakingNow.roleId)" alt="" class="msg-avatar-img" />
              <template v-else>{{ pendingAvatarText(speakingNow.roleId, speakingNow.roleName) }}</template>
            </div>
            <div class="msg-wrap">
              <div class="msg-sender">{{ speakingNow.roleName }}</div>
              <div class="msg-bubble msg-bubble--typing">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
              </div>
            </div>
          </div>

          <!-- 排队中的沉默头像（灰色） -->
          <div v-if="speakingQueued.length" class="msg-row them msg-row--queued">
            <div
              v-for="q in speakingQueued"
              :key="q.roleId"
              class="msg-avatar msg-avatar--silent"
              :title="q.roleName"
            >
              <img v-if="pendingAvatarUrl(q.roleId)" :src="pendingAvatarUrl(q.roleId)" alt="" class="msg-avatar-img" />
              <template v-else>{{ pendingAvatarText(q.roleId, q.roleName) }}</template>
            </div>
            <div class="msg-wrap">
              <div class="msg-sender msg-sender--muted">
                {{ speakingQueued.map((q) => q.roleName).join("、") }} 正在思考…
              </div>
            </div>
          </div>

          <!-- 等待回复提示 -->
          <div v-if="showAwait && !speakingNow" class="msg-await">✦ 等待对方回复…</div>
        </div>

        <div class="chat-input-area">
          <!-- ★ 引用回复条：点消息气泡「引用」后出现，发送时拼「回复 @名字：摘要」前缀 -->
          <div v-if="replyTo" class="quote-bar">
            <span class="quote-bar__text">引用 {{ replyTo.name }}：{{ replyTo.preview }}</span>
            <button class="quote-bar__close" type="button" title="取消引用" @click="replyTo = null">✕</button>
          </div>
          <!-- ★ @点名候选浮层：输入 @ 触发（↑↓ 选 / Enter 或点击插入 / Esc 关） -->
          <div v-if="mentionOpen && mentionFiltered.length" class="mention-pop">
            <div class="mention-pop__hint">点名（被 @ 的角色会优先回复）</div>
            <button
              v-for="(cand, i) in mentionFiltered"
              :key="cand.id"
              class="mention-item"
              :class="{ active: i === mentionIdx }"
              type="button"
              @mousedown.prevent="pickMention(cand)"
              @mouseenter="mentionIdx = i"
            >
              <span class="mention-item__avatar">{{ cand.name.slice(0, 1) }}</span>
              <span class="mention-item__name">{{ cand.name }}</span>
            </button>
          </div>
          <textarea
            ref="inputEl"
            v-model="draft"
            class="chat-input"
            rows="2"
            placeholder="输入消息…（Enter 发送 / Shift+Enter 换行 / @ 点名角色）"
            @keydown="onKeydown"
            @input="detectMention"
            @click="detectMention"
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

    <!-- ★ 消息操作浮层：PC 左键点击 / 手机长按气泡 → 复制 / 引用 -->
    <div v-if="msgAction" class="msg-action-mask" @click="closeMsgAction" @contextmenu.prevent>
      <div class="msg-action-pop" :style="msgActionStyle" @click.stop>
        <button class="msg-action-item" type="button" @click="copyMsgText">复制</button>
        <button class="msg-action-item" type="button" @click="quoteMsg">引用</button>
      </div>
    </div>
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
  /* ★ 复制/引用走自定义菜单（点击/长按气泡）→ 关掉系统长按菜单与文字选择，
     避免 PC 选字与手机系统弹层打架 */
  user-select: none;
  -webkit-touch-callout: none;
  cursor: pointer;
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

/* ★ 2026-11-23 消息复制/引用：引用条 + 操作浮层 */
.quote-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(47, 111, 208, 0.16);
  border-left: 2px solid #2f6fd0;
  padding: 4px 8px;
  border-radius: 4px;
  margin-bottom: 6px;
  font-size: 11px;
  color: #9cc0f0;
}
.quote-bar__text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quote-bar__close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #6f7b88;
  cursor: pointer;
  padding: 0 3px;
  font-size: 12px;
}
.msg-action-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.25);
}
.msg-action-pop {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: #1d232b;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  overflow: hidden;
  min-width: 130px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}
.msg-action-item {
  background: none;
  border: none;
  color: #e8eef5;
  padding: 10px 16px;
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.msg-action-item + .msg-action-item { border-top: 1px solid rgba(255, 255, 255, 0.06); }
.msg-action-item:hover { background: rgba(255, 255, 255, 0.08); }

/* ★ 2026-11-23 沉默占位行（LLM 调用期间，文案=思考中） */
.msg-row--silent-ph { opacity: 0.75; }
.msg-row--silent-ph .msg-avatar--silent { width: 26px; height: 26px; font-size: 12px; }
/* ★ 2026-11-23 持久沉默行（每轮结束后追加，留在消息流里） */
.msg-row--silent-final { margin: 2px 0; }
.msg-row--silent-final .msg-avatar--silent { width: 24px; height: 24px; font-size: 11px; }

/* ★ 2026-11-22 群聊编排：正在输入 / 沉默头像 */
.msg-row--typing { opacity: 0.92; }
.msg-row--queued { align-items: center; gap: 4px; }
.msg-row--queued .msg-wrap { flex: 1; }
.msg-avatar--silent { opacity: 0.45; filter: grayscale(0.7); }
.msg-bubble--typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 9px 12px;
}
/* ★ 2026-11-23 打字机光标（streaming 消息） */
.type-cursor {
  display: inline-block;
  margin-left: 1px;
  color: rgba(232, 238, 245, 0.85);
  animation: cursor-blink 0.9s steps(1) infinite;
}
@keyframes cursor-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
.msg-bubble--typing .typing-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(232, 238, 245, 0.7);
  animation: typing-blink 1.1s infinite ease-in-out;
}
.msg-bubble--typing .typing-dot:nth-child(2) { animation-delay: 0.18s; }
.msg-bubble--typing .typing-dot:nth-child(3) { animation-delay: 0.36s; }
.msg-sender--muted { color: #6f7b88; font-size: 10px; }
@keyframes typing-blink {
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}

.chat-input-area {
  flex-shrink: 0;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  gap: 8px;
  align-items: flex-end;
  position: relative;   /* @点名候选浮层的定位锚 */
}
/* ---------- @点名候选浮层 ---------- */
.mention-pop {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(100% + 4px);
  max-height: 180px;
  overflow-y: auto;
  background: #26282b;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
  padding: 4px;
  z-index: 30;
}
.mention-pop__hint {
  font-size: 10px;
  color: #7a848f;
  padding: 3px 8px 5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 3px;
}
.mention-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  background: transparent;
  border: none;
  color: #d6dee8;
  font-size: 12px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}
.mention-item.active { background: rgba(47, 111, 208, 0.35); }
.mention-item__avatar {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
}
.mention-item__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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