// Fotky záchranárov (ДСНС) v deň ruského útoku: príspevok z mesta s obeťami, čerstvé fotky z náhľadu,
// veta v komentári, štítok a podpis kanála vo videu, odkaz v príspevku. Licenciu si nenárokujeme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AFTERMATH_MAX_KM, aftermathClip, aftermathPost, aftermathPreviewUrl, pickAftermath, postPhotos } from './frontDayAftermath.js';
import { frontDayLines, frontDayPostText } from './frontDayNarration.js';
import { buildMotionSvg } from './frontDayMotion.js';
import { frontDayPlan } from './frontDayVideo.js';

const now = Date.parse('2026-10-10T09:00:00Z');
const zap = { en: 'Zaporizhzhia', sk: 'Záporožie', lat: 47.84, lon: 35.14 };
const post = (id, text, { photos = 4, hoursAgo = 3, channel = 'dsns_telegram' } = {}) => ({
  url: `https://t.me/${channel}/${id}`, text, publishedAt: now - hoursAgo * 3600_000,
  photos: Array.from({ length: photos }, (_, k) => `https://cdn4.telesco.pe/file/${id}-${k}.jpg`),
});

test('výber: príspevok ДСНС z mesta s obeťami (Záporožie 10. 10.), nie iné mesto, cvičenie ani staré', () => {
  const media = [
    post(77141, '#Дніпропетровщина. росіяни повторно вдарили по рятувальниках', { photos: 3 }),
    post(77137, '#Запоріжжя. 5 людей загинули, серед них 2 дітей, та ще 11 осіб травмовані внаслідок ворожої атаки', { photos: 4 }),
    post(77120, 'Запоріжжя: навчання рятувальників на полігоні', { photos: 8 }),
    post(77001, '#Запоріжжя: внаслідок удару загинула людина', { photos: 8, hoursAgo: 40 }),
    post(9, '#Запоріжжя: внаслідок удару загинули 5 людей', { photos: 8, channel: 'GeneralStaffZSU' }),
    post(77138, '#Запоріжжя: наслідки атаки, загинули люди', { photos: 1 }),
  ];
  const a = pickAftermath(media, { now, places: [zap] });
  assert.equal(a.url, 'https://t.me/dsns_telegram/77137');
  assert.deepEqual([a.channel, a.postId, a.label, a.place.sk], ['dsns_telegram', 77137, 'ДСНС України', 'Záporožie']);
  assert.equal(pickAftermath(media, { now, places: [{ en: 'Lviv', sk: 'Ľvov', lat: 49.84, lon: 24.03 }] }), null, 'Ľvov nemá príspevok');
  assert.ok(AFTERMATH_MAX_KM <= 40);
});

test('z viacerých príspevkov z mesta najnovší, nie ten s najviac fotkami (77047 z 9. 10. bol iný útok); miesta podľa obetí', () => {
  const media = [
    post(77047, '❗Вранці російські війська завдали масованих авіаударів по Запоріжжю', { photos: 8, hoursAgo: 19 }),
    post(77137, '#Запоріжжя. 5 людей загинули внаслідок ворожої атаки', { photos: 4, hoursAgo: 3 }),
    post(3, '#Київ: внаслідок атаки постраждали люди', { photos: 8 }),
  ];
  assert.equal(pickAftermath(media, { now, places: [zap] }).postId, 77137);
  assert.equal(pickAftermath([media[0]], { now: now + 2 * 3600_000, places: [zap] }), null, 'po 20 h už nepatrí k dnešným obetiam');
  const kyiv = { en: 'Kyiv', sk: 'Kyjev', lat: 50.45, lon: 30.52 };
  assert.equal(pickAftermath(media, { now, places: [kyiv, zap] }).postId, 3, 'prvé miesto má prednosť');
});

