// src/data/pipelineFlowLinks.js
/**
 * @module pipelineFlowLinks
 * @description Väzba pomenovaných potrubí zo snímku OSM na hraničné body
 * ENTSOG, ktoré OKO už sleduje (`GAS_FLOW_POINTS` v gasFlows.js, proxy
 * `/api/gas/flows`, cache 1 h). Etapa 3 (2026-09-19): hover karta rúry má
 * ukázať „koľko tečie a kam", a jediné živé číslo, ktoré o plynovode verejne
 * existuje, je fyzický tok na hraničnom bode (plynárenský deň D−1). ENTSOG
 * zverejňuje toky ZA BODY, nie za rúry, preto je toto ručná tabuľka a nie
 * odvodenie z geometrie: každý riadok tvrdí, že daná rúra na danom bode
 * fyzicky končí alebo začína. Bod, ktorý v katalógu nie je (Mallnow pre
 * Yamal, Arnoldstein pre TAG, Easington pre Langeled…), sem nepatrí — karta
 * potom povie „bez živého toku", nie číslo z iného miesta.
 *
 * Ropa tu zámerne nie je: živé toky ropovodov verejné nie sú (Transneft, MERO,
 * Transpetrol, CPC dávajú nanajvýš mesačné súhrny). Karta to hovorí slovom.
 *
 * Modul je čistý (bez Cesia, DOM aj i18n) — testuje sa v Node.
 */
import { GAS_FLOW_POINTS, formatGwhDay, mcmPerDay } from './gasFlows.js';
import { formatDateLabel } from './gasPrices.js';

/**
 * Pravidlá: `name` sa skúša proti name, name:en a ref; `operator` proti
 * prevádzkovateľovi. Zhody sa ZJEDNOCUJÚ (Nord Stream 1 → OPAL aj NEL; „OPAL /
 * EUGAL" → OPAL), poradie je poradie na karte. Každé id musí existovať
 * v GAS_FLOW_POINTS — kontroluje sa pri načítaní modulu, nie až v teste.
 * @type {ReadonlyArray<{name?: RegExp, operator?: RegExp, ids: string[]}>}
 */
export const PIPELINE_FLOW_LINKS = Object.freeze([
  // Nord Stream 1 pristáva v Lubmine a pokračuje ako OPAL a NEL; Nord Stream 2
  // nikdy nespustený → naschvál mimo (negatívny lookahead).
  // Pozor: `\w` v JS regexe bez `u` je len ASCII — na cyriliku treba rozsah.
  { name: /Nord ?Stream(?!\s*2)|Северн[а-яё]* поток[а-яё]*(?!\s*2)/i, ids: ['greifswald-opal', 'greifswald-nel'] },
  { name: /\bOPAL\b/, ids: ['greifswald-opal'] },
  { name: /Nordeuropäische Erdgasleitung|\bNEL\b/, ids: ['greifswald-nel'] },
  { name: /TurkStream|Türk Akımı|Balkan Stream/i, ids: ['strandzha2'] },
  { name: /Trans.?Balkan|Транс.?Балкан/i, ids: ['strandzha1', 'isaccea-in'] },
  { name: /Isaccea/i, ids: ['isaccea-in', 'isaccea-out'] },
  // TANAP končí presne tam, kde TAP začína — Kipoi na grécko-tureckej hranici.
  { name: /Trans Adriatic Pipeline|^TAP$|TANAP/i, ids: ['kipoi'] },
  { name: /Franpipe/i, ids: ['dunkerque'] },
  { name: /Zeepipe/i, ids: ['zeebrugge-zpt'] },
  { name: /^Interconnector\b/i, ids: ['zeebrugge-izt'] },
  { name: /Europipe/i, ids: ['dornum', 'emden'] },
  { name: /NETRA|Norddeutsche Erdgas-Transversale/i, ids: ['dornum'] },
  { name: /\bBBL\b|Balgzand Bacton/i, ids: ['bacton-bbl'] },
  // Nórsky plyn pre Baltic Pipe vstupuje do Dánska v Nybro (North Sea Entry).
  { name: /Baltic Pipe/i, ids: ['nybro'] },
  { name: /Medgaz/i, ids: ['almeria'] },
  { name: /GreenStream/i, ids: ['gela'] },
  { name: /Pedro Dur|بيدرو دوران|Maghreb/i, ids: ['tarifa-out'] },
  // Ukrajinský koridor: vstup Sudža (RU→UA), výstup Veľké Kapušany (UA→SK) —
  // od 1. 1. 2025 nula, a nula je poctivá odpoveď.
  { name: /Уренгой\s*[—–-]\s*(Помар|Ужгород)|Urengoy|Долина-Ужгород|Uzhhorod/i, ids: ['sudzha', 'kapusany-in'] },
  { name: /Союз|СОЮЗ|Soyuz|Прогресс/i, ids: ['kapusany-in'] },
  { name: /Prepojovací plynovod Poľsko – Slovensko|Poland.?Slovakia|Polska.?Słowacja/i, ids: ['vyrava-in', 'vyrava-out'] },
  { name: /Narva/i, ids: ['narva'] },
  { name: /Bereg/i, ids: ['bereg-in', 'bereg-out'] },
  // Prevádzkovateľ = rúra: sústava eustreamu vystupuje v Baumgartene a Lanžhote.
  { operator: /eustream/i, ids: ['baumgarten-out', 'lanzhot-out'] },
]);

