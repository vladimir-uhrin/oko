// src/data/localMarkerIcons.js
/**
 * @module localMarkerIcons
 * @description Značky bodových infraštruktúrnych vrstiev na mape (2026-09-05,
 * „a ikony si nezmenil"). Letiská aj prístavy sa dovtedy kreslili ako holá
 * bodka — na mape nehovorila nič. Teraz je to piktogram v kruhu: lietadlo pre
 * letisko (medzinárodná dopravná značka), kotva pre prístav.
 *
 * PREČO KRUH OKOLO: živé lety sú tiež siluety lietadiel, ale bez kruhu a
 * natočené podľa kurzu. Kruh je to, čo z diaľky odlíši „tu je letisko" od
 * „tu práve letí lietadlo".
 *
 * Monochromatické SVG vo farbe vrstvy, tmavá výplň kruhu kvôli kontrastu nad
 * svetlou mapou aj nad fotorealistickým terénom. Žiadne emoji.
 */

/** Základná veľkosť značky v px; stupne (localLabelLod) ju škálujú. */
export const LOCAL_MARKER_BASE_PX = 22;

const CIRCLE = (color) => `<circle cx="12" cy="12" r="10.2" fill="#0b0f14" fill-opacity="0.78" stroke="${color}" stroke-width="1.7"/>`;

/** Lietadlo v kruhu — letisko. */
export function airportMarkerSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${CIRCLE(color)}<path d="M12 4.6l1.3 5.1 5.6 3.3v1.5l-5.6-1.7-.4 3.5 1.9 1.5v1.1L12 18.1l-2.8.8v-1.1l1.9-1.5-.4-3.5-5.6 1.7V13l5.6-3.3z" fill="${color}"/></svg>`;
}

/** Kotva v kruhu — prístav. */
export function portMarkerSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${CIRCLE(color)}<g fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="6.6" r="1.7"/><path d="M12 8.3v10.2M8.4 10.6h7.2M6 13.6c0 3.3 2.7 5.1 6 5.1s6-1.8 6-5.1"/></g></svg>`;
}

/** SVG → data URI pre Cesium BillboardGraphics.image. Pure. */
export function svgDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const airportMarkerImage = (color) => svgDataUri(airportMarkerSvg(color));
export const portMarkerImage = (color) => svgDataUri(portMarkerSvg(color));
