// Zdieľaný RFC-4180 CSV parser pre build skripty bundlovaných datasetov
// (letiská, prístavy). Mená s čiarkami v úvodzovkách a zdvojené úvodzovky
// naivný String.split(',') korumpujú — vždy skutočný parser. Strháva BOM
// (WPI CSV ho má) a toleruje CRLF.

/**
 * @param {string} text Whole CSV body.
 * @returns {string[][]} Rows of raw cell strings.
 */
export function parseCsv(text) {
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Header + cell rows → objects keyed by header names.
 * @param {string[][]} rows parseCsv output (first row = header).
 * @returns {{header: string[], objects: object[]}}
 */
export function csvObjects(rows) {
  const [header, ...rest] = rows;
  const objects = rest.map(
    (cells) => Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ''])),
  );
  return { header, objects };
}
