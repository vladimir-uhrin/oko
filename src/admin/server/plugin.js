// Admin panel OKO (2026-10-03) — Vite plugin telemetrie, vypínačov a oznamu.
// `enforce: 'pre'`: Vite spustí jeho configureServer pred ostatnými pluginmi, takže
// middleware stojí pred všetkými proxy (štatistika aj blokovanie vypnutého feedu).
// Vlastné odpovede si preto nesú X-Robots-Tag samy (noIndexPlugin je až za ním).
// Admin API (/api/admin/*) ostáva v auth službe; runtime si berie cez getAdminRuntime().
import path from 'node:path';
import { openAdminStore } from './store.js';
import { createAdminRuntime, secretValues } from './runtime.js';
import { createStudio } from './studio/index.js';

let current = null;
/** Runtime bežiaceho servera (null pred štartom alebo v testoch bez pluginu). */
export const getAdminRuntime = () => current;

export function adminPlugin(env = process.env) {
  let root;
  const install = server => {
    let runtime = null;
    const ensure = () => {
      if (runtime) return runtime;
      const authDb = path.resolve(root, env.AUTH_DB_PATH || '.auth-data/accounts.sqlite');
      const store = openAdminStore(path.join(path.dirname(authDb), 'admin.sqlite'));
      const ownHosts = ['localhost', '127.0.0.1', ...String(env.AUTH_ORIGINS || '').split(',')
        .map(origin => { try { return new URL(origin.trim()).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean)];
      runtime = createAdminRuntime({ store, ownHosts, secrets: secretValues(env),
        port: () => server.httpServer?.address()?.port ?? null });
      runtime.start();
      // Štúdio sociálnych sietí (2026-10-03): rovnaká admin DB, údaje cez loopback.
      runtime.studio = createStudio({ store, env, port: () => server.httpServer?.address()?.port ?? null });
      runtime.studio.start();
      current = runtime;
      return runtime;
    };
    try { ensure(); } catch (error) { console.warn('[admin] telemetry unavailable:', error?.message || error); }
    server.middlewares.use((req, res, next) => {
      if (!runtime) return next();
      runtime.handlePublic(req, res, () => runtime.middleware(req, res, () => {
        if (runtime.studio && String(req.url || '').startsWith('/api/studio/')) return runtime.studio.handleMedia(req, res, next);
        next();
      })).catch(() => next());
    });
    server.httpServer?.once('close', () => {
      if (!runtime) return;
      runtime.studio?.stop();
      runtime.stop();
      runtime.store.close();
      if (current === runtime) current = null;
      runtime = null;
    });
  };
  return {
    name: 'oko-admin-telemetry',
    enforce: 'pre',
    config(config) { root = config.root || process.cwd(); },
    configureServer: install,
    configurePreviewServer: install,
  };
}
