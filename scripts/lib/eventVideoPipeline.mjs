// scripts/lib/eventVideoPipeline.mjs — jeden krok „priprav video k udalosti" (2026-10-03, vlastník: „ako by si
// to celé automatizoval… sprav"; „nemusím to robiť s tebou"). Bez agenta: z udalosti a scenára vlastníka
// (eventVideoScript.js) vznikne balík — video s komentárom hlasom vlastníka a titulkami, video bez titulkov,
// SRT. Kroky (stav hlási `onProgress`):
//   1 vety      eventNarration.narrationLines (dáta + scenár + pevné vety),
//   2 hlas      každá veta z vyrovnávacej pamäte nahrávok (podľa textu), inak ai-translators read_aloud
//               (hlas vlastníka) → WAV do pamäte; ticho a pauzy z ffmpeg silencedetect,
//   3 výslovnosť rozpoznávanie reči (ai-translators) proti titulku vety — nesúhlas → nová nahrávka (3×),
//               stále zle → veta na vypočutie (review), pevné vety (portál, podpis) sa nekontrolujú,
//   4 tempo     eventNarration.fitNarration → voľby plánu videa,
//   5 obraz     scripts/capture-event-video.mjs (Chrome s GPU, dlaždice ion) — udalosť zo súboru,
//   6 zvuk      eventVideoAudio: hudba zo slučky frázy, stlmenie pod hlasom, −16 LUFS,
//   7 titulky   eventCaptions: SRT + PNG titulkov (Chrome, písmo Inter) vpálené ffmpegom.
// Beží sekvenčne (jedna udalosť naraz), chyby zastavia krok s čitateľnou správou.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { narrationLines, fitNarration, narrationHeardMatches } from '../../src/data/eventNarration.js';
import { AUDIO_DEFAULTS, audioGraph, loudnormArgs, musicPlan, speechBounds } from '../../src/data/eventVideoAudio.js';
import { CAPTION_STYLE, captionBottom, captionCues, captionPageHtml, keepCaptionNumbers, overlayGraph, srt } from '../../src/data/eventCaptions.js';
import { hookCard } from '../../src/data/eventVideoScript.js';
import { VIDEO_3D_FORMAT } from '../../src/data/eventVideoHud.js';
import { videoPlan } from '../../src/data/eventVideo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
export const PIPELINE_DEFAULTS = Object.freeze({ voice: 'own', lang: 'sk', asrRetries: 2, captureTimeoutMs: 60 * 60_000 });

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const run = (cmd, args, { timeoutMs = 600_000 } = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
};

/** Vyrovnávacia pamäť nahrávok: `<dir>/<sha1(hlas|text)>.wav` + `.json` (text, prepis, schválenie). */
export function createVoiceCache(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const keyOf = (voice, text) => sha1(`${voice}|${text.trim()}`);
  const files = (key) => ({ wav: path.join(dir, `${key}.wav`), meta: path.join(dir, `${key}.json`) });
  return {
    dir,
    keyOf,
    get(voice, text) {
      const f = files(keyOf(voice, text));
      if (!fs.existsSync(f.wav)) return null;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(f.meta, 'utf8')); } catch { meta = {}; }
      return { wav: f.wav, meta };
    },
    put(voice, text, buf, meta = {}) {
      const f = files(keyOf(voice, text));
      fs.writeFileSync(f.wav, buf);
      fs.writeFileSync(f.meta, JSON.stringify({ voice, text, savedAt: new Date().toISOString(), ...meta }, null, 1));
      return { wav: f.wav, meta };
    },
    update(voice, text, patch) {
      const f = files(keyOf(voice, text));
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(f.meta, 'utf8')); } catch { meta = {}; }
      meta = { ...meta, ...patch };
      fs.writeFileSync(f.meta, JSON.stringify(meta, null, 1));
      return meta;
    },
    /** Uložená nahrávka zvonku (napr. schválená vlastníkom) pod daným textom. */
    seed(voice, text, wavPath, meta = {}) { return this.put(voice, text, fs.readFileSync(wavPath), { seededFrom: path.basename(wavPath), ...meta }); },
  };
}

