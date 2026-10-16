// src/data/aisWorldResponseCache.test.mjs — krátka cache odpovede /api/ais-live bez výrezu
// (2026-10-15: súbežní návštevníci pri štarte skladali tých istých ~22 MB znova a znova).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AIS_WORLD_RESPONSE_CACHE_MAX,
  AIS_WORLD_RESPONSE_CACHE_MS,
  aisWorldResponseKey,
  answerAisLiveRequest,
  createAisWorldResponseCache,
} from './aisWorldResponseCache.js';
import { parseAisBounds } from './aisCoverage.js';

function clockAt(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance(ms) { now += ms; } };
}

function countingBuilder() {
  let builds = 0;
  return {
    get builds() { return builds; },
    build: () => {
      builds += 1;
      return { statusCode: 200, body: JSON.stringify({ build: builds }) };
    },
  };
}

test('požiadavka s výrezom sa nekešuje nikdy; svet podľa maxRows a vybranej lode', () => {
  assert.equal(aisWorldResponseKey({ bounds: parseAisBounds('16,47,18,49'), maxRows: 50000 }), null);
  const world = aisWorldResponseKey({ bounds: null, maxRows: 50000, selected: null });
  assert.equal(typeof world, 'string');
  assert.notEqual(aisWorldResponseKey({ bounds: null, maxRows: 15000 }), world, 'telefón ≠ počítač');
  assert.notEqual(aisWorldResponseKey({ bounds: null, maxRows: 50000, selected: '219000000' }), world, 'vybraná loď je pripnutá v odpovedi');
  assert.equal(aisWorldResponseKey({ bounds: null, maxRows: 50000, selected: '' }), world);
});

test('súbežní návštevníci v rámci pár sekúnd dostanú to isté telo bez nového skladania', () => {
  const clock = clockAt();
  const cache = createAisWorldResponseCache({ now: clock.now });
  const builder = countingBuilder();
  const key = aisWorldResponseKey({ maxRows: 50000 });
  const first = cache.respond(key, builder.build);
  clock.advance(AIS_WORLD_RESPONSE_CACHE_MS - 1);
  const second = cache.respond(key, builder.build);
  assert.equal(builder.builds, 1);
  assert.equal(first.cache, 'MISS');
  assert.equal(second.cache, 'HIT');
  assert.equal(second.body, first.body);
  assert.equal(second.statusCode, 200);

  // po uplynutí krátkej lehoty sa skladá nanovo (dáta nesmú zostarnúť)
  clock.advance(1);
  const third = cache.respond(key, builder.build);
  assert.equal(builder.builds, 2);
  assert.equal(third.cache, 'MISS');
  assert.notEqual(third.body, first.body);
});

test('iný strop riadkov (telefón) má vlastnú odpoveď; stav 503 bez kľúča sa vráti tak, ako bol zložený', () => {
  const clock = clockAt();
  const cache = createAisWorldResponseCache({ now: clock.now });
  let builds = 0;
  const desktop = cache.respond(aisWorldResponseKey({ maxRows: 50000 }), () => { builds++; return { statusCode: 503, body: 'desktop' }; });
  const phone = cache.respond(aisWorldResponseKey({ maxRows: 15000 }), () => { builds++; return { statusCode: 503, body: 'phone' }; });
  assert.equal(builds, 2);
  assert.equal(desktop.body, 'desktop');
  assert.equal(phone.body, 'phone');
  const again = cache.respond(aisWorldResponseKey({ maxRows: 50000 }), () => { builds++; return { statusCode: 200, body: 'x' }; });
  assert.equal(builds, 2);
  assert.equal(again.statusCode, 503);
  assert.equal(again.body, 'desktop');
});

test('chyba pri skladaní sa neuloží — ďalšia požiadavka skladá znova', () => {
  const cache = createAisWorldResponseCache({ now: clockAt().now });
  const key = aisWorldResponseKey({ maxRows: 50000 });
  assert.throws(() => cache.respond(key, () => { throw new Error('boom'); }), /boom/);
  assert.equal(cache.size, 0);
  assert.equal(cache.respond(key, () => ({ statusCode: 200, body: 'ok' })).cache, 'MISS');
});

test('pamäť je ohraničená: najviac AIS_WORLD_RESPONSE_CACHE_MAX odpovedí, staré sa zahodia', () => {
  const clock = clockAt();
  const cache = createAisWorldResponseCache({ now: clock.now });
  for (let i = 0; i < AIS_WORLD_RESPONSE_CACHE_MAX + 3; i++) {
    cache.respond(aisWorldResponseKey({ maxRows: 50000, selected: String(i) }), () => ({ statusCode: 200, body: String(i) }));
  }
  assert.equal(cache.size, AIS_WORLD_RESPONSE_CACHE_MAX);
  // najstaršia vypadla, najnovšia ostala
  let rebuilt = false;
  cache.respond(aisWorldResponseKey({ maxRows: 50000, selected: '0' }), () => { rebuilt = true; return { statusCode: 200, body: '0' }; });
  assert.equal(rebuilt, true);
  // vypršané sa zahodia pri ďalšej požiadavke
  clock.advance(AIS_WORLD_RESPONSE_CACHE_MS);
  cache.respond(aisWorldResponseKey({ maxRows: 50000 }), () => ({ statusCode: 200, body: 'fresh' }));
  assert.equal(cache.size, 1);
  cache.clear();
  assert.equal(cache.size, 0);
});

