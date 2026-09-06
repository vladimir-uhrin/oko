// OKO — procedurálny 3D model sopky (public/models/volcano.glb).
//
// Vlastné dielo projektu (CC0). Verzia 2 (2026-09-06): používateľ mal pravdu,
// v1 mal celý kráter jednu jasnú oranžovú placku ako nálepku. Teraz je to
// strmší kužeľ z tmavého čadiča, kráter je zapustený a TMAVÝ a svieti len malé
// jadro v strede — žeravý prieduch, nie neónový disk.
//
// Kužeľ je v metroch, pôvod v strede základne, glTF +Y hore, takže entita
// s CLAMP_TO_GROUND sadne na terén. Dva materiály (čadič, žeravé jadro).
//   node scripts/build-volcano-model.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/models/volcano.glb');
const SEG = 48;
const BASE_R = 950, RIM_R = 300, HEIGHT = 1150;       // strmší, rozoznateľný kužeľ
const CRATER_DEPTH = 150, FLOOR_R = 190, VENT_R = 85; // zapustený tmavý kráter + malý prieduch

const push3 = (a, x, y, z) => { a.push(x, y, z); };

/** Prstencový plášť medzi (r0,y0) a (r1,y1); normály von alebo dnu. */
function wall(g, r0, y0, r1, y1, outward) {
  const slope = Math.atan2(Math.abs(r0 - r1), Math.abs(y1 - y0)) || 0;
  const ny = Math.sin(slope) * (r0 > r1 ? 1 : -1);
  const rad = Math.cos(slope) * (outward ? 1 : -1);
  const start = g.pos.length / 3;
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    push3(g.pos, c * r0, y0, s * r0); push3(g.nrm, c * rad, ny, s * rad);
    push3(g.pos, c * r1, y1, s * r1); push3(g.nrm, c * rad, ny, s * rad);
  }
  for (let i = 0; i < SEG; i++) {
    const b = start + i * 2;
    if (outward) g.idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    else g.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
}

/** Plochý medzikruh (rInner..rOuter) v rovine y, normála hore. */
function annulus(g, rInner, rOuter, y) {
  const start = g.pos.length / 3;
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    push3(g.pos, c * rInner, y, s * rInner); push3(g.nrm, 0, 1, 0);
    push3(g.pos, c * rOuter, y, s * rOuter); push3(g.nrm, 0, 1, 0);
  }
  for (let i = 0; i < SEG; i++) { const b = start + i * 2; g.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
}

/** Plný disk polomeru r v rovine y, normála hore. */
function disc(g, r, y) {
  const c0 = g.pos.length / 3;
  push3(g.pos, 0, y, 0); push3(g.nrm, 0, 1, 0);
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    push3(g.pos, Math.cos(a) * r, y, Math.sin(a) * r); push3(g.nrm, 0, 1, 0);
  }
  for (let i = 1; i <= SEG; i++) g.idx.push(c0, c0 + i + 1, c0 + i);
}

function pad4(n) { return (4 - (n % 4)) % 4; }

function build() {
  const basalt = { pos: [], nrm: [], idx: [] };
  const ember = { pos: [], nrm: [], idx: [] };
  const floorY = HEIGHT - CRATER_DEPTH;
  wall(basalt, BASE_R, 0, RIM_R, HEIGHT, true);       // vonkajší svah
  wall(basalt, RIM_R, HEIGHT, FLOOR_R, floorY, false); // vnútorná stena krátera
  annulus(basalt, VENT_R, FLOOR_R, floorY);            // tmavé dno krátera
  disc(ember, VENT_R, floorY - 12);                    // žeravý prieduch v strede

  const prims = [basalt, ember];
  const chunks = []; const bufferViews = []; const accessors = []; let offset = 0; const meshPrims = [];
  const put = (arr, ctor, target) => {
    const bytes = Buffer.from(new ctor(arr).buffer);
    const padded = Buffer.concat([bytes, Buffer.alloc(pad4(bytes.length))]);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(padded); offset += padded.length; return bufferViews.length - 1;
  };
  for (const [m, p] of prims.entries()) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.pos[i + k]); max[k] = Math.max(max[k], p.pos[i + k]); }
    const pv = put(p.pos, Float32Array, 34962), nv = put(p.nrm, Float32Array, 34962), iv = put(p.idx, Uint16Array, 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: p.pos.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: nv, componentType: 5126, count: p.nrm.length / 3, type: 'VEC3' });
    accessors.push({ bufferView: iv, componentType: 5123, count: p.idx.length, type: 'SCALAR' });
    const a = accessors.length - 3;
    meshPrims.push({ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material: m });
  }
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'OKO build-volcano-model.mjs v2', copyright: 'OKO project, CC0 1.0' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'volcano' }],
    meshes: [{ name: 'volcano', primitives: meshPrims }],
    materials: [
      { name: 'basalt', pbrMetallicRoughness: { baseColorFactor: [0.13, 0.115, 0.11, 1], metallicFactor: 0, roughnessFactor: 1 } },
      { name: 'vent', pbrMetallicRoughness: { baseColorFactor: [0.28, 0.06, 0.02, 1], metallicFactor: 0, roughnessFactor: 0.7 }, emissiveFactor: [1, 0.34, 0.08] },
    ],
    buffers: [{ byteLength: bin.length }], bufferViews, accessors,
  };
  let jsonBytes = Buffer.from(JSON.stringify(json));
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length), 0x20)]);
  const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBytes.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([header, jh, jsonBytes, bh, bin]);
}

const glb = build();
fs.writeFileSync(OUT, glb);
console.log(`volcano.glb: ${glb.length} bytes → ${OUT}`);
