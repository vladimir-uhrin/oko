// src/data/volbyObceSweep.js
/**
 * @module volbyObceSweep
 * @description Výsledky VŠETKÝCH obcí z JSON stránky ŠÚ SR (2026-10-25, vlastník: „sprav všetko" — farebná mapa
 * víťazov, zaujímavosti, karta obce). Stránka volbysr.sk má za každú obec dva súbory:
 *  - `oso/json/graph01/<kód>.json` — súhrn obce: C03 % spracovania („100,00"), C04 zapísaní, C05 vydané obálky,
 *    C06 účasť %, C09 platné hlasy pre starostu, C11 zvolený starosta (prázdne = nezvolený), C12 subjekt,
 *    C13 hlasy, C14 %, C15 mandáty v zastupiteľstve, C16 obsadené mandáty, C17 typ (1 starosta + poslanci,
 *    2 len starosta, 3 len poslanci) — overené na Topoľníkoch a Bratislave 25. 10. ráno,
 *  - `oso/json/tab05/<kód>.json` — kandidáti na starostu s hlasmi (rovnaký tvar ako volbyLive.liveCandidates).
 * Výsledky poslancov s hlasmi ŠÚ SR v priebežnej verzii stránky nezverejňuje (tabuľky tab06e/tab07 sú len
 * v definitívnej verzii) — tu sa preto nepočítajú.
 *
 * „Doterajší starosta" = kandidát, ktorý v registri MV SR uviedol zamestnanie „starosta/starostka/primátor/
 * primátorka" (register nemá stĺpec úradujúci starosta). Je to odhad z údaja kandidáta a UI to tak aj hovorí.
 *
 * Zber je šetrný: najviac 4 požiadavky naraz, výsledok obce sa uloží na disk a obec so 100 % spracovania sa už
 * nikdy znova nesťahuje. Celý zber (≈ 5 800 malých súborov) beží raz; ďalšie kolá len pre nedokončené obce.
 */
import fs from 'node:fs';
import path from 'node:path';
import { foldText } from './volbyCandidates.js';
import { liveCandidates } from './volbyLive.js';

export const SWEEP_BASE = 'https://volbysr.sk/oso/json';
export const SWEEP_CONCURRENCY = 4;
export const SWEEP_ROUND_MS = 20 * 60_000;
const UA = 'OKO-okolive.sk/1.0 (+https://okolive.sk)';

