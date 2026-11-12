<script setup lang="ts">
/**
 * SoundPanel.vue —— 音效设置（系统 → 设置 → 音效）
 * ==================================================
 * 关键约定：
 *   1. **音效默认关闭**。开关关闭时不创建 AudioContext（零 CPU / 零内存）。
 *   2. 配置落 **localStorage**（fs_sound_on / fs_sound_master / fs_sound_g:*），
 *      **不进 sys_state 存档** —— 音效偏好属于「这台设备的听感设置」，
 *      不应该跟着角色存档跨设备串味。
 *   3. 本面板只管**通用能力**（音量/开关）；
 *      业务专属音效由地图集通过 ctx.audio.register() 注入，不在这里配。
 */
import { computed, onMounted, ref } from "vue";
import {
  getGroupVolume,
  getMasterVolume,
  isSoundEnabled,
  setGroupVolume,
  setMasterVolume,
  setSoundEnabled,
  unlockAudio,
  play as playSound,
  audioContextState,
  recipeCount,
} from "../audio/audioEngine";
import { GROUP_SAMPLE, SOUND_GROUPS, type SoundGroup } from "../audio/recipes";

/** 总开关（与引擎内状态同步） */
const on = ref(isSoundEnabled());
/** 主音量 */
const master = ref(getMasterVolume());
/** 分组音量 */
const groups = ref<Record<string, number>>(
  Object.fromEntries(SOUND_GROUPS.map((g) => [g.id, getGroupVolume(g.id)])),
);
/** 音频上下文状态（调试行） */
const ctxState = ref(audioContextState());
/** 已注册配方数（内置 + 地图集自定义） */
const recipeNum = ref(recipeCount());

/** 状态文案 */
const stateText = computed(() => {
  switch (ctxState.value) {
    case "running": return "运行中";
    case "suspended": return "已暂停（需点击画面解锁）";
    case "unsupported": return "当前环境不支持音频";
    default: return "未初始化（开启后自动创建）";
  }
});

function refresh() {
  ctxState.value = audioContextState();
  recipeNum.value = recipeCount();
}

/** 总开关 */
function toggleAll(v: boolean) {
  on.value = v;
  setSoundEnabled(v);
  if (v) unlockAudio();
  refresh();
}

/** 主音量 */
function onMaster(v: number) {
  master.value = v;
  setMasterVolume(v);
}

/** 分组音量 */
function onGroup(g: SoundGroup, v: number) {
  groups.value = { ...groups.value, [g.id]: v };
  setGroupVolume(g, v);
}

/** 试听（分组样例） */
function preview(g: SoundGroup) {
  if (!on.value) {
    // 未开启时先开启（用户点了试听 = 明确意图）
    toggleAll(true);
  }
  unlockAudio();
  playSound(GROUP_SAMPLE[g], { gain: 1 });
  refresh();
}

/** 试听当前主音量下的全部分组 */
function previewAll() {
  if (!on.value) toggleAll(true);
  unlockAudio();
  let i = 0;
  for (const g of SOUND_GROUPS) {
    const delay = i * 320;
    i++;
    window.setTimeout(() => playSound(GROUP_SAMPLE[g.id]), delay);
  }
  refresh();
}

onMounted(refresh);
</script>

