// OKO Štúdio (2026-10-03) — /api/admin/studio/*. Volá ho src/auth/server/admin.js
// až po kontrole roly owner a limitu; zápisy prešli Origin + CSRF kontrolou v context().
import { sendVideo } from './index.js';

const DRAFT = /^\/api\/admin\/studio\/drafts\/([a-f0-9-]{36})(?:\/(image|video|render|approve|discard|restore|publish|shared))?$/;

export async function handleStudioAdmin(pathname, req, res, ctx, { json, readJson, fail, active, rate, studio, store, actor, now }) {
  if (!studio) throw fail('studio_unavailable', 503);
  const draftRoute = DRAFT.exec(pathname);
  const route = draftRoute ? `/drafts/:id${draftRoute[2] ? `/${draftRoute[2]}` : ''}` : pathname.slice('/api/admin/studio'.length) || '/';
  const methods = { '/': ['GET'], '/generate': ['POST'], '/settings': ['POST'], '/tick': ['POST'], '/drafts/:id': ['GET', 'POST'],
    '/drafts/:id/image': ['GET'], '/drafts/:id/video': ['GET'], '/drafts/:id/render': ['POST'], '/drafts/:id/approve': ['POST'], '/drafts/:id/discard': ['POST'], '/drafts/:id/restore': ['POST'],
    '/drafts/:id/publish': ['POST'], '/drafts/:id/shared': ['POST'] }[route];
  if (!methods) throw fail('not_found', 404);
  if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); throw fail('method_not_allowed', 405); }
  const id = draftRoute?.[1];

  if (req.method === 'GET') {
    if (route === '/') {
      let instagramLimit = null;
      try { instagramLimit = await studio.instagramLimit(); } catch { instagramLimit = null; }
      return json(res, 200, { drafts: studio.list(100), templates: studio.templateStats(), settings: studio.settings(),
        meta: studio.publisherStatus(), instagramLimit, publicUrl: studio.publicUrl, autoPublishMin: 10,
        capabilities: await studio.capabilities() });
    }
    if (route === '/drafts/:id/image') {
      const image = studio.image(id);
      if (!image) throw fail('draft_not_found', 404);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': image.length, 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="oko-${id.slice(0, 8)}.jpg"` });
      return res.end(Buffer.from(image));
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
  const { draft, done } = await studio.publish(id, body.targets);
  audit('studio_publish_started', `${draft.title} → ${body.targets.join(', ')}`);
  done.then(result => store.audit(actor, 'studio_published', null, `${result.draft.title} (${result.draft.status})`.slice(0, 200), now()))
    .catch(() => {});
  return json(res, 202, { draft });
}
