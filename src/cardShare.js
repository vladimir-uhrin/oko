// src/cardShare.js
// Kvalitné zdieľanie lode (2026-10-12, návrh „rovnako kvalitné zdieľanie lodí" po zdieľaní letu):
// text karty lode, ako ju návštevník vidí (worldOverlay.getOverlayEntryText), sa zloží do tvaru,
// ktorý kreslí pás zdieľania letu (flightShare.drawFlightShareCard), a do titulku a popisu príspevku.
// Odhad polohy lode (dead reckoning, „ODHAD…") ostáva poctivo označený; loď z oneskoreného zdroja
// (AISHub, GFW) dostane štítok ONESKORENÉ, nie NAŽIVO. Čistý modul.

import { FLIGHT_SHARE_SITE } from './flightShare.js';

function clean(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function formatWhen(whenMs, lang) {
  const locale = lang === 'en' ? 'en-GB' : 'sk-SK';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(whenMs));
  } catch {
    return new Date(whenMs).toISOString().slice(0, 16).replace('T', ' ');
  }
}

const ESTIMATE_RE = /^(ODHAD|ESTIMATE)/i;
const KNOTS_RE = /\d\s*kn\b/;
const ETA_RE = /^ETA\b/;

/**
 * Text karty lode → tvar pásu zdieľania (ako flights.getTrackedShareCard). Pure.
 * @param {{title: string, details: string[], route: string, progress: number|null, footer: string[], alert: string}} text
 * @param {{ delayed?: boolean, lang?: 'sk'|'en' }} [options] delayed = AISHub / GFW (nie živé AIS)
 */
export function vesselShareCard(text, { delayed = false, lang = 'sk' } = {}) {
  if (!text || !clean(text.title)) return null;
  const en = lang === 'en';
  const details = (text.details || []).map(clean).filter(Boolean);
  const estimateLine = [...details, ...(text.footer || []).map(clean)].find((line) => ESTIMATE_RE.test(line)) || '';
  // Karta lode (vesselCardDetails): 1. riadok pohyb („13,1 kn (24 km/h) · kurz 258° (Z) · smer prídy …"),
  // 2. typ a stav („Loď na kusový náklad · pláva na motor · V7ZQ4"), ďalej rozmery, plavba, ETA.
  const motion = details.find((line) => KNOTS_RE.test(line)) || '';
  const ident = details.find((line) => line !== motion && line !== estimateLine) || '';
  const eta = details.find((line) => ETA_RE.test(line)) || '';
  const motionShort = motion.split(' · ').slice(0, 2).join(' · ');
  return {
    callsign: clean(text.title),
    flightIata: '',
    identLine: ident,
    routeLine: clean(text.route),
    progress: Number.isFinite(text.progress) ? { fractionDone: text.progress } : null,
    flightLines: [motionShort, eta].filter(Boolean),
    estimated: Boolean(estimateLine),
    estimateLine,
    alertLine: clean(text.alert),
    chipText: estimateLine ? (en ? 'ESTIMATE' : 'ODHAD') : delayed ? (en ? 'DELAYED' : 'ONESKORENÉ') : (en ? 'LIVE' : 'NAŽIVO'),
    chipTone: estimateLine || delayed ? 'estimate' : 'live',
  };
}

/**
 * Titulok a popis príspevku pre zdieľanú loď. Pure.
 * @returns {{ title: string, description: string, text: string }}
 */
export function buildVesselShareCopy(card, { whenMs = Date.now(), lang = 'sk' } = {}) {
  const title = [clean(card?.callsign), clean(String(card?.identLine || '').split(' · ')[0]), clean(card?.routeLine)].filter(Boolean).join(' · ').slice(0, 110) + ' | OKO';
  const percent = Number.isFinite(card?.progress?.fractionDone) ? Math.round(card.progress.fractionDone * 100) : null;
  const progress = percent === null ? '' : (lang === 'en' ? `${percent} % of the voyage` : `${percent} % plavby`);
  const status = card?.estimateLine ? clean(card.estimateLine) : clean(card?.chipText);
  const description = [status, clean(card?.alertLine), ...(card?.flightLines || []).map(clean), progress, `${FLIGHT_SHARE_SITE} · ${formatWhen(whenMs, lang)}`]
    .filter(Boolean).join(' · ').slice(0, 280);
  return { title, description, text: `${title} — ${description}` };
}
