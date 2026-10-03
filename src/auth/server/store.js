import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function openAuthStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  // Serialize additive migrations with other backend/CLI connections.
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 5) throw new Error('Unsupported auth database version');
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS auth_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_limits_expiry ON auth_limits(expires_at);
    `);
    if (version < 2) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'owner'))");
    if (version < 3) {
      db.exec(`
        ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT 'orbit' CHECK (avatar IN ('orbit','radar','globe','satellite','map','compass'));
        ALTER TABLE users ADD COLUMN avatar_color TEXT NOT NULL DEFAULT 'cyan' CHECK (avatar_color IN ('cyan','green','amber','violet'));
        ALTER TABLE users ADD COLUMN last_login_at INTEGER;
        ALTER TABLE users ADD COLUMN password_changed_at INTEGER;
        ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0,1));
        ALTER TABLE users ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN session_id TEXT;
        ALTER TABLE sessions ADD COLUMN label TEXT NOT NULL DEFAULT 'Unknown browser';
      `);
      for (const session of db.prepare('SELECT token_hash FROM sessions').all()) {
        db.prepare('UPDATE sessions SET session_id = ? WHERE token_hash = ?').run(randomUUID(), session.token_hash);
      }
    }
    if (version < 5) db.exec('ALTER TABLE users ADD COLUMN photo_version TEXT');
    // Zablokovanie účtu adminom (2026-10-03): aditívny stĺpec bez zvýšenia user_version.
    if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'disabled_at')) {
      db.exec('ALTER TABLE users ADD COLUMN disabled_at INTEGER');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS profile_photos (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        bytes BLOB NOT NULL CHECK (length(bytes) <= 262144), updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sessions_public_id ON sessions(session_id);
      CREATE TABLE IF NOT EXISTS account_tokens (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset','email')), email TEXT NOT NULL,
        credential_version INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        UNIQUE(user_id, purpose)
      );
      CREATE INDEX IF NOT EXISTS account_tokens_expiry ON account_tokens(expires_at);
      CREATE TABLE IF NOT EXISTS account_token_deliveries (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset','email')), email TEXT NOT NULL,
        credential_version INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        UNIQUE(user_id, purpose)
      );
      CREATE INDEX IF NOT EXISTS account_token_deliveries_expiry ON account_token_deliveries(expires_at);
      CREATE TABLE IF NOT EXISTS security_events (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS security_events_user ON security_events(user_id, created_at);
      -- Sledované lety (2026-09-27): len kľúč letu/stroja a krátky popis, nič o polohe používateľa.
      -- Aditívna tabuľka BEZ zvýšenia user_version — staršia verzia servera DB ďalej otvorí.
      CREATE TABLE IF NOT EXISTS followed_flights (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL CHECK (length(key) <= 16), hex TEXT, callsign TEXT,
        label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 80), created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      -- Prihlásenie cez Google/GitHub (2026-09-27): identita poskytovateľa → účet. Aditívne,
      -- bez zvýšenia user_version. E-mail je len pre prehľad v účte a export.
      CREATE TABLE IF NOT EXISTS oauth_identities (
        provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
        subject TEXT NOT NULL CHECK (length(subject) <= 255),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY (provider, subject),
        UNIQUE (user_id, provider)
      );
      -- Admin panel (2026-10-03): záznam zásahov vlastníka. Aditívna tabuľka bez zvýšenia
      -- user_version; target_id nemá cudzí kľúč, záznam prežije zmazanie účtu.
      CREATE TABLE IF NOT EXISTS admin_audit (
        id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target_id TEXT,
        detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS admin_audit_time ON admin_audit(created_at);
      PRAGMA user_version = 5; COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  if (filename !== ':memory:' && process.platform !== 'win32') chmodSync(filename, 0o600);
  let inTransaction = false;
  const transaction = (fn) => {
    if (inTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') throw new Error('Auth transactions must be synchronous');
      db.exec('COMMIT'); return result;
    }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { inTransaction = false; }
  };
  return {
    transaction,
    close: () => db.close(),
    photo: id => db.prepare('SELECT bytes FROM profile_photos WHERE user_id = ?').get(id)?.bytes,
    setPhoto(id, bytes, now) {
      return transaction(() => {
        if (bytes) db.prepare(`INSERT INTO profile_photos (user_id, bytes, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at`).run(id, bytes, now);
        else db.prepare('DELETE FROM profile_photos WHERE user_id = ?').run(id);
        db.prepare('UPDATE users SET photo_version = ? WHERE id = ?').run(bytes ? randomUUID() : null, id);
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      });
    },
    userById: id => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
    userByEmail: (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email),
    createUser(email, displayName, passwordHash, now) {
      const id = randomUUID();
      const result = db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
        .run(id, email, displayName, passwordHash, now);
      return result.changes ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null;
    },
    // Server-side provisioning only. Never exposed by registration/profile APIs.
    createOwner(email, displayName, passwordHash, now) {
      return transaction(() => {
        if (db.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get()) throw new Error('owner_exists');
        if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new Error('email_exists');
        const id = randomUUID();
        db.prepare("INSERT INTO users (id, email, display_name, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, 'owner')")
          .run(id, email, displayName, passwordHash, now);
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      });
    },
    updateProfile(id, fields) {
      if (typeof fields === 'string') fields = { displayName: fields };
      const columns = { displayName: 'display_name', bio: 'bio', avatar: 'avatar', avatarColor: 'avatar_color' };
      for (const [key, column] of Object.entries(columns)) {
        if (Object.hasOwn(fields, key)) db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(fields[key], id);
      }
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    },
    findSession(hash, now, idleMs) {
      return db.prepare(`SELECT s.*, u.id, u.email, u.display_name, u.role, u.bio, u.avatar, u.avatar_color,
        u.last_login_at, u.password_changed_at, u.email_verified, u.photo_version, u.created_at AS user_created_at
        FROM sessions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_seen > ? AND u.disabled_at IS NULL`).get(hash, now, now - idleMs);
    },
    touchSession(hash, now) {
      db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ? AND last_seen < ?').run(now, hash, now - 60_000);
    },
    rotateSession(oldHash, hash, userId, now, ttlMs, label = 'Unknown browser') {
      transaction(() => {
        if (oldHash && !db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(oldHash).changes) {
          throw Object.assign(new Error('csrf_failed'), { status: 403 });
        }
        if (userId) db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN
          (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 4)`).run(userId, userId);
        db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, session_id, label)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(hash, userId, now, now + ttlMs, now, randomUUID(), label);
      });
    },
    recordLogin(id, now) { db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, id); },
    changePassword(id, hash, now) {
      db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = ?, credential_version = credential_version + 1
        WHERE id = ?`).run(hash, now, id);
    },
    verifyEmail(id) { db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(id); },
    changeEmail(id, email) {
      // The UNIQUE constraint remains the final arbiter across simultaneous confirmations.
      db.prepare('UPDATE users SET email = ?, email_verified = 1, credential_version = credential_version + 1 WHERE id = ?').run(email, id);
    },
    deleteUserSessions(id, exceptHash = '') {
      return db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(id, exceptHash).changes;
    },
    revokeSession(id, userId) {
      return db.prepare('DELETE FROM sessions WHERE session_id = ? AND user_id = ?').run(id, userId).changes;
    },
    security(userId, currentHash, now, idleMs) {
      const sessions = db.prepare(`SELECT session_id AS id, label, created_at AS createdAt, last_seen AS lastSeen,
        expires_at AS expiresAt, token_hash = ? AS current FROM sessions
        WHERE user_id = ? AND expires_at > ? AND last_seen > ? ORDER BY created_at DESC, rowid DESC`)
        .all(currentHash, userId, now, now - idleMs).map(session => ({ ...session, current: Boolean(session.current) }));
      const events = db.prepare(`SELECT id, type, created_at AS createdAt FROM security_events
        WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC, rowid DESC LIMIT 100`).all(userId, now - 90 * 86400_000);
      return { sessions, events };
    },
    event(userId, type, now) {
      db.prepare('INSERT INTO security_events VALUES (?, ?, ?, ?)').run(randomUUID(), userId, type, now);
      db.prepare(`DELETE FROM security_events WHERE user_id = ? AND id NOT IN
        (SELECT id FROM security_events WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100)`).run(userId, userId);
    },
    issueToken(hash, user, purpose, email, now, ttlMs) {
      db.prepare(`INSERT INTO account_tokens VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, purpose) DO UPDATE SET token_hash = excluded.token_hash, email = excluded.email,
        credential_version = excluded.credential_version, created_at = excluded.created_at, expires_at = excluded.expires_at`)
        .run(hash, user.id, purpose, email, user.credential_version, now, now + ttlMs);
    },
    prepareToken(hash, user, purpose, email, now, ttlMs) {
      // A resend must not invalidate an already-delivered link until delivery succeeds.
      // The unique pending row also acts as the persisted latest-request generation.
      db.prepare(`INSERT INTO account_token_deliveries VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, purpose) DO UPDATE SET token_hash = excluded.token_hash, email = excluded.email,
        credential_version = excluded.credential_version, created_at = excluded.created_at, expires_at = excluded.expires_at`)
        .run(hash, user.id, purpose, email, user.credential_version, now, now + ttlMs);
    },
    activateToken(hash, now) {
      return transaction(() => {
        const token = db.prepare(`SELECT t.* FROM account_token_deliveries t JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = ? AND t.expires_at > ? AND t.credential_version = u.credential_version
          AND (t.purpose = 'email' OR t.email = u.email)`).get(hash, now);
        if (!token) return false;
        db.prepare(`INSERT INTO account_tokens VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, purpose) DO UPDATE SET token_hash = excluded.token_hash, email = excluded.email,
          credential_version = excluded.credential_version, created_at = excluded.created_at, expires_at = excluded.expires_at`)
          .run(token.token_hash, token.user_id, token.purpose, token.email, token.credential_version, token.created_at, token.expires_at);
        db.prepare('DELETE FROM account_token_deliveries WHERE token_hash = ?').run(hash);
        return true;
      });
    },
    findToken(hash, purpose, now) {
      return db.prepare(`SELECT t.* FROM account_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.purpose = ? AND t.expires_at > ? AND t.credential_version = u.credential_version`)
        .get(hash, purpose, now);
    },
    deleteToken: hash => db.prepare('DELETE FROM account_tokens WHERE token_hash = ?').run(hash),
    deletePendingToken: hash => db.prepare('DELETE FROM account_token_deliveries WHERE token_hash = ?').run(hash),
    deleteUserTokens(id) {
      return transaction(() => {
        db.prepare('DELETE FROM account_token_deliveries WHERE user_id = ?').run(id);
        return db.prepare('DELETE FROM account_tokens WHERE user_id = ?').run(id);
      });
    },
    deleteSession: (hash) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash),
    follows: userId => db.prepare(`SELECT key, hex, callsign, label, created_at AS addedAt FROM followed_flights
      WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`).all(userId),
    /** Pridá sledovaný let; existujúci kľúč len obnoví popis. false = plný zoznam. */
    addFollow(userId, item, now, max) {
      return transaction(() => {
        const exists = db.prepare('SELECT 1 FROM followed_flights WHERE user_id = ? AND key = ?').get(userId, item.key);
        if (!exists && db.prepare('SELECT COUNT(*) AS n FROM followed_flights WHERE user_id = ?').get(userId).n >= max) return false;
        db.prepare(`INSERT INTO followed_flights (user_id, key, hex, callsign, label, created_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, key) DO UPDATE SET hex = excluded.hex, callsign = excluded.callsign, label = excluded.label`)
          .run(userId, item.key, item.hex, item.callsign, item.label, now);
        return true;
      });
    },
    removeFollow: (userId, key) => db.prepare('DELETE FROM followed_flights WHERE user_id = ? AND key = ?').run(userId, key).changes,
    identity: (provider, subject) => db.prepare('SELECT * FROM oauth_identities WHERE provider = ? AND subject = ?').get(provider, subject),
    identities: userId => db.prepare(`SELECT provider, email, created_at AS createdAt FROM oauth_identities
      WHERE user_id = ? ORDER BY created_at, provider`).all(userId),
    /** Prepojí identitu s účtom; false = identita alebo poskytovateľ už je obsadený. */
    linkIdentity(userId, provider, subject, email, now) {
      const result = db.prepare(`INSERT INTO oauth_identities (provider, subject, user_id, email, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(provider, subject, userId, email, now);
      return result.changes > 0;
    },
    /**
     * Nový účet z overenej identity poskytovateľa: e-mail overený poskytovateľom, BEZ hesla
     * (hash '!oauth' neprejde verifyPassword — prihlásenie heslom je nemožné).
     */
    createOAuthUser(email, displayName, provider, subject, now) {
      return transaction(() => {
        const id = randomUUID();
        const created = db.prepare(`INSERT INTO users (id, email, display_name, password_hash, created_at, email_verified)
          VALUES (?, ?, ?, '!oauth', ?, 1) ON CONFLICT(email) DO NOTHING`).run(id, email, displayName, now);
        if (!created.changes) return null;
        db.prepare('INSERT INTO oauth_identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(provider, subject, id, email, now);
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      });
    },
    consume(key, limit, windowMs, now) {
      return transaction(() => {
        const old = db.prepare('SELECT count, expires_at FROM auth_limits WHERE key = ?').get(key);
        if (old && old.expires_at > now) {
          if (old.count >= limit) return Math.ceil((old.expires_at - now) / 1000);
          db.prepare('UPDATE auth_limits SET count = count + 1 WHERE key = ?').run(key);
        } else {
          if (!old && db.prepare('SELECT COUNT(*) AS n FROM auth_limits').get().n >= 10000) return 60;
          db.prepare(`INSERT INTO auth_limits VALUES (?, 1, ?) ON CONFLICT(key)
            DO UPDATE SET count = 1, expires_at = excluded.expires_at`).run(key, now + windowMs);
        }
        return 0;
      });
    },
    // ── Admin panel (2026-10-03) — volá ho iba /api/admin/* po kontrole roly owner. ──
    adminStats(now, idleMs) {
      const count = (sql, ...args) => db.prepare(sql).get(...args).n;
      return {
        users: count('SELECT COUNT(*) AS n FROM users'),
        disabled: count('SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NOT NULL'),
        verified: count('SELECT COUNT(*) AS n FROM users WHERE email_verified = 1'),
        new24h: count('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', now - 86400_000),
        new7d: count('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', now - 7 * 86400_000),
        activeSessions: count(`SELECT COUNT(*) AS n FROM sessions WHERE user_id IS NOT NULL
          AND expires_at > ? AND last_seen > ?`, now, now - idleMs),
        activeUsers: count(`SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE user_id IS NOT NULL
          AND expires_at > ? AND last_seen > ?`, now, now - idleMs),
        logins24h: count("SELECT COUNT(*) AS n FROM security_events WHERE type LIKE 'login%' AND created_at > ?", now - 86400_000),
        follows: count('SELECT COUNT(*) AS n FROM followed_flights'),
      };
    },
    adminUsers(query, limit, offset, now, idleMs) {
      const like = `%${String(query).replace(/[\\%_]/g, char => `\\${char}`)}%`;
      const where = "WHERE u.email LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).get(like, like).n;
      const users = db.prepare(`SELECT u.id, u.email, u.display_name AS displayName, u.role, u.created_at AS createdAt,
        u.last_login_at AS lastLoginAt, u.email_verified AS emailVerified, u.disabled_at AS disabledAt,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ? AND s.last_seen > ?) AS sessions,
        (SELECT group_concat(provider) FROM oauth_identities o WHERE o.user_id = u.id) AS providers
        FROM users u ${where} ORDER BY u.created_at DESC, u.rowid DESC LIMIT ? OFFSET ?`)
        .all(now, now - idleMs, like, like, limit, offset)
        .map(user => ({ ...user, emailVerified: Boolean(user.emailVerified), providers: user.providers ? user.providers.split(',') : [] }));
      return { total, users };
    },
    adminUser(id, now, idleMs) {
      const user = db.prepare(`SELECT id, email, display_name AS displayName, role, bio, created_at AS createdAt,
        last_login_at AS lastLoginAt, password_changed_at AS passwordChangedAt, email_verified AS emailVerified,
        disabled_at AS disabledAt, password_hash = '!oauth' AS oauthOnly FROM users WHERE id = ?`).get(id);
      if (!user) return null;
      const sessions = db.prepare(`SELECT label, created_at AS createdAt, last_seen AS lastSeen, expires_at AS expiresAt
        FROM sessions WHERE user_id = ? AND expires_at > ? AND last_seen > ? ORDER BY last_seen DESC`).all(id, now, now - idleMs);
      const events = db.prepare(`SELECT type, created_at AS createdAt FROM security_events WHERE user_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT 30`).all(id);
      const follows = db.prepare('SELECT COUNT(*) AS n FROM followed_flights WHERE user_id = ?').get(id).n;
      return { ...user, emailVerified: Boolean(user.emailVerified), oauthOnly: Boolean(user.oauthOnly),
        identities: this.identities(id), sessions, events, follows };
    },
    setDisabled(id, at) {
      return transaction(() => {
        const changed = db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(at, id).changes;
        if (changed && at) {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
          db.prepare('DELETE FROM account_token_deliveries WHERE user_id = ?').run(id);
          db.prepare('DELETE FROM account_tokens WHERE user_id = ?').run(id);
        }
        return changed;
      });
    },
    /** Zmaže účet; ON DELETE CASCADE odstráni relácie, fotku, tokeny, udalosti, lety, identity. */
    deleteUser: id => db.prepare('DELETE FROM users WHERE id = ?').run(id).changes,
    audit(actorId, action, targetId, detail, now) {
      db.prepare('INSERT INTO admin_audit (id, actor_id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), actorId, action, targetId, String(detail || '').slice(0, 200), now);
    },
    /** Konzistentná kópia DB (admin → Údržba). Cesta ide len zo servera, nie od klienta. */
    backupTo(file) { db.exec(`VACUUM INTO '${String(file).replaceAll("'", "''")}'`); },
    /** Registrácie a prihlásenia pre grafy účtov (časy; deň sa určí v miestnom čase). */
    accountActivity(from) {
      return {
        registrations: db.prepare('SELECT created_at AS at FROM users WHERE created_at >= ?').all(from).map(row => row.at),
        logins: db.prepare("SELECT created_at AS at FROM security_events WHERE created_at >= ? AND type LIKE 'login%'").all(from).map(row => row.at),
      };
    },
    auditLog: limit => db.prepare(`SELECT a.action, a.target_id AS targetId, a.detail, a.created_at AS createdAt,
      actor.email AS actorEmail FROM admin_audit a LEFT JOIN users actor ON actor.id = a.actor_id
      ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`).all(limit),
    prune(now, idleMs) {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen <= ?').run(now, now - idleMs);
      db.prepare('DELETE FROM auth_limits WHERE expires_at <= ?').run(now);
      db.prepare('DELETE FROM account_tokens WHERE expires_at <= ?').run(now);
      db.prepare('DELETE FROM account_token_deliveries WHERE expires_at <= ?').run(now);
      db.prepare('DELETE FROM security_events WHERE created_at <= ?').run(now - 90 * 86400_000);
    },
  };
}
