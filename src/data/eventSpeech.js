// src/data/eventSpeech.js — slovenská výslovnosť pre hlas komentára (2026-10-03, vlastník k prvému hlasu:
// „čísla zle vyslovuje a anglické názvy tiež"). Hlasu sa dáva text tak, ako sa má čítať: čísla slovami,
// kódy letov hláskované, doména foneticky; titulky dostávajú správny pravopis (eventNarration.js). Pure.

const UNITS = ['nula', 'jeden', 'dva', 'tri', 'štyri', 'päť', 'šesť', 'sedem', 'osem', 'deväť', 'desať', 'jedenásť', 'dvanásť', 'trinásť', 'štrnásť', 'pätnásť', 'šestnásť', 'sedemnásť', 'osemnásť', 'devätnásť'];
const TENS = ['', '', 'dvadsať', 'tridsať', 'štyridsať', 'päťdesiat', 'šesťdesiat', 'sedemdesiat', 'osemdesiat', 'deväťdesiat'];
const HUNDREDS = ['', 'sto', 'dvesto', 'tristo', 'štyristo', 'päťsto', 'šesťsto', 'sedemsto', 'osemsto', 'deväťsto'];
const THOUSANDS = ['', 'tisíc', 'dvetisíc', 'tritisíc', 'štyritisíc'];
/** Lokál (po piatej hodine) a inštrumentál (pred šiestou hodinou) radových čísloviek hodín. */
const HOUR_LOC = ['', 'prvej', 'druhej', 'tretej', 'štvrtej', 'piatej', 'šiestej', 'siedmej', 'ôsmej', 'deviatej', 'desiatej', 'jedenástej', 'dvanástej', 'trinástej', 'štrnástej', 'pätnástej', 'šestnástej', 'sedemnástej', 'osemnástej', 'devätnástej', 'dvadsiatej', 'dvadsiatej prvej', 'dvadsiatej druhej', 'dvadsiatej tretej'];
const HOUR_INS = ['', 'prvou', 'druhou', 'treťou', 'štvrtou', 'piatou', 'šiestou', 'siedmou', 'ôsmou', 'deviatou', 'desiatou', 'jedenástou', 'dvanástou', 'trinástou', 'štrnástou', 'pätnástou', 'šestnástou', 'sedemnástou', 'osemnástou', 'devätnástou', 'dvadsiatou', 'dvadsiatou prvou', 'dvadsiatou druhou', 'dvadsiatou treťou'];
const LETTERS = { a: 'á', b: 'bé', c: 'cé', d: 'dé', e: 'é', f: 'ef', g: 'gé', h: 'há', i: 'í', j: 'jé', k: 'ká', l: 'el', m: 'em', n: 'en', o: 'ó', p: 'pé', q: 'kvé', r: 'er', s: 'es', t: 'té', u: 'ú', v: 'vé', w: 'dvojité vé', x: 'iks', y: 'ypsilon', z: 'zet' };
/** Doména slovami tak, ako ju hlas prečíta správne (overené rozpoznávaním reči 2026-10-02). */
const DOMAINS = { 'okolive.sk': 'okolajv bodka es ká' };

/** Číslo 0–999 999 slovami (stovky a tisíce oddelené medzerou, desiatky s jednotkami spolu). Pure. */
export function spokenNumber(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 0) return `mínus ${spokenNumber(-v)}`;
  if (v < 20) return UNITS[v];
  if (v < 100) return `${TENS[Math.floor(v / 10)]}${v % 10 ? UNITS[v % 10] : ''}`;
  if (v < 1000) return `${HUNDREDS[Math.floor(v / 100)]}${v % 100 ? ` ${spokenNumber(v % 100)}` : ''}`;
  if (v < 1_000_000) {
    const k = Math.floor(v / 1000);
    const head = k < 5 ? THOUSANDS[k] : (k < 20 ? `${UNITS[k]}tisíc` : `${spokenNumber(k)} tisíc`);
    return `${head}${v % 1000 ? ` ${spokenNumber(v % 1000)}` : ''}`;
  }
  return String(v);
}

/** „deväť minút", „jedna minúta", „dve minúty". Pure. */
export function spokenMinutes(n) {
  const v = Math.max(0, Math.round(n));
  if (v === 1) return 'jedna minúta';
  if (v === 2) return 'dve minúty';
  if (v <= 4) return `${spokenNumber(v)} minúty`;
  return `${spokenNumber(v)} minút`;
}

