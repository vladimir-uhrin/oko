// src/data/latinize.js
/**
 * @module latinize
 * @description Prepis cyriliky do latinky pre popisky na mape (etapa 3b,
 * 2026-09-19; používateľ: „niektoré názvy sú v azbuke"). OSM má pri
 * ruských, ukrajinských, bieloruských a kazašských potrubiach `name:en` len
 * v ~3 % prípadov (164 z 5 875 plynových ciest), takže bez prepisu by
 * karty čítal len ten, kto vie azbuku. Prepis je zjednodušený BGN/PCGN:
 * jeden znak → jedna sekvencia, bez diakritiky, s malým rozlíšením
 * ukrajinčiny (г → h, и → y, є/ї/і/ґ) podľa prítomnosti ukrajinských písmen.
 * Originál sa NEZAHADZUJE — karta ho ukáže pod prepisom, aby sa dal
 * porovnať s mapou a s OSM.
 *
 * Arabské, perzské a čínske názvy sa neprepisujú (bez slovníka by vznikol
 * nezmysel); pri nich karta uprednostní `name:en`/`int_name`, inak nechá
 * originál. Modul je čistý — testuje sa v Node.
 */

const CYRILLIC_RE = /[Ѐ-ӿ]/;
const UKRAINIAN_HINT_RE = /[ґєїі]/i;

/** Ruský základ (BGN/PCGN bez diakritiky a bez apostrofov za ь/ъ). */
const RU = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // ukrajinčina / bieloruština
  є: 'ye', ї: 'yi', і: 'i', ґ: 'g', ў: 'w',
  // kazaština
  ә: 'a', ғ: 'gh', қ: 'q', ң: 'ng', ө: 'o', ұ: 'u', ү: 'u', һ: 'h',
  // srbčina / macedónčina / bulharčina
  ђ: 'dj', ћ: 'c', џ: 'dz', љ: 'lj', њ: 'nj', ј: 'j', ѓ: 'gj', ќ: 'kj', ѕ: 'dz',
};
/** Ukrajinské odchýlky (BGN/PCGN pre ukrajinčinu). */
const UK = { г: 'h', и: 'y', е: 'e', є: 'ye', ї: 'yi', і: 'i', ґ: 'g', й: 'y', х: 'kh', щ: 'shch' };

/** @param {string} value @returns {boolean} */
export function hasCyrillic(value) {
  return CYRILLIC_RE.test(String(value || ''));
}

/**
 * Písmo textu pre voľbu zobrazenia: 'cyrillic' | 'arabic' | 'cjk' | 'latin'.
 * Rozhoduje prvý nelatinkový znak; čisto latinkový text (aj s diakritikou) je 'latin'.
 * @param {string} value
 */
export function scriptOf(value) {
  const s = String(value || '');
  if (CYRILLIC_RE.test(s)) return 'cyrillic';
  if (/[؀-ۿݐ-ݿ]/.test(s)) return 'arabic';
  if (/[぀-ヿ㐀-䶿一-鿿가-힯]/.test(s)) return 'cjk';
  return 'latin';
}

/**
 * Prepis cyriliky do latinky; latinka a interpunkcia ostávajú. Veľké písmená
 * sa zachovajú na prvom znaku sekvencie („Ж" → „Zh"); celé slovo verzálkami
 * ostane verzálkami („СОЮЗ" → „SOYUZ").
 * @param {string} value
 * @returns {string}
 */
export function latinizeCyrillic(value, { lang = null } = {}) {
  const s = String(value || '');
  if (!CYRILLIC_RE.test(s)) return s;
  // Jazyk zo snímku (`name:uk` = `name` → 'uk') má prednosť; bez neho rozhodnú
  // ukrajinské písmená, a text bez nich (Ужгород, Долина) padne na ruštinu —
  // to je hranica, ktorú bez slovníka neprekročíme.
  const ukrainian = lang === 'uk' || lang === 'be' || (!lang && UKRAINIAN_HINT_RE.test(s));
  const table = ukrainian ? { ...RU, ...UK } : RU;
  const chars = [...s];
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const lower = ch.toLowerCase();
    const mapped = table[lower];
    if (mapped === undefined) { out += ch; continue; }
    if (ch === lower) { out += mapped; continue; }
    // Veľké písmeno: verzálky, keď je verzálkou aj sused, inak len prvý znak.
    const next = chars[i + 1];
    const prev = chars[i - 1];
    const shouting = (next && next !== next.toLowerCase() && CYRILLIC_RE.test(next)) || (prev && prev !== prev.toLowerCase() && CYRILLIC_RE.test(prev));
    out += shouting ? mapped.toUpperCase() : (mapped.charAt(0).toUpperCase() + mapped.slice(1));
  }
  return out;
}

/**
 * Text na zobrazenie: latinka bez zmeny, cyrilika prepísaná; `original`
 * nesie pôvodný text, keď sa líši od zobrazeného (na druhý riadok karty).
 * @param {string|null|undefined} value
 * @returns {{text: string, original: string|null}}
 */
export function latinizeForDisplay(value, { lang = null } = {}) {
  const s = String(value || '').trim();
  if (!s) return { text: '', original: null };
  if (!CYRILLIC_RE.test(s)) return { text: s, original: null };
  const text = latinizeCyrillic(s, { lang });
  return { text, original: text === s ? null : s };
}
