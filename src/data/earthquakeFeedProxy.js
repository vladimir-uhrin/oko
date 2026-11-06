import fsp from 'node:fs/promises';
import path from 'node:path';
import { normalizeEarthquakeFeed, earthquakePeriod, EARTHQUAKE_PERIODS } from './earthquakeCatalog.js';
import { overlayAlpha, shakemapOverlayUrls, worldFileBbox } from './quakeMedia.js';

export const EARTHQUAKE_CACHE_MS = 60_000;
const MAX_BYTES = 16 * 1024 * 1024;

/**
 * URL katalógu pre zdroj a obdobie (2026-11-06: 24 h, 7 dní, 30 dní). USGS má hotové súhrnné
 * feedy; EMSC dostane okno času a najnižšiu magnitúdu obdobia (EARTHQUAKE_PERIODS.floor).
 */
export function earthquakeFeedUrl(source, now = Date.now(), periodId = 'day') {
  const period = earthquakePeriod(periodId);
  if (source === 'USGS') return `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${period.usgsFeed}.geojson`;
  if (source !== 'EMSC') throw new Error('Unknown catalog');
  const url = new URL('https://www.seismicportal.eu/fdsnws/event/1/query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('starttime', new Date(now - period.ms).toISOString());
  url.searchParams.set('endtime', new Date(now).toISOString());
  if (period.floor > -3) url.searchParams.set('minmagnitude', String(period.floor));
  url.searchParams.set('limit', '20000');
  url.searchParams.set('orderby', 'time');
  return url.toString();
}

/** Fixed cache keys (source × period); share in-flight work and back off after failures too. */
export function createEarthquakeFeedCache({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  const entries = new Map();
  return async function get(source, periodId = 'day') {
    if (!['USGS', 'EMSC'].includes(source)) throw new Error('Unknown catalog');
    const period = earthquakePeriod(periodId);
    const key = `${source}:${period.id}`;
    let entry = entries.get(key);
    if (!entry) { entry = { attemptedAt: -Infinity, good: null, error: null, pending: null }; entries.set(key, entry); }
    if (!entry.pending && now() - entry.attemptedAt >= EARTHQUAKE_CACHE_MS) {
      entry.attemptedAt = now();
      entry.pending = (async () => {
        try {
          const response = await fetchImpl(earthquakeFeedUrl(source, now(), period.id), { signal: AbortSignal.timeout(12_000) });
          if (!response.ok) throw new Error(`${source} HTTP ${response.status}`);
          let payload;
          if (response.status === 204) payload = { features: [] };
          else {
            let size = 0; const chunks = [];
            if (Number(response.headers?.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('Catalog too large'); }
            if (response.body) {
              for await (const chunk of response.body) {
                size += chunk.byteLength;
                if (size > MAX_BYTES) throw new Error('Catalog too large');
                chunks.push(chunk);
              }
              payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } else payload = await response.json();
          }
          const parsed = normalizeEarthquakeFeed(payload, source);
          entry.good = { ...parsed, fetchedAt: now(), truncated: payload.features.length >= 20000 };
          entry.error = null;
        } catch (error) { entry.error = error?.message || `${source} unavailable`; }
        finally { entry.pending = null; }
      })();
    }
    if (entry.pending) await entry.pending;
    const good = entry.good;
    return {
      source, period: period.id,
      records: (good?.records || []).filter(r => r.time >= now() - period.ms && r.time <= now() + 60_000),
      fetchedAt: good?.fetchedAt ?? null, rejected: good?.rejected || 0,
      truncated: good?.truncated || false, stale: Boolean(entry.error), error: entry.error,
    };
  };
}

// ── Mapa otrasov ShakeMap (2026-11-06) ────────────────────────────────────────────────────────
// USGS zverejňuje pri silných otrasoch mapu intenzity ako priehľadný PNG s world file. Server ju
// stiahne raz za verziu, slabé otrasy (I–III) spraví priehľadnými (overlayAlpha, rovnako ako video)
// a podrží na disku v .gev-cache/shakemap. Prehliadač dostane metadáta (rámik, verzia) a obrázok
// z vlastnej domény — bez CORS a bez ďalších dopytov na USGS od každého návštevníka.

export const SHAKEMAP_META_TTL_MS = 30 * 60_000;
export const SHAKEMAP_MISS_TTL_MS = 10 * 60_000;
const SHAKEMAP_MAX_BYTES = 12 * 1024 * 1024;
const SHAKEMAP_ID_RE = /^[a-z0-9]{4,24}$/;
const USGS_UA = { 'user-agent': 'OKO-earthquakes/0.1 (https://okolive.sk)' };

/** Platné ID udalosti USGS (napr. us7000twg9)? Pure. */
export function validShakemapId(id) {
  return typeof id === 'string' && SHAKEMAP_ID_RE.test(id);
}

/** Detail udalosti USGS (zoznam produktov vrátane ShakeMap). Pure. */
export function usgsDetailUrl(id) {
  return `https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${encodeURIComponent(id)}.geojson`;
}

/**
 * Pixely RGBA vrstvy: slabé otrasy a pôvodne priehľadné body priehľadné, ostatné polopriehľadné.
 * Mení buffer na mieste. Pure nad bufferom.
 * @param {Uint8Array|Buffer} data RGBA
 */
export function applyShakemapAlpha(data) {
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = data[i + 3] === 0 ? 0 : overlayAlpha(data[i], data[i + 1], data[i + 2], { alpha: 190 });
  }
  return data;
}

async function readLimited(response, max) {
  if (Number(response.headers?.get?.('content-length')) > max) { await response.body?.cancel?.(); throw new Error('too large'); }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > max) throw new Error('too large');
  return buffer;
}

/**
 * @param {object} [o]
 * @param {string} [o.root] koreň projektu (cache pod `.gev-cache/shakemap`)
 * @param {Function} [o.fetchImpl]
 * @param {Function} [o.now]
 * @param {() => Promise<Function>} [o.loadSharp] sharp (lenivo; test: podvrh)
 * @returns {{meta: (id: string) => Promise<object|null>, image: (id: string) => Promise<Buffer|null>}}
 */
export function createShakemapCache({ root = process.cwd(), fetchImpl = (...a) => fetch(...a), now = Date.now,
  loadSharp = async () => (await import('sharp')).default, log = () => {} } = {}) {
  const dir = path.join(root, '.gev-cache', 'shakemap');
  const entries = new Map(); // id → {at, value, pending}

  async function build(id) {
    const detailRes = await fetchImpl(usgsDetailUrl(id), { headers: USGS_UA, signal: AbortSignal.timeout(20_000) });
    if (!detailRes.ok) return null;
    const detail = await detailRes.json();
    const urls = shakemapOverlayUrls(detail);
    if (!urls) return null;
    const product = detail?.properties?.products?.shakemap?.[0] || {};
    const version = String(product.updateTime || detail?.properties?.updated || '0').replace(/[^0-9]/g, '').slice(0, 16) || '0';
    const file = path.join(dir, `${id}-${version}.png`);
    const sidecar = `${file}.json`;
    try {
      const cached = JSON.parse(await fsp.readFile(sidecar, 'utf8'));
      if (Array.isArray(cached.bbox) && cached.bbox.length === 4) return { ...cached, file };
    } catch { /* ešte nie je na disku */ }
    const [pngRes, pngwRes] = await Promise.all([
      fetchImpl(urls.png, { headers: USGS_UA, signal: AbortSignal.timeout(60_000) }),
      fetchImpl(urls.pngw, { headers: USGS_UA, signal: AbortSignal.timeout(30_000) }),
    ]);
    if (!pngRes.ok || !pngwRes.ok || !/^image\/png/.test(pngRes.headers?.get?.('content-type') || '')) return null;
    const sharp = await loadSharp();
    const { data, info } = await sharp(await readLimited(pngRes, SHAKEMAP_MAX_BYTES)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bbox = worldFileBbox(await pngwRes.text(), info.width, info.height);
    if (!bbox) return null;
    applyShakemapAlpha(data);
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    const value = { id, version, bbox, width: info.width, height: info.height,
      mmi: Number.isFinite(Number(detail?.properties?.mmi)) && Number(detail.properties.mmi) > 0 ? Number(detail.properties.mmi) : null };
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file, png);
    await fsp.writeFile(sidecar, JSON.stringify(value));
    return { ...value, file };
  }

  async function meta(id) {
    if (!validShakemapId(id)) return null;
    let entry = entries.get(id);
    const ttl = entry?.value ? SHAKEMAP_META_TTL_MS : SHAKEMAP_MISS_TTL_MS;
    if (entry && !entry.pending && now() - entry.at < ttl) return entry.value;
    if (entry?.pending) return entry.pending;
    entry = entry || { at: 0, value: null, pending: null };
    entries.set(id, entry);
    entry.pending = build(id).catch((error) => { log(`[shakemap] ${id}: ${error?.message || error}`); return entry.value; })
      .then((value) => { entry.value = value; entry.at = now(); entry.pending = null; return value; });
    return entry.pending;
  }

  return {
    meta,
    async image(id) {
      const value = await meta(id);
      if (!value?.file) return null;
      try { return await fsp.readFile(value.file); } catch { return null; }
    },
  };
}

/** Verejné metadáta mapy otrasov pre prehliadač (bez cesty na disku). Pure. */
export function shakemapPublicMeta(value) {
  if (!value) return null;
  return { id: value.id, version: value.version, bbox: value.bbox, mmi: value.mmi ?? null,
    image: `/api/earthquakes/shakemap/${encodeURIComponent(value.id)}.png?v=${encodeURIComponent(value.version)}` };
}

export function earthquakeFeedProxy({ shakemap = null } = {}) {
  const get = createEarthquakeFeedCache();
  const maps = shakemap || createShakemapCache({ log: (m) => console.log(m) });
  function install(middlewares) {
    middlewares.use('/api/earthquakes', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const shake = /^\/shakemap\/([a-z0-9]+)\.(json|png)$/.exec(url.pathname);
      if (req.method === 'GET' && shake && validShakemapId(shake[1])) {
        if (shake[2] === 'json') {
          const value = shakemapPublicMeta(await maps.meta(shake[1]));
          res.statusCode = value ? 200 : 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', value ? 'public, max-age=300' : 'no-store');
          res.end(JSON.stringify(value || { error: 'no_shakemap' }));
          return;
        }
        const png = await maps.image(shake[1]);
        if (!png) { res.statusCode = 404; res.end('Not found'); return; }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.end(png);
        return;
      }
      const source = url.pathname.slice(1).toUpperCase();
      if (req.method !== 'GET' || !['USGS', 'EMSC'].includes(source)) {
        res.statusCode = 404; res.end('Not found'); return;
      }
      const periodId = url.searchParams.get('period') || 'day';
      if (!Object.hasOwn(EARTHQUAKE_PERIODS, periodId)) { res.statusCode = 400; res.end('Bad period'); return; }
      const payload = await get(source, periodId);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(payload));
    });
  }
  return { name: 'earthquake-catalog-proxy', configureServer: server => install(server.middlewares), configurePreviewServer: server => install(server.middlewares) };
}
