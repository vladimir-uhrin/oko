import * as Cesium from 'cesium';
import { applyDomTranslations, currentLanguage, setLanguage, t } from './i18n.js';
import { StyleManager } from './ui.js';
import { flyToBratislava } from './camera.js';
import { DataLayerManager } from './data/manager.js';
import flightsLayer from './data/flights.js';
import militaryFlightsLayer from './data/militaryFlights.js';
import earthquakesLayer from './data/earthquakes.js';
import volcanoesLayer from './data/volcanoes.js';
import naturalEventsLayer from './data/naturalEvents.js';
import shmuRadarLayer from './data/shmuRadar.js';
import meteoLayer from './data/meteoLayer.js';
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
import { bindActiveMapStackToEvents } from './data/activeMapStack.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';
import { registerDataCredits } from './data/dataCredits.js';
import { SceneDirector } from './scenes/director.js';
import { initGevVoiceCommands } from './voice/gevRealtime.js';
import { MapStackController } from './mapStackController.js';
import { createPhotorealTileset, isGoogleRegionBlocked } from './photorealTileset.js';
import { installDayNightClock } from './globeLighting.js';
import { installSharpStarfield } from './starfield.js';
import { bindContactPaletteToMapStack } from './data/contactPalette.js';
import { initAnnotations } from './annotations/index.js';
import { applyChokepointScene, chokepointSceneAnnotationRequests, chokepointSceneById, chokepointSceneFacts, chokepointSceneLabel, listChokepointScenes } from './chokepointScenes.js';
import { createOilPriceChip, createOilPricePanel } from './oilPriceChip.js';
import { createStraitTrafficChip } from './straitTrafficChip.js';
import { createSituationPanel } from './situationFeed.js';
import { createIncidentCards } from './gulfIncidentCards.js';
import { createSceneRevealGate } from './sceneRevealGate.js';
import { createCountryBoundaries } from './data/countryBoundaries.js';
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
async function init() {
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');

  // Jazyk UI čo najskôr: statické data-i18n uzly sa preložia PRED prvým
  // vykreslením panelov a prepínač SK/EN sa aktivuje (persist + reload —
  // stav pohľadu prežije v share-hashi, viď src/i18n.js).
  applyDomTranslations();
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

    // Hodiny scény v reálnom čase + minútový tik pre terminátor (globeLighting.js):
    // Viewer inak zmrazí clock.currentTime na čase načítania a Slnko s ním.
    installDayNightClock(viewer, { requestRender: governorRequestRender });

    // Ostré hviezdy (starfield.js): Tycho steny Cesia ako stlmené pozadie
    // (Mliečna dráha, hustota) + generované ostré body navrchu. Prvá verzia
    // bola len z bodov a pôsobila prázdne („tie hviezdy daj naspäť"), samotné
    // Tycho JPEG je rozmazané („oprav ostrosť hviezd") — toto je oboje.
    // `?stars=cesium` vráti pôvodný skybox. Generuje sa po prvom snímku.
    if (new URLSearchParams(window.location.search).get('stars') !== 'cesium') {
      setTimeout(() => {
        try { installSharpStarfield(viewer); } catch (error) { console.warn('[Init] sharp starfield unavailable:', error); }
      }, 0);
    }

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
    try {
      if (qaBasemapOsm) throw new Error('qaBasemap=osm — Google tileset skipped to protect the daily root-request quota');
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
      if (!id || !mapStackController.getStack(id) || mapStackController.getActiveId() === id) return;
      void mapStackController.setStack(id);
    });

    // Initialize the style manager (post-processing, HUD, locations, share links)
    const styleManager = new StyleManager(viewer, { mapStackController });
    // Mobilný plášť (2026-09-14): na dotyku / úzkej obrazovke spodná lišta
    // a výsuvné panely namiesto bočných stĺpcov; širší výber prstom; bez
    // ambientných kariet na plátne (jedna vybraná karta naraz).
    window.__okoMobileShell = initMobileShell({
      styleManager,
      scene: viewer.scene,
      suppressLane: setWorldOverlayLaneSuppressed,
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
    dataManager.register(flightsLayer);
    dataManager.register(militaryFlightsLayer);
    dataManager.register(earthquakesLayer);
    dataManager.register(volcanoesLayer);
    dataManager.register(naturalEventsLayer);
    dataManager.register(shmuRadarLayer);
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
    dataManager.buildTogglePanel(document.getElementById('data-toggles'));
    styleManager.attachDataManager(dataManager);

    // Initialize deterministic scene playback for social clip capture
    const sceneDirector = new SceneDirector(viewer, styleManager, dataManager);

    // Initialize the voice "whiteboard" annotation engine (world-space renderer)
    const annotations = initAnnotations({ viewer, tileset });

    // Keep startup chrome truthful: a share is not restored until camera,
    // visual/map/panel lanes, and every requested layer have terminated.
    void Promise.all([
      styleManager.initialRestorePromise,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]).finally(() => {
      loadingScreen.classList.add('hidden');
      // Reveal only after the loading cover has yielded. transitionend can be
      // absent under reduced motion, so a bounded fallback makes this reliable.
      let firstRunRevealed = false;
      const revealFirstRun = () => {
        if (firstRunRevealed) return;
        firstRunRevealed = true;
        // dataManager is passed explicitly: the globe missions enable bundled
        // keyless layers through it, and reaching for styleManager._dataManager
        // would make a private field part of this feature's contract.
        initFirstRunExperience({ styleManager, dataManager });
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
    // Situation from open sources (pilot): a "GULF / ZÁLIV" panel in the DATA tab
    // (open-source news via GDELT/RSS). The in-scene reveal is the hot cards below.
    const situationPanel = createSituationPanel({ region: 'gulf' });
    window.__godsEyeView.situationPanel = situationPanel;
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
    // The active strait's pin request — the gate annotates it on approach and
    // clears it when you pull back, so the pin appears only when zoomed in.
    let activeScenePin = null;
    const revealGate = createSceneRevealGate({
      viewer,
      onChange: (visible) => {
        incidentCards.setRevealed(visible);
        try {
          if (!visible) annotations?.clear?.();
          else if (activeScenePin && (annotations?.count?.() ?? 0) === 0) annotations.annotate(activeScenePin, { persist: true, flyTo: false });
        } catch { /* annotations are optional chrome */ }
      },
    });
    window.__godsEyeView.sceneRevealGate = revealGate;
    // Country borders (Natural Earth, public domain): political context drawn on
    // the globe with a chokepoint/strike reveal — a standalone overlay, on with
    // any scene, off outside one.
    const countryBoundaries = createCountryBoundaries({ viewer });
    window.__godsEyeView.countryBoundaries = countryBoundaries;
    const runChokepointScene = (id) => {
      const scene = chokepointSceneById(id);
      const result = applyChokepointScene(id, chokepointSceneDeps);
      void oilPriceChip.refreshAndShow();
      if (scene) {
        straitTrafficChip.showFor({
          rect: scene.rectDegrees,
          label: chokepointSceneLabel(scene),
          facts: chokepointSceneFacts(scene, { lang: currentLanguage(), translate: t }),
        });
        // Gate all scene overlays — pin, cards, chips — by camera distance to this
        // strait's centre. The pin is handed to the gate (annotated on approach).
        activeScenePin = chokepointSceneAnnotationRequests(scene, t);
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
    // Shareable deep link `?chokepoint=<id>` (e.g. oko.uhrin.digital/?chokepoint=hormuz).
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

  } catch (error) {
    console.error("God's Eye View initialization failed:", error);
    loaderStatus.textContent = t('loader.error', { detail: describeError(error) });
    loaderStatus.style.color = '#ff4444';
  }
}

init();
