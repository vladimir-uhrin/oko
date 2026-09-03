// src/data/airportWeather.test.mjs
// METAR karta letiska: formátovanie dekódovaného reportu, výber stanice
// a cache so vstreknutým fetcherom (žiadna sieť v testoch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  METAR_CACHE_TTL_MS,
  cachedMetarCardLines,
  metarCardLines,
  metarStationId,
  requestAirportMetar,
  _resetMetarCacheForTest,
  TAF_MAX_CARD_LINES,
  parseRawTaf,
  tafCardLines,
  tafEpochMs,
} from './airportWeather.js';

const NOW = Date.parse('2026-09-02T04:00:00Z');
const REPORT = {
  icaoId: 'LZIB',
  fltCat: 'VFR',
  wdir: 240,
  wspd: 11,
  visib: '10+',
  temp: 21.7,
  dewp: 12.1,
  altim: 1018.6,
  obsTime: Math.floor(Date.parse('2026-09-02T03:30:00Z') / 1000),
};

test('metarCardLines: plný report → kategória/vietor/dohľadnosť, teploty/QNH, čas+vek', () => {
  assert.deepEqual(metarCardLines(REPORT, NOW), [
    'VFR · 240°/11KT · VIS 10+SM',
    'T22° DP12° · QNH 1019',
    'METAR 03:30Z (30 min)',
  ]);
});

test('metarCardLines: CALM, VRB, nárazy a chýbajúce polia degradujú poctivo', () => {
  assert.equal(metarCardLines({ ...REPORT, wspd: 0, wdir: 0 }, NOW)[0], 'VFR · CALM · VIS 10+SM');
  assert.equal(metarCardLines({ ...REPORT, wdir: 'VRB' }, NOW)[0], 'VFR · VRB/11KT · VIS 10+SM');
  assert.equal(
    metarCardLines({ ...REPORT, wgst: 22 }, NOW)[0],
    'VFR · 240°/11KT G22 · VIS 10+SM',
  );
  // Bez fltCat vedie riadok slovom METAR — kategória sa nevymýšľa.
  assert.equal(metarCardLines({ ...REPORT, fltCat: undefined }, NOW)[0], 'METAR · 240°/11KT · VIS 10+SM');
  // Záporná teplota sa zaokrúhľuje a nesie znamienko.
  assert.equal(metarCardLines({ ...REPORT, temp: -3.4, dewp: -7.8 }, NOW)[1], 'T-3° DP-8° · QNH 1019');
  // Bez času nie je vek — riadok sa vynechá, nikdy sa nefalšuje.
  assert.deepEqual(
    metarCardLines({ fltCat: 'IFR' }, NOW),
    ['IFR'],
  );
  assert.deepEqual(metarCardLines(null, NOW), []);
});

test('metarStationId: ICAO má prednosť, ident je fallback, ne-ICAO identy odpadnú', () => {
  assert.equal(metarStationId({ icao: 'LZIB', ident: 'LZIB' }), 'LZIB');
  assert.equal(metarStationId({ icao: null, ident: 'LZKZ' }), 'LZKZ');
  // OurAirports identy ako 'US-0571' nie sú METAR stanice.
  assert.equal(metarStationId({ icao: null, ident: 'US-0571' }), null);
  assert.equal(metarStationId({ ident: 'lzib' }), null, 'malé písmená nie sú platný kód');
  assert.equal(metarStationId({}), null);
  assert.equal(metarStationId(null), null);
});

test('cache: jeden fetch na stanicu v TTL okne, odpoveď plní riadky, onDone sa zavolá', async () => {
  _resetMetarCacheForTest();
  let fetches = 0;
  const fetcher = async (url) => {
    fetches += 1;
    assert.match(String(url), /\/api\/metar\?ids=LZIB$/);
    return { ok: true, json: async () => [REPORT] };
  };
  let done = 0;
  await requestAirportMetar('LZIB', { fetcher, onDone: () => { done += 1; }, nowMs: NOW });
  assert.equal(fetches, 1);
  assert.equal(done, 1);
  assert.deepEqual(cachedMetarCardLines('LZIB', NOW)[0], 'VFR · 240°/11KT · VIS 10+SM');

  // Čerstvá cache: žiadny ďalší fetch.
  await requestAirportMetar('LZIB', { fetcher, onDone: () => { done += 1; }, nowMs: NOW + 60_000 });
  assert.equal(fetches, 1);
  // Po TTL sa obnoví.
  await requestAirportMetar('LZIB', { fetcher, onDone: () => {}, nowMs: NOW + METAR_CACHE_TTL_MS + 1 });
  assert.equal(fetches, 2);
});

test('cache: prázdna odpoveď je poctivé NO METAR, chyba je UNAVAILABLE a nekešuje sa dlho', async () => {
  _resetMetarCacheForTest();
  await requestAirportMetar('XX99', {
    fetcher: async () => ({ ok: true, json: async () => [] }),
    onDone: () => {},
    nowMs: NOW,
  });
  assert.deepEqual(cachedMetarCardLines('XX99', NOW), ['NO METAR']);

  await requestAirportMetar('YY99', {
    fetcher: async () => ({ ok: false, status: 503 }),
    onDone: () => {},
    nowMs: NOW,
  });
  assert.deepEqual(cachedMetarCardLines('YY99', NOW), ['METAR UNAVAILABLE']);
  // Neznáma stanica bez fetchu: žiadne riadky (karta bez METAR sekcie).
  assert.deepEqual(cachedMetarCardLines('ZZ99', NOW), []);
});

// ── TAF (2026-09-03) ─────────────────────────────────────────────────────────
// Predpoveď prichádza v tom istom zázname ako METAR (`taf=true` v proxy).
// Vzorky nižšie sú reálne odpovede aviationweather.gov.

