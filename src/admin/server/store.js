// Admin panel OKO (2026-10-03) — prevádzková databáza `.auth-data/admin.sqlite`.
//
// Oddelená od účtov: telemetria sa zapisuje často a nesmie zdržiavať prihlásenie.
// Štatistika sú agregáty (počty za hodinu/deň) a hash návštevníka s denne rotovanou
// soľou, ktorý po skončení dňa zmizne (zostane len počet).
// Výnimka (2026-10-04, na pokyn vlastníka): záznam návštev visit_log — IP, čas, stránka,
// poloha podľa Cloudflare, prehliadač — vidí ho len vlastník v admine, maže sa po 30 dňoch
// (RETENTION.visitLogDays) a je uvedený v zásadách súkromia. Do Not Track / GPC = nič.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const DAY_MS = 86400_000;
export const RETENTION = Object.freeze({ trafficDays: 90, pageviewDays: 400, errorDays: 30, sampleDays: 30, visitLogDays: 30 });

const VISIT_COLUMNS = 'id, at, last_at, ip, country, region, city, lat, lon, path, ref, browser, os, device, screen, lang, ua';
const visitRow = row => ({ id: row.id, at: row.at, lastAt: row.last_at, ip: row.ip, country: row.country, region: row.region,
  city: row.city, lat: row.lat, lon: row.lon, path: row.path, ref: row.ref, browser: row.browser, os: row.os, device: row.device,
  screen: row.screen, lang: row.lang, ua: row.ua });

function studioRow(row) {
  const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
  return { id: row.id, template: row.template, eventKey: row.event_key, origin: row.origin, title: row.title, text: row.text,
    edited: row.text !== row.original_text, card: parse(row.card, {}), status: row.status, results: parse(row.results, {}),
    createdAt: row.created_at, updatedAt: row.updated_at, approvedAt: row.approved_at, publishedAt: row.published_at,
    video: row.video ?? null, videoStatus: row.video_status ?? null, videoError: row.video_error ?? null,
    scheduledAt: row.scheduled_at ?? null, scheduledTargets: parse(row.scheduled_targets, null),
    retryAt: row.retry_at ?? null, retryN: row.retry_n ?? 0, videoSeconds: row.video_seconds ?? null,
    slides: 1 + (row.extra_images ?? 0) };
}
const DRAFT_COLUMNS = `id, template, event_key, origin, title, text, original_text, card, status, results, created_at,
        updated_at, approved_at, published_at, video, video_status, video_error, scheduled_at, scheduled_targets, retry_at, retry_n, video_seconds,
        (SELECT COUNT(*) FROM studio_images WHERE studio_images.draft_id = studio_drafts.id) AS extra_images`;

