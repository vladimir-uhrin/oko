// OKO — 3D video udalosti v štýle OKO (2026-10-01, vlastník: „chcel by som to v OKO style", „nie je
// tam samotný pád", „chýba tam moje logo"; jeden vzorec pre každú udalosť, nie len FZ1073).
//
// Skutočný záber z OKO ako obrázok okolive.sk (scripts/capture-share-background.mjs): Chrome s GPU
// (puppeteer) otvorí OKO z dev servera bez vrstiev a panelov, načíta scénu udalosti
// (src/eventVideoCapture.js — stopa farbou výšky ako v Prehrávači letov, záves pod stopou, lietadlo,
// značky momentov) a pre každú snímku plánu (src/data/eventVideo.js — tempo, spomalené okolia pádu
// a obratu, diery) nastaví čas, lietadlo a kameru (src/data/eventVideoScene.js), počká na dlaždice
// a odfotí obraz. Na snímku položí popisy v štýle OKO (src/data/eventVideoHud.js + logo
// public/logo.svg) a pošle ju do ffmpeg (H.264, +faststart). Hotové video nahrá do služby udalostí
// (POST /api/events/<id>/video.mp4, len z tohto počítača) — vlastník ho stiahne tlačidlom VIDEO DO
// PRÍSPEVKU a do príspevku na FB ho nahrá sám.
//
// Dlaždice: jedno video stiahne ~2–3 tisíc dlaždíc fotorealistickej vrstvy cez Cesium ion — spúšťať
// ručne pre konkrétnu udalosť, nikdy v slučke (CLAUDE.md). Zaseknutý prehliadač (raz naživo pri
// FZ1073) rieši časový limit snímky, nový pokus a pri opakovaní nové načítanie stránky.
//
// Spustenie (beží služba oko-dev na localhoste):
//   node scripts/capture-event-video.mjs --event <id> | --event-file <udalosť.json> [--url http://localhost:4173] [--out <mp4>]
//     [--no-upload] [--frames 0,150,300 [--frames-dir <adresár>]] [--reported <fakty.json>] [--plan <voľby.json>]
//     [--hook <háčik.json>]  — háčik úvodnej karty {tag, lines[1–3], sub?, source} (normalizeVideoHook, zdroj povinný)
// `--plan <voľby.json>`: tempo videa (voľby videoPlan, napr. dlhšie otvorenie a zastavenia, keď má video
// komentár — každá veta má zaznieť pri svojom zábere); prepíšu predvolené `{ openingS: 2.6, endCardS: 3 }`.
// `--reported`: fakty zo správ (telo pre POST /api/events/<id>/reported) sa overia tým istým kódom ako
// v službe (src/data/eventReported.js — dôveryhodné médiá, citáty, letisko z OurAirports) a použijú sa
// namiesto uložených — keď služba novú cestu ešte nemá (vydanie oko-api), video aj tak sedí na udalosť
// s týmito faktami (rovnaký kľúč videa).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { videoPlan } from '../src/data/eventVideo.js';
import { FT_M, eventVideoScene } from '../src/data/eventVideoScene.js';
import { VIDEO_3D_FORMAT, buildEventVideoHudSvg, inlineLogoMarkup, normalizeVideoHook } from '../src/data/eventVideoHud.js';
import { VIDEO_3D_ENCODE, ffmpegArgs } from '../src/data/eventVideoRender.js';
import { normalizeReportedFacts } from '../src/data/eventReported.js';
import { parseTrustedList } from '../src/data/eventNews.js';
import { parseAirportIndex } from '../src/data/airportLookup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
// Udalosť z API (--event <id>) alebo zo súboru (--event-file, linka eventVideoPipeline — nezávisí od vydania služby).
const eventFile = flag('--event-file');
const fileEvent = eventFile ? JSON.parse(fs.readFileSync(path.resolve(eventFile), 'utf8')) : null;
const id = fileEvent?.id || flag('--event');
if (!id || !/^[0-9a-f]{6}-\d{8}T\d{4}$/.test(id)) {
  console.error('[event-video] chýba --event <hex>-RRRRMMDDTHHMM alebo --event-file <json>');
  process.exit(2);
}
const baseUrl = flag('--url', 'http://localhost:4173').replace(/\/+$/, '');
const out = path.resolve(flag('--out', path.join(root, '.gev-cache', 'event-video-capture', `${id}.mp4`)));
const sampleFrames = flag('--frames') ? flag('--frames').split(',').map(Number).filter(Number.isFinite) : null;
const framesDir = path.resolve(flag('--frames-dir', path.dirname(out)));
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const { w: W, h: H } = VIDEO_3D_FORMAT;
const FRAME_TIMEOUT_MS = 90_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`časový limit: ${what}`)), ms).unref?.()),
]);

