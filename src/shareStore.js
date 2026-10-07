// src/shareStore.js
// Server pre zdieľanie s náhľadom (2026-09-14, variant B, „aj na soc. siete"):
// klient pošle stav odkazu (hash) a snímku JPEG toho, čo vidí; server ich
// uloží na disk (.gev-cache/share → junction na D:), vydá krátky odkaz
// /s/<id> a jeho HTML nesie Open Graph a Twitter značky, z ktorých si
// Facebook, X, LinkedIn, Threads, Bluesky, WhatsApp či Telegram vezmú
// skutočný obrázok. Človeka stránka presmeruje do aplikácie s tým istým
// stavom. Čistá logika (validácia, id, HTML, retencia) je tu a testovateľná;
// vite.config.js ju len obalí do routes.
//
// Verejný zapisovací endpoint bez kľúča → prísne stropy: JPEG do 400 kB
// s overením hlavičky súboru, hash do 4 096 znakov z bezpečnej abecedy,
// názov/popis orezané a bez riadiacich znakov, id náhodné 10 znakov base62
// (neuhádnuteľné), retencia 90 dní, limit na IP rieši plugin.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { embedUrlFromAppUrl } from './embedMode.js';

export const SHARE_ID_LENGTH = 10;
export const SHARE_IMAGE_MAX_BYTES = 400 * 1024;
/** JSON telo s base64 obrázkom (~1,37× JPEG) + hash + texty. */
export const SHARE_BODY_MAX_BYTES = 640 * 1024;
export const SHARE_HASH_MAX_CHARS = 4096;
export const SHARE_TITLE_MAX_CHARS = 120;
export const SHARE_DESCRIPTION_MAX_CHARS = 300;
export const SHARE_RETENTION_DAYS = 90;
export const SHARE_PRUNE_INTERVAL_MS = 60 * 60_000;
export const SHARE_IMAGE_MIN_SIDE_PX = 200;
export const SHARE_IMAGE_MAX_SIDE_PX = 4096;

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_RE = /^[A-Za-z0-9]{6,32}$/;
// URLSearchParams.toString() abeceda + '#': písmená, číslice, = & % . _ ~ : + - a medzera ako +.
const HASH_RE = /^[A-Za-z0-9=&%._~:+\-#]+$/;
const HOST_RE = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const DATA_URL_PREFIX = 'data:image/jpeg;base64,';

/** Náhodné id base62 bez modulo skreslenia (odmietnutie bajtov ≥ 248). */
export function makeShareId(length = SHARE_ID_LENGTH, random = randomBytes) {
  let out = '';
  while (out.length < length) {
    const bytes = random(length * 2);
    for (const byte of bytes) {
      if (byte >= 248) continue;
      out += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (out.length >= length) break;
    }
  }
  return out;
}

export function isValidShareId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/** `data:image/jpeg;base64,…` → Buffer s overenou JPEG hlavičkou (FF D8 FF), inak null. */
export function decodeJpegDataUrl(dataUrl, maxBytes = SHARE_IMAGE_MAX_BYTES) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(DATA_URL_PREFIX)) return null;
  const base64 = dataUrl.slice(DATA_URL_PREFIX.length);
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) return null;
  if (base64.length > Math.ceil(maxBytes * 4 / 3) + 8) return null;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length < 4 || buffer.length > maxBytes) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return null;
  return buffer;
}