/** Ticho na začiatku, koniec reči a pauzy v nahrávke (ffmpeg silencedetect). */
export function measureSpeech(wav, { ffmpeg = 'ffmpeg', ffprobe = 'ffprobe' } = {}) {
  const dur = Number(run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).stdout.trim());
  const log = run(ffmpeg, ['-hide_banner', '-nostats', '-i', wav, '-af', 'silencedetect=noise=-40dB:d=0.12', '-f', 'null', '-']).stderr;
  return { durationS: dur, ...speechBounds(log, dur) };
}

/** Podpísaný odkaz na nahrávku platí 24 h — na prepis sa posiela len mladší (inak nová nahrávka). */
export const VOICE_LINK_MAX_AGE_MS = 20 * 60 * 60_000;
const linkUsable = (meta, nowMs) => Boolean(meta?.url) && Number.isFinite(Date.parse(meta.savedAt || '')) && nowMs - Date.parse(meta.savedAt) < VOICE_LINK_MAX_AGE_MS;

/**
 * Kroky 2 + 3: nahrávka každej vety a kontrola výslovnosti.
 *   • nahrávka z pamäte (podľa textu), inak `voice.readAloud` → stiahnuť → do pamäte;
 *   • schválená alebo už overená nahrávka sa nekontroluje; bez služby sa použije, čo je v pamäti
 *     (predtým neúspešná kontrola = veta na vypočutie);
 *   • kontrola: prepis odkazu na nahrávku proti titulku vety; nahrávka, ktorá už raz neprešla, alebo ktorej
 *     odkaz je starý (podpis 24 h), sa nahráva znova namiesto prepisu; po `asrRetries` výmenách ostáva
 *     posledná nahrávka a veta ide na vypočutie.
 * @param {object} p
 * @param {ReturnType<typeof import('../../src/data/eventNarration.js').narrationLines>} p.lines
 * @param {{readAloud: Function, transcribe: Function}|null} p.voice
 * @param {ReturnType<typeof createVoiceCache>} p.cache
 * @param {(wav: string) => {lead: number, speechEnd: number, pauses: Array}} p.measure
 * @param {typeof fetch} [p.fetchImpl]
 * @param {object} [p.options] PIPELINE_DEFAULTS
 * @param {(stage: string, detail?: object) => void} [p.onProgress]
 * @param {() => number} [p.now]
 * @returns {Promise<{durations: object, bounds: object, voiceFiles: object, review: Array}>}
 */
