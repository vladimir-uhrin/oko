// src/data/aircraftIcons.test.mjs
// Antikolízne strobo (požiadavka 2026-09-03: „blikajúce svetlo ako majú
// lietadlá normálne, ale veľmi jemné, 1–2 px"): čistá fáza blikania a
// strobo variant ikony.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STROBE_FLASH_MS,
  STROBE_PERIOD_MS,
  aircraftIcon,
  strobeOn,
} from './aircraftIcons.js';

function decoded(uri) {
  return Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
}

test('strobeOn: krátky záblesk, dlhá tma — z wall-clocku, nie z frame countera', () => {
  // Reálny strobe: ~10 % duty cycle. Wall-clock fáza = na zaparkovanej scéne
  // sa nič nevynucuje (flights drží continuous render, kým je vrstva zapnutá).
  assert.ok(STROBE_FLASH_MS < STROBE_PERIOD_MS / 4, 'záblesk je krátky, nie stroboskop');
  assert.equal(strobeOn(0), true);
  assert.equal(strobeOn(STROBE_FLASH_MS - 1), true);
  assert.equal(strobeOn(STROBE_FLASH_MS), false);
  assert.equal(strobeOn(STROBE_PERIOD_MS - 1), false);
  assert.equal(strobeOn(STROBE_PERIOD_MS), true, 'perióda sa opakuje');
  assert.equal(strobeOn(STROBE_PERIOD_MS * 7 + 10), true);
});

test('strobo variant ikony: vlastný cache kľúč, svetlo len v zapnutej fáze', () => {
  const base = aircraftIcon('airliner', 64, false);
  const lit = aircraftIcon('airliner', 64, true);
  assert.notEqual(base, lit, 'zapnutá fáza je iná textúra');
  assert.equal(aircraftIcon('airliner', 64), base, 'default = bez svetla (spätne kompatibilné)');
  assert.equal(aircraftIcon('airliner', 64, true), lit, 'cache vracia identickú URI');
  assert.ok(!decoded(base).includes('strobe'), 'základ svetlo nemá');
  assert.ok(decoded(lit).includes('strobe'), 'zapnutá fáza nesie strobo svetlo');
});

test('polohové svetlo sedí na ĽAVOM krídle, per-kind (nie na osi trupu)', () => {
  // Spresnenie 2026-09-03: „na krídlo, ako mávajú lietadlá" — červená patrí
  // na port (ľavé) krídlo, teda záporné cx; a keďže každá silueta má iné
  // rozpätie, poloha sa musí líšiť medzi typmi.
  const strobeGroup = (kind) => {
    const m = decoded(aircraftIcon(kind, 64, true)).match(/<g data-strobe="1">.*?<\/g>/);
    assert.ok(m, `${kind}: strobo skupina existuje`);
    return m[0];
  };
  const cxOf = (svg) => Number(svg.match(/cx="(-?[\d.]+)"/)[1]);
  const airliner = cxOf(strobeGroup('airliner'));
  const widebody = cxOf(strobeGroup('widebody'));
  assert.ok(airliner < 0, 'airliner: svetlo na ľavej strane (port)');
  assert.ok(widebody < 0, 'widebody: svetlo na ľavej strane (port)');
  assert.notEqual(airliner, widebody, 'poloha je per-kind, nie jedna pre všetkých');
});

test('zapečený cyan tint: stroj azúrový, krídlové svetlo ostáva ČERVENÉ', () => {
  // „Ale aj sem" (2026-09-03): billboard.color je multiplikatívny, takže CYAN
  // tint sledovaného stroja robil z červeného svetla čiernu bodku. Sledovaný
  // glyf preto nesie cyan v SVG a billboard je WHITE.
  const plain = aircraftIcon('airliner', 192, true);
  const baked = aircraftIcon('airliner', 192, true, 'cyan');
  assert.notEqual(plain, baked, 'tintovaný variant je iná textúra');
  const svg = decoded(baked);
  assert.ok(svg.includes('#00ffff'), 'trup je azúrový priamo v SVG');
  assert.ok(!svg.includes('fill="white"'), 'biela výplň je celá nahradená');
  assert.ok(svg.includes('#ff2626'), 'krídlové svetlo ostáva červené');
  // TR-3B tint ignoruje — tmavá silueta žije z multiplikatívneho stmavenia.
  assert.equal(aircraftIcon('tr3b', 192, false, 'cyan'), aircraftIcon('tr3b', 192, false));
  // Tripwire: sledovaný billboard vo flights.js NAOZAJ žiada zapečený tint.
  const flightsSrc = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(flightsSrc, /_lastStrobeOn[^\n]*\n\s*'cyan',/, 'sync sledovaného glyfu pečie cyan');
});

