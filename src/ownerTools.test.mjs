// Nástroje vlastníka a preusporiadanie rozhrania (2026-10-11, vlastník: „chcem aby to bolo logické,
// prehľadné a mobile friendly"). Verejnosť nevidí réžiu scén, kalibráciu kamier ani kartičky
// konfliktov; zóny stĺpca a sekcie mobilu majú rovnakú logiku (Vrstvy · Konflikty · Energia ·
// Prehliadať · Nastavenia).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOBILE_SECTIONS } from './mobileShell.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

const scenePanel = html.slice(html.indexOf('id="scene-panel"'), html.indexOf('id="history-panel"'));
const cctvPanel = html.slice(html.indexOf('id="cctv-panel"'), html.indexOf('id="weather-panel"'));

test('réžia scén je nástroj vlastníka: každý jej ovládač nesie .oko-owner-only, tri prelety nie', () => {
  assert.match(scenePanel, /<div class="scene-progress oko-owner-only">/, 'priebeh behu je vlastníkov');
  for (const id of ['scene-select', 'scene-new-btn', 'scene-capture-btn', 'scene-start-btn', 'scene-export-btn', 'scene-status', 'scene-shot-list']) {
    const at = scenePanel.indexOf(`id="${id}"`);
    assert.ok(at > 0, `#${id} v paneli Prelety`);
    // ovládač alebo jeho najbližší obal <div class="scene-controls …"> musí mať triedu
    const block = scenePanel.slice(scenePanel.lastIndexOf('<div', at), scenePanel.indexOf('>', at) + 1);
    assert.match(block, /oko-owner-only/, `#${id} nie je skrytý pred verejnosťou`);
  }
  for (const id of ['chokepoint-select', 'front-select', 'mideast-select']) {
    const at = scenePanel.indexOf(`id="${id}"`);
    const block = scenePanel.slice(scenePanel.lastIndexOf('<div', at), scenePanel.indexOf('>', at) + 1);
    assert.doesNotMatch(block, /oko-owner-only/, `prelet #${id} je verejný`);
  }
  assert.match(scenePanel, /class="scene-director-head oko-owner-only" data-i18n="scene\.director"/, 'nadpis réžie nad ovládačmi vlastníka');
});

test('kalibrácia kamier je skrytá pred verejnosťou, bežné ovládanie kamier nie', () => {
  assert.match(cctvPanel, /<div class="cctv-calibration-block oko-owner-only">/);
  assert.doesNotMatch(cctvPanel.slice(0, cctvPanel.indexOf('cctv-calibration-block')), /oko-owner-only/, 'ZAP/NAJBLIŽŠIA/ĎALŠIA/ZAMERAŤ ostávajú verejné');
});

test('CSS: bez body.oko-owner sú nástroje vlastníka a spúšťač kartičiek skryté; main.js triedu nastavuje z roly účtu alebo na localhoste', () => {
  assert.match(css, /body:not\(\.oko-owner\) \.oko-owner-only,\s*body:not\(\.oko-owner\) \.oko-conflicts-launch \{ display: none !important; \}/);
  assert.match(main, /classList\.toggle\('oko-owner', localDev \|\| state\?\.user\?\.role === 'owner'\)/);
  assert.match(main, /accountCenter\.client\.subscribe\(syncOwner\)/, 'prihlásenie/odhlásenie prepne triedu bez obnovy stránky');
});

