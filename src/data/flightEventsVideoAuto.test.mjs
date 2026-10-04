// src/data/flightEventsVideoAuto.test.mjs — video automaticky zo služby udalostí (2026-10-03, vlastník: „sprav";
// „nemusím to robiť s tebou"). Testy SPRÁVANIA s falošnou linkou: scenár so zdrojmi sa uloží až po overení
// citátov v článkoch (nenájdený citát = odmietnuté celé, nedostupný článok = poznámka), PRIPRAVIŤ VIDEO spustí
// linku na pozadí, stav sa dá sledovať, hotové výstupy (video s titulkami, bez titulkov, SRT) sú na stiahnutie
// pre presne tie údaje a scenár; druhá udalosť naraz nie; zvonku nič.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFlightEventsService } from './flightEventsService.js';
import { createEventVideoStore } from './eventVideoRender.js';
import { normalizeTrack } from './flightAnomalies.js';
import { simplifyTrack } from './eventCard.js';
import { FZ1073_REPORTED_INPUT, fz1073Event, fz1073 } from './fixtures/flightEventFixtures.mjs';

const OWN_POST = { method: 'POST', headers: { origin: 'http://localhost:4173', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } };
const fakeMp4 = () => Buffer.concat([Buffer.from('\0\0\0\x18ftypisom', 'latin1'), Buffer.alloc(64, 1), Buffer.from('moov'), Buffer.alloc(32, 2)]);
const page = (quote) => `<html><body><p>Netanyahu said “${quote},” on Wednesday.</p></body></html>`;

