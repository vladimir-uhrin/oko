// scripts/qa-mideast-panel.mjs — kontrola ROZLOŽENIA modulu BLÍZKY VÝCHOD v skutočnom prehliadači (2026-10-03).
//
// Prečo: jednotkové testy čítajú text a stav, nie obrazovku. Po vydaní etapy 5 ukázala až snímka, že
//   (1) bubliny nad bodmi sa orezávali na jeden riadok šírky 320 px,
//   (2) v paneli sa správy kreslili CEZ prechody úžinami a zoznam správ mal výšku 0,
//   (3) kartičky správ sedeli na logu, rozbalenom paneli a riadku atribúcie.
// Tento skript to meria: otvorí OKO, zapne dejisko, rozbalí panel a overí ČÍSLA z rozloženia
// (obdĺžniky prvkov, nie texty v zdrojáku). Pri chybe vypíše, čo sa prekrýva, a skončí kódom 1.
// Snímky uloží do --out, aby sa dalo pozrieť aj okom.
//
// Usage: node scripts/qa-mideast-panel.mjs [--base http://localhost:4173] [--out output/qa-mideast]
//          [--theatres hormuz,overview] [--sizes 1600x900,1366x768] [--settle 30000]
//
// Spúšťa sa ručne pred zverejnením zmien v paneli, vrstvách a kartách BLÍZKEHO VÝCHODU. Potrebuje GPU
// (bez neho sa glóbus nevykreslí — rovnaké prepínače ako scripts/capture-event-video.mjs). Jedno
// spustenie = JEDNO načítanie stránky (jedna relácia 3D dlaždíc); nespúšťať v slučke.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

import { HOTCARD_CLIP_SELECTOR, HOTCARD_OBSTACLE_SELECTOR } from '../src/gulfIncidentCards.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const BASE = opt('base', 'http://localhost:4173').replace(/\/+$/, '');
const OUT = path.resolve(opt('out', 'output/qa-mideast'));
const THEATRES = opt('theatres', 'hormuz,overview').split(',').map((s) => s.trim()).filter(Boolean);
const SIZES = opt('sizes', '1600x900,1366x768').split(',').map((s) => s.trim().split('x').map(Number)).filter(([w, h]) => w > 0 && h > 0);
const SETTLE_MS = Number(opt('settle', '30000')) || 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const notes = [];
const fail = (where, what) => { failures.push(`${where}: ${what}`); console.log(`  ✖ ${where}: ${what}`); };
const pass = (where, what) => { console.log(`  ✔ ${where}: ${what}`); };
const check = (ok, where, what, detail = '') => { if (ok) pass(where, what); else fail(where, `${what}${detail ? ` — ${detail}` : ''}`); };

fs.mkdirSync(OUT, { recursive: true });
const [W0, H0] = SIZES[0];
const browser = await puppeteer.launch({
  headless: true, pipe: true, protocolTimeout: 300_000,
  args: ['--no-sandbox', `--window-size=${W0},${H0}`, '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--lang=sk-SK'],
});

/** Rozloženie panela: súrodenci v tele sa neprekrývajú, nič nepreteká zo svojho rámca, zoznam správ má výšku. */
const measurePanel = () => {
  const body = document.querySelector('#mideast-panel [data-mideast-body]');
  if (!body) return { error: 'telo panela nenájdené' };
  const kids = [...body.children].filter((k) => k.offsetHeight > 0);
  const rows = kids.map((k) => ({ cls: k.className || k.tagName, top: k.offsetTop, height: k.offsetHeight, scroll: k.scrollHeight, client: k.clientHeight }));
  const overlaps = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    if (prev.top + prev.height > rows[i].top + 1) overlaps.push(`„${prev.cls}" (${prev.top}–${prev.top + prev.height}) zasahuje do „${rows[i].cls}" (od ${rows[i].top})`);
  }
  const squeezed = rows.filter((r) => r.scroll > r.client + 1).map((r) => `„${r.cls}" obsah ${r.scroll} px v rámci ${r.client} px`);
  const list = body.querySelector('.oko-bul-list');
  return {
    sections: rows.length, overlaps, squeezed,
    newsItems: body.querySelectorAll('.oko-bul-item').length,
    newsListHeight: list ? list.clientHeight : -1,
    bodyScrolls: body.scrollHeight > body.clientHeight + 1,
    bodyClient: body.clientHeight, bodyScroll: body.scrollHeight,
  };
};

