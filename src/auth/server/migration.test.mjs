import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openAuthStore } from './store.js';
import { fixture, credentials, newPassword, messageToken } from './account-test-helpers.mjs';

function temporary(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'oko-account-migration-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('oko-account-migration-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('v2 additive migration keeps owner/password/profile/session/limits and a consistent WAL backup', async t => {
  const directory = temporary(t), filename = path.join(directory, 'accounts.sqlite');
  const backupPath = path.join(directory, 'before-v3.sqlite');
  const original = new DatabaseSync(filename);
  original.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','owner')));
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    PRAGMA user_version = 2;
  `);
  original.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run('preserved-owner', 'owner@example.com', 'Original Name', 'original-password-hash', 100, 'owner');
  original.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run('preserved-member', 'member@example.com', 'Original Member', 'member-password-hash', 120, 'member');
  original.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('original-session-hash', 'preserved-owner', 150, 100000, 150);
  original.prepare('INSERT INTO auth_limits VALUES (?, ?, ?)').run('limit-key', 1, 100000);
  const users = original.prepare('SELECT * FROM users ORDER BY id').all();
  await backup(original, backupPath);
  original.close();
  let sessionId;
  for (let pass = 0; pass < 2; pass++) {
    const store = openAuthStore(filename);
    try {
      for (const previous of users) {
        const migrated = store.userById(previous.id);
        for (const [key, value] of Object.entries(previous)) assert.equal(migrated[key], value, key);
        assert.equal(migrated.email_verified, 0); assert.equal(migrated.credential_version, 0);
        assert.equal(migrated.password_changed_at, null); assert.equal(migrated.last_login_at, null);
        assert.equal(migrated.avatar, 'orbit'); assert.equal(migrated.avatar_color, 'cyan'); assert.equal(migrated.bio, '');
      }
      const session = store.findSession('original-session-hash', 200, 10000);
      assert.equal(session.user_id, 'preserved-owner'); assert.equal(session.role, 'owner');
      assert.match(session.session_id, /^[a-f0-9-]{36}$/);
      if (pass) assert.equal(session.session_id, sessionId); else sessionId = session.session_id;
      assert.ok(store.consume('limit-key', 1, 60000, 200));
    } finally { store.close(); }
  }
  const saved = new DatabaseSync(backupPath, { readOnly: true }), live = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(saved.prepare('PRAGMA user_version').get().user_version, 2);
    assert.deepEqual(saved.prepare('SELECT * FROM users ORDER BY id').all(), users);
    assert.equal(saved.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    assert.equal(live.prepare('PRAGMA user_version').get().user_version, 5);
    assert.equal(live.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { saved.close(); live.close(); }
});

test('unsupported future migrations fail without altering an existing account', t => {
  const directory = temporary(t), filename = path.join(directory, 'future.sqlite');
  let db = new DatabaseSync(filename);
  db.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('preserve'); PRAGMA user_version = 999;");
  db.close();
  assert.throws(() => openAuthStore(filename), /Unsupported/);
  db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 999);
    assert.equal(db.prepare('SELECT value FROM sentinel').get().value, 'preserve');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'users'").get().n, 0);
  } finally { db.close(); }
});

test('v3 to current migration preserves delivered links and owner credentials while adding pending delivery storage', t => {
  const directory = temporary(t), filename = path.join(directory, 'accounts.sqlite');
  let store = openAuthStore(filename);
  const user = store.createOwner('owner@example.com', 'Owner', 'existing-owner-hash', 100);
  store.issueToken('delivered-hash', user, 'verify', user.email, 100, 10000);
  store.close();
  const legacy = new DatabaseSync(filename);
  legacy.exec('DROP TABLE account_token_deliveries; DROP TABLE profile_photos; ALTER TABLE users DROP COLUMN photo_version; PRAGMA user_version = 3;');
  legacy.close();
  store = openAuthStore(filename);
  try {
    assert.deepEqual({ ...store.userById(user.id) }, { ...user });
    assert.equal(store.findToken('delivered-hash', 'verify', 200).user_id, user.id);
    store.prepareToken('pending-hash', user, 'verify', user.email, 200, 10000);
    assert.equal(store.findToken('pending-hash', 'verify', 201), undefined);
    assert.equal(store.findToken('delivered-hash', 'verify', 201).user_id, user.id);
    assert.equal(store.activateToken('pending-hash', 202), true);
    assert.equal(store.findToken('delivered-hash', 'verify', 203), undefined);
    assert.equal(store.findToken('pending-hash', 'verify', 203).user_id, user.id);
  } finally { store.close(); }
});

test('v4 avatar migration preserves account/session data; photo bytes and version survive reopen', t => {
  const directory = temporary(t), filename = path.join(directory, 'avatar.sqlite');
  let store = openAuthStore(filename);
  const user = store.createOwner('owner@example.com', 'Owner', 'existing-hash', 100);
  store.rotateSession(null, 'session-hash', user.id, 100, 10000); store.close();
  const legacy = new DatabaseSync(filename);
  legacy.exec('DROP TABLE profile_photos; ALTER TABLE users DROP COLUMN photo_version; PRAGMA user_version = 4;'); legacy.close();
  store = openAuthStore(filename);
  assert.deepEqual({ ...store.userById(user.id) }, { ...user });
  assert.equal(store.findSession('session-hash', 200, 10000).user_id, user.id);
  const updated = store.setPhoto(user.id, Buffer.from('encoded-raster-fixture'), 200); store.close();
  store = openAuthStore(filename);
  try {
    assert.equal(store.userById(user.id).photo_version, updated.photo_version);
    assert.equal(Buffer.from(store.photo(user.id)).toString(), 'encoded-raster-fixture');
    assert.equal(store.userById(user.id).password_hash, 'existing-hash');
    assert.equal(store.userById(user.id).role, 'owner');
  } finally { store.close(); }
});

test('persistent action tokens contain only hashes, survive reopen and remain single-use', async t => {
  const directory = temporary(t), filename = path.join(directory, 'accounts.sqlite');
  let store = openAuthStore(filename);
  const time = Date.now();
  const user = store.createUser('member@example.com', 'Member', 'password-hash', time);
  const token = 'one-time-plaintext-should-never-be-stored';
  const hash = createHash('sha256').update(`account-action:${token}`).digest('hex');
  store.issueToken(hash, user, 'reset', user.email, time, 60000);
  store.close();
  assert.equal(readFileSync(filename).includes(Buffer.from(token)), false);
  store = openAuthStore(filename);
  try {
    assert.equal(store.findToken(hash, 'reset', time + 1).user_id, user.id);
    assert.equal(store.findToken(hash, 'verify', time + 1), undefined);
    store.transaction(() => { assert.equal(store.deleteToken(hash).changes, 1); });
    assert.equal(store.findToken(hash, 'reset', time + 2), undefined);
  } finally { store.close(); }
});

test('failed session rotation rolls back password, credential version, revocations and events together', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.register(); await b.login();
  await a.post('/api/account/email/verification');
  const token = messageToken(f.messages[0]).token;
  const previous = { ...f.store.userByEmail(credentials.email) };
  const cookie = a.cookie;
  const rotate = f.store.rotateSession;
  f.store.rotateSession = () => { throw new Error('forced disk failure'); };
  const result = await a.post('/api/account/password', { currentPassword: credentials.password, newPassword });
  f.store.rotateSession = rotate;
  assert.equal(result.status, 500); assert.deepEqual(result.data, { error: 'server_error' });
  assert.equal(a.cookie, cookie);
  assert.deepEqual({ ...f.store.userByEmail(credentials.email) }, previous);
  assert.equal((await b.request('/api/account')).status, 200);
  assert.equal((await a.post('/api/auth/email/verify', { token })).status, 200);
  assert.equal((await a.request('/api/account/security')).data.events.some(e => e.type === 'password_changed'), false);
});
