import { t } from '../i18n.js';
import {
  DENSITY_DRAPE_HEIGHT_M,
  densityAlphaFor,
  densityZoomFactor,
  densityBounds,
  createDensityDrapeLayer,
} from './densityDrape.js';

/**
 * Global historical ship-density drape — bundled snapshot of the World Bank /
 * IMF "Global Shipping Traffic Density" raster (AIS positions Jan 2015 –
 * Feb 2021, CC BY 4.0), baked to a 0.25° RGBA PNG by
 * `scripts/build-ship-density.mjs` (provenance: local_data/ship_density/SOURCE.md).
 *
 * WHY: the live AIS layer is terrestrial — 70 % of its contacts sit in Europe
 * and the open ocean, Hormuz or Malacca read as empty. This layer answers
 * "where do ships actually go" for the deaf regions. It is HISTORICAL and
 * MODELLED (a 6-year count), never live — the panel row says so explicitly
 * (rule 2). Rendering, alpha (contrast × zoom-fade) and lifecycle live in the
 * shared factory `densityDrape.js`; this module only carries the ship-specific
 * constants and labels.
 */

export const SHIP_DENSITY_LAYER_ID = 'local-ship-density';

const metaUrlDefault = new URL('./local_data/ship_density/ship-density.json', import.meta.url).href;
const pngUrlDefault = new URL('./local_data/ship_density/ship-density.png', import.meta.url).href;

/** Drape height above the ellipsoid (m) — shared with every density drape. */
export const SHIP_DENSITY_DRAPE_HEIGHT_M = DENSITY_DRAPE_HEIGHT_M;
/**
 * Whole-layer opacity by basemap contrast (contactPalette.js): full on light
 * OSM, softer on dark stacks where cyan glowed twice as loud (user 2026-09-05).
 */
export const SHIP_DENSITY_ALPHA_LIGHT = 0.85;
export const SHIP_DENSITY_ALPHA_DARK = 0.45;
/** Spätná kompatibilita: pôvodná konštanta = svetlý podklad. */
export const SHIP_DENSITY_ALPHA = SHIP_DENSITY_ALPHA_LIGHT;
const SHIP_ALPHAS = Object.freeze({ light: SHIP_DENSITY_ALPHA_LIGHT, dark: SHIP_DENSITY_ALPHA_DARK });

/** @param {'dark'|'light'|string} contrast */
export function shipDensityAlpha(contrast) {
  return densityAlphaFor(contrast, SHIP_ALPHAS);
}

/**
 * Zoom-fade: 0.25° data (~28 km cells) cannot be sharper — magnified it reads
 * as blurry blobs — so the drape fades from FADE_IN and is gone below FADE_OUT.
 */
export const SHIP_DENSITY_FADE_IN_M = 4_000_000;
export const SHIP_DENSITY_FADE_OUT_M = 1_200_000;
const SHIP_FADE = Object.freeze({ fadeInM: SHIP_DENSITY_FADE_IN_M, fadeOutM: SHIP_DENSITY_FADE_OUT_M });

/** @param {number} heightM */
export function shipDensityZoomFactor(heightM) {
  return densityZoomFactor(heightM, SHIP_FADE);
}

/** Validate the baked sidecar; bounds clamped to ±180/±90. */
export function shipDensityBounds(meta) {
  return densityBounds(meta, 'ship-density.json');
}

/**
 * Panel source line. Licence, period and HISTORICAL travel together on purpose.
 * @param {object|null} meta
 */
export function shipDensitySourceLabel(meta) {
  const period = meta?.period ? meta.period.replace(' to ', ' – ') : '2015 – 2021';
  return `World Bank / IMF · AIS ${period} · CC BY 4.0 · ${t('shipdensity.historical')}`;
}

export function createShipDensityLayer({
  metaUrl = metaUrlDefault,
  pngUrl = pngUrlDefault,
  fetchImpl = null,
  imageLoader = undefined,
  primitiveFactory = undefined,
} = {}) {
  return createDensityDrapeLayer({
    id: SHIP_DENSITY_LAYER_ID,
    name: 'Historická hustota lodí',
    icon: '▩',
    metaUrl,
    pngUrl,
    sourceLabel: shipDensitySourceLabel,
    alphas: SHIP_ALPHAS,
    fade: SHIP_FADE,
    logTag: 'ShipDensity',
    sidecarLabel: 'ship-density.json',
    fetchImpl,
    ...(imageLoader ? { imageLoader } : {}),
    ...(primitiveFactory ? { primitiveFactory } : {}),
  });
}

export default createShipDensityLayer();
