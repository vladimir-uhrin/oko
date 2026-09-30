// src/analytics.test.mjs — GA4 len so súhlasom (2026-09-30). Čisté rozhodovanie, príkazy gtag,
// vypínač do založenia info@okolive.sk, zapojenie v main.js a stránka ochrany súkromia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANALYTICS_ENABLED, CONSENT_STORAGE_KEY, GA4_MEASUREMENT_ID, analyticsDecision, gtagCommands, parseConsent, serializeConsent,
} from './analytics.js';

test('GA4 je pripravené, ale vypnuté, kým neexistuje kontakt info@okolive.sk', () => {
  assert.equal(GA4_MEASUREMENT_ID, 'G-DH65MSBSDY', 'stream okolive.sk (15887433354), nie ai-translators');
  assert.equal(ANALYTICS_ENABLED, false);
  assert.equal(analyticsDecision({ host: 'okolive.sk', consent: 'granted' }), 'off');
});

test('rozhodnutie: len okolive.sk, nie robot; bez voľby lišta, súhlas načíta, odmietnutie nič', () => {
  const base = { enabled: true, host: 'okolive.sk' };
  assert.equal(analyticsDecision({ ...base, consent: null }), 'ask');
  assert.equal(analyticsDecision({ ...base, consent: 'granted' }), 'load');
  assert.equal(analyticsDecision({ ...base, consent: 'denied' }), 'declined');
  assert.equal(analyticsDecision({ ...base, host: 'OKOLIVE.SK', consent: 'granted' }), 'load');
  assert.equal(analyticsDecision({ ...base, host: 'localhost', consent: 'granted' }), 'off', 'vývoj sa nemeria');
  assert.equal(analyticsDecision({ ...base, host: 'www.okolive.sk', consent: 'granted' }), 'off', 'www presmeruje na holú doménu');
  assert.equal(analyticsDecision({ ...base, consent: 'granted', crawler: true }), 'off', 'roboty sa nemerajú');
});

test('uložená voľba: len granted/denied, inak nič; zápis má čas', () => {
  assert.equal(parseConsent(serializeConsent('granted', new Date('2026-09-30T08:00:00Z'))), 'granted');
  assert.equal(parseConsent(serializeConsent('denied')), 'denied');
  assert.equal(parseConsent(serializeConsent('whatever')), 'denied', 'neznáma voľba = odmietnutie');
  assert.equal(parseConsent(null), null);
  assert.equal(parseConsent('{"analytics":"maybe"}'), null);
  assert.equal(parseConsent('nie json'), null);
  assert.match(serializeConsent('granted', new Date('2026-09-30T08:00:00Z')), /"at":"2026-09-30T08:00:00\.000Z"/);
});

test('gtag: reklamné signály zamietnuté, bez Google signals, jedno zobrazenie stránky', () => {
  const [consent, config] = gtagCommands('G-TEST');
  assert.deepEqual(consent, ['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' }]);
  assert.deepEqual(config, ['config', 'G-TEST', { send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: false }]);
  const src = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8');
  assert.match(src, /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=/);
  assert.equal((src.match(/loadGtag\(/g) || []).length, 3, 'gtag.js sa načíta len z dvoch miest (súhlas pri štarte / v lište) + definícia');
});

test('zapojenie: main.js spúšťa GA4 až po skrytí preloadera a posiela príznak robota', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ initAnalytics \} from '\.\/analytics\.js';/);
  assert.match(main, /startSharpStarfield\(\);\n[^\n]*\n\s+try \{ initAnalytics\(\{ t, crawler: crawlerVisit \}\); \}/);
});

test('ochrana súkromia: kontakt, GA4 len so súhlasom, tlačidlo mení tú istú voľbu, úrad na ochranu údajov', () => {
  const page = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
  assert.match(page, /Vladimír Uhrin/);
  assert.match(page, /mailto:info@okolive\.sk/);
  assert.match(page, /Bez súhlasu sa Google Analytics vôbec nenačíta\./);
  assert.match(page, /Without consent Google Analytics is not loaded at all\./);
  assert.match(page, new RegExp(`var KEY = '${CONSENT_STORAGE_KEY.replace(/\./g, '\\.')}';`), 'rovnaký kľúč ako lišta v appke');
  assert.match(page, /dataprotection\.gov\.sk/);
  assert.doesNotMatch(page, /účet zmazať v Centre účtu/, 'samoobslužné zmazanie účtu zatiaľ neexistuje');
  const sk = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  for (const key of ['consent.title', 'consent.text', 'consent.more', 'consent.accept', 'consent.decline']) {
    assert.equal((sk.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || []).length, 2, `${key} v SK aj EN`);
  }
});
