// src/mideastPanel.test.mjs — telo panela BLÍZKY VÝCHOD (etapa 1): stavový riadok,
// zoznam dejísk, miesto pre správy, poctivá poznámka; plus nástražné drôty na
// všetky ručné zoznamy, ktoré panel v pruhu musí prejsť (index.html, style.css,
// ui.js, sharelink.js, mobileShell.js, i18n). Lekcia zo ZÁLIV-u: 4 z 5 zoznamov
// boli neúplné, kým ich netestoval nikto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createMideastPanel, swatchColour } from './mideastPanel.js';
import { listMideastTheatres } from './data/mideastTheatres.js';
import { MIDEAST_CONTROL_MODULES } from './data/wikiControl.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';
import { airspaceModels } from './airspaceAdvisoryLayer.js';
import { parseUkmtoIncidents, ukmtoSummary } from './data/ukmto.js';

function fakeDocument() {
  const makeEl = (tag) => {
    const classes = new Set();
    const el = {
      tag, children: [], textContent: '', hidden: false, disabled: false, dataset: {}, attrs: {}, listeners: {}, type: '',
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
      appendChild(c) { el.children.push(c); return c; },
      replaceChildren(...cs) { el.children = [...cs]; },
      href: '', target: '', rel: '',
      addEventListener(t, fn) { el.listeners[t] = fn; },
      setAttribute(k, v) { el.attrs[k] = v; },
      click() { el.listeners.click?.(); },
    };
    return el;
  };
  return { createElement: makeEl };
}
const walk = (node, out = []) => { for (const c of node.children) { out.push(c); walk(c, out); } return out; };
const byClass = (root, cls) => walk(root).filter((n) => n.classList.contains(cls));
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

// Dejiská z tabuľky plánu (kap. 2) ako lokálna fixtúra: test panela nesmie
// závisieť od obsahu katalógu src/data/mideastTheatres.js (vlastní ho iný krok),
// len od tvaru { id, name, overview? }. Popisok dodáva vložené labelFor.
const THEATRES = Object.freeze([
  { id: 'overview', name: 'Region overview', overview: true },
  { id: 'hormuz', name: 'Hormuz and the blockade' },
  { id: 'gulf', name: 'Gulf — infrastructure' },
  { id: 'iran', name: 'Iran — strikes' },
  { id: 'south-lebanon', name: 'South Lebanon' },
  { id: 'gaza', name: 'Gaza' },
  { id: 'israel', name: 'Israel — alerts and impacts' },
  { id: 'west-bank', name: 'West Bank' },
  { id: 'red-sea', name: 'Yemen and Bab al-Mandab' },
  { id: 'yemen', name: 'Yemen — whole country' },
  { id: 'south-syria', name: 'South Syria' },
  { id: 'iraq', name: 'Iraq' },
]);
const labelFor = (scene, translate) => {
  const key = `theatre.${scene.id}.name`;
  const translated = translate(key);
  return translated === key ? scene.name : translated;
};

test('bez cieľa alebo dokumentu je panel neškodný', () => {
  const inert = createMideastPanel({ mountTarget: null, theatres: THEATRES, labelFor, documentRef: fakeDocument() });
  assert.equal(inert.element, null);
  assert.equal(inert.newsMount, null);
  assert.equal(inert.activeTheatre, null);
  inert.setActiveTheatre('gaza'); inert.destroy();
  const noDoc = createMideastPanel({ mountTarget: {}, theatres: THEATRES, labelFor, documentRef: null });
  assert.equal(noDoc.element, null);
});

test('kostra: stav, 12 dejísk (prehľad prvý a čiarkovaný), miesto pre správy, poctivá poznámka', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const panel = createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, translate: tKey, lang: 'sk', documentRef: doc });
  assert.equal(panel.element, mount);
  const status = byClass(mount, 'mideast-status')[0];
  assert.equal(status.textContent, 'mideast.status');
  assert.equal(status.dataset.state, 'ready');
  assert.ok(status.classList.contains('gas-status'), 'stav sedí na štýle PLYN');
  const titles = byClass(mount, 'mideast-section-title');
  assert.deepEqual(titles.map((x) => x.textContent), ['mideast.theatres', 'mideast.pw.title', 'mideast.news.title']);
  const group = byClass(mount, 'mideast-dirs')[0];
  assert.equal(group.attrs.role, 'group');
  assert.equal(group.attrs['aria-label'], 'mideast.theatres');
  const dirs = byClass(mount, 'mideast-dir');
  assert.equal(dirs.length, 12);
  assert.deepEqual(dirs.map((d) => d.dataset.theatre), THEATRES.map((s) => s.id));
  assert.equal(dirs[0].dataset.theatre, 'overview');
  assert.equal(dirs[0].classList.contains('is-overview'), true);
  assert.equal(dirs.slice(1).some((d) => d.classList.contains('is-overview')), false, 'čiarkovaný je len prehľad');
  assert.equal(dirs.every((d) => d.attrs['aria-pressed'] === 'false' && d.type === 'button'), true);
  // tKey vráti kľúč = „preklad chýba" → popisok padne na stabilné EN meno.
  const gazaName = byClass(dirs.find((d) => d.dataset.theatre === 'gaza'), 'mideast-dir-name')[0];
  assert.equal(gazaName.textContent, 'Gaza');
  const news = byClass(mount, 'mideast-news')[0];
  assert.ok(news, 'miesto pre správy existuje');
  assert.equal(panel.newsMount, news);
  assert.equal(news.dataset.mideastNews, '');
  assert.equal(byClass(mount, 'mideast-note')[0].textContent, 'mideast.note');
  assert.equal(panel.activeTheatre, null);
  // Etapa 5a: miesto pre kartu PRECHODY ÚŽINAMI (plní ju portwatchCard.js z main.js).
  const transits = byClass(mount, 'mideast-transits')[0];
  assert.equal(panel.transitsMount, transits);
  assert.equal(transits.dataset.mideastTransits, '');
  // Poradie v tele: stav → titulok → dejiská → titulok → prechody → titulok → správy → poznámka.
  assert.deepEqual(mount.children.map((c) => c.className.split(' ')[0]), ['mideast-status', 'mideast-section-title', 'mideast-dirs', 'mideast-section-title', 'mideast-transits', 'mideast-section-title', 'mideast-news', 'mideast-note']);
});

test('skutočný katalóg: predvolený popisok je theatreLabel (EN meno bez prekladu, SK s prekladom), prehľad prvý', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const theatres = listMideastTheatres();
  createMideastPanel({ mountTarget: mount, theatres, translate: tKey, documentRef: doc });
  const dirs = byClass(mount, 'mideast-dir');
  assert.equal(dirs.length, theatres.length);
  assert.equal(dirs[0].dataset.theatre, theatres[0].id);
  assert.equal(dirs[0].classList.contains('is-overview'), true, 'katalóg má prehľad prvý');
  assert.deepEqual(dirs.map((d) => byClass(d, 'mideast-dir-name')[0].textContent), theatres.map((s) => s.name), 'tKey = preklad chýba → stabilné EN meno');
  const mountSk = doc.createElement('div');
  createMideastPanel({ mountTarget: mountSk, theatres, translate: (k) => SK_STRINGS[k] ?? k, lang: 'sk', documentRef: doc });
  const gazaSk = byClass(mountSk, 'mideast-dir').find((d) => d.dataset.theatre === 'gaza');
  assert.equal(byClass(gazaSk, 'mideast-dir-name')[0].textContent, SK_STRINGS['theatre.gaza.name'] ?? 'Gaza');
});

test('prázdny zoznam dejísk = kostra bez tlačidiel, nič nepadá', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const panel = createMideastPanel({ mountTarget: mount, translate: tKey, documentRef: doc });
  assert.equal(byClass(mount, 'mideast-dir').length, 0);
  panel.setActiveTheatre('gaza');
  assert.equal(panel.activeTheatre, 'gaza', 'aktívne dejisko sa pamätá aj bez tlačidla');
});

