// src/data/mideastAlerts.test.mjs — model POPLACHOV V IZRAELI (BLÍZKY VÝCHOD etapa 6, 2026-11-06):
// mirror sa číta ako dáta (žiadne spúšťanie), počty po dňoch a oblastiach, spojenie s polygónmi cez
// hebrejské meno (apostrofy), zjednodušenie obrysov, obdobia osi, stupne, súhrn, klientske dopyty.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALERTS_MIRROR_URL, ALERT_KINDS, ALERT_LEVELS, ALERT_THEATRES, MIDEAST_ALERTS_FIRST_DAY, MIDEAST_ALERT_PERIODS, alarmsInRange, alertLevel, alertPeriodRange, alertsSummary,
  buildAlertAreas, dominantKind, fetchMideastAlertAreas, fetchMideastAlerts, lastAlarmDay, normaliseAreaName, parseAlertsMirror, parseMirrorVariables, parsePythonStringDict,
  ringCentre, simplifyRing,
} from './mideastAlerts.js';
import { ALERTS_MIRROR_JS, ALERT_DISTRICTS_PY, ALERT_POLYGONS } from './fixtures/mideastStage6Fixtures.mjs';

const NOW = Date.parse('2026-11-06T12:00:00Z');

test('mirror sa číta ako JSON za `const … =` — bez eval; nie-JSON hodnota je chyba, nie spustenie', () => {
  const vars = parseMirrorVariables(ALERTS_MIRROR_JS);
  assert.deepEqual(Object.keys(vars), ['DATA_UPDATED', 'EVENT_TYPES', 'AREA_CATALOG', 'EVENTS_BY_AREA']);
  assert.equal(vars.DATA_UPDATED, '2026-11-03T15:13:02.043Z');
  assert.throws(() => parseMirrorVariables('const X = alert(1);\n'), /JSON/);
  assert.throws(() => parseAlertsMirror('const DATA_UPDATED = "x";\n'), /EVENTS_BY_AREA/);
  assert.equal(ALERTS_MIRROR_URL, 'https://oref-alerts.github.io/events.js');
});

test('počty po dňoch a oblastiach: r/w/d z `k`, dni pred 28. 2. a neznáme druhy sa preskočia', () => {
  const p = parseAlertsMirror(ALERTS_MIRROR_JS);
  assert.equal(p.events, 147);
  assert.equal(p.skipped, 0);
  assert.deepEqual(Object.keys(p.days).sort(), ['2026-02-28', '2026-03-01', '2026-03-09', '2026-06-14']);
  assert.deepEqual({ r: p.days['2026-02-28'].r, w: p.days['2026-02-28'].w, d: p.days['2026-02-28'].d }, { r: 32, w: 25, d: 0 });
  assert.deepEqual(p.days['2026-03-01'].areas['kryyt-shmvnh'], { r: 0, w: 8, d: 3 }, 'Kirjat Šmona 1. 3.: tri prieniky dronov');
  assert.deepEqual(p.days['2026-06-14'].areas, { 'kryyt-shmvnh': { r: 1, w: 0, d: 0 } });
  assert.equal(p.catalog['bny-aysh'], "בני עי'ש");
  const old = parseAlertsMirror('const EVENTS_BY_AREA = {"a":{"name":"x","events":[{"d":"2026-02-27","k":"r"},{"d":"2026-03-01","k":"z"},{"d":"2026-03-01","k":"r"}]}};\n');
  assert.equal(old.events, 1);
  assert.equal(old.skipped, 2);
  const later = parseAlertsMirror('const EVENTS_BY_AREA = {"a":{"name":"x","events":[{"d":"2026-02-27","k":"r"}]}};\n', { minDay: '2026-01-01' });
  assert.equal(later.events, 1, 'minDay je parameter');
});

