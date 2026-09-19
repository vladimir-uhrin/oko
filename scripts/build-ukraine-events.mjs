// OKO — spätné naplnenie archívu udalostí modulu UKRAJINA (etapa 3a, 2026-09-19;
// plán docs/drafts/ukrajina-plan.md). Dev proxy (src/data/ukraineEventsProxy.js)
// archivuje priebežne; tento skript naplní históriu naraz:
//   .gev-cache/ukraine/events/viina/<rok>.json          VIINA 2.0 (ODbL) od 2022
//   .gev-cache/ukraine/events/geoconfirmed/<deň>.json   posledných 90 dní (rolujúce)
//   .gev-cache/ukraine/events/reports/<deň>.json        hlásenia GŠ zo stránkovaného feedu
//   .gev-cache/ukraine/events/media/<deň>.json          jeden zber médií (YouTube/Telegram/ArmyInform)
//
// Usage:
//   node scripts/build-ukraine-events.mjs --all
//   node scripts/build-ukraine-events.mjs --viina [--years 2022-2026] [--force]
//   node scripts/build-ukraine-events.mjs --geoconfirmed [--days 90]
//   node scripts/build-ukraine-events.mjs --reports [--pages 6]
//   node scripts/build-ukraine-events.mjs --media
//
// Etiketa: VIINA je jeden zip na rok (LFS media, ~0,6–8 MB); GeoConfirmed po
// 30-dňových oknách s pauzou (API prosí nehammerovať; hromadný export histórie
// nechce — preto len 90 dní); ArmyInform 1,5 s medzi článkami. Bez kľúčov.
import {
  GEOCONFIRMED_ROLLING_DAYS, VIINA_FIRST_YEAR, archiveDayItems, backfillReports, collectMedia, controlBackfill, controlSnapshot, dayKey, dayShift,
  firesRefresh, geoconfirmedRefresh, viinaStatus, viinaYear,
} from './lib/ukraineArchive.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const all = has('--all');
const root = process.cwd();
const now = Date.now();
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!all && !has('--viina') && !has('--geoconfirmed') && !has('--reports') && !has('--media') && !has('--control') && !has('--control-history') && !has('--fires')) {
  console.log('usage: node scripts/build-ukraine-events.mjs --all | --viina [--years 2022-2026] [--force] | --geoconfirmed [--days 90] | --reports [--pages 6] | --media | --control | --control-history [--step 7] | --fires');
  process.exit(2);
}

// Územná kontrola (Wikipedia, CC BY-SA): najnovšia snímka; história po týždňoch
// od 24. 2. 2022 (jeden dopyt naraz, pauza 1,2 s — Wikipedia etiketa).
if (all || has('--control') || has('--control-history')) {
  const r = await controlSnapshot(root, { now, force: has('--force'), log });
  log(`Kontrola (dnes): ${r.status} (${r.count} bodov${r.revisionAt ? ', revízia ' + r.revisionAt : ''})${r.error ? ' — ' + r.error : ''}`);
}
if (all || has('--control-history')) {
  const step = Math.max(1, Math.min(60, Number(val('--step', 7)) || 7));
  const r = await controlBackfill(root, { now, stepDays: step, log });
  log(`Kontrola (história po ${step} d): nových ${r.done}, existujúcich ${r.skipped}`);
}

// Vojnové požiare (The Economist war-fire model, CC BY 4.0): jeden 70 MB CSV.
if (all || has('--fires')) {
  const r = await firesRefresh(root, { now, force: has('--force'), log });
  log(`Požiare: ${r.status}${Number.isFinite(r.total) ? ' (' + r.total + ' za ' + r.days + ' dní)' : ''}${r.error ? ' — ' + r.error : ''}`);
}

if (all || has('--viina')) {
  const thisYear = new Date(now).getUTCFullYear();
  const [a, b] = String(val('--years', `${VIINA_FIRST_YEAR}-${thisYear}`)).split('-').map(Number);
  for (let year = a; year <= (Number.isFinite(b) ? b : a); year += 1) {
    const r = await viinaYear(root, year, { now, force: has('--force'), log });
    log(`VIINA ${year}: ${r.status} (${r.count} udalostí)${r.error ? ' — ' + r.error : ''}`);
    await sleep(1500);
  }
  console.log('VIINA stav:', JSON.stringify(await viinaStatus(root, { now })));
}

if (all || has('--geoconfirmed')) {
  const days = Math.max(1, Math.min(365, Number(val('--days', GEOCONFIRMED_ROLLING_DAYS)) || GEOCONFIRMED_ROLLING_DAYS));
  const end = dayKey(now);
  for (let back = 0; back < days; back += 30) {
    const to = dayShift(end, -back);
    const from = dayShift(end, -Math.min(back + 29, days - 1));
    const r = await geoconfirmedRefresh(root, from, to, { now, force: has('--force'), log });
    log(`GeoConfirmed ${from}..${to}: ${r.status}${Number.isFinite(r.count) ? ' (' + r.count + ' udalostí)' : ''}${r.error ? ' — ' + r.error : ''}`);
    await sleep(3000);
  }
}

if (all || has('--reports')) {
  const pages = Math.max(1, Math.min(30, Number(val('--pages', 6)) || 6));
  const r = await backfillReports(root, { pages, now, log });
  log(`Hlásenia GŠ: prezretých ${r.seen}, uložených ${r.stored}`);
}

if (all || has('--media')) {
  const { items, failures } = await collectMedia({ log });
  const r = await archiveDayItems(root, 'media', items, { timeKey: 'publishedAt', key: (it) => it.id, now });
  log(`Médiá: ${items.length} položiek (${failures.length} zlyhaní), pridaných ${r.added}, doplnených ${r.updated}, dní ${r.days}`);
}
