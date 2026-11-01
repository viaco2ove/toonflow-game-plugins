/**
 * scripts/test-sms-dispatch.mjs — 通信(短信) 决策分发集成自测
 * ============================================================
 * 覆盖 store 自测（test-sms-store.mjs）没覆盖的那一段：
 *   玩家发消息 → AI 决策（带 message）→ 真正落成一条短信。
 *
 * 用例：
 *   1. 有 message 且目标合法 → 短信落库 + 清掉待回复登记
 *   2. 没有 message（LLM 只想动不想说）→ 不发短信、不清登记
 *   3. message.to 指向不存在的群 → 降级为单聊（消息不凭空丢）
 *   4. message.to 指向自己不在的群 → 降级为单聊
 *   5. 非法 to（乱填字符串）→ 降级为单聊
 *   6. message.text 为空白 → 不发短信
 *   7. 群聊目标合法且 AI 在群里 → 落进群
 *
 * 运行：node scripts/test-sms-dispatch.mjs
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tmp = mkdtempSync(join(tmpdir(), "sms-dispatch-test-"));

/** 桩掉 toonflowJsApi（避免依赖 window.postMessage） */
const stub = `
const __store = { data: null, writes: 0 };
export const toonflowJsApi = {
  pluginData: {
    async get(key) { return __store.data; },
    async set(key, value) { __store.data = value; __store.writes++; },
    async list() { return []; },
    async remove() {},
  },
};
export const __stub = __store;
`;

await build({
  stdin: { contents: stub, resolveDir: process.cwd(), loader: "ts" },
  outfile: join(tmp, "toonflowJsApi.js"),
  bundle: true,
  format: "esm",
  platform: "node",
});

const stubPlugin = {
  name: "stub-toonflow-api",
  setup(b) {
    b.onResolve({ filter: /toonflowJsApi$/ }, () => ({
      path: join(tmp, "toonflowJsApi.js"),
    }));
  },
};

await build({
  entryPoints: [join(process.cwd(), "src/sms/store.ts")],
  outdir: tmp,
  bundle: true,
  format: "esm",
  platform: "node",
  plugins: [stubPlugin],
});

/**
 * ★ dispatch.ts 必须**复用** store.ts 的那个模块实例，
 *   否则两份 store 各自持有一份 state（dispatch 里的 conversations 是空的）。
 *   做法：把 store.ts 作为 external，打进 dispatch 的 bundle 里，
 *   再让 dispatch.js import 同一个 store.js。
 */
await build({
  entryPoints: [join(process.cwd(), "src/sms/dispatch.ts")],
  outdir: tmp,
  bundle: true,
  format: "esm",
  platform: "node",
  plugins: [
    stubPlugin,
    {
      name: "external-store",
      setup(b) {
        b.onResolve({ filter: /^\.\/store$/ }, () => ({
          path: "./store.js",
          external: true,
        }));
      },
    },
  ],
});

const store = await import(pathToFileURL(join(tmp, "store.js")).href);
const dispatch = await import(pathToFileURL(join(tmp, "dispatch.js")).href);

/* ---------------- Node 环境补 window ---------------- */
if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
}

/* ---------------- 断言工具 ---------------- */
let pass = 0;
let fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}
function section(t) {
  console.log(`\n【${t}】`);
}

/** 造一个最小的 entity（dispatch 只用 id / name） */
function mkEntity(id, name) {
  return { id, name, side: "ally" };
}

/* ---------------- 用例 ---------------- */

section("1. 有 message + 合法目标 → 短信落库 + 清待回复登记");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  store.sendPlayerMessage(conv.id, "药圃在哪");

  const sent = dispatch.dispatchSmsDecision(
    { message: { to: "player", text: "往东走第三个田埂" } },
    mkEntity("npc1", "萧肿"),
  );
  eq(sent, true, "dispatch 返回 true");

  const last = conv.messages[conv.messages.length - 1];
  eq(last.from, "npc1", "消息来自 npc1");
  eq(last.text, "往东走第三个田埂", "消息内容正确");
  eq(last.type, "text", "类型是 text");
  eq(store.hasPendingReply("npc1"), false, "待回复登记已清空");
  eq(conv.awaitingReply, false, "awaitingReply 已复位");
}

