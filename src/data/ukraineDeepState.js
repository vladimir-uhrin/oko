// src/data/ukraineDeepState.js
/**
 * @module ukraineDeepState
 * @description DeepStateMap.live — snímka API `/api/history/last` → čistý model
 * pre vrstvu a archív (etapa 4A predbežne, 2026-09-19; používateľ: „OKO nie je
 * biznis, ale hobby pre mňa a môj FB profil — pridaj zatiaľ všetko, čo vieš,
 * a požiadame DeepState o súhlas"). Používa sa NEKOMERČNE, jedným dopytom za
 * hodinu s poctivým User-Agentom; história `/api/history` je za autorizáciou,
 * preto si dni archivujeme sami od prvého behu.
 *
 * Názvy prvkov nesú trojitú lomku „<uk> /// <en> /// geoJSON.<skupina>.<kľúč>":
 *  - polygóny `status.occupied` (okupované), `status.unknown` (šedá zóna),
 *    `status.dismissed` / `dismissed_at` (oslobodené / nedávno oslobodené),
 *    `territories.crimea|ordlo|tuzla` (dlhodobo okupované od 2014);
 *  - body `status.attack_direction` (smery útokov), `airfield/airbase/airport.*`
 *    (letiská RU/BY — objekty);
 *  - VYNECHANÉ: `units.*` a „Місця зосереджень…" (jednotky — etická čiara projektu:
 *    objekty a infraštruktúra, nikdy jednotky), `territories.*` mimo Ukrajiny
 *    (Abcházsko, Podnestersko, „Východné Prusko", Karélia… — cudzie konflikty a
 *    politické komentáre mapy), hlavné mestá, neoznačené prvky.
 * Symbolika je vlastná (licencia zakazuje „identické objekty"). Čistý modul.
 *
 * Druhý zdroj (24. 9. 2026, rozhodnutie vlastníka): denný súbor GitHub mirroru
 * cyterat/deepstate-map-data → `deepstateSnapshotFromMirror` (verejná doména
 * a dni mimo nášho archívu). Nesie len okupované územie, `source: 'mirror'`.
 */

export const DEEPSTATE_LAST_URL = 'https://deepstatemap.live/api/history/last';
export const DEEPSTATE_ATTRIBUTION = 'DeepStateMap.live';
export const DEEPSTATE_KINDS = Object.freeze(['occupied', 'grey', 'liberated', 'liberated-recent', 'crimea', 'ordlo', 'tuzla', 'attack', 'airfield']);
/** Farby OKO (nie DeepState): okupované tehlová, šedá zóna sivá, oslobodené modrá, smery jantár. */
export const DEEPSTATE_COLORS = Object.freeze({
  occupied: '#e0553f', grey: '#b8b2aa', liberated: '#4fa3ff', 'liberated-recent': '#7cc4ff', crimea: '#c9503c', ordlo: '#c9503c', tuzla: '#c9503c', attack: '#ffb547', airfield: '#d9a066',
});
export const DEEPSTATE_FILL_ALPHA = Object.freeze({ occupied: 0.28, grey: 0.32, liberated: 0.14, 'liberated-recent': 0.26, crimea: 0.16, ordlo: 0.16, tuzla: 0.16 });

