// src/data/powerGrid.js
/**
 * @module powerGrid
 * @description Elektrická prenosová sieť (ELEKTRINA, 2026-11-06; používateľ:
 * „plynovody, elektrinu a všetko na vrchol vylepšenia"): čisté pomocné
 * funkcie nad snímkom OSM vedení ≥ 220 kV, ktorý stavia
 * `scripts/build-power-lines.mjs` do `.gev-cache/power/` a servíruje proxy
 * `/api/power/lines` (geojsonl) + `/api/power/lines/meta`. Štýl podľa
 * napätia a druhu (striedavé / HVDC), texty karty, skupiny trás, núdzový
 * snímok Slovenska z balíka (local_data/sk_energy), keď build ešte nebežal.
 * Licencia dát: ODbL 1.0, © OpenStreetMap contributors. Modul je čistý
 * (bez Cesia, i18n a DOM) — testuje sa v Node.
 */
import { latinizeForDisplay } from './latinize.js';
import {
  GAS_PIPELINE_ATTRIBUTION, PIPELINE_OUTLINE, PIPELINE_SELECTED, PIPELINE_WIDTHS, parsePipelinesGeojsonl, pipelineDisplayCondition, pipelineDisplayName,
  pipelineLocationText, pipelineMidpoint, pipelineOperator, pipelineRoute, pipelineStatus,
} from './gasPipelines.js';
import { powerFlowPairIds } from './powerFlows.js';
import { buildCellIndex, cellBbox, cellId, selectCells } from './snapshotCells.js';

export const POWER_LINES_API = '/api/power/lines';
export const POWER_LINES_META_API = '/api/power/lines/meta';
export const POWER_GRID_ATTRIBUTION = GAS_PIPELINE_ATTRIBUTION;
/** Núdzový snímok (Slovensko, 2026-08-30) z balíka — keď proxy nemá snímok Eurázie. */
export const POWER_FALLBACK_URL = new URL('./local_data/sk_energy/sk-energy.geojsonl', import.meta.url).href;
export const POWER_FALLBACK_SNAPSHOT = '2026-08-30';

/** Druhy = zdroje entít a čipy; poradie je poradie čipov a legendy. */
export const POWER_KINDS = Object.freeze(['ehv', 'hv', 'dc']);
/** ≥ 380 kV = veľmi vysoké napätie (chrbtica), 220–330 kV = vysoké. */
export const EHV_MIN_VOLTS = 380_000;
export const HV_MIN_VOLTS = 220_000;

/**
 * Farby: striedavé vedenia v studenej rodine (elektrická azúrová pre
 * chrbticu ≥ 380 kV, modrofialová pre 220–330 kV), HVDC prepojenia limetkové
 * — všetky tri ďaleko od jantára plynu, orchidey ropy aj červeného plotu
 * hraníc, a navzájom odlíšené aj jasom, nie len odtieňom. Farba nie je
 * jediný kanál: karta hovorí napätie aj druh slovom.
 */
export const POWER_COLORS = Object.freeze({
  ehv: Object.freeze({ operating: '#3fd6ff', planned: '#9fe9ff', disused: '#4c6b75', selected: '#ffffff' }),
  hv: Object.freeze({ operating: '#7f9cff', planned: '#bccaff', disused: '#555d78', selected: '#ffffff' }),
  dc: Object.freeze({ operating: '#b9ff4f', planned: '#dcffa8', disused: '#6a7a4a', selected: '#ffffff' }),
});

/**
 * Druh úseku: HVDC podľa `frequency=0` (jednosmerné prepojenia — NordLink,
 * BritNed, SuedLink…), inak podľa najvyššieho napätia.
 * @param {object} properties
 * @returns {'ehv'|'hv'|'dc'}
 */
export function powerKind(properties = {}) {
  const f = properties?.frequency;
  if (f === 0 || f === '0') return 'dc';
  const v = Number(properties?.voltageV);
  return Number.isFinite(v) && v >= EHV_MIN_VOLTS ? 'ehv' : 'hv';
}

/** Najvyššie napätie v kV ako text („400"), prípadne všetky („400 / 110"). */
export function powerVoltageText(properties = {}, { all = false } = {}) {
  const list = Array.isArray(properties?.voltages) && properties.voltages.length ? properties.voltages : (Number.isFinite(Number(properties?.voltageV)) ? [Number(properties.voltageV)] : []);
  const kv = list.filter((v) => Number.isFinite(v) && v > 0).map((v) => (v >= 1000 ? Math.round(v / 1000) : v));
  if (!kv.length) return '';
  return all ? kv.join(' / ') : String(kv[0]);
}

