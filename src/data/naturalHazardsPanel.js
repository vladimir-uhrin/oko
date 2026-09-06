// src/data/naturalHazardsPanel.js
/**
 * @module naturalHazardsPanel
 * @description Skupina „Prírodné hrozby" v paneli vrstiev: zoskupí EXISTUJÚCE
 * riadky manažéra, nenahrádza ich ovládanie ani životný cyklus.
 *
 * 2026-09-05 („oprav, vylepši, pridaj hrozby, zlaď style"): skupina bola
 * oranžová škatuľa s vlastným nadpisom uprostred cyanového panelu a jej
 * podtitul len opakoval mená riadkov. Teraz je to sekcia v jazyku panelu
 * (mono nadpis s rozostupom ako `.panel-title`) a podtitul je ŽIVÝ súhrn
 * počtov zapnutých vrstiev — vypnuté sa nepočítajú, nula sa nepredstiera.
 */
import { t } from '../i18n.js';

/** Vrstvy patriace do skupiny, v poradí riadkov panelu. */
export const NATURAL_HAZARD_LAYER_IDS = Object.freeze([
  'earthquakes', 'volcanoes', 'natural-events', 'local-firms', 'shmu-radar',
]);

export function isNaturalHazardLayer(id) { return NATURAL_HAZARD_LAYER_IDS.includes(id); }

/**
 * Súhrnný riadok: „176 zemetrasení · 6 búrok a udalostí · radar zapnutý".
 * Pure. Vrstva bez počtu (radar je obraz, nie body) sa uvedie slovom.
 * @param {Array<{id: string, enabled?: boolean, stats?: {count?: number}}>} layers
 * @param {(key: string, vars?: object) => string} [translate]
 * @returns {string}
 */
export function hazardsSummary(layers, translate = t) {
  const byId = new Map((Array.isArray(layers) ? layers : []).map((l) => [l?.id, l]));
  const parts = [];
  for (const id of NATURAL_HAZARD_LAYER_IDS) {
    const layer = byId.get(id);
    if (!layer?.enabled) continue;
    const count = Number(layer.stats?.count);
    if (id === 'shmu-radar') { parts.push(translate('hazards.radar-on')); continue; }
    parts.push(translate(`hazards.count.${id}`, { n: Number.isFinite(count) ? count : 0 }));
  }
  return parts.length ? parts.join(' · ') : translate('hazards.none-enabled');
}

/**
 * Group existing manager rows without replacing their controls or lifecycle.
 * @param {Document} doc
 * @param {Array<object>} [layers] projekcia `manager.getAll()` pre živý súhrn
 */
export function createNaturalHazardsPanel(doc, layers = []) {
  const root = doc.createElement('section'); root.className = 'natural-hazards-card';
  root.setAttribute('aria-label', t('hazards.title'));
  const title = doc.createElement('h3'); title.textContent = t('hazards.title');
  const subtitle = doc.createElement('p'); subtitle.textContent = hazardsSummary(layers);
  root.appendChild(title); root.appendChild(subtitle);
  return root;
}
