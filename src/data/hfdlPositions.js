// src/data/hfdlPositions.js — skutočné polohy lietadiel nad oceánom z otvorených dát HFDL (2026-10-11).
//
// Vlastník: „áno postav to a implementuj do súčasného" (prieskum adsb.lol Aircraft Data Links).
// adsb.lol zbiera HFDL (krátke vlny, dosah tisíce km — Atlantik, Pacifik, Indický oceán), ACARS a VDL2
// a zverejňuje ich pod CC0 na GitHube: repozitár `adsblol/aircraft-data-links-<rok>`, jedno vydanie na
// deň (`adsblol-adl-YYYY-MM-DD`), doň každú hodinu pribudne dávka `adsblol-adl-hfdl_<od>_<do>.jsonl.zst`
// (nahratá ~1 s po konci hodiny). Poloha je pri stiahnutí stará 0–60 min — nie živé sledovanie, ale
// SKUTOČNÁ poloha, ktorá preukotví odhad bez signálu (flightEstimate.js) a doplní Históriu letov.
//
// Overené na dátach 2026-10-11 (scratchpad adl/analyze.mjs):
//  - poloha je v `hfdl.lpdu.hfnpdu.pos` (180/180 = prázdne); čas polohy je v `utc_time` (Frequency
//    data) alebo `time` (Performance data) — h:m:s bez dátumu;
//  - Frequency data sú čerstvé (90 % do 0,4 min od príjmu), ale ~tretina Performance data nesie polohu
//    starú 17 min až hodiny → berie sa len poloha s časom do HFDL_MAX_REPORT_AGE_MS od príjmu;
//  - ADS-C v ACARS (`acars.arinc622.adsc.tags[].basic_report`) má výšku v stopách a čas `ts_sec`
//    = sekundy od začiatku hodiny;
//  - ~2/3 záznamov nemá ICAO hex v `lpdu.ac_info.icao`, len volací znak `flight_id` — párovanie aj cez
//    neho. Performance data a ADS-C ho však nesú v `lpdu.src.ac_info.icao` (2026-10-15): s ním je bez
//    hexu 144 z 861 polôh, nie 264.
//
// Čisté funkcie (parse*) + sťahovač pre server (createHfdlFeed). Kľúč netreba, GitHub API bez
// prihlásenia dovoľuje 60 dopytov/h — sťahovač robí najviac ~12/h.

import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Poloha s časom hlásenia ďalej než toto od času príjmu sa zahodí (stará alebo s chybným časom). */
export const HFDL_MAX_REPORT_AGE_MS = 10 * 60_000;
/** Poloha z budúcnosti (hodiny prijímača/lietadla) najviac o toľko. */
export const HFDL_MAX_FUTURE_MS = 2 * 60_000;
/** Dávky staršie než toto (koniec dávky) sa už nesťahujú — nad oceánom by nepomohli. */
export const HFDL_MAX_BATCH_AGE_MS = 6 * 3600_000;
/** Prieskum nových dávok (dávka pribudne raz za hodinu, dva zberače posunuté o ~6 min). */
export const HFDL_POLL_MS = 10 * 60_000;
/**
 * Dávka, ktorá sa stiahne, ale nedá rozbaliť ani prečítať (poškodený zstd), sa skúsi pri najviac
 * toľkých prieskumoch, potom sa vynechá (2026-10-15: jedna poškodená dávka inak zastavila všetky novšie
 * až na HFDL_MAX_BATCH_AGE_MS). Chyba stiahnutia (HTTP 5xx/429, časový limit, prerušené spojenie) sa
 * do pokusov nepočíta (2026-10-16): býva dočasná a vynechanie by natrvalo stratilo skutočné polohy
 * tej hodiny — skúša sa pri každom prieskume, kým dávka nie je staršia než HFDL_MAX_BATCH_AGE_MS.
 */
