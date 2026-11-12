// Témy ako režimy (2026-11-12): snímka pred vstupom, poradie návratu, čip a zapojenie.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THEMES, THEME_BLOCKING_CLASSES, THEME_SETTLE_CAP_MS, canEnterTheme, planLayerRestore, planPanelRestore, poseDiffers, createThemeMode } from './themeMode.js';
import { WELCOME_CHOICES } from './welcomeStrip.js';
import { TOP_BAR_CAPTIONS } from './topBarExtras.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeDoc() {
  const doc = { activeElement: null };
  const make = (tag) => {
    const classes = new Set();
    const node = {
      tagName: tag.toUpperCase(), children: [], dataset: {}, attrs: {}, listeners: {}, parent: null, textContent: '', className: '', hidden: false,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), [Symbol.iterator]: () => classes[Symbol.iterator]() },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
      contains(other) { for (let n = other; n; n = n.parent) if (n === this) return true; return false; },
      focus() { doc.activeElement = this; },
    };
    return node;
  };
  doc.body = make('body');
  doc.createElement = make;
  return doc;
}

/** Falošný svet: vrstvy, podklad, panely, kamera, výsuv a záznam volaní. */
function world({ phone = false, layers = ['flights', 'radio'], stack = 'photoreal', kartaPrev = null, allowed = true } = {}) {
  const log = [];
  const state = {
    layers: new Set(layers), stack, panels: { 'data-panel': true, 'weather-panel': true, 'ukraine-panel': true },
    pose: { lon: 17.1, lat: 48.1, height: 430_000, heading: 0, pitch: -0.9, roll: 0 }, sheet: phone ? 'layers' : null,
    kartaPrev, allowed, layerResult: true, notes: [],
  };
  const doc = fakeDoc();
  const fallback = doc.createElement('button');
  const timers = [];
  const deps = {
    doc, translate: (key, params) => (params ? `${key}:${params.name}` : key),
    getLayerIds: () => [...state.layers],
    setLayer: async (id, on, origin) => { log.push(`layer:${id}:${on}:${origin}`); if (state.layerResult !== false) { if (on) state.layers.add(id); else state.layers.delete(id); } return state.layerResult; },
    isLayerOn: (id) => state.layers.has(id),
    getStack: () => state.stack,
    setStack: async (id) => { log.push(`stack:${id}`); state.stack = id; },
    readPanels: () => { log.push('readPanels'); return { ...state.panels }; },
    setPanel: (id, collapsed) => { log.push(`panel:${id}:${collapsed}`); state.panels[id] = collapsed; },
    getPose: () => ({ ...state.pose }),
    flyToPose: (pose) => { log.push('fly'); state.pose = { ...pose }; },
    sheet: { active: () => { log.push('sheet.active'); return state.sheet; }, close: () => { log.push('sheet.close'); state.sheet = null; } },
    leaveScene: () => { log.push('leaveScene'); return { kartaPrev: state.kartaPrev }; },
    waitReady: async () => { log.push('ready'); },
    canEnter: () => state.allowed,
    notify: (text) => state.notes.push(text),
    onPhone: () => phone,
    focusFallback: () => fallback,
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutImpl: () => {},
  };
  return { log, state, doc, deps, fallback, timers };
}
const chip = (doc) => doc.body.children.find((n) => n.id === 'oko-theme');
const live = (doc) => doc.body.children.find((n) => n.id === 'oko-theme-live');
const backButton = (doc) => chip(doc).children.find((n) => n.className === 'oko-theme-back');

