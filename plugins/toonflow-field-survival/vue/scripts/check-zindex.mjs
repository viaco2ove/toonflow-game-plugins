/**
 * 打印 App.vue 里各 UI 层的 z-index / position，用于核对层级关系
 * 运行：node scripts/check-zindex.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dirname, "../src/App.vue"), "utf-8");

function pick(sel, prop) {
  const re = new RegExp("\\." + sel + "\\s*\\{[^}]*?" + prop + ":\\s*([\\w-]+)", "s");
  const m = app.match(re);
  return m ? m[1] : "?";
}

const rows = [
  "ev-confirm-overlay",
  "hud-toast",
  "forge-panel",
  "sys-panel",
  "sys-btn",
  "quest-panel",
  "chat-panel",
];

console.log("层级关系（越大越靠上）：\n");
const list = rows.map((s) => ({ s, z: Number(pick(s, "z-index")) || 0, p: pick(s, "position") }));
list.sort((a, b) => b.z - a.z);
for (const r of list) {
  console.log(`  z-index=${String(r.z).padStart(6)}  position=${r.p.padEnd(9)}  .${r.s}`);
}

const overlay = list.find((r) => r.s === "ev-confirm-overlay");
const toast = list.find((r) => r.s === "hud-toast");
const panels = list.filter((r) => ["forge-panel", "sys-panel", "sys-btn", "quest-panel", "chat-panel"].includes(r.s));
const bad = panels.filter((p) => p.z >= overlay.z || p.z >= toast.z);
console.log(`\n模态层 z=${overlay.z} / 飘字层 z=${toast.z}`);
if (bad.length) {
  console.log("❌ 仍被压住的层：" + bad.map((b) => `.${b.s}(${b.z})`).join(", "));
  process.exit(1);
}
console.log("✓ 所有面板都在模态层/飘字层之下");
