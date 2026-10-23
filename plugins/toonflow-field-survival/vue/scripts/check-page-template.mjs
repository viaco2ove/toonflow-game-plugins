/**
 * ★ dev-host PAGE 模板「反斜杠吞字符」回归检查
 *
 * 背景：vite.config.ts 里的 `const PAGE = ` + 反引号 + `...` + 反引号 + ` 是一个 JS 模板字符串。
 * 模板字符串对「非法转义序列的单个反斜杠」不做保留，直接把反斜杠丢掉：
 *   \s → s    \d → d    \. → .    \/ → /    \+ → +
 * 后果分两类：
 *   1) 致命：正则里的 \/ 变成裸 / → 正则提前闭合 → 后面变成裸代码
 *            → SyntaxError → 浏览器整页白屏
 *   2) 静默：\s \d 变成裸字母 → 正则不再匹配 → 兜底逻辑算错但没有任何报错
 *
 * 本脚本做三件事：
 *   1) 扫描源码模板里所有「非法转义的单反斜杠」——问题的根因，逐条报出行号
 *   2) 渲染 PAGE 模板（把 ${...} 插值替换成占位符），抽 <script> 做语法检查
 *   3) 正则字面量「源码 vs 渲染后」语义比对（把源码按模板转义规则还原后比对）
 *
 * 合法模板转义： \n \r \t \b \f \v \0 \x \u \$ \` \\ 以及行续接
 * 其余全部会被吞。
 *
 * 用法：node scripts/check-page-template.mjs
 * 退出码 0 = 通过；非 0 = 有问题
 */
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execFileSync } from "child_process";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VITE_CFG = resolve(__dirname, "..", "vite.config.ts");

const src = readFileSync(VITE_CFG, "utf8");

const BT = String.fromCharCode(96); // 反引号
const PAGE_OPEN = "const PAGE = " + BT;
const start = src.indexOf(PAGE_OPEN);
if (start < 0) {
  console.error("✗ 未找到 PAGE 模板定义");
  process.exit(1);
}
const bodyStart = start + PAGE_OPEN.length;
const end = src.indexOf(BT + ";", bodyStart);
if (end < 0) {
  console.error("✗ 未找到 PAGE 模板结束位置");
  process.exit(1);
}
/** 模板正文（含 ${...} 插值） */
const tpl = src.slice(bodyStart, end);

/* ${...} 插值内部是**真正的 TS 代码**，不在模板字符串里，
 * 反斜杠规则完全不同（那里 \\ 是正常的双写）。必须从检查范围里排除。 */
const tplNoInterp = tpl.replace(/\$\{[^}]*\}/g, "__STUB__");

/* ============================================================
 * 1) 扫描非法转义的单反斜杠
 * ========================================================== */
const VALID_ESCAPES = new Set(["n", "r", "t", "b", "f", "v", "0", "x", "u", "$", BT, "\\", "\n", "\r"]);

const invalid = [];
{
  // 先算出每一行「是否处于注释里」：注释里的反斜杠无害（不会被执行）
  const tplLines = tplNoInterp.split("\n");
  const inComment = new Array(tplLines.length).fill(false);
  let inBlock = false;
  for (let i = 0; i < tplLines.length; i++) {
    const L = tplLines[i];
    if (inBlock) {
      inComment[i] = true;
      if (L.includes("*/")) inBlock = false;
      continue;
    }
    const ci = L.indexOf("//");
    const bi = L.indexOf("/*");
    if (bi >= 0 && (ci < 0 || bi < ci)) {
      inComment[i] = true;
      if (!L.includes("*/", bi + 2)) inBlock = true;
      continue;
    }
    if (ci >= 0) inComment[i] = true;
  }

  let line = 1;
  let col = 0;
  for (let i = 0; i < tplNoInterp.length; i++) {
    const c = tplNoInterp[i];
    if (c === "\n") { line++; col = 0; continue; }
    col++;
    if (c !== "\\") continue;
    const next = tplNoInterp[i + 1];
    if (next === undefined) {
      invalid.push({ line, col, ch: "(EOF)", snippet: "末尾孤立反斜杠" });
      break;
    }
    if (VALID_ESCAPES.has(next)) {
      if (next === "\n") { line++; col = 0; }
      else col++;
      i++;
      continue;
    }
    const snippet = tplNoInterp.slice(Math.max(0, i - 30), Math.min(tpl.length, i + 30)).replace(/\n/g, " ");
    invalid.push({ line, col, ch: next, snippet, comment: !!inComment[line - 1] });
    i++;
    col++;
  }
}

/* ============================================================
 * 2) 渲染 + 语法检查
 * ========================================================== */
