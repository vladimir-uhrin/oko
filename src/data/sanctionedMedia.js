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
 *
 * BLÍZKY VÝCHOD (etapa 0, 2026-09-26; plán docs/drafts/blizky-vychod-plan.md
 * kap. 4, prieskum kap. I): tu nejde o zákaz vysielania ako v prílohe XV, ale
 * o ZMRAZENIE AKTÍV listovaných subjektov — rovnaká logika ako pri Rybarovi
 * (FAQ Q11): sprístupniť obsah listovaného subjektu = sprístupniť mu
 * hospodárske zdroje. Základy (overené 26. 9. 2026 cez OpenSanctions/EUR-Lex):
 * `eu-iran-hr` = nar. (EÚ) 359/2011 (Irán, ľudské práva): Press TV (vyk. nar.
 * 2022/2231, 14. 11. 2022), IRIB (vyk. nar. 2022/2428, 12. 12. 2022) a jej
 * kanály Al-Alam, HispanTV, Sahar, YJC (vlastník listovaný), Tasnim (vyk. nar.
 * 2023/1779, 15. 9. 2023); `eu-terror-list` = spoločná pozícia 2001/931/SZBP +
 * nar. (ES) 2580/2001: IRGC (rozh. (SZBP) 2026/421 + vyk. nar. 2026/420,
 * 19. 2. 2026) → Sepah News a PREVENTÍVNE Fars (OFAC: „acting for or on behalf
 * of IRGC", EÚ ju samu nelistuje), Hamas (celá organizácia od 2003/651/SZBP;
 * al-Kassám aj v GHRSR 2020/1998 od 12. 4. 2024), Palestínsky islamský džihád
 * (Saraya al-Quds), vojenské krídlo Hizballáhu (rozh. 2013/395/SZBP) → Al-Manar
 * a Al-Nour PREVENTÍVNE (EÚ listuje len vojenské krídlo; satelitné vysielanie
 * Al-Manar zakázali regulátori EÚ 2005); `eu-yemen` = nar. (EÚ) 1352/2014:
 * Ansarallah/Húsíovia (vyk. nar. 2022/419, 14. 3. 2022) → Al-Masirah a Saba
 * zo SANÁ (saba.ye) — Saba z Adenu (sabanew.net, uznaná vláda) NIE je blokovaná.
 * Nelistované štátne agentúry (IRNA, Mehr) sa neblokujú — ak by sa niekedy
 * ťahali, len so štítkom „tvrdí Irán" (rovnaké pravidlo ako TASS).
 */

/** Kedy bol zoznam naposledy overený a proti čomu. */
export const SANCTIONED_MEDIA_STATUS = Object.freeze({
  checked: '2026-09-26',
  basis: 'Annex XV of Regulation (EU) 833/2014 as amended up to the 16th package (Reg. 2025/395); the 17th–20th packages added no media outlets (the 20th added the mirror-domain clause); the 21st package is pending. Middle East section (2026-09-26): asset-freeze listings under Regulation (EU) 359/2011 (Iran human rights), the EU terrorist list (Common Position 2001/931/CFSP, Regulation (EC) 2580/2001) and Regulation (EU) 1352/2014 (Yemen) — content of a listed entity or of an outlet it owns is treated as making economic resources available (Commission FAQ Q11 logic)',
  sources: Object.freeze([
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R0350',
    'https://www.ancom.ro/en/about-us/media-en/press-releases/the-broadcasting-of-content-produced-by-certain-media-channels-is-prohibited-in-the-european-union/',
    'https://finance.ec.europa.eu/document/download/99b8682b-4f41-4d78-9756-7087d0a93965_en?filename=faqs-sanctions-russia-media_en.pdf',
    // Blízky východ (2026-09-26)
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011R0359',
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R2231',
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R2428',
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32023R1779',
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R0420',
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014R1352',
    'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R0419',
    'https://www.consilium.europa.eu/en/press/press-releases/2026/02/19/eu-terrorist-list-council-designates-the-islamic-revolutionary-guard-corps-as-a-terrorist-organisation/',
    'https://www.opensanctions.org/entities/NK-BbW38gWwSry7XXohrTvxhq/',
    'https://www.opensanctions.org/entities/NK-esY7fRZz5VPXwaZ5p7j7XM/',
  ]),
});

