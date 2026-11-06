import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { MMI_LEGEND } from './quakeMedia.js';

/**
 * Mapa otrasov ShakeMap na glóbuse (2026-11-06, vlastník: „sprav" — skutočná intenzita namiesto
 * odhadu z magnitúdy). Po výbere otrasu, ku ktorému má USGS ShakeMap, sa stiahnu metadáta
 * z /api/earthquakes/shakemap/<id>.json (server obrázok spracuje a podrží) a obrázok sa položí
 * ako OBDĹŽNIK VO VÝŠKE — vzor radaru SHMÚ: fotoreál skrýva glóbus (`globe.show = false`), takže
 * vrstva `imageryLayers` by na predvolenej mape nebola vidieť. Pri výbere iného otrasu, zrušení
 * výberu alebo vypnutí vrstvy sa primitívum aj s textúrou zničí.
 *
 * Legenda MMI (farby USGS) sa ukáže vľavo dole, len kým je mapa na glóbuse.
 */

/** Výška obdĺžnika nad elipsoidom (m): nad terénom väčšiny oblastí aj nad mestami 3D. */
export const SHAKEMAP_DRAPE_HEIGHT_M = 3000;

/**
 * Rámik [západ, juh, východ, sever] → Cesium.Rectangle, alebo null pri nezmysle. Pure.
 * @param {number[]} bbox
 */
export function shakemapRectangle(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  const [west, south, east, north] = bbox;
  if (!(west < east) || !(south < north) || south < -90 || north > 90 || east - west > 60 || north - south > 60) return null;
  return Cesium.Rectangle.fromDegrees(west, south, east, north);
}

/** USGS ID udalosti z otrasu (riešenie USGS), alebo null. Pure. */
export function shakemapEventId(event) {
  if (!event?.hasShakemap) return null;
  const usgs = Array.isArray(event.solutions) ? event.solutions.find(s => s.source === 'USGS') : null;
  const id = usgs?.sourceId || null;
  return typeof id === 'string' && /^[a-z0-9]{4,24}$/.test(id) ? id : null;
}

/** Obdĺžnik s obrázkom intenzity vo výške SHAKEMAP_DRAPE_HEIGHT_M (vzor radaru SHMÚ). */
function defaultShakemapPrimitive({ rectangle, image }) {
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.RectangleGeometry({ rectangle, height: SHAKEMAP_DRAPE_HEIGHT_M, vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT }),
    }),
    // flat: farba intenzity, nie povrch — bez tieňa nočnej strany (vzor radaru SHMÚ).
    appearance: new Cesium.EllipsoidSurfaceAppearance({ material: Cesium.Material.fromType('Image', { image }), flat: true }),
    asynchronous: false,
    allowPicking: false,
  });
}

export const SHAKEMAP_LEGEND_CSS = `
.quake-shakemap-legend { position:absolute; right:16px; bottom:96px; z-index:5; display:flex; flex-direction:column; gap:5px;
  padding:8px 10px; border-radius:10px; background:#0b1118d9; border:1px solid #ffffff1f; color:#e8edf3;
  font:500 11px/1.3 var(--font-mono, monospace); pointer-events:none; max-width:240px; }
.quake-shakemap-legend[hidden] { display:none; }
.quake-shakemap-scale { display:flex; gap:2px; }
.quake-shakemap-scale span { flex:1; min-width:22px; padding:2px 0; text-align:center; color:#0b1118; font-weight:700; border-radius:2px; }
.quake-shakemap-note { color:#a9b5c3; font-size:10px; }
/* Ľavý stĺpec (vrstvy) zaberá ľavý dolný roh; na telefóne je dole dok — legenda ide vyššie. */
@media (max-width: 700px) { .quake-shakemap-legend { right:10px; bottom:168px; max-width:200px; } }
`;