test('mená: apostrof, geršajim a zdvojený apostrof polygónov sa zjednotia; Python slovník okresov', () => {
  assert.equal(normaliseAreaName("בני עי''ש"), "בני עי'ש");
  assert.equal(normaliseAreaName('בני עי״ש'), "בני עי'ש");
  assert.equal(normaliseAreaName('  א  ב '), 'א ב');
  const d = parsePythonStringDict(ALERT_DISTRICTS_PY);
  assert.equal(Object.keys(d).length, 4);
  assert.equal(d['קריית שמונה'], 'קו העימות');
  assert.deepEqual(parsePythonStringDict('x = {"a": "b", "c\\"d": "e"}'), { a: 'b', 'c\\"d': 'e' });
});

test('obrysy: Douglas–Peucker zachová prvý bod a tvar, zníži počet vrcholov; ťažisko; oblasti pre klienta [lon, lat] na 4 desatiny', () => {
  const square = [[0, 0], [0.5, 0.0001], [1, 0], [1, 0.5], [1, 1], [0, 1], [0, 0]];
  assert.deepEqual(simplifyRing(square, 0.001), [[0, 0], [1, 0], [1, 1], [0, 1]], 'body na hranách vypadnú, uzavretie sa zahodí');
  assert.deepEqual(simplifyRing([[0, 0], [1, 1]], 0.001), [[0, 0], [1, 1]], 'krátky obrys ostane');
  assert.deepEqual(ringCentre([[0, 0], [2, 0], [2, 2], [0, 2]]), [1, 1]);
  assert.equal(ringCentre([]), null);
  const built = buildAlertAreas({ catalog: parseAlertsMirror(ALERTS_MIRROR_JS).catalog, polygons: ALERT_POLYGONS, districts: parsePythonStringDict(ALERT_DISTRICTS_PY) });
  assert.deepEqual(built.missing, []);
  const tlv = built.areas['tel-aviv-center'];
  assert.equal(tlv.name, 'תל אביב - מרכז העיר');
  assert.equal(tlv.district, 'דן');
  assert.ok(tlv.lat > 32.07 && tlv.lat < 32.1 && tlv.lon > 34.77 && tlv.lon < 34.8, `stred Tel Avivu ${tlv.lat}, ${tlv.lon}`);
  assert.ok(tlv.ring.length >= 10 && tlv.ring.length < 60, `254 vrcholov → ${tlv.ring.length}`);
  for (const [lon, lat] of tlv.ring) { assert.ok(lon > 34 && lon < 36 && lat > 29 && lat < 34, 'poradie [lon, lat]'); assert.equal(lon, Math.round(lon * 1e4) / 1e4); }
  const bny = built.areas['bny-aysh'];
  assert.equal(bny.district, 'לכיש', "polygón s '' sa spojil s katalógom s '");
  const nothing = buildAlertAreas({ catalog: { x: 'nič' }, polygons: ALERT_POLYGONS });
  assert.deepEqual(nothing, { areas: {}, missing: ['x'] });
});