/** „uk /// en /// geoJSON.status.occupied" → { uk, en, group, key }. Pure. */
export function parseDeepStateName(name) {
  const parts = String(name ?? '').split('///').map((s) => s.replace(/\s+/g, ' ').trim());
  const tag = /geoJSON\.([a-z]+)\.([a-z_#0-9-]+)/i.exec(parts[parts.length - 1] || '');
  const uk = parts[0] && !/geoJSON\./.test(parts[0]) ? parts[0] : null;
  const en = parts.length > 1 && !/geoJSON\./.test(parts[1]) ? parts[1] : null;
  return { uk, en, group: tag ? tag[1].toLowerCase() : null, key: tag ? tag[2].toLowerCase() : null };
}

/** Skupina + kľúč → druh vrstvy alebo null (vynechať). Pure. */
export function deepstateKind(group, key, geometryType) {
  if (!group || !key) return null;
  if (group === 'units') return null;
  if (group === 'status') {
    if (key === 'occupied') return 'occupied';
    if (key === 'unknown') return 'grey';
    if (key === 'dismissed') return 'liberated';
    if (key === 'dismissed_at') return 'liberated-recent';
    if (key === 'attack_direction' || key === 'at') return geometryType === 'Point' ? 'attack' : null;
    return null;
  }
  if (group === 'territories') {
    if (key === 'crimea') return 'crimea';
    if (key === 'ordlo') return 'ordlo';
    if (key === 'tuzla') return 'tuzla';
    return null; // Abcházsko, Podnestersko, „Prusko", Karélia, hlavné mestá…
  }
  if (group === 'airfield' || group === 'airbase' || group === 'airport') return geometryType === 'Point' ? 'airfield' : null;
  return null;
}

const R_KM = 6371.0088;
/** Sférická plocha kruhu [lon,lat] v km² (Chamberlain & Duquette). Pure. */
export function ringAreaKm2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let sum = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const [lon1, lat1] = ring[i]; const [lon2, lat2] = ring[(i + 1) % n];
    sum += ((lon2 - lon1) * Math.PI / 180) * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.abs(sum) * R_KM * R_KM / 2;
}
/** Plocha polygónu s dierami (km²). Pure. */
export function polygonAreaKm2(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return 0;
  const outer = ringAreaKm2(coordinates[0]);
  let holes = 0;
  for (let i = 1; i < coordinates.length; i += 1) holes += ringAreaKm2(coordinates[i]);
  return Math.max(0, outer - holes);
}
const round5 = (v) => Math.round(v * 1e5) / 1e5;
/** Súradnice [lon,lat,(alt)] → [lon,lat] na 5 desatín; kruhy s < 4 bodmi preč. Pure. */
export function cleanRings(coordinates) {
  const out = [];
  for (const ring of coordinates || []) {
    if (!Array.isArray(ring)) continue;
    const pts = ring.map((c) => [round5(Number(c[0])), round5(Number(c[1]))]).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (pts.length >= 4) out.push(pts);
  }
  return out;
}
/** Krátky popis EN z „uk<br>///<br>en<br>/// geoJSON.descriptions.#n". Pure. */
export function descriptionEn(description) {
  const parts = String(description ?? '').replace(/<br\s*\/?>/gi, ' ').split('///').map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s && !/geoJSON\./.test(s));
  return parts[1] || parts[0] || null;
}

/**
 * Odpoveď API → snímka `{ id, at, day, datetime, features, counts, areaKm2 }`.
 * `at` = čas z `id` (unixové sekundy). Pure.
 */
export function deepstateSnapshotFromApi(json) {
  const id = Number(json?.id);
  const at = Number.isFinite(id) && id > 1e9 ? new Date(id * 1000).toISOString() : null;
  const features = [];
  const counts = {}; const areaKm2 = {};
  for (const f of json?.map?.features || []) {
    const gType = f?.geometry?.type;
    const { uk, en, group, key } = parseDeepStateName(f?.properties?.name);
    const kind = deepstateKind(group, key, gType);
    if (!kind) continue;
    if (gType === 'Point') {
      const [lon, lat] = f.geometry.coordinates || [];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      features.push({ kind, type: 'Point', lon: round5(lon), lat: round5(lat), en, uk, key });
      counts[kind] = (counts[kind] || 0) + 1;
    } else if (gType === 'Polygon' || gType === 'MultiPolygon') {
      const polys = gType === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        const rings = cleanRings(poly);
        if (!rings.length) continue;
        const km2 = polygonAreaKm2(rings);
        features.push({ kind, type: 'Polygon', rings, areaKm2: Math.round(km2 * 10) / 10, en, uk, key, description: descriptionEn(f.properties?.description) });
        areaKm2[kind] = (areaKm2[kind] || 0) + km2;
        counts[kind] = (counts[kind] || 0) + 1;
      }
    }
  }
  for (const k of Object.keys(areaKm2)) areaKm2[k] = Math.round(areaKm2[k]);
  return { id: Number.isFinite(id) ? id : null, at, day: at ? at.slice(0, 10) : null, datetime: json?.datetime || null, features, counts, areaKm2 };
}

