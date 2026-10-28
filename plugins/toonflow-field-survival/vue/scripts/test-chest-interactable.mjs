/**
 * mapConfig CHEST 识别逻辑验证
 * 运行：node scripts/test-chest-interactable.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ → vue/ → toonflow-field-survival/ → plugins/ → toonflow-game-plugins/
const repoRoot = join(__dirname, "../../../..");
const mapFile = join(repoRoot, "workshops/toonflow-field-survival/map_design/通天传授-收徒系统/maps/mulberryTown.json");

const m = JSON.parse(readFileSync(mapFile, "utf-8"));

// 复刻 mapConfig.ts 的 hasChestName 逻辑
function hasChestName(props) {
  const fullName = props.full_name != null ? String(props.full_name).trim() : "";
  const propName = String(props.name || "").trim();
  const dialog = typeof props.dialog === "string" ? props.dialog.trim() : "";
  return !!fullName || !!propName || !!dialog;
}

console.log("\n=== CHEST 实体可交互性判定 ===");
let interactable = 0, skipped = 0;
for (const layer of m.layers || []) {
  for (const obj of layer.objects || []) {
    const props = Object.fromEntries((obj.properties || []).map(p => [p.name, p.value]));
    if (props.entity_type !== "CHEST") continue;
    const ok = hasChestName(props);
    const label = props.full_name || props.name || obj.name || "(无名)";
    if (ok) { interactable++; console.log(`  ✓ 可交互  uid=${obj.id}  ${label}`); }
    else { skipped++; console.log(`  · 跳过    uid=${obj.id}  ${label}`); }
  }
}
console.log(`\n  → ${interactable} 个可交互设施 / ${skipped} 个普通掉落宝箱占位`);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " → " + detail : ""}`); }
}
console.log("\n=== 断言 ===");
check("炼丹炉（uid=257）被识别为可交互", m.layers.some(l => l.objects?.some(o => o.id === 257 && hasChestName(Object.fromEntries((o.properties||[]).map(p=>[p.name,p.value]))))));
check("无名 CHEST 保持跳过（不进 npcs[]）", m.layers.some(l => l.objects?.some(o => o.id === 157 && !hasChestName(Object.fromEntries((o.properties||[]).map(p=>[p.name,p.value]))))));
check("可交互 CHEST 数量有限（< 10）", interactable < 10, `实际 ${interactable}`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);