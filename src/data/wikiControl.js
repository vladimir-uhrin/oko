// src/data/wikiControl.js
/**
 * @module wikiControl
 * @description KONTROLA SÍDIEL z Lua modulov Wikipédie — spoločné jadro (etapa 2 modulu
 * BLÍZKY VÝCHOD, 2026-09-26; plán docs/drafts/blizky-vychod-plan.md kap. 5–6). Zovšeobecňuje
 * `ukraineControl.js` (ktorý je odteraz tenký obal nad týmto modulom s konfiguráciou
 * `UKRAINE_CONTROL_CONFIG`): parser Lua tabuliek `{ lat, long, mark, marksize, label, link }`,
 * mapovanie ikona → strana/druh podľa KONFIGURÁCIE MODULU (každý modul má vlastnú legendu —
 * tá istá modrá bodka je Izrael na Blízkom východe, Ukrajina pri Dnepri a kmeňové sily
 * v Jemene), zlúčenie viacerých zdrojov, súhrn, kódy a odvodený raster zón pre N strán.
 *
 * Poctivosť: každá konfigurácia nesie názov modulu, atribúciu a licenciu (CC BY-SA 4.0,
 * Wikipedia contributors); neznáme ikony sa POČÍTAJÚ (`unmapped`), nikdy sa ticho nezaradia
 * k strane; skryté obrázky podkladu (cestné prekryvy, vložené minimapy, marksize ≥ 40) sa
 * počítajú ako `skipped`. Legendy štyroch modulov Blízkeho východu boli overené 24. 9. 2026
 * proti `containerArgs.caption` (= vykreslená legenda šablóny) a `/doc` stránkam; miesta,
 * kde legenda hovorí inak než farba, sú v komentároch pri pravidlách.
 *
 * Etická čiara (plán kap. 4): len sídla a objekty (letiská, priehrady, prechody), nikdy
 * jednotky. Čistý modul — bez Cesia a DOM.
 */

/** Hodnota poľa pravidla: strana/tlak sa odvodí z farebného slova v názve súboru. */
export const FROM_COLOUR = '@colour';
/** Hodnota `between`: dvojica strán z dvoch farebných slov zachytených regexom pravidla. */
export const FROM_COLOURS = '@colours';
/** Značka s `marksize` od tejto hodnoty je obrázok podkladu (cestná sieť 2600/3138, minimapa 45). */
export const OVERLAY_MARKSIZE = 40;

const KM_LAT = 111.32;

/**
 * @typedef {object} WikiControlSide
 * @property {string} id identifikátor strany (kľúč v súhrne, kódoch, i18n `<prefix>.<id>`)
 * @property {string} label anglický popis podľa legendy modulu
 * @property {string} css farba strany (hex)
 * @property {boolean} fill či raster zón strany dostáva výplň (Ukrajina: RU áno, UA nie;
 *   moduly s 3+ stranami: všetky áno = neutrálne tónovanie)
 */

/**
 * @typedef {object} WikiControlIconRule Pravidlo v PORADÍ (prvé zhodné vyhrá) nad
 *   NORMALIZOVANÝM názvom súboru (`normalizeIconName`).
 * @property {RegExp|string} match regex (bez príznaku g) alebo presný názov
 * @property {number} [sizeMax] pravidlo platí LEN pre značku so známym `marksize` ≤ tejto hodnoty
 *   (nosiče popisov s marksize 1 — bez veľkosti alebo väčšia ide ďalej na ďalšie pravidlá)
 * @property {boolean} [skip] obrázok podkladu → nepočíta sa ako bod
 * @property {string|null} [side] id strany, 'contested', 'mixed', 'none', null alebo FROM_COLOUR
 * @property {string} [sideDefault] strana, keď FROM_COLOUR nič nenájde (Ukrajina: 'none')
 * @property {string} [kind] settlement | rural | base | hill | airport | heliport | port |
 *   oilgas | industry | dam | border-crossing | other (Ukrajina drží aj airbase/hydro/border)
 * @property {string} [pressure] strana, ktorá sídlo tlačí/obliehá (alebo FROM_COLOUR)
 * @property {boolean} [direction] smer tlaku z 1. skupiny regexu (oblúky NN…NW)
 * @property {string[]|string} [between] dvojica strán sporného/zmiešaného sídla alebo FROM_COLOURS
 * @property {Function} [resolve] ({ colour, norm, raw, m, colourSide }) → stav | null
 *   (pre logiku, ktorú deklaratívne polia nevyjadria — napr. dvojstranná „protistrana")
 */