const TAF_NOW = Date.UTC(2026, 8, 3, 19, 30); // 3. septembra 2026, 19:30Z

test('TAF sa rozloží na platnosť, základ a zmenové skupiny', () => {
  const taf = parseRawTaf('TAF LZIB 031715Z 0318/0418 31009KT CAVOK TEMPO 0322/0416 30015G25KT');
  assert.equal(taf.fromHour, 18);
  assert.equal(taf.toHour, 18);
  assert.deepEqual(taf.base, ['31009KT', 'CAVOK']);
  assert.equal(taf.groups.length, 1);
  assert.equal(taf.groups[0].kind, 'TEMPO');
  assert.deepEqual(taf.groups[0].body, ['30015G25KT']);
});

test('PROB30 TEMPO ostáva JEDNOU skupinou, nie dvoma', () => {
  // Bez tohto sa každá predpoveď s pravdepodobnostnou skupinou rozsype:
  // 'PROB30' by zostalo prázdnou skupinou a 'TEMPO' by stratilo prefix.
  const taf = parseRawTaf(
    'TAF EGLL 031700Z 0318/0424 22012KT 9999 SCT025 PROB30 TEMPO 0320/0402 6000 RA BKN012 BECMG 0406/0409 24015G28KT',
  );
  const kinds = taf.groups.map((g) => g.kind);
  assert.deepEqual(kinds, ['PROB30 TEMPO', 'BECMG']);
  assert.ok(taf.groups[0].body.includes('RA'), 'telo pravdepodobnostnej skupiny ostalo pri nej');
});

test('FM skupina nesie čas začiatku a nemá koniec', () => {
  const taf = parseRawTaf('TAF KJFK 031720Z 0318/0424 18010KT P6SM FEW050 FM040200 20014G22KT P6SM BKN035');
  const fm = taf.groups.find((g) => g.kind === 'FM');
  assert.equal(fm.day, 4);
  assert.equal(fm.hour, 2);
  assert.equal(fm.toDay, null, 'FM platí až do ďalšej zmeny — koniec nemá');
});

test('teplotné extrémy sa do karty nedostanú', () => {
  // LOWW ich bežne posiela; do 2-riadkovej karty nepatria.
  const taf = parseRawTaf('TAF LOWW 031700Z 0318/0424 27008KT CAVOK TX24/0314Z TNM01/0403Z');
  assert.deepEqual(taf.base, ['27008KT', 'CAVOK']);
});

test('nezmyselný alebo chýbajúci TAF vráti null, nie polovičný objekt', () => {
  for (const bad of [null, undefined, '', '   ', 'METAR LZIB 031700Z', 'TAF', 'úplný nezmysel']) {
    assert.equal(parseRawTaf(bad), null, `${String(bad)} → null`);
  }
});

test('tafEpochMs kotví okolo teraz a zvládne prelom mesiaca', () => {
  // 3. septembra o 19:30 znamená „deň 4" zajtra.
  assert.equal(tafEpochMs(4, 2, 0, TAF_NOW), Date.UTC(2026, 8, 4, 2, 0));
  // Predpoveď vydaná 30. septembra na 1. októbra: deň 1 patrí DO BUDÚCNOSTI.
  const endOfMonth = Date.UTC(2026, 8, 30, 22, 0);
  assert.equal(tafEpochMs(1, 6, 0, endOfMonth), Date.UTC(2026, 9, 1, 6, 0), 'skok cez koniec mesiaca');
  // A opačne: 1. októbra sa „deň 30" vzťahuje na september.
  const startOfMonth = Date.UTC(2026, 9, 1, 2, 0);
  assert.equal(tafEpochMs(30, 22, 0, startOfMonth), Date.UTC(2026, 8, 30, 22, 0), 'skok späť');
  assert.equal(tafEpochMs(99, 5, 0, TAF_NOW), null, 'nezmyselný deň');
  assert.equal(tafEpochMs(4, 2, 0, Number.NaN), null, 'nezmyselná kotva');
});

test('karta dostane najviac dva riadky: platnosť a najbližšiu zmenu', () => {
  const report = {
    rawTaf: 'TAF LZIB 031715Z 0318/0418 31009KT CAVOK TEMPO 0322/0416 30015G25KT BECMG 0416/0418 27005KT',
  };
  const lines = tafCardLines(report, TAF_NOW);
  assert.equal(lines.length, TAF_MAX_CARD_LINES);
  assert.match(lines[0], /^TAF 18Z\/18Z/);
  assert.match(lines[0], /CAVOK/);
  assert.match(lines[1], /^TEMPO 22Z-16Z/);
  assert.match(lines[1], /30015G25KT/);
  assert.match(lines[1], /\+1$/, 'zvyšné skupiny sa spočítajú, nevypisujú');
});

test('vypršaná predpoveď mlčí, letisko bez TAF tiež', () => {
  // Horšie než žiadna predpoveď je stará predpoveď tváriaca sa ako platná.
  const stale = { rawTaf: 'TAF LZIB 011715Z 0118/0218 31009KT CAVOK' };
  assert.deepEqual(tafCardLines(stale, TAF_NOW), []);
  assert.deepEqual(tafCardLines({}, TAF_NOW), [], 'chýbajúci rawTaf');
  assert.deepEqual(tafCardLines(null, TAF_NOW), []);
});

test('proxy pýta TAF tým istým requestom ako METAR', () => {
  // Zdieľaný limit 100 req/min: druhý request na predpoveď by záťaž zdvojil.
  const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(config, /api\/data\/metar\?ids=\$\{station\}&format=json&taf=true/);
});
