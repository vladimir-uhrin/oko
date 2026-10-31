// scripts/qa-icon-font.mjs — ikony z vlastného výrezu Material Symbols v skutočnom prehliadači (2026-10-31).
//
// Prečo: index.html už nenačítava celé písmo Material Symbols z Google Fonts, ale výrez len s použitými
// ikonami (public/fonts/material-symbols-subset.woff2). Chýbajúca ikona sa neprejaví chybou — prehliadač
// ukáže názov ligatúry ako text alebo prázdny štvorec. Tento skript to meria na obdĺžnikoch, nie na zdrojáku:
//   1. písmo prišlo z /fonts/material-symbols-subset.woff2?v=<odtlačok> a žiadne Material z fonts.googleapis.com;
//   2. každý názov z material-symbols-subset.json sa vykreslí ako jeden glyf (šírka ≈ veľkosť písma);
//   3. žiadny viditeľný prvok .material-symbols-outlined nie je širší než 1,6× písmo (= text namiesto ikony).
// Snímky do --out: počítač 1280×800 (hlavná obrazovka, nastavenia súhlasu, karta lietadla), telefón 375×812
// (lišta so súhlasom, nastavenia súhlasu, hárok Vrstvy).
//
// Usage: node scripts/qa-icon-font.mjs [--base http://localhost:4173] [--out output/qa-icon-font]
// Mapa = OSM (?qaBasemap=osm), nemíňa kvótu Google 3D dlaždíc. Lietadlo berie z /api/opensky/states/all
// dev servera (cachovaná odpoveď). Pri chybe vypíše čo a skončí kódom 1.
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const BASE = opt('base', 'http://localhost:4173');
const OUT = opt('out', 'output/qa-icon-font');
fs.mkdirSync(OUT, { recursive: true });
const VIEW = '#v=2&lat=48.17&lon=17.21&alt=8000&heading=360&pitch=-30&roll=0&style=normal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickAircraft() {
  try {
    const data = await (await fetch(`${BASE}/api/opensky/states/all`)).json();
    const near = (data.states || []).filter((s) => s[5] && s[6] && !s[8] && Math.abs(s[6] - 48.17) < 1.5 && Math.abs(s[5] - 17.2) < 2.5);
    return near.length ? String(near[0][0]).toLowerCase() : null;
  } catch { return null; }
}

/** Beží v stránke: písmo, každý glyf výrezu, viditeľné prvky s triedou. */
async function measureIcons() {
  await document.fonts.ready;
  const manifest = await (await fetch('/fonts/material-symbols-subset.json')).json();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:24px;';
  document.body.append(host);
  const asText = [];
  for (const name of manifest.icons) {
    const s = document.createElement('span');
    s.className = 'material-symbols-outlined';
    s.textContent = name;
    host.append(s);
    const w = s.getBoundingClientRect().width;
    if (w < 16 || w > 30) asText.push(`${name} ${Math.round(w)} px`);
  }
  host.remove();
  const icons = [...document.querySelectorAll('.material-symbols-outlined')];
  const visible = icons.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const wide = visible
    .filter((e) => e.getBoundingClientRect().width > parseFloat(getComputedStyle(e).fontSize) * 1.6)
    .map((e) => `${e.textContent.trim()} ${Math.round(e.getBoundingClientRect().width)} px`);
  const names = performance.getEntriesByType('resource').map((r) => r.name);
  return {
    icons: manifest.icons.length,
    asText,
    visible: visible.length,
    wide,
    fontStatus: [...document.fonts].filter((f) => f.family.includes('Material Symbols')).map((f) => f.status),
    subsetRequested: names.some((n) => /\/fonts\/material-symbols-subset\.woff2\?v=[0-9a-f]{10}$/.test(n)),
    googleMaterial: names.filter((n) => /googleapis\.com.*Material/.test(n)).length,
  };
}

const browser = await puppeteer.launch({
  headless: true, pipe: true, protocolTimeout: 300_000,
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--lang=sk-SK'],
});
const failures = [];
const hex = await pickAircraft();
if (!hex) failures.push('žiadne lietadlo nad BA v /api/opensky — krok s kartou preskočený');

async function openPage(page, hash) {
  await page.goto('about:blank');
  await page.goto(`${BASE}/?qaBasemap=osm&consent=preview${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('loading-screen');
    return el?.classList.contains('hidden') && (getComputedStyle(el).display === 'none' || Number(getComputedStyle(el).opacity) === 0);
  }, { timeout: 180_000, polling: 500 });
  await sleep(4000);
}

async function check(page, tag) {
  const m = await page.evaluate(measureIcons);
  const fail = (msg) => { failures.push(`${tag}: ${msg}`); console.log(`  ✖ ${msg}`); };
  if (!m.fontStatus.includes('loaded')) fail(`písmo Material Symbols nie je načítané (${m.fontStatus.join(',') || 'žiadne'})`);
  if (!m.subsetRequested) fail('výrez sa nepýtal z /fonts/material-symbols-subset.woff2?v=…');
  if (m.googleMaterial) fail(`${m.googleMaterial}× Material z fonts.googleapis.com`);
  if (m.asText.length) fail(`glyfy ako text: ${m.asText.join(', ')}`);
  if (m.wide.length) fail(`viditeľné ikony ako text: ${m.wide.join(', ')}`);
  console.log(`  ${m.icons} glyfov výrezu OK, ${m.visible} viditeľných ikon, písmo ${m.fontStatus.join(',')}`);
  return m;
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  snímka ${OUT}/${name}.png`);
}

// Počítač
{
  console.log('— počítač 1280×800');
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await openPage(page, VIEW);
  await check(page, 'počítač');
  await shot(page, 'pocitac-hlavna');
  await page.evaluate(() => document.querySelector('#oko-consent [data-consent="settings"]')?.click());
  await sleep(800);
  await check(page, 'počítač/súhlas');
  await shot(page, 'pocitac-suhlas-nastavenia');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#oko-consent [data-consent="reject"]')?.click());
  if (hex) {
    await openPage(page, `${VIEW}&subj=flights.t.${hex}`);
    try {
      await page.waitForSelector('.card-close[data-card-kind="tracked"]:not([hidden])', { timeout: 60_000 });
    } catch { failures.push(`počítač: karta lietadla ${hex} sa neotvorila`); }
    await sleep(1500);
    await check(page, 'počítač/karta');
    await shot(page, 'pocitac-karta-lietadla');
  }
  await page.close();
}

// Telefón na výšku
{
  console.log('— telefón 375×812');
  const page = await browser.newPage();
  await page.emulate({
    viewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await openPage(page, VIEW);
  await check(page, 'telefón');
  await shot(page, 'telefon-hlavna');
  await page.evaluate(() => document.querySelector('#oko-consent [data-consent="settings"]')?.click());
  await sleep(800);
  await check(page, 'telefón/súhlas');
  await shot(page, 'telefon-suhlas-nastavenia');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#oko-consent [data-consent="reject"]')?.click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('#oko-appbar [data-oko-section="layers"]')?.click());
  await sleep(1200);
  await check(page, 'telefón/hárok');
  await shot(page, 'telefon-harok-vrstvy');
  await page.close();
}

await browser.close();
if (failures.length) {
  console.log(`\nNálezy (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('\nVšetky ikony z výrezu sú na mieste.');
}
