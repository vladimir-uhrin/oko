// src/data/volcanoInfo.js
/**
 * @module volcanoInfo
 * @description Informácie pre kartu sopky (2026-09-05, „prerob aj informácie").
 *
 * NASA EONET o sopke vie málo: názov „Etna Volcano, Italy", jeden bod, dátum
 * hlásenia a odkaz na zdroj (Smithsonian GVP profil). Karta preto spája:
 *   • EONET — čo sa hlási a odkedy,
 *   • OpenStreetMap sidecar (ODbL) — výška, typ, stav, Wikipédia,
 *   • Wikipédiu — fotku so slobodnou licenciou (airportPhoto.js).
 * Smithsonian GVP sa NEbundluje (nekomerčné podmienky), len sa naň odkazuje.
 *
 * Čistý modul: žiadny fetch, žiadny DOM, všetko cez `translate`.
 */

/** Maximálna vzdialenosť bodu EONET od uzla OSM, aby sa brali ako tá istá sopka. */
export const VOLCANO_MATCH_MAX_KM = 25;
/** Bez zhody názvu sa najbližší uzol berie len do tejto vzdialenosti. */
export const VOLCANO_MATCH_NEAREST_KM = 8;

/** Čitateľné mená zdrojov EONET. */
export const VOLCANO_SOURCE_LABELS = Object.freeze({
  SIVolcano: 'Smithsonian GVP',
  EO: 'NASA Earth Observatory',
  CEMS: 'Copernicus EMS',
  GDACS: 'GDACS',
  ReliefWeb: 'ReliefWeb',
  IDC: 'IDC',
  NASA_DISP: 'NASA Disasters',
});

/** Typy sopiek z OSM → kľúč i18n `volcano.type.*` (neznámy typ ostáva surový). */
export const VOLCANO_TYPE_KEYS = Object.freeze({
  stratovolcano: 'stratovolcano', composite: 'stratovolcano', shield: 'shield', caldera: 'caldera',
  scoria_cone: 'cinder-cone', cinder_cone: 'cinder-cone', lava_dome: 'lava-dome', complex: 'complex',
  submarine: 'submarine', fissure_vent: 'fissure', maar: 'maar', tuff_cone: 'tuff-cone', tuff_ring: 'tuff-cone',
  volcanic_field: 'field', somma: 'somma', pyroclastic_cone: 'cinder-cone', lava_cone: 'lava-cone',
});

const DAY_MS = 86_400_000;

/** „Etna Volcano, Italy" → { name: 'Etna', country: 'Italy' }. Pure. */
export function parseEonetVolcanoTitle(title) {
  const raw = String(title || '').trim();
  if (!raw) return { name: '', country: '' };
  const [head, ...rest] = raw.split(',');
  const name = head.replace(/\s+volcano(es)?\s*$/i, '').trim() || head.trim();
  return { name, country: rest.join(',').trim() };
}

