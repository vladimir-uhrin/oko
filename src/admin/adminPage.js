// Admin panel OKO (2026-10-03) — samostatná stránka /admin.html bez Cesia.
// Všetky údaje idú cez /api/admin/* (server pustí len rolu owner); texty sa vkladajú
// výhradne cez textContent. Oprávnenie rozhoduje server, táto stránka je len zobrazenie.

import { STATUS, barChart, barList, lineChart, number, statusStrip } from './charts.js';

const main = document.getElementById('admin-main');
const tabs = document.getElementById('admin-tabs');
const who = document.getElementById('admin-who');
let csrf = '';

const ERRORS = {
  owner_protected: 'Vlastníka ani vlastný účet tu nemožno meniť.',
  confirm_mismatch: 'Potvrdzovací e-mail nesedí — účet nebol zmazaný.',
  user_not_found: 'Účet už neexistuje.',
  rate_limited: 'Príliš veľa požiadaviek, skúste o chvíľu.',
  csrf_failed: 'Relácia sa zmenila. Obnovte stránku.',
  origin_denied: 'Požiadavka z nepovoleného pôvodu.',
  not_found: 'Prístup zamietnutý alebo relácia vypršala.',
  telemetry_unavailable: 'Telemetria na serveri nebeží (pozri log).',
  invalid_notice: 'Oznam má 1–280 znakov a platnosť 1 h až 30 dní.',
  cache_not_clearable: 'Tento priečinok nie je čistá cache — z panelu sa nemaže.',
  feed_not_found: 'Neznámy zdroj.',
  invalid_input: 'Neplatná hodnota.',
  meta_not_configured: 'Facebook/Instagram nie je pripojený (META_* v .env).',
  auto_publish_not_earned: 'Automatika sa odomkne po 10 zverejneniach bez úpravy textu.',
  draft_not_publishable: 'Tento návrh už nejde zverejniť.',
  invalid_text: 'Text musí mať 1–2200 znakov.',
  studio_unavailable: 'Štúdio na serveri nebeží (pozri log).',
};
const EVENTS = {
  registered: 'vytvorenie účtu', registered_google: 'vytvorenie cez Google', registered_github: 'vytvorenie cez GitHub',
  login: 'prihlásenie', login_google: 'prihlásenie cez Google', login_github: 'prihlásenie cez GitHub', logout: 'odhlásenie',
  password_changed: 'zmena hesla', password_reset: 'obnova hesla', password_reset_requested: 'žiadosť o obnovu hesla',
  profile_updated: 'úprava profilu', photo_updated: 'nová fotka', photo_removed: 'fotka odstránená',
  session_revoked: 'odhlásenie relácie', other_sessions_revoked: 'odhlásenie ostatných relácií',
  email_verified: 'overenie e-mailu', email_changed: 'zmena e-mailu', email_change_requested: 'žiadosť o zmenu e-mailu',
  verification_requested: 'žiadosť o overenie', google_linked: 'prepojenie Google', github_linked: 'prepojenie GitHub',
  admin_sessions_revoked: 'admin odhlásil relácie', account_disabled: 'admin zablokoval účet', account_enabled: 'admin odblokoval účet',
};
const AUDIT = { user_deleted: 'zmazal účet', user_disabled: 'zablokoval', user_enabled: 'odblokoval', sessions_revoked: 'odhlásil relácie',
  feed_updated: 'zmenil zdroj', notice_set: 'nastavil oznam', notice_cleared: 'zrušil oznam', errors_cleared: 'vymazal chyby',
  backup_created: 'zálohoval DB', cache_cleared: 'vyčistil cache', studio_generated: 'vytvoril návrh', studio_settings: 'zmenil automatiku Štúdia',
  studio_published: 'zverejnil príspevok', studio_shared: 'zdieľal ručne' };

