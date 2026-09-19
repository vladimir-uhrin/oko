// src/data/ukraineMedia.js
/**
 * @module ukraineMedia
 * @description Fotky a videá k udalostiam modulu UKRAJINA (etapa 3a, 2026-09-19;
 * pokyn používateľa: „zdroje a fotky z čo najviac relevantných zdrojov … aj videá
 * a všetko ukladať, aby to bolo v časovej osi"). Tri druhy prítokov, každý s
 * podmienkami overenými 19. 9. 2026 (DATA_SOURCES.md):
 *
 *  - YouTube kanály spravodajských redakcií a oficiálnych ukrajinských zdrojov
 *    cez OFICIÁLNY feed kanála (`/feeds/videos.xml?channel_id=`): náhľad
 *    `i.ytimg.com` + vložený prehrávač `youtube-nocookie.com` (načíta sa až po
 *    kliknutí, nikdy sa nesťahuje video). Svetové redakcie sa filtrujú regexom
 *    regiónu (titulok + popis), ukrajinské nie.
 *  - Verejné náhľady oficiálnych Telegram kanálov štátnych orgánov Ukrajiny
 *    (`t.me/s/<kanál>`): fotky z CDN náhľadu, videá len ako náhľadový obrázok +
 *    oficiálny embed widget príspevku (core.telegram.org/widgets/post). Preposlané
 *    príspevky (často brigády = jednotky) sa vynechávajú — etická čiara.
 *  - ArmyInform (CC BY 4.0) — ukrajinský feed nesie video prílohy mp4, hrajú sa
 *    priamo s atribúciou.
 *
 * Ukrajinský text (Telegram, ArmyInform) sa klasifikuje vlastnými pravidlami a
 * kotví cez azbukové kmene sídel z gazetteeru (`\b` pred azbukou v JS nesedí —
 * lookbehind). Modul je čistý (bez DOM/Cesia); proxy aj klient ho zdieľajú.
 */
import { UKRAINE_GAZETTEER } from './ukraineIncidents.js';

/** Regex regiónu pre svetové kanály (rovnaká rodina ako situationNews.ukraine.match). */
export const UKRAINE_MEDIA_MATCH = /ukrain|kyiv|kiev|kharkiv|donetsk|luhansk|zaporizh|kherson|\bsumy\b|odesa|odessa|mykolaiv|\bdnipro\b|kryvyi rih|poltava|chernihiv|crimea|sevastopol|donbas|pokrovsk|kupiansk|\blyman\b|kramatorsk|sloviansk|kostiantynivka|toretsk|chasiv yar|huliaipole|orikhiv|vovchansk|belgorod|kursk|bryansk|black sea|shahed|iskander|kinzhal|zelensk|russian (?:forces|troops|army|drones?|missiles?|attack|strike)|general staff/i;

/**
 * YouTube kanály (ID overené 19. 9. 2026 z `externalId` stránky kanála).
 * `filter: true` = svetová redakcia, berú sa len videá o Ukrajine.
 */
export const YOUTUBE_CHANNELS = Object.freeze([
  Object.freeze({ id: 'UCGAC5yzlYgjKoJABDZ7zEyw', label: 'Kyiv Independent', filter: false }),
  Object.freeze({ id: 'UCPY6gj8G7dqwPxg9KwHrj5Q', label: 'Суспільне Новини', filter: false, lang: 'uk' }),
  Object.freeze({ id: 'UCX-xHRN9CnoXto5gcPskANA', label: 'UNITED24', filter: false, badge: 'official-ua' }),
  Object.freeze({ id: 'UC16niRr50-MSBwiO3YDb3RA', label: 'BBC News', filter: true }),
  Object.freeze({ id: 'UChqUTb7kYRX8-EiaN3XFrSQ', label: 'Reuters', filter: true }),
  Object.freeze({ id: 'UC52X5wxOL_s5yw0dQk7NtgA', label: 'Associated Press', filter: true }),
  Object.freeze({ id: 'UCknLrEdhRCp1aegoMqRaCZg', label: 'DW News', filter: true }),
  Object.freeze({ id: 'UCoMdktPbSTixAyNGwb-UYkQ', label: 'Sky News', filter: true }),
  Object.freeze({ id: 'UCSrZ3UV4jOidv8ppoVuvW9Q', label: 'euronews', filter: true }),
]);
export const youtubeFeedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

