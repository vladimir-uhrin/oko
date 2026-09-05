/** Bounded, measured AIS coverage. No extrapolation and no inferred traffic. */
export const AIS_FRESH_MS = 10 * 60_000;
export const AIS_RETAIN_MS = 6 * 60 * 60_000;
export const AIS_RETAIN_MAX = 50_000;

export function isAisPositionMessage(type) {
  return ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'].includes(type);
}

export function aisMeasuredTime(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  return Date.parse(value.trim().replace(' +0000 UTC', 'Z').replace(' UTC', 'Z'));
}

export function acceptsAisFix(type, value, previous, now = Date.now()) {
  const time = aisMeasuredTime(value);
  return isAisPositionMessage(type) && Number.isFinite(time) && time <= now + 60_000
    && now - time < AIS_RETAIN_MS && (!previous || time > aisFixTime(previous));
}

export function aisFixTime(row) {
  const epoch = Number(row?.last_position_epoch);
  return Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : NaN;
}

export function aisLastKnown(row, now = Date.now()) {
  const time = aisFixTime(row);
  return !Number.isFinite(time) || now - time >= AIS_FRESH_MS;
}

export function parseAisBounds(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some(p => !p.trim())) return null;
  const [west, south, east, north] = parts.map(Number);
  if (![west, south, east, north].every(Number.isFinite)
    || south < -90 || north > 90 || south > north
    || Math.abs(west) > 180 || Math.abs(east) > 180) return null;
  return { west, south, east, north };
}

export function inAisBounds(row, bounds) {
  if (!bounds) return true;
  return row.lat >= bounds.south && row.lat <= bounds.north
    && (bounds.west <= bounds.east
      ? row.lon >= bounds.west && row.lon <= bounds.east
      : row.lon >= bounds.west || row.lon <= bounds.east);
}

function cell(row, step = 10) {
  const lon = row.lon === 180 ? -180 : row.lon;
  return `${Math.min(180 / step - 1, Math.floor((row.lat + 90) / step))}:${Math.floor((lon + 180) / step)}`;
}

export function aisRegionKey(row) { return cell(row, 30); }

/** One contact per occupied cell per round; stable ties, no random sampling. */
function balanced(rows, limit) {
  const groups = new Map();
  for (const row of rows.sort((a, b) => aisFixTime(b) - aisFixTime(a) || String(a.mmsi).localeCompare(String(b.mmsi)))) {
    const key = cell(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const buckets = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => rows);
  const result = [];
  for (let round = 0; result.length < limit; round++) {
    let added = false;
    for (const bucket of buckets) {
      if (round < bucket.length) { result.push(bucket[round]); added = true; }
      if (result.length >= limit) break;
    }
    if (!added) break;
  }
  return result;
}

export function selectAisCoverage(input, { now = Date.now(), limit = 12000, bounds = null, selected = null } = {}) {
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(AIS_RETAIN_MAX, Math.floor(limit))) : 12000;
  const retained = [...input].filter(row => Number.isFinite(row.lat) && Number.isFinite(row.lon)
    && Math.abs(row.lat) <= 90 && Math.abs(row.lon) <= 180
    && aisFixTime(row) <= now + 60_000 && now - aisFixTime(row) < AIS_RETAIN_MS);
  const scoped = retained.filter(row => inAisBounds(row, bounds));
  const pinned = retained.find(row => row.mmsi === selected);
  const candidates = scoped.filter(row => row !== pinned);
  const fresh = candidates.filter(row => !aisLastKnown(row, now));
  const old = candidates.filter(row => aisLastKnown(row, now));
  const rows = pinned ? [pinned] : [];
  rows.push(...balanced(fresh, limit - rows.length));
  rows.push(...balanced(old, limit - rows.length));
  const selectedIds = new Set(rows.map(row => row.mmsi));
  const regions = {};
  for (let lat = 0; lat < 6; lat++) for (let lon = 0; lon < 12; lon++) {
    regions[`${lat}:${lon}`] = { south: lat * 30 - 90, west: lon * 30 - 180, received: 0, fresh: 0, lastKnown: 0, inView: 0, returned: 0, newestPositionAt: null };
  }
  for (const row of retained) {
    const region = regions[aisRegionKey(row)];
    region.received++;
    region[aisLastKnown(row, now) ? 'lastKnown' : 'fresh']++;
    if (inAisBounds(row, bounds)) region.inView++;
    if (selectedIds.has(row.mmsi)) region.returned++;
    region.newestPositionAt = Math.max(region.newestPositionAt || 0, aisFixTime(row));
  }
  return {
    rows: rows.map(({ _updatedAt, ...row }) => ({ ...row, position_state: aisLastKnown(row, now) ? 'last-known' : 'fresh' })),
    coverage: {
      retained: retained.length, inView: scoped.length, returned: rows.length,
      omittedByLimit: scoped.filter(row => !selectedIds.has(row.mmsi)).length,
      fresh: rows.filter(row => !aisLastKnown(row, now)).length,
      lastKnown: rows.filter(row => aisLastKnown(row, now)).length,
      retentionMs: AIS_RETAIN_MS, freshForMs: AIS_FRESH_MS, regions,
      meaning: 'Observed AIS positions only; empty cells do not establish zero traffic.',
    },
  };
}
