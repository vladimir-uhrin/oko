// src/data/lazyLayers.js — lenivé zástupcovia vrstiev, ktoré sú pri štarte vypnuté (lazyLayer.js).
//
// VYGENEROVANÉ zo skutočných modulov (2026-10-31, lenivý štart) — metadáta, zmluva (verejné metódy),
// predvolené parametre a čipy pred init sú tu zopakované zámerne: import skutočného modulu by ho vtiahol
// do hlavného balíka. Proti rozídeniu stráži lazyLayers.test.mjs (porovná každý zápis so skutočným
// modulom; po zmene vrstvy test povie, čo tu treba prepísať). main.js registruje tieto zástupcov namiesto
// modulov; skutočný kód príde dynamickým importom pri prvom zapnutí vrstvy (init správcu).
import { createLazyLayer } from './lazyLayer.js';

export const earthquakesLazy = createLazyLayer({
  meta: { id: 'earthquakes', name: 'Earthquakes (24h)', icon: '∿', source: 'USGS + EMSC', updateInterval: 60000 },
  contract: ['destroy', 'disable', 'enable', 'getAnalystRecords', 'getParams', 'getRowControls', 'getSelectedInfo', 'getStats', 'init', 'selectById', 'setParams', 'setRowControlsListener', 'update'],
  params: { minMagnitude: 2.5, pulsar: true },
  rowControls: { chips: [{ id: 'mag--3', label: 'All magnitudes', title: 'Minimum displayed magnitude (last 24 hours)', active: false, params: { minMagnitude: -3 } }, { id: 'mag-1', label: 'M1+', title: 'Minimum displayed magnitude (last 24 hours)', active: false, params: { minMagnitude: 1 } }, { id: 'mag-2.5', label: 'M2.5+', title: 'Minimum displayed magnitude (last 24 hours)', active: true, params: { minMagnitude: 2.5 } }, { id: 'mag-4.5', label: 'M4.5+', title: 'Minimum displayed magnitude (last 24 hours)', active: false, params: { minMagnitude: 4.5 } }, { id: 'pulsar', label: 'Pulsar', title: 'Visual epicenter pulse (symbol, not a live seismic wave)', active: true, params: { pulsar: false } }], legend: [{ label: 'USGS', count: 0, color: '#ffb347', blurb: 'Catalog solutions before association and magnitude filtering; counts overlap.' }, { label: 'EMSC', count: 0, color: '#ffb347', blurb: 'Catalog solutions before association and magnitude filtering; counts overlap.' }] },
  load: () => import('./earthquakes.js').then((m) => m.default),
});

export const volcanoesLazy = createLazyLayer({
  meta: { id: 'volcanoes', name: 'Volcanic events', icon: '△', source: 'NASA EONET', updateInterval: 600000 },
  contract: ['clearSelection', 'destroy', 'disable', 'enable', 'getAnalystRecords', 'getStats', 'init', 'update'],
  load: () => import('./volcanoes.js').then((m) => m.default),
});

export const naturalEventsLazy = createLazyLayer({
  meta: { id: 'natural-events', name: 'Natural events (NASA EONET)', icon: '⚠︎', source: 'NASA EONET', updateInterval: 600000 },
  contract: ['clearSelection', 'destroy', 'disable', 'enable', 'getAnalystRecords', 'getParams', 'getRowControls', 'getStats', 'init', 'setParams', 'setRowControlsListener', 'update'],
  params: { hiddenNaturalEventCategories: ['wildfires'] },
  rowControls: { chips: [{ id: 'cat-wildfires', label: 'Wildfires', active: false, title: 'Show Wildfires', params: { hiddenNaturalEventCategories: [] } }] },
  load: () => import('./naturalEvents.js').then((m) => m.default),
});