/** Akuzatív po „o … neskôr": „minútu", „dve minúty", „päť minút". Pure. */
export function spokenMinutesAcc(n) {
  const v = Math.max(1, Math.round(n));
  if (v === 1) return 'minútu';
  if (v === 2) return 'dve minúty';
  if (v <= 4) return `${spokenNumber(v)} minúty`;
  return `${spokenNumber(v)} minút`;
}

const HOURS_NOM = ['', 'hodinu', 'dve hodiny', 'tri hodiny', 'štyri hodiny', 'päť hodín', 'šesť hodín', 'sedem hodín', 'osem hodín', 'deväť hodín', 'desať hodín', 'jedenásť hodín', 'dvanásť hodín'];
/** Genitív po „vyše": „vyše hodiny", „vyše dvoch hodín". */
const HOURS_GEN = ['', 'hodiny', 'dvoch hodín', 'troch hodín', 'štyroch hodín', 'piatich hodín', 'šiestich hodín', 'siedmich hodín', 'ôsmich hodín', 'deviatich hodín', 'desiatich hodín', 'jedenástich hodín', 'dvanástich hodín'];
const hoursCaption = (h, gen) => (h === 1 ? (gen ? 'hodiny' : 'hodinu') : `${h} ${gen ? 'hodín' : (h <= 4 ? 'hodiny' : 'hodín')}`);

/**
 * Čas letu pre vetu kontextu („Lietadlo je … vo vzduchu"): „štyridsať minút", „dve hodiny", „vyše dvoch
 * hodín", „takmer tri hodiny"; pod 5 minút a nad 12 hodín null. `{spoken, caption}`. Pure.
 */
export function spokenFlightTime(seconds) {
  const min = Math.round((Number(seconds) || 0) / 60);
  if (min < 5) return null;
  if (min < 90) {
    const m = Math.max(5, Math.round(min / 5) * 5);
    return { spoken: spokenMinutes(m), caption: `${m} minút` };
  }
  let h = Math.floor(min / 60);
  const rem = min - h * 60;
  if (rem >= 50) {
    h += 1;
    if (h > 12) return null;
    return { spoken: `takmer ${HOURS_NOM[h]}`, caption: `takmer ${hoursCaption(h, false)}` };
  }
  if (h > 12) return null;
  if (rem < 10) return { spoken: HOURS_NOM[h], caption: hoursCaption(h, false) };
  return { spoken: `vyše ${HOURS_GEN[h]}`, caption: `vyše ${hoursCaption(h, true)}` };
}

/** Vzdialenosť zaokrúhlená (do 100 km na desiatky, inak na päťdesiatky): „štyristo kilometrov" / „400 km". Pure. */
export function spokenKm(km) {
  const raw = Math.max(0, Number(km) || 0);
  const v = raw < 100 ? Math.round(raw / 10) * 10 : Math.round(raw / 50) * 50;
  return { value: v, spoken: `${spokenNumber(v)} kilometrov`, caption: `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km` };
}

/** „dvesto šesť stupňov", „jeden stupeň", „tri stupne". Pure. */
export function spokenDegrees(n) {
  const v = Math.max(0, Math.round(n));
  if (v === 1) return 'jeden stupeň';
  if (v >= 2 && v <= 4) return `${spokenNumber(v)} stupne`;
  return `${spokenNumber(v)} stupňov`;
}

/** „dvadsaťjeden tisíc stôp", „jedna stopa", „dve stopy". Pure. */
export function spokenFeet(n) {
  const v = Math.max(0, Math.round(n));
  if (v === 1) return 'jedna stopa';
  if (v === 2) return 'dve stopy';
  if (v <= 4) return `${spokenNumber(v)} stopy`;
  return `${spokenNumber(v)} stôp`;
}

/** Kód letu hláskovaný: „FZ1073" → „ef zet tisíc sedemdesiattri", „OK007" → „ó ká nula nula sedem". Pure. */
export function spokenFlightNumber(code) {
  const s = String(code || '').trim();
  const m = /^([A-Za-z]{1,3})[\s-]?(\d{1,4})([A-Za-z]{0,2})$/.exec(s);
  if (!m) return s.split('').map((c) => LETTERS[c.toLowerCase()] || c).join(' ');
  const letters = (x) => x.toLowerCase().split('').map((c) => LETTERS[c]).join(' ');
  const digits = m[2].startsWith('0') ? m[2].split('').map((d) => UNITS[Number(d)]).join(' ') : spokenNumber(Number(m[2]));
  return [letters(m[1]), digits, m[3] ? letters(m[3]) : ''].filter(Boolean).join(' ');
}