/** Bez diakritiky a interpunkcie, malé písmená. Pure. */
export function nameKey(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(volcano|volcan|vulkan|mount|mt|monte|mont|cerro|nevados?|de|del|la|el|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Veľkokružnicová vzdialenosť v km. Pure. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, R = 6371;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Index sidecaru: 1° mriežka pre lacné hľadanie okolia. Pure.
 * @param {Array<object>} volcanoes
 */
export function buildVolcanoIndex(volcanoes) {
  const cells = new Map();
  for (const v of Array.isArray(volcanoes) ? volcanoes : []) {
    if (!Number.isFinite(v?.lat) || !Number.isFinite(v?.lon)) continue;
    const key = `${Math.floor(v.lat)}:${Math.floor(v.lon)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(v);
  }
  return { cells, size: volcanoes?.length || 0 };
}

/**
 * Nájdi uzol OSM pre bod EONET: zhoda názvu do 25 km má prednosť, inak
 * najbližší do 8 km. Bez istoty null — nehádame. Pure.
 */
export function matchOsmVolcano(index, lat, lon, name) {
  if (!index?.cells || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const want = nameKey(name);
  const wantTokens = new Set(want.split(' ').filter((tok) => tok.length > 2));
  let best = null, bestScore = Infinity, nearest = null, nearestKm = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const bucket = index.cells.get(`${Math.floor(lat) + dy}:${Math.floor(lon) + dx}`);
    if (!bucket) continue;
    for (const v of bucket) {
      const km = distanceKm(lat, lon, v.lat, v.lon);
      if (km > VOLCANO_MATCH_MAX_KM) continue;
      if (km < nearestKm) { nearestKm = km; nearest = v; }
      const have = nameKey(`${v.name} ${v.localName || ''}`);
      const tokens = have.split(' ').filter((tok) => tok.length > 2);
      const overlap = tokens.some((tok) => wantTokens.has(tok));
      if (overlap && km < bestScore) { bestScore = km; best = v; }
    }
  }
  if (best) return { volcano: best, km: bestScore, byName: true };
  if (nearest && nearestKm <= VOLCANO_MATCH_NEAREST_KM) return { volcano: nearest, km: nearestKm, byName: false };
  return null;
}

/** URL článku z OSM tagu `lang:Title`. Pure. */
export function wikipediaUrlFromTag(tag) {
  const m = /^([a-z]{2,3}):(.+)$/.exec(String(tag || '').trim());
  if (!m) return null;
  return `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].trim().replace(/ /g, '_'))}`;
}

function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;
}

/** „pred 3 d" / „dnes". */
function agoLabel(ms, nowMs, translate) {
  const days = Math.floor((nowMs - ms) / DAY_MS);
  if (days <= 0) return translate('volcano.today');
  if (days < 60) return translate('volcano.days-ago', { n: days });
  return translate('volcano.months-ago', { n: Math.round(days / 30) });
}

/**
 * Model karty. Pure.
 * @param {object} event záznam vrstvy (id, title, lon, lat, time, firstTime?, reports?, sources, description)
 * @param {?object} osm zhoda zo sidecaru ({volcano, km, byName}) alebo null
 * @param {number} nowMs
 * @param {(key: string, vars?: object) => string} translate
 */
export function volcanoCardModel(event, osm, nowMs, translate) {
  if (!event) return null;
  const { name: eonetName, country } = parseEonetVolcanoTitle(event.title);
  const v = osm?.volcano || null;
  const name = v?.name || eonetName || String(event.title || '');
  const typeKey = v?.type ? VOLCANO_TYPE_KEYS[v.type] : null;
  const typeLabel = typeKey ? translate(`volcano.type.${typeKey}`) : (v?.type ? v.type.replace(/_/g, ' ') : '');
  const eleLabel = Number.isFinite(v?.eleM) ? `${v.eleM.toLocaleString('sk-SK').replace(/\s/g, ' ')} m` : '';
  const factsLine = [typeLabel, eleLabel, country].filter(Boolean).join(' · ');
  const knownStatus = ['active', 'dormant', 'extinct'].includes(v?.status) ? v.status : null;
  const statusLabel = knownStatus ? translate(`volcano.status.${knownStatus}`) : (v?.status || '');
  const first = Number.isFinite(event.firstTime) ? event.firstTime : event.time;
  const reports = Number.isFinite(event.reports) ? event.reports : 1;
  const activity = reports > 1
    ? translate('volcano.activity-since', { date: formatDate(first), ago: agoLabel(event.time, nowMs, translate), n: reports })
    : translate('volcano.reported-on', { date: formatDate(event.time), ago: agoLabel(event.time, nowMs, translate) });
  const links = [];
  for (const s of event.sources || []) {
    if (!/^https?:\/\//.test(s?.url || '')) continue;
    links.push({ key: s.id, label: VOLCANO_SOURCE_LABELS[s.id] || s.id || translate('volcano.source'), href: s.url });
  }
  if (v?.wikipedia) { const href = wikipediaUrlFromTag(v.wikipedia); if (href) links.push({ key: 'wikipedia', label: 'Wikipedia', href }); }
  if (event.id) links.push({ key: 'eonet', label: 'NASA EONET', href: `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(event.id)}` });
  return {
    title: name,
    localName: v?.localName && v.localName !== name ? v.localName : '',
    factsLine,
    statusLabel,
    activity,
    description: v?.description || event.description || '',
    coords: `${Number(event.lat).toFixed(3)}°, ${Number(event.lon).toFixed(3)}°`,
    matchNote: osm ? (osm.byName ? '' : translate('volcano.match-nearest', { km: Math.round(osm.km) })) : translate('volcano.no-osm'),
    links,
    wikipediaUrl: v?.wikipedia ? wikipediaUrlFromTag(v.wikipedia) : null,
    coverage: translate('volcano.coverage'),
  };
}
