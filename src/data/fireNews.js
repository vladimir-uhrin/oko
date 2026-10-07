/**
 * Správy a história k ohnisku FIRMS — čisté funkcie (2026-10-06, vlastník: „karty prepojené na
 * externý zdroj, ktorý potvrdí udalosť fotkou a textom z médií, ako na Ukrajine a Blízkom
 * východe; vždy prepojené s médiami, aby sa to dalo ďalej spracovať; história požiarov na disk“).
 *
 * Dopyty robí proxy v vite.config.js (`/api/firms/news`, `/api/firms/history`); tu je len
 * tvar dopytu GDELT, verdikt dôveryhodnosti (rovnaký zoznam médií ako Udalosti:
 * local_data/events/trusted-news.json, ≥ 2 rôzne dôveryhodné domény = potvrdené) a štatistika
 * z uložených detekcií.
 */
import { trustedDomainOf } from './eventNews.js';

/** Slová udalosti do dopytu GDELT (hľadá v texte článkov; GDELT indexuje všetky jazyky, slová sú anglické). */
export const FIRE_TERMS = Object.freeze(['fire', 'wildfire', 'blaze', 'explosion', 'burning', 'smoke']);
/** Správy staršie než toto okno sa k ohnisku nerátajú (RSS vracia aj mesiace staré články). */
export const FIRE_NEWS_WINDOW_MS = 3 * 86_400_000;
/** Potvrdené správami = aspoň toľko rôznych dôveryhodných domén. */
export const FIRE_NEWS_MIN_TRUSTED = 2;
/** Mriežka cache dopytov (°): to isté mesto pre všetky ohniská v okolí. */
export const FIRE_NEWS_CELL_DEG = 0.1;

