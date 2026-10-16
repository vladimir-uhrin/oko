// Strážca podkladu Stadia (2026-10-15): po odmietnutiach dlaždíc bezplatná náhrada, zapamätané na 6 h.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STADIA_BLOCK_MS, STADIA_FAIL_THRESHOLD, STADIA_FAIL_WINDOW_MS, STADIA_FALLBACK_STACK, STADIA_STORAGE_KEY, applyStadiaFallback,
  createStadiaHealth, installStadiaFallback, isStadiaUrl, onStadiaBlockExpired,
} from './stadiaHealth.js';
import { createLayerBasemapPolicy, meteoBasemapForHost } from './layerBasemap.js';
import { basemapForHost } from './data/meteoLayer.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

test('odmietnutia 401/403/429 až po prahu; chyby siete a 404 sa nepočítajú', () => {
  let now = 1_000_000;
  const storage = memoryStorage();
  const h = createStadiaHealth({ storage, now: () => now });
  let fired = 0;
  h.onBlocked(() => { fired += 1; });
  assert.equal(h.noteTileError(undefined), false);
  assert.equal(h.noteTileError(404), false);
  for (let i = 1; i < STADIA_FAIL_THRESHOLD; i += 1) assert.equal(h.noteTileError(429), false);
  assert.equal(h.blocked(), false);
  assert.equal(h.noteTileError(401), true, 'prah dosiahnutý');
  assert.equal(h.blocked(), true);
  assert.equal(fired, 1);
  assert.equal(Number(storage.map.get(STADIA_STORAGE_KEY)), now + STADIA_BLOCK_MS, 'zapamätané v prehliadači');
  assert.equal(h.noteTileError(403), false, 'už je mimo — znova sa nehlási');
  now += STADIA_BLOCK_MS + 1;
  assert.equal(h.blocked(), false, 'po 6 h sa Stadia skúsi znova');
});

test('ďalšie načítanie stránky: zapamätaný stav rovno obíde Stadia, localhost nikdy', () => {
  const now = 5_000_000;
  const storage = memoryStorage();
  storage.setItem(STADIA_STORAGE_KEY, String(now + 60_000));
  const h = createStadiaHealth({ storage, now: () => now });
  assert.equal(h.blocked(), true);
  assert.equal(h.usableHost('okolive.sk'), false);
  assert.equal(h.usableHost('www.okolive.sk'), false);
  assert.equal(h.usableHost('localhost'), true, 'lokálny vývoj ide bez účtu');
  assert.equal(h.usableHost('example.com'), false, 'neautorizovaná doména nikdy');
  const broken = createStadiaHealth({ storage: { getItem: () => { throw new Error('zakázané'); } }, now: () => now });
  assert.equal(broken.blocked(), false, 'nedostupné úložisko nezhodí strážcu');
});

