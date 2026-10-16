// src/stadiaHealth.js — strážca podkladu Stadia (2026-10-15).
//
// Skúšobný plán Stadia Professional končí 20. 10. 2026; účet potom ostáva na bezplatnom pláne
// (stadiamaps.com/pricing: 200 000 kreditov mesačne, nekomerčné použitie, „No additional usage").
// Po vyčerpaní limitu alebo pri strate autorizácie domény Stadia odmieta dlaždice (401/403/429)
// a meteo by ostalo bez podkladu. Strážca nepýta nič navyše — počúva skutočné chyby dlaždíc
// (mapStackController, errorEvent poskytovateľa): po STADIA_FAIL_THRESHOLD odmietnutiach v okne
// STADIA_FAIL_WINDOW_MS je Stadia na STADIA_BLOCK_MS „mimo" (zapamätá sa v prehliadači, ďalšie
// načítanie ju rovno obíde) a podklad sa prepne na bezplatný bez kľúča (meteo: NASA Blue Marble,
// ostatné štýly: OpenStreetMap) — tou istou cestou ako klik na čip mapy (applyStadiaFallback).

import { STADIA_KEYLESS_HOSTS, stadiaAuthorizedHost } from './stadiaHosts.js';

export const STADIA_TILE_HOST = 'tiles.stadiamaps.com';
/** Odpovede, ktoré znamenajú „Stadia nás teraz neobslúži" (nie výpadok jednej dlaždice). */
export const STADIA_FAIL_STATUSES = Object.freeze([401, 403, 429]);
export const STADIA_FAIL_THRESHOLD = 3;
/**
 * Odmietnutia sa sčítajú len v tomto okne (2026-10-15). Vyčerpaný limit odmieta každú dlaždicu,
 * takže prah padne za pár desiatok sekúnd: odmietnutie pod prahom kontrolér overí znova sám o 10 s
 * (mapStackController._probeStadiaTile, 2026-10-16) — aj pri nehybnej kamere, keď nové chyby dlaždíc
 * neprichádzajú. Tri ojedinelé 429/401 v priebehu dňa nie sú vyčerpaný limit (opakované overenie
 * dostane 2xx) a nesmú Stadiu zablokovať na 6 h na každej ďalšej návšteve.
 */
export const STADIA_FAIL_WINDOW_MS = 5 * 60_000;
export const STADIA_BLOCK_MS = 6 * 3600 * 1000;
export const STADIA_STORAGE_KEY = 'oko.stadia.blockedUntil';
/** Náhrada podľa štýlu: tmavý → NASA Blue Marble (ako meteo bez Stadia), svetlé → OpenStreetMap. */
export const STADIA_FALLBACK_STACK = Object.freeze({
  'stadia-dark': 'gibs-blue-marble',
  'stadia-smooth': 'osm',
  'stadia-outdoors': 'osm',
  'stadia-terrain': 'osm',
});

/** Je URL dlaždica Stadia? Pure. */
export function isStadiaUrl(url) {
  return String(url || '').includes(STADIA_TILE_HOST);
}

/** Lokálny vývoj — Stadia tam ide bez účtu a limitu účtu sa netýka. Pure. */
function keylessHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  return STADIA_KEYLESS_HOSTS.includes(h) || h.endsWith('.localhost');
}

/**
 * @param {{ storage?: Storage|null, now?: () => number }} [options]
 */
