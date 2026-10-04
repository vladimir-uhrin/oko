// Admin panel OKO (2026-10-04) — poloha živých návštevníkov pre mapu v záložke Naživo.
//
// Zdroj polohy je Cloudflare (tunel okolive.sk): CF-IPCountry posiela vždy, presnejšie
// CF-IPLatitude / CF-IPLongitude / CF-IPCity len so zapnutou Managed Transform
// „Add visitor location headers". Bez nich bod stojí v hlavnom meste krajiny.
// Nič z toho sa neukladá do DB — žije to len v pamäti, kým je návštevník aktívny.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Zaokrúhlenie súradníc mesta (0,1° ≈ 11 km) — mapa nemá ukázať viac než mesto. */
const GRID = 10;

let capitals = null;
/** iso2 → [lat, lon] najľudnatejšieho hlavného mesta z Natural Earth places.json. */
function capitalIndex() {
  if (capitals) return capitals;
  capitals = new Map();
  try {
    const file = fileURLToPath(new URL('../../data/local_data/natural_earth/places.json', import.meta.url));
    const best = new Map();
    for (const [, lat, lon, pop, , iso2, capital] of JSON.parse(readFileSync(file, 'utf8')).places) {
      if (!capital || !/^[A-Z]{2}$/.test(iso2)) continue;
      if (!best.has(iso2) || best.get(iso2).pop < pop) best.set(iso2, { lat, lon, pop });
    }
    for (const [iso2, { lat, lon }] of best) capitals.set(iso2, [lat, lon]);
  } catch { /* bez súboru ostanú body len s presnou polohou */ }
  return capitals;
}

export const countryPoint = iso2 => capitalIndex().get(iso2) || null;

const header = (req, name) => {
  const value = req.headers[name];
  return typeof value === 'string' ? value.trim() : '';
};
/** Hlavičky Cloudflare bývajú percent-kódované (napr. „Ko%C5%A1ice"). */
function cleanText(raw, max = 60) {
  let text = raw;
  try { text = decodeURIComponent(raw); } catch { /* nechať tak */ }
  // Cloudflare posiela UTF-8 bajty, Node hlavičku číta ako Latin-1 („IÅ¾a" → „Iža").
  if (/[\u0080-\u00ff]/.test(text)) {
    const utf8 = Buffer.from(text, 'latin1').toString('utf8');
    if (!utf8.includes('\ufffd')) text = utf8;
  }
  text = text.replace(/[\u0000-\u001f<>]/g, '').trim();
  return text.slice(0, max);
}

/**
 * Poloha z hlavičiek požiadavky.
 * @returns {{country: string, city: string, region: string, lat: number|null, lon: number|null, precision: 'city'|'country'|'none'}}
 */
export function geoFromRequest(req) {
  const rawCountry = header(req, 'cf-ipcountry').toUpperCase();
  const country = /^[A-Z]{2}$/.test(rawCountry) && rawCountry !== 'XX' && rawCountry !== 'T1' ? rawCountry : '??';
  const city = cleanText(header(req, 'cf-ipcity'));
  const region = cleanText(header(req, 'cf-region'));
  const lat = Number.parseFloat(header(req, 'cf-iplatitude'));
  const lon = Number.parseFloat(header(req, 'cf-iplongitude'));
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) {
    return { country, city, region, lat: Math.round(lat * GRID) / GRID, lon: Math.round(lon * GRID) / GRID, precision: 'city' };
  }
  const point = country === '??' ? null : countryPoint(country);
  if (point) return { country, city, region, lat: point[0], lon: point[1], precision: 'country' };
  return { country, city, region, lat: null, lon: null, precision: 'none' };
}
