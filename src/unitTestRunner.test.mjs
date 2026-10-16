import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALLOCATION_TEST_FILES,
  PARALLEL_TEST_TIMEOUT_MS,
  allocationTestArgs,
  assertNode24AllocationRuntime,
  buildUnitTestPlan,
  isCalibratedAllocationRuntime,
  parallelTestArgs,
} from '../scripts/run-unit-tests.mjs';

test('unit runner serializes only GC-bracketed allocation microbenchmarks', () => {
  const ordinary = [
    'src/data/manager.test.mjs',
    'src/data/radio.test.mjs',
    'src/unitTestRunner.test.mjs',
  ];
  const plan = buildUnitTestPlan([
    ordinary[1],
    ALLOCATION_TEST_FILES[1],
    ordinary[0],
    ALLOCATION_TEST_FILES[0],
    ordinary[2],
  ]);

  assert.deepEqual(plan.parallel, ordinary);
  assert.deepEqual(plan.serializedAllocations, ALLOCATION_TEST_FILES);
  assert.equal(plan.parallel.some((file) => ALLOCATION_TEST_FILES.includes(file)), false);
  for (const file of ALLOCATION_TEST_FILES) {
    assert.deepEqual(allocationTestArgs(file), [
      '--expose-gc', '--test', '--test-concurrency=1', file,
    ]);
  }
  assert.throws(
    () => allocationTestArgs('src/data/radio.test.mjs'),
    /Not an allocation microbenchmark/,
  );
});

test('parallel tests get a per-test time limit that is a backstop, not a budget', () => {
  // Node gives a test file no limit of its own, so a test whose promise never
  // settles (2026-10-09: aisWatchdogTransport, built-in WebSocket) hangs the
  // suite forever unless every test carries --test-timeout.
  const files = ['src/data/radio.test.mjs', 'src/unitTestRunner.test.mjs'];
  assert.deepEqual(parallelTestArgs(files), [
    '--test', `--test-timeout=${PARALLEL_TEST_TIMEOUT_MS}`, ...files,
  ]);
  assert.ok(Number.isInteger(PARALLEL_TEST_TIMEOUT_MS) && PARALLEL_TEST_TIMEOUT_MS > 0);
  // Slowest legitimate test under full parallel load: ~65 s (OPERA radar
  // reprojection, 2026-10-16). Keep at least a 4× margin so a loaded machine
  // never turns a slow pass into a spurious timeout.
  assert.ok(PARALLEL_TEST_TIMEOUT_MS >= 4 * 65_000, `${PARALLEL_TEST_TIMEOUT_MS} ms is too tight`);
  // The GC-bracketed probes are serialized and deliberately carry no limit.
  for (const file of ALLOCATION_TEST_FILES) {
    assert.equal(allocationTestArgs(file).some((arg) => arg.startsWith('--test-timeout')), false);
  }
});

test('allocation runtime calibration is explicit and pinned to Node 24', () => {
  assert.equal(assertNode24AllocationRuntime('24.19.0'), '24.19.0');
  assert.throws(
    () => assertNode24AllocationRuntime('22.23.1'),
    /calibrated Node 24 runtime/,
  );
  assert.throws(
    () => assertNode24AllocationRuntime('26.0.0'),
    /calibrated Node 24 runtime/,
  );
  assert.equal(isCalibratedAllocationRuntime('24.19.0'), true);
  assert.equal(isCalibratedAllocationRuntime('22.23.1'), false);
  assert.equal(isCalibratedAllocationRuntime('26.3.0'), false);
});

test('npm test stays green on every supported engine, not only the calibrated one', () => {
  // package.json wiring: `npm test` must invoke this runner, and the engines
  // range it advertises must not be narrower than what the runner tolerates.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/run-unit-tests.mjs');
  const enginesNode = String(pkg.engines?.node || '');
  assert.ok(enginesNode, 'engines.node must be declared');
  // The runner throws for uncalibrated runtimes ONLY behind the explicit
  // opt-in env; by default it skips, so a supported non-24 engine cannot fail.
  const runner = readFileSync(new URL('../scripts/run-unit-tests.mjs', import.meta.url), 'utf8');
  assert.match(runner, /GEV_REQUIRE_ALLOCATION_GATE/);
  assert.match(runner, /SKIPPED .*allocation microbenchmarks/);
});
