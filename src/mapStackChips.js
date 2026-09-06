// MAP STACK source chips — the always-visible replacement for the `<select>`
// that used to sit in the Map Stack panel. One button per stack, rendered from
// `MapStackController.getStacks()`. The accepted sources below are the whole
// shipped set; keeping the allowlist explicit means a stack added to
// `MAP_STACKS` for internal use cannot reach the tray until someone names it
// here.
//
// OKO 2026-09-01: `ugkk-ortofoto` (SK Orto) sem PATRÍ — vrstva bola pridaná
// do MAP_STACKS vo Fáze 1, ale doplniť ju do tohto allowlistu sa zabudlo,
// takže podklad síce fungoval (WMS 200), ale používateľ sa k nemu nevedel
// preklikať. Presne to je cena explicitného allowlistu: nová položka nie je
// hotová, kým nie je aj tu.
//
// OKO 2026-09-03: `stadia-dark` je tu z toho istého dôvodu — tmavý podklad
// pridaný pre kontrast vzdušných kontaktov by bez zápisu nižšie ostal
// nedosiahnuteľný. Vložený ZA `osm` zámerne: testy tejto lišty indexujú
// deti kontajnera a vloženie pred OSM by ich posunulo bez úžitku.
//
// The chips are a control SURFACE only: selecting one calls back into the same
// `_setMapStack()` path the dropdown's `change` handler used, and the active
// state is re-synced from controller state (never optimistically), so a failed
// or superseded switch still leaves the truly-active stack lit.

import { t } from './i18n.js';

export const MAP_STACK_CHIP_CLASS = 'map-stack-chip';
export const MAP_STACK_VARIANT_CLASS = 'map-stack-chip--variant';

/**
 * Rodiny podkladov (2026-09-06, používateľ: „zjednotiť prepínače a dať pod
 * jedno NASA"). Tri NASA rastre — denná mozaika, Blue Marble, ASTER reliéf —
 * boli tri čipy v lište a lišta narástla na tri riadky. Rodina je JEDEN čip
 * v hlavnom rade; keď je aktívny jej člen, pod lištou sa objaví rad variantov.
 * Klik na čip rodiny zapne naposledy zvolený (alebo predvolený) variant —
 * pamätá sa v `_familyChoice` počas relácie.
 *
 * Členovia ostávajú plnohodnotné stacky v `PRESENTED_MAP_STACK_IDS` (tripwire
 * allowlistu platí ďalej); rodina mení len PREZENTÁCIU, nie controller.
 */
export const MAP_STACK_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'nasa',
    label: 'NASA',
    memberIds: Object.freeze(['gibs-truecolor', 'gibs-blue-marble', 'aster-relief']),
    defaultId: 'gibs-truecolor',
  }),
]);

/** @type {Map<string, string>} rodina → naposledy zvolený člen (relácia) */
const _familyChoice = new Map();

/** Test-only. */
export function _resetMapStackChipsForTest() { _familyChoice.clear(); }

/**
 * Rodina, do ktorej stack patrí, alebo null.
 * @param {string|null|undefined} stackId
 * @returns {object|null}
 */
export function mapStackFamilyOf(stackId) {
  if (!stackId) return null;
  return MAP_STACK_FAMILIES.find((family) => family.memberIds.includes(stackId)) || null;
}

/**
 * Zapamätaj si zvolený člen rodiny (volá sa pri každom sync so stavom
 * controllera — pamätá sa teda skutočne aktívny stack, nie klik).
 * @param {string|null|undefined} activeId
 */
export function rememberMapStackChoice(activeId) {
  const family = mapStackFamilyOf(activeId);
  if (family) _familyChoice.set(family.id, activeId);
}

/**
 * Ktorý člen sa zapne klikom na čip rodiny.
 * @param {object} family
 * @param {string|null} activeId
 * @returns {string}
 */
export function mapStackFamilyTarget(family, activeId) {
  if (family.memberIds.includes(activeId)) return activeId;
  return _familyChoice.get(family.id) || family.defaultId;
}
export const PRESENTED_MAP_STACK_IDS = Object.freeze([
  'photoreal',
  'bing-aerial',
  'bing-labels',
  'osm',
  'stadia-dark',
  'gibs-truecolor',
  'gibs-blue-marble',
  'aster-relief',
  'ugkk-ortofoto',
]);

/**
 * Poradie čipov v hlavnom rade: allowlist s rodinou zloženou do jedného
 * záznamu na pozícii jej PRVÉHO člena. Položka je buď id stacku (string),
 * alebo `{ family: id }`.
 * @type {ReadonlyArray<string|{family: string}>}
 */
export const PRESENTED_CHIP_ENTRIES = Object.freeze((() => {
  const entries = [];
  const seen = new Set();
  for (const id of PRESENTED_MAP_STACK_IDS) {
    const family = mapStackFamilyOf(id);
    if (!family) { entries.push(id); continue; }
    if (seen.has(family.id)) continue;
    seen.add(family.id);
    entries.push(Object.freeze({ family: family.id }));
  }
  return entries;
})());

