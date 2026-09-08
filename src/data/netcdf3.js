// src/data/netcdf3.js
// Minimálna čítačka NetCDF-3 (classic aj 64-bit offset) — čistý JS, bez závislostí.
// Použitie (2026-09-08, meteorológia): UCAR THREDDS NetCDF Subset Service vracia
// výrezy GFS ako NetCDF-3 (`CDF\x01`), takže server nepotrebuje GRIB2 dekodér.
// Formát: https://docs.unidata.ucar.edu/netcdf-c/current/file_format_specifications.html
//
// Podporuje: dimenzie (aj record/unlimited), globálne a premenné atribúty,
// typy byte/char/short/int/float/double, `scale_factor`/`add_offset`/`_FillValue`
// (→ NaN). Nepodporuje NetCDF-4 (HDF5) — ten začína `\x89HDF`.

const NC_TYPES = { 1: 'byte', 2: 'char', 3: 'short', 4: 'int', 5: 'float', 6: 'double' };
const NC_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };

function pad4(n) { return (n + 3) & ~3; }

class Reader {
  constructor(buffer) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.bytes = buffer;
    this.pos = 0;
  }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  u64() { const hi = this.view.getUint32(this.pos); const lo = this.view.getUint32(this.pos + 4); this.pos += 8; return hi * 4294967296 + lo; }
  name() {
    const len = this.u32();
    const s = new TextDecoder('utf-8').decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += pad4(len);
    return s;
  }
  values(type, count) {
    const size = NC_SIZES[type];
    const start = this.pos;
    let out;
    if (type === 2) {
      out = new TextDecoder('utf-8').decode(this.bytes.subarray(start, start + count));
    } else {
      out = readTyped(this.view, start, type, count);
    }
    this.pos += pad4(size * count);
    return out;
  }
  attrs() {
    const tag = this.u32();
    const n = this.u32();
    const out = {};
    if (tag === 0 && n === 0) return out;
    if (tag !== 0x0C) throw new Error(`netcdf3: očakávaný NC_ATTRIBUTE (0x0C), je 0x${tag.toString(16)}`);
    for (let i = 0; i < n; i += 1) {
      const name = this.name();
      const type = this.u32();
      const count = this.u32();
      const value = this.values(type, count);
      out[name] = type === 2 ? value : (count === 1 ? value[0] : Array.from(value));
    }
    return out;
  }
}

function readTyped(view, offset, type, count) {
  switch (type) {
    case 1: return new Int8Array(view.buffer, view.byteOffset + offset, count).slice();
    case 3: { const a = new Int16Array(count); for (let i = 0; i < count; i += 1) a[i] = view.getInt16(offset + i * 2); return a; }
    case 4: { const a = new Int32Array(count); for (let i = 0; i < count; i += 1) a[i] = view.getInt32(offset + i * 4); return a; }
    case 5: { const a = new Float32Array(count); for (let i = 0; i < count; i += 1) a[i] = view.getFloat32(offset + i * 4); return a; }
    case 6: { const a = new Float64Array(count); for (let i = 0; i < count; i += 1) a[i] = view.getFloat64(offset + i * 8); return a; }
    default: throw new Error(`netcdf3: nepodporovaný typ ${type}`);
  }
}

/**
 * Prečíta hlavičku NetCDF-3 a vráti prístup k premenným (lenivé čítanie dát).
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{version: number, dims: Array<{name: string, size: number, unlimited: boolean}>, attrs: object, vars: Record<string, object>, read: (name: string, options?: {raw?: boolean}) => Float32Array|Float64Array|Int32Array|Int16Array|Int8Array|string}}
 */
