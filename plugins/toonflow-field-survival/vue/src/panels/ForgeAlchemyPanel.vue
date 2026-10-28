<script setup lang="ts">
/**
 * ★ 锻造 / 炼丹 多标签面板
 * ------------------------------------------------------------
 * 「走进锻造大师，弹出"锻造"按钮，点击进入 多标签页"锻造"面板」
 *   锻造面板：物品售卖 / 物品打造 / 升级物品 / 溶解物品
 *   炼丹面板：物品售卖 / 开始炼丹 / 溶解丹药
 *
 * 售卖页签按物品类型（cat）分「子标签页」展示：
 *   锻造：全部/材料/武器/防具/饰品/图纸/技能/特殊（149 种）
 *   炼丹：全部/药草/辅料/材料/丹药/药方/器具/套装（163 种）
 * 可直接购买（走 sys_shop_buy）。
 */
import { ref, computed, watch } from "vue";

const props = defineProps<{
  /** "forge" | "alchemy" */
  mode: "forge" | "alchemy";
  /** 锻造商品（from=forge_master） */
  forgeGoods: any[];
  /** 炼丹商品（from=alchemy_furnace） */
  alchemyGoods: any[];
  gold: number;
  bagItems: any[];
  playerLevel: number;
  /** 初始选中的标签 id */
  initialTab?: string;
}>();

const emit = defineEmits<{ (e: string, ...args: any[]): void }>();

const TABS = computed<Array<{ id: string; label: string; icon: string }>>(() =>
  props.mode === "forge"
    ? [
        { id: "sell", label: "物品售卖", icon: "🛒" },
        { id: "craft", label: "物品打造", icon: "🔨" },
        { id: "upgrade", label: "升级物品", icon: "⬆" },
        { id: "dissolve", label: "溶解物品", icon: "🧪" },
      ]
    : [
        { id: "sell", label: "物品售卖", icon: "🛒" },
        { id: "alchemy", label: "开始炼丹", icon: "🔥" },
        { id: "dissolve", label: "溶解丹药", icon: "🧪" },
      ],
);

const activeTab = ref<string>(props.initialTab || "sell");
watch(() => props.initialTab, (v) => { if (v) activeTab.value = v; });
watch(() => props.mode, () => { activeTab.value = props.initialTab || "sell"; activeCat.value = "全部"; });

/** 当前售卖页签的商品 */
const sellGoods = computed<any[]>(() =>
  props.mode === "forge" ? props.forgeGoods || [] : props.alchemyGoods || [],
);

/**
 * 售卖子标签页：按物品类型（cat，来自设计文档章节）
 * 锻造：全部/材料/武器/防具/饰品/图纸/技能/特殊
 * 炼丹：全部/药草/辅料/材料/丹药/药方/器具/套装
 */
const CAT_ORDER = {
  forge: ["全部", "材料", "武器", "防具", "饰品", "图纸", "技能", "特殊"],
  alchemy: ["全部", "药草", "辅料", "材料", "丹药", "药方", "器具", "套装"],
};
const activeCat = ref<string>("全部");
watch(() => props.mode, () => { activeCat.value = "全部"; });