section("2. 没有 message → 不发短信，也不清登记");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  store.sendPlayerMessage(conv.id, "药圃在哪");
  const before = conv.messages.length;

  const sent = dispatch.dispatchSmsDecision({ action: "idle" }, mkEntity("npc1", "萧肿"));
  eq(sent, false, "dispatch 返回 false");
  eq(conv.messages.length, before, "没有新增消息");
  eq(store.hasPendingReply("npc1"), true, "待回复登记保留（等下次心跳兜底）");
}

section("3. message.to 指向不存在的群 → 降级为单聊");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  store.sendPlayerMessage(conv.id, "在吗");

  const sent = dispatch.dispatchSmsDecision(
    { message: { to: "group:c_nonexistent", text: "我在" } },
    mkEntity("npc1", "萧肿"),
  );
  eq(sent, true, "仍然发出（消息不凭空丢）");
  const last = conv.messages[conv.messages.length - 1];
  eq(last.conversationId, conv.id, "落进了单聊而不是不存在的群");
  eq(last.text, "我在", "内容正确");
}

section("4. message.to 指向自己不在的群 → 降级为单聊");
{
  store.__resetForTest();
  await store.load("storyA");
  const g = store.createGroupConversation("林家护卫团", ["npc2"]);
  const priv = store.ensurePrivateConversation("npc1", "萧肿");
  store.sendPlayerMessage(priv.id, "在吗");

  const sent = dispatch.dispatchSmsDecision(
    { message: { to: `group:${g.id}`, text: "我不在这个群" } },
    mkEntity("npc1", "萧肿"),
  );
  eq(sent, true, "仍然发出");
  const last = priv.messages[priv.messages.length - 1];
  eq(last.conversationId, priv.id, "降级落到单聊");
  eq(g.messages.length, 1, "群聊里没有多出消息（只有建群的 1 条 system）");
}

section("5. 非法 to（乱填字符串）→ 降级为单聊");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  store.sendPlayerMessage(conv.id, "在吗");

  const sent = dispatch.dispatchSmsDecision(
    { message: { to: "随便什么", text: "收到" } },
    mkEntity("npc1", "萧肿"),
  );
  eq(sent, true, "仍然发出");
  eq(conv.messages[conv.messages.length - 1].conversationId, conv.id, "落进单聊");
}

section("6. message.text 为空白 → 不发短信");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  store.sendPlayerMessage(conv.id, "在吗");
  const before = conv.messages.length;

  const sent = dispatch.dispatchSmsDecision(
    { message: { to: "player", text: "   " } },
    mkEntity("npc1", "萧肿"),
  );
  eq(sent, false, "dispatch 返回 false");
  eq(conv.messages.length, before, "没有新增消息");
  eq(store.hasPendingReply("npc1"), true, "待回复登记保留");
}

section("7. 群聊目标合法且 AI 在群里 → 落进群");
{
  store.__resetForTest();
  await store.load("storyA");
  const g = store.createGroupConversation("林家护卫团", ["npc1", "npc2"]);
  store.sendPlayerMessage(g.id, "大家小心");

  const sent = dispatch.dispatchSmsDecision(
    { message: { to: `group:${g.id}`, text: "收到，我断后" } },
    mkEntity("npc1", "萧肿"),
  );
  eq(sent, true, "dispatch 返回 true");
  const last = g.messages[g.messages.length - 1];
  eq(last.conversationId, g.id, "落进群聊");
  eq(last.text, "收到，我断后", "内容正确");
  eq(store.hasPendingReply("npc1"), false, "待回复登记已清空");
}

section("8. decision 为 null → 不发短信");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  store.sendPlayerMessage(conv.id, "在吗");
  const before = conv.messages.length;
  const sent = dispatch.dispatchSmsDecision(null, mkEntity("npc1", "萧肿"));
  eq(sent, false, "dispatch 返回 false");
  eq(conv.messages.length, before, "没有新增消息");
}

/* ---------------- 汇总 ---------------- */
console.log(`\n${"=".repeat(46)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log("=".repeat(46));

rmSync(tmp, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
