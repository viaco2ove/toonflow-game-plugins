/**
 * sms/store.ts — 通信(短信) 状态管理
 * ============================================
 * 设计文档：md/curr_design/toonflow-field-survival/通信(短信)/通信(短信).design.md v2
 *
 * 职责：
 *   1. 加载 / 保存（t_plugin_session_data，带 story 后缀）
 *   2. 新消息插入（AI 主动发 / 玩家发）
 *   3. 未读数计算（★ 排除玩家自己发的 + system 消息）
 *   4. 当前视图态（activeTab / activeConvId）—— App.vue 与 SystemPanel.vue 共读一份
 *
 * ★ 写入链路采用「全前端」方案（设计文档 §3.3）：
 *     App.vue 消费 decision.message → 本模块 receiveFromAI() → 防抖落库
 *   不用后端落库是为了避开 t_plugin_session_data 的写-读竞态（已知坑 #1）。
 */

import { reactive, computed } from "vue";
import { toonflowJsApi } from "../toonflowJsApi";
import {
  Conversation,
  Message,
  MessageType,
  PLAYER_ID,
  PLAYER_NAME,
  SMS_LIMITS,
  SMS_STORE_VERSION,
  SmsStoreShape,
  clampText,
  genId,
} from "./types";

/* ============================================================
   内部状态
   ============================================================ */

/** 会话列表（唯一数据源） */
const conversations = reactive<Conversation[]>([]);

/** 当前故事名（用于 dataKey 后缀） */
let currentStory = "";

/** 当前视图态 —— App.vue（系统按钮角标）与 SystemPanel.vue（tab 角标）共读 */
export const smsView = reactive({
  /** 系统面板当前 tab（"sms" 表示通信 tab 打开） */
  activeTab: "",
  /** 通信面板当前打开的会话 ID */
  activeConvId: "",
});

/** 加载状态 */
let loaded = false;
/** dataKey */
function dataKey(): string {
  return `sms_conversations:${currentStory || "default"}`;
}
/** 旧版（无 story 后缀）的 key —— 兼容读取 */
const LEGACY_KEY = "sms_conversations";

/** 落库定时器 */
let saveTimer: number | null = null;
let readSaveTimer: number | null = null;

/** 每个 AI 角色上次发群消息的时间（防刷屏） */
const lastGroupMsgAt = new Map<string, number>();
/** 每个 AI 角色上次发单聊消息的时间（防刷屏） */
const lastPrivateMsgAt = new Map<string, number>();

/**
 * ★ 玩家短信 → AI 回复目标表
 *   roleId → { convId, type }
 * 玩家在某个会话里发了消息且还没被回复时登记；
 * AI 决策完成后消费（清掉），避免重复回同一条。
 */
const pendingReplyTarget = new Map<string, { convId: string; type: "private" | "group" }>();

/* ============================================================
   未读数计算（设计文档 §4.2）
   ============================================================ */

/**
 * 单个会话的未读数
 * ★ 按条数 + 排除玩家自己发的 + 排除 system 类型
 */
export function getConvUnread(conv: Conversation): number {
  const startIdx = conv.lastReadMsgId
    ? conv.messages.findIndex((m) => m.id === conv.lastReadMsgId) + 1
    : 0;
  if (startIdx >= conv.messages.length) return 0;
  return conv.messages
    .slice(startIdx)
    .filter((m) => m.from !== PLAYER_ID && m.type !== "system")
    .length;
}

/** 总未读数 */
export function getTotalUnread(list?: Conversation[]): number {
  const arr = list || conversations;
  return arr.reduce((sum, c) => sum + getConvUnread(c), 0);
}

/** 响应式：总未读数 */
export const totalUnread = computed(() => getTotalUnread());

/**
 * AI 发消息时判断要不要标未读
 * 玩家正打开通信 tab 且正在看这个会话 → 视为已读。
 */
