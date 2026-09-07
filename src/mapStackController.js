import * as Cesium from 'cesium';
import { t } from './i18n.js';
import { governorRequestRender } from './renderGovernor.js';
import { resolveKeylessTerrainUrl, SK_TERRAIN_CREDIT } from './data/skTerrain.js';
import { createNightLightsProvider, styleNightLightsLayer } from './nightLights.js';
import { lightingFadeFactor } from './globeLighting.js';
import { gibsImageryDay } from './gibsTime.js';
import { IMAGERY_ROLE, tagImageryRole } from './imageryOrder.js';
import { basemapContrastForStack } from './data/contactPalette.js';
import { applyPhotorealNight, buildPhotorealNightShader } from './photorealNight.js';

// Deň snímky žije v gibsTime.js (zdieľa ho aj data/gibsOverlays.js); tu sa
// re-exportuje, lebo testy a staršie importy ho čítajú odtiaľto.
export { gibsImageryDay };

export const MAP_STACKS = [
  {
    id: 'photoreal',
    label: 'Google 3D',
    shortLabel: '3D',
    kind: 'photoreal',
    requiresIon: false,
  },
  {
    id: 'bing-aerial',
    label: 'Bing Aerial',
    shortLabel: 'Aerial',
    kind: 'ion',
    style: Cesium.IonWorldImageryStyle.AERIAL,
    requiresIon: true,
  },
  {
    id: 'bing-labels',
    label: 'Bing Labels',
    shortLabel: 'Labels',
    kind: 'ion',
    style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
    requiresIon: true,
  },
  {
    id: 'osm',
    label: 'OSM',
    shortLabel: 'OSM',
    kind: 'osm',
    requiresIon: false,
    // Svetlý podklad: ikony kontaktov dostanú tmavú zapečenú výplň
    // (contactPalette.js). Satelit, fotoreál a tmavé mapy ostávajú 'dark'.
    contactContrast: 'light',
  },
  {
    id: 'stadia-dark',
    label: 'Stadia Dark',
    shortLabel: 'DARK',
    kind: 'xyz',
    requiresIon: false,
    // Tmavý podklad pre kontrast vzdušných kontaktov (2026-09-03). Pri
    // oddialenom pohľade sa flotila kreslí bodkami (airIconLod.js) a na
    // svetlej OSM mape sa biely bod stráca — presne to, čo FlightRadar24
    // rieši tmavou mapou. Alidade Smooth Dark má tlmenú paletu (nie čiernu),
    // takže mesta a pobrežia ostávajú čitateľné pod kontaktmi.
    //
    // KEYLESS LEN NA LOCALHOSTE: Stadia autorizuje cez Origin/Referer a ich
    // dokumentácia to hovorí doslova — „As long as you're running via a
    // development server accessed via localhost or 127.0.0.1, you don't need
    // an API key!" Náš dev server je na localhost viazaný (CLAUDE.md), takže
    // do prehliadača nejde žiadny kľúč a pravidlo 3 platí konštrukciou.
    // Bez Origin hlavičky vracia služba 401. Limity sú prísne; pri opakovanom
    // HTTP 429 treba bezplatný účet. PRI NASADENÍ MIMO LOCALHOST je nutná
    // doménová autorizácia na účte — NIE api_key v URL. Free tier pokrýva
    // vývoj, evaluáciu a nekomerčné použitie. Podmienky: DATA_SOURCES.md.
    xyz: {
      url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}@2x.png',
      // @2x dlaždica má 512 px, ale pokrýva PRESNE tú istú plochu Zeme ako
      // 256px verzia — je to retina rozlíšenie, nie väčší výrez. Deklarovať
      // ju ako 512 znamenalo, že Cesium celý obsah nakreslilo dvojnásobne
      // veľký: odtiaľ obrie názvy štátov cez pol kontinentu (2026-09-04).
      // Logická veľkosť je 256; obrázok má dvojnásobok pixelov, čo sa prejaví
      // ostrosťou, nie mierkou.
      tileSize: 256,
      maximumLevel: 20,
      // Popisy sú v raster dlaždici zapečené a vypnúť sa nedajú; Stadia nemá
      // tmavý variant bez nich (`_no_labels` vracia 404), CARTO ho má, ale
      // keyless dlaždica nesie vypálený nápis „API KEY REQUIRED". Stlmenie je
      // teda jediná čistá páka: názvy štátov ustúpia do pozadia, hranice a
      // pobrežia ostanú tušené a kontakty nad mapou vyniknú.
      adjust: { brightness: 0.45, contrast: 0.85 },
      credit: '© Stadia Maps © OpenMapTiles © OpenStreetMap contributors',
    },
  },
  // Ďalšie štýly Stadia (2026-09-06, „keď je platené tak nie"): rovnaký
  // keyless-na-localhoste režim, rovnaké podmienky (DATA_SOURCES.md), len iný
  // štýl v URL. Svetlé štýly nesú contactContrast 'light' (siluety kontaktov
  // tmavé ako na OSM) a žiadne stlmenie — popisy im neprekrikujú kontakty.
  // V lište sú JEDEN čip „Stadia" s radom variantov (mapStackChips.js).
  {
    id: 'stadia-smooth',
    label: 'Stadia Smooth',
    shortLabel: 'LIGHT',
    kind: 'xyz',
    requiresIon: false,
    contactContrast: 'light',
    xyz: {
      url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}@2x.png',
      tileSize: 256,
      maximumLevel: 20,
      credit: '© Stadia Maps © OpenMapTiles © OpenStreetMap contributors',
    },
  },
  {
    id: 'stadia-outdoors',
    label: 'Stadia Outdoors',
    shortLabel: 'OUTDOOR',
    kind: 'xyz',
    requiresIon: false,
    contactContrast: 'light',
    xyz: {
      url: 'https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}@2x.png',
      tileSize: 256,
      maximumLevel: 20,
      credit: '© Stadia Maps © OpenMapTiles © OpenStreetMap contributors',
    },
  },
  {
    id: 'stadia-terrain',
    label: 'Stamen Terrain',
    shortLabel: 'TERRAIN',
    kind: 'xyz',
    requiresIon: false,
    contactContrast: 'light',
    // Stamen štýly hostí Stadia; kredit musí menovať aj Stamen Design.
    xyz: {
      url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}@2x.png',
      tileSize: 256,
      maximumLevel: 18,
      credit: '© Stadia Maps © Stamen Design © OpenMapTiles © OpenStreetMap contributors',
    },
  },
  {
    id: 'gibs-truecolor',
    label: 'NASA GIBS',
    shortLabel: 'NASA',
    kind: 'xyz',
    requiresIon: false,
    // Denná globálna mozaika VIIRS (NOAA-20) v pravých farbách z NASA GIBS:
    // oblačnosť, dym, ľad a vír počasia presne tak, ako ich satelit videl
    // v deň snímky. Keyless, CORS, dáta NASA (DATA_SOURCES.md).
    //
    // POZOR NA PORADIE INDEXOV: GIBS je WMTS REST, teda
    // TileMatrix/TileRow/TileCol = z/y/x — NIE z/x/y ako bežné XYZ služby.
    // Prehodené indexy vrátia HTTP 200 s cudzou dlaždicou, takže sa to
    // neprejaví ako chyba, ale ako rozhádzaná mapa.
    //
    // Level 9 je maximum tejto vrstvy (~300 m/px); bližšie Cesium dlaždice
    // zväčšuje, čo je poctivejšie než ich nenájsť. Deň sa berie včerajší
    // (viď gibsImageryDay) — mozaika sa spracúva s odstupom.
    xyz: {
      url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${gibsImageryDay()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      tileSize: 256,
      maximumLevel: 9,
      credit: 'NASA EOSDIS GIBS / Worldview · VIIRS NOAA-20',
    },
  },
  {
    id: 'gibs-blue-marble',
    label: 'Blue Marble',
    shortLabel: 'MARBLE',
    kind: 'xyz',
    requiresIon: false,
    // Klasický Blue Marble (MODIS, 2004) so stieňovaným reliéfom a batymetriou
    // (2026-09-06, „urob 3"): bezoblačná, celistvá guľa bez dier — čistý
    // kartografický podklad tam, kde denná mozaika (gibs-truecolor) nesie
    // oblačnosť a včerajšie diery. STATICKÁ vrstva: v pozícii času ide
    // literál `default` (dátum vráti HTTP 400), preto tu NIE JE
    // gibsImageryDay(). WMTS REST z/y/x, Level 8 (~600 m/px) je maximum.
    // Kontrast: satelitná stredná tonalita → 'dark' (biele siluety), ako Bing.
    xyz: {
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
      tileSize: 256,
      maximumLevel: 8,
      credit: 'NASA EOSDIS GIBS / Worldview · Blue Marble (MODIS)',
    },
  },
  {
    id: 'aster-relief',
    label: 'ASTER GDEM',
    shortLabel: 'RELIEF',
    kind: 'xyz',
    requiresIon: false,
    // Výškopis vo farbe so stieňovaným reliéfom z ASTER GDEM (METI/NASA):
    // Level 12 (~40 m/px) — najbližšie, čo z GIBS na glóbus dostaneme, a
    // prirodzený súlad s terénnou Fázou 1b (DMR 3.5 nad SR). Rovnako statický
    // ako Blue Marble (čas `default`). Povinný kredit METI/NASA je v credit.
    xyz: {
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/ASTER_GDEM_Color_Shaded_Relief/default/default/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpeg',
      tileSize: 256,
      maximumLevel: 12,
      credit: 'NASA EOSDIS GIBS / Worldview · ASTER GDEM is a product of METI and NASA',
    },
  },
  {
    id: 'ugkk-ortofoto',
    label: 'ÚGKK Ortofoto SR',
    shortLabel: 'SK Orto',
    kind: 'wms',
    requiresIon: false,
    // Mozaika pokrýva len SR (rectangle nižšie) — bez podkladu by zvyšok
    // glóbusu bol prázdna čierna guľa. OSM pod ňou drží svet čitateľný
    // a provider sa zdieľa s OSM stackom (rovnaká cache).
    underlayStackId: 'osm',
    // Ortofotomozaika SR — keyless WMS od GKÚ Bratislava, CC BY 4.0 (licencia
    // deklarovaná v GetCapabilities AccessConstraints; DATA_SOURCES.md).
    // Vrstva '1' je čistá mozaika; '2'/'3' sú footprint/klad — nepridávať.
    // 512 px dlaždice a rectangle orezaný na SR šetria verejnú službu GKÚ —
    // mimo pokrytia mozaiky sa nesmie generovať žiadny request. QA/screenshot
    // slučky nad týmto stackom nepúšťať (docs/SK-NOTES.md).
    wms: {
      url: 'https://zbgisws.skgeodesy.sk/zbgis_ortofoto_wms/service.svc/get',
      layers: '1',
      rectangleDegrees: [16.83, 47.72, 22.58, 49.62],
      tileSize: 512,
      maximumLevel: 19,
      credit: 'Ortofotomozaika SR © GKÚ Bratislava, NLC (CC BY 4.0)',
    },
  },
];