/** Oficiálne Telegram kanály štátnych orgánov Ukrajiny (verejný náhľad t.me/s/). */
export const TELEGRAM_CHANNELS = Object.freeze([
  Object.freeze({ name: 'GeneralStaffZSU', label: 'Генштаб ЗСУ', badge: 'official-ua' }),
  Object.freeze({ name: 'ministry_of_defense_ua', label: 'Міноборони України', badge: 'official-ua' }),
  Object.freeze({ name: 'dsns_telegram', label: 'ДСНС України', badge: 'official-ua' }),
  Object.freeze({ name: 'kpszsu', label: 'Повітряні сили ЗСУ', badge: 'official-ua' }),
]);
export const telegramPreviewUrl = (name) => `https://t.me/s/${encodeURIComponent(name)}`;
export const ARMYINFORM_UA_FEED = 'https://armyinform.com.ua/feed/';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** HTML entity → znak (pomenované základné + číselné). Pure. */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') { const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}
/** HTML → čistý text (br/div = nový riadok, ostatné značky preč, medzery zložené). Pure. */
export function stripTags(html) {
  return decodeEntities(String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(?:div|p)(?:\s[^>]*)?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

// ── YouTube ───────────────────────────────────────────────────────────────
/**
 * Atom feed kanála → videá `{kind:'video', provider:'youtube', videoId, url, embed,
 * thumb, title, description, publishedAt, channel, badge}`. Pure.
 */
export function parseYoutubeFeed(xml, channel = {}) {
  const out = [];
  const entries = String(xml ?? '').match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const entry of entries) {
    const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry)?.[1]?.trim();
    if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) continue;
    const title = stripTags(/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] || '');
    const publishedAt = Date.parse(/<published>([^<]+)<\/published>/.exec(entry)?.[1] || '');
    const description = stripTags(/<media:description>([\s\S]*?)<\/media:description>/.exec(entry)?.[1] || '');
    const thumb = /<media:thumbnail[^>]+url="([^"]+)"/.exec(entry)?.[1] || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    if (!title || !Number.isFinite(publishedAt)) continue;
    if (channel.filter && !UKRAINE_MEDIA_MATCH.test(`${title} ${description}`)) continue;
    out.push({
      kind: 'video', provider: 'youtube', id: `yt:${videoId}`, videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      embed: `https://www.youtube-nocookie.com/embed/${videoId}`,
      thumb: decodeEntities(thumb), title, description: clip(description, 300), publishedAt,
      channel: channel.label || stripTags(/<author>\s*<name>([^<]*)<\/name>/.exec(entry)?.[1] || ''),
      badge: channel.badge || null, lang: channel.lang || 'en',
    });
  }
  return out;
}

// ── Telegram ──────────────────────────────────────────────────────────────
const bgUrls = (html, cls) => {
  const out = [];
  const re = new RegExp(`class="${cls}[^"]*"[^>]*background-image:url\\('([^']+)'\\)`, 'g');
  let m; while ((m = re.exec(html))) out.push(decodeEntities(m[1]));
  return out;
};
/**
 * Verejný náhľad `t.me/s/<kanál>` → príspevky `{kind:'photo'|'video'|'text',
 * provider:'telegram', id:'tg:<kanál>/<id>', url, embed, thumb, photos, videos,
 * text, publishedAt, channel, badge}`. Preposlané príspevky sa vynechávajú.
 * Pure — HTML štruktúra Telegramu sa môže zmeniť (test drží vzorku z 19. 9. 2026).
 */