export const HFDL_BATCH_MAX_ATTEMPTS = 3;
/**
 * Zlyhaná dávka (stiahnutie aj čítanie) podrží novšie dávky najviac toľko od svojho prvého zlyhania
 * (2026-10-16): applyExternalFixes berie len polohy novšie než súčasné ukotvenie — staršia dávka
 * doručená až po novšej by pre každé lietadlo, ktoré novšia dávka počula znova, prepadla ako zastaraná
 * a jej polohy by sa nezapísali ani do Histórie (jedno HTTP 503 = stratená hodina polôh nad oceánom;
 * dva zberače sa nepokrývajú — dávky 175425 a 180051 majú spoločné 1 hlásenie). Po tomto čase sa
 * novšie spracujú (jedna zlá dávka nezastaví všetky až na HFDL_MAX_BATCH_AGE_MS) a zlyhaná sa skúša ďalej.
 */
export const HFDL_BATCH_HOLD_MS = 60 * 60_000;
export const HFDL_REPO_OWNER = 'adsblol';
export const HFDL_SOURCE = 'adsb.lol/hfdl';
/** `fixes.pos_src` pre polohu z HFDL/ADS-C v Histórii letov (flightHistoryStore POS_SRC.HFDL). */
export const HFDL_POS_SRC = 7;
export const HFDL_ATTRIBUTION = 'HFDL: adsb.lol Aircraft Data Links (CC0)';
const FT_TO_M = 0.3048;

const HEX_RE = /^[0-9a-f]{6}$/;
const CS_RE = /^[A-Z0-9]{2,8}$/;

/** Názov repozitára pre rok (pure). */
export function hfdlRepoForYear(year) {
  return `${HFDL_REPO_OWNER}/aircraft-data-links-${year}`;
}