export function shouldMarkUnread(convId: string): boolean {
  return !(smsView.activeTab === "sms" && smsView.activeConvId === convId);
}

/* ============================================================
   内部工具
   ============================================================ */

/** 按 updatedAt 降序排（最新消息在最上面） */
function sortedConversations(): Conversation[] {
  return [...conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** 裁剪单个会话的消息条数（超出丢最旧的），并修正 lastReadMsgId */
function trimConvMessages(conv: Conversation): void {
  const max = SMS_LIMITS.MAX_MESSAGES;
  if (conv.messages.length <= max) return;
  const dropped = conv.messages.splice(0, conv.messages.length - max);
  // 被裁掉的消息里若含 lastReadMsgId 指向的那条 → 重置为 null
  if (conv.lastReadMsgId && dropped.some((m) => m.id === conv.lastReadMsgId)) {
    conv.lastReadMsgId = null;
  }
}

/** 裁剪会话总数（超出丢最久未活跃的） */
function trimConversations(): void {
  if (conversations.length <= SMS_LIMITS.MAX_CONVERSATIONS) return;
  const sorted = sortedConversations();
  const keep = new Set(
    sorted.slice(0, SMS_LIMITS.MAX_CONVERSATIONS).map((c) => c.id),
  );
  for (let i = conversations.length - 1; i >= 0; i--) {
    if (!keep.has(conversations[i].id)) conversations.splice(i, 1);
  }
}

/** 全部会话的消息总条数 */
function totalMessageCount(): number {
  return conversations.reduce((n, c) => n + c.messages.length, 0);
}

/** 当前 store 的落库体积（字节，近似） */
function storeBytes(): number {
  try {
    return JSON.stringify({ conversations, version: SMS_STORE_VERSION }).length;
  } catch {
    return 0;
  }
}

/** 体积超限时裁剪最旧的会话，直到落得下 */
function enforceSizeBudget(): void {
  if (storeBytes() <= SMS_LIMITS.MAX_STORE_BYTES) return;
  // 先丢最久未活跃的会话
  const sorted = sortedConversations();
  for (const conv of sorted.reverse()) {
    if (storeBytes() <= SMS_LIMITS.MAX_STORE_BYTES) break;
    const idx = conversations.findIndex((c) => c.id === conv.id);
    if (idx >= 0) conversations.splice(idx, 1);
  }
  // 还是超 → 每个会话只保最近 30 条
  if (storeBytes() > SMS_LIMITS.MAX_STORE_BYTES) {
    for (const conv of conversations) {
      if (conv.messages.length > 30) {
        const dropped = conv.messages.splice(0, conv.messages.length - 30);
        if (conv.lastReadMsgId && dropped.some((m) => m.id === conv.lastReadMsgId)) {
          conv.lastReadMsgId = null;
        }
      }
      if (storeBytes() <= SMS_LIMITS.MAX_STORE_BYTES) break;
    }
  }
}

/** 构造落库快照 */
function snapshot(): SmsStoreShape {
  return {
    conversations: JSON.parse(JSON.stringify(conversations)),
    version: SMS_STORE_VERSION,
  };
}

/* ============================================================
   落库
   ============================================================ */

/** 调度一次防抖落库 */
function scheduleSave(delay: number = SMS_LIMITS.SAVE_DEBOUNCE_MS): void {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void flushSave();
  }, delay);
}

