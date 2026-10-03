import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openAdminStore } from './store.js';
import { createAdminRuntime, localDay, pagePath, parseUserAgent, redact, referrerHost, screenBucket, secretValues } from './runtime.js';
import { feedForPath, routeKey } from './feeds.js';
import { analytics, costs, dayRange, feedHistory, traffic, validateFeedUpdate, validateNotice } from './api.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

async function serve(t, runtime) {
  const server = http.createServer((req, res) => {
    runtime.handlePublic(req, res, () => runtime.middleware(req, res, () => {
      res.writeHead(req.url.startsWith('/api/fail') ? 502 : 200, { 'Content-Type': 'text/plain', 'Content-Length': '2' });
      res.end('ok');
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const hit = (body, headers = {}) => fetch(base + '/api/telemetry/hit', { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME, 'Sec-Fetch-Site': 'same-origin', ...headers } });
  return { base, hit };
}

function setup(t, clock = { time: Date.UTC(2026, 9, 3, 10, 0) }) {
  const store = openAdminStore(':memory:');
  const runtime = createAdminRuntime({ store, now: () => clock.time, ownHosts: ['okolive.sk'], secrets: ['supersecretvalue123'], timers: false });
  t.after(() => { runtime.stop(); store.close(); });
  return { store, runtime, clock };
}

test('feed register: segmentové prefixy, najdlhší vyhráva, neznáme API je jedna skupina', () => {
  assert.equal(feedForPath('/api/gas/prices').id, 'gas');
  assert.equal(feedForPath('/api/gasx'), null);
  assert.equal(feedForPath('/api/realtime/debug-log').id, 'debug');
  assert.equal(feedForPath('/api/realtime/token').id, 'openai-voice');
  assert.equal(feedForPath('/api/opensky-track/x').id, 'opensky');
  assert.equal(routeKey('/api/whatever/random123'), 'api-other');
  assert.equal(routeKey('/assets/x.js'), null);
  assert.equal(routeKey('/s/abc'), 'share');
});

test('čisté pomocné funkcie: UA, referer, cesta, šírka, redakcia tajomstiev', () => {
  assert.deepEqual(parseUserAgent(CHROME), { bot: false, browser: 'Chrome', os: 'Windows', device: 'desktop' });
  assert.equal(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1 Mobile').device, 'mobil');
  assert.equal(parseUserAgent('Googlebot/2.1').bot, true);
  assert.equal(referrerHost('https://www.google.com/search?q=x'), 'google.com');
  assert.equal(referrerHost('https://okolive.sk/s/1', ['okolive.sk']), 'priamo');
  assert.equal(referrerHost(''), 'priamo');
  assert.equal(pagePath('/s/abc123?x=1'), '/s/*');
  assert.equal(pagePath('/<script>'), '/');
  assert.equal(screenBucket(1280), '1024–1439');
  const text = redact('GET https://x/api?key=abc123&q=1 Bearer eyJ.a.b supersecretvalue123 sk-abcdefghijklmnopqrstu', ['supersecretvalue123']);
  assert.ok(!/abc123|eyJ|supersecretvalue123|abcdefghijklmnop/.test(text), text);
  assert.ok(text.includes('q=1'));
  assert.deepEqual(secretValues({ OPENAI_API_KEY: 'sk-longvalue', PORT: '4173', TOMTOM_API_KEY: 'short' }), ['sk-longvalue']);
});

test('middleware: štatistika po feedoch, 5xx do chýb, vypnutý feed 503, status ostáva', async t => {
  const { runtime, store } = setup(t);
  const { base } = await serve(t, runtime);
  await fetch(base + '/api/tomtom/tile/1');
  await fetch(base + '/api/tomtom/tile/2');
  await fetch(base + '/api/fail-thing');
  runtime.setFeedSetting('tomtom', { enabled: false }, 'owner');
  const blocked = await fetch(base + '/api/tomtom/tile/3');
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).error, 'disabled_by_admin');
  assert.equal((await fetch(base + '/api/tomtom/status')).status, 200, 'status vypnutého feedu ide ďalej');
  assert.equal((await fetch(base + '/api/share')).status, 200, 'systémové cesty sa neblokujú');
  assert.throws(() => runtime.setFeedSetting('share', { enabled: false }), /feed_not_toggleable/);
  await new Promise(resolve => setTimeout(resolve, 20));
  runtime.flush();
  const routes = Object.fromEntries(store.trafficByRoute(0).map(row => [row.route, row]));
  assert.equal(routes.tomtom.n, 4);
  assert.equal(routes.tomtom.blocked, 1);
  assert.equal(routes['api-other'].e5, 1);
  assert.ok(store.errors('http').some(error => error.message.includes('HTTP 502')));
  assert.deepEqual(runtime.notice().disabled, ['TomTom doprava']);
  runtime.setFeedSetting('tomtom', { enabled: true }, 'owner');
  assert.equal(store.settings('feed:').length, 0, 'predvolený stav sa neukladá');
});

test('denný strop plateného zdroja: 429 nad limit, nový deň znova povolí', async t => {
  const clock = { time: Date.UTC(2026, 9, 3, 10, 0) };
  const { runtime } = setup(t, clock);
  const { base } = await serve(t, runtime);
  runtime.setFeedSetting('openai-voice', { dailyCap: 2, unitPrice: 0.05 }, 'owner');
  assert.equal((await fetch(base + '/api/realtime/token')).status, 200);
  assert.equal((await fetch(base + '/api/realtime/token')).status, 200);
  const over = await fetch(base + '/api/realtime/token');
  assert.equal(over.status, 429);
  assert.equal((await over.json()).scope, 'admin_daily_cap');
  assert.equal(runtime.capCount('openai-voice'), 2);
  clock.time += 86400_000;
  assert.equal((await fetch(base + '/api/realtime/token')).status, 200);
  runtime.flush();
  const report = costs(runtime, clock.time, 7);
  const voice = report.feeds.find(feed => feed.id === 'openai-voice');
  assert.equal(voice.dailyCap, 2);
  assert.equal(voice.total, 3, 'odmietnuté sa nepočítajú do nákladov');
  assert.equal(voice.estimate, 0.15);
});

test('strop prežije reštart: dnešné počty sa dopočítajú zo štatistiky', async t => {
  const clock = { time: Date.UTC(2026, 9, 3, 10, 0) };
  const { runtime, store } = setup(t, clock);
  const { base } = await serve(t, runtime);
  await fetch(base + '/api/google/nearby-places');
  await fetch(base + '/api/google/nearby-places');
  runtime.flush();
  const restarted = createAdminRuntime({ store, now: () => clock.time, timers: false });
  assert.equal(restarted.capCount('google-places'), 2);
});

test('návštevy: anonymné agregáty, denný hash, boti, DNT, cudzí pôvod, limit', async t => {
  const { runtime, store, clock } = setup(t);
  const { hit } = await serve(t, runtime);
  assert.equal((await hit({ t: 'view', p: '/', r: 'https://www.google.com/', w: 1280, l: 'sk-SK' }, { 'CF-IPCountry': 'SK', 'CF-Connecting-IP': '203.0.113.5' })).status, 204);
  assert.equal((await hit({ t: 'view', p: '/s/xyz', r: '', w: 390, l: 'en' }, { 'CF-Connecting-IP': '203.0.113.5' })).status, 204);
  await hit({ t: 'view', p: '/' }, { 'CF-Connecting-IP': '198.51.100.7' });
  await hit({ t: 'ping' }, { 'CF-Connecting-IP': '203.0.113.5' });
  await hit({ t: 'layer', layer: 'flights' });
  assert.equal((await hit({ t: 'layer', layer: '<bad>' })).status, 400);
  await hit({ t: 'view', p: '/' }, { 'User-Agent': 'Googlebot/2.1' });
  await hit({ t: 'view', p: '/' }, { DNT: '1' });
  assert.equal((await hit({ t: 'view' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await hit({ t: 'nope' })).status, 400);
  runtime.flush();
  const report = analytics(runtime, clock.time, 7);
  const today = report.series[report.series.length - 1];
  assert.equal(today.views, 3);
  assert.equal(today.visitors, 2, 'rovnaká IP + UA = jeden návštevník');
  assert.equal(today.minutes, 1);
  assert.equal(today.bots, 1);
  assert.equal(report.liveNow, 2);
  assert.deepEqual(report.dims.country.map(row => row.val).sort(), ['??', 'SK']);
  assert.ok(report.dims.ref.some(row => row.val === 'google.com'));
  assert.ok(report.dims.path.some(row => row.val === '/s/*'));
  assert.deepEqual(report.dims.layer, [{ val: 'flights', n: 1 }]);
  // Uložené nie sú IP ani UA.
  const dump = JSON.stringify(store.pageviewDims('2000-01-01'));
  assert.ok(!dump.includes('203.0.113.5') && !dump.includes('Chrome/140'));
  // Po polnoci: hashe zmiznú, ostane počet.
  clock.time += 86400_000;
  store.rollup(localDay(clock.time));
  const after = analytics(runtime, clock.time, 7);
  assert.equal(after.series[after.series.length - 2].visitors, 2);
  assert.equal(store.visitorsToday(localDay(clock.time - 86400_000)), 0);
  // Limit 60 požiadaviek za minútu na IP.
  let limited = 0;
  for (let i = 0; i < 65; i++) if ((await hit({ t: 'ping' }, { 'CF-Connecting-IP': '192.0.2.9' })).status === 429) limited++;
  assert.equal(limited, 5);
});

test('JS chyby z prehliadača sa zlučujú a redigujú', async t => {
  const { runtime, store } = setup(t);
  const { hit } = await serve(t, runtime);
  for (const line of [10, 11]) await hit({ t: 'error', msg: `TypeError: x is undefined at row ${line}`, src: 'https://okolive.sk/assets/a.js?v=1', line: 5, stack: 'at f (a.js:5)' });
  await hit({ t: 'error', msg: 'fetch https://x?token=abcdef failed' });
  runtime.flush();
  const errors = store.errors('client');
  assert.equal(errors.length, 2);
  assert.equal(errors.find(e => e.message.startsWith('TypeError')).count, 2);
  assert.ok(!JSON.stringify(errors).includes('abcdef'));
});

test('console.error servera ide do chýb s redakciou; stop() vráti pôvodnú konzolu', t => {
  const { runtime, store } = setup(t);
  const original = console.error;
  runtime.start();
  assert.notEqual(console.error, original);
  console.error('[test] upstream failed key=supersecretvalue123 (očakávaný výpis)');
  runtime.flush();
  assert.ok(store.errors('server')[0].message.includes('key=***'));
  runtime.stop();
  assert.equal(console.error, original);
});

test('oznam: platnosť, verejný tvar, validácia', t => {
  const { runtime, clock } = setup(t);
  assert.equal(runtime.notice().notice, null);
  runtime.setNotice({ text: 'Údržba o 20:00', level: 'warn', until: clock.time + 3600_000 }, 'owner');
  const shown = runtime.notice();
  assert.equal(shown.notice.text, 'Údržba o 20:00');
  assert.match(shown.notice.id, /^[0-9a-f]{12}$/);
  clock.time += 2 * 3600_000;
  assert.equal(runtime.notice().notice, null, 'po platnosti zmizne');
  assert.equal(validateNotice({ text: 'x'.repeat(281) }), 'invalid_notice');
  assert.equal(validateNotice({ text: 'ok', level: 'alarm' }), 'invalid_notice');
  assert.equal(validateNotice({ text: 'ok', hours: 0 }), 'invalid_notice');
  assert.equal(validateNotice({ text: '' }), null);
  assert.equal(validateNotice({ text: 'ok', extra: 1 }), 'invalid_input');
});

test('validácia nastavení feedu', () => {
  assert.equal(validateFeedUpdate('nope', {}), 'feed_not_found');
  assert.equal(validateFeedUpdate('share', { enabled: false }), 'feed_not_found');
  assert.equal(validateFeedUpdate('tomtom', { dailyCap: 5 }), 'invalid_input', 'strop len pre platené');
  assert.equal(validateFeedUpdate('openai-voice', { dailyCap: 1.5 }), 'invalid_input');
  assert.equal(validateFeedUpdate('openai-voice', { dailyCap: -1 }), 'invalid_input');
  assert.equal(validateFeedUpdate('openai-voice', { enabled: 'no' }), 'invalid_input');
  assert.equal(validateFeedUpdate('openai-voice', { dailyCap: 100, unitPrice: 0.02, enabled: true }), null);
  assert.equal(validateFeedUpdate('openai-voice', { dailyCap: null }), null);
});

test('história feedov: výpadky zo vzoriek, hodinové chyby; prevádzka po hodinách', async t => {
  const clock = { time: Date.UTC(2026, 9, 3, 10, 0) };
  let status = 200;
  const store = openAdminStore(':memory:');
  const runtime = createAdminRuntime({ store, now: () => clock.time, port: () => 1, timers: false,
    fetchStatus: async () => ({ status, ms: 5 }) });
  t.after(() => { runtime.stop(); store.close(); });
  for (const next of [200, 500, 500, 200, 0]) { status = next; await runtime.sampleFeeds(); clock.time += 600_000; }
  runtime.flush();
  const history = feedHistory(runtime, clock.time, 24);
  assert.equal(history.tomtom.samples, 5);
  assert.equal(history.tomtom.outages.length, 2);
  assert.equal(history.tomtom.outages[1].ongoing, true);
  assert.equal(history.firms.samples, 0, 'FIRMS sa nevzorkuje (volá upstream)');
  const report = traffic(runtime, clock.time, 3);
  assert.equal(report.series.length, 3);
  assert.equal(dayRange(clock.time, 7).length, 7);
});

test('dimenzia návštev má strop rôznych hodnôt za deň (vymyslené referery nenafúknu DB)', async t => {
  const { runtime, store } = setup(t);
  const { hit } = await serve(t, runtime);
  for (let i = 0; i < 305; i++) {
    await hit({ t: 'view', p: '/', r: `https://spam${i}.example/` }, { 'CF-Connecting-IP': `198.51.100.${i % 200}`, 'X-Forwarded-For': String(i) });
  }
  runtime.flush();
  const refs = store.pageviewDims('2000-01-01').filter(row => row.dim === 'ref');
  assert.equal(refs.length, 301);
  assert.equal(refs.find(row => row.val === 'iné').n, 5);
});
