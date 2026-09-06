/** Normalize catalog solutions without averaging measurements or claiming consensus. */
export const EARTHQUAKE_DAY_MS = 86_400_000;
export const EARTHQUAKE_MATCH_MS = 20_000;
export const EARTHQUAKE_MATCH_KM = 30;
export const EARTHQUAKE_RENDER_LIMIT = 2000;

const finite = value => value !== null && value !== undefined && !(typeof value === 'string' && !value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => typeof value === 'string' ? value.trim() : '';
const epoch = value => typeof value === 'number' ? (Number.isFinite(value) ? value : null) : (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null);

export function normalizeEarthquakeFeed(payload, source) {
  if (!payload || !Array.isArray(payload.features)) throw new Error('Malformed catalog');
  if (!['USGS', 'EMSC'].includes(source)) throw new Error('Unknown catalog');
  const records = new Map();
  let rejected = 0;
  for (const feature of payload.features) {
    const p = feature?.properties;
    const c = feature?.geometry?.coordinates;
    const id = text(feature?.id);
    const lon = finite(c?.[0]); const lat = finite(c?.[1]);
    const mag = finite(p?.mag); const time = epoch(p?.time);
    if (!id || !Array.isArray(c) || lon === null || lat === null || Math.abs(lon) > 180 || Math.abs(lat) > 90
      || mag === null || mag < -3 || mag > 10 || time === null || time <= 0) { rejected++; continue; }
    // EMSC GeoJSON Z is altitude (negative below ground), not USGS depth.
    const depth = source === 'EMSC' ? (finite(p.depth) ?? (finite(c[2]) === null ? null : -Number(c[2]))) : finite(c[2]);
    const record = {
      id: `${source}:${id}`, source, sourceId: id,
      mag, magType: text(p.magType ?? p.magtype) || null, time,
      updated: epoch(p.updated ?? p.lastupdate) ?? time,
      lon, lat, depth, place: text(p.place ?? p.flynn_region) || null,
      status: text(p.status) || null, author: text(p.auth ?? p.net) || null,
      url: source === 'USGS' ? `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`
        : `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&eventid=${encodeURIComponent(id)}`,
    };
    if (!records.has(record.id) || records.get(record.id).updated < record.updated) records.set(record.id, record);
  }
  if (payload.features.length && !records.size) throw new Error('No valid catalog records');
  return { records: [...records.values()], rejected };
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((a.lat - b.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((a.lon - b.lon) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function earthquakeSolutionsMatch(a, b) {
  return a.source !== b.source && Math.abs(a.time - b.time) <= EARTHQUAKE_MATCH_MS
    && Math.abs(a.mag - b.mag) <= 1
    && (a.depth === null || b.depth === null || Math.abs(a.depth - b.depth) <= 50)
    && distanceKm(a, b) <= EARTHQUAKE_MATCH_KM;
}

/** Mutual unique matches only: dense/ambiguous sequences stay separate. */
export function mergeEarthquakeCatalogs(records, previous = []) {
  const usgs = records.filter(r => r.source === 'USGS');
  const emsc = records.filter(r => r.source === 'EMSC');
  const buckets = new Map();
  for (const r of usgs) {
    const key = Math.floor(r.time / EARTHQUAKE_MATCH_MS);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const matches = new Map(); const reverse = new Map();
  for (const e of emsc) {
    const key = Math.floor(e.time / EARTHQUAKE_MATCH_MS);
    const candidates = [-1, 0, 1].flatMap(d => buckets.get(key + d) || []).filter(u => earthquakeSolutionsMatch(u, e));
    matches.set(e.id, candidates);
    for (const u of candidates) {
      if (!reverse.has(u.id)) reverse.set(u.id, []);
      reverse.get(u.id).push(e);
    }
  }
  const paired = new Set(); const groups = [];
  for (const u of usgs) {
    const candidates = reverse.get(u.id) || [];
    const e = candidates.length === 1 && matches.get(candidates[0].id).length === 1 ? candidates[0] : null;
    if (e) paired.add(e.id);
    groups.push(e ? [u, e] : [u]);
  }
  groups.push(...emsc.filter(e => !paired.has(e.id)).map(e => [e]));
  const aliases = new Map(previous.flatMap(event => event.solutions.map(r => [r.id, event.id])));
  const used = new Set();
  return groups.sort((a, b) => a[0].id.localeCompare(b[0].id)).map(solutions => {
    // A fresh source outranks a cached stale source; otherwise retain USGS as
    // the display convention, not a claim of a more accurate solution.
    const preferred = solutions.find(r => !r.stale) || solutions[0];
    const oldId = solutions.map(r => aliases.get(r.id)).find(id => id && !used.has(id));
    const id = oldId || solutions[0].id;
    used.add(id);
    return { ...preferred, id, solutions, association: solutions.length > 1 ? 'probable' : 'single' };
  });
}
