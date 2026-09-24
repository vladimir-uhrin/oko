// src/data/gulfIncidents.js
/**
 * @module gulfIncidents
 * @description Phase B pilot (2026-09-18): turn open-source news items (from
 * situationNews.js / GDELT) into GEOLOCATED incident markers for the globe.
 * Classification is keyword-based on the HEADLINE, geolocation is a bundled
 * Gulf-region gazetteer (no external geocoder). GDELT's GEO endpoint 404s, so we
 * place a marker at the first gazetteer place named in the headline, else at the
 * region's default point.
 *
 * POCTIVOSŤ (rules 2 & 6 CLAUDE.md): a marker is a REPORTED, UNVERIFIED event
 * from open journalism, placed by the place NAMED in the headline (approximate),
 * and it LINKS OUT to the source. This models events/vessels/infrastructure, not
 * people — no faces, no individual tracking, no targeting. The client labels
 * every marker "reported · unverified" and never presents it as intelligence.
 * Pure module (no DOM).
 */

import { UKRAINE_GAZETTEER, UKRAINE_OBLASTS_EN, classifyUkraineIncident } from './ukraineIncidents.js';

/** Incident classes, in priority order. severity → marker colour on the client. */
const INCIDENT_RULES = [
  { type: 'strike', severity: 'critical', re: /\b(missile|drone|strike|struck|attack|attacked|shelling|torpedo|projectile|rocket)\b/i },
  { type: 'fire', severity: 'critical', re: /\b(explosion|explode[sd]?|blast|ablaze|on fire|caught fire|burning)\b/i },
  { type: 'seizure', severity: 'major', re: /\b(seiz(?:e|ed|ure)|detain(?:ed)?|boarded|captur(?:e|ed)|hijack(?:ed)?|impound(?:ed)?)\b/i },
  { type: 'blockade', severity: 'major', re: /\b(blockad(?:e|ed)|blocked|shut|closed|mine[sd]?|mined|threat(?:en|ens|ened)? to close)\b/i },
];

/**
 * Bundled Gulf-region gazetteer (place → coords). `aliases` are lowercase
 * substrings matched against the headline; ordered specific → broad so a named
 * port wins over "the Gulf". `[lat, lon]`.
 */
