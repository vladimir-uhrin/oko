// src/data/airIconLod.test.mjs
// LOD vzdušných ikon: bodka namiesto siluety pri oddialenom pohľade
// (2026-09-03 — 2 437 kontaktov × 22 px = 158 % plochy obrazovky).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AIR_DOT_ENTER_ALT_M,
  AIR_DOT_EXIT_ALT_M,
  FLEET_MODEL_ALT_CEIL_M,
  airDotLodActive,
} from './airIconLod.js';

test('hysterézia: pásmo medzi prahmi drží predchádzajúcu odpoveď', () => {
  // Bez hystérie by kamera postávajúca na hranici prepínala tvar celej
  // flotily tam a späť — presne ten druh blikania, ktorý stál commit 02965d0.
  assert.equal(airDotLodActive(1_200_000, false), true, 'vysoko → bodky');
  assert.equal(airDotLodActive(300_000, false), false, 'nízko → siluety');
  // Vnútri pásma [800k, 950k) rozhoduje predchádzajúci stav.
  assert.equal(airDotLodActive(850_000, false), false, 'stúpam: ešte siluety');
  assert.equal(airDotLodActive(850_000, true), true, 'klesám: ešte bodky');
  // Na presných prahoch.
  assert.equal(airDotLodActive(AIR_DOT_ENTER_ALT_M, false), true, 'enter je inkluzívny');
  assert.equal(airDotLodActive(AIR_DOT_ENTER_ALT_M - 1, false), false);
  assert.equal(airDotLodActive(AIR_DOT_EXIT_ALT_M, true), true, 'exit je inkluzívny');
  assert.equal(airDotLodActive(AIR_DOT_EXIT_ALT_M - 1, true), false);
});

test('rebrík model → silueta → bodka sa nikdy neprekrýva', () => {
  // 3D modely flotily žijú POD stropom, bodky NAD ním. Keby sa pásma
  // prekrývali, vznikol by stav „model vlastní vizuál, ale jeho záložný
  // billboard je bodka" — a pri výpadku modelu by kontakt stratil identitu.
  assert.equal(AIR_DOT_EXIT_ALT_M, FLEET_MODEL_ALT_CEIL_M);
  assert.ok(AIR_DOT_ENTER_ALT_M > AIR_DOT_EXIT_ALT_M, 'enter je vyššie než exit');
  // Vo výške, kde ešte môžu byť modely, nesmie byť bodkový režim aktívny ani
  // pri zostupe.
  assert.equal(airDotLodActive(FLEET_MODEL_ALT_CEIL_M - 1, true), false);
});

test('neznáma výška kreslí siluety, nie bodky', () => {
  // Bezpečnejší default: pár veľkých ikon je lepších než scéna plná bodiek
  // bez identity.
  for (const bad of [Number.NaN, undefined, null, Infinity, -Infinity, 'vysoko']) {
    assert.equal(airDotLodActive(bad, false), false, `${String(bad)} → siluety`);
    assert.equal(airDotLodActive(bad, true), false, `${String(bad)} → siluety aj po bodkách`);
  }
});

