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
}

/** 一个会话（单聊或群聊） */
export interface Conversation {
  id: string;                    // 会话唯一ID
  type: ConversationType;
  name: string;                  // 会话显示名（群名或对方角色名）
  avatar?: string;               // 群头像（可选）
  members: string[];            // 参与角色ID列表（玩家固定在其中）
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