test('náhrada pre každý štýl Stadia a rozpoznanie dlaždice', () => {
  assert.equal(STADIA_FALLBACK_STACK['stadia-dark'], 'gibs-blue-marble');
  for (const id of ['stadia-smooth', 'stadia-outdoors', 'stadia-terrain']) assert.equal(STADIA_FALLBACK_STACK[id], 'osm');
  assert.equal(isStadiaUrl('https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}@2x.png'), true);
  assert.equal(isStadiaUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png'), false);
});

test('podklad pre meteo: obe funkcie sa zhodujú (Stadia na autorizovanej doméne, inde Blue Marble)', () => {
  for (const host of ['localhost', 'okolive.sk', 'www.okolive.sk', 'example.com', '']) {
    assert.equal(meteoBasemapForHost(host), basemapForHost(host), host);
  }
  assert.equal(meteoBasemapForHost('example.com'), 'gibs-blue-marble');
});

// 2026-10-15: počítadlo predtým nikdy neklesalo — tri ojedinelé odmietnutia v priebehu dňa
// zablokovali Stadiu na 6 h (aj pre ďalšie návštevy, localStorage).
test('ojedinelé odmietnutia v priebehu dňa Stadiu neblokujú; tri v okne 5 min áno', () => {
  let now = Date.parse('2026-10-21T09:00:00Z');
  const storage = memoryStorage();
  const h = createStadiaHealth({ storage, now: () => now });
  for (const hour of [9, 13, 17]) {
    now = Date.parse(`2026-10-21T${String(hour).padStart(2, '0')}:00:00Z`);
    assert.equal(h.noteTileError(429), false, `${hour}:00 jedno odmietnutie`);
  }
  assert.equal(h.blocked(), false, 'tri odmietnutia v rozpätí 8 h nie sú vyčerpaný limit');
  assert.equal(storage.map.has(STADIA_STORAGE_KEY), false, 'nič sa nezapamätalo pre ďalšie návštevy');
  assert.equal(h.usableHost('okolive.sk'), true);
  // Vyčerpaný limit: odmieta každá dlaždica, overenie najviac raz za 10 s.
  now += STADIA_FAIL_WINDOW_MS;
  assert.equal(h.noteTileError(429), false);
  now += 10_000;
  assert.equal(h.noteTileError(429), false);
  now += 10_000;
  assert.equal(h.noteTileError(429), true, 'tretie odmietnutie do 5 min = Stadia mimo');
  assert.equal(h.blocked(), true);
});

test('vydaná dlaždica (2xx) počítadlo vynuluje — prah platí pre odmietnutia po sebe', () => {
  let now = 2_000_000;
  const h = createStadiaHealth({ now: () => now });
  for (let i = 1; i < STADIA_FAIL_THRESHOLD; i += 1) { assert.equal(h.noteTileError(429), false); now += 10_000; }
  assert.equal(h.noteTileError(200), false, 'overenie prešlo');
  now += 10_000;
  assert.equal(h.noteTileError(401), false, 'po úspechu sa počíta odznova');
  assert.equal(h.blocked(), false);
  for (let i = 1; i < STADIA_FAIL_THRESHOLD; i += 1) { now += 10_000; h.noteTileError(403); }
  assert.equal(h.blocked(), true, 'tri odmietnutia po sebe v okne blokujú');
});

// ── náhrada cestou UI (2026-10-15) ─────────────────────────────────────────
test('náhrada: mapa podľa vrstvy ju prevezme PRED prepnutím, čipy sa prekreslia, prepína UI; meteo po vypnutí vráti Google 3D', () => {
  const h = { active: 'photoreal', steps: [], states: [] };
  const policy = createLayerBasemapPolicy({
    getActiveId: () => h.active,
    hasStack: () => true,
    setStack: (id) => { h.active = id; policy.onMapChange(id); },
    resolveMap: () => 'stadia-dark',
    onState: (state) => h.states.push(state),
  });
  policy.onLayerChange({ layerId: 'meteo-gfs', enabled: true, origin: 'user' });
  assert.equal(h.active, 'stadia-dark');
  const to = applyStadiaFallback({ from: 'stadia-dark', to: STADIA_FALLBACK_STACK['stadia-dark'] }, {
    adopt: () => { h.steps.push('adopt'); policy.onStadiaBlocked(); },
    refreshControls: () => h.steps.push('refresh'),
    // „StyleManager._setMapStack": zmena mapy príde politike ako každá iná (onActiveMapStackChange).
    switchStack: (id) => { h.steps.push(`switch:${id}`); h.active = id; policy.onMapChange(id); },
  });
  assert.equal(to, 'gibs-blue-marble');
  assert.deepEqual(h.steps, ['adopt', 'refresh', 'switch:gibs-blue-marble']);
  assert.equal(h.active, 'gibs-blue-marble');
  assert.deepEqual(policy.state().owners, ['meteo-gfs'], 'meteo mapu drží ďalej');
  assert.deepEqual(h.states.at(-1), { auto: true, layerId: 'meteo-gfs' }, 'štítok AUTO ostáva');
  policy.onLayerChange({ layerId: 'meteo-gfs', enabled: false, origin: 'user' });
  assert.equal(h.active, 'photoreal', 'po vypnutí meteo späť Google 3D');
});

test('náhrada: aktívna mapa nie je Stadia → len prekreslenie čipov; chyba kroku neodstaví prepnutie', async () => {
  const steps = [];
  assert.equal(applyStadiaFallback({ from: 'photoreal', to: null }, {
    adopt: () => steps.push('adopt'), refreshControls: () => steps.push('refresh'), switchStack: (id) => steps.push(id),
  }), null);
  assert.deepEqual(steps, ['adopt', 'refresh']);
  const switched = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    applyStadiaFallback({ from: 'stadia-outdoors', to: 'osm' }, {
      adopt: () => { throw new Error('politika'); },
      refreshControls: () => { throw new Error('čipy'); },
      switchStack: async (id) => { switched.push(id); throw new Error('prepnutie zlyhalo'); },
      directSwitch: (id) => switched.push(`kontrolér:${id}`),
    });
    await new Promise((r) => setTimeout(r, 0));
  } finally { console.warn = warn; }
  assert.deepEqual(switched, ['osm', 'kontrolér:osm'], 'glóbus neostane na odmietajúcej Stadii');
});

