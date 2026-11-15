<template>
  <Teleport to="body">
    <div v-if="open" class="bc-mask" @pointerdown.stop @click.self="emit('close')">
      <div class="bc-panel">
        <header class="bc-head">
          <div class="bc-head__title">
            行为链 · <b>{{ entityName }}</b><span style="font-size:10px;color:#7d8398;margin-left:6px">#{{ entityId }}</span>
            <span class="bc-badge" :class="managed ? 'bc-badge--on' : 'bc-badge--off'">
              {{ managed ? "AI托管中" : "未托管" }}
            </span>
          </div>
          <button class="bc-x" title="关闭" @click="emit('close')">✕</button>
        </header>

        <!-- ══ 列表视图 ══ -->
        <div v-if="mode === 'list'" class="bc-body">
          <section class="bc-sec">
            <div class="bc-sec__head">
              <span>行为计划（{{ plan.length }} 步 · {{ planSource === 'user' ? '用户编辑' : 'AI 制定' }}）</span>
              <button class="bc-mini" :disabled="!managed || planBusy" :title="planBusy ? 'AI 正在制定新计划…' : '清空当前计划，让 AI 重新制定一份'" @click="onAITakeover">
                {{ planBusy ? `重排中… ${awaitingSec}s` : "交给 AI 重排" }}
              </button>
            </div>
            <!-- ★ 重排失败原因（LLM 失败/解析失败/通道繁忙） -->
            <div v-if="planError" class="bc-err-bar">{{ planError }}</div>
            <div v-if="!plan.length" class="bc-empty">
              {{ planBusy
                ? `AI 正在制定新计划…（已等待 ${awaitingSec} 秒${awaitingSec > 45 ? "，通道繁忙时最长约 1 分钟，超时自动重试" : ""}）`
                : managed ? "暂无计划 —— 将由 AI 自动制定" : "（勾选 AI托管 后由 AI 制定，或点下方「添加行为」手动创建）" }}
            </div>
            <div
              v-for="(p, i) in plan"
              :key="p.id"
              class="bc-step"
              :class="p.status === 'active' ? 'bc-step--active' : ''"
            >
              <span class="bc-step__idx">{{ i + 1 }}</span>
              <div class="bc-step__main">
                <div class="bc-step__note">{{ p.note }}</div>
                <div class="bc-step__meta">{{ typeText(p.action.type) }}<template v-if="paramsText(p.action)"> · {{ paramsText(p.action) }}</template></div>
              </div>
              <!-- ★ 2026-11-15：执行中的步也开放 删/改/插（用户需求）——
                   删/改会立即中断当前动作并停掉 entry 侧移动，改后从该步重新执行 -->
              <div class="bc-step__ops">
                <span v-if="p.status === 'active'" class="bc-step__run">▶ 执行中</span>
                <button title="删除此步（执行中的步会被立即中断）" @click="onRemove(p)">删</button>
                <button title="改变此步（执行中的步会被中断并以新内容重新执行）" @click="startEdit(p)">改</button>
                <button title="在此步后插入" @click="startCreate(p.id)">插</button>
              </div>
            </div>
            <button v-if="plan.length < maxSteps" class="bc-add" @click="startCreate(lastStepId)">＋ 添加行为（追加到末尾）</button>
          </section>

          <section class="bc-sec">
            <div class="bc-sec__head"><span>已做的事（{{ history.length }}）</span><button v-if="history.length" class="bc-mini" @click="onClearHistory">清空</button></div>
            <div v-if="!pageHistory.length" class="bc-empty">还没有完成记录</div>
            <div v-for="h in pageHistory" :key="h.id" class="bc-hist" :class="'bc-hist--' + h.result">
              <span class="bc-hist__mark">{{ resultText(h.result) }}</span>
              <span class="bc-hist__note">{{ h.note }}</span>
              <span class="bc-hist__time">{{ timeText(h.finishedAt) }}</span>
            </div>
            <div v-if="history.length > pageSize" class="bc-pager">
              <button v-if="histPage < totalPages - 1" @click="histPage++">← 更早</button>
              <span>第 {{ histPage + 1 }} / {{ totalPages }} 页</span>
              <button v-if="histPage > 0" @click="histPage--">更近 →</button>
            </div>
          </section>
        </div>

        <!-- ══ 编辑 / 创建视图 ══ -->
        <div v-else class="bc-body">
          <div class="bc-form">
            <div class="bc-form__title">{{ form.stepId ? "改变行为" : "新建行为" }}<span class="bc-form__sub">{{ form.afterId ? "（插入到所选行为之后）" : "" }}</span></div>
            <label class="bc-row">
              <span class="bc-row__label">动作类型</span>
              <select v-model="form.type" class="bc-input">
                <option v-for="t in ACTION_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </label>
            <label v-if="needField('targetName')" class="bc-row">
              <span class="bc-row__label">{{ form.type === 'interact' ? "NPC 名" : "目标名" }}</span>
              <input v-model="form.targetName" class="bc-input" :placeholder="form.type === 'attack' ? '如：灰狼' : 'NPC 名字'" />
            </label>
            <label v-if="needField('zoneName')" class="bc-row">
              <span class="bc-row__label">区域名</span>
              <input v-model="form.zoneName" class="bc-input" placeholder="如：灰狼野区（采集区/地点）" />
            </label>
            <template v-if="needField('coord')">
              <label class="bc-row">
                <span class="bc-row__label">坐标 X</span>
                <input v-model="form.x" class="bc-input" type="number" step="0.5" placeholder="留空则用区域名" />
              </label>
              <label class="bc-row">
                <span class="bc-row__label">坐标 Y</span>
                <input v-model="form.y" class="bc-input" type="number" step="0.5" placeholder="留空则用区域名" />
              </label>
            </template>
            <label v-if="needField('skillName')" class="bc-row">
              <span class="bc-row__label">技能名</span>
              <input v-model="form.skillName" class="bc-input" placeholder="角色已掌握的技能名" />
            </label>
            <label v-if="needField('itemName')" class="bc-row">
              <span class="bc-row__label">物品名</span>
              <input v-model="form.itemName" class="bc-input" placeholder="背包中的物品名" />
            </label>
            <label v-if="needField('duration')" class="bc-row">
              <span class="bc-row__label">时长（秒）</span>
              <input v-model="form.duration" class="bc-input" type="number" min="1" max="30" />
            </label>
            <label class="bc-row">
              <span class="bc-row__label">备注</span>
              <input v-model="form.note" class="bc-input" maxlength="16" placeholder="一句中文（≤16 字，面板显示用）" />
            </label>
            <div class="bc-form__ops">
              <button class="bc-btn bc-btn--primary" @click="saveForm">保存</button>
              <button class="bc-btn" @click="mode = 'list'">取消</button>
            </div>
            <div v-if="formErr" class="bc-err">{{ formErr }}</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * BehaviorChainPanel —— AI 托管 V2 行为链面板（2026-11-15，ai托管V2.md）
 * 数据源 = ai/ 内存态（aiStates，宿主 tick 推进），本面板只做增删改查 + 防抖落库。
 * aiStates 是普通 Map 非 reactive → 用 planVersion 轮询驱动刷新。
 */
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { getAllAIStates, isAIEnabled } from "../ai/brain";
import {
  removePlanStep, replacePlanStep, insertPlanStep, requestAIReplan, clearHistory,
  getPlan, getHistory, getPlanVersion, sanitizeAction, PLAN_MAX,
} from "../ai/plan";
import { scheduleBehaviorChainsSave } from "../ai/persistence";
import { stopEntityAction } from "../ai/spine";
import type { AIAction, AIActionType, PlanStep } from "../ai/types";

