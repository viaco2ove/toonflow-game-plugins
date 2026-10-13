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
      // deflate raw
      const stream = new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      bytes = new Uint8Array(await stream);
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

/** 是否 Tiled 导出格式（layers + width + tilewidth）——排除 first.map.json/story.json 等 metadata */
function isTiledJson(raw: Uint8Array): boolean {
  try {
    const o = JSON.parse(new TextDecoder().decode(raw));
    return Array.isArray(o?.layers) && (o?.tilewidth || o?.tileheight) && o?.width;
  } catch {
    return false;
  }
}

export interface TbgVisFiles {
  /** 文件名(不含 .json，如 mulberryTown) → 原始 Tiled JSON */
  files: Record<string, any>;
  /** first.map.json 解析结果（开局起始图声明），可选 */
  first: any;
}

/**
 * 把 .tbg 的 base64 数据解成「视觉 Tiled 文件集」。
 * 规则与 App.vue onUploadMap 一致：取 maps/ 下（排除 maps/bak/）全部 Tiled json 作 files，
 * first.map.json 作 first。找不到任何 Tiled 图返回 null。
 */
export async function tbgToVisFiles(b64: string): Promise<TbgVisFiles | null> {
  try {
    const buf = b64ToUint8Array(b64);
    const entries = await readZipEntries(buf);
    const files: Record<string, any> = {};
    let first: any = null;
    for (const e of entries) {
      if (/maps\/bak\//i.test(e.name)) continue;
      const fm = /(?:^|\/)maps\/([^/]+)\.json$/i.exec(e.name);
      if (fm && isTiledJson(e.bytes)) {
        try { files[fm[1]] = JSON.parse(new TextDecoder().decode(e.bytes)); } catch { /* skip */ }
      }
      const ff = /(?:^|\/)first\.map\.json$/i.exec(e.name);
      if (ff && !first) {
        try { first = JSON.parse(new TextDecoder().decode(e.bytes)); } catch { /* skip */ }
      }
    }
    if (Object.keys(files).length === 0) return null;
    return { files, first };
  } catch {
    return null;
  }
}
