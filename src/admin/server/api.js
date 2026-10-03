// Admin panel OKO (2026-10-03) — rozšírené /api/admin/* nad telemetriou.
// Volá ho src/auth/server/admin.js AŽ po kontrole roly owner; tu sa rola nerieši.
import { FEEDS, feedById } from './feeds.js';
import { localDay } from './runtime.js';

const HOUR = 3600_000;
const DAY = 86400_000;
const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
/** Posledných `days` miestnych dní vrátane dneška, od najstaršieho. */
export function dayRange(now, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = localDay(now - i * DAY);
    if (out[out.length - 1] !== day) out.push(day);
  }
  // Prechod času môže dať rovnaký deň dvakrát / preskočiť — doplniť dnešok.
  if (out[out.length - 1] !== localDay(now)) out.push(localDay(now));
  return out;
}

/** Súčty dimenzií pageviews: { dim: [{val, n}] } zoradené podľa n. */
function topDims(rows, exclude = []) {
  const map = new Map();
  for (const row of rows) {
    if (exclude.includes(row.dim)) continue;
    const dim = map.get(row.dim) || new Map();
    dim.set(row.val, (dim.get(row.val) || 0) + row.n);
    map.set(row.dim, dim);
  }
  const out = {};
  for (const [dim, values] of map) out[dim] = [...values].map(([val, n]) => ({ val, n })).sort((a, b) => b.n - a.n).slice(0, 50);
  return out;
}

export function analytics(runtime, now, days) {
  const range = dayRange(now, days);
  const rows = runtime.store.pageviewDims(range[0]);
  const today = localDay(now);
  const series = range.map(day => ({ day, views: 0, visitors: 0, minutes: 0, bots: 0 }));
  const byDay = new Map(series.map(entry => [entry.day, entry]));
  for (const row of rows) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    if (row.dim === 'views') entry.views += row.n;
    else if (row.dim === 'visitors') entry.visitors = row.n;
    else if (row.dim === 'minutes') entry.minutes += row.n;
    else if (row.dim === 'bots') entry.bots += row.n;
  }
  // Dnešní návštevníci sú ešte hashe (zrolujú sa až po polnoci).
  if (byDay.has(today)) byDay.get(today).visitors = runtime.store.visitorsToday(today);
  const totals = series.reduce((sum, d) => ({ views: sum.views + d.views, visitors: sum.visitors + d.visitors,
    minutes: sum.minutes + d.minutes, bots: sum.bots + d.bots }), { views: 0, visitors: 0, minutes: 0, bots: 0 });
  return { days: range.length, liveNow: runtime.liveVisitors(), series, totals,
    dims: topDims(rows, ['views', 'visitors', 'minutes', 'bots']) };
}

export function traffic(runtime, now, hours) {
  const from = Math.floor(now / HOUR) - hours + 1;
  const byHour = new Map(runtime.store.trafficByHour(from).map(row => [row.hour, row]));
  const series = [];
  for (let hour = from; hour <= Math.floor(now / HOUR); hour++) {
    const row = byHour.get(hour) || { n: 0, e4: 0, e5: 0, blocked: 0, msSum: 0, bytes: 0 };
    series.push({ at: hour * HOUR, n: row.n, e4: row.e4, e5: row.e5, blocked: row.blocked,
      avgMs: row.n ? Math.round(row.msSum / row.n) : 0, bytes: row.bytes });
  }
  const routes = runtime.store.trafficByRoute(from).map(row => ({
    route: row.route, label: feedById(row.route)?.label || row.route, n: row.n, e4: row.e4, e5: row.e5, blocked: row.blocked,
    avgMs: row.n ? Math.round(row.msSum / row.n) : 0, maxMs: Math.round(row.msMax || 0), bytes: row.bytes,
  }));
  return { hours, series, routes };
}

