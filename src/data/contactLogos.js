// src/data/contactLogos.js
/**
 * @module contactLogos
 * @description Klientská strana lôg aerolínií a výrobcov na karte
 * (2026-09-12, „aj logá spoločnosti a výrobcu lietadiel"): dopyt na proxy
 * `/api/logo?kind=&name=` (Wikipedia infobox → Commons, len slobodné
 * licencie — viď logoResolve.js a logoProxy vo vite.config.js), cache
 * metadát s TTL, `onDone` len po skutočnom fetchi (vzor ACARS), obrázky
 * v cache ako pri vlajkách (countryFlags.js) s listenerom na prekreslenie.
 * Injektovateľný fetcher a továreň obrázkov — testovateľné v Node.
 */
import { manufacturerFromType, normalizeLogoName } from './logoResolve.js';

export const LOGO_CACHE_TTL_MS = 24 * 3600_000;
export const LOGO_FAILURE_TTL_MS = 6 * 3600_000;
/** Výška loga na karte (px) a strop šírky — logo je glyf pri texte, nie obrázok. */
export const LOGO_HEIGHT_PX = 14;
export const LOGO_MAX_WIDTH_PX = 96;
export const LOGO_GAP_PX = 14;
/** Svetlá doštička pod načítaným logom (px okolo obrázka). */
export const LOGO_PLATE_PAD_PX = 2;
const FALLBACK_ASPECT = 3;

const _meta = new Map();
const _images = new Map();
let _onReady = null;
let _disabled = false;

/** Kľúč cache: druh + normalizované meno; null bez mena. */
export function logoKey(kind, name) {
  const n = normalizeLogoName(name);
  return n ? `${kind}:${n}` : null;
}

/** Metadáta loga z cache (null: nemáme, zamietnuté alebo ešte nevyžiadané). */
export function cachedContactLogo(kind, name) {
  const key = logoKey(kind, name);
  const entry = key ? _meta.get(key) : null;
  return entry?.meta || null;
}

/**
 * Vyžiada logo z proxy; true, keď prebehol skutočný fetch.
 * @param {'airline'|'manufacturer'} kind
 * @param {string} name meno dopravcu alebo titul výrobcu (logoResolve.manufacturerFromType().title)
 * @param {{fetcher?: Function, onDone?: Function, nowMs?: number}} [options]
 */
export async function requestContactLogo(kind, name, { fetcher = globalThis.fetch, onDone = () => {}, nowMs = Date.now() } = {}) {
  const key = logoKey(kind, name);
  if (!key || _disabled || typeof fetcher !== 'function') return false;
  const existing = _meta.get(key);
  if (existing && (existing.pending || nowMs - existing.at < existing.ttl)) return false;
  _meta.set(key, { meta: existing?.meta || null, at: nowMs, ttl: LOGO_FAILURE_TTL_MS, pending: true });
  try {
    const params = new URLSearchParams({ kind, name: String(name).trim() });
    const response = await fetcher(`/api/logo?${params}`);
    if (response?.status === 503) { _disabled = true; _meta.set(key, { meta: null, at: nowMs, ttl: Infinity, pending: false }); return false; }
    if (!response?.ok) throw new Error(`logo HTTP ${response?.status}`);
    const json = await response.json();
    const meta = json?.ok && typeof json.url === 'string' && json.url.startsWith('/api/logo/img/')
      ? {
        kind,
        name: String(name).trim(),
        title: String(json.title || ''),
        file: String(json.file || ''),
        license: String(json.license || ''),
        author: String(json.author || ''),
        url: json.url,
        width: Number(json.width) || null,
        height: Number(json.height) || null,
      }
      : null;
    _meta.set(key, { meta, at: nowMs, ttl: LOGO_CACHE_TTL_MS, pending: false });
    try { onDone(); } catch { /* prebudovanie karty je best effort */ }
    return true;
  } catch {
    _meta.set(key, { meta: existing?.meta || null, at: nowMs, ttl: LOGO_FAILURE_TTL_MS, pending: false });
    return false;
  }
}

/** Obe logá stroja z cache: { airline, manufacturer } (metadáta alebo null); null, keď nič. Pure nad cache. */
export function contactLogosFor({ airline, typeName } = {}) {
  const maker = manufacturerFromType(typeName);
  const out = {
    airline: airline ? cachedContactLogo('airline', airline) : null,
    manufacturer: maker ? cachedContactLogo('manufacturer', maker.title) : null,
  };
  return out.airline || out.manufacturer ? out : null;
}

