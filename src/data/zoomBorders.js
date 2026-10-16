// src/data/zoomBorders.js — hranice štátov pri priblížení (2026-10-16, vlastník: „keď zapriblíži kamera
// ku miestu, aby sa objavili hranice štátu … nevidno, kde je napr. Slovensko na mape").
//
// Fotorealistické dlaždice Google (a Bing letecký) nemajú hranice ani popisky — pri pohľade na krajinu
// nevidno, kde štát končí. Hranice (countryBoundaries.js, Natural Earth 1:50m) doteraz zapínali len scény
// (úžiny, Blízky východ, potrubia, Ukrajina). Tu pribúda držiteľ 'zoom': pod ZOOM_BORDERS_SHOW_BELOW_M
// výšky kamery sa hranice vyžiadajú, nad ZOOM_BORDERS_HIDE_ABOVE_M pustia (hysteréza, nech pri okraji
// neblikajú). Úvodný pohľad na zemeguľu (7 000 km) je nad prahom — hranice prídu až s preletom nad oblasť
// (mesto 260 km, krajina 1 100 km). Podklady s vlastnými hranicami (OSM, Stadia, KARTA, Bing s popiskami)
// držiteľa nepotrebujú — čiary by sa zdvojili. Čisté funkcie bez Cesia; zapojenie dostáva scénu zvonka.

/** Pod touto výškou kamery (m) sa hranice zapnú. Európa sa zmestí do záberu pri ~4 000–5 000 km. */
export const ZOOM_BORDERS_SHOW_BELOW_M = 5_000_000;
/** Nad touto výškou (m) sa zapnuté hranice zasa vypnú (hysteréza 1 000 km). */
export const ZOOM_BORDERS_HIDE_ABOVE_M = 6_000_000;
/** Podklady bez vlastných hraníc. */
export const ZOOM_BORDERS_STACKS = Object.freeze(['photoreal', 'bing-aerial']);
export const ZOOM_BORDERS_HOLDER = 'zoom';

/**
 * Chcú sa hranice pri tejto výške a podklade? (pure; `shown` = doterajší stav kvôli hysteréze)
 * @param {{heightM?: number, stackId?: string|null, shown?: boolean, showBelowM?: number, hideAboveM?: number, stacks?: readonly string[]}} o
 * @returns {boolean}
 */
export function zoomBordersWanted({
  heightM, stackId = null, shown = false,
  showBelowM = ZOOM_BORDERS_SHOW_BELOW_M, hideAboveM = ZOOM_BORDERS_HIDE_ABOVE_M, stacks = ZOOM_BORDERS_STACKS,
} = {}) {
  if (!stacks.includes(stackId)) return false;
  if (!Number.isFinite(heightM)) return shown;
  return shown ? heightM <= hideAboveM : heightM < showBelowM;
}

/**
 * Zapojenie: po vykreslení (najviac raz za `minIntervalMs`) prečíta výšku kamery a aktívny podklad; pri zmene
 * želania si hranice vyžiada alebo pustí ako držiteľ 'zoom' (ostatní držitelia — scény, potrubia — nezávisle).
 * @param {{scene: object, boundaries: {retain: Function, release: Function}, getStackId: () => string|null, now?: () => number, minIntervalMs?: number}} o
 * @returns {{shown: boolean, check: (force?: boolean) => boolean, destroy: () => void}}
 */
export function installZoomBorders({ scene, boundaries, getStackId, now = Date.now, minIntervalMs = 250 } = {}) {
  if (typeof scene?.postRender?.addEventListener !== 'function' || !boundaries || typeof getStackId !== 'function') {
    return { shown: false, check() { return false; }, destroy() {} };
  }
  let shown = false;
  let lastAt = -Infinity;
  const check = (force = false) => {
    const t = now();
    if (!force && t - lastAt < minIntervalMs) return shown;
    lastAt = t;
    const heightM = scene.camera?.positionCartographic?.height;
    const wanted = zoomBordersWanted({ heightM, stackId: getStackId(), shown });
    if (wanted === shown) return shown;
    shown = wanted;
    if (wanted) void boundaries.retain(ZOOM_BORDERS_HOLDER);
    else boundaries.release(ZOOM_BORDERS_HOLDER);
    return shown;
  };
  const onPostRender = () => { check(false); };
  scene.postRender.addEventListener(onPostRender);
  return {
    get shown() { return shown; },
    check,
    destroy() {
      scene.postRender.removeEventListener?.(onPostRender);
      if (shown) { shown = false; boundaries.release(ZOOM_BORDERS_HOLDER); }
    },
  };
}