export const shmuRadarLazy = createLazyLayer({
  meta: { id: 'shmu-radar', name: 'Zrážkový radar (SHMÚ)', icon: '▧', source: 'SHMÚ — opendata.shmu.sk (CC BY 4.0)', updateInterval: 300000 },
  contract: ['destroy', 'disable', 'enable', 'getRowControls', 'getStats', 'init', 'update'],
  rowControls: { legend: [{ color: 'rgba(96, 208, 130, 0.588)', label: '8 dBZ', count: '' }, { color: 'rgba(46, 172, 84, 0.686)', label: '15 dBZ', count: '' }, { color: 'rgba(250, 220, 70, 0.784)', label: '20 dBZ', count: '' }, { color: 'rgba(250, 160, 40, 0.843)', label: '28 dBZ', count: '' }, { color: 'rgba(235, 75, 45, 0.902)', label: '35 dBZ', count: '' }, { color: 'rgba(175, 25, 90, 0.941)', label: '44 dBZ', count: '' }, { color: 'rgba(230, 65, 230, 0.980)', label: '52 dBZ', count: '' }, { color: 'rgba(255, 255, 255, 1.000)', label: '60 dBZ', count: '' }] },
  load: () => import('./shmuRadar.js').then((m) => m.default),
});

export const shmuWarningsLazy = createLazyLayer({
  meta: { id: 'shmu-warnings', name: 'Výstrahy SHMÚ', icon: '⚠︎', source: 'SHMÚ · MeteoAlarm (CC BY 4.0) · okresy © OpenStreetMap (ODbL)', updateInterval: 300000 },
  contract: ['destroy', 'disable', 'enable', 'getRowControls', 'getStats', 'init', 'update'],
  rowControls: { legend: [{ color: '#ffd200', label: 'level 1', count: '' }, { color: '#ff8a00', label: 'level 2', count: '' }, { color: '#e8212b', label: 'level 3', count: '' }] },
  load: () => import('./shmuWarningsLayer.js').then((m) => m.default),
});

export const shmuStationsLazy = createLazyLayer({
  meta: { id: 'shmu-stations', name: 'Stanice SHMÚ (merania)', icon: '◉', source: 'SHMÚ — opendata.shmu.sk (CC BY 4.0) · MEASUREMENT, not forecast', updateInterval: 300000 },
  contract: ['destroy', 'disable', 'enable', 'getStats', 'init', 'update'],
  load: () => import('./shmuStationsLayer.js').then((m) => m.default),
});

export const operaRadarLazy = createLazyLayer({
  meta: { id: 'opera-radar', name: 'Zrážkový radar Európa (OPERA)', icon: '▨', source: 'EUMETNET OPERA — MeteoGate Open Radar Data (CC BY 4.0)', updateInterval: 300000 },
  contract: ['destroy', 'disable', 'enable', 'getRowControls', 'getStats', 'init', 'update'],
  rowControls: { legend: [{ color: 'rgba(96, 208, 130, 0.588)', label: '8 dBZ', count: '' }, { color: 'rgba(46, 172, 84, 0.686)', label: '15 dBZ', count: '' }, { color: 'rgba(250, 220, 70, 0.784)', label: '20 dBZ', count: '' }, { color: 'rgba(250, 160, 40, 0.843)', label: '28 dBZ', count: '' }, { color: 'rgba(235, 75, 45, 0.902)', label: '35 dBZ', count: '' }, { color: 'rgba(175, 25, 90, 0.941)', label: '44 dBZ', count: '' }, { color: 'rgba(230, 65, 230, 0.980)', label: '52 dBZ', count: '' }, { color: 'rgba(255, 255, 255, 1.000)', label: '60 dBZ', count: '' }] },
  load: () => import('./operaRadarLayer.js').then((m) => m.default),
});

