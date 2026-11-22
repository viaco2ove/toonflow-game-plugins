/**
 * groupOrchestrator.ts — 群聊编排器 + 角色发言器（插件业务，宿主不认识它）
 * =================================================
 * ★ 2026-11-23 用户需求（二次修正）：
 *   「群聊编排器 agent → 那些人发言，发言顺序 → 界面先显示沉默的角色头像(沉默：xxx)
 *     → 发言人逐个发言（**每个角色独立发言的流式台词生成**，有打字效果）
 *     → 触发追加发言（随机，机率小于 40%）→ 群聊编排器 agent → ……」
 *
 *   分工（修正前把所有台词一次生成 → 同一上下文产出 → 口吻/字数/结构雷同）：
 *     - **编排器**（本文件，一次 LLM）：只决定「谁发言、什么顺序」，不写台词；
 *     - **发言器**（speakAsCharacter，每角色一次独立 LLM）：
 *       各自的角色卡 + 群聊最新历史（含前面人刚说的话）+ 故事背景 → 各自生成台词。
 *       一人说完再到下一个人（独立调用 → 个性真正分化，且能看到前面人的话接得住）。
 *
 * ★ 宿主只提供「按插件给的 systemPrompt/userPrompt 调一次大模型」的通用能力
 *   （宿主 agent 名 = "plugin-llm"），不认识任何插件业务 agent。
 * ★ 模型：storyOrchestratorModel（与宿主剧情模式同一个模型），aiConfigKey 透传。
 */

/** 群成员卡片（由前端根据会话成员 + 角色表拼） */
export interface GroupMemberCard {
  /** 角色 id（编排器输出必须用这个 id） */
  id: string;
  /** 显示名 */
  name: string;
  /** 角色简介 / 人设 */
  description?: string;
  /** 等级 */
  level?: number;
  /** 性格 */
  personality?: string;
}

/** 编排器结果：只含**发言顺序名单**（不含台词） */
export interface GroupOrchestratorResult {
  ok: boolean;
  /** 有序发言人 id 列表（已校验：必须是群成员、去重、限量、@点名排第一） */
  speakerIds: string[];
  summary?: string;
  error?: string;
}

/** 编排器调模型所需的上下文（宿主提供的一部分） */
export interface GroupStoryContext {
  /** 故事全局背景（宿主 ctx.globalBackground） */
  globalBackground?: string;
  /** ★ 故事动态背景（宿主记忆摘要，"最近发生了什么"） */
  dynamicGlobalBackground?: string;
  /** 常驻世界书条目摘要（宿主 ctx.worldBookDigest） */
  worldBookDigest?: string;
  /** 故事动态数据摘要（角色列表 + 用户参数卡） */
  storyDigest?: string;
}

/** ★ 编排器入参（前端/entry 传） */
export interface GroupOrchestratorParams {
  /** 群成员卡片 */
  members: GroupMemberCard[];
  /** 玩家本轮说的话 */
  playerText: string;
  /** 最近的群聊历史（已格式化的多行文本） */
  history?: string;
  /** 被 @ 点名的角色 id（若有点名，必须第一个发言） */
  mentionedRoleIds?: string[];
  /** 单轮最多几个发言人 */
  maxSpeakers?: number;
}

/** 编排器调模型的入口（宿主 tsApi.agent.run 形状） */
export interface GroupLlmRunner {
  run(
    agentName: string,
    input: Record<string, unknown>,
    aiConfigKey?: string,
  ): Promise<{ ok: boolean; output?: Record<string, any>; error?: string }>;
}

/** ★ 编排器/发言器用的模型 key（与宿主剧情模式同一个模型） */
export const GROUP_ORCHESTRATOR_MODEL_KEY = "storyOrchestratorModel";

/** ★ 宿主通用 LLM 通道名（宿主不认识插件业务，只提供调模型能力） */
export const PLUGIN_LLM_AGENT_NAME = "plugin-llm";

/** LLM 调用超时（ms） */
const GROUP_LLM_TIMEOUT_MS = 25000;

/* ============================================================
   ① 编排器：只决定「谁发言 + 顺序」
   ============================================================ */

const PROMPT_GROUP_ORCHESTRATOR = `你是「群聊编排器 agent」。玩家在一个群聊里说了一句话。

你**只负责决定：谁会回应、按什么顺序回应**。台词不归你写 —— 每个发言人之后会以自己的身份独立生成。

## 你的职责
1. 从群成员里挑出**确实该回应**的人（≤ {{maxSpeakers}} 人）。
   - 被 @ 点名的人**必须**排在第一位。
   - 与玩家这句话明显无关的人不发言（保持沉默是正常且有价值的，不要凑人数）。
2. 排顺序：
   - 最相关 / 最该回应的人在前面；
   - **性格互补穿插**：冷静分析者、热血行动派、旁观吐槽者交替出现，避免两个同类型角色连着说；
   - 后发言的人要能自然接住前面人的话（他生成时会看到前面已发出的内容）。
3. 沉默也是信息：某角色与话题无关就让他沉默。

## 输出格式（只输出这一个 JSON，不要代码围栏，不要额外解释）
{
  "speakers": ["成员ID1", "成员ID2", "成员ID3"],
  "summary": "一句话概括这轮谁会说话、围绕什么"
}

## 硬性要求
- id 必须严格取自「群成员」列表里的 id；不要发明，不要用名字当 id。
- 数组顺序 = 发言顺序。
- 至少 1 个发言人；若确实没人该回应 → {"speakers": [], "summary": "无人回应"}。
- 不要输出 markdown、不要输出 JSON 以外的任何文字。`;

