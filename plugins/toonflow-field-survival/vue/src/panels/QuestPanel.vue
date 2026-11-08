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
 *
 * ★ 主线任务链（tab「主线」）：
 *   数据来源：宿主 state.chainView（entry.ts buildChainView 每 tick 重算，前端只读）
 *   链视图含：主线总进度 / 每条链的状态与节点 / 分支候选 / 失败原因
 *   操作：开始主线 / 接取节点 / 交任务 / 暂停 / 继续 / 放弃(=失败) / 选分支 / 从头再来
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
  /** ★ 主线任务链视图（宿主 state.chainView） */
  chainView?: {
    chains: any[];
    playerLevel: number;
    currentMap: string;
    mainDone: number;
    mainTotal: number;
    sideDone: number;
    sideTotal: number;
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
  /* ★ 主线链操作 */
  (e: "chain-start", id: string): void;
  /** ★ 主线节点寻路：参数是**节点的 questId**（委托系统里的 id，questGoToDest 按它查） */
  (e: "chain-go", questId: string): void;
  (e: "chain-choose", id: string, node: string): void;
  (e: "chain-accept", id: string, node: string): void;
  (e: "chain-turnin", id: string, node: string): void;
  (e: "chain-pause", id: string, node: string): void;
  (e: "chain-resume", id: string, node: string): void;
  (e: "chain-abandon", id: string, node: string): void;
  (e: "chain-retry", id: string): void;
}>();

type TabId = "main" | "available" | "active" | "done" | "turned";
const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: "main", label: "主线", icon: "★" },
  { id: "available", label: "可接", icon: "📜" },
  { id: "active", label: "进行中", icon: "⏳" },
  { id: "done", label: "待交", icon: "✅" },
  { id: "turned", label: "已交", icon: "📁" },
];
const activeTab = ref<TabId>("main");

