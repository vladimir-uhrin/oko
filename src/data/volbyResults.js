// src/data/volbyResults.js
/**
 * @module volbyResults
 * @description Výsledky volieb 2026 z tabuliek ŠÚ SR (2026-10-24, vlastník: „kandidátov, kde, kedy a potom
 * ako to dopadlo, interaktívne, ako majú vyzerať profi výsledky"). Čistý model nad tabuľkami zo ZIPov
 * volbysr.sk (src/data/volbyService.js parseSusrZip) spojený s modelom kandidátov (volbyCandidates.js).
 *
 * Štruktúra podľa definitívnych výsledkov OSO 2022 (archív, tab_info): za OKRSKY
 *  - tab05f: Kód obce | Volebný obvod v obci | Okrsok | Poradie na hlasovacom lístku | Počet platných hlasov |
 *    Podiel platných hlasov v % | Kandidát („1" zvolený starosta, „X" vzdal sa)
 *  - tab08f: to isté pre poslancov („1" zvolený, „0" náhradník)
 *  - tab02bf: Kód obce | Obvod | Okrsok | Počet voličov zapísaných… | Počet voličov, ktorí sa zúčastnili… | Účasť v % | …
 *  - tab02ad: Kód obce | Obvod | Počet volených poslancov | Počet zvolených poslancov
 * Rok 2026 zverejňuje XLSX s opisnými hlavičkami (v číselníku tab0dd „Kód obce" namiesto OBEC), preto sa
 * stĺpce hľadajú podľa významu hlavičky (bez diakritiky; kódy 2022 aj opisy 2026), druh tabuľky podľa
 * titulku z tab_info (starosta / poslanci / predseda / účasť), záložne podľa čísla tabuľky. Hlasy sa sčítajú
 * cez okrsky; podiel = hlasy ÷ platné hlasy všetkých kandidátov v obci (obvode, kraji). Spracovanie =
 * počet odlišných okrskov vo výsledkoch oproti počtu okrskov z územného členenia. „Zvolený" len podľa
 * značky ŠÚ SR; inak kandidát na prvom mieste „vedie". Pure.
 */
import { foldText } from './volbyCandidates.js';

/** Pravidlá stĺpcov: kľúč → presné (bez diakritiky) alebo čiastočné zhody hlavičky; prvé pravidlo vyhráva. */
export const COLUMN_RULES = Object.freeze([
  { key: 'okrsok', exact: ['okrsok', 'kod okrsku', 'cislo okrsku', 'volebny okrsok'], any: ['okrsok', 'okrsk'] },
  { key: 'obvodKraj', exact: ['obvod', 'kod volebneho obvodu'], any: ['kod volebneho obvodu'], scope: 'osk' },
  { key: 'obvod', exact: ['voobec', 'volebny obvod', 'volebny obvod v obci', 'cislo volebneho obvodu v obci', 'kod volebneho obvodu'], any: ['volebny obvod', 'volebneho obvodu'] },
  { key: 'obec', exact: ['obec', 'kod obce'], any: ['kod obce'] },
  { key: 'kraj', exact: ['kraj', 'kod kraja'], any: ['kod kraja'] },
  { key: 'n', exact: ['pc hl', 'poradove cislo kandidata', 'poradie na hlasovacom listku', 'poradove cislo', 'poradove cislo kandidata na hlasovacom listku'], any: ['poradie na hlasovacom', 'poradove cislo'] },
  { key: 'pct', exact: ['p hl pct', 'podiel platnych hlasov v', 'podiel platnych hlasov'], any: ['podiel platnych hlasov', 'podiel hlasov'] },
  { key: 'votes', exact: ['p hl', 'pocet platnych hlasov'], any: ['pocet platnych hlasov'], not: ['listk', 'listok', 'obalk'] },
  { key: 'elected', exact: ['kandidat', 'zvoleny', 'zvoleny kandidat'], any: ['zvolen'] },
  { key: 'registered', exact: ['p zap'], any: ['zapisanych v zozname', 'zapisanych v zoznamoch', 'zapisanych volicov'] },
  { key: 'voted', exact: ['p zuc'], any: ['zucastnili', 'zucastnenych'] },
  { key: 'turnout', exact: ['ucast', 'ucast v'], any: ['ucast'] },
  { key: 'seats', exact: ['p pos vol'], any: ['pocet volenych poslancov'] },
  { key: 'seatsElected', exact: ['p pos zvol'], any: ['pocet zvolenych poslancov'] },
  { key: 'meno', exact: ['meno', 'meno kandidata'], any: [] },
  { key: 'priezvisko', exact: ['priezvisko', 'priezvisko kandidata'], any: [] },
]);

