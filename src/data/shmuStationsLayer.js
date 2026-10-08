// src/data/shmuStationsLayer.js
// Merania automatických staníc SHMÚ na mape (2026-10-08, sekcia POČASIE — „čo sa naozaj nameralo"):
// ~95 staníc, teplota v rámčeku farby teplotnej škály mapy (ako stanice na Windy); myš alebo klik / ťuknutie
// ukáže kartu so všetkými hodnotami (teplota, vietor a smer, nárazy, vlhkosť, tlak na stanici, zrážky,
// sneh, dohľadnosť) a časom merania. Stanice s polohou len podľa obce to v karte hovoria.
// Popisky sa neprekrývajú (declutterStationLabels). Nad 30 km výšky kamery ležia 13,5 km nad elipsoidom
// (nad farebným poľom meteo vrstvy), pod 30 km pri zemi bez hĺbkového testu.
//
// Dáta: /api/shmu-stations (opendata.shmu.sk, CC BY 4.0, server cache 5 min). Je to MERANIE, nie predpoveď.

import * as Cesium from 'cesium';
import { t, currentLanguage } from '../i18n.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, resolvePickId, unregisterPickOwner } from './pickRegistry.js';
import { STATIONS_URL, declutterStationLabels } from './shmuStations.js';
import { rampCssColor } from './meteogram.js';
import { windDirectionText } from './meteoPlaces.js';
import { warningTimeLabel } from './weatherWarnings.js';

export const SHMU_STATIONS_LAYER_ID = 'shmu-stations';
export const STATION_PICK_PREFIX = 'shmu-st:';
export const STATION_HIGH_M = 13_500;
export const STATION_GROUND_BELOW_M = 30_000;
/** Medzera medzi bodom stanice a pravým okrajom jej hodnoty (px). */
export const STATION_LABEL_GAP_PX = 6;

const fmt = (v, digits = 0, lang = 'sk') => {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const s = v.toFixed(digits);
  return lang === 'en' ? s : s.replace('.', ',');
};

/** Text popisku stanice: „18°" (zaokrúhlená teplota) alebo „–". Pure. */
export function stationLabelText(s) {
  return Number.isFinite(s?.t) ? `${Math.round(s.t)}°` : '–';
}

/** Farba textu stanice: teplotná škála mapy zosvetlená o 45 % k bielej (čitateľná na poli); bez teploty sivá. Pure. */
export function stationTextColor(temp) {
  const css = rampCssColor('temp', temp);
  const m = css && /rgb\((\d+), (\d+), (\d+)\)/.exec(css);
  if (!m) return 'rgb(200, 205, 210)';
  const mix = (c) => Math.round(Number(c) + (255 - Number(c)) * 0.45);
  return `rgb(${mix(m[1])}, ${mix(m[2])}, ${mix(m[3])})`;
}

/**
 * Riadky karty stanice [kľúč textu, hodnota]; chýbajúce hodnoty vynechá. Pure.
 */
export function stationCardRows(s, lang = 'sk') {
  const rows = [];
  const add = (key, value) => { if (value) rows.push([key, value]); };
  add('st.temp', fmt(s.t, 1, lang) && `${fmt(s.t, 1, lang)} °C`);
  if (Number.isFinite(s.wind)) {
    const dir = Number.isFinite(s.dir) ? ` · ${windDirectionText(...dirToUv(s.dir))}` : '';
    add('st.wind', `${fmt(s.wind, 1, lang)} m/s${dir}`);
  }
  add('st.gust', fmt(s.gust, 1, lang) && `${fmt(s.gust, 1, lang)} m/s`);
  add('st.rh', fmt(s.rh, 0, lang) && `${fmt(s.rh, 0, lang)} %`);
  add('st.pressure', fmt(s.p, 1, lang) && `${fmt(s.p, 1, lang)} hPa`);
  add('st.precip', s.precip !== null && s.precip !== undefined ? `${fmt(s.precip, 1, lang)} mm${Number.isFinite(s.windowMin) ? ` / ${s.windowMin} min` : ''}` : null);
  add('st.snow', fmt(s.snow, 0, lang) && `${fmt(s.snow, 0, lang)} cm`);
  add('st.vis', Number.isFinite(s.vis) ? (s.vis >= 1000 ? `${fmt(s.vis / 1000, 1, lang)} km` : `${fmt(s.vis, 0, lang)} m`) : null);
  return rows;
}

