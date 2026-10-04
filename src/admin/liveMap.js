// Admin panel OKO (2026-10-04) — mapa živých návštevníkov v štýle OKO (záložka Naživo).
// Canvas bez knižnice: pevnina, hranice a mestá Natural Earth (public domain), azúrové body s pulzom,
// HUD rohy a hodiny. Body prichádzajú z /api/admin/live; poloha je mesto (Cloudflare,
// zaokrúhlené na 0,1°) alebo hlavné mesto krajiny, keď presnejšia poloha chýba.

// minPop = najmenší počet obyvateľov (tisíce) mesta s popisom; capitals = hlavné mestá vždy.
export const VIEWS = {
  world: { label: 'Svet', lon: [-180, 180], lat: [-58, 80], grid: 30, minPop: Infinity, capitals: false },
  europe: { label: 'Európa', lon: [-25, 45], lat: [34, 71], grid: 10, minPop: Infinity, capitals: true },
  central: { label: 'Stredná Európa', lon: [8, 28], lat: [45, 53], grid: 2, minPop: 200, capitals: true },
};

const ACCENT = '#00d4ff';

/** Ekvidistantná projekcia so stlačením dĺžky cos(stred) — v regióne nevyzerá roztiahnuto. */
export function makeProjection(view, width, height, pad = 8) {
  const midLat = (view.lat[0] + view.lat[1]) / 2;
  const k = Math.cos(midLat * Math.PI / 180) || 1;
  const spanX = (view.lon[1] - view.lon[0]) * k;
  const spanY = view.lat[1] - view.lat[0];
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return {
    scale,
    project: (lon, lat) => [offX + (lon - view.lon[0]) * k * scale, offY + (view.lat[1] - lat) * scale],
  };
}

/** Výška plátna podľa pomeru strán pohľadu (svet je plochý, stredná Európa vyššia). */
export function canvasHeight(view, width) {
  const midLat = (view.lat[0] + view.lat[1]) / 2;
  const ratio = (view.lat[1] - view.lat[0]) / ((view.lon[1] - view.lon[0]) * Math.cos(midLat * Math.PI / 180));
  return Math.round(Math.min(620, Math.max(240, width * ratio)));
}

/**
 * Zhluky bodov blízko seba na obrazovke (body bez polohy sa vynechajú).
 * @returns {{x: number, y: number, items: object[], precise: boolean}[]}
 */
export function clusterPoints(visitors, project, radius = 14) {
  const clusters = [];
  for (const visitor of visitors) {
    if (!Number.isFinite(visitor.lat) || !Number.isFinite(visitor.lon)) continue;
    const [x, y] = project(visitor.lon, visitor.lat);
    const hit = clusters.find(c => Math.hypot(c.x - x, c.y - y) <= radius);
    if (hit) {
      hit.items.push(visitor);
      hit.x = (hit.x * (hit.items.length - 1) + x) / hit.items.length;
      hit.y = (hit.y * (hit.items.length - 1) + y) / hit.items.length;
      hit.precise ||= visitor.precision === 'city';
    } else clusters.push({ x, y, items: [visitor], precise: visitor.precision === 'city' });
  }
  return clusters.sort((a, b) => a.items.length - b.items.length);
}

/**
 * Mestá s popisom v pohľade, od najväčšieho, bez prekrytia popisov.
 * @param {Array} places riadky places.json [name, lat, lon, popK, rank, iso2, capital]
 * @returns {{name: string, x: number, y: number, capital: boolean}[]}
 */