test('interakcie: klik na dejisko volá applyTheatre a zvýrazní ho; setActiveTheatre zvonka prepne', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const applied = [];
  const panel = createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, translate: tKey, documentRef: doc, applyTheatre: (id) => { applied.push(id); } });
  const dir = (id) => byClass(mount, 'mideast-dir').find((d) => d.dataset.theatre === id);
  dir('gaza').click();
  assert.deepEqual(applied, ['gaza']);
  assert.equal(panel.activeTheatre, 'gaza');
  assert.equal(dir('gaza').classList.contains('is-active'), true);
  assert.equal(dir('gaza').attrs['aria-pressed'], 'true');
  assert.equal(dir('overview').classList.contains('is-active'), false);
  panel.setActiveTheatre('red-sea');
  assert.equal(panel.activeTheatre, 'red-sea');
  assert.equal(dir('gaza').classList.contains('is-active'), false);
  assert.equal(dir('gaza').attrs['aria-pressed'], 'false');
  assert.equal(dir('red-sea').classList.contains('is-active'), true);
  assert.equal(dir('red-sea').attrs['aria-pressed'], 'true');
  assert.deepEqual(applied, ['gaza'], 'setActiveTheatre zvonka nespúšťa scénu znova');
  panel.setActiveTheatre(null);
  assert.equal(panel.activeTheatre, null);
  assert.equal(byClass(mount, 'mideast-dir').some((d) => d.classList.contains('is-active')), false);
  // Bez applyTheatre klik len zvýrazní.
  const mount2 = doc.createElement('div');
  const panel2 = createMideastPanel({ mountTarget: mount2, theatres: THEATRES, labelFor, translate: tKey, documentRef: doc });
  byClass(mount2, 'mideast-dir').find((d) => d.dataset.theatre === 'iraq').click();
  assert.equal(panel2.activeTheatre, 'iraq');
});

test('destroy vyprázdni telo', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const panel = createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, translate: tKey, documentRef: doc });
  assert.ok(mount.children.length > 0);
  panel.destroy();
  assert.equal(mount.children.length, 0);
});

