// src/data/trackedCardModel.js
/**
 * @module trackedCardModel
 * @description Čistý skladač prezentačného modelu karty sledovaného letu.
 * Požiadavky 2026-09-05: „daj tam aj zástavy/vlajky … a trocha viac UI
 * prívetivé", potom „daj tam viac informácií o lete":
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [FR] AFR702 · AF702                          │  volací znak + IATA číslo (+ STALE)
 *   │ FL340↑ 980 ft/min · 499 kts · 214°           │  hladina, stúpanie, rýchlosť, kurz
 *   │ Air France · Boeing 777 328ER · F-GZNP       │  identita
 *   │ [FR] CDG Paris → [CI] ABJ Abidjan            │  trasa s vlajkami letísk
 *   │ ▬▬▬▬▬▬▬▬ 33 % · zostáva 3 245 km · ETA 3:35 (21:40) │ kreslený progres
 *   │ OpenSky Network · fix pred 6 s · SQ 1000 · 3C6444 │ zdroj, vek fixu, squawk, hex
 *   │ SQUAWK 7700 · EMERGENCY                      │  (len keď je čo hlásiť)
 *   └──────────────────────────────────────────────┘
 *
 * `details` ostávajú POLE REŤAZCOV (hlas, kontext aj ostatní čitatelia ich
 * čítajú ďalej). Vlajky, trasa a progres sú SAMOSTATNÉ polia (`titleFlag`,
 * `route`, `progress`), `footer` sú riadky pod progresom (zdroj a poplach).
 * Hostiteľ bez podpory ich ignoruje a karta degraduje na text.
 *
 * Bez DOM, bez Cesia — testovateľné čistými vstupmi; čas sa vždy podáva.
 */
import { resolveFlagIso2 } from './countryFlags.js';
import { formatEta, routeSideLabel, verticalTrendGlyph } from './flightProgress.js';
import { t } from '../i18n.js';

/** Farba sledovaného letu (zhodná s doterajším volaním trackedLabelModelFromText). */
export const TRACKED_FLIGHT_ACCENT = '#39d0ff';
/** Nad touto výškou sa hlási letová hladina (FLxxx), pod ňou stopy. */
export const FLIGHT_LEVEL_MIN_FT = 18_000;
const M_TO_FT = 3.28084;
const MPS_TO_KTS = 1.94384;
const MPS_TO_FPM = 196.850394;
/** Tenká nezalomiteľná medzera ako oddeľovač tisícov (4 843 km). */
const THIN_NBSP = '\u202f';

/** Celé číslo s oddelenými tisíckami. Pure. */
export function formatThousands(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return '';
  return String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP).replace(/^/, n < 0 ? '−' : '');
}

/** Kurz ako trojmiestne stupne (aviatická konvencia): 95 → '095°'. '' pre neznámy. Pure. */
export function formatTrack(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return '';
  const norm = ((Math.round(n) % 360) + 360) % 360;
  return `${String(norm).padStart(3, '0')}°`;
}

/**
 * Vertikálna rýchlosť v ft/min so šípkou, zaokrúhlená na 10; '' v hladine
 * (rovnaký prah ako trendový glyf, ±2,5 m/s). Pure.
 */
export function formatVerticalRate(verticalRateMps) {
  const glyph = verticalTrendGlyph(verticalRateMps);
  if (!glyph) return '';
  const fpm = Math.round(Math.abs(Number(verticalRateMps)) * MPS_TO_FPM / 10) * 10;
  return `${glyph}${formatThousands(fpm)} ft/min`;
}

/**
 * Letový riadok: hladina + trend a stúpanie, rýchlosť, kurz.
 * `FL340↑ 980 ft/min · 499 kts · 214°`; na zemi `0 ft · 12 kts · 095°`. Pure.
 * @param {{altitudeM?: number, onGround?: boolean, verticalRateMps?: number, speedMps?: number, trackDeg?: number}} p
 */
export function formatFlightLine({ altitudeM, onGround = false, verticalRateMps, speedMps, trackDeg } = {}) {
  const altFt = Math.round((Number(altitudeM) || 0) * M_TO_FT);
  const trend = onGround ? '' : verticalTrendGlyph(verticalRateMps);
  const level = altFt >= FLIGHT_LEVEL_MIN_FT ? `FL${Math.round(altFt / 100)}` : `${formatThousands(altFt)} ft`;
  const rate = onGround ? '' : formatVerticalRate(verticalRateMps);
  const levelPart = rate ? `${level}${trend} ${rate.slice(1)}` : `${level}${trend}`;
  const speed = Number(speedMps) ? `${Math.round(Number(speedMps) * MPS_TO_KTS)} kts` : '';
  return [levelPart, speed, formatTrack(trackDeg)].filter(Boolean).join(' · ');
}

/** Vek posledného fixu: '6 s', '2 min', '1 h'; '' pre neznámy alebo budúci čas. Pure. */
export function formatFixAge(lastContactEpochMs, nowMs) {
  const age = (Number(nowMs) - Number(lastContactEpochMs)) / 1000;
  if (!Number.isFinite(age) || age < 0) return '';
  if (age < 60) return `${Math.round(age)} s`;
  if (age < 3600) return `${Math.round(age / 60)} min`;
  return `${Math.round(age / 3600)} h`;
}

