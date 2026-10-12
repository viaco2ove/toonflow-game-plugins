/**
 * 事件系统 ctx API 类型（引擎导出）
 * ==========================================
 * 本文件是「引擎侧 ↔ 脚本侧」的类型契约：
 *   - 引擎侧（entry.ts / App.vue 事件引擎）按此实现 ctx 对象
 *   - 脚本侧（events/scripts/*.ts）按此类型写脚本，编译期即可检查 API 误用
 *   - 校验脚本 validate_events.mjs 据此扫描 ctx.* 调用是否合法
 *
 * 本文件不参与构建（type-only），由 App.vue 运行时构造 ctx 实例。
 */

/** 实体句柄（玩家/NPC/怪通用） */
export interface Entity {
  id: string;
  name: string;
  side: "player" | "ally" | "enemy" | "neutral";
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level?: number;
  camp?: "hostile" | "neutral" | "friendly";
  [key: string]: unknown;
}

/** 事件脚本上下文 */
export interface Ctx {
  /** 玩家实体引用（只读快照，改数值用 save/level API） */
  player: Entity;
  /** 当前地图文件名（不含 .json） */
  mapName: string;

  /** 玩家卡 flag 读写（唯一来源 t_plugin_session_data） */
  save: {
    getFlag<T = unknown>(key: string): Promise<T | null>;
    setFlag(key: string, value: unknown): Promise<void>;
    delFlag(key: string): Promise<void>;
    /** 一次性读全部 flags（脚本内判断复杂条件用） */
    all(): Promise<Record<string, unknown>>;
  };

  /** NPC / 实体操作 */
  npc: {
    byUid(uid: string): Entity | null;
    /** 改头顶名 */
    setLabel(uid: string, label: string): void;
    /** 移动 NPC 到坐标（米） */
    move(uid: string, x: number, y: number): void;
    /** 让 NPC 朝向玩家 */
    faceTo(uid: string, targetId: string): void;
  };

  /** UI 反馈 */
  ui: {
    /** 右下角飘字（color: gold/red/white/blue） */
    toast(text: string, color?: "gold" | "red" | "white" | "blue"): void;
    /** 顶部大字幕（剧情节点用） */
    subtitle(text: string, durationMs?: number): void;
    /** 往 state.events 推一条事件日志（HUD 事件流） */
    event(text: string): void;
    /** 确认对话框（采集/交互确认）：resolve(true)=玩家点了确定 */
    confirm(opts: { title: string; detail?: string; confirmText?: string; cancelText?: string }): Promise<boolean>;
  };

  /** 背包操作（走宿主 sys_shop_buy 同款入包链，mock/真实宿主都落账） */
  bag: {
    /** 发放物品到背包 */
    give(name: string, count?: number): void;
  };

  /** 关卡操作 */
  level: {
    /** 切换地图（前端 switchLevel） */
    switchTo(mapFile: string, x: number, y: number): void;
    /** 解锁/上锁地图（影响 portal 可用性，写 flag `map_locked_<mapFile>`） */
    setLocked(mapFile: string, locked: boolean): void;
  };

  /** 音效（占位：当前引擎无音频通道，no-op） */
  audio: {
    play(name: string): void;
  };

  /** LLM 调用（剧情对话/判定） */
  llm: {
    /** 调 sys_chat 同款 agent：返回角色台词文本 */
    speak(npcId: string, npcName: string, userText: string, opts?: { mode?: "response" | "options" }): Promise<string>;
  };

  /** 引擎注册钩子 */
  registerAction(name: string, fn: (args: Record<string, unknown>, ctx: Ctx) => Promise<void>): void;
}

/** 事件定义（maps/<name>.events.json 里的一行） */
export interface EventDef {
  id: string;
  /** 触发器 */
  trigger:
    | { type: "enter_map" }
    | { type: "interact"; uid: string }
    | { type: "area_enter"; zone: string }
    | { type: "step_on"; x: number; y: number }
    | { type: "flag_set"; key: string }
    | { type: "kill_count"; gte: number }
    | { type: "turn_count"; gte: number }
    | { type: "custom"; name: string };
  /** 条件（全部满足才 fire） */
  conditions?: Array<
    | { type: "flag_check"; key: string; value?: unknown; op?: "eq" | "ne" | "exists" | "missing" }
    | { type: "phase_done"; phaseId: string }
    | { type: "level_gte"; level: number }
    | { type: "random"; p: number }
  >;
  /** 动作（顺序执行） */
  actions: Array<
    | { type: "set_flag"; key: string; value: unknown }
    | { type: "del_flag"; key: string }
    | { type: "toast"; text: string; color?: "gold" | "red" | "white" | "blue" }
    | { type: "subtitle"; text: string; duration?: number }
    | { type: "event_log"; text: string }
    | { type: "teleport"; map: string; x: number; y: number }
    | { type: "run_script"; script: string; args?: Record<string, unknown> }
    | { type: "call_action"; name: string; args?: Record<string, unknown> }
    | { type: "llm_speak"; npcId: string; npcName: string; userText: string }
    | { type: "wait"; ms: number }
  >;
  /** 备注（编辑器只读显示） */
  comment?: string;
  /** 可重复触发（采集类 area_enter）：跳过「本次会话一次机会」防重入 */
  repeat?: boolean;
}

/** 事件文件（maps/<name>.events.json 顶层结构） */
export interface EventsFile {
  version: 1;
  map: string;
  events: EventDef[];
}