test('tripwires: markup v index.html, poradie a skrývanie v style.css, ui.js, sharelink.js, mobileShell.js, i18n EN/SK', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const sharelink = readFileSync(new URL('./sharelink.js', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('./mobileShell.js', import.meta.url), 'utf8');

  // index.html: panel v zóne KONFLIKTY hneď za UKRAJINOU a pred nadpisom ENERGIA;
  // bývalý #gulf-panel zanikol (2026-09-26).
  assert.match(html, /id="mideast-panel" class="panel-collapsible collapsed" data-panel-id="mideast-panel"/, 'panel štartuje zbalený — deterministický default pre príjemcov odkazov');
  assert.match(html, /data-i18n="panel\.mideast"/);
  assert.match(html, /class="mideast-panel-inner scene-panel-inner"/);
  assert.match(html, /data-collapse-target="mideast-panel"/);
  assert.match(html, /<div class="mideast-body" data-mideast-body><\/div>/);
  assert.doesNotMatch(html, /gulf-panel/, 'BLÍZKY VÝCHOD pohltil panel ZÁLIV — z markupu má zmiznúť celý');
  assert.doesNotMatch(html, /data-gulf-body|gulf-body|gulf-panel-inner/);
  const ukraineAt = html.indexOf('id="ukraine-panel"');
  const mideastAt = html.indexOf('id="mideast-panel"');
  const energyAt = html.indexOf('data-lane-zone="energy"');
  assert.ok(ukraineAt > 0 && ukraineAt < mideastAt && mideastAt < energyAt, 'BLÍZKY VÝCHOD sedí medzi UKRAJINOU a nadpisom ENERGIA');
  // SCÉNY: rozbaľovačka dejísk vedľa smerov frontu (kľúče mideast.pick /
  // mideast.select-aria dodáva katalóg dejísk, tu sa pinuje len markup).
  assert.match(html, /<div class="scene-controls scene-mideast">\s*<select id="mideast-select" aria-label="[^"]+" data-i18n-aria="mideast\.select-aria">\s*<option value="" data-i18n="mideast\.pick">/);
  assert.ok(html.indexOf('id="front-select"') < html.indexOf('id="mideast-select"') && html.indexOf('id="mideast-select"') < html.indexOf('id="scene-select"'), 'dejiská za smermi frontu a pred receptami scén');

  // style.css: order v dekáde KONFLIKTY (zdedený po ZÁLIV-e), rozbalený vnútrajšok
  // v oboch ručných zoznamoch, zbalené telo skryté (selektor začína #mideast-panel.collapsed).
  assert.match(css, /#left-panel-stack > #mideast-panel \{ order: 22; \}/);
  assert.equal([...css.matchAll(/#left-panel-stack > #mideast-panel:not\(\.collapsed\) \.mideast-panel-inner/g)].length, 2, 'height:100% aj overflow-y zoznam');
  assert.match(css, /\n#mideast-panel\.collapsed \.mideast-body \{ display: none; \}/);
  for (const cls of ['mideast-body', 'mideast-section-title', 'mideast-dirs', 'mideast-dir', 'mideast-dir-name', 'mideast-note', 'mideast-news']) {
    assert.match(css, new RegExp(`\\n\\.${cls}(?:[,\\s{]|:hover)`), `pravidlo .${cls}`);
  }
  assert.match(css, /\.mideast-dir\.is-overview \{[^}]*border-style: dashed/);
  assert.match(css, /\.mideast-dir\.is-active \{[^}]*var\(--accent\)/);
  assert.match(css, /\.ukraine-dir \{/, 'triedy ukraine-* ostávajú — kópia, nie premenovanie');
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(cssNoComments, /gulf/, 'mŕtve pravidlá .gulf-*/#gulf-panel preč');

  // ui.js: stav panela v odkaze + upratanie pri vstupe do Cockpitu.
  assert.match(ui, /SHARE_PANEL_STATE_SPECS = Object\.freeze\(\[[\s\S]*?\{ id: 'mideast-panel' \},[\s\S]*?\]\);/);
  assert.match(ui, /COCKPIT_ENTRY_COLLAPSE_PANEL_IDS = Object\.freeze\(\[[\s\S]*?'mideast-panel',[\s\S]*?\]\);/);
  assert.doesNotMatch(ui, /gulf-panel/);

  // sharelink.js: token 'f' zdedený po ZÁLIV-e, presné medzery (panelLaneCss parsuje zdroj).
  assert.match(sharelink, /\n  \{ id: 'mideast-panel', token: 'f', pinnable: false \},/);
  assert.doesNotMatch(sharelink, /\{ id: 'gulf-panel'/);

  // mobileShell.js: bez záznamu v sekcii DÁTA je panel na telefóne nedostupný.
  assert.match(mobile, /id: 'data',[^\n]*panelIds: Object\.freeze\(\[[^\]]*'mideast-panel'[^\]]*\]\)/);
  assert.doesNotMatch(mobile, /gulf-panel/);

  // i18n: kľúče panela v oboch slovníkoch; poctivá poznámka menuje líniu frontu.
  for (const key of ['panel.mideast', 'mideast.status', 'mideast.theatres', 'mideast.news.title', 'mideast.note']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.equal(EN_STRINGS['panel.mideast'], 'MIDDLE EAST');
  assert.equal(SK_STRINGS['panel.mideast'], 'BLÍZKY VÝCHOD');
  assert.match(SK_STRINGS['mideast.note'], /línia frontu/);
  assert.match(SK_STRINGS['mideast.note'], /zdroj a vek/);
  assert.match(EN_STRINGS['mideast.note'], /front line/);
  assert.match(SK_STRINGS['mideast.status'], /neoverené/);
  assert.match(EN_STRINGS['mideast.status'], /unverified/);
});

// Zapojenie v main.js (agent C, 2026-09-26): panel, bulletin v jeho slote správ,
// window API, deep link, rozbaľovačka SCÉNY, tri vzájomne výlučné premenné scény
// a rámovanie cez Cartesian3. Nástražné drôty nad textom zdroja — rovnaký vzor
// ako ukraineAlertAreasLayer.test.mjs a gasPanel.test.mjs.
test('tripwires main.js: panel + bulletin v ňom, window API dejísk, ?mideast=, #mideast-select, výlučnosť scén, bez #gulf-panel', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

  // Importy z katalógu dejísk a panela.
  assert.match(main, /import \{ MIDEAST_BULLETIN_REGIONS, applyMideastTheatre, listMideastTheatres, theatreById, theatreFraming, theatreLabel \} from '\.\/data\/mideastTheatres\.js';/);
  assert.match(main, /import \{ createMideastPanel \} from '\.\/mideastPanel\.js';/);

  // Panel sa montuje do tela #mideast-panel a klik na dejisko volá runMideastTheatre.
  assert.match(main, /createMideastPanel\(\{\s*mountTarget: document\.querySelector\('#mideast-panel \[data-mideast-body\]'\),\s*theatres: listMideastTheatres\(\),\s*applyTheatre: \(id\) => runMideastTheatre\(id\),/);
  assert.match(main, /window\.__godsEyeView\.mideastPanel = mideastPanel;/);
  // Bulletin bývalého ZÁLIV-u žije v slote správ panela (vnútri [data-panel-id],
  // aby sa načítal lenivo); verejný debug handle ostáva. Etapa 3 (2026-09-26):
  // predvolený je celý región a čipy nesú región každého dejiska.
  assert.match(main, /createConflictBulletin\(\{ mountTarget: mideastPanel\.newsMount, region: 'mideast', regions: MIDEAST_BULLETIN_REGIONS \}\)/);
  assert.match(main, /window\.__godsEyeView\.conflictBulletin = conflictBulletin;/);
  assert.doesNotMatch(main, /gulf-panel|data-gulf-body/, 'starý mount #gulf-panel zanikol');

  // Window API pre hlas/paletu, deep link a rozbaľovačka SCÉNY.
  assert.match(main, /window\.__godsEyeView\.mideastTheatres = \{ list: listMideastTheatres, apply: runMideastTheatre \};/);
  assert.match(main, /\.get\('mideast'\)/);
  assert.match(main, /theatreById\(requestedTheatre\)/, 'id sa overí pred čakaním na obnovu stavu');
  assert.match(main, /frontSceneById\(params\.get\('front'\) \|\| ''\) \|\| chokepointSceneById\(params\.get\('chokepoint'\) \|\| ''\)/, 'dejisko ustúpi len PLATNÉMU ?front=/?chokepoint=');
  assert.match(main, /getElementById\('mideast-select'\)/);
  assert.match(main, /theatrePicker\.value = '';/, 'po výbere reset na placeholder');

  // Tri premenné scény sú vzájomne výlučné a režim mapy ich pozná všetky.
  assert.match(main, /let activeTheatre = null;/);
  assert.equal([...main.matchAll(/Boolean\(activeFrontScene \|\| activeChokepoint \|\| activeTheatre\)/g)].length, 2, 'syncMapFocus + revealGate.onChange');
  assert.match(main, /if \(activeTheatre\) return conflictById\(`mideast:\$\{activeTheatre\.id\}`\);/);
  assert.match(main, /else if \(conflict\.kind === 'mideast-theatre'\) \{[\s\S]*?await runMideastTheatre\(conflict\.sceneId\);/);
  assert.match(main, /activeChokepoint = null; activeFrontScene = null; activeTheatre = null;/, 'všeobecná vetva frameConflict nuluje aj dejisko');
  const runFront = main.slice(main.indexOf('const runFrontScene = (id) =>'), main.indexOf('const ukraineDirectionCard'));
  const runChoke = main.slice(main.indexOf('const runChokepointScene = (id) =>'), main.indexOf('window.__godsEyeView.chokepointScenes'));
  for (const [name, body] of [['runFrontScene', runFront], ['runChokepointScene', runChoke]]) {
    assert.match(body, /activeTheatre = null;/, `${name} nuluje dejisko`);
    assert.match(body, /mideastPanel\?\.setActiveTheatre\?\.\(null\);/, `${name} zhasne zvýraznenie v paneli`);
  }
  const runTheatre = main.slice(main.indexOf('const runMideastTheatre = (id) =>'), main.indexOf('window.__godsEyeView.mideastTheatres'));
  assert.match(runTheatre, /activeFrontScene = null;/);
  assert.match(runTheatre, /activeChokepoint = null;/);
  assert.match(runTheatre, /revealGate\.activate\(scene\.center\);/);
  assert.match(runTheatre, /setScenePin\(scene, theatreLabel\(scene\)\);/, 'pin s prekladom dejiska, nie chokepointSceneLabel');
  assert.match(runTheatre, /countryBoundaries\.retain\('mideast-theatre'\)/);
  assert.match(runTheatre, /incidentCards\.showFor\(scene\.newsRegion\)/);
  assert.match(runTheatre, /return applyMideastTheatre\(id, theatreDeps\);/);

  // Rámovanie: Cartesian3 + orientácia z theatreFraming, nikdy Rectangle.
  const deps = main.slice(main.indexOf('const theatreDeps = {'), main.indexOf('const runMideastTheatre'));
  assert.match(deps, /theatreFraming\(scene\.rectDegrees, \{ overview: Boolean\(scene\.overview\) \}\)/);
  assert.match(deps, /Cesium\.Cartesian3\.fromDegrees\(framing\.lon, framing\.lat, framing\.heightM\)/);
  assert.doesNotMatch(deps, /Cesium\.Rectangle/, 'Rectangle destination pri streamujúcich 3D dlaždiciach ticho nič nespraví');
  assert.match(deps, /dataManager\.setEnabled\(layerId, true, \{ origin: 'user' \}\)/);
  // Pin: popisok je parameter (úžiny ostávajú na chokepointSceneLabel).
  assert.match(main, /const setScenePin = \(scene, labelText = scene \? chokepointSceneLabel\(scene\) : ''\) =>/);
  // Oponentúra 2026-09-26: bulletin v paneli prepne región dejiska, čip úžiny sa skryje,
  // deep link ustúpi len PLATNÉMU ?front/?chokepoint.
  const runBlock = main.slice(main.indexOf('const runMideastTheatre = '), main.indexOf('window.__godsEyeView.mideastTheatres'));
  assert.match(runBlock, /conflictBulletin\?\.setRegion\?\.\(scene\.newsRegion\)/);
  assert.match(runBlock, /straitTrafficChip\.hide\(\)/);
  assert.match(main, /const otherSceneRequested = Boolean\(frontSceneById\(params\.get\('front'\) \|\| ''\) \|\| chokepointSceneById\(params\.get\('chokepoint'\) \|\| ''\)\)/);
});

// ── Etapa 2 (2026-09-26): čip KONTROLA SÍDIEL + legenda po moduloch Wikipédie ──────
// Správca (src/mideastControlLayer.js) je falošný: panel číta len getState/onChange/
// isEnabled/setEnabled a nič si nedomýšľa.
function fakeControl(initial = {}) {
  let state = { enabled: true, visible: true, theatreId: null, day: null, style: 'default', modules: [], ...initial };
  const listeners = new Set();
  const calls = [];
  const api = {
    calls,
    getState: () => state,
    isEnabled: () => state.enabled,
    setEnabled(on) { calls.push(['setEnabled', on]); api.emit({ enabled: Boolean(on) }); return Promise.resolve(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(patch) { state = { ...state, ...patch }; for (const fn of listeners) fn(state); },
    get listenerCount() { return listeners.size; },
  };
  return api;
}
const ipModule = (over = {}) => ({
  id: 'israel-palestine', shown: true, loading: false, error: null, revisionAt: '2026-09-22T18:56:08Z', requestedAt: '2026-09-26', ageDays: 3, stale: false, count: 5,
  summary: { settlements: { israel: 2, hamas: 1, contested: 1, mixed: 0, none: 0 }, infrastructure: { israel: 1 } },
  ...over,
});
const skDate = (iso) => new Intl.DateTimeFormat('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
const tSk = (k, v) => { const s = SK_STRINGS[k] ?? k; return v ? s.replace(/\{(\w+)\}/g, (m, name) => (name in v ? String(v[name]) : m)) : s; };

test('etapa 2 — čip KONTROLA SÍDIEL: rad čipov za dejiskami, prepína správcu, bez modulov dejiska je vypnutý a legenda skrytá; destroy odhlási', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const control = fakeControl();
  const panel = createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, control, translate: tKey, lang: 'sk', documentRef: doc });
  assert.deepEqual(mount.children.map((c) => c.className.split(' ')[0]), ['mideast-status', 'mideast-section-title', 'mideast-dirs', 'mideast-chips', 'mideast-legend', 'mideast-section-title', 'mideast-transits', 'mideast-section-title', 'mideast-news', 'mideast-note']);
  const chips = byClass(mount, 'mideast-chips')[0];
  assert.equal(chips.attrs.role, 'group');
  assert.equal(chips.attrs['aria-label'], 'mideast.part.layers', 'skupina čipov má neutrálny názov (od etapy 5b nesie aj VZDUŠNÝ PRIESTOR)');
  const chip = byClass(mount, 'mideast-chip-control')[0];
  assert.ok(chip.classList.contains('data-toggle-chip') && chip.classList.contains('mideast-chip'), 'štýl čipov riadkov DÁTA');
  assert.equal(chip.type, 'button');
  assert.equal(chip.dataset.part, 'control');
  assert.equal(chip.textContent, 'mideast.part.control');
  assert.equal(chip.attrs['aria-pressed'], 'true', 'správca je predvolene zapnutý');
  assert.equal(chip.classList.contains('active'), true);
  assert.equal(chip.disabled, true, 'dejisko bez modulov = čip vypnutý');
  assert.equal(chip.title, 'mideast.ctl.derived');
  const legend = byClass(mount, 'mideast-legend')[0];
  assert.equal(legend.hidden, true);
  assert.equal(legend.children.length, 0);
  chip.click();
  assert.deepEqual(control.calls, [['setEnabled', false]]);
  assert.equal(chip.attrs['aria-pressed'], 'false', 'stav sa vracia cez onChange, nie z kliku');
  assert.equal(chip.classList.contains('active'), false);
  chip.click();
  assert.deepEqual(control.calls, [['setEnabled', false], ['setEnabled', true]]);
  assert.equal(chip.attrs['aria-pressed'], 'true');
  assert.equal(control.listenerCount, 1);
  panel.destroy();
  assert.equal(control.listenerCount, 0);
  // Bez správcu ostáva kostra etapy 1 bez čipov (pinuje test „kostra" vyššie).
  const bare = doc.createElement('div');
  createMideastPanel({ mountTarget: bare, theatres: THEATRES, labelFor, translate: tKey, documentRef: doc });
  assert.equal(byClass(bare, 'mideast-chips').length, 0);
  assert.equal(swatchColour('#4fa3ff', 0.35), 'rgba(79, 163, 255, 0.35)');
  assert.equal(swatchColour('tomato', 0.35), 'tomato');
});

test('etapa 2 — legenda zo stavu správcu: titulok modulu, vzorky strán s počtom (farba modulu inline), sporné, zdroj s dátumom a vekom, ZASTARANÉ, načítava sa, chýba, porucha, dva moduly, vypnutý čip', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const control = fakeControl();
  createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, control, translate: tKey, lang: 'sk', documentRef: doc });
  const chip = byClass(mount, 'mideast-chip-control')[0];
  const legend = byClass(mount, 'mideast-legend')[0];
  control.emit({ theatreId: 'gaza', modules: [ipModule()] });
  assert.equal(chip.disabled, false);
  assert.equal(legend.hidden, false);
  const block = byClass(legend, 'mideast-legend-module')[0];
  assert.equal(block.dataset.module, 'israel-palestine');
  assert.equal(block.classList.contains('is-stale'), false);
  // tKey vráti kľúč = „preklad chýba" → titulok a popisy strán padnú na anglickú legendu modulu
  // z konfigurácie (ako theatreLabel na EN meno), nikdy na holý kľúč.
  assert.equal(byClass(block, 'mideast-legend-title')[0].textContent, 'Module:Israeli-Palestinian conflict detailed map');
  const items = byClass(block, 'mideast-legend-item');
  assert.deepEqual(items.map((i) => byClass(i, 'mideast-legend-label')[0].textContent), ['Israel', 'Hamas (Gaza administration)', 'mideast.ctl.contested'], 'len strany s bodmi (sídla + infraštruktúra) v poradí konfigurácie, potom sporné; zmiešané 0 = nič');
  assert.deepEqual(items.map((i) => byClass(i, 'mideast-legend-count')[0].textContent), ['3', '1', '1']);
  const swatches = items.map((i) => byClass(i, 'mideast-legend-swatch')[0].attrs.style);
  assert.match(swatches[0], /background: rgba\(79, 163, 255, 0\.35\); border-color: rgba\(79, 163, 255, 0\.7\)/, 'Izrael #4fa3ff z konfigurácie modulu');
  assert.match(swatches[1], /background: rgba\(168, 224, 95, 0\.35\)/, 'Hamas #a8e05f');
  assert.match(swatches[2], /background: #ffb547/, 'sporné plnou jantárovou ako bod na mape');
  assert.equal(items[2].classList.contains('is-contested'), true);
  const src = byClass(block, 'mideast-legend-source')[0];
  assert.equal(byClass(src, 'mideast-legend-since')[0].textContent, `mideast.ctl.since {"date":"${skDate('2026-09-22T18:56:08Z')}"} · mideast.ctl.source`);
  assert.match(src.title, /Israeli-Palestinian conflict detailed map · CC BY-SA 4\.0/, 'plný názov modulu v titulku riadka zdroja (atribúcia CC BY-SA)');
  const ages = byClass(src, 'mideast-legend-age');
  assert.equal(ages.length, 1, 'čerstvá snímka: vek bez značky');
  assert.equal(ages[0].textContent, '· ukraine.age.many {"n":3}');
  assert.equal(byClass(legend, 'mideast-legend-note')[0].textContent, 'mideast.ctl.derived');
  // Zastarané nad prahom modulu: jantárová značka ZASTARANÉ, blok nesie is-stale (tlmené vzorky).
  control.emit({ modules: [ipModule({ ageDays: 40, stale: true })] });
  const stale = byClass(legend, 'mideast-legend-module')[0];
  assert.equal(stale.classList.contains('is-stale'), true);
  const badge = byClass(stale, 'mideast-legend-age').find((a) => a.classList.contains('is-stale'));
  assert.equal(badge.textContent, 'ukraine.src.stale');
  assert.equal(badge.title, 'ukraine.src.stale-note');
  // Načítava sa / chýba (404) / porucha.
  control.emit({ modules: [ipModule({ revisionAt: null, loading: true, summary: null, count: 0 })] });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].textContent, 'mideast.ctl.loading');
  assert.equal(chip.classList.contains('is-loading'), true);
  control.emit({ modules: [ipModule({ revisionAt: null, error: 'no_control_snapshot', summary: null, count: 0 })] });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].textContent, 'mideast.ctl.missing');
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'missing');
  assert.equal(chip.classList.contains('is-loading'), false);
  control.emit({ modules: [ipModule({ revisionAt: null, error: 'HTTP 500', summary: null, count: 0 })] });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].textContent, 'mideast.ctl.error');
  assert.equal(byClass(legend, 'mideast-legend-item').length, 0, 'bez snímky bez vzoriek');
  control.emit({ modules: [ipModule({ revisionAt: null, error: 'bad_control_payload', summary: null, count: 0 })] });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'error', '200 bez snímky je porucha, nie prázdna snímka');
  // Zobrazená vrstva bez snímky, chyby aj načítavania = „ešte nie je" (nie večné načítavanie); nezobrazená ešte len čaká.
  control.emit({ modules: [ipModule({ revisionAt: null, summary: null, count: 0 })] });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'missing');
  control.emit({ modules: [ipModule({ revisionAt: null, shown: false, summary: null, count: 0 })] });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'loading');
  // Dva moduly (juh Libanonu) = dva bloky v poradí dejiska, každý vlastná legenda.
  control.emit({ theatreId: 'south-lebanon', modules: [ipModule(), ipModule({ id: 'lebanon', summary: { settlements: { laf: 4, hezbollah: 2, contested: 0, mixed: 0, none: 0 }, infrastructure: {} } })] });
  assert.deepEqual(byClass(legend, 'mideast-legend-module').map((b) => b.dataset.module), ['israel-palestine', 'lebanon']);
  const leb = byClass(legend, 'mideast-legend-module')[1];
  assert.deepEqual(byClass(leb, 'mideast-legend-label').map((l) => l.textContent), ['Lebanese Government forces', 'Hezbollah and allies'], 'legenda libanonského modulu, nie IP');
  assert.equal(byClass(legend, 'mideast-legend-note').length, 1, 'poznámka o odvodení raz pod celou legendou');
  // Vypnutý čip = legenda skrytá a prázdna.
  control.emit({ enabled: false });
  assert.equal(legend.hidden, true);
  assert.equal(legend.children.length, 0);
  assert.equal(chip.attrs['aria-pressed'], 'false');
  assert.equal(chip.disabled, false, 'dejisko má moduly — čip sa dá zapnúť späť');
  // So skutočným SK slovníkom: titulok modulu, popisy strán, riadok zdroja.
  const mountSk = doc.createElement('div');
  createMideastPanel({ mountTarget: mountSk, theatres: THEATRES, labelFor, control: fakeControl({ theatreId: 'gaza', modules: [ipModule()] }), translate: tSk, lang: 'sk', documentRef: doc });
  const blockSk = byClass(mountSk, 'mideast-legend-module')[0];
  assert.equal(byClass(blockSk, 'mideast-legend-title')[0].textContent, 'Izrael a Palestína');
  assert.deepEqual(byClass(blockSk, 'mideast-legend-label').map((l) => l.textContent), ['Izrael', 'Hamas (správa Gazy)', 'kontestované']);
  assert.equal(byClass(blockSk, 'mideast-legend-since')[0].textContent, `stav k ${skDate('2026-09-22T18:56:08Z')} · Wikipédia · CC BY-SA 4.0`);
  assert.equal(byClass(blockSk, 'mideast-legend-age')[0].textContent, '· pred 3 dňami');
  assert.equal(byClass(mountSk, 'mideast-legend-note')[0].textContent, 'zóny sú odvodené z bodov sídiel (Wikipédia), nie línia frontu');
});

