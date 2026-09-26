// src/data/wikiControl.test.mjs — spoločné jadro KONTROLY SÍDIEL z Wikipédie (etapa 2 modulu
// BLÍZKY VÝCHOD, 2026-09-26): parser na surových moduloch z 24. 9. (fixtúry), legendy štyroch
// modulov (neznáme ikony sa počítajú, nie zaradia), sýrska syntax bez úvodzoviek, komentáre,
// normalizácia názvov, zlúčenie prstenca s bodkou, raster pre N strán s košmi = hrubá sila
// bit po bite, Ukrajina ako konfigurácia (dnešné tvary výstupu).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FROM_COLOUR, MIDEAST_CONTROL_MODULES, MIDEAST_CONTROL_MODULE_IDS, UKRAINE_CONTROL_CONFIG, UKRAINE_DEFAULT_MK,
  normalizeIconName, parseMkTable, plainLabel, stripLuaComments, wikiControlCodes, wikiControlColours, wikiControlModuleById,
  wikiControlPoints, wikiControlRaster, wikiControlSummary, wikiMarkStatus, wikiParseLuaMarks, wikiSideText,
} from './wikiControl.js';
import { CONTROL_CODE, CONTROL_COLORS, DEFAULT_MK, controlRaster, markStatus, parseLuaMarks } from './ukraineControl.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SRC = {
  'israel-palestine': fixture('wiki-israel-palestine-20260924.lua'),
  yemen: fixture('wiki-yemen-20260924.lua'),
  syria: fixture('wiki-syria-20260924-head.lua'),
  lebanon: fixture('wiki-lebanon-20260924.lua'),
};
const CFG = Object.fromEntries(MIDEAST_CONTROL_MODULES.map((c) => [c.id, c]));
const IP = CFG['israel-palestine'];
const latCount = (text) => (text.match(/\blat\s*=/g) || []).length;
const dots = (points, side) => points.filter((p) => p.side === side && p.kind === 'settlement').length;
const unmappedMsg = (r) => `neznáme ikony: ${JSON.stringify(r.unmapped)}`;

/** Referencia: dnešný controlRaster (hrubá sila) zovšeobecnený na N strán — koše musia dať to isté bit po bite. */
function bruteRaster(points, config, { bbox = config.bbox, cellDeg = config.cellDeg, maxKm = config.maxKm, bandKm = config.bandKm, contestedKm = bandKm } = {}) {
  const codes = wikiControlCodes(config);
  const sides = config.sides.map((s) => s.id);
  const width = Math.max(1, Math.round((bbox.east - bbox.west) / cellDeg));
  const height = Math.max(1, Math.round((bbox.north - bbox.south) / cellDeg));
  const cells = new Uint8Array(width * height);
  const lists = sides.map(() => []);
  const con = [];
  for (const p of points) {
    if (p.kind !== 'settlement' && p.kind !== 'rural') continue;
    const i = sides.indexOf(p.side);
    if (i >= 0) lists[i].push(p); else if (p.side === 'contested' || p.side === 'mixed') con.push(p);
  }
  const KM_LAT = 111.32;
  const nearest = (list, lat, lon, cosLat) => {
    let best = Infinity;
    for (const p of list) { const dy = (p.lat - lat) * KM_LAT; const dx = (p.lon - lon) * KM_LAT * cosLat; const d = dx * dx + dy * dy; if (d < best) best = d; }
    return Math.sqrt(best);
  };
  for (let row = 0; row < height; row += 1) {
    const lat = bbox.north - (row + 0.5) * cellDeg;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    for (let col = 0; col < width; col += 1) {
      const lon = bbox.west + (col + 0.5) * cellDeg;
      const ds = lists.map((l) => nearest(l, lat, lon, cosLat));
      const dC = nearest(con, lat, lon, cosLat);
      let i1 = -1; let d1 = Infinity; let d2 = Infinity;
      ds.forEach((d, k) => { if (d < d1) { d2 = d1; d1 = d; i1 = k; } else if (d < d2) d2 = d; });
      let code = 0;
      if (Math.min(d1, dC) <= maxKm) { if (dC <= contestedKm || d2 - d1 <= bandKm) code = codes.contested; else if (i1 >= 0) code = i1 + 1; }
      cells[row * width + col] = code;
    }
  }
  return cells;
}
const cellAt = (r, lat, lon) => r.cells[Math.floor((r.bbox.north - lat) / r.cellDeg) * r.width + Math.floor((lon - r.bbox.west) / r.cellDeg)];

test('normalizácia názvov ikon: okraje, podčiarkovníky, veľkosť písmen, presmerovanie dark red', () => {
  assert.equal(normalizeIconName('Location dot dark red.svg'), 'location dot darkred.svg');
  assert.equal(normalizeIconName('Location dot dark red.svg'), normalizeIconName('Location dot darkred.svg'));
  assert.equal(normalizeIconName('Dot_yellow_ff4.svg'), normalizeIconName('Dot yellow ff4.svg'));
  assert.equal(normalizeIconName(' Location dot blue.svg'), 'location dot blue.svg');
  assert.equal(normalizeIconName('map-arcEE-blue.svg'), 'map-arcee-blue.svg');
  assert.equal(normalizeIconName('anchor pictogram red.svg'), normalizeIconName('Anchor pictogram red.svg'));
  assert.equal(normalizeIconName(null), '');
  // spojovník vnútri zloženého názvu: druhé farebné slovo dvojice musí byť tmavočervená, nie /red/
  assert.equal(normalizeIconName('Map-ctl2-blue+dark-red.svg'), 'map-ctl2-blue+darkred.svg');
  assert.equal(normalizeIconName('Map-ctl2-blue+dark-red.svg'), normalizeIconName('Map-ctl2-blue+darkred.svg'));
  assert.equal(normalizeIconName('Location dot dark-red.svg'), 'location dot darkred.svg');
});