export const GULF_GAZETTEER = Object.freeze([
  Object.freeze({ name: 'Bandar Abbas', lat: 27.18, lon: 56.28, aliases: ['bandar abbas'] }),
  Object.freeze({ name: 'Fujairah', lat: 25.29, lon: 56.33, aliases: ['fujairah', 'fujeirah'] }),
  Object.freeze({ name: 'Khor Fakkan', lat: 25.34, lon: 56.35, aliases: ['khor fakkan'] }),
  Object.freeze({ name: 'Kharg Island', lat: 29.23, lon: 50.32, aliases: ['kharg'] }),
  Object.freeze({ name: 'Bushehr', lat: 28.92, lon: 50.84, aliases: ['bushehr', 'bushire'] }),
  Object.freeze({ name: 'Ras Tanura', lat: 26.7, lon: 50.16, aliases: ['ras tanura'] }),
  Object.freeze({ name: 'Jebel Ali', lat: 25.01, lon: 55.06, aliases: ['jebel ali'] }),
  Object.freeze({ name: 'Ras al-Khaimah', lat: 25.79, lon: 55.94, aliases: ['ras al-khaimah', 'ras al khaimah'] }),
  Object.freeze({ name: 'Dubai', lat: 25.2, lon: 55.27, aliases: ['dubai'] }),
  Object.freeze({ name: 'Abu Dhabi', lat: 24.47, lon: 54.37, aliases: ['abu dhabi'] }),
  Object.freeze({ name: 'Sharjah', lat: 25.35, lon: 55.4, aliases: ['sharjah'] }),
  Object.freeze({ name: 'Dammam', lat: 26.43, lon: 50.1, aliases: ['dammam'] }),
  Object.freeze({ name: 'Basra', lat: 30.5, lon: 47.8, aliases: ['basra', 'basrah'] }),
  Object.freeze({ name: 'Kuwait', lat: 29.37, lon: 47.98, aliases: ['kuwait'] }),
  Object.freeze({ name: 'Doha', lat: 25.29, lon: 51.53, aliases: ['doha', 'qatar'] }),
  Object.freeze({ name: 'Manama', lat: 26.23, lon: 50.58, aliases: ['manama', 'bahrain'] }),
  Object.freeze({ name: 'Muscat', lat: 23.6, lon: 58.55, aliases: ['muscat'] }),
  // Wider Middle East conflict (2026-09-18) — Red Sea / Yemen / Horn, Suez, Levant, Iran/Iraq.
  Object.freeze({ name: 'Aden', lat: 12.79, lon: 45.03, aliases: ['aden'] }),
  Object.freeze({ name: 'Hodeidah', lat: 14.8, lon: 42.95, aliases: ['hodeidah', 'hudaydah', 'al hudaydah'] }),
  Object.freeze({ name: 'Mokha', lat: 13.32, lon: 43.25, aliases: ['mokha', 'mocha'] }),
  Object.freeze({ name: "Sana'a", lat: 15.35, lon: 44.2, aliases: ['sanaa', "sana'a"] }),
  Object.freeze({ name: 'Djibouti', lat: 11.6, lon: 43.15, aliases: ['djibouti'] }),
  Object.freeze({ name: 'Port Said', lat: 31.26, lon: 32.3, aliases: ['port said'] }),
  Object.freeze({ name: 'Ismailia', lat: 30.59, lon: 32.27, aliases: ['ismailia'] }),
  Object.freeze({ name: 'Suez', lat: 29.97, lon: 32.55, aliases: ['suez canal', 'suez'] }),
  Object.freeze({ name: 'Eilat', lat: 29.56, lon: 34.95, aliases: ['eilat'] }),
  Object.freeze({ name: 'Gaza', lat: 31.5, lon: 34.47, aliases: ['gaza'] }),
  Object.freeze({ name: 'Ashkelon', lat: 31.67, lon: 34.57, aliases: ['ashkelon'] }),
  Object.freeze({ name: 'Tel Aviv', lat: 32.08, lon: 34.78, aliases: ['tel aviv'] }),
  Object.freeze({ name: 'Haifa', lat: 32.82, lon: 34.99, aliases: ['haifa'] }),
  Object.freeze({ name: 'Jerusalem', lat: 31.78, lon: 35.22, aliases: ['jerusalem'] }),
  Object.freeze({ name: 'Beirut', lat: 33.89, lon: 35.5, aliases: ['beirut'] }),
  Object.freeze({ name: 'Damascus', lat: 33.51, lon: 36.29, aliases: ['damascus'] }),
  Object.freeze({ name: 'Tehran', lat: 35.69, lon: 51.39, aliases: ['tehran'] }),
  Object.freeze({ name: 'Isfahan', lat: 32.65, lon: 51.67, aliases: ['isfahan', 'esfahan'] }),
  Object.freeze({ name: 'Natanz', lat: 33.72, lon: 51.9, aliases: ['natanz'] }),
  Object.freeze({ name: 'Baghdad', lat: 33.31, lon: 44.36, aliases: ['baghdad'] }),
  // Broad chokepoints / seas last (specific places above win).
  Object.freeze({ name: 'Gulf of Oman', lat: 24.5, lon: 58.5, aliases: ['gulf of oman'] }),
  Object.freeze({ name: 'Strait of Hormuz', lat: 26.57, lon: 56.25, aliases: ['strait of hormuz', 'hormuz'] }),
  Object.freeze({ name: 'Persian Gulf', lat: 26.5, lon: 51.5, aliases: ['persian gulf', 'arabian gulf'] }),
  Object.freeze({ name: 'Bab-el-Mandeb', lat: 12.6, lon: 43.4, aliases: ['bab-el-mandeb', 'bab el-mandeb', 'bab al-mandab', 'mandeb'] }),
  Object.freeze({ name: 'Gulf of Aden', lat: 12.5, lon: 47.0, aliases: ['gulf of aden'] }),
  Object.freeze({ name: 'Red Sea', lat: 20.0, lon: 38.0, aliases: ['red sea'] }),
  // Broad country fallbacks LAST (a specific city/sea above always wins) — so a
  // mention geolocates to the country, not the region default.
  Object.freeze({ name: 'Iran', lat: 32.4, lon: 53.7, aliases: ['iran', 'iranian'] }),
  Object.freeze({ name: 'Israel', lat: 31.4, lon: 35.0, aliases: ['israel', 'israeli'] }),
  Object.freeze({ name: 'Yemen', lat: 15.5, lon: 44.2, aliases: ['yemen', 'yemeni', 'houthi'] }),
  Object.freeze({ name: 'Lebanon', lat: 33.9, lon: 35.5, aliases: ['lebanon', 'lebanese', 'hezbollah'] }),
  Object.freeze({ name: 'Iraq', lat: 33.2, lon: 43.7, aliases: ['iraq', 'iraqi'] }),
  Object.freeze({ name: 'Egypt', lat: 26.8, lon: 30.8, aliases: ['egypt', 'egyptian'] }),
]);

