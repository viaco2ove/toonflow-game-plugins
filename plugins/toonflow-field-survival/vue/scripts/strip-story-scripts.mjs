#!/usr/bin/env node
/**
 * strip-story-scripts.mjs — 把地图集的 events/scripts/*.ts 预转译为 JS
 * ================================================================
 * 用途：规范.md「严重违规事项」——地图集业务脚本不进插件构建。
 *   事件引擎 run_script 动态加载故事包里的脚本：
 *     ① 安装态：故事包 events/scripts.js/<name>.js（本脚本生成，esbuild 剥类型）
 *     ② dev 态：/story-data 中间件对 .ts 现场转译（vite.config.ts）
 *
 * 用法：
 *   node scripts/strip-story-scripts.mjs <故事名> [故事名2 ...]
 *   node scripts/strip-story-scripts.mjs --all          # 全部地图集
 *
 * 输入：workshops/toonflow-field-survival/map_design/<故事>/events/scripts/*.ts
 * 输出：同目录 events/scripts.js/<name>.js（★ 生成物，勿手改；随 .tbg 分发）
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { transformSync } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const designRoot = join(repoRoot, "workshops/toonflow-field-survival/map_design");

const args = process.argv.slice(2);
let stories;
if (args.includes("--all")) {
  stories = readdirSync(designRoot).filter((n) =>
    existsSync(join(designRoot, n, "events", "scripts")),
  );
} else {
  stories = args;
  if (!stories.length) {
    console.error("用法: node scripts/strip-story-scripts.mjs <故事名>... | --all");
    process.exit(1);
  }
}

let total = 0;
for (const story of stories) {
  const srcDir = join(designRoot, story, "events", "scripts");
  const outDir = join(designRoot, story, "events", "scripts.js");
  if (!existsSync(srcDir)) {
    console.log(`[${story}] 无 events/scripts/，跳过`);
    continue;
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith(".ts")) continue;
    const src = readFileSync(join(srcDir, f), "utf-8");
    const js = transformSync(src, {
      loader: "ts",
      format: "esm",
      target: "es2020",
      charset: "utf8",
    }).code;
    writeFileSync(join(outDir, f.replace(/\.ts$/, ".js")), js, "utf-8");
    n++;
  }
  total += n;
  console.log(`[${story}] 转译 ${n} 个脚本 → events/scripts.js/`);
}
console.log(`完成：共 ${total} 个。该目录为生成物，随 .tbg 分发；改 .ts 后重跑本脚本。`);
