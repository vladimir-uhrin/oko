// src/data/frontWeek.test.mjs — model „Týždeň na fronte": týždenné súčty stretov (diera ≠ nula, čiastkové
// hlásenie mimo súčtu), poctivé rozdelenie zmeny územia (Rusko obsadilo / Ukrajina späť / do sivej zóny),
// každá bunka v jednom smere, bod zmeny na zmenenom území a „týždeň" len pri snímkach 7 dní od seba.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FRONT_WEEK_DAYS, changeAnchor, changeBreakdown, frontWeekModel, kindAt, polyIndex, sceneForPoint, weekRanges, weekTrend,
} from './frontWeek.js';
import { occupiedChangeRaster } from './ukraineContactLine.js';

const rect = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const poly = (kind, ...r) => ({ kind, type: 'Polygon', rings: [rect(...r)] });
const KM = 111.32;
/** Plocha pásu buniek 0,01° (stĺpce × riadky) okolo šírky `lat` v km². */
const cellsKm2 = (cols, rows, lat) => cols * rows * (0.01 * KM) ** 2 * Math.cos((lat * Math.PI) / 180);

// Pred týždňom: okupované pri Pokrovsku a pri Lymane, sivá zóna západne od Pokrovska.
const BEFORE = {
  day: '2026-09-25',
  features: [
    poly('grey', 37.26, 48.30, 37.30, 48.40),
    poly('occupied', 37.30, 48.20, 37.60, 48.40),
    poly('occupied', 37.80, 49.10, 38.00, 49.30),
  ],
};
// Teraz: pri Pokrovsku pribudol pás 37,26–37,30 (polovica bola sivá zóna), pri Lymane ubudol pás
// 37,80–37,86 — z neho 37,80–37,82 vedie mapa ako sivú zónu, zvyšok ako oslobodené.
const NOW = {
  day: '2026-10-02',
  features: [
    poly('grey', 37.80, 49.10, 37.82, 49.30),
    poly('occupied', 37.26, 48.20, 37.60, 48.40),
    poly('occupied', 37.86, 49.10, 38.00, 49.30),
    poly('liberated', 37.82, 49.10, 37.86, 49.30),
  ],
};

const rep = (total, dirs, text = '08:00 1.10.') => ({
  total, reportedAtText: text,
  directions: Object.entries(dirs).map(([gs, attacks]) => ({ gs, attacks, text: '', shared: false })),
});
const P = 'Покровський'; const L = 'Лиманський';
const DAYS = {};
for (let d = 20; d <= 26; d += 1) DAYS[`2026-09-${d}`] = rep(200, { [P]: 20, [L]: 10 });
DAYS['2026-09-27'] = rep(210, { [P]: 24, [L]: 8 });
DAYS['2026-09-28'] = rep(210, { [P]: 24, [L]: 8 });
// 29. 9. hlásenie chýba; 30. 9. GŠ Lymanský smer nespomenul; 1. 10. je len popoludňajšie priebežné hlásenie.
DAYS['2026-09-30'] = rep(210, { [P]: 24 });
DAYS['2026-10-01'] = rep(60, { [P]: 5, [L]: 2 }, '16:00 1.10.');
DAYS['2026-10-02'] = rep(210, { [P]: 24, [L]: 8 });
DAYS['2026-10-03'] = rep(210, { [P]: 24, [L]: 8 });

test('týždeň a týždeň pred ním', () => {
  assert.equal(FRONT_WEEK_DAYS, 7);
  assert.deepEqual(weekRanges('2026-10-03'), { week: { from: '2026-09-27', to: '2026-10-03' }, prev: { from: '2026-09-20', to: '2026-09-26' } });
  assert.deepEqual(weekRanges('2026-03-02').week, { from: '2026-02-24', to: '2026-03-02' });
  assert.equal(weekRanges('nie je deň'), null);
});

test('trend porovnáva priemery na deň a pri málo dňoch mlčí', () => {
  assert.equal(weekTrend(168, 140, 7, 7), 'up');
  assert.equal(weekTrend(120, 140, 5, 7), 'up', '24 denne proti 20 — menej dní s údajom nie je pokles');
  assert.equal(weekTrend(100, 140, 7, 7), 'down');
  assert.equal(weekTrend(145, 140, 7, 7), 'flat');
  assert.equal(weekTrend(9, 2, 7, 7), 'flat', 'jeden útok denne navyše nie je trend');
  assert.equal(weekTrend(60, 140, 3, 7), null);
  assert.equal(weekTrend(60, 140, 7, 3), null);
});

