/**
 * scripts/test-sms-store.mjs — 通信(短信) store 逻辑自测
 * ============================================================
 * 覆盖设计文档 §10 验收清单里可离线验证的项：
 *   1. 未读数排除玩家自己的消息
 *   2. 未读数排除 system 消息
 *   3. ★ 标记只给「玩家发的、且之后没有 AI 回复」的消息
 *   4. 容量上限：单会话 100 条 + lastReadMsgId 重置
 *   5. 玩家发消息 → 登记待回复目标
 *   6. AI 回复 → 清掉待回复登记
 *   7. 群聊冷却
 *
 * 运行：node scripts/test-sms-store.mjs
 *   （用 esbuild 把 TS 编译到临时目录再跑；不依赖 vue 的运行时 API）
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tmp = mkdtempSync(join(tmpdir(), "sms-test-"));

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
  stdin: {
    contents: stub,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: join(tmp, "toonflowJsApi.js"),
  bundle: true,
  format: "esm",
  platform: "node",
});

/** 把 ../toonflowJsApi 换成桩（避免依赖 window.postMessage） */
const stubPlugin = {
  name: "stub-toonflow-api",
  setup(b) {
    b.onResolve({ filter: /toonflowJsApi$/ }, () => ({
      path: join(tmp, "toonflowJsApi.js"),
    }));
  },
};

await build({
  entryPoints: [join(process.cwd(), "src/sms/store.ts"), join(process.cwd(), "src/sms/types.ts")],
  outdir: tmp,
  bundle: true,
  format: "esm",
  platform: "node",
  // ★ vue 一起打进来（store 用了 reactive/computed）
  plugins: [stubPlugin],
});

const store = await import(pathToFileURL(join(tmp, "store.js")).href);
const types = await import(pathToFileURL(join(tmp, "types.js")).href);

/* ---------------- Node 环境补 window（store 用了 window.setTimeout） ---------------- */
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

/* ---------------- 用例 ---------------- */

section("1. 未读数：排除玩家自己的消息");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  store.receiveFromAI("npc1", "萧肿", "player", "药圃在哪");
  eq(store.getConvUnread(conv), 1, "AI 发 1 条 → 未读 = 1");

  // ★ 设计文档 §4.3：玩家主动发消息 → lastReadMsgId 推到该条 → 当前会话自动清零
  //   （玩家发消息时人就在这个会话里，说明已经看过上面的消息了）
  store.sendPlayerMessage(conv.id, "我知道了");
  eq(store.getConvUnread(conv), 0, "玩家自己发的消息不计入未读，且自动清零");

  store.receiveFromAI("npc1", "萧肿", "player", "那我先走了", true);
  eq(store.getConvUnread(conv), 1, "AI 又发 1 条 → 未读 = 1");
  store.markRead(conv.id);
  eq(store.getConvUnread(conv), 0, "读完 → 未读 = 0");
}

section("2. 未读数：排除 system 消息");
{
  store.__resetForTest();
  await store.load("storyA");
  const g = store.createGroupConversation("林家护卫团", ["npc1", "npc2"], { npc1: "萧肿", npc2: "陈南璇" });
  eq(g.messages.length, 2, "建群时写了 2 条 system 消息");
  eq(store.getConvUnread(g), 0, "system 消息不产生未读");
}

section("3. ★ 标记：只给「玩家发的、之后没有 AI 回复」的消息");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  store.sendPlayerMessage(conv.id, "药圃在哪");
  store.sendPlayerMessage(conv.id, "东边？");
  store.sendPlayerMessage(conv.id, "有人吗");

  /** 只统计消息行里的 ★（标题行里的不算） */
  const starCount = (ctx) =>
    ctx.split("\n").filter((l) => l.startsWith("- [")).filter((l) => l.includes("★")).length;

  let ctx = store.buildSmsContext("npc1");
  eq(starCount(ctx), 3, "3 条玩家消息都未回复 → 3 条消息行带 ★");
  eq(ctx.includes("你必须在本次回复里给出 message.text"), true, "有 ★ → prompt 带强回复契约");

  // AI 回一条 → 这一批（3 条）都算已回复 → 不再有 ★
  //  ★ 语义：AI 的一条回复是针对这批消息的整体回应，不是逐条对应
  store.receiveFromAI("npc1", "萧肿", "player", "往东走第三个田埂", true);
  ctx = store.buildSmsContext("npc1");
  eq(starCount(ctx), 0, "AI 回 1 条 → 这批 3 条全部算已回复，无 ★");
  eq(ctx.includes("你必须在本次回复里给出 message.text"), false, "无 ★ → prompt 不带强回复契约");

  // 玩家再发一条 → 又出现 ★
  store.sendPlayerMessage(conv.id, "在吗");
  ctx = store.buildSmsContext("npc1");
  eq(starCount(ctx), 1, "玩家再发 1 条 → 1 条带 ★");
}

section("4. 容量上限：单会话 100 条 + lastReadMsgId 重置");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  // ★ 用「回复」模式绕过单聊冷却（否则第 2 条就被冷却挡掉了，测不到裁剪逻辑）
  for (let i = 0; i < 120; i++) {
    store.receiveFromAI("npc1", "萧肿", "player", `消息${i}`, true);
  }
  eq(conv.messages.length, 100, "120 条 → 裁剪到 100 条");
  eq(conv.messages[0].text, "消息20", "保留的是最新 100 条");
  eq(conv.lastReadMsgId, null, "被裁掉的 lastReadMsgId → 重置为 null");
}

