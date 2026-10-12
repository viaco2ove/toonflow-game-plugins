# ally 类型角色的 AI 托管能力 设计方案

## 概述

在系统-角色面板中，为每个 ally 角色提供 **AI 托管** 复选框。打勾后，大模型（LLM）将接管该角色的行为决策，使其能够自主移动、战斗、采集和与NPC对话。

## 架构设计

### 三层神经架构（类比人体神经系统）

```
┌─────────────────────────────────────────────────────────────┐
│                    AI 托管系统                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🧠 大脑层（LLM 决策）                                      │
│  ────────────────────────────────────────────────────────   │
│  • 理解游戏状态（位置、敌人、物品、任务）                      │
│  • 制定短期/长期目标（打怪升级、采集资源、探索地图）            │
│  • 调用"小脑和脊椎"的行为函数                                 │
│  • 优先级决策（何时追击、何时撤退、何时采集）                  │
│                                                             │
│  ↕ 双向通信：大脑可覆盖小脑指令，小脑可上报紧急事件             │
│                                                             │
│  🧬 小脑+脊椎层（程序化行为）                                 │
│  ────────────────────────────────────────────────────────   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ 插件通用行为 │  │ 地图专用行为 │  │ 紧急反应    │        │
│  │ (all maps)  │  │ (per map)   │  │ (hardcoded) │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│  • 插件级行为函数库                                          │
│  • 地图事件绑定的AI行为（events/scripts/*.ts）               │
│  • 硬编码紧急反应（受伤逃跑、死亡复活、背包满了丢弃）           │
│                                                             │
│  🦴 脊椎层（底层执行）                                        │
│  ────────────────────────────────────────────────────────   │
│  • 路径导航（NavMesh 寻路）                                  │
│  • 碰撞检测与避障                                            │
│  • 动画播放控制                                              │
│  • 攻击判定与伤害结算                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 数据结构设计

### 1. AI 状态（per entity）

```typescript
interface AIState {
  enabled: boolean;           // 是否启用AI托管
  mode: "idle" | "brain" | "emergency";  // 当前模式
  lastBrainTick: number;     // 上次大脑决策时间（ms）
  brainInterval: number;      // 大脑决策间隔（默认5000ms）
  
  // 大脑层状态
  goal: string;              // 当前目标描述（"在农田采集药材"）
  memory: AIMemory[];        // 短期记忆（最近事件）
  
  // 小脑层状态
  currentAction: AIAction;   // 当前执行的动作
  actionQueue: AIAction[];   // 动作队列
  
  // 紧急状态
  emergencyFlags: {
    lowHp: boolean;          // 血量过低
    lowMp: boolean;          // 蓝量不足
    inventoryFull: boolean;  // 背包满了
    targetDied: boolean;     // 目标死亡
  };
}

interface AIMemory {
  timestamp: number;
  type: "combat" | "gather" | "dialog" | "loot" | "damage" | "system";
  description: string;
  data: Record<string, unknown>;
}

interface AIAction {
  type: "move" | "attack" | "gather" | "interact" | "useSkill" | "useItem" | "wait" | "flee";
  target?: { x: number; y: number; id?: string; name?: string };
  skill?: string;
  item?: string;
  priority: number;  // 0-100, 越高越优先
  estimatedDuration: number;  // 预估执行时间(ms)
  context: string;   // 执行原因（供大脑理解）
}
```

### 2. AI 感知数据（每 tick 更新）

```typescript
interface AIPerception {
  self: {
    id: string;
    name: string;
    hp: number; maxHp: number;
    mp: number; maxMp: number;
    level: number;
    position: { x: number; y: number };
    mapName: string;
    inventory: ItemInfo[];
    skills: SkillInfo[];
    buffs: BuffInfo[];
  };
  
  nearby: {
    enemies: EntityInfo[];    // 13米感知半径内敌人
    allies: EntityInfo[];     // 附近友方
    npcs: EntityInfo[];      // 附近NPC
    loot: LootInfo[];         // 掉落物品
    resources: ResourceInfo[]; // 可采集资源（与eventZones联动）
  };
  
  world: {
    currentMap: string;
    nearbyMaps: string[];     // 相邻地图
    exploredRegions: string[];
    timeOfDay: string;
  };
}
```

### 3. 角色面板数据结构

```typescript
// 角色卡数据结构扩展
interface RoleCard {
  id: string;
  name: string;
  avatarPath: string;
  level: number;
  hp: number; maxHp: number;
  mp: number; maxMp: number;
  