export async function prepareVoice({ lines, voice = null, cache, measure, fetchImpl = (...a) => globalThis.fetch(...a), options = {}, onProgress = () => {}, now = () => Date.now() }) {
  const o = { ...PIPELINE_DEFAULTS, ...options };
  const durations = {};
  const bounds = {};
  const voiceFiles = {};
  const review = [];
  const record = async (line, attempt) => {
    if (!voice) throw Object.assign(new Error(`chýba nahrávka vety „${line.spoken}" a hlas nie je nastavený (AI_TRANSLATORS_MCP_KEY)`), { code: 'NO_VOICE', line: line.id });
    onProgress('voice', { line: line.id, attempt });
    const r = await voice.readAloud(line.spoken, { voice: o.voice, lang: o.lang });
    const res = await fetchImpl(r.url);
    if (!res.ok) throw Object.assign(new Error(`stiahnutie hlasu zlyhalo: HTTP ${res.status}`), { code: 'VOICE_DOWNLOAD' });
    // predošlú nahrávku tej istej vety prepíše nová (put) — pamäť drží poslednú
    return cache.put(o.voice, line.spoken, Buffer.from(await res.arrayBuffer()), { url: r.url, seconds: r.seconds, engine: r.engine, caption: line.caption, savedAt: new Date(now()).toISOString() });
  };
  for (const line of lines) {
    let hit = cache.get(o.voice, line.spoken);
    let swaps = 0; // koľkokrát sa nahrávka vymenila za novú
    while (true) {
      if (!hit) hit = await record(line, swaps + 1);
      if (line.approved || hit.meta.approved || hit.meta.heardOk === true) break;
      if (hit.meta.heardOk === false && typeof hit.meta.heard === 'string') {
        // Zvuk je ten istý, pravidlá porovnania sa však mohli zmeniť (nový zvyk rozpoznávača, napr. „km štvorcových")
        // — uložený prepis sa posúdi znova, kým sa nahrávka zahodí.
        if (narrationHeardMatches(line.caption, hit.meta.heard, { names: line.names === true }).ok) {
          hit.meta = cache.update(o.voice, line.spoken, { heardOk: true, checkedAt: new Date(now()).toISOString() });
          break;
        }
      }
      if (!voice) {
        // bez služby sa kontrola nedá urobiť — nahrávka z pamäte sa použije
        if (hit.meta.heardOk === false) review.push({ line: line.id, spoken: line.spoken, heard: hit.meta.heard ?? null });
        break;
      }
      if (hit.meta.heardOk === false || !linkUsable(hit.meta, now())) {
        // už raz neprešla (rovnaký zvuk = rovnaký výsledok) alebo odkaz vypršal — namiesto prepisu nová nahrávka
        if (hit.meta.heardOk === false && swaps >= o.asrRetries) { review.push({ line: line.id, spoken: line.spoken, heard: hit.meta.heard ?? null }); break; }
        swaps += 1;
        hit = await record(line, swaps + 1);
      }
      onProgress('asr', { line: line.id, attempt: swaps + 1 });
      const heard = await voice.transcribe(hit.meta.url, { lang: o.lang });
      const check = narrationHeardMatches(line.caption, heard, { names: line.names === true });
      hit.meta = cache.update(o.voice, line.spoken, { heard, heardOk: check.ok, checkedAt: new Date(now()).toISOString() });
      if (check.ok) break;
      if (swaps >= o.asrRetries) { review.push({ line: line.id, spoken: line.spoken, heard, missing: check.missing, extra: check.extra }); break; }
      swaps += 1;
      hit = await record(line, swaps + 1);
    }
    const m = measure(hit.wav);
    durations[line.id] = { lead: m.lead, speechEnd: m.speechEnd };
    bounds[line.id] = { pauses: m.pauses };
    voiceFiles[line.id] = hit.wav;
  }
  onProgress('voice-done', { review: review.length });
  return { durations, bounds, voiceFiles, review };
}

/**
 * @param {object} p
 * @param {object} p.event uložená udalosť (s `track`, `timeline`, `reported`)
 * @param {object|null} p.script eventVideoScript.normalizeVideoScript(...)
 * @param {{readAloud: Function, transcribe: Function}|null} p.voice klient hlasu (ai-translators) — null = len pamäť nahrávok
 * @param {ReturnType<typeof createVoiceCache>} p.cache
 * @param {string} p.workDir pracovný adresár (plán, obraz, zvuk, titulky, výstupy)
 * @param {{file: string, durationS: number, loop: {from: number, to: number}, credit: string}|null} p.music skladba
 * @param {{node?: string, baseUrl?: string}} [p.capture] ako spustiť nahrávanie obrazu
 * @param {(stage: string, detail?: object) => void} [p.onProgress]
 * @param {{ffmpeg?: string, ffprobe?: string, fetchImpl?: typeof fetch}} [p.tools]
 */
