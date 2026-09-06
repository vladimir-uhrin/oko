// src/data/trackedPhoto.js
/**
 * @module trackedPhoto
 * @description Fotka sledovaného lietadla pod kartou sledovaného letu
 * (požiadavka 2026-09-05: „ak sa dá aj foto lietadla").
 *
 * Zdroj: Planespotters.net Photo API (jedna fotka na hex, bez kľúča). Ich
 * podmienky (prečítané 2026-09-05, www.planespotters.net/photo/api) určujú
 * tvar tohto modulu — nie je to len štýl:
 *   • obrázok sťahuje PRIAMO prehliadač, ktorý ho zobrazuje — žiadny proxy,
 *     žiadne serverové cachovanie, URL sa nesmú prepisovať;
 *   • meno fotografa musí byť viditeľný TEXT pri obrázku a náhľad musí byť
 *     obyčajný odkaz (`<a>` bez rel="nofollow") na stránku fotky z odpovede;
 *   • JSON odpoveď sa smie cachovať najviac 24 h; prázdne `photos: []` je
 *     bežný stav (HTTP 200), nie chyba — cachuje sa rovnako;
 *   • fotky ani metadáta nie sú na trénovanie modelov ani na re-export.
 *
 * Preto je fotka DOM prvok (odkaz + obrázok + kredit) ukotvený k obdĺžniku
 * karty z hostiteľa overlayu, nie kresba do canvasu — canvas nevie byť odkaz.
 * Dopyt ide len pre práve sledovaný stroj a mení sa len keď sa zmení hex.
 */
import { getOverlayPaintRect } from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { getActiveTrackedReadoutId } from './trackedReadout.js';
import { t } from '../i18n.js';

export const PLANESPOTTERS_PHOTO_API = 'https://api.planespotters.net/pub/photos/hex/';
/** Horný limit z podmienok API pre cache JSON odpovede. */
export const PHOTO_CACHE_TTL_MS = 24 * 3600 * 1000;
export const PHOTO_STORAGE_PREFIX = 'oko-planespotters:';
/**
 * Prekrytie karty fotkou (px): pás s fotkou sedí PRIAMO pod kartou, rovnako
 * široký, a prekrýva jej zaoblený spodný okraj, takže karta a fotka čítajú
 * ako jeden blok (používateľ 2026-09-05: „treba to dať spolu").
 */
export const PHOTO_OVERLAP_PX = 5;
/** Rozmer náhľadu v páse (px) — malý, vľavo, kredit vedľa neho. */
export const PHOTO_THUMB_W = 96;
export const PHOTO_THUMB_H = 54;
/** Karta bledšia než toto (fade na diaľku, keyhole) → pás sa nekreslí; slabšie by visel sám. */
export const PHOTO_MIN_CARD_ALPHA = 0.3;
/** Karta zmenšená pod túto mierku (pohľad na svet) → pás sa nekreslí. */
export const PHOTO_MIN_CARD_SCALE = 0.7;
/** Po neúspešnom dopyte (403/429/sieť/CORS) sa ten istý hex neskúša skôr než po tomto čase. */
export const PHOTO_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
/** Prefix id záznamu sledovaného letu v hostiteľovi (viď flights.js gevTrackedId). */
const FLIGHTS_ENTRY_PREFIX = 'flights:';

/**
 * URL dopytu pre 24-bitovú ICAO adresu; null pre neplatný hex. Pure.
 * @param {string} hex
 * @returns {string|null}
 */
export function planespottersUrlForHex(hex) {
  const clean = String(hex || '').trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(clean) ? `${PLANESPOTTERS_PHOTO_API}${clean}` : null;
}

/**
 * Prvá použiteľná fotka z odpovede API (URL náhľadu, odkaz, fotograf). Pure.
 * `photos: []` aj chýbajúce polia dávajú null.
 * @param {object|null} json
 * @returns {?{src: string, width: number|null, height: number|null, link: string, photographer: string}}
 */