test('témy sú tie isté a v tom istom poradí ako voľby uvítania; texty existujú v oboch jazykoch', () => {
  assert.deepEqual(THEMES.map((th) => th.id), WELCOME_CHOICES.map((c) => c.id));
  assert.deepEqual(THEMES.filter((th) => th.scene).map((th) => [th.id, th.scene]), [['ukraine', 'ukraine'], ['mideast', 'mideast']]);
  const keys = [...THEMES.map((th) => th.nameKey), 'theme.chip', 'theme.back', 'theme.back.aria', 'theme.entered', 'theme.restored', 'theme.restore-partial', 'cmd.theme', 'cmd.theme.back', 'actions.caption.themes', 'actions.themes'];
  for (const key of keys) {
    for (const [lang, strings] of [['EN', EN_STRINGS], ['SK', SK_STRINGS]]) {
      assert.ok(strings[key], `${lang} ${key}`);
      assert.doesNotMatch(strings[key], /\p{Extended_Pictographic}/u, `${lang} ${key} bez emoji`);
    }
  }
  for (const key of ['theme.chip', 'theme.back.aria', 'theme.entered', 'cmd.theme']) {
    assert.match(EN_STRINGS[key], /\{name\}/); assert.match(SK_STRINGS[key], /\{name\}/);
  }
});

test('plán vrstiev: vypnúť navyše, zapnúť chýbajúce; poradie a duplicity výsledok nemenia', () => {
  assert.deepEqual(planLayerRestore(['flights', 'radio'], ['flights', 'shmu-radar']), { turnOff: ['shmu-radar'], turnOn: ['radio'] });
  assert.deepEqual(planLayerRestore(['a', 'b'], ['b', 'a']), { turnOff: [], turnOn: [] });
  assert.deepEqual(planLayerRestore(['b', 'a', 'a'], ['c', 'c']), { turnOff: ['c'], turnOn: ['a', 'b'] });
  assert.deepEqual(planLayerRestore(null, undefined), { turnOff: [], turnOn: [] });
});

test('plán panelov: len rozdiely, zbalenia pred rozbaleniami; neznámy panel sa preskočí', () => {
  assert.deepEqual(
    planPanelRestore({ a: true, b: false, c: true, gone: false }, { a: false, b: true, c: true }),
    [{ id: 'a', collapsed: true }, { id: 'b', collapsed: false }],
  );
  assert.deepEqual(planPanelRestore(null, { a: true }), []);
  assert.deepEqual(planPanelRestore({ a: true }, null), []);
});

test('pohľad kamery: drobný rozdiel nie je dôvod letieť, posun, výška a natočenie áno', () => {
  const p = { lon: 17, lat: 48, height: 430_000, heading: 0, pitch: -0.9 };
  assert.equal(poseDiffers(p, { ...p }), false);
  assert.equal(poseDiffers(p, { ...p, lat: 48.005, height: 431_000 }), false);
  assert.equal(poseDiffers(p, { ...p, lat: 48.5 }), true);
  assert.equal(poseDiffers(p, { ...p, height: 900_000 }), true);
  assert.equal(poseDiffers(p, { ...p, heading: 0.5 }), true);
  assert.equal(poseDiffers({ ...p, lon: 179.999 }, { ...p, lon: -179.999 }), false, 'cez dátumovú hranicu');
  assert.equal(poseDiffers(p, { ...p, heading: 2 * Math.PI - 0.001 }), false, 'kurz cez nulu');
  assert.equal(poseDiffers(null, p), false);
});

test('režim sa nezakladá v kokpite, čistom pohľade, nahrávaní, vloženom rámčeku ani pri voľbách', () => {
  assert.equal(canEnterTheme({ bodyClasses: ['oko-mobile', 'oko-karta-frame'] }), true);
  for (const name of THEME_BLOCKING_CLASSES) assert.equal(canEnterTheme({ bodyClasses: [name] }), false, name);
  assert.deepEqual([...THEME_BLOCKING_CLASSES].sort(), ['cockpit-mode', 'embed-mode', 'oko-karta-clean', 'recording-mode', 'scene-playback-mode', 'ui-clean-view']);
  assert.equal(canEnterTheme({ bodyClasses: [], volbyActive: true }), false);
  assert.equal(canEnterTheme(), true);
});

