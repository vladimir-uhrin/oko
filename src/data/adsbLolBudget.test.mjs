// src/data/adsbLolBudget.test.mjs — denný rozpočet adsb.lol (2026-10-23, 500 dopytov na IP; vlastník: „oprav všetko").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADSBLOL_BLIND_PAUSE_MS, ADSBLOL_DAILY_LIMIT, ADSBLOL_FALLBACK_PAUSE_MS, ADSBLOL_KINDS, createAdsbLolBudget, parseAdsbLolRateLimit,
} from './adsbLolBudget.js';
import { createUpstreamRegistry } from './upstreamStatus.js';

// Skutočné hlavičky adsb.lol z 2026-10-23 (envoy): denné okno vyčerpané, reset o ~9 h.
const DAY_EXHAUSTED = { 'x-ratelimit-limit': '500, 4;w=1, 60;w=60, 500;w=86400', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '32182' };
const dayHeaders = (remaining, resetS = 40_000) => new Headers({ 'x-ratelimit-limit': '500, 4;w=1, 60;w=60, 500;w=86400', 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-reset': String(resetS) });
const secondHeaders = (remaining) => new Headers({ 'x-ratelimit-limit': '4, 4;w=1, 60;w=60, 500;w=86400', 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-reset': '1' });

test('hlavičky: denné okno podľa dlhého resetu, sekundové okno sa za deň nepovažuje, Headers aj objekt', () => {
  const t = 1_000_000;
  const day = parseAdsbLolRateLimit(DAY_EXHAUSTED, t);
  assert.deepEqual(day, { remaining: 0, resetS: 32182, resetAtMs: t + 32_182_000, dayWindow: true, dailyLimit: 500 });
  const sec = parseAdsbLolRateLimit(secondHeaders(3), t);
  assert.equal(sec.remaining, 3);
  assert.equal(sec.dayWindow, false, 'reset 1 s = sekundové okno');
  assert.equal(sec.dailyLimit, 500);
  assert.deepEqual(parseAdsbLolRateLimit(null, t), { remaining: null, resetS: null, resetAtMs: null, dayWindow: false, dailyLimit: null });
  assert.equal(parseAdsbLolRateLimit({ 'X-RateLimit-Remaining': '12', 'X-RateLimit-Reset': '500' }, t).remaining, 12, 'veľkosť písmen nehrá rolu');
  assert.equal(ADSBLOL_DAILY_LIMIT, 500);
});

test('prednosti: hľadanie míňa do nuly, štátne lietadlá nechajú 30, hromadné 60; bez známeho zostatku všetko smie', () => {
  let t = 1_000_000;
  const b = createAdsbLolBudget({ now: () => t, registry: createUpstreamRegistry({ now: () => t }) });
  for (const kind of ['search', 'state', 'regional', 'mil']) assert.equal(b.allow(kind), true, `${kind} bez zostatku`);
  b.record('search', { status: 200, headers: dayHeaders(61) });
  assert.equal(b.allow('mil'), true);
  b.record('search', { status: 200, headers: dayHeaders(60) });
  assert.equal(b.allow('mil'), false, 'hromadné pri rezerve 60 končia');
  assert.equal(b.allow('regional'), false);
  assert.equal(b.allow('state'), true);
  assert.equal(b.allow('search'), true);
  b.record('search', { status: 200, headers: dayHeaders(30) });
  assert.equal(b.allow('state'), false, 'štátne lietadlá pri rezerve 30 končia');
  assert.equal(b.allow('search'), true, 'hľadanie smie až do nuly');
  b.record('search', { status: 200, headers: dayHeaders(0) });
  assert.equal(b.allow('search'), false);
  assert.equal(b.paused(), true, 'zostatok 0 = pauza do resetu dňa');
  assert.deepEqual(Object.keys(ADSBLOL_KINDS), ['search', 'state', 'regional', 'mil']);
  // Po resete dňa zostatok neplatí, prvý dopyt ho prinesie znova.
  t += 40_001_000;
  assert.equal(b.paused(), false);
  assert.equal(b.status().remaining, null);
  assert.equal(b.allow('mil'), true);
});

test('odstupy druhov: štátne 60 s, regionálne 30 s, záloha vojenských letov 5 min; hľadanie bez odstupu', () => {
  let t = 1_000_000;
  const b = createAdsbLolBudget({ now: () => t, registry: createUpstreamRegistry({ now: () => t }) });
  for (const [kind, gap] of [['state', 60_000], ['regional', 30_000], ['mil', 300_000]]) {
    assert.equal(b.allow(kind), true);
    b.spend(kind);
    assert.equal(b.allow(kind), false, `${kind} hneď znova nie`);
    t += gap - 1;
    assert.equal(b.allow(kind), false);
    t += 1;
    assert.equal(b.allow(kind), true, `${kind} po ${gap / 1000} s áno`);
  }
  b.spend('search'); assert.equal(b.allow('search'), true);
  assert.equal(b.status().spentToday.search, 1);
  assert.equal(b.status().spentToday.mil, 1);
});

test('429 denného okna: pauza do resetu, zostatok 0, register dostane pauzu; 429 sekundového okna: pauza 1 s', () => {
  let t = 1_000_000;
  const registry = createUpstreamRegistry({ now: () => t });
  const b = createAdsbLolBudget({ now: () => t, registry });
  b.record('mil', { status: 429, headers: DAY_EXHAUSTED });
  assert.equal(b.paused(), true);
  assert.equal(b.pausedUntil(), t + 32_182_000);
  assert.equal(b.status().remaining, 0);
  assert.equal(b.allow('search'), false);
  assert.equal(registry.paused('adsb.lol'), true);
  assert.equal(registry.snapshot()[0].lastHour.limited, 1);
  t += 32_182_000;
  assert.equal(b.paused(), false, 'po resete dňa znova');
  assert.equal(b.allow('search'), true);
  const b2 = createAdsbLolBudget({ now: () => t, registry: createUpstreamRegistry({ now: () => t }) });
  b2.record('search', { status: 200, headers: dayHeaders(300) });
  b2.record('search', { status: 429, headers: secondHeaders(0) });
  assert.equal(b2.paused(), true);
  assert.equal(b2.pausedUntil(), t + 1000, 'sekundové okno = krátka pauza');
  assert.equal(b2.status().remaining, 300, 'denný zostatok ostáva');
  t += 1001;
  assert.equal(b2.allow('search'), true);
});

test('429 bez hlavičiek: minúta, pri opakovaní zdvojená po hodinu, zostatok dňa sa nenuluje; chyba siete len do registra; spend znižuje odhad', () => {
  let t = 1_000_000;
  const registry = createUpstreamRegistry({ now: () => t });
  const b = createAdsbLolBudget({ now: () => t, registry });
  b.record('state', { status: 200, headers: dayHeaders(200) });
  b.record('state', { status: 429 });
  assert.equal(b.pausedUntil(), t + ADSBLOL_BLIND_PAUSE_MS, 'prvé naslepo = minúta');
  assert.equal(b.status().remaining, 200, 'zostatok dňa ostáva');
  t += ADSBLOL_BLIND_PAUSE_MS;
  assert.equal(b.allow('search'), true, 'po minúte hľadanie znova (vlastný test služby: „po pauze znova")');
  b.record('state', { status: 429 });
  assert.equal(b.pausedUntil(), t + 2 * ADSBLOL_BLIND_PAUSE_MS, 'druhé po sebe = 2 min');
  for (let i = 0; i < 8; i++) { t = b.pausedUntil(); b.record('state', { status: 429 }); }
  assert.equal(b.pausedUntil() - t, ADSBLOL_FALLBACK_PAUSE_MS, 'strop hodina');
  t = b.pausedUntil();
  b.record('state', { status: 200, headers: dayHeaders(150) });
  b.record('state', { status: 429 });
  assert.equal(b.pausedUntil(), t + ADSBLOL_BLIND_PAUSE_MS, 'úspech vynuluje zdvojovanie');
  t += ADSBLOL_BLIND_PAUSE_MS;
  b.record('state', { error: true });
  assert.equal(b.paused(), false);
  assert.equal(registry.snapshot()[0].lastHour.errors, 1);
  b.record('state', { status: 200, headers: dayHeaders(100) });
  b.spend('search');
  assert.equal(b.status().remaining, 99, 'medzi odpoveďami sa odhaduje');
  b.record('search', { status: 200, headers: dayHeaders(98) });
  assert.equal(b.status().remaining, 98, 'odpoveď je autoritatívna');
  const st = b.status();
  assert.equal(st.dailyLimit, 500);
  assert.equal(st.lastStatus, 200);
  assert.equal(st.paused, false);
});
