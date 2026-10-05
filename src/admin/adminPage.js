// Admin panel OKO (2026-10-03) — samostatná stránka /admin.html bez Cesia.
// Všetky údaje idú cez /api/admin/* (server pustí len rolu owner); texty sa vkladajú
// výhradne cez textContent. Oprávnenie rozhoduje server, táto stránka je len zobrazenie.

import { STATUS, barChart, barList, lineChart, number, statusStrip } from './charts.js';
import { VIEWS, autoView, createLiveMap } from './liveMap.js';

const main = document.getElementById('admin-main');
const tabs = document.getElementById('admin-tabs');
const subtabs = document.getElementById('admin-subtabs');
/** Navigácia (2026-10-04): 5 skupín namiesto 14 záložiek; hash ostáva menom záložky (#studio, #live…). */
const GROUPS = [
  { id: 'overview', label: 'Prehľad', tabs: [['overview', 'Prehľad']] },
  { id: 'visits', label: 'Návštevnosť', tabs: [['live', 'Naživo'], ['analytics', 'Analytika']] },
  { id: 'ops', label: 'Prevádzka', tabs: [['traffic', 'Požiadavky'], ['feeds', 'Feedy'], ['estimates', 'Odhady polôh'], ['errors', 'Chyby'], ['costs', 'Náklady']] },
  { id: 'content', label: 'Obsah', tabs: [['studio', 'Štúdio'], ['performance', 'Výkon príspevkov'], ['notice', 'Oznam']] },
  { id: 'system', label: 'Systém', tabs: [['users', 'Používatelia'], ['maintenance', 'Údržba'], ['audit', 'Audit'], ['log', 'Log']] },
];
const groupOf = tab => GROUPS.find(group => group.tabs.some(([id]) => id === tab)) || GROUPS[0];
const who = document.getElementById('admin-who');
let csrf = '';
/** Úklid aktívnej záložky (časovač, animácia) pri prepnutí — nastavuje ho napr. Naživo. */
let leaveTab = null;
let currentTab = '';
const lastTab = new Map();

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
  auto_publish_forbidden: 'Zábery z vojny sa nezverejňujú automaticky — vždy ich schvaľuje človek.',
  draft_not_publishable: 'Tento návrh už nejde zverejniť.',
  invalid_text: 'Text musí mať 1–2200 znakov.',
  studio_unavailable: 'Štúdio na serveri nebeží (pozri log).',
  video_not_ready: 'Reel ešte nie je hotový.',
  publish_in_progress: 'Zverejňovanie už prebieha.',
  nothing_to_publish: 'Na vybrané siete je už zverejnené.',
  invalid_schedule: 'Čas musí byť v budúcnosti, najviac 30 dní dopredu.',
  no_target: 'Vyberte aspoň jednu sieť.',
  front_week_running: 'Týždeň na fronte sa práve vyrába.',
  limits_exceeded: 'Príspevok nespĺňa limity siete:',
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
  studio_published: 'zverejnil príspevok', studio_shared: 'zdieľal ručne', studio_publish_started: 'spustil zverejnenie',
  studio_scheduled: 'naplánoval príspevok', studio_unscheduled: 'zrušil plán', studio_front_week: 'spustil Týždeň na fronte',
  alerts_settings: 'zmenil upozornenia', ignored_ips: 'zmenil vylúčené IP', alerts_test: 'poslal skúšobné upozornenie' };

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
  for (const row of rows) {
    // Na mobile sa riadok zobrazí ako karta s menom stĺpca pri hodnote (CSS ::before).
    [...row.children].forEach((cell, i) => { if (headers[i]) cell.dataset.label = headers[i]; });
    body.append(row);
  }
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
    const details = Array.isArray(data?.details) && data.details.length ? ` ${data.details.join(' ')}` : '';
    throw Object.assign(new Error(`${ERRORS[code] || `Chyba: ${code}`}${details}`), { code, status: response.status });
  }
  return data;
}

function setView(...nodes) { main.replaceChildren(...nodes); }
async function guarded(render) {
  try { await render(); }
  catch (error) { setView(notice(error.message)); }
}

// ── Prehľad ────────────────────────────────────────────────────────────────
/** Pás „čo horí": čo treba riešiť, najhoršie prvé; klik otvorí záložku, kde sa to rieši. */
const ATTENTION_LABEL = { bad: 'rieš', warn: 'pozor', info: 'info' };
function attentionStrip(data) {
  const box = el('section', 'admin-section attention');
  const head = el('div', 'attention-head');
  const worst = data.items[0]?.level;
  head.append(el('span', `attention-dot attention-dot-${worst === 'bad' ? 'bad' : worst === 'warn' ? 'warn' : 'ok'}`),
    el('h2', '', worst === 'bad' ? 'Treba riešiť' : worst === 'warn' ? 'Na pozornosť' : 'Všetko beží'),
    button(`${data.liveNow} naživo →`, () => show('live'), 'attention-live'));
  box.append(head);
  const list = el('ul', 'attention-list');
  for (const item of data.items) {
    const li = el('li', `attention-item attention-${item.level}`);
    const go = button('', () => show(item.tab), 'attention-go');
    go.append(el('span', 'attention-tag', ATTENTION_LABEL[item.level]), el('span', 'attention-text', item.text), el('span', 'attention-arrow', '→'));
    li.append(go);
    list.append(li);
  }
  if (!data.items.length) list.append(el('li', 'attention-calm', 'Zdroje odpovedajú, bez chýb 5xx, stropy v norme, Štúdio nič nečaká.'));
  box.append(list);
  return box;
}

