// scripts/lib/eventVideoPipeline.test.mjs — hlasová časť linky videa k udalosti (2026-10-03): nahrávka z pamäte
// alebo zo služby, kontrola výslovnosti prepisom, výmena nahrávky (3×), vety na vypočutie, vypršané odkazy,
// beh bez služby. Testy SPRÁVANIA s falošnou službou a falošným meraním (bez ffmpeg, bez siete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVoiceCache, prepareVoice, VOICE_LINK_MAX_AGE_MS } from './eventVideoPipeline.mjs';

const T0 = Date.parse('2026-10-03T10:00:00Z');
const line = (id, spoken, caption = spoken, approved = false) => ({ id, spoken, caption, approved });

/** Falošná služba: každá nahrávka má nový odkaz; prepis vracia podľa poradia nahrávok danej vety. */
function fakeVoice(heardByText) {
  const calls = { readAloud: [], transcribe: [] };
  const byUrl = new Map();
  let n = 0;
  return {
    calls,
    byUrl,
    async readAloud(text) {
      n += 1;
      const url = `http://192.168.2.43:9110/api/tts/download/tts_${n}.wav?t=sig${n}`;
      const seq = heardByText[text] || [text];
      byUrl.set(url, seq[Math.min(calls.readAloud.filter((t) => t === text).length, seq.length - 1)]);
      calls.readAloud.push(text);
      return { url, seconds: 2.5, engine: 'omnivoice-clone' };
    },
    async transcribe(url) {
      calls.transcribe.push(url);
      if (!byUrl.has(url)) throw Object.assign(new Error('ai-translators: prepis zlyhal (download failed)'), { code: 'ASR_FAILED' });
      return byUrl.get(url);
    },
  };
}

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-voice-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cache = createVoiceCache(dir);
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([82, 73, 70, 70]).buffer });
  const measure = () => ({ lead: 0.1, speechEnd: 1.4, pauses: [] });
  const progress = [];
  const run = (lines, voice, extra = {}) => prepareVoice({ lines, voice, cache, fetchImpl, measure, now: () => T0, onProgress: (s, d) => progress.push({ s, ...d }), ...extra });
  return { cache, run, progress };
}

test('nová veta: nahrávka zo služby → stiahnutie → pamäť → prepis sedí; druhý beh už službu nevolá', async (t) => {
  const { cache, run, progress } = setup(t);
  const voice = fakeVoice({ 'Potom deväť minút bez údajov.': ['Potom 9 minút bez údajov.'] });
  const lines = [line('m1', 'Potom deväť minút bez údajov.', 'Potom 9 minút bez údajov.')];
  const r = await run(lines, voice);
  assert.deepEqual(voice.calls.readAloud, ['Potom deväť minút bez údajov.']);
  assert.equal(voice.calls.transcribe.length, 1);
  assert.deepEqual(r.review, []);
  assert.deepEqual(r.durations, { m1: { lead: 0.1, speechEnd: 1.4 } });
  assert.ok(fs.existsSync(r.voiceFiles.m1), 'WAV v pamäti');
  const meta = cache.get('own', 'Potom deväť minút bez údajov.').meta;
  assert.equal(meta.heardOk, true);
  assert.equal(meta.heard, 'Potom 9 minút bez údajov.');
  assert.equal(meta.caption, 'Potom 9 minút bez údajov.');
  assert.deepEqual(progress.map((p) => p.s), ['voice', 'asr', 'voice-done']);

  const again = await run(lines, voice);
  assert.equal(voice.calls.readAloud.length, 1, 'overená nahrávka sa nenahráva znova');
  assert.equal(voice.calls.transcribe.length, 1, 'ani neprepisuje');
  assert.deepEqual(again.review, []);
});

test('zlá výslovnosť: nová nahrávka tej istej vety (najviac 3 nahrávky), tretia sedí → bez vypočutia, pamäť drží poslednú', async (t) => {
  const { cache, run } = setup(t);
  const voice = fakeVoice({ 'Obrat o dvesto šesť stupňov.': ['Obrat o dvesto šesť stupne.', 'Obrat o 206 stupňo.', 'Obrat o 206 stupňov.'] });
  const r = await run([line('m4', 'Obrat o dvesto šesť stupňov.', 'Obrat o 206 stupňov.')], voice);
  assert.equal(voice.calls.readAloud.length, 3);
  assert.equal(voice.calls.transcribe.length, 3);
  assert.deepEqual(r.review, []);
  const meta = cache.get('own', 'Obrat o dvesto šesť stupňov.').meta;
  assert.equal(meta.heardOk, true);
  assert.match(meta.url, /tts_3\.wav/, 'posledná (dobrá) nahrávka');
});

