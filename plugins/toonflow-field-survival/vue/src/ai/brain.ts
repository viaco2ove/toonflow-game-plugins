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
  BrainConfig,
  LLMDecision,
} from "./types";
import { DEFAULT_BRAIN_CONFIG } from "./types";
import { checkEmergency, updatePerception } from "./sensor";
import type { Entity, GameState } from "../types";

/** AI 大脑状态 */
const aiStates: Map<string, AIState> = new Map();
const brainConfig: BrainConfig = { ...DEFAULT_BRAIN_CONFIG };
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

/** 计算自适应间隔 */
function calculateInterval(state: AIState, perception: AIPerception): number {
  if (!brainConfig.adaptiveEnabled) return brainConfig.minInterval;

  // 战斗时缩短
  if (perception.nearby.enemies.length > 0) {
    return Math.max(brainConfig.minInterval, 3000);
  }
  // 资源点存在时中等
  if (perception.resources.length > 0) {
    return (brainConfig.minInterval + brainConfig.maxInterval) / 2;
  }
  // 空闲时延长
  return brainConfig.maxInterval;
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
  return `# 角色设定

你是角色【${state.characterName}】的AI控制大脑。

## 基础信息
- 名字：${state.characterName}
- 等级：Lv.${state.characterLevel}
- 性格特点：${state.personality}
- 当前所在地图：${perception.world.currentMap || "未知"}

## 核心能力
- HP: ${perception.self.hp}/${perception.self.maxHp} (${perception.self.hpPercent}%)
- MP: ${perception.self.mp}/${perception.self.maxMp} (${perception.self.mpPercent}%)
- 攻击力: ${perception.self.atk}
- 防御力: ${perception.self.def}

## 背包物品
${perception.self.inventory.length ? perception.self.inventory.map((i) => `- ${i.name} ×${i.count}`).join("\n") : "- 空"}

## 技能列表
${perception.self.skills.length ? perception.self.skills.map((s) => `- ${s.name} (消耗${s.cost}MP, 冷却剩余${s.cdLeft}秒)`).join("\n") : "- 无"}

## 当前位置
- X: ${perception.self.position.x.toFixed(1)}, Y: ${perception.self.position.y.toFixed(1)}
- 附近可采集资源：
${perception.resources.length ? perception.resources.map((r) => `  - ${r.zoneName} (${r.type}, ${r.distance}米)`).join("\n") : "  - 暂无"}
`;
}

/** 构建 User Prompt（当前状态 + 决策请求） */
function buildUserPrompt(state: AIState, perception: AIPerception): string {
  const recentMemory = state.memory.slice(-3).map((m) => {
    const ago = Math.round((Date.now() - m.timestamp) / 1000);
    const agoText = ago < 60 ? `${ago}秒前` : `${Math.round(ago / 60)}分钟前`;
    return `- ${m.description} (${agoText})`;
  }).join("\n");

  return `## 当前情况

### 环境感知
- 周围敌人：${perception.nearby.enemies.length}只${perception.nearby.enemies.length ? " (" + perception.nearby.enemies.slice(0, 3).map((e) => `${e.name} HP:${e.hp}/${e.maxHp} 距${e.distance}米`).join(", ") + ")" : ""}
- 周围友方：${perception.nearby.allies.length}个
- 周围NPC：${perception.nearby.npcs.length}个

### 战斗状态
${perception.nearby.enemies.length ? `- 周围有 ${perception.nearby.enemies.length} 个敌人
- 最近敌人: ${perception.nearby.enemies[0]?.name} (HP: ${perception.nearby.enemies[0]?.hp}, 距离: ${perception.nearby.enemies[0]?.distance}米)` : "- 当前未在战斗"}

### 资源状态
- 背包物品数: ${perception.self.inventory.length}
${perception.self.inventory.length >= 8 ? "- ⚠️ 背包即将满，建议处理物品" : ""}
- 可达资源: ${perception.resources.length}个${perception.resources[0] ? ` (最近: ${perception.resources[0].zoneName}, ${perception.resources[0].distance}米)` : ""}

### 角色记忆（最近3件事）
${recentMemory || "- 暂无"}

### 当前目标
${state.goal}

## 决策要求

1. **生存优先**：HP < 30% 必须治疗或撤退
2. **效率优先**：有明确目标时保持专注
3. **团队协作**：适当支援附近友方
4. **资源管理**：背包较多时优先处理

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
  }
}
\`\`\`

可用动作类型：move, attack, gather, interact, useSkill, useItem, flee, wait, follow`;
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
    };
  } catch (e) {
    console.warn("[ai-brain] LLM响应解析失败:", e);
    return null;
  }
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

/** ★ 主决策函数：调用 LLM 并返回结果 */
export async function callBrain(
  entity: Entity,
  state: GameState,
): Promise<LLMDecision | null> {
  const aiState = getOrCreateAIState(entity);
  if (!aiState.enabled) return null;

  // 1. 收集感知
  const perception = updatePerception(entity, state);

  // 2. 紧急检查（覆盖 LLM 决策）
  const emergency = checkEmergency(entity, perception);
  aiState.emergency = emergency.flags;
  if (emergency.shouldOverride && emergency.action) {
    aiState.mode = "emergency";
    aiState.currentAction = emergency.action;
    addMemory(aiState, "system", `紧急：${emergency.action.context}`);
    return { reasoning: "紧急响应", goal: aiState.goal, action: emergency.action };
  }

  // 3. 检查事件触发
  const events = pendingEvents.get(entity.id) || [];
  pendingEvents.set(entity.id, []);
  const highPriorityEvent = events.find((e) => shouldTriggerFromEvent(e, aiState.currentAction));

  if (highPriorityEvent) {
    addMemory(aiState, "system", `事件触发: ${highPriorityEvent.type}`);
  }

  // 4. 检查心跳间隔
  const now = Date.now();
  const interval = calculateInterval(aiState, perception);
  const intervalElapsed = now - aiState.lastBrainTick >= interval;
  if (!intervalElapsed && !highPriorityEvent) {
    return null; // 未到决策时间
  }
  if (now < aiState.cooldownUntil) {
    return null; // 冷却中
  }

  // 5. 调用 LLM
  aiState.mode = "brain";
  aiState.lastBrainTick = now;

  try {
    const systemPrompt = buildSystemPrompt(aiState, perception);
    const userPrompt = buildUserPrompt(aiState, perception);

    // ★ 复用 eventEngine 的 llm.speak 接口
    //    实际通过 aiTalkToLLM 桥接（避免与现有聊天通道冲突）
    const raw = await callLLM(entity.name, systemPrompt, userPrompt);
    const decision = parseLLMResponse(raw) || fallbackDecision(perception);

    // 6. 应用决策
    aiState.goal = decision.goal;
    aiState.currentAction = decision.action;
    addMemory(aiState, decision.action.type as any, decision.action.context);

    return decision;
  } catch (e) {
    console.warn("[ai-brain] LLM调用失败:", e);
    const decision = fallbackDecision(perception);
    aiState.goal = decision.goal;
    aiState.currentAction = decision.action;
    return decision;
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