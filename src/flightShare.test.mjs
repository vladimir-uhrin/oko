// Kvalitné zdieľanie letu (2026-10-11): text príspevku a pás na obrázku z faktov karty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlightShareCopy, drawFlightShareCard, flightShareHeadline, flightShareProgressPercent } from './flightShare.js';
import { collectShareSources } from './shareFrame.js';

const LIVE_CARD = {
  icao24: '394a0e',
  callsign: 'AFR012',
  flightIata: 'AF12',
  identLine: 'Air France · Boeing 777 328ER · reg. F-GSQO',
  routeLine: 'CDG Paris → JFK New York',
  progress: { fractionDone: 0.22, etaMinutes: 354 },
  flightLines: ['Letová hladina FL320 (≈ 9 754 m)', 'Rýchlosť 418 kts (774 km/h) · kurz 297° (SZ)', 'vietor −40 km/h'],
  estimated: false,
  estimateLine: '',
  alertLine: '',
};
const ESTIMATED_CARD = {
  ...LIVE_CARD,
  icao24: '78115f',
  callsign: 'CCA754',
  flightIata: 'CA754',
  identLine: 'Air China · Boeing 777 300ER · reg. B-1429',
  routeLine: '',
  progress: null,
  estimated: true,
  estimateLine: 'odhadovaná poloha ±160 km · zo skutočnej polohy HFDL',
};

test('hlavička spojí volací znak a IATA číslo, rovnaké nezdvojí', () => {
  assert.equal(flightShareHeadline(LIVE_CARD), 'AFR012 · AF12');
  assert.equal(flightShareHeadline({ callsign: 'OKVVA', flightIata: 'OKVVA' }), 'OKVVA');
  assert.equal(flightShareHeadline({ icao24: 'abc123' }), 'ABC123');
});

test('priebeh letu v percentách, nezmysel = null', () => {
  assert.equal(flightShareProgressPercent({ fractionDone: 0.224 }), 22);
  assert.equal(flightShareProgressPercent({ fractionDone: 1.4 }), null);
  assert.equal(flightShareProgressPercent(null), null);
});

test('živý let: titulok s aerolinkou a trasou, popis NAŽIVO s faktami a okolive.sk', () => {
  const copy = buildFlightShareCopy(LIVE_CARD, { whenMs: Date.UTC(2026, 9, 11, 20, 0), lang: 'sk' });
  assert.equal(copy.title, 'AFR012 · AF12 · Air France · CDG Paris → JFK New York | OKO');
  assert.match(copy.description, /^NAŽIVO · Letová hladina FL320/);
  assert.match(copy.description, /22 % trasy/);
  assert.match(copy.description, /okolive\.sk/);
  assert.doesNotMatch(copy.description, /vietor/, 'do popisu idú len dva riadky letu');
  assert.ok(copy.text.startsWith(copy.title));
  assert.ok(copy.title.length <= 116 && copy.description.length <= 280);
});

test('odhad je v texte poctivo označený aj so zdrojom (pravidlo 2)', () => {
  const copy = buildFlightShareCopy(ESTIMATED_CARD, { lang: 'sk' });
  assert.match(copy.description, /^ODHAD polohy \(odhadovaná poloha ±160 km · zo skutočnej polohy HFDL\)/);
  const en = buildFlightShareCopy(ESTIMATED_CARD, { lang: 'en' });
  assert.match(en.description, /^ESTIMATED position/);
});

function fakeCtx() {
  const texts = [];
  const fills = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    fill() { fills.push(ctx.fillStyle); }, stroke() {}, fillRect() {},
    measureText: (text) => ({ width: String(text).length * 10 }),
    fillText(text, x, y) { texts.push({ text, x, y, color: ctx.fillStyle }); },
  };
  return { ctx, texts };
}

