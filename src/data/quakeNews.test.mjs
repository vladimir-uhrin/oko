// Následky zemetrasenia zo správ: číslo len od dvoch dôveryhodných médií, „nikto nezahynul" len od dvoch,
// nedôveryhodné domény (agregátory) sa nepočítajú; Bing aj GDELT v rovnakom tvare.
import test from 'node:test';
import assert from 'node:assert/strict';
import { quakeFactsLine, quakeNewsFacts, quakeNewsQuery } from './quakeNews.js';

const trusted = ['apnews.com', 'reuters.com', 'bbc.co.uk', 'france24.com', 'theguardian.com'];
const a = (domain, title, url = `https://${domain}/x`) => ({ domain, title, url });

test('obete: číslo od dvoch médií (druhé najvyššie), agregátory nie', () => {
  const f = quakeNewsFacts([
    a('apnews.com', 'Panama earthquake kills at least 12 people'),
    a('reuters.com', 'Death toll rises to 9 after Panama quake'),
    a('yahoo.com', 'Panama quake: 30 dead'),
    a('bbc.co.uk', 'Panama earthquake: 27 injured, buildings damaged'),
    a('france24.com', 'Major quake hits Panama, 31 injured'),
  ], trusted);
  assert.equal(f.killed, 9, 'AP 12, Reuters 9 → potvrdené 9; Yahoo sa nepočíta');
  assert.equal(f.injured, 27);
  assert.equal(f.noDeaths, false);
  assert.equal(quakeFactsLine(f).caption, 'Podľa médií zahynulo najmenej 9 ľudí. Zranených je najmenej 27.');
  assert.equal(quakeFactsLine(f).title, '9 MŔTVYCH');
});

test('„nikto nezahynul" len od dvoch médií; jedno médium s číslom nestačí', () => {
  const one = quakeNewsFacts([a('apnews.com', 'Panama earthquake kills 3'), a('france24.com', 'Major quake hits Panama, no deaths reported')], trusted);
  assert.equal(one, null, 'jedno číslo a jedno „bez obetí" nestačí na nič');
  const none = quakeNewsFacts([a('france24.com', 'Major quake hits Panama, no deaths reported'), a('theguardian.com', 'Panama earthquake: no fatalities so far, 27 injured'),
    a('apnews.com', 'Panama reports 27 injured in quake')], trusted);
  assert.deepEqual([none.killed, none.injured, none.noDeaths], [null, 27, true]);
  assert.equal(quakeFactsLine(none).caption, 'Podľa médií zatiaľ nikto nezahynul. Zranených je najmenej 27.');
  assert.equal(quakeFactsLine(none).spoken, 'Podľa médií zatiaľ nikto nezahynul. Zranených je najmenej dvadsaťsedem.');
  assert.equal(quakeFactsLine(none).title, 'BEZ OBETÍ');
});

test('titulok bez slova zemetrasenie a starší článok sa nepočíta; španielčina; dopyt GDELT', () => {
  const f = quakeNewsFacts([a('apnews.com', 'Bus crash kills 12 in Panama'), a('reuters.com', 'Storm leaves 12 dead'),
    a('apnews.com', 'Sismo en Panamá deja 4 muertos y 20 heridos'), a('reuters.com', 'Terremoto en Panamá: 4 muertos')], trusted);
  assert.equal(f.killed, 4);
  assert.equal(quakeFactsLine({ killed: 4, sources: [] }).spoken, 'Podľa médií zahynuli najmenej štyria ľudia.');
  const old = quakeNewsFacts([{ ...a('apnews.com', 'Earthquake kills 5'), seendate: '20261001T100000Z' }, { ...a('reuters.com', 'Earthquake kills 5'), seendate: '20261001T100000Z' }],
    trusted, { afterMs: Date.parse('2026-10-09T17:56:00Z') });
  assert.equal(old, null);
  assert.equal(quakeNewsQuery('Panama'), '(earthquake OR quake OR sismo OR terremoto) "Panama"');
});