const DEFAULT_OSM_CREDIT = '© OpenStreetMap contributors';

// Keyless global ellipsoidal terrain (Re:Earth Terrain / Mapterhorn, CC BY 4.0,
// EGM2008 geoid via NGA) — quantized-mesh 1.0, `ellipsoid` data-type. Fixes
// regime C (keyless globe stacks previously rendered a flat
// EllipsoidTerrainProvider — see the height-datum contract in docs/CURRENT-STATE.md
// §1a). Constructed via `.fromUrl()`, never a hand-built `{z}/{x}/{y}.terrain`
// URL (spec correction, spec §1a).
const REEARTH_TERRAIN_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';

/**
 * Controls the active globe/map stack. Google Photorealistic 3D Tiles remain
 * the cinematic default, while Cesium ion world imagery and OSM run as globe
 * imagery stacks.
 */
export class MapStackController {
  constructor(viewer, {
    googleTileset = null,
    // Odkiaľ fotoreál tečie ('google' | 'ion' | null) a prečo je nedostupný
    // (text pre tooltip čipu). Obe sú vstupy z bootu (photorealTileset.js) —
    // controller ich len nesie do prezentácie, nič z nich nerozhoduje.
    photorealSource = null,
    photorealUnavailableReason = null,
    // Továreň shadera pre deň/noc na fotoreáli (photorealNight.js). Injektuje sa
    // v testoch: Cesium CustomShader s textúrou sa v Node postaviť nedá.
    nightShaderFactory = buildPhotorealNightShader,
    cesiumToken = '',
    initialStack = 'photoreal',
    onChange = null,
    onError = null,
    terrainPreference = 'auto',
  } = {}) {
    this.viewer = viewer;
    this.googleTileset = googleTileset;
    this._photorealSource = photorealSource === 'ion' || photorealSource === 'google' ? photorealSource : null;
    this._nightShaderFactory = typeof nightShaderFactory === 'function' ? nightShaderFactory : buildPhotorealNightShader;
    this._photorealUnavailableReason = typeof photorealUnavailableReason === 'string' && photorealUnavailableReason.trim()
      ? photorealUnavailableReason.trim()
      : null;
    this.cesiumToken = String(cesiumToken || '').trim();
    // Ktorý terén dostane globe stack (OKO):
    //   'auto'  — s ion tokenom Cesium World Terrain, bez neho merge/keyless
    //             (pôvodné správanie, default),
    //   'sk'    — VŽDY merge endpoint /api/sk-terrain (DMR 3.5 10 m nad SR,
    //             Re:Earth passthrough vo svete) aj keď ion token existuje,
    //   'world' — vždy Cesium World Terrain (no-op bez tokenu).
    // Preferencia je vstup, nie stav: main.js ju číta z `?terrain=` a controller
    // ostáva testovateľný bez URL. Výškový datum sa nemení — obe vetvy sú
    // elipsoidné (docs/CURRENT-STATE.md §1a).
    this.terrainPreference = ['auto', 'sk', 'world'].includes(terrainPreference)
      ? terrainPreference
      : 'auto';
    this._onChange = onChange;
    this._onError = onError;
    this._activeId = googleTileset ? initialStack : 'osm';
    this._imageryLayer = null;
    /** Optional base under a coverage-limited stack (see `underlayStackId`). */
    this._underlayLayer = null;
    /**
     * Nočné svetlá miest (NASA Black Marble) nad podkladom. Pridáva ich
     * prepínač Deň/noc, nie výber stacku — vrstva teda musí prežiť prepnutie
     * podkladu a zakaždým sadnúť NAVRCH. Provider sa stavia lenivo a cachuje
     * sa mimo `_imageryProviders` (nie je to stack, nedá sa zvoliť).
     */
    this._nightLightsLayer = null;
    this._nightLightsProvider = null;
    this._nightLightsEnabled = false;
    /** Svetlá miest (Black Marble) zvlášť od Deň/noc — vypínač 2026-09-07.
     *  Controller default true (spätná kompatibilita testov); UI ich pri
     *  štarte vypne, kým používateľ nezapne (default vypnuté). */
    this._cityLightsEnabled = true;
    /** Remover preRender listenera, ktorý tlmí svetlá s výškou (viď _applyNightLightsFade). */
    this._nightLightsFadeRemover = null;
    this._imageryProviders = new Map();
    this._isSwitching = false;
    this._lastError = null;
    // Tracks which terrain PROVIDER is actually installed on the scene, not
    // just an ion-available boolean: 'world' (Cesium World Terrain, ion
    // token), 'keyless' (Re:Earth or its Ellipsoid fallback), or null (never
    // set yet — Cesium's own startup default). Using a tri-state here (rather
    // than the `enabled` boolean `_setWorldTerrainEnabled` receives) matters
    // because both the "never set" and "keyless" states pass `enabled=false`;
    // collapsing them to a boolean would make the first real keyless switch
    // a no-op against the initial `false` default and leave Cesium's built-in
    // provider in place instead of installing Re:Earth terrain.
    this._terrainMode = null;
    /**
     * Ktorý terénny zdroj je NAOZAJ nainštalovaný:
     * 'cesium-world' | 'sk-merged' | 'reearth' | 'flat' | null (zatiaľ žiadny).
     * `_terrainMode` hovorí len o zvolenej VETVE — merge s DMR, holý Re:Earth
     * aj plochý fallback sú všetko 'keyless', takže sám o sebe nie je dôkazom,
     * že SK terén beží.
     */
    this._terrainSource = null;
    // Cache of the constructed keyless Re:Earth CesiumTerrainProvider, so
    // repeat switches into a keyless globe stack don't refetch `layer.json`.
    // Lives independently of `_switchGen` — construction is async and racy
    // switches are guarded where it's awaited (`_setWorldTerrainEnabled`).
    this._reearthTerrainProvider = null;
    // Monotonic switch counter. setStack() awaits network-bound provider
    // creation; a rapid A→B switch where A (e.g. slow Bing) resolves AFTER B
    // (fast OSM) would otherwise revert the user's last choice (M7). Each call
    // captures a generation and aborts its own commit once superseded.
    this._switchGen = 0;

    if (!this.getStack(this._activeId) || !this.isStackAvailable(this._activeId)) {
      this._activeId = googleTileset ? 'photoreal' : 'osm';
    }
  }