export function openAdminStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS traffic (
      hour INTEGER NOT NULL, route TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
      e4 INTEGER NOT NULL DEFAULT 0, e5 INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0,
      ms_sum REAL NOT NULL DEFAULT 0, ms_max REAL NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour, route)
    );
    CREATE TABLE IF NOT EXISTS pageviews (
      day TEXT NOT NULL, dim TEXT NOT NULL, val TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, dim, val)
    );
    CREATE TABLE IF NOT EXISTS visitors (day TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (day, hash));
    CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS errors (
      sig TEXT PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS errors_last ON errors(last_at);
    CREATE TABLE IF NOT EXISTS feed_samples (
      at INTEGER NOT NULL, feed TEXT NOT NULL, ok INTEGER NOT NULL, status INTEGER NOT NULL, ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS feed_samples_feed ON feed_samples(feed, at);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT
    );
    -- Štúdio sociálnych sietí (2026-10-03): návrhy príspevkov. event_key = jedna udalosť → jeden návrh.
    CREATE TABLE IF NOT EXISTS studio_drafts (
      id TEXT PRIMARY KEY, template TEXT NOT NULL, event_key TEXT NOT NULL UNIQUE, origin TEXT NOT NULL,
      title TEXT NOT NULL, text TEXT NOT NULL, original_text TEXT NOT NULL, card TEXT NOT NULL,
      image BLOB, status TEXT NOT NULL CHECK (status IN ('draft','approved','published','failed','discarded')),
      results TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      approved_at INTEGER, published_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS studio_drafts_time ON studio_drafts(created_at);
  `);
  // Fáza 2 (reels): stav videa — aditívne stĺpce.
  const draftColumns = db.prepare('PRAGMA table_info(studio_drafts)').all().map(column => column.name);
  if (!draftColumns.includes('video')) db.exec('ALTER TABLE studio_drafts ADD COLUMN video TEXT');
  if (!draftColumns.includes('video_status')) db.exec('ALTER TABLE studio_drafts ADD COLUMN video_status TEXT');
  if (!draftColumns.includes('video_error')) db.exec('ALTER TABLE studio_drafts ADD COLUMN video_error TEXT');
  // Fáza 3 (plánovanie + štatistiky): aditívne.
  if (!draftColumns.includes('scheduled_at')) db.exec('ALTER TABLE studio_drafts ADD COLUMN scheduled_at INTEGER');
  if (!draftColumns.includes('scheduled_targets')) db.exec('ALTER TABLE studio_drafts ADD COLUMN scheduled_targets TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS studio_insights (
    draft_id TEXT NOT NULL, target TEXT NOT NULL, fetched_at INTEGER NOT NULL, metrics TEXT NOT NULL, PRIMARY KEY (draft_id, target)
  )`);
  // Karusel (2026-10-04): ďalšie snímky návrhu (hlavný obrázok ostáva v studio_drafts.image). Aditívne.
  db.exec(`CREATE TABLE IF NOT EXISTS studio_images (
    draft_id TEXT NOT NULL, idx INTEGER NOT NULL, image BLOB NOT NULL, PRIMARY KEY (draft_id, idx)
  )`);
  // Opakovanie zlyhaného zverejnenia a dĺžka reelu (2026-10-04): aditívne.
  if (!draftColumns.includes('retry_at')) db.exec('ALTER TABLE studio_drafts ADD COLUMN retry_at INTEGER');
  if (!draftColumns.includes('retry_n')) db.exec('ALTER TABLE studio_drafts ADD COLUMN retry_n INTEGER NOT NULL DEFAULT 0');
  if (!draftColumns.includes('video_seconds')) db.exec('ALTER TABLE studio_drafts ADD COLUMN video_seconds REAL');
  // Záznam návštev (2026-10-04): jeden riadok na zobrazenie stránky, last_at posúva ping.
  db.exec(`CREATE TABLE IF NOT EXISTS visit_log (
    id TEXT PRIMARY KEY, at INTEGER NOT NULL, last_at INTEGER NOT NULL, ip TEXT NOT NULL, country TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', lat REAL, lon REAL, path TEXT NOT NULL, ref TEXT NOT NULL,
    browser TEXT NOT NULL, os TEXT NOT NULL, device TEXT NOT NULL, screen TEXT NOT NULL, lang TEXT NOT NULL, ua TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS visit_log_at ON visit_log(at);`);
  if (filename !== ':memory:' && process.platform !== 'win32') { try { chmodSync(filename, 0o600); } catch { /* ok */ } }

  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const upsertTraffic = db.prepare(`INSERT INTO traffic (hour, route, n, e4, e5, blocked, ms_sum, ms_max, bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(hour, route) DO UPDATE SET n = n + excluded.n,
    e4 = e4 + excluded.e4, e5 = e5 + excluded.e5, blocked = blocked + excluded.blocked, ms_sum = ms_sum + excluded.ms_sum,
    ms_max = max(ms_max, excluded.ms_max), bytes = bytes + excluded.bytes`);
  const upsertPv = db.prepare(`INSERT INTO pageviews (day, dim, val, n) VALUES (?, ?, ?, ?)
    ON CONFLICT(day, dim, val) DO UPDATE SET n = n + excluded.n`);
  const upsertError = db.prepare(`INSERT INTO errors (sig, kind, message, detail, count, first_at, last_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sig) DO UPDATE SET count = count + excluded.count,
    last_at = max(last_at, excluded.last_at), detail = excluded.detail`);

  return {
    close: () => db.close(),
    /** Zapíše buffer z pamäte jednou transakciou. */
    flush({ traffic = [], pageviews = [], visitors = [], errors = [], samples = [], visits = [] }) {
      if (!traffic.length && !pageviews.length && !visitors.length && !errors.length && !samples.length && !visits.length) return;
      tx(() => {
        for (const t of traffic) upsertTraffic.run(t.hour, t.route, t.n, t.e4, t.e5, t.blocked, t.msSum, t.msMax, t.bytes);
        for (const p of pageviews) upsertPv.run(p.day, p.dim, p.val, p.n);
        const visitor = db.prepare('INSERT OR IGNORE INTO visitors (day, hash) VALUES (?, ?)');
        for (const v of visitors) visitor.run(v.day, v.hash);
        for (const e of errors) upsertError.run(e.sig, e.kind, e.message, e.detail, e.count, e.firstAt, e.lastAt);
        const sample = db.prepare('INSERT INTO feed_samples (at, feed, ok, status, ms) VALUES (?, ?, ?, ?, ?)');
        for (const s of samples) sample.run(s.at, s.feed, s.ok ? 1 : 0, s.status, s.ms);
        const visit = db.prepare(`INSERT INTO visit_log (${VISIT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET last_at = max(last_at, excluded.last_at)`);
        for (const v of visits) {
          visit.run(v.id, v.at, v.lastAt, v.ip, v.country, v.region || '', v.city || '', v.lat ?? null, v.lon ?? null, v.path, v.ref,
            v.browser, v.os, v.device, v.screen, v.lang, v.ua);
        }
      });
    },
    /** Denná soľ pre hash návštevníka; staršie sa mažú, takže hash nejde spojiť cez dni. */
    salt(day) {
      const row = db.prepare('SELECT salt FROM salts WHERE day = ?').get(day);
      if (row) return row.salt;
      const salt = randomBytes(32).toString('base64url');
      tx(() => {
        db.prepare('DELETE FROM salts WHERE day != ?').run(day);
        db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').run(day, salt);
      });
      return db.prepare('SELECT salt FROM salts WHERE day = ?').get(day).salt;
    },
    /** Uzavrie minulé dni: hashe → jeden počet `visitors`, hashe sa zmažú. */
    rollup(today) {
      tx(() => {
        const days = db.prepare('SELECT day, COUNT(*) AS n FROM visitors WHERE day < ? GROUP BY day').all(today);
        for (const { day, n } of days) {
          db.prepare("INSERT INTO pageviews (day, dim, val, n) VALUES (?, 'visitors', '', ?) ON CONFLICT(day, dim, val) DO UPDATE SET n = excluded.n").run(day, n);
        }
        db.prepare('DELETE FROM visitors WHERE day < ?').run(today);
      });
    },
    prune(now) {
      const hour = Math.floor(now / 3600_000);
      const dayCut = new Date(now - RETENTION.pageviewDays * DAY_MS).toISOString().slice(0, 10);
      db.prepare('DELETE FROM traffic WHERE hour < ?').run(hour - RETENTION.trafficDays * 24);
      db.prepare('DELETE FROM pageviews WHERE day < ?').run(dayCut);
      db.prepare('DELETE FROM errors WHERE last_at < ?').run(now - RETENTION.errorDays * DAY_MS);
      db.prepare('DELETE FROM errors WHERE sig NOT IN (SELECT sig FROM errors ORDER BY last_at DESC LIMIT 2000)').run();
      db.prepare('DELETE FROM feed_samples WHERE at < ?').run(now - RETENTION.sampleDays * DAY_MS);
      db.prepare('DELETE FROM visit_log WHERE at < ?').run(now - RETENTION.visitLogDays * DAY_MS);
      this.studioPrune(now);
    },

    // ── čítanie pre admin ──
    trafficByHour(fromHour) {
      return db.prepare(`SELECT hour, SUM(n) AS n, SUM(e4) AS e4, SUM(e5) AS e5, SUM(blocked) AS blocked,
        SUM(ms_sum) AS msSum, SUM(bytes) AS bytes FROM traffic WHERE hour >= ? GROUP BY hour ORDER BY hour`).all(fromHour);
    },
    trafficByRoute(fromHour) {
      return db.prepare(`SELECT route, SUM(n) AS n, SUM(e4) AS e4, SUM(e5) AS e5, SUM(blocked) AS blocked,
        SUM(ms_sum) AS msSum, MAX(ms_max) AS msMax, SUM(bytes) AS bytes FROM traffic WHERE hour >= ?
        GROUP BY route ORDER BY n DESC`).all(fromHour);
    },
    /** Počty požiadaviek na route po hodinách (pre denné súčty nákladov). */
    routeHours(routes, fromHour) {
      if (!routes.length) return [];
      return db.prepare(`SELECT hour, route, n, e5, blocked FROM traffic WHERE hour >= ? AND route IN (${routes.map(() => '?').join(',')})
        ORDER BY hour`).all(fromHour, ...routes);
    },
    pageviewDims(fromDay) {
      return db.prepare('SELECT day, dim, val, n FROM pageviews WHERE day >= ? ORDER BY day').all(fromDay);
    },
    visitorsToday: day => db.prepare('SELECT COUNT(*) AS n FROM visitors WHERE day = ?').get(day).n,
    /** Zmaže záznam návštev z daných IP (vylúčené adresy vlastníka). */
    deleteVisitsByIp(ips) {
      if (!ips.length) return 0;
      return db.prepare(`DELETE FROM visit_log WHERE ip IN (${ips.map(() => '?').join(', ')})`).run(...ips).changes;
    },
    /**
     * Záznam návštev od `from`, najnovšie prvé. `q` hľadá v IP, meste, krajine, stránke, referri a prehliadači.
     * @returns {{rows: object[], total: number, ips: number}}
     */
    visitLog({ from, q = '', limit = 100, offset = 0 }) {
      const like = `%${String(q).replace(/[\\%_]/g, char => `\\${char}`)}%`;
      const where = q ? `at >= ? AND (ip LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR country LIKE ? ESCAPE '\\'
        OR path LIKE ? ESCAPE '\\' OR ref LIKE ? ESCAPE '\\' OR browser LIKE ? ESCAPE '\\' OR os LIKE ? ESCAPE '\\')` : 'at >= ?';
      const params = q ? [from, like, like, like, like, like, like, like] : [from];
      const rows = db.prepare(`SELECT ${VISIT_COLUMNS} FROM visit_log WHERE ${where} ORDER BY at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
      const { total, ips } = db.prepare(`SELECT COUNT(*) AS total, COUNT(DISTINCT ip) AS ips FROM visit_log WHERE ${where}`).get(...params);
      return { rows: rows.map(visitRow), total, ips };
    },
    errors(kind, limit = 200) {
      const where = kind ? 'WHERE kind = ?' : '';
      return db.prepare(`SELECT sig, kind, message, detail, count, first_at AS firstAt, last_at AS lastAt FROM errors ${where}
        ORDER BY last_at DESC LIMIT ?`).all(...(kind ? [kind, limit] : [limit]));
    },
    clearErrors: kind => (kind ? db.prepare('DELETE FROM errors WHERE kind = ?').run(kind) : db.prepare('DELETE FROM errors').run()).changes,
    samples(fromAt) {
      return db.prepare('SELECT at, feed, ok, status, ms FROM feed_samples WHERE at >= ? ORDER BY at').all(fromAt);
    },
    getSetting(key) {
      const row = db.prepare('SELECT value, updated_at AS updatedAt, updated_by AS updatedBy FROM settings WHERE key = ?').get(key);
      if (!row) return null;
      try { return { value: JSON.parse(row.value), updatedAt: row.updatedAt, updatedBy: row.updatedBy }; } catch { return null; }
    },
    settings(prefix) {
      return db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all(`${prefix}%`)
        .map(row => { try { return [row.key, JSON.parse(row.value)]; } catch { return null; } }).filter(Boolean);
    },
    setSetting(key, value, now, by) {
      if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      else db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .run(key, JSON.stringify(value), now, by || null);
    },
    // ── Štúdio ──
    studioInsert(draft) {
      const result = db.prepare(`INSERT INTO studio_drafts (id, template, event_key, origin, title, text, original_text, card, image,
        status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?) ON CONFLICT(event_key) DO NOTHING`)
        .run(draft.id, draft.template, draft.eventKey, draft.origin, draft.title, draft.text, draft.text, JSON.stringify(draft.card),
          draft.image, draft.createdAt, draft.createdAt);
      return result.changes > 0;
    },
    studioHasKey: key => Boolean(db.prepare('SELECT 1 FROM studio_drafts WHERE event_key = ?').get(key)),
    studioGet(id) {
      const row = db.prepare(`SELECT ${DRAFT_COLUMNS} FROM studio_drafts WHERE id = ?`).get(id);
      return row ? studioRow(row) : null;
    },
    studioImage: id => db.prepare('SELECT image FROM studio_drafts WHERE id = ?').get(id)?.image ?? null,
    /** Ďalšie snímky karuselu (idx 1…); idx 0 = hlavný obrázok. */
    studioImageAt(id, idx) {
      if (!idx) return this.studioImage(id);
      return db.prepare('SELECT image FROM studio_images WHERE draft_id = ? AND idx = ?').get(id, idx)?.image ?? null;
    },
    studioImagesSet(id, images) {
      db.prepare('DELETE FROM studio_images WHERE draft_id = ?').run(id);
      images.forEach((image, i) => db.prepare('INSERT INTO studio_images (draft_id, idx, image) VALUES (?, ?, ?)').run(id, i + 1, image));
    },
    /** Všetky snímky v poradí (hlavná + ďalšie). */
    studioImages(id) {
      const main = this.studioImage(id);
      if (!main) return [];
      return [main, ...db.prepare('SELECT image FROM studio_images WHERE draft_id = ? ORDER BY idx').all(id).map(row => row.image)];
    },
    /** Návrhy s naplánovaným opakovaním zverejnenia, ktorých čas nastal. */
    studioRetryDue: now => db.prepare(`SELECT id FROM studio_drafts WHERE retry_at IS NOT NULL AND retry_at <= ? AND status IN ('approved','failed')
      ORDER BY retry_at`).all(now).map(row => row.id),
    studioList(limit = 100) {
      return db.prepare(`SELECT ${DRAFT_COLUMNS} FROM studio_drafts ORDER BY created_at DESC LIMIT ?`).all(limit).map(studioRow);
    },
    studioUpdate(id, fields, now) {
      const columns = { text: 'text', status: 'status', results: 'results', approvedAt: 'approved_at', publishedAt: 'published_at',
        video: 'video', videoStatus: 'video_status', videoError: 'video_error', scheduledAt: 'scheduled_at', scheduledTargets: 'scheduled_targets',
        retryAt: 'retry_at', retryN: 'retry_n', videoSeconds: 'video_seconds' };
      for (const [key, column] of Object.entries(columns)) {
        if (!(key in fields)) continue;
        const value = ['results', 'scheduledTargets'].includes(key) && fields[key] !== null ? JSON.stringify(fields[key]) : fields[key];
        db.prepare(`UPDATE studio_drafts SET ${column} = ?, updated_at = ? WHERE id = ?`).run(value, now, id);
      }
      return this.studioGet(id);
    },
    /** Koľkokrát bola šablóna zverejnená bez úpravy textu (podmienka automatiky). */
    studioUnchangedCount: template => db.prepare(`SELECT COUNT(*) AS n FROM studio_drafts WHERE template = ? AND status = 'published'
      AND origin = 'auto' AND text = original_text`).get(template).n,
    studioPublishedSince: (from, origin) => db.prepare(`SELECT COUNT(*) AS n FROM studio_drafts WHERE status = 'published'
      AND published_at >= ?${origin ? ' AND origin = ?' : ''}`).get(...(origin ? [from, origin] : [from])).n,
    /** Staré zahodené a nezverejnené návrhy (aj s obrázkom) po 30 dňoch preč; zverejnené ostávajú bez obrázka po 90 dňoch. */
    /** Návrhy, ktorých video sa má zmazať z disku (staré, alebo zverejnené pred 90 dňami). */
    studioExpiredVideos: now => db.prepare(`SELECT id, video FROM studio_drafts WHERE video IS NOT NULL AND (
      (status IN ('draft','discarded','failed') AND created_at < ?) OR (status = 'published' AND published_at < ?))`)
      .all(now - 30 * 86400_000, now - 90 * 86400_000),
    /** Naplánované návrhy, ktorých čas už nastal (status approved + scheduled_at). */
    studioDue: now => db.prepare(`SELECT id FROM studio_drafts WHERE scheduled_at IS NOT NULL AND scheduled_at <= ? AND status IN ('approved','failed')
      ORDER BY scheduled_at`).all(now).map(row => row.id),
    /** Zverejnené návrhy s ID príspevkov (pre štatistiky), najnovšie prvé. */
    studioPublished: (limit = 60) => db.prepare(`SELECT id, template, title, results, published_at FROM studio_drafts WHERE status = 'published'
      ORDER BY published_at DESC LIMIT ?`).all(limit).map(row => ({ id: row.id, template: row.template, title: row.title, publishedAt: row.published_at,
      results: (() => { try { return JSON.parse(row.results); } catch { return {}; } })() })),
    insightsSet(draftId, target, metrics, now) {
      db.prepare(`INSERT INTO studio_insights (draft_id, target, fetched_at, metrics) VALUES (?, ?, ?, ?)
        ON CONFLICT(draft_id, target) DO UPDATE SET fetched_at = excluded.fetched_at, metrics = excluded.metrics`).run(draftId, target, now, JSON.stringify(metrics));
    },
    insightsAll() {
      const out = {};
      for (const row of db.prepare('SELECT draft_id, target, fetched_at, metrics FROM studio_insights').all()) {
        let metrics = {}; try { metrics = JSON.parse(row.metrics); } catch { /* ignoruj */ }
        (out[row.draft_id] ||= {})[row.target] = { fetchedAt: row.fetched_at, ...metrics };
      }
      return out;
    },
    studioQueuedVideos: () => db.prepare("SELECT id FROM studio_drafts WHERE video_status IN ('queued','rendering') ORDER BY created_at").all().map(row => row.id),
    studioPrune(now) {
      db.prepare(`DELETE FROM studio_drafts WHERE status IN ('draft','discarded','failed') AND created_at < ?`).run(now - 30 * 86400_000);
      db.prepare('DELETE FROM studio_insights WHERE draft_id NOT IN (SELECT id FROM studio_drafts)').run();
      db.prepare(`UPDATE studio_drafts SET image = NULL WHERE status = 'published' AND published_at < ?`).run(now - 90 * 86400_000);
      db.prepare('DELETE FROM studio_images WHERE draft_id NOT IN (SELECT id FROM studio_drafts WHERE image IS NOT NULL)').run();
    },
    /** Konzistentná kópia databázy (bez zastavenia servera). */
    backupTo(file) { db.exec(`VACUUM INTO '${String(file).replaceAll("'", "''")}'`); },
  };
}