  // AI托管相关
  aiManaged: boolean;        // 是否开启AI托管
  aiPersonality?: string;    // AI性格描述（影响决策风格）
  aiGoals?: string[];        // 角色AI目标列表
  
  // 位置信息
  position: { x: number; y: number };
  mapName: string;
  
  // 组队信息
  inParty: boolean;
  followPlayer: boolean;
}
```

## 功能模块设计

### 模块1：角色面板 AI 托管开关

**UI 位置**：系统面板 → 角色 Tab → 每个角色卡片

**交互流程**：
```
用户勾选"AI托管"checkbox
       ↓
保存 aiManaged: true 到角色状态
       ↓
通知 AI Controller 启动该角色AI
       ↓
AI Controller 创建/恢复 AIState
       ↓
开始 AI 感知-决策-执行循环
```

**Checkbox UI**：
```
┌────────────────────────────────────────┐
│ [👤] 萧肿   Lv.5  HP:50/50  MP:30/30  │
│ 位置: mulberryTown (13, 25)            │
│                                        │
│ ☑ AI托管    ☑ 跟随玩家    [传送到]      │
│ 性格: 谨慎型，优先采集后战斗            │
└────────────────────────────────────────┘
```

### 模块2：大脑层（LLM 决策）

**触发条件**：
- 每 `brainInterval` ms（默认5秒）触发一次
- 紧急事件上报时（敌人来袭、血量危急）
- 当前动作完成时

**LLM 输入 Prompt 结构**：
```
你是角色"{{角色名}}"的AI大脑。

【当前状态】
{{perception.self | json}}

【周围环境】
{{perception.nearby | json}}

【世界信息】
{{perception.world | json}}

【最近记忆】
{{aiState.memory | json}}

【当前目标】
{{aiState.goal}}

【可用动作】
- move(x, y): 移动到坐标
- attack(targetId): 攻击目标
- gather(zoneName): 进入采集区域
- interact(npcId): 与NPC对话
- useSkill(skillName): 使用技能
- useItem(itemName): 使用物品
- flee(): 撤退到安全位置
- wait(): 原地等待

【决策要求】
1. 优先保证存活（血量<30%时必须撤退或治疗）
2. 背包80%时优先处理物品
3. 如果有明确目标，保持目标一致性
4. 与玩家保持适当距离（不要太远以便支援）
5. 根据性格调整策略

请输出JSON格式的决策：
{
  "reasoning": "决策理由",
  "goal": "新的目标描述",
  "action": { "type": "...", "target": {...}, "context": "..." }
}
```

**LLM 输出解析**：
```typescript
interface LLMDecision {
  reasoning: string;
  goal: string;
  action: AIAction;
}
```

### 模块3：小脑层（程序化行为）

#### 3.1 插件通用行为函数库

```typescript
// ai/behaviors/common.ts
export const commonBehaviors = {
  // 战斗行为
  autoAttack: (target: EntityInfo) => AIAction,
  attackNearestEnemy: () => AIAction,
  useHealingSkill: () => AIAction,
  useBuffSkill: () => AIAction,
  
  // 移动行为
  followPlayer: () => AIAction,
  moveToResource: (resource: ResourceInfo) => AIAction,
  returnToSafeZone: () => AIAction,
  
  // 生存行为
  fleeFromEnemy: (enemy: EntityInfo) => AIAction,
  drinkPotion: () => AIAction,
  depositToRing: () => AIAction,  // 存入纳戒
  
  // 采集行为
  startGathering: (zone: EventZone) => AIAction,
  continueGathering: () => AIAction,
  
  // 社交行为
  talkToNPC: (npc: EntityInfo) => AIAction,
  greetNearbyPlayer: () => AIAction,
};
```

#### 3.2 地图专用 AI 行为

在 `events/scripts/` 中定义地图特定的 AI 行为：

```typescript
// events/scripts/mulberryTown_ai.ts
import type { Ctx } from "../shared/_ctx";

