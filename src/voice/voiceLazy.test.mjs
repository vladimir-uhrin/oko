// src/voice/voiceLazy.test.mjs — lenivý hlas (2026-10-31): pilulka stojí od štartu, modul príde
// s prvým stlačením, brána a zdroje hľadania sa odovzdajú, stlačenie sa dokončí.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  VOICE_LOADING_STATUS, _resetVoiceLazyForTest, installLazyVoice, isVoiceLoaded, loadVoice, setVoiceAccessGate,
} from './voiceLazy.js';
import { applyFreeVoiceUi, createVoiceControl, isPushToTalkKey, shouldHandlePushToTalkKeyDown, voiceEngine } from './voiceControl.js';
import * as realtime from './gevRealtime.js';
import { _resetSceneDirectorForTest, loadSceneDirector, sceneDirectorIfLoaded } from '../scenes/directorLazy.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

function fakeUi() {
  const el = () => ({ textContent: '', hidden: false, title: '', dataset: {}, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
  const ui = { root: el(), button: el(), status: el(), detail: el(), helpDetail: el(), errorDetail: el(), tierButton: el(), costValue: el() };
  ui.root.dataset.status = 'idle';
  return ui;
}
function fakeWin() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; },
  };
}
function fakeImporters(log) {
  const controller = {
    status: 'idle', buttonClicks: 0, shortcutEvents: [], gate: null, resolvers: null,
    buttonHandler() { this.buttonClicks += 1; },
    shortcutKeyDownHandler(e) { this.shortcutEvents.push(e); },
    setStatus(s) { this.status = s; return s; },
    freeVoice: { setResolvers(r) { controller.resolvers = r; } },
  };
  const realtimeMod = {
    setVoiceAccessGate(g) { controller.gate = g; },
    initGevVoiceCommands(deps) { log.push(['init', Object.keys(deps).sort().join(',')]); return controller; },
  };
  return {
    controller,
    importers: {
      realtime: async () => { log.push(['import', 'realtime']); return realtimeMod; },
      annotations: async () => ({ initAnnotations: (o) => { log.push(['annotations', Boolean(o.viewer)]); return { fake: 'annotations' }; } }),
      director: async () => ({ loadSceneDirector: async () => { log.push(['director']); return { fake: 'director' }; } }),
    },
  };
}

test.beforeEach(() => { _resetVoiceLazyForTest(); _resetSceneDirectorForTest(); delete globalThis.window; });

test('pred stlačením: pilulka stojí, nič sa nesťahuje, brána a zdroje sa len držia', () => {
  const log = [];
  const { importers } = fakeImporters(log);
  const win = fakeWin();
  const ui = fakeUi();
  const stub = installLazyVoice(() => ({}), { win, importers, control: () => ui });
  assert.equal(stub.lazy, true);
  assert.equal(stub.status, 'idle', 'QA skripty čítajú status aj pred dotiahnutím');
  assert.equal(isVoiceLoaded(), false);
  assert.deepEqual(log, [], 'žiadny import pri štarte');
  assert.equal(typeof win.listeners.keydown, 'function', 'medzerník (push-to-talk) sa sleduje od štartu');
  assert.equal(typeof ui.button.listeners.click, 'function', 'klik na mikrofón sa sleduje od štartu');
  setVoiceAccessGate(() => false);
  stub.freeVoice.setResolvers({ commands: () => [] });
  assert.deepEqual(log, [], 'brána ani zdroje nespúšťajú sťahovanie');
});

