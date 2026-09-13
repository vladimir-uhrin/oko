// src/data/gasFlowsLayer.js
/**
 * @module gasFlowsLayer
 * @description Vrstva „Toky plynu“ na glóbuse (2026-09-13, etapa 4 modulu
 * PLYN; používateľ: „sprav ich ako pri lietadlách, aj s grafmi, históriou,
 * daj tam aj cenu"). Hraničné stanice z katalógu `gasFlows.js` ako malé
 * body + karty v spoločnom world overlay (ten istý maliar ako karty
 * lietadiel a lodí):
 *  - kompaktná karta (variant „card", taktický štýl ako pri lodiach): meno
 *    stanice, tok za smer, plynárenský deň;
 *  - po kliknutí rozšírená karta (variant „tracked" ako sledované lietadlo):
 *    smer s vlajkami, toky s prepočtom na mil. m³ a priemerom 7 dní, cena
 *    TTF (odvodená z ACER) v €/MWh a ct/kWh, dva grafy za 31 dní (tok
 *    hlavného smeru + TTF), profil druhého smeru, päta so zdrojom a
 *    citáciou ENTSOG. Klik na kartu alebo bod prepína, klik do prázdna
 *    kartu zbalí.
 * Dáta: tá istá proxy `/api/gas/flows` ako karta TOKY (cache 1 h) a
 * `/api/gas/prices` (cache 6 h) — ENTSOG ani ACER nedostanú dopyt navyše.
 * Súradnice staníc sú približné; karta to hovorí v päte.
 *
 * Injektovateľné pre testy: fetchImpl, dataSourceFactory, handlerFactory,
 * overlayHost, translate, lang, now.
 */
import * as Cesium from 'cesium';
import { currentLanguage, t as translateDefault } from '../i18n.js';
import { registerEntityContext, removeEntityContextsForLayer, selectEntityContext } from './contextStore.js';
import { clearOverlaySource, hitTestWorldOverlay, setOverlayEntries, setOverlaySourceVisible } from '../overlays/worldOverlay.js';
import { applyVesselOverlayPolicy } from './vesselLabels.js';
import { GAS_FLOW_POINTS, buildFlowsModel, fetchGasFlows, formatGwhDay } from './gasFlows.js';
import { fetchGasPrices, formatCtKwh, formatDateLabel, formatEurMwh } from './gasPrices.js';

export const GAS_FLOWS_LAYER_ID = 'gas-flows';
export const GAS_FLOWS_OVERLAY_SOURCE_ID = 'gas-flows';
/** Proxy má TTL 1 h; vrstva sa pýta raz za 30 min (dostane cache). */
export const GAS_FLOWS_LAYER_REFRESH_MS = 30 * 60 * 1000;
/** Bod mierne nad terénom, aby nesplýval s podkladom na glóbusových stackoch. */
export const GAS_FLOW_STATION_HEIGHT_M = 30;
/** Kompaktné karty blednú za touto vzdialenosťou kamery (pohľad na celú EÚ ich ešte drží). */
export const GAS_FLOW_CARD_FADE_DISTANCE_M = 2_800_000;
/** Grafy na rozšírenej karte: posledných 31 plynárenských dní / kalendárnych dní ceny. */
export const GAS_FLOW_CHART_DAYS = 31;
/** Akcent kariet: plyn = jantár ako v Energetike SR. */
export const GAS_FLOW_CARD_ACCENT = 'rgba(255, 177, 77, 0.95)';

/** Farby bodov: jantár tečie, sivá nula, tmavá bez dát. */
export const GAS_FLOW_COLORS = Object.freeze({
  flow: '#ffb14d',
  zero: '#6f7f88',
  nodata: '#3d4a52',
});

const DAY_MS = 86_400_000;
const dayMs = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Smery zoskupené do staníc podľa mena a súradníc (Lanžhot vstup + výstup
 * = jedna stanica, Strandža 1 + 2 = jedna). Poradie = poradie katalógu.
 * @param {Array<object>} rows riadky z buildFlowsModel (s lat/lon)
 * @param {Map<string, Array<{date: string, gwh: number}>>} [seriesById] rady po smeroch (payload.points)
 */
