#!/usr/bin/env node
// Denné video „Deň na fronte" jedným príkazom (2026-10-05, vlastník: „denné akčné spravodajstvo z UA … systém,
// nie ty", „v štýle OKO a text kvalitnejší", „riaď sa FB", akčné zábery). Linka: scripts/lib/frontDayPipeline.mjs.
//
//   node scripts/make-front-day-video.mjs [--dry] [--frames 0,90,200] [--out-dir <dir>] [--url http://localhost:4173] [--no-music]
// `--dry`: model, háčik, komentár a text príspevku zo živých dát, nič sa nenahráva.
// `--frames`: hlas + plán + len vzorové snímky obrazu (kontrola rozloženia), bez videa.
// Výstup: den-na-fronte-<deň>-titulky.mp4 (9:16), bez titulkov, SRT, text príspevku.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiTranslatorsConfig, createAiTranslatorsClient } from '../src/data/aiTranslatorsClient.js';
import { dayStory, frontDayHook, frontDayLines, frontDayPostText } from '../src/data/frontDayNarration.js';
import { createVoiceCache } from './lib/eventVideoPipeline.mjs';
import { loadFrontDay } from './lib/frontDayData.mjs';
import { prepareFrontDayVideo } from './lib/frontDayPipeline.mjs';

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
// Stránka na nahrávanie (dev server s Cesiom) a dáta zvlášť: dáta priamo zo služby API — cez preposielanie dev
// servera veľká odpoveď /api/ukraine/events zhodí undici v Node („assert(!this.paused)", 2026-10-05).
const baseUrl = flag('--url', env.FRONT_DAY_URL || 'http://localhost:4173').replace(/\/+$/, '');
const apiUrl = flag('--api', env.FRONT_DAY_API_URL || 'http://localhost:4175').replace(/\/+$/, '');

if (args.includes('--dry')) {
  const { model, reason } = await loadFrontDay({ baseUrl: apiUrl });
  if (!model) { console.error(`[front-day] video sa dnes nerobí: ${reason}`); process.exit(3); }
  // Ako vo videu: prvé dva kandidáti (bez sťahovania nevieme, ktorý je na výšku a vypadne).
  const candidates = model.clips;
  model.clips = candidates.slice(0, 2);
  if (candidates.length > 2) console.log(`  ďalší kandidáti záberov: ${candidates.slice(2).map(c => c.captionSk).join(' | ')}`);
  const hook = frontDayHook(model);
  const lines = frontDayLines(model);
  console.log(`[front-day] deň ${model.day} · príbeh ${dayStory(model)} · strety ${model.report.total} (priemer ${model.avg7 ?? '—'})`);
  console.log(`  smery: ${model.directions.map(d => `${d.id} ${d.attacks}`).join(', ') || '—'}`);
  console.log(`  mapa: ${model.change ? `${model.change.fromDay} → ${model.change.toDay} (${model.change.spanDays} d): RU +${model.change.ruKm2.toFixed(1)} km², UA +${model.change.uaKm2.toFixed(1)} km²` : `bez zmeny (${model.frontStale || 'nedostupná'})`}`);
  console.log(`  noc: ${model.air ? `${model.air.count} oblastí, ${model.air.kinds.join('+') || '—'}` : '—'}`);
  const cas = model.casualties;
  console.log(`  obete zo správ: ${cas?.total ? `celok ${cas.total.killed ?? '—'} mŕtvych / ${cas.total.injured ?? '—'} zranených` : '—'}${(cas?.places || []).map(p => ` | ${p.sk} ${p.killed ?? '—'}${p.children ? ` (${p.children} detí)` : ''}${p.injured ? ` +${p.injured} zr.` : ''}`).join('')}`);
  console.log(`  zábery: ${model.clips.map(c => `${c.captionSk}${c.direction ? ` [${c.direction}]` : ''}${c.sensitive ? ' (citlivé)' : ''}`).join(' | ') || '—'}`);
  console.log(`\nHÁČIK (karta): ${hook.tag} | ${hook.lines.join(' / ')}${hook.sub ? ` | ${hook.sub}` : ''}`);
  console.log('\nKOMENTÁR (titulok · záber):');
  for (const line of lines) console.log(`  [${line.shot}] ${line.caption}`);
  console.log('\nTEXT PRÍSPEVKU (Facebook):\n');
  console.log(frontDayPostText(model));
  process.exit(0);
}

const dbDir = path.dirname(String(env.FLIGHT_HISTORY_DB || path.join(root, '.gev-cache', 'flight-history.sqlite')));
const cache = createVoiceCache(path.join(dbDir, 'event-video', 'voice'));
const voiceCfg = aiTranslatorsConfig(env);
const voice = voiceCfg.token ? createAiTranslatorsClient(voiceCfg) : null;
if (!voice) console.log('[front-day] AI_TRANSLATORS_MCP_KEY nie je — len nahrávky z pamäte, bez kontroly výslovnosti');
const musicDir = env.EVENT_VIDEO_MUSIC_DIR || path.join(root, '.gev-cache', 'event-video-capture', 'music');
let music = null;
if (!args.includes('--no-music')) {
  try {
    const lib = JSON.parse(fs.readFileSync(path.join(musicDir, 'tracks.json'), 'utf8'));
    const t = lib.tracks[0];
    music = { ...t, file: path.join(musicDir, t.file) };
  } catch { console.log('[front-day] hudba: tracks.json nie je — video bez hudby'); }
}
const started = Date.now();
const workDir = path.resolve(flag('--out-dir', path.join(dbDir, 'front-day', new Date().toISOString().slice(0, 10))));
const sampleFrames = flag('--frames') ? flag('--frames').split(',').map(Number).filter(Number.isFinite) : null;
// `--scenario <súbor.json>`: správa mimo denného prehľadu ({ name, story, model, lines, hook, cameras, post }).
const scenario = flag('--scenario') ? JSON.parse(fs.readFileSync(path.resolve(flag('--scenario')), 'utf8')) : null;
let result;
try {
  result = await prepareFrontDayVideo({
    baseUrl, apiUrl, voice, cache, workDir, music, sampleFrames, scenario,
    capture: { node: process.execPath, baseUrl },
    tools: { ffmpeg: env.FFMPEG_PATH || 'ffmpeg' },
    onProgress: (stage, detail) => console.log(`[front-day] ${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s  ${stage} ${Object.keys(detail || {}).length ? JSON.stringify(detail) : ''}`),
  });
} catch (error) {
  // Kód 3: dnešné hlásenie ešte nie je — Štúdio skúsi znova neskôr (defaultFrontDayRunner).
  console.error(`[front-day] ${error.message}`);
  process.exit(error.code === 'NO_DATA' ? 3 : 1);
}
console.log(`[front-day] hotovo: ${(result.plan.durationS ?? 0).toFixed(1)} s, ${result.lines.length} viet, na vypočutie: ${result.review.length}`);
for (const r of result.review) console.log(`  !! ${r.line}: „${r.spoken}" — počuť: „${r.heard}"`);
for (const [k, f] of Object.entries(result.files)) console.log(`  ${k.padEnd(6)} ${f} (${fs.existsSync(f) ? fs.statSync(f).size : 0} B)`);
