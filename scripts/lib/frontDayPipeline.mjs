// scripts/lib/frontDayPipeline.mjs — jeden krok „priprav denné video Deň na fronte" (2026-10-05). Bez agenta:
//   1 dáta      frontDayData.loadFrontDay — ranné hlásenie GŠ, zmena mapy za deň, nočná hrozba, akčné zábery,
//   2 vety      frontDayNarration — háčik a komentár (agentúrny štýl, kritický a presný),
//   3 hlas      eventVideoPipeline.prepareVoice — hlas vlastníka, pamäť nahrávok, kontrola výslovnosti,
//   4 plán      frontDayVideo.frontDayPlan — 9:16, zábery trvajú toľko, čo ich vety,
//   5 zábery    frontDayClipRender — video ArmyInform → najdynamickejšie okno v ráme OKO,
//   6 obraz     scripts/capture-front-day.mjs (KARTA z OKO, zmena za deň; miesta záberov čierne),
//   7 vloženie  zábery na ich miesto v čase,
//   8 zvuk      eventVideoPipeline.mixAudio (hudba pod hlasom, −16 LUFS),
//   9 titulky   eventCaptions + burnCaptions (9:16, väčšie písmo) + SRT, text príspevku pre Facebook.
// Záber, ktorý sa nepodarí stiahnuť, z videa vypadne (aj jeho veta) — video sa nezastaví.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captionCues, srt } from '../../src/data/eventCaptions.js';
import { dayStory, frontDayHook, frontDayLines, frontDayPostText } from '../../src/data/frontDayNarration.js';
import { frontDayPlan, strikeCamera, FRONT_DAY_FORMAT, FRONT_DAY_VIDEO_V2 } from '../../src/data/frontDayVideo.js';
import { DAY_CAPTION_STYLE } from '../../src/data/frontDayHud.js';
import { burnCaptions, captureFailureSummary, measureSpeech, mixAudio, prepareVoice } from './eventVideoPipeline.mjs';
import { loadFrontDay } from './frontDayData.mjs';
import { pickTrack } from '../../src/data/eventVideoAudio.js';
import { buildMotionSvg, motionEvents, wordCues } from '../../src/data/frontDayMotion.js';
import { MAP_SOURCE } from '../../src/data/frontWeekNarration.js';
import { inlineLogoMarkup } from '../../src/data/eventVideoHud.js';
import { composeV2, ensureSfx, mixSfx, renderMotionTrack, speedVoice } from './frontDayMotionRender.mjs';

/** Tempo hlasu vo videu v2. */
export const V2_VOICE_TEMPO = 1.1;
import { clipUsable, downloadClip, downloadImage, overlayClips, photoMontageVideo, photoZoomVideo, probeClip, renderClipSegment } from './frontDayClipRender.mjs';
import { aftermathClip, aftermathPreviewUrl, postPhotos } from '../../src/data/frontDayAftermath.js';

/** Akčné zábery vo videu (vlastník: „max 2–3 krátke"); kandidátov z dát je viac, nepoužiteľné vypadnú. */
export /** Fotky záchranárov v jednom zábere (strih ~1,2 s). */
const AFTERMATH_PHOTOS = 3;
const FRONT_DAY_CLIPS = 2;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (cmd, args) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} skončil kódom ${code}: ${err.trim().slice(-300)}`))));
});

/** Nahrávanie obrazu skriptom capture-front-day.mjs; výpis do `<out>.log`, priebeh cez `[front-day] N/M`. */
export function captureFrontDay({ jobFile, out, capture = {}, ffmpeg, timeoutMs = 60 * 60_000, onProgress = () => {}, frames = null, framesDir = null }) {
  const node = capture.node || process.execPath;
  const script = capture.script || path.join(ROOT, 'scripts', 'capture-front-day.mjs');
  const args = [script, '--job', jobFile, '--out', out, ...(capture.baseUrl ? ['--url', capture.baseUrl] : []),
    ...(frames ? ['--frames', frames.join(','), '--frames-dir', framesDir || path.dirname(out)] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { cwd: ROOT, env: { ...process.env, FFMPEG_PATH: ffmpeg }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const logFile = `${out}.log`;
    try { fs.writeFileSync(logFile, `# ${new Date().toISOString()} ${node} ${args.join(' ')}\n`); } catch { /* */ }
    let tail = '';
    const onData = (d) => {
      try { fs.appendFileSync(logFile, String(d)); } catch { /* */ }
      tail = (tail + d).slice(-4000);
      let last = null;
      for (const x of String(d).matchAll(/\[front-day\] (\d+)\/(\d+)/g)) last = x;
      if (last) onProgress('capture', { frame: Number(last[1]), frames: Number(last[2]) });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error('nahrávanie obrazu trvá pridlho'), { code: 'CAPTURE_TIMEOUT' })); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && (frames || fs.existsSync(out))) resolve(out);
      else reject(Object.assign(new Error(`nahrávanie obrazu zlyhalo (kód ${code}): ${captureFailureSummary(tail)}`), { code: 'CAPTURE_FAILED' }));
    });
  });
}

