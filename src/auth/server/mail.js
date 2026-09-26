import { isIP } from 'node:net';
import { validEmail } from '../validation.js';

export const unavailableMailer = Object.freeze({ configured: false });

/** Configuration is server-owned. Only this exact HTTPS endpoint may receive mail;
 * redirects are forbidden, and no request field can choose its URL or sender. */
export function createWebhookMailer(env, { origins = [], fetchImpl = globalThis.fetch } = {}) {
  try {
    const endpoint = new URL(env.AUTH_MAIL_ENDPOINT);
    const publicUrl = new URL(env.AUTH_PUBLIC_URL);
    const publicHost = endpoint.hostname.replace(/^\[|\]$/g, '');
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash
      || isIP(publicHost) || !publicHost.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(publicHost)
      || publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password
      || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || !origins.includes(publicUrl.origin)
      || !validEmail(env.AUTH_MAIL_FROM) || !env.AUTH_MAIL_TOKEN || /[\s\u0000-\u001f\u007f]/u.test(env.AUTH_MAIL_TOKEN)) return unavailableMailer;
    const from = env.AUTH_MAIL_FROM.trim();
    const authorization = `Bearer ${env.AUTH_MAIL_TOKEN}`;
    return Object.freeze({
      configured: true,
      publicUrl: publicUrl.origin,
      async send({ to, subject, text }) {
        try {
          const response = await fetchImpl(endpoint.href, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, subject, text }),
          });
          await response.body?.cancel();
          if (!response.ok) throw new Error();
        } catch {
          // Never propagate provider bodies, headers, URLs, or token-bearing requests.
          throw new Error('mail_delivery_failed');
        }
      },
    });
  } catch { return unavailableMailer; }
}

export function accountMail(publicUrl, to, purpose, token) {
  const url = new URL('/account.html', publicUrl);
  url.hash = new URLSearchParams({ action: purpose, token }).toString();
  const title = { verify: 'Verify your OKO email', reset: 'Reset your OKO password', email: 'Confirm your new OKO email' }[purpose];
  const lifetime = purpose === 'verify' ? '24 hours' : '30 minutes';
  return { to, subject: title, text: `${title}\n\nOpen this link and explicitly confirm the action:\n${url.href}\n\nThis single-use link expires in ${lifetime}. If you did not request it, ignore this email.` };
}
