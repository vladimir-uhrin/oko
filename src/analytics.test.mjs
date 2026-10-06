// src/analytics.test.mjs — súhlas s cookies (CMP) + GA4 len so súhlasom (2026-09-30, CMP 2026-10-04).
// Čisté rozhodovanie, záznam voľby (expirácia, verzia zásad, v1), Consent Mode v2, mazanie cookies
// GA, vypínač, kontakt prevádzkovateľa, zapojenie v main.js a stránka ochrany súkromia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANALYTICS_ENABLED, CONSENT_CATEGORIES, CONSENT_MAX_AGE_DAYS, CONSENT_POLICY_VERSION, CONSENT_STORAGE_KEY,
  GA4_MEASUREMENT_ID, LEGACY_CONSENT_STORAGE_KEY, analyticsDecision, consentDefaults, cookieDeletionStrings,
  gaCookieNames, gtagCommands, gtagLoads, TRACKED_EVENTS, eventPayload, trackEvent, isConsentPreview, parseConsentRecord, readConsent, serializeConsent,
} from './analytics.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const NOW = new Date('2026-10-04T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000);

test('GA4 zapnuté (kontakt prevádzkovateľa funguje od 2026-10-04): na okolive.sk sa pýta, inde nikdy', () => {
  assert.equal(GA4_MEASUREMENT_ID, 'G-DH65MSBSDY', 'stream okolive.sk (15887433354), nie ai-translators');
  assert.equal(ANALYTICS_ENABLED, true);
  assert.equal(analyticsDecision({ host: 'okolive.sk', consent: null }), 'ask');
  assert.equal(analyticsDecision({ host: 'okolive.sk', consent: 'granted' }), 'load');
  assert.equal(analyticsDecision({ host: 'localhost', consent: 'granted' }), 'off');
  assert.equal(analyticsDecision({ enabled: false, host: 'okolive.sk', consent: 'granted' }), 'off', 'vypínač stále funguje');
});

test('rozhodnutie: len okolive.sk, nie robot; bez voľby lišta, súhlas načíta, odmietnutie a GPC nič', () => {
  const base = { enabled: true, host: 'okolive.sk' };
  assert.equal(analyticsDecision({ ...base, consent: null }), 'ask');
  assert.equal(analyticsDecision({ ...base, consent: 'granted' }), 'load');
  assert.equal(analyticsDecision({ ...base, consent: 'denied' }), 'declined');
  assert.equal(analyticsDecision({ ...base, consent: null, gpc: true }), 'declined', 'GPC = odmietnutie bez lišty');
  assert.equal(analyticsDecision({ ...base, consent: 'granted', gpc: true }), 'load', 'výslovný súhlas v nastaveniach má prednosť');
  assert.equal(analyticsDecision({ ...base, host: 'OKOLIVE.SK', consent: 'granted' }), 'load');
  assert.equal(analyticsDecision({ ...base, host: 'localhost', consent: 'granted' }), 'off', 'vývoj sa nemeria');
  assert.equal(analyticsDecision({ ...base, host: 'www.okolive.sk', consent: 'granted' }), 'off', 'www presmeruje na holú doménu');
  assert.equal(analyticsDecision({ ...base, consent: 'granted', crawler: true }), 'off', 'roboty sa nemerajú');
});

test('záznam voľby: čas, verzia zásad, reklamy vždy zamietnuté; neznáma voľba = odmietnutie', () => {
  const raw = serializeConsent('granted', NOW);
  assert.deepEqual(JSON.parse(raw), { v: 2, analytics: 'granted', ads: 'denied', at: NOW.toISOString(), policy: CONSENT_POLICY_VERSION });
  assert.deepEqual(parseConsentRecord(raw, { now: NOW }), { analytics: 'granted', at: NOW.toISOString(), policy: CONSENT_POLICY_VERSION });
  assert.equal(parseConsentRecord(serializeConsent('whatever', NOW), { now: NOW }).analytics, 'denied');
  for (const bad of [null, '', 'nie json', '{"analytics":"maybe","at":"2026-10-04T00:00:00Z"}', '{"analytics":"granted"}']) {
    assert.equal(parseConsentRecord(bad, { now: NOW }), null, String(bad));
  }
});

test('platnosť: po 12 mesiacoch, pri inej verzii zásad alebo čase z budúcnosti sa pýtame znova', () => {
  assert.equal(CONSENT_MAX_AGE_DAYS, 365);
  assert.ok(parseConsentRecord(serializeConsent('denied', daysAgo(364)), { now: NOW }));
  assert.equal(parseConsentRecord(serializeConsent('denied', daysAgo(366)), { now: NOW }), null);
  assert.equal(parseConsentRecord(serializeConsent('granted', new Date(NOW.getTime() + 3 * 86_400_000)), { now: NOW }), null);
  const oldPolicy = JSON.stringify({ ...JSON.parse(serializeConsent('granted', NOW)), policy: '2020-01-01' });
  assert.equal(parseConsentRecord(oldPolicy, { now: NOW }), null);
});

