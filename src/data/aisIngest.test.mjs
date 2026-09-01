// src/data/aisIngest.test.mjs
// AIS sanitizácia na vstupe (ITU-R M.1371 sentinely) + sticky merge.
// Tieto funkcie sú JEDINÉ miesto, kde sa rozhoduje, či je hodnota z feedu
// reálne meranie alebo "nedostupné" — server ingest ich musí volať vždy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIS_COG_UNAVAILABLE_DEG,
  AIS_HEADING_UNAVAILABLE,
  AIS_SOG_UNAVAILABLE_KN,
  aisCourseDeg,
  aisHeadingDeg,
  aisPositionUsable,
  aisSpeedKnots,
  mergeAisKinematics,
  mergeAisStaticFields,
  shouldPruneAisCache,
} from './aisIngest.js';

test('rýchlosť: sentinel 102.3 kn znamená NEDOSTUPNÉ, nie najrýchlejšia loď sveta', () => {
  // Pred opravou sa 102.3 uložilo ako číslo → karta hlásila "102.3KT",
  // ikona dostala najväčšiu mierku a najvyššiu prioritu štítku.
  assert.equal(aisSpeedKnots(AIS_SOG_UNAVAILABLE_KN), null);
  assert.equal(aisSpeedKnots(102.3), null);
  // 102.2 je podľa normy "102,2 uzla alebo viac" — reálne meranie, drž ho.
  assert.equal(aisSpeedKnots(102.2), 102.2);
  assert.equal(aisSpeedKnots(0), 0, 'stojaca loď má rýchlosť 0, nie null');
  assert.equal(aisSpeedKnots(12.3), 12.3);
  assert.equal(aisSpeedKnots(-1), null, 'záporná rýchlosť je nezmysel');
  assert.equal(aisSpeedKnots(null), null);
  assert.equal(aisSpeedKnots(undefined), null);
  assert.equal(aisSpeedKnots('8.4'), 8.4);
  assert.equal(aisSpeedKnots('nope'), null);
});

test('kurz nad zemou: 360 je sentinel, platný rozsah je [0, 360)', () => {
  assert.equal(aisCourseDeg(AIS_COG_UNAVAILABLE_DEG), null);
  assert.equal(aisCourseDeg(360), null);
  assert.equal(aisCourseDeg(359.9), 359.9);
  assert.equal(aisCourseDeg(0), 0, 'kurz na sever je 0, nie null');
  assert.equal(aisCourseDeg(214), 214);
  assert.equal(aisCourseDeg(-5), null);
  assert.equal(aisCourseDeg(400), null);
  assert.equal(aisCourseDeg(null), null);
});

test('heading: 511 je sentinel, platný rozsah je [0, 359]', () => {
  assert.equal(aisHeadingDeg(AIS_HEADING_UNAVAILABLE), null);
  assert.equal(aisHeadingDeg(511), null);
  // 360 nie je platný heading (0..359) — pôvodný normalizedHeading ho púšťal.
  assert.equal(aisHeadingDeg(360), null);
  assert.equal(aisHeadingDeg(359), 359);
  assert.equal(aisHeadingDeg(0), 0);
  assert.equal(aisHeadingDeg(-1), null);
});

test('poloha: AIS sentinely lat=91 / lon=181 neprejdú, nekonečné hodnoty tiež nie', () => {
  // Number.isFinite(91) je true — presne preto stará kontrola nestačila
  // a lode končili na nezmyselných súradniciach.
  assert.equal(aisPositionUsable(91, 181), false);
  assert.equal(aisPositionUsable(91, 17.1), false);
  assert.equal(aisPositionUsable(48.14, 181), false);
  assert.equal(aisPositionUsable(48.14, 17.11), true);
  assert.equal(aisPositionUsable(-90, -180), true, 'hranice rozsahu sú platné');
  assert.equal(aisPositionUsable(90, 180), true);
  assert.equal(aisPositionUsable(90.0001, 0), false);
  assert.equal(aisPositionUsable(0, 180.0001), false);
  assert.equal(aisPositionUsable(NaN, 0), false);
  assert.equal(aisPositionUsable(null, undefined), false);
  assert.equal(aisPositionUsable('48.14', '17.11'), true, 'reťazce z JSON sa parsujú');
});

