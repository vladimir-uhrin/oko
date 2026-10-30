// src/data/aircraftOwner.js
/**
 * @module aircraftOwner
 * @description Vlastník lietadla na karte (2026-10-29, vlastník: „firmy menom, súkromné osoby len ako
 * súkromný vlastník"). adsbdb posiela `registered_owner` z registrov — pri dopravcoch „Ryanair",
 * pri firmách „Nike Inc", pri malých strojoch „Private", v USA však aj celé meno človeka
 * („SMITH JOHN A"). Firma = organizácia podľa kódu dopravcu alebo právnej formy, inak súkromný.
 * Meno súkromného vlastníka z registra sa ukazuje tiež (2026-10-29, vlastník výslovne: „pri súkromných
 * lietadlách ukáž aj meno vlastníka, beriem to na seba") — výnimka z etickej čiary OKO na jeho
 * zodpovednosť. Zástupné „Private" z európskych registrov meno nie je.
 * 2026-10-30 (vlastník: „oprav všetko" po upozornení na GDPR): meno súkromnej osoby len pri registri MIMO EÚ/EHP
 * a Švajčiarska — pri európskom registri by meno človeka spolu so živou polohou na verejnom webe spadalo pod GDPR
 * (aj pri súkromnej prevádzke stránky); tam ostáva „súkromný vlastník" bez mena. Firmy menom všade.
 */

/** Krajiny EÚ, EHP a Švajčiarsko (ISO 3166-1 alpha-2) — tu sa meno súkromnej osoby neukazuje. */
export const GDPR_REGISTRY_COUNTRIES = Object.freeze(new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', // EÚ
  'IS', 'LI', 'NO', // EHP
  'CH', // Švajčiarsko (rovnocenná ochrana, nFADP)
]));

