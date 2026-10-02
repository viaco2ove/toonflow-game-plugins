<script setup lang="ts">
import { ref } from "vue";
import BagPanel from "./panels/BagPanel.vue";
import RingPanel from "./panels/RingPanel.vue";
import ShopPanel from "./panels/ShopPanel.vue";
import SkillPanel from "./panels/SkillPanel.vue";
import MapPanel from "./panels/MapPanel.vue";
import RolePanel from "./panels/RolePanel.vue";

type TabId = "bag" | "ring" | "shop" | "skill" | "map" | "role";

const props = defineProps<{
  player: any;
  npcs: any[];
  bagItems: any[];
  ringItems: any[];
  ringSkills: any[];
  skills: any[];
  goods: any[];
  goodsSource: string;
  gold: number;
  currentMp: number;
  currentMaxMp: number;
  currentMap: string;
  playerX: number;
  playerY: number;
  mapNodes: any[];
  navPath: string[];
  notice: string;
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: "bag", label: "背包", icon: "🎒" },
  { id: "ring", label: "纳戒", icon: "💍" },
  { id: "shop", label: "商城", icon: "🏪" },
  { id: "skill", label: "技能", icon: "✨" },
  { id: "map", label: "地图", icon: "🗺" },
  { id: "role", label: "角色", icon: "👥" },
];

const activeTab = ref<TabId>("bag");
</script>

<template>
  <div class="sp">
    <div class="sp-head" @pointerdown="emit('drag-start', $event)">
      <span class="sp-title">系统 · {{ player?.name || "玩家" }}</span>
      <span class="sp-gold">💰{{ gold }}</span>
      <span class="sp-map">{{ currentMap }}</span>
      <button class="sp-close" @click="emit('close')" title="关闭">×</button>
    </div>

    <div class="sp-tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="sp-tab"
        :class="{ 'sp-tab--on': activeTab === t.id }"
        @click="activeTab = t.id"
      >
        <span class="sp-tab__icon">{{ t.icon }}</span>{{ t.label }}
      </button>
    </div>

    <div class="sp-body">
      <BagPanel
        v-if="activeTab === 'bag'"
        :items="bagItems"
        :skills="skills"
        :current-mp="currentMp"
        :current-max-mp="currentMaxMp"
        @sell="(it: any, n: number) => emit('sell', it, n)"
        @use-item="(it: any) => emit('use-item', it)"
        @sort="(a: number, b: number) => emit('sort', a, b)"
        @sort-auto="() => emit('sort-auto')"
        @use-skill="(s: any, i: number) => emit('use-skill', s, i)"
      />
      <RingPanel
        v-else-if="activeTab === 'ring'"
        :bag-items="bagItems"
        :bag-skills="skills"
        :ring-items="ringItems"
        :ring-skills="ringSkills"
        @move="(name: string, to: string) => emit('ring-move', name, to)"
        @move-skill="(name: string, to: string) => emit('ring-skill-move', name, to)"
      />
      <ShopPanel
        v-else-if="activeTab === 'shop'"
        :goods="goods"
        :gold="gold"
        :source="goodsSource"
        @buy="(g: any, n: number) => emit('buy', g, n)"
        @refresh="() => emit('shop-refresh')"
      />
      <SkillPanel
        v-else-if="activeTab === 'skill'"
        :skills="skills"
        :current-mp="currentMp"
        :current-max-mp="currentMaxMp"
        @use-skill="(s: any, i: number) => emit('use-skill', s, i)"
      />
      <MapPanel
        v-else-if="activeTab === 'map'"
        :nodes="mapNodes"
        :current-map="currentMap"
        :player-x="playerX"
        :player-y="playerY"
        :cards="npcs"
        :player="player"
        @travel="(name: string) => emit('travel', name)"
      />
      <RolePanel
        v-else
        :player="player"
        :cards="npcs"
        :current-map="currentMap"
        @teleport="(c: any) => emit('teleport', c)"
        @follow="(id: string, on: boolean) => emit('follow', id, on)"
      />
    </div>

    <div class="sp-foot">{{ notice || "拖动标题栏可移动面板；背包内可拖拽排序" }}</div>
  </div>
</template>

<style scoped>
.sp { display: flex; flex-direction: column; height: 100%; color: #e8eef5; font-size: 13px; }
.sp-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: rgba(255, 255, 255, 0.06); cursor: move; user-select: none; }
.sp-title { font-weight: 700; }
.sp-gold { margin-left: auto; color: #ffd76a; }
.sp-map { color: #9fd0ff; }
.sp-close { background: transparent; border: 0; color: #cfd8e3; font-size: 18px; line-height: 1; cursor: pointer; }
.sp-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.sp-tab { flex: 1 1 30%; padding: 6px 4px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.04); color: #cfd8e3; cursor: pointer; font-size: 12px; }
.sp-tab--on { background: #2f6fd0; border-color: #5a9bff; color: #fff; }
.sp-tab__icon { margin-right: 3px; }
.sp-body { flex: 1 1 auto; overflow: auto; padding: 8px; }
.sp-foot { padding: 6px 10px; border-top: 1px solid rgba(255, 255, 255, 0.08); color: #93a2b3; font-size: 11px; min-height: 24px; }
</style>
