// Vrstva mapy otrasov USGS na glóbus (2026-10-11): PNG intenzity + world file → súradnice; slabé otrasy (I–III)
// priehľadné, ostatné polopriehľadné. Spoločné pre video o zemetrasení a súhrn týždňa.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { overlayAlpha, shakemapOverlayUrls, worldFileBbox } from '../../src/data/quakeMedia.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = createRequire(path.join(ROOT, 'package.json'))('sharp');
export const QUAKE_UA = { 'user-agent': 'OKO-quake-bot/0.1 (https://okolive.sk) node-fetch' };

/** @returns {Promise<{file: string, bbox: number[]}|null>} */
export async function shakemapOverlay(detail, outDir, { fetchImpl = globalThis.fetch } = {}) {
  const ov = shakemapOverlayUrls(detail);
  if (!ov) return null;
  const res = await fetchImpl(ov.png, { headers: QUAKE_UA, signal: AbortSignal.timeout(60_000) });
  if (!res.ok || !/^image\/png/.test(res.headers.get('content-type') || '')) throw new Error(`vrstva otrasov: HTTP ${res.status}`);
  const pngw = await (await fetchImpl(ov.pngw, { headers: QUAKE_UA, signal: AbortSignal.timeout(30_000) })).text();
  fs.mkdirSync(outDir, { recursive: true });
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) data[i + 3] = overlayAlpha(data[i], data[i + 1], data[i + 2]);
  const file = path.join(outDir, 'shakemap-vrstva.png');
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file);
  const bbox = worldFileBbox(pngw, info.width, info.height);
  return bbox ? { file, bbox } : null;
}