/**
 * @typedef {object} WikiControlConfig
 * @property {string} id
 * @property {{id:string,title:string,since?:string}[]} titles moduly Wikipédie (id = kľúč v `revisions`)
 * @property {string} attribution
 * @property {'CC BY-SA 4.0'} license
 * @property {{west:number,south:number,east:number,north:number}} bbox rámec rastra
 * @property {number} cellDeg
 * @property {number} [overlayMarksize] značka s marksize ≥ tejto hodnoty = obrázok podkladu, preskočí sa
 *   (predvolene OVERLAY_MARKSIZE = 40; Infinity = nikdy — únik pre bajtovo zhodný starý Ukrajinský výstup)
 * @property {number} maxKm ďalej od každého sídla = bez údaja
 * @property {number} bandKm pás, kde sú dve rôzne strany rovnako blízko
 * @property {number} contestedKm polomer okolo sporného/zmiešaného sídla
 * @property {WikiControlSide[]} sides
 * @property {string} contestedCss
 * @property {string} mixedCss
 * @property {string} noneCss
 * @property {{re:RegExp,side:string|null}[]} colours farebné slovo → strana (v PORADÍ; `side: null`
 *   = známa farba bez strany v tomto module → ikona ostane neznáma)
 * @property {boolean} [fallbackByColour] neznáma ikona so známou farbou → { side, kind: 'other' }
 *   (len Ukrajina, dnešné správanie; pre nové moduly vždy false = neznáme sa počítajú)
 * @property {'merge'} [colocated] 'merge' = prstenec/oblúk na súradniciach bodky doplní `pressure`
 *   namiesto prepisu a infraštruktúra nekoliduje so sídlom (kľúč nesie druh)
 * @property {Record<string,string>} defaultMk skratky `mk` (záloha)
 * @property {Record<string,string>} marksizePop veľkosť značky → trieda populácie
 * @property {(size:number)=>string} [popFallback] trieda pre veľkosť mimo tabuľky
 * @property {number} staleDays prah „zastarané" pre vek revízie
 * @property {string} i18nPrefix
 * @property {WikiControlIconRule[]} icons
 * @property {string[]} [alsoModules] id modulov, ktoré Wikipédia kreslí spolu (secondaryModules) — len údaj
 */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !(value instanceof RegExp) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Normalizovaný názov súboru ikony: orezané okraje (v IP module je „ Location dot blue.svg"),
 * podčiarkovníky = medzery (`Dot_yellow_ff4.svg`), malé písmená (MediaWiki má prvé písmeno
 * bez rozlíšenia veľkosti: `map-arcEE` vs `Map-arcSS`, `gota01` vs `Gota01`), viacnásobné
 * medzery zlúčené a presmerovanie Commons `Location dot dark red.svg` → `darkred` — aj so
 * spojovníkom vnútri zložených názvov (`Map-ctl2-blue+dark-red.svg` → `blue+darkred`), inak by
 * druhé farebné slovo dvojice padlo na /red/ (Hizballáh) namiesto tmavočervenej (Sýria). Pure.
 */
export function normalizeIconName(name) {
  return String(name ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/dark[ -]red/g, 'darkred');
}

/** Tabuľka skratiek `mk = { key = "file" }` z Lua zdroja nad zálohou `defaults`. Pure. */
export function parseMkTable(src, defaults = UKRAINE_DEFAULT_MK) {
  const m = /\bmk\s*=\s*\{([\s\S]*?)\}/.exec(String(src || ''));
  const out = { ...(defaults || {}) };
  if (!m) return out;
  for (const kv of m[1].matchAll(/(\w+)\s*=\s*"([^"]+)"/g)) out[kv[1]] = kv[2];
  return out;
}

/**
 * `[[Lyman, Ukraine|Lyman]]` → „Lyman"; `[[Bakhmut]]` → „Bakhmut"; bez odkazu = text bez `'''`.
 * Entity `&nbsp;`/`&amp;` sa dekódujú, HTML značky sa odstránia a biele znaky zlúčia — sýrsky
 * modul píše dvojjazyčné mená `Ras al-Ayn&nbsp; <small>(Serêkaniyê)</small>` a meno bodu ide
 * do archívu aj na kartu, kde by surové `<small>` bolo text (alebo cez innerHTML značka).
 * Prázdny výsledok = null. Pure.
 */
export function plainLabel(label) {
  const s = String(label ?? '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const m = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(s);
  const text = m ? (m[2] || m[1]) : s.replace(/'''?/g, '');
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

/**
 * Odstráni Lua komentáre `-- …` (po koniec riadka) a `--[[ … ]]` / `--[=[ … ]=]` (blokové),
 * ale nie vnútri reťazcov `"…"`, `'…'` ani dlhých zátvoriek `[[…]]` / `[=[…]=]` (popisy
 * legendy v `containerArgs.caption`, `secondaryModules`). Zakomentované značky (IP modul:
 * 5 egyptských žltých bodiek + riadok šablóny s XX.XXXXX; Sýria 33; Libanon 10) tak
 * zmiznú pred hľadaním záznamov. Pure.
 */
export function stripLuaComments(src) {
  const s = String(src || '');
  const n = s.length;
  const out = [];
  let i = 0;
  let start = 0;
  const longClose = (from, eqs) => {
    const close = `]${'='.repeat(eqs)}]`;
    const j = s.indexOf(close, from);
    return j < 0 ? n : j + close.length;
  };
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 34 || c === 39) { // " alebo ' — preskoč reťazec (aj s únikovými znakmi)
      let j = i + 1;
      while (j < n) {
        const d = s.charCodeAt(j);
        if (d === 92) { j += 2; continue; }
        if (d === c || d === 10) break;
        j += 1;
      }
      i = Math.min(n, j + 1);
      continue;
    }
    if (c === 91) { // [ — dlhá zátvorka?
      const m = /^\[(=*)\[/.exec(s.slice(i, i + 8));
      i = m ? longClose(i + m[0].length, m[1].length) : i + 1;
      continue;
    }
    if (c === 45 && s.charCodeAt(i + 1) === 45) { // --
      out.push(s.slice(start, i));
      const m = /^--\[(=*)\[/.exec(s.slice(i, i + 10));
      if (m) {
        i = longClose(i + m[0].length, m[1].length);
      } else {
        const nl = s.indexOf('\n', i);
        i = nl < 0 ? n : nl;
      }
      start = i;
      continue;
    }
    i += 1;
  }
  out.push(s.slice(start));
  return out.join('');
}

function colourSideOf(token, config) {
  const t = String(token || '');
  for (const c of config.colours || []) if (c.re.test(t)) return c.side;
  return null;
}

function matchRule(match, norm) {
  if (match instanceof RegExp) return match.exec(norm);
  return norm === normalizeIconName(match) ? [norm] : null;
}

/**
 * Ikona → stav podľa konfigurácie modulu: `{ side, kind, pressure?, direction?, between? }`,
 * `{ skip: true }` pre obrázky podkladu, `null` = neznáma ikona (volajúci ju POČÍTA).
 * Pravidlá idú v poradí; polia `side`/`pressure` = FROM_COLOUR sa odvodia z farebného slova
 * (tabuľka `config.colours`, prvá zhoda) — keď farba nemá stranu a pravidlo nemá
 * `sideDefault`, ikona je neznáma (nie tichá strana). Výstup nesie len prítomné polia
 * (Ukrajina: bodky `{side, kind}`, oblúky `{side, kind, pressure, direction}`). Voliteľný
 * kontext `{ size }` (marksize značky) rozhoduje pravidlá so `sizeMax` — bez neho sa také
 * pravidlá preskočia, takže dvojargumentové volanie ostáva platné. Pure.
 * @param {string} icon
 * @param {WikiControlConfig} config
 * @param {{size?: number|null}} [ctx]
 */
export function wikiMarkStatus(icon, config, { size = null } = {}) {
  const raw = String(icon || '');
  const norm = normalizeIconName(raw);
  if (!norm) return null;
  const colourSide = (token) => colourSideOf(token, config);
  const colour = colourSide(norm);
  for (const rule of config.icons || []) {
    if (rule.sizeMax !== undefined && !(Number.isFinite(size) && size <= rule.sizeMax)) continue;
    const m = matchRule(rule.match, norm);
    if (!m) continue;
    if (rule.skip) return { skip: true };
    if (typeof rule.resolve === 'function') return rule.resolve({ colour, norm, raw, m, colourSide }) ?? null;
    let side;
    if (rule.side === FROM_COLOUR) {
      side = colour ?? rule.sideDefault ?? null;
      if (side === null) return null;
    } else side = rule.side === undefined ? null : rule.side;
    const out = { side, kind: rule.kind || 'other' };
    if (rule.pressure !== undefined) {
      const p = rule.pressure === FROM_COLOUR ? colour : rule.pressure;
      if (rule.pressure === FROM_COLOUR && p === null) return null;
      out.pressure = p;
    }
    if (rule.direction) out.direction = (m[1] || '').toUpperCase() || null;
    if (rule.between !== undefined) {
      const pair = rule.between === FROM_COLOURS ? [colourSide(m[1] || ''), colourSide(m[2] || '')] : rule.between;
      if (Array.isArray(pair) && pair.length === 2 && pair.every(Boolean)) out.between = [pair[0], pair[1]];
    }
    return out;
  }
  if (config.fallbackByColour && colour) return { side: colour, kind: 'other' };
  return null;
}

const ENTRY_RE = /\{([^{}]*\blat\s*=\s*(?:"[^"]*"|'[^']*'|-?\d)[^{}]*)\}/g;
const VALUE_RE = '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|mk\\.(\\w+)|lp\\.(\\w+)|(-?\\d+(?:\\.\\d+)?))';
const FIELD_RE = Object.freeze(Object.fromEntries(['lat', 'long', 'mark', 'marksize', 'label', 'link'].map((k) => [k, new RegExp(`\\b${k}${VALUE_RE}`)])));

function fieldOf(body, name, table) {
  const r = FIELD_RE[name].exec(body);
  if (!r) return null;
  if (r[3] !== undefined) return table[r[3]] || null;
  return r[1] ?? r[2] ?? r[4] ?? r[5] ?? null;
}

function popClass(size, config) {
  if (!size) return null;
  const table = config.marksizePop || {};
  if (table[size]) return table[size];
  if (typeof config.popFallback === 'function') return config.popFallback(size);
  let best = null;
  let bestKey = -Infinity;
  for (const k of Object.keys(table)) {
    const n = Number(k);
    if (n <= size && n > bestKey) { bestKey = n; best = table[k]; }
  }
  return best || 'small';
}

/**
 * Lua zdroj modulu → `{ points, unmapped, skipped, sideless, invalid }`. Záznamy bodov majú
 * tvar `{ lat, lon, icon, side, kind, pressure, direction, size, pop, name, link }` (+ `between`
 * len pri sporných/zmiešaných s odvodenou dvojicou). Prijíma obe syntaxe: `lat = "48.99"`
 * (Ukrajina, IP, Jemen, Libanon) aj `{lat= 34.212, long= 38.8, mark= "…", marksize=4}`
 * (Sýria; neuvozovkované čísla, `mark=` bez medzery, tabulátor pred `=`), skratky `mk.X`,
 * viac záznamov na riadku; komentáre `--` odstráni pred hľadaním. `unmapped` = neznáme ikony
 * podľa (orezaného) názvu s počtom; `skipped` = obrázky podkladu (pravidlo skip alebo
 * marksize ≥ 40); `sideless` = známe ikony bez strany (Ukrajina: hraničné priechody);
 * `invalid` = záznamy bez čitateľných súradníc. Pure.
 * @param {string} src
 * @param {WikiControlConfig} config
 * @param {{mk?:Record<string,string>|null}} [opts]
 */
export function wikiParseLuaMarks(src, config, { mk = null } = {}) {
  const text = stripLuaComments(src);
  const table = mk || parseMkTable(text, config.defaultMk);
  const overlayMarksize = config.overlayMarksize ?? OVERLAY_MARKSIZE;
  const points = [];
  const unmapped = {};
  let skipped = 0;
  let sideless = 0;
  let invalid = 0;
  for (const m of text.matchAll(ENTRY_RE)) {
    const body = m[1];
    const lat = Number(fieldOf(body, 'lat', table));
    const lon = Number(fieldOf(body, 'long', table));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { invalid += 1; continue; }
    const icon = fieldOf(body, 'mark', table);
    const size = Number(fieldOf(body, 'marksize', table)) || null;
    if (size !== null && size >= overlayMarksize) { skipped += 1; continue; }
    const status = wikiMarkStatus(icon, config, { size });
    if (!status) {
      const key = String(icon ?? '').trim() || '(bez ikony)';
      unmapped[key] = (unmapped[key] || 0) + 1;
      continue;
    }
    if (status.skip) { skipped += 1; continue; }
    if (!status.side) { sideless += 1; continue; }
    const name = plainLabel(fieldOf(body, 'label', table)) || plainLabel(fieldOf(body, 'link', table)) || null;
    const rec = {
      lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, icon, side: status.side, kind: status.kind,
      pressure: status.pressure || null, direction: status.direction || null, size, pop: popClass(size, config), name, link: fieldOf(body, 'link', table) || null,
    };
    if (status.between) rec.between = status.between;
    points.push(rec);
  }
  return { points, unmapped, skipped, sideless, invalid };
}

const isSettlementKind = (kind) => kind === 'settlement' || kind === 'rural';
const isPressureMark = (p) => p.side === 'contested' && !!p.pressure;

/** Prstenec/oblúk (tlak) na súradniciach bodky dopĺňa `pressure`/`direction`, kontrolu drží bodka. */
function mergeColocated(prev, next) {
  const prevRing = isPressureMark(prev);
  const nextRing = isPressureMark(next);
  if (nextRing && !prevRing) return { ...prev, pressure: next.pressure, direction: next.direction ?? prev.direction };
  if (prevRing && !nextRing) return { ...next, pressure: prev.pressure, direction: prev.direction ?? next.direction };
  return next;
}

/**
 * Viac zdrojov (modulov) → jeden zoznam bodov. Skratky `mk` sa zlúčia zo všetkých zdrojov
 * (neskorší vyhráva) nad `config.defaultMk`, alebo príde hotová tabuľka `opts.mk` (Ukrajina:
 * len z prehľadového modulu ako doteraz). Duplicitné súradnice (na 3 desatinné) — neskorší
 * zdroj vyhráva; každý bod nesie `module` = id zdroja. Pri `config.colocated === 'merge'`
 * (Blízky východ) infraštruktúra nekoliduje so sídlom (kľúč nesie druh) a prstenec/oblúk
 * na tých istých súradniciach nenahradí bodku, len jej doplní tlak (Rmaich: fialová bodka
 * miestnych + modrý kruh Izraela = sídlo miestnych obliehané Izraelom). `revisions` = objekty
 * `source.revision` podľa id (priechod pre archív). Pure.
 * @param {{id:string,src:string,revision?:object}[]} sources
 * @param {WikiControlConfig} config
 * @param {{mk?:Record<string,string>|null}} [opts]
 */
export function wikiControlPoints(sources, config, { mk = null } = {}) {
  const list = (sources || []).filter(Boolean);
  const table = mk || list.reduce((acc, s) => Object.assign(acc, parseMkTable(s.src || '', {})), { ...(config.defaultMk || {}) });
  const merge = config.colocated === 'merge';
  const byKey = new Map();
  const unmapped = {};
  let skipped = 0;
  let sideless = 0;
  let invalid = 0;
  for (const s of list) {
    const r = wikiParseLuaMarks(s.src || '', config, { mk: table });
    skipped += r.skipped; sideless += r.sideless; invalid += r.invalid;
    for (const [k, v] of Object.entries(r.unmapped)) unmapped[k] = (unmapped[k] || 0) + v;
    for (const p of r.points) {
      const rec = { ...p, module: s.id };
      const base = `${rec.lat.toFixed(3)},${rec.lon.toFixed(3)}`;
      const key = merge && !isSettlementKind(rec.kind) ? `${base}:${rec.kind}` : base;
      const prev = byKey.get(key);
      byKey.set(key, merge && prev ? mergeColocated(prev, rec) : rec);
    }
  }
  const revisions = Object.fromEntries(list.filter((s) => s.revision).map((s) => [s.id, s.revision]));
  return { points: [...byKey.values()], unmapped, skipped, sideless, invalid, revisions };
}

/**
 * Počty bodov: `settlements` (druh settlement/rural) podľa strán v poradí konfigurácie +
 * contested/mixed/none, `infrastructure` (ostatné druhy) podľa strán; `unmapped` sa
 * pripojí, keď ho volajúci dá (z parsera). Pure.
 */
export function wikiControlSummary(points, config, { unmapped = null } = {}) {
  const settlements = {};
  const infrastructure = {};
  for (const s of config.sides) { settlements[s.id] = 0; infrastructure[s.id] = 0; }
  settlements.contested = 0; settlements.mixed = 0; settlements.none = 0;
  const out = { total: 0, settlements, infrastructure };
  for (const p of points || []) {
    out.total += 1;
    if (isSettlementKind(p.kind)) { if (Object.hasOwn(settlements, p.side)) settlements[p.side] += 1; } else if (Object.hasOwn(infrastructure, p.side)) infrastructure[p.side] += 1;
  }
  if (unmapped) out.unmapped = { ...unmapped };
  return out;
}

const CODES_CACHE = new WeakMap();
/** Kódy buniek rastra: none 0, strany v poradí konfigurácie 1…N, contested N+1 (Ukrajina: ua 1, ru 2, contested 3). */
export function wikiControlCodes(config) {
  let codes = CODES_CACHE.get(config);
  if (!codes) {
    codes = { none: 0 };
    config.sides.forEach((s, i) => { codes[s.id] = i + 1; });
    codes.contested = config.sides.length + 1;
    codes = Object.freeze(codes);
    CODES_CACHE.set(config, codes);
  }
  return codes;
}

/** Farby pre legendu a body: `{ <strana>: css…, contested, mixed, none }`. */
export function wikiControlColours(config) {
  const out = {};
  for (const s of config.sides) out[s.id] = s.css;
  out.contested = config.contestedCss;
  out.mixed = config.mixedCss;
  out.none = config.noneCss;
  return Object.freeze(out);
}

/**
 * Odvodený raster zón pre N strán: bunka dostane stranu najbližšieho sídla (settlement/rural;
 * sporné a zmiešané body sú „sporné"); ak sú dve NAJBLIŽŠIE RÔZNE strany od seba do `bandKm`
 * alebo sporné sídlo do `contestedKm`, bunka je sporná; ďalej než `maxKm` od všetkého = bez
 * údaja (0). Riadok 0 = sever. Vzdialenosti v km s kosínusom šírky bunky (ako doteraz).
 * Body sú v priestorových košoch (mriežka `max(polomer hľadania, cellDeg)` stupňov; polomer =
 * maxKm + max(bandKm, contestedKm)), takže sa prezerá len okolie bunky — výsledok je
 * bit po bite rovnaký ako hrubá sila (bod za polomerom nemôže rozhodnutie zmeniť) a 350×250
 * buniek nad ~1 300 bodmi trvá jednotky ms. Okrajový vstup: keď má modul LEN sporné/zmiešané
 * sídla a žiadnu stranu, bunky za polomerom sporného dostanú `none` (0) — pôvodný dvojstranný
 * controlRaster Ukrajiny im dával 'ua' cez porovnanie Infinity < Infinity; zámerne opravené,
 * skutočné dáta majú vždy obe strany. Pure.
 * @returns {{width:number,height:number,cellDeg:number,bbox:object,cells:Uint8Array,counts:Record<string,number>}}
 */
export function wikiControlRaster(points, config, opts = {}) {
  const bbox = opts.bbox || config.bbox;
  const cellDeg = opts.cellDeg ?? config.cellDeg;
  const maxKm = opts.maxKm ?? config.maxKm;
  const bandKm = opts.bandKm ?? config.bandKm;
  const contestedKm = opts.contestedKm ?? (opts.bandKm ?? config.contestedKm ?? config.bandKm);
  const codes = wikiControlCodes(config);
  const sides = config.sides.map((s) => s.id);
  const nSides = sides.length;
  const CON = nSides;
  const width = Math.max(1, Math.round((bbox.east - bbox.west) / cellDeg));
  const height = Math.max(1, Math.round((bbox.north - bbox.south) / cellDeg));
  const cells = new Uint8Array(width * height);
  const counts = {};
  for (const id of sides) counts[id] = 0;
  counts.contested = 0; counts.none = 0;

  // Priestorové koše: mriežka `bucketDeg` nad rámcom s okrajom (1 kôš v šírke, `kxMax` košov
  // v dĺžke — stupeň dĺžky je o cos kratší, tak polomer R km siaha cez viac košov). Bod za
  // okrajom je od každej bunky ďalej než R = maxKm + max(bandKm, contestedKm) a nemôže
  // rozhodnutie zmeniť, preto sa zahodí. Body sú po košoch v plochom poli (counting sort).
  const sideIdx = new Map(sides.map((id, i) => [id, i]));
  const radiusKm = maxKm + Math.max(bandKm, contestedKm, 0);
  const radiusKm2 = radiusKm * radiusKm;
  const bucketDeg = Math.max(radiusKm / KM_LAT, cellDeg, 0.001);
  const latAbsMax = Math.min(89.9, Math.max(Math.abs(bbox.south), Math.abs(bbox.north)));
  const kxMax = Math.floor(1 / Math.max(Math.cos((latAbsMax * Math.PI) / 180), 1e-6)) + 1;
  const nbx = Math.floor((bbox.east - bbox.west) / bucketDeg) + 1;
  const nby = Math.floor((bbox.north - bbox.south) / bucketDeg) + 1;
  const mx = kxMax;
  const my = 1;
  const gw = nbx + 2 * mx;
  const gh = nby + 2 * my;
  const kept = [];
  const allBySide = sides.map(() => []); // všetky body strany (aj za okrajom) pre vzácny presný prepočet
  for (const p of points || []) {
    if (!isSettlementKind(p.kind) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    let idx = sideIdx.get(p.side);
    if (idx === undefined) {
      if (p.side === 'contested' || p.side === 'mixed') idx = CON; else continue;
    } else allBySide[idx].push(p.lat, p.lon);
    const by = Math.floor((p.lat - bbox.south) / bucketDeg);
    const bx = Math.floor((p.lon - bbox.west) / bucketDeg);
    if (by < -my || by > nby - 1 + my || bx < -mx || bx > nbx - 1 + mx) continue;
    kept.push(p.lat, p.lon, idx, (by + my) * gw + (bx + mx));
  }
  const exactNearest = (list, lat, lon, cosLat) => {
    let bestD = Infinity;
    for (let i = 0; i < list.length; i += 2) {
      const dy = (list[i] - lat) * KM_LAT;
      const dx = (list[i + 1] - lon) * KM_LAT * cosLat;
      const d = dx * dx + dy * dy;
      if (d < bestD) bestD = d;
    }
    return bestD;
  };
  const nPts = kept.length / 4;
  const start = new Int32Array(gw * gh + 1);
  for (let i = 0; i < nPts; i += 1) start[kept[i * 4 + 3] + 1] += 3;
  for (let g = 1; g <= gw * gh; g += 1) start[g] += start[g - 1];
  const flat = new Float64Array(nPts * 3);
  const fill = Int32Array.from(start);
  for (let i = 0; i < nPts; i += 1) {
    const g = kept[i * 4 + 3];
    const at = fill[g];
    flat[at] = kept[i * 4]; flat[at + 1] = kept[i * 4 + 1]; flat[at + 2] = kept[i * 4 + 2];
    fill[g] = at + 3;
  }

  const best = new Float64Array(nSides + 1);
  for (let row = 0; row < height; row += 1) {
    const lat = bbox.north - (row + 0.5) * cellDeg; // riadok 0 = sever (ako obrázok)
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const by0 = Math.floor((lat - bbox.south) / bucketDeg);
    const kx = Math.floor(1 / Math.max(cosLat, 1e-6)) + 1;
    const byFrom = Math.max(-my, by0 - 1);
    const byTo = Math.min(nby - 1 + my, by0 + 1);
    for (let col = 0; col < width; col += 1) {
      const lon = bbox.west + (col + 0.5) * cellDeg;
      let code = 0;
      if (nPts) {
        best.fill(Infinity);
        const bx0 = Math.floor((lon - bbox.west) / bucketDeg);
        const bxFrom = Math.max(-mx, bx0 - kx);
        const bxTo = Math.min(nbx - 1 + mx, bx0 + kx);
        for (let by = byFrom; by <= byTo; by += 1) {
          const rowBase = (by + my) * gw + mx;
          for (let bx = bxFrom; bx <= bxTo; bx += 1) {
            const g = rowBase + bx;
            for (let i = start[g], end = start[g + 1]; i < end; i += 3) {
              const dy = (flat[i] - lat) * KM_LAT;
              const dx = (flat[i + 1] - lon) * KM_LAT * cosLat; // rovnaké poradie ako hrubá sila → rovnaké bity
              const d = dx * dx + dy * dy;
              const k = flat[i + 2];
              if (d < best[k]) best[k] = d;
            }
          }
        }
        let i1 = -1;
        let b1 = Infinity;
        let b2 = Infinity;
        for (let k = 0; k < nSides; k += 1) {
          const b = best[k];
          if (b < b1) { b2 = b1; b1 = b; i1 = k; } else if (b < b2) b2 = b;
        }
        const dC = Math.sqrt(best[CON]);
        if (dC <= maxKm && !(Math.sqrt(b1) <= maxKm)) {
          // Vzácne: sporné sídlo blízko, no strany ďalej než polomer košov — brána prešla cez dC
          // a pás porovnáva vzdialenosti strán, ktoré koše nevidia (hodnota nad R² z kúta košov
          // nemusí byť minimum) → presne cez všetky body (ako hrubá sila).
          i1 = -1; b1 = Infinity; b2 = Infinity;
          for (let k = 0; k < nSides; k += 1) {
            if (best[k] > radiusKm2) best[k] = exactNearest(allBySide[k], lat, lon, cosLat);
            const b = best[k];
            if (b < b1) { b2 = b1; b1 = b; i1 = k; } else if (b < b2) b2 = b;
          }
        }
        const d1 = Math.sqrt(b1);
        const d2 = Math.sqrt(b2);
        if (Math.min(d1, dC) <= maxKm) {
          if (dC <= contestedKm || d2 - d1 <= bandKm) code = codes.contested;
          else if (i1 >= 0) code = i1 + 1;
        }
      }
      cells[row * width + col] = code;
      if (code === 0) counts.none += 1; else if (code === codes.contested) counts.contested += 1; else counts[sides[code - 1]] += 1;
    }
  }
  return { width, height, cellDeg, bbox: { ...bbox }, cells, counts };
}

/** Text stavu pre kartu/legendu: i18n kľúč `<prefix>.<strana>`. Pure. */
export function wikiSideText(side, config, translate = (k) => k) {
  return translate(`${config.i18nPrefix}.${side || 'none'}`);
}

// ---------------------------------------------------------------------------------------------
// UKRAJINA — dnešné správanie ukraineControl.js ako konfigurácia (testy Ukrajiny bez zmeny).
// ---------------------------------------------------------------------------------------------

/** Skratky `mk` z prehľadového modulu (záloha, keď ich revízia nemá). */
export const UKRAINE_DEFAULT_MK = Object.freeze({
  con: '80x80-red-blue-anim.gif', grz: 'Location dot grey.svg', rus: 'Location dot red.svg', shr: 'Map-ctl2-red+blue.svg', ukr: 'Location dot blue.svg',
  rNN: 'Map-arcNN-red.svg', rNE: 'Map-arcNE-red.svg', rEE: 'Map-arcEE-red.svg', rSE: 'Map-arcSE-red.svg', rSS: 'Map-arcSS-red.svg', rSW: 'Map-arcSW-red.svg', rWW: 'Map-arcWW-red.svg', rNW: 'Map-arcNW-red.svg',
  uNN: 'Map-arcNN-blue.svg', uNE: 'Map-arcNE-blue.svg', uEE: 'Map-arcEE-blue.svg', uSE: 'Map-arcSE-blue.svg', uSS: 'Map-arcSS-blue.svg', uSW: 'Map-arcSW-blue.svg', uWW: 'Map-arcWW-blue.svg', uNW: 'Map-arcNW-blue.svg',
});
/** Veľkosť značky → trieda populácie (komentár v ukrajinskom module). */
export const UKRAINE_MARKSIZE_POP = Object.freeze({ 35: 'capital', 28: '1m', 24: '500k', 20: '200k', 16: '100k', 14: '50k', 12: '20k', 10: '10k', 8: '5k', 6: '2k', 5: '1k', 4: 'small' });

/** Dvojstranná logika Ukrajiny: farba oblúka/kruhu = tlačiaca strana, `side` = protistrana. */
const ukraineOpponent = (colour) => (colour === 'ua' ? 'ru' : 'ua');

export const UKRAINE_CONTROL_CONFIG = deepFreeze({
  id: 'ukraine',
  titles: [
    { id: 'overview', title: 'Module:Russo-Ukrainian war overview map', since: '2024-04-22' },
    { id: 'detailed', title: 'Module:Russo-Ukrainian war detailed map' },
  ],
  attribution: 'Wikipedia · Russo-Ukrainian war detailed map · CC BY-SA 4.0',
  license: 'CC BY-SA 4.0',
  bbox: { west: 22.0, south: 44.2, east: 40.6, north: 52.6 },
  cellDeg: 0.05, maxKm: 35, bandKm: 7, contestedKm: 7,
  sides: [
    { id: 'ua', label: 'Ukraine', css: '#4fa3ff', fill: false },
    { id: 'ru', label: 'Russia and allies', css: '#e0553f', fill: true },
  ],
  contestedCss: '#ffb547', mixedCss: '#c68cff', noneCss: '#8a97a3',
  colours: [{ re: /blue/, side: 'ua' }, { re: /red/, side: 'ru' }, { re: /grey|gray/, side: 'none' }],
  fallbackByColour: true,
  defaultMk: UKRAINE_DEFAULT_MK,
  marksizePop: UKRAINE_MARKSIZE_POP,
  popFallback: (size) => (size >= 12 ? '20k' : 'small'),
  staleDays: 14,
  i18nPrefix: 'ukraine.ctl',
  icons: [
    { match: /80x80-red-blue-anim/, side: 'contested', kind: 'settlement' },
    { match: /map-ctl2-red\+blue/, side: 'mixed', kind: 'settlement' },
    { match: /^location dot/, side: FROM_COLOUR, sideDefault: 'none', kind: 'settlement' },
    { match: /^map-arc(?:([nsew]{2}))?/, resolve: ({ colour, m }) => ({ side: ukraineOpponent(colour), kind: 'settlement', pressure: colour, direction: (m[1] || '').toUpperCase() || null }) },
    { match: /^map-circle/, resolve: ({ colour }) => ({ side: colour || 'contested', kind: 'settlement', pressure: ukraineOpponent(colour) }) },
    { match: /^[34]x[34]dot/, side: FROM_COLOUR, sideDefault: 'none', kind: 'rural' },
    { match: /fighter-jet/, side: FROM_COLOUR, kind: 'airbase' },
    { match: /helicopter/, side: FROM_COLOUR, kind: 'heliport' },
    { match: /anchor/, side: FROM_COLOUR, kind: 'port' },
    { match: /nuclearpowerplant/, side: FROM_COLOUR, kind: 'industry' },
    { match: /abm-/, side: FROM_COLOUR, kind: 'base' },
    { match: /map-peak/, side: FROM_COLOUR, kind: 'hill' },
    { match: /gota0/, resolve: ({ norm }) => ({ side: /gota03/.test(norm) ? 'ua' : 'ru', kind: 'oilgas' }) },
    { match: /bsicon/, side: FROM_COLOUR, kind: 'hydro' },
    { match: /mountain pass/, side: null, kind: 'border' },
    { match: /arch dam/, side: null, kind: 'dam' },
    { match: /roadmap overlay/, skip: true },
  ],
});

// ---------------------------------------------------------------------------------------------
// BLÍZKY VÝCHOD — štyri moduly (legendy overené 24. 9. 2026, scratch report-legends.json).
// ---------------------------------------------------------------------------------------------

/** Veľkosť značky → populácia podľa hlavičky modulov („Dotsize vs. Population"). */
export const MIDEAST_MARKSIZE_POP = Object.freeze({ 32: 'capital', 26: '500k', 23: '200k', 20: '100k', 17: '50k', 14: '20k', 11: '10k', 8: '5k', 6: '1k', 4: 'small' });

/** Kvapky ropy Gota0N: číslo = farba (tabuľka v /doc sýrskeho modulu; 04 = žltá odvodené z radu). */
const GOTA_COLOUR = Object.freeze({ 1: 'red', 2: 'lime', 3: 'blue', 4: 'yellow', 7: 'black', 8: 'grey' });

/**
 * Spoločné pravidlá ikon modulov Blízkeho východu (za pravidlami špecifickými pre modul):
 * farba = strana podľa `config.colours`; prstenec/oblúk = sporné sídlo s tlakom farby (kontrolu
 * pri zlúčení prevezme bodka na tých istých súradniciach); hraničný priechod a priehrada bez
 * strany (`none`, ostávajú ako objekty); bez záložného „farba → other".
 */
function mideastIconRules(specific = []) {
  return [
    ...specific,
    { match: /overlay/, skip: true },
    { match: /^80x80-([a-z]+)-([a-z]+)-anim/, side: 'contested', kind: 'settlement', between: FROM_COLOURS },
    { match: /^map-ctl2-([a-z-]+)\+([a-z-]+)\./, side: 'mixed', kind: 'settlement', between: FROM_COLOURS },
    { match: /^map-ctl3-/, side: 'mixed', kind: 'settlement' },
    { match: /^(?:location dot|dot|map-dot-)/, side: FROM_COLOUR, kind: 'settlement' },
    { match: /^map-arc(?:([nsew]{2}))?-/, side: 'contested', kind: 'settlement', pressure: FROM_COLOUR, direction: true },
    { match: /^map-circle/, side: 'contested', kind: 'settlement', pressure: FROM_COLOUR },
    { match: /^[34]x[34]dot/, side: FROM_COLOUR, kind: 'rural' },
    { match: /fighter-jet/, side: FROM_COLOUR, kind: 'airport' },
    { match: /helicopter/, side: FROM_COLOUR, kind: 'heliport' },
    { match: /anchor/, side: FROM_COLOUR, kind: 'port' },
    { match: /nuclearpowerplant/, side: FROM_COLOUR, kind: 'industry' },
    { match: /^abm-/, side: FROM_COLOUR, kind: 'base' },
    { match: /^map-peak/, side: FROM_COLOUR, kind: 'hill' },
    { match: /^gota0(\d)/, resolve: ({ m, colourSide }) => { const side = colourSide(GOTA_COLOUR[m[1]] || ''); return side ? { side, kind: 'oilgas' } : null; } },
    { match: /^bsicon str/, side: FROM_COLOUR, kind: 'dam' },
    { match: /^mountain pass/, side: 'none', kind: 'border-crossing' },
    { match: /^arch dam/, side: 'none', kind: 'dam' },
  ];
}

const MIDEAST_COMMON = Object.freeze({
  license: 'CC BY-SA 4.0',
  contestedCss: '#ffb547', mixedCss: '#c68cff', noneCss: '#8a97a3',
  colocated: 'merge',
  defaultMk: Object.freeze({}),
  marksizePop: MIDEAST_MARKSIZE_POP,
});

/**
 * Izrael–Palestína (Gaza, Západný breh, Golan, juh Libanonu — modul je zároveň
 * `secondaryModules` libanonského povstania, preto značky až po 36,0° s. š.). Legenda z
 * caption: modrá Izrael, zelená 0d0 Palestínska samospráva, limetková Hamas, červená
 * Hizballáh, fialová libanonskí miestni, sivá 68a LAF, tmavočervená Sýria, tyrkysová Jordánsko,
 * žltá Ľudové sily (0 aktívnych bodiek). Bodky týždenne upravované → prah 14 dní.
 */
const IP_CONFIG = {
  ...MIDEAST_COMMON,
  id: 'israel-palestine',
  titles: [{ id: 'main', title: 'Module:Israeli-Palestinian conflict detailed map' }],
  attribution: 'Wikipedia contributors · Module:Israeli-Palestinian conflict detailed map · CC BY-SA 4.0',
  bbox: { west: 32.05, south: 29.4, east: 37.15, north: 36.1 },
  cellDeg: 0.02, maxKm: 12, bandKm: 3, contestedKm: 3,
  sides: [
    { id: 'israel', label: 'Israel', css: '#4fa3ff', fill: true },
    { id: 'pa', label: 'Palestinian Authority (Ramallah administration)', css: '#3ec46d', fill: true },
    { id: 'hamas', label: 'Hamas (Gaza administration)', css: '#a8e05f', fill: true },
    { id: 'hezbollah', label: 'Hezbollah', css: '#e0553f', fill: true },
    { id: 'lebanon-locals', label: 'Lebanese locals', css: '#b07cff', fill: true },
    { id: 'laf', label: 'Lebanese Armed Forces', css: '#7f95ad', fill: true },
    { id: 'syria', label: 'Syria', css: '#9b2d20', fill: true },
    { id: 'jordan', label: 'Jordan', css: '#2fb5a8', fill: true },
    { id: 'popular-forces', label: 'Popular Forces (Gaza)', css: '#e8d44d', fill: true },
  ],
  colours: [
    { re: /darkred/, side: 'syria' }, { re: /red/, side: 'hezbollah' }, { re: /blue/, side: 'israel' }, { re: /lime/, side: 'hamas' },
    { re: /green/, side: 'pa' }, { re: /purple/, side: 'lebanon-locals' },
    // `Location dot lightslategray.svg` (0 aktívnych použití) uvádza /doc pri Ľudových silách, caption ju nemá —
    // kým to legenda nepotvrdí, ostáva NEZNÁMA (počíta sa v `unmapped`), nie tichý LAF cez podreťazec „gray".
    { re: /lightslategray/, side: null }, { re: /grey|gray/, side: 'laf' }, { re: /teal/, side: 'jordan' }, { re: /yellow/, side: 'popular-forces' },
  ],
  staleDays: 14,
  i18nPrefix: 'mideast.ctl.israel-palestine',
  icons: mideastIconRules([
    // caption: „Contested … Blue-lime-green-square-anim.gif Israel vs Palestinian Authority" (Tammun, Tulkarm, Askar) —
    // farebné slová (blue, lime, green) by dali nejednoznačnú dvojicu, preto výslovne podľa legendy.
    { match: 'Blue-lime-green-square-anim.gif', side: 'contested', kind: 'settlement', between: ['israel', 'pa'] },
    // caption: „Map-ctl2-lime+blue.svg Stable mixed control (Israel and Palestinian Authority)" — limetková je inak Hamas
    // a všetky 3 použitia sú v Gaze (Chán Júnis, Al-Qarara, Wádí as-Salqá); držíme sa TEXTU legendy, nesúlad zapísaný tu.
    { match: 'Map-ctl2-lime+blue.svg', side: 'mixed', kind: 'settlement', between: ['israel', 'pa'] },
  ]),
};

/**
 * Jemen. Legenda z caption: červená = medzinárodne uznaná vláda a koalícia (STC sa nerozlišuje,
 * Aden je tiež červený), zelená 0d0 = Ansarulláh (Húsíovia) a spojenci — vrchy/základne/letiská
 * Húsíov sú limetkové (potvrdené sporným „80x80-red-lime-anim Pro-Government – Houthis"), sivá 68a
 * = sunnitskí džihádisti (AQAP…), modrá = kmeňové sily, čierna = ISIL-JP (0 aktívnych). Vložená
 * minimapa „Situation in Taizz.svg" a 1-pixelový nosič popisu SAUDI ARABIA sa preskakujú.
 */
const YEMEN_CONFIG = {
  ...MIDEAST_COMMON,
  id: 'yemen',
  titles: [{ id: 'main', title: 'Module:Yemeni Civil War detailed map' }],
  attribution: 'Wikipedia contributors · Module:Yemeni Civil War detailed map · CC BY-SA 4.0',
  bbox: { west: 42.5, south: 12.55, east: 54.15, north: 18.4 },
  cellDeg: 0.05, maxKm: 35, bandKm: 7, contestedKm: 7,
  sides: [
    { id: 'yemen-gov', label: 'Internationally recognized government and Saudi-led coalition forces', css: '#e0553f', fill: true },
    { id: 'houthi', label: 'Ansarullah (Houthis) and allies', css: '#3ec46d', fill: true },
    { id: 'aqap', label: 'Sunni jihadists incl. AQAP, Ansar al-Sharia and allied tribes', css: '#7f95ad', fill: true },
    { id: 'tribal', label: 'Tribal forces', css: '#4fa3ff', fill: true },
    { id: 'isis', label: 'ISIL-YP', css: '#2b2b2b', fill: true },
  ],
  colours: [
    { re: /darkred/, side: null }, { re: /red/, side: 'yemen-gov' }, { re: /lime|green/, side: 'houthi' },
    { re: /grey|gray/, side: 'aqap' }, { re: /blue/, side: 'tribal' }, { re: /black/, side: 'isis' },
  ],
  staleDays: 30,
  i18nPrefix: 'mideast.ctl.yemen',
  icons: mideastIconRules([
    { match: /^situation in /, skip: true },
    // L1226: { lat 18.3, long 45.325, mark "Location dot grey.svg", marksize 1, label SAUDI ARABIA } — nosič popisu štátu,
    // v legende nie je. Preskakuje sa LEN s marksize ≤ 1 (podpis nosiča); sivá bodka bežnej veľkosti ide ďalej na
    // farebné pravidlo (sivá 68a = AQAP), aby sa nový skutočný bod nikdy ticho nestratil v `skipped`.
    { match: 'Location dot grey.svg', sizeMax: 1, skip: true },
  ]),
};

/**
 * Sýria (prehľad je zlúčený v jednom module, 7 752 značiek). Legenda z caption: sivá 68a = druhá
 * prechodná vláda & turecké ozbrojené sily (sever pod Tureckom sa NEDÁ oddeliť), žltá ff4 = SDF
 * (žlté ikony infraštruktúry podľa farby — /doc tabuľka žltý riadok nemá), limetková = drúzske
 * milície (Džabal Bašan), modrá = IOS (nárazníkové pásmo Golan), červená = ruské sily (len
 * Chmejmím a Tartús), čierna = ISIL (0 aktívnych). Upravovaný mesačne → prah 45 dní.
 */
const SYRIA_CONFIG = {
  ...MIDEAST_COMMON,
  id: 'syria',
  titles: [{ id: 'main', title: 'Module:Syrian Civil War detailed map' }],
  attribution: 'Wikipedia contributors · Module:Syrian Civil War detailed map · CC BY-SA 4.0',
  bbox: { west: 35.65, south: 32.25, east: 42.45, north: 37.35 },
  cellDeg: 0.05, maxKm: 35, bandKm: 7, contestedKm: 7,
  sides: [
    { id: 'syria-gov', label: 'Syrian transitional government & Turkish Armed Forces', css: '#7f95ad', fill: true },
    { id: 'sdf', label: 'Democratic Autonomous Administration of North and East Syria (SDF)', css: '#e8d44d', fill: true },
    { id: 'druze', label: 'Druze militias (Jabal Bashan)', css: '#a8e05f', fill: true },
    { id: 'israel', label: 'Israel Defense Forces', css: '#4fa3ff', fill: true },
    { id: 'russia', label: 'Russian Armed Forces', css: '#e0553f', fill: true },
    { id: 'isis', label: 'Islamic State (ISIL)', css: '#2b2b2b', fill: true },
  ],
  colours: [
    { re: /grey|gray/, side: 'syria-gov' }, { re: /yellow/, side: 'sdf' }, { re: /lime/, side: 'druze' }, { re: /blue/, side: 'israel' },
    { re: /darkred/, side: null }, { re: /red/, side: 'russia' }, { re: /black/, side: 'isis' },
  ],
  staleDays: 45,
  i18nPrefix: 'mideast.ctl.syria',
  icons: mideastIconRules(),
};

/**
 * Libanonské povstanie (len Libanon severne od Sidónu; juh kreslí Wikipédia z IP modulu cez
 * `secondaryModules` — archív ukladá VLASTNÉ značky každého modulu, spoločný pohľad skladá
 * klient, preto `alsoModules`). Legenda z caption: sivá 68a = libanonské vládne sily, červená =
 * Hizballáh a spojenci; modrá/fialová/tmavočervená prichádzajú len z IP modulu.
 */
const LEBANON_CONFIG = {
  ...MIDEAST_COMMON,
  id: 'lebanon',
  titles: [{ id: 'main', title: 'Module:Lebanese insurgency detailed map' }],
  alsoModules: ['israel-palestine'],
  attribution: 'Wikipedia contributors · Module:Lebanese insurgency detailed map · CC BY-SA 4.0',
  bbox: { west: 35.05, south: 33.0, east: 36.65, north: 34.75 },
  cellDeg: 0.02, maxKm: 12, bandKm: 3, contestedKm: 3,
  sides: [
    { id: 'laf', label: 'Lebanese Government forces', css: '#7f95ad', fill: true },
    { id: 'hezbollah', label: 'Hezbollah and allies', css: '#e0553f', fill: true },
    { id: 'israel', label: 'Israel', css: '#4fa3ff', fill: true },
    { id: 'lebanon-locals', label: 'Lebanese locals', css: '#b07cff', fill: true },
    { id: 'syria', label: 'Syria', css: '#9b2d20', fill: true },
  ],
  colours: [
    { re: /grey|gray/, side: 'laf' }, { re: /darkred/, side: 'syria' }, { re: /red/, side: 'hezbollah' },
    { re: /blue/, side: 'israel' }, { re: /purple/, side: 'lebanon-locals' },
  ],
  staleDays: 30,
  i18nPrefix: 'mideast.ctl.lebanon',
  icons: mideastIconRules(),
};

/** Štyri konfigurácie modulov Blízkeho východu (zmrazené; poradie = poradie v paneli). */
export const MIDEAST_CONTROL_MODULES = deepFreeze([IP_CONFIG, YEMEN_CONFIG, SYRIA_CONFIG, LEBANON_CONFIG]);
export const MIDEAST_CONTROL_MODULE_IDS = Object.freeze(MIDEAST_CONTROL_MODULES.map((c) => c.id));

/** Konfigurácia modulu podľa id ('israel-palestine' | 'yemen' | 'syria' | 'lebanon' | 'ukraine'), inak null. */
export function wikiControlModuleById(id) {
  if (id === UKRAINE_CONTROL_CONFIG.id) return UKRAINE_CONTROL_CONFIG;
  return MIDEAST_CONTROL_MODULES.find((c) => c.id === id) || null;
}
