/**
 * sms/types.ts — 通信(短信) 类型定义
 * ============================================
 * 设计文档：md/curr_design/toonflow-field-survival/通信(短信)/通信(短信).design.md v2
 *
 * ★ 存储位置：t_plugin_session_data
 *     sessionId = "all"（跨会话共享）
 *     dataKey   = "sms_conversations:<story>"（按故事隔离，换故事不串号）
 */

/** 会话类型：单聊 / 群聊 */
export type ConversationType = "private" | "group";

/** 消息类型：普通文本 / 系统提示 */
export type MessageType = "text" | "system";

/** 一条消息 */
export interface Message {
  id: string;                    // 消息唯一ID（string，见 genId）
  conversationId: string;       // 所属会话ID（冗余，便于导出/清理）
  from: string;                  // 发送者ID："player" 或 角色ID
  fromName: string;              // 发送者显示名（冗余存储，避免查角色表）
  text: string;                  // 消息内容（≤ MAX_TEXT_LENGTH）
  timestamp: number;             // 发送时间戳
  type: MessageType;             // "text" 普通消息 / "system" 系统提示
  /**
   * ★ 2026-11-23 群聊编排：本轮回合**没有发言**的成员（type="system" 且带此字段时，
   * 渲染为「灰头像一排 + 沉默：A、B、C」，持久保留在消息流里）。
   */
  silent?: Array<{ roleId: string; roleName: string }>;
  /**
   * ★ 2026-11-23 打字机效果：true = 台词正在逐字上屏（气泡尾部显示光标）。
   * 落库 normalize 时强制 false（防刷新后永远打字中）。
   */
  streaming?: boolean;
}

/** 一个会话（单聊或群聊） */
export interface Conversation {
  id: string;                    // 会话唯一ID
  type: ConversationType;
  name: string;                  // 会话显示名（群名或对方角色名）
  avatar?: string;               // 群头像（可选）
  members: string[];            // 参与角色ID列表（玩家固定在其中）
  /**
   * ★ roleId → 显示名（2026-11-22 @点名功能）：建群时记录，供
   *   ① 输入框 @ 候选 ② 唤醒 AI 时解析「@名字」点名（点名必回）。
   *   旧会话/单聊没有此字段 → 回退：历史消息 fromName → 会话名（单聊）→ roleId。
   */
  memberNames?: Record<string, string>;
  /**
   * ★ 2026-11-22 群聊编排：已排好序、尚未在界面显示的发言队列。
   *   编排器一次产出「谁先说 + 各说什么」，这里逐条揭示 → 界面看着像一个个冒泡。
   *   pendingSpeaking[0] = 正在冒泡的那条；后面的 = 排队中（界面显示沉默头像）。
   */
  pendingSpeaking?: PendingSpeech[];
  /**
   * ★ 2026-11-23 沉默占位：编排器还在调 LLM（返回前）先显示
   *   「灰色头像 + 沉默：A、B、C」—— 玩家发完消息立刻有反馈，不再空屏等待。
   *   编排返回（成功入队 pendingSpeaking / 失败）即清除；不落库（刷新丢弃）。
   */
  silentPlaceholder?: { roleIds: string[]; roleNames: string[]; at: number };
  messages: Message[];           // 消息列表（按时间升序）
  lastReadMsgId: string | null;  // 玩家最后读到的消息ID（用于计算未读）
  createdAt: number;
  updatedAt: number;            // 最后一条消息时间（用于会话列表排序）
  /**
   * 玩家发的消息还没被 AI 回复（true）。
   * ★ 与「未读数」是两件事：
   *   - 未读数（getConvUnread）= AI 发来但玩家没读的条数
   *   - awaitingReply        = 玩家发了但 AI 还没回的（UI 上提示"等回复"）
   */
  awaitingReply?: boolean;
}

/** ★ 群聊编排：一条待显示的发言 */
export interface PendingSpeech {
  roleId: string;
  roleName: string;
  text: string;
  /** 入队时间（ms） */
  at: number;
}

