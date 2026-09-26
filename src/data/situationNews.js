// src/data/situationNews.js
/**
 * @module situationNews
 * @description „Situácia z otvorených zdrojov" — pilot (2026-09-17): agregované
 * spravodajstvo k námornej/energetickej situácii, začíname zálivom (Hormuz).
 * Zdroj GDELT DOC 2.0 (keyless, otvorený projekt) — filtruje otvorené články
 * podľa dopytu, vracia titulok/zdroj/čas/odkaz/náhľad. Servíruje proxy
 * `/api/situation-news?region=<id>`; GDELT má limit 1 dopyt/5 s, preto proxy
 * cachuje ~15 min.
 *
 * POCTIVOSŤ (pravidlo 2 + 6 CLAUDE.md): AGREGUJEME a ODKAZUJEME na otvorenú
 * žurnalistiku — nereprodukujeme text, nesledujeme osoby, nerozpoznávame tváre.
 * Feed je „situačný prehľad z otvorených zdrojov", nie overená real-time
 * intelligence; každá položka nesie zdroj a čas. Modul je čistý (bez DOM).
 *
 * Rozšírenie: pridaním regiónu do SITUATION_REGIONS (ďalšia úžina = vlastný
 * dopyt) a ďalších zdrojov (RSS, UKMTO) do proxy.
 */

import { filterSanctionedNews } from './sanctionedMedia.js';

export const SITUATION_NEWS_API = '/api/situation-news';

/**
 * Priame RSS zdroje Blízkeho východu (etapa 3 modulu BLÍZKY VÝCHOD, 2026-09-26; plán
 * docs/drafts/blizky-vychod-plan.md kap. 6, prieskum kap. H — feedy overené 24. a 26. 9.).
 * Len titulok + odkaz: `unfurl:false` (bez sťahovania og:image zo stránky článku) a obrázok
 * z feedu len tam, kde je precedens (Guardian, ako pri UKRAJINE). `limit` na zdroj, aby
 * 300-položkový Asharq nevytlačil ostatných. Každý feed je ešte filtrovaný `match`
 * regiónu. Štátne a stranícke médiá listované v EÚ (Press TV, Tasnim, Al-Masirah,
 * Al-Manar…) tu nie sú nikdy — blocklist ich vyhodí aj z GDELT a Google News.
 */
