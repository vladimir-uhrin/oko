// OKO — „Týždeň v OKU" (2026-10-11): súhrn týždňa z overených faktov (src/data/weekVideo.js). Vstup = JSON
// s faktami týždňa (útoky s obeťami a ich zdroje, príspevky ДСНС a čísla fotiek, zábery ArmyInform, svet);
// zmena frontu a strety GŠ sa načítajú zo služby (loadFrontWeek). Dve nahrávania linkou denného videa v2
// (A: Ukrajina na KARTE, B: svet na reliéfe), potom jedno video: strih, jedna hudba stlmená pod hlasom, −16 LUFS.
//
//   node scripts/make-week-video.mjs --input vstup.json [--out-dir <dir>] [--api http://localhost:4175] [--dry]
//   node scripts/make-week-video.mjs --auto [--out-dir <dir>]   (2026-10-12: Štúdio každú nedeľu 5:00 — vstup zo
//     denných úloh, ДСНС, ArmyInform a USGS cez src/data/weekAuto.js; zapíše vstup.json vedľa videa)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { weekScenarios } from '../src/data/weekVideo.js';
import { aftermathPreviewUrl, postPhotos } from '../src/data/frontDayAftermath.js';
import { downloadClip, downloadImage } from './lib/frontDayClipRender.mjs';
import { loadFrontWeek } from './lib/frontWeekData.mjs';
import { mixAudio } from './lib/eventVideoPipeline.mjs';
import { pickTrack } from '../src/data/eventVideoAudio.js';
import { autoWeekInput, strikePost, weekClips, weekStrikes } from '../src/data/weekAuto.js';
import { locateUkText } from '../src/data/ukraineMedia.js';
import { quakeCountry, quakeOf, magnitudeWords, aftershocksOf } from '../src/data/quakeVideo.js';
import { shakemapOverlay, QUAKE_UA } from './lib/quakeAssets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const api = flag('--api', 'http://localhost:4175');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const log = (...a) => console.log('[week]', ...a);
const getJson = async (url, headers = {}) => { const r = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };

// 1. front za týždeň a strety GŠ zo služby (pri --auto posledný týždeň s hlásením)
const manual = flag('--input') ? JSON.parse(fs.readFileSync(path.resolve(flag('--input')), 'utf8')) : null;
if (!manual && !args.includes('--auto')) { console.error('[week] chýba --input <vstup.json> alebo --auto'); process.exit(2); }
const { model: weekModel } = await loadFrontWeek({ baseUrl: api, refDay: manual?.week.to || null, archiveDir: path.join(root, '.gev-cache', 'ukraine', 'events') });
const input = manual || await autoInput(weekModel.week);
const outDir = path.resolve(flag('--out-dir', path.join(root, '.gev-cache', 'videa', input.week.to, 'tyzden-v-oku')));
const media = path.join(outDir, 'zabery');
fs.mkdirSync(media, { recursive: true });
if (!manual) fs.writeFileSync(path.join(outDir, 'vstup.json'), JSON.stringify(input, null, 2));

/**
 * Vstup bez ručnej práce: útoky s obeťami a zábery z denných úloh (.auth-data/studio/front-day/<deň>/uloha.json),
 * príspevok ДСНС k mestu útoku (archív médií), najsilnejšie zemetrasenie týždňa (USGS, M ≥ 6,5) s mapou otrasov.
 */
