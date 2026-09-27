// src/preloaderFlow.js
/**
 * @module preloaderFlow
 * @description Víchor textu okolo oka v preloaderi — ako úvod midjourney.com (2026-09-26/27,
 * vlastník: „preloader v štýle úvodnej stránky midjourney.com… stredové oko bude obtekané…
 * to oko v strede nemeň ani text… ja to chcem ako Midjourney").
 *
 * Technika Midjourney (preštudovaná z ich stránky, snímky v čase 0 / 1 / 3 / 6 / 11 / 21 s):
 *  - zdroj je blok riadkov promptov („/imagine …") zarovnaných VĽAVO, rôznej dĺžky — práve
 *    začiatky a konce riadkov tvoria ramená špirály (riadky od kraja po kraj by boli len šum);
 *  - pevná mriežka písmen jednej farby; bunka (x, y ∈ −1…1, normované na šírku a výšku, takže
 *    vír je eliptický ako obrazovka) sa otočí o uhol čas × 0,1 / max(0,1; r) a prečíta znak zo
 *    zdroja — stred sa točí rýchlejšie, text sa postupne navíja; mimo bloku je medzera;
 *  - logo sa „dekóduje" z náhodných znakov; stará obrazovka: zakrivenie nabieha 3 s, farebný
 *    posun odznie (~0,75 s), výrazné riadkovanie, vinetácia, expozícia 1 − e^(−2,5x).
 *
 * OKO: to isté, len blok sú riadky „/oko …" z vrstiev OKA (lety, lode, satelity, hladiny, radar,
 * plyn, front; stav ŽIVÉ, zriedka jantárové ODHAD / OMEŠKANÉ ako v appke), vír sa točí okolo oka
 * a oko + OKO + stav + podpis ostávajú bez zmeny — text ich ostro obteká (voľný zaoblený obdĺžnik
 * tesne okolo `.loader-content`, bez stmievania). Každá zmena textu stavu = ďalší stupeň
 * načítania, vír sa zrýchli. Úvod: glitch náhodných znakov + rozmazanie, potom ostré písmo.
 *
 * Nároky: Midjourney každú snímku počíta bunky na procesore, kreslí text cez fillText a posiela
 * celý obraz do GPU (~13 MB pri 1440p), 60×/s. Tu bunky počíta GPU v malej textúre (stĺpce ×
 * riadky), obrazovka je jeden priechod s jedným čítaním bunky a atlasu na pixel (viac vzoriek len
 * v úvode), 30 snímok/s, najviac 1,5 px na bod. V ukážke sa glóbus pod preloaderom pozastaví.
 *
 * Samostatný malý vstup bez importov (index.html ho načíta PRED main.js). Bez WebGL2 ostáva
 * statický preloader; pri „obmedziť pohyb" nehybný obraz. `?preloader=demo` podrží preloader
 * (Esc / klik = koniec).
 */

/** Písmo mriežky (CSS px) — JetBrains Mono ako stavový riadok preloadera. */
export const FLOW_FONT_PX = 11;
/** Riadky husto ako u Midjourney (tam je písmo dokonca vyššie ako rozostup riadkov). */
export const FLOW_LINE_PX = 12;
/** Okraj voľného stredu okolo `.loader-content` (CSS px) a minimálne polosi. */
export const FLOW_CLEAR_PAD = Object.freeze({ x: 26, y: 18, minA: 150, minB: 110 });
/** Vír: uhol = hodiny × rate / max(core, r) — hodnoty Midjourney. */
export const FLOW_SWIRL = Object.freeze({ rate: 0.1, core: 0.1 });
/** Rýchlosť hodín víru podľa stupňa načítania (každá zmena textu stavu = ďalší stupeň). */
export const FLOW_STAGE_SPEEDS = Object.freeze([1, 1.15, 1.3, 1.45, 1.6]);
/** Stav dát, ktorý appka značí jantárovo — vo víre len výnimočne. */
export const FLOW_AMBER_WORDS = Object.freeze(['ODHAD', 'OMEŠKANÉ', 'ČIASTOČNÉ', 'ZASTARANÉ']);
/** Farby (pred expozíciou): sýta modrá ako Midjourney na tmavom pozadí OKA s nádychom modrej, jantárová výnimka. */
export const FLOW_COLORS = Object.freeze({ bg: '#070a14', ink: '#2e5596', amber: '#8a5a1c' });
const FLOW_FPS = 30;
const FLOW_MAX_DPR = 1.5;
/** Nehybný obraz pri „obmedziť pohyb": hodiny víru, keď je už pekne navinutý. */
const STILL_CLOCK = 5;

