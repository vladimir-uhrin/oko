// Výber udalostí pre pás „Čo sa deje teraz" (2026-11-11).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOW_MAX_ITEMS, NOW_MAX_PER_KIND, NOW_WARNING_YELLOW_MIN_DISTRICTS,
  agoParts, buildNowItems, districtsKey, feedState, isDailyReport, nowItemText, pickQuakes, pickUkraineReport, pickWarning,
} from './nowStrip.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const NOW = Date.parse('2026-11-11T21:00:00Z');
const H = 3_600_000;
const quake = (o) => ({ id: `USGS:${o.sourceId || 'x'}`, source: 'USGS', sourceId: 'x', mag: 5, time: NOW - 2 * H, lat: -41.5, lon: -74.2, place: '48 km NW of Ancud, Chile', status: 'reviewed', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/x', alert: null, tsunami: false, ...o });
const warn = (o) => ({ id: 'w', level: 3, type: 'rain', onset: new Date(NOW + 3 * H).toISOString(), expires: new Date(NOW + 12 * H).toISOString(), web: 'http://www.shmu.sk/?page=987', codes: ['601'], ...o });
const tr = (dict) => (key, vars) => { let s = dict[key] ?? key; for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, String(v)); return s; };

test('feedState: epocha aj ISO text, príznak stale, nečitateľný čas je zastaraný', () => {
  assert.equal(feedState(NOW - 5 * 60_000, NOW, 15), 'live');
  assert.equal(feedState(NOW - 20 * 60_000, NOW, 15), 'stale');
  assert.equal(feedState(new Date(NOW - 5 * 60_000).toISOString(), NOW, 30), 'live', 'výstrahy posielajú fetchedAt ako ISO text');
  assert.equal(feedState(NOW, NOW, 15, true), 'stale');
  assert.equal(feedState(undefined, NOW, 15), 'stale');
});

test('otrasy: úroveň A (M ≥ 6 alebo PAGER) najviac dva; sila = vyššie z úrovne PAGER a pásma magnitúdy', () => {
  const items = pickQuakes({ fetchedAt: NOW, records: [
    quake({ sourceId: 'a', mag: 6.4 }), quake({ sourceId: 'b', mag: 5.8, alert: 'orange' }), quake({ sourceId: 'c', mag: 7.1 }), quake({ sourceId: 'd', mag: 5.1 }),
  ] }, NOW);
  // M7,1 (pásmo 3) pred oranžovou M5,8 (úroveň 2); M6,4 (pásmo 1) sa do dvoch nezmestí.
  assert.deepEqual(items.map((i) => i.id), ['quake:USGS:c', 'quake:USGS:b']);
  assert.equal(items.length, NOW_MAX_PER_KIND);
  assert.equal(items[0].priority > items[1].priority, true);
  assert.ok(items.every((i) => i.priority < 100), 'otras nikdy nepredbehne výstrahu 3. stupňa');
});

test('otrasy: bez úrovne A jeden najsilnejší M ≥ 5, pri zhode magnitúdy najnovší', () => {
  const items = pickQuakes({ fetchedAt: NOW, records: [
    quake({ sourceId: 'old', mag: 5.1, time: NOW - 10 * H }), quake({ sourceId: 'new', mag: 5.1, time: NOW - 1 * H }), quake({ sourceId: 'small', mag: 4.9 }),
  ] }, NOW);
  assert.deepEqual(items.map((i) => i.id), ['quake:USGS:new']);
});

test('otrasy: holý príznak tsunami pri slabom otrase úroveň A nezakladá; starší než 24 h a bez polohy vypadne', () => {
  const items = pickQuakes({ fetchedAt: NOW, records: [
    quake({ sourceId: 'flag', mag: 4.7, tsunami: true }), quake({ sourceId: 'five', mag: 5.1 }),
    quake({ sourceId: 'old', mag: 6.5, time: NOW - 25 * H }), quake({ sourceId: 'nopos', mag: 6.8, lat: null }),
  ] }, NOW);
  assert.deepEqual(items.map((i) => i.id), ['quake:USGS:five']);
  assert.deepEqual(pickQuakes({ records: [] }, NOW), []);
  assert.deepEqual(pickQuakes(null, NOW), []);
});

test('otrasy: zastaraná odpoveď je označená, odkaz na zdroj len https', () => {
  const [item] = pickQuakes({ fetchedAt: NOW - 40 * 60_000, records: [quake({ mag: 6.2, url: 'javascript:alert(1)' })] }, NOW);
  assert.equal(item.state, 'stale');
  assert.equal(item.sourceUrl, null);
});

test('výstrahy: jedna skupina, počet okresov je zjednotenie kódov, ohlásená má najskorší začiatok', () => {
  const [item, ...rest] = pickWarning({ fetchedAt: new Date(NOW).toISOString(), warnings: [
    warn({ id: 'a', codes: ['601', '602'], onset: new Date(NOW + 5 * H).toISOString() }),
    warn({ id: 'b', codes: ['602', '603'], onset: new Date(NOW + 2 * H).toISOString() }),
    warn({ id: 'c', level: 2, type: 'fog', onset: new Date(NOW - H).toISOString(), codes: ['101'] }),
  ] }, NOW);
  assert.equal(rest.length, 0);
  assert.equal(item.degree, 2, 'úroveň 3 v odpovedi = 2. stupeň SHMÚ');
  assert.equal(item.districts, 3);
  assert.equal(item.active, false);
  assert.equal(item.state, 'announced');
  assert.equal(item.onsetMs, NOW + 2 * H);
  assert.equal(item.sourceUrl, 'https://www.shmu.sk/?page=987');
});

test('výstrahy: platná pred ohlásenou, 3. stupeň vždy, žltá len pri mnohých okresoch, skončená vypadne', () => {
  const active = (codes, extra = {}) => warn({ onset: new Date(NOW - H).toISOString(), codes, ...extra });
  assert.equal(pickWarning({ fetchedAt: new Date(NOW).toISOString(), warnings: [warn({ type: 'rain' }), active(['1'], { type: 'wind' })] }, NOW)[0].type, 'wind');
  assert.equal(pickWarning({ fetchedAt: new Date(NOW).toISOString(), warnings: [active(['1'], { level: 3 }), warn({ level: 4, type: 'snow', onset: new Date(NOW + 40 * H).toISOString() })] }, NOW)[0].degree, 3);
  const few = Array.from({ length: NOW_WARNING_YELLOW_MIN_DISTRICTS - 1 }, (_, i) => String(i));
  assert.deepEqual(pickWarning({ fetchedAt: new Date(NOW).toISOString(), warnings: [active(few, { level: 2, type: 'fog' })] }, NOW), []);
  assert.equal(pickWarning({ fetchedAt: new Date(NOW).toISOString(), warnings: [active([...few, 'x'], { level: 2, type: 'fog' })] }, NOW)[0].districts, NOW_WARNING_YELLOW_MIN_DISTRICTS);
  assert.deepEqual(pickWarning({ fetchedAt: new Date(NOW).toISOString(), warnings: [warn({ onset: new Date(NOW - 5 * H).toISOString(), expires: new Date(NOW - H).toISOString() })] }, NOW), []);
  assert.deepEqual(pickWarning({ fetchedAt: new Date(NOW).toISOString(), warnings: [warn({ onset: new Date(NOW + 30 * H).toISOString(), expires: new Date(NOW + 40 * H).toISOString() })] }, NOW), [], '2. stupeň ďalej než 24 h');
});

test('hlásenie GŠ: vždy stav claim, staré alebo bez čísla sa neukáže', () => {
  const report = { ok: true, total: 125, reportedAt: new Date(NOW - 15 * H).toISOString(), reportedAtText: '08:00 11.11.', fetchedAt: NOW - 30 * 60_000, url: 'https://armyinform.com.ua/x' };
  const [item] = pickUkraineReport(report, NOW);
  assert.equal(item.state, 'claim');
  assert.equal(item.total, 125);
  assert.deepEqual(pickUkraineReport({ ...report, reportedAt: new Date(NOW - 31 * H).toISOString() }, NOW), []);
  assert.deepEqual(pickUkraineReport({ ...report, total: null }, NOW), []);
  assert.deepEqual(pickUkraineReport({ ...report, ok: false }, NOW), []);
  assert.deepEqual(pickUkraineReport(null, NOW), []);
});

test('zoznam: podľa priority, najviac dva na druh a päť spolu; chýbajúci zdroj nevadí', () => {
  const items = buildNowItems({
    quakes: { fetchedAt: NOW, records: [quake({ sourceId: 'a', mag: 6.5 }), quake({ sourceId: 'b', mag: 6.1 }), quake({ sourceId: 'c', mag: 6.0 })] },
    warnings: { fetchedAt: new Date(NOW).toISOString(), warnings: [warn({ level: 4, type: 'wind', onset: new Date(NOW - H).toISOString() })] },
    ukraine: { ok: true, total: 125, reportedAt: new Date(NOW - 15 * H).toISOString(), reportedAtText: '08:00 11.11.', fetchedAt: NOW },
  }, NOW);
  assert.deepEqual(items.map((i) => i.kind), ['warning', 'quake', 'quake', 'ukraine']);
  assert.ok(items.length <= NOW_MAX_ITEMS);
  assert.deepEqual(buildNowItems({ quakes: null, warnings: undefined }, NOW), []);
  assert.deepEqual(buildNowItems(undefined, NOW), []);
});

test('texty: tvrdia len to, čo zdroj — príznak tsunami nie je varovanie, hlásenie GŠ je jednostranné', () => {
  const t = tr(SK_STRINGS);
  const [q] = pickQuakes({ fetchedAt: NOW, records: [quake({ mag: 6.2, tsunami: true, alert: 'yellow', status: 'automatic' })] }, NOW);
  const qt = nowItemText(q, t, { lang: 'sk', nowMs: NOW });
  assert.equal(qt.title, 'Zemetrasenie M6,2 · 48 km NW of Ancud, Chile');
  assert.equal(qt.meta, 'USGS · pred 2 h');
  assert.deepEqual(qt.chips, ['PAGER žltá', SK_STRINGS['quake.tsunami'], 'automatické riešenie']);
  assert.match(SK_STRINGS['quake.tsunami'], /nie varovanie/);
  const [u] = pickUkraineReport({ ok: true, total: 125, reportedAt: new Date(NOW - 15 * H).toISOString(), reportedAtText: '08:00 11.11.', fetchedAt: NOW }, NOW);
  const ut = nowItemText(u, t, { lang: 'sk', nowMs: NOW });
  assert.equal(ut.title, 'Generálny štáb Ukrajiny: 125 bojových stretov za deň');
  assert.deepEqual(ut.chips, ['oficiálne jednostranné hlásenie']);
  const [w] = pickWarning({ fetchedAt: new Date(NOW).toISOString(), warnings: [warn({ codes: ['1', '2', '3'] })] }, NOW);
  const wt = nowItemText(w, t, { lang: 'sk', nowMs: NOW });
  assert.equal(wt.title, 'Výstraha 2. stupňa: dážď · 3 okresy');
  assert.match(wt.meta, /^SHMÚ · OHLÁSENÁ VOPRED, od /);
  assert.doesNotMatch(wt.meta, / do /, 'spoločný koniec skupina nemá — okresy končia v rôznom čase');
  const en = nowItemText(q, tr(EN_STRINGS), { lang: 'en', nowMs: NOW });
  assert.equal(en.title, 'Earthquake M6.2 · 48 km NW of Ancud, Chile');
});

test('texty: zastaraná položka má čip ZASTARANÉ ako prvý; platná výstraha píše PLATÍ', () => {
  const t = tr(SK_STRINGS);
  const [q] = pickQuakes({ fetchedAt: NOW - 60 * 60_000, records: [quake({ mag: 6.2 })] }, NOW);
  assert.equal(nowItemText(q, t, { lang: 'sk', nowMs: NOW }).chips[0], 'ZASTARANÉ');
  const [w] = pickWarning({ fetchedAt: new Date(NOW).toISOString(), warnings: [warn({ onset: new Date(NOW - H).toISOString() })] }, NOW);
  assert.equal(nowItemText(w, t, { lang: 'sk', nowMs: NOW }).meta, 'SHMÚ · PLATÍ');
});

test('pomocné: čas „pred" a tvary okresov', () => {
  assert.deepEqual(agoParts(NOW - 30_000, NOW), { key: 'now.ago.min', n: 1 });
  assert.deepEqual(agoParts(NOW - 12 * 60_000, NOW), { key: 'now.ago.min', n: 12 });
  assert.deepEqual(agoParts(NOW - 3 * H, NOW), { key: 'now.ago.h', n: 3 });
  assert.deepEqual(agoParts(NOW - 72 * H, NOW), { key: 'now.ago.d', n: 3 });
  assert.deepEqual([1, 2, 4, 5, 19].map(districtsKey), ['now.districts.one', 'now.districts.few', 'now.districts.few', 'now.districts.many', 'now.districts.many']);
});

// ── opravy z nezávislej kontroly 2026-11-11 ──
test('otrasy: čerstvý veľký otras bez PAGER nevypadne za dva slabšie so žltou úrovňou a ide prvý', () => {
  const big = quake({ sourceId: 'big', mag: 7.8, time: NOW - 10 * 60_000, status: 'automatic' });
  const y1 = quake({ sourceId: 'y1', mag: 5.6, alert: 'yellow', time: NOW - 5 * H });
  const y2 = quake({ sourceId: 'y2', mag: 5.4, alert: 'yellow', time: NOW - 6 * H });
  assert.deepEqual(pickQuakes({ fetchedAt: NOW, records: [y1, y2, big] }, NOW).map((i) => i.id), ['quake:USGS:big', 'quake:USGS:y1']);
  const two = pickQuakes({ fetchedAt: NOW, records: [y1, big] }, NOW);
  assert.equal(two[0].id, 'quake:USGS:big');
  assert.ok(two[0].priority > two[1].priority);
  assert.equal(two[0].alert, null, 'otras bez hodnotenia nedostane čip PAGER');
});

test('otrasy: magnitúda sa zaokrúhli raz — 5,95 sa píše M6,0 a aj sa tak triedi; 4,96 je M5,0', () => {
  const [a] = pickQuakes({ fetchedAt: NOW, records: [quake({ sourceId: 'a', mag: 5.95 })] }, NOW);
  assert.equal(a.mag, 6);
  assert.equal(a.priority, 89, 'M6,0 patrí do úrovne A');
  assert.equal(nowItemText(a, tr(SK_STRINGS), { lang: 'sk', nowMs: NOW }).title.startsWith('Zemetrasenie M6,0'), true);
  assert.equal(pickQuakes({ fetchedAt: NOW, records: [quake({ sourceId: 'b', mag: 4.96 })] }, NOW).length, 1, 'M5,0 po zaokrúhlení spĺňa úroveň B');
});

test('hlásenie GŠ: „za deň" platí len pre ranné hlásenie — popoludňajšie priebežné sa neukáže', () => {
  const base = { ok: true, total: 62, reportedAt: new Date(NOW - 5 * H).toISOString(), fetchedAt: NOW };
  assert.deepEqual(pickUkraineReport({ ...base, reportedAtText: '16:00 11.11.', publishedAt: Date.parse('2026-11-11T13:15:00Z') }, NOW), []);
  assert.deepEqual(pickUkraineReport({ ...base, sourceStampText: '22:00 11.11.' }, NOW), []);
  assert.equal(isDailyReport({ reportedAtText: '08:00 11.11.' }), true);
  assert.equal(isDailyReport({ sourceStampText: '8.00 11.11.' }), true);
  assert.equal(isDailyReport({ title: 'За добу на фронті зафіксовано 125 боєзіткнень' }), true, 'bez pečiatky rozhodne titulok');
  assert.equal(isDailyReport({ publishedAt: Date.parse('2026-11-11T05:30:00Z') }), true, 'bez pečiatky a titulku čas vydania 04–07 UTC');
  assert.equal(isDailyReport({ publishedAt: Date.parse('2026-11-11T13:15:00Z') }), false);
  assert.equal(isDailyReport({}), false);
});

test('hlásenie GŠ: príznak stale z posledného dobrého stavu sa prejaví', () => {
  const [item] = pickUkraineReport({ ok: true, total: 125, reportedAt: new Date(NOW - 15 * H).toISOString(), reportedAtText: '08:00 11.11.', fetchedAt: NOW, stale: true }, NOW);
  assert.equal(item.state, 'stale');
});
