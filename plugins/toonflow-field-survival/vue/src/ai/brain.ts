/**
 * ai/brain.ts — AI 大脑层（LLM 决策）
 * ====================================
 * 负责：
 * 1. 收集感知数据
 * 2. 构建 Prompt
 * 3. 调用 LLM（复用 eventEngine 的 llm 接口）
 * 4. 解析决策结果
 * 5. 应用动作
 *
 * ★ 复用 eventEngine 的 llm.speak() 通道（App.vue 的 chatResultWaiters 机制）
 */

import type {
  AIAction,
  AIGameEvent,
  AIPerception,
  AIState,
  LLMDecision,
} from "./types";
import { IDLE_INTERVAL_WITH_RESOURCES } from "./types";
import { checkEmergency, updatePerception } from "./sensor";
import { readMapKnowledge } from "./mapKnowledge";
import { readMapIntervalOverride } from "./mapInterval";
import { getRuntimeBrainConfig, getRuntimeIntervals } from "./aiConfig";
import { buildSmsContext } from "../sms/store";
import type { Entity, GameState } from "../types";

/** AI 大脑状态 */
const aiStates: Map<string, AIState> = new Map();
const pendingEvents: Map<string, AIGameEvent[]> = new Map();
let lastTick = 0;

/** 获取或创建 AI 状态 */
export function getOrCreateAIState(entity: Entity): AIState {
  let s = aiStates.get(entity.id);
  if (!s) {
    s = {
      enabled: false,
      mode: "idle",
      lastBrainTick: 0,
      brainInterval: 5000,
      goal: "待命",
      memory: [],
      currentAction: null,
      actionQueue: [],
      emergency: {
        lowHp: false,
        criticalHp: false,
        lowMp: false,
        inventoryFull: false,
        targetDied: false,
        surrounded: false,
        newEnemy: false,
      },
      personality: "普通",
      characterName: entity.name || "",
      characterLevel: entity.level || 1,
      cooldownUntil: 0,
      mapName: (entity as any).mapName || "",
    };
    aiStates.set(entity.id, s);
  }
  return s;
}

/** 设置 AI 启用 */
export function setAIEnabled(entityId: string, enabled: boolean, personality?: string): void {
  const s = aiStates.get(entityId);
  if (!s) return;
  s.enabled = enabled;
  if (personality) s.personality = personality;
  if (enabled) {
    s.lastBrainTick = 0; // 立即触发一次决策
    s.mode = "idle";
  } else {
    s.mode = "idle";
    s.currentAction = null;
    s.actionQueue = [];
  }
}

/** 检查是否启用 AI */
export function isAIEnabled(entityId: string): boolean {
  return aiStates.get(entityId)?.enabled === true;
}

/** 推入 AI 事件 */
export function pushAIEvent(entityId: string, event: AIGameEvent): void {
  const list = pendingEvents.get(entityId) || [];
  list.push(event);
  pendingEvents.set(entityId, list);
}

/** 计算自适应间隔
 *  ★ v6 重写：判据从「AI 自己身边有敌人」改为「玩家战斗状态」+「地图集覆盖」。
 *  ★ v7：三档基线与 min/max 全部读**运行时配置**（系统面板 → AI 可调，落库 t_plugin_session_data）。
 *  详见 md/curr_design/toonflow-field-survival/ai/ai托管/ai托管.agent.触发频率.md
 */
function calculateInterval(state: AIState, perception: AIPerception): number {
  // ★ 每次都从 aiConfig 取最新值（面板改了立即生效，不需要重启）
  const cfg = getRuntimeBrainConfig();
  if (!cfg.adaptiveEnabled) return cfg.minInterval;

  // ① 地图集覆盖优先（最高优先级，见 mapKnowledge.readMapIntervalOverride）
  const override = readMapIntervalOverride(state.mapName);
  if (override != null) return override;

  // ② 玩家战斗等级（主判据）→ 取对应档位的基线
  const level = perception.world?.playerCombatLevel || "none";
  const bands = getRuntimeIntervals();
  let base: number;
  switch (level) {
    case "engaged":
      base = bands.engaged;
      break;
    case "skirmish":
      base = bands.skirmish;
      break;
    default:
      base = bands.idle;
      break;
  }

  // ③ AI 自身的次级修正：AI 自己身边有危险 → 缩短一档
  //   （玩家在战斗但 AI 落单时，AI 也要快点反应）
  if (perception.nearby.enemies.length > 0) {
    base = Math.max(cfg.minInterval, Math.round(base * 0.7));
  }

  // ④ 资源点在附近 → 略快（只在完全非战斗时生效，避免拉长战斗节奏）
  if (perception.resources.length > 0 && level === "none") {
    base = Math.min(base, IDLE_INTERVAL_WITH_RESOURCES);
  }

  return Math.min(Math.max(base, cfg.minInterval), cfg.maxInterval);
}

