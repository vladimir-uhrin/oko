// scripts/lib/reelV3/engine.js — reel v3 (2026-10-17, vlastník k v2: „slabá grafika, obsah aj hudba"): celý obraz
// kreslí plátno 1080×1920 v Chrome (Puppeteer, bez servera — súbory podáva zachytávanie požiadaviek).
// Scény: map (nočná mapa z OSM/Natural Earth, animované trasy lietadiel z histórie OKO, hodiny, piny, veľké číslo),
// bars (stĺpce), compare (dve dlhé čísla), photo (Ken Burns nad rozmazaným pozadím), video (snímky z ffmpeg), end.
// Nad scénou: titulky po skupinách slov, štítok, značka okolive.sk, priebeh, zdroj záberu.
// Node volá window.reel.init(spec) a potom window.reel.frame(t) → JPEG (base64) pre každú snímku.

const W = 1080; const H = 1920;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha: false });
const layer = Object.assign(document.createElement('canvas'), { width: W, height: H });
const lctx = layer.getContext('2d');
const mapCache = Object.assign(document.createElement('canvas'), { width: W, height: H });
const mctx = mapCache.getContext('2d');
let mapCacheKey = '';

let SPEC = null;
const DATA = {};
const IMG = new Map();

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - (1 - clamp(k)) ** 3;
const easeIn = (k) => clamp(k) ** 3;
const easeInOut = (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
const easeOutBack = (k) => { k = clamp(k); const c1 = 1.5; const c3 = c1 + 1; return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2; };
const EASE = { linear: (k) => clamp(k), out: easeOut, in: easeIn, inOut: easeInOut };

const COLORS = {
  bg0: '#03060c', bg1: '#081322', accent: '#00d4ff', amber: '#ffb33c', red: '#ff3b3b', yellow: '#ffd400',
  text: '#ffffff', muted: 'rgba(214,228,240,0.72)',
};
const FONT = { sans: 'Inter, "Segoe UI", Arial, sans-serif', disp: 'Bahnschrift, "Arial Narrow", Arial, sans-serif' };

// ---------- načítanie ----------
async function loadImage(url) {
  if (IMG.has(url)) return IMG.get(url);
  const img = new Image();
  img.decoding = 'sync';
  const p = new Promise((res, rej) => { img.onload = () => res(img); img.onerror = () => rej(new Error(`obrázok ${url}`)); });
  img.src = url;
  await p;
  IMG.set(url, img);
  return img;
}

async function init(spec) {
  SPEC = spec;
  for (const f of spec.fonts || []) {
    const face = new FontFace(f.family, f.src, { weight: f.weight || 'normal', stretch: f.stretch || 'normal', unicodeRange: f.unicodeRange || 'U+0-10FFFF' });
    document.fonts.add(face);
    await face.load();
  }
  // Bahnschrift (systémové, premenlivé) — načítať všetky rezy, ktoré kreslíme
  await Promise.all(['700', '600', '400'].map((w) => document.fonts.load(`${w} 100px Bahnschrift`).catch(() => null)));
  for (const [k, url] of Object.entries(spec.data || {})) DATA[k] = await (await fetch(url)).json();
  for (const url of spec.preload || []) await loadImage(url);
  prepFlights();
  return { ok: true, fonts: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`) };
}

// ---------- projekcia (Mercator) ----------
const D2R = Math.PI / 180;
const MY = (lat) => Math.log(Math.tan(Math.PI / 4 + (clamp(lat, -85, 85) * D2R) / 2));
function camAt(scene, t) {
  const a = scene.cam; const b = scene.camTo;
  if (!b) return a;
  const k = (EASE[scene.camEase || 'inOut'])((t - (scene.camFrom ?? scene.start)) / ((scene.camUntil ?? scene.end) - (scene.camFrom ?? scene.start)));
  return { lon: lerp(a.lon, b.lon, k), lat: lerp(a.lat, b.lat, k), km: Math.exp(lerp(Math.log(a.km), Math.log(b.km), k)), cy: lerp(a.cy ?? H * 0.5, b.cy ?? H * 0.5, k) };
}
function projector(cam) {
  const s = (W * 6371 * Math.cos(cam.lat * D2R)) / cam.km; // px na radián Mercatora
  const cx = cam.lon * D2R; const cy = MY(cam.lat); const oy = cam.cy ?? H * 0.5;
  const f = (lon, lat) => [W / 2 + (lon * D2R - cx) * s, oy - (MY(lat) - cy) * s];
  f.pxPerKm = s / (6371 * Math.cos(cam.lat * D2R));
  f.inv = (x, y) => [((x - W / 2) / s + cx) / D2R, (2 * Math.atan(Math.exp((oy - y) / s + cy)) - Math.PI / 2) / D2R];
  return f;
}

// ---------- podklad ----------
function strokeLines(c, P, lines, view) {
  c.beginPath();
  for (const l of lines) {
    const pts = l.pts || l;
    if (pts.length < 2) continue;
    const b = l.bb || (l.bb = bbox(pts));
    if (b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3]) continue;
    let [x, y] = P(pts[0][0], pts[0][1]);
    c.moveTo(x, y);
    for (let i = 1; i < pts.length; i += 1) { [x, y] = P(pts[i][0], pts[i][1]); c.lineTo(x, y); }
  }
  c.stroke();
}
function fillRings(c, P, rings, view) {
  c.beginPath();
  for (const r of rings) {
    const pts = r.pts || r;
    if (pts.length < 3) continue;
    const b = r.bb || (r.bb = bbox(pts));
    if (b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3]) continue;
    let [x, y] = P(pts[0][0], pts[0][1]);
    c.moveTo(x, y);
    for (let i = 1; i < pts.length; i += 1) { [x, y] = P(pts[i][0], pts[i][1]); c.lineTo(x, y); }
    c.closePath();
  }
  c.fill();
}
function bbox(pts) {
  let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity;
  for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  return [a, b, c, d];
}
function viewOf(P) {
  const [w, n] = P.inv(-60, -60); const [e, s] = P.inv(W + 60, H + 60);
  return [w, s, e, n];
}

function drawBackground(c) {
  const g = c.createRadialGradient(W / 2, H * 0.45, 80, W / 2, H * 0.45, H * 0.75);
  g.addColorStop(0, '#0b1830'); g.addColorStop(0.55, '#060e1c'); g.addColorStop(1, '#02050a');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
}

function drawOsmBase(c, P, cam) {
  const bm = DATA.basemap; if (!bm) return;
  const view = viewOf(P);
  const k = clamp(P.pxPerKm / 5, 0.35, 3); // hrúbky podľa mierky (≈5 px/km = Moskva v celom ráme)
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.fillStyle = '#0a1d31'; fillRings(c, P, bm.water, view);
  c.strokeStyle = 'rgba(34,74,116,0.30)'; c.lineWidth = 1.0 * k; strokeLines(c, P, bm.river, view);
  c.strokeStyle = 'rgba(52,118,182,0.62)'; c.lineWidth = 2.2 * k; strokeLines(c, P, bm.riverMajor, view);
  c.strokeStyle = 'rgba(120,142,178,0.30)'; c.lineWidth = 1.3 * k; strokeLines(c, P, bm.trunk, view);
  c.strokeStyle = 'rgba(176,196,228,0.50)'; c.lineWidth = 2.3 * k; strokeLines(c, P, bm.motorway, view);
  // dráhy letísk: skutočná šírka (m) v mierke, najmenej 2 px
  c.strokeStyle = 'rgba(190,210,235,0.9)'; c.lineCap = 'butt';
  for (const r of bm.runway) { c.lineWidth = Math.max(2, (r.width / 1000) * P.pxPerKm); strokeLines(c, P, [r], view); }
  c.lineCap = 'round';
}

function drawWorldBase(c, P) {
  const land = DATA.land; const borders = DATA.borders; if (!land) return;
  const view = viewOf(P);
  // more tmavšie než pevnina, hranice zreteľné
  c.fillStyle = '#02050b'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#0f2036'; fillRings(c, P, land.rings || land.features || land, view);
  if (borders) { c.strokeStyle = 'rgba(150,185,235,0.75)'; c.lineWidth = 2.2; c.lineJoin = 'round'; strokeLines(c, P, borders.lines || borders, view); }
}

function drawGlow(c, P, g) {
  const [x, y] = P(g.lon, g.lat); const r = g.km * P.pxPerKm;
  const grad = c.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, hexA(g.color || '#ffb347', g.a ?? 0.16)); grad.addColorStop(1, hexA(g.color || '#ffb347', 0));
  c.fillStyle = grad; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
}

function drawMapBase(c, scene, cam, P) {
  const key = JSON.stringify([scene.base, scene.glow || null, cam.lon.toFixed(5), cam.lat.toFixed(5), cam.km.toFixed(3), cam.cy]);
  if (key !== mapCacheKey) {
    drawBackground(mctx);
    if (scene.glow) drawGlow(mctx, P, scene.glow);
    if (scene.base === 'world' || scene.base === 'world+osm') drawWorldBase(mctx, P);
    if (scene.base !== 'world') drawOsmBase(mctx, P, cam);
    mapCacheKey = key;
  }
  c.drawImage(mapCache, 0, 0);
}

/** Kruh okolia (napr. 100 km od Moskvy) — čiarkovaný, s popisom. */
function drawCircle(c, scene, P, t) {
  const ci = scene.circle; if (!ci) return;
  const k = easeOut((t - (ci.appear ?? scene.start)) / 0.5);
  if (k <= 0) return;
  const [x, y] = P(ci.lon, ci.lat); const r = ci.km * P.pxPerKm;
  c.save();
  c.globalAlpha = k * (ci.alpha ?? 1);
  c.setLineDash([18, 14]); c.lineDashOffset = -t * 30;
  c.strokeStyle = ci.color || 'rgba(255,255,255,0.55)'; c.lineWidth = 3;
  c.beginPath(); c.arc(x, y, r * lerp(0.92, 1, k), 0, Math.PI * 2); c.stroke();
  c.setLineDash([]);
  if (ci.label) {
    c.font = `700 30px ${FONT.sans}`; c.letterSpacing = '3px'; c.textAlign = 'center';
    c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineJoin = 'round';
    c.strokeText(ci.label, x, y + r + 44); c.fillStyle = ci.labelColor || 'rgba(255,255,255,0.8)'; c.fillText(ci.label, x, y + r + 44);
  }
  c.restore();
}

// ---------- lietadlá ----------
const FLIGHTS = [];
function prepFlights() {
  FLIGHTS.length = 0;
  const src = DATA.flights; if (!src) return;
  for (const [icao, fx] of Object.entries(src)) {
    // len vo vzduchu: body na zemi (rolovanie po letisku) by kreslili „hviezdu" na stojánkach
    const pts = fx.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && !p.gnd).sort((a, b) => a.t - b.t);
    if (pts.length) FLIGHTS.push({ icao, pts });
  }
}
const PLANE = new Path2D('M0,-30 C3,-30 4,-25 4,-19 L4,-8 L28,5 L28,10 L4,3 L3,17 L10,23 L10,27 L0,24 L-10,27 L-10,23 L-3,17 L-4,3 L-28,10 L-28,5 L-4,-8 L-4,-19 C-4,-25 -3,-30 0,-30 Z');

/** Trasy do simulovaného času `s`: [{segs:[[x1,y1,x2,y2,age]], head:{x,y,ang}|null}] */
function flightState(P, s, maxGap) {
  const out = [];
  for (const f of FLIGHTS) {
    const pts = f.pts;
    if (pts[0].t > s) continue;
    const segs = [];
    let head = null;
    let i = 1;
    for (; i < pts.length && pts[i].t <= s; i += 1) {
      const a = pts[i - 1]; const b = pts[i];
      if (b.t - a.t > maxGap) continue;
      const [x1, y1] = P(a.lon, a.lat); const [x2, y2] = P(b.lon, b.lat);
      segs.push([x1, y1, x2, y2, s - b.t]);
    }
    const last = pts[i - 1];
    const next = pts[i];
    if (next && next.t - last.t <= maxGap) {
      const k = (s - last.t) / (next.t - last.t);
      const lon = lerp(last.lon, next.lon, k); const lat = lerp(last.lat, next.lat, k);
      const [x1, y1] = P(last.lon, last.lat); const [x2, y2] = P(lon, lat);
      segs.push([x1, y1, x2, y2, 0]);
      const [nx, ny] = P(next.lon, next.lat);
      head = { x: x2, y: y2, ang: Math.atan2(ny - y1, nx - x1) };
    } else if (s - last.t < 240) {
      // posledný bod: lietadlo ešte chvíľu ukázať v smere poslednej úsečky
      const [x2, y2] = P(last.lon, last.lat);
      const prev = pts[i - 2];
      let ang = -Math.PI / 2;
      if (prev) { const [x1, y1] = P(prev.lon, prev.lat); ang = Math.atan2(y2 - y1, x2 - x1); }
      head = { x: x2, y: y2, ang, fading: (s - last.t) / 240 };
    }
    // body, ktoré nemajú súseda do maxGap (osamelé zachytenie) — bodka namiesto čiary
    const blips = [];
    for (let j = 0; j < i; j += 1) {
      const p = pts[j]; const prevOk = j > 0 && p.t - pts[j - 1].t <= maxGap; const nextOk = j + 1 < pts.length && pts[j + 1].t - p.t <= maxGap && pts[j + 1].t <= s + maxGap;
      if (!prevOk && !nextOk) { const [x, y] = P(p.lon, p.lat); blips.push([x, y, s - p.t]); }
    }
    out.push({ segs, head, blips, icao: f.icao });
  }
  return out;
}

function drawFlights(c, scene, P, t) {
  const fl = scene.flights;
  const k = (EASE[fl.ease || 'linear'])((t - scene.start) / ((fl.until ?? scene.end) - scene.start));
  const s = lerp(fl.simFrom, fl.simTo, k);
  let vanish = 1;
  if (fl.vanishAt != null) vanish = 1 - clamp((t - fl.vanishAt) / (fl.vanishDur || 0.3));
  if (vanish <= 0) return { s, visible: 0 };
  const st = flightState(P, s, fl.maxGap || 600);
  c.save();
  c.globalCompositeOperation = 'screen';
  c.lineCap = 'round'; c.lineJoin = 'round';
  const trailK = fl.trailWidth || 1;
  for (const pass of [{ w: 20, a: 0.10 }, { w: 8, a: 0.24 }, { w: 3.6, a: 0.95 }]) {
    c.lineWidth = pass.w * trailK;
    for (const f of st) {
      for (const [x1, y1, x2, y2, age] of f.segs) {
        const fade = fl.persist ? 1 : clamp(1 - age / (fl.trailLife || 3600), 0.25, 1);
        c.strokeStyle = `rgba(255,${pass.w > 3 ? 150 : 196},${pass.w > 3 ? 40 : 90},${pass.a * fade * vanish})`;
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      }
    }
  }
  // osamelé zachytenia: krátky záblesk, potom tlmená bodka
  for (const f of st) {
    for (const [x, y, age] of f.blips) {
      const fresh = clamp(1 - age / 600);
      const r = 5 + fresh * 10;
      c.fillStyle = `rgba(255,190,80,${(0.35 + 0.5 * fresh) * vanish})`;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
  }
  c.restore();
  let visible = 0;
  for (const f of st) {
    if (!f.head) continue;
    visible += 1;
    const a = vanish * (f.head.fading != null ? 1 - f.head.fading : 1);
    const g = c.createRadialGradient(f.head.x, f.head.y, 0, f.head.x, f.head.y, 22);
    g.addColorStop(0, `rgba(255,220,140,${0.4 * a})`); g.addColorStop(1, 'rgba(255,180,60,0)');
    c.fillStyle = g; c.beginPath(); c.arc(f.head.x, f.head.y, 22, 0, Math.PI * 2); c.fill();
    c.save(); c.translate(f.head.x, f.head.y); c.rotate(f.head.ang + Math.PI / 2); c.scale(1.15 * (fl.planeScale || 1), 1.15 * (fl.planeScale || 1));
    c.globalAlpha = a; c.fillStyle = '#fff3d6'; c.strokeStyle = 'rgba(40,20,0,0.9)'; c.lineWidth = 2.5;
    c.stroke(PLANE); c.fill(PLANE);
    c.restore();
  }
  return { s, visible };
}

// ---------- prvky mapy ----------
function drawPins(c, scene, P, t) {
  for (const p of scene.pins || []) {
    const appear = p.appear ?? scene.start;
    const k = easeOutBack((t - appear) / 0.35);
    if (k <= 0) continue;
    const [x, y] = P(p.lon, p.lat);
    const col = p.color || COLORS.accent;
    // pulz
    if (p.pulse) {
      const ph = ((t - appear) % 1.4) / 1.4;
      c.strokeStyle = hexA(col, 0.7 * (1 - ph)); c.lineWidth = 4;
      c.beginPath(); c.arc(x, y, 14 + ph * 60, 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 4;
    c.beginPath(); c.arc(x, y, 14 * k, 0, Math.PI * 2); c.stroke(); c.fill();
    if (p.label) {
      const side = p.side || 'right';
      const fs = p.size || 46;
      c.font = `700 ${fs}px ${FONT.sans}`;
      const tw = c.measureText(p.label).width;
      const lx = side === 'left' ? x - 24 - tw : x + 24;
      const ly = y + fs * 0.35;
      c.globalAlpha = clamp(k);
      c.lineWidth = 8; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.lineJoin = 'round';
      c.strokeText(p.label, lx, ly); c.fillStyle = '#fff'; c.fillText(p.label, lx, ly);
      if (p.stamp && t >= (p.stampAt ?? appear)) {
        const sk = easeOutBack((t - (p.stampAt ?? appear)) / 0.28);
        const sx = side === 'left' ? x - 24 - tw : x + 24; const sy = ly + 14;
        c.save(); c.translate(sx, sy); c.scale(sk, sk);
        c.font = `900 ${fs * 0.7}px ${FONT.sans}`; c.letterSpacing = '2px';
        const sw = c.measureText(p.stamp).width + 26;
        c.rotate(-0.05);
        c.fillStyle = p.stampColor || COLORS.red; roundRect(c, 0, 0, sw, fs * 0.7 + 18, 8); c.fill();
        c.fillStyle = '#fff'; c.fillText(p.stamp, 13, fs * 0.7 + 5);
        c.restore();
      }
      c.globalAlpha = 1;
    }
  }
}

function drawPlaceLabels(c, scene, P, t) {
  for (const l of scene.places || []) {
    if (l.until != null && t > l.until) continue;
    const [x, y] = P(l.lon, l.lat);
    c.save();
    c.font = `${l.weight || 800} ${l.size || 54}px ${FONT.sans}`;
    c.letterSpacing = `${l.spacing ?? 14}px`;
    c.textAlign = 'center';
    c.fillStyle = l.color || 'rgba(170,196,230,0.5)';
    c.fillText(l.text, x, y + (l.dy || 0));
    c.restore();
  }
}

function drawRings(c, scene, P, t) {
  const r = scene.rings; if (!r) return;
  const [x, y] = P(r.lon, r.lat);
  const n = r.count || 4; const period = r.period || 1.6;
  for (let i = 0; i < n; i += 1) {
    const ph = (((t - scene.start) / period) + i / n) % 1;
    c.strokeStyle = hexA(r.color || COLORS.red, 0.55 * (1 - ph)); c.lineWidth = 5 * (1 - ph) + 1;
    c.beginPath(); c.arc(x, y, 40 + ph * (r.radius || 420), 0, Math.PI * 2); c.stroke();
  }
}

function drawClock(c, scene, t) {
  const cl = scene.clock; if (!cl) return;
  const k = (EASE[cl.ease || 'linear'])((t - (cl.from ?? scene.start)) / ((cl.until ?? scene.end) - (cl.from ?? scene.start)));
  const s = lerp(cl.simFrom, cl.simTo, k);
  const d = new Date((s + (cl.tz ?? 3) * 3600) * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0'); const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const y = cl.y ?? 330;
  const col = typeof cl.color === 'function' ? cl.color(s) : (cl.redFrom != null && s >= cl.redFrom ? COLORS.red : (cl.color || '#fff'));
  // číslice v pevných bunkách (bez chvenia)
  c.save();
  c.font = `700 ${cl.size || 150}px ${FONT.disp}`;
  c.fontStretch = 'condensed';
  const cw = c.measureText('0').width * 1.04; const colon = cl.size ? cl.size * 0.3 : 45;
  const chars = [...hh, ':', ...mm];
  const total = cw * 4 + colon;
  let x = W / 2 - total / 2;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.shadowColor = hexA(col, 0.65); c.shadowBlur = 30;
  for (const ch of chars) {
    const w = ch === ':' ? colon : cw;
    c.fillStyle = col;
    c.fillText(ch, x + w / 2, y);
    x += w;
  }
  c.restore();
  if (cl.label) {
    c.save();
    c.font = `700 34px ${FONT.sans}`; c.letterSpacing = '6px'; c.textAlign = 'center';
    c.fillStyle = cl.labelColor || COLORS.accent;
    c.fillText(cl.label, W / 2, y - (cl.size || 150) * 0.86);
    c.restore();
  }
}

function drawBigNumber(c, scene, t) {
  const b = scene.big; if (!b) return;
  const at = b.at ?? scene.start;
  if (t < at) return;
  const k = (t - at) / (b.countDur ?? 0.9);
  const v = b.count === false ? b.value : Math.round(lerp(b.from ?? 0, b.value, easeOut(k)));
  const pop = easeOutBack((t - at) / 0.32);
  const gone = b.until != null ? clamp((t - b.until) / 0.3) : 0;
  if (gone >= 1) return;
  const y = b.y ?? 980;
  c.save();
  c.globalAlpha = 1 - gone;
  c.translate(W / 2, y); c.scale(pop * (1 - 0.15 * gone), pop * (1 - 0.15 * gone));
  c.font = `700 ${b.size || 380}px ${FONT.disp}`; c.fontStretch = 'condensed'; c.textAlign = 'center';
  c.shadowColor = hexA(b.color || COLORS.red, 0.7); c.shadowBlur = 50;
  c.lineWidth = 14; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.lineJoin = 'round';
  const txt = `${b.prefix || ''}${b.format ? b.format(v) : String(v)}${b.suffix || ''}`;
  c.strokeText(txt, 0, 0);
  c.fillStyle = b.color || COLORS.red; c.fillText(txt, 0, 0);
  c.shadowBlur = 0;
  if (b.label) {
    c.font = `900 ${b.labelSize || 76}px ${FONT.sans}`; c.letterSpacing = '4px';
    c.lineWidth = 10; c.strokeText(b.label, 0, (b.labelSize || 76) * 1.35);
    c.fillStyle = '#fff'; c.fillText(b.label, 0, (b.labelSize || 76) * 1.35);
  }
  if (b.sub) {
    c.font = `600 ${b.subSize || 38}px ${FONT.sans}`; c.letterSpacing = '0px';
    c.lineWidth = 7; c.strokeText(b.sub, 0, (b.labelSize || 76) * 1.35 + (b.subSize || 38) * 1.7);
    c.fillStyle = COLORS.muted; c.fillText(b.sub, 0, (b.labelSize || 76) * 1.35 + (b.subSize || 38) * 1.7);
  }
  c.restore();
}

function drawMapScene(c, scene, t) {
  const cam = camAt(scene, t);
  const P = projector(cam);
  drawMapBase(c, scene, cam, P);
  if (scene.dim) { c.fillStyle = `rgba(0,0,0,${scene.dim})`; c.fillRect(0, 0, W, H); }
  drawPlaceLabels(c, scene, P, t);
  drawCircle(c, scene, P, t);
  drawRings(c, scene, P, t);
  if (scene.flights) drawFlights(c, scene, P, t);
  drawPins(c, scene, P, t);
  vignette(c, scene.vignette ?? 0.55);
  drawClock(c, scene, t);
  drawBigNumber(c, scene, t);
}

// ---------- grafy ----------
function chartHeader(c, scene, t) {
  const k = easeOut((t - scene.start) / 0.4);
  c.save();
  c.globalAlpha = k;
  c.textAlign = 'center';
  c.font = `900 ${scene.titleSize || 64}px ${FONT.sans}`;
  const lines = String(scene.title || '').split('\n');
  lines.forEach((ln, i) => { c.fillStyle = '#fff'; c.fillText(ln, W / 2, (scene.titleY ?? 420) + i * (scene.titleSize || 64) * 1.12 + (1 - k) * 30); });
  if (scene.subtitle) {
    c.font = `600 38px ${FONT.sans}`; c.fillStyle = COLORS.muted;
    c.fillText(scene.subtitle, W / 2, (scene.titleY ?? 420) + lines.length * (scene.titleSize || 64) * 1.12 + 18);
  }
  c.restore();
}

function drawBars(c, scene, t) {
  drawBackground(c);
  chartHeader(c, scene, t);
  const bars = scene.bars || [];
  const x0 = 110; const x1 = 1000; const y0 = scene.baseY ?? 1300; const hMax = scene.height ?? 640;
  const max = scene.max || Math.max(...bars.map((b) => b.value));
  // mriežka
  c.save();
  c.font = `600 30px ${FONT.sans}`; c.fillStyle = 'rgba(200,215,235,0.6)'; c.textAlign = 'right';
  for (const g of scene.grid || []) {
    const y = y0 - (g / max) * hMax;
    c.strokeStyle = 'rgba(160,190,230,0.16)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
    c.fillText(`${g} h`, x0 - 14, y + 10);
  }
  c.restore();
  const gap = 10; const bw = (x1 - x0 - gap * (bars.length - 1)) / bars.length;
  bars.forEach((b, i) => {
    const at = scene.start + (scene.delay ?? 0.35) + i * (scene.stagger ?? 0.05) + (b.extraDelay || 0);
    const k = easeOut((t - at) / (b.growDur || 0.5));
    if (k <= 0) return;
    const h = (b.value / max) * hMax * k;
    const x = x0 + i * (bw + gap);
    const col = b.color || 'rgba(90,150,220,0.85)';
    c.save();
    if (b.glow) { c.shadowColor = col; c.shadowBlur = 40; }
    c.fillStyle = col; roundRect(c, x, y0 - h, bw, h, Math.min(8, bw / 3)); c.fill();
    c.restore();
    if (b.valueLabel && k > 0.6) {
      c.save(); c.globalAlpha = clamp((k - 0.6) / 0.4);
      c.font = `700 ${b.valueSize || 64}px ${FONT.disp}`; c.fontStretch = 'condensed'; c.textAlign = 'center';
      c.fillStyle = b.labelColor || col; c.fillText(b.valueLabel, x + bw / 2 + (b.labelDx || 0), y0 - h - 18);
      c.restore();
    }
    if (b.xLabel) {
      c.save(); c.font = `600 ${scene.xLabelSize || 27}px ${FONT.sans}`; c.fillStyle = 'rgba(200,215,235,0.75)'; c.textAlign = 'center';
      c.fillText(b.xLabel, x + bw / 2, y0 + 44); c.restore();
    }
  });
  c.strokeStyle = 'rgba(200,215,235,0.5)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y0); c.stroke();
  if (scene.note) { c.save(); c.font = `600 34px ${FONT.sans}`; c.fillStyle = COLORS.muted; c.textAlign = 'center'; c.fillText(scene.note, W / 2, y0 + 110); c.restore(); }
  vignette(c, 0.45);
}

function drawCompare(c, scene, t) {
  drawBackground(c);
  chartHeader(c, scene, t);
  const rows = scene.rows || [];
  const x0 = 90; const maxW = 900; const max = scene.max || Math.max(...rows.map((r) => r.value));
  rows.forEach((r, i) => {
    const y = (scene.rowY ?? 760) + i * (scene.rowGap ?? 300);
    const at = scene.start + (scene.delay ?? 0.4) + i * (scene.stagger ?? 0.9);
    const k = easeOut((t - at) / (r.growDur || 0.9));
    c.save();
    c.globalAlpha = clamp((t - at + 0.25) / 0.25);
    c.font = `800 46px ${FONT.sans}`; c.fillStyle = '#fff'; c.fillText(r.label, x0, y - 30);
    c.restore();
    if (k <= 0) return;
    const w = (r.value / max) * maxW * k;
    c.save();
    c.shadowColor = r.color; c.shadowBlur = r.glow ? 45 : 0;
    c.fillStyle = r.color; roundRect(c, x0, y, Math.max(12, w), 120, 14); c.fill();
    c.restore();
    c.save();
    c.font = `700 ${r.valueSize || 110}px ${FONT.disp}`; c.fontStretch = 'condensed';
    const v = Math.round(r.value * k);
    const txt = `${v}${r.unit || ''}`;
    const tw = c.measureText(txt).width;
    const inside = w > tw + 60;
    c.fillStyle = inside ? '#05070c' : '#fff';
    c.textAlign = inside ? 'right' : 'left';
    c.fillText(txt, inside ? x0 + w - 24 : x0 + w + 22, y + 100);
    c.restore();
  });
  if (scene.note) { c.save(); c.font = `600 34px ${FONT.sans}`; c.fillStyle = COLORS.muted; c.textAlign = 'center'; c.fillText(scene.note, W / 2, scene.noteY ?? 1420); c.restore(); }
  vignette(c, 0.45);
}

// ---------- fotky a video ----------
async function drawPhotoScene(c, scene, t) {
  const n = scene.images.length;
  const per = (scene.end - scene.start) / n;
  const i = Math.min(n - 1, Math.floor((t - scene.start) / per));
  const im = scene.images[i];
  const local = (t - scene.start - i * per) / per;
  const bg = await loadImage(im.bg); const fg = await loadImage(im.fg);
  c.drawImage(bg, 0, 0, W, H);
  const z = lerp(im.zoomFrom ?? 1.0, im.zoomTo ?? 1.08, easeInOut(local));
  const fw = im.w * z; const fh = im.h * z;
  const cx = W / 2 + lerp(im.panFrom?.[0] || 0, im.panTo?.[0] || 0, easeInOut(local));
  const cy = (im.cy ?? H * 0.47) + lerp(im.panFrom?.[1] || 0, im.panTo?.[1] || 0, easeInOut(local));
  c.save();
  if (!im.full) { c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 50; }
  c.drawImage(fg, cx - fw / 2, cy - fh / 2, fw, fh);
  c.restore();
  // krátke biele zablysnutie pri výmene fotky
  if (i > 0 && local < 0.12) { c.fillStyle = `rgba(255,255,255,${0.35 * (1 - local / 0.12)})`; c.fillRect(0, 0, W, H); }
  vignette(c, 0.35);
}

async function drawVideoScene(c, scene, t) {
  const f = Math.min(scene.count - 1, Math.max(0, Math.floor((t - scene.start) * scene.fps)));
  const img = await loadImage(`${scene.frames}/${String(f + 1).padStart(5, '0')}.jpg`);
  c.drawImage(img, 0, 0, W, H);
  if (IMG.size > 400) for (const k of [...IMG.keys()].slice(0, 200)) if (k.includes('/clip')) IMG.delete(k);
  vignette(c, 0.3);
}

async function drawEnd(c, scene, t) {
  drawBackground(c);
  const k = easeOut((t - scene.start) / 0.5);
  const logo = SPEC.logo ? await loadImage(SPEC.logo) : null;
  c.save();
  c.globalAlpha = k;
  if (logo) { const pulse = 1 + 0.025 * Math.sin((t - scene.start) * 3.2); const lw = 340 * pulse; const lh = (lw * logo.height) / logo.width; c.drawImage(logo, W / 2 - lw / 2, 560 - lh / 2 + (1 - k) * 40, lw, lh); }
  c.textAlign = 'center';
  c.font = `900 104px ${FONT.sans}`; c.fillStyle = '#fff';
  const a = 'okolive'; const b = '.sk';
  const wa = c.measureText(a).width; const wb = c.measureText(b).width;
  c.textAlign = 'left';
  c.fillText(a, W / 2 - (wa + wb) / 2, 850); c.fillStyle = COLORS.accent; c.fillText(b, W / 2 - (wa + wb) / 2 + wa, 850);
  c.textAlign = 'center';
  c.font = `700 50px ${FONT.sans}`; c.fillStyle = '#fff'; c.fillText(scene.line1 || 'Lety nad Európou naživo', W / 2, 950);
  c.font = `500 30px ${FONT.sans}`; c.fillStyle = 'rgba(200,215,235,0.7)';
  (scene.credits || []).forEach((ln, i) => c.fillText(ln, W / 2, 1240 + i * 44));
  if (scene.author) { c.font = `700 30px ${FONT.sans}`; c.letterSpacing = '5px'; c.fillStyle = 'rgba(0,212,255,0.85)'; c.fillText(scene.author, W / 2, 1120); }
  c.restore();
}

// ---------- prekrytia ----------
function vignette(c, a) {
  const g = c.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

async function drawBrand(c) {
  const logo = SPEC.logo ? await loadImage(SPEC.logo) : null;
  c.save();
  // jemný tieň hore, aby značka čítateľne sedela na každom zábere
  const g = c.createLinearGradient(0, 0, 0, 260);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, 260);
  if (logo) c.drawImage(logo, 46, 58, 84, (84 * logo.height) / logo.width);
  c.font = `800 46px ${FONT.sans}`; c.fillStyle = '#fff';
  c.fillText('okolive', 142, 100);
  const w = c.measureText('okolive').width;
  c.fillStyle = COLORS.accent; c.fillText('.sk', 142 + w, 100);
  c.restore();
}

function drawProgress(c, t) {
  const k = clamp(t / SPEC.duration);
  c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(0, 0, W, 8);
  c.fillStyle = COLORS.accent; c.fillRect(0, 0, W * k, 8);
}

function drawKicker(c, t) {
  for (const kk of SPEC.kickers || []) {
    if (t < kk.start || t > kk.end) continue;
    const k = easeOut((t - kk.start) / 0.3);
    const out = clamp((kk.end - t) / 0.2);
    c.save();
    c.globalAlpha = Math.min(k, out);
    c.font = `800 36px ${FONT.sans}`; c.letterSpacing = '5px';
    const tw = c.measureText(kk.text).width;
    const x = W / 2 - (tw + 56) / 2; const y = kk.y ?? 160;
    c.fillStyle = hexA(kk.color || COLORS.accent, 0.2); roundRect(c, x, y, tw + 56, 64, 32); c.fill();
    c.strokeStyle = hexA(kk.color || COLORS.accent, 0.9); c.lineWidth = 3; roundRect(c, x, y, tw + 56, 64, 32); c.stroke();
    c.fillStyle = '#fff'; c.fillText(kk.text, x + 30 + (1 - k) * 20, y + 45);
    c.restore();
  }
}

function drawCredit(c, t) {
  for (const cr of SPEC.credits || []) {
    if (t < cr.start || t > cr.end) continue;
    c.save();
    c.font = `600 28px ${FONT.sans}`; c.textAlign = 'center';
    c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.lineJoin = 'round';
    c.strokeText(cr.text, W / 2, cr.y ?? 1850); c.fillStyle = 'rgba(255,255,255,0.82)'; c.fillText(cr.text, W / 2, cr.y ?? 1850);
    c.restore();
  }
}

/** Titulky: skupina slov naraz, zvýraznené slová žlté, nástup s odskokom. */
function drawCaptions(c, t) {
  for (const cap of SPEC.captions || []) {
    if (t < cap.start || t >= cap.end) continue;
    const k = easeOutBack((t - cap.start) / 0.16);
    const size = cap.size || 82;
    c.save();
    c.font = `900 ${size}px ${FONT.sans}`;
    c.textAlign = 'left'; c.lineJoin = 'round';
    // zalomenie do riadkov (max 940 px)
    const words = cap.text.split(/\s+/);
    const lines = []; let cur = [];
    for (const wd of words) {
      const test = [...cur, wd].join(' ');
      if (c.measureText(test).width > 900 && cur.length) { lines.push(cur); cur = [wd]; } else cur.push(wd);
    }
    if (cur.length) lines.push(cur);
    const lh = size * 1.12;
    const yBase = (cap.y ?? 1500) - ((lines.length - 1) * lh) / 2;
    c.translate(W / 2, yBase); c.scale(lerp(0.86, 1, k), lerp(0.86, 1, k)); c.translate(-W / 2, -yBase);
    lines.forEach((ln, li) => {
      const text = ln.join(' ');
      const tw = c.measureText(text).width;
      let x = W / 2 - tw / 2; const y = yBase + li * lh;
      for (const [wi, wd] of ln.entries()) {
        const word = wi < ln.length - 1 ? `${wd} ` : wd;
        const hl = (cap.hl || []).some((h) => wd.replace(/[.,!?;:„“"]/g, '').toLowerCase() === h.toLowerCase());
        c.lineWidth = 16; c.strokeStyle = 'rgba(0,0,0,0.92)'; c.strokeText(word, x, y);
        c.fillStyle = hl ? (cap.hlColor || COLORS.yellow) : '#fff'; c.fillText(word, x, y);
        x += c.measureText(word).width;
      }
    });
    c.restore();
  }
}

// ---------- snímka ----------
const RENDER = { map: drawMapScene, bars: drawBars, compare: drawCompare, photo: drawPhotoScene, video: drawVideoScene, end: drawEnd };

async function drawScene(c, scene, t) {
  c.save();
  await RENDER[scene.type](c, scene, Math.min(Math.max(t, scene.start), scene.end));
  c.restore();
}

async function frame(t) {
  const scenes = SPEC.scenes;
  let cur = scenes.findIndex((s) => t >= s.start && t < s.end);
  if (cur < 0) cur = t < scenes[0].start ? 0 : scenes.length - 1;
  const sc = scenes[cur];
  const trans = sc.in || 'cut';
  const td = sc.inDur || 0.25;
  const local = t - sc.start;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  if (trans === 'fade' && local < td && cur > 0) {
    await drawScene(ctx, scenes[cur - 1], t);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    await drawScene(lctx, sc, t);
    ctx.globalAlpha = easeInOut(local / td); ctx.drawImage(layer, 0, 0); ctx.globalAlpha = 1;
  } else if (trans === 'punch' && local < 0.35) {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    await drawScene(lctx, sc, t);
    const z = lerp(1.09, 1, easeOut(local / 0.35));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(layer, W / 2 - (W * z) / 2, H / 2 - (H * z) / 2, W * z, H * z);
  } else {
    await drawScene(ctx, sc, t);
  }
  if ((trans === 'flash' || trans === 'punch') && local < 0.3) {
    ctx.fillStyle = `rgba(255,255,255,${(trans === 'flash' ? 0.85 : 0.35) * (1 - local / 0.3)})`; ctx.fillRect(0, 0, W, H);
  }
  for (const fl of SPEC.flashes || []) {
    if (t >= fl.at && t < fl.at + (fl.dur || 0.3)) { ctx.fillStyle = hexA(fl.color || '#ffffff', (fl.a ?? 0.8) * (1 - (t - fl.at) / (fl.dur || 0.3))); ctx.fillRect(0, 0, W, H); }
  }
  if (sc.type !== 'end') { await drawBrand(ctx); drawKicker(ctx, t); }
  drawCaptions(ctx, t);
  drawCredit(ctx, t);
  if (SPEC.progress !== false) drawProgress(ctx, t);
  return canvas.toDataURL('image/jpeg', SPEC.quality ?? 0.92).slice('data:image/jpeg;base64,'.length);
}

window.reel = { init, frame };
