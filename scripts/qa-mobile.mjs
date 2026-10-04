// scripts/qa-mobile.mjs — kontrola OKA na telefóne na výšku v skutočnom prehliadači (2026-10-04).
//
// Prečo: vlastník našiel na telefóne kartu lietadla, ktorá sa nedala zavrieť — karta (~430 px) bola
// širšia než telefón (390 px) a krížik ležal mimo obrazovky. Jednotkové testy to nevideli. Tento
// skript to meria na obdĺžnikoch prvkov, nie na texte zdrojáku:
//   1. bez karty: stránka sa vodorovne neposúva, dok a atribúcia sú v okne a neprekrývajú sa,
//      hlas vypnutý = len mikrofón (dok úzky);
//   2. s kartou skutočného lietadla nad BA: krížik je v okne, karta 3 s stojí, SLEDOVAŤ a KOKPIT
//      sú lišta pod kartou (pod fotkou), v okne a nad spodnou lištou;
//   3. ťuknutie na krížik kartu zavrie; potiahnutie karty nadol ju zavrie tiež;
//   4. odkaz Témy vpravo hore vedie na obsahové stránky (/sk/ alebo /en/) a je v okne.
// Snímky ukladá do --out. Pri chybe vypíše čo a skončí kódom 1.
//
// Usage: node scripts/qa-mobile.mjs [--base http://localhost:4173] [--out output/qa-mobile]
//          [--sizes 360x780,390x844,412x915]
//
// Spúšťať pred publikovaním zmien rozhrania (karty, dok, lišty). Mapa = OSM (?qaBasemap=osm), takže
// nemíňa dennú kvótu Google 3D dlaždíc. Potrebuje GPU (rovnaké prepínače ako qa-mideast-panel.mjs).
// Lietadlo berie z /api/opensky/states/all dev servera (cachovaná odpoveď, žiadny kredit navyše).
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const BASE = opt('base', 'http://localhost:4173');
const OUT = opt('out', 'output/qa-mobile');
const SIZES = opt('sizes', '360x780,390x844,412x915').split(',').map((s) => s.split('x').map(Number));
fs.mkdirSync(OUT, { recursive: true });

const VIEW = '#v=2&lat=48.17&lon=17.21&alt=8000&heading=360&pitch=-30&roll=0&style=normal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickAircraft() {
  const data = await (await fetch(`${BASE}/api/opensky/states/all`)).json();
  const near = (data.states || []).filter((s) => s[5] && s[6] && !s[8] && Math.abs(s[6] - 48.17) < 1.2 && Math.abs(s[5] - 17.2) < 1.8);
  return near.length ? String(near[0][0]).toLowerCase() : null;
}

/** Obdĺžniky v okne (beží v stránke). */
function measurePage() {
  const box = (el) => {
    if (!el || el.hidden || getComputedStyle(el).display === 'none') return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } : null;
  };
  const credit = document.querySelector('#cesium-credits .cesium-widget-credits');
  return {
    vw: innerWidth,
    vh: innerHeight,
    scrollW: document.documentElement.scrollWidth,
    close: box(document.querySelector('.card-close[data-card-kind=tracked]')),
    follow: box(document.getElementById('follow-flight')),
    cockpit: box(document.getElementById('cockpit-entry')),
    photo: box(document.querySelector('.tracked-photo')),
    voice: box(document.getElementById('gev-voice-control')),
    voiceStatus: document.getElementById('gev-voice-control')?.dataset.status ?? null,
    location: box(document.getElementById('location-bar')),
    style: box(document.getElementById('control-panel')),
    credit: box(credit),
    appbar: box(document.getElementById('oko-appbar')),
    // Krátky popis pod ikonou doku (Poloha, Štýl) nesmie byť orezaný predkom s overflow: hidden.
    dockLabelsClipped: [...document.querySelectorAll('#command-dock .dock-label-short')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return false;
      for (let p = el.parentElement; p && p.id !== 'command-dock'; p = p.parentElement) {
        if (getComputedStyle(p).overflow === 'visible') continue;
        const pr = p.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1) return true;
      }
      return false;
    }).map((el) => el.textContent.trim()),
    subj: location.hash.includes('subj='),
    swipe: box(document.querySelector('.card-swipe-zone')),
    topics: box(document.getElementById('topics-link')),
    topicsHref: document.getElementById('topics-link')?.getAttribute('href') ?? null,
    topbar: box(document.getElementById('oko-topbar')),
    title: box(document.querySelector('#title-bar h1')),
    titleCredit: box(document.querySelector('#title-bar .title-credit')),
    actions: box(document.getElementById('top-center-actions')),
    langOptions: box(document.querySelector('#lang-switch .lang-switch-options')),
    consentOpen: box(document.getElementById('consent-open')),
  };
}