test('zóny stĺpca a sekcie mobilu majú rovnakú logiku: Prelety v Konfliktoch, Prehliadať = história + kamery + kontext', () => {
  const order = (sel) => Number(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{\\s*order: (\\d+);`).exec(css)?.[1]);
  // nadpis KONFLIKTY je predvolené pravidlo `.lane-zone { order: 20; … }` (viacriadkové)
  const scene = order('#left-panel-stack > #scene-panel');
  assert.ok(scene > order('#left-panel-stack > .lane-zone') && scene < order('#left-panel-stack > .lane-zone[data-lane-zone="energy"]'), `Prelety (${scene}) medzi nadpismi KONFLIKTY a ENERGIA`);
  assert.ok(scene > order('#left-panel-stack > #mideast-panel'), 'Prelety až za Blízkym východom');
  const byId = new Map(MOBILE_SECTIONS.map((s) => [s.id, s]));
  assert.deepEqual([...byId.keys()], ['layers', 'conflicts', 'data', 'display', 'search'], 'päť sekcií, bez samostatných SCÉN');
  assert.deepEqual([...byId.get('conflicts').panelIds], ['ukraine-panel', 'mideast-panel', 'scene-panel']);
  assert.equal(byId.get('conflicts').expand, 'ukraine-panel');
  assert.deepEqual([...byId.get('data').panelIds], ['gas-panel', 'history-panel', 'cctv-panel', 'global-context-panel']);
  // Ropa a plyn (2026-10-11): jeden panel, ceny ropy prvé (krátke), plyn pod nimi
  assert.doesNotMatch(html, /id="oil-panel"/);
  assert.match(html, /data-i18n="panel\.energy" class="panel-title"[\s\S]*?class="energy-subhead" data-i18n="panel\.oil"[\s\S]*?data-oil-body[\s\S]*?class="energy-subhead" data-i18n="panel\.gas"[\s\S]*?data-gas-body/);
  assert.match(css, /#gas-panel\.collapsed \.oil-body, #gas-panel\.collapsed \.energy-subhead \{ display: none; \}/);
  assert.match(SK_STRINGS['panel.energy'], /^Ropa a plyn/);
  assert.deepEqual([...byId.get('display').panelIds], ['look-panel', 'pp-toggles']);
  assert.equal(byId.get('display').expand, 'look-panel');
  assert.match(html, /data-oko-section="conflicts"[\s\S]*?data-i18n="mobile\.conflicts"/);
  assert.doesNotMatch(html, /data-oko-section="scenes"/);
});

test('názvy panelov hovoria, čo panel robí (vlastník: „aby to každý pochopil") — v oboch jazykoch', () => {
  const expect = {
    'panel.data-layers': ['Vrstvy na mape', 'Map layers'],
    'panel.weather': ['POČASIE A RADAR', 'WEATHER & RADAR'],
    'panel.ukraine': ['UKRAJINA — FRONT', 'UKRAINE — FRONT LINE'],
    'panel.mideast': ['BLÍZKY VÝCHOD — DEJISKÁ', 'MIDDLE EAST — THEATRES'],
    'panel.scenes': ['Prelety kamerou', 'Camera flyovers'],
    'panel.energy': ['Ropa a plyn — ceny a toky', 'Oil & gas — prices & flows'],
    'panel.history': ['História letov a lodí', 'Flight & ship history'],
    'panel.cctv': ['Dopravné kamery', 'Traffic cameras'],
    'panel.context': ['Rádio a kontakty', 'Radio & contacts'],
    'panel.look': ['Štýl a podklad mapy', 'Style & basemap'],
    'panel.display': ['Zobrazenie a efekty', 'Display & effects'],
    'lane.zone.tools': ['Prehliadať', 'Browse'],
    'lane.zone.settings': ['Vzhľad', 'Appearance'],
    'mobile.conflicts': ['Konflikty', 'Conflicts'],
    'mobile.display': ['Vzhľad', 'Appearance'],
    'scene.director': ['Réžia scén', 'Scene director'],
  };
  for (const [key, [sk, en]] of Object.entries(expect)) {
    assert.equal(SK_STRINGS[key], sk, `SK ${key}`);
    assert.equal(EN_STRINGS[key], en, `EN ${key}`);
  }
});

test('VZHĽAD: Štýl a podklad mapy je panel pruhu pred Zobrazením; main.js doň presunie štýly a podklad z dolnej lišty', () => {
  assert.match(html, /<div id="look-panel" class="panel-collapsible collapsed" data-panel-id="look-panel">[\s\S]*?data-i18n="panel\.look"[\s\S]*?<div class="look-body" data-look-body><\/div>/);
  assert.ok(html.indexOf('id="look-panel"') < html.indexOf('data-lane-zone="settings"'), 'v markupe pruhu pred nadpisom zóny (poradie dáva CSS)');
  const order = (sel) => Number(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{\\s*order: (\\d+);`).exec(css)?.[1]);
  assert.ok(order('#left-panel-stack > .lane-zone[data-lane-zone="settings"]') < order('#left-panel-stack > #look-panel')
    && order('#left-panel-stack > #look-panel') < order('#left-panel-stack > #pp-toggles'), 'nadpis VZHĽAD → Štýl a podklad → Zobrazenie a efekty');
  assert.match(main, /lookBody\.append\(styleGrid, mapSource\);\s*document\.body\.classList\.add\('oko-look-in-lane'\);/);
  assert.match(css, /body\.oko-look-in-lane #command-dock > #control-panel \{ display: none !important; \}/, 'dolná lišta bez Štýlu');
  assert.match(css, /body\.cockpit-mode #left-panel-stack > #look-panel \{ display: none !important; \}/);
  assert.match(css, /body\.ui-clean-view #look-panel,/);
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /\{ id: 'look-panel' \},/, 'stav panela v odkaze');
  const sharelink = readFileSync(new URL('./sharelink.js', import.meta.url), 'utf8');
  assert.match(sharelink, /\{ id: 'look-panel', token: 'n', pinnable: false \},/);
});
