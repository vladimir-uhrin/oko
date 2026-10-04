import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openAdminStore } from '../store.js';
import { createStudio, publicUrlFrom, AUTO_PUBLISH_MIN_UNCHANGED } from './index.js';
import { describeLocation, direction, earthquakeDigest, earthquakeEvent, launchEvent, plural, quakeThreshold, when } from './templates.js';
import { cardSvg, escapeXml, wrap } from './card.js';
import { createMetaPublisher, metaConfig } from './meta.js';

const NOW = Date.UTC(2026, 9, 3, 12, 0); // 14:00 v Bratislave
const URL_OKO = 'https://okolive.sk';
const quake = (over = {}) => ({ id: 'us1', sourceId: 'us1', mag: 6.3, time: NOW - 40 * 60e3, lat: 37.6, lon: 23.1, depth: 12, place: 'Greece', ...over });

test('slovenčina: plurál, čas, svetová strana, poloha k mestu', () => {
  assert.deepEqual([1, 2, 4, 5, 0].map(n => plural(n, 'zemetrasenie', 'zemetrasenia', 'zemetrasení')),
    ['zemetrasenie', 'zemetrasenia', 'zemetrasenia', 'zemetrasení', 'zemetrasení']);
  assert.equal(when(NOW - 3600e3, NOW), 'dnes o 13:00');
  assert.equal(when(NOW - 20 * 3600e3, NOW), 'včera o 18:00');
  assert.equal(direction({ lat: 48, lon: 17 }, { lat: 49, lon: 17 }), 'S');
  assert.equal(direction({ lat: 48, lon: 17 }, { lat: 47, lon: 16 }), 'JZ');
  const loc = describeLocation({ lat: 48.2, lon: 17.2 });
  assert.match(loc.text, /Bratislava/);
  assert.equal(loc.country, 'Slovensko');
  assert.equal(describeLocation({ lat: -50, lon: -140 }), null, 'stred oceánu');
});

test('prah zemetrasenia: Slovensko a okolie nižšie ako svet', () => {
  assert.equal(quakeThreshold({ lat: 48.5, lon: 19 }), 2.5);
  assert.equal(quakeThreshold({ lat: 45.8, lon: 16 }), 4); // Záhreb ~450 km
  assert.equal(quakeThreshold({ lat: 35, lon: 140 }), 6);
  assert.equal(earthquakeEvent({ records: [quake({ mag: 5.5, lat: 35, lon: 140 })] }, { now: NOW, url: URL_OKO }), null);
  assert.ok(earthquakeEvent({ records: [quake({ mag: 3, lat: 48.1, lon: 17.4 })] }, { now: NOW, url: URL_OKO }));
  assert.equal(earthquakeEvent({ records: [quake({ time: NOW - 7 * 3600e3 })] }, { now: NOW, url: URL_OKO }), null, 'staršie ako 6 h');
});

