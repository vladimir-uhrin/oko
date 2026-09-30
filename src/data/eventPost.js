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
export const NEWS_TYPE_EN = Object.freeze({
  hijack: 'unlawful interference on board (hijacking)',
  shootdown: 'shootdown',
  crash: 'crash',
  emergency: 'emergency on board',
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

/**
 * Siete, ktoré majú v okne udalosti údaje (pokrytie z časovej osi) — text ani obrázok nesmú tvrdiť
 * „dve siete", keď druhá (zatiaľ) nemá nič. Bez údajov o pokrytí obe. Pure.
 */
export function networksWithData(event) {
  const cov = Array.isArray(event?.coverage) ? event.coverage : null;
  return cov ? cov.filter((c) => c && c.points > 0 && NETWORK_NAMES[c.id]).map((c) => c.id) : Object.keys(NETWORK_NAMES);
}

/** Úvodná veta k momentom podľa toho, čo naozaj overili siete prijímačov. Pure. */
export function networksLead(event) {
  const nets = networksWithData(event).map((id) => NETWORK_NAMES[id]);
  if (!nets.length) return 'Časy UTC:';
  if (nets.length === 1) return `Čo zachytila sieť prijímačov ${nets[0]} (druhá sieť to zatiaľ nepotvrdila), časy UTC:`;
  if (event.status !== 'confirmed') return `Čo zachytili siete prijímačov (${nets.join(', ')}) — zatiaľ bez overenia druhou sieťou, časy UTC:`;
  return `Čo zachytili dve nezávislé siete prijímačov (${nets.join(', ')}), časy UTC:`;
}
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
export function eventWhat(event, lang = 'sk') {
  const en = lang === 'en';
  const type = event.news?.type && (en ? NEWS_TYPE_EN : NEWS_TYPE_SK)[event.news.type];
  if (type) return cap(type);
  const code = (event.triggers || []).find((t) => t.kind === 'squawk' && t.status !== 'contradicted');
  if (code) return cap(en ? `emergency code ${code.code}` : `núdzový kód ${code.code}`);
  return cap(en ? 'steep descent' : 'strmhlavé klesanie');
}

/** Titulok: „Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv". Pure. */
export function eventHeadline(event, lang = 'sk') {
  return `${eventWhat(event, lang)}: ${lang === 'en' ? 'flight' : 'let'} ${flightLabel(event)}`.slice(0, 120);
}

/** Riadok letu pod titulkom obrázka: „Let FZ1073 · Fly Dubai · Dubai → Tel Aviv". Pure. */
export function flightLine(event, lang = 'sk') {
  const r = event.route || null;
  const parts = [`${lang === 'en' ? 'Flight' : 'Let'} ${r?.flightIata || event.callsign || event.icao24}`];
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
 * Okno udalosti v čase: od 20 min pred prvým spúšťačom po posledný kľúčový moment + 20 min.
 * Obrázok, verejný pohľad aj záber odkazu sa zamerajú naň. Pure.
 */
export function incidentWindow(event, moments = keyMoments(event)) {
  const from = (event.firstT ?? 0) - 20 * 60;
  const lastMoment = Math.max(event.lastT ?? event.firstT ?? 0, ...moments.map((m) => m.endT ?? m.t));
  return [from, lastMoment + 20 * 60];
}

/** Na zverejnenie až pri overených DÁTACH (dve siete) AJ SPRÁVACH (dve dôveryhodné médiá). Pure. */
export function isPublishable(event) {
  return event?.status === 'confirmed' && event?.news?.status === 'verified';
}

/** Dôveryhodné médiá, ktoré udalosť overili (len pri overení správami, len odkazy http/https). Pure. */
export function verifiedSources(event) {
  const list = event?.news?.status === 'verified' ? event.news.trusted || [] : [];
  return list.filter((s) => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url) && s.domain);
}

const airportView = (a) => (a ? {
  iata: a.iata ?? null,
  icao: a.icao ?? null,
  city: a.city ?? null,
  country: a.country ?? null,
  lat: Number.isFinite(a.lat) ? a.lat : null,
  lon: Number.isFinite(a.lon) ? a.lon : null,
} : null);
const finiteOr = (v) => (Number.isFinite(v) ? v : null);

/**
 * Verejný pohľad na udalosť (panel v OKO po otvorení odkazu z príspevku): texty SK/EN, kľúčové
 * momenty, zjednodušená stopa, trasa, overujúce médiá (meno + odkaz) a atribúcia. Bez interných
 * polí (dopyt do GDELT, adresy druhej siete, dôvod vyradenia). Pure.
 */
export function publicEventView(event) {
  const moments = keyMoments(event);
  const r = event.route || null;
  const sources = verifiedSources(event);
  return {
    id: event.id,
    icao24: event.icao24,
    callsign: event.callsign ?? null,
    reg: event.reg ?? null,
    typeCode: event.typeCode ?? null,
    typeName: event.typeName ?? null,
    status: event.status,
    publishable: isPublishable(event),
    firstT: event.firstT,
    lastT: event.lastT,
    window: event.window ? { fromT: event.window.fromT, toT: event.window.toT } : null,
    focus: incidentWindow(event, moments),
    route: r ? { airline: r.airline ?? null, flightIata: r.flightIata ?? null, origin: airportView(r.origin), destination: airportView(r.destination) } : null,
    headline: { sk: eventHeadline(event, 'sk'), en: eventHeadline(event, 'en') },
    flightLine: { sk: flightLine(event, 'sk'), en: flightLine(event, 'en') },
    moments: moments.map((m) => ({
      t: m.t,
      kind: m.kind,
      lat: finiteOr(m.lat),
      lon: finiteOr(m.lon),
      alt: finiteOr(m.alt),
      seenBy: (m.seenBy || []).filter((id) => NETWORK_NAMES[id]),
      text: { sk: momentPhrase(m, 'sk'), en: momentPhrase(m, 'en') },
    })),
    news: sources.length
      ? { type: event.news.type ?? null, sources: sources.map((s) => ({ name: outletName(s.domain), domain: s.domain, url: s.url })) }
      : null,
    track: Array.isArray(event.track) ? event.track : [],
    networks: networksWithData(event).map((id) => NETWORK_NAMES[id]),
    attribution: ['OpenSky Network', 'adsb.lol (ODbL 1.0)', ...(r ? ['adsbdb (plán letu)'] : [])],
    published: event.published?.url ? { t: event.published.t ?? null, url: event.published.url } : null,
  };
}

/**
 * Záber kamery nad udalosťou: stred a výška nad kľúčovými momentmi a stopou v okne udalosti
 * (pohľad zvisle nadol). Odkaz aj panel v OKO. Pure.
 * @returns {{lat: number, lon: number, alt: number}|null}
 */
export function eventCamera(event) {
  const moments = keyMoments(event);
  const [from, to] = incidentWindow(event, moments);
  const pts = [];
  for (const m of moments) if (Number.isFinite(m.lat) && Number.isFinite(m.lon)) pts.push([m.lat, m.lon]);
  for (const p of Array.isArray(event.track) ? event.track : []) if (p[0] >= from && p[0] <= to) pts.push([p[1], p[2]]);
  if (!pts.length) return null;
  let [s, n, w, e] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [lat, lon] of pts) { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon); }
  const lat = (s + n) / 2;
  const lon = (w + e) / 2;
  const spanKm = Math.max((n - s) * 111.2, (e - w) * 111.2 * Math.cos((lat * Math.PI) / 180));
  return { lat, lon, alt: Math.round(Math.min(4_000_000, Math.max(250_000, spanKm * 1000 * 1.4))) };
}

