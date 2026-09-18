// src/translate.js
//
// Client helper: machine-translate short text (news headlines) via the server-side
// MyMemory proxy (free, keyless — see translateProxy in vite.config.js). Results
// are cached per (to|text) because a headline's translation is stable, and
// identical in-flight requests are shared. It never blocks the UI: callers render
// the original text and swap in the translation when it resolves, and any failure
// falls back to the original. Machine translations must be labelled as such by the
// caller (rule 2: be honest about what is estimated).

const TRANSLATE_API = '/api/translate';
const cache = new Map(); // `${to}|${text}` -> translated string
const inFlight = new Map(); // key -> Promise<string>

/** Stable cache key for a (text, target-language) pair. */
export function translateCacheKey(text, to) { return `${to}|${String(text)}`; }

/**
 * Translate `text` into `to` (e.g. 'sk'). Returns the original on empty input or
 * any failure. Cached + de-duplicated.
 * @param {string} text
 * @param {string} to
 * @param {{fetcher?: typeof fetch, base?: string}} [o]
 * @returns {Promise<string>}
 */
export async function translateText(text, to, { fetcher = (...a) => fetch(...a), base = TRANSLATE_API } = {}) {
  const src = String(text || '').trim();
  if (!src || !to) return src;
  const key = translateCacheKey(src, to);
  if (cache.has(key)) return cache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);
  const p = Promise.resolve(fetcher(`${base}?to=${encodeURIComponent(to)}&text=${encodeURIComponent(src)}`, { cache: 'no-store' }))
    .then((r) => (r && r.ok ? r.json() : null))
    .then((j) => {
      const out = j && typeof j.text === 'string' && j.text.trim() ? j.text : src;
      cache.set(key, out);
      return out;
    })
    .catch(() => src)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** TEST seam. */
export function _clearTranslateCache() { cache.clear(); inFlight.clear(); }
