import { createLocalGeoJsonLayer } from './localGeojson.js';
import { airportMarkerImage, portMarkerImage } from './localMarkerIcons.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import submarineCablesLayer from './telegeographySubmarineCables.js';
import skEnergyLayer from './skEnergy.js';
import shippingLanesLayer from './shippingLanes.js';
import shipDensityLayer from './shipDensity.js';
import airDensityLayer from './airDensity.js';

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
  // Magenta (2026-09-05, „aby sa to rozlíšilo, nie cyan"): pôvodná letecká
  // modrá #8ab4f8 v cyanovej scéne (lety, AIS, káble, HUD) splývala. Magentu
  // nepoužíva žiadna iná vrstva a na VFR leteckých mapách sa letiská kreslia
  // práve ňou. Rovnakú farbu nesie DOM karta letiska (style.css .airport-card).
  color: '#ff66d4',
  // Krížne dráhy v kruhu — značka letiska z leteckých máp (2026-09-05:
  // predchádzajúce '⊞' bola len škatuľa s plusom a nehovorila nič). Lietadlo
  // '✈︎' patrí živým letom, takže letiská nesú svoju vlastnú, mapovú značku.
  icon: '⊗',
  source: 'OurAirports',
  labels: true,
  labelMax: 700,
  labelGridPx: 140,
  // Stupne popisu podľa priblíženia (2026-09-05: pri pohľade na strednú Európu
  // zo 700 km bolo 25 trojriadkových kariet cez pol obrazovky). Ďaleko len
  // kód veľkých letísk, bližšie kód s mestom, plná karta až pri priblížení.
  labelLod: true,
  // Na mape lietadlo v kruhu, nie bodka (2026-09-05: „a ikony si nezmenil").
  markerImage: airportMarkerImage,
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
  // Rovnaký dôvod ako pri letiskách: 3 807 prístavov s rovnakou škálou
  // dôležitosti (veľký/stredný/malý) zaplavilo pobrežia kartami.
  labelLod: true,
  // Na mape kotva v kruhu.
  markerImage: portMarkerImage,
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
  shippingLanesLayer,
  // Historical ship density (World Bank / IMF 2015–2021): the "where do ships
  // go" answer for the regions terrestrial AIS cannot hear. MODELLED, not live.
  shipDensityLayer,
  // Historical air-traffic density (adsb.lol, one day): where aircraft fly,
  // including ocean routes the live feed only hears at the edges. MODELLED.
  airDensityLayer,
  datacenters,
  dams,
  // OKO (Fáza 4): the SK energy grid sits where the submarine cables tile
  // used to matter — cables stay available, but a landlocked fork leads with
  // infrastructure that exists here.
  skEnergyLayer,
  submarineCablesLayer,
  fires,
];
