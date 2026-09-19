// scripts/lib/pipelineTags.test.mjs
// Čítanie OSM tagu `diameter` a klasifikátor prepravnej siete (2026-09-19, etapa 2).
//
// Prečo to má vlastný test: pôvodná diameterMm() stripovala všetky nečíselné
// znaky a jednotku hádala podľa veľkosti čísla, takže `24"` čítala ako 24 mm.
// To je pod podlahou 150 mm, čiže 24-palcová magistrála sa ticho zahodila ako
// prípojka — a naopak `8"` → 8000 mm prešlo cez pravidlo DN ≥ 300 s nezmyslom.
// Priemer pritom riadi aj hrúbku čiary, takže chyba bola vidieť na mape.
import test from 'node:test';
import assert from 'node:assert/strict';

import { diameterMm, makeClassifier } from './pipelineTags.mjs';

test('diameterMm číta palce, ktoré stará verzia čítala ako milimetre', () => {
  // Jadro opravy: toto všetko predtým padlo pod podlahu 150 mm a zahodilo sa.
  assert.equal(diameterMm({ diameter: '24"' }), 610);
  assert.equal(diameterMm({ diameter: '42"' }), 1067);
  assert.equal(diameterMm({ diameter: '48 in' }), 1219);
  assert.equal(diameterMm({ diameter: '36 inch' }), 914);
  assert.equal(diameterMm({ diameter: '30″' }), 762);
  assert.equal(diameterMm({ diameter: '12”' }), 305);
  // A opačný smer: úzka rúra v palcoch NESMIE vyjsť ako magistrála.
  // Stará verzia z toho spravila 8000 mm a pravidlo DN ≥ 300 ju pustilo dnu.
  assert.equal(diameterMm({ diameter: '8"' }), 203);
  assert.equal(diameterMm({ diameter: '8.63"' }), 219);
});

test('diameterMm zvláda mm, cm, m a holé čísla', () => {
  assert.equal(diameterMm({ diameter: '700 mm' }), 700);
  assert.equal(diameterMm({ diameter: '1400' }), 1400);
  assert.equal(diameterMm({ diameter: 'DN 800' }), 800);
  assert.equal(diameterMm({ diameter: '80 cm' }), 800);
  assert.equal(diameterMm({ diameter: '1.8 m' }), 1800);
  assert.equal(diameterMm({ diameter: '1.4' }), 1400, 'holé číslo pod 10 je v metroch');
  assert.equal(diameterMm({ diameter: '1,4' }), 1400, 'desatinná čiarka ako v strednej Európe');
  assert.equal(diameterMm({ diameter: '600x900' }), 900, 'dvojica rúr — ber tú väčšiu');
  assert.equal(diameterMm({ diameter: '600×900' }), 900, 'aj s typografickým krížikom');
});

test('diameterMm vráti null na nezmysel namiesto toho, aby si vymyslel číslo', () => {
  assert.equal(diameterMm({}), null);
  assert.equal(diameterMm({ diameter: '' }), null);
  assert.equal(diameterMm({ diameter: '   ' }), null);
  assert.equal(diameterMm({ diameter: 'unknown' }), null);
  assert.equal(diameterMm({ diameter: '-300' }), null);
  assert.equal(diameterMm({ diameter: '0' }), null);
});

const classify = makeClassifier({
  excludedUsage: /^(distribution|household_distribution|facility|gathering|service|industrial|storage)$/,
  operatorRe: /eustream|gazprom/i,
});

test('klasifikátor: poradie pravidiel rozhoduje', () => {
  assert.equal(classify({ usage: 'transmission' }, false), 'transmission');
  assert.equal(classify({ usage: 'distribution', name: 'X' }, false), null, 'distribúcia von aj s menom');
  assert.equal(classify({ usage: 'gathering' }, true), null, 'vylúčené usage porazí aj členstvo v relácii');
  assert.equal(classify({}, true), 'relation');
  assert.equal(classify({ diameter: '900 mm' }, false), 'diameter');
  assert.equal(classify({ diameter: '100 mm', name: 'X' }, false), null, 'podlaha 150 mm porazí meno');
  assert.equal(classify({ name: 'Nejaký plynovod' }, false), 'name');
  assert.equal(classify({ ref: 'TAG I' }, false), 'name');
  assert.equal(classify({ operator: 'eustream a.s.' }, false), 'operator');
  assert.equal(classify({ operator: 'Obecná plynárenská' }, false), null);
  assert.equal(classify({}, false), null);
});

test('klasifikátor s opraveným priemerom mení výsledok pri palcoch', () => {
  // Presne ten prípad, kvôli ktorému sa oprava robila: 24-palcová magistrála
  // bez mena a bez usage. Stará verzia: 24 mm → pod podlahou → null.
  assert.equal(classify({ diameter: '24"' }, false), 'diameter');
  // A úzka 8-palcová rúra, ktorú stará verzia nafúkla na 8000 mm a pustila dnu.
  assert.equal(classify({ diameter: '8"' }, false), null);
});
