// src/data/portTitleFlag.test.mjs
// Vlajka prístavu (2026-09-19): WPI nesie MENO štátu, nie ISO kód.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portTitleFlag } from './portsData.js';

test('portTitleFlag: meno štátu z WPI → ISO2 malými písmenami; kód prejde; neznáme meno bez vlajky', () => {
  assert.equal(portTitleFlag({ country: 'Ukraine' }), 'ua');
  assert.equal(portTitleFlag({ country: 'United States' }), 'us');
  assert.equal(portTitleFlag({ country: 'Madagascar' }), 'mg');
  assert.equal(portTitleFlag({ country: 'NL' }), 'nl', 'holý kód ostáva kódom');
  assert.equal(portTitleFlag({ country: 'Atlantis' }), null);
  assert.equal(portTitleFlag({ country: '' }), null);
  assert.equal(portTitleFlag({}), null);
});