test('klik: stav NAČÍTAVAM, dotiahnutie, odovzdanie brány a zdrojov, klik sa dokončí buttonHandlerom', async () => {
  const log = [];
  const { importers, controller } = fakeImporters(log);
  const win = fakeWin();
  const ui = fakeUi();
  globalThis.window = { __godsEyeView: { voiceCommands: null, tileset: 'ts' } };
  const gate = () => true;
  setVoiceAccessGate(gate);
  const stub = installLazyVoice(() => ({ viewer: { v: 1 }, styleManager: {}, dataManager: {}, tileset: 'ts' }), { win, importers, control: () => ui });
  stub.freeVoice.setResolvers({ commands: 'cmds' });
  ui.button.listeners.click();
  assert.equal(ui.root.dataset.status, VOICE_LOADING_STATUS, 'hneď po kliku vidieť načítavanie');
  await stub.load();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(controller.buttonClicks, 1, 'klik sa po dotiahnutí vykoná');
  assert.equal(controller.gate, gate, 'brána prihlásenia odovzdaná skutočnému modulu');
  assert.deepEqual(controller.resolvers, { commands: 'cmds' }, 'zdroje hľadania odovzdané bezplatnému hlasu');
  assert.deepEqual(log.map((l) => l[0]), ['import', 'annotations', 'director', 'init'].filter((k) => log.some((l) => l[0] === k)));
  assert.ok(log.some((l) => l[0] === 'init' && l[1] === 'annotations,dataManager,sceneDirector,styleManager,viewer'));
  assert.equal(globalThis.window.__godsEyeView.voiceCommands, controller, 'window.__godsEyeView.voiceCommands je po dotiahnutí skutočný ovládač');
  assert.equal(globalThis.window.__godsEyeView.sceneDirector.fake, 'director');
  assert.equal(stub.status, 'idle');
  assert.equal(isVoiceLoaded(), true);
  assert.equal(win.listeners.keydown, undefined, 'poslucháče zástupcu po dotiahnutí odchádzajú');
  // neskoršia zmena brány ide rovno do modulu
  const gate2 = () => false;
  setVoiceAccessGate(gate2);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(controller.gate, gate2);
});

test('medzerník: prvé stlačenie dotiahne; držaný kláves pokračuje v push-to-talk, pustený nie', async () => {
  for (const held of [true, false]) {
    _resetVoiceLazyForTest();
    const log = [];
    const { importers, controller } = fakeImporters(log);
    const win = fakeWin();
    const ui = fakeUi();
    installLazyVoice(() => ({}), { win, importers, control: () => ui });
    let prevented = 0;
    const event = { code: 'Space', key: ' ', target: { closest: () => null }, preventDefault() { prevented += 1; } };
    win.listeners.keydown(event);
    assert.equal(prevented, 1, 'medzerník nesmie skrolovať stránku ani počas sťahovania');
    win.listeners.keydown({ ...event, repeat: true });
    if (!held) win.listeners.keyup({ code: 'Space' });
    await loadVoice(() => ({}), { importers });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(controller.shortcutEvents.length, held ? 1 : 0, held ? 'držaný kláves → push-to-talk' : 'pustený kláves → len načítané');
    assert.equal(log.filter((l) => l[0] === 'import').length, 1, 'opakovanie klávesu nesťahuje druhýkrát');
  }
  // medzerník v textovom poli sa nechytá
  _resetVoiceLazyForTest();
  const { importers } = fakeImporters([]);
  const win = fakeWin();
  installLazyVoice(() => ({}), { win, importers, control: () => fakeUi() });
  let prevented = 0;
  win.listeners.keydown({ code: 'Space', key: ' ', target: { closest: () => ({}) }, preventDefault() { prevented += 1; } });
  assert.equal(prevented, 0);
  assert.equal(isVoiceLoaded(), false);
});

test('chyba siete: stav CHYBA, ďalšie stlačenie skúsi znova', async () => {
  let fail = true;
  const log = [];
  const { importers, controller } = fakeImporters(log);
  const flaky = { ...importers, realtime: async () => { if (fail) throw new Error('offline'); return importers.realtime(); } };
  const win = fakeWin();
  const ui = fakeUi();
  const stub = installLazyVoice(() => ({}), { win, importers: flaky, control: () => ui });
  ui.button.listeners.click();
  await stub.load().catch(() => {});
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ui.root.dataset.status, 'error');
  assert.equal(isVoiceLoaded(), false);
  fail = false;
  ui.button.listeners.click();
  await stub.load();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(controller.buttonClicks, 1);
});

test('setStatus zástupcu dotiahne modul a odovzdá (QA skripty radia a hlasu)', async () => {
  const { importers, controller } = fakeImporters([]);
  const stub = installLazyVoice(() => ({}), { win: fakeWin(), importers, control: () => fakeUi() });
  assert.equal(await stub.setStatus('listening'), 'listening');
  assert.equal(controller.status, 'listening');
});

