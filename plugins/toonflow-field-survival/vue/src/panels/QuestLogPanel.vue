<script setup lang="ts">
/**
 * QuestLogPanel.vue —— 系统面板「任务」页签（只读 + 快捷操作）
 * =====================================================
 * 数据来源：宿主 state.questView（entry.ts buildQuestView 每 tick 重算，前端只读）
 * 用途：接了任务后不回到任务板也能随时查看进度与状态：
 *   进行中（active / 护送失败）· 待交（done）· 已交（turned）
 * ★ 2026-10-18：active 任务上加 4 类快捷按钮，
 *   不再强迫玩家「回任务板才能寻路/找回/到达/放弃」：
 *   · 寻路：active 且有目的地（arrive/explore/deliver gather→arrive）
 *   · 找回：active escort 且 cargoLost=true
 *   · 到达：active 且 atDest=true（走近目的地时浮起的「到达」按钮同款）
 *   · 放弃：active（任何类型）
 * 交付仍需回任务板领取奖励（交任务按钮会触 consume 链，那里是唯一合法入口）。
 */
import { computed } from "vue";
// ★ 采集任务寻路：物品 → 采集区 zone 名映射（与 App.vue questDestinations 同步）
import { GATHER_ZONES_BY_ITEM } from "../questGatherMap";

const emit = defineEmits<{
  (e: "go", id: string): void;
  (e: "recover", id: string): void;
  (e: "arrive", id: string): void;
  (e: "abandon", id: string): void;
}>();

const props = defineProps<{
  view: {
    available: any[];
    active: any[];
    done: any[];
    turned: any[];
    playerLevel: number;
  } | null;
  /** 当前地图（判断 away 任务 / 本图采集区是否可用） */
  currentMap: string;
  /** 当前地图的 eventZones（来自 App.vue eventZonesRef，zone 名→坐标） */
  eventZones?: { name: string; x: number; y: number; r?: number }[];
}>();

const v = computed<any>(() => props.view || { available: [], active: [], done: [], turned: [], playerLevel: 1 });
const avail = computed<any[]>(() => (v.value.available || []));
const active = computed<any[]>(() => (v.value.active || []));
const done = computed<any[]>(() => (v.value.done || []));
const turned = computed<any[]>(() => (v.value.turned || []));

const TYPE_ICON: Record<string, string> = {
  kill: "⚔", gather: "🌿", escort: "📦", deliver: "🎁", explore: "🧭", talk: "💬",
};
const TYPE_LABEL: Record<string, string> = {
  kill: "击杀", gather: "采集", escort: "护送", deliver: "送达", explore: "探索", talk: "对话",
};
const KIND_LABEL: Record<string, string> = {
  kill: "击杀", gather: "采集", arrive: "到达", talk: "对话", explore: "探索",
};

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
    return `${o.confirm ? "到达" : "走进"} ${o.map || "本图"}${o.confirm ? "（需点「到达」）" : ""}`;
  }
  return `${KIND_LABEL[o.kind] || o.kind} ${t} ${o.have}/${o.need}`;
}
function statusBadge(q: any): { text: string; cls: string } {
  if (q.status === "failed") {
    return q.failReason === "timeout"
      ? { text: "超时失败", cls: "ql-badge--fail" }
      : { text: "护送失败", cls: "ql-badge--fail" };
  }
  if (q.status === "done") return { text: "待交付", cls: "ql-badge--done" };
  if (q.status === "turned") return { text: "已交付", cls: "ql-badge--turned" };
  if (q.status === "away") return { text: "别处发布", cls: "ql-badge--away" };
  return { text: "进行中", cls: "ql-badge--active" };
}
/** ★ 限时任务倒计时：remainTicks<0 表示不限时；1 tick = 100ms */
function timerText(q: any): string {
  if (typeof q?.remainTicks !== "number" || q.remainTicks < 0) return "";
  const sec = Math.max(0, Math.ceil(q.remainTicks / 10));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `⏱ 剩余 ${m}:${String(s).padStart(2, "0")}` : `⏱ 剩余 ${s}s`;
}
function timerLow(q: any): boolean {
  return typeof q?.remainTicks === "number" && q.remainTicks >= 0 && q.remainTicks < 300;
}
/** 是否有可寻路的目的地（arrive / explore / deliver 的 arrive 部分）
 *  ★ 2026-10-18 新增：gather 类任务 —— 目标物品在映射表里且本图有对应采集区 */