// 2026-10-16 (recenzia g4): prepnutie cez UI mohlo zlyhať potichu — glóbus ostal na odmietajúcej Stadii
// a ďalšie overenie už nepríde (Stadia je „mimo").
test('náhrada: zlyhané prepnutie cez UI (výnimka, zamietnutie, chýbajúci prepínač) prepne kontrolér; úspešné nie', async () => {
  const direct = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    const info = { from: 'stadia-dark', to: 'gibs-blue-marble' };
    applyStadiaFallback(info, { switchStack: () => { throw new ReferenceError('styleManager'); }, directSwitch: (id) => direct.push(`výnimka:${id}`) });
    applyStadiaFallback(info, { switchStack: async () => { throw new Error('ui'); }, directSwitch: (id) => direct.push(`zamietnutie:${id}`) });
    applyStadiaFallback(info, { directSwitch: (id) => direct.push(`bez UI:${id}`) });
    applyStadiaFallback(info, { switchStack: async () => {}, directSwitch: (id) => direct.push(`zbytočne:${id}`) });
    applyStadiaFallback({ from: 'photoreal', to: null }, { switchStack: () => { throw new Error('x'); }, directSwitch: (id) => direct.push(`nie Stadia:${id}`) });
    await new Promise((r) => setTimeout(r, 0));
  } finally { console.warn = warn; }
  assert.deepEqual(direct, ['výnimka:gibs-blue-marble', 'bez UI:gibs-blue-marble', 'zamietnutie:gibs-blue-marble']);
});

// 2026-10-16 (recenzia g4): rad čipov sa pri bloku prekreslil s rodinou Stadia nedostupnou a sync mení
// len aktívny čip — v karte otvorenej dlhšie ako 6 h ostala Stadia sivá až do obnovenia stránky.
function fakeTimers() {
  const list = [];
  return {
    list,
    setTimeoutImpl: (fn, ms) => { const timer = { fn, ms, cleared: false }; list.push(timer); return timer; },
    clearTimeoutImpl: (timer) => { if (timer) timer.cleared = true; },
  };
}

test('koniec bloku: zavolá sa po uplynutí (aj pri zapamätanom bloku zo štartu); skorý časovač počká; nový blok znova', () => {
  let now = 10_000_000;
  const storage = memoryStorage();
  storage.setItem(STADIA_STORAGE_KEY, String(now + 60_000)); // blok z predošlej návštevy
  const h = createStadiaHealth({ storage, now: () => now });
  const timers = fakeTimers();
  let expired = 0;
  const stop = onStadiaBlockExpired(() => { expired += 1; }, { health: h, ...timers });
  assert.equal(timers.list.length, 1, 'zapamätaný blok — časovač hneď pri štarte');
  assert.ok(timers.list[0].ms >= 60_000 && timers.list[0].ms <= 60_000 + 5_000);
  now += 30_000; // časovač predbehol hodiny strážcu (uspaný telefón)
  timers.list[0].fn();
  assert.equal(expired, 0, 'ešte blokované — nič');
  assert.equal(timers.list.length, 2, 'čaká znova');
  now += timers.list[1].ms;
  timers.list[1].fn();
  assert.equal(expired, 1);
  assert.equal(h.blocked(), false);

  for (let i = 0; i < STADIA_FAIL_THRESHOLD; i += 1) h.noteTileError(429);
  assert.equal(timers.list.length, 3, 'nový blok v tej istej karte');
  assert.ok(timers.list[2].ms >= STADIA_BLOCK_MS);
  now += timers.list[2].ms;
  timers.list[2].fn();
  assert.equal(expired, 2);

  for (let i = 0; i < STADIA_FAIL_THRESHOLD; i += 1) h.noteTileError(429);
  stop();
  assert.equal(timers.list[3].cleared, true, 'odhlásenie zruší čakajúci časovač');
  now += STADIA_BLOCK_MS + 1;
  for (let i = 0; i < STADIA_FAIL_THRESHOLD; i += 1) h.noteTileError(429);
  assert.equal(timers.list.length, 4, 'po odhlásení sa už nič nenaťahuje');

  const none = fakeTimers();
  onStadiaBlockExpired(() => {}, { health: createStadiaHealth({ now: () => now }), ...none });
  assert.equal(none.list.length, 0, 'bez bloku žiadny časovač');
});

