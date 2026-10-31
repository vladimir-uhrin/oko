// scripts/lib/iconFont.mjs — výrez písma Material Symbols Outlined (2026-10-31).
//
// Pozadie: index.html načítaval z Google Fonts celé písmo Material Symbols Outlined (PageSpeed
// 2026-10-31: 324 KB, najväčší súbor po Cesiu a balíku appky), hoci appka používa len niekoľko desiatok
// ikon — ligatúry v prvkoch .material-symbols-outlined. Výrez len s použitými ikonami má jednotky KB,
// leží v public/fonts/ (bez tretej domény, s preloadom) a Google Fonts ostávajú len pre JetBrains Mono
// a Inter. Tento modul:
//   • zbiera názvy ikon z HTML a JS (collectIconNames): ligatúry v značkách aj názvy skladané v kóde —
//     textContent prvkov s triedou, el('span', 'material-symbols-outlined', …), vlastnosť icon:,
//     mapy …ICONS a parametre funkcií podľa ich miest volania (makeButton(doc, …, 'share', …));
//   • dáva odtlačok súboru písma a doplní ho ako ?v= do odkazu preload v index.html a do @font-face
//     v style.css (iconFontCacheBustPlugin) — statický server dáva URL s ?v= cache na rok
//     (scripts/oko-static-server.mjs, cacheControlFor), rovnako ako preloaderFlow.js.
// Samotný výrez sťahuje scripts/build-icon-font.mjs (Google Fonts css2 s icon_names=); zoznam ikon
// a odtlačok drží public/fonts/material-symbols-subset.json a stráži scripts/lib/iconFont.test.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const ICON_FONT_FAMILY = 'Material Symbols Outlined';
export const ICON_CLASS = 'material-symbols-outlined';
/** Cesta výrezu v public/ a jeho verejná URL. */
export const ICON_FONT_FILE = 'fonts/material-symbols-subset.woff2';
export const ICON_FONT_MANIFEST = 'fonts/material-symbols-subset.json';
export const ICON_FONT_URL = `/${ICON_FONT_FILE}`;
/**
 * Osi písma: statická inštancia, ktorú index.html žiadal z Google Fonts aj doteraz
 * (`opsz,wght,FILL,GRAD@20,400,0,0`) — rovnaký vzhľad, najmenší súbor.
 */
export const ICON_FONT_AXES = Object.freeze({ opsz: 20, wght: 400, FILL: 0, GRAD: 0 });
/** Stránky, v ktorých sa hľadajú ligatúry (chýbajúce sa preskočia). */
export const ICON_MARKUP_FILES = Object.freeze(['index.html', 'account.html', 'admin.html', 'privacy.html', 'public/privacy.html']);
/** Zoznam názvov ikon Material Symbols (kontrola preklepov pri stavbe — Google neznámy názov potichu vynechá). */
export const ICON_CODEPOINTS_URL = 'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints';

const NAME = '[a-z][a-z0-9_]*';
const NAME_RE = new RegExp(`^${NAME}$`);
const LITERAL_RE = new RegExp(`(['"])(${NAME})\\1`, 'g');
const CLASS_IN_QUOTES = `(['"])(?:[^'"]*\\s)?${ICON_CLASS}(?:\\s[^'"]*)?\\2`;

/** Názvy ikon v reťazcových literáloch výrazu ('close', `a ? 'x' : 'y'`). Pure. */
export function iconLiterals(expr) {
  const out = [];
  for (const m of String(expr || '').matchAll(LITERAL_RE)) out.push(m[2]);
  return out;
}

/** Je výraz holý identifikátor (parameter alebo premenná), nie literál? Pure. */
function bareIdentifier(expr) {
  const s = String(expr || '').trim();
  return /^[A-Za-z_$][\w$]*$/.test(s) ? s : null;
}

/**
 * Ligatúry v značkách `<span class="… material-symbols-outlined …">názov</span>` — v HTML aj v reťazcoch
 * JS (innerHTML). Pure.
 * @param {string} text
 * @returns {Set<string>}
 */
export function iconNamesFromMarkup(text) {
  const out = new Set();
  const re = new RegExp(`class=(["'])(?:[^"']*\\s)?${ICON_CLASS}(?:\\s[^"']*)?\\1[^>]*>\\s*(${NAME})\\s*<`, 'g');
  for (const m of String(text || '').matchAll(re)) out.add(m[2]);
  return out;
}

/** Argumenty volania od pozície za `(`: delí na vrchnej úrovni čiarok, rešpektuje úvodzovky a zátvorky. Pure. */
export function splitCallArgs(text, from) {
  const args = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += text[i + 1] ?? ''; i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth += 1; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth -= 1; cur += c; continue;
    }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

/** Názvy parametrov z textu zoznamu parametrov (bez predvolených hodnôt; destrukturácia = ''). Pure. */
function paramNames(list) {
  return splitCallArgs(`${list})`, 0).map((p) => {
    const s = p.replace(/^\.\.\./, '').replace(/=.*$/s, '').trim();
    return /^[A-Za-z_$][\w$]*$/.test(s) ? s : '';
  });
}

