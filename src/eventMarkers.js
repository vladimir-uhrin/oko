// src/eventMarkers.js
/**
 * @module eventMarkers
 * @description Očíslované značky kľúčových momentov udalosti na glóbuse (Udalosti, etapa 2b,
 * 2026-09-30): rovnaké čísla a farba ako na obrázku udalosti a v karte panelu. Výška ako
 * v prehrávači Histórie letov (elipsoid + výška z transpondéra), nech značky sedia na trase.
 * Cesium objekty cez injektovateľnú továreň obrázka — logika sa testuje v Node bez WebGL.
 */
import * as Cesium from 'cesium';
import { eventCamera } from './data/eventPost.js';

export const EVENT_MARKER_COLOR = '#ffb020';
export const EVENT_MARKER_TEXT = '#1a1204';
export const EVENT_MARKER_PX = 24;

const imageCache = new Map();

/** PNG data URL očíslovaného krúžku (kreslí sa raz na číslo). */
export function numberedMarkerImage(n, doc = globalThis.document) {
  if (imageCache.has(n)) return imageCache.get(n);
  const size = 48;
  const canvas = doc.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  g.fillStyle = EVENT_MARKER_COLOR;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = EVENT_MARKER_TEXT;
  g.stroke();
  g.fillStyle = EVENT_MARKER_TEXT;
  g.font = "bold 26px 'Segoe UI', Arial, sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), size / 2, size / 2 + 1);
  const url = canvas.toDataURL('image/png');
  imageCache.set(n, url);
  return url;
}

/**
 * @param {object} viewer Cesium Viewer
 * @param {{image?: (n: number) => string}} [deps]
 */
export function createEventMarkers(viewer, { image = numberedMarkerImage } = {}) {
  let added = [];
  const api = {
    /** Značky momentov (čísla 1…N v poradí momentov); predošlé zmaže. */
    show(moments) {
      api.clear();
      (moments || []).forEach((m, i) => {
        if (!Number.isFinite(m?.lat) || !Number.isFinite(m?.lon)) return;
        const entity = viewer?.entities?.add?.({
          id: `oko-event-moment:${i + 1}`,
          position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, Math.max(0, m.alt ?? 0)),
          billboard: {
            image: image(i + 1),
            width: EVENT_MARKER_PX,
            height: EVENT_MARKER_PX,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(2e4, 1.3, 8e6, 0.8),
          },
        });
        if (entity) added.push(entity);
      });
      viewer?.scene?.requestRender?.();
    },
    clear() {
      for (const entity of added) viewer?.entities?.remove?.(entity);
      added = [];
      viewer?.scene?.requestRender?.();
    },
    /** Prelet nad udalosť (zvisle nadol, rovnaký záber ako odkaz z príspevku). */
    flyTo(view) {
      const cam = eventCamera({ firstT: view?.firstT, lastT: view?.lastT, timeline: view?.moments || [], track: view?.track || [] });
      if (!cam || !viewer?.camera?.flyTo) return false;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, cam.alt),
        orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
        duration: 2,
      });
      return true;
    },
    count: () => added.length,
  };
  return api;
}
