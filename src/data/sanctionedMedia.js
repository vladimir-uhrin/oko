// src/data/sanctionedMedia.js
/**
 * @module sanctionedMedia
 * @description Blocklist médií, ktorých obsah sa v EÚ NESMIE šíriť (modul
 * UKRAJINA, etapa 2, 2026-09-19; plán docs/drafts/ukrajina-plan.md kap. 3).
 *
 * Právny základ: čl. 2f nariadenia (EÚ) 833/2014 (zavedený nar. 2022/350):
 * „It shall be prohibited for operators to broadcast or to enable, facilitate or
 * otherwise contribute to broadcast, any content by the legal persons, entities
 * or bodies listed in Annex XV, including through transmission or distribution
 * by any means such as cable, satellite, IP-TV, internet service providers,
 * internet video-sharing platforms or applications." Súdny dvor EÚ C-67/25
 * (2. 7. 2026): aj súkromný web financovaný darmi je „operátor" — nekomerčnosť
 * OKO NIE JE obrana. 20. balík (2026/506) pridal klauzulu o zrkadlových doménach.
 * Rybar (Michail Zvinčuk) nie je v prílohe XV, ale je v prílohe I nar. 269/2014
 * (asset freeze); FAQ Komisie Q11: aj bezplatné sprístupnenie obsahu listovanej
 * osoby môže byť sprístupnením hospodárskych zdrojov → blokuje sa rovnako.
 *
 * Preto: položky z týchto domén (aj z ich subdomén) sa vyhadzujú z každého
 * spravodajského výstupu (GDELT, Google News RSS, priame RSS) ešte na serveri
 * a klient ich pre istotu filtruje znova. TASS v prílohe XV NIE JE (stav
 * 12/2025) — nie je tu; ak ho používateľ chce, ide zvlášť so štítkom „tvrdí RU".
 *
 * Zoznam treba prejsť pri KAŽDOM ďalšom sankčnom balíku (21. je v príprave):
 * konsolidované znenie 833/2014 na EUR-Lex, príloha XV. Modul je čistý.
 */

/** Kedy bol zoznam naposledy overený a proti čomu. */
export const SANCTIONED_MEDIA_STATUS = Object.freeze({
  checked: '2026-09-19',
  basis: 'Annex XV of Regulation (EU) 833/2014 as amended up to the 16th package (Reg. 2025/395); the 17th–20th packages added no media outlets (the 20th added the mirror-domain clause); the 21st package is pending',
  sources: Object.freeze([
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R0350',
    'https://www.ancom.ro/en/about-us/media-en/press-releases/the-broadcasting-of-content-produced-by-certain-media-channels-is-prohibited-in-the-european-union/',
    'https://finance.ec.europa.eu/document/download/99b8682b-4f41-4d78-9756-7087d0a93965_en?filename=faqs-sanctions-russia-media_en.pdf',
  ]),
});

/**
 * Subjekty prílohy XV (+ Rybar podľa prílohy I) a ich známe domény. Domény sú
 * bez `www.`; zhoda platí aj pre subdomény (`russian.rt.com`, `ria.ru/...`).
 * @type {ReadonlyArray<{name: string, basis: 'annex-xv'|'annex-i', domains: ReadonlyArray<string>}>}
 */
