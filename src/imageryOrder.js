/**
 * Poradie imagery vrstiev na glóbuse (2026-09-06).
 *
 * `viewer.imageryLayers` je jeden zoznam, do ktorého píšu DVAJA vlastníci:
 * MapStackController (podklad, prípadný underlay, nočné svetlá) a dátové
 * prekryvné vrstvy NASA GIBS (data/gibsOverlays.js). Bez dohody by poradie
 * záviselo od toho, kto klikol skôr: prekryv zapnutý PO nočných svetlách by
 * ich prekryl, prepnutie podkladu ich zas usadí navrch. Preto každá vrstva
 * nesie ROLU a prekryvy sa vkladajú vždy POD nočné svetlá — tie sú
 * najvrchnejšia vrstva vždy (mestá svietia aj cez dážď; more je pod nimi).
 *
 * Značka je obyčajná vlastnosť na objekte vrstvy — Cesium ImageryLayer je
 * rozšíriteľný objekt a testové dvojníky ju unesú bez ďalšej registrácie.
 */

export const IMAGERY_ROLE = Object.freeze({
  base: 'base',
  underlay: 'underlay',
  overlay: 'overlay',
  nightLights: 'night-lights',
});

/**
 * Označ vrstvu rolou. Bezpečné bez vrstvy.
 * @template T
 * @param {T} layer
 * @param {string} role
 * @returns {T}
 */
export function tagImageryRole(layer, role) {
  if (layer && typeof layer === 'object') layer.gevImageryRole = role;
  return layer;
}

/**
 * Vlož prekryv POD prvú vrstvu nočných svetiel; bez nich navrch. Kolekcia je
 * Cesium ImageryLayerCollection (`length`, `get(i)`, `add(layer, index)`).
 * @param {{length?: number, get?: (i: number) => any, add: (layer: any, index?: number) => any}} collection
 * @param {object} layer
 * @returns {number} index, na ktorý vrstva sadla
 */
export function insertOverlayLayer(collection, layer) {
  tagImageryRole(layer, IMAGERY_ROLE.overlay);
  const count = Number.isInteger(collection?.length) ? collection.length : 0;
  if (typeof collection?.get === 'function') {
    for (let i = 0; i < count; i += 1) {
      if (collection.get(i)?.gevImageryRole === IMAGERY_ROLE.nightLights) {
        collection.add(layer, i);
        return i;
      }
    }
  }
  collection.add(layer);
  return count;
}
