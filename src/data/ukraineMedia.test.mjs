// src/data/ukraineMedia.test.mjs — fotky a videá modulu UKRAJINA: YouTube feed,
// Telegram náhľad (vzorka štruktúry z 19. 9. 2026), ArmyInform video prílohy,
// ukrajinská klasifikácia a kotvenie, médium → udalosť.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARMYINFORM_UA_FEED,
  TELEGRAM_CHANNELS,
  YOUTUBE_CHANNELS,
  classifyUkText,
  decodeEntities,
  locateUkText,
  mediaToEvent,
  parseRssVideoEnclosures,
  parseTelegramPreview,
  parseYoutubeFeed,
  stripTags,
  telegramPreviewUrl,
  ukCasualties,
  youtubeFeedUrl,
} from './ukraineMedia.js';
import { attachMedia, eventCardModel, pickCards, clusterEvents } from './ukraineEvents.js';

const ytEntry = (id, title, desc, published = '2026-09-19T13:03:01+00:00') => `<entry>
  <id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>UCx</yt:channelId>
  <title>${title}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>
  <author><name>Chan</name></author><published>${published}</published>
  <media:group><media:title>${title}</media:title>
   <media:thumbnail url="https://i3.ytimg.com/vi/${id}/hqdefault.jpg" width="480" height="360"/>
   <media:description>${desc}</media:description></media:group></entry>`;
const YT = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><title>Chan</title>
${ytEntry('jzktspLtrDM', 'Life under drone threat in Zaporizhzhia', 'As Russian attacks reach deeper &amp; residents adapt.')}
${ytEntry('abc123XYZ_-', 'Markets open higher on Wall Street', 'Stocks rose.')}
</feed>`;

test('YouTube: feed → videá s náhľadom a embedom; svetový kanál sa filtruje regexom regiónu', () => {
  assert.equal(youtubeFeedUrl('UCGAC5yzlYgjKoJABDZ7zEyw'), 'https://www.youtube.com/feeds/videos.xml?channel_id=UCGAC5yzlYgjKoJABDZ7zEyw');
  const all = parseYoutubeFeed(YT, { label: 'Kyiv Independent', filter: false });
  assert.equal(all.length, 2);
  assert.deepEqual(all[0], {
    kind: 'video', provider: 'youtube', id: 'yt:jzktspLtrDM', videoId: 'jzktspLtrDM',
    url: 'https://www.youtube.com/watch?v=jzktspLtrDM', embed: 'https://www.youtube-nocookie.com/embed/jzktspLtrDM',
    thumb: 'https://i3.ytimg.com/vi/jzktspLtrDM/hqdefault.jpg', title: 'Life under drone threat in Zaporizhzhia',
    description: 'As Russian attacks reach deeper & residents adapt.', publishedAt: Date.parse('2026-09-19T13:03:01+00:00'),
    channel: 'Kyiv Independent', badge: null, lang: 'en',
  });
  const filtered = parseYoutubeFeed(YT, { label: 'Reuters', filter: true });
  assert.deepEqual(filtered.map((v) => v.videoId), ['jzktspLtrDM'], 'Wall Street video vypadne');
  assert.equal(parseYoutubeFeed('<feed></feed>').length, 0);
  assert.ok(YOUTUBE_CHANNELS.every((c) => /^UC[\w-]{22}$/.test(c.id)), 'ID kanálov majú tvar UC…');
});

const tgPost = (chan, id, when, { text = '', photos = [], video = false, forwarded = false } = {}) => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${chan}/${id}" data-view="x">
<div class="tgme_widget_message_user"><a href="https://t.me/${chan}"><i class="tgme_widget_message_user_photo"></i></a></div>
<div class="tgme_widget_message_bubble">${forwarded ? '<div class="tgme_widget_message_forwarded_from accent_color"><span>Forwarded from</span> <a class="tgme_widget_message_forwarded_from_name" href="https://t.me/brigade">Brigade</a></div>' : ''}
${photos.length > 1 ? `<div class="tgme_widget_message_grouped_wrap js-message_grouped_wrap" data-margin-w="0" data-margin-h="2"><div class="tgme_widget_message_grouped js-message_grouped">${photos.map((p, i) => `<a class="tgme_widget_message_photo_wrap grouped_media_wrap blured js-message_photo" style="left:0px;top:0px;width:149px;height:88px;background-image:url('${p}')" data-ratio="1.77" href="https://t.me/${chan}/${id}?single"><div class="tgme_widget_message_photo grouped_media"></div></a>`).join('')}</div></div>` : photos.map((p) => `<a class="tgme_widget_message_photo_wrap 5294383783689789758 1232694784_460005694" href="https://t.me/${chan}/${id}" style="width:800px;background-image:url('${p}')"><div class="tgme_widget_message_photo"></div></a>`).join('')}
${video ? `<a class="tgme_widget_message_video_player blured js-message_video_player" href="https://t.me/${chan}/${id}?single"><i class="tgme_widget_message_video_thumb" style="background-image:url('https://cdn4.telesco.pe/file/thumb.jpg')"></i><video src="https://cdn4.telesco.pe/file/f9.mp4?token=abc" class="tgme_widget_message_video js-message_video" width="100%" height="100%"></video></a>` : ''}
<div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>
<div class="tgme_widget_message_footer compact js-message_footer"><div class="tgme_widget_message_info short js-message_info"><a class="tgme_widget_message_date" href="https://t.me/${chan}/${id}"><time datetime="${when}" class="time">14:57</time></a></div></div>
</div></div></div>`;