const clean = (s) => String(s || '').replace(/["\\()]/g, ' ').replace(/\s+/g, ' ').trim()
  // Nominatim vracia správne celky („Staromlynivka Rural Hromada“, „… Municipality“) — médiá píšu len meno.
  .replace(/\s+(?:(?:rural|urban|settlement|city)\s+)?(?:hromada|municipality|community|council|district|raion|rayon|county)$/i, '').trim();

/**
 * Dopyt GDELT DOC pre miesto (Nominatim: locality/region/country): „"Sochi" (fire OR …)“.
 * Bez mesta sa pýta na región; bez ničoho null (svetový dopyt by bol šum).
 * @param {{locality?: string|null, region?: string|null, country?: string|null}|null} place
 * @returns {string|null}
 */
export function fireNewsQuery(place) {
  const name = clean(place?.locality) || clean(place?.region);
  if (!name) return null;
  const terms = FIRE_TERMS.join(' OR ');
  const country = clean(place?.country);
  // Mesto + štát spresní bežné mená (Sochi, Richmond…); krátke mená sa bez štátu nehľadajú.
  return country && country !== name ? `"${name}" "${country}" (${terms})` : `"${name}" (${terms})`;
}

/** Najďalej toto (km) od ohniska sa hľadá mesto, keď Nominatim nevráti obec (more, púšť). */
export const FIRE_NEAREST_PLACE_KM = 80;

/**
 * Najbližšie mesto zo zoznamu Natural Earth (local_data/natural_earth/places.json: [meno, lat, lon,
 * tisíce obyv., …]). Na mori Nominatim vráti len kraj aj pre body v okolí (tanker pri Soči 2026-10-06:
 * „Krasnodar Krai“ / „Abkhazia“) — dopyt na kraj nenašiel nič, na mesto Soči 16 čerstvých správ.
 * @returns {{name: string, km: number}|null} Pure.
 */
export function nearestPlace(places, lat, lon, maxKm = FIRE_NEAREST_PLACE_KM) {
  let best = null;
  for (const p of Array.isArray(places) ? places : []) {
    if (!Array.isArray(p) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) continue;
    if (Math.abs(p[1] - lat) > maxKm / 100) continue;
    const km = fastKm(lat, lon, p[1], p[2]);
    if (km <= maxKm && (!best || km < best.km)) best = { name: String(p[0]), km };
  }
  return best ? { name: best.name, km: Math.round(best.km) } : null;
}

/** Kľúč cache pre polohu (0,1° ≈ 11 km). Pure. */
export function fireNewsCellKey(lat, lon) {
  return `${(Math.round(lat / FIRE_NEWS_CELL_DEG) * FIRE_NEWS_CELL_DEG).toFixed(1)}:${(Math.round(lon / FIRE_NEWS_CELL_DEG) * FIRE_NEWS_CELL_DEG).toFixed(1)}`;
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Spomína titulok miesto? Porovnáva sa začiatok mena (5 znakov, bez diakritiky — aj pády: Košice/Košiciach) — „Sochi“ aj
 * „Sochi's“, „Novorossiysk“ aj „Novorossiysk-based“. Bez mena true (nie je čím filtrovať). Pure.
 */
export function titleMentionsPlace(title, placeName) {
  const name = fold(placeName).replace(/[^a-z0-9 ]+/g, ' ').trim();
  if (!name) return true;
  const stem = name.split(' ')[0].slice(0, 5);
  return stem.length >= 3 && fold(title).includes(stem);
}

/**
 * Články + zoznam dôveryhodných domén → verdikt. Článok dostane `trusted` (doména zo zoznamu)
 * a `local` (titulok spomína miesto). Potvrdené = aspoň FIRE_NEWS_MIN_TRUSTED rôznych dôveryhodných
 * domén MEDZI článkami o mieste (2026-10-06: dopyt na Soči vrátil aj liveuamap o Sumách a Chersone —
 * také sa nerátajú a idú na koniec). Pure.
 * @param {Array<{source?: string, url?: string, title?: string}>} articles
 * @param {string[]} trusted
 * @param {number} [nowMs]
 * @param {string|null} [placeName]
 */
export function fireNewsVerdict(articles, trusted, nowMs = Date.now(), placeName = null) {
  const domains = new Set();
  const fresh = (Array.isArray(articles) ? articles : []).filter((a) => !Number.isFinite(a?.publishedAt) || nowMs - a.publishedAt <= FIRE_NEWS_WINDOW_MS);
  const items = fresh.map((a) => {
    let host = String(a?.source || '');
    if (!host && a?.url) { try { host = new URL(a.url).hostname; } catch { host = ''; } }
    const t = trustedDomainOf(host, trusted);
    const local = titleMentionsPlace(a?.title, placeName);
    if (t && local) domains.add(t);
    return { ...a, trusted: t, local };
  });
  // O mieste prvé, z nich dôveryhodné, potom s obrázkom, potom novšie.
  const score = (i) => (i.local ? 4 : 0) + (i.trusted ? 2 : 0) + (i.image ? 1 : 0);
  items.sort((x, y) => score(y) - score(x) || (y.publishedAt || 0) - (x.publishedAt || 0));
  return { items, trustedDomains: [...domains], confirmed: domains.size >= FIRE_NEWS_MIN_TRUSTED };
}

/** Identita detekcie pre históriu (poloha na 4 desatinné, čas, družica). Pure. */
export function fireHistoryKey(f) {
  return `${Number(f.lat).toFixed(4)}:${Number(f.lon).toFixed(4)}:${f.acqDate}:${f.acqTime}:${f.satellite || ''}`;
}

/** Deň (UTC) detekcie pre názov denného súboru. */
export function fireHistoryDay(f) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(f?.acqDate || '')) ? f.acqDate : null;
}

/** Zoznam dní (UTC, YYYY-MM-DD) od dnes späť. Pure. */
export function fireHistoryDays(nowMs, days) {
  const out = [];
  for (let i = 0; i < days; i += 1) out.push(new Date(nowMs - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Rýchla vzdialenosť v km. */
export function fastKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Štatistika uložených detekcií okolo miesta: odkedy horí, koľko detekcií, koľko preletov
 * (rôzne časy), najvyššie FRP, posledná. `acqMs` dopĺňa volajúci. Pure.
 * @param {Array<{acqMs:number, frp:number, satellite?:string, geo?:boolean}>} detections
 */
export function fireHistoryStats(detections) {
  const list = (Array.isArray(detections) ? detections : []).filter((d) => Number.isFinite(d?.acqMs));
  if (!list.length) return { count: 0, passes: 0, firstMs: null, lastMs: null, maxFrp: 0, satellites: [] };
  const passes = new Set();
  const sats = new Set();
  let firstMs = Infinity; let lastMs = -Infinity; let maxFrp = 0;
  for (const d of list) {
    passes.add(Math.round(d.acqMs / 600_000)); // ten istý prelet = rovnakých 10 min
    if (d.satellite) sats.add(d.satellite);
    firstMs = Math.min(firstMs, d.acqMs);
    lastMs = Math.max(lastMs, d.acqMs);
    maxFrp = Math.max(maxFrp, Number(d.frp) || 0);
  }
  return { count: list.length, passes: passes.size, firstMs, lastMs, maxFrp, satellites: [...sats] };
}

const xmlText = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
const xmlTag = (item, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(item); return m ? xmlText(m[1]) : ''; };

/**
 * Bing News RSS (`bing.com/news/search?q=…&format=rss`) → články (2026-10-06). Bing dáva priamy
 * odkaz na článok (parameter `url` v apiclick) a náhľad (`News:Image`, bing.com/th) — Google News
 * RSS má len presmerovania bez obrázka, GDELT býva z tejto IP na limite. Pure.
 * @param {string} xml
 * @returns {Array<{title:string, url:string, source:string, sourceName:string, publishedAt:number|null, image:string|null}>}
 */
export function parseBingNewsRss(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = m[1];
    const title = xmlTag(item, 'title');
    const link = xmlTag(item, 'link');
    let url = link;
    try { const u = new URL(link); if (/bing\.com$/i.test(u.hostname) && u.searchParams.get('url')) url = u.searchParams.get('url'); } catch { continue; }
    let host = '';
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) continue; host = u.hostname.replace(/^www\./, ''); } catch { continue; }
    if (!title || /bing\.com$/i.test(host)) continue;
    const img = xmlTag(item, 'News:Image');
    out.push({
      title,
      url,
      source: host,
      sourceName: xmlTag(item, 'News:Source'),
      // pubDate z Bing RSS NESEDÍ (2026-10-06: článok Maritime Executive 19:10 UTC, Bing hlásil 08:11 GMT) —
      // vek by klamal; čerstvosť stráži filter dopytu (posledných 24 h), dátum sa nezobrazí.
      publishedAt: null,
      image: /^https?:\/\//.test(img) ? img.replace(/^http:/, 'https:') : null,
    });
  }
  return out;
}

/** URL Bing News RSS pre dopyt (posledných 24 h, 30 výsledkov). Pure. */
export function bingNewsUrl(query) {
  return `https://www.bing.com/news/search?${new URLSearchParams({ q: query, format: 'rss', count: '30', qft: 'interval="7"', setlang: 'en-US', cc: 'US' })}`;
}
