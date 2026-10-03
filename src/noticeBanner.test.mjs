import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeContent } from './noticeBanner.js';
import { telemetryOptOut } from './siteTelemetry.js';

test('banner: oznam, vypnuté zdroje, nič', () => {
  assert.equal(noticeContent({ notice: null, disabled: [] }), null);
  assert.equal(noticeContent(null), null);
  const both = noticeContent({ notice: { id: 'abc', text: 'Údržba o 20:00', level: 'info' }, disabled: ['TomTom doprava'] });
  assert.equal(both.text, 'Údržba o 20:00 Dočasne vypnuté: TomTom doprava.');
  assert.equal(both.level, 'info');
  const onlyDisabled = noticeContent({ notice: null, disabled: ['OpenAI hlas (Realtime)'] });
  assert.equal(onlyDisabled.level, 'warn', 'vypnutý zdroj bez oznamu je upozornenie');
  assert.notEqual(onlyDisabled.id, both.id, 'zmena obsahu = nový oznam aj po zavretí');
  assert.equal(noticeContent({ disabled: [1, '<b>x</b>'] }).text, 'Dočasne vypnuté: <b>x</b>.', 'text, nie HTML (renderuje textContent)');
});

test('telemetria rešpektuje Do Not Track a GPC', () => {
  assert.equal(telemetryOptOut({ doNotTrack: '1' }), true);
  assert.equal(telemetryOptOut({ globalPrivacyControl: true }), true);
  assert.equal(telemetryOptOut({ doNotTrack: 'unspecified' }), false);
});