async function autoInput(week) {
  const dayDir = path.join(root, '.auth-data', 'studio', 'front-day');
  const days = [];
  for (let t = Date.parse(`${week.from}T12:00:00Z`); t <= Date.parse(`${week.to}T12:00:00Z`) + 86_400_000; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    try { days.push({ day, model: JSON.parse(fs.readFileSync(path.join(dayDir, day, 'uloha.json'), 'utf8')).model }); } catch { /* deň bez videa */ }
  }
  const strikes = weekStrikes(days);
  let archive = [];
  try { archive = (await getJson(`${api}/api/ukraine/events?from=${week.from}&to=${new Date(Date.parse(`${week.to}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}`)).media || []; } catch (e) { log(`archív médií: ${e.message}`); }
  for (const s of strikes) {
    // Príspevok záchranárov do 2 dní po útoku z toho mesta (najnovší = najúplnejší obraz).
    const a = strikePost(archive, s, locateUkText);
    if (a) s.dsns = { post: a.post, pick: [...Array(Math.min(3, a.photos)).keys()] };
  }
  let quake = null;
  try {
    const from = Date.parse(`${week.from}T00:00:00Z`); const to = Date.parse(`${week.to}T23:59:59Z`) + 86_400_000;
    const feed = (await getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson', QUAKE_UA)).features;
    const top = feed.map(quakeOf).filter((q) => q.time >= from && q.time <= to && q.mag >= 6.5).sort((x, y) => y.mag - x.mag)[0];
    if (top) {
      const detail = await getJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${top.id}.geojson`, QUAKE_UA);
      const overlay = await shakemapOverlay(detail, outDirFor(week)).catch(() => null);
      const c = quakeCountry(top.place); const m = magnitudeWords(top.mag); const after = aftershocksOf(top, feed).length;
      const where = c ? c.acc : 'oblasť pri mieste ' + top.place;
      const tail = (k) => (after >= 5 ? `, nasledovalo ${k === 'spoken' ? 'vyše ' + (after >= 40 ? 'štyridsať' : after >= 20 ? 'dvadsať' : after >= 10 ? 'desať' : 'päť') : 'vyše ' + (after >= 40 ? 40 : after >= 20 ? 20 : after >= 10 ? 10 : 5)} dotrasov.` : '.');
      quake = {
        id: 'quake', line: { spoken: `Vo svete: zemetrasenie s magnitúdou ${m.spoken} zasiahlo ${where}${tail('spoken')}`, caption: `Vo svete: zemetrasenie s magnitúdou ${m.caption} zasiahlo ${where}${tail('caption')}` },
        spot: { tag: 'SVET · ZEMETRASENIE · USGS', value: Math.round(top.mag * 10) / 10, decimals: 1, unit: 'MAGNITÚDA', color: '#ff6b78', rows: [`${c ? c.nom : top.place} · hĺbka ${Math.round(top.depthKm)} km`, overlay ? 'mapa otrasov USGS ShakeMap' : 'Geologická služba USA'] },
        camera: { lon: top.lon, lat: top.lat + 0.9, heightM: 900_000, pitchDeg: -88, headingDeg: 0 },
        pins: [{ lon: top.lon, lat: top.lat, label: `EPICENTRUM · M ${m.caption}`, color: '#ff3b3b' }],
        ...(overlay ? { overlay } : {}),
        postText: `Vo svete: zemetrasenie s magnitúdou ${m.caption} (${top.place}, USGS). ${top.url || ''}`.trim(),
      };
    }
  } catch (e) { log(`zemetrasenie: ${e.message}`); }
  const result = autoWeekInput({ week, strikes, clips: weekClips(days), quake, musicId: 'km-lightless' });
  log(`auto: útoky ${strikes.map((s) => `${s.sk} ${s.killed} (${s.day}${s.dsns ? `, ДСНС ${s.dsns.post}` : ''})`).join(', ') || 'žiadne'}; zábery ${result.armyinform.length}; zemetrasenie ${quake ? 'áno' : 'nie'}`);
  return result;
}
function outDirFor(week) { return path.resolve(flag('--out-dir', path.join(root, '.gev-cache', 'videa', week.to, 'tyzden-v-oku'))); }
const change = weekModel.change ? { ...weekModel.change, directions: (weekModel.directions || []).filter((d) => d.ruKm2 >= 1 || d.uaKm2 >= 1)
  .map(({ id, ruKm2, uaKm2, ruAt, uaAt }) => ({ id, ruKm2, uaKm2, ruAt, uaAt })) } : null;
log(`front: +${change?.ruKm2 ?? '?'} km² (${change?.fromDay} → ${change?.toDay}), strety ${weekModel.total?.week}`);

