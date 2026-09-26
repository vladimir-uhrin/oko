import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
// OWASP scrypt configuration: 128 MiB. Limit concurrent derivations below.
const OPTIONS = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 });
const PREFIX = 'scrypt$131072$8$1';
const DUMMY = `${PREFIX}$${'00'.repeat(16)}$${'00'.repeat(64)}`;
let active = 0;

async function withSlot(operation) {
  if (active >= 2) throw Object.assign(new Error('auth_busy'), { status: 503 });
  active++;
  try { return await operation(); } finally { active--; }
}

export function hashPassword(password) {
  return withSlot(async () => {
    const salt = randomBytes(16);
    const key = await derive(password, salt, 64, OPTIONS);
    return `${PREFIX}$${salt.toString('hex')}$${key.toString('hex')}`;
  });
}

export function verifyPassword(password, encoded) {
  return withSlot(async () => {
    const valid = typeof encoded === 'string' && /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded);
    const parts = (valid ? encoded : DUMMY).split('$');
    const key = await derive(password, Buffer.from(parts[4], 'hex'), 64, OPTIONS);
    const matches = timingSafeEqual(key, Buffer.from(parts[5], 'hex'));
    return valid && matches;
  });
}