export async function prepareEventVideo({ event, script = null, voice = null, cache, workDir, music = null, capture = {}, onProgress = () => {}, tools = {}, options = {} }) {
  const o = { ...PIPELINE_DEFAULTS, ...options };
  const ffmpeg = tools.ffmpeg || process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = tools.ffprobe || process.env.FFPROBE_PATH || ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m, ext) => `ffprobe${ext || ''}`);
  const fetchImpl = tools.fetchImpl || ((...a) => globalThis.fetch(...a));
  fs.mkdirSync(workDir, { recursive: true });
  const progress = (stage, detail = {}) => onProgress(stage, detail);

  // 1. vety
  const lines = narrationLines(event, script);
  progress('lines', { count: lines.length });

  // 2. + 3. hlas a výslovnosť
  const { durations, bounds, voiceFiles, review } = await prepareVoice({
    lines, voice, cache, fetchImpl, options: o, onProgress: progress,
    measure: (wav) => measureSpeech(wav, { ffmpeg, ffprobe }),
  });

  // 4. tempo
  const fit = fitNarration(event, lines, durations);
  if (!fit) throw Object.assign(new Error('udalosť nemá stopu na video'), { code: 'NO_TRACK' });
  progress('fit', { durationS: fit.durationS, maxLag: fit.maxLag, converged: fit.converged });
  const planFile = path.join(workDir, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(fit.planOpts));
  const eventFile = path.join(workDir, 'event.json');
  fs.writeFileSync(eventFile, JSON.stringify(event));
  const hook = hookCard(script);
  const hookFile = path.join(workDir, 'hook.json');
  if (hook) fs.writeFileSync(hookFile, JSON.stringify(hook));
  const plan = videoPlan(event, fit.planOpts);
  const outro = plan.pieces.find((p) => p.phase === 'outro');
  const outroWindow = outro ? { from: outro.start, to: outro.start + outro.dur } : null;

  // 5. obraz
  const rawVideo = path.join(workDir, 'obraz.mp4');
  progress('capture', { frames: plan.totalFrames });
  await captureVideo({ event, eventFile, planFile, hookFile: hook ? hookFile : null, out: rawVideo, capture, ffmpeg, timeoutMs: o.captureTimeoutMs, onProgress: progress });

  // 6. zvuk
  progress('audio');
  const audioFile = path.join(workDir, 'zvuk.wav');
  mixAudio({ placement: fit.placement, voiceFiles, totalS: fit.durationS, music, out: audioFile, ffmpeg });

  // 7. titulky a výstupy
  progress('captions');
  const cues = captionCues(lines, fit.placement, bounds);
  const srtFile = path.join(workDir, `${event.id}.sk_SK.srt`);
  fs.writeFileSync(srtFile, srt(cues), 'utf8');
  const cleanFile = path.join(workDir, 'video.mp4');
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawVideo, '-i', audioFile, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', cleanFile]);
  const burnedFile = path.join(workDir, 'video-titulky.mp4');
  await burnCaptions({ cues, outroWindow, rawVideo, audioFile, out: burnedFile, workDir, ffmpeg });
  progress('done');
  return { lines, placement: fit.placement, planOpts: fit.planOpts, durationS: fit.durationS, review, cues, files: { clean: cleanFile, burned: burnedFile, srt: srtFile, audio: audioFile, raw: rawVideo } };
}

/**
 * Zhrnutie zlyhania nahrávania z výpisu skriptu: prvý riadok s chybou (napr. „Could not find Chrome …
 * cache path … systemprofile" — služba beží ako LocalSystem a puppeteer hľadá Chrome v systémovom profile,
 * liek je PUPPETEER_CACHE_DIR v .env) a posledný neprázdny riadok bez riadkov zásobníka. Pure.
 */
export function captureFailureSummary(output) {
  const lines = String(output || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('at '));
  const first = lines.find((l) => /^\w*Error\b/.test(l)) || lines.find((l) => /error|chyba|zlyhal|cannot|could not|not found/i.test(l)) || '';
  const last = lines.at(-1) || '';
  const parts = [...new Set([first, last].filter(Boolean))];
  return parts.join(' | ').slice(0, 600) || 'bez výpisu';
}

