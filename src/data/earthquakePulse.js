import * as Cesium from 'cesium';
import { horizonOccluder } from './iconOrientation.js';

export const EARTHQUAKE_PULSE_LIMIT = 24;
export const EARTHQUAKE_PULSE_CANDIDATES = 96;

// Prstenec pulzu (2026-09-06, „sprav pulzar … aby kopíroval guľu"): prstenec
// sa kreslí vo VETVE dotykovej roviny sopky/ohniska — jeho polomer je v METROCH
// podľa magnitúdy a premieta sa cez lokálny východ/sever, takže sa so sklonom
// kamery SKOSÍ do elipsy ležiacej na guli a s diaľkou sa zmenší. Slabé
// zemetrasenie = malý prstenec, silné = veľký.
//
// PREČO STÁLE CSS/DOM a nie 3D geometria: vrstva má tvrdé výkonové piny
// (earthquakes.test.mjs) — žiadny CallbackProperty na clamp-to-ground elipse
// (re-teseluje terén každý frame) a žiadny continuous-render hold. CSS animácia
// beží na kompozítore bez Cesium render lease; poloha/matica sa aktualizuje len
// keď sa scéna aj tak prekresľuje (pohyb kamery). Pri stojacej kamere pulzuje
// samo CSS.

const RING_BASE_PX = 100; // 1 „svetový polomer" = 100 px v priestore matice
const RING_MAX_PX = 420;  // strop na obrazovke (2026-09-06: väčšie, nech vlna vidno)
const RING_MIN_PX = 18;   // podlaha — zďaleka väčšie, ohnisko ostane viditeľné z diaľky

// Pekný pulzar (2026-09-06): ŠTYRI sústredné prstence fázovo posunuté o štvrtinu
// periódy — v každom okamihu pochodujú von štyri línie ako sonar — plus jemný
// dýchajúci halo a jadro. Prstence sú tenké ostré línie (úzky pás v gradiente,
// aby sa neskreslila hrúbka pod maticou dotykovej roviny). PING_COUNT drží počet
// líní a ich oneskorenia synchronizované s testom.
export const EARTHQUAKE_PULSE_RINGS = 4;
const RING_PERIOD_S = 5.2;

export const EARTHQUAKE_PULSE_CSS = `
.quake-pulsars { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:4; }
.quake-pulsar { position:absolute; left:0; top:0; width:0; height:0; color:var(--quake-color); pointer-events:none; }
.quake-plane { position:absolute; left:0; top:0; width:0; height:0; transform-origin:0 0; }
.quake-halo { position:absolute; left:0; top:0; width:200px; height:200px; margin:-100px 0 0 -100px; border-radius:50%;
  background:radial-gradient(circle, currentColor 0%, transparent 62%); opacity:.08; transform:scale(.42);
  animation:quake-halo ${RING_PERIOD_S}s ease-in-out infinite; animation-delay:var(--quake-delay); }
.quake-ping { position:absolute; left:0; top:0; width:200px; height:200px; margin:-100px 0 0 -100px; border-radius:50%; box-sizing:border-box;
  background:radial-gradient(circle, transparent 55%, currentColor 60%, currentColor 62.5%, transparent 70%);
  opacity:0; transform:scale(.06); animation:quake-ping ${RING_PERIOD_S}s cubic-bezier(.2,.55,.3,1) infinite; animation-delay:var(--quake-delay); }
.quake-ping-2 { animation-delay:calc(var(--quake-delay) - 1.3s); }
.quake-ping-3 { animation-delay:calc(var(--quake-delay) - 2.6s); }
.quake-ping-4 { animation-delay:calc(var(--quake-delay) - 3.9s); }
.quake-core { position:absolute; left:0; top:0; width:7px; height:7px; margin:-3.5px 0 0 -3.5px; border-radius:50%;
  background:#fff5e8; border:1px solid currentColor; box-shadow:0 0 5px currentColor, 0 0 12px currentColor; }
.quake-pulsar[data-selected="true"] .quake-core { width:10px; height:10px; margin:-5px 0 0 -5px; outline:1px solid currentColor; outline-offset:4px; }
.quake-pulsar[data-stale="true"] .quake-ping { animation:none; opacity:.14; }
.quake-pulsar[data-stale="true"] .quake-ping-2 { transform:scale(.62); }
.quake-pulsar[data-stale="true"] .quake-ping-3, .quake-pulsar[data-stale="true"] .quake-ping-4, .quake-pulsar[data-stale="true"] .quake-halo { display:none; }
.quake-pulsars[hidden], .quake-pulsar[hidden] { display:none; }
@keyframes quake-ping {
  0% { transform:scale(.06); opacity:0; }
  8% { opacity:.72; }
  55% { opacity:.3; }
  100% { transform:scale(1); opacity:0; }
}
@keyframes quake-halo {
  0%, 100% { transform:scale(.4); opacity:.05; }
  50% { transform:scale(.62); opacity:.13; }
}
/* „Obmedziť pohyb": pulz sa NEzastaví (používateľ ho chce vidieť a vložené
   okno prehliadača hlási reduce vždy), len sa stíši — pomalšia perióda, dva
   prstence namiesto štyroch, bez halo. Reduce = zmierniť, nie vypnúť. */
@media (prefers-reduced-motion:reduce) {
  .quake-ping { animation-duration:8s; }
  .quake-halo { animation-duration:8s; }
  .quake-ping-3, .quake-ping-4 { display:none; }
}
`;

