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

  function reset() {
    owners = [];
    baseId = null;
    expected = null;
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
        switchTo(owners[owners.length - 1].mapId);
        return true;
      }
      const back = baseId;
      reset();
      if (back && getActiveId() !== back) { setStack(back); return true; }
      return false;
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
      return { owners: owners.map((o) => o.layerId), baseId, expected, manualLock };
    },
  };
}
