// src/data/volbyCandidates.js
/**
 * @module volbyCandidates
 * @description Čistý dátový model sekcie VOĹBY 2026 (2026-10-24, vlastník: „potrebujem zatiaľ
 * priebežne kandidátov a do večera by pribudli výsledky, aby som to vedel už propagovať").
 *
 * Vstupy (tabuľky ako objekty podľa hlavičky — src/data/xlsxSheet.js tableByHeader):
 *  - register kandidátov MV SR (4 XLSX, zverejnené 29. 9. 2026): predsedovia krajov, poslanci
 *    krajských zastupiteľstiev, starostovia/primátori, poslanci obecných zastupiteľstiev;
 *  - číselníky ŠÚ SR z volbysr.sk: územné členenie obcí (tab0dd), mestá Bratislava a Košice
 *    (tab0dx), volebné obvody krajov (tab0db) a obce v nich (tab0dc);
 *  - polohy obcí (src/data/local_data/volby/obce-geo.json, GeoNames CC BY 4.0).
 *
 * Spojenie MV SR → ŠÚ SR: kód okresu + meno obce bez diakritiky (MV SR aj ŠÚ SR používajú
 * tie isté kódy okresov, napr. 101 Bratislava I, 201 Dunajská Streda); mesto Bratislava má
 * v registri kód okresu 100 a Košice 800 — to sú celomestské voľby (primátor, mestské
 * zastupiteľstvo) s kódmi miest z tab0dx. Obec, ktorú sa nepodarí spojiť, dostane náhradný kód
 * `x<okres>-<meno>`, aby z hľadania nevypadla.
 *
 * Nič tu nie je výsledok: register je zoznam ZAREGISTROVANÝCH kandidátov; kandidát sa mohol do
 * 22. 10. vzdať a na hlasovacom lístku ostáva. Výsledky rieši volbyResults.js, keď ich ŠÚ SR
 * po 20:00 zverejní. Pure — bez DOM, bez siete, testovateľné v Node.
 */

/** Kraje SR: kód ŠÚ SR, názov kraja, názov samosprávneho kraja (ako v registri MV SR), skratka. */
export const KRAJE = Object.freeze([
  Object.freeze({ code: '1', name: 'Bratislavský kraj', zupa: 'Bratislavský samosprávny kraj', short: 'BA', stem: 'bratislavsk' }),
  Object.freeze({ code: '2', name: 'Trnavský kraj', zupa: 'Trnavský samosprávny kraj', short: 'TT', stem: 'trnavsk' }),
  Object.freeze({ code: '3', name: 'Trenčiansky kraj', zupa: 'Trenčiansky samosprávny kraj', short: 'TN', stem: 'trenciansk' }),
  Object.freeze({ code: '4', name: 'Nitriansky kraj', zupa: 'Nitriansky samosprávny kraj', short: 'NR', stem: 'nitriansk' }),
  Object.freeze({ code: '5', name: 'Žilinský kraj', zupa: 'Žilinský samosprávny kraj', short: 'ZA', stem: 'zilinsk' }),
  Object.freeze({ code: '6', name: 'Banskobystrický kraj', zupa: 'Banskobystrický samosprávny kraj', short: 'BB', stem: 'banskobystrick' }),
  Object.freeze({ code: '7', name: 'Prešovský kraj', zupa: 'Prešovský samosprávny kraj', short: 'PO', stem: 'presovsk' }),
  Object.freeze({ code: '8', name: 'Košický kraj', zupa: 'Košický samosprávny kraj', short: 'KE', stem: 'kosick' }),
]);

/** Celomestské voľby v registri MV SR: kód okresu → kód mesta ŠÚ SR (tab0dx). */
export const CITY_DISTRICT_CODES = Object.freeze({ 100: '582000', 800: '599981' });

/** Koniec hlasovania: sobota 24. 10. 2026 20:00 SELČ (= 18:00 UTC). Dovtedy platí moratórium. */
export const POLLS_CLOSE_MS = Date.UTC(2026, 9, 24, 18, 0, 0);