test('vstup: snímka vzniká po obnove stavu a PRED akciou témy; čip sa ukáže s názvom', async () => {
  const w = world();
  const mode = createThemeMode({ ...w.deps, runs: { weather: () => { w.log.push('run'); w.state.layers.add('shmu-radar'); w.state.stack = 'stadia'; w.state.panels['weather-panel'] = false; } } });
  assert.equal(chip(w.doc).hidden, true);
  assert.equal(await mode.enter('weather'), true);
  assert.ok(w.log.indexOf('ready') < w.log.indexOf('run'));
  assert.deepEqual(mode.saved.layers.sort(), ['flights', 'radio']);
  assert.equal(mode.saved.stack, 'photoreal');
  assert.equal(mode.saved.panels['weather-panel'], true);
  assert.equal(mode.active, 'weather');
  assert.equal(chip(w.doc).hidden, false);
  assert.equal(chip(w.doc).children[0].textContent, 'theme.chip:theme.name.weather');
  assert.equal(backButton(w.doc).attrs['aria-disabled'], 'false');
  assert.equal(w.doc.body.classList.contains('oko-theme-active'), true);
  assert.equal(w.doc.body.dataset.okoTheme, 'weather');
  assert.equal(live(w.doc).textContent, 'theme.entered:theme.name.weather');
  assert.equal(live(w.doc).attrs['aria-live'], 'polite');
});

test('vstup na telefóne: výsuv sa prečíta pred zavretím, zavrie pred akciou; panely sa nečítajú', async () => {
  const w = world({ phone: true });
  const mode = createThemeMode({ ...w.deps, runs: { energy: () => { w.log.push('run'); } } });
  await mode.enter('energy');
  const order = w.log.filter((x) => ['sheet.close', 'run'].includes(x));
  assert.deepEqual(order, ['sheet.close', 'run']);
  assert.equal(w.log.includes('readPanels'), false);
  assert.equal(mode.saved.panels, null);
  w.log.length = 0;
  await mode.back();
  assert.equal(w.log[0], 'sheet.close', 'návrat najprv zavrie výsuv (ten vráti panelom zbalenie)');
  assert.equal(w.log.some((x) => x.startsWith('panel:')), false);
});

test('návrat: scéna → vrstvy (navyše ako používateľ, chýbajúce bez pôvodu) → podklad → panely → kamera', async () => {
  const w = world({ kartaPrev: 'photoreal' });
  const mode = createThemeMode({
    ...w.deps,
    runs: { ukraine: () => { w.state.layers.delete('radio'); w.state.layers.add('extra'); w.state.stack = 'photoreal'; /* prepnutie na KARTU ešte beží */ w.state.panels['ukraine-panel'] = false; w.state.pose = { ...w.state.pose, lon: 36, lat: 48.5 }; } },
  });
  await mode.enter('ukraine');
  w.log.length = 0;
  assert.equal(await mode.back(), true);
  assert.deepEqual(w.log.filter((x) => x !== 'readPanels'), ['leaveScene', 'layer:extra:false:user', 'layer:radio:true:undefined', 'stack:photoreal', 'panel:ukraine-panel:true', 'fly']);
  assert.deepEqual([...w.state.layers].sort(), ['flights', 'radio']);
  assert.equal(w.state.pose.lon, 17.1);
  assert.equal(mode.active, null);
  assert.equal(mode.saved, null);
  assert.equal(chip(w.doc).hidden, true);
  assert.equal(w.doc.body.classList.contains('oko-theme-active'), false);
  assert.equal('okoTheme' in w.doc.body.dataset, false);
  assert.equal(live(w.doc).textContent, 'theme.restored');
});

test('podklad sa vracia len keď ho prepla scéna a snímka nebola KARTA', async () => {
  for (const [kartaPrev, stack, expected] of [[null, 'photoreal', false], ['photoreal', 'karta', false], ['osm', 'osm', true]]) {
    const w = world({ kartaPrev, stack });
    const mode = createThemeMode({ ...w.deps, runs: { ukraine: () => {} } });
    await mode.enter('ukraine');
    await mode.back();
    assert.equal(w.log.some((x) => x.startsWith('stack:')), expected, `${kartaPrev}/${stack}`);
  }
});

