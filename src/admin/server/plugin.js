// Admin panel OKO (2026-10-03) — Vite plugin telemetrie, vypínačov a oznamu.
// `enforce: 'pre'`: Vite spustí jeho configureServer pred ostatnými pluginmi, takže
// middleware stojí pred všetkými proxy (štatistika aj blokovanie vypnutého feedu).
// Vlastné odpovede si preto nesú X-Robots-Tag samy (noIndexPlugin je až za ním).
// Admin API (/api/admin/*) ostáva v auth službe; runtime si berie cez getAdminRuntime().
import path from 'node:path';
import { openAdminStore } from './store.js';
import { createAdminRuntime, secretValues } from './runtime.js';
import { createStudio } from './studio/index.js';
import { createAlerts } from './alerts.js';
import { FEEDS } from './feeds.js';
import { adminScheduler } from './scheduler.js';
import { createWebhookMailer } from '../../auth/server/mail.js';
import { parseOrigins, parseOwnerEmails } from '../../auth/server/http.js';
import { aiTranslatorsConfig, createAiTranslatorsClient } from '../../data/aiTranslatorsClient.js';
import { createVoiceCache } from '../../../scripts/lib/eventVideoPipeline.mjs';

/**
 * Hlas vlastníka pre reely Štúdia (2026-10-03): ai-translators (vlastná služba, kľúč v .env) cez tú istú
 * pamäť nahrávok ako video udalostí (<adresár DB letov>/event-video/voice). null = nenastavené.
 */
function ownerVoiceProvider(env, root) {
  const cfg = aiTranslatorsConfig(env);
  if (!cfg.token) return null;
  let client = null;
  try { client = createAiTranslatorsClient(cfg); } catch { return null; }
  const dbDir = path.dirname(String(env.FLIGHT_HISTORY_DB || '').trim() || path.join(root, '.gev-cache', 'flight-history.sqlite'));
  const cache = createVoiceCache(path.join(dbDir, 'event-video', 'voice'));
  return async text => {
    const hit = cache.get('own', text);
    if (hit?.wav) return hit.wav;
    const r = await client.readAloud(text, { voice: 'own', lang: 'sk' });
    const res = await fetch(r.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`stiahnutie hlasu zlyhalo: HTTP ${res.status}`);
    return cache.put('own', text, Buffer.from(await res.arrayBuffer()), { url: r.url, seconds: r.seconds, engine: r.engine, savedAt: new Date().toISOString() }).wav;
  };
}

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
      // Automatiku (časovače Štúdia a upozornení, dorábanie videí po reštarte) spúšťa len vydaná služba
      // oko-api — oko-dev nad tou istou DB by ju zdvojil (scheduler.js).
      const scheduler = adminScheduler({ root, env });
      console.info(`[admin] automatika Štúdia a upozornení: ${scheduler.enabled ? 'zapnutá' : 'vypnutá'} (${scheduler.reason})`);
      // Upozornenia (2026-10-04): webhook mailer účtov (AUTH_MAIL_*), príjemca = prvý OKO_OWNER_EMAILS alebo nastavenie v admine.
      const mailer = createWebhookMailer(env, { origins: parseOrigins(env.AUTH_ORIGINS || '') });
      runtime.alerts = createAlerts({ store, mailer, feeds: FEEDS, defaultEmail: parseOwnerEmails(env.OKO_OWNER_EMAILS)[0] || null,
        timers: scheduler.enabled });
      runtime.alerts.start();
      // Štúdio sociálnych sietí (2026-10-03): rovnaká admin DB, údaje cez loopback.
      runtime.studio = createStudio({ store, env, port: () => server.httpServer?.address()?.port ?? null,
        mediaDir: path.join(path.dirname(authDb), 'studio'), root, voiceProvider: ownerVoiceProvider(env, root),
        onAlert: event => runtime.alerts?.onStudioAlert(event), timers: scheduler.enabled });
      // start() dorába aj videá rozrenderované pred reštartom — to patrí tiež len jednému procesu.
      if (scheduler.enabled) runtime.studio.start();
      current = runtime;
      return runtime;
    };
    try { ensure(); } catch (error) { console.warn('[admin] telemetry unavailable:', error?.message || error); }
    server.middlewares.use((req, res, next) => {
      if (!runtime) return next();
      runtime.handlePublic(req, res, () => runtime.middleware(req, res, () => {
        if (runtime.studio && String(req.url || '').startsWith('/api/studio/')) {
          return void runtime.studio.handleMedia(req, res, next).catch(() => { if (!res.headersSent) { res.statusCode = 500; res.end(); } });
        }
        next();
      })).catch(() => next());
    });
    server.httpServer?.once('close', () => {
      if (!runtime) return;
      runtime.studio?.stop();
      runtime.alerts?.stop();
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
