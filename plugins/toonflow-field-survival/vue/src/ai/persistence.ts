/**
 * ai/persistence.ts — 行为链 V2 持久化（2026-11-15，ai托管V2.md）
 * ============================================================
 * 计划 + 历史落 t_plugin_session_data（key: ai_behavior_chains，**会话级**——
 * 行为链是会话内状态，不跨会话）。刷新页面后 loadBehaviorChains 灌回 aiStates，
 * 用户重新勾「AI托管」即从断点继续（entry 的 _aiManaged 标志本身不持久化，
 * 托管开关仍由面板勾选决定 —— 存档只保「想好了什么」，不保「是否在执行」）。
 *
 * aiStates 是前端内存（刷新即失）—— 这里是它的唯一持久化通道。
 * 落库时机：计划步完成 / 面板增删改 → scheduleBehaviorChainsSave（1200ms 防抖）。
 */
import { getAllAIStates } from "./brain";
import { getPlan, getHistory, getPlanVersion } from "./plan";
import type { PlanStep, HistoryEntry, PlanSource } from "./types";

export const BEHAVIOR_CHAIN_KEY = "ai_behavior_chains";
const CHAIN_VERSION = 1;

/** pluginData 桥（由 App.vue 注入，与 aiConfig 的 AIConfigStore 同构） */
export interface BehaviorChainStore {
  get(key: string, scope?: string): Promise<any>;
  set(key: string, value: unknown, scope?: string): Promise<void>;
}

let store: BehaviorChainStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedVersion = -1;

/** 由 App.vue 启动时注入（toonflowJsApi.pluginData 适配） */
export function setBehaviorChainStore(s: BehaviorChainStore | null): void {
  store = s;
}

interface ChainPayload {
  name?: string;
  planSource?: PlanSource;
  plan?: PlanStep[];
  history?: HistoryEntry[];
  personality?: string;
}

/** 收集内存中有数据的行为链（plan 或 history 非空才落库，防膨胀） */
function collectBehaviorChains(): Record<string, ChainPayload> {
  const out: Record<string, ChainPayload> = {};
  try {
    for (const [eid, st] of getAllAIStates().entries()) {
      const plan = st.plan || [];
      const history = st.history || [];
      if (!plan.length && !history.length) continue;
      out[eid] = {
        name: st.characterName,
        personality: st.personality,
        planSource: st.planSource,
        plan: plan.map((p) => ({ ...p })),
        history: history.slice(0, 30).map((h) => ({ ...h })),
      };
    }
  } catch (e) {
    console.warn("[behavior-chain] 收集行为链失败:", e);
  }
  return out;
}

/** 防抖落库（1200ms）；版本号没变就跳过（空转不写库） */
export function scheduleBehaviorChainsSave(): void {
  if (!store) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const v = getPlanVersion();
    if (v === lastSavedVersion) return;
    lastSavedVersion = v;
    void store!.set(BEHAVIOR_CHAIN_KEY, { version: CHAIN_VERSION, chains: collectBehaviorChains() })
      .catch((e) => console.warn("[behavior-chain] 落库失败:", e));
  }, 1200);
}

/**
 * 启动恢复：把存档灌回 aiStates（骨架条目 enabled=false，
 * 用户重新勾「AI托管」后 getOrCreateAIState 拿到同一条目 → 计划/历史续上）
 */
export async function loadBehaviorChains(): Promise<void> {
  if (!store) return;
  try {
    const raw = await store.get(BEHAVIOR_CHAIN_KEY);
    const chains = raw?.chains;
    if (!chains || typeof chains !== "object") return;
    const states = getAllAIStates();
    let restored = 0;
    for (const [eid, c] of Object.entries(chains as Record<string, ChainPayload>)) {
      if (!c || typeof c !== "object") continue;
      const existing = states.get(eid);
      if (existing) {
        if (Array.isArray(c.plan) && !existing.plan?.length) existing.plan = c.plan;
        if (Array.isArray(c.history) && !existing.history?.length) existing.history = c.history;
        if (c.planSource && !existing.planSource) existing.planSource = c.planSource;
      } else {
        states.set(eid, {
          enabled: false,
          mode: "idle",
          lastBrainTick: 0,
          brainInterval: 5000,
          goal: "待命",
          memory: [],
          currentAction: null,
          actionQueue: [],
          emergency: {
            lowHp: false, criticalHp: false, lowMp: false,
            inventoryFull: false, targetDied: false, surrounded: false, newEnemy: false,
          },
          personality: c.personality || "勇敢冲锋型",
          characterName: c.name || eid,
          characterLevel: 1,
          cooldownUntil: 0,
          mapName: "",
          plan: Array.isArray(c.plan) ? c.plan : [],
          history: Array.isArray(c.history) ? c.history : [],
          planSource: c.planSource || "ai",
          awaitingPlan: false,
        });
      }
      restored++;
    }
    if (restored) console.info(`[behavior-chain] 已恢复 ${restored} 条行为链存档`);
  } catch (e) {
    console.warn("[behavior-chain] 读取存档失败:", e);
  }
}

/** 读取恢复出的计划步数（面板/调试用） */
export function getRestoredChainCount(): number {
  let n = 0;
  for (const [, st] of getAllAIStates().entries()) {
    if ((st.plan?.length || 0) || (st.history?.length || 0)) n++;
  }
  return n;
}

/** getPlan/getHistory re-export（面板统一从这里取，避免多入口 import） */
export { getPlan, getHistory };

/**
 * ★ 诊断探针：关键节点 dump 到 t_plugin_session_data（key: ai_chain_diag）。
 * 5175 iframe 跨源抓不到 console —— 与 brain_diag（短信链路）同款取证通道。
 */
export function debugChainDump(stage: string, extra?: Record<string, unknown>): void {
  if (!store) return;
  const chains = collectBehaviorChains();
  const ids = Object.keys(chains);
  void store.set("ai_chain_diag", {
    stage,
    at: Date.now(),
    planVersion: getPlanVersion(),
    chainIds: ids.slice(0, 10),
    first: ids.length ? { id: ids[0], enabled: !!getAllAIStates().get(ids[0])?.enabled, planLen: chains[ids[0]].plan?.length || 0 } : null,
    ...extra,
  }).catch(() => {});
}
