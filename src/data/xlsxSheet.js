// src/data/xlsxSheet.js
/**
 * @module xlsxSheet
 * @description Minimálny čítač tabuliek XLSX (2026-10-24, sekcia VOĹBY): register kandidátov
 * MV SR aj tabuľky ŠÚ SR (územné členenie, neskôr výsledky) sú XLSX bez CSV/JSON alternatívy.
 * Žiadna závislosť — XLSX je ZIP (src/data/zipEntries.js) s XML listami: `xl/sharedStrings.xml`
 * drží texty, `xl/worksheets/sheetN.xml` bunky `<c r="A1" t="s"><v>index</v></c>`. Číta len to,
 * čo tieto tabuľky používajú: zdieľané texty, vložené texty (`inlineStr`), čísla, booleany
 * a reťazce vzorcov (`str`). Štýly, dátumy ani zlúčené bunky nerieši — hodnoty vracia ako text.
 * Len Node (Buffer, zlib). Pure: rovnaký vstup, rovnaké riadky.
 */
import { readZipEntries } from './zipEntries.js';

const ENTITIES = Object.freeze({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' });

/** XML entity (`&amp;`, `&#x1F;`, `&#39;`) → text. Pure. */
export function decodeXmlText(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (whole, body) => {
    const lower = body.toLowerCase();
    if (lower[0] === '#') {
      const code = lower[1] === 'x' ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[lower] ?? whole;
  });
}

/** Všetky `<t>` v jednom kuse XML spojené dohora (bohatý text má viac behov `<r><t>`). */
function joinTextRuns(chunk) {
  const normalized = String(chunk).replace(/<t\b[^>]*\/>/g, '<t></t>');
  let out = '';
  for (const m of normalized.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXmlText(m[1]);
  return out;
}

/** `xl/sharedStrings.xml` → pole textov v poradí indexov. Pure. */
export function parseSharedStrings(xml) {
  const out = [];
  for (const m of String(xml ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) out.push(joinTextRuns(m[1]));
  return out;
}

/** Písmená stĺpca z odkazu bunky (`AB12` → 27). Pure. */
export function columnIndex(ref) {
  let n = 0;
  for (const ch of String(ref ?? '').toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/** Názvy listov z `xl/workbook.xml` v poradí. Pure. */
export function parseWorkbookSheetNames(xml) {
  return [...String(xml ?? '').matchAll(/<sheet\b[^>]*?\bname="([^"]*)"/g)].map((m) => decodeXmlText(m[1]));
}

/**
 * `xl/worksheets/sheetN.xml` → riadky ako polia textov (chýbajúce bunky = null). Riadky sa
 * vracajú v poradí výskytu bez ohľadu na atribút `r` — prázdne riadky Excel nezapisuje.
 * @param {string} xml
 * @param {string[]} [sharedStrings]
 * @returns {Array<Array<string|null>>}
 */
export function parseSheetRows(xml, sharedStrings = []) {
  const rows = [];
  for (const row of String(xml ?? '').matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [];
    let width = 0;
    for (const cell of String(row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] || '';
      const body = cell[2] || '';
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
      const column = ref ? columnIndex(ref) : width;
      if (column < 0) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || 'n';
      let value = null;
      if (type === 's') {
        const index = Number(/<v>([^<]*)<\/v>/.exec(body)?.[1]);
        value = Number.isInteger(index) ? (sharedStrings[index] ?? null) : null;
      } else if (type === 'inlineStr') {
        value = joinTextRuns(body);
      } else {
        const raw = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        if (raw != null) value = type === 'b' ? (raw === '1' ? 'true' : 'false') : decodeXmlText(raw);
      }
      cells[column] = value;
      width = Math.max(width, column + 1);
    }
    for (let i = 0; i < width; i += 1) if (cells[i] === undefined) cells[i] = null;
    rows.push(cells);
  }
  return rows;
}

/**
 * Celý zošit: listy s menami a riadkami.
 * @param {Buffer|Uint8Array} buffer XLSX
 * @returns {Array<{name: string, rows: Array<Array<string|null>>}>}
 */
export function readXlsxSheets(buffer) {
  const entries = readZipEntries(buffer);
  const text = (name) => entries.find((e) => e.name === name)?.read().toString('utf8') ?? '';
  const sharedStrings = parseSharedStrings(text('xl/sharedStrings.xml'));
  const names = parseWorkbookSheetNames(text('xl/workbook.xml'));
  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(/sheet(\d+)/.exec(a.name)[1]) - Number(/sheet(\d+)/.exec(b.name)[1]));
  return sheets.map((entry, i) => ({ name: names[i] || entry.name, rows: parseSheetRows(entry.read().toString('utf8'), sharedStrings) }));
}

/** Riadky prvého (alebo i-teho) listu; prázdny zošit → []. */
export function readXlsxRows(buffer, sheetIndex = 0) {
  return readXlsxSheets(buffer)[sheetIndex]?.rows ?? [];
}

/**
 * Tabuľka s hlavičkou: nájde prvý riadok, v ktorom sú všetky `requiredHeaders` (porovnanie
 * bez diakritiky, veľkosti písmen a nadbytočných medzier — hlavičky MV SR majú v bunke
 * viacnásobné medzery „Poradové               číslo kandidáta"), a vráti objekty podľa hlavičky.
 * @param {Array<Array<string|null>>} rows
 * @param {string[]} requiredHeaders
 * @returns {{ headers: string[], records: Array<Record<string, string|null>> }|null} null bez hlavičky
 */
export function tableByHeader(rows, requiredHeaders) {
  const key = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const wanted = requiredHeaders.map(key);
  const headerAt = rows.findIndex((row) => {
    const cells = row.map(key);
    return wanted.every((w) => cells.includes(w));
  });
  if (headerAt < 0) return null;
  const headers = rows[headerAt].map((h) => String(h ?? '').replace(/\s+/g, ' ').trim());
  const records = [];
  for (const row of rows.slice(headerAt + 1)) {
    if (!row.some((v) => v != null && String(v).trim() !== '')) continue;
    const record = {};
    headers.forEach((h, i) => { if (h) record[h] = row[i] ?? null; });
    records.push(record);
  }
  return { headers, records };
}
