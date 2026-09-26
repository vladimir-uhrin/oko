// src/data/ukraineAlertAreas.test.mjs — POPLACHY (2026-09-26): hlásenia Vzdušných
// síl → ohrozené oblasti; pôvod („з Брянська") nie je hrozba; intenzita podľa veku;
// bod v oblasti; hranice oblastí z buildu sú úplné. Vzorky z archívu kpszsu 9/2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AIR_FORCE_ID_PREFIX, alertTargets, locateUkText, mediaToAlert } from './ukraineMedia.js';
import { assembleAlerts } from './ukraineEventsClient.js';
import { ALERT_FADE_MIN, ALERT_FULL_MIN, alertLevel, alertLevels, alertOblasts, oblastForPoint, pointInRing } from './ukraineAlertAreas.js';
import { UKRAINE_GAZETTEER } from './ukraineIncidents.js';

const oblastsFile = JSON.parse(readFileSync(new URL('../../public/data/ukraine-oblasts.json', import.meta.url), 'utf8'));
const OBLASTS = oblastsFile.oblasts;
const names = (text) => alertTargets(text).map((t) => t.name);
const post = (text, t = Date.UTC(2026, 8, 25, 20, 0), id = 'tg:kpszsu/1') => ({ id, url: 'https://t.me/kpszsu/1', text, publishedAt: t, lang: 'uk', kind: 'text', provider: 'telegram' });

test('ciele hlásenia: oblasti a sídla v poradí textu, bez pôvodu „з …"', () => {
  assert.deepEqual(names('💣 Пуски керованих авіаційних бомб ворожою тактичною авіацією на північ Харківщини.'), ['Kharkiv Oblast']);
  assert.deepEqual(names('🏍 Реактивний БпЛА з Одещини на Вінниччину у напрямку Тростянця.'), ['Vinnytsia Oblast'], 'Odesa = odkiaľ');
  assert.deepEqual(names('☄️ Загроза застосування балістичного озброєння з Брянська.'), [], 'Bryansk = odkiaľ, nie hrozba');
  assert.deepEqual(names('🏍 Реактивні БпЛА з Чернігівщини на Київщину у напрямку Києва.'), ['Kyiv Oblast', 'Kyiv']);
  assert.deepEqual(names('🛵 Ударний БпЛА у напрямку Кривого Рогу зі сходу.'), ['Kryvyi Rih']);
  assert.deepEqual(names('🏍 Полтавщина: реактивний БпЛА повз Нові Санжари та Білики, курс - північно-західний.'), ['Poltava Oblast'], 'nadpis aj malé sídlo z tabuľky = jedna oblasť');
  assert.deepEqual(names('🏍 Реактивний БпЛА в напрямку н.п. Чорноморськ / Лиманка на Одещині з акваторії Чорного моря.'), ['Chornomorsk', 'Odesa Oblast'], 'Лиманка ≠ Lyman');
  assert.deepEqual(names('🚀Швидкісна ціль у напрямку Сум з Курської області.'), ['Sumy'], 'holý genitív „Сум"');
  assert.deepEqual(names('🏍 Реактивні БпЛА на півночі від Черкас, курс на місто та на захід.'), ['Cherkasy'], '„на півночі від" = poloha, nie pôvod');
  assert.deepEqual(names('🏍 Реактивний БпЛА в р-ні Канівського водосховища курс західний.'), ['Cherkasy Oblast']);
  assert.deepEqual(names('🛵 Ударний БпЛА на заході від Сум, курс на південь.'), ['Sumy']);
});

