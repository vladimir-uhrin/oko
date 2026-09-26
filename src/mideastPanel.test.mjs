// src/mideastPanel.test.mjs — telo panela BLÍZKY VÝCHOD (etapa 1): stavový riadok,
// zoznam dejísk, miesto pre správy, poctivá poznámka; plus nástražné drôty na
// všetky ručné zoznamy, ktoré panel v pruhu musí prejsť (index.html, style.css,
// ui.js, sharelink.js, mobileShell.js, i18n). Lekcia zo ZÁLIV-u: 4 z 5 zoznamov
// boli neúplné, kým ich netestoval nikto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createMideastPanel } from './mideastPanel.js';
import { listMideastTheatres } from './data/mideastTheatres.js';
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
