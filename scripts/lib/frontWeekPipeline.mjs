// scripts/lib/frontWeekPipeline.mjs — jeden krok „priprav video Týždeň na fronte" (2026-10-03, vlastník: „vrátime
// sa k Ukrajine" → video; územie vo videu áno, zdroj sa volá okolive.sk („používaj zdroje okolive.sk, nie DeepState"), kritický voči agresorovi; „video v štýle OKO + Rybar"). Bez agenta:
//   1 čísla     frontWeekData.loadFrontWeek — hlásenia GŠ za 14 dní + dve snímky mapy frontu (model týždňa),
//   2 vety      frontWeekNarration.frontWeekLines + háčik úvodnej karty,
//   3 hlas      eventVideoPipeline.prepareVoice — pamäť nahrávok, hlas vlastníka, kontrola výslovnosti
//               (čísla prísne, vlastné mená s toleranciou),
//   4 plán      frontWeekVideo.frontWeekPlan — zábery trvajú toľko, čo ich vety,
//   5 obraz     scripts/capture-front-week.mjs (KARTA z OKO, žiadne dlaždice Google),
//   6 zvuk      eventVideoPipeline.mixAudio (hudba pod hlasom, −16 LUFS),
//   7 titulky   eventCaptions + eventVideoPipeline.burnCaptions (SRT + vpálené).
// Výstupy: video s titulkami, bez titulkov, SRT, text príspevku. Beží sekvenčne; chyby zastavia krok s čitateľnou správou.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captionCues, srt } from '../../src/data/eventCaptions.js';
import { MAP_SOURCE, directionSk, frontWeekHook, frontWeekLines, rangeLabel } from '../../src/data/frontWeekNarration.js';
import { insetOccupiedRings } from '../../src/data/frontWeekHud.js';
import { frontWeekPlan } from '../../src/data/frontWeekVideo.js';
import { burnCaptions, captureFailureSummary, measureSpeech, mixAudio, prepareVoice } from './eventVideoPipeline.mjs';
import { loadFrontWeek } from './frontWeekData.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (cmd, args) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} skončil kódom ${code}: ${err.trim().slice(-300)}`))));
});

/** Nahrávanie obrazu skriptom capture-front-week.mjs; výpis ide do `<out>.log`. */
export function captureFrontWeek({ jobFile, out, capture = {}, ffmpeg, timeoutMs = 60 * 60_000, onProgress = () => {} }) {
  const node = capture.node || process.execPath;
  const script = capture.script || path.join(ROOT, 'scripts', 'capture-front-week.mjs');
  const args = [script, '--job', jobFile, '--out', out, ...(capture.baseUrl ? ['--url', capture.baseUrl] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { cwd: ROOT, env: { ...process.env, FFMPEG_PATH: ffmpeg }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const logFile = `${out}.log`;
    try { fs.writeFileSync(logFile, `# ${new Date().toISOString()} ${node} ${args.join(' ')}\n`); } catch { /* bez záznamu */ }
    let tail = '';
    const onData = (d) => {
      try { fs.appendFileSync(logFile, String(d)); } catch { /* bez záznamu */ }
      tail = (tail + d).slice(-4000);
      let last = null;
      for (const x of String(d).matchAll(/\[front-week\] (\d+)\/(\d+)/g)) last = x;
      if (last) onProgress('capture', { frame: Number(last[1]), frames: Number(last[2]) });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error('nahrávanie obrazu trvá pridlho'), { code: 'CAPTURE_TIMEOUT' })); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(out)) resolve(out);
      else reject(Object.assign(new Error(`nahrávanie obrazu zlyhalo (kód ${code}): ${captureFailureSummary(tail)}`), { code: 'CAPTURE_FAILED' }));
    });
  });
}

/**
 * Text príspevku k videu: háčik, čísla týždňa, zdroje, odkaz na mapu frontu (vlastník: „vždy mi daj odkaz na
 * mapu frontu"). Zdroj mapy = okolive.sk (poskytovateľ dát vrstvy sa vo výstupoch nemenuje). Pure.
 */
export function frontWeekPostText(model) {
  const top = model.directions.filter((d) => d.week > 0).slice(0, 3);
  const lines = [];
  const hook = frontWeekHook(model);
  // Druhá časť háčika začína menom štátu — veľké písmeno ostáva.
  lines.push(`${hook.lines.join(' ')}${hook.sub ? ` — ${hook.sub}` : ''}.`);
  lines.push('');
  lines.push(`Týždeň na fronte (${rangeLabel(model.week.from, model.week.to)}):`);
  lines.push(`• ${String(model.total.week).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} bojových stretov podľa ukrajinského generálneho štábu`);
  if (top.length) lines.push(`• najviac ruských útokov: ${top.map((d) => `${directionSk(d.id).name} ${d.week}`).join(', ')}`);
  const weekly = Boolean(model.change?.weekly);
  if (weekly) lines.push(`• zmena územia ${rangeLabel(model.change.fromDay, model.change.toDay)}: Rusko obsadilo ${Math.round(model.change.ruKm2)} km², Ukrajina oslobodila ${Math.round(model.change.uaKm2)} km²`);
  lines.push('');
  lines.push(`${weekly ? `Zmena územia je vypočítaná z porovnania dvoch snímok mapy frontu na ${MAP_SOURCE.site} s odstupom 7 dní (mapa zachytáva stav s oneskorením 2–3 dni). ` : ''}Počty stretov sú z denných hlásení Generálneho štábu Ukrajiny — údaje jednej strany.`);
  lines.push('');
  lines.push('Mapa frontu deň po dni: https://okolive.sk/?front=front');
  lines.push('');
  // ArmyInform dovoľuje prevzatie s priamym odkazom — odkaz patrí do textu (video ho niesť nemôže).
  lines.push(`Zdroje: mapa frontu ${MAP_SOURCE.site} · hlásenia Generálneho štábu Ukrajiny cez ArmyInform (https://armyinform.com.ua) · podklad © OpenStreetMap`);
  return lines.join('\n');
}