// ── pomocníci ──────────────────────────────────────────────────────────────
function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function button(label, onClick, className = '') {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
const dateFmt = new Intl.DateTimeFormat('sk-SK', { dateStyle: 'short', timeStyle: 'short' });
const when = value => (value ? dateFmt.format(new Date(value)) : '—');
function bytes(value) {
  if (!Number.isFinite(value)) return '—';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = value; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function duration(seconds) {
  const d = Math.floor(seconds / 86400); const h = Math.floor(seconds % 86400 / 3600); const m = Math.floor(seconds % 3600 / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}
function table(headers, rows) {
  const wrap = el('div', 'admin-table-wrap');
  // Bez hlavičky = tabuľka kľúč/hodnota (užší prvý stĺpec, na mobile sa nescrolluje).
  const t = el('table', headers.some(Boolean) ? 'admin-table' : 'admin-table admin-kv');
  if (headers.some(Boolean)) {
    const head = el('tr');
    for (const h of headers) head.append(el('th', '', h));
    const thead = el('thead');
    thead.append(head);
    t.append(thead);
  }
  const body = el('tbody');
  for (const row of rows) body.append(row);
  t.append(body);
  wrap.append(t);
  return wrap;
}
function row(cells) {
  const tr = el('tr');
  for (const cell of cells) {
    const td = el('td');
    if (cell instanceof Node) td.append(cell); else td.textContent = cell ?? '—';
    tr.append(td);
  }
  return tr;
}
function badge(text, tone) { return el('span', `admin-badge admin-badge-${tone}`, text); }
function section(title, ...children) {
  const s = el('section', 'admin-section');
  if (title) s.append(el('h2', '', title));
  s.append(...children);
  return s;
}
function notice(text, tone = 'error') { return el('p', `admin-notice admin-notice-${tone}`, text); }

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const code = data?.error || `http_${response.status}`;
    throw Object.assign(new Error(ERRORS[code] || `Chyba: ${code}`), { code, status: response.status });
  }
  return data;
}

function setView(...nodes) { main.replaceChildren(...nodes); }
async function guarded(render) {
  try { await render(); }
  catch (error) { setView(notice(error.message)); }
}

// ── Prehľad ────────────────────────────────────────────────────────────────
async function renderOverview() {
  const [{ stats, server }, live, traffic24, chart] = await Promise.all([api('/api/admin/overview'),
    api('/api/admin/analytics?days=1').catch(() => null), api('/api/admin/traffic?hours=24').catch(() => null),
    api('/api/admin/accounts-chart?days=30').catch(() => null)]);
  const tiles = el('div', 'admin-tiles');
  const tile = (label, value, hint) => {
    const t = el('div', 'admin-tile');
    t.append(el('span', 'admin-tile-value', value), el('span', 'admin-tile-label', label));
    if (hint) t.append(el('span', 'admin-tile-hint', hint));
    tiles.append(t);
  };
  tile('účtov', stats.users, `${stats.verified} overených`);
  tile('nové za 24 h', stats.new24h, `${stats.new7d} za 7 dní`);
  tile('prihlásení teraz', stats.activeUsers, `${stats.activeSessions} relácií`);
  tile('prihlásení za 24 h', stats.logins24h);
  tile('zablokovaných', stats.disabled);
  tile('sledovaných letov', stats.follows);
  const nodes = [];
  if (live || traffic24) {
    const now = el('div', 'admin-tiles');
    const add = (label, value, hint, tone) => {
      const t = el('div', `admin-tile${tone ? ` admin-tile-${tone}` : ''}`);
      t.append(el('span', 'admin-tile-value', value), el('span', 'admin-tile-label', label));
      if (hint) t.append(el('span', 'admin-tile-hint', hint));
      now.append(t);
    };
    if (live) {
      const today = live.series[live.series.length - 1] || { visitors: 0, views: 0 };
      add('práve na stránke', live.liveNow, 'aktívni za 2,5 min');
      add('návštevníci dnes', today.visitors, `${today.views} zobrazení`);
    }
    if (traffic24) {
      const sum = traffic24.series.reduce((a, s) => ({ n: a.n + s.n, e5: a.e5 + s.e5 }), { n: 0, e5: 0 });
      add('požiadavky na API · 24 h', number(sum.n));
      add('chyby 5xx · 24 h', number(sum.e5), sum.n ? `${((sum.e5 / sum.n) * 100).toFixed(2)} %` : '', sum.e5 ? 'bad' : '');
    }
    nodes.push(section('Teraz', now));
  }
  nodes.push(section('Účty', tiles));
  if (chart) {
    const box = section('Registrácie a prihlásenia · 30 dní');
    lineChart(box, { labels: chart.series.map(d => shortDay(d.day)),
      series: [{ name: 'Prihlásenia', values: chart.series.map(d => d.logins) }, { name: 'Registrácie', values: chart.series.map(d => d.registrations) }] });
    nodes.push(box);
  }
  if (server) {
    const commit = server.commit ? `${server.commit.hash} · ${when(server.commit.date)} · ${server.commit.subject}` : 'neznámy';
    nodes.push(section('Server', table(['', ''], [
      row(['Beží od', `${when(server.startedAt)} (${duration(server.uptimeS)})`]),
      row(['Verzia kódu', commit]),
      row(['Node', `${server.node} · ${server.platform} · PID ${server.pid}`]),
      row(['Pamäť', `RSS ${bytes(server.rssBytes)} · heap ${bytes(server.heapUsedBytes)}`]),
      row(['Databáza účtov', bytes(server.dbBytes)]),
      row(['.gev-cache', `${server.cachePartial ? '> ' : ''}${bytes(server.cacheBytes)}`]),
    ])));
  }
  setView(...nodes);
}

// ── Feedy ──────────────────────────────────────────────────────────────────
function feedSummary(data) {
  if (!data || typeof data !== 'object') return '—';
  const parts = [];
  if ('hasKey' in data) parts.push(data.hasKey ? 'kľúč áno' : 'kľúč NIE');
  if ('configured' in data) parts.push(data.configured ? 'zapnuté' : 'vypnuté');
  if (Number.isFinite(data.dailyCount) && Number.isFinite(data.budget)) parts.push(`dnes ${data.dailyCount} / ${data.budget}`);
  if (Number.isFinite(data.cameras)) {
    parts.push(`${data.cameras} kamier`);
    for (const [state, n] of Object.entries(data.states || {})) parts.push(`${state} ${n}`);
  }
  if (data.lastFetch) parts.push(`posledné ${when(data.lastFetch)}`);
  if (data.lastBake) parts.push(`bake ${when(data.lastBake)}`);
  if ('hasLocalBuild' in data) parts.push(data.hasLocalBuild ? 'lokálny build' : 'bez lokálneho buildu');
  if (data.stale) parts.push('ZASTARANÉ');
  return parts.join(' · ') || 'OK';
}
async function renderFeeds() {
  setView(el('p', 'admin-muted', 'Zisťujem stav feedov…'));
  const [{ feeds: statuses }, { history, settings }] = await Promise.all([api('/api/admin/feeds'), api('/api/admin/feed-history?hours=168')]);
  const statusById = new Map(statuses.map(feed => [feed.id, feed]));
  const now = Date.now();
  const rows = settings.map(setting => {
    const status = statusById.get(setting.id);
    const h = history[setting.id] || { hourly: [], outages: [], samples: 0, failed: 0 };
    // Pás 7 dní po hodinách z reálnych požiadaviek: vypnuté / chyby / OK / ticho.
    const byHour = new Map(h.hourly.map(entry => [entry.at, entry]));
    const cells = [];
    for (let at = Math.floor(now / 3600_000) * 3600_000 - 167 * 3600_000; at <= now; at += 3600_000) {
      const entry = byHour.get(at);
      const state = !entry?.n ? 'idle' : entry.blocked >= entry.n ? 'off' : entry.e5 / entry.n > 0.2 ? 'bad' : entry.e5 ? 'warn' : 'ok';
      const text = { idle: 'bez požiadaviek', off: 'vypnuté', bad: 'veľa chýb', warn: 'občasné chyby', ok: 'OK' }[state];
      cells.push({ state, title: `${when(at)} · ${text}${entry ? ` · ${entry.n} pož., ${entry.e5} chýb 5xx` : ''}` });
    }
    const strip = el('div');
    statusStrip(strip, cells);
    const state = setting.enabled === false ? badge('vypnuté', 'bad')
      : status ? (status.ok ? badge('OK', 'ok') : badge(status.error || `HTTP ${status.status}`, 'bad')) : badge('bez statusu', 'muted');
    const outages = h.outages.length
      ? h.outages.slice(-3).map(o => `${when(o.from)}${o.ongoing ? ' – trvá' : ` – ${when(o.to)}`}`).join('; ')
      : (h.samples ? `0 výpadkov (${h.samples} kontrol)` : '—');
    const toggle = button(setting.enabled === false ? 'Zapnúť' : 'Vypnúť', async () => {
      if (setting.enabled !== false && !confirm(`Vypnúť „${setting.label}"? Glóbus ukáže, že zdroj je vypnutý.`)) return;
      try { await api(`/api/admin/feeds/${setting.id}`, { method: 'POST', body: { enabled: setting.enabled === false } }); await renderFeeds(); }
      catch (error) { main.prepend(notice(error.message)); }
    }, setting.enabled === false ? 'admin-btn admin-btn-sm' : 'admin-btn admin-btn-sm admin-btn-warn');
    const summary = el('div');
    summary.append(el('div', '', status ? feedSummary(status.data) : ''));
    if (status?.data) {
      const details = el('details', 'admin-details');
      details.append(el('summary', '', 'detail'), el('pre', '', JSON.stringify(status.data, null, 2)));
      summary.append(details);
    }
    return row([setting.label, state, strip, outages, summary, toggle]);
  });
  setView(section('Zdroje dát',
    el('p', 'admin-muted', 'Pás = posledných 7 dní po hodinách podľa skutočných požiadaviek (sivá = ticho, zelená = OK, žltá = občasné 5xx, červená = veľa 5xx, fialová = vypnuté). Výpadky z kontroly statusu každých 10 min. Vypnutý zdroj vracia 503 a glóbus to oznámi.'),
    table(['Zdroj', 'Stav', 'Dostupnosť 7 dní', 'Posledné výpadky', 'Súhrn', ''], rows),
    button('Obnoviť', () => guarded(renderFeeds), 'admin-btn')));
}

// ── Používatelia ───────────────────────────────────────────────────────────
const userState = { q: '', offset: 0 };
async function renderUsers() {
  const params = new URLSearchParams({ q: userState.q, offset: String(userState.offset) });
  const data = await api(`/api/admin/users?${params}`);
  const search = el('form', 'admin-search');
  const input = el('input');
  Object.assign(input, { type: 'search', placeholder: 'Hľadať e-mail alebo meno', value: userState.q, maxLength: 120 });
  input.setAttribute('aria-label', 'Hľadať používateľa');
  search.append(input, el('button', 'admin-btn', 'Hľadať'));
  search.addEventListener('submit', event => {
    event.preventDefault();
    userState.q = input.value.trim(); userState.offset = 0;
    void guarded(renderUsers);
  });
  const rows = data.users.map(user => {
    const state = el('span', 'admin-badges');
    if (user.role === 'owner') state.append(badge('owner', 'info'));
    if (user.disabledAt) state.append(badge('zablokovaný', 'bad'));
    if (!user.emailVerified) state.append(badge('neoverený', 'muted'));
    for (const provider of user.providers) state.append(badge(provider, 'muted'));
    const open = button(user.email, () => guarded(() => renderUser(user.id)), 'admin-link');
    return row([open, user.displayName, state, when(user.createdAt), when(user.lastLoginAt), String(user.sessions)]);
  });
  const pager = el('div', 'admin-pager');
  const from = data.total ? data.offset + 1 : 0;
  pager.append(el('span', 'admin-muted', `${from}–${data.offset + data.users.length} z ${data.total}`));
  if (data.offset > 0) pager.append(button('← Predošlé', () => { userState.offset = Math.max(0, data.offset - data.pageSize); void guarded(renderUsers); }, 'admin-btn'));
  if (data.offset + data.users.length < data.total) pager.append(button('Ďalšie →', () => { userState.offset = data.offset + data.pageSize; void guarded(renderUsers); }, 'admin-btn'));
  setView(section('Používatelia', search,
    table(['E-mail', 'Meno', 'Stav', 'Vytvorený', 'Posledné prihlásenie', 'Relácie'], rows), pager));
}

async function renderUser(id, message) {
  const { user } = await api(`/api/admin/users/${id}`);
  const protectedUser = user.role === 'owner';
  const back = button('← Späť na zoznam', () => guarded(renderUsers), 'admin-link');
  const facts = table(['', ''], [
    row(['E-mail', `${user.email}${user.emailVerified ? ' (overený)' : ' (neoverený)'}`]),
    row(['Meno', user.displayName]),
    row(['Rola', user.role]),
    row(['Stav', user.disabledAt ? `zablokovaný od ${when(user.disabledAt)}` : 'aktívny']),
    row(['Prihlásenie', [user.oauthOnly ? 'len cez poskytovateľa' : 'heslo', ...user.identities.map(i => i.provider)].join(', ')]),
    row(['Vytvorený', when(user.createdAt)]),
    row(['Posledné prihlásenie', when(user.lastLoginAt)]),
    row(['Zmena hesla', when(user.passwordChangedAt)]),
    row(['Sledované lety', String(user.follows)]),
  ]);
  const actions = el('div', 'admin-actions');
  const act = async (label, run) => {
    try { await run(); await renderUser(id, notice(label, 'ok')); }
    catch (error) { await renderUser(id, notice(error.message)); }
  };
  if (!protectedUser) {
    actions.append(button(`Odhlásiť všetky relácie (${user.sessions.length})`, () => {
      if (confirm(`Odhlásiť ${user.email} zo všetkých zariadení?`)) {
        void act('Relácie odhlásené.', () => api(`/api/admin/users/${id}/revoke-sessions`, { method: 'POST', body: {} }));
      }
    }, 'admin-btn'));
    actions.append(user.disabledAt
      ? button('Odblokovať', () => act('Účet odblokovaný.', () => api(`/api/admin/users/${id}/enable`, { method: 'POST', body: {} })), 'admin-btn')
      : button('Zablokovať', () => {
        if (confirm(`Zablokovať ${user.email}? Odhlási sa a nebude sa môcť prihlásiť.`)) {
          void act('Účet zablokovaný.', () => api(`/api/admin/users/${id}/disable`, { method: 'POST', body: {} }));
        }
      }, 'admin-btn admin-btn-warn'));
    actions.append(button('Zmazať účet…', async () => {
      const typed = prompt(`Natrvalo zmazať účet so všetkými údajmi. Pre potvrdenie napíšte jeho e-mail:\n${user.email}`);
      if (typed === null) return;
      try {
        await api(`/api/admin/users/${id}`, { method: 'DELETE', body: { confirm: typed.trim() } });
        await renderUsers();
        main.prepend(notice(`Účet ${user.email} zmazaný.`, 'ok'));
      } catch (error) { await renderUser(id, notice(error.message)); }
    }, 'admin-btn admin-btn-danger'));
  } else {
    actions.append(el('p', 'admin-muted', 'Účet vlastníka sa tu nemení — spravujte ho v Centre účtu.'));
  }
  const sessions = table(['Zariadenie', 'Začiatok', 'Naposledy'], user.sessions.map(s => row([s.label, when(s.createdAt), when(s.lastSeen)])));
  const events = table(['Udalosť', 'Čas'], user.events.map(e => row([EVENTS[e.type] || e.type, when(e.createdAt)])));
  setView(back, ...(message ? [message] : []), section(user.displayName, facts, actions),
    section('Aktívne relácie', user.sessions.length ? sessions : el('p', 'admin-muted', 'Žiadne.')),
    section('Aktivita účtu', user.events.length ? events : el('p', 'admin-muted', 'Žiadna.')));
}

// ── Štúdio sociálnych sietí ────────────────────────────────────────────────
const STUDIO_STATUS = { draft: ['návrh', 'muted'], approved: ['schválené', 'info'], published: ['zverejnené', 'ok'],
  failed: ['zlyhalo', 'bad'], discarded: ['zahodené', 'muted'] };
const STUDIO_REASONS = { nothing_to_post: 'Teraz nie je čo zverejniť (žiadna udalosť nad prahom).', exists: 'Návrh pre túto udalosť už existuje.',
  stale: 'Dáta sú zastarané — nezverejňujeme (pravidlo 2).', feed_disabled: 'Zdroj je vypnutý vo Feedoch.',
  source_unavailable: 'Zdroj dát je teraz nedostupný.', server_not_ready: 'Server ešte nebeží naplno, skúste o chvíľu.' };
const studioState = { filter: 'open' };
async function renderStudio(message) {
  const data = await api('/api/admin/studio');
  const meta = data.meta;
  const connected = meta.facebook || meta.instagram;
  // Stav pripojenia
  const status = el('div', 'admin-facts');
  status.append(badge(meta.facebook ? 'Facebook stránka pripojená' : 'Facebook nepripojený', meta.facebook ? 'ok' : 'muted'),
    badge(meta.instagram ? 'Instagram pripojený' : 'Instagram nepripojený', meta.instagram ? 'ok' : 'muted'));
  if (data.instagramLimit) status.append(el('span', 'admin-muted', `Instagram dnes ${data.instagramLimit.used} / ${data.instagramLimit.total}`));
  const mode = el('p', 'admin-muted', connected
    ? 'Zverejnenie ide priamo cez Meta Graph API (zadarmo). Nič sa nezverejní bez vášho kliknutia, kým nezapnete automatiku.'
    : 'Režim ručného zdieľania: OKO pripraví obrázok a text, vy ich stiahnete a zverejníte sami (aj na osobný profil). Automatické zverejnenie potrebuje Facebook stránku a v .env META_PAGE_ID, META_PAGE_TOKEN, META_IG_USER_ID — postup v docs/SOCIAL-PLAN.md.');
  // Vytvoriť návrh
  const create = el('div', 'admin-actions');
  for (const template of data.templates) {
    create.append(button(`+ ${template.label}`, async event => {
      event.target.disabled = true;
      try {
        const result = await api('/api/admin/studio/generate', { method: 'POST', body: { template: template.id } });
        await renderStudio(notice(result.created ? `Návrh vytvorený: ${result.draft.title}` : STUDIO_REASONS[result.reason] || result.reason, result.created ? 'ok' : 'info'));
      } catch (error) { await renderStudio(notice(error.message)); }
    }, 'admin-btn admin-btn-sm'));
  }
  create.append(button('Skontrolovať zdroje teraz', async () => {
    try { await api('/api/admin/studio/tick', { method: 'POST', body: {} }); await renderStudio(notice('Kontrola hotová.', 'ok')); }
    catch (error) { await renderStudio(notice(error.message)); }
  }, 'admin-btn admin-btn-sm'));

  // Automatika
  const auto = el('div', 'admin-studio-auto');
  const autoDraft = el('label', 'admin-check');
  const autoDraftBox = el('input'); autoDraftBox.type = 'checkbox'; autoDraftBox.checked = data.settings.autoDraft;
  autoDraftBox.addEventListener('change', () => saveStudioSettings({ autoDraft: autoDraftBox.checked }));
  autoDraft.append(autoDraftBox, document.createTextNode(' Automaticky pripravovať návrhy (každých 10 min, prehľad o 8:00) — zadarmo'));
  auto.append(autoDraft);
  const rows = data.templates.map(template => {
    const box = el('input'); box.type = 'checkbox'; box.checked = template.autoPublish;
    const earned = template.unchanged >= data.autoPublishMin;
    box.disabled = !earned || !connected;
    box.addEventListener('change', () => saveStudioSettings({ autoPublish: { [template.id]: box.checked } }));
    const label = el('label', 'admin-check'); label.append(box, document.createTextNode(' zverejniť automaticky'));
    const progress = earned ? badge('odomknuté', 'ok') : el('span', 'admin-muted', `${template.unchanged} / ${data.autoPublishMin} zverejnení bez úpravy`);
    return row([template.label, template.auto === 'daily' ? 'denne o 8:00' : template.auto ? 'pri udalosti' : 'ručne', progress, label]);
  });
  auto.append(table(['Šablóna', 'Návrhy', 'Podmienka automatiky', ''], rows),
    el('p', 'admin-muted', `Automatické zverejnenie sa pre šablónu odomkne po ${data.autoPublishMin} príspevkoch, ktoré ste zverejnili bez úpravy textu. Poistky: max ${data.settings.autoPublishPerDay} automatických príspevkov za 24 h, tichý čas ${data.settings.quietFrom}:00–${data.settings.quietTo}:00, zastarané dáta sa nezverejnia.`));

  // Filter a zoznam návrhov
  const filters = el('div', 'admin-range');
  for (const [key, label] of [['open', 'Na spracovanie'], ['published', 'Zverejnené'], ['discarded', 'Zahodené'], ['all', 'Všetko']]) {
    const b = button(label, () => { studioState.filter = key; void guarded(renderStudio); }, 'admin-chip');
    if (studioState.filter === key) b.setAttribute('aria-pressed', 'true');
    filters.append(b);
  }
  const shown = data.drafts.filter(d => studioState.filter === 'all' ? true : studioState.filter === 'open'
    ? ['draft', 'approved', 'failed'].includes(d.status) : d.status === studioState.filter);
  const grid = el('div', 'admin-studio-grid');
  for (const draft of shown) grid.append(studioCard(draft, meta));
  if (!shown.length) grid.append(el('p', 'admin-muted', 'Žiadne návrhy. Vytvorte ich tlačidlami vyššie, alebo počkajte na automatiku.'));

  setView(...(message ? [message] : []),
    section('Štúdio sociálnych sietí', status, mode, create),
    section('Automatika', auto),
    section('Príspevky', filters, grid));
}

async function saveStudioSettings(patch) {
  try { await api('/api/admin/studio/settings', { method: 'POST', body: patch }); await renderStudio(notice('Nastavenie uložené.', 'ok')); }
  catch (error) { await renderStudio(notice(error.message)); }
}

function studioCard(draft, meta) {
  const card = el('article', 'admin-studio-card');
  const img = el('img');
  img.src = `/api/admin/studio/drafts/${draft.id}/image?v=${draft.updatedAt}`;
  img.alt = draft.title; img.loading = 'lazy'; img.width = 270; img.height = 338;
  const body = el('div', 'admin-studio-body');
  const head = el('div', 'admin-badges');
  const [statusText, tone] = STUDIO_STATUS[draft.status] || [draft.status, 'muted'];
  head.append(badge(statusText, tone), badge(draft.origin === 'auto' ? 'automaticky' : 'ručne', 'muted'));
  if (draft.edited) head.append(badge('upravené', 'muted'));
  const text = el('textarea', 'admin-studio-text'); text.value = draft.text; text.rows = 9; text.maxLength = 2200;
  text.setAttribute('aria-label', `Text príspevku: ${draft.title}`);
  const editable = ['draft', 'approved', 'failed'].includes(draft.status);
  text.readOnly = !editable;
  const actions = el('div', 'admin-actions');
  const act = (label, run, cls = 'admin-btn admin-btn-sm') => button(label, async event => {
    event.target.disabled = true;
    try { const msg = await run(); await renderStudio(msg ? notice(msg, 'ok') : undefined); }
    catch (error) { await renderStudio(notice(error.message)); }
  }, cls);
  if (editable) {
    actions.append(act('Uložiť text', async () => { await api(`/api/admin/studio/drafts/${draft.id}`, { method: 'POST', body: { text: text.value } }); return 'Text uložený.'; }));
    if (draft.status === 'draft') actions.append(act('Schváliť', async () => { await api(`/api/admin/studio/drafts/${draft.id}/approve`, { method: 'POST', body: {} }); return 'Schválené.'; }));
    const targets = ['facebook', 'instagram'].filter(t => meta[t]);
    if (targets.length) {
      actions.append(act(`Zverejniť (${targets.map(t => (t === 'facebook' ? 'FB' : 'IG')).join(' + ')})`, async () => {
        if (text.value !== draft.text) await api(`/api/admin/studio/drafts/${draft.id}`, { method: 'POST', body: { text: text.value } });
        if (!confirm(`Zverejniť „${draft.title}" na ${targets.join(' a ')}?`)) return '';
        const result = await api(`/api/admin/studio/drafts/${draft.id}/publish`, { method: 'POST', body: { targets } });
        return result.draft.status === 'published' ? 'Zverejnené.' : 'Časť zverejnenia zlyhala — pozri detail.';
      }, 'admin-btn admin-btn-sm admin-btn-go'));
    }
  }
  const download = el('a', 'admin-btn admin-btn-sm', 'Stiahnuť obrázok');
  download.href = `/api/admin/studio/drafts/${draft.id}/image`; download.download = `oko-${draft.id.slice(0, 8)}.jpg`;
  actions.append(download, button('Kopírovať text', async event => {
    try { await navigator.clipboard.writeText(text.value); event.target.textContent = 'Skopírované ✓'; }
    catch { text.select(); event.target.textContent = 'Označené — Ctrl+C'; }
  }, 'admin-btn admin-btn-sm'));
  if (editable) {
    actions.append(act('Zdieľal som ručne', async () => { await api(`/api/admin/studio/drafts/${draft.id}/shared`, { method: 'POST', body: {} }); return 'Označené ako zverejnené.'; }),
      act('Zahodiť', async () => { await api(`/api/admin/studio/drafts/${draft.id}/discard`, { method: 'POST', body: {} }); return ''; }, 'admin-btn admin-btn-sm admin-btn-warn'));
  }
  if (draft.status === 'discarded') actions.append(act('Obnoviť', async () => { await api(`/api/admin/studio/drafts/${draft.id}/restore`, { method: 'POST', body: {} }); return ''; }));
  const results = el('div', 'admin-studio-results');
  for (const [target, result] of Object.entries(draft.results || {})) {
    const line = el('div');
    const name = { facebook: 'Facebook', instagram: 'Instagram', manual: 'Ručne' }[target] || target;
    if (result.error) line.append(badge(`${name}: chyba`, 'bad'), document.createTextNode(` ${result.error}`));
    else if (result.url) { const a = el('a', '', `${name}: otvoriť príspevok`); a.href = result.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; line.append(a); }
    else line.append(document.createTextNode(`${name}: ${when(result.at)}`));
    results.append(line);
  }
  body.append(head, el('h3', '', draft.title), el('p', 'admin-muted', `vytvorené ${when(draft.createdAt)}${draft.publishedAt ? ` · zverejnené ${when(draft.publishedAt)}` : ''}`),
    text, actions, results);
  card.append(img, body);
  return card;
}

// ── Audit a log ────────────────────────────────────────────────────────────
async function renderAudit() {
  const { audit } = await api('/api/admin/audit');
  const rows = audit.map(entry => row([when(entry.createdAt), entry.actorEmail || '—', AUDIT[entry.action] || entry.action, entry.detail || entry.targetId]));
  setView(section('Zásahy administrátora', audit.length ? table(['Čas', 'Kto', 'Akcia', 'Účet'], rows) : el('p', 'admin-muted', 'Zatiaľ žiadne.')));
}
async function renderLog() {
  const { log } = await api('/api/admin/log');
  const pre = el('pre', 'admin-log', log || 'Log je prázdny alebo neexistuje (.gev-cache/logs/oko-server.log).');
  setView(section('Log servera', el('p', 'admin-muted', 'Posledných ~48 kB z oko-server.log.'), pre,
    button('Obnoviť', () => guarded(renderLog), 'admin-btn')));
  pre.scrollTop = pre.scrollHeight;
}

// ── Analytika ──────────────────────────────────────────────────────────────
const shortDay = day => { const [, m, d] = day.split('-'); return `${Number(d)}. ${Number(m)}.`; };
const DIM_TITLES = { path: 'Stránky', ref: 'Odkiaľ prišli', country: 'Krajiny', browser: 'Prehliadače', os: 'Systémy',
  device: 'Zariadenia', screen: 'Šírka okna (px)', lang: 'Jazyk prehliadača', hour: 'Hodina dňa (Bratislava)', layer: 'Zapnuté vrstvy' };
const countryName = (() => { try { const names = new Intl.DisplayNames(['sk'], { type: 'region' }); return code => (code === '??' ? 'neznáma' : names.of(code) || code); } catch { return code => code; } })();
const analyticsState = { days: 30 };
function rangePicker(state, options, onChange) {
  const wrap = el('div', 'admin-range');
  for (const [value, label] of options) {
    const b = button(label, () => { state.days = value; onChange(); }, 'admin-chip');
    if (state.days === value) b.setAttribute('aria-pressed', 'true');
    wrap.append(b);
  }
  return wrap;
}
async function renderAnalytics() {
  const data = await api(`/api/admin/analytics?days=${analyticsState.days}`);
  const tiles = el('div', 'admin-tiles');
  const tile = (label, value, hint) => {
    const t = el('div', 'admin-tile');
    t.append(el('span', 'admin-tile-value', value), el('span', 'admin-tile-label', label));
    if (hint) t.append(el('span', 'admin-tile-hint', hint));
    tiles.append(t);
  };
  const today = data.series[data.series.length - 1] || { views: 0, visitors: 0 };
  tile('práve na stránke', data.liveNow, 'aktívni za 2,5 min');
  tile('návštevníci dnes', today.visitors, `${today.views} zobrazení`);
  tile(`návštevníci · ${data.days} d`, number(data.totals.visitors), 'súčet denných unikátov');
  tile(`zobrazenia · ${data.days} d`, number(data.totals.views), data.totals.visitors ? `${(data.totals.views / data.totals.visitors).toFixed(1)} na návštevníka` : '');
  tile('aktívny čas', `${number(Math.round(data.totals.minutes / 60))} h`, data.totals.views ? `${(data.totals.minutes / data.totals.views).toFixed(1)} min na zobrazenie` : '');
  tile('boti', number(data.totals.bots), 'nezapočítaní');
  const trend = el('div');
  const picker = rangePicker(analyticsState, [[7, '7 dní'], [30, '30 dní'], [90, '90 dní'], [365, 'rok']], () => guarded(renderAnalytics));
  setView(section('Návštevnosť', picker, tiles), section('Vývoj', trend));
  lineChart(trend, { labels: data.series.map(d => shortDay(d.day)),
    series: [{ name: 'Návštevníci', values: data.series.map(d => d.visitors) }, { name: 'Zobrazenia', values: data.series.map(d => d.views) }] });
  const grid = el('div', 'admin-grid');
  for (const dim of ['ref', 'country', 'path', 'layer', 'device', 'browser', 'os', 'screen', 'lang']) {
    const box = el('section', 'admin-section admin-cell');
    box.append(el('h2', '', DIM_TITLES[dim]));
    barList(box, data.dims[dim] || [], { labelOf: dim === 'country' ? r => countryName(r.val) : r => r.val });
    grid.append(box);
  }
  const hours = new Map((data.dims.hour || []).map(r => [r.val, r.n]));
  const hourBox = section(DIM_TITLES.hour);
  barChart(hourBox, { labels: Array.from({ length: 24 }, (_, h) => `${h}`), values: Array.from({ length: 24 }, (_, h) => hours.get(String(h).padStart(2, '0')) || 0), name: 'Zobrazenia' });
  main.append(hourBox, grid,
    el('p', 'admin-muted', 'Anonymne: bez cookie a bez IP v databáze. Návštevník = hash s dennou soľou, ktorý po polnoci zanikne (ostane len počet). Do Not Track / GPC sa rešpektuje.'));
}

const percent = (part, whole) => { const p = (part / whole) * 100; return p > 0 && p < 0.1 ? '< 0,1 %' : `${p.toFixed(1).replace('.', ',')} %`; };

// ── Prevádzka (požiadavky na API) ──────────────────────────────────────────
const trafficState = { days: 2 };
async function renderTraffic() {
  const hours = trafficState.days * 24;
  const data = await api(`/api/admin/traffic?hours=${hours}`);
  const picker = rangePicker(trafficState, [[1, '24 h'], [2, '48 h'], [7, '7 dní'], [30, '30 dní']], () => guarded(renderTraffic));
  const label = at => { const d = new Date(at); return trafficState.days > 2 ? `${d.getDate()}. ${d.getMonth() + 1}.` : `${d.getHours()}:00`; };
  const req = el('div'); const errs = el('div'); const lat = el('div');
  setView(section('Požiadavky na API za hodinu', picker, req), section('Chyby servera (5xx) za hodinu', errs), section('Priemerná odozva (ms)', lat));
  barChart(req, { labels: data.series.map(s => label(s.at)), values: data.series.map(s => s.n), name: 'Požiadavky' });
  barChart(errs, { labels: data.series.map(s => label(s.at)), values: data.series.map(s => s.e5), name: 'Chyby 5xx', color: STATUS.critical,
    notes: data.series.map(s => (s.blocked ? `zablokované adminom: ${s.blocked}` : '')) });
  barChart(lat, { labels: data.series.map(s => label(s.at)), values: data.series.map(s => s.avgMs), name: 'Odozva ms' });
  const rows = data.routes.map(r => row([r.label, number(r.n), r.e5 ? badge(`${r.e5} (${percent(r.e5, r.n)})`, 'bad') : '0',
    number(r.e4), r.blocked ? number(r.blocked) : '—', `${r.avgMs} / ${r.maxMs}`, bytes(r.bytes)]));
  main.append(section('Podľa zdroja', table(['Zdroj', 'Požiadavky', '5xx', '4xx', 'Blokované', 'Odozva ø / max ms', 'Prenos'], rows)));
}

// ── Chyby ──────────────────────────────────────────────────────────────────
const KINDS = { '': 'Všetky', server: 'Server (error)', http: 'HTTP 5xx', client: 'Prehliadač (JS)', warn: 'Server (warning)' };
const errorState = { kind: '' };
async function renderErrors() {
  const { errors } = await api(`/api/admin/errors${errorState.kind ? `?kind=${errorState.kind}` : ''}`);
  const filters = el('div', 'admin-range');
  for (const [kind, label] of Object.entries(KINDS)) {
    const b = button(label, () => { errorState.kind = kind; void guarded(renderErrors); }, 'admin-chip');
    if (errorState.kind === kind) b.setAttribute('aria-pressed', 'true');
    filters.append(b);
  }
  const rows = errors.map(e => {
    const message = el('div');
    message.append(el('div', 'admin-err-msg', e.message));
    if (e.detail) { const d = el('details', 'admin-details'); d.append(el('summary', '', 'detail'), el('pre', '', e.detail)); message.append(d); }
    const tone = e.kind === 'warn' ? 'muted' : 'bad';
    return row([badge(KINDS[e.kind] || e.kind, tone), message, number(e.count), when(e.lastAt), when(e.firstAt)]);
  });
  const clear = button('Vymazať zobrazené', async () => {
    if (!confirm('Vymazať tieto záznamy chýb?')) return;
    try { await api('/api/admin/errors', { method: 'DELETE', body: errorState.kind ? { kind: errorState.kind } : {} }); await renderErrors(); }
    catch (error) { main.prepend(notice(error.message)); }
  }, 'admin-btn admin-btn-danger');
  setView(section('Chyby a varovania', filters,
    el('p', 'admin-muted', 'Rovnaké chyby sú zlúčené (čísla sa ignorujú). Kľúče z .env a parametre key/token v URL sú nahradené ***. Uchováva sa 30 dní.'),
    errors.length ? table(['Druh', 'Správa', 'Počet', 'Naposledy', 'Prvýkrát'], rows) : el('p', 'admin-muted', 'Žiadne chyby. 🎉'), clear));
}

// ── Náklady a limity ───────────────────────────────────────────────────────
async function renderCosts() {
  const data = await api('/api/admin/costs?days=30');
  setView(section('Náklady a limity',
    el('p', 'admin-muted', 'Platené zdroje (OpenAI, Google) sa počítajú po požiadavkách na náš server; denný strop ich nad limit odmietne (429). Cenu za jednotku zadáte vy — odhad je len násobok. TomTom a GFW ukazujú aj spotrebu kvóty z ich vlastného počítadla.')));
  for (const feed of data.feeds) {
    const box = section(feed.label);
    const facts = el('div', 'admin-facts');
    const fact = (label, value) => { const f = el('div'); f.append(el('span', 'admin-muted', `${label} `), el('strong', '', value)); facts.append(f); };
    fact('dnes', `${number(feed.today)} ${feed.unit}`);
    fact('30 dní', number(feed.total));
    if (feed.estimate !== null) fact('odhad 30 dní', `${number(feed.estimate)} €`);
    if (feed.provider) fact('kvóta providera dnes', `${number(feed.provider.dailyCount)}${feed.provider.budget ? ` / ${number(feed.provider.budget)}` : ''}`);
    if (feed.dailyCap !== null) fact('denný strop', number(feed.dailyCap));
    if (!feed.enabled) facts.append(badge('vypnuté', 'bad'));
    if (feed.dailyCap && feed.today >= feed.dailyCap * 0.8) facts.append(badge(feed.today >= feed.dailyCap ? 'strop dosiahnutý' : 'blízko stropu', 'bad'));
    box.append(facts);
    if (feed.total || feed.series.some(d => d.blocked)) {
      barChart(box, { labels: feed.series.map(d => shortDay(d.day)), values: feed.series.map(d => d.n), name: feed.unit, marker: feed.dailyCap,
        notes: feed.series.map(d => (d.blocked ? `odmietnuté stropom/vypnutím: ${d.blocked}` : '')) });
    } else box.append(el('p', 'admin-muted', 'Za 30 dní žiadne požiadavky.'));
    if (feed.paid) {
      const form = el('form', 'admin-inline-form');
      const cap = el('input'); Object.assign(cap, { type: 'number', min: 0, step: 1, placeholder: 'bez stropu', value: feed.dailyCap ?? '' });
      const price = el('input'); Object.assign(price, { type: 'number', min: 0, step: 0.0001, placeholder: '€ / jednotka', value: feed.unitPrice ?? '' });
      const capLabel = el('label', '', 'Denný strop '); capLabel.append(cap);
      const priceLabel = el('label', '', 'Cena € za jednotku '); priceLabel.append(price);
      form.append(capLabel, priceLabel, el('button', 'admin-btn admin-btn-sm', 'Uložiť'));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const body = { dailyCap: cap.value === '' ? null : Number(cap.value), unitPrice: price.value === '' ? null : Number(price.value) };
        try { await api(`/api/admin/feeds/${feed.id}`, { method: 'POST', body }); await renderCosts(); main.prepend(notice(`${feed.label}: uložené.`, 'ok')); }
        catch (error) { main.prepend(notice(error.message)); }
      });
      box.append(form);
    }
    main.append(box);
  }
}

