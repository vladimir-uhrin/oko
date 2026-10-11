// src/data/vesselTrackedCard.js
/**
 * @module vesselTrackedCard
 * @description Karta vybranej lode v kvalite karty lietadla (2026-10-10,
 * vlastník: „sprav karty minimálne také kvalitné ako pri lietadlách").
 *
 * Rovnaká prezentácia ako sledovaný let (trackedReadout.createTrackedOverlayEntry):
 * dokovaná k pravému okraju (nezakrýva loď ani trasu), titul s vlajkou,
 * čitateľné riadky, trasa s vlajkami prístavov, lišta priebehu plavby, dva
 * grafy (rýchlosť a vzdialenosť do cieľa za posledných ~24 h), päta so
 * zdrojom a vekom polohy. Fotka (vesselPhoto.js) a krížik (cardCloseButtons)
 * sa ukotvia k jej obdĺžniku rovnako ako pri lietadle.
 *
 * Jeden stavebný kameň pre všetky lodné vrstvy (živé AIS, AISHub, GFW) —
 * karta hovorí tou istou rečou bez ohľadu na zdroj. Čisté funkcie.
 */
import { haversineKm, bucketSeries } from './flightCharts.js';
import { routeRowFromRoute, compassLabel } from './trackedCardModel.js';
import {
  newerPositionLine,
  portHistoryLine,
  vesselHullParts,
  vesselLocalTimeLabel,
  vesselMotionParts,
  vesselRegistryParts,
  vesselVoyageModel,
  voyageDepartureLine,
  localizedTypeDetail,
} from './vesselCardDetails.js';
import { greatCircleKm } from './vesselDestination.js';
import { clearVesselEstimate, estimateLine, estimateVesselPosition, showVesselEstimate } from './vesselEstimate.js';

const identity = (key) => key;
export const VESSEL_CHART_SAMPLES = 48;
const KN_TO_KMH = 1.852;

/** Navigačný stav AIS (ITU-R M.1371) po slovensky / anglicky. */
const NAV_STATUS = {
  sk: ['pláva na motor', 'na kotve', 'bez velenia', 'obmedzená manévrovateľnosť', 'obmedzená ponorom', 'uviazaná v prístave', 'na plytčine', 'rybolov', 'pláva pod plachtami'],
  en: ['under way using engine', 'at anchor', 'not under command', 'restricted manoeuvrability', 'constrained by draught', 'moored', 'aground', 'engaged in fishing', 'under way sailing'],
};

/** Navigačný stav z kódu AIS; neznámy/15 = ''. Pure. */
export function navStatusText(code, lang = 'sk') {
  const n = Number(code);
  if (!Number.isInteger(n) || n < 0 || n > 8) return '';
  return (NAV_STATUS[lang] || NAV_STATUS.en)[n];
}

function decimal(value, digits, lang) {
  const text = Number(value).toFixed(digits);
  return lang === 'sk' ? text.replace('.', ',') : text;
}

