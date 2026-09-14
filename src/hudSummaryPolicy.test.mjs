// src/hudSummaryPolicy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySummaryFailure } from './hudSummaryPolicy.js';

test('HUD súhrn: chýbajúci kľúč (503 „OPENAI_API_KEY is not set") a zákaz (403/401) vypnú ďalšie dopyty, ostatné zlyhania sa skúšajú znova', () => {
  assert.equal(classifySummaryFailure({ status: 503, error: 'OPENAI_API_KEY is not set' }), 'disabled');
  assert.equal(classifySummaryFailure({ status: 403, error: 'voice_disabled_on_public_host' }), 'disabled');
  assert.equal(classifySummaryFailure({ status: 401, error: { message: 'Incorrect API key provided' } }), 'disabled');
  assert.equal(classifySummaryFailure({ status: 503, error: 'The engine is currently overloaded' }), 'retry', '503 bez „not set" je preťaženie modelu → skúsiť znova');
  assert.equal(classifySummaryFailure({ status: 502, error: null }), 'retry', '502 z tunela je prechodné');
  assert.equal(classifySummaryFailure({ status: 500, error: 'HTTP 500' }), 'retry');
  assert.equal(classifySummaryFailure({ status: 429, error: 'rate limited' }), 'retry');
  assert.equal(classifySummaryFailure({}), 'retry');
});