export function createStadiaHealth({ storage = null, now = () => Date.now() } = {}) {
  /** Časy odmietnutí v okne STADIA_FAIL_WINDOW_MS. */
  let failures = [];
  let blockedUntil = 0;
  const listeners = new Set();
  try {
    const saved = Number(storage?.getItem?.(STADIA_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > now()) blockedUntil = saved;
  } catch { /* súkromné okno / zakázané úložisko — len v pamäti */ }

  return {
    /** Je Stadia teraz „mimo"? */
    blocked: () => now() < blockedUntil,
    blockedUntil: () => blockedUntil,
    /** Koľko ms ešte trvá blok (0 = Stadia nie je „mimo") — podľa hodín strážcu. */
    blockedForMs: () => Math.max(0, blockedUntil - now()),
    /**
     * Výsledok overenia dlaždice Stadia. Vráti true práve vtedy, keď sa Stadia touto chybou stala „mimo".
     * @param {number|undefined} status HTTP kód (undefined = sieť / iné — nepočíta sa)
     */
    noteTileError(status) {
      const code = Number(status);
      // Stadia dlaždicu vydala — predošlé odmietnutia boli prechodné, prah sa počíta odznova (2026-10-15).
      if (code >= 200 && code < 300) { failures = []; return false; }
      if (!STADIA_FAIL_STATUSES.includes(code)) return false;
      const t = now();
      if (t < blockedUntil) return false;
      failures = failures.filter((at) => t - at < STADIA_FAIL_WINDOW_MS);
      failures.push(t);
      if (failures.length < STADIA_FAIL_THRESHOLD) return false;
      failures = [];
      blockedUntil = t + STADIA_BLOCK_MS;
      try { storage?.setItem?.(STADIA_STORAGE_KEY, String(blockedUntil)); } catch { /* len v pamäti */ }
      for (const fn of listeners) { try { fn(); } catch { /* poslucháč nesmie zhodiť strážcu */ } }
      return true;
    },
    onBlocked(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Smie hostiteľ teraz použiť Stadia? Autorizovaný a (lokálne vždy, inak) nie „mimo". */
    usableHost(hostname) {
      if (!stadiaAuthorizedHost(hostname)) return false;
      return keylessHost(hostname) || now() >= blockedUntil;
    },
  };
}

let _shared = null;
/** Spoločný strážca prehliadača (localStorage); v Node bez úložiska. */
export function stadiaHealth() {
  if (!_shared) {
    let storage = null;
    try { storage = globalThis.localStorage || null; } catch { storage = null; }
    _shared = createStadiaHealth({ storage });
  }
  return _shared;
}

/** Test-only: vymeň spoločného strážcu (vlastné hodiny); vráti predošlého. null = nový pri ďalšom volaní. */
export function _setStadiaHealthForTest(health) {
  const previous = _shared;
  _shared = health || null;
  return previous;
}

/** Smie hostiteľ teraz použiť Stadia (autorizácia + strážca)? Prázdny hostiteľ = testy/Node → podľa autorizácie. */
export function stadiaUsableHost(hostname) {
  const h = String(hostname || '').trim();
  if (!h) return true;
  return stadiaHealth().usableHost(h);
}

/**
 * Stadia „mimo" → bezplatná náhrada tou istou cestou ako klik na čip mapy (2026-10-15). Kontrolér
 * predtým prepínal sám (setStack): čipy, štítok mapy aj zdieľaný odkaz ostali na Stadii a mapa podľa
 * vrstvy brala náhradu za cudziu zmenu — meteo po vypnutí nevrátilo Google 3D. Poradie je podstatné:
 * (1) mapa podľa vrstvy si náhradu prevezme ešte PRED prepnutím (inak ju zmena mapy zruší),
 * (2) čipy sa prekreslia celé (štýly Stadia sú odteraz nedostupné — sync mení len aktívny čip),
 * (3) prepnutie cez StyleManager (čipy, štítok, zdieľaný odkaz).
 * Keď prepnutie cez UI zlyhá (výnimka alebo zamietnutý sľub), prepne `directSwitch` (kontrolér) —
 * glóbus nesmie ostať na odmietajúcej Stadii: ďalšie overenie už nepríde, Stadia je „mimo" (2026-10-16).
 * @param {{ from?: string|null, to?: string|null }|null|undefined} info z MapStackController (`to` null = aktívna mapa nie je Stadia)
 * @param {{ adopt?: () => void, refreshControls?: () => void, switchStack?: (id: string) => unknown, directSwitch?: (id: string) => unknown }} [steps]
 * @returns {string|null} náhrada, na ktorú sa prepína
 */
export function applyStadiaFallback(info, { adopt = null, refreshControls = null, switchStack = null, directSwitch = null } = {}) {
  const to = info?.to || null;
  // Každý krok zvlášť: chyba v jednom nesmie nechať glóbus na odmietajúcej Stadii.
  try { adopt?.(); } catch (error) { console.warn('[map] Stadia: mapa podľa vrstvy', error); }
  try { refreshControls?.(); } catch (error) { console.warn('[map] Stadia: čipy mapy', error); }
  if (!to) return null;
  const rescue = (error) => {
    console.warn('[map] Stadia: prepnutie cez UI zlyhalo — prepína kontrolér', error);
    try { void Promise.resolve(directSwitch?.(to)).catch(() => {}); } catch { /* posledná záchrana */ }
  };
  if (typeof switchStack !== 'function') { rescue(new Error('bez prepínača UI')); return to; }
  try { void Promise.resolve(switchStack(to)).catch(rescue); } catch (error) { rescue(error); }
  return to;
}

/** setTimeout znesie najviac ~24,8 dňa; blok trvá 6 h. Rezerva, aby pri zavolaní blok naozaj skončil. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const EXPIRY_SLACK_MS = 1000;

/**
 * Koniec bloku Stadia (2026-10-16): čipy sa pri bloku (alebo pri štarte so zapamätaným blokom)
 * vykreslia s rodinou Stadia nedostupnou a sync mení len aktívny čip — v karte otvorenej dlhšie
 * ako STADIA_BLOCK_MS by Stadia ostala sivá s „neposiela dlaždice" až do obnovenia stránky.
 * `fn` sa zavolá po každom skončení bloku; nový blok časovač natiahne znova.
 * @param {() => void} fn
 * @param {{ health?: object, setTimeoutImpl?: Function, clearTimeoutImpl?: Function }} [options]
 * @returns {() => void} odhlásenie
 */
export function onStadiaBlockExpired(fn, {
  health = stadiaHealth(),
  // unref: v Node (testy) 6 h časovač nesmie držať proces; v prehliadači je id číslo.
  setTimeoutImpl = (cb, ms) => { const id = setTimeout(cb, ms); id?.unref?.(); return id; },
  clearTimeoutImpl = (id) => clearTimeout(id),
} = {}) {
  let timer = null;
  const arm = () => {
    if (timer !== null) { clearTimeoutImpl(timer); timer = null; }
    const wait = health.blockedForMs();
    if (!(wait > 0)) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      // Hodiny stránky a časovača sa môžu rozísť (uspaný telefón) — ešte blokované = počkaj znova.
      if (health.blocked()) { arm(); return; }
      try { fn(); } catch (error) { console.warn('[map] Stadia: koniec bloku', error); }
    }, Math.min(wait + EXPIRY_SLACK_MS, MAX_TIMER_MS));
  };
  const off = health.onBlocked(arm);
  arm();
  return () => { off(); if (timer !== null) clearTimeoutImpl(timer); timer = null; };
}

