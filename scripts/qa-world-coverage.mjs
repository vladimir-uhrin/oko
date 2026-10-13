// scripts/qa-world-coverage.mjs — kontrola „ukazuje sa celý svet?" na snímkach (2026-10-13).
//
// Vlastník: „skontroluj celý svet aby sa ukazovalo". Skutočný prehliadač s GPU (ako qa-mideast-panel.mjs —
// testy textu rozloženie ani WebGL nevidia): otvorí OKO s lietadlami na piatich pohľadoch na celý glóbus
// (Európa+Afrika, Ázia, Amerika, Pacifik, Austrália), počká na vykreslenie a zapíše snímku + počty:
// koľko lietadiel má vrstva, koľko ich je na obrazovke a či sa Zem vykreslila (svetlé pixely v strede).
// Použitie: node scripts/qa-world-coverage.mjs [--url https://okolive.sk] [--out output/qa-world]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const BASE = opt('url', 'https://okolive.sk').replace(/\/+$/, '');
const OUT = path.resolve(opt('out', 'output/qa-world'));
const VIEWS = [
  ['europa-afrika', 20, 15], ['azia', 30, 95], ['amerika', 20, -80], ['pacifik', 10, -170], ['australia', -25, 135],
];
const ALT_M = 12_000_000;
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true, pipe: true, protocolTimeout: 300_000,
  args: ['--no-sandbox', '--window-size=1600,900', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--lang=sk-SK'],
});
let failed = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  // Súhlas s cookies: odmietnuté (ako návštevník, ktorý nič nepovolí) — lišta nezakrýva glóbus.
  const { CONSENT_STORAGE_KEY, serializeConsent } = await import('../src/analytics.js');
  const consent = serializeConsent('denied');
  await page.evaluateOnNewDocument((key, value) => { try { localStorage.setItem(key, value); } catch { /* */ } }, CONSENT_STORAGE_KEY, consent);
  for (const [name, lat, lon] of VIEWS) {
    // Iný dotaz pre každý pohľad: zmena len časti za # by stránku neprenačítala a kamera by ostala.
    await page.goto(`${BASE}/?qa=world-${name}#v=2&lat=${lat}&lon=${lon}&alt=${ALT_M}&pitch=-90&l=f`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => window.__godsEyeView?.dataManager?.layers?.get('flights')?.module, { timeout: 120_000 });
    await new Promise((r) => setTimeout(r, 25_000));
    const stats = await page.evaluate(() => {
      const v = window.__godsEyeView.viewer;
      const scene = v.scene;
      let total = 0;
      let onScreen = 0;
      const pos = new Cesium.Cartesian2();
      const walk = (c) => {
        for (let i = 0; i < c.length; i += 1) {
          const p = c.get(i);
          if (p instanceof Cesium.BillboardCollection) {
            for (let k = 0; k < p.length; k += 1) {
              const b = p.get(k);
              if (!b.show) continue;
              total += 1;
              const w = Cesium.SceneTransforms.worldToWindowCoordinates(scene, b.position, pos);
              if (w && w.x >= 0 && w.y >= 0 && w.x <= innerWidth && w.y <= innerHeight) {
                const occ = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, v.camera.positionWC);
                if (occ.isPointVisible(b.position)) onScreen += 1;
              }
            }
          } else if (p && typeof p.length === 'number' && typeof p.get === 'function') walk(p);
        }
      };
      walk(scene.primitives);
      return { total, onScreen };
    });
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    // Vykreslená Zem: priemerný jas stredu snímky (čierny vesmír ≈ 0–15).
    const brightness = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, img.width / 2 - 100, img.height / 2 - 100, 200, 200, 0, 0, 200, 200);
      const d = ctx.getImageData(0, 0, 200, 200).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return Math.round(sum / (d.length / 4));
    }, `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`);
    const ok = brightness > 20 && stats.onScreen > 0;
    if (!ok) failed += 1;
    console.log(`${ok ? '✔' : '✖'} ${name.padEnd(14)} lietadiel vo vrstve ${String(stats.total).padStart(6)} · na obrazovke ${String(stats.onScreen).padStart(5)} · jas Zeme ${brightness} · ${file}`);
  }
} finally {
  await browser.close();
}
process.exitCode = failed ? 1 : 0;