test('sticky kinematika: statická správa NESMIE vynulovať rýchlosť a kurz', () => {
  // Jadro chyby č. 1: ShipStaticData/StaticDataReport nenesú Sog/Cog/
  // TrueHeading, ale AISStream posiela lat/lon v každej obálke, takže riadok
  // sa prepísal a idúca loď zrazu nemala rýchlosť ani kurz.
  const previous = { speed: 12.4, course: 214, heading: 210 };
  const afterStatic = mergeAisKinematics({}, previous);
  assert.deepEqual(afterStatic, { speed: 12.4, course: 214, heading: 210 });

  // Reálny fix ich prepíše.
  const afterPosition = mergeAisKinematics({ sog: 0.2, cog: 87, trueHeading: 90 }, previous);
  assert.deepEqual(afterPosition, { speed: 0.2, course: 87, heading: 90 });

  // Sentinel sa správa ako "nemám údaj" — drží sa posledná známa hodnota,
  // nezapíše sa 102.3.
  const afterSentinel = mergeAisKinematics(
    { sog: AIS_SOG_UNAVAILABLE_KN, cog: AIS_COG_UNAVAILABLE_DEG, trueHeading: AIS_HEADING_UNAVAILABLE },
    previous,
  );
  assert.deepEqual(afterSentinel, { speed: 12.4, course: 214, heading: 210 });

  // Nula je meranie, nie chýbajúca hodnota — zakotvená loď musí spadnúť na 0.
  assert.equal(mergeAisKinematics({ sog: 0, cog: 0 }, previous).speed, 0);
  assert.equal(mergeAisKinematics({ sog: 0, cog: 0 }, previous).course, 0);

  // Bez predchádzajúceho riadku sú to čisté nully, nikdy undefined.
  assert.deepEqual(mergeAisKinematics({}, null), { speed: null, course: null, heading: null });
  assert.deepEqual(mergeAisKinematics({}, undefined), { speed: null, course: null, heading: null });
});

test('sticky statické polia: správa bez destinácie/IMO nezmaže uložené', () => {
  // Chyba č. 7: meno a typ fallback mali, destinácia a IMO nie — a msg 24
  // (StaticDataReport) destináciu nenesie vôbec, takže ju po msg 5 zmazala.
  const previous = { name: 'PREŠOV', type: '70', destination: 'KOMARNO', imo: '9123456' };
  assert.deepEqual(mergeAisStaticFields({ name: 'PREŠOV', type: '70' }, previous), {
    name: 'PREŠOV',
    type: '70',
    destination: 'KOMARNO',
    imo: '9123456',
  });

  // Nová hodnota vyhráva.
  assert.equal(mergeAisStaticFields({ destination: 'BUDAPEST' }, previous).destination, 'BUDAPEST');

  // Prázdny reťazec je "neuvedené", nie zmazanie.
  assert.equal(mergeAisStaticFields({ destination: '   ' }, previous).destination, 'KOMARNO');
  assert.deepEqual(mergeAisStaticFields({}, null), {
    name: null, type: null, destination: null, imo: null,
  });
});

test('prune sa nespúšťa na každej správe — má vlastné časové okno', () => {
  // Chyba č. 3: O(50 000) prechod synchrónne v ws handleri pri každej
  // prijatej správe. Pri celosvetovom bboxe to boli milióny iterácií/s.
  assert.equal(shouldPruneAisCache(0, 1_000, 5_000), true, 'prvý beh vždy');
  assert.equal(shouldPruneAisCache(1_000, 2_000, 5_000), false);
  assert.equal(shouldPruneAisCache(1_000, 6_000, 5_000), true, 'presne na hranici');
  assert.equal(shouldPruneAisCache(1_000, 6_001, 5_000), true);
  // Skok hodín dozadu nesmie prune zablokovať navždy.
  assert.equal(shouldPruneAisCache(9_000, 1_000, 5_000), true);
});
