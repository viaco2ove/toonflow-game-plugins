/**
 * ai/chatCommand.ts — 聊天框 #ai 指令处理
 * ==========================================
 * 在用户与角色对话时，输入 `#ai <自然语言指令>` 即可让 AI 立刻做一次决策并执行。
 * 不要求勾选 AI 托管（临时触发），但角色必须在场上（state.entities）。
 *
 * 示例：
 *   #ai 帮我去收集木材 → 移动到木材堆 zone
 *   #ai 帮我去收集药草 → 移动到农田 zone
 *   #ai 在周围瞎逛 → 随机游走
 *   #ai 攻击最近的怪 → 攻击最近敌人
 *   #ai 治疗自己 → useItem
 *
 * 决策路径：
 *   1) 关键词匹配（快速通道）→ 直接出 action
 *   2) LLM 调用（如果已 register）→ 自然语言解析
 *   3) 兜底：执行兜底决策（基于感知）
 *
 * 角色发言：返回一段简短中文告诉用户做了什么（out.say）。
 */

import type { Entity, GameState } from "../types";
import type { AIAction } from "./types";
import { getEventZones } from "../eventEngine";
import { readMapKnowledge } from "./mapKnowledge";
import type { GatherKind } from "./mapKnowledge";
import { getOrCreateAIState, setAIEnabled } from "./brain";
import { executeAction, isActionComplete } from "./spine";
import { updatePerception } from "./sensor";
import { sendTick } from "../bridge";

export interface AIChatOutcome {
  /** 角色对玩家说的话（中文短句） */
  say: string;
  /** 实际执行的动作（调试用） */
  action?: AIAction;
  /** 路径：quick / llm / fallback */
  source: "quick" | "llm" | "fallback";
  /** 错误信息（如有） */
  error?: string;
}