/** Svetový polomer prstenca (m) podľa magnitúdy: zdvojnásobenie na stupeň,
 *  s podlahou a stropom. Slabé malé, silné veľké. Pure. */
export function earthquakeRippleMaxRadius(mag) {
  const m = Number.isFinite(mag) ? mag : 0;
  return Math.max(6000, Math.min(500000, 4000 * Math.pow(2, m - 3)));
}

/** Od tejto magnitúdy sa kreslí prstenec citeľného dosahu (menšie sa cítia len lokálne). */
export const EARTHQUAKE_FELT_MIN_MAG = 4.5;

/**
 * ODHAD polomeru citeľných otrasov (m) z magnitúdy — vzor Sentinel (povrchová
 * vlna). Empiricky ~MMI III: M4,5≈105 km, M5≈150, M6≈300, M7≈600, M8≈1200 km.
 * Je to ODHAD z magnitúdy, nie ShakeMap; hĺbku ani lokálne pomery nezohľadňuje.
 * Pure. @param {number} mag @returns {number}
 */
export function earthquakeFeltRadiusM(mag) {
  const m = Number.isFinite(mag) ? mag : 0;
  return Math.max(30000, Math.min(2000000, 105000 * Math.pow(2, m - 4.5)));
}

export function earthquakePulseStyle(event, now) {
  let hash = 0;
  for (const char of event.id) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  const stale = Boolean(event.stale);
  // Vlna imitujúca otrasy sa rozbieha až po CITEĽNÝ DOSAH (2026-09-06) — pre
  // významné otrasy (M >= 4.5) je to seizmická vlna dobiehajúca k okraju
  // citeľnosti, kde ju čaká statický prstenec; slabšie majú kompaktný pulz.
  const mag = Number(event.mag);
  const maxRadius = Number.isFinite(mag) && mag >= EARTHQUAKE_FELT_MIN_MAG
    ? earthquakeFeltRadiusM(mag)
    : earthquakeRippleMaxRadius(mag);
  return {
    maxRadius,
    color: stale || event.depth === null ? '#a6b1be' : event.depth < 70 ? '#ff6859' : event.depth < 300 ? '#ffad56' : '#ffe08a',
    opacity: stale ? .42 : .48 + .52 * Math.exp(-Math.max(0, now - event.time) / 21_600_000),
    delay: -(hash % 4200) / 1000,
    stale,
  };
}