/** 组装编排器 systemPrompt（人数上限占位符） */
export function buildGroupOrchestratorSystemPrompt(maxSpeakers: number): string {
  return PROMPT_GROUP_ORCHESTRATOR.replace("{{maxSpeakers}}", String(maxSpeakers));
}

/** 组装编排器 userPrompt（成员卡片 + 玩家原话 + 群历史 + 故事背景） */
export function buildGroupOrchestratorUserPrompt(
  params: GroupOrchestratorParams,
  story: GroupStoryContext,
): string {
  const memberLines = params.members
    .map((m) => {
      const id = String(m?.id || "");
      const nm = String(m?.name || id);
      const desc = String(m?.description || "").slice(0, 300);
      const lv = Number(m?.level || 1);
      const persona = String(m?.personality || "").slice(0, 150);
      return `- id=${id}｜名字=${nm}｜等级=${lv}${persona ? `｜性格=${persona}` : ""}${desc ? `｜简介=${desc}` : ""}`;
    })
    .join("\n");

  const mentioned = (params.mentionedRoleIds || []).filter(Boolean);

  return `## 群成员（id 必须严格取自这里）
${memberLines || "（无）"}

## 被 @ 点名的成员（若有，必须排第一位）
${mentioned.length ? mentioned.join("、") : "（无）"}

## 玩家本轮发言
${params.playerText}

## 最近的群聊历史
${String(params.history || "").slice(0, 3000) || "（无）"}

## 故事全局背景
${String(story.globalBackground || "").slice(0, 2000) || "（无）"}

## 常驻世界书条目
${String(story.worldBookDigest || "").slice(0, 2000) || "（无）"}

请输出发言顺序名单（speakers 数组）。`;
}

/** 校验编排器输出的 id 名单：合法成员、去重、限量、@点名排第一 */
export function normalizeSpeakerIds(
  raw: unknown,
  members: GroupMemberCard[],
  mentionedRoleIds: string[],
  maxSpeakers: number,
): string[] {
  const validIds = new Set(members.map((m) => String(m?.id || "")));
  const out: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list) {
    // 容错：模型可能输出 {roleId} 对象而不是裸字符串
    const rid = String(typeof item === "string" ? item : (item as any)?.roleId || (item as any)?.id || "").trim();
    if (!rid || !validIds.has(rid) || out.includes(rid)) continue;
    out.push(rid);
    if (out.length >= maxSpeakers) break;
  }
  // ★ @点名者排第一；模型漏掉点名者时直接**补进名单**（点名必回）
  const mentioned = mentionedRoleIds.filter(Boolean).reverse();
  for (const rid of mentioned) {
    const i = out.indexOf(rid);
    if (i > 0) {
      out.splice(i, 1);
      out.unshift(rid);
    } else if (i < 0 && validIds.has(rid) && !out.includes(rid)) {
      if (out.length >= maxSpeakers) out.pop(); // 挤掉末位保点名者
      out.unshift(rid);
    }
  }
  return out;
}

/** 给 Promise 加超时 */
async function withLlmTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(msg)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * ★ 跑一轮编排：返回有序发言人 id 名单（不含台词）。
 * 台词由调用方对每个 id 独立调 speakAsCharacter 生成。
 */
export async function runGroupOrchestrator(
  llm: GroupLlmRunner | undefined,
  params: GroupOrchestratorParams,
  story: GroupStoryContext = {},
): Promise<GroupOrchestratorResult> {
  if (!llm?.run) return { ok: false, speakerIds: [], error: "宿主 agent 通道不可用" };
  const members = (params.members || []).filter((m) => String(m?.id || ""));
  if (!members.length) return { ok: false, speakerIds: [], error: "群成员为空" };
  if (!String(params.playerText || "").trim()) {
    return { ok: false, speakerIds: [], error: "玩家本轮发言为空" };
  }

  const maxSpeakers = Math.max(1, Math.min(8, Math.round(Number(params.maxSpeakers) || 5)));
  const userPrompt = buildGroupOrchestratorUserPrompt({ ...params, members }, story);
  const systemPrompt = buildGroupOrchestratorSystemPrompt(maxSpeakers);

  try {
    const r = await withLlmTimeout(
      llm.run(
        PLUGIN_LLM_AGENT_NAME,
        { userPrompt, systemPrompt, maxSpeakers },
        GROUP_ORCHESTRATOR_MODEL_KEY,
      ),
      GROUP_LLM_TIMEOUT_MS,
      "群聊编排超时",
    );
    if (!r?.ok) {
      return { ok: false, speakerIds: [], error: String(r?.error || "群聊编排调用失败") };
    }
    const out = (r?.output || {}) as Record<string, any>;
    const speakerIds = normalizeSpeakerIds(
      out.speakers,
      members,
      params.mentionedRoleIds || [],
      maxSpeakers,
    );
    return { ok: true, speakerIds, summary: String(out.summary || "").slice(0, 200) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, speakerIds: [], error: msg };
  }
}