/**
 * Subjekty prílohy XV (+ Rybar podľa prílohy I) a ich známe domény. Domény sú
 * bez `www.`; zhoda platí aj pre subdomény (`russian.rt.com`, `ria.ru/...`).
 * Sekcia Blízky východ (2026-09-26) nesie základ podľa režimu (`eu-iran-hr`,
 * `eu-terror-list`, `eu-yemen`) a v `note` právny akt + prípadný odvodený
 * dôvod (vlastník listovaný, preventívne). Každá doména patrí PRÁVE JEDNÉMU
 * záznamu (index je Map, posledný by vyhral).
 * @type {ReadonlyArray<{name: string, basis: 'annex-xv'|'annex-i'|'eu-iran-hr'|'eu-terror-list'|'eu-yemen', domains: ReadonlyArray<string>, note?: string}>}
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
  // ── Blízky východ (etapa 0, 2026-09-26) — Irán ──────────────────────────
  { name: 'Press TV (IRIB English channel)', basis: 'eu-iran-hr', domains: ['presstv.ir', 'presstv.co.uk'], note: 'Reg. (EU) 359/2011, listed by Implementing Reg. (EU) 2022/2231 (14 Nov 2022)' },
  { name: 'IRIB — Islamic Republic of Iran Broadcasting (IRIB News, IRINN)', basis: 'eu-iran-hr', domains: ['irib.ir', 'pririb.ir', 'iribnews.ir', 'irib-news.ir'], note: 'Reg. (EU) 359/2011, listed by Implementing Reg. (EU) 2022/2428 (12 Dec 2022)' },
  { name: 'Al-Alam News Network (IRIB)', basis: 'eu-iran-hr', domains: ['alalam.ir'], note: 'owner IRIB listed (2022/2428); the channel itself is not listed' },
  { name: 'HispanTV (IRIB)', basis: 'eu-iran-hr', domains: ['hispantv.com'], note: 'owner IRIB listed (2022/2428)' },
  { name: 'Sahar TV (IRIB)', basis: 'eu-iran-hr', domains: ['sahartv.ir'], note: 'owner IRIB listed (2022/2428)' },
  { name: 'Young Journalists Club — YJC (IRIB)', basis: 'eu-iran-hr', domains: ['yjc.ir', 'yjcnews.ir'], note: 'founded and run by the IRIB political deputy; owner listed (2022/2428)' },
  { name: 'Tasnim News Agency (IRGC-owned)', basis: 'eu-iran-hr', domains: ['tasnimnews.com'], note: 'Reg. (EU) 359/2011, listed by Implementing Reg. (EU) 2023/1779 (15 Sep 2023); owner IRGC on the EU terrorist list since 19 Feb 2026' },
  { name: 'Sepah News (official IRGC news site)', basis: 'eu-terror-list', domains: ['sepahnews.ir', 'sepahnews.com'], note: 'owner IRGC designated by Council Decision (CFSP) 2026/421 + Implementing Reg. (EU) 2026/420 (19 Feb 2026)' },
  { name: 'Fars News Agency (IRGC-affiliated) — precautionary', basis: 'eu-terror-list', domains: ['farsnews.ir', 'farsnews.com'], note: 'NOT itself EU-listed; US OFAC: „acting for or on behalf of the IRGC" (15 Sep 2023); blocked as a precaution because the IRGC is on the EU terrorist list' },
  // ── Jemen (Ansarallah / Húsíovia) ────────────────────────────────────────
  { name: 'Al-Masirah TV (Houthi)', basis: 'eu-yemen', domains: ['masirahtv.net', 'almasirah.net.ye', 'almasirah.net'], note: 'owner Ansarallah listed under Reg. (EU) 1352/2014 by Implementing Reg. (EU) 2022/419 (14 Mar 2022)' },
  { name: 'Saba News Agency — Sanaa (Houthi-run; the Aden agency sabanew.net is NOT blocked)', basis: 'eu-yemen', domains: ['saba.ye', 'sabanews.gov.ye'], note: 'run by the Ansarallah de facto authorities; Ansarallah listed (2022/419)' },
  // ── Libanon (Hizballáh) ──────────────────────────────────────────────────
  { name: 'Al-Manar TV (Hezbollah) — precautionary', basis: 'eu-terror-list', domains: ['almanar.com.lb'], note: 'EU lists only the Hizballah Military Wing (Decision 2013/395/CFSP); Al-Manar is Hezbollah-owned, its satellite broadcasts were banned by EU regulators in 2005; blocked as a precaution' },
  { name: 'Al-Nour radio (Hezbollah) — precautionary', basis: 'eu-terror-list', domains: ['alnour.com.lb'], note: 'Hezbollah-owned; same reasoning as Al-Manar' },
  // ── Palestína (Hamas, Palestínsky islamský džihád) ───────────────────────
  { name: 'Al-Aqsa TV (Hamas)', basis: 'eu-terror-list', domains: ['alaqsanet.news', 'aqsatv.ps'], note: 'owner Hamas on the EU terrorist list (whole organisation since Common Position 2003/651/CFSP)' },
  { name: 'Al-Qassam Brigades website (Hamas military wing)', basis: 'eu-terror-list', domains: ['alqassam.ps', 'qassam.ps'], note: 'listed directly as Hamas-Izz al-Din al-Qassem (2001/931/CFSP, Reg. 2580/2001) and under the GHRSR (Reg. 2020/1998, 12 Apr 2024)' },
  { name: 'Shehab News Agency (Hamas-affiliated)', basis: 'eu-terror-list', domains: ['shehabnews.com', 'shehab.ps'], note: 'Hamas-affiliated per Wikipedia; owner listed' },
  { name: 'Palestinian Information Center (Hamas-affiliated)', basis: 'eu-terror-list', domains: ['palinfo.com'], note: 'Hamas-affiliated; owner listed' },
  { name: 'Saraya al-Quds website (Palestinian Islamic Jihad military wing)', basis: 'eu-terror-list', domains: ['saraya.ps'], note: 'PIJ listed (2001/931/CFSP); Al-Quds Brigades also under the GHRSR (12 Apr 2024)' },
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
 * Vyhoď položky správ z blocklistu (podľa URL, podľa `source` domény a podľa
 * `sourceHost` — host vydavateľa z `<source url>` Google News RSS, kde `url`
 * je len presmerovanie news.google.com a `source` je zobrazované MENO). Pure.
 * @param {Array<{url?: string, source?: string, sourceHost?: string}>} items
 * @returns {{items: Array, dropped: number}}
 */
export function filterSanctionedNews(items) {
  const out = [];
  let dropped = 0;
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || typeof it !== 'object') continue;
    if (isSanctionedMediaUrl(it.url) || isSanctionedMediaHost(it.source) || isSanctionedMediaHost(it.sourceHost)) { dropped += 1; continue; }
    out.push(it);
  }
  return { items: out, dropped };
}
