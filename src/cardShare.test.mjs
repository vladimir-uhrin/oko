// Drobnosti 2026-10-12: zdieľanie lode, ponuka ustúpi karte, nadpis panelu, posledný let z karty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVesselShareCopy, vesselShareCard } from './cardShare.js';
import { rectsOverlap, installCardChromeFade, CARD_CHROME_CLASS } from './cardChromeFade.js';
import { pickLatestLeg, LATEST_LEG_MAX_AGE_S } from './historyPanel.js';

// Skutočný text karty lode (QA 4181, 2026-10-12, BLUE MASTER II).
const BLUE_MASTER = {
  title: 'BLUE MASTER II',
  details: [
    '13,1 kn (24 km/h) · kurz 258° (Z) · smer prídy 250° · otáčanie 20°/min vľavo',
    'Loď na kusový náklad · pláva na motor · V7ZQ4',
    'IMO 9465411 · AIS trieda A · 200 × 30 m · ponor 11,0 m',
    'postavená 2013 · GT 30 469 · DWT 37 444 t',
    'vyplávala 12. 10. 17:05 UTC · pred 4 h',
    'ETA 10-15 16:00 (hlási posádka)',
  ],
  route: 'BEANR Antwerpen (Belgicko) → ESVIL Villagarcia D… (Španielsko)',
  progress: 0.056,
  footer: ['AISStream · POS: 21:04:43Z', 'MMSI 538090451 · Miestny čas 23:06 (UTC+2)'],
  alert: '',
};

test('loď: typ pod menom, pohyb skrátený, ETA, trasa a priebeh; NAŽIVO', () => {
  const card = vesselShareCard(BLUE_MASTER);
  assert.equal(card.callsign, 'BLUE MASTER II');
  assert.equal(card.identLine, 'Loď na kusový náklad · pláva na motor · V7ZQ4');
  assert.deepEqual(card.flightLines, ['13,1 kn (24 km/h) · kurz 258° (Z)', 'ETA 10-15 16:00 (hlási posádka)']);
  assert.equal(card.routeLine, BLUE_MASTER.route);
  assert.equal(card.progress.fractionDone, 0.056);
  assert.equal(card.chipText, 'NAŽIVO');
  assert.equal(card.estimated, false);
  const copy = buildVesselShareCopy(card, { lang: 'sk', whenMs: Date.UTC(2026, 9, 12, 21, 7) });
  assert.equal(copy.title, 'BLUE MASTER II · Loď na kusový náklad · BEANR Antwerpen (Belgicko) → ESVIL Villagarcia D… (Španielsko) | OKO');
  assert.match(copy.description, /^NAŽIVO · 13,1 kn \(24 km\/h\) · kurz 258° \(Z\) · ETA 10-15/);
  assert.match(copy.description, /6 % plavby · okolive\.sk/);
});

test('loď z oneskoreného zdroja = ONESKORENÉ, odhad polohy = ODHAD so zdrojom', () => {
  assert.equal(vesselShareCard(BLUE_MASTER, { delayed: true }).chipText, 'ONESKORENÉ');
  const est = vesselShareCard({ ...BLUE_MASTER, details: ['ODHAD polohy z kurzu a rýchlosti · +12 km za 40 min od poslednej polohy', ...BLUE_MASTER.details] });
  assert.equal(est.chipText, 'ODHAD');
  assert.equal(est.estimated, true);
  assert.match(est.estimateLine, /^ODHAD polohy/);
  assert.equal(est.identLine, 'Loď na kusový náklad · pláva na motor · V7ZQ4', 'riadok odhadu nie je typ lode');
  assert.match(buildVesselShareCopy(est).description, /^ODHAD polohy z kurzu/);
  assert.equal(vesselShareCard(null), null);
  assert.equal(vesselShareCard({ title: ' ', details: [] }), null);
});

test('ponuka vpravo hore ustúpi len pri prekrytí kartou a trieda sa mení len pri zmene', () => {
  assert.equal(rectsOverlap({ x: 600, y: 60, w: 400, h: 300 }, { left: 900, top: 80, width: 120, height: 90 }), true);
  assert.equal(rectsOverlap({ x: 100, y: 400, w: 400, h: 200 }, { left: 900, top: 80, width: 120, height: 90 }), false);
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { left: 0, top: 0, width: 0, height: 10 }), false);

  let card = null;
  const toggles = [];
  const el = { getBoundingClientRect: () => ({ left: 900, top: 80, width: 120, height: 90 }), classList: { toggle: (c, on) => toggles.push([c, on]), remove: () => {} } };
  const doc = { getElementById: (id) => (id === 'lang-switch' ? el : null), querySelector: () => null };
  const fade = installCardChromeFade(null, { doc, cardRect: () => card });
  assert.deepEqual(toggles, [[CARD_CHROME_CLASS, false]]);
  fade.sync();
  assert.equal(toggles.length, 1, 'bez zmeny žiadny zápis');
  card = { x: 600, y: 60, w: 400, h: 300 };
  fade.sync();
  assert.deepEqual(toggles.at(-1), [CARD_CHROME_CLASS, true]);
  fade.sync();
  assert.equal(toggles.length, 2);
  card = null;
  fade.sync();
  assert.deepEqual(toggles.at(-1), [CARD_CHROME_CLASS, false]);
});

test('História letu z karty: najnovší let, len ak skončil nedávno', () => {
  const now = 1_791_800_000;
  const legs = [
    { icao24: 'abc', firstT: now - 20_000, lastT: now - 15_000 },
    { icao24: 'abc', firstT: now - 5_000, lastT: now - 60 },
    { icao24: 'abc', firstT: now - 9_000, lastT: now - 8_000 },
  ];
  assert.equal(pickLatestLeg(legs, now).lastT, now - 60);
  assert.equal(pickLatestLeg([{ lastT: now - LATEST_LEG_MAX_AGE_S - 1 }], now), null, 'starý let = zoznam, nie detail');
  assert.equal(pickLatestLeg([], now), null);
  assert.equal(pickLatestLeg(null, now), null);
});

test('prekrytie vráti text karty ako kópiu (titulok, riadky, trasa, priebeh, päta)', async () => {
  const { setOverlayEntries, getOverlayEntryText, clearOverlaySource } = await import('./overlays/worldOverlay.js');
  setOverlayEntries('qa-card-text', [{
    id: 'vessel:1', position: { x: 1, y: 2, z: 3 }, variant: 'selected', title: 'BLUE MASTER II',
    details: ['13,1 kn'], route: { origin: { label: 'BEANR Antwerpen' }, destination: { label: 'ESVIL Villagarcia' } },
    progress: { fraction: 0.5, label: '' }, footer: ['AISStream'],
  }]);
  const text = getOverlayEntryText('qa-card-text', 'vessel:1');
  assert.deepEqual(text, { title: 'BLUE MASTER II', details: ['13,1 kn'], route: 'BEANR Antwerpen → ESVIL Villagarcia', progress: 0.5, footer: ['AISStream'], alert: '' });
  text.details.push('zmena');
  assert.deepEqual(getOverlayEntryText('qa-card-text', 'vessel:1').details, ['13,1 kn'], 'kópia, nie odkaz');
  assert.equal(getOverlayEntryText('qa-card-text', 'nie'), null);
  clearOverlaySource('qa-card-text');
});