function thousands(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function hhmmUtc(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function normalizeSeries(values, max) {
  return values.map((v) => (v === null || v === undefined || !Number.isFinite(v) || max <= 0 ? null : Math.max(0, Math.min(1, v / max))));
}

/**
 * Grafy lode: rýchlosť a (so známym cieľom) vzdialenosť do cieľa podľa času
 * za trasu z registra + vlastné vzorky. Tvar ako buildFlightCharts (vykreslí
 * ho ten istý paintFlightChartsRows). Pure.
 * @param {Array<{t:number, lat:number, lon:number, speedKn?:number|null}>} points t v ms, chronologicky
 * @param {{nowMs?: number, speedKn?: number|null, destination?: {lat:number, lon:number}|null}} now
 */
export function buildVesselCharts(points, { nowMs = Date.now(), speedKn = null, destination = null } = {}, t = identity, lang = 'sk') {
  const pts = (Array.isArray(points) ? points : []).filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (pts.length < 2) return null;
  const t0 = pts[0].t;
  const tEnd = Math.max(nowMs, pts[pts.length - 1].t);
  const span = Math.max(1, tEnd - t0);
  const x = (ms) => Math.max(0, Math.min(1, (ms - t0) / span));
  const speedPts = pts.filter((p) => Number.isFinite(p.speedKn)).map((p) => ({ x: x(p.t), v: p.speedKn }));
  if (Number.isFinite(speedKn)) speedPts.push({ x: 1, v: speedKn });
  const speedSeries = bucketSeries(speedPts, VESSEL_CHART_SAMPLES);
  const speedKnown = speedSeries.filter((v) => v !== null).length;
  let distSeries = null;
  let distNow = null;
  let distFirst = null;
  if (destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lon)) {
    const dPts = pts.map((p) => ({ x: x(p.t), v: haversineKm(p.lat, p.lon, destination.lat, destination.lon) })).filter((p) => Number.isFinite(p.v));
    if (dPts.length >= 2) {
      distSeries = bucketSeries(dPts, VESSEL_CHART_SAMPLES);
      distFirst = dPts[0].v;
      distNow = dPts[dPts.length - 1].v;
    }
  }
  if (speedKnown < 2 && !distSeries) return null;
  const speedMax = Math.max(1, ...speedSeries.filter((v) => v !== null));
  const nowSpeed = Number.isFinite(speedKn) ? speedKn : [...speedSeries].reverse().find((v) => v !== null);
  const distMax = distSeries ? Math.max(1, ...distSeries.filter((v) => v !== null)) : 1;
  return {
    mode: 'time',
    forecast: false,
    forecastLabel: '',
    titles: { altitude: t('vessel.chart-speed'), speed: distSeries ? t('vessel.chart-distance') : '' },
    axis: { left: `${hhmmUtc(t0)} UTC`, right: t('chart.now') },
    altitude: speedKnown >= 2 ? {
      past: normalizeSeries(speedSeries, speedMax),
      future: [],
      xNow: 1,
      label: t('vessel.chart-speed-label', { max: decimal(speedMax, 1, lang), now: Number.isFinite(nowSpeed) ? decimal(nowSpeed, 1, lang) : '—' }),
    } : null,
    speed: distSeries ? {
      past: normalizeSeries(distSeries, distMax),
      xNow: 1,
      label: t('vessel.chart-distance-label', { from: thousands(distFirst), now: thousands(distNow) }),
    } : null,
  };
}

/**
 * Riadok priebehu plavby (lišta ako pri lietadle): „92 % · zostáva 633 km ·
 * príchod ~22 h (11. 10. 06:00 UTC)". Pure.
 */
export function vesselProgressRow(progress, speedKn, t = identity, lang = 'sk', nowMs = Date.now()) {
  const fraction = Number(progress?.fractionDone);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  const parts = [t('card.progress-done', { pct: Math.round(fraction * 100) })];
  const remaining = Number(progress?.remainingKm);
  if (Number.isFinite(remaining) && remaining >= 0) parts.push(t('card.km-left', { km: thousands(remaining) }));
  if (Number.isFinite(remaining) && Number.isFinite(speedKn) && speedKn >= 1) {
    const hours = remaining / (speedKn * KN_TO_KMH);
    const at = new Date(nowMs + hours * 3_600_000);
    const clock = lang === 'sk'
      ? `${at.getUTCDate()}. ${at.getUTCMonth() + 1}. ${hhmmUtc(at.getTime())} UTC`
      : `${at.toISOString().slice(5, 10)} ${hhmmUtc(at.getTime())} UTC`;
    const eta = hours >= 48 ? `${Math.round(hours / 24)} d` : `${Math.max(1, Math.round(hours))} h`;
    parts.push(t('vessel.arrival', { eta, clock }));
  }
  return { fraction, label: parts.join(' · ') };
}

/** Prezentačné vlastnosti dokovanej karty (ako trackedReadout pre lietadlo). */
export const VESSEL_TRACKED_STYLE = Object.freeze({
  variant: 'tracked',
  tracked: true,
  protected: true,
  paintLane: 'tracked',
  collisionGroup: 'ambient-card',
  priority: Number.MAX_SAFE_INTEGER - 1,
  anchorRadiusPx: 10,
  anchorRadiusScale: 1.2,
  minAnchorGapPx: 16,
  anchorGapPaddingPx: 10,
  verticalOnly: true,
  viewportMargin: 6,
  dock: 'right',
  dockAnchorClearPx: 36,
  dockReserveBelowPx: 140,
  edgeFade: 'none',
  horizonCull: true,
  terrainOcclusion: false,
  interactive: false,
  selected: false,
});

/**
 * Karta vybranej lode (záznam pre worldOverlay hostiteľa). Pure.
 * @param {object} v
 * @param {string} v.id id záznamu v zdroji (vessel:<MMSI>, aishub:<MMSI>, gfw:<MMSI>)
 * @param {*} v.position Cartesian3 kotvy
 * @param {string} v.name
 * @param {string|null} v.flagIso
 * @param {string} v.accent
 * @param {object} v.vessel {mmsi, lat, lon, speedKn, course, heading, rateOfTurn, navStatus, typeText, callSign, imo, aisClass, lengthM, beamM, draughtM, destination, eta, fixMs}
 * @param {object|null} v.info /api/vessel-info
 * @param {object|null} v.portIndex
 * @param {Array} [v.chartPoints] body trasy s časom a rýchlosťou
 * @param {string} v.sourceLine riadok zdroja („AISStream · poloha 21:00:47Z (2 min)")
 * @param {boolean} [v.delayed] oneskorený zdroj (AISHub, GFW) — bez priebehu a miestneho času, ak je poloha stará
 * @param {boolean} [v.stale]
 */
export function buildVesselTrackedEntry(v, t = identity, lang = 'sk', nowMs = Date.now()) {
  const vessel = v.vessel || {};
  const info = v.info || null;
  const details = [];
  // 1. Pohyb: rýchlosť (kn aj km/h) · kurz so svetovou stranou · smer prídy · otáčanie · stav.
  const speed = Number.isFinite(vessel.speedKn)
    ? `${decimal(vessel.speedKn, 1, lang)} kn (${Math.round(vessel.speedKn * KN_TO_KMH)} km/h)`
    : '';
  const course = Number.isFinite(vessel.course) && vessel.course >= 0 && vessel.course < 360 ? vessel.course : null;
  const motion = vesselMotionParts({ ...vessel, course: null }, t, lang).filter((p) => !/^(COG|kurz)/.test(p));
  const courseText = course !== null ? `${t('vessel.course', { deg: Math.round(course) })} (${compassLabel(course, t)})` : '';
  const moveLine = [speed, courseText, ...motion].filter(Boolean).join(' · ');
  if (moveLine) details.push(moveLine);
  const nav = navStatusText(vessel.navStatus, lang);
  // 2. Identita: podrobný typ (register) alebo AIS typ · stav plavby · volací znak.
  const typeText = info?.typeDetail ? localizedTypeDetail(info.typeDetail, lang) : vessel.typeText;
  const ident = [typeText ? typeText.charAt(0).toUpperCase() + typeText.slice(1) : '', nav, vessel.callSign].filter(Boolean).join(' · ');
  if (ident) details.push(ident);
  // 3. Trup a 4. register.
  const hull = vesselHullParts(vessel, info, t, lang).join(' · ');
  if (hull) details.push(hull);
  const registry = vesselRegistryParts(info, t, lang).slice(info?.typeDetail ? 1 : 0).join(' · ');
  if (registry) details.push(registry);
  // 5. Novšia poloha z registra, keď je naša staršia (loď mimo dosahu).
  // Dlhý riadok novšej polohy na dva (kedy · kde / rýchlosť · prijímač), nech karta nie je široká.
  const newer = newerPositionLine(info, Number.isFinite(vessel.fixMs) ? vessel.fixMs : null, t, lang, nowMs);
  if (newer) {
    const parts = newer.split(' · ');
    details.push(parts.slice(0, 3).join(' · '));
    if (parts.length > 3) details.push(parts.slice(3).join(' · '));
  }
  // 6. Plavba: odkiaľ (s časom), cieľ, predchádzajúce prístavy.
  const voyage = vesselVoyageModel(vessel, info, v.portIndex);
  const departed = voyageDepartureLine(voyage, t, lang, nowMs, { withOrigin: !voyage?.destination });
  if (departed) details.push(departed);
  const destText = String(vessel.destination || info?.destination || '').trim();
  if (!voyage?.destination && destText) details.push(`→ ${destText}${vessel.eta ? ` · ETA ${vessel.eta}` : ''}`);
  else if (voyage?.destination && vessel.eta) details.push(`ETA ${vessel.eta} (${t('vessel.eta-crew')})`);
  const history = portHistoryLine(info, v.portIndex, t);
  if (history) details.push(history);

  const route = voyage?.origin?.name && voyage?.destination?.name
    ? routeRowFromRoute({
      origin: { code: voyage.origin.locode, name: voyage.origin.name, country: voyage.origin.iso2 || voyage.origin.country },
      destination: { code: voyage.destination.locode, name: voyage.destination.name, country: voyage.destination.iso2 || voyage.destination.country },
    }, lang)
    : null;
  const progress = !v.delayed && voyage?.progress ? vesselProgressRow(voyage.progress, vessel.speedKn, t, lang, nowMs) : null;
  const destPort = Number.isFinite(voyage?.destination?.lat) ? voyage.destination : (v.destinationPort || null);
  // Odhad súčasnej polohy (bod 4, 2026-10-11): z najnovšej známej polohy (naša alebo z registra).
  const ownBase = Number.isFinite(vessel.fixMs) && Number.isFinite(vessel.lat)
    ? { lat: vessel.lat, lon: vessel.lon, t: vessel.fixMs, speedKn: vessel.speedKn, course: vessel.course } : null;
  const reg = info?.lastPosition;
  const regBase = reg && Number.isFinite(reg.t) ? { lat: reg.lat, lon: reg.lon, t: reg.t, speedKn: reg.speedKn, course: reg.course } : null;
  const base = regBase && (!ownBase || regBase.t > ownBase.t) ? regBase : ownBase;
  const estimate = base ? estimateVesselPosition(base, { destination: destPort, nowMs }) : null;
  const estLine = estimateLine(estimate, destPort?.name || '', t, lang);
  if (estLine) details.push(estLine);
  const charts = buildVesselCharts(v.chartPoints, { nowMs, speedKn: v.delayed ? null : vessel.speedKn, destination: destPort }, t, lang);

  const footer = [];
  if (v.sourceLine) footer.push(v.sourceLine);
  const local = !v.delayed ? vesselLocalTimeLabel(vessel.lon, nowMs, v.timeZone || null) : null;
  // Loď z oceánu bez MMSI (dočasný kľúč „mt-…") — MMSI sa nevypisuje, kým ho nepoznáme.
  footer.push([/^\d{9}$/.test(String(vessel.mmsi || '')) ? `MMSI ${vessel.mmsi}` : '', local ? t('vessel.local-time', { time: local }) : ''].filter(Boolean).join(' · '));

  return {
    ...VESSEL_TRACKED_STYLE,
    id: v.id,
    position: v.position,
    accent: v.accent,
    title: [v.name, v.stale ? 'STALE' : ''].filter(Boolean).join(' · '),
    titleFlag: v.flagIso || null,
    details,
    route,
    progress,
    charts,
    footer: footer.filter(Boolean),
    profile: null,
    logos: null,
    alert: null,
    estimate: estimate ? { base, estimate, label: `${t('vessel.estimate-label')} · ±${estimate.radiusKm} km` } : null,
  };
}

/** Odhad z karty na mapu (kreslí sa len pri zmene, nie pri každom publikovaní). */
const _estimateSig = new Map();
export function syncVesselEstimate(key, entry) {
  const e = entry?.estimate;
  if (!e) { if (_estimateSig.has(key)) { _estimateSig.delete(key); clearVesselEstimate(key); } return; }
  const sig = `${e.estimate.lat.toFixed(3)},${e.estimate.lon.toFixed(3)},${e.estimate.radiusKm}`;
  if (_estimateSig.get(key) === sig) return;
  _estimateSig.set(key, sig);
  showVesselEstimate(key, e.base, e.estimate, e.label);
}
export function clearVesselEstimateFor(key) {
  _estimateSig.delete(key);
  clearVesselEstimate(key);
}

export { greatCircleKm };