const res = fileEvent ? null : await fetch(`${baseUrl}/api/events/${id}`);
if (res && !res.ok) { console.error(`[event-video] udalosť ${id}: HTTP ${res.status}`); process.exit(1); }
const event = fileEvent || await res.json();
if (flag('--reported')) {
  const input = JSON.parse(fs.readFileSync(path.resolve(flag('--reported')), 'utf8'));
  const result = normalizeReportedFacts(input, {
    event,
    trusted: parseTrustedList(JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'local_data', 'events', 'trusted-news.json'), 'utf8'))),
    airportIndex: parseAirportIndex(fs.readFileSync(path.join(root, 'src', 'data', 'local_data', 'airports', 'airports.geojsonl'), 'utf8')),
  });
  if (result.error) { console.error(`[event-video] fakty zo správ: ${result.error} (fakt ${result.index})`); process.exit(1); }
  event.reported = result.facts.length ? result.facts : null;
  console.log(`[event-video] zo správ: ${result.facts.map((f) => `${f.kind} (${f.domains.join(', ')})`).join('; ') || 'nič'}`);
}
// Otvorenie a koncová karta so značkou OKO, okolive.sk a autorom (vlastník: „propagovať doménu aj moje meno").
const planOpts = flag('--plan') ? JSON.parse(fs.readFileSync(path.resolve(flag('--plan')), 'utf8')) : {};
const plan = videoPlan(event, { openingS: 2.6, endCardS: 3, ...planOpts });
const scene = eventVideoScene(event, plan);
if (!scene) { console.error('[event-video] udalosť nemá stopu v okne'); process.exit(1); }
console.log(`[event-video] ${id}: ${plan.durationS.toFixed(1)} s, ${plan.totalFrames} snímok`);
const logoMarkup = inlineLogoMarkup(fs.readFileSync(path.join(root, 'public', 'logo.svg'), 'utf8'));
// Háčik úvodnej karty (overený výrok so zdrojom) — prvé sekundy musia diváka chytiť (vlastník 10-02).
const hook = flag('--hook') ? normalizeVideoHook(JSON.parse(fs.readFileSync(path.resolve(flag('--hook')), 'utf8'))) : null;
if (hook) console.log(`[event-video] háčik: ${hook.tag} — ${hook.lines.join(' ')} (${hook.source})`);

// Bez vrstiev (dnešná premávka sa nemieša s historickým letom), bez panelov a masky, fotoreál.
const hash = `v=2&l=&lat=${scene.center.lat.toFixed(4)}&lon=${scene.center.lon.toFixed(4)}&alt=400000&heading=${scene.heading.toFixed(1)}&pitch=-40&roll=0`
  + '&style=normal&bloom=0&sharpen=1&si=49&hud=tactical&hv=0&dm=OFF&sc=0&map=photoreal';