// 2. zábery: fotky ДСНС čerstvé z náhľadu príspevku (vybrané poradia bez drastických), ArmyInform videá
for (const s of input.strikes) {
  s.photos = [];
  for (const { post, pick } of s.dsns || []) {
    const p = { channel: 'dsns_telegram', postId: post };
    const html = await (await fetch(aftermathPreviewUrl(p), { headers: { 'user-agent': 'Mozilla/5.0 (OKO)' }, signal: AbortSignal.timeout(30_000) })).text();
    const urls = postPhotos(html, p);
    for (const k of pick) if (urls[k]) s.photos.push(await downloadImage(urls[k], path.join(media, `dsns-${post}-${k}.jpg`)));
  }
  log(`${s.name}: fotiek ${s.photos.length}`);
}
// Fotka pod háčik (prvé sekundy).
if (input.hookPhoto) {
  const p = { channel: 'dsns_telegram', postId: input.hookPhoto.post };
  const html = await (await fetch(aftermathPreviewUrl(p), { headers: { 'user-agent': 'Mozilla/5.0 (OKO)' }, signal: AbortSignal.timeout(30_000) })).text();
  const url = postPhotos(html, p)[input.hookPhoto.pick];
  if (url) input.hookPhoto.file = await downloadImage(url, path.join(media, `hacik-${input.hookPhoto.post}.jpg`));
}
const clips = [];
for (const [i, c] of (input.armyinform || []).entries()) {
  try { clips.push({ file: await downloadClip(c.url, path.join(media, `armyinform-${i}.mp4`)), caption: c.caption }); } catch (e) { log(`ArmyInform ${i}: ${e.message}`); }
}

// 3. hudba: jedna skladba cez celé video (autor na koncovej karte)
const musicDir = process.env.EVENT_VIDEO_MUSIC_DIR || path.join(root, '.gev-cache', 'event-video-capture', 'music');
const lib = JSON.parse(fs.readFileSync(path.join(musicDir, 'tracks.json'), 'utf8')).tracks.map((t) => ({ ...t, file: path.join(musicDir, t.file) }));
const track = input.musicId ? lib.find((t) => t.id === input.musicId) : pickTrack(lib, { story: 'strike', day: input.week.to });
const musicCredit = /CC BY/i.test(String(track?.license || '')) ? track.credit : null;

const { a, b, post } = weekScenarios({ ...input, front: { change, clashes: weekModel.total?.week }, clips, musicCredit });
for (const [k, s] of [['a', a], ['b', b]]) fs.writeFileSync(path.join(outDir, `scenar-${k}.json`), JSON.stringify(s, null, 2));
fs.writeFileSync(path.join(outDir, 'tyzden-v-oku.txt'), `${post}${musicCredit ? `\n\n${musicCredit}` : ''}`, 'utf8');
log(`vety A: ${a.lines.map((l) => l.id).join(', ')} | B: ${b.lines.map((l) => l.id).join(', ')}`);
if (args.includes('--dry')) process.exit(0);

// 4. dve nahrávania (bez hudby — tá ide raz cez celé video)
const parts = [];
for (const [k, s] of [['a', a], ['b', b]]) {
  const dir = path.join(outDir, `cast-${k}`);
  if (!args.includes('--reuse') || !fs.existsSync(path.join(dir, `${s.name}-titulky.mp4`))) {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'make-front-day-video.mjs'), '--scenario', path.join(outDir, `scenar-${k}.json`), '--out-dir', dir, '--style', 'v2', '--no-music'], { stdio: 'inherit', cwd: root });
    if (r.status !== 0) { log(`časť ${k} zlyhala (${r.status})`); process.exit(1); }
  }
  parts.push(path.join(dir, `${s.name}-titulky.mp4`));
}

// 5. spojenie + hudba stlmená pod hlasom a efektmi (sidechain), −16 LUFS
const joined = path.join(outDir, 'spojene.mkv'); // MKV: bezstratový PCM zvuk do miešania (MP4 ho nedovolí)
const run = (argv) => { const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr.slice(-400)); };
run([...parts.flatMap((p) => ['-i', p]), '-filter_complex', `${parts.map((_, i) => `[${i}:v][${i}:a]`).join('')}concat=n=${parts.length}:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', joined]);
const voiceWav = path.join(outDir, 'hlas-a-efekty.wav');
run(['-i', joined, '-vn', '-ac', '1', '-ar', '48000', voiceWav]);
const totalS = Number(spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', joined], { encoding: 'utf8' }).stdout);
const audio = path.join(outDir, 'zvuk.wav');
mixAudio({ placement: [{ id: 'all', start: 0 }], voiceFiles: { all: voiceWav }, totalS, music: track, out: audio, ffmpeg });
const final = path.join(outDir, `tyzden-v-oku-${input.week.to}.mp4`);
run(['-i', joined, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final]);
log(`hotovo: ${final} (${totalS.toFixed(1)} s)`);
