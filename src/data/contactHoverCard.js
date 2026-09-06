// src/data/contactHoverCard.js
/**
 * @module contactHoverCard
 * @description Kartička pod kurzorom pre kontakt, nad ktorým sa práve nachádza
 * myš (2026-09-03: „keď som ďaleko zazoomovaný, mohli by sa po prejdení myšou
 * objaviť základné informácie o lete a lietadle"; 2026-09-05: „chcem to mouse
 * over a potom všetko zmizne" — plná karta s vlajkami, trasou, progresom,
 * zdrojom dát a fotkou sa ukáže pri prejdení myšou a po odídení zmizne).
 *
 * PREČO SAMOSTATNE OD DETEKCIE: hover-inspect v detectionHover.js rozsvieti
 * detekčnú zostavu, tá je ale za prepínačom DETEKCIA a nesie len volací znak
 * a letovú hladinu. Kartička má fungovať aj s vypnutou detekciou a povedať
 * viac — je to iná otázka („čo je to za stroj?"), nie iný stav tej istej.
 *
 * Skladanie modelu je ČISTÁ funkcia (`hoverCardModel`) oddelená od DOM a
 * zdieľa formátery s kartou sledovaného letu (trackedCardModel.js), takže obe
 * karty hovoria tou istou rečou. `installContactHoverCard` je tenký obal,
 * ktorý drží jeden element a polohuje ho pri kurzore.
 *
 * FOTKA (Planespotters, podmienky viď trackedPhoto.js): kartička sama myš
 * nechytá (pointer-events: none — inak by pohltila MOUSE_MOVE, ktorý ju drží
 * nažive), ale odkaz s fotkou áno: keď naň kurzor prejde, canvas prestane
 * dostávať pohyby, kartička ostane a fotka sa dá kliknuť. Odídenie z odkazu
 * ju zhasne. Dopyt na fotku ide až po krátkom zotrvaní nad strojom (debounce),
 * nech prelet myšou cez flotilu nespúšťa desiatky dopytov.
 */
import { flagUrl, resolveFlagIso2 } from './countryFlags.js';
import {
  formatFlightLine,
  formatMetaLine,
  formatTrack,
  progressRowFromProgress,
  routeRowFromRoute,
} from './trackedCardModel.js';
import { lookupPlanespottersPhoto } from './trackedPhoto.js';

/** Odsadenie kartičky od kurzora (px) — nesmie sedieť pod hrotom myši. */
const CARD_OFFSET_PX = 14;
/** Fotka sa dopytuje až po tomto zotrvaní nad tým istým strojom (ms). */
export const HOVER_PHOTO_DEBOUNCE_MS = 350;
const MPS_TO_KTS = 1.94384;

/**
 * Model kartičky pre jedno zhrnutie kontaktu (rovnaké riadky ako karta
 * sledovaného letu). Vynecháva všetko, čo nie je známe — pri oddialenom
 * pohľade chýba typ aj trasa (enrichment beží prednostne pre stroje na
 * obrazovke) a prázdny riadok by sa tváril ako chýbajúca hodnota.
 * @param {object|null} summary Výstup `getContactSummary()`.
 * @param {(key: string, vars?: object) => string} t Prekladač.
 * @param {number} [nowMs] „teraz" pre vek fixu a hodinu príletu.
 * @returns {?{title: string, titleFlag: string|null, details: string[], route: object|null, routeText: string, progress: object|null, footer: string[], military: boolean, hex: string|null}}
 */
