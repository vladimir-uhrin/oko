// src/data/deepstateMirror.test.mjs — jadro GitHub mirrorov DeepState
// (2026-09-24). Endpoint /api/deepstate/analytics a jeho HTTP testy zanikli
// s demom; pokrytie JADRA sa prenieslo sem: čisté pomôcky (z testov druhého
// agenta), UTC dátumy, negatívna cache 404, pauza po chybe, nepoužiteľný súbor,
// starší súbor z disku, jeden dopyt naraz, rozpočet času.
// Bez siete: fetch je vstreknutý, koreň je dočasný priečinok.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  DEEPSTATE_MIRROR_LICENSE, DEEPSTATE_MIRROR_NOTE, MIRROR_FIRST_DAY,
  calculateGeoJsonAreaKm2, createDeepStateMirror, dateKeyProblem, deepstateRawUrl, getFormattedDateKey, isUsableSnapshot, parseDateKey,
} from './deepstateMirror.js';

const NOW = Date.UTC(2026, 8, 23, 12); // 23. 9. 2026 12:00 UTC → včerajšok = 20260922
const polygon = (lon) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[lon, 47], [lon + 1, 47], [lon + 1, 48], [lon, 48], [lon, 47]]] } }],
});
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const status = (s, headers = {}) => ({ ok: false, status: s, text: async () => '', headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
const roots = [];
test.after(() => Promise.all(roots.map((r) => fsp.rm(r, { recursive: true, force: true }))));

async function setup(fetchImpl, { now = () => NOW } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-dsm-'));
  roots.push(root);
  const calls = [];
  const mirror = createDeepStateMirror({ root, now, log: () => {}, fetchImpl: async (url, opts) => { calls.push(url.match(/(\d{8})\.geojson$/)?.[1]); return fetchImpl(url, opts); } });
  return { root, calls, mirror, dir: mirror.cacheDir };
}

// ── čisté pomôcky (pôvodne testy druhého agenta k deepstateAnalyticsProxy.js) ──
test('getFormattedDateKey: korektné formátovanie a odpočítavanie dní', () => {
  const base = new Date('2026-09-23T12:00:00Z');
  assert.equal(getFormattedDateKey(1, base), '20260922');
  assert.equal(getFormattedDateKey(2, base), '20260921');
  assert.equal(getFormattedDateKey(24, base), '20260830');
});

test('deepstateRawUrl: URL zodpovedá repo cyterat/deepstate-map-data', () => {
  assert.equal(
    deepstateRawUrl('20260922'),
    'https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_20260922.geojson',
  );
});

test('calculateGeoJsonAreaKm2: výpočet plochy polygónu (1° × 1° na 48–49° s. š. ≈ 8 200 km²)', () => {
  const area = calculateGeoJsonAreaKm2({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[30, 48], [31, 48], [31, 49], [30, 49], [30, 48]]] } }] });
  assert.ok(area > 7000 && area < 9000, `Plocha ${area} km² má byť v očakávanom geodetickom rozsahu`);
  assert.equal(isUsableSnapshot({ type: 'FeatureCollection', features: [] }), false);
  assert.equal(isUsableSnapshot(null), false);
  assert.equal(isUsableSnapshot(polygon(35)), true);
});

