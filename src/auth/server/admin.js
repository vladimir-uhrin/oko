// Admin panel OKO (2026-10-03) — serverová časť /api/admin/*.
//
// Prístup má iba účet s rolou `owner` (pridelí ju len scripts/create-owner.mjs).
// Komukoľvek inému — aj neprihlásenému — endpointy odpovedajú 404, aby nebolo
// vidno, že admin existuje. Zápisy idú cez tú istú Origin + CSRF kontrolu ako
// centrum účtu a každý zásah sa zapíše do admin_audit aj do aktivity dotknutého účtu.
//
// Admin vidí účty a prevádzku, nie pohyb ľudí po glóbuse (CLAUDE.md pravidlo 6):
// sledované lety iba ako počet, relácie iba s orientačným názvom prehliadača.

import { analytics, clampInt, costs, dayRange, feedHistory, feedSettingsList, traffic, validateFeedUpdate,
  validateNotice } from '../../admin/server/api.js';
import { clientIp, localDay, normalizeIp } from '../../admin/server/runtime.js';
import { handleStudioAdmin } from '../../admin/server/studio/adminApi.js';

const USER_ID = /^[a-f0-9-]{36}$/;
const PAGE_SIZE = 50;

/**
 * @param {object} deps
 * @param {object} deps.store openAuthStore()
 * @param {() => number} deps.now
 * @param {number} deps.idleMs SESSION_IDLE_MS
 * @param {{feeds?: () => Promise<object[]>, server?: () => Promise<object>|object, log?: () => Promise<string>}} [deps.sources]
 */
