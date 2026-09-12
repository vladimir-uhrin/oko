// src/data/trackedCardModel.js
/**
 * @module trackedCardModel
 * @description Čistý skladač prezentačného modelu karty sledovaného letu.
 * Požiadavky 2026-09-05: „daj tam aj zástavy/vlajky … a trocha viac UI
 * prívetivé", potom „daj tam viac informácií o lete":
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [FR] AFR702 · AF702                          │  volací znak + IATA číslo (+ STALE)
 *   │ Letová hladina FL340 (≈ 10 360 m)            │  zrozumiteľne (2026-09-12)
 *   │ stúpa 980 ft/min (5,0 m/s)                   │  len pri stúpaní/klesaní
 *   │ Rýchlosť 499 kts (924 km/h) · kurz 214° (JZ)  │  obe jednotky, svetová strana
 *   │ Air France · Boeing 777 328ER · F-GZNP       │  identita
 *   │ [FR] CDG Paris (Francúzsko) → [CI] ABJ Abidjan (Pobrežie Slonoviny) │ trasa, vlajky, štáty
 *   │ ▬▬▬▬▬▬▬▬ 33 % trasy · zostáva 3 245 km · pristátie za 3 h 35 min (21:40) │ kreslený progres
 *   │ ╱╲╱‾‾‾  výška FL120 → FL340 (3 660 → 10 360 m) │  mini profil (výška + rýchlosť, 30 min)
 *   │ ╱       rýchlosť 250 → 480 kts (463 → 889 km/h) · posledných 28 min │
 *   │ OpenSky Network · poloha pred 6 s · squawk 1000 · ICAO 3C6444 │ zdroj, vek polohy, squawk, hex
 *   │ ▲ SQUAWK 7700 · EMERGENCY                    │  (len keď je čo hlásiť; červený rám)
 *   └──────────────────────────────────────────────┘
 *
 * `details` ostávajú POLE REŤAZCOV (hlas, kontext aj ostatní čitatelia ich
 * čítajú ďalej). Vlajky, trasa, progres a profil sú SAMOSTATNÉ polia
 * (`titleFlag`, `route`, `progress`, `profile`), `footer` sú riadky pod nimi
 * (zdroj) a `alert` je núdzový squawk — od 2026-09-07 vlastné pole, aby ho
 * maliar vedel zvýrazniť (červený rám a glyf), nie len posledný footer riadok.
 * Hostiteľ bez podpory ich ignoruje a karta degraduje na text.
 *
 * Bez DOM, bez Cesia — testovateľné čistými vstupmi; čas sa vždy podáva.
 */
import { resolveFlagIso2 } from './countryFlags.js';
import { formatEta, routeSideLabel, verticalTrendGlyph } from './flightProgress.js';
import { currentLanguage, t } from '../i18n.js';
import {
  FLIGHT_LEVEL_MIN_FT,
  formatAltitudeDual,
  formatSpeedDual,
  formatThousands,
  formatVerticalRateDual,
} from '../units.js';

// Jednotky (2026-09-07): konverzie a oddeľovač tisícov žijú v units.js —
// letecký/metrický prepínač platí pre každé zobrazenie výšky a rýchlosti.
// Pôvodné exporty ostávajú pre existujúcich importérov.
export { FLIGHT_LEVEL_MIN_FT, formatThousands };

/** Farba sledovaného letu (zhodná s doterajším volaním trackedLabelModelFromText). */
export const TRACKED_FLIGHT_ACCENT = '#39d0ff';

/** Kurz ako trojmiestne stupne (aviatická konvencia): 95 → '095°'. '' pre neznámy. Pure. */
export function formatTrack(deg) {
  // null/undefined/'' nie je kurz 0°: Number(null) === 0 kreslilo „000°" pri
  // lodiach bez kurzu (satelitné AIS z GFW, 2026-09-12).
  if (deg === null || deg === undefined || deg === '') return '';
  const n = Number(deg);
  if (!Number.isFinite(n)) return '';
  const norm = ((Math.round(n) % 360) + 360) % 360;
  return `${String(norm).padStart(3, '0')}°`;
}

