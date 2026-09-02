import { createLocalGeoJsonLayer } from './localGeojson.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import submarineCablesLayer from './telegeographySubmarineCables.js';
import skEnergyLayer from './skEnergy.js';

// Use Vite's ?url import to properly resolve these assets in dev and build
import datacentersUrl from './local_data/datacenters/datacenters.geojsonl?url';
import damsUrl from './local_data/dams/dams.geojsonl?url';
import airportsUrl from './local_data/airports/airports.geojsonl?url';
import portsUrl from './local_data/ports/ports.geojsonl?url';
import { AIRPORTS_LAYER_ID } from './airportsData.js';
import { PORTS_LAYER_ID } from './portsData.js';
import { metarStationId, requestAirportMetar } from './airportWeather.js';

/**
 * Registry of local GeoJSON datasets.
 * These are lazily loaded natively into Cesium when enabled.
 */
const datacenters = createLocalGeoJsonLayer({
  id: 'local-datacenters',
  url: datacentersUrl,
  name: 'Datacenters',
  color: '#00ffff', // Cyan
  icon: '▣',
  source: 'Local',
  labels: true,
  labelMax: 700,
  labelGridPx: 138,
});

// Letecký balík 2 (2026-09-02): globálne letiská z OurAirports (public
// domain; provenance v local_data/airports/README.md). Statický náprotivok
// živej leteckej vrstvy — trať lietadla niekam VEDIE a glóbus to miesto
// teraz pozná. 6 146 bodov (large/medium + small so scheduled service).
const airports = createLocalGeoJsonLayer({
  id: AIRPORTS_LAYER_ID,
  url: airportsUrl,
  name: 'Airports',
  color: '#8ab4f8', // Chladná letecká modrá — drží sa od cyan datacentier.
  icon: '⊞',
  source: 'OurAirports',
  labels: true,
  labelMax: 700,
  labelGridPx: 140,
  // Klik na letisko → METAR cez /api/metar (aviationweather.gov, public
  // domain) a prebuild karty, keď odpoveď dorazí. Len pri výbere — nikdy
  // pre ambient kohortu (100 req/min je spoločný limit celej služby).
  onFeatureSelected: (props, { refreshEntry }) => {
    const station = metarStationId(props);
    if (!station) return;
    // requestAirportMetar nastaví pending zápis synchrónne (pred prvým
    // await), takže refreshEntry hneď ZA ním ukáže 'METAR…' placeholder;
    // onDone potom prebuduje kartu s reálnymi riadkami.
    requestAirportMetar(station, { onDone: refreshEntry });
    refreshEntry();
  },
});

// Lodný balík (2026-09-02): globálne prístavy z World Port Index (NGA,
// public domain; provenance v local_data/ports/README.md) — statický
// náprotivok AIS vrstvy, ako letiská pre lietadlá. POZOR: oceánsky
// register, Dunaj v ňom nie je (riečne prístavy = EuRIS, čaká na licenčné
// rozhodnutie).
const ports = createLocalGeoJsonLayer({
  id: PORTS_LAYER_ID,
  url: portsUrl,
  name: 'Ports',
  color: '#7fd1c0', // Prístavná teal — drží odstup od AIS cyan aj letiskovej modrej.
  icon: '⊔',
  source: 'NGA WPI',
  labels: true,
  labelMax: 700,
  labelGridPx: 140,
});

const dams = createLocalGeoJsonLayer({
  id: 'local-dams',
  url: damsUrl,
  name: 'Dams',
  color: '#0088ff', // Blue
  icon: '▰',
  source: 'USACE',
  labels: true,
  labelMax: 900,
  labelGridPx: 132,
});

// Live NASA FIRMS fires (VIIRS ×3 NRT via the /api/firms proxy). The id keeps
// the historical `local-` prefix for persistence + voice-tool-enum compat,
// but the data is NOT bundled anymore — it needs FIRMS_MAP_KEY server-side.
const fires = createFirmsHeatmapLayer({
  id: 'local-firms',
  name: 'FIRMS Active Fires',
  icon: '▲',
  source: 'NASA FIRMS · LIVE',
});

export default [
  airports,
  ports,
  datacenters,
  dams,
  // OKO (Fáza 4): the SK energy grid sits where the submarine cables tile
  // used to matter — cables stay available, but a landlocked fork leads with
  // infrastructure that exists here.
  skEnergyLayer,
  submarineCablesLayer,
  fires,
];
