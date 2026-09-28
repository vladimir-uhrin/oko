// scripts/lib/cesiumHtmlTags.mjs
/**
 * Značky Cesia v index.html (2026-09-28, meranie štartu: preloader sa ukázal až so stiahnutým
 * Cesiom — 4 s na 4G, 16 s na 3G — lebo `<script src="/cesium/Cesium.js">` od vite-plugin-cesium
 * je blokujúci skript v <head> a telo stránky sa vykreslí až po ňom).
 *
 * - `defer`: HTML sa vykreslí hneď (preloader do ~0,3 s), Cesium.js sa spustí po rozparsovaní
 *   a PRED modulom appky — odložené klasické skripty a moduly sú v jednom zozname v poradí
 *   dokumentu (HTML spec „list of scripts that will execute when the document has finished
 *   parsing"); Cesium je v <head> pred balíkom appky. `window.CESIUM_BASE_URL` definuje plugin
 *   v balíku, nie z `src` skriptu, takže verzia v URL Cesiu nevadí.
 * - `fetchpriority="high"`: Chrome dáva odloženým skriptom NÍZKU prioritu sťahovania — v A/B
 *   meraní (lokálny server, 4G) sa Cesium.js s holým `defer` sťahoval 17 s namiesto 7,5 s,
 *   lebo čakal za všetkým ostatným, a glóbus bol hotový o 8 s neskôr. S vysokou prioritou
 *   ostáva neblokujúci, ale sťahuje sa ako prvý.
 * - `?v=<verzia Cesia>`: Cesium.js (1,65 MB) a widgets.css nemajú v názve odtlačok; s verziou
 *   v URL ich statický server smie držať rok (immutable) a upgrade Cesia URL zmení.
 *
 * Čistá funkcia nad značkami z transformIndexHtml pluginu ({tag, attrs, injectTo}).
 * @param {Array<{tag: string, attrs?: object}>} tags
 * @param {string} version napr. „1.138.0"
 * @returns {Array<{tag: string, attrs?: object}>} nové pole, pôvodné značky nemenené
 */
export function versionedDeferredCesiumTags(tags, version) {
  const v = String(version || '').trim();
  const suffix = v ? `?v=${encodeURIComponent(v)}` : '';
  return (Array.isArray(tags) ? tags : []).map((tag) => {
    if (!tag || typeof tag !== 'object') return tag;
    const attrs = { ...(tag.attrs || {}) };
    if (tag.tag === 'script' && typeof attrs.src === 'string' && /\/Cesium\.js$/.test(attrs.src)) {
      return { ...tag, attrs: { ...attrs, src: attrs.src + suffix, defer: true, fetchpriority: 'high' } };
    }
    if (tag.tag === 'link' && typeof attrs.href === 'string' && /\/widgets\.css$/.test(attrs.href)) {
      return { ...tag, attrs: { ...attrs, href: attrs.href + suffix } };
    }
    return tag;
  });
}