export function hoverCardModel(summary, t, nowMs = Date.now()) {
  if (!summary) return null;
  const headline = summary.callsign || summary.registration || String(summary.id || '').toUpperCase();
  if (!headline) return null;
  const iata = String(summary.flightIata || '').trim().toUpperCase();
  const title = iata && iata !== String(headline).toUpperCase() ? `${headline} · ${iata}` : headline;

  const details = [];
  // 1. Let: hladina so stúpaním, rýchlosť, kurz — alebo „na zemi".
  const speed = Number.isFinite(summary.speedMps) ? `${Math.round(summary.speedMps * MPS_TO_KTS)} kts` : '';
  let flightLine;
  if (summary.onGround) {
    flightLine = [t('hover.on-ground'), speed, formatTrack(summary.trackDeg)].filter(Boolean).join(' · ');
  } else if (Number.isFinite(summary.altitudeM)) {
    flightLine = formatFlightLine({
      altitudeM: summary.altitudeM,
      verticalRateMps: summary.verticalRateMps,
      speedMps: summary.speedMps,
      trackDeg: summary.trackDeg,
    });
  } else {
    flightLine = [speed, formatTrack(summary.trackDeg)].filter(Boolean).join(' · ');
  }
  if (flightLine) details.push(flightLine);

  // 2. Stroj: dopravca · typ · registrácia (keď nie je titulkom), inak aspoň kategória.
  const machine = [
    summary.operator,
    summary.type,
    summary.registration && summary.registration !== headline ? summary.registration : null,
  ].filter(Boolean).join(' · ');
  details.push(machine || t(`aircraft.category.${summary.category}`));

  // 3. Trasa s vlajkami letísk (objekt), inak textový riadok, inak nič.
  const route = routeRowFromRoute(summary.routeInfo);
  const routeText = !route && summary.route ? String(summary.route) : '';

  // 4. Progres so zostatkom a hodinou príletu.
  const progress = progressRowFromProgress(summary.progress, nowMs);

  // 5. Poctivosť o dátach: zdroj, vek fixu, squawk, hex; odhad je priznaný.
  const footer = [];
  const meta = formatMetaLine({
    source: summary.source,
    lastContactEpochMs: summary.lastContactEpochMs,
    nowMs,
    squawk: summary.squawk,
    hex: summary.layerId === 'flights' || summary.layerId === 'military' ? summary.id : '',
  });
  if (meta) footer.push(meta);
  if (summary.stale) footer.push(t('hover.stale'));

  const hex = String(summary.id || '').trim().toLowerCase();
  return {
    title,
    titleFlag: resolveFlagIso2(summary.countryIso, summary.flag, summary.originCountry),
    details,
    route,
    routeText,
    progress,
    footer,
    military: summary.military === true,
    hex: summary.layerId === 'flights' && /^[0-9a-f]{6}$/.test(hex) ? hex : null,
  };
}

/**
 * Textový pohľad na model (riadky pod titulkom) — pre čitateľov, ktorí chcú
 * len text (testy, hlas). Pure.
 * @param {object|null} summary
 * @param {(key: string, vars?: object) => string} t
 * @param {number} [nowMs]
 * @returns {{title: string, lines: string[], military: boolean, flag: string|null}|null}
 */
export function hoverCardLines(summary, t, nowMs = Date.now()) {
  const model = hoverCardModel(summary, t, nowMs);
  if (!model) return null;
  const lines = [...model.details];
  if (model.route) lines.push(`${model.route.origin.label} → ${model.route.destination.label}`);
  else if (model.routeText) lines.push(model.routeText);
  if (model.progress) lines.push(model.progress.label);
  lines.push(...model.footer);
  return { title: model.title, lines, military: model.military, flag: model.titleFlag };
}

/** @type {HTMLElement|null} */
let _card = null;
/** @type {Function|null} */
let _resolveSummary = null;
/** Kľúč práve zobrazeného kontaktu (layerId:sourceId) — proti blikaniu a zdvojeným dopytom. */
let _currentKey = null;
/** Posledná poloha kurzora, aby sa kartička po dotiahnutí fotky prepolohovala. */
let _lastAt = null;
let _lastModel = null;
let _lastT = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let _photoTimer = null;
/** @type {Map<string, object|null>} hex → fotka (alebo null) už známa tejto kartičke */
const _photoByHex = new Map();
let _pointerOnPhoto = false;
/** @type {((candidate: {layerId: string, sourceId: string}) => void)|null} zotrvanie nad strojom (enrichment) */
let _onDwell = null;
let _lastCandidate = null;
let _lookupPhoto = lookupPlanespottersPhoto;
let _setTimeoutImpl = (fn, ms) => setTimeout(fn, ms);
let _clearTimeoutImpl = (id) => clearTimeout(id);

function makeFlag(doc, iso2) {
  const src = flagUrl(iso2);
  if (!src) return null;
  const flag = doc.createElement('img');
  flag.className = 'contact-hover-card-flag';
  flag.src = src;
  flag.alt = '';
  flag.width = 12;
  flag.height = 9;
  return flag;
}

function appendRouteSide(doc, parent, side) {
  const flag = makeFlag(doc, side?.iso2);
  if (flag) parent.appendChild(flag);
  const label = doc.createElement('span');
  label.textContent = side?.label || '';
  parent.appendChild(label);
}

