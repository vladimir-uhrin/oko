// scripts/meteo-bake.mjs
// Meteorológia sveta — offline pečenie GFS rezov do disk cache (2026-09-17,
// fáza 1 krok 2). Beží mimo dev servera (Scheduled Task po behu modelu), proxy
// /api/meteo (vite.config.js meteoProxy) potom cache len číta a upstream
// THREDDS dobíja len to, čo bake nestihol.
//
//   node scripts/meteo-bake.mjs              # všetky polia × kroky od teraz
//   node scripts/meteo-bake.mjs --field wind --steps 4   # len vietor, 4 kroky
//
// Zdroj: NOAA/NCEP GFS 0,25° (verejná doména USA) cez NSF Unidata THREDDS NCSS
// (demonštračný server komunity — šetrné tempo: sériovo, pauza medzi dopytmi,
// čestný User-Agent). Rovnaká rasterizácia ako proxy (src/data/meteoRasterize.js),
// takže PNG sú bitovo zhodné s tými z proxy.
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { METEO_FIELDS, forecastSteps } from '../src/data/meteoField.js';
import { parseNetcdf3 } from '../src/data/netcdf3.js';
import { rasterizeMeteoField, runIsoOf } from '../src/data/meteoRasterize.js';
import { retryFailedOnce } from './lib/meteoBakeRetry.mjs';

const NCSS = 'https://thredds.ucar.edu/thredds/ncss/grid/grib/NCEP/GFS/Global_0p25deg/Best';
const TIMEOUT_MS = 90_000;
const MAX_BYTES = 40 * 1024 * 1024;
const PAUSE_MS = 1500; // ohľad voči demo serveru: sériovo, 1,5 s medzi dopytmi
const USER_AGENT = 'OKO meteo-bake (personal, non-commercial; disk cache)';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const onlyField = arg('field');
const maxSteps = Number(arg('steps')) || Infinity;
const cacheDir = () => String(process.env.METEO_CACHE_DIR || '').trim() || path.join(process.cwd(), '.gev-cache', 'meteo');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSharp() {
  try { return (await import('sharp')).default; } catch { return null; }
}

function ncssUrl(field, iso) {
  const vars = field.vars.map((v) => `var=${encodeURIComponent(v)}`).join('&');
  const vert = Number.isFinite(field.vertCoord) ? `&vertCoord=${field.vertCoord}` : '';
  return `${NCSS}?${vars}&north=90&south=-90&west=-180&east=180&horizStride=1&time=${encodeURIComponent(iso)}${vert}&accept=netcdf`;
}

function paths(fieldId, iso) {
  const dir = path.join(cacheDir(), fieldId);
  const stem = iso.replace(/[:]/g, '');
  return { dir, png: path.join(dir, `${stem}.png`), meta: path.join(dir, `${stem}.json`) };
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

/** Pečie jeden rez; vracia 'baked' | 'skipped' | 'failed'. */
async function bakeOne(sharp, fieldId, iso, { force = false } = {}) {
  const field = METEO_FIELDS[fieldId];
  const p = paths(fieldId, iso);
  if (!force && (await exists(p.png)) && (await exists(p.meta))) return 'skipped';
  const res = await fetch(ncssUrl(field, iso), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`THREDDS HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('THREDDS: oversized');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('THREDDS: oversized');
  const nc = parseNetcdf3(buf);
  const run = runIsoOf(nc);
  const raster = rasterizeMeteoField(fieldId, nc);
  const png = await sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 4 } }).png({ compressionLevel: 6 }).toBuffer();
  await fsp.mkdir(p.dir, { recursive: true });
  await fsp.writeFile(p.png, png);
  await fsp.writeFile(p.meta, JSON.stringify({ run, fetchedAt: new Date().toISOString(), iso, field: fieldId, baked: true }));
  return 'baked';
}

async function main() {
  const sharp = await getSharp();
  if (!sharp) { console.error('sharp nie je dostupný (devDependency) — bake končí'); process.exit(1); }
  const steps = forecastSteps(Date.now()).slice(0, maxSteps);
  const fields = onlyField ? [onlyField] : Object.keys(METEO_FIELDS);
  if (onlyField && !METEO_FIELDS[onlyField]) { console.error(`neznáme pole: ${onlyField}`); process.exit(1); }
  const started = Date.now();
  const stats = { baked: 0, skipped: 0, failed: 0 };
  const failedSlices = [];
  console.log(`meteo-bake: ${fields.length} polí × ${steps.length} krokov → ${cacheDir()}`);
  for (const fieldId of fields) {
    for (const iso of steps) {
      try {
        const r = await bakeOne(sharp, fieldId, iso);
        stats[r === 'baked' ? 'baked' : 'skipped'] += 1;
        if (r === 'baked') { process.stdout.write(`${fieldId} ${iso} upečený\n`); await sleep(PAUSE_MS); }
      } catch (err) {
        stats.failed += 1;
        failedSlices.push({ fieldId, iso });
        process.stdout.write(`${fieldId} ${iso} ZLYHAL: ${err?.message || err}\n`);
        await sleep(PAUSE_MS * 4); // po chybe dlhšia pauza
      }
    }
  }
  // Druhý pokus (2026-10-08): THREDDS občas vráti HTTP 500 — po pauze ešte raz, až potom zlyhanie.
  const retry = await retryFailedOnce(failedSlices, ({ fieldId, iso }) => bakeOne(sharp, fieldId, iso), {
    onResult: ({ fieldId, iso }, ok, err) => process.stdout.write(`${fieldId} ${iso} ${ok ? 'upečený na druhý pokus' : `ZLYHAL aj na druhý pokus: ${err?.message || err}`}\n`),
  });
  stats.failed -= retry.recovered.length;
  stats.baked += retry.recovered.length;
  const min = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`meteo-bake hotový za ${min} min: ${stats.baked} upečených, ${stats.skipped} preskočených (cache), ${stats.failed} zlyhaní`);
  // Zlyhania nie sú fatálne (dobehne ďalší beh alebo proxy), ale hlásiť ich máme.
  if (stats.failed) process.exitCode = 2;
}

main().catch((err) => { console.error(`meteo-bake fatálna chyba: ${err?.message || err}`); process.exit(1); });
