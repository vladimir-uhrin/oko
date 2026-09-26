// src/data/gulfIncidents.js
/**
 * @module gulfIncidents
 * @description Phase B pilot (2026-09-18): turn open-source news items (from
 * situationNews.js / GDELT) into GEOLOCATED incident markers for the globe.
 * Classification is keyword-based on the HEADLINE, geolocation is a bundled
 * Gulf-region gazetteer (no external geocoder). GDELT's GEO endpoint 404s, so we
 * place a marker at the first gazetteer place named in the headline, else at the
 * region's default point.
 *
 * POCTIVOSŤ (rules 2 & 6 CLAUDE.md): a marker is a REPORTED, UNVERIFIED event
 * from open journalism, placed by the place NAMED in the headline (approximate),
 * and it LINKS OUT to the source. This models events/vessels/infrastructure, not
 * people — no faces, no individual tracking, no targeting. The client labels
 * every marker "reported · unverified" and never presents it as intelligence.
 * Pure module (no DOM).
 */

import { UKRAINE_GAZETTEER, UKRAINE_OBLASTS_EN, classifyUkraineIncident } from './ukraineIncidents.js';

/**
 * Incident classes, in priority order. severity → marker colour on the client.
 * `context` (etapa 3 BLÍZKEHO VÝCHODU, 2026-09-26): generic words („blocked",
 * „closed", „shut") count as a blockade only next to a route, port or border —
 * „CNN blocked from trip" or „SIM cards blocked" are not a blockade; the word
 * „blockade" itself always is. Plurals count too („Israeli strikes kill…",
 * „Iran fires missiles…" — dovtedy ich pravidlo nepoznalo).
 */
const INCIDENT_RULES = [
  { type: 'strike', severity: 'critical', re: /\b(missiles?|drones?|strikes?|airstrikes?|struck|attacks?|attacked|shelling|shelled|torpedo(?:es|ed)?|projectiles?|rockets?|bombing|bombed)\b/i },
  { type: 'fire', severity: 'critical', re: /\b(explosions?|explode[sd]?|blasts?|ablaze|on fire|caught fire|burning)\b/i },
  { type: 'seizure', severity: 'major', re: /\b(seiz(?:e|ed|ure)|detain(?:ed)?|boarded|captur(?:e|ed)|hijack(?:ed)?|impound(?:ed)?)\b/i },
  { type: 'blockade', severity: 'major', re: /\b(blockad(?:e|ed))\b/i },
  {
    type: 'blockade', severity: 'major',
    re: /\b(blocked|shut|closed|closes|closing|mine[sd]?|mined|threat(?:en|ens|ened)? to close)\b/i,
    context: /\b(straits?|ports?|canal|shipping|ships?|vessels?|tankers?|crossings?|border|airspace|airports?|routes?|lanes?|waters|gulf|sea|hormuz|mandeb|terminals?|pipelines?)\b/i,
  },
];
/**
 * Pred triedením sa vymaže, čo nie je dnešná udalosť: nevojenské „strike" (štrajk,
 * dohoda — „India's bank strike", „US and Iran strike deal") a výročný odkaz na útok
 * 7. októbra 2023 („Netanyahu says October 7 attack…" — retrospektívy nie sú karta).
 */
