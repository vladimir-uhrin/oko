// src/data/xlsxSheet.test.mjs — čítač XLSX pre sekciu VOĹBY (2026-10-24): zdieľané texty, bunky
// všetkých typov, diery v riadkoch, hlavička s nadbytočnými medzerami; celý zošit z ručne
// poskladaného ZIP-u (stored), aby test nezávisel od sťahovania registra MV SR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  columnIndex, decodeXmlText, parseSharedStrings, parseSheetRows, parseWorkbookSheetNames,
  readXlsxRows, readXlsxSheets, tableByHeader,
} from './xlsxSheet.js';

const SST = '<?xml version="1.0"?><sst count="5" uniqueCount="5"><si><t>Kraj</t></si>'
  + '<si><r><rPr><b/></rPr><t>Poradové   </t></r><r><t xml:space="preserve">číslo</t></r></si>'
  + '<si><t/></si><si><t>Droba &amp; spol. &lt;MBA&gt;</t></si><si><t>Bratislavsk&#xFD; kraj</t></si></sst>';

const SHEET = '<worksheet><sheetData>'
  + '<row r="1"><c r="A1" s="5" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>'
  + '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>7</v></c><c r="C2" t="inlineStr"><is><t>in&amp;line</t></is></c>'
  + '<c r="D2" t="b"><v>1</v></c><c r="E2" t="str"><v>=SUM</v></c><c r="F2" s="2"/></row>'
  + '<row r="4"/>'
  + '<row r="5"><c r="C5" t="s"><v>3</v></c></row>'
  + '</sheetData></worksheet>';

test('entity, zdieľané texty s behmi a prázdnym `<t/>`, index stĺpca', () => {
  assert.equal(decodeXmlText('a &amp; b &lt;c&gt; &#65;&#x42; &quot;q&quot; &apos;'), 'a & b <c> AB "q" \'');
  assert.equal(decodeXmlText('&unknown; stays'), '&unknown; stays');
  assert.deepEqual(parseSharedStrings(SST), ['Kraj', 'Poradové   číslo', '', 'Droba & spol. <MBA>', 'Bratislavský kraj']);
  assert.equal(columnIndex('A'), 0);
  assert.equal(columnIndex('Z1'), 25);
  assert.equal(columnIndex('AB12'), 27);
  assert.equal(columnIndex(''), -1);
  assert.deepEqual(parseWorkbookSheetNames('<workbook><sheets><sheet state="visible" name="Vo&#x13E;by" sheetId="1"/><sheet name="B" sheetId="2"/></sheets></workbook>'), ['Voľby', 'B']);
});

test('riadky: typy buniek, diery ako null, prázdny riadok ostáva prázdny', () => {
  const rows = parseSheetRows(SHEET, parseSharedStrings(SST));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], ['Kraj', 'Poradové   číslo', null, '']);
  assert.deepEqual(rows[1], ['Bratislavský kraj', '7', 'in&line', 'true', '=SUM', null]);
  assert.deepEqual(rows[2], []);
  assert.deepEqual(rows[3], [null, null, 'Droba & spol. <MBA>']);
  assert.deepEqual(parseSheetRows('', []), []);
});

test('tableByHeader nájde hlavičku bez ohľadu na diakritiku a medzery; prázdne riadky vynechá', () => {
  const rows = [
    ['Zoznam zaregistrovaných kandidátov', null],
    ['Kraj', 'Poradové             číslo kandidáta', 'Meno'],
    ['Bratislavský samosprávny kraj', '1', 'Juraj'],
    [null, null, null],
    ['Bratislavský samosprávny kraj', '2', 'Rastislav'],
  ];
  const table = tableByHeader(rows, ['kraj', 'poradove cislo kandidata', 'Meno']);
  assert.deepEqual(table.headers, ['Kraj', 'Poradové číslo kandidáta', 'Meno']);
  assert.equal(table.records.length, 2);
  assert.deepEqual(table.records[1], { Kraj: 'Bratislavský samosprávny kraj', 'Poradové číslo kandidáta': '2', Meno: 'Rastislav' });
  assert.equal(tableByHeader(rows, ['Okres']), null);
});

// ── celý zošit: ZIP bez knižnice (stored aj deflate), ako ho číta zipEntries.js ─────────────────
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
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

test('readXlsxSheets: listy v poradí zošita, texty zo sharedStrings, deflate aj stored', () => {
  const workbook = '<workbook><sheets><sheet name="Voľby predsedu VÚC" sheetId="1" r:id="rId1"/><sheet name="Druhý" sheetId="2" r:id="rId2"/></sheets></workbook>';
  const second = '<worksheet><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>';
  const buffer = zip([
    ['[Content_Types].xml', '<Types/>', false],
    ['xl/workbook.xml', workbook, true],
    ['xl/sharedStrings.xml', SST, true],
    ['xl/worksheets/sheet2.xml', second, false],
    ['xl/worksheets/sheet1.xml', SHEET, true],
  ]);
  const sheets = readXlsxSheets(buffer);
  assert.deepEqual(sheets.map((s) => s.name), ['Voľby predsedu VÚC', 'Druhý']);
  assert.deepEqual(sheets[0].rows[1][0], 'Bratislavský kraj');
  assert.deepEqual(sheets[1].rows, [['42']]);
  assert.deepEqual(readXlsxRows(buffer, 1), [['42']]);
  assert.deepEqual(readXlsxRows(buffer, 5), []);
  assert.deepEqual(readXlsxSheets(zip([['readme.txt', 'x', false]])), []);
});