test('súčty týždňa: deň bez hlásenia a nespomenutý smer nie sú nula, čiastkové hlásenie sa neráta', () => {
  const m = frontWeekModel({ days: DAYS, refDay: '2026-10-03' });
  assert.deepEqual(m.week, { from: '2026-09-27', to: '2026-10-03' });
  assert.equal(m.total.week, 1050);
  assert.equal(m.total.weekDays, 5, '29. 9. chýba, 1. 10. je čiastkové');
  assert.equal(m.total.prev, 1400);
  assert.equal(m.total.prevDays, 7);
  assert.equal(m.total.changePct, 5, 'priemer 210 proti 200 denne');
  assert.equal(m.total.trend, 'flat');
  assert.equal(m.total.series.length, 14);
  assert.equal(m.total.series.find((p) => p.day === '2026-09-29').value, null);
  assert.equal(m.total.series.find((p) => p.day === '2026-10-01').value, null, 'čiastkové hlásenie nie je denný počet');

  assert.deepEqual(m.directions.slice(0, 2).map((d) => d.id), ['pokrovsk', 'lyman'], 'od najviac útokov');
  const [pok, lym] = m.directions;
  assert.equal(pok.week, 120);
  assert.equal(pok.weekDays, 5);
  assert.equal(pok.changePct, 20);
  assert.equal(pok.trend, 'up');
  assert.equal(lym.week, 32);
  assert.equal(lym.weekDays, 4, '30. 9. smer v hlásení nebol — neráta sa ako nula');
  assert.equal(lym.changePct, -20);
  assert.equal(lym.trend, 'down');
  const kherson = m.directions.find((d) => d.id === 'kherson');
  assert.equal(kherson.week, 0);
  assert.equal(kherson.weekDays, 0);
  assert.equal(kherson.trend, null);
  // Bez snímok mapy model o území mlčí.
  assert.equal(m.change, null);
  assert.equal(pok.ruKm2, null);
  assert.equal(pok.ruAt, null);
});

test('druh polygónu v bode a smer bodu', () => {
  const index = polyIndex(NOW.features);
  assert.equal(index.length, 4);
  assert.equal(kindAt(index, 37.81, 49.2), 'grey');
  assert.equal(kindAt(index, 37.84, 49.2), 'liberated');
  assert.equal(kindAt(index, 37.9, 49.2), 'occupied');
  assert.equal(kindAt(index, 30, 50), null);
  assert.equal(polyIndex([{ kind: 'x', type: 'LineString', rings: [] }, { kind: 'y', type: 'Polygon', rings: [[[0, 0], [1, 1]]] }]).length, 0);

  // Výrezy smerov sa prekrývajú: bod patrí smeru s bližším stredom.
  assert.equal(sceneForPoint(37.8, 48.9), 'lyman');
  assert.equal(sceneForPoint(37.6, 48.7), 'sloviansk-kramatorsk');
  assert.equal(sceneForPoint(37.28, 48.3), 'pokrovsk');
  assert.equal(sceneForPoint(30, 50), null, 'ďaleko od frontu nepatrí nikam');
});