/**
 * Default point for a region when no place is named (pilot: Hormuz). `null`
 * (ukraine, 2026-09-19) = an unlocated item gets NO marker: a card „somewhere
 * in Ukraine" would be noise, not information.
 */
export const REGION_DEFAULT = Object.freeze({
  gulf: Object.freeze({ name: 'Strait of Hormuz', lat: 26.57, lon: 56.25 }),
  mideast: Object.freeze({ name: 'Red Sea', lat: 20.0, lon: 38.0 }),
  ukraine: null,
});

/** Gazetteer for a region (ukraine has its own; everything else the Gulf/Middle East one). Pure. */
export function gazetteerForRegion(region) {
  return region === 'ukraine' ? UKRAINE_GAZETTEER : GULF_GAZETTEER;
}

/** Region default point, or null when the region says „no marker without a place". */
export function regionDefaultFor(region) {
  return Object.prototype.hasOwnProperty.call(REGION_DEFAULT, region) ? REGION_DEFAULT[region] : REGION_DEFAULT.gulf;
}

/**
 * Classify a headline into an incident class, or null if it does not read like
 * one. The ukraine region has its own rule set (ground fighting, air defence,
 * infrastructure with an action word — see ukraineIncidents.js). Pure.
 * @param {string} text
 * @param {{region?: string}} [o]
 * @returns {{type:string, severity:'critical'|'major'|'minor'}|null}
 */
export function classifyIncident(text, { region = 'gulf' } = {}) {
  if (region === 'ukraine') return classifyUkraineIncident(text);
  const s = String(text ?? '');
  for (const rule of INCIDENT_RULES) {
    if (rule.re.test(s)) return { type: rule.type, severity: rule.severity };
  }
  return null;
}

/**
 * First gazetteer place named in the text, else null. Pure.
 *
 * For the Ukraine gazetteer (2026-09-24) matching is STRICT, because plain
 * substrings put namesakes hundreds of km off („drones near Nova Borova,
 * Zhytomyr region" → Borova in Kharkiv oblast): whole words only (an English
 * plural/possessive is allowed), an alias preceded by a place-name adjective
 * (Nova/Stara/Velyka/Mala…) is a different place and is skipped, and when an
 * oblast that really qualifies the place — a header right before it („Zhytomyr
 * region: …", „… region — …", „In the X region, …") or „in/of (the) X region" /
 * „(X Oblast)" right after it, never across a sentence, dash or line break —
 * lies more than 250 km away, the place is a namesake and the oblast is
 * returned (approx). Oblast centres (Kyiv, Kharkiv, Odesa…) are never demoted.
 * The Gulf gazetteer keeps plain substring matching.
 * @param {string} text
 * @param {ReadonlyArray} [gazetteer]
 * @returns {{name:string, lat:number, lon:number, approx?:boolean}|null}
 */
export function locateIncident(text, gazetteer = GULF_GAZETTEER) {
  const s = String(text ?? '').toLowerCase();
  if (gazetteer === UKRAINE_GAZETTEER) return locateStrict(s, gazetteer);
  for (const place of gazetteer) {
    if (place.aliases.some((a) => s.includes(a))) return { name: place.name, lat: place.lat, lon: place.lon };
  }
  return null;
}