/** 检查事件是否应该立即触发 */
function shouldTriggerFromEvent(event: AIGameEvent, currentAction: AIAction | null): boolean {
  if (event.priority === "P0") return true;
  if (event.priority === "P1") {
    // 移动和等待时可打断
    if (!currentAction) return true;
    return ["move", "wait", "follow"].includes(currentAction.type);
  }
  return false;
}

/** 记录记忆 */
function addMemory(state: AIState, type: AIMemory["type"], description: string, data?: Record<string, unknown>): void {
  state.memory.push({
    timestamp: Date.now(),
    type,
    description,
    data,
  });
  // 只保留最近 10 条
  if (state.memory.length > 10) {
    state.memory = state.memory.slice(-10);
  }
}

/** 构建 System Prompt（角色大脑设定） */
function buildSystemPrompt(state: AIState, perception: AIPerception): string {
  // ★ 地图集知识（{{mapSpecificHint}} 落地）：从 eventEngine 派生当前图的可采集地点/可交互对象
  const mapHint = readMapKnowledge().summary;
  return `# 角色设定

你是角色【${state.characterName}】的AI控制大脑。

## 基础信息
- 名字：${state.characterName}
- 等级：Lv.${state.characterLevel}
- 性格特点：${state.personality}
- 当前所在地图：${perception.world.currentMap || "未知"}

## 本图知识（地图集提供）
${mapHint || "- 本地图暂无特殊地点知识"}

## 核心能力
- HP: ${perception.self.hp}/${perception.self.maxHp} (${perception.self.hpPercent}%)
- MP: ${perception.self.mp}/${perception.self.maxMp} (${perception.self.mpPercent}%)
- 攻击力: ${perception.self.atk}
- 防御力: ${perception.self.def}

## 背包物品（队伍背包 + 私藏）
${perception.self.inventory.length ? perception.self.inventory.map((i) => `- ${i.name} ×${i.count}`).join("\n") : "- 空"}

## 技能列表
${perception.self.skills.length ? perception.self.skills.map((s) => `- ${s.name} (消耗${s.cost}MP, 冷却剩余${s.cdLeft}秒)`).join("\n") : "- 无"}

## 当前位置
- X: ${perception.self.position.x.toFixed(1)}, Y: ${perception.self.position.y.toFixed(1)}
- 附近可采集资源：
${perception.resources.length ? perception.resources.map((r) => `  - ${r.zoneName} (${r.type}, ${r.distance}米)`).join("\n") : "  - 暂无"}
`;
}

/** 战斗等级 → 中文描述（给 LLM 看的） */
function combatLevelText(level?: string): string {
  if (level === "engaged") return "交战中（玩家刚参与战斗）";
  if (level === "skirmish") return "遭遇战（附近仍有敌人，未脱离接触）";
  return "无威胁";
}

