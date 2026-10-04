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

test('naživo: poloha z Cloudflare (mesto na 0,1°), inak hlavné mesto krajiny; IP pre vlastníka, vypadnutie po 2,5 min', async t => {
  const { runtime, clock } = setup(t);
  const { hit } = await serve(t, runtime);
  await hit({ t: 'view', p: '/?front=front', r: 'https://www.google.com/' }, { 'CF-Connecting-IP': '203.0.113.5', 'CF-IPCountry': 'SK',
    'CF-IPCity': 'Ko%C5%A1ice', 'CF-IPLatitude': '48.71634', 'CF-IPLongitude': '21.26111' });
  await hit({ t: 'view', p: '/en/' }, { 'CF-Connecting-IP': '198.51.100.7', 'CF-IPCountry': 'CZ', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari/604.1' });
  await hit({ t: 'view', p: '/' }, { 'CF-Connecting-IP': '192.0.2.44', 'CF-IPCountry': 'XX' });
  const snap = runtime.liveSnapshot();
  assert.equal(snap.liveNow, 3);
  const kosice = snap.visitors.find(v => v.country === 'SK');
  assert.deepEqual([kosice.city, kosice.lat, kosice.lon, kosice.precision, kosice.path], ['Košice', 48.7, 21.3, 'city', '/']);
  const prague = snap.visitors.find(v => v.country === 'CZ');
  assert.equal(prague.precision, 'country');
  assert.ok(Math.abs(prague.lat - 50.08) < 0.2 && Math.abs(prague.lon - 14.43) < 0.2, 'záložný bod = Praha');
  assert.equal(prague.device, 'mobil');
  const unknown = snap.visitors.find(v => v.country === '??');
  assert.equal(unknown.lat, null);
  assert.equal(snap.cityPrecision, true);
  assert.equal(snap.recent[2].ref, 'google.com');
  assert.equal(kosice.ip, '203.0.113.5');
  assert.ok(!JSON.stringify(snap).includes('iPhone'), 'celý User-Agent nejde do snímky');
  // Ping drží návštevníka naživo, ticho ho po 2,5 min vyradí.
  clock.time += 120_000;
  await hit({ t: 'ping' }, { 'CF-Connecting-IP': '203.0.113.5', 'CF-IPCountry': 'SK' });
  clock.time += 60_000;
  const later = runtime.liveSnapshot();
  assert.equal(later.liveNow, 1);
  assert.equal(later.visitors[0].city, 'Košice', 'ping nezmaže polohu zo zobrazenia');
  assert.equal(later.visitors[0].activeS, 180);
  runtime.sampleLive();
  assert.deepEqual(runtime.liveSnapshot().history.map(h => h.n), [1, 1]);
});

test('záznam návštev: IP, poloha, čas na stránke z pingu, hľadanie, DNT nič, mazanie po 30 dňoch', async t => {
  const { runtime, store, clock } = setup(t);
  const { hit } = await serve(t, runtime);
  await hit({ t: 'view', p: '/?front=front', r: 'https://www.google.com/', w: 1280, l: 'sk-SK' }, { 'CF-Connecting-IP': '203.0.113.5', 'CF-IPCountry': 'SK',
    'CF-IPCity': 'Ko%C5%A1ice', 'CF-IPLatitude': '48.71634', 'CF-IPLongitude': '21.26111' });
  await hit({ t: 'view', p: '/en/' }, { 'CF-Connecting-IP': '198.51.100.7', 'CF-IPCountry': 'CZ' });
  await hit({ t: 'view', p: '/' }, { 'CF-Connecting-IP': '192.0.2.1', DNT: '1' });
  runtime.flush();
  clock.time += 90_000;
  await hit({ t: 'ping' }, { 'CF-Connecting-IP': '203.0.113.5' });
  runtime.flush();
  const all = store.visitLog({ from: 0 });
  assert.equal(all.total, 2, 'DNT sa nezapíše');
  assert.equal(all.ips, 2);
  const kosice = all.rows.find(row => row.ip === '203.0.113.5');
  assert.deepEqual([kosice.city, kosice.country, kosice.path, kosice.ref, kosice.browser, kosice.lang, kosice.lat], ['Košice', 'SK', '/', 'google.com', 'Chrome', 'sk', 48.7]);
  assert.equal(kosice.lastAt - kosice.at, 90_000, 'ping posunie koniec návštevy, nevytvorí nový riadok');
  assert.ok(kosice.ua.includes('Chrome/140'));
  assert.equal(store.visitLog({ from: 0, q: 'Košice' }).total, 1);
  assert.equal(store.visitLog({ from: 0, q: '198.51' }).rows[0].country, 'CZ');
  assert.equal(store.visitLog({ from: 0, q: '%' }).total, 0, 'zástupné znaky LIKE sa hľadajú doslovne');
  store.prune(clock.time + 31 * 86400_000);
  assert.equal(store.visitLog({ from: 0 }).total, 0, 'po 30 dňoch zmizne');
});

test('mesto z Cloudflare: UTF-8 bajty v hlavičke (Node ich číta ako Latin-1) aj percent-kódovanie dajú diakritiku', async () => {
  const { geoFromRequest } = await import('./liveGeo.js');
  const raw = Buffer.from('Iža', 'utf8').toString('latin1');
  assert.equal(geoFromRequest({ headers: { 'cf-ipcountry': 'SK', 'cf-ipcity': raw } }).city, 'Iža');
  assert.equal(geoFromRequest({ headers: { 'cf-ipcountry': 'SK', 'cf-ipcity': 'Ko%C5%A1ice' } }).city, 'Košice');
  assert.equal(geoFromRequest({ headers: { 'cf-ipcountry': 'DE', 'cf-ipcity': 'München' } }).city, 'München', 'skutočný Latin-1 text ostane');
});

test('vylúčená IP vlastníka: nezapíše sa do záznamu, štatistiky ani mapy; staré záznamy sa zmažú', async t => {
  const { runtime, store, clock } = setup(t);
  const { hit } = await serve(t, runtime);
  const owner = { 'CF-Connecting-IP': '95.102.1.2', 'CF-IPCountry': 'SK' };
  await hit({ t: 'view', p: '/' }, owner);
  await hit({ t: 'view', p: '/en/' }, { 'CF-Connecting-IP': '198.51.100.7', 'CF-IPCountry': 'CZ' });
  runtime.flush();
  assert.equal(store.visitLog({ from: 0 }).total, 2);
  assert.equal(runtime.setIgnoredIps(['95.102.1.2', '::ffff:95.102.1.2', 'nie-ip'], 'owner'), 1, 'zmaže jeho starú návštevu');
  assert.deepEqual(runtime.ignoredIps(), ['95.102.1.2']);
  assert.equal(runtime.liveSnapshot().liveNow, 1, 'zmizne aj z mapy');
  assert.ok(runtime.liveSnapshot().recent.every(view => view.ip !== '95.102.1.2'));
  assert.equal((await hit({ t: 'view', p: '/' }, owner)).status, 204);
  await hit({ t: 'ping' }, owner);
  runtime.flush();
  const log = store.visitLog({ from: 0 });
  assert.deepEqual(log.rows.map(row => row.ip), ['198.51.100.7']);
  const today = analytics(runtime, clock.time, 1).series.at(-1);
  assert.equal(today.views, 2, 'nové zobrazenie vlastníka sa nezapočíta (2 = pred vylúčením)');
  assert.equal(today.minutes, 0);
  // Po zrušení sa znova zapisuje.
  runtime.setIgnoredIps([], 'owner');
  await hit({ t: 'view', p: '/' }, owner);
  runtime.flush();
  assert.equal(store.visitLog({ from: 0 }).total, 2);
});