test('dátumy sú UTC v každom časovom pásme; neexistujúci dátum sa neprevalí; problémy dňa', () => {
  const saved = process.env.TZ;
  try {
    for (const tz of ['America/New_York', 'Pacific/Kiritimati', 'Europe/Bratislava']) {
      process.env.TZ = tz;
      assert.equal(getFormattedDateKey(1, new Date(NOW)), '20260922', tz);
      assert.equal(getFormattedDateKey(0, new Date(Date.UTC(2026, 8, 22))), '20260922', `${tz}: polnoc UTC`);
      assert.equal(getFormattedDateKey(1, new Date(Date.UTC(2027, 2, 28, 22, 30))), '20270327', `${tz}: noc zmeny času`);
    }
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
  assert.equal(parseDateKey('20261399'), null);
  assert.equal(parseDateKey('20230229'), null);
  assert.equal(parseDateKey('20240229'), Date.UTC(2024, 1, 29));
  assert.equal(parseDateKey('abc'), null);
  assert.equal(dateKeyProblem('abc', '20260923'), 'invalid');
  assert.equal(MIRROR_FIRST_DAY, '20240708');
  assert.equal(dateKeyProblem('20261399', '20260923'), 'invalid');
  assert.equal(dateKeyProblem('20260924', '20260923'), 'future');
  assert.equal(dateKeyProblem('20240707', '20260923'), 'before_mirror');
  assert.equal(dateKeyProblem('20260923', '20260923'), null);
});

test('licencia a výhrady nikdy netvrdia otvorené dáta', () => {
  assert.match(DEEPSTATE_MIRROR_LICENSE.data, /not open data/);
  assert.match(DEEPSTATE_MIRROR_LICENSE.mirrorCode, /not to the data/);
  assert.match(DEEPSTATE_MIRROR_NOTE, /Not a live front line/);
  assert.match(DEEPSTATE_MIRROR_NOTE, /2–3 day delay/);
  assert.ok(!/ODbL|no consent issue/i.test(JSON.stringify(DEEPSTATE_MIRROR_LICENSE) + DEEPSTATE_MIRROR_NOTE));
});

test('zdroj snímky: prvý raz upstream, hneď potom pamäť bez nového dopytu', async () => {
  const s = await setup(async () => ok(polygon(35)));
  assert.equal((await s.mirror.lookup({ requestedDate: '20260922' })).found.source, 'upstream');
  assert.equal((await s.mirror.lookup({ requestedDate: '20260922' })).found.source, 'memory');
  assert.deepEqual(s.calls, ['20260922']);
});

test('výslovný dátum (tak volá vrstva): chýbajúci deň padne na predošlý', async () => {
  const s = await setup(async (url) => (url.includes('20260922') ? status(404) : ok(polygon(35))));
  const r = await s.mirror.lookup({ requestedDate: '20260922', maxFallback: 7 });
  assert.equal(r.found.key, '20260921');
  assert.equal(r.fallbackDays, 1);
  assert.deepEqual(s.calls, ['20260922', '20260921']);
});

test('negatívna cache: chýbajúci včerajšok sa 30 min znova nepýta, potom áno', async () => {
  let t = NOW;
  const s = await setup(async (url) => (url.includes('20260922') ? status(404) : ok(polygon(35))), { now: () => t });
  const first = await s.mirror.lookup();
  assert.equal(first.found.key, '20260921');
  assert.equal(first.fallbackDays, 1);
  assert.deepEqual(s.calls, ['20260922', '20260921']);
  await s.mirror.lookup();
  assert.deepEqual(s.calls, ['20260922', '20260921'], 'druhý dopyt: 404 z cache, 21. z pamäte');
  t += 31 * 60_000;
  const later = await s.mirror.lookup();
  assert.deepEqual(s.calls, ['20260922', '20260921', '20260922'], 'po 30 min sa včerajšok skúsi znova');
  assert.equal(later.found.source, 'disk', '21. už z disku (pamäť po 15 min vypršala)');
});

test('výpadok mirroru: jeden pokus, potom len disk; bez disku problém upstreamu, nie „nie je"', async () => {
  const a = await setup(async () => status(500));
  const down = await a.mirror.lookup();
  assert.equal(down.found, null);
  assert.equal(down.upstreamProblem, true);
  assert.equal(down.upstreamStatus, 500);
  assert.deepEqual(a.calls, ['20260922'], 'po prvej chybe už na GitHub nechodí');

  const b = await setup(async () => status(429));
  await fsp.mkdir(b.dir, { recursive: true });
  await fsp.writeFile(path.join(b.dir, '20260919.geojson'), JSON.stringify(polygon(36)));
  const disk = await b.mirror.lookup();
  assert.equal(disk.found.key, '20260919');
  assert.equal(disk.fallbackDays, 3);
  assert.equal(disk.found.source, 'disk');
  assert.equal(disk.upstreamUnavailable, true, 'starší súbor kvôli výpadku, nie preto, že novší neexistuje');

  const c = await setup(async () => { throw new TypeError('fetch failed'); });
  assert.equal((await c.mirror.lookup()).upstreamStatus, 'network');
});

test('pauza po 429 s Retry-After platí aj pre ďalšie dopyty; disk slúži aj počas pauzy', async () => {
  let t = NOW;
  const s = await setup(async () => status(429, { 'retry-after': '120' }), { now: () => t });
  await fsp.mkdir(s.dir, { recursive: true });
  await fsp.writeFile(path.join(s.dir, '20260920.geojson'), JSON.stringify(polygon(36)));
  const a = await s.mirror.lookup();
  assert.equal(a.retryAfterSec, 120);
  assert.equal(a.found.key, '20260920');
  assert.equal(a.upstreamUnavailable, true);
  assert.equal(a.upstreamStatus, 429);
  t += 100_000;
  const b = await s.mirror.lookup();
  assert.equal(b.found.key, '20260920', 'počas pauzy všetkých mirrorov disk ďalej slúži');
  assert.ok(['disk', 'memory'].includes(b.found.source));
  assert.deepEqual(s.calls, ['20260922'], 'Retry-After 120 s — druhý dopyt po 100 s na GitHub nešiel');
  t += 30_000;
  await s.mirror.lookup();
  assert.deepEqual(s.calls, ['20260922', '20260922'], 'po Retry-After znova');
});

test('mimo okna fallbacku poctivé „nie je" — starší súbor z disku sa neponúka', async () => {
  const s = await setup(async () => status(404));
  await fsp.mkdir(s.dir, { recursive: true });
  await fsp.writeFile(path.join(s.dir, '20260917.geojson'), JSON.stringify(polygon(36)));
  await fsp.writeFile(path.join(s.dir, '20260921.geojson'), '{"type":"FeatureCollection","features":[]}');
  const r = await s.mirror.lookup({ requestedDate: '20260922', maxFallback: 1 });
  assert.equal(r.found, null, 'prázdny súbor 21. sa neráta, 17. je mimo okna');
  assert.equal(r.upstreamProblem, false);
  const inWindow = await s.mirror.lookup({ requestedDate: '20260922', maxFallback: 5 });
  assert.equal(inWindow.found.key, '20260917');
  assert.equal(inWindow.fallbackDays, 5);
});

test('prázdna kolekcia z mirroru sa neuloží a deň sa preskočí', async () => {
  const s = await setup(async (url) => (url.includes('20260922') ? ok({ type: 'FeatureCollection', features: [] }) : ok(polygon(35))));
  const r = await s.mirror.lookup();
  assert.equal(r.found.key, '20260921');
  assert.deepEqual((await fsp.readdir(s.dir)).sort(), ['20260921.geojson']);
});

test('jeden dopyt na deň naraz; synchrónne zlyhaný dopyt po pauze nevisí', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = await setup(async () => { await gate; return ok(polygon(35)); });
  const both = Promise.all([s.mirror.lookup(), s.mirror.lookup()]);
  await new Promise((r) => setTimeout(r, 10));
  release();
  const [r1, r2] = await both;
  assert.equal(r1.found.key, '20260922'); assert.equal(r2.found.key, '20260922');
  assert.deepEqual(s.calls, ['20260922']);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-dsm-'));
  roots.push(root);
  let t = NOW;
  let first = true;
  let calls = 0;
  const m = createDeepStateMirror({ root, now: () => t, log: () => {}, fetchImpl: () => { calls += 1; if (first) { first = false; throw new Error('sync boom'); } return Promise.resolve(ok(polygon(35))); } });
  const boom = await m.lookup();
  assert.equal(boom.upstreamProblem, true);
  assert.equal(boom.upstreamStatus, 'network');
  assert.equal(boom.retryAfterSec, 60, 'minimálna pauza je presne minúta');
  t += 59_000;
  await m.lookup();
  assert.equal(calls, 1, 'ani po 59 s nie');
  t -= 29_000;
  assert.equal((await m.lookup()).found, null, 'počas pauzy sa na GitHub nechodí');
  assert.equal(calls, 1);
  t += 31_000;
  assert.equal((await m.lookup()).found.key, '20260922', 'po pauze nový pokus');
  assert.equal(calls, 2);
});

test('vyčerpaný čas (30 s) bez chyby: dni bez odpovede sa nerátajú ako skontrolované', async () => {
  let t = NOW;
  const s = await setup(async () => { t += 29_500; return status(404); }, { now: () => t });
  const r = await s.mirror.lookup();
  assert.equal(r.found, null);
  assert.equal(r.budgetExhausted, true);
  assert.equal(r.upstreamProblem, false);
  assert.equal(r.checkedDays, 1);
  assert.equal(r.unresolvedDays, 7);
});
