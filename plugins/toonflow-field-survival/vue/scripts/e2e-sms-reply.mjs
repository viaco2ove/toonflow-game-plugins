/**
 * scripts/e2e-sms-reply.mjs — 短信回复端到端自测 v2（Playwright 驱动真实页面）
 *
 * 策略：不走脆弱的 UI 选择器，进入 playing 后直接在 iframe 里调用
 *   Vue setupState 上的真实方法，模拟「玩家发短信」的完整链路：
 *     onSysSmsSend → sendPlayerMessage（登记 pendingReply）
 *     → wakeAiForPlayerSms → replyToPlayerSms → callBrainDetailed(allowUnmanaged)
 *     → sys_brain → 桩 agent.run(ai-brain) → /toon-api/plugin/agentRun → LLM
 *     → chatResult → dispatchSmsDecision → 落库回复气泡。
 *
 * 判定：会话里出现非玩家的回复消息 = 链路通。
 *
 * 运行：node scripts/e2e-sms-reply.mjs
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("D:/nvm4w/nodejs/node_modules/@playwright/test/index.js");

// ★ 本机 playwright 版本与预装 chromium 版本不一致（要 1208，装的是 1243）→ 显式指定 exe
const CHROME_EXE =
  "C:/Users/viaco/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";

const BASE = "http://localhost:3000/";
const NPC = "陈南璇";
const MSG = "你好，在忙吗？";

const browser = await chromium.launch({ headless: true, executablePath: CHROME_EXE });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const netAgentRun = [];
const consoleLog = [];

page.on("console", (m) => {
  const t = m.text();
  if (t.length <= 400) consoleLog.push(`[${m.type()}] ${t}`);
});
page.on("request", (r) => {
  if (r.url().includes("agentRun")) netAgentRun.push(`REQ ${r.method()}`);
});
page.on("response", (r) => {
  if (r.url().includes("agentRun")) netAgentRun.push(`RES ${r.status()}`);
});

console.log("== 打开页面 ==");
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2500);

const frameEl = await page.$("#game");
const frame = await frameEl.contentFrame();
console.log("iframe ok");

console.log("== 进游戏 ==");
for (let i = 0; i < 25; i++) {
  const ph = await frame.evaluate(() => window.__FS_DEBUG__?.state?.phase || null).catch(() => null);
  if (ph === "playing") break;
  if (ph === "select") {
    await frame
      .evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) =>
          /开始|进入/.test(x.textContent || ""),
        );
        if (b) b.click();
      })
      .catch(() => {});
  }
  await page.waitForTimeout(1000);
}
console.log("phase =", await frame.evaluate(() => window.__FS_DEBUG__?.state?.phase).catch(() => null));

console.log("== 模拟「玩家发短信」==");
const sendResult = await frame
  .evaluate(
    async ({ npc, msg }) => {
      try {
        const app = document.querySelector("#app").__vue_app__;
        const ss = app._instance.setupState;
        if (!ss) return { err: "setupState 不可读" };

        const contacts = ss.sysSmsContacts?.value ?? ss.sysSmsContacts ?? [];
        const c = contacts.find((x) => (x.name || "").includes(npc));
        if (!c)
          return {
            err: `通讯录无 ${npc}；现有: ` + contacts.map((x) => x.name).slice(0, 8).join(","),
          };

        // 发起单聊建会话
        if (typeof ss.onSysSmsStartChat === "function") {
          ss.onSysSmsStartChat(c.id);
          await new Promise((r) => setTimeout(r, 400));
        }
        const convId =
          ss.smsView?.activeConvId?.value ??
          ss.smsView?.activeConvId ??
          ss.activeSmsConvId?.value ??
          "";
        if (typeof ss.onSysSmsSend !== "function") {
          return {
            err:
              "onSysSmsSend 不可见；sms 相关键=" +
              Object.keys(ss)
                .filter((k) => /sms|Sms/i.test(k))
                .slice(0, 12)
                .join(","),
          };
        }
        await ss.onSysSmsSend(convId, msg);
        return { ok: true, roleId: c.id, convId };
      } catch (e) {
        return { err: String((e && e.stack) || e).slice(0, 300) };
      }
    },
    { npc: NPC, msg: MSG },
  )
  .catch((e) => ({ err: "evaluate异常: " + String(e).slice(0, 200) }));

console.log("发送结果:", JSON.stringify(sendResult));

console.log("== 等 AI 回复（最多 40s）==");
// ★ 判定改读 console：replyToPlayerSms 成功落库必打「[sms] <名> → player（回复）: ...」
let replied = false;
let replyText = "";
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  const hit = consoleLog.find((l) => /\[sms\].*→ player（回复）/.test(l));
  if (hit) {
    replied = true;
    replyText = hit;
    break;
  }
  if (i % 8 === 7) console.log(`  …${i + 1}s agentRun调用: ${netAgentRun.length}`);
}

console.log("\n===== 结果 =====");
console.log(replied ? `✅ AI 已回复: ${replyText}` : "❌ 未回复（40s 内无「→ player（回复）」日志）");
console.log("\n-- agentRun 网络 --");
console.log(netAgentRun.length ? netAgentRun.join("\n") : "（无调用！）");
console.log("\n-- 关键 console --");
const keys = consoleLog.filter((l) => /\[sms\]|\[ai\]|sys_brain|brain|chatResult/i.test(l));
console.log(keys.length ? keys.slice(-25).join("\n") : "（无）");

await page.screenshot({ path: ".cache/e2e-sms-reply.png" });
console.log("截图: vue/.cache/e2e-sms-reply.png");
await browser.close();
process.exit(replied ? 0 : 1);