test('zmena územia: Rusko obsadilo, Ukrajina späť a do sivej zóny sa nemiešajú', () => {
  const m = frontWeekModel({ days: DAYS, refDay: '2026-10-03', snapshotNow: NOW, snapshotBefore: BEFORE });
  const ru = cellsKm2(4, 20, 48.3);
  const lost = cellsKm2(6, 20, 49.2);
  assert.ok(Math.abs(m.change.ruKm2 - ru) < 1.5, `Rusko obsadilo ≈ ${ru.toFixed(1)}, je ${m.change.ruKm2}`);
  assert.ok(Math.abs(m.change.fromGreyKm2 - ru / 2) < 1.5, 'polovica obsadeného bola sivá zóna');
  assert.ok(Math.abs(m.change.toGreyKm2 - lost / 3) < 1.5, 'tretina strateného je dnes sivá zóna');
  assert.ok(Math.abs(m.change.uaKm2 - (lost * 2) / 3) < 1.5, 'Ukrajina späť = stratené bez sivej zóny');
  // Surový rozdiel (číslo vrstvy na mape) je súčet oboch častí straty.
  assert.ok(Math.abs(m.change.lostKm2 - (m.change.uaKm2 + m.change.toGreyKm2)) < 0.3);
  assert.ok(Math.abs(m.change.gainedKm2 - m.change.ruKm2) < 0.3);
  assert.equal(m.change.fromDay, '2026-09-25');
  assert.equal(m.change.toDay, '2026-10-02');
  assert.equal(m.change.spanDays, 7);
  assert.equal(m.change.weekly, true);

  const pok = m.directions.find((d) => d.id === 'pokrovsk');
  const lym = m.directions.find((d) => d.id === 'lyman');
  assert.equal(pok.ruKm2, m.change.ruKm2);
  assert.equal(pok.uaKm2, 0);
  assert.equal(lym.uaKm2, m.change.uaKm2);
  assert.equal(lym.toGreyKm2, m.change.toGreyKm2);
  assert.equal(lym.ruKm2, 0);
  // Každá bunka raz: súčet po smeroch = celok (výrezy smerov sa prekrývajú).
  const sum = (k) => Math.round(m.directions.reduce((s, d) => s + (d[k] || 0), 0) * 10) / 10;
  assert.ok(Math.abs(sum('ruKm2') - m.change.ruKm2) < 0.2);
  assert.ok(Math.abs(sum('uaKm2') - m.change.uaKm2) < 0.2);
  // Bod zmeny leží na zmenenom území.
  assert.ok(pok.ruAt.lon > 37.26 && pok.ruAt.lon < 37.30 && pok.ruAt.lat > 48.20 && pok.ruAt.lat < 48.40, JSON.stringify(pok.ruAt));
  assert.ok(lym.uaAt.lon > 37.82 && lym.uaAt.lon < 37.86 && lym.uaAt.lat > 49.10 && lym.uaAt.lat < 49.30, JSON.stringify(lym.uaAt));
  assert.equal(pok.uaAt, null);
  assert.equal(m.directions.find((d) => d.id === 'kherson').ruKm2, 0);
});

test('bod zmeny je vždy zmenená bunka, aj pri dvoch oddelených plochách', () => {
  assert.equal(changeAnchor([]), null);
  assert.equal(changeAnchor(null), null);
  const cells = [[37.005, 48.005], [37.015, 48.005], [37.905, 48.005]];
  const at = changeAnchor(cells);
  assert.ok(cells.some(([x, y]) => Math.abs(x - at.lon) < 1e-9 && Math.abs(y - at.lat) < 1e-9), 'ťažisko leží medzi plochami — bod nie');
});

test('rozdelenie zmeny bez rastra je prázdne', () => {
  assert.deepEqual(changeBreakdown(null, [], []), { ruKm2: 0, uaKm2: 0, toGreyKm2: 0, fromGreyKm2: 0, byScene: {} });
  const now = polyIndex(NOW.features); const before = polyIndex(BEFORE.features);
  const parts = changeBreakdown(occupiedChangeRaster(now, before), now, before);
  assert.deepEqual(Object.keys(parts.byScene).sort(), ['lyman', 'pokrovsk']);
});

test('„za týždeň" len pri snímkach presne 7 dní od seba; staršia snímka platí ako stav k žiadanému dňu', () => {
  const late = frontWeekModel({ days: DAYS, refDay: '2026-10-03', snapshotNow: NOW, snapshotBefore: { ...BEFORE, day: '2026-09-23' } });
  assert.equal(late.change.spanDays, 9);
  assert.equal(late.change.weekly, false);
  // Zrkadlo zapisuje len pri zmene mapy: snímka z 24. 9. je stav mapy aj 25. 9.
  const asOf = frontWeekModel({ days: DAYS, refDay: '2026-10-03', snapshotNow: NOW, snapshotBefore: { ...BEFORE, day: '2026-09-24', asOfDay: '2026-09-25' } });
  assert.equal(asOf.change.fromDay, '2026-09-25');
  assert.equal(asOf.change.weekly, true);
});
