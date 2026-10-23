<script setup lang="ts">
/**
 * AIPanel.vue —— AI 托管配置面板
 * ==================================================
 * 让「AI 托管频率」可调，而不是写死在代码常量里。
 *
 * 配置落库：t_plugin_session_data，key = "ai_settings"（见 ai/aiConfig.ts）
 * 生效时机：保存即生效（applyAISettings 立刻改运行时配置），无需重启。
 *
 * ★ 优先级（面板 → 地图集 → 代码默认）：
 *   1. 地图集覆盖（events.json 的 ai 字段 / ai_interval 动作）—— 优先级最高
 *   2. 本面板的用户配置
 *   3. 代码默认值
 *   所以本面板调的是**全局基线**，具体地图可以在此基础上再覆盖。
 */
import { computed, ref, watch } from "vue";
import type { AISettings } from "../ai/aiConfig";
import { AI_SETTINGS_RANGE, DEFAULT_AI_SETTINGS } from "../ai/aiConfig";

const props = defineProps<{
  /** 当前生效的设置（父组件从 aiConfig 读） */
  settings: AISettings;
  /** 当前托管角色数（用于估算请求频率） */
  managedCount?: number;
}>();

const emit = defineEmits<{
  (e: "save", s: AISettings): void;
  (e: "reset"): void;
}>();

/** 本地草稿（改动先落这里，点「保存」才提交） */
const draft = ref<AISettings>({ ...props.settings });
/** 是否已修改 */
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(props.settings));

watch(
  () => props.settings,
  (s) => { draft.value = { ...s }; },
  { deep: true },
);

/** 秒 = 毫秒 / 1000 */
const sec = (ms: number) => (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1);

interface RowDef {
  key: keyof AISettings;
  label: string;
  hint: string;
  range: { min: number; max: number; step: number };
  unit: "ms" | "count";
}

const ROWS: RowDef[] = [
  {
    key: "maxInterval",
    label: "最大决策间隔",
    hint: "非战斗态的实际上限。调大更省 token，但 AI 显得迟钝。",
    range: AI_SETTINGS_RANGE.maxInterval,
    unit: "ms",
  },
  {
    key: "minInterval",
    label: "最小决策间隔",
    hint: "全局硬下界。地图集覆盖也压不过它（战斗态可下探到 3s）。",
    range: AI_SETTINGS_RANGE.minInterval,
    unit: "ms",
  },
  {
    key: "engaged",
    label: "交战中间隔",
    hint: "玩家刚参与战斗（30s 保持窗口）时的决策节奏。",
    range: AI_SETTINGS_RANGE.engaged,
    unit: "ms",
  },
  {
    key: "skirmish",
    label: "遭遇战间隔",
    hint: "已过保持窗口、但附近仍有敌人时的节奏。",
    range: AI_SETTINGS_RANGE.skirmish,
    unit: "ms",
  },
  {
    key: "idle",
    label: "非战斗间隔",
    hint: "安全时的节奏。会被「最大决策间隔」钳住。",
    range: AI_SETTINGS_RANGE.idle,
    unit: "ms",
  },
  {
    key: "maxManagedCount",
    label: "最大托管角色数",
    hint: "同时能被 AI 托管的角色上限。战斗态另有「只让最近 2 个进 LLM」的筛选。",
    range: AI_SETTINGS_RANGE.maxManagedCount,
    unit: "count",
  },
];

/** 滑块变更 */
function onSlider(row: RowDef, ev: Event) {
  const v = Number((ev.target as HTMLInputElement).value);
  (draft.value as any)[row.key] = v;
}

/** 数字输入变更 */
function onNumber(row: RowDef, ev: Event) {
  const raw = (ev.target as HTMLInputElement).value;
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  (draft.value as any)[row.key] = Math.min(Math.max(Math.round(v), row.range.min), row.range.max);
}

/** 估算请求频率（次/分钟，托管 N 个角色时的粗算） */
const estimate = computed(() => {
  const n = Math.max(1, props.managedCount || 0);
  if (n === 0) return "当前没有托管角色";
  const idleReq = (60000 / Math.max(1000, draft.value.idle)) * n;
  const combatReq = (60000 / Math.max(1000, draft.value.engaged)) * n;
  return `托管 ${n} 个角色：非战斗约 ${idleReq.toFixed(0)} 次/分，交战中约 ${combatReq.toFixed(0)} 次/分`;
});