/** Karty správ voči prekážkam rozhrania a voči sebe (obdĺžniky v okne). */
const measureCards = (selector, clipSelector) => {
  // Viditeľná časť prvku: panel odrolovaný pod okraj stĺpca má obdĺžnik, ale nie je ho vidieť.
  const box = (el) => {
    const r = el.getBoundingClientRect();
    let x0 = r.left; let y0 = r.top; let x1 = r.right; let y1 = r.bottom;
    const clip = el.closest(clipSelector);
    if (clip && clip !== el && (getComputedStyle(clip).overflowY !== 'visible' || getComputedStyle(clip).overflowX !== 'visible')) {
      const c = clip.getBoundingClientRect();
      x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom);
    }
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };
  const shown = (el) => (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true);
  const hit = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  const label = (el) => (el.id ? `#${el.id}` : `.${String(el.className).split(/\s+/).slice(0, 2).join('.')}`);
  const cards = [...document.querySelectorAll('.oko-hotcard')].filter((c) => getComputedStyle(c).visibility === 'visible' && c.offsetWidth > 0)
    .map((c) => ({ place: c.querySelector('.oko-hc-place')?.textContent || '?', ...box(c) }));
  const obstacles = [...document.querySelectorAll(selector)].filter((n) => shown(n)).map((n) => ({ name: label(n), ...box(n) })).filter((o) => o.w > 0 && o.h > 0 && o.x < innerWidth && o.y < innerHeight && o.x + o.w > 0 && o.y + o.h > 0);
  const onUi = [];
  for (const c of cards) for (const o of obstacles) if (hit(c, o)) onUi.push(`karta „${c.place}" (${Math.round(c.x)},${Math.round(c.y)} ${Math.round(c.w)}×${Math.round(c.h)}) leží na ${o.name} (${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.w)}×${Math.round(o.h)})`);
  const onEachOther = [];
  for (let i = 0; i < cards.length; i += 1) for (let j = i + 1; j < cards.length; j += 1) if (hit(cards[i], cards[j])) onEachOther.push(`„${cards[i].place}" × „${cards[j].place}"`);
  const outside = cards.filter((c) => c.x < 0 || c.y < 0 || c.x + c.w > innerWidth || c.y + c.h > innerHeight).map((c) => c.place);
  // Vodiace čiary a bodky smú byť vidieť len pri bode, ktorý je v okne a nie pod panelom.
  const strayPins = [...document.querySelectorAll('.oko-hc-pin')].filter((p) => getComputedStyle(p).visibility === 'visible').map((p) => box(p))
    .filter((p) => { const cx = p.x + p.w / 2; const cy = p.y + p.h / 2; return cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight || obstacles.some((o) => cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h); }).length;
  return { cards: cards.length, obstacles: obstacles.map((o) => `${o.name} ${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.w)}×${Math.round(o.h)}`), onUi, onEachOther, outside, strayPins };
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: W0, height: H0, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('oko-lang', 'sk'); } catch { /* súkromné okno */ } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  const first = THEATRES[0] || 'hormuz';
  console.log(`OKO: ${BASE}/?mideast=${first} · okná ${SIZES.map((s) => s.join('×')).join(', ')} · dejiská ${THEATRES.join(', ')}`);
  for (let attempt = 1; ; attempt += 1) {
    // Vite po reštarte vie odpovedať 504 „Outdated Request" — nové načítanie pomôže.
    await page.goto(`${BASE}/?mideast=${first}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    try {
      await page.waitForFunction(() => window.__godsEyeView?.viewer && window.__godsEyeView?.ukmtoIncidents && window.__godsEyeView?.mideastPanel, { timeout: 120_000 });
      break;
    } catch (error) {
      if (attempt >= 2) throw error;
      console.log('  … stránka nenabehla, skúšam ešte raz');
    }
  }
  await sleep(SETTLE_MS);

  // Panel rozbaliť (návštevník: klik na +) a počkať na správy v paneli.
  await page.evaluate(() => { const p = document.getElementById('mideast-panel'); if (p?.classList.contains('collapsed')) p.querySelector('.panel-collapse-btn')?.click(); });
  await page.waitForFunction(() => document.querySelectorAll('#mideast-panel .oko-bul-item').length > 0, { timeout: 45_000 }).catch(() => notes.push('správy v paneli sa do 45 s nenačítali (kontrola výšky zoznamu preskočená)'));
  await sleep(1500);

  const project = (lon, lat) => page.evaluate((x, y) => {
    const s = window.__godsEyeView.viewer.scene;
    const fn = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
    const w = fn(s, Cesium.Cartesian3.fromDegrees(x, y));
    if (!w) return null;
    return { x: w.x, y: w.y, onCanvas: document.elementFromPoint(w.x, w.y)?.tagName === 'CANVAS' };
  }, lon, lat);
  const tipState = (cls) => page.evaluate((c) => {
    const tip = document.querySelector(c);
    if (!tip || tip.hidden) return null;
    const r = tip.getBoundingClientRect();
    const cs = getComputedStyle(tip);
    return { text: tip.textContent, x: r.left, y: r.top, w: r.width, h: r.height, clipped: tip.scrollWidth > tip.clientWidth + 1, whiteSpace: cs.whiteSpace, lineHeight: parseFloat(cs.lineHeight) || 14, vw: innerWidth, vh: innerHeight };
  }, cls);

  for (const [w, h] of SIZES) {
    const size = `${w}×${h}`;
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await sleep(2500);
    for (const theatre of THEATRES) {
      const where = `${theatre} ${size}`;
      console.log(`\n── ${where}`);
      await page.evaluate((id) => document.querySelector(`#mideast-panel [data-theatre="${id}"]`)?.click(), theatre);
      await sleep(9000); // let 3 s + dlaždice + karty regiónu
      await page.evaluate(() => { const b = document.querySelector('#mideast-panel [data-mideast-body]'); if (b) b.scrollTop = 0; });
      await sleep(600);

      // 1. panel
      const panel = await page.evaluate(measurePanel);
      if (panel.error) { fail(where, panel.error); continue; }
      check(panel.overlaps.length === 0, where, `sekcie panela sa neprekrývajú (${panel.sections} sekcií)`, panel.overlaps.join('; '));
      check(panel.squeezed.length === 0, where, 'žiadna sekcia nie je stlačená pod svoj obsah', panel.squeezed.join('; '));
      if (panel.newsItems > 0) check(panel.newsListHeight >= 40, where, `zoznam správ je vidieť (${panel.newsItems} správ, výška ${panel.newsListHeight} px)`);
      else notes.push(`${where}: správy v paneli nie sú načítané`);

      // 2. karty správ
      const cards = await page.evaluate(measureCards, HOTCARD_OBSTACLE_SELECTOR, HOTCARD_CLIP_SELECTOR);
      check(cards.onUi.length === 0, where, `karty správ neležia na rozhraní (${cards.cards} kariet, ${cards.obstacles.length} prekážok)`, cards.onUi.join('; '));
      check(cards.onEachOther.length === 0, where, 'karty správ sa neprekrývajú navzájom', cards.onEachOther.join('; '));
      check(cards.outside.length === 0, where, 'karty správ sú celé v okne', cards.outside.join(', '));
      check(cards.strayPins === 0, where, 'bodka a čiara len pri viditeľnom mieste', `${cards.strayPins} bodiek mimo okna alebo pod panelom`);
      if (!cards.cards) notes.push(`${where}: žiadna karta správ na mape (správy bez miesta v zábere)`);
      console.log(`    prekážky: ${cards.obstacles.join(' | ')}`);

      // 3. bublina nad varovaním UKMTO
      const incidents = await page.evaluate(() => window.__godsEyeView.ukmtoIncidents.getState().incidents.slice(0, 40).map((it) => ({ ref: it.ref, lon: it.lon, lat: it.lat })));
      let tip = null;
      for (const it of incidents) {
        const p = await project(it.lon, it.lat);
        if (!p?.onCanvas) continue;
        await page.mouse.move(p.x - 30, p.y - 24);
        await page.mouse.move(p.x, p.y, { steps: 6 });
        await sleep(450);
        tip = await tipState('.oko-ukmto-tip');
        if (tip) break;
      }
      if (!tip) {
        notes.push(`${where}: žiadny bod UKMTO pod kurzorom (mimo záberu) — bublina neoverená`);
      } else {
        check(tip.whiteSpace === 'normal' && !tip.clipped, where, 'bublina varovania sa zalamuje, text nie je orezaný', `white-space ${tip.whiteSpace}, orezaná ${tip.clipped}`);
        check(tip.h > tip.lineHeight * 1.8, where, `bublina má viac riadkov (${Math.round(tip.h)} px)`);
        check(tip.x >= 0 && tip.y >= 0 && tip.x + tip.w <= tip.vw && tip.y + tip.h <= tip.vh, where, 'bublina je celá v okne', `${Math.round(tip.x)},${Math.round(tip.y)} ${Math.round(tip.w)}×${Math.round(tip.h)} v ${tip.vw}×${tip.vh}`);
        check(/UKMTO/.test(tip.text) && /zdroj: UKMTO/.test(tip.text), where, 'bublina menuje varovanie aj zdroj');
        await page.screenshot({ path: path.join(OUT, `${theatre}-${w}x${h}-bublina.png`) });
        // kurzor odíde z mapy na panel → bublina zmizne
        const panelBox = await page.evaluate(() => { const r = document.querySelector('#mideast-panel .panel-header')?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
        if (panelBox) {
          await page.mouse.move(panelBox.x, panelBox.y, { steps: 4 });
          await sleep(400);
          check((await tipState('.oko-ukmto-tip')) === null, where, 'bublina zmizne, keď kurzor odíde z mapy na panel');
        }
      }
      await page.mouse.move(Math.round(w / 2), 4);
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, `${theatre}-${w}x${h}.png`) });
      // spodok panela (prechody úžinami + správy) na snímke
      await page.evaluate(() => document.querySelector('#mideast-panel [data-mideast-transits]')?.scrollIntoView({ block: 'start' }));
      await sleep(500);
      await page.screenshot({ path: path.join(OUT, `${theatre}-${w}x${h}-panel-dole.png`) });
    }
  }
  if (pageErrors.length) notes.push(`chyby stránky: ${[...new Set(pageErrors)].slice(0, 5).join(' | ')}`);
} finally {
  await browser.close().catch(() => {});
}

console.log('');
for (const n of notes) console.log(`pozn.: ${n}`);
if (failures.length) {
  console.log(`\nZLYHALO ${failures.length}:`);
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
console.log(`\nV poriadku — snímky v ${OUT}`);