test('plainLabel: odkaz, tučné, entity, HTML značky preč a biele znaky zlúčené (sýrske dvojjazyčné mená)', () => {
  assert.equal(plainLabel('[[Lyman, Ukraine|Lyman]]'), 'Lyman');
  assert.equal(plainLabel('[[Bakhmut]]'), 'Bakhmut');
  assert.equal(plainLabel("'''Kostiantynivka'''"), 'Kostiantynivka');
  assert.equal(plainLabel(''), null);
  assert.equal(plainLabel('<small></small>'), null, 'len značka = nič');
  assert.equal(plainLabel('[[Al-Sanamayn#civilwar|&nbsp;al-Sanamayn]]'), 'al-Sanamayn');
  assert.equal(plainLabel('Tel&nbsp;Aviv&amp;Jaffa'), 'Tel Aviv&Jaffa');
  // riadok 426 fixtúry wiki-syria-20260924-head.lua doslovne
  assert.equal(plainLabel('[[Ras al-Ayn#Syrian Civil War|Ras al-Ayn&nbsp; <small>(Serêkaniyê)</small>&nbsp;]]'), 'Ras al-Ayn (Serêkaniyê)');
  assert.equal(plainLabel('[[Al-Yaarubiyah|al-Yaarubiyah <small>(Til Koçer)</small>]]'), 'al-Yaarubiyah (Til Koçer)');
  assert.equal(plainLabel("'''Foo  <b>Bar</b>'''"), 'Foo Bar', 'bez odkazu: tučné aj značky preč, medzery zlúčené');
  assert.match(SRC.syria, /Ras al-Ayn&nbsp; <small>\(Serêkaniyê\)<\/small>&nbsp;\]\]/, 'fixtúra nesie surový tvar (riadok 426)');
  const syria = wikiParseLuaMarks(SRC.syria, CFG.syria);
  assert.equal(syria.points.filter((p) => /[<>]/.test(p.name || '')).length, 0, 'v archíve ani na karte nesmie byť surové <small>');
  const ras = syria.points.filter((p) => /^Ras al-Ayn/.test(p.name || ''));
  assert.deepEqual(ras.map((p) => [p.name, p.lat, p.lon, p.side]), [['Ras al-Ayn (Serêkaniyê)', 36.85, 40.067, 'syria-gov']]);
  assert.equal(syria.points.find((p) => /Yaarubiyah/.test(p.name || '')).name, 'al-Yaarubiyah (Til Koçer)');
});

test('komentáre Lua: riadkové aj blokové preč, vnútri reťazcov a dlhých zátvoriek ostávajú', () => {
  const src = 'a = "x -- not a comment", -- real\nb = [[--inside]] -- c\n--[[ block\nline ]] d';
  assert.equal(stripLuaComments(src), 'a = "x -- not a comment", \nb = [[--inside]] \n d');
  assert.equal(stripLuaComments('e = [=[ a -- b ]=] -- gone'), 'e = [=[ a -- b ]=] ');
  assert.equal(latCount(SRC.lebanon), 95, 'surový súbor: 95 výskytov lat = (referencia z 24. 9.)');
  assert.equal(latCount(stripLuaComments(SRC.lebanon)), 85, '10 zakomentovaných značiek zmizne');
  assert.equal(latCount(SRC['israel-palestine']), 1335);
  assert.equal(latCount(stripLuaComments(SRC['israel-palestine'])), 1329, '5 egyptských žltých + riadok šablóny');
  assert.equal(latCount(SRC.yemen), 1286, '1 284 riadkov, dva riadky nesú po dve značky');
});

