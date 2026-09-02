import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  accentForVesselType,
  applyVesselOverlayPolicy,
  mmsiFlag,
  navStatusLabel,
  normalizeVesselType,
  vesselOverlayCohortLimit,
  vesselTypeCss,
} from './vesselLabels.js';

test('normalizeVesselType maps numeric AIS codes to type families', () => {
  assert.equal(normalizeVesselType('30'), 'FISHING');
  assert.equal(normalizeVesselType('31'), 'TOWING');
  assert.equal(normalizeVesselType('35'), 'MILITARY');
  assert.equal(normalizeVesselType('36'), 'SAILING');
  assert.equal(normalizeVesselType('37'), 'PLEASURE');
  assert.equal(normalizeVesselType('40'), 'HIGH-SPEED');
  assert.equal(normalizeVesselType('50'), 'PILOT');
  assert.equal(normalizeVesselType('51'), 'SAR');
  assert.equal(normalizeVesselType('52'), 'TUG');
  assert.equal(normalizeVesselType('60'), 'PASSENGER');
  assert.equal(normalizeVesselType('71'), 'CARGO');
  assert.equal(normalizeVesselType('84'), 'TANKER');
  assert.equal(normalizeVesselType('90'), 'OTHER');
});

test('normalizeVesselType preserves text and degrades unknown codes', () => {
  assert.equal(normalizeVesselType('Crude Oil Tanker'), 'Crude Oil Tanker');
  assert.equal(normalizeVesselType('0'), '');
  assert.equal(normalizeVesselType('25'), 'OTHER');
  assert.equal(normalizeVesselType(undefined), '');
});

test('vessel type CSS and card accents stay paired', () => {
  assert.equal(vesselTypeCss('Crude Oil Tanker'), '#ffb347');
  assert.equal(vesselTypeCss('Container Ship'), '#39d5ff');
  assert.equal(vesselTypeCss('Passenger/Ferry'), '#ff7adf');
  assert.equal(vesselTypeCss('Fishing'), '#7cff9b');
  assert.equal(vesselTypeCss('Tug'), '#f7f0a3');
  assert.equal(accentForVesselType('Tanker'), '255, 179, 71');
  assert.equal(accentForVesselType('Cargo'), '57, 213, 255');
  assert.equal(accentForVesselType('Passenger'), '255, 122, 223');
  assert.equal(accentForVesselType('Fishing'), '124, 255, 155');
  assert.equal(accentForVesselType('Pilot Vessel'), '247, 240, 163');
  assert.equal(accentForVesselType('Dredger'), '57, 213, 255');
  assert.equal(accentForVesselType('84'), '255, 179, 71');
  assert.equal(vesselTypeCss('62'), '#ff7adf');
});

test('vessel viewport cohort preserves the shipped 118px grid density', () => {
  assert.equal(vesselOverlayCohortLimit(1600, 900), 112);
  assert.equal(vesselOverlayCohortLimit(1920, 1080), 170);
  assert.equal(vesselOverlayCohortLimit(1920, 1080, 80), 80);
  assert.equal(vesselOverlayCohortLimit(10000, 10000), 900, 'the shipped row ceiling remains absolute');
  assert.equal(vesselOverlayCohortLimit(0, 1080), 0);
  assert.equal(vesselOverlayCohortLimit(1920, 1080, 0), 0);
});

test('vessel host policy uses always-on shared fade and protected selected lane', () => {
  const position = { x: 1, y: 2, z: 3 };
  const ambient = applyVesselOverlayPolicy({
    id: 'vessel:1', position, title: 'AMBIENT', gapPx: 10, selected: false,
  });
  assert.equal(ambient.variant, 'card');
  assert.equal(ambient.protected, false);
  assert.equal(ambient.collisionGroup, 'ambient-card');
  assert.equal(ambient.edgeFade, 'keyhole');
  // 300 km (bolo 5000 km): karty lodí len pri priblížení — zrkadlí OFF prah
  // detection range brány; fade štartuje na 210 km (0.7 ratio). Zámerná zmena
  // 2026-08-31 na pokyn používateľa (čisté ikony pri diaľkovom pohľade;
  // prvé nastavenie 50 km bolo priveľmi prísne — dekorácie sa majú vrátiť
  // už pri regionálnom zoome).
  assert.equal(ambient.maxDistance, 300_000);
  assert.equal(ambient.distanceFadeStartRatio, 0.7);
  assert.equal(ambient.cardStyle, 'tactical');
  assert.equal(ambient.verticalOnly, true);

  const selected = applyVesselOverlayPolicy({
    id: 'vessel:2', position, title: 'SELECTED', gapPx: 12, selected: true,
  });
  assert.equal(selected.variant, 'selected');
  assert.equal(selected.protected, true);
  assert.equal(selected.collisionGroup, 'ambient-card');
  assert.equal(selected.maxDistance, Number.POSITIVE_INFINITY);
});

test('vesselLabels cannot resurrect a dedicated renderer', async () => {
  const source = await readFile(new URL('./vesselLabels.js', import.meta.url), 'utf8');
  for (const forbidden of [
    'document.createElement',
    "createElement('canvas')",
    'postRender.addEventListener',
    'worldToWindowCoordinates',
    'requestAnimationFrame',
    "id = 'vessel-labels'",
  ]) {
    assert.equal(source.includes(forbidden), false, `dedicated renderer token returned: ${forbidden}`);
  }
});

