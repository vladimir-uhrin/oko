// src/shareSubject.js
// Predmet zdieľania (2026-09-14, používateľ: „pri zdieľaní hocijakej časti
// systému sa musí objaviť presne to, čo zdieľam"): odkaz nesie aj TO, na čo sa
// odosielateľ pozerá — sledované lietadlo alebo satelit, vybranú loď či stanicu
// plynu — nielen kameru, štýl a vrstvy. Hash parameter
// `subj=<vrstva>.<druh>.<id>`, druh `t` = sledovaný (trackById), `s` = vybraný
// (selectById). Príjemca ho obnoví po načítaní vrstvy; živé objekty prídu až
// s prvým pollom, preto obnovu opakuje ui.js (`_restoreShareSubject`).
//
// Id v odkaze je API id vrstvy (icao24, NORAD, MMSI, kľúč stanice), nie id
// kontextového záznamu — tie majú predpony (`ais-…`, `gas-flows:…`).

export const SHARE_SUBJECT_PARAM = 'subj';
export const SHARE_SUBJECT_KINDS = Object.freeze({ t: 'tracked', s: 'selected' });
const KIND_TOKEN = Object.freeze({ tracked: 't', selected: 's' });
const LAYER_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const SUBJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,63}$/;
/** Sledovacie vrstvy: predmet = sledovaný stroj; skúšajú sa v tomto poradí. */
export const TRACKED_SUBJECT_LAYERS = Object.freeze(['flights', 'military', 'satellites']);
/** Opakovanie obnovy u príjemcu: interval a strop (ms). */
export const SUBJECT_RESTORE_RETRY_MS = 1500;
export const SUBJECT_RESTORE_DEADLINE_MS = 30_000;

/**
 * `{layerId, kind, id}` → `vrstva.druh.id`; null pre neplatný predmet. Pure.
 * @param {{ layerId?: string, kind?: 'tracked'|'selected', id?: string|number }|null} subject
 * @returns {string|null}
 */
export function encodeShareSubject(subject) {
  if (!subject) return null;
  const kind = KIND_TOKEN[subject.kind];
  const layerId = String(subject.layerId || '');
  const id = String(subject.id ?? '');
  if (!kind || !LAYER_ID_RE.test(layerId) || !SUBJECT_ID_RE.test(id)) return null;
  return `${layerId}.${kind}.${id}`;
}

/**
 * `vrstva.druh.id` → `{layerId, kind, id}`; id smie obsahovať bodky (delí sa
 * len na prvých dvoch). Null pre čokoľvek nevalidné. Pure.
 * @param {string|null|undefined} value
 * @returns {{ layerId: string, kind: 'tracked'|'selected', id: string }|null}
 */
export function decodeShareSubject(value) {
  if (typeof value !== 'string' || !value) return null;
  const first = value.indexOf('.');
  const second = value.indexOf('.', first + 1);
  if (first <= 0 || second <= first + 1) return null;
  const layerId = value.slice(0, first);
  const kind = SHARE_SUBJECT_KINDS[value.slice(first + 1, second)];
  const id = value.slice(second + 1);
  if (!kind || !LAYER_ID_RE.test(layerId) || !SUBJECT_ID_RE.test(id)) return null;
  return { layerId, kind, id };
}

/**
 * API id vrstvy z id kontextového záznamu: `ais-244660815` → `244660815`,
 * `gas-flows:kapusany` → `kapusany`, inak nezmenené. Pure.
 * @param {string} layerId
 * @param {string|number|null|undefined} contextId
 * @returns {string|null}
 */
export function subjectIdFromContextId(layerId, contextId) {
  const raw = String(contextId ?? '');
  if (!raw) return null;
  if (layerId === 'ais-live-vessels') return raw.replace(/^ais-/, '');
  const prefix = `${layerId}:`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

/**
 * Čo práve zdieľam. Sledovaný stroj (lietadlo, vojenský stroj, satelit) má
 * prednosť pred vybraným objektom (loď, stanica plynu, zemetrasenie).
 * @param {{ dataManager?: object|null, selectedContext?: {layerId?: string, id?: string}|null }} input
 * @returns {{ layerId: string, kind: 'tracked'|'selected', id: string }|null}
 */
export function readShareSubject({ dataManager = null, selectedContext = null } = {}) {
  for (const layerId of TRACKED_SUBJECT_LAYERS) {
    if (typeof dataManager?.isEnabled === 'function' && !dataManager.isEnabled(layerId)) continue;
    const module = dataManager?.layers?.get?.(layerId)?.module;
    if (!module) continue;
    let id = null;
    try {
      id = module.getTrackedSubject?.()?.id
        ?? module.getTrackedInfo?.()?.icao24
        ?? module.getTrackedInfo?.()?.noradId
        ?? null;
    } catch { id = null; }
    if (id != null && String(id) !== '' && SUBJECT_ID_RE.test(String(id))) {
      return { layerId, kind: 'tracked', id: String(id) };
    }
  }
  const layerId = String(selectedContext?.layerId || '');
  if (layerId && selectedContext?.id != null) {
    const id = subjectIdFromContextId(layerId, selectedContext.id);
    if (id && LAYER_ID_RE.test(layerId) && SUBJECT_ID_RE.test(id)) return { layerId, kind: 'selected', id };
  }
  return null;
}

/**
 * Obnov predmet u príjemcu. Vypnutú vrstvu zapne (odosielateľ ju mal zapnutú,
 * inak by predmet v odkaze nebol).
 * @param {{ dataManager?: object|null, subject?: {layerId: string, kind: string, id: string}|null }} input
 * @returns {Promise<'applied'|'pending'|'unknown-layer'|'unsupported'>}
 *   `pending` = vrstva objekt ešte nemá (živý poll) — volajúci skúsi znova.
 */
export async function applyShareSubject({ dataManager = null, subject = null } = {}) {
  if (!subject || typeof dataManager?.layers?.get !== 'function') return 'unsupported';
  const module = dataManager.layers.get(subject.layerId)?.module;
  if (!module) return 'unknown-layer';
  if (typeof dataManager.isEnabled === 'function'
    && !dataManager.isEnabled(subject.layerId)
    && typeof dataManager.setEnabled === 'function') {
    try { await dataManager.setEnabled(subject.layerId, true, { origin: 'share' }); } catch { /* vrstva ostane vypnutá — ďalší pokus */ }
  }
  const method = subject.kind === 'tracked' ? module.trackById : module.selectById;
  if (typeof method !== 'function') return 'unsupported';
  let applied = false;
  try {
    applied = subject.kind === 'tracked'
      ? Boolean(method.call(module, subject.id, { origin: 'share' }))
      : Boolean(method.call(module, subject.id));
  } catch { applied = false; }
  return applied ? 'applied' : 'pending';
}