test('kamera neletí, keď sa pohľad nezmenil (téma bez preletu)', async () => {
  const w = world();
  const mode = createThemeMode({ ...w.deps, runs: { energy: () => {} } });
  await mode.enter('energy');
  await mode.back();
  assert.equal(w.log.includes('fly'), false);
});

test('zlyhanie vrstvy: hláška len keď stav naozaj nesedí; ostatné kroky dobehnú', async () => {
  const w = world({ kartaPrev: 'photoreal' });
  const mode = createThemeMode({ ...w.deps, runs: { weather: () => { w.state.layers.add('shmu-radar'); w.state.pose = { ...w.state.pose, lat: 40 }; } } });
  await mode.enter('weather');
  w.state.layerResult = false; // vrstva sa nevypla
  await mode.back();
  assert.deepEqual(w.state.notes, ['theme.restore-partial']);
  assert.ok(w.log.includes('stack:photoreal') && w.log.includes('fly'));
  assert.equal(chip(w.doc).hidden, true);

  // „false" pri nahradenom zámere (stav už sedí) hlášku nedá
  const v = world();
  const again = createThemeMode({
    ...v.deps,
    setLayer: async (id, on) => { if (on) v.state.layers.add(id); else v.state.layers.delete(id); return false; },
    runs: { weather: () => { v.state.layers.add('shmu-radar'); } },
  });
  await again.enter('weather');
  await again.back();
  assert.deepEqual(v.state.notes, []);
});

test('z témy do témy: jedna snímka, medzi témami sa neletí späť a Späť vráti stav spred prvej', async () => {
  const w = world();
  const mode = createThemeMode({
    ...w.deps,
    runs: {
      flights: () => { w.state.pose = { ...w.state.pose, lat: 49 }; },
      weather: () => { w.state.layers.add('shmu-radar'); },
    },
  });
  await mode.enter('flights');
  const first = mode.saved;
  w.log.length = 0;
  await mode.enter('weather');
  assert.equal(mode.saved, first, 'snímka sa neurobila znova');
  assert.equal(w.log.includes('fly'), false);
  assert.equal(w.log.includes('leaveScene'), true, 'predošlá téma sa zložila');
  assert.equal(mode.active, 'weather');
  await mode.back();
  assert.deepEqual([...w.state.layers].sort(), ['flights', 'radio']);
  assert.equal(w.state.pose.lat, 48.1);
});

test('počas vstupu je Späť vypnuté a nič nespustí; po strope čakania sa uvoľní', async () => {
  const w = world();
  let release;
  const mode = createThemeMode({ ...w.deps, runs: { ukraine: () => new Promise((resolve) => { release = resolve; }) } });
  const entering = mode.enter('ukraine');
  await tick();
  assert.equal(mode.busy, true);
  assert.equal(backButton(w.doc).attrs['aria-disabled'], 'true');
  w.log.length = 0;
  backButton(w.doc).listeners.click();
  assert.equal(await mode.back(), false);
  assert.equal(await mode.enter('flights'), false, 'druhý vstup počas prvého sa ignoruje');
  assert.deepEqual(w.log, []);
  assert.equal(w.timers.at(-1).ms, THEME_SETTLE_CAP_MS);
  w.timers.at(-1).fn(); // strop uplynul skôr než scéna
  await entering;
  assert.equal(mode.busy, false);
  assert.equal(backButton(w.doc).attrs['aria-disabled'], 'false');
  release();
  assert.equal(await mode.back(), true);
});

