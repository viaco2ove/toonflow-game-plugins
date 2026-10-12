<script setup lang="ts">
/**
 * EventPanel.vue —— 事件状态面板（事件系统调试/查询）
 * =====================================================
 * 显示当前地图 events/maps/<map>.events.json 里所有事件：
 *   - 触发器 / 条件 / 动作 概要
 *   - 玩家 flag 当前值（来自 pluginData:player_flags）
 *   - 条件是否满足（绿✓ / 红✗）
 *   - 重复事件已 fire 次数 / 最后时间
 * 操作：
 *   - 改 flag 数值（直接 set / del / 写任意 JSON）
 *   - 单个事件「手动 fire」按钮（绕过 zone 检测，直接走引擎）
 */
import { computed, ref } from "vue";
import type { EventDef } from "../eventScripts/_ctx";

const props = defineProps<{
  mapName: string;
  events: EventDef[];
  flags: Record<string, unknown>;
  /** repeat 事件已 fire 次数（key=event id） */
  repeatHits?: Record<string, number>;
  /** 当前玩家坐标（米） */
  playerX: number;
  playerY: number;
  /** 地图 zone 列表（用于显示 zone 内/外） */
  eventZones?: { name: string; x: number; y: number; rx?: number; ry?: number; r?: number }[];
}>();

const emit = defineEmits<{
  (e: "set-flag", key: string, value: unknown): void;
  (e: "del-flag", key: string): void;
  (e: "fire-event", evId: string): void;
  (e: "reload-events"): void;
}>();

const TRIGGER_LABELS: Record<string, string> = {
  enter_map: "进图触发",
  interact: "交互触发",
  area_enter: "进入区域",
  step_on: "踩到格",
  flag_set: "flag 变更",
  kill_count: "累计击杀",
  turn_count: "回合计数",
  custom: "自定义",
};
const OP_LABELS: Record<string, string> = {
  eq: "=", ne: "≠", exists: "存在", missing: "缺失",
};
const ACTION_LABELS: Record<string, string> = {
  set_flag: "写 flag", del_flag: "删 flag", toast: "飘字",
  subtitle: "字幕", event_log: "事件日志", teleport: "传送",
  run_script: "运行脚本", call_action: "调用动作",
  llm_speak: "LLM 说话", wait: "等待",
};

/** 条件是否满足（前端仅做最常见的 flag_check 判定，复杂条件按 "?" 显示） */
function condMet(c: any): { ok: boolean | "?"; detail: string } {
  if (c.type === "flag_check") {
    const cur = props.flags[c.key];
    const op = c.op || (c.value !== undefined ? "eq" : "exists");
    if (op === "exists") return { ok: cur !== undefined, detail: `${c.key} 存在?` };
    if (op === "missing") return { ok: cur === undefined, detail: `${c.key} 缺失?` };
    if (op === "eq") return { ok: cur === c.value, detail: `${c.key} = ${JSON.stringify(c.value)}` };
    if (op === "ne") return { ok: cur !== c.value, detail: `${c.key} ≠ ${JSON.stringify(c.value)}` };
  }
  return { ok: "?", detail: c.type };
}

const zone = ref(""); // 折叠行
const isInsideZone = (z: any): boolean => {
  if (z.rx !== undefined && z.ry !== undefined) {
    return props.playerX >= z.x - z.rx && props.playerX <= z.x + z.rx
        && props.playerY >= z.y - z.ry && props.playerY <= z.y + z.ry;
  }
  return Math.hypot(z.x - props.playerX, z.y - props.playerY) <= (z.r ?? 5);
};

const flagsArr = computed(() => Object.entries(props.flags).map(([k, v]) => [k, v] as [string, unknown]));
const editingKey = ref<string | null>(null);
const editingVal = ref<string>("");
function startEdit(k: string, v: unknown): void {
  editingKey.value = k;
  editingVal.value = v === undefined ? "" : JSON.stringify(v);
}
function commitEdit(): void {
  if (!editingKey.value) return;
  const k = editingKey.value;
  let v: unknown;
  try { v = editingVal.value === "" ? undefined : JSON.parse(editingVal.value); }
  catch { v = editingVal.value; } // 当字符串
  emit("set-flag", k, v);
  editingKey.value = null;
}
function newFlag(): void {
  const k = window.prompt("新 flag key（建议 snake_case 命名空间）:", "tmp.");
  if (!k) return;
  emit("set-flag", k, true);
}
</script>