/** Nahrávanie obrazu skriptom capture-event-video.mjs (udalosť zo súboru, plán a háčik). */
export function captureVideo({ eventFile, planFile, hookFile, out, capture = {}, ffmpeg, timeoutMs, onProgress = () => {} }) {
  const node = capture.node || process.execPath;
  const script = capture.script || path.join(ROOT, 'scripts', 'capture-event-video.mjs');
  const args = [script, '--event-file', eventFile, '--no-upload', '--plan', planFile, '--out', out, ...(hookFile ? ['--hook', hookFile] : []), ...(capture.baseUrl ? ['--url', capture.baseUrl] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { cwd: ROOT, env: { ...process.env, FFMPEG_PATH: ffmpeg }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // Celý výpis nahrávania vedľa výstupu (obraz.mp4.log) — pod službou ho inak nikto nevidí.
    const logFile = `${out}.log`;
    try { fs.writeFileSync(logFile, `# ${new Date().toISOString()} ${node} ${args.join(' ')}\n`); } catch { /* bez záznamu */ }
    let tail = '';
    const onData = (d) => {
      try { fs.appendFileSync(logFile, String(d)); } catch { /* bez záznamu */ }
      tail = (tail + d).slice(-4000);
      const m = /\[event-video\] (\d+)\/(\d+)/g;
      let last = null;
      for (const x of String(d).matchAll(m)) last = x;
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

/** Hlas + hudba → WAV (−16 LUFS, dva prechody). */
export function mixAudio({ placement, voiceFiles, totalS, music, out, ffmpeg }) {
  const inputs = [];
  const placed = placement.filter((p) => voiceFiles[p.id]);
  for (const p of placed) inputs.push('-i', voiceFiles[p.id]);
  let plan = null;
  if (music) { inputs.push('-i', music.file); plan = musicPlan(music, totalS); }
  const graph = (tail) => audioGraph({ placement: placed, totalS, music: plan, tail });
  const p1 = run(ffmpeg, ['-hide_banner', '-nostats', ...inputs, '-filter_complex', graph(`;[mix]${loudnormArgs()}[o]`), '-map', '[o]', '-f', 'null', '-']);
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(p1.stderr);
  if (!m) throw Object.assign(new Error(`zvuk: meranie hlasitosti zlyhalo: ${p1.stderr.slice(-400)}`), { code: 'AUDIO_FAILED' });
  const measured = JSON.parse(m[0]);
  const p2 = run(ffmpeg, ['-hide_banner', '-nostats', '-y', ...inputs, '-filter_complex', graph(`;[mix]${loudnormArgs(measured)},aresample=48000[o]`), '-map', '[o]', '-c:a', 'pcm_s16le', '-ar', '48000', out]);
  if (p2.status !== 0) throw Object.assign(new Error(`zvuk: ${p2.stderr.slice(-400)}`), { code: 'AUDIO_FAILED' });
  return { measured, music: plan };
}

/** Titulky ako PNG (Chrome, písmo Inter) vpálené do videa so zvukom. */
export async function burnCaptions({ cues, outroWindow, rawVideo, audioFile, out, workDir, ffmpeg }) {
  const puppeteer = require('puppeteer');
  const { w: W, h: H } = VIDEO_3D_FORMAT;
  const dir = path.join(workDir, 'titulky');
  fs.mkdirSync(dir, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(captionPageHtml(W, H), { waitUntil: 'networkidle0' });
    await page.evaluate(async (px) => { await document.fonts.load(`600 ${px}px Inter`); await document.fonts.ready; }, CAPTION_STYLE.fontPx);
    if (!(await page.evaluate((px) => document.fonts.check(`600 ${px}px Inter`), CAPTION_STYLE.fontPx))) throw Object.assign(new Error('písmo Inter sa nenačítalo (titulky)'), { code: 'FONT' });
    for (const [i, c] of cues.entries()) {
      const bottom = captionBottom(c, outroWindow);
      await page.evaluate((text, b) => {
        const el = document.getElementById('cap');
        el.textContent = text;
        el.style.top = '0px';
        const h = el.getBoundingClientRect().height;
        el.style.top = `${b - h}px`;
      }, keepCaptionNumbers(c.text), bottom);
      c.file = path.join(dir, `t${String(i + 1).padStart(3, '0')}.png`);
      await page.screenshot({ path: c.file, omitBackground: true, type: 'png' });
    }
  } finally {
    await browser.close();
  }
  const g = overlayGraph(cues);
  const r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawVideo, '-i', audioFile, ...g.inputs, '-filter_complex', g.filter, '-map', `[${g.out}]`, '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-shortest', out], { timeoutMs: 30 * 60_000 });
  if (r.status !== 0) throw Object.assign(new Error(`titulky: ${r.stderr.slice(-400)}`), { code: 'BURN_FAILED' });
  return out;
}

export { AUDIO_DEFAULTS };