/**
 * Zapojenie strážcu do UI (2026-10-16) — main.js volá len toto, test zapojenia ide cez tú istú funkciu.
 * Blok → applyStadiaFallback (mapa podľa vrstvy, prekreslenie čipov, prepnutie cez StyleManager;
 * pri zlyhaní UI prepne kontrolér sám); koniec bloku → čipy znova (Stadia dostupná).
 * @param {object} deps
 * @param {{ setStadiaBlockedHandler: Function, getActiveId?: () => string|null, setStack?: (id: string) => unknown }} deps.controller MapStackController
 * @param {() => void} [deps.adopt] layerBasemap.onStadiaBlocked
 * @param {() => void} [deps.refreshControls] StyleManager._initMapStackControl
 * @param {(id: string) => unknown} [deps.switchStack] StyleManager._setMapStack
 * @param {object} [deps.health] strážca (predvolene spoločný — ten istý, ktorý číta kontrolér)
 * @returns {() => void} odpojenie
 */
export function installStadiaFallback({
  controller, adopt = null, refreshControls = null, switchStack = null, health = stadiaHealth(), setTimeoutImpl, clearTimeoutImpl,
} = {}) {
  controller?.setStadiaBlockedHandler?.((info) => applyStadiaFallback(info, {
    adopt,
    refreshControls,
    switchStack,
    // Len keď UI neprepla — rovnaký podklad by sa inak zbytočne staval znova.
    directSwitch: (id) => (controller.getActiveId?.() === id ? null : controller.setStack?.(id)),
  }));
  const stopExpiry = onStadiaBlockExpired(() => refreshControls?.(), {
    health,
    ...(setTimeoutImpl ? { setTimeoutImpl } : {}),
    ...(clearTimeoutImpl ? { clearTimeoutImpl } : {}),
  });
  return () => { controller?.setStadiaBlockedHandler?.(null); stopExpiry(); };
}