async function renderOverview() {
  const [{ stats, server }, live, traffic24, chart, attention] = await Promise.all([api('/api/admin/overview'),
    api('/api/admin/analytics?days=1').catch(() => null), api('/api/admin/traffic?hours=24').catch(() => null),
    api('/api/admin/accounts-chart?days=30').catch(() => null), api('/api/admin/attention').catch(() => null)]);
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
  if (attention) nodes.push(attentionStrip(attention));
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
      add('práve na stránke', live.liveNow, 'mapa v záložke Naživo');
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
/**
 * Odhady polôh bez signálu (2026-10-05, src/data/flightEstimate.js): ako presne OKO odhaduje lietadlá
 * mimo pokrytia. Meria sa pri návrate signálu — chyba odhadu (trate NAT + vietor GFS) a pre porovnanie
 * jednoduchého odhadu (najkratšia trasa, posledná rýchlosť). Verejné súhrnné API, žiadne osobné údaje.
 */
async function renderEstimates(days = 7) {
  setView(el('p', 'admin-muted', 'Načítavam presnosť odhadov…'));
  const data = await api(`/api/flights/estimated/accuracy?days=${days}`);
  const km = (v) => (Number.isFinite(v) ? `${number(Math.round(v))} km` : '—');
  const label = (b) => (Number.isFinite(b.maxMin) ? `${b.minMin}–${b.maxMin} min` : `nad ${b.minMin / 60} h`);
  const rows = data.buckets.map((b) => {
    const gain = Number.isFinite(b.medianKm) && Number.isFinite(b.baselineMedianKm) && b.baselineMedianKm > 0
      ? Math.round((1 - b.medianKm / b.baselineMedianKm) * 100) : null;
    const methods = ['nat', 'route', 'track'].map((m) => (b.byMethod[m].n ? `${{ nat: 'trať NAT', route: 'k cieľu', track: 'v smere' }[m]} ${b.byMethod[m].n}× ${km(b.byMethod[m].medianKm)}` : '')).filter(Boolean).join(' · ');
    return row([label(b), number(b.n), km(b.medianKm), km(b.p80Km), km(b.baselineMedianKm),
      gain == null ? '—' : badge(`${gain > 0 ? '−' : '+'}${Math.abs(gain)} %`, gain > 0 ? 'ok' : 'warn'), methods || '—']);
  });
  const est = data.estimator || {};
  const natText = data.nat?.tracks?.length
    ? data.nat.tracks.map((t) => `${t.id}${t.dir === 'east' ? '→' : t.dir === 'west' ? '←' : ''}`).join(' ')
    : 'žiadne (odhad ide po najkratšej trase)';
  const daysSelect = el('select', 'admin-input');
  for (const d of [1, 7, 30]) {
    const opt = el('option', '', `${d} ${d === 1 ? 'deň' : 'dní'}`);
    opt.value = String(d);
    if (d === days) opt.selected = true;
    daysSelect.append(opt);
  }
  daysSelect.addEventListener('change', () => guarded(() => renderEstimates(Number(daysSelect.value))));
  setView(section('Odhady polôh bez signálu',
    el('p', 'admin-muted', 'Lietadlo, ktoré stratí signál vo vzduchu, letí na mape ďalej ako odhad. Keď sa signál vráti, server porovná odhad so skutočnou polohou. „Jednoduchý odhad" = najkratšia trasa a posledná rýchlosť (bez tratí NAT a vetra) — stĺpec Zlepšenie ukazuje, o koľko je dnešný odhad presnejší. 80 % = v 80 % prípadov bola chyba menšia; podľa toho sa kreslí kruh neistoty.'),
    el('p', '', `Teraz odhadovaných: ${number(est.estimated ?? 0)} · čaká na cieľ: ${number(est.queue ?? 0)} · meraní za obdobie: ${number(data.samples)} · trate NAT: ${natText} · vietor GFS: ${(data.wind?.grids || []).length ? data.wind.grids.map((g) => g.split('|')[0].replace('wind', '')).join(', ') + ' hPa' : 'nenačítaný'}`),
    daysSelect,
    table(['Bez signálu', 'Meraní', 'Chyba (medián)', 'Chyba (80 %)', 'Jednoduchý odhad', 'Zlepšenie', 'Podľa spôsobu'], rows),
    button('Obnoviť', () => guarded(() => renderEstimates(days)), 'admin-btn')));
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
const studioState = { filter: 'open', poll: null };
async function renderStudio(message) {
  const [data, calendarData, frontWeekData] = await Promise.all([api('/api/admin/studio'), api('/api/admin/studio/calendar').catch(() => ({ items: [] })),
    api('/api/admin/studio/front-week').catch(() => null)]);
  data.calendar = calendarData.items;
  data.frontWeek = frontWeekData;
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
  // Reels (Fáza 2)
  const caps = data.capabilities || {};
  const reelBox = el('div', 'admin-studio-reel-settings');
  const autoReel = el('label', 'admin-check');
  const autoReelBox = el('input'); autoReelBox.type = 'checkbox'; autoReelBox.checked = data.settings.autoReel; autoReelBox.disabled = !caps.ffmpeg;
  autoReelBox.addEventListener('change', () => saveStudioSettings({ autoReel: autoReelBox.checked }));
  autoReel.append(autoReelBox, document.createTextNode(' Ku každému návrhu vyrobiť aj reel 9:16 (video ~12 s, zadarmo na vašom serveri)'));
  const audio = el('select');
  for (const [value, label, enabled] of [['ambient', 'Jemný zvukový podklad (generovaný, bez licencie)', true],
    ['music', `Hudba z vlastného priečinka (${caps.music || 0} skladieb)`, caps.music > 0], ['none', 'Bez zvuku', true]]) {
    const option = el('option', '', label); option.value = value; option.disabled = !enabled; if (data.settings.audio === value) option.selected = true; audio.append(option);
  }
  audio.addEventListener('change', () => saveStudioSettings({ audio: audio.value }));
  const audioLabel = el('label', 'admin-check', 'Zvuk reelu '); audioLabel.append(audio);
  const voice = el('label', 'admin-check');
  const voiceBox = el('input'); voiceBox.type = 'checkbox'; voiceBox.checked = data.settings.voice; voiceBox.disabled = !caps.voice;
  voiceBox.addEventListener('change', () => saveStudioSettings({ voice: voiceBox.checked }));
  voice.append(voiceBox, document.createTextNode(caps.voice ? ' Slovenský hlasový komentár (Piper)' : ' Slovenský hlas — nastavte PIPER_PATH a PIPER_MODEL v .env'));
  voice.replaceChildren(voiceBox, document.createTextNode(caps.ownerVoice ? ' Hlasový komentár vaším hlasom (ai-translators)'
    : caps.voice ? ' Slovenský hlasový komentár (Piper)' : ' Hlasový komentár — nastavte AI_TRANSLATORS_MCP_KEY (váš hlas) alebo PIPER_PATH v .env'));
  reelBox.append(autoReel, audioLabel, voice);
  if (!caps.ffmpeg) reelBox.append(notice('Reels potrebujú ffmpeg na serveri (zadarmo): na Windows „winget install ffmpeg", alebo cesta vo FFMPEG_PATH v .env. Potom reštartujte server.', 'info'));
  auto.append(reelBox);
  const rows = data.templates.map(template => {
    const box = el('input'); box.type = 'checkbox'; box.checked = template.autoPublish;
    const earned = template.unchanged >= data.autoPublishMin;
    const allowed = template.autoPublishAllowed !== false;
    box.disabled = !allowed || !earned || !connected;
    box.addEventListener('change', () => saveStudioSettings({ autoPublish: { [template.id]: box.checked } }));
    const label = el('label', 'admin-check'); label.append(box, document.createTextNode(' zverejniť automaticky'));
    const progress = !allowed ? el('span', 'admin-muted', 'vždy schvaľuje človek')
      : earned ? badge('odomknuté', 'ok') : el('span', 'admin-muted', `${template.unchanged} / ${data.autoPublishMin} zverejnení bez úpravy`);
    const when_ = template.auto === 'daily' ? 'denne o 8:00' : template.auto === 'weekly' ? 'v sobotu o 9:00' : template.auto ? 'pri udalosti' : 'ručne';
    return row([template.label, when_, progress, label]);
  });
  auto.append(table(['Šablóna', 'Návrhy', 'Podmienka automatiky', ''], rows),
    el('p', 'admin-muted', `Automatické zverejnenie sa pre šablónu odomkne po ${data.autoPublishMin} príspevkoch, ktoré ste zverejnili bez úpravy textu. Poistky: max ${data.settings.autoPublishPerDay} automatických príspevkov za 24 h, tichý čas ${data.settings.quietFrom}:00–${data.settings.quietTo}:00, zastarané dáta sa nezverejnia.`));

  // Ukrajina (2026-10-04): prah vzdušného útoku, fotky a videá oficiálnych kanálov.
  const ua = data.settings.ua || {};
  const uaBox = el('div');
  const airInput = el('input'); airInput.type = 'number'; airInput.min = '2'; airInput.max = '25'; airInput.value = String(ua.airMinOblasts ?? 8); airInput.className = 'admin-input-sm';
  airInput.addEventListener('change', () => saveStudioSettings({ ua: { airMinOblasts: Number(airInput.value) } }));
  const airLabel = el('label', 'admin-check', 'Veľký vzdušný útok = hrozba pre aspoň '); airLabel.append(airInput, document.createTextNode(' oblastí za 3 hodiny'));
  const mediaLabel = el('label', 'admin-check');
  const mediaBox = el('input'); mediaBox.type = 'checkbox'; mediaBox.checked = ua.media !== false;
  mediaBox.addEventListener('change', () => saveStudioSettings({ ua: { media: mediaBox.checked } }));
  mediaLabel.append(mediaBox, document.createTextNode(' Návrhy z fotiek a videí oficiálnych kanálov UA (Generálny štáb, Ministerstvo obrany, DSNS, ArmyInform)'));
  const perDay = el('input'); perDay.type = 'number'; perDay.min = '0'; perDay.max = '30'; perDay.value = String(ua.mediaPerDay ?? 6); perDay.className = 'admin-input-sm';
  perDay.addEventListener('change', () => saveStudioSettings({ ua: { mediaPerDay: Number(perDay.value) } }));
  const perDayLabel = el('label', 'admin-check', 'Najviac '); perDayLabel.append(perDay, document.createTextNode(' návrhov zo záberov za deň'));
  uaBox.append(airLabel, mediaLabel, perDayLabel,
    el('p', 'admin-muted', 'Zábery z vojny idú vždy len ako návrh — pred schválením skontrolujte, že na nich nie sú obete ani rozpoznateľné osoby. Videá z YouTube sa nepreberajú (podmienky YouTube to nedovoľujú).'));

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
  for (const draft of shown) grid.append(studioCard(draft, meta, data.bestTimes, data.limits));
  if (!shown.length) grid.append(el('p', 'admin-muted', 'Žiadne návrhy. Vytvorte ich tlačidlami vyššie, alebo počkajte na automatiku.'));

  // Týždeň na fronte (video z scripts/make-front-week-video.mjs → návrh v Štúdiu)
  const fw = data.frontWeek || { status: {}, settings: data.settings.frontWeek };
  const fwBox = el('div');
  const fwAuto = el('label', 'admin-check');
  const fwBoxInput = el('input'); fwBoxInput.type = 'checkbox'; fwBoxInput.checked = Boolean(fw.settings?.enabled); fwBoxInput.disabled = !caps.frontWeek;
  fwBoxInput.addEventListener('change', () => saveStudioSettings({ frontWeek: { enabled: fwBoxInput.checked } }));
  const dayNames = ['nedeľu', 'pondelok', 'utorok', 'stredu', 'štvrtok', 'piatok', 'sobotu'];
  fwAuto.append(fwBoxInput, document.createTextNode(` Každú ${dayNames[fw.settings?.weekday ?? 6]} o ${fw.settings?.hour ?? 7}:00 vyrobiť video „Týždeň na fronte" a dať ho sem ako návrh`));
  const fwActions = el('div', 'admin-actions');
  const fwStatus = fw.status || {};
  fwActions.append(button(fwStatus.running ? 'Vyrába sa…' : 'Vyrobiť Týždeň na fronte teraz', async event => {
    event.target.disabled = true;
    try { await api('/api/admin/studio/front-week', { method: 'POST', body: {} }); await renderStudio(notice('Video sa vyrába na pozadí (10–60 min). Stav sa obnoví sám.', 'ok')); }
    catch (error) { await renderStudio(notice(error.message)); }
  }, 'admin-btn admin-btn-sm'));
  if (fwStatus.running) fwActions.append(el('span', 'admin-muted', `beží od ${when(fwStatus.startedAt)}`));
  else if (fwStatus.error) fwActions.append(badge(`posledný beh zlyhal: ${fwStatus.error}`, 'bad'));
  else if (fwStatus.finishedAt) fwActions.append(el('span', 'admin-muted', `posledný beh ${when(fwStatus.finishedAt)}`));
  fwBox.append(fwAuto, fwActions, el('p', 'admin-muted', 'Potrebuje bežiaci dev server s Cesiom (EVENT_VIDEO_PAGE_URL, inak localhost:4173), ffmpeg a hlas (ai-translators alebo nahrávky z pamäte). Výstup: video 4:5 s titulkami, text príspevku; reel 9:16 vznikne doplnením.'));
  if (fwStatus.log) { const d = el('details', 'admin-details'); d.append(el('summary', '', 'výpis posledného behu'), el('pre', '', fwStatus.log)); fwBox.append(d); }
  setView(...(message ? [message] : []),
    section('Štúdio sociálnych sietí', status, mode, create),
    section('Automatika', auto),
    section('Ukrajina', uaBox),
    section('Týždeň na fronte', fwBox),
    section('Kalendár (7 dní dozadu, 14 dopredu)', studioCalendar(data.calendar || [])),
    section('Príspevky', filters, grid));
  // Kým sa renderuje video alebo zverejňuje, obnovovať každých 5 s (nie počas písania textu).
  clearTimeout(studioState.poll);
  const busy = data.drafts.some(d => ['queued', 'rendering'].includes(d.videoStatus) || Object.values(d.results || {}).some(r => r.pending)) || Boolean(data.frontWeek?.status?.running);
  if (busy) {
    studioState.poll = setTimeout(() => {
      if (location.hash !== '#studio' || document.activeElement?.tagName === 'TEXTAREA') return;
      void guarded(() => renderStudio());
    }, 5000);
  }
}

function studioCalendar(items) {
  if (!items.length) return el('p', 'admin-muted', 'Nič naplánované ani zverejnené.');
  const byDay = new Map();
  for (const item of items) {
    const d = new Date(item.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    (byDay.get(key) || byDay.set(key, []).get(key)).push(item);
  }
  const wrap = el('div', 'admin-calendar');
  const dayFmt = new Intl.DateTimeFormat('sk-SK', { weekday: 'short', day: 'numeric', month: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('sk-SK', { hour: '2-digit', minute: '2-digit' });
  for (const [key, list] of [...byDay].sort()) {
    const day = el('div', 'admin-calendar-day');
    const isToday = key === new Date().toISOString().slice(0, 10) || new Date(list[0].at).toDateString() === new Date().toDateString();
    day.append(el('h4', isToday ? 'today' : '', dayFmt.format(new Date(list[0].at))));
    for (const item of list) {
      const row = el('div', `admin-calendar-item ${item.kind}`);
      const short = (item.targets || []).map(t => ({ facebook: 'FB', instagram: 'IG', 'facebook-reel': 'FB reel', 'instagram-reel': 'IG reel' }[t] || t)).join(', ');
      row.append(el('span', 'admin-calendar-time', timeFmt.format(new Date(item.at))), el('span', '', item.title),
        el('span', 'admin-muted', ` ${item.kind === 'scheduled' ? 'naplánované' : 'zverejnené'}${short ? ` · ${short}` : ''}`));
      day.append(row);
    }
    wrap.append(day);
  }
  return wrap;
}

// ── Výkon príspevkov (Meta Insights) ──────────────────────────────────────
async function renderPerformance(message) {
  const data = await api('/api/admin/studio/insights');
  const connected = data.meta.facebook || data.meta.instagram;
  const refresh = button('Obnoviť štatistiky z Mety', async event => {
    event.target.disabled = true;
    try { const r = await api('/api/admin/studio/insights/refresh', { method: 'POST', body: {} }); await renderPerformance(notice(r.skipped ? `Preskočené: ${r.skipped}` : `Načítané ${r.fetched}, zlyhalo ${r.failed}.`, r.failed ? 'error' : 'ok')); }
    catch (error) { await renderPerformance(notice(error.message)); }
  }, 'admin-btn');
  const names = { facebook: 'Facebook', instagram: 'Instagram', 'facebook-reel': 'FB reel', 'instagram-reel': 'IG reel' };
  const rows = [];
  const totals = { views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saved: 0 };
  for (const post of data.posts) {
    for (const [target, m] of Object.entries(post.targets)) {
      for (const key of Object.keys(totals)) totals[key] += m[key] || 0;
      const link = m.url ? (() => { const a = el('a', '', post.title); a.href = m.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; })() : post.title;
      const fmt = v => (v === null || v === undefined ? '—' : number(v));
      rows.push(row([link, names[target] || target, when(post.publishedAt), fmt(m.views), fmt(m.reach), fmt(m.likes), fmt(m.comments), fmt(m.shares), fmt(m.saved), m.fetchedAt ? when(m.fetchedAt) : 'ešte nie']));
    }
  }
  const tiles = el('div', 'admin-tiles');
  for (const [label, value] of [['zobrazenia', totals.views], ['dosah', totals.reach], ['reakcie', totals.likes], ['komentáre', totals.comments], ['zdieľania', totals.shares], ['uloženia', totals.saved]]) {
    const t = el('div', 'admin-tile'); t.append(el('span', 'admin-tile-value', number(value)), el('span', 'admin-tile-label', `${label} · 30 d`)); tiles.append(t);
  }
  setView(...(message ? [message] : []),
    section('Výkon príspevkov', connected ? tiles : notice('Facebook/Instagram nie je pripojený — štatistiky dosahu sa dajú čítať až cez Meta API (META_* v .env).', 'info'),
      el('p', 'admin-muted', 'Údaje z Meta Insights pre príspevky zverejnené cez Štúdio za posledných 30 dní; obnovujú sa automaticky každých 6 h. Ručne zdieľané príspevky Meta API nevidí.'),
      rows.length ? table(['Príspevok', 'Sieť', 'Zverejnené', 'Zobrazenia', 'Dosah', 'Reakcie', 'Komentáre', 'Zdieľania', 'Uloženia', 'Stav k'], rows) : el('p', 'admin-muted', 'Zatiaľ žiadne zverejnené príspevky cez Meta API.'),
      refresh));
}

async function saveStudioSettings(patch) {
  try { await api('/api/admin/studio/settings', { method: 'POST', body: patch }); await renderStudio(notice('Nastavenie uložené.', 'ok')); }
  catch (error) { await renderStudio(notice(error.message)); }
}

const WEEKDAY_SHORT = ['ne', 'po', 'ut', 'st', 'št', 'pi', 'so'];
const CHECK_TONE = { error: 'bad', warn: 'info', info: 'muted' };
const CHECK_TARGET = { instagram: 'IG', facebook: 'FB', all: '' };

/** Náhľad v tvare príspevku: hlavička stránky, prvé riadky textu pred „viac", obrázok s orezom 4:5, počet snímok. */
function studioPreview(draft, text, limits) {
  const box = el('div', 'admin-preview');
  const head = el('div', 'admin-preview-head');
  head.append(el('span', 'admin-preview-avatar', 'OKO'), el('span', 'admin-preview-name', 'OKO · okolive.sk'), el('span', 'admin-muted', 'práve teraz'));
  const body = el('p', 'admin-preview-text');
  const fold = limits?.captionFold || 125;
  const update = () => {
    const value = text.value;
    const chars = [...value];
    body.replaceChildren(document.createTextNode(chars.slice(0, fold).join('')));
    if (chars.length > fold) body.append(el('span', 'admin-muted', '… viac'));
    counter.textContent = `${chars.length} / ${limits?.text || 2200} znakov · ${(value.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length} / ${limits?.hashtags || 30} hashtagov`;
    counter.className = chars.length > (limits?.text || 2200) ? 'admin-preview-count bad' : 'admin-preview-count';
  };
  const counter = el('span', 'admin-preview-count');
  const pic = el('div', 'admin-preview-pic');
  const img = el('img'); img.src = `/api/admin/studio/drafts/${draft.id}/image?v=${draft.updatedAt}`; img.alt = ''; img.loading = 'lazy';
  pic.append(img);
  if (draft.slides > 1) pic.append(el('span', 'admin-preview-slides', `1 / ${draft.slides}`));
  text.addEventListener('input', update);
  update();
  box.append(head, body, pic, counter);
  return box;
}

function studioCard(draft, meta, bestTimes = null, limits = null) {
  const card = el('article', 'admin-studio-card');
  const media = el('div', 'admin-studio-media');
  const img = el('img');
  img.src = `/api/admin/studio/drafts/${draft.id}/image?v=${draft.updatedAt}`;
  img.alt = draft.title; img.loading = 'lazy'; img.width = 270; img.height = 338;
  media.append(img);
  // Karusel: miniatúry ďalších snímok (klik = zobraziť vo veľkom).
  if (draft.slides > 1) {
    const strip = el('div', 'admin-studio-slides');
    strip.setAttribute('aria-label', `Karusel: ${draft.slides} snímok`);
    for (let i = 0; i < Math.min(draft.slides, 10); i++) {
      const thumb = el('img');
      thumb.src = `/api/admin/studio/drafts/${draft.id}/image?i=${i}&v=${draft.updatedAt}`;
      thumb.alt = `snímka ${i + 1}`; thumb.width = 48; thumb.height = 60;
      thumb.addEventListener('click', () => { img.src = thumb.src; });
      strip.append(thumb);
    }
    media.append(strip);
  }
  const videoReady = draft.videoStatus === 'ready';
  if (videoReady) {
    const video = el('video');
    video.src = `/api/admin/studio/drafts/${draft.id}/video?v=${draft.updatedAt}`;
    video.controls = true; video.preload = 'metadata'; video.playsInline = true; video.width = 270; video.height = 480; video.poster = img.src;
    video.setAttribute('aria-label', `Reel: ${draft.title}`);
    media.append(video);
  } else if (['queued', 'rendering'].includes(draft.videoStatus)) {
    media.append(el('p', 'admin-studio-video-state', draft.videoStatus === 'rendering' ? 'Reel sa renderuje…' : 'Reel čaká vo fronte…'));
  } else if (draft.videoStatus === 'failed') {
    media.append(el('p', 'admin-studio-video-state admin-studio-video-failed', `Reel zlyhal: ${draft.videoError || 'neznáma chyba'}`));
  }
  const body = el('div', 'admin-studio-body');
  const head = el('div', 'admin-badges');
  const [statusText, tone] = STUDIO_STATUS[draft.status] || [draft.status, 'muted'];
  head.append(badge(statusText, tone), badge(draft.origin === 'auto' ? 'automaticky' : 'ručne', 'muted'));
  if (draft.edited) head.append(badge('upravené', 'muted'));
  if (draft.scheduledAt) head.append(badge(`naplánované ${when(draft.scheduledAt)}`, 'info'));
  if (draft.template === 'event') head.append(badge('z Udalostí', 'muted'));
  if (draft.template === 'front-week') head.append(badge('Týždeň na fronte', 'muted'));
  if (draft.slides > 1) head.append(badge(`karusel · ${draft.slides} ${draft.slides < 5 ? 'snímky' : 'snímok'}`, 'info'));
  if (draft.retryAt) head.append(badge(`ďalší pokus ${when(draft.retryAt)} (${draft.retryN}/3)`, 'info'));
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
  }
  // Zverejnenie: fotka a reel samostatne (dá sa aj postupne, aj po zverejnení fotky).
  if (draft.status !== 'discarded') {
    const publishButton = (label, targets) => act(label, async () => {
      if (editable && text.value !== draft.text) await api(`/api/admin/studio/drafts/${draft.id}`, { method: 'POST', body: { text: text.value } });
      if (!confirm(`Zverejniť „${draft.title}" — ${label.toLowerCase()}?`)) return '';
      await api(`/api/admin/studio/drafts/${draft.id}/publish`, { method: 'POST', body: { targets } });
      return 'Zverejňuje sa na pozadí — stav sa obnoví sám (reel môže trvať niekoľko minút).';
    }, 'admin-btn admin-btn-sm admin-btn-go');
    const photoTargets = ['facebook', 'instagram'].filter(t => meta[t] && !draft.results?.[t]?.id);
    const reelTargets = ['facebook-reel', 'instagram-reel'].filter(t => meta[t.replace('-reel', '')] && !draft.results?.[t]?.id);
    const short = list => list.map(t => (t.startsWith('facebook') ? 'FB' : 'IG')).join(' + ');
    if (photoTargets.length && (editable || draft.status === 'published')) actions.append(publishButton(`Zverejniť fotku (${short(photoTargets)})`, photoTargets));
    if (reelTargets.length && videoReady) actions.append(publishButton(`Zverejniť reel (${short(reelTargets)})`, reelTargets));
    // Naplánovať: dátum a čas (miestny), ciele = všetko ešte nezverejnené, čo je pripojené.
    const scheduleTargets = [...photoTargets, ...reelTargets];
    if (scheduleTargets.length) {
      const form = el('form', 'admin-schedule');
      const input = el('input'); input.type = 'datetime-local'; input.required = true; input.setAttribute('aria-label', 'Čas zverejnenia');
      const pad = n => String(n).padStart(2, '0');
      const toLocal = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
      input.value = toLocal(draft.scheduledAt || Date.now() + 3600e3);
      input.min = toLocal(Date.now()); input.max = toLocal(Date.now() + 30 * 86400e3);
      const submit = el('button', 'admin-btn admin-btn-sm', draft.scheduledAt ? 'Preplánovať' : `Naplánovať (${short(scheduleTargets)})`);
      form.append(input, submit);
      // Najlepší čas z Výkonu (po aspoň 5 príspevkoch so štatistikami).
      if (bestTimes?.enough && bestTimes.suggestion) {
        const best = bestTimes.slots[0];
        const pick = el('button', 'admin-btn admin-btn-sm', `Dobrý čas: ${WEEKDAY_SHORT[best.weekday]} ${best.hour}:00`);
        pick.type = 'button';
        pick.title = `Najvyšší priemerný dosah (${best.score}) z ${bestTimes.posts} príspevkov; najbližší termín ${when(bestTimes.suggestion)}.`;
        pick.addEventListener('click', () => { input.value = toLocal(bestTimes.suggestion); input.focus(); });
        form.append(pick);
      }
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const at = new Date(input.value).getTime();
        if (!Number.isFinite(at)) return;
        try {
          if (editable && text.value !== draft.text) await api(`/api/admin/studio/drafts/${draft.id}`, { method: 'POST', body: { text: text.value } });
          await api(`/api/admin/studio/drafts/${draft.id}/schedule`, { method: 'POST', body: { at, targets: scheduleTargets } });
          await renderStudio(notice(`Naplánované na ${when(at)}.`, 'ok'));
        } catch (error) { await renderStudio(notice(error.message)); }
      });
      actions.append(form);
      if (draft.scheduledAt) actions.append(act('Zrušiť plán', async () => { await api(`/api/admin/studio/drafts/${draft.id}/schedule`, { method: 'POST', body: { at: null } }); return 'Plán zrušený.'; }, 'admin-btn admin-btn-sm admin-btn-warn'));
    }
  }
  const download = el('a', 'admin-btn admin-btn-sm', 'Stiahnuť obrázok');
  download.href = `/api/admin/studio/drafts/${draft.id}/image`; download.download = `oko-${draft.id.slice(0, 8)}.jpg`;
  actions.append(download);
  if (draft.card?.kind === 'import' && draft.card.sourceVideo) {
    const src = el('a', 'admin-btn admin-btn-sm', 'Stiahnuť video 4:5');
    src.href = `/api/admin/studio/drafts/${draft.id}/source`; src.download = `oko-video-${draft.id.slice(0, 8)}.mp4`;
    actions.append(src);
  }
  if (videoReady) {
    const downloadVideo = el('a', 'admin-btn admin-btn-sm', 'Stiahnuť reel');
    downloadVideo.href = `/api/admin/studio/drafts/${draft.id}/video`; downloadVideo.download = `oko-reel-${draft.id.slice(0, 8)}.mp4`;
    actions.append(downloadVideo);
  }
  if (draft.status !== 'discarded' && !['queued', 'rendering'].includes(draft.videoStatus)) {
    actions.append(act(videoReady ? 'Prerobiť reel' : draft.videoStatus === 'failed' ? 'Skúsiť reel znova' : 'Vyrobiť reel', async () => {
      await api(`/api/admin/studio/drafts/${draft.id}/render`, { method: 'POST', body: {} });
      return 'Reel je vo fronte — hotový bude o necelú minútu.';
    }));
  }
  actions.append(button('Kopírovať text', async event => {
    try { await navigator.clipboard.writeText(text.value); event.target.textContent = 'Skopírované'; }
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
    const name = { facebook: 'Facebook', instagram: 'Instagram', 'facebook-reel': 'Facebook reel', 'instagram-reel': 'Instagram reel', manual: 'Ručne' }[target] || target;
    if (target === 'scheduled') { line.append(badge('plán: chyba', 'bad'), document.createTextNode(` ${result.error}`)); results.append(line); continue; }
    if (result.pending) line.append(badge(`${name}: zverejňuje sa…`, 'info'));
    else if (result.error) line.append(badge(`${name}: chyba`, 'bad'), document.createTextNode(` ${result.error}`));
    else if (result.url) { const a = el('a', '', `${name}: otvoriť príspevok`); a.href = result.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; line.append(a); }
    else line.append(document.createTextNode(`${name}: ${when(result.at)}`));
    results.append(line);
  }
  const checks = el('ul', 'admin-studio-checks');
  for (const check of draft.checks || []) {
    const item = el('li');
    item.append(badge(`${CHECK_TARGET[check.target] ? `${CHECK_TARGET[check.target]} · ` : ''}${check.level === 'error' ? 'nepôjde' : check.level === 'warn' ? 'pozor' : 'tip'}`, CHECK_TONE[check.level] || 'muted'),
      document.createTextNode(` ${check.text}`));
    checks.append(item);
  }
  const preview = el('details', 'admin-details admin-studio-preview');
  preview.append(el('summary', '', 'Náhľad príspevku (ako ho uvidia na FB/IG)'), studioPreview(draft, text, limits));
  // Háčik (2026-10-04): prvé 3 sekundy reelu — čo divák uvidí ako prvé (väčšina pozerá bez zvuku).
  const hook = [];
  if (videoReady) {
    const figure = el('figure', 'admin-studio-hook');
    const strip = el('img');
    strip.src = `/api/admin/studio/drafts/${draft.id}/hook?v=${draft.updatedAt}`;
    strip.alt = `Prvé 3 sekundy reelu: ${draft.title}`; strip.loading = 'lazy';
    strip.addEventListener('error', () => figure.remove()); // importované reely pás nemajú
    figure.append(el('figcaption', 'admin-muted', 'Prvé 3 sekundy reelu (0 · 1 · 2 · 3 s) — upúta háčik aj bez zvuku?'), strip);
    hook.push(figure);
  }
  body.append(head, el('h3', '', draft.title), el('p', 'admin-muted', `vytvorené ${when(draft.createdAt)}${draft.publishedAt ? ` · zverejnené ${when(draft.publishedAt)}` : ''}${draft.videoSeconds ? ` · reel ${String(draft.videoSeconds).replace('.', ',')} s` : ''}`),
    ...hook, text, ...(draft.checks?.length ? [checks] : []), preview, actions, results);
  card.append(media, body);
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
  // Zmena oproti predchádzajúcemu obdobiu rovnakej dĺžky (zelená hore, červená dole).
  const delta = key => {
    const now = data.totals[key]; const before = data.previous?.[key] ?? 0;
    if (!before) return now ? { text: 'nové oproti predtým', tone: 'up' } : null;
    const change = Math.round(((now - before) / before) * 100);
    return { text: `${change > 0 ? '+' : ''}${change} % oproti predtým`, tone: change > 0 ? 'up' : change < 0 ? 'down' : '' };
  };
  const withDelta = (label, value, hint, key) => {
    tile(label, value, hint);
    const d = delta(key);
    if (d) tiles.lastChild.append(el('span', `admin-delta admin-delta-${d.tone || 'flat'}`, d.text));
  };
  tile('práve na stránke', data.liveNow, 'aktívni za 2,5 min');
  tile('návštevníci dnes', today.visitors, `${today.views} zobrazení`);
  withDelta(`návštevníci · ${data.days} d`, number(data.totals.visitors), 'súčet denných unikátov', 'visitors');
  withDelta(`zobrazenia · ${data.days} d`, number(data.totals.views), data.totals.visitors ? `${(data.totals.views / data.totals.visitors).toFixed(1)} na návštevníka` : '', 'views');
  withDelta('aktívny čas', `${number(Math.round(data.totals.minutes / 60))} h`, data.totals.views ? `${(data.totals.minutes / data.totals.views).toFixed(1)} min na zobrazenie` : '', 'minutes');
  tile('boti', number(data.totals.bots), 'nezapočítaní');
  const trend = el('div');
  const picker = rangePicker(analyticsState, [[7, '7 dní'], [30, '30 dní'], [90, '90 dní'], [365, 'rok']], () => guarded(renderAnalytics));
  setView(section('Návštevnosť', picker, tiles), section('Vývoj', trend));
  const dayIndex = new Map(data.series.map((d, i) => [d.day, i]));
  const events = (data.published || []).flatMap(p => p.titles.map(title => ({ index: dayIndex.get(p.day), text: `zverejnené: ${title}` })));
  lineChart(trend, { labels: data.series.map(d => shortDay(d.day)), events,
    series: [{ name: 'Návštevníci', values: data.series.map(d => d.visitors) }, { name: 'Zobrazenia', values: data.series.map(d => d.views) }] });
  if (events.length) trend.append(el('p', 'admin-muted', '▼ žltá značka = deň, keď vyšiel príspevok zo Štúdia (názov v bubline).'));
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
    el('p', 'admin-muted', 'Štatistika je bez cookie: návštevník = hash s dennou soľou, ktorý po polnoci zanikne (ostane len počet). Jednotlivé návštevy s IP sú v záložke Naživo → Záznam návštev (30 dní). Do Not Track / GPC sa rešpektuje.'));
}

const percent = (part, whole) => { const p = (part / whole) * 100; return p > 0 && p < 0.1 ? '< 0,1 %' : `${p.toFixed(1).replace('.', ',')} %`; };

// ── Prevádzka (požiadavky na API) ──────────────────────────────────────────
const trafficState = { days: 2 };
async function renderTraffic() {
  const hours = trafficState.days * 24;
  const [data, health] = await Promise.all([api(`/api/admin/traffic?hours=${hours}`), api('/api/admin/health').catch(() => null)]);
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
  if (health) main.prepend(...healthSections(health));
}

/** Externé zdroje (spoločný register servera) a zdravie kariet lietadiel z prehliadačov — 2026-10-05. */
function healthSections(health) {
  const hhmm = at => new Date(at).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
  const sourceRows = health.upstream.map(u => row([
    u.name,
    u.pausedUntil ? badge(`zablokovaný do ${hhmm(u.pausedUntil)}`, 'bad') : badge('odpovedá', 'ok'),
    number(u.lastHour.n), u.lastHour.limited ? badge(String(u.lastHour.limited), 'bad') : '0',
    number(u.last24h.n), u.last24h.limited ? badge(String(u.last24h.limited), 'bad') : '0', number(u.last24h.errors),
    u.lastLimitedAt ? when(u.lastLimitedAt) : '—',
  ]));
  const sources = section('Externé zdroje',
    sourceRows.length ? table(['Zdroj', 'Stav', 'Dopyty · 1 h', '429 · 1 h', 'Dopyty · 24 h', '429 · 24 h', 'Chyby · 24 h', 'Posledné obmedzenie'], sourceRows)
      : el('p', 'admin-muted', 'Od štartu servera zatiaľ žiadne volanie.'),
    el('p', 'admin-muted', 'Bezplatné zdroje (adsbdb, adsb.lol, Nominatim) nás pri priveľa dopytoch na pár minút zablokujú (429). Počty sú od štartu servera; po vydaní začínajú od nuly.'));
  const total = health.cards.reduce((a, c) => ({ n: a.n + c.n, route: a.route + c.route, type: a.type + c.type, airline: a.airline + c.airline }), { n: 0, route: 0, type: 0, airline: 0 });
  const share = part => (total.n ? `${Math.round((part / total.n) * 100)} %` : '—');
  const facts = el('div', 'admin-facts');
  facts.append(el('span', '', `${number(total.n)} kontrol za 24 h`), el('span', 'admin-muted', `s trasou a ETA ${share(total.route)}`),
    el('span', 'admin-muted', `s typom ${share(total.type)}`), el('span', 'admin-muted', `s dopravcom ${share(total.airline)}`));
  const cards = section('Karty lietadiel', facts);
  if (total.n) {
    const chart = el('div');
    cards.append(chart);
    barChart(chart, { labels: health.cards.map(c => `${new Date(c.at).getHours()}:00`), values: health.cards.map(c => (c.n ? Math.round((c.route / c.n) * 100) : 0)),
      name: 'Karty s trasou a ETA (%)', format: v => `${Math.round(v)} %`, notes: health.cards.map(c => (c.n ? `${c.route} z ${c.n} kontrol` : 'bez kontrol')) });
  }
  cards.append(el('p', 'admin-muted', 'Prehliadač po 45 s sledovania dopravného lietadla nahlási, či karta má trasu, typ a dopravcu (len áno/nie). Časť letov trasu nemá ani normálne (chartre, presuny); pod 30 % za 2 h sa to ukáže v Prehľade.'));
  return [sources, cards];
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
    errors.length ? table(['Druh', 'Správa', 'Počet', 'Naposledy', 'Prvýkrát'], rows) : el('p', 'admin-muted', 'Žiadne chyby.'), clear));
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
function alertsSection(alerts) {
  if (!alerts) return section('Upozornenia', el('p', 'admin-muted', 'Upozornenia na serveri nebežia.'));
  const { status, history } = alerts;
  const form = el('form', 'admin-alerts-form');
  const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = status.enabled;
  const enabledLabel = el('label', 'admin-check'); enabledLabel.append(enabled, document.createTextNode(' Posielať upozornenia e-mailom'));
  const email = el('input'); email.type = 'email'; email.value = status.email || ''; email.placeholder = 'vas@email.sk'; email.setAttribute('aria-label', 'E-mail pre upozornenia');
  const minutes = el('input'); minutes.type = 'number'; minutes.min = '20'; minutes.max = '1440'; minutes.step = '10'; minutes.value = String(status.feedDownMinutes);
  minutes.setAttribute('aria-label', 'Feed nedostupný dlhšie ako (min)');
  const errors = el('input'); errors.type = 'checkbox'; errors.checked = status.errors;
  const errorsLabel = el('label', 'admin-check'); errorsLabel.append(errors, document.createTextNode(' nové chyby servera a HTTP 5xx'));
  const publish = el('input'); publish.type = 'checkbox'; publish.checked = status.publish;
  const publishLabel = el('label', 'admin-check'); publishLabel.append(publish, document.createTextNode(' zlyhané zverejnenie zo Štúdia (po 3 pokusoch)'));
  const emailLabel = el('label', 'admin-check', 'E-mail '); emailLabel.append(email);
  const minutesLabel = el('label', 'admin-check', 'Feed nedostupný dlhšie ako '); minutesLabel.append(minutes, document.createTextNode(' min'));
  const save = el('button', 'admin-btn admin-btn-sm', 'Uložiť');
  const test = button('Poslať skúšobný e-mail', async event => {
    event.target.disabled = true;
    try { const r = await api('/api/admin/alerts/test', { method: 'POST', body: {} }); await renderMaintenance(notice(r.entry?.mailed ? 'Skúšobný e-mail odoslaný.' : `Neodoslané: ${r.entry?.mailError || (r.status.mailer ? 'upozornenia sú vypnuté alebo chýba e-mail' : 'e-mail na serveri nie je nastavený (AUTH_MAIL_*)')}.`, r.entry?.mailed ? 'ok' : 'info')); }
    catch (error) { await renderMaintenance(notice(error.message)); }
  }, 'admin-btn admin-btn-sm');
  form.append(enabledLabel, emailLabel, minutesLabel, errorsLabel, publishLabel, el('div', 'admin-actions'));
  form.lastChild.append(save, test);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api('/api/admin/alerts', { method: 'POST', body: { enabled: enabled.checked, email: email.value.trim() || null, feedDownMinutes: Number(minutes.value), errors: errors.checked, publish: publish.checked } });
      await renderMaintenance(notice('Upozornenia uložené.', 'ok'));
    } catch (error) { await renderMaintenance(notice(error.message)); }
  });
  const KIND = { feed_down: 'feed', errors: 'chyby', publish_failed: 'zverejnenie', test: 'skúška' };
  const rows = history.map(item => row([when(item.at), KIND[item.kind] || item.kind, item.subject, item.mailed ? badge('e-mail', 'ok') : badge(item.mailError ? 'chyba e-mailu' : 'len v admine', 'muted')]));
  return section('Upozornenia',
    el('p', 'admin-muted', status.mailer ? 'E-maily idú cez webhook účtov (AUTH_MAIL_*). Ten istý problém najviac raz za 6 h, najviac 12 e-mailov denne.'
      : 'E-mail na serveri nie je nastavený (AUTH_MAIL_ENDPOINT, AUTH_MAIL_TOKEN, AUTH_MAIL_FROM v .env) — upozornenia sa zatiaľ len zapisujú sem.'),
    form, rows.length ? table(['Čas', 'Druh', 'Upozornenie', 'Doručenie'], rows) : el('p', 'admin-muted', 'Zatiaľ žiadne upozornenia.'));
}

