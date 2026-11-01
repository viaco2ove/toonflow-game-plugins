/**
 * scripts/test-sms-prompt.mjs — 通信(短信) Prompt 契约回归锁
 * ============================================================
 * 为什么需要这个锁：
 *   短信功能是「双层契约」——
 *     静态层：src/agents/plugins.prompts.ts 的 PROMPT_FIELD_SURVIVAL_AI_BRAIN
 *              （宿主侧 systemPrompt，告诉 LLM 输出格式）
 *     动态层：vue/src/ai/brain.ts 的 buildUserPrompt
 *              （前端侧 userPrompt，给出 JSON 骨架）
 *   两边必须同时包含 message 契约。历史上只改一边 → LLM 永不输出 message
 *   → parseSmsIntent 永远 undefined → 玩家发短信后 AI 一直「等待对方回复」。
 *
 * 断言对象：
 *   A. 源码层：plugins.prompts.ts 与 brain.ts 都含 message.text / message.to
 *   B. 产物层：entry.js（esbuild 产物，中文被转义成 \uXXXX）里也能搜到契约
 *      —— 防止「改了源码忘了重建 entry.js」
 *
 * 运行：node scripts/test-sms-prompt.mjs
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VUE_DIR = resolve(__dirname, "..");
const PLUGIN_DIR = resolve(VUE_DIR, "..");

const PROMPT_SRC = join(PLUGIN_DIR, "src", "agents", "plugins.prompts.ts");
const BRAIN_SRC = join(VUE_DIR, "src", "ai", "brain.ts");
const ENTRY_JS = join(PLUGIN_DIR, "entry.js");

/* ---------------- 断言小工具 ---------------- */
let pass = 0;
let fail = 0;

function ok(cond, name) {
  if (cond) {
    pass++;
    console.log(`  [PASS] ${name}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}`);
  }
}

function section(title) {
  console.log(`\n${"-".repeat(46)}\n${title}\n${"-".repeat(46)}`);
}

/**
 * esbuild 会把中文转义成 \uXXXX，TS 模板字符串里的反引号也会转义成 \`。
 * 这里做反转义，这样断言可以按「可读文本」写，而不是 \uXXXX 码点。
 */
function unescapeUnicode(text) {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\`/g, "`");
}

const promptSrc = unescapeUnicode(readFileSync(PROMPT_SRC, "utf8"));
const brainSrc = unescapeUnicode(readFileSync(BRAIN_SRC, "utf8"));

/* ============================================================
 * 1. 静态 prompt 契约（宿主侧 systemPrompt）
 * ============================================================ */
section("1. 静态 prompt（plugins.prompts.ts）短信契约");

ok(
  promptSrc.includes('"message"') || promptSrc.includes("\"message\":"),
  "输出 JSON 契约里声明了 message 字段",
);

ok(
  /message[\s\S]{0,120}"text"/.test(promptSrc),
  'message 契约里声明了 text 子字段',
);

ok(
  /message[\s\S]{0,120}player 或 group:/.test(promptSrc),
  "message 契约里说明了 to 的取值（player / group:<会话ID>）",
);

ok(promptSrc.includes("必回场景"), "含「必回场景」小节标题");

ok(
  /必回场景[\s\S]{0,300}★/.test(promptSrc),
  "「必回场景」小节说明了 ★ 标记的含义",
);

const smsSection = promptSrc.slice(promptSrc.indexOf("## 短信"));
ok(smsSection.length > 0, "存在「## 短信」说明小节");
ok(
  smsSection.includes("`player`") && smsSection.includes("`group:"),
  "短信小节里明示了合法 to 取值 `player` / `group:`",
);

ok(
  /不要重复[\s\S]{0,200}★/.test(promptSrc),
  "含「不要重复」规则（无 ★ 时不再重复发）",
);

ok(
  /互不影响[\s\S]{0,200}message/.test(promptSrc),
  "说明短信与动作互不影响（可同时输出）",
);

ok(
  /"message"\s*:\s*\{[\s\S]{0,200}"text"\s*:\s*"[^"]*"/.test(promptSrc),
  "带 message 的完整 JSON 示例存在（text + to 都有值）",
);

/* ============================================================
 * 2. 动态 prompt 契约（前端侧 userPrompt）
 * ============================================================ */
section("2. 动态 prompt（brain.ts buildUserPrompt）短信契约");

ok(
  /"message"\s*:\s*\{[\s\S]{0,300}?"text"/.test(brainSrc),
  "buildUserPrompt 的 JSON 骨架里声明了 message.text",
);

ok(
  /"message"\s*:\s*\{[\s\S]{0,300}?"to"\s*:/.test(brainSrc),
  "buildUserPrompt 的 JSON 骨架里声明了 message.to",
);

ok(
  /player\s*或\s*group:/.test(brainSrc),
  "buildUserPrompt 说明了 to 的合法取值",
);

/* ============================================================
 * 3. 前端消费侧解析契约
 * ============================================================ */
section("3. 前端解析契约（brain.ts parseSmsIntent）");

ok(
  /message\s*:\s*parseSmsIntent\(/.test(brainSrc),
  "解析响应时调用 parseSmsIntent 消费 message",
);

ok(
  /parseSmsIntent[\s\S]{0,900}?player/.test(brainSrc),
  "parseSmsIntent 校验 to 必须是 player 或 group: 前缀",
);

/* ============================================================
 * 4. 产物层：entry.js 必须含契约（防止改了源码忘重建）
 * ============================================================ */
section("4. 产物层（entry.js）短信契约");

if (!existsSync(ENTRY_JS)) {
  ok(false, "entry.js 存在（未构建产物）");
} else {
  const entryRaw = readFileSync(ENTRY_JS, "utf8");
  const entryText = unescapeUnicode(entryRaw);

  ok(entryText.includes('"message"'), "entry.js 产物里含 message 字段");
  ok(entryText.includes("必回场景"), "entry.js 产物里含「必回场景」");
  ok(entryText.includes("`player`"), "entry.js 产物里含 `player` 取值");
  ok(entryText.includes("`group:"), "entry.js 产物里含 `group:` 取值");

  // 产物必须比源码新（源码改了没重建 → mtime 早于源码）
  const srcMtime = statSync(PROMPT_SRC).mtimeMs;
  const entryMtime = statSync(ENTRY_JS).mtimeMs;
  ok(
    entryMtime >= srcMtime,
    "entry.js 不比 prompt 源码旧（改了源码记得重建）",
  );
}

/* ---------------- 汇总 ---------------- */
console.log(`\n${"=".repeat(46)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log("=".repeat(46));

process.exit(fail > 0 ? 1 : 0);