/** Tag denného vydania pre dátum v UTC (pure). */
export function hfdlReleaseTag(dateMs) {
  const d = new Date(dateMs);
  const p = (n) => String(n).padStart(2, '0');
  return `adsblol-adl-${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Časové okno dávky z názvu súboru `adsblol-adl-hfdl_20261011-175425_20261011-185429.jsonl.zst` (pure).
 * @returns {{fromMs:number, toMs:number}|null}
 */
export function hfdlBatchWindow(name) {
  const m = /adsblol-adl-hfdl_(\d{8})-(\d{6})_(\d{8})-(\d{6})\.jsonl\.zst$/.exec(String(name || ''));
  if (!m) return null;
  const at = (d, t) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
  return { fromMs: at(m[1], m[2]), toMs: at(m[3], m[4]) };
}

/**
 * Čas hlásenia (h:m:s bez dátumu) zarovnaný k času príjmu — najbližší okamih (pure).
 * @returns {number} epoch ms
 */
export function alignClock({ hour, min, sec }, recvMs) {
  const d = new Date(recvMs);
  d.setUTCHours(Number(hour) || 0, Number(min) || 0, Number(sec) || 0, 0);
  let t = d.getTime();
  if (t - recvMs > 12 * 3600_000) t -= 86_400_000;
  else if (recvMs - t > 12 * 3600_000) t += 86_400_000;
  return t;
}

/** Sekundy od začiatku hodiny (ADS-C ts_sec) zarovnané k času príjmu (pure). */
export function alignHourSeconds(tsSec, recvMs) {
  const hourStart = Math.floor(recvMs / 3_600_000) * 3_600_000;
  let t = hourStart + Number(tsSec) * 1000;
  if (t - recvMs > 30 * 60_000) t -= 3_600_000;
  else if (recvMs - t > 30 * 60_000) t += 3_600_000;
  return t;
}

const validLatLon = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon)
  && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) && !(lat === 180 && lon === 180);
const cleanCs = (v) => {
  const s = String(v || '').trim().toUpperCase();
  return CS_RE.test(s) ? s : '';
};

/**
 * Polohy z jedného riadku JSONL (dumphfdl). Vráti 0 až niekoľko fixov (pure).
 * @returns {{hex:string, cs:string, tMs:number, recvMs:number, lat:number, lon:number, altM:number|null,
 *   kind:'hfdl'|'adsc', ground:string|null}[]}
 */
export function parseHfdlLine(line, { maxAgeMs = HFDL_MAX_REPORT_AGE_MS, maxFutureMs = HFDL_MAX_FUTURE_MS } = {}) {
  let j;
  try { j = JSON.parse(line); } catch { return []; }
  const h = j?.hfdl;
  const lpdu = h?.lpdu;
  const npdu = lpdu?.hfnpdu;
  const recvMs = Number(h?.t?.sec) * 1000;
  if (!npdu || !Number.isFinite(recvMs) || lpdu.err || npdu.err) return [];
  // Hex je pri Frequency data v `lpdu.ac_info`, pri Performance data a ADS-C (Enveloped data) od
  // lietadla v `lpdu.src.ac_info` (2026-10-15, dávky z 2026-10-11: 120 z 861 polôh by hex stratilo —
  // párovanie len podľa znaku zlyhá pri IATA tvare AS0506 a obíde stráž „iný stroj s rovnakým znakom").
  const hexRaw = String(lpdu.ac_info?.icao || lpdu.src?.ac_info?.icao || '').trim().toLowerCase();
  const hex = HEX_RE.test(hexRaw) ? hexRaw : '';
  const ground = lpdu.dst?.type === 'Ground station' ? (lpdu.dst.name || null) : (npdu.gs?.name || null);
  const out = [];
  const fresh = (tMs) => Number.isFinite(tMs) && recvMs - tMs <= maxAgeMs && tMs - recvMs <= maxFutureMs;
  // 1) poloha v hlavičke HFDL (Frequency data / Performance data)
  const pos = npdu.pos;
  const clock = npdu.utc_time || npdu.time;
  if (pos && validLatLon(Number(pos.lat), Number(pos.lon)) && clock) {
    const tMs = alignClock(clock, recvMs);
    const cs = cleanCs(npdu.flight_id);
    if (fresh(tMs) && (hex || cs)) {
      out.push({ hex, cs, tMs, recvMs, lat: Number(pos.lat), lon: Number(pos.lon), altM: null, kind: 'hfdl', ground });
    }
  }
  // 2) ADS-C v ACARS (zriedka, ale s výškou)
  const acars = npdu.acars;
  const tags = acars?.arinc622?.adsc?.tags;
  if (Array.isArray(tags)) {
    const cs = cleanCs(acars.flight);
    for (const tag of tags) {
      const r = tag?.basic_report;
      if (!r || !validLatLon(Number(r.lat), Number(r.lon)) || !Number.isFinite(Number(r.ts_sec))) continue;
      const tMs = alignHourSeconds(r.ts_sec, recvMs);
      if (!fresh(tMs) || !(hex || cs)) continue;
      out.push({
        hex, cs, tMs, recvMs, lat: Number(r.lat), lon: Number(r.lon),
        altM: Number.isFinite(Number(r.alt)) ? Math.round(Number(r.alt) * FT_TO_M) : null, kind: 'adsc', ground,
      });
    }
  }
  return out;
}

/**
 * Celá dávka (text JSONL) → fixy zoradené podľa času, bez duplikátov (ten istý stroj a čas) (pure).
 * Duplikáty vznikajú, keď tú istú správu počujú dva prijímače.
 * Kópia s hexom a kópia len so znakom (2026-10-16): hex zo `src.ac_info` dá len prijímač, ktorý má
 * lietadlo vo vyrovnávacej pamäti — tá istá správa tak príde raz s hexom, raz bez. Párujú sa preto aj
 * podľa znaku a času a ostáva kópia s hexom (dávka 2026-10-11 17:54: 6 takých dvojíc); inak by kópia
 * bez hexu obišla v applyExternalFixes stráž „iný stroj s rovnakým znakom". Dva rôzne hexy s tým
 * istým znakom a časom sú dva stroje — ostávajú oba.
 */
export function parseHfdlBatch(text, options) {
  const byHex = new Map(); // `${hex}|${s}` → index v out
  const byCs = new Map(); // `${cs}|${s}` → index v out
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    for (const fix of parseHfdlLine(line, options)) {
      const s = Math.round(fix.tMs / 1000);
      const hexKey = fix.hex ? `${fix.hex}|${s}` : null;
      const csKey = fix.cs ? `${fix.cs}|${s}` : null;
      if (hexKey && byHex.has(hexKey)) continue;
      const twin = csKey && byCs.has(csKey) ? byCs.get(csKey) : -1;
      if (twin >= 0 && !(fix.hex && out[twin].hex)) {
        // Tá istá správa: kópia bez hexu ustúpi kópii s hexom.
        if (fix.hex) {
          out[twin] = fix;
          byHex.set(hexKey, twin);
        }
        continue;
      }
      const i = out.push(fix) - 1;
      if (hexKey) byHex.set(hexKey, i);
      if (csKey && twin < 0) byCs.set(csKey, i);
    }
  }
  return out.sort((a, b) => a.tMs - b.tMs);
}

/**
 * Sťahovač pre server: raz za HFDL_POLL_MS pozrie dnešné (a krátko po polnoci aj včerajšie) vydanie,
 * stiahne dávky HFDL, ktoré ešte nemá, a pošle fixy do onFixes. Pamätá si stiahnuté súbory na disku.
 * @param {{fetchImpl?: typeof fetch, now?: () => number, onFixes?: (fixes: object[], meta: object) => any,
 *   stateFile?: string|null, decompress?: (buf: Buffer) => Buffer, log?: (msg: string) => void}} [options]
 */
export function createHfdlFeed({
  fetchImpl = (...a) => fetch(...a), now = () => Date.now(), onFixes = null, stateFile = null,
  decompress = (buf) => zlib.zstdDecompressSync(buf), log = () => {}, userAgent = 'OKO okolive.sk (HFDL positions)',
} = {}) {
  const seen = new Set();
  /**
   * Zlyhané dávky: názov → { sinceMs: prvé zlyhanie, reads: pokusy o prečítanie stiahnutej } (len
   * v pamäti; po reštarte sa skúsia znova a podržanie HFDL_BATCH_HOLD_MS začne odznova).
   */
  const failures = new Map();
  let loaded = false;
  let timer = null;
  let running = false;
  const status = {
    enabled: typeof zlib.zstdDecompressSync === 'function',
    lastPollAt: null, lastFileAt: null, lastFile: null, lastError: null,
    files: 0, fixes: 0, fixesHfdl: 0, fixesAdsc: 0, lastBatchFixes: 0, polls: 0, fileErrors: 0, filesSkipped: 0,
  };

  async function loadState() {
    if (loaded) return;
    loaded = true;
    if (!stateFile) return;
    try {
      const data = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      for (const name of Array.isArray(data?.seen) ? data.seen : []) seen.add(name);
    } catch { /* prvé spustenie */ }
  }

  async function saveState() {
    if (!stateFile) return;
    // Stačí posledných ~200 súborov (≈ 4 dni HFDL) — staršie aj tak vypadnú oknom HFDL_MAX_BATCH_AGE_MS.
    const keep = [...seen].slice(-200);
    try {
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(stateFile, JSON.stringify({ seen: keep, savedAt: now() }));
    } catch { /* stav je doplnok */ }
  }

  async function listAssets(dateMs) {
    const year = new Date(dateMs).getUTCFullYear();
    const url = `https://api.github.com/repos/${hfdlRepoForYear(year)}/releases/tags/${hfdlReleaseTag(dateMs)}`;
    const res = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) return []; // vydanie dňa ešte nevzniklo (krátko po polnoci)
    if (!res.ok) throw new Error(`GitHub releases HTTP ${res.status}`);
    const data = await res.json();
    return (Array.isArray(data?.assets) ? data.assets : [])
      .filter((a) => /^adsblol-adl-hfdl_.*\.jsonl\.zst$/.test(a?.name || '') && a.browser_download_url);
  }

  async function pollOnce() {
    if (running || !status.enabled) return { files: 0, fixes: 0 };
    running = true;
    status.polls += 1;
    status.lastPollAt = now();
    let files = 0;
    let fixes = 0;
    let skipped = 0;
    let fileError = null;
    try {
      await loadState();
      const t = now();
      const days = [t];
      // Prvé hodiny po polnoci UTC: posledné dávky predošlého dňa sú ešte vo včerajšom vydaní.
      if (new Date(t).getUTCHours() < 2) days.push(t - 86_400_000);
      const assets = [];
      for (const day of days) assets.push(...await listAssets(day));
      const fresh = assets
        .map((a) => ({ a, win: hfdlBatchWindow(a.name) }))
        .filter(({ a, win }) => win && !seen.has(a.name) && t - win.toMs <= HFDL_MAX_BATCH_AGE_MS)
        .sort((x, y) => x.win.toMs - y.win.toMs);
      for (const { a, win } of fresh) {
        // Chyba dávky (HTTP, časový limit, poškodený zstd) sa skúsi pri ďalšom prieskume. Novšie dávky
        // počkajú (break), kým zlyhaná nie je doručená alebo kým od jej prvého zlyhania neuplynie
        // HFDL_BATCH_HOLD_MS (2026-10-16) — poradie dávok drží polohy tej hodiny v ukotvení aj v Histórii.
        // Potom sa novšie spracujú (2026-10-15: jedna zlá dávka nezastaví všetky). Vynechať natrvalo
        // sa smie len dávka, ktorá sa stiahla a nedá sa prečítať (HFDL_BATCH_MAX_ATTEMPTS); chyba
        // stiahnutia býva dočasná a skúša sa, kým dávka nie je staršia než HFDL_MAX_BATCH_AGE_MS.
        let batch = null;
        let failure = null;
        let unreadable = false;
        try {
          const res = await fetchImpl(a.browser_download_url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(60_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          try { batch = parseHfdlBatch(decompress(buf).toString('utf8')); } catch (error) { unreadable = true; throw error; }
        } catch (error) {
          failure = error;
        }
        if (failure) {
          const f = failures.get(a.name) || { sinceMs: t, reads: 0 };
          if (unreadable) f.reads += 1;
          status.fileErrors += 1;
          fileError = `HFDL ${a.name}: ${failure?.message || failure}`;
          if (f.reads >= HFDL_BATCH_MAX_ATTEMPTS) {
            failures.delete(a.name);
            seen.add(a.name);
            skipped += 1;
            status.filesSkipped += 1;
            log(`[hfdl] ${fileError} — po ${f.reads} pokusoch vynechaná`);
            continue;
          }
          failures.set(a.name, f);
          const hold = t - f.sinceMs < HFDL_BATCH_HOLD_MS;
          const what = unreadable ? `nečitateľná (pokus ${f.reads}/${HFDL_BATCH_MAX_ATTEMPTS})` : 'stiahnutie zlyhalo';
          log(`[hfdl] ${fileError} — ${what}, skúsi sa pri ďalšom prieskume${hold ? '; novšie dávky počkajú' : ''}`);
          if (hold) break;
          continue;
        }
        failures.delete(a.name);
        seen.add(a.name);
        files += 1;
        fixes += batch.length;
        status.files += 1;
        status.fixes += batch.length;
        status.fixesHfdl += batch.filter((f) => f.kind === 'hfdl').length;
        status.fixesAdsc += batch.filter((f) => f.kind === 'adsc').length;
        status.lastBatchFixes = batch.length;
        status.lastFile = a.name;
        status.lastFileAt = now();
        if (onFixes && batch.length) {
          try { await onFixes(batch, { file: a.name, fromMs: win.fromMs, toMs: win.toMs }); } catch (error) { log(`[hfdl] onFixes failed: ${error?.message || error}`); }
        }
      }
      // Pokusy dávok, ktoré vypadli z okna HFDL_MAX_BATCH_AGE_MS, netreba držať v pamäti.
      const freshNames = new Set(fresh.map(({ a }) => a.name));
      for (const name of failures.keys()) if (!freshNames.has(name)) failures.delete(name);
      if (files || skipped) await saveState();
      status.lastError = fileError;
    } catch (error) {
      status.lastError = String(error?.message || error);
      log(`[hfdl] poll failed: ${status.lastError}`);
    } finally {
      running = false;
    }
    return { files, fixes };
  }

  return {
    pollOnce,
    start({ delayMs = 30_000 } = {}) {
      if (timer || !status.enabled) return false;
      const tick = () => { void pollOnce(); };
      setTimeout(tick, delayMs).unref?.();
      timer = setInterval(tick, HFDL_POLL_MS);
      timer.unref?.();
      return true;
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    status: () => ({ ...status, seen: seen.size }),
  };
}
