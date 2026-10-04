import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { openAdminStore } from '../store.js';
import { createStudio, fetchRemoteMedia, TEMPLATES } from './index.js';
import { cardSvg, renderPhotoCard } from './card.js';
import {
  FRONT_URL, OBLAST_SK, airWave, casualtiesSk, frontChange, mediaHostAllowed, mediaSource, mediaWhat, reportDirections, strikesSk, targetOblast,
  uaAir, uaFront, uaMedia, uaReport, uaWeek, utcDay,
} from './ukraine.js';

const NOW = Date.UTC(2026, 9, 4, 7, 30); // 9:30 v Bratislave
const H = 3600_000;
const report = (over = {}) => ({
  ok: true, total: 182, publishedAt: NOW - 2 * H, reportedAt: new Date(NOW - 2 * H).toISOString(), url: 'https://armyinform.com.ua/2026/10/04/x/',
  strikes: { guidedBombs: 120, kamikazeDrones: 4100, shellings: 3900, airStrikes: null, missileStrikes: null },
  directions: [
    { gs: 'Покровський', attacks: 51 }, { gs: 'Костянтинівський', attacks: 22 }, { gs: 'Північно-Слобожанський', attacks: 3 },
    { gs: 'Курський', attacks: 4 }, { gs: 'Гуляйпільський', attacks: 17 }, { gs: 'Невідомий', attacks: 99 },
  ],
  ...over,
});
const days = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(i => [utcDay(NOW - i * 86400_000), { total: 150 }]));

test('hlásenie GŠ: smery po slovensky, údery, priemer, „údaje jednej strany", odkazy', () => {
  const dirs = reportDirections(report());
  assert.deepEqual(dirs.slice(0, 3).map(d => [d.id, d.attacks]), [['pokrovsk', 51], ['kostiantynivka', 22], ['huliaipole', 17]]);
  assert.equal(dirs.find(d => d.id === 'sumy').attacks, 7, 'Sumský smer = dva smery GŠ');
  assert.ok(!dirs.some(d => d.attacks === 99), 'smer mimo OKO sa vynechá (žiadny ukrajinský názov v texte)');
  assert.deepEqual(strikesSk(report().strikes), ['120 riadených leteckých bômb', '4 100 dronov-kamikadze', '3 900 ostreľovaní']);
  const item = uaReport({ report: report(), days }, { now: NOW });
  assert.equal(item.key, `ua-report:${utcDay(NOW - 2 * H)}`);
  assert.equal(item.title, 'Front za deň: 182 bojových stretov');
  assert.match(item.text, /Ukrajinský generálny štáb hlási za uplynulý deň 182 bojových stretov s ruskými jednotkami\. To je viac ako 7-dňový priemer \(150\)\./);
  assert.match(item.text, /• Pokrovský smer – 51/);
  assert.match(item.text, /Ruské údery podľa hlásenia: 120 riadených leteckých bômb, 4 100 dronov-kamikadze, 3 900 ostreľovaní\./);
  assert.deepEqual(strikesSk({ guidedBombs: 1, kamikazeDrones: 3 }), ['1 riadená letecká bomba', '3 drony-kamikadze'], 'tvary pre zoznam za dvojbodkou');
  assert.match(item.text, /Údaje jednej strany/);
  assert.match(item.text, /armyinform\.com\.ua/);
  assert.ok(item.text.includes(FRONT_URL));
  assert.ok(!/undefined|null|NaN|Покров/.test(item.text));
  assert.equal(item.card.points.length, 3);
  assert.ok(item.card.view);
});

test('hlásenie GŠ: staré, bez súčtu alebo popoludňajšie sa nezverejní', () => {
  assert.equal(uaReport({ report: report({ publishedAt: NOW - 31 * H, reportedAt: null }) }, { now: NOW }), null);
  assert.equal(uaReport({ report: report({ total: null }) }, { now: NOW }), null);
  const fewDays = uaReport({ report: report(), days: {} }, { now: NOW });
  assert.ok(!/priemer/.test(fewDays.text), 'bez histórie žiadne porovnanie');
});

