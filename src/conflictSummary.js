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

/**
 * Viacsekciový prehľad naprieč konfliktmi (OKO nie je len Ukrajina): Ukrajina
 * (hlásenie GŠ), ropa (≈ spot) a Blízky východ (počet správ z otvorených
 * zdrojov). Sekcia bez dát sa vynechá. Etická čiara: počty, ceny a zdroje —
 * žiadne osoby ani polohy, žiadne titulky správ (len počet + odkaz). Pure.
 */
export function buildConflictDigest({ report = null, oilModel = null, gulfCount = null, translate = (k) => k, dateText = '' } = {}) {
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
  if (gulfCount != null && Number.isFinite(gulfCount)) {
    blocks.push(`${translate('summary.section.gulf')}\n${translate('summary.gulf.count', { n: gulfCount })}`);
  }
  blocks.push(translate('summary.sources'));
  return { text: blocks.join('\n\n'), sections: { ukraine: uaLines.length, oil: Boolean(oil), gulf: gulfCount } };
}
