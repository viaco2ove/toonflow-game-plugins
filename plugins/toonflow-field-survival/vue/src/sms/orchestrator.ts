/**
 * sms/orchestrator.ts — 群聊编排器（插件前端侧）
 * =================================================
 * ★ 2026-11-22 用户需求：
 *   「用户发言后 → 群聊编排器 agent → 那些人发言，发言顺序 → 界面先显示沉默的角色头像
 *     → 发言人逐个发言 → 触发追加发言（随机，机率小于 40%）→ 群聊编排器 agent → ……
 *     @角色名：这个角色先发言 → 触发追加发言（随机，机率小于 40%）→ 群聊编排器 agent → …」
 *
 * ★ 流程（本文件负责编排与展示，后端只负责「按给定 prompt 调一次模型」）：
 *   1. 调后端 sys_group_chat 一次 → 拿到有序 speakers（谁先说 + 各说什么）
 *   2. 全部入队 pendingSpeaking → 界面立刻显示「沉默的角色头像 + 正在输入…」
 *   3. 每 900ms 揭示一条 → 消息一个个冒泡
 *   4. 一轮结束后掷骰（<35%）→ 带新上下文再跑一轮，最多 3 轮
 *   5. @点名 → 被点名者排第一（后端编排器已保证，这里再兜一层）
 */

import { sendTick } from "../bridge";
import { GROUP_SPEAK } from "./types";
import {
  clearSilentPlaceholder,
  findConversation,
  groupHistoryText,
  listConversations,
  memberNameOf,
  mentionedRoleIdsOf,
  setSilentPlaceholder,
} from "./store";

/** 群成员卡片（喂给编排器的角色身份信息） */
export interface GroupMemberCard {
  id: string;
  name: string;
  description?: string;
  level?: number;
  personality?: string;
}

/** 角色信息来源（App.vue 传：npcCards / entities / roles） */
export interface RoleInfoSource {
  npcCards?: any[];
  entities?: any[];
  roles?: any[];
}

/** 从游戏状态里挖出某个 id 的角色卡（名字 / 简介 / 等级 / 性格） */
export function buildMemberCard(
  roleId: string,
  conv: { memberNames?: Record<string, string> },
  src: RoleInfoSource,
): GroupMemberCard {
  const fallbackName = conv.memberNames?.[roleId] || memberNameOf(conv as any, roleId) || roleId;
  const card: GroupMemberCard = { id: roleId, name: fallbackName };

  const npc = (src.npcCards || []).find((c: any) => String(c?.id) === roleId);
  const ent = (src.entities || []).find((e: any) => String(e?.id) === roleId);
  const role = (src.roles || []).find((r: any) => String(r?.id) === roleId);

  const desc = String(
    npc?.description || npc?.desc || ent?.desc || ent?.dialog || role?.description || "",
  ).slice(0, 200);
  if (desc) card.description = desc;

  const lv = Number(npc?.level ?? ent?.level ?? role?.level ?? role?.initial_level ?? 0);
  if (lv > 0) card.level = lv;

  const persona = String(
    npc?.personality || ent?.personality || role?.personality || "",
  ).slice(0, 120);
  if (persona) card.personality = persona;

  if (card.name === roleId) {
    const real = String(npc?.name || ent?.name || role?.name || "");
    if (real) card.name = real;
  }
  return card;
}

/**
 * ★ 调后端编排器（一次）：只返回**有序发言人 id 名单**。
 * 台词不在这里生成 —— 由 streamGroupSpeech 对每个 id 独立调用（个性不雷同的关键）。
 */