const NON_MILITARY_STRIKE_RE = /\b(?:hunger|general|labou?r|bank|workers'?|teachers'?|doctors'?|nurses'?|nationwide|rail|transport|dockers'?)\s+strikes?\b|\b(?:strikes?|struck|striking)\s+(?:a\s+)?(?:deal|agreement|balance|chord|pact|tone|note|compromise)\b|\b(?:oct(?:ober)?\.?\s*7(?:th)?|7(?:th)?\s+oct(?:ober)?\.?)(?:\s+(?:hamas|hamas-led))?\s+(?:attacks?|massacres?|assault|raid)\b/gi;

/**
 * Bundled Gulf / Middle East gazetteer (place → coords). `aliases` are lowercase
 * words matched against the headline (whole words — see locateIncident).
 * `kind` sets the precedence tier: a named place (default) beats an `area` or a
 * `sea`, which beat a `country`; `broad: true` marks a point that stands for a
 * large area (a country or a wide sea) — a match there is flagged approximate.
 * BLÍZKY VÝCHOD etapa 3 (2026-09-26) added the places of each theatre
 * (Libanon, Gaza, Západný breh, Izrael, Jemen, Sýria, Irak, Irán).
 */
export const GULF_GAZETTEER = Object.freeze([
  Object.freeze({ name: 'Bandar Abbas', lat: 27.18, lon: 56.28, aliases: ['bandar abbas'] }),
  Object.freeze({ name: 'Fujairah', lat: 25.29, lon: 56.33, aliases: ['fujairah', 'fujeirah'] }),
  Object.freeze({ name: 'Khor Fakkan', lat: 25.34, lon: 56.35, aliases: ['khor fakkan'] }),
  Object.freeze({ name: 'Kharg Island', lat: 29.23, lon: 50.32, aliases: ['kharg'] }),
  Object.freeze({ name: 'Bushehr', lat: 28.92, lon: 50.84, aliases: ['bushehr', 'bushire'] }),
  Object.freeze({ name: 'Ras Tanura', lat: 26.7, lon: 50.16, aliases: ['ras tanura'] }),
  Object.freeze({ name: 'Jebel Ali', lat: 25.01, lon: 55.06, aliases: ['jebel ali'] }),
  Object.freeze({ name: 'Ras al-Khaimah', lat: 25.79, lon: 55.94, aliases: ['ras al-khaimah', 'ras al khaimah'] }),
  Object.freeze({ name: 'Dubai', lat: 25.2, lon: 55.27, aliases: ['dubai'] }),
  Object.freeze({ name: 'Abu Dhabi', lat: 24.47, lon: 54.37, aliases: ['abu dhabi'] }),
  Object.freeze({ name: 'Sharjah', lat: 25.35, lon: 55.4, aliases: ['sharjah'] }),
  Object.freeze({ name: 'Dammam', lat: 26.43, lon: 50.1, aliases: ['dammam'] }),
  Object.freeze({ name: 'Basra', lat: 30.5, lon: 47.8, aliases: ['basra', 'basrah'] }),
  Object.freeze({ name: 'Kuwait', lat: 29.37, lon: 47.98, aliases: ['kuwait'] }),
  Object.freeze({ name: 'Doha', lat: 25.29, lon: 51.53, aliases: ['doha', 'qatar'] }),
  Object.freeze({ name: 'Manama', lat: 26.23, lon: 50.58, aliases: ['manama', 'bahrain'] }),
  Object.freeze({ name: 'Muscat', lat: 23.6, lon: 58.55, aliases: ['muscat'] }),
  // Wider Middle East conflict (2026-09-18) — Red Sea / Yemen / Horn, Suez, Levant, Iran/Iraq.
  Object.freeze({ name: 'Aden', lat: 12.79, lon: 45.03, aliases: ['aden'] }),
  Object.freeze({ name: 'Hodeidah', lat: 14.8, lon: 42.95, aliases: ['hodeidah', 'hudaydah', 'al hudaydah'] }),
  Object.freeze({ name: 'Mokha', lat: 13.32, lon: 43.25, aliases: ['mokha', 'mocha'] }),
  Object.freeze({ name: "Sana'a", lat: 15.35, lon: 44.2, aliases: ['sanaa', "sana'a"] }),
  Object.freeze({ name: 'Djibouti', lat: 11.6, lon: 43.15, aliases: ['djibouti'] }),
  Object.freeze({ name: 'Port Said', lat: 31.26, lon: 32.3, aliases: ['port said'] }),
  Object.freeze({ name: 'Ismailia', lat: 30.59, lon: 32.27, aliases: ['ismailia'] }),
  Object.freeze({ name: 'Suez', lat: 29.97, lon: 32.55, aliases: ['suez canal', 'suez'] }),
  Object.freeze({ name: 'Eilat', lat: 29.56, lon: 34.95, aliases: ['eilat'] }),
  Object.freeze({ name: 'Gaza City', lat: 31.52, lon: 34.45, aliases: ['gaza city'] }),
  Object.freeze({ name: 'Ashkelon', lat: 31.67, lon: 34.57, aliases: ['ashkelon'] }),
  Object.freeze({ name: 'Tel Aviv', lat: 32.08, lon: 34.78, aliases: ['tel aviv'] }),
  Object.freeze({ name: 'Haifa', lat: 32.82, lon: 34.99, aliases: ['haifa'] }),
  Object.freeze({ name: 'Jerusalem', lat: 31.78, lon: 35.22, aliases: ['jerusalem'] }),
  Object.freeze({ name: 'Beirut', lat: 33.89, lon: 35.5, aliases: ['beirut'] }),
  Object.freeze({ name: 'Damascus', lat: 33.51, lon: 36.29, aliases: ['damascus'] }),
  Object.freeze({ name: 'Tehran', lat: 35.69, lon: 51.39, aliases: ['tehran'] }),
  Object.freeze({ name: 'Isfahan', lat: 32.65, lon: 51.67, aliases: ['isfahan', 'esfahan'] }),
  Object.freeze({ name: 'Natanz', lat: 33.72, lon: 51.9, aliases: ['natanz'] }),
  Object.freeze({ name: 'Baghdad', lat: 33.31, lon: 44.36, aliases: ['baghdad'] }),
  // BLÍZKY VÝCHOD po dejiskách (etapa 3, 2026-09-26). Libanon:
  Object.freeze({ name: 'Dahieh', lat: 33.85, lon: 35.51, aliases: ['dahieh', 'dahiyeh'] }),
  Object.freeze({ name: 'Tyre', lat: 33.27, lon: 35.2, aliases: ['tyre'] }),
  Object.freeze({ name: 'Sidon', lat: 33.56, lon: 35.37, aliases: ['sidon', 'saida'] }),
  Object.freeze({ name: 'Nabatieh', lat: 33.38, lon: 35.48, aliases: ['nabatieh', 'nabatiyeh', 'nabatiye'] }),
  Object.freeze({ name: 'Bint Jbeil', lat: 33.12, lon: 35.43, aliases: ['bint jbeil'] }),
  Object.freeze({ name: 'Khiam', lat: 33.33, lon: 35.61, aliases: ['khiam'] }),
  Object.freeze({ name: 'Marjayoun', lat: 33.36, lon: 35.59, aliases: ['marjayoun'] }),
  Object.freeze({ name: 'Naqoura', lat: 33.12, lon: 35.14, aliases: ['naqoura'] }),
  Object.freeze({ name: 'Baalbek', lat: 34.01, lon: 36.21, aliases: ['baalbek'] }),
  // Gaza a Západný breh:
  Object.freeze({ name: 'Rafah', lat: 31.29, lon: 34.25, aliases: ['rafah'] }),
  Object.freeze({ name: 'Khan Younis', lat: 31.35, lon: 34.3, aliases: ['khan younis', 'khan yunis'] }),
  Object.freeze({ name: 'Deir al-Balah', lat: 31.42, lon: 34.35, aliases: ['deir al-balah', 'deir el-balah'] }),
  Object.freeze({ name: 'Jabalia', lat: 31.53, lon: 34.48, aliases: ['jabalia', 'jabaliya'] }),
  Object.freeze({ name: 'Beit Lahia', lat: 31.55, lon: 34.5, aliases: ['beit lahia', 'beit lahiya'] }),
  Object.freeze({ name: 'Beit Hanoun', lat: 31.54, lon: 34.54, aliases: ['beit hanoun'] }),
  Object.freeze({ name: 'Jenin', lat: 32.46, lon: 35.3, aliases: ['jenin'] }),
  Object.freeze({ name: 'Nablus', lat: 32.22, lon: 35.26, aliases: ['nablus'] }),
  Object.freeze({ name: 'Tulkarm', lat: 32.31, lon: 35.03, aliases: ['tulkarm', 'tulkarem'] }),
  Object.freeze({ name: 'Tubas', lat: 32.32, lon: 35.37, aliases: ['tubas'] }),
  Object.freeze({ name: 'Qalqilya', lat: 32.19, lon: 34.97, aliases: ['qalqilya', 'qalqiliya'] }),
  Object.freeze({ name: 'Ramallah', lat: 31.9, lon: 35.2, aliases: ['ramallah'] }),
  Object.freeze({ name: 'Bethlehem', lat: 31.7, lon: 35.2, aliases: ['bethlehem'] }),
  Object.freeze({ name: 'Hebron', lat: 31.53, lon: 35.1, aliases: ['hebron'] }),
  Object.freeze({ name: 'Jericho', lat: 31.86, lon: 35.46, aliases: ['jericho'] }),
  // Izrael:
  Object.freeze({ name: 'Ashdod', lat: 31.8, lon: 34.65, aliases: ['ashdod'] }),
  Object.freeze({ name: 'Sderot', lat: 31.52, lon: 34.6, aliases: ['sderot'] }),
  Object.freeze({ name: 'Beersheba', lat: 31.25, lon: 34.79, aliases: ['beersheba', "be'er sheva", 'beer sheva'] }),
  Object.freeze({ name: 'Dimona', lat: 31.07, lon: 35.03, aliases: ['dimona'] }),
  Object.freeze({ name: 'Nevatim', lat: 31.21, lon: 35.01, aliases: ['nevatim'] }),
  Object.freeze({ name: 'Kiryat Shmona', lat: 33.21, lon: 35.57, aliases: ['kiryat shmona'] }),
  Object.freeze({ name: 'Metula', lat: 33.28, lon: 35.58, aliases: ['metula'] }),
  Object.freeze({ name: 'Nahariya', lat: 33.01, lon: 35.1, aliases: ['nahariya'] }),
  Object.freeze({ name: 'Safed', lat: 32.96, lon: 35.5, aliases: ['safed', 'tzfat'] }),
  // Jemen a Saudská Arábia (údery na infraštruktúru):
  Object.freeze({ name: 'Ras Isa', lat: 15.12, lon: 42.83, aliases: ['ras isa'] }),
  Object.freeze({ name: 'Marib', lat: 15.46, lon: 45.32, aliases: ['marib'] }),
  Object.freeze({ name: 'Taiz', lat: 13.58, lon: 44.02, aliases: ['taiz'] }),
  Object.freeze({ name: 'Saada', lat: 16.94, lon: 43.76, aliases: ['saada', "sa'dah"] }),
  Object.freeze({ name: 'Jizan', lat: 16.89, lon: 42.55, aliases: ['jizan', 'jazan'] }),
  Object.freeze({ name: 'Najran', lat: 17.49, lon: 44.13, aliases: ['najran'] }),
  Object.freeze({ name: 'Jeddah', lat: 21.49, lon: 39.19, aliases: ['jeddah'] }),
  Object.freeze({ name: 'Yanbu', lat: 24.09, lon: 38.06, aliases: ['yanbu'] }),
  Object.freeze({ name: 'Riyadh', lat: 24.71, lon: 46.68, aliases: ['riyadh'] }),
  Object.freeze({ name: 'Abqaiq', lat: 25.94, lon: 49.68, aliases: ['abqaiq'] }),
  Object.freeze({ name: 'Ras Laffan', lat: 25.91, lon: 51.55, aliases: ['ras laffan'] }),
  // Sýria:
  Object.freeze({ name: 'Aleppo', lat: 36.2, lon: 37.16, aliases: ['aleppo'] }),
  Object.freeze({ name: 'Homs', lat: 34.73, lon: 36.72, aliases: ['homs'] }),
  Object.freeze({ name: 'Hama', lat: 35.13, lon: 36.75, aliases: ['hama'] }), // celé slovo: „Hamas" nie je Hama
  Object.freeze({ name: 'Idlib', lat: 35.93, lon: 36.63, aliases: ['idlib'] }),
  Object.freeze({ name: 'Latakia', lat: 35.52, lon: 35.78, aliases: ['latakia'] }),
  Object.freeze({ name: 'Tartus', lat: 34.89, lon: 35.89, aliases: ['tartus', 'tartous'] }),
  Object.freeze({ name: 'Quneitra', lat: 33.13, lon: 35.82, aliases: ['quneitra'] }),
  Object.freeze({ name: 'Daraa', lat: 32.62, lon: 36.1, aliases: ['daraa', 'deraa'] }),
  Object.freeze({ name: 'Suwayda', lat: 32.71, lon: 36.57, aliases: ['suwayda', 'sweida', 'sweidaa'] }),
  Object.freeze({ name: 'Palmyra', lat: 34.56, lon: 38.27, aliases: ['palmyra'] }),
  Object.freeze({ name: 'Raqqa', lat: 35.95, lon: 39.01, aliases: ['raqqa'] }),
  Object.freeze({ name: 'Deir ez-Zor', lat: 35.34, lon: 40.14, aliases: ['deir ez-zor', 'deir ezzor', 'deir el-zour', 'deir al-zor'] }),
  Object.freeze({ name: 'Hasakah', lat: 36.5, lon: 40.75, aliases: ['hasakah', 'hasaka'] }),
  Object.freeze({ name: 'Qamishli', lat: 37.05, lon: 41.23, aliases: ['qamishli'] }),
  Object.freeze({ name: 'Kobani', lat: 36.89, lon: 38.36, aliases: ['kobani', 'kobane'] }),
  // Irak:
  Object.freeze({ name: 'Erbil', lat: 36.19, lon: 44.01, aliases: ['erbil', 'irbil'] }),
  Object.freeze({ name: 'Sulaymaniyah', lat: 35.56, lon: 45.44, aliases: ['sulaymaniyah', 'sulaimaniyah'] }),
  Object.freeze({ name: 'Mosul', lat: 36.34, lon: 43.13, aliases: ['mosul'] }),
  Object.freeze({ name: 'Kirkuk', lat: 35.47, lon: 44.39, aliases: ['kirkuk'] }),
  Object.freeze({ name: 'Ain al-Asad', lat: 33.8, lon: 42.44, aliases: ['ain al-asad', 'ain al asad', 'al-asad air base'] }),
  // Irán:
  Object.freeze({ name: 'Fordow', lat: 34.88, lon: 50.99, aliases: ['fordow', 'fordo'] }),
  Object.freeze({ name: 'Qom', lat: 34.64, lon: 50.88, aliases: ['qom'] }),
  Object.freeze({ name: 'Arak', lat: 34.09, lon: 49.69, aliases: ['arak'] }),
  Object.freeze({ name: 'Parchin', lat: 35.52, lon: 51.77, aliases: ['parchin'] }),
  Object.freeze({ name: 'Tabriz', lat: 38.08, lon: 46.29, aliases: ['tabriz'] }),
  Object.freeze({ name: 'Kermanshah', lat: 34.31, lon: 47.07, aliases: ['kermanshah'] }),
  Object.freeze({ name: 'Ahvaz', lat: 31.32, lon: 48.67, aliases: ['ahvaz', 'ahwaz'] }),
  Object.freeze({ name: 'Shiraz', lat: 29.59, lon: 52.58, aliases: ['shiraz'] }),
  Object.freeze({ name: 'Mashhad', lat: 36.3, lon: 59.6, aliases: ['mashhad'] }),
  Object.freeze({ name: 'Qeshm', lat: 26.95, lon: 56.27, aliases: ['qeshm'] }),
  Object.freeze({ name: 'Jask', lat: 25.64, lon: 57.77, aliases: ['jask'] }),
  Object.freeze({ name: 'Chabahar', lat: 25.29, lon: 60.64, aliases: ['chabahar'] }),
  // Oblasti (pod menovaným miestom, nad štátom). „South Lebanon" drží údery na juhu
  // Libanonu mimo stredu krajiny; pás Gazy je malý, Západný breh široký.
  Object.freeze({ name: 'Gaza', lat: 31.42, lon: 34.38, kind: 'area', aliases: ['gaza', 'gazan'] }),
  Object.freeze({ name: 'West Bank', lat: 31.95, lon: 35.25, kind: 'area', broad: true, aliases: ['west bank'] }),
  Object.freeze({ name: 'South Lebanon', lat: 33.25, lon: 35.4, kind: 'area', aliases: ['south lebanon', 'southern lebanon'] }),
  Object.freeze({ name: 'Litani', lat: 33.34, lon: 35.25, kind: 'area', aliases: ['litani'] }),
  Object.freeze({ name: 'Bekaa', lat: 33.85, lon: 35.9, kind: 'area', broad: true, aliases: ['bekaa', 'beqaa'] }),
  Object.freeze({ name: 'Golan Heights', lat: 33.0, lon: 35.75, kind: 'area', aliases: ['golan'] }),
  Object.freeze({ name: 'Jordan Valley', lat: 32.0, lon: 35.5, kind: 'area', aliases: ['jordan valley'] }),
  Object.freeze({ name: 'Galilee', lat: 32.9, lon: 35.4, kind: 'area', broad: true, aliases: ['galilee'] }),
  Object.freeze({ name: 'Negev', lat: 30.8, lon: 34.8, kind: 'area', broad: true, aliases: ['negev'] }),
  // Broad chokepoints / seas (a named place beats them).
  Object.freeze({ name: 'Gulf of Oman', lat: 24.5, lon: 58.5, kind: 'sea', broad: true, aliases: ['gulf of oman'] }),
  Object.freeze({ name: 'Strait of Hormuz', lat: 26.57, lon: 56.25, kind: 'sea', aliases: ['strait of hormuz', 'hormuz'] }),
  Object.freeze({ name: 'Persian Gulf', lat: 26.5, lon: 51.5, kind: 'sea', broad: true, aliases: ['persian gulf', 'arabian gulf'] }),
  Object.freeze({ name: 'Bab-el-Mandeb', lat: 12.6, lon: 43.4, kind: 'sea', aliases: ['bab-el-mandeb', 'bab el-mandeb', 'bab al-mandab', 'mandeb'] }),
  Object.freeze({ name: 'Gulf of Aden', lat: 12.5, lon: 47.0, kind: 'sea', broad: true, aliases: ['gulf of aden'] }),
  Object.freeze({ name: 'Red Sea', lat: 20.0, lon: 38.0, kind: 'sea', broad: true, aliases: ['red sea'] }),
  // Country fallbacks LAST (any place, area or sea wins) — so a mention
  // geolocates to the country (approx.), not the region default.
  Object.freeze({ name: 'Iran', lat: 32.4, lon: 53.7, kind: 'country', broad: true, aliases: ['iran', 'iranian'] }),
  Object.freeze({ name: 'Israel', lat: 31.4, lon: 35.0, kind: 'country', broad: true, aliases: ['israel', 'israeli'] }),
  Object.freeze({ name: 'Yemen', lat: 15.5, lon: 44.2, kind: 'country', broad: true, aliases: ['yemen', 'yemeni', 'houthi'] }),
  Object.freeze({ name: 'Lebanon', lat: 33.9, lon: 35.5, kind: 'country', broad: true, aliases: ['lebanon', 'lebanese', 'hezbollah'] }),
  Object.freeze({ name: 'Iraq', lat: 33.2, lon: 43.7, kind: 'country', broad: true, aliases: ['iraq', 'iraqi'] }),
  Object.freeze({ name: 'Syria', lat: 35.0, lon: 38.5, kind: 'country', broad: true, aliases: ['syria', 'syrian'] }),
  Object.freeze({ name: 'Jordan', lat: 31.2, lon: 36.5, kind: 'country', broad: true, aliases: ['jordan', 'jordanian'] }),
  Object.freeze({ name: 'Saudi Arabia', lat: 24.0, lon: 45.0, kind: 'country', broad: true, aliases: ['saudi arabia', 'saudi'] }),
  Object.freeze({ name: 'United Arab Emirates', lat: 24.0, lon: 54.0, kind: 'country', broad: true, aliases: ['uae', 'united arab emirates', 'emirati'] }),
  Object.freeze({ name: 'Oman', lat: 21.0, lon: 57.0, kind: 'country', broad: true, aliases: ['oman', 'omani'] }),
  Object.freeze({ name: 'Egypt', lat: 26.8, lon: 30.8, kind: 'country', broad: true, aliases: ['egypt', 'egyptian'] }),
]);

/**
 * Default point for a region when no place is named (pilot: Hormuz). `null`
 * (ukraine, 2026-09-19) = an unlocated item gets NO marker: a card „somewhere
 * in Ukraine" would be noise, not information.
 */
export const REGION_DEFAULT = Object.freeze({
  gulf: Object.freeze({ name: 'Strait of Hormuz', lat: 26.57, lon: 56.25 }),
  mideast: Object.freeze({ name: 'Red Sea', lat: 20.0, lon: 38.0 }),
  ukraine: null,
  // Dejiská BLÍZKEHO VÝCHODU (etapa 3, 2026-09-26): bez menovaného miesta bez karty,
  // ako pri UKRAJINE — karta „niekde v Iráne" by bola šum, nie informácia.
  iran: null,
  lebanon: null,
  palestine: null,
  israel: null,
  redsea: null,
  syria: null,
  iraq: null,
});

/** Gazetteer for a region (ukraine has its own; everything else the Gulf/Middle East one). Pure. */
export function gazetteerForRegion(region) {
  return region === 'ukraine' ? UKRAINE_GAZETTEER : GULF_GAZETTEER;
}

/** Region default point, or null when the region says „no marker without a place". */
export function regionDefaultFor(region) {
  return Object.prototype.hasOwnProperty.call(REGION_DEFAULT, region) ? REGION_DEFAULT[region] : REGION_DEFAULT.gulf;
}

/**
 * Classify a headline into an incident class, or null if it does not read like
 * one. The ukraine region has its own rule set (ground fighting, air defence,
 * infrastructure with an action word — see ukraineIncidents.js). Pure.
 * @param {string} text
 * @param {{region?: string}} [o]
 * @returns {{type:string, severity:'critical'|'major'|'minor'}|null}
 */
export function classifyIncident(text, { region = 'gulf' } = {}) {
  if (region === 'ukraine') return classifyUkraineIncident(text);
  const s = String(text ?? '').replace(NON_MILITARY_STRIKE_RE, ' ');
  for (const rule of INCIDENT_RULES) {
    if (rule.re.test(s) && (!rule.context || rule.context.test(s))) return { type: rule.type, severity: rule.severity };
  }
  return null;
}

/**
 * First gazetteer place named in the text, else null. Pure.
 *
 * For the Ukraine gazetteer (2026-09-24) matching is STRICT, because plain
 * substrings put namesakes hundreds of km off („drones near Nova Borova,
 * Zhytomyr region" → Borova in Kharkiv oblast): whole words only (an English
 * plural/possessive is allowed), an alias preceded by a place-name adjective
 * (Nova/Stara/Velyka/Mala…) is a different place and is skipped, and when an
 * oblast that really qualifies the place — a header right before it („Zhytomyr
 * region: …", „… region — …", „In the X region, …") or „in/of (the) X region" /
 * „(X Oblast)" right after it, never across a sentence, dash or line break —
 * lies more than 250 km away, the place is a namesake and the oblast is
 * returned (approx). Oblast centres (Kyiv, Kharkiv, Odesa…) are never demoted.
 *
 * The Gulf / Middle East gazetteer (BLÍZKY VÝCHOD etapa 3, 2026-09-26) matches
 * whole words too (so „Hamas" is not Hama and „Bin Laden" not Aden) and picks
 * the place the event HAPPENED, not the one that acted: „Israel strikes Iran" →
 * Iran, „Iran fires missiles at Israel" → Israel. Every mention is scored — the
 * tier of the place (named place > area or sea > country) first, then its role
 * in the headline: a locative („in/at/near/on/over … X") or a struck object
 * („strikes/hits/killed X") counts for it, „from X" against it, and an actor
 * („X strikes…", „X's army says…", „… by X") drops below every other mention.
 * A demonym or an organisation (Israeli, Houthi, Hezbollah…) is weaker than a
 * proper name; a match inside a longer name of another place („Aden" in „Gulf of
 * Aden") does not count. Ties go to the earlier mention. A `broad` place
 * (country, wide sea) comes back `approx: true`.
 * @param {string} text
 * @param {ReadonlyArray} [gazetteer]
 * @returns {{name:string, lat:number, lon:number, approx?:boolean}|null}
 */
export function locateIncident(text, gazetteer = GULF_GAZETTEER) {
  if (gazetteer === UKRAINE_GAZETTEER) return locateStrict(String(text ?? '').toLowerCase(), gazetteer);
  return locateScored(String(text ?? '').toLowerCase().replace(/[’‘ʼ`]/g, "'").replace(/[‐‑]/g, '-'), gazetteer);
}

/** Tier podľa druhu miesta: menované miesto > oblasť či more > štát. */
const KIND_TIER = Object.freeze({ place: 3, area: 2, sea: 2, country: 1 });
/** Demonymá a organizácie — slabší dôkaz miesta než vlastné meno. */
const ME_WEAK_ALIASES = new Set(['iranian', 'israeli', 'yemeni', 'houthi', 'lebanese', 'hezbollah', 'iraqi', 'syrian', 'jordanian', 'saudi', 'emirati', 'omani', 'egyptian', 'gazan']);
const ME_DIR = '(?:(?:north|south|east|west|central|northern|southern|eastern|western|north-?eastern|north-?western|south-?eastern|south-?western|occupied|coastal)\\s+)?';
/** Predložka miesta tesne pred menom („in/at/near/on/over/across … X") — najsilnejší znak miesta udalosti. */
const ME_LOCATIVE_RE = new RegExp(`(?:^|[^a-z])(?:in|at|near|on|over|across|inside|into|onto|off|toward|towards|against)\\s+(?:the\\s+)?${ME_DIR}$`);
/** Zasiahnutý predmet („strikes X", „hits X", „killed X"). */
const ME_OBJECT_RE = new RegExp(`(?:^|[^a-z])(?:hits?|struck|strikes?|striking|attacks?|attacked|attacking|bombs?|bombed|bombing|pounds?|pounded|pounding|targets?|targeted|targeting|raids?|raided|shells?|shelled|shelling|invades?|invaded|kills?|killed)\\s+(?:the\\s+)?${ME_DIR}$`);
/** „from X" — odkiaľ, nie kde. */
const ME_SOURCE_RE = new RegExp(`(?:^|[^a-z])from\\s+(?:the\\s+)?${ME_DIR}$`);
/** „… by X" — pôvodca v trpnom rode. */
const ME_BY_RE = /(?:^|[^a-z])by\s+(?:the\s+)?$/;
/**
 * Demonymum pred zbraňou či silami („Israeli drone…", „in Israeli strike", „Houthi
 * missile…", „Iranian forces…") hovorí, KTO, nie KDE — ale „Iranian military base",
 * „Houthi missile launchers" sú zasiahnuté objekty (cieľ), tie ostávajú.
 */
const ME_ARMS_AFTER_RE = /^(?:'s)?\s+(?:artillery|drones?|uavs?|air ?strikes?|strikes?|missiles?|rockets?|jets?|warplanes?|fighter jets?|forces|troops|army|military|navy|air force|soldiers?|settlers?|tanks?|gunboats?|warships?|fire|gunfire|shelling|raids?|bombardment|attacks?|offensive|operations?|incursions?|militias?|militants?|fighters?)(?![a-z])(?!\s+(?:bases?|sites?|facilit(?:y|ies)|depots?|headquarters|hq|airbases?|installations?|positions?|ports?|compounds?|factor(?:y|ies)|plants?|warehouses?|camps?|launchers?|stockpiles?|production)(?![a-z]))/;
/** X (+ 's / zložka) + činné sloveso útoku či vyhlásenia = aktér („Israel strikes…", „Iran's IRGC seizes…"); trpný rod („hit by") nie. */
const ME_AGENT_AFTER_RE = /^(?:'s)?(?:\s+(?:military|army|forces|troops|navy|air force|jets?|warplanes?|drones?|missiles?|rockets?|militants?|fighters?|militias?|government|officials?|revolutionary guards?|irgc|idf|police|authorities))?\s+(?:says?|said|claims?|claimed|warns?|warned|vows?|vowed|threatens?|threatened|accuses?|accused|strikes?|struck|hits?|attacks?|attacked|launch(?:es|ed)?|fires?|fired|kills?|killed|bombs?|bombed|shells?|shelled|pounds?|pounded|raids?|raided|storms?|stormed|seizes?|seized|captures?|captured|detains?|detained|hijacks?|hijacked|retaliates?|retaliated|sends?|sent|deploys?|deployed|expands?|expanded|resumes?|resumed|escalates?|escalated)(?![a-z])(?!\s+by(?![a-z]))/;
const meAliasRe = new Map();
/** Celé slovo; množné „s" len pri demonymách (-i, -an: Houthis, Iranians), privlastňovacie 's vždy. */
function meAliasRegex(alias) {
  let re = meAliasRe.get(alias);
  if (!re) {
    const plural = /(?:i|an)$/.test(alias) ? '|s' : '';
    re = new RegExp(`(?<![a-z])${escapeRe(alias)}(?:'s${plural})?(?![a-z])`, 'g');
    meAliasRe.set(alias, re);
  }
  return re;
}
/**
 * Úloha zmienky v titulku: aktér −2500 (pod každú inú zmienku), miesto +30,
 * predmet +20, „from" −30, demonymum −5; `null` = zmienka nie je miesto vôbec
 * (demonymum pred zbraňou či silami: „Israeli drone explodes on house",
 * „killed in Israeli strike").
 */
function meRoleScore(s, at, end, alias) {
  const before = s.slice(Math.max(0, at - 48), at);
  const after = s.slice(end, end + 72);
  const weak = ME_WEAK_ALIASES.has(alias);
  if (weak && ME_ARMS_AFTER_RE.test(after)) return null;
  const locative = ME_LOCATIVE_RE.test(before);
  const object = !locative && ME_OBJECT_RE.test(before);
  if (ME_BY_RE.test(before) || ME_AGENT_AFTER_RE.test(after)) return -2500;
  let score = 0;
  if (locative) score += 30;
  else if (object) score += 20;
  else if (ME_SOURCE_RE.test(before)) score -= 30;
  if (weak) score -= 5;
  return score;
}
function locateScored(s, gazetteer) {
  const hits = [];
  gazetteer.forEach((place, order) => {
    const tier = (KIND_TIER[place.kind] ?? KIND_TIER.place) * 1000;
    for (const alias of place.aliases) {
      const re = meAliasRegex(alias);
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        const at = m.index;
        const end = at + m[0].length;
        const role = meRoleScore(s, at, end, alias);
        hits.push({ place, order, at, end, score: role === null ? null : tier + role });
      }
    }
  });
  // Zhoda vnútri dlhšieho mena iného miesta („aden" v „gulf of aden", „lebanon" v „south lebanon") sa nepočíta.
  const kept = hits.filter((h) => h.score !== null
    && !hits.some((o) => o.place !== h.place && o.at <= h.at && o.end >= h.end && o.end - o.at > h.end - h.at));
  if (!kept.length) return null;
  kept.sort((a, b) => (b.score - a.score) || (a.at - b.at) || (a.order - b.order));
  const best = kept[0].place;
  const loc = { name: best.name, lat: best.lat, lon: best.lon };
  if (best.broad) loc.approx = true;
  return loc;
}

const EN_ADJ_BEFORE_RE = /(?:^|[^a-z])(?:nova|novo|novyi|nove|stara|staryi|stare|velyka|velykyi|velyke|mala|malyi|male|verkhnia|verkhnii|nyzhnia|nyzhnii|bila|bilyi|chervona|chervonyi|zelena|zelenyi)\s+$/;
const EN_OBLAST_RE = /([a-z][a-z-]+)\s+(?:region|oblast|province)(?![a-z])/g;
const EN_BREAK_RE = /[.!?;|\n–—]/;
/** Krajské mestá — ich menovec nie je dôvod premiestniť správu do inej oblasti. */
const EN_OBLAST_CENTRES = new Set(['Kyiv', 'Kharkiv', 'Odesa', 'Lviv', 'Dnipro', 'Zaporizhzhia', 'Mykolaiv', 'Kherson', 'Sumy', 'Chernihiv', 'Poltava', 'Zhytomyr', 'Vinnytsia', 'Cherkasy', 'Kropyvnytskyi', 'Khmelnytskyi', 'Ternopil', 'Rivne', 'Lutsk', 'Ivano-Frankivsk', 'Uzhhorod', 'Chernivtsi', 'Donetsk', 'Luhansk']);
const EN_FROM_TOWARD_RE = /(?:^|[^a-z])(?:from|toward|towards|to|into|heading for)\s+(?:the\s+)?$/;
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const enAliasRe = new Map();
/** Prvý výskyt aliasu ako celého slova, ktorý nepredchádza prídavné meno sídla; [start, end] alebo null. */
function findAlias(s, alias) {
  let re = enAliasRe.get(alias);
  if (!re) { re = new RegExp(`(?<![a-z])${escapeRe(alias)}(?:'s|s)?(?![a-z])`, 'g'); enAliasRe.set(alias, re); }
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(s))) {
    if (!EN_ADJ_BEFORE_RE.test(s.slice(Math.max(0, m.index - 16), m.index))) return [m.index, m.index + m[0].length];
  }
  return null;
}
const kmBetweenEn = (a, b) => { const dy = (b.lat - a.lat) * 111.32; const dx = (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180); return Math.hypot(dx, dy); };
function locateStrict(s, gazetteer) {
  const oblasts = [];
  EN_OBLAST_RE.lastIndex = 0;
  let om;
  while ((om = EN_OBLAST_RE.exec(s))) {
    const key = om[1].replace(/^the-?/, '');
    const hit = UKRAINE_OBLASTS_EN[key];
    if (hit) oblasts.push({ ...hit, at: om.index, end: om.index + om[0].length });
  }
  for (const place of gazetteer) {
    let span = null;
    for (const alias of place.aliases) {
      const sp = findAlias(s, alias);
      if (sp && (!span || sp[0] < span[0])) span = sp;
    }
    if (!span) continue;
    const loc = { name: place.name, lat: place.lat, lon: place.lon };
    if (/Oblast$/.test(place.name) || !oblasts.length || EN_OBLAST_CENTRES.has(place.name)) return loc;
    const [at, end] = span;
    // Pred sídlom len nadpis („Zhytomyr region: …", „… region — …") alebo „In the X region, …".
    const before = oblasts.filter((o) => {
      if (o.end > at || at - o.end > 60 || EN_FROM_TOWARD_RE.test(s.slice(Math.max(0, o.at - 16), o.at))) return false;
      const header = /^[ \t]*[:–—-]/.exec(s.slice(o.end, at));
      const inPhrase = /(?:^|[^a-z])in\s+(?:the\s+)?$/.test(s.slice(Math.max(0, o.at - 8), o.at)) && /^[ \t]*,/.test(s.slice(o.end, at));
      if (!header && !inPhrase) return false;
      const gap = s.slice(o.end, at).replace(/^[ \t]*[:–—,-]/, '');
      return !EN_BREAK_RE.test(gap);
    }).at(-1);
    // Za sídlom len „in (the) X region", „of X region" alebo „(X Oblast)" — nie holá čiarka, „and" ani nový riadok.
    const after = oblasts.find((o) => o.at >= end && /^[ \t]*(?:(?:in|of)[ \t]+(?:the[ \t]+)?|\([ \t]*)$/.test(s.slice(end, o.at)));
    const hints = [before, after].filter(Boolean);
    if (!hints.length || hints.some((h) => kmBetweenEn(h, place) <= 250)) return loc;
    const h = hints[0];
    return { name: h.name, lat: h.lat, lon: h.lon, approx: true };
  }
  return null;
}

/**
 * News items → geolocated incident markers (only items that classify as an
 * incident). Deduped by url. Pure.
 * @param {Array<{title?:string,url?:string,source?:string,publishedAt?:number}>} items
 * @param {{region?:string, gazetteer?:ReadonlyArray, limit?:number}} [o]
 * @returns {Array<{lat:number, lon:number, place:string, approx:boolean, type:string, severity:string, title:string, url:string, source:string, publishedAt:number|null}>}
 */
export function buildIncidents(items, { region = 'gulf', gazetteer = gazetteerForRegion(region), limit = 40 } = {}) {
  const fallback = regionDefaultFor(region);
  const seen = new Set();
  const out = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    if (out.length >= limit) break;
    const cls = classifyIncident(it?.title, { region });
    if (!cls) continue;
    const url = typeof it?.url === 'string' ? it.url : '';
    if (!url || seen.has(url)) continue;
    const loc = locateIncident(it.title, gazetteer);
    if (!loc && !fallback) continue; // región bez predvoleného bodu: bez miesta bez karty
    seen.add(url);
    out.push({
      lat: loc ? loc.lat : fallback.lat,
      lon: loc ? loc.lon : fallback.lon,
      place: loc ? loc.name : fallback.name,
      // true when we fell back to the region default, or the place stands for a
      // large area (a country, a wide sea, a demoted Ukrainian namesake)
      approx: !loc || loc.approx === true,
      type: cls.type,
      severity: cls.severity,
      title: String(it.title),
      url,
      source: typeof it?.source === 'string' ? it.source : '',
      publishedAt: Number.isFinite(it?.publishedAt) ? it.publishedAt : null,
      image: typeof it?.image === 'string' && /^https?:\/\//.test(it.image) ? it.image : null,
      noImage: Boolean(it?.noImage),
      badge: typeof it?.badge === 'string' ? it.badge : null,
    });
  }
  return out;
}

const SEVERITY_RANK = Object.freeze({ critical: 3, major: 2, minor: 1 });

/**
 * Strip a trailing " - Outlet" / " — Outlet" that Google News RSS appends to a
 * headline, so the card shows the story, not the publisher (shown separately).
 * Falls back to the raw title if stripping would empty it. Pure.
 * @param {string} title
 * @returns {string}
 */
export function cleanHeadline(title) {
  const raw = String(title ?? '').trim();
  const stripped = raw.replace(/\s+[-–—]\s+[^-–—]{2,42}$/, '').trim();
  return stripped || raw;
}

/** Collapse-key for the same story reported by many outlets. */
function storyKey(title) {
  return cleanHeadline(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

const VIDEO_HOST = /(?:^|\.)(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|rumble\.com|bitchute\.com)$/i;
const VIDEO_PATH = /\/(?:video|watch)s?(?:\/|$|\?)/i;

/** True when the link points at a video (known host, or a /video//watch path). The
 *  card shows a ▶ badge and links out — video is never embedded. Pure. */
export function isVideoUrl(url) {
  try { const u = new URL(String(url)); return VIDEO_HOST.test(u.hostname) || VIDEO_PATH.test(u.pathname); } catch { return false; }
}

/**
 * Incidents → "hot card" models: ONE card per PLACE (so cards sit anchored on the
 * spot they concern instead of fanning into a detached column when many reports
 * share the strait). The card carries the most-severe / newest story at that place,
 * plus `storyCount` (distinct stories there) and `sourceCount` (outlets), ordered
 * most-severe then newest, capped to `limit`. Pure.
 * @param {Array} items open-source news items (situationNews shape)
 * @param {{region?:string, gazetteer?:ReadonlyArray, limit?:number}} [o]
 * @returns {Array<{lat:number, lon:number, place:string, approx:boolean, type:string, severity:string, title:string, url:string, source:string, publishedAt:number|null, storyCount:number, sourceCount:number}>}
 */
export function buildIncidentCards(items, { region = 'gulf', gazetteer = gazetteerForRegion(region), limit = 6 } = {}) {
  const incidents = buildIncidents(items, { region, gazetteer, limit: 60 });
  const groups = new Map();
  for (const inc of incidents) {
    const locKey = `${inc.lat.toFixed(2)}|${inc.lon.toFixed(2)}`;
    let g = groups.get(locKey);
    if (!g) { g = { rep: inc, stories: new Set(), sources: new Set(), image: null }; groups.set(locKey, g); }
    g.stories.add(storyKey(inc.title));
    if (inc.source) g.sources.add(inc.source);
    if (!g.image && inc.image) g.image = inc.image; // first available preview image at this place
    const better = (SEVERITY_RANK[inc.severity] || 0) > (SEVERITY_RANK[g.rep.severity] || 0)
      || ((SEVERITY_RANK[inc.severity] || 0) === (SEVERITY_RANK[g.rep.severity] || 0)
        && (inc.publishedAt || 0) > (g.rep.publishedAt || 0));
    if (better) g.rep = inc;
  }
  const cards = [...groups.values()].map(({ rep, stories, sources, image }) => ({
    lat: rep.lat,
    lon: rep.lon,
    place: rep.place,
    approx: rep.approx,
    type: rep.type,
    severity: rep.severity,
    title: cleanHeadline(rep.title),
    url: rep.url,
    source: rep.source,
    publishedAt: rep.publishedAt,
    image: rep.image || image || null,
    noImage: Boolean(rep.noImage),
    badge: rep.badge || null,
    isVideo: isVideoUrl(rep.url),
    storyCount: Math.max(1, stories.size),
    sourceCount: Math.max(1, sources.size),
  }));
  cards.sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || ((b.publishedAt || 0) - (a.publishedAt || 0)));
  return cards.slice(0, Math.max(0, limit));
}