export const gasFlowsLazy = createLazyLayer({
  meta: { id: 'gas-flows', name: 'Gas flows · border stations (ENTSOG)', icon: '≋', source: 'ENTSOG Transparency Platform', updateInterval: 1800000 },
  contract: ['destroy', 'disable', 'enable', 'getSelectedKey', 'getStats', 'hasContact', 'init', 'selectById', 'selectStation', 'selectStationByRowId', 'update'],
  load: () => import('./gasFlowsLayer.js').then((m) => m.default),
});

export const gasPipelinesLazy = createLazyLayer({
  meta: { id: 'gas-pipelines', name: 'Gas pipelines · EU and former USSR (OSM snapshot)', icon: '⌇', source: '© OpenStreetMap contributors · ODbL', updateInterval: 3600000 },
  contract: ['destroy', 'disable', 'enable', 'getParams', 'getRowControls', 'getStats', 'hasContact', 'init', 'selectPipeline', 'setParams', 'setRowControlsListener', 'update'],
  params: { gas: true, oil: true },
  rowControls: { chips: [{ id: 'kind-gas', label: 'GAS', title: 'Natural-gas transmission pipelines (OSM snapshot)', active: true, params: { gas: false } }, { id: 'kind-oil', label: 'OIL', title: 'Crude-oil trunk pipelines (OSM snapshot)', active: true, params: { oil: false } }], legend: [{ label: 'GAS', count: 0, color: '#ffb14d', blurb: 'Natural-gas transmission pipelines (OSM snapshot)' }, { label: 'OIL', count: 0, color: '#eab2ff', blurb: 'Crude-oil trunk pipelines (OSM snapshot)' }] },
  load: () => import('./gasPipelinesLayer.js').then((m) => m.default),
});

export const gfwPresenceLazy = createLazyLayer({
  meta: { id: 'gfw-presence', name: 'Satellite AIS · delayed (GFW)', icon: '◇', updateInterval: 1800000 },
  contract: ['clearSelection', 'destroy', 'disable', 'enable', 'getContactSummary', 'getDetectableObjects', 'getSelectedMmsi', 'getSelectedName', 'getStats', 'hasContact', 'init', 'prefetchContactDetails', 'selectContact', 'update'],
  load: () => import('./gfwPresence.js').then((m) => m.default),
});

export const gfwSarDetectionsLazy = createLazyLayer({
  meta: { id: 'gfw-sar', name: 'Radar ship detections · Sentinel-1 (GFW)', icon: '◈', updateInterval: 3600000 },
  contract: ['countInRect', 'destroy', 'disable', 'enable', 'getAllPositions', 'getContactSummary', 'getDetectableObjects', 'getStats', 'hasContact', 'init', 'isDarkOnly', 'setDarkOnly', 'update'],
  replay: ['setDarkOnly'],
  defaults: { isDarkOnly: (p) => Boolean(p.setDarkOnly?.[0] ?? false) },
  load: () => import('./gfwSarDetections.js').then((m) => m.default),
});

export const volbyObceLazy = createLazyLayer({
  meta: { id: 'volby-obce', name: 'Elections 2026 — municipalities', icon: '▣', source: 'MV SR · ŠÚ SR · GeoNames', updateInterval: 180000, showInTogglePanel: true },
  contract: ['destroy', 'disable', 'enable', 'getColorMode', 'getStats', 'init', 'select', 'setColorMode', 'update'],
  replay: ['select', 'setColorMode'],
  defaults: { getColorMode: (p) => (p.setColorMode?.[0] === 'party' ? 'party' : 'win') },
  props: ['onSelect'],
  load: () => import('./volbyObceLayer.js').then((m) => m.default),
});

export const trafficLazy = createLazyLayer({
  meta: { id: 'traffic', name: 'Street Traffic', icon: '≡', source: 'OpenStreetMap', updateInterval: 0 },
  contract: ['destroy', 'disable', 'enable', 'getDetectableObjects', 'getParams', 'getStats', 'init', 'setParams', 'update'],
  params: { densityScale: 1, speedScale: 1, uncoveredRoads: 'sim', jamViz: 'density', presetDots: 'on' },
  load: () => import('./traffic.js').then((m) => m.default),
});

