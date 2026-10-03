// src/data/openSkyRegion.js — výrez OpenSky pri priblíženom pohľade (2026-09-30, vlastník: „kredity
// treba šetriť, lebo web je aj tak prevažne na SK ľudí" k návrhu „pri priblížení na Slovensko by mapa
// pýtala len výrez — 1 kredit namiesto 4 za celý svet").
//
// Cena /states/all podľa dokumentácie OpenSky REST API (overené 2026-09-30): plocha výrezu
// (lamax − lamin) × (lomax − lomin) v štvorcových stupňoch 0–25 = 1 kredit, 25–100 = 2, 100–400 = 3,
// nad 400 alebo celý svet = 4. Proxy pri priblížení pýta len výrez okolo kamery (24 štv. stupňov) a
// zvyšok sveta dopĺňa z posledného celosvetového snímku — ten sa berie najviac raz za minútu a ide aj
// do histórie letov. Lietadlá mimo výrezu teda nezmiznú (flotila v prehliadači by inak pri každom
// prepnutí prežula tisíce evikcií — pozri OPENSKY_CONSTRAINED_REGIME_MS vo vite.config.js).
// Čisté funkcie; server ich používa vo vite.config.js (openSkyProxy).

/** Priblížený pohľad = kamera najviac takto vysoko (m). Zhora vidno ~±145 km — celé vo výreze. */
export const REGION_MAX_HEIGHT_M = 250_000;
/** Polovičné rozmery výrezu: 4,8° × 5° = 24 štv. stupňov → 1 kredit (hranica 25 s rezervou). */
export const REGION_HALF_LAT_DEG = 2.4;
export const REGION_HALF_LON_DEG = 2.5;
/** Stred výrezu na mriežke — návštevníci v okolí (Bratislava…) zdieľajú jeden výrez aj jeho cache. */
export const REGION_SNAP_DEG = 0.5;
/** Najviac toľko výrezov medzi dvoma celosvetovými snímkami (4. by stál ako celý svet). */
export const REGION_FETCHES_PER_WORLD_MAX = 3;
/** Pod týmto zostatkom denných kreditov ostáva doterajší režim (celý svet s dlhou cache a náhradou). */
export const REGION_MIN_CREDITS = 1200;

const round = (v, step) => Math.round(v / step) * step;
const fix = (v) => Number(v.toFixed(4));

/** Cena dopytu /states/all v kreditoch podľa plochy výrezu (null = celý svet). */
export function openSkyAreaCredits(box) {
  if (!box) return 4;
  const area = (box.lamax - box.lamin) * (box.lomax - box.lomin);
  if (!(area >= 0)) return 4;
  if (area <= 25) return 1;
  if (area <= 100) return 2;
  if (area <= 400) return 3;
  return 4;
}

/**
 * Výrez pre pohľad z parametrov dopytu klienta (`lat`, `lon` = poloha kamery, `h` = výška kamery v m).
 * Bez výšky (starší klient, strážca histórie) alebo vysoko nad zemou = null → celý svet.
 * @param {URLSearchParams} params
 * @returns {{lamin:number, lomin:number, lamax:number, lomax:number, key:string}|null}
 */
export function openSkyRegionForView(params) {
  const num = (name) => {
    const raw = params?.get?.(name);
    if (raw === null || raw === undefined || String(raw).trim() === '') return NaN;
    return Number(raw);
  };
  const lat = num('lat');
  const lon = num('lon');
  const h = num('h');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(h)) return null;
  // Výška kamery nad elipsoidom býva pri zemi aj mierne záporná (geoid) — to je stále priblížené.
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || h < -1000 || h > REGION_MAX_HEIGHT_M) return null;
  let cLat = round(lat, REGION_SNAP_DEG);
  let cLon = round(lon, REGION_SNAP_DEG);
  // Pri póle a pri 180. poludníku sa výrez posunie dovnútra (rozmer, teda cena, ostáva).
  cLat = Math.min(90 - REGION_HALF_LAT_DEG, Math.max(-90 + REGION_HALF_LAT_DEG, cLat));
  cLon = Math.min(180 - REGION_HALF_LON_DEG, Math.max(-180 + REGION_HALF_LON_DEG, cLon));
  const box = {
    lamin: fix(cLat - REGION_HALF_LAT_DEG),
    lomin: fix(cLon - REGION_HALF_LON_DEG),
    lamax: fix(cLat + REGION_HALF_LAT_DEG),
    lomax: fix(cLon + REGION_HALF_LON_DEG),
  };
  return { ...box, key: `${box.lamin},${box.lomin}` };
}

/**
 * Ako čerstvé majú byť výrez a svet podľa zostatku denných kreditov (X-Rate-Limit-Remaining).
 * Výrez 20 s (klient sa pýta každých 30 s — každý jeho dopyt dostane čerstvý výrez), svet najviac
 * 60 s (prehrávač flotily kĺže polohu 60 s za posledným fixom, potom by lietadlo zastalo).
 * Pod REGION_MIN_CREDITS null: doterajšie stupne cache (30 s / 90 s / 300 s) sú už lacnejšie.
 * @param {number|null} remainingCredits null = zatiaľ neznámy (štart servera) → ako dostatok
 * @returns {{regionTtlMs:number, worldMaxAgeMs:number}|null}
 */
export function regionPolicy(remainingCredits) {
  if (remainingCredits !== null && remainingCredits !== undefined && !(remainingCredits > REGION_MIN_CREDITS)) return null;
  return { regionTtlMs: 20_000, worldMaxAgeMs: 60_000 };
}

/** URL výrezu (rovnaké `extended=1` ako celý svet — kategória lietadla v slote [17]). */
export function openSkyRegionUrl(box, base = 'https://opensky-network.org/api/states/all') {
  const q = new URLSearchParams({ extended: '1', lamin: String(box.lamin), lomin: String(box.lomin), lamax: String(box.lamax), lomax: String(box.lomax) });
  return `${base}?${q}`;
}

/**
 * Svet + čerstvý výrez: stroje z výrezu nahradia svoje staršie riadky zo sveta, ostatné ostanú.
 * Stroj, ktorý z výrezu zmizol (pristál mimo pokrytia), dožije do ďalšieho snímku sveta — rovnako
 * ako dnes medzi dvoma snímkami. Čas = novší z dvoch (každý riadok nesie vlastný čas polohy).
 * @param {{time:number, states:Array}} world
 * @param {{time:number, states:Array|null}} region
 */
export function mergeWorldAndRegion(world, region) {
  const regionStates = Array.isArray(region?.states) ? region.states : [];
  const worldStates = Array.isArray(world?.states) ? world.states : [];
  const fresh = new Set();
  for (const s of regionStates) fresh.add(String(s?.[0] ?? '').trim().toLowerCase());
  const states = regionStates.slice();
  for (const s of worldStates) {
    if (!fresh.has(String(s?.[0] ?? '').trim().toLowerCase())) states.push(s);
  }
  const times = [Number(world?.time), Number(region?.time)].filter((t) => Number.isFinite(t) && t > 0);
  return { time: times.length ? Math.max(...times) : null, states };
}
