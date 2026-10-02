<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  player: any;
  cards: any[];
  currentMap: string;
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

function hpPct(c: any) {
  const max = Number(c.maxHp) || 0;
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((Number(c.hp) || 0) / max) * 100)));
}
function expPct(c: any) {
  const need = (Number(c.level) || 1) * 100;
  return Math.max(0, Math.min(100, Math.round(((Number(c.exp) || 0) / need) * 100)));
}
function place(c: any) {
  if (c.onMap === false) return "未上场 · 暂无位置信息";
  const on = (c.mapName || "") === props.currentMap;
  return (c.mapName || "未知地图") + (on ? "（本图）" : "") + " (" + Math.round(Number(c.x) || 0) + ", " + Math.round(Number(c.y) || 0) + ")";
}
function canParty(c: any) { return !c.enemy && c.side !== "enemy"; }

/* ============ ★ game.md 角色卡：动态参数卡（对齐 Toonflow-game-web 角色详情的参数卡区块） ============ */

/** 展开参数卡的角色 id 集合（含玩家 "PLAYER"） */
const openCards = ref<Set<string>>(new Set());
const rawOpenCards = ref<Set<string>>(new Set());

function toggleCard(id: string) {
  const s = new Set(openCards.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  openCards.value = s;
}
function toggleRaw(id: string) {
  const s = new Set(rawOpenCards.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  rawOpenCards.value = s;
}
function isOpen(id: string) { return openCards.value.has(id); }
function isRawOpen(id: string) { return rawOpenCards.value.has(id); }

function scalarText(input: unknown): string {
  const text = String(input ?? "").trim();
  if (!text || text === "null" || text === "undefined") return "";
  return text;
}

function stringifyList(items: any): string {
  if (!Array.isArray(items) || !items.length) return "未设定";
  return items.map((it) => typeof it === "string" ? it : (scalarText((it as any)?.name) || JSON.stringify(it))).join("、") || "未设定";
}

function stringifyExecutingTask(card: any): string {
  const task = card?.executing_task;
  if (!task) return "未设定";
  return scalarText(task.summary)
    || [scalarText(task.title), scalarText(task.objective) ? `目标：${scalarText(task.objective)}` : "", scalarText(task.status) ? `状态：${scalarText(task.status)}` : ""]
      .filter(Boolean).join("｜")
    || "未设定";
}

function stringifyOther(card: any): string {
  try { return JSON.stringify(card?.other ?? [], null, 2); } catch { return "[]"; }
}

/** 与 Toonflow-game-web ScenePlay.parameterCardEntries 同一套字段清单 */
function parameterCardEntries(card: any): { label: string; value: string }[] {
  if (!card || typeof card !== "object") return [];
  return [
    { label: "角色名", value: scalarText(card.name) || "未设定" },
    { label: "性别", value: scalarText(card.gender) || "未设定" },
    { label: "年龄", value: card.age != null ? String(card.age) : "未设定" },
    { label: "等级", value: card.level != null ? String(card.level) : "未设定" },
    { label: "经验值", value: card.exp != null ? String(card.exp) : "未设定" },
    { label: "下一级所需经验", value: card.next_level_exp != null ? String(card.next_level_exp) : "未设定" },
    { label: "等级称号", value: scalarText(card.level_desc) || "未设定" },
    { label: "性格", value: scalarText(card.personality) || "未设定" },
    { label: "外貌", value: scalarText(card.appearance) || "未设定" },
    { label: "音色特点", value: scalarText(card.voice) || "未设定" },
    { label: "技能", value: stringifyList(card.skills) },
    { label: "物品", value: stringifyList(card.items) },
    { label: "装备", value: stringifyList(card.equipment) },
    { label: "血量", value: card.hp != null ? String(card.hp) : "未设定" },
    { label: "蓝量", value: card.mp != null ? String(card.mp) : "未设定" },
    { label: "金钱", value: card.money != null ? String(card.money) : "未设定" },
    { label: "正在执行的任务", value: stringifyExecutingTask(card) },
    { label: "角色关键信息", value: scalarText(card.role_key_information) || "未设定" },
    { label: "其他", value: stringifyOther(card) },
  ];
}

function rawSetting(card: any): string {
  if (!card) return "未设定";
  return scalarText(card.raw_setting) || "未设定";
}
function hasCard(c: any) { return !!c?.parameterCardJson && typeof c.parameterCardJson === "object"; }
</script>

<template>
  <div class="rlc">
    <div v-if="player" class="rlc-card rlc-card--me">
      <img v-if="player.avatarPath" class="rlc-avatar" :src="player.avatarPath" alt="" />
      <div v-else class="rlc-avatar rlc-avatar--ph">我</div>
      <div class="rlc-main">
        <div class="rlc-name">
          {{ player.name }}<span class="rlc-tag">用户</span><span class="rlc-lv">Lv.{{ player.level || 1 }}</span>
        </div>
        <div class="rlc-bar"><i class="rlc-bar__hp" :style="{ width: hpPct(player) + '%' }"></i></div>
        <div class="rlc-meta">HP {{ player.hp }}/{{ player.maxHp }} · 经验 {{ expPct(player) }}% · {{ place(player) }}</div>
      </div>
      <div class="rlc-ops">
        <button class="rlc-btn rlc-btn--ghost" @click="toggleCard('PLAYER')">{{ isOpen('PLAYER') ? '收起参数卡' : '参数卡' }}</button>
      </div>
      <!-- ★ 动态参数卡（用户）：结构化展开，可切回原文核对 -->
      <div v-if="isOpen('PLAYER')" class="rlc-param">
        <template v-if="hasCard(player)">
          <div class="rlc-param__head">
            <span class="rlc-param__title">参数卡</span>
            <button class="rlc-btn rlc-btn--mini" @click="toggleRaw('PLAYER')">{{ isRawOpen('PLAYER') ? '收起原文' : '查看原文' }}</button>
          </div>
          <div class="rlc-param__raw-setting">
            <div class="rlc-param__label">原始角色设定</div>
            <div class="rlc-param__value rlc-param__value--scroll">{{ rawSetting(player.parameterCardJson) }}</div>
          </div>
          <div class="rlc-param__grid">
            <div v-for="item in parameterCardEntries(player.parameterCardJson)" :key="item.label" class="rlc-param__item">
              <div class="rlc-param__label">{{ item.label }}</div>
              <div class="rlc-param__value" :class="{ 'rlc-param__value--scroll': String(item.value || '').length > 120 }">{{ item.value }}</div>
            </div>
          </div>
          <pre v-if="isRawOpen('PLAYER')" class="rlc-param__pre">{{ JSON.stringify(player.parameterCardJson, null, 2) }}</pre>
        </template>
        <div v-else class="rlc-param__empty">无参数卡</div>
      </div>
    </div>

    <div
      v-for="c in cards"
      :key="c.id"
      class="rlc-card"
      :class="{ 'rlc-card--dead': !c.alive, 'rlc-card--enemy': c.enemy }"
    >
      <img v-if="c.avatarPath" class="rlc-avatar" :src="c.avatarPath" alt="" />
      <div v-else class="rlc-avatar rlc-avatar--ph">{{ (c.name || "?").slice(0, 1) }}</div>
      <div class="rlc-main">
        <div class="rlc-name">
          {{ c.name }}<span v-if="c.enemy" class="rlc-tag rlc-tag--enemy">敌对</span><span class="rlc-lv">Lv.{{ c.level }}</span>
        </div>
        <div class="rlc-bar"><i class="rlc-bar__hp" :style="{ width: hpPct(c) + '%' }"></i></div>
        <div class="rlc-meta">HP {{ c.hp }}/{{ c.maxHp }} · {{ place(c) }}</div>
      </div>
      <div class="rlc-ops">
        <button class="rlc-btn rlc-btn--ghost" @click="toggleCard(c.id)">{{ isOpen(c.id) ? '收起参数卡' : '参数卡' }}</button>
        <button class="rlc-btn" @click="emit('teleport', c)">传送到</button>
        <label class="rlc-chk" :class="{ 'rlc-chk--off': !canParty(c) }">
          <input type="checkbox" :checked="!!c.inParty" :disabled="!canParty(c)" @change="emit('follow', c.id, ($event.target as HTMLInputElement).checked)" />
          组队跟随
        </label>
      </div>
      <!-- ★ 动态参数卡（友方/中立/敌对全部可看） -->
      <div v-if="isOpen(c.id)" class="rlc-param">
        <template v-if="hasCard(c)">
          <div class="rlc-param__head">
            <span class="rlc-param__title">参数卡</span>
            <button class="rlc-btn rlc-btn--mini" @click="toggleRaw(c.id)">{{ isRawOpen(c.id) ? '收起原文' : '查看原文' }}</button>
          </div>
          <div class="rlc-param__raw-setting">
            <div class="rlc-param__label">原始角色设定</div>
            <div class="rlc-param__value rlc-param__value--scroll">{{ rawSetting(c.parameterCardJson) }}</div>
          </div>
          <div class="rlc-param__grid">
            <div v-for="item in parameterCardEntries(c.parameterCardJson)" :key="item.label" class="rlc-param__item">
              <div class="rlc-param__label">{{ item.label }}</div>
              <div class="rlc-param__value" :class="{ 'rlc-param__value--scroll': String(item.value || '').length > 120 }">{{ item.value }}</div>
            </div>
          </div>
          <pre v-if="isRawOpen(c.id)" class="rlc-param__pre">{{ JSON.stringify(c.parameterCardJson, null, 2) }}</pre>
        </template>
        <div v-else class="rlc-param__empty">无参数卡（该角色未配置 parameterCardJson）</div>
      </div>
    </div>

    <div v-if="!cards.length" class="rlc-empty">当前没有其它角色。</div>
    <div class="rlc-hint">角色列表来自当前 AI 故事的动态角色卡（友方/中立/敌对全部显示，无论是否已上场）。未上场角色点击「传送到」会先生成到可活动区域；组队成员会跟随你并协助打怪，随击杀共享经验并升级；敌对角色不可组队。</div>
  </div>
</template>

<style scoped>
.rlc { display: flex; flex-direction: column; gap: 6px; }
.rlc-card { display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(0, 0, 0, 0.18); flex-wrap: wrap; }
.rlc-card--me { border-color: rgba(255, 215, 106, 0.5); }
.rlc-card--enemy { border-color: rgba(255, 107, 107, 0.4); }
.rlc-card--dead { opacity: 0.5; }
.rlc-avatar { width: 34px; height: 34px; border-radius: 6px; object-fit: cover; background: #2b3644; }
.rlc-avatar--ph { display: flex; align-items: center; justify-content: center; font-size: 12px; color: #cfd8e3; }
.rlc-main { flex: 1 1 auto; min-width: 0; }
.rlc-name { font-size: 12px; display: flex; align-items: center; gap: 4px; }
.rlc-tag { font-size: 10px; color: #ffd76a; border: 1px solid rgba(255, 215, 106, 0.6); border-radius: 3px; padding: 0 3px; }
.rlc-tag--enemy { color: #ff8a8a; border-color: rgba(255, 138, 138, 0.6); }
.rlc-lv { margin-left: auto; color: #9fd0ff; font-size: 11px; }
.rlc-bar { height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.12); overflow: hidden; margin: 3px 0; }
.rlc-bar__hp { display: block; height: 100%; background: linear-gradient(90deg, #ff6b6b, #ffb04a); }
.rlc-meta { font-size: 10px; color: #93a2b3; }
.rlc-ops { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.rlc-btn { padding: 3px 8px; border-radius: 5px; border: 1px solid #5a9bff; background: #2f6fd0; color: #fff; font-size: 11px; cursor: pointer; }
.rlc-btn:disabled { border-color: #4a5563; background: #3a434f; color: #8b98a6; cursor: not-allowed; }
.rlc-btn--ghost { border-color: rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.06); color: #cfd8e3; }
.rlc-btn--mini { padding: 1px 6px; font-size: 10px; }
.rlc-chk { font-size: 10px; color: #cfd8e3; display: flex; align-items: center; gap: 3px; }
.rlc-chk--off { opacity: 0.5; }
.rlc-empty, .rlc-hint { color: #93a2b3; font-size: 11px; }

/* ---- 参数卡展开区（对齐 web 端 play-inline-card 的参数卡区块） ---- */
.rlc-param { flex: 1 1 100%; border-top: 1px dashed rgba(255, 255, 255, 0.15); margin-top: 4px; padding-top: 6px; }
.rlc-param__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.rlc-param__title { font-size: 11px; color: #9fd0ff; font-weight: 700; }
.rlc-param__raw-setting { margin-bottom: 6px; }
.rlc-param__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 6px; }
.rlc-param__item { border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 5px; padding: 4px 6px; background: rgba(255, 255, 255, 0.03); min-width: 0; }
.rlc-param__label { font-size: 10px; color: #93a2b3; }
.rlc-param__value { font-size: 11px; color: #e8eef5; margin-top: 2px; word-break: break-all; white-space: pre-wrap; }
.rlc-param__value--scroll { max-height: 72px; overflow: auto; }
.rlc-param__pre { max-height: 180px; overflow: auto; font-size: 10px; background: rgba(0, 0, 0, 0.35); border-radius: 5px; padding: 6px; color: #cfd8e3; margin: 6px 0 0; }
.rlc-param__empty { font-size: 11px; color: #93a2b3; font-style: italic; }
</style>