export default {
  name: "mulberryTown_ai",
  async run(ctx: Ctx) {
    const ai = ctx.ai;
    
    // 城镇内的日常行为
    ai.registerBehavior("morning", () => {
      // 早上去祖师堂打坐
      if (ai.timeInRange("06:00", "08:00")) {
        return ai.moveTo(6, 15);  // 祖师堂
      }
      // 中午去药堂
      if (ai.timeInRange("11:00", "13:00")) {
        return ai.moveTo(6, 37);  // 药堂
      }
      // 傍晚去演武场
      if (ai.timeInRange("17:00", "19:00")) {
        return ai.moveTo(20, 30);  // 演武场
      }
      return null;
    });
    
    // 农田采集优先级
    ai.registerPriority("gather", () => {
      const herbZone = ai.getResourceZone("农田");
      if (herbZone && ai.hasFreeInventorySlot()) {
        return { target: herbZone, priority: 70 };
      }
      return null;
    });
  }
};
```

#### 3.3 紧急反应（硬编码）

```typescript
// ai/behaviors/emergency.ts
export const emergencyReactions = {
  // 血量危急
  onLowHp: (hpPercent: number): AIAction | null => {
    if (hpPercent < 0.15) {
      return {
        type: "flee",
        context: "血量危急，强制撤退"
      };
    }
    if (hpPercent < 0.30) {
      return {
        type: "useItem",
        item: findHealingPotion(),
        context: "血量过低，使用治疗药水"
      };
    }
    return null;
  },
  
  // 蓝量不足
  onLowMp: (mpPercent: number): AIAction | null => {
    if (mpPercent < 0.20) {
      return {
        type: "wait",
        estimatedDuration: 5000,
        context: "等待蓝量恢复"
      };
    }
    return null;
  },
  
  // 背包满了
  onInventoryFull: (): AIAction | null => {
    return {
      type: "useItem",  // 或存入纳戒
      context: "背包满了，尝试使用或存储物品"
    };
  },
  
  // 目标死亡
  onTargetDied: (target: EntityInfo): AIAction | null => {
    return {
      type: "attackNearestEnemy",
      context: `目标${target.name}死亡，切换目标`
    };
  },
  
  // 被包围
  onSurrounded: (enemyCount: number): AIAction | null => {
    if (enemyCount >= 3) {
      return {
        type: "flee",
        context: "被包围，突围撤退"
      };
    }
    return null;
  },
};
```

### 模块4：脊椎层（执行引擎）

**职责**：
- 每 tick（16ms）处理一个 AI action
- 路径规划和避障
- 动画同步
- 攻击判定

```typescript
// ai/spine/executor.ts
class AISpineExecutor {
  executeAction(action: AIAction, entity: Entity, state: GameState): boolean {
    switch (action.type) {
      case "move":
        return this.executeMove(entity, action.target, state);
      
      case "attack":
        return this.executeAttack(entity, action.target, state);
      
      case "gather":
        return this.executeGather(entity, action.zone, state);
      
      case "useSkill":
        return this.executeSkill(entity, action.skill, state);
      
      case "flee":
        return this.executeFlee(entity, state);
      
      // ... 其他动作
    }
  }
  
  private executeMove(entity: Entity, target: Position, state: GameState): boolean {
    // 使用 NavMesh 寻路
    const path = findPath(entity.x, entity.y, target.x, target.y, state.navMesh);
    if (!path) return false;
    
    // 按路径点移动
    const nextPoint = path[0];
    const dx = nextPoint.x - entity.x;
    const dy = nextPoint.y - entity.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    if (dist < 0.3) {
      // 到达目标
      return true;
    }
    
    // 移动（碰撞检测）
    const speed = 2; // m/s
    const moveX = (dx / dist) * speed * TICK_MS / 1000;
    const moveY = (dy / dist) * speed * TICK_MS / 1000;
    
    if (canMoveTo(entity, entity.x + moveX, entity.y + moveY, state)) {
      entity.x += moveX;
      entity.y += moveY;
    }
    
    return false; // 未完成
  }
}
```

### 模块5：感知系统

```typescript
// ai/perception/sensor.ts
class AIPerceptionSystem {
  private perceptionRadius = 13; // 米，与玩家视野一致
  
  update(entity: Entity, state: GameState): AIPerception {
    return {
      self: this.senseSelf(entity),
      nearby: {
        enemies: this.senseEnemies(entity, state),
        allies: this.senseAllies(entity, state),
        npcs: this.senseNPCs(entity, state),
        loot: this.senseLoot(entity, state),
        resources: this.senseResources(entity, state),  // 从eventZones获取
      },
      world: this.senseWorld(state),
    };
  }
  
