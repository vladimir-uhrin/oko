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
  // DeepState (2026-09-19, používateľ: „čo vieme získať z DeepState"): API len po
  // schválení žiadosti, ale ich licencia (§3) výslovne dovoľuje VIZUÁLNE materiály
  // s logom/odkazom aj komerčne → denné obrázky mapy z ich kanála ako fotky
  // s odkazom na príspevok; nikdy API, nikdy mirror.
  Object.freeze({ name: 'DeepStateUA', label: 'DeepState', badge: 'osint' }),
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
/** Prídavné meno oblasti + slovo oblasti (aj „обл.", aj súradné „Одеської та Миколаївської областей"). */
const oblAdjStem = (stem) => `${stem}[а-яіїєґ'’ʼ]*(?:(?:(?:,\\s*|\\s+(?:та|і|й)\\s+)[А-ЯІЇЄҐ][а-яіїєґ'’ʼ-]+)+\\s+обл(?:астей|астях)|\\s+обл(?:аст[а-яіїєґ'’ʼ]*|\\.)?)`;
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
  // [а-яіїє]: aj „Донецької / Одеській області" (šikmé pády majú і/ї).
  'Kharkiv Oblast': `Харківщин|${oblAdjStem('Харківськ')}`, 'Sumy Oblast': `Сумщин|${oblAdjStem('Сумськ')}`, 'Donetsk Oblast': `Донеччин|${oblAdjStem('Донецьк')}`, 'Zaporizhzhia Oblast': `Запоріжчин|${oblAdjStem('Запорізьк')}`, 'Kherson Oblast': `Херсонщин|${oblAdjStem('Херсонськ')}`,
  'Dnipropetrovsk Oblast': `Дніпропетровщин|${oblAdjStem('Дніпропетровськ')}`, 'Odesa Oblast': `Одещин|${oblAdjStem('Одеськ')}`,
});
const CYR = "А-Яа-яІіЇїЄєҐґ'’ʼ";
const LOW = "а-яіїєґ'’ʼ";
/**
 * Chvost oblasti za prídavným menom: „… обл(асть)/обл." alebo súradné prídavné
 * mená s MNOŽNÝM „областей/областях" („Вінницької та Черкаської областей").
 * Množné číslo je podmienka — „у Києві та Київській області" je mesto a oblasť.
 */
const OBL_TAIL = `(?:(?:(?:,\\s*|\\s+(?:та|і|й)\\s+)[А-ЯІЇЄҐ][${LOW}-]+)+\\s+обл(?:астей|астях)|\\s+обл(?:аст[${LOW}]*|\\.)?)`;
/**
 * Prídavné mená pred menom sídla, ktoré z neho robia INÉ sídlo („Нова Борова" na
 * Žitomirsku ≠ Borova na Charkovsku, „Нова Одеса" ≠ Odesa) — 2026-09-24 poplach
 * zo Žitomirska stál na mape pri Kupjansku. Výslovné koncovky (tvrdé kmene
 * a mäkké Верхн-/Нижн-): „Біля" (pri) ani „Новини" (správy) nie sú prídavné mená.
 * Regióny (Krym, Donbas, moria) sa nekontrolujú — „Старий Крим" leží na Kryme.
 */
const NAME_ADJ_BEFORE = "(?<!(?:(?:Нов|Стар|Велик|Мал|Червон|Біл|Зелен|Сух|Золот|Кам['’ʼ]ян)(?:а|ий|е|і|ої|ого|ій|ому|у|ою|их|им)|(?:Верхн|Нижн)(?:я|ій|є|і|ьої|ього|ьому|ю|ьою|іх|ім))\\s)";
const REGION_NAMES = new Set(['Crimea', 'Donbas', 'Black Sea', 'Sea of Azov']);
/**
 * Mestá s menom na -ськ/-цьк, ktorých prídavné tvary („Покровське", „Покровського")
 * bývajú iné sídla (dedina Покровське na Dnipropetrovsku) — prijmú sa len so
 * slovom „напрям…/район…/громад…" za nimi. Mestá, ktorých meno samo je prídavné
 * meno (Кропивницький, Хмельницький), sa nekontrolujú.
 */
