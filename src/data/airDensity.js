import { t } from '../i18n.js';
import { createDensityDrapeLayer } from './densityDrape.js';

/**
 * Historická hustota letov — jeden deň skutočnej ADS-B prevádzky zo siete
 * adsb.lol (globe_history, readsb heatmap 30-s vzorky), ODbL 1.0 + CC0,
 * zapečený do 0,25° RGBA PNG skriptom `scripts/build-air-density.mjs`
 * (proveniencia: local_data/air_density/SOURCE.md).
 *
 * WHY: rovnaký dôvod ako hustota lodí — živý feed je len to, čo prijímače
 * práve počujú; tento drape ukazuje, kam lietadlá lietajú, vrátane trás nad
 * oceánom, ktoré prijímače na brehu zachytia len na okrajoch. HISTORICKÉ a
 * MODELOVANÉ (jeden deň), nikdy živé — riadok panelu to hovorí (pravidlo 2).
 *
 * Poctivá hranica: pokrytie feederov adsb.lol je ako pri AIS silné v Európe,
 * Severnej Amerike a východnej Ázii, slabé nad oceánom a Afrikou. Obraz je
 * pravdivý o letoch aj o prijímačoch.
 *
 * Premostenie oceánu (používateľ: „nevieš to spraviť nad Atlantikom?"): bake
 * sleduje každý stroj podľa hex adresy a keď zmizne v cestovnej hladine a
 * objaví sa ≥ 500 km ďalej hodnovernou rýchlosťou, doplní úsek veľkokružnicou.
 * Skutočné lety toho dňa, INTERPOLOVANÁ dráha nad vodou — riadok panelu nesie
 * „medzery nad oceánom interpolované", sidecar `stats.bridged` nesie podiel.
 */

export const AIR_DENSITY_LAYER_ID = 'local-air-density';

const metaUrlDefault = new URL('./local_data/air_density/air-density.json', import.meta.url).href;
const pngUrlDefault = new URL('./local_data/air_density/air-density.png', import.meta.url).href;

/** Rovnaká alfa a zoom-fade ako lode — jedna reč pre všetky historické drapy. */
export const AIR_DENSITY_ALPHA_LIGHT = 0.85;
export const AIR_DENSITY_ALPHA_DARK = 0.45;
const AIR_ALPHAS = Object.freeze({ light: AIR_DENSITY_ALPHA_LIGHT, dark: AIR_DENSITY_ALPHA_DARK });
// Zoom-fade (2026-09-07, mriežka 0,05° ≈ 5,6 km): plášť znesie bližší pohľad
// než lode (0,25°), tak sa neskrýva už od 1 200 km — plný od 1 500 km, preč
// pod 400 km, kde už hovoria živé lietadlá.
export const AIR_DENSITY_FADE_IN_M = 1_500_000;
export const AIR_DENSITY_FADE_OUT_M = 400_000;
const AIR_FADE = Object.freeze({ fadeInM: AIR_DENSITY_FADE_IN_M, fadeOutM: AIR_DENSITY_FADE_OUT_M });

/**
 * Riadok zdroja: sieť, deň snímky, licencia, HISTORICKÉ. Pure.
 * @param {object|null} meta
 */
export function airDensitySourceLabel(meta) {
  const day = meta?.period || meta?.day || '2026';
  const bridged = (meta?.stats?.bridged?.gaps || 0) > 0 ? ` · ${t('airdensity.bridged')}` : '';
  return `adsb.lol · ADS-B ${day}${bridged} · ODbL 1.0 / CC0 · ${t('airdensity.historical')}`;
}

export function createAirDensityLayer({
  metaUrl = metaUrlDefault,
  pngUrl = pngUrlDefault,
  fetchImpl = null,
  imageLoader = undefined,
  primitiveFactory = undefined,
} = {}) {
  return createDensityDrapeLayer({
    id: AIR_DENSITY_LAYER_ID,
    name: 'Historická hustota letov',
    icon: '▨',
    metaUrl,
    pngUrl,
    sourceLabel: airDensitySourceLabel,
    alphas: AIR_ALPHAS,
    fade: AIR_FADE,
    logTag: 'AirDensity',
    sidecarLabel: 'air-density.json',
    fetchImpl,
    ...(imageLoader ? { imageLoader } : {}),
    ...(primitiveFactory ? { primitiveFactory } : {}),
  });
}

export default createAirDensityLayer();