/** 构建 User Prompt（当前状态 + 决策请求） */
function buildUserPrompt(state: AIState, perception: AIPerception, entityId: string): string {
  const recentMemory = state.memory.slice(-3).map((m) => {
    const ago = Math.round((Date.now() - m.timestamp) / 1000);
    const agoText = ago < 60 ? `${ago}秒前` : `${Math.round(ago / 60)}分钟前`;
    return `- ${m.description} (${agoText})`;
  }).join("\n");

  // ★ 通信(短信)：注入短信往来（单聊 + 群聊都要注入）
  //   否则玩家在单聊里发的消息 AI 根本看不到 —— 聊天会退化成单向广播。
  //   ★ 标★ 的行表示"玩家的消息还没被回复"，AI 必须回。
  let smsBlock = "";
  try {
    smsBlock = buildSmsContext(entityId);
  } catch (e) {
    console.warn("[ai-brain] 构建短信上下文失败:", e);
  }
  const smsSection = smsBlock ? `\n${smsBlock}\n` : "";

  // ★ 角色身份块：sys_brain 通道的 systemPrompt 是「输出格式契约」（插件常量），
  //   不含「你是谁」—— 身份必须随 userPrompt 传入，否则 LLM 会自造名字
  //   （实测自称 "Agnes"）。
  const identityBlock = `## 你的身份
- 名字：${state.characterName || entityId}（所有回复/短信都以这个角色的身份，禁止自称其他名字）
- 等级：Lv.${state.characterLevel}
- 性格：${state.personality || "普通"}
`;

  return `${identityBlock}
## 当前情况

### 环境感知
- 周围敌人：${perception.nearby.enemies.length}只${perception.nearby.enemies.length ? " (" + perception.nearby.enemies.slice(0, 3).map((e) => `${e.name} HP:${e.hp}/${e.maxHp} 距${e.distance}米`).join(", ") + ")" : ""}
- 周围友方：${perception.nearby.allies.length}个
- 周围NPC：${perception.nearby.npcs.length}个

### 战斗状态
${perception.nearby.enemies.length ? `- 周围有 ${perception.nearby.enemies.length} 个敌人
- 最近敌人: ${perception.nearby.enemies[0]?.name} (HP: ${perception.nearby.enemies[0]?.hp}, 距离: ${perception.nearby.enemies[0]?.distance}米)` : "- 当前未在战斗"}

### 玩家战况（宿主判定，可能超出你的感知范围）
- 战况等级: ${combatLevelText(perception.world?.playerCombatLevel)}
- 距上次交战: ${perception.world?.secondsSinceCombat ?? "未知"} 秒
${(perception.world?.playerCombatLevel || "none") !== "none" ? "- ★ 玩家正在战斗中，你的决策应偏向支援/自保，不要去做无关的事" : "- 玩家当前未在战斗"}

### 资源状态
- 背包物品数（队伍+私藏）: ${perception.self.inventory.length}
- 可达资源: ${perception.resources.length}个${perception.resources[0] ? ` (最近: ${perception.resources[0].zoneName}, ${perception.resources[0].distance}米)` : ""}

### 角色记忆（最近3件事）
${recentMemory || "- 暂无"}
${smsSection}
### 当前目标
${state.goal}

## 输出格式

请以JSON格式输出决策：
\`\`\`json
{
  "reasoning": "简要说明决策理由（20字内）",
  "goal": "描述当前目标",
  "action": {
    "type": "动作类型",
    "target": {"id": "目标ID", "x": 0, "y": 0, "name": "目标名"},
    "context": "执行此动作的原因"
  },
  "message": {
    "text": "要给玩家发的短信（可选，不需要发就省略）",
    "to": "player 或 group:<群ID>"
  }
}
\`\`\`
`;
}

/** 解析 LLM 响应 */
function parseLLMResponse(raw: string): LLMDecision | null {
  if (!raw) return null;

  // 尝试提取 JSON 块
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const obj = JSON.parse(jsonMatch[0]);
    if (!obj.action || !obj.action.type) return null;

    return {
      reasoning: String(obj.reasoning || ""),
      goal: String(obj.goal || ""),
      action: {
        type: obj.action.type,
        target: obj.action.target || undefined,
        skillName: obj.action.skillName,
        itemName: obj.action.itemName,
        zoneName: obj.action.zoneName,
        priority: obj.action.priority || 50,
        context: String(obj.action.context || obj.reasoning || ""),
      },
      // ★ 通信(短信)：解析 AI 的发短信意图（可选字段）
      message: parseSmsIntent(obj.message),
    };
  } catch (e) {
    console.warn("[ai-brain] LLM响应解析失败:", e);
    return null;
  }
}

/**
 * ★ 解析 LLM 返回的短信意图（可选字段）
 * 校验：text 非空、to 合法（"player" 或 "group:<id>"）。
 * 非法 → 返回 undefined（不发短信），宁缺毋滥。
 */
