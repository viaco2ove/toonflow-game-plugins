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

  /** 本次事件脚本的执行者。roleId="" = 玩家自己走进区域（保留全部交互行为）；
   *  非空 = AI 托管角色（如 mapKnowledge.triggerZoneGather 传入的采集者）。
   *  脚本据此分流：AI 走 ctx.actor.ai → confirm 自动通过、不打断玩家、产出进 _aiBag。 */
  actor: {
    roleId: string;
    /** true = 由 AI 托管角色触发（非玩家操作） */
    ai: boolean;
    /** 非 AI 时为 "player"；AI 时为该角色名（飘字/日志用） */
    name: string;
  };

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
    /** ★ 直接改实体字段（side/hp/level/alive 等）——事件脚本改假人阵营/血量用。
     *  按 Tiled object id 定位（认 mapnpc_* 与 mapmob_*）。返回是否改成功。 */
    setField(uid: string, patch: Record<string, unknown>): boolean;
  };

  /** UI 反馈 */
  ui: {
    /** 右下角飘字（color: gold/red/white/blue） */
    toast(text: string, color?: "gold" | "red" | "white" | "blue"): void;
    /** 顶部大字幕（剧情节点用） */
    subtitle(text: string, durationMs?: number): void;
    /** 往 state.events 推一条事件日志（HUD 事件流） */
    event(text: string): void;
    /** 确认对话框（采集/交互确认）：resolve(true)=玩家点了确定。
     *  ★ ctx.actor.ai 时引擎自动 resolve(true)，不弹窗打断玩家。 */
    confirm(opts: { title: string; detail?: string; confirmText?: string; cancelText?: string }): Promise<boolean>;
    /** ★ 多选面板（锻造/炼丹的功能菜单）：resolve(选项 value)，取消 resolve(null)。
     *  ★ ctx.actor.ai 时引擎自动 resolve(第一个选项)，不弹窗打断玩家。 */
    select(opts: { title: string; detail?: string; options: Array<{ label: string; value: string; desc?: string }> }): Promise<string | null>;
    /** ★ 文本输入框（输入物品名称/丹药名称）：resolve(输入文本)，取消 resolve(null)。
     *  ★ ctx.actor.ai 时引擎自动 resolve(空串)，不弹窗打断玩家。 */
    prompt(opts: { title: string; detail?: string; placeholder?: string; defaultValue?: string }): Promise<string | null>;
    /** ★ 打开锻造/炼丹多标签面板。
     *  mode: "forge"（锻造：售卖/打造/升级/溶解）| "alchemy"（炼丹：售卖/炼丹/溶解）
     *  tab:  初始标签（默认 "sell"）
     *  ★ ctx.actor.ai 时自动忽略（AI 不开面板）。 */
    openShopPanel(opts: { mode: "forge" | "alchemy"; tab?: string }): void;
  };

  /** ★ AI 生成（对接大模型）
   *  ★ ctx.actor.ai 时引擎自动返回空串，不消耗玩家资源。 */
  ai: {
    /** 调 agent 生成物品/丹药，返回 AI 的纯文本（通常是 JSON）。
     *  失败返回空串（脚本内自行做兜底）。 */
    generate(agentName: string, prompt: string, opts?: { timeoutMs?: number }): Promise<string>;
  };

  /** ★ 背包操作（除 give 之外的读写）
   *  ★ ctx.actor.ai 时读 AI 私藏，写操作自动跳过。 */
  bag: {
    /** 发放物品。ctx.actor.ai 时进该 AI 的 _aiBag，否则进玩家背包。 */
    give(name: string, count?: number): void;
    /** 读取玩家背包物品列表（升级/溶解时选目标用） */
    list(): Promise<Array<{ name: string; count: number; kind: string; rarity: string; heal: number; lv?: number; desc?: string }>>;
    /** 移除物品（溶解/升级替换时用）。ctx.actor.ai 时跳过。 */
    remove(name: string, count?: number): Promise<boolean>;
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

  /** ★ 调用后端插件命令（sendTick 通道）
   *  用于事件脚本触发 entry.ts 中定义的 sys_xxx 指令。
   *  AI 执行时自动跳过并记日志，不弹窗不阻塞。 */
  cmd(action: string, params?: Record<string, unknown>): Promise<string>;
}
/** 事件定义（maps/<name>.events.json 里的一行） */
export interface EventDef {
  id: string;
  /** 触发器 */
  trigger:
    | { type: "enter_map" }
    | { type: "interact"; uid: string }
    // ★ proximity：靠近自动弹交互按钮（比 interact 更主动）
    //   uid：Tiled object id；radius：触发半径（米，默认 2.8）
    | { type: "proximity"; uid: string; radius?: number }
    // ★ ai.gather：向 AI 托管声明「这个 zone 能采什么」（mapKnowledge 读取，可选字段）
    //   缺省时按 事件id → zone名 顺序推断。取值：herb / fish / wood / ore / other
    | { type: "area_enter"; zone: string; ai?: { gather?: "herb" | "fish" | "wood" | "ore" | "other" } }
    | { type: "step_on"; x: number; y: number }
    | { type: "flag_set"; key: string }
    | { type: "kill_count"; gte: number }
    | { type: "turn_count"; gte: number }
    // ★ v6 AI 托管：定时器触发器 ——「地图集可以个性自己的定时器」的落点
    //   everyMs：触发周期（ms）。硬下界 2000（低于此 LLM 决策会堆积而非变快）
    //   when：触发条件 —— any（默认）| combat（仅玩家战斗/遭遇战时）| idle（仅非战斗时）
    | { type: "interval"; everyMs: number; when?: "any" | "combat" | "idle" }
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
    // ★ v6 AI 托管：唤醒托管角色的大脑（可精确地在剧情节点上"戳"一下 AI）
    //   priority：P0 无条件立即决策 / P1 可打断 move·wait·follow / P2 不打断
    //   target：可选，只唤醒指定角色（角色 id / "ally:名字" / 纯名字）；缺省 = 全部
    | { type: "ai_trigger"; priority?: "P0" | "P1" | "P2"; reason?: string; target?: string }
    // ★ v6 AI 托管：覆盖本图 AI 决策间隔（地图集"个性自己的定时器"）
    //   钳制：engaged 下界 3000ms，其他态下界 5000ms，上界 30000ms
    | { type: "ai_interval"; engaged?: number; skirmish?: number; idle?: number; all?: number }
  >;
  /** 备注（编辑器只读显示） */
  comment?: string;
  /** ★ proximity 触发器的展示信息：靠近时弹出的按钮文案 */
  proximity?: {
    /** 按钮文字（如「锻造」「炼丹」「对打」） */
    label?: string;
    /** 按钮图标（如「🔨」「🔥」「⚔」） */
    icon?: string;
    /** 提示语（可选，显示在按钮下方） */
    hint?: string;
  };
  /** 可重复触发（采集类 area_enter）：跳过「本次会话一次机会」防重入 */
  repeat?: boolean;
}

/** 事件文件（maps/<name>.events.json 顶层结构） */
export interface EventsFile {
  version: 1;
  map: string;
  /** ★ v6 AI 托管：地图级 AI 配置（可选）
   *  interval：按战斗等级分别指定的 AI 决策间隔（ms）
   *  maxManaged：本图最大托管角色数 */
  ai?: {
    interval?: { engaged?: number; skirmish?: number; idle?: number; all?: number };
    maxManaged?: number;
  };
  events: EventDef[];
}