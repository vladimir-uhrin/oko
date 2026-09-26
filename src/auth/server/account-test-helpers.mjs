import http from 'node:http';
import { openAuthStore } from './store.js';
import { createAuthService } from './http.js';

export const credentials = { email: 'member@example.com', password: 'the original password phrase', displayName: 'Test Member' };
export const newPassword = 'the replacement password phrase';
export const fastPasswords = { hash: async value => `test:${value}`, verify: async (value, hash) => hash === `test:${value}` };

export async function fixture(t, options = {}) {
  const store = options.store || openAuthStore(':memory:');
  const clock = { time: Date.now() };
  const messages = [];
  const mailer = { configured: true, publicUrl: 'https://oko.example', send: async message => { messages.push(message); } };
  const service = createAuthService({ store, passwords: fastPasswords, now: () => clock.time, mailer, ...options });
  const server = http.createServer((req, res) => {
    void service.middleware(req, res, () => { res.end('public'); });
  });
  // Windows may assign a Fetch-forbidden port (e.g. 6667) for port 0.
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      const port = server.address().port;
      if (port >= 10081 || ![1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080].includes(port)) break;
      await new Promise(resolve => server.close(resolve));
      if (attempt >= 9) throw new Error('Cannot allocate a Fetch-safe fixture port');
    } catch (error) { if (error.code !== 'EADDRINUSE' || attempt >= 9) throw error; }
  }
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); await service.close();
    if (!options.store) store.close();
  });
  function client(userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 secret-UA-value') {
    let cookie = '', csrf = '';
    async function request(route, { method = 'GET', body, headers = {}, update = true } = {}) {
      const response = await fetch(base + route, { method, headers: {
        Cookie: cookie, Origin: base, 'User-Agent': userAgent,
        ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...headers,
      }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      if (update && response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      if (update && Object.hasOwn(data, 'csrfToken')) csrf = data.csrfToken || '';
      return { status: response.status, data, headers: response.headers, text };
    }
    return { request, get cookie() { return cookie; }, get csrf() { return csrf; },
      bootstrap: () => request('/api/auth/csrf'),
      post: (route, body = {}, extras = {}) => request(route, { method: 'POST', body, ...extras }),
      async register(input = credentials) { await this.bootstrap(); return this.post('/api/auth/register', input); },
      async login(input = credentials) { await this.bootstrap(); return this.post('/api/auth/login', input); },
    };
  }
  return { store, clock, messages, mailer, client, base, drainMail: service.close };
}

export function messageToken(message) {
  const link = new URL(message.text.match(/https:\/\/\S+/)[0]);
  return { link, params: new URLSearchParams(link.hash.slice(1)), token: new URLSearchParams(link.hash.slice(1)).get('token') };
}

export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