const props = defineProps<{
  open: boolean;
  entityId: string;
  entityName: string;
  managed: boolean;
}>();
const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

const ACTION_TYPES: Array<{ value: AIActionType; label: string }> = [
  { value: "move", label: "移动" },
  { value: "attack", label: "攻击" },
  { value: "gather", label: "采集" },
  { value: "interact", label: "对话交互" },
  { value: "useSkill", label: "使用技能" },
  { value: "useItem", label: "使用物品" },
  { value: "flee", label: "撤退" },
  { value: "wait", label: "等待" },
  { value: "follow", label: "跟随玩家" },
];

const TYPE_TEXT: Record<string, string> = Object.fromEntries(ACTION_TYPES.map((t) => [t.value, t.label]));
const RESULT_TEXT: Record<string, string> = { done: "✓", failed: "✗", interrupted: "⏸" };

/* —— 响应式：planVersion 轮询（aiStates 非 reactive） —— */
const version = ref(0);
/** 秒级心跳：驱动「重排中…已等待 Xs」的显示刷新（version 只在计划变化时 bump） */
const clockTick = ref(0);
/** 托管状态每拍重算（isAIEnabled 读普通 Map 无响应性，prop 快照会过期） */
const managedLive = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;
watch(() => props.open, (o) => {
  if (o) {
    version.value = getPlanVersion();
    managedLive.value = isAIEnabled(props.entityId);
    pollTimer = setInterval(() => {
      version.value = getPlanVersion();
      managedLive.value = isAIEnabled(props.entityId);
      clockTick.value++;
    }, 400);
  } else {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    mode.value = "list";
    histPage.value = 0;
  }
});
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer); });
const managed = computed(() => managedLive.value);

