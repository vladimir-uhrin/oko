// src/mapHoverTip.test.mjs — bublina nad mapou pre vrstvy BLÍZKEHO VÝCHODU (2026-10-03).
// Správanie, ktoré po vydaní etapy 5 ukázala až snímka obrazovky: bublina sa drží v okne mapy,
// pýta sa na POSLEDNÚ polohu kurzora (nie prvú v dávke pohybov), zmizne pri odchode kurzora
// z mapy, pri pohybe kamery aj pri ťahaní mapy, a vypnutá vrstva nič nehľadá.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { HOVER_TIP_DELAY_MS, HOVER_TIP_GAP_PX, HOVER_TIP_MARGIN_PX, createMapHoverTip, hoverTipPlacement } from './mapHoverTip.js';

const T = Cesium.ScreenSpaceEventType;

/** Falošné okno mapy: plátno 1000 × 600, bublina 340 × 90 (rozmery má len viditeľný prvok). */
function rig({ canvasSize = { w: 1000, h: 600 }, tipSize = { w: 340, h: 90 }, withCanvas = true, resolve = () => null, isActive = () => true } = {}) {
  const tipEl = {
    className: '', textContent: '', _hidden: false, removed: false,
    get hidden() { return this._hidden; }, set hidden(v) { this._hidden = Boolean(v); },
    get offsetWidth() { return this._hidden ? 0 : tipSize.w; },
    get offsetHeight() { return this._hidden ? 0 : tipSize.h; },
    style: { transform: '', vars: {}, setProperty(k, v) { this.vars[k] = v; } },
    remove() { this.removed = true; },
  };
  const doc = { createElement: () => tipEl };
  const dom = new Map();
  const canvas = withCanvas ? {
    clientWidth: canvasSize.w, clientHeight: canvasSize.h,
    addEventListener(type, fn) { dom.set(type, fn); },
    removeEventListener(type, fn) { if (dom.get(type) === fn) dom.delete(type); },
  } : null;
  const moveStart = [];
  const viewer = {
    container: { children: [], appendChild(el) { this.children.push(el); } },
    scene: { canvas },
    camera: { moveStart: { addEventListener(fn) { moveStart.push(fn); return () => { const i = moveStart.indexOf(fn); if (i >= 0) moveStart.splice(i, 1); }; } } },
  };
  const handlers = [];
  const createHandler = (el) => { const h = { el, actions: new Map(), destroyed: false, setInputAction(fn, type) { this.actions.set(type, fn); }, destroy() { this.destroyed = true; } }; handlers.push(h); return h; };
  const timers = [];
  const setTimer = (fn, ms) => { const id = { fn, ms, cleared: false }; timers.push(id); return id; };
  const clearTimer = (id) => { if (id) id.cleared = true; };
  const asked = [];
  const hover = createMapHoverTip({ viewer, doc, className: 'oko-test-tip', isActive, resolve: (pos) => { asked.push(pos); return resolve(pos); }, setTimer, clearTimer, createHandler });
  return {
    hover, tipEl, viewer, dom, moveStart, handlers, timers, asked,
    move: (x, y) => handlers[0].actions.get(T.MOUSE_MOVE)({ endPosition: { x, y } }),
    press: (type) => handlers[0].actions.get(type)({ position: { x: 0, y: 0 } }),
    /** Spustí čakajúce časovače (nezrušené); vráti, koľko ich bežalo. */
    run: () => { const due = timers.splice(0).filter((t) => !t.cleared); for (const t of due) t.fn(); return due.length; },
    translate: () => { const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(tipEl.style.transform); return m ? { x: Number(m[1]), y: Number(m[2]) } : null; },
  };
}

