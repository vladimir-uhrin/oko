// Shared by the browser and server. Passwords are never trimmed or normalized.
export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;
export const BIO_MAX = 280;
export const AVATARS = Object.freeze(['orbit', 'radar', 'globe', 'satellite', 'map', 'compass']);
export const AVATAR_COLORS = Object.freeze(['cyan', 'green', 'amber', 'violet']);

export function validPassword(value) {
  return typeof value === 'string' && [...value].length >= PASSWORD_MIN && [...value].length <= PASSWORD_MAX;
}

export function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length
    || Object.keys(body).some(key => !['displayName', 'bio', 'avatar', 'avatarColor'].includes(key))) return 'invalid_input';
  if ('displayName' in body && !validName(body.displayName)) return 'invalid_name';
  if ('bio' in body && (typeof body.bio !== 'string' || [...body.bio].length > BIO_MAX
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(body.bio))) return 'invalid_bio';
  if ('avatar' in body && !AVATARS.includes(body.avatar)) return 'invalid_avatar';
  if ('avatarColor' in body && !AVATAR_COLORS.includes(body.avatarColor)) return 'invalid_avatar_color';
  return null;
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validEmail(value) {
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(email)) return false;
  const [local, domain] = email.split('@');
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
    && domain.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

export function validName(value) {
  return typeof value === 'string' && [...value.trim()].length >= 2 && [...value.trim()].length <= 80
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export function validateCredentials(body, register = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid_input';
  if (!validEmail(body.email)) return 'invalid_email';
  if (typeof body.password !== 'string' || [...body.password].length > PASSWORD_MAX
    || [...body.password].length < (register ? PASSWORD_MIN : 1)) return 'invalid_password';
  if (register && !validName(body.displayName)) return 'invalid_name';
  return null;
}