async function renderMaintenance(message) {
  const [data, alerts] = await Promise.all([api('/api/admin/maintenance'), api('/api/admin/alerts').catch(() => null)]);
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
  setView(...(message ? [message] : []), alertsSection(alerts),
    section('Záloha', el('p', 'admin-muted', 'Konzistentná kópia DB účtov aj admin DB do .auth-data/backups (ponechá 14 najnovších). Zálohy obsahujú hashe hesiel — zostávajú len na serveri.'), backup, backups),
    section('Cache (.gev-cache)', data.cache.length ? table(['Priečinok', 'Veľkosť', ''], cacheRows) : el('p', 'admin-muted', 'Cache je prázdna.'),
      el('p', 'admin-muted', 'Mazať sa dá len čistá cache (obrázky, logá, Overpass, preklady, TomTom dlaždice…). Archív letov, zdieľané odkazy, terén a meteo bake sú dáta. Počítadlá rozpočtu (budget.json) sa nemažú.')));
}

// ── Naživo: mapa návštevníkov ─────────────────────────────────────────────
const DEVICES = { mobil: 'mobil', tablet: 'tablet', desktop: 'počítač' };
const liveState = { view: null, timer: 0, logTimer: 0, map: null };
const agoText = seconds => (seconds < 60 ? `pred ${seconds} s` : seconds < 3600 ? `pred ${Math.floor(seconds / 60)} min` : `pred ${Math.floor(seconds / 3600)} h`);
const placeText = v => [v.city, countryName(v.country)].filter(Boolean).join(', ');
let mapData = null;
/** Podklad mapy Naživo (Natural Earth) — samostatné chunky, načítajú sa až pri otvorení záložky. */
async function loadMapData() {
  if (!mapData) {
    const [land, borders, places] = await Promise.all([import('../data/local_data/natural_earth/land.json'),
      import('../data/local_data/natural_earth/borders.json'), import('../data/local_data/natural_earth/places.json')]);
    mapData = { rings: land.default.rings, borders: borders.default.lines, places: places.default.places };
  }
  return mapData;
}
function describeCluster(cluster) {
  const n = cluster.items.length;
  const head = n === 1 ? placeText(cluster.items[0]) : `${n} návštevníci · ${[...new Set(cluster.items.map(placeText))].slice(0, 3).join(' · ')}`;
  const lines = [head];
  for (const v of cluster.items.slice(0, 6)) {
    lines.push(`${v.ip ? `${v.ip} · ` : ''}${DEVICES[v.device] || v.device} · ${v.path} · na stránke ${duration(v.activeS)}${v.precision === 'country' ? ' · len krajina' : ''}`);
  }
  if (n > 6) lines.push(`… a ďalší ${n - 6}`);
  return lines;
}
async function renderLive() {
  const [base, data] = await Promise.all([loadMapData(), api('/api/admin/live')]);
  const count = el('span', 'live-count-value', data.liveNow);
  const countBox = el('div', 'live-count');
  countBox.append(el('span', 'live-dot'), count, el('span', 'live-count-label', 'práve na okolive.sk'));
  const stats = el('div', 'live-stats');
  const viewBar = el('div', 'admin-range');
  const mapBox = el('div');
  const trend = el('div');
  const countries = el('div');
  const feed = el('ol', 'live-feed');
  const precisionNote = el('p', 'admin-muted');
  setView(
    section('', countBox, stats, viewBar, mapBox, precisionNote),
    el('div', 'admin-grid'),
  );
  const grid = main.lastElementChild;
  const countriesBox = el('section', 'admin-section admin-cell'); countriesBox.append(el('h2', '', 'Krajiny teraz'), countries);
  const feedBox = el('section', 'admin-section admin-cell'); feedBox.append(el('h2', '', 'Posledné zobrazenia'), feed);
  grid.append(countriesBox, feedBox);
  const trendBox = section('Počet naživo · posledné 2 h', trend);
  const logBox = section('Záznam návštev');
  main.append(trendBox, logBox, el('p', 'admin-muted', 'Záznam návštev (IP, čas, stránka, poloha podľa Cloudflare, prehliadač) vidí len vlastník a server ho maže po 30 dňoch; je uvedený v zásadách súkromia. Prehliadač s Do Not Track / GPC sa nezapíše vôbec. Mesto je zaokrúhlené na 0,1°.'));
  void renderVisitLog(logBox);

  liveState.map = createLiveMap(mapBox, { ...base, describe: describeCluster });
  const viewButtons = new Map();
  let manual = liveState.view;
  for (const [key, view] of Object.entries(VIEWS)) {
    const b = button(view.label, () => { manual = liveState.view = key; liveState.map.setView(key); markView(); }, 'admin-chip');
    viewButtons.set(key, b);
    viewBar.append(b);
  }
  const autoButton = button('Automaticky', () => { manual = liveState.view = null; update(lastData); }, 'admin-chip');
  viewBar.prepend(autoButton);
  const markView = () => {
    autoButton.setAttribute('aria-pressed', String(!manual));
    for (const [key, b] of viewButtons) b.setAttribute('aria-pressed', String(key === liveState.map.view));
  };

  let lastData = data;
  let lastRecentAt = 0;
  function update(d) {
    lastData = d;
    count.textContent = String(d.liveNow);
    const located = d.visitors.filter(v => Number.isFinite(v.lat));
    const countryCount = new Set(d.visitors.map(v => v.country).filter(c => c !== '??')).size;
    const mobile = d.visitors.filter(v => v.device === 'mobil' || v.device === 'tablet').length;
    stats.replaceChildren(...[
      [`${countryCount}`, countryCount === 1 ? 'krajina' : countryCount >= 2 && countryCount <= 4 ? 'krajiny' : 'krajín'],
      [`${new Set(d.visitors.filter(v => v.city).map(v => `${v.city}|${v.country}`)).size}`, 'miest'],
      [d.liveNow ? `${Math.round((mobile / d.liveNow) * 100)} %` : '—', 'z mobilu'],
      [`${d.recent.filter(r => r.agoS < 3600).length}`, 'zobrazení za hodinu'],
    ].map(([value, label]) => { const s = el('span', 'live-stat'); s.append(el('b', '', value), el('span', '', label)); return s; }));
    if (!manual) liveState.map.setView(autoView(d.visitors));
    markView();
    liveState.map.setData(located, { note: d.cityPrecision ? 'poloha: mesto' : 'poloha: krajina' });
    precisionNote.textContent = d.liveNow && !d.cityPrecision
      ? 'Body stoja v hlavnom meste krajiny (prerušovaný krúžok). Presnosť na mesto zapne v Cloudflare: Rules → Settings → Managed Transforms → „Add visitor location headers".'
      : located.length < d.visitors.length ? `${d.visitors.length - located.length} bez známej polohy.` : '';
    const byCountry = new Map();
    for (const v of d.visitors) byCountry.set(v.country, (byCountry.get(v.country) || 0) + 1);
    countries.replaceChildren();
    barList(countries, [...byCountry].map(([val, n]) => ({ val, n })).sort((a, b) => b.n - a.n), { labelOf: r => countryName(r.val) });
    const newest = d.recent[0]?.at || 0;
    feed.replaceChildren(...d.recent.slice(0, 15).map(r => {
      const li = el('li', r.at > lastRecentAt && lastRecentAt ? 'live-feed-new' : '');
      li.append(el('span', 'live-feed-time', agoText(r.agoS)), el('span', 'live-feed-place', placeText(r) || 'neznáme miesto'),
        el('span', 'live-feed-meta', `${r.ip ? `${r.ip} · ` : ''}${r.path} · ${DEVICES[r.device] || r.device}${r.ref && r.ref !== 'priamo' ? ` · z ${r.ref}` : ''}`));
      return li;
    }));
    if (!d.recent.length) feed.append(el('li', 'admin-muted', 'Zatiaľ nič — zoznam sa plní od reštartu servera.'));
    lastRecentAt = newest;
    trend.replaceChildren();
    const t = el('div'); trend.append(t);
    lineChart(t, { labels: d.history.map(h => { const x = new Date(h.at); return `${x.getHours()}:${String(x.getMinutes()).padStart(2, '0')}`; }),
      series: [{ name: 'Naživo', values: d.history.map(h => h.n) }], height: 160 });
  }
  update(data);
  const tick = async () => {
    if (document.hidden) return;
    try { update(await api('/api/admin/live')); } catch { /* ďalší pokus o 10 s */ }
  };
  liveState.timer = setInterval(tick, 10_000);
  leaveTab = () => { clearInterval(liveState.timer); clearInterval(liveState.logTimer); liveState.map?.stop(); liveState.map = null; };
}