/**
 * @param {object} viewer Cesium.Viewer
 * @param {object} [o]
 * @param {Function} [o.fetchImpl]
 * @param {Document} [o.document]
 * @param {(img: HTMLImageElement) => Promise<void>} [o.decode] čakanie na dekódovanie obrázka
 * @param {Function} [o.onChange] zavolá sa pri zobrazení/skrytí (vrstva prekreslí kartu)
 */
export function createShakemapOverlay(viewer, { fetchImpl = (...a) => fetch(...a), document: doc = globalThis.document,
  createImage = () => new Image(), onChange = () => {}, createPrimitive = defaultShakemapPrimitive } = {}) {
  const scene = viewer?.scene;
  let primitive = null; let current = null; let generation = 0; let controller = null; let legend = null;

  function ensureLegend() {
    if (legend || !doc?.createElement) return legend;
    const parent = scene?.canvas?.parentElement;
    if (!parent) return null;
    legend = doc.createElement('div'); legend.className = 'quake-shakemap-legend'; legend.hidden = true;
    legend.setAttribute('role', 'note');
    const style = doc.createElement('style'); style.textContent = SHAKEMAP_LEGEND_CSS; legend.appendChild(style);
    const title = doc.createElement('strong'); title.textContent = t('quake.shakemap.legend'); legend.appendChild(title);
    const scale = doc.createElement('div'); scale.className = 'quake-shakemap-scale';
    for (const step of MMI_LEGEND) {
      const cell = doc.createElement('span'); cell.textContent = step.label; cell.style.background = step.color; scale.appendChild(cell);
    }
    legend.appendChild(scale);
    const note = doc.createElement('span'); note.className = 'quake-shakemap-note'; note.textContent = t('quake.shakemap.note'); legend.appendChild(note);
    parent.appendChild(legend);
    return legend;
  }

  function removePrimitive() {
    if (primitive) {
      try { scene?.primitives?.remove(primitive); } catch { /* scéna už zničená */ }
      primitive = null;
    }
    if (legend) legend.hidden = true;
  }

  function hide() {
    generation++; controller?.abort(); controller = null;
    const had = Boolean(primitive) || current !== null;
    removePrimitive(); current = null;
    if (had) { scene?.requestRender?.(); onChange(null); }
  }

  /**
   * Zobraz mapu otrasov k otrasu (ak ju USGS má). Ten istý otras druhýkrát nič nerobí.
   * @returns {Promise<object|null>} metadáta zobrazenej mapy, alebo null
   */
  async function show(event) {
    const id = shakemapEventId(event);
    if (!id) { hide(); return null; }
    if (current?.id === id) return current;
    hide();
    const token = generation; const ctrl = new AbortController(); controller = ctrl;
    try {
      const res = await fetchImpl(`/api/earthquakes/shakemap/${encodeURIComponent(id)}.json`, { signal: ctrl.signal });
      if (!res?.ok) return null;
      const meta = await res.json();
      const rectangle = shakemapRectangle(meta?.bbox);
      if (!rectangle || typeof meta?.image !== 'string' || !meta.image.startsWith('/api/earthquakes/shakemap/')) return null;
      const image = createImage();
      image.crossOrigin = 'anonymous';
      const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      image.src = meta.image;
      await loaded;
      try { await image.decode?.(); } catch { /* onload stačí */ }
      if (token !== generation || !scene?.primitives) return null;
      primitive = createPrimitive({ rectangle, image });
      scene.primitives.add(primitive);
      current = { id, ...meta };
      const node = ensureLegend(); if (node) node.hidden = false;
      scene.requestRender?.();
      onChange(current);
      return current;
    } catch {
      return null;
    } finally {
      if (controller === ctrl) controller = null;
    }
  }

  return {
    show,
    hide,
    /** id udalosti USGS, ktorej mapa je práve na glóbuse */
    get activeId() { return primitive ? current?.id || null : null; },
    destroy() { hide(); legend?.remove(); legend = null; },
  };
}