test('TR-3B si nechá vlastné svetlá — strobo sa naň nelepí', () => {
  // Easter egg má trojicu rohových svetiel s vlastným rytmom scény; biele
  // strobo na čiernom trojuholníku by kazilo siluetu.
  assert.equal(aircraftIcon('tr3b', 64, true), aircraftIcon('tr3b', 64, false));
  assert.equal(aircraftIcon('tr3bHot', 192, true), aircraftIcon('tr3bHot', 192, false));
});

test('tripwire: fleet tick prepína strobo fázu pre civilnú aj vojenskú flotilu', () => {
  const flights = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  const military = readFileSync(new URL('./militaryFlights.js', import.meta.url), 'utf8');
  for (const [name, source] of [['flights', flights], ['military', military]]) {
    assert.match(source, /_lastStrobeOn/, `${name}: drží poslednú fázu`);
    assert.match(source, /strobeOn\(/, `${name}: číta wall-clock fázu`);
  }
});

test('strobo má JEDINÝ zapisovač textúry a vzdialenostnú bránu', () => {
  // 2026-09-03 („celá Európa bliká", „raz bliká, raz nie"): kind, raster a
  // strobo fáza sú tri osi, ktoré pred opravou zapisovali tri nezávislé
  // miesta — každé prepísalo, čo riešili ostatné. A fáza sa aplikovala na
  // CELÚ flotilu naraz, takže oddialený pohľad prebleskol.
  for (const file of ['./flights.js', './militaryFlights.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const name = file.includes('military') ? 'military' : 'flights';
    assert.match(source, /const STROBE_MAX_DIST_M = \d+/, `${name}: má vzdialenostnú bránu`);
    assert.match(
      source,
      /wantStrobe = strobePhase && cameraDistanceM <= STROBE_MAX_DIST_M/,
      `${name}: brána sa vyhodnocuje per kontakt, nie globálne`,
    );
    assert.match(source, /function _syncFleetBillboardIcon\(/, `${name}: jediný zapisovač`);
    // Mimo toho zapisovača (a cockpit bodky) už nikto textúru fleet
    // billboardu neprepisuje — inak sa osi zase rozídu.
    const strayWrites = source.match(/bb\.image = aircraftIcon\(/g) || [];
    assert.equal(strayWrites.length, 0, `${name}: žiadny obchádzajúci zápis bb.image`);
  }
});

test('sledovaný 3D model dostáva farbu identity, nie holý biely GLB', () => {
  // Zdroj hlásenia „je biele, potom zas azúrové": billboard sledovaného je
  // azúrový (amber vo vojenskej), ale model sa kreslil bez tintu, takže
  // prechod model↔billboard menil farbu stroja.
  for (const file of ['./flights.js', './militaryFlights.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const name = file.includes('military') ? 'military' : 'flights';
    assert.match(
      source,
      /applyAircraftModelTreatment\(\{\s*\n\s*model: _trackedModel,\s*\n\s*baseColor: _irBoost \? Cesium\.Color\.WHITE : _modelColor\(_trackedIcao\)/,
      `${name}: tracked model je tintovaný identitou`,
    );
  }
});

test('zapečené tinty pre svetlý podklad: ink/ember sú iné textúry, maják ostáva červený', async () => {
  const { aircraftIcon, TINT_FILLS } = await import('./aircraftIcons.js');
  const plain = aircraftIcon('airliner', 64, true);
  const ink = aircraftIcon('airliner', 64, true, 'ink');
  const ember = aircraftIcon('airliner', 64, true, 'ember');
  assert.notEqual(plain, ink);
  assert.notEqual(ink, ember);
  const decode = (uri) => Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
  const inkSvg = decode(ink);
  assert.ok(inkSvg.includes(`fill="${TINT_FILLS.ink}"`), 'výplň je zapečená v SVG');
  assert.ok(!inkSvg.includes('fill="white"'), 'žiadna biela výplň neostala');
  assert.ok(/#ff2626/i.test(inkSvg), 'krídlový maják je v textúre červený — tint ho nezabije');
  // Neznámy tint = bez tintu; TR-3B tint ignoruje.
  assert.equal(aircraftIcon('airliner', 64, false, 'nezmysel'), aircraftIcon('airliner', 64, false));
  assert.equal(aircraftIcon('tr3b', 64, false, 'ink'), aircraftIcon('tr3b', 64, false));
});