// Dve snímky mapy: pred = štvorec, teraz = štvorec + pás pri Pokrovsku (ruský postup) − roh pri Huliaipole (oslobodené).
const square = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const snap = (day, rings) => ({ day, features: rings.map(ring => ({ type: 'Polygon', kind: 'occupied', rings: [ring] })) });
const before = snap('2026-10-02', [square(36.0, 47.2, 38.4, 48.3)]);
const after = snap('2026-10-03', [square(36.0, 47.2, 38.4, 48.36), square(36.0, 47.2, 36.3, 47.25)].slice(0, 1));

test('zmena frontu za deň: km² po smeroch, kritický jazyk, zdroj okolive.sk bez mena poskytovateľa', () => {
  const change = frontChange(after, before);
  assert.ok(change.ruKm2 > 50, `ruský postup ${change.ruKm2}`);
  const item = uaFront({ now: after, before }, { now: NOW });
  assert.equal(item.key, 'ua-front:2026-10-03');
  assert.match(item.title, /^Front za deň: ruský agresor obsadil \d/, 'pravidlo vlastníka: „ruský agresor obsadil"');
  assert.match(item.text, /Ruský agresor za deň obsadil/);
  assert.match(item.text, /mapy frontu na okolive\.sk/);
  assert.ok(!/deepstate/i.test(item.text + JSON.stringify(item.card)), 'poskytovateľ mapy sa nemenuje');
  assert.ok(item.text.includes(FRONT_URL));
  assert.ok(item.card.polygons[0].rings.length);
  assert.equal(uaFront({ now: before, before }, { now: NOW }), null, 'bez zmeny nič');
});

const air = (id, minutesAgo, text) => ({ id: `tg:kpszsu/${id}`, provider: 'telegram', kind: 'text', publishedAt: NOW - minutesAgo * 60_000, text, url: `https://t.me/kpszsu/${id}` });
const WAVE = [
  air(1, 150, 'Ударні БпЛА у напрямку Київщини, Чернігівщини, Сумщини, Полтавщини.'),
  air(2, 90, 'Загроза застосування балістичних ракет: Харківщина, Черкащина, Житомирщина.'),
  air(3, 30, 'БпЛА курсом на Вінниччину та Одещину.'),
  air(4, 600, 'Ударні БпЛА у напрямку Львівщини.'), // mimo okna 3 h
];

test('veľký vzdušný útok: oblasti z hlásení Vzdušných síl, prah, druh hrozby, jedna vlna = jeden kľúč', () => {
  assert.equal(targetOblast({ name: 'Kyiv Oblast', lat: 50.4, lon: 30.5 }), 'Kyiv Oblast');
  assert.equal(targetOblast({ name: 'Bila Tserkva', lat: 49.8, lon: 30.1 }), 'Kyiv Oblast', 'sídlo → najbližšia oblasť');
  assert.equal(targetOblast({ name: 'Belgorod Oblast', kind: 'oblast', lat: 50.6, lon: 36.6 }), null, 'ruská oblasť sa nepriradí Charkivskej');
  const wave = airWave(WAVE, NOW);
  assert.equal(wave.oblasts.size, 9);
  assert.deepEqual([...wave.kinds].sort(), ['drones', 'missiles']);
  const item = uaAir({ media: WAVE }, { now: NOW, settings: { airMinOblasts: 8 } });
  assert.equal(item.title, 'Rozsiahly vzdušný útok: hrozba pre 9 oblastí Ukrajiny');
  assert.match(item.text, /hlásia hrozbu útočných dronov a rakiet pre Čerkaskú, Černihivskú, .* a Žytomyrskú oblasť\./);
  assert.match(item.text, /nie o oficiálnu mapu protileteckých sirén/);
  assert.ok(!/Ľvov/.test(item.text), 'staré hlásenie mimo okna');
  assert.equal(uaAir({ media: WAVE }, { now: NOW, settings: { airMinOblasts: 10 } }), null, 'pod prahom');
  const later = uaAir({ media: [...WAVE, air(5, 5, 'БпЛА на Полтавщину')] }, { now: NOW, settings: { airMinOblasts: 8 } });
  assert.equal(later.key, item.key, 'pokračujúca vlna nevytvorí druhý návrh');
  for (const name of Object.values(OBLAST_SK)) assert.ok(!/undefined/.test(name));
});