  getStacks() {
    return MAP_STACKS.map((stack) => {
      const available = this.isStackAvailable(stack.id);
      return {
        ...stack,
        available,
        // Fotoreál cez Cesium ion: chip title to povie (pravidlo 2 — zdroj
        // dát viditeľný), lebo kredity dole sú pre bežné oko malé.
        sourceNote: stack.kind === 'photoreal' && this._photorealSource === 'ion' ? t('mapstack.via-ion') : '',
        // Why this stack can't be picked, from the ONE place that decides it.
        // A stack can be unavailable for reasons other than a missing ion
        // token (photoreal is unavailable when the Google tileset failed to
        // load), so callers must not infer the reason from `available` alone.
        unavailableReason: available ? null : this._unavailableReason(stack),
      };
    });
  }

  /**
   * Human-readable reason a stack can't be activated. Shared by `getStacks()`
   * and `setStack()` so the tooltip and the toast never drift apart.
   * @param {object} stack - Stack descriptor.
   * @returns {string}
   */
  _unavailableReason(stack) {
    if (stack?.requiresIon) return t('mapstack.ion-required-bing');
    // Fotoreál má konkrétny dôvod z bootu (EHP 403, sieť…) — bez neho by
    // tooltip hovoril len „nedostupný" a používateľ by hľadal chybu u seba.
    if (stack?.kind === 'photoreal' && this._photorealUnavailableReason) {
      return t('mapstack.unavailable-because', { label: stack.label, reason: this._photorealUnavailableReason });
    }
    return t('mapstack.unavailable', { label: stack?.label || t('mapstack.this-stack') });
  }

