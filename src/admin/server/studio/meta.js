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
    /** Reel na Facebook stránku: start → upload na rupload.facebook.com → finish (zverejniť). Limit Mety: 30 reels / 24 h. */
    async facebookReel({ video, text }) {
      const c = config();
      if (!c.facebook) throw new Error('Facebook nie je nastavený (META_PAGE_ID, META_PAGE_TOKEN).');
      const start = await call(`${c.pageId}/video_reels`, { params: { upload_phase: 'start' } });
      const uploadUrl = start.upload_url || `https://rupload.facebook.com/video-upload/${c.version}/${start.video_id}`;
      if (!/^https:\/\/rupload\.facebook\.com\//.test(uploadUrl)) throw new Error('Neočakávaná adresa nahrávania.');
      const upload = await fetchImpl(uploadUrl, { method: 'POST', body: video, redirect: 'error', signal: AbortSignal.timeout(5 * 60_000),
        headers: { Authorization: `OAuth ${c.token}`, offset: '0', file_size: String(video.length), 'Content-Type': 'application/octet-stream' } });
      let uploaded = null;
      try { uploaded = await upload.json(); } catch { uploaded = null; }
      if (!upload.ok || uploaded?.error || uploaded?.success === false) throw graphError(uploaded, upload.status);
      await call(`${c.pageId}/video_reels`, { params: { video_id: start.video_id, upload_phase: 'finish', video_state: 'PUBLISHED', description: text } });
      return { id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
    },
    /** Reel na Instagram: kontajner REELS z verejnej URL videa → čakanie na spracovanie (až ~5 min) → zverejnenie. */
    async instagramReel({ videoUrl, text, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
      const c = config();
      if (!c.instagram) throw new Error('Instagram nie je nastavený (META_IG_USER_ID, META_PAGE_TOKEN).');
      const container = await call(`${c.igUserId}/media`, { params: { media_type: 'REELS', video_url: videoUrl, caption: text.slice(0, 2200), share_to_feed: 'true' } });
      let finished = false;
      for (let i = 0; i < 60 && !finished; i++) {
        const state = await call(container.id, { method: 'GET', params: { fields: 'status_code,status' } });
        if (state.status_code === 'FINISHED') finished = true;
        else if (state.status_code === 'ERROR' || state.status_code === 'EXPIRED') throw new Error(`Instagram reel: ${state.status_code} ${state.status || ''}`.trim());
        else await wait(5000);
      }
      if (!finished) throw new Error('Instagram reel sa nespracoval do 5 minút.');
      const published = await call(`${c.igUserId}/media_publish`, { params: { creation_id: container.id } });
      let url = null;
      try { url = (await call(published.id, { method: 'GET', params: { fields: 'permalink' } })).permalink || null; } catch { /* odkaz nie je nutný */ }
      return { id: published.id, url };
    },
    /**
     * Štatistiky príspevku (Fáza 3). FB: polia objektu + post insights (názvy metrík sa u Mety
     * menia — čo nepríde, ostane null). IG: /insights s metrikami pre feed/reels.
     * Vracia { views, reach, likes, comments, shares, saved } alebo hodí chybu.
     */
    async insights(target, id) {
      const c = config();
      const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
      if (target === 'facebook' || target === 'facebook-reel') {
        if (!c.facebook) throw new Error('Facebook nie je nastavený.');
        const out = { views: null, reach: null, likes: null, comments: null, shares: null, saved: null };
        const isReel = target === 'facebook-reel';
        const fields = isReel ? 'views,likes.summary(true).limit(0),comments.summary(true).limit(0)'
          : 'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares';
        const node = await call(id, { method: 'GET', params: { fields } });
        out.likes = num(node.reactions?.summary?.total_count ?? node.likes?.summary?.total_count);
        out.comments = num(node.comments?.summary?.total_count);
        out.shares = num(node.shares?.count);
        if (isReel) out.views = num(node.views);
        try {
          const metric = isReel ? 'post_impressions_unique,post_video_views' : 'post_impressions_unique,post_total_media_view_unique';
          const ins = await call(`${id}/insights`, { method: 'GET', params: { metric } });
          for (const row of ins.data || []) {
            const value = num(Array.isArray(row.values) ? row.values[0]?.value : row.value);
            if (row.name === 'post_impressions_unique' || row.name === 'post_total_media_view_unique') out.reach = out.reach ?? value;
            if (row.name === 'post_video_views') out.views = out.views ?? value;
          }
        } catch { /* insights vyžadujú pages_read_engagement; základné čísla už máme */ }
        return out;
      }
      if (!c.instagram) throw new Error('Instagram nie je nastavený.');
      const node = await call(id, { method: 'GET', params: { fields: 'like_count,comments_count,media_type,media_product_type' } });
      const out = { views: null, reach: null, likes: num(node.like_count), comments: num(node.comments_count), shares: null, saved: null };
      try {
        const ins = await call(`${id}/insights`, { method: 'GET', params: { metric: 'views,reach,saved,shares' } });
        for (const row of ins.data || []) {
          const value = num(Array.isArray(row.values) ? row.values[0]?.value : row.value);
          if (row.name in out) out[row.name] = value;
        }
      } catch { /* staršie médiá niektoré metriky nemajú */ }
      return out;
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
