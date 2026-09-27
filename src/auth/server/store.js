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
        WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_seen > ?`).get(hash, now, now - idleMs);
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
    prune(now, idleMs) {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen <= ?').run(now, now - idleMs);
      db.prepare('DELETE FROM auth_limits WHERE expires_at <= ?').run(now);
      db.prepare('DELETE FROM account_tokens WHERE expires_at <= ?').run(now);
      db.prepare('DELETE FROM account_token_deliveries WHERE expires_at <= ?').run(now);
      db.prepare('DELETE FROM security_events WHERE created_at <= ?').run(now - 90 * 86400_000);
    },
  };
}
