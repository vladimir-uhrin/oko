// OKO — video „Týždeň na fronte" jedným príkazom (2026-10-03, vlastník: „vrátime sa k Ukrajine" → video;
// územie vo videu áno, zdroj sa volá okolive.sk („používaj zdroje okolive.sk, nie DeepState"), kritický voči agresorovi; „video v štýle OKO + Rybar"). Čísla týždňa z hlásení Generálneho štábu Ukrajiny
// a z porovnania dvoch snímok mapy frontu (dáta vrstvy: zrkadlo DeepState — vo výstupoch sa nemenuje), komentár hlasom vlastníka (ai-translators, pamäť nahrávok),
// obraz = KARTA frontu z OKO (žiadne dlaždice Google), hudba z knižnice, titulky. Linka: scripts/lib/frontWeekPipeline.mjs.
//
//   node scripts/make-front-week-video.mjs [--day RRRR-MM-DD] [--out-dir <dir>] [--url http://localhost:4173] [--no-music] [--dry]
// `--day`: posledný deň týždňa (predvolene posledné hlásenie v archíve); `--dry`: len čísla a vety, nič sa nenahráva.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiTranslatorsConfig, createAiTranslatorsClient } from '../src/data/aiTranslatorsClient.js';
import { frontWeekHook, frontWeekLines } from '../src/data/frontWeekNarration.js';
import { createVoiceCache } from './lib/eventVideoPipeline.mjs';
import { loadFrontWeek } from './lib/frontWeekData.mjs';
import { prepareFrontWeekVideo } from './lib/frontWeekPipeline.mjs';

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
const archiveDir = path.join(root, '.gev-cache', 'ukraine', 'events');
const refDay = flag('--day');

if (args.includes('--dry')) {
  const { model } = await loadFrontWeek({ baseUrl, refDay, archiveDir });
  console.log(`[front-week] týždeň ${model.week.from} – ${model.week.to}: ${model.total.week} stretov (predtým ${model.total.prev}), zmena ${model.change ? `RU +${model.change.ruKm2} km² · UA +${model.change.uaKm2} km² (${model.change.fromDay} → ${model.change.toDay})` : 'nie je'}`);
  console.log(`[front-week] háčik: ${JSON.stringify(frontWeekHook(model))}`);
  for (const l of frontWeekLines(model)) console.log(`  ${l.id.padEnd(18)} ${l.shot.padEnd(20)} ${l.caption}`);
  process.exit(0);
}

const dbDir = path.dirname(String(env.FLIGHT_HISTORY_DB || path.join(root, '.gev-cache', 'flight-history.sqlite')));
const cache = createVoiceCache(path.join(dbDir, 'event-video', 'voice'));
const voiceCfg = aiTranslatorsConfig(env);
const voice = voiceCfg.token ? createAiTranslatorsClient(voiceCfg) : null;
if (!voice) console.log('[front-week] AI_TRANSLATORS_MCP_KEY nie je — len nahrávky z pamäte, bez kontroly výslovnosti');
const musicDir = env.EVENT_VIDEO_MUSIC_DIR || path.join(root, '.gev-cache', 'event-video-capture', 'music');
let music = null;
if (!args.includes('--no-music')) {
  try {
    const lib = JSON.parse(fs.readFileSync(path.join(musicDir, 'tracks.json'), 'utf8'));
    const t = lib.tracks[0];
    music = { ...t, file: path.join(musicDir, t.file) };
  } catch { console.log('[front-week] hudba: tracks.json nie je — video bez hudby'); }
}
const started = Date.now();
const workDir = path.resolve(flag('--out-dir', path.join(dbDir, 'front-week', refDay || new Date().toISOString().slice(0, 10))));
const result = await prepareFrontWeekVideo({
  baseUrl, archiveDir, refDay, voice, cache, workDir, music,
  capture: { node: process.execPath, baseUrl },
  tools: { ffmpeg: env.FFMPEG_PATH || 'ffmpeg' },
  onProgress: (stage, detail) => console.log(`[front-week] ${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s  ${stage} ${Object.keys(detail || {}).length ? JSON.stringify(detail) : ''}`),
});
console.log(`[front-week] hotovo: ${result.plan.durationS.toFixed(1)} s, ${result.lines.length} viet, na vypočutie: ${result.review.length}`);
for (const r of result.review) console.log(`  !! ${r.line}: „${r.spoken}" — počuť: „${r.heard}"`);
for (const [k, f] of Object.entries(result.files)) console.log(`  ${k.padEnd(6)} ${f} (${fs.existsSync(f) ? fs.statSync(f).size : 0} B)`);
