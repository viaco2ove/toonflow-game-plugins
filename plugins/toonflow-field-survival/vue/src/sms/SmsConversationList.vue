<script setup lang="ts">
/**
 * sms/SmsConversationList.vue — 左侧会话列表
 * =================================================
 * 职责：
 *   1. 顶部通讯录选择器（搜索框 + 下拉：全部角色 / 已有群聊 / 新建群聊）
 *   2. 会话项：头像 / 名称 / 最后消息预览 / 时间 / 未读角标
 *   3. 按 updatedAt 降序（最新在最上面）
 *
 * ★ 列表里**只放已有会话**（不塞全部角色）。
 *   找新的人走顶部搜索框下拉 —— 与微信/QQ 一致，
 *   也避免几十个角色把真正的会话淹没。
 *
 * 设计文档：通信(短信).design.md §5.4 / §7
 */
import { computed } from "vue";
import SmsContactPicker from "./SmsContactPicker.vue";
import type { Conversation } from "./types";
import { PLAYER_ID } from "./types";
import { getConvUnread } from "./store";
import type { SmsContact } from "./SmsNewGroupModal.vue";

const props = defineProps<{
  conversations: Conversation[];
  activeId: string;
  /** 通讯录（找人的数据源） */
  contacts: SmsContact[];
  /** ★ 单聊 roleId → 头像 URL（无图回退首字） */
  avatarMap?: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: "select", convId: string): void;
  (e: "start-chat", roleId: string): void;
  (e: "create-group"): void;
}>();

/** 会话列表（已按 updatedAt 降序，store 保证） */
const filtered = computed(() => props.conversations || []);

/** 会话头像 URL：单聊优先取对方角色的真实头像；空串 = 无图（模板回退 emoji/首字） */
function avatarUrlOf(c: Conversation): string {
  if (c.type === "group") return "";
  const roleId = c.members.find((m) => m !== PLAYER_ID);
  if (!roleId) return "";
  return (props.avatarMap || {})[roleId] || "";
}

/** 会话头像（按类型给默认 emoji） */
function avatarOf(c: Conversation): string {
  if (c.avatar) return c.avatar;
  if (c.type === "group") return "👥";
  // 单聊：取名字首字（中文取 1 个字，英文取 1 个字母）
  const n = String(c.name || "?").trim();
  return n ? n.slice(0, 1) : "?";
}

/** 最后一条消息预览（群聊带发送者前缀） */
function previewOf(c: Conversation): { who: string; text: string } {
  const last = c.messages[c.messages.length - 1];
  if (!last) return { who: "", text: "（还没有消息）" };
  if (last.type === "system") return { who: "", text: last.text };
  const who = last.from === PLAYER_ID ? "我" : last.fromName || last.from;
  return { who: c.type === "group" ? who : "", text: last.text };
}

/** 时间显示：今天→时分，昨天→昨天，本周→周几，更早→日期 */
function timeText(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const yest = new Date(now.getTime() - 86400000);
  const isYest =
    d.getFullYear() === yest.getFullYear() &&
    d.getMonth() === yest.getMonth() &&
    d.getDate() === yest.getDate();
  if (isYest) return "昨天";
  // 本周内 → 周X
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return `周${"日一二三四五六"[d.getDay()]}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 未读数 */
function unreadOf(c: Conversation): number {
  return getConvUnread(c);
}

/** 角标文本（>99 → 99+） */
function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}
</script>

<template>
  <div class="conv-list">
    <!-- ★ 通讯录选择器：搜索框 + 下拉（全部角色 / 已有群聊 / 新建群聊） -->
    <SmsContactPicker
      :conversations="conversations"
      :contacts="contacts"
      :active-id="activeId"
      @select="(id: string) => emit('select', id)"
      @start-chat="(id: string) => emit('start-chat', id)"
      @create-group="() => emit('create-group')"
    />

    <div class="conv-scroll">
      <div
        v-for="c in filtered"
        :key="c.id"
        class="conv-item"
        :class="{ active: c.id === activeId }"
        @click="emit('select', c.id)"
      >
        <div class="conv-avatar" :class="{ group: c.type === 'group' }">
          <img v-if="avatarUrlOf(c)" :src="avatarUrlOf(c)" alt="" class="conv-avatar-img" />
          <template v-else>{{ avatarOf(c) }}</template>
        </div>
        <div class="conv-info">
          <div class="conv-name">
            <span class="conv-name__text">
              {{ c.name }}
              <span v-if="c.type === 'group'" class="conv-tag">群聊</span>
            </span>
            <span class="conv-time">{{ timeText(c.updatedAt) }}</span>
          </div>
          <div class="conv-preview">
            <span v-if="previewOf(c).who" class="who">{{ previewOf(c).who }}:</span>
            {{ previewOf(c).text }}
          </div>
        </div>
        <div v-if="unreadOf(c) > 0" class="conv-badge">{{ badgeText(unreadOf(c)) }}</div>
      </div>

      <!-- ★ 空态引导：告诉玩家去上面搜索框找人 -->
      <div v-if="!filtered.length" class="conv-empty">
        <div class="conv-empty__icon">💬</div>
        <div class="conv-empty__text">还没有会话</div>
        <div class="conv-empty__hint">
          点上方搜索框选角色开始聊天，或新建群聊
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conv-list {
  width: 240px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.02);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.conv-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.conv-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  gap: 9px;
  align-items: flex-start;
  transition: background 0.15s;
}
.conv-item:hover { background: rgba(255, 255, 255, 0.04); }
.conv-item.active { background: rgba(47, 111, 208, 0.18); }
.conv-avatar {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  flex-shrink: 0;
  background: rgba(47, 111, 208, 0.25);
  color: #e8eef5;
  overflow: hidden;
}
/* ★ 真实头像图：填满会话头像框 */
.conv-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.conv-avatar.group { background: rgba(143, 176, 255, 0.18); }
.conv-info { flex: 1; min-width: 0; }
.conv-name {
  font-size: 12px;
  font-weight: 600;
  color: #e8eef5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}
.conv-name__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-time { font-size: 10px; color: #5b6672; font-weight: normal; flex-shrink: 0; }
.conv-preview {
  font-size: 11px;
  color: #93a2b3;
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-preview .who { color: #7fb0ff; }
.conv-tag {
  font-size: 9px;
  background: rgba(47, 111, 208, 0.25);
  color: #7fb0ff;
  padding: 1px 4px;
  border-radius: 2px;
  margin-left: 4px;
  font-weight: normal;
  flex-shrink: 0;
}
.conv-badge {
  background: #e04a4a;
  color: #fff;
  font-size: 10px;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  margin-left: 6px;
  flex-shrink: 0;
}
/* ★ 空态引导 */
.conv-empty {
  padding: 30px 14px;
  text-align: center;
  color: #5b6672;
  font-size: 11px;
}
.conv-empty__icon { font-size: 28px; opacity: 0.45; margin-bottom: 6px; }
.conv-empty__text { font-size: 12px; color: #93a2b3; margin-bottom: 4px; }
.conv-empty__hint { font-size: 10px; line-height: 1.7; }
</style>
