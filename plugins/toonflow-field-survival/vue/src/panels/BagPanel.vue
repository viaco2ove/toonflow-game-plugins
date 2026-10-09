<script setup lang="ts">
import { ref, reactive } from "vue";

/** 背包面板：game.md 物品系统
 *  - 与用户动态参数卡「物品」同步（App.vue sysBagItems 已合并 itemMeta）
 *  - 每个物品【使用】【修改】；type[atk,heal,buff,attribute]；durability 耐久；attribute_type 被动加成
 *  - 支持拖拽排序 + 按名称排序 + 卖出 */
const props = defineProps<{
  items: any[];
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

const RARITY_COLOR: Record<string, string> = { common: "#9aa4ad", fine: "#4aa3ff", rare: "#a76bff", epic: "#ff9a3c", legend: "#ff4d4d" };
const RARITY_NAME: Record<string, string> = { common: "普通", fine: "精良", rare: "稀有", epic: "史诗", legend: "传说" };
/** game.md：特效类型 [atk, heal, buff, attribute]；buff_type 六类；attribute_type 四类 */
const BUFF_TYPES = ["Defense", "Attack", "Sustained_Damage", "Stunning", "Invincible", "Accelerate"] as const;
const BUFF_LABEL: Record<string, string> = {
  Defense: "防御", Attack: "攻击", Sustained_Damage: "持续伤害", Stunning: "晕眩", Invincible: "无敌", Accelerate: "加速",
};
const ATTR_TYPES = ["Defense", "Attack", "Life", "Blue"] as const;
const ATTR_LABEL: Record<string, string> = { Defense: "防御", Attack: "攻击", Life: "生命", Blue: "蓝量" };
const TYPE_LABEL: Record<string, string> = { atk: "攻击", heal: "治疗", buff: "强化", attribute: "属性" };

/** 属性特效枚举（与 md/游戏特效.md P2 对照） */
const EFFECT_TYPES: Array<{ v: string; label: string }> = [
  { v: "", label: "默认" },
  { v: "normal", label: "普通" },
  { v: "fire", label: "火" }, { v: "water", label: "水" }, { v: "thunder", label: "雷" },
  { v: "wind", label: "风" }, { v: "earth", label: "土" }, { v: "metal", label: "金" }, { v: "wood", label: "木" },
  { v: "light", label: "光明" }, { v: "dark", label: "黑暗" },
  { v: "bleed", label: "出血" }, { v: "poison", label: "毒素" },
];

function durText(it: any): string {
  const d = Math.round(Number(it?.durability ?? -1));
  if (d < 0) return "永久";
  const left = Math.round(Number(it?.durabilityLeft ?? d));
  return `耐久 ${left}/${d}`;
}
function attrText(it: any): string {
  const t = String(it?.attribute_type || "");
  const v = Math.round(Number(it?.attribute_value || 0));
  if (!t || !v) return "";
  return `${ATTR_LABEL[t] || t}+${v}`;
}

/** 正在编辑的物品下标（-1 = 无）；正在卖出的物品下标 */
const editing = ref(-1);
const selling = ref(-1);
const sellCount = ref(1);
const form = reactive({
  name: "", power: 0, cost: 0, cd: 0, type: "heal", range: "melee",
  lv: 1, buff_type: "", durability: -1, attribute_type: "", attribute_value: 0,
  quantity: 1, description: "", effects_type: "",
});

function startEdit(it: any, i: number) {
  editing.value = editing.value === i ? -1 : i;
  selling.value = -1;
  if (editing.value !== i) return;
  form.name = it.name;
  form.power = Math.round(Number(it.power) || 0);
  form.cost = Math.round(Number(it.cost) || 0);
  form.cd = Math.max(0, Math.round(Number(it.cd) || 0));
  form.type = ["atk", "heal", "buff", "attribute"].includes(it.type) ? it.type : "heal";
  form.range = it.range === "ranged" ? "ranged" : "melee";
  form.lv = Math.max(1, Math.round(Number(it.lv) || 1));
  form.buff_type = (BUFF_TYPES as readonly string[]).includes(it.buff_type) ? it.buff_type : "";
  form.durability = Math.round(Number(it.durability ?? -1));
  form.attribute_type = (ATTR_TYPES as readonly string[]).includes(it.attribute_type) ? it.attribute_type : "";
  form.attribute_value = Math.round(Number(it.attribute_value) || 0);
  form.quantity = Math.max(1, Math.round(Number(it.count ?? it.quantity) || 1));
  form.description = String(it.description || it.desc || "");
  form.effects_type = String(it.effects_type || "");
}
function submitEdit(i: number) {
  emit("edit-item", {
    index: i,
    name: form.name.trim() || "",
    power: form.power,
    cost: form.cost,
    cd: form.cd,
    type: form.type,
    range: form.range,
    lv: form.lv,
    buff_type: form.buff_type,
    durability: form.durability,
    attribute_type: form.attribute_type,
    attribute_value: form.attribute_value,
    quantity: Math.max(1, Math.round(Number(form.quantity) || 1)),
    description: form.description.trim(),
    effects_type: form.effects_type,
  });
  editing.value = -1;
}

function startSell(it: any, i: number) {
  selling.value = selling.value === i ? -1 : i;
  editing.value = -1;
  sellCount.value = 1;
}
function sellStep(it: any, d: number) {
  sellCount.value = Math.max(1, Math.min(Number(it.count) || 1, sellCount.value + d));
}
function doSell(it: any) {
  emit("sell", it, Math.max(1, sellCount.value));
  selling.value = -1;
}

let dragFrom = -1;
function onDragStart(i: number) { dragFrom = i; }
function onDragOver(e: DragEvent) { e.preventDefault(); }
function onDrop(i: number) {
  if (dragFrom >= 0 && dragFrom !== i) emit("sort", dragFrom, i);
  dragFrom = -1;
}
</script>

<template>
  <div class="bpi">
    <div class="bpi-bar">
      <span>背包（{{ items.length }} 种）· 拖拽排序</span>
      <button class="bpi-mini" @click="emit('sort-auto')">按名称排序</button>
    </div>

    <div v-if="!items.length" class="bpi-empty">背包空空如也，去地图上打怪或到商城采购吧。</div>

    <div
      v-for="(it, i) in items"
      :key="it.name + '_' + i"
      class="bpi-row"
      :class="{ 'bpi-row--cd': Number(it.cdLeft) > 0 }"
      draggable="true"
      @dragstart="onDragStart(i)"
      @dragover="onDragOver"
      @drop="onDrop(i)"
    >
      <div class="bpi-info">
        <div class="bpi-name">
          {{ it.name }}<span class="bpi-count">×{{ it.count }}</span>
          <span v-if="it.lv && it.lv > 1" class="bpi-lv">lv{{ it.lv }}</span>
          <span class="bpi-badge" :class="'bpi-badge--' + (it.type || 'heal')">{{ TYPE_LABEL[it.type] || "治疗" }}</span>
          <span v-if="(it.type || 'heal') === 'atk' && it.range === 'ranged'" class="bpi-badge bpi-badge--range">远程</span>
          <span v-if="it.type === 'buff' && it.buff_type" class="bpi-badge bpi-badge--bufftype">{{ BUFF_LABEL[it.buff_type] || it.buff_type }}</span>
          <span v-if="attrText(it)" class="bpi-badge bpi-badge--attr">{{ attrText(it) }}</span>
          <span class="bpi-badge bpi-badge--dur" :class="{ 'bpi-badge--durw': Number(it.durability) > 0 && Number(it.durabilityLeft) <= 2 }">{{ durText(it) }}</span>
        </div>
        <div class="bpi-desc">
          {{ it.desc || (it.type === "heal" ? "使用恢复 " + (it.heal || 0) + " 点生命" : it.type === "atk" ? "威力 " + (it.power || 0) + " · 普攻效果" : it.type === "attribute" ? "背包被动加成，使用不消耗" : "可用于交易或合成") }}
          · 卖价 {{ it.price || 0 }}金
        </div>
      </div>
      <button class="bpi-btn" @click="emit('use-item', it)">使用</button>
      <button class="bpi-btn bpi-btn--edit" @click="startEdit(it, i)">{{ editing === i ? "收起" : "修改" }}</button>
      <button class="bpi-btn bpi-btn--sell" @click="startSell(it, i)">{{ selling === i ? "收起" : "卖出" }}</button>

      <div v-if="editing === i" class="bpi-edit">
        <label>名称<input v-model="form.name" maxlength="20" /></label>
        <label>威力<input v-model.number="form.power" type="number" min="0" /></label>
        <label>消耗MP<input v-model.number="form.cost" type="number" min="0" /></label>
        <label>冷却(tick)<input v-model.number="form.cd" type="number" min="0" /></label>
        <label>特效类型
          <select v-model="form.type">
            <option value="atk">攻击 (atk)</option>
            <option value="heal">治疗 (heal)</option>
            <option value="buff">强化 (buff)</option>
            <option value="attribute">属性 (attribute)</option>
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
        <label>等级 lv<input v-model.number="form.lv" type="number" min="1" /></label>
        <label>耐久 durability<input v-model.number="form.durability" type="number" min="-1" />（-1 永久）</label>
        <label>被动属性 attribute_type
          <select v-model="form.attribute_type">
            <option value="">无</option>
            <option v-for="a in ATTR_TYPES" :key="a" :value="a">{{ ATTR_LABEL[a] }}（{{ a }}）</option>
          </select>
        </label>
        <label>被动数值 attribute_value<input v-model.number="form.attribute_value" type="number" /></label>
        <label>数量 quantity<input v-model.number="form.quantity" type="number" min="1" /></label>
        <label>属性特效
          <select v-model="form.effects_type">
            <option v-for="et in EFFECT_TYPES" :key="et.v" :value="et.v">{{ et.label }}（{{ et.v }}）</option>
          </select>
        </label>
        <label style="grid-column: 1 / -1">描述 description<input v-model="form.description" maxlength="60" placeholder="保留参数卡原注记，可改写" /></label>
        <div class="bpi-edit__ops">
          <button class="bpi-btn" @click="submitEdit(i)">保存</button>
          <button class="bpi-btn bpi-btn--ghost" @click="editing = -1">取消</button>
        </div>
        <div class="bpi-edit__hint">修改后保存到 t_plugin_session_data；特效按类型沿用：攻击近战→冲斩刀光 / 攻击远程→火球 / 治疗→治疗环 / 强化→护盾环 / 属性→小跳+普攻；耐久>0 时每用一次 -1，用完损毁 1 个。</div>
      </div>

      <div v-if="selling === i" class="bpi-sellrow">
        <button class="bpi-mini" @click="sellStep(it, -1)">-</button>
        <span class="bpi-sellcount">{{ sellCount }} / {{ it.count }}</span>
        <button class="bpi-mini" @click="sellStep(it, 1)">+</button>
        <button class="bpi-mini bpi-mini--go" @click="doSell(it)">卖出 {{ sellCount }} 个</button>
      </div>
    </div>

    <div class="bpi-hint">无专属特效的物品统一走「角色小跳 + 飘字」通用特效；attribute 类型放背包即被动加成（防御/攻击/生命/蓝量）。</div>
  </div>
</template>

<style scoped>
.bpi { display: flex; flex-direction: column; gap: 6px; }
.bpi-bar { display: flex; align-items: center; justify-content: space-between; color: #cfd8e3; font-size: 12px; }
.bpi-row { display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(0, 0, 0, 0.18); flex-wrap: wrap; cursor: grab; }
.bpi-row--cd { opacity: 0.6; }
.bpi-info { flex: 1 1 auto; min-width: 0; }
.bpi-name { font-size: 12px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.bpi-count { font-size: 10px; color: #ffd76a; }
.bpi-lv { font-size: 9px; color: #ffd76a; border: 1px solid rgba(255, 215, 106, 0.5); border-radius: 3px; padding: 0 3px; }
.bpi-badge { font-size: 9px; border-radius: 3px; padding: 0 4px; border: 1px solid rgba(255, 255, 255, 0.2); color: #cfd8e3; }
.bpi-badge--atk { color: #ff9d7a; border-color: rgba(255, 130, 90, 0.5); }
.bpi-badge--heal { color: #7cffb2; border-color: rgba(110, 240, 170, 0.5); }
.bpi-badge--buff { color: #9ccfff; border-color: rgba(140, 190, 255, 0.5); }
.bpi-badge--attribute { color: #e0c0ff; border-color: rgba(190, 140, 255, 0.5); }
.bpi-badge--range { color: #ffb3f0; border-color: rgba(255, 150, 230, 0.5); }
.bpi-badge--bufftype { color: #ffe08a; border-color: rgba(255, 200, 100, 0.5); }
.bpi-badge--attr { color: #bfe6ff; border-color: rgba(140, 210, 255, 0.5); }
.bpi-badge--dur { color: #b8c4d0; border-color: rgba(255, 255, 255, 0.16); }
.bpi-badge--durw { color: #ff9d7a; border-color: rgba(255, 130, 90, 0.5); }
.bpi-desc { font-size: 10px; color: #93a2b3; }
.bpi-btn { padding: 4px 10px; border-radius: 5px; border: 1px solid #5a9bff; background: #2f6fd0; color: #fff; font-size: 11px; cursor: pointer; }
.bpi-btn--edit { border-color: rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.08); color: #cfd8e3; }
.bpi-btn--sell { border-color: #ffb04a; background: #a8631a; color: #fff; }
.bpi-btn--ghost { border-color: rgba(255, 255, 255, 0.2); background: transparent; color: #93a2b3; }
.bpi-edit { flex-basis: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; background: rgba(0, 0, 0, 0.25); }
.bpi-edit label { display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: #93a2b3; }
.bpi-edit input, .bpi-edit select { background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 4px; color: #e6eef6; font-size: 11px; padding: 3px 5px; }
.bpi-edit__ops { grid-column: 1 / -1; display: flex; gap: 6px; }
.bpi-edit__hint { grid-column: 1 / -1; font-size: 9px; color: #6d7c8c; }
.bpi-sellrow { flex-basis: 100%; display: flex; align-items: center; gap: 6px; font-size: 11px; }
.bpi-sellcount { color: #ffd76a; }
.bpi-mini { padding: 3px 8px; border-radius: 5px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.06); color: #cfd8e3; cursor: pointer; font-size: 11px; }
.bpi-mini--go { border-color: #ffb04a; color: #ffd76a; }
.bpi-empty, .bpi-hint { color: #93a2b3; font-size: 11px; }
</style>