function hasNavigableDest(q: any): boolean {
  if (!q) return false;
  if (typeof q.destX === "number" && typeof q.destY === "number" && (q.destMap || q.destMapRaw)) return true;
  const objs = q.objectives || [];
  if (objs.some((o: any) => (o.kind === "arrive" || o.kind === "explore")
    && typeof o.x === "number" && typeof o.y === "number"
    && (o.map || o.mapRaw || q.destMap || q.destMapRaw))) return true;
  // ── gather 类（★ 新增）：目标物品在采集映射表里 ──
  if (q.type === "gather" && q.status === "active") {
    const unfinished = objs.find((o: any) => o.kind === "gather"
      && (Number(o.have) || 0) < (Number(o.need) || 1));
    if (!unfinished) return false;
    const candidates = GATHER_ZONES_BY_ITEM[String(unfinished.target || "")];
    if (!candidates || !candidates.length) return false;
    // 只要映射表登记了就能寻路（App.vue questGoToDest 会处理跨图/本地解析）
    return true;
  }
  return false;
}
</script>

<template>
  <div class="ql">
    <div class="ql-stat">
      <span class="ql-stat__item ql-stat__item--active">⏳ 进行中 {{ active.length }}</span>
      <span class="ql-stat__item ql-stat__item--done">✅ 待交 {{ done.length }}</span>
      <span class="ql-stat__item">📁 已交 {{ turned.length }}</span>
      <span class="ql-stat__item ql-stat__item--avail">📜 可接 {{ avail.length }}</span>
    </div>

    <template v-if="!active.length && !done.length && !turned.length">
      <div class="ql-empty">
        还没有进行中的任务。<br />
        走近地图上的「📜 任务板」接取委托后，这里会显示进度与状态。
      </div>
    </template>

    <!-- 进行中 -->
    <template v-if="active.length">
      <div class="ql-sec">⏳ 进行中</div>
      <div v-for="q in active" :key="q.id" class="ql-row">
        <div class="ql-head">
          <span class="ql-type">{{ TYPE_ICON[q.type] || "📋" }}{{ TYPE_LABEL[q.type] || q.type }}</span>
          <span class="ql-title">{{ q.title }}</span>
          <span class="ql-badge" :class="statusBadge(q).cls">{{ statusBadge(q).text }}</span>
          <span v-if="timerText(q)" class="ql-timer" :class="{ 'ql-timer--low': timerLow(q) }">{{ timerText(q) }}</span>
          <span v-if="q.level > v.playerLevel + 2" class="ql-warn">⚠ 偏高</span>
        </div>
        <div v-if="q.desc" class="ql-desc">{{ q.desc }}</div>
        <div class="ql-giver">发布：{{ q.giver }} · 奖励 {{ rewardText(q) }}</div>
        <div v-for="(o, i) in q.objectives" :key="i" class="ql-obj">
          <span class="ql-obj__t">{{ objText(o) }}</span>
          <span class="ql-obj__bar"><i :style="{ width: Math.min(100, (o.need ? o.have / o.need : 0) * 100) + '%' }"></i></span>
        </div>
        <div v-if="q.type === 'escort'" class="ql-cargo">
          货物：<b :class="q.cargoAlive ? 'ql-ok' : 'ql-bad'">{{ q.cargoAlive ? "在" : "已丢失" }}</b>
        </div>
        <!-- ★ 2026-10-18：active 任务的快捷操作（寻路 / 找回 / 到达 / 放弃） -->
        <div class="ql-ops">
          <button v-if="hasNavigableDest(q) && q.status === 'active'"
                  class="ql-btn ql-btn--nav" @click="emit('go', q.id)" title="自动走向任务目的地">🧭 寻路</button>
          <button v-if="q.type === 'escort' && q.cargoLost"
                  class="ql-btn ql-btn--recover" @click="emit('recover', q.id)" title="货物在 6m 范围内被找到（实测 ≈1.2m 贴身）">🔄 找回货物</button>
          <button v-if="q.atDest"
                  class="ql-btn ql-btn--arrive" @click="emit('arrive', q.id)" title="已走到目的地，点击完成到达校验">📍到达</button>
          <button v-if="q.status === 'active'"
                  class="ql-btn ql-btn--abandon" @click="emit('abandon', q.id)" title="放弃该任务（失败态/已完成态不可放弃）">放弃</button>
        </div>
      </div>
    </template>

    <!-- 待交 -->
    <template v-if="done.length">
      <div class="ql-sec">✅ 待交付</div>
      <div v-for="q in done" :key="q.id" class="ql-row ql-row--done">
        <div class="ql-head">
          <span class="ql-type">{{ TYPE_ICON[q.type] || "📋" }}{{ TYPE_LABEL[q.type] || q.type }}</span>
          <span class="ql-title">{{ q.title }}</span>
          <span class="ql-badge" :class="statusBadge(q).cls">{{ statusBadge(q).text }}</span>
        </div>
        <div v-if="q.desc" class="ql-desc">{{ q.desc }}</div>
        <div class="ql-giver">发布：{{ q.giver }} · 奖励 {{ rewardText(q) }}</div>
        <div v-for="(o, i) in q.objectives" :key="i" class="ql-obj">
          <span class="ql-obj__t">{{ objText(o) }}</span>
          <span class="ql-obj__bar"><i :style="{ width: '100%' }"></i></span>
        </div>
        <div class="ql-hint">目标已达成，回任务板交付领奖</div>
      </div>
    </template>

    <!-- 已交 -->
    <template v-if="turned.length">
      <div class="ql-sec">📁 已交付</div>
      <div v-for="q in turned" :key="q.id" class="ql-row ql-row--turned">
        <div class="ql-head">
          <span class="ql-type">{{ TYPE_ICON[q.type] || "📋" }}{{ TYPE_LABEL[q.type] || q.type }}</span>
          <span class="ql-title">{{ q.title }}</span>
          <span class="ql-badge" :class="statusBadge(q).cls">{{ statusBadge(q).text }}</span>
        </div>
        <div class="ql-giver">发布：{{ q.giver }} · 奖励 {{ rewardText(q) }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ql { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #dfe7ef; }
.ql-stat { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11px; }
.ql-stat__item { padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25); color: #a9b6c4; }
.ql-stat__item--active { color: #ffd76a; border-color: rgba(255,215,106,0.4); }
.ql-stat__item--done { color: #66bb6a; border-color: rgba(102,187,106,0.4); }
.ql-stat__item--avail { color: #9fd0ff; border-color: rgba(159,208,255,0.4); }

.ql-sec { font-size: 11px; color: #93a2b3; margin-top: 4px; letter-spacing: 1px; }
.ql-empty { color: #6d7c8c; font-size: 11px; padding: 14px 6px; line-height: 1.8; text-align: center; }

.ql-row { padding: 6px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(0,0,0,0.18); }
.ql-row--done { border-left: 3px solid #66bb6a; }
.ql-row--turned { opacity: 0.75; }
.ql-head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.ql-title { font-size: 12px; color: #ffe8bd; }
.ql-type { font-size: 10px; padding: 0 4px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.18); color: #9fd0ff; }
.ql-warn { font-size: 10px; color: #ffb26b; }
.ql-timer { font-size: 10px; color: #9fd0ff; border: 1px solid rgba(159,208,255,0.35); border-radius: 3px; padding: 0 4px; }
.ql-timer--low { color: #ff6b6b; border-color: rgba(255,107,107,0.55); animation: ql-pulse 1s infinite; }
@keyframes ql-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
.ql-badge { font-size: 9px; border-radius: 3px; padding: 0 4px; border: 1px solid rgba(255,255,255,0.2); color: #cfd8e3; }
.ql-badge--active { color: #ffd76a; border-color: rgba(255,215,106,0.5); }
.ql-badge--done { color: #66bb6a; border-color: rgba(102,187,106,0.5); }
.ql-badge--fail { color: #ef5350; border-color: rgba(239,83,80,0.5); }
.ql-badge--turned { color: #93a2b3; }
.ql-badge--away { color: #93a2b3; }
.ql-desc { font-size: 11px; color: #9fb0c1; margin-top: 2px; }
.ql-giver { font-size: 10px; color: #7f8f9f; margin-top: 1px; }

.ql-obj { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #c3cfdb; margin-top: 2px; }
.ql-obj__t { min-width: 120px; }
.ql-obj__bar { flex: 1 1 auto; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
.ql-obj__bar i { display: block; height: 100%; background: #66bb6a; }
.ql-cargo { font-size: 11px; color: #93a2b3; margin-top: 2px; }
.ql-ok { color: #66bb6a; }
.ql-bad { color: #ef5350; }
.ql-hint { font-size: 10px; color: #ffd76a; margin-top: 3px; }

/* ★ 快捷操作按钮（与 QuestPanel .qp-btn 风格一致，便于玩家认知） */
.ql-ops { display: flex; gap: 5px; margin-top: 4px; flex-wrap: wrap; }
.ql-btn {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(255,255,255,0.06);
  color: #dfe7ef;
  cursor: pointer;
  transition: background 0.15s;
}
.ql-btn:hover { background: rgba(255,255,255,0.16); }
.ql-btn--nav { color: #9fd0ff; border-color: rgba(159,208,255,0.4); }
.ql-btn--nav:hover { background: rgba(159,208,255,0.18); }
.ql-btn--recover { color: #ffb26b; border-color: rgba(255,178,107,0.4); }
.ql-btn--recover:hover { background: rgba(255,178,107,0.18); }
.ql-btn--arrive { color: #66bb6a; border-color: rgba(102,187,106,0.4); background: rgba(102,187,106,0.15); }
.ql-btn--arrive:hover { background: rgba(102,187,106,0.28); }
.ql-btn--abandon { color: #ef5350; border-color: rgba(239,83,80,0.35); }
.ql-btn--abandon:hover { background: rgba(239,83,80,0.15); }
</style>