/**
 * Dni snímok mapy, ktoré už použili predošlé denné videá: úlohy (`uloha.json`) v súrodeneckých priečinkoch
 * `<YYYY-MM-DD>` starších než tento beh (Štúdio píše do front-day/<deň>). Bez priečinkov = prázdne.
 */
export function usedChangeDays(parentDir, currentName = '') {
  const out = new Set();
  let names = [];
  try { names = fs.readdirSync(parentDir); } catch { return []; }
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name) || (currentName && name >= currentName)) continue;
    try {
      const job = JSON.parse(fs.readFileSync(path.join(parentDir, name, 'uloha.json'), 'utf8'));
      if (job?.model?.change?.toDay) out.add(job.model.change.toDay);
    } catch { /* bez úlohy */ }
  }
  return [...out];
}

/** Smer príbehu dňa pre úvodnú kartu (kde sa mapa pohla). Pure. */
export function focusSceneOf(model) {
  const story = dayStory(model);
  const d = model.change?.directions?.find((x) => (story === 'ua' ? x.uaKm2 : x.ruKm2) >= 1);
  return d?.id || null;
}

/**
 * @param {object} p
 * @param {string} p.baseUrl služba OKO so stránkou aj dátami (http://localhost:4173)
 * @param {{readAloud: Function, transcribe: Function}|null} p.voice
 * @param {object} p.cache createVoiceCache(...)
 * @param {string} p.workDir
 * @param {object|null} [p.music]
 * @param {number[]|null} [p.sampleFrames] len vzorové snímky (kontrola rozloženia), bez videa
 */