test('etapa 2 — i18n: čip, stavy, druhy, titulok a KAŽDÁ strana každého modulu v EN aj SK; CSS čipov a legendy', () => {
  const fixed = ['mideast.part.control', 'mideast.ctl.loading', 'mideast.ctl.missing', 'mideast.ctl.error', 'mideast.ctl.derived', 'mideast.ctl.since', 'mideast.ctl.source', 'mideast.ctl.contested', 'mideast.ctl.mixed', 'mideast.ctl.none', 'mideast.ctl.pressure'];
  const kinds = ['airport', 'heliport', 'oilgas', 'hill', 'dam', 'border-crossing', 'port', 'industry', 'base', 'settlement', 'rural', 'other'].map((k) => `mideast.ctl.kind.${k}`);
  const perModule = MIDEAST_CONTROL_MODULES.flatMap((c) => [`mideast.ctl.${c.id}.title`, ...c.sides.map((s) => `mideast.ctl.${c.id}.${s.id}`)]);
  assert.ok(perModule.length >= 29, `4 tituly + 25 strán (${perModule.length})`);
  for (const key of [...fixed, ...kinds, ...perModule]) { assert.ok(EN_STRINGS[key], `EN ${key}`); assert.ok(SK_STRINGS[key], `SK ${key}`); }
  assert.equal(EN_STRINGS['mideast.part.control'], 'CONTROL OF SETTLEMENTS');
  assert.equal(SK_STRINGS['mideast.part.control'], 'KONTROLA SÍDIEL');
  assert.match(SK_STRINGS['mideast.ctl.derived'], /odvodené .* nie línia frontu/);
  assert.match(EN_STRINGS['mideast.ctl.derived'], /derived .* not a front line/);
  assert.match(SK_STRINGS['mideast.ctl.source'], /Wikipédia · CC BY-SA 4\.0/);
  assert.match(EN_STRINGS['mideast.ctl.source'], /Wikipedia · CC BY-SA 4\.0/);
  assert.equal(SK_STRINGS['mideast.ctl.israel-palestine.hamas'], 'Hamas (správa Gazy)');
  assert.equal(SK_STRINGS['mideast.ctl.yemen.houthi'], 'Ansarulláh (húsíovia) a spojenci', 'ako legenda modulu (Ansarullah … and allies), húsíovia malým ako TASR/SME');
  assert.equal(EN_STRINGS['mideast.ctl.yemen.houthi'], 'Ansarullah (Houthis) and allies');
  assert.match(SK_STRINGS['mideast.ctl.yemen.yemen-gov'], /^medzinárodne uznaná vláda a koalícia vedená Saudskou Arábiou$/);
  // Skratky vysvetlené pre laika (pravidlo projektu), správne „spriaznené", podstatné meno pri miestnych.
  assert.match(SK_STRINGS['mideast.ctl.yemen.aqap'], /al-Káida na Arabskom polostrove a spriaznené skupiny/);
  assert.doesNotMatch(SK_STRINGS['mideast.ctl.yemen.aqap'], /spojení/);
  assert.match(SK_STRINGS['mideast.ctl.syria.sdf'], /Sýrske demokratické sily \(SDF, kurdská samospráva\)/);
  for (const k of ['mideast.ctl.syria.isis', 'mideast.ctl.yemen.isis']) { assert.equal(SK_STRINGS[k], 'Islamský štát (ISIL)'); assert.equal(EN_STRINGS[k], 'Islamic State (ISIL)'); }
  for (const k of ['mideast.ctl.israel-palestine.lebanon-locals', 'mideast.ctl.lebanon.lebanon-locals']) { assert.equal(SK_STRINGS[k], 'miestni obyvatelia (Libanon)'); assert.equal(EN_STRINGS[k], 'local residents (Lebanon)'); }
  // Jeden pojem pre sporné sídlo v oboch moduloch: BLÍZKY VÝCHOD preberá zavedený pojem
  // UKRAJINY („kontestované") — texty UKRAJINY tento modul nemení (oponentúra 2026-09-26).
  assert.equal(SK_STRINGS['mideast.ctl.contested'], 'kontestované');
  assert.equal(SK_STRINGS['ukraine.ctl.contested'], SK_STRINGS['mideast.ctl.contested'], 'UKRAJINA a BLÍZKY VÝCHOD hovoria o spornom sídle rovnako');
  assert.match(SK_STRINGS['ukraine.ctl.counts'], /kontestovaných sídiel/);
  // Tlak z oblúka bez skloňovania mena strany („tlak Izrael" bolo negramatické).
  assert.equal(SK_STRINGS['mideast.ctl.pressure'], 'pod tlakom zo strany {side} · smer {dir}');
  assert.equal(EN_STRINGS['mideast.ctl.pressure'], 'pressed by {side} from {dir}');
  assert.equal(EN_STRINGS['mideast.ctl.syria.syria-gov'], 'Syrian transitional government and Turkish forces');
  // Tá istá modrá bodka = Izrael v IP a kmeňové sily v Jemene → kľúče nesú id modulu, legenda sa nezdieľa.
  assert.notEqual(SK_STRINGS['mideast.ctl.yemen.tribal'], SK_STRINGS['mideast.ctl.israel-palestine.israel']);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const cls of ['mideast-chips', 'mideast-chip', 'mideast-legend', 'mideast-legend-module', 'mideast-legend-item', 'mideast-legend-swatch', 'mideast-legend-source', 'mideast-legend-note']) {
    assert.match(css, new RegExp(`\\n\\.${cls}(?:[,\\s{]|:hover)`), `pravidlo .${cls}`);
  }
  assert.match(css, /\.mideast-legend-swatch \{[^}]*width: 10px;[^}]*height: 10px;/, 'vzorka 10 × 10 px');
  assert.match(css, /\.mideast-legend-age\.is-stale \{[^}]*#ffb547/, 'jantárová značka ZASTARANÉ');
  assert.match(css, /\.mideast-legend\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.mideast-chip:disabled \{[^}]*var\(--cursor-arrow\)/, 'vypnutý čip nie je „čaká sa"');
});