/** Mirror cyterat/deepstate-map-data sťahuje DeepState raz denne ~03:00 UTC. */
export const DEEPSTATE_MIRROR_HOUR_UTC = 3;
export const DEEPSTATE_MIRROR_ATTRIBUTION = 'DeepStateMap.live via the unofficial GitHub mirror cyterat/deepstate-map-data';
/** Repozitár mirroru podľa id (cyterat = pôvodný, lazar-bit = záložný fork). Pure. */
export function deepstateMirrorRepo(id) {
  return id === 'lazar-bit' ? 'lazar-bit/deepstate-map-data-analytics' : 'cyterat/deepstate-map-data';
}
/** Atribúcia snímky podľa mirroru, z ktorého deň naozaj prišiel. Pure. */
export function deepstateMirrorAttribution(id) {
  return id === 'lazar-bit'
    ? 'DeepStateMap.live via the unofficial GitHub mirror lazar-bit/deepstate-map-data-analytics (fork of cyterat/deepstate-map-data)'
    : DEEPSTATE_MIRROR_ATTRIBUTION;
}

/**
 * Denný súbor mirroru → snímka v tvare `deepstateSnapshotFromApi` (vrstva,
 * časová os aj KARTA ju kreslia bez vlastnej cesty). Mirror nesie JEDEN
 * MultiPolygon bez vlastností: okupované + Krym + ORDLO zlúčené, bez šedej
 * zóny, oslobodených území, smerov a letísk — všetko je `occupied`.
 * `at` = deň súboru o ~03:00 UTC (čas sťahovania mirrorom, nie čas DeepState;
 * `atApprox`), zdroj `mirror`. Pure.
 * @param {object} geojson súbor mirroru
 * @param {{ dateKey: string, fallbackDays?: number, upstreamUnavailable?: boolean }} meta dateKey = YYYYMMDD súboru
 */
export function deepstateSnapshotFromMirror(geojson, { dateKey, fallbackDays = 0, upstreamUnavailable = false, mirror = 'cyterat' } = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(dateKey ?? ''));
  const day = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  const at = day ? `${day}T${String(DEEPSTATE_MIRROR_HOUR_UTC).padStart(2, '0')}:00:00.000Z` : null;
  const geoms = geojson?.type === 'FeatureCollection' ? (geojson.features || []).map((f) => f?.geometry)
    : geojson?.type === 'Feature' ? [geojson.geometry] : [geojson];
  const features = [];
  let km2Total = 0;
  for (const g of geoms) {
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys || []) {
      const rings = cleanRings(poly);
      if (!rings.length) continue;
      const km2 = polygonAreaKm2(rings);
      km2Total += km2;
      features.push({ kind: 'occupied', type: 'Polygon', rings, areaKm2: Math.round(km2 * 10) / 10, en: 'Occupied (incl. Crimea and areas held since 2014)', uk: null, key: 'mirror', description: null });
    }
  }
  return {
    id: null, at, atApprox: true, day, datetime: null, source: 'mirror', mirror: mirror === 'lazar-bit' ? 'lazar-bit' : 'cyterat', mirrorDate: dateKey || null,
    fallbackDays, upstreamUnavailable: Boolean(upstreamUnavailable),
    features,
    counts: features.length ? { occupied: features.length } : {},
    areaKm2: features.length ? { occupied: Math.round(km2Total) } : {},
  };
}

/** Text „stav k" z `at` (UTC) pre legendu; mirror = len deň (čas DeepState nepoznáme). Pure. */
export function deepstateStampText(snapshot) {
  if (!snapshot?.at) return '';
  const d = new Date(snapshot.at);
  if (snapshot.source === 'mirror') return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
  const hh = String(d.getUTCHours()).padStart(2, '0'); const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()} ${hh}:${mm} UTC`;
}