export function groupStations(rows, seriesById = new Map()) {
  const stations = new Map();
  for (const row of rows || []) {
    if (!Number.isFinite(row?.lat) || !Number.isFinite(row?.lon)) continue;
    const key = `${row.lat.toFixed(2)},${row.lon.toFixed(2)}`;
    if (!stations.has(key)) stations.set(key, { key, name: row.name, lat: row.lat, lon: row.lon, rows: [], level: 'nodata' });
    stations.get(key).rows.push({ ...row, series: seriesById.get(row.id) || [] });
  }
  for (const s of stations.values()) {
    s.level = s.rows.some((r) => r.level === 'flow') ? 'flow' : (s.rows.some((r) => r.level === 'zero') ? 'zero' : 'nodata');
    if (s.rows.length > 1 && new Set(s.rows.map((r) => r.name)).size > 1) s.name = [...new Set(s.rows.map((r) => r.name))].join(' / ');
  }
  return [...stations.values()];
}

/** Popis bodu (kontextový panel, prístupnosť): meno stanice + jeden riadok na smer. */
export function stationLabelText(station) {
  return [station.name, ...station.rows.map((r) => `${r.route} ${r.text}`)].join('\n');
}

export function stationColor(level) {
  return Cesium.Color.fromCssColorString(GAS_FLOW_COLORS[level] || GAS_FLOW_COLORS.nodata);
}

/**
 * Rad za posledných `days` dní ako pole 0..1 s medzerami (null) po dňoch,
 * normalizované maximom (nula je informácia, preto podlaha 0).
 * @param {Array<{date: string, gwh?: number, v?: number}>} series vzostupne
 * @param {number} endMs posledný deň osi (UTC ms)
 * @param {{days?: number, key?: string}} [o]
 * @returns {{values: Array<number|null>, max: number, last: number|null, firstDay: string, lastDay: string}}
 */
export function normalizeDaily(series, endMs, { days = GAS_FLOW_CHART_DAYS, key = 'gwh', fill = 'none', floor = 'zero' } = {}) {
  const end = Math.floor(endMs / DAY_MS) * DAY_MS;
  const start = end - (days - 1) * DAY_MS;
  const byDay = new Map();
  for (const r of series || []) {
    const v = Number(r?.[key]);
    if (!Number.isFinite(v) || !r?.date) continue;
    const t = dayMs(String(r.date));
    if (t >= start && t <= end) byDay.set(Math.round((t - start) / DAY_MS), v);
  }
  const raw = Array.from({ length: days }, (_, i) => (byDay.has(i) ? byDay.get(i) : null));
  // Ceny (2026-09-13, používateľ zakrúžkoval „útržky"): víkend a sviatok
  // nemajú hodnotu, platí posledný settlement → doplniť dopredu, inak maliar
  // kreslí každý pracovný týždeň ako samostatný blok.
  if (fill === 'forward') {
    let prev = null;
    for (let i = 0; i < raw.length; i += 1) { if (raw[i] === null) raw[i] = prev; else prev = raw[i]; }
  }
  const known = raw.filter((v) => v !== null);
  const max = known.length ? Math.max(...known, 0) : 0;
  const min = known.length ? Math.min(...known) : 0;
  const scale = max > 0 ? max : 1;
  const last = known.length ? known[known.length - 1] : null;
  // Tok: podlaha 0 (nula je informácia). Cena: rozsah min–max s rezervou,
  // lebo pri podlahe 0 sa pohyb ceny (napr. 75–82 €/MWh) stlačí k stropu.
  const values = floor === 'min'
    ? raw.map((v) => (v === null ? null : (max > min ? 0.08 + 0.84 * ((v - min) / (max - min)) : 0.5)))
    : raw.map((v) => (v === null ? null : Math.max(0, Math.min(1, v / scale))));
  return { values, max, min, last, firstDay: isoDay(start), lastDay: isoDay(end) };
}