const state = computed(() => getAllAIStates().get(props.entityId));
const plan = computed<PlanStep[]>(() => { void version.value; return state.value ? getPlan(state.value) : []; });
const history = computed(() => { void version.value; return state.value ? getHistory(state.value) : []; });
const planSource = computed(() => state.value?.planSource || "ai");
/** ★ 重排进行中（awaitingPlan=true = 已请求、LLM 未回来）+ 已等待秒数 */
const planBusy = computed(() => { void version.value; void clockTick.value; return !!state.value?.awaitingPlan; });
const awaitingSec = computed(() => {
  void version.value; void clockTick.value;
  const t = state.value?.planReqAt;
  return t ? Math.max(0, Math.round((Date.now() - t) / 1000)) : 0;
});
/** ★ 最近一次重排失败原因（面板错误条显示） */
const planError = computed(() => { void version.value; return state.value?.planError || ""; });

/* —— 历史翻页（page 0 = 最近 5 条，页码增大 = 更早） —— */
const pageSize = 5;
const histPage = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(history.value.length / pageSize)));
const pageHistory = computed(() => history.value.slice(histPage.value * pageSize, histPage.value * pageSize + pageSize));

const maxSteps = PLAN_MAX;
const lastStepId = computed(() => plan.value.length ? plan.value[plan.value.length - 1].id : null);

/* —— 删除 / 重排 / 清历史 —— */
function onRemove(p: PlanStep): void {
  const s = state.value; if (!s) return;
  // ★ 执行中的步被删 → 立即中断（removePlanStep 清 currentAction），
  //   并向 entry 发 stop 清掉残留的移动/攻击目标（否则角色继续走向旧目标最多 60s）
  const wasActive = removePlanStep(s, p.id);
  if (wasActive) stopEntityAction(props.entityId);
  scheduleBehaviorChainsSave();
}
function onAITakeover(): void {
  const s = state.value; if (!s) return;
  requestAIReplan(s);
  // 重排是异步的：立即中断当前动作（计划已清空，旧动作没有归属）
  stopEntityAction(props.entityId);
  scheduleBehaviorChainsSave();
}
function onClearHistory(): void {
  const s = state.value; if (!s) return;
  clearHistory(s);
  histPage.value = 0;
  scheduleBehaviorChainsSave();
}

/* —— 编辑 / 创建表单 —— */
const mode = ref<"list" | "form">("list");
const formErr = ref("");
const form = ref({
  stepId: "" as string,        // 空 = 新建
  afterId: null as string | null,
  type: "move" as AIActionType,
  note: "",
  targetName: "", zoneName: "", x: "", y: "",
  skillName: "", itemName: "", duration: "3",
});

function startEdit(p: PlanStep): void {
  const a = p.action;
  form.value = {
    stepId: p.id,
    afterId: null,
    type: a.type,
    note: p.note,
    targetName: a.target?.name || "",
    zoneName: a.zoneName || "",
    x: a.target?.x != null ? String(Math.round(a.target.x * 10) / 10) : "",
    y: a.target?.y != null ? String(Math.round(a.target.y * 10) / 10) : "",
    skillName: a.skillName || "",
    itemName: a.itemName || "",
    duration: a.duration ? String(Math.round(a.duration / 1000)) : "3",
  };
  formErr.value = "";
  mode.value = "form";
}
function startCreate(afterId: string | null): void {
  form.value = { stepId: "", afterId, type: "move", note: "", targetName: "", zoneName: "", x: "", y: "", skillName: "", itemName: "", duration: "3" };
  formErr.value = "";
  mode.value = "form";
}

function needField(f: string): boolean {
  const t = form.value.type;
  if (f === "targetName") return t === "attack" || t === "interact";
  if (f === "zoneName") return t === "gather" || t === "move" || t === "flee";
  if (f === "coord") return t === "move" || t === "flee";
  if (f === "skillName") return t === "useSkill";
  if (f === "itemName") return t === "useItem";
  if (f === "duration") return t === "wait";
  return false;
}

