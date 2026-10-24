// src/data/volbyLive.js
/**
 * @module volbyLive
 * @description Priebežné výsledky volieb 2026 z JSON súborov stránky ŠÚ SR volbysr.sk (2026-10-24 20:40: kontrola po
 * zatvorení miestností ukázala, že priebežné výsledky NEchodia do ZIPu XLSX — ten je len s číselníkmi, v roku 2022
 * ho ŠÚ SR doplnil až definitívnymi výsledkami. Stránka výsledkov si dáta ťahá z /osk/json a /oso/json):
 *  - súhrn spracovania: `<osk|oso>/json/tab01.json` → [{ C03: počet okrskov, C04: spracované, C05: „12,34 %" }],
 *  - predseda kraja: `osk/json/tab06b/<kód kraja>.json`, poslanci kraja: `osk/json/tab09c/<kód obvodu>.json`,
 *  - starosta obce: `oso/json/tab05/<kód obce>.json`.
 * Riadky kandidátov (hlavičky zo stránky): C01 poradie na lístku, C02 meno, C03 priezvisko, C04 politický subjekt,
 * C05 počet platných hlasov („1 234"), C06 podiel v % („12,34"), C07 kandidát/poznámka (zvolený, vzdal sa).
 * Kým súbor nie je, server vracia HTML 404 → null. Cache 2 min (ŠÚ SR obnovuje po dávkach okrskov).
 */
export const LIVE_BASE = 'https://volbysr.sk';
export const LIVE_TTL_MS = 2 * 60_000;
const UA = 'OKO-okolive.sk/1.0 (+https://okolive.sk)';

const num = (v) => { const s = String(v ?? '').replace(/[\s  %]/g, '').replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Príznak z poznámky/stĺpca kandidát: zvolený | vzdal sa | null. Pure. */
export function liveFlag(v) {
  const s = text(v).toLowerCase();
  if (!s) return null;
  if (s === '1' || s.startsWith('zvolen')) return 'elected';
  if (s === 'x' || s.includes('vzdal') || s.includes('odvolan')) return 'withdrawn';
  return null;
}

/**
 * Riadky kandidátov ŠÚ SR → výsledky v tvare volbyResults.rankCandidates (n, votes, pct, rank, elected, leads, withdrawn)
 * plus meno a subjekt priamo zo ŠÚ SR. Súčtové riadky (C01 nečíselné) vypadnú. Pure.
 * @param {Array<object>} rows
 * @param {{ seats?: number }} [o]
 */
export function liveCandidates(rows, { seats = 1 } = {}) {
  const list = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = num(r?.C01);
    if (n === null || !Number.isInteger(n)) continue;
    list.push({ n, meno: text(r.C02), priezvisko: text(r.C03), strany: text(r.C04), votes: num(r.C05) ?? 0, pctSrc: num(r.C06), flag: liveFlag(r.C07) });
  }
  list.sort((a, b) => b.votes - a.votes || a.n - b.n);
  const total = list.reduce((s, c) => s + c.votes, 0);
  const anyElected = list.some((c) => c.flag === 'elected');
  return list.map((c, i) => ({
    n: c.n, meno: c.meno, priezvisko: c.priezvisko, strany: c.strany, known: true, nezavisly: /nezávisl|neka/i.test(c.strany),
    votes: c.votes, pct: c.pctSrc ?? (total > 0 ? +((c.votes / total) * 100).toFixed(2) : 0), rank: i + 1,
    elected: c.flag === 'elected', withdrawn: c.flag === 'withdrawn',
    leads: !anyElected && total > 0 && i < Math.max(1, seats) && c.flag !== 'withdrawn',
  }));
}

/** Súhrn spracovania z tab01.json. Pure. */
export function liveSummary(rows) {
  const r = Array.isArray(rows) ? rows[0] : null;
  if (!r) return null;
  const total = num(r.C03); const done = num(r.C04); const pct = num(r.C05);
  if (total === null) return null;
  return { okrskyTotal: total, okrskyDone: done ?? 0, pct: pct ?? (total ? +(((done ?? 0) / total) * 100).toFixed(2) : 0), updated: text(r.C01) || null };
}

/** @param {{ fetchImpl?: Function, now?: () => number, ttlMs?: number, registry?: { record: Function } }} [o] */
export function createVolbyLive({ fetchImpl = (...a) => globalThis.fetch(...a), now = Date.now, ttlMs = LIVE_TTL_MS, registry = null, base = LIVE_BASE } = {}) {
  const cache = new Map(); // path → { at, data, pending }
  async function get(pathname) {
    const hit = cache.get(pathname);
    if (hit?.pending) return hit.pending;
    if (hit && now() - hit.at < ttlMs) return hit.data;
    const pending = (async () => {
      try {
        const res = await fetchImpl(`${base}/${pathname}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
        registry?.record?.('volbysr.sk', { status: res.status });
        if (!res.ok) return null;
        const body = await res.text();
        if (!/^\s*[[{]/.test(body)) return null;
        return JSON.parse(body);
      } catch {
        registry?.record?.('volbysr.sk', { error: true });
        return hit?.data ?? null;
      }
    })();
    cache.set(pathname, { at: hit?.at ?? 0, data: hit?.data ?? null, pending });
    const data = await pending;
    cache.set(pathname, { at: now(), data });
    return data;
  }
  const rowsOk = (d) => (Array.isArray(d) && d.length ? d : null);
  return {
    async summary() {
      const [oso, osk] = await Promise.all([get('oso/json/tab01.json'), get('osk/json/tab01.json')]);
      return { oso: liveSummary(oso), osk: liveSummary(osk) };
    },
    async predseda(kraj) { const d = rowsOk(await get(`osk/json/tab06b/${encodeURIComponent(kraj)}.json`)); return d ? liveCandidates(d, { seats: 1 }) : null; },
    async zupniObvod(obvod, seats = 1) { const d = rowsOk(await get(`osk/json/tab09c/${encodeURIComponent(obvod)}.json`)); return d ? liveCandidates(d, { seats }) : null; },
    async starosta(obec) { const d = rowsOk(await get(`oso/json/tab05/${encodeURIComponent(obec)}.json`)); return d ? liveCandidates(d, { seats: 1 }) : null; },
    _cache: cache,
  };
}