test('veľký vzdušný útok: 10-hodinová nočná vlna = jeden návrh, nová vlna po pauze = nový návrh', () => {
  const oblasts = 'Київщини, Чернігівщини, Сумщини, Полтавщини, Харківщини, Черкащини, Житомирщини, Вінниччини, Одещини';
  const start = NOW - 12 * H;
  const posts = Array.from({ length: 20 }, (_, i) => ({ id: `tg:kpszsu/${100 + i}`, provider: 'telegram', publishedAt: start + i * 30 * 60_000,
    text: `Ударні БпЛА у напрямку ${oblasts}.` }));
  const keysAt = list => {
    const keys = new Set();
    for (let t = start + H; t <= start + 10 * H; t += 10 * 60_000) {
      const item = uaAir({ media: list.filter(m => m.publishedAt <= t) }, { now: t, settings: { airMinOblasts: 8 } });
      if (item) keys.add(item.key);
    }
    return keys;
  };
  assert.equal(keysAt(posts).size, 1, 'jedna súvislá vlna');
  // Po hláseniach 0–4,5 h pauza 3 h, potom nová vlna od 7,5 h.
  const twoWaves = posts.filter(m => m.publishedAt < start + 5 * H || m.publishedAt >= start + 7.5 * H);
  assert.equal(keysAt(twoWaves).size, 2, 'po pauze ≥ 2 h nová vlna');
});

const tg = (channel, id, over = {}) => ({ id: `tg:${channel}/${id}`, provider: 'telegram', kind: 'photo', publishedAt: NOW - H, url: `https://t.me/${channel}/${id}`,
  photos: [`https://cdn4.telesco.pe/file/${id}a.jpg`, `https://cdn4.telesco.pe/file/${id}b.jpg`], text: 'Наслідки ракетного удару по Харкову', ...over });

test('zábery: len oficiálne kanály s povolenou licenciou, nie YouTube, nie poplachy, nie cudzie hosty', () => {
  assert.equal(mediaHostAllowed('https://cdn4.telesco.pe/file/x.jpg'), true);
  assert.equal(mediaHostAllowed('https://armyinform.com.ua/wp-content/v.mp4'), true);
  assert.equal(mediaHostAllowed('http://cdn4.telesco.pe/file/x.jpg'), false, 'len https');
  assert.equal(mediaHostAllowed('https://evil.example/telesco.pe.jpg'), false);
  assert.ok(mediaSource(tg('GeneralStaffZSU', 10)));
  assert.equal(mediaSource(tg('kpszsu', 11)), null, 'poplachy nie sú zábery');
  assert.equal(mediaSource(tg('DeepStateUA', 12)), null, 'poskytovateľ mapy sa nepreberá');
  assert.equal(mediaSource({ id: 'yt:abc', provider: 'youtube', kind: 'video', thumb: 'https://i.ytimg.com/x.jpg' }), null, 'YouTube video sa nesmie znovu nahrať');
  assert.equal(mediaSource(tg('GeneralStaffZSU', 13, { photos: ['https://example.com/x.jpg'] })), null);
  const ai = mediaSource({ id: 'ai:https://armyinform.com.ua/x', provider: 'file', kind: 'video', videoUrl: 'https://armyinform.com.ua/v.mp4' });
  assert.equal(ai.video, 'https://armyinform.com.ua/v.mp4');
});