function buildAction(): AIAction | null {
  const f = form.value;
  const ctx = f.note || TYPE_TEXT[f.type] || f.type;
  const numOrUndef = (v: string) => (v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const target: { id?: string; x?: number; y?: number; name?: string } = {};
  if (f.targetName.trim()) target.name = f.targetName.trim();
  const x = numOrUndef(f.x), y = numOrUndef(f.y);
  if (x !== undefined) target.x = x;
  if (y !== undefined) target.y = y;
  const action: any = {
    type: f.type,
    priority: f.type === "attack" ? 60 : f.type === "wait" ? 30 : 50,
    context: ctx,
  };
  if (Object.keys(target).length) action.target = target;
  if (f.zoneName.trim()) action.zoneName = f.zoneName.trim();
  if (f.skillName.trim()) action.skillName = f.skillName.trim();
  if (f.itemName.trim()) action.itemName = f.itemName.trim();
  if (f.type === "wait") action.duration = Math.max(1, Math.min(30, Number(f.duration) || 3)) * 1000;
  return sanitizeAction(action);
}

function saveForm(): void {
  const s = state.value; if (!s) return;
  const action = buildAction();
  if (!action) { formErr.value = "动作参数不完整（检查类型与必填项）"; return; }
  const note = form.value.note.trim() || defaultNote(action);
  if (form.value.stepId) {
    // ★ 执行中的步被改 → 中断旧动作 + 停 entry 移动，新内容下一拍重新执行
    const wasActive = replacePlanStep(s, form.value.stepId, action, note);
    if (wasActive) stopEntityAction(props.entityId);
  } else {
    const id = insertPlanStep(s, form.value.afterId, action, note);
    if (!id) { formErr.value = "插入失败（计划步数已达上限）"; return; }
  }
  scheduleBehaviorChainsSave();
  mode.value = "list";
}
function defaultNote(a: AIAction): string {
  switch (a.type) {
    case "move": return `移动到 ${a.zoneName || a.target?.name || "目标点"}`;
    case "attack": return `攻击 ${a.target?.name || "目标"}`;
    case "gather": return `采集 ${a.zoneName || "资源"}`;
    case "interact": return `与 ${a.target?.name || "NPC"} 交谈`;
    case "useSkill": return `使用技能 ${a.skillName || ""}`;
    case "useItem": return `使用 ${a.itemName || "物品"}`;
    case "flee": return "脱离战斗撤退";
    case "wait": return "原地等待";
    case "follow": return "跟随玩家";
    default: return String(a.type);
  }
}

/* —— 显示工具 —— */
function typeText(t: string): string { return TYPE_TEXT[t] || t; }
function resultText(r: string): string { return RESULT_TEXT[r] || "·"; }
function timeText(ts: number): string {
  const ago = Math.round((Date.now() - ts) / 1000);
  if (ago < 60) return `${ago}秒前`;
  if (ago < 3600) return `${Math.round(ago / 60)}分前`;
  return `${Math.round(ago / 3600)}时前`;
}
function paramsText(a: AIAction): string {
  const parts: string[] = [];
  if (a.target?.name) parts.push(a.target.name);
  if (a.zoneName) parts.push(a.zoneName);
  if (a.skillName) parts.push(a.skillName);
  if (a.itemName) parts.push(a.itemName);
  if (a.type === "wait" && a.duration) parts.push(`${Math.round(a.duration / 1000)}秒`);
  if (a.target?.x != null && a.target?.y != null) parts.push(`(${Math.round(a.target.x)},${Math.round(a.target.y)})`);
  return parts.join(" ");
}
</script>

<style scoped>
/* ★ z-index 必须高于系统面板（.sys-panel = 9997）——否则从角色页点「行为链」打开的
   面板会被系统面板整个盖住（用户反馈：点击没反应，关掉系统面板才看见）。
   取 10002：高于锻造/炼丹(10000)、形象弹窗(10001)。 */
.bc-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 10002; display: flex; align-items: center; justify-content: center; }
.bc-panel {
  width: 400px; max-width: 92vw; max-height: 82vh; display: flex; flex-direction: column;
  background: linear-gradient(180deg, #23252e 0%, #1b1d25 100%);
  border: 1px solid #4a4f63; border-radius: 10px; box-shadow: 0 12px 42px rgba(0,0,0,.55);
  color: #e8eaf2; font-size: 13px; overflow: hidden;
}
.bc-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,.04); border-bottom: 1px solid #3a3f52; }
.bc-head__title { font-size: 14px; }
.bc-head__title b { color: #ffd479; }
.bc-badge { margin-left: 8px; font-size: 11px; padding: 1px 8px; border-radius: 999px; }
.bc-badge--on { background: #234a2e; color: #8ee6a1; border: 1px solid #3a6b48; }
.bc-badge--off { background: #3a2a2a; color: #d99; border: 1px solid #5a3a3a; }
.bc-x { background: none; border: none; color: #9aa0b5; font-size: 15px; cursor: pointer; }
.bc-x:hover { color: #fff; }
.bc-body { overflow-y: auto; padding: 10px 12px; flex: 1; }
.bc-sec { margin-bottom: 14px; }
.bc-sec__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 12px; color: #aab0c4; }
.bc-mini { background: #2e3345; color: #c9cede; border: 1px solid #454b60; border-radius: 5px; font-size: 11px; padding: 1px 8px; cursor: pointer; }
.bc-mini:disabled { opacity: .45; cursor: default; }
.bc-mini:hover:not(:disabled) { background: #3a4056; }
.bc-empty { color: #7d8398; font-size: 12px; padding: 8px 4px; text-align: center; background: rgba(255,255,255,.02); border-radius: 6px; }
/* ★ 重排失败原因条（黄底警示） */
.bc-err-bar { margin-bottom: 8px; padding: 6px 10px; background: rgba(255, 212, 121, .1); border: 1px solid rgba(255, 212, 121, .35); border-radius: 6px; color: #ffd479; font-size: 12px; line-height: 1.5; }
/* 计划步 */
.bc-step { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin-bottom: 4px; background: rgba(255,255,255,.03); border: 1px solid #363b4e; border-radius: 7px; }
.bc-step--active { border-color: #4a7bd6; background: rgba(74,123,214,.12); }
.bc-step__idx { width: 20px; height: 20px; flex: none; display: flex; align-items: center; justify-content: center; background: #2e3345; border-radius: 50%; font-size: 11px; color: #aab0c4; }
.bc-step--active .bc-step__idx { background: #4a7bd6; color: #fff; }
.bc-step__main { flex: 1; min-width: 0; }
.bc-step__note { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bc-step--active .bc-step__note { color: #9fc3ff; }
.bc-step__meta { font-size: 11px; color: #7d8398; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bc-step__run { font-size: 11px; color: #8ee6a1; flex: none; }
.bc-step__ops { display: flex; gap: 4px; flex: none; }
.bc-step__ops button { background: #2e3345; color: #c9cede; border: 1px solid #454b60; border-radius: 5px; font-size: 11px; padding: 2px 7px; cursor: pointer; }
.bc-step__ops button:hover { background: #3a4056; color: #fff; }
.bc-add { width: 100%; margin-top: 4px; background: rgba(255,255,255,.03); color: #aab0c4; border: 1px dashed #454b60; border-radius: 7px; font-size: 12px; padding: 6px; cursor: pointer; }
.bc-add:hover { color: #fff; border-color: #6a7188; }
/* 历史 */
.bc-hist { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 12px; color: #c2c7d6; }
.bc-hist__mark { flex: none; width: 16px; text-align: center; }
.bc-hist--done .bc-hist__mark { color: #8ee6a1; }
.bc-hist--failed .bc-hist__mark { color: #e68a8a; }
.bc-hist--interrupted .bc-hist__mark { color: #ffd479; }
.bc-hist__note { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bc-hist__time { flex: none; font-size: 11px; color: #7d8398; }
.bc-pager { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font-size: 11px; color: #7d8398; }
.bc-pager button { background: none; border: 1px solid #454b60; border-radius: 5px; color: #c9cede; font-size: 11px; padding: 2px 8px; cursor: pointer; }
.bc-pager button:hover { color: #fff; }
/* 表单 */
.bc-form__title { font-size: 14px; margin-bottom: 10px; }
.bc-form__sub { font-size: 11px; color: #7d8398; margin-left: 6px; }
.bc-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.bc-row__label { width: 66px; flex: none; font-size: 12px; color: #aab0c4; }
.bc-input { flex: 1; background: #1a1c24; color: #e8eaf2; border: 1px solid #454b60; border-radius: 6px; padding: 5px 8px; font-size: 13px; outline: none; }
.bc-input:focus { border-color: #4a7bd6; }
.bc-form__ops { display: flex; gap: 8px; margin-top: 12px; }
.bc-btn { flex: 1; background: #2e3345; color: #e8eaf2; border: 1px solid #454b60; border-radius: 7px; padding: 7px; font-size: 13px; cursor: pointer; }
.bc-btn:hover { background: #3a4056; }
.bc-btn--primary { background: #2a4a7b; border-color: #3a6aa8; }
.bc-btn--primary:hover { background: #34588f; }
.bc-err { margin-top: 8px; color: #e68a8a; font-size: 12px; }
</style>
