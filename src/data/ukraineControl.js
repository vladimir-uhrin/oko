// src/data/ukraineControl.js
/**
 * @module ukraineControl
 * @description Územná kontrola modulu UKRAJINA — PROVIZÓRIUM (etapa 4C, 2026-09-19;
 * plán docs/drafts/ukrajina-plan.md kap. 2.1): body kontroly sídiel z Wikipédie,
 * `Module:Russo-Ukrainian war overview map` (mestá) + `Module:Russo-Ukrainian war
 * detailed map` (obce a infraštruktúra) — Lua tabuľky `{ lat, long, mark, marksize,
 * label, link }`, ikona = stav (legenda v /doc modulu: modrá bodka = Ukrajina,
 * červená = Rusko a spojenci, sivá = bez kontroly, animovaný gif = kontestované,
 * oblúk = obliehané z jednej strany, 3×3/4×4 bodky = vidiecka prítomnosť; lietadlo,
 * kotva, elektráreň, základňa… = infraštruktúra s farbou strany).
 *
 * Licencia CC BY-SA 4.0: odvodený súbor bodov a raster zón sú Adapted Material —
 * vydávajú sa pod CC BY-SA s odkazom na revíziu (DATA_SOURCES.md). Wikipédia mapu
 * skladá z textových správ („copying from maps is strictly prohibited"), takže
 * nie je derivátom ISW/DeepState. Poctivosť: dobrovoľnícka mapa, aktualizovaná
 * nepravidelne — v UI vždy dátum revízie a slovo „podľa Wikipédie". NIE JE to
 * oficiálna línia frontu.
 *
 * Raster zón (`controlRaster`) je ODVODENÝ: bunka mriežky dostane stranu podľa
 * najbližšieho sídla (RU výplň tlmená, UA bez výplne ako u Rybara), pás, kde sú
 * obe strany blízko alebo sídlo kontestované, = šrafovaná zóna bojov. Čistý modul.
 */

/** Skratky `mk` z prehľadového modulu (záloha, keď ich revízia nemá). */
export const DEFAULT_MK = Object.freeze({
  con: '80x80-red-blue-anim.gif', grz: 'Location dot grey.svg', rus: 'Location dot red.svg', shr: 'Map-ctl2-red+blue.svg', ukr: 'Location dot blue.svg',
  rNN: 'Map-arcNN-red.svg', rNE: 'Map-arcNE-red.svg', rEE: 'Map-arcEE-red.svg', rSE: 'Map-arcSE-red.svg', rSS: 'Map-arcSS-red.svg', rSW: 'Map-arcSW-red.svg', rWW: 'Map-arcWW-red.svg', rNW: 'Map-arcNW-red.svg',
  uNN: 'Map-arcNN-blue.svg', uNE: 'Map-arcNE-blue.svg', uEE: 'Map-arcEE-blue.svg', uSE: 'Map-arcSE-blue.svg', uSS: 'Map-arcSS-blue.svg', uSW: 'Map-arcSW-blue.svg', uWW: 'Map-arcWW-blue.svg', uNW: 'Map-arcNW-blue.svg',
});
export const WIKI_OVERVIEW_TITLE = 'Module:Russo-Ukrainian war overview map';
export const WIKI_DETAILED_TITLE = 'Module:Russo-Ukrainian war detailed map';
export const WIKI_ATTRIBUTION = 'Wikipedia · Russo-Ukrainian war detailed map · CC BY-SA 4.0';
/** Veľkosť značky → trieda populácie (komentár v module). */
export const MARKSIZE_POP = Object.freeze({ 35: 'capital', 28: '1m', 24: '500k', 20: '200k', 16: '100k', 14: '50k', 12: '20k', 10: '10k', 8: '5k', 6: '2k', 5: '1k', 4: 'small' });

/** Tabuľka skratiek `mk = { key = "file" }` z Lua zdroja (alebo záloha). Pure. */
export function parseMkTable(src) {
  const m = /\bmk\s*=\s*\{([\s\S]*?)\}/.exec(String(src || ''));
  if (!m) return { ...DEFAULT_MK };
  const out = { ...DEFAULT_MK };
  for (const kv of m[1].matchAll(/(\w+)\s*=\s*"([^"]+)"/g)) out[kv[1]] = kv[2];
  return out;
}

