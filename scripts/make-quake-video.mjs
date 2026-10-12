// OKO — video o silnom zemetrasení (2026-10-10, Panama M 7,7): údaje USGS (hlavný otras, PAGER, dotrasy) →
// správy o následkoch (GDELT, dôveryhodné médiá, číslo len od dvoch) → zábery s licenciou (mapa otrasov USGS,
// fotky/video z Wikimedia Commons) → scenár (src/data/quakeVideo.js) → linka denného videa v2
// (make-front-day-video.mjs --scenario) na mape reliéfu. Spúšťa ho aj Štúdio (strážca zemetrasení).
//
//   node scripts/make-quake-video.mjs --event us6000u18k [--facts fakty.json] [--out-dir <dir>] [--no-news] [--no-media] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { aftershocksOf, quakeOf, quakeScenario } from '../src/data/quakeVideo.js';
import { quakeFactsLine, quakeNewsFacts, quakeNewsQuery } from '../src/data/quakeNews.js';
import { commonsSearchUrl, pickCommonsMedia, shakemapImageUrl } from '../src/data/quakeMedia.js';
import { createRequire } from 'node:module';
import { shakemapOverlay } from './lib/quakeAssets.mjs';
import { newsUrl, parseTrustedList } from '../src/data/eventNews.js';
import { bingNewsUrl, parseBingNewsRss } from '../src/data/fireNews.js';
import { SAT, SAT_CATALOG_URL, SAT_PROCESS_URL, SAT_TOKEN_URL, catalogBody, clearestScene, processBody, satDay, satelliteBbox, satelliteTown } from '../src/data/quakeSatellite.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(root, 'package.json'))('sharp');
// Kľúče z .env (CDSE pre satelit) — rovnako ako make-event-video.mjs; premenné prostredia (služba) majú prednosť.
const env = { ...process.env };
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* bez .env */ }
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const id = flag('--event');
if (!id) { console.error('[quake] chýba --event <id USGS>'); process.exit(2); }
// Wikimedia User-Agent Policy: meno klienta s „bot" a kontaktom (web), nie prehliadač.
const UA = { 'user-agent': 'OKO-quake-bot/0.1 (https://okolive.sk) node-fetch' };
const getJson = async (url) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
const download = async (url, file, typeRe) => {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = r.headers.get('content-type') || '';
  if (!typeRe.test(type)) throw new Error(`zlý typ ${type}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 150 * 1024 * 1024) throw new Error('príliš veľké');
  fs.writeFileSync(file, buf);
  return file;
};

const detail = await getJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${encodeURIComponent(id)}.geojson`);
const main = quakeOf(detail);
const countryEn = String(main.place).split(',').pop().trim();
const feed = await getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson');
const aftershocks = aftershocksOf(main, feed.features);
let pager = null;
const lp = detail.properties?.products?.losspager?.[0];
if (lp) {
  const file = (name) => lp.contents?.[name]?.url;
  const [exposures, cities, alerts] = await Promise.all(['json/exposures.json', 'json/cities.json', 'json/alerts.json'].map((n) => (file(n) ? getJson(file(n)).catch(() => null) : null)));
  pager = { exposures, cities: cities?.all_cities || cities?.onepager_cities || [], economicLevel: alerts?.economic?.level || null, fatalityLevel: alerts?.fatality?.level || null };
}

// Správy: súbor --facts (ručne overené) má prednosť; inak GDELT a dôveryhodné médiá (číslo len od dvoch).
let facts = flag('--facts') ? JSON.parse(fs.readFileSync(path.resolve(flag('--facts')), 'utf8')) : null;
if (!facts && !args.includes('--no-news')) {
  try {
    const trusted = parseTrustedList(JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'local_data', 'events', 'trusted-news.json'), 'utf8')));
    // GDELT púšťa jeden dopyt za ~5 s (429 pri súbehu s inou službou) — skúsi znova po chvíli; keď nevyjde,
    // ostane Bing (2026-10-10: 429 od GDELT predtým zahodilo aj články z Bingu).
    let res = null;
    for (let attempt = 0; attempt < 4 && !res; attempt += 1) {
      try { res = await getJson(newsUrl(quakeNewsQuery(countryEn), { fromMs: main.time, toMs: Date.now() })); } catch (e) {
        if (!/HTTP 429/.test(e.message) || attempt === 3) { console.log(`[quake] GDELT nedostupný: ${e.message.slice(-40)}`); break; }
        await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
      }
    }
    // Bing News (ako karta požiarov): GDELT býva chudobný na veľké agentúry; tri dopyty — všeobecný, obete, zranení.
    const bing = [];
    for (const q of [`${countryEn} earthquake`, `${countryEn} earthquake death toll`, `${countryEn} earthquake injured`]) {
      try {
        const r = await fetch(bingNewsUrl(q), { headers: UA, signal: AbortSignal.timeout(30_000) });
        if (r.ok) bing.push(...parseBingNewsRss(await r.text()).map((a) => ({ title: a.title, url: a.url, domain: a.source })));
      } catch { /* Bing nedostupný — ostane GDELT */ }
    }
    const found = quakeNewsFacts([...(res?.articles || []), ...bing], trusted, { afterMs: main.time });
    console.log(`[quake] Bing News: ${bing.length} článkov`);
    facts = quakeFactsLine(found);
    console.log(`[quake] správy: GDELT ${(res?.articles || []).length} článkov, overené: ${found ? JSON.stringify({ killed: found.killed, injured: found.injured, noDeaths: found.noDeaths, sources: found.sources.map((s) => s.name) }) : 'nič'}`);
  } catch (e) { console.log(`[quake] správy nedostupné: ${e.message}`); }
}