async function callOrchestrator(params: {
  members: GroupMemberCard[];
  playerText: string;
  history: string;
  mentionedRoleIds: string[];
  maxSpeakers: number;
}): Promise<{ ok: boolean; speakerIds: string[]; error?: string }> {
  const reqId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  sendTick("sys_group_chat", {
    reqId,
    members: params.members,
    playerText: params.playerText,
    history: params.history,
    mentionedRoleIds: params.mentionedRoleIds,
    maxSpeakers: params.maxSpeakers,
  });
  const res = await waitGroupResult(reqId);
  if (!res?.ok) {
    return { ok: false, speakerIds: [], error: String(res?.error || "群聊编排失败") };
  }
  const speakerIds = Array.isArray(res.speakers) ? res.speakers.map((x: any) => String(x)) : [];
  return { ok: true, speakerIds };
}

/** 等待 groupResult（App.vue 注入，避免循环依赖） */
let groupResultWaiter: ((reqId: string, timeoutMs?: number) => Promise<any>) | null = null;
export function registerGroupResultWaiter(
  fn: (reqId: string, timeoutMs?: number) => Promise<any>,
): void {
  groupResultWaiter = fn;
}
function waitGroupResult(reqId: string, timeoutMs = 30000): Promise<any> {
  if (!groupResultWaiter) return Promise.resolve({ ok: false, error: "群聊通道未就绪" });
  return groupResultWaiter(reqId, timeoutMs);
}

/* ============================================================
   编排主流程
   ============================================================ */

/** 正在跑的编排（按会话 id 去重，避免连点重复触发） */
const running = new Set<string>();

/**
 * ★ 跑一轮群聊编排（含追加轮）。流程 = 用户文档 2026-11-23 版：
 *   编排器（一次，只定名单）→ 界面显示沉默者头像行 → 发言人**逐个独立**调发言接口
 *   （打字机逐字上屏，一条说完 ≥3s 再到下一条）→ 掷骰 <35% 触发追加轮。
 */
export async function runGroupOrchestration(
  convId: string,
  playerText: string,
  src: RoleInfoSource,
): Promise<void> {
  if (running.has(convId)) {
    console.info("[sms][编排] 该会话已有编排在跑 → 跳过");
    return;
  }
  const conv = findConversation(convId);
  if (!conv || conv.type !== "group") return;

  running.add(convId);
  try {
    const mentioned = mentionedRoleIdsOf(conv, playerText);
    const aiMembers = conv.members.filter((m) => m !== "player");
    if (!aiMembers.length) return;

    const cards = aiMembers.map((id) => buildMemberCard(id, conv, src));

    let round = 0;
    let lastPlayerText = playerText;

    while (round < GROUP_SPEAK.MAX_ROUNDS) {
      round++;
      // 思考中占位（编排 LLM 期间，10~25s）—— 文案是「思考中」，沉默另有其义
      setSilentPlaceholder(
        convId,
        aiMembers.map((id) => ({ roleId: id, roleName: buildMemberCard(id, conv, src).name })),
      );
      const res = await callOrchestrator({
        members: cards,
        playerText: lastPlayerText,
        history: groupHistoryText(convId, 8),
        mentionedRoleIds: mentioned,
        maxSpeakers: GROUP_SPEAK.MAX_SPEAKERS,
      }).finally(() => clearSilentPlaceholder(convId));
      if (!res.ok) {
        console.warn("[sms][编排] 第", round, "轮失败：", res.error);
        break;
      }
      const speakerIds = res.speakerIds;
      if (!speakerIds.length) {
        console.info("[sms][编排] 第", round, "轮无人发言 → 结束");
        break;
      }

      // ★ 先显示沉默者（用户文档：界面**先**显示沉默的角色头像 → 发言人逐个发言）。
      //   沉默 = 本轮没被编排到的人；持久落库。
      const spokeSet = new Set(speakerIds);
      // ★ 显示名用角色卡真名（memberNameOf 只认 memberNames/历史消息，旧群没记录的成员
      //   会退化成 npc_x —— buildMemberCard 能从 npcCards/entities/roles 挖到真名）
      const silentNow = aiMembers
        .filter((id) => !spokeSet.has(id))
        .map((id) => ({ roleId: id, roleName: buildMemberCard(id, conv, src).name }));
      if (silentNow.length) {
        const { appendSilentMessage } = await import("./store");
        appendSilentMessage(convId, silentNow);
      }

      // ★ 发言人逐个**独立**调发言接口（打字机逐字上屏）。
      //   每次都带最新群历史 → 后发言的人能看到前面人刚说的话，接得住。
      for (let i = 0; i < speakerIds.length; i++) {
        const rid = speakerIds[i];
        if (i > 0) await sleep(GROUP_SPEAK.SPEAK_GAP_MS); // 一人说完 ≥3s 再到下一个
        await streamGroupSpeech(convId, rid, playerText, src, lastPlayerText);
      }

      // ★ 追加发言：概率 < 40%
      if (round >= GROUP_SPEAK.MAX_ROUNDS) break;
      if (Math.random() >= GROUP_SPEAK.EXTRA_ROUND_P) break;
      console.info(`[sms][编排] 第 ${round} 轮结束 → 触发追加发言（第 ${round + 1} 轮）`);
      lastPlayerText = "（继续刚才的话题，有谁要接话吗？）";
    }
  } catch (e) {
    console.warn("[sms][编排] 异常：", e);
  } finally {
    running.delete(convId);
  }
}