/** 落库结构 */
export interface SmsStoreShape {
  conversations: Conversation[];
  /** 数据版本号，用于未来结构迁移 */
  version: number;
}

/** ★ AI 在决策 JSON 里返回的短信意图 */
export interface SMSMessageIntent {
  /** 短信正文 */
  text: string;
  /**
   * 收件目标：
   *   "player"           → 发到与该角色的单聊会话
   *   "group:<groupId>"  → 发到指定群聊会话
   */
  to: string;
}

/* ============================================================
   容量上限（防 t_plugin_session_data 单行 JSON 无限膨胀）
   ============================================================ */

export const SMS_LIMITS = {
  /** 单会话消息上限（超出丢弃最旧的） */
  MAX_MESSAGES: 100,
  /** 单条消息文本上限（超出截断） */
  MAX_TEXT_LENGTH: 500,
  /** 总会话上限（超出丢弃最久未活跃的） */
  MAX_CONVERSATIONS: 50,
  /** 落库体积上限（字节）—— 接近时先裁剪最旧会话 */
  MAX_STORE_BYTES: 256 * 1024,
  /** 单个 AI 角色发群消息的最小间隔（ms）—— 防刷屏 */
  GROUP_MSG_COOLDOWN_MS: 3 * 60 * 1000,
  /** 单个 AI 角色主动发单聊消息的最小间隔（ms）—— 防刷屏
   *  ★ 回复玩家未读消息（isReply=true）不受此限制 */
  PRIVATE_MSG_COOLDOWN_MS: 60 * 1000,
  /** 玩家短信触发 AI 回复的等待上限（ms）—— 超时放弃，等下一次心跳兜底 */
  REPLY_WAIT_MS: 25 * 1000,
  /** 玩家短信触发 AI 回复的重试间隔（ms）—— 闸门被占时稍后再试 */
  REPLY_RETRY_MS: 1500,
  /** 新消息落库防抖（ms） */
  SAVE_DEBOUNCE_MS: 1000,
  /** 阅读状态落库防抖（ms） */
  READ_SAVE_DEBOUNCE_MS: 500,
} as const;

/* ============================================================
   ★ 2026-11-22 群聊编排参数
   ============================================================ */

export const GROUP_SPEAK = {
  /** 追加发言概率（用户要求「机率调小于 40%」） */
  EXTRA_ROUND_P: 0.35,
  /** 最多追加几轮（总轮数 = 1 + 追加轮） */
  MAX_ROUNDS: 3,
  /** 单轮最多几个发言人 */
  MAX_SPEAKERS: 5,
  /**
   * ★ 发言节奏（2026-11-23 用户要求：一个人说完再到下个人，最小间隔 3 秒）。
   * 台词是打字机逐字上屏的（独立调用生成），两条发言之间的空闲间隔 ≥ 3s。
   */
  SPEAK_GAP_MS: 3000,
  /** 打字机：每次上屏字符数 / 间隔 ms（40 字 ≈ 2s，120 字 ≈ 6s） */
  TYPE_CHUNK: 2,
  TYPE_INTERVAL_MS: 50,
} as const;

/** 当前落库结构版本号 */
export const SMS_STORE_VERSION = 2;

/**
 * 生成唯一ID
 * ★ 用 string 不用自增 number：自增计数器在多标签页/多设备下会撞 ID，
 *   且与 lastReadMsgId: string 类型不统一。
 */
export function genId(prefix: "c" | "m"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 文本超长截断 */
export function clampText(text: string): string {
  const t = String(text ?? "");
  const limit = SMS_LIMITS.MAX_TEXT_LENGTH;
  return t.length <= limit ? t : t.slice(0, limit - 1) + "…";
}

/** 玩家 ID（约定值，非角色 ID） */
export const PLAYER_ID = "player";
/** 玩家显示名 */
export const PLAYER_NAME = "我";