test('zmena scény návštevníkom tému zahodí bez vracania; vlastná scéna ju drží', async () => {
  const w = world();
  const mode = createThemeMode({ ...w.deps, runs: { ukraine: () => { mode.onSceneState('ukraine'); }, flights: () => {} } });
  mode.onSceneState('chokepoint'); // bez témy nič
  await mode.enter('ukraine');
  w.log.length = 0;
  mode.onSceneState('ukraine');
  assert.equal(mode.active, 'ukraine');
  mode.onSceneState(''); // × v paneli UKRAJINA
  assert.equal(mode.active, null);
  assert.equal(mode.saved, null);
  assert.equal(chip(w.doc).hidden, true);
  assert.deepEqual(w.log, [], 'nič sa nevracalo');

  // téma bez scény: prázdne hlásenie nič, cudzia scéna ju zahodí
  await mode.enter('flights');
  mode.onSceneState('');
  assert.equal(mode.active, 'flights');
  mode.onSceneState('chokepoint');
  assert.equal(mode.active, null);

  // prázdne hlásenie pred prvým vlastným (dobieha predošlý stav) tému nezahodí
  const v = world();
  const late = createThemeMode({ ...v.deps, runs: { mideast: () => {} } });
  await late.enter('mideast');
  late.onSceneState('');
  assert.equal(late.active, 'mideast');
  late.onSceneState('mideast');
  late.onSceneState('ukraine');
  assert.equal(late.active, null);
});

test('hlásenia scén počas návratu sa ignorujú (scénu skladá sám režim)', async () => {
  const w = world();
  let mode = null;
  mode = createThemeMode({ ...w.deps, leaveScene: () => { mode.onSceneState(''); return { kartaPrev: null }; }, runs: { ukraine: () => { mode.onSceneState('ukraine'); w.state.layers.add('extra'); } } });
  await mode.enter('ukraine');
  assert.equal(await mode.back(), true);
  assert.equal(w.state.layers.has('extra'), false, 'návrat dobehol celý');
});

test('kde sa režim nesmie založiť, akcia beží ako doteraz — bez snímky a čipu; návrat tam nič nerobí', async () => {
  const w = world({ allowed: false });
  const ran = [];
  const mode = createThemeMode({ ...w.deps, runs: { flights: () => ran.push('flights') } });
  assert.equal(await mode.enter('flights'), false);
  assert.deepEqual(ran, ['flights']);
  assert.equal(mode.active, null);
  assert.equal(chip(w.doc).hidden, true);

  w.state.allowed = true;
  await mode.enter('flights');
  w.state.allowed = false; // medzitým kokpit
  w.log.length = 0;
  assert.equal(await mode.back(), false);
  assert.deepEqual(w.log, []);
  assert.ok(mode.saved, 'snímka ostáva na neskôr');
});

test('súbeh a chyby: dva návraty vrátia raz; výnimka z akcie ani zo scény stránku nezhodí', async () => {
  const w = world();
  const mode = createThemeMode({ ...w.deps, leaveScene: () => { throw new Error('scéna'); }, runs: { weather: () => { w.state.layers.add('shmu-radar'); throw new Error('akcia'); } } });
  assert.equal(await mode.enter('weather'), true);
  w.log.length = 0;
  const [a, b] = await Promise.all([mode.back(), mode.back()]);
  assert.deepEqual([a, b], [true, false]);
  assert.equal(w.log.filter((x) => x === 'layer:shmu-radar:false:user').length, 1);
  assert.equal(await mode.enter('neznama'), false);
});

// Nálezy nezávislej kontroly 2026-11-12.
test('scéna, ktorú téma nespustila (odkaz ?front=, panel): režim sa nezakladá a návrat ju nemá ako zničiť', async () => {
  const w = world();
  let kind = 'ukraine';
  const ran = [];
  const mode = createThemeMode({ ...w.deps, sceneKind: () => kind, runs: { weather: () => ran.push('weather'), flights: () => {} } });
  assert.equal(await mode.enter('weather'), false);
  assert.deepEqual(ran, ['weather'], 'akcia beží ako doteraz');
  assert.equal(mode.active, null);
  assert.equal(mode.saved, null);
  assert.equal(chip(w.doc).hidden, true);
  assert.equal(w.log.includes('leaveScene'), false);
  // z témy do témy scéna patrí téme — režim pokračuje
  kind = '';
  await mode.enter('flights');
  kind = 'chokepoint';
  mode.onSceneState('chokepoint');
  assert.equal(mode.active, null, 'cudzia scéna tému zahodí');
});