/** Ručné časovače: zachytia odklad, unref a dajú sa spustiť. */
function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(fn, ms) {
      const timer = { fn, ms, unrefed: false, cleared: false, unref() { this.unrefed = true; } };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { if (timer) timer.cleared = true; },
    live() { return timers.filter((timer) => !timer.cleared && !timer.fired); },
    fire(timer) { timer.fired = true; timer.fn(); },
  };
}

test('vypršané odpovede sa zahodia aj bez ďalšej požiadavky (unref časovač) — služba nedrží 4 × 22 MB naveky', () => {
  const clock = clockAt();
  const timers = fakeTimers();
  const cache = createAisWorldResponseCache({ now: clock.now, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  cache.respond(aisWorldResponseKey({ maxRows: 50000 }), () => ({ statusCode: 200, body: 'world' }));
  clock.advance(1000);
  cache.respond(aisWorldResponseKey({ maxRows: 50000, selected: '219000000' }), () => ({ statusCode: 200, body: 'selected' }));
  assert.equal(cache.size, 2);
  assert.equal(timers.live().length, 1, 'jeden časovač na najstaršiu odpoveď');
  const [first] = timers.live();
  assert.equal(first.ms, AIS_WORLD_RESPONSE_CACHE_MS, 'naplánovaný pri prvej odpovedi na jej vypršanie');
  assert.equal(first.unrefed, true, 'nedrží proces nažive');

  // posledný návštevník odišiel; žiadna ďalšia požiadavka
  clock.advance(AIS_WORLD_RESPONSE_CACHE_MS - 1000);
  timers.fire(first);
  assert.equal(cache.size, 1, 'najstaršia zahodená');
  const [second] = timers.live();
  assert.equal(second.ms, 1000);
  clock.advance(1000);
  timers.fire(second);
  assert.equal(cache.size, 0, 'všetko zahodené');
  assert.equal(timers.live().length, 0, 'prázdna cache nič neplánuje');

  cache.respond(aisWorldResponseKey({ maxRows: 50000 }), () => ({ statusCode: 200, body: 'again' }));
  cache.clear();
  assert.equal(timers.live().length, 0, 'clear zruší aj časovač');
});

test('odpoveď /api/ais-live: výrez sa skladá vždy nanovo a bez hlavičky cache; svet MISS → HIT; vždy no-store', () => {
  const clock = clockAt();
  const cache = createAisWorldResponseCache({ now: clock.now, setTimer: () => null });
  let builds = 0;
  const build = () => { builds += 1; return { statusCode: 200, body: `body-${builds}` }; };
  const bounds = parseAisBounds('16,47,18,49');

  const view1 = answerAisLiveRequest({ bounds, maxRows: 50000, selected: null, cache, build });
  const view2 = answerAisLiveRequest({ bounds, maxRows: 50000, selected: null, cache, build });
  assert.equal(builds, 2, 'výrez sa nekešuje');
  assert.equal(view2.body, 'body-2');
  assert.equal(view1.headers['X-AIS-World-Cache'], undefined);
  assert.equal(view1.headers['Cache-Control'], 'no-store');
  assert.equal(view1.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(cache.size, 0);

  const world1 = answerAisLiveRequest({ bounds: null, maxRows: 50000, selected: null, cache, build });
  const world2 = answerAisLiveRequest({ bounds: null, maxRows: 50000, selected: null, cache, build });
  assert.equal(builds, 3, 'svet sa zložil raz pre oboch');
  assert.equal(world1.headers['X-AIS-World-Cache'], 'MISS');
  assert.equal(world2.headers['X-AIS-World-Cache'], 'HIT');
  assert.equal(world2.body, world1.body);
  assert.equal(world2.headers['Cache-Control'], 'no-store', 'klient si nič nedrží');

  const keyless = answerAisLiveRequest({
    bounds: null, maxRows: 12000, selected: null, cache, build: () => ({ statusCode: 503, body: 'missing-key' }),
  });
  assert.equal(keyless.statusCode, 503);
});

test('zapojenie: /api/ais-live vo vite.config.js ide cez answerAisLiveRequest s _aisWorldResponseCache; zatvorenie servera cache vyprázdni', () => {
  const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(config, /import \{ answerAisLiveRequest, createAisWorldResponseCache \} from '\.\/src\/data\/aisWorldResponseCache\.js';/);
  assert.match(config, /const _aisWorldResponseCache = createAisWorldResponseCache\(\);/);
  const handler = config.slice(config.indexOf("middlewares.use('/api/ais-live'"), config.indexOf('function buildAisLiveResponse('));
  assert.ok(handler.length > 0, 'handler /api/ais-live nájdený');
  assert.match(handler, /const answer = answerAisLiveRequest\(\{\s*bounds, maxRows, selected,\s*cache: _aisWorldResponseCache,\s*build: \(\) => buildAisLiveResponse\(\{ maxRows, bounds, selected \}\),\s*\}\);/);
  assert.match(handler, /for \(const \[name, value\] of Object\.entries\(answer\.headers\)\) res\.setHeader\(name, value\);\s*res\.end\(answer\.body\);/);
  // telo sa skladá len cez cache (build) — nikde inde priamo
  assert.equal(config.match(/buildAisLiveResponse\(/g).length, 2, 'definícia + build pre cache');
  assert.match(config, /function disposeAisStream\(\) \{[\s\S]{0,400}?_aisWorldResponseCache\.clear\(\);/);
});