// ── Oznam ──────────────────────────────────────────────────────────────────
async function renderNotice() {
  const data = await api('/api/admin/notice');
  const current = data.notice?.value;
  const form = el('form', 'admin-notice-form');
  const text = el('textarea'); Object.assign(text, { maxLength: 280, rows: 3, placeholder: 'Napr. Dnes o 20:00 krátka údržba servera.', value: current?.text || '' });
  text.setAttribute('aria-label', 'Text oznamu');
  const level = el('select');
  for (const [value, label] of [['info', 'Informácia'], ['warn', 'Upozornenie']]) {
    const option = el('option', '', label); option.value = value; if (current?.level === value) option.selected = true; level.append(option);
  }
  const hours = el('select');
  for (const [value, label] of [['', 'kým ho nezruším'], ['1', '1 hodinu'], ['6', '6 hodín'], ['24', '1 deň'], ['72', '3 dni'], ['168', '7 dní']]) {
    const option = el('option', '', label); option.value = value; hours.append(option);
  }
  const lLevel = el('label', '', 'Typ '); lLevel.append(level);
  const lHours = el('label', '', 'Platnosť '); lHours.append(hours);
  const save = el('button', 'admin-btn', 'Zverejniť');
  const clear = button('Zrušiť oznam', async () => {
    try { await api('/api/admin/notice', { method: 'POST', body: { text: '' } }); await renderNotice(); main.prepend(notice('Oznam zrušený.', 'ok')); }
    catch (error) { main.prepend(notice(error.message)); }
  }, 'admin-btn admin-btn-warn');
  const controls = el('div', 'admin-actions'); controls.append(lLevel, lHours, save, clear);
  form.append(text, controls);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = { text: text.value, level: level.value, ...(hours.value ? { hours: Number(hours.value) } : {}) };
    try { await api('/api/admin/notice', { method: 'POST', body }); await renderNotice(); main.prepend(notice('Oznam je na glóbuse (do 5 min u otvorených kariet).', 'ok')); }
    catch (error) { main.prepend(notice(error.message)); }
  });
  const preview = el('div', 'admin-preview');
  const shown = data.public;
  const parts = [shown.notice?.text, shown.disabled.length ? `Dočasne vypnuté: ${shown.disabled.join(', ')}.` : ''].filter(Boolean);
  preview.append(el('div', `admin-preview-bar${shown.notice?.level === 'warn' || (!shown.notice && shown.disabled.length) ? ' warn' : ''}`, parts.join(' ') || 'Nič — banner sa neukazuje.'));
  setView(section('Oznam na glóbuse', form,
    el('p', 'admin-muted', current?.until ? `Platí do ${when(current.until)}.` : current ? 'Platí, kým ho nezrušíte.' : 'Žiadny oznam nie je nastavený.')),
    section('Ako to teraz vidia návštevníci', preview,
      el('p', 'admin-muted', 'Vypnuté zdroje (Feedy) sa do banneru pridávajú automaticky.')));
}