export function createAdminRoutes({ store, now, idleMs, sources = {}, isOwnerSession = session => session?.role === 'owner' }) {
  return async function handleAdmin(pathname, req, res, ctx, { json, readJson, fail, fields, active, rate }) {
    // Neprihlásený, member aj zablokovaný účet dostanú rovnaké 404.
    if (!isOwnerSession(ctx.session)) throw fail('not_found', 404);
    rate(ctx, 'admin', ctx.session.user_id, 600, 60_000);
    const actor = ctx.session.user_id;
    // Štúdio sociálnych sietí (2026-10-03) — vlastná tabuľka ciest, rovnaká brána owner + CSRF.
    if (pathname === '/api/admin/studio' || pathname.startsWith('/api/admin/studio/')) {
      return handleStudioAdmin(pathname, req, res, ctx, { json, readJson, fail, active, rate, studio: sources.runtime?.()?.studio ?? null,
        store, actor, now });
    }
    const userRoute = /^\/api\/admin\/users\/([a-f0-9-]{36})(?:\/(revoke-sessions|disable|enable))?$/.exec(pathname);
    const feedRoute = /^\/api\/admin\/feeds\/([a-z0-9-]{1,40})$/.exec(pathname);
    const route = userRoute ? (userRoute[2] ? `/api/admin/users/:id/${userRoute[2]}` : '/api/admin/users/:id')
      : feedRoute ? '/api/admin/feeds/:id' : pathname;
    const methods = {
      '/api/admin/overview': ['GET'], '/api/admin/feeds': ['GET'], '/api/admin/log': ['GET'],
      '/api/admin/users': ['GET'], '/api/admin/audit': ['GET'], '/api/admin/users/:id': ['GET', 'DELETE'],
      '/api/admin/users/:id/revoke-sessions': ['POST'], '/api/admin/users/:id/disable': ['POST'],
      '/api/admin/users/:id/enable': ['POST'],
      // Rozšírenie (2026-10-03): analytika, prevádzka, chyby, náklady, vypínače, oznam, údržba.
      '/api/admin/analytics': ['GET'], '/api/admin/traffic': ['GET'], '/api/admin/errors': ['GET', 'DELETE'],
      '/api/admin/costs': ['GET'], '/api/admin/feed-history': ['GET'], '/api/admin/feeds/:id': ['POST'],
      '/api/admin/notice': ['GET', 'POST'], '/api/admin/maintenance': ['GET'], '/api/admin/maintenance/backup': ['POST'],
      '/api/admin/maintenance/cache': ['POST'], '/api/admin/accounts-chart': ['GET'],
      // Upozornenia (2026-10-04): nastavenie, zoznam, skúška.
      '/api/admin/alerts': ['GET', 'POST'], '/api/admin/alerts/test': ['POST'],
      // Naživo (2026-10-04): živí návštevníci s polohou na mapu (len pamäť servera).
      '/api/admin/live': ['GET'],
      // Záznam návštev s IP (2026-10-04, 30 dní): vyhľadávanie a stránkovanie.
      '/api/admin/visits': ['GET'],
      '/api/admin/ignored-ips': ['POST'],
    }[route];
    if (!methods) throw fail('not_found', 404);
    if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); throw fail('method_not_allowed', 405); }

    const url = new URL(req.url || '/', 'http://localhost');
    const runtime = sources.runtime?.() ?? null;
    const needRuntime = () => { if (!runtime) throw fail('telemetry_unavailable', 503); return runtime; };
    if (req.method === 'GET') {
      if (route === '/api/admin/analytics') return json(res, 200, analytics(needRuntime(), now(), clampInt(url.searchParams.get('days'), 1, 400, 30)));
      if (route === '/api/admin/live') return json(res, 200, needRuntime().liveSnapshot());
      if (route === '/api/admin/visits') {
        needRuntime().flush();
        const days = clampInt(url.searchParams.get('days'), 1, 30, 1);
        const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
        const limit = 100;
        const offset = clampInt(url.searchParams.get('page'), 0, 10_000, 0) * limit;
        return json(res, 200, { days, q, limit, offset, retentionDays: 30, yourIp: normalizeIp(clientIp(req)), ignoredIps: runtime.ignoredIps(),
          ...runtime.store.visitLog({ from: now() - days * 86400_000, q, limit, offset }) });
      }
      if (route === '/api/admin/traffic') return json(res, 200, traffic(needRuntime(), now(), clampInt(url.searchParams.get('hours'), 1, 24 * 90, 48)));
      if (route === '/api/admin/errors') {
        const kind = ['server', 'warn', 'http', 'client'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : null;
        needRuntime().flush();
        return json(res, 200, { errors: runtime.store.errors(kind, 300) });
      }
      if (route === '/api/admin/costs') {
        return json(res, 200, costs(needRuntime(), now(), clampInt(url.searchParams.get('days'), 1, 90, 30), await (sources.quotaStatus?.() ?? {})));
      }
      if (route === '/api/admin/feed-history') {
        needRuntime().flush();
        return json(res, 200, { history: feedHistory(runtime, now(), clampInt(url.searchParams.get('hours'), 1, 24 * 30, 24 * 7)),
          settings: feedSettingsList(runtime) });
      }
      if (route === '/api/admin/notice') return json(res, 200, { notice: needRuntime().getNotice(), public: runtime.notice() });
      if (route === '/api/admin/alerts') {
        const alerts = needRuntime().alerts;
        if (!alerts) throw fail('telemetry_unavailable', 503);
        return json(res, 200, { status: alerts.status(), history: alerts.history() });
      }
      if (route === '/api/admin/maintenance') {
        return json(res, 200, { backups: await (sources.backups?.() ?? []), cache: await (sources.cacheDirs?.() ?? []) });
      }
      if (route === '/api/admin/accounts-chart') {
        const days = clampInt(url.searchParams.get('days'), 7, 90, 30);
        const range = dayRange(now(), days);
        const series = new Map(range.map(day => [day, { day, registrations: 0, logins: 0 }]));
        const activity = store.accountActivity(now() - (days + 1) * 86400_000);
        for (const at of activity.registrations) { const entry = series.get(localDay(at)); if (entry) entry.registrations++; }
        for (const at of activity.logins) { const entry = series.get(localDay(at)); if (entry) entry.logins++; }
        return json(res, 200, { series: [...series.values()] });
      }
      if (route === '/api/admin/overview') {
        return json(res, 200, { stats: store.adminStats(now(), idleMs), server: await (sources.server?.() ?? null) });
      }
      if (route === '/api/admin/feeds') return json(res, 200, { feeds: await (sources.feeds?.() ?? []) });
      if (route === '/api/admin/log') return json(res, 200, { log: await (sources.log?.() ?? '') });
      if (route === '/api/admin/audit') return json(res, 200, { audit: store.auditLog(200) });
      if (route === '/api/admin/users') {
        const query = String(url.searchParams.get('q') || '').slice(0, 120);
        const offset = Math.max(0, Math.min(1e6, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0));
        return json(res, 200, { ...store.adminUsers(query, PAGE_SIZE, offset, now(), idleMs), offset, pageSize: PAGE_SIZE });
      }
      const user = store.adminUser(userRoute[1], now(), idleMs);
      if (!user) throw fail('user_not_found', 404);
      return json(res, 200, { user });
    }

    if (!userRoute) {
      const body = await readJson(req);
      rate(ctx, 'admin-write', actor, 60, 60_000);
      active(ctx);
      const time = now();
      if (route === '/api/admin/feeds/:id') {
        const error = validateFeedUpdate(feedRoute[1], body);
        if (error) throw fail(error, error === 'feed_not_found' ? 404 : 400);
        const setting = needRuntime().setFeedSetting(feedRoute[1], body, actor);
        store.audit(actor, 'feed_updated', null, `${feedRoute[1]}: ${JSON.stringify(setting)}`, time);
        return json(res, 200, { setting, settings: feedSettingsList(runtime) });
      }
      if (route === '/api/admin/alerts' || route === '/api/admin/alerts/test') {
        const alerts = needRuntime().alerts;
        if (!alerts) throw fail('telemetry_unavailable', 503);
        if (route === '/api/admin/alerts/test') {
          fields(body, []);
          const entry = await alerts.test();
          store.audit(actor, 'alerts_test', null, entry?.mailed ? 'odoslané' : (entry?.mailError || 'neodoslané'), time);
          return json(res, 200, { entry, status: alerts.status(), history: alerts.history() });
        }
        fields(body, ['enabled', 'email', 'feedDownMinutes', 'errors', 'publish']);
        const settings = alerts.setSettings(body, actor);
        store.audit(actor, 'alerts_settings', null, `${settings.enabled ? 'zapnuté' : 'vypnuté'} · ${settings.feedDownMinutes} min`, time);
        return json(res, 200, { status: alerts.status(), history: alerts.history() });
      }
      if (route === '/api/admin/ignored-ips') {
        fields(body, ['ips']);
        if (!Array.isArray(body.ips) || body.ips.length > 50 || body.ips.some(ip => typeof ip !== 'string' || !normalizeIp(ip))) throw fail('invalid_input');
        const removed = needRuntime().setIgnoredIps(body.ips, actor);
        store.audit(actor, 'ignored_ips', null, `${runtime.ignoredIps().length} IP, zmazaných ${removed}`, time);
        return json(res, 200, { ignoredIps: runtime.ignoredIps(), removed });
      }
      if (route === '/api/admin/notice') {
        const error = validateNotice(body);
        if (error) throw fail(error);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        needRuntime().setNotice(text ? { text, level: body.level || 'info', until: body.hours ? time + body.hours * 3600_000 : null } : null, actor);
        store.audit(actor, text ? 'notice_set' : 'notice_cleared', null, text.slice(0, 120), time);
        return json(res, 200, { notice: runtime.getNotice(), public: runtime.notice() });
      }
      if (route === '/api/admin/errors') {
        fields(body, ['kind']);
        const kind = ['server', 'warn', 'http', 'client'].includes(body.kind) ? body.kind : null;
        needRuntime().flush();
        const cleared = runtime.store.clearErrors(kind);
        store.audit(actor, 'errors_cleared', null, `${kind || 'všetky'} (${cleared})`, time);
        return json(res, 200, { cleared });
      }
      if (route === '/api/admin/maintenance/backup') {
        fields(body, []);
        runtime?.flush();
        const made = await sources.backup({ accounts: store, admin: runtime?.store });
        store.audit(actor, 'backup_created', null, made.join(', '), time);
        return json(res, 200, { made, backups: await sources.backups() });
      }
      if (route === '/api/admin/maintenance/cache') {
        fields(body, ['name']);
        if (typeof body.name !== 'string') throw fail('invalid_input');
        const result = await sources.clearCache(body.name);
        store.audit(actor, 'cache_cleared', null, `${body.name}: ${result.removed} súborov`, time);
        return json(res, 200, { ...result, cache: await sources.cacheDirs() });
      }
      throw fail('not_found', 404);
    }

    // Zápisy: vlastník nemôže zasiahnuť sám seba ani iného vlastníka.
    const id = userRoute[1];
    if (!USER_ID.test(id)) throw fail('invalid_input');
    const body = await readJson(req);
    fields(body, req.method === 'DELETE' ? ['confirm'] : []);
    rate(ctx, 'admin-write', actor, 60, 60_000);
    const result = store.transaction(() => {
      active(ctx);
      const target = store.userById(id);
      if (!target) throw fail('user_not_found', 404);
      if (target.id === actor || target.role === 'owner') throw fail('owner_protected', 409);
      const time = now();
      if (req.method === 'DELETE') {
        // Potvrdenie e-mailom účtu: preklep v UI nezmaže iný účet.
        if (body.confirm !== target.email) throw fail('confirm_mismatch');
        store.deleteUser(id);
        // E-mail zmazaného účtu do auditu nepatrí — ostane len ID a meno skrátené na iniciálu.
        store.audit(actor, 'user_deleted', id, `${[...target.display_name][0] || '?'}…`, time);
        return { deleted: true };
      }
      if (route.endsWith('/revoke-sessions')) {
        const revoked = store.deleteUserSessions(id);
        store.event(id, 'admin_sessions_revoked', time);
        store.audit(actor, 'sessions_revoked', id, target.email, time);
        return { revoked };
      }
      const disable = route.endsWith('/disable');
      store.setDisabled(id, disable ? time : null);
      store.event(id, disable ? 'account_disabled' : 'account_enabled', time);
      store.audit(actor, disable ? 'user_disabled' : 'user_enabled', id, target.email, time);
      return { user: store.adminUser(id, time, idleMs) };
    });
    return json(res, 200, result);
  };
}
