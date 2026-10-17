<script setup lang="ts">
/**
 * QuestPanel.vue —— 任务板面板
 * =====================================================
 * 数据来源：宿主 state.questView（entry.ts buildQuestView 每 tick 重算，前端只读）
 *   available 可接（含 away = 别的地图发布的）
 *   active    进行中 / 护送失败
 *   done      已完成待交
 *   turned    已交（不可重复）
 * 操作：接取 / 寻路（自动走到目的地）/ 到达（护送·送达点「到达」）/ 找回货物 / 交任务领奖 / 放弃 / 详情（AI 回答）
 *       AI 生成委托（sys_quest_generate）
 */
import { ref, computed } from "vue";

const props = defineProps<{
  view: {
    available: any[];
    active: any[];
    done: any[];
    turned: any[];
    playerLevel: number;
  } | null;
  /** 正在等 AI 回答 */
  asking: boolean;
  /** AI 对任务的回答 */
  aiText: string;
  /** 当前地图（判断 away 任务） */
  currentMap: string;
}>();

const emit = defineEmits<{
  (e: "accept", id: string): void;
  (e: "turnin", id: string): void;
  (e: "abandon", id: string): void;
  (e: "arrive", id: string): void;
  (e: "go", id: string): void;
  (e: "recover", id: string): void;
  (e: "ask", id: string, question: string): void;
  (e: "generate"): void;
}>();

type TabId = "available" | "active" | "done" | "turned";
const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: "available", label: "可接", icon: "📜" },
  { id: "active", label: "进行中", icon: "⏳" },
  { id: "done", label: "待交", icon: "✅" },
  { id: "turned", label: "已交", icon: "📁" },
];
const activeTab = ref<TabId>("available");

const v = computed(() => props.view || { available: [], active: [], done: [], turned: [], playerLevel: 1 });
const list = computed<any[]>(() => (v.value as any)[activeTab.value] || []);
const counts = computed(() => ({
  available: v.value.available.length,
  active: v.value.active.length,
  done: v.value.done.length,
  turned: v.value.turned.length,
}));

const TYPE_LABEL: Record<string, string> = {
  kill: "击杀", gather: "采集", escort: "护送", deliver: "送达", explore: "探索", talk: "对话",
};
const TYPE_ICON: Record<string, string> = {
  kill: "⚔", gather: "🌿", escort: "📦", deliver: "🎁", explore: "🧭", talk: "💬",
};
const KIND_LABEL: Record<string, string> = {
  kill: "击杀", gather: "采集", arrive: "到达", talk: "对话", explore: "探索",
};

/** 展开详情的任务 id（点「详情」切换） */
const detailId = ref<string>("");
const askText = ref<Record<string, string>>({});

function toggleDetail(id: string) {
  detailId.value = detailId.value === id ? "" : id;
  if (detailId.value && !props.aiText) emit("ask", id, "");
}
function rewardText(q: any): string {
  const r = q?.reward || {};
  const parts: string[] = [];
  if (r.exp) parts.push(`${r.exp}exp`);
  if (r.money) parts.push(`${r.money}金`);
  for (const it of r.items || []) parts.push(`${it.name}×${it.count}`);
  return parts.join(" · ") || "无奖励";
}
function objText(o: any): string {
  const t = o.target || o.kind;
  if (o.kind === "arrive" || o.kind === "explore") {
    const where = o.map || "本图";
    // ★ 有坐标就把坐标写出来（玩家知道往哪走；寻路按钮也会带过去）
    const pos = (o.x !== undefined && o.y !== undefined)
      ? `（${Math.round(Number(o.x))}, ${Math.round(Number(o.y))}，${Math.max(0.5, Math.round(Number(o.radius) || 3))}m 内）`
      : "";
    return `${o.confirm ? "到达" : "走进"} ${where}${pos}${o.confirm ? "，需点「到达」" : ""}`;
  }
  return `${KIND_LABEL[o.kind] || o.kind} ${t} ${o.have}/${o.need}`;
}
/** ★ 限时任务：倒计时文案（1 tick = 100ms；remainTicks<0 = 不限时） */
function timerText(q: any): string {
  if (typeof q?.remainTicks !== "number" || q.remainTicks < 0) return "";
  const sec = Math.max(0, Math.ceil(q.remainTicks / 10));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `⏱ ${m}:${String(s).padStart(2, "0")}` : `⏱ ${s}s`;
}
function timerLow(q: any): boolean {
  return typeof q?.remainTicks === "number" && q.remainTicks >= 0 && q.remainTicks < 300;
}
function failText(q: any): string {
  return q?.failReason === "timeout" ? "超时失败" : "护送失败";
}
</script>