function save() {
  emit("save", { ...draft.value });
}
function reset() {
  draft.value = { ...DEFAULT_AI_SETTINGS };
}
</script>

<template>
  <div class="ap">
    <div class="ap-intro">
      AI 托管的决策节奏与规模。保存后<strong>立即生效</strong>，配置保存在本会话的插件数据里（t_plugin_session_data）。
      <br />
      <span class="ap-intro__dim">
        具体地图可以在事件文件里覆盖这些值（events.json 的 <code>ai</code> 字段），地图集优先级高于此处。
      </span>
    </div>

    <div class="ap-rows">
      <div v-for="row in ROWS" :key="row.key" class="ap-row">
        <div class="ap-row__head">
          <label class="ap-row__label">{{ row.label }}</label>
          <div class="ap-row__ctrl">
            <input
              type="number"
              class="ap-num"
              :min="row.range.min"
              :max="row.range.max"
              :step="row.range.step"
              :value="draft[row.key] as number"
              @input="onNumber(row, $event)"
            />
            <span class="ap-unit">{{ row.unit === "ms" ? `${sec(draft[row.key] as number)}s` : "个" }}</span>
          </div>
        </div>
        <input
          type="range"
          class="ap-range"
          :min="row.range.min"
          :max="row.range.max"
          :step="row.range.step"
          :value="draft[row.key] as number"
          @input="onSlider(row, $event)"
        />
        <div class="ap-row__hint">{{ row.hint }}</div>
      </div>

      <div class="ap-row">
        <div class="ap-row__head">
          <label class="ap-row__label">自适应间隔</label>
          <button
            class="ap-switch"
            :class="{ 'ap-switch--on': draft.adaptiveEnabled }"
            @click="draft.adaptiveEnabled = !draft.adaptiveEnabled"
          >
            {{ draft.adaptiveEnabled ? "开" : "关" }}
          </button>
        </div>
        <div class="ap-row__hint">
          开启时按战斗状态自动调整节奏（交战中快、非战斗慢）；关闭后固定用「最小决策间隔」。
        </div>
      </div>
    </div>

    <div class="ap-est">{{ estimate }}</div>

    <div class="ap-actions">
      <button class="ap-btn" :disabled="!dirty" @click="save">保存</button>
      <button class="ap-btn ap-btn--ghost" @click="reset">恢复默认</button>
      <button class="ap-btn ap-btn--ghost" :disabled="!dirty" @click="draft = { ...settings }">撤销改动</button>
    </div>
  </div>
</template>

<style scoped>
.ap { color: #e8eef5; font-size: 13px; }
.ap-intro { margin-bottom: 10px; line-height: 1.6; color: #c3cedb; }
.ap-intro strong { color: #7fb4ff; }
.ap-intro__dim { color: #8b98a8; font-size: 12px; }
.ap-intro code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
.ap-rows { display: flex; flex-direction: column; gap: 12px; }
.ap-row { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 8px 10px; }
.ap-row__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-row__label { font-weight: 600; }
.ap-row__ctrl { display: flex; align-items: center; gap: 5px; }
.ap-num { width: 66px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; color: #e8eef5; padding: 3px 5px; font-size: 12px; text-align: right; }
.ap-unit { color: #9fd0ff; font-size: 12px; min-width: 38px; }
.ap-range { width: 100%; margin: 6px 0 2px; accent-color: #4d8ef7; }
.ap-row__hint { color: #8b98a8; font-size: 11px; line-height: 1.5; }
.ap-switch { width: 44px; padding: 3px 0; border-radius: 4px; border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.08); color: #cfd8e3; cursor: pointer; font-size: 12px; }
.ap-switch--on { background: #2f6fd0; border-color: #5a9bff; color: #fff; }
.ap-est { margin: 12px 0 8px; padding: 6px 10px; background: rgba(77,142,247,0.12); border-left: 3px solid #4d8ef7; border-radius: 3px; color: #b9d4ff; font-size: 12px; }
.ap-actions { display: flex; gap: 8px; }
.ap-btn { padding: 6px 14px; border-radius: 5px; border: 1px solid #5a9bff; background: #2f6fd0; color: #fff; cursor: pointer; font-size: 12px; }
.ap-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ap-btn--ghost { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.22); color: #cfd8e3; }
</style>
