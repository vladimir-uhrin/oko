// src/data/eventCard.test.mjs — obrázok udalosti (Udalosti, etapa 2, 2026-09-30). Testy SPRÁVANIA:
// zjednodušená stopa zachová diery (kreslia sa čiarkovane, nič sa nedopočítava), výrez zameraný
// na udalosť, orezanie mora, obsah obrázka FZ1073 (titulok, let, stav overenia, 6 očíslovaných
// momentov, zdroje) a skutočné vykreslenie do JPEG v oboch formátoch cez sharp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { CARD_FORMATS, buildEventCardSvg, cardBBox, clipRing, incidentWindow, simplifyTrack, wrapText } from './eventCard.js';
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
  assert.ok(svg.includes('údaje OpenSky Network, adsb.lol (ODbL)'));
  assert.ok(svg.includes('(len adsb.lol)'), 'kód videla len jedna sieť');
  const [from, to] = incidentWindow(e);
  assert.ok(from < e.firstT && to > e.lastT);
  const draft = buildEventCardSvg({ ...e, news: { status: 'reported', trusted: [] }, callsign: 'A<B' }, { format: 'og' });
  assert.ok(draft.includes('NÁHĽAD — ešte neoverené'), 'bez overenia správami nie je „overené"');
  assert.ok(!draft.includes('Médiá:'));
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