test('záznam v1 (2026-09-30) platí ďalej a readConsent ho prečíta, nový kľúč má prednosť', () => {
  const v1 = JSON.stringify({ analytics: 'granted', at: '2026-09-30T08:00:00.000Z' });
  assert.equal(parseConsentRecord(v1, { now: NOW, legacy: true }).analytics, 'granted');
  assert.equal(parseConsentRecord(v1, { now: NOW }), null, 'v1 bez verzie zásad nie je v2');
  const store = new Map([[LEGACY_CONSENT_STORAGE_KEY, v1]]);
  const win = { localStorage: { getItem: (k) => store.get(k) ?? null } };
  assert.equal(readConsent(win, NOW).analytics, 'granted');
  store.set(CONSENT_STORAGE_KEY, serializeConsent('denied', NOW));
  assert.equal(readConsent(win, NOW).analytics, 'denied');
  assert.equal(readConsent({ get localStorage() { throw new Error('blocked'); } }, NOW), null, 'zablokované úložisko = bez voľby');
});

test('GA4 implicitne zapnuté (vlastník 2026-10-04): gtag.js beží všade okrem off, súhlas rozhoduje len o cookies', () => {
  const base = { enabled: true, host: 'okolive.sk' };
  assert.equal(gtagLoads(analyticsDecision({ ...base, consent: null })), true, 'bez voľby: GA bez cookies');
  assert.equal(gtagLoads(analyticsDecision({ ...base, consent: 'denied' })), true, 'odmietnuté: GA bez cookies');
  assert.equal(gtagLoads(analyticsDecision({ ...base, consent: null, gpc: true })), true);
  assert.equal(gtagLoads(analyticsDecision({ ...base, consent: 'granted' })), true);
  assert.equal(gtagLoads(analyticsDecision({ ...base, host: 'localhost' })), false, 'vývoj nič neodošle');
  assert.equal(gtagLoads(analyticsDecision({ ...base, crawler: true })), false, 'roboty nie');
  const cookieless = gtagCommands('G-TEST');
  assert.equal(cookieless.some((c) => c[0] === 'consent' && c[1] === 'update'), false, 'bez súhlasu ostáva analytics_storage denied');
  assert.deepEqual(cookieless[0], ['consent', 'default', consentDefaults()]);
});

test('Consent Mode v2: predvolene všetko zamietnuté, po súhlase len analytics_storage, bez reklám a signals', () => {
  assert.deepEqual(consentDefaults(), {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied',
    functionality_storage: 'granted', security_storage: 'granted',
  });
  const commands = gtagCommands('G-TEST', { granted: true });
  assert.deepEqual(commands[0], ['consent', 'default', consentDefaults()], 'default ide PRVÝ');
  const update = commands.find((c) => c[0] === 'consent' && c[1] === 'update');
  assert.deepEqual(update, ['consent', 'update', { analytics_storage: 'granted' }]);
  assert.ok(commands.indexOf(update) < commands.findIndex((c) => c[0] === 'config'), 'update pred config');
  assert.deepEqual(commands.find((c) => c[1] === 'ads_data_redaction'), ['set', 'ads_data_redaction', true]);
  assert.deepEqual(commands.at(-1), ['config', 'G-TEST', { send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: false }]);
});

test('odvolanie: nájde len cookies GA a zmaže ich aj na nadradenej doméne (nie na TLD)', () => {
  assert.deepEqual(gaCookieNames('oko-x=1; _ga=GA1.1.1; _ga_DH65MSBSDY=GS1; _gid=2; _gat_UA-1=1; _gal=x; __Host-oko_session=s'),
    ['_ga', '_ga_DH65MSBSDY', '_gid', '_gat_UA-1']);
  assert.deepEqual(gaCookieNames(''), []);
  const lines = cookieDeletionStrings('_ga', 'okolive.sk');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=\/$/);
  assert.match(lines[1], /; domain=\.okolive\.sk$/);
  assert.ok(!cookieDeletionStrings('_ga', 'a.okolive.sk').some((l) => l.endsWith('domain=.sk')), 'TLD sa nemaže');
});

test('náhľad lišty len cez ?consent=preview', () => {
  assert.equal(isConsentPreview('?consent=preview'), true);
  assert.equal(isConsentPreview('?a=1&consent=preview&b=2'), true);
  assert.equal(isConsentPreview('?consent=previewx'), false);
  assert.equal(isConsentPreview(''), false);
});