test('stále zle: po troch nahrávkach ostáva posledná a veta ide na vypočutie s chýbajúcimi slovami; bez služby sa z pamäte hlási znova; so službou sa nahráva znova (nie prepis toho istého zvuku)', async (t) => {
  const { cache, run } = setup(t);
  const voice = fakeVoice({ 'Údaje končia vo výške pätnásťtisíc stôp.': ['Údaje končia vo výške päťtisíc stôp.'] });
  const lines = [line('m7', 'Údaje končia vo výške pätnásťtisíc stôp.', 'Údaje končia vo výške 15 000 stôp.')];
  const r = await run(lines, voice);
  assert.equal(voice.calls.readAloud.length, 3);
  assert.equal(voice.calls.transcribe.length, 3);
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].line, 'm7');
  assert.deepEqual(r.review[0].missing, ['15000']);
  assert.equal(cache.get('own', lines[0].spoken).meta.heardOk, false);
  assert.ok(r.voiceFiles.m7, 'video sa aj tak dá zložiť — s poslednou nahrávkou');

  const offline = await run(lines, null);
  assert.equal(offline.review.length, 1, 'bez služby: tá istá veta na vypočutie');
  assert.equal(offline.review[0].heard, 'Údaje končia vo výške päťtisíc stôp.');

  voice.calls.readAloud.length = 0;
  voice.calls.transcribe.length = 0;
  const retry = await run(lines, voice);
  assert.equal(voice.calls.readAloud.length, 2, 'neprešla nahrávka sa neprepisuje znova — rovno nové nahrávky, do limitu');
  assert.equal(voice.calls.transcribe.length, 2);
  assert.equal(retry.review.length, 1);
});

test('schválená veta (portál) sa nekontroluje; nahrávka z pamäte bez odkazu alebo s vypršaným odkazom sa pred kontrolou nahrá znova', async (t) => {
  const { cache, run } = setup(t);
  const voice = fakeVoice({ 'Potom deväť minút bez údajov.': ['Potom 9 minút bez údajov.'] });
  voice.byUrl.set('http://192.168.2.43:9110/api/tts/download/cerstvy.wav?t=y', 'Cestujúcich odviezlo náhradné lietadlo.');
  cache.put('own', 'Celú rekonštrukciu nájdete na okolajv bodka es ká.', Buffer.from([1]), { approved: true });
  cache.put('own', 'Kód núdze.', Buffer.from([1]), { heardOk: null });
  cache.put('own', 'Potom deväť minút bez údajov.', Buffer.from([1]), { url: 'http://192.168.2.43:9110/api/tts/download/stary.wav?t=x', savedAt: new Date(T0 - VOICE_LINK_MAX_AGE_MS - 60_000).toISOString() });
  cache.put('own', 'Cestujúcich odviezlo náhradné lietadlo.', Buffer.from([1]), { url: 'http://192.168.2.43:9110/api/tts/download/cerstvy.wav?t=y', savedAt: new Date(T0 - 60_000).toISOString() });
  const r = await run([
    line('portal', 'Celú rekonštrukciu nájdete na okolajv bodka es ká.', 'Celú rekonštrukciu nájdete na okolive.sk.', true),
    line('m5', 'Kód núdze.'),
    line('m1', 'Potom deväť minút bez údajov.', 'Potom 9 minút bez údajov.'),
    line('m9', 'Cestujúcich odviezlo náhradné lietadlo.'),
  ], voice);
  assert.deepEqual(r.review, []);
  assert.deepEqual(voice.calls.readAloud, ['Kód núdze.', 'Potom deväť minút bez údajov.'], 'bez odkazu a s vypršaným odkazom = nová nahrávka; čerstvá sa len prepíše');
  assert.equal(voice.calls.transcribe.length, 3, 'schválená veta bez prepisu');
  assert.ok(voice.calls.transcribe.some((u) => u.includes('cerstvy')), 'čerstvý odkaz ide na prepis bez novej nahrávky');
  assert.equal(cache.get('own', 'Celú rekonštrukciu nájdete na okolajv bodka es ká.').meta.approved, true);
});