test('poplach = hrozba bez dopadu a bez odvolania, len z kanála Vzdušných síl', () => {
  assert.equal(AIR_FORCE_ID_PREFIX, 'tg:kpszsu/');
  const a = mediaToAlert(post('🛵 БпЛА у напрямку Рені (Одещина)'));
  assert.ok(a);
  assert.deepEqual(a.targets.map((t) => [t.name, t.kind]), [['Reni', 'place'], ['Odesa Oblast', 'oblast']]);
  assert.equal(a.url, 'https://t.me/kpszsu/1');
  assert.equal(mediaToAlert(post('📢 Відбій загрози застосування балістичного озброєння.')), null, 'odvolanie');
  assert.equal(mediaToAlert(post('☄️ Загроза застосування балістичного озброєння з Брянська. 📢 Відбій загрози.')), null);
  assert.equal(mediaToAlert(post('⚡️ ЗБИТО/ПОДАВЛЕНО 101 ВОРОЖИЙ БПЛА. У ніч на 20 вересня противник атакував Київщину 138 ударними БпЛА')), null, 'súhrn = dopad');
  assert.equal(mediaToAlert(post('🛵 БпЛА у напрямку Рені (Одещина)', undefined, 'tg:GeneralStaffZSU/5')), null, 'iný kanál');
  assert.equal(mediaToAlert(post('⚠ Київ в укриття.')).targets[0].name, 'Kyiv', '„в укриття" = hrozba');
  assert.equal(mediaToAlert(post('🚀Житомир - в укриття!')).targets[0].name, 'Zhytomyr');
  assert.ok(mediaToAlert(post('🛫 Активність ворожої тактичної авіації! 🚀🚀Загроза застосування авіаційних засобів ураження для Сумщини')), '„засобів ураження" nie je zásah');
  assert.equal(mediaToAlert(post('🏍 Реактивний БпЛА в р-ні Боярки курс південний')).targets[0].name, 'Kyiv Oblast', '„Реактивний" bez БпЛА');
});

test('poplachy okna sa skladajú z médií, dedup a v čase; udalosti geokodéra bez zmeny', () => {
  const t0 = Date.UTC(2026, 8, 25, 20, 0);
  const payloads = [{ media: [post('🛵 БпЛА на Київщину', t0, 'tg:kpszsu/1'), post('🛵 БпЛА на Київщину', t0, 'tg:kpszsu/1'), post('🛵 БпЛА на Сумщину', t0 + 1, 'tg:kpszsu/2')] }, { media: [post('🛵 БпЛА на Одещину', t0 - 5, 'tg:kpszsu/3')] }];
  const out = assembleAlerts(payloads, { startMs: t0 - 1, endMs: t0 + 10 });
  assert.deepEqual(out.map((a) => a.id), ['tg:kpszsu/1', 'tg:kpszsu/2']);
  // Rozšírený kmeň Sumy/Bila Tserkva mení geokodér len k lepšiemu (prehratie archívu: 8 zmien, všetky opravy).
  assert.equal(locateUkText('🚀Швидкісна ціль в напрямку Сум з півночі.')?.name, 'Sumy');
  assert.equal(locateUkText('🏍 Реактивний БпЛА у напрямку Білої Церкви зі сходу.')?.name, 'Bila Tserkva');
  assert.equal(locateUkText('Суми: вибухи')?.name, 'Sumy');
  assert.equal(locateUkText('Сумщина: вибухи')?.name, 'Sumy Oblast', 'Сумщина ostáva oblasť');
});

test('bod v oblasti: krajské mestá do svojej oblasti, ruské mestá nikam, pobrežie s toleranciou', () => {
  const by = (name) => UKRAINE_GAZETTEER.find((p) => p.name === name);
  assert.equal(oblastForPoint(by('Kyiv').lon, by('Kyiv').lat, OBLASTS), 'Kyiv Oblast', 'mesto Kyjev je diera v NE — berieme vonkajší prstenec');
  assert.equal(oblastForPoint(by('Kremenchuk').lon, by('Kremenchuk').lat, OBLASTS), 'Poltava Oblast');
  assert.equal(oblastForPoint(by('Odesa').lon, by('Odesa').lat, OBLASTS), 'Odesa Oblast');
  assert.equal(oblastForPoint(by('Sevastopol').lon, by('Sevastopol').lat, OBLASTS), 'Crimea');
  for (const ru of ['Belgorod', 'Kursk', 'Bryansk', 'Moscow', 'Voronezh']) assert.equal(oblastForPoint(by(ru).lon, by(ru).lat, OBLASTS), null, ru);
  assert.equal(pointInRing(0.5, 0.5, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), true);
  assert.equal(pointInRing(1.5, 0.5, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), false);
});