/** Meteorologický smer (odkiaľ fúka) → zložky u, v pre windDirectionText. Pure. */
function dirToUv(dirFrom) {
  const r = (dirFrom * Math.PI) / 180;
  return [-Math.sin(r), -Math.cos(r)];
}

function createStationCard(doc) {
  const root = doc.createElement('section');
  root.className = 'meteo-place-card weather-station-card';
  root.hidden = true;
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'meteo-place-close';
  close.textContent = '×';
  close.setAttribute('aria-label', t('meteo.place.close'));
  const body = doc.createElement('div');
  root.append(close, body);
  doc.body.append(root);
  let pinned = false;
  close.addEventListener('click', () => { pinned = false; root.hidden = true; });
  const onKey = (e) => { if (e.key === 'Escape' && !root.hidden) { pinned = false; root.hidden = true; } };
  doc.addEventListener?.('keydown', onKey);
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  return {
    show(s, at, { pin = false, lang = 'sk' } = {}) {
      const dl = el('dl');
      for (const [key, value] of stationCardRows(s, lang)) dl.append(el('dt', '', t(key)), el('dd', '', value));
      const sub = `${t('st.measured', { at: warningTimeLabel(new Date(s.at).toISOString(), lang) })}${Number.isFinite(s.elev) ? ` · ${s.elev} m n. m.` : ''}`;
      const nodes = [el('h3', '', t('st.title', { name: s.name })), el('p', 'meteo-place-sub', sub), dl];
      if (s.approx) nodes.push(el('p', 'meteo-place-note', t('st.approx')));
      nodes.push(el('p', 'meteo-place-note', t('st.source')));
      body.replaceChildren(...nodes);
      pinned = pin;
      root.hidden = false;
      const view = doc.defaultView;
      const w = root.offsetWidth || 240;
      const h = root.offsetHeight || 220;
      root.style.left = `${Math.max(8, Math.min((view?.innerWidth ?? 1200) - w - 8, at.x + 16))}px`;
      root.style.top = `${Math.max(8, Math.min((view?.innerHeight ?? 800) - h - 8, at.y - 20))}px`;
    },
    hide({ force = false } = {}) { if (pinned && !force) return; pinned = false; root.hidden = true; },
    isPinned: () => pinned,
    destroy() { doc.removeEventListener?.('keydown', onKey); root.remove(); },
  };
}

/** Kolekcia popiskov staníc (injektovateľná v testoch). */
export function createStationLabels() {
  return new Cesium.LabelCollection();
}