/* ============================================================
   ② 角色发言器：每个角色一次独立 LLM，生成自己的台词
   ============================================================ */

const PROMPT_CHARACTER_SPEAK = `你在一个故事游戏里扮演一名 NPC 角色，正在群里发言（其他成员和玩家都在看）。

## 你的台词质量标准（重要）
- **格式**：开头用一两个括号写这个角色此刻的动作/神态（贴合人设与场景），
  然后是正式说的话。示例：「（她靠在门边，指尖轻敲着口袋，神色冷静。）……」
- **长度**：40~200 字。禁止一句干巴巴的短话敷衍。
- **内容**：正面回应玩家的问题。玩家问世界观/局势/格局时，必须用「故事全局背景」
  和「世界书条目」里的**具体设定**回答（地名/组织/势力/威胁/规则等专有名词），
  禁止「目前一切正常」「我正去做我的事」这类空洞敷衍。
- **接话**：如果群里已经有人发了言，你要自然地接住（认同/反驳/补充/岔开），
  不要重复别人说过的内容和意思。
- **人设**：身份、性格、立场、说话习惯全部按角色卡来；用这个角色的口吻，
  禁止自称 AI/模型/助手，禁止「作为XX我知道」这类元说明。
- 像真人在群里打字，口语化、有情绪；可以反问、可以留半句。

只输出这段发言正文本身（含括号描写），不要 JSON 包装、不要代码围栏、不要引号。`;

export interface CharacterSpeakParams {
  /** 角色 id */
  roleId: string;
  /** 角色显示名 */
  roleName: string;
  /** 角色卡文本（简介/人设/性格，越全越好） */
  roleCard?: string;
  /** 玩家本轮消息（追加轮传引导语） */
  playerText: string;
  /** 最近的聊天往来（已格式化；群聊传含前面人刚发言的历史） */
  history?: string;
}

/**
 * ★ 角色发言：以该角色身份生成一条高质量发言（独立 LLM 调用）。
 * 群聊逐人调用（编排器只给顺序），单聊回复也走这里。
 */
export async function speakAsCharacter(
  llm: GroupLlmRunner | undefined,
  params: CharacterSpeakParams,
  story: GroupStoryContext = {},
): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!llm?.run) return { ok: false, error: "宿主 agent 通道不可用" };
  const roleName = String(params.roleName || params.roleId || "").trim();
  if (!roleName) return { ok: false, error: "缺少角色名" };
  if (!String(params.playerText || "").trim()) return { ok: false, error: "玩家消息为空" };

  const userPrompt = `## 你的角色
名字：${roleName}
${String(params.roleCard || "").slice(0, 800) || "（无人设卡，按名字合理演绎，保持普通人口吻）"}

## 玩家刚发来的消息
${params.playerText}

## 群里最近的聊天（含其他人刚说的话 —— 接住它们，别重复）
${String(params.history || "").slice(0, 2500) || "（无）"}

## 故事全局背景
${String(story.globalBackground || "").slice(0, 2000) || "（无）"}

## 故事动态背景（最近发生了什么）
${String(story.dynamicGlobalBackground || "").slice(0, 1500) || "（无）"}

## 常驻世界书条目
${String(story.worldBookDigest || "").slice(0, 2000) || "（无）"}

请以「${roleName}」的身份发言（按 systemPrompt 的质量标准）。`;

  try {
    const r = await withLlmTimeout(
      llm.run(
        PLUGIN_LLM_AGENT_NAME,
        { userPrompt, systemPrompt: PROMPT_CHARACTER_SPEAK },
        GROUP_ORCHESTRATOR_MODEL_KEY,
      ),
      GROUP_LLM_TIMEOUT_MS,
      "角色发言超时",
    );
    if (!r?.ok) return { ok: false, error: String(r?.error || "角色发言调用失败") };
    const out = (r?.output || {}) as Record<string, any>;
    // plugin-llm：JSON 解析成功且有 text 字段 / 解析失败时宿主回退原文 {text: 原文}
    let text = "";
    if (typeof out.text === "string" && out.text.trim()) text = out.text.trim();
    else if (typeof out.content === "string" && out.content.trim()) text = out.content.trim();
    else return { ok: false, error: "发言输出无法解析" };
    return { ok: true, text: text.slice(0, 500) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
