// src/data/sentinel3Frp.js — požiare zo Sentinel-3 SLSTR (Copernicus, EUMETSAT) — čisté funkcie (2026-10-07).
//
// Vlastník: „pridaj ďalší satelit, a keď aj viac“ → po celom katalógu FIRMS NRT (VIIRS, MODIS, Landsat,
// GOES/Meteosat/Himawari) ďalší nezávislý zdroj: Sentinel-3A/3B SLSTR, produkt SL_2_FRP NRT
// (1 km MWIR, ~10:00 a ~22:00 miestneho času, ~1 h po prelete). Produkt = ZIP jedného 3-min granulu
// (~1–3,5 MB) s CSV `FRP_MWIR1km_standard.csv` (overené 2026-10-07: 205 ohnísk nad Angolou).
// Riadok CSV: lat(deg),lon(deg),day,time,D/N,FRP(MW),FRPerr(MW),used_channel,confidence(%),
// confidence_class,MWIR_BT(K),IFOV_area(m2),SZA,VZA,actrack(km),altrack(km),satellite.
// Výstup = tvar src/data/firmsCsv.js (lat, lon, frp, confidence, brightness, daynight, acqDate,
// acqTime, satellite, instrument, scan, track), aby ho ďalej spracoval ten istý reťazec ako FIRMS.
import zlib from 'node:zlib';

/** Súbor v produkte, ktorý sa číta (štandardná schéma MWIR 1 km). */
export const S3_FRP_CSV = 'FRP_MWIR1km_standard.csv';

/**
 * Vytiahne jeden súbor z ZIP (bez knižnice: koncový záznam → centrálny adresár → lokálna hlavička →
 * inflateRaw). Podporuje uloženie (0) a deflate (8); ZIP64 nie (granuly majú pár MB). Pure.
 * @param {Buffer} buf
 * @param {(name: string) => boolean} match
 * @returns {Buffer|null}
 */
export function extractZipEntry(buf, match) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!match(name)) continue;
    if (buf.readUInt32LE(localOff) !== 0x04034b50) return null;
    const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return zlib.inflateRawSync(data);
    return null;
  }
  return null;
}

/**
 * CSV `FRP_MWIR1km_standard.csv` → záznamy v tvare firmsCsv. Riadky s `#` a hlavička sa preskočia;
 * stĺpce podľa mena (poradie sa môže meniť medzi verziami spracovania). Pure.
 * @param {string} text
 */
export function parseS3FrpCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (prefix) => header.findIndex((h) => h.startsWith(prefix));
  const iLat = col('lat'); const iLon = col('lon'); const iDay = col('day'); const iTime = col('time');
  const iDn = col('d/n'); const iFrp = col('frp(mw)'); const iConf = col('confidence(%)');
  const iBt = col('mwir_bt'); const iAc = col('actrack'); const iAl = col('altrack'); const iSat = col('satellite');
  if (iLat < 0 || iLon < 0 || iDay < 0 || iTime < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const lat = Number(c[iLat]); const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const day = String(c[iDay] || '').trim();
    const time = /^(\d{2}):(\d{2})/.exec(String(c[iTime] || '').trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !time) continue;
    const num = (i) => { const v = Number(c[i]); return i >= 0 && Number.isFinite(v) ? v : 0; };
    out.push({
      lat, lon,
      frp: num(iFrp),
      confidence: iConf >= 0 ? num(iConf) : 0, // 0..100 → firmsAdapt.normalizeConfidence
      brightness: num(iBt),
      brightnessTi5: 0,
      daynight: String(c[iDn] || '').trim().toUpperCase() === 'N' ? 'N' : 'D',
      acqDate: day,
      acqTime: `${time[1]}${time[2]}`,
      satellite: String(c[iSat] || '').trim().toUpperCase() || 'S3',
      instrument: 'SLSTR',
      scan: num(iAc),
      track: num(iAl),
    });
  }
  return out;
}

/** OData filter katalógu CDSE: granuly SL_2_FRP NRT od `sinceIso`. Pure. */
export function s3FrpCatalogFilter(sinceIso) {
  return `Collection/Name eq 'SENTINEL-3' and contains(Name,'SL_2_FRP') and contains(Name,'_NR_') and ContentDate/Start gt ${sinceIso}`;
}

/** Čas začiatku granulu z mena produktu (S3B_SL_2_FRP____20261007T084522_…) → epoch ms, inak NaN. Pure. */
export function s3GranuleStartMs(name) {
  const m = /_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})_/.exec(String(name || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}
