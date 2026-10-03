// OKO — obraz videa „Týždeň na fronte" v štýle OKO + Rybar (2026-10-03, vlastník: „vrátime sa k Ukrajine" →
// video; územie vo videu áno, zdroj sa volá okolive.sk („používaj zdroje okolive.sk, nie DeepState"), kritický voči agresorovi; „video v štýle OKO + Rybar").
//
// Chrome s GPU (puppeteer) otvorí OKO z dev servera, zapne scénu frontu v KARTE (src/frontWeekCapture.js —
// tá istá mapa, akú vidí návštevník: reliéf, sídla, okupované územie, sivá zóna, zmena za 7 dní, šípky a blesky
// z hlásenia GŠ), skryje ovládanie a pre každú snímku plánu (src/data/frontWeekVideo.js) nastaví kameru, počká
// na vrstvy a odfotí obraz s popismi (src/data/frontWeekHud.js + logo public/logo.svg) → ffmpeg (H.264).
// KARTA ide z nášho reliéfu a OSM — žiadne dlaždice Google, žiadna denná kvóta.
//
// Spustenie (beží služba oko-dev na localhoste):
//   node scripts/capture-front-week.mjs --job <úloha.json> --out <mp4> [--url http://localhost:4173]
//     [--frames 0,150,300 [--frames-dir <adresár>]]
// `--job`: { model, lines, durations, hook, occupied, mapDay } — pripraví scripts/make-front-week-video.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { VIDEO_3D_FORMAT, inlineLogoMarkup, normalizeVideoHook } from '../src/data/eventVideoHud.js';
import { VIDEO_3D_ENCODE, ffmpegArgs } from '../src/data/eventVideoRender.js';
import { buildFrontWeekHudSvg, changeCallouts } from '../src/data/frontWeekHud.js';
import { frontWeekPlan } from '../src/data/frontWeekVideo.js';
import { blockPageReloads, shootWithRecovery } from './lib/captureGuards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const jobFile = flag('--job');
if (!jobFile) { console.error('[front-week] chýba --job <úloha.json>'); process.exit(2); }
const job = JSON.parse(fs.readFileSync(path.resolve(jobFile), 'utf8'));
const baseUrl = flag('--url', 'http://localhost:4173').replace(/\/+$/, '');
const out = path.resolve(flag('--out', path.join(root, '.gev-cache', 'front-week', 'obraz.mp4')));
const sampleFrames = flag('--frames') ? flag('--frames').split(',').map(Number).filter(Number.isFinite) : null;
const framesDir = path.resolve(flag('--frames-dir', path.dirname(out)));
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const { w: W, h: H } = VIDEO_3D_FORMAT;
/** Snímka bežne trvá pod sekundu; zaseknutá stránka sa po tomto čase vymení za nový prehliadač. */
const FRAME_TIMEOUT_MS = 45_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const plan = frontWeekPlan(job.model, job.lines, job.durations, job.planOpts || {});
if (!plan) { console.error('[front-week] úloha nemá vety — nie je čo nahrávať'); process.exit(1); }
const hook = job.hook ? normalizeVideoHook(job.hook) : null;
const logoMarkup = inlineLogoMarkup(fs.readFileSync(path.join(root, 'public', 'logo.svg'), 'utf8'));
// Body „kde sa front pohol" (zmenené územie po smeroch) — stránka ich po snímkach premieta na obrazovku.
const calloutPoints = Object.fromEntries(changeCallouts(job.model).map((c) => [c.id, { lon: c.lon, lat: c.lat }]));
const hasCallouts = Object.keys(calloutPoints).length > 0;
console.log(`[front-week] ${job.model.week.from} – ${job.model.week.to}: ${plan.durationS.toFixed(1)} s, ${plan.totalFrames} snímok, zábery ${plan.shots.map((s) => `${s.id}=${s.dur.toFixed(1)}`).join(' ')}`);