const EN_ADJ_BEFORE_RE = /(?:^|[^a-z])(?:nova|novo|novyi|nove|stara|staryi|stare|velyka|velykyi|velyke|mala|malyi|male|verkhnia|verkhnii|nyzhnia|nyzhnii|bila|bilyi|chervona|chervonyi|zelena|zelenyi)\s+$/;
const EN_OBLAST_RE = /([a-z][a-z-]+)\s+(?:region|oblast|province)(?![a-z])/g;
const EN_BREAK_RE = /[.!?;|\n–—]/;
/** Krajské mestá — ich menovec nie je dôvod premiestniť správu do inej oblasti. */
const EN_OBLAST_CENTRES = new Set(['Kyiv', 'Kharkiv', 'Odesa', 'Lviv', 'Dnipro', 'Zaporizhzhia', 'Mykolaiv', 'Kherson', 'Sumy', 'Chernihiv', 'Poltava', 'Zhytomyr', 'Vinnytsia', 'Cherkasy', 'Kropyvnytskyi', 'Khmelnytskyi', 'Ternopil', 'Rivne', 'Lutsk', 'Ivano-Frankivsk', 'Uzhhorod', 'Chernivtsi', 'Donetsk', 'Luhansk']);
const EN_FROM_TOWARD_RE = /(?:^|[^a-z])(?:from|toward|towards|to|into|heading for)\s+(?:the\s+)?$/;
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const enAliasRe = new Map();
/** Prvý výskyt aliasu ako celého slova, ktorý nepredchádza prídavné meno sídla; [start, end] alebo null. */
function findAlias(s, alias) {
  let re = enAliasRe.get(alias);
  if (!re) { re = new RegExp(`(?<![a-z])${escapeRe(alias)}(?:'s|s)?(?![a-z])`, 'g'); enAliasRe.set(alias, re); }
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(s))) {
    if (!EN_ADJ_BEFORE_RE.test(s.slice(Math.max(0, m.index - 16), m.index))) return [m.index, m.index + m[0].length];
  }
  return null;
}
const kmBetweenEn = (a, b) => { const dy = (b.lat - a.lat) * 111.32; const dx = (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180); return Math.hypot(dx, dy); };
function locateStrict(s, gazetteer) {
  const oblasts = [];
  EN_OBLAST_RE.lastIndex = 0;
  let om;
  while ((om = EN_OBLAST_RE.exec(s))) {
    const key = om[1].replace(/^the-?/, '');
    const hit = UKRAINE_OBLASTS_EN[key];
    if (hit) oblasts.push({ ...hit, at: om.index, end: om.index + om[0].length });
  }
  for (const place of gazetteer) {
    let span = null;
    for (const alias of place.aliases) {
      const sp = findAlias(s, alias);
      if (sp && (!span || sp[0] < span[0])) span = sp;
    }
    if (!span) continue;
    const loc = { name: place.name, lat: place.lat, lon: place.lon };
    if (/Oblast$/.test(place.name) || !oblasts.length || EN_OBLAST_CENTRES.has(place.name)) return loc;
    const [at, end] = span;
    // Pred sídlom len nadpis („Zhytomyr region: …", „… region — …") alebo „In the X region, …".
    const before = oblasts.filter((o) => {
      if (o.end > at || at - o.end > 60 || EN_FROM_TOWARD_RE.test(s.slice(Math.max(0, o.at - 16), o.at))) return false;
      const header = /^[ \t]*[:–—-]/.exec(s.slice(o.end, at));
      const inPhrase = /(?:^|[^a-z])in\s+(?:the\s+)?$/.test(s.slice(Math.max(0, o.at - 8), o.at)) && /^[ \t]*,/.test(s.slice(o.end, at));
      if (!header && !inPhrase) return false;
      const gap = s.slice(o.end, at).replace(/^[ \t]*[:–—,-]/, '');
      return !EN_BREAK_RE.test(gap);
    }).at(-1);
    // Za sídlom len „in (the) X region", „of X region" alebo „(X Oblast)" — nie holá čiarka, „and" ani nový riadok.
    const after = oblasts.find((o) => o.at >= end && /^[ \t]*(?:(?:in|of)[ \t]+(?:the[ \t]+)?|\([ \t]*)$/.test(s.slice(end, o.at)));
    const hints = [before, after].filter(Boolean);
    if (!hints.length || hints.some((h) => kmBetweenEn(h, place) <= 250)) return loc;
    const h = hints[0];
    return { name: h.name, lat: h.lat, lon: h.lon, approx: true };
  }
  return null;
}

/**
 * News items → geolocated incident markers (only items that classify as an
 * incident). Deduped by url. Pure.
 * @param {Array<{title?:string,url?:string,source?:string,publishedAt?:number}>} items
 * @param {{region?:string, gazetteer?:ReadonlyArray, limit?:number}} [o]
 * @returns {Array<{lat:number, lon:number, place:string, approx:boolean, type:string, severity:string, title:string, url:string, source:string, publishedAt:number|null}>}
 */
export function buildIncidents(items, { region = 'gulf', gazetteer = gazetteerForRegion(region), limit = 40 } = {}) {
  const fallback = regionDefaultFor(region);
  const seen = new Set();
  const out = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    if (out.length >= limit) break;
    const cls = classifyIncident(it?.title, { region });
    if (!cls) continue;
    const url = typeof it?.url === 'string' ? it.url : '';
    if (!url || seen.has(url)) continue;
    const loc = locateIncident(it.title, gazetteer);
    if (!loc && !fallback) continue; // región bez predvoleného bodu: bez miesta bez karty
    seen.add(url);
    out.push({
      lat: loc ? loc.lat : fallback.lat,
      lon: loc ? loc.lon : fallback.lon,
      place: loc ? loc.name : fallback.name,
      approx: !loc, // true when we fell back to the region default
      type: cls.type,
      severity: cls.severity,
      title: String(it.title),
      url,
      source: typeof it?.source === 'string' ? it.source : '',
      publishedAt: Number.isFinite(it?.publishedAt) ? it.publishedAt : null,
      image: typeof it?.image === 'string' && /^https?:\/\//.test(it.image) ? it.image : null,
      noImage: Boolean(it?.noImage),
      badge: typeof it?.badge === 'string' ? it.badge : null,
    });
  }
  return out;
}