test('bez služby: chýbajúca nahrávka = chyba NO_VOICE s vetou; nahrávky z pamäte sa použijú bez kontroly', async (t) => {
  const { cache, run } = setup(t);
  cache.put('own', 'Kód núdze.', Buffer.from([1]), {});
  const ok = await run([line('m5', 'Kód núdze.')], null);
  assert.deepEqual(ok.review, []);
  assert.ok(ok.voiceFiles.m5);
  await assert.rejects(run([line('m2', 'Nová veta.')], null), (e) => e.code === 'NO_VOICE' && e.line === 'm2' && /Nová veta/.test(e.message));
});

test('nahrávka, ktorá predtým neprešla, sa pred zahodením posúdi znova: keď uložený prepis dnes sedí, ostáva (aj bez služby)', async (t) => {
  const { cache, run } = setup(t);
  const spoken = 'Pri Lymane sa front pohol opačným smerom: Ukrajina tu získala späť tridsaťšesť kilometrov štvorcových.';
  const caption = 'Pri Lymane sa front pohol opačným smerom: Ukrajina tu získala späť 36 km².';
  // Stav po behu so staršími pravidlami: prepis rozpoznávača („36 km štvorcových", meno po svojom) vtedy neprešiel.
  cache.put('own', spoken, Buffer.from([1]), { url: 'http://192.168.2.43:9110/x.wav', savedAt: new Date(T0).toISOString(), heard: 'Pri Limane sa front pohol opačným smerom. Ukrajina tu získala späť 36 km štvorcových.', heardOk: false });
  const voice = fakeVoice({});
  const lines = [{ id: 'lyman-a', spoken, caption, names: true }];
  const r = await run(lines, voice);
  assert.deepEqual(r.review, []);
  assert.equal(voice.calls.readAloud.length, 0, 'nahrávka sa nezahodí');
  assert.equal(voice.calls.transcribe.length, 0, 'ani sa neprepisuje znova');
  assert.equal(cache.get('own', spoken).meta.heardOk, true);
  // Bez tolerancie mien (veta ju nežiada) prepis nesedí ani dnes → nová nahrávka.
  cache.update('own', spoken, { heardOk: false });
  const strict = await run([{ id: 'lyman-a', spoken, caption }], fakeVoice({ [spoken]: ['Pri Lymane sa front pohol opačným smerom. Ukrajina tu získala späť 36 km štvorcových.'] }));
  assert.deepEqual(strict.review, []);
  assert.equal(cache.get('own', spoken).meta.heard, 'Pri Lymane sa front pohol opačným smerom. Ukrajina tu získala späť 36 km štvorcových.');
  // Bez služby: uložený prepis, ktorý nesedí ani dnes, ide ďalej na vypočutie.
  cache.update('own', spoken, { heardOk: false, heard: 'Pri Lymane sa front pohol opačným smerom. Ukrajina tu získala späť 35 km štvorcových.' });
  const offline = await run(lines, null);
  assert.equal(offline.review.length, 1);
});

test('zhrnutie zlyhania nahrávania: prvý riadok s chybou (Chrome v systémovom profile služby) + posledný riadok, bez zásobníka', async () => {
  const { captureFailureSummary } = await import('./eventVideoPipeline.mjs');
  const out = [
    '[event-video] 8965d1: 67.8 s, 2033 snímok',
    'C:/x/BrowserLauncher.js:334',
    '                    throw new Error(`Could not find Chrome (ver. ${v}).`);',
    'Error: Could not find Chrome (ver. 145.0.7632.77). This can occur if either',
    ' 2. your cache path is incorrectly configured (which is: C:/Windows/System32/config/systemprofile/.cache/puppeteer).',
    '    at async file:///C:/x/scripts/capture-event-video.mjs:102:15',
    '',
    'Node.js v24.20.0',
  ].join('\r\n');
  const s = captureFailureSummary(out);
  assert.match(s, /^Error: Could not find Chrome/, 'riadok Error: má prednosť pred riadkom zdroja s throw');
  assert.match(s, /Node\.js v24\.20\.0$/);
  assert.doesNotMatch(s, /at async/);
  assert.equal(captureFailureSummary(''), 'bez výpisu');
});