/** Miestny čas príletu HH:MM z ETA v minútach a „teraz". '' bez ETA. Pure nad vstupmi. */
export function formatEtaClock(etaMinutes, nowMs) {
  if (typeof etaMinutes !== 'number' || !Number.isFinite(etaMinutes) || etaMinutes < 0 || !Number.isFinite(nowMs)) return '';
  const d = new Date(nowMs + Math.round(etaMinutes) * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Riadok trasy s vlajkami letísk. Pure.
 * @param {?{origin: object, destination: object}} route adsbdb trasa (kód, mesto, `country` ISO2)
 * @returns {?{origin: {label: string, iso2: string|null}, destination: {label: string, iso2: string|null}}}
 */
export function routeRowFromRoute(route) {
  if (!route?.origin && !route?.destination) return null;
  const side = (airport) => ({
    label: routeSideLabel(airport),
    iso2: resolveFlagIso2(airport?.country, airport?.countryIso, airport?.countryName),
  });
  const origin = side(route?.origin);
  const destination = side(route?.destination);
  if (!origin.label && !destination.label) return null;
  return { origin, destination };
}

/**
 * Riadok progresu: podiel 0–1 a popis „33 % · zostáva 3 245 km · ETA 3:35 (21:40)".
 * Zostatok a hodina sa pridajú len keď sú známe. Pure.
 * @param {?{fractionDone: number, remainingKm?: number, etaMinutes: number|null}} progress výstup routeProgress()
 * @param {number} [nowMs] pre miestny čas príletu
 * @returns {?{fraction: number, label: string}}
 */
export function progressRowFromProgress(progress, nowMs = NaN) {
  const fraction = Number(progress?.fractionDone);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  const parts = [`${Math.round(fraction * 100)} %`];
  const remaining = Number(progress?.remainingKm);
  if (Number.isFinite(remaining) && remaining >= 0) parts.push(t('card.km-left', { km: formatThousands(remaining) }));
  const eta = formatEta(progress?.etaMinutes);
  if (eta) {
    const clock = formatEtaClock(progress.etaMinutes, nowMs);
    parts.push(clock ? `ETA ${eta} (${clock})` : `ETA ${eta}`);
  }
  return { fraction, label: parts.join(' · ') };
}

/**
 * Riadok o dátach: zdroj, vek fixu, squawk, ICAO hex. Poctivosť o pôvode
 * (pravidlo 2) na jednom riadku. Pure.
 * @param {{source?: string, lastContactEpochMs?: number, nowMs?: number, squawk?: string|number, hex?: string}} p
 */
export function formatMetaLine({ source, lastContactEpochMs, nowMs, squawk, hex } = {}) {
  const age = formatFixAge(lastContactEpochMs, nowMs);
  const sq = String(squawk ?? '').trim();
  return [
    String(source || '').trim(),
    age ? t('card.fix', { age }) : '',
    sq ? `SQ ${sq}` : '',
    String(hex || '').trim().toUpperCase(),
  ].filter(Boolean).join(' · ');
}

/**
 * Zloží model karty sledovaného letu.
 * @param {object} parts
 * @param {string} parts.callsign titulok (volací znak / registrácia / hex)
 * @param {string} [parts.flightIata] IATA číslo letu z trasy (AF702) — do titulku, keď sa líši
 * @param {string} [parts.flightLine] hotový letový riadok (viď formatFlightLine)
 * @param {boolean} [parts.stale] kontakt beží na odhade → STALE v titulku
 * @param {string} [parts.identLine] „Air France · Boeing 777 328ER · F-GZNP"
 * @param {?{origin: object, destination: object}} [parts.route] plauzibilná trasa (inak null)
 * @param {?{fractionDone: number, remainingKm?: number, etaMinutes: number|null}} [parts.progress]
 * @param {string} [parts.alertLine] „SQUAWK 7700 · EMERGENCY"
 * @param {string} [parts.metaLine] hotový riadok o dátach (viď formatMetaLine); '' = bez riadku
 * @param {number} [parts.nowMs] „teraz" pre hodinu príletu
 * @param {string} [parts.countryIso] ISO2 štátu registrácie (adsbdb)
 * @param {string} [parts.originCountry] meno štátu z OpenSky (fallback)
 * @param {string} [parts.accent]
 * @returns {{title: string, details: string[], footer: string[], accent: string, titleFlag: string|null, route: object|null, progress: object|null}}
 */
export function buildTrackedCardModel({
  callsign,
  flightIata = '',
  flightLine = '',
  stale = false,
  identLine = '',
  route = null,
  progress = null,
  alertLine = '',
  metaLine = '',
  nowMs = NaN,
  countryIso = null,
  originCountry = null,
  accent = TRACKED_FLIGHT_ACCENT,
} = {}) {
  const cs = String(callsign || '').trim();
  const iata = String(flightIata || '').trim().toUpperCase();
  const title = [cs, iata && iata !== cs.toUpperCase() ? iata : '', stale ? 'STALE' : ''].filter(Boolean).join(' · ');
  const details = [flightLine, identLine].map((s) => String(s || '').trim()).filter(Boolean);
  const footer = [metaLine, alertLine].map((s) => String(s || '').trim()).filter(Boolean);
  return {
    title,
    details,
    footer,
    accent,
    titleFlag: resolveFlagIso2(countryIso, originCountry),
    route: routeRowFromRoute(route),
    progress: progressRowFromProgress(progress, nowMs),
  };
}