test('poloha bubliny: vpravo dole od kurzora; pri pravom a dolnom okraji sa preklopí; vždy ostane v okne', () => {
  const size = { width: 340, height: 90, viewWidth: 1000, viewHeight: 600 };
  assert.deepEqual(hoverTipPlacement({ x: 200, y: 150, ...size }), { x: 200 + HOVER_TIP_GAP_PX, y: 150 + HOVER_TIP_GAP_PX });
  // pri pravom okraji: bublina naľavo od kurzora, nie cez okraj
  const right = hoverTipPlacement({ x: 900, y: 150, ...size });
  assert.equal(right.x, 900 - HOVER_TIP_GAP_PX - 340);
  assert.equal(right.y, 150 + HOVER_TIP_GAP_PX);
  // pri dolnom okraji: nad kurzorom
  const bottom = hoverTipPlacement({ x: 200, y: 570, ...size });
  assert.equal(bottom.y, 570 - HOVER_TIP_GAP_PX - 90);
  // roh: obe preklopenia naraz
  assert.deepEqual(hoverTipPlacement({ x: 990, y: 595, ...size }), { x: 990 - HOVER_TIP_GAP_PX - 340, y: 595 - HOVER_TIP_GAP_PX - 90 });
  // úzke okno (mobil): bublina širšia než miesto vedľa kurzora — pritiahne sa k okraju, nevytečie
  const narrow = hoverTipPlacement({ x: 180, y: 40, width: 340, height: 90, viewWidth: 360, viewHeight: 640 });
  assert.equal(narrow.x, HOVER_TIP_MARGIN_PX);
  assert.ok(narrow.x + 340 <= 360 - HOVER_TIP_MARGIN_PX + 0.5);
  // každá poloha kurzora v okne → celá bublina v okne
  for (let x = 0; x <= 1000; x += 50) {
    for (let y = 0; y <= 600; y += 50) {
      const p = hoverTipPlacement({ x, y, ...size });
      assert.ok(p.x >= HOVER_TIP_MARGIN_PX && p.x + 340 <= 1000 - HOVER_TIP_MARGIN_PX, `x mimo okna pri kurzore ${x},${y}: ${p.x}`);
      assert.ok(p.y >= HOVER_TIP_MARGIN_PX && p.y + 90 <= 600 - HOVER_TIP_MARGIN_PX, `y mimo okna pri kurzore ${x},${y}: ${p.y}`);
    }
  }
  // bez rozmerov okna (headless bez plátna) sa nepreklápa ani nepriťahuje
  assert.deepEqual(hoverTipPlacement({ x: 900, y: 570, width: 340, height: 90 }), { x: 914, y: 584 });
});

test('dávka pohybov = jedno hľadanie, a to pod POSLEDNOU polohou kurzora', () => {
  const r = rig({ resolve: (pos) => (pos.x === 400 ? { text: 'UKMTO 149-26 · útok', accent: '#ff5a5f' } : null) });
  r.hover.install();
  assert.equal(r.tipEl.hidden, true, 'pred pohybom nič');
  r.move(100, 100); r.move(250, 180); r.move(400, 300);
  assert.equal(r.timers.length, 1, 'jeden časovač na dávku');
  assert.equal(r.timers[0].ms, HOVER_TIP_DELAY_MS);
  assert.equal(r.run(), 1);
  assert.deepEqual(r.asked, [{ x: 400, y: 300 }], 'pýta sa raz, na miesto, kde myš zastala');
  assert.equal(r.tipEl.hidden, false);
  assert.equal(r.tipEl.textContent, 'UKMTO 149-26 · útok');
  assert.equal(r.tipEl.style.vars['--ukr-accent'], '#ff5a5f');
  assert.deepEqual(r.translate(), { x: 400 + HOVER_TIP_GAP_PX, y: 300 + HOVER_TIP_GAP_PX });
  // ďalší pohyb mimo bodu bublinu schová
  r.move(600, 300);
  r.run();
  assert.equal(r.tipEl.hidden, true);
  assert.equal(r.asked.length, 2);
});

test('bublina pri okraji mapy ostane celá v okne (meria sa až po zobrazení)', () => {
  const r = rig({ resolve: () => ({ text: 'dlhé varovanie '.repeat(20) }) });
  r.hover.install();
  r.move(980, 590);
  r.run();
  const at = r.translate();
  assert.ok(at.x + 340 <= 1000 - HOVER_TIP_MARGIN_PX, `pretiekla vpravo: ${at.x}`);
  assert.ok(at.y + 90 <= 600 - HOVER_TIP_MARGIN_PX, `pretiekla dole: ${at.y}`);
  assert.ok(at.x >= HOVER_TIP_MARGIN_PX && at.y >= HOVER_TIP_MARGIN_PX);
});