/** Text bez diakritiky, malé písmená, nepísmená → jedna medzera. Pure. */
export function foldText(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Hodnota poľa záznamu podľa hlavičky bez ohľadu na diakritiku a medzery („Kod okresu" = „Kód okresu"). */
export function field(record, header) {
  if (!record) return null;
  const wanted = foldText(header);
  for (const [key, value] of Object.entries(record)) if (foldText(key) === wanted) return value;
  return null;
}

const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const int = (v) => { const n = Number.parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : null; };

/** Kraj podľa názvu z registra MV SR („Bratislavský samosprávny kraj") alebo kódu; null bez zhody. Pure. */
export function krajByName(name) {
  const key = foldText(name);
  if (!key) return null;
  return KRAJE.find((k) => k.code === key || key.startsWith(k.stem)) || null;
}

/** Kraj podľa kódu okresu (prvá číslica: 101 → Bratislavský). Pure. */
export function krajByOkresCode(okresCode) {
  const first = String(okresCode ?? '').trim()[0];
  return KRAJE.find((k) => k.code === first) || null;
}

/**
 * Jeden kandidát z riadku registra. Register starostov/poslancov obcí má jediný stĺpec „Titul";
 * krajské zoznamy „Titul pred menom" a „Titul za menom" a obec trvalého pobytu.
 * @returns {{n:number|null, meno:string, priezvisko:string, titulPred:string, titulZa:string, vek:number|null,
 *   zamestnanie:string, bydlisko:string, strany:string, nezavisly:boolean}}
 */
export function parseCandidate(record) {
  const strany = text(field(record, 'Názov politickej strany, názvy politických strán tvoriacich koalíciu, nezávislý kandidát')
    || field(record, 'Názov politickej strany'));
  return {
    n: int(field(record, 'Poradové číslo kandidáta')),
    meno: text(field(record, 'Meno')),
    priezvisko: text(field(record, 'Priezvisko')),
    titulPred: text(field(record, 'Titul pred menom') ?? field(record, 'Titul')),
    titulZa: text(field(record, 'Titul za menom')),
    vek: int(field(record, 'Vek')),
    zamestnanie: text(field(record, 'Zamestnanie')),
    bydlisko: text(field(record, 'Obec trvalého pobytu kandidáta') ?? field(record, 'Obec TP kandidáta')),
    strany,
    nezavisly: /nezavisl/.test(foldText(strany)),
  };
}

/** Celé meno s titulmi: „JUDr. Ing. Jozef Ráž" / „Juraj Droba, MBA, MA". Pure. */
export function candidateName(c) {
  const head = [c?.titulPred, c?.meno, c?.priezvisko].map(text).filter(Boolean).join(' ');
  return c?.titulZa ? `${head}, ${text(c.titulZa)}` : head;
}

const byOrder = (a, b) => (a.n ?? 1e9) - (b.n ?? 1e9) || a.priezvisko.localeCompare(b.priezvisko, 'sk');

/** Kľúč spojenia MV SR ↔ ŠÚ SR: kód okresu + meno obce bez diakritiky. */
const obecKey = (okresCode, name) => `${String(okresCode ?? '').trim()}|${foldText(name)}`;

/**
 * Model krajov: predsedovia, volebné obvody s kandidátmi na poslancov, obce obvodov.
 * @param {object} t tabuľky { predseda, zupni, obvodyKraj, obceObvody } (polia záznamov; chýbajúce = [])
 */
export function buildKraje({ predseda = [], zupni = [], obvodyKraj = [], obceObvody = [] } = {}) {
  const kraje = KRAJE.map((k) => ({
    code: k.code, name: k.name, zupa: k.zupa, short: k.short, predseda: [], obvody: new Map(), center: null,
  }));
  const kraj = (name) => { const k = krajByName(name); return k ? kraje[Number(k.code) - 1] : null; };
  const obvod = (k, n, code = null) => {
    const key = String(n ?? '').trim();
    if (!k || !key) return null;
    if (!k.obvody.has(key)) k.obvody.set(key, { code: code || `${k.code}${key.padStart(2, '0')}`, n: int(key), name: `Volebný obvod č. ${key}`, seats: null, okrsky: null, obce: [], kandidati: [] });
    return k.obvody.get(key);
  };
  for (const r of obvodyKraj) {
    const code = text(field(r, 'Kód volebného obvodu'));
    const o = obvod(kraj(field(r, 'Kód kraja')) || kraj(field(r, 'Názov kraja')), code.slice(1).replace(/^0+/, ''), code);
    if (!o) continue;
    o.name = text(field(r, 'Názov volebného obvodu')) || o.name;
    o.seats = int(field(r, 'Počet volených poslancov'));
    o.okrsky = int(field(r, 'Počet volebných okrskov'));
  }
  for (const r of obceObvody) {
    const code = text(field(r, 'Kód volebného obvodu'));
    const o = obvod(kraj(field(r, 'Kód kraja')) || kraj(field(r, 'Názov kraja')), code.slice(1).replace(/^0+/, ''), code);
    if (o) o.obce.push({ code: text(field(r, 'Kód obce')), name: text(field(r, 'Názov obce')) });
  }
  for (const r of predseda) {
    const k = kraj(field(r, 'Kraj'));
    if (k) k.predseda.push(parseCandidate(r));
  }
  for (const r of zupni) {
    const o = obvod(kraj(field(r, 'Kraj')), field(r, 'Volebný obvod'));
    if (o) o.kandidati.push(parseCandidate(r));
  }
  return kraje.map((k) => {
    k.predseda.sort(byOrder);
    const obvody = [...k.obvody.values()].sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
    for (const o of obvody) o.kandidati.sort(byOrder);
    return {
      ...k,
      obvody,
      counts: {
        predseda: k.predseda.length,
        poslanci: obvody.reduce((s, o) => s + o.kandidati.length, 0),
        seats: obvody.reduce((s, o) => s + (o.seats || 0), 0),
        obvody: obvody.length,
        obce: obvody.reduce((s, o) => s + o.obce.length, 0),
      },
    };
  });
}

/**
 * Model obcí: číselník ŠÚ SR + kandidáti MV SR + polohy.
 * @param {object} t { starosta, poslanci, uzemie, mesta, geo } (geo = riadky [kód, lat, lon, presnosť])
 */
export function buildObce({ starosta = [], poslanci = [], uzemie = [], mesta = [], geo = [] } = {}) {
  const geoByCode = new Map(geo.map((row) => [String(row[0]), row]));
  const obce = new Map(); // kód → obec
  const byKey = new Map(); // okres|meno → kód
  const make = (code, name) => ({
    code, name, okresCode: null, okres: '', krajCode: null, kraj: '', uo: '', seats: null, okrsky: null, obvodyCount: null, typ: '',
    lat: null, lon: null, precision: null, starosta: [], poslanci: new Map(),
  });
  for (const r of uzemie) {
    const code = text(field(r, 'Kód obce'));
    if (!code) continue;
    const o = make(code, text(field(r, 'Názov obce')));
    o.okresCode = text(field(r, 'Kód okresu'));
    o.okres = text(field(r, 'Názov okresu'));
    o.krajCode = text(field(r, 'Kód kraja')) || krajByOkresCode(o.okresCode)?.code || null;
    o.kraj = text(field(r, 'Názov kraja')) || KRAJE[Number(o.krajCode) - 1]?.name || '';
    o.uo = text(field(r, 'Názov územného obvodu'));
    o.seats = int(field(r, 'Počet volených poslancov'));
    o.okrsky = int(field(r, 'Počet okrskov'));
    o.obvodyCount = int(field(r, 'Počet volebných obvodov'));
    o.typ = text(field(r, 'Typ volieb'));
    obce.set(code, o);
    byKey.set(obecKey(o.okresCode, o.name), code);
  }
  for (const r of mesta) {
    const code = text(field(r, 'Kód mesta'));
    if (!code) continue;
    const o = make(code, text(field(r, 'Názov mesta')));
    const districtCode = Object.keys(CITY_DISTRICT_CODES).find((k) => CITY_DISTRICT_CODES[k] === code) || null;
    o.okresCode = districtCode;
    o.okres = o.name;
    o.krajCode = krajByOkresCode(districtCode)?.code || null;
    o.kraj = KRAJE[Number(o.krajCode) - 1]?.name || '';
    o.uo = o.name;
    o.seats = int(field(r, 'Počet volených poslancov'));
    o.okrsky = int(field(r, 'Počet okrskov'));
    o.obvodyCount = int(field(r, 'Počet volebných obvodov'));
    o.typ = text(field(r, 'Typ volieb'));
    o.city = true;
    obce.set(code, o);
    if (districtCode) byKey.set(obecKey(districtCode, o.name), code);
  }
  const resolve = (r) => {
    const okresCode = text(field(r, 'Kód okresu'));
    const name = text(field(r, 'Obec'));
    const key = obecKey(okresCode, name);
    let code = byKey.get(key) || CITY_DISTRICT_CODES[okresCode];
    if (code && !obce.has(code)) code = null;
    if (!code) {
      code = `x${okresCode}-${foldText(name).replace(/ /g, '-')}`;
      if (!obce.has(code)) {
        const o = make(code, name);
        o.okresCode = okresCode;
        o.okres = text(field(r, 'Okres'));
        o.krajCode = krajByOkresCode(okresCode)?.code || null;
        o.kraj = KRAJE[Number(o.krajCode) - 1]?.name || '';
        o.unmatched = true;
        obce.set(code, o);
      }
      byKey.set(key, code);
    }
    return obce.get(code);
  };
  for (const r of starosta) resolve(r).starosta.push(parseCandidate(r));
  for (const r of poslanci) {
    const o = resolve(r);
    const obvod = text(field(r, 'Volebný obvod')) || '1';
    if (!o.poslanci.has(obvod)) o.poslanci.set(obvod, []);
    o.poslanci.get(obvod).push(parseCandidate(r));
  }
  const out = [];
  for (const o of obce.values()) {
    const g = geoByCode.get(o.code);
    if (g) { o.lat = Number(g[1]); o.lon = Number(g[2]); o.precision = String(g[3] || 'obec'); }
    o.starosta.sort(byOrder);
    const obvody = [...o.poslanci.entries()].sort((a, b) => (int(a[0]) ?? 0) - (int(b[0]) ?? 0))
      .map(([obvod, kandidati]) => ({ obvod, kandidati: kandidati.sort(byOrder) }));
    out.push({
      ...o,
      poslanci: obvody,
      counts: { starosta: o.starosta.length, poslanci: obvody.reduce((s, x) => s + x.kandidati.length, 0), obvody: obvody.length },
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'sk') || a.code.localeCompare(b.code));
}

/** Stred kraja = priemer polôh jeho obcí so známou polohou (bez stredov okresov). Pure. */
export function krajCenter(obce) {
  const pts = obce.filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon) && o.precision === 'obec');
  if (!pts.length) return null;
  return {
    lat: +(pts.reduce((s, o) => s + o.lat, 0) / pts.length).toFixed(4),
    lon: +(pts.reduce((s, o) => s + o.lon, 0) / pts.length).toFixed(4),
  };
}