/**
 * Model čipu rodiny: dostupný, ak je dostupný aspoň jeden člen; aktívny, ak
 * je aktívny ktorýkoľvek člen; `id` = člen, ktorý klik zapne.
 * @param {object} family
 * @param {Map<string, object>} stacksById
 * @param {string|null} activeId
 */
export function mapStackFamilyChipModel(family, stacksById, activeId) {
  const members = family.memberIds.map((id) => stacksById.get(id)).filter(Boolean);
  const available = members.some((stack) => stack?.available !== false);
  const active = family.memberIds.includes(activeId);
  const target = mapStackFamilyTarget(family, activeId);
  return {
    id: target,
    familyId: family.id,
    label: family.label,
    available,
    active,
    requiresIon: false,
    requirement: '',
    unavailableHint: available ? '' : t('mapstack.unavailable', { label: family.label }),
    title: available ? t('mapstack.family.nasa-title') : t('mapstack.unavailable', { label: family.label }),
  };
}

/**
 * Presentation model for one map-stack chip.
 *
 * Unavailable is NOT the same as needs-an-ion-token: `photoreal` is unavailable
 * whenever the Google tileset failed to load (the startup fallback-to-OSM
 * case), and a future stack may have its own reason. The ION badge is therefore
 * gated on the stack's own `requiresIon` flag, and the tooltip quotes the
 * controller's `unavailableReason` rather than assuming one.
 * @param {{id: string, label: string, available?: boolean, requiresIon?: boolean, unavailableReason?: string|null}} stack - Stack descriptor from `getStacks()`.
 * @param {string|null} activeId - Currently active stack id.
 * @returns {{id: string, label: string, available: boolean, active: boolean, requiresIon: boolean, requirement: string, unavailableHint: string, title: string}}
 */
export function mapStackChipModel(stack, activeId) {
  const available = stack?.available !== false;
  const label = String(stack?.label ?? stack?.id ?? '');
  const requiresIon = stack?.requiresIon === true;
  const fallbackReason = requiresIon
    ? t('mapstack.ion-required')
    : t('mapstack.unavailable', { label: label || t('mapstack.this-stack') });
  const unavailableHint = available ? '' : String(stack?.unavailableReason || fallbackReason);
  return {
    id: String(stack?.id ?? ''),
    label,
    available,
    active: !!stack?.id && stack.id === activeId,
    requiresIon,
    // Dropdown parity: unavailable options read "<label> · ion key". A chip has
    // no room for that, so an ion-backed stack gets a compact badge; every
    // unavailable chip carries the real reason in its tooltip.
    requirement: !available && requiresIon ? 'ION' : '',
    unavailableHint,
    // Fotoreál cez ion nesie poznámku o zdroji (controller `sourceNote`).
    title: available ? (stack?.sourceNote ? `${label} · ${stack.sourceNote}` : label) : unavailableHint,
  };
}

/**
 * @param {Array<object>} stacks - `MapStackController.getStacks()` output.
 * @param {string|null} activeId - Currently active stack id.
 * @returns {Array<object>} One chip model per approved presentation id, in
 *   `PRESENTED_MAP_STACK_IDS` order; internal and future stacks stay hidden.
 */
export function mapStackChipModels(stacks, activeId) {
  const stacksById = new Map((Array.isArray(stacks) ? stacks : [])
    .map((stack) => [stack?.id, stack]));
  return PRESENTED_CHIP_ENTRIES
    .map((entry) => {
      if (typeof entry === 'string') {
        const stack = stacksById.get(entry);
        return stack ? mapStackChipModel(stack, activeId) : null;
      }
      const family = MAP_STACK_FAMILIES.find((f) => f.id === entry.family);
      if (!family || !family.memberIds.some((id) => stacksById.has(id))) return null;
      return mapStackFamilyChipModel(family, stacksById, activeId);
    })
    .filter(Boolean);
}

/**
 * Modely radu variantov pre aktívnu rodinu (null, keď aktívny stack do
 * žiadnej rodiny nepatrí — rad sa vtedy skrýva).
 * @param {Array<object>} stacks
 * @param {string|null} activeId
 * @returns {Array<object>|null}
 */
export function mapStackVariantModels(stacks, activeId) {
  const family = mapStackFamilyOf(activeId);
  if (!family) return null;
  const stacksById = new Map((Array.isArray(stacks) ? stacks : []).map((stack) => [stack?.id, stack]));
  return family.memberIds
    .map((id) => stacksById.get(id))
    .filter(Boolean)
    .map((stack) => {
      const model = mapStackChipModel(stack, activeId);
      const key = `mapstack.variant.${stack.id}`;
      const localized = t(key);
      return { ...model, label: localized === key ? model.label : localized, title: model.available ? (localized === key ? model.label : localized) : model.unavailableHint };
    });
}