async function call(service, url, local = true, { method = 'GET', headers = {}, body } = {}) {
  const res = { status: 0, body: '', headers: {}, writeHead(s, h = {}) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
  const req = { url, local, method, headers };
  if (body !== undefined) {
    const buf = Buffer.from(JSON.stringify(body));
    req[Symbol.asyncIterator] = async function* stream() { yield buf; };
  }
  await service.handle(req, res);
  const isJson = String(res.headers['Content-Type'] || '').startsWith('application/json');
  return { status: res.status, headers: res.headers, json: isJson ? JSON.parse(res.body) : null, body: res.body };
}

test('scenár so zdrojmi → overenie citátov → príprava videa na pozadí → stav → výstupy; zmena scenára = nové video', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-video-auto-'));
  const articles = {
    'https://www.aljazeera.com/news/2026/9/30/x': page('one of the pilots stabbed the other pilot, and apparently tried to crash the plane'),
    'https://www.arabnews.com/middle-east/x': page('passengers and crew members on the flight managed to subdue the attacker'),
  };
  const trustedFile = path.join(dir, 'trusted-news.json');
  writeFileSync(trustedFile, JSON.stringify({ domains: ['arabnews.com', 'aljazeera.com', 'reuters.com'] }));
  const fetchImpl = async (url) => {
    const u = String(url);
    if (articles[u]) return { ok: true, status: 200, text: async () => articles[u] };
    if (u.startsWith('https://www.reuters.com/')) return { ok: false, status: 403, text: async () => '' };
    return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => Buffer.alloc(0) };
  };
  const files = () => {
    const f = (name, body) => { const p = path.join(dir, name); writeFileSync(p, body); return p; };
    return { burned: f('burned.mp4', fakeMp4()), clean: f('clean.mp4', fakeMp4()), srt: f('x.srt', '1\n00:00:00,350 --> 00:00:04,590\nPilot pobodal kolegu\n') };
  };
  const runs = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const videoPipeline = {
    voiceReady: true,
    run: async (event, script, onProgress) => {
      runs.push({ id: event.id, hook: script?.hook?.tag ?? null, reported: (event.reported || []).length });
      onProgress('voice', { line: 'hook1' });
      onProgress('capture', { frame: 10, frames: 100 });
      await gate;
      return { durationS: 67.8, review: [{ line: 'm5', spoken: 'Údaje končia vo výške pätnásťtisíc stôp — lietadlo je stále vo vzduchu.', heard: 'Údaje končia vo výške päťtisíc stôp, lietadlo je stále vo vzduchu.' }], files: files() };
    },
  };
  const logs = [];
  const videoStore = createEventVideoStore({ dir: path.join(dir, '3d') });
  const base = await fz1073Event();
  const { oko, adsblol } = fz1073();
  const stored = { ...base, id: '8965d1-20260930T0522', track: simplifyTrack(normalizeTrack([...oko, ...adsblol])), window: { fromT: base.firstT - 7200, toT: base.lastT + 3600 }, analyzedT: 1, final: true };
  const service = createFlightEventsService({
    getStore: () => ({ async triggersSince() { return []; }, async track() { return []; }, async flightsOf() { return []; } }),
    eventsDir: path.join(dir, 'events'),
    isLocal: (req) => req.local === true,
    fetchImpl,
    now: () => Date.parse('2026-10-03T10:00:00Z'),
    log: (m) => logs.push(m),
    tickMs: 3_600_000,
    trustedFile,
    videoStore,
    videoPipeline,
    airportsFile: fileURLToPath(new URL('./local_data/airports/airports.geojsonl', import.meta.url)),
  });
  service.store.save(stored);
  const id = stored.id;
  try {
    assert.equal((await call(service, `/${id}/reported`, true, { ...OWN_POST, body: JSON.parse(JSON.stringify(FZ1073_REPORTED_INPUT)) })).status, 200);
    const script = {
      hook: {
        tag: 'útok na palube', lines: ['Pilot pobodal kolegu', 'a pokúsil sa zrútiť lietadlo'], sub: 'Cestujúci ho zneškodnili', attributed: 'izraelského premiéra',
        spoken: ['Pilot pobodal kolegu a pokúsil sa zrútiť lietadlo s cestujúcimi, tvrdí izraelský premiér.'],
        sources: [
          { url: 'https://www.aljazeera.com/news/2026/9/30/x', quote: 'one of the pilots stabbed the other pilot, and apparently tried to crash the plane' },
          { url: 'https://www.arabnews.com/middle-east/x', quote: 'passengers and crew members on the flight managed to subdue the attacker' },
        ],
      },
      extras: [],
    };
    // Citát, ktorý v článku nie je → odmietnuté celé, nič sa neuloží.
    const wrong = JSON.parse(JSON.stringify(script));
    wrong.hook.sources[0].quote = 'the co-pilot was arrested at the airport';
    const refused = await call(service, `/${id}/video-script`, true, { ...OWN_POST, body: wrong });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error, 'quote_not_found');
    assert.equal(refused.json.checks.find((c) => c.domain === 'aljazeera.com').state, 'not_found');
    assert.equal(service.store.get(id).videoScript ?? null, null);
    assert.equal((await call(service, `/${id}/video-script`, true, { ...OWN_POST, body: { hook: { ...script.hook, sources: [] } } })).json.error, 'bad_script');
    assert.equal((await call(service, `/${id}/video-script`, true, { ...OWN_POST, body: { extras: [{ spoken: 'Podľa Flightradar24 kleslo.', sources: script.hook.sources }] } })).json.why.includes('konkurenčná'), true);
    // Nedostupný článok (403) sa prijme s poznámkou.
    const withReuters = JSON.parse(JSON.stringify(script));
    withReuters.extras = [{ spoken: 'Cestujúcich odviezlo náhradné lietadlo.', sources: [{ url: 'https://www.reuters.com/world/x', quote: 'a replacement aircraft carried the passengers to Tel Aviv' }] }];
    const ok = await call(service, `/${id}/video-script`, true, { ...OWN_POST, body: withReuters });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(ok.json.videoScript.quoteChecks.map((c) => c.state), ['found', 'found', 'unavailable']);
    assert.equal(ok.json.videoScript.hook.source, 'podľa izraelského premiéra · Al Jazeera, Arab News');
    const post = await call(service, `/${id}/post`);
    assert.equal(post.json.videoScript.hook.tag, 'ÚTOK NA PALUBE');
    assert.deepEqual([post.json.videoPrepare, post.json.voiceReady, post.json.videoJob.state, post.json.videoReady], [true, true, 'idle', false]);
    // Príprava: úloha beží na pozadí, stav sa hlási, druhá naraz nie, video ešte nie je.
    const started = await call(service, `/${id}/video/prepare`, true, { ...OWN_POST, body: {} });
    assert.equal(started.status, 202, JSON.stringify(started.json));
    await new Promise((r) => setTimeout(r, 20));
    const running = await call(service, `/${id}/video/status`);
    assert.equal(running.json.state, 'running');
    assert.equal(running.json.stage, 'capture');
    assert.deepEqual(running.json.detail, { frame: 10, frames: 100 });
    assert.equal((await call(service, `/${id}/video/prepare`, true, { ...OWN_POST, body: {} })).json.error, 'already_running');
    assert.equal((await call(service, `/${id}/video.mp4`)).status, 404, 'kým nie je hotové');
    release();
    for (let i = 0; i < 100 && (await call(service, `/${id}/video/status`)).json.state !== 'done'; i += 1) await new Promise((r) => setTimeout(r, 10));
    const done = await call(service, `/${id}/video/status`);
    assert.equal(done.json.state, 'done', JSON.stringify(done.json));
    assert.equal(done.json.durationS, 67.8);
    assert.deepEqual(done.json.review.map((r) => r.line), ['m5'], 'veta na vypočutie');
    assert.deepEqual(runs, [{ id, hook: 'ÚTOK NA PALUBE', reported: 2 }], 'linka dostala udalosť s faktami aj scenár');
    assert.equal((await call(service, `/${id}/post`)).json.videoReady, true, 'video pre tieto údaje je hotové');
    assert.equal((await call(service, `/${id}/video.mp4`)).status, 200);
    assert.equal((await call(service, `/${id}/video.mp4?variant=clean`)).status, 200);
    const srt = await call(service, `/${id}/video.srt`);
    assert.equal(srt.status, 200);
    assert.ok(String(srt.body).includes('Pilot pobodal kolegu'));
    assert.match(String(srt.headers['Content-Type']), /text\/plain/);
    assert.equal((await call(service, `/${id}/video/status`, false)).status, 404, 'zvonku nič');
    assert.ok(logs.some((l) => /video pripravené \(67\.8 s, na vypočutie 1\)/.test(l)), logs.join('\n'));
    // Zmena scenára = iné video → znova nie je hotové; zmazanie scenára.
    const other = JSON.parse(JSON.stringify(withReuters));
    other.hook.lines = ['Pilot pobodal kolegu', 'a chcel zrútiť lietadlo'];
    assert.equal((await call(service, `/${id}/video-script`, true, { ...OWN_POST, body: other })).status, 200);
    assert.equal((await call(service, `/${id}/post`)).json.videoReady, false);
    assert.equal((await call(service, `/${id}/video-script`, true, { ...OWN_POST, body: { script: null } })).json.videoScript, null);
  } finally {
    service.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bez linky: PRIPRAVIŤ VIDEO = 503, stav idle; denný strop a zaneprázdnenosť hlási úloha', async () => {
  const { createEventVideoJobs } = await import('./eventVideoJobs.js');
  let clock = Date.parse('2026-10-03T10:00:00Z');
  let release;
  const jobs = createEventVideoJobs({ run: () => new Promise((r) => { release = r; }), now: () => clock, dailyMax: 2 });
  assert.deepEqual(jobs.status('x'), { state: 'idle' });
  assert.equal(jobs.start({ id: 'a' }, null).ok, true);
  assert.equal(jobs.start({ id: 'b' }, null).error, 'busy', 'jedna naraz');
  release({ durationS: 1, review: [], files: null });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(jobs.status('a').state, 'done');
  assert.equal(jobs.start({ id: 'b' }, null).ok, true);
  release({});
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(jobs.start({ id: 'c' }, null).error, 'daily_limit', 'strop dňa (kvóta dlaždíc)');
  clock += 86400_000;
  assert.equal(jobs.start({ id: 'c' }, null).ok, true, 'ďalší deň znova');
  release({});
});
