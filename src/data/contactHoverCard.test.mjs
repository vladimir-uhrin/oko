// src/data/contactHoverCard.test.mjs
// Kartička pod kurzorom (2026-09-03: „keď som ďaleko zazoomovaný, mohli by sa
// po prejdení myšou objaviť základné informácie"; 2026-09-05: „chcem to mouse
// over a potom všetko zmizne" — plná karta s vlajkami, trasou, progresom,
// zdrojom a fotkou). Skladanie modelu je čistá funkcia — testuje sa bez
// prehliadača; DOM lifecycle na minimálnom dvojníkovi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOVER_PHOTO_DEBOUNCE_MS,
  HOVER_REFRESH_MS,
  hoverCardLines,
  hoverCardModel,
  installContactHoverCard,
  updateContactHoverCard,
  destroyContactHoverCard,
  _resetContactHoverCardForTest,
} from './contactHoverCard.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const t = (key, vars) => {
  let text = EN_STRINGS[key] || key;
  for (const [k, v] of Object.entries(vars || {})) text = text.replaceAll(`{${k}}`, String(v));
  return text;
};
const NOW = Date.UTC(2026, 8, 5, 16, 5, 0);

const RICH = {
  layerId: 'flights',
  id: '4b1815',
  callsign: 'SWR123',
  registration: 'HB-JCA',
  type: 'A220-300',
  operator: 'Swiss',
  category: 'commercial',
  military: false,
  onGround: false,
  altitudeM: 11277.6, // 37 000 ft
  speedMps: 231.5, // 450 kt
  verticalRateMps: 0,
  route: 'ZRH → LHR',
  stale: false,
};

/** Chudobný kontakt: presne to, čo tečie pri oddialenom pohľade. */
const SPARSE = {
  layerId: 'flights',
  id: '494116',
  callsign: 'NJE693K',
  registration: null,
  type: null,
  operator: null,
  category: 'bizjet',
  military: false,
  onGround: false,
  altitudeM: 609.6, // 2 000 ft
  speedMps: 56.07, // 109 kt
  verticalRateMps: -2.93,
  route: null,
  stale: false,
};

test('bohatý kontakt: let, stroj s dopravcom, textová trasa, hex v pätičke', () => {
  const card = hoverCardLines(RICH, t, NOW);
  assert.equal(card.title, 'SWR123');
  assert.deepEqual(card.lines, [
    'FL370 (≈ 11 278 m) · 450 kts (833 km/h)',
    'Swiss · A220-300 · HB-JCA',
    'ZRH → LHR',
    'ICAO 4B1815',
  ]);
  assert.equal(card.military, false);
});

test('plný model (2026-09-05): IATA v titulku, vlajky, trasa s vlajkami letísk, progres so zostatkom, zdroj a vek fixu', () => {
  const model = hoverCardModel({
    ...RICH,
    flightIata: 'LX123',
    trackDeg: 302.6,
    verticalRateMps: 6,
    countryIso: 'CH',
    routeInfo: {
      origin: { code: 'ZRH', name: 'Zurich', country: 'CH', lat: 47.46, lon: 8.55 },
      destination: { code: 'LHR', name: 'London', country: 'GB', lat: 51.47, lon: -0.46 },
    },
    progress: { fractionDone: 0.4, remainingKm: 470.4, etaMinutes: 34 },
    source: 'OpenSky Network',
    lastContactEpochMs: NOW - 9_000,
    squawk: '1000',
  }, t, NOW);
  assert.equal(model.title, 'SWR123 · LX123');
  assert.equal(model.titleFlag, 'ch');
  assert.deepEqual(model.details, ['FL370 (≈ 11\u202f278 m) ↑1\u202f180 ft/min (6,0 m/s) · 450 kts (833 km/h) · 303° (NW)', 'Swiss · A220-300 · HB-JCA']);
  assert.deepEqual(model.route, {
    origin: { label: 'ZRH Zurich (Switzerland)', iso2: 'ch' },
    destination: { label: 'LHR London (United Kingdom)', iso2: 'gb' },
  });
  assert.equal(model.progress.fraction, 0.4);
  assert.match(model.progress.label, /^40 % of the route · 470 km left · landing in 34 min \(\d\d:\d\d\)$/);
  assert.deepEqual(model.footer, ['OpenSky Network · position 9 s ago · squawk 1000 · ICAO 4B1815']);
  assert.equal(model.hex, '4b1815', 'fotka sa dopytuje len pre lietadlá s platným hexom');
  // Textový pohľad radí: detaily, trasa, progres, pätička.
  const lines = hoverCardLines({ ...RICH, routeInfo: null, progress: null }, t, NOW).lines;
  assert.equal(lines.at(-1), 'ICAO 4B1815');
});

