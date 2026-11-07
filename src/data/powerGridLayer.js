// src/data/powerGridLayer.js
/**
 * @module powerGridLayer
 * @description Vrstva „Elektrická sieť · ≥ 220 kV" (ELEKTRINA, 2026-11-06;
 * používateľ: „plynovody, elektrinu a všetko na vrchol vylepšenia").
 * Nahrádza Energetiku SR (586 vedení Slovenska z 2026-08-30) prenosovou
 * sieťou Európy a Ázie z OSM snímku `scripts/build-power-lines.mjs`
 * (proxy `/api/power/lines`). Id `local-energy` a token `y` ostávajú, aby
 * staré odkazy, hlasové aliasy („elektrina", „power grid") a uložený stav
 * fungovali ďalej.
 *
 * Telo je to isté ako pri potrubiach (`createGasPipelinesLayer` s profilom):
 * tri čipy ≥ 380 kV / 220–330 kV / HVDC, každý druh vo vlastnom zdroji,
 * šírka podľa napätia s tmavým obrysom, pahýle z diaľky miznú, klik vyberie
 * celú trasu (relácia route=power, meno alebo ref + prevádzkovateľ), duch cez
 * terén zblízka, hover karta s vlajkami a ŽIVÝM tokom cez hranicu
 * (Energy-Charts, 15 min, `/api/power/flows`) pri úsekoch, ktoré hranicu
 * prekračujú. Bez snímku Eurázie (build nebežal) kreslí bundlovaný extrakt
 * Slovenska a zdroj to prizná dátumom 2026-08-30.
 */
import { createGasPipelinesLayer, GAS_PIPELINES_PROFILE } from './gasPipelinesLayer.js';
import {
  POWER_CELLS_INDEX_API, POWER_CELL_API, POWER_COLORS, POWER_FALLBACK_URL, POWER_GRID_ATTRIBUTION, POWER_KINDS, POWER_GROUP_MAX, POWER_LINES_API, POWER_LINES_META_API,
  parsePowerFallback, powerDetails, powerFallbackMeta, powerGroupKey, powerHoverModel, powerSelectedStyle, powerStyle, powerTitle, selectPowerCells,
} from './powerGrid.js';
import { pipelineSourceLabel } from './gasPipelines.js';
import { fetchPowerFlows, powerFlowPairIds, powerFlowRows } from './powerFlows.js';
import { createPipelineHoverCard } from './pipelineHoverCard.js';
import { cellUrlFor, defaultMaxResident } from './snapshotCells.js';

export const POWER_GRID_LAYER_ID = 'local-energy';

/** Texty sekcie toku: tok cez HRANICU (dvojica štátov), nie vedením. */
export const POWER_FLOW_TEXTS = Object.freeze({
  title: 'power.flow-title',
  none: 'power.flow-none',
  note: 'power.flow-note',
  loading: 'gas.pipeline-flow-loading',
  unavailable: 'power.flow-unavailable',
  spark: 'power.flow-spark',
  hint: 'power.hover-hint',
});

/** Núdzovka: bundlovaný extrakt Slovenska (ODbL, 2026-08-30) v tvare snímku Eurázie. */
export async function loadPowerFallback(doFetch, url = POWER_FALLBACK_URL) {
  const response = await doFetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const features = parsePowerFallback(await response.text());
  if (!features.length) throw new Error('empty fallback');
  return { features, meta: powerFallbackMeta(features) };
}

/** Popis zdroja: núdzový snímok sa hlási ako „len Slovensko" (pravidlo 2). */
function powerSourceLabel(meta, translate, lang) {
  const base = pipelineSourceLabel(meta, translate, lang);
  return meta?.fallback ? `${base} · ${translate('power.fallback-sk')}` : base;
}

export const POWER_GRID_PROFILE = Object.freeze({
  ...GAS_PIPELINES_PROFILE,
  id: POWER_GRID_LAYER_ID,
  nameKey: 'layer.local-energy.name',
  icon: '↯',
  logTag: 'PowerGrid',
  kinds: POWER_KINDS,
  sources: Object.freeze([
    Object.freeze({
      key: 'power', url: POWER_LINES_API, metaUrl: POWER_LINES_META_API, required: true, fallback: (doFetch) => loadPowerFallback(doFetch),
      // Bunky 5° × 5° podľa výhľadu (viď snapshotCells.js).
      cells: Object.freeze({ indexUrl: POWER_CELLS_INDEX_API, cellUrl: cellUrlFor(POWER_CELL_API) }),
    }),
  ]),
  styleFor: powerStyle,
  selectedStyleFor: powerSelectedStyle,
  // Plot sa na vedenia nestavia — stĺpy sú v realite, stena by klamala.
  fenceSpecFor: () => null,
  groupKeyFor: powerGroupKey,
  groupMax: POWER_GROUP_MAX,
  titleFor: powerTitle,
  detailsFor: powerDetails,
  sourceLabel: powerSourceLabel,
  kindColors: Object.freeze({ ehv: POWER_COLORS.ehv.operating, hv: POWER_COLORS.hv.operating, dc: POWER_COLORS.dc.operating }),
  chipLabelKey: (kind) => `power.chip-${kind}`,
  chipHintKey: (kind) => `power.chip-${kind}-hint`,
  cardAccent: 'rgba(63, 214, 255, 0.95)',
  attribution: POWER_GRID_ATTRIBUTION,
  noSnapshotKey: 'power.no-snapshot',
  noGroundKey: 'gas.pipeline-no-ground',
  hoverFactory: (o) => createPipelineHoverCard({
    ...o,
    buildModel: powerHoverModel,
    flowIdsFor: (feature) => powerFlowPairIds(feature.properties),
    flowRowsFor: powerFlowRows,
    flowTexts: POWER_FLOW_TEXTS,
    className: 'pipeline-hover-card power-hover-card',
  }),
  flowsFetcher: fetchPowerFlows,
  prefetchFlows: true,
  // Hranice celej trasy: zjednotenie dvojíc zo všetkých úsekov (v poradí výskytu).
  groupFlowIdsFor: (features) => [...new Set(features.flatMap((f) => powerFlowPairIds(f.properties)))],
  // Bunky 5° × 5° podľa výhľadu, strop úsekov v pamäti (viď powerGrid.js).
  // Výber buniek a strop (spoločné pre všetky zdroje vrstvy); URL buniek nesie zdroj.
  cells: Object.freeze({
    select: selectPowerCells,
    maxResident: defaultMaxResident,
    debounceMs: 400,
  }),
});

/** @param {object} [o] tie isté vstupy ako createGasPipelinesLayer (testy) */
export function createPowerGridLayer(o = {}) {
  return createGasPipelinesLayer({ profile: POWER_GRID_PROFILE, ...o });
}

const powerGridLayer = createPowerGridLayer();
export default powerGridLayer;