function renderPhoto(doc, model, t) {
  if (!model.hex || !_photoByHex.has(model.hex)) return null;
  const photo = _photoByHex.get(model.hex);
  if (!photo) return null;
  const link = doc.createElement('a');
  link.className = 'contact-hover-card-photo';
  link.href = photo.link;
  link.target = '_blank';
  link.rel = 'noopener'; // ZÁMERNE bez nofollow — podmienka Planespotters
  link.title = t('photo.open');
  const img = doc.createElement('img');
  img.src = photo.src;
  img.alt = t('photo.alt');
  img.decoding = 'async';
  const credit = doc.createElement('span');
  credit.className = 'contact-hover-card-photo-credit';
  credit.textContent = photo.photographer ? t('photo.credit', { name: photo.photographer }) : t('photo.credit-anonymous');
  link.appendChild(img);
  link.appendChild(credit);
  link.addEventListener('mouseenter', () => { _pointerOnPhoto = true; });
  link.addEventListener('mouseleave', () => {
    _pointerOnPhoto = false;
    // Kurzor odišiel z fotky niekam mimo canvasu (panel, okraj) — canvas už
    // pohyb nedostane, tak kartičku zhasneme tu. Návrat nad canvas ju pri
    // ďalšom picku obnoví.
    hideCard();
  });
  return link;
}

function renderModel(model, at, t) {
  const doc = _card.ownerDocument;
  _card.textContent = '';
  const title = doc.createElement('div');
  title.className = 'contact-hover-card-title';
  const flag = makeFlag(doc, model.titleFlag);
  if (flag) title.appendChild(flag);
  title.appendChild(doc.createTextNode(model.title));
  _card.appendChild(title);
  for (const line of model.details) {
    const row = doc.createElement('div');
    row.className = 'contact-hover-card-line';
    row.textContent = line;
    _card.appendChild(row);
  }
  if (model.route) {
    const row = doc.createElement('div');
    row.className = 'contact-hover-card-route';
    appendRouteSide(doc, row, model.route.origin);
    const arrow = doc.createElement('span');
    arrow.className = 'contact-hover-card-route-arrow';
    arrow.textContent = '→';
    row.appendChild(arrow);
    appendRouteSide(doc, row, model.route.destination);
    _card.appendChild(row);
  } else if (model.routeText) {
    const row = doc.createElement('div');
    row.className = 'contact-hover-card-line';
    row.textContent = model.routeText;
    _card.appendChild(row);
  }
  if (model.progress) {
    const row = doc.createElement('div');
    row.className = 'contact-hover-card-progress';
    const bar = doc.createElement('div');
    bar.className = 'contact-hover-card-progress-bar';
    const fill = doc.createElement('div');
    fill.className = 'contact-hover-card-progress-fill';
    fill.style.width = `${Math.round(model.progress.fraction * 100)}%`;
    bar.appendChild(fill);
    const label = doc.createElement('span');
    label.textContent = model.progress.label;
    row.appendChild(bar);
    row.appendChild(label);
    _card.appendChild(row);
  }
  for (const line of model.footer) {
    const row = doc.createElement('div');
    row.className = 'contact-hover-card-footer';
    row.textContent = line;
    _card.appendChild(row);
  }
  const photo = renderPhoto(doc, model, t);
  if (photo) _card.appendChild(photo);
  _card.classList.toggle('is-military', model.military);
  _card.hidden = false;
  placeCard(at);
}