const v = computed(() => props.view || { available: [], active: [], done: [], turned: [], playerLevel: 1 });
const list = computed<any[]>(() => (v.value as any)[activeTab.value] || []);
const counts = computed(() => ({
  main: (cv.value.chains || []).filter((c: any) => c.status === "running" || c.status === "awaiting_choice").length,
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

/* ══════════════════════════════════════════════════════════════
   ★ 主线任务链
   ══════════════════════════════════════════════════════════════ */
const cv = computed<any>(() => props.chainView || {
  chains: [], playerLevel: 1, currentMap: "", mainDone: 0, mainTotal: 0, sideDone: 0, sideTotal: 0,
});

/** 主线链（不含支线） */
const mainChains = computed<any[]>(() => (cv.value.chains || []).filter((c: any) => !c.side));
/** 支线链 */
const sideChains = computed<any[]>(() => (cv.value.chains || []).filter((c: any) => c.side));

/** 主线总进度百分比（按已完成链数 / 总链数） */
const mainPercent = computed<number>(() => {
  const total = Number(cv.value.mainTotal) || 0;
  if (!total) return 0;
  return Math.round((Number(cv.value.mainDone) || 0) / total * 100);
});

/** 链状态文案 + 配色 class */
const CHAIN_STATUS: Record<string, { text: string; cls: string }> = {
  locked: { text: "未解锁", cls: "ch-lock" },
  available: { text: "可接取", cls: "ch-avail" },
  running: { text: "进行中", cls: "ch-run" },
  awaiting_choice: { text: "待抉择", cls: "ch-choice" },
  failed: { text: "已失败", cls: "ch-fail" },
  completed: { text: "已完成", cls: "ch-done" },
};
function chainStatus(c: any): { text: string; cls: string } {
  return CHAIN_STATUS[String(c?.status)] || { text: String(c?.status || ""), cls: "" };
}

/** 节点状态文案 + 配色 class */
const NODE_STATUS: Record<string, { text: string; cls: string }> = {
  locked: { text: "未开启", cls: "nd-lock" },
  selectable: { text: "可接取", cls: "nd-avail" },
  active: { text: "进行中", cls: "nd-run" },
  paused: { text: "已暂停", cls: "nd-pause" },
  done: { text: "已完成", cls: "nd-done" },
  failed: { text: "已失败", cls: "nd-fail" },
};
function nodeStatus(n: any): { text: string; cls: string } {
  return NODE_STATUS[String(n?.status)] || { text: String(n?.status || ""), cls: "" };
}

/** 节点失败原因文案 */
function nodeFailText(n: any): string {
  return n?.failReason === "timeout" ? "超时失败" : "已放弃";
}

/** 链的进度条百分比 */
function chainPercent(c: any): number {
  const total = Number(c?.progressTotal) || 0;
  if (!total) return 0;
  return Math.round((Number(c?.progressDone) || 0) / total * 100);
}

/** 当前进行中/暂停中的节点（链内至多一个） */
function activeNode(c: any): any {
  return (c?.nodes || []).find((n: any) => n.status === "active" || n.status === "paused") || null;
}
/** 待抉择的候选节点（引擎给出的分支列表） */
function choiceNodes(c: any): any[] {
  const ids: string[] = c?.awaitChoice?.options || [];
  return (c?.nodes || []).filter((n: any) => ids.indexOf(String(n.id)) >= 0);
}
/** ★ 主线节点是否有可寻路的目的地（arrive/explore 且带坐标）
 *  与委托寻路同口径：destination 的 x/y 存在 + 有地图归属。
 *  gather/kill/talk 类没有固定目的地 → 不显示寻路按钮。 */
function nodeHasDest(n: any): boolean {
  if (!n) return false;
  if (typeof n.destX === "number" && typeof n.destY === "number") {
    return !!(n.destMapRaw || n.destMap);
  }
  return (n.objectives || []).some((o: any) =>
    (o.kind === "arrive" || o.kind === "explore")
    && typeof o.x === "number" && typeof o.y === "number");
}
/** 链的前置未完成（用于「未解锁」提示） */
function lockedByNames(c: any, all: any[]): string {
  const ids: string[] = c?.lockedBy || [];
  return ids
    .map((id: string) => (all.find((x: any) => String(x.id) === String(id)) || {}).title || id)
    .join("、");
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
        <span v-if="t.id === 'main'" class="qp-tab__n">{{ counts.main }}</span>
        <span v-else class="qp-tab__n">{{ counts[t.id] }}</span>
      </button>
    </div>

    <!-- ══ ★ 主线任务链 ══ -->
    <div v-if="activeTab === 'main'" class="qp-chain">
      <!-- 主线总进度 -->
      <div class="ch-head">
        <div class="ch-head__row">
          <span class="ch-head__title">★ 主线进度</span>
          <span class="ch-head__num">{{ cv.mainDone }}/{{ cv.mainTotal }} 条主线</span>
        </div>
        <div class="ch-head__bar"><i :style="{ width: mainPercent + '%' }"></i></div>
        <div v-if="cv.sideTotal" class="ch-head__side">支线 {{ cv.sideDone }}/{{ cv.sideTotal }}</div>
      </div>

      <div v-if="!mainChains.length && !sideChains.length" class="qp-empty">
        这个故事还没有配置主线任务链。
      </div>

      <!-- 主线链列表 -->
      <div v-for="c in mainChains" :key="c.id" class="ch-card" :class="chainStatus(c).cls">
        <div class="ch-card__head">
          <span class="ch-card__name">{{ c.title }}</span>
          <span class="ch-badge" :class="chainStatus(c).cls">{{ chainStatus(c).text }}</span>
          <span class="ch-card__prog">{{ c.progressDone }}/{{ c.progressTotal }}</span>
        </div>
        <div v-if="c.chapter" class="ch-card__chapter">{{ c.chapter }}</div>
        <div v-if="c.desc" class="ch-card__desc">{{ c.desc }}</div>
        <div class="ch-card__bar"><i :style="{ width: chainPercent(c) + '%' }"></i></div>

        <!-- 未解锁：提示前置主线 -->
        <div v-if="c.status === 'locked'" class="ch-locktip">
          🔒 需先完成：{{ lockedByNames(c, cv.chains) || "前置主线" }}
        </div>

        <!-- 可接取（已解锁未开始） -->
        <div v-if="c.status === 'available'" class="ch-ops">
          <button class="qp-btn qp-btn--ok" @click="emit('chain-start', c.id)">开始这条主线</button>
        </div>

        <!-- 待抉择：多分支选择卡 -->
        <div v-if="c.status === 'awaiting_choice'" class="ch-choice">
          <div class="ch-choice__t">🔀 前方有分歧，选一条路：</div>
          <div v-for="n in choiceNodes(c)" :key="n.id" class="ch-choice__opt">
            <div class="ch-choice__name">{{ n.title }}</div>
            <div v-if="n.desc" class="ch-choice__desc">{{ n.desc }}</div>
            <div class="ch-choice__ops">
              <button class="qp-btn qp-btn--ok" @click="emit('chain-choose', c.id, n.id)">选择这条路</button>
            </div>
          </div>
        </div>

        <!-- 失败：可从头再来 -->
        <div v-if="c.status === 'failed'" class="ch-failtip">
          <span>这条主线中断了。</span>
          <button class="qp-btn qp-btn--warn" @click="emit('chain-retry', c.id)">从头再来</button>
        </div>

        <!-- 节点列表 -->
        <div class="ch-nodes">
          <div v-for="n in c.nodes" :key="n.id" class="ch-node" :class="nodeStatus(n).cls">
            <div class="ch-node__head">
              <span class="ch-node__dot"></span>
              <span class="ch-node__name">{{ n.title }}</span>
              <span class="ch-badge ch-badge--sm" :class="nodeStatus(n).cls">{{ nodeStatus(n).text }}</span>
              <span v-if="n.status === 'failed'" class="ch-node__fail">{{ nodeFailText(n) }}</span>
              <span v-if="n.status === 'active' && timerText(n)" class="qp-timer" :class="{ 'qp-timer--low': timerLow(n) }">{{ timerText(n) }}</span>
            </div>
            <div v-if="n.desc" class="ch-node__desc">{{ n.desc }}</div>

            <!-- 目标进度 -->
            <div v-for="(o, i) in n.objectives" :key="i" class="qp-obj">
              <span class="qp-obj__t">{{ objText(o) }}</span>
              <span class="qp-obj__bar"><i :style="{ width: Math.min(100, (o.need ? o.have / o.need : 0) * 100) + '%' }"></i></span>
            </div>
            <div v-if="n.desc" class="ch-node__rw">奖励 {{ rewardText(n) }}</div>

            <!-- 节点操作 -->
            <div class="ch-node__ops">
              <button v-if="n.status === 'selectable'" class="qp-btn qp-btn--ok" @click="emit('chain-accept', c.id, n.id)">接取</button>
              <button
                v-if="n.status === 'active' && nodeHasDest(n)"
                class="qp-btn qp-btn--nav"
                title="自动走到任务目的地"
                @click="emit('chain-go', n.questId)"
              >🧭 寻路</button>
              <button v-if="n.status === 'active' && n.canTurnIn" class="qp-btn qp-btn--ok" @click="emit('chain-turnin', c.id, n.id)">交任务</button>
              <button v-if="n.status === 'active'" class="qp-btn qp-btn--pause" title="暂停任务（进度保留，限时计时冻结）" @click="emit('chain-pause', c.id, n.id)">⏸ 暂停</button>
              <button v-if="n.status === 'paused'" class="qp-btn qp-btn--go" title="继续任务" @click="emit('chain-resume', c.id, n.id)">▶ 继续</button>
              <button v-if="n.status === 'active' || n.status === 'paused'" class="qp-btn qp-btn--bad" title="放弃任务（视为失败）" @click="emit('chain-abandon', c.id, n.id)">放弃</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 支线链 -->
      <div v-if="sideChains.length" class="ch-side">
        <div class="ch-side__t">支线（{{ cv.sideDone }}/{{ cv.sideTotal }}）</div>
        <div v-for="c in sideChains" :key="c.id" class="ch-card ch-card--side" :class="chainStatus(c).cls">
          <div class="ch-card__head">
            <span class="ch-card__name">{{ c.title }}</span>
            <span class="ch-badge" :class="chainStatus(c).cls">{{ chainStatus(c).text }}</span>
            <span class="ch-card__prog">{{ c.progressDone }}/{{ c.progressTotal }}</span>
          </div>
          <div v-if="c.desc" class="ch-card__desc">{{ c.desc }}</div>
          <div class="ch-card__bar"><i :style="{ width: chainPercent(c) + '%' }"></i></div>
          <div v-if="c.status === 'available'" class="ch-ops">
            <button class="qp-btn qp-btn--ok" @click="emit('chain-start', c.id)">开始</button>
          </div>
          <div v-for="n in c.nodes" :key="n.id" class="ch-node" :class="nodeStatus(n).cls">
            <div class="ch-node__head">
              <span class="ch-node__dot"></span>
              <span class="ch-node__name">{{ n.title }}</span>
              <span class="ch-badge ch-badge--sm" :class="nodeStatus(n).cls">{{ nodeStatus(n).text }}</span>
            </div>
            <div v-if="n.desc" class="ch-node__desc">{{ n.desc }}</div>
            <div class="ch-node__ops">
              <button v-if="n.status === 'selectable'" class="qp-btn qp-btn--ok" @click="emit('chain-accept', c.id, n.id)">接取</button>
              <button
                v-if="n.status === 'active' && nodeHasDest(n)"
                class="qp-btn qp-btn--nav"
                title="自动走到任务目的地"
                @click="emit('chain-go', n.questId)"
              >🧭 寻路</button>
              <button v-if="n.status === 'active' && n.canTurnIn" class="qp-btn qp-btn--ok" @click="emit('chain-turnin', c.id, n.id)">交任务</button>
              <button v-if="n.status === 'active'" class="qp-btn qp-btn--pause" @click="emit('chain-pause', c.id, n.id)">⏸ 暂停</button>
              <button v-if="n.status === 'paused'" class="qp-btn qp-btn--go" @click="emit('chain-resume', c.id, n.id)">▶ 继续</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="qp-list">
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

/* ══ ★ 主线任务链样式 ══ */
.qp-chain { display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow-y: auto; }

/* 总进度头 */
.ch-head { padding: 6px 8px; border: 1px solid rgba(212,161,62,0.32); border-radius: 6px; background: linear-gradient(180deg, rgba(212,161,62,0.12), rgba(0,0,0,0.2)); }
.ch-head__row { display: flex; align-items: baseline; gap: 8px; }
.ch-head__title { font-size: 12px; color: #ffe0a0; font-weight: 600; }
.ch-head__num { font-size: 11px; color: #cfd8e3; margin-left: auto; }
.ch-head__side { font-size: 10px; color: #8b98a6; margin-top: 2px; }
.ch-head__bar { height: 5px; margin-top: 4px; border-radius: 3px; background: rgba(0,0,0,0.4); overflow: hidden; }
.ch-head__bar i { display: block; height: 100%; background: linear-gradient(90deg, #d4a13e, #ffd76a); transition: width .25s; }

/* 链卡片 */
.ch-card { padding: 6px 7px; border: 1px solid rgba(255,255,255,0.1); border-left: 3px solid rgba(255,255,255,0.16); border-radius: 6px; background: rgba(0,0,0,0.2); }
.ch-card--side { opacity: .92; }
.ch-card__head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.ch-card__name { font-size: 12px; color: #ffe8bd; font-weight: 600; }
.ch-card__prog { font-size: 10px; color: #8b98a6; margin-left: auto; }
.ch-card__chapter { font-size: 10px; color: #8b98a6; margin-top: 1px; }
.ch-card__desc { font-size: 11px; color: #9fb0c1; margin-top: 2px; line-height: 1.45; }
.ch-card__bar { height: 3px; margin-top: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; }
.ch-card__bar i { display: block; height: 100%; background: #d4a13e; transition: width .25s; }
.ch-ops { display: flex; gap: 5px; margin-top: 5px; }

/* 链状态配色 */
.ch-lock { border-left-color: #4a5563 !important; }
.ch-avail { border-left-color: #5a9bff !important; }
.ch-run { border-left-color: #d4a13e !important; }
.ch-choice { border-left-color: #a06bff !important; }
.ch-fail { border-left-color: #ef5350 !important; }
.ch-done { border-left-color: #66bb6a !important; }

/* 徽章 */
.ch-badge { font-size: 9px; border-radius: 3px; padding: 0 4px; border: 1px solid rgba(255,255,255,0.22); color: #cfd8e3; }
.ch-badge--sm { font-size: 9px; }
.ch-badge.ch-lock { color: #8b98a6; border-color: rgba(139,152,166,0.4); }
.ch-badge.ch-avail { color: #9fd0ff; border-color: rgba(90,155,255,0.5); }
.ch-badge.ch-run { color: #ffe0a0; border-color: rgba(212,161,62,0.5); }
.ch-badge.ch-choice { color: #d8bcff; border-color: rgba(160,107,255,0.5); }
.ch-badge.ch-fail { color: #ff8a8a; border-color: rgba(239,83,80,0.5); }
.ch-badge.ch-done { color: #9fe29f; border-color: rgba(102,187,106,0.5); }

/* 锁定提示 / 失败提示 */
.ch-locktip { font-size: 11px; color: #8b98a6; margin-top: 4px; }
.ch-failtip { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #ff9c9c; margin-top: 5px; }

/* 分支选择卡 */
.ch-choice { margin-top: 6px; padding: 6px; border: 1px dashed rgba(160,107,255,0.45); border-radius: 5px; background: rgba(160,107,255,0.08); }
.ch-choice__t { font-size: 11px; color: #d8bcff; margin-bottom: 4px; }
.ch-choice__opt { padding: 5px; margin-top: 4px; border: 1px solid rgba(255,255,255,0.1); border-radius: 5px; background: rgba(0,0,0,0.24); }
.ch-choice__name { font-size: 12px; color: #ffe8bd; }
.ch-choice__desc { font-size: 10px; color: #9fb0c1; margin-top: 2px; line-height: 1.4; }
.ch-choice__ops { margin-top: 4px; }

/* 节点 */
.ch-nodes { display: flex; flex-direction: column; gap: 3px; margin-top: 5px; }
.ch-node { padding: 4px 6px; border: 1px solid rgba(255,255,255,0.07); border-radius: 5px; background: rgba(0,0,0,0.16); }
.ch-node__head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.ch-node__dot { width: 6px; height: 6px; border-radius: 50%; background: #4a5563; flex: 0 0 auto; }
.ch-node__name { font-size: 11px; color: #c3cfdb; }
.ch-node__fail { font-size: 9px; color: #ff8a8a; }
.ch-node__desc { font-size: 10px; color: #8b98a6; margin-top: 2px; line-height: 1.4; }
.ch-node__rw { font-size: 10px; color: #7f8f9f; margin-top: 2px; }
.ch-node__ops { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }

/* 节点状态配色 */
.nd-lock .ch-node__dot { background: #4a5563; }
.nd-avail .ch-node__dot { background: #5a9bff; box-shadow: 0 0 5px rgba(90,155,255,.7); }
.nd-run .ch-node__dot { background: #d4a13e; box-shadow: 0 0 5px rgba(212,161,62,.7); }
.nd-pause .ch-node__dot { background: #8b98a6; }
.nd-done .ch-node__dot { background: #66bb6a; }
.nd-fail .ch-node__dot { background: #ef5350; }
.nd-done .ch-node__name { color: #9fe29f; }
.nd-fail .ch-node__name { color: #ff9c9c; text-decoration: line-through; }
.nd-pause .ch-node__name { color: #9aa7b4; }
.nd-lock { opacity: .58; }

/* 按钮变体 */
.qp-btn--pause { border-color: #7f8f9f; background: #45505c; }
.qp-btn--bad { border-color: #b04040; background: #6e2626; }
.qp-btn--warn { border-color: #d4a13e; background: #8a6520; }

/* 支线区 */
.ch-side { margin-top: 4px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.12); display: flex; flex-direction: column; gap: 5px; }
.ch-side__t { font-size: 11px; color: #9aa7b4; }
</style>
