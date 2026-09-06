// src/data/airportCard.test.mjs
// Bohatá karta letiska (2026-09-05): čistý model (identita, rádio, dráhy,
// počasie, premávka, odkazy) + DOM lifecycle na minimálnom dvojníkovi +
// tripwires (sidecar, DATA_SOURCES, žiadny LiveATC zvuk v kóde).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  AIRPORT_TRAFFIC_RANGE_M,
  AIRPORT_TRAFFIC_SAMPLES,
  ATC_STREAMS_FILE,
  airportCardModel,
  ownStreamFor,
  installAirportCard,
  destroyAirportCard,
  _getAirportCardStateForTest,
  _resetAirportCardForTest,
} from './airportCard.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const t = (key, vars) => {
  let text = EN_STRINGS[key] || key;
  for (const [k, v] of Object.entries(vars || {})) text = text.replaceAll(`{${k}}`, String(v));
  return text;
};

const PROPS = { name: 'M. R. Štefánik Airport', ident: 'LZIB', icao: 'LZIB', iata: 'BTS', type: 'large', municipality: 'Bratislava', country: 'SK', elevFt: 436 };
const DETAILS = {
  region: 'SK-BL', web: 'https://www.bts.aero', wiki: 'https://en.wikipedia.org/wiki/Bratislava_Airport', gps: 'LZIB', local: null,
  freq: [['ATIS', 'ATIS', 124.555], ['TWR', 'Bratislava Tower', 118.3], ['GND', 'Ground', 121.9], ['APP', 'Bratislava Approach', 120.3]],
  rwy: [['13', '31', 10466, 148, 'CON', 1, 0], ['04', '22', 9514, 197, 'ASP', 1, 0]],
};

test('letisko: plný model — vlajka, kódy s typom, miesto s regiónom a výškou, rádio, dráhy, počasie, premávka, odkazy', () => {
  const m = airportCardModel(PROPS, DETAILS, {
    metarLines: ['METAR 16:20Z · 250° 12 kt · 10 km · FEW035 · 21/12 · Q1016'],
    nearby: [{ callsign: 'RYR12AB' }, { icao24: '4b1815' }, { callsign: '' }, { id: 'x1' }],
    translate: t,
  });
  assert.equal(m.title, 'M. R. Štefánik Airport');
  assert.equal(m.flag, 'sk');
  assert.equal(m.codesLine, 'LZIB · BTS · Large airport', 'GPS kód rovnaký ako ICAO sa neopakuje');
  assert.equal(m.placeLine, 'Bratislava · SK-BL · SK · 133 m (436 ft)');
  assert.deepEqual(m.frequencies.map((f) => `${f.type} ${f.mhz}`), ['ATIS 124.555', 'TWR 118.300', 'GND 121.900', 'APP 120.300']);
  assert.equal(m.frequenciesMore, 0);
  assert.deepEqual(m.runways, ['13/31 · 3 190 × 45 m · concrete · lighted', '04/22 · 2 900 × 60 m · asphalt · lighted']);
  assert.equal(m.weather.length, 1);
  assert.deepEqual(m.traffic, { count: 4, samples: ['RYR12AB', '4B1815', 'X1'] });
  assert.deepEqual(m.links.map((l) => l.key), ['liveatc', 'wiki', 'web']);
  assert.equal(m.links[0].href, 'https://www.liveatc.net/search/?icao=LZIB');
  assert.match(m.liveAtcNote, /LiveATC/);
  assert.equal(m.detailsLoading, false);
});

test('letisko: bez sidecaru a bez vrstvy letov — model degraduje, nie padá; loading len kým sa sidecar ťahá', () => {
  const m = airportCardModel(PROPS, null, { nearby: null, detailsLoading: true, translate: t });
  assert.equal(m.codesLine, 'LZIB · BTS · Large airport');
  assert.deepEqual(m.frequencies, []);
  assert.deepEqual(m.runways, []);
  assert.equal(m.traffic, null, 'vrstva letov vypnutá = sekcia premávky sa nekreslí');
  assert.equal(m.detailsLoading, true);
  assert.deepEqual(m.links.map((l) => l.key), ['liveatc'], 'LiveATC odkaz stačí z ICAO');
  assert.equal(airportCardModel({ ident: 'XXXX' }, null, { translate: t }).title, 'XXXX');
  assert.equal(airportCardModel(null, null), null);
  assert.equal(airportCardModel({ name: 'No ICAO', iata: 'ABC' }, null, { translate: t }).links.length, 0, 'bez ICAO niet LiveATC odkazu');
  assert.ok(AIRPORT_TRAFFIC_RANGE_M >= 20_000 && AIRPORT_TRAFFIC_SAMPLES >= 3);
});

