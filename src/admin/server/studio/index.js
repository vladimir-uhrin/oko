// OKO Štúdio sociálnych sietí (2026-10-03) — Fáza 1: posty s obrázkom.
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
import http from 'node:http';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { TEMPLATES, templateById } from './templates.js';
import { renderCard as defaultRenderCard } from './card.js';
import { createMetaPublisher } from './meta.js';

const TICK_MS = 10 * 60_000;
const STALE_MS = 30 * 60_000;
const MEDIA_TTL_MS = 2 * 3600_000;
export const AUTO_PUBLISH_MIN_UNCHANGED = 10;
const DIGEST_HOUR = 8;
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hour: '2-digit', hourCycle: 'h23' });
const localHour = at => Number(hourFmt.format(new Date(at)));
const fail = (code, status = 400) => Object.assign(new Error(code), { status });

export const DEFAULT_SETTINGS = Object.freeze({ autoDraft: true, autoPublish: {}, autoPublishPerDay: 5, quietFrom: 22, quietTo: 7,
  targets: ['facebook', 'instagram'] });

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
  renderCard = defaultRenderCard, publisher = createMetaPublisher({ env }), timers = true, log = message => console.warn(message) } = {}) {
  const publicUrl = publicUrlFrom(env);
  let running = false;
  let timer = null;

  function secret() {
    let value = store.getSetting('studio:secret')?.value;
    if (!value) { value = randomBytes(32).toString('base64url'); store.setSetting('studio:secret', value, now(), 'system'); }
    return value;
  }
  const sign = (id, exp) => createHmac('sha256', secret()).update(`${id}.${exp}`).digest('base64url');

  function settings() {
    const stored = store.getSetting('studio:settings')?.value || {};
    return { ...DEFAULT_SETTINGS, ...stored, autoPublish: { ...(stored.autoPublish || {}) } };
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

  async function generate(templateId, origin = 'manual') {
    const template = templateById(templateId);
    if (!template) throw fail('template_not_found', 404);
    const loaded = await loadData(template);
    if (!loaded.data) return { created: false, reason: loaded.reason };
    const item = template.build(loaded.data, { now: now(), url: publicUrl });
    if (!item) return { created: false, reason: 'nothing_to_post' };
    if (store.studioHasKey(item.key)) return { created: false, reason: 'exists', key: item.key };
    const image = await renderCard({ ...item.card, site: new URL(publicUrl).host });
    const id = randomUUID();
    const created = store.studioInsert({ id, template: template.id, eventKey: item.key, origin, title: item.title, text: item.text,
      card: item.card, image, createdAt: now() });
    return created ? { created: true, draft: store.studioGet(id) } : { created: false, reason: 'exists', key: item.key };
  }

  function quiet(at = now()) {
    const { quietFrom, quietTo } = settings();
    const hour = localHour(at);
    return quietFrom > quietTo ? hour >= quietFrom || hour < quietTo : hour >= quietFrom && hour < quietTo;
  }

  async function maybeAutoPublish(draft) {
    const s = settings();
    if (!s.autoPublish[draft.template]) return;
    if (store.studioUnchangedCount(draft.template) < AUTO_PUBLISH_MIN_UNCHANGED) return;
    if (quiet()) return;
    if (store.studioPublishedSince(now() - 86400_000, 'auto') >= s.autoPublishPerDay) return;
    const status = publisher.status();
    const targets = s.targets.filter(target => status[target]);
    if (!targets.length) return;
    await publish(draft.id, targets, 'auto');
  }

  async function tick() {
    if (running) return { skipped: 'running' };
    running = true;
    const out = [];
    try {
      if (!settings().autoDraft) return { skipped: 'auto_draft_off' };
      for (const template of TEMPLATES.filter(t => t.auto)) {
        if (template.auto === 'daily' && localHour(now()) < DIGEST_HOUR) continue;
        try {
          const result = await generate(template.id, 'auto');
          out.push({ template: template.id, ...result, draft: undefined, id: result.draft?.id });
          if (result.created) await maybeAutoPublish(result.draft);
        } catch (error) { log(`[studio] ${template.id}: ${error?.message || error}`); }
      }
      return { results: out };
    } finally { running = false; }
  }

  function requireDraft(id) {
    const draft = store.studioGet(id);
    if (!draft) throw fail('draft_not_found', 404);
    return draft;
  }

  function mediaUrl(id, ttl = MEDIA_TTL_MS) {
    const exp = now() + ttl;
    return `${publicUrl}/api/studio/media/${id}.jpg?exp=${exp}&sig=${sign(id, exp)}`;
  }

  async function publish(id, targets, origin = 'manual') {
    const draft = requireDraft(id);
    if (!['draft', 'approved', 'failed'].includes(draft.status)) throw fail('draft_not_publishable', 409);
    const wanted = [...new Set(targets)].filter(target => ['facebook', 'instagram'].includes(target));
    if (!wanted.length) throw fail('no_target');
    const status = publisher.status();
    const missing = wanted.filter(target => !status[target]);
    if (missing.length) throw fail('meta_not_configured', 409);
    const image = store.studioImage(id);
    if (!image || !draft.text.trim()) throw fail('draft_incomplete', 409);
    const time = now();
    store.studioUpdate(id, { status: 'approved', approvedAt: draft.approvedAt ?? time }, time);
    const results = { ...draft.results };
    for (const target of wanted) {
      if (results[target]?.id) continue; // už zverejnené — neopakovať pri opakovanom pokuse
      try {
        results[target] = target === 'facebook'
          ? { ...(await publisher.facebookPhoto({ image, text: draft.text })), at: now() }
          : { ...(await publisher.instagramImage({ imageUrl: mediaUrl(id, 30 * 60_000), text: draft.text })), at: now() };
      } catch (error) {
        results[target] = { error: String(error?.message || error).slice(0, 300), at: now() };
        log(`[studio] publish ${target} failed: ${results[target].error}`);
      }
    }
    const ok = wanted.every(target => results[target]?.id);
    const updated = store.studioUpdate(id, { results, status: ok ? 'published' : 'failed', ...(ok ? { publishedAt: now() } : {}) }, now());
    return { draft: updated, origin };
  }

  return {
    templates: TEMPLATES,
    publicUrl,
    settings,
    templateStats,
    generate,
    tick,
    publish,
    mediaUrl,
    list: limit => store.studioList(limit),
    get: requireDraft,
    image: id => store.studioImage(id),
    publisherStatus: () => publisher.status(),
    instagramLimit: () => publisher.instagramLimit(),
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
      if ('autoDraft' in patch) next.autoDraft = Boolean(patch.autoDraft);
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
        if (!Array.isArray(patch.targets) || patch.targets.some(t => !['facebook', 'instagram'].includes(t))) throw fail('invalid_input');
        next.targets = [...new Set(patch.targets)];
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
    /** Verejný endpoint obrázka pre Instagram: len podpísaný, časovo obmedzený, len schválený/zverejnený návrh. */
    handleMedia(req, res, next) {
      const url = new URL(req.url || '/', 'http://localhost');
      const match = /^\/api\/studio\/media\/([a-f0-9-]{36})\.jpg$/.exec(url.pathname);
      if (!match) return next();
      const deny = () => { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end('Not found'); };
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny();
      const exp = Number(url.searchParams.get('exp'));
      const sig = String(url.searchParams.get('sig') || '');
      if (!Number.isFinite(exp) || exp < now() || exp > now() + MEDIA_TTL_MS + 60_000) return deny();
      const expected = sign(match[1], exp);
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return deny();
      const draft = store.studioGet(match[1]);
      const image = draft && ['approved', 'published', 'failed'].includes(draft.status) ? store.studioImage(match[1]) : null;
      if (!image) return deny();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': image.length, 'Cache-Control': 'private, max-age=600',
        'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' });
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(image));
    },
    start() {
      if (!timers || timer) return;
      timer = setInterval(() => { void tick().catch(error => log(`[studio] tick: ${error?.message || error}`)); }, TICK_MS);
      timer.unref?.();
      setTimeout(() => { void tick().catch(() => {}); }, 90_000).unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
