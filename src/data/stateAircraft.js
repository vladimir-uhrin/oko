// src/data/stateAircraft.js — štátne lietadlá (2026-09-30, vlastník: „lietadlá špeciálne slovenskej
// vlády, aby sa ich aj spätne dalo trackovať"; najprv vláda, neskôr aj Vzdušné sily, polícia, záchranári).
//
// Zoznam je ručne overený (local_data/state-aircraft/, každý stroj so zdrojmi a dátumom overenia) —
// nič sa nedopĺňa odhadom. Pure: bez DOM a bez fs, používa ho server (záznam, spätný import, API)
// aj kartička lietadla v prehliadači.
//
// Etická čiara: sledujeme štátne STROJE z verejného vysielania ADS-B — nie osoby. Nikde sa neuvádza,
// kto je na palube, a lety sa neprepájajú s programom ľudí.

/** Úlohy v zozname; `government` = vládna/VIP preprava. */
export const STATE_ROLES = Object.freeze(['government', 'military', 'police', 'rescue']);

const HEX = /^[0-9a-f]{6}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
}

function bilingual(value) {
  if (typeof value === 'string') return text(value) ? { sk: value.trim(), en: value.trim() } : null;
  if (!value || typeof value !== 'object') return null;
  const sk = text(value.sk);
  const en = text(value.en);
  return sk || en ? { sk: sk || en, en: en || sk } : null;
}

/**
 * Zoznam zo súboru → overené záznamy. Záznam bez platného hexu, úlohy alebo zdroja sa vynechá. Pure.
 * @returns {{country: string|null, updated: string|null, aircraft: object[], byHex: Map<string, object>}}
 */
export function parseStateAircraftList(json) {
  const aircraft = [];
  const byHex = new Map();
  for (const raw of Array.isArray(json?.aircraft) ? json.aircraft : []) {
    const hex = String(raw?.hex ?? '').trim().toLowerCase();
    const sources = (Array.isArray(raw?.sources) ? raw.sources : []).filter((s) => typeof s === 'string' && /^https?:\/\//.test(s));
    if (!HEX.test(hex) || !STATE_ROLES.includes(raw?.role) || !sources.length || byHex.has(hex)) continue;
    const entry = {
      hex,
      reg: text(raw.reg),
      typeCode: text(raw.typeCode),
      typeName: text(raw.typeName),
      operator: bilingual(raw.operator),
      role: raw.role,
      country: text(json.country),
      since: DAY.test(String(raw.since)) ? raw.since : null,
      until: DAY.test(String(raw.until)) ? raw.until : null,
      sources,
      verified: DAY.test(String(raw.verified)) ? raw.verified : null,
    };
    aircraft.push(entry);
    byHex.set(hex, entry);
  }
  return { country: text(json?.country), updated: DAY.test(String(json?.updated)) ? json.updated : null, aircraft, byHex };
}

/** Záznam štátneho stroja pre hex (ľubovoľná veľkosť písmen), inak null. Pure. */
export function stateAircraftFor(list, hex) {
  if (!list?.byHex) return null;
  return list.byHex.get(String(hex ?? '').trim().toLowerCase()) ?? null;
}

/** Hexy, ktoré treba sledovať a spätne doťahovať (voliteľne len jedna úloha). Pure. */
export function stateAircraftHexes(list, { role = null } = {}) {
  return (list?.aircraft ?? []).filter((a) => !role || a.role === role).map((a) => a.hex);
}

const ROLE_LABEL = {
  government: { sk: 'Vládne lietadlo', en: 'Government aircraft' },
  military: { sk: 'Vojenské lietadlo', en: 'Military aircraft' },
  police: { sk: 'Policajné lietadlo', en: 'Police aircraft' },
  rescue: { sk: 'Záchranné lietadlo', en: 'Rescue aircraft' },
};

const COUNTRY_LABEL = { SK: { sk: 'SR', en: 'Slovakia' } };

/** Krátky štítok do kartičky: „Vládne lietadlo SR" / „Government aircraft · Slovakia". Pure. */
export function stateAircraftLabel(entry, lang = 'sk') {
  if (!entry) return '';
  const l = lang === 'en' ? 'en' : 'sk';
  const role = ROLE_LABEL[entry.role]?.[l] ?? '';
  const country = entry.country ? (COUNTRY_LABEL[entry.country]?.[l] ?? entry.country) : '';
  if (!country) return role;
  return l === 'en' ? `${role} · ${country}` : `${role} ${country}`;
}