export function placeLabels(places, view, project, measure = name => name.length * 6.2) {
  const boxes = [];
  const out = [];
  const candidates = places.filter(([, lat, lon, pop, , , capital]) => lon >= view.lon[0] && lon <= view.lon[1]
    && lat >= view.lat[0] && lat <= view.lat[1] && ((view.capitals && capital) || pop >= view.minPop))
    .sort((a, b) => (b[6] - a[6]) || (b[3] - a[3]));
  for (const [name, lat, lon, , , , capital] of candidates) {
    const [x, y] = project(lon, lat);
    const box = [x - 3, y - 7, x + 7 + measure(name), y + 7];
    if (boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    out.push({ name, x, y, capital: Boolean(capital) });
  }
  return out;
}

/** Pohľad, ktorý ukáže všetkých živých: ak sú všetci v strednej Európe, priblížiť. */
export function autoView(visitors) {
  const located = visitors.filter(v => Number.isFinite(v.lat) && Number.isFinite(v.lon));
  if (!located.length) return 'world';
  const inside = view => located.every(v => v.lon >= view.lon[0] && v.lon <= view.lon[1] && v.lat >= view.lat[0] && v.lat <= view.lat[1]);
  if (inside(VIEWS.central)) return 'central';
  if (inside(VIEWS.europe)) return 'europe';
  return 'world';
}

const clockFmt = new Intl.DateTimeFormat('sk-SK', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Bratislava' });

/**
 * @param {HTMLElement} container
 * @param {{rings: number[][][], borders?: number[][][], places?: Array, describe: (cluster: object) => string[]}} options
 */
export function createLiveMap(container, { rings, borders = [], places = [], describe }) {
  const wrap = document.createElement('div');
  wrap.className = 'live-map';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  const tip = document.createElement('div');
  tip.className = 'live-map-tip';
  tip.hidden = true;
  wrap.append(canvas, tip);
  container.append(wrap);

  let viewKey = 'world';
  let visitors = [];
  let note = '';
  let width = 0; let height = 0; let dpr = 1;
  let projection = null;
  let land = null; // offscreen vrstva pevniny
  let clusters = [];
  let frame = 0;
  let hover = null;
  const born = new Map(); // kľúč bodu → čas, kedy sa objavil (vlna pri novom návštevníkovi)

  function layout() {
    width = Math.max(280, Math.round(wrap.clientWidth || container.clientWidth || 720));
    height = canvasHeight(VIEWS[viewKey], width);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    projection = makeProjection(VIEWS[viewKey], width, height);
    recluster();
    drawLand();
  }

  function drawLand() {
    land = document.createElement('canvas');
    land.width = canvas.width; land.height = canvas.height;
    const g = land.getContext('2d');
    g.scale(dpr, dpr);
    const sea = g.createRadialGradient(width / 2, height * 0.35, 0, width / 2, height * 0.35, Math.max(width, height) * 0.75);
    sea.addColorStop(0, '#0a1a26'); sea.addColorStop(1, '#04080d');
    g.fillStyle = sea; g.fillRect(0, 0, width, height);
    const view = VIEWS[viewKey];
    const { project } = projection;
    // Mriežka poludníkov a rovnobežiek.
    g.strokeStyle = '#ffffff0b'; g.lineWidth = 1;
    g.beginPath();
    for (let lon = Math.ceil(view.lon[0] / view.grid) * view.grid; lon <= view.lon[1]; lon += view.grid) {
      const [x1, y1] = project(lon, view.lat[0]); const [x2, y2] = project(lon, view.lat[1]);
      g.moveTo(x1, y1); g.lineTo(x2, y2);
    }
    for (let lat = Math.ceil(view.lat[0] / view.grid) * view.grid; lat <= view.lat[1]; lat += view.grid) {
      const [x1, y1] = project(view.lon[0], lat); const [x2, y2] = project(view.lon[1], lat);
      g.moveTo(x1, y1); g.lineTo(x2, y2);
    }
    g.stroke();
    // Pevnina: tmavá výplň a tenký azúrový obrys (ako pobrežie na glóbuse OKO).
    const path = new Path2D();
    const lonPad = (view.lon[1] - view.lon[0]) * 0.2; const latPad = (view.lat[1] - view.lat[0]) * 0.2;
    for (const ring of rings) {
      if (!ring.some(([lon, lat]) => lon >= view.lon[0] - lonPad && lon <= view.lon[1] + lonPad && lat >= view.lat[0] - latPad && lat <= view.lat[1] + latPad)) continue;
      ring.forEach(([lon, lat], i) => { const [x, y] = project(lon, lat); if (i) path.lineTo(x, y); else path.moveTo(x, y); });
      path.closePath();
    }
    g.fillStyle = '#0f2331'; g.fill(path);
    // Hranice štátov: tenké, tlmené — orientácia, nie obsah.
    const lines = new Path2D();
    for (const line of borders) {
      if (!line.some(([lon, lat]) => lon >= view.lon[0] - lonPad && lon <= view.lon[1] + lonPad && lat >= view.lat[0] - latPad && lat <= view.lat[1] + latPad)) continue;
      line.forEach(([lon, lat], i) => { const [x, y] = project(lon, lat); if (i) lines.lineTo(x, y); else lines.moveTo(x, y); });
    }
    g.strokeStyle = '#8fa6b640'; g.lineWidth = viewKey === 'world' ? 0.5 : 0.9;
    g.setLineDash(viewKey === 'world' ? [] : [4, 3]); g.stroke(lines); g.setLineDash([]);
    g.strokeStyle = '#00d4ff40'; g.lineWidth = 0.8; g.stroke(path);
    // Mestá: bodka a meno v mono písme (popisy sa neprekrývajú).
    g.font = '10.5px "JetBrains Mono", ui-monospace, Consolas, monospace';
    g.textBaseline = 'middle';
    // Mesto pod bodom návštevníka sa vynechá — bublina ho pomenuje.
    const free = place => {
      const right = place.x + 8 + g.measureText(place.name).width;
      return !clusters.some(c => c.x > place.x - 22 && c.x < right + 22 && Math.abs(c.y - place.y) < 22);
    };
    for (const place of placeLabels(places, view, project, name => g.measureText(name).width).filter(free)) {
      g.fillStyle = place.capital ? '#c8d9e4' : '#8fa6b6';
      g.fillRect(place.x - 1.5, place.y - 1.5, 3, 3);
      g.fillStyle = place.capital ? '#c8d9e4b0' : '#8fa6b690';
      g.fillText(place.name, place.x + 6, place.y);
    }
  }

  function recluster() {
    if (!projection) return;
    const now = performance.now();
    clusters = clusterPoints(visitors, projection.project, viewKey === 'world' ? 12 : 16);
    const keys = new Set();
    for (const c of clusters) {
      c.key = c.items.map(v => `${v.lat},${v.lon}`).sort()[0];
      keys.add(c.key);
      if (!born.has(c.key)) born.set(c.key, now);
    }
    for (const key of born.keys()) if (!keys.has(key)) born.delete(key);
  }

  function hud(g, time) {
    const c = 16; const m = 10;
    g.strokeStyle = '#00d4ffaa'; g.lineWidth = 1.5;
    g.beginPath();
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [width - m, m, -1, 1], [m, height - m, 1, -1], [width - m, height - m, -1, -1]]) {
      g.moveTo(x, y + dy * c); g.lineTo(x, y); g.lineTo(x + dx * c, y);
    }
    g.stroke();
    g.font = '600 11px "JetBrains Mono", ui-monospace, Consolas, monospace';
    g.textBaseline = 'top';
    // Blikajúca bodka NAŽIVO.
    const blink = 0.55 + 0.45 * Math.sin(time / 380);
    g.fillStyle = `rgba(255, 77, 77, ${blink.toFixed(2)})`;
    g.beginPath(); g.arc(m + 22, m + 13, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8f1f7';
    g.fillText('OKO · NAŽIVO', m + 32, m + 7);
    g.textAlign = 'right';
    g.fillText(clockFmt.format(new Date()), width - m - 10, m + 7);
    g.font = '10px "JetBrains Mono", ui-monospace, Consolas, monospace';
    g.fillStyle = '#8fa6b6';
    g.textBaseline = 'bottom';
    if (note) g.fillText(note, width - m - 10, height - m - 6);
    g.textAlign = 'left';
    g.fillText('okolive.sk · Natural Earth', m + 10, height - m - 6);
  }

  function draw(time) {
    if (!canvas.isConnected) { stop(); return; }
    frame = requestAnimationFrame(draw);
    if (document.hidden || !land) return;
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(land, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const now = performance.now();
    for (const cluster of clusters) {
      const n = cluster.items.length;
      // Malá mapa (mobil) = menšie body aj vlny, nech neprekryjú celý kontinent.
      const small = width < 520 ? 0.6 : 1;
      const r = Math.min(14, 3.5 + Math.sqrt(n) * 2.2) * small;
      const { x, y } = cluster;
      // Pulz: dva krúžky s posunutou fázou; nový bod dostane silnejšiu vlnu na 4 s.
      const age = now - (born.get(cluster.key) ?? 0);
      for (const shift of [0, 0.5]) {
        const phase = ((time / 2200) + shift + (cluster.x % 7) / 7) % 1;
        g.strokeStyle = `rgba(0, 212, 255, ${(0.55 * (1 - phase)).toFixed(3)})`;
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(x, y, r + phase * (r * 2.6 + 8) * small, 0, Math.PI * 2); g.stroke();
      }
      if (age < 4000) {
        const p = age / 4000;
        g.strokeStyle = `rgba(232, 241, 247, ${(0.8 * (1 - p)).toFixed(3)})`;
        g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, r + p * 60 * small, 0, Math.PI * 2); g.stroke();
      }
      const glow = g.createRadialGradient(x, y, 0, x, y, r * 3);
      glow.addColorStop(0, 'rgba(0, 212, 255, 0.45)'); glow.addColorStop(1, 'rgba(0, 212, 255, 0)');
      g.fillStyle = glow;
      g.beginPath(); g.arc(x, y, r * 3, 0, Math.PI * 2); g.fill();
      if (cluster.precise) {
        g.fillStyle = ACCENT;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#e8fbff';
        g.beginPath(); g.arc(x, y, Math.max(1.5, r * 0.35), 0, Math.PI * 2); g.fill();
      } else {
        // Len krajina: prerušovaný krúžok v hlavnom meste.
        g.setLineDash([3, 3]);
        g.strokeStyle = ACCENT; g.lineWidth = 1.6;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
      if (n > 1) {
        g.font = '600 10.5px "JetBrains Mono", ui-monospace, Consolas, monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = cluster.precise ? '#04121a' : '#e8f1f7';
        g.fillText(String(n), x, y + 0.5);
        g.textAlign = 'left';
      }
      if (hover === cluster) {
        g.strokeStyle = '#ffffff'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, r + 4, 0, Math.PI * 2); g.stroke();
      }
    }
    hud(g, time);
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left; const y = event.clientY - rect.top;
    let best = null; let bestD = 22;
    for (const cluster of clusters) {
      const d = Math.hypot(cluster.x - x, cluster.y - y);
      if (d < bestD) { best = cluster; bestD = d; }
    }
    hover = best;
    canvas.style.cursor = best ? 'pointer' : '';
    if (!best) { tip.hidden = true; return; }
    tip.replaceChildren(...describe(best).map((line, i) => {
      const row = document.createElement('div');
      row.className = i ? 'live-map-tip-row' : 'live-map-tip-head';
      row.textContent = line;
      return row;
    }));
    tip.hidden = false;
    const left = Math.min(Math.max(8, best.x + 16), width - tip.offsetWidth - 8);
    const top = best.y + 16 + tip.offsetHeight > height ? best.y - tip.offsetHeight - 12 : best.y + 16;
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(8, top)}px`;
  }
  canvas.addEventListener('pointermove', pick);
  canvas.addEventListener('pointerdown', pick);
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; });

  const resize = new ResizeObserver(() => {
    const next = Math.round(wrap.clientWidth);
    if (next && Math.abs(next - width) > 2) layout();
  });
  resize.observe(wrap);

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    resize.disconnect();
  }

  layout();
  frame = requestAnimationFrame(draw);

  return {
    setData(next, { note: nextNote = '' } = {}) { visitors = next; note = nextNote; recluster(); if (projection) drawLand(); if (hover) { hover = null; tip.hidden = true; } },
    setView(key) { if (VIEWS[key] && key !== viewKey) { viewKey = key; layout(); } },
    get view() { return viewKey; },
    stop,
  };
}
