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
