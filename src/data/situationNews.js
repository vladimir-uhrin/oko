// src/data/situationNews.js
/**
 * @module situationNews
 * @description „Situácia z otvorených zdrojov" — pilot (2026-09-17): agregované
 * spravodajstvo k námornej/energetickej situácii, začíname zálivom (Hormuz).
 * Zdroj GDELT DOC 2.0 (keyless, otvorený projekt) — filtruje otvorené články
 * podľa dopytu, vracia titulok/zdroj/čas/odkaz/náhľad. Servíruje proxy
 * `/api/situation-news?region=<id>`; GDELT má limit 1 dopyt/5 s, preto proxy
 * cachuje ~15 min.
 *
 * POCTIVOSŤ (pravidlo 2 + 6 CLAUDE.md): AGREGUJEME a ODKAZUJEME na otvorenú
 * žurnalistiku — nereprodukujeme text, nesledujeme osoby, nerozpoznávame tváre.
 * Feed je „situačný prehľad z otvorených zdrojov", nie overená real-time
 * intelligence; každá položka nesie zdroj a čas. Modul je čistý (bez DOM).
 *
 * Rozšírenie: pridaním regiónu do SITUATION_REGIONS (ďalšia úžina = vlastný
 * dopyt) a ďalších zdrojov (RSS, UKMTO) do proxy.
 */

export const SITUATION_NEWS_API = '/api/situation-news';

/**
 * Named regions → a GDELT query (+ a Google News RSS fallback query). Named (not
 * free-text) so the client can never inject an arbitrary query through the proxy.
 * `rssQuery` is used when GDELT is throttled/unavailable; kept separate because
 * the two engines' query syntaxes differ subtly (both here happen to accept
 * quoted phrases + OR).
 * @type {Readonly<Record<string, {id: string, query: string, rssQuery: string, timespan: string}>>}
 */
export const SITUATION_REGIONS = Object.freeze({
  gulf: Object.freeze({
    id: 'gulf',
    query: '"Strait of Hormuz" OR "Persian Gulf" OR "Gulf of Oman"',
    rssQuery: '"Strait of Hormuz" OR "Persian Gulf" OR "Gulf of Oman"',
    timespan: '3d',
    // Direct publisher RSS: real article URLs (not Google-News redirects), so the
    // og:image unfurl and link-out work → cards can show photos. Keyword-filtered
    // to the region on the server; only incident-classified items become markers.
    directRss: Object.freeze([
      'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
      'https://www.aljazeera.com/xml/rss/all.xml',
    ]),
    match: 'hormuz|persian gulf|arabian gulf|gulf of oman|red sea|bab[- ]?el[- ]?mandeb|houthi|bandar abbas|fujairah|kharg|bushehr|jebel ali|ras tanura|\\btanker|\\bwarship|shipping lane|ship-to-ship',
  }),
  // Wider Middle East conflict "mini bulletin" (2026-09-18): one broad feed over
  // Hormuz + Red Sea/Bab-el-Mandeb + Suez + Yemen + Iran + Israel/Gaza/Levant.
  // Incidents geolocate to their named place via the expanded gazetteer.
  mideast: Object.freeze({
    id: 'mideast',
    query: '"Strait of Hormuz" OR "Red Sea" OR "Bab el-Mandeb" OR "Suez Canal" OR "Gulf of Aden" OR Houthi OR "Persian Gulf" OR "Gulf of Oman"',
    rssQuery: '"Red Sea" OR "Strait of Hormuz" OR "Suez Canal" OR "Bab el-Mandeb" OR Houthi OR Yemen OR Iran Israel',
    timespan: '2d',
    directRss: Object.freeze([
      'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
      'https://www.aljazeera.com/xml/rss/all.xml',
    ]),
    match: 'hormuz|persian gulf|arabian gulf|gulf of oman|red sea|bab[- ]?el[- ]?mandeb|gulf of aden|houthi|\\byemen\\b|hodeidah|hudaydah|sana|\\baden\\b|mokha|djibouti|suez|port said|ismailia|bandar abbas|fujairah|kharg|bushehr|\\bgaza\\b|ashkelon|tel aviv|\\beilat\\b|haifa|jerusalem|beirut|damascus|\\btehran\\b|isfahan|natanz|baghdad|\\biran\\b|\\bisrael\\b|hezbollah|\\btanker|\\bwarship',
  }),
});

