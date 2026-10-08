// src/data/weatherWarnings.test.mjs
// Výstrahy SHMÚ po okresoch (2026-10-08): kódy okresov z EMMA_ID, normalizácia MeteoAlarmu,
// stav okresu (stupeň, platí / ohlásená), serverová služba s cache, karta a vrstva. Správanie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SK_DISTRICTS, districtCodesForArea } from './skDistricts.js';
import { awarenessNumber, districtStates, isActiveAt, normalizeMeteoalarm, warningTimeLabel } from './weatherWarnings.js';
import { createWeatherWarningsService, WARNINGS_FRESH_MS } from './weatherWarningsService.js';
import { bottomLimitFrom, cardBox, createShmuWarningsLayer, warningCardModel } from './shmuWarningsLayer.js';

const NOW = Date.parse('2026-10-08T15:00:00Z');

function info({ lang = 'sk', level = '2; yellow; Moderate', type = '1; Wind', emma = 'SK503', area = 'Dolný Kubín', onset = '2026-10-08T12:00:00-00:00', expires = '2026-10-08T19:00:00-00:00', headline = 'Nárazy vetra' } = {}) {
  return {
    language: lang, event: lang === 'sk' ? 'Výstraha pred vetrom' : 'Moderate wind warning', headline, description: 'V okrese …', instruction: 'ZVÝŠTE POZORNOSŤ',
    onset, expires, effective: onset,
    area: [{ areaDesc: area, geocode: [{ valueName: 'EMMA_ID', value: emma }] }],
    parameter: [{ valueName: 'awareness_level', value: level }, { valueName: 'awareness_type', value: type }],
  };
}
const feed = (...alerts) => ({ warnings: alerts.map((infos, i) => ({ uuid: `u${i}`, alert: { identifier: `id${i}`, sent: '2026-10-08T09:31:12+00:00', info: infos } })) });

test('79 okresov s jedinečnými kódmi, EMMA_ID → kód; Bratislava a Košice ako celok', () => {
  assert.equal(SK_DISTRICTS.length, 79);
  assert.equal(new Set(SK_DISTRICTS.map(([c]) => c)).size, 79);
  assert.deepEqual(districtCodesForArea('SK106', 'Malacky'), ['106']);
  assert.deepEqual(districtCodesForArea('SK405', 'Šaľa'), ['405']);
  assert.deepEqual(districtCodesForArea('SK100', 'Bratislava'), ['101', '102', '103', '104', '105']);
  assert.deepEqual(districtCodesForArea('SK8xx', 'Košice'), ['802', '803', '804', '805']);
  assert.deepEqual(districtCodesForArea(null, 'Liptovský Mikuláš'), ['505']);
  assert.deepEqual(districtCodesForArea('XX999', 'Neznámo'), []);
});

test('polygóny okresov v public/ majú všetkých 79 kódov', () => {
  const data = JSON.parse(readFileSync(new URL('../../public/meteo-warnings/sk-okresy.json', import.meta.url), 'utf8'));
  for (const [code, name] of SK_DISTRICTS) {
    assert.ok(data[code], `chýba ${code}`);
    assert.equal(data[code].name, name);
    assert.ok(data[code].rings[0].length > 10);
  }
});

test('normalizácia: slovenský text, stupeň, kódy; zelené a skončené vynechá; najvyšší stupeň prvý', () => {
  const list = normalizeMeteoalarm(feed(
    [info(), info({ lang: 'en', headline: 'Wind gusts' })],
    [info({ level: '3; orange; Severe', emma: 'SK100', area: 'Bratislava' })],
    [info({ level: '1; green; Minor' })],
    [info({ expires: '2026-10-08T14:00:00-00:00' })],
  ), NOW);
  assert.equal(list.length, 2);
  assert.equal(list[0].level, 3);
  assert.deepEqual(list[0].codes, ['101', '102', '103', '104', '105']);
  assert.equal(list[1].headline, 'Nárazy vetra');
  assert.equal(list[1].headlineEn, 'Wind gusts');
  assert.equal(list[1].type, 'wind');
  assert.equal(list[1].sent, '2026-10-08T09:31:12.000Z');
  assert.equal(awarenessNumber('4; red; Extreme'), 4);
  assert.deepEqual(normalizeMeteoalarm(null), []);
});

test('okres: najvyšší stupeň; „platí" len ak výstraha toho stupňa už začala', () => {
  const list = normalizeMeteoalarm(feed(
    [info({ onset: '2026-10-08T12:00:00Z' })],
    [info({ level: '3; orange; Severe', onset: '2026-10-08T21:00:00Z', expires: '2026-10-09T02:00:00Z' })],
  ), NOW);
  const s = districtStates(list, NOW).get('503');
  assert.equal(s.level, 3);
  assert.equal(s.active, false); // oranžová je ohlásená na 21:00
  assert.equal(s.warnings.length, 2);
  assert.equal(isActiveAt(list[1], NOW), true);
  assert.equal(districtStates(list, Date.parse('2026-10-08T22:00:00Z')).get('503').active, true);
});

test('čas výstrahy v slovenskom čase bez nuly na začiatku dňa', () => {
  assert.equal(warningTimeLabel('2026-10-08T21:00:00Z', 'sk'), 'št 8. 10. 23:00');
  assert.equal(warningTimeLabel('2026-10-08T21:00:00Z', 'en'), 'Thu 8/10 23:00');
  assert.equal(warningTimeLabel('x'), '—');
});