export const SANCTIONED_MEDIA = Object.freeze([
  { name: 'RT (Russia Today) and subsidiaries', basis: 'annex-xv', domains: ['rt.com', 'rt.ru', 'rtnews.com', 'rtd.rt.com', 'rtfrance.tv', 'rtarabic.com', 'rtbalkan.rs', 'rt.rs', 'ruptly.tv', 'redfish.media', 'maffick.com'] },
  { name: 'Sputnik and subsidiaries', basis: 'annex-xv', domains: ['sputniknews.com', 'sputnikglobe.com', 'sputnikmediabank.com', 'sputniknews.ru', 'sputnik.by', 'sputnik-ossetia.ru', 'sputnik-abkhazia.ru', 'sputnik.az', 'sputnik.kz', 'sputnik.kg', 'sputnik.tj', 'sputnik.md', 'sputnik-georgia.ru', 'sputnik-tj.com', 'sputniknews-uz.com', 'sputnikarabic.ae', 'sputnik.africa', 'radiosputnik.ru'] },
  { name: 'RIA Novosti', basis: 'annex-xv', domains: ['ria.ru', 'rian.ru', 'inosmi.ru', 'ukraina.ru', 'baltnews.com', 'baltnews.lt', 'baltnews.lv', 'baltnews.ee', 'sputnikpress.ru'] },
  { name: 'Izvestia', basis: 'annex-xv', domains: ['iz.ru', 'izvestia.ru'] },
  { name: 'Rossiyskaya Gazeta', basis: 'annex-xv', domains: ['rg.ru'] },
  { name: 'Lenta', basis: 'annex-xv', domains: ['lenta.ru'] },
  { name: 'NewsFront', basis: 'annex-xv', domains: ['news-front.info', 'news-front.su', 'newsfront.info'] },
  { name: 'SouthFront', basis: 'annex-xv', domains: ['southfront.org', 'southfront.press', 'southfront.su'] },
  { name: 'Strategic Culture Foundation / Fondsk', basis: 'annex-xv', domains: ['strategic-culture.org', 'strategic-culture.su', 'fondsk.ru'] },
  { name: 'Tsargrad', basis: 'annex-xv', domains: ['tsargrad.tv'] },
  { name: 'Oriental Review', basis: 'annex-xv', domains: ['orientalreview.org', 'orientalreview.su'] },
  { name: 'New Eastern Outlook', basis: 'annex-xv', domains: ['journal-neo.org', 'journal-neo.su'] },
  { name: 'Katehon', basis: 'annex-xv', domains: ['katehon.com'] },
  { name: 'Voice of Europe', basis: 'annex-xv', domains: ['voiceofeurope.com'] },
  { name: 'EADaily / Eurasia Daily', basis: 'annex-xv', domains: ['eadaily.com'] },
  { name: 'RuBaltic', basis: 'annex-xv', domains: ['rubaltic.ru'] },
  { name: 'Zvezda (TV Zvezda, Krasnaya Zvezda)', basis: 'annex-xv', domains: ['tvzvezda.ru', 'zvezdaweekly.ru', 'redstar.ru'] },
  { name: 'Pervyi Kanal (Channel One)', basis: 'annex-xv', domains: ['1tv.ru', '1tv.com'] },
  { name: 'VGTRK: Rossiya 1, Rossiya 24, RTR Planeta, Vesti', basis: 'annex-xv', domains: ['vesti.ru', 'smotrim.ru', 'russia.tv', 'vgtrk.ru', 'vgtrk.com', 'rtr-planeta.com', 'vestifinance.ru'] },
  { name: 'NTV / NTV Mir', basis: 'annex-xv', domains: ['ntv.ru'] },
  { name: 'REN TV', basis: 'annex-xv', domains: ['ren.tv'] },
  { name: 'TV Centre International', basis: 'annex-xv', domains: ['tvc.ru'] },
  { name: 'Spas TV', basis: 'annex-xv', domains: ['spastv.ru'] },
  { name: 'Rybar (Mikhail Zvinchuk, Annex I of Reg. 269/2014)', basis: 'annex-i', domains: ['rybar.ru', 'map.rybar.ru', 't.me/rybar', 't.me/s/rybar'] },
]);

const HOST_INDEX = new Map();
for (const outlet of SANCTIONED_MEDIA) {
  for (const domain of outlet.domains) HOST_INDEX.set(domain.toLowerCase(), outlet);
}

/** Normalizovaný host (bez www., malé písmená) alebo ''. */
function hostOf(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, '');
  } catch { return s.replace(/^www\./, '').replace(/[/?#].*$/, ''); }
}

/** Cesta (pre t.me/rybar) alebo ''. */
function pathOf(value) {
  const s = String(value ?? '').trim();
  try { return new URL(s.includes('://') ? s : `https://${s}`).pathname.toLowerCase(); } catch { return ''; }
}

/**
 * Sankcionovaný subjekt pre host (alebo subdoménu), inak null. Pure.
 * @param {string} host
 * @returns {{name: string, basis: string}|null}
 */
export function sanctionedMediaFor(host) {
  const h = hostOf(host);
  if (!h) return null;
  const parts = h.split('.');
  for (let i = 0; i < parts.length - 1; i += 1) {
    const candidate = parts.slice(i).join('.');
    const hit = HOST_INDEX.get(candidate);
    if (hit) return { name: hit.name, basis: hit.basis };
  }
  return null;
}

/** Je host (doména/subdoména) v blockliste? Pure. */
export function isSanctionedMediaHost(host) {
  return sanctionedMediaFor(host) !== null;
}

/**
 * Je URL z blocklistu? Zohľadňuje aj cesty (t.me/rybar). Pure.
 * @param {string} url
 */
export function isSanctionedMediaUrl(url) {
  const h = hostOf(url);
  if (!h) return false;
  if (isSanctionedMediaHost(h)) return true;
  const p = pathOf(url);
  if (!p) return false;
  return HOST_INDEX.has(`${h}${p.replace(/\/+$/, '')}`) || HOST_INDEX.has(`${h}${p.split('/').slice(0, 2).join('/')}`);
}

/**
 * Vyhoď položky správ z blocklistu (podľa URL aj podľa `source` domény). Pure.
 * @param {Array<{url?: string, source?: string}>} items
 * @returns {{items: Array, dropped: number}}
 */
export function filterSanctionedNews(items) {
  const out = [];
  let dropped = 0;
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || typeof it !== 'object') continue;
    if (isSanctionedMediaUrl(it.url) || isSanctionedMediaHost(it.source)) { dropped += 1; continue; }
    out.push(it);
  }
  return { items: out, dropped };
}