test('intenzita: plná do 60 min, stupne do 180 min, potom nič; stav k času kurzora', () => {
  assert.equal(ALERT_FULL_MIN, 60); assert.equal(ALERT_FADE_MIN, 180);
  assert.equal(alertLevel(0), 1); assert.equal(alertLevel(59 * 60_000), 1);
  assert.equal(alertLevel(90 * 60_000), 0.75);
  assert.equal(alertLevel(120 * 60_000), 0.5);
  assert.equal(alertLevel(179 * 60_000), 0.25);
  assert.equal(alertLevel(180 * 60_000), 0); assert.equal(alertLevel(-1), 0); assert.equal(alertLevel(NaN), 0);
  const t0 = Date.UTC(2026, 8, 25, 20, 0);
  const alerts = [
    mediaToAlert(post('🛵 БпЛА у напрямку Кривого Рогу зі сходу.', t0 - 10 * 60_000, 'tg:kpszsu/1')),
    mediaToAlert(post('🛵 БпЛА на Київщину', t0 - 100 * 60_000, 'tg:kpszsu/2')),
    mediaToAlert(post('🛵 БпЛА на Київщину', t0 - 50 * 60_000, 'tg:kpszsu/3')),
    mediaToAlert(post('☄️ Балістика на Суми', t0 + 60_000, 'tg:kpszsu/4')),
    mediaToAlert(post('☄️ Балістика на Одесу', t0 - 200 * 60_000, 'tg:kpszsu/5')),
  ];
  const st = alertLevels(alerts, t0, OBLASTS);
  assert.deepEqual([...st.keys()].sort(), ['Dnipropetrovsk Oblast', 'Kyiv Oblast']);
  assert.equal(st.get('Dnipropetrovsk Oblast').level, 1, 'Kryvyi Rih → Dnipropetrovsk, 10 min');
  assert.equal(st.get('Kyiv Oblast').count, 2); assert.equal(st.get('Kyiv Oblast').count1h, 1); assert.equal(st.get('Kyiv Oblast').level, 1);
  assert.equal(st.get('Kyiv Oblast').lastT, t0 - 50 * 60_000);
  assert.ok(!st.has('Sumy Oblast'), 'hlásenie po kurzore sa nepočíta (prehrávanie)');
  assert.ok(!st.has('Odesa Oblast'), 'staršie než 3 h');
  assert.deepEqual(alertOblasts({ targets: [{ name: 'Belgorod Oblast', kind: 'oblast', lat: 50.7, lon: 37.5 }] }, OBLASTS), [], 'oblasť, ktorú mapa nemá');
  assert.equal(alertLevels(alerts, NaN, OBLASTS).size, 0);
});

test('hranice oblastí z buildu: 25 oblastí (24 + Krym), Kyjev bez vlastnej položky, zdroj Natural Earth, malý súbor', () => {
  assert.equal(OBLASTS.length, 25);
  assert.match(oblastsFile.source, /Natural Earth/);
  const n = new Set(OBLASTS.map((o) => o.name));
  assert.ok(n.has('Kyiv Oblast') && !n.has('Kyiv') && n.has('Crimea'));
  for (const o of OBLASTS) for (const r of o.rings) { assert.ok(r.length >= 4, o.name); assert.deepEqual(r[0], r.at(-1), `${o.name}: prstenec uzavretý`); }
  const verts = OBLASTS.reduce((a, o) => a + o.rings.reduce((b, r) => b + r.length, 0), 0);
  assert.ok(verts > 2000 && verts < 8000, `vrcholov ${verts}`);
});
