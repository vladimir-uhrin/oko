// Offline browser acceptance: real account UI, HTTP handlers, SQLite and scrypt.
// No project config/.env, main.js, Cesium, live/paid services or real .auth-data.
// Node 24+: node scripts/qa-auth.mjs --headless-shell
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { authPlugin } from '../src/auth/server/plugin.js';
import { openAuthStore } from '../src/auth/server/store.js';
import { hashPassword, verifyPassword } from '../src/auth/server/passwords.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'output/auth-qa');
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, 'run-'));
const runtime = path.join(run, 'runtime');
await mkdir(runtime);
const database = path.join(runtime, 'accounts.sqlite');
assert.ok(database.startsWith(path.join(output, 'run-')) && !database.includes('.auth-data'));
const report = { fixture: 'offline; real toolbar markup/CSS; mode classes only; no globe engine', checks: [], screenshots: [], errors: [], cspErrors: [], tokenLeaks: [], blockedRequests: [] };
const credentials = { email: 'browser@oko.test', password: 'isolated browser test passphrase', displayName: 'Vlado OKO' };
const newPassword = 'changed isolated browser passphrase';
const recoveryToken = 'offline-invalid-recovery-token';
const owner = { email: 'owner-fixture@oko.test', password: 'isolated owner test passphrase' };
const index = await readFile(path.join(root, 'index.html'), 'utf8');
const toolbar = index.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/)?.[0];
assert.ok(toolbar, 'real globe toolbar must be present');
// The fourth button is added by main.js. Read its markup, never import main.js.
const main = await readFile(path.join(root, 'src/main.js'), 'utf8');
assert.ok(main.includes("cmdLaunch.id = 'cmd-launch'"), 'update fixture if command button changes');
const commandIcon = main.match(/cmdLaunch\.innerHTML = '([^']+)'/)?.[1];
assert.ok(commandIcon);
const toolbarWithCommand = toolbar.includes('id="cmd-launch"') ? toolbar : toolbar.replace('</nav>',
  `<button id="cmd-launch" type="button" aria-label="Search commands">${commandIcon}</button></nav>`);
const html = `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/logo.svg"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/src/auth/panel.css"></head>
<body>${toolbarWithCommand}<script type="module">import { initAuthPanel } from '/src/auth/panel.js'; window.account = initAuthPanel();
window.backgroundEscapes = 0; document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { window.backgroundEscapes++; event.preventDefault(); event.stopImmediatePropagation(); }
}, true);</script></body></html>`;
const allowedPath = pathname => ['/__auth_qa', '/@id/__x00__/__auth_qa', '/account.html', '/style.css', '/logo.svg', '/@vite/client', '/@vite/env'].includes(pathname)
  || /^\/src\/auth\/(?!server\/)[\w.-]+\.(js|css)$/.test(pathname)
  || /^\/src\/i18n(?:Strings)?\.js$/.test(pathname)
  || pathname === '/node_modules/vite/dist/client/env.mjs'
  || /^\/api\/(auth|account)(\/|$)/.test(pathname);