test('tá istá téma druhýkrát: nič sa neskladá ani nestavia znova', async () => {
  const w = world();
  let runs = 0;
  const mode = createThemeMode({ ...w.deps, runs: { ukraine: () => { runs += 1; } } });
  await mode.enter('ukraine');
  w.log.length = 0;
  assert.equal(await mode.enter('ukraine'), true);
  assert.equal(runs, 1);
  assert.deepEqual(w.log, []);
});

test('zmena scény počas vstupu sa po ňom dorovná: cudzia scéna tému zahodí, vlastná ju potvrdí', async () => {
  const w = world();
  let kind = '';
  const mode = createThemeMode({ ...w.deps, sceneKind: () => kind, runs: { ukraine: async () => { kind = 'ukraine'; mode.onSceneState('ukraine'); }, flights: async () => { kind = 'chokepoint'; mode.onSceneState('chokepoint'); } } });
  await mode.enter('ukraine');
  assert.equal(mode.active, 'ukraine');
  kind = '';
  mode.onSceneState(''); // koniec vlastnej scény po vstupe tému zahodí (sceneSeen sa dorovnal)
  assert.equal(mode.active, null);
  await mode.enter('flights'); // počas vstupu si návštevník otvoril úžinu
  assert.equal(mode.active, null);
  assert.equal(chip(w.doc).hidden, true);
});

test('akcia, ktorá dobehne až po Späť, sa dozvie, že už neplatí; zaseknutá obnova stavu režim nezablokuje', async () => {
  const w = world();
  let ctxSeen = null;
  const mode = createThemeMode({ ...w.deps, waitReady: () => new Promise(() => {}), runs: { ukraine: (ctx) => { ctxSeen = ctx; return new Promise(() => {}); } } });
  const entering = mode.enter('ukraine');
  await tick();
  w.timers.at(-1).fn(); // strop čakania na obnovu stavu
  await tick(); await tick();
  assert.ok(ctxSeen, 'akcia sa spustila aj bez dobehnutej obnovy');
  assert.equal(ctxSeen.isCurrent(), true);
  w.timers.at(-1).fn(); // strop čakania na scénu
  await entering;
  await mode.back();
  assert.equal(ctxSeen.isCurrent(), false);
});

test('kde návrat nie je dovolený, tlačidlo nemlčí a paleta ho neponúka', async () => {
  const w = world();
  const mode = createThemeMode({ ...w.deps, runs: { flights: () => {} } });
  assert.equal(mode.canBack(), false);
  await mode.enter('flights');
  assert.equal(mode.canBack(), true);
  w.state.allowed = false;
  assert.equal(mode.canBack(), false);
  assert.equal(await mode.back(), false);
  assert.deepEqual(w.state.notes, ['theme.back-blocked']);
  for (const strings of [EN_STRINGS, SK_STRINGS]) assert.ok(strings['theme.back-blocked']);
});

test('fokus z klávesnice ide na Späť hneď pri vstupe, nie až po dobehnutí scény', async () => {
  const w = world();
  const mode = createThemeMode({ ...w.deps, runs: { ukraine: () => new Promise(() => {}) } });
  void mode.enter('ukraine', { keyboard: true });
  await tick(); await tick();
  assert.equal(mode.busy, true);
  assert.equal(w.doc.activeElement, backButton(w.doc));
});

test('fokus: vstup z klávesnice ide na Späť; pri skrytí sa fokus najprv presunie inam', async () => {
  const w = world();
  const mode = createThemeMode({ ...w.deps, runs: { flights: () => {} } });
  await mode.enter('flights');
  assert.equal(w.doc.activeElement, null, 'myšou sa fokus nekradne');
  await mode.back();
  await mode.enter('flights', { keyboard: true });
  assert.equal(w.doc.activeElement, backButton(w.doc));
  await mode.back();
  assert.equal(w.doc.activeElement, w.fallback);
  assert.equal(chip(w.doc).hidden, true);
});