test('šablóna zemetrasenia: fakty, zdroj, čas stavu, odkaz, stabilný kľúč', () => {
  const item = earthquakeEvent({ records: [quake(), quake({ id: 'us2', sourceId: 'us2', mag: 6.0 })], fetchedAt: NOW - 5 * 60e3 }, { now: NOW, url: URL_OKO });
  assert.equal(item.key, 'quake:us1', 'najsilnejšie');
  assert.match(item.title, /^Zemetrasenie M 6,3 – Grécko$/);
  assert.match(item.text, /dnes o 13:20/i);
  assert.match(item.text, /Zdroj: USGS · stav k 13:55/);
  assert.match(item.text, /https:\/\/okolive\.sk/);
  assert.match(item.text, /#zemetrasenie #Grécko #OKO/);
  assert.ok(!/undefined|null|NaN/.test(item.text));
});

test('prehľad a štart rakety', () => {
  const digest = earthquakeDigest({ records: [quake(), quake({ id: 'b', mag: 3 }), quake({ id: 'c', mag: 4.6, lat: 35, lon: 140 })] }, { now: NOW, url: URL_OKO });
  assert.equal(digest.key, 'quake-digest:2026-10-03');
  assert.match(digest.text, /3 zemetrasenia, z toho 2 s magnitúdou 4,5/);
  assert.equal(earthquakeDigest({ records: [] }, { now: NOW, url: URL_OKO }), null);
  const launch = launchEvent({ results: [
    { id: 'old', net: new Date(NOW - 20 * 3600e3).toISOString(), status: { abbrev: 'Success' } },
    { id: 'tbd', net: new Date(NOW - 3600e3).toISOString(), status: { abbrev: 'TBD' } },
    { id: 'ok', net: new Date(NOW - 2 * 3600e3).toISOString(), status: { abbrev: 'Success' }, rocket: { configuration: { full_name: 'Falcon 9' } },
      launch_service_provider: { name: 'SpaceX' }, mission: { name: 'Starlink', orbit: { abbrev: 'LEO' } } },
  ] }, { now: NOW, url: URL_OKO });
  assert.equal(launch.key, 'launch:ok');
  assert.match(launch.text, /odštartovala raketa Falcon 9 \(SpaceX\) s misiou Starlink na nízku obežnú dráhu\. Štart bol úspešný\./);
});

test('karta: escapovanie, zalomenie, mapa s bodom', () => {
  assert.equal(escapeXml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.deepEqual(wrap('jeden dva tri štyri päť', 9, 2), ['jeden dva', 'tri…']);
  const svg = cardSvg({ kicker: 'X', big: 'M 6,3', headline: '<script>', lines: ['a & b'], point: { lat: 37, lon: 23 }, source: 'USGS', at: NOW });
  assert.ok(!svg.includes('<script>'));
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /<circle cx="540" cy="840"/, 'bod v strede mapy');
});

test('verejná URL a konfigurácia Meta z .env', () => {
  assert.equal(publicUrlFrom({ AUTH_ORIGINS: 'http://localhost:4173,https://okolive.sk' }), 'https://okolive.sk');
  assert.equal(publicUrlFrom({ STUDIO_PUBLIC_URL: 'https://x.sk/' }), 'https://x.sk');
  assert.deepEqual(metaConfig({}), { version: 'v23.0', pageId: null, igUserId: null, token: null, facebook: false, instagram: false });
  const c = metaConfig({ META_PAGE_ID: '123456', META_PAGE_TOKEN: 'x'.repeat(40), META_IG_USER_ID: 'bad' });
  assert.equal(c.facebook, true);
  assert.equal(c.instagram, false);
});

function fakeFeeds(data) {
  return async (port, path) => {
    const body = data[path];
    if (body === 'disabled') return { status: 503, headers: {}, body: { error: 'disabled_by_admin' } };
    if (body === 'stale') return { status: 200, headers: { 'x-gev-cache': 'STALE' }, body: { results: [] } };
    return body ? { status: 200, headers: {}, body } : { status: 502, headers: {}, body: null };
  };
}
function fakePublisher(calls, { facebook = true, instagram = true, fail = null } = {}) {
  return {
    status: () => ({ facebook, instagram, version: 'v23.0' }),
    async facebookPhoto({ image, text }) { calls.push(['facebook', image.length, text]); if (fail === 'facebook') throw new Error('Graph down'); return { id: '1_2', url: 'https://www.facebook.com/1_2' }; },
    async instagramImage({ imageUrl, text }) { calls.push(['instagram', imageUrl, text]); return { id: '9', url: 'https://instagram.com/p/x' }; },
    instagramLimit: async () => ({ used: 1, total: 100 }),
  };
}

function setup(t, { feeds, publisher, clock = { time: NOW } } = {}) {
  const store = openAdminStore(':memory:');
  t.after(() => store.close());
  const studio = createStudio({ store, env: { AUTH_ORIGINS: 'https://okolive.sk' }, port: () => 1, now: () => clock.time, timers: false,
    fetchJson: fakeFeeds(feeds || { '/api/earthquakes/usgs': { records: [quake()], fetchedAt: NOW - 60e3 } }),
    renderCard: async card => Buffer.from(`jpeg:${card.kind}`), publisher: publisher || fakePublisher([]), log: () => {} });
  return { store, studio, clock };
}

test('generovanie: návrh s obrázkom, žiadne duplikáty, zastarané a vypnuté zdroje', async t => {
  const { studio } = setup(t);
  const first = await studio.generate('quake');
  assert.equal(first.created, true);
  assert.equal(first.draft.status, 'draft');
  assert.equal(first.draft.origin, 'manual');
  assert.equal(Buffer.from(studio.image(first.draft.id)).toString(), 'jpeg:quake');
  assert.deepEqual(await studio.generate('quake'), { created: false, reason: 'exists', key: 'quake:us1' });
  const { studio: stale } = setup(t, { feeds: { '/api/earthquakes/usgs': { records: [quake()], fetchedAt: NOW - 3600e3 }, '/api/launches': 'stale' } });
  assert.equal((await stale.generate('quake')).reason, 'stale');
  assert.equal((await stale.generate('launch')).reason, 'stale');
  const { studio: off } = setup(t, { feeds: { '/api/earthquakes/usgs': 'disabled' } });
  assert.equal((await off.generate('quake')).reason, 'feed_disabled');
  await assert.rejects(studio.generate('nope'), /template_not_found/);
});

test('úprava, schválenie, zahodenie, ručné zdieľanie', async t => {
  const { studio } = setup(t);
  const { draft } = await studio.generate('quake');
  assert.equal(studio.edit(draft.id, 'Nový text').edited, true);
  assert.throws(() => studio.edit(draft.id, '   '), /invalid_text/);
  assert.throws(() => studio.edit(draft.id, 'x'.repeat(2201)), /invalid_text/);
  assert.equal(studio.setStatus(draft.id, 'approved').status, 'approved');
  assert.equal(studio.setStatus(draft.id, 'discarded').status, 'discarded');
  assert.equal(studio.setStatus(draft.id, 'draft').status, 'draft');
  const shared = studio.markShared(draft.id);
  assert.equal(shared.status, 'published');
  assert.ok(shared.results.manual.at);
  assert.throws(() => studio.edit(draft.id, 'neskoro'), /draft_not_editable/);
});

test('zverejnenie: FB + IG, podpísaná URL obrázka, čiastočné zlyhanie a opakovanie bez duplikátu', async t => {
  const calls = [];
  const publisher = fakePublisher(calls, { fail: 'facebook' });
  const { studio } = setup(t, { publisher });
  const { draft } = await studio.generate('quake');
  const started = await studio.publish(draft.id, ['facebook', 'instagram']);
  assert.equal(started.draft.results.facebook.pending, true, 'odpoveď hneď, zverejnenie na pozadí');
  await assert.rejects(studio.publish(draft.id, ['facebook']), /publish_in_progress/);
  const failed = await started.done;
  assert.equal(failed.draft.status, 'failed');
  assert.match(failed.draft.results.facebook.error, /Graph down/);
  assert.equal(failed.draft.results.instagram.id, '9');
  const igUrl = new URL(calls.find(c => c[0] === 'instagram')[1]);
  assert.equal(igUrl.origin, 'https://okolive.sk');
  assert.match(igUrl.pathname, new RegExp(`/api/studio/media/${draft.id}\\.jpg`));
  publisher.facebookPhoto = async ({ image }) => { calls.push(['facebook-retry', image.length]); return { id: '1_3', url: 'u' }; };
  const ok = await (await studio.publish(draft.id, ['facebook', 'instagram'])).done;
  assert.equal(ok.draft.status, 'published');
  assert.equal(calls.filter(c => c[0] === 'instagram').length, 1, 'Instagram sa nezverejní druhýkrát');
  await assert.rejects(studio.publish(draft.id, ['facebook']), /nothing_to_publish/);
  const { studio: noMeta } = setup(t, { publisher: fakePublisher([], { facebook: false, instagram: false }) });
  const second = await noMeta.generate('quake');
  await assert.rejects(noMeta.publish(second.draft.id, ['facebook']), /meta_not_configured/);
});

test('podpísaný obrázok: len platný podpis, len schválený návrh, expirácia', async t => {
  const { studio, clock } = setup(t);
  const { draft } = await studio.generate('quake');
  const server = http.createServer((req, res) => studio.handleMedia(req, res, () => { res.statusCode = 418; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const local = url => `http://127.0.0.1:${server.address().port}${new URL(url).pathname}${new URL(url).search}`;
  const signed = studio.mediaUrl(draft.id);
  assert.equal((await fetch(local(signed))).status, 404, 'návrh ešte nie je schválený');
  studio.setStatus(draft.id, 'approved');
  const okResponse = await fetch(local(signed));
  assert.equal(okResponse.status, 200);
  assert.equal(okResponse.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(local(signed.replace(/sig=[^&]+/, 'sig=AAAA')))).status, 404);
  assert.equal((await fetch(local(signed.replace(/exp=\d+/, `exp=${clock.time + 99 * 3600e3}`)))).status, 404, 'príliš dlhá platnosť');
  clock.time += 3 * 3600e3;
  assert.equal((await fetch(local(signed))).status, 404, 'expirovaný');
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/studio/other`)).status, 418);
});

test('automatika: auto-návrhy, denný prehľad až od 8:00, auto-zverejnenie až po 10 bez úpravy', async t => {
  const calls = [];
  const clock = { time: Date.UTC(2026, 9, 3, 4, 0) }; // 6:00 v Bratislave
  const feeds = { '/api/earthquakes/usgs': { records: [quake({ time: clock.time - 60e3 })], fetchedAt: clock.time }, '/api/launches': { results: [] } };
  const { studio, store } = setup(t, { feeds, publisher: fakePublisher(calls), clock });
  const early = await studio.tick();
  assert.deepEqual(early.results.map(r => [r.template, r.created || r.reason]), [['quake', true], ['launch', 'nothing_to_post']]);
  assert.equal(studio.list().find(d => d.template === 'quake').origin, 'auto');
  clock.time += 3 * 3600e3; // 9:00
  feeds['/api/earthquakes/usgs'].fetchedAt = clock.time;
  const later = await studio.tick();
  assert.ok(later.results.some(r => r.template === 'quake-digest' && r.created));
  assert.equal(calls.length, 0, 'nič sa nezverejní samo');
  assert.throws(() => studio.setSettings({ autoPublish: { quake: true } }), /auto_publish_not_earned/);
  // 10 automatických návrhov zverejnených bez úpravy → odomknuté
  for (let i = 0; i < AUTO_PUBLISH_MIN_UNCHANGED; i++) {
    store.studioInsert({ id: `00000000-0000-0000-0000-00000000000${i}`.slice(-36), template: 'quake', eventKey: `quake:x${i}`, origin: 'auto',
      title: 't', text: 'x', card: {}, image: Buffer.from('j'), createdAt: clock.time });
    store.studioUpdate(`00000000-0000-0000-0000-00000000000${i}`.slice(-36), { status: 'published', publishedAt: clock.time - 2 * 86400_000 }, clock.time);
  }
  assert.equal(studio.setSettings({ autoPublish: { quake: true } }).autoPublish.quake, true);
  feeds['/api/earthquakes/usgs'] = { records: [quake({ id: 'new', sourceId: 'new', time: clock.time - 60e3 })], fetchedAt: clock.time };
  await studio.tick();
  assert.deepEqual(calls.map(c => c[0]), ['facebook', 'instagram']);
  // tichý čas: 23:00
  clock.time = Date.UTC(2026, 9, 3, 21, 0);
  feeds['/api/earthquakes/usgs'] = { records: [quake({ id: 'night', sourceId: 'night', time: clock.time - 60e3 })], fetchedAt: clock.time };
  await studio.tick();
  assert.equal(calls.length, 2, 'v noci nič');
  assert.equal(studio.list().find(d => d.eventKey === 'quake:night').status, 'draft');
  studio.setSettings({ autoDraft: false });
  assert.deepEqual(await studio.tick(), { skipped: 'auto_draft_off' });
  assert.throws(() => studio.setSettings({ autoPublishPerDay: 99 }), /invalid_input/);
});

test('Meta publisher: správne volania Graph API, token nikdy v chybe', async t => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), method: init.method, body: init.body });
    const u = new URL(url);
    if (u.pathname.includes('/999999/')) return new Response(JSON.stringify({ error: { message: 'bad access_token=SECRET123', code: 190 } }), { status: 400 });
    if (u.pathname.endsWith('/photos')) return new Response(JSON.stringify({ id: '55', post_id: '1_55' }));
    if (u.pathname.endsWith('/media')) return new Response(JSON.stringify({ id: 'c1' }));
    if (u.pathname.endsWith('/c1')) return new Response(JSON.stringify({ status_code: 'FINISHED' }));
    if (u.pathname.endsWith('/media_publish')) return new Response(JSON.stringify({ id: 'm1' }));
    if (u.pathname.endsWith('/m1')) return new Response(JSON.stringify({ permalink: 'https://www.instagram.com/p/abc/' }));
    return new Response(JSON.stringify({ error: { message: 'bad access_token=SECRET123', code: 190 } }), { status: 400 });
  };
  const env = { META_PAGE_ID: '111111', META_PAGE_TOKEN: 'TOKEN'.repeat(10), META_IG_USER_ID: '222222' };
  const meta = createMetaPublisher({ env, fetchImpl });
  const fb = await meta.facebookPhoto({ image: Buffer.from('jpg'), text: 'Ahoj' });
  assert.deepEqual(fb, { id: '1_55', url: 'https://www.facebook.com/1_55' });
  assert.match(requests[0].url, /graph\.facebook\.com\/v23\.0\/111111\/photos$/);
  assert.ok(requests[0].body instanceof FormData);
  assert.equal(requests[0].body.get('message'), 'Ahoj');
  const ig = await meta.instagramImage({ imageUrl: 'https://okolive.sk/api/studio/media/x.jpg?exp=1&sig=s', text: 'Ahoj IG' });
  assert.deepEqual(ig, { id: 'm1', url: 'https://www.instagram.com/p/abc/' });
  assert.equal(new URLSearchParams(requests[1].body).get('image_url'), 'https://okolive.sk/api/studio/media/x.jpg?exp=1&sig=s');
  const broken = createMetaPublisher({ env: { ...env, META_PAGE_ID: '999999' }, fetchImpl });
  await assert.rejects(broken.facebookPhoto({ image: Buffer.from('j'), text: 't' }), error => !error.message.includes('SECRET123') && /access_token=\*\*\*/.test(error.message));
  await assert.rejects(createMetaPublisher({ env: {} }).facebookPhoto({ image: Buffer.from('j'), text: 't' }), /nie je nastavený/);
});

// ── Fáza 3: plánovanie, kalendár, štatistiky ──
test('plánovanie: zverejní sa v ticku po čase, ručné zverejnenie plán zruší, validácia', async t => {
  const calls = [];
  const clock = { time: Date.UTC(2026, 9, 3, 10, 0) };
  const feeds = { '/api/earthquakes/usgs': { records: [quake({ time: clock.time - 60e3 })], fetchedAt: clock.time }, '/api/launches': { results: [] } };
  const { studio, store } = setup(t, { feeds, publisher: fakePublisher(calls), clock });
  const { draft } = await studio.generate('quake');
  assert.throws(() => studio.schedule(draft.id, clock.time + 40 * 86400_000, ['facebook']), /invalid_schedule/);
  assert.throws(() => studio.schedule(draft.id, clock.time + 3600e3, []), /no_target/);
  assert.throws(() => studio.schedule(draft.id, clock.time + 3600e3, ['tiktok']), /no_target/);
  const planned = studio.schedule(draft.id, clock.time + 3600e3, ['facebook', 'instagram']);
  assert.equal(planned.status, 'approved');
  assert.equal(planned.scheduledAt, clock.time + 3600e3);
  assert.deepEqual(planned.scheduledTargets, ['facebook', 'instagram']);
  assert.deepEqual(studio.calendar().map(i => [i.kind, i.targets]), [['scheduled', ['facebook', 'instagram']]]);
  await studio.tick();
  assert.equal(calls.length, 0, 'ešte nie je čas');
  clock.time += 3600e3 + 1;
  feeds['/api/earthquakes/usgs'].fetchedAt = clock.time;
  await studio.tick();
  assert.deepEqual(calls.map(c => c[0]), ['facebook', 'instagram']);
  const done = studio.get(draft.id);
  assert.equal(done.status, 'published');
  assert.equal(done.scheduledAt, null);
  assert.equal(studio.calendar()[0].kind, 'published');
  // zrušenie plánu a plán, ktorý ručné zverejnenie zruší
  const other = `00000000-0000-4000-8000-${String(clock.time).slice(-12).padStart(12, '0')}`;
  store.studioInsert({ id: other, template: 'quake', eventKey: `quake:manual-${clock.time}`, origin: 'manual', title: 'Ručný', text: 'text', card: {}, image: Buffer.from('j'), createdAt: clock.time });
  studio.schedule(other, clock.time + 7200e3, ['facebook']);
  assert.equal(studio.schedule(other, null).scheduledAt, null);
  studio.schedule(other, clock.time + 7200e3, ['facebook']);
  await (await studio.publish(other, ['facebook'])).done;
  assert.equal(studio.get(other).scheduledAt, null, 'ručné zverejnenie plán zruší');
});

test('štatistiky: načítajú sa raz za 6 h pre zverejnené, zoznam výkonu s odkazmi', async t => {
  const calls = [];
  const clock = { time: NOW };
  const publisher = { ...fakePublisher(calls), insights: async (target, id) => { calls.push(['insights', target, id]); return { views: 120, reach: 100, likes: 7, comments: 1, shares: 2, saved: null }; } };
  const { studio } = setup(t, { publisher, clock });
  const { draft } = await studio.generate('quake');
  await (await studio.publish(draft.id, ['facebook', 'instagram'])).done;
  assert.deepEqual(await studio.refreshInsights(), { fetched: 2, failed: 0 });
  assert.deepEqual(await studio.refreshInsights(), { skipped: 'fresh' });
  clock.time += 7 * 3600e3;
  assert.equal((await studio.refreshInsights()).fetched, 2);
  const posts = studio.insights();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].targets.facebook.reach, 100);
  assert.equal(posts[0].targets.facebook.url, 'https://www.facebook.com/1_2');
  assert.equal(posts[0].targets.instagram.likes, 7);
  assert.equal(calls.filter(c => c[0] === 'insights').length, 4);
});

test('Meta insights: FB reactions/komentáre/zdieľania + reach, IG views/reach/saved', async () => {
  const env = { META_PAGE_ID: '111111', META_PAGE_TOKEN: 'T'.repeat(40), META_IG_USER_ID: '222222' };
  const fetchImpl = async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/1_55')) return Response.json({ reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 4 } });
    if (u.pathname.endsWith('/1_55/insights')) return Response.json({ data: [{ name: 'post_impressions_unique', values: [{ value: 250 }] }] });
    if (u.pathname.endsWith('/m1')) return Response.json({ like_count: 9, comments_count: 2 });
    if (u.pathname.endsWith('/m1/insights')) return Response.json({ data: [{ name: 'views', values: [{ value: 900 }] }, { name: 'reach', values: [{ value: 700 }] }, { name: 'saved', values: [{ value: 5 }] }, { name: 'shares', values: [{ value: 6 }] }] });
    return Response.json({ error: { message: 'nope' } }, { status: 400 });
  };
  const meta = createMetaPublisher({ env, fetchImpl });
  assert.deepEqual(await meta.insights('facebook', '1_55'), { views: null, reach: 250, likes: 12, comments: 3, shares: 4, saved: null });
  assert.deepEqual(await meta.insights('instagram', 'm1'), { views: 900, reach: 700, likes: 9, comments: 2, shares: 6, saved: 5 });
});

test('Týždeň na fronte: ručný beh dá video a text do Štúdia; automatika v sobotu o 7:00 len raz za deň; nastavenia', async t => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-fw-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { time: Date.UTC(2026, 9, 3, 5, 30) }; // sobota 3. 10. 2026, 7:30 v Bratislave
  const runs = [];
  const store = openAdminStore(':memory:');
  t.after(() => store.close());
  const studio = createStudio({ store, env: {}, port: () => 1, now: () => clock.time, timers: false, mediaDir: dir, log: () => {},
    fetchJson: async () => ({ status: 200, headers: {}, body: { records: [], results: [] } }),
    renderCard: async () => Buffer.from('card'), checkFfmpeg: async () => true,
    padToReel: async (input, output) => { writeFileSync(output, Buffer.alloc(10)); return {}; },
    posterFrame: async () => Buffer.from('poster'),
    frontWeekRunner: async ({ outDir, day }) => {
      runs.push(day);
      const { mkdirSync } = await import('node:fs');
      mkdirSync(outDir, { recursive: true });
      const video = path.join(outDir, 'tyzden-na-fronte-2026-10-02-titulky.mp4'); const post = path.join(outDir, 'tyzden-na-fronte-2026-10-02.txt');
      writeFileSync(video, Buffer.alloc(500)); writeFileSync(post, 'Text týždňa\nMapa frontu: https://okolive.sk/?front=front');
      return { video, post, srt: null };
    },
    publisher: { status: () => ({ facebook: false, instagram: false }) } });
  assert.equal(studio.frontWeekStatus().due, false, 'automatika vypnutá');
  const manual = await studio.runFrontWeek({ day: '2026-10-02' });
  assert.equal(manual.created, true);
  assert.equal(manual.draft.template, 'front-week');
  assert.equal(manual.draft.eventKey, 'front-week:2026-10-02');
  assert.match(manual.draft.text, /Mapa frontu/);
  assert.equal(Buffer.from(studio.image(manual.draft.id)).toString(), 'poster', 'obrázok = snímka z videa');
  await studio.videosIdle();
  assert.equal(studio.get(manual.draft.id).videoStatus, 'ready', 'reel doplnením 4:5 → 9:16');
  assert.deepEqual(runs, ['2026-10-02']);
  // automatika
  studio.setSettings({ frontWeek: { enabled: true } });
  assert.throws(() => studio.setSettings({ frontWeek: { hour: 25 } }), /invalid_input/);
  assert.equal(studio.frontWeekStatus().due, false, 'dnes už bežal');
  clock.time += 7 * 86400_000; // ďalšia sobota 7:30
  assert.equal(studio.frontWeekStatus().due, true);
  await studio.tick();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(runs.length, 2);
  assert.equal(studio.frontWeekStatus().due, false, 'raz za deň');
  clock.time += 86400_000; // nedeľa
  assert.equal(studio.frontWeekStatus().due, false);
});

// ── 2026-10-04: karusel, opakovanie, kontroly limitov, najlepší čas ─────────────
test('karusel: import so snímkami → FB attached_media aj IG CAROUSEL, podpísané URL každej snímky', async t => {
  const calls = [];
  const publisher = {
    status: () => ({ facebook: true, instagram: true, version: 'v23.0' }),
    async facebookCarousel({ images, text }) { calls.push(['fb', images.map(b => Buffer.from(b).toString()), text]); return { id: 'p_1', url: 'https://www.facebook.com/p_1', slides: images.length }; },
    async instagramCarousel({ imageUrls }) { calls.push(['ig', imageUrls]); return { id: 'ig1', url: 'https://instagram.com/p/c', slides: imageUrls.length }; },
    async facebookPhoto() { throw new Error('nemalo sa volať'); }, async instagramImage() { throw new Error('nemalo sa volať'); },
    instagramLimit: async () => null,
  };
  const { studio } = setup(t, { publisher });
  const { draft } = await studio.importDraft({ template: 'event', eventKey: 'event:x', title: 'Udalosť', text: 'Text #OKO https://okolive.sk',
    image: Buffer.from('main'), images: [Buffer.from('m1'), Buffer.from('m2'), Buffer.from(''), 'nie buffer'] });
  assert.equal(draft.slides, 3, 'prázdne a neplatné snímky sa vynechajú');
  assert.equal(Buffer.from(studio.image(draft.id, 2)).toString(), 'm2');
  assert.equal(studio.image(draft.id, 5), null);
  const { done } = await studio.publish(draft.id, ['facebook', 'instagram']);
  const result = await done;
  assert.equal(result.draft.status, 'published');
  assert.deepEqual(calls[0].slice(0, 2), ['fb', ['main', 'm1', 'm2']]);
  assert.equal(calls[1][1].length, 3);
  assert.match(calls[1][1][0], /\/api\/studio\/media\/[a-f0-9-]{36}\.jpg\?exp=/);
  assert.match(calls[1][1][2], /\/api\/studio\/media\/[a-f0-9-]{36}-2\.jpg\?exp=/);
  // Podpísaná URL snímky karuselu sa dá stiahnuť, podpis je viazaný na číslo snímky.
  const server = http.createServer((req, res) => { void studio.handleMedia(req, res, () => { res.statusCode = 418; res.end(); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const local = url => `http://127.0.0.1:${server.address().port}${new URL(url).pathname}${new URL(url).search}`;
  const second = studio.mediaUrl(draft.id, 600e3, 'jpg', 2);
  const got = await fetch(local(second));
  assert.equal(got.status, 200);
  assert.equal(Buffer.from(await got.arrayBuffer()).toString(), 'm2');
  assert.equal((await fetch(local(second.replace(`${draft.id}-2.jpg`, `${draft.id}-1.jpg`)))).status, 404, 'podpis na inú snímku neplatí');
});

test('opakovanie: dočasná chyba Mety → pokusy o 10/30/90 min, potom failed a upozornenie; trvalá chyba hneď', async t => {
  const alerts = [];
  let mode = 'temporary';
  let attempts = 0;
  const publisher = {
    status: () => ({ facebook: true, instagram: false, version: 'v23.0' }),
    async facebookPhoto() {
      attempts++;
      if (mode === 'ok') return { id: 'ok_1', url: 'https://www.facebook.com/ok_1' };
      if (mode === 'token') throw Object.assign(new Error('Invalid OAuth access token'), { code: 190, status: 400 });
      throw Object.assign(new Error('Service temporarily unavailable'), { code: 2, status: 503 });
    },
    instagramLimit: async () => null,
  };
  const clock = { time: NOW };
  const store = openAdminStore(':memory:');
  t.after(() => store.close());
  const studio = createStudio({ store, env: { AUTH_ORIGINS: 'https://okolive.sk' }, port: () => 1, now: () => clock.time, timers: false,
    fetchJson: fakeFeeds({ '/api/earthquakes/usgs': { records: [quake()], fetchedAt: NOW - 60e3 } }),
    renderCard: async card => Buffer.from(`jpeg:${card.kind}`), publisher, log: () => {}, onAlert: event => alerts.push(event) });
  const { draft } = await studio.generate('quake');
  let r = await (await studio.publish(draft.id, ['facebook'])).done;
  assert.equal(r.retry, true);
  assert.equal(r.draft.status, 'approved', 'čaká na ďalší pokus, nie failed');
  assert.equal(r.draft.retryAt, NOW + 10 * 60_000);
  assert.equal(r.draft.results.facebook.retryable, true);
  assert.deepEqual(await studio.publishRetryDue(), [], 'čas ešte nenastal');
  for (const [i, delay] of [[2, 30], [3, 90]]) {
    clock.time = studio.get(draft.id).retryAt;
    await studio.publishRetryDue();
    assert.equal(studio.get(draft.id).retryN, i);
    assert.equal(studio.get(draft.id).retryAt, clock.time + delay * 60_000);
  }
  clock.time = studio.get(draft.id).retryAt;
  await studio.publishRetryDue();
  const last = studio.get(draft.id);
  assert.equal(last.status, 'failed');
  assert.equal(last.retryAt, null);
  assert.equal(attempts, 4, '1 + 3 opakovania');
  assert.equal(alerts.length, 1);
  assert.deepEqual([alerts[0].kind, alerts[0].attempts, alerts[0].targets], ['publish_failed', 4, ['facebook']]);
  // Ručné zverejnenie po oprave prejde; trvalá chyba (token) sa neopakuje.
  mode = 'ok';
  assert.equal((await (await studio.publish(draft.id, ['facebook'])).done).draft.status, 'published');
  const second = (await studio.importDraft({ template: 'event', eventKey: 'event:t', title: 'T', text: 'Text', image: Buffer.from('x') })).draft;
  mode = 'token';
  r = await (await studio.publish(second.id, ['facebook'])).done;
  assert.deepEqual([r.retry, r.draft.status, r.draft.retryAt], [false, 'failed', null]);
  assert.equal(alerts.length, 2);
});

test('kontroly limitov: IG text/hashtagy/krátky reel blokujú Instagram, nie Facebook; tipy nič neblokujú', async t => {
  const calls = [];
  const { studio, store } = setup(t, { publisher: fakePublisher(calls) });
  const { draft } = await studio.generate('quake');
  assert.ok(!studio.checks(store.studioGet(draft.id)).some(c => c.level === 'error'), 'šablóna spĺňa limity');
  const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ');
  studio.edit(draft.id, `Prvý riadok.\n${tags}`);
  const checks = studio.checks(store.studioGet(draft.id));
  assert.ok(checks.some(c => c.level === 'error' && c.target === 'instagram' && /31 hashtagov/.test(c.text)));
  assert.ok(checks.some(c => c.level === 'info' && /odkaz/.test(c.text)));
  await assert.rejects(studio.publish(draft.id, ['instagram']), err => err.message === 'limits_exceeded' && /31 hashtagov/.test(err.details[0]));
  assert.equal((await (await studio.publish(draft.id, ['facebook'])).done).draft.results.facebook.id, '1_2', 'Facebook limit hashtagov nemá');
  const long = 'Veľmi dlhý prvý riadok '.repeat(8);
  const reel = store.studioUpdate(draft.id, { text: `${long}\n#OKO`, videoStatus: 'ready', videoSeconds: 2.4 }, NOW);
  const reelChecks = studio.checks(reel);
  assert.ok(reelChecks.some(c => c.level === 'error' && /Reel má 2.4 s/.test(c.text)));
  assert.ok(reelChecks.some(c => c.level === 'warn' && /Prvý riadok má/.test(c.text)));
  assert.equal(calls.length, 1, 'na Instagram sa nič neposlalo');
});

test('najlepší čas: priemerný dosah podľa dňa a hodiny, návrh najbližšieho termínu mimo tichých hodín', async t => {
  const clock = { time: NOW }; // sobota 3. 10. 2026 14:00 Bratislava
  const { studio, store } = setup(t, { clock });
  assert.deepEqual(studio.bestTimes(), { enough: false, posts: 0, slots: [], suggestion: null });
  // 6 príspevkov: piatky 18:00 majú dosah 900–1100, ostatné 100–200.
  const posts = [[Date.UTC(2026, 8, 25, 16), 900], [Date.UTC(2026, 8, 18, 16), 1100], [Date.UTC(2026, 8, 26, 7), 150],
    [Date.UTC(2026, 8, 27, 10), 200], [Date.UTC(2026, 8, 28, 10), 100], [Date.UTC(2026, 8, 29, 12), 120]];
  posts.forEach(([at, reach], i) => {
    const id = `00000000-0000-0000-0000-00000000000${i}`;
    store.studioInsert({ id, template: 'quake', eventKey: `q:${i}`, origin: 'manual', title: `P${i}`, text: 't', card: {}, image: Buffer.from('x'), createdAt: at });
    store.studioUpdate(id, { status: 'published', publishedAt: at, results: { facebook: { id: `f${i}` } } }, at);
    store.insightsSet(id, 'facebook', { reach, views: reach * 2, likes: 1 }, at);
  });
  const best = studio.bestTimes();
  assert.equal(best.enough, true);
  assert.equal(best.posts, 6);
  assert.deepEqual([best.slots[0].weekday, best.slots[0].hour, best.slots[0].n, best.slots[0].score], [5, 18, 2, 1000]);
  assert.equal(best.suggestion, Date.UTC(2026, 9, 9, 16), 'najbližší piatok 18:00 (Bratislava)');
});
