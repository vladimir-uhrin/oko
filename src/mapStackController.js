import * as Cesium from 'cesium';
import { t } from './i18n.js';
import { governorRequestRender } from './renderGovernor.js';
import { resolveKeylessTerrainUrl, SK_TERRAIN_CREDIT } from './data/skTerrain.js';

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
    cesiumToken = '',
    initialStack = 'photoreal',
    onChange = null,
    onError = null,
    terrainPreference = 'auto',
  } = {}) {
    this.viewer = viewer;
    this.googleTileset = googleTileset;
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
    return stack?.requiresIon
      ? t('mapstack.ion-required-bing')
      : t('mapstack.unavailable', { label: stack?.label || t('mapstack.this-stack') });
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
    };
  }

  async _activatePhotoreal(gen) {
    this._removeImageryLayer();
    if (this.googleTileset) this.googleTileset.show = true;
    this.viewer.scene.globe.show = false;
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
      this._underlayLayer = new Cesium.ImageryLayer(underlayProvider);
      this.viewer.imageryLayers.add(this._underlayLayer, 0);
    }
    this._imageryLayer = new Cesium.ImageryLayer(provider);
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
      this.viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain({
        requestVertexNormals: true,
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
