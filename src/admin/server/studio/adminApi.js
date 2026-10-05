// OKO Štúdio (2026-10-03) — /api/admin/studio/*. Volá ho src/auth/server/admin.js
// až po kontrole roly owner a limitu; zápisy prešli Origin + CSRF kontrolou v context().
import { sendVideo } from './index.js';

const DRAFT = /^\/api\/admin\/studio\/drafts\/([a-f0-9-]{36})(?:\/(image|video|hook|source|render|approve|discard|restore|publish|shared|schedule))?$/;

export async function handleStudioAdmin(pathname, req, res, ctx, { json, readJson, fail, active, rate, studio, store, actor, now }) {
  if (!studio) throw fail('studio_unavailable', 503);
  const draftRoute = DRAFT.exec(pathname);
  const route = draftRoute ? `/drafts/:id${draftRoute[2] ? `/${draftRoute[2]}` : ''}` : pathname.slice('/api/admin/studio'.length) || '/';
  const methods = { '/': ['GET'], '/generate': ['POST'], '/settings': ['POST'], '/tick': ['POST'], '/drafts/:id': ['GET', 'POST'],
    '/drafts/:id/image': ['GET'], '/drafts/:id/video': ['GET'], '/drafts/:id/hook': ['GET'], '/drafts/:id/render': ['POST'], '/drafts/:id/approve': ['POST'], '/drafts/:id/discard': ['POST'], '/drafts/:id/restore': ['POST'],
    '/drafts/:id/publish': ['POST'], '/drafts/:id/shared': ['POST'], '/drafts/:id/schedule': ['POST'],
    '/drafts/:id/source': ['GET'], '/calendar': ['GET'], '/insights': ['GET'], '/insights/refresh': ['POST'],
    '/front-week': ['GET', 'POST'], '/front-day': ['GET', 'POST'], '/best-times': ['GET'] }[route];
  if (!methods) throw fail('not_found', 404);
  if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); throw fail('method_not_allowed', 405); }
  const id = draftRoute?.[1];

  if (req.method === 'GET') {
    if (route === '/') {
      let instagramLimit = null;
      try { instagramLimit = await studio.instagramLimit(); } catch { instagramLimit = null; }
      // Každý návrh nesie aj kontroly limitov (IG text/hashtagy/dĺžka reelu) — UI ich ukáže pred odoslaním.
      return json(res, 200, { drafts: studio.list(100).map(draft => ({ ...draft, checks: studio.checks(draft) })), templates: studio.templateStats(), settings: studio.settings(),
        meta: studio.publisherStatus(), instagramLimit, publicUrl: studio.publicUrl, autoPublishMin: 10,
        capabilities: await studio.capabilities(), bestTimes: studio.bestTimes(), limits: studio.limits });
    }
    if (route === '/best-times') return json(res, 200, studio.bestTimes());
    if (route === '/calendar') return json(res, 200, { items: studio.calendar(14) });
    if (route === '/front-week') return json(res, 200, { status: studio.frontWeekStatus(), settings: studio.settings().frontWeek });
    if (route === '/front-day') return json(res, 200, { status: studio.frontDayStatus(), settings: studio.settings().frontDay });
    if (route === '/drafts/:id/source') {
      const file = studio.sourceVideoPath(id);
      if (!file) throw fail('video_not_ready', 404);
      return sendVideo(req, res, file, { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="oko-video-${id.slice(0, 8)}.mp4"` });
    }
    if (route === '/insights') return json(res, 200, { posts: studio.insights(), meta: studio.publisherStatus() });
    if (route === '/drafts/:id/image') {
      // ?i=N: N-tá snímka karuselu (0 = hlavná).
      const idx = Math.max(0, Math.min(9, Number(new URL(req.url || '/', 'http://localhost').searchParams.get('i')) || 0));
      const image = studio.image(id, idx);
      if (!image) throw fail('draft_not_found', 404);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': image.length, 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="oko-${id.slice(0, 8)}${idx ? `-${idx}` : ''}.jpg"` });
      return res.end(Buffer.from(image));
    }
    if (route === '/drafts/:id/hook') {
      // Pás háčika reelu: snímky 0, 1, 2, 3 s — čo divák uvidí ako prvé.
      const sheet = await studio.hookSheet(id);
      if (!sheet) throw fail('hook_not_ready', 404);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': sheet.length, 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="oko-hacik-${id.slice(0, 8)}.jpg"` });
      return res.end(sheet);
    }
    if (route === '/drafts/:id/video') {
      const file = studio.videoPath(id);
      if (!file) throw fail('video_not_ready', 404);
      return sendVideo(req, res, file, { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="oko-reel-${id.slice(0, 8)}.mp4"` });
    }
    return json(res, 200, { draft: studio.get(id) });
  }

  const body = await readJson(req);
  rate(ctx, 'admin-studio', actor, 60, 60_000);
  active(ctx);
  const time = now();
  const audit = (action, detail) => store.audit(actor, action, null, String(detail).slice(0, 200), time);
  if (route === '/generate') {
    if (typeof body.template !== 'string') throw fail('invalid_input');
    const result = await studio.generate(body.template, 'manual');
    if (result.created) audit('studio_generated', `${body.template}: ${result.draft.title}`);
    return json(res, 200, { ...result, drafts: studio.list(100) });
  }
  if (route === '/tick') return json(res, 200, { ...(await studio.tick()), drafts: studio.list(100) });
  if (route === '/settings') {
    const settings = studio.setSettings(body);
    audit('studio_settings', JSON.stringify({ autoDraft: settings.autoDraft, autoReel: settings.autoReel, audio: settings.audio, voice: settings.voice, autoPublish: settings.autoPublish, perDay: settings.autoPublishPerDay }));
    return json(res, 200, { settings, templates: studio.templateStats() });
  }
  if (route === '/drafts/:id') {
    if (Object.keys(body).some(key => key !== 'text')) throw fail('invalid_input');
    return json(res, 200, { draft: studio.edit(id, body.text) });
  }
  if (route === '/front-week') {
    if (Object.keys(body).some(key => key !== 'day')) throw fail('invalid_input');
    if (body.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.day))) throw fail('invalid_input');
    audit('studio_front_week', body.day || 'posledný týždeň');
    // Beží na pozadí (až hodinu) — odpoveď hneď, stav cez GET /front-week.
    studio.runFrontWeek({ day: body.day || null, trigger: 'manual' }).catch(() => {});
    return json(res, 202, { status: studio.frontWeekStatus() });
  }
  if (route === '/front-day') {
    if (Object.keys(body).length) throw fail('invalid_input');
    audit('studio_front_day', 'dnešný deň');
    // Beží na pozadí (~20–30 min) — odpoveď hneď, stav cez GET /front-day. Súbeh (409) sa ohlási hneď.
    const status = studio.frontDayStatus();
    if (status.running) throw fail('front_day_running', 409);
    studio.runFrontDay({ trigger: 'manual' }).catch(() => {});
    return json(res, 202, { status: studio.frontDayStatus() });
  }
  if (route === '/insights/refresh') return json(res, 200, { ...(await studio.refreshInsights(true)), posts: studio.insights() });
  if (route === '/drafts/:id/schedule') {
    if (Object.keys(body).some(key => !['at', 'targets'].includes(key))) throw fail('invalid_input');
    const at = body.at === null ? null : Number(body.at);
    const draft = studio.schedule(id, at, body.targets);
    audit(at === null ? 'studio_unscheduled' : 'studio_scheduled', `${draft.title}${at === null ? '' : ` → ${new Date(at).toISOString()} ${(body.targets || []).join(', ')}`}`);
    return json(res, 200, { draft });
  }
  if (route === '/drafts/:id/render') return json(res, 200, { draft: studio.queueVideo(id) });
  if (route === '/drafts/:id/approve') return json(res, 200, { draft: studio.setStatus(id, 'approved') });
  if (route === '/drafts/:id/discard') return json(res, 200, { draft: studio.setStatus(id, 'discarded') });
  if (route === '/drafts/:id/restore') return json(res, 200, { draft: studio.setStatus(id, 'draft') });
  if (route === '/drafts/:id/shared') {
    const draft = studio.markShared(id);
    audit('studio_shared', draft.title);
    return json(res, 200, { draft });
  }
  // publish
  if (!Array.isArray(body.targets)) throw fail('invalid_input');
  // Zverejnenie beží na pozadí (video spracúva Meta minúty) — odpoveď hneď, stav cez GET.
  let started;
  try { started = await studio.publish(id, body.targets); }
  catch (error) {
    if (error?.message === 'limits_exceeded') return json(res, 409, { error: 'limits_exceeded', details: error.details || [] });
    throw error;
  }
  const { draft, done } = started;
  audit('studio_publish_started', `${draft.title} → ${body.targets.join(', ')}`);
  done.then(result => store.audit(actor, 'studio_published', null, `${result.draft.title} (${result.draft.status})`.slice(0, 200), now()))
    .catch(() => {});
  return json(res, 202, { draft });
}