test('kurzor odišiel z mapy alebo sa pohla kamera → bublina zmizne a čakajúce hľadanie sa zahodí', () => {
  const r = rig({ resolve: () => ({ text: 'FIR OIIX · všetky výšky' }) });
  r.hover.install();
  r.move(300, 300); r.run();
  assert.equal(r.tipEl.hidden, false);
  r.dom.get('pointerleave')();
  assert.equal(r.tipEl.hidden, true, 'kurzor prešiel na panel');
  // hľadanie naplánované tesne pred odchodom sa už nevykoná
  r.move(310, 300);
  r.dom.get('pointerleave')();
  assert.equal(r.run(), 0);
  assert.equal(r.asked.length, 1);
  // pohyb kamery (let na dejisko, koliesko)
  r.move(300, 300); r.run();
  assert.equal(r.tipEl.hidden, false);
  assert.equal(r.moveStart.length, 1);
  r.moveStart[0]();
  assert.equal(r.tipEl.hidden, true, 'mapa sa pohla spod bubliny');
});

test('pri ťahaní mapy sa nehľadá; po pustení tlačidla áno', () => {
  const r = rig({ resolve: () => ({ text: 'bunka 31,5–32° N' }) });
  r.hover.install();
  r.move(300, 300); r.run();
  assert.equal(r.tipEl.hidden, false);
  r.press(T.LEFT_DOWN);
  assert.equal(r.tipEl.hidden, true, 'stlačenie bublinu schová');
  r.move(320, 310); r.move(360, 330);
  assert.equal(r.run(), 0, 'počas ťahania žiadny časovač');
  r.press(T.LEFT_UP);
  r.move(360, 331);
  assert.equal(r.run(), 1);
  assert.equal(r.tipEl.hidden, false);
  // tlačidlo pustené mimo plátna (pointerleave) neblokuje bublinu navždy
  r.press(T.RIGHT_DOWN);
  r.dom.get('pointerleave')();
  r.move(200, 200);
  assert.equal(r.run(), 1);
  assert.equal(r.tipEl.hidden, false);
});

test('vypnutá alebo schovaná vrstva nič nehľadá a bublinu nenechá visieť', () => {
  let on = true;
  const r = rig({ resolve: () => ({ text: 'x' }), isActive: () => on });
  r.hover.install();
  r.move(300, 300); r.run();
  assert.equal(r.tipEl.hidden, false);
  on = false;
  r.move(305, 300);
  assert.equal(r.run(), 0, 'vypnutá vrstva neplánuje hľadanie');
  // vrstva sa vypla medzi pohybom a hľadaním
  on = true; r.move(306, 300); on = false;
  r.run();
  assert.equal(r.asked.length, 1, 'scene.pick sa pre vypnutú vrstvu nevolá');
  assert.equal(r.tipEl.hidden, true);
  // hide() zvonka (vrstva sa schovala) zahodí aj čakajúce hľadanie
  on = true; r.move(300, 300); r.hover.hide();
  assert.equal(r.run(), 0);
});

test('chyba pri hľadaní bublinu schová, nezhodí stránku', () => {
  const r = rig({ resolve: () => { throw new Error('pick zlyhal'); } });
  r.hover.install();
  r.move(300, 300);
  assert.doesNotThrow(() => r.run());
  assert.equal(r.tipEl.hidden, true);
});

test('bez plátna (testy vrstiev, headless) sa nič nepočúva; install je idempotentný; destroy uprace', () => {
  const none = rig({ withCanvas: false });
  none.hover.install();
  assert.equal(none.handlers.length, 0);
  assert.match(none.tipEl.className, /^oko-ukr-ctl-tip oko-map-tip oko-test-tip$/);
  assert.equal(none.viewer.container.children.length, 1, 'prvok bubliny je v kontajneri mapy');
  assert.doesNotThrow(() => none.hover.destroy());

  const r = rig({ resolve: () => ({ text: 'x' }) });
  r.hover.install(); r.hover.install();
  assert.equal(r.handlers.length, 1);
  r.move(300, 300);
  r.hover.destroy();
  assert.equal(r.run(), 0, 'čakajúce hľadanie zrušené');
  assert.equal(r.handlers[0].destroyed, true);
  assert.equal(r.dom.has('pointerleave'), false);
  assert.equal(r.moveStart.length, 0);
  assert.equal(r.tipEl.removed, true);
});