// ── Údržba ─────────────────────────────────────────────────────────────────
async function renderMaintenance() {
  const data = await api('/api/admin/maintenance');
  const backup = button('Zálohovať databázy teraz', async event => {
    event.target.disabled = true;
    try { const result = await api('/api/admin/maintenance/backup', { method: 'POST', body: {} }); await renderMaintenance(); main.prepend(notice(`Záloha: ${result.made.join(', ')}`, 'ok')); }
    catch (error) { main.prepend(notice(error.message)); event.target.disabled = false; }
  }, 'admin-btn');
  const backups = data.backups.length ? table(['Súbor', 'Veľkosť', 'Vytvorená'], data.backups.map(b => row([b.name, bytes(b.bytes), when(b.createdAt)])))
    : el('p', 'admin-muted', 'Zatiaľ žiadna záloha.');
  const cacheRows = data.cache.map(dir => {
    const action = dir.clearable ? button('Vyčistiť', async () => {
      if (!confirm(`Vymazať cache „${dir.name}"? Stiahne sa znova pri ďalšom použití.`)) return;
      try { const result = await api('/api/admin/maintenance/cache', { method: 'POST', body: { name: dir.name } }); await renderMaintenance(); main.prepend(notice(`${dir.name}: zmazaných ${result.removed} súborov (${bytes(result.freed)}).`, 'ok')); }
      catch (error) { main.prepend(notice(error.message)); }
    }, 'admin-btn admin-btn-sm admin-btn-warn') : el('span', 'admin-muted', 'dáta, nie cache');
    return row([dir.name, `${dir.partial ? '> ' : ''}${bytes(dir.bytes)}`, action]);
  });
  setView(section('Záloha', el('p', 'admin-muted', 'Konzistentná kópia DB účtov aj admin DB do .auth-data/backups (ponechá 14 najnovších). Zálohy obsahujú hashe hesiel — zostávajú len na serveri.'), backup, backups),
    section('Cache (.gev-cache)', data.cache.length ? table(['Priečinok', 'Veľkosť', ''], cacheRows) : el('p', 'admin-muted', 'Cache je prázdna.'),
      el('p', 'admin-muted', 'Mazať sa dá len čistá cache (obrázky, logá, Overpass, preklady, TomTom dlaždice…). Archív letov, zdieľané odkazy, terén a meteo bake sú dáta. Počítadlá rozpočtu (budget.json) sa nemažú.')));
}