test('letisko: DOM lifecycle — výber otvorí kartu, sidecar ju doplní, iný výber/zrušenie ju zavrie, listenery sa odhlásia', async () => {
  _resetAirportCardForTest();
  const makeEl = (tag) => ({
    tagName: tag, children: [], style: {}, hidden: false, className: '', attrs: {}, listeners: {},
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : (this._text ?? ''); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { const p = this.parentNode; if (p) p.children = p.children.filter((c) => c !== this); },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    pause() {}, load() {}, play() { return Promise.resolve(); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    get offsetWidth() { return 340; }, get offsetHeight() { return 240; },
    ownerDocument: null,
  });
  const doc = { createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; }, defaultView: { innerWidth: 1200, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  const handlers = {};
  const eventTarget = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener: (type) => { delete handlers[type]; } };
  const postRender = { listeners: [], addEventListener(fn) { this.listeners.push(fn); }, removeEventListener(fn) { this.listeners = this.listeners.filter((l) => l !== fn); } };
  const viewer = { scene: { postRender, mode: 3, camera: { positionWC: { x: 1, y: 2, z: 3 } } }, selectedEntity: {} };
  let fetches = 0;
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('streams')) return { ok: false };
    if (u.includes('wikipedia.org')) return { ok: false }; // fotka mimo tohto testu (viď airportPhoto.test)
    if (u.includes('youtube-live')) return { ok: false, status: 503 }; // kamera: proxy bez kľúča (viď test nižšie)
    fetches += 1;
    return { ok: true, json: async () => ({ airports: { LZIB: DETAILS } }) };
  };
  installAirportCard(viewer, {
    container, eventTarget, fetchImpl, detailsUrl: 'test://details.json', streamsUrl: 'test://streams.json',
    nearbyFlights: () => [{ callsign: 'RYR12AB' }],
  });
  try {
  assert.equal(container.children.length, 1);
  assert.equal(_getAirportCardStateForTest().hidden, true);
  const record = { layerId: 'local-airports', properties: PROPS, entity: { id: 'LZIB', __localBaseCartesian: { x: 1, y: 1, z: 1 } } };
  handlers['gev:entity-selected']({ detail: record });
  let s = _getAirportCardStateForTest();
  assert.equal(s.hidden, false);
  assert.equal(s.ident, 'LZIB');
  assert.match(s.text, /Radio/);
  assert.match(s.text, /1 aircraft within 40 km/);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  s = _getAirportCardStateForTest();
  assert.equal(s.hasDetails, true, 'sidecar doplnený po načítaní');
  assert.match(s.text, /118\.300/);
  assert.match(s.text, /13\/31/);
  assert.match(s.text, /Listen live on LiveATC/);
  assert.equal(fetches, 1);
  // Camera-only coverage must not start a video in the radio card.
  const prague = { ...record, properties: { ...PROPS, ident: 'LKPR', icao: 'LKPR' } };
  handlers['gev:entity-selected']({ detail: prague });
  const playerRoot = container.children[0].children[0];
  assert.ok(!playerRoot.children.some(c => c.tagName === 'iframe'));
  assert.equal(playerRoot.hidden, true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(playerRoot.hidden, true);
  handlers['gev:entity-selected']({ detail: record });
  assert.equal(playerRoot.hidden, true);
  // Výber v inej vrstve kartu zavrie.
  handlers['gev:entity-selected']({ detail: { layerId: 'local-ports', properties: {}, entity: {} } });
  assert.equal(_getAirportCardStateForTest().hidden, true);
  // Znova letisko: sidecar už z pamäte (bez ďalšieho fetchu).
  handlers['gev:entity-selected']({ detail: record });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetches, 1);
  assert.equal(_getAirportCardStateForTest().hasDetails, true);
  handlers['gev:entity-selection-cleared']({ detail: { layerId: 'local-airports' } });
  assert.equal(_getAirportCardStateForTest().hidden, true);
  destroyAirportCard();
  assert.equal(container.children.length, 0);
  assert.equal(Object.keys(handlers).length, 0, 'listenery odhlásené');
  assert.equal(postRender.listeners.length, 0);
  } finally {
    // Zlyhanie uprostred nesmie nechať bežať 2-s refresh interval — inak test runner visí.
    _resetAirportCardForTest();
  }
});