/**
 * Matica 2×2 (a,b,c,d) mapujúca jednotkový kruh (polomer RING_BASE_PX) na elipsu
 * dotykovej roviny na obrazovke: stĺpce sú premietnuté vektory lokálneho východu
 * a severu (o jeden svetový polomer). So sklonom kamery vznikne skosená elipsa
 * ležiaca na guli. Pri degenerácii (obzor, pól, chýbajúca projekcia) vráti malý
 * izotropný kruh. Pure.
 * @returns {{a:number,b:number,c:number,d:number}}
 */
export function tangentScreenMatrix(p0, pe, pn, { base = RING_BASE_PX, maxPx = RING_MAX_PX, minPx = RING_MIN_PX } = {}) {
  const fallback = () => ({ a: minPx / base, b: 0, c: 0, d: minPx / base });
  if (!p0 || !pe || !pn) return fallback();
  let ux = pe.x - p0.x, uy = pe.y - p0.y, vx = pn.x - p0.x, vy = pn.y - p0.y;
  if (![ux, uy, vx, vy].every(Number.isFinite)) return fallback();
  const lenU = Math.hypot(ux, uy), lenV = Math.hypot(vx, vy);
  const big = Math.max(lenU, lenV);
  if (!(big > 0)) return fallback();
  // Spoločný orez oboch osí — zachová pomer skosenia (elipticitu).
  let k = 1;
  if (big > maxPx) k = maxPx / big;
  else if (big < minPx) k = minPx / big;
  ux *= k; uy *= k; vx *= k; vy *= k;
  return { a: ux / base, b: uy / base, c: vx / base, d: vy / base };
}