test('zábery: popis so správnou stranou — úder ukrajinských síl nie je ruský útok', () => {
  assert.equal(mediaWhat('strike', 'Уражено ЗРК «Бук-М3» та місце запуску БпЛА'), 'zásah ukrajinských síl');
  assert.equal(mediaWhat('infrastructure', 'Сили оборони уразили НПЗ'), 'zásah ukrajinských síl');
  assert.equal(mediaWhat('strike', 'Наслідки ракетного удару по Харкову'), 'následky ruského útoku');
  assert.equal(mediaWhat('fire', 'Пожежа після ворожого обстрілу'), 'požiar po ruskom útoku');
  assert.equal(mediaWhat('strike', 'Удар'), null, 'nejasná strana = žiadny návrh');
  assert.equal(mediaWhat('air-defence', 'Збито 50 БпЛА'), 'práca protivzdušnej obrany');
  assert.equal(casualtiesSk({ killed: 2, injured: 7 }), ' Podľa príspevku: 2 obete, 7 zranených.');
  assert.equal(casualtiesSk({ killed: null, injured: 1 }), ' Podľa príspevku: 1 zranený.');
  assert.equal(casualtiesSk({}), '');
});

test('zábery: najnovší nezverejnený, denný strop, vypínač, text po slovensky s odkazom na originál', () => {
  const media = [tg('GeneralStaffZSU', 20, { publishedAt: NOW - 2 * H }), tg('dsns_telegram', 21), tg('kpszsu', 22, { publishedAt: NOW - 60_000 })];
  const item = uaMedia({ media }, { now: NOW });
  assert.equal(item.key, 'ua-media:tg:dsns_telegram/21');
  assert.match(item.title, /^Štátna záchranná služba Ukrajiny: Následky ruského útoku – Kharkiv$/);
  assert.match(item.text, /zverejnila fotografie \(následky ruského útoku, Kharkiv\)\./);
  assert.match(item.text, /Pôvodný príspevok \(ukrajinsky\): https:\/\/t\.me\/dsns_telegram\/21/);
  assert.ok(!/CC BY/.test(item.text), 'licencia DSNS nie je doložená — text ju neuvádza');
  assert.equal(item.media.photos.length, 2);
  assert.match(item.media.review, /obete/);
  assert.ok(!/licenci/i.test(item.media.review), 'vlastník rozhodol zverejňovať GŠ a DSNS — bez varovania o licencii');
  const mod = uaMedia({ media: [tg('ministry_of_defense_ua', 23)] }, { now: NOW });
  assert.match(mod.text, /oficiálny kanál, CC BY 4\.0/);
  assert.equal(mod.media.review, item.media.review, 'rovnaká kontrola pre všetky kanály');
  const next = uaMedia({ media }, { now: NOW, has: key => key === item.key });
  assert.equal(next.key, 'ua-media:tg:GeneralStaffZSU/20', 'starší, ak novší už je');
  assert.equal(uaMedia({ media }, { now: NOW, countToday: () => 6 }), null, 'denný strop');
  assert.equal(uaMedia({ media }, { now: NOW, settings: { media: false } }), null, 'vypnuté');
  assert.equal(uaMedia({ media: [tg('dsns_telegram', 30, { publishedAt: NOW - 13 * H })] }, { now: NOW }), null, 'staršie ako 12 h');
  assert.equal(uaMedia({ media: [tg('GeneralStaffZSU', 31, { text: 'З Днем відзначення працівників служб персоналу!' })] }, { now: NOW }), null, 'blahoželanie nie je správa');
});

