// src/conflictSummary.js
/**
 * @module conflictSummary
 * @description Textový prehľad konfliktov pre FB popis (propagácia, krok 2).
 * Zatiaľ z najsilnejších denných dát — hlásenie Generálneho štábu ZSU (počty
 * bojových stretov po smeroch). Čistý modul; drží etickú čiaru: len smery,
 * počty a zdroj, žiadne osoby ani polohy jednotiek. Ďalej sa doplní Blízky
 * východ (správy) a úžiny (ropa/premávka).
 */
import { reportByScene } from './data/ukraineReport.js';
import { frontSceneById, frontSceneByGsDirection, frontSceneLabel } from './ukraineFrontScenes.js';

/**
 * Riadky prehľadu smerov z hlásenia: [{ sceneId, label, attacks|null }],
 * zoradené podľa počtu útokov zostupne (neuvedené na koniec). Pure.
 */
export function frontDigestLines(report, { translate = (k) => k } = {}) {
  const byScene = reportByScene(report, frontSceneByGsDirection);
  const lines = [];
  for (const [sceneId, entry] of byScene) {
    const scene = frontSceneById(sceneId);
    if (!scene) continue;
    const attacks = entry.unknown || entry.attacks === null || entry.attacks === undefined ? null : Number(entry.attacks);
    lines.push({ sceneId, label: frontSceneLabel(scene, translate), attacks });
  }
  lines.sort((a, b) => (b.attacks ?? -1) - (a.attacks ?? -1));
  return lines;
}

/** Počet útokov pre daný smer (sceneId) z hlásenia, alebo null. Pure. */
export function frontAttacks(report, sceneId, sceneFor = frontSceneByGsDirection) {
  const byScene = reportByScene(report, sceneFor);
  const e = byScene.get(sceneId);
  if (!e || e.unknown || e.attacks === null || e.attacks === undefined) return null;
  return Number(e.attacks);
}

/**
 * Zostaví prehľad Ukrajiny: hlavička (dátum + zdroj), riadky smerov s útokmi > 0,
 * súčet a zdroj. Vráti { lines, total, text }. Pure.
 */
export function buildUkraineDigest({ report = null, translate = (k) => k, dateText = '' } = {}) {
  const lines = frontDigestLines(report, { translate });
  const total = report && report.total != null ? Number(report.total) : null;
  const date = dateText || report?.reportedAtText || '';
  const head = date ? translate('summary.ukraine.head', { date }) : translate('summary.ukraine.head-nodate');
  const body = lines.filter((l) => l.attacks != null && l.attacks > 0).map((l) => `• ${l.label}: ${l.attacks}`);
  const totalLine = total != null ? translate('summary.ukraine.total', { n: total }) : '';
  const source = translate('summary.ukraine.source');
  const text = [head, ...body, totalLine, source].filter(Boolean).join('\n');
  return { lines, total, text };
}

/** Riadok ropy z modelu (`buildOilModel`): „Brent … · WTI …" (≈ spot), inak ''. Pure. */
export function oilDigestLine(oilModel) {
  if (!oilModel || oilModel.ok === false) return '';
  const parts = [];
  if (oilModel.brent?.usdText) parts.push(`Brent ${oilModel.brent.usdText}`);
  if (oilModel.wti?.usdText) parts.push(`WTI ${oilModel.wti.usdText}`);
  return parts.join(' · ');
}

const DAY_MS = 86_400_000;
const dayKeyOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Denný sumár BLÍZKEHO VÝCHODU (etapa 7, 2026-11-06) z dát modulu: overené udalosti za 24 h a 7 dní
 * (súhrn po dňoch z `/incidents/summary`, celý región), poplachy v Izraeli (posledný deň s poplachom
 * z `/alerts` — počet a oblasti; nikdy „živý alarm", len história), súčty obetí (Tech for Palestine,
 * len čísla s dátumom hlásenia) a internet (OONI — len krajiny so zmenou alebo tichom). Riadok bez
 * dát sa vynechá; bez akýchkoľvek dát vráti prázdne `lines`. Etická čiara: počty a zdroje, žiadne
 * osoby, mená ani polohy. Pure.
 * @param {object} o
 * @param {{days?: Record<string, {total:number}>}|null} [o.incidents] telo `/incidents/summary`
 * @param {{days?: Record<string,{r:number,w:number,d:number}>, areas?: Record<string,{r:number,d:number}>, dataUpdated?: string}|null} [o.alerts] telo `/alerts`
 * @param {{summary?: {gaza?: object, west_bank?: object, lebanon?: object}}|null} [o.humanitarian] telo `/humanitarian`
 * @param {{countries?: Record<string, {level: string, recent: number|null, baseline: number|null}>}|null} [o.internet] telo `/internet`
 * @returns {{ lines: string[], counts: { incidents24h: number|null, incidents7d: number|null, alarms: number|null, alarmDay: string|null } }}
 */