const scenarioProbe = quakeScenario({ main, aftershocks, pager, facts });
const outDir = path.resolve(flag('--out-dir', path.join(root, '.gev-cache', 'videa', scenarioProbe.model.day, scenarioProbe.name)));
fs.mkdirSync(outDir, { recursive: true });

// Zábery s licenciou: mapa otrasov USGS, fotky/video z Commons (nahraté po otrase, voľná licencia).
const media = { shakemap: null, photos: [], video: null };
if (!args.includes('--no-media')) {
  const sm = shakemapImageUrl(detail);
  if (sm) { try { media.shakemap = { file: await download(sm, path.join(outDir, 'shakemap.jpg'), /^image\//) }; } catch (e) { console.log(`[quake] ShakeMap: ${e.message}`); } }
  // Vrstva na glóbus: PNG intenzity + world file → súradnice; slabé otrasy (I–III) priehľadné, ostatné polopriehľadné.
  try {
    media.overlay = await shakemapOverlay(detail, outDir);
    console.log(`[quake] vrstva otrasov: ${media.overlay ? media.overlay.bbox.map((v) => v.toFixed(2)).join(', ') : 'nie je'}`);
  } catch (e) { console.log(`[quake] vrstva otrasov: ${e.message}`); }
  try {
    const picked = pickCommonsMedia(await getJson(commonsSearchUrl(countryEn, new Date(main.time).getUTCFullYear())), { countryEn, afterMs: main.time });
    for (const [k, p] of picked.entries()) {
      try {
        if (p.kind === 'video' && !media.video) {
          const file = await download(p.url, path.join(outDir, `commons-video-${k}${path.extname(new URL(p.url).pathname) || '.webm'}`), /video|octet-stream/);
          const probe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
          if (Number(probe.stdout) >= 3) media.video = { file, credit: p.credit, page: p.page };
        } else if (p.kind === 'photo' && media.photos.length < 3) {
          media.photos.push({ file: await download(p.url, path.join(outDir, `commons-foto-${k}.jpg`), /^image\//), credit: p.credit, artist: p.artist, page: p.page });
        }
      } catch (e) { console.log(`[quake] Commons ${p.title}: ${e.message}`); }
    }
    console.log(`[quake] Commons: ${picked.length} vhodných, fotky ${media.photos.length}, video ${media.video ? 'áno' : 'nie'}`);
  } catch (e) { console.log(`[quake] Commons nedostupné: ${e.message}`); }
}

// Satelit pred a po (Sentinel-2, CDSE): len keď po otrase už existuje dosť jasná snímka.
const town = satelliteTown(pager?.cities);
if (!args.includes('--no-media') && town && env.CDSE_CLIENT_ID && env.CDSE_CLIENT_SECRET) {
  try {
    const tokenRes = await fetch(SAT_TOKEN_URL, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.CDSE_CLIENT_ID, client_secret: env.CDSE_CLIENT_SECRET }), signal: AbortSignal.timeout(30_000) });
    if (!tokenRes.ok) throw new Error(`token HTTP ${tokenRes.status}`);
    const auth = { authorization: `Bearer ${(await tokenRes.json()).access_token}`, 'content-type': 'application/json' };
    const bbox = satelliteBbox(town);
    const scene = async (from, to) => clearestScene(await (await fetch(SAT_CATALOG_URL, { method: 'POST', headers: auth, body: JSON.stringify(catalogBody(bbox, from, to)), signal: AbortSignal.timeout(60_000) })).json());
    const quakeIso = new Date(main.time).toISOString();
    const after = await scene(quakeIso, new Date().toISOString());
    const before = after ? await scene(new Date(main.time - SAT.beforeDays * 86_400_000).toISOString(), quakeIso) : null;
    if (after && before) {
      const files = [];
      for (const [label, s] of [['PRED', before], ['PO', after]]) {
        const r = await fetch(SAT_PROCESS_URL, { method: 'POST', headers: { ...auth, accept: 'image/png' }, body: JSON.stringify(processBody(bbox, s.at)), signal: AbortSignal.timeout(120_000) });
        if (!r.ok) throw new Error(`snímka ${label}: HTTP ${r.status}`);
        const png = Buffer.from(await r.arrayBuffer());
        const tag = `<svg xmlns="http://www.w3.org/2000/svg" width="${SAT.size}" height="${SAT.size}"><rect x="28" y="28" width="${label === 'PRED' ? 330 : 280}" height="76" rx="12" fill="rgba(5,14,22,0.86)"/>`
          + `<text x="50" y="80" font-family="Inter, Arial, sans-serif" font-size="44" font-weight="800" fill="${label === 'PRED' ? '#ffffff' : '#ffb020'}">${label} · ${satDay(s.at)}</text></svg>`;
        const file = path.join(outDir, `satelit-${label.toLowerCase()}.jpg`);
        await sharp(png).flatten({ background: '#0b1620' }).composite([{ input: Buffer.from(tag) }]).jpeg({ quality: 90 }).toFile(file);
        files.push(file);
      }
      media.satellite = { files, town: town.name, year: new Date(after.at).getUTCFullYear() };
    }
    console.log(`[quake] satelit ${town.name}: ${after ? `po ${after.at.slice(0, 10)} (${Math.round(after.cloud)} % mrakov)` : 'po otrase ešte žiadna snímka'}${before ? `, pred ${before.at.slice(0, 10)}` : ''}`);
  } catch (e) { console.log(`[quake] satelit: ${e.message}`); }
}

const scenario = quakeScenario({ main, aftershocks, pager, facts, media });
const scenarioFile = path.join(outDir, 'scenar.json');
fs.writeFileSync(scenarioFile, JSON.stringify(scenario, null, 2));
console.log(`[quake] ${main.place} M ${main.mag}, dotrasov ${aftershocks.length}, PAGER ${pager?.economicLevel || '-'}; vety: ${scenario.lines.map((l) => l.id).join(', ')}`);
console.log(`[quake] scenár ${scenarioFile}`);
if (args.includes('--dry')) process.exit(0);
const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'make-front-day-video.mjs'), '--scenario', scenarioFile, '--out-dir', outDir, '--style', 'v2',
  ...(flag('--url') ? ['--url', flag('--url')] : []), ...(flag('--frames') ? ['--frames', flag('--frames')] : [])], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
