// scripts/lib/reelV3/render.mjs — obraz reelu v3: Chrome (Puppeteer) kreslí každú snímku do plátna (engine.js),
// JPEG ide rúrou do ffmpeg → MP4 (H.264). Žiadny server: stránku a súbory podáva zachytávanie požiadaviek
// (http://reel.local/<cesta> → súbor z `files`). Len lokálne súbory, nič sa neposiela von.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
export const ORIGIN = 'http://reel.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.html': 'text/html' };

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="1080" height="1920"></canvas><script type="module" src="/engine.js"></script></body></html>`;

/** Mapovanie URL → súbor: `files` = { 'asset/x.json': 'C:/…/x.json', 'clip0/': 'C:/…/frames' (priečinok) }. */
export function resolveAsset(files, urlPath) {
  const p = decodeURIComponent(urlPath.replace(/^\/+/, ''));
  if (p === 'engine.js') return path.join(HERE, 'engine.js');
  if (files[p]) return files[p];
  for (const [k, v] of Object.entries(files)) if (k.endsWith('/') && p.startsWith(k)) return path.join(v, p.slice(k.length));
  return null;
}

/**
 * @param {object} p
 * @param {object} p.spec  scénar pre engine (scény, titulky, štítky … v sekundách)
 * @param {Record<string,string>} p.files  URL cesta → lokálny súbor/priečinok
 * @param {string} [p.out]  MP4 (celé video)
 * @param {number[]} [p.stills]  len tieto časy (s) → JPEG do `stillsDir`
 */
export async function renderReel({ spec, files, out = null, stills = null, stillsDir = null, ffmpeg = 'ffmpeg', fps = 30, from = 0, to = null, onProgress = () => {} }) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--force-color-profile=srgb', '--disable-gpu-vsync'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    const missing = [];
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith(ORIGIN)) { req.abort('blockedbyclient'); return; }
      const u = new URL(url);
      if (u.pathname === '/' || u.pathname === '/index.html') { req.respond({ status: 200, contentType: 'text/html', body: PAGE }); return; }
      if (u.pathname === '/favicon.ico') { req.respond({ status: 204, body: '' }); return; }
      const file = resolveAsset(files, u.pathname);
      if (!file || !fs.existsSync(file)) { missing.push(u.pathname); req.respond({ status: 404, contentType: 'text/plain', body: `chýba ${u.pathname}` }); return; }
      req.respond({ status: 200, contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()}${missing.length ? ` (${missing.join(', ')})` : ''}`); });
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.reel && window.reel.init', { timeout: 30_000 });
    const info = await page.evaluate((s) => window.reel.init(s), spec);
    onProgress('init', { fonts: info.fonts?.length });
    if (errors.length) throw new Error(`engine: ${errors.join(' | ')}`);

    if (stills) {
      fs.mkdirSync(stillsDir, { recursive: true });
      const saved = [];
      for (const t of stills) {
        const b64 = await page.evaluate((x) => window.reel.frame(x), t);
        const f = path.join(stillsDir, `still-${t.toFixed(2).replace('.', '_')}.jpg`);
        fs.writeFileSync(f, Buffer.from(b64, 'base64'));
        saved.push(f);
      }
      if (errors.length) throw new Error(`engine: ${errors.join(' | ')}`);
      return { stills: saved };
    }

    const end = to ?? spec.duration;
    const total = Math.round((end - from) * fps);
    const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    ff.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const exited = new Promise((resolve) => { ff.on('error', (e) => resolve({ code: -1, e })); ff.on('close', (code) => resolve({ code })); });
    const started = Date.now();
    for (let f = 0; f < total; f += 1) {
      const b64 = await page.evaluate((x) => window.reel.frame(x), from + f / fps);
      if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await Promise.race([once(ff.stdin, 'drain').catch(() => {}), exited]);
      if (f % 90 === 0) onProgress('frame', { frame: f, frames: total, msPerFrame: f ? Math.round((Date.now() - started) / f) : null });
      if (errors.length) break;
    }
    ff.stdin.end();
    const r = await exited;
    if (errors.length) throw new Error(`engine: ${errors.join(' | ')}`);
    if (r.code !== 0) throw new Error(`ffmpeg ${r.e?.message || r.code}: ${err.trim().slice(-300)}`);
    return { out, frames: total };
  } finally {
    await browser.close();
  }
}