test('chudobný kontakt (oddialený pohľad): let prvý, kategória zaskočí za chýbajúci typ, hex v pätičke', () => {
  // Pri oddialení netečie typ, dopravca ani trasa — enrichment beží prednostne
  // pre stroje na obrazovke. Kartička nesmie zostať prázdna ani ukazovať „—":
  // triedu vieme vždy, tak povie aspoň, ČO to je.
  const card = hoverCardLines(SPARSE, t, NOW);
  assert.equal(card.title, 'NJE693K');
  // Klesanie -2.93 m/s je za prahom → šípka dole + ft/min; pod FL180 stopy
  // (rovnaká konvencia ako karta sledovaného letu).
  assert.match(card.lines[0], /^2.000 ft \(610 m\) ↓580 ft\/min \(2,9 m\/s\) · 109 kts \(202 km\/h\)$/);
  assert.equal(card.lines[1], EN_STRINGS['aircraft.category.bizjet']);
  assert.equal(card.lines[2], 'ICAO 494116');
  assert.equal(card.lines.length, 3, 'žiadne prázdne riadky za chýbajúce polia');
});

test('šípka stúpania/klesania rešpektuje prah, hladina ju nemá', () => {
  const trend = (rate) => hoverCardLines({ ...SPARSE, verticalRateMps: rate }, t, NOW).lines[0];
  assert.match(trend(8), /\) ↑\d/, 'stúpa');
  assert.match(trend(-8), /\) ↓\d/, 'klesá');
  assert.doesNotMatch(trend(0), /[↑↓]/, 'v hladine bez šípky');
  assert.doesNotMatch(trend(1.2), /[↑↓]/, 'drobné kolísanie nie je stúpanie');
  assert.doesNotMatch(trend(null), /[↑↓]/, 'neznáma vertikálna rýchlosť nič netvrdí');
});

test('stroj na zemi a kontakt bez fixu to povedia; neznáma výška nekreslí „0 ft"', () => {
  const ground = hoverCardLines({ ...SPARSE, onGround: true }, t, NOW);
  assert.ok(ground.lines.some((l) => l.includes(EN_STRINGS['hover.on-ground'])));
  assert.ok(!ground.lines.some((l) => /FL\d|\d ft/.test(l)), 'na zemi sa výška nekreslí');
  const stale = hoverCardLines({ ...SPARSE, stale: true }, t, NOW);
  assert.equal(stale.lines.at(-1), EN_STRINGS['hover.stale'], 'odhad je priznaný, ako posledný');
  const noAlt = hoverCardLines({ ...SPARSE, altitudeM: null, trackDeg: 180 }, t, NOW);
  assert.equal(noAlt.lines[0], '109 kts (202 km/h) · 180° (S)');
});

test('identita: bez volacieho znaku nastúpi registrácia, potom hex; registrácia sa pod titulkom neopakuje', () => {
  assert.equal(hoverCardLines({ ...SPARSE, callsign: null, registration: 'OM-ABC' }, t, NOW).title, 'OM-ABC');
  assert.equal(hoverCardLines({ ...SPARSE, callsign: null, registration: null }, t, NOW).title, '494116');
  const card = hoverCardLines({ ...SPARSE, callsign: null, registration: 'OM-ABC', type: null }, t, NOW);
  assert.ok(!card.lines[1].includes('OM-ABC'), 'registrácia sa nezopakuje pod titulkom');
  assert.equal(hoverCardLines({ ...SPARSE, flightIata: 'nje693k' }, t, NOW).title, 'NJE693K', 'IATA rovnaké ako volací znak sa neopakuje');
});

