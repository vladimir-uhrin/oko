// src/conflictScenes.js — scény konfliktov: úžiny, UKRAJINA (front, KARTA, časová os), BLÍZKY VÝCHOD
// (dejiská, kontrola sídiel, EASA, UKMTO, GPS), kartičky konfliktov a ich export.
//
// Presunuté z main.js bez zmeny správania (2026-10-31, lenivý štart): tento kód (~400 KB so všetkými
// vrstvami) nikto pri štarte nepotrebuje — otvára sa z panelov UKRAJINA a BLÍZKY VÝCHOD, výberov v paneli
// Prelety kamerou, hľadania, odkazov ?front= / ?chokepoint= / ?mideast= a nástrojov vlastníka. main.js
// drží len lenivú bránu (conflictScenesLazy.js), ktorá modul dotiahne pri prvom z týchto podnetov a zavolá
// initConflictScenes(deps). Hranice štátov (countryBoundaries) a panel ROPA ostali v main.js, lebo žijú
// od štartu; zdieľajú sa cez deps.
//
// Komentáre a poradie sú z main.js — testy ich pinujú regexom (predtým čítali main.js).
import * as Cesium from 'cesium';
import { currentLanguage, t } from './i18n.js';
import { trackEvent } from './analytics.js';
import { getActiveMapStack, onActiveMapStackChange } from './data/activeMapStack.js';
import { applyChokepointScene, chokepointSceneById, chokepointSceneFacts, chokepointSceneLabel, listChokepointScenes } from './chokepointScenes.js';
import { createOilPriceChip } from './oilPriceChip.js';
import { createStraitTrafficChip } from './straitTrafficChip.js';
import { createIncidentCards } from './gulfIncidentCards.js';
import { createSceneRevealGate } from './sceneRevealGate.js';
import { createMapScaleBar } from './mapScaleBar.js';
import { createConflictBulletin } from './conflictBulletin.js';
import { applyFrontScene, frontSceneById, frontSceneFraming, frontSceneLabel, listFrontScenes } from './ukraineFrontScenes.js';
import { MIDEAST_BULLETIN_REGIONS, applyMideastTheatre, listMideastTheatres, theatreById, theatreFraming, theatreLabel } from './data/mideastTheatres.js';
import { createMideastPanel } from './mideastPanel.js';
import { createMideastControl } from './mideastControlLayer.js';
import { createAirspaceAdvisory } from './airspaceAdvisoryLayer.js';
import { createUkmtoIncidents } from './ukmtoIncidentsLayer.js';
import { createMideastIncidents } from './mideastIncidentsLayer.js';
import { createMideastAlerts } from './mideastAlertsLayer.js';
import { createMideastHumanitarian, createMideastInternet } from './mideastIndicators.js';
import { createGpsInterference } from './gpsInterferenceLayer.js';
import { UKMTO_CHOKEPOINT_SCENES } from './data/ukmto.js';
import { createPortwatchCard } from './portwatchCard.js';
import { PORTWATCH_KEYS, portwatchKeyForTheatre } from './data/portwatch.js';
import { createUkraineKartaOverlay } from './ukraineKartaOverlay.js';
import { CARD_RATIO_IDS, captureConflictCard, conflictCardFilename, conflictCardModel, defaultConflictFacts, downloadCardSnapshot } from './conflictExport.js';
import { conflictById, conflictTitle, listConflicts } from './data/conflictsCatalog.js';
import { createConflictsPanel } from './conflictsPanel.js';
import { buildConflictDigest, buildMideastDigest } from './conflictSummary.js';
import { fetchMideastIncidentSummary, incidentPeriodRange } from './data/mideastIncidents.js';
import { alertPeriodRange, fetchMideastAlerts } from './data/mideastAlerts.js';
import { fetchMideastHumanitarian } from './data/mideastHumanitarian.js';
import { fetchMideastInternet } from './data/mideastInternet.js';
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