/** Doména foneticky (slovník), inak meno + „bodka" + hláskovaná koncovka. Pure. */
export function spokenDomain(domain) {
  const d = String(domain || '').toLowerCase().trim();
  if (DOMAINS[d]) return DOMAINS[d];
  const parts = d.split('.');
  const tld = parts.pop() || '';
  return `${parts.join(' bodka ')} bodka ${tld.split('').map((c) => LETTERS[c] || c).join(' ')}`;
}

/** Predložky, po ktorých číslovka mení tvar vždy (pád), a tie, po ktorých ho menia len čísla bez „tisíc". */
const OBLIQUE_ALWAYS = new Set(['po', 'pri', 's', 'so', 'k', 'ku']);
const OBLIQUE_SMALL = new Set(['od', 'do', 'z', 'zo', 'bez', 'okolo', 'u', 'počas', 'pred', 'pod', 'nad', 'medzi']);

/**
 * Číslice vo vete, ktorú napísal vlastník (háčik, doplnky, náhrady viet), → slová pre hlas (vlastník 10-03:
 * „sprav ale tak, aby sa čísla dobre vyslovovali"). Prepíše sa len to, čo má istý tvar: kód letu (FZ1073 →
 * hláskovane), celé číslo od 5 v základnom tvare („bolo 167 ľudí", „kleslo o 14 000 stôp", „za 30 sekúnd"),
 * po predložke s iným pádom len tisícky („z 34 000 stôp", „pod 17 000 stôp"). Neisté tvary kód neháda —
 * vráti `problem` a vlastník číslo napíše slovom: 1–4 (rod: dva/dve/dvaja), čas „9:45", desatinné číslo,
 * radová číslovka („30. septembra"), malé číslo po predložke („do 5 minút" = „do piatich minút"). Pure.
 * @returns {{text: string, problem: string|null}}
 */
export function spokenDigits(input) {
  const text = String(input ?? '');
  if (!/\d/.test(text)) return { text, problem: null };
  let problem = null;
  const fail = (why) => { if (!problem) problem = why; return ''; };
  let out = text.replace(/(?<![\p{L}\d])([A-Z]{1,3})(\d{1,4})([A-Z]{0,2})(?![\p{L}\d])/gu, (m) => spokenFlightNumber(m));
  out = out.replace(/(?<![\p{L}\d])(\d{1,3}(?:[  .]\d{3})+|\d+)([:,.]\d+)?(\.)?(?![\p{L}\d])/gu, (m, digits, frac, dot, offset, whole) => {
    if (frac) return fail(frac.startsWith(':') ? `čas „${digits}${frac}" napíš slovom` : `desatinné číslo „${digits}${frac}" napíš slovom`);
    // Bodka za číslom a ďalej malé písmeno = radová číslovka („30. septembra"); na konci vety je to bodka vety.
    if (dot && /^\s+\p{Ll}/u.test(whole.slice(offset + m.length))) return fail(`radovú číslovku „${digits}." napíš slovom`);
    const n = Number(digits.replace(/[  .]/g, ''));
    if (!Number.isFinite(n) || n >= 1_000_000) return fail(`číslo „${digits}" napíš slovom`);
    if (n < 5) return fail(`číslo „${digits}" napíš slovom (rod: dva/dve/dvaja…)`);
    const before = (whole.slice(0, offset).trimEnd().split(/\s+/).pop() || '').toLowerCase().replace(/[^\p{L}]/gu, '');
    if (OBLIQUE_ALWAYS.has(before) || (OBLIQUE_SMALL.has(before) && n < 1000)) return fail(`číslo „${digits}" po „${before}" napíš slovom v správnom tvare`);
    return spokenNumber(n) + (dot || '');
  });
  return problem ? { text, problem } : { text: out, problem: null };
}

/** Hodina UTC v reči: „krátko po piatej hodine" (do 29. minúty), inak „pred šiestou hodinou". Pure. */
export function spokenHour(tS) {
  const d = new Date(tS * 1000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (m <= 29) {
    const text = h === 0 ? 'krátko po polnoci' : `krátko po ${HOUR_LOC[h]} hodine`;
    return { spoken: text, caption: text };
  }
  const next = (h + 1) % 24;
  const text = next === 0 ? 'pred polnocou' : `pred ${HOUR_INS[next]} hodinou`;
  return { spoken: text, caption: text };
}
