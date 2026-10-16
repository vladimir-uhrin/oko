// Drobnosti 2026-10-12: zdieľanie lode, ponuka ustúpi karte, nadpis panelu, posledný let z karty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVesselShareCopy, pickShareCards, vesselShareCard } from './cardShare.js';
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

// 2026-10-15: stav polohy dodá vrstva lodí — skutočná karta (buildSelectedVesselCard) nesie odhad
// lode z oceánu uprostred riadku zdroja v päte a zastaranosť len v titulku, zdieľanie hlásilo NAŽIVO.
test('loď z oceánu (oneskorená, odhad z kurzu) a zastaraná loď sa nezdieľajú ako NAŽIVO', async () => {
  const Cesium = await import('cesium');
  const { currentLanguage } = await import('./i18n.js');
  const { buildSelectedVesselCard, deadReckonVessel, vesselShareState, default: vessels, _setVesselStateForTest } = await import('./data/aisLiveVessels.js');
  const { setOverlayEntries, getOverlayEntryText, clearOverlaySource } = await import('./overlays/worldOverlay.js');
  const lang = currentLanguage();
  const word = (sk, en) => (lang === 'en' ? en : sk);
  const NOW = Date.now();
  const nowS = Math.floor(NOW / 1000);
  const share = (record) => {
    setOverlayEntries('ais-live-vessels', [{ ...buildSelectedVesselCard(record, NOW, null, []), variant: 'selected' }]);
    const text = getOverlayEntryText('ais-live-vessels', `vessel:${record.mmsi}`);
    clearOverlaySource('ais-live-vessels');
    const card = vesselShareCard(text, { ...vesselShareState(record, NOW), lang });
    return { card, copy: buildVesselShareCopy(card, { lang, whenMs: NOW }) };
  };
  const base = {
    name: 'BLUE MASTER II', mmsi: '538090451', type: 'Cargo', destination: '', speed: 13.1, course: 258, heading: 250,
    lastPositionUtc: '', missedRefreshes: 0, position: Cesium.Cartesian3.fromDegrees(-30, 45, 0), billboard: null,
    lat: 45, lon: -30, fixLat: 45, fixLon: -30,
  };

  // Oceán, poloha spred 12 min, pláva: ikona je na odhade z kurzu a rýchlosti.
  const ocean = { ...base, feed: 'ocean', lastPositionEpoch: nowS - 12 * 60 };
  const est = deadReckonVessel(ocean, NOW);
  ocean.estimated = { km: est.km, ageMin: est.ageMin };
  const dr = share(ocean);
  assert.equal(dr.card.chipText, word('ODHAD', 'ESTIMATE'));
  assert.equal(dr.card.chipTone, 'estimate');
  assert.equal(dr.card.estimated, true);
  assert.match(dr.copy.description, lang === 'en' ? /^ESTIMATED position from course and speed/ : /^ODHAD polohy z kurzu a rýchlosti/);

  // Oceán, čerstvá poloha (pod 5 min, bez odhadu): zdroj je oneskorený, nie živý.
  const delayed = share({ ...base, feed: 'ocean', estimated: null, lastPositionEpoch: nowS - 3 * 60 });
  assert.equal(delayed.card.chipText, word('ONESKORENÉ', 'DELAYED'));
  assert.equal(delayed.card.chipTone, 'estimate');

  // AISStream, poloha spred 15 min: karta má „· STALE", zdieľanie ZASTARANÉ.
  const stale = share({ ...base, feed: '', estimated: null, lastPositionEpoch: nowS - 15 * 60 });
  assert.equal(stale.card.chipText, word('ZASTARANÉ', 'STALE'));
  assert.equal(stale.card.chipTone, 'estimate');
  assert.match(stale.copy.description, new RegExp(`^${word('ZASTARANÉ', 'STALE')} · `));

  // Kontrola: živá loď s čerstvou polohou ostáva NAŽIVO.
  const live = share({ ...base, feed: '', estimated: null, lastPositionEpoch: nowS - 30 });
  assert.equal(live.card.chipText, word('NAŽIVO', 'LIVE'));
  assert.equal(live.card.chipTone, 'live');

  // Vrstva vydá ten istý stav pre vybranú loď (ui.js → _selectedVesselRef().share).
  _setVesselStateForTest({ records: [ocean], selectedRecord: ocean });
  assert.equal(vessels.getSelectedShareState().delayed, true);
  assert.match(vessels.getSelectedShareState().estimateLine, lang === 'en' ? /^ESTIMATED/ : /^ODHAD/);
  _setVesselStateForTest({ records: [] });
  assert.equal(vessels.getSelectedShareState(), null);
});

