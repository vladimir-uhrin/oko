// src/data/ukraineContactLine.js
/**
 * @module ukraineContactLine
 * @description Línia kontaktu odvodená z polygónov DeepState (2026-09-24, vlastník:
 * „snaž sa o prehľadnosť ako špičkové portály"). Mapa mala plochy, šrafy a body,
 * ale nie jednu jasnú čiaru „tu je front". Čiara = tie úseky obrysu ruskej
 * kontroly (okupované, ORDLO, Krym, Tuzla), za ktorými leží ukrajinská pevnina.
 * Hranica s Ruskom (za ňou Rusko), pobrežie (more) a vnútorné hranice medzi
 * ruskými druhmi (okupované × ORDLO — na oboch stranách ruská kontrola) sa
 * nerátajú. Odvodené, nie meraná línia: kreslí sa a popisuje ako odvodená.
 *
 * Postup pre každú hranu obrysu: vonkajšiu stranu určí orientácia prstenca;
 * bod tesne za hranou (`sideKm`) nesmie byť pod ruskou kontrolou (inak je to
 * vnútorná hranica), body ďalej (`landKm`, `landFarKm`) musia ležať na pevnine
 * Ukrajiny (Natural Earth je zjednodušený o 1–2 km — bližší bod by pri štátnej
 * hranici a pobreží ešte „bol na pevnine"). Medzery kratšie než `bridgeKm` medzi
 * úsekmi frontu sa premostia (zubatý obrys), úseky kratšie než `minKm` zahodia.
 * Čistý modul (bez Cesia), rovnaký tvar indexu ako buildPolyIndex vo vrstve.
 */

/** Druhy DeepState s ruskou kontrolou (zhodné s DEEPSTATE_RU_KINDS vo vrstve). */
export const CONTACT_RU_KINDS = Object.freeze(['occupied', 'ordlo', 'crimea', 'tuzla']);
export const CONTACT_SIDE_KM = 0.3;
export const CONTACT_LAND_KM = 3;
/** Druhý, vzdialenejší bod pevniny — štátna hranica a pobrežie ním neprejdú ani pri zjednodušení Natural Earth. */
export const CONTACT_LAND_FAR_KM = 6;
export const CONTACT_BRIDGE_KM = 3;
/**
 * Najkratší kreslený úsek (km). Kratšie kúsky sú prevažne okraje polygónu DeepState,
 * ktorý pri štátnej hranici (Luhanská obl.) či pobreží nekončí presne na nej —
 * ostal by za ním úzky pás „pevniny". Plochu okupovaného územia to nemení.
 */
export const CONTACT_MIN_KM = 12;

