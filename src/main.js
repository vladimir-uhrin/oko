import * as Cesium from 'cesium';
import { initAuthPanel } from './auth/panel.js';
import { createFollowedFlights, installFollowButton } from './followedFlights.js';
import './auth/panel.css';
// Admin (2026-10-03): anonymná štatistika návštev a oznam prevádzkovateľa.
import { initSiteTelemetry } from './siteTelemetry.js';
import { initNoticeBanner } from './noticeBanner.js';
import './noticeBanner.css';
import { applyDomTranslations, currentLanguage, setLanguage, t } from './i18n.js';
import { StyleManager } from './ui.js';
import { flyToBratislava } from './camera.js';
import { DataLayerManager, layerDisplayName } from './data/manager.js';
import flightsLayer from './data/flights.js';
import militaryFlightsLayer from './data/militaryFlights.js';
import earthquakesLayer from './data/earthquakes.js';
import volcanoesLayer from './data/volcanoes.js';
import naturalEventsLayer from './data/naturalEvents.js';
import shmuRadarLayer from './data/shmuRadar.js';
import shmuWarningsLayer from './data/shmuWarningsLayer.js';
import shmuStationsLayer from './data/shmuStationsLayer.js';
import operaRadarLayer from './data/operaRadarLayer.js';
import { createWeatherDock } from './weatherDock.js';
// Lenivý zástupca: skutočný meteoLayer.js sa dotiahne až pri otvorení vrstvy
// (obmedzenie zadania — news stránky nesmú ťahať weather kód). Viď meteoLazy.js.
import meteoLayer from './data/meteoLazy.js';
import satellitesLayer from './data/satellites.js';
import rocketLaunchesLayer from './data/rocketLaunches.js';
import trafficLayer from './data/traffic.js';
import cctvLayer from './data/cctv.js';
import radioLayer from './data/radio.js';
import bikeshareLayer from './data/bikeshare.js';
import aisLiveVesselsLayer from './data/aisLiveVessels.js';
import gfwPresenceLayer from './data/gfwPresence.js';
import { createAishubVesselsLayer } from './data/aishubVessels.js';
import gfwSarDetectionsLayer from './data/gfwSarDetections.js';
import gasFlowsLayer from './data/gasFlowsLayer.js';
import gasPipelinesLayer from './data/gasPipelinesLayer.js';
import militaryInstallationsLayer from './data/militaryInstallations.js';
import militaryAwarenessLayer from './data/militaryAwareness.js';
import localDataLayers from './data/localLayers.js';
import gibsOverlayLayers from './data/gibsOverlays.js';
import { bindActiveMapStackToEvents, getActiveMapStack, onActiveMapStackChange } from './data/activeMapStack.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';
import { registerDataCredits } from './data/dataCredits.js';
import { SceneDirector } from './scenes/director.js';
import { initGevVoiceCommands, setVoiceAccessGate } from './voice/gevRealtime.js';
import { MapStackController } from './mapStackController.js';
import { createPhotorealTileset, isGoogleRegionBlocked } from './photorealTileset.js';
import { isCrawlerUserAgent } from './crawlerDetect.js';
import { initAnalytics, trackEvent } from './analytics.js';
import { AUTO_BASEMAP_STORAGE_KEY, createLayerBasemapPolicy, meteoBasemapForHost, parseAutoBasemapSetting } from './layerBasemap.js';
import { installDayNightClock } from './globeLighting.js';
import { installSharpStarfield } from './starfield.js';
import { armStartupGate, releaseStartupGate } from './startupGate.js';
import { bindContactPaletteToMapStack } from './data/contactPalette.js';
import { initAnnotations } from './annotations/index.js';
import { applyChokepointScene, chokepointSceneById, chokepointSceneFacts, chokepointSceneLabel, listChokepointScenes } from './chokepointScenes.js';
import { createOilPriceChip, createOilPricePanel } from './oilPriceChip.js';
import { createStraitTrafficChip } from './straitTrafficChip.js';
import { createIncidentCards } from './gulfIncidentCards.js';
import { createSceneRevealGate } from './sceneRevealGate.js';
import { createMapScaleBar } from './mapScaleBar.js';
import { createCountryBoundaries } from './data/countryBoundaries.js';
import { createConflictBulletin } from './conflictBulletin.js';
import { applyFrontScene, frontSceneById, frontSceneFraming, frontSceneLabel, listFrontScenes } from './ukraineFrontScenes.js';
import { MIDEAST_BULLETIN_REGIONS, applyMideastTheatre, listMideastTheatres, theatreById, theatreFraming, theatreLabel } from './data/mideastTheatres.js';
import { createMideastPanel } from './mideastPanel.js';
import { createMideastControl } from './mideastControlLayer.js';
import { createAirspaceAdvisory } from './airspaceAdvisoryLayer.js';
import { createUkmtoIncidents } from './ukmtoIncidentsLayer.js';
import { createGpsInterference } from './gpsInterferenceLayer.js';
import { UKMTO_CHOKEPOINT_SCENES } from './data/ukmto.js';
import { createPortwatchCard } from './portwatchCard.js';
import { PORTWATCH_KEYS, portwatchKeyForTheatre } from './data/portwatch.js';
import { createUkraineKartaOverlay } from './ukraineKartaOverlay.js';
import { createLeftLane } from './leftLane.js';
import { createFireNewsCard } from './fireNewsCard.js';
import { CARD_RATIO_IDS, captureConflictCard, conflictCardFilename, conflictCardModel, defaultConflictFacts, downloadCardSnapshot } from './conflictExport.js';
import { conflictById, conflictTitle, listConflicts } from './data/conflictsCatalog.js';
import { createConflictsPanel } from './conflictsPanel.js';
import { createCommandPalette } from './commandPalette.js';
import { LAYER_GROUP_ORDER, isCatalogLayer, layerGroup, layerKeywords } from './layerCategories.js';
import { flyToGlobeView, searchAndFlyTo } from './locations.js';
import { createAircraftSearchCommands } from './aircraftSearchCommands.js';
import { buildConflictDigest } from './conflictSummary.js';
import { fetchUkraineReport } from './data/ukraineReport.js';
import { buildOilModel, fetchOilPrices } from './data/oilPrices.js';
import { buildSituationModel, fetchSituationNews } from './data/situationNews.js';
import { createUkraineBaseLayer } from './data/ukraineBaseLayer.js';
import { pickPlaceSide } from './data/ukraineBase.js';
import { createUkraineReportLayer } from './data/ukraineReportLayer.js';
import { createUkrainePanel } from './ukrainePanel.js';
import { createUkraineDirectionCard } from './ukraineDirectionCard.js';
import { createUkraineEventsLayer } from './ukraineEventsLayer.js';
import { createUkraineControlLayer } from './ukraineControlLayer.js';
import { createUkraineAreasLayer } from './data/ukraineAreasLayer.js';
import { createUkraineDeepStateLayer } from './ukraineDeepStateLayer.js';
import { createUkraineDamageLayer } from './ukraineDamageLayer.js';
import { createUkraineAlertAreasLayer } from './ukraineAlertAreasLayer.js';
import { createUkraineTimeline, parseShareParams } from './ukraineTimeline.js';
import { initLogoGaze } from './logoGaze.js';
import { initCockpitCloudEffects } from './cockpitCloudEffects.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { installScopeMask } from './scopeMask.js';
import { initFirstRunExperience } from './firstRunExperience.js';
import { installEmbedMode, isEmbedMode } from './embedMode.js';
import { initMobileShell } from './mobileShell.js';
import { setWorldOverlayLaneSuppressed } from './overlays/worldOverlay.js';

initLogoGaze();

/**
 * Extract a human-readable error message from any thrown value.
 * Handles Error objects, strings, and plain objects with message/error fields.
 * @param {*} error — caught exception value
 * @returns {string} best-effort error description
 */
function describeError(error) {
  if (!error) return 'Unknown initialization error';
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message.trim();
    return error.name || 'Initialization error';
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object') {
    const maybeMessage = String(error.message || error.error || '').trim();
    if (maybeMessage) return maybeMessage;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore serialization error
    }
  }
  return String(error);
}

/**
 * GOD'S EYE VIEW — Main Entry Point
 * Initializes CesiumJS with Google Photorealistic 3D Tiles,
 * style system, intelligence HUD, location presets, and share links.
 */
/** Najdlhšie, čo preloader čaká na obnovu odkazu (vrstvy, kamera), kým uvoľní glóbus. */
const STARTUP_RESTORE_CAP_MS = 12_000;

