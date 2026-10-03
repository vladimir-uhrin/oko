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
import { TEMPLATES, templateById } from './templates.js';
import { renderCard as defaultRenderCard } from './card.js';
import { createMetaPublisher } from './meta.js';
import { spawn } from 'node:child_process';
import { ffmpegAvailable, padToReel as defaultPadToReel, posterFrame as defaultPosterFrame, renderReel as defaultRenderReel } from './reel.js';

const TICK_MS = 10 * 60_000;
const STALE_MS = 30 * 60_000;
const MEDIA_TTL_MS = 2 * 3600_000;
export const AUTO_PUBLISH_MIN_UNCHANGED = 10;
const DIGEST_HOUR = 8;
const INSIGHTS_REFRESH_MS = 6 * 3600_000;
const INSIGHTS_WINDOW_MS = 30 * 86400_000;
const SCHEDULE_MAX_MS = 30 * 86400_000;
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hour: '2-digit', hourCycle: 'h23' });
const localHour = at => Number(hourFmt.format(new Date(at)));
const fail = (code, status = 400) => Object.assign(new Error(code), { status });

export const TARGETS = Object.freeze(['facebook', 'instagram', 'facebook-reel', 'instagram-reel']);
const REEL_TARGETS = new Set(['facebook-reel', 'instagram-reel']);
const baseTarget = target => target.replace(/-reel$/, '');
export const DEFAULT_SETTINGS = Object.freeze({ autoDraft: true, autoReel: true, audio: 'ambient', voice: false, autoPublish: {},
  autoPublishPerDay: 5, quietFrom: 22, quietTo: 7, targets: [...TARGETS],
  // Týždeň na fronte (2026-10-03): sobota 7:00 spustí scripts/make-front-week-video.mjs a výsledok dá do Štúdia.
  frontWeek: { enabled: false, weekday: 6, hour: 7 } });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Bratislava', weekday: 'short' });
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const localWeekday = at => WEEKDAYS[weekdayFmt.format(new Date(at))] ?? 0;
const dayKeyFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' });
const localDayKey = at => dayKeyFmt.format(new Date(at));