/** Keyless GDELT DOC 2.0 article-list endpoint for a query. */
export function gdeltDocUrl(query, { timespan = '3d', maxrecords = 30 } = {}) {
  const params = new URLSearchParams({
    query: String(query),
    mode: 'artlist',
    maxrecords: String(Math.max(1, Math.min(75, Math.floor(maxrecords)))),
    format: 'json',
    sort: 'datedesc',
    timespan: String(timespan),
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

/** GDELT `seendate` (`YYYYMMDDTHHMMSSZ` / `YYYYMMDDHHMMSS`) → epoch ms, or null. */
export function parseGdeltDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * GDELT DOC artlist JSON → normalized, deduped items (newest first). Pure.
 * @param {any} json
 * @returns {Array<{title:string, url:string, source:string, publishedAt:number|null, image:string|null, lang:string|null, country:string|null}>}
 */
export function parseGdeltArticles(json) {
  const arr = Array.isArray(json?.articles) ? json.articles : [];
  const seen = new Set();
  const out = [];
  for (const a of arr) {
    const url = typeof a?.url === 'string' ? a.url.trim() : '';
    const title = typeof a?.title === 'string' ? a.title.trim() : '';
    if (!/^https?:\/\//.test(url) || !title || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title,
      url,
      source: typeof a?.domain === 'string' ? a.domain : '',
      publishedAt: parseGdeltDate(a?.seendate),
      image: typeof a?.socialimage === 'string' && /^https?:\/\//.test(a.socialimage) ? a.socialimage : null,
      lang: typeof a?.language === 'string' ? a.language : null,
      country: typeof a?.sourcecountry === 'string' ? a.sourcecountry : null,
    });
  }
  out.sort((x, y) => (y.publishedAt || 0) - (x.publishedAt || 0));
  return out;
}

/** A direct article URL (usable for og:image unfurl / link-out) vs a Google-News redirect. Pure. */
export function isDirectNewsUrl(url) {
  try { return !/(?:^|\.)news\.google\.com$/i.test(new URL(String(url)).hostname); } catch { return false; }
}

/** Collapse-key for the same story across sources (drops a trailing " - Outlet"). */
function newsStoryKey(title) {
  return String(title || '').toLowerCase().replace(/\s+[-–—]\s+[^-–—]{2,42}$/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

/**
 * Merge news items from several sources into one deduped list. When the same
 * story appears more than once, keep the most useful copy — one that carries an
 * image beats one with a direct URL beats a bare Google-News redirect, then newer
 * wins. Newest first. Pure.
 * @param {Array<Array>} lists
 * @returns {Array}
 */
export function mergeNewsItems(lists) {
  const byKey = new Map();
  const score = (it) => (it?.image ? 2 : 0) + (isDirectNewsUrl(it?.url) ? 1 : 0);
  for (const list of (Array.isArray(lists) ? lists : [])) {
    for (const it of (Array.isArray(list) ? list : [])) {
      if (!it?.title || !it?.url) continue;
      const k = newsStoryKey(it.title);
      if (!k) continue;
      const prev = byKey.get(k);
      if (!prev
        || score(it) > score(prev)
        || (score(it) === score(prev) && (it.publishedAt || 0) > (prev.publishedAt || 0))) {
        byKey.set(k, it);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
}

/** Compact "how long ago" label via i18n keys situation.ago-*. */
export function relativeAge(publishedAt, nowMs, translate = (k) => k) {
  if (!Number.isFinite(publishedAt)) return '';
  const mins = Math.max(0, Math.round((nowMs - publishedAt) / 60_000));
  if (mins < 1) return translate('situation.now');
  if (mins < 60) return translate('situation.ago-m', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return translate('situation.ago-h', { n: hours });
  return translate('situation.ago-d', { n: Math.round(hours / 24) });
}

/**
 * Display model for the situation feed. Pure.
 * @param {{items?: any[], region?: string, fetchedAt?: number}|null} payload
 * @param {{translate?: (k:string,v?:object)=>string, nowMs?: number, limit?: number}} [o]
 */
export function buildSituationModel(payload, { translate = (k) => k, nowMs = Date.now(), limit = 30 } = {}) {
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .slice(0, limit)
    .map((it) => ({ ...it, ageLabel: relativeAge(it.publishedAt, nowMs, translate) }));
  return {
    ok: true,
    items,
    count: items.length,
    empty: items.length === 0,
    region: payload?.region || null,
    fetchedAt: payload?.fetchedAt ?? null,
  };
}

/**
 * Fetch a region's feed from the proxy. Proxy error = throw; 502/503 carries
 * `{error:'…'}`.
 * @param {string} region
 * @param {{fetcher?: typeof fetch, base?: string}} [o]
 */
export async function fetchSituationNews(region = 'gulf', { fetcher = (...a) => fetch(...a), base = SITUATION_NEWS_API } = {}) {
  const url = `${base}?region=${encodeURIComponent(region)}`;
  const response = await fetcher(url, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return json;
}
