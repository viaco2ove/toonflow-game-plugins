# ai 托管的具体设计
## 1. 引言
架构设计已在
[ai_分类.md](ai_%E5%88%86%E7%B1%BB.md)
[ally 类型角色的ai 托管能力.md](ally%20%E7%B1%BB%E5%9E%8B%E8%A7%92%E8%89%B2%E7%9A%84ai%20%E6%89%98%E7%AE%A1%E8%83%BD%E5%8A%9B.md)

## 什么ai 能力做到插件，什么ai 能力做到地图集

按「三层神经架构」沿 **通用 vs 专用** 切分：**插件** 装「大脑 + 通用肢体 + 保命反射 + 执行脊椎 + 通信」；**地图集** 只装「这张地图的作息剧本、坐标、资源点、采集优先级」这类地图专属经验，通过 `events/scripts/<map>_ai.ts` 注册给小脑。

### 判定表：什么进插件 / 什么进地图集

| 能力 | 归属 | 依据 |
|------|------|------|
| **大脑层 LLM 决策器**（prompt 构造、决策 JSON 解析、触发策略、冷却、事件触发判断、错误兜底） | ✅ 插件 | 所有地图共用同一套"决策逻辑 + 大模型接口"，不依赖任何地图数据 |
| **感知系统 sensor**（自身 HP/MP/背包/技能、周围敌我 NPC、资源点、世界信息） | ✅ 插件 | 数据来自实体 + 全局 state，地图无关 |
| **通用行为函数库**（`autoAttack / followPlayer / fleeFromEnemy / drinkPotion / startGathering / talkToNPC / depositToRing` 等） | ✅ 插件 | 架构文档 3.1「所有地图通用」 |
| **紧急反应系统**（低血逃跑、蓝耗等待、背包满、被包围、目标死亡切换） | ✅ 插件 | 架构文档 3.3 硬编码，纯生存逻辑，跨图复用 |
| **脊椎执行引擎**（NavMesh 寻路、碰撞避障、动画、攻击判定） | ✅ 插件 | 架构文档模块4，底层执行，地图无关 |
| **大脑↔小脑通信 AIBus**、`#ai xxx` 触发指令解析、AI 状态持久化 | ✅ 插件 | 基础设施，全图共用 |
| **地图专用行为**（`events/scripts/<map>_ai.ts` 里注册） | ✅ 地图集 | 架构文档 3.2「某个地图专用」 |
| **地图本地坐标/资源点配置**（祖师堂(6,15)、药堂(6,37)、演武场(20,30)、农田/木材堆/喷水池 的 eventZones） | ✅ 地图集 | 坐标和 zone 名是地图数据，插件不知道某张图哪格是农田 |
| **地图特有的时序/作息行为**（镇上早上打坐/中午药堂/傍晚演武场） | ✅ 地图集 | "镇上才有"的剧本，森林/荒野不适用 |
| **地图特化资源采集优先级**（本图农田优先采药草） | ✅ 地图集 | 优先级表按图配置 |

### 边界一句话

**插件** 负责"怎么想 + 怎么动 + 怎么活"（大脑决策、通用肢体、保命反射、执行脊椎、通信协议）；**地图集** 负责"在**这张图**上该干啥"（作息脚本、坐标、资源点、采集优先级），把地图专属"经验值"注册给小脑。

### 数据流（大脑如何吃到地图知识）

```
地图集 events/scripts/<map>_ai.ts
   └─ 导出 mapKnowledge = { schedule, zones, gatherPriority }
        │
        ▼
插件 小脑层按当前 mapName 查 mapKnowledge
        │
        ▼
插件 大脑层构造 prompt 时，把 mapKnowledge 注入「当前地图信息」段
        │
        ▼
LLM 决策 → 调用通用行为函数 / 地图注册行为
```

### 待补规范（文档缺口）

1. **地图知识注入结构**：`events/scripts/<map>_ai.ts` 统一导出 `mapKnowledge`，作为大脑 prompt 的"当前地图信息"段来源：

   ```typescript
   export interface MapKnowledge {
     schedule: Array<{ timeRange: string; behavior: string; target?: { x: number; y: number } }>; // 作息剧本
     zones:    Array<{ name: string; x: number; y: number; type: "herb" | "fish" | "wood" | "safe" | "combat" }>;
     gatherPriority: Array<{ zone: string; priority: number; when?: string }>; // 采集优先级表
   }
   ```

2. **大脑 prompt 的地图注入点**：架构文档 system prompt 里的 `{{当前地图}}` 必须替换成"地图名 + `mapKnowledge` 摘要"，否则大脑不知道本图该干嘛。建议在 plugin 大脑层留 `{{mapSpecificHint}}` 占位，由地图集行为脚本填。