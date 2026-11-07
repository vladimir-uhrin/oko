// scripts/lib/powerPlantsBuild.mjs
/**
 * Čisté kroky buildu elektrární (WRI Global Power Plant Database 1.3.0,
 * CC BY 4.0): CSV riadok → GeoJSON feature v tvare, ktorý číta
 * `src/data/powerPlants.js`. Bez siete a disku — testovateľné.
 */
import { inflateRawSync } from 'node:zlib';
import { countryIso2FromName } from '../../src/data/countryFlags.js';
import { plantFuelGroup } from '../../src/data/powerPlants.js';

/** Najmenší výkon, ktorý ide do snímku (MW). Pod tým je to pre glóbus šum. */
export const MIN_PLANT_MW = 100;

/**
 * Overené zmeny po vydaní databázy (WRI 1.3.0 = stav 2021). Len to, čo sme
 * dohľadali v zdroji — nikdy odhad. Kľúč = gppd_idnr.
 */
export const PLANT_OVERRIDES = Object.freeze({
  // Nováky (ENO): výroba elektriny a tepla z uhlia skončila 20. 12. 2023.
  GEODB0042634: Object.freeze({ status: 'closed', closed: '2023-12', note_src: 'https://www.iea.org/policies/18119-territorial-just-transition-plan-tjtp-coal-phase-out' }),
  // Vojany (EVO): Slovenské elektrárne odstavili 26. 3. 2024 — koniec uhlia v SR.
  GEODB0042632: Object.freeze({ status: 'closed', closed: '2024-03', note_src: 'https://enrsi.rtvs.sk/articles/topical-issue/358200/vojany-power-plant-ceases-to-produce-electricity' }),
  // Mochovce: bloky 1–2 po 470 MW + blok 3 (471 MW brutto, v prevádzke od 2023).
  GEODB0004330: Object.freeze({ mw: 1411, note_src: 'https://world-nuclear.org/nuclear-reactor-database/details/Mochovce-3' }),
});

/** Mená štátov WRI, ktoré countryFlags nepozná. */
const COUNTRY_FIX = Object.freeze({ 'Cote DIvoire': 'ci' });

/** Jednoduchý CSV parser jedného riadku (úvodzovky, "" ako úvodzovka). */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** CSV text → pole objektov podľa hlavičky. */
export function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const head = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(head.map((k, i) => [k, cells[i] ?? '']));
  });
}

/**
 * „Mochovce Nuclear Power Plant Slovakia" → „Mochovce Nuclear Power Plant".
 * GEODB pripína k menu krajinu; na karte je vlajka, takže je to duplicita.
 */
export function cleanPlantName(name, countryLong) {
  let text = String(name || '').replace(/\s+/g, ' ').trim();
  const country = String(countryLong || '').trim();
  if (country && text.toLowerCase().endsWith(` ${country.toLowerCase()}`) && text.length > country.length + 3) {
    text = text.slice(0, -(country.length + 1)).trim();
  }
  return text;
}

const num = (v) => {
  const n = Number(v);
  return v !== '' && v != null && Number.isFinite(n) ? n : null;
};

/** Posledná NAHLÁSENÁ ročná výroba (nie odhad WRI): { gwh, year } alebo null. */
export function latestGeneration(row) {
  for (let year = 2019; year >= 2013; year -= 1) {
    const gwh = num(row[`generation_gwh_${year}`]);
    if (gwh != null && gwh > 0) return { gwh, year };
  }
  return null;
}

/**
 * Riadok CSV → feature, alebo null (pod prahom, bez polohy).
 * @param {Record<string,string>} row
 * @param {{ minMw?: number, overrides?: object }} [o]
 */
export function plantFeature(row, { minMw = MIN_PLANT_MW, overrides = PLANT_OVERRIDES } = {}) {
  const lat = num(row.latitude);
  const lon = num(row.longitude);
  let mw = num(row.capacity_mw);
  if (lat == null || lon == null || mw == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const fix = overrides[row.gppd_idnr] || null;
  if (fix?.mw) mw = fix.mw;
  if (mw < minMw) return null;
  const props = {
    id: row.gppd_idnr,
    name: cleanPlantName(row.name, row.country_long),
    cc: (COUNTRY_FIX[row.country_long] || countryIso2FromName(row.country_long) || '').toUpperCase() || null,
    country: row.country_long || null,
    mw: Math.round(mw * 10) / 10,
    fuel: plantFuelGroup(row.primary_fuel),
  };
  // Pôvodné palivo len tam, kde skupina niečo zlúčila (biomasa/odpad, petrolkoks…).
  if (row.primary_fuel && row.primary_fuel.toLowerCase() !== props.fuel) props.fuel_raw = row.primary_fuel;
  const others = [row.other_fuel1, row.other_fuel2, row.other_fuel3].filter(Boolean);
  if (others.length) props.other_fuels = others;
  const year = num(row.commissioning_year);
  if (year) props.year = Math.round(year);
  if (row.owner) props.owner = row.owner.trim();
  const gen = latestGeneration(row);
  // Výroba pod 1 % využitia výkonu je chyba hlásenia (PPC Bratislava 218 MW „2 GWh"), nie fakt.
  if (gen && gen.gwh >= mw * 8.76 * 0.01) { props.gen_gwh = Math.round(gen.gwh); props.gen_year = gen.year; }
  if (fix?.status) props.status = fix.status;
  if (fix?.closed) props.closed = fix.closed;
  if (fix) props.corrected = true;
  return {
    type: 'Feature',
    id: row.gppd_idnr,
    geometry: { type: 'Point', coordinates: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] },
    properties: props,
  };
}

/** Všetky riadky → features, od najväčších (stabilné poradie podľa id). */
export function buildPlantFeatures(rows, o = {}) {
  return rows.map((r) => plantFeature(r, o)).filter(Boolean)
    .sort((a, b) => (b.properties.mw - a.properties.mw) || String(a.id).localeCompare(String(b.id)));
}

/** Jeden súbor z ZIP archívu (bez knižnice): centrálny adresár → deflate/stored. */
export function extractZipEntry(buffer, wanted) {
  const buf = Buffer.from(buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central header');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted || name.endsWith(`/${wanted}`)) {
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip: unsupported method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip: ${wanted} not found`);
}
