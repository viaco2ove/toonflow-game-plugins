/**
 * 验证 mapConfig.normalizeTiledMap 对 entity_type=FURNITURE 的处理：
 * 期望 → 进 decorations（kind=npc、无名字、variant=gid-1），且不触发「未识别类型」warn。
 */
import "./_stub_window";
import { normalizeTiledMap, ENGINE_NON_MOB_ENTITY_TYPES } from "../src/mapConfig";

console.log("FURNITURE in ENGINE_NON_MOB_ENTITY_TYPES:", ENGINE_NON_MOB_ENTITY_TYPES.has("FURNITURE"));

const tiled = {
  width: 20,
  height: 20,
  tilewidth: 32,
  tileheight: 32,
  layers: [
    {
      type: "objectgroup",
      name: "objects",
      objects: [
        {
          id: 1,
          name: "",
          type: "",
          x: 64, y: 96,
          width: 32, height: 32,
          gid: 5009,
          properties: [
            { name: "entity_type", type: "string", value: "FURNITURE" },
          ],
        },
        {
          id: 2,
          name: "",
          type: "",
          x: 128, y: 96,
          width: 32, height: 32,
          gid: 5010,
          properties: [
            { name: "entity_type", type: "string", value: "FURNITURE" },
            { name: "camp", type: "string", value: "neutral" },
          ],
        },
      ],
    },
  ],
};

const cfg = normalizeTiledMap(tiled as any, "test");
const furn = cfg.decorations.filter((d: any) => d.id.startsWith("f_"));
console.log("furniture decorations:", JSON.stringify(furn, null, 2));
if (furn.length !== 2) {
  console.error("FAIL: expected 2 furniture decorations, got", furn.length);
  process.exit(1);
}
const d0 = furn[0] as any;
if (d0.kind !== "npc" || d0.name !== "" || d0.variant !== 5008 || d0.wanders !== false) {
  console.error("FAIL: unexpected fields:", d0);
  process.exit(1);
}
console.log("PASS: FURNITURE → decoration, variant=gid-1, 无名字, 不游走");
