// OKO admin — upozornenia vlastníkovi (2026-10-04, „admin všetko zbiera, ale nikomu nepovie").
//
// Čo sa hlási: feed nedostupný dlhšie ako N minút (zo vzoriek /status každých 10 min),
// nové chyby servera / HTTP 5xx (nový podpis chyby), zlyhané zverejnenie zo Štúdia
// (po vyčerpaní opakovaní). Kanál: existujúci webhook mailer účtov (AUTH_MAIL_*) —
// bez neho sa upozornenia len zapíšu do zoznamu v admine. Zadarmo.
//
// Ochrana pred záplavou: ten istý kľúč (feed / podpis chyby / návrh) najviac raz za 6 h,
// najviac 12 e-mailov za 24 h. Do e-mailu ide len text bez tajomstiev (chyby sú už
// redigované v runtime.recordError).

const DEDUPE_MS = 6 * 3600_000;
const MAX_PER_DAY = 12;
const LOG_MAX = 50;
const CHECK_MS = 10 * 60_000;
export const ALERT_DEFAULTS = Object.freeze({ enabled: false, email: null, feedDownMinutes: 60, errors: true, publish: true });

export function createAlerts({ store, mailer = { configured: false }, now = Date.now, log = message => console.warn(message),
  feeds = [], defaultEmail = null, timers = true } = {}) {
  let timer = null;
  let lastErrorCheck = now();

  function settings() {
    return { ...ALERT_DEFAULTS, email: defaultEmail, ...(store.getSetting('alerts:settings')?.value || {}) };
  }
  function setSettings(patch, by = 'owner') {
    const next = { ...settings() };
    if ('enabled' in patch) next.enabled = Boolean(patch.enabled);
    for (const key of ['errors', 'publish']) if (key in patch) next[key] = Boolean(patch[key]);
    if ('email' in patch) {
      const email = patch.email === null || patch.email === '' ? null : String(patch.email).trim();
      if (email !== null && !/^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i.test(email)) throw Object.assign(new Error('invalid_input'), { status: 400 });
      next.email = email;
    }
    if ('feedDownMinutes' in patch) {
      const minutes = Number(patch.feedDownMinutes);
      if (!Number.isInteger(minutes) || minutes < 20 || minutes > 24 * 60) throw Object.assign(new Error('invalid_input'), { status: 400 });
      next.feedDownMinutes = minutes;
    }
    store.setSetting('alerts:settings', next, now(), by);
    return settings();
  }
  const history = () => store.getSetting('alerts:log')?.value || [];
  const sent = () => store.getSetting('alerts:sent')?.value || {};

  /** Zapíše upozornenie a pošle e-mail (ak je zapnuté a mailer nastavený). Vracia záznam alebo null (duplicitné). */
  async function notify({ kind, key, subject, text, force = false }) {
    const time = now();
    const last = sent();
    if (!force && last[key] && time - last[key] < DEDUPE_MS) return null;
    const s = settings();
    const items = history();
    const today = items.filter(item => item.mailed && time - item.at < 86400_000).length;
    let mailed = false; let mailError = null;
    if (s.enabled && s.email && mailer.configured && (force || today < MAX_PER_DAY)) {
      try {
        await mailer.send({ to: s.email, subject: `OKO: ${subject}`.slice(0, 160), text: `${text}\n\n— OKO admin (${new Date(time).toISOString()})\nNastavenie upozornení: admin → Údržba.` });
        mailed = true;
      } catch (error) { mailError = String(error?.message || error).slice(0, 120); }
    }
    const entry = { at: time, kind, key: String(key).slice(0, 120), subject: String(subject).slice(0, 160), text: String(text).slice(0, 600), mailed, mailError };
    store.setSetting('alerts:log', [entry, ...items].slice(0, LOG_MAX), time, 'system');
    const pruned = Object.fromEntries(Object.entries({ ...last, [key]: time }).filter(([, at]) => time - at < 2 * DEDUPE_MS));
    store.setSetting('alerts:sent', pruned, time, 'system');
    if (!mailed && s.enabled && !mailer.configured) log(`[alerts] ${subject} (e-mail nie je nastavený — AUTH_MAIL_*)`);
    return entry;
  }

  /** Feed nedostupný: všetky vzorky za posledných N minút zlyhali (aspoň 2 vzorky). */
  async function checkFeeds() {
    const s = settings();
    const from = now() - s.feedDownMinutes * 60_000;
    const byFeed = new Map();
    for (const sample of store.samples(from)) (byFeed.get(sample.feed) || byFeed.set(sample.feed, []).get(sample.feed)).push(sample);
    const out = [];
    for (const [feed, rows] of byFeed) {
      if (rows.length < 2 || rows.some(row => row.ok)) continue;
      const label = feeds.find(f => f.id === feed)?.label || feed;
      const entry = await notify({ kind: 'feed_down', key: `feed:${feed}`, subject: `${label} je nedostupný`,
        text: `Zdroj „${label}" neodpovedá ${s.feedDownMinutes} min (${rows.length} kontrol, posledný stav HTTP ${rows[rows.length - 1].status || 'bez odpovede'}).\nGlóbus ho zobrazuje ako nedostupný; v admine → Feedy je história.` });
      if (entry) out.push(entry);
    }
    return out;
  }

  /** Nové chyby servera a HTTP 5xx od poslednej kontroly (nový podpis = nové upozornenie). */
  async function checkErrors() {
    if (!settings().errors) { lastErrorCheck = now(); return []; }
    const since = lastErrorCheck;
    lastErrorCheck = now();
    const fresh = store.errors(null, 200).filter(row => ['server', 'http'].includes(row.kind) && row.firstAt >= since);
    if (!fresh.length) return [];
    const total = fresh.reduce((sum, row) => sum + row.count, 0);
    const lines = fresh.slice(0, 8).map(row => `• [${row.kind}] ${row.message.slice(0, 200)} (${row.count}×)`).join('\n');
    const entry = await notify({ kind: 'errors', key: `errors:${fresh.map(row => row.sig).sort().join(',').slice(0, 100)}`,
      subject: `${fresh.length} ${fresh.length === 1 ? 'nová chyba' : fresh.length < 5 ? 'nové chyby' : 'nových chýb'} na serveri`,
      text: `Od ${new Date(since).toISOString()} pribudlo ${fresh.length} nových druhov chýb (${total} výskytov):\n${lines}\n\nDetail: admin → Chyby.` });
    return entry ? [entry] : [];
  }

  /** Zlyhané zverejnenie zo Štúdia (volá ho Štúdio cez onAlert). */
  function onStudioAlert(event) {
    if (event?.kind !== 'publish_failed' || !settings().publish) return;
    void notify({ kind: 'publish_failed', key: `publish:${event.id}`, subject: `Zverejnenie zlyhalo: ${event.title}`,
      text: `Príspevok „${event.title}" sa nepodarilo zverejniť (${(event.targets || []).join(', ')}) po ${event.attempts} ${event.attempts === 1 ? 'pokuse' : 'pokusoch'}.\nChyba: ${event.error}\n\nAdmin → Štúdio: skúste znova alebo zdieľajte ručne.` })
      .catch(error => log(`[alerts] ${error?.message || error}`));
  }

  async function check() {
    if (!settings().enabled) { lastErrorCheck = now(); return { skipped: 'disabled' }; }
    const feedsOut = await checkFeeds().catch(error => { log(`[alerts] feeds: ${error?.message || error}`); return []; });
    const errorsOut = await checkErrors().catch(error => { log(`[alerts] errors: ${error?.message || error}`); return []; });
    return { sent: [...feedsOut, ...errorsOut] };
  }

  return {
    settings, setSettings, history, notify, check, checkFeeds, checkErrors, onStudioAlert,
    status: () => ({ mailer: Boolean(mailer.configured), ...settings() }),
    test: () => notify({ kind: 'test', key: `test:${now()}`, subject: 'skúšobné upozornenie', text: 'Toto je skúška upozornení z admina OKO. Ak ju čítate, e-maily fungujú.', force: true }),
    start() {
      if (!timers || timer) return;
      timer = setInterval(() => { void check(); }, CHECK_MS);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