const KM_PER_DEG = 111.32;
/** Bod v prstenci (párny/nepárny) nad plochým poľom [x0,y0,x1,y1,…]. */
function inFlat(lon, lat, f) {
  let inside = false;
  const n = f.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const yi = f[i + 1]; const yj = f[j + 1];
    if ((yi > lat) !== (yj > lat)) {
      const xi = f[i]; const xj = f[j];
      if (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function prep(ring) {
  const flat = new Float64Array(ring.length * 2);
  let w = 180; let s = 90; let e = -180; let n = -90;
  ring.forEach(([lon, lat], i) => {
    flat[i * 2] = lon; flat[i * 2 + 1] = lat;
    if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat;
  });
  return { flat, w, s, e, n };
}
const hit = (lon, lat, p) => lon >= p.w && lon <= p.e && lat >= p.s && lat <= p.n && inFlat(lon, lat, p.flat);
/** Znamienková plocha prstenca (°²): > 0 = proti smeru hodinových ručičiek. */
function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  return a / 2;
}

/** Dĺžka lomenej čiary [[lon,lat],…] v km (rovinná aproximácia). Pure. */
export function pathLengthKm(path) {
  let km = 0;
  for (let i = 1; i < path.length; i += 1) {
    const [x0, y0] = path[i - 1]; const [x1, y1] = path[i];
    const kx = KM_PER_DEG * Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    km += Math.hypot((x1 - x0) * kx, (y1 - y0) * KM_PER_DEG);
  }
  return km;
}

/**
 * Úseky línie kontaktu ako lomené čiary [[lon,lat],…]. Pure.
 * @param {Array<{kind:string, ring:Array<[number,number]>}>} index polygóny (vonkajšie prstence)
 * @param {Array<Array<[number,number]>>} landRings pevnina Ukrajiny
 */
export function contactLinePaths(index, landRings, {
  sideKm = CONTACT_SIDE_KM, landKm = CONTACT_LAND_KM, landFarKm = CONTACT_LAND_FAR_KM, bridgeKm = CONTACT_BRIDGE_KM, minKm = CONTACT_MIN_KM, ruKinds = CONTACT_RU_KINDS,
} = {}) {
  const polys = (Array.isArray(index) ? index : []).filter((p) => ruKinds.includes(p?.kind) && Array.isArray(p.ring) && p.ring.length >= 4);
  const ru = polys.map((p) => prep(p.ring));
  const land = (Array.isArray(landRings) ? landRings : []).filter((r) => Array.isArray(r) && r.length >= 4).map(prep);
  if (!ru.length || !land.length) return [];
  const isRu = (lon, lat) => ru.some((p) => hit(lon, lat, p));
  const onLand = (lon, lat) => land.some((p) => hit(lon, lat, p));
  const paths = [];
  for (const { ring } of polys) {
    const closed = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
    const m = closed ? ring.length - 1 : ring.length; // počet hrán (uzavretý) / vrcholov
    if (m < 3) continue;
    const ccw = signedArea(ring) > 0;
    const front = new Array(m).fill(false);
    const lenKm = new Array(m).fill(0);
    for (let i = 0; i < m; i += 1) {
      const a = ring[i]; const b = ring[(i + 1) % m];
      const midLat = (a[1] + b[1]) / 2; const midLon = (a[0] + b[0]) / 2;
      const kx = KM_PER_DEG * Math.cos((midLat * Math.PI) / 180);
      const dx = (b[0] - a[0]) * kx; const dy = (b[1] - a[1]) * KM_PER_DEG;
      const len = Math.hypot(dx, dy);
      lenKm[i] = len;
      if (!(len > 0)) continue;
      // Vonkajšia normála: pri prstenci proti smeru hodinových ručičiek je vnútro vľavo.
      const ox = (ccw ? dy : -dy) / len; const oy = (ccw ? -dx : dx) / len;
      const sLon = midLon + (ox * sideKm) / kx; const sLat = midLat + (oy * sideKm) / KM_PER_DEG;
      if (isRu(sLon, sLat)) continue; // za hranou je tiež ruská kontrola (ORDLO, susedný polygón)
      const lLon = midLon + (ox * landKm) / kx; const lLat = midLat + (oy * landKm) / KM_PER_DEG;
      const fLon = midLon + (ox * landFarKm) / kx; const fLat = midLat + (oy * landFarKm) / KM_PER_DEG;
      front[i] = onLand(lLon, lLat) && onLand(fLon, fLat);
    }
    if (!front.some(Boolean)) continue;
    // Premostenie krátkych medzier (cyklicky, prstenec je uzavretý).
    const start = front.indexOf(false);
    if (start >= 0) {
      let i = start;
      for (let steps = 0; steps < m;) {
        if (front[i]) { i = (i + 1) % m; steps += 1; continue; }
        let j = i; let gap = 0; let count = 0;
        while (!front[j] && count < m) { gap += lenKm[j]; j = (j + 1) % m; count += 1; }
        const prevFront = front[(i - 1 + m) % m];
        if (count < m && prevFront && front[j] && gap <= bridgeKm) {
          for (let k = i, c = 0; c < count; k = (k + 1) % m, c += 1) front[k] = true;
        }
        steps += count; i = j;
      }
    }
    // Úseky: začni za prvou nefrontovou hranou, aby sa úsek cez začiatok nerozdelil.
    const first = front.indexOf(false);
    const origin = first < 0 ? 0 : (first + 1) % m;
    let cur = null;
    for (let c = 0; c < m; c += 1) {
      const i = (origin + c) % m;
      if (front[i]) {
        if (!cur) cur = [ring[i]];
        cur.push(ring[(i + 1) % m]);
      } else if (cur) { if (pathLengthKm(cur) >= minKm) paths.push(cur); cur = null; }
    }
    if (cur && pathLengthKm(cur) >= minKm) paths.push(cur);
  }
  return paths;
}

/** Šírka prifrontového pásma (km od línie kontaktu, na ukrajinskej strane). */
export const FRONT_ZONE_KM = 6;
/** Bunka rastra pásma (°) ≈ 1,1 × 0,75 km na 48° s. š. */
export const FRONT_ZONE_CELL_DEG = 0.01;

/**
 * Maska mriežky (1 = stred bunky leží v niektorom prstenci) riadkovým vypĺňaním:
 * pre každý riadok priesečníky hrán prstenca so šírkou stredu riadku, zoradené,
 * párne-nepárne úseky. Presné ako bod v polygóne, ale O(hrany + bunky). Pure.
 */
function ringMask(rings, width, height, west, north, cellDeg) {
  const mask = new Uint8Array(width * height);
  const rows = new Array(height);
  for (const ring of rings) {
    for (let r = 0; r < height; r += 1) rows[r] = null;
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const [x0, y0] = ring[i]; const [x1, y1] = ring[(i + 1) % n];
      if (y0 === y1) continue;
      const lo = Math.min(y0, y1); const hi = Math.max(y0, y1);
      // riadky, ktorých stred (north − (r + 0,5)·cell) leží v [lo, hi)
      const rTop = Math.max(0, Math.ceil((north - hi) / cellDeg - 0.5));
      const rBot = Math.min(height - 1, Math.floor((north - lo) / cellDeg - 0.5));
      for (let r = rTop; r <= rBot; r += 1) {
        const lat = north - (r + 0.5) * cellDeg;
        if (lat < lo || lat >= hi) continue;
        const x = x0 + ((lat - y0) * (x1 - x0)) / (y1 - y0);
        (rows[r] ||= []).push(x);
      }
    }
    for (let r = 0; r < height; r += 1) {
      const xs = rows[r];
      if (!xs || xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - west) / cellDeg - 0.5));
        const c1 = Math.min(width - 1, Math.floor((xs[k + 1] - west) / cellDeg - 0.5));
        for (let c = c0; c <= c1; c += 1) mask[r * width + c] = 1;
      }
    }
  }
  return mask;
}