const stubbed = tpl.replace(/\$\{[^}]*\}/g, "__STUB__");
let rendered;
try {
  rendered = new Function("return " + BT + stubbed + BT + ";")();
} catch (e) {
  console.error("✗ PAGE 模板渲染失败:", e.message);
  process.exit(1);
}

const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g;
let m;
let blocks = 0;
let syntaxFail = false;
const tmpDir = mkdtempSync(resolve(tmpdir(), "pagechk-"));
while ((m = scriptRe.exec(rendered)) !== null) {
  blocks++;
  const f = resolve(tmpDir, "blk" + blocks + ".js");
  writeFileSync(f, m[1]);
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    syntaxFail = true;
    const err = e.stderr?.toString() || e.message;
    console.error("✗ 渲染后 <script> #" + blocks + " 语法错误:");
    console.error("   " + err.split("\n").slice(0, 8).join("\n   "));
    const lm = err.match(/blk\d+\.js:(\d+)/);
    if (lm) {
      const ln = Number(lm[1]);
      const lines = m[1].split("\n");
      for (let i = Math.max(0, ln - 3); i < Math.min(lines.length, ln + 2); i++) {
        console.error("   " + (i + 1 === ln ? ">>" : "  ") + " " + (i + 1) + ": " + lines[i]);
      }
    }
  } finally {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
}

/* ============================================================
 * 3) 正则字面量语义比对
 * ========================================================== */
function templateUnescape(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") { out += s[i]; continue; }
    const n = s[i + 1];
    if (n === undefined) { out += "\\"; break; }
    if (VALID_ESCAPES.has(n)) {
      if (n === "n") out += "\n";
      else if (n === "r") out += "\r";
      else if (n === "t") out += "\t";
      else if (n === "b") out += "\b";
      else if (n === "f") out += "\f";
      else if (n === "v") out += "\v";
      else if (n === "0") out += "\0";
      else if (n === "x") { out += "\\x" + (s[i + 2] || "") + (s[i + 3] || ""); i += 3; }
      else if (n === "u") { out += "\\u" + (s[i + 2] || "") + (s[i + 3] || "") + (s[i + 4] || "") + (s[i + 5] || ""); i += 5; }
      else out += n;
      i++;
      continue;
    }
    // 非法转义：反斜杠被吞
    out += n;
    i++;
  }
  return out;
}

const RE_LITERAL = /\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\n\\])+\/[gimsuy]*/g;
function collectRe(s) {
  const out = [];
  let mm;
  const r = new RegExp(RE_LITERAL.source, "g");
  while ((mm = r.exec(s)) !== null) out.push(mm[0]);
  return out;
}
const srcRes = collectRe(tplNoInterp);
const outRes = collectRe(rendered);
// 只关心「源码里含非法转义、因此语义被改变」的正则
const mangled = srcRes.filter((r) => {
  if (!/[\\]/.test(r)) return false; // 源码里没有反斜杠 → 模板不可能改变它
  const expected = templateUnescape(r);
  if (expected === r) return false; // 源码里全是合法转义 → 语义不变
  return !outRes.includes(expected);
});

/* ============================================================
 * 报告
 * ========================================================== */
let bad = 0;

const realInvalid = invalid.filter((v) => !v.comment);
if (realInvalid.length) {
  bad++;
  console.error("✗ PAGE 模板里有 " + realInvalid.length + " 处「非法转义的单反斜杠」（会被模板静默吞掉）:");
  for (const v of realInvalid) {
    console.error("   模板第 " + v.line + " 行: \\" + v.ch + "  →  会变成 " + JSON.stringify(v.ch));
    console.error("      ..." + v.snippet + "...");
  }
  console.error("\n   修复：改用 new RegExp(\"...\") 字符串形式；");
  console.error("        或把反斜杠双写成 \\\\s \\\\d \\\\/（模板里 \\s 被吞，双写才安全）。");
}
const commentInvalid = invalid.length - realInvalid.length;
if (commentInvalid > 0) {
  console.log("· 另有 " + commentInvalid + " 处在注释里（无害，已忽略）。");
}

if (syntaxFail) {
  bad++;
  console.error("\n✗ 渲染后的页面 JS 有语法错误 —— 浏览器会直接白屏。");
}

if (mangled.length) {
  bad++;
  console.error("\n✗ 以下正则字面量在渲染后语义已改变（被吞掉反斜杠）:");
  for (const r of mangled) console.error("   " + JSON.stringify(r) + "  →  " + JSON.stringify(templateUnescape(r)));
}

if (bad === 0) {
  console.log("✓ PAGE 模板检查通过：" + blocks + " 个 <script> 块语法正常，" +
    srcRes.length + " 个正则字面量全部完好，无非法转义。");
  process.exit(0);
}
console.error("\n✗ PAGE 模板检查失败（" + bad + " 项）。");
process.exit(1);