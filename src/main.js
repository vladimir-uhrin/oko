import * as Cesium from 'cesium';
import { initAuthPanel } from './auth/panel.js';
import { createFollowedFlights, installFollowButton } from './followedFlights.js';
import { createFollowedVessels, fetchVesselLiveContact, installVesselFollowButtons } from './followedVessels.js';
import { createPushNotifications } from './pushNotifications.js';
import './auth/panel.css';
// Admin (2026-10-03): anonymná štatistika návštev a oznam prevádzkovateľa.
import { initSiteTelemetry } from './siteTelemetry.js';
import { initNoticeBanner } from './noticeBanner.js';
import './noticeBanner.css';
import { applyDomTranslations, currentLanguage, setLanguage, t } from './i18n.js';
import { StyleManager } from './ui.js';
import { START_FLY_DURATION_S, START_GLOBE_DWELL_MS, showStartView } from './camera.js';
import { coarsenTilesDuringStartFlight } from './startFlightDetail.js';
import { DataLayerManager, layerDisplayName } from './data/manager.js';
import flightsLayer, { FLEET_FAR_BRIGHTNESS } from './data/flights.js';
import militaryFlightsLayer from './data/militaryFlights.js';
// Vrstvy vypnuté pri štarte idú cez lenivých zástupcov (src/data/lazyLayers.js, 2026-10-31, lenivý štart):
// správca pozná metadáta hneď, kód vrstvy príde dynamickým importom pri prvom zapnutí (init). Mená ostávajú
// tie isté, takže registrácia a prepojenia nižšie sú bez zmeny.
import {
  earthquakesLazy as earthquakesLayer, volcanoesLazy as volcanoesLayer, naturalEventsLazy as naturalEventsLayer,
  shmuRadarLazy as shmuRadarLayer, shmuWarningsLazy as shmuWarningsLayer, shmuStationsLazy as shmuStationsLayer,
  operaRadarLazy as operaRadarLayer, gfwPresenceLazy as gfwPresenceLayer, createAishubVesselsLazy as createAishubVesselsLayer,
  gfwSarDetectionsLazy as gfwSarDetectionsLayer, gasFlowsLazy as gasFlowsLayer, gasPipelinesLazy as gasPipelinesLayer,
  localDataLayersLazy as localDataLayers, volbyObceLazy as volbyObceLayer,
} from './data/lazyLayers.js';
import { createWeatherDock } from './weatherDock.js';
// Lenivý zástupca: skutočný meteoLayer.js sa dotiahne až pri otvorení vrstvy
// (obmedzenie zadania — news stránky nesmú ťahať weather kód). Viď meteoLazy.js.
import meteoLayer from './data/meteoLazy.js';
// Satelity, misie, doprava a bikeshare: lenivé zástupcovia (lazyLayers.js, 2026-10-31) — tie isté objekty používa ui.js.
import { satellitesLazy as satellitesLayer, rocketLaunchesLazy as rocketLaunchesLayer, trafficLazy as trafficLayer, bikeshareLazy as bikeshareLayer } from './data/lazyLayers.js';
import cctvLayer from './data/cctv.js';
import radioLayer from './data/radio.js';
import aisLiveVesselsLayer from './data/aisLiveVessels.js';
import militaryInstallationsLayer from './data/militaryInstallations.js';
import militaryAwarenessLayer from './data/militaryAwareness.js';
import gibsOverlayLayers from './data/gibsOverlays.js';
import { bindActiveMapStackToEvents, onActiveMapStackChange } from './data/activeMapStack.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';
import { registerDataCredits } from './data/dataCredits.js';
// Hlas, anotácie a réžia scén sa sťahujú až pri prvom použití (2026-10-31, lenivý štart):
// voice/voiceLazy.js drží pilulku v doku a bránu prihlásenia, scenes/directorLazy.js réžiu vlastníka.
import { installLazyVoice, setVoiceAccessGate } from './voice/voiceLazy.js';
import { loadSceneDirector } from './scenes/directorLazy.js';
import { MapStackController } from './mapStackController.js';
import { createPhotorealTileset, isGoogleRegionBlocked, isLowMemoryDevice, photorealRetryPaths, photorealTilesetOptions, readEeaBlock, rememberedEeaError, shouldRememberEea, writeEeaBlock } from './photorealTileset.js';
import { PHOTOREAL_FALLBACK_STACK, PHOTOREAL_RETRY_DELAYS_MS, retryClockLabel, schedulePhotorealRetry, shouldReturnToPhotoreal } from './photorealRetry.js';
import { installContextLossRecovery, showContextLossNotice } from './contextLossRecovery.js';
import { isCrawlerUserAgent } from './crawlerDetect.js';
import { initAnalytics, trackEvent } from './analytics.js';
import { AUTO_BASEMAP_STORAGE_KEY, createLayerBasemapPolicy, meteoBasemapForHost, parseAutoBasemapSetting } from './layerBasemap.js';
import { installStadiaFallback } from './stadiaHealth.js';
import { installDayNightClock } from './globeLighting.js';
import { installSharpStarfield } from './starfield.js';
import { armStartupGate, releaseStartupGate, whenStartupReady } from './startupGate.js';
import { bindContactPaletteToMapStack } from './data/contactPalette.js';
import { chokepointSceneLabel, listChokepointScenes } from './chokepointScenes.js';
import { createOilPricePanel } from './oilPriceChip.js';
import { createCountryBoundaries } from './data/countryBoundaries.js';
import { installZoomBorders } from './data/zoomBorders.js';
import { createCountryLabels } from './data/countryLabels.js';
import { installFarGlobe } from './farGlobe.js';
import { applyWheelZoom } from './wheelZoom.js';
import { frontSceneLabel, listFrontScenes } from './ukraineFrontScenes.js';
import { listMideastTheatres, theatreLabel } from './data/mideastTheatres.js';
import { createLeftLane } from './leftLane.js';
import { createFireNewsCard } from './fireNewsCard.js';
import { conflictTitle, listConflicts } from './data/conflictsCatalog.js';
// Scény konfliktov (úžiny, UKRAJINA, BLÍZKY VÝCHOD, kartičky) žijú v conflictScenes.js a sťahujú sa až pri
// prvom podnete (2026-10-31, lenivý štart) — tu ostáva len brána a katalóg pre hľadanie a výbery.
import { createConflictScenesGate } from './conflictScenesLazy.js';
import { createCommandPalette } from './commandPalette.js';
import { LAYER_GROUP_ORDER, isCatalogLayer, layerGroup, layerKeywords } from './layerCategories.js';
import { flyToGlobeView, searchAndFlyTo } from './locations.js';
import { createAircraftSearchCommands } from './aircraftSearchCommands.js';
import { createVesselSearchCommands } from './vesselSearchCommands.js';
import { attachVesselEstimateViewer, showRemoteVessel } from './data/vesselEstimate.js';
import { lookupVesselInfo, realMmsiFor } from './data/vesselInfo.js';
import { loadPortIndex as loadVesselPortIndex } from './data/vesselPortIndex.js';
import { matchDestinationPort } from './data/vesselDestination.js';
import { initLogoGaze } from './logoGaze.js';
import { initCockpitCloudEffects } from './cockpitCloudEffects.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { applySoftwareRendererBudget } from './softwareRenderer.js';
import { installScopeMask } from './scopeMask.js';
import { installEmbedMode, isEmbedMode } from './embedMode.js';
import { initMobileShell, isCoarsePointer, resolveShellMode } from './mobileShell.js';
import { isVolbyArchived, parseVolbyParam, VOLBY_ARCHIVE_MS } from './volbyShared.js';
import { createVolbyMapMode } from './volbyMapMode.js';
import { getOverlayPaintRect, setWorldOverlayLaneSuppressed } from './overlays/worldOverlay.js';
import { VESSEL_OVERLAY_SOURCE_ID } from './data/vesselLabels.js';

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

