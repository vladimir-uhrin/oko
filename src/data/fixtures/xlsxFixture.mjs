// src/data/fixtures/xlsxFixture.mjs — ZIP a XLSX poskladané bez knižnice pre testy čítača
// (xlsxSheet.test.mjs) a služby VOĹBY (volbyService.test.mjs). Stored aj deflate, bez ZIP64.
import { deflateRawSync } from 'node:zlib';

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/**
 * ZIP z členov [meno, obsah (string|Buffer), deflate?].
 * @param {Array<[string, string|Buffer, boolean?]>} files
 * @returns {Buffer}
 */
export function zipBuffer(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, deflate = true] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const stored = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(stored.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(stored.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, stored);
    centrals.push(central, nameBuf);
    offset += head.length + nameBuf.length + stored.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => { let n = i + 1; let out = ''; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; };

/**
 * XLSX zošit s vloženými textami (`inlineStr`), null = prázdna bunka.
 * @param {Array<{name: string, rows: Array<Array<string|number|null>>}>} sheets
 * @returns {Buffer}
 */
export function xlsxBuffer(sheets) {
  const workbook = `<workbook><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const files = [['[Content_Types].xml', '<Types/>'], ['xl/workbook.xml', workbook]];
  sheets.forEach((sheet, i) => {
    const rows = sheet.rows.map((row, ri) => {
      const cells = row.map((v, ci) => (v == null ? '' : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    files.push([`xl/worksheets/sheet${i + 1}.xml`, `<worksheet><sheetData>${rows}</sheetData></worksheet>`]);
  });
  return zipBuffer(files);
}