test('odkaz na príspevok: len kanál záchranárov; čerstvé fotky z náhľadu toho príspevku (uložené vypršia)', () => {
  assert.deepEqual(aftermathPost('https://t.me/dsns_telegram/77137'), { channel: 'dsns_telegram', postId: 77137, key: 'dsns_telegram/77137' });
  assert.equal(aftermathPost('https://t.me/GeneralStaffZSU/1'), null);
  assert.equal(aftermathPreviewUrl({ channel: 'dsns_telegram', postId: 77137 }), 'https://t.me/s/dsns_telegram/77137');
  const block = (id, photos) => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="dsns_telegram/${id}">`
    + photos.map((p) => `<a class="tgme_widget_message_photo_wrap" style="background-image:url('${p}')"></a>`).join('')
    + `<div class="tgme_widget_message_text js-message_text">Запоріжжя</div><time datetime="2026-10-10T05:34:00+00:00"></time></div></div>`;
  const html = block(77136, ['https://cdn4.telesco.pe/file/x.jpg']) + block(77137, ['https://cdn4.telesco.pe/file/new-a.jpg', 'https://cdn4.telesco.pe/file/new-b.jpg']);
  assert.deepEqual(postPhotos(html, { channel: 'dsns_telegram', postId: 77137 }), ['https://cdn4.telesco.pe/file/new-a.jpg', 'https://cdn4.telesco.pe/file/new-b.jpg']);
  assert.deepEqual(postPhotos(html, { channel: 'dsns_telegram', postId: 1 }), []);
});

const strikeModel = (clips) => ({
  day: '2026-10-10', report: { total: 150, publishedAt: now }, avg7: 160, directions: [], strikes: {}, change: null, air: null,
  casualties: { total: { killed: 5, children: 2, injured: 11, sources: [{ name: 'Ukrinform' }, { name: 'Suspilne' }] },
    places: [{ ...zap, killed: 5, children: 2, injured: 11, sources: [{ name: 'Ukrinform', url: 'https://u' }, { name: 'Suspilne', url: 'https://s' }] }] },
  clips,
});

test('komentár a príspevok: veta o záchranároch v meste útoku; odkaz na príspevok ДСНС bez nároku na licenciu', () => {
  const rescue = aftermathClip({ url: 'https://t.me/dsns_telegram/77137', label: 'ДСНС України', place: { sk: 'Záporožie' } });
  const m = strikeModel([{ captionSk: 'Ukrajinské sily zničili ruský tank', url: 'https://armyinform.com.ua/c' }, rescue]);
  const lines = frontDayLines(m);
  const line = lines.find((l) => l.id === 'aftermath');
  assert.deepEqual([line.shot, line.caption], ['clip:1', 'V meste Záporožie zasahujú záchranári.']);
  assert.ok(!lines.some((l) => l.shot === 'clip:0'), 'bojový záber v deň útoku nie');
  const text = frontDayPostText(m);
  assert.ok(text.includes('Foto: ДСНС України (Telegram), Záporožie: https://t.me/dsns_telegram/77137'), text);
  assert.ok(!/ДСНС[^\n]*CC BY/.test(text), 'licencia ДСНС sa netvrdí');
  assert.ok(!text.includes('armyinform.com.ua/c'), 'nepoužitý bojový záber nie je v zdrojoch');
  assert.ok(!frontDayLines(strikeModel([])).some((l) => l.id === 'aftermath'), 'bez fotiek bez vety');
});

test('bežný deň (4 mŕtvi v Záporoží, 10. 10.): veta o obetiach na fotkách záchranárov, so zdrojmi v príspevku; bez fotiek nič', () => {
  const rescue = aftermathClip({ url: 'https://t.me/dsns_telegram/77137', label: 'ДСНС України', place: { sk: 'Záporožie' } });
  const m = { ...strikeModel([{ captionSk: 'Ukrajinské sily zničili ruský tank', url: 'https://armyinform.com.ua/c' }, rescue]),
    air: { count: 14, kinds: ['drones'] } };
  m.casualties = { total: { killed: 4, sources: [] }, places: [{ ...zap, killed: 4, children: null, injured: null, sources: [{ name: 'Ukrainska Pravda' }, { name: 'The Kyiv Independent' }] }] };
  const lines = frontDayLines(m);
  const line = lines.find((l) => l.id === 'aftermath');
  assert.equal(line.shot, 'clip:1');
  assert.equal(line.caption, 'Pri ruskom útoku v meste Záporožie zahynuli podľa médií najmenej 4 ľudia.');
  assert.equal(line.spoken, 'Pri ruskom útoku v meste Záporožie zahynuli podľa médií najmenej štyria ľudia.');
  assert.ok(lines.some((l) => l.shot === 'clip:0'), 'bojový záber ostáva');
  const text = frontDayPostText(m);
  assert.ok(text.includes('zahynuli podľa médií najmenej 4 ľudia. Zdroje: Ukrainska Pravda, The Kyiv Independent.'), text);
  assert.ok(text.includes('Foto: ДСНС України (Telegram), Záporožie: https://t.me/dsns_telegram/77137'));
  const noPhotos = { ...m, clips: [m.clips[0]] };
  assert.ok(!frontDayLines(noPhotos).some((l) => l.id === 'aftermath') && !frontDayPostText(noPhotos).includes('Záporožie'), 'bez fotiek bez vety');
});

test('grafika záberu: štítok mesta a podpis ДСНС namiesto ArmyInform; bojový záber ostáva ArmyInform', () => {
  const rescue = aftermathClip({ url: 'https://t.me/dsns_telegram/77137', label: 'ДСНС України', place: { sk: 'Záporožie' } });
  const lines = [{ id: 'hook', shot: 'opening' }, { id: 'aftermath', shot: 'clip:0' }, { id: 'portal', shot: 'closing' }];
  const durations = Object.fromEntries(lines.map((l) => [l.id, { lead: 0.1, speechEnd: 3 }]));
  const plan = frontDayPlan({ story: 'strike' }, lines, durations);
  const shot = plan.shots.find((s) => s.kind === 'clip');
  const at = (model) => buildMotionSvg({ t: shot.start + 1, shots: plan.shots, lines, placement: plan.placement, cues: [], model, hook: null, logoMarkup: '' });
  const svg = at({ ...strikeModel([rescue]) });
  assert.ok(svg.includes('ZÁPOROŽIE · ZÁCHRANÁRI') && svg.includes('Foto: ДСНС України · Telegram'));
  assert.ok(!svg.includes('ARMYINFORM') && !svg.includes('CC BY'), 'nič z ArmyInform');
  const army = at({ ...strikeModel([{ captionSk: 'tank' }]) });
  assert.ok(army.includes('ZÁBERY · ARMYINFORM') && army.includes('Ministerstvo obrany Ukrajiny · CC BY 4.0'));
});