/**
 * Počká, kým prehliadač vykreslí snímok (rAF + úloha po ňom). V karte na pozadí rAF nebeží —
 * poistka po 100 ms, nech štart nezamrzne.
 */
function nextPaint() {
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    try { requestAnimationFrame(() => setTimeout(go, 0)); } catch { /* bez rAF */ }
    setTimeout(go, 100);
  });
}

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

    // Úvodná obrazovka sa vykreslí PRED vytvorením glóbusu (2026-10-16, meranie okolive.sk: new Viewer —
    // WebGL kontext a scéna — držal hlavné vlákno 1,2–1,9 s v jednom kuse a prvý obraz prišiel až
    // po 2,5–3,4 s, na mobile 5 s; dovtedy čierna obrazovka). Jeden snímok počkania = oko s vírom hneď.
    await nextPaint();

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

    // Strata grafického kontextu (2026-10-15, mobil — contextLossRecovery.js): Cesium ju neobnoví,
    // stránka sa sama obnoví na tom istom pohľade (adresa), najviac 2× za 10 min.
    let ctxStorage = null;
    try { ctxStorage = window.sessionStorage; } catch { ctxStorage = null; }
    installContextLossRecovery(viewer.canvas, {
      storage: ctxStorage,
      translate: t,
      notify: (text, opts) => showContextLossNotice(document, text, opts),
    });

    // Cap the default render loop at 60 fps. Cesium's loop otherwise runs at
    // the display's refresh rate — 120 Hz on ProMotion panels — doubling GPU
    // and CPU burn for zero visual benefit in a map app whose animation
    // cadences (poll interpolation, trail fades, style crossfades) are all
    // designed against wall-clock time, not frame count. Measured on the
    // 2026-08-05 perf investigation as a strict halving of idle burn on
    // 120 Hz hardware; a no-op on 60 Hz displays. (perf item 2)
    viewer.targetFrameRate = 60;
    // Bez grafickej karty (PageSpeed, počítač bez ovládača): 1 snímka/s, bez MSAA — inak stránka zamrzne.
    const softwareRender = applySoftwareRendererBudget(viewer);
    if (softwareRender) console.info('[OKO] softvérové kreslenie WebGL — úsporný režim');

    // skyBox: false vynechá aj Slnko a Mesiac (CesiumWidget ich vytvára spolu
    // s oblohou) — doplniť, nech sa nič okrem načasovania oblohy nemení.
    // Bez GPU ani Slnko a Mesiac (softwareRenderer.js, 2026-10-31): ďalšie shadery a priechody procesorom.
    if (!softwareRender) {
      viewer.scene.sun = new Cesium.Sun();
      viewer.scene.moon = new Cesium.Moon();
    }

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
      // Bez GPU bez hviezd (2026-10-31): maľovanie oblohy a šesť stien Tycho by kreslil procesor.
      if (!sharpStars || softwareRender) return;
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

    // Statické „Cesium ion" logo z kreditov preč VŽDY (2026-10-09, predtým len
    // bez tokenu): CesiumJS je Apache-2.0 a toto logo je len zdvorilostný
    // default, ktorý CreditDisplay kreslí v každej snímke bez ohľadu na to, či
    // sa ion obsah používa. POVINNÁ atribúcia ion ostáva zachovaná sama od
    // seba: ion server posiela ku každému svojmu assetu (Google 3D cez ion,
    // záložný World Terrain) kredit s `ion-credit.png`, ktorý CreditDisplay
    // (isIon → _defaultCredit) zobrazí presne v snímkach, kde sa ion obsah
    // kreslí, a po ňom zmizne. Vlastník: logo + „Upgrade for commercial use"
    // na glóbusových mapách „toto mi vadí" — tam sa od dnes ion nekreslí
    // (terén je bezkľúčový, mapStackController._prefersWorldTerrain). Google
    // logo sa NIKDY neodstraňuje — Maps Platform ToS ho vyžaduje viditeľné,
    // kým sa renderuje Google obsah (viď komentár pri creditContainer vyššie).
    Cesium.CreditDisplay.cesiumCredit = undefined;

    // Register per-layer data attribution into the "Data attribution" popover.
    // Required by each source's license (ODbL, CC BY-NC-SA, NASA FIRMS, etc.);
    // strings are verbatim from DATA_SOURCES.md. Static + always-present in the
    // expandable bottom-left credit lightbox (showOnScreen=false), so they never
    // clutter the on-globe attribution line.
    registerDataCredits(viewer);
    // Odkazy kreditov Cesia („Data attribution", krížik okna) sú tlačidlá bez href — rola tlačidla
    // (Lighthouse SEO „crawlable anchors", 2026-10-31; čítačke obrazovky sedí tlačidlo viac než odkaz bez cieľa).
    for (const link of document.querySelectorAll('.cesium-credit-expand-link, .cesium-credit-lightbox-close')) link.setAttribute('role', 'button');
    // Text odkazu si Cesium píše po anglicky; v SK rozhraní trčal „Data attribution" (revízia UI 2026-11-06).
    for (const link of document.querySelectorAll('.cesium-credit-expand-link')) link.textContent = t('credits.expand-link');

    // Hide Cesium's default globe — Google Photorealistic 3D Tiles provide their own
    // globe at all LODs (street level → orbital). The default globe's 2D imagery
    // clips through 3D tile buildings at close range.
    viewer.scene.globe.show = false;

    // Keep a sky behind Google 3D Tiles, but soften Cesium's high-intensity
    // default atmosphere. With the globe hidden its bright limb otherwise
    // reads as a hard cyan seam where distant photoreal tiles meet the sky.
    // Bez GPU atmosféra vypnutá (softwareRenderer.js, 2026-10-31).
    viewer.scene.skyAtmosphere.show = !softwareRender;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;

    // Pokojnejší zoom kolieskom na počítači (src/wheelZoom.js, 2026-10-30: zemeguľa sa pri skrolovaní približovala príliš rýchlo).
    applyWheelZoom(viewer.scene.screenSpaceCameraController, { coarsePointer: window.matchMedia?.('(pointer: coarse)')?.matches === true });

    loaderStatus.textContent = t('loader.google-tiles');
    let tileset = null;
    /** 'google' | 'ion' | null — odkiaľ fotoreál naozaj tečie (chip title, QA). */
    let photorealSource = null;
    /** Prečo je fotoreál nedostupný — do tooltipu čipu, nech používateľ nehľadá chybu u seba. */
    let photorealUnavailableReason = null;
    /** Chyba boot-u, ak to bol minútový limit Google (429) — po ~minúte sa skúsi znova (photorealRetry.js). */
    let photorealRetryFailure = null;
    /** Dôvod nedostupnosti pre tooltip: EHP odmietnutie ľudskou vetou, ostatné chyby svojím textom. */
    const photorealReason = (error) => {
      const detail = describeError(error);
      return (error?.regionBlocked || isGoogleRegionBlocked(error)) ? t('mapstack.photoreal-eea', { detail }) : detail;
    };
    /** localStorage pre zapamätané EHP 403; prístup môže hádzať (súkromné okno) — vtedy bez pamäte. */
    const eeaStorage = () => { try { return window.localStorage; } catch { return null; } };
    // Telefón/tablet: menšia cache dlaždíc (photorealTileset.js — meranie 2026-10-15); platí aj pre neskorý pokus.
    const lowMemory = isLowMemoryDevice({
      coarse: window.matchMedia?.('(pointer: coarse)')?.matches === true,
      deviceMemory: navigator.deviceMemory,
    });
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
      // Bez GPU (PageSpeed, 2026-10-31): 3D dlaždice Google procesorom zamrazili stránku aj pri 1 snímke/s — OSM ako pri robotoch.
      if (softwareRender) throw new Error('software WebGL — photorealistic tiles skipped (no GPU)');
      // Google Photorealistic 3D Tiles: najprv priamo Google kľúčom, pri EHP
      // 403 („not available for your account and region", od 2026-09-04) cez
      // Cesium ion asset 2275207 — tie isté dlaždice pod zmluvou Cesiumu
      // (photorealTileset.js; podmienky v DATA_SOURCES.md).
      // EHP 403 zapamätané na 24 h (photorealTileset.js, 2026-10-17): rovno cez ion, bez požiadavky na koreň s naším kľúčom.
      const eeaRemembered = readEeaBlock(eeaStorage());
      const photoreal = await createPhotorealTileset({
        hasGoogleKey: !!googleApiKey,
        hasIonToken: !!cesiumToken,
        tilesetOptions: photorealTilesetOptions({ lowMemory }),
        priorGoogleError: eeaRemembered ? rememberedEeaError() : null,
      });
      if (shouldRememberEea(photoreal)) writeEeaBlock(eeaStorage());
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
      // Minútový limit Google (429 „3D Tiles root requests per minute", photorealRetry.js): záložná mapa
      // je len dočasná — pokus sa zopakuje, keď sa okno uvoľní (naplánuje sa nižšie, keď už je UI).
      if (shouldRememberEea(tileError)) writeEeaBlock(eeaStorage());
      photorealRetryFailure = photorealRetryPaths(tileError) ? tileError : null;
      // EHP odmietnutie dostane ľudskú vetu (nie je to chyba používateľa);
      // ostatné chyby nesú svoj text.
      photorealUnavailableReason = photorealRetryFailure
        ? t('mapstack.photoreal-busy', { time: retryClockLabel(Date.now(), PHOTOREAL_RETRY_DELAYS_MS[0]) })
        : photorealReason(tileError);
      loaderStatus.textContent = photorealRetryFailure
        ? t('loader.google-tiles-busy')
        : t('loader.google-tiles-fallback', { detail: tileErrorDetail });
      // Keep Cesium globe visible as fallback instead of aborting the app.
      viewer.scene.globe.show = true;
    }

    loaderStatus.textContent = t('loader.init-systems');

    // Terén glóbusových máp: predvolene merge terén (DMR 3.5 nad SR + Re:Earth vo
    // svete) aj s ion tokenom (2026-10-09 — ion World Terrain nosí kredit „Upgrade
    // for commercial use", vlastník ho nechcel; bez ion obsahu v zábere kredit
    // zmizne sám). `?terrain=world` vynúti ion terén, `?terrain=sk` ho zakáže aj
    // ako zálohu pri zlyhaní bezkľúčového terénu.
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
    // Zem z výšky (src/farGlobe.js, 2026-10-16, vlastník ukázal NASA „Zem v noci": „toto je nádherné"): nad
    // 1 000 km (v noci nad 700 km) skutočný glóbus — NASA Blue Marble cez deň, Black Marble naplno v noci,
    // terminátor od Cesia; pod 700 km (v noci 450 km) Google 3D ako doteraz. Počas preletu kamery fotoreál
    // (prednačíta si cieľ). Z výšky sa nesťahujú Google dlaždice. Na fotoreál sa imagery položiť nedá
    // (draping v Cesiu 1.138 zamrzol stránku). Inštaluje sa hneď po radiči, aby dlaždice glóbusu prišli
    // ešte pod úvodnou obrazovkou (štart naň počká, strop 3 s).
    // Jas lietadiel (vlastník: „svetlosť lietadiel ako kompromis medzi žiarou miest a lietadlami"): z výšky 0,6.
    // Ten istý inštalátor použije aj Google 3D, ktorý príde neskôr (photorealRetry.js).
    const installFar = (ts) => installFarGlobe({
      viewer, tileset: ts, getStackId: () => mapStackController.getActiveId(),
      onFarChange: (far) => flightsLayer.setFleetBrightness?.(far ? FLEET_FAR_BRIGHTNESS : 1),
    });
    let farGlobe = installFar(tileset);
    await mapStackController.setStack(tileset ? 'photoreal' : 'osm', { silent: true });
    /** Generácia prepnutia po štarte: neskorý Google 3D sa vráti len ak odvtedy nikto podklad nezmenil. */
    const fallbackSwitchGeneration = mapStackController.getSwitchGeneration();
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
    // Štýly 1–7 a druh mapy ostávajú v dolnej lište — rozbaľovací ŠTÝL / VIZUÁLNE PREDVOĽBY vedľa
    // Polohy, na počítači aj na mobile (2026-10-15, vlastník: „kde zmizli mapy druhy? … daj to naspäť",
    // „aj na mobiloch? … daj to naspäť"). Presun do panela „Štýl a podklad mapy" v zóne VZHĽAD
    // (2026-10-11) je zrušený; prázdny panel skrýva CSS body.oko-look-in-dock.
    document.body.classList.add('oko-look-in-dock');
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

    // Lišta súhlasu na telefóne až po úvodnom prelete (2026-10-16, meranie okolive.sk 390×844: lišta
    // prekryla polovicu obrazovky hneď po úvodnej obrazovke, kým sa glóbus ešte točil). Rozhodnutie
    // o GA (bez cookies do súhlasu) sa nemení — čaká len zobrazenie; poistka v initAnalytics nižšie.
    let settleStart = () => {};
    const startSettled = new Promise((resolve) => { settleStart = resolve; });
    const phoneStart = !styleManager.hasShareState
      && resolveShellMode({ width: window.innerWidth, height: window.innerHeight, coarse: isCoarsePointer(window) }).mobile;

    // Poloha podľa pripojenia RAZ pre všetkých (prelet, zvýraznenie hraníc domovskej krajiny, popisky):
    // /api/whereami (hlavičky Cloudflare, nič sa neukladá). Roboty a vložený rámček bez polohy.
    // Vývoj/QA: ?qaGeo=lat,lon[,mesto][,KÓD] (KÓD = ISO2 krajiny, napr. SK).
    const qaGeo = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('qaGeo') : null;
    const geoPromise = crawlerVisit || embedView ? Promise.resolve(null) : (async () => {
      try {
        if (qaGeo) {
          const parts = qaGeo.split(',');
          const country = /^[A-Z]{2}$/.test(parts.at(-1) || '') ? parts.pop() : undefined;
          const [lat, lon, ...city] = parts;
          return { precision: 'city', lat: Number(lat), lon: Number(lon), city: city.join(','), country };
        }
        const res = await fetch('/api/whereami', { cache: 'no-store' });
        return res.ok ? res.json() : null;
      } catch { return null; }
    })();

    // Bez stavu z odkazu: úvodný pohľad na zemeguľu so Slovenskom (2026-10-15, camera.js START_VIEW);
    // po skrytí úvodnej obrazovky sa kamera pomaly dorovná. Tlačidlo s glóbusom hore ostáva na Bratislave.
    if (!styleManager.hasShareState) {
      loaderStatus.textContent = t('loader.start-globe');
      // Prelet nad oblasť návštevníka podľa pripojenia (geoPromise vyššie). Roboty a vložený rámček
      // ostávajú na zemeguli.
      // Vývoj/QA: ?qaTime=2026-10-15T07:30Z — čas scény (osvetlenie) aj úvodného pohľadu k Slnku.
      const qaTimeMs = import.meta.env.DEV ? Date.parse(new URLSearchParams(window.location.search).get('qaTime') || '') : NaN;
      if (Number.isFinite(qaTimeMs)) {
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(qaTimeMs));
        viewer.clock.shouldAnimate = false;
      }
      // VOĽBY 2026 (2026-10-24): odkaz ?volby=<kód obce> alebo ?volby=k<kraj> — úvodný prelet mieri rovno na obec
      // či kraj (bez hlášky o oblasti), panel potom doletí nižšie. Pri chybe ostáva poloha podľa pripojenia.
      const volbyStart = parseVolbyParam(window.location?.search || '');
      const volbyLocate = volbyStart?.obec || volbyStart?.kraj ? async () => {
        try {
          const path = volbyStart.obec ? `/api/volby/obec/${encodeURIComponent(volbyStart.obec)}` : `/api/volby/kraj/${encodeURIComponent(volbyStart.kraj)}`;
          const res = await fetch(path, { cache: 'no-store' });
          const j = res.ok ? await res.json() : null;
          const lat = Number(j?.lat ?? j?.center?.lat);
          const lon = Number(j?.lon ?? j?.center?.lon);
          return Number.isFinite(lat) && Number.isFinite(lon) ? { precision: 'city', lat, lon } : geoPromise;
        } catch { return geoPromise; }
      } : null;
      const locate = crawlerVisit || embedView ? null : () => geoPromise;
      showStartView(viewer, {
        whenReady: whenStartupReady(),
        nowMs: Number.isFinite(qaTimeMs) ? qaTimeMs : Date.now(),
        locate: locate && volbyLocate ? volbyLocate : locate,
        onArrive: (geo) => {
          settleStart();
          let place = geo?.city || '';
          if (!place && geo?.country) {
            try { place = new Intl.DisplayNames([currentLanguage()], { type: 'region' }).of(geo.country) || ''; } catch { place = ''; }
          }
          if (place) styleManager._showToast(t('start.your-area', { place }), { durationMs: 6000, tone: 'info' });
        },
      });
      // Hrubšie dlaždice Google 3D počas preletu, plný detail späť pred pristátím (src/startFlightDetail.js;
      // meranie 2026-10-16: 554 → 452 požiadaviek a 15,0 → 12,2 MB pri štarte, po pristátí nič navyše).
      coarsenTilesDuringStartFlight({ tileset, camera: viewer.camera, whenReady: whenStartupReady() });
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
    if (import.meta.env.DEV) window.__okoQa = { setLayer: (id, on, origin = 'user') => dataManager.setEnabled(id, on, { origin }), setMap: (id) => styleManager._setMapStack(id), map: () => mapStackController.getActiveId(), layers: () => [...dataManager.layers.keys()], layer: (id) => dataManager.layers.get(id)?.module };
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
    // Stadia „mimo" (2026-10-15, stadiaHealth.js): náhrada ide cestou UI ako klik na čip — čipy, štítok
    // mapy a zdieľaný odkaz nasledujú náhradu a meteo po vypnutí vráti pôvodnú mapu (Google 3D).
    // Po skončení bloku sa čipy prekreslia znova (2026-10-16); test zapojenia: stadiaHealth.test.mjs.
    installStadiaFallback({
      controller: mapStackController,
      adopt: () => layerBasemap.onStadiaBlocked(),
      refreshControls: () => styleManager._initMapStackControl(),
      switchStack: (id) => styleManager._setMapStack(id),
    });
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
    // VOĽBY 2026 (2026-10-24): klikateľná mapa všetkých obcí; klik otvorí obec v paneli VOĽBY (prepojenie nižšie).
    dataManager.register(volbyObceLayer);
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

    // Réžia scén (scenes/director.js) a anotačný engine hlasu (annotations/) už nevznikajú pri štarte —
    // dotiahnu sa s hlasom (voiceLazy.js) alebo pre vlastníka (loadOwnerTools nižšie).

    // Keep startup chrome truthful: a share is not restored until camera,
    // visual/map/panel lanes, and every requested layer have terminated.
    // Strop 12 s (2026-10-07): odkaz so zapnutými požiarmi držal preloader minúty, kým NASA FIRMS
    // odpovedala — pomalá vrstva sa dotiahne už za glóbusom (jej riadok ukazuje načítavanie).
    void Promise.all([
      Promise.race([styleManager.initialRestorePromise, new Promise((resolve) => setTimeout(resolve, STARTUP_RESTORE_CAP_MS))]),
      new Promise((resolve) => setTimeout(resolve, 1000)),
      // Zem z výšky: nech sa pod okom nemihne čierny glóbus bez dlaždíc NASA (strop 3 s vo farGlobe.js).
      farGlobe.whenReady,
    ]).finally(() => {
      loadingScreen.classList.add('hidden');
      releaseStartupGate();
      startSharpStarfield();
      // Súhlas s cookies + GA4 až po štarte (src/analytics.js; bez súhlasu GA bez cookies); v živom rámčeku nič nezbierame a na súhlas sa nepýtame (lišta by rámček zakryla).
      // Telefón: lišta až po prelete nad oblasť návštevníka; prelet, ktorý nepríde (robot, bez polohy,
      // dotyk ho zastaví), ju nezdrží dlhšie než pauza na zemeguli + prelet + 1 s.
      const consentBannerWhen = phoneStart
        ? Promise.race([startSettled, new Promise((resolve) => setTimeout(resolve, START_GLOBE_DWELL_MS + START_FLY_DURATION_S * 1000 + 1000))])
        : null;
      try { if (!embedView) initAnalytics({ t, crawler: crawlerVisit, showBannerWhen: consentBannerWhen }); } catch (error) { console.warn('[analytics]', error); }
      // Reveal only after the loading cover has yielded. transitionend can be
      // absent under reduced motion, so a bounded fallback makes this reliable.
      let firstRunRevealed = false;
      const revealFirstRun = () => {
        if (firstRunRevealed) return;
        firstRunRevealed = true;
        // dataManager is passed explicitly: the globe missions enable bundled
        // keyless layers through it, and reaching for styleManager._dataManager
        // would make a private field part of this feature's contract.
        // Úvodná karta misií (firstRunExperience.js) príde až teraz dynamickým importom (2026-10-31, lenivý štart).
        if (!embedView) void import('./firstRunExperience.js').then((m) => m.initFirstRunExperience({ styleManager, dataManager }));
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
      sceneDirector: null, // doplní directorLazy.js po dotiahnutí
      mapStackController,
      annotations: null, // doplní voiceLazy.js po dotiahnutí hlasu
      weatherEffects,
      cockpitCloudEffects,
      getRenderGovernorDiagnostics,
      requestRender: governorRequestRender,
    };
    // Hlas až pri prvom stlačení mikrofónu alebo medzerníka (src/voice/voiceLazy.js, 2026-10-31): pilulka stojí
    // v doku hneď, modul (~200 KB) príde s prvým stlačením; réžia scén a anotácie idú s ním.
    const lazyContext = () => ({ viewer, styleManager, dataManager, tileset: window.__godsEyeView.tileset });
    window.__godsEyeView.voiceCommands = installLazyVoice(lazyContext);
    // Réžia scén (panel Prelety kamerou, .oko-owner-only) hneď, keď je telo stránky vlastníkovo (body.oko-owner —
    // prihlásený vlastník alebo localhost, nastavuje sa nižšie pri účte); návštevník ju nikdy nesťahuje.
    const loadOwnerTools = () => { if (document.body.classList.contains('oko-owner')) void loadSceneDirector(lazyContext()); };
    loadOwnerTools();
    new MutationObserver(loadOwnerTools).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // Google 3D po minútovom limite (src/photorealRetry.js, 2026-10-17, vlastník: „Google 3D: po 429 opakovať
    // pokus, nie OSM na celú reláciu"). Kľúč, ktorý vydáva ion, občas narazí na „3D Tiles root requests per
    // minute" — o minútu je preč. Tri pokusy (~65/130/260 s), každý len cestou, ktorá padla na limit (EHP 403
    // sa neopakuje). Po úspechu tileset do scény a radiča, Zem z výšky znova; Google 3D sa zapne, len ak od
    // záložného štartu nikto podklad neprepol (klik, vrstva, scéna, odkaz) — inak sa len sprístupní čip.
    if (photorealRetryFailure) {
      const retryToast = (key, params, durationMs) => {
        try { styleManager._showToast(t(key, params), { durationMs, tone: 'info' }); } catch { /* UI bez toastu */ }
      };
      const setRetryReason = (reason) => {
        mapStackController.setPhotorealUnavailableReason(reason);
        styleManager.refreshMapStackChips?.();
      };
      void whenStartupReady().then(() => {
        if (!mapStackController.googleTileset && mapStackController.getActiveId() === PHOTOREAL_FALLBACK_STACK) {
          retryToast('mapstack.photoreal-busy-toast', {}, 7000);
        }
      });
      window.__godsEyeView.photorealRetry = schedulePhotorealRetry({
        failure: photorealRetryFailure,
        load: (paths, last) => createPhotorealTileset({
          hasGoogleKey: !!googleApiKey,
          hasIonToken: !!cesiumToken && paths.ion,
          priorGoogleError: paths.google ? null : (last?.googleError ?? null),
          tilesetOptions: photorealTilesetOptions({ lowMemory }),
        }),
        onWait: ({ delayMs }) => setRetryReason(t('mapstack.photoreal-busy', { time: retryClockLabel(Date.now(), delayMs) })),
        onSuccess: ({ tileset: late, source }, attempts) => {
          try {
            tileset = late;
            photorealSource = source;
            photorealUnavailableReason = null;
            late.show = false; // ukáže ho radič pri prepnutí na fotoreál
            viewer.scene.primitives.add(late, 0); // pod ostatné primitíva, ako pri štarte
            mapStackController.setPhotorealTileset(late, { source });
            farGlobe.destroy?.();
            farGlobe = installFar(late);
            window.__godsEyeView.tileset = late;
            window.__godsEyeView.farGlobe = farGlobe;
            styleManager.refreshMapStackChips?.();
            console.info(`[Init] Google 3D Tiles loaded on retry ${attempts} via ${source}`);
            const back = shouldReturnToPhotoreal({
              activeId: mapStackController.getActiveId(),
              switchGeneration: mapStackController.getSwitchGeneration(),
              fallbackGeneration: fallbackSwitchGeneration,
            });
            if (back) {
              void Promise.resolve(styleManager._setMapStack('photoreal')).catch(() => {});
              retryToast('mapstack.photoreal-back', {}, 4000);
            } else {
              retryToast('mapstack.photoreal-available', {}, 6000);
            }
          } catch (error) {
            console.warn('[Init] Google 3D Tiles retry: could not adopt the tileset', error);
          }
        },
        onGiveUp: (error, attempts) => {
          console.warn('[Init] Google 3D Tiles: retries over, staying on the fallback map', error);
          setRetryReason(photorealRetryPaths(error) ? t('mapstack.photoreal-busy-gave-up', { attempts }) : photorealReason(error));
          retryToast('mapstack.photoreal-gave-up-toast', {}, 6000);
        },
      });
    }

    // Oil prices also live in the DATA tab (independent of any scene — the price
    // is a global macro figure, not something specific to one strait). Lazy-loads
    // the first time the "CRUDE OIL / ROPA" panel is expanded.
    const oilPricePanel = createOilPricePanel();
    window.__godsEyeView.oilPricePanel = oilPricePanel;
    // Country borders (Natural Earth, public domain): political context drawn on
    // the globe with a chokepoint/strike reveal — a standalone overlay, on with
    // any scene, off outside one.
    const countryBoundaries = createCountryBoundaries({ viewer });
    window.__godsEyeView.countryBoundaries = countryBoundaries;
    // Geometria hraníc sa postaví vopred (priehľadná), nie až pri prvom zapnutí: meranie 2026-10-16 —
    // po pristátí preletu chýbali ~35 s, kým sa úlohy vo workeroch dostali za dekódovanie dlaždíc.
    // Na telefóne hneď (prelet pristane pod 5 000 km), na počítači až po skrytí preloadera (2026-10-31,
    // odľahčený štart: 0,4 MB hraníc súperilo s Cesiom; zo 7 000 km ich nevidno, kým sa nepriblíži).
    if (phoneStart) void countryBoundaries.prewarm();
    else void whenStartupReady().then(() => countryBoundaries.prewarm());
    // Názvy štátov (src/data/countryLabels.js, Natural Earth + Intl.DisplayNames) idú spolu s hranicami.
    const countryLabels = createCountryLabels({ scene: viewer.scene, lang: currentLanguage() });
    window.__godsEyeView.countryLabels = countryLabels;
    void countryLabels.load();
    // Domovská krajina podľa pripojenia (vlastník: „ak je IP napr. SK, treba trocha hranice zvýrazniť"):
    // jej hranice hrubšie a sýtejšie, jej názov svetlejší. Len ISO2 z /api/whereami, nič sa neukladá.
    void geoPromise.then((geo) => {
      const home = /^[A-Z]{2}$/.test(geo?.country || '') ? geo.country : null;
      if (!home) return;
      countryBoundaries.highlight(home);
      countryLabels.setHome(home);
    });
    // Hranice pri priblížení (2026-10-16, vlastník: „keď zapriblíži kamera ku miestu, aby sa objavili hranice
    // štátu … nevidno, kde je napr. Slovensko"): držiteľ 'zoom' pod 5 000 km nad fotoreálom a Bing leteckým
    // (src/data/zoomBorders.js); podklady s vlastnými hranicami (OSM, Stadia, KARTA) ho nepotrebujú.
    window.__godsEyeView.zoomBorders = installZoomBorders({ scene: viewer.scene, boundaries: countryBoundaries, labels: countryLabels, getStackId: () => mapStackController.getActiveId() });
    window.__godsEyeView.farGlobe = farGlobe; // Zem z výšky — inštalovaná hneď po radiči (viď vyššie)
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
    // Scény konfliktov — úžiny, UKRAJINA, BLÍZKY VÝCHOD, kartičky (src/conflictScenes.js) — až keď ich niekto
    // chce (src/conflictScenesLazy.js, 2026-10-31): otvorenie panela UKRAJINA / BLÍZKY VÝCHOD (aj z výsuvu
    // a z odkazu), výber v paneli Prelety kamerou, konflikt v hľadaní, odkaz ?front= / ?chokepoint= / ?mideast=,
    // nástroje vlastníka. Modul dostane hotový glóbus a hranice; window.__godsEyeView doplní sám.
    const conflictScenes = createConflictScenesGate({
      getDeps: () => ({ viewer, styleManager, dataManager, mapStackController, countryBoundaries, aisLiveVesselsLayer, aishubVesselsLayer, gfwSarDetectionsLayer }),
      translate: t,
      onLoaded: () => { try { leftLane.fitOpen(); } catch { /* ľavý stĺpec je voliteľný */ } },
    });
    window.__godsEyeView.conflictScenes = conflictScenes;
    // Window API scén pred dotiahnutím: list z katalógu, apply dotiahne modul a scénu spustí (modul ich po
    // inicializácii nahradí svojimi).
    window.__godsEyeView.frontScenes = { list: listFrontScenes, apply: (id) => conflictScenes.run('front', id) };
    window.__godsEyeView.chokepointScenes = { list: listChokepointScenes, apply: (id) => conflictScenes.run('chokepoint', id) };
    window.__godsEyeView.mideastTheatres = { list: listMideastTheatres, apply: (id) => conflictScenes.run('mideast', id) };
    conflictScenes.install({ search: window.location?.search || '' });
    // Výbery v paneli SCÉNY (na dotyku záložka SCENES): úžiny, smery frontu a dejiská Blízkeho východu — popisky
    // podľa i18n pri štarte, výber dotiahne modul scén a scénu spustí; potom sa vráti na placeholder, aby sa tá
    // istá dala vybrať znova (pôvodne tri rovnaké bloky; chýbajúci výber štart nikdy nezhodí).
    const bindScenePicker = (pickerId, scenes, label, kind) => {
      try {
        const picker = document.getElementById(pickerId);
        if (!picker) return;
        for (const scene of scenes) {
          const option = document.createElement('option');
          option.value = scene.id;
          option.textContent = label(scene);
          picker.appendChild(option);
        }
        picker.addEventListener('change', () => {
          const id = picker.value;
          picker.value = '';
          if (id) void conflictScenes.run(kind, id);
        });
      } catch { /* výber je voliteľné chróm — bez neho štart nepadá */ }
    };
    bindScenePicker('chokepoint-select', listChokepointScenes(), chokepointSceneLabel, 'chokepoint');
    bindScenePicker('front-select', listFrontScenes(), frontSceneLabel, 'front');
    bindScenePicker('mideast-select', listMideastTheatres(), theatreLabel, 'mideast');

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
    let followedVessels = null;
    let pushNotifications = null;
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
    // Otvorenie panela VOĽBY (nastaví sa nižšie pri mape obcí) — paleta ho volá až po štarte.
    let openVolbyPanelRef = null;
    const buildCommands = () => {
      const cmds = [];
      try { cmds.push(...(followedFlights?.commands() || [])); } catch { /* sledované lety sú voliteľné */ }
      try { cmds.push(...(followedVessels?.commands() || [])); } catch { /* sledované lode sú voliteľné */ }
      try { const pc = pushNotifications?.command(); if (pc) cmds.push(pc); } catch { /* push je voliteľný */ }
      // Radar: len lode bez AIS (2026-10-11) — zapne radarovú vrstvu a nechá len detekcie bez zhody.
      try {
        const sar = dataManager.layers.get('gfw-sar')?.module;
        if (sar?.setDarkOnly) {
          const on = sar.isDarkOnly();
          cmds.push({
            id: 'sar:dark-only',
            label: t('cmd.sar.dark-only'),
            hint: t(on ? 'cmd.sar.dark-only.off' : 'cmd.sar.dark-only.on'),
            group: 'maritime',
            keywords: ['radar', 'sar', 'ais', 'dark', 'tmav', 'bez ais'],
            run: () => {
              if (!on && !dataManager.isEnabled('gfw-sar')) void dataManager.setEnabled('gfw-sar', true, { origin: 'user' });
              sar.setDarkOnly(!on);
            },
          });
        }
      } catch { /* radar je voliteľný */ }
      for (const c of listConflicts()) {
        cmds.push({ id: `scene:${c.id}`, label: conflictTitle(c, t), group: CONFLICT_GROUP[c.region] || 'ukraine', keywords: [c.region, c.name, c.sceneId || ''], run: () => { void conflictScenes.frame(c); } });
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
      cmds.push({ id: 'view:clean', label: t('cmd.action.clean'), group: 'view', keywords: ['čistá', 'clean', 'screenshot'], run: () => { void conflictScenes.load().then((m) => m.kartaOverlay?.setClean(!m.kartaOverlay.isClean())); } });
      // VOĽBY 2026 v archíve (2026-10-27): bez tlačidla v lište — panel otvára paleta (mobil cez výsuv).
      cmds.push({ id: 'view:volby', label: t('cmd.action.volby'), hint: t('cmd.action.volby.hint'), group: 'view', keywords: ['voľby', 'volby', 'výsledky', 'starosta', 'primátor', 'župa', 'elections', 'results'], run: () => { openVolbyPanelRef?.(); } });
      // Kartičky konfliktov sú nástroj vlastníka (2026-10-11) — v palete len s body.oko-owner, ako ich spúšťač v pruhu.
      if (document.body.classList.contains('oko-owner')) cmds.push({ id: 'view:conflicts', label: t('cmd.action.conflicts'), group: 'view', keywords: ['kartičky', 'export', 'cards'], run: () => { void conflictScenes.load().then((m) => m.conflictsPanel?.open()); } });
      return cmds;
    };
    // Jednotné hľadanie lietadla (2026-10-04): živé lietadlá z pamäte + celý svet zo servera.
    const aircraftSearch = createAircraftSearchCommands({
      flights: flightsLayer, military: militaryFlightsLayer, dataManager, viewer, Cesium, translate: t,
      notify: (text) => styleManager._showToast(text, { durationMs: 4500 }),
    });
    // Odhad polohy lodí mimo dosahu (2026-10-11, bod 4): zdieľaný kresliaci modul.
    attachVesselEstimateViewer(viewer);
    window.__godsEyeView.vesselEstimate = {
      showRemote: async (ship) => {
        const info = ship?.mmsi ? await lookupVesselInfo(ship.mmsi).catch(() => null) : null;
        // Cieľ z textu (WILMINGTON.NC.USA → USILM), keď ho register nedal s polohou.
        const index = info?.destination ? await loadVesselPortIndex().catch(() => null) : null;
        const destination = index ? matchDestinationPort(info.destination, index)?.port || null : null;
        return showRemoteVessel(ship, info, { translate: t, lang: currentLanguage(), destination });
      },
    };
    // Lode v jednotnom hľadaní (2026-10-11): živé z pamäte + kdekoľvek zo servera.
    const vesselSearch = createVesselSearchCommands({
      live: aisLiveVesselsLayer,
      delayed: [dataManager.layers.get('aishub-vessels')?.module, dataManager.layers.get('gfw-presence')?.module].filter(Boolean),
      dataManager, viewer, Cesium, translate: t,
      notify: (text) => styleManager._showToast(text, { durationMs: 5000 }),
      onRemoteShip: (ship) => window.__godsEyeView.vesselEstimate?.showRemote?.(ship),
    });
    window.__godsEyeView.vesselSearch = vesselSearch;
    // Hlboký odkaz na loď (2026-10-11): /?ship=<MMSI> — z push upozornenia; po obnove pohľadu a načítaní vrstiev.
    try {
      const ship = new URLSearchParams(window.location?.search || '').get('ship');
      if (/^\d{9}$/.test(ship || '')) {
        void Promise.resolve(styleManager.initialRestorePromise).catch(() => {}).then(() => {
          setTimeout(() => {
            void vesselSearch.openByMmsi(ship).then((found) => {
              // Loď mimo pôvodného výrezu: po dolete sa živá vrstva načíta — skús vybrať živý záznam (karta, zvonček).
              if (!found) setTimeout(() => { try { aisLiveVesselsLayer.selectByMmsi?.(ship); } catch { /* ostane značka z registra */ } }, 12_000);
            });
          }, 8_000);
        });
      }
    } catch { /* bez odkazu */ }
    // Sledované lode (2026-10-11, bod 6): zvonček vedľa krížika na karte lode, zoznam k účtu
    // (ten istý ako lety), navrchu v hľadaní, toast pri vyplávaní/priplávaní.
    try {
      if (accountCenter) {
        const layerModule = (id) => dataManager.layers.get(id)?.module;
        followedVessels = createFollowedVessels({
          account: accountCenter,
          translate: t,
          notify: (text) => styleManager._showToast(text, { durationMs: 6000 }),
          findLive: (mmsi) => aisLiveVesselsLayer.getLiveContact?.(mmsi) || null,
          // Lode sú predvolene vypnuté (2026-10-16, d421beb): bez vrstvy findLive nič nevie a toasty by
          // čakali na register (15 min). Živý stav dá server (/api/ais-live/contact, zdroj Web Push),
          // raz za 5 min na loď; vrstva lodí ostáva vypnutá.
          fetchLive: (mmsi) => fetchVesselLiveContact(mmsi),
          liveAllowed: () => document.visibilityState !== 'hidden',
          fetchInfo: (mmsi) => lookupVesselInfo(mmsi),
          openVessel: (mmsi, label) => { void vesselSearch.openByMmsi(mmsi, label); },
        });
        installVesselFollowButtons(viewer, {
          container: document.body,
          followed: followedVessels,
          // Zdieľanie lode (2026-10-11, bod 6): panel zdieľania; odkaz nesie vybranú loď (shareSubject).
          onShare: () => { void styleManager._openSharePanel?.(); },
          // História lode (bod 7): tlačidlo vedľa zvončeka otvorí kartu LODE v paneli História.
          onHistory: ({ mmsi, name }) => {
            for (const id of ['ais-live-vessels', 'aishub-vessels', 'gfw-presence']) {
              try { dataManager.layers.get(id)?.module?.clearSelection?.(); } catch { /* */ }
            }
            void styleManager._shipHistoryPanel?.open(mmsi, name);
          },
          translate: t,
          paintRect: getOverlayPaintRect,
          providers: [
            { id: 'live', active: () => {
              const info = aisLiveVesselsLayer.getSelectedInfo?.();
              // Loď z oceánu („mt-…"): zvonček a história až so zisteným MMSI.
              return info?.mmsi ? { sourceId: VESSEL_OVERLAY_SOURCE_ID, entryId: `vessel:${info.mmsi}`, mmsi: realMmsiFor(info.mmsi) || String(info.mmsi), name: info.name } : null;
            } },
            { id: 'aishub', active: () => {
              const m = layerModule('aishub-vessels');
              const mmsi = m?.getSelectedMmsi?.();
              return mmsi ? { sourceId: 'aishub-vessels', entryId: `aishub:${mmsi}`, mmsi: String(mmsi), name: m.getSelectedName?.() } : null;
            } },
            { id: 'gfw', active: () => {
              const m = layerModule('gfw-presence');
              const mmsi = m?.getSelectedMmsi?.();
              return mmsi ? { sourceId: 'gfw-presence', entryId: `gfw:${mmsi}`, mmsi: String(mmsi), name: m.getSelectedName?.() } : null;
            } },
          ],
        });
        window.__godsEyeView.followedVessels = followedVessels;
        // Upozornenia aj so zatvorenou stránkou (2026-10-11): Web Push k účtu, prepínač v hľadaní.
        pushNotifications = createPushNotifications({ client: accountCenter.client, translate: t, notify: (text) => styleManager._showToast(text, { durationMs: 6000 }) });
        window.__godsEyeView.pushNotifications = pushNotifications;
      }
    } catch (error) { console.warn('[follow] followed vessels unavailable:', error?.message || error); }
    const commandPalette = createCommandPalette({
      translate: t,
      getCommands: buildCommands,
      getQueryCommands: (q) => [...aircraftSearch.queryCommands(q), ...vesselSearch.queryCommands(q)],
      getAsyncResults: async (q) => {
        const [aircraft, vessels] = await Promise.all([
          aircraftSearch.asyncResults(q).catch(() => []),
          vesselSearch.asyncResults(q).catch(() => []),
        ]);
        return [...aircraft, ...vessels];
      },
      asyncGroup: 'aircraft-world',
      // Poradie (2026-09-27, vlastník o lupe: „toto tlačidlo patrí Ukrajine" — prázdne hľadanie
      // začínalo 12 smermi frontu): zobrazenie → vrstvy (podľa témy) → konflikty (podľa regiónu).
      // Sledované lety prihláseného (09-27) úplne navrchu — sú to jeho vlastné položky.
      // Lietadlá (živé, potom celý svet) idú hneď za sledované lety — to je to, čo človek píše najčastejšie.
      groupOrder: ['follows', 'aircraft', 'aircraft-world', 'vessels', 'vessels-world', 'view', ...LAYER_GROUP_ORDER, 'ukraine', 'maritime', 'mideast'],
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
    // VOĽBY 2026 (2026-10-24): mapa obcí → panel (klik na bod otvorí obec bez ďalšieho preletu) a odkazy
    // `?volby`, `?volby=<kód obce>`, `?volby=k<kraj>` (okolive.sk/?volby=582000): panel a mapa hneď po obnove
    // stavu, výber obce/kraja až po úvodnom prelete (ten už mieri na miesto — locate vyššie), najneskôr po strope.
    const openVolbyPanel = () => {
      if (!window.__okoMobileShell?.open?.('volby')) styleManager.setPanelCollapsed('volby-panel', false, { explicit: true, persist: false, syncShare: false });
      void dataManager.setEnabled('volby-obce', true, { origin: 'user' });
    };
    openVolbyPanelRef = openVolbyPanel;
    // Archív (2026-10-27): skryje tlačidlo VOĽBY v mobilnej lište a nadpis zóny (style.css body.oko-volby-archived);
    // stránka otvorená cez polnoc sa prepne sama.
    const syncVolbyArchive = () => document.body.classList.toggle('oko-volby-archived', isVolbyArchived(Date.now()));
    syncVolbyArchive();
    const untilArchive = VOLBY_ARCHIVE_MS - Date.now();
    if (untilArchive > 0 && untilArchive < 7 * 86_400_000) setTimeout(syncVolbyArchive, untilArchive + 1000);
    volbyObceLayer.onSelect = (code) => {
      if (!code) return;
      if (!window.__okoMobileShell?.open?.('volby')) styleManager.setPanelCollapsed('volby-panel', false, { explicit: true, persist: false, syncShare: false });
      void styleManager._volbyPanel?.selectObec?.(code, { fly: false });
    };
    // Volebný režim mapy (2026-10-24): kým je panel VOĽBY otvorený, tmavý podklad, hranice krajov a obcí, bez
    // lietadiel a lodí; po zatvorení sa vráti pôvodná mapa a vrstvy (src/volbyMapMode.js).
    const volbyMapMode = createVolbyMapMode({
      viewer,
      getStack: () => mapStackController.getActiveId(),
      setStack: (id) => styleManager._setMapStack(id, { syncShare: false }),
      // „zapína sa" = zapnutá: obnova odkazu práve vrstvu zapína a po nej by ostala viditeľná
      isLayerOn: (id) => { const e = dataManager.layers.get(id); return Boolean(e?.enabled || e?.lifecycleState === 'enabling'); },
      setLayer: (id, on) => dataManager.setEnabled(id, on, { origin: 'user' }),
    });
    volbyMapMode.observe(document.getElementById('volby-panel'));
    window.__godsEyeView.volbyMapMode = volbyMapMode;
    styleManager._volbyPanel?.attachMap?.({
      isOn: () => Boolean(dataManager.layers.get('volby-obce')?.enabled),
      setOn: (on) => dataManager.setEnabled('volby-obce', on, { origin: 'user' }),
      highlight: (code) => volbyObceLayer.select(code),
      setColorMode: (mode) => volbyObceLayer.setColorMode?.(mode),
    });
    try {
      const requestedVolby = parseVolbyParam(window.location?.search || '');
      if (requestedVolby) {
        const startDone = styleManager.hasShareState
          ? Promise.resolve()
          : Promise.race([startSettled, new Promise((resolve) => setTimeout(resolve, START_GLOBE_DWELL_MS + START_FLY_DURATION_S * 1000 + 8000))]);
        void Promise.resolve(styleManager.initialRestorePromise)
          .catch(() => {})
          .then(() => {
            if (!window.__okoMobileShell?.open?.('volby')) {
              styleManager.setPanelCollapsed('volby-panel', false, { explicit: true, persist: false, syncShare: false });
            }
            void dataManager.setEnabled('volby-obce', true, { origin: 'link' });
            return startDone;
          })
          .then(() => styleManager._volbyPanel?.open?.(requestedVolby));
      }
    } catch { /* zlý parameter nikdy nezhodí štart */ }

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
// Nástroje vlastníka (2026-10-11, preusporiadanie rozhrania): réžia scén, kalibrácia kamier, kartičky
// konfliktov a udalosti na kontrolu majú triedu .oko-owner-only a vidí ich len prihlásený vlastník
// (rola owner) — alebo tento počítač (localhost), kde vlastník pracuje bez prihlásenia.
try {
  const localDev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const syncOwner = (state) => document.body.classList.toggle('oko-owner', localDev || state?.user?.role === 'owner');
  if (accountCenter?.client?.subscribe) accountCenter.client.subscribe(syncOwner); else syncOwner(null);
} catch { /* bez účtov ostanú nástroje vlastníka skryté */ }
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