export function parseNetcdf3(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8 || bytes[0] !== 0x43 || bytes[1] !== 0x44 || bytes[2] !== 0x46) {
    if (bytes[0] === 0x89 && bytes[1] === 0x48) throw new Error('netcdf3: súbor je NetCDF-4/HDF5 — vyžiadaj accept=netcdf (classic)');
    throw new Error('netcdf3: chýba magic CDF');
  }
  const version = bytes[3];
  if (version !== 1 && version !== 2) throw new Error(`netcdf3: neznáma verzia ${version}`);
  const r = new Reader(bytes);
  r.pos = 4;
  const numrecs = r.u32();
  // dim_list
  let tag = r.u32();
  let n = r.u32();
  const dims = [];
  if (tag === 0x0A) {
    for (let i = 0; i < n; i += 1) {
      const name = r.name();
      const size = r.u32();
      dims.push({ name, size: size === 0 ? numrecs : size, unlimited: size === 0 });
    }
  } else if (!(tag === 0 && n === 0)) throw new Error('netcdf3: očakávaný NC_DIMENSION');
  const attrs = r.attrs();
  // var_list
  tag = r.u32();
  n = r.u32();
  const vars = {};
  const order = [];
  if (tag === 0x0B) {
    for (let i = 0; i < n; i += 1) {
      const name = r.name();
      const ndims = r.u32();
      const dimIds = [];
      for (let d = 0; d < ndims; d += 1) dimIds.push(r.u32());
      const vattrs = r.attrs();
      const type = r.u32();
      const vsize = r.u32();
      const begin = version === 1 ? r.u32() : r.u64();
      const shape = dimIds.map((id) => dims[id].size);
      const record = dimIds.length > 0 && dims[dimIds[0]].unlimited;
      vars[name] = { name, type: NC_TYPES[type], typeCode: type, dims: dimIds.map((id) => dims[id].name), shape, attrs: vattrs, vsize, begin, record };
      order.push(name);
    }
  } else if (!(tag === 0 && n === 0)) throw new Error('netcdf3: očakávaný NC_VARIABLE');
  // Veľkosť jedného záznamu = súčet vsize record premenných (so zarovnaním na 4).
  const recVars = order.filter((k) => vars[k].record);
  const recSize = recVars.reduce((s, k) => s + vars[k].vsize, 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  function read(name, { raw = false } = {}) {
    const v = vars[name];
    if (!v) throw new Error(`netcdf3: premenná ${name} neexistuje`);
    const count = v.shape.reduce((a, b) => a * b, 1);
    let data;
    if (v.typeCode === 2) {
      const text = [];
      const per = v.shape.slice(1).reduce((a, b) => a * b, 1);
      for (let rec = 0; rec < (v.record ? v.shape[0] : 1); rec += 1) {
        const off = v.record ? v.begin + rec * recSize : v.begin;
        text.push(new TextDecoder('utf-8').decode(bytes.subarray(off, off + (v.record ? per : count))));
      }
      return text.join('');
    }
    if (!v.record) {
      data = readTyped(view, v.begin, v.typeCode, count);
    } else {
      const per = v.shape.slice(1).reduce((a, b) => a * b, 1);
      const recs = v.shape[0];
      const Ctor = { 1: Int8Array, 3: Int16Array, 4: Int32Array, 5: Float32Array, 6: Float64Array }[v.typeCode];
      data = new Ctor(recs * per);
      for (let rec = 0; rec < recs; rec += 1) data.set(readTyped(view, v.begin + rec * recSize, v.typeCode, per), rec * per);
    }
    if (raw) return data;
    const scale = Number(v.attrs.scale_factor);
    const offset = Number(v.attrs.add_offset);
    const fill = v.attrs._FillValue ?? v.attrs.missing_value;
    const needsScale = (Number.isFinite(scale) && scale !== 1) || (Number.isFinite(offset) && offset !== 0);
    if (!needsScale && fill === undefined) return data;
    const out = v.typeCode === 6 ? new Float64Array(data.length) : new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
      const x = data[i];
      if (fill !== undefined && x === fill) { out[i] = NaN; continue; }
      out[i] = needsScale ? x * (Number.isFinite(scale) ? scale : 1) + (Number.isFinite(offset) ? offset : 0) : x;
    }
    return out;
  }

  return { version, dims, attrs, vars, read };
}

/**
 * Nájde 2D pole (lat × lon) premennej: zoberie prvý čas a prvú hladinu, vráti
 * hodnoty v poradí [lat][lon] spolu s osami. Pure.
 * @param {ReturnType<typeof parseNetcdf3>} nc
 * @param {string} name
 * @returns {{values: Float32Array|Float64Array, lat: Float32Array|Float64Array, lon: Float32Array|Float64Array, rows: number, cols: number}}
 */
export function gridOf(nc, name) {
  const v = nc.vars[name];
  if (!v) throw new Error(`netcdf3: premenná ${name} neexistuje`);
  const latDim = v.dims.find((d) => /^lat/i.test(d));
  const lonDim = v.dims.find((d) => /^lon/i.test(d));
  if (!latDim || !lonDim) throw new Error(`netcdf3: ${name} nemá lat/lon dimenzie (${v.dims.join(',')})`);
  const rows = nc.dims.find((d) => d.name === latDim).size;
  const cols = nc.dims.find((d) => d.name === lonDim).size;
  const all = nc.read(name);
  // Posledné dve dimenzie musia byť lat, lon (CF poradie); ostatné = 1. index.
  const li = v.dims.indexOf(latDim);
  const lo = v.dims.indexOf(lonDim);
  if (li !== v.dims.length - 2 || lo !== v.dims.length - 1) throw new Error(`netcdf3: ${name} má nečakané poradie dimenzií ${v.dims.join(',')}`);
  const values = all.subarray(0, rows * cols);
  return { values, lat: nc.read(latDim), lon: nc.read(lonDim), rows, cols };
}
