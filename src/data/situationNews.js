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
 * Named regions → a GDELT query. Named (not free-text) so the client can never
 * inject an arbitrary GDELT query through the proxy.
 * @type {Readonly<Record<string, {id: string, query: string, timespan: string}>>}
 */
export const SITUATION_REGIONS = Object.freeze({
  gulf: Object.freeze({
    id: 'gulf',
    query: '"Strait of Hormuz" OR "Persian Gulf" OR "Gulf of Oman"',
    timespan: '3d',
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