// ── Etapa 5b: VZDUŠNÝ PRIESTOR · EASA (2026-10-03) ────────────────────────────
// Modely zo skutočnej odpovede archívu (fixtúra) cez tú istú funkciu, ktorou ich robí vrstva.
const airPayload = JSON.parse(readFileSync(new URL('./data/fixtures/airspace-payload-20261003.json', import.meta.url), 'utf8'));
function fakeAirspace(initial = {}) {
  let state = { enabled: false, loading: false, error: null, fetchedAt: null, bulletins: [], missingFirs: [], ...initial };
  const listeners = new Set();
  const calls = [];
  const api = {
    calls,
    getState: () => state,
    isEnabled: () => state.enabled,
    setEnabled(on) { calls.push(['setEnabled', on]); api.emit({ enabled: Boolean(on) }); return Promise.resolve(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(patch) { state = { ...state, ...patch }; for (const fn of listeners) fn(state); },
    get listenerCount() { return listeners.size; },
  };
  return api;
}

test('etapa 5b — čip VZDUŠNÝ PRIESTOR vedľa KONTROLY SÍDIEL, legenda za ňou, vypnutý čip = skrytá legenda; destroy odhlási', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const airspace = fakeAirspace();
  const panel = createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, control: fakeControl(), airspace, translate: tKey, lang: 'sk', documentRef: doc });
  assert.deepEqual(mount.children.map((c) => c.className), ['mideast-status gas-status', 'mideast-section-title gas-card-title', 'mideast-dirs', 'mideast-chips', 'mideast-legend', 'mideast-legend mideast-air-legend', 'mideast-section-title gas-card-title', 'mideast-transits', 'mideast-section-title gas-card-title', 'mideast-news', 'mideast-note']);
  const chips = byClass(mount, 'mideast-chips')[0];
  assert.deepEqual(chips.children.map((c) => c.dataset.part), ['control', 'airspace']);
  const chip = byClass(mount, 'mideast-chip-airspace')[0];
  assert.equal(chip.textContent, 'mideast.part.airspace');
  assert.equal(chip.attrs['aria-pressed'], 'false', 'predvolene vypnuté — nič sa nesťahuje');
  assert.equal(chip.title, 'mideast.air.note');
  const legend = byClass(mount, 'mideast-air-legend')[0];
  assert.equal(legend.hidden, true);
  chip.click();
  assert.deepEqual(airspace.calls, [['setEnabled', true]]);
  assert.equal(chip.attrs['aria-pressed'], 'true');
  assert.equal(legend.hidden, false);
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'loading', 'zapnuté bez dát = načítava sa');
  airspace.emit({ error: 'no_airspace_snapshot' });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'missing');
  airspace.emit({ error: 'HTTP 500' });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'error');
  chip.click();
  assert.equal(legend.hidden, true);
  assert.equal(legend.children.length, 0);
  // len vzdušný priestor (bez správcu kontroly): rad čipov aj tak vznikne
  const solo = doc.createElement('div');
  createMideastPanel({ mountTarget: solo, theatres: THEATRES, labelFor, airspace: fakeAirspace(), translate: tKey, documentRef: doc });
  assert.deepEqual(byClass(solo, 'mideast-chips')[0].children.map((c) => c.dataset.part), ['airspace']);
  assert.equal(airspace.listenerCount, 1);
  panel.destroy();
  assert.equal(airspace.listenerCount, 0);
});

