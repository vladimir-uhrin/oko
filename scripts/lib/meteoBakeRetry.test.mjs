import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryFailedOnce } from './meteoBakeRetry.mjs';

test('zlyhané rezy sa po pauze skúsia raz znova; čo prejde, už nie je zlyhanie', async () => {
  const slept = [];
  const calls = [];
  const { recovered, stillFailed } = await retryFailedOnce(['clouds@21', 'wind@18'], async (item) => {
    calls.push(item);
    if (item === 'wind@18') throw new Error('THREDDS HTTP 500');
  }, { pauseMs: 1234, sleep: async (ms) => { slept.push(ms); } });
  assert.deepEqual(slept, [1234], 'jedna pauza pred druhým kolom');
  assert.deepEqual(calls, ['clouds@21', 'wind@18'], 'každý zlyhaný rez práve raz');
  assert.deepEqual(recovered, ['clouds@21']);
  assert.deepEqual(stillFailed, ['wind@18']);
});

test('bez zlyhaní žiadna pauza ani pokus', async () => {
  let slept = false;
  const r = await retryFailedOnce([], async () => { throw new Error('nemá sa volať'); }, { sleep: async () => { slept = true; } });
  assert.equal(slept, false);
  assert.deepEqual(r, { recovered: [], stillFailed: [] });
});
