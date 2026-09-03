// src/data/aircraftPhotoLicense.test.mjs
/**
 * Fotka lietadla v karte — preverené 2026-09-03 a ZÁMERNE NEIMPLEMENTOVANÉ.
 *
 * adsbdb vracia `url_photo` a `url_photo_thumbnail`, takže to vyzerá ako
 * jednoriadkové vylepšenie. Nie je. Tie snímky pochádzajú z airport-data.com,
 * sú komunitné (autorské právo drží každý fotograf), odpoveď adsbdb NENESIE
 * meno fotografa a dohľadať ho inde nejde — airport-data ac_thumb.json meno
 * vracia, ale pre ten istý hex vracia INÚ fotku (nezhoda 2 zo 4 meraných).
 *
 * Najpravdepodobnejší budúci omyl je preto „ušetriť request" a zlepiť adsbdb
 * fotku s menom fotografa z druhého volania — čím by sa zhruba polovica
 * snímok pripísala cudziemu človeku. Komentár na to nestačí; toto je test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');

test('adsbdb parser nesmie čítať fotku bez autorstva', () => {
  const parser = /function parseAircraft\(json\) \{[\s\S]*?\n  \}/.exec(config)?.[0];
  assert.ok(parser, 'parseAircraft sa nenašiel — presunul sa?');
  assert.doesNotMatch(parser, /url_photo/, 'fotka bez mena fotografa sa nesmie preposielať do klienta');
  // Polia, ktoré čítať SMIE, sú faktické údaje o stroji, nie autorské dielo.
  for (const allowed of [/icao_type/, /registration/, /manufacturer/]) {
    assert.match(parser, allowed);
  }
});

test('rozhodnutie je v kóde vysvetlené, nie len vynechané', () => {
  // Bez zdôvodnenia by to vyzeralo ako opomenutie a niekto by to „doplnil".
  assert.match(config, /airport-data\.com/, 'komentár menuje skutočný zdroj snímok');
  assert.match(config, /planespotters/i, 'komentár menuje jedinú prijateľnú cestu');
});

test('žiadna fotka lietadla sa nikde nezobrazuje', () => {
  // Tripwire pre celý klient: keby sa url_photo objavilo v ktoromkoľvek
  // module, znamená to, že sa obišiel parser aj toto rozhodnutie.
  const modules = [
    '../data/flights.js',
    '../data/militaryFlights.js',
    '../data/contactHoverCard.js',
    '../ui.js',
  ];
  for (const path of modules) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /url_photo/, `${path}: fotka sa nesmie zobrazovať`);
  }
});