function cleanText(value, maxChars) {
  return String(value ?? '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/**
 * Overí telo POST /api/share. Pure.
 * @param {any} body
 * @returns {{ ok: true, value: { hash: string, title: string, description: string, image: Buffer, width: number, height: number } } | { ok: false, error: string }}
 */
export function validateSharePayload(body, { maxImageBytes = SHARE_IMAGE_MAX_BYTES } = {}) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_body' };
  let hash = typeof body.hash === 'string' ? body.hash.trim() : '';
  if (hash.startsWith('#')) hash = hash.slice(1);
  if (!hash || hash.length > SHARE_HASH_MAX_CHARS || !HASH_RE.test(hash) || !/(^|&)lat=/.test(hash)) {
    return { ok: false, error: 'bad_hash' };
  }
  const image = decodeJpegDataUrl(body.image, maxImageBytes);
  if (!image) return { ok: false, error: 'bad_image' };
  const width = Number(body.width);
  const height = Number(body.height);
  const sideOk = (n) => Number.isInteger(n) && n >= SHARE_IMAGE_MIN_SIDE_PX && n <= SHARE_IMAGE_MAX_SIDE_PX;
  if (!sideOk(width) || !sideOk(height)) return { ok: false, error: 'bad_size' };
  const title = cleanText(body.title, SHARE_TITLE_MAX_CHARS) || 'OKO';
  const description = cleanText(body.description, SHARE_DESCRIPTION_MAX_CHARS);
  return { ok: true, value: { hash, title, description, image, width, height } };
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Pôvod verejnej adresy z požiadavky: cloudflared posiela Host tunela
 * a X-Forwarded-Proto https; lokálne http://localhost:4173. Hodnota Host sa
 * overuje abecedou, aby sa do HTML nedostalo nič cudzie.
 */
export function originFromRequest(req, { fallbackHost = 'localhost:4173' } = {}) {
  const headers = req?.headers || {};
  const hostRaw = String(headers.host || '').trim();
  const host = HOST_RE.test(hostRaw) ? hostRaw : fallbackHost;
  let proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (!proto) {
    try { proto = JSON.parse(String(headers['cf-visitor'] || '{}')).scheme || ''; } catch { proto = ''; }
  }
  if (proto !== 'https' && proto !== 'http') proto = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https';
  return `${proto}://${host}`;
}

/**
 * Kľúč pre limit na IP: cez tunel je socket vždy ::1 (cloudflared beží
 * lokálne), skutočného návštevníka nesie CF-Connecting-IP; priamo na
 * localhoste ostáva adresa socketu.
 */
export function clientKeyFromRequest(req) {
  const cf = String(req?.headers?.['cf-connecting-ip'] || '').trim();
  if (cf && /^[0-9a-fA-F.:]{3,45}$/.test(cf)) return cf;
  return String(req?.socket?.remoteAddress || 'local');
}

/**
 * HTML stránky /s/<id>: Open Graph + Twitter card, presmerovanie do aplikácie
 * LEN skriptom — crawler Facebooku nasleduje aj <meta http-equiv="refresh">
 * a skončil by na koreni bez hashu (naživo 14. 9. 2026: karta ukázala len
 * doménu bez obrázka), kým JavaScript crawlery nespúšťajú. Bez JS ostáva
 * odkaz v tele. noindex v <meta> (SEO želanie používateľa); náhľady sietí
 * čítajú OG značky aj tak. Pure.
 * @param {{ record: object, origin: string }} input
 */
export function renderSharePage({ record, origin }) {
  const base = String(origin || '').replace(/\/+$/, '');
  const id = record.id;
  const title = escapeHtml(record.title || 'OKO');
  const description = escapeHtml(record.description || '');
  const pageUrl = `${base}/s/${id}`;
  const imageUrl = `${base}/s/${id}.jpg`;
  const appUrl = `${base}/#${record.hash}`;
  const appUrlAttr = escapeHtml(appUrl);
  // Živý rámček (2026-10-06, vlastník: „aby to nebol obrázok, ale live"): človek ostáva na stránke
  // odkazu a vidí živú appku v tom istom stave (src/embedMode.js); siete čítajú OG obrázok ako doteraz.
  const embedUrlAttr = escapeHtml(embedUrlFromAppUrl(appUrl, { title: record.title }));
  // Video do náhľadu (2026-10-07): og:video s MP4 cez https + rozmery = podľa dokumentácie Facebooku
  // „spôsobilé na prehrávanie priamo vo feede" (nie zaručené); Discord a Telegram MP4 prehrajú.
  // X zostáva pri obrázku (player card chce schválenie domény). Typ stránky je potom video.other.
  const video = record.video && record.video.type === 'video/mp4' ? record.video : null;
  const videoUrl = escapeHtml(`${base}/s/${id}.mp4`);
  const videoTags = video ? `
<meta property="og:video" content="${videoUrl}" />
<meta property="og:video:url" content="${videoUrl}" />
<meta property="og:video:secure_url" content="${videoUrl}" />
<meta property="og:video:type" content="video/mp4" />
<meta property="og:video:width" content="${Number(video.width) || 1200}" />
<meta property="og:video:height" content="${Number(video.height) || 630}" />
<meta property="video:duration" content="${Math.max(1, Math.round((Number(video.durationMs) || 0) / 1000))}" />` : '';
  return `<!DOCTYPE html>
<html lang="sk">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<title>${title}</title>
<meta name="description" content="${description}" />
<meta property="og:type" content="${video ? 'video.other' : 'website'}" />
<meta property="og:site_name" content="OKO" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${escapeHtml(pageUrl)}" />
<meta property="og:image" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="${Number(record.width) || 1200}" />
<meta property="og:image:height" content="${Number(record.height) || 630}" />
<meta property="og:image:alt" content="${title}" />${videoTags}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
<link rel="canonical" href="${escapeHtml(pageUrl)}" />
<style>html,body{height:100%}body{margin:0;background:#06101a;color:#dff3fb;font:14px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}a{color:#39d0ff}main{text-align:center;padding:24px}img{max-width:min(92vw,720px);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.5)}iframe.oko-live{position:fixed;inset:0;width:100%;height:100%;border:0;background:#06101a}</style>
</head>
<body>
<main>
<p><a href="${appUrlAttr}">${title}</a></p>
<img src="${escapeHtml(imageUrl)}" alt="${title}" />
<p>${description}</p>
</main>
<iframe class="oko-live" src="${embedUrlAttr}" title="${title}" allow="fullscreen" allowfullscreen></iframe>
</body>
</html>
`;
}

// ── Video do náhľadu odkazu (2026-10-07, src/shareVideo.js) ───────────────────────────────────────
/** Najväčšia nahrávka z prehliadača (6 s pri 2,5 Mb/s ≈ 2 MB; rezerva pre VP8 a vyššie DPR). */
export const SHARE_VIDEO_MAX_BYTES = 6 * 1024 * 1024;
export const SHARE_VIDEO_MIN_BYTES = 2_000;
export const SHARE_VIDEO_MIN_MS = 500;
export const SHARE_VIDEO_MAX_MS = 10_000;
/** Video sa dá pripojiť len k čerstvému zdieľaniu — id nie je tajné, okno zatvára zneužitie starých odkazov. */
export const SHARE_VIDEO_ATTACH_WINDOW_MS = 15 * 60_000;
/** Rozpracované nahrávky (`<id>.upload.*`) staršie než hodina sú po páde prevodu na zmazanie. */
export const SHARE_UPLOAD_STALE_MS = 60 * 60_000;

/** Typ videa z prvých bajtov (pure): WebM/Matroska (EBML) alebo MP4 (ftyp); inak null. */
export function sniffVideoType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm';
  if (buffer.toString('latin1', 4, 8) === 'ftyp') return 'video/mp4';
  return null;
}

/**
 * Over nahrávku (pure): veľkosť, skutočný typ podľa bajtov zhodný s deklarovaným, rozmery a dĺžka v medziach.
 * @returns {{ ok: true, value: { type: string, ext: string, width: number, height: number, durationMs: number, bytes: number } } | { ok: false, error: string }}
 */
export function validateVideoUpload({ buffer, contentType, width, height, durationMs } = {}) {
  const bytes = buffer?.length || 0;
  if (bytes < SHARE_VIDEO_MIN_BYTES) return { ok: false, error: 'video_too_small' };
  if (bytes > SHARE_VIDEO_MAX_BYTES) return { ok: false, error: 'too_large' };
  const sniffed = sniffVideoType(buffer);
  if (!sniffed) return { ok: false, error: 'video_type' };
  const declared = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream' && declared !== sniffed) return { ok: false, error: 'video_type' };
  const w = Number(width);
  const h = Number(height);
  const ms = Number(durationMs);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 200 || h < 200 || w > 1920 || h > 1920) return { ok: false, error: 'video_size' };
  if (!Number.isFinite(ms) || ms < SHARE_VIDEO_MIN_MS || ms > SHARE_VIDEO_MAX_MS) return { ok: false, error: 'video_duration' };
  return { ok: true, value: { type: sniffed, ext: sniffed === 'video/mp4' ? 'mp4' : 'webm', width: w, height: h, durationMs: Math.round(ms), bytes } };
}