<template>
  <div class="ep">
    <div class="ep-row ep-toolbar">
      <span class="ep-stat">地图：<b>{{ mapName }}</b></span>
      <span class="ep-stat">事件：<b>{{ events.length }}</b></span>
      <span class="ep-stat">flag：<b>{{ flagsArr.length }}</b></span>
      <button class="ep-btn" @click="emit('reload-events')" title="从 events/maps 重新加载事件定义">↻ 重新加载</button>
    </div>

    <details class="ep-section" open>
      <summary>🏁 玩家 flag（<b>{{ flagsArr.length }}</b>）</summary>
      <div v-if="!flagsArr.length" class="ep-empty">（无）</div>
      <div v-for="[k, v] in flagsArr" :key="k" class="ep-flag">
        <template v-if="editingKey === k">
          <input class="ep-flag__val" v-model="editingVal" @keydown.enter="commitEdit" @keydown.esc="editingKey = null" />
          <button class="ep-btn ep-btn--ok" @click="commitEdit">确定</button>
          <button class="ep-btn" @click="editingKey = null">取消</button>
        </template>
        <template v-else>
          <span class="ep-flag__k">{{ k }}</span>
          <span class="ep-flag__v" @click="startEdit(k, v)" :title="'点击修改'">
            <span v-if="v === true" class="ep-tag ep-tag--ok">true</span>
            <span v-else-if="v === false" class="ep-tag ep-tag--no">false</span>
            <span v-else>{{ JSON.stringify(v) }}</span>
          </span>
          <button class="ep-btn ep-btn--danger" @click="emit('del-flag', k)">删</button>
        </template>
      </div>
      <div class="ep-row ep-row--end"><button class="ep-btn" @click="newFlag">+ 新增 flag</button></div>
    </details>

    <details v-if="eventZones && eventZones.length" class="ep-section">
      <summary>📍 区域探测 ({{ playerX.toFixed(1) }}, {{ playerY.toFixed(1) }})</summary>
      <div v-for="z in eventZones" :key="z.name" class="ep-zone">
        <span class="ep-zone__name">{{ z.name }}</span>
        <span class="ep-zone__xy">({{ z.x }}, {{ z.y }})</span>
        <span v-if="isInsideZone(z)" class="ep-tag ep-tag--ok">在区域内</span>
        <span v-else class="ep-tag ep-tag--no">外</span>
      </div>
    </details>

    <details class="ep-section" open>
      <summary>⚡ 事件列表（<b>{{ events.length }}</b>）</summary>
      <div v-if="!events.length" class="ep-empty">当前地图无事件定义</div>
      <div v-for="ev in events" :key="ev.id" class="ep-ev" :class="{ 'ep-ev--ok': ev.conditions?.every(c => condMet(c).ok === true) }">
        <div class="ep-ev__head">
          <span class="ep-ev__id">{{ ev.id }}</span>
          <span v-if="ev.repeat" class="ep-tag ep-tag--rep">repeat</span>
          <span class="ep-tag ep-tag--trig">{{ TRIGGER_LABELS[ev.trigger.type] || ev.trigger.type }}</span>
          <span v-if="ev.trigger.type === 'interact'" class="ep-ev__uid">uid={{ ev.trigger.uid }}</span>
          <span v-if="ev.trigger.type === 'area_enter'" class="ep-ev__uid">zone={{ ev.trigger.zone }}</span>
          <span class="ep-ev__hit" v-if="repeatHits && repeatHits[ev.id]">×{{ repeatHits[ev.id] }}</span>
          <button class="ep-btn ep-btn--fire" @click="emit('fire-event', ev.id)" title="手动 fire（绕过区域/交互检测）">▶ fire</button>
        </div>
        <div v-if="ev.comment" class="ep-ev__cmt">{{ ev.comment }}</div>
        <div v-if="ev.conditions?.length" class="ep-ev__conds">
          <span class="ep-label">条件：</span>
          <span v-for="(c, i) in ev.conditions" :key="i" class="ep-cond" :class="{ 'ep-cond--ok': condMet(c).ok === true, 'ep-cond--no': condMet(c).ok === false }">
            {{ condMet(c).detail }}
          </span>
        </div>
        <div v-if="ev.actions?.length" class="ep-ev__acts">
          <span class="ep-label">动作：</span>
          <span v-for="(a, i) in ev.actions" :key="i" class="ep-act">
            <b>{{ ACTION_LABELS[a.type] || a.type }}</b>
            <span v-if="a.type === 'toast' || a.type === 'subtitle' || a.type === 'event_log'">{{ a.text || a.text?.slice(0, 16) }}</span>
            <span v-else-if="a.type === 'set_flag'">{{ a.key }}={{ JSON.stringify(a.value) }}</span>
            <span v-else-if="a.type === 'del_flag'">{{ a.key }}</span>
            <span v-else-if="a.type === 'teleport'">→ {{ a.map }} ({{ a.x }}, {{ a.y }})</span>
            <span v-else-if="a.type === 'run_script'">{{ a.script }}</span>
          </span>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.ep { font-size: 12px; color: #d4d4d4; }
.ep-toolbar { display: flex; gap: 10px; align-items: center; padding: 4px 0 8px; border-bottom: 1px solid #2a2a2a; margin-bottom: 6px; flex-wrap: wrap; }
.ep-stat { color: #888; } .ep-stat b { color: #d4a13e; }
.ep-row { display: flex; gap: 6px; align-items: center; }
.ep-row--end { justify-content: flex-end; padding: 4px 0; }
.ep-section { background: #161616; border: 1px solid #2a2a2a; border-radius: 4px; margin: 6px 0; padding: 4px 8px; }
.ep-section > summary { cursor: pointer; color: #d4a13e; padding: 4px 0; user-select: none; }
.ep-empty { color: #666; padding: 6px 4px; font-style: italic; }
.ep-btn { background: #222; color: #d4d4d4; border: 1px solid #3a3a3a; border-radius: 3px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.ep-btn:hover { border-color: #d4a13e; color: #d4a13e; }
.ep-btn--ok { color: #66bb6a; border-color: #66bb6a; }
.ep-btn--danger { color: #ef5350; border-color: #ef5350; }
.ep-btn--fire { color: #ffe79e; border-color: #d4a13e; }
.ep-btn--fire:hover { background: #d4a13e; color: #111; }

.ep-flag { display: grid; grid-template-columns: 1fr 2fr auto; gap: 6px; align-items: center; padding: 3px 0; border-bottom: 1px dashed #232323; }
.ep-flag__k { color: #9fd0ff; font-family: Consolas, monospace; word-break: break-all; }
.ep-flag__v { color: #c8b888; cursor: pointer; word-break: break-all; }
.ep-flag__val { background: #1a1a1a; border: 1px solid #d4a13e; border-radius: 2px; color: #d4d4d4; padding: 2px 4px; font-family: Consolas, monospace; font-size: 11px; }

.ep-tag { display: inline-block; padding: 1px 6px; border-radius: 2px; font-size: 10px; line-height: 1.4; }
.ep-tag--ok { background: #2a4a2a; color: #66bb6a; }
.ep-tag--no { background: #4a2a2a; color: #ef5350; }
.ep-tag--rep { background: #4a3a2a; color: #d4a13e; }
.ep-tag--trig { background: #2a3a4a; color: #4fc3f7; }

.ep-zone { display: flex; gap: 6px; align-items: center; padding: 2px 0; font-size: 11px; }
.ep-zone__name { color: #ffe79e; min-width: 80px; }
.ep-zone__xy { color: #888; font-family: Consolas, monospace; }

.ep-ev { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 3px; margin: 4px 0; padding: 4px 6px; }
.ep-ev--ok { border-left: 3px solid #66bb6a; }
.ep-ev__head { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ep-ev__id { color: #ffe79e; font-weight: 600; font-family: Consolas, monospace; }
.ep-ev__uid { color: #888; font-size: 10px; }
.ep-ev__hit { color: #d4a13e; font-size: 10px; margin-left: 4px; }
.ep-ev__cmt { color: #888; font-size: 11px; font-style: italic; margin: 2px 0; }
.ep-ev__conds, .ep-ev__acts { margin-top: 3px; font-size: 11px; line-height: 1.6; }
.ep-label { color: #888; }
.ep-cond { display: inline-block; margin-right: 4px; padding: 1px 4px; border-radius: 2px; }
.ep-cond--ok { background: #2a4a2a; color: #66bb6a; }
.ep-cond--no { background: #4a2a2a; color: #ef5350; }
.ep-act { display: inline-block; margin-right: 4px; padding: 1px 4px; background: #232323; border-radius: 2px; }
.ep-act b { color: #4fc3f7; }
</style>