const num = (v) => { const s = String(v ?? '').replace(/[\s  %]/g, '').replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Zamestnanie úradujúceho starostu/primátora (aj starostka, primátorka, starosta mestskej časti). Pure. */
export function isIncumbentJob(job) {
  const s = foldText(job);
  return /^(starost|primator)/.test(s) || /(^|\s)(starosta|starostka|primator|primatorka)( obce| mesta| mestskej| mc|$)/.test(s);
}

/**
 * Ako dobre zamestnanie zodpovedá úradu, o ktorý sa v obci hlasuje (vyššie = istejší úradujúci). V Košiciach
 * 2026 kandidovali na primátora aj dvaja starostovia mestských častí — primátor mesta musí mať prednosť.
 * Mestská časť (Bratislava - …, Košice - …): „starosta mestskej časti"; mesto a obec: primátor > starosta obce. Pure.
 */
export function incumbentScore(job, { district = false } = {}) {
  if (!isIncumbentJob(job)) return 0;
  const s = foldText(job);
  const mc = /mestskej|(^|\s)mc(\s|$)/.test(s);
  if (district) return mc ? 3 : 1;
  if (/(^|\s)primator/.test(s)) return 3;
  return mc ? 1 : 2;
}
const DISTRICT_NAME_RE = /^(Bratislava|Košice) - /;

/** Súhrn obce z graph01. Pure. */
export function parseObecSummary(rows) {
  const r = Array.isArray(rows) ? rows[0] : null;
  if (!r) return null;
  return {
    pct: num(r.C03), registered: num(r.C04), voted: num(r.C05), turnoutPct: num(r.C06),
    validMayor: num(r.C09), winner: text(r.C11) || null, winnerParty: text(r.C12) || null, winnerVotes: num(r.C13), winnerPct: num(r.C14),
    seats: num(r.C15), seatsFilled: num(r.C16), typ: num(r.C17),
  };
}

/**
 * Výsledok obce pre mapu, kartu a zaujímavosti. Pure.
 * @param {{code:string, name:string, okres?:string, starosta?:Array}} obec obec z modelu MV SR (kandidáti so zamestnaním)
 * @param {object|null} summary parseObecSummary
 * @param {Array|null} kandidati liveCandidates(tab05)
 * @returns {{code, name, done:boolean, cls:'held'|'lost'|'open'|'none'|'pending', turnoutPct, registered, voted,
 *   winner, second, margin:number|null, marginPct:number|null, single:boolean, incumbent:object|null, seats}}
 */
export function obecResult(obec, summary, kandidati) {
  const list = (kandidati || []).filter((c) => !c.withdrawn);
  const done = Boolean(summary && summary.pct != null && summary.pct >= 100);
  // Model má kandidátov v obec.starosta (pole), detail obce (obecDetail) v obec.kandidati.starosta (starosta = počet).
  const cands = Array.isArray(obec?.starosta) ? obec.starosta : Array.isArray(obec?.kandidati?.starosta) ? obec.kandidati.starosta : [];
  const district = DISTRICT_NAME_RE.test(String(obec?.name || ''));
  const scored = cands.map((c) => ({ c, s: incumbentScore(c?.zamestnanie, { district }) })).filter((x) => x.s > 0);
  const best = Math.max(0, ...scored.map((x) => x.s));
  const reg = scored.filter((x) => x.s === best).map((x) => x.c);
  // Úradujúci podľa registra (jednoznačne najlepšia zhoda); párovanie na výsledok cez číslo na lístku, záložne cez priezvisko.
  const incReg = reg.length === 1 ? reg[0] : null;
  const match = (c) => incReg && (c.n === incReg.n || foldText(c.priezvisko) === foldText(incReg.priezvisko));
  const winner = list.find((c) => c.elected) || null;
  const top = list[0] || null;
  const second = list[1] || null;
  const noMayorRace = summary?.typ === 3;
  let cls = 'pending';
  if (done && !noMayorRace) {
    if (!winner) cls = 'none';
    else if (incReg && match(winner)) cls = 'held';
    else if (incReg && list.some(match)) cls = 'lost';
    else cls = 'open';
  } else if (done && noMayorRace) cls = 'none';
  const pick = (c) => (c ? { n: c.n, meno: c.meno, priezvisko: c.priezvisko, strany: c.strany, nezavisly: Boolean(c.nezavisly), votes: c.votes, pct: c.pct } : null);
  return {
    code: obec?.code, name: obec?.name, okres: obec?.okres || null, done, cls,
    turnoutPct: summary?.turnoutPct ?? null, registered: summary?.registered ?? null, voted: summary?.voted ?? null,
    winner: pick(winner || (done ? null : top)), elected: Boolean(winner), second: pick(winner ? list.find((c) => c !== winner) : second),
    margin: winner && list.length > 1 ? winner.votes - (list.find((c) => c !== winner)?.votes ?? 0) : null,
    marginPct: winner && list.length > 1 ? +(winner.pct - (list.find((c) => c !== winner)?.pct ?? 0)).toFixed(2) : null,
    single: list.length === 1, candidates: list.length,
    incumbent: incReg ? { n: incReg.n, meno: incReg.meno, priezvisko: incReg.priezvisko, zamestnanie: incReg.zamestnanie } : null,
    seats: summary?.seats ?? null, typ: summary?.typ ?? null,
  };
}

/**
 * Zaujímavosti z hotových obcí: počty (obhájili, prehrali, nové tváre, nezvolení, jediný kandidát, nezávislí),
 * najtesnejšie víťazstvá, rekordná a najnižšia účasť, najväčšie mesto, kde starosta prehral. Pure.
 * @param {Array} results obecResult[]
 * @param {{ excludeCodes?: Set<string> }} [o] mestá s mestskými časťami (Bratislava, Košice) sa do účasti nerátajú dvakrát
 */
export function volbyRecords(results, { excludeCodes = new Set(), minVoters = 100, top = 3 } = {}) {
  const done = results.filter((r) => r.done);
  const counts = { obce: results.length, done: done.length, held: 0, lost: 0, open: 0, none: 0, single: 0, independent: 0, elected: 0 };
  for (const r of done) {
    if (r.cls in counts) counts[r.cls] += 1;
    if (r.single && r.elected) counts.single += 1;
    if (r.elected) { counts.elected += 1; if (r.winner?.nezavisly) counts.independent += 1; }
  }
  const brief = (r, extra = {}) => ({ code: r.code, name: r.name, okres: r.okres, winner: r.winner ? `${r.winner.meno} ${r.winner.priezvisko}` : null, ...extra });
  const contested = done.filter((r) => r.elected && r.margin != null && r.candidates > 1);
  const closest = [...contested].sort((a, b) => a.margin - b.margin || (b.registered || 0) - (a.registered || 0)).slice(0, top)
    .map((r) => brief(r, { margin: r.margin, second: r.second ? `${r.second.meno} ${r.second.priezvisko}` : null }));
  const turnoutPool = done.filter((r) => !excludeCodes.has(r.code) && r.turnoutPct != null && (r.registered || 0) >= minVoters);
  const highest = [...turnoutPool].sort((a, b) => b.turnoutPct - a.turnoutPct).slice(0, top).map((r) => brief(r, { turnoutPct: r.turnoutPct, registered: r.registered }));
  const lowest = [...turnoutPool].sort((a, b) => a.turnoutPct - b.turnoutPct).slice(0, top).map((r) => brief(r, { turnoutPct: r.turnoutPct, registered: r.registered }));
  const lostBig = done.filter((r) => r.cls === 'lost').sort((a, b) => (b.registered || 0) - (a.registered || 0)).slice(0, top)
    .map((r) => brief(r, { incumbent: r.incumbent ? `${r.incumbent.meno} ${r.incumbent.priezvisko}` : null, registered: r.registered }));
  const noMayor = done.filter((r) => r.cls === 'none' && r.typ !== 3).slice(0, 12).map((r) => brief(r));
  return { counts, closest, highest, lowest, lostBig, noMayor };
}

/**
 * Zber výsledkov všetkých obcí s diskovou cache. Server ho volá v pozadí (volbyService), klient číta hotové
 * súhrny cez /api/volby/obce-vysledky a /api/volby/zaujimavosti.
 */
export function createVolbyObceSweep({
  fetchImpl = (...a) => globalThis.fetch(...a), cacheFile = path.join(process.cwd(), '.gev-cache', 'volby', 'obce-sweep.json'),
  now = Date.now, log = console, concurrency = SWEEP_CONCURRENCY, base = SWEEP_BASE, registry = null, roundMs = SWEEP_ROUND_MS,
} = {}) {
  /** code → { graph, tab05, fetchedAt } */
  let raw = null;
  const state = { running: null, lastRoundAt: 0, fetches: 0, errors: 0 };
  function load() {
    if (raw) return raw;
    try { raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).obce || {}; } catch { raw = {}; }
    return raw;
  }
  function save() {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date(now()).toISOString(), obce: raw }));
      fs.renameSync(tmp, cacheFile);
    } catch (error) { log.warn?.(`[volby] zber obcí: zápis cache ${error?.message}`); }
  }
  async function getJson(pathname) {
    state.fetches += 1;
    try {
      const res = await fetchImpl(`${base}/${pathname}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      registry?.record?.('volbysr.sk', { status: res.status });
      if (!res.ok) return null;
      const body = await res.text();
      return /^\s*[[{]/.test(body) ? JSON.parse(body) : null;
    } catch {
      state.errors += 1;
      registry?.record?.('volbysr.sk', { error: true });
      return undefined; // sieťová chyba ≠ „súbor ešte nie je"
    }
  }
  const isDone = (entry) => (parseObecSummary(entry?.graph)?.pct ?? 0) >= 100 && Array.isArray(entry?.tab05);
  /** Jedno kolo: obce bez hotového výsledku. */
  async function roundNow(obce) {
    load();
    const todo = obce.filter((o) => !isDone(raw[o.code]));
    let i = 0; let changed = 0;
    const worker = async () => {
      while (i < todo.length) {
        const o = todo[i++];
        const graph = await getJson(`graph01/${encodeURIComponent(o.code)}.json`);
        if (graph === undefined) continue;
        const done = (parseObecSummary(graph)?.pct ?? 0) >= 100;
        const tab05 = graph ? await getJson(`tab05/${encodeURIComponent(o.code)}.json`) : null;
        if (tab05 === undefined) continue;
        raw[o.code] = { graph, tab05: done && !tab05 ? [] : tab05, fetchedAt: now() };
        changed += 1;
        if (changed % 200 === 0) save();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    if (changed) save();
    state.lastRoundAt = now();
    log.info?.(`[volby] zber obcí: ${changed} obnovených, hotových ${obce.filter((o) => isDone(raw[o.code])).length}/${obce.length}`);
  }
  function round(obce) {
    if (!state.running) state.running = roundNow(obce).catch((e) => log.warn?.(`[volby] zber obcí zlyhal: ${e?.message}`)).finally(() => { state.running = null; });
    return state.running;
  }
  /** Spustí kolo, ak je čas (prvé hneď, potom á roundMs) a ešte nie je všetko hotové. */
  function maybeRound(obce) {
    load();
    const allDone = obce.every((o) => isDone(raw[o.code]));
    if (!allDone && !state.running && now() - state.lastRoundAt >= roundMs) void round(obce);
  }
  function result(obec) {
    load();
    const e = raw[obec.code];
    if (!e) return null;
    return obecResult(obec, parseObecSummary(e.graph), e.tab05 ? liveCandidates(e.tab05) : null);
  }
  function results(obce) { return obce.map((o) => result(o)).filter(Boolean); }
  return { round, maybeRound, result, results, status: () => ({ ...state, running: Boolean(state.running), cached: Object.keys(load()).length }), _raw: () => load() };
}
