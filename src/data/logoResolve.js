// src/data/logoResolve.js
/**
 * @module logoResolve
 * @description Čisté pomôcky pre logá aerolínií a výrobcov lietadiel na karte
 * (2026-09-12, používateľ: „aj logá spoločnosti a výrobcu lietadiel" → voľba
 * „Wikimedia Commons cez cachovanú proxy"). Zdrojom je infobox anglickej
 * Wikipédie (`| logo = Súbor.svg`) a Wikimedia Commons ako úložisko súboru:
 * berieme LEN súbory hostované na Commons (imagerepository `shared`) so
 * slobodnou licenciou (public domain / CC0 / CC BY / CC BY-SA) — lokálne
 * „fair use" logá z en.wikipedia sa vynechajú, karta ostane bez loga.
 * Ochranná známka: logo sa ukazuje výhradne na označenie dopravcu/výrobcu
 * konkrétneho stroja (nominatívne použitie), nikdy ako značka OKO.
 * Bez DOM, bez siete — proxy aj klient tieto funkcie len skladajú.
 */

/** Výrobcovia → titul stránky na en.wikipedia (prvé slovo/á typu z adsdb/OpenSky). */
export const MANUFACTURER_TITLES = Object.freeze({
  airbus: 'Airbus',
  'airbus helicopters': 'Airbus Helicopters',
  eurocopter: 'Airbus Helicopters',
  boeing: 'Boeing',
  mcdonnell: 'McDonnell Douglas',
  embraer: 'Embraer',
  atr: 'ATR (aircraft manufacturer)',
  bombardier: 'Bombardier Aviation',
  canadair: 'Canadair',
  'de havilland': 'De Havilland Canada',
  dehavilland: 'De Havilland Canada',
  cessna: 'Cessna',
  beechcraft: 'Beechcraft',
  beech: 'Beechcraft',
  textron: 'Textron Aviation',
  dassault: 'Dassault Aviation',
  gulfstream: 'Gulfstream Aerospace',
  learjet: 'Learjet',
  pilatus: 'Pilatus Aircraft',
  diamond: 'Diamond Aircraft Industries',
  cirrus: 'Cirrus Aircraft',
  piper: 'Piper Aircraft',
  mooney: 'Mooney International Corporation',
  antonov: 'Antonov',
  tupolev: 'Tupolev',
  ilyushin: 'Ilyushin',
  sukhoi: 'Sukhoi',
  yakovlev: 'Yakovlev',
  comac: 'Comac',
  mitsubishi: 'Mitsubishi Heavy Industries',
  saab: 'Saab AB',
  fokker: 'Fokker',
  robinson: 'Robinson Helicopter Company',
  bell: 'Bell Textron',
  sikorsky: 'Sikorsky Aircraft',
  leonardo: 'Leonardo S.p.A.',
  agustawestland: 'AgustaWestland',
  lockheed: 'Lockheed Martin',
  honda: 'Honda Aircraft Company',
  hawker: 'Hawker Beechcraft',
  britten: 'Britten-Norman',
  'let': 'Let Kunovice',
  aero: 'Aero Vodochody',
  zlin: 'Zlín Aircraft',
  tecnam: 'Tecnam',
  socata: 'Daher',
  daher: 'Daher',
  dornier: 'Dornier Flugzeugwerke',
  evektor: 'Evektor',
});

/**
 * Výrobca z reťazca typu („Airbus A319 132", „BOEING 767-300", „De Havilland
 * DHC-8-400"): prvé jedno alebo dve slová proti tabuľke. Pure.
 * @param {string} typeName
 * @returns {?{key: string, title: string}}
 */
export function manufacturerFromType(typeName) {
  const words = String(typeName || '').trim().toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const two = words.slice(0, 2).join(' ');
  if (MANUFACTURER_TITLES[two]) return { key: two, title: MANUFACTURER_TITLES[two] };
  const one = words[0];
  if (MANUFACTURER_TITLES[one]) return { key: one, title: MANUFACTURER_TITLES[one] };
  return null;
}

/** Normalizované meno pre kľúč cache: malé písmená, jedna medzera. Pure. */
export function normalizeLogoName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Titulkový tvar pre dopyt na Wikipédiu („UNITED PARCEL SERVICE CO" → „United Parcel Service Co"). Pure. */
export function titleCase(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase() && /^[A-Z]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Kandidátske tituly stránok pre aerolíniu: presné meno, „(airline)",
 * „Airlines" varianty. Pure.
 * @param {string} name
 * @returns {string[]}
 */
export function airlineTitleCandidates(name) {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return [];
  const base = raw === raw.toUpperCase() ? titleCase(raw) : raw;
  const out = [base, `${base} (airline)`];
  if (!/airline|airways|air\b/i.test(base)) out.push(`${base} Airlines`);
  return [...new Set(out)];
}

/**
 * Súbor loga z wikitextu infoboxu: `| logo = [[File:X.svg|200px]]`,
 * `| logo = File:X.svg`, `| logo = X.svg`, aj `image_logo`/`logo_image`.
 * Vracia holé meno súboru bez prefixu, alebo null. Pure.
 * @param {string} wikitext
 */
export function infoboxLogoFile(wikitext) {
  const text = String(wikitext || '');
  const m = /\|\s*(?:logo|image_logo|logo_image|company_logo)\s*=\s*([^\n]*)/i.exec(text);
  if (!m) return null;
  let value = m[1].trim();
  const link = /\[\[\s*(?:File|Image)\s*:\s*([^\]|]+)/i.exec(value);
  // `Airbus Logo 2017.svg{{!}}class=skin-invert` (Airbus, Boeing 2026-09-12):
  // za názvom súboru idú parametre cez šablónu {{!}} — meno je pred nimi.
  if (link) value = link[1]; else value = value.split('{{')[0].split('|')[0].split('}}')[0];
  value = value.replace(/^(?:File|Image)\s*:\s*/i, '').trim();
  if (!/\.(svg|png|jpe?g|gif|webp)$/i.test(value)) return null;
  return value.replace(/_/g, ' ');
}

/**
 * Slobodná licencia podľa `LicenseShortName` z Commons (extmetadata):
 * Public domain, CC0, CC BY x.y, CC BY-SA x.y (aj s pomlčkami). Pure.
 * @param {string} licenseShortName
 */
export function acceptableLogoLicense(licenseShortName) {
  const s = String(licenseShortName || '').trim().toLowerCase();
  if (!s) return false;
  if (/^public domain/.test(s) || /^pd\b/.test(s) || /^cc0/.test(s)) return true;
  if (/^cc[ -]by([ -]sa)?([ -]\d(\.\d)?)?$/.test(s)) return true;
  if (/^cc[ -]by([ -]sa)?[ -]\d/.test(s)) return true;
  return false;
}

/** Odstráni HTML značky a zbalí medzery (Artist z extmetadata je HTML). Pure. */
export function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Popis pre kredit: „Logo: Wikimedia Commons · CC BY-SA 4.0 · Autor" —
 * pri public domain/CC0 bez autora. Pure.
 * @param {{license?: string, author?: string}} meta
 */
export function logoCreditLine(meta) {
  const license = String(meta?.license || '').trim();
  const author = stripHtml(meta?.author);
  const parts = ['Wikimedia Commons', license];
  if (author && !/^(public domain|pd\b|cc0)/i.test(license)) parts.push(author.slice(0, 40));
  return parts.filter(Boolean).join(' · ');
}