export function createShmuStationsLayer({
  fetchImpl = null,
  doc = globalThis.document,
  labelsFactory = createStationLabels,
  cardFactory = createStationCard,
  now = () => Date.now(),
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _enabled = false;
  let _stations = [];
  let _byId = new Map();
  let _labels = null;
  let _shown = new Map(); // id → label
  let _observedAt = null;
  let _stale = false;
  let _lastError = null;
  let _ground = null;
  let _postRender = null;
  let _lastRefresh = 0;
  let _card = null;
  let _listeners = null;
  let _hoverTimer = null;
  let _press = null;

  const lang = () => (currentLanguage?.() === 'en' ? 'en' : 'sk');

  function positionOf(s, ground) {
    return Cesium.Cartesian3.fromDegrees(s.lon, s.lat, ground ? (Number.isFinite(s.elev) ? s.elev + 30 : 300) : STATION_HIGH_M);
  }

  function refreshLabels(force = false) {
    if (!_viewer || !_enabled || !_labels) return;
    const ms = now();
    if (!force && ms - _lastRefresh < 250) return;
    _lastRefresh = ms;
    const scene = _viewer.scene;
    const h = scene.camera?.positionCartographic?.height;
    const ground = Number.isFinite(h) && h < STATION_GROUND_BELOW_M;
    const modeChanged = ground !== _ground;
    _ground = ground;
    const occluder = scene.globe?.ellipsoid ? new Cesium.EllipsoidalOccluder(scene.globe.ellipsoid, scene.camera.positionWC) : null;
    const items = [];
    for (const s of _stations) {
      const pos = positionOf(s, ground);
      if (occluder && !occluder.isPointVisible(pos)) continue;
      const win = Cesium.SceneTransforms.worldToWindowCoordinates?.(scene, pos) || Cesium.SceneTransforms.wgs84ToWindowCoordinates?.(scene, pos);
      if (!win) continue;
      items.push({ id: s.id, x: win.x, y: win.y, text: stationLabelText(s), approx: s.approx, s, pos });
    }
    const keep = declutterStationLabels(items, { gap: STATION_LABEL_GAP_PX });
    for (const [id, label] of _shown) {
      if (!keep.has(id) || modeChanged) { _labels.remove(label); _shown.delete(id); }
    }
    for (const it of items) {
      if (!keep.has(it.id) || _shown.has(it.id)) continue;
      // Farebný text s tmavým obrysom, BEZ pozadia: pozadie popisku ide v priesvitnom prechode a meteo pole
      // ho prekreslí (overené na snímke 2026-10-08). Farba = teplotná škála mapy, zosvetlená — odlíši
      // namerané hodnoty od bielych modelových teplôt pri menách miest.
      _shown.set(it.id, _labels.add({
        id: `${STATION_PICK_PREFIX}${it.id}`,
        position: it.pos,
        text: it.text,
        font: '800 13px Inter, "Segoe UI", system-ui, sans-serif',
        fillColor: Cesium.Color.fromCssColorString(stationTextColor(it.s.t)).withAlpha(it.s.approx ? 0.85 : 1),
        outlineColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.9)'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        // Naľavo od bodu: mená miest idú doprava (meteoPlaceLabels) — stanica v obci by inak prekryla
        // modelovú teplotu pod menom („Martin 14° 11°", snímka 2026-10-08).
        horizontalOrigin: Cesium.HorizontalOrigin.RIGHT,
        pixelOffset: new Cesium.Cartesian2(-STATION_LABEL_GAP_PX, 0),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        // Pri zemi (pod 30 km) bez hĺbkového testu, inak by ich zakryl terén / 3D budovy; vysoko nie —
        // tam ich nad farebným poľom drží výška a poradie (raiseToTop nižšie).
        disableDepthTestDistance: ground ? Number.POSITIVE_INFINITY : undefined,
      }));
    }
    // Meteo pole (drapéria bez hĺbkového testu) a jeho mapa vznikajú aj po nás — popisky musia ísť navrch,
    // inak ich pole prekreslí (overené na snímke 2026-10-08: stanice boli len tiene pod poľom).
    try { if (scene.primitives?.contains?.(_labels)) scene.primitives.raiseToTop?.(_labels); } catch { /* staršie Cesium */ }
    governorRequestRender('shmu-stations');
  }

  function stationAt(x, y) {
    let picked = null;
    try { picked = _viewer?.scene?.pick?.(new Cesium.Cartesian2(x, y)); } catch { picked = null; }
    const id = resolvePickId(picked);
    return id && id.startsWith(STATION_PICK_PREFIX) ? _byId.get(id.slice(STATION_PICK_PREFIX.length)) : null;
  }

  function localPoint(e) {
    const r = _viewer.scene.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function showCard(s, at, pin) {
    if (!_card && doc?.body) _card = cardFactory(doc);
    _card?.show(s, at, { pin, lang: lang() });
  }

  function onMove(e) {
    if (e.buttons || e.pointerType === 'touch' || _card?.isPinned?.()) return;
    clearTimeout(_hoverTimer);
    const at = { x: e.clientX, y: e.clientY };
    const p = localPoint(e);
    _hoverTimer = setTimeout(() => {
      const s = stationAt(p.x, p.y);
      if (s) showCard(s, at, false); else _card?.hide();
    }, 90);
  }
  function onDown(e) { _press = { x: e.clientX, y: e.clientY, at: now() }; }
  function onUp(e) {
    const press = _press;
    _press = null;
    if (!press || !_enabled) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6 || now() - press.at > 600) return;
    const p = localPoint(e);
    const s = stationAt(p.x, p.y);
    if (s) showCard(s, { x: e.clientX, y: e.clientY }, true); else _card?.hide({ force: true });
  }

  function attach() {
    const canvas = _viewer?.scene?.canvas;
    if (!canvas?.addEventListener || _listeners) return;
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    _listeners = canvas;
    registerPickOwner(SHMU_STATIONS_LAYER_ID, (id) => String(id).startsWith(STATION_PICK_PREFIX));
  }
  function detach() {
    clearTimeout(_hoverTimer);
    if (_listeners) {
      _listeners.removeEventListener('pointermove', onMove);
      _listeners.removeEventListener('pointerdown', onDown);
      _listeners.removeEventListener('pointerup', onUp);
      _listeners = null;
    }
    unregisterPickOwner(SHMU_STATIONS_LAYER_ID);
    _card?.hide({ force: true });
  }

  function ensureLabels() {
    if (_labels || !_viewer) return;
    _labels = labelsFactory();
    _viewer.scene.primitives.add(_labels);
  }
  function clearLabels() {
    if (_labels) { try { _viewer?.scene?.primitives?.remove(_labels); } catch { /* scéna zanikla */ } }
    _labels = null;
    _shown = new Map();
    _ground = null;
  }

  const layer = {
    id: SHMU_STATIONS_LAYER_ID,
    name: 'Stanice SHMÚ (merania)',
    icon: '◉',
    get source() {
      const at = _observedAt ? ` · ${warningTimeLabel(_observedAt, lang())}` : '';
      return `SHMÚ — opendata.shmu.sk (CC BY 4.0)${at} · ${t('st.observation')}`;
    },
    updateInterval: 5 * 60 * 1000,

    init(viewer) {
      _viewer = viewer;
      if (viewer?.scene?.postRender?.addEventListener && !_postRender) {
        _postRender = () => refreshLabels(false);
        viewer.scene.postRender.addEventListener(_postRender);
      }
    },

    enable() {
      _enabled = true;
      ensureLabels();
      attach();
      void this.update();
    },

    disable() {
      _enabled = false;
      detach();
      clearLabels();
      governorRequestRender('shmu-stations');
    },

    async update() {
      try {
        const response = await doFetch(STATIONS_URL);
        if (!response?.ok) { _lastError = `stations HTTP ${response?.status}`; return false; }
        const payload = await response.json();
        if (!Array.isArray(payload?.stations)) { _lastError = 'malformed stations'; return false; }
        _stations = payload.stations.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
        _byId = new Map(_stations.map((s) => [s.id, s]));
        _observedAt = payload.observedAt || null;
        _stale = payload.stale === true;
        _lastError = null;
        if (_enabled) {
          ensureLabels();
          for (const label of _shown.values()) _labels.remove(label);
          _shown = new Map();
          refreshLabels(true);
        }
        return true;
      } catch (error) {
        _lastError = String(error?.message || error);
        return false;
      }
    },

    getStats() {
      return { count: _stations.length, lastUpdate: _observedAt ? Date.parse(_observedAt) : null, error: _lastError, stale: _stale };
    },

    _getStateForTest() {
      return { enabled: _enabled, stations: _stations.length, shown: _shown.size, ground: _ground };
    },

    destroy(viewer) {
      this.disable();
      if (_postRender) { (viewer || _viewer)?.scene?.postRender?.removeEventListener?.(_postRender); _postRender = null; }
      _card?.destroy(); _card = null;
      _viewer = null;
    },
  };
  return layer;
}

export default createShmuStationsLayer();
