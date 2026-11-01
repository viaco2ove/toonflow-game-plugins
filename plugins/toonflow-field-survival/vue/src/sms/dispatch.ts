/**
 * sms/dispatch.ts — 短信意图分发
 * =================================================
 * 职责：把 brain 决策里的 `message` 字段变成一条真正的短信。
 *
 * ★ 为什么单独一个文件（而不是放在 ai/index.ts）：
 *   ai/chatCommand.ts 也会用到它，而 ai/index.ts 又 `export { issueAIChatCommand }`
 *   —— 放在 index.ts 里会形成循环依赖（index → chatCommand → index）。
 *
 * 设计文档：通信(短信).design.md §6.1 / §6.3
 */

import type { Entity } from "../types";
import type { LLMDecision } from "../ai/types";
import {
  receiveFromAI,
  hasPendingReply,
  getPendingReplyTarget,
  clearPendingReply,
  listConversations,
} from "./store";

/**
 * 消费一次 brain 决策里的 `message` 字段，把它变成一条真正的短信。
 *
 * ★ 设计约束（通信(短信).design.md §6.3）：
 *   - 短信必须复用 brain 的**同一次** LLM 响应，不另开调用
 *   - 拿不到 LLM（闸门/超时/解析失败）→ 不发短信（宁缺毋滥）
 *   - 只在拿到真实响应且 message 合法时才发
 *
 * @param decision brain 的决策结果
 * @param entity   决策的角色
 * @returns 是否成功发出短信
 */
export function dispatchSmsDecision(
  decision: LLMDecision | null,
  entity: Entity,
): boolean {
  if (!decision || !decision.message) return false;
  const intent = decision.message;
  if (!intent.text || !intent.text.trim()) return false;

  // ★ 回复模式：玩家发了消息还没被回 → 这条短信就是回复（不受频率冷却限制）
  const isReply = hasPendingReply(entity.id);
  const target = getPendingReplyTarget(entity.id);

  // ★ 目标合法性校验：
  //   "player"        → 发到与该角色的单聊
  //   "group:<id>"    → 发到群聊
  //   其他非法值      → 降级为单聊（而不是丢弃）
  let to = String(intent.to || "player").trim() || "player";
  if (to !== "player" && !to.startsWith("group:")) {
    to = "player";
  }

  // ★ 群聊目标合法性：AI 必须真的在这个群里，否则降级为单聊
  //   （避免 AI 编造一个不存在的 groupId，消息就凭空丢了）
  if (to.startsWith("group:")) {
    const gid = to.slice("group:".length);
    const conv = listConversations().find((c) => c.id === gid);
    if (!conv) {
      console.warn(`[sms] AI 指向的群聊不存在（${gid}），降级为单聊`);
      to = "player";
    } else if (!conv.members.includes(entity.id)) {
      console.warn(`[sms] ${entity.name} 不在群聊 ${gid} 里，降级为单聊`);
      to = "player";
    }
  }

  const msg = receiveFromAI(entity.id, entity.name || entity.id, to, intent.text, isReply);
  if (!msg) {
    // 被冷却/无效目标挡掉了 → 不清待回复登记，等下次心跳再试
    return false;
  }

  console.info(
    `[sms] ${entity.name} → ${to}${isReply ? "（回复）" : ""}: ${intent.text.slice(0, 40)}`,
  );
  void target;
  return true;
}

export { clearPendingReply, hasPendingReply, getPendingReplyTarget };