  getStack(id) {
    return MAP_STACKS.find((stack) => stack.id === id) || null;
  }

  getActiveId() {
    return this._activeId;
  }

  /**
   * Monotonic id of the most recently STARTED switch.
   *
   * A switch is only superseded by another `setStack()` — nothing else moves
   * this number — so a caller that must know whether the globe it is looking
   * at is still the one IT asked for can compare this across its own await.
   * Unchanged (or advanced by exactly its own call) means no newer switch has
   * claimed the globe.
   * @returns {number}
   */
  getSwitchGeneration() {
    return this._switchGen;
  }

  getActiveStack() {
    return this.getStack(this._activeId);
  }

  isStackAvailable(id) {
    const stack = this.getStack(id);
    if (!stack) return false;
    if (stack.kind === 'photoreal') return !!this.googleTileset;
    if (stack.requiresIon) return !!this.cesiumToken;
    return true;
  }

  async setStack(id, { silent = false } = {}) {
    const stack = this.getStack(id) || this.getStack('photoreal');
    if (!stack) return null;

    if (!this.isStackAvailable(stack.id)) {
      const message = this._unavailableReason(stack);
      this._lastError = message;
      this._onError?.(message, stack);
      return this.getState();
    }

    const gen = ++this._switchGen;
    this._isSwitching = true;
    this._lastError = null;
    if (!silent) this._emitChange('switching');

    try {
      if (stack.kind === 'photoreal') {
        await this._activatePhotoreal(gen);
      } else {
        await this._activateGlobeStack(stack, gen);
      }
      // A newer switch started while we were awaiting the provider — that call
      // owns the final state now, so don't commit ours or emit a stale 'ready'.
      if (gen !== this._switchGen) return this.getState();
      this._activeId = stack.id;
      // Show/hide of tilesets + imagery swaps need a frame in idle mode;
      // subsequent tile loads self-request via Cesium. (perf wave 2)
      governorRequestRender('map-stack');
      if (!silent) this._emitChange('ready');
    } catch (error) {
      if (gen !== this._switchGen) return this.getState();
      const message = error?.message || String(error);
      this._lastError = message;
      this._onError?.(message, stack);
      if (this.googleTileset) {
        await this._activatePhotoreal(gen);
        if (gen !== this._switchGen) return this.getState();
        this._activeId = 'photoreal';
      }
      if (!silent) this._emitChange('error');
    } finally {
      // Only the latest switch clears the switching flag; a superseded call
      // must not stomp a newer switch that is still in progress.
      if (gen === this._switchGen) this._isSwitching = false;
    }

    return this.getState();
  }

