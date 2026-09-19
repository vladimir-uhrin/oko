// src/data/ukraineControl.test.mjs — kontrolné body z Wikipédie: skratky mk, popisky,
// ikony → strana/druh, parser Lua (nová aj stará forma), zlúčenie modulov, súhrn,
// odvodený raster zón.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_CODE, DEFAULT_MK, controlPointsFromModules, controlRaster, controlSummary, markStatus, parseLuaMarks, parseMkTable, plainLabel,
} from './ukraineControl.js';

const OVERVIEW = `-- Marker shortcuts
mk = {
	con = "80x80-red-blue-anim.gif",
	grz = "Location dot grey.svg",
	rus = "Location dot red.svg",
	shr = "Map-ctl2-red+blue.svg",
	ukr = "Location dot blue.svg",
	rNE = "Map-arcNE-red.svg",
}
lp = { b = "bottom", l = "left", t = "top" }
return {
	marks = {
		{ lat = "46.305", long = "31.102", mark = "Ukraine Roadmap Overlay.png", marksize = 2600 },
		--Cherkasy Oblast
		{ lat = "49.444", long = "32.059", mark = mk.ukr, marksize = 20, label_size = 110, position = lp.b, label = "[[Cherkasy]]", link = "Cherkasy" },
		{ lat = "47.987", long = "37.292", mark = mk.rus, marksize = 10, label_size = 70, position = lp.l, label = "[[Kurakhove]]", label_top = 0.15, link = "Battle of Kurakhove" },
		{ lat = "48.990", long = "37.805", mark = mk.con, marksize = 12, label_size = 80, position = lp.t, label = "[[Lyman, Ukraine|Lyman]]", link = "Second battle of Lyman" },
		{ lat = "48.530", long = "37.710", mark = mk.rNE, marksize = 12, label = "[[Kostiantynivka]]" },
		{ lat = "48.000", long = "37.800", mark = mk.grz, marksize = 20, label = "[[Donetsk]]" },
	},
}`;
const DETAILED_NEW = `local m = require('Module:Russo-Ukrainian war overview map')
mm["Lyman"].position = "bottom"
local marks = {
	{ lat = "49.416", long = "31.995", mark = "Fighter-jet-blue-icon.svg", marksize = 12, link = "Cherkasy International Airport" },
	{ lat = "48.990", long = "37.805", mark = mk.con, marksize = 12, label = "[[Lyman, Ukraine|Lyman]]" },
	{ lat = "48.700", long = "37.900", mark = mk.rus, marksize = 4, label = "[[Zalizne]]" },
	{ lat = "48.100", long = "37.100", mark = "3x3dot-blue.svg", marksize = 6 },
	{ lat = "47.500", long = "34.585", mark = "Icon NuclearPowerPlant-red.svg", marksize = 12, link = "Zaporizhzhia Nuclear Power Plant" },
}`;
const DETAILED_OLD = `return {
	marks = {
		{ lat = "49.444", long = "32.059", mark = "Location dot blue.svg", marksize = "20", label = "[[Cherkasy]]", link = "Control of cities" },
		{ lat = "48.990", long = "37.805", mark = "Location dot red.svg", marksize = "12", label = "[[Lyman, Ukraine|Lyman]]" },
		{ lat = "48.530", long = "37.710", mark = "80x80-red-blue-anim.gif", marksize = "12", label = "Kostiantynivka" },
	},
}`;

test('skratky, popisky, ikony → strana a druh', () => {
  const mk = parseMkTable(OVERVIEW);
  assert.equal(mk.ukr, 'Location dot blue.svg');
  assert.equal(mk.rNE, 'Map-arcNE-red.svg');
  assert.equal(mk.uSW, DEFAULT_MK.uSW, 'chýbajúce kľúče zo zálohy');
  assert.deepEqual(parseMkTable('nič'), DEFAULT_MK);
  assert.equal(plainLabel('[[Lyman, Ukraine|Lyman]]'), 'Lyman');
  assert.equal(plainLabel('[[Bakhmut]]'), 'Bakhmut');
  assert.equal(plainLabel("'''Kostiantynivka'''"), 'Kostiantynivka');
  assert.equal(plainLabel(''), null);
  assert.deepEqual(markStatus('Location dot blue.svg'), { side: 'ua', kind: 'settlement' });
  assert.deepEqual(markStatus('Location dot red.svg'), { side: 'ru', kind: 'settlement' });
  assert.deepEqual(markStatus('Location dot grey.svg'), { side: 'none', kind: 'settlement' });
  assert.deepEqual(markStatus('80x80-red-blue-anim.gif'), { side: 'contested', kind: 'settlement' });
  assert.deepEqual(markStatus('Map-ctl2-red+blue.svg'), { side: 'mixed', kind: 'settlement' });
  assert.deepEqual(markStatus('Map-arcNE-red.svg'), { side: 'ua', kind: 'settlement', pressure: 'ru', direction: 'NE' }, 'červený oblúk = ukrajinské sídlo tlačené z SV');
  assert.deepEqual(markStatus('Map-arcSS-blue.svg'), { side: 'ru', kind: 'settlement', pressure: 'ua', direction: 'SS' });
  assert.deepEqual(markStatus('3x3dot-blue.svg'), { side: 'ua', kind: 'rural' });
  assert.deepEqual(markStatus('Fighter-jet-red-icon.svg'), { side: 'ru', kind: 'airbase' });
  assert.deepEqual(markStatus('Anchor pictogram blue.svg'), { side: 'ua', kind: 'port' });
  assert.deepEqual(markStatus('Icon NuclearPowerPlant-red.svg'), { side: 'ru', kind: 'industry' });
  assert.deepEqual(markStatus('Abm-blue-icon.png'), { side: 'ua', kind: 'base' });
  assert.equal(markStatus('Ukraine Roadmap Overlay.png'), null);
  assert.equal(markStatus('Mountain pass 12x12 n.svg').side, null);
});

