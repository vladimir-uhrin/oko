// Admin panel OKO (2026-10-03) — samostatná stránka /admin.html bez Cesia.
// Všetky údaje idú cez /api/admin/* (server pustí len rolu owner); texty sa vkladajú
// výhradne cez textContent. Oprávnenie rozhoduje server, táto stránka je len zobrazenie.

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
const AUDIT = { user_deleted: 'zmazal účet', user_disabled: 'zablokoval', user_enabled: 'odblokoval', sessions_revoked: 'odhlásil relácie' };

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
  const { stats, server } = await api('/api/admin/overview');
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
  const nodes = [section('Účty', tiles)];
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
  const { feeds } = await api('/api/admin/feeds');
  const rows = feeds.map(feed => {
    const details = el('details', 'admin-details');
    details.append(el('summary', '', 'detail'), el('pre', '', JSON.stringify(feed.data, null, 2)));
    const state = feed.ok ? badge('OK', 'ok') : badge(feed.error || `HTTP ${feed.status}`, 'bad');
    return row([feed.label, state, `${feed.ms} ms`, feedSummary(feed.data), details]);
  });
  setView(section('Stav feedov',
    el('p', 'admin-muted', 'Z existujúcich /status endpointov. Hodnota sa drží 30 s; kľúče sa nikdy nezobrazujú.'),
    table(['Feed', 'Stav', 'Odozva', 'Súhrn', ''], rows),
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

// ── štart ──────────────────────────────────────────────────────────────────
const RENDER = { overview: renderOverview, feeds: renderFeeds, users: renderUsers, audit: renderAudit, log: renderLog };
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