/** 关键词 → 动作生成器 */
const KEYWORD_RULES: Array<{ pattern: RegExp; build: (cmd: string, ent: Entity, state: GameState) => { action: AIAction; say: string } | null }> = [
  {
    // 收集木材 / 砍柴 / 伐木 —— ★ 改由地图集声明驱动（events.json 的 trigger.ai.gather）
    pattern: /(木材|砍柴|伐木|柴火|木柴)/i,
    build: (_cmd, ent, _state) => {
      const z = findGatherZone(ent, "wood");
      if (!z) return null;
      return {
        action: { type: "gather", target: { x: z.x, y: z.y, name: z.name }, zoneName: z.name, priority: 70, context: "去收集木材" },
        say: `好的，我去${z.name}看看。`,
      };
    },
  },
  {
    // 收集药草 / 采药 / 夜采
    pattern: /(药草|采药|药材|草药|农田|夜采|药圃)/i,
    build: (_cmd, ent, _state) => {
      const z = findGatherZone(ent, "herb");
      if (!z) return null;
      return {
        action: { type: "gather", target: { x: z.x, y: z.y, name: z.name }, zoneName: z.name, priority: 70, context: "去采集药草" },
        say: `好的，我去${z.name}采药。`,
      };
    },
  },
  {
    // 钓鱼 / 捕鱼
    pattern: /(钓鱼|捕鱼|鱼|喷水|水池)/i,
    build: (_cmd, ent, _state) => {
      const z = findGatherZone(ent, "fish");
      if (!z) return null;
      return {
        action: { type: "gather", target: { x: z.x, y: z.y, name: z.name }, zoneName: z.name, priority: 70, context: "去钓鱼" },
        say: `好的，我去${z.name}钓鱼。`,
      };
    },
  },
  {
    // 采矿 / 挖矿
    pattern: /(采矿|挖矿|矿石|矿石堆)/i,
    build: (_cmd, ent, _state) => {
      const z = findGatherZone(ent, "ore");
      if (!z) return null;
      return {
        action: { type: "gather", target: { x: z.x, y: z.y, name: z.name }, zoneName: z.name, priority: 70, context: "去采矿" },
        say: `好的，我去${z.name}采矿。`,
      };
    },
  },
  {
    // 攻击 / 战斗 / 打怪
    pattern: /(攻击|打|战斗|杀|斗|清怪|清场)/i,
    build: (_cmd, ent, state) => {
      const enemies = (state.entities || []).filter((e) => e.side === "enemy" && e.alive !== false);
      if (enemies.length === 0) {
        return {
          action: { type: "wait", duration: 1000, priority: 30, context: "周围没有敌人" },
          say: "周围没有发现敌人。",
        };
      }
      // 找最近的
      let nearest = enemies[0];
      let minD = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.x - ent.x, e.y - ent.y);
        if (d < minD) { minD = d; nearest = e; }
      }
      return {
        action: { type: "attack", target: { id: nearest.id, x: nearest.x, y: nearest.y, name: nearest.name }, priority: 80, context: `攻击 ${nearest.name}` },
        say: `好的，我去攻击 ${nearest.name}。`,
      };
    },
  },
  {
    // 跟随 / 跟玩家
    pattern: /(跟随|跟着|跟|我|一起)/i,
    build: () => {
      return {
        action: { type: "follow", priority: 40, context: "跟随玩家" },
        say: "好的，我跟着你。",
      };
    },
  },
  {
    // 治疗 / 回血 / 用药
    pattern: /(治疗|回血|吃药|用药|补血|救命)/i,
    build: (_cmd, ent, state) => {
      const items = (state.items || []) as any[];
      const heal = items.find((it: any) => /药|血|heal/i.test(String(it.name || "")));
      if (!heal) return null;
      return {
        action: { type: "useItem", itemName: heal.name, priority: 90, context: `用 ${heal.name} 治疗` },
        say: `好的，我用 ${heal.name} 治疗。`,
      };
    },
  },
  {
    // 闲逛 / 漫游 / 巡逻
    pattern: /(闲逛|漫游|巡逻|逛逛|转转|随便|瞎逛)/i,
    build: (_cmd, ent) => {
      // 随机方向走 10 米
      const ang = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 4;
      return {
        action: { type: "move", target: { x: ent.x + Math.cos(ang) * dist, y: ent.y + Math.sin(ang) * dist, name: "随机" }, priority: 20, context: "闲逛" },
        say: "好，我四处转转。",
      };
    },
  },
  {
    // ★ 数据驱动：护送 / 找人 —— 按名字关键词在场上找最近的非敌对实体
    //   （赦夜人：林家商队 / 林家护卫 / 陆文昭；别的地图集换成自己的 NPC 名即可，不用改插件）
    pattern: /(商队|护送|护卫|陆文昭|执事|暮光)/i,
    build: (cmd, ent, state) => {
      const kw = /(商队|护送)/i.test(cmd) ? /商队|林家/ : /(护卫)/i.test(cmd) ? /护卫/ : /陆文昭|执事|暮光/;
      const cands = (state.entities || []).filter(
        (e) => e.side !== "enemy" && e.alive !== false && e.id !== ent.id && kw.test(String(e.name || "")),
      );
      if (!cands.length) return null;
      let near = cands[0];
      let minD = Infinity;
      for (const e of cands) {
        const d = Math.hypot(e.x - ent.x, e.y - ent.y);
        if (d < minD) { minD = d; near = e; }
      }
      return {
        action: { type: "interact", target: { id: near.id, x: near.x, y: near.y, name: near.name }, priority: 60, context: `去找 ${near.name}` },
        say: `好的，我去找${near.name}。`,
      };
    },
  },
  {
    // ★ 数据驱动：去某个区域（zone 名来自地图 eventZones，不写死任何故事专属名）
    pattern: /(?:去|到|前往)([^\s，。！？]{2,8})/,
    build: (cmd, ent, _state) => {
      const m = cmd.match(/(?:去|到|前往)([^\s，。！？]{2,8})/);
      if (!m) return null;
      const want = m[1];
      const zones = getEventZones();
      const hit = zones.find((z) => z.name === want) || zones.find((z) => z.name.includes(want) || want.includes(z.name));
      if (!hit) return null;
      return {
        action: { type: "move", target: { x: hit.x, y: hit.y, name: hit.name }, priority: 50, context: `前往 ${hit.name}` },
        say: `好的，我去${hit.name}。`,
      };
    },
  },
  {
    // 逃跑 / 后退
    pattern: /(逃跑|撤退|跑|退|走开|离开|离去)/i,
    build: () => {
      return {
        action: { type: "flee", priority: 85, context: "撤退" },
        say: "好，我先撤。",
      };
    },
  },
  {
    // 等待 / 原地
    pattern: /(等等|等一下|别动|停|待命|休息|不动)/i,
    build: () => {
      return {
        action: { type: "wait", duration: 3000, priority: 20, context: "待命" },
        say: "好，我原地待命。",
      };
    },
  },
];

/**
 * ★ 按采集类型找本图最近的采集点 —— 数据来自地图集声明（mapKnowledge），
 *   插件不再写死「农田 / 喷水池」这类某个故事才有的 zone 名。
 *
 *   mapKnowledge 的判定优先级（见 ai/mapKnowledge.ts）：
 *     ① events.json 的 trigger.ai.gather 显式声明
 *     ② 事件 id 推断  ③ zone 名关键词推断
 *   所以赦夜人的「夜采药圃」/「林中药丛」（herb）与通天传授的「农田」（herb）
 *   都能被同一条规则命中，无需改插件代码。
 */