function placeCard(at) {
  if (!_card || !at) return;
  // Polohovanie až po naplnení — rozmery kartičky treba na preklopenie pri
  // okraji, inak by pri pravom/dolnom okraji vyliezla mimo obrazovky.
  const view = _card.ownerDocument.defaultView;
  const width = _card.offsetWidth;
  const height = _card.offsetHeight;
  const maxX = (view?.innerWidth || 0) - width - 8;
  const maxY = (view?.innerHeight || 0) - height - 8;
  const x = Math.max(8, Math.min(at.x + CARD_OFFSET_PX, maxX));
  const y = Math.max(8, Math.min(at.y + CARD_OFFSET_PX, maxY));
  _card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function cancelPhotoTimer() {
  if (_photoTimer !== null) { _clearTimeoutImpl(_photoTimer); _photoTimer = null; }
}

/**
 * Zotrvanie nad strojom: po debounce vypýtaj detaily (typ, trasa) a fotku.
 * Prelet myšou cez flotilu tak nespustí nič — len stroj, nad ktorým kurzor
 * naozaj zostal.
 */
function scheduleDwell(model, t) {
  cancelPhotoTimer();
  const hex = model.hex;
  const key = _currentKey;
  const candidate = _lastCandidate;
  const needPhoto = Boolean(hex) && !_photoByHex.has(hex);
  if (!needPhoto && !_onDwell) return;
  _photoTimer = _setTimeoutImpl(() => {
    _photoTimer = null;
    if (_currentKey !== key) return; // myš medzitým odišla inam
    if (candidate) { try { _onDwell?.(candidate); } catch { /* enrichment nikdy nezhodí kartičku */ } }
    if (!needPhoto) return;
    Promise.resolve(_lookupPhoto(hex)).then((photo) => {
      _photoByHex.set(hex, photo || null);
      // Stále nad tým istým strojom → dokresliť fotku bez blikania textu.
      if (_card && !_card.hidden && _currentKey === key && _lastModel && _lastT) renderModel(_lastModel, _lastAt, _lastT);
    }).catch(() => { _photoByHex.set(hex, null); });
  }, HOVER_PHOTO_DEBOUNCE_MS);
}

function hideCard() {
  cancelPhotoTimer();
  _currentKey = null;
  _lastModel = null;
  _pointerOnPhoto = false;
  if (_card && !_card.hidden) _card.hidden = true;
}

/**
 * Nainštaluje kartičku. Idempotentné.
 * @param {object} options
 * @param {HTMLElement} options.container Rodič kartičky (typicky document.body).
 * @param {(candidates: Array<{layerId: string, sourceId: string}>) => object|null} options.resolveSummary
 *   Vráti zhrnutie prvého kandidáta, ktorý naozaj patrí niektorej vrstve.
 * @param {(candidate: {layerId: string, sourceId: string}) => void} [options.onDwell]
 *   Zavolá sa raz po zotrvaní kurzora nad kontaktom (debounce) — vrstva si
 *   vypýta enrichment (typ, trasa), aby kartička mala čo ukázať.
 * @param {Function} [options.lookupPhoto] test seam (default Planespotters cez trackedPhoto.js)
 * @param {Function} [options.setTimeoutImpl] test seam
 * @param {Function} [options.clearTimeoutImpl] test seam
 * @returns {void}
 */
export function installContactHoverCard({ container, resolveSummary, onDwell, lookupPhoto, setTimeoutImpl, clearTimeoutImpl }) {
  if (_card || !container) return;
  _resolveSummary = resolveSummary;
  _onDwell = typeof onDwell === 'function' ? onDwell : null;
  if (typeof lookupPhoto === 'function') _lookupPhoto = lookupPhoto;
  if (typeof setTimeoutImpl === 'function') _setTimeoutImpl = setTimeoutImpl;
  if (typeof clearTimeoutImpl === 'function') _clearTimeoutImpl = clearTimeoutImpl;
  _card = container.ownerDocument.createElement('div');
  _card.className = 'contact-hover-card';
  _card.hidden = true;
  _card.setAttribute('aria-hidden', 'true');
  container.appendChild(_card);
}

/**
 * Prekreslí kartičku pre aktuálny hover.
 * @param {Array<{layerId: string, sourceId: string}>} candidates Kandidáti z picku.
 * @param {{x: number, y: number}|null} at Pozícia kurzora v canvase.
 * @param {(key: string, vars?: object) => string} t Prekladač.
 * @returns {void}
 */
export function updateContactHoverCard(candidates, at, t) {
  if (!_card) return;
  const summary = candidates?.length ? _resolveSummary?.(candidates) : null;
  const model = hoverCardModel(summary, t);
  if (!model || !at) {
    // Kurzor je na odkaze s fotkou (canvas hlási odchod) — kartička ostáva,
    // nech sa dá fotka kliknúť. Odchod z odkazu ju zhasne sám.
    if (_pointerOnPhoto && _card && !_card.hidden) return;
    hideCard();
    return;
  }
  const key = `${summary.layerId || ''}:${summary.id || ''}`;
  const keyChanged = key !== _currentKey;
  _currentKey = key;
  _lastAt = at;
  _lastModel = model;
  _lastT = t;
  _lastCandidate = { layerId: summary.layerId, sourceId: String(summary.id || '') };
  renderModel(model, at, t);
  if (keyChanged) scheduleDwell(model, t);
}

/** Odstráni kartičku (teardown viewera). */
export function destroyContactHoverCard() {
  cancelPhotoTimer();
  _card?.remove();
  _card = null;
  _resolveSummary = null;
  _onDwell = null;
  _lastCandidate = null;
  _currentKey = null;
  _lastModel = null;
  _lastAt = null;
  _lastT = null;
  _pointerOnPhoto = false;
}

/** Test seam: vyprázdni cache fotiek a vráti predvolené seams. */
export function _resetContactHoverCardForTest() {
  destroyContactHoverCard();
  _photoByHex.clear();
  _lookupPhoto = lookupPlanespottersPhoto;
  _setTimeoutImpl = (fn, ms) => setTimeout(fn, ms);
  _clearTimeoutImpl = (id) => clearTimeout(id);
}