/**
 * Celý model zo všetkých tabuliek.
 * @param {object} tables { predseda, zupni, starosta, poslanci, uzemie, mesta, obvodyKraj, obceObvody, geo }
 * @param {{ generatedAt?: number, sources?: object }} [meta]
 */
export function buildModel(tables = {}, { generatedAt = Date.now(), sources = {} } = {}) {
  const kraje = buildKraje(tables);
  const obce = buildObce(tables);
  const obecByCode = new Map(obce.map((o) => [o.code, o]));
  // Obec → volebný obvod kraja (tab0dc), aby karta obce povedala, kde volí krajských poslancov.
  for (const k of kraje) {
    for (const o of k.obvody) for (const member of o.obce) { const obec = obecByCode.get(member.code); if (obec) obec.krajObvod = o.code; }
    k.center = krajCenter(obce.filter((o) => o.krajCode === k.code));
  }
  return { generatedAt, sources, kraje, obce, obecByCode };
}

/** Súhrn pre prehľad: počty kandidátov a obcí. Pure. */
export function summarize(model) {
  const obce = model?.obce || [];
  const kraje = model?.kraje || [];
  return {
    obce: obce.filter((o) => !o.unmatched).length,
    obceNezaradene: obce.filter((o) => o.unmatched).length,
    starosta: obce.reduce((s, o) => s + o.counts.starosta, 0),
    poslanci: obce.reduce((s, o) => s + o.counts.poslanci, 0),
    predseda: kraje.reduce((s, k) => s + k.counts.predseda, 0),
    zupni: kraje.reduce((s, k) => s + k.counts.poslanci, 0),
  };
}

