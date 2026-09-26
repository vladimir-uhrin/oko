// src/auth/ux.test.mjs — pomôcky prihlásenia (2026-09-26): sila hesla, iniciály,
// Caps Lock; umiestnenie tlačidla účtu mimo mapy a texty v oboch jazykoch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FIELD_FOR_ERROR, PASSWORD_MIN, capsLockOn, initialsFor, passwordStrength } from './ux.js';

test('sila hesla: pod 15 znakov = 0, minimum = 1, fráza/dĺžka/pestrosť rastú, jednotvárne ostáva 1', () => {
  assert.equal(PASSWORD_MIN, 15);
  assert.deepEqual(passwordStrength(''), { score: 0, key: 'empty', length: 0 });
  assert.equal(passwordStrength('kratke heslo').score, 0);
  assert.equal(passwordStrength('kratke heslo').key, 'short');
  assert.equal(passwordStrength('pätnásťznakovéh').score, 1, '15 znakov, jedna trieda');
  assert.equal(passwordStrength('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').score, 1, '40× a = jednotvárne');
  assert.equal(passwordStrength('modra lampa svieti').score, 2, 'tri slová');
  assert.equal(passwordStrength('Modra-lampa-svieti-v-noci-42').score, 3);
  assert.equal(passwordStrength('modra lampa svieti v noci nad riekou').score, 4, 'dlhá fráza');
  assert.equal(passwordStrength('X9!x9!X9!x9!X9!x9!X9!x9!X9!x9!X9!x9!').score, 1, '36 znakov, ale len 4 rôzne znaky = jednotvárne');
  assert.equal(passwordStrength('Kf7!mQ2#vZ9$pL4%wR8&tN3*yH6(bJ1)cX5').score, 4, '36 znakov, 4 triedy');
  assert.equal(passwordStrength(null).key, 'empty');
});

test('iniciály a Caps Lock', () => {
  assert.equal(initialsFor('Vladimír Uhrin'), 'VU');
  assert.equal(initialsFor('  oko  '), 'O');
  assert.equal(initialsFor('Ľubomír z Dolnej Lehoty'), 'ĽL');
  assert.equal(initialsFor(''), '');
  assert.equal(initialsFor(null), '');
  assert.equal(capsLockOn({ getModifierState: (k) => k === 'CapsLock' }), true);
  assert.equal(capsLockOn({ getModifierState: () => false }), false);
  assert.equal(capsLockOn(null), false);
  assert.equal(FIELD_FOR_ERROR.password_mismatch, 'confirm');
});

test('tlačidlo účtu: štvrtá ikona pri akciách glóbusu, nikdy pruh nad mapou; mobil pri prepínači jazyka', () => {
  const css = readFileSync(new URL('./panel.css', import.meta.url), 'utf8');
  assert.match(css, /#top-center-actions #account-actions \{ position: relative; display: flex; margin-left: 6px; \}/, 'piata ikona v skupine akcií glóbusu');
  assert.match(css, /body > #account-actions \{ position: fixed; top: 32px; left: calc\(50% \+ 98px\);/, 'záloha bez skupiny');
  assert.doesNotMatch(css, /top: 79px; left: 50%; transform: translateX\(-50%\)/, 'stredný pruh 701–1100 px (zavadzal nad mapou) je preč');
  assert.match(css, /body\.oko-mobile #top-center-actions:has\(#account-actions\) \{ gap: 4px; \}/, '5 × 36 + 4 × 4 = 196 px: pri 375 px sa zmestí medzi logo a SK · EN');
  assert.match(css, /@media \(max-width: 374px\) \{ body\.oko-mobile #top-center-actions #account-actions \{ position: fixed; top: 52px; right: 12px;/, 'úzke telefóny: pod prepínačom jazyka');
  const panel = readFileSync(new URL('./panel.js', import.meta.url), 'utf8');
  assert.match(panel, /\(document\.getElementById\('top-center-actions'\) \|\| document\.body\)\.append\(mount\)/, 'launcher sa pripája do skupiny akcií');
  assert.match(css, /\.auth-launcher \{[^}]*width: 36px; height: 36px;[^}]*border-radius: 50%/, 'kruh ako susedné ikony');
  assert.match(css, /body\.ui-clean-view #account-actions,\s*body\.cockpit-mode #account-actions,\s*body\.scene-playback-mode #account-actions,\s*body\.recording-mode #account-actions \{ display: none; \}/, 'schová sa s ostatným chrómom');
  assert.match(css, /\.auth-menu \{ position: absolute; top: 44px;/, 'ponuka pod tlačidlom');
});

test('texty účtu: každý kľúč v SK aj EN, SK vyká (žiadne „tvoj/skús/vyber"), nové kľúče ponuky a merača', async () => {
  const { AUTH_EN, AUTH_SK } = await import('./strings.js');
  const en = Object.keys(AUTH_EN).sort(); const sk = Object.keys(AUTH_SK).sort();
  assert.deepEqual(sk, en, 'rovnaké kľúče');
  for (const k of ['auth.menu', 'auth.open-center', 'auth.continue-guest', 'auth.caps-lock', 'auth.strength.short', 'auth.strength.excellent', 'auth.hero-title', 'auth.hero-1', 'auth.hero-2', 'auth.hero-3']) assert.ok(AUTH_SK[k] && AUTH_EN[k], k);
  // \b je len ASCII — „Uložiť" by cez ž prešlo ako „ulož"; hranice slov cez \p{L}.
  const informal = /(?<!\p{L})(tvoj|tvoja|tvoje|tvojho|tvojej|tvojom|tvojou|tvojich|skús|vyber|použi|skontroluj|potvrď|pokračuj|prihlás sa|ulož|nahraď|nemaž|zvoľ|obnov)(?!\p{L})/iu;
  for (const [k, v] of Object.entries(AUTH_SK)) assert.doesNotMatch(v, informal, `${k}: ${v}`);
  const strings = readFileSync(new URL('../i18nStrings.js', import.meta.url), 'utf8');
  assert.doesNotMatch(strings, /'auth\.[^']+': "[^"]*\b(Tvoj|tvoj|Skús |Vyber |Použi )\b/u, 'aj zlúčené kľúče v i18nStrings vykajú');
});