const fixture = { name: 'offline-account-fixture', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.url.includes(recoveryToken) || (req.headers.referer || '').includes(recoveryToken)) {
      report.tokenLeaks.push({ path: pathname, type: 'server-received' });
    }
    if (!allowedPath(pathname)) { res.statusCode = 403; res.end('Outside offline account fixture'); return; }
    if (pathname !== '/__auth_qa') return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self';");
    res.end(await server.transformIndexHtml('/__auth_qa', html));
  });
} };
let server, browser, p;
let currentFeature = 'fixture startup';
const progress = message => console.log(`[auth-qa] ${message}`);
async function screenshot(page, name) {
  const filename = path.join(run, `${name}.png`);
  await page.screenshot({ path: filename }); report.screenshots.push(filename);
}
async function feature(name, operation, { continueOnFailure = false, evidencePage = p } = {}) {
  currentFeature = name; progress(`START ${name}`);
  try { await operation(); report.checks.push({ name, passed: true }); progress(`PASS ${name}`); }
  catch (error) {
    report.checks.push({ name, passed: false, error: error.message }); progress(`FAIL ${name}: ${error.message}`);
    if (evidencePage && !evidencePage.isClosed()) await screenshot(evidencePage, `failure-${report.checks.length}`).catch(() => {});
    if (!continueOnFailure) throw error;
  }
}
const stateReady = page => page.waitForFunction(() => {
  const s = window.account?.client.getState();
  return s && ['guest', 'authenticated'].includes(s.status) && !s.busy && s.securityStatus !== 'loading';
});
async function fill(page, selector, value) {
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(selector, (input, text) => {
    input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function submit(page, selector, pathname, status = 200, method = 'POST') {
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === pathname && r.request().method() === method), page.click(selector),
  ]);
  // Chromium can evict a PUT response as image GETs for the same resource start.
  // In that case verify the actual application's settled state, not CDP's cache.
  let data;
  if (pathname === '/api/account/photo') { await stateReady(page); data = { user: await page.evaluate(() => window.account.client.getState().user) }; }
  else data = await response.json();
  assert.equal(response.status(), status, `${pathname}: ${JSON.stringify(data)}`);
  await stateReady(page); return data;
}
async function open(page, section = 'overview') {
  if (!await page.$eval('#account-dialog', d => d.open)) {
    // 2026-09-26: the launcher hides with the globe actions (clean view, cockpit, KARTA export) —
    // there the centre opens through the exposed API, as a keyboard shortcut or the account page would.
    if (await page.$eval('#account-btn', b => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden')) {
      await page.click('#account-btn');
      // A signed-in click opens the account menu; a menu item opens the centre.
      if (await page.$('#account-menu:not([hidden])')) await page.click(`#account-menu [data-page="${section}"]`);
    } else await page.evaluate(section => window.account.open(section), section);
  }
  await stateReady(page);
}
async function navigate(page, section) {
  await page.click(`#auth-nav-${section}`);
  await page.waitForSelector(`#auth-page-${section}:not([hidden])`, { visible: true });
  await stateReady(page);
  assert.equal(await page.$eval(`#auth-nav-${section}`, n => n.getAttribute('aria-current')), 'page');
}
async function login(page, password = credentials.password, email = credentials.email, status = 200) {
  await open(page); await page.click('.auth-tabs button:first-child');
  await fill(page, '#auth-email', email); await fill(page, '#auth-password', password);
  const result = await submit(page, '.auth-credentials .auth-primary', '/api/auth/login', status);
  await page.waitForFunction(() => document.querySelector('#auth-password').value === ''); return result;
}
const accountStatus = page => page.evaluate(async () => (await fetch('/api/account')).status);
async function bounds(page, label) {
  const m = await page.evaluate(() => {
    const d = document.querySelector('#account-dialog'), r = d.getBoundingClientRect();
    const overflowing = [...d.querySelectorAll('.auth-shell, .auth-content, .auth-page, .auth-card, form, fieldset')]
      .filter(n => n.getClientRects().length && n.scrollWidth > n.clientWidth + 1)
      .map(n => ({ element: n.id || n.className, width: n.clientWidth, scroll: n.scrollWidth }));
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, left: r.left, right: r.right,
      width: d.clientWidth, scroll: d.scrollWidth, overflowing };
  });
  assert.ok(m.documentWidth <= m.viewport + 1 && m.left >= 0 && m.right <= m.viewport + 1
    && m.scroll <= m.width + 1 && !m.overflowing.length, `${label}: ${JSON.stringify(m)}`);
}
async function launcher(page, authenticated, name) {
  const data = await page.$eval('#account-btn', button => {
    const r = button.getBoundingClientRect(), style = getComputedStyle(button);
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const toolbar = document.querySelector('#top-center-actions'), t = toolbar.getBoundingClientRect();
    const visibleToolbar = getComputedStyle(toolbar).visibility !== 'hidden' && toolbar.getClientRects().length > 0;
    // 2026-09-26: the launcher is the last circle INSIDE the globe-actions group, so
    // „overlap" means overlapping a sibling button; with the chrome hidden (clean view,
    // cockpit, KARTA export, recording) the launcher hides with it by design.
    const inToolbar = toolbar.contains(button);
    const boxes = inToolbar ? [...toolbar.querySelectorAll('button')].filter(b => b !== button).map(b => b.getBoundingClientRect()) : (visibleToolbar ? [t] : []);
    const collides = box => Math.min(r.right, box.right) - Math.max(r.left, box.left) > 1 && Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top) > 1;
    return { parent: button.parentElement.id, authenticated: button.dataset.authenticated,
      name: button.querySelector('strong').textContent, state: button.querySelector('small').textContent,
      visible: style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0 && button.getClientRects().length > 0,
      rendered: button.getClientRects().length > 0, inToolbar, chromeHidden: inToolbar && !visibleToolbar,
      reachable: hit === button || button.contains(hit), left: r.left, right: r.right, bottom: r.bottom,
      overlap: boxes.some(collides),
      viewport: innerWidth, height: innerHeight };
  });
  assert.equal(data.parent, 'account-actions'); assert.equal(data.authenticated, String(authenticated)); assert.equal(data.name, name);
  assert.match(data.state, authenticated ? /Prihlásený/ : /Neprihlásený|Hosť/);
  if (data.chromeHidden) { assert.ok(!data.visible && !data.reachable, `Launcher should hide with the globe actions: ${JSON.stringify(data)}`); return; }
  assert.ok(data.visible && data.reachable && data.left >= 0 && data.right <= data.viewport && data.bottom <= data.height && !data.overlap,
    `Launcher visibility/toolbar collision: ${JSON.stringify(data)}`);
}
async function viewportChecks(page, authenticated) {
  if (await page.$eval('#account-dialog', d => d.open)) await page.click('.auth-close');
  for (const width of [1280, 390, 320]) {
    await page.setViewport({ width, height: width === 1280 ? 900 : 844, isMobile: width < 700, hasTouch: width < 700 });
    await stateReady(page);
    for (const mode of ['', 'cockpit-mode', 'ui-clean-view', 'oko-karta-clean']) {
      await page.evaluate(({ width, mode }) => { document.body.className = [width < 700 ? 'oko-mobile' : '', mode].filter(Boolean).join(' '); }, { width, mode });
      await feature(`${authenticated ? 'signed-in' : 'guest'} launcher ${width} ${mode || 'normal'}`, async () => {
        await screenshot(page, `launcher-${authenticated ? 'member' : 'guest'}-${width}-${mode || 'normal'}`);
        await launcher(page, authenticated, authenticated ? credentials.displayName : 'Prihlásiť sa');
        await open(page); await page.waitForSelector('.auth-close', { visible: true }); await bounds(page, `dialog ${width} ${mode}`);
      }, { continueOnFailure: true });
      if (await page.$eval('#account-dialog', d => d.open)) await page.click('.auth-close');
    }
    await page.evaluate(width => { document.body.className = width < 700 ? 'oko-mobile' : ''; }, width); await open(page);
    for (const section of authenticated ? ['overview', 'profile', 'security', 'devices', 'activity'] : ['login', 'register']) {
      await feature(`${authenticated ? 'account' : 'credentials'} ${section} ${width} no overflow`, async () => {
        if (authenticated) await navigate(page, section);
        else await page.click(`.auth-tabs button:${section === 'login' ? 'first' : 'last'}-child`);
        await page.$eval('#account-dialog', d => { d.scrollTop = 0; }); await screenshot(page, `${section}-${width}`);
        await bounds(page, `${section} ${width}`);
      }, { continueOnFailure: true });
    }
    await page.click('.auth-close');
  }
  await page.setViewport({ width: 1280, height: 900 }); await stateReady(page);
  await page.evaluate(() => { document.body.className = ''; });
}

