// src/data/eventCard.test.mjs — obrázok udalosti (Udalosti, etapa 2, 2026-09-30). Testy SPRÁVANIA:
// zjednodušená stopa zachová diery (kreslia sa čiarkovane, nič sa nedopočítava), výrez zameraný
// na udalosť, orezanie mora, obsah obrázka FZ1073 (titulok, let, stav overenia, 6 očíslovaných
// momentov, zdroje) a skutočné vykreslenie do JPEG v oboch formátoch cez sharp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { CARD_FORMATS, buildEventCardSvg, cardBBox, clipRing, incidentWindow, simplifyTrack, wrapText } from './eventCard.js';
import { createEventCardRenderer, parseBorderLines } from './eventCardRender.js';
import { normalizeTrack } from './flightAnomalies.js';
import { fz1073, fz1073Event } from './fixtures/flightEventFixtures.mjs';

const P = (t, lat, lon, alt = 10_000, gnd = false) => ({ t, lat, lon, alt, gnd });

test('zjednodušená stopa: najviac N bodov, kraje dier zachované, výška v stopách, na zemi 0', () => {
  const pts = [P(0, 25, 55, 0, true), ...Array.from({ length: 998 }, (_, i) => P(60 + i * 10, 25 + i * 0.005, 55 - i * 0.01)), P(20_000, 31, 38, 4580)];
  const tr = simplifyTrack(pts, 100);
  assert.ok(tr.length <= 120, `${tr.length}`);
  assert.deepEqual(tr[0], [0, 25, 55, 0], 'na zemi výška 0');
  assert.equal(tr.at(-1)[0], 20_000);
  assert.equal(tr.at(-2)[0], 60 + 997 * 10, 'posledný bod pred dierou ostane — diera sa kreslí od neho');
  assert.equal(tr.at(-1)[3], Math.round(4580 / 0.3048));
});

test('výrez a orezanie: letisko do ~700 km v obraze, pomer plochy, more orezané obdĺžnikom', () => {
  const track = [[0, 30, 38, 34000], [100, 31, 37, 15000]];
  const route = { destination: { lat: 32.01, lon: 34.89 }, origin: { lat: 25.25, lon: 55.36 } };
  const bb = cardBBox(track, route, 2);
  assert.ok(bb.w < 34.89 && bb.e > 38, 'Tel Aviv (~350 km) vo výreze');
  assert.ok(bb.e < 55.36, 'Dubaj (~1 800 km) nie — trasa k nemu len vbehne od okraja');
  assert.ok(Math.abs(((bb.e - bb.w) * bb.kx) / (bb.n - bb.s) - 2) < 1e-9, 'pomer plochy');
  const sq = clipRing([[-10, -10], [110, -10], [110, 110], [-10, 110]], 0, 0, 100, 100);
  assert.deepEqual(sq.map((p) => p.map(Math.round)).sort(), [[0, 0], [100, 0], [100, 100], [0, 100]].sort());
  assert.deepEqual(clipRing([[200, 200], [300, 200], [300, 300]], 0, 0, 100, 100), [], 'mimo výrezu nič');
  assert.deepEqual(wrapText('a bb ccc dddd', 6), ['a bb', 'ccc', 'dddd']);
});

async function fzCardEvent() {
  const e = await fz1073Event();
  const { oko, adsblol } = fz1073();
  e.track = simplifyTrack(normalizeTrack([...oko, ...adsblol]));
  return e;
}

test('obrázok FZ1073: titulok, let, OVERENÉ 2 siete + 4 médiá, 6 momentov, diera čiarkovane, Tel Aviv, zdroje', async () => {
  const e = await fzCardEvent();
  const marine = [{ polygons: [[[30, 30], [35, 30], [35, 34], [30, 34]]] }];
  const borders = [[[35, 29], [36, 32]]];
  const svg = buildEventCardSvg(e, { format: 'og', marine, borders });
  assert.match(svg, /^<svg[^>]+width="1200" height="630"/);
  assert.ok(svg.includes('>Nezákonný zásah na palube<'), 'titulok zalomený');
  assert.ok(svg.includes('>Let FZ1073 · Fly Dubai · Dubai → Tel Aviv<'));
  assert.ok(svg.includes('OVERENÉ: 2 siete prijímačov + 4 médiá'));
  for (let i = 1; i <= 6; i += 1) assert.ok(svg.includes(`>${i}</text>`), `moment ${i}`);
  assert.ok(!svg.includes('>7</text>'), 'len kľúčové momenty');
  assert.ok(/stroke-dasharray="7 6"/.test(svg), 'diera bez údajov čiarkovane');
  assert.ok(svg.includes('TLV Tel Aviv'));
  assert.ok(svg.includes('Médiá: JTA, The Jerusalem Post, The Guardian,'));
  assert.ok(svg.includes('údaje OpenSky Network, adsb.lol (ODbL) · plán letu adsbdb'), 'trasa letu je z adsbdb — uvedené');
  assert.ok(svg.includes('>okolive.sk · mapa Natural Earth<'));
  assert.ok(svg.includes('(len adsb.lol)'), 'kód videla len jedna sieť');
  const [from, to] = incidentWindow(e);
  assert.ok(from < e.firstT && to > e.lastT);
  const draft = buildEventCardSvg({ ...e, news: { status: 'reported', trusted: [] }, callsign: 'A<B' }, { format: 'og' });
  assert.ok(draft.includes('NÁHĽAD — ešte neoverené'), 'bez overenia správami nie je „overené"');
  assert.ok(!draft.includes('Médiá:'));
});