// Záznam návštev s IP (30 dní) — tabuľka pod mapou, hľadanie v IP / meste / stránke / referri.
const visitState = { days: 1, q: '', page: 0, group: false };
const timeFmt = new Intl.DateTimeFormat('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const stayText = seconds => (seconds >= 60 ? duration(seconds) : '< 1 min');
async function renderVisitLog(box) {
  const body = el('div');
  box.replaceChildren(box.firstChild, body);
  let input = null;
  const draw = async () => {
    let data;
    const query = `days=${visitState.days}&q=${encodeURIComponent(visitState.q)}`;
    try { data = await api(`/api/admin/visits?${query}&page=${visitState.page}${visitState.group ? '&group=ip' : ''}`); }
    catch (error) { body.replaceChildren(notice(error.message)); return; }
    const picker = rangePicker(visitState, [[1, '24 h'], [7, '7 dní'], [30, '30 dní']], () => { visitState.page = 0; void draw(); });
    // Režim: každé zobrazenie zvlášť, alebo jeden riadok na IP (človeka).
    const mode = el('div', 'admin-range');
    for (const [group, label] of [[false, 'Každá návšteva'], [true, 'Podľa IP']]) {
      const b = button(label, () => { visitState.group = group; visitState.page = 0; void draw(); }, 'admin-chip');
      b.setAttribute('aria-pressed', String(visitState.group === group));
      mode.append(b);
    }
    const csv = el('a', 'admin-btn admin-btn-sm', 'Stiahnuť CSV');
    csv.href = `/api/admin/visits.csv?${query}`;
    csv.title = 'Celý výber (aj ďalšie strany) pre Excel';
    mode.append(csv);
    const search = el('form', 'admin-search');
    input = el('input');
    input.type = 'search'; input.placeholder = 'IP, mesto, krajina (SK), stránka, odkiaľ, prehliadač…'; input.value = visitState.q;
    const go = el('button', 'admin-btn', 'Hľadať'); go.type = 'submit';
    search.append(input, go);
    search.addEventListener('submit', event => { event.preventDefault(); visitState.q = input.value.trim(); visitState.page = 0; void draw(); });
    const filterBy = value => () => { visitState.q = value; visitState.group = false; visitState.page = 0; void draw(); };
    const placeOf = v => [v.city, v.region && v.region !== v.city ? v.region : '', countryName(v.country)].filter(Boolean).join(', ');
    let content;
    const count = visitState.group ? data.groups.length : data.rows.length;
    if (visitState.group) {
      const rows = data.groups.map(g => {
        const paths = el('span', '', g.paths.join(' · '));
        return row([button(g.ip, filterBy(g.ip), 'admin-link live-ip'), placeOf(g) || '—', number(g.views), paths, stayText(Math.round(g.ms / 1000)),
          timeFmt.format(new Date(g.first)), timeFmt.format(new Date(g.last)), g.device.split(' · ').map((part, i) => (i ? part : DEVICES[part] || part)).join(' · ')]);
      });
      content = rows.length ? table(['IP', 'Miesto', 'Zobrazení', 'Stránky', 'Spolu na stránke', 'Prvá', 'Posledná', 'Zariadenie'], rows) : null;
    } else {
      const rows = data.rows.map(v => {
        const device = el('span', '', `${DEVICES[v.device] || v.device} · ${v.browser} · ${v.os}`);
        device.title = v.ua;
        return row([timeFmt.format(new Date(v.at)), button(v.ip, filterBy(v.ip), 'admin-link live-ip'), placeOf(v) || '—', v.path, v.ref, device,
          stayText(Math.max(0, Math.round((v.lastAt - v.at) / 1000)))]);
      });
      content = rows.length ? table(['Čas', 'IP', 'Miesto', 'Stránka', 'Odkiaľ', 'Zariadenie', 'Na stránke'], rows) : null;
    }
    const facts = el('div', 'admin-facts');
    facts.append(el('span', '', `${number(data.total)} návštev`), el('span', 'admin-muted', `${number(data.ips)} rôznych IP`),
      el('span', 'admin-muted', `uchováva sa ${data.retentionDays} dní · obnova každých 30 s`));
    if (data.q) facts.append(button(`zrušiť filter „${data.q}"`, filterBy(''), 'admin-link'));
    // Vylúčené IP: nezapisujú sa nikam (záznam, štatistika, mapa); pridanie zmaže aj ich doterajšie návštevy.
    const setIgnored = async ips => {
      try { await api('/api/admin/ignored-ips', { method: 'POST', body: { ips } }); } catch (error) { body.prepend(notice(error.message)); return; }
      void draw();
    };
    const ignored = el('div', 'admin-facts live-ignored');
    const yours = data.yourIp && !data.ignoredIps.includes(data.yourIp);
    ignored.append(el('span', 'admin-muted', `tvoja IP: ${data.yourIp || 'neznáma'}`));
    if (yours) ignored.append(button('Nezapisovať moju IP', () => setIgnored([...data.ignoredIps, data.yourIp]), 'admin-btn admin-btn-sm'));
    for (const ip of data.ignoredIps) {
      const chip = el('span', 'admin-badge admin-badge-muted', `nezapisuje sa: ${ip}${ip === data.yourIp ? ' (ty)' : ''} `);
      chip.append(button('×', () => setIgnored(data.ignoredIps.filter(other => other !== ip)), 'admin-link'));
      ignored.append(chip);
    }
    const total = visitState.group ? data.ips : data.total;
    const pager = el('div', 'admin-pager');
    if (visitState.page > 0) pager.append(button('← novšie', () => { visitState.page--; void draw(); }, 'admin-btn admin-btn-sm'));
    if (data.offset + count < total) pager.append(button('staršie →', () => { visitState.page++; void draw(); }, 'admin-btn admin-btn-sm'));
    pager.append(el('span', 'admin-muted', total ? `${data.offset + 1}–${data.offset + count} z ${number(total)}` : ''));
    body.replaceChildren(picker, mode, search, facts, ignored, content || el('p', 'admin-muted', 'Žiadne návštevy v tomto rozsahu.'), pager);
  };
  await draw();
  // Samočinná obnova len na prvej strane a keď nepíšeš do hľadania.
  liveState.logTimer = setInterval(() => {
    if (document.hidden || visitState.page > 0 || document.activeElement === input || !box.isConnected) return;
    void draw();
  }, 30_000);
}

// ── štart ──────────────────────────────────────────────────────────────────
const RENDER = { overview: renderOverview, live: renderLive, analytics: renderAnalytics, traffic: renderTraffic, errors: renderErrors,
  costs: renderCosts, feeds: renderFeeds, estimates: renderEstimates, users: renderUsers, notice: renderNotice, maintenance: renderMaintenance,
  studio: renderStudio, performance: renderPerformance, audit: renderAudit, log: renderLog };
function show(tab) {
  const current = RENDER[tab] ? tab : 'overview';
  const group = groupOf(current);
  for (const b of tabs.querySelectorAll('button')) {
    if (b.dataset.group === group.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  // Podzáložky len pri skupine s viac ako jednou.
  subtabs.hidden = group.tabs.length < 2;
  subtabs.replaceChildren(...group.tabs.map(([id, label]) => {
    const b = button(label, () => show(id));
    b.dataset.tab = id;
    if (id === current) b.setAttribute('aria-current', 'page');
    return b;
  }));
  window.scrollTo({ top: 0 });
  if (location.hash !== `#${current}`) history.replaceState(null, '', `#${current}`);
  currentTab = current;
  lastTab.set(group.id, current);
  if (leaveTab) { leaveTab(); leaveTab = null; }
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
  // O prístupe rozhoduje server (rola owner ALEBO overený e-mail z OKO_OWNER_EMAILS); ostatným dá 404.
  if (session.user.role !== 'owner') {
    let allowed = false;
    try { await api('/api/admin/overview'); allowed = true; }
    catch (error) { if (error.status !== 404) { setView(notice(error.message)); return; } }
    if (!allowed) {
      setView(section('Admin', el('p', '', 'Tento účet nemá prístup do administrácie.')));
      return;
    }
  }
  csrf = session.csrfToken || '';
  who.textContent = session.user.email;
  tabs.hidden = false;
  tabs.replaceChildren(...GROUPS.map(group => {
    // Skupina otvorí naposledy použitú podzáložku (prvú, ak žiadnu).
    const b = button(group.label, () => show(lastTab.get(group.id) || group.tabs[0][0]));
    b.dataset.group = group.id;
    return b;
  }));
  addEventListener('hashchange', () => { if (location.hash.slice(1) !== currentTab) show(location.hash.slice(1)); });
  show(location.hash.slice(1));
}

void start();
