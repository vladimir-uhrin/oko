// src/data/gibsOverlayPanel.js
/**
 * @module gibsOverlayPanel
 * @description Skupina „Zem zo satelitu (NASA)" v paneli vrstiev: zoskupí
 * EXISTUJÚCE riadky manažéra, nenahrádza ich ovládanie ani životný cyklus —
 * presne vzor naturalHazardsPanel.js, aj CSS (`.layer-group-card` je alias
 * `.natural-hazards-card`, nech obe sekcie hovoria jazykom panelu).
 *
 * Podtitul je ŽIVÝ: zapnuté vrstvy a deň mozaiky, ktorý kreslia — pri denných
 * produktoch je deň to jediné, čo operátor potrebuje vedieť hneď (pravidlo 2).
 */
import { t } from '../i18n.js';
import { GIBS_OVERLAY_LAYER_IDS } from './gibsOverlays.js';

export function isGibsOverlayLayer(id) { return GIBS_OVERLAY_LAYER_IDS.includes(id); }

/**
 * Súhrnný riadok: „teplota mora · zrážky · 2026-09-05 UTC" (deň sa uvedie
 * raz, ak ho všetky zapnuté zdieľajú; inak pri každej). Pure.
 * @param {Array<{id: string, enabled?: boolean, stats?: {day?: string|null}}>} layers
 * @param {(key: string, vars?: object) => string} [translate]
 * @returns {string}
 */
export function gibsOverlaySummary(layers, translate = t) {
  const byId = new Map((Array.isArray(layers) ? layers : []).map((l) => [l?.id, l]));
  const on = GIBS_OVERLAY_LAYER_IDS.map((id) => byId.get(id)).filter((l) => l?.enabled);
  if (!on.length) return translate('gibs.none-enabled');
  const days = new Set(on.map((l) => l.stats?.day).filter(Boolean));
  const names = on.map((l) => {
    const short = translate(`gibs.short.${l.id}`);
    return days.size > 1 && l.stats?.day ? `${short} ${l.stats.day}` : short;
  });
  const day = days.size === 1 ? ` · ${[...days][0]} UTC` : '';
  return `${names.join(' · ')}${day}`;
}

/**
 * Group existing manager rows without replacing their controls or lifecycle.
 * @param {Document} doc
 * @param {Array<object>} [layers] projekcia `manager.getAll()` pre živý súhrn
 */
export function createGibsOverlayPanel(doc, layers = []) {
  const root = doc.createElement('section');
  root.className = 'natural-hazards-card layer-group-card gibs-overlay-card';
  root.setAttribute('aria-label', t('gibs.title'));
  const title = doc.createElement('h3'); title.textContent = t('gibs.title');
  const subtitle = doc.createElement('p'); subtitle.textContent = gibsOverlaySummary(layers);
  root.appendChild(title); root.appendChild(subtitle);
  return root;
}