const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v) => {
  const s = String(v ?? '').replace(/\s| /g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const int = (v) => { const n = num(v); return n === null ? null : Math.round(n); };

/** Hlavička (riadok textov) → mapa kľúč → index stĺpca. Pure. */
export function mapColumns(headers, scope = 'oso') {
  const out = {};
  headers.forEach((raw, index) => {
    const h = foldText(raw);
    if (!h) return;
    for (const rule of COLUMN_RULES) {
      if (rule.scope && rule.scope !== scope) continue;
      if (out[rule.key] !== undefined) continue;
      if (rule.not?.some((bad) => h.includes(bad))) continue;
      if (rule.exact.includes(h) || rule.any.some((part) => h.includes(part))) { out[rule.key] = index; return; }
    }
  });
  return out;
}

/** Index riadku hlavičky: prvý riadok s aspoň dvoma známymi stĺpcami. Pure. */
export function findHeaderRow(rows, scope = 'oso') {
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const cols = mapColumns(rows[i] || [], scope);
    if (Object.keys(cols).length >= 2) return i;
  }
  return -1;
}

/** Druh tabuľky z titulku (tab_info) a stĺpcov; záloha podľa čísla tabuľky. Pure. */
export function tableKind({ name = '', title = '', columns = {}, scope = 'oso' } = {}) {
  const t = foldText(title);
  const number = /_tab(\d{2})/i.exec(name)?.[1] || '';
  if (columns.registered !== undefined || columns.voted !== undefined || columns.turnout !== undefined) return 'ucast';
  if (columns.seats !== undefined && columns.seatsElected !== undefined) return 'mandaty';
  if (columns.votes !== undefined && columns.n !== undefined) {
    if (/predsed|zupan/.test(t)) return 'predseda';
    if (/starost|primator/.test(t)) return 'starosta';
    if (/poslan|zastupitel/.test(t)) return scope === 'osk' ? 'zupni' : 'poslanci';
    if (scope === 'osk') return number === '05' ? 'predseda' : 'zupni';
    if (number === '05') return 'starosta';
    if (number === '08') return 'poslanci';
    return columns.obvod !== undefined ? 'poslanci' : 'starosta';
  }
  return 'unknown';
}

/** Tabuľka ŠÚ SR (name, title, sheets) → { scope, kind, columns, records } alebo null bez hlavičky. Pure. */
export function classifyTable(table) {
  const name = String(table?.name || '');
  const scope = /^OSK/i.test(name) ? 'osk' : 'oso';
  const rows = table?.sheets?.[0]?.rows || [];
  const headerAt = findHeaderRow(rows, scope);
  if (headerAt < 0) return null;
  const columns = mapColumns(rows[headerAt], scope);
  const kind = tableKind({ name, title: table?.title || '', columns, scope });
  return { name, title: table?.title || null, scope, kind, columns, records: rows.slice(headerAt + 1) };
}

const electedFlag = (v) => {
  const s = foldText(v);
  if (s === '1' || s === 'ano' || s === 'zvoleny' || s === 'true') return 'elected';
  if (s === 'x' || s === 'vzdal sa' || s === 'odvolany') return 'withdrawn';
  return null;
};

/**
 * Hlasy kandidátov zo záznamov: kľúč skupiny (obec, obvod alebo kraj) → Map n → { votes, flag, okrsky }.
 * @param {Array<Array<string|null>>} records
 * @param {object} columns
 * @param {(row: Array<string|null>) => string|null} groupKey
 */
export function aggregateCandidates(records, columns, groupKey) {
  const groups = new Map();
  for (const row of records) {
    const key = groupKey(row);
    const n = int(row[columns.n]);
    if (!key || n === null) continue;
    if (!groups.has(key)) groups.set(key, { cands: new Map(), okrsky: new Set() });
    const g = groups.get(key);
    if (!g.cands.has(n)) g.cands.set(n, { n, votes: 0, flag: null, rows: 0 });
    const c = g.cands.get(n);
    const votes = int(row[columns.votes]);
    if (votes !== null) c.votes += votes;
    c.rows += 1;
    const flag = columns.elected !== undefined ? electedFlag(row[columns.elected]) : null;
    if (flag && (c.flag !== 'elected')) c.flag = flag;
    if (columns.okrsok !== undefined) {
      const okrsok = text(row[columns.okrsok]);
      if (okrsok) g.okrsky.add(`${text(row[columns.obec])}|${okrsok}`);
    }
  }
  return groups;
}

/** Zoradenie a podiely: hlasy zostupne, podiel z platných hlasov skupiny; poradie 1 „vedie". Pure. */
export function rankCandidates(cands, { seats = 1 } = {}) {
  const list = [...cands.values()].sort((a, b) => b.votes - a.votes || a.n - b.n);
  const total = list.reduce((s, c) => s + c.votes, 0);
  const anyElected = list.some((c) => c.flag === 'elected');
  return list.map((c, i) => ({
    n: c.n,
    votes: c.votes,
    pct: total > 0 ? +((c.votes / total) * 100).toFixed(2) : 0,
    rank: i + 1,
    elected: c.flag === 'elected',
    withdrawn: c.flag === 'withdrawn',
    leads: !anyElected && total > 0 && i < Math.max(1, seats) && c.flag !== 'withdrawn',
  }));
}

/** Účasť z okrskových riadkov: skupina → { registered, voted, okrsky }. Pure. */
export function aggregateTurnout(records, columns, groupKey) {
  const groups = new Map();
  for (const row of records) {
    const key = groupKey(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { registered: 0, voted: 0, okrsky: new Set(), rows: 0 });
    const g = groups.get(key);
    g.registered += int(row[columns.registered]) || 0;
    g.voted += int(row[columns.voted]) || 0;
    g.rows += 1;
    const okrsok = columns.okrsok !== undefined ? text(row[columns.okrsok]) : '';
    if (okrsok) g.okrsky.add(`${text(row[columns.obec])}|${okrsok}`);
  }
  return groups;
}

const joinCandidate = (result, candidate) => ({
  ...result,
  meno: candidate?.meno ?? '', priezvisko: candidate?.priezvisko ?? '', titulPred: candidate?.titulPred ?? '', titulZa: candidate?.titulZa ?? '',
  strany: candidate?.strany ?? '', nezavisly: Boolean(candidate?.nezavisly), known: Boolean(candidate),
});

/**
 * Celé výsledky z tabuliek ŠÚ SR nad modelom kandidátov.
 * @param {Map<string, {name:string,title:string|null,sheets:Array}>} tables
 * @param {object} model buildModel() z volbyCandidates.js
 * @param {{ generatedAt?: number }} [meta]
 */
export function buildResults(tables, model, { generatedAt = Date.now() } = {}) {
  const classified = [...(tables?.values?.() || [])].map(classifyTable).filter(Boolean);
  const byKind = {};
  for (const c of classified) if (c.kind !== 'unknown' && !byKind[c.kind]) byKind[c.kind] = c;
  const used = Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.name]));
  const obce = new Map();
  const kraje = new Map();
  const obecEntry = (code) => {
    if (!obce.has(code)) {
      const o = model?.obecByCode?.get(code);
      obce.set(code, { code, okrskyTotal: o?.okrsky ?? null, okrsky: new Set(), ucast: null, starosta: [], poslanci: [] });
    }
    return obce.get(code);
  };
  const krajEntry = (code) => {
    if (!kraje.has(code)) {
      const k = model?.kraje?.find((x) => x.code === code);
      const okrskyTotal = k ? k.obvody.reduce((s, o) => s + (o.okrsky || 0), 0) || null : null;
      kraje.set(code, { code, okrskyTotal, okrsky: new Set(), predseda: [], obvody: [] });
    }
    return kraje.get(code);
  };
  const obecKey = (cols) => (row) => text(row[cols.obec]) || null;

  if (byKind.starosta) {
    const { records, columns } = byKind.starosta;
    for (const [code, g] of aggregateCandidates(records, columns, obecKey(columns))) {
      const entry = obecEntry(code);
      const o = model?.obecByCode?.get(code);
      entry.starosta = rankCandidates(g.cands, { seats: 1 }).map((r) => joinCandidate(r, o?.starosta?.find((c) => c.n === r.n)));
      for (const k of g.okrsky) entry.okrsky.add(k);
    }
  }
  if (byKind.poslanci) {
    const { records, columns } = byKind.poslanci;
    const key = (row) => { const obec = text(row[columns.obec]); const obvod = columns.obvod !== undefined ? text(row[columns.obvod]) || '1' : '1'; return obec ? `${obec}|${obvod}` : null; };
    for (const [k, g] of aggregateCandidates(records, columns, key)) {
      const [code, obvod] = k.split('|');
      const entry = obecEntry(code);
      const o = model?.obecByCode?.get(code);
      const ward = o?.poslanci?.find((w) => w.obvod === obvod);
      const seats = o && o.poslanci?.length === 1 ? (o.seats || 1) : (o?.seats && o.poslanci?.length ? Math.max(1, Math.round(o.seats / o.poslanci.length)) : 1);
      entry.poslanci.push({ obvod, seats, kandidati: rankCandidates(g.cands, { seats }).map((r) => joinCandidate(r, ward?.kandidati?.find((c) => c.n === r.n))) });
      for (const x of g.okrsky) entry.okrsky.add(x);
    }
    for (const entry of obce.values()) entry.poslanci.sort((a, b) => (int(a.obvod) ?? 0) - (int(b.obvod) ?? 0));
  }
  if (byKind.ucast) {
    const { records, columns } = byKind.ucast;
    for (const [code, g] of aggregateTurnout(records, columns, obecKey(columns))) {
      const entry = obecEntry(code);
      entry.ucast = { registered: g.registered, voted: g.voted, pct: g.registered > 0 ? +((g.voted / g.registered) * 100).toFixed(2) : null };
      for (const k of g.okrsky) entry.okrsky.add(k);
    }
  }
  if (byKind.predseda) {
    const { records, columns } = byKind.predseda;
    const key = (row) => text(row[columns.kraj]) || null;
    for (const [code, g] of aggregateCandidates(records, columns, key)) {
      const entry = krajEntry(code);
      const k = model?.kraje?.find((x) => x.code === code);
      entry.predseda = rankCandidates(g.cands, { seats: 1 }).map((r) => joinCandidate(r, k?.predseda?.find((c) => c.n === r.n)));
      for (const x of g.okrsky) entry.okrsky.add(x);
    }
  }
  if (byKind.zupni) {
    const { records, columns } = byKind.zupni;
    const obvodCol = columns.obvodKraj ?? columns.obvod;
    const key = (row) => {
      const kraj = text(row[columns.kraj]);
      const raw = obvodCol !== undefined ? text(row[obvodCol]) : '';
      if (!raw) return null;
      const code = raw.length >= 3 ? raw : (kraj ? `${kraj}${raw.padStart(2, '0')}` : raw);
      return code;
    };
    for (const [code, g] of aggregateCandidates(records, columns, key)) {
      const krajCode = code[0];
      const entry = krajEntry(krajCode);
      const k = model?.kraje?.find((x) => x.code === krajCode);
      const obvod = k?.obvody?.find((o) => o.code === code);
      const seats = obvod?.seats || 1;
      entry.obvody.push({ code, name: obvod?.name || `Volebný obvod ${code}`, seats, kandidati: rankCandidates(g.cands, { seats }).map((r) => joinCandidate(r, obvod?.kandidati?.find((c) => c.n === r.n))) });
    }
    for (const entry of kraje.values()) entry.obvody.sort((a, b) => a.code.localeCompare(b.code));
  }

  const finish = (entry) => {
    const done = entry.okrsky.size;
    const total = entry.okrskyTotal;
    return { ...entry, okrsky: undefined, okrskyDone: total ? Math.min(done, total) : done, final: Boolean(total) && done >= total };
  };
  const obceOut = new Map([...obce].map(([code, e]) => [code, finish(e)]));
  const krajeOut = new Map([...kraje].map(([code, e]) => [code, finish(e)]));
  const okrskyTotal = (model?.obce || []).reduce((s, o) => s + (o.okrsky || 0), 0) || null;
  let okrskyDone = 0; let registered = 0; let voted = 0; let obceFinal = 0;
  for (const e of obceOut.values()) { okrskyDone += e.okrskyDone; if (e.final) obceFinal += 1; if (e.ucast) { registered += e.ucast.registered; voted += e.ucast.voted; } }
  return {
    generatedAt,
    tables: used,
    available: Object.keys(used).length > 0,
    summary: {
      okrskyDone, okrskyTotal, pct: okrskyTotal ? +((Math.min(okrskyDone, okrskyTotal) / okrskyTotal) * 100).toFixed(1) : null,
      obceWithResults: obceOut.size, obceFinal, registered, voted, turnoutPct: registered > 0 ? +((voted / registered) * 100).toFixed(1) : null,
    },
    obce: obceOut,
    kraje: krajeOut,
  };
}

/** Prehľad pre /prehlad: súhrn + pre každý kraj vedúci kandidát na predsedu a spracovanie. Pure. */
export function resultsOverview(results) {
  if (!results?.available) return null;
  const kraje = [...results.kraje.values()].map((k) => {
    const lead = k.predseda[0] || null;
    return { code: k.code, okrskyDone: k.okrskyDone, okrskyTotal: k.okrskyTotal, final: k.final,
      lead: lead ? { n: lead.n, meno: lead.meno, priezvisko: lead.priezvisko, strany: lead.strany, nezavisly: lead.nezavisly, votes: lead.votes, pct: lead.pct, elected: lead.elected } : null };
  });
  return { generatedAt: new Date(results.generatedAt).toISOString(), tables: results.tables, summary: results.summary, kraje };
}

/** Stav obce pre mapu: 0 bez výsledkov, 1 čiastočné, 2 úplné (všetky okrsky). Pure. */
export function obecMapState(results, code) {
  const e = results?.obce?.get?.(String(code));
  if (!e) return 0;
  return e.final ? 2 : 1;
}