function parseSmsIntent(raw: any): { text: string; to: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const text = String(raw.text || "").trim();
  if (!text) return undefined;
  const to = String(raw.to || "player").trim() || "player";
  if (to !== "player" && !to.startsWith("group:")) {
    console.warn("[ai-brain] 短信收件目标非法，丢弃:", to);
    return undefined;
  }
  return { text, to };
}

/** 兜底决策（LLM 失败时） */
function fallbackDecision(perception: AIPerception): LLMDecision {
  // 兜底策略：战斗优先
  if (perception.nearby.enemies.length > 0) {
    const enemy = perception.nearby.enemies[0];
    return {
      reasoning: "兜底：攻击最近敌人",
      goal: "战斗",
      action: {
        type: "attack",
        target: { id: enemy.id, x: enemy.position.x, y: enemy.position.y, name: enemy.name },
        priority: 60,
        context: "默认攻击最近敌人",
      },
    };
  }
  // 兜底策略：前往最近资源点
  if (perception.resources.length > 0) {
    const res = perception.resources[0];
    return {
      reasoning: "兜底：前往最近资源点",
      goal: "采集",
      action: {
        type: "gather",
        target: { x: res.position.x, y: res.position.y, name: res.zoneName },
        zoneName: res.zoneName,
        priority: 50,
        context: "默认前往最近资源",
      },
    };
  }
  // 兜底：原地等待
  return {
    reasoning: "兜底：原地等待",
    goal: "待命",
    action: {
      type: "wait",
      duration: 3000,
      priority: 30,
      context: "无可执行动作，等待",
    },
  };
}

/** ★ v6：决策触发评估结果 */
export interface BrainTrigger {
  /** 是否应该决策 */
  should: boolean;
  /** 触发优先级（P0 最高） */
  priority: "P0" | "P1" | "P2";
  /** 触发原因（写进记忆与日志） */
  reason: string;
  /** 紧急层已接管（此时不烧 LLM，直接执行） */
  emergency?: AIAction | null;
}

/**
 * ★ v6 阶段一：评估「这个角色现在该不该思考」（每 tick 跑，纯本地，不烧 token）
 *
 * 拆成两阶段的原因：调度器要先把所有「想决策」的角色收集起来排队，
 * 再由 pump 逐个发起 LLM。如果在一个函数里既判断又发起，
 * 多个角色同拍就会并发请求 → chatResult 单槽位互相覆盖 → 丢决策。
 *
 * 紧急层（checkEmergency）在这一阶段执行 —— 它是纯程序化的，
 * **不受任何预算/熔断/并发限制**，保证 AI 在危急时永远能反应。
 */
export function evaluateBrainTrigger(entity: Entity, state: GameState): BrainTrigger {
  const aiState = getOrCreateAIState(entity);
  if (!aiState.enabled) return { should: false, priority: "P2", reason: "未启用" };

  // ① 收集感知
  const perception = updatePerception(entity, state);

  // ② 紧急检查（覆盖 LLM 决策）—— 最高优先级，且不受预算限制
  const emergency = checkEmergency(entity, perception);
  aiState.emergency = emergency.flags;
  if (emergency.shouldOverride && emergency.action) {
    return { should: true, priority: "P0", reason: "紧急响应", emergency: emergency.action };
  }

  // ③ 检查事件触发（消费队列）
  const events = pendingEvents.get(entity.id) || [];
  pendingEvents.set(entity.id, []);
  const highPriorityEvent = events.find((e) => shouldTriggerFromEvent(e, aiState.currentAction));

  // ④ 检查心跳间隔
  const now = Date.now();
  const interval = calculateInterval(aiState, perception);
  const intervalElapsed = now - aiState.lastBrainTick >= interval;

  if (!intervalElapsed && !highPriorityEvent) {
    return { should: false, priority: "P2", reason: "未到决策时间" };
  }
  if (now < aiState.cooldownUntil) {
    return { should: false, priority: "P2", reason: "动作冷却中" };
  }

  // ⑤ 记录触发信息（供阶段二使用）
  aiState.pendingTriggerReason = highPriorityEvent
    ? `事件触发: ${highPriorityEvent.type}`
    : `心跳触发（间隔 ${Math.round(interval / 1000)}s）`;
  aiState.pendingTriggerPriority = highPriorityEvent ? highPriorityEvent.priority : "P2";

  return {
    should: true,
    priority: highPriorityEvent ? highPriorityEvent.priority : "P2",
    reason: aiState.pendingTriggerReason,
  };
}