test('LOD je zapojený do JEDINÉHO zapisovača textúry, nie ako štvrtý nezávislý', () => {
  // Poučenie z 02965d0: kind × raster × strobo písali tri nezávislé miesta a
  // každé prepísalo osi ostatných („raz bliká, raz nie"). Bodka je štvrtá os
  // toho istého composera — nie ďalší zapisovač `bb.image`.
  for (const file of ['./flights.js', './militaryFlights.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const name = file.includes('military') ? 'military' : 'flights';
    assert.match(
      source,
      /function _syncFleetBillboardIcon[\s\S]*?bb\._gevDot === true[\s\S]{0,80}?cockpitContactDotImage\(/,
      `${name}: kokpitový pip je vetva composera`,
    );
    // Mimo composera nesmie `bb.image` písať nikto — ani bodkou, ani siluetou.
    const strayImage = (source.match(/\bbb\.image = (?!uri)/g) || []).length;
    assert.equal(strayImage, 0, `${name}: žiadny obchádzajúci zápis bb.image`);
    // Jeden predikát pre prezentáciu aj tik.
    assert.match(source, /function _isDotContact\(icao24\)/, `${name}: má predikát`);
    assert.match(source, /const isDot = _isDotContact\(icao24\);/, `${name}: tik ho používa`);
    // Prepínač musí bežať pred hlavnou slučkou, inak je tier v tiku nekonzistentný.
    assert.match(
      source,
      /_refreshCockpitNearContacts\(\);\n(\s*\/\/[^\n]*\n)*\s*_refreshFarIconLod\(\);/,
      `${name}: LOD sa vyhodnocuje pred slučkou`,
    );
    // Klikanie na 7px bodku potrebuje toleranciu.
    assert.match(source, /viewer\.scene\.pick\(click\.position, 6, 6\)/, `${name}: pick s toleranciou`);
  }
});

test('strop flotily v oboch vrstvách sa zhoduje s duplikátom v tomto module', () => {
  // Duplikát existuje len preto, aby sa vzťah dal odtestovať — keby sa vrstvy
  // pohli a modul nie, rebrík vyššie sa ticho rozpadne.
  for (const file of ['./flights.js', './militaryFlights.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const m = /const MODEL_ALT_CEIL_M = (\d[\d_]*)/.exec(source);
    assert.ok(m, `${file}: MODEL_ALT_CEIL_M sa nenašiel`);
    assert.equal(Number(m[1].replaceAll('_', '')), FLEET_MODEL_ALT_CEIL_M, `${file}: strop sa rozišiel`);
  }
});

test('drobná silueta bliká krídelným svetlom, kokpitový pip nie', () => {
  // 2026-09-04: pôvodne bodka s pulzujúcim jadrom, na želanie nahradená
  // drobným LIETADLOM („nechcem bodky ale malilinké lietadlá"). Blikanie sa
  // tým zjednodušilo: pri ~8 px vyjde existujúce krídelné svetlo zhruba na
  // jeden pixel, takže netreba druhý mechanizmus — bliká bod na krídle, nie
  // celá ikona, a scéna preto nepôsobí, že bliká ako celok.
  for (const file of ['./flights.js', './militaryFlights.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const name = file.includes('military') ? 'military' : 'flights';
    assert.match(
      source,
      /if \(bb\._gevMicro === true\) \{[\s\S]{0,200}?const wantStrobe = strobePhase;/,
      `${name}: mikro-silueta blikne na strobo fáze`,
    );
    // Vzdialenostná brána tu nedáva zmysel — v tomto režime sú ďaleko všetky.
    assert.doesNotMatch(
      source,
      /if \(bb\._gevMicro === true\) \{[\s\S]{0,200}?strobePhase && cameraDistanceM/,
      `${name}: mikro strobo nemá vzdialenostnú bránu`,
    );
    // Kurz je pridaná hodnota siluety oproti bodke — rotáciu musí dostať.
    assert.match(
      source,
      /if \(!bb\._gevDot && \(doRotations \|\| revealed\)\)/,
      `${name}: drobná silueta dostáva kurz`,
    );
  }
});

test('kokpitový pip ostáva bodkou, mapa dostáva siluetu', () => {
  for (const file of ['./flights.js', './militaryFlights.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const name = file.includes('military') ? 'military' : 'flights';
    assert.match(source, /function _isMicroContact\(icao24\)/, `${name}: má vlastný predikát`);
    assert.match(
      source,
      /return _isDotContact\(icao24\) && !_cockpitContactMode;/,
      `${name}: mikro je mapový LOD bez kokpitu`,
    );
    assert.match(source, /bb\._gevDot = !isMicro;/, `${name}: tvary sa vylučujú`);
    // Malý raster: 64 px zmenšených na 8 je šmuha, atlas nemá mipmapy.
    assert.match(source, /const MICRO_RASTER_PX = 32;/, `${name}: vlastný malý raster`);
  }
});

test('pokojná bodka ostala nedotknutá — kokpit sa nesmie zmeniť', async () => {
  // Kokpit číta ten istý modul. Default variant musí byť presne to, čo bolo
  // pred pulzom, inak by sa zmenil aj režim, ktorý o pulz nikdy nežiadal.
  const source = readFileSync(new URL('./cockpitContactDot.js', import.meta.url), 'utf8');
  assert.match(source, /arc\(8, 8, pulse \? 2\.45 : 1\.55, 0, Math\.PI \* 2\)/, 'mení sa len polomer jadra');
  assert.match(source, /arc\(8, 8, 4\.25, 0, Math\.PI \* 2\)/, 'prstenec je v oboch fázach rovnaký');
  assert.match(source, /pulse === true \? '_pulseUrl' : '_dataUrl'/, 'každá fáza má vlastnú stabilnú URL');
});
