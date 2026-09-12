// src/data/logoResolve.test.mjs
// Logá aerolínií a výrobcov (2026-09-12): výrobca z typu, kandidáti titulov,
// súbor loga z infoboxu, prijateľné licencie, kredit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptableLogoLicense, airlineTitleCandidates, infoboxLogoFile, logoCreditLine, manufacturerFromType, normalizeLogoName, stripHtml, titleCase,
} from './logoResolve.js';

test('manufacturerFromType: prvé slová typu proti tabuľke, dvojslovní výrobcovia, neznámy = null', () => {
  assert.deepEqual(manufacturerFromType('Airbus A319 132'), { key: 'airbus', title: 'Airbus' });
  assert.deepEqual(manufacturerFromType('BOEING 767-300'), { key: 'boeing', title: 'Boeing' });
  assert.deepEqual(manufacturerFromType('De Havilland DHC-8-400'), { key: 'de havilland', title: 'De Havilland Canada' });
  assert.deepEqual(manufacturerFromType('ATR 72-600'), { key: 'atr', title: 'ATR (aircraft manufacturer)' });
  assert.deepEqual(manufacturerFromType('Embraer EMB-190 E2'), { key: 'embraer', title: 'Embraer' });
  assert.equal(manufacturerFromType('TR-3B'), null);
  assert.equal(manufacturerFromType(''), null);
  assert.equal(manufacturerFromType(null), null);
});

test('airlineTitleCandidates a titleCase: veľké písmená z feedu sa upravia, varianty (airline)/Airlines', () => {
  assert.deepEqual(airlineTitleCandidates('Eurowings'), ['Eurowings', 'Eurowings (airline)', 'Eurowings Airlines'], '„wings" nie je „airline" — tretí kandidát ostáva');
  assert.deepEqual(airlineTitleCandidates('UNITED PARCEL SERVICE CO'), ['United Parcel Service CO', 'United Parcel Service CO (airline)', 'United Parcel Service CO Airlines']);
  assert.deepEqual(airlineTitleCandidates('Pegasus Airlines'), ['Pegasus Airlines', 'Pegasus Airlines (airline)']);
  assert.deepEqual(airlineTitleCandidates(''), []);
  assert.equal(titleCase('WIDEROE'), 'Wideroe');
  assert.equal(normalizeLogoName('  Pegasus   Airlines '), 'pegasus airlines');
});

test('infoboxLogoFile: [[File:…]], File:…, holý súbor, image_logo; bez prípony obrázka null', () => {
  assert.equal(infoboxLogoFile('{{Infobox airline\n| airline = Eurowings\n| logo = [[File:Eurowings Logo.svg|200px]]\n| IATA = EW'), 'Eurowings Logo.svg');
  assert.equal(infoboxLogoFile('| logo = File:Pegasus_Airlines_logo.svg'), 'Pegasus Airlines logo.svg');
  assert.equal(infoboxLogoFile('| logo = Wizz Air logo.png\n'), 'Wizz Air logo.png');
  assert.equal(infoboxLogoFile('| image_logo = Boeing full logo.svg'), 'Boeing full logo.svg');
  assert.equal(infoboxLogoFile('| logo = Airbus Logo 2017.svg{{!}}class=skin-invert\n| logo_size = 180px'), 'Airbus Logo 2017.svg', 'parametre za {{!}} (Airbus/Boeing naživo 2026-09-12)');
  assert.equal(infoboxLogoFile('| logo                = Boeing full logo.svg{{!}}class=skin-invert'), 'Boeing full logo.svg');
  assert.equal(infoboxLogoFile('| logo = {{#if:1|x}}'), null);
  assert.equal(infoboxLogoFile('| logo = \n| name = X'), null);
  assert.equal(infoboxLogoFile('nič'), null);
});

test('acceptableLogoLicense: PD, CC0, CC BY, CC BY-SA áno; fair use, GFDL-only, prázdne nie', () => {
  for (const ok of ['Public domain', 'public domain', 'PD-textlogo', 'CC0', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC-BY-SA-3.0', 'CC BY 2.0', 'cc by-sa 2.5']) assert.equal(acceptableLogoLicense(ok), true, ok);
  for (const no of ['Fair use', 'Non-free logo', 'GFDL', '', null, 'CC BY-NC 4.0', 'CC BY-ND 4.0']) assert.equal(acceptableLogoLicense(no), false, String(no));
});

test('logoCreditLine a stripHtml: Commons + licencia (+ autor len pri CC BY/BY-SA)', () => {
  assert.equal(stripHtml('<a href="x">Jane &amp; Co</a>'), 'Jane & Co');
  assert.equal(logoCreditLine({ license: 'CC BY-SA 4.0', author: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane</a>' }), 'Wikimedia Commons · CC BY-SA 4.0 · Jane');
  assert.equal(logoCreditLine({ license: 'Public domain', author: 'Anyone' }), 'Wikimedia Commons · Public domain');
  assert.equal(logoCreditLine({}), 'Wikimedia Commons');
});
