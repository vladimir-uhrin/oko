// scripts/check-lazy.js — MERATEĽNÁ kontrola M3 (lazy-load meteo vrstvy).
//
// Obmedzenie zo zadania: „The weather layer is lazy-loaded: news pages of OKO
// must not load any weather code or data until the layer is opened."
// OKO je SPA (jediný index.html), takže „news page" = aplikácia načítaná na
// správy/situácie. Meriame teda sieťovú realitu, nie zdrojový kód:
//
//   FÁZA A  štart appky (nikto sa meteo nedotkol) → NESMIE prísť žiadna
//           požiadavka na weather modul ani na /api/meteo/*
//   FÁZA B  zapneme vrstvu meteo-gfs → požiadavky PRÍSŤ MUSIA
//
// Fáza B je zámerná: bez nej by test prešiel aj pre vrstvu, ktorá je len
// rozbitá a nenačíta sa nikdy.
//
// Výstup je deterministický: zoradený, odfiltrovaný zoznam + verdikt.
// Spustenie:  node scripts/check-lazy.js [--url http://localhost:4173] [--json]

import puppeteer from 'puppeteer';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const URL_BASE = arg('--url', 'http://localhost:4173');
const AS_JSON = process.argv.includes('--json');

/** Požiadavka súvisiaca s počasím? Pure — testovateľné bez prehliadača. */
export function isWeatherRequest(url) {
  const u = String(url || '');
  if (/\/api\/meteo\//.test(u)) return true;
  // moduly aj zbalené chunky
  return /(meteoLayer|meteoField|meteoRasterize|meteoTimeline|meteoPlaces|meteoIsolines|windParticles|netcdf3)/i.test(u);
}

/** Z absolútnej URL spraví stabilný kľúč (bez hosta, portu a cache-bust dopytu). Pure. */
export function stableKey(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.searchParams.has('var') ? `?var=${u.searchParams.get('var')}` : '');
  } catch { return String(url); }
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const seen = [];
  page.on('request', (r) => { if (isWeatherRequest(r.url())) seen.push(stableKey(r.url())); });

  const settle = async (ms) => { await new Promise((r) => setTimeout(r, ms)); };

  await page.goto(URL_BASE, { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.waitForFunction('!!window.__godsEyeView?.dataManager', { timeout: 90_000 });
  await settle(4000); // nechaj dobehnúť lenivé importy, ktoré by prišli neskôr
  const phaseA = [...new Set(seen)].sort();

  // FÁZA B — používateľ otvorí vrstvu
  seen.length = 0;
  await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('meteo-gfs', true, { origin: 'user' }));
  await settle(9000);
  const phaseB = [...new Set(seen)].sort();

  await browser.close();

  const failA = phaseA.length > 0;
  const failB = phaseB.length === 0;
  const pass = !failA && !failB;
  const result = {
    check: 'M3 lazy-load',
    pass,
    beforeOpen: phaseA,
    afterOpen: phaseB,
    reasons: [
      failA ? `pred otvorením prišlo ${phaseA.length} weather požiadaviek (má byť 0)` : null,
      failB ? 'po otvorení neprišla žiadna weather požiadavka — vrstva sa vôbec nenačítala' : null,
    ].filter(Boolean),
  };

  if (AS_JSON) { console.log(JSON.stringify(result, null, 2)); }
  else {
    console.log(`M3 lazy-load: ${pass ? 'PASS' : 'FAIL'}`);
    console.log(`  pred otvorením: ${phaseA.length} weather požiadaviek`);
    for (const u of phaseA.slice(0, 12)) console.log(`    - ${u}`);
    if (phaseA.length > 12) console.log(`    … a ďalších ${phaseA.length - 12}`);
    console.log(`  po otvorení:    ${phaseB.length} weather požiadaviek`);
    for (const r of result.reasons) console.log(`  dôvod: ${r}`);
  }
  process.exit(pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-lazy.js')) {
  main().catch((e) => { console.error('check-lazy zlyhal:', e?.message || e); process.exit(2); });
}
