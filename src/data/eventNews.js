// src/data/eventNews.js — overenie udalosti správami (Udalosti, etapa 2, 2026-09-30, vlastník:
// „automatizované aj s overením z nezávislého zdroja", „potrebujem len overené, nie fake!").
// Druhé, nezávislé overenie popri dvoch sieťach prijímačov: o tom istom lete (aerolinka + číslo
// letu alebo trasa) musia písať aspoň 2 RÔZNE dôveryhodné médiá zo zoznamu vlastníka
// (local_data/events/trusted-news.json). Typ udalosti (únos, zostrelenie, havária, núdza) sa
// prevezme len vtedy, keď sa naň zhodnú aspoň 2 dôveryhodné médiá; inak neutrálne.
// Naživo 30. 9. k FZ1073: GDELT 75 článkov / 68 webov, prvý o 07:45 UTC (~2,5 h po udalosti);
// medzi nimi aj článok o podvodníkovi s FALOŠNOU správou o únose v živom vysielaní — preto
// dve médiá + dve siete, a titulky s „fake/hoax" sa do typu nerátajú.
// Pure (bez siete) — dopyty robí flightEventsService.js.

/** Správy od hodiny pred udalosťou do 48 h po nej. */
export const NEWS_WINDOW_BEFORE_S = 3600;
export const NEWS_WINDOW_AFTER_S = 48 * 3600;
/** Overené správami = aspoň toľko rôznych dôveryhodných domén. */
export const NEWS_MIN_TRUSTED = 2;
/** Slová incidentu do dopytu GDELT (GDELT hľadá v textoch článkov). */
export const INCIDENT_TERMS = Object.freeze(['hijack', 'hijacked', 'hijacking', 'diverted', 'emergency', 'crash', '"shot down"', 'terror', 'plunge']);
/** Typy udalostí podľa titulkov; poradie = priorita pri zhode. */
export const NEWS_TYPES = Object.freeze([
  { type: 'shootdown', terms: [/shot down/i, /\bdowned\b/i, /\bmissile\b/i] },
  // „Kidnapping" = preklad hebrejského „chatifa" (únos lietadla aj ľudí) v izraelských a arabských médiách.
  { type: 'hijack', terms: [/hijack/i, /unlawful interference/i, /\bterror/i, /\bkidnap/i] },
  { type: 'crash', terms: [/\bcrash(ed|es)?\b/i] },
  { type: 'emergency', terms: [/emergency/i, /\bdiverted\b/i, /\bmayday\b/i, /\bplunge/i] },
]);
/** Titulky o falošných správach sa do typu nerátajú. */
const HOAX = /\b(fake|hoax|false|debunk)/i;
/**
 * Titulok, ktorý typ popiera („Diverted flydubai flight not a kidnapping, Israeli PM confirms" — naživo
 * 30. 9., Arab News). Dôveryhodné médium, ktoré typ popiera, ho vetuje: sporný typ nie je overený.
 */