/** 售卖商品按 cat 分组（顺序按 CAT_ORDER） */
const grouped = computed(() => {
  const order = CAT_ORDER[props.mode] || [];
  const groups = new Map<string, any[]>();
  for (const g of sellGoods.value) {
    const key = String(g.cat || "其他");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(g);
  }
  return Array.from(groups.entries())
    .sort((a, b) => {
      const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
});

/** 当前选中的子标签页（含「全部」）对应的商品列表 */
const activeCatGoods = computed<any[]>(() => {
  if (activeCat.value === "全部") return sellGoods.value;
  return sellGoods.value.filter((g) => String(g.cat || "其他") === activeCat.value);
});

/** 售卖搜索 */
const search = ref("");
const filtered = computed(() => {
  const q = search.value.trim();
  const base: Array<[string, any[]]> = activeCat.value === "全部"
    ? grouped.value
    : [[activeCat.value, activeCatGoods.value]];
  if (!q) return base;
  return base
    .map(([k, list]) => [k, list.filter((g) => g.name.includes(q) || (g.desc || "").includes(q))] as [string, any[]])
    .filter(([, list]) => list.length > 0);
});
/** 搜索无结果时兜底：全文搜（跨分类） */
const searchFallback = computed<any[]>(() => {
  const q = search.value.trim();
  if (!q || filtered.value.length) return [];
  return sellGoods.value.filter((g) => g.name.includes(q) || (g.desc || "").includes(q));
});

const RARITY_COLOR: Record<string, string> = {
  common: "#9aa4ad", fine: "#4aa3ff", rare: "#a76bff", epic: "#ff9a3c", legend: "#ff4d4d",
};

/** 背包里可升级的装备 */
const equipList = computed(() =>
  (props.bagItems || []).filter((b: any) =>
    ["equipment", "weapon", "armor"].includes(b.kind)
    || /剑|刀|枪|弓|甲|盾|护符|戒|铠|斧|杖|靴|袍|盔/.test(String(b.name || "")),
  ),
);

/** 背包里可溶解的丹药 */
const pillList = computed(() =>
  (props.bagItems || []).filter((b: any) =>
    (b.kind === "consumable" && /丹|丸|散|膏|露|液|药/.test(String(b.name || ""))) || b.heal > 0,
  ),
);

function buy(g: any): void {
  if (props.gold < g.price) return;
  emit("buy", g, 1);
}
</script>

<template>
  <div class="fap">
    <!-- 标签栏 -->
    <div class="fap-tabs">
      <button
        v-for="t in TABS"
        :key="t.id"
        class="fap-tab"
        :class="{ 'fap-tab--on': activeTab === t.id }"
        @click="activeTab = t.id"
      >
        <span class="fap-tab__icon">{{ t.icon }}</span>{{ t.label }}
      </button>
    </div>

    <!-- ① 物品售卖（按物品类型分子标签页） -->
    <div v-if="activeTab === 'sell'" class="fap-body">
      <!-- 分类子标签栏 -->
      <div class="fap-cats">
        <button
          v-for="c in (CAT_ORDER[mode] || [])"
          :key="c"
          class="fap-cat"
          :class="{ 'fap-cat--on': activeCat === c }"
          @click="activeCat = c"
        >{{ c }}</button>
      </div>
      <div class="fap-bar">
        <input v-model="search" class="fap-search" type="text" placeholder="搜索商品…" />
        <span class="fap-count">{{ activeCat === "全部" ? sellGoods.length : activeCatGoods.length }} 件商品</span>
      </div>
      <div v-for="[kind, list] in filtered" :key="kind" class="fap-group">
        <div class="fap-group__title">{{ kind }}（{{ list.length }}）</div>
        <div v-for="g in list" :key="g.id" class="fap-row" :class="{ 'fap-row--no': gold < g.price }">
          <div class="fap-info">
            <div class="fap-name" :style="{ color: RARITY_COLOR[g.rarity] || '#e8eef5' }">{{ g.name }}</div>
            <div class="fap-desc">{{ g.desc }}</div>
          </div>
          <div class="fap-price">{{ g.price }} 金</div>
          <button class="fap-buy" :disabled="gold < g.price" @click="buy(g)">购买</button>
        </div>
      </div>
      <!-- 搜索无结果时跨分类兜底 -->
      <div v-if="searchFallback.length" class="fap-group">
        <div class="fap-group__title">🔍 全店搜索结果（{{ searchFallback.length }}）</div>
        <div v-for="g in searchFallback" :key="'fb-' + g.id" class="fap-row" :class="{ 'fap-row--no': gold < g.price }">
          <div class="fap-info">
            <div class="fap-name" :style="{ color: RARITY_COLOR[g.rarity] || '#e8eef5' }">{{ g.name }}</div>
            <div class="fap-desc">{{ g.desc }}</div>
          </div>
          <div class="fap-price">{{ g.price }} 金</div>
          <button class="fap-buy" :disabled="gold < g.price" @click="buy(g)">购买</button>
        </div>
      </div>
      <div v-if="!sellGoods.length" class="fap-empty">暂无商品。</div>
    </div>

    <!-- ② 物品打造 / 开始炼丹（交给脚本逻辑） -->
    <div v-else-if="activeTab === 'craft' || activeTab === 'alchemy'" class="fap-body fap-body--center">
      <div class="fap-hint">
        <div class="fap-hint__title">输入名称 / 随机 / 选图纸</div>
        <div class="fap-hint__desc">
          对接 AI 大模型生成{{ mode === "forge" ? "物品" : "丹药" }}，每次花费 10 金钱
        </div>
      </div>
      <div class="fap-actions">
        <button class="fap-act" @click="emit('craft-input')">✏️ 输入名称</button>
        <button class="fap-act" @click="emit('craft-random')">🎲 随机</button>
        <button class="fap-act" @click="emit('craft-blueprint')">📜 选图纸</button>
      </div>
    </div>

    <!-- ③ 升级物品 -->
    <div v-else-if="activeTab === 'upgrade'" class="fap-body">
      <div class="fap-bar"><span class="fap-count">选择要升级的装备（Lv+1，附加属性）</span></div>
      <div v-if="!equipList.length" class="fap-empty">背包里没有可升级的装备。</div>
      <div v-for="b in equipList" :key="b.name" class="fap-row">
        <div class="fap-info">
          <div class="fap-name">{{ b.name }}</div>
          <div class="fap-desc">{{ b.desc || `品质 ${b.rarity || "common"}` }}</div>
        </div>
        <button class="fap-buy" @click="emit('upgrade-item', b)">升级</button>
      </div>
    </div>

    <!-- ④ 溶解物品 / 溶解丹药 -->
    <div v-else-if="activeTab === 'dissolve'" class="fap-body">
      <div class="fap-bar">
        <span class="fap-count">
          {{ mode === "forge" ? "选择要溶解的装备，分解为材料" : "选择要溶解的丹药，分解为药材" }}
        </span>
      </div>
      <div v-if="mode === 'forge' && !equipList.length" class="fap-empty">背包里没有可溶解的装备。</div>
      <div v-if="mode === 'alchemy' && !pillList.length" class="fap-empty">背包里没有可溶解的丹药。</div>
      <div
        v-for="b in (mode === 'forge' ? equipList : pillList)"
        :key="b.name"
        class="fap-row"
      >
        <div class="fap-info">
          <div class="fap-name">{{ b.name }}</div>
          <div class="fap-desc">
            {{ b.desc || (b.heal ? `恢复 ${b.heal} 点生命` : `品质 ${b.rarity || "common"}`) }}
            <span v-if="b.count > 1">· ×{{ b.count }}</span>
          </div>
        </div>
        <button class="fap-buy" @click="emit('dissolve-item', b)">溶解</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fap { display: flex; flex-direction: column; gap: 8px; height: 100%; }
.fap-tabs { display: flex; gap: 4px; padding-bottom: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
.fap-tab {
  flex: 1 1 0; padding: 6px 4px; border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(255, 255, 255, 0.04);
  color: #cfd8e3; cursor: pointer; font-size: 12px; font-family: inherit;
}
.fap-tab--on { background: #2f6fd0; border-color: #5a9bff; color: #fff; font-weight: 600; }
.fap-tab__icon { margin-right: 3px; }
.fap-body { flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.fap-body--center { align-items: center; justify-content: center; gap: 14px; }
.fap-bar { display: flex; align-items: center; gap: 8px; }
.fap-search {
  flex: 1 1 auto; padding: 5px 8px; border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(0, 0, 0, 0.3);
  color: #e8eef5; font-size: 11px; font-family: inherit; outline: none;
}
.fap-search:focus { border-color: #5a9bff; }
/* 分类子标签栏 */
.fap-cats { display: flex; flex-wrap: wrap; gap: 3px; }
.fap-cat {
  padding: 3px 9px; border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(255, 255, 255, 0.04);
  color: #aeb9c6; font-size: 11px; cursor: pointer; font-family: inherit; line-height: 1.4;
}
.fap-cat:hover { border-color: #5a9bff; color: #e8eef5; }
.fap-cat--on { background: #2f6fd0; border-color: #5a9bff; color: #fff; font-weight: 600; }
.fap-count { color: #93a2b3; font-size: 11px; }
.fap-group { margin-top: 4px; }
.fap-group__title {
  position: sticky; top: 0; z-index: 1;
  padding: 3px 0; font-size: 11px; color: #ffd76a;
  background: linear-gradient(180deg, rgba(20, 24, 32, 0.98), rgba(20, 24, 32, 0.85));
}
.fap-row {
  display: flex; align-items: center; gap: 8px; padding: 5px 6px;
  border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px;
  background: rgba(0, 0, 0, 0.18);
}
.fap-row--no { opacity: 0.55; }
.fap-info { flex: 1 1 auto; min-width: 0; }
.fap-name { font-size: 12px; }
.fap-desc {
  font-size: 10px; color: #93a2b3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fap-price { color: #ffd76a; font-size: 12px; white-space: nowrap; }
.fap-buy {
  padding: 4px 10px; border-radius: 5px; border: 1px solid #5a9bff;
  background: #2f6fd0; color: #fff; font-size: 11px; cursor: pointer; font-family: inherit;
  white-space: nowrap;
}
.fap-buy:disabled { border-color: #4a5563; background: #3a434f; color: #8b98a6; cursor: not-allowed; }
.fap-empty { color: #93a2b3; font-size: 11px; padding: 10px 0; text-align: center; }
.fap-hint { text-align: center; }
.fap-hint__title { font-size: 14px; color: #ffe79e; margin-bottom: 4px; }
.fap-hint__desc { font-size: 11px; color: #93a2b3; }
.fap-actions { display: flex; gap: 8px; }
.fap-act {
  padding: 8px 16px; border-radius: 6px; border: 1px solid #8a6a20;
  background: #d4a13e; color: #1a1410; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.fap-act:hover { background: #e8b95e; }
</style>