/** Polomer superelipsy n = 4 (zaoblený obdĺžnik) v natiahnutých súradniciach — okraj stredu je r = 1. */
export function clearRadius(X, Y) {
  const x2 = X * X;
  const y2 = Y * Y;
  return Math.sqrt(Math.sqrt(x2 * x2 + y2 * y2));
}

/**
 * Voľný stred preloadera z obdĺžnika `.loader-content` (CSS px).
 * @returns {{ cx: number, cy: number, a: number, b: number }}
 */
export function obstacleFromRect(rect, pad = FLOW_CLEAR_PAD) {
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    a: Math.max(rect.width / 2 + pad.x, pad.minA),
    b: Math.max(rect.height / 2 + pad.y, pad.minB),
  };
}

/** Rýchlosť hodín víru pre stupeň načítania (orezaná na posledný stupeň). */
export function flowStageSpeed(stage) {
  const i = Math.max(0, Math.min(FLOW_STAGE_SPEEDS.length - 1, Math.floor(stage) || 0));
  return FLOW_STAGE_SPEEDS[i];
}

/**
 * Vír Midjourney: bod (x, y) v px relatívne k stredu víru, polosi obrazovky hw, hh → odkiaľ sa
 * číta zdroj (px relatívne k stredu). Normovanie na šírku a výšku robí vír eliptickým.
 * @returns {{ x: number, y: number, angle: number }}
 */
export function swirlSource(x, y, hw, hh, clock, swirl = FLOW_SWIRL) {
  const nx = x / hw;
  const ny = -y / hh;
  const r = Math.hypot(nx, ny);
  const angle = (clock * swirl.rate) / Math.max(swirl.core, r);
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const rx = nx * c + ny * s;
  const ry = -nx * s + ny * c;
  return { x: rx * hw, y: -ry * hh, angle };
}

// ── Zdrojový blok „/oko …" ───────────────────────────────────────────────────────────────────────
const PICK = {
  icao: ['LZIB', 'LZKZ', 'LZTT', 'LZSL', 'LZPP', 'LKPR', 'LOWW', 'LHBP', 'EPWA', 'EDDM', 'LKTB'],
  type: ['A320', 'A321', 'B738', 'B38M', 'E190', 'AT76', 'A359', 'B789', 'CRJ9', 'DH8D'],
  city: ['Bratislava', 'Košice', 'Žilina', 'Komárno', 'Štúrovo', 'Senec', 'Trnava', 'Nitra', 'Banská Bystrica', 'Prešov', 'Šamorín', 'Dunajská Streda'],
  river: ['Dunaj', 'Váh', 'Hron', 'Morava', 'Bodrog', 'Hornád', 'Ipeľ'],
  ship: ['ARGO', 'VIKTORIA', 'DANUBIA', 'NOVA', 'MOSONI', 'LUNA', 'ORAVA', 'DEVÍN', 'TATRY'],
  sat: ['ISS', 'STARLINK-3121', 'NOAA 19', 'SENTINEL-2B', 'LANDSAT 9', 'METOP-C', 'GOES-18', 'TERRA'],
  gas: ['Veľké Kapušany', 'Baumgarten', 'Lanžhot', 'Budince', 'Mallnow', 'Arnoldstein'],
  front: ['Lymanský smer', 'Pokrovský smer', 'Kupianský smer', 'Kostiantynivský smer', 'Záporožský smer'],
  road: ['D1', 'D2', 'D4', 'R1', 'R2', 'I/61', 'I/66'],
  trend: ['stúpa', 'klesá', 'stabilne'],
  cam: ['D1 Senec', 'D2 Lamač', 'R1 Nitra', 'D1 Považská Bystrica', 'I/66 Zvolen'],
};
/** Šablóny riadkov — ako prompty Midjourney, len z vrstiev OKA. `{s}` = stav dát. */
const TEMPLATES = [
  (p) => `/oko let ${p.call()} ${p.one('type')} FL${p.int(80, 410)} ${p.int(240, 480)} kt ${p.one('icao')} → ${p.one('icao')} {s}`,
  (p) => `/oko loď ${p.one('ship')} MMSI ${p.int(200000000, 299999999)} ${p.one('river')} r.km ${p.int(1700, 1880)} ${p.dec(3, 14)} kn {s}`,
  (p) => `/oko satelit ${p.one('sat')} NORAD ${p.int(20000, 59999)} výška ${p.int(400, 830)} km sklon ${p.dec(50, 99)}° {s}`,
  (p) => `/oko zemetrasenie M${p.dec(2, 6)} hĺbka ${p.int(2, 40)} km ${p.dec(45, 50)}N ${p.dec(15, 23)}E {s}`,
  (p) => `/oko radar SHMÚ zrážky ${p.dec(0, 12)} mm/h ${p.one('city')} {s}`,
  (p) => `/oko hladina ${p.one('river')} ${p.one('city')} ${p.int(60, 620)} cm ${p.one('trend')} {s}`,
  (p) => `/oko kamera ${p.one('cam')} snímka ${p.time()} {s}`,
  (p) => `/oko plyn ENTSOG ${p.one('gas')} ${p.int(20, 480)} GWh/d {s}`,
  (p) => `/oko počasie ${p.one('icao')} METAR ${p.int(0, 36)}0${p.int(2, 25)}KT Q${p.int(996, 1032)} {s}`,
  (p) => `/oko front ${p.one('front')} stav ${p.time()} DeepState {s}`,
  (p) => `/oko doprava ${p.one('road')} ${p.one('city')} ${p.int(20, 130)} km/h {s}`,
  (p) => `/oko karta ${p.dec(45, 50)}N ${p.dec(15, 23)}E mierka 1:${p.int(20, 500)}000 vrstvy ${p.int(3, 12)}`,
];