const MIDEAST_FEEDS = Object.freeze({
  bbc: Object.freeze({ url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', label: 'BBC News', unfurl: true, limit: 8 }),
  aljazeera: Object.freeze({ url: 'https://www.aljazeera.com/xml/rss/all.xml', label: 'Al Jazeera', unfurl: false, limit: 6 }),
  guardian: Object.freeze({ url: 'https://www.theguardian.com/world/middleeast/rss', label: 'The Guardian', unfurl: false, feedImage: true, limit: 6 }),
  france24: Object.freeze({ url: 'https://www.france24.com/en/middle-east/rss', label: 'France 24', unfurl: false, limit: 6 }),
  asharq: Object.freeze({ url: 'https://english.aawsat.com/feed', label: 'Asharq Al-Awsat', unfurl: false, limit: 8 }),
  national: Object.freeze({ url: 'https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml', label: 'The National', unfurl: false, limit: 6 }),
  almonitor: Object.freeze({ url: 'https://www.al-monitor.com/rss', label: 'Al-Monitor', unfurl: false, limit: 5 }),
  // Spravodajstvo OSN — štítok „OSN", nie nezávislé médium.
  unnews: Object.freeze({ url: 'https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml', label: 'UN News', unfurl: false, badge: 'un', limit: 5 }),
  toi: Object.freeze({ url: 'https://www.timesofisrael.com/feed/', label: 'The Times of Israel', unfurl: false, limit: 6 }),
  haaretz: Object.freeze({ url: 'https://www.haaretz.com/srv/haaretz-latest-headlines', label: 'Haaretz', unfurl: false, limit: 6 }),
  // Štátna agentúra Libanonu (nie je na žiadnom zozname EÚ) — tvrdenie štátu, nie overenie;
  // štítok ako Ukrinform/ArmyInform pri UKRAJINE.
  nna: Object.freeze({ url: 'https://www.nna-leb.gov.lb/en/rss', label: 'NNA Lebanon', unfurl: false, badge: 'official-lb', limit: 6 }),
  // Londýnska exilová stanica (financovanie nezverejnené — uvedené v DATA_SOURCES.md): štítok „exilové".
  iranintl: Object.freeze({ url: 'https://www.iranintl.com/en/feed', label: 'Iran International', unfurl: false, badge: 'exile', limit: 6 }),
});

/**
 * Named regions → a GDELT query (+ a Google News RSS fallback query). Named (not
 * free-text) so the client can never inject an arbitrary query through the proxy.
 * `rssQuery` is used when GDELT is throttled/unavailable; kept separate because
 * the two engines' query syntaxes differ subtly (both here happen to accept
 * quoted phrases + OR).
 * @type {Readonly<Record<string, {id: string, query: string, rssQuery: string, timespan: string}>>}
 */
export const SITUATION_REGIONS = Object.freeze({
  gulf: Object.freeze({
    id: 'gulf',
    query: '"Strait of Hormuz" OR "Persian Gulf" OR "Gulf of Oman"',
    rssQuery: '"Strait of Hormuz" OR "Persian Gulf" OR "Gulf of Oman"',
    timespan: '3d',
    // Direct publisher RSS: real article URLs (not Google-News redirects), so the
    // og:image unfurl and link-out work → cards can show photos. Keyword-filtered
    // to the region on the server; only incident-classified items become markers.
    directRss: Object.freeze([
      MIDEAST_FEEDS.bbc,
      // Al Jazeera bez og:image (T&C zakazujú scraping — zistené pri UKRAJINE 2026-09-19,
      // zosúladené pre Blízky východ 2026-09-26): len titulok a odkaz.
      MIDEAST_FEEDS.aljazeera,
    ]),
    match: 'hormuz|persian gulf|arabian gulf|gulf of oman|red sea|bab[- ]?el[- ]?mandeb|houthi|bandar abbas|fujairah|kharg|bushehr|jebel ali|ras tanura|\\btanker|\\bwarship|shipping lane|ship-to-ship',
  }),
  // Wider Middle East conflict "mini bulletin" (2026-09-18): one broad feed over
  // Hormuz + Red Sea/Bab-el-Mandeb + Suez + Yemen + Iran + Israel/Gaza/Levant.
  // Incidents geolocate to their named place via the expanded gazetteer.
  mideast: Object.freeze({
    id: 'mideast',
    query: '"Strait of Hormuz" OR "Red Sea" OR "Bab el-Mandeb" OR "Suez Canal" OR "Gulf of Aden" OR Houthi OR "Persian Gulf" OR "Gulf of Oman"',
    rssQuery: '"Red Sea" OR "Strait of Hormuz" OR "Suez Canal" OR "Bab el-Mandeb" OR Houthi OR Yemen OR Iran Israel',
    timespan: '2d',
    directRss: Object.freeze([
      MIDEAST_FEEDS.bbc,
      MIDEAST_FEEDS.aljazeera,
      MIDEAST_FEEDS.asharq,
      MIDEAST_FEEDS.guardian,
      MIDEAST_FEEDS.france24,
    ]),
    match: 'hormuz|persian gulf|arabian gulf|gulf of oman|red sea|bab[- ]?el[- ]?mandeb|gulf of aden|houthi|\\byemen\\b|hodeidah|hudaydah|sana|\\baden\\b|mokha|djibouti|suez|port said|ismailia|bandar abbas|fujairah|kharg|bushehr|\\bgaza\\b|ashkelon|tel aviv|\\beilat\\b|haifa|jerusalem|beirut|damascus|\\btehran\\b|isfahan|natanz|baghdad|\\biran\\b|\\bisrael\\b|hezbollah|\\btanker|\\bwarship',
  }),
  // UKRAJINA (2026-09-19, etapa 2; plán docs/drafts/ukrajina-plan.md kap. 2.3):
  // front a údery, len ANGLICKÉ zdroje (preklad cez /api/translate ide EN→SK).
  // Priame RSS nesú pravidlá po zdrojoch (normalizeDirectFeed): obrázok len tam,
  // kde to podmienky dovoľujú (BBC, Kyiv Independent); Ukrajinska Pravda bez
  // položiek Interfax-Ukraine (zákaz šírenia) a bez obrázkov (Getty); RFE/RL bez
  // obrázkov (fotoklauzula); Al Jazeera bez og:image (T&C zakazujú scraping);
  // štátne agentúry so štítkom „oficiálne UA". Blocklist médií (sanctionedMedia.js:
  // príloha XV + Rybar; od 2026-09-26 aj Irán/Jemen/Libanon/Palestína podľa
  // zmrazenia aktív) platí na serveri aj na klientovi pre VŠETKY regióny. TASS
  // zámerne NIE JE (otázka č. 4 plánu); ruské médiá prílohy XV nikdy. ISW denné
  // hodnotenie ide ako jedna pripnutá položka s odkazom von (proxy, `isw: true`).
  ukraine: Object.freeze({
    id: 'ukraine',
    query: '(Ukraine OR Ukrainian OR Kharkiv OR Donetsk OR Zaporizhzhia OR Kherson OR Kyiv OR Sumy) (strike OR shelling OR drone OR missile OR offensive OR frontline OR captured OR advance OR attack) sourcelang:english',
    rssQuery: 'Ukraine war front strike drone',
    timespan: '2d',
    // `limit` = najviac položiek z jedného zdroja (2026-09-19 naživo: Ukrinform
    // a Ukrajinska Pravda dávajú desiatky správ denne a vytlačili BBC, RFE/RL
    // aj DW z prvej štyridsiatky úplne); Google News tiež so stropom.
    directRss: Object.freeze([
      Object.freeze({ url: 'https://feeds.bbci.co.uk/news/topics/c1vw6q14rzqt/rss.xml', label: 'BBC News', unfurl: true, limit: 8 }),
      Object.freeze({ url: 'https://kyivindependent.com/news-archive/rss/', label: 'The Kyiv Independent', unfurl: true, limit: 8 }),
      Object.freeze({ url: 'https://www.pravda.com.ua/eng/rss/view_news/', label: 'Ukrainska Pravda', unfurl: false, drop: 'interfax[- ]ukraine', limit: 8 }),
      Object.freeze({ url: 'https://www.ukrinform.net/rss/rubric-ato', label: 'Ukrinform', unfurl: false, feedImage: true, badge: 'official-ua', limit: 8 }),
      Object.freeze({ url: 'https://armyinform.com.ua/en/feed/', label: 'ArmyInform', unfurl: false, badge: 'official-ua', limit: 4 }),
      Object.freeze({ url: 'https://www.rferl.org/api/zviipl-vomx-tpeugmm', label: 'RFE/RL', unfurl: false, limit: 8 }),
      Object.freeze({ url: 'https://rss.dw.com/rdf/rss-en-all', label: 'DW', unfurl: false, limit: 6 }),
      Object.freeze({ url: 'https://www.aljazeera.com/xml/rss/all.xml', label: 'Al Jazeera', unfurl: false, limit: 6 }),
      // Doplnené 2026-09-19 („fotky z čo najviac zdrojov"): Guardian a Meduza
      // dávajú náhľad do feedu (media:content / share card) → feedImage; Kyiv
      // Post („photographs … may not be reproduced", Interfax-Ukraine zákaz) a
      // Euromaidan Press („extended reproduction … without permission") bez obrázka.
      Object.freeze({ url: 'https://www.theguardian.com/world/ukraine/rss', label: 'The Guardian', unfurl: false, feedImage: true, limit: 6 }),
      Object.freeze({ url: 'https://meduza.io/rss/en/all', label: 'Meduza', unfurl: false, feedImage: true, limit: 5 }),
      Object.freeze({ url: 'https://www.kyivpost.com/feed', label: 'Kyiv Post', unfurl: false, drop: 'interfax[- ]ukraine', limit: 6 }),
      Object.freeze({ url: 'https://euromaidanpress.com/feed/', label: 'Euromaidan Press', unfurl: false, limit: 4 }),
    ]),
    googleLimit: 12,
    match: 'ukrain|kyiv|kiev|kharkiv|donetsk|luhansk|zaporizh|kherson|\\bsumy\\b|odesa|odessa|mykolaiv|\\bdnipro\\b|kryvyi rih|poltava|chernihiv|zhytomyr|vinnytsia|\\blviv\\b|crimea|sevastopol|donbas|pokrovsk|kupiansk|kupyansk|\\blyman\\b|kramatorsk|sloviansk|kostiantynivka|kostyantynivka|toretsk|chasiv yar|huliaipole|hulyaipole|orikhiv|vovchansk|belgorod|kursk|bryansk|voronezh|rostov|taganrog|novorossiysk|black sea|sea of azov|shahed|iskander|kinzhal|zelensk|russian (?:forces|troops|army|drones?|missiles?|attack|strike)|general staff',
    isw: true,
  }),
  // BLÍZKY VÝCHOD po dejiskách (etapa 3, 2026-09-26): jeden región správ na dejisko
  // (mideastTheatres.js `newsRegion`), aby Libanon neukazoval Jemen a Gaza nie Irán.
  // `match` filtruje titulky priamych RSS (sonda 26. 9.: z 14 feedov nad týmito
  // výrazmi; IAEA nedala nič, DW len 1 — nezaradené). Asharq má 300 položiek, preto
  // limit; „Saudi/Riyadh" v Jemene NIE je (chytalo domáce saudské správy).
  iran: Object.freeze({
    id: 'iran',
    query: '(Iran OR Iranian OR Tehran OR Isfahan OR Natanz OR Fordow OR Bushehr OR IRGC) (strike OR airstrike OR attack OR missile OR drone OR explosion OR nuclear OR ceasefire) sourcelang:english',
    rssQuery: 'Iran strike OR attack OR missile OR drone OR IRGC OR nuclear',
    timespan: '2d',
    directRss: Object.freeze([
      MIDEAST_FEEDS.bbc, MIDEAST_FEEDS.iranintl, MIDEAST_FEEDS.asharq, MIDEAST_FEEDS.almonitor,
      MIDEAST_FEEDS.france24, MIDEAST_FEEDS.national, MIDEAST_FEEDS.guardian, MIDEAST_FEEDS.aljazeera,
    ]),
    googleLimit: 15,
    match: 'iran|tehran|isfahan|esfahan|natanz|fordow|bandar abbas|bushehr|kharg|tabriz|shiraz|mashhad|kermanshah|ahvaz|chabahar|parchin|qeshm|\\bjask\\b|\\bqom\\b|\\barak\\b|\\birgc\\b|revolutionary guard',
  }),
  lebanon: Object.freeze({
    id: 'lebanon',
    query: '(Lebanon OR Lebanese OR Hezbollah OR Beirut OR Nabatieh OR "Bint Jbeil" OR Litani OR UNIFIL) (strike OR airstrike OR attack OR rocket OR drone OR shelling OR ceasefire OR killed) sourcelang:english',
    rssQuery: 'Lebanon OR Hezbollah strike OR attack OR drone OR ceasefire',
    timespan: '2d',
    directRss: Object.freeze([
      MIDEAST_FEEDS.bbc, MIDEAST_FEEDS.nna, MIDEAST_FEEDS.asharq, MIDEAST_FEEDS.haaretz,
      MIDEAST_FEEDS.national, MIDEAST_FEEDS.unnews, MIDEAST_FEEDS.france24, MIDEAST_FEEDS.aljazeera,
    ]),
    googleLimit: 15,
    match: 'leban|hezbollah|hizballah|beirut|litani|\\btyre\\b|nabatieh|bint jbeil|khiam|sidon|marjayoun|bekaa|baalbek|unifil|naqoura|dahieh|dahiyeh',
  }),
  palestine: Object.freeze({
    id: 'palestine',
    query: '(Gaza OR "West Bank" OR Rafah OR "Khan Younis" OR Jenin OR Nablus OR Hebron OR Hamas OR UNRWA) (strike OR airstrike OR attack OR raid OR killed OR ceasefire OR aid OR settlers) sourcelang:english',
    rssQuery: 'Gaza OR "West Bank" strike OR attack OR raid OR ceasefire OR aid',
    timespan: '2d',
    directRss: Object.freeze([
      MIDEAST_FEEDS.bbc, MIDEAST_FEEDS.unnews, MIDEAST_FEEDS.guardian, MIDEAST_FEEDS.france24,
      MIDEAST_FEEDS.toi, MIDEAST_FEEDS.haaretz, MIDEAST_FEEDS.asharq, MIDEAST_FEEDS.aljazeera,
    ]),
    googleLimit: 15,
    match: 'gaza|west bank|rafah|khan yunis|khan younis|deir al-balah|jabalia|beit lahia|beit hanoun|jenin|nablus|hebron|tulkarm|ramallah|tubas|qalqilya|bethlehem|jericho|hamas|\\bunrwa\\b',
  }),
  israel: Object.freeze({
    id: 'israel',
    query: '(Israel OR Israeli OR "Tel Aviv" OR Haifa OR Jerusalem OR Eilat OR Golan OR "Iron Dome") (missile OR rocket OR drone OR sirens OR interception OR attack OR strike OR explosion) sourcelang:english',
    rssQuery: 'Israel missile OR rocket OR drone OR sirens OR interception OR attack',
    timespan: '2d',
    directRss: Object.freeze([
      MIDEAST_FEEDS.bbc, MIDEAST_FEEDS.toi, MIDEAST_FEEDS.haaretz, MIDEAST_FEEDS.france24,
      MIDEAST_FEEDS.guardian, MIDEAST_FEEDS.national, MIDEAST_FEEDS.asharq, MIDEAST_FEEDS.aljazeera,
    ]),
    googleLimit: 15,
    match: 'israel|tel aviv|haifa|jerusalem|eilat|ashkelon|ashdod|beersheba|dimona|negev|galilee|golan|kiryat shmona|metula|nahariya|safed|sderot|nevatim|iron dome|home front command',
  }),
  redsea: Object.freeze({
    id: 'redsea',
    query: '(Houthi OR Houthis OR Yemen OR Hodeidah OR Sanaa OR "Red Sea" OR "Bab el-Mandeb" OR "Gulf of Aden") (strike OR airstrike OR attack OR missile OR drone OR ship OR vessel OR tanker) sourcelang:english',
    rssQuery: 'Houthi OR Yemen OR "Red Sea" strike OR attack OR missile OR ship',
    timespan: '2d',
    directRss: Object.freeze([
      MIDEAST_FEEDS.bbc, MIDEAST_FEEDS.asharq, MIDEAST_FEEDS.national, MIDEAST_FEEDS.unnews,
      MIDEAST_FEEDS.france24, MIDEAST_FEEDS.almonitor, MIDEAST_FEEDS.aljazeera,
    ]),
    googleLimit: 15,
    match: 'houthi|ansar ?allah|yemen|\\bsanaa\\b|sana\'a|hodeidah|hudaydah|\\baden\\b|marib|taiz|mokha|saada|red sea|bab[- ]?el[- ]?mandeb|bab al-mandab|gulf of aden|jizan|jazan|najran',
  }),
  syria: Object.freeze({
    id: 'syria',
    query: '(Syria OR Syrian OR Damascus OR Aleppo OR Homs OR Idlib OR Latakia OR Daraa OR Suwayda OR Quneitra OR SDF) (strike OR airstrike OR attack OR clashes OR drone OR shelling OR explosion OR killed) sourcelang:english',
    rssQuery: 'Syria strike OR attack OR clashes OR drone OR explosion',
    timespan: '2d',
    directRss: Object.freeze([
      MIDEAST_FEEDS.bbc, MIDEAST_FEEDS.asharq, MIDEAST_FEEDS.france24, MIDEAST_FEEDS.national,
      MIDEAST_FEEDS.unnews, MIDEAST_FEEDS.haaretz, MIDEAST_FEEDS.aljazeera,
    ]),
    googleLimit: 15,
    match: 'syria|damascus|aleppo|\\bhoms\\b|\\bhama\\b|idlib|latakia|tartus|quneitra|daraa|deraa|suwayda|sweida|raqqa|deir ez-zor|deir ezzor|hasakah|qamishli|kobani|\\bsdf\\b',
  }),
  iraq: Object.freeze({
    id: 'iraq',
    query: '(Iraq OR Iraqi OR Baghdad OR Erbil OR Basra OR Kirkuk OR Mosul OR "Ain al-Asad") (strike OR airstrike OR attack OR drone OR rocket OR explosion OR militia) sourcelang:english',
    rssQuery: 'Iraq strike OR attack OR drone OR rocket OR militia',
    timespan: '2d',
    directRss: Object.freeze([
      MIDEAST_FEEDS.bbc, MIDEAST_FEEDS.asharq, MIDEAST_FEEDS.national, MIDEAST_FEEDS.almonitor,
      MIDEAST_FEEDS.france24, MIDEAST_FEEDS.aljazeera,
    ]),
    googleLimit: 15,
    match: 'iraq|baghdad|erbil|basra|mosul|kirkuk|anbar|ain al-asad|kataib hezbollah|popular mobili[sz]ation|\\bpmf\\b|kurdistan region',
  }),
});

/**
 * Priamy RSS zdroj ako objekt s pravidlami (reťazec = staršie regióny: bez
 * pravidiel, obrázok povolený). Pure.
 * @param {string|{url:string,label?:string,unfurl?:boolean,drop?:string,badge?:string}} entry
 * @returns {{url:string,label:string|null,unfurl:boolean,drop:RegExp|null,badge:string|null}|null}
 */
export function normalizeDirectFeed(entry) {
  if (typeof entry === 'string') return { url: entry, label: null, unfurl: true, feedImage: true, drop: null, badge: null, limit: 60 };
  if (!entry || typeof entry.url !== 'string' || !/^https?:\/\//.test(entry.url)) return null;
  let drop = null;
  if (entry.drop) { try { drop = new RegExp(String(entry.drop), 'i'); } catch { drop = null; } }
  const limit = Number.isFinite(entry.limit) && entry.limit > 0 ? Math.floor(entry.limit) : 60;
  const unfurl = entry.unfurl !== false;
  // `feedImage` (2026-09-19): náhľad, ktorý redakcia sama dáva do feedu, je
  // dovolený aj tam, kde og:image scraping nie (Ukrinform, Guardian, Meduza).
  return { url: entry.url, label: entry.label || null, unfurl, feedImage: unfurl || entry.feedImage === true, drop, badge: entry.badge || null, limit };
}

/** Keyless GDELT DOC 2.0 article-list endpoint for a query. */
export function gdeltDocUrl(query, { timespan = '3d', maxrecords = 30 } = {}) {
  const params = new URLSearchParams({
    query: String(query),
    mode: 'artlist',
    maxrecords: String(Math.max(1, Math.min(75, Math.floor(maxrecords)))),
    format: 'json',
    sort: 'datedesc',
    timespan: String(timespan),
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

/** GDELT `seendate` (`YYYYMMDDTHHMMSSZ` / `YYYYMMDDHHMMSS`) → epoch ms, or null. */
export function parseGdeltDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * GDELT DOC artlist JSON → normalized, deduped items (newest first). Pure.
 * @param {any} json
 * @returns {Array<{title:string, url:string, source:string, publishedAt:number|null, image:string|null, lang:string|null, country:string|null}>}
 */
export function parseGdeltArticles(json) {
  const arr = Array.isArray(json?.articles) ? json.articles : [];
  const seen = new Set();
  const out = [];
  for (const a of arr) {
    const url = typeof a?.url === 'string' ? a.url.trim() : '';
    const title = typeof a?.title === 'string' ? a.title.trim() : '';
    if (!/^https?:\/\//.test(url) || !title || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title,
      url,
      source: typeof a?.domain === 'string' ? a.domain : '',
      publishedAt: parseGdeltDate(a?.seendate),
      image: typeof a?.socialimage === 'string' && /^https?:\/\//.test(a.socialimage) ? a.socialimage : null,
      lang: typeof a?.language === 'string' ? a.language : null,
      country: typeof a?.sourcecountry === 'string' ? a.sourcecountry : null,
    });
  }
  out.sort((x, y) => (y.publishedAt || 0) - (x.publishedAt || 0));
  return out;
}

/** A direct article URL (usable for og:image unfurl / link-out) vs a Google-News redirect. Pure. */
export function isDirectNewsUrl(url) {
  try { return !/(?:^|\.)news\.google\.com$/i.test(new URL(String(url)).hostname); } catch { return false; }
}

/** Collapse-key for the same story across sources (drops a trailing " - Outlet"). */
function newsStoryKey(title) {
  return String(title || '').toLowerCase().replace(/\s+[-–—]\s+[^-–—]{2,42}$/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

/**
 * Merge news items from several sources into one deduped list. When the same
 * story appears more than once, keep the most useful copy — one that carries an
 * image beats one with a direct URL beats a bare Google-News redirect, then newer
 * wins. Newest first. Pure.
 * @param {Array<Array>} lists
 * @returns {Array}
 */
export function mergeNewsItems(lists) {
  const byKey = new Map();
  const score = (it) => (it?.image ? 2 : 0) + (isDirectNewsUrl(it?.url) ? 1 : 0);
  for (const list of (Array.isArray(lists) ? lists : [])) {
    for (const it of (Array.isArray(list) ? list : [])) {
      if (!it?.title || !it?.url) continue;
      const k = newsStoryKey(it.title);
      if (!k) continue;
      const prev = byKey.get(k);
      if (!prev
        || score(it) > score(prev)
        || (score(it) === score(prev) && (it.publishedAt || 0) > (prev.publishedAt || 0))) {
        byKey.set(k, it);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
}

/** Compact "how long ago" label via i18n keys situation.ago-*. */
export function relativeAge(publishedAt, nowMs, translate = (k) => k) {
  if (!Number.isFinite(publishedAt)) return '';
  const mins = Math.max(0, Math.round((nowMs - publishedAt) / 60_000));
  if (mins < 1) return translate('situation.now');
  if (mins < 60) return translate('situation.ago-m', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return translate('situation.ago-h', { n: hours });
  return translate('situation.ago-d', { n: Math.round(hours / 24) });
}

/**
 * Display model for the situation feed. Pure.
 * @param {{items?: any[], region?: string, fetchedAt?: number}|null} payload
 * @param {{translate?: (k:string,v?:object)=>string, nowMs?: number, limit?: number}} [o]
 */
export function buildSituationModel(payload, { translate = (k) => k, nowMs = Date.now(), limit = 30 } = {}) {
  // Blocklist prílohy XV ešte raz na klientovi (server filtruje tiež) — keby
  // niekedy prišla cache spred zmeny zoznamu.
  const items = filterSanctionedNews(Array.isArray(payload?.items) ? payload.items : []).items
    .slice(0, limit)
    .map((it) => ({ ...it, ageLabel: relativeAge(it.publishedAt, nowMs, translate) }));
  return {
    ok: true,
    items,
    count: items.length,
    empty: items.length === 0,
    region: payload?.region || null,
    fetchedAt: payload?.fetchedAt ?? null,
  };
}

/**
 * Fetch a region's feed from the proxy. Proxy error = throw; 502/503 carries
 * `{error:'…'}`.
 * @param {string} region
 * @param {{fetcher?: typeof fetch, base?: string}} [o]
 */
export async function fetchSituationNews(region = 'gulf', { fetcher = (...a) => fetch(...a), base = SITUATION_NEWS_API } = {}) {
  const url = `${base}?region=${encodeURIComponent(region)}`;
  const response = await fetcher(url, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return json;
}