const SEVERITY_RANK = Object.freeze({ critical: 3, major: 2, minor: 1 });

/**
 * Strip a trailing " - Outlet" / " — Outlet" that Google News RSS appends to a
 * headline, so the card shows the story, not the publisher (shown separately).
 * Falls back to the raw title if stripping would empty it. Pure.
 * @param {string} title
 * @returns {string}
 */
export function cleanHeadline(title) {
  const raw = String(title ?? '').trim();
  const stripped = raw.replace(/\s+[-–—]\s+[^-–—]{2,42}$/, '').trim();
  return stripped || raw;
}

/** Collapse-key for the same story reported by many outlets. */
function storyKey(title) {
  return cleanHeadline(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

const VIDEO_HOST = /(?:^|\.)(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|rumble\.com|bitchute\.com)$/i;
const VIDEO_PATH = /\/(?:video|watch)s?(?:\/|$|\?)/i;

/** True when the link points at a video (known host, or a /video//watch path). The
 *  card shows a ▶ badge and links out — video is never embedded. Pure. */
export function isVideoUrl(url) {
  try { const u = new URL(String(url)); return VIDEO_HOST.test(u.hostname) || VIDEO_PATH.test(u.pathname); } catch { return false; }
}

/**
 * Incidents → "hot card" models: ONE card per PLACE (so cards sit anchored on the
 * spot they concern instead of fanning into a detached column when many reports
 * share the strait). The card carries the most-severe / newest story at that place,
 * plus `storyCount` (distinct stories there) and `sourceCount` (outlets), ordered
 * most-severe then newest, capped to `limit`. Pure.
 * @param {Array} items open-source news items (situationNews shape)
 * @param {{region?:string, gazetteer?:ReadonlyArray, limit?:number}} [o]
 * @returns {Array<{lat:number, lon:number, place:string, approx:boolean, type:string, severity:string, title:string, url:string, source:string, publishedAt:number|null, storyCount:number, sourceCount:number}>}
 */
export function buildIncidentCards(items, { region = 'gulf', gazetteer = gazetteerForRegion(region), limit = 6 } = {}) {
  const incidents = buildIncidents(items, { region, gazetteer, limit: 60 });
  const groups = new Map();
  for (const inc of incidents) {
    const locKey = `${inc.lat.toFixed(2)}|${inc.lon.toFixed(2)}`;
    let g = groups.get(locKey);
    if (!g) { g = { rep: inc, stories: new Set(), sources: new Set(), image: null }; groups.set(locKey, g); }
    g.stories.add(storyKey(inc.title));
    if (inc.source) g.sources.add(inc.source);
    if (!g.image && inc.image) g.image = inc.image; // first available preview image at this place
    const better = (SEVERITY_RANK[inc.severity] || 0) > (SEVERITY_RANK[g.rep.severity] || 0)
      || ((SEVERITY_RANK[inc.severity] || 0) === (SEVERITY_RANK[g.rep.severity] || 0)
        && (inc.publishedAt || 0) > (g.rep.publishedAt || 0));
    if (better) g.rep = inc;
  }
  const cards = [...groups.values()].map(({ rep, stories, sources, image }) => ({
    lat: rep.lat,
    lon: rep.lon,
    place: rep.place,
    approx: rep.approx,
    type: rep.type,
    severity: rep.severity,
    title: cleanHeadline(rep.title),
    url: rep.url,
    source: rep.source,
    publishedAt: rep.publishedAt,
    image: rep.image || image || null,
    noImage: Boolean(rep.noImage),
    badge: rep.badge || null,
    isVideo: isVideoUrl(rep.url),
    storyCount: Math.max(1, stories.size),
    sourceCount: Math.max(1, sources.size),
  }));
  cards.sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || ((b.publishedAt || 0) - (a.publishedAt || 0)));
  return cards.slice(0, Math.max(0, limit));
}
