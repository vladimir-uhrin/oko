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
import { GIBS_DAY_MAX_BACK, getGibsDayOffset, gibsDayForOffset, setGibsDayOffset } from './gibsDay.js';

/**
 * Text pri posuvníku: „najnovší (2026-09-05)" alebo „2026-08-20 · 16 d dozadu". Pure.
 * @param {number} offset
 * @param {number} [nowMs]
 * @param {(key: string, vars?: object) => string} [translate]
 * @returns {string}
 */
export function gibsDayLabel(offset, nowMs = Date.now(), translate = t) {
  const day = gibsDayForOffset(offset, nowMs);
  return offset > 0 ? translate('gibs.day-back', { day, n: offset }) : translate('gibs.day-latest', { day });
}

/**
 * Riadok posuvníka „Deň mozaiky". Posuvník zapisuje priamo do gibsDay.js —
 * vrstvy sa prestavia samy (onGibsDayChange), manažér nemusí nič vedieť.
 * Znovu sa vytvorí pri každom prebudovaní panelu s aktuálnou hodnotou.
 * @param {Document} doc
 * @returns {HTMLElement}
 */
export function createGibsDayRow(doc) {
  const row = doc.createElement('div');
  row.className = 'gibs-day-row';
  const label = doc.createElement('span');
  label.className = 'gibs-day-label';
  label.textContent = t('gibs.day-label');
  const slider = doc.createElement('input');
  slider.type = 'range';
  slider.className = 'param-slider gibs-day-slider';
  slider.min = '0';
  slider.max = String(GIBS_DAY_MAX_BACK);
  slider.step = '1';
  slider.value = String(getGibsDayOffset());
  slider.setAttribute('aria-label', t('gibs.day-aria'));
  const value = doc.createElement('span');
  value.className = 'gibs-day-value';
  value.textContent = gibsDayLabel(getGibsDayOffset());
  slider.addEventListener('input', () => {
    setGibsDayOffset(slider.value);
    value.textContent = gibsDayLabel(getGibsDayOffset());
  });
  row.appendChild(label);
  row.appendChild(slider);
  row.appendChild(value);
  return row;
}

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
  root.appendChild(createGibsDayRow(doc));
  return root;
}
