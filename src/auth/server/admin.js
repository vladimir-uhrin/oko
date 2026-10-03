// Admin panel OKO (2026-10-03) — serverová časť /api/admin/*.
//
// Prístup má iba účet s rolou `owner` (pridelí ju len scripts/create-owner.mjs).
// Komukoľvek inému — aj neprihlásenému — endpointy odpovedajú 404, aby nebolo
// vidno, že admin existuje. Zápisy idú cez tú istú Origin + CSRF kontrolu ako
// centrum účtu a každý zásah sa zapíše do admin_audit aj do aktivity dotknutého účtu.
//
// Admin vidí účty a prevádzku, nie pohyb ľudí po glóbuse (CLAUDE.md pravidlo 6):
// sledované lety iba ako počet, relácie iba s orientačným názvom prehliadača.

const USER_ID = /^[a-f0-9-]{36}$/;
const PAGE_SIZE = 50;

/**
 * @param {object} deps
 * @param {object} deps.store openAuthStore()
 * @param {() => number} deps.now
 * @param {number} deps.idleMs SESSION_IDLE_MS
 * @param {{feeds?: () => Promise<object[]>, server?: () => Promise<object>|object, log?: () => Promise<string>}} [deps.sources]
 */
export function createAdminRoutes({ store, now, idleMs, sources = {} }) {
  return async function handleAdmin(pathname, req, res, ctx, { json, readJson, fail, fields, active, rate }) {
    // Neprihlásený, member aj zablokovaný účet dostanú rovnaké 404.
    if (ctx.session?.role !== 'owner') throw fail('not_found', 404);
    rate(ctx, 'admin', ctx.session.user_id, 600, 60_000);
    const actor = ctx.session.user_id;
    const userRoute = /^\/api\/admin\/users\/([a-f0-9-]{36})(?:\/(revoke-sessions|disable|enable))?$/.exec(pathname);
    const route = userRoute ? (userRoute[2] ? `/api/admin/users/:id/${userRoute[2]}` : '/api/admin/users/:id') : pathname;
    const methods = {
      '/api/admin/overview': ['GET'], '/api/admin/feeds': ['GET'], '/api/admin/log': ['GET'],
      '/api/admin/users': ['GET'], '/api/admin/audit': ['GET'], '/api/admin/users/:id': ['GET', 'DELETE'],
      '/api/admin/users/:id/revoke-sessions': ['POST'], '/api/admin/users/:id/disable': ['POST'],
      '/api/admin/users/:id/enable': ['POST'],
    }[route];
    if (!methods) throw fail('not_found', 404);
    if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); throw fail('method_not_allowed', 405); }

    if (req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://localhost');
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