test('zdieľanie pri sledovanom lietadle (aj vojenskom) nikdy nesiahne po predtým vybranej lodi', () => {
  const flight = { callsign: 'DAL123' };
  const military = { callsign: 'RCH451' };
  const vessel = { callsign: 'NORDIC STAR' };
  let vesselAsked = 0;
  const vesselCard = () => { vesselAsked += 1; return vessel; };
  // Vojenský stroj sledovaný, loď z AISHub ostala vybraná: pás letu z vojenskej vrstvy.
  assert.deepEqual(
    pickShareCards({ trackedId: 'military:ae1234', flightCard: () => null, militaryCard: () => military, vesselCard }),
    { flightCard: military, vesselCard: null },
  );
  assert.deepEqual(
    pickShareCards({ trackedId: 'flights:a1b2c3', flightCard: () => flight, militaryCard: () => null, vesselCard }),
    { flightCard: flight, vesselCard: null },
  );
  // Karta lietadla sa nedala zložiť (vrstva vypnutá, výnimka): všeobecný pohľad, nie loď.
  assert.deepEqual(
    pickShareCards({ trackedId: 'military:ae1234', flightCard: () => null, militaryCard: () => { throw new Error('x'); }, vesselCard }),
    { flightCard: null, vesselCard: null },
  );
  assert.deepEqual(pickShareCards({ trackedId: 'flights:a1b2c3', vesselCard }), { flightCard: null, vesselCard: null });
  assert.equal(vesselAsked, 0, 'pri sledovanom lietadle sa loď ani nečíta');
  // Bez sledovaného lietadla: vybraná loď.
  assert.deepEqual(pickShareCards({ trackedId: null, flightCard: () => null, militaryCard: () => null, vesselCard }), { flightCard: null, vesselCard: vessel });
  assert.deepEqual(pickShareCards({ trackedId: 'satellites:25544', vesselCard: () => { throw new Error('x'); } }), { flightCard: null, vesselCard: null });
});

// 2026-10-16 (kontrola g3): vrstvy aj pickShareCards sú testované, no ich prepojenie v ui.js nie —
// návrat ui.js k `delayed: sourceId !== …` alebo k zdieľaniu bez vojenskej vrstvy by testy nechal zelené.
test('zapojenie v ui.js: zdieľanie číta stav polohy lode z vrstvy a sledovaný vojenský stroj', async () => {
  const { readFileSync } = await import('node:fs');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const ref = ui.slice(ui.indexOf('  _selectedVesselRef() {'), ui.indexOf('  async _openSharePanel() {'));
  assert.match(ref, /share: layer\('ais-live-vessels'\)\?\.getSelectedShareState\?\.\(\)/, 'živé AIS: stav z vrstvy (oceán, odhad, zastarané)');
  assert.equal((ref.match(/share: \{ delayed: true \}/g) || []).length, 2, 'AISHub aj GFW sú oneskorené');
  const open = ui.slice(ui.indexOf('  async _openSharePanel() {'));
  assert.match(open, /pickShareCards\(\{\s*trackedId: getActiveTrackedReadoutId\(\),/);
  assert.match(open, /militaryCard: \(\) => shareLayer\('military'\)\?\.getTrackedShareCard\?\.\(\)/);
  assert.match(open, /vesselShareCard\(getOverlayEntryText\(sel\.sourceId, sel\.entryId\), \{ \.\.\.sel\.share, lang \}\)/);
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
