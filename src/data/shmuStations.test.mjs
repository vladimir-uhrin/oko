// src/data/shmuStations.test.mjs
// Merania automatických staníc SHMÚ (2026-10-08): čas SEČ → UTC, posledné meranie stanice (nárazy maximum,
// zrážky súčet), spojenie s polohami, najbližšia stanica pre meteogram, služba s cache a vrstva. Správanie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createNearestStationLookup, declutterStationLabels, folderDate, joinStations, latestAwsFile, nearestStation,
  observedSummary, reduceAwsRecords, secToUtcMs,
} from './shmuStations.js';
import { createShmuStationsService, STATIONS_FRESH_MS } from './shmuStationsService.js';
import { createShmuStationsLayer, stationCardRows, stationLabelText, stationTextColor } from './shmuStationsLayer.js';

const META = JSON.parse(readFileSync(new URL('../../public/meteo-stations/shmu-aws.json', import.meta.url), 'utf8'));
const rec = (id, minute, o = {}) => ({ ind_kli: id, minuta: minute, t: 18, vie_pr_rych: 3, vie_max_rych: 4, vie_vp_smer: 200, vlh_rel: 60, tlak: 980, zra_uhrn: 0, ...o });
const AWS = { data: [
  rec(11816, '2026-10-08T18:44:00', { t: 18.1, vie_max_rych: 9.5, zra_uhrn: 0.2 }),
  rec(11816, '2026-10-08T18:48:00', { t: 18.4, vie_pr_rych: 3.5, vie_max_rych: 5, zra_uhrn: 0.1 }),
  rec(11816, '2026-10-08T18:46:00', { t: 18.2, tlak: null }),
  rec(11898, '2026-10-08T18:48:00', { t: 12.3, tlak: null }),
  rec(99999, '2026-10-08T18:48:00'),
] };

test('čas SEČ → UTC a priečinok podľa miestneho dátumu', () => {
  assert.equal(new Date(secToUtcMs('2026-10-08T18:48:00')).toISOString(), '2026-10-08T17:48:00.000Z');
  assert.ok(Number.isNaN(secToUtcMs('x')));
  assert.equal(folderDate(Date.parse('2026-10-08T22:30:00Z')), '20261009'); // 00:30 SELČ
  assert.equal(folderDate(Date.parse('2026-10-08T12:00:00Z')), '20261008');
});

test('najnovší súbor z výpisu priečinka', () => {
  const html = '<a href="aws1min%20-%202026-10-08%2019-50-00.json">x</a><a href="aws1min%20-%202026-10-08%2020-00-00.json">y</a><a href="?C=M">z</a>';
  assert.equal(latestAwsFile(html), 'aws1min - 2026-10-08 20-00-00.json');
  assert.equal(latestAwsFile('<html></html>'), null);
});

test('posledné meranie stanice: hodnoty z poslednej minúty, náraz = maximum okna, zrážky = súčet', () => {
  const m = reduceAwsRecords(AWS);
  const s = m.get('11816');
  assert.equal(s.t, 18.4);
  assert.equal(s.wind, 3.5);
  assert.equal(s.gust, 9.5);
  assert.equal(s.precip, 0.3);
  assert.equal(s.p, 980, 'tlak z poslednej minúty, ktorá ho má');
  assert.equal(s.windowMin, 5);
  assert.equal(new Date(s.at).toISOString(), '2026-10-08T17:48:00.000Z');
  assert.equal(m.get('11898').p, null);
});

test('spojenie s polohami: stanica bez polohy vypadne; zoznam staníc má 94 polôh a približné sú označené', () => {
  const list = joinStations(reduceAwsRecords(AWS), META);
  assert.deepEqual(list.map((s) => s.id), ['11816', '11898']);
  assert.equal(list[0].name, 'Bratislava - Letisko');
  assert.equal(list[0].approx, false);
  assert.equal(Object.keys(META).length, 94);
  assert.ok(Object.values(META).filter((s) => s.approx).length >= 20);
  assert.equal(META['11963'], undefined, 'Jakubovany (meno 2× v SR) radšej bez polohy');
  assert.equal(META['11969'].src, 'geonames', 'Košice-Podhradová NIE JE stanica Košice-letisko z OSCAR');
});

test('najbližšia stanica do 20 km; súhrn „namerané teraz"', () => {
  const list = joinStations(reduceAwsRecords(AWS), META);
  const hit = nearestStation(list, 48.15, 17.25);
  assert.equal(hit.station.id, '11816');
  assert.ok(hit.km < 5);
  assert.equal(nearestStation(list, 47.0, 17.0), null);
  assert.equal(observedSummary(hit.station, 'sk'), '18,4 °C · vietor 3,5 m/s (nárazy 9,5) · 0,3 mm');
  assert.equal(observedSummary({ t: 5 }, 'en'), '5.0 °C');
});

test('popisky staníc sa neprekrývajú, presná poloha má prednosť pred približnou', () => {
  const keep = declutterStationLabels([
    { id: 'b', x: 100, y: 100, text: '18°', approx: true },
    { id: 'a', x: 105, y: 102, text: '17°' },
    { id: 'c', x: 300, y: 100, text: '9°' },
  ]);
  assert.deepEqual([...keep].sort(), ['a', 'c']);
});

