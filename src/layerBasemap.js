// src/layerBasemap.js — mapa podľa vrstvy (2026-10-05).
//
// Vlastník: „keďže mám viac vrstiev, aby sa zapla vhodnejšia mapa pre danú vrstvu" →
// „automatické prepnutie, ale tam, kde to má zmysel" (Ukrajina je OK tak, ako je).
//
// Dvojice sú len tie, ktoré obstáli na snímkach (output/qa-basemap, 2026-10-05):
//   prírodné udalosti (búrky, povodne)  → NASA GIBS v pravých farbách: vidno dnešnú oblačnosť a víry;
//   zemetrasenia, sopky                 → reliéf ASTER: vidno pohoria a okraje dosiek;
//   meteo                               → tmavá mapa (localhost) / Blue Marble (web) — pôvodne vlastné
//                                         prepínanie v meteoLayer.js, od 2026-10-05 pod týmito pravidlami.
// ZÁMERNE mimo: lietadlá, lode, satelity (čitateľné všade); Ukrajina (scény frontu si KARTU
// prepínajú samy, main.js — KARTA má rám a legendu „Mapa frontu", inde nedáva zmysel).
//
// Pravidlá: pri kliknutí používateľa na vrstvu (meteo aj pri obnove z odkazu — pole je na fotomape
// nečitateľné); ručná voľba mapy má prednosť do konca návštevy; po vypnutí vrstvy sa vráti pôvodná
// mapa; viac vrstiev = platí naposledy zapnutá; zblízka pôvodná mapa (okrem meteo); vypínač
// v Zobrazení (localStorage); čip mapy nesie štítok AUTO, kým mapu drží vrstva.

/**
 * Pravidlá vrstiev. `map` null = určí `resolveMap` (meteo podľa hostiteľa). `anyOrigin` = aj obnova
 * z odkazu; `keepNear` = pri priblížení mapu nevracať; `onlyFrom` = prepnúť len z týchto máp.
 */
export const LAYER_BASEMAP_RULES = Object.freeze({
  'natural-events': Object.freeze({ map: 'gibs-truecolor' }),
  earthquakes: Object.freeze({ map: 'aster-relief' }),
  volcanoes: Object.freeze({ map: 'aster-relief' }),
  'meteo-gfs': Object.freeze({ map: null, anyOrigin: true, keepNear: true, onlyFrom: Object.freeze(['photoreal']) }),
});
/** Pevné dvojice (bez dynamických) — pre testy a dokumentáciu. */
export const LAYER_BASEMAPS = Object.freeze(Object.fromEntries(
  Object.entries(LAYER_BASEMAP_RULES).filter(([, rule]) => rule.map).map(([id, rule]) => [id, rule.map]),
));
export const AUTO_BASEMAP_STORAGE_KEY = 'oko.autoBasemap';
/**
 * Reliéf aj satelitná mozaika sú pekné z diaľky, zblízka rozmazané (2026-10-05): pod NEAR sa
 * vráti pôvodná mapa (spravidla Google 3D), nad FAR znova mapa vrstvy. Dva prahy = bez kmitania.
 */
export const AUTO_BASEMAP_NEAR_M = 150_000;
export const AUTO_BASEMAP_FAR_M = 220_000;

/**
 * Podklad pre meteo podľa hostiteľa (pure): Stadia Dark bez kľúča obslúži len lokálny vývoj
 * (na okolive.sk 401), inde bezkľúčová Blue Marble. Rovnaké pravidlo ako meteoLayer.basemapForHost
 * (test stráži zhodu) — tu, aby main.js nemusel načítať celú meteo vrstvu.
 */
export function meteoBasemapForHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  if (!h || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h) || h.endsWith('.localhost')) return 'stadia-dark';
  return 'gibs-blue-marble';
}

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
 * @param {(layerId: string) => string|null} [deps.resolveMap] mapa pre pravidlo s `map: null`
 * @param {(state: {auto: boolean, layerId: string|null}) => void} [deps.onState] štítok AUTO na čipe
 */
