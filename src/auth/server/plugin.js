import path from 'node:path';
import { openAuthStore } from './store.js';
import { createAuthService, parseOrigins, parseOwnerEmails } from './http.js';
import { createWebhookMailer } from './mail.js';
import { oauthProvidersFromEnv } from './oauth.js';

export const AUTH_FILE_DENY = ['**/.auth-data/**', '**/*.sqlite*', '**/*.db', '**/*.db-*'];

/** Same API instance for dev/preview; the production tunnel already routes /api here. */
export function authPlugin(env = process.env) {
  let root;
  let filename;
  const origins = parseOrigins(env.AUTH_ORIGINS || '');
  const mailer = createWebhookMailer(env, { origins });
  // Google/GitHub (2026-09-27): ID a tajomstvo len z .env servera, nikdy do prehliadača.
  const oauthProviders = oauthProvidersFromEnv(env);
  // Vlastník (2026-10-03, „táto funkcia je len pre mňa … mala by byť pod mojím účtom"): účty z
  // OKO_OWNER_EMAILS smú na súkromné časti (udalosti na kontrolu, zverejnenie, video) aj mimo
  // tohto počítača. Prázdne = len lokálne ako doteraz.
  const ownerEmails = parseOwnerEmails(env.OKO_OWNER_EMAILS);
  let store;
  let auth;
  const ensure = () => {
    if (!auth) {
      store = openAuthStore(filename);
      auth = createAuthService({ store, origins, mailer, oauthProviders, trustProxy: env.AUTH_TRUST_CLOUDFLARE_PROXY === 'true' });
    }
    return auth;
  };
  const install = server => {
    server.middlewares.use((req, res, next) => {
      let decoded;
      try { decoded = decodeURIComponent((req.url || '').split('?')[0]).replaceAll('\\', '/'); }
      catch { res.statusCode = 400; res.end(); return; }
      if (decoded === '/account.html') {
        // Vite's HTML middleware sets its own Cache-Control later. Keep the
        // standalone token-confirmation page's protections on the final response.
        const locked = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
          'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' };
        const setHeader = res.setHeader;
        res.setHeader = function (name, value) {
          const key = name.toLowerCase();
          if (key === 'content-security-policy') {
            const directives = String(value).split(';').map(part => part.trim())
              .filter(part => part && !/^frame-ancestors(?:\s|$)/i.test(part));
            value = [...directives, "frame-ancestors 'none'"].join('; ');
          }
          return setHeader.call(this, name, locked[key] ?? value);
        };
        for (const [name, value] of Object.entries(locked)) res.setHeader(name, value);
        res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      }
      // Defense in depth for Vite /@fs, ?raw and databases with custom names.
      if (decoded.includes('/.auth-data/') || /\.(sqlite[^/]*|db(?:-[^/]*)?)$/i.test(decoded)
        || decoded.toLowerCase().includes(filename.replaceAll('\\', '/').toLowerCase())
        || decoded.startsWith('/src/auth/server/')) {
        res.statusCode = 403; res.end('Forbidden'); return;
      }
      if (!(decoded === '/api/account' || decoded.startsWith('/api/account/') || decoded === '/api/auth' || decoded.startsWith('/api/auth/'))) return next();
      // Do not let encoded aliases reach a later middleware without the guard.
      if (decoded !== (req.url || '').split('?')[0]) { res.statusCode = 400; res.end(); return; }
      try {
        void ensure().middleware(req, res, next);
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'auth_unavailable' }));
      }
    });
    server.httpServer?.once('close', () => {
      if (auth) void auth.close().finally(() => store?.close());
      else store?.close();
    });
  };
  return {
    name: 'account-auth',
    /**
     * Je požiadavka od prihláseného vlastníka? (pre iné služby) — pôvod, relácia, pri zápise CSRF;
     * bez účtov v OKO_OWNER_EMAILS vždy false. Nikdy nevyhodí chybu.
     */
    isOwnerRequest(req, res, { mutation = false } = {}) {
      if (!ownerEmails.length || !filename) return false;
      try {
        const user = ensure().identify(req, res, { mutation });
        return Boolean(user && ownerEmails.includes(user.email));
      } catch { return false; }
    },
    ownerEmails: () => [...ownerEmails],
    config(config) {
      root = config.root || process.cwd();
      filename = path.resolve(root, env.AUTH_DB_PATH || '.auth-data/accounts.sqlite');
      const exposed = [config.publicDir === false ? null : path.resolve(root, config.publicDir || 'public'),
        path.resolve(root, 'dist'), path.resolve(root, config.build?.outDir || 'dist')].filter(Boolean);
      if (exposed.some(directory => filename === directory || filename.startsWith(directory + path.sep))) {
        throw new Error('AUTH_DB_PATH must not be inside public or a build output directory');
      }
      // Keep built-in Vite denies when adding our sensitive runtime files.
      return { server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', ...AUTH_FILE_DENY, filename.replaceAll('\\', '/') ] },
        watch: config.server?.watch === null ? null : { ignored: ['**/.auth-data/**'] } } };
    },
    configureServer: install,
    configurePreviewServer: install,
  };
}
