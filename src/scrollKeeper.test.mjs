// src/scrollKeeper.test.mjs — poloha rolovania prežije prechod rozloženia ľavého stĺpca (2026-10-03).
// Falošný rolovací prvok sa správa ako v prehliadači: poloha sa orezáva na (obsah − výška) a keď
// sa prvok natiahne na celý obsah (meranie prirodzenej výšky panela), spadne na 0 a tam ostane.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createScrollKeeper } from './scrollKeeper.js';

function scroller({ content = 2247, height = 478 } = {}) {
  let top = 0;
  const el = {
    isConnected: true,
    content,
    height,
    get scrollTop() { return top; },
    set scrollTop(v) { top = Math.max(0, Math.min(Number(v) || 0, Math.max(0, el.content - el.height))); },
    /** Panel bez pridelenej výšky: prvok je vysoký ako obsah → prehliadač polohu oreže na 0. */
    stretch() { el.height = el.content; el.scrollTop = top; },
    constrain(h) { el.height = h; },
  };
  return el;
}

test('meranie panela polohu rolovania nezmaže: pred meraním sa zapamätá, po pridelení výšky vráti', () => {
  const keeper = createScrollKeeper();
  const body = scroller();
  keeper.track(body); // udalosť scroll pri prvom rolovaní
  body.scrollTop = 602;
  // jeden prechod enginu
  const memo = keeper.capture();
  body.stretch();
  assert.equal(body.scrollTop, 0, 'bez strážcu by panel skočil na začiatok');
  body.constrain(478);
  assert.equal(keeper.restore(memo), 1);
  assert.equal(body.scrollTop, 602);
  // ďalšie prechody bez rolovania používateľa polohu držia
  for (let i = 0; i < 5; i += 1) { const m = keeper.capture(); body.stretch(); body.constrain(478); keeper.restore(m); }
  assert.equal(body.scrollTop, 602);
});

test('používateľ doroluje inam alebo hore — platí jeho posledná poloha, nie stará', () => {
  const keeper = createScrollKeeper();
  const body = scroller();
  keeper.track(body);
  body.scrollTop = 602;
  let memo = keeper.capture(); body.stretch(); body.constrain(478); keeper.restore(memo);
  body.scrollTop = 150;
  memo = keeper.capture(); body.stretch(); body.constrain(478); keeper.restore(memo);
  assert.equal(body.scrollTop, 150);
  body.scrollTop = 0; // návrat na začiatok
  memo = keeper.capture();
  assert.deepEqual(memo, [], 'poloha 0 sa nepamätá');
  body.stretch(); body.constrain(478);
  assert.equal(keeper.restore(memo), 0);
  assert.equal(body.scrollTop, 0);
});

test('prechod, ktorý skončil skôr (auto-zbalenie), polohy odloží a ďalší prechod ich vráti', () => {
  const keeper = createScrollKeeper();
  const body = scroller();
  keeper.track(body);
  body.scrollTop = 900;
  const first = keeper.capture();
  body.stretch(); // výšky sa v tomto prechode nevrátili
  keeper.defer(first);
  assert.equal(body.scrollTop, 0);
  const second = keeper.capture(); // prvok má 0, ale odložená poloha platí
  assert.deepEqual(second.map(([, top]) => top), [900]);
  body.stretch(); body.constrain(478);
  keeper.restore(second);
  assert.equal(body.scrollTop, 900);
  // odložené sa použije raz
  body.scrollTop = 0;
  assert.deepEqual(keeper.capture(), []);
});

test('viac posuvníkov naraz, odpojený prvok sa zabudne, kratší obsah polohu oreže', () => {
  const keeper = createScrollKeeper();
  const a = scroller(); const b = scroller({ content: 1200, height: 300 }); const gone = scroller();
  for (const el of [a, b, gone, null, {}, { scrollTop: 'x' }]) keeper.track(el);
  assert.equal(keeper.size(), 3, 'len prvky s číselným scrollTop');
  a.scrollTop = 400; b.scrollTop = 250; gone.scrollTop = 100;
  gone.isConnected = false;
  const memo = keeper.capture();
  assert.equal(keeper.size(), 2);
  assert.deepEqual(memo.map(([, top]) => top).sort((x, y) => x - y), [250, 400]);
  a.stretch(); b.stretch(); a.constrain(478); b.constrain(300);
  b.content = 400; // obsah sa medzitým skrátil (iný región správ)
  assert.equal(keeper.restore(memo), 2);
  assert.equal(a.scrollTop, 400);
  assert.equal(b.scrollTop, 100, 'najviac po koniec nového obsahu');
  assert.equal(keeper.restore(null), 0);
  keeper.defer(null); keeper.defer([]);
  assert.deepEqual(keeper.capture().length, 2);
});
