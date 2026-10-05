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
  const sum = list => list.reduce((acc, d) => ({ views: acc.views + d.views, visitors: acc.visitors + d.visitors,
    minutes: acc.minutes + d.minutes, bots: acc.bots + d.bots }), { views: 0, visitors: 0, minutes: 0, bots: 0 });
  const totals = sum(series);
  // Predchádzajúce obdobie rovnakej dĺžky (napr. 7 dní pred týmito 7 dňami) — percentá zmeny v dlaždiciach.
  const prevRange = dayRange(now - range.length * DAY, range.length);
  const prevDays = new Set(prevRange);
  const prev = new Map(prevRange.map(day => [day, { day, views: 0, visitors: 0, minutes: 0, bots: 0 }]));
  for (const row of runtime.store.pageviewDims(prevRange[0])) {
    if (!prevDays.has(row.day)) continue;
    const entry = prev.get(row.day);
    if (row.dim === 'views') entry.views += row.n;
    else if (row.dim === 'visitors') entry.visitors = row.n;
    else if (row.dim === 'minutes') entry.minutes += row.n;
    else if (row.dim === 'bots') entry.bots += row.n;
  }
  // Zverejnené príspevky Štúdia ako značky v grafe (deň → názvy).
  const published = new Map();
  for (const post of runtime.store.studioPublished?.(now - range.length * DAY) ?? []) {
    const day = localDay(post.at);
    if (!byDay.has(day)) continue;
    published.set(day, [...(published.get(day) || []), post.title]);
  }
  return { days: range.length, liveNow: runtime.liveVisitors(), series, totals, previous: sum([...prev.values()]),
    published: [...published].map(([day, titles]) => ({ day, titles })),
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

/**
 * Prehľad „čo horí": zoznam vecí na riešenie, najzávažnejšie prvé. Každá položka vedie do záložky.
 * @param {object} studioCounts store.studioCounts() alebo null
 * @returns {{level: 'bad'|'warn'|'info', tab: string, text: string}[]}
 */
export function attention(runtime, now, { studioCounts = null, upstream = [] } = {}) {
  const items = [];
  // Karty lietadiel (2026-10-05): z kontrol prehliadačov za 2 h. Dopravca/trasa chýba aj normálne
  // (charter, presun bez čísla letu), preto až pod 30 % a pri aspoň 3 kontrolách.
  runtime.flush();
  const cardRows = runtime.store.cardHealth?.(Math.floor(now / HOUR) - 1) || [];
  const card = cardRows.reduce((a, r) => ({ n: a.n + r.n, route: a.route + r.route, type: a.type + r.type }), { n: 0, route: 0, type: 0 });
  if (card.n >= 3 && card.route / card.n < 0.3) items.push({ level: 'bad', tab: 'traffic', text: `Karty lietadiel bez trasy a ETA: ${card.n - card.route} z ${card.n} za 2 h` });
  if (card.n >= 3 && card.type / card.n < 0.3) items.push({ level: 'warn', tab: 'traffic', text: `Karty lietadiel bez typu: ${card.n - card.type} z ${card.n} za 2 h` });
  // Externé zdroje: zablokovaný teraz = rieš; opakované 429 za hodinu = pozor.
  const hhmm = at => new Date(at).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bratislava' });
  for (const source of upstream) {
    if (source.pausedUntil) items.push({ level: 'bad', tab: 'traffic', text: `${source.name} nás zablokoval — pauza do ${hhmm(source.pausedUntil)}` });
    else if (source.lastHour.limited >= 3) items.push({ level: 'warn', tab: 'traffic', text: `${source.name}: ${source.lastHour.limited}× obmedzenie (429) za hodinu` });
  }
  // Zdroje: prebiehajúci výpadok zo vzoriek (posledných 6 h) a ručne vypnuté.
  const history = feedHistory(runtime, now, 6);
  for (const feed of FEEDS.filter(f => f.toggle)) {
    const ongoing = history[feed.id]?.outages.find(outage => outage.ongoing);
    if (ongoing) items.push({ level: 'bad', tab: 'feeds', text: `${feed.label} neodpovedá (${Math.max(1, Math.round((now - ongoing.from) / 60_000))} min, HTTP ${ongoing.status || 'bez odpovede'})` });
    if (runtime.feedSetting(feed.id).enabled === false) items.push({ level: 'warn', tab: 'feeds', text: `${feed.label} je vypnutý v admine` });
  }
  // Chyby servera za posledné 2 h.
  const lastHour = traffic(runtime, now, 2).series.reduce((acc, s) => ({ n: acc.n + s.n, e5: acc.e5 + s.e5 }), { n: 0, e5: 0 });
  if (lastHour.e5) {
    const share = lastHour.n ? lastHour.e5 / lastHour.n : 1;
    items.push({ level: share >= 0.05 ? 'bad' : 'warn', tab: 'traffic', text: `${lastHour.e5} chýb 5xx za 2 h (${(share * 100).toFixed(1).replace('.', ',')} % požiadaviek)` });
  }
  // Platené zdroje pri dennom strope.
  for (const feed of costs(runtime, now, 1).feeds) {
    if (!feed.paid || !Number.isFinite(feed.dailyCap) || feed.dailyCap <= 0) continue;
    const share = feed.today / feed.dailyCap;
    if (share >= 1) items.push({ level: 'bad', tab: 'costs', text: `${feed.label}: denný strop vyčerpaný (${feed.today} / ${feed.dailyCap})` });
    else if (share >= 0.8) items.push({ level: 'warn', tab: 'costs', text: `${feed.label}: ${Math.round(share * 100)} % denného stropu` });
  }
  // Nové chyby za 24 h (prvý výskyt v tomto okne).
  runtime.flush();
  const fresh = runtime.store.errors(null, 300).filter(error => error.firstAt >= now - DAY && error.kind !== 'warn');
  if (fresh.length) items.push({ level: 'warn', tab: 'errors', text: `${fresh.length} ${fresh.length === 1 ? 'nová chyba' : fresh.length < 5 ? 'nové chyby' : 'nových chýb'} za 24 h` });
  // Štúdio.
  if (studioCounts) {
    if (studioCounts.failed) items.push({ level: 'bad', tab: 'studio', text: `Štúdio: ${studioCounts.failed} zlyhaných zverejnení` });
    if (studioCounts.draft) items.push({ level: 'info', tab: 'studio', text: `Štúdio: ${studioCounts.draft} ${studioCounts.draft === 1 ? 'návrh čaká' : 'návrhov čaká'} na schválenie` });
    if (studioCounts.scheduled) items.push({ level: 'info', tab: 'studio', text: `Štúdio: ${studioCounts.scheduled} naplánovaných` });
    if (studioCounts.rendering) items.push({ level: 'info', tab: 'studio', text: `Štúdio: ${studioCounts.rendering} videí sa vyrába` });
  }
  const order = { bad: 0, warn: 1, info: 2 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}

/** Zdravie kariet lietadiel po hodinách (posledných `hours`), pre Prevádzku. */
export function cardHealthSeries(runtime, now, hours = 24) {
  runtime.flush();
  const from = Math.floor(now / HOUR) - hours + 1;
  const byHour = new Map((runtime.store.cardHealth?.(from) || []).map(r => [r.hour, r]));
  const series = [];
  for (let hour = from; hour <= Math.floor(now / HOUR); hour++) {
    const r = byHour.get(hour) || { n: 0, route: 0, type: 0, airline: 0 };
    series.push({ at: hour * HOUR, n: r.n, route: r.route, type: r.type, airline: r.airline });
  }
  return series;
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
