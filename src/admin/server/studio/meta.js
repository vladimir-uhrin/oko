// OKO Štúdio (2026-10-03) — zverejnenie na Facebook stránku a Instagram cez Meta Graph API.
//
// Bezplatné API. Kľúče len v .env na serveri (nikdy do prehliadača ani do repozitára):
//   META_PAGE_ID, META_PAGE_TOKEN   — Facebook stránka (dlhodobý token stránky)
//   META_IG_USER_ID                 — Instagram profesionálny účet prepojený so stránkou
//   META_GRAPH_VERSION              — voliteľné, predvolene v23.0
// Cez API sa nedá publikovať na osobný Facebook profil — len na stránku. Bez
// konfigurácie Štúdio funguje v režime „ručné zdieľanie" (stiahnuť obrázok + text).

const DEFAULT_VERSION = 'v23.0';
const TIMEOUT_MS = 30_000;

export function metaConfig(env = process.env) {
  const version = /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION || '') ? env.META_GRAPH_VERSION : DEFAULT_VERSION;
  const pageId = /^\d{5,30}$/.test(env.META_PAGE_ID || '') ? env.META_PAGE_ID : null;
  const igUserId = /^\d{5,30}$/.test(env.META_IG_USER_ID || '') ? env.META_IG_USER_ID : null;
  const token = typeof env.META_PAGE_TOKEN === 'string' && env.META_PAGE_TOKEN.length > 20 ? env.META_PAGE_TOKEN : null;
  return { version, pageId, igUserId, token, facebook: Boolean(pageId && token), instagram: Boolean(igUserId && token) };
}

/** Chyba Graph API bez tokenu v texte. */
function graphError(body, status) {
  const message = body?.error?.message || `HTTP ${status}`;
  return Object.assign(new Error(String(message).replace(/access_token=[^&\s]+/g, 'access_token=***').slice(0, 300)),
    { code: body?.error?.code ?? null, status });
}

export function createMetaPublisher({ env = process.env, fetchImpl = (...args) => fetch(...args) } = {}) {
  const config = () => metaConfig(env);
  const base = () => `https://graph.facebook.com/${config().version}`;

  async function call(path, { method = 'POST', params = {}, form = null } = {}) {
    const { token } = config();
    const url = new URL(`${base()}/${path}`);
    let body;
    if (form) { form.append('access_token', token); body = form; }
    else if (method === 'GET') { for (const [k, v] of Object.entries({ ...params, access_token: token })) url.searchParams.set(k, v); }
    else body = new URLSearchParams({ ...params, access_token: token });
    const response = await fetchImpl(url, { method, body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    let json = null;
    try { json = await response.json(); } catch { json = null; }
    if (!response.ok || json?.error) throw graphError(json, response.status);
    return json;
  }

  return {
    status() {
      const c = config();
      return { facebook: c.facebook, instagram: c.instagram, version: c.version };
    },
    /** Fotka s popisom na Facebook stránku (multipart, obrázok nemusí byť verejný). */
    async facebookPhoto({ image, text }) {
      const c = config();
      if (!c.facebook) throw new Error('Facebook nie je nastavený (META_PAGE_ID, META_PAGE_TOKEN).');
      const form = new FormData();
      form.append('source', new Blob([image], { type: 'image/jpeg' }), 'oko.jpg');
      form.append('message', text);
      form.append('published', 'true');
      const result = await call(`${c.pageId}/photos`, { form });
      const postId = result.post_id || result.id;
      return { id: postId, url: `https://www.facebook.com/${postId}` };
    },
    /** Instagram: kontajner z verejnej URL obrázka → zverejnenie → odkaz. */
    async instagramImage({ imageUrl, text }) {
      const c = config();
      if (!c.instagram) throw new Error('Instagram nie je nastavený (META_IG_USER_ID, META_PAGE_TOKEN).');
      const container = await call(`${c.igUserId}/media`, { params: { image_url: imageUrl, caption: text.slice(0, 2200) } });
      // Obrázok sa spracuje rýchlo; krátke čakanie na FINISHED (max ~20 s).
      for (let i = 0; i < 10; i++) {
        const state = await call(container.id, { method: 'GET', params: { fields: 'status_code' } });
        if (state.status_code === 'FINISHED') break;
        if (state.status_code === 'ERROR' || state.status_code === 'EXPIRED') throw new Error(`Instagram kontajner: ${state.status_code}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      const published = await call(`${c.igUserId}/media_publish`, { params: { creation_id: container.id } });
      let url = null;
      try { url = (await call(published.id, { method: 'GET', params: { fields: 'permalink' } })).permalink || null; } catch { /* odkaz nie je nutný */ }
      return { id: published.id, url };
    },
    /** Zostávajúci denný limit Instagramu (100 príspevkov za 24 h). */
    async instagramLimit() {
      const c = config();
      if (!c.instagram) return null;
      const result = await call(`${c.igUserId}/content_publishing_limit`, { method: 'GET', params: { fields: 'quota_usage,config' } });
      const row = result.data?.[0];
      return row ? { used: row.quota_usage, total: row.config?.quota_total ?? 100 } : null;
    },
  };
}