test('réžia scén: jedna inštancia pre vlastníka aj hlas; voiceLazy ju znovu nestavia', async () => {
  const built = [];
  class SceneDirector { constructor(v, s, d) { built.push([v, s, d]); } }
  const ctx = { viewer: 'v', styleManager: 's', dataManager: 'd' };
  const a = loadSceneDirector(ctx, { importer: async () => ({ SceneDirector }) });
  const b = loadSceneDirector(ctx, { importer: async () => { throw new Error('druhý import sa nesmie stať'); } });
  assert.equal(await a, await b);
  assert.equal(built.length, 1);
  assert.equal(sceneDirectorIfLoaded(), await a);
  const { importers, controller } = fakeImporters([]);
  const stub = installLazyVoice(() => ({ ...ctx, sceneDirector: sceneDirectorIfLoaded() }), { win: fakeWin(), importers, control: () => fakeUi() });
  assert.equal(await stub.load(), controller);
  assert.equal(built.length, 1, 'hlas prevzal hotovú réžiu');
});

test('pilulka bezplatného hlasu vyzerá pred dotiahnutím rovnako ako po ňom (freeVoice.applyUi = applyFreeVoiceUi)', () => {
  const ui = fakeUi();
  applyFreeVoiceUi(ui, (k) => `[${k}]`);
  assert.equal(ui.costValue.textContent, '[voice.free.cost]');
  assert.equal(ui.tierButton.hidden, true);
  assert.equal(ui.helpDetail.textContent, '[voice.free.hint]');
  assert.equal(ui.root.dataset.engine, 'free');
  assert.match(read('./freeVoice.js'), /function applyUi\(\) \{ applyFreeVoiceUi\(ui, translate\); \}/);
  assert.equal(voiceEngine(), 'free', 'bez localStorage je motor bezplatný');
  assert.equal(isPushToTalkKey({ code: 'Space' }), true);
  assert.equal(shouldHandlePushToTalkKeyDown({ code: 'Space', ctrlKey: true }), false);
  assert.equal(typeof createVoiceControl, 'function');
  // gevRealtime znova exportuje pomocníkov, aby staršie importy platili
  assert.equal(realtime.voiceEngine, voiceEngine);
  assert.equal(realtime.shouldHandlePushToTalkKeyDown, shouldHandlePushToTalkKeyDown);
  assert.equal(typeof realtime.renderFreshCesiumFrame, 'function');
});

test('zapojenie: main.js hlas, anotácie ani réžiu staticky neimportuje; zdieľanie a HUD neťahajú hlasový modul', () => {
  const main = read('../main.js');
  assert.doesNotMatch(main, /from '\.\/voice\/gevRealtime\.js'/, 'hlasový modul nie je v hlavnom balíku');
  assert.doesNotMatch(main, /from '\.\/scenes\/director\.js'/);
  assert.doesNotMatch(main, /from '\.\/annotations\/index\.js'/);
  assert.match(main, /import \{ installLazyVoice, setVoiceAccessGate \} from '\.\/voice\/voiceLazy\.js';/);
  assert.match(main, /window\.__godsEyeView\.voiceCommands = installLazyVoice\(lazyContext\);/);
  assert.match(main, /const loadOwnerTools = \(\) => \{ if \(document\.body\.classList\.contains\('oko-owner'\)\) void loadSceneDirector\(lazyContext\(\)\); \};/, 'réžia scén pre vlastníka');
  assert.match(main, /window\.__godsEyeView\.voiceCommands\?\.freeVoice\?\.setResolvers\(\{/, 'zdroje hľadania idú cez zástupcu');
  assert.doesNotMatch(read('../shareSnapshot.js'), /voice\/gevRealtime\.js/, 'snímka zdieľania berie čerstvý snímok z cesiumFrame.js');
  assert.match(read('../shareSnapshot.js'), /from '\.\/cesiumFrame\.js'/);
  const hud = read('../hud.js');
  assert.doesNotMatch(hud, /^import .* from '\.\/voice\/gevActions\.js';/m, 'HUD neťahá hlasové akcie staticky');
  assert.match(hud, /await import\('\.\/voice\/gevActions\.js'\)/, 'súhrn scény si ich dotiahne, keď treba');
  for (const f of ['./gevRealtime.js', './gevActions.js', './freeVoice.js', '../annotations/index.js', '../scenes/director.js']) {
    assert.doesNotMatch(read('./voiceLazy.js'), new RegExp(`^import .* from '${f.replace(/[./]/g, '\\$&')}'`, 'm'), `voiceLazy.js staticky neimportuje ${f}`);
  }
  const css = read('../../style.css');
  assert.match(css, /#gev-voice-control\[data-status='loading'\] #gev-voice-status \{/, 'stav NAČÍTAVAM vidieť');
});