/**
 * ★ callBrain 的调用选项
 */
export interface BrainCallOptions {
  /**
   * 只取「回复短信」，不动角色的行动决策。
   * ★ 场景：玩家发短信叫醒 AI 只想让它回消息，
   *   不该因为回个消息就把角色的当前动作（采集/战斗）打断或替换。
   */
  replyOnly?: boolean;
  /**
   * 同上：保留当前动作，不覆盖 aiState.currentAction / goal / lastBrainTick。
   */
  keepAction?: boolean;
  /**
   * ★ 允许未托管角色调用（短信被动回复场景）。
   * 产品语义：玩家主动发短信给角色 → 角色必须能回复，**不需要开 AI 托管**；
   * AI 托管只管「角色主动决策」（自己寻路/战斗/主动发消息）。
   * 短信回复是「玩家点名 → 角色应答」，与托管无关。
   */
  allowUnmanaged?: boolean;
}

/** ★ callBrainDetailed 的详细版：额外告诉调用方「这次是不是真的拿到了 LLM 响应」 */
export interface BrainCallResult {
  decision: LLMDecision | null;
  /** true = 真的拿到了 LLM 的 JSON 响应；false = 走了程序化兜底 */
  gotLLM: boolean;
  /**
   * ★ 失败原因细分（`gotLLM=false` 时才有意义）：
   *   - "gate"    = 闸门被占 / 通道不可用 → **可以重试**（稍后再试就能拿到）
   *   - "parse"   = 拿到了响应但解析失败   → 重试也未必好，但可以再试一次
   *   - "empty"   = LLM 返回空字符串        → 通道问题，等下次心跳
   *   - "emergency" = 紧急层接管（没走 LLM）
   */
  failReason?: "gate" | "parse" | "empty" | "emergency";
}
export async function callBrain(
  entity: Entity,
  state: GameState,
  opts?: BrainCallOptions,
): Promise<LLMDecision | null> {
  const r = await callBrainDetailed(entity, state, opts);
  return r.decision;
}

/** ★ callBrain 的详细版：额外告诉调用方「这次是不是真的拿到了 LLM 响应」 */
export interface BrainCallResult {
  decision: LLMDecision | null;
  /** true = 真的拿到了 LLM 的 JSON 响应；false = 走了程序化兜底 */
  gotLLM: boolean;
}

/**
 * ★ 详细版 brain 调用
 *
 * 为什么要区分 gotLLM：
 *   短信回复场景下，"闸门被占导致没拿到 LLM"和"LLM 真的没写 message"
 *   是两种完全不同的处理 —— 前者应该重试，后者应该保留待回复登记等下次心跳。
 *   如果不区分，闸门一挡就会误以为"AI 不想回"，玩家永远收不到回复。
 */
