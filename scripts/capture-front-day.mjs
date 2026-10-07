// OKO — obraz denného videa „Deň na fronte" (2026-10-05), natívne 9:16. Rovnaké nahrávanie ako Týždeň na fronte
// (scripts/capture-front-week.mjs: Chrome s GPU otvorí OKO z dev servera, KARTA frontu z OKO — reliéf, sídla,
// okupované územie, sivá zóna, šípky a blesky z hlásenia GŠ; žiadne dlaždice Google), ale:
//   - formát 1080×1920 a denné popisy (src/data/frontDayHud.js), plán src/data/frontDayVideo.js,
//   - zmena územia na mape za skutočný odstup snímok dňa (`changeDays`, nie týždeň),
//   - zábery 'clip:<i>' sa nenahrávajú (čierna snímka) — linka na ich miesto vloží akčný záber ArmyInform.
//
//   node scripts/capture-front-day.mjs --job <úloha.json> --out <mp4> [--url http://localhost:4173]
//     [--frames 0,150,300 [--frames-dir <adresár>]]
// `--job`: { model, lines, durations, hook, story, focusSceneId, mapDay, changeDays } — pripraví frontDayPipeline.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { inlineLogoMarkup } from '../src/data/eventVideoHud.js';
import { VIDEO_3D_ENCODE, ffmpegArgs } from '../src/data/eventVideoRender.js';
import { buildFrontDayHudSvg, dayAnchorPoints } from '../src/data/frontDayHud.js';
import { FRONT_DAY_FORMAT, frontDayPlan } from '../src/data/frontDayVideo.js';
import { blockPageReloads, shootWithRecovery } from './lib/captureGuards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const jobFile = flag('--job');
if (!jobFile) { console.error('[front-day] chýba --job <úloha.json>'); process.exit(2); }
const job = JSON.parse(fs.readFileSync(path.resolve(jobFile), 'utf8'));
const baseUrl = flag('--url', 'http://localhost:4173').replace(/\/+$/, '');
const out = path.resolve(flag('--out', path.join(root, '.gev-cache', 'front-day', 'obraz.mp4')));
const sampleFrames = flag('--frames') ? flag('--frames').split(',').map(Number).filter(Number.isFinite) : null;
const framesDir = path.resolve(flag('--frames-dir', path.dirname(out)));
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const { w: W, h: H } = FRONT_DAY_FORMAT;
const FRAME_TIMEOUT_MS = 45_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const plan = frontDayPlan({ story: job.story, focusSceneId: job.focusSceneId, cameras: job.cameras || null }, job.lines, job.durations, job.planOpts || {});
if (!plan) { console.error('[front-day] úloha nemá vety — nie je čo nahrávať'); process.exit(1); }
const logoMarkup = inlineLogoMarkup(fs.readFileSync(path.join(root, 'public', 'logo.svg'), 'utf8'));
const anchorPoints = dayAnchorPoints(job.model);
const hasAnchors = Object.keys(anchorPoints).length > 0;
/** Čierna snímka na miesto akčného záberu (linka ho prekryje) — mapa sa vtedy nekreslí. */
const blackFrame = await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } }).jpeg({ quality: 80 }).toBuffer();
console.log(`[front-day] ${job.model.day}: ${plan.durationS.toFixed(1)} s, ${plan.totalFrames} snímok, zábery ${plan.shots.map((s) => `${s.id}=${s.dur.toFixed(1)}`).join(' ')}`);

