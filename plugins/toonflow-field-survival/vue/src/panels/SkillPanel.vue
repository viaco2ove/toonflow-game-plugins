<script setup lang="ts">
import { ref, reactive } from "vue";

const props = defineProps<{
  skills: any[];
  currentMp: number;
  currentMaxMp: number;
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

/** game.md：特效类型 [atk, heal, buff]；buff_type 六类 */
const BUFF_TYPES = ["Defense", "Attack", "Sustained_Damage", "Stunning", "Invincible", "Accelerate"] as const;
const BUFF_LABEL: Record<string, string> = {
  Defense: "防御",
  Attack: "攻击",
  Sustained_Damage: "持续伤害",
  Stunning: "晕眩",
  Invincible: "无敌",
  Accelerate: "加速",
};
const TYPE_LABEL: Record<string, string> = { atk: "攻击", heal: "治疗", buff: "强化" };

/** 属性特效枚举（与 md/游戏特效.md P2 对照） */
const EFFECT_TYPES: Array<{ v: string; label: string }> = [
  { v: "", label: "默认" },
  { v: "normal", label: "普通" },
  { v: "fire", label: "火" }, { v: "water", label: "水" }, { v: "thunder", label: "雷" },
  { v: "wind", label: "风" }, { v: "earth", label: "土" }, { v: "metal", label: "金" }, { v: "wood", label: "木" },
  { v: "light", label: "光明" }, { v: "dark", label: "黑暗" },
  { v: "bleed", label: "出血" }, { v: "poison", label: "毒素" },
];

function cdText(cd: number) { return (cd / 10).toFixed(1) + "s"; }
function cdLeftText(cdLeft: number) { return (cdLeft / 10).toFixed(1) + "s"; }

/** 正在编辑的技能下标（-1 = 无） */
const editing = ref(-1);
const form = reactive({ name: "", power: 0, cost: 0, cd: 24, type: "atk", range: "melee", lv: 1, buff_type: "", effects_type: "" });

function startEdit(s: any, i: number) {
  editing.value = editing.value === i ? -1 : i;
  if (editing.value !== i) return;
  form.name = s.name;
  form.power = Math.round(Number(s.power) || 0);
  form.cost = Math.round(Number(s.cost) || 0);
  form.cd = Math.max(1, Math.round(Number(s.cd) || 24));
  form.type = ["atk", "heal", "buff"].includes(s.type) ? s.type : "atk";
  form.range = s.range === "ranged" ? "ranged" : "melee";
  form.lv = Math.max(1, Math.round(Number(s.lv) || 1));
  form.buff_type = BUFF_TYPES.includes(s.buff_type) ? s.buff_type : "";
  form.effects_type = String(s.effects_type || "");
}
function submitEdit(i: number) {
  emit("edit-skill", {
    index: i,
    name: form.name.trim() || "",
    power: form.power,
    cost: form.cost,
    cd: form.cd,
    type: form.type,
    range: form.range,
    lv: form.lv,
    buff_type: form.buff_type,
    effects_type: form.effects_type,
  });
  editing.value = -1;
}
</script>

<template>
  <div class="skp">
    <div class="skp-bar">MP {{ currentMp }}/{{ currentMaxMp }} · 技能 {{ skills.length }} 项</div>

    <div v-for="(s, i) in skills" :key="s.name + i" class="skp-row" :class="{ 'skp-row--cd': s.cdLeft > 0 }">
      <div class="skp-info">
        <div class="skp-name">
          {{ s.name }}<span v-if="s.lv && s.lv > 1" class="skp-lv">lv{{ s.lv }}</span>
          <span class="skp-badge" :class="'skp-badge--' + (s.type || 'atk')">{{ TYPE_LABEL[s.type] || "攻击" }}</span>
          <span v-if="(s.type || 'atk') === 'atk' && s.range === 'ranged'" class="skp-badge skp-badge--range">远程</span>
          <span v-if="s.type === 'buff' && s.buff_type" class="skp-badge skp-badge--bufftype">{{ BUFF_LABEL[s.buff_type] || s.buff_type }}</span>
        </div>
        <div class="skp-desc">威力 {{ s.power }} · 消耗 {{ s.cost }}MP · 冷却 {{ cdText(s.cd) }}{{ s.cdLeft > 0 ? "（剩余 " + cdLeftText(s.cdLeft) + "）" : "" }}</div>
      </div>
      <button class="skp-btn" :disabled="s.cdLeft > 0" @click="emit('use-skill', s, i)">{{ s.cdLeft > 0 ? "冷却中" : "使用" }}</button>
      <button class="skp-btn skp-btn--edit" @click="startEdit(s, i)">{{ editing === i ? "收起" : "修改" }}</button>

      <div v-if="editing === i" class="skp-edit">
        <label>名称<input v-model="form.name" maxlength="12" /></label>
        <label>威力<input v-model.number="form.power" type="number" min="0" /></label>
        <label>消耗MP<input v-model.number="form.cost" type="number" min="0" /></label>
        <label>冷却(tick)<input v-model.number="form.cd" type="number" min="1" /></label>
        <label>特效类型
          <select v-model="form.type">
            <option value="atk">攻击 (atk)</option>
            <option value="heal">治疗 (heal)</option>
            <option value="buff">强化 (buff)</option>
          </select>
        </label>
        <label v-if="form.type === 'atk'">距离
          <select v-model="form.range">
            <option value="melee">近战（冲斩特效）</option>
            <option value="ranged">远程（火球特效）</option>
          </select>
        </label>
        <label v-if="form.type === 'buff'">buff 类型
          <select v-model="form.buff_type">
            <option value="">无</option>
            <option v-for="b in BUFF_TYPES" :key="b" :value="b">{{ BUFF_LABEL[b] }}（{{ b }}）</option>
          </select>
        </label>
        <label>属性特效
          <select v-model="form.effects_type">
            <option v-for="et in EFFECT_TYPES" :key="et.v" :value="et.v">{{ et.label }}（{{ et.v }}）</option>
          </select>
        </label>
        <label>等级 lv<input v-model.number="form.lv" type="number" min="1" /></label>
        <div class="skp-edit__ops">
          <button class="skp-btn" @click="submitEdit(i)">保存</button>
          <button class="skp-btn skp-btn--ghost" @click="editing = -1">取消</button>
        </div>
        <div class="skp-edit__hint">修改后参数保存到 t_plugin_session_data；特效按类型沿用：攻击近战→冲斩刀光 / 攻击远程→火球 / 治疗→治疗环 / 强化→护盾环。</div>
      </div>
    </div>

    <div v-if="!skills.length" class="skp-empty">尚未习得技能，可通过商城技能书或剧情获得。</div>
    <div class="skp-hint">点击「使用」即切换为当前技能并施放，与技能栏（快捷栏）同步；无专属特效的技能用角色小跳 + 飘字作为通用特效。</div>
  </div>
</template>

<style scoped>
.skp { display: flex; flex-direction: column; gap: 6px; }
.skp-bar { font-size: 11px; color: #9fd0ff; }
.skp-row { display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(0, 0, 0, 0.18); flex-wrap: wrap; }
.skp-row--cd { opacity: 0.6; }
.skp-info { flex: 1 1 auto; min-width: 0; }
.skp-name { font-size: 12px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.skp-lv { font-size: 9px; color: #ffd76a; border: 1px solid rgba(255, 215, 106, 0.5); border-radius: 3px; padding: 0 3px; }
.skp-badge { font-size: 9px; border-radius: 3px; padding: 0 4px; border: 1px solid rgba(255, 255, 255, 0.2); color: #cfd8e3; }
.skp-badge--atk { color: #ff9d7a; border-color: rgba(255, 130, 90, 0.5); }
.skp-badge--heal { color: #7cffb2; border-color: rgba(110, 240, 170, 0.5); }
.skp-badge--buff { color: #9ccfff; border-color: rgba(140, 190, 255, 0.5); }
.skp-badge--range { color: #ffb3f0; border-color: rgba(255, 150, 230, 0.5); }
.skp-badge--bufftype { color: #ffe08a; border-color: rgba(255, 200, 100, 0.5); }
.skp-desc { font-size: 10px; color: #93a2b3; }
.skp-btn { padding: 4px 10px; border-radius: 5px; border: 1px solid #5a9bff; background: #2f6fd0; color: #fff; font-size: 11px; cursor: pointer; }
.skp-btn:disabled { opacity: 0.5; cursor: default; }
.skp-btn--edit { border-color: rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.08); color: #cfd8e3; }
.skp-btn--ghost { border-color: rgba(255, 255, 255, 0.2); background: transparent; color: #93a2b3; }
.skp-edit { flex-basis: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; background: rgba(0, 0, 0, 0.25); }
.skp-edit label { display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: #93a2b3; }
.skp-edit input, .skp-edit select { background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 4px; color: #e6eef6; font-size: 11px; padding: 3px 5px; }
.skp-edit__ops { grid-column: 1 / -1; display: flex; gap: 6px; }
.skp-edit__hint { grid-column: 1 / -1; font-size: 9px; color: #6d7c8c; }
.skp-empty { color: #93a2b3; font-size: 11px; }
.skp-hint { color: #6d7c8c; font-size: 10px; }
</style>