export async function callBrainDetailed(
  entity: Entity,
  state: GameState,
  opts?: BrainCallOptions,
): Promise<BrainCallResult> {
  const aiState = getOrCreateAIState(entity);
  // ★ allowUnmanaged：短信被动回复不受托管闸门限制（玩家点名应答 ≠ 托管决策）。
  //   未托管角色照样走完 LLM 决策拿 message，只是不写 currentAction/lastBrainTick（keepAction 已保证）。
  if (!aiState.enabled && !opts?.allowUnmanaged) return { decision: null, gotLLM: false };
  const keepAction = !!opts?.keepAction;

  // 1. 收集感知
  const perception = updatePerception(entity, state);

  // 2. 紧急检查（覆盖 LLM 决策）—— 阶段一已处理过，这里再兜一次（防止直连调用）
  const emergency = checkEmergency(entity, perception);
  aiState.emergency = emergency.flags;
  if (emergency.shouldOverride && emergency.action) {
    // ★ keepAction 模式（短信回复）不打断正在执行的动作
    if (!keepAction) {
      aiState.mode = "emergency";
      aiState.currentAction = emergency.action;
    }
    addMemory(aiState, "system", `紧急：${emergency.action.context}`);
    return {
      decision: { reasoning: "紧急响应", goal: aiState.goal, action: emergency.action },
      gotLLM: false,
      failReason: "emergency",
    };
  }

  // 3. 事件触发（阶段一已消费队列，这里从 pendingTriggerReason 读回）
  if (aiState.pendingTriggerReason) {
    addMemory(aiState, "system", aiState.pendingTriggerReason);
    aiState.pendingTriggerReason = "";
  }

  // 4. 调用 LLM
  aiState.mode = "brain";
  // ★ keepAction 模式不推进心跳计时 —— 否则一次短信回复会把动作决策推迟一整轮
  if (!keepAction) aiState.lastBrainTick = Date.now();

  try {
    const systemPrompt = buildSystemPrompt(aiState, perception);
    const userPrompt = buildUserPrompt(aiState, perception, entity.id);

    // ★ 复用 eventEngine 的 llm.speak 接口
    //    实际通过 aiTalkToLLM 桥接（避免与现有聊天通道冲突）
    const raw = await callLLM(entity.name, systemPrompt, userPrompt);
    if (!raw) {
      // ★ 空响应 = 闸门被占 / 通道不可用 → 可重试
      const decision = fallbackDecision(perception);
      if (!keepAction) {
        aiState.goal = decision.goal;
        aiState.currentAction = decision.action;
      }
      return { decision, gotLLM: false, failReason: "gate" };
    }
    const parsed = parseLLMResponse(raw);
    // ★ 解析失败也走兜底，但 gotLLM=false —— 短信不该发
    const decision = parsed || fallbackDecision(perception);
    // ★ 短信只在真正拿到 LLM 响应时才发 —— fallbackDecision 不带 message，
    //   避免"程序化兜底却发出一条机械短信"。

    // 5. 应用决策
    if (!keepAction) {
      aiState.goal = decision.goal;
      aiState.currentAction = decision.action;
    }
    addMemory(aiState, decision.action.type as any, decision.action.context);

    return parsed
      ? { decision, gotLLM: true }
      : { decision, gotLLM: false, failReason: "parse" };
  } catch (e) {
    console.warn("[ai-brain] LLM调用失败:", e);
    const decision = fallbackDecision(perception);
    if (!keepAction) {
      aiState.goal = decision.goal;
      aiState.currentAction = decision.action;
    }
    return { decision, gotLLM: false, failReason: "gate" };
  }
}

/**
 * LLM 调用桥（由 App.vue 注入实际实现）
 * 默认实现是占位符；App.vue 集成时通过 setLLMCaller 覆盖。
 */
let llmCaller: (entityName: string, systemPrompt: string, userPrompt: string) => Promise<string> =
  async () => "";

/** 注册 LLM 调用器 */
export function setLLMCaller(fn: typeof llmCaller): void {
  llmCaller = fn;
}

/** 取出当前已注册的 LLM 调用器（ai/chatCommand.ts 的 #ai 自由文本路径使用） */
export function getLLMCaller(): (entityName: string, systemPrompt: string, userPrompt: string) => Promise<string> {
  return llmCaller;
}

async function callLLM(entityName: string, systemPrompt: string, userPrompt: string): Promise<string> {
  return llmCaller(entityName, systemPrompt, userPrompt);
}

/** 移除 AI 状态 */
export function removeAIState(entityId: string): void {
  aiStates.delete(entityId);
  pendingEvents.delete(entityId);
}

/** 获取所有 AI 状态（调试用） */
export function getAllAIStates(): Map<string, AIState> {
  return aiStates;
}

/** 暴露给调试面板的 AI 状态快照 */
export function getAIStateSnapshot(entityId: string): AIState | null {
  return aiStates.get(entityId) || null;
}

/** 记录战斗/系统事件到 AI 记忆（外部调用） */
export function notifyAIEvent(
  entityId: string,
  type: AIMemory["type"],
  description: string,
  data?: Record<string, unknown>,
): void {
  const s = aiStates.get(entityId);
  if (!s) return;
  addMemory(s, type, description, data);
}

/** 主循环钩子（每 tick 调用） */
export function tickAI(currentTick: number, _state: GameState): void {
  if (currentTick === lastTick) return;
  lastTick = currentTick;
  // 大脑决策由 App.vue 在合适时机调用 callBrain，
  // 此函数仅用于未来的全局事件分发（如多人AI协调）
}