/**
 * Zdrojový blok pre mriežku cols × rows: riadky „/oko …" zarovnané vľavo, rôznej dĺžky, občas
 * prázdny — ako blok promptov Midjourney. Kód 0 = medzera; bit 128 = jantárové slovo. Deterministické.
 * @returns {{ data: Uint8Array, chars: string[], width: number, height: number, lines: string[] }}
 */
export function buildFlowBlock(cols, rows, { seed = 20260927, amberShare = 0.06 } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const p = {
    one: (k) => PICK[k][Math.floor(rnd() * PICK[k].length)],
    int: (a, b) => a + Math.floor(rnd() * (b - a + 1)),
    dec: (a, b) => (a + rnd() * (b - a)).toFixed(1),
    time: () => `${pad2(Math.floor(rnd() * 24))}:${pad2(Math.floor(rnd() * 60))}`,
    call: () => `${'OK,OM,HA,SP,D,OE'.split(',')[Math.floor(rnd() * 6)]}${String.fromCharCode(65 + Math.floor(rnd() * 26))}${String.fromCharCode(65 + Math.floor(rnd() * 26))}${p.int(10, 99)}`,
  };
  const status = () => (rnd() < amberShare ? FLOW_AMBER_WORDS[Math.floor(rnd() * FLOW_AMBER_WORDS.length)] : 'ŽIVÉ');
  const lines = [];
  for (let r = 0; r < rows; r++) {
    if (rnd() < 0.09) { lines.push(''); continue; }
    const target = Math.floor(cols * (0.28 + rnd() * 0.72));
    let line = '';
    while (line.length < target) {
      const next = TEMPLATES[Math.floor(rnd() * TEMPLATES.length)](p).replace('{s}', status());
      line = line ? `${line}  ${next}` : next;
    }
    lines.push(line.slice(0, Math.max(1, Math.min(cols, target + 12))));
  }
  const chars = [...new Set(lines.join('').split(''))].filter((c) => c !== ' ');
  const index = new Map(chars.map((c, i) => [c, i + 1]));
  const data = new Uint8Array(cols * rows);
  lines.forEach((line, r) => {
    const amberSpans = [];
    for (const w of FLOW_AMBER_WORDS) {
      let at = line.indexOf(w);
      while (at >= 0) { amberSpans.push([at, at + w.length]); at = line.indexOf(w, at + 1); }
    }
    for (let c = 0; c < Math.min(cols, line.length); c++) {
      const ch = line[c];
      if (ch === ' ') continue;
      const amber = amberSpans.some(([a, b]) => c >= a && c < b) ? 128 : 0;
      data[r * cols + c] = (index.get(ch) || 0) | amber;
    }
  });
  return { data, chars, width: cols, height: rows, lines };
}