/** Screen symbols, capped and spaced; source magnitude/depth remain in labels. */
export function createEarthquakePulse(viewer, { document: doc = globalThis.document,
  now = Date.now, project = Cesium.SceneTransforms.worldToWindowCoordinates,
  occluder = horizonOccluder,
} = {}) {
  const scene = viewer?.scene;
  const parent = scene?.canvas?.parentElement;
  if (!doc?.createElement || !parent || !scene?.postRender?.addEventListener) {
    return { setEvents() {}, setVisible() {}, setSelected() {}, hitTest() { return null; }, destroy() {} };
  }
  const root = doc.createElement('div'); root.className = 'quake-pulsars';
  root.setAttribute('aria-hidden', 'true'); root.hidden = true;
  const style = doc.createElement('style'); style.textContent = EARTHQUAKE_PULSE_CSS;
  root.appendChild(style); parent.appendChild(root);
  const nodes = new Map(); const scratch0 = new Cesium.Cartesian2(); const scratchE = new Cesium.Cartesian2(); const scratchN = new Cesium.Cartesian2();
  const up = new Cesium.Cartesian3(); const east = new Cesium.Cartesian3(); const north = new Cesium.Cartesian3(); const tmp = new Cesium.Cartesian3();
  let records = []; let selectedId = null; let visible = false; let destroyed = false; let hitPoints = [];

  // Premietni bod posunutý o `radius` metrov lokálnym smerom (východ/sever).
  function projectOffset(position, dir, radius, out) {
    if (typeof position?.z !== 'number') return null; // testovací dvojník bez 3D
    Cesium.Cartesian3.multiplyByScalar(dir, radius, tmp);
    Cesium.Cartesian3.add(position, tmp, tmp);
    const p = project(scene, tmp, out);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  }

  function tangentFor(position, radius) {
    if (typeof position?.z !== 'number') return null;
    Cesium.Cartesian3.normalize(position, up);
    Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_Z, up, east);
    if (Cesium.Cartesian3.magnitude(east) < 1e-6) return null; // pól
    Cesium.Cartesian3.normalize(east, east);
    Cesium.Cartesian3.cross(up, east, north);
    const pe = projectOffset(position, east, radius, scratchE);
    const pn = projectOffset(position, north, radius, scratchN);
    return { pe, pn };
  }

  function refresh() {
    root.hidden = !visible || doc.hidden || scene.mode === Cesium.SceneMode.MORPHING;
    if (destroyed || root.hidden) { hitPoints = []; return; }
    const width = scene.canvas.clientWidth; const height = scene.canvas.clientHeight;
    const horizon = occluder(scene.camera);
    const accepted = []; const keep = new Set();
    const selected = records.find(r => r.event.id === selectedId);
    const cohort = records.slice(0, EARTHQUAKE_PULSE_CANDIDATES);
    const candidates = selected ? [selected, ...cohort.filter(r => r !== selected)] : cohort;
    for (const { event, position } of candidates) {
      if (!horizon.isPointVisible(position)) continue;
      const point = project(scene, position, scratch0);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x < 0 || point.y < 0 || point.x > width || point.y > height) continue;
      // Dense swarms get one readable marker per screen neighborhood.
      if (accepted.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 48)) continue;
      const p0 = { x: point.x, y: point.y };
      accepted.push({ x: p0.x, y: p0.y, id: event.id }); keep.add(event.id);
      let node = nodes.get(event.id);
      if (!node) {
        node = doc.createElement('div'); node.className = 'quake-pulsar';
        const plane = doc.createElement('div'); plane.className = 'quake-plane';
        const halo = doc.createElement('i'); halo.className = 'quake-halo'; plane.appendChild(halo);
        // Štyri fázovo posunuté prstence — sonarový pulzar (EARTHQUAKE_PULSE_RINGS).
        for (let i = 1; i <= EARTHQUAKE_PULSE_RINGS; i++) {
          const ping = doc.createElement('i');
          ping.className = i === 1 ? 'quake-ping' : `quake-ping quake-ping-${i}`;
          plane.appendChild(ping);
        }
        const core = doc.createElement('i'); core.className = 'quake-core';
        node.appendChild(plane); node.appendChild(core);
        node._plane = plane;
        nodes.set(event.id, node); root.appendChild(node);
      }
      const look = earthquakePulseStyle(event, now());
      const tangent = tangentFor(position, look.maxRadius);
      const m = tangentScreenMatrix(p0, tangent?.pe, tangent?.pn);
      node.style.setProperty('--quake-color', look.color);
      node.style.setProperty('--quake-delay', look.delay + 's');
      node.style.opacity = String(look.opacity);
      node.style.transform = `translate(${p0.x.toFixed(2)}px,${p0.y.toFixed(2)}px)`;
      (node._plane || node).style.transform = `matrix(${m.a.toFixed(4)},${m.b.toFixed(4)},${m.c.toFixed(4)},${m.d.toFixed(4)},0,0)`;
      node.dataset.selected = String(event.id === selectedId);
      node.dataset.stale = String(look.stale);
      if (accepted.length >= EARTHQUAKE_PULSE_LIMIT) break;
    }
    hitPoints = accepted;
    for (const [id, node] of nodes) if (!keep.has(id)) { node.remove(); nodes.delete(id); }
  }
  const removeRender = scene.postRender.addEventListener(refresh);
  doc.addEventListener('visibilitychange', refresh);
  return {
    hitTest(x, y) { return hitPoints.find(p => Math.hypot(p.x - x, p.y - y) <= 12)?.id || null; },
    setEvents(next) {
      if (destroyed) return;
      // The selected event is admitted separately even when outside the cohort.
      records = next.slice().sort((a, b) => b.event.mag - a.event.mag || a.event.id.localeCompare(b.event.id));
      refresh();
    },
    setSelected(id) { selectedId = id; refresh(); },
    setVisible(value) { visible = Boolean(value); refresh(); },
    destroy() {
      if (destroyed) return;
      destroyed = true; removeRender(); doc.removeEventListener('visibilitychange', refresh);
      root.remove(); nodes.clear(); records = []; hitPoints = [];
    },
  };
}