/**
 * Trieda šírky z napätia a dĺžky úseku: 750 kV+ chrbtica, 380–500 kV hlavná,
 * 220–330 kV vedľajšia; krátke pahýle (< 2 km, pod 380 kV) najtenšie a z
 * diaľky miznú (pipelineDisplayCondition).
 */
export function powerWidthClass(properties = {}) {
  const v = Number(properties?.voltageV);
  const km = Number(properties?.lengthKm);
  if (Number.isFinite(v) && v >= 700_000) return 'trunk';
  if (Number.isFinite(v) && v >= EHV_MIN_VOLTS) return 'main';
  if (Number.isFinite(km) && km > 0 && km < 2) return 'stub';
  return 'minor';
}

/** Štýl entity — rovnaký tvar ako pipelineStyle, aby ho vrstva kreslila tou istou cestou. */
export function powerStyle(properties = {}) {
  const status = pipelineStatus(properties);
  const kind = powerKind(properties);
  const widthClass = powerWidthClass(properties);
  const dashed = status === 'planned';
  return {
    width: PIPELINE_WIDTHS[widthClass],
    widthClass,
    alpha: status === 'disused' ? 0.45 : (status === 'planned' ? 0.7 : 0.85),
    dashed,
    color: POWER_COLORS[kind][status],
    outline: dashed ? null : PIPELINE_OUTLINE,
    gapColor: dashed ? PIPELINE_OUTLINE.color : null,
    displayCondition: pipelineDisplayCondition(properties?.lengthKm),
    kind,
    status,
  };
}

/** Zvýraznenie výberu — biela, širšia, vždy viditeľná (ako pri rúrach). */
export function powerSelectedStyle(properties = {}) {
  const base = powerStyle(properties);
  return { ...base, width: base.width + PIPELINE_SELECTED.extraWidth, color: PIPELINE_SELECTED.color, alpha: PIPELINE_SELECTED.alpha, dashed: false, outline: PIPELINE_SELECTED.outline, gapColor: null, displayCondition: null };
}

/** Všeobecné mená, ktoré trasu netvoria („400 kV line", „Freileitung"…). */
const GENERIC_POWER_NAME_RE = /^(power line|line|freileitung|hochspannungsleitung|ligne|línea|linea|ЛЭП|ВЛ|линия|лінія|vedenie|vedení|linia|elektrické vedenie|high voltage line|overhead line|\d{2,4}\s?kv(\s?line)?)$/i;
/** Najviac úsekov v jednej mennej skupine — nad tým je meno prakticky všeobecné. */
export const POWER_GROUP_MAX = 160;

/**
 * Skupina = celá trasa: relácia route=power, inak meno + prevádzkovateľ,
 * inak `ref` + prevádzkovateľ (V499 · SEPS; 402 · ČEPS) — vedenia sú v OSM
 * častejšie s ref než s menom. Samotné krátke ref („I", „II") bez
 * prevádzkovateľa skupinu netvorí.
 */