const c0 = plan.at(0).camera;
const hash = `v=2&l=&lat=${c0.lat.toFixed(3)}&lon=${c0.lon.toFixed(3)}&alt=${Math.round(c0.heightM)}&heading=0&pitch=${Math.round(c0.pitchDeg)}&roll=0&style=normal&bloom=0&sharpen=0&si=49&hud=tactical&hv=0&dm=OFF&sc=0&map=karta`;
const launchBrowser = () => puppeteer.launch({
  headless: true, pipe: true, protocolTimeout: 300_000,
  args: ['--no-sandbox', `--window-size=${W},${H}`, '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
let browser = await launchBrowser();
let page = null;
let info = null;
let blockedReloads = 0;
const reportBlockedReload = () => {
  blockedReloads += 1;
  if (blockedReloads <= 3 || blockedReloads % 20 === 0) console.log(`[front-day] zrušené nové načítanie stránky (${blockedReloads}×) — zdroják sa zmenil počas nahrávania`);
};

async function openScene({ fresh = false, frame = 0 } = {}) {
  if (page) await page.close().catch(() => {});
  page = null;
  settledPhase = null;
  if (fresh) { await browser.close().catch(() => {}); browser = await launchBrowser(); }
  page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  let ready = false;
  for (let attempt = 0; attempt < 3 && !ready; attempt += 1) {
    await page.goto(`${baseUrl}/?capture=${Date.now()}#${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    for (let i = 0; i < 180 && !ready; i += 1) {
      ready = await page.evaluate(() => Boolean(window.__godsEyeView?.viewer) && document.getElementById('loading-screen')?.classList.contains('hidden')).catch(() => false);
      if (!ready) await sleep(500);
    }
  }
  if (!ready) throw new Error('OKO sa nenačítalo (beží oko-dev na localhoste?)');
  await blockPageReloads(page, { onBlocked: reportBlockedReload });
  await sleep(1500);
  info = await page.evaluate(async (changeDays) => {
    const gev = window.__godsEyeView;
    const viewer = gev.viewer;
    const { installFrontWeekScene } = await import('/src/frontWeekCapture.js');
    window.__okoFrontDay = await installFrontWeekScene(viewer, { sceneId: 'front', changeDays });
    try { gev.ukraineEvents?.hide?.(); } catch { /* vrstva nemusí byť */ }
    try { gev.ukraineControl?.setPointsVisible?.(false); } catch { /* */ }
    try { gev.ukraineAlerts?.hide?.(); } catch { /* */ }
    viewer.scene.globe.enableLighting = false;
    const style = document.createElement('style');
    style.textContent = 'body * { visibility: hidden !important; } #cesiumContainer, #cesiumContainer .cesium-viewer, #cesiumContainer .cesium-viewer-cesiumWidgetContainer, #cesiumContainer .cesium-widget, #cesiumContainer canvas { visibility: visible !important; } #oko-video-hud, #oko-video-hud * { visibility: visible !important; }';
    document.head.appendChild(style);
    const hud = document.createElement('div');
    hud.id = 'oko-video-hud';
    hud.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(hud);
    const faces = ['300 40px "JetBrains Mono"', '400 40px "JetBrains Mono"', '500 40px "JetBrains Mono"', '600 40px "JetBrains Mono"', '700 40px "JetBrains Mono"', '400 40px Inter', '600 40px Inter', '700 40px Inter', '800 40px Inter'];
    await Promise.all(faces.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
    const missing = faces.filter((f) => !document.fonts.check(f));
    if (missing.length) throw new Error(`písma webu sa nenačítali: ${missing.join(', ')}`);
    return window.__okoFrontDay.info;
  }, job.changeDays ?? 1);
  console.log(`[front-day] scéna: mapa k ${info.day}, zmena ${info.change ? `${info.change.fromDay} → ${info.change.toDay}` : 'nie je'}, hlásenie ${info.reportedAtText || '?'}`);
  await page.evaluate((c) => window.__okoFrontDay.setView(c), plan.at(frame).camera);
  for (let i = 0; i < 120; i += 1) { await page.evaluate(() => window.__okoFrontDay.render()); await sleep(150); }
}

let shootStep = '';
let settledPhase = null;
async function shoot(frame) {
  const st = plan.at(frame);
  if (st.clip !== null) return blackFrame;
  shootStep = 'kamera';
  await page.evaluate((c) => window.__okoFrontDay.setView(c), st.camera);
  const phase = `${st.shot.index}:${st.flying ? 'let' : 'záber'}`;
  const settle = st.flying ? frame % 6 === 0 : phase !== settledPhase;
  settledPhase = phase;
  if (settle) await page.evaluate(() => window.__okoFrontDay.settleLabels());
  const minRenders = st.flying ? 2 : 3;
  shootStep = 'vrstvy';
  for (let k = 0; k < 60; k += 1) {
    await page.evaluate(() => window.__okoFrontDay.render());
    if (k + 1 >= minRenders && await page.evaluate(() => window.__okoFrontDay.loaded())) break;
    await sleep(60);
  }
  shootStep = 'popisy';
  const anchors = hasAnchors && ['dir', 'overview', 'air', 'strike', 'spot'].includes(st.shot.kind)
    ? await page.evaluate((pts) => window.__okoFrontDay.project(pts), anchorPoints) : null;
  const svg = buildFrontDayHudSvg(job.model, st, { logoMarkup, hook: job.hook, story: job.story, mapDay: job.mapDay || info?.day || null, anchors });
  await page.evaluate((s) => { document.getElementById('oko-video-hud').innerHTML = s; }, svg);
  await page.evaluate(() => window.__okoFrontDay.render());
  shootStep = 'fotka';
  return page.screenshot({ type: 'jpeg', quality: 92 });
}
const shootSafe = (frame) => shootWithRecovery({
  shoot: () => shoot(frame),
  reopen: () => openScene({ fresh: true, frame }),
  timeoutMs: FRAME_TIMEOUT_MS,
  label: `snímka ${frame}`,
  step: () => shootStep,
  log: (m) => console.log(`[front-day] ${m}`),
});

try {
  await openScene();
  if (sampleFrames) {
    fs.mkdirSync(framesDir, { recursive: true });
    for (const f of sampleFrames) {
      if (plan.at(f).clip === null) {
        await page.evaluate((c) => window.__okoFrontDay.setView(c), plan.at(f).camera);
        for (let i = 0; i < 40; i += 1) { await page.evaluate(() => window.__okoFrontDay.render()); await sleep(100); }
      }
      const file = path.join(framesDir, `front-day-${String(f).padStart(4, '0')}.jpg`);
      fs.writeFileSync(file, await shootSafe(f));
      console.log(`[front-day] snímka ${f} (${plan.at(f).shot.id}) → ${file}`);
    }
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = `${out}.part.mp4`;
    const ff = spawn(ffmpegPath, ffmpegArgs(plan.fps, tmp, VIDEO_3D_ENCODE), { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    const exited = new Promise((resolve) => { ff.on('error', (error) => resolve({ code: -1, error })); ff.on('close', (code) => resolve({ code })); });
    const started = Date.now();
    for (let f = 0; f < plan.totalFrames; f += 1) {
      const jpg = await shootSafe(f);
      if (!ff.stdin.write(jpg)) await Promise.race([once(ff.stdin, 'drain').catch(() => {}), exited]);
      if (f % 100 === 0) console.log(`[front-day] ${f}/${plan.totalFrames} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    const result = await exited;
    if (result.code !== 0) throw new Error(`ffmpeg ${result.error?.message || result.code}: ${stderr.trim().slice(-400)}`);
    fs.renameSync(tmp, out);
    console.log(`[front-day] ${out}: ${fs.statSync(out).size} B za ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
} finally {
  await browser.close();
}
