<script setup lang="ts">
import { ref, watch } from "vue";
import BagPanel from "./panels/BagPanel.vue";
import RingPanel from "./panels/RingPanel.vue";
import ShopPanel from "./panels/ShopPanel.vue";
import SkillPanel from "./panels/SkillPanel.vue";
import MapPanel from "./panels/MapPanel.vue";
import RolePanel from "./panels/RolePanel.vue";
import EventPanel from "./panels/EventPanel.vue";
import QuestLogPanel from "./panels/QuestLogPanel.vue";
import AIPanel from "./panels/AIPanel.vue";
import SmsPanel from "./sms/SmsPanel.vue";
import type { SmsContact } from "./sms/SmsNewGroupModal.vue";
import type { Conversation } from "./sms/types";
import { getLevelDisplayName } from "./mapConfig";
import type { AISettings } from "./ai/aiConfig";
import { DEFAULT_AI_SETTINGS } from "./ai/aiConfig";

type TabId = "sms" | "bag" | "ring" | "shop" | "skill" | "map" | "role" | "event" | "quest" | "ai";

const props = defineProps<{
  player: any;
  npcs: any[];
  bagItems: any[];
  ringItems: any[];
  ringSkills: any[];
  skills: any[];
  goods: any[];
  goodsSource: string;
  gold: number;
  currentMp: number;
  currentMaxMp: number;
  currentMap: string;
  playerX: number;
  playerY: number;
  mapNodes: any[];
  navPath: string[];
  notice: string;
  /** 事件系统：当前地图事件定义 + flag 状态 + 区域定义 + repeat fire 次数 */
  eventDefs?: any[];
  eventFlags?: Record<string, unknown>;
  eventZones?: { name: string; x: number; y: number; rx?: number; ry?: number; r?: number }[];
  eventRepeatHits?: Record<string, number>;
  /** 任务板：进度视图（宿主 state.questView 权威，本页签只读） */
  questView?: any;
  /** AI 托管配置（系统 → AI 页签） */
  aiSettings?: AISettings;
  /** 当前托管角色数（用于估算请求频率） */
  aiManagedCount?: number;
  /** ★ 通信(短信)：会话列表 */
  smsConversations?: Conversation[];
  /** ★ 通信(短信)：当前打开的会话ID */
  smsActiveId?: string;
  /** ★ 通信(短信)：未读总数（tab 角标） */
  smsUnread?: number;
  /** ★ 通信(短信)：通讯录（新建群聊选人） */
  smsContacts?: SmsContact[];
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

const tabs: { id: TabId; label: string; icon: string }[] = [
  // ★ 通信放第一位 —— 未读消息是高频入口，应该最容易被看到
  { id: "sms", label: "通信", icon: "💬" },
  { id: "bag", label: "背包", icon: "🎒" },
  { id: "ring", label: "纳戒", icon: "💍" },
  { id: "shop", label: "商城", icon: "🏪" },
  { id: "skill", label: "技能", icon: "✨" },
  { id: "map", label: "地图", icon: "🗺" },
  { id: "role", label: "角色", icon: "👥" },
  { id: "event", label: "事件", icon: "⚡" },
  { id: "quest", label: "任务", icon: "📜" },
  { id: "ai", label: "AI", icon: "🤖" },
];

const activeTab = ref<TabId>("sms");

/** ★ 通信 tab 角标：未读数（其它 tab 恒为 0） */
function badgeOf(tabId: TabId): number {
  if (tabId !== "sms") return 0;
  return Math.max(0, Number(props.smsUnread || 0));
}

/** 角标文本（>99 → 99+） */
function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** ★ 切到通信 tab 时同步 store 的当前视图态（未读的实时已读判断依赖它）
 *  immediate —— 组件挂载时 activeTab 已是 "sms"，不 immediate 就漏了首次同步 */
watch(activeTab, (t) => {
  emit("sms-tab-change", t);
}, { immediate: true });

/** AI 配置缺省值（父组件未就绪时用默认值兜底） */
const defaultSettings: AISettings = { ...DEFAULT_AI_SETTINGS };
</script>

<template>
  <div class="sp">
    <div class="sp-head" @pointerdown="emit('drag-start', $event)">
      <span class="sp-title">系统v3.1 · {{ player?.name || "玩家" }}</span>
      <span class="sp-gold">💰{{ gold }}</span>
      <span class="sp-map">{{ getLevelDisplayName(currentMap) }}</span>
      <!-- ★ 必须 @pointerdown.stop：否则 pointerdown 冒泡到 .sp-head 触发 setPointerCapture，
           浏览器把后续 pointerup 重定向到 head → 不在按钮上合成 click → 关闭按钮点了没反应。 -->
      <button class="sp-close" @pointerdown.stop @click="emit('close')" title="关闭">×</button>
    </div>

    <div class="sp-tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="sp-tab"
        :class="{ 'sp-tab--on': activeTab === t.id }"
        @click="activeTab = t.id"
      >
        <span class="sp-tab__icon">{{ t.icon }}</span>{{ t.label }}
        <span v-if="badgeOf(t.id) > 0" class="sp-tab__badge">{{ badgeText(badgeOf(t.id)) }}</span>
      </button>
    </div>

    <div class="sp-body" :class="{ 'sp-body--flush': activeTab === 'sms' }">
      <SmsPanel
        v-if="activeTab === 'sms'"
        :conversations="smsConversations || []"
        :active-id="smsActiveId || ''"
        :contacts="smsContacts || []"
        @select="(id: string) => emit('sms-select', id)"
        @start-chat="(id: string) => emit('sms-start-chat', id)"
        @send="(id: string, text: string) => emit('sms-send', id, text)"
        @create-group="(p: any) => emit('sms-create-group', p)"
        @remove="(id: string) => emit('sms-remove', id)"
        @rename="(id: string, name: string) => emit('sms-rename', id, name)"
      />
      <BagPanel
        v-if="activeTab === 'bag'"
        :items="bagItems"
        @sell="(it: any, n: number) => emit('sell', it, n)"
        @use-item="(it: any) => emit('use-item', it)"
        @sort="(a: number, b: number) => emit('sort', a, b)"
        @sort-auto="() => emit('sort-auto')"
        @move-item="(i: number, dir: number) => emit('move-item', i, dir)"
        @edit-item="(p: any) => emit('edit-item', p)"
      />
      <RingPanel
        v-else-if="activeTab === 'ring'"
        :bag-items="bagItems"
        :bag-skills="skills"
        :ring-items="ringItems"
        :ring-skills="ringSkills"
        @move="(name: string, to: string) => emit('ring-move', name, to)"
        @move-skill="(name: string, to: string) => emit('ring-skill-move', name, to)"
      />
      <ShopPanel
        v-else-if="activeTab === 'shop'"
        :goods="goods"
        :gold="gold"
        :source="goodsSource"
        @buy="(g: any, n: number) => emit('buy', g, n)"
        @refresh="() => emit('shop-refresh')"
        @shop-refresh="() => emit('shop-refresh')"
        @shop-agent="() => emit('shop-agent')"
      />
      <SkillPanel
        v-else-if="activeTab === 'skill'"
        :skills="skills"
        :current-mp="currentMp"
        :current-max-mp="currentMaxMp"
        @use-skill="(s: any, i: number) => emit('use-skill', s, i)"
        @edit-skill="(p: any) => emit('edit-skill', p)"
        @sell-skill="(s: any, idx: number) => emit('sell-skill', s, idx)"
        @move-skill="(i: number, dir: number) => emit('move-skill', i, dir)"
      />
      <MapPanel
        v-else-if="activeTab === 'map'"
        :nodes="mapNodes"
        :current-map="currentMap"
        :player-x="playerX"
        :player-y="playerY"
        :cards="npcs"
        :player="player"
        @travel="(name: string) => emit('travel', name)"
      />
      <RolePanel
        v-else-if="activeTab === 'role'"
        :player="player"
        :cards="npcs"
        :current-map="currentMap"
        @teleport="(c: any) => emit('teleport', c)"
        @follow="(id: string, on: boolean) => emit('follow', id, on)"
        @summon="(c: any) => emit('summon', c)"
        @ai-toggle="(id: string, on: boolean) => emit('ai-toggle', id, on)"
        @open-appearance="(c: any) => emit('open-appearance', c)"
      />
      <EventPanel
        v-else-if="activeTab === 'event'"
        :map-name="currentMap"
        :events="eventDefs || []"
        :flags="eventFlags || {}"
        :event-zones="eventZones"
        :repeat-hits="eventRepeatHits"
        :player-x="playerX"
        :player-y="playerY"
        @set-flag="(k: string, v: unknown) => emit('set-flag', k, v)"
        @del-flag="(k: string) => emit('del-flag', k)"
        @fire-event="(id: string) => emit('fire-event', id)"
        @reload-events="() => emit('reload-events')"
      />
      <QuestLogPanel
        v-else-if="activeTab === 'quest'"
        :view="questView || null"
        :current-map="currentMap"
        :event-zones="eventZones || []"
        @go="(id: string) => emit('quest-go', id)"
        @recover="(id: string) => emit('quest-recover', id)"
        @arrive="(id: string) => emit('quest-arrive', id)"
        @abandon="(id: string) => emit('quest-abandon', id)"
      />
      <AIPanel
        v-else-if="activeTab === 'ai'"
        :settings="aiSettings || defaultSettings"
        :managed-count="aiManagedCount || 0"
        @save="(s: AISettings) => emit('ai-settings-save', s)"
        @reset="() => emit('ai-settings-reset')"
      />
    </div>

    <div class="sp-foot">{{ notice || "拖动标题栏可移动面板；背包内可拖拽排序" }}</div>
  </div>
</template>

<style scoped>
.sp { display: flex; flex-direction: column; height: 100%; color: #e8eef5; font-size: 13px; }
.sp-head { position: relative; display: flex; align-items: center; gap: 8px; padding: 8px 44px 8px 10px; background: rgba(255, 255, 255, 0.06); cursor: move; user-select: none; }
.sp-title { font-weight: 700; }
.sp-gold { margin-left: auto; color: #ffd76a; }
.sp-map { color: #9fd0ff; }
.sp-close { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); border-radius: 4px; color: #cfd8e3; font-size: 15px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; z-index: 10; }
.sp-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
/* ★ position: relative —— 未读角标要绝对定位在 tab 右上角 */
.sp-tab { position: relative; flex: 1 1 30%; padding: 6px 4px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.04); color: #cfd8e3; cursor: pointer; font-size: 12px; }
.sp-tab--on { background: #2f6fd0; border-color: #5a9bff; color: #fff; }
.sp-tab__icon { margin-right: 3px; }
/* ★ 未读角标 —— 红色只留在这里 */
.sp-tab__badge {
  position: absolute;
  top: -5px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #e04a4a;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  pointer-events: none;
}
.sp-body { flex: 1 1 auto; overflow: auto; padding: 8px; }
/* ★ 通信 tab：短信面板自己管滚动 → 关掉外层滚动，避免双滚动条 */
.sp-body--flush { overflow: hidden; padding: 6px; }
.sp-foot { padding: 6px 10px; border-top: 1px solid rgba(255, 255, 255, 0.08); color: #93a2b3; font-size: 11px; min-height: 24px; }
</style>
