// src/windParticles.js
// GPU častice vetra nad glóbusom (2026-09-08, prototyp „ako Windy, štýl OKO").
//
// Vlastný WebGL2 kontext na priehľadnom <canvas> nad Cesium plátnom (bez
// zdieľania kontextu — Cesium má svoj). Stav častíc žije v RGBA8 textúre
// (16 bit lon + 16 bit lat, vzor mapbox/webgl-wind, MIT, prepísané pre glóbus):
//   1. update: fragment shader posunie každú časticu podľa vetra (u,v z RG PNG
//      z /api/meteo/slice?var=wind, lineárne vzorkovanie), náhodne ju „zrodí"
//      inde (drop rate + rýchlejšie častice častejšie) — ping-pong 2 textúr,
//   2. draw: vertex shader prečíta lon/lat, spočíta ECEF na WGS84 elipsoide,
//      premietne Cesium view-projection maticou a zahodí body odvrátené od
//      kamery (skalárny súčin normály a smeru ku kamere), farba podľa rýchlosti
//      z 1D rampy (meteoField.js),
//   3. stopy: obrazovková textúra sa prekreslí s útlmom a doň sa nakreslia
//      nové body; pri pohybe kamery sa stopy zotrú rýchlo (Windy ich maže).
// Beží vo vlastnom rAF; Cesium kamera dá čerstvé matice bez nutnosti render
// snímku (viewMatrix je lenivý getter). PLÁTNO (2D) a Columbus kreslia cez
// projekciu Cesia (u_mode), chýbajúci WebGL2 = bez častíc, vrstva ostáva.

export const WIND_PARTICLE_COUNT_DEFAULT = 49_152; // 192 × 256 — hustá sieť (Windy pass 2026-09-17: „veľmi slabé")
// Ladenie 2026-09-08 (používateľ: „jemné a bez rastrov, nie vybodkované"):
// častica sa kreslí ako ÚSEČKA z predchádzajúcej do aktuálnej polohy (žiadne
// bodky medzi snímkami), stopy žijú v menšej textúre s lineárnym filtrom
// (mäkké), pomalší posun a menej častíc.
// Windy pass 2026-09-17 (používateľ: „veľmi slabé, chcem ako WINDY"):
// dlhšie stopy (fade 0,965), jasnejšie a sýte čiary (alfa 0,35 + 0,65 × rýchlosť,
// takmer žiadne bielenie — farba rampy svieti), ostrejšia textúra stôp (0,75).
export const WIND_TRAIL_FADE = 0.965;
export const WIND_TRAIL_FADE_MOVING = 0.6;
export const WIND_DROP_RATE = 0.003;
export const WIND_DROP_RATE_BUMP = 0.01;
/**
 * Simulovaný čas na snímok sa odvíja od výšky kamery (2026-09-08 noc, „plynulejšie,
 * elastické, reálne"): cieľ je ~1 px/snímok pri 10 m/s v každom priblížení —
 * m/px ≈ výška × 1,15 / výška_plátna, teda dt ≈ výška × 1,2e-4 s.
 */
export const WIND_SIM_SECONDS_PER_METRE_HEIGHT = 1.2e-4;
export const WIND_SIM_SECONDS_MIN = 30;
export const WIND_SIM_SECONDS_MAX = 1500;
/** Po výraznej zmene výrezu sa častice rýchlo presťahujú do nového výrezu (snímky, drop rate). */
export const WIND_RESPAWN_BOOST_FRAMES = 40;
export const WIND_RESPAWN_BOOST_RATE = 0.08;
/** Rozlíšenie textúry stôp voči plátnu (< 1 = mäkšie čiary, lacnejšie; 0,75 = ostrejšie, Windy pass). */
export const WIND_SCREEN_SCALE = 0.75;
/** Horný strop dĺžky úsečky (m); skutočná hranica je násobok kroku, viď maxSegmentMetres. */
export const WIND_MAX_SEGMENT_M = 300_000;
/**
 * Hranica „častica sa zrodila inde" podľa skutočného kroku: najrýchlejší vietor
 * (60 m/s) × simulované sekundy × 3. Pevných 300 km kreslilo pri priblížení
 * „teleporty" cez celú obrazovku (zrod vo výreze je bližšie než 300 km). Pure.
 */
