// src/data/contactHoverCard.js
/**
 * @module contactHoverCard
 * @description Kartička pod kurzorom pre kontakt, nad ktorým sa práve nachádza
 * myš (požiadavka 2026-09-03: „keď som ďaleko zazoomovaný, mohli by sa po
 * prejdení myšou objaviť základné informácie o lete a lietadle").
 *
 * PREČO SAMOSTATNE OD DETEKCIE: hover-inspect v detectionHover.js rozsvieti
 * detekčnú zostavu, tá je ale za prepínačom DETEKCIA a nesie len volací znak
 * a letovú hladinu. Kartička má fungovať aj s vypnutou detekciou a povedať
 * viac — je to iná otázka („čo je to za stroj?"), nie iný stav tej istej.
 *
 * Skladanie riadkov je ČISTÁ funkcia (`hoverCardLines`) oddelená od DOM, takže
 * sa dá testovať bez prehliadača; `installContactHoverCard` je len tenký obal
 * nad ňou, ktorý drží jeden element a polohuje ho pri kurzore.
 */
import { formatFlightLevel } from './detectionDraw.js';

/** Odsadenie kartičky od kurzora (px) — nesmie sedieť pod hrotom myši. */
const CARD_OFFSET_PX = 14;
/** Prah vertikálnej rýchlosti pre šípku (m/s) — zhodný s flightProgress.js. */
const TREND_THRESHOLD_MPS = 2.5;

/**
 * Riadky kartičky pre jedno zhrnutie kontaktu.
 *
 * Vynecháva všetko, čo nie je známe — pri oddialenom pohľade chýba typ aj
 * trasa (enrichment beží prednostne pre stroje na obrazovke), a prázdny
 * riadok „—" by len zaberal miesto a tváril sa ako chýbajúca hodnota, hoci
 * ide o hodnotu, ktorá ešte len príde.
 * @param {object|null} summary Výstup `getContactSummary()`.
 * @param {(key: string, vars?: object) => string} t Prekladač.
 * @returns {{title: string, lines: string[], military: boolean}|null}
 */
export function hoverCardLines(summary, t) {
  if (!summary) return null;
  const title = summary.callsign || summary.registration || String(summary.id || '').toUpperCase();
  if (!title) return null;

  const lines = [];

  // 1. Stroj: typ + registrácia, inak aspoň kategória (tú vieme vždy).
  const machine = [
    summary.type,
    summary.registration && summary.registration !== title ? summary.registration : null,
  ].filter(Boolean).join(' · ');
  lines.push(machine || t(`aircraft.category.${summary.category}`));

  // 2. Dopravca a trasa — len keď ich enrichment už doniesol.
  if (summary.operator) lines.push(summary.operator);
  if (summary.route) lines.push(summary.route);

  // 3. Let: hladina so šípkou stúpania/klesania + rýchlosť.
  const flight = [];
  if (summary.onGround) {
    flight.push(t('hover.on-ground'));
  } else {
    // Letová hladina, nie stopy: presne to, čo hovorí menovka pri zameriavači
    // aj karta sledovaného letu. Kartička nesmie mať vlastnú jednotku — a FL
    // sa vyhne tomu, že by sa oddeľovač tisícov líšil podľa jazyka.
    const level = formatFlightLevel(summary.altitudeM);
    if (level) {
      const rate = summary.verticalRateMps;
      const trend = !Number.isFinite(rate) || Math.abs(rate) < TREND_THRESHOLD_MPS
        ? ''
        : (rate > 0 ? '↑' : '↓');
      flight.push(level + trend);
    }
  }
  if (Number.isFinite(summary.speedMps)) {
    flight.push(`${Math.round(summary.speedMps * 1.94384)} kts`);
  }
  if (flight.length) lines.push(flight.join(' · '));

  // 4. Poctivosť o dátach: kontakt, ktorý vypadol z pollu, beží na odhade.
  if (summary.stale) lines.push(t('hover.stale'));

  return { title, lines, military: summary.military === true };
}

/** @type {HTMLElement|null} */
let _card = null;
/** @type {Function|null} */
let _resolveSummary = null;

/**
 * Nainštaluje kartičku. Idempotentné.
 * @param {object} options
 * @param {HTMLElement} options.container Rodič kartičky (typicky document.body).
 * @param {(candidates: Array<{layerId: string, sourceId: string}>) => object|null} options.resolveSummary
 *   Vráti zhrnutie prvého kandidáta, ktorý naozaj patrí niektorej vrstve.
 * @returns {void}
 */
export function installContactHoverCard({ container, resolveSummary }) {
  if (_card || !container) return;
  _resolveSummary = resolveSummary;
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
  const model = hoverCardLines(summary, t);
  if (!model || !at) {
    if (!_card.hidden) _card.hidden = true;
    return;
  }
  const doc = _card.ownerDocument;
  _card.textContent = '';
  const title = doc.createElement('div');
  title.className = 'contact-hover-card-title';
  title.textContent = model.title;
  _card.appendChild(title);
  for (const line of model.lines) {
    const row = doc.createElement('div');
    row.className = 'contact-hover-card-line';
    row.textContent = line;
    _card.appendChild(row);
  }
  _card.classList.toggle('is-military', model.military);
  _card.hidden = false;
  // Polohovanie až po naplnení — rozmery kartičky treba na preklopenie pri
  // okraji, inak by pri pravom/dolnom okraji vyliezla mimo obrazovky.
  const view = doc.defaultView;
  const width = _card.offsetWidth;
  const height = _card.offsetHeight;
  const maxX = (view?.innerWidth || 0) - width - 8;
  const maxY = (view?.innerHeight || 0) - height - 8;
  const x = Math.max(8, Math.min(at.x + CARD_OFFSET_PX, maxX));
  const y = Math.max(8, Math.min(at.y + CARD_OFFSET_PX, maxY));
  _card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/** Odstráni kartičku (teardown viewera). */
export function destroyContactHoverCard() {
  _card?.remove();
  _card = null;
  _resolveSummary = null;
}