export function costs(runtime, now, days, quotaStatus = {}) {
  const range = dayRange(now, days);
  const paid = FEEDS.filter(feed => feed.paid || feed.quota);
  const rows = runtime.store.routeHours(paid.map(feed => feed.id), Math.floor((now - days * DAY) / HOUR));
  const perFeed = new Map(paid.map(feed => [feed.id, new Map(range.map(day => [day, { n: 0, blocked: 0, e5: 0 }]))]));
  for (const row of rows) {
    const bucket = perFeed.get(row.route)?.get(localDay(row.hour * HOUR));
    if (!bucket) continue;
    bucket.n += row.n - row.blocked; bucket.blocked += row.blocked; bucket.e5 += row.e5;
  }
  return {
    days: range,
    feeds: paid.map(feed => {
      const setting = runtime.feedSetting(feed.id);
      const series = range.map(day => ({ day, ...perFeed.get(feed.id).get(day) }));
      const total = series.reduce((sum, d) => sum + d.n, 0);
      return {
        id: feed.id, label: feed.label, unit: feed.paid?.unit || 'požiadaviek', paid: Boolean(feed.paid), quota: Boolean(feed.quota),
        enabled: setting.enabled !== false, dailyCap: setting.dailyCap ?? null, unitPrice: setting.unitPrice ?? null,
        today: feed.paid ? runtime.capCount(feed.id) : series[series.length - 1].n, total, series,
        estimate: Number.isFinite(setting.unitPrice) ? Math.round(total * setting.unitPrice * 100) / 100 : null,
        provider: quotaStatus[feed.id] || null,
      };
    }),
  };
}

/** História feedov: vzorky statusov + chybovosť požiadaviek po hodinách. */
export function feedHistory(runtime, now, hours) {
  const fromAt = now - hours * HOUR;
  const samples = runtime.store.samples(fromAt);
  const fromHour = Math.floor(fromAt / HOUR);
  const routes = runtime.store.routeHours(FEEDS.map(feed => feed.id), fromHour);
  const out = {};
  for (const feed of FEEDS.filter(f => f.toggle)) {
    const own = samples.filter(sample => sample.feed === feed.id);
    const hourly = routes.filter(row => row.route === feed.id);
    // Výpadok = súvislý úsek neúspešných vzoriek.
    const outages = [];
    let open = null;
    for (const sample of own) {
      if (!sample.ok && !open) open = { from: sample.at, to: sample.at, status: sample.status };
      else if (!sample.ok) open.to = sample.at;
      else if (open) { outages.push(open); open = null; }
    }
    if (open) outages.push({ ...open, ongoing: true });
    out[feed.id] = {
      samples: own.length, failed: own.filter(sample => !sample.ok).length, outages: outages.slice(-20),
      hourly: hourly.map(row => ({ at: row.hour * HOUR, n: row.n, e5: row.e5, blocked: row.blocked })),
    };
  }
  return out;
}

export function feedSettingsList(runtime) {
  return FEEDS.filter(feed => feed.toggle).map(feed => ({ id: feed.id, label: feed.label, paid: Boolean(feed.paid),
    ...runtime.feedSetting(feed.id) }));
}

export function validateFeedUpdate(id, body) {
  const feed = feedById(id);
  if (!feed?.toggle) return 'feed_not_found';
  if (Object.keys(body).some(key => !['enabled', 'dailyCap', 'unitPrice'].includes(key))) return 'invalid_input';
  if ('enabled' in body && typeof body.enabled !== 'boolean') return 'invalid_input';
  for (const key of ['dailyCap', 'unitPrice']) {
    if (!(key in body) || body[key] === null) continue;
    if (!feed.paid) return 'invalid_input';
    const max = key === 'dailyCap' ? 10_000_000 : 1000;
    if (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < 0 || body[key] > max) return 'invalid_input';
    if (key === 'dailyCap' && !Number.isInteger(body[key])) return 'invalid_input';
  }
  return null;
}

export function validateNotice(body) {
  if (Object.keys(body).some(key => !['text', 'level', 'hours'].includes(key))) return 'invalid_input';
  if (body.text === '' || body.text === null) return null;
  if (typeof body.text !== 'string' || [...body.text.trim()].length < 1 || [...body.text].length > 280) return 'invalid_notice';
  if (!['info', 'warn'].includes(body.level ?? 'info')) return 'invalid_notice';
  if (body.hours !== undefined && body.hours !== null && (!Number.isInteger(body.hours) || body.hours < 1 || body.hours > 24 * 30)) return 'invalid_notice';
  return null;
}

export { clampInt };