async function init() {
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');
  // Brána štartu (startupGate.js): ťažké živé dáta (lode) čakajú, kým je mapa
  // zobrazená a štartová kamera na mieste; uvoľní ju skrytie preloadera nižšie.
  armStartupGate();

  // Jazyk UI čo najskôr: statické data-i18n uzly sa preložia PRED prvým
  // vykreslením panelov a prepínač SK/EN sa aktivuje (persist + reload —
  // stav pohľadu prežije v share-hashi, viď src/i18n.js).
  applyDomTranslations();
  // Odkaz na obsahové stránky v jazyku UI (/sk/ alebo /en/).
  document.getElementById('topics-link')?.setAttribute('href', currentLanguage() === 'sk' ? '/sk/' : '/en/');
  for (const button of document.querySelectorAll('#lang-switch button[data-lang]')) {
    const lang = button.getAttribute('data-lang');
    button.dataset.active = String(lang === currentLanguage());
    button.addEventListener('click', () => {
      if (lang !== currentLanguage()) setLanguage(lang);
    });
  }

  try {
    loaderStatus.textContent = t('loader.configuring');

    // Set Cesium Ion token for World Terrain
    const cesiumToken = import.meta.env.CESIUM_ION_TOKEN;
    if (cesiumToken) {
      Cesium.Ion.defaultAccessToken = cesiumToken;
    }

    // Set Google Maps API key for 3D Tiles
    const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
    if (!googleApiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY not found. Set it as an environment variable.');
    }
    Cesium.GoogleMaps.defaultApiKey = googleApiKey;

    // Expose API key globally for geocoding in locations.js
    window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;

    // Create the Cesium viewer with minimal chrome
    const viewer = new Cesium.Viewer('cesiumContainer', {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: false,
      // Bez predvolenej Tycho oblohy pri štarte (2026-09-29): jej šesť JPEG
      // (867 KB) súperilo s 3D dlaždicami, hoci predvolený pohľad (kolmo dole)
      // oblohu neukazuje. Ostrú oblohu nasadí startSharpStarfield po skrytí
      // preloadera; Slnko a Mesiac (Cesium ich bez skyBoxu nevytvorí) nižšie.
      skyBox: false,
      // Visible attribution container — Google Maps / 3D Tiles credits are
      // required by Google's Terms of Service, so they must be shown (styled
      // subtly via #cesium-credits). The credit line stays visible in
      // clean-view AND recording modes too (ToS requires attribution while the
      // content is displayed — those are the exact modes used to record
      // demos), including the "Data attribution" link that opens the per-layer
      // license popover.
      creditContainer: (() => {
        const el = document.createElement('div');
        el.id = 'cesium-credits';
        document.body.appendChild(el);
        return el;
      })(),
      msaaSamples: 4,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
        },
      },
    });

    // Cap the default render loop at 60 fps. Cesium's loop otherwise runs at
    // the display's refresh rate — 120 Hz on ProMotion panels — doubling GPU
    // and CPU burn for zero visual benefit in a map app whose animation
    // cadences (poll interpolation, trail fades, style crossfades) are all
    // designed against wall-clock time, not frame count. Measured on the
    // 2026-08-05 perf investigation as a strict halving of idle burn on
    // 120 Hz hardware; a no-op on 60 Hz displays. (perf item 2)
    viewer.targetFrameRate = 60;

    // skyBox: false vynechá aj Slnko a Mesiac (CesiumWidget ich vytvára spolu
    // s oblohou) — doplniť, nech sa nič okrem načasovania oblohy nemení.
    viewer.scene.sun = new Cesium.Sun();
    viewer.scene.moon = new Cesium.Moon();

    // Hodiny scény v reálnom čase + minútový tik pre terminátor (globeLighting.js):
    // Viewer inak zmrazí clock.currentTime na čase načítania a Slnko s ním.
    installDayNightClock(viewer, { requestRender: governorRequestRender });

    // Ostré hviezdy (starfield.js): Tycho steny Cesia ako stlmené pozadie
    // (Mliečna dráha, hustota) + generované ostré body navrchu. Prvá verzia
    // bola len z bodov a pôsobila prázdne („tie hviezdy daj naspäť"), samotné
    // Tycho JPEG je rozmazané („oprav ostrosť hviezd") — toto je oboje.
    // `?stars=cesium` vráti pôvodný skybox (hneď). Ostrá obloha sa generuje až
    // po skrytí preloadera, keď je vlákno voľné (2026-09-29: jej maľovanie
    // a nahratie do GPU pri štarte zdržiavalo appku; pod preloaderom ju nikto
    // nevidí).
    const sharpStars = new URLSearchParams(window.location.search).get('stars') !== 'cesium';
    if (!sharpStars) viewer.scene.skyBox = Cesium.SkyBox.createEarthSkyBox();
    const startSharpStarfield = () => {
      if (!sharpStars) return;
      const run = () => {
        try { installSharpStarfield(viewer); } catch (error) { console.warn('[Init] sharp starfield unavailable:', error); }
      };
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 3000 });
      else setTimeout(run, 500);
    };

    // Diagnostika render pádov (2026-09-01): renderError Cesium render loop
    // NAVŽDY zastaví — dialóg ale ukazuje len message. Stack ide do konzoly,
    // aby transientné pády (trieda „Expected width to be greater than 0",
    // 0×0 textúra) boli dohľadateľné z reportu používateľa aj z QA logov.
    viewer.scene.renderError.addEventListener((scene, error) => {
      console.error('[RenderError] rendering stopped:', error?.stack || error);
    });

    // Bez Cesium ion tokenu odstráň default „Cesium ion" logo z kreditov:
    // CesiumJS je Apache-2.0 a logo je len zdvorilostný default — POVINNÉ je
    // až pri používaní ion služieb (Bing stacky / ion terén), ktoré bez
    // tokenu nikdy nebežia. S tokenom logo ostáva (ion ToS vyžaduje
    // atribúciu). Google logo sa NIKDY neodstraňuje — Maps Platform ToS ho
    // vyžaduje viditeľné, kým sa renderuje Google obsah (viď komentár pri
    // creditContainer vyššie).
    if (!cesiumToken) {
      Cesium.CreditDisplay.cesiumCredit = undefined;
    }

    // Register per-layer data attribution into the "Data attribution" popover.
    // Required by each source's license (ODbL, CC BY-NC-SA, NASA FIRMS, etc.);
    // strings are verbatim from DATA_SOURCES.md. Static + always-present in the
    // expandable bottom-left credit lightbox (showOnScreen=false), so they never
    // clutter the on-globe attribution line.
    registerDataCredits(viewer);

    // Hide Cesium's default globe — Google Photorealistic 3D Tiles provide their own
    // globe at all LODs (street level → orbital). The default globe's 2D imagery
    // clips through 3D tile buildings at close range.
    viewer.scene.globe.show = false;

    // Keep a sky behind Google 3D Tiles, but soften Cesium's high-intensity
    // default atmosphere. With the globe hidden its bright limb otherwise
    // reads as a hard cyan seam where distant photoreal tiles meet the sky.
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;

    loaderStatus.textContent = t('loader.google-tiles');
    let tileset = null;
    /** 'google' | 'ion' | null — odkiaľ fotoreál naozaj tečie (chip title, QA). */
    let photorealSource = null;
    /** Prečo je fotoreál nedostupný — do tooltipu čipu, nech používateľ nehľadá chybu u seba. */
    let photorealUnavailableReason = null;
    // QA/headless ochrana kvóty (2026-09-01): každý boot appky stojí Google
    // root tile request a denná kvóta je zámerne tesná (CLAUDE.md — billing
    // ochrana). Testovacie skripty bootujú s ?qaBasemap=osm a Google tileset
    // sa vtedy VÔBEC nevytvorí — appka ide rovno na OSM stack (konštruktor
    // MapStackController null tileset už rieši). Deň s desiatkami headless
    // overení tak nevyčerpá kvótu reálnym pozeraniam (429 na root.json).
    const qaBasemapOsm = new URLSearchParams(window.location.search).get('qaBasemap') === 'osm';
    // SEO (2026-09-30): roboty vyhľadávačov si appku vykresľujú — tá istá ochrana kvóty ako
    // pri QA, obsah stránky ostáva rovnaký (src/crawlerDetect.js).
    const crawlerVisit = isCrawlerUserAgent(navigator.userAgent);
    try {
      if (qaBasemapOsm) throw new Error('qaBasemap=osm — Google tileset skipped to protect the daily root-request quota');
      if (crawlerVisit) throw new Error('crawler — photorealistic tiles skipped to protect the quota');
      // Google Photorealistic 3D Tiles: najprv priamo Google kľúčom, pri EHP
      // 403 („not available for your account and region", od 2026-09-04) cez
      // Cesium ion asset 2275207 — tie isté dlaždice pod zmluvou Cesiumu
      // (photorealTileset.js; podmienky v DATA_SOURCES.md).
      const photoreal = await createPhotorealTileset({
        hasGoogleKey: !!googleApiKey,
        hasIonToken: !!cesiumToken,
      });
      tileset = photoreal.tileset;
      photorealSource = photoreal.source;
      if (photoreal.source === 'ion') {
        console.info(`[Init] Google 3D Tiles via Cesium ion (${photoreal.regionBlocked ? 'EEA region block' : 'Google path failed'}):`, photoreal.googleError);
      }
      viewer.scene.primitives.add(tileset);
      // NOTE: Cesium World Terrain intentionally disabled — conflicts with Google 3D Tiles at high zoom.
      // Google Photorealistic 3D Tiles provide their own terrain/elevation.
      viewer.scene.globe.show = false;
    } catch (tileError) {
      console.warn('[Init] Google 3D Tiles unavailable, falling back to Cesium globe:', tileError);
      const tileErrorDetail = describeError(tileError);
      // EHP odmietnutie dostane ľudskú vetu (nie je to chyba používateľa);
      // ostatné chyby nesú svoj text.
      photorealUnavailableReason = (tileError?.regionBlocked || isGoogleRegionBlocked(tileError))
        ? t('mapstack.photoreal-eea', { detail: tileErrorDetail })
        : tileErrorDetail;
      loaderStatus.textContent = t('loader.google-tiles-fallback', { detail: tileErrorDetail });
      // Keep Cesium globe visible as fallback instead of aborting the app.
      viewer.scene.globe.show = true;
    }

    loaderStatus.textContent = t('loader.init-systems');

    // `?terrain=sk` vynúti merge terén (DMR 3.5 nad SR + Re:Earth vo svete)
    // aj keď je ion token prítomný — bez toho ho s tokenom nie je ako vidieť,
    // lebo Cesium World Terrain má prednosť. `?terrain=world` je opak.
    const terrainPreference = new URLSearchParams(window.location.search).get('terrain') || 'auto';

    const mapStackController = new MapStackController(viewer, {
      googleTileset: tileset,
      photorealSource,
      photorealUnavailableReason,
      cesiumToken,
      terrainPreference,
      initialStack: tileset ? 'photoreal' : 'osm',
      // Task 5 (height-datum fix): rebroadcast stack changes as a window
      // CustomEvent so data layers (CCTV per-regime ground resolution) can
      // react without coupling MapStackController to layer modules. Fires on
      // 'switching'/'ready'/'error'; listeners derive the surface regime from
      // live scene state, so intermediate emissions are harmless.
      onChange: (state) => {
        window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: state }));
      },
      onError: (message) => console.warn('[MapStack]', message),
    });
    await mapStackController.setStack(tileset ? 'photoreal' : 'osm', { silent: true });
    // Paleta ikon kontaktov podľa kontrastu podkladu (contactPalette.js):
    // prvý setStack je tichý, tak sa počiatočný stav berie priamo z podkladu.
    bindContactPaletteToMapStack(window, mapStackController.getActiveStack());
    // Aktívny podklad pre dátové vrstvy (activeMapStack.js): prekryvy NASA GIBS
    // na fotoreáli nemajú povrch a riadok panelu to musí povedať.
    bindActiveMapStackToEvents(window, mapStackController.getActiveStack());
    // Vrstva si môže vyžiadať vhodný podklad (meteorológia: Blue Marble
    // namiesto fotoreálu, pri vypnutí späť). Kontrolér ostáva jediným
    // vlastníkom prepínania — vrstvy len prosia udalosťou.
    window.addEventListener('gev:request-map-stack', (event) => {
      const id = String(event?.detail?.id || '');
      // Meteo riadi mapa podľa vrstvy (layerBasemap.js, 2026-10-05): jedny pravidlá, hláška, štítok AUTO.
      if (String(event?.detail?.reason || '').startsWith('meteo')) return;
      if (!id || !mapStackController.getStack(id) || mapStackController.getActiveId() === id) return;
      void mapStackController.setStack(id);
    });

    // Initialize the style manager (post-processing, HUD, locations, share links)
    const styleManager = new StyleManager(viewer, { mapStackController, account: accountCenter });
    // Živý rámček (2026-10-06, src/embedMode.js): /?embed=1 = len mapa so živými vrstvami, karty
    // a lišta OKO; bez panelov, súhlasu a privítania (rámček býva na stránke odkazu alebo na cudzom webe).
    const embedView = isEmbedMode(window.location.search);
    if (embedView) installEmbedMode({ document, window, styleManager, translate: t });
    // Ľavý stĺpec v logickom poriadku (vlastník 2026-09-27; src/leftLane.js): Zobrazenie, Kamery
    // a Kontext sú panely ľavého pruhu v zónach, naraz je otvorený jeden panel, celá hlavička
    // otvára. Na mobile sa nepresúva (obe strany skryté, panely nosí výsuv); pri prepnutí sa zosúladí.
    // Správy a história k ohnisku FIRMS (2026-10-06): karta vpravo dole po kliknutí na ohnisko.
    createFireNewsCard({ doc: document, win: window });
    const leftLane = createLeftLane({
      doc: document,
      setPanelCollapsed: (id, collapsed, opts) => styleManager.setPanelCollapsed?.(id, collapsed, opts),
      syncPanel: (panel) => styleManager._syncPanelCollapseButton?.(panel),
      // engine meria cez vnútorný obal; Zobrazenie ho nemá (namerá 44 px) — jeho obsah ukáže scrollHeight
      measurePanel: (panel) => Math.max(styleManager._measureLeftPanelNaturalHeight?.(panel) || 0, panel.scrollHeight || 0),
    });
    const syncLeftLane = () => {
      if (document.body.classList.contains('oko-mobile')) { leftLane.undock(); return; }
      if (leftLane.dock()) leftLane.enforceSingleOpen({ persist: true });
    };
    syncLeftLane();
    leftLane.installHeaderToggle();
    leftLane.installRevealOnOpen();
    new MutationObserver(syncLeftLane).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // Obnova odkazu môže otvoriť viac panelov naraz — po nej zase jeden.
    window.addEventListener('gev:initial-share-restore-settled', () => { leftLane.enforceSingleOpen(); leftLane.fitOpen(); });
    // panel otvorený už pri štarte (spravidla Dátové vrstvy) sa zmeria, keď má obsah
    setTimeout(() => leftLane.fitOpen(), 1500);
    // Mobilný plášť (2026-09-14): na dotyku / úzkej obrazovke spodná lišta
    // a výsuvné panely namiesto bočných stĺpcov; širší výber prstom; bez
    // ambientných kariet na plátne (jedna vybraná karta naraz).
    window.__okoMobileShell = initMobileShell({
      styleManager,
      scene: viewer.scene,
      suppressLane: setWorldOverlayLaneSuppressed,
      embed: embedView,
    });
    // The previous multi-canvas weather compositor remains disabled. Cockpit
    // clouds use a separate, capped low-resolution GPU pass that never attaches
    // Cesium fog or post-process stages and is fully stopped in map mode.
    const weatherEffects = null;
    const cockpitCloudEffects = initCockpitCloudEffects(viewer);

    // If no share link state, do default fly-to Austin
    if (!styleManager.hasShareState) {
      loaderStatus.textContent = t('loader.fly-bratislava');
      flyToBratislava(viewer);
    } else {
      loaderStatus.textContent = t('loader.restore-shared');
    }

    // Initialize data layer manager
    const dataManager = new DataLayerManager(viewer, {
      allowQaRegistration: import.meta.env.DEV,
      mapStackController,
    });
    // Štatistika (2026-10-04): len prepnutie vrstvy používateľom (origin user) — obnova z odkazu
    // a lokálneho stavu má iný origin; pred štartom GA aj tak nič neodíde (trackEvent).
    // Len vývojový server: prepínanie vrstiev a máp pre kontrolné snímky (scripts/qa-*.mjs).
    if (import.meta.env.DEV) window.__okoQa = { setLayer: (id, on, origin = 'user') => dataManager.setEnabled(id, on, { origin }), setMap: (id) => styleManager._setMapStack(id), map: () => mapStackController.getActiveId(), layers: () => [...dataManager.layers.keys()] };
    // Mapa podľa vrstvy (2026-10-05, src/layerBasemap.js): pri kliknutí na vrstvu vhodnejší podklad
    // s hláškou a návratom; ručná voľba mapy má prednosť; vypínač v Zobrazení.
    const autoBasemapToggle = document.getElementById('map-auto-basemap');
    const readAutoBasemap = () => { try { return parseAutoBasemapSetting(localStorage.getItem(AUTO_BASEMAP_STORAGE_KEY)); } catch { return true; } };
    if (autoBasemapToggle) autoBasemapToggle.checked = readAutoBasemap();
    const layerBasemap = createLayerBasemapPolicy({
      getActiveId: () => mapStackController.getActiveId(),
      hasStack: (id) => Boolean(mapStackController.getStack(id)),
      setStack: (id) => { void styleManager._setMapStack(id); },
      isOn: () => (autoBasemapToggle ? autoBasemapToggle.checked : readAutoBasemap()),
      resolveMap: (layerId) => (layerId === 'meteo-gfs' ? meteoBasemapForHost(window.location.hostname) : null),
      // Štítok AUTO na aktívnom čipe mapy (style.css): mapu práve drží vrstva, nie ručná voľba.
      onState: ({ auto }) => { if (auto) document.body.dataset.autoBasemap = 'on'; else delete document.body.dataset.autoBasemap; },
      notify: ({ layerId, mapId, undo }) => {
        // Zrozumiteľne (2026-10-05): „na reliéf kvôli vrstve Zemetrasenia", nie technické mená máp.
        const mapKey = `basemap.name.${mapId}`;
        const mapName = t(mapKey) === mapKey ? (mapStackController.getStack(mapId)?.label || mapId) : t(mapKey);
        const layerKey = `layer.${layerId}.name`;
        // Bez dovetku: „Zemetrasenia (24 h)" → „Zemetrasenia", „Meteorológia · vietor a teplota" → „Meteorológia".
        const layerName = (t(layerKey) === layerKey ? layerId : t(layerKey)).split(' (')[0].split(' · ')[0];
        styleManager._showToast?.(t('basemap.auto-toast', { map: mapName, layer: layerName }), { durationMs: 7000, onClick: undo, tone: 'info' });
      },
    });
    // Zblízka pôvodná mapa (Google 3D), z diaľky mapa vrstvy — po dokončení pohybu kamery.
    viewer.camera.moveEnd.addEventListener(() => layerBasemap.onCameraHeight(viewer.camera.positionCartographic?.height));
    layerBasemap.onCameraHeight(viewer.camera.positionCartographic?.height);
    onActiveMapStackChange((stack) => layerBasemap.onMapChange(stack?.id ?? null));
    window.addEventListener('gev:map-stack-manual', () => layerBasemap.onManualChoice());
    autoBasemapToggle?.addEventListener('change', () => {
      try { localStorage.setItem(AUTO_BASEMAP_STORAGE_KEY, autoBasemapToggle.checked ? 'on' : 'off'); } catch { /* súkromné okno */ }
      layerBasemap.onSettingChange(autoBasemapToggle.checked);
    });
    dataManager.subscribe?.((change) => {
      if (change?.type === 'visibility') layerBasemap.onLayerChange({ layerId: change.layerId, enabled: Boolean(change.enabled), origin: change.origin });
    });
    dataManager.subscribe?.((change) => {
      if (change?.type === 'visibility' && change.origin === 'user') trackEvent('layer_toggle', { layer_id: change.layerId, enabled: Boolean(change.enabled) });
    });
    dataManager.register(flightsLayer);
    dataManager.register(militaryFlightsLayer);
    dataManager.register(earthquakesLayer);
    dataManager.register(volcanoesLayer);
    dataManager.register(naturalEventsLayer);
    dataManager.register(shmuRadarLayer);
    // Výstrahy SHMÚ po okresoch (2026-10-08, sekcia POČASIE).
    dataManager.register(shmuWarningsLayer);
    // Merania automatických staníc SHMÚ (2026-10-08, sekcia POČASIE).
    dataManager.register(shmuStationsLayer);
    // Zrážkový radar celej Európy — EUMETNET OPERA (2026-10-08, sekcia POČASIE).
    dataManager.register(operaRadarLayer);
    // Meteorológia sveta (2026-09-08, prototyp GFS: pole + GPU častice + os).
    dataManager.register(meteoLayer);
    dataManager.register(satellitesLayer);
    dataManager.register(rocketLaunchesLayer);
    rocketLaunchesLayer.attachDataManager(dataManager);
    dataManager.register(trafficLayer);
    dataManager.register(cctvLayer);
    dataManager.register(radioLayer);
    dataManager.register(bikeshareLayer);
    dataManager.register(aisLiveVesselsLayer);
    // Satelitné AIS · oneskorené (GFW, 2026-09-12) — riadok hneď pod živými loďami.
    dataManager.register(gfwPresenceLayer);
    dataManager.register(gfwSarDetectionsLayer);
    // Lode · oneskorené (AISHub cez aiscast, 2026-09-15): druhý zdroj tam, kde
    // živý aisstream nevidí nič. Dedup: MMSI, ktoré už vidí živá vrstva, vyhráva.
    const aishubVesselsLayer = createAishubVesselsLayer({
      isLive: (mmsi) => aisLiveVesselsLayer.hasContact(mmsi),
    });
    dataManager.register(aishubVesselsLayer);
    // Toky plynu (2026-09-13, etapa 4 modulu PLYN): hraničné stanice z ENTSOG
    // ako body s popisom, z tej istej proxy ako karta TOKY v paneli.
    dataManager.register(gasFlowsLayer);
    // Plynovody EÚ + bývalý ZSSR (2026-09-13, etapa 5 modulu PLYN): statický
    // OSM snímok zo `scripts/build-gas-pipelines.mjs` cez `/api/gas/pipelines`.
    dataManager.register(gasPipelinesLayer);
    dataManager.register(militaryInstallationsLayer);
    dataManager.register(militaryAwarenessLayer);
    militaryAwarenessLayer.attachDataManager(dataManager);
    for (const layer of localDataLayers) {
      dataManager.register(layer);
    }
    for (const layer of gibsOverlayLayers) {
      dataManager.register(layer);
    }
    // Restoration starts only after the complete production registry is sealed.
    dataManager.finalizeRegistrations(LAYER_STATE_REGISTRY);
    // Výber vrstiev počasia ako na Windy (2026-10-08) — ukáže sa len pri zapnutej meteo vrstve.
    try { createWeatherDock(document, { dataManager, t }); } catch (error) { console.warn('[WeatherDock] failed:', error?.message || error); }
    if (import.meta.env.DEV) {
      window.Cesium = Cesium; // dev-only debug aid (namespace, not a secret)
      window.__gevQaRegisterLayer = (targetManager, layerModule) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.registerForQa(layerModule);
      };
      window.__gevQaUnregisterLayer = (targetManager, layerId) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.unregisterForQa(layerId);
      };
    }
    // Sekcia POČASIE (2026-10-07, src/data/weatherSection.js): riadky glóbusu GFS a radaru SHMÚ
    // idú do #weather-panel — kontajner sa nastaví pred prvým vykreslením Dátových vrstiev.
    dataManager.buildWeatherPanel(document.querySelector('#weather-panel [data-weather-body]'));
    dataManager.buildTogglePanel(document.getElementById('data-toggles'));
    styleManager.attachDataManager(dataManager);

    // Initialize deterministic scene playback for social clip capture
    const sceneDirector = new SceneDirector(viewer, styleManager, dataManager);

    // Initialize the voice "whiteboard" annotation engine (world-space renderer)
    const annotations = initAnnotations({ viewer, tileset });

    // Keep startup chrome truthful: a share is not restored until camera,
    // visual/map/panel lanes, and every requested layer have terminated.
    // Strop 12 s (2026-10-07): odkaz so zapnutými požiarmi držal preloader minúty, kým NASA FIRMS
    // odpovedala — pomalá vrstva sa dotiahne už za glóbusom (jej riadok ukazuje načítavanie).
    void Promise.all([
      Promise.race([styleManager.initialRestorePromise, new Promise((resolve) => setTimeout(resolve, STARTUP_RESTORE_CAP_MS))]),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]).finally(() => {
      loadingScreen.classList.add('hidden');
      releaseStartupGate();
      startSharpStarfield();
      // Súhlas s cookies + GA4 až po štarte (src/analytics.js; bez súhlasu GA bez cookies); v živom rámčeku nič nezbierame a na súhlas sa nepýtame (lišta by rámček zakryla).
      try { if (!embedView) initAnalytics({ t, crawler: crawlerVisit }); } catch (error) { console.warn('[analytics]', error); }
      // Reveal only after the loading cover has yielded. transitionend can be
      // absent under reduced motion, so a bounded fallback makes this reliable.
      let firstRunRevealed = false;
      const revealFirstRun = () => {
        if (firstRunRevealed) return;
        firstRunRevealed = true;
        // dataManager is passed explicitly: the globe missions enable bundled
        // keyless layers through it, and reaching for styleManager._dataManager
        // would make a private field part of this feature's contract.
        if (!embedView) initFirstRunExperience({ styleManager, dataManager });
      };
      loadingScreen.addEventListener('transitionend', revealFirstRun, { once: true });
      setTimeout(revealFirstRun, 900);
    });

    // Expose for debugging
    // Idle render governor: flips the scene into requestRenderMode whenever
    // nothing animates per frame. Installed AFTER every module above has had
    // its chance to register pre-install holds. (perf wave 2)
    installRenderGovernor(viewer);

    // The explicit scope mask replaces the emergent six-pass artifact —
    // see src/scopeMask.js. Installed before the UI so the DISPLAY-rail
    // toggle finds it live.
    installScopeMask(viewer);

    // The follow camera recomputes the tracked target's dead-reckon position
    // every frame — tracking anything is a per-frame animation. (perf wave 2)
    viewer.trackedEntityChanged.addEventListener(() => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    });

    // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
    // stop the default render loop outright — a hidden canvas repaints for
    // nobody, and browser rAF throttling still lets throttled frames burn
    // GPU. Holder/data state is untouched, so return is seamless: restore
    // the loop, refresh the one DOM surface we gated, render a frame.
    const syncVisibilitySuspension = () => {
      const hidden = document.hidden;
      viewer.useDefaultRenderLoop = !hidden;
      cockpitCloudEffects?.setSuspended?.(hidden);
      if (!hidden) {
        if (dataManager._panelRefreshPendingOnVisible) {
          dataManager._panelRefreshPendingOnVisible = false;
          dataManager._refreshTogglePanel();
        }
        governorRequestRender('visibility-restore');
      }
    };
    document.addEventListener('visibilitychange', syncVisibilitySuspension);
    // Apply the CURRENT state too — bootstrap can complete while the tab is
    // already hidden, and waiting for the next transition would leave the
    // loop burning behind a hidden tab. (perf wave 2 fix)
    syncVisibilitySuspension();

    window.__godsEyeView = {
      leftLane,
      viewer,
      styleManager,
      tileset,
      dataManager,
      sceneDirector,
      mapStackController,
      annotations,
      weatherEffects,
      cockpitCloudEffects,
      getRenderGovernorDiagnostics,
      requestRender: governorRequestRender,
    };
    window.__godsEyeView.voiceCommands = initGevVoiceCommands({ viewer, styleManager, dataManager, sceneDirector, annotations });

    // Maritime chokepoint scenes: enable the vessel / SAR / pipeline layers,
    // frame a strait and mark it — the upstream "chokehold on oil" reveal built
    // from layers we already show honestly (see src/chokepointScenes.js). Layer
    // enables use origin 'user' so a scene persists exactly like clicking those
    // rows would, matching the first-run missions.
    const chokepointSceneDeps = {
      setLayerEnabled: (layerId) => dataManager.setEnabled(layerId, true, { origin: 'user' }),
      flyToRegion: (rectDegrees) => {
        if (!viewer?.camera?.flyTo || !Array.isArray(rectDegrees) || rectDegrees.length !== 4) return null;
        viewer.trackedEntity = undefined;
        // Oblique 3D framing (user „nastav šikmý uhol"): sit south of the strait,
        // tilt up ~32° and look north across it — like the upstream reveal. We fly
        // to a Cartesian3 (a Rectangle destination silently no-ops while the 3D
        // tileset is still streaming); the orientation gives the tilt.
        const [w, s, e, n] = rectDegrees;
        const lon = (w + e) / 2;
        const lat = (s + n) / 2;
        const spanDeg = Math.max(Math.abs(e - w), Math.abs(n - s));
        const height = Math.max(140_000, spanDeg * 95_000);
        const backoffDeg = Math.max(1.3, spanDeg * 0.75);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat - backoffDeg, height),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-32), roll: 0 },
          duration: 3.2,
        });
        return null;
      },
      // The strait pin is NOT persisted here — the reveal gate annotates/clears it
      // on approach, so it appears only when zoomed in over the strait.
    };
    // Brent/WTI oil-price chip (variant B): the "what is oil doing" context that
    // accompanies a chokepoint reveal. Spot prices from FRED (EIA, public domain)
    // via /api/oil/prices; shown whenever a scene is applied, by any trigger.
    const oilPriceChip = createOilPriceChip();
    window.__godsEyeView.oilPriceChip = oilPriceChip;
    // Oil prices also live in the DATA tab (independent of any scene — the price
    // is a global macro figure, not something specific to one strait). Lazy-loads
    // the first time the "CRUDE OIL / ROPA" panel is expanded.
    const oilPricePanel = createOilPricePanel();
    window.__godsEyeView.oilPricePanel = oilPricePanel;
    // The ZÁLIV panel body is filled further down by the merged conflict bulletin.
    // Map-anchored open-source "hot cards" over the reported places (Phase B):
    // shown with a scene that has a newsRegion, deduped per story, each links out.
    // Gated by the reveal gate so they only appear when zoomed in over the strait.
    const incidentCards = createIncidentCards({ viewer });
    window.__godsEyeView.incidentCards = incidentCards;
    // Live "vessels in the strait now" counter — counts live + delayed AIS
    // contacts inside the scene's rectangle and keeps polling as the feeds load.
    const straitTrafficChip = createStraitTrafficChip({
      getLivePositions: () => aisLiveVesselsLayer.getAllPositions(5000),
      getDelayedPositions: () => aishubVesselsLayer.getAllPositions(5000),
      getDarkPositions: () => gfwSarDetectionsLayer.getAllPositions(),
    });
    window.__godsEyeView.straitTrafficChip = straitTrafficChip;
    // Reveal-on-approach gate (user: „nech sa všetko objavuje iba pri priblížení
    // nad Hormuzom, nie na celej planéte"): the fixed chips carry .oko-scene-overlay
    // so a body class can dim them when the camera pulls back to the whole globe,
    // and the map-anchored hot cards subscribe via onChange.
    oilPriceChip.element?.classList?.add('oko-scene-overlay');
    straitTrafficChip.element?.classList?.add('oko-scene-overlay');
    // Gated strait pin — its OWN datasource (amber point + label), NOT the
    // annotation engine, whose "make-visible" zoom would override the oblique
    // fly-in (the old km:3-over-water bug). Shown only while the reveal gate says
    // we are over the strait.
    const scenePinDs = new Cesium.CustomDataSource('oko-scene-pin');
    scenePinDs.show = false;
    try { viewer.dataSources.add(scenePinDs); } catch { /* headless */ }
    // Popisok pinu je parameter (2026-09-26): úžiny ho nechajú na chokepointSceneLabel,
    // dejiská BLÍZKEHO VÝCHODU podávajú theatreLabel — inak by pin hľadal
    // `chokepoint.<id>.name`, nenašiel a ukázal EN meno namiesto prekladu.
    const setScenePin = (scene, labelText = scene ? chokepointSceneLabel(scene) : '') => {
      scenePinDs.entities.removeAll();
      if (!scene?.center) return;
      scenePinDs.entities.add({
        position: Cesium.Cartesian3.fromDegrees(scene.center.lon, scene.center.lat),
        point: {
          pixelSize: 11,
          color: Cesium.Color.fromCssColorString('#ffb547'),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.65),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: labelText,
          font: '600 13px "IBM Plex Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString('#ffb547'),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.82),
          pixelOffset: new Cesium.Cartesian2(12, 0),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    };
    let ukraineEvents = null; // vrstva udalostí UKRAJINA (etapa 3) — vzniká nižšie, brána ju už pozná
    let ukmtoIncidents = null; // INCIDENTY LODÍ · UKMTO (BLÍZKY VÝCHOD etapa 5c) — vzniká nižšie, brána ju už pozná
    let kartaOverlay = null; // rám KARTA (K5) — vzniká nižšie; brána mu prepína viditeľnosť
    let activeFrontScene = null; // aktívny smer frontu (pre prehľadovú mapku a názov snímky)
    let activeChokepoint = null; // aktívna úžina (pre export kartičky konfliktu)
    let activeTheatre = null; // aktívne dejisko BLÍZKEHO VÝCHODU (2026-09-26) — tri premenné sú vzájomne výlučné
    // Režim mapy (2026-09-24, „prehľadnosť ako špičkové portály"): kým je kamera
    // pri scéne frontu/úžiny, dekoratívny HUD sa skryje a dok zosvetlí (style.css
    // `body.oko-map-focus`); pri pohľade na planétu sa všetko vráti.
    const setMapFocus = (on) => { try { document.body.classList.toggle('oko-map-focus', Boolean(on)); } catch { /* */ } };
    // Pri každej zmene scény (aj keď brána neprepne — napr. úžina → situácia „Perzský záliv").
    const syncMapFocus = () => setMapFocus(revealGate.isRevealed() && Boolean(activeFrontScene || activeChokepoint || activeTheatre));
    const revealGate = createSceneRevealGate({
      viewer,
      onChange: (visible) => {
        setMapFocus(visible && Boolean(activeFrontScene || activeChokepoint || activeTheatre));
        incidentCards.setRevealed(visible);
        ukraineEvents?.setRevealed(visible);
        kartaOverlay?.setRevealed(visible);
        // KONTROLA SÍDIEL Blízkeho východu: pri pohľade na planétu sa body aj raster schovajú, čip ostáva.
        if (visible) void mideastControl.show(); else mideastControl.hide();
        // INCIDENTY LODÍ (UKMTO): body len pri pohľade na scénu, čip ostáva.
        if (visible) void ukmtoIncidents?.show(); else void ukmtoIncidents?.hide();
        scenePinDs.show = visible;
        viewer.scene?.requestRender?.();
      },
    });
    window.__godsEyeView.sceneRevealGate = revealGate;
    // Mierka v km — len v režime mapy.
    const mapScaleBar = createMapScaleBar({ viewer, lang: () => currentLanguage() });
    window.__godsEyeView.mapScaleBar = mapScaleBar;
    // Country borders (Natural Earth, public domain): political context drawn on
    // the globe with a chokepoint/strike reveal — a standalone overlay, on with
    // any scene, off outside one.
    const countryBoundaries = createCountryBoundaries({ viewer });
    window.__godsEyeView.countryBoundaries = countryBoundaries;
    // Hranice s potrubiami (2026-09-19, používateľ: „hranice si vyhodil"):
    // rúry sú cezhraničná infraštruktúra a bez hraníc nemá „kam tečie" na
    // karte kontext. Vrstva si hranice drží, kým je zapnutá; scéna úžiny je
    // druhý, nezávislý držiteľ — koniec scény hranice vrstve nezoberie.
    const syncBoundariesWithPipelines = (enabled) => {
      if (enabled) void countryBoundaries.retain('gas-pipelines');
      else countryBoundaries.release('gas-pipelines');
    };
    dataManager.subscribe((change) => {
      if (change?.type === 'visibility' && change.layerId === 'gas-pipelines') syncBoundariesWithPipelines(Boolean(change.enabled));
    });
    syncBoundariesWithPipelines(dataManager.isEnabled('gas-pipelines'));
    // BLÍZKY VÝCHOD (2026-09-26, etapa 1; plán docs/drafts/blizky-vychod-plan.md):
    // panel v zóne KONFLIKTY pohltil bývalý panel ZÁLIV (jeho markup zanikol). Telo
    // panela kreslí src/mideastPanel.js — stav, zoznam dejísk a miesto pre správy.
    // Klik na dejisko volá runMideastTheatre, ktoré vzniká až nižšie; volá sa len
    // za behu (po dokončení init), preto šípka a nie priamy odkaz.
    //
    // KONTROLA SÍDIEL (2026-09-26, etapa 2; src/mideastControlLayer.js): správca drží
    // jednu parametrizovanú vrstvu na modul Wikipédie (IP, Jemen, Sýria, Libanon) a
    // vytvára ju lenivo až pri dejisku, ktoré modul žiada (`scene.control`). Vzniká
    // PRED panelom, lebo panel z neho kreslí čip a legendu po moduloch. Rovnako ako
    // vrstvy UKRAJINY je to samostatný prekryv (tokeny odkazu sú plné) a ZÁMERNE
    // nejde do ukraineBase.setSideResolver — iný modul, iná legenda, iné strany.
    const mideastControl = createMideastControl({ viewer });
    window.__godsEyeView.mideastControl = mideastControl;
    // KARTA: na kartografickom podklade mäkší raster bez bodov, inde predvolený —
    // ten istý vzor ako applyUkraineZoneStyle nižšie.
    const applyMideastControlStyle = (stack) => mideastControl.setStyle(stack?.kind === 'hillshade' ? 'karta' : 'default');
    applyMideastControlStyle(getActiveMapStack());
    onActiveMapStackChange(applyMideastControlStyle);
    // VZDUŠNÝ PRIESTOR · EASA (2026-10-03, etapa 5b; src/airspaceAdvisoryLayer.js): bulletiny
    // EASA o konfliktných zónach na hraniciach FIR. Čip v paneli ju zapína; dáta sa stiahnu
    // až pri prvom zapnutí. Nie je viazaná na bránu priblíženia dejiska — zóny majú veľkosť
    // štátov a pohľad z diaľky je práve ten užitočný.
    const airspaceAdvisory = createAirspaceAdvisory({ viewer });
    window.__godsEyeView.airspaceAdvisory = airspaceAdvisory;
    // INCIDENTY LODÍ · UKMTO (2026-10-03, etapa 5c; src/ukmtoIncidentsLayer.js): varovania UKMTO
    // ako body. Čip je predvolene zapnutý, no vrstva sťahuje a kreslí až pri dejisku BLÍZKEHO
    // VÝCHODU alebo úžine v oblasti hlásení UKMTO (setActive nižšie) a schováva sa s bránou.
    ukmtoIncidents = createUkmtoIncidents({ viewer });
    window.__godsEyeView.ukmtoIncidents = ukmtoIncidents;
    // RUŠENIE GPS · odvodené (2026-10-03, etapa 5d; src/gpsInterferenceLayer.js): bunky 0,5° podľa
    // podielu lietadiel so zhoršenou presnosťou polohy (zber servera z adsb.lol). Predvolene
    // vypnuté, sťahuje až po zapnutí čipu; bez väzby na dejisko (regionálna mapa ako EASA).
    const gpsInterference = createGpsInterference({ viewer });
    window.__godsEyeView.gpsInterference = gpsInterference;
    const mideastPanel = createMideastPanel({
      mountTarget: document.querySelector('#mideast-panel [data-mideast-body]'),
      theatres: listMideastTheatres(),
      applyTheatre: (id) => runMideastTheatre(id),
      control: mideastControl,
      airspace: airspaceAdvisory,
      ukmto: ukmtoIncidents,
      gps: gpsInterference,
    });
    window.__godsEyeView.mideastPanel = mideastPanel;
    // Situation from open sources: the merged bulletin (2026-09-18) now fills the
    // news slot of the BLÍZKY VÝCHOD panel. It used to be a SECOND floating panel
    // with its own tab, anchored bottom-right at z120, which covered the whole
    // right-hand rail whenever it was open and duplicated the same agenda the
    // ZÁLIV panel already showed. Merging removed both problems; chips switch
    // between the whole Middle East, the narrow Gulf feed and (etapa 3,
    // 2026-09-26) one feed per theatre — picking a theatre flips the chip. The mount
    // is INSIDE the panel, so the bulletin finds its owner via
    // closest('[data-panel-id]') and fetches lazily on the first expand.
    //
    // Deliberately NO viewer and NO card layer: the map-anchored hot cards stay
    // owned by the reveal gate above, which shows them by camera distance. A
    // panel must not force them visible while the camera is out at the planet,
    // and creating a second layer here is what used to run two .oko-hotcards
    // postRender passes that knew nothing about each other.
    const conflictBulletin = mideastPanel.newsMount
      ? createConflictBulletin({ mountTarget: mideastPanel.newsMount, region: 'mideast', regions: MIDEAST_BULLETIN_REGIONS })
      : null;
    window.__godsEyeView.conflictBulletin = conflictBulletin;
    // PRECHODY ÚŽINAMI (BLÍZKY VÝCHOD, etapa 5a, 2026-09-26): IMF PortWatch — Hormuz,
    // Báb al-Mandab, Suez, Mys dobrej nádeje. Karta sťahuje až pri prvom rozbalení
    // panela (/api/mideast/events/portwatch, archív servera), zvýrazní úžinu dejiska
    // alebo scény úžiny. Odhady MMF z AIS, predbežné — karta to hovorí sama.
    const portwatchCard = mideastPanel.transitsMount
      ? createPortwatchCard({ mountTarget: mideastPanel.transitsMount })
      : null;
    window.__godsEyeView.portwatchCard = portwatchCard;
    // UKRAJINA (2026-09-19, etapa 1; plán docs/drafts/ukrajina-plan.md): podklad
    // frontu — sídla, cesty, rieky, oblasti zo statického OSM snímku — ako
    // SAMOSTATNÝ prekryv (tokeny odkazu sú plné, správca odmietne vrstvu bez
    // tokenu, rovnako ako hranice štátov). Zapína ho panel UKRAJINA v lište
    // DÁTA a presety smerov frontu (`?front=lyman`, výber v paneli SCÉNY,
    // window API). Hranice štátov si podklad drží ako držiteľ 'ukraine-base'.
    const ukraineBase = createUkraineBaseLayer({ viewer });
    // KARTA (2026-09-20, „chcel som jemnejšie línie"): na kartografickom podklade
    // podklad UKRAJINA kreslí polovičné čiary a menšie body/popisy; inde pôvodné.
    const applyUkraineBaseStyle = (stack) => ukraineBase.setStyle(stack?.kind === 'hillshade' ? 'karta' : 'default');
    applyUkraineBaseStyle(getActiveMapStack());
    onActiveMapStackChange(applyUkraineBaseStyle);
    window.__godsEyeView.ukraineBase = ukraineBase;
    // Strety (etapa 2): značky smerov s počtom útokov z denného hlásenia GŠ ZSU
    // (ArmyInform, CC BY 4.0) — vlastný prekryv, ide hore a dole s podkladom;
    // čip STRETY v paneli je jeho vypínač.
    // Sídla z odsekov hlásenia (2026-09-19): geokódujú sa v prehliadači indexom mien
    // z OSM podkladu (ODbL; nič odvodené sa neukladá).
    const ukraineReport = createUkraineReportLayer({
      viewer,
      placeIndex: () => ukraineBase.getPlaceIndex(),
      reservePlaces: (ids) => ukraineBase.setReservedPlaces(ids),
      // DeepState vzniká nižšie — volá sa až pri kreslení (lenivo).
      frontKm: (lon, lat, opts) => window.__godsEyeView.ukraineDeepState?.frontKm?.(lon, lat, opts) ?? null,
      frontDay: () => window.__godsEyeView.ukraineDeepState?.getState?.().day ?? null,
      // Šípky smerov útoku (KARTA, 2026-09-26): od dnešnej línie k sídlu z hlásenia.
      contactPoint: (lon, lat, opts) => window.__godsEyeView.ukraineDeepState?.nearestContactPoint?.(lon, lat, opts) ?? null,
      sideAt: (lon, lat) => window.__godsEyeView.ukraineDeepState?.sideAt?.(lon, lat) ?? null,
    });
    window.__godsEyeView.ukraineReport = ukraineReport;
    let ukraineBoundariesHeld = false;
    ukraineBase.onChange((state) => {
      if (state.shown && !ukraineBoundariesHeld) { ukraineBoundariesHeld = true; void countryBoundaries.retain('ukraine-base'); }
      if (!state.shown && ukraineBoundariesHeld) { ukraineBoundariesHeld = false; countryBoundaries.release('ukraine-base'); }
      if (state.shown && !ukraineReport.isShown()) void ukraineReport.show();
      if (!state.shown && ukraineReport.isShown()) ukraineReport.hide();
    });
    const frontSceneDeps = {
      showBase: () => ukraineBase.show(),
      // Front scéna upratuje mapu: ostatné vrstvy (po úžinách typicky lode,
      // prístavy, trasy a plynovody) vypne; vrstvy UKRAJINY nie sú v správcovi.
      listLayers: () => dataManager.getAll(),
      disableLayer: (id) => { dataManager.setEnabled(id, false); return true; },
      // Front sa číta ako mapa: z juhu na sever, strmšie než pri úžinách (−58°,
      // prehľad −70°); cieľ je Cartesian3 (Rectangle by pri streamujúcich 3D
      // dlaždiciach ticho neurobil nič — rovnaká pasca ako pri úžinách).
      flyToRegion: (scene) => {
        if (!viewer?.camera?.flyTo || !scene?.rectDegrees) return null;
        viewer.trackedEntity = undefined;
        // Smer sa otvára v KARTE (runFrontScene) → výrez zhora a bližšie ako mapa Rybar.
        const framing = frontSceneFraming(scene.rectDegrees, { overview: Boolean(scene.overview), karta: !scene.overview });
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(framing.lon, framing.lat, framing.heightM),
          orientation: { heading: Cesium.Math.toRadians(framing.headingDeg), pitch: Cesium.Math.toRadians(framing.pitchDeg), roll: 0 },
          duration: 3.0,
        });
        return null;
      },
    };
    // Etapa 3 (2026-09-19): udalosti (VIINA + GeoConfirmed + správy + fotky/videá)
    // ako body a karty na glóbuse + časová os v spodnom páse. Nahrádza hot
    // kartičky ZÁLIV-u pre región `ukraine` (tie ostávajú len pre ZÁLIV).
    ukraineEvents = createUkraineEventsLayer({ viewer });
    window.__godsEyeView.ukraineEvents = ukraineEvents;
    // Územná kontrola (etapa 4C): body sídiel z Wikipédie (CC BY-SA) + odvodené
    // zóny; snímka sleduje deň kurzora časovej osi.
    const ukraineControl = createUkraineControlLayer({ viewer });
    window.__godsEyeView.ukraineControl = ukraineControl;
    // Plochy OSM (KARTA K2): zástavba, lesy, voda, železnice po dlaždiciach —
    // ukazujú sa s podkladom UKRAJINA, len na glóbusových podkladoch a zblízka.
    const ukraineAreas = createUkraineAreasLayer({ viewer });
    window.__godsEyeView.ukraineAreas = ukraineAreas;
    let ukraineAreasWanted = false;
    ukraineBase.onChange((state) => {
      const want = Boolean(state?.shown);
      if (want === ukraineAreasWanted) return;
      ukraineAreasWanted = want;
      if (want) void ukraineAreas.show(); else ukraineAreas.hide();
    });
    if (ukraineBase.isShown()) { ukraineAreasWanted = true; void ukraineAreas.show(); }
    // DeepState (2026-09-19, hobby použitie, súhlas sa žiada): polygóny okupácie
    // a šedej zóny z nášho denného archívu; časová os prepína snímku podľa dňa.
    const ukraineDeepState = createUkraineDeepStateLayer({ viewer });
    window.__godsEyeView.ukraineDeepState = ukraineDeepState;
    // KARTA K3 (2026-09-20): špendlíky sídiel podľa strany (Wikipedia body do 3 km,
    // inak polygóny DeepState), mäkký raster KONTROLA a šrafovaná sivá zóna — len
    // v štýle karta; pri zmene dát sa špendlíky prefarbia.
    // 2026-09-26: keď je snímka Wikipédie zastaraná, rozhoduje dnešný DeepState (pickPlaceSide).
    ukraineBase.setSideResolver((lon, lat) => pickPlaceSide({ wiki: ukraineControl.sideAt(lon, lat), deepstate: ukraineDeepState.sideAt(lon, lat), wikiStale: Boolean(ukraineControl.getState?.()?.stale) }));
    ukraineControl.onChange(() => ukraineBase.refreshSides());
    ukraineDeepState.onChange(() => ukraineBase.refreshSides());
    // Značky smerov hlásenia GŠ stoja pri sídle najbližšom k línii podľa DeepState
    // (2026-09-24); nová snímka = prepočet kotiev.
    ukraineDeepState.onChange(() => ukraineReport.reanchor());
    const applyUkraineZoneStyle = (stack) => {
      const mode = stack?.kind === 'hillshade' ? 'karta' : 'default';
      ukraineControl.setStyle(mode);
      ukraineDeepState.setStyle(mode);
      ukraineReport.setStyle(mode); // KARTA K4: sídla z hlásenia GŠ = blesky intenzity
    };
    applyUkraineZoneStyle(getActiveMapStack());
    onActiveMapStackChange(applyUkraineZoneStyle);

    // Rám „hotovej mapy" KARTA (K5): titulok + legenda + prehľadová mapka; len na
    // podklade KARTA a pri priblížení (brána), „čistá karta" schová chróm, „Snímka"
    // zapečie rám do zdieľanej snímky.
    // Aktívny konflikt z aktuálnej scény (dejisko, úžina, potom smer frontu —
    // každý run wrapper nuluje ostatné dve premenné, takže naraz platí len jedna).
    function activeConflict() {
      if (activeTheatre) return conflictById(`mideast:${activeTheatre.id}`);
      if (activeChokepoint) return conflictById(`chokepoint:${activeChokepoint.id}`);
      if (activeFrontScene) return conflictById(`ukraine:${activeFrontScene.id}`);
      return null;
    }
    function conflictStateDate(whenMs = Date.now()) {
      const lang = currentLanguage();
      const locale = lang === 'en' ? 'en-GB' : 'sk-SK';
      let day;
      try { day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(whenMs)); }
      catch { day = new Date(whenMs).toISOString().slice(0, 10); }
      return t('ukraine.karta.state', { date: day });
    }
    // Export zdieľacej kartičky konfliktu (A aj B): Ukrajinu berie zo živého KARTA
    // prekryvu, ostatné z katalógu; aktuálny pohľad + rám v danom pomere → stiahne.
    async function exportConflict({ conflict = null, ratio = 'feed' } = {}) {
      const c = conflict || activeConflict();
      if (!c) { console.warn('[conflict] no active conflict to export'); return null; }
      try {
        let model;
        if (c.kind === 'ukraine-front' && kartaOverlay) {
          model = kartaOverlay.getModel();
        } else {
          let viewRect = null;
          try {
            const r = viewer.camera.computeViewRectangle();
            if (r) viewRect = [Cesium.Math.toDegrees(r.west), Cesium.Math.toDegrees(r.south), Cesium.Math.toDegrees(r.east), Cesium.Math.toDegrees(r.north)];
          } catch { /* mimo glóbusu */ }
          const facts = defaultConflictFacts(c, { translate: t });
          let dateText = conflictStateDate();
          if (c.kind === 'chokepoint' && c.scene) {
            const f = chokepointSceneFacts(c.scene, { lang: currentLanguage(), translate: t });
            const bits = [f?.narrowest, f?.carries].filter(Boolean);
            if (bits.length) dateText = bits.join(' · ');
            else if (f?.subtitle) dateText = f.subtitle;
          }
          model = conflictCardModel(c, { viewRect, dateText, sources: facts.sources, legend: facts.legend, legendHead: facts.legendHead, translate: t });
        }
        const creditsText = document.querySelector('#cesium-credits')?.textContent || '';
        const snap = await captureConflictCard({ viewer, model, ratio, lang: currentLanguage(), creditsText });
        if (!snap) return null;
        downloadCardSnapshot(snap, conflictCardFilename(c, ratio, new Date().toISOString()));
        return snap;
      } catch (error) { console.warn('[conflict] export failed:', error?.message || error); return null; }
    }
    // Zarámuj konflikt (panel B): Ukrajina na KARTE + smer, úžina jej scéna,
    // dejisko BLÍZKEHO VÝCHODU jeho preset, situácia ručný let; potom nechaj
    // ustáliť dlaždice pred zachytením.
    async function frameConflict(conflict) {
      if (!conflict) return;
      if (conflict.kind === 'ukraine-front') {
        try { void Promise.resolve(styleManager._setMapStack('karta')).catch(() => {}); } catch { /* */ }
        try { runFrontScene(conflict.sceneId); } catch { /* */ }
      } else if (conflict.kind === 'chokepoint') {
        try { runChokepointScene(conflict.sceneId); } catch { /* */ }
      } else if (conflict.kind === 'mideast-theatre') {
        // Dejisko má vlastný let (Cartesian3, rámovanie posledné); všeobecná vetva
        // nižšie letí na Rectangle, čo pri streamujúcich 3D dlaždiciach ticho nič nespraví.
        try { await runMideastTheatre(conflict.sceneId); } catch { /* */ }
      } else {
        activeChokepoint = null; activeFrontScene = null; activeTheatre = null;
        mideastPanel?.setActiveTheatre?.(null);
        void mideastControl.setTheatre(null);
        void ukmtoIncidents?.setActive(false);
        portwatchCard?.setActive?.(null);
        restoreAutoKarta();
        syncMapFocus();
        try {
          const [w, s, e, n] = conflict.rectDegrees;
          viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(w, s, e, n), duration: 1.8 });
        } catch { /* */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 3500));
    }
    kartaOverlay = createUkraineKartaOverlay({
      translate: t,
      lang: () => currentLanguage(),
      control: ukraineControl,
      deepstate: ukraineDeepState,
      report: ukraineReport,
      getViewRect: () => {
        try {
          const r = viewer.camera.computeViewRectangle();
          if (r) return [Cesium.Math.toDegrees(r.west), Cesium.Math.toDegrees(r.south), Cesium.Math.toDegrees(r.east), Cesium.Math.toDegrees(r.north)];
        } catch { /* mimo glóbusu */ }
        return activeFrontScene?.rectDegrees || null;
      },
      onExport: () => { void exportConflict({ ratio: 'feed' }); },
    });
    window.__godsEyeView.ukraineKartaOverlay = kartaOverlay;
    // Ostrovy rámu sú prekážky pruhov (ui.js *_STACK_OBSTACLE_SELECTOR): ľavý pruh
    // tečie pod titulkom, pravá lišta medzi náhľadom hore a legendou dole.
    // Vznikli až teraz — pozorovatelia z inicializácie ich nevideli.
    styleManager.observeLeftStackObstacle?.(kartaOverlay.elements?.title);
    styleManager.observeRightStackObstacle?.(kartaOverlay.elements?.tools);
    styleManager.observeRightStackObstacle?.(kartaOverlay.elements?.inset);
    styleManager.observeRightStackObstacle?.(kartaOverlay.elements?.legend);
    // Propagácia: export kartičiek naprieč konfliktmi (A: aktívna scéna; B: panel).
    window.__godsEyeView.conflicts = {
      list: () => listConflicts(),
      active: () => activeConflict(),
      ratios: CARD_RATIO_IDS,
      exportCard: (id, ratio = 'feed') => exportConflict({ conflict: id ? conflictById(id) : null, ratio }),
    };
    // Panel „Kartičky konfliktov" (B): zoznam po regiónoch, pomer, export po jednom aj dávkou.
    const conflictsPanel = createConflictsPanel({
      translate: t,
      conflicts: listConflicts().map((c) => ({ id: c.id, region: c.region, kind: c.kind, label: conflictTitle(c, t) })),
      ratios: CARD_RATIO_IDS,
      // Domov v riadku nadpisu zóny KONFLIKTY (2026-09-27): akcia nad celou zónou, nie panel —
      // samostatná pilulka pod Blízkym východom vyzerala ako panel a v tesnom stĺpci ležala cez
      // nadpis ENERGIA (vlastník: „aj toto treba zmysluplne poupratať a logicky").
      launchTarget: document.querySelector('#left-panel-stack > .lane-zone[data-lane-zone="conflicts"]')
        || document.getElementById('left-panel-stack'),
      launchLabel: t('conflicts.launch.short'),
      launchIcon: 'ios_share',
      launchHint: `${t('conflicts.launch')} — ${t('conflicts.subtitle')}`,
      onExport: async (item, ratio) => {
        const c = conflictById(item.id);
        if (!c) return;
        await frameConflict(c);
        await exportConflict({ conflict: c, ratio });
      },
      onDigest: async () => {
        try {
          const lang = currentLanguage();
          let today;
          try { today = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date()); }
          catch { today = new Date().toISOString().slice(0, 10); }
          const [rep, oil, gulf] = await Promise.allSettled([fetchUkraineReport(), fetchOilPrices(), fetchSituationNews('gulf')]);
          const report = rep.status === 'fulfilled' ? rep.value : null;
          const oilModel = oil.status === 'fulfilled' ? buildOilModel(oil.value, { lang, translate: t }) : null;
          const gulfCount = gulf.status === 'fulfilled' ? buildSituationModel(gulf.value, { translate: t, limit: 200 }).count : null;
          return buildConflictDigest({ report, oilModel, gulfCount, translate: t, dateText: report?.reportedAtText || today }).text;
        } catch (error) { console.warn('[conflict] digest failed:', error?.message || error); return null; }
      },
    });
    window.__godsEyeView.conflictsPanel = conflictsPanel;

    // Hľadať čokoľvek (orientácia v OKU): jedno pole nájde miesto, konflikt,
    // vrstvu aj akciu — ľudské názvy, bez odborných výrazov. Klávesa „/" alebo
    // tlačidlo lupy v hornej lište. Zoznam sa skladá nanovo pri každom otvorení.
    // Konflikty sú roztriedené podľa regiónu (Ukrajina / Úžiny a moria / Blízky
    // východ), vrstvy podľa ľudských tém (Vo vzduchu, Na mori, Zem a počasie…) —
    // aby sa dal celok listovať prehľadne, nie ako jeden dlhý zoznam.
    const CONFLICT_GROUP = { ukraine: 'ukraine', maritime: 'maritime', 'middle-east': 'mideast' };
    // Sledované lety (2026-09-27, vlastník: „sledovanie letov, ale len pre prihlásených … pre
    // neprihlásených ich presmeruj na prihlásenie"): tlačidlo SLEDOVAŤ nad KOKPIT, zoznam k účtu,
    // navrchu v hľadaní, toast pri vzlete/pristátí. Bez účtu (panel nenaštartoval) sa nič nepridá.
    let followedFlights = null;
    try {
      if (accountCenter) {
        followedFlights = createFollowedFlights({
          account: accountCenter,
          translate: t,
          notify: (text) => styleManager._showToast(text, { durationMs: 4500 }),
          findContacts: (identity) => flightsLayer.findContactsByIdentity?.(identity) || [],
          trackContact: (hex) => flightsLayer.trackById?.(hex, { origin: 'user' }) === true,
        });
        const followButton = installFollowButton({
          doc: document,
          followed: followedFlights,
          getTracked: () => flightsLayer.getTrackedInfo?.() || null,
          translate: t,
        });
        viewer.trackedEntityChanged?.addEventListener?.(() => followButton.sync());
        setInterval(() => followButton.sync(), 1500);
        window.__godsEyeView.followedFlights = followedFlights;
      }
    } catch (error) { console.warn('[follow] followed flights unavailable:', error?.message || error); }
    const buildCommands = () => {
      const cmds = [];
      try { cmds.push(...(followedFlights?.commands() || [])); } catch { /* sledované lety sú voliteľné */ }
      for (const c of listConflicts()) {
        cmds.push({ id: `scene:${c.id}`, label: conflictTitle(c, t), group: CONFLICT_GROUP[c.region] || 'ukraine', keywords: [c.region, c.name, c.sceneId || ''], run: () => { void frameConflict(c); } });
      }
      let layers = [];
      try { layers = dataManager.getAll() || []; } catch { layers = []; }
      for (const layer of layers) {
        if (!isCatalogLayer(layer)) continue;
        const id = layer.id;
        const on = (() => { try { return dataManager.isEnabled(id); } catch { return false; } })();
        cmds.push({
          id: `layer:${id}`,
          label: layerDisplayName(layer),
          hint: t(on ? 'cmd.toggle.off' : 'cmd.toggle.on'),
          group: layerGroup(id),
          keywords: [id, ...layerKeywords(id)],
          run: () => { try { dataManager.setEnabled(id, !dataManager.isEnabled(id), { origin: 'user' }); } catch { /* */ } },
        });
      }
      // Úvodný pohľad ako tlačidlo s glóbusom hore (camera.js HOME_VIEW) — prvý riadok prázdneho hľadania.
      cmds.push({ id: 'view:home', label: t('cmd.action.home'), hint: t('cmd.action.home.hint'), group: 'view', keywords: ['domov', 'home', 'bratislava', 'úvod', 'start'], run: () => { void styleManager.resetToGlobeView({ home: true }); } });
      cmds.push({ id: 'view:world', label: t('cmd.action.world'), hint: t('cmd.action.world.hint'), group: 'view', keywords: ['reset', 'svet', 'world', 'globe'], run: () => { try { flyToGlobeView(viewer); } catch { /* */ } } });
      cmds.push({ id: 'view:karta', label: t('cmd.action.karta'), group: 'view', keywords: ['karta', 'front', 'mapa'], run: () => { void styleManager._setMapStack('karta'); } });
      cmds.push({ id: 'view:osm', label: t('cmd.action.osm'), group: 'view', keywords: ['osm', 'mapa', 'plain'], run: () => { void styleManager._setMapStack('osm'); } });
      cmds.push({ id: 'view:photoreal', label: t('cmd.action.photoreal'), group: 'view', keywords: ['3d', 'foto', 'google', 'photoreal'], run: () => { void styleManager._setMapStack('photoreal'); } });
      cmds.push({ id: 'view:clean', label: t('cmd.action.clean'), group: 'view', keywords: ['čistá', 'clean', 'screenshot'], run: () => { kartaOverlay?.setClean(!kartaOverlay.isClean()); } });
      cmds.push({ id: 'view:conflicts', label: t('cmd.action.conflicts'), group: 'view', keywords: ['kartičky', 'export', 'cards'], run: () => { conflictsPanel?.open(); } });
      return cmds;
    };
    // Jednotné hľadanie lietadla (2026-10-04): živé lietadlá z pamäte + celý svet zo servera.
    const aircraftSearch = createAircraftSearchCommands({
      flights: flightsLayer, military: militaryFlightsLayer, dataManager, viewer, Cesium, translate: t,
      notify: (text) => styleManager._showToast(text, { durationMs: 4500 }),
    });
    const commandPalette = createCommandPalette({
      translate: t,
      getCommands: buildCommands,
      getQueryCommands: (q) => aircraftSearch.queryCommands(q),
      getAsyncResults: (q) => aircraftSearch.asyncResults(q),
      asyncGroup: 'aircraft-world',
      // Poradie (2026-09-27, vlastník o lupe: „toto tlačidlo patrí Ukrajine" — prázdne hľadanie
      // začínalo 12 smermi frontu): zobrazenie → vrstvy (podľa témy) → konflikty (podľa regiónu).
      // Sledované lety prihláseného (09-27) úplne navrchu — sú to jeho vlastné položky.
      // Lietadlá (živé, potom celý svet) idú hneď za sledované lety — to je to, čo človek píše najčastejšie.
      groupOrder: ['follows', 'aircraft', 'aircraft-world', 'view', ...LAYER_GROUP_ORDER, 'ukraine', 'maritime', 'mideast'],
      onGeocode: (q) => { try { void searchAndFlyTo(viewer, q); } catch { /* */ } },
    });
    window.__godsEyeView.commandPalette = commandPalette;
    // Bezplatný hlas (2026-10-05): rovnaké zdroje ako jednotné hľadanie — lietadlá, paleta, miesto na mape.
    try {
      window.__godsEyeView.voiceCommands?.freeVoice?.setResolvers({
        commands: buildCommands,
        aircraft: (q) => aircraftSearch.queryCommands(q),
        aircraftWorld: (q) => aircraftSearch.asyncResults(q),
        trackedInfo: () => flightsLayer.getTrackedInfo?.() || militaryFlightsLayer.getTrackedInfo?.() || null,
        // Vráti nájdený názov (odpoveď „Letím: Košice"), alebo false.
        geocode: async (q) => { const found = await searchAndFlyTo(viewer, q); return found && !found.cancelled ? (found.label || q) : false; },
      });
    } catch { /* hlas je voliteľný */ }
    try {
      const cmdLaunch = document.createElement('button');
      cmdLaunch.type = 'button';
      cmdLaunch.id = 'cmd-launch';
      cmdLaunch.setAttribute('aria-label', t('cmd.launch'));
      cmdLaunch.title = t('cmd.launch');
      cmdLaunch.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">search</span>';
      cmdLaunch.addEventListener('click', () => commandPalette.toggle());
      document.getElementById('top-center-actions')?.appendChild(cmdLaunch);
    } catch { /* lišta akcií nemusí existovať */ }
    kartaOverlay.setStack(getActiveMapStack());
    onActiveMapStackChange((stack) => kartaOverlay.setStack(stack));
    viewer.camera?.moveEnd?.addEventListener?.(() => { if (kartaOverlay.isVisible()) kartaOverlay.update(); });
    // Škody na budovách (etapa 5): statické, zapína sa čipom ŠKODY (nie so smerom —
    // 18 000 bodov UNOSAT nech si používateľ pridá sám).
    const ukraineDamage = createUkraineDamageLayer({ viewer });
    window.__godsEyeView.ukraineDamage = ukraineDamage;
    // Poplachy (2026-09-26): oblasti ohrozené podľa hlásení Vzdušných síl — dáta
    // dodáva os (hlásenia okna + čas kurzora), zapína sa čipom POPLACHY.
    const ukraineAlerts = createUkraineAlertAreasLayer({ viewer });
    window.__godsEyeView.ukraineAlerts = ukraineAlerts;
    const ukraineTimeline = createUkraineTimeline({ layer: ukraineEvents, report: ukraineReport, control: ukraineControl, deepstate: ukraineDeepState, damage: ukraineDamage, alerts: ukraineAlerts });
    window.__godsEyeView.ukraineTimeline = ukraineTimeline;
    // Os vzniká až teraz a štartuje skrytá — ľavý stĺpec ju pri štarte nevidel
    // a na zmenu jej výšky (zobrazenie, zbalenie legendy) nereagoval.
    styleManager.observeLeftStackObstacle?.(ukraineTimeline.element);
    let ukrainePanel = null;
    // Front sa otvára v KARTE (2026-09-26, vlastník so vzorkou mapy Rybar: „ja som to
    // chcel takto" → „Áno, front vždy v KARTE"). Predchádzajúci podklad sa pamätá
    // a vráti sa pri odchode zo smeru (úžina, iný konflikt, zatvorená os) — ak si
    // medzitým používateľ podklad nezmenil sám.
    let autoKartaPrev = null;
    const restoreAutoKarta = () => {
      const prev = autoKartaPrev; autoKartaPrev = null;
      if (prev && mapStackController.getActiveId() === 'karta') { try { void Promise.resolve(styleManager._setMapStack(prev)).catch(() => {}); } catch { /* */ } }
    };
    onActiveMapStackChange((stack) => { if (stack?.id !== 'karta') autoKartaPrev = null; });
    // Zatvorená časová os = odchod zo smeru.
    ukraineTimeline.onChange((st) => { if (!st?.shown && autoKartaPrev) restoreAutoKarta(); });
    const runFrontScene = (id) => {
      const scene = frontSceneById(id);
      if (scene) trackEvent('scene_open', { scene_type: 'front', scene_id: String(id) });
      if (scene && mapStackController.getActiveId() !== 'karta') {
        autoKartaPrev = mapStackController.getActiveId();
        try { void Promise.resolve(styleManager._setMapStack('karta')).catch(() => {}); } catch { /* */ }
      }
      activeFrontScene = scene || null;
      activeChokepoint = null;
      activeTheatre = null;
      mideastPanel?.setActiveTheatre?.(null);
      void mideastControl.setTheatre(null); // odchod z dejiska schová jeho kontrolu sídiel
      void ukmtoIncidents?.setActive(false);
      portwatchCard?.setActive?.(null);
      kartaOverlay?.setScene(scene || null);
      ukrainePanel?.setActiveScene(scene?.id || null);
      ukraineTimeline.setActiveScene(scene?.id || null);
      if (scene) {
        // Brána priblíženia ako pri úžinách: pri pohľade na planétu sa karty
        // a body schovajú; časová os sa otvorí so smerom.
        revealGate.activate(scene.center);
        incidentCards.clear();
        ukraineTimeline.show();
        void ukraineTimeline.showControl();
        void ukraineTimeline.showDeepState();
      }
      syncMapFocus();
      return applyFrontScene(id, frontSceneDeps);
    };
    // Karta smeru (B5): trend útokov z archívu hlásení GŠ + najčastejšie sídla;
    // klik na sídlo = kamera nad neho (z juhu, ako front scéna).
    const ukraineDirectionCard = createUkraineDirectionCard({
      loadDirections: ukraineTimeline.store?.directions ? (from, to) => ukraineTimeline.store.directions(from, to) : null,
      placeIndex: () => ukraineBase.getPlaceIndex(),
      onPlace: ({ lat, lon }) => {
        if (!viewer?.camera?.flyToBoundingSphere || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
        viewer.trackedEntity = undefined;
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, 0), 1), {
          offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-58), 22_000),
          duration: 2.0,
        });
      },
    });
    window.__godsEyeView.ukraineDirectionCard = ukraineDirectionCard;
    ukrainePanel = createUkrainePanel({
      mountTarget: document.querySelector('#ukraine-panel [data-ukraine-body]'),
      layer: ukraineBase,
      report: ukraineReport,
      timeline: ukraineTimeline,
      control: ukraineControl,
      deepstate: ukraineDeepState,
      areas: ukraineAreas,
      damage: ukraineDamage,
      alerts: ukraineAlerts,
      directionCard: ukraineDirectionCard,
      applyScene: (id) => runFrontScene(id),
    });
    window.__godsEyeView.ukrainePanel = ukrainePanel;
    // Správy z otvorených zdrojov pre región `ukraine` (etapa 2): ten istý
    // bulletin ako ZÁLIV, jediný región (bez čipov), lenivo pri rozbalení panela.
    if (ukrainePanel.newsMount) {
      const ukraineBulletin = createConflictBulletin({
        mountTarget: ukrainePanel.newsMount,
        region: 'ukraine',
        regions: [{ id: 'ukraine', labelKey: 'ukraine.news.title' }],
      });
      window.__godsEyeView.ukraineBulletin = ukraineBulletin;
    }
    window.__godsEyeView.frontScenes = { list: listFrontScenes, apply: runFrontScene };
    // Zdieľateľný odkaz `?front=<smer>` (napr. okolive.sk/?front=lyman) —
    // po obnove stavu, aby scéna vyhrala nad predvoleným pohľadom ako klik.
    try {
      const requestedFront = new URLSearchParams(window.location?.search || '').get('front');
      if (requestedFront && frontSceneById(requestedFront)) {
        // `&t=<ISO>&win=<24h|7d|30d|all>` (etapa 3c): odkaz na okamih časovej osi.
        const shared = parseShareParams(window.location?.search || '');
        void Promise.resolve(styleManager.initialRestorePromise)
          .catch(() => {})
          .then(() => runFrontScene(requestedFront))
          .then(() => {
            if (!shared) return;
            if (shared.windowId) ukraineTimeline.clock.setWindow(shared.windowId);
            if (Number.isFinite(shared.cursor)) ukraineTimeline.clock.setCursor(shared.cursor);
          });
      }
    } catch { /* zlý parameter nikdy nezhodí štart */ }
    // Výber v paneli SCÉNY (na dotyku záložka SCENES), rovnaký vzor ako úžiny.
    try {
      const frontPicker = document.getElementById('front-select');
      if (frontPicker) {
        for (const scene of listFrontScenes()) {
          const option = document.createElement('option');
          option.value = scene.id;
          option.textContent = frontSceneLabel(scene);
          frontPicker.appendChild(option);
        }
        frontPicker.addEventListener('change', () => {
          const id = frontPicker.value;
          frontPicker.value = '';
          if (id) void runFrontScene(id);
        });
      }
    } catch { /* výber je voliteľné chróm */ }
    const runChokepointScene = (id) => {
      restoreAutoKarta();
      const scene = chokepointSceneById(id);
      if (scene) trackEvent('scene_open', { scene_type: 'chokepoint', scene_id: String(id) });
      activeChokepoint = scene || null;
      activeFrontScene = null;
      activeTheatre = null;
      mideastPanel?.setActiveTheatre?.(null);
      void mideastControl.setTheatre(null); // odchod z dejiska schová jeho kontrolu sídiel
      // Scéna úžiny s údajmi PortWatch (hormuz, bab-el-mandeb, suez) zvýrazní svoj riadok karty.
      portwatchCard?.setActive?.(PORTWATCH_KEYS.includes(scene?.id) ? scene.id : null);
      // Varovania UKMTO pri úžinách v jeho oblasti hlásení (Hormuz, Báb al-Mandab, Suez); inde nie.
      void ukmtoIncidents?.setActive(UKMTO_CHOKEPOINT_SCENES.includes(scene?.id));
      const result = applyChokepointScene(id, chokepointSceneDeps);
      syncMapFocus();
      void oilPriceChip.refreshAndShow();
      if (scene) {
        straitTrafficChip.showFor({
          rect: scene.rectDegrees,
          label: chokepointSceneLabel(scene),
          facts: chokepointSceneFacts(scene, { lang: currentLanguage(), translate: t }),
        });
        // Gate all scene overlays — pin, cards, chips — by camera distance to this
        // strait's centre. The gated pin is drawn in its own datasource.
        setScenePin(scene);
        revealGate.activate(scene.center);
        void countryBoundaries.show(); // political borders under the reveal
        if (scene.newsRegion) void incidentCards.showFor(scene.newsRegion);
        else incidentCards.clear();
      }
      return result;
    };
    window.__godsEyeView.chokepointScenes = {
      list: listChokepointScenes,
      apply: runChokepointScene,
    };
    // Shareable deep link `?chokepoint=<id>` (e.g. okolive.sk/?chokepoint=hormuz).
    // Apply AFTER camera/layer restore settles so the scene wins over the
    // default/local layer state, the way an explicit click would.
    try {
      const requested = new URLSearchParams(window.location?.search || '').get('chokepoint');
      if (requested && chokepointSceneById(requested)) {
        void Promise.resolve(styleManager.initialRestorePromise)
          .catch(() => {})
          .then(() => runChokepointScene(requested));
      }
    } catch { /* URL parsing is best-effort — a bad param never breaks boot */ }

    // In-app trigger: the SCENES panel (bottom-bar "SCENES" tab on touch) carries
    // a chokepoint dropdown. Options are built here so their labels follow i18n;
    // picking one applies the scene, then the control resets to its placeholder so
    // the same strait can be re-picked to re-centre.
    try {
      const picker = document.getElementById('chokepoint-select');
      if (picker) {
        for (const scene of listChokepointScenes()) {
          const option = document.createElement('option');
          option.value = scene.id;
          option.textContent = chokepointSceneLabel(scene);
          picker.appendChild(option);
        }
        picker.addEventListener('change', () => {
          const id = picker.value;
          picker.value = '';
          if (id) void runChokepointScene(id);
        });
      }
    } catch { /* the picker is optional chrome — its absence never breaks boot */ }

    // BLÍZKY VÝCHOD — dejiská (2026-09-26, etapa 1; src/data/mideastTheatres.js).
    // Rovnaká kostra ako smery frontu a úžiny: stav → panel → brána priblíženia →
    // pin → hranice → hot karty → apply (vrstvy, rámovanie POSLEDNÉ). Dejisko
    // upratuje mapu ako front (cudzie vrstvy správcu vypne) a zapne vlastné
    // `layerIds` s origin 'user', takže sa uložia do stavu/odkazu ako klik na
    // riadky vrstiev. Nič tu nie je línia frontu ani poloha jednotiek — len rámec
    // pohľadu, vrstvy, ktoré už ukazujeme poctivo, a správy z otvorených zdrojov.
    const theatreDeps = {
      listLayers: () => dataManager.getAll(),
      disableLayer: (id) => { dataManager.setEnabled(id, false); return true; },
      setLayerEnabled: (layerId) => dataManager.setEnabled(layerId, true, { origin: 'user' }),
      // Cieľ je Cartesian3 + orientácia (Rectangle by pri streamujúcich 3D
      // dlaždiciach ticho neurobil nič — rovnaká pasca ako pri úžinách a fronte);
      // výšku aj odstup na juh stráži theatreFraming, aby kamera ostala pod
      // prahom brány (1 500 000 m ku stredu dejiska) aj pri prehľade regiónu.
      flyToRegion: (scene) => {
        if (!viewer?.camera?.flyTo || !scene?.rectDegrees) return null;
        viewer.trackedEntity = undefined;
        const framing = theatreFraming(scene.rectDegrees, { overview: Boolean(scene.overview) });
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(framing.lon, framing.lat, framing.heightM),
          orientation: { heading: Cesium.Math.toRadians(framing.headingDeg), pitch: Cesium.Math.toRadians(framing.pitchDeg), roll: 0 },
          duration: 3.0,
        });
        return null;
      },
    };
    const runMideastTheatre = (id) => {
      restoreAutoKarta(); // odchod z KARTY frontu, rovnako ako pri úžinách
      const scene = theatreById(id);
      if (scene) trackEvent('scene_open', { scene_type: 'mideast', scene_id: String(id) });
      activeTheatre = scene || null;
      activeFrontScene = null;
      activeChokepoint = null;
      kartaOverlay?.setScene?.(null);
      ukrainePanel?.setActiveScene?.(null);
      ukraineTimeline.setActiveScene(null);
      mideastPanel?.setActiveTheatre?.(scene?.id || null);
      portwatchCard?.setActive?.(portwatchKeyForTheatre(scene?.id)); // Hormuz/Záliv → Hormuz, Jemen/Červené more → Báb al-Mandab
      // KONTROLA SÍDIEL (etapa 2): správca prepne moduly Wikipédie podľa `scene.control`
      // a raster zón prepočíta v rámci dejiska (+0,2°), nie nad celým modulom; bez
      // dejiska (null) vrstvy schová. Pred rámovaním, aby sa body natiahli počas letu.
      void mideastControl.setTheatre(scene || null);
      // INCIDENTY LODÍ (etapa 5c): pri každom dejisku — body mimo záberu nič nestoja.
      void ukmtoIncidents?.setActive(Boolean(scene));
      // Čip „premávka v úžine" patrí poslednej úžine a ďalej by pollval jej rámec;
      // brána presunutá na dejisko by ho po prílete znova odkryla (nález 2026-09-26).
      straitTrafficChip.hide();
      if (scene) {
        // Brána priblíženia: pin, čipy aj karty len pri pohľade na dejisko;
        // pri pohľade na planétu sa všetko schová (rovnako ako úžiny a front).
        revealGate.activate(scene.center);
        setScenePin(scene, theatreLabel(scene));
        // Hranice štátov ako držiteľ (plán kap. 6, etapa 1). Udalosť „koniec
        // scény" dnes neexistuje, takže držiteľa nikto neuvoľní — hranice ostanú
        // ako po úžine (tá volá jednorazové show()).
        void countryBoundaries.retain('mideast-theatre');
        // Hot karty (hlásené · neoverené) pre región správ dejiska; bez regiónu
        // sa staré karty zmažú. Bulletin v paneli prepne ten istý región (plán
        // etapa 1: „čipy podľa dejiska"; setRegion neznámy región ignoruje).
        if (scene.newsRegion) void incidentCards.showFor(scene.newsRegion);
        else incidentCards.clear();
        conflictBulletin?.setRegion?.(scene.newsRegion);
      }
      syncMapFocus();
      return applyMideastTheatre(id, theatreDeps);
    };
    window.__godsEyeView.mideastTheatres = { list: listMideastTheatres, apply: runMideastTheatre };
    // Zdieľateľný odkaz `?mideast=<dejisko>` (napr. okolive.sk/?mideast=gaza):
    // po obnove stavu ako `?front=`, aby scéna vyhrala nad predvoleným pohľadom.
    // Ak URL nesie aj PLATNÝ `?front=` alebo `?chokepoint=`, dejisko ustúpi — inak
    // by vyhrala náhoda poradia registrácie. Neplatná konkurenčná hodnota (preklep)
    // dejisko neblokuje. Id sa overí PRED čakaním.
    try {
      const params = new URLSearchParams(window.location?.search || '');
      const requestedTheatre = params.get('mideast');
      const otherSceneRequested = Boolean(frontSceneById(params.get('front') || '') || chokepointSceneById(params.get('chokepoint') || ''));
      if (requestedTheatre && !otherSceneRequested && theatreById(requestedTheatre)) {
        void Promise.resolve(styleManager.initialRestorePromise)
          .catch(() => {})
          .then(() => runMideastTheatre(requestedTheatre));
      }
    } catch { /* zlý parameter nikdy nezhodí štart */ }
    // Výber v paneli SCÉNY (na dotyku záložka SCENES): popisky podľa i18n v čase
    // bootu; po výbere reset na placeholder, aby sa to isté dejisko dalo vybrať znova.
    try {
      const theatrePicker = document.getElementById('mideast-select');
      if (theatrePicker) {
        for (const scene of listMideastTheatres()) {
          const option = document.createElement('option');
          option.value = scene.id;
          option.textContent = theatreLabel(scene);
          theatrePicker.appendChild(option);
        }
        theatrePicker.addEventListener('change', () => {
          const id = theatrePicker.value;
          theatrePicker.value = '';
          if (id) void runMideastTheatre(id);
        });
      }
    } catch { /* výber je voliteľné chróm — bez neho štart nepadá */ }

  } catch (error) {
    console.error("God's Eye View initialization failed:", error);
    loaderStatus.textContent = t('loader.error', { detail: describeError(error) });
    loaderStatus.style.color = '#ff4444';
  }
}

// Account state is optional and cannot block the public globe startup.
// Inštancia ide aj sledovaným letom (init → createFollowedFlights): prihlásenie, zoznam k účtu.
let accountCenter = null;
try { accountCenter = initAuthPanel(); } catch { console.warn('[Account] Account panel could not initialize.'); }
// Hlas len pre prihlásených (2026-10-05): neprihlásenému mikrofón otvorí prihlásenie s dôvodom (ako SLEDOVAŤ).
// Bez panela účtu rozhoduje server (token → 401).
setVoiceAccessGate((info) => {
  if (!accountCenter) return true;
  // denied = server tokenu odmietol (relácia vypršala) — ponúknuť prihlásenie aj „prihlásenému" klientovi.
  if (accountCenter.client?.getState?.().user && !info?.denied) return true;
  try { void accountCenter.open?.(null, { reason: 'voice.login-reason' }); } catch { /* panel je voliteľný */ }
  return false;
});
try { initSiteTelemetry(); initNoticeBanner(); } catch { /* voliteľné, glóbus beží aj bez nich */ }
init();