test('installStadiaFallback: blok → UI cesta, zlyhané UI → kontrolér sám, koniec bloku → čipy znova; odpojenie', async () => {
  let now = 20_000_000;
  const h = createStadiaHealth({ now: () => now });
  const timers = fakeTimers();
  const calls = [];
  const controller = {
    handler: null,
    active: 'stadia-outdoors',
    setStadiaBlockedHandler(fn) { this.handler = fn; },
    getActiveId() { return this.active; },
    setStack(id) { calls.push(`kontrolér:${id}`); this.active = id; },
  };
  let uiFails = false;
  const stop = installStadiaFallback({
    controller,
    health: h,
    adopt: () => calls.push('adopt'),
    refreshControls: () => calls.push('čipy'),
    switchStack: async (id) => { if (uiFails) throw new Error('ui'); calls.push(`ui:${id}`); controller.active = id; },
    ...timers,
  });
  assert.equal(typeof controller.handler, 'function');
  for (let i = 0; i < STADIA_FAIL_THRESHOLD; i += 1) h.noteTileError(429);
  controller.handler({ from: 'stadia-outdoors', to: 'osm' });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ['adopt', 'čipy', 'ui:osm'], 'UI prepla — kontrolér nie');
  assert.equal(timers.list.length, 1);
  now += timers.list[0].ms;
  timers.list[0].fn();
  assert.deepEqual(calls.at(-1), 'čipy', 'po skončení bloku sa čipy prekreslia (Stadia znova dostupná)');

  calls.length = 0;
  uiFails = true;
  controller.active = 'stadia-dark';
  const warn = console.warn;
  console.warn = () => {};
  try {
    controller.handler({ from: 'stadia-dark', to: 'gibs-blue-marble' });
    await new Promise((r) => setTimeout(r, 0));
  } finally { console.warn = warn; }
  assert.deepEqual(calls, ['adopt', 'čipy', 'kontrolér:gibs-blue-marble'], 'zlyhané UI → prepne kontrolér');

  stop();
  assert.equal(controller.handler, null, 'odpojené');
});

// Zapojenie v main.js (2026-10-16, recenzia g4): s pôvodným main.js bez týchto riadkov prechádzali všetky
// testy. main.js ani ui.js sa bez prehliadača načítať nedajú — strážime zdroj.
test('main.js: Stadia mimo je zapojená cez installStadiaFallback a cesty StyleManager (čipy, prepnutie, odkaz)', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(main, /import \{[^}]*\binstallStadiaFallback\b[^}]*\} from '\.\/stadiaHealth\.js';/, 'import (bez neho ReferenceError až pri bloku)');
  const at = main.indexOf('installStadiaFallback({');
  assert.ok(at > 0, 'volanie chýba');
  assert.ok(at > main.indexOf('const layerBasemap = createLayerBasemapPolicy('), 'až po politike mapy podľa vrstvy');
  const call = main.slice(at, main.indexOf('});', at) + 3);
  for (const part of [
    'controller: mapStackController',
    'adopt: () => layerBasemap.onStadiaBlocked()',
    'refreshControls: () => styleManager._initMapStackControl()',
    'switchStack: (id) => styleManager._setMapStack(id)',
  ]) assert.ok(call.includes(part), `zapojenie: chýba ${part}`);

  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  const initAt = ui.indexOf('_initMapStackControl() {');
  const setAt = ui.indexOf('async _setMapStack(');
  assert.ok(initAt > 0 && setAt > initAt, 'StyleManager._initMapStackControl a _setMapStack existujú');
  assert.ok(ui.slice(initAt, setAt).includes('renderMapStackChips(this._mapStackChips, this.mapStackController.getStacks()'),
    'prekreslenie berie čerstvú dostupnosť z kontroléra');
  const setMap = ui.slice(setAt, ui.indexOf('_renderMapStackState(state) {', setAt));
  assert.ok(setMap.includes('await this.mapStackController.setStack(stackId)'), 'prepnutie ide cez kontrolér');
  assert.ok(setMap.includes('this._syncShareState()'), 'zdieľaný odkaz nasleduje');
});
