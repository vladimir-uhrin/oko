import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import createViteConfig, {
  adsbLolFallbackAnchor,
  coalesceProxyRequest,
  launchLibraryRequestHeaders,
  LL2_CACHE_TTL_MS,
  readResponseJsonCapped,
  regionalBriefHasAnySource,
  REGIONAL_FALLBACK_PROVIDERS,
  validMilitaryInstallationBox,
  validRegionalPoint,
} from '../../vite.config.js';

test('regional proxy rejects absent and blank coordinates instead of coercing them to zero', () => {
  assert.equal(validRegionalPoint(new URLSearchParams('longitude=12.5')), null);
  assert.equal(validRegionalPoint(new URLSearchParams('latitude=12.5')), null);
  assert.equal(validRegionalPoint(new URLSearchParams('latitude=&longitude=12.5')), null);
  assert.deepEqual(
    validRegionalPoint(new URLSearchParams('latitude=0&longitude=0')),
    { latitude: 0, longitude: 0 },
  );
});

test('adjacent proxy validators also require every coordinate explicitly', () => {
  assert.equal(
    validMilitaryInstallationBox(new URLSearchParams('west=-1&north=1&east=1')),
    null,
  );
  assert.equal(adsbLolFallbackAnchor({ url: '?lat=12.5' }), null);
  assert.equal(adsbLolFallbackAnchor({ url: '?lon=12.5' }), null);
});

test('new data proxies install the same routes in dev and preview servers', () => {
  const config = createViteConfig({ mode: 'test' });
  const byName = new Map(config.plugins.map((plugin) => [plugin.name, plugin]));
  for (const name of [
    'rocket-launches-proxy',
    'military-installations-proxy',
    'regional-brief-proxy',
    'weather-effects-proxy',
  ]) {
    assert.equal(typeof byName.get(name)?.configureServer, 'function', `${name} dev hook`);
    assert.equal(typeof byName.get(name)?.configurePreviewServer, 'function', `${name} preview hook`);
  }
});

test('Launch Library uses a 15-minute cache and optional server-side token header', () => {
  assert.equal(LL2_CACHE_TTL_MS, 15 * 60_000);
  assert.deepEqual(launchLibraryRequestHeaders(''), { Accept: 'application/json' });
  assert.deepEqual(launchLibraryRequestHeaders(' secret '), {
    Accept: 'application/json',
    Authorization: 'Token secret',
  });
});

test('proxy request coalescing shares one per-key refresh and clears it after settlement', async () => {
  const inFlight = new Map();
  let refreshCount = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = coalesceProxyRequest(inFlight, 'cell', async () => {
    refreshCount += 1;
    await gate;
    return 'fresh';
  });
  const second = coalesceProxyRequest(inFlight, 'cell', () => {
    refreshCount += 1;
    return 'duplicate';
  });
  assert.equal(first.shared, false);
  assert.equal(second.shared, true);
  assert.equal(first.promise, second.promise);
  release();
  assert.equal(await second.promise, 'fresh');
  assert.equal(refreshCount, 1);
  assert.equal(inFlight.size, 0);
});

test('bounded JSON reader rejects oversized upstream bodies', async () => {
  assert.deepEqual(await readResponseJsonCapped(new Response('{"ok":true}'), 32), { ok: true });
  await assert.rejects(
    readResponseJsonCapped(new Response(JSON.stringify({ value: 'x'.repeat(64) })), 32),
    (error) => error?.code === 'RESPONSE_TOO_LARGE',
  );
});

test('regional flight fallback chain: adsb.lol primary, adsb.fi second, both pinned', () => {
  // Poradie je zámerné: adsb.lol je zabehnutý primárny fallback (ODbL);
  // adsb.fi je záloha zálohy (fair-use, nekomerčné, 1 req/s — a chybové
  // odpovede sa im počítajú do limitu, takže reťaz musí ostať
  // single-attempt-per-provider, žiadne retry slučky).
  assert.deepEqual(
    REGIONAL_FALLBACK_PROVIDERS.map((provider) => provider.name),
    ['adsb.lol', 'adsb.fi'],
  );
  assert.equal(
    REGIONAL_FALLBACK_PROVIDERS[0].url(48.25, 17, 250),
    'https://api.adsb.lol/v2/lat/48.25/lon/17/dist/250',
  );
  // adsb.fi: výhradne /api/v3 — ich v2 lat/lon variant je deprecated a vracia
  // iný tvar než ostatné v2 endpointy (README adsbfi/opendata).
  assert.equal(
    REGIONAL_FALLBACK_PROVIDERS[1].url(48.25, 17, 250),
    'https://opendata.adsb.fi/api/v3/lat/48.25/lon/17/dist/250',
  );
});

test('regional fallback serves an honest per-provider X-Flight-Source header', () => {
  // Zdrojová poctivosť (CLAUDE.md pravidlo 2): keď dáta reálne prišli z
  // adsb.fi, chip v UI nesmie tvrdiť adsb.lol. Pin drží hlavičku dynamickú —
  // čítanú zo záznamu, nie hardcodovanú.
  const viteSource = readFileSync(
    fileURLToPath(new URL('../../vite.config.js', import.meta.url)),
    'utf8',
  );
  assert.match(viteSource, /'X-Flight-Source':\s*fallback\.source/);
});

test('regional brief treats an all-source outage as total failure', () => {
  assert.equal(regionalBriefHasAnySource({
    place: null,
    weather: null,
    news: { status: 'unavailable' },
  }), false);
  assert.equal(regionalBriefHasAnySource({
    place: { country: 'United States' },
    weather: null,
    news: { status: 'unavailable' },
  }), true);
});
