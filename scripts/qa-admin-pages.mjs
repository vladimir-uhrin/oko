#!/usr/bin/env node
// Snímky admina (2026-10-04): navigácia v skupinách, Prehľad s pásom „čo horí", Analytika s porovnaním
// a značkami príspevkov, záznam návštev podľa IP a tabuľky ako karty na mobile — s podstrčeným API.
// Usage: node scripts/qa-admin-pages.mjs [--base http://localhost:4173] [--out output/qa-admin]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const BASE = opt('base', 'http://localhost:4173').replace(/\/+$/, '');
const OUT = path.resolve(opt('out', 'output/qa-admin'));
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const DAY = 86400_000;
const day = offset => new Date(now - offset * DAY).toISOString().slice(0, 10);
const series = Array.from({ length: 30 }, (_, i) => ({ day: day(29 - i), views: 40 + Math.round(30 * Math.sin(i / 4)) + i * 3, visitors: 12 + i, minutes: 90 + i * 4, bots: 3 }));
const MOCK = {
  '/api/auth/session': { user: { email: 'vladouh76@gmail.com', role: 'owner' }, csrfToken: 'x' },
  '/api/admin/overview': { stats: { users: 3, verified: 2, new24h: 0, new7d: 1, activeUsers: 1, activeSessions: 2, logins24h: 4, disabled: 0, follows: 5 }, server: null },
  '/api/admin/attention': { liveNow: 4, items: [
    { level: 'bad', tab: 'feeds', text: 'TomTom doprava neodpovedá (40 min, HTTP 502)' },
    { level: 'warn', tab: 'costs', text: 'Google Places: 85 % denného stropu' },
    { level: 'warn', tab: 'errors', text: '3 nové chyby za 24 h' },
    { level: 'info', tab: 'studio', text: 'Štúdio: 2 návrhov čaká na schválenie' }] },
  '/api/admin/analytics': { days: 30, liveNow: 4, series, totals: { views: 3200, visitors: 820, minutes: 5400, bots: 90 }, previous: { views: 2500, visitors: 900, minutes: 5400, bots: 70 },
    published: [{ day: day(20), titles: ['FZ1073: núdzové pristátie'] }, { day: day(6), titles: ['Týždeň na fronte'] }],
    dims: { ref: [{ val: 'google.com', n: 300 }, { val: 'facebook.com', n: 120 }], country: [{ val: 'SK', n: 2400 }, { val: 'CZ', n: 300 }], path: [{ val: '/', n: 2800 }] } },
  '/api/admin/health': {
    upstream: [
      { name: 'adsb.lol', lastHour: { n: 61, limited: 0, errors: 0 }, last24h: { n: 1310, limited: 2, errors: 1 }, pausedUntil: null, lastLimitedAt: now - 5 * 3600_000 },
      { name: 'adsbdb', lastHour: { n: 140, limited: 3, errors: 0 }, last24h: { n: 2600, limited: 41, errors: 4 }, pausedUntil: now + 240_000, lastLimitedAt: now - 60_000 },
      { name: 'nominatim', lastHour: { n: 4, limited: 0, errors: 0 }, last24h: { n: 37, limited: 0, errors: 0 }, pausedUntil: null, lastLimitedAt: null },
    ],
    cards: Array.from({ length: 24 }, (_, i) => ({ at: now - (23 - i) * 3600_000, n: i % 3 ? 4 : 0, route: i > 18 ? 0 : (i % 3 ? 3 : 0), type: i % 3 ? 4 : 0, airline: i % 3 ? 3 : 0 })),
  },
  '/api/admin/traffic': { hours: 24, series: [{ at: now, n: 100, e5: 0, e4: 1, blocked: 0, avgMs: 40, bytes: 1000 }], routes: [] },
  '/api/admin/accounts-chart': { series: series.map(d => ({ day: d.day, registrations: 0, logins: 1 })) },
  '/api/admin/users': { total: 2, users: [
    { id: '00000000-0000-0000-0000-000000000001', email: 'vladouh76@gmail.com', displayName: 'Vladimír', role: 'owner', emailVerified: true, createdAt: now - 9 * DAY, lastSeenAt: now, sessions: 1, providers: [] },
    { id: '00000000-0000-0000-0000-000000000002', email: 'clen@example.com', displayName: 'Člen', role: 'member', emailVerified: false, createdAt: now - 2 * DAY, lastSeenAt: now - DAY, sessions: 0, providers: [] }] },
};
const groupsMock = { days: 1, q: '', limit: 100, offset: 0, byIp: true, retentionDays: 30, yourIp: '95.102.1.2', ignoredIps: ['95.102.1.2'], total: 9, ips: 2,
  groups: [{ ip: '203.0.113.5', views: 6, pages: 3, first: now - 3 * 3600_000, last: now - 60_000, ms: 1_260_000, city: 'Košice', country: 'SK', device: 'mobil · Chrome · Android', paths: ['/', '/en/', '/s/*'] },
    { ip: '198.51.100.7', views: 3, pages: 1, first: now - 7200_000, last: now - 3600_000, ms: 180_000, city: 'Brno', country: 'CZ', device: 'desktop · Firefox · Windows', paths: ['/'] }] };

