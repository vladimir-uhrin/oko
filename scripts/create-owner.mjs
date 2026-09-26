// Local administrative bootstrap. No HTTP endpoint or default password.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, chmodSync } from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnv } from 'vite';
import { openAuthStore } from '../src/auth/server/store.js';
import { hashPassword } from '../src/auth/server/passwords.js';
import { normalizeEmail, validEmail, validName } from '../src/auth/validation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const email = normalizeEmail(process.argv[2] || '');
const displayName = (process.argv[3] || 'OKO Owner').trim();
if (!validEmail(email) || !validName(displayName) || process.argv.length > 4) {
  console.error('Usage: node scripts/create-owner.mjs <email> [displayName]');
  process.exitCode = 1;
} else {
  let store;
  try {
    const env = { ...loadEnv('development', root, ''), ...process.env };
    const filename = path.resolve(root, env.AUTH_DB_PATH || '.auth-data/accounts.sqlite');
    for (const directory of ['public', 'dist']) {
      const exposed = path.resolve(root, directory);
      if (filename === exposed || filename.startsWith(exposed + path.sep)) throw new Error('unsafe_database_path');
    }
    if (existsSync(filename)) {
      const source = new DatabaseSync(filename, { readOnly: true });
      try {
        const hasUsers = source.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
        if (hasUsers) {
          const hasRole = source.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'role');
          if (hasRole && source.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get()) throw new Error('owner_exists');
          if (source.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new Error('email_exists');
        }
        // Consistent SQLite backup includes committed WAL data, unlike copying the main file.
        const backupPath = path.join(path.dirname(filename), `before-owner-${Date.now()}-${randomUUID()}.sqlite`);
        await backup(source, backupPath);
        if (process.platform !== 'win32') chmodSync(backupPath, 0o600);
      } finally { source.close(); }
    }
    store = openAuthStore(filename);
    const password = randomBytes(24).toString('base64url');
    const user = store.createOwner(email, displayName, await hashPassword(password), Date.now());
    // Output once for the operator. Never write plaintext to a file, env, or client code.
    console.log(JSON.stringify({ email: user.email, password, role: user.role }, null, 2));
  } catch (error) {
    const known = ['owner_exists', 'email_exists', 'unsafe_database_path'];
    console.error(known.includes(error.message) ? error.message : 'Owner provisioning failed; no existing account was overwritten.');
    process.exitCode = 1;
  } finally { store?.close(); }
}