/**
 * ★ 单个角色独立发言 + 打字机效果：
 *   调 sys_sms_speak（插件 speakAsCharacter，storyOrchestratorModel）拿完整台词，
 *   然后逐字上屏（streaming 消息 + 光标），完全模拟真人打字节奏。
 */
async function streamGroupSpeech(
  convId: string,
  roleId: string,
  playerText: string,
  src: RoleInfoSource,
  roundLeadText: string,
): Promise<void> {
  const conv = findConversation(convId);
  if (!conv) return;
  // ★ 显示名用角色卡真名（同沉默行：memberNameOf 对无记录成员会退化成 npc_x）
  const roleName = buildMemberCard(roleId, conv, src).name;
  const reqId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  sendTick("sys_sms_speak", {
    reqId,
    roleId,
    roleName,
    roleCard: buildRoleCardText(roleId, src),
    playerText: roundLeadText,
    history: groupHistoryText(convId, 8),
  });
  const res = await waitGroupResult(reqId);
  const text = String(res?.text || "").trim();
  if (!res?.ok || !text) {
    console.warn(`[sms][群聊发言] ${roleName} 生成失败，跳过：`, res?.error);
    return;
  }
  // 打字机：创建空消息 → 逐字填充 → 结束落库
  const { beginStreamingMessage, appendToStreamingMessage, endStreamingMessage } = await import("./store");
  const msg = beginStreamingMessage(convId, roleId, roleName);
  if (!msg) return;
  for (let i = 0; i < text.length; i += GROUP_SPEAK.TYPE_CHUNK) {
    appendToStreamingMessage(convId, msg.id, text.slice(i, i + GROUP_SPEAK.TYPE_CHUNK));
    await sleep(GROUP_SPEAK.TYPE_INTERVAL_MS);
  }
  endStreamingMessage(convId, msg.id);
  console.info(`[sms][群聊发言] ${roleName}: ${text.slice(0, 40)}…`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ============================================================
   ★ 2026-11-23 单聊角色发言（对齐宿主故事模式台词质量）
   ------------------------------------------------------------
   旧链路（brain 决策 JSON 的 message 字段）只产出游戏状态复读
   （"目前各方都未交战，我正去食堂补给区待命"）—— 感知 prompt 里
   没有故事背景，模型只能复读 HP/敌人/位置。
   新链路：sys_sms_speak → 插件 speakAsCharacter（storyOrchestratorModel
   + 角色卡 + 故事全局/动态背景 + 世界书 + 短信往来）→ 一段带动作描写的台词。
   ============================================================ */

/** 某角色的完整人设文本（角色卡 + 参数卡里能挖到的都拼上） */
function buildRoleCardText(roleId: string, src: RoleInfoSource): string {
  const npc = (src.npcCards || []).find((c: any) => String(c?.id) === roleId);
  const ent = (src.entities || []).find((e: any) => String(e?.id) === roleId);
  const role = (src.roles || []).find((r: any) => String(r?.id) === roleId);
  const parts: string[] = [];
  const desc = String(
    npc?.description || npc?.desc || role?.description || ent?.desc || ent?.dialog || "",
  ).trim();
  if (desc) parts.push(`简介：${desc.slice(0, 600)}`);
  const card = role?.parameterCardJson || npc?.parameterCardJson;
  if (card && typeof card === "object") {
    const c = card as Record<string, any>;
    const persona = String(c.personality || c.persona || c.background || c.intro || "").trim();
    if (persona) parts.push(`人设：${persona.slice(0, 400)}`);
    const style = String(c.speakStyle || c.speechStyle || c.tone || "").trim();
    if (style) parts.push(`说话风格：${style.slice(0, 200)}`);
  }
  const lv = Number(npc?.level ?? role?.level ?? role?.initial_level ?? ent?.level ?? 0);
  if (lv > 0) parts.push(`等级：Lv.${lv}`);
  return parts.join("\n");
}

/** 单聊的短信往来（含 ★ 未回复标记的语义交给模型自行理解，这里按时间格式化） */
function privateHistoryText(roleId: string, limit = 10): string {
  const conv = listConversations().find(
    (c) => c.type === "private" && c.members.includes(roleId),
  );
  if (!conv) return "";
  return conv.messages
    .slice(-limit)
    .map((m) => {
      const who = m.from === "player" ? "玩家" : m.fromName || m.from;
      return `- ${who}: ${m.text}`;
    })
    .join("\n");
}

/**
 * ★ 单聊回复：以该角色身份生成一条高质量短信并落库。
 * @returns 是否成功（失败时调用方回退旧 brain 链路）
 */
export async function speakPrivateReply(
  roleId: string,
  roleName: string,
  playerText: string,
  src: RoleInfoSource,
  /** 单聊会话 id（App.vue 调用时传入；省略则按 roleId 自查） */
  convId?: string,
): Promise<boolean> {
  const { findConversation, setSilentPlaceholder, clearSilentPlaceholder } = await import("./store");
  // ★ 单聊也用沉默占位（1 人）：发言器等待期间显示「沉默：xx」
  const cid = convId
    || listConversations().find((c) => c.type === "private" && c.members.includes(roleId))?.id
    || "";
  const privConv = cid ? findConversation(cid) : undefined;
  if (privConv) setSilentPlaceholder(privConv.id, [{ roleId, roleName }]);
  const reqId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  sendTick("sys_sms_speak", {
    reqId,
    roleId,
    roleName,
    roleCard: buildRoleCardText(roleId, src),
    playerText,
    history: privateHistoryText(roleId),
  });
  const res = await waitGroupResult(reqId).finally(() => {
    if (privConv) clearSilentPlaceholder(privConv.id);
  });
  const text = String(res?.text || "").trim();
  if (!res?.ok || !text) {
    console.warn("[sms][单聊发言] 失败 → 回退旧链路：", res?.error);
    return false;
  }
  const { receiveFromAI } = await import("./store");
  const msg = receiveFromAI(roleId, roleName, "player", text, true);
  if (!msg) return false;
  console.info(`[sms][单聊发言] ${roleName}: ${text.slice(0, 50)}…`);
  return true;
}

/** 诊断：某会话是否正在编排 */
export function isOrchestrating(convId: string): boolean {
  return running.has(convId);
}

/** 列出所有群会话（调试用） */
export function listGroupConversations(): string[] {
  return listConversations().filter((c) => c.type === "group").map((c) => c.id);
}
