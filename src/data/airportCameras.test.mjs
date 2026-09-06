// src/data/airportCameras.test.mjs
// Živé kamery letísk (2026-09-06): katalóg, URL oficiálneho prehrávača,
// vyhľadávací dopyt, výber živého výsledku, kredit, tripwires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AIRPORT_CAMERAS, CAMERA_LOOKUP_TTL_MS, CAMERA_LOOKUP_NEGATIVE_TTL_MS,
  airportCameraFor, cameraCreditText, cameraSearchQuery, isYoutubeVideoId,
  pickLiveCamera, youtubeEmbedUrl, youtubeOembedUrl, youtubeWatchUrl,
} from './airportCameras.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const tr = (s) => (k, v) => { let x = s[k] || k; for (const [a, b] of Object.entries(v || {})) x = x.replaceAll(`{${a}}`, String(b)); return x; };

test('kamery: katalóg — ICAO kľúče, platné 11-znakové ID, dátum overenia, kurátorovaný zdroj', () => {
  for (const [icao, cam] of Object.entries(AIRPORT_CAMERAS)) {
    assert.match(icao, /^[A-Z]{4}$/, icao);
    assert.ok(isYoutubeVideoId(cam.videoId), `${icao} videoId`);
    assert.match(cam.verified, /^\d{4}-\d{2}-\d{2}$/, `${icao} verified`);
    assert.ok(cam.provider && cam.channelUrl.startsWith('https://www.youtube.com/'), `${icao} provider/channel`);
  }
  assert.equal(airportCameraFor('lkpr').videoId, 'kuOmmVkOGN8', 'malé písmená sa normalizujú');
  assert.equal(airportCameraFor('KLAX').source, 'curated');
  assert.equal(airportCameraFor('LZIB'), null, 'Bratislava BEZ kamery — bez súhlasu letiska sa nezapája');
  assert.equal(airportCameraFor(''), null);
  assert.equal(isYoutubeVideoId('short'), false);
  assert.equal(isYoutubeVideoId('kuOmmVkOGN8'), true);
});

test('kamery: URL — privacy-enhanced embed s autoplay, watch, oEmbed; neplatné ID = null', () => {
  const embed = youtubeEmbedUrl('kuOmmVkOGN8');
  assert.match(embed, /^https:\/\/www\.youtube-nocookie\.com\/embed\/kuOmmVkOGN8\?/);
  assert.match(embed, /autoplay=1/); assert.match(embed, /playsinline=1/); assert.match(embed, /rel=0/);
  assert.doesNotMatch(embed, /mute=1/, 'zvuk ATC je pointa — nemutovať; prehliadač prípadne ukáže Play');
  assert.equal(youtubeWatchUrl('kuOmmVkOGN8'), 'https://www.youtube.com/watch?v=kuOmmVkOGN8');
  assert.equal(youtubeOembedUrl('kuOmmVkOGN8'), 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DkuOmmVkOGN8&format=json');
  assert.equal(youtubeEmbedUrl('<script>'), null);
  assert.equal(youtubeWatchUrl(null), null);
});

test('kamery: vyhľadávací dopyt je krátky, bez slova Airport, s kódom a „live"', () => {
  assert.equal(cameraSearchQuery({ name: 'M. R. Štefánik Airport', municipality: 'Bratislava', iata: 'BTS', icao: 'LZIB' }), 'M. R. Štefánik Bratislava airport BTS live');
  assert.equal(cameraSearchQuery({ name: 'Vienna International Airport', municipality: 'Vienna', iata: 'VIE' }), 'Vienna airport VIE live', 'mesto = názov sa neopakuje');
  assert.equal(cameraSearchQuery({ municipality: 'Košice', icao: 'LZKZ' }), 'Košice airport LZKZ live');
  assert.equal(cameraSearchQuery({}), 'airport live');
});

test('kamery: výber živého výsledku — len live, bez simulátorov, preferuje kameru a zhodu s letiskom', () => {
  const props = { icao: 'LKPR', iata: 'PRG', municipality: 'Prague', name: 'Václav Havel Airport Prague' };
  const payload = { items: [
    { id: { videoId: 'AAAAAAAAAA1' }, snippet: { title: 'MSFS Prague landing gameplay', liveBroadcastContent: 'live', channelTitle: 'Sim guy' } },
    { id: { videoId: 'AAAAAAAAAA2' }, snippet: { title: 'Prague Airport LIVE cam runway 06/24', liveBroadcastContent: 'live', channelTitle: 'SlowTV', description: 'ATC included' } },
    { id: { videoId: 'AAAAAAAAAA3' }, snippet: { title: 'Prague airport live camera', liveBroadcastContent: 'none', channelTitle: 'Old' } },
    { id: { videoId: 'bad' }, snippet: { title: 'live cam', liveBroadcastContent: 'live' } },
  ] };
  const pick = pickLiveCamera(payload, props);
  assert.equal(pick.videoId, 'AAAAAAAAAA2');
  assert.equal(pick.source, 'search');
  assert.equal(pick.provider, 'SlowTV');
  assert.equal(pickLiveCamera({ items: [{ id: { videoId: 'AAAAAAAAAA9' }, snippet: { title: 'Random stream', liveBroadcastContent: 'live' } }] }, props), null, 'bez zhody s letiskom/kamerou = nič');
  assert.equal(pickLiveCamera({}), null); assert.equal(pickLiveCamera(null), null);
  assert.equal(cameraCreditText({ provider: 'SlowTV' }, tr(SK_STRINGS)), 'Kamera + ATC · SlowTV · YouTube');
  assert.equal(cameraCreditText({}, tr(EN_STRINGS)), 'Camera + ATC · YouTube · YouTube');
  assert.ok(CAMERA_LOOKUP_TTL_MS >= 3600_000 && CAMERA_LOOKUP_NEGATIVE_TTL_MS >= 600_000);
});

test('kamery: tripwire — proxy bez kľúča, denný strop, DATA_SOURCES, kredit, env vzor, skript, i18n, čistý modul', () => {
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /'\/api\/youtube-live'/, 'proxy trasa existuje');
  assert.match(vite, /YOUTUBE_API_KEY/); assert.match(vite, /no_key/);
  assert.match(vite, /YOUTUBE_LIVE_DAILY_SEARCH_CAP/, 'denný strop kvóty');
  assert.match(vite, /eventType=live/);
  const env = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.match(env, /^YOUTUBE_API_KEY=$/m, 'vzor bez hodnoty');
  const ds = readFileSync(new URL('../../DATA_SOURCES.md', import.meta.url), 'utf8');
  assert.match(ds, /Live airport cameras — ACTIVE/); assert.match(ds, /youtube-nocookie\.com/); assert.match(ds, /daily cap/i);
  const credits = readFileSync(new URL('./dataCredits.js', import.meta.url), 'utf8');
  assert.match(credits, /key: 'airport-cameras'/);
  const script = readFileSync(new URL('../../scripts/check-airport-cameras.mjs', import.meta.url), 'utf8');
  assert.match(script, /isLiveNow/); assert.match(script, /playableInEmbed/);
  for (const k of ['airport.section.camera', 'airport.camera-credit', 'airport.camera-open', 'airport.camera-searching', 'airport.camera-found']) {
    assert.ok(EN_STRINGS[k] && SK_STRINGS[k], k);
  }
  const src = readFileSync(new URL('./airportCameras.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fetch\(|document\.|window\./, 'čistý modul');
  assert.doesNotMatch(src, /LZIB/, 'BTS nie je v katalógu (bez súhlasu)');
});