const ADJ_NAMESAKE_STEMS = new Set(['Pokrovsk', 'Toretsk', 'Siversk', 'Sloviansk', 'Kramatorsk', 'Kupiansk', 'Vovchansk', 'Berdiansk', 'Sievierodonetsk', 'Donetsk', 'Luhansk', 'Chornomorsk', 'Lutsk', 'Kursk', 'Bryansk', 'Novorossiysk']);
const ukStemRe = new Map();
const stemRe = (stem, name = '') => {
  const key = `${name}|${stem}`;
  let re = ukStemRe.get(key);
  // (?!щин|ськ): „Харківщина" je oblasť, „Лиманський (напрямок)" prídavné meno —
  // ani jedno nie je zmienka mesta (kmene končiace na -ськ majú ськ v sebe, tie
  // lookahead nebrzdí: „Покровському напрямку" → Pokrovsk, smer nesie meno mesta).
  // „-щин-" do 3 písmen („Рівненщина") je oblasť. „… обл(асть)" za kmeňom — aj cez
  // súradné prídavné mená — je oblasť, nie mesto („Донецька область" ≠ Doneck).
  if (!re) {
    const adj = REGION_NAMES.has(name) ? '' : NAME_ADJ_BEFORE;
    const adjNamesake = ADJ_NAMESAKE_STEMS.has(name) ? `(?!(?:е|ого|ому|ий|ої|ій|ою)(?![${LOW}])(?!\\s+(?:напрям|район|громад|відтин|фронт)))` : '';
    re = new RegExp(`${adj}(?<![${CYR}])(?:${stem})(?!щин|ськ)(?![${LOW}]{0,3}щин)(?![${LOW}]{0,6}${OBL_TAIL})${adjNamesake}[${LOW}]{0,5}(?![${CYR}])`, 'u');
    ukStemRe.set(key, re);
  }
  return re;
};
/**
 * Oblasti mimo gazetteeru (na odhalenie menovca a ako hrubá poloha len v tom
 * prípade): kmeň + ťažisko. Oblasti gazetteeru ostávajú v UK_PLACE_STEMS.
 */