/** 立即落库（退出游戏 / 切图时调用） */
export async function flushSave(): Promise<void> {
  if (saveTimer != null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (readSaveTimer != null) {
    window.clearTimeout(readSaveTimer);
    readSaveTimer = null;
  }
  if (!currentStory) return;
  enforceSizeBudget();
  try {
    await toonflowJsApi.pluginData.set(dataKey(), snapshot(), "all");
  } catch (e) {
    // ★ 落库失败不阻断玩法
    console.warn("[sms] 落库失败:", e);
  }
}

/* ============================================================
   加载
   ============================================================ */

/**
 * 加载短信数据
 * @param story 故事名（宿主注入的 state.worldName）—— 用于 dataKey 隔离
 */
export async function load(story: string): Promise<void> {
  currentStory = String(story || "").trim();
  conversations.length = 0;
  loaded = false;

  try {
    let raw: any = null;
    try {
      raw = await toonflowJsApi.pluginData.get(dataKey(), "all");
    } catch {
      raw = null;
    }

    // ★ 兼容老存档：带 story 后缀的 key 不存在 → 回退读裸 key 并迁移
    if (!raw) {
      try {
        const legacy = await toonflowJsApi.pluginData.get(LEGACY_KEY, "all");
        if (legacy) {
          raw = legacy;
          console.info("[sms] 迁移旧存档 sms_conversations →", dataKey());
          scheduleSave(0);
        }
      } catch {
        /* ignore */
      }
    }

    if (raw) {
      const obj = typeof raw === "string" ? safeParse(raw) : raw;
      if (obj && Array.isArray(obj.conversations)) {
        for (const c of obj.conversations) {
          if (!c || typeof c !== "object") continue;
          conversations.push(normalizeConv(c));
        }
        const merged = mergeLegacyDuplicatePrivates();
        console.info(
          `[sms] 加载 ${conversations.length} 个会话（${dataKey()}）` +
            (merged ? `，归并 ${merged} 个重复单聊` : ""),
        );
      }
    }
  } catch (e) {
    console.warn("[sms] 加载失败，使用空数据:", e);
  }

  loaded = true;
}

/** 安全 JSON 解析 */
function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * ★ 归并历史遗留的重复会话（2026-11-02 扩展到群聊）。
 *  - 单聊：同名（roleId 跨会话不稳定导致的「一屏同名会话」）；
 *  - 群聊：**成员集合相同**（用户重复点「创建」/ 双击提交会建出 N 个同成员群，
 *    列表里一屏同名「宗门」就是这种——预览/时间完全一致）。
 * 策略：保留消息最多的那个，其余的消息按时间并入后删除。
 * 返回归并掉的数量（0 = 没有脏数据）。
 */
function mergeLegacyDuplicatePrivates(): number {
  const groups = new Map<string, Conversation[]>();
  for (const c of conversations) {
    // 单聊按名字归并；群聊按成员集合归并（排序后的 members join，与顺序无关）
    const key = c.type === "private"
      ? `p:${c.name}`
      : `g:${[...c.members].sort().join("|")}`;
    const arr = groups.get(key) || [];
    arr.push(c);
    groups.set(key, arr);
  }

  let removed = 0;
  for (const [, arr] of groups) {
    if (arr.length < 2) continue;
    // 保留消息最多的（并列取 updatedAt 最新的）
    arr.sort((a, b) =>
      b.messages.length - a.messages.length || b.updatedAt - a.updatedAt,
    );
    const keep = arr[0];
    for (const dup of arr.slice(1)) {
      // 并入消息（按 id 去重，保持时间升序）
      const have = new Set(keep.messages.map((m) => m.id));
      for (const m of dup.messages) {
        if (have.has(m.id)) continue;
        keep.messages.push(m);
      }
      // ★ fix(2026-11-02)：字段名是 timestamp 不是 ts —— 旧写法 a.ts 全 undefined，
      //   相减得 NaN，排序静默失效（消息顺序乱）。
      keep.messages.sort((a, b) => a.timestamp - b.timestamp);
      if (dup.updatedAt > keep.updatedAt) keep.updatedAt = dup.updatedAt;
      const idx = conversations.indexOf(dup);
      if (idx >= 0) {
        conversations.splice(idx, 1);
        removed++;
      }
    }
  }
  if (removed) scheduleSave();
  return removed;
}

/** 规范化一个会话（防御脏数据） */
function normalizeConv(raw: any): Conversation {
  const msgs: Message[] = Array.isArray(raw.messages) ? raw.messages : [];
  const conv: Conversation = {
    id: String(raw.id || genId("c")),
    type: raw.type === "group" ? "group" : "private",
    name: String(raw.name || "未命名"),
    avatar: raw.avatar ? String(raw.avatar) : undefined,
    members: Array.isArray(raw.members) ? raw.members.map(String) : [],
    messages: msgs
      .filter((m: any) => m && typeof m === "object")
      .map((m: any): Message => ({
        id: String(m.id || genId("m")),
        conversationId: String(m.conversationId || raw.id || ""),
        from: String(m.from || PLAYER_ID),
        fromName: String(m.fromName || ""),
        text: clampText(String(m.text || "")),
        timestamp: Number(m.timestamp) || Date.now(),
        type: m.type === "system" ? "system" : "text",
      })),
    lastReadMsgId: raw.lastReadMsgId ? String(raw.lastReadMsgId) : null,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    awaitingReply: !!raw.awaitingReply,
  };
  trimConvMessages(conv);
  return conv;
}

/* ============================================================
   会话操作
   ============================================================ */

/** 按 id 找会话 */
export function findConversation(id: string): Conversation | undefined {
  return conversations.find((c) => c.id === id);
}

/**
 * 确保某个角色与玩家的单聊会话存在（不存在则创建）
 * ★ 消息驱动创建：AI 第一次真的要发消息时才建会话，
 *   避免玩家反复开关 AI 托管攒出一堆空会话（设计文档 §7.2）。
 */
export function ensurePrivateConversation(roleId: string, roleName: string): Conversation {
  const existing = conversations.find(
    (c) => c.type === "private" && c.members.includes(roleId),
  );
  if (existing) return existing;

  // ★ 同名归并：npc 的 roleId（npc_3 等）每次重进游戏会重新编号，
  //   按 id 去重会导致「同一个角色每天一个新会话」（实测攒出一屏陈南璇）。
  //   单聊的名字即角色名 → 按「同 type + 同名 + 非玩家成员同名」归并，
  //   并把老会话的成员 id 迁移到当前 roleId（保持后续回复路由一致）。
  const byName = conversations.find(
    (c) =>
      c.type === "private" &&
      c.name === (roleName || roleId) &&
      c.members.length === 1 &&
      c.members[0] !== PLAYER_ID,
  );
  if (byName) {
    byName.members = [roleId];
    scheduleSave();
    return byName;
  }

  const now = Date.now();
  const conv: Conversation = {
    id: genId("c"),
    type: "private",
    name: roleName || roleId,
    members: [roleId],
    messages: [],
    lastReadMsgId: null,
    createdAt: now,
    updatedAt: now,
  };
  conversations.push(conv);
  trimConversations();
  scheduleSave();
  return conv;
}

/**
 * ★ 玩家主动发起单聊（从通讯录点人时用）
 *
 * 与 `ensurePrivateConversation` 的区别：
 *   - ensurePrivateConversation：AI 主动发消息时被动创建（消息驱动）
 *   - startPrivateChat：玩家在通讯录里点某人 → 主动建会话（此时还没有任何消息）
 *
 * ★ 为什么要主动建：玩家点了某人，右边必须立刻有个聊天窗口可打字。
 *   如果等 AI 先发消息才建会话，玩家点完看到的是空的右半屏 → 不知道能干什么。
 */
export function startPrivateChat(roleId: string, roleName: string): Conversation {
  const conv = ensurePrivateConversation(roleId, roleName);
  // ★ 置顶到最前（updatedAt 提到最新）—— 新建的会话应该在列表最上面
  conv.updatedAt = Date.now();
  scheduleSave();
  return conv;
}

/** 创建群聊 */
export function createGroupConversation(
  name: string,
  memberIds: string[],
  memberNames: Record<string, string> = {},
): Conversation {
  // ★ 同成员集合的群直接复用（2026-11-02）：微信同款语义——同样的几个人再"建群"
  //   不会建出第二个群。防的是双击提交 / 事件重放把列表刷成一屏同名群。
  const fingerprint = [...new Set(memberIds)].sort().join("|");
  const existing = conversations.find(
    (c) => c.type === "group" && [...c.members].sort().join("|") === fingerprint,
  );
  if (existing) {
    // 名字不为空时顺带采纳新名（用户重进弹窗往往就是想改名）
    if (name && name.trim() && existing.name !== name.trim()) {
      existing.name = name.trim().slice(0, 30);
    }
    existing.updatedAt = Date.now();
    scheduleSave();
    return existing;
  }

  const now = Date.now();
  const conv: Conversation = {
    id: genId("c"),
    type: "group",
    name: name || "新群聊",
    members: [...new Set(memberIds)],
    messages: [],
    lastReadMsgId: null,
    createdAt: now,
    updatedAt: now,
  };
  conversations.push(conv);

  // ★ system 消息：不计入未读
  for (const mid of conv.members) {
    appendMessage(conv, {
      from: "system",
      fromName: "系统",
      text: `${memberNames[mid] || mid} 加入了群聊`,
      type: "system",
    });
  }
  trimConversations();
  scheduleSave();
  return conv;
}

/** 追加一条消息到会话 */
function appendMessage(
  conv: Conversation,
  input: {
    from: string;
    fromName: string;
    text: string;
    type?: MessageType;
  },
): Message {
  const msg: Message = {
    id: genId("m"),
    conversationId: conv.id,
    from: input.from,
    fromName: input.fromName,
    text: clampText(input.text),
    timestamp: Date.now(),
    type: input.type || "text",
  };
  conv.messages.push(msg);
  conv.updatedAt = msg.timestamp;

  // ★ 玩家发消息 → 自动清零该会话未读（lastReadMsgId 推到该条）
  if (msg.from === PLAYER_ID) {
    conv.lastReadMsgId = msg.id;
  }

  // ★ awaitingReply 是「派生状态」→ 每次改完消息都重算
  //   （手动 toggle 会在多条消息交错时算错）
  refreshAwaitingReply(conv);

  trimConvMessages(conv);
  return msg;
}

/**
 * 重算会话的 awaitingReply（玩家发了但 AI 还没回）
 */
function refreshAwaitingReply(conv: Conversation): void {
  conv.awaitingReply = findUnrepliedPlayerMsgs(conv).length > 0;
}

/* ============================================================
   收 / 发消息
   ============================================================ */

/**
 * AI 主动发短信
 * @param roleId 发送者角色ID
 * @param roleName 发送者名字
 * @param to "player" | "group:<groupId>"
 * @param text 正文
 * @param isReply 是否为「回复玩家未读消息」（回复不受频率冷却限制）
 */
export function receiveFromAI(
  roleId: string,
  roleName: string,
  to: string,
  text: string,
  isReply = false,
): Message | null {
  const body = clampText(text);
  if (!body) return null;

  let conv: Conversation | undefined;

  if (to === PLAYER_ID || !to) {
    // ★ 先判冷却、再建会话
    //   否则"被冷却挡掉"却把空会话建出来了 → 玩家会话列表多出一堆空会话。
    const last = lastPrivateMsgAt.get(roleId) || 0;
    if (!isReply && Date.now() - last < SMS_LIMITS.PRIVATE_MSG_COOLDOWN_MS) {
      console.info(`[sms] ${roleName} 单聊冷却中，丢弃`);
      return null;
    }
    conv = ensurePrivateConversation(roleId, roleName);
    // ★ 回复也刷新计时 —— 避免"刚回完，玩家还没看到，紧接着又主动发一条"
    lastPrivateMsgAt.set(roleId, Date.now());
  } else if (to.startsWith("group:")) {
    const gid = to.slice("group:".length);
    conv = findConversation(gid);
    if (!conv) {
      console.warn("[sms] 群聊不存在，丢弃短信:", gid);
      return null;
    }
    // ★ 群消息频率限制：同一角色 3 分钟内最多发 1 条群消息
    const last = lastGroupMsgAt.get(roleId) || 0;
    if (Date.now() - last < SMS_LIMITS.GROUP_MSG_COOLDOWN_MS) {
      console.info(`[sms] ${roleName} 群消息冷却中，丢弃`);
      return null;
    }
    lastGroupMsgAt.set(roleId, Date.now());
  } else {
    console.warn("[sms] 未知的收件目标:", to);
    return null;
  }

  const msg = appendMessage(conv, {
    from: roleId,
    fromName: roleName,
    text: body,
    type: "text",
  });

  // 玩家正在看这个会话 → 视为已读，直接推 lastReadMsgId
  if (!shouldMarkUnread(conv.id)) {
    conv.lastReadMsgId = msg.id;
  }

  // ★ AI 已回应 → 清掉该角色的待回复登记
  if (isReply) {
    pendingReplyTarget.delete(roleId);
  }

  // ★ 无论是不是"回复模式"，只要这个角色在这个会话里说了话，
  //   玩家那条消息就算被回应了 → 清掉登记。
  //   否则：AI 主动发了条无关的话，登记还留着 → 下次心跳又被当成"还没回"，
  //   AI 会重复回复同一条玩家消息。
  if (!isReply) {
    const pending = pendingReplyTarget.get(roleId);
    if (pending && pending.convId === conv.id) {
      pendingReplyTarget.delete(roleId);
    }
  }

  scheduleSave();
  return msg;
}

/**
 * 玩家发消息
 * @param convId 目标会话
 * @param text 正文
 * @returns 实际发出的消息（失败返回 null）
 */
export function sendPlayerMessage(convId: string, text: string): Message | null {
  const conv = findConversation(convId);
  if (!conv) return null;
  const body = clampText(text);
  if (!body) return null;

  const msg = appendMessage(conv, {
    from: PLAYER_ID,
    fromName: PLAYER_NAME,
    text: body,
    type: "text",
  });

  // ★ 登记「待回复目标」：会话里的 AI 成员都要被唤醒去回这条消息
  for (const mid of conv.members) {
    if (mid === PLAYER_ID) continue;
    pendingReplyTarget.set(mid, { convId: conv.id, type: conv.type });
  }

  scheduleSave();
  return msg;
}

/**
 * 取某角色的待回复目标（App.vue 唤醒 AI 时用）
 */
export function getPendingReplyTarget(roleId: string): { convId: string; type: "private" | "group" } | undefined {
  return pendingReplyTarget.get(roleId);
}

/**
 * 某角色是否有待回复的玩家消息（AI 决策时用来判断是否必须回）
 */
export function hasPendingReply(roleId: string): boolean {
  return pendingReplyTarget.has(roleId);
}

/**
 * ★ 列出所有有待回复登记的角色ID（AI 心跳兜底扫描用：
 *   玩家发短信时角色还没开托管 → 开托管后由 tickAllAIs 扫到并补回）
 */
export function listPendingReplyRoleIds(): string[] {
  return [...pendingReplyTarget.keys()];
}

/**
 * 清掉某角色的待回复登记（AI 已回 / 超时放弃）
 */
export function clearPendingReply(roleId: string): void {
  pendingReplyTarget.delete(roleId);
}

/**
 * 标记会话已读（把 lastReadMsgId 推到最后一条）
 */
export function markRead(convId: string): void {
  const conv = findConversation(convId);
  if (!conv) return;
  const last = conv.messages[conv.messages.length - 1];
  if (!last) return;
  if (conv.lastReadMsgId === last.id) return;
  conv.lastReadMsgId = last.id;

  if (readSaveTimer != null) window.clearTimeout(readSaveTimer);
  readSaveTimer = window.setTimeout(() => {
    readSaveTimer = null;
    void flushSave();
  }, SMS_LIMITS.READ_SAVE_DEBOUNCE_MS);
}

/** 设置当前打开的会话（进会话即清未读） */
export function setActiveConversation(convId: string): void {
  smsView.activeConvId = convId;
  if (convId) markRead(convId);
}

/** 删除会话 */
export function removeConversation(convId: string): void {
  const idx = conversations.findIndex((c) => c.id === convId);
  if (idx < 0) return;
  const conv = conversations[idx];
  conversations.splice(idx, 1);
  if (smsView.activeConvId === convId) smsView.activeConvId = "";
  // 清理该会话相关的待回复登记
  for (const [roleId, t] of pendingReplyTarget.entries()) {
    if (t.convId === convId) pendingReplyTarget.delete(roleId);
  }
  void conv;
  scheduleSave();
}

/** 群聊改名 */
export function renameConversation(convId: string, name: string): void {
  const conv = findConversation(convId);
  if (!conv || !name.trim()) return;
  conv.name = name.trim().slice(0, 30);
  conv.updatedAt = Date.now();
  scheduleSave();
}

/**
 * 群聊加/减成员（追加一条 system 消息）
 * @param add true=加入，false=移出
 */
export function setMemberInGroup(
  convId: string,
  memberId: string,
  memberName: string,
  add: boolean,
): void {
  const conv = findConversation(convId);
  if (!conv || conv.type !== "group") return;
  const has = conv.members.includes(memberId);
  if (add && has) return;
  if (!add && !has) return;

  if (add) {
    conv.members.push(memberId);
    appendMessage(conv, {
      from: "system",
      fromName: "系统",
      text: `${memberName || memberId} 加入了群聊`,
      type: "system",
    });
  } else {
    conv.members = conv.members.filter((m) => m !== memberId);
    appendMessage(conv, {
      from: "system",
      fromName: "系统",
      text: `${memberName || memberId} 退出了群聊`,
      type: "system",
    });
  }
  scheduleSave();
}

/* ============================================================
   给 AI 大脑用的上下文（设计文档 §6.2）
   ============================================================ */

/**
 * 找出会话里「玩家发的、之后没有任何 AI 回复」的**所有**消息。
 *
 * ★ 为什么不是只看最后一条：
 *   玩家可能连发 3 条（"药圃在哪" / "东边？" / "有人吗"），
 *   AI 一条都没回。只标最后一条的话，AI 不知道前面两条也被无视了。
 *   全部标 ★ → AI 明确知道"这 3 条都欠着回复"。
 *
 * ★ 实现：等价于「最后一条 AI 消息之后的所有玩家消息」
 *   —— 只要之后有过任意一条 AI 消息（system 不算回复），
 *      之前的所有玩家消息都算"已被回复"。
 *   O(n) 扫描，prompt 构建时每次都会调，不能用 O(n²)。
 *
 * @param conv 会话
 * @param fromIdx 只检查这个下标之后的消息（用于"最近 N 条"截断场景）
 */
function findUnrepliedPlayerMsgs(conv: Conversation, fromIdx = 0): Message[] {
  const msgs = conv.messages;
  // 找最后一条「真正的回复」（非 system）
  let lastReplyIdx = -1;
  for (let i = msgs.length - 1; i >= fromIdx; i--) {
    const m = msgs[i];
    if (m.from !== PLAYER_ID && m.type !== "system") {
      lastReplyIdx = i;
      break;
    }
  }
  // 之后的所有玩家消息都还没被回
  const out: Message[] = [];
  for (let i = Math.max(fromIdx, lastReplyIdx + 1); i < msgs.length; i++) {
    if (msgs[i].from === PLAYER_ID) out.push(msgs[i]);
  }
  return out;
}

/**
 * 构建「短信往来」上下文段，注入 AI 的 User Prompt。
 * ★ 单聊和群聊都要注入 —— 否则玩家在单聊里发的消息 AI 根本看不到（设计文档 H1）。
 *
 * @param entityId 当前 AI 角色 ID（用于筛选与该角色相关的会话）
 * @param limit 最多取几个会话、每个会话几条
 */
export function buildSmsContext(entityId: string, limit = 3, perConv = 6): string {
  const related = sortedConversations()
    .filter((c) => c.type === "group" || c.members.includes(entityId))
    .slice(0, limit);
  if (!related.length) return "";

  const lines: string[] = [];
  let starCount = 0;
  /** 供 AI 填写 message.to 的合法取值 */
  const targets: string[] = [];

  for (const conv of related) {
    const startIdx = Math.max(0, conv.messages.length - perConv);
    const recent = conv.messages.slice(startIdx);
    if (!recent.length) continue;
    // 群聊标签带上会话ID —— AI 需要它来填 message.to = "group:<id>"
    const tag =
      conv.type === "group"
        ? `群聊·${conv.name}（会话ID=${conv.id}）`
        : `单聊·${conv.name}`;
    // ★ 只统计「落在截断窗口内」的未回复消息，否则会出现
    //   "★ 的那条消息被截掉了，AI 却收到契约要求回复"的错位。
    const unreplied = findUnrepliedPlayerMsgs(conv, startIdx);
    const unrepliedIds = new Set(unreplied.map((m) => m.id));

    for (const m of recent) {
      const who = m.from === PLAYER_ID ? "玩家" : m.fromName || m.from;
      const star = unrepliedIds.has(m.id) ? " ★" : "";
      if (star) starCount++;
      lines.push(`- [${tag}] ${who}${star}: ${m.text}`);
    }

    if (conv.type === "group") targets.push(`group:${conv.id}`);
    else targets.push("player");
  }
  if (!lines.length) return "";

  const parts = [
    "### 短信往来（最近几条，★ 表示玩家的消息还没被回复）",
    ...lines,
  ];

  if (starCount > 0) {
    parts.push(
      "★ 你在上面的「短信往来」里看到了玩家还没被回复的消息，" +
        "你必须在本次回复里给出 message.text 来回应它。",
      "如果你已经回复过该消息（没有 ★ 标记），则不要再发重复的 message。",
      `message.to 只能取：${[...new Set(targets)].join(" 或 ")}。`,
    );
  } else {
    parts.push(
      "如果需要给玩家发短信，在回复的 JSON 里加 message 字段（可选）。",
      `message.to 只能取：${[...new Set(targets)].join(" 或 ")}。`,
    );
  }

  return parts.join("\n");
}

/* ============================================================
   对外读取
   ============================================================ */

/** 会话列表（按 updatedAt 降序） */
export function listConversations(): Conversation[] {
  return sortedConversations();
}

/** 某会话里"玩家还有未读回复"（用于 UI 提示） */
export function hasUnreadReply(convId: string): boolean {
  const conv = findConversation(convId);
  if (!conv) return false;
  return !!conv.awaitingReply;
}

/** 是否已加载 */
export function isLoaded(): boolean {
  return loaded;
}

/** 当前 story（诊断用） */
export function currentStoryName(): string {
  return currentStory;
}

/** 统计信息（诊断用） */
export function debugSms(): {
  story: string;
  conversations: number;
  messages: number;
  unread: number;
  bytes: number;
  loaded: boolean;
} {
  return {
    story: currentStory,
    conversations: conversations.length,
    messages: totalMessageCount(),
    unread: getTotalUnread(),
    bytes: storeBytes(),
    loaded,
  };
}

/** ★ 测试/调试用：重置全部状态 */
export function __resetForTest(): void {
  conversations.length = 0;
  currentStory = "";
  loaded = false;
  lastGroupMsgAt.clear();
  lastPrivateMsgAt.clear();
  pendingReplyTarget.clear();
  if (saveTimer != null) { window.clearTimeout(saveTimer); saveTimer = null; }
  if (readSaveTimer != null) { window.clearTimeout(readSaveTimer); readSaveTimer = null; }
}
