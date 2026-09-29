#!/usr/bin/env node
/**
 * 解析 npm 命令行参数（--story xxx / --conn），设置 env 后启动 vite。
 * 用法：
 *   npm run debug -- --story 赦夜人冥夜走廊-第二季 --conn
 *   npm run debug --story=赦夜人冥夜走廊-第二季 --conn=
 *   npm run debug                          (等同 debug:story)
 */
const { spawn } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);
let story = process.env.STORY || "赦夜人冥夜走廊-第二季";
let conn = process.env.CONN || "";

// 解析 --story <value> 或 --story=<value>
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--story" && args[i + 1]) { story = args[i + 1]; i++; }
  else if (a.startsWith("--story=")) { story = a.slice("--story=".length); }
  else if (a === "--conn") { conn = "1"; }
  else if (a.startsWith("--conn=")) { conn = a.slice("--conn=".length); }
}

const env = { ...process.env, STORY: story, CONN: conn };
console.log("[debug.js] STORY =", story);
console.log("[debug.js] CONN  =", conn || "(空 → standalone)");
console.log("[debug.js] 启动 vite --mode debug …");

const child = spawn("npx", ["vite", "--mode", "debug"], {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT",  () => { try { child.kill("SIGINT");  } catch {} });
process.on("SIGTERM", () => { try { child.kill("SIGTERM"); } catch {} });