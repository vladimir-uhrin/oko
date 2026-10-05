// scripts/lib/frontDayData.mjs — dáta denného videa „Deň na fronte" (2026-10-05) zo služby OKO (rovnaké
// endpointy ako Štúdio): ranné hlásenie GŠ (/api/ukraine/report + 8 dní smerov na týždenný priemer), zmena
// frontu z dvoch denných snímok mapy (/api/ukraine/events/deepstate?at=…), nočná hrozba z neba a akčné zábery
// z archívu médií (/api/ukraine/events). Bez hlásenia alebo pri zastaranej mape → { reason } a video sa nerobí.

import { airKindsOf, frontChange, loadFront, loadMedia, loadReport, reportDirections, targetOblast, utcDay } from '../../src/admin/server/studio/ukraine.js';
import { UK_OBLAST_HINTS, mediaToAlert } from '../../src/data/ukraineMedia.js';
import { UKRAINE_GAZETTEER } from '../../src/data/ukraineIncidents.js';
import { isPartialReport } from '../../src/data/ukraineDirectionTrend.js';
import { pickActionClips } from '../../src/data/frontDayClips.js';

const DAY_MS = 86_400_000;
/** Hlásenie GŠ staršie než toto už nie je „ranné hlásenie dňa". */
export const REPORT_MAX_AGE_H = 30;
/** Noc pre hrozbu z neba: posledných 14 h (napr. 19:30 → 9:30). */
export const NIGHT_WINDOW_MS = 14 * 3600_000;

/** Nočná hrozba z neba: ktoré oblasti Ukrajiny Vzdušné sily hlásili v okne a akými prostriedkami. Pure. */
export function nightAir(media, now, windowMs = NIGHT_WINDOW_MS) {
  const alerts = (media || []).map(item => mediaToAlert(item)).filter(a => a && a.t <= now + 60_000 && now - a.t <= windowMs);
  const oblasts = new Set(); const kinds = new Set();
  for (const a of alerts) {
    for (const target of a.targets) { const o = targetOblast(target); if (o) oblasts.add(o); }
    for (const k of airKindsOf(a.text)) kinds.add(k);
  }
  // Poloha oblasti na mapu videa: ťažisko z náznakov oblastí, inak zo zoznamu miest (ako Štúdio).
  const points = [...oblasts].map((name) => {
    const c = UK_OBLAST_HINTS[name] || UKRAINE_GAZETTEER.find((p) => p.name === name);
    return c ? { name, lat: c.lat, lon: c.lon } : null;
  }).filter(Boolean);
  return alerts.length ? { count: oblasts.size, oblasts: [...oblasts], points, kinds: ['missiles', 'drones', 'bombs'].filter(k => kinds.has(k)),
    first: alerts[0]?.t ?? null } : null;
}

/** Priemer stretov za predchádzajúce dni (bez dňa hlásenia a bez čiastkových hlásení); null pri < 4 dňoch. Pure. */
export function weekAverage(days, reportDay) {
  const past = Object.entries(days || {}).filter(([d, r]) => d !== reportDay && r && Number.isFinite(r.total) && !isPartialReport(r)).map(([, r]) => r.total);
  return past.length >= 4 ? Math.round(past.reduce((a, b) => a + b, 0) / past.length) : null;
}

/**
 * @param {{ baseUrl: string, now?: number, fetchImpl?: typeof fetch }} p
 * @returns {Promise<{ model?: object, reason?: string }>}
 */
export async function loadFrontDay({ baseUrl, now = Date.now(), fetchImpl = globalThis.fetch }) {
  const get = async (path) => {
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, { headers: { Accept: 'application/json' } });
      let body = null; try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } catch { return { status: 0, body: null }; }
  };
  const rep = await loadReport({ get, now });
  if (!rep.data) return { reason: rep.reason || 'report_unavailable' };
  const { report, days } = rep.data;
  const publishedAt = Number.isFinite(report?.publishedAt) ? report.publishedAt : Date.parse(report?.reportedAt || '');
  if (!Number.isFinite(report?.total) || !Number.isFinite(publishedAt) || now - publishedAt > REPORT_MAX_AGE_H * 3600_000 || isPartialReport(report)) {
    return { reason: 'no_morning_report' };
  }
  const day = utcDay(publishedAt);

  let change = null;
  const front = await loadFront({ get, now });
  if (front.data) {
    const c = frontChange(front.data.now, front.data.before);
    if (c) {
      const spanDays = Math.max(1, Math.round((Date.parse(`${front.data.now.day}T00:00:00Z`) - Date.parse(`${front.data.before.day}T00:00:00Z`)) / DAY_MS));
      change = { ...c, fromDay: front.data.before.day, toDay: front.data.now.day, spanDays, mapDay: front.data.now.day };
    }
  }

  const mediaRes = await loadMedia({ get, now });
  const media = mediaRes.data?.media || [];
  const directions = reportDirections(report).filter(d => d.attacks > 0).slice(0, 3);
  const focus = [...(change?.directions || []).filter(d => d.ruKm2 >= 1 || d.uaKm2 >= 1).map(d => d.id), ...directions.map(d => d.id)];
  return {
    model: {
      day, now,
      report: { total: report.total, publishedAt, url: report.url || null },
      avg7: weekAverage(days, day),
      directions: directions.map(({ id, attacks, center }) => ({ id, attacks, center })),
      strikes: report.strikes || {},
      change,
      air: nightAir(media, now),
      // Kandidáti: linka nechá najviac 2 použiteľné (záber na výšku alebo nestiahnuteľný vypadne).
      clips: pickActionClips(media, { now, max: 4, focusDirections: focus }),
      frontStale: front.reason || null,
    },
  };
}