section("5. 玩家发消息 → 登记待回复目标");
{
  store.__resetForTest();
  await store.load("storyA");
  const g = store.createGroupConversation("林家护卫团", ["npc1", "npc2"]);
  store.sendPlayerMessage(g.id, "大家小心");
  eq(!!store.getPendingReplyTarget("npc1"), true, "npc1 登记了待回复");
  eq(!!store.getPendingReplyTarget("npc2"), true, "npc2 登记了待回复");
  eq(store.hasPendingReply("npc1"), true, "hasPendingReply = true");
}

section("6. AI 回复 → 清掉待回复登记");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  store.sendPlayerMessage(conv.id, "药圃在哪");
  eq(store.hasPendingReply("npc1"), true, "发完 → 有待回复");
  store.receiveFromAI("npc1", "萧肿", "player", "往东走第三个田埂", true);
  eq(store.hasPendingReply("npc1"), false, "AI 回复后 → 待回复清空");
  eq(conv.awaitingReply, false, "awaitingReply = false");
}

section("7. 群聊冷却：同角色 3 分钟内不重复发群消息");
{
  store.__resetForTest();
  await store.load("storyA");
  const g = store.createGroupConversation("林家护卫团", ["npc1"]);
  const a = store.receiveFromAI("npc1", "萧肿", `group:${g.id}`, "第一句");
  const b = store.receiveFromAI("npc1", "萧肿", `group:${g.id}`, "第二句");
  eq(!!a, true, "第一条群消息成功");
  eq(b, null, "冷却期内第二条被丢弃");
}

section("8. 未读数上限显示 & 总会话未读汇总");
{
  store.__resetForTest();
  await store.load("storyA");
  const c1 = store.ensurePrivateConversation("npc1", "萧肿");
  const c2 = store.ensurePrivateConversation("npc2", "陈南璇");
  store.receiveFromAI("npc1", "萧肿", "player", "A", true);
  store.receiveFromAI("npc2", "陈南璇", "player", "B", true);
  store.receiveFromAI("npc2", "陈南璇", "player", "C", true);
  eq(store.getConvUnread(c1), 1, "会话1 未读 = 1");
  eq(store.getConvUnread(c2), 2, "会话2 未读 = 2");
  eq(store.getTotalUnread(), 3, "总未读 = 3");
}

section("9. 单聊冷却：主动发 1 分钟 1 条（回复不受限）");
{
  store.__resetForTest();
  await store.load("storyA");
  const conv = store.ensurePrivateConversation("npc1", "萧肿");
  const a = store.receiveFromAI("npc1", "萧肿", "player", "主动1");
  const b = store.receiveFromAI("npc1", "萧肿", "player", "主动2");
  eq(!!a, true, "第一条主动消息成功");
  eq(b, null, "冷却期内第二条主动消息被丢弃");
  // 回复不受冷却限制
  const c = store.receiveFromAI("npc1", "萧肿", "player", "回复", true);
  eq(!!c, true, "回复不受单聊冷却限制");
}

section("10. 消息文本超长截断");
{
  const long = "字".repeat(600);
  const out = types.clampText(long);
  eq(out.length, 500, "超长文本截断到 500");
  eq(out.endsWith("…"), true, "截断处补省略号");
}

section("11. 单聊同名归并（roleId 跨会话不稳定）");
{
  store.__resetForTest();
  await store.load("storyA");
  // 第一天：npc_1 建会话并有消息
  const c1 = store.ensurePrivateConversation("npc_1", "陈南璇");
  store.receiveFromAI("npc_1", "陈南璇", "player", "第一天的消息", true);
  // 第二天：同角色被重编号为 npc_7 → 同名归并，不应新建
  const c2 = store.ensurePrivateConversation("npc_7", "陈南璇");
  eq(c2.id === c1.id, true, "同名角色重进游戏后归并到原会话（不新建）");
  eq(c2.members[0] === "npc_7", true, "归并后成员 id 迁移到当前 roleId");
  // 加载时归并存量脏数据：造两个同名会话 → flushSave 持久化 → 重载归并
  store.__resetForTest();
  await store.load("storyB");
  const a = store.ensurePrivateConversation("npc_a", "李四");
  store.receiveFromAI("npc_a", "李四", "player", "A线消息", true);
  store.ensurePrivateConversation("npc_b", "李四"); // 同名第二个（无消息）
  await store.flushSave();                           // 持久化（2 个同名会话入库）
  await store.load("storyB");                        // 重载 → mergeLegacyDuplicatePrivates 生效
  const lisi = store.listConversations().filter((c) => c.type === "private" && c.name === "李四");
  eq(lisi.length, 1, "重载后同名单聊归并为 1 个");
  eq((lisi[0]?.messages.length || 0) >= 1, true, "归并保留消息");
}

/* ---------------- 汇总 ---------------- */
console.log(`\n${"=".repeat(46)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log("=".repeat(46));

rmSync(tmp, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