/**
 * Metadáta pre kontextový panel: čo je stanica, čo tečie, odkedy, poznámka.
 * @param {object} station
 * @param {(k: string, v?: object) => string} translate
 */
export function stationContextProperties(station, translate) {
  const props = {};
  station.rows.forEach((r, i) => {
    const prefix = station.rows.length > 1 ? `${r.route}` : translate('gas.flow-context-flow');
    props[prefix] = [r.text, r.mcmText, r.avg7Text].filter(Boolean).join(' · ');
    if (i === 0 && (r.dateText || r.statusText)) props[translate('gas.flow-context-day')] = [r.dateText, r.statusText].filter(Boolean).join(' · ');
    if (r.note && !props[translate('gas.flow-context-note')]) props[translate('gas.flow-context-note')] = r.note;
  });
  return props;
}

const iso2 = (code) => (/^[A-Z]{2}$/.test(String(code || '')) ? String(code) : null);

/**
 * Kompaktná karta stanice (variant „card" cez politiku kariet lodí).
 * @param {object} station
 * @param {object} position Cartesian3
 * @param {(k: string, v?: object) => string} translate
 * @param {{selected?: boolean, activate?: Function}} [o]
 */
export function stationCompactCard(station, position, translate, { activate = null } = {}) {
  const first = station.rows[0];
  const details = station.rows.slice(0, 2).map((r) => `${r.route} ${r.text}`);
  if (first?.dateText) details.push([translate('gas.card-day', { date: first.dateText }), first.statusText].filter(Boolean).join(' · '));
  const gwh = station.rows.reduce((s, r) => s + (Number.isFinite(r.gwh) ? r.gwh : 0), 0);
  return applyVesselOverlayPolicy({
    id: `${GAS_FLOWS_LAYER_ID}:${station.key}`,
    actionable: true,
    position,
    gapPx: 10,
    accent: GAS_FLOW_CARD_ACCENT,
    title: station.name.length > 30 ? `${station.name.slice(0, 29)}…` : station.name,
    details,
    selected: false,
    priority: (station.level === 'flow' ? 1000 : (station.level === 'zero' ? 400 : 0)) + Math.min(500, Math.round(gwh)),
    accessibilityLabel: `${station.name} · ${translate('gas.card-open')}`,
    activate,
  }, GAS_FLOW_CARD_FADE_DISTANCE_M);
}

/**
 * Rozšírená karta stanice (variant „tracked" ako sledované lietadlo):
 * smer s vlajkami, toky, cena TTF, grafy 31 dní, profil druhého smeru, päta.
 * @param {object} station
 * @param {object} position Cartesian3
 * @param {{translate: Function, lang: string, nowMs: number, prices?: Array<{date: string, ttf: number|null}>|null, citation?: string, activate?: Function}} o
 */
