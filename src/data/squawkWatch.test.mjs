// src/data/squawkWatch.test.mjs
// Núdzový squawk bez kliknutia (2026-09-03). Testy sú o tom, kedy sa
// hlásenie NEobjaví — otravné upozornenie je horšie než žiadne.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SQUAWK_ALERT_COOLDOWN_MS,
  createSquawkWatch,
  presentSquawkAlerts,
} from './squawkWatch.js';

const T0 = 1_800_000_000_000;
const row = (id, squawk, extra = {}) => ({ id, squawk, label: id.toUpperCase(), ...extra });

test('prvé načítanie MLČÍ, aj keď je scéna plná núdzových kódov', () => {
  // Po zapnutí vrstvy býva v scéne niekoľko strojov so zabudnutým kódom.
  // Vysypať dvadsať hlásení naraz je najrýchlejšia cesta k tomu, aby ich
  // operátor začal ignorovať.
  const watch = createSquawkWatch();
  const first = watch.observe([row('a', '7700'), row('b', '7600'), row('c', '7500')], { nowMs: T0 });
  assert.deepEqual(first, [], 'prvý poll je len naplnenie pamäte');
  // Ten istý stav o poll neskôr stále nie je udalosť.
  assert.deepEqual(watch.observe([row('a', '7700')], { nowMs: T0 + 30_000 }), []);
});

test('nový núdzový kód sa ohlási raz, nie pri každom polle', () => {
  const watch = createSquawkWatch();
  watch.observe([row('a', '1000')], { nowMs: T0 }); // priming
  const hit = watch.observe([row('a', '7700')], { nowMs: T0 + 30_000 });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].code, '7700');
  assert.equal(hit[0].meaning, 'EMERGENCY');
  assert.equal(hit[0].label, 'A');
  // Poll beží každých 30 s — bez tlmenia by to hlásilo dvakrát za minútu.
  for (let i = 2; i < 10; i++) {
    assert.deepEqual(watch.observe([row('a', '7700')], { nowMs: T0 + i * 30_000 }), []);
  }
});

test('eskalácia 7600 → 7700 je NOVÁ udalosť, aj v tlmiacom okne', () => {
  const watch = createSquawkWatch();
  watch.observe([row('a', '1000')], { nowMs: T0 });
  watch.observe([row('a', '7600')], { nowMs: T0 + 1000 });
  const escalated = watch.observe([row('a', '7700')], { nowMs: T0 + 2000 });
  assert.equal(escalated.length, 1, 'zmena kódu nie je duplikát');
  assert.equal(escalated[0].code, '7700');
});

test('po vypršaní tlmenia sa trvajúca núdza pripomenie', () => {
  const watch = createSquawkWatch();
  watch.observe([row('a', '1000')], { nowMs: T0 });
  watch.observe([row('a', '7700')], { nowMs: T0 + 1000 });
  assert.deepEqual(watch.observe([row('a', '7700')], { nowMs: T0 + 60_000 }), [], 'ešte v tlmení');
  const again = watch.observe([row('a', '7700')], { nowMs: T0 + 1000 + SQUAWK_ALERT_COOLDOWN_MS });
  assert.equal(again.length, 1, 'po tlmení sa trvajúci stav pripomenie');
});

test('preblikávajúci squawk nespamuje: odvolanie núdze pamäť nemaže', () => {
  // Kontakt, ktorý na jeden poll stratí squawk a vzápätí ho má znova, by
  // inak hlásil pri každom takom kmite.
  const watch = createSquawkWatch();
  watch.observe([row('a', '1000')], { nowMs: T0 });
  assert.equal(watch.observe([row('a', '7700')], { nowMs: T0 + 1000 }).length, 1);
  watch.observe([row('a', null)], { nowMs: T0 + 2000 });
  assert.deepEqual(watch.observe([row('a', '7700')], { nowMs: T0 + 3000 }), []);
});

test('kontakt, čo vypadol z feedu a vrátil sa, sa v tlmení neohlási znova', () => {
  const watch = createSquawkWatch();
  watch.observe([row('a', '1000')], { nowMs: T0 });
  assert.equal(watch.observe([row('a', '7700')], { nowMs: T0 + 1000 }).length, 1);
  watch.observe([], { nowMs: T0 + 2000 }); // pan kamery, kontakt mimo výrezu
  assert.deepEqual(watch.observe([row('a', '7700')], { nowMs: T0 + 3000 }), []);
});

test('viac udalostí naraz sa zoradí podľa závažnosti, 7700 prvé', () => {
  const watch = createSquawkWatch();
  watch.observe([row('a', '1000'), row('b', '1000'), row('c', '1000')], { nowMs: T0 });
  const hits = watch.observe(
    [row('c', '7600'), row('a', '7500'), row('b', '7700')],
    { nowMs: T0 + 1000 },
  );
  assert.deepEqual(hits.map((h) => h.code), ['7700', '7500', '7600']);
});

test('hlásenie je JEDNO — toast nemá frontu', () => {
  // #toast je jediný element s jediným časovačom: druhé hlásenie prvé
  // okamžite prepíše. Preto sa skladá jedna veta, nie n hlásení.
  assert.equal(presentSquawkAlerts([]), null);
  assert.equal(presentSquawkAlerts(null), null);
  const one = presentSquawkAlerts([{ id: 'a', code: '7700', meaning: 'EMERGENCY', label: 'OK123' }]);
  assert.equal(one.key, 'alert.squawk.one');
  assert.equal(one.vars.label, 'OK123');
  assert.equal(one.target.id, 'a');
  const many = presentSquawkAlerts([
    { id: 'a', code: '7700', meaning: 'EMERGENCY', label: 'OK123' },
    { id: 'b', code: '7600', meaning: 'RADIO FAILURE', label: 'OK456' },
    { id: 'c', code: '7500', meaning: 'HIJACK', label: 'OK789' },
  ]);
  assert.equal(many.key, 'alert.squawk.many');
  assert.equal(many.vars.n, 2, 'najzávažnejšia menovite, zvyšok počtom');
  assert.equal(many.target.id, 'a', 'skok vedie na najzávažnejší kontakt');
});

test('reset vráti sledovač do stavu „ešte som nič nevidel"', () => {
  const watch = createSquawkWatch();
  watch.observe([row('a', '7700')], { nowMs: T0 });
  watch.reset();
  assert.equal(watch.size(), 0);
  assert.deepEqual(watch.observe([row('a', '7700')], { nowMs: T0 + 1000 }), [], 'po resete opäť mlčí');
});

test('pamäť nerastie donekonečna', () => {
  const watch = createSquawkWatch({ maxEntries: 10 });
  watch.observe([row('x', '7700')], { nowMs: T0 });
  const many = Array.from({ length: 50 }, (_, i) => row(`id${i}`, '7700'));
  watch.observe(many, { nowMs: T0 + 1000 });
  assert.ok(watch.size() <= 10, `pamäť je ohraničená, má ${watch.size()}`);
});

test('nezmyselné riadky sledovač nezhodia', () => {
  const watch = createSquawkWatch();
  watch.observe([row('a', '1000')], { nowMs: T0 });
  const hits = watch.observe(
    [null, undefined, {}, { id: '' }, { id: 'b', squawk: 'nezmysel' }, row('a', '7700')],
    { nowMs: T0 + 1000 },
  );
  assert.deepEqual(hits.map((h) => h.id), ['a']);
  assert.deepEqual(watch.observe(null, { nowMs: T0 + 2000 }), []);
});
