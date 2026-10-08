// src/data/shmuWarningsLayer.js
// Výstrahy SHMÚ na mape Slovenska (2026-10-08, sekcia POČASIE, „ako Windy"): okresy s výstrahou
// zafarbené podľa stupňa (1. žltá, 2. oranžová, 3. červená), plnšie keď výstraha už platí, slabšie
// keď je len ohlásená dopredu. Myš nad okresom alebo klik / ťuknutie ukáže kartu s NEZMENENÝM textom
// SHMÚ (udalosť, hlavička, od – do, popis, odporúčanie) a časom vydania.
//
// Kreslenie: nad 30 km výšky kamery okresy 11,5 km nad elipsoidom — nad farebným poľom meteo vrstvy
// (drapéria 10 km, pobrežia 11 km), ktoré pod 30 km mizne; pod 30 km priamo na teréne (GroundPrimitive,
// aj na fotoreálnych 3D dlaždiciach).
//
// Dáta: /api/weather-warnings (MeteoAlarm feeds-slovakia = CAP výstrahy SHMÚ, server cache 5 min),
// polygóny okresov public/meteo-warnings/sk-okresy.json (geoBoundaries / OpenStreetMap, ODbL).

import * as Cesium from 'cesium';
import { t, currentLanguage } from '../i18n.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, resolvePickId, unregisterPickOwner } from './pickRegistry.js';
import { WARNINGS_URL, WARNING_LEVELS, districtStates, isActiveAt, warningTimeLabel } from './weatherWarnings.js';

export const SHMU_WARNINGS_LAYER_ID = 'shmu-warnings';
export const WARN_PICK_PREFIX = 'shmu-warn:';
export const DISTRICTS_URL = '/meteo-warnings/sk-okresy.json';
export const WARN_ELEVATED_HEIGHT_M = 11_500;
/** Pod touto výškou kamery sa okresy kreslia na teréne (meteo pole tu už nie je). */
export const WARN_GROUND_BELOW_M = 30_000;
const FILL_ALPHA_ACTIVE = 0.42;
const FILL_ALPHA_UPCOMING = 0.2;
/**
 * Pri zemi (pod 30 km, 3D dlaždice) slabšia výplň — plná zaliala celý sklopený pohľad žltou a mapa zanikla;
 * 0,14 bola na tmavých dlaždiciach skoro neviditeľná (snímky 2026-10-08). Obrys na teréne (GroundPolylinePrimitive)
 * sa na fotoreálnych dlaždiciach nevykreslil — hranicu okresu ukazuje okraj výplne.
 */
const GROUND_ALPHA_ACTIVE = 0.24;
const GROUND_ALPHA_UPCOMING = 0.13;

/**
 * Model karty okresu pre DOM. Pure.
 * @param {string} districtName
 * @param {Array<object>} warnings výstrahy okresu (normalizeMeteoalarm)
 */
export function warningCardModel(districtName, warnings, { lang = 'sk', nowMs = Date.now(), translate = t } = {}) {
  const en = lang === 'en';
  const items = [...(warnings || [])]
    .sort((a, b) => b.level - a.level || String(a.onset).localeCompare(String(b.onset)))
    .map((w) => ({
      color: WARNING_LEVELS[w.level]?.color || '#ffd200',
      degree: translate('warn.degree', { n: WARNING_LEVELS[w.level]?.degree ?? '?' }),
      type: translate(`warn.type.${w.type}`),
      event: (en && w.eventEn) || w.event,
      headline: (en && w.headlineEn) || w.headline,
      description: (en && w.descriptionEn) || w.description,
      instruction: (en && w.instructionEn) || w.instruction,
      when: `${warningTimeLabel(w.onset, lang)} – ${warningTimeLabel(w.expires, lang)}`,
      active: isActiveAt(w, nowMs),
      sent: warningTimeLabel(w.sent, lang),
    }));
  return { title: translate('warn.card-title', { name: districtName }), items };
}

/**
 * Poloha karty pri kurzore v okne; spodok nad `bottomLimit` (vrch meteogramu), výška orezaná na
 * dostupné miesto (karta sa potom posúva). Pure.
 */
export function cardBox({ at, width, height, viewW, viewH, bottomLimit = null, gap = 8 }) {
  const bottom = Number.isFinite(bottomLimit) ? Math.min(viewH, bottomLimit) - gap : viewH - gap;
  const maxHeight = Math.max(120, bottom - gap);
  const h = Math.min(height, maxHeight);
  const x = Math.max(gap, Math.min(viewW - width - gap, at.x + 16));
  const y = Math.max(gap, Math.min(bottom - h, at.y - 20));
  return { x: Math.round(x), y: Math.round(y), maxHeight: Math.round(maxHeight) };
}