const NEGATION = /\b(?:not|no|never|wasn'?t|isn'?t|denie[sd]|deny|rule[sd]? out)\b[\s\w'-]{0,24}?\b(hijack\w*|kidnap\w*|terror\w*|shot down|downed|missile\w*|crash\w*)/i;
/** Typ, ktorý titulok popiera, alebo null. Pure. */
export function negatedType(title) {
  // „nevylúčili únos" (not ruled out) je opak popretia.
  const text = String(title || '').replace(/\b(?:not|never|hasn'?t|haven'?t|didn'?t)\s+(?:yet\s+)?(?:been\s+)?rule[sd]?\s+out\b/gi, ' ');
  const word = text.match(NEGATION)?.[1];
  return word ? NEWS_TYPES.find(({ terms }) => terms.some((re) => re.test(word)))?.type ?? null : null;
}

const lower = (s) => String(s || '').toLowerCase();
const squash = (s) => lower(s).replace(/[^a-z0-9]+/g, '');

/** Zoznam dôveryhodných domén z JSON súboru (malé písmená, bez www). Pure. */
export function parseTrustedList(json) {
  const domains = Array.isArray(json?.domains) ? json.domains : [];
  return [...new Set(domains.map((d) => lower(d).trim().replace(/^www\./, '')).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];
}

/** Doména je dôveryhodná (presne alebo subdoména). Pure. */
export function trustedDomainOf(domain, trusted) {
  const d = lower(domain).trim().replace(/^www\./, '');
  return trusted.find((t) => d === t || d.endsWith(`.${t}`)) || null;
}

/**
 * Identita letu pre správy z trasy adsbdb (`/v0/callsign/<cs>` → flightroute): aerolinka, číslo letu,
 * mestá a štáty odletu a príletu. Bez aerolinky null (správy by sa nedali priradiť). Pure.
 */
export function flightIdentity(callsign, flightroute) {
  const fr = flightroute || null;
  const airline = fr?.airline?.name ? String(fr.airline.name).trim() : null;
  if (!airline) return null;
  const cs = String(callsign || fr.callsign || '').trim().toUpperCase();
  const number = (/(\d+)[A-Z]?$/.exec(cs) || [])[1] || null;
  const iata = typeof fr.callsign_iata === 'string' && fr.callsign_iata.trim() ? fr.callsign_iata.trim().toUpperCase() : null;
  const place = (a) => (a ? {
    iata: a.iata_code || null,
    icao: a.icao_code || null,
    city: a.municipality || null,
    country: a.country_name || null,
    lat: Number.isFinite(a.latitude) ? a.latitude : null,
    lon: Number.isFinite(a.longitude) ? a.longitude : null,
  } : null);
  return {
    airline,
    airlineIata: fr.airline?.iata || null,
    airlineIcao: fr.airline?.icao || null,
    callsign: cs || null,
    flightIata: iata,
    flightNumber: number,
    origin: place(fr.origin),
    destination: place(fr.destination),
  };
}

/** Dopyt GDELT: aerolinka (aj bez medzier — „Fly Dubai" vs „flydubai") alebo číslo letu + slová incidentu. Pure. */
export function newsQuery(identity) {
  const names = new Set();
  const a = String(identity.airline || '').replace(/"/g, '').trim();
  if (a) names.add(/\s/.test(a) ? `"${a}"` : a);
  if (/\s/.test(a)) names.add(a.replace(/\s+/g, ''));
  if (identity.flightIata) names.add(identity.flightIata);
  return `(${[...names].join(' OR ')}) (${INCIDENT_TERMS.join(' OR ')})`;
}

const gdeltTime = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
/** URL GDELT DOC API s pevným oknom (nie „posledné dni" — funguje aj pre staršie udalosti). Pure. */
/**
 * Najviac článkov na dopyt (dokumentácia GDELT DOC 2.0: predvolene 75, najviac 250). So zoradením
 * od najstarších by pri 75 vypadli neskoršie správy dôveryhodných médií (FZ1073: ~100 článkov o
 * flydubai za 2 dni) — práve tie, ktoré nesú overený priebeh.
 */
export const NEWS_MAX_RECORDS = 250;

export function newsUrl(query, { fromMs, toMs, maxrecords = NEWS_MAX_RECORDS }) {
  const p = new URLSearchParams({
    query, mode: 'artlist', maxrecords: String(maxrecords), format: 'json', sort: 'dateasc',
    startdatetime: gdeltTime(fromMs), enddatetime: gdeltTime(toMs),
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${p}`;
}

/**
 * Patrí článok k TOMUTO letu? Číslo letu (FZ1073, „flight 1073") alebo aerolinka spolu s mestom
 * či štátom odletu/príletu v titulku alebo adrese. Pure.
 */
export function matchesFlight(article, identity) {
  const text = `${article.title || ''} ${article.url || ''}`;
  const t = lower(text);
  const flat = squash(text);
  if (identity.flightIata && flat.includes(squash(identity.flightIata))) return true;
  if (identity.flightNumber && new RegExp(`\\bflight\\s*#?\\s*${identity.flightNumber}\\b`, 'i').test(text)) return true;
  if (!flat.includes(squash(identity.airline))) return false;
  // Miesto sa hľadá v texte BEZ názvu aerolinky — „Fly Dubai" obsahuje mesto odletu Dubai
  // (inak by sa k letu priradil článok o úplne inej linke flydubai).
  const words = String(identity.airline).trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const rest = t.replace(new RegExp(words.join('[\\s-]*'), 'gi'), ' ');
  const places = [identity.origin, identity.destination].flatMap((p) => [p?.city, p?.country]).filter(Boolean);
  return places.some((p) => rest.includes(lower(p)));
}

/**
 * Verdikt správ: overené (≥ 2 dôveryhodné domény), hlásené (niečo, ale menej), nič. Z každej
 * dôveryhodnej domény najskorší článok. Typ = prvý v poradí priority, na ktorý sa zhodnú ≥ 2 domény.
 * @param {Array<{title, url, source, publishedAt}>} articles (parseGdeltArticles)
 * @returns {{status:'verified'|'reported'|'none', trusted:Array, otherCount:number, type:string|null, typeDomains:string[], firstT:number|null}}
 */
export function newsVerdict(articles, identity, trusted, { fromMs = -Infinity, toMs = Infinity } = {}) {
  const matched = (articles || []).filter((a) => (a.publishedAt ?? 0) >= fromMs && (a.publishedAt ?? 0) <= toMs && matchesFlight(a, identity));
  const byDomain = new Map();
  let otherCount = 0;
  for (const a of matched) {
    const dom = trustedDomainOf(a.source, trusted);
    if (!dom) { otherCount += 1; continue; }
    const prev = byDomain.get(dom);
    if (!prev || (a.publishedAt ?? Infinity) < (prev.publishedAt ?? Infinity)) byDomain.set(dom, a);
  }
  const votes = new Map();
  const contested = new Set();
  for (const a of matched) {
    const dom = trustedDomainOf(a.source, trusted);
    if (!dom || HOAX.test(a.title || '')) continue;
    const denied = negatedType(a.title);
    if (denied) contested.add(denied);
    for (const { type, terms } of NEWS_TYPES) {
      if (type === denied) continue;
      if (terms.some((re) => re.test(a.title || ''))) {
        if (!votes.has(type)) votes.set(type, new Set());
        votes.get(type).add(dom);
      }
    }
  }
  const agreed = NEWS_TYPES.find(({ type }) => !contested.has(type) && (votes.get(type)?.size || 0) >= NEWS_MIN_TRUSTED) || null;
  const trustedList = [...byDomain.entries()]
    .map(([domain, a]) => ({ domain, url: a.url, title: a.title, publishedT: a.publishedAt ? Math.floor(a.publishedAt / 1000) : null }))
    .sort((x, y) => (x.publishedT ?? Infinity) - (y.publishedT ?? Infinity));
  return {
    status: trustedList.length >= NEWS_MIN_TRUSTED ? 'verified' : (matched.length ? 'reported' : 'none'),
    trusted: trustedList,
    otherCount,
    type: agreed ? agreed.type : null,
    typeDomains: agreed ? [...votes.get(agreed.type)] : [],
    // Typy, ktoré niektoré dôveryhodné médium poprelo — do textu nejdú, ani keď ich iné tvrdia.
    contested: [...contested],
    firstT: trustedList[0]?.publishedT ?? null,
  };
}
