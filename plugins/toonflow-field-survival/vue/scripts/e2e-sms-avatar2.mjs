/**
 * scripts/e2e-sms-avatar2.mjs — 气泡头像/名称验证（带发消息）
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("D:/nvm4w/nodejs/node_modules/@playwright/test/index.js");

const CHROME_EXE =
  "C:/Users/viaco/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";

const browser = await chromium.launch({ headless: true, executablePath: CHROME_EXE });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2500);
const frame = await (await page.$("#game")).contentFrame();

for (let i = 0; i < 25; i++) {
  const ph = await frame.evaluate(() => window.__FS_DEBUG__?.state?.phase || null).catch(() => null);
  if (ph === "playing") break;
  if (ph === "select") {
    await frame.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /开始|进入/.test(x.textContent || ""));
      if (b) b.click();
    }).catch(() => {});
  }
  await page.waitForTimeout(1000);
}

// 发消息（触发 AI 回复）
const sent = await frame.evaluate(async () => {
  try {
    const ss = document.querySelector("#app").__vue_app__._instance.setupState;
    const contacts = ss.sysSmsContacts?.value ?? ss.sysSmsContacts ?? [];
    const c = contacts.find((x) => (x.name || "").includes("陈南璇"));
    if (!c) return { err: "no contact" };
    ss.onSysSmsStartChat(c.id);
    await new Promise((r) => setTimeout(r, 400));
    const convId = ss.smsView?.activeConvId?.value ?? ss.smsView?.activeConvId ?? "";
    await ss.onSysSmsSend(convId, "你好");
    return { ok: true };
  } catch (e) { return { err: String(e).slice(0, 120) }; }
}).catch((e) => ({ err: String(e).slice(0, 120) }));
console.log("发送:", JSON.stringify(sent));

// 等 AI 回复落库（监听 console）
let replied = false;
page.on("console", (m) => {
  if (/→ player（回复）/.test(m.text())) replied = true;
});
for (let i = 0; i < 40 && !replied; i++) await page.waitForTimeout(1000);
console.log(replied ? "AI 已回复" : "AI 未回复（继续截图看玩家消息气泡）");

// 打开面板：通信 tab
await frame.evaluate(() => {
  const btn = document.querySelector(".sys-btn") ||
    [...document.querySelectorAll("button, [class*='btn']")].find((b) => /齿轮|系统|⚙/.test(b.textContent || b.title || ""));
  if (btn) btn.click();
}).catch(() => {});
await page.waitForTimeout(800);
await frame.evaluate(() => {
  const tab = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("通信"));
  if (tab) tab.click();
}).catch(() => {});
await page.waitForTimeout(1000);

const diag = await frame.evaluate(() => {
  const msgRows = [...document.querySelectorAll(".msg-row")].slice(0, 6).map((row) => ({
    cls: row.className,
    avatarImg: !!row.querySelector(".msg-avatar-img"),
    avatarText: row.querySelector(".msg-avatar")?.textContent?.trim().slice(0, 4),
    sender: row.querySelector(".msg-sender")?.textContent?.trim() || null,
    bubble: row.querySelector(".msg-bubble")?.textContent?.trim().slice(0, 30),
  }));
  const imgs = [...document.querySelectorAll(".msg-avatar-img, .conv-avatar-img")].map((i) => (i.src || "").slice(-50));
  return { msgRows, imgs };
}).catch((e) => ({ err: String(e).slice(0, 150) }));
console.log("气泡诊断:", JSON.stringify(diag, null, 1));

await page.screenshot({ path: ".cache/e2e-sms-avatar2.png" });
console.log("截图: vue/.cache/e2e-sms-avatar2.png");
await browser.close();