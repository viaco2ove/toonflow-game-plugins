<script setup lang="ts">
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
  const on = (c.mapName || "") === props.currentMap;
  return (c.mapName || "未知地图") + (on ? "（本图）" : "") + " (" + Math.round(Number(c.x) || 0) + ", " + Math.round(Number(c.y) || 0) + ")";
}
function canAct(c: any) { return !c.enemy && c.side !== "enemy"; }
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
        <button class="rlc-btn" :disabled="!canAct(c)" @click="emit('teleport', c)">传送到</button>
        <label class="rlc-chk" :class="{ 'rlc-chk--off': !canAct(c) }">
          <input type="checkbox" :checked="!!c.inParty" :disabled="!canAct(c)" @change="emit('follow', c.id, ($event.target as HTMLInputElement).checked)" />
          组队跟随
        </label>
      </div>
    </div>

    <div v-if="!cards.length" class="rlc-empty">当前没有其它角色。</div>
    <div class="rlc-hint">组队成员会跟随你并协助打怪，随击杀共享经验并升级；敌对角色不可传送或组队。</div>
  </div>
</template>

<style scoped>
.rlc { display: flex; flex-direction: column; gap: 6px; }
.rlc-card { display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; background: rgba(0, 0, 0, 0.18); }
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
.rlc-chk { font-size: 10px; color: #cfd8e3; display: flex; align-items: center; gap: 3px; }
.rlc-chk--off { opacity: 0.5; }
.rlc-empty, .rlc-hint { color: #93a2b3; font-size: 11px; }
</style>