test('etapa 5b — legenda bulletinov: Blízky východ po riadkoch (krajiny SK, výšky, časť FIR, výnimky, platnosť, odkaz), zvyšok sveta jedným riadkom, zdroj a poznámka', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const airspace = fakeAirspace();
  createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, airspace, translate: tSk, lang: 'sk', documentRef: doc });
  airspace.emit({ enabled: true, fetchedAt: Date.parse('2026-10-03T12:00:00Z'), bulletins: airspaceModels(airPayload), attribution: 'Source: EASA', firAttribution: 'FIR boundaries: VATSpy' });
  const legend = byClass(mount, 'mideast-air-legend')[0];
  assert.equal(byClass(legend, 'mideast-legend-title')[0].textContent, 'Odporúčania EASA pre konfliktné zóny (CZIB)');
  const rows = byClass(legend, 'mideast-air-row');
  assert.deepEqual(rows.map((r) => r.dataset.czib), ['CZIB-2026-05-R2', 'CZIB-2026-07R3', 'CZIB-2017-03R20'], 'len Blízky východ, v poradí platnosti');
  const text = (row, cls) => byClass(row, cls).map((n) => n.textContent);
  const [iraq, gulf, syria] = rows;
  assert.deepEqual(text(iraq, 'mideast-air-name'), ['Irak']);
  assert.deepEqual(text(iraq, 'mideast-air-badge'), ['všetky výšky']);
  assert.deepEqual(text(iraq, 'mideast-air-until'), [`platí do ${skDate('2026-11-16T00:00:00Z')}`]);
  assert.equal(byClass(iraq, 'mideast-air-link')[0].href, 'https://www.easa.europa.eu/domains/air-operations/czibs/czib-2026-05-r2');
  assert.equal(byClass(iraq, 'mideast-air-link')[0].rel, 'noopener noreferrer');
  assert.equal(syria.classList.contains('is-partial'), true, 'Sýria: západne od čiary cez body');
  assert.deepEqual(text(gulf, 'mideast-air-name'), ['Bahrajn, Kuvajt, Katar, Omán, SAE']);
  assert.deepEqual(text(gulf, 'mideast-air-badge'), ['všetky výšky', 'časť FIR', 's výnimkami']);
  assert.match(byClass(gulf, 'mideast-air-badge')[1].title, /presná hranica je v texte bulletinu/);
  assert.equal(byClass(gulf, 'mideast-air-name')[0].title, 'Airspace of the Persian Gulf and Gulf of Oman', 'oficiálny názov EASA v titulku');
  assert.equal(byClass(legend, 'mideast-air-more')[0].textContent, '+ 2 ďalších vo svete: Líbya, Ukrajina');
  const src = byClass(legend, 'mideast-legend-source')[0];
  assert.equal(byClass(src, 'mideast-legend-since')[0].textContent, `stav k ${skDate('2026-10-03T12:00:00Z')} · EASA · hranice FIR približné (VATSpy, CC BY-SA 4.0)`);
  assert.equal(src.title, 'Source: EASA · FIR boundaries: VATSpy');
  assert.match(byClass(legend, 'mideast-legend-note')[0].textContent, /nie zákaz letov/);
  // uplynutá platnosť jantárovo, výpadok servera pri starých dátach = značka chyby
  airspace.emit({ bulletins: airspaceModels({ ...airPayload, bulletins: airPayload.bulletins.map((b) => ({ ...b, lapsed: b.nid === '143862' })) }), error: 'HTTP 502' });
  const iraq2 = byClass(legend, 'mideast-air-row').find((r) => r.dataset.czib === 'CZIB-2026-05-R2');
  assert.equal(byClass(iraq2, 'mideast-air-until')[0].classList.contains('is-stale'), true);
  assert.match(byClass(iraq2, 'mideast-air-until')[0].textContent, /^platnosť uplynula/);
  assert.equal(byClass(byClass(legend, 'mideast-legend-source')[0], 'is-stale')[0].textContent, 'bulletiny EASA sú nedostupné (chyba servera)');
});

