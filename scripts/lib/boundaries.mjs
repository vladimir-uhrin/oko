// scripts/lib/boundaries.mjs — čisté pomôcky pre build hraníc a popisiek štátov (scripts/build-boundaries.mjs).
// Bez siete a bez súborov, aby sa dali testovať.

/**
 * Trieda čiary hranice z vlastností Natural Earth ne_50m_admin_0_boundary_lines_land:
 *  - 'international' — bežná medzinárodná hranica,
 *  - 'disputed' — sporná, línia kontroly, neurčitá/neurčená alebo podľa ISO neuznaná (čiarkovane),
 *  - null — nekresliť: vnútorná čiara (Admin-1) podľa medzinárodne uznaných hraníc.
 * Postoj OSN pre Ukrajinu: Natural Earth kreslí Krym de facto pod Ruskom, preto čiara, ktorú
 * Ukrajina klasifikuje ako vnútornú (Perekop), odpadá, a čiara, ktorú klasifikuje ako medzinárodnú
 * (Kerč), je medzinárodná — bez ohľadu na FEATURECLA.
 * @param {Record<string, unknown>} props
 * @returns {'international'|'disputed'|null}
 */
export function classifyBoundary(props = {}) {
  const ua = props.FCLASS_UA;
  if (ua === 'Admin-1 boundary') return null;
  if (ua === 'International boundary (verify)') return 'international';
  const fc = String(props.FEATURECLA || '');
  if (fc === 'Admin-1 boundary' || fc === 'Map unit boundary') return null;
  if (props.FCLASS_ISO === 'Unrecognized') return 'disputed';
  return fc === 'International boundary (verify)' ? 'international' : 'disputed';
}

/**
 * Body po stranách čiary na určenie štátu vľavo a vpravo: v 1/4, 1/2 a 3/4 dĺžky (podľa počtu
 * vrcholov) kolmo odsadené o `offsetDeg`. „Vľavo" je v smere čiary.
 * @param {number[][]} coords [lon, lat][]
 * @param {number} [offsetDeg]
 * @returns {{left: number[][], right: number[][]}}
 */
export function sideSamples(coords, offsetDeg = 0.03) {
  const left = []; const right = [];
  const n = coords.length;
  if (n < 2) return { left, right };
  const picks = n === 2 ? [0] : [...new Set([Math.floor((n - 1) * 0.25), Math.floor((n - 1) * 0.5), Math.floor((n - 1) * 0.75)])];
  for (const i of picks) {
    const [x1, y1] = coords[i]; const [x2, y2] = coords[Math.min(i + 1, n - 1)];
    const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
    const dx = x2 - x1; const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len; const ny = dx / len; // normála doľava od smeru
    left.push([mx + nx * offsetDeg, my + ny * offsetDeg]);
    right.push([mx - nx * offsetDeg, my - ny * offsetDeg]);
  }
  return { left, right };
}

/** Bod v prstenci (even-odd), prstenec [lon, lat][] (uzavretý alebo nie). */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    const intersects = ((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Bod v (Multi)Polygóne: prstence ako [[outer, hole, …], …]; diera bod vylučuje. */
export function pointInMultiPolygon(lon, lat, polygons) {
  for (const rings of polygons) {
    if (!rings.length || !pointInRing(lon, lat, rings[0])) continue;
    let inHole = false;
    for (let k = 1; k < rings.length; k++) if (pointInRing(lon, lat, rings[k])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Záznam popisky štátu z vlastností ne_50m_admin_0_countries; null bez platného ISO_A2_EH.
 * @param {Record<string, unknown>} p
 */
export function countryLabelRecord(p = {}) {
  const iso2 = String(p.ISO_A2_EH || '');
  if (!/^[A-Z]{2}$/.test(iso2)) return null;
  const lon = Number(p.LABEL_X); const lat = Number(p.LABEL_Y);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    iso2,
    a3: String(p.ADM0_A3 || ''),
    lon: Math.round(lon * 1e3) / 1e3,
    lat: Math.round(lat * 1e3) / 1e3,
    rank: Number(p.LABELRANK) || 10,
    minLabel: Number(p.MIN_LABEL) || 0,
    maxLabel: Number(p.MAX_LABEL) || 10,
    tiny: Number(p.TINY) > 0 ? Number(p.TINY) : 0,
    pop: Number(p.POP_EST) || 0,
    nameEn: String(p.NAME_EN || p.NAME || ''),
  };
}