/** `[[Lyman, Ukraine|Lyman]]` → „Lyman"; `[[Bakhmut]]` → „Bakhmut"; bez odkazu = text. Pure. */
export function plainLabel(label) {
  const s = String(label ?? '').trim();
  const m = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(s);
  if (m) return (m[2] || m[1]).trim();
  return s.replace(/'''?/g, '').trim() || null;
}

/**
 * Ikona → { side: 'ua'|'ru'|'none'|'contested'|'mixed', kind, pressure? }.
 * `pressure` = strana, ktorá obliehanú/tlačenú lokalitu tlačí (oblúk jej farby). Pure.
 */
export function markStatus(icon) {
  const s = String(icon || '');
  const low = s.toLowerCase();
  const colour = /blue/.test(low) ? 'ua' : (/red/.test(low) ? 'ru' : (/grey|gray/.test(low) ? 'none' : null));
  if (/80x80-red-blue-anim/.test(low)) return { side: 'contested', kind: 'settlement' };
  if (/map-ctl2-red\+blue/.test(low)) return { side: 'mixed', kind: 'settlement' };
  if (/^location dot/.test(low)) return { side: colour || 'none', kind: 'settlement' };
  if (/^map-arc/.test(low)) return { side: colour === 'ua' ? 'ru' : 'ua', kind: 'settlement', pressure: colour, direction: (/map-arc([nsew]{2})/i.exec(s)?.[1] || '').toUpperCase() || null };
  if (/^map-circle/.test(low)) return { side: colour || 'contested', kind: 'settlement', pressure: colour === 'ua' ? 'ru' : 'ua' };
  if (/^[34]x[34]dot/.test(low)) return { side: colour || 'none', kind: 'rural' };
  if (/fighter-jet/.test(low)) return { side: colour, kind: 'airbase' };
  if (/helicopter/.test(low)) return { side: colour, kind: 'heliport' };
  if (/anchor/.test(low)) return { side: colour, kind: 'port' };
  if (/nuclearpowerplant/.test(low)) return { side: colour, kind: 'industry' };
  if (/abm-/.test(low)) return { side: colour, kind: 'base' };
  if (/map-peak/.test(low)) return { side: colour, kind: 'hill' };
  if (/gota0/.test(low)) return { side: /gota03/.test(low) ? 'ua' : 'ru', kind: 'oilgas' };
  if (/bsicon/.test(low)) return { side: colour, kind: 'hydro' };
  if (/mountain pass/.test(low)) return { side: null, kind: 'border' };
  if (/arch dam/.test(low)) return { side: null, kind: 'dam' };
  if (/roadmap overlay/.test(low)) return null;
  return colour ? { side: colour, kind: 'other' } : null;
}

/**
 * Lua zdroj modulu → záznamy `{ lat, lon, icon, side, kind, pressure, size, pop,
 * name, link }` (bez podkladovej cestnej mapy a bez značiek bez strany). Pure.
 * @param {string} src Lua text
 * @param {Record<string,string>} [mk] tabuľka skratiek (predvolene z toho istého zdroja)
 */
export function parseLuaMarks(src, mk = null) {
  const text = String(src || '');
  const table = mk || parseMkTable(text);
  const out = [];
  for (const m of text.matchAll(/\{([^{}]*\blat\s*=\s*"[^"]*"[^{}]*)\}/g)) {
    const body = m[1];
    const field = (name) => {
      const r = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|mk\\.(\\w+)|lp\\.(\\w+)|(-?\\d+(?:\\.\\d+)?))`).exec(body);
      if (!r) return null;
      if (r[3] !== undefined) return table[r[3]] || null;
      return r[1] ?? r[2] ?? r[4] ?? r[5] ?? null;
    };
    const lat = Number(field('lat')); const lon = Number(field('long'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const icon = field('mark');
    const status = markStatus(icon);
    if (!status || !status.side) continue;
    const size = Number(field('marksize')) || null;
    const name = plainLabel(field('label')) || plainLabel(field('link')) || null;
    out.push({ lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, icon, side: status.side, kind: status.kind, pressure: status.pressure || null, direction: status.direction || null, size, pop: size ? (MARKSIZE_POP[size] || (size >= 12 ? '20k' : 'small')) : null, name, link: field('link') || null });
  }
  return out;
}

/**
 * Prehľadový + podrobný modul → jeden zoznam (podrobný modul si prehľadový
 * `require`-uje, sám nesie ďalšie obce a infraštruktúru; skratky `mk` berie
 * z prehľadového). Duplicitné súradnice (na 3 desatinné) vyhrá podrobný. Pure.
 */
export function controlPointsFromModules(overviewSrc, detailedSrc) {
  const mk = parseMkTable(overviewSrc || '');
  const byKey = new Map();
  for (const p of parseLuaMarks(overviewSrc || '', mk)) byKey.set(`${p.lat.toFixed(3)},${p.lon.toFixed(3)}`, { ...p, module: 'overview' });
  for (const p of parseLuaMarks(detailedSrc || '', mk)) byKey.set(`${p.lat.toFixed(3)},${p.lon.toFixed(3)}`, { ...p, module: 'detailed' });
  return [...byKey.values()];
}

/** Počty bodov podľa strany a druhu (pre panel a legendu). Pure. */
export function controlSummary(points) {
  const out = { total: 0, settlements: { ua: 0, ru: 0, contested: 0, mixed: 0, none: 0 }, infrastructure: { ua: 0, ru: 0 } };
  for (const p of points || []) {
    out.total += 1;
    if (p.kind === 'settlement' || p.kind === 'rural') { if (p.side in out.settlements) out.settlements[p.side] += 1; } else if (p.side === 'ua' || p.side === 'ru') out.infrastructure[p.side] += 1;
  }
  return out;
}

/** Predvolený rámec rastra: Ukrajina s Krymom a pohraničím RU (Kursk/Belgorod). */
export const CONTROL_RASTER_BBOX = Object.freeze({ west: 22.0, south: 44.2, east: 40.6, north: 52.6 });
export const CONTROL_CODE = Object.freeze({ none: 0, ua: 1, ru: 2, contested: 3 });

/**
 * Odvodený raster zón: každá bunka podľa najbližšieho sídla (settlement/rural,
 * kontestované rátajú pre obe strany); pás `bandKm`, kde je druhá strana rovnako
 * blízko alebo najbližšie sídlo je kontestované, = zóna bojov; ďalej než `maxKm`
 * od akéhokoľvek bodu = bez údaja. Vzdialenosti v km s kosínusom šírky. Pure.
 * @returns {{width:number,height:number,cellDeg:number,bbox:object,cells:Uint8Array,counts:{ua:number,ru:number,contested:number,none:number}}}
 */
export function controlRaster(points, { bbox = CONTROL_RASTER_BBOX, cellDeg = 0.05, maxKm = 35, bandKm = 7 } = {}) {
  const width = Math.max(1, Math.round((bbox.east - bbox.west) / cellDeg));
  const height = Math.max(1, Math.round((bbox.north - bbox.south) / cellDeg));
  const cells = new Uint8Array(width * height);
  const ua = []; const ru = []; const con = [];
  for (const p of points || []) {
    if (p.kind !== 'settlement' && p.kind !== 'rural') continue;
    if (p.side === 'ua') ua.push(p); else if (p.side === 'ru') ru.push(p); else if (p.side === 'contested' || p.side === 'mixed') con.push(p);
  }
  const counts = { ua: 0, ru: 0, contested: 0, none: 0 };
  const KM_LAT = 111.32;
  const nearest = (list, lat, lon, cosLat) => {
    let best = Infinity;
    for (const p of list) {
      const dy = (p.lat - lat) * KM_LAT; const dx = (p.lon - lon) * KM_LAT * cosLat;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  for (let row = 0; row < height; row += 1) {
    const lat = bbox.north - (row + 0.5) * cellDeg; // riadok 0 = sever (ako obrázok)
    const cosLat = Math.cos((lat * Math.PI) / 180);
    for (let col = 0; col < width; col += 1) {
      const lon = bbox.west + (col + 0.5) * cellDeg;
      const dU = nearest(ua, lat, lon, cosLat); const dR = nearest(ru, lat, lon, cosLat); const dC = nearest(con, lat, lon, cosLat);
      const dMin = Math.min(dU, dR, dC);
      let code = CONTROL_CODE.none;
      if (dMin <= maxKm) {
        if (dC <= bandKm || Math.abs(dU - dR) <= bandKm) code = CONTROL_CODE.contested;
        else code = dR < dU ? CONTROL_CODE.ru : CONTROL_CODE.ua;
      }
      cells[row * width + col] = code;
      if (code === CONTROL_CODE.ua) counts.ua += 1; else if (code === CONTROL_CODE.ru) counts.ru += 1; else if (code === CONTROL_CODE.contested) counts.contested += 1; else counts.none += 1;
    }
  }
  return { width, height, cellDeg, bbox: { ...bbox }, cells, counts };
}

/** Farby strán (monochromatický štýl OKO; RU tehlová tlmená, UA modrá, kontestované jantár). */
export const CONTROL_COLORS = Object.freeze({ ua: '#4fa3ff', ru: '#e0553f', contested: '#ffb547', mixed: '#c68cff', none: '#8a97a3' });

/**
 * Text stavu pre kartu/legendu (i18n kľúče `ukraine.ctl.*`). Pure.
 */
export function controlSideText(side, translate = (k) => k) {
  return translate(`ukraine.ctl.${side || 'none'}`);
}