export function parsePlanespottersPhoto(json) {
  const photo = Array.isArray(json?.photos) ? json.photos.find((p) => p?.thumbnail?.src && p?.link) : null;
  if (!photo) return null;
  const src = String(photo.thumbnail.src);
  const link = String(photo.link);
  if (!/^https:\/\//.test(src) || !/^https:\/\//.test(link)) return null;
  return {
    src,
    width: Number.isFinite(photo.thumbnail.size?.width) ? photo.thumbnail.size.width : null,
    height: Number.isFinite(photo.thumbnail.size?.height) ? photo.thumbnail.size.height : null,
    link,
    photographer: String(photo.photographer || '').trim(),
  };
}

/**
 * Je záznam cache ešte platný (do 24 h)? Pure.
 * @param {?{at: number}} entry
 * @param {number} [now]
 */
export function isPhotoCacheFresh(entry, now = Date.now()) {
  return Boolean(entry) && Number.isFinite(entry.at) && now - entry.at >= 0 && now - entry.at < PHOTO_CACHE_TTL_MS;
}

/**
 * Poloha pásu s fotkou: zarovnaný s ľavým okrajom karty, rovnako široký,
 * prilepený k jej spodku (prekrýva zaoblenie). Keď pod kartou niet miesta,
 * prilepí sa zhora. Pure.
 * @param {{x:number,y:number,w:number,h:number}} rect obdĺžnik karty (CSS px)
 * @param {{w:number,h:number}} size rozmer pásu (šírka = šírka karty)
 * @param {{w:number,h:number}} viewport
 * @returns {{x:number,y:number,w:number,above:boolean}}
 */
export function photoPlacement(rect, size, viewport, overlap = PHOTO_OVERLAP_PX) {
  const w = Math.max(1, Math.round(rect.w));
  let y = rect.y + rect.h - overlap;
  let above = false;
  if (y + size.h > viewport.h - 4 && rect.y - size.h + overlap >= 4) {
    y = rect.y - size.h + overlap;
    above = true;
  }
  return { x: Math.round(rect.x), y: Math.round(y), w, above };
}

/**
 * Viditeľnosť a skutočný (škálovaný) obdĺžnik karty z hostiteľského rectu.
 * Hostiteľ publikuje neškálovaný rect + `paintScale` + `alpha` (kartu kreslí
 * zmenšenú a vyblednutú na diaľku); pás musí sedieť na tom, čo vidno. Pure.
 * @param {?{x:number,y:number,w:number,h:number,alpha?:number,paintScale?:number}} rect
 * @returns {?{x:number,y:number,w:number,h:number,opacity:number}} null = pás skryť
 */
export function photoVisibility(rect) {
  if (!rect) return null;
  const alpha = Number.isFinite(rect.alpha) ? rect.alpha : 1;
  const scale = Number.isFinite(rect.paintScale) ? rect.paintScale : 1;
  if (alpha < PHOTO_MIN_CARD_ALPHA || scale < PHOTO_MIN_CARD_SCALE) return null;
  return { x: rect.x, y: rect.y, w: rect.w * scale, h: rect.h * scale, opacity: Math.min(1, alpha) };
}

const state = {
  viewer: null,
  root: null,
  img: null,
  credit: null,
  currentHex: null,
  photo: null,
  loading: false,
  memory: new Map(),
  /** @type {Map<string, number>} hex → čas posledného zlyhania (cooldown) */
  failed: new Map(),
  warned: false,
  storage: null,
  storageExplicit: false,
  fetchImpl: null,
  now: () => Date.now(),
  removePostRender: null,
  removeTrackedChanged: null,
  requests: 0,
};

function readCache(hex) {
  const mem = state.memory.get(hex);
  if (isPhotoCacheFresh(mem, state.now())) return mem;
  try {
    const raw = state.storage?.getItem?.(`${PHOTO_STORAGE_PREFIX}${hex}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isPhotoCacheFresh(parsed, state.now())) { state.memory.set(hex, parsed); return parsed; }
  } catch { /* poškodený alebo súkromný režim */ }
  return null;
}

function writeCache(hex, photo) {
  const entry = { at: state.now(), photo };
  state.memory.set(hex, entry);
  try { state.storage?.setItem?.(`${PHOTO_STORAGE_PREFIX}${hex}`, JSON.stringify(entry)); } catch { /* best effort */ }
  return entry;
}

async function lookup(hex) {
  const cached = readCache(hex);
  if (cached) return cached.photo;
  const url = planespottersUrlForHex(hex);
  if (!url || !state.fetchImpl) return null;
  const failedAt = state.failed.get(hex);
  if (Number.isFinite(failedAt) && state.now() - failedAt < PHOTO_FAILURE_COOLDOWN_MS) return null;
  state.requests += 1;
  try {
    const res = await state.fetchImpl(url);
    if (!res?.ok) { state.failed.set(hex, state.now()); return null; } // 403/429/5xx: krátky cooldown, nie 24 h cache
    const photo = parsePlanespottersPhoto(await res.json());
    writeCache(hex, photo); // aj null — prázdny výsledok je bežný a cachuje sa rovnako
    return photo;
  } catch (err) {
    // Sieť alebo CORS. Naživo 2026-09-05 z http://localhost: prvý dopyt po
    // načítaní stránky raz skončil „No Access-Control-Allow-Origin", ďalšie
    // dopyty na ten istý hex prešli — správanie ich edge cache, nie chyba
    // klienta. Preto krátky cooldown a nový pokus, nie 24 h negatívna cache.
    // Jedno hlásenie na session, potom ticho — fotka je doplnok, nie dáta.
    state.failed.set(hex, state.now());
    if (!state.warned) {
      state.warned = true;
      console.info('[TrackedPhoto] Planespotters fetch failed (network/CORS) — photos stay hidden this session:', err?.message || err);
    }
    return null;
  }
}

/**
 * Zdieľaný dopyt na fotku (kartička pod kurzorom používa tú istú cache,
 * cooldown aj podmienky). Bez inštalácie pásu si doplní predvolený fetch a
 * localStorage. Vracia fotku alebo null.
 * @param {string} hex 24-bitová ICAO adresa
 * @returns {Promise<?{src: string, link: string, photographer: string}>}
 */
export function lookupPlanespottersPhoto(hex) {
  if (!state.fetchImpl && typeof fetch === 'function') state.fetchImpl = (url) => fetch(url);
  if (state.storage === null && !state.storageExplicit && typeof localStorage !== 'undefined') state.storage = localStorage;
  return lookup(String(hex || '').trim().toLowerCase());
}

function hide() {
  if (state.root && !state.root.hidden) state.root.hidden = true;
}

function render(photo) {
  if (!state.root) return;
  if (!photo) { hide(); return; }
  state.root.href = photo.link;
  state.root.title = t('photo.open');
  state.img.src = photo.src;
  state.img.alt = t('photo.alt');
  state.credit.textContent = photo.photographer
    ? t('photo.credit', { name: photo.photographer })
    : t('photo.credit-anonymous');
  state.root.hidden = false;
}

function sync() {
  if (!state.root) return;
  const id = getActiveTrackedReadoutId();
  if (!id || !id.startsWith(FLIGHTS_ENTRY_PREFIX)) { state.currentHex = null; state.photo = null; hide(); return; }
  const hex = id.slice(FLIGHTS_ENTRY_PREFIX.length).toLowerCase();
  if (hex !== state.currentHex) {
    state.currentHex = hex;
    state.photo = null;
    hide();
    state.loading = true;
    lookup(hex).then((photo) => {
      if (state.currentHex !== hex) return; // medzitým sa sleduje iný stroj
      state.loading = false;
      state.photo = photo;
      render(photo);
      // Nová fotka si vyžiada snímok, nech sa ukotví aj pri nehybnej kamere.
      if (photo) governorRequestRender('tracked-photo');
    });
  }
  if (!state.photo) return;
  const visible = photoVisibility(getOverlayPaintRect('tracked', id));
  if (!visible) { hide(); return; }
  if (state.root.hidden) state.root.hidden = false;
  const view = state.root.ownerDocument.defaultView;
  const size = { w: visible.w, h: state.root.offsetHeight || PHOTO_THUMB_H + 15 };
  const { x, y, w, above } = photoPlacement(visible, size, { w: view?.innerWidth || 0, h: view?.innerHeight || 0 });
  state.root.style.width = `${w}px`;
  state.root.style.opacity = String(visible.opacity);
  state.root.style.transform = `translate(${x}px, ${y}px)`;
  state.root.classList?.toggle?.('is-above', above);
}

/**
 * Nainštaluje fotku sledovaného letu. Idempotentné.
 * @param {object} viewer Cesium viewer (scene.postRender)
 * @param {object} options
 * @param {HTMLElement} options.container rodič (typicky document.body)
 * @param {Function} [options.fetchImpl] test seam
 * @param {Storage|null} [options.storage] test seam (default localStorage)
 * @param {() => number} [options.now] test seam
 */
export function installTrackedPhoto(viewer, { container, fetchImpl, storage, now } = {}) {
  if (state.root || !container) return;
  const doc = container.ownerDocument;
  state.viewer = viewer;
  state.fetchImpl = fetchImpl || (typeof fetch === 'function' ? (url) => fetch(url) : null);
  state.storage = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  state.storageExplicit = storage !== undefined;
  if (typeof now === 'function') state.now = now;
  const root = doc.createElement('a');
  root.className = 'tracked-photo';
  root.target = '_blank';
  root.rel = 'noopener'; // ZÁMERNE bez nofollow — podmienka Planespotters
  root.hidden = true;
  const img = doc.createElement('img');
  img.className = 'tracked-photo-image';
  img.decoding = 'async';
  img.loading = 'eager';
  img.referrerPolicy = 'strict-origin-when-cross-origin';
  const credit = doc.createElement('span');
  credit.className = 'tracked-photo-credit';
  root.appendChild(img);
  root.appendChild(credit);
  container.appendChild(root);
  state.root = root; state.img = img; state.credit = credit;
  const postRender = viewer?.scene?.postRender;
  if (postRender?.addEventListener) {
    postRender.addEventListener(sync);
    state.removePostRender = () => postRender.removeEventListener(sync);
  }
  // Render governor kreslí len na požiadanie: po zrušení sledovania už
  // nemusí prísť žiadny snímok, takže postRender by fotku nechal visieť
  // (naživo 2026-09-05 nad Doverom). Zmena sledovaného objektu preto
  // skrýva/prepína fotku priamo.
  const changed = viewer?.trackedEntityChanged;
  if (changed?.addEventListener) {
    const onChanged = () => {
      if (!viewer.trackedEntity) { state.currentHex = null; state.photo = null; hide(); return; }
      sync();
    };
    const remove = changed.addEventListener(onChanged);
    state.removeTrackedChanged = typeof remove === 'function' ? remove : () => changed.removeEventListener?.(onChanged);
  }
}

/** Odstráni fotku a odhlási listener (teardown viewera). */
export function destroyTrackedPhoto() {
  state.removePostRender?.();
  state.removePostRender = null;
  state.removeTrackedChanged?.();
  state.removeTrackedChanged = null;
  state.root?.remove();
  state.root = null; state.img = null; state.credit = null;
  state.currentHex = null; state.photo = null; state.loading = false;
  state.viewer = null;
}

/** Test seam: jeden krok synchronizácie + pohľad na stav. */
export function _syncTrackedPhotoForTest() { sync(); }
export function _getTrackedPhotoStateForTest() {
  return {
    installed: Boolean(state.root),
    hidden: state.root ? state.root.hidden : null,
    currentHex: state.currentHex,
    photo: state.photo,
    requests: state.requests,
    href: state.root?.href || null,
    rel: state.root?.rel || null,
    credit: state.credit?.textContent || '',
    transform: state.root?.style?.transform || '',
  };
}
export function _resetTrackedPhotoForTest() {
  destroyTrackedPhoto();
  state.memory.clear();
  state.failed.clear();
  state.warned = false;
  state.requests = 0;
  state.now = () => Date.now();
}