/**
 * Vykresli (alebo skry) rad variantov aktívnej rodiny. Volá sa pri každom
 * sync stavu — rad sleduje controller, nie klik.
 * @param {HTMLElement|null} container
 * @param {Array<object>} stacks
 * @param {string|null} activeId
 * @param {object} [options]
 * @returns {Array<object>} vykreslené modely (prázdne = skryté)
 */
export function renderMapStackVariants(container, stacks, activeId, { onSelect = null, doc } = {}) {
  if (!container) return [];
  const ownerDoc = doc || container.ownerDocument || globalThis.document;
  const models = mapStackVariantModels(stacks, activeId);
  container.innerHTML = '';
  if (!models || !ownerDoc?.createElement) {
    container.hidden = true;
    return [];
  }
  for (const model of models) {
    const chip = ownerDoc.createElement('button');
    chip.type = 'button';
    chip.className = [MAP_STACK_CHIP_CLASS, MAP_STACK_VARIANT_CLASS, model.active ? 'active' : '', model.available ? '' : 'unavailable']
      .filter(Boolean).join(' ');
    chip.dataset.stackId = model.id;
    chip.title = model.title;
    chip.setAttribute('aria-pressed', String(model.active));
    chip.setAttribute('aria-disabled', String(!model.available));
    const label = ownerDoc.createElement('span');
    label.className = 'map-stack-chip-label';
    label.textContent = model.label;
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      if (!model.available) return;
      onSelect?.(model.id);
    });
    container.appendChild(chip);
  }
  container.hidden = false;
  return models;
}

/**
 * Renders the chip row into `container`, replacing any previous chips.
 * @param {HTMLElement} container - Row element.
 * @param {Array<object>} stacks - `MapStackController.getStacks()` output.
 * @param {object} [options]
 * @param {string|null} [options.activeId] - Currently active stack id.
 * @param {(stackId: string) => void} [options.onSelect] - Selection callback.
 * @param {Document} [options.doc] - Document override (tests).
 * @returns {Array<object>} The rendered chip models.
 */
export function renderMapStackChips(container, stacks, { activeId = null, onSelect = null, doc } = {}) {
  if (!container) return [];
  const ownerDoc = doc || container.ownerDocument || globalThis.document;
  if (!ownerDoc?.createElement) return [];

  container.innerHTML = '';
  const models = mapStackChipModels(stacks, activeId);

  for (const model of models) {
    const chip = ownerDoc.createElement('button');
    chip.type = 'button';
    chip.className = [
      MAP_STACK_CHIP_CLASS,
      model.active ? 'active' : '',
      model.available ? '' : 'unavailable',
    ].filter(Boolean).join(' ');
    chip.dataset.stackId = model.id;
    if (model.familyId) chip.dataset.family = model.familyId;
    chip.title = model.title;
    chip.setAttribute('aria-pressed', String(model.active));
    chip.setAttribute('aria-disabled', String(!model.available));
    if (!model.available) {
      chip.setAttribute('aria-label', t('mapstack.unavailable-aria', {
        label: model.label,
        hint: model.unavailableHint,
      }));
    }

    const label = ownerDoc.createElement('span');
    label.className = 'map-stack-chip-label';
    label.textContent = model.label;
    chip.appendChild(label);

    if (model.requirement) {
      const requirement = ownerDoc.createElement('span');
      requirement.className = 'map-stack-chip-req';
      requirement.textContent = model.requirement;
      chip.appendChild(requirement);
    }

    chip.addEventListener('click', () => {
      if (!model.available) return;
      // Čip rodiny: cieľ sa číta z datasetu, ktorý sync prepisuje na
      // skutočne aktívneho člena — klik na zapnutú rodinu je no-op.
      onSelect?.(chip.dataset.stackId || model.id);
    });
    container.appendChild(chip);
  }

  return models;
}

/**
 * Re-points the active chip at controller state. Availability never changes at
 * runtime (it tracks the ion token), so only the active/pressed pair is synced.
 * @param {HTMLElement} container - Row element.
 * @param {string|null} activeId - Currently active stack id.
 * @returns {void}
 */
export function syncMapStackChips(container, activeId) {
  rememberMapStackChoice(activeId);
  const chips = container?.children;
  if (!chips) return;
  for (const chip of Array.from(chips)) {
    const familyId = chip?.dataset?.family;
    if (familyId) {
      const family = MAP_STACK_FAMILIES.find((f) => f.id === familyId);
      const active = !!family && family.memberIds.includes(activeId);
      if (family) chip.dataset.stackId = mapStackFamilyTarget(family, activeId);
      chip.classList?.toggle('active', active);
      chip.setAttribute?.('aria-pressed', String(active));
      continue;
    }
    const stackId = chip?.dataset?.stackId;
    if (!stackId) continue;
    const active = stackId === activeId;
    chip.classList?.toggle('active', active);
    chip.setAttribute?.('aria-pressed', String(active));
  }
}