export const bikeshareLazy = createLazyLayer({
  meta: { id: 'bikeshare', name: 'Bikeshare', icon: '⊛', source: 'GBFS', updateInterval: 60000 },
  contract: ['destroy', 'disable', 'enable', 'getDetectableObjects', 'getStats', 'init', 'update'],
  load: () => import('./bikeshare.js').then((m) => m.default),
});

export const satellitesLazy = createLazyLayer({
  meta: { id: 'satellites', name: 'Satellites', icon: '⊚', source: 'CelesTrak', updateInterval: 0, refreshInterval: 300000 },
  contract: ['cancelPendingTrackingRestore', 'destroy', 'disable', 'enable', 'findByQuery', 'getAllPositions', 'getDetectableObjects', 'getParams', 'getRowControls', 'getStats', 'getTrackedInfo', 'init', 'resolveTrackingRestoreTarget', 'setParams', 'setRowControlsListener', 'stopTracking', 'trackById', 'update'],
  params: { catalog: 'core', showPoints: true, showOrbits: true, selectedSatTrackingId: null },
  rowControls: { chips: [{ id: 'catalog', label: 'DENSE', active: false, busy: false, disabled: false, state: 'idle', title: 'Add the full Starlink broadband shell (thousands of extra points)', params: { catalog: 'dense' } }], legend: [] },
  awaitLoad: ['resolveTrackingRestoreTarget'],
  load: () => import('./satellites.js').then((m) => m.default),
});

export const rocketLaunchesLazy = createLazyLayer({
  meta: { id: 'rocket-launches', name: 'Space Missions (30d)', icon: '↥', source: 'Launch Library 2', updateInterval: 300000 },
  contract: ['attachDataManager', 'destroy', 'disable', 'enable', 'getStats', 'init', 'releaseCameraOwnership', 'update'],
  replay: ['attachDataManager'],
  load: () => import('./rocketLaunches.js').then((m) => m.default),
});

/** Lode · oneskorené (AISHub): továreň s dedup proti živej vrstve — isLive ide do skutočného modulu až pri dotiahnutí. */
export function createAishubVesselsLazy({ isLive }) {
  return createLazyLayer({
    meta: { id: 'aishub-vessels', name: 'Vessels · delayed (AISHub)', icon: '◇', updateInterval: 60000 },
    contract: ['clearSelection', 'destroy', 'disable', 'enable', 'getAllPositions', 'getContactSummary', 'getDetectableObjects', 'getSelectedMmsi', 'getSelectedName', 'getStats', 'hasContact', 'init', 'prefetchContactDetails', 'selectContact', 'update'],
    load: () => import('./aishubVessels.js').then((m) => m.createAishubVesselsLayer({ isLive })),
  });
}

/** Vrstva z poľa localLayers.js podľa id (všetky lokálne datasety sú v jednom module — prvé zapnutie ho dotiahne celý). */
const fromLocalLayers = (id) => () => import('./localLayers.js').then((m) => {
  const layer = m.default.find((l) => l.id === id);
  if (!layer) throw new Error(`localLayers.js: chýba vrstva ${id}`);
  return layer;
});

export const airportsLazy = createLazyLayer({
  meta: { id: 'local-airports', name: 'Airports', icon: '⊗', source: 'OurAirports', updateInterval: 0, statsRefreshInterval: 1000 },
  contract: ['destroy', 'disable', 'enable', 'getStats', 'init', 'update'],
  load: fromLocalLayers('local-airports'),
});

export const portsLazy = createLazyLayer({
  meta: { id: 'local-ports', name: 'Ports', icon: '⊔', source: 'NGA WPI', updateInterval: 0, statsRefreshInterval: 1000 },
  contract: ['destroy', 'disable', 'enable', 'getStats', 'init', 'update'],
  load: fromLocalLayers('local-ports'),
});