const browser = await puppeteer.launch({ headless: 'new', defaultViewport: null,
  args: ['--no-sandbox', '--window-size=1400,1100', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--lang=sk-SK'] });
const failures = [];
try {
  for (const [label, width, height] of [['desktop', 1360, 1000], ['mobil', 390, 844]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: label === 'mobil' ? 2 : 1 });
    page.on('pageerror', error => failures.push(`${label}: ${error.message}`));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      const body = url.pathname === '/api/admin/visits' ? groupsMock : MOCK[url.pathname];
      if (body) return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/api/')) return request.respond({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
      return request.continue();
    });
    const shot = async (hash, name, check) => {
      await page.goto(`${BASE}/admin.html#${hash}`, { waitUntil: 'networkidle0', timeout: 60_000 });
      await new Promise(resolve => setTimeout(resolve, 900));
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        group: document.querySelector('.admin-groups [aria-current="page"]')?.textContent,
        sub: document.querySelector('.admin-subtabs:not([hidden]) [aria-current="page"]')?.textContent || null,
        font: getComputedStyle(document.body).fontFamily.split(',')[0],
        fontsReady: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).sort().join(','),
      }));
      const extra = check ? await page.evaluate(check) : {};
      console.log(label, name, JSON.stringify({ ...state, ...extra }));
      if (state.overflow) failures.push(`${label}/${name}: vodorovné pretečenie`);
      await page.screenshot({ path: path.join(OUT, `${name}-${label}.png`), fullPage: true });
      return { ...state, ...extra };
    };
    const overview = await shot('overview', 'prehlad', () => ({ items: document.querySelectorAll('.attention-item').length }));
    if (overview.items !== 4) failures.push(`${label}: čo horí má ${overview.items} položiek`);
    if (overview.group !== 'Prehľad') failures.push(`${label}: skupina ${overview.group}`);
    const analytics = await shot('analytics', 'analytika', () => ({ deltas: [...document.querySelectorAll('.admin-delta')].map(d => d.textContent), events: document.querySelectorAll('.chart-event').length }));
    if (analytics.group !== 'Návštevnosť' || analytics.sub !== 'Analytika') failures.push(`${label}: analytika v ${analytics.group}/${analytics.sub}`);
    if (analytics.events !== 2) failures.push(`${label}: značiek príspevkov ${analytics.events}`);
    if (!analytics.deltas.includes('+28 % oproti predtým')) failures.push(`${label}: delty ${analytics.deltas}`);
    await shot('users', 'pouzivatelia');
    const ops = await shot('traffic', 'prevadzka', () => ({ sources: [...document.querySelectorAll('.admin-section')].find(x => x.querySelector('h2')?.textContent === 'Externé zdroje')?.querySelectorAll('tbody tr').length ?? 0,
      blocked: [...document.querySelectorAll('.admin-badge-bad')].some(b => b.textContent.startsWith('zablokovaný do ')), cards: Boolean([...document.querySelectorAll('h2')].find(h => h.textContent === 'Karty lietadiel')) }));
    if (ops.sources !== 3 || !ops.blocked || !ops.cards) failures.push(`${label}: prevádzka ${JSON.stringify(ops)}`);
    await page.close();
  }
} finally {
  await browser.close();
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`OK → ${OUT}`);
