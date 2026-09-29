// OKO — pozadie obrázka zdieľania okolive.sk (2026-09-29, vlastník: „treba vytvoriť aj kvalitný
// cover image pre zdieľanie samotnej domény").
//
// Skutočný záber OKO z obežnej dráhy nad Európou so živými lietadlami a loďami: Chrome s GPU
// (puppeteer, ten istý postup ako pri meraniach plynulosti), 2400×1260 = dvojnásobok výsledného
// obrázka, bez panelov a HUD, bez masky ďalekohľadu (sc=0) a bez nočného osvetlenia (Európa je
// večer tmavá). Z pozadia skladá obrázok scripts/build-share-default-image.mjs.
//
// Potrebuje bežiaci dev server (služba oko-dev, localhost:4173). Jeden záber stiahne ~400 dlaždíc
// Google 3D cez Cesium ion — spúšťať ručne pri zmene vzhľadu, nikdy v slučke (CLAUDE.md).
// Výstup ide do .gev-cache/share-cover/ (nie do repa); do repa ide len public/share-default.jpg.
//
// Spustenie: node scripts/capture-share-background.mjs [--url http://localhost:4173] [--out <png>]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const baseUrl = flag('--url', 'http://localhost:4173');
const out = path.resolve(flag('--out', path.join(root, '.gev-cache', 'share-cover', 'bg-orbit.png')));
const W = 2400;
const H = 1260;
// Pohľad z ~1 750 km nad Stredomorím na sever: dole stredná Európa so živou premávkou, hore hviezdy
// pre text. Vrstvy a.z.f = lode (AIS, AISHub) a lietadlá — predvolené vrstvy appky.
const VIEW = { lat: 29.5, lon: 16.5, alt: 1_750_000, heading: 0, pitch: -33 };
const hash = `v=2&lat=${VIEW.lat}&lon=${VIEW.lon}&alt=${VIEW.alt}&heading=${VIEW.heading}&pitch=${VIEW.pitch}&roll=0`
  + '&style=normal&bloom=0&sharpen=1&si=49&hud=tactical&hv=0&dm=OFF&sc=0&map=photoreal&l=a.z.f&lo=f.e.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true, pipe: true, protocolTimeout: 240_000,
  args: ['--no-sandbox', `--window-size=${W},${H}`, '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  let tiles = 0;
  page.on('requestfinished', (req) => { if (/tile\.googleapis\.com\/v1\/3dtiles/.test(req.url())) tiles += 1; });
  await page.goto(`${baseUrl}/#${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  for (let i = 0; i < 240; i += 1) {
    if (await page.evaluate(() => document.getElementById('loading-screen')?.classList.contains('hidden')).catch(() => false)) break;
    await sleep(500);
  }
  // Dlaždice a živé vrstvy: kým sa počet stiahnutých dlaždíc 8 s nemení (najviac 90 s).
  let last = -1;
  let still = 0;
  for (let i = 0; i < 90 && still < 8; i += 1) {
    await sleep(1000);
    if (tiles === last) still += 1; else { still = 0; last = tiles; }
  }
  await page.evaluate(() => {
    const canvas = document.querySelector('#cesiumContainer canvas');
    for (const el of document.body.querySelectorAll('*')) {
      if (el === canvas || el.contains(canvas)) continue;
      el.style.setProperty('visibility', 'hidden', 'important');
    }
    const viewer = window.__godsEyeView?.viewer;
    const globe = viewer?.scene?.globe;
    if (globe) {
      globe.enableLighting = false;
      if ('dynamicAtmosphereLighting' in globe) globe.dynamicAtmosphereLighting = false;
      if ('dynamicAtmosphereLightingFromSun' in globe) globe.dynamicAtmosphereLightingFromSun = false;
      viewer.scene.requestRender();
    }
  });
  await sleep(4000);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, type: 'png' });
  console.log(`[share-cover] ${out} (${W}×${H}, dlaždíc Google 3D ${tiles})`);
} finally {
  await browser.close();
}
