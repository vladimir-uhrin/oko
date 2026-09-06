// src/data/metarSummary.test.mjs
// METAR v ľudskej reči (2026-09-05): titulok, druh počasia pre glyf, letová
// kategória zo servera aj dopočítaná, vek pozorovania. Čistý modul.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FLIGHT_CATEGORIES,
  METAR_STALE_MIN,
  WEATHER_KINDS,
  ceilingFt,
  cloudKind,
  flightCategory,
  metarHeadline,
  metarSummary,
  presentWeather,
  visibilitySm,
  weatherGlyphDataUri,
  weatherGlyphSvg,
  weatherKind,
  windSectorKey,
} from './metarSummary.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const mk = (strings) => (key, vars) => {
  let text = strings[key] || key;
  for (const [k, v] of Object.entries(vars || {})) text = text.replaceAll(`{${k}}`, String(v));
  return text;
};
const sk = mk(SK_STRINGS);
const en = mk(EN_STRINGS);

const LZIB_RAIN = {
  temp: 14.2, dewp: 12.0, wdir: 270, wspd: 12, wgst: null, visib: '10+', altim: 1016,
  clouds: [{ cover: 'SCT', base: 2500 }, { cover: 'OVC', base: 4000 }],
  wxString: '-RA', fltCat: 'VFR', obsTime: 1_800_000_000,
};

test('počasie: titulok v ľudskej reči — obloha, jav, teplota, vietor', () => {
  assert.equal(metarHeadline(LZIB_RAIN, sk), 'Zamračené, slabý dážď · 14 °C · vietor 12 kt od západu');
  assert.equal(metarHeadline(LZIB_RAIN, en), 'Overcast, light rain · 14 °C · wind 12 kt from W');
  assert.equal(metarHeadline({ clouds: [{ cover: 'CLR' }], temp: 28, wspd: 0 }, sk), 'Jasno · 28 °C · bezvetrie');
  assert.equal(metarHeadline({ clouds: [{ cover: 'FEW', base: 3500 }], temp: -3.6, wdir: 'VRB', wspd: 4 }, sk), 'Skoro jasno · -4 °C · vietor 4 kt, premenlivý');
  assert.equal(metarHeadline({ wxString: 'FG', clouds: [{ cover: 'OVC', base: 200 }], temp: 2, wdir: 10, wspd: 3 }, sk), 'Hmla · 2 °C · vietor 3 kt od severu', 'hmla stojí sama, bez oblohy pred ňou');
  // 200° je bližšie k juhu (180) než k juhozápadu (225); sektor S siaha po 202,5°.
  assert.equal(metarHeadline({ wxString: '+TSRA', clouds: [{ cover: 'BKN', base: 1500 }], temp: 22, wdir: 200, wspd: 18, wgst: 35 }, sk), 'Oblačno, búrka · 22 °C · vietor 18 kt od juhu, nárazy 35 kt');
  assert.equal(metarHeadline({ clouds: [{ cover: 'BKN', base: 1500 }], temp: 22, wdir: 220, wspd: 18 }, sk), 'Oblačno · 22 °C · vietor 18 kt od juhozápadu');
  assert.equal(metarHeadline({ wxString: 'FZDZ', clouds: [{ cover: 'OVC', base: 800 }], temp: -1, wdir: 90, wspd: 6 }, sk), 'Zamračené, mrznúci mrholenie · -1 °C · vietor 6 kt od východu');
  assert.equal(metarHeadline({}, sk), '', 'prázdna správa = prázdny titulok, nie „undefined"');
  assert.equal(metarHeadline(null, sk), '');
});

test('počasie: druh pre glyf — jav má prednosť pred oblačnosťou', () => {
  assert.equal(weatherKind(LZIB_RAIN), 'rain');
  assert.equal(weatherKind({ clouds: [{ cover: 'FEW', base: 3000 }, { cover: 'BKN', base: 6000 }] }), 'broken', 'najhustejšia vrstva');
  assert.equal(weatherKind({ clouds: [{ cover: 'VV', base: 100 }] }), 'overcast', 'vertikálna dohľadnosť = zakrytá obloha');
  assert.equal(weatherKind({ clouds: [{ cover: 'CAVOK' }] }), 'clear');
  assert.equal(weatherKind({ wxString: 'TSRA' }), 'thunder');
  assert.equal(weatherKind({ wxString: 'SHSN' }), 'snow');
  assert.equal(weatherKind({ wxString: 'BR' }), 'mist');
  assert.equal(weatherKind({ wxString: 'HZ' }), 'haze');
  assert.equal(weatherKind({}), null);
  assert.deepEqual(presentWeather({ wxString: '+SHRA' }), { kind: 'rain', intensity: 'heavy', freezing: false });
  assert.deepEqual(presentWeather({ wxString: 'FZFG' }), { kind: 'fog', intensity: null, freezing: true });
  assert.equal(cloudKind({ clouds: [] }), null);
  for (const kind of WEATHER_KINDS) assert.match(weatherGlyphSvg(kind), /^<svg /, kind);
});