export function powerGroupKey(properties = {}) {
  const relation = Number(properties?.relation);
  if (Number.isFinite(relation) && relation > 0) return `rel:${relation}`;
  const operator = String(properties?.operator || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const name = String(properties?.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (name.length >= 4 && !GENERIC_POWER_NAME_RE.test(name)) return `name:${name}|${operator}`;
  const ref = String(properties?.ref || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (ref && (operator || ref.length >= 3)) return `ref:${ref}|${operator}`;
  return null;
}

/** Meno pre kartu: name:sk → name:en → int_name → prepis → name → ref → „vedenie 400 kV (bez mena)". */
export function powerTitle(properties = {}, translate = (k) => k) {
  const text = pipelineDisplayName(properties).text;
  if (text) return text;
  const kv = powerVoltageText(properties);
  return kv ? translate('power.unnamed', { kv }) : translate('power.unnamed-nokv');
}

/** Hlavička karty: „VEDENIE 400 kV · striedavé" / „HVDC 525 kV · jednosmerné" / „KÁBEL 220 kV". */
export function powerKindText(properties = {}, translate = (k) => k) {
  const kv = powerVoltageText(properties);
  const kind = powerKind(properties);
  const key = kind === 'dc' ? 'power.kind-dc' : (String(properties?.power) === 'cable' ? 'power.kind-cable' : 'power.kind-line');
  return translate(key, { kv: kv || '?' });
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');

/** Frekvencia slovom: 0 → jednosmerné (HVDC), 50 → „50 Hz", 16,7 → „16,7 Hz (železnica)". */
export function powerFrequencyText(properties = {}, translate = (k) => k, lang = 'sk') {
  const f = properties?.frequency;
  if (f === null || f === undefined || f === '') return '';
  const n = Number(f);
  if (!Number.isFinite(n)) return String(f);
  if (n === 0) return translate('power.frequency-dc');
  const text = `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 }).format(n)} Hz`;
  return n < 20 ? translate('power.frequency-rail', { hz: text }) : text;
}

/**
 * Riadky karty po kliku (a kontextového panela): druh, prevádzkovateľ,
 * krajiny, trasa, napätie · obvody · káble, dĺžka úseku, frekvencia,
 * uloženie, stav, OSM way.
 */
export function powerDetails(properties = {}, translate = (k) => k, lang = 'sk', { regionName = (iso) => iso } = {}) {
  const lines = [];
  lines.push(powerKindText(properties, translate));
  if (properties?.operator) lines.push(pipelineOperator(properties).text);
  const countries = Array.isArray(properties?.countries) ? properties.countries.filter(Boolean) : [];
  if (countries.length) lines.push(translate('gas.pipeline-countries') + ': ' + countries.map((iso) => regionName(iso) || iso).join(' · '));
  const route = pipelineRoute(properties);
  if (route) lines.push(translate('gas.pipeline-route') + ': ' + route);
  const dims = [];
  const kvAll = powerVoltageText(properties, { all: true });
  if (kvAll) dims.push(`${kvAll} kV`);
  const circuits = Number(properties?.circuits);
  if (Number.isFinite(circuits) && circuits > 0) dims.push(translate('power.circuits', { n: circuits }));
  const km = Number(properties?.lengthKm);
  if (Number.isFinite(km) && km > 0) dims.push(translate('gas.pipeline-length', { km: new Intl.NumberFormat(locale(lang), { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km) }));
  if (dims.length) lines.push(dims.join(' · '));
  const frequency = powerFrequencyText(properties, translate, lang);
  if (frequency) lines.push(translate('power.frequency') + ': ' + frequency);
  const location = pipelineLocationText(properties, translate);
  if (location) lines.push(translate('gas.pipeline-location') + ': ' + location);
  lines.push(translate(`gas.pipeline-status-${pipelineStatus(properties)}`));
  if (properties?.osm) lines.push(`OSM way ${properties.osm}`);
  return lines;
}

/**
 * Riadky `[popis, hodnota]` pre hover kartu: napätie, druh, obvody, káble,
 * frekvencia, úsek, trasa, uloženie, stav. Prevádzkovateľ a hlavička sú
 * v karte zvlášť.
 */
export function powerDetailsRows(properties = {}, translate = (k) => k, lang = 'sk') {
  const rows = [];
  const kvAll = powerVoltageText(properties, { all: true });
  if (kvAll) rows.push([translate('power.voltage'), `${kvAll} kV`]);
  rows.push([translate('power.type'), translate(String(properties?.power) === 'cable' ? 'power.type-cable' : 'power.type-line')]);
  const circuits = Number(properties?.circuits);
  if (Number.isFinite(circuits) && circuits > 0) rows.push([translate('power.circuits-label'), String(circuits)]);
  const cables = Number(properties?.cables);
  if (Number.isFinite(cables) && cables > 0) rows.push([translate('power.cables-label'), String(cables)]);
  const frequency = powerFrequencyText(properties, translate, lang);
  if (frequency) rows.push([translate('power.frequency'), frequency]);
  const km = Number(properties?.lengthKm);
  if (Number.isFinite(km) && km > 0) rows.push([translate('gas.pipeline-segment'), translate('gas.pipeline-length', { km: new Intl.NumberFormat(locale(lang), { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km) })]);
  const route = pipelineRoute(properties);
  if (route) rows.push([translate('gas.pipeline-route'), route]);
  const location = pipelineLocationText(properties, translate);
  if (location) rows.push([translate('gas.pipeline-location'), location]);
  rows.push([translate('gas.pipeline-status-label'), translate(`gas.pipeline-status-${pipelineStatus(properties)}`)]);
  return rows;
}

/**
 * Model hover karty — tvar ako pipelineHoverModel, aby ju kreslila tá istá
 * karta; `flowIds` = hranice, ktorých sa úsek dotýka (Energy-Charts).
 */
export function powerHoverModel(feature, { translate = (k) => k, lang = 'sk' } = {}) {
  if (!feature?.properties) return null;
  const p = feature.properties;
  const osm = Number(p.osm);
  const name = pipelineDisplayName(p);
  return {
    kind: powerKind(p),
    kindText: powerKindText(p, translate),
    title: powerTitle(p, translate),
    original: name.original,
    operator: pipelineOperator(p),
    countries: Array.isArray(p.countries) ? p.countries.filter((iso) => /^[A-Z]{2}$/.test(String(iso))) : [],
    rows: powerDetailsRows(p, translate, lang),
    osmUrl: Number.isFinite(osm) && osm > 0 ? `https://www.openstreetmap.org/way/${osm}` : null,
    flowIds: powerFlowPairIds(p),
    flowNoneKey: null,
  };
}

/** Pomocné: dĺžka úseku v km (haversine) pre núdzový snímok, ktorý ju nenesie. */
function lengthKmOf(coords) {
  const R = 6371;
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dp = p2 - p1;
    const dl = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    km += 2 * R * Math.asin(Math.sqrt(a));
  }
  return km;
}

/**
 * Núdzový snímok: bundlovaný slovenský extrakt (local_data/sk_energy, kind
 * `power`, `voltage` „400000" / „400000;220000") prevedený na vlastnosti
 * eurázijského snímku. Plynové úseky toho súboru sa preskočia — plyn má
 * vlastnú vrstvu. Vracia prázdny zoznam pre poškodený vstup.
 * @param {string} text geojsonl
 */
export function parsePowerFallback(text) {
  const out = [];
  for (const feature of parsePipelinesGeojsonl(text)) {
    const p = feature.properties || {};
    if (p.kind !== 'power') continue;
    const volts = String(p.voltage || '').split(';').map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => b - a);
    const osm = Number(String(feature.id || '').replace(/^osm-way-/, '').split('.')[0]);
    out.push({
      type: 'Feature',
      id: String(feature.id),
      properties: {
        name: p.name || null, nameEn: null, nameSk: null, intName: null, nameLang: null, operator: p.operator || null, ref: null,
        power: 'line', voltageV: volts[0] ?? null, voltages: volts, circuits: null, cables: null, wires: null, frequency: null,
        location: null, from: null, to: null, status: 'operating', osm: Number.isFinite(osm) ? osm : null, relation: null,
        // Stotiny, nie desatiny: úseky pri rozvodniach majú desiatky metrov a 0 km
        // by ich vyradilo z pravidla „pahýle z diaľky miznú" (pipelineDisplayCondition).
        lengthKm: Math.max(0.01, Math.round(lengthKmOf(feature.geometry.coordinates) * 100) / 100), countries: ['SK'],
      },
      geometry: feature.geometry,
    });
  }
  return out;
}

/** Meta núdzového snímku — dátum extraktu, počty a km, označené `fallback`. */
export function powerFallbackMeta(features) {
  return {
    snapshot: POWER_FALLBACK_SNAPSHOT,
    features: features.length,
    lengthKm: Math.round(features.reduce((s, f) => s + (Number(f.properties?.lengthKm) || 0), 0)),
    fallback: true,
    source: 'OpenStreetMap (bundled SK extract)',
    license: 'ODbL 1.0 — © OpenStreetMap contributors',
  };
}

export { pipelineMidpoint as powerMidpoint, latinizeForDisplay };

// ── Bunky (2026-11-06): sieť ≥ 220 kV Eurázie má ~3× viac bodov než plynovody
// (tie stáli ~300 MB haldy), preto sa nenačítava naraz. Server rozdelí snímok
// na bunky 5° × 5° podľa stredu úseku, prehliadač berie bunky vo výhľade od
// stredu obrazovky, kým nedosiahne strop úsekov, a vzdialené uvoľňuje.

export const POWER_CELLS_INDEX_API = '/api/power/cells';
export const POWER_CELL_API = '/api/power/cell/';
export const POWER_CELL_DEG = 5;
/** Strop úsekov v pamäti. Merané 2026-11-06 po GC: ~20 kB na vedenie (10 428 nad SR = +216 MB; plynovody 21 339 = +427 MB) → 16 000 ≈ 330 MB, dotyk 6 000. */
export const POWER_MAX_RESIDENT = Object.freeze({ desktop: 16_000, touch: 6_000 });

/** Bunky žijú v spoločnom module (snapshotCells.js, 2026-11-07 — aj plynovody a ropovody). */
export const powerCellId = (lon, lat, deg = POWER_CELL_DEG) => cellId(lon, lat, deg);
export const powerCellBbox = (id, deg = POWER_CELL_DEG) => cellBbox(id, deg);
/** Index buniek elektrickej siete: súčty podľa druhu (≥ 380 kV / 220–330 kV / HVDC). */
export function buildPowerCellIndex(rows, { deg = POWER_CELL_DEG } = {}) {
  return buildCellIndex(rows, { deg, kinds: POWER_KINDS, kindOf: powerKind });
}
/** Výber buniek vo výhľade (strop pre elektrinu). */
export function selectPowerCells(cells, view, { maxResident = POWER_MAX_RESIDENT.desktop, marginDeg = 1 } = {}) {
  return selectCells(cells, view, { maxResident, marginDeg });
}