export function parseTelegramPreview(html, channel = {}) {
  const out = [];
  const blocks = String(html ?? '').split(/<div class="tgme_widget_message_wrap/).slice(1);
  for (const block of blocks) {
    const post = /data-post="([^"]+)"/.exec(block)?.[1];
    if (!post || !/^[\w]+\/\d+$/.test(post)) continue;
    if (/tgme_widget_message_forwarded_from/.test(block)) continue;
    const publishedAt = Date.parse(/<time datetime="([^"]+)"/.exec(block)?.[1] || '');
    if (!Number.isFinite(publishedAt)) continue;
    const textHtml = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div class="tgme_widget_message_(?!text))/.exec(block)?.[1] || /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1] || '';
    const text = stripTags(textHtml.replace(/<div class="tgme_widget_message_text[^"]*"[^>]*>/g, ''));
    const photos = bgUrls(block, 'tgme_widget_message_photo_wrap');
    const videoThumbs = bgUrls(block, 'tgme_widget_message_video_thumb');
    const videos = (block.match(/tgme_widget_message_video_player|tgme_widget_message_video_wrap/g) || []).length || videoThumbs.length;
    const kind = videos ? 'video' : (photos.length ? 'photo' : 'text');
    const [name, id] = post.split('/');
    out.push({
      kind, provider: 'telegram', id: `tg:${post}`, postId: Number(id),
      url: `https://t.me/${name}/${id}`,
      embed: `https://t.me/${name}/${id}?embed=1&mode=tme`,
      thumb: videoThumbs[0] || photos[0] || null,
      photos: photos.slice(0, 8), videos,
      text: clip(text, 400), publishedAt,
      channel: channel.label || name, badge: channel.badge || null, lang: 'uk',
    });
  }
  return out;
}