const POINT_BY_ID = new Map(GAS_FLOW_POINTS.map((p) => [p.id, p]));
for (const link of PIPELINE_FLOW_LINKS) {
  for (const id of link.ids) {
    if (!POINT_BY_ID.has(id)) throw new Error(`pipelineFlowLinks: neznámy bod ENTSOG '${id}'`);
  }
}

/** Najviac bodov na jednej karte — ďalšie by už boli šum, nie odpoveď. */
export const MAX_FLOW_POINTS_PER_PIPELINE = 4;

/**
 * Id bodov ENTSOG pre úsek (zjednotenie zhôd, bez duplikátov). Ropa vracia
 * vždy prázdne pole — pravidlá sú len plynové a substance to spoľahlivo odlíši.
 * @param {object} properties vlastnosti prvku zo snímku
 * @returns {string[]}
 */
export function pipelineFlowPointIds(properties = {}) {
  if (/^(oil|crude_oil|petroleum)$/i.test(String(properties?.substance || ''))) return [];
  const names = [properties?.name, properties?.nameEn, properties?.ref].filter(Boolean).map(String);
  const operator = properties?.operator ? String(properties.operator) : '';
  const ids = [];
  for (const link of PIPELINE_FLOW_LINKS) {
    const hit = (link.name && names.some((n) => link.name.test(n))) || (link.operator && operator && link.operator.test(operator));
    if (!hit) continue;
    for (const id of link.ids) if (!ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_FLOW_POINTS_PER_PIPELINE) break;
  }
  return ids.slice(0, MAX_FLOW_POINTS_PER_PIPELINE);
}

/**
 * Riadky živého toku pre kartu z odpovede proxy `/api/gas/flows`
 * (`buildFlowsPayload`: `points[]` s `latest`, `avg7`, `noteKey`).
 * @param {{points?: any[], citation?: string}|null} payload
 * @param {string[]} ids
 * @param {{lang?: string, translate?: (k: string, v?: object) => string}} [o]
 * @returns {{rows: Array<object>, citation: string}}
 */
export function pipelineFlowRows(payload, ids, { lang = 'sk', translate = (k) => k } = {}) {
  const byId = new Map((payload?.points || []).map((p) => [p.id, p]));
  const rows = [];
  for (const id of ids) {
    const p = byId.get(id) || POINT_BY_ID.get(id);
    if (!p) continue;
    const latest = p.latest || null;
    const gwh = Number.isFinite(latest?.gwh) ? latest.gwh : null;
    const level = gwh === null ? 'nodata' : (gwh >= 0.05 ? 'flow' : 'zero');
    const mcm = level === 'flow' ? mcmPerDay(gwh) : null;
    rows.push({
      id,
      name: p.name,
      route: `${p.from} → ${p.to}`,
      dir: p.dir,
      level,
      gwh,
      text: level === 'nodata' ? translate('gas.flow-nodata') : formatGwhDay(gwh, lang),
      mcmText: mcm !== null ? translate('gas.flow-mcm', { v: new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { maximumFractionDigits: mcm >= 10 ? 0 : 1 }).format(mcm) }) : '',
      dateText: latest?.date ? formatDateLabel(latest.date, lang, { year: false }) : '',
      statusText: latest?.status ? translate(/^prov/i.test(latest.status) ? 'gas.flow-provisional' : 'gas.flow-confirmed') : '',
      avg7Text: Number.isFinite(p.avg7) && p.avg7 >= 0.05 ? translate('gas.flow-avg7', { v: formatGwhDay(p.avg7, lang) }) : '',
      // Posledných 14 plynárenských dní na sparkline karty (ako karta TOKY).
      spark: (p.series || []).slice(-14).map((r) => (Number.isFinite(r?.gwh) ? r.gwh : null)),
      // Vlajky: `from`/`to` sú ISO2 štátov; „zásobník" a podobné nie sú štát.
      fromIso: /^[A-Z]{2}$/.test(String(p.from || '')) ? p.from : null,
      toIso: /^[A-Z]{2}$/.test(String(p.to || '')) ? p.to : null,
      note: p.noteKey ? translate(p.noteKey) : '',
    });
  }
  return { rows, citation: payload?.citation ? String(payload.citation) : '' };
}
