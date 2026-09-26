// OKO — archív modulu BLÍZKY VÝCHOD z príkazového riadka (etapa 2 „KONTROLA SÍDIEL",
// 2026-09-26; etapa 5a „PRECHODY ÚŽINAMI"; plán docs/drafts/blizky-vychod-plan.md). Dev
// proxy (src/data/mideastEventsProxy.js) archivuje priebežne; tento skript stiahne hneď
// alebo naplní históriu po týždňoch:
//   .gev-cache/mideast/events/control/<modul>/<deň>.json   kontrola sídiel z Lua modulu
//       Wikipédie (CC BY-SA 4.0, Wikipedia contributors) — israel-palestine, yemen, syria, lebanon
//   .gev-cache/mideast/events/portwatch/<úžina>.json       denné prechody úžinou z IMF PortWatch
//       (od 1. 1. 2019; hormuz, bab-el-mandeb, suez, cape; atribúcia MMF)
//
// Usage:
//   node scripts/build-mideast-events.mjs --all                       (= --control + --portwatch)
//   node scripts/build-mideast-events.mjs --control [--module <id>] [--force]
//   node scripts/build-mideast-events.mjs --control-history [--module <id>] [--from YYYY-MM-DD] [--step 7] [--limit N]
//   node scripts/build-mideast-events.mjs --portwatch [--force]
//
// Etiketa Wikimedia: jeden dopyt naraz, pauza 1,2 s medzi dopytmi, popisný User-Agent
// s kontaktom (scripts/lib/mideastArchive.mjs). Históriu (jeden dopyt na týždeň a
// modul) spúšťa človek — `--all` ju zámerne vynecháva. PortWatch (verejný ArcGIS MMF):
// úžiny postupne s pauzou 1,5 s; prvé stiahnutie = celá séria (3 strany na úžinu).
import {
  MIDEAST_CONTROL_FIRST_DAY, MIDEAST_CONTROL_MODULE_IDS, controlBackfill, isDay, portwatchRefresh, wikiControlSnapshot,
} from './lib/mideastArchive.mjs';
import { PORTWATCH_KEYS } from '../src/data/portwatch.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const all = has('--all');
const root = process.cwd();
const now = Date.now();
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAUSE_MS = 1200;
const usage = `usage: node scripts/build-mideast-events.mjs --all | --control [--module <id>] [--force] | --control-history [--module <id>] [--from YYYY-MM-DD] [--step 7] [--limit N] | --portwatch [--force]\n  moduly: ${MIDEAST_CONTROL_MODULE_IDS.join(', ')}\n  úžiny PortWatch: ${PORTWATCH_KEYS.join(', ')}`;

if (!all && !has('--control') && !has('--control-history') && !has('--portwatch')) {
  console.log(usage);
  process.exit(2);
}

const onlyModule = val('--module', null);
if (onlyModule && !MIDEAST_CONTROL_MODULE_IDS.includes(onlyModule)) {
  console.log(`neznámy modul '${onlyModule}'\n${usage}`);
  process.exit(2);
}
const modules = onlyModule ? [onlyModule] : [...MIDEAST_CONTROL_MODULE_IDS];

const unmappedText = (u) => {
  const entries = Object.entries(u || {});
  if (!entries.length) return 'neznáme ikony 0';
  const total = entries.reduce((a, [, n]) => a + n, 0);
  return `neznáme ikony ${total} (${entries.map(([k, n]) => `${k}×${n}`).join(', ')})`;
};

// Územná kontrola (Wikipedia, CC BY-SA): najnovšia snímka každého modulu.
if (all || has('--control')) {
  for (const [i, moduleId] of modules.entries()) {
    if (i > 0) await sleep(PAUSE_MS);
    const r = await wikiControlSnapshot(root, moduleId, { now, force: has('--force'), log });
    log(`Kontrola ${moduleId} (${r.day}): ${r.status} · ${r.count} bodov · revízia ${r.revisionAt || '—'} · ${unmappedText(r.unmapped)}${r.error ? ' — ' + r.error : ''}`);
  }
}

// História po týždňoch od --from (predvolene 28. 2. 2026): jeden dopyt naraz, pauza 1,2 s.
if (has('--control-history')) {
  const from = val('--from', MIDEAST_CONTROL_FIRST_DAY);
  if (!isDay(from)) { console.log(`zlý deň '--from ${from}' (YYYY-MM-DD)\n${usage}`); process.exit(2); }
  const step = Math.max(1, Math.min(60, Number(val('--step', 7)) || 7));
  const limitRaw = Number(val('--limit', NaN));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : Infinity;
  for (const [i, moduleId] of modules.entries()) {
    if (i > 0) await sleep(PAUSE_MS);
    const r = await controlBackfill(root, moduleId, { from, stepDays: step, limit, pauseMs: PAUSE_MS, now, log });
    log(`Kontrola história ${moduleId} (po ${step} d od ${from}${Number.isFinite(limit) ? ', strop ' + limit : ''}): nových ${r.done}, existujúcich ${r.skipped}, chýb ${r.errors}`);
  }
}

// Prechody úžinami (IMF PortWatch): štyri úžiny postupne, pauza 1,5 s.
if (all || has('--portwatch')) {
  for (const [i, key] of PORTWATCH_KEYS.entries()) {
    if (i > 0) await sleep(1500);
    const r = await portwatchRefresh(root, key, { now, force: has('--force'), log });
    log(`PortWatch ${key}: ${r.status} · ${r.count} dní · posledný ${r.lastDay || '—'}${r.fetched !== undefined ? ` · stiahnutých ${r.fetched}` : ''}${r.error ? ' — ' + r.error : ''}`);
  }
}