/** Stav odkazu udalosti (hash pre /s/<id>): záber nad udalosťou, `event=<id>` otvorí panel. Pure. */
export function eventShareHash(event) {
  const cam = eventCamera(event);
  if (!cam || !event.id) return null;
  return `lat=${cam.lat.toFixed(4)}&lon=${cam.lon.toFixed(4)}&alt=${cam.alt}&heading=0&pitch=-90&event=${event.id}`;
}

/** Názov a popis odkazu na sieťach (Open Graph). Pure. */
export function eventShareMeta(event) {
  const names = [...new Set(verifiedSources(event).map((s) => outletName(s.domain)))];
  return {
    title: `${eventHeadline(event)}, ${dateSk(event.firstT)}`,
    description: `Overené dvoma nezávislými sieťami prijímačov (OpenSky, adsb.lol)${names.length ? ` a médiami (${names.join(', ')})` : ''}. Rekonštrukcia letu na mape OKO.`,
  };
}

/** Zdieľanie na Facebooku cez vlastný dialóg FB (príspevok odošle až vlastník). Pure. */
export function facebookShareUrl(url) {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
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
  lines.push(networksLead(event));
  for (const m of keyMoments(event)) {
    const nets = (m.seenBy || []).filter((id) => NETWORK_NAMES[id]);
    const only = nets.length === 1 ? ` (len sieť ${NETWORK_NAMES[nets[0]]})` : '';
    lines.push(`• ${clockUtc(m.t).slice(0, 5)} — ${momentPhrase(m, 'sk')}${only}`);
  }
  const trusted = verifiedSources(event);
  if (trusted.length) {
    const names = [...new Set(trusted.map((t) => outletName(t.domain)))];
    const about = event.news.type ? ` ${NEWS_TYPE_SK_ABOUT[event.news.type]}` : '';
    lines.push('');
    lines.push(`Médiá (${names.join(', ')}) informujú${about}.`);
    for (const t of trusted.slice(0, 3)) lines.push(t.url);
  }
  lines.push('');
  if (url) lines.push(`Rekonštrukcia letu na mape: ${url}`);
  lines.push(`Údaje: OpenSky Network, adsb.lol (ODbL)${event.route ? ', plán letu adsbdb' : ''} · okolive.sk`);
  return lines.join('\n');
}