/**
 * Prifrontové pásmo (2026-09-26, vlastník: „teraz tam nevidno vôbec nič na
 * frontovej línii"): mirror DeepState nemá sivú zónu, pás z Wikipédie je 44 dní
 * starý a nad dnešnými polygónmi vyzeral ako fľaky. Pásmo sa preto odvodí priamo
 * z DNEŠNEJ línie kontaktu: bunky do `radiusKm` od línie, mimo ruskej kontroly
 * a (ak je daná) na pevnine Ukrajiny, s intenzitou klesajúcou od línie
 * ((1 − d/R)^1,6, 1–255). Geometria, nie údaj o bojoch — kreslí sa a popisuje ako
 * „do N km od línie, odvodené". Pure.
 * @param {Array<Array<[number,number]>>} paths úseky línie kontaktu
 * @param {Array<{kind:string, ring:Array<[number,number]>}>} index polygóny DeepState
 * @returns {{width:number,height:number,cellDeg:number,bbox:{west:number,south:number,east:number,north:number},values:Uint8Array,cells:number}|null}
 */
export function frontZoneRaster(paths, index, { radiusKm = FRONT_ZONE_KM, cellDeg = FRONT_ZONE_CELL_DEG, ruKinds = CONTACT_RU_KINDS, landRings = null } = {}) {
  const segs = [];
  let w = 180; let s = 90; let e = -180; let n = -90;
  for (const path of Array.isArray(paths) ? paths : []) {
    for (let i = 1; i < (path?.length || 0); i += 1) {
      const [x0, y0] = path[i - 1]; const [x1, y1] = path[i];
      if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
      segs.push(x0, y0, x1, y1);
      w = Math.min(w, x0, x1); e = Math.max(e, x0, x1); s = Math.min(s, y0, y1); n = Math.max(n, y0, y1);
    }
  }
  if (!segs.length) return null;
  const padLat = radiusKm / KM_PER_DEG;
  const padLon = radiusKm / (KM_PER_DEG * Math.max(0.1, Math.cos((Math.max(Math.abs(s), Math.abs(n)) * Math.PI) / 180)));
  const west = Math.floor((w - padLon) / cellDeg) * cellDeg;
  const north = Math.ceil((n + padLat) / cellDeg) * cellDeg;
  const width = Math.max(1, Math.ceil((e + padLon - west) / cellDeg));
  const height = Math.max(1, Math.ceil((north - (s - padLat)) / cellDeg));
  const dist = new Float32Array(width * height).fill(Infinity);
  for (let k = 0; k < segs.length; k += 4) {
    const x0 = segs[k]; const y0 = segs[k + 1]; const x1 = segs[k + 2]; const y1 = segs[k + 3];
    const c0 = Math.max(0, Math.floor((Math.min(x0, x1) - padLon - west) / cellDeg));
    const c1 = Math.min(width - 1, Math.floor((Math.max(x0, x1) + padLon - west) / cellDeg));
    const r0 = Math.max(0, Math.floor((north - (Math.max(y0, y1) + padLat)) / cellDeg));
    const r1 = Math.min(height - 1, Math.floor((north - (Math.min(y0, y1) - padLat)) / cellDeg));
    for (let r = r0; r <= r1; r += 1) {
      const lat = north - (r + 0.5) * cellDeg;
      const kx = KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
      const ax = (x0 - west) * kx; const ay = (y0 - lat) * KM_PER_DEG;
      const bx = (x1 - west) * kx; const by = (y1 - lat) * KM_PER_DEG;
      const dx = bx - ax; const dy = by - ay; const len2 = dx * dx + dy * dy;
      for (let c = c0; c <= c1; c += 1) {
        const px = (c + 0.5) * cellDeg * kx;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx - ay * dy) / len2)) : 0;
        const d = Math.hypot(px - (ax + t * dx), ay + t * dy);
        const idx = r * width + c;
        if (d < dist[idx]) dist[idx] = d;
      }
    }
  }
  const ruRings = (Array.isArray(index) ? index : []).filter((p) => ruKinds.includes(p?.kind) && Array.isArray(p.ring) && p.ring.length >= 4).map((p) => p.ring);
  const ruMask = ringMask(ruRings, width, height, west, north, cellDeg);
  // Pevnina Ukrajiny (voliteľne): konce línie pri štátnej hranici a pobreží nesmú
  // pásmom pretiecť do Ruska ani do mora.
  const landList = (Array.isArray(landRings) ? landRings : []).filter((r) => Array.isArray(r) && r.length >= 4);
  const landMask = landList.length ? ringMask(landList, width, height, west, north, cellDeg) : null;
  const values = new Uint8Array(width * height);
  let cells = 0;
  for (let idx = 0; idx < values.length; idx += 1) {
    const d = dist[idx];
    if (!(d < radiusKm) || ruMask[idx] || (landMask && !landMask[idx])) continue;
    values[idx] = Math.max(1, Math.round(255 * Math.pow(1 - d / radiusKm, 1.6)));
    cells += 1;
  }
  return { width, height, cellDeg, bbox: { west, south: north - height * cellDeg, east: west + width * cellDeg, north }, values, cells };
}