// Právne formy a slová, ktoré nesie len organizácia. Celé slová, bez ohľadu na veľkosť písmen.
const ORG_WORDS = [
  // právne formy
  's\\.?\\s?r\\.?\\s?o', 'spol', 'a\\.\\s?s', 'k\\.\\s?s', 'v\\.\\s?o\\.\\s?s', 'gmbh', 'ohg', 'e\\.\\s?v',
  'ltd', 'limited', 'llc', 'llp', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'plc',
  // krátke formy (SA, AB, AS…) len s bodkami alebo ako posledné slovo — inak by to boli iniciály („SMITH S A")
  's\\.\\s?a', 's\\.\\s?p\\.\\s?a', 's\\.\\s?r\\.\\s?l', 'srl', 'spa', 'sarl', 'sas', 'b\\.\\s?v', 'n\\.\\s?v', 'oyj',
  'asa', 'a/s', 'aps', 'sp\\.\\s?z\\s?o\\.\\s?o', 'kft', 'zrt', 'nyrt', 'd\\.\\s?o\\.\\s?o', 'pty',
  // druh organizácie
  'trust', 'trustee', 'bank', 'leasing', 'lease', 'capital', 'holding', 'holdings', 'group', 'services',
  'aviation', 'avia', 'aero', 'airlines', 'airline', 'airways', 'air', 'jet', 'jets', 'charter', 'flight', 'flying',
  'aeroklub', 'aeroclub', 'club', 'klub', 'society', 'association', 'foundation', 'university', 'school', 'academy',
  'police', 'polícia', 'polizei', 'army', 'navy', 'force', 'military', 'government', 'ministry', 'republic',
  'state', 'county', 'city', 'department', 'agency', 'rescue', 'ambulance', 'hospital', 'museum',
];
const ORG_RE = new RegExp(`(^|[^\\p{L}\\p{N}])(${ORG_WORDS.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');
// Dvojpísmenové právne formy len na konci názvu („Volvo AB", „Wells Fargo Trust Co NA").
const ORG_SUFFIX_RE = /\S.*\s(ab|as|ag|kg|oy|co|sa|bv|nv|lp|na)\.?$/i;
const PRIVATE_RE = /^(private|privat|privately owned|individual|owner|unknown|n\/a|-+)$/i;

/**
 * Hodnota z registra → čo smie ísť na kartu. Pure.
 * @param {string|null|undefined} owner `registered_owner` z adsbdb
 * @param {object} [opts]
 * @param {string|null} [opts.flagCode] `registered_owner_operator_flag_code` — trojpísmenový kód ICAO
 *   prevádzkovateľa znamená dopravcu; adsbdb tam pri súkromných strojoch dáva typ (SB91, G650)
 * @param {string|null} [opts.typeCode] ICAO typ stroja, aby sa typ v poli kódu nebral ako dopravca
 * @param {string|null} [opts.countryIso] štát registra (ISO alpha-2, `registered_owner_country_iso_name`)
 * @returns {{kind: 'company'|'private', name?: string}|null} null = register vlastníka neuvádza;
 *   súkromný bez `name`, keď register uvádza len „Private"
 */
export function classifyAircraftOwner(owner, { flagCode = null, typeCode = null, countryIso = null } = {}) {
  const name = typeof owner === 'string' ? owner.replace(/\s+/g, ' ').trim() : '';
  if (!name) return null;
  if (PRIVATE_RE.test(name)) return { kind: 'private' };
  const flag = typeof flagCode === 'string' ? flagCode.trim().toUpperCase() : '';
  const type = typeof typeCode === 'string' ? typeCode.trim().toUpperCase() : '';
  const airlineFlag = /^[A-Z]{3}$/.test(flag) && flag !== type;
  if (airlineFlag || ORG_RE.test(name) || ORG_SUFFIX_RE.test(name)) return { kind: 'company', name: name.slice(0, 80) };
  // Neznáma krajina registra = bez mena (pochybnosť → chrániť človeka).
  const iso = typeof countryIso === 'string' ? countryIso.trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(iso) || GDPR_REGISTRY_COUNTRIES.has(iso)) return { kind: 'private' };
  return { kind: 'private', name: name.slice(0, 80) };
}

/**
 * Text vlastníka do riadku karty (alebo '' keď nemá čo dodať). Pure.
 * Firma sa vynechá, keď je to ten istý názov, aký karta už ukazuje ako dopravcu (Ryanair · Ryanair).
 * @param {{kind: string, name?: string}|null|undefined} owner výsledok classifyAircraftOwner
 * @param {string|null|undefined} shownAirline dopravca/prevádzkovateľ, ktorý už je v riadku
 * @param {(key: string, vars?: object) => string} translate
 */
export function aircraftOwnerLabel(owner, shownAirline, translate) {
  if (owner?.kind === 'private') return owner.name ? translate('card.owner-private-named', { name: owner.name }) : translate('card.owner-private');
  if (owner?.kind !== 'company' || !owner.name) return '';
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const shown = norm(shownAirline);
  const name = norm(owner.name);
  if (shown && (name.includes(shown) || shown.includes(name))) return '';
  return translate('card.owner', { name: owner.name });
}

/**
 * Záznam karty pri výdaji (2026-10-30): cache servera drží vlastníka vyhodnoteného ešte pred obmedzením na registre
 * mimo EÚ/EHP — meno súkromnej osoby z európskeho (alebo neznámeho) registra sa odstráni aj zo starých záznamov. Pure.
 * @param {object|null} data záznam lietadla (countryIso, owner)
 */
export function sanitizeAircraftOwner(data) {
  const owner = data?.owner;
  if (!owner || owner.kind !== 'private' || !owner.name) return data;
  const iso = typeof data.countryIso === 'string' ? data.countryIso.trim().toUpperCase() : '';
  if (/^[A-Z]{2}$/.test(iso) && !GDPR_REGISTRY_COUNTRIES.has(iso)) return data;
  return { ...data, owner: { kind: 'private' } };
}