export function maxSegmentMetres(simSeconds) {
  const dt = Number.isFinite(simSeconds) && simSeconds > 0 ? simSeconds : WIND_SIM_SECONDS_MAX;
  return Math.max(2_000, Math.min(WIND_MAX_SEGMENT_M, 60 * dt * 3));
}
/** Vek častice v snímkoch (Windy/nullschool: každá má pevnú fázu → rovnomerná hustota, nie zhluky). */
export const WIND_PARTICLE_MAX_AGE_FRAMES = 240;

const WGS84_A = 6378137.0;
const WGS84_B = 6356752.314245;

const QUAD_VS = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos; gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0); }`;

const SCREEN_FS = `#version 300 es
precision highp float;
uniform sampler2D u_screen;
uniform float u_opacity;
in vec2 v_uv;
out vec4 o;
void main() { vec4 c = texture(u_screen, v_uv); o = vec4(floor(255.0 * c * u_opacity) / 255.0); }`;

const UPDATE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_particles;
uniform sampler2D u_wind;
uniform sampler2D u_wind_next; // ďalší krok predpovede (interpolácia v čase ako Windy)
uniform float u_mix;           // 0 = u_wind, 1 = u_wind_next
uniform vec2 u_wind_min;   // u,v min (m/s)
uniform vec2 u_wind_max;   // u,v max (m/s)
uniform float u_rand_seed;
uniform float u_dt;        // simulované sekundy na snímok
uniform float u_drop_rate;
uniform float u_drop_rate_bump;
uniform float u_frame;     // počítadlo snímkov (vek)
uniform float u_max_age;   // vek v snímkoch
uniform vec4 u_spawn;      // výrez zrodu: west, south, width, height (°); height >= 179 = celá guľa
in vec2 v_uv;
out vec4 o;
const vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);
float rand(const vec2 co) { float t = dot(rand_constants.xy, co); return fract(sin(t) * (rand_constants.z + t)); }
// Vietor (m/s) v polohe 0..1; GFS mriežka: stĺpce 0..360° E (začína na 0°), riadok 0 = 90° N.
vec2 windAt(vec2 p) {
  float lon = p.x * 360.0 - 180.0;
  float lat = p.y * 180.0 - 90.0;
  vec2 wuv = vec2(fract((lon + 360.0) / 360.0), (90.0 - lat) / 180.0);
  return mix(u_wind_min, u_wind_max, mix(texture(u_wind, wuv).rg, texture(u_wind_next, wuv).rg, u_mix));
}
// Posun o vietor za dt sekúnd (m → °, zemepisná šírka skracuje rovnobežky).
vec2 advance(vec2 p, vec2 w, float dt) {
  float lat = p.y * 180.0 - 90.0;
  float coslat = max(cos(radians(lat)), 0.15);
  float dlon = w.x * dt / (111320.0 * coslat);
  float dlat = w.y * dt / 110540.0;
  return vec2(fract(p.x + dlon / 360.0), clamp(p.y + dlat / 180.0, 0.002, 0.998));
}
void main() {
  vec4 color = texture(u_particles, v_uv);
  vec2 pos = vec2(color.r / 255.0 + color.b, color.g / 255.0 + color.a); // 0..1
  // RK2 (stredový bod): vietor sa vzorkuje aj v polovici kroku, takže častica
  // sleduje zakrivenú prúdnicu a nie tečnu — čiary sú „elastické", nie lomené.
  vec2 w1 = windAt(pos);
  vec2 mid = advance(pos, w1, u_dt * 0.5);
  vec2 w = windAt(mid);
  float speed = length(w);
  float speed_t = clamp(speed / 40.0, 0.0, 1.0);
  vec2 next = advance(pos, w, u_dt);
  vec2 seed = (pos + v_uv) * u_rand_seed;
  float drop_rate = u_drop_rate + speed_t * u_drop_rate_bump;
  // Vek: každá častica má pevnú fázu (hash jej miesta v textúre), zaniká raz za
  // u_max_age snímkov — rovnomerné rozloženie vekov = rovnomerná hustota čiar.
  float phase = rand(v_uv * 7.31) * u_max_age;
  float aged = step(mod(u_frame + phase, u_max_age), 0.999);
  float drop = max(step(1.0 - drop_rate, rand(seed)), aged);
  vec2 r = vec2(rand(seed + 1.3), rand(seed + 2.1));
  vec2 random_pos;
  if (u_spawn.w >= 179.0) {
    // Celá guľa: rovnomerne po ploche, lat = asin(2r-1).
    random_pos = vec2(r.x, (degrees(asin(r.y * 2.0 - 1.0)) + 90.0) / 180.0);
  } else {
    // Len viditeľný výrez (Windy): hustota na obrazovke nezávisí od priblíženia.
    float lon = u_spawn.x + r.x * u_spawn.z;
    float lat = u_spawn.y + r.y * u_spawn.w;
    random_pos = vec2(fract((lon + 180.0) / 360.0), clamp((lat + 90.0) / 180.0, 0.002, 0.998));
  }
  pos = mix(next, random_pos, drop);
  o = vec4(fract(pos * 255.0), floor(pos * 255.0) / 255.0);
}`;

