// src/layerBasemap.js — mapa podľa vrstvy (2026-10-05).
//
// Vlastník: „keďže mám viac vrstiev, aby sa zapla vhodnejšia mapa pre danú vrstvu" →
// „automatické prepnutie, ale tam, kde to má zmysel" (Ukrajina je OK tak, ako je).
//
// Dvojice sú len tie, ktoré obstáli na snímkach (output/qa-basemap, 2026-10-05):
//   prírodné udalosti (búrky, povodne)  → NASA GIBS v pravých farbách: vidno dnešnú oblačnosť a víry;
//   zemetrasenia, sopky                 → reliéf ASTER: vidno pohoria a okraje dosiek.
// ZÁMERNE mimo: lietadlá, lode, satelity (čitateľné všade); Ukrajina (scény frontu si KARTU
// prepínajú samy, main.js — KARTA má rám a legendu „Mapa frontu", inde nedáva zmysel);
// meteo (vlastný podklad podľa hostiteľa, meteoLayer.js); Stadia Dark (na okolive.sk 401).
//
// Pravidlá: len pri kliknutí používateľa na vrstvu (origin 'user'), nie pri obnove z odkazu;
// ručná voľba mapy má prednosť do konca návštevy; po vypnutí vrstvy sa vráti pôvodná mapa;
// viac vrstiev = platí naposledy zapnutá; vypínač v Zobrazení (localStorage).

export const LAYER_BASEMAPS = Object.freeze({
  'natural-events': 'gibs-truecolor',
  earthquakes: 'aster-relief',
  volcanoes: 'aster-relief',
});
export const AUTO_BASEMAP_STORAGE_KEY = 'oko.autoBasemap';
/**
 * Reliéf aj satelitná mozaika sú pekné z diaľky, zblízka rozmazané (2026-10-05): pod NEAR sa
 * vráti pôvodná mapa (spravidla Google 3D), nad FAR znova mapa vrstvy. Dva prahy = bez kmitania.
 */
export const AUTO_BASEMAP_NEAR_M = 150_000;
export const AUTO_BASEMAP_FAR_M = 220_000;

/** Uložené nastavenie → zapnuté? (pure) Predvolene áno. */
export function parseAutoBasemapSetting(raw) {
  return raw !== 'off';
}

/**
 * Politika prepínania (bez DOM a Cesia — testovateľná).
 * @param {object} deps
 * @param {() => string|null} deps.getActiveId aktívna mapa
 * @param {(id: string) => boolean} deps.hasStack je mapa dostupná?
 * @param {(id: string) => void} deps.setStack prepni mapu
 * @param {(info: {layerId: string, mapId: string, undo: () => void}) => void} [deps.notify] hláška s návratom
 * @param {() => boolean} [deps.isOn] vypínač
 */
export function createLayerBasemapPolicy({ getActiveId, hasStack, setStack, notify = null, isOn = () => true }) {
  /** Vrstvy, ktoré si mapu vypýtali, v poradí zapnutia. */
  let owners = [];
  /** Mapa pred prvým automatickým prepnutím (kam sa vrátiť). */
  let baseId = null;
  /** Mapa, ktorú sme naposledy nastavili my — zmena na inú je cudzia. */
  let expected = null;
  let manualLock = false;
  /** Kamera je blízko — mapa vrstvy je dočasne vystriedaná pôvodnou. */
  let near = false;
  /** Hláška čaká na prvé skutočné prepnutie (vrstva zapnutá zblízka). */
  let pendingNote = null;

  function reset() {
    owners = [];
    baseId = null;
    expected = null;
    pendingNote = null;
  }

  function switchTo(mapId) {
    expected = mapId;
    if (getActiveId() !== mapId) setStack(mapId);
  }

  function undo() {
    const back = baseId;
    manualLock = true; // „Vrátiť" = používateľ automatiku pre túto návštevu nechce
    reset();
    if (back && getActiveId() !== back) setStack(back);
  }

  return {
    /** Zmena vrstvy z dataManagera ({ layerId, enabled, origin }). */
    onLayerChange({ layerId, enabled, origin } = {}) {
      const mapId = LAYER_BASEMAPS[layerId];
      if (!mapId) return false;
      if (enabled) {
        if (origin !== 'user' || manualLock || !isOn() || !hasStack(mapId)) return false;
        const active = getActiveId();
        owners = owners.filter((o) => o.layerId !== layerId);
        if (!owners.length) baseId = active === mapId ? null : active;
        owners.push({ layerId, mapId });
        if (active === mapId) { expected = mapId; return false; }
        if (near && baseId) {
          // Zblízka ostáva pôvodná mapa; prepne sa (s hláškou) až pri oddialení.
          expected = baseId;
          pendingNote = { layerId, mapId };
          return false;
        }
        switchTo(mapId);
        notify?.({ layerId, mapId, undo });
        return true;
      }
      // Vypnutie (kýmkoľvek): vrstva už mapu nepotrebuje.
      const had = owners.some((o) => o.layerId === layerId);
      if (!had) return false;
      owners = owners.filter((o) => o.layerId !== layerId);
      if (getActiveId() !== expected) { reset(); return false; } // mapu medzitým zmenil niekto iný
      if (owners.length) {
        if (near && baseId) return false; // zblízka je už pôvodná mapa
        switchTo(owners[owners.length - 1].mapId);
        return true;
      }
      const back = baseId;
      reset();
      if (back && getActiveId() !== back) { setStack(back); return true; }
      return false;
    },

    /**
     * Výška kamery nad zemou (m). Pod NEAR pôvodná mapa, nad FAR mapa vrstvy (hysteréza).
     * @returns {boolean} či sa mapa prepla
     */
    onCameraHeight(heightM) {
      if (!Number.isFinite(heightM)) return false;
      const wasNear = near;
      if (heightM < AUTO_BASEMAP_NEAR_M) near = true;
      else if (heightM > AUTO_BASEMAP_FAR_M) near = false;
      if (near === wasNear || !owners.length || !baseId) return false;
      if (getActiveId() !== expected) { reset(); return false; }
      if (near) { switchTo(baseId); return true; }
      const top = owners[owners.length - 1];
      switchTo(top.mapId);
      if (pendingNote) { const note = pendingNote; pendingNote = null; notify?.({ ...note, undo }); }
      return true;
    },

    /** Mapa sa zmenila (akokoľvek). Cudzia zmena (scéna frontu, meteo) = už ju neriadime. */
    onMapChange(activeId) {
      if (expected && activeId !== expected) reset();
    },

    /** Používateľ si mapu vybral sám — do konca návštevy ju neprepisujeme. */
    onManualChoice() {
      manualLock = true;
      reset();
    },

    /** Vypínač v Zobrazení: zapnutie znova povolí automatiku aj po ručnej voľbe. */
    onSettingChange(on) {
      if (on) manualLock = false;
      else reset();
    },

    state() {
      return { owners: owners.map((o) => o.layerId), baseId, expected, manualLock, near };
    },
  };
}