test('služba: cache 5 min, pri výpadku staré dáta so stale, bez cache 502', async () => {
  let now = NOW;
  let ok = true;
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok, status: ok ? 200 : 503, text: async () => JSON.stringify(feed([info()])) }; };
  const svc = createWeatherWarningsService({ fetchImpl, now: () => now });
  const [a, b] = await Promise.all([svc.get(), svc.get()]);
  assert.equal(a.payload.warnings.length, 1);
  assert.equal(b.status, 200);
  assert.equal(calls, 1);
  assert.equal((await svc.get()).cache, 'HIT');
  now += WARNINGS_FRESH_MS + 1;
  ok = false;
  const stale = await svc.get();
  assert.equal(stale.payload.stale, true);
  const cold = createWeatherWarningsService({ fetchImpl, now: () => now });
  assert.equal((await cold.get()).status, 502);
});

test('karta: najvyšší stupeň hore, „platí" podľa času; poloha karty nad meteogramom', () => {
  const list = normalizeMeteoalarm(feed(
    [info()],
    [info({ level: '3; orange; Severe', onset: '2026-10-08T21:00:00Z', expires: '2026-10-09T02:00:00Z' })],
  ), NOW);
  const model = warningCardModel('Dolný Kubín', list, { lang: 'sk', nowMs: NOW, translate: (k, v) => `${k}${v ? JSON.stringify(v) : ''}` });
  assert.match(model.title, /Dolný Kubín/);
  assert.equal(model.items[0].color, '#ff8a00');
  assert.equal(model.items[0].active, false);
  assert.equal(model.items[1].active, true);
  const box = cardBox({ at: { x: 600, y: 500 }, width: 300, height: 400, viewW: 1440, viewH: 900, bottomLimit: 450 });
  assert.ok(box.y + Math.min(400, box.maxHeight) <= 442, 'spodok karty nad meteogramom');
  assert.equal(box.maxHeight, 434);
  // Mobil bez meteogramu: karta nesmie zájsť pod spodnú lištu (#oko-appbar).
  assert.equal(bottomLimitFrom([null, { top: 802, height: 58 }]), 802);
  assert.equal(bottomLimitFrom([{ top: 448, height: 250 }, { top: 802, height: 58 }]), 448);
  assert.equal(bottomLimitFrom([{ top: 0, height: 0 }]), null);
});

function layerHarness(warnings) {
  const added = [];
  const listeners = {};
  const built = [];
  let preRender = null;
  const viewer = {
    scene: {
      primitives: { add(p) { added.push(p); return p; }, remove(p) { const i = added.indexOf(p); if (i >= 0) added.splice(i, 1); } },
      canvas: { addEventListener(t, fn) { (listeners[t] ||= []).push(fn); }, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      camera: { positionCartographic: { height: 600_000 } },
      preRender: { addEventListener(fn) { preRender = fn; }, removeEventListener() {} },
      pick: () => undefined,
    },
  };
  const districts = JSON.parse(readFileSync(new URL('../../public/meteo-warnings/sk-okresy.json', import.meta.url), 'utf8'));
  const layer = createShmuWarningsLayer({
    fetchImpl: async (url) => ({ ok: true, json: async () => (url.includes('sk-okresy') ? districts : { fetchedAt: '2026-10-08T14:59:00Z', warnings }) }),
    doc: null,
    now: () => NOW,
    primitivesFactory: (entries) => { built.push(entries); return { elevated: { show: true, kind: 'elevated' }, ground: { show: true, kind: 'ground' } }; },
  });
  return { layer, viewer, added, built, frame: () => preRender?.() };
}

test('vrstva: zapnutie načíta okresy a výstrahy, okres s výstrahou sa nakreslí; vypnutie upratuje', async () => {
  const warnings = normalizeMeteoalarm(feed([info()], [info({ emma: 'SK100', area: 'Bratislava' })]), NOW);
  const h = layerHarness(warnings);
  h.layer.init(h.viewer);
  h.layer.enable();
  await new Promise((r) => setTimeout(r, 30));
  const st = h.layer._getStateForTest();
  assert.equal(st.districts, 6); // Dolný Kubín + Bratislava I–V
  assert.equal(h.layer.getStats().count, 6);
  assert.equal(h.added.length, 2, 'na teréne + nad meteo poľom');
  assert.equal(st.ground, false, 'z 600 km sa kreslí nad poľom');
  const entries = h.built.at(-1);
  assert.deepEqual(entries.map((e) => e.code).sort(), ['101', '102', '103', '104', '105', '503']);
  assert.equal(entries.find((e) => e.code === '503').color, '#ffd200');
  assert.equal(entries.find((e) => e.code === '503').active, true);
  const [ground, elevated] = h.added;
  assert.equal(elevated.show, true);
  assert.equal(ground.show, false);
  h.viewer.scene.camera.positionCartographic.height = 20_000;
  h.frame();
  assert.equal(ground.show, true, 'pod 30 km na teréne');
  assert.equal(elevated.show, false);
  h.layer.disable();
  assert.equal(h.added.length, 0);
});
