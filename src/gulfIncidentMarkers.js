// src/gulfIncidentMarkers.js
//
// Phase B: geolocated open-source incident markers on the globe. Fetches the
// region's news (situationNews.js / GDELT), classifies + geolocates it
// (gulfIncidents.js), and drops coloured points (by severity) at the reported
// places. Clicking a marker opens a small popup with the headline, source, an
// "open source" link, and — always — an "reported · unverified" note. It never
// reproduces media and never presents an event as verified.
//
// Markers live in their own CustomDataSource so they add/clear cleanly without
// touching the scene's chokepoint annotation.

import * as Cesium from 'cesium';
import { buildIncidents } from './data/gulfIncidents.js';
import { fetchSituationNews } from './data/situationNews.js';
import { relativeAge } from './data/situationNews.js';
import { currentLanguage, t } from './i18n.js';

const SEV_COLOR = Object.freeze({ critical: '#f87171', major: '#ffb547', minor: '#39d0ff' });

export function createIncidentMarkers({
  viewer,
  fetch: fetchImpl = fetchSituationNews,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
} = {}) {
  if (!viewer?.entities || !viewer.scene) return { showFor: async () => 0, clear: () => {}, destroy: () => {}, get count() { return 0; } };

  const ds = new Cesium.CustomDataSource('oko-gulf-incidents');
  try { viewer.dataSources.add(ds); } catch { /* headless */ }
  const byId = new Map();
  let handler = null;
  let inFlight = null;
  const cache = new Map(); // region -> { items, at }

  const popup = viewer.container?.ownerDocument?.createElement?.('div');
  if (popup) { popup.className = 'oko-inc-popup'; popup.hidden = true; ensureStyle(popup.ownerDocument); viewer.container.appendChild(popup); }

  function hidePopup() { if (popup) popup.hidden = true; }

  function showPopup(inc, x, y) {
    if (!popup) return;
    const doc = popup.ownerDocument;
    popup.replaceChildren();
    const head = doc.createElement('div');
    head.className = `oko-inc-h oko-inc-${inc.severity}`;
    head.textContent = `${translate(`incident.type-${inc.type}`)} · ${inc.place}${inc.approx ? ` (${translate('incident.approx')})` : ''}`;
    popup.appendChild(head);
    const title = doc.createElement('div');
    title.className = 'oko-inc-title';
    title.textContent = inc.title;
    popup.appendChild(title);
    const meta = doc.createElement('div');
    meta.className = 'oko-inc-meta';
    const age = relativeAge(inc.publishedAt, now(), translate);
    meta.textContent = `${inc.source}${age ? ` · ${age}` : ''}`;
    popup.appendChild(meta);
    const link = doc.createElement('a');
    link.className = 'oko-inc-open';
    link.href = inc.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = translate('incident.open');
    popup.appendChild(link);
    popup.appendChild(makeNote(doc, translate('incident.unverified')));
    popup.hidden = false;
    const cw = viewer.container.clientWidth || 400;
    const pw = popup.offsetWidth || 200;
    popup.style.left = `${Math.max(4, Math.min(cw - pw - 4, x + 12))}px`;
    popup.style.top = `${Math.max(4, y + 12)}px`;
  }

  function installHandler() {
    if (handler) return;
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      const id = picked?.id?.id;
      if (typeof id === 'string' && byId.has(id)) showPopup(byId.get(id), click.position.x, click.position.y);
      else hidePopup();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function clear() {
    try { ds.entities.removeAll(); } catch { /* */ }
    byId.clear();
    hidePopup();
  }

  function draw(items, region) {
    clear();
    const incidents = buildIncidents(items, { region });
    for (const inc of incidents) {
      const color = Cesium.Color.fromCssColorString(SEV_COLOR[inc.severity] || SEV_COLOR.minor);
      const id = `gulf-inc:${inc.url}`;
      ds.entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(inc.lon, inc.lat),
        point: {
          pixelSize: inc.severity === 'critical' ? 12 : 9,
          color: color.withAlpha(0.92),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.65),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(2.0e5, 1.4, 2.0e7, 0.55),
        },
        label: {
          text: `${translate(`incident.type-${inc.type}`)} · ${inc.place}`,
          font: '600 11px "IBM Plex Mono", monospace',
          fillColor: color,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.82),
          pixelOffset: new Cesium.Cartesian2(0, -15),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(2.0e5, 1.0, 1.1e7, 0.0),
          translucencyByDistance: new Cesium.NearFarScalar(2.0e5, 1.0, 1.3e7, 0.0),
        },
      });
      byId.set(id, inc);
    }
    if (incidents.length) installHandler();
    viewer.scene.requestRender?.();
    return incidents.length;
  }

  async function showFor(region = 'gulf') {
    const hit = cache.get(region);
    if (hit && now() - hit.at < 15 * 60_000) return draw(hit.items, region);
    if (!inFlight) inFlight = Promise.resolve(fetchImpl(region)).then((p) => { cache.set(region, { items: p?.items || [], at: now() }); return p; }).finally(() => { inFlight = null; });
    try { const payload = await inFlight; return draw(payload?.items || [], region); }
    catch { return 0; }
  }

  function destroy() {
    clear();
    try { handler?.destroy?.(); } catch { /* */ }
    handler = null;
    try { popup?.remove?.(); } catch { /* */ }
    try { viewer.dataSources.remove(ds, true); } catch { /* */ }
  }

  return { showFor, clear, destroy, get count() { return byId.size; } };
}

function makeNote(doc, text) { const d = doc.createElement('div'); d.className = 'oko-inc-note'; d.textContent = text; return d; }

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-inc-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-inc-style';
  style.textContent = `
.oko-inc-popup{position:absolute;z-index:70;width:236px;max-width:calc(100% - 16px);padding:8px 10px;border-radius:10px;
  background:rgba(11,22,34,.94);border:1px solid rgba(57,208,255,.3);box-shadow:0 6px 22px rgba(0,0,0,.55);backdrop-filter:blur(6px);
  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;color:#dbeafe;pointer-events:auto;}
.oko-inc-popup[hidden]{display:none;}
.oko-inc-h{font-size:9.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;}
.oko-inc-critical{color:#f87171;}
.oko-inc-major{color:#ffb547;}
.oko-inc-minor{color:#39d0ff;}
.oko-inc-title{font-size:11px;line-height:1.3;color:#eaf2ff;margin:3px 0;}
.oko-inc-meta{font-size:9px;color:#6f8398;}
.oko-inc-open{display:inline-block;margin-top:5px;font-size:10px;color:#39d0ff;text-decoration:none;}
.oko-inc-open:hover{color:#8fd9ff;}
.oko-inc-note{margin-top:5px;font-size:8.5px;color:#6f8398;letter-spacing:.02em;}
`;
  (doc.head || doc.documentElement).appendChild(style);
}