export const UK_OBLAST_HINTS = Object.freeze({
  'Vinnytsia Oblast': { re: `Вінниччин|${oblAdjStem('Вінницьк')}`, lat: 49.1, lon: 28.5 },
  'Volyn Oblast': { re: `Волин(?:ь|і|ню)(?![${LOW}])|${oblAdjStem('Волинськ')}`, lat: 51.2, lon: 25.1 },
  'Zhytomyr Oblast': { re: `Житомирщин|${oblAdjStem('Житомирськ')}`, lat: 50.6, lon: 28.4 },
  'Zakarpattia Oblast': { re: `Закарпатт|${oblAdjStem('Закарпатськ')}`, lat: 48.4, lon: 23.3 },
  'Ivano-Frankivsk Oblast': { re: `Прикарпатт|Івано-Франківщин|${oblAdjStem('Івано-Франківськ')}`, lat: 48.8, lon: 24.6 },
  'Kyiv Oblast': { re: `Київщин|${oblAdjStem('Київськ')}`, lat: 50.4, lon: 30.6 },
  'Kirovohrad Oblast': { re: `Кіровоградщин|${oblAdjStem('Кіровоградськ')}`, lat: 48.4, lon: 32.0 },
  'Luhansk Oblast': { re: `Луганщин|${oblAdjStem('Луганськ')}`, lat: 48.8, lon: 38.9 },
  'Lviv Oblast': { re: `Львівщин|${oblAdjStem('Львівськ')}`, lat: 49.8, lon: 24.0 },
  'Mykolaiv Oblast': { re: `Миколаївщин|${oblAdjStem('Миколаївськ')}`, lat: 47.2, lon: 31.8 },
  'Poltava Oblast': { re: `Полтавщин|${oblAdjStem('Полтавськ')}`, lat: 49.6, lon: 33.9 },
  'Rivne Oblast': { re: `Рівненщин|${oblAdjStem('Рівненськ')}`, lat: 51.0, lon: 26.3 },
  'Ternopil Oblast': { re: `Тернопільщин|${oblAdjStem('Тернопільськ')}`, lat: 49.4, lon: 25.6 },
  'Khmelnytskyi Oblast': { re: `Хмельниччин|${oblAdjStem('Хмельницьк')}`, lat: 49.4, lon: 26.9 },
  'Cherkasy Oblast': { re: `Черкащин|${oblAdjStem('Черкаськ')}`, lat: 49.2, lon: 31.5 },
  'Chernivtsi Oblast': { re: `Буковин(?:а|и|і|у|ою)(?![${LOW}])|Чернівеччин|${oblAdjStem('Чернівецьк')}`, lat: 48.3, lon: 25.9 },
  'Chernihiv Oblast': { re: `Чернігівщин|${oblAdjStem('Чернігівськ')}`, lat: 51.4, lon: 32.1 },
});
const oblastHintRe = new Map();
// Zhoda zje aj pádovú koncovku („Житомирщин|а", „…област|і") — tvar sa číta z celého slova.
const hintRe = (re) => { let r = oblastHintRe.get(re); if (!r) { r = new RegExp(`(?<![${CYR}])(?:${re})[${LOW}]*`, 'u'); oblastHintRe.set(re, r); } return r; };
/** Sídlo ďalej od oblasti, ktorá ho kvalifikuje = menovec z inej oblasti (km). */
export const OBLAST_NAMESAKE_KM = 250;
/** Oblasť kvalifikuje sídlo za ňou len do tejto vzdialenosti (znaky) a bez oddeľovača úseku. */
export const OBLAST_QUALIFY_CHARS = 60;
// Oddeľovač úseku: veta, bodkočiarka, zvislica, nový riadok — aj emoji, ktorým hlásenia
// Vzdušných síl začínajú položky zoznamu („… Одещини 🏍 … Кривого Рогу").
const SEGMENT_BREAK_RE = /[.!?;|\n]|\p{Extended_Pictographic}/u;
// Emoji hneď za nadpisom oblasti („Житомирщина: 🛵 БпЛА …") úsek nedelí.
const HEADER_EMOJI_RE = /^[\s:–—-]*(?:\p{Extended_Pictographic}|️|‍)+/u;
// Skratky s bodkou nie sú koniec vety („в р-ні н.п. Борова", „м. Суми", „обл.").
const ABBREV_RE = new RegExp(`(?<![${CYR}])(?:н\\.\\s?п\\.|р[-—–]н[іа]?\\.?|смт\\.?|обл\\.|м\\.|с\\.)`, 'gu');
/**
 * Tvar zmienky oblasti z celého slova: nominatív (nadpis „Житомирщина:"),
 * genitív („Житомирщини", „Житомирської області"), lokál („на Житомирщині",
 * „у Житомирській області"), akuzatív („на Київщину" = smer). Pure.
 */
function oblastForm(phrase) {
  const w = phrase.toLowerCase();
  if (/обл/u.test(w)) {
    const adj = /^\S*?(ої|ій|ою|их|а|у)(?=[\s,])/u.exec(w)?.[1];
    return ({ а: 'nom', ої: 'gen', их: 'gen', ій: 'loc', у: 'acc', ою: 'ins' })[adj] || 'other';
  }
  const tail = /(щин|буковин|волин|карпатт)([а-яіїєґ]*)$/u.exec(w);
  if (!tail) return 'other';
  const [, root, e] = tail;
  if (root === 'волин') return e === 'ь' ? 'nom' : (e === 'і' ? 'loc' : 'other');
  if (root === 'карпатт') return e === 'я' ? 'nom' : (e === 'і' ? 'loc' : 'other');
  return ({ а: 'nom', и: 'gen', і: 'loc', у: 'acc', ою: 'ins' })[e] || 'other';
}
/** Predložka tesne pred zmienkou („з", „на", „до"…), malými písmenami, alebo ''. */
function prepositionBefore(s, at) {
  const m = new RegExp(`(?:^|[^${CYR}])(з|із|зі|від|до|на|у|в|по|через|повз)\\s+$`, 'iu').exec(s.slice(Math.max(0, at - 10), at));
  return m ? m[1].toLowerCase() : '';
}
/** Odkiaľ/kam — takáto oblasť sídlo nekvalifikuje. */
const FROM_OR_TOWARD = new Set(['з', 'із', 'зі', 'від', 'до', 'через', 'повз']);
const kmApprox = (a, b) => { const dy = (b.lat - a.lat) * 111.32; const dx = (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180); return Math.hypot(dx, dy); };
/**
 * Sídlo gazetteeru menované v ukrajinskom texte NAJSKÔR (poloha v texte, nie
 * poradie gazetteeru — súhrn DSNS menuje viac miest, prvé je predmet); oblasť
 * až keď nesedí žiadne sídlo. Keď oblasť, ktorá sídlo NAOZAJ kvalifikuje, leží
 * od neho ďalej než OBLAST_NAMESAKE_KM, sídlo je menovec z inej oblasti →
 * poloha oblasti (približná). Kvalifikuje: pred sídlom v tom istom úseku (do 60
 * znakov, bez . ! ? ; | emoji a nového riadku; skratky „н.п." neprekážajú) nadpis
 * „Житомирщина:" alebo lokál „на Житомирщині"; za sídlom lokál, genitív bez
 * predložky („Новомиколаївки Запорізької області") alebo zátvorka „(Рівненщина)".
 * Nekvalifikuje: odkiaľ/kam („з Одещини", „на Київщину", „до Київщини"). Bez
 * sídla len oblasť gazetteeru (UK_OBLAST_HINTS polohu samy nedávajú). Pure.
 */