// ── štart ──────────────────────────────────────────────────────────────────
const RENDER = { overview: renderOverview, analytics: renderAnalytics, traffic: renderTraffic, errors: renderErrors,
  costs: renderCosts, feeds: renderFeeds, users: renderUsers, notice: renderNotice, maintenance: renderMaintenance,
  studio: renderStudio, audit: renderAudit, log: renderLog };
function show(tab) {
  const current = RENDER[tab] ? tab : 'overview';
  for (const b of tabs.querySelectorAll('button')) {
    if (b.dataset.tab === current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (location.hash !== `#${current}`) history.replaceState(null, '', `#${current}`);
  void guarded(RENDER[current]);
}

async function start() {
  let session;
  try { session = await api('/api/auth/session'); }
  catch { setView(notice('Server účtov je nedostupný.')); return; }
  if (!session.user) {
    const link = el('a', 'admin-btn', 'Prihlásiť sa');
    link.href = '/account.html';
    setView(section('Admin', el('p', '', 'Najprv sa prihláste účtom vlastníka, potom sa sem vráťte.'), link));
    return;
  }
  if (session.user.role !== 'owner') {
    setView(section('Admin', el('p', '', 'Tento účet nemá prístup do administrácie.')));
    return;
  }
  csrf = session.csrfToken || '';
  who.textContent = session.user.email;
  tabs.hidden = false;
  tabs.addEventListener('click', event => {
    const tab = event.target.closest('button')?.dataset.tab;
    if (tab) show(tab);
  });
  show(location.hash.slice(1));
}

void start();
