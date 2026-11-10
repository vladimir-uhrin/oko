// scripts/lib/styleDebt.mjs — počty natvrdo zapísaných hodnôt v style.css (2026-11-10).
// Používa ho src/styleDebt.test.mjs (stropy) a dá sa pustiť aj ručne: node scripts/lib/styleDebt.mjs

/** Selektory vzoriek legiend a značiek: ich farby sú dáta, nie vzhľad rozhrania. */
export const DATA_SELECTOR = /(-sw\b|swatch|legend|-ctl-item|is-rp-|-marker\b|-key\b|-dot\b)/i;

// Hex aj s alfa príponou (#39d0ff55), rgb() s čiarkami aj s medzerami (rgb(0 212 255 / 28%)).
const ACCENT_LITERAL = /#(?:00d4ff|39d0ff|00dcff|36dcff)(?:[0-9a-f]{2})?(?![0-9a-f])|rgba?\(\s*(?:0[\s,]+212|57[\s,]+208|54[\s,]+220|0[\s,]+220)[\s,]+255\b/gi;

/**
 * @param {string} cssText obsah style.css
 * @returns {{ distinctHex: number, distinctRgbTriples: number, accentLiterals: number, accentLiteralSamples: string[],
 *   fontSizesUnder10px: number, distinctFontSizes: number, distinctZIndex: number, outlineNone: number, important: number }}
 */
export function styleDebt(cssText) {
  // Komentáre nie sú pravidlá — spomínajú staré hodnoty v histórii rozhodnutí.
  const css = String(cssText).replace(/\/\*[\s\S]*?\*\//g, '');
  const hex = new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()));
  const triples = new Set();
  for (const m of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) triples.add(`${m[1]},${m[2]},${m[3]}`);
  // Doslovná modrá: počíta sa len mimo definícií tokenov a mimo vzoriek legiend.
  const accentSamples = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const [, selector, body] = m;
    // Pravidlo sa preskočí, len keď je KAŽDÝ selektor zoznamu vzorka legendy — inak by sa doslovná farba
    // schovala za jedného suseda v zozname.
    if (selector.split(',').every((part) => DATA_SELECTOR.test(part))) continue;
    for (const decl of body.split(';')) {
      if (/^\s*--accent(-rgb)?\s*:/.test(decl)) continue;
      const hits = decl.match(ACCENT_LITERAL);
      if (hits) accentSamples.push(`${selector.trim().split('\n').pop().trim().slice(0, 50)} → ${hits[0]}`);
    }
  }
  // Veľkosť písma aj zo skratky `font: 600 9px/1 …` — bez nej by nový drobný text strážou prešiel.
  const toSize = (m) => ({ px: m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]), raw: m[1] + m[2] });
  const fontSizes = [
    ...[...css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)].map(toSize),
    ...[...css.matchAll(/(?<![\w-])font:\s*[^;{}]*?\b([\d.]+)(px|rem)(?=\s*\/|\s|;|\})/g)].map(toSize),
  ];
  return {
    distinctHex: hex.size,
    distinctRgbTriples: triples.size,
    accentLiterals: accentSamples.length,
    accentLiteralSamples: accentSamples.slice(0, 8),
    fontSizesUnder10px: fontSizes.filter((f) => f.px < 10).length,
    distinctFontSizes: new Set(fontSizes.map((f) => f.raw)).size,
    distinctZIndex: new Set([...css.matchAll(/z-index:\s*(-?\d+)/g)].map((m) => m[1])).size,
    outlineNone: (css.match(/outline:\s*(none|0)\b/g) || []).length,
    important: (css.match(/!important/g) || []).length,
  };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('styleDebt.mjs')) {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  console.log(JSON.stringify(styleDebt(text), null, 1));
}