/** Svetová strana z kurzu (8 smerov, jazyk UI): 327 → 'SZ' / 'NW'; '' pre neznámy. Pure. */
export function compassLabel(deg, translate = t) {
  if (deg === null || deg === undefined || deg === '') return '';
  const n = Number(deg);
  if (!Number.isFinite(n)) return '';
  const points = String(translate('compass.points') || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (points.length !== 8) return '';
  const norm = ((n % 360) + 360) % 360;
  return points[Math.round(norm / 45) % 8];
}

/** Kurz aj so svetovou stranou: `327° (SZ)`; '' pre neznámy. Pure. */
export function formatTrackPlain(deg, translate = t) {
  const track = formatTrack(deg);
  if (!track) return '';
  const compass = compassLabel(deg, translate);
  return compass ? `${track} (${compass})` : track;
}

/**
 * Vertikálna rýchlosť so šípkou v oboch jednotkách: `↑980 ft/min (5,0 m/s)`;
 * '' v hladine (rovnaký prah ako trendový glyf, ±2,5 m/s). Pure.
 */
export function formatVerticalRate(verticalRateMps) {
  const glyph = verticalTrendGlyph(verticalRateMps);
  if (!glyph) return '';
  return `${glyph}${formatVerticalRateDual(verticalRateMps)}`;
}

/**
 * Kompaktný letový riadok (karta pod kurzorom, hlas): hladina s trendom a
 * stúpaním, rýchlosť, kurz — vždy v oboch jednotkách a so svetovou stranou.
 * `FL340 (≈ 10 360 m) ↑980 ft/min (5,0 m/s) · 499 kts (924 km/h) · 214° (JZ)`;
 * na zemi `na zemi · 12 kts (22 km/h) · 095° (V)`. Pure.
 * @param {{altitudeM?: number, onGround?: boolean, verticalRateMps?: number, speedMps?: number, trackDeg?: number}} p
 */
export function formatFlightLine({ altitudeM, onGround = false, verticalRateMps, speedMps, trackDeg } = {}, translate = t) {
  const rate = onGround ? '' : formatVerticalRate(verticalRateMps);
  const level = onGround ? translate('hover.on-ground') : formatAltitudeDual(Number(altitudeM) || 0);
  const levelPart = rate ? `${level} ${rate}` : level;
  const speed = Number(speedMps) ? formatSpeedDual(speedMps) : '';
  return [levelPart, speed, formatTrackPlain(trackDeg, translate)].filter(Boolean).join(' · ');
}

/**
 * Zrozumiteľné riadky pre sledovanú kartu (2026-09-12, „aby to pochopil aj
 * debil"): `Letová hladina FL360 (≈ 10 973 m)`, pri stúpaní/klesaní vlastný
 * riadok `stúpa 980 ft/min (5,0 m/s)` (spolu by mal 64 znakov a karta ho
 * orezala) a `Rýchlosť 401 kts (743 km/h) · kurz 327° (SZ)`. Na zemi `Na zemi`. Pure.
 * @returns {string[]} 1–3 riadky (prázdne časti vypadnú)
 */
export function formatFlightLinesPlain({ altitudeM, onGround = false, verticalRateMps, speedMps, trackDeg } = {}, translate = t) {
  let altitudeLine;
  let verticalLine = '';
  if (onGround) {
    altitudeLine = translate('card.on-ground');
  } else {
    const dual = formatAltitudeDual(Number(altitudeM) || 0);
    const fl = /^(FL\d+) \((.+)\)$/.exec(dual);
    altitudeLine = fl ? translate('card.flight-level', { fl: fl[1], m: fl[2] }) : translate('card.altitude', { alt: dual });
    const glyph = verticalTrendGlyph(verticalRateMps);
    if (glyph) verticalLine = translate(glyph === '↑' ? 'card.climbing' : 'card.descending', { rate: formatVerticalRateDual(verticalRateMps) });
  }
  const speed = Number(speedMps) ? translate('card.speed', { speed: formatSpeedDual(speedMps) }) : '';
  const track = formatTrack(trackDeg);
  const heading = track ? translate('card.heading', { deg: track, compass: compassLabel(trackDeg, translate) || '—' }) : '';
  const speedLine = [speed, heading].filter(Boolean).join(' · ');
  return [altitudeLine, verticalLine, speedLine].filter(Boolean);
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

const REGION_NAME_CACHE = new Map();

/** Meno štátu z ISO2 v jazyku UI (Intl.DisplayNames): 'TR' → 'Turecko' / 'Türkiye'; '' bez prekladu. Pure nad vstupmi. */
export function regionDisplayName(iso2, lang = currentLanguage()) {
  const code = String(iso2 || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  const key = `${lang}|${code}`;
  if (REGION_NAME_CACHE.has(key)) return REGION_NAME_CACHE.get(key);
  let name = '';
  try {
    const names = new Intl.DisplayNames([lang, 'en'], { type: 'region', fallback: 'none' });
    name = String(names.of(code) || '');
  } catch { name = ''; }
  if (name.toUpperCase() === code) name = '';
  REGION_NAME_CACHE.set(key, name);
  return name;
}

/**
 * Riadok trasy s vlajkami letísk a menom štátu (2026-09-12: „KONYA bude aj
 * Turecko"): `KYA Konya (Turecko)`. Pure nad vstupmi.
 * @param {?{origin: object, destination: object}} route adsbdb trasa (kód, mesto, `country` ISO2)
 * @returns {?{origin: {label: string, iso2: string|null}, destination: {label: string, iso2: string|null}}}
 */
export function routeRowFromRoute(route, lang = currentLanguage()) {
  if (!route?.origin && !route?.destination) return null;
  const side = (airport) => {
    const iso2 = resolveFlagIso2(airport?.country, airport?.countryIso, airport?.countryName);
    // „Zemunik (Zadar)" + štát by dalo „Zemunik (Zada… (Chorvátsko)" — zátvorka
    // z mena letiska ustúpi štátu, ten je pre laika dôležitejší.
    const country = regionDisplayName(iso2, lang);
    const name = String(airport?.name || '');
    const base = routeSideLabel(country ? { ...airport, name: name.replace(/\s*\(.*$/, '') || name } : airport);
    return { label: base && country ? `${base} (${country})` : base, iso2 };
  };
  const origin = side(route?.origin);
  const destination = side(route?.destination);
  if (!origin.label && !destination.label) return null;
  return { origin, destination };
}

/** ETA po ľudsky: 52 → '52 min', 215 → '3 h 35 min'; '' bez platnej hodnoty. Pure. */
export function formatEtaPlain(etaMinutes) {
  if (typeof etaMinutes !== 'number' || !Number.isFinite(etaMinutes) || etaMinutes < 0) return '';
  const total = Math.round(etaMinutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Riadok progresu: podiel 0–1 a popis „33 % trasy · zostáva 3 245 km ·
 * pristátie za 3 h 35 min (21:40)". Zostatok a hodina len keď sú známe. Pure.
 * @param {?{fractionDone: number, remainingKm?: number, etaMinutes: number|null}} progress výstup routeProgress()
 * @param {number} [nowMs] pre miestny čas príletu
 * @returns {?{fraction: number, label: string}}
 */
export function progressRowFromProgress(progress, nowMs = NaN) {
  const fraction = Number(progress?.fractionDone);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  const parts = [t('card.progress-done', { pct: Math.round(fraction * 100) })];
  const remaining = Number(progress?.remainingKm);
  if (Number.isFinite(remaining) && remaining >= 0) parts.push(t('card.km-left', { km: formatThousands(remaining) }));
  const eta = formatEtaPlain(progress?.etaMinutes);
  if (eta) {
    const clock = formatEtaClock(progress.etaMinutes, nowMs);
    parts.push(clock ? t('card.landing', { eta, clock }) : t('card.landing-noclock', { eta }));
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
  const hexUp = String(hex || '').trim().toUpperCase();
  return [
    String(source || '').trim(),
    age ? t('card.fix', { age }) : '',
    sq ? t('card.squawk', { sq }) : '',
    hexUp ? t('card.hex', { hex: hexUp }) : '',
  ].filter(Boolean).join(' · ');
}

/**
 * Zloží model karty sledovaného letu.
 * @param {object} parts
 * @param {string} parts.callsign titulok (volací znak / registrácia / hex)
 * @param {string} [parts.flightIata] IATA číslo letu z trasy (AF702) — do titulku, keď sa líši
 * @param {string} [parts.flightLine] hotový kompaktný letový riadok (viď formatFlightLine) — použije sa, keď chýbajú `flightLines`
 * @param {string[]} [parts.flightLines] zrozumiteľné riadky (viď formatFlightLinesPlain) — na karte majú prednosť
 * @param {boolean} [parts.stale] kontakt beží na odhade → STALE v titulku
 * @param {string} [parts.identLine] „Air France · Boeing 777 328ER · F-GZNP"
 * @param {?{origin: object, destination: object}} [parts.route] plauzibilná trasa (inak null)
 * @param {?{fractionDone: number, remainingKm?: number, etaMinutes: number|null}} [parts.progress]
 * @param {string} [parts.alertLine] „SQUAWK 7700 · EMERGENCY" → `alert` (červený rám)
 * @param {string} [parts.acarsLine] „ACARS 7 · 03:40 CPDLC ↑ · …" (acarsMessages.js) → prvý riadok päty; '' = bez riadku
 * @param {?object} [parts.profile] riadok mini profilu (flightProfile.js) alebo null — záloha, keď nie sú grafy
 * @param {?object} [parts.charts] grafy celého letu (flightCharts.js) alebo null
 * @param {string} [parts.metaLine] hotový riadok o dátach (viď formatMetaLine); '' = bez riadku
 * @param {number} [parts.nowMs] „teraz" pre hodinu príletu
 * @param {string} [parts.countryIso] ISO2 štátu registrácie (adsbdb)
 * @param {string} [parts.originCountry] meno štátu z OpenSky (fallback)
 * @param {string} [parts.accent]
 * @returns {{title: string, details: string[], footer: string[], accent: string, titleFlag: string|null, route: object|null, progress: object|null, profile: object|null, charts: object|null, alert: string|null}}
 */
export function buildTrackedCardModel({
  callsign,
  flightIata = '',
  flightLine = '',
  flightLines = null,
  stale = false,
  identLine = '',
  route = null,
  progress = null,
  profile = null,
  charts = null,
  alertLine = '',
  acarsLine = '',
  metaLine = '',
  nowMs = NaN,
  countryIso = null,
  originCountry = null,
  accent = TRACKED_FLIGHT_ACCENT,
} = {}) {
  const cs = String(callsign || '').trim();
  const iata = String(flightIata || '').trim().toUpperCase();
  const title = [cs, iata && iata !== cs.toUpperCase() ? iata : '', stale ? 'STALE' : ''].filter(Boolean).join(' · ');
  const flightPart = Array.isArray(flightLines) && flightLines.length ? flightLines : [flightLine];
  const details = [...flightPart, identLine].map((s) => String(s || '').trim()).filter(Boolean);
  // ACARS riadok (2026-09-08, airframes.io, len lokálne) ide do päty PRED
  // riadok o dátach — je to tiež „čo o stroji vieme z iného kanála".
  const footer = [acarsLine, metaLine].map((s) => String(s || '').trim()).filter(Boolean);
  const alert = String(alertLine || '').trim() || null;
  return {
    title,
    details,
    footer,
    accent,
    titleFlag: resolveFlagIso2(countryIso, originCountry),
    route: routeRowFromRoute(route),
    progress: progressRowFromProgress(progress, nowMs),
    profile: profile && typeof profile === 'object' ? profile : null,
    charts: charts && typeof charts === 'object' ? charts : null,
    alert,
  };
}
