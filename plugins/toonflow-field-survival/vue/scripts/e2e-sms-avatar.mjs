/**
 * scripts/e2e-sms-avatar.mjs — 短信头像/名称显示验证
 *
 * 打开页面 → 进游戏 → 打开系统面板通信 tab → 发起单聊 → 截图确认：
 *   1. 会话列表头像是否为图片（非「陈」字块）
 *   2. 聊天气泡旁是否显示头像图 + 发送者名
 *
 * 运行：node scripts/e2e-sms-avatar.mjs
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

// 进游戏
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
console.log("phase =", await frame.evaluate(() => window.__FS_DEBUG__?.state?.phase).catch(() => null));

// 发起单聊（走真实链路建会话）
const start = await frame.evaluate(async () => {
  try {
    const ss = document.querySelector("#app").__vue_app__._instance.setupState;
    const contacts = ss.sysSmsContacts?.value ?? ss.sysSmsContacts ?? [];
    const c = contacts.find((x) => (x.name || "").includes("陈南璇"));
    if (!c) return { err: "通讯录无陈南璇: " + contacts.map((x) => x.name).join(",") };
    ss.onSysSmsStartChat(c.id);
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true, id: c.id, name: c.name };
  } catch (e) { return { err: String(e).slice(0, 150) }; }
}).catch((e) => ({ err: String(e).slice(0, 150) }));
console.log("单聊:", JSON.stringify(start));

// 打开系统面板 + 通信 tab（点左上角齿轮按钮 + 通信 tab）
await frame.evaluate(() => {
  // 系统按钮：.sys-btn 或齿轮
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

// 诊断：数一数页面里的头像 img 和文字头像
const diag = await frame.evaluate(() => {
  const imgs = [...document.querySelectorAll(".conv-avatar-img, .msg-avatar-img")];
  const convAvatar = document.querySelector(".conv-avatar");
  const msgAvatars = [...document.querySelectorAll(".msg-avatar")].slice(0, 4).map((el) => el.textContent?.trim().slice(0, 6));
  const senders = [...document.querySelectorAll(".msg-sender")].slice(0, 4).map((el) => el.textContent?.trim());
  return {
    imgCount: imgs.length,
    imgSrcSample: imgs.slice(0, 2).map((i) => (i.src || "").slice(-60)),
    convAvatarText: convAvatar?.textContent?.trim().slice(0, 6) || null,
    msgAvatarTexts: msgAvatars,
    senderNames: senders,
  };
}).catch((e) => ({ err: String(e).slice(0, 150) }));
console.log("头像诊断:", JSON.stringify(diag, null, 1));

await page.screenshot({ path: ".cache/e2e-sms-avatar.png" });
console.log("截图: vue/.cache/e2e-sms-avatar.png");
await browser.close();