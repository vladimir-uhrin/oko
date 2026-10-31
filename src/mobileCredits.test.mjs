// src/mobileCredits.test.mjs — kredity Cesium ion + Google na mobile (2026-10-31, vlastník: „toto skry alebo
// to ozaj daj niekam dolu"): úzky stĺpec v ľavom dolnom rohu hneď nad lištou, vedľa doku. Skryť sa nesmú
// (podmienky Cesium ion a Google; logo Google sa nikdy neodstraňuje) — pripnuté je, že žiadna časť atribúcie
// nemá display: none, len ozdobný oddeľovač. Správanie zdvihu je v mobileShell.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('./mobileShell.js', import.meta.url), 'utf8');

function rule(selector) {
  const i = css.indexOf(`\n${selector} {`);
  assert.ok(i >= 0, `pravidlo ${selector}`);
  return css.slice(i, css.indexOf('}', i));
}

test('style.css: na mobile sú kredity úzky stĺpec vľavo dole, logá pod sebou, nič z atribúcie sa neskrýva', () => {
  const outer = rule('body.oko-mobile:not(.ui-clean-view):not(.recording-mode) #cesium-credits');
  assert.match(outer, /left: 8px;/);
  assert.match(outer, /max-width: 84px;/, 'užšie než voľný pás vľavo od doku (412 px: 119 px, 360 px: 93 px)');
  assert.match(outer, /white-space: normal;/, 'texty sa zalamujú, nie posúvajú');
  assert.match(outer, /font-size: 7px;/);
  const inner = rule('body.oko-mobile #cesium-credits .cesium-widget-credits');
  assert.match(inner, /position: static;/);
  assert.doesNotMatch(inner, /overflow-x: auto/, 'už žiadne vodorovné posúvanie');
  const stacked = rule('body.oko-mobile #cesium-credits .cesium-credit-logoContainer,\nbody.oko-mobile #cesium-credits .cesium-credit-textContainer,\nbody.oko-mobile #cesium-credits .cesium-credit-wrapper,\nbody.oko-mobile #cesium-credits .cesium-credit-expand-link');
  assert.match(stacked, /display: block !important;/, 'Cesium píše inline display: inline každú snímku');
  assert.match(css, /body\.oko-mobile #cesium-credits img\[src\*="ion-credit"\] \{ height: 13px; width: auto;/);
  assert.match(css, /body\.oko-mobile #cesium-credits img\[alt="Google"\] \{ height: 13px; width: auto;/);
  assert.match(css, /body\.oko-mobile #cesium-credits \.cesium-credit-delimiter \{ font-size: 0; line-height: 0; \}/, 'oddeľovač „•" nie je atribúcia — nulová veľkosť, nie display: none (creditAttribution.test)');
  // Žiadne pravidlo neskrýva odkaz na cenník ion, logo Google ani „Data attribution".
  for (const sel of ['cesium-credit-expand-link', 'pricing', 'alt="Google"', 'ion-credit']) {
    const hits = [...css.matchAll(new RegExp(`[^\\n]*${sel.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[^{]*\\{[^}]*display: none`, 'g'))];
    assert.equal(hits.length, 0, `${sel} sa nikdy neskrýva`);
  }
});

test('mobileShell.js: spodok kreditov = zdvih doku; dok s presahom pilulky, os počasia a výber vrstiev sú prekážky', () => {
  assert.match(shell, /const base = lift;\n\s+credits\.style\.bottom = lift > 0 \? `\$\{base\}px` : '';/);
  assert.match(shell, /top: dockRect\.top - VOICE_OVERHANG_PX, bottom: dockRect\.bottom/);
  assert.match(shell, /\.\.\.CREDIT_OBSTACLE_IDS\n/);
  assert.doesNotMatch(shell, /lift \+ dockHeight \+ VOICE_OVERHANG_PX \+ DOCK_LIFT_GAP_PX/, 'kredity už nesedia paušálne nad dokom');
});
