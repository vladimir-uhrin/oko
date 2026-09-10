// src/data/imageDecode.test.mjs
// Bezpečné čakanie na dekódovanie obrázka (2026-09-10): prísľub z `decode()`
// sa v skrytej karte NIKDY neusadí a tri vrstvy na ňom uviazli navždy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECODE_BUDGET_MS, awaitImageDecode } from './imageDecode.js';

const visible = { hidden: false };

test('nikdy neodmietne: bez decode, odmietnutie, synchrónny throw aj nesľubová návratová hodnota', async () => {
  await awaitImageDecode(null, { doc: visible });
  await awaitImageDecode({}, { doc: visible });
  await awaitImageDecode({ decode: () => Promise.reject(new Error('EncodingError')) }, { doc: visible });
  await awaitImageDecode({ decode() { throw new Error('sync'); } }, { doc: visible });
  await awaitImageDecode({ decode: () => undefined }, { doc: visible });
  await awaitImageDecode({ decode: () => 'nie je prísľub' }, { doc: visible });
});

test('úspešné dekódovanie sa počká, nie preskočí', async () => {
  let called = 0;
  let release;
  const img = { decode: () => { called++; return new Promise((r) => { release = r; }); } };
  let settled = false;
  const pending = awaitImageDecode(img, { doc: visible, timeoutMs: 10_000, setTimer: () => {} }).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(called, 1);
  assert.equal(settled, false, 'kým decode beží, čaká sa');
  release();
  await pending;
  assert.equal(settled, true);
});

test('prísľub, ktorý sa NIKDY neusadí, sa uvoľní po rozpočte — to je celá pointa modulu', async () => {
  const timers = [];
  const img = { decode: () => new Promise(() => {}) }; // nikdy resolve ani reject
  let settled = false;
  const pending = awaitImageDecode(img, { doc: visible, timeoutMs: 1234, setTimer: (fn, ms) => timers.push([fn, ms]) })
    .then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0][1], 1234, 'rozpočet sa odovzdá časovaču');
  timers[0][0]();
  await pending;
  assert.equal(settled, true, 'po rozpočte sa pokračuje bez dekódovania');
});

test('v skrytej karte sa decode() ani nezavolá — tam sa preukázateľne nikdy nedokončí', async () => {
  let called = 0;
  const img = { decode: () => { called++; return new Promise(() => {}); } };
  await awaitImageDecode(img, { doc: { hidden: true } });
  assert.equal(called, 0);
  // Bez dokumentu (DOM-less testy) sa správa ako pri viditeľnej karte.
  let called2 = 0;
  await awaitImageDecode({ decode: () => { called2++; return Promise.resolve(); } }, { doc: null });
  assert.equal(called2, 1);
});

test('rozpočet je konečný a všetci traja volajúci idú cez pomôcku (žiadny holý await decode)', () => {
  assert.ok(Number.isFinite(DECODE_BUDGET_MS) && DECODE_BUDGET_MS > 0 && DECODE_BUDGET_MS <= 5000);
  for (const file of ['./densityDrape.js', './shmuRadar.js', './meteoLayer.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /awaitImageDecode\(img\)/, `${file} používa pomôcku`);
    assert.ok(!/img\.decode\(\)\s*\.(catch|then)/.test(src), `${file} nesmie čakať na decode() priamo`);
  }
});