/** Chrome s GPU; po zaseknutí sa spustí celý nanovo (zaseknutý GPU proces nová stránka neobíde). */
const launchBrowser = () => puppeteer.launch({
  headless: true, pipe: true, protocolTimeout: 300_000,
  args: ['--no-sandbox', `--window-size=${W},${H}`, '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
let browser = await launchBrowser();
let tiles = 0;
let page = null;

/**
 * Nová stránka OKO so scénou udalosti. `fresh` = celý prehliadač nanovo (2026-10-02: po zaseknutí snímky
 * sa v tom istom prehliadači OKO 3× za sebou nenačítalo, hoci dev server odpovedal — nahrávanie spadlo dvakrát).
 */
async function openScene({ fresh = false } = {}) {
  if (page) await page.close().catch(() => {});
  page = null;
  if (fresh) {
    await browser.close().catch(() => {});
    browser = await launchBrowser();
  }
  page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('requestfinished', (req) => { if (/3dtiles|assets\.ion|api\.cesium\.com|tile\.googleapis/.test(req.url())) tiles += 1; });
  // Vite po reštarte môže odpovedať 504 „Outdated Request" — nové načítanie pomôže.
  let ready = false;
  for (let attempt = 0; attempt < 3 && !ready; attempt += 1) {
    await page.goto(`${baseUrl}/?capture=${Date.now()}#${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    for (let i = 0; i < 180 && !ready; i += 1) {
      ready = await page.evaluate(() => Boolean(window.__godsEyeView?.viewer) && document.getElementById('loading-screen')?.classList.contains('hidden')).catch(() => false);
      if (!ready) await sleep(500);
    }
  }
  if (!ready) throw new Error('OKO sa nenačítalo (beží oko-dev na localhoste?)');
  await sleep(2000);
  await page.evaluate(async (sceneData) => {
    const viewer = window.__godsEyeView.viewer;
    const canvas = document.querySelector('#cesiumContainer canvas');
    for (const el of document.body.querySelectorAll('*')) {
      if (el === canvas || el.contains(canvas)) continue;
      el.style.setProperty('visibility', 'hidden', 'important');
    }
    const globe = viewer.scene.globe;
    globe.enableLighting = false;
    if ('dynamicAtmosphereLighting' in globe) globe.dynamicAtmosphereLighting = false;
    if ('dynamicAtmosphereLightingFromSun' in globe) globe.dynamicAtmosphereLightingFromSun = false;
    viewer.clock.shouldAnimate = false;
    const { installEventVideoScene } = await import('/src/eventVideoCapture.js');
    window.__okoEventVideo = installEventVideoScene(viewer, sceneData);
    // Popisy kreslí táto stránka — písma webu (JetBrains Mono, Inter z Google Fonts), nie náhradné.
    const hud = document.createElement('div');
    hud.id = 'oko-video-hud';
    hud.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;visibility:visible;';
    document.body.appendChild(hud);
    const faces = ['300 40px "JetBrains Mono"', '400 40px "JetBrains Mono"', '500 40px "JetBrains Mono"', '600 40px "JetBrains Mono"', '700 40px "JetBrains Mono"', '400 40px Inter', '600 40px Inter'];
    await Promise.all(faces.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
    const missing = faces.filter((f) => !document.fonts.check(f));
    if (missing.length) throw new Error(`písma webu sa nenačítali: ${missing.join(', ')}`);
  }, scene.sceneData());
}

// Poloha popisov na obrazovke: stred diery, letisko pristátia zo správ.
const anchorList = scene.anchorPoints();
async function shoot(frame) {
  const st = scene.frame(frame);
  await page.evaluate((x) => window.__okoEventVideo.apply(x), {
    t: st.s.t,
    ghost: st.ghost,
    flown: st.flown,
    plane: { lat: st.plane.lat, lon: st.plane.lon, altM: (st.plane.altFt ?? 0) * FT_M, trk: st.plane.trk, dim: st.plane.dim },
    moments: st.moments,
    camera: st.camera,
  });
  for (let k = 0; k < 80; k += 1) {
    await page.evaluate(() => window.__okoEventVideo.render());
    if (k >= 1 && await page.evaluate(() => window.__okoEventVideo.loaded())) break;
    await sleep(80);
  }
  await page.evaluate(() => window.__okoEventVideo.render());
  const anchors = await page.evaluate((l) => window.__okoEventVideo.project(l), anchorList);
  await page.evaluate((svg) => { document.getElementById('oko-video-hud').innerHTML = svg; }, buildEventVideoHudSvg(event, scene, st, anchors, { logoMarkup, hook }));
  return page.screenshot({ type: 'jpeg', quality: 92 });
}
/** Snímka s časovým limitom; po druhom a treťom zlyhaní celý prehliadač nanovo (ffmpeg beží ďalej). */
async function shootSafe(frame) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await withTimeout(shoot(frame), FRAME_TIMEOUT_MS, `snímka ${frame}`);
    } catch (error) {
      console.log(`[event-video] snímka ${frame}, pokus ${attempt}: ${error.message}`);
      if (attempt >= 2 && attempt < 4) {
        try { await openScene({ fresh: true }); } catch (e) { console.log(`[event-video] nový prehliadač: ${e.message}`); }
      }
    }
  }
  throw new Error(`snímka ${frame} sa nepodarila`);
}

try {
  await openScene();
  if (sampleFrames) {
    fs.mkdirSync(framesDir, { recursive: true });
    for (const f of sampleFrames) {
      const file = path.join(framesDir, `${id}-${String(f).padStart(4, '0')}.jpg`);
      fs.writeFileSync(file, await shootSafe(f));
      console.log(`[event-video] snímka ${f} (${plan.at(f).phase}) → ${file} (dlaždíc ${tiles})`);
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
      if (f % 100 === 0) console.log(`[event-video] ${f}/${plan.totalFrames} (${((Date.now() - started) / 1000).toFixed(0)} s, dlaždíc ${tiles})`);
    }
    ff.stdin.end();
    const result = await exited;
    if (result.code !== 0) throw new Error(`ffmpeg ${result.error?.message || result.code}: ${stderr.trim().slice(-400)}`);
    fs.renameSync(tmp, out);
    console.log(`[event-video] ${out}: ${fs.statSync(out).size} B za ${((Date.now() - started) / 1000).toFixed(0)} s, dlaždíc ${tiles}`);
    if (!args.includes('--no-upload')) {
      const up = await fetch(`${baseUrl}/api/events/${id}/video.mp4`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4', 'X-OKO-Video-Upload': '1' },
        body: fs.readFileSync(out),
      });
      console.log(`[event-video] nahratie do služby: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`);
      if (!up.ok) process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
}
