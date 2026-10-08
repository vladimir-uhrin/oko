// src/data/shmuStations.js
// Merania automatických staníc SHMÚ (2026-10-08, sekcia POČASIE: „čo sa naozaj nameralo" vedľa predpovede).
// Zdroj: opendata.shmu.sk/meteorology/climate/now/data/<YYYYMMDD>/aws1min - <YYYY-MM-DD HH-MM-SS>.json (CC BY 4.0),
// každých 5 min súbor s minútovými záznamami ~95 staníc. Čas `minuta` je v SEČ = UTC+1 (overené 2026-10-08:
// súbor „19-50-00" miestneho letného času nesie posledné minúty 18:48 SEČ = 17:48 UTC).
// Čisté pomôcky bez DOM a Cesia (server aj prehliadač).

export const SHMU_AWS_BASE = 'https://opendata.shmu.sk/meteorology/climate/now/data';
export const STATIONS_URL = '/api/shmu-stations';
export const STATIONS_META_URL = '/meteo-stations/shmu-aws.json';
const SEC_OFFSET_MS = 3600_000;

/** Dátum priečinka (miestny čas Bratislavy) YYYYMMDD pre okamih t. Pure (Intl). */
export function folderDate(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}`;
}

/** Najnovší súbor aws1min z výpisu priečinka (Apache index), alebo null. Pure. */
export function latestAwsFile(html) {
  const files = [...String(html || '').matchAll(/href="(aws1min[^"]*\.json)"/g)].map((m) => decodeURIComponent(m[1]));
  return files.length ? files.sort().at(-1) : null;
}

/** „2026-10-08T18:48:00" v SEČ → ms UTC. Pure. */
export function secToUtcMs(text) {
  const t = Date.parse(`${text}Z`);
  return Number.isFinite(t) ? t - SEC_OFFSET_MS : NaN;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Minútové záznamy → posledné meranie každej stanice: teplota, vlhkosť, tlak, priemerný vietor a smer
 * z poslednej minúty, NÁRAZ = maximum minútových maxím za celé okno súboru, zrážky = súčet za okno,
 * snehová pokrývka a dohľadnosť z poslednej minúty, ktorá ich má. Pure.
 * @returns {Map<string, object>}
 */
export function reduceAwsRecords(json) {
  const byId = new Map();
  for (const r of Array.isArray(json?.data) ? json.data : []) {
    const id = String(r?.ind_kli ?? '');
    const at = secToUtcMs(r?.minuta);
    if (!id || !Number.isFinite(at)) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ ...r, at });
  }
  const out = new Map();
  for (const [id, rows] of byId) {
    rows.sort((a, b) => a.at - b.at);
    const last = rows.at(-1);
    const lastWith = (key) => { for (let i = rows.length - 1; i >= 0; i -= 1) { const v = num(rows[i][key]); if (v !== null) return v; } return null; };
    let gust = null;
    let precip = null;
    for (const r of rows) {
      const g = num(r.vie_max_rych);
      if (g !== null) gust = Math.max(gust ?? 0, g);
      const p = num(r.zra_uhrn);
      if (p !== null) precip = (precip ?? 0) + p;
    }
    out.set(id, {
      id,
      at: last.at,
      windowMin: Math.round((last.at - rows[0].at) / 60_000) + 1,
      t: lastWith('t'),
      rh: lastWith('vlh_rel'),
      p: lastWith('tlak'),
      wind: num(last.vie_pr_rych) ?? lastWith('vie_pr_rych'),
      dir: num(last.vie_vp_smer) ?? lastWith('vie_vp_smer'),
      gust,
      precip: precip === null ? null : Math.round(precip * 10) / 10,
      snow: lastWith('sneh_pokr'),
      vis: lastWith('dohl'),
    });
  }
  return out;
}

/** Spojí merania s menami a polohou staníc; stanice bez polohy vynechá. Pure. */
export function joinStations(measurements, meta) {
  const out = [];
  for (const [id, m] of measurements) {
    const s = meta?.[id];
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    out.push({ ...m, name: s.name, lat: s.lat, lon: s.lon, elev: s.elev ?? null, approx: s.approx === true });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Najbližšia stanica do maxKm (pre meteogram „namerané teraz"): { station, km } alebo null. Pure. */
export function nearestStation(stations, lat, lon, maxKm = 20) {
  let best = null;
  for (const s of stations || []) {
    const dLat = (s.lat - lat) * 111.2;
    const dLon = (s.lon - lon) * 111.2 * Math.cos(((s.lat + lat) / 2) * Math.PI / 180);
    const km = Math.hypot(dLat, dLon);
    if (km <= maxKm && (!best || km < best.km)) best = { station: s, km };
  }
  return best;
}

/**
 * Popisky staníc bez prekrývania: rámček končí `gap` px NAĽAVO od bodu (text zarovnaný doprava), šírka
 * podľa textu; prednosť má presná poloha, potom poradie kódov. Pure.
 * @param {Array<{id: string, x: number, y: number, text: string, approx?: boolean}>} items
 */
export function declutterStationLabels(items, { padX = 4, h = 18, gap = 6 } = {}) {
  const kept = [];
  const out = new Set();
  const ordered = [...items].sort((a, b) => Number(Boolean(a.approx)) - Number(Boolean(b.approx)) || String(a.id).localeCompare(String(b.id)));
  for (const it of ordered) {
    const w = 10 + String(it.text).length * 7.4;
    const box = { x0: it.x - gap - w - padX, x1: it.x - gap + padX, y0: it.y - h / 2, y1: it.y + h / 2 };
    if (kept.some((k) => box.x0 < k.x1 && box.x1 > k.x0 && box.y0 < k.y1 && box.y1 > k.y0)) continue;
    kept.push(box);
    out.add(it.id);
  }
  return out;
}

const CLIENT_TTL_MS = 2 * 60_000;

/**
 * Lenivý načítač pre pás predpovede: (lat, lon) → { station, km } najbližšej stanice do 20 km, alebo null
 * (mimo dosahu, chyba). Merania z /api/shmu-stations, v prehliadači podržané 2 min.
 * @param {(url: string) => Promise<Response>} doFetch
 */
export function createNearestStationLookup(doFetch = (...args) => fetch(...args), now = () => Date.now()) {
  let cached = null;
  return async function lookup(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 47.5 || lat > 49.8 || lon < 16.6 || lon > 22.8) return null;
    try {
      if (!cached || now() - cached.at > CLIENT_TTL_MS) {
        const res = await doFetch(STATIONS_URL);
        if (!res?.ok) return null;
        const payload = await res.json();
        cached = { at: now(), stations: Array.isArray(payload?.stations) ? payload.stations : [] };
      }
      return nearestStation(cached.stations, lat, lon);
    } catch {
      return null;
    }
  };
}

/** Hodnoty pre riadok „namerané teraz": „18,4 °C · vietor 4,3 m/s (nárazy 4,7)". Pure. */
export function observedSummary(s, lang = 'sk', windWord = 'vietor', gustWord = 'nárazy') {
  const f = (v, d = 1) => { const x = v.toFixed(d); return lang === 'en' ? x : x.replace('.', ','); };
  const parts = [];
  if (Number.isFinite(s?.t)) parts.push(`${f(s.t)} °C`);
  if (Number.isFinite(s?.wind)) parts.push(`${windWord} ${f(s.wind)} m/s${Number.isFinite(s.gust) ? ` (${gustWord} ${f(s.gust)})` : ''}`);
  if (Number.isFinite(s?.precip) && s.precip > 0) parts.push(`${f(s.precip)} mm`);
  return parts.join(' · ');
}