export const shippingLanesLazy = createLazyLayer({
  meta: { id: 'local-shipping-lanes', name: 'Námorné koridory', icon: '∿', source: 'P. Benden — z CIA World Oceans · CC BY 4.0', updateInterval: 3600000 },
  contract: ['destroy', 'disable', 'enable', 'getStatus', 'init', 'isLoaded', 'isUpdating', 'update'],
  load: fromLocalLayers('local-shipping-lanes'),
});

export const shipDensityLazy = createLazyLayer({
  meta: { id: 'local-ship-density', name: 'Historická hustota lodí', icon: '▩', source: 'World Bank / IMF · AIS 2015 – 2021 · CC BY 4.0 · HISTORICAL, not live', updateInterval: 86400000 },
  contract: ['destroy', 'disable', 'enable', 'getStats', 'getStatus', 'init', 'isLoaded', 'isUpdating', 'update'],
  load: fromLocalLayers('local-ship-density'),
});

export const airDensityLazy = createLazyLayer({
  meta: { id: 'local-air-density', name: 'Historická hustota letov', icon: '▨', source: 'adsb.lol · ADS-B 2026 · ODbL 1.0 / CC0 · HISTORICAL, not live', updateInterval: 86400000 },
  contract: ['destroy', 'disable', 'enable', 'getStats', 'getStatus', 'init', 'isLoaded', 'isUpdating', 'update'],
  load: fromLocalLayers('local-air-density'),
});

export const datacentersLazy = createLazyLayer({
  meta: { id: 'local-datacenters', name: 'Datacenters', icon: '▣', source: 'Local', updateInterval: 0, statsRefreshInterval: 1000 },
  contract: ['destroy', 'disable', 'enable', 'getStats', 'init', 'update'],
  load: fromLocalLayers('local-datacenters'),
});

export const damsLazy = createLazyLayer({
  meta: { id: 'local-dams', name: 'Dams', icon: '▰', source: 'USACE', updateInterval: 0, statsRefreshInterval: 1000 },
  contract: ['destroy', 'disable', 'enable', 'getStats', 'init', 'update'],
  load: fromLocalLayers('local-dams'),
});

export const skEnergyLazy = createLazyLayer({
  meta: { id: 'local-energy', name: 'Energetika SR', icon: '↯', source: '© OpenStreetMap contributors · ODbL · snapshot 2026-08', updateInterval: 3600000 },
  contract: ['destroy', 'disable', 'enable', 'getStats', 'init', 'update'],
  load: fromLocalLayers('local-energy'),
});

export const submarineCablesLazy = createLazyLayer({
  meta: { id: 'telegeography-submarine-cables', name: 'Submarine Cables', icon: '≋', source: 'TeleGeography', updateInterval: 0, statsRefreshInterval: 500 },
  contract: ['destroy', 'disable', 'enable', 'getStats', 'init', 'update'],
  load: fromLocalLayers('telegeography-submarine-cables'),
});

export const firesLazy = createLazyLayer({
  meta: { id: 'local-firms', name: 'FIRMS Active Fires', icon: '▲', source: 'NASA FIRMS + Copernicus · VIIRS, MODIS, Landsat, Sentinel-3, Meteosat/GOES', updateInterval: 600000 },
  contract: ['destroy', 'disable', 'enable', 'getAnalystRecords', 'getDetectableObjects', 'getStats', 'getStrongestFire', 'init', 'update'],
  load: fromLocalLayers('local-firms'),
});

/** Rovnaké poradie ako `export default` v localLayers.js (registrácia v main.js). */
export const localDataLayersLazy = Object.freeze([airportsLazy, portsLazy, shippingLanesLazy, shipDensityLazy, airDensityLazy, datacentersLazy, damsLazy, skEnergyLazy, submarineCablesLazy, firesLazy]);