function findGatherZone(ent: Entity, kind: GatherKind): { name: string; x: number; y: number } | null {
  const zones = readMapKnowledge().gatherZones.filter((z) => z.kind === kind);
  if (!zones.length) return null;
  let best = zones[0];
  let minD = Infinity;
  for (const z of zones) {
    const d = Math.hypot(z.x - ent.x, z.y - ent.y);
    if (d < minD) { minD = d; best = z; }
  }
  return { name: best.name, x: best.x, y: best.y };
}

/** ★ 主编排：处理用户的 #ai 指令 */
export async function issueAIChatCommand(
  entity: Entity,
  userText: string,
  state: GameState,
): Promise<AIChatOutcome> {
  // 1) 通过 sendTick 通知 entry.js 标记 _aiManaged（不强行加 partyIds，让 entry.js 自由驱动）
  ensureAIManaged(entity);

  // 2) 临时启用 AI（不持久，仅这次决策）
  const aiState = getOrCreateAIState(entity);
  const wasEnabled = aiState.enabled;
  if (!wasEnabled) {
    setAIEnabled(entity.id, true, "指挥型");
  }
  aiState.lastBrainTick = 0;
  aiState.cooldownUntil = 0;

  // 3) 快速通道：关键词匹配
  const cmd = userText.replace(/^#\s*ai\s*/i, "").trim();
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(cmd)) {
      const out = rule.build(cmd, entity, state);
      if (out) {
        // 执行
        const aiState2 = getOrCreateAIState(entity);
        aiState2.currentAction = out.action;
        const result = executeAction(entity, out.action, state);
        return {
          say: result.success ? out.say : `（执行失败：${result.message}）`,
          action: out.action,
          source: "quick",
        };
      }
    }
  }

  // 4) LLM 通道：让大脑解析自然语言
  try {
    const perception = updatePerception(entity, state);
    const decision = await callBrainForCommand(entity, state, cmd, perception);
    if (decision) {
      const result = executeAction(entity, decision.action, state);
      return {
        say: result.success ? `好的。${decision.action.context || "我去办。"}` : `（执行失败：${result.message}）`,
        action: decision.action,
        source: "llm",
      };
    }
  } catch (e: any) {
    // LLM 失败 → 兜底
  }

  // 5) 兜底：基于感知的标准决策
  const perception = updatePerception(entity, state);
  const fallback = buildFallback(perception, entity);
  const result = executeAction(entity, fallback.action, state);
  return {
    say: result.success ? fallback.say : `（兜底失败：${result.message}）`,
    action: fallback.action,
    source: "fallback",
  };
}

/** 通过 LLM 解析自然语言命令 */
async function callBrainForCommand(
  entity: Entity,
  state: GameState,
  cmd: string,
  perception: any,
): Promise<{ action: AIAction; reasoning: string } | null> {
  // 复用 brain.ts 的 LLM 调用器
  const { callBrain } = await import("./brain");
  const decision = await callBrain(entity, state);
  if (!decision) return null;
  return { action: decision.action, reasoning: decision.reasoning };
}

/** 兜底决策 */
function buildFallback(perception: any, ent: Entity): { action: AIAction; say: string } {
  if (perception.nearby?.enemies?.length > 0) {
    const e = perception.nearby.enemies[0];
    return {
      action: { type: "attack", target: { id: e.id, x: e.position.x, y: e.position.y, name: e.name }, priority: 60, context: `攻击 ${e.name}` },
      say: `没明白，但先打 ${e.name} 吧。`,
    };
  }
  if (perception.resources?.length > 0) {
    const r = perception.resources[0];
    return {
      action: { type: "gather", target: { x: r.position.x, y: r.position.y, name: r.zoneName }, zoneName: r.zoneName, priority: 50, context: `前往 ${r.zoneName}` },
      say: `没明白，先去 ${r.zoneName} 看看。`,
    };
  }
  return {
    action: { type: "wait", duration: 2000, priority: 20, context: "待命" },
    say: "没明白你想做什么，我先待命。",
  };
}

/** ★ 通知 entry.js 把 entity 标记为 _aiManaged（不强行加 partyIds）
 *  entry.js 的 ally 循环现在会处理 _aiManaged 但不在 partyIds 的 ally：
 *  - 攻击感知范围内最近的敌人（13 米内）
 *  - 不会自动 anchor 到玩家身边
 *  - 只在收到 _aiMoveTo / _aiAttackTarget 时才移动
 */
function ensureAIManaged(entity: Entity): void {
  // 通过 ai_command 走 entry.js：entity 端设置 _aiManaged = true
  sendTick("ai_command", { roleId: entity.id, action: "_mark_managed" });
}