test('Telegram: náhľad → príspevky (fotky, video len ako náhľad + embed, text bez značiek), preposlané preč', () => {
  assert.equal(telegramPreviewUrl('dsns_telegram'), 'https://t.me/s/dsns_telegram');
  const html = `<html><body><section class="tgme_channel_history js-message_history">
${tgPost('dsns_telegram', 75162, '2026-09-19T11:35:22+00:00', { text: '<i class="emoji"><b>⚡️</b></i> <b>Запоріжжя:</b> внаслідок удару <a href="x">БпЛА</a> по житловому будинку загинули 2 людини, ще 7 поранені.<br/><br/>Рятувальники працюють.', photos: ['https://cdn4.telesco.pe/file/a.jpg', 'https://cdn4.telesco.pe/file/b.jpg', 'https://cdn4.telesco.pe/file/c.jpg'] })}
${tgPost('dsns_telegram', 75173, '2026-09-19T14:57:03+00:00', { text: 'Одещина: ліквідація пожежі після атаки дронів у порту.', video: true })}
${tgPost('dsns_telegram', 75180, '2026-09-19T15:00:00+00:00', { text: 'Переслане з бригади', photos: ['https://cdn4.telesco.pe/file/z.jpg'], forwarded: true })}
${tgPost('dsns_telegram', 75181, '2026-09-19T15:10:00+00:00', { text: 'Лише текст &amp; ентity &#8212; тест' })}
</section></body></html>`;
  const posts = parseTelegramPreview(html, { label: 'ДСНС України', badge: 'official-ua' });
  assert.deepEqual(posts.map((p) => p.postId), [75162, 75173, 75181], 'preposlaný 75180 vypadol');
  const [photo, video, text] = posts;
  assert.equal(photo.kind, 'photo');
  assert.equal(photo.photos.length, 3);
  assert.equal(photo.thumb, 'https://cdn4.telesco.pe/file/a.jpg');
  assert.equal(photo.url, 'https://t.me/dsns_telegram/75162');
  assert.equal(photo.embed, 'https://t.me/dsns_telegram/75162?embed=1&mode=tme');
  assert.equal(photo.text, '⚡️ Запоріжжя: внаслідок удару БпЛА по житловому будинку загинули 2 людини, ще 7 поранені. Рятувальники працюють.');
  assert.equal(photo.publishedAt, Date.parse('2026-09-19T11:35:22+00:00'));
  assert.equal(photo.channel, 'ДСНС України');
  assert.equal(photo.badge, 'official-ua');
  assert.equal(video.kind, 'video');
  assert.equal(video.videos, 1);
  assert.equal(video.thumb, 'https://cdn4.telesco.pe/file/thumb.jpg', 'video = len náhľad, nikdy tokenizované mp4');
  assert.equal(JSON.stringify(video).includes('token='), false);
  assert.equal(text.kind, 'text');
  assert.equal(text.text, 'Лише текст & ентity — тест');
  assert.equal(parseTelegramPreview('<html></html>').length, 0);
  assert.ok(TELEGRAM_CHANNELS.every((c) => c.badge === 'official-ua'), 'len oficiálne štátne kanály');
});