/**
 * Postaví všetky scény konfliktov nad hotovým glóbusom. Volá sa raz, z lenivej brány.
 * @param {object} deps
 * @param {import('cesium').Viewer} deps.viewer
 * @param {object} deps.styleManager ui.js StyleManager (podklad, panely, toasty, prekážky pruhov)
 * @param {object} deps.dataManager správca vrstiev
 * @param {object} deps.mapStackController radič podkladu
 * @param {object} deps.countryBoundaries hranice štátov (držitelia 'ukraine-base', 'mideast-theatre', show())
 * @param {object} deps.aisLiveVesselsLayer živé lode (čip premávky v úžine)
 * @param {object} deps.aishubVesselsLayer oneskorené lode
 * @param {object} deps.gfwSarDetectionsLayer radarové detekcie
 * @returns {{runFrontScene: Function, runChokepointScene: Function, runMideastTheatre: Function,
 *   frameConflict: Function, exportConflict: Function, exitUkraine: Function, kartaOverlay: object,
 *   conflictsPanel: object, revealGate: object, ukraineTimeline: object}}
 */
export function initConflictScenes(deps) {
  const { viewer, styleManager, dataManager, mapStackController, countryBoundaries, aisLiveVesselsLayer, aishubVesselsLayer, gfwSarDetectionsLayer } = deps;
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
    // Klik na „bez AIS: N" v čipe → na mape ostanú len radarové detekcie bez AIS (2026-10-11).
    onDarkClick: () => {
      if (!dataManager.isEnabled('gfw-sar')) void dataManager.setEnabled('gfw-sar', true, { origin: 'user' });
      gfwSarDetectionsLayer.setDarkOnly?.(true);
    },
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
  let mideastIncidents = null; // OVERENÉ UDALOSTI (BLÍZKY VÝCHOD etapa 4) — vzniká nižšie, brána ju už pozná
  let mideastAlerts = null; // POPLACHY · Izrael (BLÍZKY VÝCHOD etapa 6) — vzniká nižšie, brána ju už pozná
  let mideastHumanitarian = null; // HUMANITÁRNE SÚČTY (etapa 6, bez mapy)
  let mideastInternet = null; // INTERNET · OONI (etapa 6, bez mapy)
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
      // OVERENÉ UDALOSTI (GeoConfirmed + UCDP): body len pri pohľade na dejisko, čip ostáva.
      if (visible) void mideastIncidents?.show(); else void mideastIncidents?.hide();
      // POPLACHY · Izrael (etapa 6): polygóny len pri pohľade na dejisko, čip ostáva.
      if (visible) void mideastAlerts?.show(); else void mideastAlerts?.hide();
      scenePinDs.show = visible;
      viewer.scene?.requestRender?.();
    },
  });
  window.__godsEyeView.sceneRevealGate = revealGate;
  // Mierka v km — len v režime mapy.
  const mapScaleBar = createMapScaleBar({ viewer, lang: () => currentLanguage() });
  window.__godsEyeView.mapScaleBar = mapScaleBar;

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
  // OVERENÉ UDALOSTI (2026-11-05, etapa 4; src/mideastIncidentsLayer.js): údery, zásahy a poškodenia
  // z GeoConfirmed a UCDP Candidate. Čip predvolene zapnutý; sťahuje a kreslí až pri dejisku BLÍZKEHO
  // VÝCHODU (setActive nižšie dostane celé dejisko — počty v legende sa rátajú v ňom) a schováva sa s bránou.
  mideastIncidents = createMideastIncidents({ viewer });
  window.__godsEyeView.mideastIncidents = mideastIncidents;
  // Etapa 6 (2026-11-06): POPLACHY · Izrael (src/mideastAlertsLayer.js) — polygóny oblastí HFC
  // z verejného mirroru histórie, nikdy „živý alarm"; aktívne len pri dejiskách Izraela, Gazy,
  // Západného brehu a južného Libanonu (ALERT_THEATRES), schováva sa s bránou. HUMANITÁRNE SÚČTY
  // a INTERNET · OONI (src/mideastIndicators.js) nemajú mapu — kreslí ich len panel.
  mideastAlerts = createMideastAlerts({ viewer });
  window.__godsEyeView.mideastAlerts = mideastAlerts;
  mideastHumanitarian = createMideastHumanitarian();
  window.__godsEyeView.mideastHumanitarian = mideastHumanitarian;
  mideastInternet = createMideastInternet();
  window.__godsEyeView.mideastInternet = mideastInternet;
  const mideastPanel = createMideastPanel({
    mountTarget: document.querySelector('#mideast-panel [data-mideast-body]'),
    theatres: listMideastTheatres(),
    applyTheatre: (id) => runMideastTheatre(id),
    control: mideastControl,
    airspace: airspaceAdvisory,
    ukmto: ukmtoIncidents,
    gps: gpsInterference,
    incidents: mideastIncidents,
    alerts: mideastAlerts,
    humanitarian: mideastHumanitarian,
    internet: mideastInternet,
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
      const fileName = conflictCardFilename(c, ratio, new Date().toISOString());
      downloadCardSnapshot(snap, fileName);
      // Spätná väzba (QA 2026-10-11): Snímka/Kartička sťahovali PNG bez akéhokoľvek znamenia v rozhraní.
      try { styleManager._showToast?.(t('conflicts.exported', { file: fileName }), { durationMs: 4500 }); } catch { /* */ }
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
      kartaOverlay?.setSuspended?.(false);
      mideastPanel?.setActiveTheatre?.(null);
      void mideastControl.setTheatre(null);
      void ukmtoIncidents?.setActive(false);
      void mideastIncidents?.setActive(false);
      void mideastAlerts?.setActive(false); void mideastHumanitarian?.setActive(null); void mideastInternet?.setActive(null);
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
    // Ikona Material Symbols (trieda material-symbols-outlined kreslí conflictsPanel.js); zber do výrezu písma:
    // scripts/lib/iconFont.mjs hľadá launchIcon: v súboroch, ktoré triedu spomínajú.
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
        // Etapa 7 (2026-11-06): denný sumár Blízkeho východu z archívu modulu — udalosti za 7 dní (celý
        // región), poplachy za 30 dní (posledný deň s poplachom), súčty obetí, internet. Každý zdroj zvlášť,
        // výpadok jedného riadok len vynechá.
        const now = Date.now();
        const inc = incidentPeriodRange('7d', now);
        const al = alertPeriodRange('30d', now);
        const [rep, oil, gulf, meInc, meAl, meHum, meNet] = await Promise.allSettled([
          fetchUkraineReport(), fetchOilPrices(), fetchSituationNews('gulf'),
          fetchMideastIncidentSummary({ from: inc.from, to: inc.to }), fetchMideastAlerts({ from: al.from, to: al.to }), fetchMideastHumanitarian(), fetchMideastInternet(),
        ]);
        const report = rep.status === 'fulfilled' ? rep.value : null;
        const oilModel = oil.status === 'fulfilled' ? buildOilModel(oil.value, { lang, translate: t }) : null;
        const gulfCount = gulf.status === 'fulfilled' ? buildSituationModel(gulf.value, { translate: t, limit: 200 }).count : null;
        const value = (r) => (r.status === 'fulfilled' ? r.value : null);
        const mideast = buildMideastDigest({ incidents: value(meInc), alerts: value(meAl), humanitarian: value(meHum), internet: value(meNet), translate: t, nowMs: now, lang });
        return buildConflictDigest({ report, oilModel, gulfCount, mideast, translate: t, dateText: report?.reportedAtText || today }).text;
      } catch (error) { console.warn('[conflict] digest failed:', error?.message || error); return null; }
    },
  });
  window.__godsEyeView.conflictsPanel = conflictsPanel;

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
  const restoreAutoKarta = ({ notify = false } = {}) => {
    const prev = autoKartaPrev; autoKartaPrev = null;
    if (prev && mapStackController.getActiveId() === 'karta') {
      try { void Promise.resolve(styleManager._setMapStack(prev)).catch(() => {}); } catch { /* */ }
      // QA 2026-10-11: × na osi vrátilo podklad bez slova — používateľ nevedel, prečo sa mapa zmenila.
      if (notify) { try { styleManager._showToast?.(t('ukraine.karta.restored'), { durationMs: 4000 }); } catch { /* */ } }
    }
  };
  onActiveMapStackChange((stack) => { if (stack?.id !== 'karta') autoKartaPrev = null; });
  // Zatvorená časová os = odchod zo smeru.
  ukraineTimeline.onChange((st) => { if (!st?.shown && autoKartaPrev) restoreAutoKarta({ notify: true }); });
  // Návrat z UKRAJINY (2026-10-10, vlastník: „keď zapnem Ukrajinu neviem ako ju vypnúť"):
  // pred prvým smerom si zapamätáme kameru a vrstvy, ktoré scéna vypne.
  let frontReturnPose = null;
  let frontDisabledLayerIds = [];
  const captureFrontReturnPose = () => {
    const camera = viewer?.camera;
    const c = camera?.positionCartographic;
    if (!c || !Number.isFinite(c.latitude)) return null;
    return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), height: c.height, heading: camera.heading, pitch: camera.pitch };
  };
  /**
   * Vypne celý modul UKRAJINA: smer, podklad (s ním hlásenie a plochy), kontrolu
   * sídiel, DeepState, udalosti s časovou osou, škody a poplachy; vráti podklad
   * mapy spred KARTY, vrstvy, ktoré smer vypol, a kameru spred prvého smeru.
   */
  const exitUkraine = () => {
    const hadScene = Boolean(activeFrontScene);
    activeFrontScene = null;
    kartaOverlay?.setScene?.(null);
    ukrainePanel?.setActiveScene?.(null);
    ukraineTimeline.setActiveScene(null);
    try { ukraineTimeline.hide(); } catch { /* */ }
    for (const part of [ukraineControl, ukraineDeepState, ukraineDamage, ukraineAlerts, ukraineEvents, ukraineBase]) {
      try { part?.hide?.(); } catch { /* ďalšia časť */ }
    }
    restoreAutoKarta();
    if (!activeChokepoint && !activeTheatre) revealGate.deactivate();
    syncMapFocus();
    for (const layerId of frontDisabledLayerIds) { try { dataManager.setEnabled(layerId, true); } catch { /* */ } }
    frontDisabledLayerIds = [];
    const pose = frontReturnPose;
    frontReturnPose = null;
    if (hadScene && pose && viewer?.camera?.flyTo) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pose.lon, pose.lat, pose.height),
        orientation: { heading: pose.heading, pitch: pose.pitch, roll: 0 },
        duration: 2.5,
      });
    }
    trackEvent('scene_close', { scene_type: 'front' });
  };
  const runFrontScene = (id) => {
    const scene = frontSceneById(id);
    if (scene) trackEvent('scene_open', { scene_type: 'front', scene_id: String(id) });
    if (scene && !activeFrontScene) frontReturnPose = captureFrontReturnPose();
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
    void mideastIncidents?.setActive(false);
    void mideastAlerts?.setActive(false); void mideastHumanitarian?.setActive(null); void mideastInternet?.setActive(null);
    portwatchCard?.setActive?.(null);
    kartaOverlay?.setScene(scene || null);
    kartaOverlay?.setSuspended?.(false); // smer frontu = rám KARTY Ukrajiny patrí sem
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
    return applyFrontScene(id, frontSceneDeps).then((result) => {
      for (const layerId of result?.disabledLayerIds || []) if (!frontDisabledLayerIds.includes(layerId)) frontDisabledLayerIds.push(layerId);
      return result;
    });
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
    onExit: () => exitUkraine(),
  });
  window.__godsEyeView.ukrainePanel = ukrainePanel;
  window.__godsEyeView.exitUkraine = exitUkraine;
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
  const runChokepointScene = (id) => {
    restoreAutoKarta();
    const scene = chokepointSceneById(id);
    if (scene) trackEvent('scene_open', { scene_type: 'chokepoint', scene_id: String(id) });
    activeChokepoint = scene || null;
    activeFrontScene = null;
    activeTheatre = null;
    kartaOverlay?.setSuspended?.(false);
    mideastPanel?.setActiveTheatre?.(null);
    void mideastControl.setTheatre(null); // odchod z dejiska schová jeho kontrolu sídiel
    // Scéna úžiny s údajmi PortWatch (hormuz, bab-el-mandeb, suez) zvýrazní svoj riadok karty.
    portwatchCard?.setActive?.(PORTWATCH_KEYS.includes(scene?.id) ? scene.id : null);
    // Varovania UKMTO pri úžinách v jeho oblasti hlásení (Hormuz, Báb al-Mandab, Suez); inde nie.
    void ukmtoIncidents?.setActive(UKMTO_CHOKEPOINT_SCENES.includes(scene?.id));
    void mideastIncidents?.setActive(false); // overené udalosti patria dejiskám, nie úžinám
    void mideastAlerts?.setActive(false); void mideastHumanitarian?.setActive(null); void mideastInternet?.setActive(null);
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
    const scene = theatreById(id);
    // Etapa 7 (2026-11-06): pozemné dejiská so sídlami (`scene.karta` — južný Libanon, Gaza, Západný breh,
    // Jemen, južná Sýria) sa otvárajú v KARTE ako smer frontu: plochy kontroly sídiel a polygóny poplachov
    // čítajú na reliéfe; predchádzajúci podklad sa pamätá a vráti pri odchode (iné dejisko bez KARTY, úžina,
    // front, všeobecný rám). Medzi dvoma dejiskami KARTY sa podklad neprepína tam a späť.
    if (scene?.karta) {
      if (mapStackController.getActiveId() !== 'karta') {
        autoKartaPrev = mapStackController.getActiveId();
        try { void Promise.resolve(styleManager._setMapStack('karta')).catch(() => {}); } catch { /* */ }
      }
    } else {
      restoreAutoKarta(); // odchod z KARTY frontu alebo dejiska, rovnako ako pri úžinách
    }
    if (scene) trackEvent('scene_open', { scene_type: 'mideast', scene_id: String(id) });
    activeTheatre = scene || null;
    activeFrontScene = null;
    activeChokepoint = null;
    kartaOverlay?.setScene?.(null);
    // Rám KARTY je ukrajinský (mapka Ukrajiny, legenda strán) — pri dejisku Blízkeho východu v KARTE
    // sa pozastaví (etapa 7, nález zo snímky: nad Gazou visela mapka Ukrajiny).
    kartaOverlay?.setSuspended?.(Boolean(scene));
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
    // OVERENÉ UDALOSTI (etapa 4): pri každom dejisku; legenda počíta v rámci dejiska.
    void mideastIncidents?.setActive(scene || false);
    // Etapa 6: poplachy len pri dejiskách Izraela a okolia (vrstva si to stráži sama), súčty a
    // internet podľa dejiska (ukazovatele si tiež strážia, či dejisko má krajinu/súhrn).
    void mideastAlerts?.setActive(scene || false);
    void mideastHumanitarian?.setActive(scene || null);
    void mideastInternet?.setActive(scene || null);
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

  return {
    runFrontScene, runChokepointScene, runMideastTheatre, frameConflict, exportConflict, exitUkraine,
    activeConflict, kartaOverlay, conflictsPanel, revealGate, ukraineTimeline, ukrainePanel, mideastPanel,
    listFrontScenes, listChokepointScenes, listMideastTheatres,
  };
}
