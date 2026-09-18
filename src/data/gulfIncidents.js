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
  Object.freeze({ name: 'Gulf of Oman', lat: 24.5, lon: 58.5, aliases: ['gulf of oman'] }),
  Object.freeze({ name: 'Strait of Hormuz', lat: 26.57, lon: 56.25, aliases: ['strait of hormuz', 'hormuz'] }),
  Object.freeze({ name: 'Persian Gulf', lat: 26.5, lon: 51.5, aliases: ['persian gulf', 'arabian gulf'] }),
]);

/** Default point for a region when no place is named (pilot: Hormuz). */
export const REGION_DEFAULT = Object.freeze({ gulf: Object.freeze({ name: 'Strait of Hormuz', lat: 26.57, lon: 56.25 }) });

/**
 * Classify a headline into an incident class, or null if it does not read like
 * one. Pure.
 * @param {string} text
 * @returns {{type:string, severity:'critical'|'major'|'minor'}|null}
 */
export function classifyIncident(text) {
  const s = String(text ?? '');
  for (const rule of INCIDENT_RULES) {
    if (rule.re.test(s)) return { type: rule.type, severity: rule.severity };
  }
  return null;
}

/**
 * First gazetteer place named in the text, else null. Pure.
 * @param {string} text
 * @param {ReadonlyArray} [gazetteer]
 * @returns {{name:string, lat:number, lon:number}|null}
 */
export function locateIncident(text, gazetteer = GULF_GAZETTEER) {
  const s = String(text ?? '').toLowerCase();
  for (const place of gazetteer) {
    if (place.aliases.some((a) => s.includes(a))) return { name: place.name, lat: place.lat, lon: place.lon };
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
export function buildIncidents(items, { region = 'gulf', gazetteer = GULF_GAZETTEER, limit = 40 } = {}) {
  const fallback = REGION_DEFAULT[region] || REGION_DEFAULT.gulf;
  const seen = new Set();
  const out = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    if (out.length >= limit) break;
    const cls = classifyIncident(it?.title);
    if (!cls) continue;
    const url = typeof it?.url === 'string' ? it.url : '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const loc = locateIncident(it.title, gazetteer);
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
export function buildIncidentCards(items, { region = 'gulf', gazetteer = GULF_GAZETTEER, limit = 6 } = {}) {
  const incidents = buildIncidents(items, { region, gazetteer, limit: 60 });
  const groups = new Map();
  for (const inc of incidents) {
    const locKey = `${inc.lat.toFixed(2)}|${inc.lon.toFixed(2)}`;
    let g = groups.get(locKey);
    if (!g) { g = { rep: inc, stories: new Set(), sources: new Set() }; groups.set(locKey, g); }
    g.stories.add(storyKey(inc.title));
    if (inc.source) g.sources.add(inc.source);
    const better = (SEVERITY_RANK[inc.severity] || 0) > (SEVERITY_RANK[g.rep.severity] || 0)
      || ((SEVERITY_RANK[inc.severity] || 0) === (SEVERITY_RANK[g.rep.severity] || 0)
        && (inc.publishedAt || 0) > (g.rep.publishedAt || 0));
    if (better) g.rep = inc;
  }
  const cards = [...groups.values()].map(({ rep, stories, sources }) => ({
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
    storyCount: Math.max(1, stories.size),
    sourceCount: Math.max(1, sources.size),
  }));
  cards.sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || ((b.publishedAt || 0) - (a.publishedAt || 0)));
  return cards.slice(0, Math.max(0, limit));
}