function loopbackJson(port, path, timeoutMs = 20_000) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path, headers: { Host: `localhost:${port}`, Accept: 'application/json', 'X-OKO-Studio': '1' } }, res => {
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
  renderCard = defaultRenderCard, renderReel = defaultRenderReel, padToReel = defaultPadToReel, posterFrame = defaultPosterFrame, checkFfmpeg = () => ffmpegAvailable(env.FFMPEG_PATH || 'ffmpeg'),
  mediaDir = null, publisher = createMetaPublisher({ env }), timers = true, log = message => console.warn(message),
  voiceProvider = null, frontWeekRunner = null, root = process.cwd() } = {}) {
  const publicUrl = publicUrlFrom(env);
  const site = new URL(publicUrl).host;
  let running = false;
  let timer = null;
  let videoChain = Promise.resolve();
  let ffmpegOk = null;
  const inFlight = new Map(); // id → zverejňovanie na pozadí
  const autoAfterVideo = new Set(); // auto-návrhy čakajúce na video pred auto-zverejnením
  let lastInsights = 0;

  function secret() {
    let value = store.getSetting('studio:secret')?.value;
    if (!value) { value = randomBytes(32).toString('base64url'); store.setSetting('studio:secret', value, now(), 'system'); }
    return value;
  }
  const sign = (name, exp) => createHmac('sha256', secret()).update(`${name}.${exp}`).digest('base64url');

  function settings() {
    const stored = store.getSetting('studio:settings')?.value || {};
    return { ...DEFAULT_SETTINGS, ...stored, autoPublish: { ...(stored.autoPublish || {}) }, frontWeek: { ...DEFAULT_SETTINGS.frontWeek, ...(stored.frontWeek || {}) } };
  }

  function templateStats() {
    return TEMPLATES.map(template => ({ id: template.id, label: template.label, auto: template.auto,
      unchanged: store.studioUnchangedCount(template.id), autoPublish: Boolean(settings().autoPublish[template.id]) }));
  }

  /** Načíta dáta šablóny; null + dôvod, ak sú nedostupné alebo staré. */
  async function loadData(template) {
    const p = port();
    if (!p) return { reason: 'server_not_ready' };
    const result = await fetchJson(p, template.path);
    if (result.status === 503 && result.body?.error === 'disabled_by_admin') return { reason: 'feed_disabled' };
    if (result.status !== 200 || !result.body) return { reason: 'source_unavailable' };
    const cache = String(result.headers?.['x-gev-cache'] || '').toUpperCase();
    if (cache === 'STALE') return { reason: 'stale' };
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
      if (draft.card?.kind === 'import' && draft.card.sourceVideo) {
        // Importované video (Udalosti, Týždeň na fronte): 9:16 doplnením, bez nového renderu.
        await padToReel(path.join(mediaDir, path.basename(draft.card.sourceVideo)), path.join(mediaDir, name), { env });
      } else {
        await renderReel({ card: draft.card, title: draft.title, text: draft.text }, path.join(mediaDir, name),
          { audio: s.audio, voice: s.voice, env, site, voiceProvider });
      }
      store.studioUpdate(id, { video: name, videoStatus: 'ready', videoError: null }, now());
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
      store.studioUpdate(row.id, { video: null, videoStatus: null }, now());
    }
    let names = [];
    try { names = await fsp.readdir(mediaDir); } catch { return; }
    for (const name of names) {
      const match = /^([a-f0-9-]{36})(?:\.src)?\.mp4$/.exec(name);
      if (match && !store.studioGet(match[1])) await fsp.rm(path.join(mediaDir, name), { force: true });
    }
  }

  async function generate(templateId, origin = 'manual') {
    const template = templateById(templateId);
    if (!template) throw fail('template_not_found', 404);
    const loaded = await loadData(template);
    if (!loaded.data) return { created: false, reason: loaded.reason };
    const item = template.build(loaded.data, { now: now(), url: publicUrl });
    if (!item) return { created: false, reason: 'nothing_to_post' };
    if (store.studioHasKey(item.key)) return { created: false, reason: 'exists', key: item.key };
    const image = await renderCard({ ...item.card, site });
    const id = randomUUID();
    const created = store.studioInsert({ id, template: template.id, eventKey: item.key, origin, title: item.title, text: item.text,
      card: item.card, image, createdAt: now() });
    if (!created) return { created: false, reason: 'exists', key: item.key };
    if (settings().autoReel && mediaDir) queueVideo(id);
    return { created: true, draft: store.studioGet(id) };
  }

  function quiet(at = now()) {
    const { quietFrom, quietTo } = settings();
    const hour = localHour(at);
    return quietFrom > quietTo ? hour >= quietFrom || hour < quietTo : hour >= quietFrom && hour < quietTo;
  }

  async function maybeAutoPublish(draft) {
    const s = settings();
    if (!draft || draft.origin !== 'auto' || !s.autoPublish[draft.template]) return;
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
        text, image: null, videoFile: result.video, origin: trigger === 'auto' ? 'auto' : 'manual', meta: { source: 'okolive.sk · Generálny štáb Ukrajiny', weekTo, srt: result.srt || null } });
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
    if (!cfg?.enabled || frontWeek.running) return false;
    const at = now();
    if (localWeekday(at) !== cfg.weekday || localHour(at) < cfg.hour) return false;
    // Raz za týždeň: ak už dnešný/tento týždeň má návrh, nič.
    const key = `front-week:${localDayKey(at)}`;
    if (store.studioHasKey(key) || frontWeek.lastKey === key) return false;
    if (frontWeek.finishedAt && localDayKey(frontWeek.finishedAt) === localDayKey(at)) return false; // dnes už bežal (aj neúspešne)
    return true;
  }

  async function tick() {
    if (running) return { skipped: 'running' };
    running = true;
    const out = [];
    try {
      await cleanupVideos().catch(error => log(`[studio] cleanup: ${error?.message || error}`));
      await publishDue().catch(error => log(`[studio] due: ${error?.message || error}`));
      refreshInsights().catch(error => log(`[studio] insights: ${error?.message || error}`));
      if (frontWeekDue()) runFrontWeek({ trigger: 'auto' }).catch(() => {});
      if (!settings().autoDraft) return { skipped: 'auto_draft_off' };
      for (const template of TEMPLATES.filter(t => t.auto)) {
        if (template.auto === 'daily' && localHour(now()) < DIGEST_HOUR) continue;
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
    } finally { running = false; }
  }

  function mediaUrl(id, ttl = MEDIA_TTL_MS, ext = 'jpg') {
    const exp = now() + ttl;
    const name = `${id}.${ext}`;
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
    const time = now();
    const pending = { ...draft.results };
    for (const target of todo) pending[target] = { pending: true, at: time };
    store.studioUpdate(id, { results: pending, scheduledAt: null, scheduledTargets: null,
      ...(draft.status === 'published' ? {} : { status: 'approved', approvedAt: draft.approvedAt ?? time }) }, time);
    const done = (async () => {
      const results = { ...pending };
      for (const target of todo) {
        try {
          let result;
          if (target === 'facebook') result = await publisher.facebookPhoto({ image, text: draft.text });
          else if (target === 'instagram') result = await publisher.instagramImage({ imageUrl: mediaUrl(id, 30 * 60_000), text: draft.text });
          else if (target === 'facebook-reel') result = await publisher.facebookReel({ video: await fsp.readFile(videoFile(draft)), text: draft.text });
          else result = await publisher.instagramReel({ videoUrl: mediaUrl(id, 60 * 60_000, 'mp4'), text: draft.text });
          results[target] = { ...result, at: now() };
        } catch (error) {
          results[target] = { error: String(error?.message || error).slice(0, 300), at: now() };
          log(`[studio] publish ${target} failed: ${results[target].error}`);
        }
        store.studioUpdate(id, { results }, now());
      }
      const ok = todo.every(target => results[target]?.id);
      const wasPublished = draft.status === 'published';
      return { draft: store.studioUpdate(id, { results, status: ok || wasPublished ? 'published' : 'failed',
        ...((ok && !wasPublished) ? { publishedAt: now() } : {}) }, now()), origin };
    })().finally(() => inFlight.delete(id));
    inFlight.set(id, done);
    return { draft: store.studioGet(id), done };
  }

  const api = {
    templates: TEMPLATES,
    publicUrl,
    runFrontWeek,
    frontWeekStatus: () => ({ ...frontWeek, due: frontWeekDue() }),
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
    async importDraft({ template, eventKey, title, text, image = null, videoFile = null, origin = 'import', meta = {} }) {
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
      if (sourceVideo && settings().autoReel) queueVideo(id);
      return { created: true, draft: store.studioGet(id) };
    },
    /** Pôvodné (neorezané) video importovaného návrhu — na stiahnutie a zverejnenie fotky+videa 4:5. */
    sourceVideoPath(id) {
      const draft = requireDraft(id);
      return mediaDir && draft.card?.sourceVideo ? path.join(mediaDir, path.basename(draft.card.sourceVideo)) : null;
    },
    publishDue,
    refreshInsights,
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
    image: id => store.studioImage(id),
    videoPath: id => { const draft = requireDraft(id); return draft.videoStatus === 'ready' ? videoFile(draft) : null; },
    publisherStatus: () => publisher.status(),
    instagramLimit: () => publisher.instagramLimit(),
    async capabilities() {
      if (ffmpegOk === null) ffmpegOk = await checkFfmpeg();
      let music = 0;
      try { music = env.STUDIO_MUSIC_DIR ? (await fsp.readdir(env.STUDIO_MUSIC_DIR)).filter(n => /\.(mp3|wav|ogg|m4a|flac)$/i.test(n)).length : 0; } catch { music = 0; }
      return { ffmpeg: ffmpegOk, voice: Boolean(voiceProvider) || Boolean(env.PIPER_PATH && env.PIPER_MODEL), ownerVoice: Boolean(voiceProvider),
        music, mediaDir: Boolean(mediaDir), frontWeek: Boolean(frontWeekRunner || mediaDir) };
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
      if ('autoPublish' in patch) {
        if (!patch.autoPublish || typeof patch.autoPublish !== 'object') throw fail('invalid_input');
        for (const [templateId, enabled] of Object.entries(patch.autoPublish)) {
          if (!templateById(templateId) || typeof enabled !== 'boolean') throw fail('invalid_input');
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
      const match = /^\/api\/studio\/media\/([a-f0-9-]{36})\.(jpg|mp4)$/.exec(url.pathname);
      if (!match) return next();
      const deny = () => { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end('Not found'); };
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny();
      const [, id, ext] = match;
      const exp = Number(url.searchParams.get('exp'));
      const sig = String(url.searchParams.get('sig') || '');
      if (!Number.isFinite(exp) || exp < now() || exp > now() + MEDIA_TTL_MS + 60_000) return deny();
      const expected = sign(`${id}.${ext}`, exp);
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return deny();
      const draft = store.studioGet(id);
      if (!draft || !['approved', 'published', 'failed'].includes(draft.status)) return deny();
      const common = { 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' };
      if (ext === 'jpg') {
        const image = store.studioImage(id);
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
