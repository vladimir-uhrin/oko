#!/usr/bin/env node
// OKO — kontrola karty lietadla pred publikovaním (pravidlo vlastníka z 2026-09-30: „už sa to nesmie stávať,
// že by som niečo 3 krát opravoval" — trasa, ETA a číslo letu z karty lietadla mizli opakovane).
//
// Chrome s GPU (puppeteer) otvorí skutočnú appku z localhostu nad strednou Európou (podklad OSM — žiadne
// dlaždice Google), zapne lietadlá, vyberie let, ktorý má v údajoch karty číslo letu aj čas do pristátia,
// prejde naň myšou a klikne. Overí kartu pri prechode myšou (číslo letu, trasa „A → B", čas pristátia, grafy)
// a uloží dve snímky obrazovky — karta po kliknutí sa kreslí do plátna, tú treba pozrieť očami.
//
//   node scripts/qa-flight-card.mjs [--url http://localhost:4173] [--out qa-shots]
// Koniec 0 = karta pri prechode myšou má všetko; 1 = niečo chýba (výpis povie čo); 2 = nedalo sa overiť
// (žiadne lietadlo s trasou v zábere — skúsiť znova, v noci je letov menej).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const puppeteer = require('puppeteer');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const baseUrl = flag('--url', 'http://localhost:4173').replace(/\/+$/, '');
const outDir = path.resolve(root, flag('--out', 'qa-shots'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[qa-flight-card]', ...a);
const W = 1500; const H = 900;
// Pohľad kolmo zhora na strednú Európu; okraje nechávajú miesto panelom a karte.
const hash = 'v=2&lat=48.9&lon=15.5&alt=650000&heading=0&pitch=-89&roll=0&map=osm';
const SAFE = { left: 420, right: 420, top: 160, bottom: 200 };

/** Čo musí karta pri prechode myšou niesť. Pure. */
export function hoverCardProblems(text, { callsign, flightIata }) {
  const t = String(text || '');
  const problems = [];
  if (callsign && !t.includes(callsign)) problems.push(`chýba volací znak ${callsign}`);
  if (flightIata && !t.includes(flightIata)) problems.push(`chýba číslo letu ${flightIata}`);
  if (!/\S\s*→\s*\S/.test(t)) problems.push('chýba trasa (A → B)');
  if (!/\(\d{1,2}:\d{2}\)/.test(t)) problems.push('chýba čas pristátia (HH:MM)');
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: true, protocolTimeout: 120_000, args: ['--no-sandbox', `--window-size=${W},${H}`, '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  let code = 2;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/?qa=${Date.now()}#${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    let ready = false;
    for (let i = 0; i < 240 && !ready; i += 1) {
      ready = await page.evaluate(() => Boolean(window.__godsEyeView?.viewer) && document.getElementById('loading-screen')?.classList.contains('hidden')).catch(() => false);
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error(`OKO sa nenačítalo (${baseUrl})`);
    // Zapnutie vrstvy sa len spustí — jej prísľub môže čakať na ďalšie kroky appky.
    await page.evaluate(() => { const dm = window.__godsEyeView.dataManager; if (!dm.isEnabled('flights')) void dm.setEnabled('flights', true); });
    let count = 0;
    for (let i = 0; i < 60 && count < 20; i += 1) {
      await sleep(2000);
      count = await page.evaluate(() => window.__godsEyeView.dataManager.layers.get('flights')?.module?.getAllPositions?.().length || 0);
    }
    log(`lietadiel vo vrstve: ${count}`);
    if (!count) throw new Error('vrstva lietadiel nemá kontakty');
    // Kandidáti v zábere so súhrnom karty (z neho sa karta kreslí); detaily (trasa) sa dotiahnu zo služby.
    let target = null;
    for (let round = 0; round < 4 && !target; round += 1) {
      const candidates = await page.evaluate(async ({ w, h, safe }) => {
        const g = window.__godsEyeView;
        const mod = g.dataManager.layers.get('flights').module;
        const inView = [];
        for (const p of mod.getAllPositions()) {
          const s = p.position ? g.viewer.scene.cartesianToCanvasCoordinates(p.position) : null;
          if (!s || s.x < safe.left || s.x > w - safe.right || s.y < safe.top || s.y > h - safe.bottom) continue;
          inView.push({ id: p.id, callsign: p.label || null, x: Math.round(s.x), y: Math.round(s.y) });
        }
        for (const c of inView) { try { mod.prefetchContactDetails?.(c.id); } catch { /* detail sa dotiahne pri karte */ } }
        await new Promise((r) => setTimeout(r, 6000));
        for (const c of inView) {
          try { const s = mod.getContactSummary(c.id); c.flightIata = s?.flightIata || null; c.etaMinutes = Number.isFinite(s?.progress?.etaMinutes) ? s.progress.etaMinutes : null; } catch { /* kontakt medzitým zmizol */ }
        }
        return inView;
      }, { w: W, h: H, safe: SAFE });
      log(`v zábere ${candidates.length}; s číslom letu ${candidates.filter((c) => c.flightIata).length}, s časom pristátia ${candidates.filter((c) => c.etaMinutes !== null).length}`);
      target = candidates.find((c) => c.flightIata && c.etaMinutes !== null) || null;
    }
    if (!target) { await page.screenshot({ path: path.join(outDir, 'flight-card-none.png') }); throw new Error('v zábere nie je let s číslom letu a časom pristátia — skús znova'); }
    // Lietadlo sa hýbe — poloha tesne pred pohybom myši.
    const pos = await page.evaluate((id) => {
      const g = window.__godsEyeView;
      const p = g.dataManager.layers.get('flights').module.getAllPositions().find((q) => q.id === id);
      const s = p?.position ? g.viewer.scene.cartesianToCanvasCoordinates(p.position) : null;
      return s ? { x: Math.round(s.x), y: Math.round(s.y) } : null;
    }, target.id);
    if (!pos) throw new Error(`let ${target.callsign} medzitým zmizol — skús znova`);
    log(`let ${target.callsign} · ${target.flightIata} (do pristátia ${Math.round(target.etaMinutes)} min) na [${pos.x}, ${pos.y}]`);
    await page.mouse.move(pos.x - 60, pos.y - 60);
    await page.mouse.move(pos.x, pos.y, { steps: 10 });
    await sleep(2200);
    const hover = await page.evaluate(() => {
      const el = document.querySelector('.contact-hover-card');
      if (!el || getComputedStyle(el).display === 'none') return null;
      return { text: (el.innerText || '').replace(/\s+/g, ' ').trim(), charts: el.querySelectorAll('.contact-hover-card-chart').length };
    });
    await page.screenshot({ path: path.join(outDir, 'flight-card-hover.png') });
    log(`karta pri prechode myšou: ${hover ? hover.text.slice(0, 400) : 'NIE JE'}`);
    const problems = hover ? hoverCardProblems(hover.text, target) : ['karta pri prechode myšou sa neukázala'];
    if (hover && hover.charts < 2) problems.push(`grafy výšky a rýchlosti: ${hover.charts} z 2`);
    await page.mouse.click(pos.x, pos.y);
    await sleep(5000);
    await page.screenshot({ path: path.join(outDir, 'flight-card-click.png') });
    log(`snímky: ${path.join(outDir, 'flight-card-hover.png')}, ${path.join(outDir, 'flight-card-click.png')} (kartu po kliknutí pozri na snímke)`);
    if (problems.length) { for (const p of problems) log(`CHYBA: ${p}`); code = 1; } else { log('karta pri prechode myšou: číslo letu, trasa, čas pristátia a grafy sú na mieste'); code = 0; }
  } catch (error) {
    log(`nedalo sa overiť: ${error.message}`);
    code = 2;
  } finally {
    await browser.close();
  }
  process.exit(code);
}