/** Ľahký riadok obce pre zoznamy a hľadanie (bez kandidátov). Pure. */
export function obecSummary(o) {
  return {
    code: o.code, name: o.name, okres: o.okres, okresCode: o.okresCode, kraj: o.kraj, krajCode: o.krajCode,
    seats: o.seats, okrsky: o.okrsky, city: Boolean(o.city), unmatched: Boolean(o.unmatched),
    lat: o.lat, lon: o.lon, precision: o.precision,
    starosta: o.counts.starosta, poslanci: o.counts.poslanci,
  };
}

/**
 * Hľadanie obce: začiatok mena vyhráva nad výskytom v mene, potom viac mandátov (väčšie mesto)
 * a abeceda; číselný dopyt = kód obce. „Bratislava" nájde mesto aj mestské časti.
 * @param {object} model
 * @param {string} query
 * @param {number} [limit]
 */
export function searchObce(model, query, limit = 25) {
  const q = foldText(query);
  if (!q) return [];
  if (/^\d{6}$/.test(q)) { const o = model.obecByCode.get(q); return o ? [obecSummary(o)] : []; }
  const scored = [];
  for (const o of model.obce) {
    const name = foldText(o.name);
    const bare = name.replace(/^(bratislava|kosice) /, '');
    let score = 0;
    if (name === q || bare === q) score = 4;
    else if (name.startsWith(q) || bare.startsWith(q)) score = 3;
    else if (name.split(' ').some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 1;
    if (score) scored.push({ score, o });
  }
  scored.sort((a, b) => b.score - a.score || (b.o.seats || 0) - (a.o.seats || 0) || a.o.name.localeCompare(b.o.name, 'sk'));
  return scored.slice(0, Math.max(1, Math.min(100, limit))).map((x) => obecSummary(x.o));
}

/** Najväčšie mestá podľa počtu volených poslancov (celé mestá, nie mestské časti). Pure. */
export function topMesta(model, limit = 12) {
  return model.obce
    .filter((o) => !o.unmatched && !/^(Bratislava|Košice) - /.test(o.name))
    .sort((a, b) => (b.seats || 0) - (a.seats || 0) || (b.okrsky || 0) - (a.okrsky || 0) || a.name.localeCompare(b.name, 'sk'))
    .slice(0, limit)
    .map(obecSummary);
}

/** Fáza volebného dňa: pred zatvorením miestností (moratórium) · sčítavanie · (konečné rieši výsledky). Pure. */
export function electionPhase(nowMs = Date.now(), { closeMs = POLLS_CLOSE_MS } = {}) {
  return nowMs < closeMs ? 'before' : 'counting';
}

/** Detail kraja pre API (predsedovia + obvody s kandidátmi). Pure. */
export function krajDetail(model, code) {
  const k = model.kraje.find((x) => x.code === String(code));
  if (!k) return null;
  return {
    code: k.code, name: k.name, zupa: k.zupa, short: k.short, center: k.center, counts: k.counts,
    predseda: k.predseda,
    obvody: k.obvody.map((o) => ({ code: o.code, n: o.n, name: o.name, seats: o.seats, okrsky: o.okrsky, obce: o.obce, kandidati: o.kandidati })),
  };
}

/** Detail obce pre API. Pure. */
export function obecDetail(model, code) {
  const o = model.obecByCode.get(String(code));
  if (!o) return null;
  const kraj = model.kraje.find((k) => k.code === o.krajCode) || null;
  const krajObvod = kraj?.obvody.find((x) => x.code === o.krajObvod) || null;
  return {
    ...obecSummary(o), uo: o.uo, typ: o.typ, obvodyCount: o.obvodyCount,
    krajObvod: krajObvod ? { code: krajObvod.code, name: krajObvod.name, seats: krajObvod.seats, kandidati: krajObvod.kandidati.length } : null,
    kandidati: { starosta: o.starosta, poslanci: o.poslanci },
  };
}

/** Prehľad pre panel: fáza, súhrn, kraje (bez kandidátov), najväčšie mestá. Pure. */
export function overview(model, { nowMs = Date.now() } = {}) {
  return {
    phase: electionPhase(nowMs),
    pollsCloseAt: new Date(POLLS_CLOSE_MS).toISOString(),
    generatedAt: new Date(model.generatedAt).toISOString(),
    sources: model.sources,
    counts: summarize(model),
    kraje: model.kraje.map((k) => ({ code: k.code, name: k.name, zupa: k.zupa, short: k.short, center: k.center, counts: k.counts })),
    mesta: topMesta(model),
  };
}
