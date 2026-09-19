// scripts/lib/pipelineSnapshot.mjs
//
// Spoločný engine pre snímky potrubí z OpenStreetMap cez Overpass
// (2026-09-19, etapa 2). Plynový a ropný build sa líšia len konfiguráciou —
// dlaždicami, dopytom, klasifikátorom a cieľovými cestami. Všetko ostatné
// (sťahovanie s cache a retry, orezanie na dlaždicu, Douglas–Peucker,
// zostavenie prvkov, premenovanie duplikátov cez švy, zápis a meta) je tu,
// aby sa dva ~330-riadkové skripty časom nerozišli.
//
// Modul je knižnica: import NIČ nespustí. Samotné build skripty majú
// vykonateľný kód na najvyššej úrovni a importovať sa nesmú.
//
// Licencia dát: ODbL 1.0, © OpenStreetMap contributors (DATA_SOURCES.md).
import fs from 'node:fs';
import path from 'node:path';

import { diameterMm } from './pipelineTags.mjs';
import { countriesForCoords } from './pipelineCountries.mjs';

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Iterative Douglas–Peucker (stack-based; transit ways are long). */
export function simplify(coords, eps) {
  if (coords.length <= 2) return coords;
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop();
    let maxDist = 0;
    let maxAt = -1;
    for (let i = from + 1; i < to; i++) {
      const d = pointSegDist(coords[i], coords[from], coords[to]);
      if (d > maxDist) { maxDist = d; maxAt = i; }
    }
    if (maxDist > eps && maxAt !== -1) {
      keep[maxAt] = 1;
      stack.push([from, maxAt], [maxAt, to]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/**
 * Clip a coordinate run to a bbox (runs outside dropped, crossings interpolated).
 * Hranice sú INKLUZÍVNE na oboch stranách, takže dotýkajúce sa dlaždice zdieľajú
 * len hraničný bod — preto musí severný okraj južného pásu sedieť presne na
 * južnom okraji severného, inak sa tá istá zem nakreslí dvakrát.
 */
export function clipToBbox(coords, [S, W, N, E], round) {
  const inside = ([lon, lat]) => lon >= W && lon <= E && lat >= S && lat <= N;
  const boundaryPoint = (a, b) => {
    let t = 1;
    const clamp = (limit, axis) => {
      const da = a[axis]; const db = b[axis];
      if (da === db) return;
      const tt = (limit - da) / (db - da);
      if (tt >= 0 && tt < t) t = tt;
    };
    if (b[0] < W) clamp(W, 0);
    if (b[0] > E) clamp(E, 0);
    if (b[1] < S) clamp(S, 1);
    if (b[1] > N) clamp(N, 1);
    return [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t)];
  };
  const parts = [];
  let run = [];
  for (let i = 0; i < coords.length; i++) {
    const point = coords[i];
    if (inside(point)) {
      if (!run.length && i > 0 && !inside(coords[i - 1])) run.push(boundaryPoint(point, coords[i - 1]));
      run.push(point);
    } else if (run.length) {
      run.push(boundaryPoint(coords[i - 1], point));
      if (run.length >= 2) parts.push(run);
      run = [];
    }
  }
  if (run.length >= 2) parts.push(run);
  return parts;
}

const haversineKm = (a, b) => {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
export const lengthKm = (coords) => coords.reduce((sum, p, i) => (i ? sum + haversineKm(coords[i - 1], p) : 0), 0);

/**
 * Postav snímok potrubí. Vracia meta objekt, ktorý zapísal na disk.
 *
 * @param {object} o
 * @param {string} o.label 'gas' | 'oil' — do logov a ako predvolená `substance`
 * @param {number[][]} o.tiles [S, W, N, E]
 * @param {string} o.queryVersion verzia v názve surovej cache; nová verzia = staré dlaždice sa nepoužijú
 * @param {string} o.cacheDir kam ide výstup
 * @param {string} o.rawDir kam idú surové odpovede Overpassu
 * @param {string} o.outFile .geojsonl
 * @param {string} o.metaFile .meta.json
 * @param {(tile: number[]) => string} o.buildQuery Overpass QL pre jednu dlaždicu
 * @param {(tags: object, inRelation: boolean) => string|null} o.classify
 * @param {string} o.queryDescription ľudský popis dopytu do meta
 * @param {string} o.overpassUrl
 * @param {string} o.userAgent
 * @param {boolean} o.refresh
 */
export async function buildPipelineSnapshot({
  label, tiles, queryVersion, cacheDir, rawDir, outFile, metaFile,
  buildQuery, classify, queryDescription, overpassUrl, userAgent, refresh,
  simplifyEpsDeg = 0.002, roundDigits = 3, pauseMs = 20_000,
  countryIndex = null,
}) {
  const round = (n) => Number(n.toFixed(roundDigits));

  function toFeatures(el, tile, relTags = null) {
    // Tagy relácie (meno, prevádzkovateľ, priemer, látka) ako predvolené hodnoty
    // pre členské úseky, ktoré ich nemajú; tagy úseku majú prednosť.
    const tags = { ...(relTags || {}), ...(el.tags || {}) };
    const coords = (el.geometry || []).map((pt) => [round(pt.lon), round(pt.lat)]);
    // Jazyk mena pre prepis cyriliky (etapa 3b): OSM ho nesie nepriamo —
    // keď `name:uk` (alebo :ru/:be/:kk) je doslovne rovné `name`.
    const nameLang = ['uk', 'ru', 'be', 'kk'].find((l) => tags[`name:${l}`] && tags[`name:${l}`] === tags.name) || null;
    const properties = {
      name: tags.name || tags['name:en'] || tags.ref || null,
      nameEn: tags['name:en'] || null,
      nameSk: tags['name:sk'] || null,
      intName: tags.int_name || null,
      nameLang,
      operator: tags.operator || null,
      ref: tags.ref || null,
      diameterMm: diameterMm(tags),
      substance: tags.substance || label,
      location: tags.location || null,
      // Etapa 3 (2026-09-19): „kam tečie" z OSM. `from`/`to` nesú takmer výlučne
      // relácie route=pipeline (plyn 21, ropa 11 z ~190) a členské cesty ich
      // dedia cez relTags; `capacity` a `pressure` sú zriedkavé, ale keď sú,
      // sú to jediné tvrdé čísla o rúre, ktoré OSM má. Voľný text, bez prepočtu.
      from: tags.from || null,
      to: tags.to || null,
      capacity: tags.capacity || null,
      pressure: tags.pressure || null,
      status: tags.disused === 'yes' || tags['disused:man_made'] ? 'disused' : (tags.construction === 'yes' || tags.proposed === 'yes' ? 'planned' : 'operating'),
      osm: el.id,
    };
    return clipToBbox(coords, tile, round)
      .map((part) => simplify(part, simplifyEpsDeg))
      .filter((part) => part.length >= 2)
      .map((part, index, parts) => ({
        type: 'Feature',
        id: parts.length === 1 ? `osm-way-${el.id}` : `osm-way-${el.id}.${index}`,
        properties: {
          ...properties,
          lengthKm: Math.round(lengthKm(part) * 10) / 10,
          // Krajiny úseku (etapa 3b) — vlajky v karte. Dopočítané tu, v builde,
          // bodom v polygóne Natural Earth; do prehliadača idú len ISO2 kódy.
          countries: countryIndex ? countriesForCoords(countryIndex, part) : [],
        },
        geometry: { type: 'LineString', coordinates: part },
      }));
  }

  async function fetchTile(tile) {
    const [S, W, N, E] = tile;
    const rawPath = path.join(rawDir, `tile-${queryVersion}-${S}_${W}_${N}_${E}.json`);
    if (!refresh && fs.existsSync(rawPath)) {
      console.log(`  tile ${tile.join(',')}: raw cache`);
      return JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    }
    const query = buildQuery(tile);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const started = Date.now();
      const res = await fetch(overpassUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(360_000),
      });
      if (res.ok) {
        const text = await res.text();
        const json = JSON.parse(text);
        // Overpass hlási tiché orezanie odpovede v `remark` (runtime/memory error).
        // Bez tejto kontroly by sa neúplná dlaždica zacachovala ako platná.
        if (json.remark) throw new Error(`Overpass remark for tile ${tile.join(',')}: ${json.remark}`);
        fs.mkdirSync(rawDir, { recursive: true });
        fs.writeFileSync(rawPath, text, 'utf8');
        const els = json.elements || [];
        console.log(`  tile ${tile.join(',')}: ${els.filter((e) => e.type === 'way').length} ways, ${els.filter((e) => e.type === 'relation').length} relations, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s`);
        return json;
      }
      console.error(`  tile ${tile.join(',')}: Overpass HTTP ${res.status} (attempt ${attempt}/3)`);
      if (attempt === 3) throw new Error(`Overpass failed for tile ${tile.join(',')}: ${(await res.text()).slice(0, 300)}`);
      await new Promise((resolve) => setTimeout(resolve, 45_000));
    }
    return null;
  }

  const started = Date.now();
  console.log(`${label} pipelines snapshot: ${tiles.length} tiles via ${overpassUrl}${refresh ? ' (refresh)' : ''}`);
  const features = [];
  const tileMeta = [];
  const basis = { transmission: 0, relation: 0, diameter: 0, name: 0, operator: 0, excluded: 0 };
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const json = await fetchTile(tile);
    const elements = json.elements || [];
    const relTagsByWay = new Map();
    for (const rel of elements) {
      if (rel.type !== 'relation') continue;
      for (const m of rel.members || []) if (m.type === 'way' && !relTagsByWay.has(m.ref)) relTagsByWay.set(m.ref, rel.tags || {});
    }
    const ways = elements.filter((el) => el.type === 'way');
    const seenWays = new Set();
    const parts = [];
    for (const el of ways) {
      if (seenWays.has(el.id)) continue; // úsek môže byť v .w aj .m
      seenWays.add(el.id);
      const relTags = relTagsByWay.get(el.id) || null;
      const rule = classify({ ...(relTags || {}), ...(el.tags || {}) }, relTags !== null);
      if (!rule) { basis.excluded += 1; continue; }
      basis[rule] += 1;
      parts.push(...toFeatures(el, tile, relTags));
    }
    features.push(...parts);
    tileMeta.push({ bbox: tile, ways: ways.length, relations: relTagsByWay.size ? elements.filter((el) => el.type === 'relation').length : 0, features: parts.length, osmBase: json.osm3s?.timestamp_osm_base || null });
    if (i < tiles.length - 1 && !fs.existsSync(path.join(rawDir, `tile-${queryVersion}-${tiles[i + 1].join('_')}.json`))) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
  // Ten istý way môže ležať v dvoch dlaždiciach — každá dá svoj orezaný kus
  // s rovnakým OSM id; entity id vo vrstve musia byť jedinečné → druhý a ďalší
  // výskyt dostane príponu #2, #3 … (deterministicky podľa poradia dlaždíc).
  const seen = new Map();
  let renamed = 0;
  for (const f of features) {
    const n = (seen.get(f.id) || 0) + 1;
    seen.set(f.id, n);
    if (n > 1) { f.id = `${f.id}#${n}`; renamed += 1; }
  }
  features.sort((a, b) => a.id.localeCompare(b.id));
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(outFile, features.map((f) => JSON.stringify(f)).join('\n') + '\n', 'utf8');
  const points = features.reduce((n, f) => n + f.geometry.coordinates.length, 0);
  const km = Math.round(features.reduce((n, f) => n + f.properties.lengthKm, 0));
  const named = features.filter((f) => f.properties.name).length;
  const withCountries = features.filter((f) => f.properties.countries?.length).length;
  const meta = {
    countries: countryIndex ? { source: 'Natural Earth 1:50m admin-0 countries (public domain)', featuresWithCountry: withCountries } : null,
    snapshot: new Date().toISOString(),
    source: 'OpenStreetMap via Overpass API',
    license: 'ODbL 1.0 — © OpenStreetMap contributors',
    endpoint: overpassUrl,
    query: queryDescription,
    basis,
    tiles: tileMeta,
    simplifyEpsDeg,
    round: roundDigits,
    features: features.length,
    named,
    crossTileDuplicatesRenamed: renamed,
    points,
    lengthKm: km,
    bytes: fs.statSync(outFile).size,
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
  console.log(`${path.basename(outFile)}: ${features.length} features (${named} named), ${points} points, ${km} km, ${(meta.bytes / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  return meta;
}