export async function prepareFrontDayVideo({ baseUrl, apiUrl = baseUrl, voice = null, cache, workDir, music = null, capture = {}, tools = {}, onProgress = () => {}, options = {}, now = Date.now(), sampleFrames = null, scenario = null, style = 'v1' }) {
  // `style: 'v2'` (2026-10-10): akčný záber hneď po háčiku, zrýchlený hlas, strih každé 2–3 s, záber na celú
  // obrazovku, grafika ako vrstva (frontDayMotion: háčik, veľké čísla, titulky po slovách) a zvukové efekty.
  const v2 = style === 'v2';
  const ffmpeg = tools.ffmpeg || process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = tools.ffprobe || process.env.FFPROBE_PATH || ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m, ext) => `ffprobe${ext || ''}`);
  fs.mkdirSync(workDir, { recursive: true });

  // 1. dáta — alebo hotový scenár (správa mimo denného prehľadu, napr. tanker pri Soči, 2026-10-07):
  // { model, lines, hook, story, cameras, post, name } — rovnaký rám OKO, hlas, titulky a mapa.
  let model; let reason = null;
  if (scenario) model = { clips: [], ...scenario.model };
  else ({ model, reason } = await loadFrontDay({ baseUrl: apiUrl, now, fetchImpl: tools.fetchImpl, usedToDays: usedChangeDays(path.dirname(workDir), path.basename(workDir)) }));
  if (!model) throw Object.assign(new Error(`denné video sa dnes nerobí: ${reason}`), { code: 'NO_DATA', reason });
  onProgress('model', { day: model.day, story: scenario ? scenario.story : dayStory(model), clashes: model.report?.total ?? null, clips: model.clips.length });

  // 5a. zábery (pred hlasom: záber, ktorý sa nestiahne alebo je na výšku — rozhovor —, vypadne aj so svojou
  // vetou a nastúpi ďalší kandidát; vo videu najviac FRONT_DAY_CLIPS)
  const clipSources = [];
  for (const [i, clip] of model.clips.entries()) {
    if (clipSources.length >= FRONT_DAY_CLIPS) break;
    const src = path.join(workDir, `zaber-${i}-zdroj.mp4`);
    try {
      await downloadClip(clip.videoUrl, src, { fetchImpl: tools.fetchImpl });
      const probe = await probeClip(src, { ffmpeg });
      if (!clipUsable(probe)) { onProgress('clip-skip', { i, reason: `na výšku ${probe.width}×${probe.height}` }); continue; }
      clipSources.push({ clip, src, probe });
    } catch (e) { onProgress('clip-skip', { i, error: e.message }); }
  }
  model.clips = clipSources.map((c) => c.clip);
  // Fotky zo scenára (napr. satelit Copernicus nad Soči) sú zábery `clip:<i>` s priblížením k bodu;
  // video sa vyrobí až s dĺžkou záberu (5b).
  for (const photo of scenario?.photos || []) {
    const clip = { captionSk: photo.caption, kicker: photo.kicker, header: scenario.model?.header, placeName: photo.placeName || '',
      sourceLines: photo.sourceLines || [], sources: scenario.model?.sources, inset: false, fixedStart: 0, keepCaptions: true };
    clipSources.push({ clip, photo });
    model.clips.push(clip);
  }

  // Ruský útok s obeťami (príbeh útoku aj veta v bežnom dni): fotky záchranárov z toho mesta (ДСНС). Odkazy z archívu po čase vypršia → čerstvé
  // z náhľadu príspevku; najviac AFTERMATH_PHOTOS fotiek. Nič sa nestiahne → video bez nich.
  if (!scenario && model.aftermath && model.casualties?.places?.length) {
    try {
      const fetchImpl = tools.fetchImpl || globalThis.fetch;
      const res = await fetchImpl(aftermathPreviewUrl(model.aftermath), { headers: { 'user-agent': 'Mozilla/5.0 (OKO)' }, signal: AbortSignal.timeout(30_000) });
      const urls = res.ok ? postPhotos(await res.text(), model.aftermath) : [];
      const images = [];
      for (const [k, url] of urls.entries()) {
        if (images.length >= AFTERMATH_PHOTOS) break;
        try { images.push(await downloadImage(url, path.join(workDir, `zachranari-${k}.jpg`), { fetchImpl })); } catch (e) { onProgress('aftermath-skip', { k, error: e.message }); }
      }
      if (images.length) {
        const clip = aftermathClip(model.aftermath);
        clipSources[model.clips.length] = { clip, images };
        model.clips.push(clip);
        onProgress('aftermath', { url: model.aftermath.url, photos: images.length });
      } else onProgress('aftermath-skip', { url: model.aftermath.url, error: res.ok ? 'príspevok bez fotiek' : `HTTP ${res.status}` });
    } catch (e) { onProgress('aftermath-skip', { url: model.aftermath.url, error: e.message }); }
  }

  // 2. vety a háčik
  const lines = scenario ? scenario.lines : frontDayLines(model);
  // v2: prvý akčný záber hneď po háčiku — vizuálny vrchol v prvých sekundách, nie až v polovici.
  if (v2 && !scenario) {
    const ci = lines.findIndex((l) => l.id === 'clip0');
    if (ci > 1) { const [c] = lines.splice(ci, 1); lines.splice(1, 0, c); }
    // Krátky záver (koncová karta 2 s): „údaje jednej strany" a zdroje nesie karta, nie hlas.
    const portal = lines.find((l) => l.id === 'portal');
    if (portal) Object.assign(portal, { spoken: `Mapa frontu denne na ${MAP_SOURCE.spokenSite}.`, caption: `Mapa frontu denne na ${MAP_SOURCE.site}.` });
  }
  const hook = scenario ? scenario.hook : frontDayHook(model);
  const story = scenario ? scenario.story || 'spot' : dayStory(model);
  const focusSceneId = scenario ? null : focusSceneOf(model);
  // Záber útoku letí na miesto s obeťami (strikeCamera), nie na celú Ukrajinu.
  const strikeCam = scenario ? null : strikeCamera(model.casualties);
  const cameras = scenario?.cameras || (strikeCam ? { strike: strikeCam } : null);
  onProgress('lines', { count: lines.length });

  // 3. hlas
  const measure = (wav) => measureSpeech(wav, { ffmpeg, ffprobe });
  let { durations, bounds, voiceFiles, review } = await prepareVoice({
    lines, voice, cache, fetchImpl: tools.fetchImpl, options, onProgress, measure,
  });
  // v2: hlas o desatinu rýchlejší (energia, dopozeranie); časy reči sa zmerajú znova.
  if (v2) ({ durations, bounds, voiceFiles } = speedVoice({ voiceFiles, factor: V2_VOICE_TEMPO, workDir: path.join(workDir, 'hlas'), measure, ffmpeg }));

  // 4. plán
  const planOpts = v2 ? FRONT_DAY_VIDEO_V2 : undefined;
  const plan = frontDayPlan({ story, focusSceneId, cameras }, lines, durations, planOpts || {});
  if (!plan) throw Object.assign(new Error('deň nemá vety na video'), { code: 'NO_LINES' });
  onProgress('fit', { durationS: Math.round(plan.durationS * 10) / 10, shots: plan.shots.map((s) => ({ id: s.id, dur: Math.round(s.dur * 10) / 10 })) });
  const jobFile = path.join(workDir, 'uloha.json');
  fs.writeFileSync(jobFile, JSON.stringify({ model, lines, durations, hook, story, focusSceneId, cameras, style, planOpts, mapDay: model.change?.mapDay || null, changeDays: model.change?.spanDays || 1 }));

  if (sampleFrames) {
    await captureFrontDay({ jobFile, out: path.join(workDir, 'vzorky.mp4'), capture, ffmpeg, onProgress, frames: sampleFrames, framesDir: workDir });
    return { model, lines, hook, plan, review, files: { job: jobFile } };
  }

  // 5b. zábery do rámu
  const segments = [];
  for (const shot of plan.shots.filter((s) => s.kind === 'clip')) {
    const source = clipSources[shot.clipIndex];
    if (!source) continue;
    if (source.images) {
      source.src = await photoMontageVideo({ images: source.images, out: path.join(workDir, `fotky-${shot.clipIndex}.mp4`), dur: shot.dur + 0.2, ffmpeg });
      source.probe = { total: shot.dur + 0.2, frames: [] };
    }
    if (source.photo) {
      source.src = await photoZoomVideo({ ...source.photo, image: path.resolve(source.photo.image) }, { out: path.join(workDir, `fotka-${shot.clipIndex}.mp4`), dur: shot.dur + 0.2, ffmpeg });
      source.probe = { total: shot.dur + 0.2, frames: [] };
    }
    const seg = await renderClipSegment({ src: source.src, out: path.join(workDir, `zaber-${shot.clipIndex}.mp4`), dur: shot.dur, clip: source.clip, day: model.day, ffmpeg, probe: source.probe, layout: source.images || (v2 && !source.photo) ? 'full' : 'box' });
    segments.push({ file: seg.file, start: shot.start, dur: shot.dur });
    onProgress('clip', { i: shot.clipIndex, window: seg.start, cuts: seg.cuts });
  }

  // 6. obraz
  const rawMap = path.join(workDir, 'obraz-mapa.mp4');
  onProgress('capture', { frames: plan.totalFrames });
  await captureFrontDay({ jobFile, out: rawMap, capture, ffmpeg, onProgress });

  // 7. vloženie záberov
  const rawVideo = path.join(workDir, 'obraz.mp4');
  await overlayClips({ rawVideo: rawMap, segments, out: rawVideo, ffmpeg });

  // 8. zvuk
  onProgress('audio');
  const audioFile = path.join(workDir, 'zvuk.wav');
  // Knižnica skladieb → jedna podľa nálady príbehu, striedanie po dňoch.
  const track = music?.library ? pickTrack(music.library, { story, day: model.day }) : music;
  // Skladba s licenciou CC BY: autor na koncovej karte (grafika v2) aj v texte príspevku.
  const musicCredit = track && /CC BY/i.test(String(track.license || '')) ? track.credit || `Hudba: ${track.author}, ${track.license}` : null;
  if (musicCredit) model.musicCredit = musicCredit;
  if (track) onProgress('music', { id: track.id || null });
  mixAudio({ placement: plan.placement, voiceFiles, totalS: plan.durationS, music: track, out: audioFile, ffmpeg });

  // 9. titulky a výstupy
  onProgress('captions');
  // Pri akčnom zábere je veta už veľkým popisom nad videom — titulok by ju zdvojil a prekryl zdroj záberu.
  // Fotka zo scenára titulky má (jej popis je len štítok miesta, veta hlasu je iná).
  const clipLine = (l) => { const m = /^clip:(\d+)$/.exec(String(l.shot)); return m && !model.clips[Number(m[1])]?.keepCaptions; };
  const cues = captionCues(lines.filter((l) => !clipLine(l)), plan.placement, bounds, DAY_CAPTION_STYLE);
  const name = scenario?.name || `den-na-fronte-${model.day}`;
  const srtFile = path.join(workDir, `${name}.sk_SK.srt`);
  fs.writeFileSync(srtFile, srt(cues), 'utf8');
  const cleanFile = path.join(workDir, `${name}.mp4`);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawVideo, '-i', audioFile, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', cleanFile]);
  const burnedFile = path.join(workDir, `${name}-titulky.mp4`);
  if (v2) {
    // Grafika ako priehľadná vrstva + zvukové efekty pri strihoch, potom zloženie.
    const logoMarkup = inlineLogoMarkup(fs.readFileSync(path.join(ROOT, 'public', 'logo.svg'), 'utf8'));
    const wcues = wordCues(lines, plan.placement);
    const motionFile = path.join(workDir, 'grafika.mov');
    await renderMotionTrack({ svgAt: (t) => buildMotionSvg({ t, shots: plan.shots, lines, placement: plan.placement, cues: wcues, model, hook, logoMarkup }),
      totalFrames: plan.totalFrames, fps: plan.fps, out: motionFile, ffmpeg, onProgress });
    const sfx = ensureSfx(path.join(ROOT, '.gev-cache', 'event-video-capture', 'sfx'), ffmpeg);
    const audioSfx = path.join(workDir, 'zvuk-efekty.wav');
    mixSfx({ audioIn: audioFile, events: motionEvents(plan.shots, plan.placement), sfx, out: audioSfx, ffmpeg });
    composeV2({ rawVideo, motion: motionFile, audio: audioSfx, out: burnedFile, ffmpeg });
  } else {
    await burnCaptions({ cues, outroWindow: null, rawVideo, audioFile, out: burnedFile, workDir, ffmpeg, format: FRONT_DAY_FORMAT, style: DAY_CAPTION_STYLE });
  }
  const postFile = path.join(workDir, `${name}.txt`);
  fs.writeFileSync(postFile, `${scenario ? scenario.post : frontDayPostText(model)}${musicCredit ? `\n\n${musicCredit}` : ''}`, 'utf8');
  onProgress('done');
  return { model, lines, hook, plan: { durationS: plan.durationS, shots: plan.shots, placement: plan.placement }, review, cues, files: { burned: burnedFile, clean: cleanFile, srt: srtFile, post: postFile, audio: audioFile, raw: rawVideo } };
}
