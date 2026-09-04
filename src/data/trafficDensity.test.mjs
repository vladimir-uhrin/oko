// src/data/trafficDensity.test.mjs
// Hustota letovej prevádzky pri pohľade na svet (2026-09-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DENSITY_ENTER_ALT_M,
  DENSITY_EXIT_ALT_M,
  DENSITY_MAX_CELLS,
  aggregateTraffic,
  densityGridDegrees,
  densityMarkerAlpha,
  densityMarkerPx,
  densityModeActive,
} from './trafficDensity.js';

const at = (lat, lon, extra = {}) => ({ lat, lon, ...extra });

test('režim hustoty má hysterézu a nastupuje až nad najmenšími ikonami', () => {
  assert.equal(densityModeActive(5_000_000), true, 'pohľad na pologuľu');
  assert.equal(densityModeActive(1_000_000), false, 'kontinent ešte jednotlivo');
  // V pásme rozhoduje predchádzajúci stav — kamera na hranici neprepína.
  assert.equal(densityModeActive(3_000_000, false), false, 'stúpam: ešte stroje');
  assert.equal(densityModeActive(3_000_000, true), true, 'klesám: ešte hustota');
  assert.equal(densityModeActive(DENSITY_ENTER_ALT_M, false), true);
  assert.equal(densityModeActive(DENSITY_EXIT_ALT_M - 1, true), false);
  // Prah leží vysoko nad prahom najmenších ikon (950 km): medzi nimi je pásmo,
  // kde sa jednotlivé stroje ešte dajú rozoznať a sú užitočné.
  assert.ok(DENSITY_EXIT_ALT_M > 950_000);
  assert.equal(densityModeActive(Number.NaN), false, 'bez výšky sa nehádže');
});

test('mriežka hrubne s výškou', () => {
  const global = densityGridDegrees(12_000_000);
  const hemi = densityGridDegrees(6_000_000);
  const cont = densityGridDegrees(3_000_000);
  assert.ok(global > hemi && hemi > cont, `${global} > ${hemi} > ${cont}`);
  // Globálny pohľad s jemnou mriežkou by dal tisíce buniek — rovnaký šum ako
  // jednotlivé stroje, len iným tvarom.
  assert.ok(global >= 5);
  assert.ok(cont <= 3);
  assert.ok(Number.isFinite(densityGridDegrees(Number.NaN)), 'bez výšky rozumný default');
});

test('bunka nesie ŤAŽISKO kontaktov, nie stred štvorca', () => {
  // Pri 6° mriežke by stred posunul škvrnu aj o stovky km od miesta, kde sa
  // reálne lieta, a koridory by sa rozpadli na pravidelnú šachovnicu.
  const cells = aggregateTraffic([at(48.1, 17.1), at(48.3, 17.3)], 10);
  assert.equal(cells.length, 1);
  assert.ok(Math.abs(cells[0].lat - 48.2) < 0.001, `ťažisko ${cells[0].lat}`);
  assert.ok(Math.abs(cells[0].lon - 17.2) < 0.001);
  assert.equal(cells[0].count, 2);
});

test('kontakty sa zoskupia podľa mriežky a zoradia od najhustejšej', () => {
  const records = [
    ...Array.from({ length: 5 }, () => at(50, 8)), // Frankfurt
    ...Array.from({ length: 2 }, () => at(40, -3)), // Madrid
    at(-33, 151), // Sydney
  ];
  const cells = aggregateTraffic(records, 2.5);
  assert.deepEqual(cells.map((c) => c.count), [5, 2, 1]);
});

test('vojenské kontakty sa v bunke počítajú zvlášť', () => {
  const cells = aggregateTraffic([at(50, 8), at(50, 8, { military: true })], 2.5);
  assert.equal(cells[0].count, 2);
  assert.equal(cells[0].military, 1);
});

test('strop odreže riedky chvost, nie koridory', () => {
  // Husté bunky idú prvé, takže obeťou stropu je vždy prázdny kút.
  const records = [];
  for (let i = 0; i < 50; i++) records.push(at(50, 8)); // jedna hustá
  for (let i = 0; i < 300; i++) records.push(at(-60 + i * 0.4, -170 + i * 0.9)); // rozptýlené
  const cells = aggregateTraffic(records, 2.5, { maxCells: 10 });
  assert.equal(cells.length, 10);
  assert.equal(cells[0].count, 50, 'najhustejšia prežila');
  assert.ok(cells.length <= DENSITY_MAX_CELLS);
});

test('nezmyselné súradnice sa zahodia, nie zaokrúhlia', () => {
  const cells = aggregateTraffic(
    [at(Number.NaN, 10), at(50, Number.NaN), at(200, 10), at(50, 400), null, undefined, {}, at(50, 8)],
    2.5,
  );
  assert.equal(cells.length, 1, 'prežil jediný platný');
  assert.equal(cells[0].count, 1);
  assert.deepEqual(aggregateTraffic(null, 2.5), []);
  assert.deepEqual(aggregateTraffic([], 2.5), []);
});

test('značka rastie LOGARITMICKY — Frankfurt nesmie prekryť pol Európy', () => {
  const small = densityMarkerPx(4, 400);
  const big = densityMarkerPx(400, 400);
  assert.ok(big > small, 'hustejšia je väčšia');
  // Stonásobný počet nesmie znamenať stonásobnú značku.
  assert.ok(big < small * 4, `${big} vs ${small}`);
  assert.ok(big <= 20 && small >= 4, 'veľkosť ostáva v rozumnom pásme');
  // Jediný kontakt musí byť ešte viditeľný.
  assert.ok(densityMarkerPx(1, 400) >= 4);
});

test('riedke bunky ustúpia, husté vyniknú — a nič nezmizne úplne', () => {
  const dim = densityMarkerAlpha(1, 400);
  const bright = densityMarkerAlpha(400, 400);
  assert.ok(bright > dim);
  assert.ok(dim >= 0.25, 'aj jeden stroj je vidieť');
  assert.ok(bright <= 1);
});

test('tripwire: hustota sa skladá do TEJ ISTEJ brány viditeľnosti', async () => {
  // Keby mala vlastný zapisovač `bb.show`, hlavná slučka by flotilu hneď po
  // prepnutí rozsvietila a scéna by mala body aj stroje naraz — presne tá
  // trieda chyby, ktorá stála commit 02965d0 pri strobe.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /const beyondHorizon = _densityMode\s*\n\s*\|\| !_categoryVisible/,
    'režim hustoty je člen brány beyondHorizon',
  );
  // Prepočet nesmie bežať každý tik: 12 000 kontaktov pri pohľade, kde jeden
  // stroj urobí zlomok pixela, je zbytočná práca.
  assert.match(source, /nowMs - _densityRebuiltAtMs < DENSITY_REBUILD_MS/, 'prepočet je throttlovaný');
  // Vlastná kolekcia, nie ďalšie billboardy vo flotile.
  assert.match(source, /_densityPoints = new Cesium\.PointPrimitiveCollection\(\)/, 'vlastná kolekcia');
  assert.match(source, /_densityPoints = null;\n\s*_densityMode = false;/, 'teardown čistí stav');
  // Skryté kategórie sa do hustoty nesmú počítať — inak by filter „nič
  // nerobil", hoci by bunky ostali rovnaké.
  assert.match(source, /if \(!_categoryVisible\(info\?\.klass\)\) continue;/, 'filter platí aj pre hustotu');
});
