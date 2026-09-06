import { normalizeEarthquakeFeed, EARTHQUAKE_DAY_MS } from './earthquakeCatalog.js';

export const EARTHQUAKE_CACHE_MS = 60_000;
const MAX_BYTES = 16 * 1024 * 1024;

export function earthquakeFeedUrl(source, now = Date.now()) {
  if (source === 'USGS') return 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
  if (source !== 'EMSC') throw new Error('Unknown catalog');
  const url = new URL('https://www.seismicportal.eu/fdsnws/event/1/query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('starttime', new Date(now - EARTHQUAKE_DAY_MS).toISOString());
  url.searchParams.set('endtime', new Date(now).toISOString());
  url.searchParams.set('limit', '20000');
  url.searchParams.set('orderby', 'time');
  return url.toString();
}

/** Two fixed cache keys; share in-flight work and back off after failures too. */
export function createEarthquakeFeedCache({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  const entries = new Map();
  return async function get(source) {
    if (!['USGS', 'EMSC'].includes(source)) throw new Error('Unknown catalog');
    let entry = entries.get(source);
    if (!entry) { entry = { attemptedAt: -Infinity, good: null, error: null, pending: null }; entries.set(source, entry); }
    if (!entry.pending && now() - entry.attemptedAt >= EARTHQUAKE_CACHE_MS) {
      entry.attemptedAt = now();
      entry.pending = (async () => {
        try {
          const response = await fetchImpl(earthquakeFeedUrl(source, now()), { signal: AbortSignal.timeout(12_000) });
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
      source, records: (good?.records || []).filter(r => r.time >= now() - EARTHQUAKE_DAY_MS && r.time <= now() + 60_000),
      fetchedAt: good?.fetchedAt ?? null, rejected: good?.rejected || 0,
      truncated: good?.truncated || false, stale: Boolean(entry.error), error: entry.error,
    };
  };
}

export function earthquakeFeedProxy() {
  const get = createEarthquakeFeedCache();
  function install(middlewares) {
    middlewares.use('/api/earthquakes', async (req, res) => {
      const source = new URL(req.url || '/', 'http://localhost').pathname.slice(1).toUpperCase();
      if (req.method !== 'GET' || !['USGS', 'EMSC'].includes(source)) {
        res.statusCode = 404; res.end('Not found'); return;
      }
      const payload = await get(source);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(payload));
    });
  }
  return { name: 'earthquake-catalog-proxy', configureServer: server => install(server.middlewares), configurePreviewServer: server => install(server.middlewares) };
}