test('zapojenie v main.js: uvítanie, pás, paleta a scény idú cez režim tém', () => {
  const main = read('./main.js');
  assert.match(main, /actions: Object\.fromEntries\(THEMES\.map\(\(th\) => \[th\.id, \(event\) => \{ void themeMode\.enter\(th\.id, \{ keyboard: event\?\.detail === 0 \}\); \}\]\)\)/);
  assert.match(main, /ukraine: \(\) => \{ void themeMode\.enter\('ukraine'\); \}/, 'ranné hlásenie v páse „Čo sa deje teraz"');
  assert.match(main, /onSceneState: \(kind\) => \{ lastSceneKind = String\(kind \|\| ''\); themeModeRef\?\.onSceneState\(kind\); \}/);
  assert.match(main, /sceneKind: \(\) => lastSceneKind,/);
  assert.match(main, /return conflict \? conflictScenes\.load\(\)\.then\(\(\) => \(ctx\?\.isCurrent\?\.\(\) === false \? null : conflictScenes\.run\(kind, conflict\.sceneId\)\)\) : null;/, 'režim čaká na sľub scény; po Späť sa scéna už nespustí');
  assert.match(main, /ukraine: \(ctx\) => runOverview\('ukraine', 'front', 'ukraine-panel', ctx\)/);
  assert.match(main, /if \(themeModeRef\.active && themeModeRef\.canBack\(\)\) cmds\.push\(\{ id: 'theme:back'/, 'paleta neponúka návrat, ktorý by nič nespravil');
  assert.match(main, /setProperty\('--oko-theme-karta-top'/, 'poloha čipu pod titulkom KARTY sa meria');
  assert.match(main, /themesBtn\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(main, /leaveScene: \(\) => window\.__godsEyeView\.leaveScene\?\.\(\{ keepView: true \}\) \|\| null/);
  assert.match(main, /waitReady: \(\) => Promise\.resolve\(styleManager\.initialRestorePromise\)/);
  assert.match(main, /canEnter: \(\) => canEnterTheme\(\{ bodyClasses: document\.body\.classList, volbyActive: Boolean\(window\.__godsEyeView\.volbyMapMode\?\.active\) \}\)/);
  assert.match(main, /setLayer: \(id, on, origin\) => dataManager\.setEnabled\(id, on, origin \? \{ origin \} : undefined\)/);
  assert.match(main, /id: 'theme:back'/);
  assert.match(main, /id: `theme:\$\{th\.id\}`/);
  assert.match(main, /themesBtn\.id = 'oko-themes-btn'/);
  assert.doesNotMatch(main, /frameOverview/);
  assert.equal(TOP_BAR_CAPTIONS['oko-themes-btn'], 'actions.caption.themes');
});

test('scény konfliktov: odchod bez vlastného vracania a hlásenie zmeny', () => {
  const scenes = read('./conflictScenes.js');
  assert.match(scenes, /const exitUkraine = \(\{ keepView = false \} = \{\}\) => \{/);
  assert.match(scenes, /if \(!keepView\) restoreAutoKarta\(\);\n    if \(!activeChokepoint && !activeTheatre\) revealGate\.deactivate\(\);/);
  assert.match(scenes, /if \(!keepView\) for \(const layerId of frontDisabledLayerIds\)/);
  assert.match(scenes, /if \(!keepView && hadScene && pose && viewer\?\.camera\?\.flyTo\)/);
  assert.match(scenes, /const exitSeq = frontExitSeq;/, 'stráž počíta odchody, nie vstupy — dva rýchle smery dopíšu oba');
  assert.match(scenes, /if \(exitSeq === frontExitSeq\) \{ for \(const layerId of disabled\)/);
  assert.match(scenes, /else for \(const layerId of disabled\) \{ try \{ dataManager\.setEnabled\(layerId, true\); \}/, 'vrstvy vypnuté po odchode sa vrátia hneď');
  assert.doesNotMatch(scenes, /frontRunSeq/);
  assert.match(scenes, /showBase: \(\) => \(activeFrontScene \? ukraineBase\.show\(\) : null\),/);
  assert.match(scenes, /if \(!viewer\?\.camera\?\.flyTo \|\| !scene\?\.rectDegrees \|\| !activeFrontScene\) return null;/, 'po odchode sa už neletí nad front');
  assert.match(scenes, /onSceneState\?\.\(activeTheatre \? 'mideast' : activeFrontScene \? 'ukraine' : activeChokepoint \? 'chokepoint' : ''\)/);
  const leave = scenes.slice(scenes.indexOf('const leaveScene = '), scenes.indexOf('window.__godsEyeView.leaveScene = leaveScene'));
  assert.ok(leave.length > 200);
  assert.match(leave, /const kartaPrev = autoKartaPrev;\n    if \(keepView\) autoKartaPrev = null;\n    if \(activeFrontScene\) exitUkraine\(\{ keepView \}\);/, 'podklad sa prečíta skôr, než ho odchod vynuluje');
  for (const call of ['straitTrafficChip.hide()', 'oilPriceChip.hide()', 'setScenePin(null)', "countryBoundaries.release('mideast-theatre')", 'revealGate.deactivate()', 'incidentCards.clear()']) assert.ok(leave.includes(call), call);
  assert.match(leave, /return \{ kartaPrev: kartaPrev \|\| null \};/);
  assert.match(scenes, /exportConflict, exitUkraine, leaveScene,/);
});

test('štýly: čip má svoju vrstvu, na telefóne berie miesto pilulky a ustupuje ostatným režimom', () => {
  const css = read('../style.css');
  const block = css.slice(css.indexOf('Čip témy (2026-11-12'), css.indexOf('Ikony Material Symbols Outlined — vlastný výrez'));
  assert.ok(block.length > 500, 'blok je pred ikonami (tie musia ostať posledné)');
  assert.match(block, /#oko-theme \{[^}]*z-index: var\(--z-popover\);/);
  assert.match(block, /#oko-theme\[hidden\] \{ display: none; \}/);
  assert.match(block, /body\.oko-mobile #oko-theme \{[^}]*min-height: 44px;/);
  assert.match(block, /body\.oko-mobile\.oko-theme-active #oko-now \{ display: none; \}/);
  assert.match(block, /body\.oko-mobile #top-center-actions > #oko-themes-btn \{ display: none; \}/);
  assert.match(block, /body\.oko-mobile \.oko-theme-back \{ min-height: 44px; \}/, 'dotykový cieľ 44 px');
  assert.match(block, /top: var\(--oko-theme-karta-top, 180px\)/, 'pod titulkom KARTY podľa merania');
  for (const sel of ['body.oko-sheet-open #oko-theme', 'body:has(#oko-welcome) #oko-theme', 'body:has(.oko-now-list:not([hidden])) #oko-theme', 'body:has(#account-menu:not([hidden])) #oko-theme', 'body.cockpit-mode #oko-theme', 'body.ui-clean-view #oko-theme', 'body.recording-mode #oko-theme', 'body.embed-mode #oko-theme', 'body.oko-mobile.oko-karta-frame #oko-theme', 'body:has(#volby-panel:not(.collapsed)) #oko-theme', 'body.oko-theme-active:not(.oko-mobile) #traffic-sync-chip']) {
    assert.ok(block.includes(sel), sel);
  }
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b(?![^{]*\{)/, 'len tokeny, žiadna farba natvrdo');
  assert.match(read('./ukraineEventsLayer.js'), /'\.oko-now-pill', '\.oko-now-list', '#oko-theme'/, 'karty správ sa čipu vyhnú');
});