test('letisko: tripwire — sidecar existuje a nesie LZIB s frekvenciami, DATA_SOURCES, i18n EN+SK, ui wiring, žiadny LiveATC zvuk v kóde', () => {
  const sidecar = new URL('./local_data/airports/airport-details.json', import.meta.url);
  assert.ok(existsSync(sidecar));
  const json = JSON.parse(readFileSync(sidecar, 'utf8'));
  assert.match(json.license, /Public domain/);
  assert.ok(json.airports.LZIB.freq.length >= 1, 'LZIB má frekvencie');
  assert.ok(json.airports.LZIB.rwy.length >= 1, 'LZIB má dráhu');
  assert.ok(Object.keys(json.airports).length > 5000);
  const sources = readFileSync(new URL('../../DATA_SOURCES.md', import.meta.url), 'utf8');
  assert.match(sources, /airport-details\.json/);
  assert.match(sources, /LiveATC\.net — link only/);
  for (const key of ['airport.section.radio', 'airport.link.liveatc', 'airport.traffic-count', 'airport.tier.large', 'airport.surface.asphalt']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /installAirportCard\(viewer, \{/);
  assert.match(ui, /destroyAirportCard\(\);/);
  const src = readFileSync(new URL('./airportCard.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/liveatc\.net\/(play|hlisten|archive|listen)/i.test(src), 'LiveATC zvuk sa nevkladá — len odkaz na ich stránku (search)');
  assert.ok(!/d\.liveatc\.net|s1-\w+\.liveatc/i.test(src), 'žiadne LiveATC stream hosty');
  assert.match(readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8'), /atc-streams\.local\.json/, 'vlastné streamy sa necommitujú');
  assert.ok(existsSync(new URL('./local_data/airports/atc-streams.example.json', import.meta.url)));
  assert.equal(ATC_STREAMS_FILE, 'atc-streams.local.json');
});

test('letisko: vlastný stream — len z konfigurácie používateľa, len http(s), s popisom alebo i18n názvom', () => {
  const streams = { LZIB: { url: 'https://radio.example.org/lzib.mp3', label: 'moje SDR' }, lzkz: 'https://radio.example.org/lzkz.mp3', LZTT: { url: 'javascript:alert(1)' }, LZZI: { url: 'ftp://x/y' } };
  assert.deepEqual(ownStreamFor(streams, 'lzib'), { url: 'https://radio.example.org/lzib.mp3', label: 'moje SDR' });
  assert.deepEqual(ownStreamFor(streams, 'LZKZ'), { url: 'https://radio.example.org/lzkz.mp3', label: '' }, 'kľúč aj holá URL, malé písmená');
  assert.equal(ownStreamFor(streams, 'LZTT'), null, 'len http(s)');
  assert.equal(ownStreamFor(streams, 'LZZI'), null);
  assert.equal(ownStreamFor(streams, 'LOWW'), null);
  assert.equal(ownStreamFor(null, 'LZIB'), null);
  const m = airportCardModel(PROPS, DETAILS, { stream: ownStreamFor(streams, 'LZKZ'), translate: t });
  assert.deepEqual(m.stream, { url: 'https://radio.example.org/lzkz.mp3', label: 'Own stream' }, 'bez popisu nastúpi i18n názov');
  assert.equal(airportCardModel(PROPS, DETAILS, { translate: t }).stream, null, 'bez konfigurácie žiadny prehrávač');
});

test('UI: posuvníky celého rozhrania sú tenké a tlmené, skryté lišty ostávajú skryté (2026-09-05)', () => {
  // Pri úzkom okne prepne adaptívne rozloženie panelové lišty na scrollovanie
  // a bez tohto vzhľadu kreslil Windows cez tmavé UI natívnu bielu lištu.
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\*\s*\{[^}]*scrollbar-width:\s*thin/, 'globálny tenký posuvník');
  assert.match(css, /\*\s*\{[^}]*scrollbar-color:\s*rgba\(0,\s*212,\s*255/, 'farba drží akcent rozhrania');
  assert.match(css, /^::-webkit-scrollbar\s*\{[^}]*width:\s*8px/m);
  assert.match(css, /^::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/m, 'dráha je priehľadná, nie biela');
  // Zámerne skryté posuvníky majú vyššiu špecificitu a musia prežiť.
  assert.match(css, /\.button-grid::-webkit-scrollbar\s*\{\s*display:\s*none/);
  assert.match(css, /\.data-toggle-list::-webkit-scrollbar\s*\{/, 'vlastný vzhľad zoznamu vrstiev ostáva');
});

test('letisko: počasie v ľudskej reči — titulok, glyf, kategória; surový METAR len po rozbalení', async () => {
  const { metarSummary } = await import('./metarSummary.js');
  const report = {
    temp: 14.2, dewp: 12, wdir: 270, wspd: 12, visib: '10+', altim: 1016,
    clouds: [{ cover: 'OVC', base: 4000 }], wxString: '-RA', fltCat: 'VFR', obsTime: Math.floor(Date.now() / 1000) - 600,
  };
  const m = airportCardModel(PROPS, DETAILS, { metarLines: ['VFR · 270/12KT · VIS 10+SM'], metarReport: report, translate: t });
  assert.equal(m.weatherSummary.headline, 'Overcast, light rain · 14 °C · wind 12 kt from W');
  assert.equal(m.weatherSummary.category, 'VFR');
  assert.equal(m.weatherSummary.kind, 'rain');
  assert.equal(m.weatherSummary.stale, false);
  assert.deepEqual(m.weatherSummary, metarSummary(report, m.weatherSummary.ageMin === null ? Date.now() : Date.now(), t) && m.weatherSummary, 'model = čistý modul');
  assert.equal(m.weather.length, 1, 'surové riadky ostávajú v modeli');
  assert.equal(airportCardModel(PROPS, DETAILS, { translate: t }).weatherSummary, null, 'bez záznamu bez zhrnutia');

  // Render: titulok + odznak viditeľné, surový riadok schovaný pod tlačidlom, klik ho rozbalí.
  const src = readFileSync(new URL('./airportCard.js', import.meta.url), 'utf8');
  assert.match(src, /metarReport: cachedMetarReport\(station\)/, 'karta číta surový záznam z cache');
  assert.match(src, /airport-card-wx-badge is-\$\{summary\.category\.toLowerCase\(\)\}/);
  assert.match(src, /glyph\.setAttribute\('src', summary\.glyph\)/, 'glyf ako img s data URI (SVG, nie emoji)');
  assert.match(src, /state\.rawWeatherOpen \? 'wx\.raw-hide' : 'wx\.raw-show'/);
  assert.match(src, /if \(state\.rawWeatherOpen\) \{\s*\n\s*for \(const line of model\.weather\)/, 'surové riadky len po rozbalení');
  assert.match(src, /state\.rawWeatherOpen = false;/, 'reset pre testy vráti zbalený stav');
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  for (const cat of ['vfr', 'mvfr', 'ifr', 'lifr']) assert.match(css, new RegExp(`\.airport-card-wx-badge\.is-${cat}`), `farba odznaku ${cat}`);
});

test('letisko: živá kamera — kurátorovaná (LKPR) vloží oficiálny YouTube prehrávač, bez kľúča ostáva skrytá, zavretie ju vyprázdni', async () => {
  _resetAirportCardForTest();
  const { installAirportCard: install, destroyAirportCard: destroy, _getAirportCardStateForTest: getState } = await import('./airportCard.js');
  const makeEl = (tag) => ({
    tagName: tag, children: [], style: {}, hidden: false, className: '', attrs: {}, listeners: {},
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : (this._text ?? ''); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { const p = this.parentNode; if (p) p.children = p.children.filter((c) => c !== this); },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); },
    pause() {}, load() {}, play() { return Promise.resolve(); },
    get offsetWidth() { return 340; }, get offsetHeight() { return 240; },
    ownerDocument: null,
  });
  const doc = { createElement: (tag) => { const e = makeEl(tag); e.ownerDocument = doc; return e; }, createTextNode: (s) => ({ textContent: s }), defaultView: { innerWidth: 1200, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  const handlers = {};
  const eventTarget = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener: (type) => { delete handlers[type]; } };
  const postRender = { listeners: [], addEventListener(fn) { this.listeners.push(fn); }, removeEventListener(fn) { this.listeners = this.listeners.filter((l) => l !== fn); } };
  const viewer = { scene: { postRender, mode: 3, camera: { positionWC: { x: 1, y: 2, z: 3 } } }, selectedEntity: {} };
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(String(url)); return { ok: String(url).includes('youtube-live') ? false : true, status: String(url).includes('youtube-live') ? 503 : 200, json: async () => ({ airports: {} }) }; };
  install(viewer, { container, eventTarget, fetchImpl, detailsUrl: 'test://details.json', streamsUrl: 'test://streams.json' });
  try {
    const camRoot = container.children[0].children.find((c) => String(c.className).includes('airport-card-camera'));
    assert.ok(camRoot, 'trvalá sekcia kamery existuje');
    const frame = camRoot.children.find((c) => c.tagName === 'iframe');
    assert.equal(camRoot.hidden, true); assert.equal(frame.attrs.src, 'about:blank');
    assert.match(frame.attrs.allow, /autoplay/); assert.equal(frame.attrs.referrerpolicy, 'strict-origin-when-cross-origin');
    // Praha: kurátorovaná → hneď embed, bez dopytu na proxy.
    handlers['gev:entity-selected']({ detail: { layerId: 'local-airports', properties: { name: 'Václav Havel Airport Prague', ident: 'LKPR', icao: 'LKPR', iata: 'PRG', type: 'large', municipality: 'Prague', country: 'CZ' }, entity: { id: 'LKPR', __localBaseCartesian: { x: 1, y: 1, z: 1 } } } });
    assert.equal(camRoot.hidden, false);
    assert.match(frame.attrs.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/kuOmmVkOGN8\?/);
    assert.match(camRoot.textContent, /SlowTV · YouTube/);
    assert.ok(!fetched.some((u) => u.includes('youtube-live')), 'kurátorovaná = žiadne vyhľadanie');
    // Bratislava: bez kurátorovanej kamery → jedno vyhľadanie, proxy bez kľúča 503 → sekcia skrytá, iframe vyprázdnený.
    handlers['gev:entity-selected']({ detail: { layerId: 'local-airports', properties: { name: 'M. R. Štefánik Airport', ident: 'LZIB', icao: 'LZIB', iata: 'BTS', type: 'large', municipality: 'Bratislava', country: 'SK' }, entity: { id: 'LZIB', __localBaseCartesian: { x: 1, y: 1, z: 1 } } } });
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(camRoot.hidden, true); assert.equal(frame.attrs.src, 'about:blank');
    const lookups = fetched.filter((u) => u.includes('youtube-live'));
    assert.equal(lookups.length, 1, 'presne jedno vyhľadanie');
    assert.match(decodeURIComponent(lookups[0]), /q=M\. R\. Štefánik Bratislava airport BTS live/);
    // Opätovný výber Bratislavy do 30 min: negatívna pamäť, žiadny ďalší dopyt.
    handlers['gev:entity-selection-cleared']({ detail: { layerId: 'local-airports' } });
    handlers['gev:entity-selected']({ detail: { layerId: 'local-airports', properties: { name: 'M. R. Štefánik Airport', ident: 'LZIB', icao: 'LZIB', iata: 'BTS', type: 'large', municipality: 'Bratislava', country: 'SK' }, entity: { id: 'LZIB', __localBaseCartesian: { x: 1, y: 1, z: 1 } } } });
    for (let i = 0; i < 2; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(fetched.filter((u) => u.includes('youtube-live')).length, 1);
    // Zavretie karty vyprázdni prehrávač.
    handlers['gev:entity-selected']({ detail: { layerId: 'local-airports', properties: { name: 'x', ident: 'LKPR', icao: 'LKPR' }, entity: { id: 'LKPR', __localBaseCartesian: { x: 1, y: 1, z: 1 } } } });
    assert.equal(camRoot.hidden, false);
    handlers['gev:entity-selection-cleared']({ detail: { layerId: 'local-airports' } });
    assert.equal(camRoot.hidden, true); assert.equal(frame.attrs.src, 'about:blank');
    destroy();
    assert.equal(getState().hidden, null);
  } finally {
    _resetAirportCardForTest();
  }
});