test('etapa 5b — main.js: vrstva vzniká pred panelom a ide do neho; CSS legendy', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ createAirspaceAdvisory \} from '\.\/airspaceAdvisoryLayer\.js';/);
  // Vrstva musí existovať skôr, než ju panel dostane (poradie v súbore, nie presný tvar riadkov).
  const created = main.indexOf('const airspaceAdvisory = createAirspaceAdvisory({ viewer });');
  const panelAt = main.indexOf('const mideastPanel = createMideastPanel({');
  assert.ok(created > 0 && panelAt > created, 'vrstva vzniká pred panelom');
  assert.match(main, /window\.__godsEyeView\.airspaceAdvisory = airspaceAdvisory;/);
  assert.match(main, /createMideastPanel\(\{[\s\S]*?airspace: airspaceAdvisory,[\s\S]*?\}\);/);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const cls of ['.mideast-air-row', '.mideast-air-swatch', '.mideast-air-badge.is-partial', '.mideast-air-until.is-stale', '.mideast-air-link', '.mideast-air-more']) assert.ok(css.includes(cls), cls);
  assert.match(css, /\.mideast-air-row\.is-partial \.mideast-air-swatch \{ background: transparent; border-style: dashed; \}/, 'časť FIR = bez výplne ako na mape');
});

// ── Etapa 5c: INCIDENTY LODÍ · UKMTO (2026-10-03) ────────────────────────────
// Incidenty zo skutočnej odpovede UKMTO (fixtúra) cez parser archívu; súhrn cez ukmtoSummary.
const ukmtoIncidents = parseUkmtoIncidents(JSON.parse(readFileSync(new URL('./data/fixtures/ukmto-all-20261003.json', import.meta.url), 'utf8')));
const UKMTO_NOW = Date.parse('2026-10-03T16:00:00Z');
function fakeUkmto(initial = {}) {
  let state = { enabled: true, active: false, visible: true, loading: false, error: null, loaded: false, fetchedAt: null, incidents: [], summary: { days: 30, total: 0, byType: [], latest: [] }, ...initial };
  const listeners = new Set();
  const calls = [];
  const api = {
    calls,
    getState: () => state,
    isEnabled: () => state.enabled,
    setEnabled(on) { calls.push(['setEnabled', on]); api.emit({ enabled: Boolean(on) }); return Promise.resolve(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(patch) { state = { ...state, ...patch }; for (const fn of listeners) fn(state); },
    labels: {
      type: (it) => SK_STRINGS[`mideast.ukmto.type.${it.type}`] ?? it.typeName,
      place: (it) => SK_STRINGS[`mideast.ukmto.p.${String(it.place).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`] ?? it.place,
    },
    get listenerCount() { return listeners.size; },
  };
  return api;
}
const loadedUkmto = () => ({ active: true, loaded: true, fetchedAt: UKMTO_NOW, incidents: ukmtoIncidents, attribution: 'Source: UKMTO … Open Government Licence v3.0', summary: ukmtoSummary(ukmtoIncidents, { nowMs: UKMTO_NOW, days: 30, latest: 5 }) });

test('etapa 5c — čip INCIDENTY LODÍ: tretí v rade, predvolene zapnutý, bez dejiska či úžiny vypnutý a legenda skrytá; destroy odhlási', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const ukmto = fakeUkmto();
  const panel = createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, control: fakeControl(), airspace: fakeAirspace(), ukmto, translate: tKey, lang: 'sk', documentRef: doc });
  assert.deepEqual(byClass(mount, 'mideast-chips')[0].children.map((c) => c.dataset.part), ['control', 'airspace', 'ukmto']);
  const classes = mount.children.map((c) => c.className);
  assert.deepEqual(classes.slice(3, 7), ['mideast-chips', 'mideast-legend', 'mideast-legend mideast-air-legend', 'mideast-legend mideast-ukmto-legend']);
  assert.equal(classes[7], 'mideast-section-title gas-card-title', 'legendy vrstiev stoja pred prechodmi úžinami');
  const chip = byClass(mount, 'mideast-chip-ukmto')[0];
  assert.equal(chip.textContent, 'mideast.part.ukmto');
  assert.equal(chip.attrs['aria-pressed'], 'true', 'čip je predvolene zapnutý');
  assert.equal(chip.disabled, true, 'bez aktívnej scény nie je čo kresliť');
  assert.equal(chip.title, 'mideast.ukmto.inactive', 'titulok hovorí, kedy sa body ukážu');
  const legend = byClass(mount, 'mideast-ukmto-legend')[0];
  assert.equal(legend.hidden, true);
  ukmto.emit({ active: true, loading: true });
  assert.equal(chip.disabled, false);
  assert.equal(chip.title, 'mideast.ukmto.note');
  assert.equal(legend.hidden, false);
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'loading');
  ukmto.emit({ loading: false, error: 'no_ukmto_snapshot' });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'missing');
  ukmto.emit({ error: 'HTTP 500' });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'error');
  chip.click();
  assert.deepEqual(ukmto.calls, [['setEnabled', false]]);
  assert.equal(chip.attrs['aria-pressed'], 'false');
  assert.equal(legend.hidden, true);
  assert.equal(legend.children.length, 0);
  assert.equal(ukmto.listenerCount, 1);
  panel.destroy();
  assert.equal(ukmto.listenerCount, 0);
});

