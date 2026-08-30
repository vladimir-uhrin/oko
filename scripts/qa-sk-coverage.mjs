// OKO — Fáza 0: overenie pokrytia Google Photorealistic 3D Tiles nad SK.
// Jedna headless session pre všetky lokality (minimum root tile requestov),
// šikmý pohľad ~-31°, čaká na tilesLoaded, screenshot per lokalita.
//
// Použitie (dev server musí bežať):
//   node scripts/qa-sk-coverage.mjs [--url http://localhost:4173]
//
// Výstup: qa-shots/sk-coverage/*.png + results.json (gitignorované).
// Viedeň je kontrola so známym plným 3D pokrytím — ak nemá mesh ani ona,
// problém je v kľúči/EHP podmienkach, nie v SK pokrytí (docs/SK-NOTES.md).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const argv = process.argv.slice(2);
const getOpt = (name, fallback) => {
  const at = argv.indexOf(name);
  return at !== -1 && argv[at + 1] ? argv[at + 1] : fallback;
};

const APP_URL = getOpt('--url', 'http://localhost:4173');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'qa-shots', 'sk-coverage');
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const SETTLE_TIMEOUT_MS = 75_000;

const LOCATIONS = [
  { id: '0-vieden-kontrola', name: 'Viedeň — kontrola (známe 3D)', lat: 48.20849, lon: 16.37208, height: 900 },
  { id: '1-bratislava-hrad', name: 'Bratislava — hrad/centrum', lat: 48.14180, lon: 17.09850, height: 900 },
  { id: '2-bratislava-petrzalka', name: 'Bratislava — Petržalka/most SNP', lat: 48.13350, lon: 17.10750, height: 900 },
  { id: '3-samorin', name: 'Šamorín — centrum', lat: 48.03135, lon: 17.30962, height: 800 },
  { id: '4-dunajska-streda', name: 'Dunajská Streda — centrum', lat: 47.99268, lon: 17.61211, height: 800 },
  { id: '5-topolniky', name: 'Topoľníky', lat: 47.96126, lon: 17.79170, height: 800 },
];

async function waitForApp(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => Boolean(window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager),
    { timeout: 60_000, polling: 200 },
  );
  await new Promise((r) => setTimeout(r, 2000));
  await page.keyboard.press('Escape'); // first-launch mission card
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.press('Escape');
}

async function setCamera(page, { lon, lat, height }) {
  await page.evaluate(([lonD, latD, h]) => {
    const viewer = window.__godsEyeView.viewer;
    const ellipsoid = viewer.scene.globe.ellipsoid;
    viewer.trackedEntity = undefined;
    viewer.camera.cancelFlight?.();
    viewer.scene.tweens?.removeAll?.();
    viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: lonD * Math.PI / 180,
        latitude: (latD - 0.006) * Math.PI / 180, // kamera južne, pohľad na sever
        height: h,
      }),
      orientation: { heading: 0, pitch: -0.55, roll: 0 },
    });
  }, [lon, lat, height]);
}

async function awaitTilesSettled(page) {
  return page.evaluate(async (timeoutMs) => {
    const gev = window.__godsEyeView;
    const controller = gev.mapStackController;
    const activeStack = controller?.getActiveId?.() || null;
    const tileset = controller?.googleTileset || gev.tileset || null;
    const applicable = activeStack === 'photoreal' && tileset?.show !== false;
    if (!applicable) return { settled: false, applicable, activeStack, note: 'photoreal stack nie je aktívny' };

    let allLoaded = false;
    const remove = tileset.allTilesLoaded?.addEventListener?.(() => { allLoaded = true; });
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        gev.viewer.scene.render(gev.viewer.clock.currentTime);
        if (tileset.tilesLoaded === true || allLoaded) {
          for (let i = 0; i < 30; i++) { // pár frame-ov navyše na upload textúr
            gev.viewer.scene.render(gev.viewer.clock.currentTime);
            await new Promise((r) => setTimeout(r, 50));
          }
          const s = tileset.statistics || {};
          return {
            settled: true, applicable, activeStack,
            stats: { selected: s.selected, visited: s.visited, ready: s.numberOfLoadedTilesTotal, total: s.numberOfTilesTotal },
          };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return { settled: false, applicable, activeStack, timedOut: true };
    } finally {
      if (typeof remove === 'function') remove();
    }
  }, SETTLE_TIMEOUT_MS);
}

async function main() {
  const ping = await fetch(APP_URL).catch((e) => ({ ok: false, statusText: e.message }));
  if (!ping.ok) throw new Error(`Dev server nebeží na ${APP_URL}: ${ping.status || ping.statusText}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 300000,
    args: [
      '--enable-unsafe-swiftshader', '--use-gl=swiftshader',
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

    console.log(`SK coverage → ${APP_URL}`);
    await waitForApp(page);

    const results = [];
    for (const loc of LOCATIONS) {
      console.log(`\n=== ${loc.name} (${loc.lat}, ${loc.lon}, ${loc.height} m) ===`);
      await setCamera(page, loc);
      const settle = await awaitTilesSettled(page);
      console.log(`  tiles: ${settle.settled ? 'settled' : 'NESETTLED'} | stack=${settle.activeStack} | stats=${JSON.stringify(settle.stats || {})}`);
      const file = path.join(OUT_DIR, `${loc.id}.png`);
      await page.screenshot({ path: file });
      console.log(`  → ${file}`);
      results.push({ ...loc, settle, file });
    }

    fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
    console.log('\nHotovo — pokrytie sa vyhodnocuje vizuálne (extrúzia budov v šikmom pohľade), pozri docs/SK-NOTES.md.');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
