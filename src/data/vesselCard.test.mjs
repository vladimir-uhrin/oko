// src/data/vesselCard.test.mjs
// Karta lode 2026-10-10 (vlastník poslal kartu cudzieho prehliadača lodí:
// „máme toto?" → „áno doplň aj fotky"): kurz/smer zvlášť, otáčanie, IMO,
// trieda, rozmery, miestny čas, register (podrobný typ, rok, GT, DWT) a fotka
// cez náš proxy /api/vessel-info. Testuje sa SPRÁVANIE, nie text zdrojáku.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  formatRateOfTurn,
  groupThousands,
  localizedTypeDetail,
  nauticalZoneOffsetH,
  vesselHullParts,
  vesselLocalTimeLabel,
  vesselMotionParts,
  vesselRegistryParts,
} from './vesselCardDetails.js';
import { AIS_ROT_FAST_DEG_PER_MIN } from './aisIngest.js';
import { cachedVesselInfo, lookupVesselInfo, lookupVesselPhoto, _resetVesselInfoForTest, _setVesselInfoFetchForTest, VESSEL_INFO_RETRY_MS } from './vesselInfo.js';
import { normalizeVesselInfo, parseMmsi, parsePhotoId, publicVesselInfo, vesselInfoProxy } from './vesselInfoProxy.js';
import { hoverCardModel, installContactHoverCard, updateContactHoverCard, _resetContactHoverCardForTest, HOVER_PHOTO_DEBOUNCE_MS } from './contactHoverCard.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const tr = (dict) => (key, vars) => {
  let text = dict[key] || key;
  for (const [k, v] of Object.entries(vars || {})) text = text.replaceAll(`{${k}}`, String(v));
  return text;
};
const sk = tr(SK_STRINGS);
const en = tr(EN_STRINGS);

// Skutočná odpoveď registra pre MINERVA ZEN (2026-10-10), skrátená.
const REGISTRY_JSON = {
  country: 'Greece', imo: 9410909, pic: '9410909-241190000-7c65852ce751b8fe58a25836c460e4cd',
  dest: 'WILMINGTON.NC.USA', type: 'Chemical/Oil Products Tanker', dw: 52941, gt: 29442,
  al: 183, aw: 32, name: 'MINERVA ZEN', y: 2009,
};

test('rýchlosť otáčania: smer, nula a „> 10" bez vymysleného čísla', () => {
  assert.equal(formatRateOfTurn(null, sk), null);
  assert.equal(formatRateOfTurn(0, sk), '0°/min');
  assert.equal(formatRateOfTurn(4.5, sk, 'sk'), '4,5°/min vpravo');
  assert.equal(formatRateOfTurn(-4.5, en, 'en'), '4.5°/min left');
  assert.equal(formatRateOfTurn(AIS_ROT_FAST_DEG_PER_MIN, sk), '> 10°/min vpravo');
  assert.equal(formatRateOfTurn(-AIS_ROT_FAST_DEG_PER_MIN, sk), '> 10°/min vľavo');
});

test('miestny čas lode: námorné pásmo z dĺžky', () => {
  assert.equal(nauticalZoneOffsetH(-74.2), -5, 'pri pobreží USA UTC−5 ako na predlohe');
  assert.equal(nauticalZoneOffsetH(17.1), 1);
  assert.equal(nauticalZoneOffsetH(179.9), 12);
  assert.equal(nauticalZoneOffsetH(-179.9), -12);
  assert.equal(nauticalZoneOffsetH(NaN), null);
  assert.equal(nauticalZoneOffsetH(200), null);
  const now = Date.parse('2026-10-10T02:57:00Z');
  assert.equal(vesselLocalTimeLabel(-74.2, now), '21:57 (UTC−5)', 'cez polnoc späť');
  assert.equal(vesselLocalTimeLabel(3, now), '02:57 (UTC)');
  assert.equal(vesselLocalTimeLabel(56, now), '06:57 (UTC+4)');
});