export function createLayerBasemapPolicy({ getActiveId, hasStack, setStack, notify = null, isOn = () => true, resolveMap = null, onState = null }) {
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
  let lastAuto = '';

  const top = () => owners[owners.length - 1] || null;
  /** Zblízka sa vracia pôvodná mapa — ak to vrstva navrchu dovolí. */
  const nearApplies = () => near && Boolean(baseId) && !top()?.keepNear;

  function emit() {
    const owner = top();
    const auto = Boolean(owner) && getActiveId() === owner.mapId && expected === owner.mapId;
    const key = auto ? owner.layerId : '';
    if (key === lastAuto) return;
    lastAuto = key;
    onState?.({ auto, layerId: auto ? owner.layerId : null });
  }

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
    emit();
  }

  function layerChange({ layerId, enabled, origin } = {}) {
    const rule = LAYER_BASEMAP_RULES[layerId];
    if (!rule) return false;
    if (enabled) {
      const mapId = rule.map ?? resolveMap?.(layerId) ?? null;
      if (!mapId || !(origin === 'user' || rule.anyOrigin) || manualLock || !isOn() || !hasStack(mapId)) return false;
      const active = getActiveId();
      if (rule.onlyFrom && !rule.onlyFrom.includes(owners.length ? baseId : active)) return false;
      owners = owners.filter((o) => o.layerId !== layerId);
      if (!owners.length) baseId = active === mapId ? null : active;
      owners.push({ layerId, mapId, keepNear: rule.keepNear === true });
      if (active === mapId) { expected = mapId; return false; }
      if (nearApplies()) {
        // Zblízka ostáva pôvodná mapa; prepne sa (s hláškou) až pri oddialení.
        expected = baseId;
        if (origin === 'user') pendingNote = { layerId, mapId };
        return false;
      }
      switchTo(mapId);
      if (origin === 'user') notify?.({ layerId, mapId, undo });
      return true;
    }
    // Vypnutie (kýmkoľvek): vrstva už mapu nepotrebuje.
    const had = owners.some((o) => o.layerId === layerId);
    if (!had) return false;
    owners = owners.filter((o) => o.layerId !== layerId);
    if (getActiveId() !== expected) { reset(); return false; } // mapu medzitým zmenil niekto iný
    if (owners.length) {
      const target = nearApplies() ? baseId : top().mapId;
      if (getActiveId() === target) { expected = target; return false; }
      switchTo(target);
      return true;
    }
    const back = baseId;
    reset();
    if (back && getActiveId() !== back) { setStack(back); return true; }
    return false;
  }

  return {
    /** Zmena vrstvy z dataManagera ({ layerId, enabled, origin }). */
    onLayerChange(change) {
      const switched = layerChange(change);
      emit();
      return switched;
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
      if (near === wasNear || !owners.length || !baseId || top().keepNear) return false;
      if (getActiveId() !== expected) { reset(); emit(); return false; }
      if (near) { switchTo(baseId); emit(); return true; }
      const owner = top();
      switchTo(owner.mapId);
      if (pendingNote) { const note = pendingNote; pendingNote = null; notify?.({ ...note, undo }); }
      emit();
      return true;
    },

    /** Mapa sa zmenila (akokoľvek). Cudzia zmena (scéna frontu) = už ju neriadime. */
    onMapChange(activeId) {
      if (expected && activeId !== expected) reset();
      emit();
    },

    /** Používateľ si mapu vybral sám — do konca návštevy ju neprepisujeme. */
    onManualChoice() {
      manualLock = true;
      reset();
      emit();
    },

    /** Vypínač v Zobrazení: zapnutie znova povolí automatiku aj po ručnej voľbe. */
    onSettingChange(on) {
      if (on) manualLock = false;
      else reset();
      emit();
    },

    state() {
      return { owners: owners.map((o) => o.layerId), baseId, expected, manualLock, near };
    },
  };
}
