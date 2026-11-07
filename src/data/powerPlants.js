// src/data/powerPlants.js
/**
 * @module powerPlants
 * @description Elektrárne sveta ≥ 100 MW (ELEKTRINA, 2026-11-07; vlastník:
 * „plynovody, elektrinu a všetko na vrchol vylepšenia"). Sieť ≥ 220 kV
 * ukazuje, KADE elektrina tečie; táto vrstva, ODKIAĽ — jadro, voda, uhlie,
 * plyn, vietor, slnko.
 *
 * Zdroj: WRI Global Power Plant Database 1.3.0 (CC BY 4.0) = stav 2021,
 * snímok `scripts/build-power-plants.mjs`. Nie je to živý register: karta to
 * hovorí rokom databázy a overené zmeny po vydaní (zatvorené uhoľné
 * elektrárne SR, Mochovce 3) nesú `corrected` a vlastný stav (pravidlo 2).
 *
 * Modul je čistý (bez Cesia a DOM) — číta ho build aj vrstva.
 */
import { POWER_MIX_GROUPS } from './powerMarket.js';

export const POWER_PLANTS_LAYER_ID = 'local-power-plants';
/** Rok, ku ktorému databáza platí (WRI GPPD 1.3.0, jún 2021). */
export const POWER_PLANTS_DATA_YEAR = 2021;

/** Skupiny palív — tie isté kľúče a farby ako mix výroby v paneli energie. */
export const PLANT_FUELS = Object.freeze(['nuclear', 'hydro', 'coal', 'gas', 'oil', 'wind', 'solar', 'bio', 'other']);

const FUEL_COLOR = Object.freeze(Object.fromEntries(POWER_MIX_GROUPS.map((g) => [g.key, g.color])));
/** Zatvorená elektráreň: sivá, aby sa nečítala ako výroba. */
export const PLANT_CLOSED_COLOR = '#5d6670';

const RAW_TO_GROUP = Object.freeze({
  nuclear: 'nuclear',
  hydro: 'hydro',
  coal: 'coal',
  gas: 'gas',
  oil: 'oil',
  petcoke: 'oil',
  wind: 'wind',
  solar: 'solar',
  biomass: 'bio',
  waste: 'bio',
  geothermal: 'bio',
  'wave and tidal': 'bio',
});

/** Palivo WRI („Nuclear", „Wave and Tidal" …) → skupina z PLANT_FUELS. Pure. */
export function plantFuelGroup(raw) {
  return RAW_TO_GROUP[String(raw || '').trim().toLowerCase()] || 'other';
}

/** Farba značky podľa paliva (zatvorená = sivá). Pure. */
export function plantColor(props) {
  if (props?.status === 'closed') return PLANT_CLOSED_COLOR;
  return FUEL_COLOR[props?.fuel] || FUEL_COLOR.other || '#9aa5b1';
}

/**
 * Dôležitosť pre stupne popisu (localLabelLod: 300 / 150 / 60). Z kontinentu
 * len giganty ≥ 1 GW, bližšie ≥ 300 MW, zblízka všetko.
 */
export function plantImportance(props) {
  const mw = Number(props?.mw);
  if (!Number.isFinite(mw)) return 0;
  if (props?.status === 'closed') return 60;
  if (mw >= 1000) return 300;
  if (mw >= 300) return 150;
  return 60;
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');

/** 1 411 → „1 411 MW", 2 500 → „2,5 GW" (SK) / „2.5 GW" (EN). Pure. */
export function formatPlantMw(mw, lang = 'sk') {
  const v = Number(mw);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 2000) return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 }).format(v / 1000)} GW`;
  return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(v)} MW`;
}

/** 7 197 GWh → „7,2 TWh". Pure. */
export function formatPlantGwh(gwh, lang = 'sk') {
  const v = Number(gwh);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1000) return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 }).format(v / 1000)} TWh`;
  return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(v)} GWh`;
}

/**
 * Riadky karty elektrárne (bez názvu — ten je titulok).
 * @param {object} props vlastnosti feature (viď build)
 * @param {(key:string, vars?:object)=>string} translate
 * @param {string} [lang]
 * @returns {string[]}
 */
export function plantOverlayCopy(props, translate, lang = 'sk') {
  const p = props || {};
  const lines = [];
  const head = [translate(`plant.fuel-${PLANT_FUELS.includes(p.fuel) ? p.fuel : 'other'}`), formatPlantMw(p.mw, lang)].filter(Boolean).join(' · ');
  if (head) lines.push(head);
  if (p.status === 'closed') {
    lines.push(translate('plant.closed', { date: p.closed || '' }).trim());
  } else if (p.gen_gwh && p.gen_year) {
    lines.push(translate('plant.generation', { v: formatPlantGwh(p.gen_gwh, lang), year: p.gen_year }));
  }
  if (p.year) lines.push(translate('plant.commissioned', { year: p.year }));
  if (p.owner) lines.push(String(p.owner));
  lines.push(translate(p.corrected ? 'plant.data-corrected' : 'plant.data-year', { year: POWER_PLANTS_DATA_YEAR }));
  return lines;
}

/** Vlajka pred názvom (ISO2 z buildu). Pure. */
export function plantTitleFlag(props) {
  const cc = String(props?.cc || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}