export function locateUkText(text, gazetteer = UKRAINE_GAZETTEER) {
  const s = String(text ?? '');
  if (!s) return null;
  let best = null; let bestAt = Infinity; let bestEnd = Infinity;
  const oblasts = []; // { name, lat, lon, at, end, form, prep, gazetteer }
  const addOblast = (name, lat, lon, m, gaz) => {
    oblasts.push({ name, lat, lon, at: m.index, end: m.index + m[0].length, form: oblastForm(m[0]), prep: prepositionBefore(s, m.index), gazetteer: gaz });
  };
  for (const place of gazetteer) {
    const stem = UK_PLACE_STEMS[place.name];
    if (!stem) continue;
    const m = stemRe(stem, place.name).exec(s);
    if (!m) continue;
    if (/Oblast$/.test(place.name)) { addOblast(place.name, place.lat, place.lon, m, true); continue; }
    if (m.index < bestAt) { best = place; bestAt = m.index; bestEnd = m.index + m[0].length; }
  }
  for (const [name, h] of Object.entries(UK_OBLAST_HINTS)) {
    const m = hintRe(h.re).exec(s);
    if (m) addOblast(name, h.lat, h.lon, m, false);
  }
  oblasts.sort((a, b) => a.at - b.at);
  if (best) {
    const before = oblasts.filter((o) => {
      if (o.end > bestAt || bestAt - o.end > OBLAST_QUALIFY_CHARS || FROM_OR_TOWARD.has(o.prep)) return false;
      const gap = s.slice(o.end, bestAt).replace(HEADER_EMOJI_RE, '').replace(ABBREV_RE, ' ');
      if (SEGMENT_BREAK_RE.test(gap)) return false;
      if (o.form === 'loc') return true;
      return o.form === 'nom' && /^\s*[:–—-]/u.test(s.slice(o.end));
    }).at(-1);
    const after = oblasts.find((o) => {
      if (o.at < bestEnd || FROM_OR_TOWARD.has(o.prep)) return false;
      const gap = s.slice(bestEnd, o.at);
      if (!/^[\s(«"„—–-]*(?:(?:на|у|в)\s+)?$/u.test(gap)) return false;
      if (o.form === 'loc') return true;
      if (o.form === 'gen') return !/(?:на|у|в)\s+$/u.test(gap);
      return o.form === 'nom' && /\(\s*$/u.test(gap);
    });
    const hints = [before, after].filter(Boolean);
    if (!hints.length || hints.some((h) => kmApprox(h, best) <= OBLAST_NAMESAKE_KM)) return { name: best.name, lat: best.lat, lon: best.lon };
    const hint = hints[0];
    return { name: hint.name, lat: hint.lat, lon: hint.lon, approx: true };
  }
  // Bez sídla len oblasti gazetteeru (ako doteraz): nápovedy ostatných oblastí slúžia
  // len na odhalenie menovca — inak by na mapu pribudli stovky bodov v ťažiskách
  // oblastí vrátane príbehov o ľuďoch („блогер з Буковини"), čo nechceme.
  const oblast = oblasts.find((o) => o.gazetteer);
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
    level: item.badge === 'official-ua' ? 'official' : (item.badge === 'osint' ? 'osint' : 'reported'),
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