test('počasie: letová kategória — zo servera, inak dopočítaná zo stropu a dohľadnosti', () => {
  assert.deepEqual(FLIGHT_CATEGORIES, ['VFR', 'MVFR', 'IFR', 'LIFR']);
  assert.equal(flightCategory(LZIB_RAIN), 'VFR', 'fltCat zo servera má prednosť');
  assert.equal(flightCategory({ fltCat: 'nonsense', clouds: [{ cover: 'OVC', base: 400 }], visib: 5 }), 'LIFR', 'neplatný fltCat → dopočítať');
  assert.equal(flightCategory({ clouds: [{ cover: 'BKN', base: 800 }], visib: '10+' }), 'IFR');
  assert.equal(flightCategory({ clouds: [{ cover: 'SCT', base: 800 }], visib: '10+' }), 'VFR', 'SCT nie je strop');
  assert.equal(flightCategory({ clouds: [{ cover: 'OVC', base: 2500 }], visib: 6 }), 'MVFR');
  assert.equal(flightCategory({ clouds: [{ cover: 'CLR' }], visib: '1/2' }), 'LIFR', 'dohľadnosť pol míle');
  assert.equal(flightCategory({ clouds: [{ cover: 'CLR' }], visib: 4 }), 'MVFR');
  assert.equal(flightCategory({ clouds: [{ cover: 'OVC', base: 5000 }], visib: 10 }), 'VFR');
  assert.equal(flightCategory({}), null, 'bez údajov nehádame');
  assert.equal(visibilitySm({ visib: '10+' }), 10);
  assert.equal(visibilitySm({ visib: '1/4' }), 0.25);
  assert.equal(visibilitySm({ visib: 3 }), 3);
  assert.equal(visibilitySm({ visib: '' }), null);
  assert.equal(ceilingFt({ clouds: [{ cover: 'FEW', base: 500 }, { cover: 'OVC', base: 3000 }, { cover: 'BKN', base: 1200 }] }), 1200);
});

test('počasie: smer vetra v ôsmich sektoroch, aj cez sever', () => {
  assert.equal(windSectorKey(0), 'wx.dir-n');
  assert.equal(windSectorKey(359), 'wx.dir-n');
  assert.equal(windSectorKey(22), 'wx.dir-n');
  assert.equal(windSectorKey(23), 'wx.dir-ne');
  assert.equal(windSectorKey(270), 'wx.dir-w');
  assert.equal(windSectorKey(292), 'wx.dir-w');
  assert.equal(windSectorKey(293), 'wx.dir-nw');
  assert.equal(windSectorKey('VRB'), null);
  assert.equal(windSectorKey(null), null);
});

test('počasie: zhrnutie pre kartu — glyf ako data URI, vek pozorovania a varovanie', () => {
  const now = LZIB_RAIN.obsTime * 1000 + 20 * 60_000;
  const s = metarSummary(LZIB_RAIN, now, sk);
  assert.equal(s.kind, 'rain');
  assert.equal(s.category, 'VFR');
  assert.match(s.headline, /^Zamračené, slabý dážď/);
  assert.match(s.glyph, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.doesNotMatch(s.glyph, /[<>"#]/, 'URI bez surových znakov');
  assert.equal(decodeURIComponent(s.glyph.split(',')[1]), weatherGlyphSvg('rain'));
  assert.equal(s.ageMin, 20);
  assert.equal(s.stale, false);
  const old = metarSummary(LZIB_RAIN, now + (METAR_STALE_MIN + 5) * 60_000, sk);
  assert.equal(old.stale, true, 'staršie než 90 min = varovanie');
  assert.equal(metarSummary({ obsTime: 1 }, now, sk), null, 'bez titulku aj kategórie nič');
  assert.equal(metarSummary(null, now, sk), null);
  assert.equal(weatherGlyphDataUri('clear').includes('%3Csvg'), true);
});

test('počasie: i18n má všetky kľúče v EN aj SK a bez emoji', () => {
  const keys = [
    ...WEATHER_KINDS.map((k) => `wx.${k}`),
    'wx.light', 'wx.heavy', 'wx.freezing', 'wx.wind-calm', 'wx.wind-from', 'wx.wind-variable', 'wx.gust',
    'wx.dir-n', 'wx.dir-ne', 'wx.dir-e', 'wx.dir-se', 'wx.dir-s', 'wx.dir-sw', 'wx.dir-w', 'wx.dir-nw',
    'wx.cat-vfr', 'wx.cat-mvfr', 'wx.cat-ifr', 'wx.cat-lifr', 'wx.stale', 'wx.raw-show', 'wx.raw-hide',
  ];
  for (const k of keys) {
    assert.ok(EN_STRINGS[k], `EN ${k}`);
    assert.ok(SK_STRINGS[k], `SK ${k}`);
    assert.doesNotMatch(SK_STRINGS[k], /[\u{1F300}-\u{1FAFF}]/u, `emoji v ${k}`);
  }
  const src = readFileSync(new URL('./metarSummary.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fetch\(|document\.|window\./, 'čistý modul: žiadny fetch ani DOM');
});

test('počasie: CAVOK zo servera — prázdne clouds, obloha v poli cover (živý tvar LZIB)', () => {
  // Presne to, čo vrátil /api/metar?ids=LZIB 2026-09-05 21:00Z.
  const live = { temp: 22, dewp: 12, wdir: 280, wspd: 9, visib: '6+', altim: 1021, cover: 'CAVOK', clouds: [], fltCat: 'VFR', rawOb: 'METAR LZIB 052100Z 28009KT 250V310 CAVOK 22/12 Q1021 NOSIG' };
  assert.equal(cloudKind(live), 'clear');
  assert.equal(weatherKind(live), 'clear');
  assert.equal(metarHeadline(live, sk), 'Jasno · 22 °C · vietor 9 kt od západu');
  assert.equal(cloudKind({ cover: 'OVC', clouds: [] }), 'overcast');
  assert.equal(cloudKind({ cover: 'BKN', clouds: [{ cover: 'OVC', base: 900 }] }), 'overcast', 'vrstvy majú prednosť pred súhrnným poľom');
  assert.equal(cloudKind({ cover: 'nonsense', clouds: [] }), null);
});
