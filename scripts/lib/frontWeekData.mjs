// scripts/lib/frontWeekData.mjs — vstupy modelu „Týždeň na fronte" zo služby OKO a archívu (2026-10-03).
// Hlásenia GŠ po dňoch (`/api/ukraine/events/directions`, 14 dní) doplnené o údery z archívu hlásení
// (`<archív>/reports/<deň>.json` → strikes; trasa ich nenesie) a dve snímky mapy DeepState (`…/deepstate?at=`):
// posledná dostupná a tá spred 7 dní — ten istý pár, z ktorého vrstva na mape počíta „zmenu za 7 dní".
import fs from 'node:fs';
import path from 'node:path';
import { FRONT_WEEK_DAYS, frontWeekModel, weekRanges } from '../../src/data/frontWeek.js';
import { shiftDay } from '../../src/data/ukraineContactLine.js';

/** O koľko dní smie byť snímka „spred týždňa" staršia než žiadaný deň (zrkadlo zapisuje len pri zmene mapy). */
export const MAX_SNAPSHOT_FALLBACK_DAYS = 2;

const getJson = async (url, fetchImpl) => {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw Object.assign(new Error(`${url}: HTTP ${res.status}`), { code: 'FRONT_WEEK_FETCH', status: res.status });
  return res.json();
};

/**
 * @param {object} p
 * @param {string} p.baseUrl služba OKO (http://localhost:4173)
 * @param {string} [p.refDay] posledný deň týždňa; predvolene posledný deň s hlásením
 * @param {string} [p.archiveDir] `.gev-cache/ukraine/events` (pre údery)
 * @returns {Promise<{model: object, inputs: {days: object, snapshotNow: object|null, snapshotBefore: object|null}}>}
 */
export async function loadFrontWeek({ baseUrl, refDay = null, archiveDir = null, fetchImpl = (...a) => globalThis.fetch(...a), today = new Date().toISOString().slice(0, 10) } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const probeTo = refDay || today;
  const first = await getJson(`${base}/api/ukraine/events/directions?from=${shiftDay(probeTo, -20)}&to=${probeTo}`, fetchImpl);
  const have = Object.keys(first.days || {}).filter((d) => first.days[d]).sort();
  if (!have.length) throw Object.assign(new Error('archív hlásení GŠ je pre toto obdobie prázdny'), { code: 'FRONT_WEEK_NO_REPORTS' });
  const ref = refDay || have[have.length - 1];
  const ranges = weekRanges(ref);
  const days = {};
  for (const [day, rep] of Object.entries(first.days || {})) if (rep && day >= ranges.prev.from && day <= ranges.week.to) days[day] = { ...rep };
  if (archiveDir) {
    for (const day of Object.keys(days)) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(archiveDir, 'reports', `${day}.json`), 'utf8'));
        if (raw?.strikes) days[day].strikes = raw.strikes;
      } catch { /* deň bez súboru — údery ostanú neznáme */ }
    }
  }
  let snapshotNow = null;
  let snapshotBefore = null;
  try {
    snapshotNow = await getJson(`${base}/api/ukraine/events/deepstate?at=${ref}`, fetchImpl);
    if (snapshotNow?.day) {
      const asOfDay = shiftDay(snapshotNow.day, -FRONT_WEEK_DAYS);
      const before = await getJson(`${base}/api/ukraine/events/deepstate?at=${asOfDay}`, fetchImpl);
      // Zrkadlo zapisuje len pri zmene mapy: snímka o deň–dva staršia je stav mapy aj v žiadaný deň.
      // Väčšia diera znamená výpadok zrkadla — porovnanie by nebolo „za týždeň", zmena sa neuvedie.
      if (before?.day && before.day <= asOfDay && before.day >= shiftDay(asOfDay, -MAX_SNAPSHOT_FALLBACK_DAYS)) snapshotBefore = { ...before, asOfDay };
    }
  } catch (error) {
    // Bez snímok mapy video stojí len na hláseniach — model ponesie `change: null`.
    snapshotNow = snapshotNow?.features ? snapshotNow : null;
    snapshotBefore = null;
    if (error?.code !== 'FRONT_WEEK_FETCH') throw error;
  }
  const model = frontWeekModel({ days, refDay: ref, snapshotNow, snapshotBefore });
  return { model, inputs: { days, snapshotNow, snapshotBefore } };
}