// KARTA bez vrstiev správcu (lietadlá, lode…), bez panelov a masky; front sa zapne scénou.
const hash = 'v=2&l=&lat=47.75&lon=36.4&alt=930000&heading=0&pitch=-88&roll=0&style=normal&bloom=0&sharpen=0&si=49&hud=tactical&hv=0&dm=OFF&sc=0&map=karta';
/** Chrome s GPU; po zaseknutí sa spustí celý nanovo (zaseknutý GPU proces nová stránka neobíde). */
const launchBrowser = () => puppeteer.launch({
  headless: true, pipe: true, protocolTimeout: 300_000,
  args: ['--no-sandbox', `--window-size=${W},${H}`, '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
let browser = await launchBrowser();
let page = null;
let info = null;
/** Zrušené znovunačítania sa rátajú za celé nahrávanie (aj cez obnovy prehliadača); hlási sa prvé tri a každé dvadsiate. */
let blockedReloads = 0;
const reportBlockedReload = () => {
  blockedReloads += 1;
  if (blockedReloads <= 3 || blockedReloads % 20 === 0) console.log(`[front-week] zrušené nové načítanie stránky (${blockedReloads}×) — zdroják sa zmenil počas nahrávania`);
};

async function openScene({ fresh = false, frame = 0 } = {}) {
  if (page) await page.close().catch(() => {});
  page = null;
  settledPhase = null;
  if (fresh) {
    await browser.close().catch(() => {});
    browser = await launchBrowser();
  }
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
  // Stránka sa počas nahrávania nesmie načítať znova (dev server po úprave zdrojáka pošle „full-reload" —
  // v tom istom strome pracuje aj iný agent): nové načítanie dokumentu sa zruší (lib/captureGuards.mjs).
  await blockPageReloads(page, { onBlocked: reportBlockedReload });
  await sleep(1500);
  info = await page.evaluate(async () => {
    const gev = window.__godsEyeView;
    const viewer = gev.viewer;
    const { installFrontWeekScene } = await import('/src/frontWeekCapture.js');
    window.__okoFrontWeek = await installFrontWeekScene(viewer, { sceneId: 'front' });
    // Čistá mapa ako u Rybara: bez kartičiek správ, bez bodov kontroly sídiel z Wikipédie, bez poplachov.
    try { gev.ukraineEvents?.hide?.(); } catch { /* vrstva nemusí byť */ }
    try { gev.ukraineControl?.setPointsVisible?.(false); } catch { /* */ }
    try { gev.ukraineAlerts?.hide?.(); } catch { /* */ }
    const globe = viewer.scene.globe;
    globe.enableLighting = false;
    // Všetko okrem plátna mapy a vrstvy popisov skryté — pravidlom, nie zoznamom prvkov (prvky vznikajú aj neskôr).
    const style = document.createElement('style');
    style.textContent = 'body * { visibility: hidden !important; } #cesiumContainer, #cesiumContainer .cesium-viewer, #cesiumContainer .cesium-viewer-cesiumWidgetContainer, #cesiumContainer .cesium-widget, #cesiumContainer canvas { visibility: visible !important; } #oko-video-hud, #oko-video-hud * { visibility: visible !important; }';
    document.head.appendChild(style);
    const hud = document.createElement('div');
    hud.id = 'oko-video-hud';
    hud.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(hud);
    const faces = ['300 40px "JetBrains Mono"', '400 40px "JetBrains Mono"', '500 40px "JetBrains Mono"', '600 40px "JetBrains Mono"', '700 40px "JetBrains Mono"', '400 40px Inter', '600 40px Inter'];
    await Promise.all(faces.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
    const missing = faces.filter((f) => !document.fonts.check(f));
    if (missing.length) throw new Error(`písma webu sa nenačítali: ${missing.join(', ')}`);
    return window.__okoFrontWeek.info;
  });
  console.log(`[front-week] scéna: mapa k ${info.day}, zmena ${info.change ? `${info.change.fromDay} → ${info.change.toDay}` : 'nie je'}, hlásenie ${info.reportedAtText || '?'}`);
  // Zahriatie na kamere snímky, ktorou sa pokračuje: pozemné polygóny (okupované, zmena, šípky) sa po načítaní
  // stavajú vo workeroch ~15–20 s — bez neho by prvé snímky po (znovu)otvorení prehliadača boli bez nich.
  await page.evaluate((c) => window.__okoFrontWeek.setView(c), plan.at(frame).camera);
  for (let i = 0; i < 120; i += 1) { await page.evaluate(() => window.__okoFrontWeek.render()); await sleep(150); }
}

/** Krok rozrobenej snímky — pri zaseknutí ho nesie hlásenie (kamera, vrstvy, popisy, fotka). */
let shootStep = '';
/** Záber a fáza (prelet/záber), pre ktorú sú popisy mapy preriedené; nová stránka začína odznova. */
let settledPhase = null;
async function shoot(frame) {
  const st = plan.at(frame);
  shootStep = 'kamera';
  await page.evaluate((c) => window.__okoFrontWeek.setView(c), st.camera);
  // Riedenie popisov mapy: appka ho robí až po ustálení kamery, tu sa kamera hýbe každou snímkou — bez neho by
  // ostalo riedenie z iného pohľadu (KYIV pod BROVARY). Raz pri príchode kamery do záberu (pri pomalom
  // približovaní sa popisy nemenia), počas preletu niekoľkokrát za sekundu.
  const phase = `${st.shot.index}:${st.flying ? 'let' : 'záber'}`;
  const settle = st.flying ? frame % 6 === 0 : phase !== settledPhase;
  settledPhase = phase;
  if (settle) await page.evaluate(() => window.__okoFrontWeek.settleLabels());
  // Pozemné polygóny a popisy sa po zmene kamery dotiahnu za pár snímok; pri prelete stačí menej.
  const minRenders = st.shot.kind === 'dir' && st.localS < 2.2 ? 2 : 3;
  shootStep = 'vrstvy';
  for (let k = 0; k < 60; k += 1) {
    await page.evaluate(() => window.__okoFrontWeek.render());
    if (k + 1 >= minRenders && await page.evaluate(() => window.__okoFrontWeek.loaded())) break;
    await sleep(60);
  }
  shootStep = 'popisy';
  const viewRect = st.shot.kind === 'dir' ? await page.evaluate(() => window.__okoFrontWeek.viewRect()) : null;
  const anchors = hasCallouts && (st.shot.kind === 'dir' || st.shot.kind === 'overview')
    ? await page.evaluate((pts) => window.__okoFrontWeek.project(pts), calloutPoints) : null;
  const svg = buildFrontWeekHudSvg(job.model, st, { logoMarkup, hook, occupied: job.occupied || [], viewRect, anchors, mapDay: job.mapDay || info?.day || null });
  await page.evaluate((s) => { document.getElementById('oko-video-hud').innerHTML = s; }, svg);
  await page.evaluate(() => window.__okoFrontWeek.render());
  shootStep = 'fotka';
  return page.screenshot({ type: 'jpeg', quality: 92 });
}
/**
 * Snímka s časovým limitom a obnovou (lib/captureGuards.mjs): po zaseknutí sa hneď otvorí celý prehliadač
 * nanovo a scéna sa zahreje na kamere tej istej snímky; ffmpeg beží ďalej.
 */
const shootSafe = (frame) => shootWithRecovery({
  shoot: () => shoot(frame),
  reopen: () => openScene({ fresh: true, frame }),
  timeoutMs: FRAME_TIMEOUT_MS,
  label: `snímka ${frame}`,
  step: () => shootStep,
  log: (m) => console.log(`[front-week] ${m}`),
});

try {
  await openScene();
  if (sampleFrames) {
    fs.mkdirSync(framesDir, { recursive: true });
    for (const f of sampleFrames) {
      // Vzorka mimo poradia: kamera skočí, vrstvy potrebujú chvíľu (pri plynulom nahrávaní to nie je treba).
      await page.evaluate((c) => window.__okoFrontWeek.setView(c), plan.at(f).camera);
      for (let i = 0; i < 40; i += 1) { await page.evaluate(() => window.__okoFrontWeek.render()); await sleep(100); }
      const file = path.join(framesDir, `front-week-${String(f).padStart(4, '0')}.jpg`);
      fs.writeFileSync(file, await shootSafe(f));
      console.log(`[front-week] snímka ${f} (${plan.at(f).shot.id}) → ${file}`);
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
      if (f % 100 === 0) console.log(`[front-week] ${f}/${plan.totalFrames} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    const result = await exited;
    if (result.code !== 0) throw new Error(`ffmpeg ${result.error?.message || result.code}: ${stderr.trim().slice(-400)}`);
    fs.renameSync(tmp, out);
    console.log(`[front-week] ${out}: ${fs.statSync(out).size} B za ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
} finally {
  await browser.close();
}
