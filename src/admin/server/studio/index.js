// OKO Štúdio sociálnych sietí (2026-10-03) — Fáza 1: posty s obrázkom, Fáza 2: reels.
//
// Tok: šablóna (živé dáta cez loopback na vlastné /api) → návrh s textom a
// obrázkom v admin.sqlite → úprava a schválenie v admine → zverejnenie na
// FB stránku / Instagram (Meta Graph API, zadarmo), alebo ručné zdieľanie.
//
// Automatika (plán: docs/SOCIAL-PLAN.md):
//   • auto-návrhy: každých 10 min zo šablón udalostí, denný prehľad o 8:00;
//     nič nestojí (zdroje sú bezplatné a cachované proxy),
//   • auto-zverejnenie: vypnuté; pre šablónu sa dá zapnúť až po 10 návrhoch
//     zverejnených bez úpravy textu, s denným stropom a tichým časom.
// Zastarané dáta sa nezverejňujú (CLAUDE.md pravidlo 2).
//
// Reels (Fáza 2): ku každému návrhu sa na pozadí vyrenderuje video 9:16 (reel.js,
// sharp + ffmpeg, jedno naraz). Súbory sú v .auth-data/studio (nie verejné);
// Instagram dostane podpísanú krátkodobú URL. Zverejnenie beží na pozadí —
// spracovanie videa u Mety trvá minúty a tunel by požiadavku zrušil.
import http from 'node:http';
import fsp from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { TEMPLATES as BASE_TEMPLATES } from './templates.js';
import { AIR_MIN_OBLASTS_DEFAULT, MEDIA_PER_DAY_DEFAULT, UA_TEMPLATES, mediaHostAllowed } from './ukraine.js';
import { renderCard as defaultRenderCard, renderPhotoCard as defaultRenderPhotoCard } from './card.js';
import { createMetaPublisher, isRetryableError } from './meta.js';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { ffmpegAvailable, padToReel as defaultPadToReel, posterFrame as defaultPosterFrame, renderReel as defaultRenderReel } from './reel.js';
import { LOOPBACK_HOST } from '../loopback.js';

/** Všetky šablóny: svetové udalosti (templates.js) + Ukrajina (ukraine.js, 2026-10-04). */
export const TEMPLATES = Object.freeze([...BASE_TEMPLATES, ...UA_TEMPLATES]);
export const templateById = id => TEMPLATES.find(template => template.id === id) || null;
/** Šablóna, ktorú nesmie zverejniť automatika (zábery z vojny — vždy schvaľuje človek). */
const autoPublishForbidden = template => template?.autoPublish === false;
/** Týždenná šablóna (karusel Týždňa na fronte): sobota od 9:00, po videu o 7:00. */
const WEEKLY = { weekday: 6, hour: 9 };
/** Najväčšie médium zo vzdialeného zdroja (fotka / video ArmyInform). */
const REMOTE_MAX = { image: 12 * 1024 * 1024, video: 150 * 1024 * 1024 };

const TICK_MS = 10 * 60_000;
const STALE_MS = 30 * 60_000;
const MEDIA_TTL_MS = 2 * 3600_000;
export const AUTO_PUBLISH_MIN_UNCHANGED = 10;
const DIGEST_HOUR = 8;
const INSIGHTS_REFRESH_MS = 6 * 3600_000;
const INSIGHTS_WINDOW_MS = 30 * 86400_000;
const SCHEDULE_MAX_MS = 30 * 86400_000;
// Opakovanie zlyhaného zverejnenia (2026-10-04): dočasná chyba Mety → 3 pokusy s odstupom.
export const RETRY_DELAYS_MS = Object.freeze([10 * 60_000, 30 * 60_000, 90 * 60_000]);
export const CAROUSEL_MAX = 10;
// Obmedzenia Instagramu (kontrola pred odoslaním): text, hashtagy, dĺžka reelu.
export const IG_LIMITS = Object.freeze({ text: 2200, hashtags: 30, reelMinSeconds: 3, reelMaxSeconds: 90, captionFold: 125 });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hour: '2-digit', hourCycle: 'h23' });
const localHour = at => Number(hourFmt.format(new Date(at)));
const fail = (code, status = 400) => Object.assign(new Error(code), { status });

export const TARGETS = Object.freeze(['facebook', 'instagram', 'facebook-reel', 'instagram-reel']);
const REEL_TARGETS = new Set(['facebook-reel', 'instagram-reel']);
const baseTarget = target => target.replace(/-reel$/, '');
export const DEFAULT_SETTINGS = Object.freeze({ autoDraft: true, autoReel: true, audio: 'ambient', voice: false, autoPublish: {},
  autoPublishPerDay: 5, quietFrom: 22, quietTo: 7, targets: [...TARGETS],
  // Týždeň na fronte (2026-10-03): sobota 7:00 spustí scripts/make-front-week-video.mjs a výsledok dá do Štúdia.
  frontWeek: { enabled: false, weekday: 6, hour: 7 },
  // Deň na fronte (2026-10-05): každé ráno po rannom hlásení GŠ (~7:00) spustí scripts/make-front-day-video.mjs;
  // beh trvá ~20–30 min, návrh je v Štúdiu pred 9:30.
  frontDay: { enabled: false, hour: 8 },
  // Ukrajina (2026-10-04): prah vzdušného útoku (počet oblastí), fotky/videá oficiálnych kanálov a ich denný strop.
  ua: { airMinOblasts: AIR_MIN_OBLASTS_DEFAULT, media: true, mediaPerDay: MEDIA_PER_DAY_DEFAULT } });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Bratislava', weekday: 'short' });
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const localWeekday = at => WEEKDAYS[weekdayFmt.format(new Date(at))] ?? 0;
const dayKeyFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' });
const localDayKey = at => dayKeyFmt.format(new Date(at));

export function loopbackJson(port, path, timeoutMs = 20_000) {
  return new Promise(resolve => {
    const req = http.get({ host: LOOPBACK_HOST, port, path, headers: { Host: `localhost:${port}`, Accept: 'application/json', 'X-OKO-Studio': '1' } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size <= 32 * 1024 * 1024) chunks.push(chunk); });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, headers: {}, body: null }));
  });
}

/**
 * Stiahne médium z povoleného hostiteľa (CDN Telegramu, ArmyInform) so stropom veľkosti.
 * @returns {Promise<Buffer>}
 */
export async function fetchRemoteMedia(url, { maxBytes, kind = 'image', fetchImpl = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  if (!mediaHostAllowed(url)) throw new Error('nepovolený zdroj média');
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { 'User-Agent': 'OKO-Studio/1.0 (+https://okolive.sk)' } });
  if (!res.ok) throw new Error(`médium: HTTP ${res.status}`);
  const type = String(res.headers?.get?.('content-type') || '');
  if (kind === 'image' && type && !/^image\//i.test(type)) throw new Error(`médium nie je obrázok (${type})`);
  if (kind === 'video' && type && !/^video\/|octet-stream/i.test(type)) throw new Error(`médium nie je video (${type})`);
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('médium je príliš veľké');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('médium je príliš veľké');
  if (!buf.length) throw new Error('médium je prázdne');
  return buf;
}

/** Verejná adresa portálu pre odkazy v príspevkoch a pre Instagram (stiahne si obrázok). */
export function publicUrlFrom(env = process.env) {
  for (const candidate of [env.STUDIO_PUBLIC_URL, env.AUTH_PUBLIC_URL, ...String(env.AUTH_ORIGINS || '').split(',')]) {
    try {
      const url = new URL(String(candidate || '').trim());
      if (url.protocol === 'https:') return url.origin;
    } catch { /* ďalší */ }
  }
  return 'https://okolive.sk';
}

