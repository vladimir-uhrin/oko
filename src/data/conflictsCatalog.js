// src/data/conflictsCatalog.js
/**
 * @module conflictsCatalog
 * @description Katalóg zdieľateľných „konfliktov"/scén naprieč regiónmi (základ
 * pre propagáciu: snímky, video, sumár — OKO nie je len o Ukrajine). Tenká
 * kurátorská vrstva NAD existujúcimi presetmi scén: smery frontu
 * (`ukraineFrontScenes`), námorné úžiny (`chokepointScenes`) a situácie zo správ
 * (napr. Perzský záliv). Čistý modul (bez Cesia, bez DOM). Každá položka je
 * jedna postnuteľná scéna s rámovaním; `buildConflictCardModel` z nej spraví
 * model pre `drawKartaExport` (zdieľacia kartička 1200×630).
 */
import { CHOKEPOINT_SCENES, chokepointSceneLabel } from '../chokepointScenes.js';
import { FRONT_SCENES, frontSceneLabel } from '../ukraineFrontScenes.js';
import { WORLD_OUTLINE_BBOX, WORLD_OUTLINE_RINGS } from './worldOutline.js';

export const CONFLICT_KINDS = Object.freeze(['ukraine-front', 'chokepoint', 'situation']);
export const CONFLICT_REGIONS = Object.freeze(['ukraine', 'maritime', 'middle-east']);

/** Situácie zo správ (bez presetu scény): región s vlastným rámovaním. */
export const SITUATION_CONFLICTS = Object.freeze([
  Object.freeze({
    id: 'gulf', kind: 'situation', region: 'middle-east', name: 'Persian Gulf', titleKey: 'conflict.gulf',
    center: Object.freeze({ lat: 26.5, lon: 52.0 }), rectDegrees: Object.freeze([48, 23, 58, 30]),
  }),
]);

/**
 * Plochý zoznam zdieľateľných scén: celý front + smery, úžiny, situácie. Každá
 * nesie id, kind, región, rámovanie (center + rectDegrees) a odkaz na preset
 * (`scene`) pre správny prekladač názvu. Pure.
 * @returns {ReadonlyArray<object>}
 */
export function listConflicts() {
  const out = [];
  for (const scene of FRONT_SCENES) {
    out.push({ id: `ukraine:${scene.id}`, kind: 'ukraine-front', region: 'ukraine', sceneId: scene.id, name: scene.name, center: scene.center, rectDegrees: scene.rectDegrees, overview: Boolean(scene.overview), scene });
  }
  for (const scene of CHOKEPOINT_SCENES) {
    out.push({ id: `chokepoint:${scene.id}`, kind: 'chokepoint', region: 'maritime', sceneId: scene.id, name: scene.name, center: scene.center, rectDegrees: scene.rectDegrees, scene });
  }
  for (const c of SITUATION_CONFLICTS) {
    out.push({ id: c.id, kind: c.kind, region: c.region, sceneId: null, name: c.name, center: c.center, rectDegrees: c.rectDegrees, titleKey: c.titleKey, scene: null });
  }
  return out;
}

/** Konflikt podľa id (napr. `ukraine:lyman`, `chokepoint:hormuz`, `gulf`). Pure. */
export function conflictById(id) {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return listConflicts().find((c) => c.id === key) || null;
}

/** Konflikty v regióne (`ukraine` | `maritime` | `middle-east`). Pure. */
export function conflictsByRegion(region) {
  return listConflicts().filter((c) => c.region === region);
}

/** Rámovanie konfliktu (stred + obdĺžnik) pre kameru a prehľadovú mapku. Pure. */
export function conflictFraming(conflict) {
  if (!conflict) return null;
  return { center: conflict.center, rectDegrees: conflict.rectDegrees };
}

/** Preložený názov konfliktu podľa druhu (front/úžina/situácia). Pure. */
export function conflictTitle(conflict, translate = (k) => k) {
  if (!conflict) return '';
  if (conflict.kind === 'ukraine-front') return frontSceneLabel(conflict.scene, translate);
  if (conflict.kind === 'chokepoint') return chokepointSceneLabel(conflict.scene, translate);
  if (conflict.titleKey) { const tr = translate(conflict.titleKey); if (tr && tr !== conflict.titleKey) return tr; }
  return conflict.name;
}

/**
 * Model pre `drawKartaExport` z ktoréhokoľvek konfliktu: titulok (názov + „stav
 * k" + zdroje), legenda a prehľadová mapka (stred konfliktu + obdĺžnik pohľadu).
 * Živé fakty (dátum, zdroje, legenda, obdĺžnik) dodá volajúci z behu. Pure.
 */
export function buildConflictCardModel(conflict, { dateText = '', sources = [], legend = [], legendHead = '', viewRect = null, translate = (k) => k } = {}) {
  // Prehľadová mapka: Ukrajina má vlastný obrys (drawKartaExport ho má ako
  // predvolený), globálne konflikty dostanú obrys sveta s bodkou miesta.
  const inset = conflict && conflict.region !== 'ukraine'
    ? { rings: WORLD_OUTLINE_RINGS, bbox: WORLD_OUTLINE_BBOX }
    : null;
  return {
    title: {
      title: conflictTitle(conflict, translate),
      subtitle: dateText,
      sources: (Array.isArray(sources) ? sources : []).filter(Boolean).join(' · '),
    },
    legend: Array.isArray(legend) ? legend : [],
    legendHead,
    scene: conflict ? { center: conflict.center } : null,
    viewRect: viewRect || (conflict ? conflict.rectDegrees : null),
    inset,
  };
}