/** Najvyšší vrch z viditeľných prekážok pod kartou (meteogram, spodná lišta); null ak žiadna. Pure. */
export function bottomLimitFrom(rects) {
  const tops = (rects || []).filter((r) => r && r.height > 0 && Number.isFinite(r.top)).map((r) => r.top);
  return tops.length ? Math.min(...tops) : null;
}

function rgba(hex, alpha) {
  return Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
}

function createWarningCard(doc) {
  const root = doc.createElement('section');
  root.className = 'meteo-place-card weather-warn-card';
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
  let hovered = false;
  let observer = null;
  close.addEventListener('click', () => { pinned = false; root.hidden = true; });
  const onKey = (e) => { if (e.key === 'Escape' && !root.hidden) { pinned = false; root.hidden = true; } };
  doc.addEventListener?.('keydown', onKey);
  root.addEventListener('pointerenter', () => { hovered = true; });
  root.addEventListener('pointerleave', () => { hovered = false; });
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  return {
    show(model, at, { pin = false } = {}) {
      const nodes = [el('h3', '', model.title)];
      for (const it of model.items) {
        const item = el('article', 'weather-warn-item');
        item.style.setProperty('--warn', it.color);
        const head = el('p', 'weather-warn-head');
        head.append(el('span', 'weather-warn-chip', `${it.degree} · ${it.type}`), el('span', `weather-warn-state${it.active ? ' active' : ''}`, t(it.active ? 'warn.active' : 'warn.upcoming')));
        item.append(head, el('p', 'weather-warn-event', it.event), el('p', 'weather-warn-when', it.when));
        if (it.headline) item.append(el('p', 'weather-warn-headline', it.headline));
        if (pin && it.description) item.append(el('p', 'weather-warn-text', it.description));
        if (pin && it.instruction) item.append(el('p', 'weather-warn-text instruction', it.instruction));
        item.append(el('p', 'meteo-place-sub', t('warn.sent', { at: it.sent })));
        nodes.push(item);
      }
      nodes.push(el('p', 'meteo-place-note', t(pin ? 'warn.source' : 'warn.hint')));
      body.replaceChildren(...nodes);
      pinned = pin;
      root.hidden = false;
      const place = () => {
        const view = doc.defaultView;
        // Nad pásom predpovede (meteogram), ak je otvorený — klik otvorí oboje a nesmú sa prekryť.
        // Meteogram sa môže otvoriť až po nás (poradie poslucháčov), preto ešte raz o chvíľu.
        const gram = doc.getElementById?.('meteogram');
        // Na mobile aj spodná lišta (#oko-appbar) — päta karty pod ňou bola odrezaná.
        const appbar = doc.getElementById?.('oko-appbar');
        const gramTop = bottomLimitFrom([gram && !gram.hidden ? gram.getBoundingClientRect() : null, appbar && appbar.offsetHeight ? appbar.getBoundingClientRect() : null]);
        root.style.maxHeight = '';
        const box = cardBox({ at, width: root.offsetWidth || 300, height: root.scrollHeight || root.offsetHeight || 200, viewW: view?.innerWidth ?? 1200, viewH: view?.innerHeight ?? 800, bottomLimit: gramTop });
        root.style.left = `${box.x}px`;
        root.style.top = `${box.y}px`;
        root.style.maxHeight = `${box.maxHeight}px`;
        // Pás sa po načítaní dát zväčší (vrch ide hore) a pri prvom kliku vzniká až po nás —
        // pripnutá karta ho sleduje, len čo existuje.
        const RO = view?.ResizeObserver;
        if (pin && !observer && gram && RO) { observer = new RO(() => { if (!root.hidden) place(); }); observer.observe(gram); }
      };
      observer?.disconnect();
      observer = null;
      place();
      if (pin) setTimeout(place, 60);
    },
    hide({ force = false } = {}) { if (pinned && !force) return; pinned = false; root.hidden = true; observer?.disconnect(); observer = null; },
    isPinned: () => pinned,
    isHovered: () => hovered,
    destroy() { doc.removeEventListener?.('keydown', onKey); root.remove(); },
  };
}

/**
 * Primitívy okresov s výstrahou: { elevated } = výplň 11,5 km nad elipsoidom + obrysy (nad meteo
 * poľom), { ground } = výplň na teréne a 3D dlaždiciach. Id inštancie = shmu-warn:<kód> (pick).
 * @param {Array<{code: string, rings: number[][][], color: string, active: boolean}>} entries
 */