/**
 * Funkcie v súbore, ktoré majú parameter daného mena: [{name, index}]. Hľadá deklarácie `function f(a, b)`,
 * šípky `const f = (a, b) =>` / `const f = a =>` a metódy `f(a, b) {`. Pure.
 */
export function functionsWithParam(text, param) {
  const found = [];
  const add = (name, list) => {
    const index = paramNames(list).indexOf(param);
    if (index >= 0 && !found.some((f) => f.name === name && f.index === index)) found.push({ name, index });
  };
  for (const m of text.matchAll(/\bfunction\s+([\w$]+)\s*\(([^)]*)\)/g)) add(m[1], m[2]);
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g)) add(m[1], m[2]);
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1], m[2]);
  for (const m of text.matchAll(/(?:^|[\s;{}])([\w$]+)\s*\(([^)]*)\)\s*\{/g)) {
    if (!/^(if|for|while|switch|catch|function|return)$/.test(m[1])) add(m[1], m[2]);
  }
  return found;
}

/**
 * Názvy ikon, ktoré do parametra funkcie prídu z miest volania v tom istom súbore:
 * `icon.textContent = iconName` + `makeButton(doc, 'card-share', 'share', …)` → share. Pure.
 */
export function iconNamesViaParam(text, param, depth = 0) {
  const out = new Set();
  if (depth > 2) return out;
  for (const fn of functionsWithParam(text, param)) {
    const callRe = new RegExp(`(?<![\\w$.'"\`])${fn.name.replace(/\$/g, '\\$')}\\(`, 'g');
    for (const call of text.matchAll(callRe)) {
      const args = splitCallArgs(text, call.index + call[0].length);
      const arg = args[fn.index];
      if (arg === undefined) continue;
      for (const n of iconLiterals(arg)) out.add(n);
      const id = bareIdentifier(arg);
      if (id && id !== param) for (const n of iconNamesViaParam(text, id, depth + 1)) out.add(n);
    }
  }
  return out;
}

/** Premenné viazané na prvok ikony (className = '…', el(…'material-symbols-outlined'…), querySelector). Pure. */
export function iconElementVariables(text) {
  const vars = new Set();
  for (const m of text.matchAll(new RegExp(`\\b([\\w$]+)\\.className\\s*=\\s*${CLASS_IN_QUOTES}`, 'g'))) vars.add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*el\\([^;]*?${CLASS_IN_QUOTES}`, 'g'))) vars.add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*[\\w$.]+\\.querySelector\\((['"])\\.${ICON_CLASS}\\2\\)`, 'g'))) vars.add(m[1]);
  return vars;
}

/**
 * Názvy ikon skladané v JS. Súbor bez triedy material-symbols-outlined nič nedáva (vlastnosť icon: v module
 * vrstvy je jej vlastný glyf, nie Material). Pure.
 * @param {string} text
 * @returns {Set<string>}
 */
export function iconNamesFromScript(text) {
  const out = new Set();
  const src = String(text || '');
  if (!src.includes(ICON_CLASS)) return out;
  const addExpr = (expr) => {
    for (const n of iconLiterals(expr)) out.add(n);
    const id = bareIdentifier(expr);
    if (id) for (const n of iconNamesViaParam(src, id)) out.add(n);
  };
  for (const n of iconNamesFromMarkup(src)) out.add(n);
  // prvok.textContent = 'close' / a ? 'x' : 'y' / parameter
  for (const v of iconElementVariables(src)) {
    const re = new RegExp(`\\b${v.replace(/\$/g, '\\$')}\\.textContent\\s*=\\s*([^;\\n]+);`, 'g');
    for (const m of src.matchAll(re)) addExpr(m[1]);
  }
  // el(doc, 'span', 'material-symbols-outlined …', názov | parameter)
  for (const m of src.matchAll(new RegExp(`\\bel\\(\\s*(?:doc,\\s*)?(['"])span\\1,\\s*${CLASS_IN_QUOTES},\\s*([^)]*)\\)`, 'g'))) addExpr(m[3]);
  // el(doc, 'span', { className: '… material-symbols-outlined …', text: názov | parameter })
  for (const m of src.matchAll(new RegExp(`\\{[^}]*className:\\s*${CLASS_IN_QUOTES.replace('\\2', '\\1')}[^}]*\\btext:\\s*([^,}]+)[,}]`, 'g'))) addExpr(m[2]);
  // vlastnosť icon: / launchIcon: v objektoch (položky ponuky, dok počasia, súhlas)
  for (const m of src.matchAll(/\b[\w$]*[iI]con\s*:\s*([^,}\n]+)/g)) for (const n of iconLiterals(m[1])) out.add(n);
  // mapy FIELD_ICONS = Object.freeze({ wind: 'air', … }) a záloha FIELD_ICONS[id] || 'circle'
  for (const m of src.matchAll(/\b[A-Z][A-Z_]*ICONS\b[^=;]*=\s*(?:Object\.freeze\()?\{([^}]*)\}/g)) for (const n of iconLiterals(m[1])) out.add(n);
  for (const m of src.matchAll(new RegExp(`\\b[A-Z][A-Z_]*ICONS\\[[^\\]]+\\]\\s*\\|\\|\\s*(['"])(${NAME})\\1`, 'g'))) out.add(m[2]);
  return out;
}