test('pohyb: kurz a smer prídy zvlášť, sentinely ani neznáme hodnoty sa nekreslia', () => {
  assert.deepEqual(vesselMotionParts({ course: 253, heading: 252, rateOfTurn: 0 }, sk, 'sk'), ['kurz 253°', 'smer prídy 252°', 'otáčanie 0°/min']);
  assert.deepEqual(vesselMotionParts({ course: 360, heading: 511, rateOfTurn: null }, sk), [], '360/511 = nedostupné');
  assert.deepEqual(vesselMotionParts({ course: 10 }, en), ['COG 10°']);
});

test('trup: IMO, trieda, rozmery a ponor; IMO a rozmery doplní register', () => {
  assert.deepEqual(
    vesselHullParts({ imo: '9410909', aisClass: 'A', lengthM: 183, beamM: 32, draughtM: 11 }, null, sk, 'sk'),
    ['IMO 9410909', 'AIS trieda A', '183 × 32 m', 'ponor 11,0 m'],
  );
  const fromRegistry = vesselHullParts({ imo: '', aisClass: '' }, normalizeVesselInfo('241190000', REGISTRY_JSON), en, 'en');
  assert.deepEqual(fromRegistry, ['IMO 9410909', '183 × 32 m']);
  assert.deepEqual(vesselHullParts({ imo: '0', aisClass: 'X', lengthM: 0 }, null, en), [], 'IMO 0 a nezmysly sa nekreslia');
});

test('register: podrobný typ po slovensky, rok, GT, DWT s oddeľovačom tisícov', () => {
  const info = normalizeVesselInfo('241190000', REGISTRY_JSON);
  assert.deepEqual(vesselRegistryParts(info, sk, 'sk'), [
    'Tanker na chemikálie a ropné produkty', 'postavená 2009', 'GT 29 442', 'DWT 52 941 t',
  ]);
  assert.equal(localizedTypeDetail('Some Rare Type', 'sk'), 'Some Rare Type', 'neznámy typ ostáva v origináli');
  assert.equal(localizedTypeDetail('Crude Oil Tanker', 'en'), 'Crude Oil Tanker');
  assert.equal(groupThousands(1234567), '1 234 567');
  assert.deepEqual(vesselRegistryParts(null, sk), []);
});

test('proxy: MMSI a identifikátor fotky sa overujú, prázdny záznam registra je „empty"', () => {
  assert.equal(parseMmsi('241190000'), '241190000');
  assert.equal(parseMmsi('000000000'), null);
  assert.equal(parseMmsi('24119000'), null);
  assert.equal(parseMmsi('../etc/pas'), null);
  assert.equal(parsePhotoId('9410909-241190000-7c65852ce751b8fe58a25836c460e4cd'), '9410909-241190000-7c65852ce751b8fe58a25836c460e4cd');
  assert.equal(parsePhotoId('../../x'), null);
  const info = normalizeVesselInfo('241190000', REGISTRY_JSON);
  assert.equal(info.imo, '9410909');
  assert.equal(info.typeDetail, 'Chemical/Oil Products Tanker');
  assert.equal(info.empty, false);
  // Skutočná odpoveď pre loď mimo registra (nemecké MMSI, 2026-10-10).
  const unknown = normalizeVesselInfo('211331640', { ss: -1, country: 'Germany', imo: 0, al: 0, pic: '', type: 'unknown type', name: '211331640', y: 0, gt: 0 });
  assert.equal(unknown.empty, true);
  assert.equal(unknown.name, null, 'MMSI ako meno nie je meno');
  const pub = publicVesselInfo(info);
  assert.equal(pub.photo.src, '/api/vessel-info/photo?mmsi=241190000&size=1', 'prehliadač volá len nás');
  assert.equal('photoId' in pub, false, 'cudzí identifikátor von nejde');
});