export function stationTrackedCard(station, position, { translate, lang = 'sk', nowMs = Date.now(), prices = null, citation = '', activate = null }) {
  const first = station.rows[0];
  const second = station.rows[1] || null;
  const endMs = first?.series?.length ? dayMs(first.series[first.series.length - 1].date) : nowMs;
  const flow = normalizeDaily(first?.series || [], endMs);
  const priceRows = (prices || []).filter((r) => Number.isFinite(r?.ttf)).map((r) => ({ date: r.date, v: r.ttf }));
  const price = normalizeDaily(priceRows, priceRows.length ? dayMs(priceRows[priceRows.length - 1].date) : nowMs, { key: 'v', fill: 'forward', floor: 'min' });
  const lastPrice = priceRows.length ? priceRows[priceRows.length - 1] : null;
  const details = station.rows.map((r) => [`${r.route} ${r.text}`, r.mcmText, r.avg7Text].filter(Boolean).join(' · '));
  if (first?.dateText) details.push([translate('gas.card-day', { date: first.dateText }), first.statusText].filter(Boolean).join(' · '));
  if (lastPrice) details.push(translate('gas.card-price-line', { v: formatEurMwh(lastPrice.v, lang), ct: formatCtKwh(lastPrice.v, lang), date: formatDateLabel(lastPrice.date, lang, { year: false }) }));
  const knownFlow = flow.values.filter((v) => v !== null).length;
  const knownPrice = price.values.filter((v) => v !== null).length;
  const charts = knownFlow >= 2 || knownPrice >= 2 ? {
    mode: 'time',
    forecastLabel: '',
    titles: {
      altitude: translate('gas.card-flow-chart', { route: first?.route || '' }),
      speed: translate('gas.card-price-chart'),
    },
    axis: { left: formatDateLabel(flow.firstDay, lang, { year: false }), right: formatDateLabel(flow.lastDay, lang, { year: false }) },
    altitude: { past: flow.values, future: [], xNow: 1, label: translate('gas.card-flow-label', { max: formatGwhDay(flow.max, lang), last: first?.text || '—' }) },
    speed: { past: knownPrice >= 2 ? price.values : [], xNow: 1, label: knownPrice >= 2 ? translate('gas.card-price-label', { max: formatEurMwh(price.max, lang), last: formatEurMwh(price.last, lang) }) : '' },
  } : null;
  const profileSeries = second ? normalizeDaily(second.series || [], endMs) : null;
  const profile = profileSeries && profileSeries.values.filter((v) => v !== null).length >= 2
    ? { altitude: profileSeries.values.map((v) => (v === null ? 0 : v)), speed: [], label: translate('gas.card-flow-chart', { route: second.route }), sublabel: `${second.text}${second.mcmText ? ` · ${second.mcmText}` : ''}` }
    : null;
  const footer = [translate('gas.card-footer')];
  if (first?.note) footer.unshift(first.note);
  if (citation) footer.push(citation);
  return {
    id: `${GAS_FLOWS_LAYER_ID}:${station.key}`,
    position,
    variant: 'tracked',
    tracked: true,
    protected: true,
    paintLane: 'tracked',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    accent: GAS_FLOW_CARD_ACCENT,
    gapPx: 14,
    title: station.name,
    route: first ? { origin: { label: first.route.split(' → ')[0], iso2: iso2(first.route.split(' → ')[0]) }, destination: { label: first.route.split(' → ')[1], iso2: iso2(first.route.split(' → ')[1]) } } : null,
    details,
    charts,
    profile,
    footer,
    interactive: true,
    accessibilityLabel: `${station.name} · ${translate('gas.card-close')}`,
    activate,
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
  hitTest: hitTestWorldOverlay,
});

/**
 * @param {object} [o]
 * @param {typeof fetch|null} [o.fetchImpl]
 * @param {(id: string) => object} [o.dataSourceFactory]
 * @param {(canvas: any) => object} [o.handlerFactory]
 * @param {object} [o.overlayHost] { setEntries, setVisible, clearSource, hitTest }
 * @param {(k: string, v?: object) => string} [o.translate]
 * @param {() => string} [o.lang]
 * @param {() => number} [o.now]
 */