  getState(status = this._isSwitching ? 'switching' : 'ready') {
    return {
      activeId: this._activeId,
      activeStack: this.getActiveStack(),
      stacks: this.getStacks(),
      status,
      lastError: this._lastError,
      hasCesiumIonToken: !!this.cesiumToken,
      // Ktorý terén je NAOZAJ nainštalovaný ('world' | 'keyless' | null) a
      // aká preferencia o tom rozhodla — QA/diagnostika (názov triedy
      // providera obe vetvy nerozlíši, obe sú CesiumTerrainProvider).
      terrainMode: this._terrainMode,
      terrainPreference: this.terrainPreference,
      terrainSource: this._terrainSource,
      photorealSource: this._photorealSource,
    };
  }

  /**
   * Zapni/vypni nočné svetlá miest nad podkladom.
   *
   * Volá to prepínač Deň/noc (ui.js), pretože vrstva bez zapnutého osvetlenia
   * glóbusu nefunguje — miešanie `dayAlpha`/`nightAlpha` je v shaderi pod
   * `ENABLE_DAYNIGHT_SHADING`, takže bez terminátora by Black Marble prekryl
   * aj dennú stranu (nightLights.js).
   * @param {boolean} enabled
   * @returns {boolean} výsledný stav
   */
  setNightLightsEnabled(enabled) {
    this._nightLightsEnabled = enabled === true;
    this._syncNightLightsLayer(this.getActiveStack());
    governorRequestRender("night-lights");
    return this._nightLightsEnabled;
  }

  /**
   * Svetlá miest zvlášť (2026-09-07): Deň/noc (setNightLightsEnabled) je
   * hlavný prepínač zotmenia; tento vypína len svetlá — na glóbuse vrstvu
   * Black Marble, na fotoreáli zosilnenie svetiel v shaderi (zotmenie ostáva).
   * @param {boolean} enabled
   * @returns {boolean}
   */
  setCityLightsEnabled(enabled) {
    this._cityLightsEnabled = enabled !== false;
    this._syncNightLightsLayer(this.getActiveStack());
    governorRequestRender("night-lights");
    return this._cityLightsEnabled;
  }

  /** Je vrstva nočných svetiel naozaj v scéne? (QA/testy, nie stav prepínača.) */
  hasNightLightsLayer() {
    return !!this._nightLightsLayer;
  }

