// src/weatherDock.js
// Výber vrstiev počasia ako na Windy (2026-10-08, vlastník: „ako na štýl Windy"; krok 2 — rozloženie): keď je
// zapnutá meteo vrstva, vpravo je zvislý zoznam s ikonami — polia (vietor, nárazy, teplota, tlak, zrážky,
// oblačnosť), pod nimi prekrytia (radar Európy, radar SHMÚ, výstrahy, stanice, prúdnice), pri vetre výška
// hladiny a na spodku legenda aktívneho poľa. Na mobile je to vodorovný pás nad časovou osou.
// Ovláda sa cez správcu vrstiev (setLayerParams / setEnabled) — tie isté cesty ako čipy v paneli POČASIE,
// takže stav je jeden. Monochromatické ikony Material Symbols, žiadne emoji.

import { METEO_FIELD_ORDER, WIND_LEVELS, isWindField } from './data/meteoField.js';
import { radarLegendStops } from './data/shmuRadarGrid.js';

/** Radary, ktoré farebné pole nahrádzajú (radarPresence.js). */
export const DOCK_RADARS = Object.freeze(['opera-radar', 'shmu-radar']);

export const METEO_ID = 'meteo-gfs';
/** Pole → ikona Material Symbols. */
export const FIELD_ICONS = Object.freeze({ wind: 'air', gust: 'storm', temp: 'device_thermostat', pressure: 'speed', precip: 'rainy', clouds: 'cloud' });
/** Prekrytia: id vrstvy alebo parameter meteo vrstvy, ikona, kľúč textu. */
export const DOCK_OVERLAYS = Object.freeze([
  Object.freeze({ id: 'opera-radar', icon: 'radar', key: 'dock.radar-eu' }),
  Object.freeze({ id: 'shmu-radar', icon: 'track_changes', key: 'dock.radar-sk' }),
  Object.freeze({ id: 'shmu-warnings', icon: 'warning', key: 'dock.warnings' }),
  Object.freeze({ id: 'shmu-stations', icon: 'sensors', key: 'dock.stations' }),
  Object.freeze({ id: 'particles', icon: 'waves', key: 'dock.particles', param: true }),
]);

/** Poradie polí v dock: vietor a nárazy spolu, potom ostatné (METEO_FIELD_ORDER má nárazy na konci). Pure. */
export function dockFieldOrder(order = METEO_FIELD_ORDER) {
  const rest = order.filter((id) => id !== 'wind' && id !== 'gust');
  return [...(order.includes('wind') ? ['wind'] : []), ...(order.includes('gust') ? ['gust'] : []), ...rest];
}

export const DOCK_COLLAPSE_KEY = 'oko.weatherDock.collapsed';

/**
 * Zbalený (len ikony) na začiatku? Uložená voľba používateľa má prednosť; bez nej zbalený na nízkej obrazovke
 * počítača (výber by sa nezmestil a zakrýval mapu, 2026-10-09). Pure.
 */
export function initialCollapsed(stored, viewportHeight) {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return Number.isFinite(viewportHeight) && viewportHeight < 820;
}

/** Ktoré pole je v dock aktívne (výšková hladina vetra = „vietor"). Pure. */
export function activeDockField(field) {
  return isWindField(field) ? 'wind' : field;
}

/** Legenda radaru (dBZ) v tvare legendy rampy. Pure. */
export function radarDockLegend() {
  return radarLegendStops().map((s) => ({ color: s.css, label: `${s.min} dBZ` }));
}