test('parser Lua: nová forma so skratkami aj stará forma s menami ikon; cestná mapa preč', () => {
  const pts = parseLuaMarks(OVERVIEW);
  assert.deepEqual(pts.map((p) => `${p.name}:${p.side}:${p.kind}:${p.pop}`), ['Cherkasy:ua:settlement:200k', 'Kurakhove:ru:settlement:10k', 'Lyman:contested:settlement:20k', 'Kostiantynivka:ua:settlement:20k', 'Donetsk:none:settlement:200k']);
  assert.equal(pts[3].pressure, 'ru');
  assert.equal(pts[3].direction, 'NE');
  assert.equal(pts[0].link, 'Cherkasy');
  assert.deepEqual([pts[2].lat, pts[2].lon], [48.99, 37.805]);
  const old = parseLuaMarks(DETAILED_OLD);
  assert.deepEqual(old.map((p) => `${p.name}:${p.side}:${p.size}`), ['Cherkasy:ua:20', 'Lyman:ru:12', 'Kostiantynivka:contested:12']);
  assert.equal(parseLuaMarks('').length, 0);
});

test('zlúčenie modulov: podrobný prepíše bod prehľadového na rovnakých súradniciach a pridá obce/infraštruktúru', () => {
  const pts = controlPointsFromModules(OVERVIEW, DETAILED_NEW);
  const names = pts.map((p) => p.name || p.link);
  assert.equal(pts.filter((p) => p.name === 'Lyman').length, 1, 'Lyman raz');
  assert.equal(pts.find((p) => p.name === 'Lyman').module, 'detailed');
  assert.ok(names.includes('Zalizne') && names.includes('Cherkasy International Airport') && names.includes('Zaporizhzhia Nuclear Power Plant'));
  assert.equal(pts.find((p) => p.link === 'Zaporizhzhia Nuclear Power Plant').side, 'ru');
  const s = controlSummary(pts);
  assert.equal(s.total, 9);
  assert.deepEqual(s.settlements, { ua: 3, ru: 2, contested: 1, mixed: 0, none: 1 });
  assert.deepEqual(s.infrastructure, { ua: 1, ru: 1 });
  const onlyOld = controlPointsFromModules('', DETAILED_OLD);
  assert.equal(onlyOld.length, 3, 'stará revízia bez prehľadového modulu');
});

test('raster zón: RU okolo ruských sídiel, pás bojov medzi stranami a pri kontestovaných, ďaleko nič', () => {
  const pts = [
    { lat: 48.0, lon: 37.0, side: 'ua', kind: 'settlement' },
    { lat: 48.0, lon: 38.0, side: 'ru', kind: 'settlement' },
    { lat: 48.5, lon: 37.5, side: 'contested', kind: 'settlement' },
    { lat: 48.2, lon: 37.2, side: 'ua', kind: 'airbase' },
  ];
  const r = controlRaster(pts, { bbox: { west: 36.0, south: 47.0, east: 39.0, north: 49.0 }, cellDeg: 0.1, maxKm: 40, bandKm: 8 });
  assert.equal(r.width, 30);
  assert.equal(r.height, 20);
  const at = (lat, lon) => r.cells[Math.floor((r.bbox.north - lat) / r.cellDeg) * r.width + Math.floor((lon - r.bbox.west) / r.cellDeg)];
  assert.equal(at(48.0, 37.05), CONTROL_CODE.ua);
  assert.equal(at(48.0, 37.95), CONTROL_CODE.ru);
  assert.equal(at(48.0, 37.5), CONTROL_CODE.contested, 'v strede medzi stranami');
  assert.equal(at(48.5, 37.55), CONTROL_CODE.contested, 'pri kontestovanom sídle');
  assert.equal(at(47.1, 36.1), CONTROL_CODE.none, 'ďaleko od bodov');
  assert.equal(r.counts.ua + r.counts.ru + r.counts.contested + r.counts.none, 600);
  assert.ok(r.counts.ru > 0 && r.counts.contested > 0);
});