  /**
   * Jediný zapisovač vrstvy nočných svetiel. Berie CIEĽOVÝ stack, nie
   * `getActiveStack()`: počas prepnutia je `_activeId` ešte starý (commit
   * robí až `setStack`), takže prechod fotoreál → glóbus by sa inak vyhodnotil
   * podľa fotoreálu a vrstva by nepribudla.
   *
   * Odobratie a opätovné pridanie NIE JE zbytočné: `_activateGlobeStack`
   * vkladá podklad na index 0/1 a svetlá musia ostať navrchu. Vrstva sa
   * odoberá s `destroy = false`, takže sa recykluje tá istá inštancia.
   * @param {object|null} stack Cieľový stack descriptor.
   */
  _syncNightLightsLayer(stack) {
    // Fotoreál: glóbus je skrytý, tak deň/noc ide cez customShader na
    // tilesete (photorealNight.js) — ten istý prepínač, iná cesta.
    applyPhotorealNight(this.googleTileset, this._nightLightsEnabled && stack?.kind === "photoreal", {
      shaderFactory: this._nightShaderFactory,
      lights: this._cityLightsEnabled,
    });
    const wanted = this._nightLightsEnabled && this._cityLightsEnabled && !!stack && stack.kind !== "photoreal";
    if (this._nightLightsLayer) {
      this.viewer.imageryLayers.remove(this._nightLightsLayer, false);
      if (!wanted) this._nightLightsLayer = null;
    }
    if (!wanted) {
      this._detachNightLightsFade();
      return;
    }
    if (!this._nightLightsLayer) {
      this._nightLightsProvider = this._nightLightsProvider || createNightLightsProvider();
      this._nightLightsLayer = tagImageryRole(new Cesium.ImageryLayer(this._nightLightsProvider), IMAGERY_ROLE.nightLights);
    }
    // Štýl sa píše pri KAŽDOM usadení: zosilnenie svetiel závisí od kontrastu
    // cieľového podkladu (svetlá OSM 3×, tmavé 1,8×) — recyklovaná vrstva by
    // inak niesla zosilnenie predchádzajúcej mapy.
    styleNightLightsLayer(this._nightLightsLayer, basemapContrastForStack(stack));
    // Bez indexu = navrch nad podklad aj prípadný underlay.
    this.viewer.imageryLayers.add(this._nightLightsLayer);
    this._attachNightLightsFade();
  }

  /**
   * Svetlá musia ísť s osvetlením aj VÝŠKOVO. Cesium mieša dayAlpha/nightAlpha
   * len podľa Slnka (nightBlend), nie podľa vzdialenosti — keď pod 1 500 km
   * osvetlenie vyhasne a mesto v noci dostane dennú mapu (globeLighting.js),
   * svetlá by ostali svietiť cez jasný podklad ako žlté fľaky. Preto vrstva
   * dostáva `alpha` = ten istý fade, aký počíta shader. preRender ako
   * scopeMask/orbit: beží len keď sa kreslí frame, jedna clamp na frame,
   * zápis len pri zmene.
   */
  _attachNightLightsFade() {
    this._applyNightLightsFade();
    if (this._nightLightsFadeRemover) return;
    const preRender = this.viewer?.scene?.preRender;
    if (typeof preRender?.addEventListener !== "function") return;
    this._nightLightsFadeRemover = preRender.addEventListener(() => this._applyNightLightsFade());
  }

  _detachNightLightsFade() {
    if (typeof this._nightLightsFadeRemover === "function") this._nightLightsFadeRemover();
    this._nightLightsFadeRemover = null;
  }

  _applyNightLightsFade() {
    const layer = this._nightLightsLayer;
    if (!layer) return;
    const alpha = lightingFadeFactor(this.viewer?.scene?.camera?.positionCartographic?.height);
    if (Math.abs((layer.alpha ?? 1) - alpha) > 0.005) layer.alpha = alpha;
  }

  async _activatePhotoreal(gen) {
    this._removeImageryLayer();
    if (this.googleTileset) this.googleTileset.show = true;
    this.viewer.scene.globe.show = false;
    // Glóbus je skrytý — nočné svetlá nemajú čo osvetľovať a v kolekcii by
    // len viseli. Prepínač Deň/noc si stav pamätá, návrat na glóbus ich vráti.
    this._syncNightLightsLayer(this.getStack("photoreal"));
    // Terrain is left UNTOUCHED here. The photoreal globe is hidden
    // (`globe.show = false`), so the terrain provider is inert — it renders and
    // streams nothing. Routing this through `_setWorldTerrainEnabled(false)`
    // would make the DEFAULT startup stack await a keyless Re:Earth `layer.json`
    // fetch it can't use, delaying photoreal boot on a slow/blocked network and
    // (on failure) caching the flat `EllipsoidTerrainProvider` fallback for
    // later OSM switches. The Re:Earth fetch is therefore lazy: it happens on
    // the first switch to an actual globe stack (`_activateGlobeStack`).
    // `_terrainMode` is intentionally not changed — every globe-stack transition
    // re-derives the correct provider from it (null/'world'/'keyless'), so
    // leaving it as-is keeps the next switch correct without a photoreal fetch.
    void gen;
  }

