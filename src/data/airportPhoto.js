// src/data/airportPhoto.js
/**
 * @module airportPhoto
 * @description Fotka letiska pre kartu letiska (2026-09-05, používateľ:
 * „Fotky letísk nevieš pridať?"). Zdroj: hlavný obrázok článku na Wikipédii
 * (OurAirports nesie `wikipedia_link`), teda súbor na Wikimedia Commons.
 *
 * Prečo takto a nie inak:
 *   • Wikimedia API má CORS (`origin=*`), žiadny kľúč, žiadny proxy — dopyt
 *     ide priamo z prehliadača, jeden na letisko a kartu, cache 7 dní;
 *   • každý súbor nesie VLASTNÚ licenciu (CC BY-SA, CC BY, public domain…) a
 *     autora v `extmetadata` — karta ukazuje autora, licenciu a odkaz na
 *     stránku súboru (splnenie atribúcie pre CC BY/BY-SA);
 *   • súbory bez slobodnej licencie (fair use na enwiki) sa NEzobrazia —
 *     rozpoznáme ich podľa chýbajúcej/nesúhlasnej licencie;
 *   • náhľady (`upload.wikimedia.org/.../thumb/...`) sú na hotlink určené.
 *
 * Dva kroky API: `prop=pageimages` (názov a náhľad hlavného obrázka článku)
 * a `prop=imageinfo` (URL, stránka súboru, extmetadata). Parsery sú čisté a
 * testované; fetch/cache je tenký obal.
 */

/** Cache odpovedí (localStorage aj pamäť) — 7 dní, aj negatívny výsledok. */
export const AIRPORT_PHOTO_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
export const AIRPORT_PHOTO_STORAGE_PREFIX = 'oko-wikiphoto:';
/** Šírka náhľadu, ktorú žiadame (karta má 316 px vnútornej šírky). */
export const AIRPORT_PHOTO_THUMB_PX = 640;
/** Wikimedia žiada JS klientov o identifikáciu; bez osobných údajov. */
export const WIKIMEDIA_API_USER_AGENT = 'OKO globe (open-source spatial viewer; dev build)';

/**
 * Jazyk a názov článku z odkazu na Wikipédiu. Pure.
 * `https://en.wikipedia.org/wiki/Bratislava_Airport` → {lang:'en', title:'Bratislava_Airport'}
 * @param {string|null} link
 * @returns {?{lang: string, title: string}}
 */
export function wikipediaTitleFromUrl(link) {
  const text = String(link || '').trim();
  const m = /^https?:\/\/([a-z][a-z0-9-]*)\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i.exec(text);
  if (!m) return null;
  let title;
  try { title = decodeURIComponent(m[2]); } catch { title = m[2]; }
  title = title.replace(/\s+/g, '_').trim();
  return title ? { lang: m[1].toLowerCase(), title } : null;
}

/** URL dopytu na hlavný obrázok článku. Pure. */
export function pageImageApiUrl({ lang, title }, thumbPx = AIRPORT_PHOTO_THUMB_PX) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', redirects: '1',
    prop: 'pageimages', piprop: 'thumbnail|original|name', pithumbsize: String(thumbPx),
    titles: title,
  });
  return `https://${lang}.wikipedia.org/w/api.php?${params}`;
}

/** URL dopytu na licenciu a autora súboru (enwiki API vidí aj Commons). Pure. */
export function imageInfoApiUrl({ lang, file }) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    prop: 'imageinfo', iiprop: 'url|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|Credit|AttributionRequired|UsageTerms',
    titles: `File:${file}`,
  });
  return `https://${lang}.wikipedia.org/w/api.php?${params}`;
}

/**
 * Hlavný obrázok z odpovede `prop=pageimages`. Pure.
 * @returns {?{file: string, thumb: string, width: number|null, height: number|null}}
 */
export function parsePageImage(json) {
  const pages = json?.query?.pages;
  if (!pages || typeof pages !== 'object') return null;
  const page = Object.values(pages).find((p) => p && !('missing' in p) && p.pageimage && p.thumbnail?.source);
  if (!page) return null;
  const src = String(page.thumbnail.source).replace(/[?&]utm_[^&]*/g, '').replace(/\?$/, '');
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(src)) return null;
  return {
    file: String(page.pageimage),
    thumb: src,
    width: Number.isFinite(page.thumbnail.width) ? page.thumbnail.width : null,
    height: Number.isFinite(page.thumbnail.height) ? page.thumbnail.height : null,
  };
}