export function buildWarningPrimitives(entries) {
  const hierarchy = (ring) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat()));
  const fill = [];
  const groundFill = [];
  const outlines = new Cesium.PolylineCollection();
  for (const e of entries) {
    const color = rgba(e.color, e.active ? FILL_ALPHA_ACTIVE : FILL_ALPHA_UPCOMING);
    const id = `${WARN_PICK_PREFIX}${e.code}`;
    for (const ring of e.rings) {
      fill.push(new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({ polygonHierarchy: hierarchy(ring), height: WARN_ELEVATED_HEIGHT_M }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
        id,
      }));
      groundFill.push(new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({ polygonHierarchy: hierarchy(ring) }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(rgba(e.color, e.active ? GROUND_ALPHA_ACTIVE : GROUND_ALPHA_UPCOMING)) },
        id,
      }));
      outlines.add({
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(ring.flatMap(([lon, lat]) => [lon, lat, WARN_ELEVATED_HEIGHT_M + 50])),
        width: e.active ? 2 : 1.2,
        material: Cesium.Material.fromType('Color', { color: rgba(e.color, e.active ? 0.95 : 0.7) }),
      });
    }
  }
  const elevated = new Cesium.PrimitiveCollection();
  elevated.add(new Cesium.Primitive({
    geometryInstances: fill,
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
    asynchronous: false,
  }));
  elevated.add(outlines);
  const ground = new Cesium.GroundPrimitive({
    geometryInstances: groundFill,
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
    classificationType: Cesium.ClassificationType.BOTH,
  });
  return { elevated, ground };
}