/** Vyžiada obe logá stroja (každé s vlastnou cache). */
export function requestContactLogos({ airline, typeName } = {}, options = {}) {
  const maker = manufacturerFromType(typeName);
  const jobs = [];
  if (airline) jobs.push(requestContactLogo('airline', airline, options));
  if (maker) jobs.push(requestContactLogo('manufacturer', maker.title, options));
  return Promise.all(jobs);
}

/** Registruje callback pre dotiahnutie obrázka loga (typicky requestRender). */
export function setLogoReadyListener(listener) {
  _onReady = typeof listener === 'function' ? listener : null;
}

/**
 * Obrázok loga z cache (načíta pri prvom dopyte); null bez DOM.
 * @param {{url: string}} meta
 * @param {{imageFactory?: () => any}} [options] test seam
 */
export function getLogoImage(meta, options = {}) {
  const url = String(meta?.url || '');
  if (!url) return null;
  let entry = _images.get(url);
  if (entry) return entry;
  const factory = options.imageFactory || (typeof Image !== 'undefined' ? () => new Image() : null);
  if (!factory) return null;
  const image = factory();
  entry = { image, ready: false, failed: false };
  _images.set(url, entry);
  image.onload = () => { entry.ready = true; _onReady?.(); };
  image.onerror = () => { entry.failed = true; };
  image.decoding = 'async';
  image.src = url;
  return entry;
}

/** Kreslená veľkosť: výška pevná, šírka z pomeru strán (strop LOGO_MAX_WIDTH_PX). Pure. */
export function logoDrawSize(meta, heightPx = LOGO_HEIGHT_PX, maxWidthPx = LOGO_MAX_WIDTH_PX) {
  const w = Number(meta?.width);
  const h = Number(meta?.height);
  const aspect = w > 0 && h > 0 ? w / h : FALLBACK_ASPECT;
  const width = Math.round(Math.max(heightPx, Math.min(maxWidthPx, heightPx * aspect)));
  const height = aspect > 0 && heightPx * aspect > maxWidthPx ? Math.round(maxWidthPx / aspect) : heightPx;
  return { w: width, h: Math.max(6, height) };
}

/**
 * Nakreslí logo (alebo tichý obdĺžnik, kým sa ťahá) a vráti zabranú šírku.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{url: string, width?: number, height?: number}} meta
 * @param {number} x ľavý okraj
 * @param {number} y horný okraj riadku (výška LOGO_HEIGHT_PX)
 * @param {number} [heightPx]
 */
export function paintLogo(ctx, meta, x, y, heightPx = LOGO_HEIGHT_PX) {
  if (!ctx || !meta?.url) return 0;
  const { w, h } = logoDrawSize(meta, heightPx);
  const entry = getLogoImage(meta);
  const top = y + Math.round((heightPx - h) / 2);
  if (entry?.ready && typeof ctx.drawImage === 'function') {
    // Logá sú kreslené na biely podklad (Boeing tmavomodrý, Airbus tmavý) —
    // na tmavej karte boli neviditeľné (naživo 2026-09-12). Svetlá doštička
    // s 3 px okrajom ich urobí čitateľnými a zjednotí vzhľad.
    if (typeof ctx.fillRect === 'function') {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      if (typeof ctx.beginPath === 'function' && typeof ctx.roundRect === 'function' && typeof ctx.fill === 'function') {
        ctx.beginPath();
        ctx.roundRect(x - LOGO_PLATE_PAD_PX, top - LOGO_PLATE_PAD_PX, w + 2 * LOGO_PLATE_PAD_PX, h + 2 * LOGO_PLATE_PAD_PX, 3);
        ctx.fill();
      } else {
        ctx.fillRect(x - LOGO_PLATE_PAD_PX, top - LOGO_PLATE_PAD_PX, w + 2 * LOGO_PLATE_PAD_PX, h + 2 * LOGO_PLATE_PAD_PX);
      }
      ctx.restore();
    }
    try { ctx.drawImage(entry.image, x, top, w, h); } catch { /* obrázok medzi snímkami zmizol */ }
  } else if (typeof ctx.fillRect === 'function') {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x, top, w, h);
    ctx.restore();
  }
  return w;
}

/** Iba pre testy. */
export function _resetContactLogosForTest() {
  _meta.clear();
  _images.clear();
  _onReady = null;
  _disabled = false;
}