const DRAW_VS = `#version 300 es
precision highp float;
in float a_index;
in float a_end;
uniform sampler2D u_particles;
uniform sampler2D u_particles_prev;
uniform sampler2D u_wind;
uniform sampler2D u_wind_next;
uniform float u_mix;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_particles_res;
uniform mat4 u_vp;
uniform vec3 u_cam;
uniform vec2 u_ramp_range;
uniform float u_max_seg_m;
uniform float u_mode; // 0 = 3D glóbus (ECEF), 1 = plátno geografická projekcia, 2 = plátno Mercator
out float v_speed_t;
out float v_vis;
const float A = 6378137.0;
const float B = 6356752.314245;
const float PI = 3.141592653589793;
vec2 decode(vec4 color) { return vec2(color.r / 255.0 + color.b, color.g / 255.0 + color.a); }
// Cesium 2D/Columbus: svet = (0, x, y) projekcie; geografická x = lon·R, y = lat·R;
// Mercator y = R·ln(tan(π/4 + lat/2)). Os X sveta nesie výšku (tu 0).
vec3 projected(vec2 pos) {
  float lon = radians(pos.x * 360.0 - 180.0);
  float lat = radians(clamp(pos.y * 180.0 - 90.0, -89.5, 89.5));
  float y = u_mode > 1.5 ? A * log(tan(PI * 0.25 + lat * 0.5)) : A * lat;
  return vec3(0.0, A * lon, y);
}
vec3 ecef(vec2 pos) {
  float lon = radians(pos.x * 360.0 - 180.0);
  float lat = radians(pos.y * 180.0 - 90.0);
  float e2 = 1.0 - (B * B) / (A * A);
  float sl = sin(lat), cl = cos(lat);
  float N = A / sqrt(1.0 - e2 * sl * sl);
  return vec3(N * cl * cos(lon), N * cl * sin(lon), N * (1.0 - e2) * sl);
}
float visible(vec3 p) {
  vec3 n = normalize(vec3(p.x / (A * A), p.y / (A * A), p.z / (B * B)));
  vec3 toCam = u_cam - p;
  // Viditeľné len z privrátenej pologule (s malou rezervou pri obzore).
  return dot(n, normalize(toCam)) > 0.02 ? 1.0 : 0.0;
}
void main() {
  vec2 puv = vec2(fract(a_index / u_particles_res), floor(a_index / u_particles_res) / u_particles_res);
  vec2 posNow = decode(texture(u_particles, puv));
  vec2 posPrev = decode(texture(u_particles_prev, puv));
  vec2 pos = a_end > 0.5 ? posNow : posPrev;
  float lonDeg = pos.x * 360.0 - 180.0;
  float latDeg = pos.y * 180.0 - 90.0;
  vec2 wuv = vec2(fract((lonDeg + 360.0) / 360.0), (90.0 - latDeg) / 180.0);
  vec2 w = mix(u_wind_min, u_wind_max, mix(texture(u_wind, wuv).rg, texture(u_wind_next, wuv).rg, u_mix));
  v_speed_t = clamp((length(w) - u_ramp_range.x) / (u_ramp_range.y - u_ramp_range.x), 0.0, 1.0);
  bool isFlat = u_mode > 0.5;
  vec3 pNow = isFlat ? projected(posNow) : ecef(posNow);
  vec3 pPrev = isFlat ? projected(posPrev) : ecef(posPrev);
  // Úsečka len keď sú OBA konce viditeľné (na plátne vždy) a častica sa nezrodila inde (skok cez šev ±180° / respawn).
  float vis = isFlat ? 1.0 : visible(pNow) * visible(pPrev);
  float ok = vis * (distance(pNow, pPrev) < u_max_seg_m ? 1.0 : 0.0);
  v_vis = ok;
  vec4 clip = u_vp * vec4(a_end > 0.5 ? pNow : pPrev, 1.0);
  gl_Position = ok > 0.5 ? clip : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
uniform sampler2D u_ramp;
in float v_speed_t;
in float v_vis;
out vec4 o;
void main() {
  if (v_vis < 0.5) discard;
  vec4 c = texture(u_ramp, vec2(v_speed_t, 0.5));
  // Sýta farba rampy (takmer žiadne bielenie), alfa rastie s vetrom: bezvetrie
  // sotva vidno, búrka svieti. Pole pod čiarami je v pokoji priehľadné, takže
  // sa neprebíjajú s výplňou — preto smú byť jasné.
  o = vec4(mix(c.rgb, vec3(1.0), 0.05), 0.35 + 0.65 * v_speed_t);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`windParticles shader: ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`windParticles link: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i += 1) { const u = gl.getActiveUniform(p, i); uniforms[u.name] = gl.getUniformLocation(p, u.name); }
  const attribs = {};
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i += 1) { const a = gl.getActiveAttrib(p, i); attribs[a.name] = gl.getAttribLocation(p, a.name); }
  return { p, uniforms, attribs };
}

function texture(gl, filter, data, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  if (data instanceof Uint8Array || data === null) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/**
 * Režim scény pre shader: 0 = 3D glóbus, 1 = plátno/Columbus s geografickou
 * projekciou, 2 = plátno s Mercatorom, −1 = prechod (morph). Pure.
 * @param {{mode?: number, mapProjection?: object}|null} scene
 * @param {object} [CesiumNs] test seam (default globalThis.Cesium)
 */
export function sceneModeCode(scene, CesiumNs = globalThis.Cesium) {
  const SceneMode = CesiumNs?.SceneMode;
  if (!scene || scene.mode === undefined || !SceneMode) return 0;
  if (scene.mode === SceneMode.MORPHING) return -1;
  if (scene.mode === SceneMode.SCENE3D) return 0;
  const mercator = CesiumNs?.WebMercatorProjection && scene.mapProjection instanceof CesiumNs.WebMercatorProjection;
  return mercator ? 2 : 1;
}

/**
 * Výrez zrodu z viditeľného obdĺžnika kamery (°). Pridá okraj, aby častice
 * vchádzali do záberu zvonku; keď výrez pokrýva > polovicu sveta (alebo nie je),
 * zrod je na celej guli. Pure.
 * @param {{west: number, south: number, east: number, north: number}|null} rectDeg
 * @param {number} [marginRatio]
 * @returns {{west: number, south: number, width: number, height: number, global: boolean, areaFraction: number}}
 */
export function spawnRectFromView(rectDeg, marginRatio = 0.15) {
  const GLOBAL = { west: -180, south: -90, width: 360, height: 180, global: true, areaFraction: 1 };
  if (!rectDeg || ![rectDeg.west, rectDeg.south, rectDeg.east, rectDeg.north].every(Number.isFinite)) return GLOBAL;
  let width = rectDeg.east - rectDeg.west;
  if (width < 0) width += 360;
  const height = rectDeg.north - rectDeg.south;
  if (width <= 0 || height <= 0) return GLOBAL;
  const areaFraction = Math.min(1, (width * height) / (360 * 180));
  if (areaFraction > 0.5 || width >= 300) return GLOBAL;
  const mw = width * marginRatio;
  const mh = height * marginRatio;
  const south = Math.max(-89.9, rectDeg.south - mh);
  const north = Math.min(89.9, rectDeg.north + mh);
  return { west: rectDeg.west - mw, south, width: Math.min(360, width + 2 * mw), height: north - south, global: false, areaFraction };
}

/**
 * Simulované sekundy na snímok podľa výšky kamery (m): ~1 px/snímok pri 10 m/s. Pure.
 */
export function simSecondsPerFrame(heightM) {
  if (!Number.isFinite(heightM) || heightM <= 0) return WIND_SIM_SECONDS_MAX;
  return Math.max(WIND_SIM_SECONDS_MIN, Math.min(WIND_SIM_SECONDS_MAX, heightM * WIND_SIM_SECONDS_PER_METRE_HEIGHT));
}

/**
 * Koľko častíc kresliť pri danom podiele plochy výrezu: pri celej guli všetky
 * (polovica je viditeľná), v malom výreze menej, aby hustota na obrazovke ostala
 * podobná. Pure.
 */
export function activeParticleCount(total, areaFraction) {
  const f = Number.isFinite(areaFraction) ? Math.max(0, Math.min(1, areaFraction)) : 1;
  const share = Math.max(0.12, Math.min(1, Math.sqrt(f / 0.5)));
  return Math.max(256, Math.min(total, Math.round(total * share)));
}

/** Zmenil sa výrez natoľko, že treba častice rýchlo presťahovať? Pure. */
export function spawnRectChanged(a, b) {
  if (!a || !b) return true;
  if (a.global !== b.global) return true;
  if (a.global) return false;
  const dw = Math.abs(a.width - b.width) / Math.max(a.width, b.width);
  const dx = Math.abs(a.west - b.west) / Math.max(a.width, b.width);
  const dy = Math.abs(a.south - b.south) / Math.max(a.height, b.height);
  return dw > 0.25 || dx > 0.3 || dy > 0.3;
}

/** Počet častíc → rozmer štvorcovej stavovej textúry. Pure. */
export function particleTextureSize(count) {
  return Math.max(16, Math.ceil(Math.sqrt(Math.max(1, count))));
}

/** Zmenila sa matica (kamera sa hýbe)? Pure. */
export function matricesDiffer(a, b, eps = 1e-7) {
  if (!a || !b) return true;
  for (let i = 0; i < 16; i += 1) if (Math.abs(a[i] - b[i]) > eps * Math.max(1, Math.abs(a[i]))) return true;
  return false;
}

/**
 * Vytvorí systém častíc.
 * @param {HTMLElement} container rodič plátna (#cesiumContainer)
 * @param {object} viewer Cesium viewer (scene.camera, canvas)
 * @param {object} [options]
 * @param {number} [options.count]
 * @param {typeof globalThis.requestAnimationFrame} [options.requestFrame]
 * @param {typeof globalThis.cancelAnimationFrame} [options.cancelFrame]
 * @returns {{setWind: Function, setRamp: Function, start: Function, stop: Function, setVisible: Function, destroy: Function, isSupported: Function, getState: Function}}
 */
export function createWindParticles(container, viewer, {
  count = WIND_PARTICLE_COUNT_DEFAULT,
  requestFrame = (cb) => globalThis.requestAnimationFrame(cb),
  cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
} = {}) {
  const doc = container?.ownerDocument || globalThis.document;
  const canvas = doc.createElement('canvas');
  canvas.className = 'wind-particles-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: false });
  const state = { supported: Boolean(gl), running: false, visible: true, frame: null, windSet: false, fps: 0, moving: false, mode: 0, active: 0, spawn: null };
  if (!gl) return stub(canvas, state);

  const res = particleTextureSize(count);
  const total = res * res;
  const progUpdate = program(gl, QUAD_VS, UPDATE_FS);
  const progDraw = program(gl, DRAW_VS, DRAW_FS);
  const progScreen = program(gl, QUAD_VS, SCREEN_FS);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  // Dva vrcholy na časticu: [index, 0 = predchádzajúca poloha], [index, 1 = aktuálna].
  const lineBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  const verts = new Float32Array(total * 4);
  for (let i = 0; i < total; i += 1) { verts[i * 4] = i; verts[i * 4 + 1] = 0; verts[i * 4 + 2] = i; verts[i * 4 + 3] = 1; }
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  const seed = new Uint8Array(total * 4);
  for (let i = 0; i < seed.length; i += 1) seed[i] = Math.floor(Math.random() * 256);
  let stateA = texture(gl, gl.NEAREST, seed, res, res);
  let stateB = texture(gl, gl.NEAREST, seed, res, res);
  let windTex = null;
  let windNextTex = null; // ďalší krok (interpolácia); bez neho = windTex
  let windMix = 0;
  let frameCount = 0;
  let rampTex = texture(gl, gl.LINEAR, new Uint8Array(256 * 4).fill(255), 256, 1);
  let rampRange = [0, 45];
  let windMin = [-60, -60];
  let windMax = [60, 60];
  let screenA = null;
  let screenB = null;
  let width = 0;
  let height = 0;
  let sw = 0; // rozmer textúr stôp (WIND_SCREEN_SCALE × plátno)
  let sh = 0;
  const fbo = gl.createFramebuffer();
  let lastVp = null;
  const vpArray = new Float32Array(16);
  let lastTime = 0;
  let spawn = spawnRectFromView(null);
  let respawnBoost = 0;
  let active = total;

  function resize() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(container.clientWidth * dpr));
    const h = Math.max(1, Math.floor(container.clientHeight * dpr));
    if (w === width && h === height && screenA) return;
    width = w; height = h;
    canvas.width = w; canvas.height = h;
    if (screenA) { gl.deleteTexture(screenA); gl.deleteTexture(screenB); }
    sw = Math.max(1, Math.floor(w * WIND_SCREEN_SCALE));
    sh = Math.max(1, Math.floor(h * WIND_SCREEN_SCALE));
    const empty = new Uint8Array(sw * sh * 4);
    // LINEAR: pri zväčšení na plátno sa čiary zmäkčia (žiadny raster).
    screenA = texture(gl, gl.LINEAR, empty, sw, sh);
    screenB = texture(gl, gl.LINEAR, empty, sw, sh);
  }

  function bindQuad(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(prog.attribs.a_pos);
    gl.vertexAttribPointer(prog.attribs.a_pos, 2, gl.FLOAT, false, 0, 0);
  }

  function bindTex(tex, unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

  function drawTexture(tex, opacity) {
    gl.useProgram(progScreen.p);
    bindQuad(progScreen);
    bindTex(tex, 2);
    gl.uniform1i(progScreen.uniforms.u_screen, 2);
    gl.uniform1f(progScreen.uniforms.u_opacity, opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function readCamera() {
    const camera = viewer?.scene?.camera;
    if (!camera) return null;
    const Cesium = globalThis.Cesium;
    const vm = camera.viewMatrix;
    const pm = camera.frustum.projectionMatrix;
    if (!vm || !pm) return null;
    if (Cesium?.Matrix4) {
      const vp = Cesium.Matrix4.multiply(pm, vm, readCamera._scratch || (readCamera._scratch = new Cesium.Matrix4()));
      Cesium.Matrix4.toArray(vp, vpArray);
    } else {
      for (let i = 0; i < 16; i += 1) vpArray[i] = pm[i];
    }
    const c = camera.positionWC;
    let rect = null;
    try {
      const r = camera.computeViewRectangle?.(viewer.scene.globe?.ellipsoid);
      if (r && Cesium?.Math) rect = { west: Cesium.Math.toDegrees(r.west), south: Cesium.Math.toDegrees(r.south), east: Cesium.Math.toDegrees(r.east), north: Cesium.Math.toDegrees(r.north) };
    } catch { rect = null; }
    const height = camera.positionCartographic?.height;
    return { vp: vpArray, cam: [c.x, c.y, c.z], rect, height: Number.isFinite(height) ? height : null };
  }

  function frame(now) {
    state.frame = requestFrame(frame);
    if (!state.running || !state.visible || !windTex) return;
    const scene = viewer?.scene;
    const mode = sceneModeCode(scene);
    if (mode < 0) {
      // Prechod medzi režimami (morph): plátno vyprázdniť, kým sa nedokončí.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width || 1, height || 1);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    if (mode !== state.mode) { state.mode = mode; clearScreen(); }
    resize();
    const cam = readCamera();
    if (!cam) return;
    const moving = matricesDiffer(lastVp, cam.vp);
    lastVp = Float32Array.from(cam.vp);
    state.moving = moving;
    // Výrez zrodu a hustota podľa priblíženia (Windy: častice žijú len v zábere).
    const nextSpawn = spawnRectFromView(cam.rect);
    if (spawnRectChanged(spawn, nextSpawn)) respawnBoost = WIND_RESPAWN_BOOST_FRAMES;
    spawn = nextSpawn;
    active = activeParticleCount(total, spawn.areaFraction);
    state.active = active;
    state.spawn = spawn;
    // dtFrame MUSÍ byť pred simDt (2026-09-09: TDZ ReferenceError každý snímok →
    // žiadne prúdnice a záplava výnimiek v konzole).
    const dtFrame = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;
    const simDt = simSecondsPerFrame(cam.height) * (dtFrame * 60);
    state.simDt = simDt;

    // 1. stopy: predchádzajúca obrazovka s útlmom → screenB
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, screenB, 0);
    gl.viewport(0, 0, sw, sh);
    gl.disable(gl.BLEND);
    drawTexture(screenA, moving ? WIND_TRAIL_FADE_MOVING : WIND_TRAIL_FADE);

    // 2. úsečky predchádzajúca → aktuálna poloha (stateB = stav pred posledným posunom)
    gl.useProgram(progDraw.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.enableVertexAttribArray(progDraw.attribs.a_index);
    gl.vertexAttribPointer(progDraw.attribs.a_index, 1, gl.FLOAT, false, 8, 0);
    gl.enableVertexAttribArray(progDraw.attribs.a_end);
    gl.vertexAttribPointer(progDraw.attribs.a_end, 1, gl.FLOAT, false, 8, 4);
    bindTex(stateA, 0); gl.uniform1i(progDraw.uniforms.u_particles, 0);
    bindTex(stateB, 4); gl.uniform1i(progDraw.uniforms.u_particles_prev, 4);
    gl.uniform1f(progDraw.uniforms.u_max_seg_m, maxSegmentMetres(simDt));
    gl.uniform1f(progDraw.uniforms.u_mode, mode);
    bindTex(windTex, 1); gl.uniform1i(progDraw.uniforms.u_wind, 1);
    bindTex(windNextTex || windTex, 5); gl.uniform1i(progDraw.uniforms.u_wind_next, 5);
    gl.uniform1f(progDraw.uniforms.u_mix, windNextTex ? windMix : 0);
    bindTex(rampTex, 3); gl.uniform1i(progDraw.uniforms.u_ramp, 3);
    gl.uniform2f(progDraw.uniforms.u_wind_min, windMin[0], windMin[1]);
    gl.uniform2f(progDraw.uniforms.u_wind_max, windMax[0], windMax[1]);
    gl.uniform1f(progDraw.uniforms.u_particles_res, res);
    gl.uniformMatrix4fv(progDraw.uniforms.u_vp, false, cam.vp);
    gl.uniform3f(progDraw.uniforms.u_cam, cam.cam[0], cam.cam[1], cam.cam[2]);
    gl.uniform2f(progDraw.uniforms.u_ramp_range, rampRange[0], rampRange[1]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.LINES, 0, active * 2);
    gl.disable(gl.BLEND);

    // 3. na plátno
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawTexture(screenB, 1.0);
    gl.disable(gl.BLEND);
    [screenA, screenB] = [screenB, screenA];

    // 4. posun častíc → stateB
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateB, 0);
    gl.viewport(0, 0, res, res);
    gl.useProgram(progUpdate.p);
    bindQuad(progUpdate);
    bindTex(stateA, 0); gl.uniform1i(progUpdate.uniforms.u_particles, 0);
    bindTex(windTex, 1); gl.uniform1i(progUpdate.uniforms.u_wind, 1);
    bindTex(windNextTex || windTex, 5); gl.uniform1i(progUpdate.uniforms.u_wind_next, 5);
    gl.uniform1f(progUpdate.uniforms.u_mix, windNextTex ? windMix : 0);
    frameCount = (frameCount + 1) % 1_000_000;
    gl.uniform1f(progUpdate.uniforms.u_frame, frameCount);
    gl.uniform1f(progUpdate.uniforms.u_max_age, WIND_PARTICLE_MAX_AGE_FRAMES);
    gl.uniform2f(progUpdate.uniforms.u_wind_min, windMin[0], windMin[1]);
    gl.uniform2f(progUpdate.uniforms.u_wind_max, windMax[0], windMax[1]);
    gl.uniform1f(progUpdate.uniforms.u_rand_seed, Math.random());
    gl.uniform1f(progUpdate.uniforms.u_dt, simDt);
    gl.uniform4f(progUpdate.uniforms.u_spawn, spawn.west, spawn.south, spawn.width, spawn.height);
    const boosted = respawnBoost > 0;
    if (boosted) respawnBoost -= 1;
    gl.uniform1f(progUpdate.uniforms.u_drop_rate, boosted ? WIND_RESPAWN_BOOST_RATE : WIND_DROP_RATE);
    gl.uniform1f(progUpdate.uniforms.u_drop_rate_bump, WIND_DROP_RATE_BUMP);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    [stateA, stateB] = [stateB, stateA];
  }

  function clearScreen() {
    if (!screenA) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (const tex of [screenA, screenB]) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, sw, sh);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width || 1, height || 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  return {
    isSupported: () => true,
    /**
     * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} image RG = u,v kvantizované
     * @param {{uRange:[number,number], vRange:[number,number]}} ranges
     */
    setWind(image, { uRange = [-60, 60], vRange = [-60, 60], next = null, clear = true } = {}) {
      if (windTex) gl.deleteTexture(windTex);
      windTex = texture(gl, gl.LINEAR, image);
      if (windNextTex) { gl.deleteTexture(windNextTex); windNextTex = null; }
      if (next) windNextTex = texture(gl, gl.LINEAR, next);
      windMix = 0;
      windMin = [uRange[0], vRange[0]];
      windMax = [uRange[1], vRange[1]];
      state.windSet = true;
      // Pri plynulom prehrávaní sa stopy nemažú — vietor sa mení spojito.
      if (clear) clearScreen();
    },
    /** Podiel ďalšieho kroku 0..1 (interpolácia v čase). */
    setMix(t) { windMix = Math.max(0, Math.min(1, Number(t) || 0)); },
    /** @param {Uint8ClampedArray|Uint8Array} rgba n×4 @param {[number,number]} range */
    setRamp(rgba, range) {
      if (rampTex) gl.deleteTexture(rampTex);
      rampTex = texture(gl, gl.LINEAR, new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), rgba.length / 4, 1);
      rampRange = [range[0], range[1]];
    },
    start() {
      if (state.running) return;
      state.running = true;
      canvas.hidden = !state.visible;
      lastTime = 0;
      if (state.frame === null) state.frame = requestFrame(frame);
    },
    stop() {
      state.running = false;
      if (state.frame !== null) { cancelFrame(state.frame); state.frame = null; }
      clearScreen();
      canvas.hidden = true;
    },
    setVisible(visible) {
      state.visible = Boolean(visible);
      canvas.hidden = !(state.running && state.visible);
      if (!state.visible) clearScreen();
    },
    getState: () => ({ ...state, count: total, res }),
    destroy() {
      this.stop();
      for (const tex of [stateA, stateB, windTex, windNextTex, rampTex, screenA, screenB]) if (tex) gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      canvas.remove();
    },
  };
}

function stub(canvas, state) {
  canvas.remove();
  return {
    isSupported: () => false,
    setWind() {}, setMix() {}, setRamp() {}, start() {}, stop() {}, setVisible() {}, destroy() {},
    getState: () => ({ ...state, count: 0, res: 0 }),
  };
}