test('týždeň ako karusel: hlavná karta + snímky smerov, územia a úderov', () => {
  const model = {
    week: { from: '2026-09-27', to: '2026-10-03' }, total: { week: 1260, changePct: 8 },
    directions: [{ id: 'pokrovsk', week: 400, center: { lat: 48.3, lon: 37.2 }, ruKm2: 30, ruAt: { lat: 48.3, lon: 37.3 }, uaKm2: 0 },
      { id: 'kostiantynivka', week: 200, center: { lat: 48.5, lon: 37.7 }, ruKm2: 0, uaKm2: 2, uaAt: { lat: 48.5, lon: 37.6 } }],
    change: { weekly: true, ruKm2: 30, uaKm2: 2, toGreyKm2: 1, fromDay: '2026-09-26', toDay: '2026-10-03' },
    strikes: { guidedBombs: { sum: 5600, days: 7 }, kamikazeDrones: { sum: 25000, days: 7 } },
  };
  const item = uaWeek({ model, occupied: [square(36, 47, 38, 48)], text: 'Text týždňa' }, { now: NOW });
  assert.equal(item.key, 'ua-week:2026-10-03');
  assert.equal(item.slides.length, 3);
  assert.deepEqual(item.slides.map(s => s.kicker), ['NAJVIAC RUSKÝCH ÚTOKOV', 'ZMENA ÚZEMIA ZA TÝŽDEŇ', 'RUSKÉ ÚDERY ZA TÝŽDEŇ']);
  assert.deepEqual([item.slides[2].big, item.slides[2].headline, item.slides[2].lines[0]], ['5 600', 'riadených leteckých bômb', '25 000 dronov-kamikadze'], 'číslo s medzerou tisícok sa nerozdelí');
  assert.match(item.text, /#Ukrajina/);
  assert.equal(uaWeek({ model: { ...model, change: { ...model.change, weekly: false } }, text: 'x' }, { now: NOW }).slides.length, 2, 'územie len pri odstupe 7 dní');
  assert.equal(uaWeek({ model, text: 'x' }, { now: NOW + 5 * 86400_000 }), null, 'starý týždeň');
});

test('karta: výrez Ukrajiny, plochy, farebné body s popisom; fotka v ráme OKO', async () => {
  const svg = cardSvg({ kicker: 'K', big: '1', headline: 'h', lines: [], view: { west: 21, east: 41.5, south: 43.6, north: 53 },
    polygons: [{ rings: [square(36, 47, 38, 48)], fill: '#ff5a3c' }], points: [{ lat: 48, lon: 37, r: 12, color: '#ffd23c', label: '+3 km²' }],
    mapCredit: 'Mapa frontu: okolive.sk · Natural Earth', source: 'S', at: NOW });
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /fill="#ffd23c"/);
  assert.match(svg, /\+3 km²/);
  assert.match(svg, /Mapa frontu: okolive\.sk · Natural Earth/);
  const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  const framed = await renderPhotoCard(photo, { kicker: 'UKRAJINA · FOTO', headline: 'Titulok', source: 'DSNS', at: NOW, index: 0, count: 2 });
  const meta = await sharp(framed).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1350, 'jpeg']);
});

test('sťahovanie médií: len povolený hostiteľ, typ a strop veľkosti', async () => {
  const ok = async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  assert.equal((await fetchRemoteMedia('https://cdn4.telesco.pe/a.jpg', { maxBytes: 10, fetchImpl: ok })).length, 3);
  await assert.rejects(fetchRemoteMedia('https://example.com/a.jpg', { maxBytes: 10, fetchImpl: ok }), /nepovolený/);
  await assert.rejects(fetchRemoteMedia('https://cdn4.telesco.pe/a.jpg', { maxBytes: 2, fetchImpl: ok }), /veľké/);
  const html = async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: async () => new ArrayBuffer(1) });
  await assert.rejects(fetchRemoteMedia('https://cdn4.telesco.pe/a.jpg', { maxBytes: 10, fetchImpl: html }), /nie je obrázok/);
});