// ── GPU ─────────────────────────────────────────────────────────────────────────────────────────
const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// 1. priechod — jedna bunka mriežky = jeden fragment: voľný stred? → vír Midjourney okolo oka →
// znak zo zdrojového bloku (mimo bloku medzera). Výsledok je malá textúra stĺpce × riadky.
const FS_CELLS = `#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
in vec2 vUv; out vec4 o;
uniform vec2 uGrid, uCell, uRes, uSwirlC;
uniform vec4 uObs;
uniform float uClock, uRate, uCore;
uniform usampler2D uText;
float rn(vec2 q){ vec2 a = q*q; return sqrt(sqrt(a.x*a.x + a.y*a.y)); }
void main(){
  vec2 cell = vec2(floor(gl_FragCoord.x), uGrid.y - 1.0 - floor(gl_FragCoord.y));
  vec2 p = (cell + 0.5)*uCell;
  if (rn((p - uObs.xy)/uObs.zw) < 1.0) { o = vec4(0.0); return; }
  vec2 hs = 0.5*uRes;
  vec2 n = vec2(p.x - uSwirlC.x, uSwirlC.y - p.y)/hs;
  float ang = uClock*uRate/max(uCore, length(n));
  float s = sin(ang), c = cos(ang);
  vec2 r = vec2(n.x*c + n.y*s, -n.x*s + n.y*c);
  vec2 src = vec2(uSwirlC.x + r.x*hs.x, uSwirlC.y - r.y*hs.y);
  vec2 sc = floor(src/uCell);
  if (sc.x < 0.0 || sc.y < 0.0 || sc.x >= uGrid.x || sc.y >= uGrid.y) { o = vec4(0.0); return; }
  uint code = texelFetch(uText, ivec2(int(sc.x), int(sc.y)), 0).r;
  o = vec4(float(code)/255.0, 0.0, 0.0, 1.0);
}`;

// 2. priechod — obrazovka ako u Midjourney (vlastný zápis): zakrivenie nabieha 3 s, písmeno
// z bunky a atlasu, výrazné riadkovanie, vinetácia, expozícia; úvod: náhodné znaky sa
// „dekódujú", farebný posun a rozmazanie odznejú (vlastník: „glitch a rozmazanie je dobré").
const FS_SCREEN = `#version 300 es
precision highp float; precision highp int;
in vec2 vUv; out vec4 o;
uniform vec2 uRes, uCell, uAtlasSize, uGrid;
uniform float uTime, uIntro, uAtlasCols, uCharCount, uDpr, uFx;
uniform sampler2D uCells, uAtlas;
uniform vec3 uInk, uAmber, uBg;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
vec3 glyphAt(vec2 fc){
  vec2 cell = floor(fc/uCell);
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uGrid.x || cell.y >= uGrid.y) return vec3(0.0);
  uint code = uint(texelFetch(uCells, ivec2(int(cell.x), int(uGrid.y - 1.0 - cell.y)), 0).r*255.0 + 0.5);
  uint idx = code & 127u;
  if (idx == 0u) return vec3(0.0);
  bool amber = (code & 128u) != 0u;
  if (uIntro < 1.8) {
    float slot = floor(uTime*14.0);
    if (h21(cell + slot) > smoothstep(0.0, 1.0, uIntro - h21(cell)*0.8)) idx = 1u + uint(h21(cell*1.37 + slot)*(uCharCount - 1.0));
  }
  vec2 inCell = floor(fc - cell*uCell) + 0.5;
  float gx = mod(float(idx), uAtlasCols), gy = floor(float(idx)/uAtlasCols);
  return (amber ? uAmber : uInk)*texture(uAtlas, (vec2(gx, gy)*uCell + inCell)/uAtlasSize).r;
}
void main(){
  float k = 1.0 - pow(1.0 - min(uTime/3.0, 1.0), 2.0);
  vec2 c = vUv*2.0 - 1.0;
  c *= 1.0 + 0.1*k;
  c *= 1.0 - 0.085*k + 0.05*k*c.yx*c.yx;
  vec2 uv = c*0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(uBg, 1.0); return; }
  vec2 fc = vec2(uv.x, 1.0 - uv.y)*uRes;
  vec3 s;
  if (uFx > 0.01) {
    float sh = uFx*0.005*uRes.x;
    vec2 d = vec2(1.8*uDpr*uFx);
    vec3 mid = vec3(glyphAt(fc + vec2(sh, 0.0)).r, glyphAt(fc).g, glyphAt(fc - vec2(sh, 0.0)).b);
    s = mid*0.4 + (glyphAt(fc + d) + glyphAt(fc - d) + glyphAt(fc + vec2(d.x, -d.y)) + glyphAt(fc - vec2(d.x, -d.y)))*0.15;
  } else {
    s = glyphAt(fc);
  }
  float line = max(0.0, sin((uv.y + uTime*0.0005)*uRes.y/uDpr))*0.5;
  s = mix(s, max(s - vec3(line), 0.0), 0.4);
  s *= 1.0 - 0.7*length(uv - 0.5);
  s = 1.0 - exp(-s*2.5);
  o = vec4(uBg + s, 1.0);
}`;

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Spustí víchor za preloaderom. Vracia ovládač alebo null (bez WebGL2, bez `#loading-screen`).
 * Bez vedľajších účinkov mimo prehliadača.
 */