/** Smie sa k záznamu pripojiť video? Len bez videa a do 15 min od vzniku (pure). */
export function canAttachVideo(record, nowMs = Date.now()) {
  if (!record || record.video) return false;
  const createdAt = Number(record.createdAt);
  return Number.isFinite(createdAt) && nowMs - createdAt <= SHARE_VIDEO_ATTACH_WINDOW_MS && nowMs >= createdAt - 60_000;
}

/**
 * Súborové úložisko zdieľaní: `<dir>/<id>.json` (záznam) + `<dir>/<id>.jpg` (+ `<id>.mp4` video do náhľadu).
 * @param {{ dir: string, now?: () => number, fsImpl?: typeof fs, retentionDays?: number, idFactory?: () => string }} options
 */
export function createShareStore({
  dir,
  now = Date.now,
  fsImpl = fs,
  retentionDays = SHARE_RETENTION_DAYS,
  idFactory = () => makeShareId(),
} = {}) {
  if (!dir) throw new Error('share store needs a dir');
  let lastPruneMs = 0;

  function ensureDir() {
    fsImpl.mkdirSync(dir, { recursive: true });
  }

  function jsonPath(id) { return path.join(dir, `${id}.json`); }
  function imagePath(id) { return path.join(dir, `${id}.jpg`); }
  function videoPath(id) { return path.join(dir, `${id}.mp4`); }
  function uploadPath(id, ext = 'webm') { return path.join(dir, `${id}.upload.${ext === 'mp4' ? 'mp4' : 'webm'}`); }

  /** Zmaž záznamy staršie než retencia; vracia počet zmazaných záznamov. */
  function prune(nowMs = now()) {
    lastPruneMs = nowMs;
    let removed = 0;
    let names = [];
    try { names = fsImpl.readdirSync(dir); } catch { return 0; }
    const cutoff = nowMs - retentionDays * 86_400_000;
    for (const name of names) {
      const full = path.join(dir, name);
      // Rozpracovaná nahrávka po páde prevodu (video do náhľadu): po hodine preč.
      if (/\.upload\.(webm|mp4)$/.test(name)) {
        try { if (nowMs - fsImpl.statSync(full).mtimeMs > SHARE_UPLOAD_STALE_MS) fsImpl.unlinkSync(full); } catch { /* už preč */ }
        continue;
      }
      if (!name.endsWith('.json')) continue;
      let createdAt = null;
      let keep = false;
      try {
        const rec = JSON.parse(fsImpl.readFileSync(full, 'utf8'));
        createdAt = Number(rec.createdAt);
        keep = rec.keep === true;
      } catch { createdAt = null; }
      // Zverejnené udalosti (Udalosti, 2026-09-30) sa nemažú — odkaz v príspevku na FB musí ostať platný.
      if (keep) continue;
      if (!Number.isFinite(createdAt)) {
        try { createdAt = fsImpl.statSync(full).mtimeMs; } catch { continue; }
      }
      if (createdAt >= cutoff) continue;
      try { fsImpl.unlinkSync(full); } catch { /* už preč */ }
      try { fsImpl.unlinkSync(path.join(dir, name.replace(/\.json$/, '.jpg'))); } catch { /* bez obrázka */ }
      try { fsImpl.unlinkSync(path.join(dir, name.replace(/\.json$/, '.mp4'))); } catch { /* bez videa */ }
      removed += 1;
    }
    return removed;
  }

  return {
    dir,
    imagePath,
    videoPath,
    uploadPath,
    prune,
    /**
     * Pripoj k záznamu video do náhľadu (po prevode na MP4 do videoPath(id)); vráti nový záznam,
     * alebo null, keď záznam nie je alebo video pripojiť nesmie (canAttachVideo).
     */
    attachVideo(id, { width, height, durationMs, bytes } = {}) {
      const record = this.read(id);
      if (!record || !canAttachVideo(record, now())) return null;
      const updated = { ...record, video: { type: 'video/mp4', width: Number(width) || 0, height: Number(height) || 0, durationMs: Number(durationMs) || 0, bytes: Number(bytes) || 0, attachedAt: now() } };
      fsImpl.writeFileSync(jsonPath(id), JSON.stringify(updated), 'utf8');
      return updated;
    },
    /**
     * Ulož overenú hodnotu z validateSharePayload; vráti záznam (bez obrázka).
     */
    save(value) {
      ensureDir();
      const nowMs = now();
      if (nowMs - lastPruneMs >= SHARE_PRUNE_INTERVAL_MS) prune(nowMs);
      let id = idFactory();
      for (let attempt = 0; attempt < 5 && fsImpl.existsSync(jsonPath(id)); attempt += 1) id = idFactory();
      const record = {
        v: 1,
        id,
        createdAt: nowMs,
        hash: value.hash,
        title: value.title,
        description: value.description,
        width: value.width,
        height: value.height,
        imageBytes: value.image.length,
        ...(value.keep === true ? { keep: true } : {}),
      };
      fsImpl.writeFileSync(imagePath(id), value.image);
      fsImpl.writeFileSync(jsonPath(id), JSON.stringify(record), 'utf8');
      return record;
    },
    /** Zmaž záznam aj obrázok (vlastník stiahol zverejnenú udalosť); true, ak záznam bol. */
    remove(id) {
      if (!isValidShareId(id)) return false;
      let removed = false;
      try { fsImpl.unlinkSync(jsonPath(id)); removed = true; } catch { /* nebol */ }
      try { fsImpl.unlinkSync(imagePath(id)); } catch { /* bez obrázka */ }
      try { fsImpl.unlinkSync(videoPath(id)); } catch { /* bez videa */ }
      return removed;
    },
    /** Záznam podľa id alebo null (aj pre nevalidné id). */
    read(id) {
      if (!isValidShareId(id)) return null;
      try {
        const record = JSON.parse(fsImpl.readFileSync(jsonPath(id), 'utf8'));
        return record && record.id === id ? record : null;
      } catch {
        return null;
      }
    },
  };
}
