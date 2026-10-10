// Fotky záchranárov z miesta ruského útoku pre denné video (2026-10-10, vlastník: „viac videí a obrázkov,
// nielen z mojej web stránky"). Zdroj: oficiálny kanál Štátnej služby pre mimoriadne situácie Ukrajiny
// (t.me/s/dsns_telegram) — príspevok zo dňa útoku, ktorý menuje to isté mesto ako správy o obetiach.
// Licenciu si nenárokujeme (DATA_SOURCES.md): vždy meno kanála a odkaz na príspevok. Video príspevku
// má prednosť pred fotkami (vlastník 10. 10.: „povoľ aj videá"). Odkazy na fotky z CDN po čase vypršia (404)
// a videá majú krátko platný token, preto sa čerstvé berú z náhľadu príspevku až pri výrobe videa
// (postPhotos, postVideos) a nikam sa neukladajú.
import { locateUkText, parseTelegramPreview } from './ukraineMedia.js';

export const AFTERMATH_CHANNELS = Object.freeze({ dsns_telegram: 'ДСНС України' });
/** Mesto príspevku a miesto obetí najviac tak ďaleko (Záporožie: centrum mesta vs. okraj). */
export const AFTERMATH_MAX_KM = 30;
/** Okno ako správy o obetiach dňa; starší príspevok patrí k inému útoku (77047 z 9. 10. pri útoku 10. 10.). */
export const AFTERMATH_WINDOW_MS = 20 * 3600_000;
export const AFTERMATH_MIN_PHOTOS = 2;
/** Slová útoku a jeho následkov — nie cvičenie, odmínovanie ani rada pri výpadku prúdu. */
const ATTACK_UK = /загин|поранен|постраждал|травмован|удар|атак|обстріл|влучан|ракет|БпЛА|дрон/i;

const km = (a, b) => { const dy = (b.lat - a.lat) * 111.32; const dx = (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180); return Math.hypot(dx, dy); };

/** `https://t.me/dsns_telegram/77137` → { channel, postId, key }; iný kanál → null. Pure. */
export function aftermathPost(url) {
  const m = /^https:\/\/t\.me\/(\w+)\/(\d+)$/.exec(String(url || ''));
  if (!m || !AFTERMATH_CHANNELS[m[1]]) return null;
  return { channel: m[1], postId: Number(m[2]), key: `${m[1]}/${m[2]}` };
}

/**
 * Najlepší príspevok záchranárov k miestu s obeťami: miesta v poradí podľa obetí, k nim príspevok z okna
 * s aspoň dvoma fotkami, so slovom útoku a s mestom do AFTERMATH_MAX_KM; z viacerých NAJNOVŠÍ (skorší príspevok
 * z mesta býva o predošlom útoku — 10. 10. vyhral 77047 z 9. 10. s 8 fotkami nad dnešným 77137). Pure.
 * @param {Array<{url, text, photos, publishedAt}>} media archív `/api/ukraine/events`
 * @param {{now: number, places: Array<{en, sk, lat, lon}>}} opts
 * @returns {{url, channel, label, postId, place: {en, sk}, photos: number, publishedAt}|null}
 */
export function pickAftermath(media, { now = Date.now(), places = [], windowMs = AFTERMATH_WINDOW_MS, maxKm = AFTERMATH_MAX_KM } = {}) {
  const posts = [];
  for (const item of media || []) {
    const post = aftermathPost(item?.url);
    if (!post || ((item.photos?.length || 0) < AFTERMATH_MIN_PHOTOS && !(item.videos > 0))) continue;
    if (!Number.isFinite(item.publishedAt) || item.publishedAt > now + 60_000 || now - item.publishedAt > windowMs) continue;
    if (!ATTACK_UK.test(item.text || '')) continue;
    const loc = locateUkText(item.text);
    if (!loc || loc.approx || /Oblast$/.test(loc.name)) continue;
    posts.push({ item, post, loc });
  }
  for (const place of places || []) {
    if (!Number.isFinite(place?.lat) || !Number.isFinite(place?.lon)) continue;
    const near = posts.filter((p) => km(p.loc, place) <= maxKm)
      .sort((a, b) => b.item.publishedAt - a.item.publishedAt);
    if (!near.length) continue;
    const { item, post } = near[0];
    return { url: item.url, channel: post.channel, label: AFTERMATH_CHANNELS[post.channel], postId: post.postId,
      place: { en: place.en, sk: place.sk }, photos: item.photos?.length || 0, videos: item.videos || 0, publishedAt: item.publishedAt };
  }
  return null;
}

/** Čerstvé odkazy na fotky príspevku z náhľadu `t.me/s/<kanál>/<id>`. Pure. */
export function postPhotos(html, { channel, postId }) {
  const post = parseTelegramPreview(html).find((p) => p.id === `tg:${channel}/${postId}`);
  return post ? post.photos : [];
}

/**
 * Čerstvé odkazy na videá príspevku (`<video src>` s krátko platným tokenom) — len na stiahnutie pri výrobe,
 * nikdy do archívu. Veľké video náhľad nedá („Media is too big"), takých je časť. Pure.
 */
export function postVideos(html, { channel, postId }) {
  const blocks = String(html ?? '').split(/<div class="tgme_widget_message_wrap/).slice(1);
  const block = blocks.find((b) => /data-post="([^"]+)"/.exec(b)?.[1] === `${channel}/${postId}`);
  if (!block) return [];
  return [...block.matchAll(/<video[^>]*\ssrc="(https:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

export const aftermathPreviewUrl = ({ channel, postId }) => `https://t.me/s/${encodeURIComponent(channel)}/${postId}`;

/**
 * Záber do videa: štítok s mestom, podpis kanála (bez nároku na licenciu), odkaz do príspevku. Video
 * (`kind: 'video'`, vlastník 10. 10.: „povoľ aj videá") vyberá okno pohybu; fotky idú od začiatku. Pure.
 */
export function aftermathClip(a, { kind = 'photo' } = {}) {
  const place = a.place?.sk || '';
  const what = kind === 'video' ? 'Video' : 'Foto';
  return {
    aftermath: true, url: a.url, placeName: place,
    captionSk: 'Záchranári na mieste ruského útoku',
    kicker: `${place ? `${place.toUpperCase()} · ` : ''}ZÁCHRANÁRI`,
    credit: `${what}: ${a.label} · Telegram`,
    sourceLines: [], sources: [`${what}: ${a.label} (Telegram)`], inset: false, keepCaptions: true,
    ...(kind === 'video' ? {} : { fixedStart: 0 }),
  };
}