const inView = (b, m, bottom = m.vh) => !b || (b.l >= 0 && b.r <= m.vw && b.t >= 0 && b.b <= bottom);
const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

const browser = await puppeteer.launch({
  headless: true, pipe: true, protocolTimeout: 300_000,
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--lang=sk-SK'],
});
const failures = [];
const hex = await pickAircraft();
if (!hex) failures.push('žiadne lietadlo nad BA v /api/opensky — krok s kartou preskočený');

for (const [W, H] of SIZES) {
  const tag = `${W}x${H}`;
  const fail = (msg) => { failures.push(`${tag}: ${msg}`); console.log(`  ✖ ${msg}`); };
  console.log(`— ${tag}`);
  const page = await browser.newPage();
  await page.emulate({
    viewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  });
  const open = async (hash) => {
    // Zmena len za # stránku nenačíta — predmet (subj=) sa obnovuje iba pri štarte.
    await page.goto('about:blank');
    await page.goto(`${BASE}/?qaBasemap=osm${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => document.getElementById('loading-screen')?.classList.contains('hidden'), { timeout: 180_000, polling: 1000 });
    await sleep(4000);
    // Naživo (okolive.sk) prvá návšteva ukáže lištu súhlasu cez spodok — odmietni ako človek
    // (voľba ostane v prehliadači pre ďalšie veľkosti).
    await page.evaluate(() => document.querySelector('#oko-consent [data-consent="reject"]')?.click());
    await sleep(500);
  };

  // 1. bez karty
  await open(VIEW);
  let m = await page.evaluate(measurePage);
  await page.screenshot({ path: `${OUT}/zaklad-${tag}.png` });
  if (m.scrollW > m.vw) fail(`stránka sa posúva do strán (${m.scrollW} > ${m.vw})`);
  for (const key of ['voice', 'location', 'style', 'credit']) if (!inView(m[key], m)) fail(`${key} mimo okna ${JSON.stringify(m[key])}`);
  if (m.voiceStatus === 'idle' && m.voice && m.voice.r - m.voice.l > 90) fail(`vypnutý hlas zaberá ${m.voice.r - m.voice.l} px (čaká sa len mikrofón)`);
  if (overlap(m.credit, m.voice)) fail('atribúcia mapy sa prekrýva s hlasom');
  if (!m.topics || !inView(m.topics, m)) fail(`odkaz Témy chýba alebo je mimo okna ${JSON.stringify(m.topics)}`);
  if (!['/sk/', '/en/'].includes(m.topicsHref)) fail(`odkaz Témy vedie na ${m.topicsHref}`);
  if (m.dockLabelsClipped.length) fail(`orezané popisy doku: ${m.dockLabelsClipped.join(', ')}`);
  // Horná lišta: všetko, čo predtým plávalo nad mapou, je celé v nej a nič sa neprekrýva.
  const topItems = ['title', 'titleCredit', 'actions', 'langOptions', 'topics', 'consentOpen'];
  if (!m.topbar) fail('chýba horná lišta');
  else {
    for (const key of topItems) {
      if (!m[key]) fail(`v hornej lište chýba ${key}`);
      else if (m[key].t < m.topbar.t || m[key].b > m.topbar.b || !inView(m[key], m)) fail(`${key} mimo hornej lišty ${JSON.stringify(m[key])} (lišta ${m.topbar.t}–${m.topbar.b})`);
    }
    for (let i = 0; i < topItems.length; i += 1) {
      for (let j = i + 1; j < topItems.length; j += 1) {
        if (overlap(m[topItems[i]], m[topItems[j]])) fail(`v hornej lište sa prekrýva ${topItems[i]} a ${topItems[j]}`);
      }
    }
  }
  console.log(`  dok: hlas ${m.voice ? m.voice.r - m.voice.l : '-'} px (${m.voiceStatus}), atribúcia ${m.credit ? `${m.credit.t}–${m.credit.b}` : '-'}`);

  // 2. karta lietadla
  if (hex) {
    await open(`${VIEW}&subj=flights.t.${hex}`);
    for (let i = 0; i < 40 && !(m = await page.evaluate(measurePage)).close; i += 1) await sleep(1000);
    await sleep(2500);
    const stamps = [];
    for (let i = 0; i < 6; i += 1) { stamps.push(JSON.stringify((await page.evaluate(measurePage)).close)); await sleep(500); }
    m = await page.evaluate(measurePage);
    await page.screenshot({ path: `${OUT}/karta-${tag}.png` });
    const bottom = m.appbar ? m.appbar.t : m.vh;
    if (!m.close) fail('karta lietadla bez krížika');
    else if (!inView(m.close, m)) fail(`krížik mimo okna ${JSON.stringify(m.close)}`);
    if (new Set(stamps).size > 1) fail(`karta sa hýbe (${[...new Set(stamps)].join(' | ')})`);
    for (const key of ['follow', 'cockpit']) {
      if (!inView(m[key], m, bottom)) fail(`${key} mimo okna alebo pod spodnou lištou ${JSON.stringify(m[key])}`);
      if (m.photo && m[key] && overlap(m[key], m.photo)) fail(`${key} cez pás s fotkou`);
    }
    if (m.follow && m.cockpit && m.follow.t !== m.cockpit.t) fail('SLEDOVAŤ a KOKPIT nie sú v jednom riadku');
    console.log(`  karta: krížik ${JSON.stringify(m.close)}, lišta ${m.follow ? m.follow.t : '-'} px`);

    // 3. ťuknutie na krížik
    if (m.close) {
      await page.touchscreen.tap((m.close.l + m.close.r) / 2, (m.close.t + m.close.b) / 2);
      await sleep(2500);
      const after = await page.evaluate(measurePage);
      await page.screenshot({ path: `${OUT}/po-zavreti-${tag}.png` });
      if (after.close || after.subj) fail('ťuknutie na krížik kartu nezavrelo');
      if (after.follow?.t === m.follow?.t && after.follow) fail('lišta akcií ostala po zatvorení karty');
    }

    // 4. potiahnutie nadol
    await open(`${VIEW}&subj=flights.t.${hex}`);
    for (let i = 0; i < 40 && !(m = await page.evaluate(measurePage)).swipe; i += 1) await sleep(1000);
    await sleep(2500);
    m = await page.evaluate(measurePage);
    if (!m.swipe) fail('nad kartou chýba plocha na potiahnutie');
    else {
      // Plocha sa hýbe s kartou — zmeraj ju tesne pred dotykom a zisti, čo leží pod prstom.
      const probe = await page.evaluate(() => {
        const z = document.querySelector('.card-swipe-zone');
        const r = z?.getBoundingClientRect();
        if (!r || z.hidden) return null;
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + Math.min(30, r.height / 3));
        const hit = document.elementFromPoint(x, y);
        return { x, y, hit: hit?.className || hit?.id || hit?.tagName };
      });
      if (!probe) fail('plocha na potiahnutie zmizla pred dotykom');
      else {
        if (probe.hit !== 'card-swipe-zone' && probe.hit !== 'card-swipe-grabber') console.log(`  pod prstom je ${probe.hit}`);
        const x = probe.x;
        let y = probe.y;
        const touch = await page.touchscreen.touchStart(x, y);
        for (let i = 0; i < 6; i += 1) { y += 20; await touch.move(x, y); await sleep(16); }
        await touch.end();
        await sleep(2500);
        const after = await page.evaluate(measurePage);
        await page.screenshot({ path: `${OUT}/po-potiahnuti-${tag}.png` });
        if (after.close || after.subj) fail('potiahnutie nadol kartu nezavrelo');
      }
    }
  }
  await page.close();
}
await browser.close();
console.log(failures.length ? `VÝSLEDOK: ${failures.length} chýb\n${failures.join('\n')}` : 'VÝSLEDOK: OK');
process.exit(failures.length ? 1 : 0);