function setup(t, feeds, extra = {}) {
  const store = openAdminStore(':memory:');
  t.after(() => store.close());
  const studio = createStudio({ store, env: { AUTH_ORIGINS: 'https://okolive.sk' }, port: () => 1, now: () => NOW, timers: false,
    fetchJson: async (port, path) => {
      const key = Object.keys(feeds).find(k => path.startsWith(k));
      const body = key ? feeds[key] : null;
      if (body && body.__headers) return { status: 200, headers: body.__headers, body: body.body };
      return body ? { status: 200, headers: {}, body } : { status: 502, headers: {}, body: null };
    },
    renderCard: async card => Buffer.from(`jpeg:${card.kind}:${card.kicker}`),
    publisher: { status: () => ({ facebook: true, instagram: true }), instagramLimit: async () => null }, log: () => {}, ...extra });
  return { store, studio };
}

test('Štúdio: šablóny Ukrajiny sú v registri, hlásenie GŠ ide z dvoch zdrojov', async t => {
  assert.deepEqual(TEMPLATES.filter(x => x.id.startsWith('ua-')).map(x => x.id), ['ua-report', 'ua-front', 'ua-air', 'ua-media', 'ua-week']);
  const { studio } = setup(t, { '/api/ukraine/report': report(), '/api/ukraine/events/directions': { days } });
  const result = await studio.generate('ua-report');
  assert.equal(result.created, true);
  assert.match(result.draft.text, /7-dňový priemer/);
  assert.equal((await studio.generate('ua-report')).reason, 'exists');
});

test('Štúdio: zábery → karusel fotiek v ráme, kontrola obetí, auto-zverejnenie zakázané', async t => {
  const photo = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#884422' } }).jpeg().toBuffer();
  const fetched = [];
  const { studio } = setup(t, { '/api/ukraine/events': { media: [tg('ministry_of_defense_ua', 40)] } },
    { fetchMedia: async url => { fetched.push(url); return photo; } });
  const result = await studio.generate('ua-media');
  assert.equal(result.created, true, JSON.stringify(result));
  assert.equal(fetched.length, 2);
  const draft = result.draft;
  assert.equal(draft.template, 'ua-media');
  assert.equal(draft.slides, 2, 'dve fotky = karusel');
  assert.ok(studio.checks(draft).some(c => c.level === 'warn' && /obete/.test(c.text)));
  assert.throws(() => studio.setSettings({ autoPublish: { 'ua-media': true } }), /auto_publish_forbidden/);
  assert.equal(studio.templateStats().find(x => x.id === 'ua-media').autoPublishAllowed, false);
});

test('Štúdio: nastavenia Ukrajiny a STALE-ERROR zdroja = zastarané', async t => {
  const { studio } = setup(t, { '/api/launches': { __headers: { 'x-gev-cache': 'STALE-ERROR' }, body: { results: [] } } });
  assert.equal((await studio.generate('launch')).reason, 'stale');
  assert.deepEqual(studio.setSettings({ ua: { airMinOblasts: 12, mediaPerDay: 3, media: false } }).ua, { airMinOblasts: 12, mediaPerDay: 3, media: false });
  assert.throws(() => studio.setSettings({ ua: { airMinOblasts: 1 } }), /invalid_input/);
  assert.throws(() => studio.setSettings({ ua: { mediaPerDay: 99 } }), /invalid_input/);
});

test('Štúdio: zlyhané stiahnutie záberu sa 6 h preskočí a príde na rad ďalší príspevok', async t => {
  const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#224488' } }).jpeg().toBuffer();
  const { studio } = setup(t, { '/api/ukraine/events': { media: [tg('dsns_telegram', 50), tg('GeneralStaffZSU', 51, { publishedAt: NOW - 2 * H })] } },
    { fetchMedia: async url => { if (url.includes('/50')) throw new Error('médium: HTTP 500'); return photo; } });
  const first = await studio.generate('ua-media');
  assert.deepEqual([first.created, first.reason, first.key], [false, 'source_unavailable', 'ua-media:tg:dsns_telegram/50']);
  const second = await studio.generate('ua-media');
  assert.equal(second.created, true);
  assert.equal(second.draft.eventKey, 'ua-media:tg:GeneralStaffZSU/51');
});