// --- Poctivý vek polohy (pravidlo 2: stav dát musí byť viditeľný) -----------
// Server drží riadky 30 minút a klient ich kreslil ako živé — loď, ktorá
// prestala vysielať, vyzerala celý ten čas čerstvá. lastPositionEpoch pritom
// celý čas tiekol až do record-u a nečítal ho nikto.

test('vesselPositionAge: čerstvý fix nemá štítok, starý má vek a STALE', async () => {
  const { vesselPositionAge, VESSEL_POSITION_STALE_SEC } = await import('./vesselLabels.js');
  const nowMs = 1_790_000_000_000;
  const at = (ageSec) => vesselPositionAge(nowMs / 1000 - ageSec, nowMs);

  assert.deepEqual(at(30), { ageSec: 30, label: null, stale: false });
  assert.deepEqual(at(90), { ageSec: 90, label: null, stale: false });
  // Od 2 min sa vek priznáva na karte…
  assert.deepEqual(at(3 * 60), { ageSec: 180, label: '3 min', stale: false });
  // …od 10 min je kontakt STALE (kotviaca loď hlási každé 3 min; 10 min ticha
  // už nie je normálna prevádzka).
  assert.equal(VESSEL_POSITION_STALE_SEC, 600);
  assert.deepEqual(at(12 * 60), { ageSec: 720, label: '12 min', stale: true });
  assert.deepEqual(at(2 * 3600), { ageSec: 7200, label: '2 h', stale: true });
});

test('vesselPositionAge: chýbajúci alebo budúci epoch nevyrába falošný vek', async () => {
  const { vesselPositionAge } = await import('./vesselLabels.js');
  const nowMs = 1_790_000_000_000;
  assert.deepEqual(vesselPositionAge(null, nowMs), { ageSec: null, label: null, stale: false });
  assert.deepEqual(vesselPositionAge(undefined, nowMs), { ageSec: null, label: null, stale: false });
  assert.deepEqual(vesselPositionAge(0, nowMs), { ageSec: null, label: null, stale: false });
  assert.deepEqual(vesselPositionAge('junk', nowMs), { ageSec: null, label: null, stale: false });
  // Fix "z budúcnosti" (zle nastavené hodiny na prijímači) sa oreže na 0,
  // nikdy nie záporný vek.
  assert.deepEqual(vesselPositionAge(nowMs / 1000 + 300, nowMs), { ageSec: 0, label: null, stale: false });
});

test('navStatusLabel: prevádzkové stavy AIS dostávajú taktické štítky, rezervy nič', () => {
  assert.equal(navStatusLabel(0), 'UNDER WAY');
  assert.equal(navStatusLabel(1), 'AT ANCHOR');
  assert.equal(navStatusLabel(2), 'NOT UNDER CMD');
  assert.equal(navStatusLabel(3), 'RESTR MANVR');
  assert.equal(navStatusLabel(4), 'CONSTR DRAUGHT');
  assert.equal(navStatusLabel(5), 'MOORED');
  assert.equal(navStatusLabel(6), 'AGROUND');
  assert.equal(navStatusLabel(7), 'FISHING');
  assert.equal(navStatusLabel(8), 'UNDER SAIL');
  assert.equal(navStatusLabel(11), 'TOWING ASTERN');
  assert.equal(navStatusLabel(12), 'PUSHING AHEAD');
  // 14 = aktívny SART/MOB/EPIRB — tiesňový vysielač, prvotriedna intel
  // informácia (lodná obdoba squawk 7700).
  assert.equal(navStatusLabel(14), 'SART ACTIVE');
  // Rezervované kódy a "not defined" nedostanú riadok — šum nie je stav.
  assert.equal(navStatusLabel(9), '');
  assert.equal(navStatusLabel(10), '');
  assert.equal(navStatusLabel(13), '');
  assert.equal(navStatusLabel(15), '');
  assert.equal(navStatusLabel(null), '');
  assert.equal(navStatusLabel(undefined), '');
});

test('mmsiFlag: MID prefix bežného lodného MMSI určuje vlajkový štát', () => {
  // 267 = Slovensko — PREŠOV aj SITNO z overenia Dunaja nesú tento prefix.
  assert.deepEqual(mmsiFlag('267940000'), { iso2: 'SK', name: 'Slovak Republic' });
  assert.equal(mmsiFlag('203999999').iso2, 'AT');
  assert.equal(mmsiFlag('269057000').iso2, 'CH');
  // Nie-lodné MMSI vlajku zámerne nedostávajú: pobrežné stanice (00…),
  // SAR letectvo (111…), AtoN (99…), pomocné plavidlá (98…).
  assert.equal(mmsiFlag('002670001'), null);
  assert.equal(mmsiFlag('111267001'), null);
  assert.equal(mmsiFlag('992670001'), null);
  assert.equal(mmsiFlag('982670001'), null);
  // Nepridelený MID, zlá dĺžka, smeti.
  assert.equal(mmsiFlag('199000000'), null);
  assert.equal(mmsiFlag('12345'), null);
  assert.equal(mmsiFlag(''), null);
  assert.equal(mmsiFlag(null), null);
  assert.equal(mmsiFlag('26794000A'), null);
  // Číslo namiesto reťazca sa toleruje (MMSI chodí z JSON aj ako number).
  assert.equal(mmsiFlag(267940000).iso2, 'SK');
});