export function createGasFlowsLayer({
  fetchImpl = null,
  dataSourceFactory = (id) => new Cesium.CustomDataSource(id),
  handlerFactory = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  overlayHost = DEFAULT_OVERLAY_HOST,
  translate = translateDefault,
  lang = () => currentLanguage(),
  now = () => Date.now(),
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _loading = false;
  let _error = null;
  let _lastUpdate = null;
  let _model = null;
  let _stations = [];
  let _positions = new Map();
  let _rowKeyById = new Map();
  let _prices = null;
  let _selectedKey = null;
  let _pendingSelectRowId = null;
  let _clickHandler = null;
  let _updateToken = 0;

  function publishCards() {
    if (!_enabled || !_stations.length) {
      overlayHost.clearSource(GAS_FLOWS_OVERLAY_SOURCE_ID);
      return;
    }
    const lng = lang();
    const entries = _stations.map((station) => {
      const position = _positions.get(station.key);
      if (station.key === _selectedKey) {
        return stationTrackedCard(station, position, { translate, lang: lng, nowMs: now(), prices: _prices, citation: _model?.sourceLine || '', activate: () => { selectStation(null); return true; } });
      }
      return stationCompactCard(station, position, translate, { activate: () => { selectStation(station.key); return true; } });
    });
    overlayHost.setEntries(GAS_FLOWS_OVERLAY_SOURCE_ID, entries, { cohortLimit: 24, collisionCapacity: 24, moving: false });
    overlayHost.setVisible(GAS_FLOWS_OVERLAY_SOURCE_ID, true);
    _viewer?.scene?.requestRender?.();
  }

  function selectStation(key) {
    _selectedKey = key && _stations.some((s) => s.key === key) ? key : null;
    if (_selectedKey && typeof window !== 'undefined') {
      const entity = _dataSource?.entities?.values?.find?.((e) => e.__gasFlowStation === _selectedKey);
      if (entity) selectEntityContext(entity);
    }
    publishCards();
  }

  function rebuildEntities() {
    if (!_dataSource || !_model?.ok) return;
    if (typeof window !== 'undefined') removeEntityContextsForLayer(GAS_FLOWS_LAYER_ID);
    _dataSource.entities.removeAll();
    _positions = new Map();
    for (const station of _stations) {
      const position = Cesium.Cartesian3.fromDegrees(station.lon, station.lat, GAS_FLOW_STATION_HEIGHT_M);
      _positions.set(station.key, position);
      const entity = _dataSource.entities.add({
        id: `${GAS_FLOWS_LAYER_ID}:${station.key}`,
        position,
        point: {
          pixelSize: station.level === 'flow' ? 8 : 6,
          color: stationColor(station.level),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { level: station.level, name: station.name },
      });
      entity.__gasFlowStation = station.key;
      if (typeof window !== 'undefined') {
        registerEntityContext(entity, {
          id: `${GAS_FLOWS_LAYER_ID}:${station.key}`,
          layerId: GAS_FLOWS_LAYER_ID,
          layerName: translate('layer.gas-flows.name'),
          source: _model.sourceLine,
          dataSource: _dataSource,
          label: stationLabelText(station).replace(/\n/g, ' · '),
          properties: stationContextProperties(station, translate),
          latitude: Number(station.lat.toFixed(6)),
          longitude: Number(station.lon.toFixed(6)),
        });
      }
    }
    if (_selectedKey && !_stations.some((s) => s.key === _selectedKey)) _selectedKey = null;
    if (_pendingSelectRowId) {
      const key = _rowKeyById.get(_pendingSelectRowId) || null;
      _pendingSelectRowId = null;
      if (key) _selectedKey = key;
    }
    publishCards();
  }

  let _inFlight = null;

  /** Single-flight: enable() aj manažérsky update() zdieľajú jedno sťahovanie (žiadny dvojitý dopyt). */
  function load() {
    if (_inFlight) return _inFlight;
    _inFlight = loadOnce().finally(() => { _inFlight = null; });
    return _inFlight;
  }

  async function loadOnce() {
    const token = ++_updateToken;
    _loading = true;
    try {
      const [payload, prices] = await Promise.all([
        fetchGasFlows({ fetcher: doFetch }),
        fetchGasPrices({ fetcher: doFetch }).catch(() => null),
      ]);
      if (token !== _updateToken) return false;
      _model = buildFlowsModel(payload, { lang: lang(), translate, nowMs: now() });
      if (!_model.ok) throw new Error('empty flows payload');
      const seriesById = new Map((payload?.points || []).map((p) => [p.id, p.series || []]));
      const rows = _model.groups.flatMap((g) => g.rows);
      _stations = groupStations(rows, seriesById);
      _rowKeyById = new Map();
      for (const s of _stations) for (const r of s.rows) _rowKeyById.set(r.id, s.key);
      const acer = Array.isArray(prices?.acer?.rows) ? prices.acer.rows : [];
      _prices = acer.slice(-Math.max(GAS_FLOW_CHART_DAYS, 1) * 2).map((r) => ({ date: r.date, ttf: Number.isFinite(r.ttf) ? r.ttf : null }));
      _error = null;
      _lastUpdate = now();
      rebuildEntities();
      return true;
    } catch (error) {
      if (token === _updateToken) _error = error?.message || String(error);
      return false;
    } finally {
      if (token === _updateToken) _loading = false;
    }
  }

  function installClick() {
    if (_clickHandler || !_viewer?.scene?.canvas) return;
    _clickHandler = handlerFactory(_viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const hit = overlayHost.hitTest?.(click.position?.x, click.position?.y, { sourceId: GAS_FLOWS_OVERLAY_SOURCE_ID });
      if (hit?.entryId) {
        const key = String(hit.entryId).slice(GAS_FLOWS_LAYER_ID.length + 1);
        selectStation(key === _selectedKey ? null : key);
        return;
      }
      const picked = _viewer.scene.pick(click.position);
      const entity = picked?.id;
      if (entity?.__gasFlowStation) {
        _viewer.selectedEntity = entity;
        selectStation(entity.__gasFlowStation === _selectedKey ? null : entity.__gasFlowStation);
        return;
      }
      // Klik do prázdna (terén, podklad) zbalí kartu; klik na cudzí objekt nechá výber tak.
      if (!picked && _selectedKey) selectStation(null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClick() {
    if (!_clickHandler) return;
    try { _clickHandler.destroy?.(); } catch { /* už zničený */ }
    _clickHandler = null;
  }

  const layer = {
    id: GAS_FLOWS_LAYER_ID,
    get name() { return translate('layer.gas-flows.name'); },
    // Monochromatický glyf (žiadne emoji): vlnky = tok.
    icon: '≋',
    get source() { return _model?.sourceLine || 'ENTSOG Transparency Platform'; },
    updateInterval: GAS_FLOWS_LAYER_REFRESH_MS,

    init(viewer) {
      _viewer = viewer;
      _dataSource = dataSourceFactory(GAS_FLOWS_LAYER_ID);
      _dataSource.show = false;
      viewer?.dataSources?.add?.(_dataSource);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      installClick();
      if (!_model) void load(); else publishCards();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      removeClick();
      _selectedKey = null;
      overlayHost.clearSource(GAS_FLOWS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GAS_FLOWS_OVERLAY_SOURCE_ID, false);
      if (_viewer?.selectedEntity?.__gasFlowStation) _viewer.selectedEntity = undefined;
      _viewer?.scene?.requestRender?.();
    },

    async update() {
      return load();
    },

    destroy(viewer) {
      layer.disable();
      if (typeof window !== 'undefined') removeEntityContextsForLayer(GAS_FLOWS_LAYER_ID);
      const host = viewer || _viewer;
      if (_dataSource && host?.dataSources?.remove) host.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _model = null;
      _stations = [];
      _positions = new Map();
      _prices = null;
    },

    getStats() {
      return {
        count: _stations.filter((s) => s.level !== 'nodata').length,
        lastUpdate: _lastUpdate,
        loading: _loading,
        error: _error,
        source: _model?.sourceLine
          ? `${translate('gas.flows-note').split(';')[0]} · ${_model.sourceLine}`
          : translate('gas.flows-note').split(';')[0],
        status: _model?.freshness?.stale ? 'stale' : undefined,
      };
    },

    hasContact(id) {
      return _stations.some((s) => `${GAS_FLOWS_LAYER_ID}:${s.key}` === String(id));
    },

    /** Rozšírená karta stanice (null = zbaliť). */
    selectStation,
    /** Výber podľa id smeru z karty TOKY (lanzhot-in …); pred načítaním sa zapamätá. */
    selectStationByRowId(rowId) {
      const key = _rowKeyById.get(String(rowId)) || null;
      if (key) { selectStation(key); return true; }
      _pendingSelectRowId = String(rowId);
      return false;
    },

    _getStateForTest() {
      return {
        enabled: _enabled, loading: _loading, error: _error, stations: _stations.length, selected: _selectedKey,
        entities: _dataSource?.entities?.values?.length ?? null, hasClick: Boolean(_clickHandler), catalogue: GAS_FLOW_POINTS.length,
        prices: _prices ? _prices.length : null,
      };
    },
  };
  return layer;
}

const gasFlowsLayer = createGasFlowsLayer();
export default gasFlowsLayer;