test('kategórie: nevyhnutné vždy, štatistika prepínač, reklamy nepoužívame, médiá na kliknutie; texty SK aj EN', () => {
  assert.deepEqual(CONSENT_CATEGORIES.map((c) => [c.id, c.state]), [['necessary', 'always'], ['analytics', 'toggle'], ['ads', 'unused'], ['media', 'click']]);
  const names = CONSENT_CATEGORIES.flatMap((c) => c.rows.map((r) => r[0]));
  assert.ok(names.includes('__Host-oko_session') && names.includes('_ga') && names.includes('_ga_DH65MSBSDY') && names.includes(CONSENT_STORAGE_KEY));
  const auth = readFileSync(new URL('./auth/server/http.js', import.meta.url), 'utf8');
  assert.match(auth, /'__Host-oko_session'/, 'zoznam cookies zodpovedá serveru');
  assert.match(auth, /'__Host-oko_oauth'/);
  const keys = new Set(['consent.kicker', 'consent.title', 'consent.text', 'consent.more', 'consent.reject-all', 'consent.accept-all',
    'consent.settings', 'consent.save', 'consent.open', 'consent.validity', 'consent.gpc']);
  for (const cat of CONSENT_CATEGORIES) {
    keys.add(`consent.cat.${cat.id}`);
    keys.add(`consent.cat.${cat.id}.text`);
    if (cat.state !== 'toggle') keys.add(`consent.state.${cat.state}`);
    for (const [, , purpose, expiry] of cat.rows) { keys.add(purpose); keys.add(expiry); }
  }
  for (const key of keys) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.equal(SK_STRINGS['consent.reject-all'], 'Odmietnuť všetko');
});

test('zapojenie: main.js spúšťa súhlas až po skrytí preloadera, v HUD je odkaz Súkromie', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ initAnalytics, trackEvent \} from '\.\/analytics\.js';/);
  // Živý rámček (2026-10-06, src/embedMode.js): v rámčeku sa súhlas ani GA nespúšťa (lišta by ho zakryla, nič nezbierame).
  assert.match(main, /startSharpStarfield\(\);\n[^\n]*\n\s+try \{ if \(!embedView\) initAnalytics\(\{ t, crawler: crawlerVisit \}\); \}/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<button id="consent-open" type="button" data-i18n="consent\.open" hidden>/);
});

test('ochrana súkromia: kontakt, cookies GA4 len so súhlasom, tlačidlá menia tú istú voľbu, úrad na ochranu údajov', () => {
  const page = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
  assert.match(page, /Vladimír Uhrin/);
  assert.match(page, /mailto:vladimir_uhrin@yahoo\.com/, 'kontakt podľa vlastníka 2026-10-04');
  assert.doesNotMatch(page, /info@okolive\.sk/);
  assert.match(page, /Bez súhlasu Google Analytics neukladá žiadne cookies/);
  assert.match(page, /Without consent Google Analytics stores no cookies/);
  assert.doesNotMatch(page, /vôbec nenačíta|not loaded at all/, 'GA beží implicitne (bez cookies)');
  assert.match(page, new RegExp(`var KEY = '${CONSENT_STORAGE_KEY.replace(/\./g, '\\.')}';`), 'rovnaký kľúč ako lišta v appke');
  assert.match(page, new RegExp(`var LEGACY = '${LEGACY_CONSENT_STORAGE_KEY.replace(/\./g, '\\.')}';`));
  assert.match(page, new RegExp(`var POLICY = '${CONSENT_POLICY_VERSION}';`), 'rovnaká verzia zásad');
  assert.match(page, /data-consent-set="denied"/);
  assert.match(page, /data-consent-set="granted"/);
  assert.match(page, /__Host-oko_session/);
  assert.match(page, /dataprotection\.gov\.sk/);
  assert.doesNotMatch(page, /účet zmazať v Centre účtu/, 'samoobslužné zmazanie účtu zatiaľ neexistuje');
});

test('udalosti (2026-10-04): len známe názvy a povolené parametre, nič pred načítaním GA', () => {
  assert.deepEqual(Object.keys(TRACKED_EVENTS), ['layer_toggle', 'card_open', 'share_create', 'scene_open', 'mobile_section', 'share_embed_copy']);
  assert.deepEqual(eventPayload('share_embed_copy', { url: 'https://x' }), {}, 'kód na vloženie: udalosť bez parametrov, adresa neodíde');
  assert.deepEqual(eventPayload('layer_toggle', { layer_id: 'flights', enabled: true, lat: 48.1, callsign: 'AUA1' }), { layer_id: 'flights', enabled: true }, 'poloha ani volací znak neodídu');
  assert.deepEqual(eventPayload('card_open', { kind: 'x'.repeat(200) }), { kind: 'x'.repeat(64) }, 'dlhý reťazec sa skráti');
  assert.equal(eventPayload('neznama', { a: 1 }), null);
  const sent = [];
  const win = { __okoGtagLoaded: true, gtag: (...a) => sent.push(a) };
  assert.equal(trackEvent('card_open', { kind: 'flights' }, win), true);
  assert.deepEqual(sent, [['event', 'card_open', { kind: 'flights' }]]);
  assert.equal(trackEvent('card_open', { kind: 'flights' }, { gtag: () => sent.push('x') }), false, 'pred načítaním GA (štart, localhost) nič');
  assert.equal(trackEvent('card_open', { kind: 'flights' }, undefined), false, 'Node / bez okna nič');
  assert.equal(trackEvent('hack', {}, win), false);
  assert.equal(sent.length, 1);
  const page = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
  assert.match(page, /ktoré funkcie OKA sa používajú/, 'zásady opisujú meranie funkcií');
  assert.match(page, /which OKO features are used/);
});
