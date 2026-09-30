// src/data/eventPost.js — titulok a text príspevku udalosti (Udalosti, etapa 2, 2026-09-30, vlastník:
// „najlepšie vytvoriť aj post na FB, aby som to mohol elegantne publikovať", „len overené, nie fake").
// Fakty z dát dvoch sietí prijímačov (čas UTC; čo videla len jedna sieť, je tak označené), tvrdenia
// médií len s menom média a odkazom, typ udalosti len pri zhode 2 dôveryhodných médií (eventNews.js).
// Žiadne mená ľudí (etická čiara OKO). Pure.

import { clockUtc, momentPhrase } from './eventTimeline.js';

/** Typ udalosti podľa zhody médií → slovenský názov. */
export const NEWS_TYPE_SK = Object.freeze({
  hijack: 'nezákonný zásah na palube (únos)',
  shootdown: 'zostrelenie',
  crash: 'havária',
  emergency: 'núdzová situácia',
});
const NEWS_TYPE_SK_ABOUT = Object.freeze({
  hijack: 'o pokuse o únos lietadla',
  shootdown: 'o zostrelení lietadla',
  crash: 'o havárii lietadla',
  emergency: 'o núdzovej situácii na palube',
});
/** Mená médií pre text (inak sa použije doména). */
export const OUTLET_NAMES = Object.freeze({
  'reuters.com': 'Reuters', 'apnews.com': 'AP', 'afp.com': 'AFP', 'bbc.com': 'BBC', 'bbc.co.uk': 'BBC', 'npr.org': 'NPR',
  'cnn.com': 'CNN', 'nbcnews.com': 'NBC News', 'cbsnews.com': 'CBS News', 'dw.com': 'DW', 'france24.com': 'France 24',
  'euronews.com': 'Euronews', 'aljazeera.com': 'Al Jazeera', 'nytimes.com': 'The New York Times',
  'washingtonpost.com': 'The Washington Post', 'wsj.com': 'The Wall Street Journal', 'theguardian.com': 'The Guardian',
  'ft.com': 'Financial Times', 'bloomberg.com': 'Bloomberg', 'timesofisrael.com': 'The Times of Israel',
  'haaretz.com': 'Haaretz', 'jpost.com': 'The Jerusalem Post', 'ynetnews.com': 'Ynet', 'jta.org': 'JTA',
  'arabnews.com': 'Arab News', 'thenationalnews.com': 'The National', 'gulfnews.com': 'Gulf News',
  'khaleejtimes.com': 'Khaleej Times', 'avherald.com': 'The Aviation Herald', 'aviation-safety.net': 'Aviation Safety Network',
  'flightglobal.com': 'FlightGlobal', 'tasr.sk': 'TASR', 'sme.sk': 'SME', 'dennikn.sk': 'Denník N', 'aktuality.sk': 'Aktuality.sk',
  'pravda.sk': 'Pravda', 'hnonline.sk': 'Hospodárske noviny', 'ta3.com': 'TA3', 'stvr.sk': 'STVR', 'ctk.cz': 'ČTK',
});
export const outletName = (domain) => OUTLET_NAMES[domain] || domain;
/** Mená sietí v texte. */
export const NETWORK_NAMES = Object.freeze({ opensky: 'OpenSky', adsblol: 'adsb.lol' });

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const dateSk = (tS) => {
  const d = new Date(tS * 1000);
  return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;
};

/** Let: „FZ1073 (Fly Dubai) Dubai → Tel Aviv" z trasy adsbdb, inak volací znak. Pure. */
export function flightLabel(event) {
  const r = event.route || null;
  const flight = r?.flightIata || event.callsign || event.icao24;
  const airline = r?.airline ? ` (${r.airline})` : '';
  const path = r?.origin?.city && r?.destination?.city ? ` ${r.origin.city} → ${r.destination.city}` : '';
  return `${flight}${airline}${path}`;
}

/** Čo sa stalo: typ podľa zhody médií, inak podľa dát (núdzový kód / strmhlavé klesanie). Pure. */
export function eventWhat(event) {
  const type = event.news?.type && NEWS_TYPE_SK[event.news.type];
  if (type) return cap(type);
  const code = (event.triggers || []).find((t) => t.kind === 'squawk' && t.status !== 'contradicted');
  return cap(code ? `núdzový kód ${code.code}` : 'strmhlavé klesanie');
}

/** Titulok: „Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv". Pure. */
export function eventHeadline(event) {
  return `${eventWhat(event)}: let ${flightLabel(event)}`.slice(0, 120);
}

/** Riadok letu pod titulkom obrázka: „Let FZ1073 · Fly Dubai · Dubai → Tel Aviv". Pure. */
export function flightLine(event) {
  const r = event.route || null;
  const parts = [`Let ${r?.flightIata || event.callsign || event.icao24}`];
  if (r?.airline) parts.push(r.airline);
  if (r?.origin?.city && r?.destination?.city) parts.push(`${r.origin.city} → ${r.destination.city}`);
  return parts.join(' · ');
}

/**
 * Kľúčové momenty pre príspevok a obrázok: udalosť (klesanie, kódy, obrat), diery počas nej a koniec
 * (pristátie / koniec údajov) — nie cestovná výška ani dávne diery pred udalosťou. Pure.
 */
export function keyMoments(event) {
  const from = (event.firstT ?? 0) - 15 * 60;
  const to = (event.lastT ?? event.firstT ?? 0) + 90 * 60;
  return (event.timeline || []).filter((m) => {
    if (m.kind === 'cruise' || m.kind === 'takeoff') return false;
    if (m.kind === 'landing' || m.kind === 'last-contact') return true;
    return m.t >= from && m.t <= to;
  });
}

/**
 * Text príspevku (SK). Časy UTC. Čo videla len jedna sieť, je tak označené. Správy: mená médií a
 * najviac 3 odkazy. Bez overenia správami bez vety o médiách (text je potom len náhľad).
 * @param {object} event uložená udalosť (flightEventsService)
 * @param {{url?: string|null}} [opts] odkaz na rekonštrukciu v OKO
 */
export function postText(event, { url = null } = {}) {
  const lines = [];
  lines.push(`${eventHeadline(event)}, ${dateSk(event.firstT)}`);
  lines.push('');
  lines.push('Čo zachytili dve nezávislé siete prijímačov (OpenSky, adsb.lol), časy UTC:');
  for (const m of keyMoments(event)) {
    const nets = (m.seenBy || []).filter((id) => NETWORK_NAMES[id]);
    const only = nets.length === 1 ? ` (len sieť ${NETWORK_NAMES[nets[0]]})` : '';
    lines.push(`• ${clockUtc(m.t).slice(0, 5)} — ${momentPhrase(m, 'sk')}${only}`);
  }
  const trusted = event.news?.status === 'verified' ? event.news.trusted || [] : [];
  if (trusted.length) {
    const names = [...new Set(trusted.map((t) => outletName(t.domain)))];
    const about = event.news.type ? ` ${NEWS_TYPE_SK_ABOUT[event.news.type]}` : '';
    lines.push('');
    lines.push(`Médiá (${names.join(', ')}) informujú${about}.`);
    for (const t of trusted.slice(0, 3)) lines.push(t.url);
  }
  lines.push('');
  if (url) lines.push(`Rekonštrukcia letu na mape: ${url}`);
  lines.push('Údaje: OpenSky Network, adsb.lol (ODbL) · okolive.sk');
  return lines.join('\n');
}
