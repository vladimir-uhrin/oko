// OKO — priprav video k udalosti jedným príkazom (2026-10-03, vlastník: „sprav" k automatizácii). To isté,
// čo robí tlačidlo PRIPRAVIŤ VIDEO v paneli udalosti (služba udalostí → scripts/lib/eventVideoPipeline.mjs),
// z príkazového riadka: udalosť zo služby (--event <id>) alebo zo súboru (--event-file), scenár vlastníka
// (--script <json>: háčik so zdrojmi, doplnky, náhrady viet), hlas z pamäte nahrávok alebo z ai-translators
// (AI_TRANSLATORS_MCP_URL + AI_TRANSLATORS_MCP_KEY v .env), hudba z knižnice (EVENT_VIDEO_MUSIC_DIR/tracks.json), výstupy do --out-dir.
//
//   node scripts/make-event-video.mjs --event <id> [--event-file <json>] [--script <json>] [--out-dir <dir>]
//     [--url http://localhost:4173] [--seed-voice <map.json>] [--no-music]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiTranslatorsConfig, createAiTranslatorsClient } from '../src/data/aiTranslatorsClient.js';
import { normalizeVideoScript } from '../src/data/eventVideoScript.js';
import { parseTrustedList } from '../src/data/eventNews.js';
import { createVoiceCache, prepareEventVideo } from './lib/eventVideoPipeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const env = { ...process.env };
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* bez .env */ }

const baseUrl = flag('--url', 'http://localhost:4173').replace(/\/+$/, '');
let event;
if (flag('--event-file')) event = JSON.parse(fs.readFileSync(path.resolve(flag('--event-file')), 'utf8'));
else {
  const id = flag('--event');
  if (!id) { console.error('[make-video] chýba --event <id> alebo --event-file'); process.exit(2); }
  const res = await fetch(`${baseUrl}/api/events/${id}`);
  if (!res.ok) { console.error(`[make-video] udalosť ${id}: HTTP ${res.status}`); process.exit(1); }
  event = await res.json();
}
const trusted = parseTrustedList(JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'local_data', 'events', 'trusted-news.json'), 'utf8')));
const script = flag('--script') ? normalizeVideoScript(JSON.parse(fs.readFileSync(path.resolve(flag('--script')), 'utf8')), { trusted }) : null;
const dbDir = path.dirname(String(env.FLIGHT_HISTORY_DB || path.join(root, '.gev-cache', 'flight-history.sqlite')));
const cache = createVoiceCache(path.join(dbDir, 'event-video', 'voice'));
if (flag('--seed-voice')) {
  const seed = JSON.parse(fs.readFileSync(path.resolve(flag('--seed-voice')), 'utf8'));
  for (const it of seed.items) {
    cache.seed(seed.voice || 'own', it.text, path.join(seed.dir, it.file), { heard: it.heard ?? null, heardOk: it.heardOk ?? null, approved: it.approved === true });
  }
  console.log(`[make-video] pamäť hlasu: vložených ${seed.items.length} nahrávok`);
}
const voiceCfg = aiTranslatorsConfig(env);
const voice = voiceCfg.token ? createAiTranslatorsClient(voiceCfg) : null;
if (!voice) console.log('[make-video] AI_TRANSLATORS_MCP_KEY nie je — len nahrávky z pamäte, bez kontroly výslovnosti');
else console.log(`[make-video] hlas: ${voiceCfg.url}`);
const musicDir = env.EVENT_VIDEO_MUSIC_DIR || path.join(root, '.gev-cache', 'event-video-capture', 'music');
let music = null;
if (!args.includes('--no-music')) {
  try {
    const lib = JSON.parse(fs.readFileSync(path.join(musicDir, 'tracks.json'), 'utf8'));
    const t = lib.tracks[0];
    music = { ...t, file: path.join(musicDir, t.file) };
  } catch { console.log('[make-video] hudba: tracks.json nie je — video bez hudby'); }
}
const workDir = path.resolve(flag('--out-dir', path.join(dbDir, 'event-video', 'work', event.id)));
const started = Date.now();
const result = await prepareEventVideo({
  event, script, voice, cache, workDir, music,
  capture: { node: process.execPath, baseUrl },
  tools: { ffmpeg: env.FFMPEG_PATH || 'ffmpeg' },
  onProgress: (stage, detail) => console.log(`[make-video] ${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s  ${stage} ${Object.keys(detail || {}).length ? JSON.stringify(detail) : ''}`),
});
console.log(`[make-video] hotovo: ${result.durationS.toFixed(1)} s, ${result.lines.length} viet, na vypočutie: ${result.review.length}`);
for (const r of result.review) console.log(`  !! ${r.line}: „${r.spoken}" — počuť: „${r.heard}"`);
for (const [k, f] of Object.entries(result.files)) console.log(`  ${k.padEnd(6)} ${f} (${fs.existsSync(f) ? fs.statSync(f).size : 0} B)`);