function fakeRes() {
  return {
    status: 0, headers: {}, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

test('proxy: register a fotka sa kešujú na disku, upstream ide raz', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-vessel-info-'));
  const calls = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/click/')) return { ok: true, status: 200, json: async () => REGISTRY_JSON };
    if (url.includes('/vessels/details/')) return { ok: true, status: 200, text: async () => '<div>Last Port</div><div>Saint Petersburg, Russia</div><div>ATD: Sep 22, 20:32 UTC</div>' };
    return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpeg };
  };
  const plugin = vesselInfoProxy({ root, fetchImpl, log: () => {} });
  const req = (url) => ({ method: 'GET', url, headers: {}, socket: { remoteAddress: '127.0.0.1' } });
  try {
    let res = fakeRes();
    await plugin._handler(req('/?mmsi=241190000'), res);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.imo, '9410909');
    assert.equal(body.yearBuilt, 2009);
    assert.equal(body.photo.src, '/api/vessel-info/photo?mmsi=241190000&size=1');
    assert.equal(body.voyage.lastPort, 'Saint Petersburg');
    assert.equal(body.destination, 'WILMINGTON.NC.USA');
    res = fakeRes();
    await plugin._handler(req('/?mmsi=241190000'), res);
    assert.equal(res.headers['X-OKO-Source'], 'cache');
    res = fakeRes();
    await plugin._handler(req('/photo?mmsi=241190000&size=1'), res);
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Type'], 'image/jpeg');
    assert.deepEqual(res.body, jpeg);
    res = fakeRes();
    await plugin._handler(req('/photo?mmsi=241190000&size=1'), res);
    assert.equal(res.headers['X-OKO-Source'], 'cache');
    assert.equal(calls.length, 3, 'register, stránka plavby, fotka — každé raz');
    assert.match(calls[1], /vessels\/details\/9410909$/);
    assert.match(calls[2], /9410909-241190000-7c65852ce751b8fe58a25836c460e4cd\/1$/);
    res = fakeRes();
    await plugin._handler(req('/?mmsi=abc'), res);
    assert.equal(res.status, 400);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('proxy: loď bez fotky = 404, chyba upstream = 502 bez pádu', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-vessel-info-'));
  const plugin = vesselInfoProxy({
    root,
    log: () => {},
    fetchImpl: async (url) => (url.endsWith('999999999')
      ? { ok: false, status: 500 }
      : { ok: true, status: 200, json: async () => ({ imo: 1234567, pic: '', type: 'Tug', name: 'X' }) }),
  });
  const req = (url) => ({ method: 'GET', url, headers: {}, socket: {} });
  try {
    let res = fakeRes();
    await plugin._handler(req('/photo?mmsi=211000001'), res);
    assert.equal(res.status, 404);
    res = fakeRes();
    await plugin._handler(req('/?mmsi=999999999'), res);
    assert.equal(res.status, 502);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('klient: jeden dopyt na loď, súbežné sa zlúčia, po zlyhaní pauza', async () => {
  _resetVesselInfoForTest();
  let now = 1_000_000;
  const urls = [];
  let fail = true;
  _setVesselInfoFetchForTest(async (url) => {
    urls.push(url);
    if (fail) return { ok: false, status: 502 };
    return { ok: true, json: async () => publicVesselInfo(normalizeVesselInfo('241190000', REGISTRY_JSON)) };
  }, () => now);
  assert.equal(cachedVesselInfo('241190000'), undefined);
  assert.equal(await lookupVesselInfo('241190000'), null);
  assert.equal(await lookupVesselInfo('241190000'), null, 'v pauze bez dopytu');
  assert.equal(urls.length, 1);
  fail = false;
  now += VESSEL_INFO_RETRY_MS + 1;
  const [a, b] = await Promise.all([lookupVesselInfo('241190000'), lookupVesselInfo('241190000')]);
  assert.equal(urls.length, 2, 'súbežné dopyty zlúčené');
  assert.equal(a, b);
  assert.equal(a.imo, '9410909');
  assert.equal(cachedVesselInfo('241190000').imo, '9410909');
  const photo = await lookupVesselPhoto('241190000');
  assert.deepEqual(photo, { kind: 'vessel', src: '/api/vessel-info/photo?mmsi=241190000&size=1', link: '/api/vessel-info/photo?mmsi=241190000&size=1' });
  assert.equal(urls.length, 2);
  assert.equal(await lookupVesselInfo('nie-mmsi'), null);
  _resetVesselInfoForTest();
});

test('kartička pod kurzorom: lodné riadky a fotka lode cez register, nie Planespotters', async () => {
  _resetContactHoverCardForTest();
  const summary = {
    layerId: 'ais-live-vessels', id: '241190000', callsign: 'MINERVA ZEN', registration: 'SVBN3',
    operator: 'UNDER WAY', type: 'Tanker · 183 m', category: null,
    flightLines: ['13,1 kn · kurz 253° · smer prídy 252° · otáčanie 0°/min'],
    extraLines: ['IMO 9410909 · AIS trieda A', 'Miestny čas 21:57 (UTC−5)'],
    photoKey: 'vessel:241190000', source: 'AISStream',
  };
  const model = hoverCardModel(summary, sk, Date.now());
  assert.equal(model.photoKey, 'vessel:241190000');
  assert.equal(model.hex, null);
  assert.deepEqual(model.details, [
    '13,1 kn · kurz 253° · smer prídy 252° · otáčanie 0°/min',
    'UNDER WAY · Tanker · 183 m · SVBN3',
    'IMO 9410909 · AIS trieda A',
    'Miestny čas 21:57 (UTC−5)',
  ]);
  assert.equal(hoverCardModel({ ...summary, photoKey: 'vessel:../x' }, sk).photoKey, null, 'neplatný kľúč fotky sa zahodí');

  const makeEl = (tag) => ({
    tagName: tag, children: [], style: {}, hidden: false, className: '', attrs: {}, listeners: {},
    classList: {
      add(name) { this._m = this._m || new Set(); this._m.add(name); },
      toggle(name, on) { this._m = this._m || new Set(); on ? this._m.add(name) : this._m.delete(name); },
      contains(name) { return Boolean(this._m?.has(name)); },
    },
    get textContent() { return this._text ?? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); if (typeof c !== 'string') c.parentNode = this; return c; },
    remove() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    get offsetWidth() { return 200; }, get offsetHeight() { return 90; },
    ownerDocument: null,
  });
  const doc = { createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; }, createTextNode: (x) => x, defaultView: { innerWidth: 1000, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  const timers = [];
  const planespotters = [];
  const vessels = [];
  installContactHoverCard({
    container,
    resolveSummary: () => summary,
    lookupPhoto: async (hex) => { planespotters.push(hex); return null; },
    lookupVesselPhoto: async (mmsi) => { vessels.push(mmsi); return { kind: 'vessel', src: '/api/vessel-info/photo?mmsi=241190000&size=1', link: '/api/vessel-info/photo?mmsi=241190000&size=1' }; },
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutImpl: () => {},
  });
  const card = container.children[0];
  updateContactHoverCard([{ layerId: 'ais-live-vessels', sourceId: '241190000' }], { x: 10, y: 10 }, sk);
  timers.find((x) => x.ms === HOVER_PHOTO_DEBOUNCE_MS).fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(vessels, ['241190000']);
  assert.deepEqual(planespotters, [], 'loď nejde na Planespotters');
  const photo = card.children.at(-1);
  assert.equal(photo.className, 'contact-hover-card-photo');
  assert.equal(photo.classList.contains('contact-hover-card-photo--vessel'), true);
  assert.equal(photo.children[0].src, '/api/vessel-info/photo?mmsi=241190000&size=1');
  assert.equal(photo.children[1].textContent, 'Foto lode · register plavidiel');
  assert.doesNotMatch(photo.children[1].textContent, /Planespotters/);
  _resetContactHoverCardForTest();
});

test('miestny čas v prístave podľa skutočného pásma vrátane letného času', async () => {
  const { vesselTimeZone, _loadVesselTimeZoneForTest } = await import('./vesselTimeZone.js');
  await _loadVesselTimeZoneForTest();
  const now = Date.parse('2026-10-10T17:59:00Z');
  const rotterdam = vesselTimeZone(51.95, 3.99);
  assert.equal(rotterdam, 'Europe/Amsterdam');
  assert.equal(vesselLocalTimeLabel(3.99, now, rotterdam), '19:59 (UTC+2)', 'SELČ, nie námorné UTC');
  assert.equal(vesselLocalTimeLabel(3.99, Date.parse('2026-12-10T17:59:00Z'), rotterdam), '18:59 (UTC+1)', 'v zime SEČ');
  assert.equal(vesselLocalTimeLabel(-74.2, now, vesselTimeZone(34, -74.2)), '12:59 (UTC−5)', 'na mori námorné pásmo Etc/GMT+5');
  assert.equal(vesselLocalTimeLabel(72.8, now, 'Asia/Kolkata'), '23:29 (UTC+5:30)');
  assert.equal(vesselLocalTimeLabel(3.99, now, 'Nie/Pasmo'), '17:59 (UTC)', 'neznáme pásmo → námorné');
  assert.equal(vesselTimeZone(NaN, 3), null);
});

test('AISHub: kartička aj vybraná karta dostanú register a miestny čas, fotka cez register', async () => {
  const { aishubContactSummary, aishubSelectedExtraLines } = await import('./aishubVessels.js');
  _resetVesselInfoForTest();
  _setVesselInfoFetchForTest(async () => ({ ok: true, json: async () => publicVesselInfo(normalizeVesselInfo('241190000', REGISTRY_JSON)) }));
  const row = { mmsi: '241190000', name: 'MINERVA ZEN', sog: 13.1, cog: 253, heading: 252, lat: 34, lon: -74.2, observedAt: Date.parse('2026-10-10T02:50:00Z') };
  const nowMs = Date.parse('2026-10-10T02:57:00Z');
  const before = aishubContactSummary(row, en, nowMs);
  assert.equal(before.photoKey, 'vessel:241190000');
  assert.deepEqual(before.flightLines, ['13.1 kn · COG 253° · HDG 252°']);
  assert.deepEqual(before.extraLines, ['Local time 21:57 (UTC−5)'], 'bez registra len miestny čas');
  await lookupVesselInfo('241190000');
  const after = aishubContactSummary(row, en, nowMs);
  assert.deepEqual(after.extraLines, [
    'Chemical/Oil Products Tanker · built 2009 · GT 29 442 · DWT 52 941 t',
    'IMO 9410909 · 183 × 32 m',
    'Local time 21:57 (UTC−5)',
  ]);
  assert.deepEqual(aishubSelectedExtraLines(row, en, nowMs), after.extraLines);
  _resetVesselInfoForTest();
});

test('fotka pod kartou: vybraná loď → fotka z registra, bez karty na plátne sa nekreslí, zrušenie výberu ju skryje', async () => {
  const { installVesselPhoto, destroyVesselPhoto, _syncVesselPhotoForTest, _getVesselPhotoStateForTest } = await import('./vesselPhoto.js');
  const makeEl = (tag) => ({ tagName: tag, children: [], style: {}, hidden: false, className: '', classList: { toggle() {} }, appendChild(c) { this.children.push(c); return c; }, remove() {}, ownerDocument: null, offsetHeight: 160 });
  const doc = { createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; }, defaultView: { innerWidth: 1000, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  let selected = { mmsi: '241190000', sourceId: 'ais-live-vessels', entryId: 'vessel:241190000' };
  const lookups = [];
  installVesselPhoto({}, {
    container,
    getSelected: () => selected,
    lookup: async (mmsi) => { lookups.push(mmsi); return { name: 'MINERVA ZEN', photo: { src: '/api/vessel-info/photo?mmsi=241190000&size=1' } }; },
  });
  _syncVesselPhotoForTest();
  await new Promise((r) => setTimeout(r, 0));
  _syncVesselPhotoForTest();
  let st = _getVesselPhotoStateForTest();
  assert.deepEqual(lookups, ['241190000']);
  assert.equal(st.src, '/api/vessel-info/photo?mmsi=241190000&size=1');
  assert.equal(st.credit, 'MINERVA ZEN · Vessel photo · ship register');
  assert.equal(st.hidden, true, 'karta lode nie je na plátne → pás nevisí sám');
  _syncVesselPhotoForTest();
  assert.equal(lookups.length, 1, 'tá istá loď = bez ďalšieho dopytu');
  selected = null;
  _syncVesselPhotoForTest();
  st = _getVesselPhotoStateForTest();
  assert.equal(st.currentMmsi, null);
  assert.equal(st.hidden, true);
  destroyVesselPhoto();
});

test('súčasná plavba: parser stránky registra (posledný prístav, ATD bez roka)', async () => {
  const { parseVesselVoyageHtml, parseDepartureUtc } = await import('./vesselInfoProxy.js');
  // Úryvok skutočnej stránky MINERVA ZEN (2026-10-10), skrátený.
  const html = '<div class="vi__r1 vi__stp"><div class="_3-Yih">Last Port</div><div class="_3-Yih"><a href="/ports/RULED001">Saint Petersburg, Russia</a></div><div class="_value">ATD: Sep 22, 20:32 UTC <span>(18 days ago)</span></div></div>';
  const now = Date.parse('2026-10-10T18:00:00Z');
  assert.deepEqual(parseVesselVoyageHtml(html, now), { lastPort: 'Saint Petersburg', lastPortCountry: 'Russia', departedAt: Date.parse('2026-09-22T20:32:00Z') });
  assert.equal(parseDepartureUtc('Dec 30, 10:00', Date.parse('2027-01-03T00:00:00Z')), Date.parse('2026-12-30T10:00:00Z'), 'prelom roka → minulý rok');
  assert.equal(parseDepartureUtc('Sep 22, 2025 20:32', now), Date.parse('2025-09-22T20:32:00Z'));
  assert.equal(parseDepartureUtc('', now), null);
  assert.equal(parseVesselVoyageHtml('<div>Last Port</div><div>-</div>', now), null);
  assert.equal(parseVesselVoyageHtml('<p>nič</p>', now), null);
});

test('súčasná plavba: prístav podľa mena A štátu, priebeh, riadky karty', async () => {
  const { buildPortIndex, matchPortByNameCountry } = await import('./vesselDestination.js');
  const { vesselVoyageModel, voyageRouteLine, voyageDepartureLine } = await import('./vesselCardDetails.js');
  const feature = (id, name, locode, country, lon, lat) => ({ id, geometry: { coordinates: [lon, lat] }, properties: { name, locode, country } });
  const index = buildPortIndex([
    feature('a', 'St Petersburg', 'RULED', 'United States', -82.6, 27.8),
    feature('b', 'Sankt-Peterburg', 'RULED', 'Russia', 30.3, 59.93),
    feature('c', 'Wilmington', 'USILM', 'United States', -77.95, 34.23),
  ]);
  assert.equal(matchPortByNameCountry('Saint Petersburg', 'Russia', index).id, 'b', 'nie St Petersburg na Floride');
  assert.equal(matchPortByNameCountry('Saint Petersburg', 'Greece', index), null, 'bez zhody štátu nehádať');
  assert.equal(matchPortByNameCountry('Wilmington', 'USA', index).id, 'c', 'alias štátu');
  const info = { voyage: { lastPort: 'Saint Petersburg', lastPortCountry: 'Russia', departedAt: Date.parse('2026-09-22T20:32:00Z') }, destination: 'WILMINGTON.NC.USA' };
  const model = vesselVoyageModel({ lat: 34, lon: -74.2, destination: '' }, info, index);
  assert.equal(model.origin.locode, 'RULED');
  assert.equal(model.origin.iso2, 'ru');
  assert.equal(model.destination.locode, 'USILM', 'cieľ z registra, keď AIS nič nehlási');
  assert.ok(model.progress.fractionDone > 0.9 && model.progress.fractionDone < 1);
  assert.match(voyageRouteLine(model), /^Saint Petersburg \(RULED\) → Wilmington \(USILM\) · 9\d %$/);
  const now = Date.parse('2026-10-10T20:32:00Z');
  assert.equal(voyageDepartureLine(model, sk, 'sk', now), 'vyplávala 22. 9. 20:32 UTC · pred 18 d');
  assert.equal(voyageDepartureLine(model, en, 'en', now), 'departed Sep 22 20:32 UTC · 18 d ago');
  const noIndex = vesselVoyageModel({ lat: 34, lon: -74.2 }, info, null);
  assert.equal(noIndex.progress, null, 'bez indexu prístavov bez priebehu, text ostáva');
  assert.equal(voyageRouteLine(noIndex), 'Saint Petersburg → WILMINGTON.NC.USA');
  assert.equal(vesselVoyageModel({}, { voyage: null }, index), null);
});

test('GFW: kartička oneskorenej lode dostane register, posledný prístav a fotku — bez priebehu a miestneho času', async () => {
  const { gfwContactSummary } = await import('./gfwPresence.js');
  _resetVesselInfoForTest();
  // Skutočný riadok GFW pre MINERVA ZEN (6. 10. 2026) — typ OTHER, bez rozmerov.
  const row = { mmsi: '241190000', name: 'MINERVA ZEN', type: 'OTHER', flag: 'GRC', callsign: 'SVBN3', imo: '9410909', lat: 38.46, lon: -50.43, hours: 21, lastSeen: Date.parse('2026-10-06T23:00:00Z'), vesselId: 'ceae20fb3' };
  const meta = { day: '2026-10-06', cellDeg: 0.01, mode: 'hourly' };
  const before = gfwContactSummary(row, meta, sk, 'sk');
  assert.equal(before.photoKey, 'vessel:241190000');
  assert.deepEqual(before.extraLines, ['IMO 9410909'], 'bez registra aspoň IMO z GFW');
  _setVesselInfoFetchForTest(async () => ({ ok: true, json: async () => ({ ...publicVesselInfo(normalizeVesselInfo('241190000', REGISTRY_JSON)), voyage: { lastPort: 'Saint Petersburg', lastPortCountry: 'Russia', departedAt: Date.parse('2026-09-22T20:32:00Z') } }) }));
  await lookupVesselInfo('241190000');
  const after = gfwContactSummary(row, meta, sk, 'sk');
  assert.equal(after.type, 'Tanker na chemikálie a ropné produkty', 'podrobný typ z registra namiesto OTHER');
  assert.match(after.extraLines[0], /^vyplávala 22\. 9\. 20:32 UTC/);
  assert.deepEqual(after.extraLines.slice(1), ['postavená 2009 · GT 29 442 · DWT 52 941 t', 'IMO 9410909 · 183 × 32 m']);
  assert.equal(after.routeInfo.origin.name, 'Saint Petersburg');
  assert.equal(after.progress, null, 'poloha je ~3 dni stará — žiadne percento o dnešku');
  assert.equal(after.extraLines.some((l) => /Miestny čas/.test(l)), false);
  _resetVesselInfoForTest();
});
