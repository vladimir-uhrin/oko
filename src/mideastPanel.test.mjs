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
  assert.deepEqual(titles.map((x) => x.textContent), ['mideast.theatres', 'mideast.news.title']);
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
  // Poradie v tele: stav → titulok → dejiská → titulok → správy → poznámka.
  assert.deepEqual(mount.children.map((c) => c.className.split(' ')[0]), ['mideast-status', 'mideast-section-title', 'mideast-dirs', 'mideast-section-title', 'mideast-news', 'mideast-note']);
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
  assert.match(main, /import \{ applyMideastTheatre, listMideastTheatres, theatreById, theatreFraming, theatreLabel \} from '\.\/data\/mideastTheatres\.js';/);
  assert.match(main, /import \{ createMideastPanel \} from '\.\/mideastPanel\.js';/);

  // Panel sa montuje do tela #mideast-panel a klik na dejisko volá runMideastTheatre.
  assert.match(main, /createMideastPanel\(\{\s*mountTarget: document\.querySelector\('#mideast-panel \[data-mideast-body\]'\),\s*theatres: listMideastTheatres\(\),\s*applyTheatre: \(id\) => runMideastTheatre\(id\),/);
  assert.match(main, /window\.__godsEyeView\.mideastPanel = mideastPanel;/);
  // Bulletin bývalého ZÁLIV-u žije v slote správ panela (vnútri [data-panel-id],
  // aby sa načítal lenivo); verejný debug handle ostáva.
  assert.match(main, /createConflictBulletin\(\{ mountTarget: mideastPanel\.newsMount, region: 'gulf' \}\)/);
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
  assert.deepEqual(mount.children.map((c) => c.className.split(' ')[0]), ['mideast-status', 'mideast-section-title', 'mideast-dirs', 'mideast-chips', 'mideast-legend', 'mideast-section-title', 'mideast-news', 'mideast-note']);
  const chips = byClass(mount, 'mideast-chips')[0];
  assert.equal(chips.attrs.role, 'group');
  assert.equal(chips.attrs['aria-label'], 'mideast.part.control');
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