<template>
  <div class="sp-sound">
    <div class="sd-intro">
      音效<strong>默认关闭</strong>。开启后所有声音由引擎实时合成（无需下载素材），
      配置保存在本机浏览器（localStorage），<strong>不写入角色存档</strong>。
      <br />
      <span class="sd-intro__dim">
        首次开启时浏览器要求一次点击授权（自动播放策略），请在画面上点一下即可解锁。
      </span>
    </div>

    <!-- 总开关 -->
    <div class="sd-row sd-row--switch">
      <div class="sd-row__head">
        <label class="sd-row__label">音效总开关</label>
        <button
          class="sd-switch"
          :class="{ 'sd-switch--on': on }"
          @click="toggleAll(!on)"
        >{{ on ? "开" : "关" }}</button>
      </div>
      <div class="sd-row__hint">
        关闭时引擎完全不创建音频上下文，不占 CPU、也不占内存。
      </div>
    </div>

    <!-- 主音量 -->
    <div class="sd-row">
      <div class="sd-row__head">
        <label class="sd-row__label">主音量</label>
        <span class="sd-val">{{ Math.round(master * 100) }}%</span>
      </div>
      <input
        type="range" class="sd-range" min="0" max="1" step="0.05"
        :value="master" @input="onMaster(Number(($event.target as HTMLInputElement).value))"
      />
    </div>

    <!-- 分组音量 -->
    <div class="sd-sec">分组音量</div>
    <div v-for="g in SOUND_GROUPS" :key="g.id" class="sd-row">
      <div class="sd-row__head">
        <label class="sd-row__label">{{ g.label }}</label>
        <div class="sd-row__ctrl">
          <span class="sd-val">{{ Math.round((groups[g.id] ?? 0) * 100) }}%</span>
          <button class="sd-play" title="试听" @click="preview(g.id)">▶</button>
        </div>
      </div>
      <input
        type="range" class="sd-range" min="0" max="1" step="0.05"
        :value="groups[g.id] ?? 0"
        @input="onGroup(g.id, Number(($event.target as HTMLInputElement).value))"
      />
    </div>

    <div class="sd-actions">
      <button class="sd-btn" @click="previewAll">试听全部</button>
      <button class="sd-btn sd-btn--ghost" @click="refresh">刷新状态</button>
    </div>

    <!-- 调试状态行 -->
    <div class="sd-status">
      音频状态：<b>{{ stateText }}</b> · 已注册配方 <b>{{ recipeNum }}</b> 条
    </div>
  </div>
</template>

<style scoped>
.sp-sound { color: #e8eef5; font-size: 13px; }
.sd-intro { margin-bottom: 10px; line-height: 1.6; color: #c3cedb; }
.sd-intro strong { color: #7fb4ff; }
.sd-intro__dim { color: #8b98a8; font-size: 12px; }
.sd-sec { margin: 12px 0 6px; color: #9fd0ff; font-size: 12px; font-weight: 600; }
.sd-rows { display: flex; flex-direction: column; gap: 10px; }
.sd-row { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 8px 10px; }
.sd-row--switch { border-color: rgba(90,155,255,0.4); }
.sd-row__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sd-row__label { font-weight: 600; }
.sd-row__ctrl { display: flex; align-items: center; gap: 8px; }
.sd-row__hint { color: #8b98a8; font-size: 11px; line-height: 1.5; margin-top: 4px; }
.sd-val { color: #9fd0ff; font-size: 12px; min-width: 42px; text-align: right; }
.sd-range { width: 100%; margin: 6px 0 2px; accent-color: #4d8ef7; }
.sd-switch { width: 46px; padding: 3px 0; border-radius: 4px; border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.08); color: #cfd8e3; cursor: pointer; font-size: 12px; }
.sd-switch--on { background: #2f6fd0; border-color: #5a9bff; color: #fff; }
.sd-play { width: 26px; height: 22px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.06); color: #cfd8e3; cursor: pointer; font-size: 11px; padding: 0; }
.sd-play:hover { background: rgba(90,155,255,0.25); }
.sd-actions { display: flex; gap: 8px; margin: 12px 0 8px; }
.sd-btn { padding: 6px 14px; border-radius: 5px; border: 1px solid #5a9bff; background: #2f6fd0; color: #fff; cursor: pointer; font-size: 12px; }
.sd-btn--ghost { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.22); color: #cfd8e3; }
.sd-status { padding: 6px 10px; background: rgba(77,142,247,0.12); border-left: 3px solid #4d8ef7; border-radius: 3px; color: #b9d4ff; font-size: 12px; }
.sd-status b { color: #fff; }
</style>