export function buildMideastDigest({ incidents = null, alerts = null, humanitarian = null, internet = null, translate = (k) => k, nowMs = Date.now(), lang = 'sk' } = {}) {
  const lines = [];
  const nf = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'sk-SK');
  const df = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const today = dayKeyOf(nowMs);
  const sum = (days, from, to) => { let n = 0; for (const [d, v] of Object.entries(days || {})) if (d >= from && d <= to) n += Number(v?.total) || 0; return n; };
  let incidents24h = null; let incidents7d = null;
  if (incidents?.days && typeof incidents.days === 'object') {
    incidents24h = sum(incidents.days, dayKeyOf(nowMs - DAY_MS), today);
    incidents7d = sum(incidents.days, dayKeyOf(nowMs - 6 * DAY_MS), today);
    lines.push(`• ${translate('summary.mideast.incidents', { n24: nf.format(incidents24h), n7: nf.format(incidents7d) })}`);
  }
  let alarms = null; let alarmDay = null;
  if (alerts?.days && typeof alerts.days === 'object') {
    for (const [d, v] of Object.entries(alerts.days)) {
      const a = (Number(v?.r) || 0) + (Number(v?.d) || 0);
      if (a > 0 && d <= today && (!alarmDay || d > alarmDay)) { alarmDay = d; alarms = a; }
    }
    if (alarmDay) {
      const weekFrom = dayKeyOf(nowMs - 6 * DAY_MS);
      let week = 0; for (const [d, v] of Object.entries(alerts.days)) if (d >= weekFrom && d <= today) week += (Number(v?.r) || 0) + (Number(v?.d) || 0);
      lines.push(`• ${translate('summary.mideast.alerts', { n: nf.format(alarms), date: df.format(new Date(`${alarmDay}T00:00:00Z`)), week: nf.format(week) })}`);
    } else lines.push(`• ${translate('summary.mideast.alerts-none')}`);
  }
  const g = humanitarian?.summary?.gaza;
  if (g && Number.isFinite(g.killed)) {
    const date = g.lastUpdate ? df.format(new Date(`${g.lastUpdate}T00:00:00Z`)) : '';
    lines.push(`• ${translate('summary.mideast.gaza', { killed: nf.format(g.killed), injured: Number.isFinite(g.injured) ? nf.format(g.injured) : '—', date })}`);
  }
  const lb = humanitarian?.summary?.lebanon;
  if (lb && Number.isFinite(lb.killed)) lines.push(`• ${translate('summary.mideast.lebanon', { killed: nf.format(lb.killed), date: lb.lastUpdate ? df.format(new Date(`${lb.lastUpdate}T00:00:00Z`)) : '' })}`);
  if (internet?.countries && typeof internet.countries === 'object') {
    const changed = Object.entries(internet.countries).filter(([, c]) => c && ['worse', 'better', 'quiet'].includes(c.level));
    for (const [cc, c] of changed) {
      const name = translate(`mideast.net.country.${cc}`);
      lines.push(`• ${translate(`summary.mideast.net.${c.level}`, { country: name === `mideast.net.country.${cc}` ? cc : name, recent: Number.isFinite(c.recent) ? nf.format(c.recent) : '—', baseline: Number.isFinite(c.baseline) ? nf.format(c.baseline) : '—' })}`);
    }
  }
  return { lines, counts: { incidents24h, incidents7d, alarms, alarmDay } };
}

/**
 * Viacsekciový prehľad naprieč konfliktmi (OKO nie je len Ukrajina): Ukrajina
 * (hlásenie GŠ), ropa (≈ spot) a Blízky východ (počet správ z otvorených
 * zdrojov + od etapy 7 denný sumár modulu: udalosti, poplachy, súčty, internet).
 * Sekcia bez dát sa vynechá. Etická čiara: počty, ceny a zdroje —
 * žiadne osoby ani polohy, žiadne titulky správ (len počet + odkaz). Pure.
 */
export function buildConflictDigest({ report = null, oilModel = null, gulfCount = null, mideast = null, translate = (k) => k, dateText = '' } = {}) {
  const date = dateText || report?.reportedAtText || '';
  const blocks = [date ? translate('summary.head', { date }) : translate('summary.head-nodate')];
  const uaLines = frontDigestLines(report, { translate }).filter((l) => l.attacks != null && l.attacks > 0);
  const total = report && report.total != null ? Number(report.total) : null;
  if (uaLines.length || total != null) {
    const sec = [translate('summary.section.ukraine')];
    for (const l of uaLines) sec.push(`• ${l.label}: ${l.attacks}`);
    if (total != null) sec.push(translate('summary.ukraine.total', { n: total }));
    blocks.push(sec.join('\n'));
  }
  const oil = oilDigestLine(oilModel);
  if (oil) blocks.push(`${translate('summary.section.oil')}\n${oil}`);
  const meLines = Array.isArray(mideast?.lines) ? mideast.lines : [];
  if ((gulfCount != null && Number.isFinite(gulfCount)) || meLines.length) {
    const sec = [translate('summary.section.gulf')];
    if (gulfCount != null && Number.isFinite(gulfCount)) sec.push(translate('summary.gulf.count', { n: gulfCount }));
    sec.push(...meLines);
    if (meLines.length) sec.push(translate('summary.mideast.sources'));
    blocks.push(sec.join('\n'));
  }
  blocks.push(translate('summary.sources'));
  return { text: blocks.join('\n\n'), sections: { ukraine: uaLines.length, oil: Boolean(oil), gulf: gulfCount, mideast: meLines.length } };
}