/** CSS gradient z legendy rampy [{color, label}] a jej krajné popisky. Pure. */
export function legendGradient(legend) {
  const stops = (legend || []).filter((s) => s && s.color);
  if (stops.length < 2) return null;
  const css = `linear-gradient(90deg, ${stops.map((s, i) => `${s.color} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(', ')})`;
  return { css, first: String(stops[0].label ?? ''), last: String(stops.at(-1).label ?? '') };
}

export function createWeatherDock(doc, { dataManager, t, parent = doc.body } = {}) {
  const root = doc.createElement('nav');
  root.id = 'weather-dock';
  root.className = 'weather-dock';
  root.hidden = true;
  root.setAttribute('aria-label', t('dock.title'));
  parent.append(root);

  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  function button(icon, label, onClick, extraCls = '') {
    const b = el('button', `weather-dock-btn ${extraCls}`.trim());
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(el('span', 'material-symbols-outlined', icon), el('span', 'weather-dock-label', label));
    b.addEventListener('click', onClick);
    return b;
  }

  const params = () => dataManager.getLayerParams?.(METEO_ID) || {};
  const setParams = (p) => dataManager.setLayerParams?.(METEO_ID, p, { origin: 'user' });
  const radarOn = () => DOCK_RADARS.some((id) => Boolean(dataManager.isEnabled?.(id)));
  const radarsOff = () => { for (const id of DOCK_RADARS) if (dataManager.isEnabled?.(id)) dataManager.setEnabled?.(id, false, { origin: 'user' }); };
  const toggleLayer = (id) => dataManager.setEnabled?.(id, !dataManager.isEnabled?.(id), { origin: 'user' });

  const fields = el('div', 'weather-dock-group fields');
  const fieldButtons = new Map();
  for (const id of dockFieldOrder()) {
    // Ako na Windy: pole je samostatná vrstva — klik na pole vypne radar, ktorý ho nahrádzal.
    const b = button(FIELD_ICONS[id] || 'circle', t(`meteo.chip-${id}`), () => { radarsOff(); setParams({ field: id }); });
    b.dataset.field = id;
    fieldButtons.set(id, b);
    fields.append(b);
  }
  const levels = el('div', 'weather-dock-levels');
  const levelButtons = new Map();
  for (const l of WIND_LEVELS) {
    const b = el('button', 'weather-dock-level', l.label);
    b.type = 'button';
    b.title = t('dock.level', { level: l.label });
    b.addEventListener('click', () => setParams({ field: l.id }));
    levelButtons.set(l.id, b);
    levels.append(b);
  }
  const overlays = el('div', 'weather-dock-group overlays');
  const overlayButtons = new Map();
  for (const o of DOCK_OVERLAYS) {
    const b = button(o.icon, t(o.key), () => (o.param ? setParams({ particles: !params().particles }) : toggleLayer(o.id)), 'overlay');
    overlayButtons.set(o.id, b);
    overlays.append(b);
  }
  const legend = el('div', 'weather-dock-legend');
  const legendBar = el('div', 'weather-dock-legend-bar');
  const legendLabels = el('div', 'weather-dock-legend-labels');
  legend.append(legendBar, legendLabels);
  // Zbaliť / rozbaliť na samotné ikony (2026-10-09) — voľba sa pamätá v prehliadači (len pohodlie, nič dôležité).
  const view = doc.defaultView;
  let stored = null;
  try { stored = view?.localStorage?.getItem(DOCK_COLLAPSE_KEY) ?? null; } catch { stored = null; }
  let collapsed = initialCollapsed(stored, view?.innerHeight);
  const toggle = el('button', 'weather-dock-toggle');
  toggle.type = 'button';
  const toggleIcon = el('span', 'material-symbols-outlined', '');
  toggle.append(toggleIcon);
  const applyCollapsed = () => {
    root.classList.toggle('collapsed', collapsed);
    toggleIcon.textContent = collapsed ? 'left_panel_open' : 'right_panel_close';
    const label = t(collapsed ? 'dock.expand' : 'dock.collapse');
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    try { view?.localStorage?.setItem(DOCK_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* bez úložiska platí do obnovenia */ }
    applyCollapsed();
    refresh();
  });
  applyCollapsed();
  root.append(toggle, fields, levels, overlays, legend);

  function refresh() {
    const on = Boolean(dataManager.isEnabled?.(METEO_ID));
    root.hidden = !on;
    if (!on) return;
    const p = params();
    const field = p.field || 'wind';
    const radar = radarOn();
    const active = radar ? null : activeDockField(field);
    for (const [id, b] of fieldButtons) { b.classList.toggle('active', id === active); b.setAttribute('aria-pressed', String(id === active)); }
    levels.hidden = radar || !isWindField(field) || collapsed;
    for (const [id, b] of levelButtons) b.classList.toggle('active', id === field);
    for (const o of DOCK_OVERLAYS) {
      const state = o.param ? p.particles !== false : Boolean(dataManager.isEnabled?.(o.id));
      const b = overlayButtons.get(o.id);
      b.classList.toggle('active', state);
      b.setAttribute('aria-pressed', String(state));
      b.hidden = !o.param && !dataManager.layers?.has?.(o.id);
    }
    const controls = dataManager.layers?.get?.(METEO_ID)?.module?.getRowControls?.();
    const g = legendGradient(radar ? radarDockLegend() : controls?.legend);
    legend.hidden = !g;
    if (g) {
      legendBar.style.background = g.css;
      legendLabels.replaceChildren(el('span', '', g.first), el('span', '', g.last));
    }
  }

  const unsubscribe = dataManager.subscribe?.((change) => {
    if (!change || !change.layerId || change.layerId === METEO_ID || DOCK_OVERLAYS.some((o) => o.id === change.layerId)) refresh();
  }) || (() => {});
  refresh();

  return {
    element: root,
    refresh,
    destroy() { unsubscribe(); root.remove(); },
  };
}