/** Text bez HTML značiek (Artist prichádza ako `<a href=…>Meno</a>`). Pure. */
export function stripHtml(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Je licencia slobodná (smieme zobraziť s atribúciou)? Fair use / nezistené = nie. Pure.
 * @param {string} shortName napr. 'CC BY-SA 4.0', 'Public domain', 'CC0'
 */
export function isFreeLicense(shortName) {
  const s = stripHtml(shortName).toLowerCase();
  if (!s) return false;
  if (/fair use|non-free|copyrighted|all rights reserved/.test(s)) return false;
  return /cc[- ]by|cc0|public domain|pd-|gfdl|free art|attribution|odbl|ogl|no known copyright/.test(s);
}

/**
 * Licencia, autor a odkazy súboru z odpovede `prop=imageinfo`. Pure.
 * @returns {?{artist: string, license: string, licenseUrl: string|null, filePage: string|null, free: boolean}}
 */
export function parseImageInfo(json) {
  const pages = json?.query?.pages;
  if (!pages || typeof pages !== 'object') return null;
  const page = Object.values(pages).find((p) => Array.isArray(p?.imageinfo) && p.imageinfo.length);
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const license = stripHtml(meta.LicenseShortName?.value);
  const artist = stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value);
  const licenseUrl = String(meta.LicenseUrl?.value || '').trim() || null;
  const filePage = String(info.descriptionurl || '').trim() || null;
  return { artist, license, licenseUrl: licenseUrl && /^https?:\/\//.test(licenseUrl) ? licenseUrl : null, filePage: filePage && /^https?:\/\//.test(filePage) ? filePage : null, free: isFreeLicense(license) };
}

/** Text kreditu pod fotkou: `Foto: Meno · CC BY-SA 4.0 · Wikimedia Commons`. Pure. */
export function photoCreditText(photo, translate) {
  const t = typeof translate === 'function' ? translate : (k, v) => `${k} ${JSON.stringify(v || {})}`;
  const parts = [photo?.artist, photo?.license].filter(Boolean).join(' · ');
  return t('airport.photo-credit', { credit: parts || t('airport.photo-credit-unknown') });
}

const memory = new Map();

function readCache(storage, key, now) {
  const mem = memory.get(key);
  if (mem && now - mem.at < AIRPORT_PHOTO_CACHE_TTL_MS) return mem;
  try {
    const raw = storage?.getItem?.(AIRPORT_PHOTO_STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed?.at) && now - parsed.at < AIRPORT_PHOTO_CACHE_TTL_MS) { memory.set(key, parsed); return parsed; }
  } catch { /* poškodené alebo súkromný režim */ }
  return null;
}

function writeCache(storage, key, photo, now) {
  const entry = { at: now, photo };
  memory.set(key, entry);
  try { storage?.setItem?.(AIRPORT_PHOTO_STORAGE_PREFIX + key, JSON.stringify(entry)); } catch { /* best effort */ }
}

/**
 * Fotka letiska z odkazu na Wikipédiu; null keď článok nemá slobodný obrázok.
 * @param {string|null} wikipediaLink
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] test seam
 * @param {Storage|null} [options.storage] test seam (default localStorage)
 * @param {number} [options.now]
 * @returns {Promise<?{thumb: string, width: number|null, height: number|null, artist: string, license: string, licenseUrl: string|null, filePage: string|null, articleUrl: string}>}
 */
export async function fetchAirportPhoto(wikipediaLink, { fetchImpl, storage, now = Date.now() } = {}) {
  const ref = wikipediaTitleFromUrl(wikipediaLink);
  if (!ref) return null;
  const store = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  const key = `${ref.lang}:${ref.title}`;
  const cached = readCache(store, key, now);
  if (cached) return cached.photo;
  const doFetch = fetchImpl || ((url) => fetch(url, { headers: { 'Api-User-Agent': WIKIMEDIA_API_USER_AGENT } }));
  try {
    const pageRes = await doFetch(pageImageApiUrl(ref));
    if (!pageRes?.ok) return null; // bez cache — skúsi sa pri ďalšom kliknutí
    const image = parsePageImage(await pageRes.json());
    if (!image) { writeCache(store, key, null, now); return null; }
    const infoRes = await doFetch(imageInfoApiUrl({ lang: ref.lang, file: image.file }));
    const info = infoRes?.ok ? parseImageInfo(await infoRes.json()) : null;
    // Bez zistenej slobodnej licencie fotku radšej nekreslíme.
    if (!info || !info.free) { writeCache(store, key, null, now); return null; }
    const photo = { ...image, artist: info.artist, license: info.license, licenseUrl: info.licenseUrl, filePage: info.filePage, articleUrl: String(wikipediaLink).trim() };
    writeCache(store, key, photo, now);
    return photo;
  } catch {
    return null;
  }
}

/** Test seam. */
export function _resetAirportPhotoCacheForTest() { memory.clear(); }