// ── ArmyInform video prílohy ──────────────────────────────────────────────
/** RSS položky s `enclosure type="video/mp4"` → videá (CC BY 4.0, priame prehratie). Pure. */
export function parseRssVideoEnclosures(xml, { label = 'ArmyInform', badge = 'official-ua' } = {}) {
  const out = [];
  const items = String(xml ?? '').match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const item of items) {
    const enc = /<enclosure[^>]+url="([^"]+)"[^>]*type="video\/[^"]*"/.exec(item) || /<enclosure[^>]+type="video\/[^"]*"[^>]*url="([^"]+)"/.exec(item);
    if (!enc) continue;
    const videoUrl = decodeEntities(enc[1]);
    if (!/^https?:\/\//.test(videoUrl)) continue;
    const title = stripTags((/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(item)?.[1] || ''));
    const url = decodeEntities((/<link>([^<]+)<\/link>/.exec(item)?.[1] || '').trim());
    const publishedAt = Date.parse(/<pubDate>([^<]+)<\/pubDate>/.exec(item)?.[1] || '');
    if (!title || !url || !Number.isFinite(publishedAt)) continue;
    out.push({ kind: 'video', provider: 'file', id: `ai:${url}`, url, embed: null, videoUrl, thumb: null, title, description: '', publishedAt, channel: label, badge, lang: 'uk' });
  }
  return out;
}

// ── Ukrajinský text: miesto a typ ─────────────────────────────────────────
/**
 * Azbukové kmene sídel gazetteeru (kľúč = `name` v UKRAINE_GAZETTEER). Kmeň je
 * regex bez okrajov; matcher dovolí až 5 písmen pádovej koncovky. Oblasti sú
 * samostatné položky (Харківщина ≠ Харків).
 */
export const UK_PLACE_STEMS = Object.freeze({
  Pokrovsk: 'Покровськ', Myrnohrad: 'Мирноград', Dobropillia: 'Добропілл', Kostiantynivka: 'Костянтинівк', 'Chasiv Yar': 'Час[оі]в[а-я]* Яр', Toretsk: 'Торецьк', Bakhmut: 'Бахмут', Siversk: 'Сіверськ',
  Lyman: 'Лиман', Sloviansk: "Слов['’ʼ]янськ", Kramatorsk: 'Краматорськ', Druzhkivka: 'Дружківк', Kupiansk: "Куп['’ʼ]янськ", Izium: 'Ізюм', Borova: 'Боров(?:а|ої|ій|у)', Vovchansk: 'Вовчанськ',
  Huliaipole: 'Гуляйпол', Orikhiv: 'Оріх[іо]в', 'Velyka Novosilka': 'Велик[а-я]* Новосілк', Vuhledar: 'Вугледар', Kurakhove: 'Курахов', Avdiivka: 'Авдіївк', Donetsk: 'Донецьк', Horlivka: 'Горлівк',
  Mariupol: 'Маріупол', Berdiansk: 'Бердянськ', Melitopol: 'Мелітопол', 'Enerhodar (Zaporizhzhia NPP)': 'Енергодар|ЗАЕС', Luhansk: 'Луганськ', Sievierodonetsk: 'Сєвєродонецьк', Kherson: 'Херсон',
  'Nova Kakhovka': 'Нов[а-я]* Каховк', Oleshky: 'Олешк', Zaporizhzhia: 'Запоріжж', Nikopol: 'Нікопол', Dnipro: 'Дніпр(?:о|а|і|ом)', 'Kryvyi Rih': 'Крив[а-я]* Р[іо]г|Кривбас', Pavlohrad: 'Павлоград', Kremenchuk: 'Кременчу',
  Mykolaiv: 'Миколаїв|Миколаєв', Odesa: 'Одес', Chornomorsk: 'Чорноморськ', Izmail: 'Ізмаїл', Reni: 'Рені', Kharkiv: 'Харк[іо]в', Chuhuiv: 'Чугу[їє]в', Sumy: 'Сум(?:и|ах|ами)', Konotop: 'Конотоп', Shostka: 'Шостк',
  Poltava: 'Полтав', Chernihiv: 'Черніг[іо]в', Kyiv: 'Ки[єї]в', 'Bila Tserkva': 'Біл[а-я]* Церкв', Zhytomyr: 'Житомир', Vinnytsia: 'Вінниц', Cherkasy: 'Черкас', Kropyvnytskyi: 'Кропивницьк', Khmelnytskyi: 'Хмельницьк',
  Ternopil: 'Терноп[іо]л', Rivne: 'Рівн(?:е|ого|ому|ім)', Lutsk: 'Луцьк', Lviv: 'Льв[іо]в', 'Ivano-Frankivsk': 'Івано-Франківськ', Uzhhorod: 'Ужгород', Chernivtsi: 'Чернівц', Sevastopol: 'Севастопол', Simferopol: 'Сімферопол',
  Feodosia: 'Феодос', Kerch: 'Керч', Dzhankoi: 'Джанко', Saky: 'Сак(?:и|ах|ами)', Yevpatoria: 'Євпатор', Belgorod: 'Б[єе]лгород', Shebekino: 'Шебекін', Kursk: 'Курськ', Sudzha: 'Судж', Bryansk: 'Брянськ', Voronezh: 'Воронеж|Вороніж',
  'Rostov-on-Don': 'Ростов', Taganrog: 'Таганро', Novorossiysk: 'Новоросійськ', Tuapse: 'Туапсе', Engels: 'Енгельс', Ryazan: 'Рязан', Moscow: 'Москв', Donbas: 'Донбас', Crimea: 'Крим', 'Black Sea': 'Чорн[а-я]* мор', 'Sea of Azov': 'Азовськ[а-я]* мор',
  'Kharkiv Oblast': 'Харківщин|Харківськ[а-я]* област', 'Sumy Oblast': 'Сумщин|Сумськ[а-я]* област', 'Donetsk Oblast': 'Донеччин|Донецьк[а-я]* област', 'Zaporizhzhia Oblast': 'Запоріжчин|Запорізьк[а-я]* област', 'Kherson Oblast': 'Херсонщин|Херсонськ[а-я]* област',
  'Dnipropetrovsk Oblast': 'Дніпропетровщин|Дніпропетровськ[а-я]* област', 'Odesa Oblast': 'Одещин|Одеськ[а-я]* област',
});
const CYR = "А-Яа-яІіЇїЄєҐґ'’ʼ";
const ukStemRe = new Map();
const stemRe = (stem) => {
  let re = ukStemRe.get(stem);
  // (?!щин|ськ): „Харківщина" je oblasť, „Лиманський (напрямок)" prídavné meno —
  // ani jedno nie je zmienka mesta (kmene končiace na -ськ majú ськ v sebe, tie
  // lookahead nebrzdí: „Покровському напрямку" → Pokrovsk, smer nesie meno mesta).
  if (!re) { re = new RegExp(`(?<![${CYR}])(?:${stem})(?!щин|ськ)[а-яіїєґ'’ʼ]{0,5}(?![${CYR}])`); ukStemRe.set(stem, re); }
  return re;
};
/**
 * Sídlo gazetteeru menované v ukrajinskom texte NAJSKÔR (poloha v texte, nie
 * poradie gazetteeru — súhrn DSNS menuje viac miest, prvé je predmet); oblasť
 * až keď nesedí žiadne sídlo. Pure.
 */
export function locateUkText(text, gazetteer = UKRAINE_GAZETTEER) {
  const s = String(text ?? '');
  if (!s) return null;
  let best = null; let bestAt = Infinity; let oblast = null; let oblastAt = Infinity;
  for (const place of gazetteer) {
    const stem = UK_PLACE_STEMS[place.name];
    if (!stem) continue;
    const m = stemRe(stem).exec(s);
    if (!m) continue;
    if (/Oblast$/.test(place.name)) { if (m.index < oblastAt) { oblast = place; oblastAt = m.index; } continue; }
    if (m.index < bestAt) { best = place; bestAt = m.index; }
  }
  if (best) return { name: best.name, lat: best.lat, lon: best.lon };
  return oblast ? { name: oblast.name, lat: oblast.lat, lon: oblast.lon, approx: true } : null;
}

/** Pravidlá pre ukrajinský text (poradie = priorita). */
export const UK_INCIDENT_RULES = Object.freeze([
  { type: 'naval', severity: 'major', re: /корабл|фрегат|катер|підводн|флот|Чорн[а-я]* мор|Азовськ[а-я]* мор|порт[уі]? /i, requires: /ураж|удар|знищ|уразил|потопл|вибух|атак/i },
  { type: 'air-defence', severity: 'minor', re: /збит|збив|збил|знешкодж|подавлен|ППО|протиповітрян|перехопл/i, unless: /загинул|загибл|поранен|постраждал|влуч|пошкодж|руйнув/i },
  { type: 'strike', severity: 'critical', re: /ракет|«?шахед|шахед|герань|дрон|БпЛА|безпілотн|КАБ|авіабомб|авіаудар|обстріл|удар(?:ив|или|у|ом|ів)?|атакував|прилетіл|приліт|влуч|мінометн|артилер/i },
  { type: 'fire', severity: 'critical', re: /вибух|пожеж|горить|горіл|займанн|загорян/i },
  { type: 'infrastructure', severity: 'major', re: /енергетич|електро|підстанц|ТЕЦ|ГЕС|АЕС|залізниц|вокзал|мост(?:у|і)?|міст\b|нафт|газов|НПЗ|склад|водогін|теплопостачан/i, requires: /ураж|удар|пошкодж|знищ|зруйн|атак|вибух|пожеж|без світла|знеструм/i },
  { type: 'ground', severity: 'major', re: /штурм|наступ|бойов[а-я]* зіткнен|відбил|відбито|просунул|звільн|захопил|окупант[а-я]* (?:намагал|атакув)|позиці/i },
]);
/**
 * Krátke hlásenia Povietraných síl („КАБи на північ Харківщини", „Швидкісна ціль
 * на Дніпро") = poplach/hrozba, nie úder: len text do 140 znakov, ktorý menuje
 * smer/hrozbu a NIE dopad.
 */
export const UK_ALERT_RE = /загроз|тривог|курсом|у напрямку|напрямк|швидкісн[а-я]* ціл|\bпуск(?:и|ів)?\b|на (?:північ|південь|схід|захід)|КАБ[иів]? (?:на|в|у) /i;
const UK_IMPACT_RE = /ураж|удар(?:ив|или)|загинул|поранен|постраждал|влуч|збит|збив|пошкодж|знищ|штурм|наступ|зіткнен|здійснив|відбил/i;
/** Klasifikácia ukrajinského textu (typ + závažnosť) alebo null. Pure. */
export function classifyUkText(text) {
  const s = String(text ?? '');
  if (s.length <= 140 && UK_ALERT_RE.test(s) && !UK_IMPACT_RE.test(s)) return { type: 'alert', severity: 'minor' };
  for (const rule of UK_INCIDENT_RULES) {
    if (!rule.re.test(s)) continue;
    if (rule.requires && !rule.requires.test(s)) continue;
    if (rule.unless && rule.unless.test(s)) continue;
    return { type: rule.type, severity: rule.severity };
  }
  return null;
}
/** Počty obetí z ukrajinského textu (len čísla). Pure. */
export function ukCasualties(text) {
  const s = String(text ?? '');
  const num = (m) => (m ? Number(m[1]) : null);
  const killed = num(s.match(/(\d{1,4})\s+(?:людей|людини|особи|осіб|цивільн[а-я]+|мирн[а-я]+ (?:жител[а-я]+|людей))?\s*(?:загинул|загибл)/i)) ?? num(s.match(/загинул[а-я]*\s+(?:щонайменше\s+|принаймні\s+)?(\d{1,4})/i)) ?? num(s.match(/(\d{1,4})\s+загибл/i));
  const injured = num(s.match(/(\d{1,4})\s+(?:людей|людини|особи|осіб|цивільн[а-я]+)?\s*(?:поранен|постраждал|травмован)/i)) ?? num(s.match(/(?:поранен|постраждал|травмован)[а-я]*\s+(?:щонайменше\s+|принаймні\s+)?(\d{1,4})/i));
  return { killed: Number.isFinite(killed) ? killed : null, injured: Number.isFinite(injured) ? injured : null };
}

// ── Médium → udalosť ──────────────────────────────────────────────────────
/**
 * Médium (video/fotopríspevok) → udalosť jednotného modelu (`src:'media'`). Bez
 * miesta ostáva v časovej osi bez bodu na mape (`lat:null`). Titulok/text určí
 * typ; bez typu = `other` (vojnové video bez rozpoznanej udalosti).
 * @param {object} item z parseYoutubeFeed/parseTelegramPreview/parseRssVideoEnclosures
 * @param {{classifyEn?: Function, locateEn?: Function}} [deps] anglická klasifikácia (gulfIncidents) — vstrekuje sa, aby modul nemal cyklické importy
 */
export function mediaToEvent(item, { classifyEn = null, locateEn = null } = {}) {
  if (!item || !Number.isFinite(item.publishedAt)) return null;
  const text = `${item.title || ''}\n${item.text || item.description || ''}`;
  const uk = item.lang === 'uk';
  const cls = uk ? classifyUkText(text) : (classifyEn ? classifyEn(text) : null);
  const loc = uk ? locateUkText(text) : (locateEn ? locateEn(text) : null);
  const cas = uk ? ukCasualties(text) : { killed: null, injured: null };
  const title = clip(item.title || item.text || '', 160);
  return {
    id: item.id, t: item.publishedAt, dayOnly: false,
    lat: loc ? loc.lat : null, lon: loc ? loc.lon : null, place: loc ? loc.name : null, region: null,
    precision: loc ? 'settlement' : 'unknown', approx: true,
    type: cls ? cls.type : 'other', sub: /дрон|БпЛА|шахед|drone|shahed|fpv/i.test(text) ? 'drone' : null,
    severity: cas.killed ? 'critical' : (cls ? cls.severity : 'minor'),
    level: item.badge === 'official-ua' ? 'official' : 'reported',
    src: 'media', provider: item.provider, kind: item.kind,
    actor: /росі|russian|окупант|ворож/i.test(text) ? 'ru' : null,
    civcas: Boolean(cas.killed || cas.injured), milcas: false,
    killed: cas.killed, injured: cas.injured, reports: 1, outlets: [],
    sources: [{ name: item.channel || item.provider, url: item.url }],
    image: item.thumb || null, noImage: false,
    media: [{ kind: item.kind, provider: item.provider, url: item.url, embed: item.embed || null, videoUrl: item.videoUrl || null, thumb: item.thumb || null, title, channel: item.channel || null, photos: item.photos || [] }],
    status: title,
  };
}