  private senseResources(entity: Entity, state: GameState): ResourceInfo[] {
    const resources: ResourceInfo[] = [];
    const zones = eventEngine.getEventZones();  // 复用事件系统的zone数据
    
    for (const zone of zones) {
      if (zone.name === "喷水池" || zone.name === "农田" || zone.name === "木材堆") {
        const dist = Math.hypot(zone.x - entity.x, zone.y - entity.y);
        if (dist <= this.perceptionRadius * 2) {  // 资源感知范围扩大
          resources.push({
            type: zone.name.includes("农田") ? "herb" :
                  zone.name.includes("水池") ? "fish" :
                  zone.name.includes("木材") ? "wood" : "unknown",
            zone: zone.name,
            position: { x: zone.x, y: zone.y },
            distance: dist,
            available: this.checkZoneAvailable(zone, state),
          });
        }
      }
    }
    
    return resources;
  }
}
```

## 通信协议设计

### 大脑 ↔ 小脑 通信

```typescript
// AI消息类型
type AIMessage = 
  | { type: "goal_update"; goal: string; reason: string }
  | { type: "action_override"; action: AIAction; reason: string }
  | { type: "emergency"; level: "high" | "medium"; action: AIAction }
  | { type: "report"; completed: boolean; result: string }
  | { type: "perception_update"; perception: AIPerception };

// 通信通道
class AIBus {
  private queues: Map<string, AIMessage[]> = new Map();
  
  send(from: string, to: string, msg: AIMessage): void {
    const queue = this.queues.get(to) || [];
    queue.push(msg);
    this.queues.set(to, queue);
  }
  
  receive(recipient: string): AIMessage | undefined {
    const queue = this.queues.get(recipient);
    return queue?.shift();
  }
}
```

### LLM 接口（复用 eventEngine 的 llm.speak）

```typescript
// 复用 eventEngine.ts 中的 llm 接口
const llm = eventEngine.getLLMInterface();

// 调用示例
const decision = await llm.speak(
  "ai_brain",           // npcId
  "萧肿",               // npcName
  JSON.stringify({ perception, memory, goal })
);

// decision 即为 LLM 返回的决策
```

## 存储设计

### AI 状态持久化

```typescript
// 存储到 t_plugin_session_data
interface AIStorage {
  key: "ai_states",
  value: {
    [entityId: string]: {
      enabled: boolean;
      mode: string;
      goal: string;
      memory: AIMemory[];
      personality?: string;
      lastUpdate: number;
    }
  }
}

// 位置信息单独存储（复用现有 ally 位置存储）
interface AllyPosition {
  id: string;
  mapName: string;
  x: number;
  y: number;
  lastUpdate: number;
}
```

## 实现步骤

### Phase 1: 基础框架（1-2天）

- [ ] 定义 AI 状态和感知数据结构
- [ ] 实现感知系统（sensor）
- [ ] 实现基础执行器（spine/executor）
- [ ] 角色面板添加 AI 托管 checkbox

### Phase 2: 小脑行为库（2-3天）

- [ ] 插件通用行为函数（combat, move, gather）
- [ ] 紧急反应系统
- [ ] 与 eventEngine 集成（感知 eventZones）

### Phase 3: 大脑层（LLM 决策）（2-3天）

- [ ] LLM 接口对接（复用 eventEngine llm）
- [ ] Prompt 工程和决策解析
- [ ] 大脑决策循环实现

### Phase 4: 地图专用 AI（1-2天）

- [ ] 地图事件脚本扩展 AI 行为
- [ ] 多角色协调（避免多个AI做相同事）

### Phase 5: 优化和测试（1-2天）

- [ ] 决策频率调优
- [ ] 性能优化
- [ ] 边界情况处理
- [ ] 端到端测试

## 设计重点1：ai 大模型什么时候触发去调用接口？

## 设计重点2：ai托管器agent 的系统提示词和用户提示词如何设计？

## 注意事项

1. **性能考虑**：LLM 调用有延迟，决策间隔不宜过短（建议5-10秒）
2. **资源控制**：限制同时托管的 AI 角色数量（建议最多5个）
3. **防止循环**：加入随机性和冷却机制，避免 AI 卡在行为循环
4. **容错处理**：LLM 响应失败时回退到小脑程序化行为
5. **与现有系统兼容**：复用 eventEngine 的 zone 感知、llm 接口等

## 相关文档

- [ai_分类.md](./ai_分类.md) - AI 系统整体分类
- [ally角色位置.md](../ally角色位置.md) - ally 角色位置管理
- [game.md](../game.md) - 系统面板和角色卡设计