test('os: obdobia, počty poplachov (r + d, nie w), posledný deň s poplachom, stupne, prevládajúci druh', () => {
  assert.deepEqual(MIDEAST_ALERT_PERIODS, ['day', '7d', '30d', 'all']);
  assert.deepEqual(alertPeriodRange('7d', NOW), { from: '2026-10-31', to: '2026-11-06' });
  assert.deepEqual(alertPeriodRange('30d', NOW), { from: '2026-10-08', to: '2026-11-06' });
  assert.deepEqual(alertPeriodRange('all', NOW), { from: MIDEAST_ALERTS_FIRST_DAY, to: '2026-11-06' });
  assert.deepEqual(alertPeriodRange('day', NOW, '2026-06-14'), { from: '2026-06-14', to: '2026-06-14' });
  assert.deepEqual(alertPeriodRange('day', NOW, null), { from: '2026-11-06', to: '2026-11-06' }, 'bez posledného dňa = dnes');
  assert.deepEqual(alertPeriodRange('30d', Date.parse('2026-03-05T00:00:00Z')), { from: '2026-02-28', to: '2026-03-05' }, 'nikdy pred 28. 2.');
  const days = parseAlertsMirror(ALERTS_MIRROR_JS).days;
  assert.equal(alarmsInRange(days, '2026-02-28', '2026-03-01'), 32 + 24 + 3);
  assert.equal(alarmsInRange(days, '2026-07-01', '2026-11-06'), 0);
  assert.equal(lastAlarmDay(days), '2026-06-14');
  assert.equal(lastAlarmDay(days, '2026-03-05'), '2026-03-01');
  assert.equal(lastAlarmDay({ '2026-05-01': { r: 0, w: 5, d: 0 } }), null, 'len predbežné upozornenia nie sú poplach');
  assert.equal(alertLevel(0), null);
  assert.equal(alertLevel(2).id, 'l1');
  assert.equal(alertLevel(3).id, 'l2');
  assert.equal(alertLevel(29).id, 'l3');
  assert.equal(alertLevel(500).id, 'l4');
  assert.ok(ALERT_LEVELS.every((l, i) => i === 0 || l.alpha > ALERT_LEVELS[i - 1].alpha), 'sýtosť rastie');
  assert.equal(dominantKind({ r: 3, d: 5 }), 'd');
  assert.equal(dominantKind({ r: 5, d: 5 }), 'r');
  assert.equal(dominantKind({ r: 0, d: 0, w: 2 }), 'w');
  assert.equal(dominantKind({}), null);
  assert.deepEqual(ALERT_KINDS.map((k) => [k.id, k.alarm]), [['r', true], ['d', true], ['w', false]]);
  assert.deepEqual([...ALERT_THEATRES], ['overview', 'israel', 'gaza', 'west-bank', 'south-lebanon']);
});

test('súhrn pre legendu: súčty po druhoch, počet oblastí s poplachom, poradie podľa poplachov s menom a okresom', () => {
  const areas = { a: { name: 'A', district: 'D1' }, b: { name: 'B', district: null }, c: { name: 'C' } };
  const s = alertsSummary({ a: { r: 2, w: 9, d: 1 }, b: { r: 0, w: 4, d: 0 }, c: { r: 7, w: 0, d: 0 }, zzz: { r: 1, w: 0, d: 0 } }, areas, { top: 2 });
  assert.deepEqual(s.totals, { r: 10, w: 13, d: 1 });
  assert.equal(s.alarms, 11);
  assert.equal(s.areas, 3, 'b má len predbežné');
  assert.deepEqual(s.top.map((x) => [x.slug, x.name, x.district, x.alarms]), [['c', 'C', null, 7], ['a', 'A', 'D1', 3]]);
  assert.deepEqual(alertsSummary({}, {}), { totals: { r: 0, w: 0, d: 0 }, alarms: 0, areas: 0, top: [] });
});

test('klient: dopyty na trasy, 404 nesie stav, chybný tvar je chyba', async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return new Response(JSON.stringify({ days: {}, areas: {} }), { status: 200 }); };
  await fetchMideastAlerts({ from: '2026-10-01', to: '2026-11-06', fetcher });
  assert.deepEqual(calls, ['/api/mideast/events/alerts?from=2026-10-01&to=2026-11-06']);
  await assert.rejects(fetchMideastAlerts({ from: 'x', to: 'y', fetcher: async () => new Response(JSON.stringify({ error: 'no_alerts_snapshot' }), { status: 404 }) }), (e) => e.status === 404 && e.message === 'no_alerts_snapshot');
  await assert.rejects(fetchMideastAlerts({ from: 'x', to: 'y', fetcher: async () => new Response('{}', { status: 200 }) }), /bad_alerts_payload/);
  const areas = await fetchMideastAlertAreas({ fetcher: async (url) => { calls.push(url); return new Response(JSON.stringify({ areas: { a: {} } }), { status: 200 }); } });
  assert.equal(calls.at(-1), '/api/mideast/events/alerts/areas');
  assert.deepEqual(Object.keys(areas.areas), ['a']);
});