export function createStudio({ store, env = process.env, port = () => null, now = Date.now, fetchJson = loopbackJson,
  renderCard = defaultRenderCard, renderPhotoCard = defaultRenderPhotoCard, fetchMedia = fetchRemoteMedia, renderReel = defaultRenderReel, padToReel = defaultPadToReel, posterFrame = defaultPosterFrame, checkFfmpeg = () => ffmpegAvailable(env.FFMPEG_PATH || 'ffmpeg'),
  mediaDir = null, publisher = createMetaPublisher({ env }), timers = true, log = message => console.warn(message),
  voiceProvider = null, frontWeekRunner = null, frontDayRunner = null, root = process.cwd(), onAlert = null } = {}) {
  const alert = (kind, detail) => { try { onAlert?.({ kind, ...detail }); } catch { /* upozornenie nesmie zhodiť Štúdio */ } };
  const publicUrl = publicUrlFrom(env);
  const site = new URL(publicUrl).host;
  let running = false;
  let timer = null;
  let videoChain = Promise.resolve();
  let ffmpegOk = null;
  const inFlight = new Map(); // id → zverejňovanie na pozadí
  const autoAfterVideo = new Set(); // auto-návrhy čakajúce na video pred auto-zverejnením
  let lastInsights = 0;
  let tickLoads = null; // Map load → Promise počas jedného ticku
  // Zábery, ktoré sa nepodarilo stiahnuť: 6 h sa preskočia, aby jeden pokazený príspevok nezablokoval ďalšie.
  const mediaFailed = new Map(); // kľúč → čas zlyhania
  const MEDIA_RETRY_MS = 6 * 3600_000;

  function secret() {
    let value = store.getSetting('studio:secret')?.value;
    if (!value) { value = randomBytes(32).toString('base64url'); store.setSetting('studio:secret', value, now(), 'system'); }
    return value;
  }
  const sign = (name, exp) => createHmac('sha256', secret()).update(`${name}.${exp}`).digest('base64url');

  function settings() {
    const stored = store.getSetting('studio:settings')?.value || {};
    return { ...DEFAULT_SETTINGS, ...stored, autoPublish: { ...(stored.autoPublish || {}) }, frontWeek: { ...DEFAULT_SETTINGS.frontWeek, ...(stored.frontWeek || {}) },
      frontDay: { ...DEFAULT_SETTINGS.frontDay, ...(stored.frontDay || {}) },
      ua: { ...DEFAULT_SETTINGS.ua, ...(stored.ua || {}) } };
  }

  function templateStats() {
    return TEMPLATES.map(template => ({ id: template.id, label: template.label, auto: template.auto,
      unchanged: store.studioUnchangedCount(template.id), autoPublish: Boolean(settings().autoPublish[template.id]),
      autoPublishAllowed: !autoPublishForbidden(template) }));
  }

  /** Načíta dáta šablóny; null + dôvod, ak sú nedostupné alebo staré. */
  async function loadData(template) {
    const p = port();
    if (!p) return { reason: 'server_not_ready' };
    // Šablóny s viacerými zdrojmi (Ukrajina) si dáta skladajú samy a samy strážia ich čerstvosť.
    if (typeof template.load === 'function') {
      // V jednom ticku sa rovnaký zdroj (napr. médiá pre poplachy aj zábery) načíta raz.
      const cached = tickLoads?.get(template.load);
      if (cached) return cached;
      const loading = (async () => {
        try { return await template.load({ get: path_ => fetchJson(p, path_), now: now(), root }); }
        catch (error) { log(`[studio] ${template.id} load: ${error?.message || error}`); return { reason: 'source_unavailable' }; }
      })();
      tickLoads?.set(template.load, loading);
      return loading;
    }
    const result = await fetchJson(p, template.path);
    if (result.status === 503 && result.body?.error === 'disabled_by_admin') return { reason: 'feed_disabled' };
    if (result.status !== 200 || !result.body) return { reason: 'source_unavailable' };
    const cache = String(result.headers?.['x-gev-cache'] || '').toUpperCase();
    // STALE, STALE-ERROR, STALE-RATELIMIT: proxy vrátila starú kópiu, lebo zdroj zlyhal.
    if (cache.startsWith('STALE')) return { reason: 'stale' };
    if (Number.isFinite(result.body.fetchedAt) && now() - result.body.fetchedAt > STALE_MS) return { reason: 'stale' };
    return { data: result.body };
  }

  function requireDraft(id) {
    const draft = store.studioGet(id);
    if (!draft) throw fail('draft_not_found', 404);
    return draft;
  }

  // ── video ──────────────────────────────────────────────────────────────
  const videoFile = draft => (mediaDir && draft.video ? path.join(mediaDir, path.basename(draft.video)) : null);
  /** Pás háčika reelu (snímky 0–3 s) — vedľa videa, maže sa s ním. */
  const hookFile = id => (mediaDir ? path.join(mediaDir, `${path.basename(id)}.hook.jpg`) : null);
  async function videoReady(draft) {
    const file = videoFile(draft);
    if (draft.videoStatus !== 'ready' || !file) return false;
    try { await fsp.access(file); return true; } catch { return false; }
  }
  async function renderVideo(id) {
    const draft = store.studioGet(id);
    if (!draft || draft.videoStatus !== 'queued') return;
    try {
      if (!mediaDir) throw new Error('Chýba priečinok pre videá.');
      if (ffmpegOk === null || ffmpegOk === false) ffmpegOk = await checkFfmpeg();
      if (!ffmpegOk) throw new Error('ffmpeg nie je nainštalovaný (alebo FFMPEG_PATH v .env).');
      store.studioUpdate(id, { videoStatus: 'rendering', videoError: null }, now());
      await fsp.mkdir(mediaDir, { recursive: true, mode: 0o700 });
      const name = `${id}.mp4`;
      const s = settings();
      let made;
      if (draft.card?.kind === 'import' && draft.card.sourceVideo) {
        // Importované video (Udalosti, Týždeň na fronte): 9:16 doplnením, bez nového renderu.
        // Rám s háčikom (veta z karty importu), titulkom a zdrojom; pás prvých 3 s pre admin.
        made = await padToReel(path.join(mediaDir, path.basename(draft.card.sourceVideo)), path.join(mediaDir, name),
          { env, card: { ...draft.card, at: draft.card.at ?? draft.createdAt }, title: draft.title, site, hookSheet: hookFile(id) });
      } else {
        made = await renderReel({ card: draft.card, title: draft.title, text: draft.text }, path.join(mediaDir, name),
          { audio: s.audio, voice: s.voice, env, site, voiceProvider, hookSheet: hookFile(id) });
      }
      store.studioUpdate(id, { video: name, videoStatus: 'ready', videoError: null, videoSeconds: Number.isFinite(made?.seconds) ? made.seconds : null }, now());
    } catch (error) {
      store.studioUpdate(id, { videoStatus: 'failed', videoError: String(error?.message || error).slice(0, 300) }, now());
      log(`[studio] video ${id}: ${error?.message || error}`);
    }
    if (autoAfterVideo.delete(id)) await maybeAutoPublish(store.studioGet(id));
  }
  function queueVideo(id) {
    const draft = requireDraft(id);
    if (['queued', 'rendering'].includes(draft.videoStatus)) return draft;
    const updated = store.studioUpdate(id, { videoStatus: 'queued', videoError: null }, now());
    videoChain = videoChain.then(() => renderVideo(id)).catch(() => {});
    return updated;
  }
  async function cleanupVideos() {
    if (!mediaDir) return;
    for (const row of store.studioExpiredVideos(now())) {
      await fsp.rm(path.join(mediaDir, path.basename(row.video)), { force: true });
      await fsp.rm(path.join(mediaDir, `${row.id}.src.mp4`), { force: true });
      await fsp.rm(hookFile(row.id), { force: true });
      store.studioUpdate(row.id, { video: null, videoStatus: null }, now());
    }
    let names = [];
    try { names = await fsp.readdir(mediaDir); } catch { return; }
    for (const name of names) {
      const match = /^([a-f0-9-]{36})(?:\.src\.mp4|\.mp4|\.hook\.jpg)$/.exec(name);
      if (match && !store.studioGet(match[1])) await fsp.rm(path.join(mediaDir, name), { force: true });
    }
  }

  async function generate(templateId, origin = 'manual') {
    const template = templateById(templateId);
    if (!template) throw fail('template_not_found', 404);
    const loaded = await loadData(template);
    if (!loaded.data) return { created: false, reason: loaded.reason };
    const s = settings();
    for (const [key, at] of mediaFailed) if (now() - at > MEDIA_RETRY_MS) mediaFailed.delete(key);
    const item = template.build(loaded.data, { now: now(), url: publicUrl, settings: s.ua, has: key => store.studioHasKey(key) || mediaFailed.has(key),
      countToday: id_ => store.studioList(500).filter(d => d.template === id_ && localDayKey(d.createdAt) === localDayKey(now())).length });
    if (!item) return { created: false, reason: 'nothing_to_post' };
    if (store.studioHasKey(item.key)) return { created: false, reason: 'exists', key: item.key };
    if (item.media) return generateFromMedia(template, item, origin);
    const image = await renderCard({ ...item.card, site });
    const id = randomUUID();
    const created = store.studioInsert({ id, template: template.id, eventKey: item.key, origin, title: item.title, text: item.text,
      card: item.card, image, createdAt: now() });
    if (!created) return { created: false, reason: 'exists', key: item.key };
    // Karusel (Týždeň na fronte): ďalšie snímky za hlavnou kartou.
    const slides = (item.slides || []).slice(0, CAROUSEL_MAX - 1);
    if (slides.length) store.studioImagesSet(id, await Promise.all(slides.map(card => renderCard({ ...card, site }))));
    if (s.autoReel && mediaDir) queueVideo(id);
    return { created: true, draft: store.studioGet(id) };
  }

  /**
   * Návrh z cudzích záberov (Ukrajina: oficiálne kanály UA, CC BY 4.0): fotky v ráme OKO ako karusel,
   * video ArmyInform ako zdroj reelu. Médiá sa sťahujú len z povolených hostiteľov so stropom veľkosti.
   */
  async function generateFromMedia(template, item, origin) {
    const { media } = item;
    const frame = { kicker: item.card.kicker, headline: item.title, source: media.license ? `${media.source} · ${media.license}` : media.source, at: media.at, site };
    const photos = [];
    for (const url of media.photos || []) {
      try { photos.push(await fetchMedia(url, { maxBytes: REMOTE_MAX.image, kind: 'image' })); }
      catch (error) { log(`[studio] ${template.id} foto: ${error?.message || error}`); }
    }
    let videoFile = null;
    if (media.video && mediaDir) {
      try {
        await fsp.mkdir(mediaDir, { recursive: true, mode: 0o700 });
        videoFile = path.join(mediaDir, `dl-${randomUUID()}.mp4`);
        await fsp.writeFile(videoFile, await fetchMedia(media.video, { maxBytes: REMOTE_MAX.video, kind: 'video' }));
      } catch (error) {
        log(`[studio] ${template.id} video: ${error?.message || error}`);
        if (videoFile) await fsp.rm(videoFile, { force: true });
        videoFile = null;
      }
    }
    if (!photos.length && !videoFile) { mediaFailed.set(item.key, now()); return { created: false, reason: 'source_unavailable', key: item.key }; }
    const framed = [];
    for (const [i, photo] of photos.entries()) {
      try { framed.push(await renderPhotoCard(photo, { ...frame, index: i, count: photos.length })); }
      catch (error) { log(`[studio] ${template.id} rám: ${error?.message || error}`); }
    }
    if (!framed.length && !videoFile) { mediaFailed.set(item.key, now()); return { created: false, reason: 'source_unavailable', key: item.key }; }
    try {
      const result = await api.importDraft({ template: template.id, eventKey: item.key, title: item.title, text: item.text,
        image: framed[0] || null, images: framed.slice(1), videoFile, origin,
        meta: { source: media.source, sourceUrl: media.url, review: media.review, kicker: item.card.kicker } });
      return result.created ? { created: true, draft: result.draft } : { created: false, reason: 'exists', key: item.key };
    } finally {
      if (videoFile) await fsp.rm(videoFile, { force: true });
    }
  }

  function quiet(at = now()) {
    const { quietFrom, quietTo } = settings();
    const hour = localHour(at);
    return quietFrom > quietTo ? hour >= quietFrom || hour < quietTo : hour >= quietFrom && hour < quietTo;
  }

  async function maybeAutoPublish(draft) {
    const s = settings();
    if (!draft || draft.origin !== 'auto' || !s.autoPublish[draft.template] || autoPublishForbidden(templateById(draft.template))) return;
    if (store.studioUnchangedCount(draft.template) < AUTO_PUBLISH_MIN_UNCHANGED) return;
    if (quiet()) return;
    if (store.studioPublishedSince(now() - 86400_000, 'auto') >= s.autoPublishPerDay) return;
    const status = publisher.status();
    const ready = await videoReady(draft);
    const targets = s.targets.filter(target => status[baseTarget(target)] && (!REEL_TARGETS.has(target) || ready));
    if (!targets.length) return;
    try { await (await publish(draft.id, targets, 'auto')).done; } catch (error) { log(`[studio] auto-publish: ${error?.message || error}`); }
  }

  /** Naplánované príspevky, ktorých čas nastal — zverejniť (každý tick). */
  async function publishDue() {
    const published = [];
    for (const id of store.studioDue(now())) {
      const draft = store.studioGet(id);
      const targets = (draft.scheduledTargets || []).filter(t => !draft.results?.[t]?.id);
      store.studioUpdate(id, { scheduledAt: null, scheduledTargets: null }, now());
      if (!targets.length) continue;
      try {
        const { done } = await publish(id, targets, 'scheduled');
        published.push({ id, draft: (await done).draft });
      } catch (error) {
        log(`[studio] scheduled ${id}: ${error?.message || error}`);
        store.studioUpdate(id, { status: 'failed', results: { ...draft.results, scheduled: { error: String(error?.message || error).slice(0, 200), at: now() } } }, now());
      }
    }
    return published;
  }

  /** Opakovanie zverejnenia po dočasnej chybe (každý tick): ciele s chybou a bez ID. */
  async function publishRetryDue() {
    const retried = [];
    for (const id of store.studioRetryDue(now())) {
      const draft = store.studioGet(id);
      const targets = Object.entries(draft.results || {}).filter(([t, r]) => TARGETS.includes(t) && r?.error && !r.id).map(([t]) => t);
      store.studioUpdate(id, { retryAt: null }, now());
      if (!targets.length) continue;
      try { retried.push({ id, draft: (await (await publish(id, targets, 'retry')).done).draft }); }
      catch (error) { log(`[studio] retry ${id}: ${error?.message || error}`); }
    }
    return retried;
  }

  /**
   * Najlepší čas zverejnenia (2026-10-04) z Výkonu: priemerný dosah (inak zobrazenia, inak reakcie)
   * podľa dňa v týždni a hodiny (Bratislava) za zverejnené príspevky; návrh = najbližší termín
   * najlepšieho slotu mimo tichých hodín. Len agregácia nad tým, čo už ukladáme — 0 €.
   */
  function bestTimes() {
    const all = store.insightsAll();
    const slots = new Map();
    let posts = 0;
    for (const draft of store.studioPublished(200)) {
      if (!draft.publishedAt) continue;
      const metrics = Object.values(all[draft.id] || {});
      if (!metrics.length) continue;
      const score = metrics.reduce((sum, m) => sum + (m.reach ?? m.views ?? m.likes ?? 0), 0);
      const key = `${localWeekday(draft.publishedAt)}-${localHour(draft.publishedAt)}`;
      const slot = slots.get(key) || slots.set(key, { weekday: localWeekday(draft.publishedAt), hour: localHour(draft.publishedAt), sum: 0, n: 0 }).get(key);
      slot.sum += score; slot.n++; posts++;
    }
    const ranked = [...slots.values()].map(slot => ({ weekday: slot.weekday, hour: slot.hour, n: slot.n, score: Math.round(slot.sum / slot.n) }))
      .sort((a, b) => b.score - a.score || b.n - a.n);
    const enough = posts >= 5 && ranked.length > 0;
    let suggestion = null;
    if (enough) {
      const best = ranked[0];
      // Najbližší výskyt dňa+hodiny od teraz (+30 min rezerva), v rámci 7 dní, mimo tichých hodín.
      for (let i = 0; i < 7 * 24 && !suggestion; i++) {
        const at = Math.ceil((now() + 30 * 60_000) / 3600_000) * 3600_000 + i * 3600_000;
        if (localWeekday(at) === best.weekday && localHour(at) === best.hour && !quiet(at)) suggestion = at;
      }
    }
    return { enough, posts, slots: ranked.slice(0, 10), suggestion };
  }

  /**
   * Kontroly obmedzení pred odoslaním (2026-10-04): Instagram odmietne text nad 2 200 znakov,
   * viac než 30 hashtagov a reel kratší než 3 s (dlhší než 90 s); prvých ~125 znakov vidno bez „viac".
   * Vracia zoznam { level: 'error'|'warn'|'info', target: 'instagram'|'facebook'|'all', text }.
   */
  function checks(draft) {
    const out = [];
    const text = String(draft.text || '');
    const chars = [...text].length;
    const hashtags = (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
    if (chars > IG_LIMITS.text) out.push({ level: 'error', target: 'instagram', text: `Text má ${chars} znakov, Instagram povolí ${IG_LIMITS.text}.` });
    if (hashtags > IG_LIMITS.hashtags) out.push({ level: 'error', target: 'instagram', text: `${hashtags} hashtagov, Instagram povolí ${IG_LIMITS.hashtags}.` });
    if (hashtags === 0) out.push({ level: 'info', target: 'all', text: 'Bez hashtagov — zvážte 3–5 (#OKO a téma).' });
    const firstLine = text.split('\n').find(line => line.trim()) || '';
    if ([...firstLine].length > IG_LIMITS.captionFold) out.push({ level: 'warn', target: 'all', text: `Prvý riadok má ${[...firstLine].length} znakov; v prehľade vidno ~${IG_LIMITS.captionFold}, zvyšok až po „viac".` });
    if (!/https?:\/\//.test(text) && !text.includes(site)) out.push({ level: 'info', target: 'facebook', text: 'Text nemá odkaz na portál.' });
    if (draft.videoStatus === 'ready' && Number.isFinite(draft.videoSeconds)) {
      if (draft.videoSeconds < IG_LIMITS.reelMinSeconds) out.push({ level: 'error', target: 'instagram', text: `Reel má ${draft.videoSeconds} s, Instagram chce aspoň ${IG_LIMITS.reelMinSeconds} s.` });
      if (draft.videoSeconds > IG_LIMITS.reelMaxSeconds) out.push({ level: 'warn', target: 'instagram', text: `Reel má ${Math.round(draft.videoSeconds)} s; Instagram Reels cez API najviac ${IG_LIMITS.reelMaxSeconds} s.` });
    }
    if (draft.slides > CAROUSEL_MAX) out.push({ level: 'warn', target: 'all', text: `Karusel má ${draft.slides} snímok, odošle sa prvých ${CAROUSEL_MAX}.` });
    if (draft.card?.review) out.push({ level: 'warn', target: 'all', text: draft.card.review });
    return out;
  }

  /** Štatistiky dosahu zverejnených príspevkov za 30 dní, najviac raz za 6 h. */
  async function refreshInsights(force = false) {
    if (!force && now() - lastInsights < INSIGHTS_REFRESH_MS) return { skipped: 'fresh' };
    const status = publisher.status();
    if (!status.facebook && !status.instagram) return { skipped: 'meta_not_configured' };
    if (typeof publisher.insights !== 'function') return { skipped: 'unsupported' };
    lastInsights = now();
    let fetched = 0; let failed = 0;
    for (const draft of store.studioPublished(60)) {
      if (!draft.publishedAt || now() - draft.publishedAt > INSIGHTS_WINDOW_MS) continue;
      for (const [target, result] of Object.entries(draft.results)) {
        if (!result?.id || !TARGETS.includes(target) || !status[baseTarget(target)]) continue;
        try { store.insightsSet(draft.id, target, await publisher.insights(target, result.id), now()); fetched++; }
        catch (error) { failed++; log(`[studio] insights ${target} ${draft.id}: ${error?.message || error}`); }
      }
    }
    return { fetched, failed };
  }

  // ── Týždeň na fronte ──────────────────────────────────────────────────
  /**
   * Rám reelu (2026-10-04, háčik): výrok týždňa má video vo vlastnej úvodnej karte — rám nad videom ukáže
   * 0–2,8 s rámec (TÝŽDEŇ NA FRONTE + rozsah dní), potom prvú vetu príspevku (háčik) ako titulok. Pure.
   */
  function frontWeekReelMeta(text, weekTo) {
    const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
    const range = /Týždeň na fronte \(([^)]+)\)/.exec(text || '')?.[1] || null;
    return {
      kicker: 'TÝŽDEŇ NA FRONTE',
      hook: { text: `TÝŽDEŇ NA FRONTE${range ? ` · ${range.toUpperCase()}` : ''}`, accent: '' },
      headline: (lines[0] || '').replace(/\.$/, ''),
      ...(Number.isFinite(Date.parse(weekTo)) ? { at: Date.parse(`${weekTo}T12:00:00Z`) } : {}),
    };
  }
  const frontWeek = { running: false, startedAt: null, finishedAt: null, error: null, log: '', lastKey: null };
  /**
   * Spustí scripts/make-front-week-video.mjs (vlastný proces, až hodinu) a výsledok dá do Štúdia
   * ako návrh s videom 4:5 (reel vznikne doplnením). Potrebuje bežiaci dev server s Cesiom
   * (EVENT_VIDEO_PAGE_URL, inak http://localhost:4173).
   */
  async function runFrontWeek({ day = null, trigger = 'manual' } = {}) {
    if (frontWeek.running) throw fail('front_week_running', 409);
    if (!mediaDir) throw fail('studio_unavailable', 503);
    frontWeek.running = true; frontWeek.startedAt = now(); frontWeek.finishedAt = null; frontWeek.error = null; frontWeek.log = '';
    const outDir = path.join(mediaDir, 'front-week', day || localDayKey(now()));
    try {
      const run = frontWeekRunner || defaultFrontWeekRunner;
      const result = await run({ root, env, outDir, day, onLog: line => { frontWeek.log = (frontWeek.log + line).slice(-4000); } });
      const text = await fsp.readFile(result.post, 'utf8');
      const weekTo = /tyzden-na-fronte-(\d{4}-\d{2}-\d{2})/.exec(path.basename(result.video))?.[1] || day || localDayKey(now());
      const imported = await api.importDraft({ template: 'front-week', eventKey: `front-week:${weekTo}`, title: `Týždeň na fronte · do ${weekTo}`,
        text, image: null, videoFile: result.video, origin: trigger === 'auto' ? 'auto' : 'manual',
        meta: { source: 'okolive.sk · Generálny štáb Ukrajiny', weekTo, srt: result.srt || null, ...frontWeekReelMeta(text, weekTo) } });
      frontWeek.lastKey = `front-week:${weekTo}`;
      return imported;
    } catch (error) {
      frontWeek.error = String(error?.message || error).slice(0, 400);
      log(`[studio] front-week: ${frontWeek.error}`);
      throw error;
    } finally { frontWeek.running = false; frontWeek.finishedAt = now(); }
  }
  function frontWeekDue() {
    const cfg = settings().frontWeek;
    if (!cfg?.enabled || frontWeek.running || frontDay.running) return false;
    const at = now();
    if (localWeekday(at) !== cfg.weekday || localHour(at) < cfg.hour) return false;
    // Raz za týždeň: ak už dnešný/tento týždeň má návrh, nič.
    const key = `front-week:${localDayKey(at)}`;
    if (store.studioHasKey(key) || frontWeek.lastKey === key) return false;
    if (frontWeek.finishedAt && localDayKey(frontWeek.finishedAt) === localDayKey(at)) return false; // dnes už bežal (aj neúspešne)
    return true;
  }

  // ── Deň na fronte ─────────────────────────────────────────────────────
  /** Rám reelu: video je už 9:16 s vlastnou úvodnou kartou (háčik) — bez doplnenia (card.vertical). Pure. */
  function frontDayReelMeta(text, day) {
    const first = String(text || '').split('\n').map(line => line.trim()).find(Boolean) || '';
    return {
      vertical: true,
      kicker: 'DEŇ NA FRONTE',
      hook: { text: 'DEŇ NA FRONTE', accent: '' },
      headline: first.replace(/\.$/, ''),
      ...(Number.isFinite(Date.parse(day)) ? { at: Date.parse(`${day}T12:00:00Z`) } : {}),
    };
  }
  const frontDay = { running: false, startedAt: null, finishedAt: null, error: null, errorCode: null, log: '', lastKey: null };
  /** Ranné hlásenie ešte nevyšlo (NO_DATA): skúsi znova o 30 min, najneskôr do 11:00. */
  const FRONT_DAY_RETRY_MS = 30 * 60_000;
  const FRONT_DAY_LAST_HOUR = 11;
  /**
   * Spustí scripts/make-front-day-video.mjs (vlastný proces, ~20–30 min) a výsledok (9:16, titulky, text
   * príspevku) dá do Štúdia ako návrh. Stránka z dev servera s Cesiom (EVENT_VIDEO_PAGE_URL), dáta zo služby API.
   */
  async function runFrontDay({ trigger = 'manual' } = {}) {
    if (frontDay.running) throw fail('front_day_running', 409);
    if (frontWeek.running) throw fail('front_week_running', 409);
    if (!mediaDir) throw fail('studio_unavailable', 503);
    frontDay.running = true; frontDay.startedAt = now(); frontDay.finishedAt = null; frontDay.error = null; frontDay.errorCode = null; frontDay.log = '';
    const outDir = path.join(mediaDir, 'front-day', localDayKey(now()));
    try {
      const run = frontDayRunner || defaultFrontDayRunner;
      const result = await run({ root, env, outDir, onLog: line => { frontDay.log = (frontDay.log + line).slice(-4000); } });
      const text = await fsp.readFile(result.post, 'utf8');
      const day = /den-na-fronte-(\d{4}-\d{2}-\d{2})/.exec(path.basename(result.video))?.[1] || localDayKey(now());
      const imported = await api.importDraft({ template: 'front-day', eventKey: `front-day:${day}`, title: `Deň na fronte · ${day}`,
        text, image: null, videoFile: result.video, origin: trigger === 'auto' ? 'auto' : 'manual',
        meta: { source: 'okolive.sk · Generálny štáb Ukrajiny · ArmyInform', day, srt: result.srt || null, ...frontDayReelMeta(text, day) } });
      frontDay.lastKey = `front-day:${localDayKey(now())}`;
      return imported;
    } catch (error) {
      frontDay.error = String(error?.message || error).slice(0, 400);
      frontDay.errorCode = error?.code || null;
      log(`[studio] front-day: ${frontDay.error}`);
      throw error;
    } finally { frontDay.running = false; frontDay.finishedAt = now(); }
  }
  function frontDayDue() {
    const cfg = settings().frontDay;
    if (!cfg?.enabled || frontDay.running || frontWeek.running) return false;
    const at = now();
    if (localHour(at) < cfg.hour) return false;
    const key = `front-day:${localDayKey(at)}`;
    if (store.studioHasKey(key) || frontDay.lastKey === key) return false;
    if (frontDay.finishedAt && localDayKey(frontDay.finishedAt) === localDayKey(at)) {
      // Dnes už bežal: znova len keď hlásenie ešte nebolo (a nie donekonečna).
      const waiting = frontDay.errorCode === 'NO_DATA' && at - frontDay.finishedAt >= FRONT_DAY_RETRY_MS && localHour(at) < FRONT_DAY_LAST_HOUR;
      if (!waiting) return false;
    }
    return true;
  }

  async function tick() {
    if (running) return { skipped: 'running' };
    running = true;
    tickLoads = new Map();
    const out = [];
    try {
      await cleanupVideos().catch(error => log(`[studio] cleanup: ${error?.message || error}`));
      await publishDue().catch(error => log(`[studio] due: ${error?.message || error}`));
      await publishRetryDue().catch(error => log(`[studio] retry: ${error?.message || error}`));
      refreshInsights().catch(error => log(`[studio] insights: ${error?.message || error}`));
      if (frontWeekDue()) runFrontWeek({ trigger: 'auto' }).catch(() => {});
      else if (frontDayDue()) runFrontDay({ trigger: 'auto' }).catch(() => {});
      if (!settings().autoDraft) return { skipped: 'auto_draft_off' };
      for (const template of TEMPLATES.filter(t => t.auto)) {
        if (template.auto === 'daily' && localHour(now()) < DIGEST_HOUR) continue;
        if (template.auto === 'weekly' && (localWeekday(now()) !== WEEKLY.weekday || localHour(now()) < WEEKLY.hour)) continue;
        try {
          const result = await generate(template.id, 'auto');
          out.push({ template: template.id, ...result, draft: undefined, id: result.draft?.id });
          if (!result.created) continue;
          // S videom počkať na render (reel ide spolu s fotkou); inak hneď.
          if (['queued', 'rendering'].includes(store.studioGet(result.draft.id).videoStatus)) autoAfterVideo.add(result.draft.id);
          else await maybeAutoPublish(result.draft);
        } catch (error) { log(`[studio] ${template.id}: ${error?.message || error}`); }
      }
      return { results: out };
    } finally { running = false; tickLoads = null; }
  }

  function mediaUrl(id, ttl = MEDIA_TTL_MS, ext = 'jpg', idx = 0) {
    const exp = now() + ttl;
    const name = `${id}${idx ? `-${idx}` : ''}.${ext}`;
    return `${publicUrl}/api/studio/media/${name}?exp=${exp}&sig=${sign(name, exp)}`;
  }

  /**
   * Zverejnenie na pozadí. Vracia hneď { draft (s pending), done (Promise s výsledkom) }.
   * Ciele: facebook, instagram (fotka), facebook-reel, instagram-reel (video).
   */
  async function publish(id, targets, origin = 'manual') {
    const draft = requireDraft(id);
    if (inFlight.has(id)) throw fail('publish_in_progress', 409);
    if (draft.status === 'discarded') throw fail('draft_not_publishable', 409);
    const wanted = [...new Set(targets)].filter(target => TARGETS.includes(target));
    if (!wanted.length) throw fail('no_target');
    const status = publisher.status();
    if (wanted.some(target => !status[baseTarget(target)])) throw fail('meta_not_configured', 409);
    const todo = wanted.filter(target => !draft.results[target]?.id);
    if (!todo.length) throw fail('nothing_to_publish', 409);
    if (todo.some(target => REEL_TARGETS.has(target)) && !(await videoReady(draft))) throw fail('video_not_ready', 409);
    const image = store.studioImage(id);
    if (!image || !draft.text.trim()) throw fail('draft_incomplete', 409);
    // Instagram odmietne, čo nespĺňa limity — povedať to pred odoslaním, nie z chyby API.
    const blocking = checks(draft).filter(c => c.level === 'error' && todo.some(t => c.target === 'all' || baseTarget(t) === c.target));
    if (blocking.length) throw Object.assign(fail('limits_exceeded', 409), { details: blocking.map(c => c.text) });
    const time = now();
    const pending = { ...draft.results };
    for (const target of todo) pending[target] = { pending: true, at: time };
    store.studioUpdate(id, { results: pending, scheduledAt: null, scheduledTargets: null, retryAt: null,
      ...(draft.status === 'published' ? {} : { status: 'approved', approvedAt: draft.approvedAt ?? time }) }, time);
    const images = store.studioImages(id).slice(0, CAROUSEL_MAX);
    const carousel = images.length > 1;
    const done = (async () => {
      const results = { ...pending };
      const failures = [];
      for (const target of todo) {
        try {
          let result;
          if (target === 'facebook') {
            result = carousel && typeof publisher.facebookCarousel === 'function' ? await publisher.facebookCarousel({ images, text: draft.text })
              : await publisher.facebookPhoto({ image, text: draft.text });
          } else if (target === 'instagram') {
            result = carousel && typeof publisher.instagramCarousel === 'function'
              ? await publisher.instagramCarousel({ imageUrls: images.map((_, i) => mediaUrl(id, 30 * 60_000, 'jpg', i)), text: draft.text })
              : await publisher.instagramImage({ imageUrl: mediaUrl(id, 30 * 60_000), text: draft.text });
          } else if (target === 'facebook-reel') result = await publisher.facebookReel({ video: await fsp.readFile(videoFile(draft)), text: draft.text });
          else result = await publisher.instagramReel({ videoUrl: mediaUrl(id, 60 * 60_000, 'mp4'), text: draft.text });
          results[target] = { ...result, at: now() };
        } catch (error) {
          results[target] = { error: String(error?.message || error).slice(0, 300), at: now(), retryable: isRetryableError(error) };
          failures.push({ target, error });
          log(`[studio] publish ${target} failed: ${results[target].error}`);
        }
        store.studioUpdate(id, { results }, now());
      }
      const ok = todo.every(target => results[target]?.id);
      const wasPublished = draft.status === 'published';
      // Dočasná chyba → ďalší pokus o 10 / 30 / 90 min; trvalá alebo 4. zlyhanie → failed + upozornenie.
      const attempt = origin === 'retry' ? (draft.retryN || 0) : 0;
      const retry = !ok && failures.some(f => isRetryableError(f.error)) && attempt < RETRY_DELAYS_MS.length;
      const fields = { results, status: ok || wasPublished ? 'published' : retry ? 'approved' : 'failed',
        retryAt: retry ? now() + RETRY_DELAYS_MS[attempt] : null, retryN: retry ? attempt + 1 : attempt,
        ...((ok && !wasPublished) ? { publishedAt: now() } : {}) };
      const updated = store.studioUpdate(id, fields, now());
      if (!ok && !retry) alert('publish_failed', { title: draft.title, id, targets: failures.map(f => f.target), error: failures.map(f => String(f.error?.message || f.error).slice(0, 200)).join(' | '), attempts: attempt + 1 });
      return { draft: updated, origin, retry };
    })().finally(() => inFlight.delete(id));
    inFlight.set(id, done);
    return { draft: store.studioGet(id), done };
  }

  const api = {
    templates: TEMPLATES,
    publicUrl,
    limits: IG_LIMITS,
    runFrontWeek,
    frontWeekStatus: () => ({ ...frontWeek, due: frontWeekDue() }),
    runFrontDay,
    frontDayStatus: () => ({ ...frontDay, due: frontDayDue() }),
    settings,
    templateStats,
    generate,
    tick,
    publish,
    mediaUrl,
    queueVideo,
    /** Promise, ktorý sa splní, keď sa dorenderujú videá vo fronte (testy, údržba). */
    videosIdle: () => videoChain,
    list: limit => store.studioList(limit),
    /**
     * Návrh z hotových podkladov inej časti OKO (Udalosti, Týždeň na fronte): text, obrázok a
     * voliteľne video 4:5 (skopíruje sa k Štúdiu; reel vznikne doplnením na 9:16).
     * @param {{template:string, eventKey:string, title:string, text:string, image?:Buffer|null, videoFile?:string|null, origin?:string, meta?:object}} input
     */
    async importDraft({ template, eventKey, title, text, image = null, images = [], videoFile = null, origin = 'import', meta = {} }) {
      if (!/^[a-z0-9-]{1,40}$/.test(String(template || '')) || typeof eventKey !== 'string' || !eventKey) throw fail('invalid_input');
      if (typeof title !== 'string' || !title.trim() || typeof text !== 'string' || !text.trim()) throw fail('draft_incomplete');
      const existing = store.studioList(500).find(d => d.eventKey === eventKey);
      if (existing) return { created: false, reason: 'exists', draft: existing };
      const id = randomUUID();
      let picture = image;
      if (!picture && videoFile) { try { picture = await posterFrame(videoFile, { env }); } catch { picture = null; } }
      if (!picture) picture = await renderCard({ kind: 'import', kicker: 'OKO', big: '', headline: title, lines: [], source: meta.source || 'OKO', at: now(), site });
      let sourceVideo = null;
      if (videoFile && mediaDir) {
        await fsp.mkdir(mediaDir, { recursive: true, mode: 0o700 });
        sourceVideo = `${id}.src.mp4`;
        await fsp.copyFile(videoFile, path.join(mediaDir, sourceVideo));
      }
      const card = { kind: 'import', sourceVideo, ...meta };
      const created = store.studioInsert({ id, template, eventKey, origin, title: title.trim().slice(0, 200), text: text.replace(/\r\n/g, '\n').slice(0, 2200),
        card, image: picture, createdAt: now() });
      if (!created) return { created: false, reason: 'exists' };
      // Karusel: ďalšie snímky (max 9 navyše k hlavnej) — Udalosti dodajú kľúčové momenty.
      const extras = (Array.isArray(images) ? images : []).filter(buf => Buffer.isBuffer(buf) && buf.length).slice(0, CAROUSEL_MAX - 1);
      if (extras.length) store.studioImagesSet(id, extras);
      if (sourceVideo && settings().autoReel) queueVideo(id);
      return { created: true, draft: store.studioGet(id) };
    },
    /** Pôvodné (neorezané) video importovaného návrhu — na stiahnutie a zverejnenie fotky+videa 4:5. */
    sourceVideoPath(id) {
      const draft = requireDraft(id);
      return mediaDir && draft.card?.sourceVideo ? path.join(mediaDir, path.basename(draft.card.sourceVideo)) : null;
    },
    publishDue,
    publishRetryDue,
    refreshInsights,
    bestTimes,
    checks,
    /** Kalendár: naplánované + zverejnené podľa miestneho dňa. */
    calendar(days = 14) {
      const from = now() - 7 * 86400_000;
      const to = now() + days * 86400_000;
      const items = store.studioList(500).filter(d => (d.scheduledAt && d.scheduledAt <= to) || (d.publishedAt && d.publishedAt >= from))
        .map(d => ({ id: d.id, title: d.title, template: d.template, status: d.status, at: d.scheduledAt ?? d.publishedAt,
          kind: d.scheduledAt ? 'scheduled' : 'published', targets: d.scheduledAt ? d.scheduledTargets : Object.keys(d.results || {}).filter(t => d.results[t]?.id) }))
        .sort((a, b) => a.at - b.at);
      return items;
    },
    insights() {
      const all = store.insightsAll();
      return store.studioPublished(100).map(d => ({ id: d.id, title: d.title, template: d.template, publishedAt: d.publishedAt,
        targets: Object.fromEntries(Object.entries(d.results).filter(([t, r]) => r?.id && TARGETS.includes(t)).map(([t, r]) => [t, { url: r.url || null, ...(all[d.id]?.[t] || {}) }])) }))
        .filter(d => Object.keys(d.targets).length);
    },
    /** Naplánuje zverejnenie na čas (do 30 dní); null zruší plán. */
    schedule(id, at, targets) {
      const draft = requireDraft(id);
      if (at === null) return store.studioUpdate(id, { scheduledAt: null, scheduledTargets: null }, now());
      if (draft.status === 'discarded' || draft.status === 'published' && !targets?.length) throw fail('draft_not_publishable', 409);
      if (!Number.isFinite(at) || at < now() - 60_000 || at > now() + SCHEDULE_MAX_MS) throw fail('invalid_schedule');
      const wanted = [...new Set(targets || [])].filter(t => TARGETS.includes(t));
      if (!wanted.length) throw fail('no_target');
      const status = publisher.status();
      if (wanted.some(t => !status[baseTarget(t)])) throw fail('meta_not_configured', 409);
      if (!draft.text.trim()) throw fail('draft_incomplete', 409);
      return store.studioUpdate(id, { scheduledAt: Math.round(at), scheduledTargets: wanted,
        ...(draft.status === 'published' ? {} : { status: 'approved', approvedAt: draft.approvedAt ?? now() }) }, now());
    },
    get: requireDraft,
    image: (id, idx = 0) => store.studioImageAt(id, idx),
    videoPath: id => { const draft = requireDraft(id); return draft.videoStatus === 'ready' ? videoFile(draft) : null; },
    /** Pás háčika (JPEG) alebo null, ak reel ešte nie je, je importovaný alebo pás chýba. */
    async hookSheet(id) {
      const draft = requireDraft(id);
      if (draft.videoStatus !== 'ready' || !hookFile(id)) return null;
      try { return await fsp.readFile(hookFile(id)); } catch { return null; }
    },
    publisherStatus: () => publisher.status(),
    instagramLimit: () => publisher.instagramLimit(),
    async capabilities() {
      if (ffmpegOk === null) ffmpegOk = await checkFfmpeg();
      let music = 0;
      try { music = env.STUDIO_MUSIC_DIR ? (await fsp.readdir(env.STUDIO_MUSIC_DIR)).filter(n => /\.(mp3|wav|ogg|m4a|flac)$/i.test(n)).length : 0; } catch { music = 0; }
      return { ffmpeg: ffmpegOk, voice: Boolean(voiceProvider) || Boolean(env.PIPER_PATH && env.PIPER_MODEL), ownerVoice: Boolean(voiceProvider),
        music, mediaDir: Boolean(mediaDir), frontWeek: Boolean(frontWeekRunner || mediaDir), frontDay: Boolean(frontDayRunner || mediaDir) };
    },
    edit(id, text) {
      const draft = requireDraft(id);
      if (!['draft', 'approved', 'failed'].includes(draft.status)) throw fail('draft_not_editable', 409);
      if (typeof text !== 'string' || !text.trim() || [...text].length > 2200) throw fail('invalid_text');
      return store.studioUpdate(id, { text: text.replace(/\r\n/g, '\n') }, now());
    },
    setStatus(id, status) {
      const draft = requireDraft(id);
      if (!['draft', 'approved', 'discarded'].includes(status) || draft.status === 'published') throw fail('invalid_status', 409);
      return store.studioUpdate(id, { status, ...(status === 'approved' ? { approvedAt: now() } : {}) }, now());
    },
    /** Ručné zdieľanie (osobný profil): admin zverejnil sám, označí ako zverejnené. */
    markShared(id) {
      const draft = requireDraft(id);
      if (draft.status === 'published') return draft;
      return store.studioUpdate(id, { status: 'published', publishedAt: now(), results: { ...draft.results, manual: { at: now() } } }, now());
    },
    setSettings(patch) {
      const current = settings();
      const next = { ...current };
      for (const key of ['autoDraft', 'autoReel', 'voice']) if (key in patch) next[key] = Boolean(patch[key]);
      if ('audio' in patch) {
        if (!['ambient', 'music', 'none'].includes(patch.audio)) throw fail('invalid_input');
        next.audio = patch.audio;
      }
      if ('autoPublishPerDay' in patch) {
        if (!Number.isInteger(patch.autoPublishPerDay) || patch.autoPublishPerDay < 0 || patch.autoPublishPerDay > 50) throw fail('invalid_input');
        next.autoPublishPerDay = patch.autoPublishPerDay;
      }
      for (const key of ['quietFrom', 'quietTo']) {
        if (!(key in patch)) continue;
        if (!Number.isInteger(patch[key]) || patch[key] < 0 || patch[key] > 23) throw fail('invalid_input');
        next[key] = patch[key];
      }
      if ('targets' in patch) {
        if (!Array.isArray(patch.targets) || patch.targets.some(t => !TARGETS.includes(t))) throw fail('invalid_input');
        next.targets = [...new Set(patch.targets)];
      }
      if ('frontWeek' in patch) {
        const fw = patch.frontWeek;
        if (!fw || typeof fw !== 'object') throw fail('invalid_input');
        const next_ = { ...current.frontWeek };
        if ('enabled' in fw) next_.enabled = Boolean(fw.enabled);
        if ('weekday' in fw) { if (!Number.isInteger(fw.weekday) || fw.weekday < 0 || fw.weekday > 6) throw fail('invalid_input'); next_.weekday = fw.weekday; }
        if ('hour' in fw) { if (!Number.isInteger(fw.hour) || fw.hour < 0 || fw.hour > 23) throw fail('invalid_input'); next_.hour = fw.hour; }
        next.frontWeek = next_;
      }
      if ('frontDay' in patch) {
        const fd = patch.frontDay;
        if (!fd || typeof fd !== 'object' || Object.keys(fd).some(key => !['enabled', 'hour'].includes(key))) throw fail('invalid_input');
        const nextFd = { ...current.frontDay };
        if ('enabled' in fd) nextFd.enabled = Boolean(fd.enabled);
        if ('hour' in fd) { if (!Number.isInteger(fd.hour) || fd.hour < 5 || fd.hour > 12) throw fail('invalid_input'); nextFd.hour = fd.hour; }
        next.frontDay = nextFd;
      }
      if ('ua' in patch) {
        const ua = patch.ua;
        if (!ua || typeof ua !== 'object') throw fail('invalid_input');
        const nextUa = { ...current.ua };
        if ('airMinOblasts' in ua) { if (!Number.isInteger(ua.airMinOblasts) || ua.airMinOblasts < 2 || ua.airMinOblasts > 25) throw fail('invalid_input'); nextUa.airMinOblasts = ua.airMinOblasts; }
        if ('mediaPerDay' in ua) { if (!Number.isInteger(ua.mediaPerDay) || ua.mediaPerDay < 0 || ua.mediaPerDay > 30) throw fail('invalid_input'); nextUa.mediaPerDay = ua.mediaPerDay; }
        if ('media' in ua) nextUa.media = Boolean(ua.media);
        next.ua = nextUa;
      }
      if ('autoPublish' in patch) {
        if (!patch.autoPublish || typeof patch.autoPublish !== 'object') throw fail('invalid_input');
        for (const [templateId, enabled] of Object.entries(patch.autoPublish)) {
          if (!templateById(templateId) || typeof enabled !== 'boolean') throw fail('invalid_input');
          if (enabled && autoPublishForbidden(templateById(templateId))) throw fail('auto_publish_forbidden', 409);
          // Server vynúti podmienku: najprv 10 zverejnení bez úpravy textu.
          if (enabled && store.studioUnchangedCount(templateId) < AUTO_PUBLISH_MIN_UNCHANGED) throw fail('auto_publish_not_earned', 409);
          next.autoPublish[templateId] = enabled;
        }
      }
      store.setSetting('studio:settings', next, now(), 'owner');
      return settings();
    },
    /**
     * Verejný endpoint médií pre Instagram: len podpísaný, časovo obmedzený, len
     * schválený/zverejnený návrh. Video podporuje Range (Meta sťahuje po častiach).
     */
    async handleMedia(req, res, next) {
      const url = new URL(req.url || '/', 'http://localhost');
      const match = /^\/api\/studio\/media\/([a-f0-9-]{36})(?:-(\d))?\.(jpg|mp4)$/.exec(url.pathname);
      if (!match) return next();
      const deny = () => { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end('Not found'); };
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny();
      const [, id, idxRaw, ext] = match;
      const idx = Number(idxRaw || 0);
      const exp = Number(url.searchParams.get('exp'));
      const sig = String(url.searchParams.get('sig') || '');
      if (!Number.isFinite(exp) || exp < now() || exp > now() + MEDIA_TTL_MS + 60_000) return deny();
      const expected = sign(`${id}${idx ? `-${idx}` : ''}.${ext}`, exp);
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return deny();
      const draft = store.studioGet(id);
      if (!draft || !['approved', 'published', 'failed'].includes(draft.status)) return deny();
      const common = { 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' };
      if (ext === 'jpg') {
        const image = store.studioImageAt(id, idx);
        if (!image) return deny();
        res.writeHead(200, { ...common, 'Content-Type': 'image/jpeg', 'Content-Length': image.length });
        return res.end(req.method === 'HEAD' ? undefined : Buffer.from(image));
      }
      if (!(await videoReady(draft))) return deny();
      return sendVideo(req, res, videoFile(draft), common);
    },
    start() {
      // Videá rozrenderované pred reštartom sa dorobia.
      for (const id of store.studioQueuedVideos()) {
        store.studioUpdate(id, { videoStatus: 'queued' }, now());
        videoChain = videoChain.then(() => renderVideo(id)).catch(() => {});
      }
      if (!timers || timer) return;
      timer = setInterval(() => { void tick().catch(error => log(`[studio] tick: ${error?.message || error}`)); }, TICK_MS);
      timer.unref?.();
      setTimeout(() => { void tick().catch(() => {}); }, 90_000).unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
  return api;
}

/** Spustí make-front-week-video.mjs ako vlastný proces; vráti cesty k výstupom. */
export function defaultFrontWeekRunner({ root, env, outDir, day, onLog = () => {} }) {
  return new Promise((resolve, reject) => {
    const args = [path.join(root, 'scripts', 'make-front-week-video.mjs'), '--out-dir', outDir, '--url', env.EVENT_VIDEO_PAGE_URL || 'http://localhost:4173'];
    if (day) args.push('--day', day);
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    // Beží na tom istom stroji ako portál: nižšia priorita CPU, aby návštevníci nečakali (Windows aj Linux).
    try { os.setPriority(child.pid, 10); } catch { /* bez priority */ }
    let out = '';
    const take = chunk => { const text = String(chunk); out = (out + text).slice(-8000); onLog(text); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    const timer = setTimeout(() => child.kill('SIGKILL'), 90 * 60_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', async code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`make-front-week-video skončil s kódom ${code}: ${out.trim().split('\n').slice(-3).join(' | ')}`));
      try {
        const names = await fsp.readdir(outDir);
        const burned = names.find(n => /^tyzden-na-fronte-\d{4}-\d{2}-\d{2}-titulky\.mp4$/.test(n));
        const post = names.find(n => /^tyzden-na-fronte-\d{4}-\d{2}-\d{2}\.txt$/.test(n));
        const srt = names.find(n => /\.srt$/.test(n));
        if (!burned || !post) return reject(new Error('výstup videa alebo textu chýba'));
        resolve({ video: path.join(outDir, burned), post: path.join(outDir, post), srt: srt ? path.join(outDir, srt) : null });
      } catch (error) { reject(error); }
    });
  });
}

/**
 * Spustí make-front-day-video.mjs ako vlastný proces; vráti cesty k výstupom. Kód 3 = ranné hlásenie ešte
 * nie je (chyba s code NO_DATA — Štúdio skúsi znova neskôr).
 */
export function defaultFrontDayRunner({ root, env, outDir, onLog = () => {} }) {
  return new Promise((resolve, reject) => {
    const args = [path.join(root, 'scripts', 'make-front-day-video.mjs'), '--out-dir', outDir, '--url', env.EVENT_VIDEO_PAGE_URL || 'http://localhost:4173'];
    if (env.FRONT_DAY_API_URL) args.push('--api', env.FRONT_DAY_API_URL);
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    // Beží na tom istom stroji ako portál: nižšia priorita CPU, aby návštevníci nečakali.
    try { os.setPriority(child.pid, 10); } catch { /* bez priority */ }
    let out = '';
    const take = chunk => { const text = String(chunk); out = (out + text).slice(-8000); onLog(text); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    const timer = setTimeout(() => child.kill('SIGKILL'), 75 * 60_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', async code => {
      clearTimeout(timer);
      const tail = out.trim().split('\n').slice(-3).join(' | ');
      if (code === 3) return reject(Object.assign(new Error(`denné video dnes zatiaľ nie: ${tail}`), { code: 'NO_DATA' }));
      if (code !== 0) return reject(new Error(`make-front-day-video skončil s kódom ${code}: ${tail}`));
      try {
        const names = await fsp.readdir(outDir);
        const burned = names.find(n => /^den-na-fronte-\d{4}-\d{2}-\d{2}-titulky\.mp4$/.test(n));
        const post = names.find(n => /^den-na-fronte-\d{4}-\d{2}-\d{2}\.txt$/.test(n));
        const srt = names.find(n => /\.srt$/.test(n));
        if (!burned || !post) return reject(new Error('výstup videa alebo textu chýba'));
        resolve({ video: path.join(outDir, burned), post: path.join(outDir, post), srt: srt ? path.join(outDir, srt) : null });
      } catch (error) { reject(error); }
    });
  });
}

/** MP4 s podporou jedného rozsahu bajtov (Range). */
export async function sendVideo(req, res, file, headers = {}) {
  const { size } = await fsp.stat(file);
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  let start = 0; let end = size - 1; let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(size - 1, Number(range[2])) : size - 1; }
    else { start = Math.max(0, size - Number(range[2])); }
    if (start > end || start >= size) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    status = 206;
  }
  res.writeHead(status, { ...headers, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start, end }).pipe(res);
}
