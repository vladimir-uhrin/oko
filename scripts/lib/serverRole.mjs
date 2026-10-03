// scripts/lib/serverRole.mjs — rola procesu Vite (2026-10-01, vlastník: „začni zo všetkým" k návrhu
// oddeliť verejné API od vývojového servera).
//
// Doteraz okolive.sk/api a /s obsluhoval priamo dev server z PRACOVNÉHO stromu: každé uloženie
// serverového súboru reštartovalo verejné API a rozpracovaný kód bol hneď naživo. Teraz:
//   'api'   služba oko-api — verejné /api a /s z NEMENNEJ kópie commitnutého kódu (scripts/oko-api-release.ps1),
//           bez sledovania súborov, HMR a predprípravy závislostí; JEDINÝ proces so záznamom histórie,
//           strážcom, udalosťami a governorom kreditov OpenSky.
//   'proxy' služba oko-dev s OKO_API_UPSTREAM — lokálny vývoj UI; API pluginy sa nespúšťajú (dva procesy
//           by písali do tej istej databázy a dvakrát míňali kredity OpenSky), /api a /s sa preposielajú.
//   'full'  bez premenných — všetko v jednom procese ako doteraz (testy, návrat späť).
// Pure.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {{role: 'api'|'proxy'|'full', upstream: string|null}}
 */
export function resolveServerRole(env = process.env) {
  const role = String(env.OKO_ROLE || '').trim().toLowerCase();
  if (role === 'api') return { role: 'api', upstream: null };
  if (role && role !== 'dev') throw new Error(`OKO_ROLE: neznáma rola „${role}" (api | dev)`);
  const raw = String(env.OKO_API_UPSTREAM || '').trim();
  if (!raw) return { role: 'full', upstream: null };
  let url;
  try { url = new URL(raw); } catch { throw new Error(`OKO_API_UPSTREAM: neplatná adresa „${raw}"`); }
  // Upstream len na tomto počítači — kľúče a súkromné API (udalosti, ACARS) nesmú odísť inam.
  if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname) || !url.port) {
    throw new Error(`OKO_API_UPSTREAM musí byť http://localhost:<port> (je „${raw}")`);
  }
  return { role: 'proxy', upstream: url.origin };
}

/**
 * Preposielanie dev servera: /api (aj WebSocket) a /s/<id> (zdieľanie) na upstream. Host ostáva
 * localhost (changeOrigin: false) a bez X-Forwarded-* (xfwd: false) — upstream tak požiadavku
 * vlastníka z tohto počítača uzná ako lokálnu (isDirectLocalRequest), verejnosť z tunela nie.
 * @param {string} upstream
 */
export function proxyConfig(upstream) {
  return {
    '/api': { target: upstream, ws: true, changeOrigin: false, xfwd: false },
    '^/s/': { target: upstream, changeOrigin: false, xfwd: false },
  };
}

/**
 * Úpravy `server` podľa roly: api = bez sledovania súborov a HMR (kópia sa nemení), proxy = preposielanie.
 * @param {{role: string, upstream: string|null}} serverRole
 */
export function roleServerOverrides(serverRole) {
  if (serverRole?.role === 'api') return { watch: null, hmr: false };
  if (serverRole?.role === 'proxy') return { proxy: proxyConfig(serverRole.upstream) };
  return {};
}

/** Spúšťajú sa v tejto role API pluginy (záznam histórie, proxy zdrojov, zdieľanie, účty)? */
export function runsApiPlugins(serverRole) {
  return serverRole?.role !== 'proxy';
}
