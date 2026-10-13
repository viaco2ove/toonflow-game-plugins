/**
 * zipTbg — .tbg（zip）地图包解析（零依赖）
 *
 * 从 App.vue 移植的最小 zip 解析器（store/deflate，浏览器原生 DecompressionStream），
 * 加上 base64 → Uint8Array 与「.tbg → 视觉 Tiled 文件集」提取，供：
 *   - App.vue onUploadMap（上传 .tbg 换视觉世界）
 *   - storyMap.ts（会话 map_visual 里是 {format:"tbg", data:base64} 模板时解包）
 * 共用同一份实现，避免两处解析规则漂移。
 */

/** 最小 zip 解析器（0/store + 8/deflate）。返回 [{name, bytes}]。 */
export async function readZipEntries(buf: Uint8Array): Promise<{ name: string; bytes: Uint8Array }[]> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error("不是 zip 文件（magic mismatch）");
  const entries: { name: string; bytes: Uint8Array }[] = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const sig = dv.getUint32(off, true);
    if (sig !== 0x04034b50) break;
    const method = dv.getUint16(off + 8, true);
    const compSize = dv.getUint32(off + 18, true);
    const uncompSize = dv.getUint32(off + 22, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const nameBytes = buf.slice(off + 30, off + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    const dataStart = off + 30 + nameLen + extraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    let bytes: Uint8Array;
    if (method === 0) {
      bytes = data;
    } else if (method === 8) {
      // deflate raw（zip method 8 是 raw deflate，无 zlib header/wrapper）
      // ★ 必须 await：否则 bytes 变成空 Uint8Array，JSON.parse / 解码全是空串
      const ab = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      bytes = new Uint8Array(ab);
    } else {
      throw new Error(`不支持的 zip method=${method}（仅 store/deflate）`);
    }
    if (uncompSize !== 0 && name && !name.endsWith("/")) entries.push({ name, bytes });
    off = dataStart + compSize;
  }
  return entries;
}

/** base64（ASCII）→ Uint8Array */
export function b64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 是否 Tiled 导出格式（layers + width + tilewidth）——保留备用，目前 zip 解包不再用 */
function isTiledJson(raw: Uint8Array): boolean {
  try {
    const o = JSON.parse(new TextDecoder().decode(raw));
    return Array.isArray(o?.layers) && (o?.tilewidth || o?.tileheight) && o?.width;
  } catch {
    return false;
  }
}

export interface TbgVisFiles {
  /**
   * zip 内**全量** entries（按原 zip 路径作为 key，含 maps/、tileset、images/、story.json 等）。
   *   - maps/*.json → 已 JSON.parse 的对象
   *   - 其它 .json → 已 JSON.parse 的对象（story.json / entity_types.json / compiled_dawnlike.json 等）
   *   - 其它二进制（.png/.gif/.xlsx/...）→ Uint8Array
   * 历史版本只取 maps/*.json，会丢掉 tileset/images，导致切故事时 tileset 不变。
   * 现在保留全量：故事 A 用 A 的 tileset/story.json，故事 B 用 B 的，互不污染。
   */
  files: Record<string, any>;
  /**
   * 便利字段：maps/<name>.json 的解析结果（key 不含 maps/ 前缀、不含 .json），
   * 关卡名 → Tiled JSON 映射，与 loadMapConfig(levelName) 内部的 levelNameToFile 对齐。
   * 历史形态① 消费者（loadMapConfig / loadLevelByName）继续走这个。
   */
  mapFiles: Record<string, any>;
  /** first.map.json 解析结果（开局起始图声明），可选 */
  first: any;
  /** story.json 解析结果（故事元数据），可选 */
  story: any;
  /** entity_types.json 解析结果（地图 entity 类型表），可选 */
  entityTypes: any;
  /** compiled_dawnlike.json 解析结果（tileset 属性表，碰撞/视线判定），可选 */
  tileset: any;
}

/**
 * 把 .tbg 的 base64 数据解成「完整视觉地图集」——
 * 取 zip 内**全量** entries（排除 bak/ 备份目录、test_data/ 测试数据），按 zip 路径作为 key。
 * 附加便利字段：mapFiles（maps/*.json 索引）、first/story/entityTypes/tileset 直接可读。
 */
export async function tbgToVisFiles(b64: string): Promise<TbgVisFiles | null> {
  try {
    const buf = b64ToUint8Array(b64);
    const entries = await readZipEntries(buf);
    const files: Record<string, any> = {};
    const mapFiles: Record<string, any> = {};
    let first: any = null;
    let story: any = null;
    let entityTypes: any = null;
    let tileset: any = null;
    for (const e of entries) {
      // 跳过 bak 备份 / test_data 测试数据（不应进入运行时视觉）
      if (/(^|\/)bak\//i.test(e.name)) continue;
      if (/(^|\/)test_data\//i.test(e.name)) continue;
      const name = e.name;
      const lower = name.toLowerCase();
      const isJson = lower.endsWith(".json");
      const isTiledMap = /^maps\/[^/]+\.json$/i.test(name);
      let value: any = e.bytes; // 默认存原始 bytes
      if (isJson) {
        try { value = JSON.parse(new TextDecoder().decode(e.bytes)); } catch { /* 解析失败就当 bytes 存 */ }
      }
      files[name] = value;
      // 便利索引
      if (isTiledMap && value && typeof value === "object" && Array.isArray(value.layers)) {
        const key = name.replace(/^maps\//i, "").replace(/\.json$/i, "");
        mapFiles[key] = value;
      }
      if (/(^|\/)first\.map\.json$/i.test(name) && value && typeof value === "object" && !first) {
        first = value;
      }
      if (/(^|\/)story\.json$/i.test(name) && value && typeof value === "object" && !story) {
        story = value;
      }
      if (/(^|\/)entity_types\.json$/i.test(name) && value && typeof value === "object" && !entityTypes) {
        entityTypes = value;
      }
      if (/(^|\/)compiled_dawnlike\.json$/i.test(name) && value && typeof value === "object" && !tileset) {
        tileset = value;
      }
    }
    if (Object.keys(files).length === 0) return null;
    return { files, mapFiles, first, story, entityTypes, tileset };
  } catch {
    return null;
  }
}