export function startPreloaderFlow({ doc = globalThis.document, win = globalThis.window } = {}) {
  const screen = doc?.getElementById?.('loading-screen');
  const content = screen?.querySelector?.('.loader-content');
  if (!screen || !content || screen.classList.contains('hidden')) return null;
  const logo = content.querySelector?.('.loader-logo') || null;
  const demo = /(?:^|[?&])preloader=demo(?:&|$)/.test(win.location?.search || '');
  const still = !demo && Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  const canvas = doc.createElement('canvas');
  canvas.id = 'loader-flow';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return null;

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
    return sh;
  };
  const program = (fs) => {
    const pr = gl.createProgram();
    gl.attachShader(pr, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(pr, 0, 'aPos');
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || 'link');
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const name = gl.getActiveUniform(pr, i).name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(pr, name);
    }
    return { p: pr, u };
  };
  let cellsP; let screenP;
  try { cellsP = program(FS_CELLS); screenP = program(FS_SCREEN); } catch { return null; }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const texture = (w, h, internal, format, type, filter, data) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const target = (w, h) => {
    const tex = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  };
  const colors = { bg: hexRgb(FLOW_COLORS.bg), ink: hexRgb(FLOW_COLORS.ink), amber: hexRgb(FLOW_COLORS.amber) };

  let dpr = 1; let cell = [8, 15]; let grid = [1, 1];
  let atlas = null; let cells = null; let block = null; let textTex = null;
  let obs = { cx: 0, cy: 0, a: 200, b: 150 }; let swirlC = { x: 0, y: 0 };
  let measuredOnce = false;
  const measure = () => {
    const r = content.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    obs = obstacleFromRect(r);
    const l = logo?.getBoundingClientRect?.();
    swirlC = l && l.width > 0 ? { x: l.left + l.width / 2, y: l.top + l.height / 2 } : { x: obs.cx, y: obs.cy };
    measuredOnce = true;
  };
  const rebuild = () => {
    const font = `400 ${Math.round(FLOW_FONT_PX * dpr)}px "JetBrains Mono", "SF Mono", "Fira Code", monospace`;
    const probe = doc.createElement('canvas').getContext('2d');
    probe.font = font;
    cell = [Math.max(4, Math.round(probe.measureText('M').width)), Math.round(FLOW_LINE_PX * dpr)];
    grid = [Math.ceil(canvas.width / cell[0]), Math.ceil(canvas.height / cell[1])];
    // zdrojový blok podľa mriežky (riadok obrazovky = riadok bloku, ako u Midjourney)
    block = buildFlowBlock(grid[0], grid[1]);
    if (textTex) gl.deleteTexture(textTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    textTex = texture(block.width, block.height, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, gl.NEAREST, block.data);
    // atlas písmen (JetBrains Mono)
    const cols = 16; const rows = Math.ceil((block.chars.length + 1) / cols);
    const c = doc.createElement('canvas');
    c.width = cols * cell[0]; c.height = rows * cell[1];
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#fff'; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    block.chars.forEach((ch, i) => {
      const k = i + 1;
      x.fillText(ch, (k % cols) * cell[0] + cell[0] / 2, Math.floor(k / cols) * cell[1] + cell[1] / 2);
    });
    if (atlas) gl.deleteTexture(atlas.tex);
    atlas = { tex: texture(c.width, c.height, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, c), cols, w: c.width, h: c.height };
    if (cells) { gl.deleteTexture(cells.tex); gl.deleteFramebuffer(cells.fbo); }
    cells = target(grid[0], grid[1]);
  };
  const resize = () => {
    dpr = Math.min(FLOW_MAX_DPR, win.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(win.innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(win.innerHeight * dpr));
    rebuild();
    measure();
  };

  screen.insertBefore(canvas, screen.firstChild);
  resize();

  let stage = 0; let clock = 0; let t = 0; let t0 = 0; let last = 0; let drawnAt = 0;
  let raf = 0; let stopped = false; let outroAt = 0; let measuredAt = 0;
  // Ukážka (?preloader=demo) drží preloader nad hotovou appkou: glóbus Cesium by pod ním ďalej
  // kreslil 60× za sekundu a sťahoval Google 3D dlaždice (kvóta) — nikto ho nevidí, tak sa pozastaví
  // a po ukončení ukážky rozbehne. Pri bežnom štarte sa glóbus pod preloaderom normálne načítava.
  let pausedViewer = null;
  const pauseGlobeUnderDemo = () => {
    if (!demo || !screen.classList.contains('hidden')) return;
    if (!doc.documentElement.classList.contains('oko-preloader-demo')) return;
    // každú snímku: appka po návrate na kartu (main.js syncVisibilitySuspension) slučku zapne
    const viewer = win.__godsEyeView?.viewer;
    if (viewer && viewer.useDefaultRenderLoop) { viewer.useDefaultRenderLoop = false; pausedViewer = viewer; }
  };
  const resumeGlobe = () => {
    if (!pausedViewer) return;
    try { pausedViewer.useDefaultRenderLoop = !doc.hidden; } catch { /* */ }
    pausedViewer = null;
  };

  const frame = (now) => {
    if (stopped) return;
    if (!t0) t0 = now;
    if (!still && drawnAt && now - drawnAt < 1000 / FLOW_FPS - 2) { raf = win.requestAnimationFrame(frame); return; }
    drawnAt = now;
    // skutočný čas (úvod beží v sekundách, aj keď štart Cesia pribrzdí snímky); krok hodín víru je
    // obmedzený, aby po zaseknutí neskočil
    const dt = still ? 0 : (last ? Math.min(0.25, (now - last) / 1000) : 1 / FLOW_FPS);
    last = now; t = (now - t0) / 1000;
    clock += dt * flowStageSpeed(stage) * (outroAt ? 3 : 1);
    if (still) { t = 6; clock = STILL_CLOCK; }
    // štart pri skrytom okne (šírka 0) alebo zmena bez udalosti resize — veľkosť sa overí každú
    // snímku; stred sa premeriava, kým nie je rozložený (potom pri zmene stavu a veľkosti)
    if (canvas.width !== Math.max(1, Math.round(win.innerWidth * Math.min(FLOW_MAX_DPR, win.devicePixelRatio || 1)))) resize();
    if (!measuredOnce && now - measuredAt > 250) { measuredAt = now; measure(); }
    pauseGlobeUnderDemo();

    gl.bindVertexArray(vao);
    // 1. bunky
    gl.bindFramebuffer(gl.FRAMEBUFFER, cells.fbo);
    gl.viewport(0, 0, cells.w, cells.h);
    gl.useProgram(cellsP.p);
    const c = cellsP.u;
    gl.uniform2f(c.uGrid, grid[0], grid[1]);
    gl.uniform2f(c.uCell, cell[0], cell[1]);
    gl.uniform2f(c.uRes, canvas.width, canvas.height);
    gl.uniform2f(c.uSwirlC, swirlC.x * dpr, swirlC.y * dpr);
    gl.uniform4f(c.uObs, obs.cx * dpr, obs.cy * dpr, obs.a * dpr, obs.b * dpr);
    gl.uniform1f(c.uClock, clock);
    gl.uniform1f(c.uRate, FLOW_SWIRL.rate);
    gl.uniform1f(c.uCore, FLOW_SWIRL.core);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textTex); gl.uniform1i(c.uText, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2. obrazovka
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(screenP.p);
    const u = screenP.u;
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform2f(u.uCell, cell[0], cell[1]);
    gl.uniform2f(u.uAtlasSize, atlas.w, atlas.h);
    gl.uniform2f(u.uGrid, grid[0], grid[1]);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uIntro, t / 1.6);
    gl.uniform1f(u.uAtlasCols, atlas.cols);
    gl.uniform1f(u.uCharCount, block.chars.length + 1);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uFx, still ? 0 : Math.exp(-t / 0.9));
    gl.uniform3fv(u.uInk, colors.ink);
    gl.uniform3fv(u.uAmber, colors.amber);
    gl.uniform3fv(u.uBg, colors.bg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlas.tex); gl.uniform1i(u.uAtlas, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cells.tex); gl.uniform1i(u.uCells, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) raf = win.requestAnimationFrame(frame);
  };

  const observers = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    resumeGlobe();
    win.cancelAnimationFrame(raf);
    for (const o of observers) o.disconnect();
    win.removeEventListener('resize', onResize);
    win.removeEventListener('keydown', onKey);
    screen.removeEventListener('click', exitDemo);
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* */ }
    canvas.remove();
  };
  let resizeTimer = 0;
  const onResize = () => {
    win.clearTimeout(resizeTimer);
    resizeTimer = win.setTimeout(() => { resize(); if (still && !stopped) raf = win.requestAnimationFrame(frame); }, 120);
  };
  win.addEventListener('resize', onResize);
  canvas.addEventListener('webglcontextlost', stop);

  // Stupne načítania = zmeny textu stavu (main.js ho prepisuje); stred sa môže rozšíriť.
  const status = content.querySelector('.loader-status');
  if (status && win.MutationObserver) {
    const mo = new win.MutationObserver(() => { stage += 1; measure(); });
    mo.observe(status, { childList: true, characterData: true, subtree: true });
    observers.push(mo);
  }
  // Skrytie preloadera: vír sa roztočí počas prelínania (0,8 s) a potom sa všetko uvoľní.
  const beginOutro = () => {
    if (outroAt || stopped) return;
    outroAt = win.performance?.now?.() || 1;
    win.setTimeout(stop, 1100);
  };
  function exitDemo() {
    doc.documentElement.classList.remove('oko-preloader-demo');
    resumeGlobe();
    if (screen.classList.contains('hidden')) beginOutro();
  }
  function onKey(e) { if (e.key === 'Escape') exitDemo(); }
  if (demo) {
    doc.documentElement.classList.add('oko-preloader-demo');
    win.addEventListener('keydown', onKey);
    screen.addEventListener('click', exitDemo);
  }
  if (win.MutationObserver) {
    const mo = new win.MutationObserver(() => {
      if (screen.classList.contains('hidden') && !doc.documentElement.classList.contains('oko-preloader-demo')) beginOutro();
    });
    mo.observe(screen, { attributes: true, attributeFilter: ['class'] });
    observers.push(mo);
  }
  // JetBrains Mono sa môže dotiahnuť až po štarte — atlas sa prekreslí jej tvarmi.
  doc.fonts?.load?.(`400 ${FLOW_FONT_PX}px "JetBrains Mono"`).then(() => { if (!stopped) rebuild(); }).catch(() => {});

  raf = win.requestAnimationFrame(frame);
  return {
    stop, get stage() { return stage; }, get demo() { return demo; }, get still() { return still; },
    /** Na overenie v prehliadači: hodiny víru, bunka, stred (CSS px). */
    debug: () => ({ clock, t, cell: [...cell], grid: [...grid], obs: { ...obs }, swirlC: { ...swirlC }, dpr }),
    /** Na overenie: koľko buniek mriežky má znak (číta 1. priechod z GPU). */
    debugCells: () => {
      const px = new Uint8Array(cells.w * cells.h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, cells.fbo);
      gl.readPixels(0, 0, cells.w, cells.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let filled = 0; for (let i = 0; i < px.length; i += 4) if (px[i]) filled++;
      return { grid: [cells.w, cells.h], filled, err: gl.getError(), lost: gl.isContextLost() };
    },
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__okoPreloaderFlow) {
  try { window.__okoPreloaderFlow = startPreloaderFlow() || { stop() {} }; } catch { /* statický preloader ostáva */ }
}
