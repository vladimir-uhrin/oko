#!/usr/bin/env node
// Snímky záložky Naživo v admine (2026-10-04) s podstrčenou reláciou a /api/admin/live —
// rozloženie mapy, zhlukov a zoznamu sa dá overiť bez vydania oko-api a bez účtu.
// Usage: node scripts/qa-admin-live.mjs [--base http://localhost:4173] [--out output/qa-live]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const BASE = opt('base', 'http://localhost:4173').replace(/\/+$/, '');
const OUT = path.resolve(opt('out', 'output/qa-live'));
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const v = (city, country, lat, lon, precision, device, path, activeS) => ({ city, country, region: '', lat, lon, precision, device, path, views: 1, activeS, idleS: 20 });
const SCENES = {
  slovensko: [v('Bratislava', 'SK', 48.1, 17.1, 'city', 'desktop', '/', 640), v('Bratislava', 'SK', 48.2, 17.2, 'city', 'mobil', '/sk/', 90),
    v('Košice', 'SK', 48.7, 21.3, 'city', 'mobil', '/', 1500), v('Žilina', 'SK', 49.2, 18.7, 'city', 'desktop', '/s/*', 30),
    v('Brno', 'CZ', 49.2, 16.6, 'city', 'tablet', '/en/', 300)],
  svet: [v('Bratislava', 'SK', 48.1, 17.1, 'city', 'desktop', '/', 640), v('London', 'GB', 51.5, -0.1, 'city', 'mobil', '/en/', 90),
    v('', 'US', 38.9, -77.0, 'country', 'desktop', '/', 200), v('Tokyo', 'JP', 35.7, 139.7, 'city', 'mobil', '/', 50),
    v('Kyiv', 'UA', 50.5, 30.5, 'city', 'desktop', '/', 4000), v('', '??', null, null, 'none', 'desktop', '/', 10)],
};
const snapshot = visitors => ({
  at: now, liveNow: visitors.length, windowS: 150, visitors, cityPrecision: visitors.some(x => x.precision === 'city'),
  recent: visitors.map((x, i) => ({ at: now - i * 47_000, agoS: i * 47, country: x.country, city: x.city, path: x.path, device: x.device, ref: i % 2 ? 'google.com' : 'priamo' })),
  history: Array.from({ length: 90 }, (_, i) => ({ at: now - (89 - i) * 60_000, n: Math.max(0, Math.round(3 + 2 * Math.sin(i / 9))) })),
});

const browser = await puppeteer.launch({ headless: 'new', defaultViewport: null,
  args: ['--no-sandbox', '--window-size=1400,1100', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--lang=sk-SK'] });
const failures = [];
try {
  for (const [name, visitors] of Object.entries(SCENES)) {
    for (const [label, width, height] of [['desktop', 1360, 1000], ['mobil', 390, 844]]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: label === 'mobil' ? 2 : 1 });
      page.on('pageerror', error => failures.push(`${name}/${label}: ${error.message}`));
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = new URL(request.url());
        const json = body => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/api/auth/session') return json({ user: { email: 'qa@okolive.sk', role: 'owner' }, csrfToken: 'x' });
        if (url.pathname === '/api/admin/live') return json(snapshot(visitors));
        if (url.pathname.startsWith('/api/')) return request.respond({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
        return request.continue();
      });
      await page.goto(`${BASE}/admin.html#live`, { waitUntil: 'networkidle0', timeout: 60_000 });
      await page.waitForSelector('.live-map canvas', { timeout: 30_000 });
      await new Promise(resolve => setTimeout(resolve, 1200));
      const check = await page.evaluate(() => ({
        count: document.querySelector('.live-count-value')?.textContent,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        feed: document.querySelectorAll('.live-feed li').length,
        canvasW: document.querySelector('.live-map canvas').clientWidth,
        pressed: document.querySelector('.admin-range [aria-pressed="true"]:not(:first-child)')?.textContent,
      }));
      if (check.overflow) failures.push(`${name}/${label}: vodorovné pretečenie stránky`);
      if (String(check.count) !== String(visitors.length)) failures.push(`${name}/${label}: počet ${check.count}`);
      // Najbližší bod: prejsť myšou nad Bratislavu a ukázať bublinu.
      const box = await page.$eval('.live-map canvas', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      console.log(name, label, JSON.stringify(check), JSON.stringify(box));
      await page.screenshot({ path: path.join(OUT, `${name}-${label}.png`), fullPage: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`OK → ${OUT}`);