test('ArmyInform: video prílohy mp4 z RSS (CC BY 4.0)', () => {
  assert.equal(ARMYINFORM_UA_FEED, 'https://armyinform.com.ua/feed/');
  const xml = `<rss><channel><item><title><![CDATA[Від сьомої ранку до вечора: один екіпаж збив 71 російську «Молнію»]]></title><link>https://armyinform.com.ua/2026/09/19/x/</link><pubDate>Fri, 19 Sep 2026 15:35:00 +0000</pubDate><enclosure url="https://armyinform.stream/~/share/2fe6/%D0%9C.mp4" length="0" type="video/mp4" /></item>
<item><title>Bez videa</title><link>https://armyinform.com.ua/2026/09/19/y/</link><pubDate>Fri, 19 Sep 2026 15:35:00 +0000</pubDate></item></channel></rss>`;
  const videos = parseRssVideoEnclosures(xml);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].videoUrl, 'https://armyinform.stream/~/share/2fe6/%D0%9C.mp4');
  assert.equal(videos[0].provider, 'file');
  assert.equal(videos[0].lang, 'uk');
  assert.equal(videos[0].badge, 'official-ua');
});

test('ukrajinský text: kotvenie podľa prvej zmienky, oblasť ≠ mesto, klasifikácia, poplach, obete', () => {
  assert.equal(decodeEntities('a &amp; b &#8212; &#x41;'), 'a & b — A');
  assert.equal(stripTags('<b>x</b><br/>y<div>z</div>'), 'x\ny\nz');
  assert.equal(locateUkText('Київ: постраждали 16 людей. Дніпропетровщина: загинули 5 людей').name, 'Kyiv', 'prvá zmienka, nie poradie gazetteeru');
  assert.equal(locateUkText('КАБи на північ Харківщини').name, 'Kharkiv Oblast');
  assert.equal(locateUkText('Удар по Харкову').name, 'Kharkiv');
  assert.equal(locateUkText("У Слов'янську та Краматорську").name, 'Sloviansk');
  assert.equal(locateUkText('Ворог атакував Покровськ').name, 'Pokrovsk');
  assert.equal(locateUkText('Лиманський напрямок'), null, 'prídavné meno smeru nie je sídlo');
  assert.equal(locateUkText('На Покровському напрямку 48 штурмів').name, 'Pokrovsk', 'smer pomenovaný mestom s -ськ v kmeni sa kotví na mesto');
  assert.equal(locateUkText('сума збитків'), null, 'Сум ≠ суми');
  assert.equal(locateUkText('Ситуація в Сумах').name, 'Sumy');
  assert.deepEqual(classifyUkText('Уражено наземну станцію управління БпЛА'), { type: 'strike', severity: 'critical' });
  assert.deepEqual(classifyUkText('Вночі збито 60 із 71 ворожих БпЛА'), { type: 'air-defence', severity: 'minor' });
  assert.deepEqual(classifyUkText('один екіпаж Signum збив 71 російську «Молнію»'), { type: 'air-defence', severity: 'minor' });
  assert.deepEqual(classifyUkText('КАБи на північ Харківщини.'), { type: 'alert', severity: 'minor' });
  assert.deepEqual(classifyUkText('Швидкісна ціль на Дніпро!'), { type: 'alert', severity: 'minor' });
  assert.deepEqual(classifyUkText('На Покровському напрямку ворог здійснив 48 штурмів'), { type: 'ground', severity: 'major' });
  assert.deepEqual(classifyUkText('Внаслідок обстрілу пошкоджено підстанцію, частина міста без світла'), { type: 'strike', severity: 'critical' });
  assert.deepEqual(classifyUkText('Пожежа на складі після вибуху'), { type: 'fire', severity: 'critical' });
  assert.equal(classifyUkText('Українські та канадські компанії шукають можливості кооперації'), null);
  assert.deepEqual(ukCasualties('загинули 5 людей, ще 7 поранені'), { killed: 5, injured: 7 });
  assert.deepEqual(ukCasualties('постраждали 16 людей'), { killed: null, injured: 16 });
  assert.deepEqual(ukCasualties('Загинула людина'), { killed: null, injured: null });
});