test('etapa 5c — legenda varovaní: počty podľa druhu za 30 dní, päť najnovších (čas UTC, druh, oblasť, text v titulku), zdroj s OGL a odkaz', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const ukmto = fakeUkmto();
  createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, ukmto, translate: tSk, lang: 'sk', documentRef: doc });
  ukmto.emit(loadedUkmto());
  const legend = byClass(mount, 'mideast-ukmto-legend')[0];
  assert.equal(byClass(legend, 'mideast-legend-title')[0].textContent, 'Varovania UKMTO pre lode · posledných 30 dní');
  const items = byClass(legend, 'mideast-legend-item');
  assert.deepEqual(items.map((i) => [byClass(i, 'mideast-legend-label')[0].textContent, byClass(i, 'mideast-legend-count')[0].textContent]), [['útok', '4'], ['upozornenie', '1']]);
  assert.match(byClass(items[0], 'mideast-ukmto-swatch')[0].attrs.style, /background: #ff5a5f/, 'vzorka farbou bodu na mape');
  const rows = byClass(legend, 'mideast-ukmto-row');
  assert.deepEqual(rows.map((r) => r.dataset.ref), ['149-26', '148-26', '147-26', '130-26', '127-26']);
  const cells = (row) => ['mideast-ukmto-when', 'mideast-ukmto-type', 'mideast-ukmto-place'].map((c) => byClass(row, c)[0].textContent);
  assert.deepEqual(cells(rows[0]).slice(1), ['útok', 'Hormuzský prieliv']);
  assert.match(cells(rows[0])[0], /^2\. 10\.,? 23:11 UTC$/, 'čas incidentu v UTC (oddeľovač podľa verzie ICU)');
  assert.deepEqual(cells(rows[4]).slice(1), ['upozornenie', 'oblasť hlásení UKMTO']);
  assert.match(rows[0].title, /^UKMTO has received a report of an incident 4nm east of Oman\./, 'text varovania v titulku riadka');
  assert.match(byClass(rows[4], 'mideast-ukmto-swatch')[0].attrs.style, /background: #8fb8d8/, 'farba druhu aj pri riadku');
  const src = byClass(legend, 'mideast-legend-source')[0];
  assert.equal(byClass(src, 'mideast-legend-since')[0].textContent, `stav k ${skDate('2026-10-03T16:00:00Z')} · UKMTO · Open Government Licence v3.0`);
  assert.match(src.title, /Open Government Licence v3\.0/);
  const link = byClass(src, 'mideast-air-link')[0];
  assert.equal(link.href, 'https://www.ukmto.org/recent-incidents');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.match(byClass(legend, 'mideast-legend-note')[0].textContent, /hlásené udalosti, poloha podľa varovania/);
  // pokoj na mori: žiadne varovanie za 30 dní, staršie v zozname ostanú
  const calm = ukmtoIncidents.filter((x) => x.t < UKMTO_NOW - 40 * 86_400_000);
  ukmto.emit({ incidents: calm, summary: ukmtoSummary(calm, { nowMs: UKMTO_NOW, days: 30, latest: 5 }), error: 'HTTP 502' });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].textContent, 'za posledných 30 dní žiadne varovania');
  assert.equal(byClass(legend, 'mideast-ukmto-row').length, 5, 'najnovšie staršie varovania sú stále vypísané');
  assert.equal(byClass(byClass(legend, 'mideast-legend-source')[0], 'is-stale')[0].textContent, 'varovania UKMTO sú nedostupné (chyba servera)');
});

test('etapa 5c — CSS legendy varovaní', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const cls of ['.mideast-ukmto-swatch', '.mideast-ukmto-rows', '.mideast-ukmto-row', '.mideast-ukmto-when', '.mideast-ukmto-type', '.mideast-ukmto-place']) assert.ok(css.includes(cls), cls);
  assert.match(css, /\.mideast-ukmto-swatch \{ border-radius: 50%; \}/, 'okrúhla vzorka ako bod na mape');
});

// ── Etapa 5d: RUŠENIE GPS · odvodené (2026-10-03) ────────────────────────────
function fakeGps(initial = {}) {
  let state = { enabled: false, loading: false, error: null, loaded: false, days: [], period: '', snapshots: 0, aircraft: 0, counts: { high: 0, medium: 0, none: 0, thin: 0 }, todayPartial: false, ...initial };
  const listeners = new Set();
  const calls = [];
  const api = {
    calls,
    getState: () => state,
    isEnabled: () => state.enabled,
    setEnabled(on) { calls.push(['setEnabled', on]); api.emit({ enabled: Boolean(on) }); return Promise.resolve(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(patch) { state = { ...state, ...patch }; for (const fn of listeners) fn(state); },
    get listenerCount() { return listeners.size; },
  };
  return api;
}

test('etapa 5d — čip RUŠENIE GPS: štvrtý v rade, predvolene vypnutý, legenda len po zapnutí; stavy načítania; destroy odhlási', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const gps = fakeGps();
  const panel = createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, control: fakeControl(), airspace: fakeAirspace(), ukmto: fakeUkmto(), gps, translate: tKey, lang: 'sk', documentRef: doc });
  assert.deepEqual(byClass(mount, 'mideast-chips')[0].children.map((c) => c.dataset.part), ['control', 'airspace', 'ukmto', 'gps']);
  assert.deepEqual(mount.children.map((c) => c.className).slice(3, 8), ['mideast-chips', 'mideast-legend', 'mideast-legend mideast-air-legend', 'mideast-legend mideast-ukmto-legend', 'mideast-legend mideast-gps-legend']);
  const chip = byClass(mount, 'mideast-chip-gps')[0];
  assert.equal(chip.textContent, 'mideast.part.gps');
  assert.equal(chip.attrs['aria-pressed'], 'false', 'predvolene vypnuté — odvodená vrstva sa nezapína sama');
  assert.equal(chip.title, 'mideast.gps.note');
  const legend = byClass(mount, 'mideast-gps-legend')[0];
  assert.equal(legend.hidden, true);
  chip.click();
  assert.deepEqual(gps.calls, [['setEnabled', true]]);
  assert.equal(legend.hidden, false);
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'loading');
  gps.emit({ error: 'no_gps_snapshot' });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'missing');
  assert.equal(byClass(legend, 'mideast-legend-state')[0].textContent, 'mideast.gps.missing');
  gps.emit({ error: 'HTTP 500' });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].dataset.state, 'error');
  assert.equal(byClass(legend, 'mideast-legend-note')[0].textContent, 'mideast.gps.note', 'poznámka o odvodenom ukazovateli je vidieť aj bez dát');
  chip.click();
  assert.equal(legend.hidden, true);
  assert.equal(gps.listenerCount, 1);
  panel.destroy();
  assert.equal(gps.listenerCount, 0);
});

test('etapa 5d — legenda rušenia GPS: počty buniek podľa stupňa vo farbách mapy, obdobie, snímky a lietadlá, zdroj, poctivá poznámka', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const gps = fakeGps();
  createMideastPanel({ mountTarget: mount, theatres: THEATRES, labelFor, gps, translate: tSk, lang: 'sk', documentRef: doc });
  gps.emit({ enabled: true, loaded: true, days: ['2026-10-02', '2026-10-03'], period: '2. 10. 2026 – 3. 10. 2026', snapshots: 137, aircraft: 1240, counts: { high: 3, medium: 7, none: 41, thin: 120 }, todayPartial: true, attribution: 'Aircraft data: adsb.lol contributors (ODbL 1.0)' });
  const legend = byClass(mount, 'mideast-gps-legend')[0];
  assert.equal(byClass(legend, 'mideast-legend-title')[0].textContent, 'Lietadlá so zhoršenou presnosťou polohy');
  const items = byClass(legend, 'mideast-legend-item');
  assert.deepEqual(items.map((i) => [byClass(i, 'mideast-legend-label')[0].textContent, byClass(i, 'mideast-legend-count')[0].textContent]), [['nad 10 %', '3'], ['2–10 %', '7'], ['pod 2 %', '41']]);
  assert.match(byClass(items[0], 'mideast-legend-swatch')[0].attrs.style, /border-color: #ff5a5f/);
  assert.match(byClass(items[2], 'mideast-legend-swatch')[0].attrs.style, /border-color: #52d68a/);
  assert.equal(byClass(legend, 'mideast-legend-items')[0].attrs['aria-label'], 'bunky 0,5°');
  const src = byClass(legend, 'mideast-legend-source')[0];
  assert.equal(byClass(src, 'mideast-legend-since')[0].textContent, `2. 10. 2026 – 3. 10. 2026 · snímky: 137 · lietadlá: ${new Intl.NumberFormat('sk-SK').format(1240)}`);
  assert.deepEqual(byClass(src, 'mideast-legend-age').map((n) => n.textContent), ['· dnešok sa ešte zbiera', '· adsb.lol (ODbL) · výpočet OKO']);
  assert.match(src.title, /adsb\.lol/);
  assert.match(byClass(legend, 'mideast-legend-note')[0].textContent, /nie meranie rušičiek/);
  // okno bez bunky s dosť lietadlami + výpadok servera
  gps.emit({ counts: { high: 0, medium: 0, none: 0, thin: 12 }, todayPartial: false, error: 'HTTP 502' });
  assert.equal(byClass(legend, 'mideast-legend-state')[0].textContent, 'v tomto období nie je bunka s dosť lietadlami');
  assert.equal(byClass(byClass(legend, 'mideast-legend-source')[0], 'is-stale')[0].textContent, 'mapa rušenia GPS je nedostupná (chyba servera)');
});