/**
 * @param {object} p
 * @param {string} p.baseUrl služba OKO s dátami aj stránkou (http://localhost:4173)
 * @param {string} [p.archiveDir] archív hlásení (údery); bez neho model nesie len strety
 * @param {string} [p.refDay] posledný deň týždňa (predvolene posledné hlásenie)
 * @param {{readAloud: Function, transcribe: Function}|null} p.voice
 * @param {object} p.cache createVoiceCache(...)
 * @param {string} p.workDir
 * @param {object|null} [p.music]
 */
export async function prepareFrontWeekVideo({ baseUrl, archiveDir = null, refDay = null, voice = null, cache, workDir, music = null, capture = {}, tools = {}, onProgress = () => {}, options = {} }) {
  const ffmpeg = tools.ffmpeg || process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = tools.ffprobe || process.env.FFPROBE_PATH || ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m, ext) => `ffprobe${ext || ''}`);
  fs.mkdirSync(workDir, { recursive: true });

  // 1. čísla
  const { model: full, inputs } = await loadFrontWeek({ baseUrl, refDay, archiveDir, fetchImpl: tools.fetchImpl });
  const { raster, ...model } = full; // raster (typované polia) do úlohy nahrávania nejde
  onProgress('model', { week: model.week, total: model.total.week, change: model.change ? { ruKm2: model.change.ruKm2, uaKm2: model.change.uaKm2 } : null });

  // 2. vety a háčik
  const lines = frontWeekLines(model);
  const hook = frontWeekHook(model);
  onProgress('lines', { count: lines.length });

  // 3. hlas a výslovnosť
  const { durations, bounds, voiceFiles, review } = await prepareVoice({
    lines, voice, cache, fetchImpl: tools.fetchImpl, options, onProgress,
    measure: (wav) => measureSpeech(wav, { ffmpeg, ffprobe }),
  });

  // 4. plán
  const plan = frontWeekPlan(model, lines, durations);
  if (!plan) throw Object.assign(new Error('týždeň nemá vety na video'), { code: 'NO_LINES' });
  onProgress('fit', { durationS: plan.durationS, shots: plan.shots.map((s) => ({ id: s.id, dur: Math.round(s.dur * 10) / 10 })) });
  const jobFile = path.join(workDir, 'uloha.json');
  fs.writeFileSync(jobFile, JSON.stringify({ model, lines, durations, hook, occupied: insetOccupiedRings(inputs.snapshotNow), mapDay: inputs.snapshotNow?.day || null }));

  // 5. obraz
  const rawVideo = path.join(workDir, 'obraz.mp4');
  onProgress('capture', { frames: plan.totalFrames });
  await captureFrontWeek({ jobFile, out: rawVideo, capture, ffmpeg, onProgress });

  // 6. zvuk
  onProgress('audio');
  const audioFile = path.join(workDir, 'zvuk.wav');
  mixAudio({ placement: plan.placement, voiceFiles, totalS: plan.durationS, music, out: audioFile, ffmpeg });

  // 7. titulky a výstupy
  onProgress('captions');
  const cues = captionCues(lines, plan.placement, bounds);
  const name = `tyzden-na-fronte-${model.week.to}`;
  const srtFile = path.join(workDir, `${name}.sk_SK.srt`);
  fs.writeFileSync(srtFile, srt(cues), 'utf8');
  const cleanFile = path.join(workDir, `${name}.mp4`);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawVideo, '-i', audioFile, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', cleanFile]);
  const burnedFile = path.join(workDir, `${name}-titulky.mp4`);
  await burnCaptions({ cues, outroWindow: null, rawVideo, audioFile, out: burnedFile, workDir, ffmpeg });
  const postFile = path.join(workDir, `${name}.txt`);
  fs.writeFileSync(postFile, frontWeekPostText(model), 'utf8');
  onProgress('done');
  return { model, lines, hook, plan: { durationS: plan.durationS, shots: plan.shots, placement: plan.placement }, review, cues, files: { burned: burnedFile, clean: cleanFile, srt: srtFile, post: postFile, audio: audioFile, raw: rawVideo } };
}