  async _activateGlobeStack(stack, gen) {
    const provider = await this._getImageryProvider(stack);
    const underlayStack = stack.underlayStackId ? this.getStack(stack.underlayStackId) : null;
    const underlayProvider = underlayStack ? await this._getImageryProvider(underlayStack) : null;
    // A newer switch started while the provider was resolving — don't touch the
    // scene's imagery layers, the winning switch already owns them (M7).
    if (gen != null && gen !== this._switchGen) return;
    this._removeImageryLayer();

    if (underlayProvider) {
      this._underlayLayer = tagImageryRole(new Cesium.ImageryLayer(underlayProvider), IMAGERY_ROLE.underlay);
      this.viewer.imageryLayers.add(this._underlayLayer, 0);
    }
    // Rola vrstvy (imageryOrder.js): prekryvy NASA GIBS z data/gibsOverlays.js
    // sa vkladajú podľa nej — vždy nad podklad a POD nočné svetlá.
    this._imageryLayer = tagImageryRole(new Cesium.ImageryLayer(provider), IMAGERY_ROLE.base);
    // Voliteľné stlmenie podkladu (2026-09-04). Raster dlaždice majú popisy
    // zapečené v obrázku — text sa z nich vypnúť nedá. Stlmenie je jediná
    // páka, ktorá ich pošle do pozadia bez toho, aby sa menil zdroj: mapa
    // ostane čitateľná ako tvar, ale prestane súťažiť s kontaktmi, ktoré sa
    // nad ňou kreslia (tie sú billboardy a stlmenie sa ich netýka).
    const adjust = stack.xyz?.adjust || stack.wms?.adjust || null;
    if (adjust) {
      if (Number.isFinite(adjust.brightness)) this._imageryLayer.brightness = adjust.brightness;
      if (Number.isFinite(adjust.contrast)) this._imageryLayer.contrast = adjust.contrast;
      if (Number.isFinite(adjust.saturation)) this._imageryLayer.saturation = adjust.saturation;
    }
    this.viewer.imageryLayers.add(this._imageryLayer, underlayProvider ? 1 : 0);

    // Až po podklade — svetlá patria navrch (a po každom prepnutí znova).
    this._syncNightLightsLayer(stack);

    if (this.googleTileset) this.googleTileset.show = false;
    this.viewer.scene.globe.show = true;
    await this._setWorldTerrainEnabled(this._prefersWorldTerrain(), gen);
  }

  /**
   * Má tento globe stack dostať Cesium World Terrain (ion), alebo keyless
   * merge (/api/sk-terrain → DMR 3.5 nad SR + Re:Earth vo svete)?
   * @returns {boolean}
   */
  _prefersWorldTerrain() {
    if (this.terrainPreference === 'sk') return false;
    return !!this.cesiumToken;
  }