test('vojenský kontakt je označený, prázdny vstup nekreslí nič', () => {
  assert.equal(hoverCardLines({ ...SPARSE, military: true }, t, NOW).military, true);
  assert.equal(hoverCardLines(null, t, NOW), null);
  assert.equal(hoverCardLines({ ...SPARSE, callsign: null, registration: null, id: '' }, t, NOW), null);
});

test('hover card carries the registration flag (ISO2) for the title and none when unknown', () => {
  const base = { id: 'abc123', callsign: 'AFR702', category: 'airliner', military: false, layerId: 'flights' };
  assert.equal(hoverCardLines({ ...base, countryIso: 'fr' }, t, NOW).flag, 'fr');
  assert.equal(hoverCardLines({ ...base, flag: 'PA' }, t, NOW).flag, 'pa', 'vessel summaries may pass `flag`');
  assert.equal(hoverCardLines({ ...base, originCountry: 'Germany' }, t, NOW).flag, 'de', 'OpenSky meno štátu ako fallback');
  assert.equal(hoverCardLines(base, t, NOW).flag, null);
});

test('DOM lifecycle: riadky, vlajky, progres bar, fotka po zotrvaní (debounce), sticky nad fotkou, zhasnutie pri odchode', async () => {
  _resetContactHoverCardForTest();
  const makeEl = (tag) => ({
    tagName: tag, children: [], style: {}, hidden: false, className: '', attrs: {}, listeners: {},
    classList: { toggle(name, on) { this._m = this._m || new Set(); on ? this._m.add(name) : this._m.delete(name); }, contains(name) { return Boolean(this._m?.has(name)); } },
    get textContent() { return this._text ?? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); if (typeof c !== 'string') c.parentNode = this; return c; },
    remove() { const p = this.parentNode; if (p) p.children = p.children.filter((c) => c !== this); },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type) { for (const fn of this.listeners[type] || []) fn(); },
    get offsetWidth() { return 200; }, get offsetHeight() { return 90; },
    ownerDocument: null,
  });
  const doc = {
    createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; },
    createTextNode: (text) => text,
    defaultView: { innerWidth: 1000, innerHeight: 800 },
  };
  const container = makeEl('body'); container.ownerDocument = doc;
  const summary = {
    ...RICH, countryIso: 'CH',
    routeInfo: { origin: { code: 'ZRH', name: 'Zurich', country: 'CH' }, destination: { code: 'LHR', name: 'London', country: 'GB' } },
    progress: { fractionDone: 0.4, remainingKm: 470, etaMinutes: 34 },
    source: 'OpenSky Network',
  };
  const timers = [];
  const lookups = [];
  const dwells = [];
  installContactHoverCard({
    container,
    resolveSummary: (cands) => (cands[0]?.sourceId === '4b1815' ? summary : null),
    onDwell: (candidate) => dwells.push(candidate),
    lookupPhoto: async (hex) => { lookups.push(hex); return { src: 'https://t.plnspttrs.net/x_t.jpg', link: 'https://www.planespotters.net/photo/1', photographer: 'Jane Doe' }; },
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutImpl: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
  });
  const card = container.children[0];
  assert.equal(card.hidden, true);

  updateContactHoverCard([{ layerId: 'flights', sourceId: '4b1815' }], { x: 100, y: 100 }, t);
  assert.equal(card.hidden, false);
  const classes = card.children.map((c) => c.className);
  assert.deepEqual(classes, ['contact-hover-card-title', 'contact-hover-card-line', 'contact-hover-card-line', 'contact-hover-card-route', 'contact-hover-card-progress', 'contact-hover-card-footer']);
  assert.equal(card.children[0].children[0].className, 'contact-hover-card-flag', 'vlajka pred titulkom');
  assert.match(card.children[0].children[0].src, /\/ch\.svg$/);
  const route = card.children[3];
  assert.equal(route.children.filter((c) => c.className === 'contact-hover-card-flag').length, 2, 'vlajky oboch letísk');
  assert.equal(card.children[4].children[0].children[0].style.width, '40%', 'progres bar');
  assert.equal(card.style.transform, 'translate(114px, 114px)');
  // Fotka: až po debounce, jeden dopyt na stroj. (Popri nej beží obnovovanie kartičky — HOVER_REFRESH_MS.)
  const photoTimers = () => timers.filter((x) => x.ms === HOVER_PHOTO_DEBOUNCE_MS);
  assert.equal(lookups.length, 0);
  assert.equal(photoTimers().length, 1);
  updateContactHoverCard([{ layerId: 'flights', sourceId: '4b1815' }], { x: 120, y: 100 }, t);
  assert.equal(photoTimers().length, 1, 'ten istý stroj = ten istý časovač, bez reštartu');
  assert.equal(timers.filter((x) => x.ms === HOVER_REFRESH_MS).length, 1, 'obnovovanie sa pri tom istom stroji nereštartuje');
  photoTimers()[0].fn?.();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(lookups, ['4b1815']);
  assert.deepEqual(dwells, [{ layerId: 'flights', sourceId: '4b1815' }], 'zotrvanie vypýta enrichment raz');
  const photo = card.children.at(-1);
  assert.equal(photo.className, 'contact-hover-card-photo');
  assert.equal(photo.tagName, 'a');
  assert.equal(photo.rel, 'noopener');
  assert.equal(photo.href, 'https://www.planespotters.net/photo/1');
  assert.match(photo.children[1].textContent, /Jane Doe/);
  // Sticky: kurzor na fotke → odchod z canvasu kartičku nezhasne.
  photo.fire('mouseenter');
  updateContactHoverCard([], null, t);
  assert.equal(card.hidden, false, 'nad fotkou ostáva, nech sa dá kliknúť');
  // Odchod z fotky → zhasne.
  photo.fire('mouseleave');
  assert.equal(card.hidden, true);
  // Bez kurzora nad fotkou odchod z canvasu zhasne rovno.
  updateContactHoverCard([{ layerId: 'flights', sourceId: '4b1815' }], { x: 100, y: 100 }, t);
  assert.equal(card.hidden, false);
  assert.equal(lookups.length, 1, 'fotka už je známa — bez ďalšieho dopytu');
  assert.equal(card.children.at(-1).className, 'contact-hover-card-photo', 'známa fotka sa kreslí hneď');
  updateContactHoverCard([], null, t);
  assert.equal(card.hidden, true);
  destroyContactHoverCard();
  assert.equal(container.children.length, 0);
  _resetContactHoverCardForTest();
});