export function createShmuWarningsLayer({
  fetchImpl = null,
  doc = globalThis.document,
  cardFactory = createWarningCard,
  primitivesFactory = buildWarningPrimitives,
  now = () => Date.now(),
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _enabled = false;
  let _districts = null; // { code: { name, rings } }
  let _districtsLoad = null;
  let _warnings = [];
  let _states = new Map();
  let _fetchedAt = null;
  let _stale = false;
  let _lastError = null;
  let _elevated = null; // Cesium.PrimitiveCollection
  let _ground = null; // Cesium.GroundPrimitive
  let _groundMode = null;
  let _preRender = null;
  let _card = null;
  let _listeners = null;
  let _hoverTimer = null;
  let _press = null;
  let _hoverCode = null;

  const lang = () => (currentLanguage?.() === 'en' ? 'en' : 'sk');

  async function loadDistricts() {
    if (_districts) return _districts;
    if (!_districtsLoad) {
      _districtsLoad = (async () => {
        const res = await doFetch(DISTRICTS_URL);
        if (!res?.ok) throw new Error(`okresy HTTP ${res?.status}`);
        _districts = await res.json();
        return _districts;
      })().catch((error) => { _districtsLoad = null; throw error; });
    }
    return _districtsLoad;
  }

  function clearPrimitives() {
    const prims = _viewer?.scene?.primitives;
    if (_elevated) prims?.remove(_elevated);
    if (_ground) prims?.remove(_ground);
    _elevated = null;
    _ground = null;
  }

  function rebuild() {
    clearPrimitives();
    if (!_viewer || !_enabled || !_districts || !_states.size) { governorRequestRender('shmu-warnings'); return; }
    const entries = [];
    for (const [code, state] of _states) {
      const d = _districts[code];
      const lvl = WARNING_LEVELS[state.level];
      if (d && lvl) entries.push({ code, rings: d.rings, color: lvl.color, active: state.active });
    }
    const built = primitivesFactory(entries);
    _ground = built.ground;
    _elevated = built.elevated;
    if (_ground) _viewer.scene.primitives.add(_ground);
    if (_elevated) _viewer.scene.primitives.add(_elevated);
    _groundMode = null;
    syncMode();
  }

  function syncMode() {
    const h = _viewer?.scene?.camera?.positionCartographic?.height;
    const ground = Number.isFinite(h) && h < WARN_GROUND_BELOW_M;
    if (ground === _groundMode) return;
    _groundMode = ground;
    if (_elevated) _elevated.show = _enabled && !ground;
    if (_ground) _ground.show = _enabled && ground;
    governorRequestRender('shmu-warnings');
  }

  function districtAt(x, y) {
    const scene = _viewer?.scene;
    if (!scene?.pick) return null;
    let picked = null;
    try { picked = scene.pick(new Cesium.Cartesian2(x, y)); } catch { picked = null; }
    const id = resolvePickId(picked);
    return id && id.startsWith(WARN_PICK_PREFIX) ? id.slice(WARN_PICK_PREFIX.length) : null;
  }

  function showCard(code, at, pin) {
    const state = _states.get(code);
    const d = _districts?.[code];
    if (!state || !d) return;
    if (!_card && doc?.body) _card = cardFactory(doc);
    _card?.show(warningCardModel(d.name, state.warnings, { lang: lang(), nowMs: now() }), at, { pin });
  }

  function localPoint(e) {
    const r = _viewer.scene.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onMove(e) {
    if (e.buttons || e.pointerType === 'touch' || _card?.isPinned?.()) return;
    clearTimeout(_hoverTimer);
    const at = { x: e.clientX, y: e.clientY };
    const p = localPoint(e);
    _hoverTimer = setTimeout(() => {
      const code = districtAt(p.x, p.y);
      if (code) { _hoverCode = code; showCard(code, at, false); } else if (_hoverCode && !_card?.isHovered?.()) { _hoverCode = null; _card?.hide(); }
    }, 90);
  }

  function onDown(e) { _press = { x: e.clientX, y: e.clientY, at: now() }; }

  function onUp(e) {
    const press = _press;
    _press = null;
    if (!press || !_enabled) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6 || now() - press.at > 600) return;
    const p = localPoint(e);
    const code = districtAt(p.x, p.y);
    if (code) showCard(code, { x: e.clientX, y: e.clientY }, true);
    else _card?.hide({ force: true });
  }

  function attach() {
    const canvas = _viewer?.scene?.canvas;
    if (!canvas?.addEventListener || _listeners) return;
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    _listeners = canvas;
    registerPickOwner(SHMU_WARNINGS_LAYER_ID, (id) => String(id).startsWith(WARN_PICK_PREFIX));
  }

  function detach() {
    clearTimeout(_hoverTimer);
    if (_listeners) {
      _listeners.removeEventListener('pointermove', onMove);
      _listeners.removeEventListener('pointerdown', onDown);
      _listeners.removeEventListener('pointerup', onUp);
      _listeners = null;
    }
    unregisterPickOwner(SHMU_WARNINGS_LAYER_ID);
    _card?.hide({ force: true });
  }

  function applyWarnings(list) {
    const t0 = now();
    _warnings = (Array.isArray(list) ? list : []).filter((w) => !w.expires || Date.parse(w.expires) > t0);
    _states = districtStates(_warnings, t0);
  }

  const layer = {
    id: SHMU_WARNINGS_LAYER_ID,
    name: 'Výstrahy SHMÚ',
    icon: '⚠︎',
    get source() {
      const at = _fetchedAt ? ` · ${warningTimeLabel(_fetchedAt, lang())}` : '';
      return `SHMÚ · MeteoAlarm (CC BY 4.0)${at} · okresy © OpenStreetMap (ODbL)`;
    },
    updateInterval: 5 * 60 * 1000,

    init(viewer) {
      _viewer = viewer;
      if (viewer?.scene?.preRender?.addEventListener && !_preRender) {
        _preRender = () => { if (_enabled) syncMode(); };
        viewer.scene.preRender.addEventListener(_preRender);
      }
    },

    enable() {
      _enabled = true;
      attach();
      void this.update();
    },

    disable() {
      _enabled = false;
      detach();
      clearPrimitives();
      governorRequestRender('shmu-warnings');
    },

    async update() {
      try {
        const [districts, response] = await Promise.all([loadDistricts(), doFetch(WARNINGS_URL)]);
        if (!response?.ok) { _lastError = `warnings HTTP ${response?.status}`; return false; }
        const payload = await response.json();
        if (!Array.isArray(payload?.warnings)) { _lastError = 'malformed warnings'; return false; }
        _districts = districts;
        applyWarnings(payload.warnings);
        _fetchedAt = payload.fetchedAt || null;
        _stale = payload.stale === true;
        _lastError = null;
        if (_enabled) rebuild();
        return true;
      } catch (error) {
        _lastError = String(error?.message || error);
        return false;
      }
    },

    getRowControls() {
      return {
        legend: [2, 3, 4].map((lvl) => ({ color: WARNING_LEVELS[lvl].color, label: t('warn.degree', { n: WARNING_LEVELS[lvl].degree }), count: '' })),
      };
    },

    getStats() {
      return { count: _states.size, lastUpdate: _fetchedAt ? Date.parse(_fetchedAt) : null, error: _lastError, stale: _stale };
    },

    _getStateForTest() {
      return { enabled: _enabled, districts: _states.size, warnings: _warnings.length, ground: _groundMode, elevated: Boolean(_elevated), card: _card };
    },

    destroy(viewer) {
      this.disable();
      if (_preRender) { (viewer || _viewer)?.scene?.preRender?.removeEventListener?.(_preRender); _preRender = null; }
      _card?.destroy(); _card = null;
      _viewer = null;
    },
  };
  return layer;
}

export default createShmuWarningsLayer();