function walkScripts(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'local_data' && entry.name !== 'node_modules') walkScripts(absolute, out); continue; }
    if (!entry.isFile() || !/\.(?:js|mjs)$/.test(entry.name) || /\.test\.(?:js|mjs)$/.test(entry.name)) continue;
    out.push(absolute);
  }
  return out;
}

/**
 * Všetky názvy ikon použité v appke: stránky z ICON_MARKUP_FILES a src/**\/*.js (bez testov a local_data).
 * @param {string} root koreň repozitára
 * @returns {{names: string[], sources: Record<string, string[]>}} zoradené názvy a kde sa každý používa
 */
export function collectIconNames(root) {
  const sources = new Map();
  const note = (name, file) => {
    if (!NAME_RE.test(name)) return;
    if (!sources.has(name)) sources.set(name, new Set());
    sources.get(name).add(file.split(path.sep).join('/'));
  };
  for (const rel of ICON_MARKUP_FILES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    for (const n of iconNamesFromMarkup(fs.readFileSync(file, 'utf8'))) note(n, rel);
  }
  for (const file of walkScripts(path.join(root, 'src'), [])) {
    const rel = path.relative(root, file);
    for (const n of iconNamesFromScript(fs.readFileSync(file, 'utf8'))) note(n, rel);
  }
  const names = [...sources.keys()].sort();
  return { names, sources: Object.fromEntries(names.map((n) => [n, [...sources.get(n)].sort()])) };
}

/** Odtlačok obsahu písma do ?v= (10 znakov sha256, ako preloaderFlow.js vo vite.config.js). Pure. */
export function fontFingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

/** Odtlačok výrezu v public/, alebo null bez súboru. */
export function readIconFontFingerprint(root) {
  try { return fontFingerprint(fs.readFileSync(path.join(root, 'public', ICON_FONT_FILE))); } catch { return null; }
}

/**
 * Doplní ?v=<odtlačok> za URL výrezu v HTML (href="…") aj CSS (url(…)); už verzovaná URL ostáva. Pure.
 * @param {string} text
 * @param {string|null} v
 */
export function versionIconFontUrls(text, v) {
  if (!v) return text;
  const re = new RegExp(`${ICON_FONT_URL.replace(/[.]/g, '\\.')}(?=["')])`, 'g');
  return String(text).replace(re, () => `${ICON_FONT_URL}?v=${v}`);
}

function samePath(a, b) {
  const norm = (p) => String(p).split('?')[0].replace(/\\/g, '/');
  const x = norm(a);
  const y = norm(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * Vite plugin: odtlačok výrezu do odkazu preload v index.html a do @font-face v style.css — v dev aj
 * v builde (style.css ide cez transform pipeline ako každý modul). Bez súboru písma nemení nič.
 * @param {{root: string, stylePath?: string}} o
 * @returns {import('vite').Plugin}
 */
export function iconFontCacheBustPlugin({ root, stylePath = 'style.css' }) {
  const styleFile = path.resolve(root, stylePath);
  return {
    name: 'oko-icon-font-cache-bust',
    enforce: 'pre',
    transformIndexHtml(html) {
      return versionIconFontUrls(html, readIconFontFingerprint(root));
    },
    transform(code, id) {
      if (!samePath(id, styleFile)) return null;
      const v = readIconFontFingerprint(root);
      if (!v) return null;
      return { code: versionIconFontUrls(code, v), map: null };
    },
  };
}

/** URL css2 Google Fonts s výrezom len pre dané ikony (statická inštancia podľa osí). Pure. */
export function googleSubsetCssUrl(names, axes = ICON_FONT_AXES) {
  const family = `Material+Symbols+Outlined:opsz,wght,FILL,GRAD@${axes.opsz},${axes.wght},${axes.FILL},${axes.GRAD}`;
  return `https://fonts.googleapis.com/css2?family=${family}&icon_names=${[...new Set(names)].sort().join(',')}&display=block`;
}

/** URL woff2 z odpovede css2 (@font-face … src: url(…) format('woff2')). Pure. */
export function fontUrlFromCss(css) {
  const m = String(css || '').match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\('woff2'\)/);
  return m ? m[1] : null;
}

/** Názvy ikon zo súboru .codepoints („názov hex" na riadok). Pure. */
export function parseCodepoints(text) {
  const out = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const name = line.trim().split(/\s+/)[0];
    if (name) out.add(name);
  }
  return out;
}