  async _getImageryProvider(stack) {
    if (this._imageryProviders.has(stack.id)) {
      return this._imageryProviders.get(stack.id);
    }

    let provider;
    if (stack.kind === 'ion') {
      provider = await Cesium.createWorldImageryAsync({ style: stack.style });
    } else if (stack.kind === 'osm') {
      provider = new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
        credit: DEFAULT_OSM_CREDIT,
      });
    } else if (stack.kind === 'wms') {
      const cfg = stack.wms;
      provider = new Cesium.WebMapServiceImageryProvider({
        url: cfg.url,
        layers: cfg.layers,
        // Transparent PNG, not JPEG: outside the mosaic's actual coverage the
        // service paints "no data" — with transparency the OSM underlay shows
        // through instead of a white halo around the country.
        parameters: { format: 'image/png', transparent: true },
        tileWidth: cfg.tileSize,
        tileHeight: cfg.tileSize,
        maximumLevel: cfg.maximumLevel,
        rectangle: Cesium.Rectangle.fromDegrees(...cfg.rectangleDegrees),
        credit: cfg.credit,
      });
    } else if (stack.kind === 'xyz') {
      // Obyčajné XYZ raster dlaždice. Konfigurácia žije v descriptore (ako pri
      // 'wms'), nie tu — provider factory nesmie poznať konkrétny zdroj.
      const cfg = stack.xyz;
      provider = new Cesium.UrlTemplateImageryProvider({
        url: cfg.url,
        tileWidth: cfg.tileSize,
        tileHeight: cfg.tileSize,
        maximumLevel: cfg.maximumLevel,
        credit: cfg.credit,
      });
    } else {
      throw new Error(`Unsupported map stack: ${stack.id}`);
    }

    this._imageryProviders.set(stack.id, provider);
    return provider;
  }

  _removeImageryLayer() {
    if (this._underlayLayer) {
      this.viewer.imageryLayers.remove(this._underlayLayer, false);
      this._underlayLayer = null;
    }
    if (!this._imageryLayer) return;
    this.viewer.imageryLayers.remove(this._imageryLayer, false);
    this._imageryLayer = null;
  }

  /**
   * Sets the scene's terrain provider for the current globe stack.
   *
   * `enabled` selects Cesium World Terrain (ion token present — regime B,
   * unchanged). Disabled/keyless (regime C: OSM or any globe stack without an
   * ion token) now tries the keyless Re:Earth ellipsoidal terrain instead of
   * the flat `EllipsoidTerrainProvider`, falling back to the flat provider
   * (today's behavior) if construction fails — no worse than before this fix.
   *
   * `CesiumTerrainProvider.fromUrl()` is async (fetches `layer.json`), so this
   * method is async-safe: `gen` is the caller's switch generation (from
   * `setStack`'s `_switchGen`, threaded through `_activatePhotoreal` /
   * `_activateGlobeStack`, mirroring the M7 pattern in `_activateGlobeStack`
   * for imagery providers). If a newer switch starts while the Re:Earth
   * fetch is in flight, this call's result is discarded instead of
   * clobbering the newer switch's terrain.
   * @param {boolean} enabled
   * @param {number} [gen] — switch generation this call belongs to
   */
  async _setWorldTerrainEnabled(enabled, gen) {
    const targetMode = enabled ? 'world' : 'keyless';
    if (targetMode === this._terrainMode) return;
    if (enabled) {
      // BEZ vertex normál — a nie je to úspora. Shader glóbusu definuje
      // ENABLE_DAYNIGHT_SHADING len keď terén normály NEMÁ (s nimi berie
      // ENABLE_VERTEX_LIGHTING) a jedine pod tým prvým sa mieša
      // dayAlpha/nightAlpha imagery vrstiev: s normálami by nočné svetlá
      // (nightLights.js) potichu prekryli aj dennú stranu — presne to sa stalo
      // 2026-09-06. Hillshade z normál by aj tak nebolo vidieť: osvetlenie je
      // pod 1 500 km vypnuté (globeLighting.js) a nad tým je reliéf sub-pixel.
      this.viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain({
        requestVertexNormals: false,
      }));
      this._terrainSource = 'cesium-world';
    } else {
      const provider = await this._getKeylessTerrainProvider();
      // A newer switch started while the Re:Earth layer.json fetch was in
      // flight — that call owns terrain now; don't stomp it (M7 pattern).
      if (gen != null && gen !== this._switchGen) return;
      this.viewer.terrainProvider = provider;
    }
    this._terrainMode = targetMode;
  }

  /**
   * Resolves (and caches) the keyless terrain provider for globe stacks
   * without an ion token. Preferuje lokálny merge endpoint `/api/sk-terrain`
   * (dev proxy: DMR 3.5 dlaždice nad SR, Re:Earth passthrough všade inde —
   * Fáza 1b, výšky ostávajú elipsoidné, takže výškový kontrakt §1a platí
   * nezmenene); bez proxy (produkčný build) padá na priamy Re:Earth a pri
   * úplnom zlyhaní na `EllipsoidTerrainProvider` (flat — pôvodné správanie).
   * Never throws.
   * @returns {Promise<Cesium.TerrainProvider>}
   */
  async _getKeylessTerrainProvider() {
    if (this._reearthTerrainProvider) return this._reearthTerrainProvider;
    const { url, merged } = await resolveKeylessTerrainUrl({ upstreamUrl: REEARTH_TERRAIN_URL });
    try {
      this._reearthTerrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
        url,
        merged ? { credit: SK_TERRAIN_CREDIT } : {},
      );
      // Ktorý zdroj to NAOZAJ je — 'keyless' ako režim nestačí: rovnakú
      // hodnotu vráti merge s DMR, holý Re:Earth aj plochý fallback, takže
      // QA (a moje vlastné overovanie) by ju mohlo prijať ako falošný dôkaz,
      // že SK terén beží. CLAUDE.md pravidlo 2 — stav dát musí byť viditeľný.
      this._terrainSource = merged ? 'sk-merged' : 'reearth';
    } catch (error) {
      console.warn('[mapStackController] keyless terrain unavailable, falling back to flat ellipsoid terrain:', error);
      this._reearthTerrainProvider = new Cesium.EllipsoidTerrainProvider();
      this._terrainSource = 'flat';
    }
    return this._reearthTerrainProvider;
  }

  _emitChange(status) {
    this._onChange?.(this.getState(status));
  }
}