test('kartička sa sama obnoví, keď dobehne trasa, dopravca a logá — bez pohybu myšou (vlastník 09-27: „nezobrazí sa mi všetko, čo má")', () => {
  _resetContactHoverCardForTest();
  const makeEl = (tag) => ({
    tagName: tag, children: [], style: {}, hidden: false, className: '', attrs: {}, listeners: {},
    classList: { toggle() {}, contains() { return false; } },
    get textContent() { return this._text ?? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {},
    get offsetWidth() { return 200; }, get offsetHeight() { return 90; },
    get childNodes() { return this.children; },
    ownerDocument: null,
  });
  const doc = { createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; }, createTextNode: (x) => x, defaultView: { innerWidth: 1000, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  const summary = { ...RICH, routeInfo: null, operator: null };
  const timers = [];
  installContactHoverCard({
    container,
    resolveSummary: () => summary,
    lookupPhoto: async () => null,
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutImpl: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
  });
  const card = container.children[0];
  updateContactHoverCard([{ layerId: 'flights', sourceId: '4b1815' }], { x: 100, y: 100 }, t);
  assert.ok(!card.children.some((c) => c.className === 'contact-hover-card-route'), 'trasa ešte nie je');
  // dobehne trasa, čitateľné riadky a logá — myš stojí
  summary.routeInfo = { origin: { code: 'VIE', name: 'Vienna', country: 'AT' }, destination: { code: 'AER', name: 'Sochi', country: 'RU' } };
  summary.flightLines = ['FL 137 · 4 214 m · stúpa', '338 kts (626 km/h) · 104° (V)'];
  summary.logos = { airline: { url: '/api/logo/img/austrian.png' }, manufacturer: null };
  summary.logoCredit = 'Logá: Wikimedia Commons · PD';
  const refresh = timers.filter((x) => x.ms === HOVER_REFRESH_MS && x.fn).at(-1);
  assert.ok(refresh, 'obnovovanie beží, kým je kartička zobrazená');
  refresh.fn();
  const classes = card.children.map((c) => c.className);
  assert.ok(classes.includes('contact-hover-card-route'), 'trasa sa dokreslila');
  assert.ok(classes.includes('contact-hover-card-logos'), 'logá dopravcu');
  assert.equal(card.children.find((c) => c.className === 'contact-hover-card-logos').children[0].src, '/api/logo/img/austrian.png');
  const lines = card.children.filter((c) => c.className === 'contact-hover-card-line').map((c) => c.textContent);
  assert.equal(lines[0], 'FL 137 · 4 214 m · stúpa', 'čitateľné riadky letu ako karta po kliknutí');
  assert.ok(card.children.some((c) => c.className === 'contact-hover-card-footer' && /Wikimedia/.test(c.textContent)), 'kredit lôg v päte');
  // zhasnutie zastaví obnovovanie
  updateContactHoverCard([], null, t);
  assert.equal(card.hidden, true);
  assert.ok(timers.filter((x) => x.ms === HOVER_REFRESH_MS).every((x) => x.fn === null || x === refresh), 'žiadne ďalšie obnovovanie po zhasnutí');
  _resetContactHoverCardForTest();
});

test('lietadlá: súhrn pod kurzorom nesie čitateľné riadky, vietor a logá ako karta po kliknutí (flights.js)', () => {
  const src = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.ok(src.includes('...hoverExtras(icao24, info),'));
  assert.match(src, /function hoverExtras\(icao24, info\) \{[\s\S]*?formatFlightLinesPlain\(flightState\)[\s\S]*?meteoLazy\.flightWindAt\([\s\S]*?contactLogosFor\(who\)/);
});

/** Stúpanie z letiska: 20 minút po minúte, 0 → 10 km, rýchlosť 80 → 230 m/s. */
function climbCharts() {
  const t0 = NOW - 20 * 60_000;
  const fixes = Array.from({ length: 21 }, (_, i) => ({
    t: Math.round((t0 + i * 60_000) / 1000),
    lat: 48.17 + i * 0.05,
    lon: 17.21 + i * 0.05,
    alt: i * 500,
    gs: 80 + i * 7.5,
  }));
  return { t0, fixes };
}

test('grafy pod kurzorom (vlastník 09-27: „mala tam byť aj rýchlosť, stúpanie, grafy"): SVG z čísel, prerušenie pri medzere, odhad čiarkovaný', async () => {
  const { hoverChartSvg, HOVER_CHART_W, HOVER_CHART_H } = await import('./contactHoverCard.js');
  const style = { color: 'rgb(57, 208, 255)', fill: 'rgba(57, 208, 255, 0.16)' };
  assert.equal(hoverChartSvg({ past: [null, 0.5, null] }, style), '', 'jeden bod nie je graf');
  const svg = hoverChartSvg({ past: [0, 0.5, null, null, 0.8, 1], future: [null, null, null, null, null, 1, 0.6, 0], xNow: 5 / 7 }, style);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes(`width="${HOVER_CHART_W}"`) && svg.includes(`height="${HOVER_CHART_H}"`));
  assert.equal((svg.match(/stroke-width="1\.5"/g) || []).length, 2, 'medzera v dátach = dva úseky, nie čiara cez ňu');
  assert.match(svg, /stroke-dasharray="3 2"/, 'odhad do pristátia čiarkovaný');
  assert.match(svg, /<circle /, 'bodka „teraz"');
  assert.doesNotMatch(svg, /<text|NaN/, 'len čísla a pevné farby');
  assert.doesNotMatch(hoverChartSvg({ past: [0.2, 0.4, 0.6] }, style), /dasharray/, 'bez odhadu žiadna čiarkovaná');
});

test('grafy pod kurzorom: model z buildFlightCharts, kartička ich dokreslí, keď dorazí história (bez pohybu myšou)', async () => {
  const { buildFlightCharts } = await import('./flightCharts.js');
  const { fixes } = climbCharts();
  const charts = buildFlightCharts({
    fixes,
    samples: [],
    now: { epochMs: NOW, altitudeM: 10_000, speedMps: 230, verticalRateMps: 8, lat: 49.17, lon: 18.21 },
    translate: t,
  });
  assert.ok(charts, 'z histórie vzniknú grafy');
  const model = hoverCardModel({ ...RICH, charts }, t, NOW);
  assert.ok(model.charts.altitude && model.charts.speed);
  assert.equal(model.charts.altitude.label, charts.altitude.label);
  assert.equal(model.charts.titles.altitude, charts.titles.altitude);
  assert.equal(hoverCardModel({ ...RICH, charts: null }, t, NOW).charts, null, 'bez histórie žiadny prázdny graf');
  assert.equal(hoverCardModel({ ...RICH, charts: { altitude: { past: [null, 1] }, speed: { past: [] } } }, t, NOW).charts, null);
  assert.ok(hoverCardLines({ ...RICH, charts }, t, NOW).lines.includes(charts.speed.label), 'popisky max · teraz aj v textovom pohľade');

  _resetContactHoverCardForTest();
  const makeEl = (tag) => ({
    tagName: tag, children: [], style: {}, hidden: false, className: '', attrs: {}, listeners: {},
    classList: { toggle() {}, contains() { return false; } },
    get textContent() { return this._text ?? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {},
    get offsetWidth() { return 200; }, get offsetHeight() { return 90; },
    get childNodes() { return this.children; },
    ownerDocument: null,
  });
  const doc = { createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; }, createTextNode: (x) => x, defaultView: { innerWidth: 1000, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  const summary = { ...RICH, charts: null };
  const timers = [];
  installContactHoverCard({
    container,
    resolveSummary: () => summary,
    lookupPhoto: async () => null,
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutImpl: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
  });
  const card = container.children[0];
  updateContactHoverCard([{ layerId: 'flights', sourceId: '4b1815' }], { x: 100, y: 100 }, t);
  assert.ok(!card.children.some((c) => c.className === 'contact-hover-card-charts'), 'história ešte nedorazila');
  summary.charts = charts;
  timers.filter((x) => x.ms === HOVER_REFRESH_MS && x.fn).at(-1).fn();
  const row = card.children.find((c) => c.className === 'contact-hover-card-charts');
  assert.ok(row, 'grafy sa dokreslili');
  assert.equal(row.children.length, 2, 'výška aj rýchlosť');
  const img = row.children[0].children.find((c) => c.tagName === 'img');
  assert.match(img.src, /^data:image\/svg\+xml,/);
  assert.ok(row.children[0].textContent.includes(charts.titles.altitude), 'názov grafu');
  const lines = card.children.filter((c) => c.className === 'contact-hover-card-line').map((c) => c.textContent);
  assert.ok(lines.includes(charts.altitude.label) && lines.includes(charts.speed.label), 'max · teraz pod grafmi');
  _resetContactHoverCardForTest();
});

test('tripwire: súhrn lietadla počíta grafy ako karta po kliknutí a zotrvanie si vypýta históriu letu (flights.js)', () => {
  const src = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(src, /function hoverExtras\(icao24, info\) \{[\s\S]*?buildFlightCharts\(\{\s*fixes: cachedTrackedHistory\(icao24\),\s*samples: _profileStore\.samples\(icao24\)/);
  assert.match(src, /return \{ flightLines, charts, logos, logoCredit:/);
  assert.match(src, /_requestRouteEnrichment\(icao24\);[\s\S]{0,300}void requestTrackedHistory\(icao24\);/);
});

test('preklady existujú v oboch jazykoch, kartička nechytá myš, iba odkaz s fotkou', () => {
  for (const key of ['hover.on-ground', 'hover.stale', 'card.km-left', 'card.fix', 'photo.credit']) {
    assert.ok(EN_STRINGS[key], `EN chýba ${key}`);
    assert.ok(SK_STRINGS[key], `SK chýba ${key}`);
  }
  // pointer-events: none je nosné — kartička sedí POD kurzorom a inak by
  // pohltila práve ten MOUSE_MOVE, ktorý ju drží nažive. Fotka je výnimka
  // (podmienka Planespotters: náhľad musí byť klikateľný odkaz).
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  const block = /\.contact-hover-card \{[\s\S]*?\}/.exec(css)?.[0] || '';
  assert.match(block, /pointer-events:\s*none/);
  const photoBlock = /\.contact-hover-card-photo \{[\s\S]*?\}/.exec(css)?.[0] || '';
  assert.match(photoBlock, /pointer-events:\s*auto/);
});

test('tripwire: zotrvanie nad strojom si pýta typ aj trasu cez vrstvu (ui.js → flights.prefetchContactDetails)', () => {
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /onDwell: \(\{ layerId, sourceId \}\) =>/);
  assert.match(ui, /prefetchContactDetails\?\.\(sourceId\)/);
  const flights = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(flights, /prefetchContactDetails\(id\) \{[\s\S]*?_requestRouteEnrichment\(icao24\);/);
});

test('tripwire: kartička žije nezávisle od prepínača DETEKCIA', async () => {
  // Zmysel celej featury: pri oddialenom pohľade sa dá zistiť identita stroja
  // aj so zhasnutými zameriavačmi. Keby kartičku niekto zavesil za detekciu,
  // vrátilo by to pôvodný stav, na ktorý používateľ upozornil.
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /installContactHoverCard\(\{/, 'kartička sa inštaluje z ui.js');
  assert.match(ui, /onHover: \(candidates, position\) => updateContactHoverCard/,
    'kŕmi ju hover pick, nie stav detekcie');
  const hover = readFileSync(new URL('./detectionHover.js', import.meta.url), 'utf8');
  assert.match(hover, /onHover\?\.\(candidates, position\)/, 'jeden pick, dvaja konzumenti');
  assert.match(hover, /onHover\?\.\(\[\], null\)/, 'odchod myši z canvasu kartičku zhasne');
});

test('loď (2026-09-12): súhrn z aisLiveVessels.getContactSummary sa vykreslí bez vlastnej vetvy a bez surového i18n kľúča', () => {
  const model = hoverCardModel({
    layerId: 'ais-live-vessels', id: '244660815', callsign: 'VLISSINGEN', registration: 'PBXY',
    operator: 'UNDER WAY', type: 'CARGO · 121 m', category: null, military: false, onGround: false,
    altitudeM: null, speedMps: 14.53 * 0.514444, verticalRateMps: null, trackDeg: 231.2,
    routeInfo: null, progress: null, route: '→ ROTTERDAM', flightIata: null,
    source: 'AISStream', lastContactEpochMs: NOW - 9_000, stale: false, squawk: null, countryIso: 'NL', originCountry: 'Netherlands',
  }, t, NOW);
  assert.equal(model.title, 'VLISSINGEN');
  assert.equal(model.titleFlag, 'nl', 'resolveFlagIso2 normalizuje na malé písmená');
  assert.match(model.details[0], /^\d+ kts \(\d+ km\/h\) · 231° \(SW\)$/, 'rýchlosť v oboch jednotkách · kurz so svetovou stranou, bez hladiny');
  assert.equal(model.details[1], 'UNDER WAY · CARGO · 121 m · PBXY');
  assert.equal(model.route, null);
  assert.equal(model.routeText, '→ ROTTERDAM');
  assert.equal(model.progress, null);
  assert.match(model.footer[0], /^AISStream · /);
  assert.equal(model.hex, null, 'hex je len pre lietadlá');
  assert.equal(model.alert, null);
  const text = JSON.stringify(model);
  assert.ok(!text.includes('aircraft.category'), 'typ lode je vždy neprázdny, kategória lietadla sa nevolá');
  const lines = hoverCardLines({
    layerId: 'ais-live-vessels', id: '353136000', callsign: '353136000', type: 'VESSEL', category: null,
    speedMps: null, trackDeg: null, stale: true, source: 'AISStream',
  }, t, NOW);
  assert.equal(lines.title, '353136000');
  assert.ok(lines.lines.includes(t('hover.stale')), 'posledná známa poloha = „bez fixu"');
});