test('mediaToEvent + attachMedia: video k udalosti toho istého dňa a miesta, bez miesta ostáva v osi, karta nesie médiá', () => {
  const tg = parseTelegramPreview(tgPost('dsns_telegram', 1, '2026-09-19T11:35:22+00:00', { text: 'Запоріжжя: внаслідок удару БпЛА загинули 2 людини, ще 7 поранені.', photos: ['https://cdn4.telesco.pe/file/a.jpg'] }), { label: 'ДСНС', badge: 'official-ua' })[0];
  const ev = mediaToEvent(tg);
  assert.equal(ev.src, 'media');
  assert.equal(ev.kind, 'photo');
  assert.equal(ev.place, 'Zaporizhzhia');
  assert.equal(ev.type, 'strike');
  assert.equal(ev.sub, 'drone');
  assert.equal(ev.severity, 'critical');
  assert.equal(ev.level, 'official');
  assert.equal(ev.killed, 2);
  assert.equal(ev.injured, 7);
  assert.equal(ev.image, 'https://cdn4.telesco.pe/file/a.jpg');
  assert.equal(ev.media[0].embed, 'https://t.me/dsns_telegram/1?embed=1&mode=tme');
  const yt = parseYoutubeFeed(YT, { label: 'Kyiv Independent' })[0];
  const enLocate = (t) => (/zaporizh/i.test(t) ? { name: 'Zaporizhzhia', lat: 47.84, lon: 35.14 } : null);
  const enClassify = (t) => (/drone/i.test(t) ? { type: 'strike', severity: 'critical' } : null);
  const ytEv = mediaToEvent(yt, { classifyEn: enClassify, locateEn: enLocate });
  assert.equal(ytEv.place, 'Zaporizhzhia');
  assert.equal(ytEv.level, 'reported');
  const nowhere = mediaToEvent(parseYoutubeFeed(YT, { label: 'Kyiv Independent' })[1], { classifyEn: () => null, locateEn: () => null });
  assert.equal(nowhere.lat, null);
  assert.equal(nowhere.type, 'other');
  const base = { id: 'viina:1', t: Date.UTC(2026, 8, 19), dayOnly: true, lat: 47.84, lon: 35.14, place: 'Zaporizhzhia', type: 'strike', severity: 'major', level: 'reported', src: 'viina', sources: [], approx: false, reports: 1, image: null, status: null };
  const merged = attachMedia([base], [ev, ytEv, nowhere]);
  assert.equal(merged.length, 2, 'dve médiá pripojené, jedno bez miesta samostatné');
  const v = merged.find((e) => e.id === 'viina:1');
  assert.equal(v.media.length, 2);
  assert.equal(v.image, 'https://cdn4.telesco.pe/file/a.jpg');
  assert.equal(v.killed, 2);
  assert.equal(v.level, 'official');
  assert.equal(v.reports, 3);
  assert.equal(base.media, undefined, 'vstup nezmenený');
  assert.equal(clusterEvents(merged).length, 1, 'bezmiestne médium sa nezhlukuje');
  assert.deepEqual(pickCards(merged).map((e) => e.id), ['viina:1']);
  const card = eventCardModel(v, { translate: (k) => k });
  assert.equal(card.media.length, 2);
  assert.equal(card.killed, 2);
  assert.equal(card.level, 'official');
});