test('obrázok neoverenej udalosti s údajmi len z OpenSky (naživo FZ1073 pred denným archívom): netvrdí dve siete', async () => {
  const e = await fzCardEvent();
  assert.ok(buildEventCardSvg(e).includes('>Časy UTC · OpenSky + adsb.lol<'));
  const one = { ...e, status: 'unverified', coverage: e.coverage.map((c) => (c.id === 'adsblol' ? { ...c, points: 0 } : c)) };
  const svg = buildEventCardSvg(one, { format: 'og' });
  assert.ok(svg.includes('>Časy UTC · OpenSky<'), 'len sieť, ktorá má údaje');
  assert.ok(!svg.includes('adsb.lol<') && !svg.includes('OVERENÉ'));
  assert.ok(svg.includes('NÁHĽAD — ešte neoverené'));
});

test('server: mapové podklady sa načítajú raz, sharp dynamicky; zlyhané načítanie sharp sa nepamätá; neznámy formát = og', async () => {
  const e = await fzCardEvent();
  const reads = [];
  let loads = 0;
  let fail = true;
  const svgs = [];
  const fakeSharp = (buf) => { svgs.push(String(buf)); return { jpeg: () => ({ toBuffer: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }) }; };
  const render = createEventCardRenderer({
    dataDir: 'D:/podklady',
    readFile: (f) => {
      reads.push(String(f).replace(/\\/g, '/'));
      return f.endsWith('marine.json')
        ? JSON.stringify({ features: [{ polygons: [[[30, 25], [40, 25], [40, 35], [30, 35]]] }] })
        : '{"type":"Feature","geometry":{"type":"LineString","coordinates":[[35,29],[39,31]]}}\nnie json\n{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]}}\n';
    },
    sharpLoader: async () => { loads += 1; if (fail) { fail = false; throw new Error('sharp chýba'); } return fakeSharp; },
  });
  await assert.rejects(render(e, 'og'), /sharp chýba/);
  const og = await render(e, 'og');
  const feed = await render(e, 'feed');
  const odd = await render(e, 'tiff');
  assert.equal(loads, 2, 'po zlyhaní nový pokus, potom už z pamäte');
  assert.deepEqual(reads, ['D:/podklady/natural_earth/marine.json', 'D:/podklady/boundaries/boundaries.geojsonl'], 'podklady raz');
  assert.deepEqual([og.width, og.height, feed.width, feed.height, odd.format], [1200, 630, 1080, 1350, 'og']);
  assert.ok(svgs[0].includes('fill="#0a1622"'), 'more z podkladov je v obrázku');
  assert.ok(svgs[0].includes('stroke-dasharray="4 3"'), 'hranica z GeoJSONL je v obrázku');
  assert.deepEqual(parseBorderLines('{"geometry":{"type":"LineString","coordinates":[[1,2],[3,4]]}}\n\n{"geometry":{"type":"LineString","coordinates":[[1,2]]}}'), [[[1, 2], [3, 4]]], 'čiara s jediným bodom nie');
});

test('JPEG cez sharp: og 1200×630 aj feed 1080×1350, pod limitom zdieľania 400 kB', async () => {
  const e = await fzCardEvent();
  for (const format of ['og', 'feed']) {
    const jpg = await sharp(Buffer.from(buildEventCardSvg(e, { format }))).jpeg({ quality: 86 }).toBuffer();
    const meta = await sharp(jpg).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', CARD_FORMATS[format].w, CARD_FORMATS[format].h]);
    assert.ok(jpg.length < 400 * 1024, `${format} ${jpg.length} B`);
  }
});

test('obrázok s pristátím zo správ (FZ1073 → Tabuk): letisko je na mape, značka prázdna (nevideli ju siete), bez čiary k stope; zoznam „podľa správ"', async () => {
  const { fz1073ReportedEvent } = await import('./fixtures/flightEventFixtures.mjs');
  const e = await fz1073ReportedEvent(await fzCardEvent());
  for (const format of ['og', 'feed']) {
    const svg = buildEventCardSvg(e, { format });
    const hollow = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="[^"]+" fill-opacity="0.85" stroke="[^"]+" stroke-width="2.5" stroke-dasharray="4 3"\/>/g)];
    assert.equal(hollow.length, 1, `${format}: jedna prázdna značka zo správ`);
    const [cx, cy] = [Number(hollow[0][1]), Number(hollow[0][2])];
    const map = format === 'feed' ? { w: 1080, h: 640 - 30 } : { w: 720, h: 630 - 118 - 30 };
    assert.ok(cx > 0 && cx < map.w && cy > 0 && cy < map.h, `${format}: značka Tabuku v mape nad grafom (${cx}, ${cy})`);
    assert.ok(svg.includes('>7</text>'), `${format}: siedmy moment = pristátie zo správ`);
    assert.ok(svg.includes('podľa správ'), `${format}: zoznam hovorí „podľa správ"`);
    // Trasa sa nedokresľuje: stopa končí na poslednom meraní (žiadna čiara k Tabuku).
    const paths = [...svg.matchAll(/<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="3.2"/g)].map((m) => m[1]);
    const ends = paths.join(' ').match(/[\d.]+ [\d.]+/g).map((p) => p.split(' ').map(Number));
    assert.ok(!ends.some(([x, y]) => Math.hypot(x - cx, y - cy) < 6), `${format}: žiadna čiara stopy nekončí na letisku zo správ`);
  }
  // Bez faktov zo správ ostáva obrázok rovnaký ako doteraz (6 momentov, výrez len zo stopy a trasy).
  const plain = buildEventCardSvg(await fzCardEvent(), { format: 'og' });
  assert.ok(!plain.includes('>7</text>'));
  assert.ok(!plain.includes('stroke-dasharray="4 3"/>'));
});