<template>
  <div class="qp">
    <div class="qp-bar">
      <span class="qp-stat">等级 Lv.{{ v.playerLevel }}</span>
      <span class="qp-map">📍 {{ currentMap }}</span>
      <button class="qp-mini qp-mini--ai" title="让 AI 按当前故事与地图生成新的委托" @click="emit('generate')">AI 生成委托</button>
    </div>

    <div class="qp-tabs">
      <button
        v-for="t in tabs" :key="t.id"
        class="qp-tab" :class="{ 'qp-tab--on': activeTab === t.id }"
        @click="activeTab = t.id"
      >
        <span class="qp-tab__icon">{{ t.icon }}</span>{{ t.label }}
        <span class="qp-tab__n">{{ counts[t.id] }}</span>
      </button>
    </div>

    <div class="qp-list">
      <div v-if="!list.length" class="qp-empty">
        {{ activeTab === "available" ? "这里暂时没有新委托，点右上「AI 生成委托」试试。" : "（无）" }}
      </div>

      <div v-for="q in list" :key="q.id" class="qp-row" :class="{ 'qp-row--done': q.status === 'done', 'qp-row--fail': q.status === 'failed' }">
        <div class="qp-head">
          <span class="qp-type" :title="q.type">{{ TYPE_ICON[q.type] || "📋" }}{{ TYPE_LABEL[q.type] || q.type }}</span>
          <span class="qp-title">{{ q.title }}</span>
          <span v-if="q.level > v.playerLevel + 2" class="qp-warn" :title="`推荐 Lv.${q.level}`">⚠ 偏高</span>
          <span v-if="timerText(q)" class="qp-timer" :class="{ 'qp-timer--low': timerLow(q) }" title="限时任务剩余时间">{{ timerText(q) }}</span>
          <span v-if="q.status === 'failed'" class="qp-badge qp-badge--fail">{{ failText(q) }}</span>
          <span v-if="q.repeat" class="qp-badge qp-badge--rep">可重复</span>
          <span v-if="q.status === 'away'" class="qp-badge qp-badge--away">别处发布</span>
        </div>

        <div v-if="q.desc" class="qp-desc">{{ q.desc }}</div>
        <div class="qp-giver">发布：{{ q.giver }} · 奖励 {{ rewardText(q) }}</div>

        <div v-for="(o, i) in q.objectives" :key="i" class="qp-obj">
          <span class="qp-obj__t">{{ objText(o) }}</span>
          <span class="qp-obj__bar"><i :style="{ width: Math.min(100, (o.need ? o.have / o.need : 0) * 100) + '%' }"></i></span>
        </div>
        <div v-if="q.type === 'escort' && (q.status === 'active' || q.status === 'failed')" class="qp-cargo">
          货物：<b :class="q.cargoAlive ? 'qp-ok' : 'qp-bad'">{{ q.cargoAlive ? "在" : "已丢失" }}</b>
          <button
            v-if="q.cargoLost"
            class="qp-btn qp-btn--recover"
            title="货物不见了：把它召回到你身边（任务超时失败的不救）"
            @click="emit('recover', q.id)"
          >🔄 找回货物</button>
        </div>

        <div class="qp-ops">
          <button v-if="q.status === 'available' || q.status === 'away'" class="qp-btn" @click="emit('accept', q.id)">接取</button>
          <button
            v-if="q.canArrive && !q.arrived"
            class="qp-btn qp-btn--go"
            :disabled="!q.atDest"
            :title="q.atDest ? '点击到达' : '还没走到目的地（可点「寻路」自动走过去）'"
            @click="emit('arrive', q.id)"
          >
            {{ q.atDest ? "到达" : "未到目的地" }}
          </button>
          <!-- ★ 寻路：点击后自动走到目的地（同图 A*；跨图先传送再走） -->
          <button
            v-if="q.destX !== undefined && q.destY !== undefined"
            class="qp-btn qp-btn--nav"
            :title="q.destMap && q.destMap !== currentMap ? `目的地在${q.destMap}，先传送再自动走` : '自动寻路到目的地'"
            @click="emit('go', q.id)"
          >🧭 寻路</button>
          <button v-if="q.canTurnIn" class="qp-btn qp-btn--ok" @click="emit('turnin', q.id)">交任务</button>
          <button v-if="q.status === 'active' || q.status === 'failed' || q.status === 'done'" class="qp-btn qp-btn--ghost" @click="emit('abandon', q.id)">放弃</button>
          <button class="qp-btn qp-btn--ghost" @click="toggleDetail(q.id)">{{ detailId === q.id ? "收起" : "详情" }}</button>
        </div>

        <div v-if="detailId === q.id" class="qp-detail">
          <div class="qp-detail__meta">
            id {{ q.id }} · 状态 {{ q.status }} · 进度 {{ q.progress || "—" }}
          </div>
          <div class="qp-detail__qa">
            <input v-model="askText[q.id]" class="qp-detail__input" placeholder="问任务板：这个任务该怎么走？" @keyup.enter="emit('ask', q.id, askText[q.id] || '')" />
            <button class="qp-btn" :disabled="asking" @click="emit('ask', q.id, askText[q.id] || '')">{{ asking ? "思考中…" : "问" }}</button>
          </div>
          <div v-if="asking" class="qp-detail__ai qp-detail__ai--wait">…任务板正在回想…</div>
          <div v-else-if="aiText" class="qp-detail__ai">{{ aiText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qp { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #dfe7ef; }
.qp-bar { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #cfd8e3; }
.qp-stat { color: #ffd76a; }
.qp-map { color: #93a2b3; }
.qp-mini { margin-left: auto; padding: 3px 8px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.06); color: #cfd8e3; font-size: 11px; cursor: pointer; }
.qp-mini--ai { border-color: #7a5aff; background: rgba(122,90,255,0.18); color: #c9baff; }

.qp-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.qp-tab { padding: 3px 8px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25); color: #a9b6c4; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 3px; }
.qp-tab--on { border-color: #d4a13e; color: #ffe0a0; background: rgba(212,161,62,0.16); }
.qp-tab__n { font-size: 10px; opacity: 0.8; }

.qp-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
.qp-empty { color: #6d7c8c; font-size: 11px; padding: 8px 2px; }

.qp-row { padding: 6px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(0,0,0,0.18); }
.qp-row--done { border-left: 3px solid #66bb6a; }
.qp-row--fail { border-left: 3px solid #ef5350; }
.qp-head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.qp-title { font-size: 12px; color: #ffe8bd; }
.qp-type { font-size: 10px; padding: 0 4px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.18); color: #9fd0ff; }
.qp-warn { font-size: 10px; color: #ffb26b; }
.qp-badge { font-size: 9px; border-radius: 3px; padding: 0 4px; border: 1px solid rgba(255,255,255,0.2); color: #cfd8e3; }
.qp-badge--fail { color: #ef5350; border-color: rgba(239,83,80,0.5); }
.qp-badge--rep { color: #ffd76a; border-color: rgba(255,215,106,0.5); }
.qp-badge--away { color: #93a2b3; }
.qp-timer { font-size: 9px; border-radius: 3px; padding: 0 4px; border: 1px solid rgba(159,208,255,0.35); color: #9fd0ff; }
.qp-timer--low { color: #ff6b6b; border-color: rgba(255,107,107,0.55); animation: qp-pulse 1s infinite; }
@keyframes qp-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
.qp-desc { font-size: 11px; color: #9fb0c1; margin-top: 2px; }
.qp-giver { font-size: 10px; color: #7f8f9f; }

.qp-obj { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #c3cfdb; margin-top: 2px; }
.qp-obj__t { min-width: 120px; }
.qp-obj__bar { flex: 1 1 auto; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
.qp-obj__bar i { display: block; height: 100%; background: #66bb6a; }
.qp-cargo { font-size: 11px; color: #93a2b3; }
.qp-ok { color: #66bb6a; }
.qp-bad { color: #ef5350; }

.qp-ops { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
.qp-btn { padding: 3px 9px; border-radius: 5px; border: 1px solid #5a9bff; background: #2f6fd0; color: #fff; font-size: 11px; cursor: pointer; }
.qp-btn:disabled { border-color: #4a5563; background: #3a434f; color: #8b98a6; cursor: not-allowed; }
.qp-btn--ok { border-color: #4caf50; background: #2e7d32; }
.qp-btn--go { border-color: #d4a13e; background: #8a6520; }
.qp-btn--ghost { border-color: rgba(255,255,255,0.25); background: rgba(255,255,255,0.08); color: #cfd8e3; }
/* ★ 寻路（青色）+ 找回货物（紫红） */
.qp-btn--nav { border-color: #4db8e8; background: #1d5f80; }
.qp-btn--recover { border-color: #e07fb8; background: #7a2f56; margin-left: 6px; }

.qp-detail { margin-top: 5px; padding: 6px; border: 1px solid rgba(255,255,255,0.12); border-radius: 5px; background: rgba(0,0,0,0.28); }
.qp-detail__meta { font-size: 10px; color: #7f8f9f; }
.qp-detail__qa { display: flex; gap: 5px; margin-top: 4px; }
.qp-detail__input { flex: 1 1 auto; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; color: #e6eef6; font-size: 11px; padding: 3px 5px; }
.qp-detail__ai { margin-top: 4px; font-size: 11px; color: #d9e4ef; background: rgba(122,90,255,0.12); border-left: 2px solid #7a5aff; padding: 4px 6px; border-radius: 3px; }
.qp-detail__ai--wait { color: #8b98a6; font-style: italic; }
</style>