try {
  progress(`Artifacts: ${run}`);
  // The explicit env object cannot inherit any real webhook, keys or DB path.
  server = await createServer({ root, configFile: false, envFile: false, cacheDir: path.join(runtime, 'vite'),
    plugins: [fixture, authPlugin({ AUTH_DB_PATH: database })],
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
  const store = openAuthStore(database);
  try { store.createOwner(owner.email, 'Test Owner', await hashPassword(owner.password), Date.now()); } finally { store.close(); }
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  report.origin = origin; progress(`Isolated fixture: ${origin}`);
  await feature('HTTP fixture readiness and no-mail capabilities', async () => {
    const deadline = Date.now() + 20000; let response, data;
    do {
      response = await fetch(origin + '/api/auth/session'); data = await response.json();
      if (response.ok && data.capabilities?.sessionManagement) break;
      await delay(500);
    } while (Date.now() < deadline);
    assert.equal(response.status, 200); assert.equal(data.user, null);
    for (const key of ['mailConfigured', 'emailVerification', 'passwordReset', 'emailChange']) assert.equal(data.capabilities?.[key], false, key);
    for (const key of ['sessionManagement', 'passwordChange', 'accountExport']) assert.equal(data.capabilities?.[key], true, key);
  });
  browser = await puppeteer.launch({ headless: process.argv.includes('--headless-shell') ? 'shell' : true, pipe: true,
    timeout: 30000, protocolTimeout: 30000,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run'] });
  async function page(context, pathname = '/__auth_qa') {
    const result = await context.newPage(); result.setDefaultTimeout(12000);
    const fragmentToken = new URLSearchParams(new URL(pathname, origin).hash.slice(1)).get('token');
    result.on('pageerror', error => report.errors.push(error.message));
    result.on('console', message => {
      if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) report.cspErrors.push(message.text());
    });
    result.on('dialog', dialog => { report.errors.push(`Unexpected browser dialog: ${dialog.type()}`); void dialog.dismiss(); });
    await result.setRequestInterception(true);
    result.on('request', request => {
      const url = new URL(request.url());
      // CDP includes the navigation fragment in request.url(), although HTTP
      // never transmits it. Check the wire URL and actual server requests.
      if (fragmentToken && ((url.origin + url.pathname + url.search).includes(fragmentToken) || (request.headers().referer || '').includes(fragmentToken))) {
        report.tokenLeaks.push({ path: url.pathname, type: request.resourceType() });
      }
      if (['blob:', 'data:'].includes(url.protocol)) { void request.continue(); return; }
      if (url.origin === origin && allowedPath(url.pathname)) void request.continue();
      else { report.blockedRequests.push(url.origin + url.pathname); void request.abort(); }
    });
    await result.evaluateOnNewDocument(() => { localStorage.setItem('oko-lang', 'sk'); window.__authQaXss = 0; });
    await result.setViewport({ width: 1280, height: 900 });
    await result.goto(origin + pathname, { waitUntil: 'networkidle0' });
    if (pathname.startsWith('/__auth_qa')) await stateReady(result); return result;
  }
  const context = await browser.createBrowserContext(); p = await page(context);
  await feature('public startup and real four-button toolbar', async () => {
    assert.equal(await p.$eval('#account-dialog', d => d.open), false);
    assert.deepEqual(await p.$$eval('#top-center-actions > button', nodes => nodes.map(n => n.id)),
      ['clear-selected-layers', 'share-btn', 'reset-globe-view', 'cmd-launch']);
  });
  await viewportChecks(p, false);
  await feature('registration, confirmation validation and overview landing', async () => {
    await open(p); await p.click('.auth-tabs button:last-child');
    await fill(p, '#auth-name', credentials.displayName); await fill(p, '#auth-email', credentials.email);
    await fill(p, '#auth-password', credentials.password); await fill(p, '#auth-confirm', 'different password');
    await p.click('.auth-credentials .auth-primary'); assert.match(await p.$eval('#auth-status', n => n.textContent), /nezhodujú/);
    await fill(p, '#auth-confirm', credentials.password); await submit(p, '.auth-credentials .auth-primary', '/api/auth/register', 201);
    assert.equal(await p.$eval('#auth-nav-overview', n => n.getAttribute('aria-current')), 'page');
    assert.equal(await p.$eval('.auth-mini-identity strong', n => n.textContent), credentials.displayName);
    assert.equal(await p.$eval('.auth-owner-badge', n => n.hidden), true);
    await p.waitForFunction(() => document.querySelector('#auth-password').value === '');
    assert.equal(await p.evaluate(() => document.cookie.includes('oko_session')), false);
    assert.equal((await p.cookies()).find(cookie => cookie.name === 'oko_session')?.httpOnly, true);
    assert.equal(await p.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].some(key => /token|session|password/i.test(key))), false);
    await screenshot(p, 'registered-overview');
  });
  // 2026-09-26: signed-in launcher → compact account menu (not the whole modal).
  await feature('account menu: launcher opens a menu, arrows/Escape work, an item opens the centre on its page', async () => {
    if (await p.$eval('#account-dialog', d => d.open)) await p.click('.auth-close');
    await p.click('#account-btn'); await p.waitForSelector('#account-menu:not([hidden])', { visible: true });
    assert.equal(await p.$eval('#account-btn', b => b.getAttribute('aria-expanded')), 'true');
    assert.equal(await p.$eval('#account-dialog', d => d.open), false, 'menu instead of the modal');
    assert.deepEqual(await p.$$eval('#account-menu [role=menuitem]', nodes => nodes.map(n => n.dataset.page || 'logout')), ['overview', 'profile', 'security', 'devices', 'activity', 'logout']);
    assert.equal(await p.$eval('.auth-menu-head strong', n => n.textContent), credentials.displayName);
    assert.equal(await p.evaluate(() => document.activeElement?.dataset.page), 'overview', 'focus lands on the first item');
    await p.keyboard.press('ArrowDown'); assert.equal(await p.evaluate(() => document.activeElement?.dataset.page), 'profile');
    await p.keyboard.press('Escape');
    assert.equal(await p.$eval('#account-menu', m => m.hidden), true); assert.equal(await p.evaluate(() => document.activeElement.id), 'account-btn');
    await screenshot(p, 'account-menu-closed');
    await p.click('#account-btn'); await screenshot(p, 'account-menu-open'); await p.click('#account-menu [data-page="security"]');
    await p.waitForSelector('#auth-page-security:not([hidden])', { visible: true }); await stateReady(p);
    assert.equal(await p.$eval('#account-menu', m => m.hidden), true);
    assert.equal(await p.$eval('#auth-nav-security', n => n.getAttribute('aria-current')), 'page');
    await p.click('.auth-close');
  });
  await feature('guest sign-in polish: inline field error, Caps Lock hint element, strength meter only for registration', async () => {
    await open(p); await submit(p, '.auth-logout', '/api/auth/logout');
    await p.waitForSelector('.auth-tabs', { visible: true }); await p.click('.auth-tabs button:first-child');
    assert.equal(await p.$eval('.auth-credentials .auth-strength', n => n.hidden), true, 'no meter on sign-in');
    await fill(p, '#auth-email', 'nie-je-email'); await p.click('.auth-credentials .auth-primary');
    assert.equal(await p.$eval('#auth-email', n => n.getAttribute('aria-invalid')), 'true');
    assert.match(await p.$eval('#auth-email-error', n => n.textContent), /e-mail/i);
    await fill(p, '#auth-email', credentials.email); assert.equal(await p.$eval('#auth-email-error', n => n.hidden), true, 'typing clears the inline error');
    await p.click('.auth-tabs button:last-child');
    assert.equal(await p.$eval('.auth-credentials .auth-strength', n => n.hidden), false, 'meter on registration');
    await fill(p, '#auth-password', 'kratke'); assert.equal(await p.$eval('.auth-credentials .auth-strength', n => n.dataset.score), '0');
    await fill(p, '#auth-password', 'modra lampa svieti v noci nad riekou'); assert.equal(await p.$eval('.auth-credentials .auth-strength', n => n.dataset.score), '4');
    assert.equal(await p.$eval('.auth-caps', n => n.hidden), true);
    await screenshot(p, 'register-strength');
    await p.click('.auth-close');
    await login(p);
  });
  await feature('profile name, bio and avatar persistence; literal XSS content', async () => {
    const injection = '<img src=x onerror=window.__authQaXss=1>', bio = '<svg onload=window.__authQaXss=2></svg> Výskum sveta 🔭';
    await navigate(p, 'profile'); await fill(p, '#auth-profile-name', injection); await fill(p, '#auth-bio', bio);
    await p.click('[data-avatar="satellite"]'); await p.click('.auth-color-choices [data-color="violet"]');
    const saved = await submit(p, '.auth-profile-form .auth-primary', '/api/account', 200, 'PATCH');
    assert.equal(saved.user.bio, bio); assert.equal(saved.user.avatar, 'satellite'); assert.equal(saved.user.avatarColor, 'violet');
    await p.reload({ waitUntil: 'networkidle0' }); await stateReady(p); await open(p);
    assert.equal(await p.$eval('#auth-nav-overview', n => n.getAttribute('aria-current')), 'page');
    assert.equal(await p.$eval('.auth-mini-identity strong', n => n.textContent), injection);
    assert.equal(await p.$('.auth-mini-identity img'), null); assert.equal(await p.$('.auth-overview-hero img'), null);
    assert.equal(await p.$eval('.auth-launcher-copy strong', n => n.textContent), injection);
    await navigate(p, 'profile'); assert.equal(await p.$eval('#auth-bio', n => n.value), bio);
    assert.equal(await p.$eval('[data-avatar="satellite"]', n => n.getAttribute('aria-pressed')), 'true');
    assert.equal(await p.$eval('.auth-color-choices [data-color="violet"]', n => n.getAttribute('aria-pressed')), 'true');
    assert.equal(await p.evaluate(() => window.__authQaXss), 0); assert.equal(await p.$('.auth-profile-form svg'), null);
    await screenshot(p, 'profile-xss-literal');
    await fill(p, '#auth-profile-name', credentials.displayName); await fill(p, '#auth-bio', 'Skúmam svet s OKO. 🔭');
    await submit(p, '.auth-profile-form .auth-primary', '/api/account', 200, 'PATCH');
  });
  const photoFile = path.join(runtime, 'avatar.png');
  await sharp({ create: { width: 480, height: 320, channels: 3, background: '#10baca' } }).png().toFile(photoFile);
  await feature('avatar local preview, upload, persistence and visible identity', async () => {
    await navigate(p, 'profile'); await (await p.$('#auth-photo-file')).uploadFile(photoFile);
    await p.waitForFunction(() => !document.querySelector('#auth-photo-save').disabled);
    assert.equal(await p.evaluate(() => window.account.client.getState().user.photoVersion), null, 'preview is not persisted');
    assert.match(await p.$eval('.auth-photo-preview img', n => n.src), /^blob:/);
    const saved = await submit(p, '#auth-photo-save', '/api/account/photo', 200, 'PUT'); assert.ok(saved.user.photoVersion);
    await p.waitForFunction(() => [...document.querySelectorAll('.auth-mini-identity img, .auth-launcher-avatar img, .auth-photo-preview img')].every(i => i.complete && i.naturalWidth === 256));
    await screenshot(p, 'profile-photo-desktop');
    await p.reload({ waitUntil: 'networkidle0' }); await stateReady(p); await open(p); await navigate(p, 'profile');
    assert.equal(await p.evaluate(() => window.account.client.getState().user.photoVersion), saved.user.photoVersion);
    assert.ok(await p.$('.auth-launcher-avatar img'));
    await p.setViewport({ width: 320, height: 844 }); await bounds(p, 'avatar editor 320'); await screenshot(p, 'profile-photo-mobile');
    await p.setViewport({ width: 1280, height: 900 });
  });
  await feature('avatar invalid upload preserves photo; cancelled preview and removal restore symbol', async () => {
    const invalidFile = path.join(runtime, 'invalid.png'); await writeFile(invalidFile, 'not an image');
    const version = await p.evaluate(() => window.account.client.getState().user.photoVersion);
    await (await p.$('#auth-photo-file')).uploadFile(invalidFile);
    await p.waitForFunction(() => document.querySelector('#auth-status').dataset.kind === 'error');
    assert.equal(await p.evaluate(() => window.account.client.getState().user.photoVersion), version);
    await (await p.$('#auth-photo-file')).uploadFile(photoFile); await p.waitForFunction(() => !document.querySelector('#auth-photo-save').disabled);
    await navigate(p, 'overview'); await navigate(p, 'profile'); assert.equal(await p.$eval('#auth-photo-save', n => n.hidden), true);
    await submit(p, '#auth-photo-remove', '/api/account/photo', 200, 'DELETE');
    assert.equal(await p.$('.auth-launcher-avatar img'), null); assert.equal(await p.$('.auth-mini-identity img'), null);
    assert.equal(await p.$eval('.auth-launcher-avatar', n => n.textContent), '✦');
  });
  await feature('standalone CSP permits local photo preview and authenticated avatar upload', async () => {
    await p.goto(origin + '/account.html', { waitUntil: 'networkidle0' });
    await p.waitForSelector('#auth-nav-profile', { visible: true }); await p.click('#auth-nav-profile');
    await (await p.$('#auth-photo-file')).uploadFile(photoFile);
    await p.waitForFunction(() => !document.querySelector('#auth-photo-save').disabled);
    const response = p.waitForResponse(r => new URL(r.url()).pathname === '/api/account/photo' && r.request().method() === 'PUT');
    await p.click('#auth-photo-save'); assert.equal((await response).status(), 200);
    await p.waitForFunction(() => document.querySelector('.auth-launcher-avatar img')?.naturalWidth === 256);
    await screenshot(p, 'standalone-profile-photo');
    const removed = p.waitForResponse(r => new URL(r.url()).pathname === '/api/account/photo' && r.request().method() === 'DELETE');
    await p.click('#auth-photo-remove'); assert.equal((await removed).status(), 200);
    await p.goto(origin + '/__auth_qa', { waitUntil: 'networkidle0' }); await stateReady(p); await open(p);
  });
  const secondContext = await browser.createBrowserContext(), second = await page(secondContext);
  await feature('independent browser session login and device listing', async () => {
    assert.equal(await second.evaluate(() => window.account.client.getState().status), 'guest'); await login(second);
    const cookie = async page => (await page.cookies()).find(c => c.name === 'oko_session')?.value;
    assert.notEqual(await cookie(p), await cookie(second), 'independent cookies');
    await navigate(p, 'devices'); assert.equal(await p.$$eval('.auth-session', rows => rows.length), 2);
    assert.equal(await p.$$eval('.auth-session .auth-tag', rows => rows.length), 1);
    assert.equal(await p.$$eval('.auth-session-revoke', rows => rows.length), 1); await screenshot(p, 'two-independent-sessions');
  });
  await feature('wrong current password rejected, valid change revokes second session', async () => {
    await navigate(p, 'security');
    async function change(current, expected) {
      await fill(p, '#auth-current-password', current); await fill(p, '#auth-new-password', newPassword); await fill(p, '#auth-new-confirm', newPassword);
      const result = await submit(p, '.auth-password-form .auth-primary', '/api/account/password', expected);
      await p.waitForFunction(() => [...document.querySelectorAll('.auth-password-form [data-secret]')].every(n => n.value === '')); return result;
    }
    const wrong = await change('incorrect current passphrase', 401); assert.equal(wrong.error, 'invalid_current_password');
    assert.equal(await p.$eval('#auth-status', n => n.dataset.kind), 'error'); assert.equal(await accountStatus(second), 200);
    await screenshot(p, 'password-rejected'); const changed = await change(credentials.password, 200);
    assert.ok(changed.user.passwordChangedAt); assert.equal(await accountStatus(p), 200); assert.equal(await accountStatus(second), 401);
    await second.reload({ waitUntil: 'networkidle0' }); await stateReady(second);
    assert.equal(await second.evaluate(() => window.account.client.getState().status), 'guest');
    assert.equal((await login(second, credentials.password, credentials.email, 401)).error, 'invalid_credentials'); await login(second, newPassword);
  });
  await feature('single-session revocation, confirmation cancel, and re-login', async () => {
    await navigate(p, 'devices'); assert.equal(await p.$$eval('.auth-session', n => n.length), 2);
    await p.click('.auth-session-revoke'); await p.waitForSelector('.auth-confirm-box:not([hidden])');
    await p.click('.auth-confirm-box .auth-secondary'); assert.equal(await accountStatus(second), 200);
    await p.click('.auth-session-revoke'); await submit(p, '.auth-confirm-box .auth-primary', '/api/account/sessions/revoke');
    assert.equal(await accountStatus(second), 401); assert.equal(await accountStatus(p), 200); assert.equal(await p.$$eval('.auth-session', n => n.length), 1);
    await second.reload({ waitUntil: 'networkidle0' }); await stateReady(second); await login(second, newPassword);
    await navigate(p, 'devices'); assert.equal(await p.$$eval('.auth-session', n => n.length), 2);
  });
  await feature('revoke all other sessions preserves current login', async () => {
    await p.click('.auth-page-devices .auth-danger'); await submit(p, '.auth-confirm-box .auth-primary', '/api/account/sessions/revoke-others');
    assert.equal(await accountStatus(second), 401); assert.equal(await accountStatus(p), 200); assert.equal(await p.$$eval('.auth-session', n => n.length), 1);
  });
  await feature('activity and real JSON export download', async () => {
    await navigate(p, 'activity'); const types = await p.evaluate(() => window.account.client.getState().security.events.map(e => e.type));
    for (const type of ['registered', 'profile_updated', 'password_changed', 'session_revoked', 'other_sessions_revoked']) assert.ok(types.includes(type), `missing activity ${type}: ${types}`);
    assert.ok(await p.$$eval('.auth-event-list time', nodes => nodes.length) >= 5);
    assert.doesNotMatch(await p.$eval('.auth-event-list', n => n.textContent), /auth\.event\./);
    await screenshot(p, 'activity-desktop'); await navigate(p, 'security');
    const downloads = path.join(run, 'downloads'); await mkdir(downloads); const cdp = await p.createCDPSession();
    try {
      await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
      const [response] = await Promise.all([p.waitForResponse(r => new URL(r.url()).pathname === '/api/account/export'), p.click('#auth-page-security .auth-card:last-child .auth-secondary')]);
      assert.equal(response.status(), 200); assert.equal(response.headers()['cache-control'], 'no-store'); const expected = await response.json();
      const filename = path.join(downloads, 'oko-account.json'); let exported;
      for (let i = 0; i < 60; i++) { try { exported = JSON.parse(await readFile(filename, 'utf8')); break; } catch { await delay(100); } }
      assert.ok(exported, 'export button must download JSON'); assert.deepEqual(exported, expected);
      assert.equal(exported.user.email, credentials.email); assert.equal(exported.user.bio, 'Skúmam svet s OKO. 🔭');
      assert.equal(exported.user.avatar, 'satellite'); assert.equal(exported.sessions.length, 1);
      assert.doesNotMatch(JSON.stringify(exported), /password_hash|credential_version|csrfToken|token_hash|owner-fixture|127\.0\.0\.1/);
    } finally { await cdp.detach(); }
  });
  await feature('mail unavailable is visible and mail actions disabled', async () => {
    assert.equal(await p.$eval('.auth-email-status', n => n.dataset.verified), 'false'); assert.equal(await p.$eval('.auth-email-form fieldset', n => n.disabled), true);
    const mail = await p.$eval('.auth-email-status', n => ({ text: n.parentElement.querySelector('.auth-notice').textContent,
      hidden: n.parentElement.querySelector('.auth-notice').hidden, disabled: n.parentElement.querySelector('button').disabled }));
    assert.equal(mail.hidden, false); assert.equal(mail.disabled, true); assert.match(mail.text, /nie je|nedostup|nenakonfigurovan/i);
  });
  await viewportChecks(p, true);
  await feature('logout propagates to same-context tab; protected account returns 401', async () => {
    const sibling = await page(context); await open(p); await navigate(p, 'overview'); await submit(p, '.auth-logout', '/api/auth/logout');
    await sibling.bringToFront(); await sibling.waitForFunction(() => window.account.client.getState().status === 'guest');
    assert.equal(await accountStatus(sibling), 401); await sibling.close(); await p.bringToFront(); await login(p, newPassword);
    assert.equal(await p.$eval('.auth-mini-identity strong', n => n.textContent), credentials.displayName); await submit(p, '.auth-logout', '/api/auth/logout');
  });
  await feature('fixture-only owner badge and Escape focus/shortcut arbitration', async () => {
    await login(p, owner.password, owner.email); assert.equal(await p.$eval('.auth-owner-badge', n => n.hidden), false);
    assert.equal(await p.$eval('.auth-owner-badge', n => n.textContent), 'Vlastník'); await screenshot(p, 'fixture-owner');
    await submit(p, '.auth-logout', '/api/auth/logout');
    await p.evaluate(() => { window.__focusLog = []; document.addEventListener('focusin', e => window.__focusLog.push(`${e.target.id || e.target.className}@open=${document.querySelector('#account-dialog').open}`)); });
    await p.keyboard.press('Escape');
    assert.equal(await p.$eval('#account-dialog', d => d.open), false); assert.equal(await p.evaluate(() => window.backgroundEscapes), 0);
    // Focus returns to the launcher right after close and once more after the browser's own restoration (a 0 ms task).
    await p.waitForFunction(() => document.activeElement?.id === 'account-btn', { timeout: 2000 }).catch(async () => {
      const focusState = await p.evaluate(() => ({ active: document.activeElement.id, open: document.querySelector('#account-dialog').open, log: window.__focusLog }));
      assert.fail(`focus after Escape: ${JSON.stringify(focusState)}`);
    });
  });
  await feature('standalone recovery, fragment scrubbing and honest unavailable mail', async () => {
    const recoveryContext = await browser.createBrowserContext(), token = recoveryToken;
    const recovery = await page(recoveryContext, `/account.html#action=reset&token=${token}`);
    await recovery.waitForSelector('.auth-credentials', { visible: true }); assert.equal(new URL(recovery.url()).hash, '');
    assert.equal(await recovery.$eval('#account-dialog', d => d.open), true); assert.match(await recovery.$eval('#auth-title', n => n.textContent), /heslo/i);
    assert.equal(await recovery.$eval('#auth-email', n => n.closest('.auth-field').hidden), true);
    await fill(recovery, '#auth-password', newPassword); await fill(recovery, '#auth-confirm', newPassword);
    const [invalid] = await Promise.all([recovery.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/reset-password'), recovery.click('.auth-credentials .auth-primary')]);
    assert.equal((await invalid.json()).error, 'invalid_token'); assert.ok(invalid.status() >= 400);
    await recovery.waitForFunction(() => document.querySelector('#auth-status').dataset.kind === 'error'); await screenshot(recovery, 'standalone-invalid-recovery');
    assert.deepEqual(report.tokenLeaks, [], 'fragment token must never enter requests or referrers, including initial page load');
    await recovery.reload({ waitUntil: 'networkidle0' }); await recovery.waitForSelector('.auth-credentials .auth-link', { visible: true });
    await recovery.click('.auth-credentials .auth-link'); assert.equal(await recovery.$eval('.auth-credentials .auth-primary', n => n.disabled), true);
    assert.equal(await recovery.$eval('.auth-credentials .auth-notice', n => n.hidden), false);
    assert.match(await recovery.$eval('.auth-credentials .auth-notice', n => n.textContent), /nie je|nedostup|nenakonfigurovan/i);
    for (const width of [1280, 390, 320]) {
      await recovery.setViewport({ width, height: 844 }); await bounds(recovery, `standalone recovery ${width}`); await screenshot(recovery, `standalone-recovery-${width}`);
    }
    const response = await fetch(origin + '/account.html');
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    await feature('standalone account CSS applies under its CSP', async () => {
      const styles = await recovery.evaluate(() => ({
        landingDisplay: getComputedStyle(document.querySelector('.account-landing')).display,
        dialogRadius: getComputedStyle(document.querySelector('#account-dialog')).borderRadius,
        dialogBackground: getComputedStyle(document.querySelector('#account-dialog')).backgroundColor,
      }));
      assert.ok(styles.landingDisplay === 'flex' && styles.dialogRadius !== '0px',
        `Standalone CSS not applied: ${JSON.stringify(styles)}; CSP errors: ${report.cspErrors.length}`);
      assert.deepEqual(report.cspErrors, [], 'account CSS must not be blocked by Content Security Policy');
    }, { continueOnFailure: true, evidencePage: recovery });
    await recoveryContext.close();
  });
  for (const purpose of ['reset', 'verify']) {
    await feature(`valid standalone ${purpose} preserves success after returning to login without auto-login`, async () => {
      const raw = randomBytes(32).toString('base64url');
      const tokenStore = openAuthStore(database);
      try {
        const user = tokenStore.userByEmail(credentials.email);
        assert.equal(user.role, 'member', 'valid links target only the disposable QA member');
        tokenStore.issueToken(createHash('sha256').update('account-action:' + raw).digest('hex'),
          user, purpose, user.email, Date.now(), 600000);
      } finally { tokenStore.close(); }
      const linkContext = await browser.createBrowserContext();
      let linkPage;
      try {
        linkPage = await page(linkContext, `/account.html#action=${purpose}&token=${raw}`);
        await linkPage.waitForSelector('.auth-credentials', { visible: true });
        assert.equal(new URL(linkPage.url()).hash, '');
        const before = await linkPage.evaluate(async () => (await fetch('/api/auth/session')).json());
        assert.equal(before.user, null);
        assert.equal(before.capabilities[purpose === 'reset' ? 'passwordReset' : 'emailVerification'], false);
        const resetPassword = 'valid link isolated reset passphrase';
        if (purpose === 'reset') {
          await fill(linkPage, '#auth-password', resetPassword); await fill(linkPage, '#auth-confirm', resetPassword);
        }
        const endpoint = purpose === 'reset' ? '/api/auth/reset-password' : '/api/auth/verify-email';
        const [response] = await Promise.all([
          linkPage.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'POST'),
          linkPage.click('.auth-credentials .auth-primary'),
        ]);
        const data = await response.json();
        assert.equal(response.status(), 200, JSON.stringify(data));
        assert.equal(data[purpose === 'reset' ? 'reset' : 'verified'], true);
        // Wait beyond the response: action() must finish and setMode('login',
        // true) must run before checking the retained message and cleared secrets.
        await linkPage.waitForFunction(() => {
          const tabs = document.querySelector('.auth-tabs'), status = document.querySelector('#auth-status');
          return !tabs.hidden && tabs.firstElementChild.getAttribute('aria-pressed') === 'true'
            && !document.querySelector('#auth-email').closest('.auth-field').hidden
            && document.querySelector('#auth-confirm').closest('.auth-field').hidden
            && document.querySelector('#auth-password').value === ''
            && status.dataset.kind === 'success' && status.textContent.length > 0;
        });
        await linkPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await linkPage.$eval('#auth-status', n => n.textContent), purpose === 'reset'
          ? 'Heslo bolo obnovené a všetky relácie odhlásené. Prihláste sa novým heslom.'
          : 'E-mail je potvrdený. Môžete sa prihlásiť aktuálnou adresou.');
        assert.equal(await accountStatus(linkPage), 401, 'a valid link must not automatically sign in');
        assert.equal(await linkPage.$eval('#account-btn', n => n.dataset.authenticated), 'false');
        const confirmedStore = openAuthStore(database);
        try {
          const user = confirmedStore.userByEmail(credentials.email);
          if (purpose === 'reset') assert.equal(await verifyPassword(resetPassword, user.password_hash), true);
          else assert.equal(user.email_verified, 1);
        } finally { confirmedStore.close(); }
        assert.deepEqual(report.tokenLeaks, []);
        await screenshot(linkPage, `standalone-${purpose}-success`);
      } catch (error) {
        if (linkPage) await screenshot(linkPage, `standalone-${purpose}-failure`).catch(() => {});
        throw error;
      } finally { await linkContext.close(); }
    });
  }
  await feature('backend outage leaves public shell and modal close usable', async () => {
    await p.setOfflineMode(true); await p.click('#account-btn'); await p.waitForFunction(() => window.account.client.getState().status === 'unavailable');
    await screenshot(p, 'offline-unavailable'); await p.click('.auth-close'); assert.equal(await p.$eval('#account-dialog', d => d.open), false); await p.setOfflineMode(false);
  });
  await feature('no page errors or attempted non-fixture requests', async () => { assert.deepEqual(report.errors, []); assert.deepEqual(report.blockedRequests, []); });
} catch (error) {
  report.fatal = { feature: currentFeature, message: error.message }; console.error('Auth browser QA failed:', error); process.exitCode = 1;
} finally {
  if (browser) {
    const browserProcess = browser.process(); let timer;
    await Promise.race([browser.close().catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
    clearTimeout(timer); if (browserProcess && browserProcess.exitCode === null) browserProcess.kill();
  }
  await server?.close();
  // Delete only this run's disposable DB/cache. Retain screenshots/export/report.
  assert.equal(path.dirname(runtime), run); assert.ok(run.startsWith(path.join(output, 'run-'))); await rm(runtime, { recursive: true, force: true });
  report.passed = !report.fatal && report.checks.every(check => check.passed); if (!report.passed) process.exitCode = 1;
  await writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  progress(`${report.passed ? 'PASS' : 'FAIL'}: ${report.checks.filter(c => c.passed).length}/${report.checks.length} checks; report and screenshots: ${run}`);
}
