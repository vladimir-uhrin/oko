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
// snímku (viewMatrix je lenivý getter). 2D režim (PLÁTNO) a chýbajúci
// WebGL2 = bez častíc, vrstva ostáva (drapéria poľa).

export const WIND_PARTICLE_COUNT_DEFAULT = 16_384; // 128 × 128 — jemná sieť, nie hustá
// Ladenie 2026-09-08 (používateľ: „jemné a bez rastrov, nie vybodkované"):
// častica sa kreslí ako ÚSEČKA z predchádzajúcej do aktuálnej polohy (žiadne
// bodky medzi snímkami), stopy žijú v menšej textúre s lineárnym filtrom
// (mäkké), pomalší posun a menej častíc.
export const WIND_TRAIL_FADE = 0.975;
export const WIND_TRAIL_FADE_MOVING = 0.6;
export const WIND_DROP_RATE = 0.003;
export const WIND_DROP_RATE_BUMP = 0.01;
/** Sekundy simulovaného času na snímok pri 60 fps (~10 m/s ≈ 0,07°/snímok). */
export const WIND_SIM_SECONDS_PER_FRAME = 320;
/** Rozlíšenie textúry stôp voči plátnu (< 1 = mäkšie čiary, lacnejšie). */
export const WIND_SCREEN_SCALE = 0.55;
/** Úsečka dlhšia než toto (m) = častica sa zrodila inde → nekresliť. */
export const WIND_MAX_SEGMENT_M = 300_000;
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
in vec2 v_uv;
out vec4 o;
const vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);
float rand(const vec2 co) { float t = dot(rand_constants.xy, co); return fract(sin(t) * (rand_constants.z + t)); }
void main() {
  vec4 color = texture(u_particles, v_uv);
  vec2 pos = vec2(color.r / 255.0 + color.b, color.g / 255.0 + color.a); // 0..1
  float lon = pos.x * 360.0 - 180.0;
  float lat = pos.y * 180.0 - 90.0;
  // GFS mriežka: stĺpce 0..360° E (začína na 0°), riadok 0 = 90° N.
  vec2 wuv = vec2(fract((lon + 360.0) / 360.0), (90.0 - lat) / 180.0);
  vec2 w = mix(u_wind_min, u_wind_max, mix(texture(u_wind, wuv).rg, texture(u_wind_next, wuv).rg, u_mix));
  float speed = length(w);
  float speed_t = clamp(speed / 40.0, 0.0, 1.0);
  float coslat = max(cos(radians(lat)), 0.15);
  float dlon = w.x * u_dt / (111320.0 * coslat);
  float dlat = w.y * u_dt / 110540.0;
  vec2 next = vec2(fract(pos.x + dlon / 360.0), clamp(pos.y + dlat / 180.0, 0.002, 0.998));
  vec2 seed = (pos + v_uv) * u_rand_seed;
  float drop_rate = u_drop_rate + speed_t * u_drop_rate_bump;
  // Vek: každá častica má pevnú fázu (hash jej miesta v textúre), zaniká raz za
  // u_max_age snímkov — rovnomerné rozloženie vekov = rovnomerná hustota čiar.
  float phase = rand(v_uv * 7.31) * u_max_age;
  float aged = step(mod(u_frame + phase, u_max_age), 0.999);
  float drop = max(step(1.0 - drop_rate, rand(seed)), aged);
  vec2 random_pos = vec2(rand(seed + 1.3), rand(seed + 2.1));
  // Rovnomerne po ploche gule: lat = asin(2r-1).
  random_pos.y = (degrees(asin(random_pos.y * 2.0 - 1.0)) + 90.0) / 180.0;
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
out float v_speed_t;
out float v_vis;
const float A = 6378137.0;
const float B = 6356752.314245;
vec2 decode(vec4 color) { return vec2(color.r / 255.0 + color.b, color.g / 255.0 + color.a); }
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
  vec3 pNow = ecef(posNow);
  vec3 pPrev = ecef(posPrev);
  // Úsečka len keď sú OBA konce viditeľné a častica sa nezrodila inde (skok cez šev ±180° / respawn).
  float ok = visible(pNow) * visible(pPrev) * (distance(pNow, pPrev) < u_max_seg_m ? 1.0 : 0.0);
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
  // Jemné: mierne zosvetlené, polopriehľadné — stopa vzniká útlmom, nie jasom.
  o = vec4(mix(c.rgb, vec3(1.0), 0.18), 0.6);
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
  const state = { supported: Boolean(gl), running: false, visible: true, frame: null, windSet: false, fps: 0, moving: false };
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
    return { vp: vpArray, cam: [c.x, c.y, c.z] };
  }

  function frame(now) {
    state.frame = requestFrame(frame);
    if (!state.running || !state.visible || !windTex) return;
    const scene = viewer?.scene;
    if (scene?.mode !== undefined && globalThis.Cesium?.SceneMode && scene.mode !== globalThis.Cesium.SceneMode.SCENE3D) {
      // 2D / Columbus: bez častíc (projekcia by nesedela) — plátno vyprázdniť.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width || 1, height || 1);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    resize();
    const cam = readCamera();
    if (!cam) return;
    const moving = matricesDiffer(lastVp, cam.vp);
    lastVp = Float32Array.from(cam.vp);
    state.moving = moving;
    const dtFrame = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;

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
    gl.uniform1f(progDraw.uniforms.u_max_seg_m, WIND_MAX_SEGMENT_M);
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
    gl.drawArrays(gl.LINES, 0, total * 2);
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
    gl.uniform1f(progUpdate.uniforms.u_dt, WIND_SIM_SECONDS_PER_FRAME * (dtFrame * 60));
    gl.uniform1f(progUpdate.uniforms.u_drop_rate, WIND_DROP_RATE);
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
