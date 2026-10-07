// src/data/sentinel3FrpService.js — sťahovanie požiarov Sentinel-3 z Copernicus Data Space (2026-10-07).
//
// Kľúč: OAuth klient „OKO“ (client credentials, CDSE_CLIENT_ID / CDSE_CLIENT_SECRET v .env, platí do
// 2027-10-07) — len na serveri. Postup: token (30 min) → katalóg OData (granuly SL_2_FRP NRT za 24 h,
// ~900/deň) → každý granul RAZ stiahnuť (zipper, 1–3,5 MB), z CSV vytiahnuť ohniská a uložiť len ich
// (`<cacheDir>/<meno>.json`, ZIP sa nezapisuje). Sťahuje sa na pozadí po 2 naraz (CDSE dovoľuje 4),
// nikdy neblokuje odpoveď /api/firms — tá dostane, čo je už stiahnuté. Prvé naplnenie 24 h trvá desiatky
// minút (~1,5 GB), potom ~20 granúl za 30 min.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { S3_FRP_CSV, extractZipEntry, parseS3FrpCsv, s3FrpCatalogFilter, s3GranuleStartMs } from './sentinel3Frp.js';

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const CATALOG_URL = 'https://catalogue.dataspace.copernicus.eu/odata/v1/Products';
const ZIPPER_URL = 'https://zipper.dataspace.copernicus.eu/odata/v1/Products';
const WINDOW_MS = 24 * 3600_000;

/**
 * @param {{clientId: string, clientSecret: string, cacheDir: string, fetchImpl?: typeof fetch,
 *   now?: () => number, concurrency?: number, log?: (msg: string) => void}} opts
 */
export function createSentinel3FrpService({ clientId, clientSecret, cacheDir, fetchImpl = fetch, now = () => Date.now(), concurrency = 2, log = () => {} }) {
  /** @type {Map<string, {startMs: number, fires: Array<object>}>} meno granulu → ohniská */
  const granules = new Map();
  let token = null; let tokenExp = 0;
  let syncing = null;
  let lastSync = { at: 0, catalog: 0, downloaded: 0, failed: 0, error: null };
  let diskLoaded = false;

  const enabled = () => Boolean(clientId && clientSecret);

  let tokenInflight = null;
  /** Token (single-flight: súbežné sťahovania si ho nepýtajú každé zvlášť). */
  function getToken() {
    if (token && now() < tokenExp - 60_000) return Promise.resolve(token);
    if (!tokenInflight) {
      tokenInflight = (async () => {
        const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }), signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`CDSE token HTTP ${res.status}`);
        const j = await res.json();
        token = j.access_token; tokenExp = now() + (Number(j.expires_in) || 600) * 1000;
        return token;
      })().finally(() => { tokenInflight = null; });
    }
    return tokenInflight;
  }

  async function loadDisk() {
    if (diskLoaded) return;
    diskLoaded = true;
    let names = [];
    try { names = (await fsp.readdir(cacheDir)).filter((n) => n.endsWith('.json')); } catch { return; }
    for (const file of names) {
      const name = file.slice(0, -5);
      const startMs = s3GranuleStartMs(name);
      if (!(now() - startMs < WINDOW_MS)) { await fsp.unlink(path.join(cacheDir, file)).catch(() => {}); continue; }
      try { granules.set(name, { startMs, fires: JSON.parse(await fsp.readFile(path.join(cacheDir, file), 'utf8')) }); } catch { /* poškodený */ }
    }
  }

  async function catalog(sinceIso) {
    const out = [];
    let url = `${CATALOG_URL}?$filter=${encodeURIComponent(s3FrpCatalogFilter(sinceIso))}&$orderby=ContentDate/Start desc&$top=1000`;
    for (let page = 0; url && page < 3; page += 1) {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`CDSE catalog HTTP ${res.status}`);
      const j = await res.json();
      for (const p of j.value || []) out.push({ id: p.Id, name: String(p.Name || '').replace(/\.SEN3$/, '') });
      url = j['@odata.nextLink'] || null;
    }
    return out;
  }

  async function download(item) {
    const res = await fetchImpl(`${ZIPPER_URL}(${item.id})/$value`, { headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`CDSE download HTTP ${res.status}`);
    const csv = extractZipEntry(Buffer.from(await res.arrayBuffer()), (n) => n.endsWith(S3_FRP_CSV));
    if (!csv) throw new Error('CSV not found in product');
    const fires = parseS3FrpCsv(csv.toString('utf8'));
    granules.set(item.name, { startMs: s3GranuleStartMs(item.name), fires });
    await fsp.mkdir(cacheDir, { recursive: true });
    await fsp.writeFile(path.join(cacheDir, `${item.name}.json`), JSON.stringify(fires), 'utf8');
    return fires.length;
  }

  /** Jeden prechod: katalóg → stiahnuť chýbajúce (po `concurrency`). */
  async function syncOnce() {
    await loadDisk();
    const t = now();
    for (const [name, g] of granules) if (!(t - g.startMs < WINDOW_MS)) { granules.delete(name); void fsp.unlink(path.join(cacheDir, `${name}.json`)).catch(() => {}); }
    const items = await catalog(new Date(t - WINDOW_MS).toISOString());
    const missing = items.filter((i) => !granules.has(i.name));
    let downloaded = 0; let failed = 0; let fires = 0;
    const queue = [...missing];
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try { const n = await download(item); fires += n; downloaded += 1; } catch (err) { failed += 1; if (failed <= 3) log(`[sentinel3-frp] ${item.name}: ${err?.message || err}`); }
      }
    }));
    lastSync = { at: now(), catalog: items.length, downloaded, failed, error: null };
    if (downloaded || failed) log(`[sentinel3-frp] katalóg ${items.length}, stiahnuté ${downloaded} (${fires} ohnísk), zlyhalo ${failed}, v pamäti ${granules.size}`);
    return lastSync;
  }

  /** Spustí prechod na pozadí, ak ešte nebeží (single-flight). */
  function sync() {
    if (!enabled()) return Promise.resolve(null);
    if (!syncing) {
      syncing = syncOnce().catch((err) => { lastSync = { ...lastSync, at: now(), error: String(err?.message || err) }; log(`[sentinel3-frp] sync failed: ${lastSync.error}`); return null; })
        .finally(() => { syncing = null; });
    }
    return syncing;
  }

  /** Ohniská za posledných 24 h z už stiahnutých granúl (synchronne, bez siete). */
  function fires() {
    const t = now();
    const out = [];
    for (const g of granules.values()) if (t - g.startMs < WINDOW_MS) out.push(...g.fires);
    return out;
  }

  return { enabled, sync, fires, loadDisk, status: () => ({ enabled: enabled(), granules: granules.size, syncing: Boolean(syncing), ...lastSync }) };
}