test('pás na obrázku: značka okolive.sk, hlavička, štítok stavu, trasa, odhad', () => {
  const live = fakeCtx();
  drawFlightShareCard(live.ctx, LIVE_CARD, 1200, 594, { lang: 'sk' });
  const liveText = live.texts.map((x) => x.text);
  assert.ok(liveText.includes('okolive.sk'));
  assert.ok(liveText.includes('NAŽIVO'));
  assert.ok(liveText.includes('22 %'));
  assert.ok(liveText.some((x) => x.startsWith('CDG Paris')));
  for (const item of live.texts) {
    assert.ok(item.y >= 0 && item.y < 594, `text v obraze nad pásom atribúcie: ${item.text}`);
  }

  const est = fakeCtx();
  drawFlightShareCard(est.ctx, ESTIMATED_CARD, 1200, 594, { lang: 'sk' });
  const estText = est.texts.map((x) => x.text);
  assert.ok(estText.includes('ODHAD'));
  assert.ok(estText.some((x) => /HFDL/.test(x)), 'zdroj odhadu je na obrázku');
  assert.ok(!estText.includes('NAŽIVO'));
});

test('zastaraný let (vynechaný poll, čakanie feedu) nie je NAŽIVO: ZASTARANÉ v texte aj jantárový štítok', () => {
  const stale = { ...LIVE_CARD, stale: true };
  const sk = buildFlightShareCopy(stale, { lang: 'sk' });
  // 2026-10-16: lietadlo sa počas vynechaných pollov posúva po poslednom kurze (dead reckoning) —
  // „posledná známa poloha" nebola pravda; text hovorí, že poloha je dopočítaná.
  assert.match(sk.description, /^ZASTARANÉ \(poloha dopočítaná z posledného signálu\) · Letová hladina FL320/);
  assert.doesNotMatch(sk.description, /NAŽIVO|posledná známa/);
  const enCopy = buildFlightShareCopy(stale, { lang: 'en' });
  assert.match(enCopy.description, /^STALE \(position extrapolated from the last signal\) · /);
  assert.doesNotMatch(enCopy.description, /last known/);
  // Odhad má prednosť pred zastaraním (odhad je vždy aj „nie naživo", ale nesie zdroj).
  assert.match(buildFlightShareCopy({ ...ESTIMATED_CARD, stale: true }, { lang: 'sk' }).description, /^ODHAD polohy/);

  const { ctx, texts } = fakeCtx();
  drawFlightShareCard(ctx, stale, 1200, 594, { lang: 'sk' });
  const chip = texts.find((x) => x.text === 'ZASTARANÉ');
  assert.ok(chip, 'štítok ZASTARANÉ');
  assert.equal(chip.color, '#fbbf24', 'tón odhadu, nie zelené NAŽIVO');
  assert.ok(!texts.some((x) => x.text === 'NAŽIVO'));
  const note = texts.find((x) => x.text === 'Poloha dopočítaná z posledného signálu');
  assert.ok(note, 'aj na obrázku/videu: prečo ZASTARANÉ');
  assert.equal(note.color, '#fbbf24');
  const en = fakeCtx();
  drawFlightShareCard(en.ctx, stale, 1200, 594, { lang: 'en' });
  assert.ok(en.texts.some((x) => x.text === 'STALE'));
  assert.ok(en.texts.some((x) => x.text === 'Position extrapolated from the last signal'));
  // Živý let ani odhad (má vlastný riadok zdroja) poznámku nemajú.
  const live = fakeCtx();
  drawFlightShareCard(live.ctx, LIVE_CARD, 1200, 594, { lang: 'sk' });
  assert.ok(!live.texts.some((x) => /dopočítaná/.test(x.text)));
  const est = fakeCtx();
  drawFlightShareCard(est.ctx, { ...ESTIMATED_CARD, stale: true }, 1200, 594, { lang: 'sk' });
  assert.ok(!est.texts.some((x) => /dopočítaná/.test(x.text)));
});

test('dlhý text sa skráti do šírky pásu', () => {
  const { ctx, texts } = fakeCtx();
  drawFlightShareCard(ctx, { ...LIVE_CARD, identLine: 'X'.repeat(400) }, 1200, 594);
  const ident = texts.find((x) => x.text.startsWith('XXX'));
  assert.ok(ident.text.endsWith('…'));
  assert.ok(ident.text.length * 10 <= 744 - 44 + 10);
});

test('zdieľanie letu vynechá plátna prekryvov (kartu nahrádza pás)', () => {
  const cesium = { width: 10, height: 10 };
  const overlay = { width: 10, height: 10 };
  const doc = { querySelectorAll: () => [overlay] };
  assert.deepEqual(collectShareSources({ viewer: { canvas: cesium }, document: doc }), [cesium, overlay]);
  assert.deepEqual(collectShareSources({ viewer: { canvas: cesium }, document: doc, overlays: false }), [cesium]);
});