test('karta a popisok stanice', () => {
  assert.equal(stationLabelText({ t: 18.6 }), '19°');
  assert.equal(stationLabelText({ t: null }), '–');
  const rows = stationCardRows({ t: 18.44, wind: 3.5, dir: 270, gust: 9.5, rh: 60, p: null, precip: 0.3, windowMin: 5, snow: null, vis: 12500 }, 'sk');
  assert.deepEqual(rows.map((r) => r[0]), ['st.temp', 'st.wind', 'st.gust', 'st.rh', 'st.precip', 'st.vis']);
  assert.equal(rows[0][1], '18,4 °C');
  assert.match(rows[1][1], /^3,5 m\/s · 270° W$/);
  assert.equal(rows[4][1], '0,3 mm / 5 min');
  assert.equal(rows[5][1], '12,5 km');
  assert.match(stationTextColor(15), /^rgb\(\d+, \d+, \d+\)$/);
  assert.equal(stationTextColor(null), 'rgb(200, 205, 210)');
});

test('služba: cache 5 min, včerajší priečinok tesne po polnoci, stale pri výpadku', async () => {
  let now = Date.parse('2026-10-08T22:02:00Z'); // 00:02 SELČ 9. 10.
  let ok = true;
  const urls = [];
  const fetchText = async (url) => {
    urls.push(url);
    if (!ok) throw new Error('down');
    if (url.endsWith('/20261009/')) return '<html>prázdny priečinok</html>';
    if (url.endsWith('/20261008/')) return '<a href="aws1min%20-%202026-10-08%2023-55-00.json">x</a>';
    return JSON.stringify(AWS);
  };
  const svc = createShmuStationsService({ fetchText, meta: META, now: () => now });
  const a = await svc.get();
  assert.equal(a.status, 200);
  assert.equal(a.payload.stations.length, 2);
  assert.ok(urls.at(-1).endsWith('/20261008/aws1min%20-%202026-10-08%2023-55-00.json'));
  assert.equal((await svc.get()).cache, 'HIT');
  now += STATIONS_FRESH_MS + 1;
  ok = false;
  const stale = await svc.get();
  assert.equal(stale.payload.stale, true);
  const cold = createShmuStationsService({ fetchText, meta: META, now: () => now });
  assert.equal((await cold.get()).status, 502);
});

test('načítač pre meteogram: mimo Slovenska nič nesťahuje, inak raz za 2 min', async () => {
  let now = 0;
  let calls = 0;
  const lookup = createNearestStationLookup(async () => { calls += 1; return { ok: true, json: async () => ({ stations: joinStations(reduceAwsRecords(AWS), META) }) }; }, () => now);
  assert.equal(await lookup(52.5, 13.4), null);
  assert.equal(calls, 0);
  assert.equal((await lookup(48.15, 17.25)).station.id, '11816');
  await lookup(48.73, 19.11);
  assert.equal(calls, 1);
  now += 3 * 60_000;
  await lookup(48.73, 19.11);
  assert.equal(calls, 2);
});

test('vrstva: zapnutie načíta stanice a pridá popisky s id na pick; vypnutie upratuje', async () => {
  const added = [];
  const labels = { items: [], add(o) { this.items.push(o); return o; }, remove(o) { this.items = this.items.filter((x) => x !== o); } };
  const viewer = {
    scene: {
      primitives: { add(p) { added.push(p); }, remove(p) { added.splice(added.indexOf(p), 1); }, contains: () => true, raiseToTop() {} },
      canvas: { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), clientWidth: 1000, clientHeight: 800 },
      camera: { positionCartographic: { height: 600_000 }, positionWC: { x: 4e6, y: 1.3e6, z: 5.6e6 } },
      postRender: { addEventListener() {}, removeEventListener() {} },
    },
  };
  let i = 0;
  const layer = createShmuStationsLayer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ observedAt: '2026-10-08T17:48:00Z', stations: joinStations(reduceAwsRecords(AWS), META) }) }),
    doc: null,
    labelsFactory: () => labels,
    now: () => (i += 1000),
  });
  // Bez skutočného Cesium plátna: premietnutie na obrazovku nahradí jednoduchý dvojník.
  const Cesium = await import('cesium');
  const orig = Cesium.SceneTransforms.worldToWindowCoordinates;
  Cesium.SceneTransforms.worldToWindowCoordinates = (scene, pos) => ({ x: (pos.x % 1000 + 1000) % 1000, y: (pos.y % 800 + 800) % 800 });
  try {
    layer.init(viewer);
    layer.enable();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(layer.getStats().count, 2);
    assert.equal(added.length, 1);
    assert.deepEqual(labels.items.map((l) => l.id).sort(), ['shmu-st:11816', 'shmu-st:11898']);
    assert.equal(labels.items.find((l) => l.id === 'shmu-st:11816').text, '18°');
    layer.disable();
    assert.equal(added.length, 0);
  } finally {
    Cesium.SceneTransforms.worldToWindowCoordinates = orig;
  }
});