test('ikona → stav podľa konfigurácie: rovnaký súbor = iná strana v inom module; neznáme = null, podklad = skip', () => {
  assert.deepEqual(wikiMarkStatus('Location dot red.svg', IP), { side: 'hezbollah', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Location dot red.svg', CFG.yemen), { side: 'yemen-gov', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Location dot red.svg', CFG.syria), { side: 'russia', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Location dot red.svg', CFG.lebanon), { side: 'hezbollah', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Dot green 0d0.svg', IP), { side: 'pa', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Dot green 0d0.svg', CFG.yemen), { side: 'houthi', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Map-dot-grey-68a.svg', IP), { side: 'laf', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Map-dot-grey-68a.svg', CFG.yemen), { side: 'aqap', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Map-dot-grey-68a.svg', CFG.syria), { side: 'syria-gov', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Location dot dark red.svg', IP), { side: 'syria', kind: 'settlement' }, 'darkred pred red');
  assert.deepEqual(wikiMarkStatus('Location dot blue.svg', CFG.yemen), { side: 'tribal', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus(' Location dot blue.svg', IP), { side: 'israel', kind: 'settlement' }, 'medzera na začiatku');
  assert.deepEqual(wikiMarkStatus('Fighter-jet-blue-icon.svg', IP), { side: 'israel', kind: 'airport' });
  assert.deepEqual(wikiMarkStatus('Helicopter-red-icon.svg', CFG.yemen), { side: 'yemen-gov', kind: 'heliport' });
  assert.deepEqual(wikiMarkStatus('anchor pictogram red.svg', CFG.yemen), { side: 'yemen-gov', kind: 'port' });
  assert.deepEqual(wikiMarkStatus('Icon_NuclearPowerPlant-grey.svg', CFG.syria), { side: 'syria-gov', kind: 'industry' });
  assert.deepEqual(wikiMarkStatus('Abm-yellow-icon.png', CFG.syria), { side: 'sdf', kind: 'base' });
  assert.deepEqual(wikiMarkStatus('Map-peak-teal.svg', IP), { side: 'jordan', kind: 'hill' });
  assert.deepEqual(wikiMarkStatus('gota01.svg', CFG.yemen), { side: 'yemen-gov', kind: 'oilgas' });
  assert.deepEqual(wikiMarkStatus('Gota02.svg', CFG.yemen), { side: 'houthi', kind: 'oilgas' });
  assert.deepEqual(wikiMarkStatus('Gota04.svg', CFG.syria), { side: 'sdf', kind: 'oilgas' });
  assert.deepEqual(wikiMarkStatus('BSicon STRlf red.svg', CFG.yemen), { side: 'yemen-gov', kind: 'dam' });
  assert.deepEqual(wikiMarkStatus('BSicon STR+r grey.svg', CFG.syria), { side: 'syria-gov', kind: 'dam' });
  assert.deepEqual(wikiMarkStatus('4x4dot-blue.svg', IP), { side: 'israel', kind: 'rural' });
  assert.deepEqual(wikiMarkStatus('Mountain pass 12x12 ne.svg', IP), { side: 'none', kind: 'border-crossing' });
  assert.deepEqual(wikiMarkStatus('Arch dam 12x12 w.svg', IP), { side: 'none', kind: 'dam' });
  // sporné a zmiešané: dvojica strán z farieb alebo výslovne podľa legendy
  assert.deepEqual(wikiMarkStatus('80x80-red-blue-anim.gif', IP), { side: 'contested', kind: 'settlement', between: ['hezbollah', 'israel'] });
  assert.deepEqual(wikiMarkStatus('80x80-red-lime-anim.gif', CFG.yemen), { side: 'contested', kind: 'settlement', between: ['yemen-gov', 'houthi'] });
  assert.deepEqual(wikiMarkStatus('80x80-yellow-grey-anim.gif', CFG.syria), { side: 'contested', kind: 'settlement', between: ['sdf', 'syria-gov'] });
  assert.deepEqual(wikiMarkStatus('Blue-lime-green-square-anim.gif', IP), { side: 'contested', kind: 'settlement', between: ['israel', 'pa'] }, 'podľa textu legendy');
  assert.deepEqual(wikiMarkStatus('Map-ctl2-blue+bright-green.png', IP), { side: 'mixed', kind: 'settlement', between: ['israel', 'pa'] });
  assert.deepEqual(wikiMarkStatus('Map-ctl2-lime+blue.svg', IP), { side: 'mixed', kind: 'settlement', between: ['israel', 'pa'] }, 'legenda: Israel and PA (limetka je inak Hamas — zapísané v konfigurácii)');
  assert.deepEqual(wikiMarkStatus('Map-ctl2-yellow+grey.svg', CFG.syria), { side: 'mixed', kind: 'settlement', between: ['sdf', 'syria-gov'] });
  assert.deepEqual(wikiMarkStatus('Map-ctl2-blue+dark-red.svg', IP), { side: 'mixed', kind: 'settlement', between: ['israel', 'syria'] }, '/doc IP: Izrael/Sýria — dark-red so spojovníkom nie je Hizballáh');
  assert.deepEqual(wikiMarkStatus('Map-ctl2-blue+darkred.svg', IP), wikiMarkStatus('Map-ctl2-blue+dark-red.svg', IP));
  // prstenec/oblúk = tlak farby na sporné sídlo (kontrolu doplní bodka na tých istých súradniciach)
  assert.deepEqual(wikiMarkStatus('Map-circle-blue.svg', IP), { side: 'contested', kind: 'settlement', pressure: 'israel' });
  assert.deepEqual(wikiMarkStatus('map-arcEE-blue.svg', IP), { side: 'contested', kind: 'settlement', pressure: 'israel', direction: 'EE' });
  // podklad a nosiče popisov
  assert.deepEqual(wikiMarkStatus('Israel road-network-overlay.png', IP), { skip: true });
  assert.deepEqual(wikiMarkStatus('Syria location map road overlay.svg', CFG.syria), { skip: true });
  assert.deepEqual(wikiMarkStatus('Situation in Taizz.svg', CFG.yemen), { skip: true });
  assert.deepEqual(wikiMarkStatus('Location dot grey.svg', CFG.yemen, { size: 1 }), { skip: true }, 'nosič popisu SAUDI ARABIA = sivá bodka s marksize 1');
  assert.deepEqual(wikiMarkStatus('Location dot grey.svg', CFG.yemen, { size: 8 }), { side: 'aqap', kind: 'settlement' }, 'sivá bodka bežnej veľkosti ide na farebné pravidlo');
  assert.deepEqual(wikiMarkStatus('Location dot grey.svg', CFG.yemen), { side: 'aqap', kind: 'settlement' }, 'bez veľkosti sa pravidlo so sizeMax preskočí');
  assert.deepEqual(wikiMarkStatus('Location dot grey.svg', CFG.yemen, { size: null }), { side: 'aqap', kind: 'settlement' });
  // neznáme: žiadne tiché zaradenie podľa farby (na rozdiel od Ukrajiny)
  assert.equal(wikiMarkStatus('Foo bar red.svg', IP), null);
  assert.equal(wikiMarkStatus('Location dot pink.svg', IP), null, 'známy tvar, neznáma farba');
  assert.equal(wikiMarkStatus('Location dot lightslategray.svg', IP), null, 'podreťazec „gray" nesmie dať LAF — /doc ju má pri Ľudových silách, caption nie → neznáma');
  assert.equal(wikiMarkStatus('Location dot darkred.svg', CFG.yemen), null, 'farba bez strany v module');
  assert.equal(wikiMarkStatus('', IP), null);
  assert.deepEqual(wikiMarkStatus('Foo bar red.svg', UKRAINE_CONTROL_CONFIG), { side: 'ru', kind: 'other' }, 'Ukrajina: záložné farba → other ako doteraz');
});

test('Ukrajina ako konfigurácia: presne dnešné tvary výstupu markStatus', () => {
  const UA = UKRAINE_CONTROL_CONFIG;
  assert.deepEqual(wikiMarkStatus('Location dot blue.svg', UA), { side: 'ua', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Location dot grey.svg', UA), { side: 'none', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('80x80-red-blue-anim.gif', UA), { side: 'contested', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Map-ctl2-red+blue.svg', UA), { side: 'mixed', kind: 'settlement' });
  assert.deepEqual(wikiMarkStatus('Map-arcNE-red.svg', UA), { side: 'ua', kind: 'settlement', pressure: 'ru', direction: 'NE' });
  assert.deepEqual(wikiMarkStatus('Map-arcSS-blue.svg', UA), { side: 'ru', kind: 'settlement', pressure: 'ua', direction: 'SS' });
  assert.deepEqual(wikiMarkStatus('Map-circle-red.svg', UA), { side: 'ru', kind: 'settlement', pressure: 'ua' });
  assert.deepEqual(wikiMarkStatus('3x3dot-blue.svg', UA), { side: 'ua', kind: 'rural' });
  assert.deepEqual(wikiMarkStatus('Fighter-jet-red-icon.svg', UA), { side: 'ru', kind: 'airbase' });
  assert.deepEqual(wikiMarkStatus('Gota03.svg', UA), { side: 'ua', kind: 'oilgas' });
  assert.deepEqual(wikiMarkStatus('Mountain pass 12x12 n.svg', UA), { side: null, kind: 'border' });
  assert.deepEqual(wikiMarkStatus('Ukraine Roadmap Overlay.png', UA), { skip: true });
  assert.equal(UA.sides[0].id, 'ua'); assert.equal(UA.sides[0].fill, false); assert.equal(UA.sides[1].id, 'ru'); assert.equal(UA.sides[1].fill, true);
  assert.deepEqual(UA.bbox, { west: 22.0, south: 44.2, east: 40.6, north: 52.6 });
  assert.deepEqual([UA.cellDeg, UA.maxKm, UA.bandKm, UA.contestedKm, UA.staleDays, UA.i18nPrefix], [0.05, 35, 7, 7, 14, 'ukraine.ctl']);
  assert.deepEqual(UA.titles.map((t) => [t.id, t.since || null]), [['overview', '2024-04-22'], ['detailed', null]]);
  assert.equal(UA.defaultMk, UKRAINE_DEFAULT_MK);
  assert.deepEqual(UKRAINE_DEFAULT_MK, DEFAULT_MK);
  assert.deepEqual(wikiControlCodes(UA), { none: 0, ua: 1, ru: 2, contested: 3 });
  assert.deepEqual(wikiControlCodes(UA), CONTROL_CODE);
  assert.deepEqual(wikiControlColours(UA), { ua: '#4fa3ff', ru: '#e0553f', contested: '#ffb547', mixed: '#c68cff', none: '#8a97a3' });
  assert.deepEqual(wikiControlColours(UA), CONTROL_COLORS);
  assert.deepEqual(parseMkTable('nič'), UKRAINE_DEFAULT_MK);
  assert.deepEqual(parseMkTable('nič', {}), {});
  assert.equal(plainLabel('[[Al-Sanamayn#civilwar|&nbsp;al-Sanamayn]]'), 'al-Sanamayn');
  assert.equal(wikiSideText('ru', UA), 'ukraine.ctl.ru');
  assert.equal(wikiSideText('houthi', CFG.yemen), 'mideast.ctl.yemen.houthi');
  assert.equal(wikiSideText(null, IP), 'mideast.ctl.israel-palestine.none');
});

test('sýrska syntax: neuvozovkované čísla, mark= bez medzery, komentár za záznamom, tabulátor pred =', () => {
  const src = '{lat= 34.212, long= 38.8, mark= "Map-dot-grey-68a.svg", marksize=8, label= "[[X|Ex]]", link= "X", label_size=0}, -- note\n'
    + '{ lat = "13.316", long \t= "43.261", mark = "Dot yellow ff4.svg", marksize = "35", label = "[[Y]]" }, { lat = "13.4", long = "43.3", mark = "Dot yellow ff4.svg", marksize = "3" }';
  const r = wikiParseLuaMarks(src, CFG.syria);
  assert.deepEqual(r.points.map((p) => `${p.name}:${p.side}:${p.kind}:${p.lat}:${p.lon}:${p.size}:${p.pop}`), ['Ex:syria-gov:settlement:34.212:38.8:8:5k', 'Y:sdf:settlement:13.316:43.261:35:capital', 'null:sdf:settlement:13.4:43.3:3:small']);
  assert.equal(r.points[0].link, 'X');
  assert.deepEqual([r.skipped, r.sideless, r.invalid], [0, 0, 0]);
  const bad = wikiParseLuaMarks('{ lat = "XX.XXXXX", long = "YY.YYYYY", mark = "Location dot blue.svg" }, { lat = "1", long = "2", mark = "Zzz.svg" }, { lat = "1", long = "3", mark = "Overlay foo.png", marksize = "3138" }', IP);
  assert.deepEqual([bad.points.length, bad.invalid, bad.skipped], [0, 1, 1]);
  assert.deepEqual(bad.unmapped, { 'Zzz.svg': 1 });
});

test('Izrael–Palestína (fixtúra 24. 9.): počty podľa legendy, žiadne neznáme ikony, prstence sa zlúčia s bodkou', () => {
  const raw = wikiParseLuaMarks(SRC['israel-palestine'], IP);
  assert.deepEqual(raw.unmapped, {}, unmappedMsg(raw));
  assert.deepEqual([raw.points.length, raw.skipped, raw.sideless, raw.invalid], [1328, 1, 0, 0], '1 329 aktívnych značiek − cestný prekryv');
  assert.equal(dots(raw.points, 'israel'), 709, 'modré bodky vrátane tej s medzerou');
  assert.equal(dots(raw.points, 'pa'), 393);
  assert.equal(dots(raw.points, 'hamas'), 13);
  assert.equal(dots(raw.points, 'hezbollah'), 24);
  assert.equal(dots(raw.points, 'syria'), 96, '75 darkred + 21 dark red');
  assert.equal(dots(raw.points, 'jordan'), 19);
  assert.equal(dots(raw.points, 'lebanon-locals'), 8);
  assert.equal(dots(raw.points, 'laf'), 3);
  assert.equal(raw.points.filter((p) => p.kind === 'border-crossing').length, 12);
  assert.equal(raw.points.filter((p) => p.kind === 'dam').length, 1);
  const merged = wikiControlPoints([{ id: 'main', src: SRC['israel-palestine'], revision: { revid: 1, timestamp: '2026-09-22T18:56:08Z' } }], IP);
  assert.equal(merged.points.length, 1317, '7 prstencov/oblúkov zlúčených do bodiek + 4 bodky na rovnakých súradniciach');
  assert.deepEqual(merged.revisions, { main: { revid: 1, timestamp: '2026-09-22T18:56:08Z' } });
  assert.ok(merged.points.every((p) => p.module === 'main'));
  const s = wikiControlSummary(merged.points, IP, { unmapped: merged.unmapped });
  assert.deepEqual(s.settlements, { israel: 707, pa: 393, hamas: 13, hezbollah: 23, 'lebanon-locals': 8, laf: 3, syria: 96, jordan: 19, 'popular-forces': 0, contested: 6, mixed: 8, none: 0 });
  assert.deepEqual(s.infrastructure, { israel: 25, pa: 0, hamas: 2, hezbollah: 0, 'lebanon-locals': 0, laf: 0, syria: 0, jordan: 1, 'popular-forces': 0 });
  assert.equal(s.total, 1317);
  assert.deepEqual(s.unmapped, {});
  const byName = (name) => merged.points.find((p) => p.name === name);
  assert.deepEqual([byName('Rmaich').side, byName('Rmaich').pressure], ['lebanon-locals', 'israel'], 'fialová bodka + modrý kruh = miestni obliehaní Izraelom');
  assert.deepEqual([byName('At-Tiri').side, byName('At-Tiri').pressure, byName('At-Tiri').direction], ['hezbollah', 'israel', 'EE']);
  assert.deepEqual([byName('Mayfadoun').side, byName('Mayfadoun').direction], ['hezbollah', 'SS'], 'kruh pred bodkou aj bodka pred kruhom');
  assert.equal(merged.points.filter((p) => p.side === 'contested' && p.pressure).length, 0, 'každý prstenec našiel svoju bodku');
  assert.deepEqual(byName('Tammun').between, ['israel', 'pa']);
  assert.deepEqual([byName('Khan Yunis').side, byName('Khan Yunis').between], ['mixed', ['israel', 'pa']]);
  assert.deepEqual([...byName('Kfar Tebnit').between].sort(), ['hezbollah', 'israel']);
  assert.deepEqual([byName('Al-Bayuk').side, [...byName('Al-Bayuk').between].sort()], ['mixed', ['israel', 'popular-forces']]);
  assert.equal(byName('Gaza').pop, '500k', 'marksize 26 podľa hlavičky modulu');
  assert.equal(merged.points.find((p) => p.icon === ' Location dot blue.svg').side, 'israel');
  assert.ok(merged.points.every((p) => p.lat >= IP.bbox.south && p.lat <= IP.bbox.north && p.lon >= IP.bbox.west && p.lon <= IP.bbox.east), 'rámec rastra kryje všetky body');
});

test('Jemen (fixtúra 24. 9.): červená vláda 449, zelená Húsíovia 418, minimapa Taizz a nosič popisu preč', () => {
  const raw = wikiParseLuaMarks(SRC.yemen, CFG.yemen);
  assert.deepEqual(raw.unmapped, {}, unmappedMsg(raw));
  assert.deepEqual([raw.points.length, raw.skipped, raw.sideless, raw.invalid], [1284, 2, 0, 0], '1 286 značiek − Taizz − SAUDI ARABIA');
  assert.equal(dots(raw.points, 'yemen-gov'), 449);
  assert.equal(dots(raw.points, 'houthi'), 418);
  assert.equal(dots(raw.points, 'tribal'), 2);
  assert.equal(dots(raw.points, 'aqap'), 1);
  assert.equal(raw.points.filter((p) => p.kind === 'hill' && p.side === 'yemen-gov').length, 132);
  assert.equal(raw.points.filter((p) => p.kind === 'hill' && p.side === 'houthi').length, 131);
  assert.equal(raw.points.filter((p) => p.kind === 'port').length, 14, '9 červených (4 s veľkým A + 5 s malým) + 5 zelených kotiev');
  const merged = wikiControlPoints([{ id: 'main', src: SRC.yemen }], CFG.yemen);
  assert.equal(merged.points.length, 1279);
  const s = wikiControlSummary(merged.points, CFG.yemen);
  assert.deepEqual(s.settlements, { 'yemen-gov': 450, houthi: 421, aqap: 2, tribal: 4, isis: 0, contested: 5, mixed: 0, none: 0 });
  assert.deepEqual(s.infrastructure, { 'yemen-gov': 207, houthi: 183, aqap: 0, tribal: 1, isis: 0 });
  assert.equal(s.unmapped, undefined, 'bez odovzdaného unmapped kľúč chýba');
  assert.ok(merged.points.every((p) => p.lat >= CFG.yemen.bbox.south && p.lat <= CFG.yemen.bbox.north && p.lon >= CFG.yemen.bbox.west && p.lon <= CFG.yemen.bbox.east));
  assert.equal(merged.points.find((p) => p.name === 'Sanaa').pop, 'capital');
});

test('Jemen: sivá bodka sa preskakuje LEN ako nosič popisu (marksize 1); bežná sivá bodka je bod AQAP, nie tichý skip', () => {
  const src = '{ lat = "18.3", long = "45.325", mark = "Location dot grey.svg", marksize = "1", label = "SAUDI ARABIA" },\n'
    + '{ lat = "15.5", long = "48.0", mark = "Location dot grey.svg", marksize = "8", label = "[[Some AQAP town]]" },\n'
    + '{ lat = "15.6", long = "48.1", mark = "Location dot grey.svg", label = "[[Bez veľkosti]]" }';
  const r = wikiParseLuaMarks(src, CFG.yemen);
  assert.deepEqual([r.skipped, r.sideless, r.invalid], [1, 0, 0], 'len nosič popisu');
  assert.deepEqual(r.unmapped, {});
  assert.deepEqual(r.points.map((p) => [p.name, p.side, p.kind, p.size]), [['Some AQAP town', 'aqap', 'settlement', 8], ['Bez veľkosti', 'aqap', 'settlement', null]]);
  const fixture = wikiParseLuaMarks(SRC.yemen, CFG.yemen);
  assert.deepEqual([fixture.skipped, dots(fixture.points, 'aqap')], [2, 1], 'fixtúra nezmenená: Taizz + SAUDI ARABIA preskočené, 1 sivá bodka AQAP');
});

test('Ukrajina cez obal: zámerné odchýlky od pôvodného parsera (komentáre, marksize ≥ 40, entity a značky, čierna ikona, raster len so spornými)', () => {
  const src = 'mk = { ukr = "Location dot blue.svg", rus = "Location dot red.svg" }\nreturn { marks = {\n'
    + '{ lat = "48.7", long = "37.7", mark = mk.ukr, marksize = "8", label = "[[Live]]" },\n'
    + '-- { lat = "48.8", long = "37.8", mark = mk.ukr, marksize = "8", label = "[[Commented]]" },\n'
    + '--[[ { lat = "48.85", long = "37.85", mark = mk.rus, marksize = "8", label = "[[Blocked]]" } ]]\n'
    + '{ lat = "48.9", long = "37.9", mark = "Some big picture.png", marksize = "45", label = "[[Overlay]]" },\n'
    + '{ lat = "49.0", long = "38.0", mark = mk.rus, marksize = "8", label = "[[Nova&nbsp;Kakhovka&amp;Co <small>(x)</small>]]" },\n'
    + '{ lat = "49.1", long = "38.1", mark = "Fighter-jet-black-icon.svg", marksize = "8", label = "[[Black jet]]" },\n'
    + '} }';
  // 1 + 2: zakomentované značky (riadkové aj blokové) a marksize 45 nie sú body (pôvodne 9 vs 7 na syntetickom module)
  const pts = parseLuaMarks(src);
  assert.deepEqual(pts.map((p) => [p.name, p.side, p.kind]), [['Live', 'ua', 'settlement'], ['Nova Kakhovka&Co (x)', 'ru', 'settlement']]);
  const raw = wikiParseLuaMarks(src, UKRAINE_CONTROL_CONFIG);
  assert.equal(raw.skipped, 1, 'marksize 45 = obrázok podkladu');
  // Únik pre starý výstup: overlayMarksize v konfigurácii (typedef) prekryv nepreskočí, ale ako ikona je neznámy → počíta sa.
  const keep = wikiParseLuaMarks(src, { ...UKRAINE_CONTROL_CONFIG, overlayMarksize: Infinity });
  assert.equal(keep.skipped, 0, 'overlayMarksize: Infinity = nikdy nepreskočiť');
  assert.equal(keep.unmapped['Some big picture.png'], 1);
  assert.deepEqual(raw.unmapped, { 'Fighter-jet-black-icon.svg': 1 }, '4: známy tvar bez farby strany sa POČÍTA ako neznámy');
  assert.equal(raw.sideless, 0);
  // 3: entity a značky v popise
  assert.equal(pts[1].name, 'Nova Kakhovka&Co (x)');
  // 4: markStatus vracia null (pôvodne { side: null, kind: 'airbase' }); z bodov vypadla v oboch prípadoch
  assert.equal(markStatus('Fighter-jet-black-icon.svg'), null);
  assert.deepEqual(markStatus('Fighter-jet-red-icon.svg'), { side: 'ru', kind: 'airbase' });
  // 5: raster len so spornými/zmiešanými sídlami → none, nie 'ua' (pôvodné počty by boli ua 56, none 540)
  const opts = { bbox: { west: 36, south: 47, east: 39, north: 49 }, cellDeg: 0.1, maxKm: 40, bandKm: 8 };
  const only = controlRaster([{ lat: 48, lon: 37.5, side: 'contested', kind: 'settlement' }], opts);
  assert.deepEqual([only.width, only.height], [30, 20]);
  assert.deepEqual(only.counts, { ua: 0, ru: 0, contested: 4, none: 596 });
  assert.equal(cellAt(only, 48.0, 37.55), CONTROL_CODE.contested);
  assert.equal(cellAt(only, 48.0, 37.05), CONTROL_CODE.none, '39 km od sporného: v maxKm, no bez strany = none, nie ua');
  assert.deepEqual(controlRaster([{ lat: 48, lon: 37.5, side: 'mixed', kind: 'settlement' }], opts).counts, { ua: 0, ru: 0, contested: 4, none: 596 });
  assert.deepEqual([...only.cells], [...bruteRaster([{ lat: 48, lon: 37.5, side: 'contested', kind: 'settlement' }], UKRAINE_CONTROL_CONFIG, opts)], 'hrubá sila s novou sémantikou súhlasí');
});

test('Sýria (orezaná fixtúra 24. 9.): neuvozovkovaná syntax na skutočnom module, ≥ 500 značiek, žiadne neznáme', () => {
  const raw = wikiParseLuaMarks(SRC.syria, CFG.syria);
  assert.deepEqual(raw.unmapped, {}, unmappedMsg(raw));
  assert.ok(raw.points.length >= 500, `${raw.points.length} bodov`);
  assert.equal(raw.skipped, 1, 'cestný prekryv (marksize 2600)');
  const first = raw.points[0];
  assert.deepEqual([first.name, first.lat, first.lon, first.side, first.kind, first.size, first.pop], ['Tal Malik (Heights 1146)', 35.721, 36.218, 'syria-gov', 'hill', 4, 'small']);
  assert.equal(raw.points.find((p) => p.name === 'Damascus').pop, 'capital', 'marksize 35 → najbližšia nižšia trieda 32');
  assert.equal(raw.points.find((p) => p.name === 'Semalka Border Crossing').side, 'sdf', 'Dot_yellow_ff4.svg s podčiarkovníkmi');
  const merged = wikiControlPoints([{ id: 'main', src: SRC.syria }], CFG.syria);
  const s = wikiControlSummary(merged.points, CFG.syria);
  assert.ok(s.settlements['syria-gov'] > 250 && s.settlements.sdf > 10 && s.infrastructure['syria-gov'] > 200, JSON.stringify(s));
  assert.equal(s.settlements.mixed, 1, 'Map-ctl2-yellow+grey');
  assert.equal(merged.points.find((p) => p.side === 'russia').kind, 'airport', 'Chmejmím');
});

test('Libanonské povstanie (fixtúra 24. 9.): 85 aktívnych značiek, LAF 36 / Hizballáh 24 bodiek', () => {
  const raw = wikiParseLuaMarks(SRC.lebanon, CFG.lebanon);
  assert.deepEqual(raw.unmapped, {}, unmappedMsg(raw));
  assert.deepEqual([raw.points.length, raw.skipped, raw.sideless, raw.invalid], [85, 0, 0, 0]);
  assert.equal(dots(raw.points, 'laf'), 36);
  assert.equal(dots(raw.points, 'hezbollah'), 24);
  const merged = wikiControlPoints([{ id: 'main', src: SRC.lebanon }], CFG.lebanon);
  const s = wikiControlSummary(merged.points, CFG.lebanon);
  assert.deepEqual(s.settlements, { laf: 36, hezbollah: 29, israel: 0, 'lebanon-locals': 0, syria: 0, contested: 0, mixed: 0, none: 0 }, '24 bodiek + 5 vidieckych Hizballáhu');
  assert.deepEqual(s.infrastructure, { laf: 8, hezbollah: 6, israel: 0, 'lebanon-locals': 0, syria: 0 });
  assert.equal(merged.points.find((p) => p.name === 'Beirut').pop, 'capital');
  assert.deepEqual(CFG.lebanon.alsoModules, ['israel-palestine'], 'juh Libanonu kreslí Wikipédia z IP modulu');
});

test('zlúčenie zdrojov: mk zo všetkých zdrojov, neskorší vyhráva na 3 desatinných, infraštruktúra nekoliduje so sídlom', () => {
  const a = 'mk = { blu = "Location dot blue.svg" }\nreturn { marks = { { lat = "31.5000", long = "34.4500", mark = mk.blu, marksize = "8", label = "[[A]]" }, { lat = "31.5", long = "34.45", mark = "Fighter-jet-blue-icon.svg", marksize = "8", label = "[[A letisko]]" } } }';
  const b = 'return { marks = { { lat = "31.5001", long = "34.4502", mark = "Location dot lime.svg", marksize = "8", label = "[[B]]" } } }';
  const r = wikiControlPoints([{ id: 'x', src: a }, { id: 'y', src: b }], IP);
  assert.deepEqual(r.points.map((p) => `${p.name}:${p.side}:${p.kind}:${p.module}`), ['B:hamas:settlement:y', 'A letisko:israel:airport:x']);
  const ua = wikiControlPoints([{ id: 'x', src: a }, { id: 'y', src: b.replace(/lime/g, 'red') }], UKRAINE_CONTROL_CONFIG);
  assert.deepEqual(ua.points.map((p) => `${p.name}:${p.side}:${p.module}`), ['B:ru:y'], 'Ukrajina ako doteraz: jeden kľúč = súradnice, neskorší vyhráva');
  assert.deepEqual(wikiControlPoints([], IP), { points: [], unmapped: {}, skipped: 0, sideless: 0, invalid: 0, revisions: {} });
});

test('raster troch strán na mriežke veľkosti Gazy: pás medzi rôznymi stranami, polomer sporného, none ďaleko, počty podľa strán', () => {
  const pts = [
    { lat: 31.4, lon: 34.30, side: 'israel', kind: 'settlement' },
    { lat: 31.4, lon: 34.50, side: 'hamas', kind: 'settlement' },
    { lat: 31.55, lon: 34.40, side: 'pa', kind: 'settlement' },
    { lat: 31.25, lon: 34.46, side: 'contested', kind: 'settlement' }, // mimo osi súmernosti Izrael/Hamas, inak by ležalo v páse
    { lat: 31.45, lon: 34.30, side: 'israel', kind: 'airport' },
    { lat: 31.3, lon: 34.3, side: 'none', kind: 'border-crossing' },
  ];
  const opts = { bbox: { west: 34.2, south: 31.2, east: 34.6, north: 31.6 }, cellDeg: 0.01 };
  const r = wikiControlRaster(pts, IP, opts);
  const codes = wikiControlCodes(IP);
  assert.deepEqual([r.width, r.height, r.cellDeg, r.cells.length], [40, 40, 0.01, 1600]);
  assert.deepEqual(codes, { none: 0, israel: 1, pa: 2, hamas: 3, hezbollah: 4, 'lebanon-locals': 5, laf: 6, syria: 7, jordan: 8, 'popular-forces': 9, contested: 10 });
  assert.equal(cellAt(r, 31.4, 34.305), codes.israel);
  assert.equal(cellAt(r, 31.4, 34.495), codes.hamas);
  assert.equal(cellAt(r, 31.4, 34.405), codes.contested, 'stred medzi Izraelom a Hamasom (rozdiel < 3 km)');
  assert.equal(cellAt(r, 31.55, 34.415), codes.pa, 'tretia strana samostatne');
  assert.equal(cellAt(r, 31.25, 34.475), codes.contested, 'do 3 km od sporného sídla');
  assert.equal(cellAt(r, 31.25, 34.435), codes.contested, '2,4 km od sporného sídla = ešte v polomere');
  assert.equal(cellAt(r, 31.25, 34.495), codes.hamas, '3,4 km od sporného, mimo pásu: brána prešla cez sporné sídlo, bunka dostane najbližšiu stranu (dnešná sémantika)');
  assert.equal(cellAt(r, 31.58, 34.225), codes.none, 'ďalej než 12 km od všetkého');
  assert.deepEqual(Object.keys(r.counts), [...IP.sides.map((s) => s.id), 'contested', 'none']);
  assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), 1600);
  assert.ok(r.counts.israel > 0 && r.counts.hamas > 0 && r.counts.pa > 0 && r.counts.contested > 0 && r.counts.none > 0);
  assert.equal(r.counts.jordan, 0);
  assert.deepEqual([...r.cells], [...bruteRaster(pts, IP, opts)], 'koše = hrubá sila');
  const wide = wikiControlRaster(pts, IP, { ...opts, bandKm: 8 });
  assert.ok(wide.counts.contested > r.counts.contested, 'širší pás');
  const noCon = wikiControlRaster(pts, IP, { ...opts, bandKm: 3, contestedKm: 0.5 });
  assert.ok(noCon.counts.contested < r.counts.contested, 'užší polomer sporných');
});

test('regresia Ukrajiny: wikiControlRaster(UKRAINE_CONTROL_CONFIG) = controlRaster = hrubá sila (aj s bodmi mimo rámca)', () => {
  const pts = [
    { lat: 48.0, lon: 37.0, side: 'ua', kind: 'settlement' },
    { lat: 48.0, lon: 38.0, side: 'ru', kind: 'settlement' },
    { lat: 48.5, lon: 37.5, side: 'contested', kind: 'settlement' },
    { lat: 48.2, lon: 37.2, side: 'ua', kind: 'airbase' },
  ];
  const opts = { bbox: { west: 36.0, south: 47.0, east: 39.0, north: 49.0 }, cellDeg: 0.1, maxKm: 40, bandKm: 8 };
  const r = wikiControlRaster(pts, UKRAINE_CONTROL_CONFIG, opts);
  assert.deepEqual([r.width, r.height], [30, 20]);
  assert.equal(cellAt(r, 48.0, 37.05), CONTROL_CODE.ua);
  assert.equal(cellAt(r, 48.0, 37.95), CONTROL_CODE.ru);
  assert.equal(cellAt(r, 48.0, 37.5), CONTROL_CODE.contested);
  assert.equal(cellAt(r, 48.5, 37.55), CONTROL_CODE.contested);
  assert.equal(cellAt(r, 47.1, 36.1), CONTROL_CODE.none);
  assert.deepEqual([...r.cells], [...controlRaster(pts, opts).cells]);
  assert.deepEqual(r.counts, controlRaster(pts, opts).counts);
  assert.deepEqual([...r.cells], [...bruteRaster(pts, UKRAINE_CONTROL_CONFIG, opts)]);
  // pseudonáhodné body aj mimo rámca (koše ich zahodia alebo dopočítajú presne): 5 hodnôt strán, 0,1° mriežka
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const sides = ['ua', 'ru', 'contested', 'mixed', 'none'];
  const many = [];
  for (let i = 0; i < 400; i += 1) many.push({ lat: 43 + rnd() * 11, lon: 20 + rnd() * 23, side: sides[Math.floor(rnd() * 5)], kind: rnd() < 0.9 ? 'settlement' : 'airbase' });
  const coarse = { cellDeg: 0.1 };
  const rr = wikiControlRaster(many, UKRAINE_CONTROL_CONFIG, coarse);
  assert.deepEqual([rr.width, rr.height], [186, 84]);
  assert.deepEqual([...rr.cells], [...bruteRaster(many, UKRAINE_CONTROL_CONFIG, coarse)], 'koše bit po bite ako hrubá sila');
  assert.deepEqual([...rr.cells], [...controlRaster(many, coarse).cells]);
  assert.deepEqual(wikiControlRaster([], UKRAINE_CONTROL_CONFIG, opts).counts, { ua: 0, ru: 0, contested: 0, none: 600 });
});

test('rýchlosť: raster IP modulu (255×335 buniek, ~1 300 bodov) cez koše', () => {
  const { points } = wikiControlPoints([{ id: 'main', src: SRC['israel-palestine'] }], IP);
  const t0 = performance.now();
  const r = wikiControlRaster(points, IP);
  const ms = performance.now() - t0;
  assert.deepEqual([r.width, r.height], [255, 335]);
  assert.ok(r.counts.israel > 1000 && r.counts.pa > 100 && r.counts.contested > 100, JSON.stringify(r.counts));
  assert.ok(ms < 1000, `raster trval ${ms.toFixed(0)} ms (hrubá sila ~1 s; koše za studena do ~110 ms, zohriate ~30 ms)`);
});

test('konfigurácie Blízkeho východu: štyri moduly, jedinečné strany s farbou, licencia, prahy a mriežka podľa plánu, zmrazené', () => {
  assert.deepEqual(MIDEAST_CONTROL_MODULE_IDS, ['israel-palestine', 'yemen', 'syria', 'lebanon']);
  assert.deepEqual(MIDEAST_CONTROL_MODULES.map((c) => c.titles[0].title), ['Module:Israeli-Palestinian conflict detailed map', 'Module:Yemeni Civil War detailed map', 'Module:Syrian Civil War detailed map', 'Module:Lebanese insurgency detailed map']);
  const expect = { 'israel-palestine': [0.02, 12, 3, 14], yemen: [0.05, 35, 7, 30], syria: [0.05, 35, 7, 45], lebanon: [0.02, 12, 3, 30] };
  for (const c of MIDEAST_CONTROL_MODULES) {
    assert.deepEqual([c.cellDeg, c.maxKm, c.bandKm, c.staleDays], expect[c.id], c.id);
    assert.equal(c.contestedKm, c.bandKm);
    assert.equal(c.license, 'CC BY-SA 4.0');
    assert.match(c.attribution, /^Wikipedia · .+ detailed map · CC BY-SA 4\.0$/);
    assert.equal(c.i18nPrefix, `mideast.ctl.${c.id}`);
    assert.ok(c.bbox.west < c.bbox.east && c.bbox.south < c.bbox.north);
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.sides) && Object.isFrozen(c.icons) && Object.isFrozen(c.bbox), `${c.id} zmrazené`);
    const ids = c.sides.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${c.id}: jedinečné strany`);
    assert.ok(!ids.includes('contested') && !ids.includes('mixed') && !ids.includes('none'));
    for (const s of c.sides) {
      assert.match(s.css, /^#[0-9a-f]{6}$/, `${c.id}/${s.id} farba`);
      assert.ok(s.label && s.label.length > 2, `${c.id}/${s.id} popis`);
      assert.equal(s.fill, true, 'neutrálne tónovanie všetkých strán');
    }
    assert.ok(c.colours.length >= ids.length - 1, 'každá strana má farebné slovo (okrem tých, čo prichádzajú len z iného modulu)');
    assert.equal(c.colocated, 'merge');
    assert.ok(!c.fallbackByColour);
    assert.ok(c.icons.some((r) => r.side === FROM_COLOUR));
    assert.deepEqual(Object.keys(wikiControlCodes(c)), ['none', ...ids, 'contested']);
    assert.equal(wikiControlModuleById(c.id), c);
  }
  assert.deepEqual(Object.keys(CFG['israel-palestine'].sides.reduce((o, s) => ({ ...o, [s.id]: 1 }), {})), ['israel', 'pa', 'hamas', 'hezbollah', 'lebanon-locals', 'laf', 'syria', 'jordan', 'popular-forces']);
  assert.deepEqual(CFG.yemen.sides.map((s) => s.id), ['yemen-gov', 'houthi', 'aqap', 'tribal', 'isis']);
  assert.deepEqual(CFG.syria.sides.map((s) => s.id), ['syria-gov', 'sdf', 'druze', 'israel', 'russia', 'isis']);
  assert.deepEqual(CFG.lebanon.sides.map((s) => s.id), ['laf', 'hezbollah', 'israel', 'lebanon-locals', 'syria']);
  assert.equal(wikiControlModuleById('ukraine'), UKRAINE_CONTROL_CONFIG);
  assert.equal(wikiControlModuleById('nope'), null);
  assert.ok(Object.isFrozen(MIDEAST_CONTROL_MODULES) && Object.isFrozen(UKRAINE_CONTROL_CONFIG));
});
