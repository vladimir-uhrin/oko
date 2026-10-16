// src/data/aisLiveVessels.test.mjs
// Focused tests for the AIS feed-status derivation helper (Batch 10, finding H3/AIS)
// and the vessel vertical-datum seam (2026-07-27 datum pass — see
// the vessel datum contract in docs/CURRENT-STATE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  AIS_FIRST_CONNECT_GRACE_MS,
  AIS_LOAD_RETRY_MS,
  AIS_VIEW_TIMEOUT_MS,
  AIS_WIDE_VIEW_DEG2,
  AIS_WORLD_TIMEOUT_MS,
  MOBILE_SHIP_FAR_HIDE_M,
  aisLiveRequestPlan,
  aisLoadDeferred,
  _setAisRenderRowLimitForTest,
  _viewChangeTickForTest,
  _getAisDeferredStateForTest,
  deriveAisFeedError,
  classifyAisFeedSnapshot,
  buildVesselCard,
  buildSelectedVesselCard,
  cardScreenSeparated,
  reduceVesselSelection,
  vesselDatumHeightM,
  vesselSurfaceHeightM,
  _bindVesselInteractionForTest,
  _setVesselStateForTest,
  _reconcileVesselsForTest,
  _applyAisFeedSnapshotForTest,
  _loadLivePositionsForTest,
  _beginAisSessionForTest,
  _setAisRuntimeForTest,
  _getVesselStateForTest,
  _getVesselFeedStateForTest,
  _setVesselOverlayHostForTest,
  _updateVesselCardsForTest,
  applyVesselFocusDeemphasis,
  mapAnalystRecord,
  VESSEL_TIER_SCALE,
  vesselTierScale,
  _tickVesselRuntimeForTest,
  _getVesselLodStateForTest,
  shipModels3dRegimeActive,
  _setShipModels3dForTest,
  _getShipModelStateForTest,
  SHIP_MODEL_HEADING_OFFSET_DEG,
  SHIP_MODEL_ALT_CEIL_M,
  SHIP_MODEL_MAX,
  SHIP_MODEL_SCALE,
  VESSEL_DENSITY_ENABLED,
  _setVesselDensityEnabledForTest,
} from './aisLiveVessels.js';
import { readFileSync } from 'node:fs';
import aisLiveVesselsLayer from './aisLiveVessels.js';
import { registerEntityContext, selectEntityContext } from './contextStore.js';
import { WORLD_FOCUS_REQUEST_EVENT } from '../worldFocus.js';
import { ensureGeoidReady, geoidHeight } from './geoid.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { applyVesselOverlayPolicy } from './vesselLabels.js';
import { layerFeedState } from './manager.js';
import { t } from '../i18n.js';

test('open feed with vessels is healthy (null)', () => {
  assert.equal(deriveAisFeedError({ status: 'open', lastMessageAt: 1, error: null }, 42), null);
});

test('open feed without a received message is not a fresh healthy update', () => {
  assert.equal(
    deriveAisFeedError({ status: 'open', lastMessageAt: null, error: null }, 0),
    'awaiting first AIS message…',
  );
});

test('open feed with a message but zero accepted positions stays non-fresh', () => {
  assert.equal(
    deriveAisFeedError({ status: 'open', lastMessageAt: 123, error: null }, 0),
    'awaiting usable AIS positions…',
  );
});

test('snapshot classification distinguishes raw rows from accepted vessel positions', () => {
  const payload = {
    status: 'open',
    lastMessageAt: 123,
    rows: [
      { mmsi: 'bad-lat', lat: 'not-a-number', lon: 4 },
      { mmsi: 'bad-lon', lat: 4, lon: undefined },
      { mmsi: 'valid', lat: 29.7, lon: -95.1 },
    ],
  };
  const snapshot = classifyAisFeedSnapshot(payload);
  assert.equal(snapshot.transportStatus, 'open');
  assert.equal(snapshot.lastMessageAt, 123);
  assert.equal(snapshot.rawRowCount, 3);
  assert.equal(snapshot.acceptedRowCount, 1);
  assert.deepEqual(snapshot.acceptedRows.map((row) => row.mmsi), ['valid']);
  assert.equal(snapshot.error, null);
});

test('raw rows that all fail normalization do not satisfy AIS product health', () => {
  const snapshot = classifyAisFeedSnapshot({
    status: 'open',
    lastMessageAt: 123,
    rows: [{ mmsi: 'invalid', lat: 'bad', lon: -95.1 }],
  });
  assert.equal(snapshot.rawRowCount, 1);
  assert.equal(snapshot.acceptedRowCount, 0);
  assert.equal(snapshot.error, 'awaiting usable AIS positions…');
});

test('accepted cached rows remain usable while transport reconnects', () => {
  const snapshot = classifyAisFeedSnapshot({
    status: 'connecting',
    refreshing: true,
    rows: [{ mmsi: 'cached', lat: 29.7, lon: -95.1 }],
  });
  assert.equal(snapshot.acceptedRowCount, 1);
  assert.equal(snapshot.error, null);
});

test('missing key with no rows surfaces a clean reason', () => {
  assert.equal(
    deriveAisFeedError({ status: 'missing-key', error: 'AISSTREAM_API_KEY is not set' }, 0),
    'AISSTREAM_API_KEY not set',
  );
});

test('socket error with no rows surfaces "feed down"', () => {
  assert.equal(deriveAisFeedError({ status: 'error', error: 'AISStream websocket error' }, 0), 'feed down');
});

test('closed feed with no rows surfaces "feed disconnected"', () => {
  assert.equal(deriveAisFeedError({ status: 'closed', error: null }, 0), 'feed disconnected');
});

test('non-open status but rows still flowing is treated as stale, not down (null)', () => {
  // e.g. reconnecting/refreshing while a cached buffer still serves rows.
  assert.equal(deriveAisFeedError({ status: 'connecting', error: null }, 30), null);
});

test('unknown status falls back to a generic reason and appends server detail', () => {
  assert.equal(
    deriveAisFeedError({ status: 'weird-state', error: 'something specific' }, 0),
    'feed unavailable (something specific)',
  );
});

test('missing status treated as healthy (older/other payload shapes) (null)', () => {
  assert.equal(deriveAisFeedError({ error: 'ignored' }, 0), null);
  assert.equal(deriveAisFeedError(null, 0), null);
});

// --- watchdog statuses -----------------------------------------------------
// The server reports feed health as live | stale | reconnecting | down. A
// degraded feed must stay visible even while cached vessels are still drawn.

test("'live' is the healthy status and reads exactly like the older 'open'", () => {
  assert.equal(deriveAisFeedError({ status: 'live', lastMessageAt: 1, error: null }, 42), null);
  assert.equal(
    deriveAisFeedError({ status: 'live', lastMessageAt: null, error: null }, 0),
    'awaiting first AIS message…',
  );
  assert.equal(
    deriveAisFeedError({ status: 'live', lastMessageAt: 123, error: null }, 0),
    'awaiting usable AIS positions…',
  );
});

test('a stale feed is surfaced even though cached vessels are still on screen', () => {
  assert.equal(
    deriveAisFeedError({ status: 'stale', silentForMs: 184_000, lastMessageAt: 5 }, 4_812),
    'feed silent 184s — no AIS data',
  );
});

test('a stale feed without a silence figure still says the feed is silent', () => {
  assert.equal(
    deriveAisFeedError({ status: 'stale', lastMessageAt: 5 }, 0),
    'feed silent — no AIS data',
  );
});

test('reconnecting reports which attempt is in flight, rows or no rows', () => {
  assert.equal(
    deriveAisFeedError({ status: 'reconnecting', reconnectAttempt: 2 }, 900),
    'reconnecting to feed… (attempt 2)',
  );
  assert.equal(deriveAisFeedError({ status: 'reconnecting' }, 0), 'reconnecting to feed…');
});

test('DOWN is a visible terminal state, not a silent retry', () => {
  assert.equal(
    deriveAisFeedError({ status: 'down', reconnectAttempt: 5 }, 1_200),
    'feed down — retrying slowly (attempt 5)',
  );
});

test('a rejected API key reads as actionable, not as a countdown', () => {
  assert.equal(
    deriveAisFeedError({ status: 'auth-failed', reconnectAttempt: 3 }, 4_000),
    'API key rejected — check AISSTREAM_API_KEY',
  );

  const runtime = makeFakeAisRuntime(1_000_000);
  _setAisRuntimeForTest(runtime.runtime);
  try {
    _applyAisFeedSnapshotForTest({}, {
      status: 'auth-failed',
      reconnectAttempt: 3,
      nextAttemptAt: 1_000_000 + 3_600_000,
      refreshing: true,
      rows: [],
    });
    assert.equal(
      aisLiveVesselsLayer.getStats().retryInSec, 0,
      'an hour-long countdown would imply waiting is the fix',
    );
  } finally {
    _setAisRuntimeForTest(null);
  }
});

test('a degraded feed reports its retry countdown to the chip', () => {
  const runtime = makeFakeAisRuntime(1_000_000);
  _setAisRuntimeForTest(runtime.runtime);
  try {
    _applyAisFeedSnapshotForTest({}, {
      status: 'reconnecting',
      reconnectAttempt: 3,
      nextAttemptAt: 1_060_000, // 60s past the fake clock
      refreshing: true,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getStats().retryInSec, 60);

    // A feed with nothing scheduled must not invent a countdown.
    _applyAisFeedSnapshotForTest({}, { status: 'live', lastMessageAt: 5, rows: [] });
    assert.equal(aisLiveVesselsLayer.getStats().retryInSec, 0);
  } finally {
    _setAisRuntimeForTest(null);
  }
});

test('a degraded feed keeps its reason through snapshot classification', () => {
  const snapshot = classifyAisFeedSnapshot({
    status: 'down',
    reconnectAttempt: 5,
    refreshing: true,
    rows: [{ mmsi: 'cached', lat: 29.7, lon: -95.1 }],
  });
  assert.equal(snapshot.acceptedRowCount, 1, 'the cached vessel is still drawable');
  assert.equal(snapshot.error, 'feed down — retrying slowly (attempt 5)');
});

function makeFakeAisRuntime(startMs = 1000) {
  let nowMs = startMs;
  let nextId = 0;
  const scheduled = [];
  const runtime = {
    now: () => nowMs,
    setTimeout(callback, delayMs) {
      const timer = {
        id: ++nextId,
        callback,
        dueAt: nowMs + delayMs,
        cleared: false,
        fired: false,
      };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  };
  return {
    runtime,
    scheduled,
    get nowMs() { return nowMs; },
    advance(deltaMs) {
      nowMs += deltaMs;
      let fired;
      do {
        fired = false;
        for (const timer of scheduled) {
          if (timer.cleared || timer.fired || timer.dueAt > nowMs) continue;
          timer.fired = true;
          timer.callback();
          fired = true;
        }
      } while (fired);
    },
    fireIgnoringClear(timer) {
      timer.callback();
    },
    activeCount() {
      return scheduled.filter((timer) => !timer.cleared && !timer.fired).length;
    },
  };
}

test('zero accepted rows preserve warm vessel selection, trail, and freshness timestamp', () => {
  const record = makeRecord();
  const trail = makeTrailSpy();
  _setVesselStateForTest({
    viewer: {},
    records: [record],
    selectedRecord: record,
    trail,
    trailMmsi: record.mmsi,
    trailPositions: [POS],
    loaded: true,
    lastUpdate: 456,
    transportStatus: 'open',
    lastMessageAt: 123,
  });
  try {
    const result = _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 789,
      rows: [{ mmsi: 'invalid', lat: 'bad', lon: 4 }],
    });
    assert.equal(result.reconciled, false);
    assert.deepEqual(_getVesselFeedStateForTest(), {
      count: 1,
      loaded: true,
      loading: false,
      loadingLabel: '',
      stale: true,
      error: 'awaiting usable AIS positions…',
      status: undefined,
      lastUpdate: 456,
      transportStatus: 'open',
      lastMessageAt: 789,
      rawRowCount: 1,
      acceptedRowCount: 0,
      selectedMmsi: record.mmsi,
      trailMmsi: record.mmsi,
      trailPositionCount: 1,
      sessionId: _getVesselFeedStateForTest().sessionId,
      firstConnectPhase: 'idle',
      firstConnectStartedAt: null,
      firstConnectDeadline: null,
    });
    assert.equal(trail.clearCalls, 0);
  } finally {
    _setVesselStateForTest({ enabled: false });
  }
});

test('open first load stays LOADING for one bounded first-connect grace period', () => {
  const clock = makeFakeAisRuntime();
  _setAisRuntimeForTest(clock.runtime);
  _setVesselStateForTest({ viewer: {}, records: [] });
  try {
    _beginAisSessionForTest();
    const result = _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: null,
      rows: [],
    });
    assert.equal(result.reconciled, false);
    const feed = _getVesselFeedStateForTest();
    assert.equal(feed.loaded, true);
    assert.equal(feed.count, 0);
    assert.equal(feed.lastUpdate, null);
    assert.equal(feed.stale, false);
    assert.equal(feed.loading, true);
    assert.equal(feed.loadingLabel, 'awaiting first AIS position…');
    assert.equal(feed.error, null);
    assert.equal(feed.status, undefined);
    assert.equal(feed.firstConnectPhase, 'loading');
    assert.equal(feed.firstConnectStartedAt, 1000);
    assert.equal(feed.firstConnectDeadline, 1000 + AIS_FIRST_CONNECT_GRACE_MS);
    assert.equal(layerFeedState(aisLiveVesselsLayer.getStats()), 'loading');
    assert.equal(feed.transportStatus, 'open');
    assert.equal(feed.lastMessageAt, null);
    assert.equal(feed.rawRowCount, 0);
    assert.equal(feed.acceptedRowCount, 0);

    clock.advance(AIS_FIRST_CONNECT_GRACE_MS - 1);
    assert.equal(_getVesselFeedStateForTest().loading, true);
    clock.advance(1);
    const expired = _getVesselFeedStateForTest();
    assert.equal(expired.loading, false);
    assert.equal(expired.error, 'awaiting first AIS message…');
    assert.equal(expired.status, 'unavailable');
    assert.equal(expired.firstConnectPhase, 'unavailable');
    assert.equal(layerFeedState(aisLiveVesselsLayer.getStats()), 'unavailable');
  } finally {
    _setVesselStateForTest({ enabled: false });
    _setAisRuntimeForTest();
  }
});

test('open and connecting polls do not restart the first-connect deadline', () => {
  const clock = makeFakeAisRuntime(5000);
  _setAisRuntimeForTest(clock.runtime);
  _setVesselStateForTest({ viewer: {}, records: [] });
  try {
    _beginAisSessionForTest();
    const initial = _getVesselFeedStateForTest();
    clock.advance(12000);
    _applyAisFeedSnapshotForTest({}, { status: 'connecting', rows: [] });
    _applyAisFeedSnapshotForTest({}, { status: 'open', lastMessageAt: 9, rows: [] });
    const afterPolls = _getVesselFeedStateForTest();
    assert.equal(afterPolls.firstConnectStartedAt, initial.firstConnectStartedAt);
    assert.equal(afterPolls.firstConnectDeadline, initial.firstConnectDeadline);
    assert.equal(clock.activeCount(), 1);
    assert.equal(afterPolls.loading, true);
    assert.equal(afterPolls.error, null);
  } finally {
    _setVesselStateForTest({ enabled: false });
    _setAisRuntimeForTest();
  }
});

test('definitive AIS transport failures end grace immediately', () => {
  const clock = makeFakeAisRuntime();
  _setAisRuntimeForTest(clock.runtime);
  _setVesselStateForTest({ viewer: {}, records: [] });
  try {
    _beginAisSessionForTest();
    _applyAisFeedSnapshotForTest({}, {
      status: 'missing-key',
      error: 'AISSTREAM_API_KEY is not set',
      rows: [],
    });
    const feed = _getVesselFeedStateForTest();
    assert.equal(feed.loading, false);
    assert.equal(feed.status, 'unavailable');
    assert.equal(feed.error, 'AISSTREAM_API_KEY not set');
    assert.equal(feed.firstConnectPhase, 'unavailable');
    assert.equal(clock.activeCount(), 0);
  } finally {
    _setVesselStateForTest({ enabled: false });
    _setAisRuntimeForTest();
  }
});

test('first accepted position ends grace and warm data survives later open silence', () => {
  const clock = makeFakeAisRuntime(7000);
  const record = makeRecord();
  _setAisRuntimeForTest(clock.runtime);
  _setVesselOverlayHostForTest({
    setEntries() {},
    setVisible() {},
    clearSource() {},
  });
  _setVesselStateForTest({ viewer: {}, records: [record] });
  try {
    _beginAisSessionForTest();
    const accepted = _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 12,
      rows: [{
        mmsi: record.mmsi,
        name: record.name,
        lat: 51.93,
        lon: 4.05,
      }],
    });
    assert.equal(accepted.reconciled, true);
    let feed = _getVesselFeedStateForTest();
    assert.equal(feed.loading, false);
    assert.equal(feed.firstConnectPhase, 'ready');
    assert.equal(feed.lastUpdate, 7000);
    assert.equal(feed.error, null);
    assert.equal(clock.activeCount(), 0);

    clock.advance(5000);
    const silent = _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 13,
      rows: [],
    });
    assert.equal(silent.reconciled, false);
    feed = _getVesselFeedStateForTest();
    assert.equal(feed.count, 1);
    assert.equal(feed.lastUpdate, 7000);
    assert.equal(feed.loading, false);
    assert.equal(feed.firstConnectPhase, 'ready');
    assert.equal(feed.stale, true);
    assert.equal(feed.error, 'awaiting usable AIS positions…');
  } finally {
    _setVesselStateForTest({ enabled: false });
    _setVesselOverlayHostForTest();
    _setAisRuntimeForTest();
  }
});

test('superseded first-connect timer cannot expire its replacement session', () => {
  const clock = makeFakeAisRuntime(11000);
  _setAisRuntimeForTest(clock.runtime);
  _setVesselStateForTest({ viewer: {}, records: [] });
  try {
    _beginAisSessionForTest();
    const oldTimer = clock.scheduled[0];
    const oldSessionId = _getVesselFeedStateForTest().sessionId;

    _setVesselStateForTest({ viewer: {}, records: [] });
    _beginAisSessionForTest();
    const replacement = _getVesselFeedStateForTest();
    assert.notEqual(replacement.sessionId, oldSessionId);
    assert.equal(replacement.firstConnectPhase, 'loading');

    clock.fireIgnoringClear(oldTimer);
    const afterStaleTimer = _getVesselFeedStateForTest();
    assert.equal(afterStaleTimer.sessionId, replacement.sessionId);
    assert.equal(afterStaleTimer.firstConnectPhase, 'loading');
    assert.equal(afterStaleTimer.firstConnectDeadline, replacement.firstConnectDeadline);
    assert.equal(afterStaleTimer.error, null);
  } finally {
    _setVesselStateForTest({ enabled: false });
    _setAisRuntimeForTest();
  }
});

function deferredFetchResponse() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function jsonResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

test('HTTP rejection ends first-connect grace without waiting for its deadline', async () => {
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const priorWindow = globalThis.window;
  const priorFetch = globalThis.fetch;
  const priorWarn = console.warn;
  const clock = makeFakeAisRuntime();
  globalThis.window = { location: { origin: 'http://localhost:4173' } };
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({
      status: 'missing-key',
      error: 'AISSTREAM_API_KEY is not set',
    }),
  });
  console.warn = () => {};
  _setAisRuntimeForTest(clock.runtime);
  _setVesselStateForTest({ viewer: {}, records: [] });
  try {
    _beginAisSessionForTest();
    await _loadLivePositionsForTest({});
    const feed = _getVesselFeedStateForTest();
    assert.equal(feed.loading, false);
    assert.equal(feed.status, 'unavailable');
    assert.equal(feed.error, 'AISSTREAM_API_KEY not set');
    assert.equal(feed.firstConnectPhase, 'unavailable');
    assert.equal(clock.activeCount(), 0);
  } finally {
    globalThis.fetch = priorFetch;
    console.warn = priorWarn;
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
    _setVesselStateForTest({ enabled: false });
    _setAisRuntimeForTest();
  }
});

/// ── Načítanie pri štarte na telefóne (2026-10-15, okolive.sk: NAČÍTANIE ZLYHALO) ──────────────
// Svet bez výrezu = ~22 MB JSON; pevných 10 s na telefóne počas štartu nestačilo a lehota prvého
// pripojenia (počítaná od zapnutia, kým požiadavka čakala na štart) vypršala uprostred prenosu.
// 2026-10-16: telefón nad 3 000 km lode ani nesťahuje (aisLoadDeferred); obnova sa tiež raz zopakuje.

/**
 * Prostredie pre loadLivePositions: okno (voliteľne dotykové), telefónny plášť (oko-mobile),
 * fetch, zachytený limit a hodiny.
 */
function installAisLoaderHarness({ coarse = false, mobile = false, responses = [], rowLimit = null } = {}) {
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const priorWindow = globalThis.window;
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  const priorWarn = console.warn;
  const priorTimeout = AbortSignal.timeout;
  const clock = makeFakeAisRuntime(1000);
  const requests = [];
  const timeouts = [];
  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
    matchMedia: (query) => ({ matches: coarse && query === '(pointer: coarse)' }),
  };
  if (mobile) {
    globalThis.document = {
      getElementById: () => null,
      body: { classList: { contains: (name) => name === 'oko-mobile' } },
    };
  }
  globalThis.fetch = (url) => {
    requests.push(new URL(url));
    const next = responses.shift();
    return typeof next === 'function' ? next() : next;
  };
  // Zachytí limit, ktorý loader dal požiadavke; signál bez skutočného časovača.
  AbortSignal.timeout = (ms) => { timeouts.push(ms); return new AbortController().signal; };
  console.warn = () => {};
  _setAisRuntimeForTest(clock.runtime);
  _setAisRenderRowLimitForTest(rowLimit);
  _setVesselOverlayHostForTest({ setEntries() {}, setVisible() {}, clearSource() {} });
  return {
    clock,
    requests,
    timeouts,
    cleanup() {
      globalThis.fetch = priorFetch;
      console.warn = priorWarn;
      AbortSignal.timeout = priorTimeout;
      if (hadWindow) globalThis.window = priorWindow;
      else delete globalThis.window;
      if (mobile) {
        if (hadDocument) globalThis.document = priorDocument;
        else delete globalThis.document;
      }
      _setVesselStateForTest({ enabled: false });
      _setVesselOverlayHostForTest();
      _setAisRenderRowLimitForTest();
      _setAisRuntimeForTest();
    },
  };
}

const flushAisLoad = () => new Promise((resolve) => setImmediate(resolve));
const timeoutError = () => Promise.reject(new DOMException('signal timed out', 'TimeoutError'));
const bboxViewer = () => ({
  camera: {
    positionCartographic: { height: 500_000 },
    computeViewRectangle: () => Cesium.Rectangle.fromDegrees(16, 47, 18, 49),
  },
});
/** Kamera s nastaviteľnou výškou a výrezom (telefón: zemeguľa → prelet → oblasť). */
const movableViewer = (heightM, rect = [16, 47, 18, 49]) => {
  const viewer = {
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(17, 48, heightM),
      positionCartographic: { height: heightM },
      computeViewRectangle: () => Cesium.Rectangle.fromDegrees(...viewer.rect),
    },
    rect,
  };
  return viewer;
};
const vesselRow = (record) => ({ mmsi: record.mmsi, name: record.name, lat: 51.93, lon: 4.05 });
/** Kolekcia ikon pre nové lode z odpovede (addRecordPrimitives). */
const fakeBillboards = () => ({ show: true, add: (options) => ({ ...options }), remove() {} });

test('aisLiveRequestPlan: plný strop riadkov všade; svet 25 s, výrez od 10 s rastie so šírkou po limit sveta', () => {
  assert.deepEqual(aisLiveRequestPlan({ bbox: '', rowLimit: 50000 }),
    { maxRows: 50000, timeoutMs: AIS_WORLD_TIMEOUT_MS });
  // malý výrez (mesto, ~4 štv. stupne): skoro bez zmeny
  const city = aisLiveRequestPlan({ bbox: '16.0000,47.0000,18.0000,49.0000', rowLimit: 50000 });
  assert.equal(city.maxRows, 50000, 'výrez naplno');
  assert.ok(city.timeoutMs >= AIS_VIEW_TIMEOUT_MS && city.timeoutMs < AIS_VIEW_TIMEOUT_MS + 1000, String(city.timeoutMs));
  // 20° × 20° = štvrtina AIS_WIDE_VIEW_DEG2 → polovica cesty (strana výrezu)
  assert.equal(aisLiveRequestPlan({ bbox: '0,40,20,60', rowLimit: 50000 }).timeoutMs,
    (AIS_VIEW_TIMEOUT_MS + AIS_WORLD_TIMEOUT_MS) / 2);
  // cez 180° poludník rovnako
  assert.equal(aisLiveRequestPlan({ bbox: '170,-10,-170,10', rowLimit: 50000 }).timeoutMs,
    (AIS_VIEW_TIMEOUT_MS + AIS_WORLD_TIMEOUT_MS) / 2);
  // pol Európy (kamera tesne pod 4 000 km, ~5,4 MB v snímke z 10. 10.): ako svet
  assert.ok(35 * 47 >= AIS_WIDE_VIEW_DEG2);
  assert.equal(aisLiveRequestPlan({ bbox: '0,25,35,72', rowLimit: 50000 }).timeoutMs, AIS_WORLD_TIMEOUT_MS);
  assert.equal(aisLiveRequestPlan({ bbox: 'nonsense', rowLimit: 50000 }).timeoutMs, AIS_VIEW_TIMEOUT_MS);
  assert.equal(aisLiveRequestPlan({ bbox: '', rowLimit: 12000 }).maxRows, 12000);
});

test('požiadavka: dotykové zariadenie pri pohľade na svet pýta plný strop (žiadne odpadávanie lodí); široký výrez má dlhý limit', async () => {
  const ok = () => Promise.resolve(jsonResponse({ status: 'open', lastMessageAt: 1, rows: [] }));
  // dotykový tablet / počítač s malou pamäťou bez telefónneho plášťa: lode sa kreslia aj zo sveta
  const touch = installAisLoaderHarness({ coarse: true, rowLimit: 50000, responses: [ok, ok, ok] });
  try {
    _setVesselStateForTest({ viewer: {}, records: [] });
    await _loadLivePositionsForTest({});
    assert.equal(touch.requests[0].searchParams.get('maxRows'), '50000', 'strop 15 000 menil ~18 % lodí pri každej obnove');
    assert.equal(touch.requests[0].searchParams.has('bbox'), false);
    assert.equal(touch.timeouts[0], AIS_WORLD_TIMEOUT_MS);

    const viewer = bboxViewer();
    _setVesselStateForTest({ viewer, records: [] });
    await _loadLivePositionsForTest(viewer);
    assert.equal(touch.requests[1].searchParams.get('maxRows'), '50000');
    assert.match(touch.requests[1].searchParams.get('bbox'), /^-?\d+\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4}$/);
    assert.ok(touch.timeouts[1] < AIS_VIEW_TIMEOUT_MS + 2000, 'malý výrez si drží ~10 s');

    // kamera tesne pod 4 000 km nad Európou: výrez skoro ako svet → limit sveta
    const wide = movableViewer(3_900_000, [-5, 30, 40, 70]);
    _setVesselStateForTest({ viewer: wide, records: [] });
    await _loadLivePositionsForTest(wide);
    assert.ok(touch.requests[2].searchParams.has('bbox'));
    assert.equal(touch.timeouts[2], AIS_WORLD_TIMEOUT_MS);
  } finally {
    touch.cleanup();
  }
});

for (const [label, failure] of [
  ['vypršaný limit', timeoutError],
  ['sieťová chyba', () => Promise.reject(new TypeError('Failed to fetch'))],
]) {
  test(`prvé načítanie (${label}) sa raz zopakuje namiesto NAČÍTANIE ZLYHALO a opakovanie dorazí`, async () => {
    const record = makeRecord();
    const harness = installAisLoaderHarness({
      responses: [failure, () => Promise.resolve(jsonResponse({
        status: 'open',
        lastMessageAt: 12,
        rows: [vesselRow(record)],
      }))],
    });
    try {
      _setVesselStateForTest({ viewer: {}, records: [record] });
      _beginAisSessionForTest();
      await _loadLivePositionsForTest({});
      let feed = _getVesselFeedStateForTest();
      assert.equal(harness.requests.length, 1);
      assert.equal(feed.firstConnectPhase, 'loading');
      assert.equal(feed.error, null, 'žiadna chyba počas čakania na opakovanie');
      assert.equal(feed.status, undefined);
      assert.equal(feed.loadingLabel, 'awaiting first AIS position…');
      assert.equal(layerFeedState(aisLiveVesselsLayer.getStats()), 'loading');

      harness.clock.advance(AIS_LOAD_RETRY_MS - 1);
      await flushAisLoad();
      assert.equal(harness.requests.length, 1, 'opakovanie až po AIS_LOAD_RETRY_MS');
      harness.clock.advance(1);
      await flushAisLoad();
      feed = _getVesselFeedStateForTest();
      assert.equal(harness.requests.length, 2);
      assert.equal(feed.firstConnectPhase, 'ready');
      assert.equal(feed.error, null);
      assert.equal(feed.count, 1);
      assert.equal(harness.clock.activeCount(), 0, 'lehota aj opakovanie upratané');
    } finally {
      harness.cleanup();
    }
  });
}

test('druhé prerušenie prvého načítania sa prizná; žiadne ďalšie opakovanie', async () => {
  const harness = installAisLoaderHarness({ responses: [timeoutError, timeoutError, timeoutError] });
  try {
    _setVesselStateForTest({ viewer: {}, records: [] });
    _beginAisSessionForTest();
    await _loadLivePositionsForTest({});
    harness.clock.advance(AIS_LOAD_RETRY_MS);
    await flushAisLoad();
    const feed = _getVesselFeedStateForTest();
    assert.equal(harness.requests.length, 2);
    assert.equal(feed.firstConnectPhase, 'unavailable');
    assert.equal(feed.status, 'unavailable');
    assert.equal(feed.error, 'signal timed out');
    assert.equal(harness.clock.activeCount(), 0);
    harness.clock.advance(10 * AIS_FIRST_CONNECT_GRACE_MS);
    await flushAisLoad();
    assert.equal(harness.requests.length, 2, 'opakovanie je jedno — zlyhané opakovanie sa neopakuje');
  } finally {
    harness.cleanup();
  }
});

test('obnova po prvých dátach, ktorej prenos vypršal, sa raz zopakuje — lode ostávajú a vrstva medzitým nehlási NAČÍTANIE ZLYHALO', async () => {
  const record = makeRecord();
  const okRows = () => Promise.resolve(jsonResponse({ status: 'open', lastMessageAt: 12, rows: [vesselRow(record)] }));
  const harness = installAisLoaderHarness({ responses: [okRows, timeoutError, okRows, timeoutError, timeoutError] });
  try {
    _setVesselStateForTest({ viewer: {}, records: [record] });
    _beginAisSessionForTest();
    await _loadLivePositionsForTest({});
    assert.equal(_getVesselFeedStateForTest().firstConnectPhase, 'ready');

    // obnova (široký výrez / pomalá sieť) vyprší raz
    await _loadLivePositionsForTest({});
    let feed = _getVesselFeedStateForTest();
    assert.equal(feed.status, undefined, 'nie unavailable — opakovanie čaká');
    assert.equal(feed.error, null);
    assert.equal(feed.count, 1, 'lode ostávajú');
    assert.equal(feed.loading, true, 'obnova ešte beží (opakovanie)');
    assert.equal(feed.loadingLabel, 'refreshing...');
    assert.notEqual(layerFeedState(aisLiveVesselsLayer.getStats()), 'unavailable');
    harness.clock.advance(AIS_LOAD_RETRY_MS);
    await flushAisLoad();
    feed = _getVesselFeedStateForTest();
    assert.equal(harness.requests.length, 3);
    assert.equal(feed.firstConnectPhase, 'ready');
    assert.equal(feed.error, null);
    assert.equal(feed.loading, false);
    assert.equal(harness.clock.activeCount(), 0);

    // obnova aj jej opakovanie vypršia: prizná sa ako doteraz, lode ostávajú ako staré
    await _loadLivePositionsForTest({});
    harness.clock.advance(AIS_LOAD_RETRY_MS);
    await flushAisLoad();
    feed = _getVesselFeedStateForTest();
    assert.equal(harness.requests.length, 5);
    assert.equal(feed.error, 'signal timed out');
    assert.equal(feed.status, 'unavailable');
    assert.equal(feed.stale, true, 'lode na mape ostávajú, označené ako staré');
    assert.equal(harness.clock.activeCount(), 0, 'žiadne ďalšie opakovanie');
  } finally {
    harness.cleanup();
  }
});

test('chyba spracovania odpovede sa neopakuje — prizná sa hneď (opakuje sa len prerušený prenos)', async () => {
  // Telo prišlo celé; TypeError vznikne až pri spracovaní (chyba v kóde, nie v sieti).
  const broken = () => Promise.resolve(jsonResponse({
    status: 'open',
    get rows() { throw new TypeError('rows unreadable'); },
  }));
  const harness = installAisLoaderHarness({ responses: [broken, broken] });
  try {
    _setVesselStateForTest({ viewer: {}, records: [] });
    _beginAisSessionForTest();
    await _loadLivePositionsForTest({});
    const feed = _getVesselFeedStateForTest();
    assert.equal(feed.status, 'unavailable');
    assert.equal(feed.error, 'rows unreadable');
    assert.equal(harness.clock.activeCount(), 0, 'žiadne naplánované opakovanie');
    harness.clock.advance(AIS_LOAD_RETRY_MS);
    await flushAisLoad();
    assert.equal(harness.requests.length, 1);
  } finally {
    harness.cleanup();
  }
});

test('lehota prvého pripojenia nevyprší, kým prvá požiadavka ešte beží; potom je ohraničená', async () => {
  const record = makeRecord();
  const inFlight = deferredFetchResponse();
  const slowEmpty = deferredFetchResponse();
  const harness = installAisLoaderHarness({ responses: [inFlight.promise, slowEmpty.promise] });
  try {
    // Štart na telefóne: požiadavka odišla až neskoro a prenos trvá cez koniec lehoty.
    _setVesselStateForTest({ viewer: {}, records: [record] });
    _beginAisSessionForTest();
    const load = _loadLivePositionsForTest({});
    harness.clock.advance(AIS_FIRST_CONNECT_GRACE_MS + 5000);
    let feed = _getVesselFeedStateForTest();
    assert.equal(feed.firstConnectPhase, 'loading');
    assert.equal(feed.error, null);
    assert.equal(layerFeedState(aisLiveVesselsLayer.getStats()), 'loading');
    inFlight.resolve(jsonResponse({
      status: 'open', lastMessageAt: 12, rows: [vesselRow(record)],
    }));
    await load;
    feed = _getVesselFeedStateForTest();
    assert.equal(feed.firstConnectPhase, 'ready');
    assert.equal(feed.error, null);
    assert.equal(harness.clock.activeCount(), 0);

    // Bez lodí po uplynutí lehoty: hneď ako požiadavka skončí, vrstva to prizná (nečaká donekonečna).
    _setVesselStateForTest({ viewer: {}, records: [] });
    _beginAisSessionForTest();
    const emptyLoad = _loadLivePositionsForTest({});
    harness.clock.advance(AIS_FIRST_CONNECT_GRACE_MS + 5000);
    slowEmpty.resolve(jsonResponse({ status: 'open', lastMessageAt: null, rows: [] }));
    await emptyLoad;
    assert.equal(_getVesselFeedStateForTest().firstConnectPhase, 'loading');
    harness.clock.advance(1000);
    feed = _getVesselFeedStateForTest();
    assert.equal(feed.firstConnectPhase, 'unavailable');
    assert.equal(feed.error, 'awaiting first AIS message…');
  } finally {
    harness.cleanup();
  }
});

test('lehota prvého pripojenia nevyprší ani počas čakania na opakovanie (limit vypršal až po lehote)', async () => {
  // Presná časová os telefónu: požiadavka odíde s bránou štartu (až 20 s), jej limit vyprší po
  // lehote 30 s a opakovanie čaká 2 s — kontrola lehoty v tej medzere nesmie vyhlásiť výpadok.
  const record = makeRecord();
  const inFlight = deferredFetchResponse();
  const harness = installAisLoaderHarness({
    responses: [inFlight.promise, () => Promise.resolve(jsonResponse({ status: 'open', lastMessageAt: 12, rows: [vesselRow(record)] }))],
  });
  try {
    _setVesselStateForTest({ viewer: {}, records: [record] });
    _beginAisSessionForTest();
    const load = _loadLivePositionsForTest({});
    harness.clock.advance(AIS_FIRST_CONNECT_GRACE_MS + 5000);
    inFlight.resolve(Promise.reject(new DOMException('signal timed out', 'TimeoutError')));
    await load;
    let feed = _getVesselFeedStateForTest();
    assert.equal(feed.loading, true, 'opakovanie čaká');
    assert.equal(feed.status, undefined);

    harness.clock.advance(AIS_LOAD_RETRY_MS / 2); // kontrola lehoty (raz za 1 s) počas čakania
    feed = _getVesselFeedStateForTest();
    assert.equal(feed.firstConnectPhase, 'loading', 'čakajúce opakovanie drží lehotu');
    assert.equal(feed.status, undefined);
    assert.equal(feed.error, null);

    harness.clock.advance(AIS_LOAD_RETRY_MS / 2);
    await flushAisLoad();
    feed = _getVesselFeedStateForTest();
    assert.equal(harness.requests.length, 2);
    assert.equal(feed.firstConnectPhase, 'ready');
    assert.equal(feed.error, null);
  } finally {
    harness.cleanup();
  }
});

test('aisLoadDeferred: len telefón nad 3 000 km, bez vybranej lode a bez potreby hľadania', () => {
  assert.equal(aisLoadDeferred({ mobile: true, cameraHeightM: 8_000_000 }), true);
  assert.equal(aisLoadDeferred({ mobile: true, cameraHeightM: MOBILE_SHIP_FAR_HIDE_M }), false);
  assert.equal(aisLoadDeferred({ mobile: true, cameraHeightM: 260_000 }), false);
  assert.equal(aisLoadDeferred({ mobile: false, cameraHeightM: 20_000_000 }), false, 'počítač lode kreslí aj zo sveta');
  assert.equal(aisLoadDeferred({ mobile: true, cameraHeightM: 8_000_000, selected: true }), false, 'karta vybranej lode sa obnovuje');
  assert.equal(aisLoadDeferred({ mobile: true, cameraHeightM: 8_000_000, demand: true }), false, 'hľadanie / sledovaná loď');
  assert.equal(aisLoadDeferred({ mobile: true }), false, 'bez kamery sa neodkladá');
});

test('telefón na úvodnej zemeguli lode nesťahuje: žiadna požiadavka, vrstva hovorí „priblíž", nikdy NAČÍTANIE ZLYHALO', async () => {
  const harness = installAisLoaderHarness({ mobile: true, responses: [] });
  try {
    const viewer = movableViewer(8_000_000);
    _setVesselStateForTest({ viewer, records: [], billboardCollection: fakeBillboards() });
    _beginAisSessionForTest();
    await _loadLivePositionsForTest(viewer);
    assert.equal(harness.requests.length, 0, 'zo zemegule sa nič nesťahuje (svet = ~22 MB)');
    let feed = _getVesselFeedStateForTest();
    assert.equal(feed.loading, false, 'nie večné načítavanie');
    assert.equal(feed.status, 'zoom-in');
    assert.equal(feed.error, null);
    assert.equal(feed.loadingLabel, t('ais.zoom-in-phone'));
    assert.ok(feed.loadingLabel && feed.loadingLabel !== 'ais.zoom-in-phone', 'preložený text');
    assert.equal(layerFeedState(aisLiveVesselsLayer.getStats()), 'nominal');
    assert.equal(harness.clock.activeCount(), 0, 'lehota prvého pripojenia neplynie');

    // ostane na zemeguli dlho (vložený rámček, prelet zrušený): stále len výzva, nie výpadok
    harness.clock.advance(10 * AIS_FIRST_CONNECT_GRACE_MS);
    await _loadLivePositionsForTest(viewer); // periodická obnova
    feed = _getVesselFeedStateForTest();
    assert.equal(harness.requests.length, 0);
    assert.equal(feed.status, 'zoom-in');
    assert.equal(feed.firstConnectPhase, 'loading');
    assert.equal(feed.error, null);
  } finally {
    harness.cleanup();
  }
});

test('telefón: po prelete pod 3 000 km sa lode načítajú, až keď kamera dosadne; lehota začne plynúť až vtedy', async () => {
  const record = makeRecord();
  const harness = installAisLoaderHarness({
    mobile: true,
    responses: [() => Promise.resolve(jsonResponse({ status: 'open', lastMessageAt: 12, rows: [vesselRow(record)] }))],
  });
  try {
    const viewer = movableViewer(8_000_000);
    _setVesselStateForTest({ viewer, records: [], billboardCollection: fakeBillboards() });
    _beginAisSessionForTest();
    await _loadLivePositionsForTest(viewer);
    assert.equal(_viewChangeTickForTest(viewer, 100_000), false, 'zo zemegule sa ani nepýta');
    assert.equal(_getAisDeferredStateForTest().farHidden, true);

    // prelet: kamera klesla pod 3 000 km
    viewer.camera.positionCartographic.height = 2_000_000;
    assert.equal(_viewChangeTickForTest(viewer, 101_000), false, 'práve dosadla — čaká');
    assert.equal(_getAisDeferredStateForTest().farHidden, false);
    assert.equal(_viewChangeTickForTest(viewer, 101_600), false, 'po 600 ms ešte nie (počítač by už pýtal)');
    // návštevník sa hneď vzdiali späť nad 3 000 km: lode skryté, nič sa nepýta, hoci sa výrez zmenil
    viewer.camera.positionCartographic.height = 8_000_000;
    assert.equal(_viewChangeTickForTest(viewer, 103_000), false, 'nad 3 000 km sa nepýta');
    assert.equal(_getAisDeferredStateForTest().farHidden, true);
    viewer.camera.positionCartographic.height = 2_000_000;
    assert.equal(_viewChangeTickForTest(viewer, 104_000), false);
    assert.equal(_viewChangeTickForTest(viewer, 104_000 + 1300), true, 'kamera stojí — načítať');

    viewer.camera.positionCartographic.height = 260_000;
    harness.clock.advance(5 * AIS_FIRST_CONNECT_GRACE_MS); // dlhá zemeguľa lehotu nespotrebovala
    await _loadLivePositionsForTest(viewer);
    assert.equal(harness.requests.length, 1);
    assert.ok(harness.requests[0].searchParams.has('bbox'), 'prvá požiadavka telefónu je výrez, nie svet');
    let feed = _getVesselFeedStateForTest();
    assert.equal(feed.firstConnectPhase, 'ready');
    assert.equal(feed.count, 1);
    assert.equal(feed.status, undefined);
    assert.equal(_getAisDeferredStateForTest().deferred, false);
  } finally {
    harness.cleanup();
  }
});

test('telefón: lehota prvého pripojenia sa natiahne nanovo, keď odíde prvá požiadavka', async () => {
  const pending = deferredFetchResponse();
  const harness = installAisLoaderHarness({ mobile: true, responses: [pending.promise] });
  try {
    const viewer = movableViewer(8_000_000);
    _setVesselStateForTest({ viewer, records: [], billboardCollection: fakeBillboards() });
    _beginAisSessionForTest();
    await _loadLivePositionsForTest(viewer);
    harness.clock.advance(3 * AIS_FIRST_CONNECT_GRACE_MS);
    viewer.camera.positionCartographic.height = 260_000;
    const load = _loadLivePositionsForTest(viewer);
    const feed = _getVesselFeedStateForTest();
    assert.equal(feed.firstConnectDeadline, harness.clock.nowMs + AIS_FIRST_CONNECT_GRACE_MS);
    assert.equal(feed.loading, true);
    assert.equal(feed.status, undefined, 'počas požiadavky už nie „priblíž"');
    pending.resolve(jsonResponse({ status: 'open', lastMessageAt: null, rows: [] }));
    await load;
    harness.clock.advance(AIS_FIRST_CONNECT_GRACE_MS);
    assert.equal(_getVesselFeedStateForTest().status, 'unavailable', 'lehota je stále ohraničená');
  } finally {
    harness.cleanup();
  }
});

test('telefón nad 3 000 km: hľadanie a sledovaná loď lode načítajú hneď (svet) a nájdu živú loď', async () => {
  const record = makeRecord({ name: 'NORDIC STAR' });
  const loaded = deferredFetchResponse();
  const harness = installAisLoaderHarness({ mobile: true, rowLimit: 50000, responses: [loaded.promise] });
  try {
    const viewer = movableViewer(8_000_000);
    _setVesselStateForTest({ viewer, records: [], billboardCollection: fakeBillboards() });
    _beginAisSessionForTest();
    await _loadLivePositionsForTest(viewer);
    assert.equal(harness.requests.length, 0);

    // písanie v palete: v pamäti nič, no hľadanie spustí načítanie
    assert.deepEqual(aisLiveVesselsLayer.searchVessels('NORDIC'), []);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].searchParams.has('bbox'), false, 'kamera je nad 4 000 km → svet');
    assert.equal(harness.requests[0].searchParams.get('maxRows'), '50000');
    assert.equal(harness.timeouts[0], AIS_WORLD_TIMEOUT_MS);
    assert.equal(_getVesselFeedStateForTest().loading, true);
    assert.equal(_getVesselFeedStateForTest().status, undefined);

    // sledovaná loď / klik vo výsledkoch servera čaká na to isté načítanie (druhá požiadavka nejde)
    const waiting = aisLiveVesselsLayer.whenLiveData();
    loaded.resolve(jsonResponse({ status: 'open', lastMessageAt: 12, rows: [{ ...vesselRow(record), name: 'NORDIC STAR' }] }));
    assert.equal(await waiting, true);
    assert.equal(harness.requests.length, 1);
    assert.deepEqual(aisLiveVesselsLayer.searchVessels('NORDIC').map((hit) => hit.mmsi), [record.mmsi]);
    assert.equal(_getVesselFeedStateForTest().firstConnectPhase, 'ready');

    // ďalšia obnova zo zemegule sa opäť odloží (dáta ostávajú v pamäti)
    await _loadLivePositionsForTest(viewer);
    assert.equal(harness.requests.length, 1);
    assert.equal(_getVesselFeedStateForTest().status, 'zoom-in');
    assert.equal(_getVesselFeedStateForTest().count, 1);
  } finally {
    harness.cleanup();
  }
});

test('telefón nad 3 000 km: prerušené načítanie na požiadanie sa zopakuje — opakovanie sa neodloží', async () => {
  const record = makeRecord();
  const harness = installAisLoaderHarness({
    mobile: true,
    responses: [timeoutError, () => Promise.resolve(jsonResponse({ status: 'open', lastMessageAt: 12, rows: [vesselRow(record)] }))],
  });
  try {
    const viewer = movableViewer(8_000_000);
    _setVesselStateForTest({ viewer, records: [], billboardCollection: fakeBillboards() });
    _beginAisSessionForTest();
    await _loadLivePositionsForTest(viewer);
    assert.equal(await aisLiveVesselsLayer.whenLiveData(), true);
    assert.equal(harness.requests.length, 1);
    assert.equal(_getVesselFeedStateForTest().status, undefined, 'nie „priblíž" ani výpadok — opakovanie čaká');
    harness.clock.advance(AIS_LOAD_RETRY_MS);
    await flushAisLoad();
    assert.equal(harness.requests.length, 2, 'kamera je stále nad 3 000 km, no opakovanie ide');
    assert.equal(_getVesselFeedStateForTest().firstConnectPhase, 'ready');
    assert.equal(_getVesselFeedStateForTest().count, 1);
  } finally {
    harness.cleanup();
  }
});

test('whenLiveData bez odloženia nič nesťahuje (počítač, priblížený telefón)', async () => {
  const harness = installAisLoaderHarness({ responses: [] });
  try {
    _setVesselStateForTest({ viewer: movableViewer(20_000_000), records: [] });
    assert.equal(await aisLiveVesselsLayer.whenLiveData(), false);
    assert.equal(harness.requests.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('superseded AIS response cannot mutate or finalize a replacement request', async () => {
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const priorWindow = globalThis.window;
  const priorFetch = globalThis.fetch;
  const first = deferredFetchResponse();
  const second = deferredFetchResponse();
  const queue = [first, second];
  globalThis.window = { location: { origin: 'http://localhost:4173' } };
  globalThis.fetch = () => queue.shift().promise;
  const oldRecord = makeRecord({ name: 'OLD' });
  const replacement = makeRecord({ name: 'REPLACEMENT' });
  const replacementTrail = makeTrailSpy();
  try {
    _setVesselStateForTest({ viewer: {}, records: [oldRecord], loaded: true, lastUpdate: 100 });
    const oldLoad = _loadLivePositionsForTest({});

    // Simulate destroy/re-init replacement. The old fetch intentionally ignores abort.
    _setVesselStateForTest({
      viewer: {},
      records: [replacement],
      selectedRecord: replacement,
      trail: replacementTrail,
      trailMmsi: replacement.mmsi,
      trailPositions: [POS],
      loaded: true,
      lastUpdate: 200,
    });
    const replacementLoad = _loadLivePositionsForTest({});

    first.resolve(jsonResponse({
      status: 'open',
      lastMessageAt: 1000,
      rows: [{ mmsi: oldRecord.mmsi, name: 'STALE RESPONSE', lat: 1, lon: 2 }],
    }));
    await oldLoad;
    let feed = _getVesselFeedStateForTest();
    assert.equal(feed.loading, true, 'old finally must not clear replacement loading ownership');
    assert.equal(feed.lastUpdate, 200, 'old response must not advance replacement freshness');
    assert.equal(feed.selectedMmsi, replacement.mmsi);

    second.resolve(jsonResponse({ status: 'open', lastMessageAt: null, rows: [] }));
    await replacementLoad;
    feed = _getVesselFeedStateForTest();
    assert.equal(feed.loading, false);
    assert.equal(feed.lastUpdate, 200);
    assert.equal(feed.error, 'awaiting first AIS message…');
    assert.equal(feed.stale, true);
    assert.equal(feed.selectedMmsi, replacement.mmsi);
    assert.equal(feed.trailMmsi, replacement.mmsi);
    assert.equal(replacementTrail.clearCalls, 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
    _setVesselStateForTest({ enabled: false });
  }
});

test('disable and destroy make abort-ignoring AIS responses inert', async () => {
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  const windowTarget = new EventTarget();
  windowTarget.location = { origin: 'http://localhost:4173' };
  globalThis.window = windowTarget;
  globalThis.document = { getElementById: () => null };
  try {
    const disableResponse = deferredFetchResponse();
    globalThis.fetch = () => disableResponse.promise;
    const record = makeRecord();
    _setVesselStateForTest({ viewer: {}, records: [record], loaded: true, lastUpdate: 300 });
    const disabledLoad = _loadLivePositionsForTest({});
    aisLiveVesselsLayer.disable();
    disableResponse.resolve(jsonResponse({
      status: 'open',
      lastMessageAt: 1000,
      rows: [{ mmsi: record.mmsi, lat: 1, lon: 2 }],
    }));
    await disabledLoad;
    let feed = _getVesselFeedStateForTest();
    assert.equal(feed.lastUpdate, 300);
    assert.equal(feed.loading, false);

    const destroyResponse = deferredFetchResponse();
    globalThis.fetch = () => destroyResponse.promise;
    const viewer = { scene: { primitives: { remove() {} } } };
    _setVesselStateForTest({ viewer, records: [record], loaded: true, lastUpdate: 400 });
    const destroyedLoad = _loadLivePositionsForTest(viewer);
    aisLiveVesselsLayer.destroy(viewer);
    destroyResponse.resolve(jsonResponse({
      status: 'open',
      lastMessageAt: 2000,
      rows: [{ mmsi: record.mmsi, lat: 3, lon: 4 }],
    }));
    await destroyedLoad;
    feed = _getVesselFeedStateForTest();
    assert.equal(feed.count, 0);
    assert.equal(feed.lastUpdate, null);
    assert.equal(feed.transportStatus, null);
    assert.equal(feed.loading, false);
  } finally {
    globalThis.fetch = priorFetch;
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
    if (hadDocument) globalThis.document = priorDocument;
    else delete globalThis.document;
    _setVesselStateForTest({ enabled: false });
  }
});

test('vessel focus wire animates alpha with deadband and restores after tracking ends', () => {
  let writes = 0;
  const makeColor = (alpha) => ({ alpha, withAlpha: (next) => makeColor(next) });
  let color = makeColor(1);
  const billboard = {
    position: { x: 1, y: 2, z: 3 },
    show: true,
    get color() { return color; },
    set color(next) { writes += 1; color = next; },
  };
  const records = [{ position: billboard.position, billboard }];
  const target = {
    screenRect: { left: 40, top: 40, right: 60, bottom: 60 },
    paddingPx: 0,
    cameraDistance: 1000,
  };
  const params = {
    paddingPx: 0,
    dimFloor: 0.25,
    nearerBehavior: 'allow',
    hysteresisPx: 6,
    distanceHysteresisRatio: 0.08,
    attackMs: 300,
    releaseMs: 600,
    writeEpsilon: 0.005,
  };
  let activeCount = 0;
  const apply = (nowMs, focusTarget) => {
    const result = applyVesselFocusDeemphasis({
      records,
      target: focusTarget,
      previousActiveCount: activeCount,
      nowMs,
      screenPositionFor: () => ({ x: 50, y: 50 }),
      cameraDistanceFor: () => 1200,
      params,
    });
    activeCount = result.activeCount;
    return result;
  };

  assert.equal(apply(0, target).writes, 0);
  assert.equal(apply(150, target).writes, 1);
  assert.ok(color.alpha > 0.25 && color.alpha < 1);
  assert.equal(apply(150, target).writes, 0, 'same timestamp stays inside deadband');
  assert.equal(apply(300, target).writes, 1);
  assert.equal(color.alpha, 0.25);
  assert.equal(apply(300, null).writes, 0, 'release starts continuously from the floor');
  assert.equal(apply(600, null).writes, 1);
  assert.ok(color.alpha > 0.25 && color.alpha < 1);
  assert.equal(apply(900, null).writes, 1);
  assert.equal(color.alpha, 1);
  assert.equal(apply(901, null).writes, 0, 'settled restoration causes no churn');
  assert.equal(writes, 4);
});

test('vessel focus wire performs no alpha writes when nothing has been tracked', () => {
  let writes = 0;
  const billboard = {
    position: { x: 0, y: 0, z: 0 },
    show: true,
    get color() { return { alpha: 1 }; },
    set color(_next) { writes += 1; },
  };
  const result = applyVesselFocusDeemphasis({
    records: [{ position: billboard.position, billboard }],
    target: null,
    nowMs: 100,
    screenPositionFor: () => ({ x: 50, y: 50 }),
    cameraDistanceFor: () => 1200,
  });
  assert.deepEqual(result, {
    writes: 0,
    transitioning: false,
    activeCount: 0,
    ran: false,
  });
  assert.equal(writes, 0);
});

test('vessel focus wire restores a hidden sprite before releasing the active pass', () => {
  const makeColor = (alpha) => ({ alpha, withAlpha: (next) => makeColor(next) });
  const billboard = {
    position: { x: 1, y: 2, z: 3 },
    show: true,
    color: makeColor(1),
  };
  const records = [{ billboard }];
  const target = {
    screenRect: { left: 40, top: 40, right: 60, bottom: 60 },
    paddingPx: 0,
    cameraDistance: 1000,
  };
  const params = {
    paddingPx: 0,
    dimFloor: 0.25,
    nearerBehavior: 'allow',
    attackMs: 300,
    releaseMs: 600,
    writeEpsilon: 0.005,
  };
  const pass = (nowMs, focusTarget, previousActiveCount) => applyVesselFocusDeemphasis({
    records,
    target: focusTarget,
    previousActiveCount,
    nowMs,
    screenPositionFor: () => ({ x: 50, y: 50 }),
    cameraDistanceFor: () => 1200,
    params,
  });

  pass(0, target, 0);
  const dimmed = pass(params.attackMs, target, 0);
  assert.equal(dimmed.activeCount, 1);
  assert.equal(billboard.color.alpha, params.dimFloor);

  billboard.show = false;
  const releaseStart = pass(params.attackMs, null, dimmed.activeCount);
  const restored = pass(params.attackMs + params.releaseMs, null, releaseStart.activeCount);
  assert.equal(restored.ran, true);
  assert.equal(restored.activeCount, 0);
  assert.equal(restored.writes, 1);
  assert.equal(billboard.color.alpha, 1);
});

// --- Selection gestures (FB-1) ---------------------------------------------

test('vessel selection: empty-space click requests deselection', () => {
  assert.deepEqual(
    reduceVesselSelection({ selectedMmsi: '353136000', gesture: 'click' }),
    { action: 'deselect' },
  );
});

test('vessel selection: no selection plus empty-space click is a no-op', () => {
  assert.deepEqual(
    reduceVesselSelection({ selectedMmsi: null, pickedMmsi: null, gesture: 'click' }),
    { action: 'none' },
  );
});

test('vessel selection: Escape deselects only when this layer owns a selection', () => {
  assert.deepEqual(
    reduceVesselSelection({ selectedMmsi: 353136000, gesture: 'escape' }),
    { action: 'deselect' },
  );
  assert.deepEqual(
    reduceVesselSelection({ gesture: 'escape' }),
    { action: 'none' },
  );
});

test('vessel selection: another vessel replaces selection; same vessel is a no-op', () => {
  assert.deepEqual(
    reduceVesselSelection({
      selectedMmsi: '353136000',
      pickedMmsi: '367123450',
      gesture: 'click',
    }),
    { action: 'select' },
  );
  assert.deepEqual(
    reduceVesselSelection({
      selectedMmsi: '353136000',
      pickedMmsi: '353136000',
      gesture: 'click',
    }),
    { action: 'none' },
  );
});

// ─── canvas-card builders (LabelCollection → canvas-card migration) ──────────
// Card models are pure: they read a vessel record and return a vesselLabels
// entry ({position, gapPx, accent, title, details, selected}). Positions pass
// through untouched (height-datum caveat: vessels anchor at their current
// rendered positions — no datum work here).

const POS = Cesium.Cartesian3.fromDegrees(4.05, 51.93, 3);

function makeRecord(overrides = {}) {
  return {
    name: 'EVER GIVEN',
    mmsi: '353136000',
    type: 'Container Ship',
    destination: '',
    speed: 14.53,
    course: 230.6,
    heading: 231.2,
    lastPositionUtc: '',
    missedRefreshes: 0,
    position: POS,
    billboard: null,
    ...overrides,
  };
}

function makeTrailSpy() {
  return {
    clearCalls: 0,
    clear() { this.clearCalls += 1; },
    setPositions() {},
    destroy() {},
  };
}

function makeClassList(...initial) {
  const classes = new Set(initial);
  return {
    add(value) { classes.add(value); },
    remove(value) { classes.delete(value); },
    contains(value) { return classes.has(value); },
  };
}

function makeInteractionHandler() {
  return {
    click: null,
    destroyCalls: 0,
    setInputAction(callback) { this.click = callback; },
    destroy() {
      this.destroyCalls += 1;
      this.click = null;
    },
  };
}

function makeCesiumEvent() {
  const listeners = new Set();
  return {
    addCalls: 0,
    removeCalls: 0,
    addEventListener(callback) {
      this.addCalls += 1;
      listeners.add(callback);
      return () => {
        if (listeners.delete(callback)) this.removeCalls += 1;
      };
    },
    raise() {
      for (const callback of [...listeners]) callback();
    },
    get listenerCount() { return listeners.size; },
  };
}

function installWireHarness(picked, stateOverrides = {}) {
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const windowTarget = new EventTarget();
  windowTarget.location = { origin: 'http://localhost:4173' };
  const keyTarget = {
    keydown: null,
    added: [],
    removed: [],
    addEventListener(type, callback) {
      if (type !== 'keydown') return;
      this.added.push({ type, callback });
      this.keydown = callback;
    },
    removeEventListener(type, callback) {
      if (type !== 'keydown') return;
      this.removed.push({ type, callback });
      if (this.keydown === callback) this.keydown = null;
    },
    dispatch(event) { this.keydown?.(event); },
  };
  const handler = makeInteractionHandler();
  const reinstalledHandlers = [];
  const interactionHandlerFactory = () => {
    const next = makeInteractionHandler();
    reinstalledHandlers.push(next);
    return next;
  };
  const trackedEntityChanged = makeCesiumEvent();
  const viewer = {
    scene: { pick: () => picked },
    trackedEntity: undefined,
    trackedEntityChanged,
  };
  const record = makeRecord();
  const trail = makeTrailSpy();
  const hud = {
    textContent: `AIS: ${record.name}`,
    classList: makeClassList('active'),
  };

  globalThis.window = windowTarget;
  globalThis.document = {
    getElementById: (id) => (id === 'hud-ais-vessel' ? hud : null),
  };
  _setVesselStateForTest({
    records: [record],
    selectedRecord: record,
    trail,
    trailMmsi: record.mmsi,
    trailPositions: [POS],
    interactionHandlerFactory,
    interactionKeyTarget: keyTarget,
    ...stateOverrides,
  });
  _bindVesselInteractionForTest(viewer, handler, keyTarget);

  return {
    handler,
    keyTarget,
    record,
    trail,
    hud,
    viewer,
    windowTarget,
    reinstalledHandlers,
    interactionHandlerFactory,
    cleanup() {
      aisLiveVesselsLayer.destroy();
      if (hadWindow) globalThis.window = priorWindow;
      else delete globalThis.window;
      if (hadDocument) globalThis.document = priorDocument;
      else delete globalThis.document;
    },
  };
}

test('vessel interaction wire: trail pick does not deselect', () => {
  const harness = installWireHarness({ id: 'gev-trail:71' });
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(harness.trail.clearCalls, 0);
    assert.equal(_getVesselStateForTest().trailMmsi, harness.record.mmsi);
  } finally {
    harness.cleanup();
  }
});

test('vessel interaction wire: only the gev-trail: namespace receives the trail no-op', () => {
  const harness = installWireHarness({ id: 'gev-trailing-contact' });
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo(), null);
    assert.equal(harness.trail.clearCalls, 1);
  } finally {
    harness.cleanup();
  }
});

test('vessel interaction wire: flights-owned pick preserves vessel selection', () => {
  registerPickOwner('flights', (pickedId) => pickedId === 'a1b2c3');
  const harness = installWireHarness({ id: 'a1b2c3' });
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(harness.trail.clearCalls, 0);
  } finally {
    harness.cleanup();
    unregisterPickOwner('flights');
  }
});

test('vessel interaction wire: CCTV-owned pick preserves vessel selection', () => {
  registerPickOwner('cctv', (pickedId) => pickedId === 'atx-cam-3');
  const harness = installWireHarness({ id: 'atx-cam-3' });
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(harness.trail.clearCalls, 0);
  } finally {
    harness.cleanup();
    unregisterPickOwner('cctv');
  }
});

test('vessel interaction wire: own-layer unkeyed record pick does not deselect', () => {
  const harness = installWireHarness({ id: makeRecord({ mmsi: undefined }) });
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(harness.trail.clearCalls, 0);
  } finally {
    harness.cleanup();
  }
});

test('vessel interaction wire: own-shaped evicted record pick does not deselect', () => {
  const harness = installWireHarness({ id: makeRecord({ mmsi: '999999999' }) });
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(harness.trail.clearCalls, 0);
  } finally {
    harness.cleanup();
  }
});

test('vessel interaction wire: id-less 3D Tiles pick deselects and resets the HUD', () => {
  const harness = installWireHarness({ primitive: {}, content: {}, featureId: 0 });
  const cleared = [];
  try {
    registerEntityContext(harness.record, {
      id: `ais-${harness.record.mmsi}`,
      layerId: 'ais-live-vessels',
      label: harness.record.name,
    });
    selectEntityContext(harness.record);
    harness.windowTarget.addEventListener('gev:entity-selection-cleared', (event) => {
      cleared.push(event.detail);
    });

    harness.handler.click({ position: { x: 10, y: 20 } });

    assert.equal(aisLiveVesselsLayer.getSelectedInfo(), null);
    assert.equal(harness.hud.textContent, 'AIS: --');
    assert.equal(harness.hud.classList.contains('active'), false);
    // Clicking away is a deliberate deselect, not the vessel aging out of the
    // feed. Consumers that keep a readout on screen (the Cockpit Contact
    // panel) tear down on 'deliberate' and hold last-known on 'evicted'.
    assert.deepEqual(cleared, [{ layerId: 'ais-live-vessels', reason: 'deliberate' }]);
  } finally {
    harness.cleanup();
  }
});

test('vessel interaction wire: empty pick deselects and emits gev:entity-selection-cleared', () => {
  const harness = installWireHarness(undefined);
  const cleared = [];
  try {
    registerEntityContext(harness.record, {
      id: `ais-${harness.record.mmsi}`,
      layerId: 'ais-live-vessels',
      label: harness.record.name,
    });
    selectEntityContext(harness.record);
    harness.windowTarget.addEventListener('gev:entity-selection-cleared', (event) => {
      cleared.push(event.detail);
    });

    harness.handler.click({ position: { x: 10, y: 20 } });

    assert.equal(aisLiveVesselsLayer.getSelectedInfo(), null);
    assert.equal(harness.hud.textContent, 'AIS: --');
    assert.equal(harness.hud.classList.contains('active'), false);
    // Empty pick is a deliberate deselect — see the note above.
    assert.deepEqual(cleared, [{ layerId: 'ais-live-vessels', reason: 'deliberate' }]);
  } finally {
    harness.cleanup();
  }
});

test('vessel interaction wire: Escape deselects the selected vessel', () => {
  const harness = installWireHarness(undefined);
  try {
    harness.keyTarget.dispatch({ key: 'Escape' });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo(), null);
    assert.equal(harness.hud.textContent, 'AIS: --');
    assert.equal(harness.hud.classList.contains('active'), false);
  } finally {
    harness.cleanup();
  }
});

test('vessel interaction wire: trackedEntityChanged clears only with tracking and a selection', () => {
  const harness = installWireHarness(undefined);
  try {
    harness.viewer.trackedEntityChanged.raise();
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(harness.trail.clearCalls, 0);

    harness.viewer.trackedEntity = { id: 'tracked-flight' };
    harness.viewer.trackedEntityChanged.raise();
    assert.equal(aisLiveVesselsLayer.getSelectedInfo(), null);
    assert.equal(harness.trail.clearCalls, 1);

    harness.viewer.trackedEntityChanged.raise();
    assert.equal(harness.trail.clearCalls, 1);
  } finally {
    harness.cleanup();
  }
});

test('vessel interaction lifecycle: destroy removes the exact bound keydown listener', () => {
  const harness = installWireHarness(undefined);
  try {
    const added = harness.keyTarget.added[0];
    aisLiveVesselsLayer.destroy();

    assert.equal(harness.handler.destroyCalls, 1);
    assert.equal(harness.keyTarget.removed.length, 1);
    assert.equal(harness.keyTarget.removed[0].type, 'keydown');
    assert.strictEqual(harness.keyTarget.removed[0].callback, added.callback);
    assert.equal(harness.keyTarget.keydown, null);
    assert.equal(harness.viewer.trackedEntityChanged.removeCalls, 1);
    assert.equal(harness.viewer.trackedEntityChanged.listenerCount, 0);
  } finally {
    harness.cleanup();
  }
});

test('vessel interaction lifecycle: disable detaches input and enable reinstalls it', async () => {
  const harness = installWireHarness(undefined);
  const priorFetch = globalThis.fetch;
  try {
    const disabledClick = harness.handler.click;
    const disabledKeydown = harness.keyTarget.keydown;
    aisLiveVesselsLayer.disable();

    assert.equal(harness.handler.destroyCalls, 1);
    assert.equal(harness.handler.click, null);
    assert.equal(harness.keyTarget.keydown, null);
    assert.equal(harness.keyTarget.removed.length, 1);
    assert.strictEqual(harness.keyTarget.removed[0].callback, disabledKeydown);
    assert.equal(harness.viewer.trackedEntityChanged.removeCalls, 1);
    assert.equal(harness.viewer.trackedEntityChanged.listenerCount, 0);

    _setVesselStateForTest({
      records: [harness.record],
      selectedRecord: harness.record,
      enabled: false,
      trail: harness.trail,
      trailMmsi: harness.record.mmsi,
      trailPositions: [POS],
      interactionHandlerFactory: harness.interactionHandlerFactory,
      interactionKeyTarget: harness.keyTarget,
    });
    disabledClick({ position: { x: 10, y: 20 } });
    disabledKeydown({ key: 'Escape' });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ status: 'open', rows: [] }),
    });
    await aisLiveVesselsLayer.enable(harness.viewer);

    assert.equal(harness.reinstalledHandlers.length, 1);
    assert.equal(harness.keyTarget.added.length, 2);
    assert.equal(harness.viewer.trackedEntityChanged.addCalls, 2);
    assert.equal(harness.viewer.trackedEntityChanged.listenerCount, 1);
    const reinstalled = harness.reinstalledHandlers[0];
    reinstalled.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo(), null);

    assert.equal(aisLiveVesselsLayer.selectById(harness.record.mmsi), true);
    harness.keyTarget.dispatch({ key: 'Escape' });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo(), null);
  } finally {
    globalThis.fetch = priorFetch;
    harness.cleanup();
  }
});

test('enable owns one grace timer and disable/re-enable starts a new session', async () => {
  const harness = installWireHarness(undefined, { enabled: false });
  const priorFetch = globalThis.fetch;
  const clock = makeFakeAisRuntime(20000);
  _setAisRuntimeForTest(clock.runtime);
  globalThis.fetch = async () => jsonResponse({ status: 'open', rows: [] });
  try {
    await aisLiveVesselsLayer.enable(harness.viewer);
    const first = _getVesselFeedStateForTest();
    assert.equal(first.firstConnectPhase, 'loading');
    assert.equal(clock.activeCount(), 1);

    clock.advance(5000);
    await aisLiveVesselsLayer.enable(harness.viewer);
    const duplicateEnable = _getVesselFeedStateForTest();
    assert.equal(duplicateEnable.sessionId, first.sessionId);
    assert.equal(duplicateEnable.firstConnectStartedAt, first.firstConnectStartedAt);
    assert.equal(duplicateEnable.firstConnectDeadline, first.firstConnectDeadline);
    assert.equal(clock.activeCount(), 1);

    aisLiveVesselsLayer.disable();
    assert.equal(clock.activeCount(), 0);
    await aisLiveVesselsLayer.enable(harness.viewer);
    const replacement = _getVesselFeedStateForTest();
    assert.notEqual(replacement.sessionId, first.sessionId);
    assert.equal(replacement.firstConnectStartedAt, 25000);
    assert.equal(replacement.firstConnectDeadline, 25000 + AIS_FIRST_CONNECT_GRACE_MS);
    assert.equal(replacement.firstConnectPhase, 'loading');
    assert.equal(clock.activeCount(), 1);
  } finally {
    globalThis.fetch = priorFetch;
    harness.cleanup();
    _setAisRuntimeForTest();
  }
});

test('vessel trail lifecycle: deselect clears the selected-vessel trail', () => {
  const harness = installWireHarness(undefined);
  try {
    aisLiveVesselsLayer.clearSelection();
    assert.equal(harness.trail.clearCalls, 1);
    assert.deepEqual(_getVesselStateForTest(), {
      trailMmsi: null,
      trailPositionCount: 0,
      vesselCount: 1,
    });
  } finally {
    harness.cleanup();
  }
});

test('vessel trail lifecycle: reconciliation eviction clears an orphaned trail', () => {
  const record = makeRecord();
  const trail = makeTrailSpy();
  _setVesselStateForTest({
    records: [record],
    trail,
    trailMmsi: record.mmsi,
    trailPositions: [POS],
  });
  try {
    _reconcileVesselsForTest({}, []);
    assert.equal(trail.clearCalls, 1);
    assert.deepEqual(_getVesselStateForTest(), {
      trailMmsi: null,
      trailPositionCount: 0,
      vesselCount: 0,
    });
  } finally {
    _setVesselStateForTest({ enabled: false });
  }
});

// 2026-09-27 vlastník: „pri tých lodiach je to rušivé, treba dať len základné info a až po prejdení
// myšou plné info" — okolitá karta = vlajka + meno; typ/rýchlosť/kurz nesie kartička pod kurzorom.
test('buildVesselCard: okolitá loď — len vlajka a meno, bez riadku typ/rýchlosť/kurz', () => {
  const card = buildVesselCard(makeRecord());
  assert.equal(card.title, 'EVER GIVEN');
  assert.deepEqual(card.details, []);
  assert.equal(card.accent, '57, 213, 255');
  assert.equal(card.selected, false);
  assert.equal(card.position, POS);
  assert.equal(card.id, 'vessel:353136000');
  assert.ok(card.priority > 0);
  assert.ok(Number.isFinite(card.gapPx) && card.gapPx > 0);
});

test('buildVesselCard: posledná známa poloha ostáva priznaná aj na okolitej karte (sivý okraj + LAST KNOWN)', () => {
  const stale = buildVesselCard(makeRecord({ positionState: 'last-known', lastPositionEpoch: Date.now() / 1000 - 3600 }));
  assert.equal(stale.details.length, 1);
  assert.match(stale.details[0], /^LAST KNOWN · /);
  assert.equal(stale.accent, '146, 156, 165');
  // plné údaje ostávajú na vybranej karte (klik) — kurz padá na course
  const selected = buildSelectedVesselCard(makeRecord({ heading: null }), Date.now(), null, []);
  assert.match(selected.details[0], /COG 231° \(SW\)/);
});

test('buildVesselCard: unnamed vessels title as MMSI; long names truncate', () => {
  const unnamed = buildVesselCard(makeRecord({ name: 'VESSEL' }));
  assert.equal(unnamed.title, 'MMSI 353136000');
  const long = buildVesselCard(makeRecord({ name: 'A'.repeat(40) }));
  assert.ok(long.title.length <= 26, `title too long: ${long.title.length}`);
});

test('buildVesselCard: anchors to the billboard position when present', () => {
  const rendered = { x: 9, y: 9, z: 9 };
  const card = buildVesselCard(makeRecord({ billboard: { position: rendered } }));
  assert.equal(card.position, rendered);
});

test('buildVesselCard: tanker types carry the amber accent', () => {
  const card = buildVesselCard(makeRecord({ type: 'Crude Oil Tanker' }));
  assert.equal(card.accent, '255, 179, 71');
});

test('buildVesselCard: numeric AIS type codes read as family names, not digits', () => {
  const card = buildVesselCard(makeRecord({ type: '84' }));
  assert.equal(card.accent, '255, 179, 71');
  assert.equal(buildSelectedVesselCard(makeRecord({ type: '84' }), Date.now(), null, []).details[1], 'TANKER');
});

test('cardScreenSeparated: rejects candidates inside the min separation radius', () => {
  const accepted = [{ x: 400, y: 300 }];
  assert.equal(cardScreenSeparated(accepted, { x: 400 + 149, y: 300 }, 150), false);
  assert.equal(cardScreenSeparated(accepted, { x: 400 + 151, y: 300 }, 150), true);
  assert.equal(cardScreenSeparated(accepted, { x: 400, y: 300 + 100 }, 150), false);
  assert.equal(cardScreenSeparated([], { x: 0, y: 0 }, 150), true);
});

test('buildSelectedVesselCard: dokovaná karta ako pri lietadle — titul, pohyb, typ, päta so zdrojom a MMSI (2026-10-10)', () => {
  // Zámerná zmena pinu (2026-10-10, „sprav karty minimálne také kvalitné ako pri lietadlách"):
  // vybraná loď = variant 'tracked' dokovaný vpravo, zdroj a MMSI v päte.
  const card = buildSelectedVesselCard(makeRecord({
    lastPositionUtc: '2026-07-27T11:22:33Z',
  }), Date.now(), null, []);
  assert.equal(card.variant, 'tracked');
  assert.equal(card.dock, 'right');
  assert.equal(card.protected, true);
  assert.equal(card.id, 'vessel:353136000');
  assert.equal(card.title, 'EVER GIVEN');
  assert.equal(card.titleFlag, 'PA', 'vlajka z MID prefixu MMSI pri titule');
  assert.deepEqual(card.details, ['14.5 kn (27 km/h) · COG 231° (SW) · HDG 231°', 'Container Ship']);
  assert.deepEqual(card.footer, ['AISStream · POS: 11:22:33Z', 'MMSI 353136000']);
});

test('buildSelectedVesselCard: identitný riadok, ETA pri destinácii a POS≈ pre odhadovaný fix', () => {
  // Balík 2 (navStatus, dĺžka, ponor, ETA) v novej karte; POS≈ = AIS Timestamp 62/63
  // (poloha dead-reckoned) — odhad sa nesmie tváriť ako meranie (pravidlo 2).
  const card = buildSelectedVesselCard(makeRecord({
    mmsi: '267940000',
    name: 'PREŠOV',
    type: '70',
    destination: 'KOMARNO',
    eta: '09-02 14:30',
    navStatus: 0,
    lengthM: 110,
    draughtM: 2.7,
    posEstimated: true,
    lastPositionUtc: '2026-09-02T11:22:33Z',
  }), Date.now(), null, []);
  assert.deepEqual(card.details, [
    '14.5 kn (27 km/h) · COG 231° (SW) · HDG 231°',
    'CARGO · under way using engine',
    '110 m · draught 2.7 m',
    '→ KOMARNO · ETA 09-02 14:30',
  ]);
  assert.equal(card.titleFlag, 'SK');
  assert.equal(card.footer[0], 'AISStream · POS≈ 11:22:33Z');
});

test('vessel host publication preserves the shipped grid winner and separation selector', () => {
  const publications = [];
  const originalProjection = Cesium.SceneTransforms.worldToWindowCoordinates;
  const makeCandidate = (mmsi, name, x, y, speed = 1) => makeRecord({
    mmsi,
    name,
    speed,
    position: { x: 1, y: 2, z: 3, screen: { x, y } },
  });
  const low = makeCandidate('100', 'VESSEL', 20, 20, 1);
  const winner = makeCandidate('200', 'NAMED WINNER', 40, 30, 16);
  const separated = makeCandidate('300', 'SEPARATED', 400, 300, 3);
  Cesium.SceneTransforms.worldToWindowCoordinates = (_scene, position) => position.screen;
  _setVesselOverlayHostForTest({
    setEntries(sourceId, entries, options) { publications.push({ sourceId, entries, options }); },
    setVisible() {},
    clearSource() {},
  });
  _setVesselStateForTest({
    viewer: { scene: { canvas: { clientWidth: 1600, clientHeight: 900 } } },
    records: [low, winner, separated],
  });
  try {
    _updateVesselCardsForTest([low, winner, separated]);
    assert.equal(publications.length, 1);
    assert.deepEqual(
      publications[0].entries.map(({ id }) => id).sort(),
      ['vessel:200', 'vessel:300'],
      'one higher-priority winner survives the shared cell and the separated card remains',
    );
    assert.equal(publications[0].options.cohortLimit, 112);
    assert.equal(publications[0].options.collisionCapacity, 112);
  } finally {
    Cesium.SceneTransforms.worldToWindowCoordinates = originalProjection;
    _setVesselStateForTest({ enabled: false });
    _setVesselOverlayHostForTest();
  }
});

test('vessel real layer lifecycle publishes protected selection and leaves no stale host cards', () => {
  const calls = [];
  const host = {
    setEntries(sourceId, entries, options) { calls.push({ op: 'set', sourceId, entries, options }); },
    setVisible(sourceId, visible) { calls.push({ op: 'visible', sourceId, visible }); },
    clearSource(sourceId) { calls.push({ op: 'clear', sourceId }); },
  };
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const record = makeRecord();
  globalThis.window = new EventTarget();
  globalThis.document = { getElementById: () => null };
  const focusRequests = [];
  globalThis.window.addEventListener('gev:world-request-focus', (event) => {
    focusRequests.push(event.detail);
  });
  _setVesselOverlayHostForTest(host);
  _setVesselStateForTest({
    viewer: { scene: { canvas: { clientWidth: 1600, clientHeight: 900 } } },
    records: [record],
    selectedRecord: record,
    billboardCollection: { show: true, remove() {} },
  });
  try {
    _updateVesselCardsForTest([]);
    const publication = calls.find(({ op }) => op === 'set');
    assert.ok(publication, 'production selector published to the host');
    assert.equal(publication.sourceId, 'ais-live-vessels');
    assert.equal(publication.options.cohortLimit, 112);
    assert.equal(publication.options.collisionCapacity, 112);
    assert.equal(publication.entries.length, 1);
    // Zámerná zmena (2026-10-10): vybraná loď = dokovaná karta ako pri lietadle.
    assert.equal(publication.entries[0].variant, 'tracked');
    assert.equal(publication.entries[0].dock, 'right');
    assert.equal(publication.entries[0].protected, true);
    assert.equal(publication.entries[0].collisionGroup, 'ambient-card');
    // Dokovaná karta je len na čítanie (ako pri lietadle) — klik na ňu loď neprepína.
    assert.equal(publication.entries[0].interactive, false);

    aisLiveVesselsLayer.disable();
    assert.ok(calls.some((call) => call.op === 'clear'), 'disable clears host cards');
    assert.ok(calls.some((call) => call.op === 'visible' && call.visible === false));

    const clearsBeforeDestroy = calls.filter((call) => call.op === 'clear').length;
    aisLiveVesselsLayer.destroy();
    assert.ok(
      calls.filter((call) => call.op === 'clear').length > clearsBeforeDestroy,
      'destroy clears again so teardown cannot retain late entries',
    );
  } finally {
    _setVesselStateForTest({ enabled: false });
    _setVesselOverlayHostForTest();
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
    globalThis.document = priorDocument;
  }
});

test('buildSelectedVesselCard: destination line + STALE marker; chýbajúce údaje sa nevypisujú', () => {
  const card = buildSelectedVesselCard(makeRecord({
    type: 'Tanker',
    speed: null,
    heading: null,
    course: null,
    destination: 'ROTTERDAM',
    missedRefreshes: 2,
  }), Date.now(), null, []);
  assert.equal(card.title, 'EVER GIVEN · STALE');
  assert.deepEqual(card.details, ['Tanker', '→ ROTTERDAM']);
  assert.deepEqual(card.footer, ['AISStream · POS: LIVE', 'MMSI 353136000']);
});

// --- Vertical datum (h = N + lift) ------------------------------------------

test('vesselDatumHeightM falls back to lift alone while the geoid grid is cold', () => {
  assert.equal(vesselDatumHeightM(null, 3), 3);
  assert.equal(vesselDatumHeightM(undefined, 2), 2);
  assert.equal(vesselDatumHeightM(NaN, 3), 3);
});

test('vesselDatumHeightM ADDS the undulation N (sign convention: h = N + lift)', () => {
  // The classic datum bug is subtracting N. Rotterdam N ≈ +45 must land the
  // anchor ~48 m ABOVE the ellipsoid; Houston N ≈ −27 lands it ~24 m below.
  assert.equal(vesselDatumHeightM(45.2, 3), 48.2);
  assert.equal(vesselDatumHeightM(-27.3, 3), -24.3);
});

test('EGM96 N pins the field finding: Rotterdam sea sits ~45 m ABOVE the ellipsoid, Houston ~27 m below', async () => {
  // Confirmed live 2026-07-28: chevrons at ellipsoid height 0 are occluded by
  // the Rotterdam sea mesh (N positive) but visible at Houston (N negative).
  // These bands also feed scripts/qa-vessel-datum.mjs.
  await ensureGeoidReady();
  const rotterdam = geoidHeight(51.93, 4.05);
  const houston = geoidHeight(29.72, -95.08);
  assert.ok(rotterdam > 40 && rotterdam < 50, `N(rotterdam) = ${rotterdam}, expected ≈ +45`);
  assert.ok(houston > -32 && houston < -22, `N(houston) = ${houston}, expected ≈ −27`);
});

// One-click transfer (pre-launch defect #4): clicking a vessel gives it the
// camera, whether the camera was free or tracking something else. The layer
// only announces the click — the UI owns the flight (src/worldFocus.js).
test('vessel interaction wire: selecting a vessel by click requests a camera transfer', () => {
  const harness = installWireHarness({ id: makeRecord() }, { selectedRecord: null });
  const requests = [];
  harness.windowTarget.addEventListener(
    WORLD_FOCUS_REQUEST_EVENT,
    (event) => requests.push(event.detail),
  );
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, 'vessel');
    assert.equal(requests[0].id, harness.record.mmsi);
    assert.equal(requests[0].position, POS);
  } finally {
    harness.cleanup();
  }
});

/**
 * Overlay-host recorder whose hitTest answers with one card id. The real host
 * only publishes rects for `interactive` entries, so a stub returning a hit is
 * the same contract a painted, actionable card presents.
 */
function hostWithCardHit(entryId) {
  return {
    setEntries() {},
    setVisible() {},
    clearSource() {},
    hitTest: () => (entryId ? { sourceId: 'ais-live-vessels', entryId } : null),
  };
}

// Card clicks (P1-3): cards paint on a pointer-events:none canvas, so a click
// on one picks the TERRAIN behind it — which read as empty space and cleared
// the selection. A card hit must behave exactly like a sprite hit.
test('vessel interaction wire: clicking a card selects and transfers, like the sprite', () => {
  const harness = installWireHarness({ primitive: {}, content: {}, featureId: 0 }, { selectedRecord: null });
  const requests = [];
  harness.windowTarget.addEventListener(
    WORLD_FOCUS_REQUEST_EVENT,
    (event) => requests.push(event.detail),
  );
  _setVesselOverlayHostForTest(hostWithCardHit(`vessel:${harness.record.mmsi}`));
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, 'vessel');
    assert.equal(requests[0].id, harness.record.mmsi);
  } finally {
    _setVesselOverlayHostForTest(null);
    harness.cleanup();
  }
});

test('vessel interaction wire: clicking the selected vessel card refocuses exactly once', () => {
  const harness = installWireHarness({ primitive: {}, content: {}, featureId: 0 });
  const requests = [];
  harness.windowTarget.addEventListener(
    WORLD_FOCUS_REQUEST_EVENT,
    (event) => requests.push(event.detail),
  );
  _setVesselOverlayHostForTest(hostWithCardHit(`vessel:${harness.record.mmsi}`));
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].id, harness.record.mmsi);
    assert.equal(harness.trail.clearCalls, 0);
  } finally {
    _setVesselOverlayHostForTest(null);
    harness.cleanup();
  }
});

test('vessel interaction wire: an unknown card id preserves selection and never flies', () => {
  const harness = installWireHarness({ primitive: {}, content: {}, featureId: 0 });
  const requests = [];
  harness.windowTarget.addEventListener(
    WORLD_FOCUS_REQUEST_EVENT,
    (event) => requests.push(event.detail),
  );
  // An evicted vessel's card id resolves to no live record.
  _setVesselOverlayHostForTest(hostWithCardHit('vessel:999999999'));
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(requests.length, 0);
  } finally {
    _setVesselOverlayHostForTest(null);
    harness.cleanup();
  }
});

test('vessel interaction wire: a sibling-owned pick wins without selection mutation', () => {
  // Another layer is already acting on this click; two camera commands is the
  // worse failure, so the card is not consulted.
  registerPickOwner('flights', (pickedId) => pickedId === 'a1b2c3');
  const harness = installWireHarness({ id: 'a1b2c3' });
  const requests = [];
  harness.windowTarget.addEventListener(
    WORLD_FOCUS_REQUEST_EVENT,
    (event) => requests.push(event.detail),
  );
  _setVesselOverlayHostForTest(hostWithCardHit(`vessel:${harness.record.mmsi}`));
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo()?.mmsi, harness.record.mmsi);
    assert.equal(requests.length, 0);
  } finally {
    _setVesselOverlayHostForTest(null);
    harness.cleanup();
    unregisterPickOwner('flights');
  }
});

test('vessel card policy: only MMSI-keyed cards publish a hit rect', () => {
  const keyed = applyVesselOverlayPolicy(buildVesselCard(makeRecord()));
  assert.equal(keyed.interactive, true);
  const unkeyed = applyVesselOverlayPolicy(buildVesselCard(makeRecord({ mmsi: '' })));
  assert.equal(unkeyed.interactive, false, 'an unkeyed card has no record to select');
});

test('vessel interaction wire: deselecting never moves the camera', () => {
  const harness = installWireHarness({ id: 'gev-empty-space' });
  const requests = [];
  harness.windowTarget.addEventListener(
    WORLD_FOCUS_REQUEST_EVENT,
    (event) => requests.push(event.detail),
  );
  try {
    harness.handler.click({ position: { x: 10, y: 20 } });
    assert.equal(aisLiveVesselsLayer.getSelectedInfo(), null);
    assert.equal(requests.length, 0);
    harness.keyTarget.dispatch({ key: 'Escape' });
    assert.equal(requests.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('a vessel analyst record carries the MMSI the tracker keys on', () => {
  // `id` is a DISPLAY label — the vessel name when it has one — while
  // selection keys on MMSI. The compact voice payload must carry both, or the
  // analyst → track_entity handoff hands over a name and nothing resolvable.
  const named = mapAnalystRecord({
    mmsi: '366999123', name: 'EVER GIVEN', lat: 37.8, lon: -122.4, speed: 12, type: 'Cargo',
  });
  assert.equal(named.id, 'EVER GIVEN');
  assert.equal(named.mmsi, '366999123', 'the key rides along with the label');

  // A nameless vessel falls back to its MMSI for display; the key is still
  // present in its own field, so the payload never depends on that collapse.
  const nameless = mapAnalystRecord({ mmsi: '366999124', name: null, lat: 37.9, lon: -122.5 });
  assert.equal(nameless.id, '366999124');
  assert.equal(nameless.mmsi, '366999124');
});

// --- Poctivý vek polohy na vybranej karte -----------------------------------

test('coverage snapshots keep last-known selection but exclude it from live counts and empty viewport clears contacts', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  const record = makeRecord();
  _setVesselOverlayHostForTest({ setEntries() {}, setVisible() {}, clearSource() {} });
  _setVesselStateForTest({ viewer: {}, records: [record], selectedRecord: record });
  try {
    const snapshot = {
      status: 'live', lastMessageAt: Date.now(), coverage: { omittedByLimit: 0 },
      rows: [{ mmsi: record.mmsi, name: record.name, lat: 51.93, lon: 4.05,
        last_position_epoch: Date.now() / 1000 - 3600, position_state: 'last-known' }],
    };
    _applyAisFeedSnapshotForTest({}, snapshot);
    const stats = aisLiveVesselsLayer.getStats();
    assert.equal(stats.count, 0);
    assert.equal(stats.lastKnownCount, 1);
    assert.equal(stats.stale, true);
    assert.equal(aisLiveVesselsLayer.getSelectedInfo().mmsi, record.mmsi);
    assert.deepEqual(aisLiveVesselsLayer.getAllPositions(), []);
    assert.equal(aisLiveVesselsLayer.hasContact(record.mmsi), false);
    _applyAisFeedSnapshotForTest({}, { ...snapshot, status: 'down', error: 'feed down', rows: [] });
    assert.equal(_getVesselStateForTest().vesselCount, 1, 'an outage is not an authoritative empty viewport');
    assert.equal(aisLiveVesselsLayer.getSelectedInfo().mmsi, record.mmsi);
    // Pin misses remain bounded even for authoritative empty viewport snapshots.
    for (let i = 0; i < 4; i++) _applyAisFeedSnapshotForTest({}, { ...snapshot, rows: [] });
    assert.equal(_getVesselStateForTest().vesselCount, 0);
    assert.equal(aisLiveVesselsLayer.getStats().error, null);
  } finally {
    _setVesselStateForTest({ enabled: false });
    _setVesselOverlayHostForTest();
    globalThis.document = originalDocument;
  }
});

test('buildSelectedVesselCard: starý fix priznáva vek a od 10 min nesie STALE', () => {
  const nowMs = Date.parse('2026-07-27T11:34:33Z');
  // 12 minút po fixe → vek v päte + STALE v titule, aj keď feed beží.
  const old = buildSelectedVesselCard(makeRecord({
    lastPositionUtc: '2026-07-27T11:22:33Z',
    lastPositionEpoch: Date.parse('2026-07-27T11:22:33Z') / 1000,
  }), nowMs, null, []);
  assert.equal(old.title, 'EVER GIVEN · STALE');
  assert.equal(old.footer[0], 'AISStream · LAST KNOWN POSITION · POS: 11:22:33Z (12 min)');
  // 3 minúty: vek sa prizná, ale STALE ešte nie.
  const aging = buildSelectedVesselCard(makeRecord({
    lastPositionUtc: '2026-07-27T11:31:33Z',
    lastPositionEpoch: Date.parse('2026-07-27T11:31:33Z') / 1000,
  }), nowMs, null, []);
  assert.equal(aging.title, 'EVER GIVEN');
  assert.equal(aging.footer[0], 'AISStream · POS: 11:31:33Z (3 min)');
  const fresh = buildSelectedVesselCard(makeRecord({
    lastPositionUtc: '2026-07-27T11:34:03Z',
    lastPositionEpoch: Date.parse('2026-07-27T11:34:03Z') / 1000,
  }), nowMs, null, []);
  assert.equal(fresh.footer[0], 'AISStream · POS: 11:34:03Z');
});

test('detection callout číta normalizovaný typ lode — nie surový AIS kód', () => {
  // Chyba č. 9 auditu: karta ukazovala 'CARGO' (normalizeVesselType), ale
  // detekčný callout tej istej lode surové '70' — dve rôzne triedy na
  // obrazovke naraz. Obe cesty teraz zdieľajú normalizáciu.
  _setVesselStateForTest({
    enabled: true,
    billboardCollection: { show: true, remove() {} },
    records: [makeRecord({ type: '70', billboard: null })],
  });
  try {
    const detectable = aisLiveVesselsLayer.getDetectableObjects({ maxCount: 5 });
    assert.equal(detectable.length, 1);
    assert.equal(detectable[0].klass, 'CARGO');
    // Textový typ prechádza nezmenený, neznámy typ nevyrába prázdny reťazec.
    _setVesselStateForTest({
      enabled: true,
      billboardCollection: { show: true, remove() {} },
      records: [makeRecord({ type: 'Crude Oil Tanker', billboard: null })],
    });
    assert.equal(
      aisLiveVesselsLayer.getDetectableObjects({ maxCount: 5 })[0].klass,
      'CRUDE OIL TANK',
    );
    _setVesselStateForTest({
      enabled: true,
      billboardCollection: { show: true, remove() {} },
      records: [makeRecord({ type: '', billboard: null })],
    });
    assert.equal(aisLiveVesselsLayer.getDetectableObjects({ maxCount: 5 })[0].klass, undefined);
  } finally {
    _setVesselStateForTest({ enabled: false });
  }
});

// ---------------------------------------------------------------------------
// Stupne veľkosti a hustota lodí pri oddialení (2026-09-04). Pred touto zmenou
// nemala vrstva žiadne zmenšovanie: pri pohľade na svet kreslila 27 000 šípok
// v plnej veľkosti — stenu pozdĺž pobreží, cez ktorú nebolo vidieť ani mapu,
// ani hustotu lietadiel.
// ---------------------------------------------------------------------------

const NOOP_HOST = { setEntries() {}, setVisible() {}, clearSource() {}, hitTest() { return null; } };

function makeLodCamera(lon, lat, heightM) {
  return {
    positionCartographic: {
      height: heightM, latitude: lat * Math.PI / 180, longitude: lon * Math.PI / 180,
    },
    positionWC: Cesium.Cartesian3.fromDegrees(lon, lat, heightM),
    heading: 0,
    pitch: -Math.PI / 2,
    roll: 0,
    setHeight(next) {
      this.positionCartographic.height = next;
      this.positionWC = Cesium.Cartesian3.fromDegrees(lon, lat, next);
    },
  };
}

function makeLodRecord(mmsi, lon, lat, extra = {}) {
  return makeRecord({
    mmsi,
    lat,
    lon,
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 3),
    surfacePosition: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    billboard: { show: true, scale: 0, rotation: 0, position: Cesium.Cartesian3.fromDegrees(lon, lat, 3) },
    ...extra,
  });
}

test('lode: tri stupne veľkosti podľa výšky kamery, rovnaké prahy ako lietadlá', () => {
  assert.ok(
    VESSEL_TIER_SCALE.full > VESSEL_TIER_SCALE.medium && VESSEL_TIER_SCALE.medium > VESSEL_TIER_SCALE.micro,
  );
  // 32 px šípka × najrýchlejšia loď × drobný stupeň ≤ 12 px — rovnaká reč ako
  // 9 px siluety lietadiel, nie stena šípok.
  assert.ok(32 * 0.78 * vesselTierScale('micro') <= 12);
  assert.equal(vesselTierScale('nezmysel'), 1, 'neznámy stupeň = plná veľkosť');

  const camera = makeLodCamera(4.05, 51.93, 120_000);
  const fast = makeLodRecord('F', 4.0, 51.9, { speed: 20 });
  const slow = makeLodRecord('S', 4.1, 51.95, { speed: 2 });
  _setVesselOverlayHostForTest(NOOP_HOST);
  _setVesselStateForTest({ viewer: { camera }, records: [fast, slow] });
  try {
    _tickVesselRuntimeForTest(0);
    assert.equal(_getVesselLodStateForTest().iconTier, 'full');

    camera.setHeight(2_500_000);
    _tickVesselRuntimeForTest(100);
    assert.equal(_getVesselLodStateForTest().iconTier, 'micro');
    assert.ok(Math.abs(fast.billboard.scale - 0.78 * VESSEL_TIER_SCALE.micro) < 1e-9);
    assert.ok(Math.abs(slow.billboard.scale - 0.6 * VESSEL_TIER_SCALE.micro) < 1e-9);

    // Zostup ide CEZ stredný stupeň — preskočiť rovno na plnú by vrátilo skok,
    // kvôli ktorému stredný stupeň vznikol.
    camera.setHeight(600_000);
    _tickVesselRuntimeForTest(200);
    assert.equal(_getVesselLodStateForTest().iconTier, 'medium');
    assert.ok(Math.abs(fast.billboard.scale - 0.78 * VESSEL_TIER_SCALE.medium) < 1e-9);

    camera.setHeight(120_000);
    _tickVesselRuntimeForTest(300);
    assert.equal(_getVesselLodStateForTest().iconTier, 'full');
    assert.ok(Math.abs(fast.billboard.scale - 0.78) < 1e-9, 'plná = čistá rýchlostná mierka');
  } finally {
    _setVesselOverlayHostForTest(null);
    _setVesselStateForTest({ enabled: false });
  }
});

test('lode: pri pohľade na svet hustota namiesto šípok, bunky za obzorom zhasnú', () => {
  const camera = makeLodCamera(4.05, 51.93, 9_000_000);
  const near = makeLodRecord('N1', 4.0, 51.9);
  const near2 = makeLodRecord('N2', 4.3, 52.1);
  const far = makeLodRecord('FAR', 151.2, -33.9); // Sydney — odvrátená strana
  const densityPoints = new Cesium.BillboardCollection();
  _setVesselOverlayHostForTest(NOOP_HOST);
  _setVesselStateForTest({ viewer: { camera }, records: [near, near2, far], densityPoints });
  _setVesselDensityEnabledForTest(true); // produkčne vypnutá — test agregáciu zapne
  try {
    _tickVesselRuntimeForTest(0);
    assert.equal(_getVesselLodStateForTest().densityMode, true, '9 000 km = hustota');
    assert.equal(densityPoints.show, true);
    assert.equal(near.billboard.show, false, 'šípky zhasli — jediná brána viditeľnosti');
    assert.equal(near2.billboard.show, false);
    assert.equal(far.billboard.show, false);
    assert.equal(densityPoints.length, 2, 'dve lode v jednej bunke + Sydney');
    let shown = 0;
    for (let i = 0; i < densityPoints.length; i += 1) if (densityPoints.get(i).show) shown += 1;
    assert.equal(shown, 1, 'bunka na odvrátenej strane nepresvitá cez glóbus');

    // Prepočet je throttlovaný: nový záznam sa v bunkách objaví až po 2 s.
    _tickVesselRuntimeForTest(500);
    assert.equal(densityPoints.length, 2);

    camera.setHeight(1_500_000);
    _tickVesselRuntimeForTest(3000);
    assert.equal(_getVesselLodStateForTest().densityMode, false, '1 500 km = jednotlivé lode');
    assert.equal(densityPoints.show, false);
    assert.equal(densityPoints.length, 0, 'bunky sa po návrate zahodia');
    assert.equal(near.billboard.show, true, 'horizontový cull flotilu zase rozsvieti');
    assert.equal(far.billboard.show, false, 'Sydney ostáva za obzorom');
  } finally {
    _setVesselDensityEnabledForTest(false);
    _setVesselOverlayHostForTest(null);
    _setVesselStateForTest({ enabled: false });
  }
});

test('lode: vybraná loď ostáva viditeľná aj v režime hustoty', () => {
  const camera = makeLodCamera(4.05, 51.93, 9_000_000);
  const picked = makeLodRecord('P', 4.0, 51.9);
  const other = makeLodRecord('O', 4.3, 52.1);
  const densityPoints = new Cesium.BillboardCollection();
  _setVesselOverlayHostForTest(NOOP_HOST);
  _setVesselStateForTest({
    viewer: { camera }, records: [picked, other], densityPoints, selectedRecord: picked,
  });
  _setVesselDensityEnabledForTest(true); // produkčne vypnutá — test agregáciu zapne
  try {
    _tickVesselRuntimeForTest(0);
    assert.equal(_getVesselLodStateForTest().densityMode, true);
    assert.equal(picked.billboard.show, true, 'ako sledovaný stroj pri lietadlách');
    assert.equal(other.billboard.show, false);
  } finally {
    _setVesselDensityEnabledForTest(false);
    _setVesselOverlayHostForTest(null);
    _setVesselStateForTest({ enabled: false });
  }
});

// ---------------------------------------------------------------------------
// 3D modely lodí zblízka (2026-09-05). Pod stropom výšky sa najbližšie lode
// prekreslia z 2D siluety trupu na skutočný glTF trup (ship.glb). Handoff je
// atomický cez množinu vlastníkov — inak by ikona presvitala pod modelom.
// ---------------------------------------------------------------------------

test('lode: 3D modely sa zapnú len pod stropom výšky a keď je prepínač zapnutý', () => {
  const camera = makeLodCamera(17.12, 48.13, 40_000); // nad stropom 15 km
  const rec = makeLodRecord('M1', 17.12, 48.13);
  _setVesselOverlayHostForTest(NOOP_HOST);
  _setShipModels3dForTest(true);
  _setVesselStateForTest({ viewer: { camera }, records: [rec] });
  try {
    _tickVesselRuntimeForTest(0);
    assert.equal(shipModels3dRegimeActive(), false, '40 km = nad stropom, žiadne modely');
    assert.equal(_getShipModelStateForTest().regime, false);

    camera.setHeight(3_000); // pod 15 km stropom
    _tickVesselRuntimeForTest(100);
    assert.equal(shipModels3dRegimeActive(), true, '3 km = pod stropom');
    assert.equal(_getShipModelStateForTest().regime, true);

    _setShipModels3dForTest(false);
    assert.equal(
      shipModels3dRegimeActive(), false,
      'vypnutý prepínač = žiadne modely bez ohľadu na výšku',
    );
  } finally {
    _setShipModels3dForTest(false); // späť na predvolené (klasické ikony)
    _setVesselOverlayHostForTest(null);
    _setVesselStateForTest({ enabled: false });
  }
});

test('lode: parametre 3D modelu sú rozumné', () => {
  assert.equal(SHIP_MODEL_HEADING_OFFSET_DEG, -90, 'prova modelu mieri na +X → offset −90°');
  assert.ok(SHIP_MODEL_ALT_CEIL_M > 0 && SHIP_MODEL_ALT_CEIL_M < 100_000, 'strop v desiatkach km');
  assert.ok(SHIP_MODEL_MAX >= 10 && SHIP_MODEL_MAX <= 100, 'rozumný strop počtu modelov');
  assert.ok(SHIP_MODEL_SCALE > 0 && SHIP_MODEL_SCALE < 1, 'zmenšenie z vlastných jednotiek na metre');
});

test('lode: tripwire — silueta trupu, 3D model zo ship.glb, handoff a upratovanie', () => {
  const src = readFileSync(new URL('./aisLiveVessels.js', import.meta.url), 'utf8');
  // 2D ikona je silueta trupu, nie pôvodná šípka/delta-krídlo.
  assert.match(src, /d="M0,-14 C2\.4,-11/, 'ikona lode je trup, nie šíp');
  assert.doesNotMatch(src, /M0,-14 L11,10/, 'starý chevron je preč');
  // 3D model: zdroj, načítanie, orientácia podľa kurzu.
  assert.match(src, /SHIP_MODEL_URL = '\/models\/ship\.glb'/, 'model zo ship.glb');
  assert.match(src, /Cesium\.Model\.fromGltfAsync\(/, 'model sa načítava cez fromGltfAsync');
  assert.match(src, /headingPitchRollToFixedFrame/, 'orientácia trupu podľa kurzu');
  assert.match(src, /\+ SHIP_MODEL_HEADING_OFFSET_DEG/, 'offset trupu sa pripočíta ku kurzu');
  // Handoff: ikona vlastníka modelu ostáva skrytá (jediná brána, nie druhé pravidlo).
  assert.match(
    src, /record\.billboard\.show = visible && !shipModelOwnsVisual\(record\)/,
    'handoff cez množinu vlastníkov',
  );
  // Modely bežia AŽ po updateVisibility (preberajú čerstvý stav ikony).
  assert.match(
    src, /updateVisibility\(\);[\s\S]{0,500}refreshVesselModels\(performance\.now\(\)\)/,
    'refreshVesselModels po updateVisibility',
  );
  // Kolekcia modelov sa pri disable odstráni (remove() ju aj zničí).
  assert.match(
    src, /viewer\.scene\.primitives\.remove\(state\.modelCollection\)/,
    'kolekcia modelov sa pri disable upráta',
  );
});

test('lode: hustota pri pohľade na svet je VYPNUTÁ (rozhodnutie používateľa, ako pri lietadlách)', () => {
  // Pri 12 000 km sa 30 000 lodí zlialo do 147 buniek, 48 viditeľných, medián
  // alfy 0,29 — „pár bodiek za celú hemisféru". Operátor chce jednotlivé lode.
  assert.equal(VESSEL_DENSITY_ENABLED, false, 'hustota lodí je vypnutá');
  const src = readFileSync(new URL('./aisLiveVessels.js', import.meta.url), 'utf8');
  assert.match(src, /export const VESSEL_DENSITY_ENABLED = false;/, 'prepínač je produkčne vypnutý');
  assert.match(src, /_vesselDensityEnabled \? densityModeActive\(/, 'prepínač je v bráne refreshVesselDensity');
  // S vypnutým prepínačom ostáva flotila jednotlivá aj pri 9 000 km.
  const camera = makeLodCamera(4.05, 51.93, 9_000_000);
  const near = makeLodRecord('N1', 4.0, 51.9);
  const densityPoints = new Cesium.BillboardCollection();
  densityPoints.show = false; // ako ensureCollections — hustota štartuje zhasnutá
  _setVesselOverlayHostForTest(NOOP_HOST);
  _setVesselStateForTest({ viewer: { camera }, records: [near], densityPoints });
  try {
    _tickVesselRuntimeForTest(0);
    assert.equal(_getVesselLodStateForTest().densityMode, false, 'žiadna hustota');
    assert.equal(densityPoints.show, false);
    assert.equal(densityPoints.length, 0, 'žiadne bunky');
    assert.equal(near.billboard.show, true, 'loď ostáva jednotlivou ikonou');
    assert.equal(_getVesselLodStateForTest().iconTier, 'micro', 'drobný stupeň, nie stena');
  } finally {
    _setVesselOverlayHostForTest(null);
    _setVesselStateForTest({ enabled: false });
  }
});

const FIX_EPOCH = Math.floor(Date.now() / 1000) - 30; // čerstvý fix (< 10 min), inak by bol „last known"

test('getContactSummary: kartička pod kurzorom v tvare flights (2026-09-12 „keď na lode prejdem myšou, nič")', () => {
  const record = makeRecord({
    mmsi: '244660815', name: 'VLISSINGEN', callSign: 'PBXY', type: '70', destination: 'ROTTERDAM',
    speed: 14.53, course: 230.6, heading: 231.2, lengthM: 121.4, navStatus: 0, lastPositionEpoch: FIX_EPOCH,
  });
  _setVesselStateForTest({ viewer: {}, records: [record] });
  try {
    assert.equal(aisLiveVesselsLayer.getContactSummary('000000000'), null, 'neznáma loď = null');
    const s = aisLiveVesselsLayer.getContactSummary('244660815');
    assert.equal(s.layerId, 'ais-live-vessels');
    assert.equal(s.id, '244660815');
    assert.equal(s.callsign, 'VLISSINGEN', 'meno lode je titulok');
    assert.equal(s.registration, 'PBXY');
    assert.equal(s.operator, 'UNDER WAY', 'stav plavby v riadku stroja');
    assert.equal(s.type, 'CARGO · 121 m', 'normalizovaný typ + dĺžka');
    assert.ok(Math.abs(s.speedMps - 14.53 * 0.514444) < 1e-9, 'uzly → m/s pre spoločný formátovač');
    assert.equal(s.trackDeg, 231.2, 'heading má prednosť pred kurzom');
    assert.equal(s.route, '→ ROTTERDAM');
    assert.equal(s.countryIso, 'NL', 'vlajka z MID 244');
    assert.equal(s.lastContactEpochMs, FIX_EPOCH * 1000);
    assert.equal(s.stale, false);
    assert.equal(s.altitudeM, null);
    assert.equal(s.onGround, false);
    assert.equal(s.source, 'AISStream');
  } finally { _setVesselStateForTest({ enabled: false }); }
});

test('getContactSummary: AIS sentinely a posledná známa poloha', () => {
  const record = makeRecord({ mmsi: '353136000', name: '', callSign: '', type: '', heading: 511, course: 360, speed: -1, positionState: 'last-known', destination: '' });
  _setVesselStateForTest({ viewer: {}, records: [record] });
  try {
    const s = aisLiveVesselsLayer.getContactSummary('353136000');
    assert.equal(s.callsign, '353136000', 'bez mena je titulkom MMSI');
    assert.equal(s.registration, null);
    assert.equal(s.type, 'VESSEL', 'typ nikdy prázdny — inak by karta siahla po aircraft.category.*');
    assert.equal(s.trackDeg, null, 'heading 511 a course 360 = nedostupné');
    assert.equal(s.speedMps, null);
    assert.equal(s.route, null);
    assert.equal(s.stale, true, 'posledná známa poloha sa prizná');
    assert.equal(s.countryIso, 'PA', 'MID 353 = Panama');
  } finally { _setVesselStateForTest({ enabled: false }); }
});

test('getDetectableObjects: loď pod kurzorom a vybraná loď idú vždy, aj keď ich stride vynechal („zameriavače ako u lietadiel")', () => {
  const records = Array.from({ length: 12 }, (_, i) => makeRecord({ mmsi: String(200000000 + i), name: `S${i}` }));
  _setVesselStateForTest({ viewer: {}, records, selectedRecord: records[7], billboardCollection: { show: true, remove() {} } });
  try {
    const plain = aisLiveVesselsLayer.getDetectableObjects({ maxCount: 3, seed: 0 });
    // stride 4 → indexy 0, 4, 8 + vybraná (7)
    assert.deepEqual(plain.map(o => o.sourceId), ['200000007', '200000000', '200000004', '200000008']);
    assert.equal(plain[0].skipLabel, true, 'vybraná loď = sledovaný rámik');
    const hovered = aisLiveVesselsLayer.getDetectableObjects({ maxCount: 3, seed: 0, hovered: [{ layerId: 'ais-live-vessels', sourceId: '200000005' }, { layerId: 'flights', sourceId: 'abc' }] });
    assert.ok(hovered.some(o => o.sourceId === '200000005'), 'hovered loď je v kohorte napriek stride');
    assert.ok(!hovered.some(o => o.sourceId === 'abc'), 'cudzí kandidát (lietadlo) sa ignoruje');
    const ids = hovered.map(o => o.sourceId);
    assert.equal(new Set(ids).size, ids.length, 'bez duplikátov');
  } finally { _setVesselStateForTest({ enabled: false }); }
});

// ── Hladina riek (2026-09-27, vlastník: „lode na Dunaji nech plávu na rieke, nie mimo Dunaja") ──
test('vesselSurfaceHeightM: na mori hladina mora, na rieke povrch rieky (Dunaj v BA ~180 m nad elipsoidom)', () => {
  // more: DEM na úrovni mora alebo pod ňou (batymetria) → vyhrá geoid, nič sa nemení
  assert.equal(vesselSurfaceHeightM(44.2, 44.2, 3), 47.2);
  assert.equal(vesselSurfaceHeightM(43.8, 41.0, 3), 46.8, 'prístav pod hladinou mora → hladina mora');
  // Dunaj pri Bratislave: /api/terrain/heights 179–181 m (135–137 m n. m. + N 43,9)
  assert.equal(vesselSurfaceHeightM(43.9, 181.5, 3), 184.5);
  // kým bunka nie je načítaná alebo je mriežka studená, doterajšie správanie
  assert.equal(vesselSurfaceHeightM(43.9, null, 3), 46.9);
  assert.equal(vesselSurfaceHeightM(null, null, 3), 3);
  assert.equal(vesselSurfaceHeightM(null, 181.5, 3), 184.5);
});

test('lode (ikona, stopa aj 3D model) stoja na hladine z groundFloor; povrch sa dotiahne lodiam v zábere po každom načítaní', () => {
  const src = readFileSync(new URL('./aisLiveVessels.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ cachedGroundFloor, resolveGroundFloorCells \} from '\.\/groundFloor\.js';/);
  assert.match(src, /const heightM = vesselRenderHeightM\(lat, lon, VESSEL_LIFT_M\);/, 'ikona pri načítaní');
  assert.match(src, /record\.lon, record\.lat, vesselRenderHeightM\(record\.lat, record\.lon, SHIP_MODEL_LIFT_M\),/, '3D model už nie na elipsoide');
  assert.ok(!/record\.lon, record\.lat, SHIP_MODEL_LIFT_M, Cesium\.Ellipsoid\.WGS84/.test(src));
  assert.match(src, /updateVisibility\(true\);\n {2}warmVesselSurfaceInView\(\);\n\}/, 'po každom načítaní lodí');
  assert.match(src, /const VESSEL_SURFACE_WARM_ALT_M = 150_000;/, 'len pri nízkej kamere — 33 k lodí sa nedopytuje');
  assert.ok(!/vesselDatumHeightM\(currentGeoidN/.test(src), 'žiadne miesto už neberie len hladinu mora');
});

test('lode zblízka = klasické ikony trupu, 3D modely ship.glb predvolene vypnuté (vlastník 09-27: „vyrenderované lode nie sú dobré, použi klasické")', () => {
  assert.equal(_getShipModelStateForTest().enabled, false, 'predvolene bez 3D modelov');
  const camera = makeLodCamera(17.12, 48.13, 1_000); // hlboko pod stropom 15 km
  _setVesselOverlayHostForTest(NOOP_HOST);
  _setVesselStateForTest({ viewer: { camera }, records: [makeLodRecord('M2', 17.12, 48.13)] });
  try {
    _tickVesselRuntimeForTest(0);
    assert.equal(shipModels3dRegimeActive(), false, 'ani pri 1 km nie je 3D model');
  } finally {
    _setVesselOverlayHostForTest(null);
    _setVesselStateForTest({ enabled: false });
  }
});

test('buildSelectedVesselCard: otáčanie, IMO, trieda, rozmery, register a miestny čas (2026-10-10)', async () => {
  const { _resetVesselInfoForTest, _setVesselInfoFetchForTest, lookupVesselInfo } = await import('./vesselInfo.js');
  _resetVesselInfoForTest();
  _setVesselInfoFetchForTest(async () => ({ ok: true, json: async () => ({
    mmsi: '241190000', imo: '9410909', typeDetail: 'Chemical/Oil Products Tanker', yearBuilt: 2009,
    grossTonnage: 29442, deadweight: 52941, lengthM: 183, beamM: 32, photo: { src: '/api/vessel-info/photo?mmsi=241190000&size=1' },
  }) }));
  await lookupVesselInfo('241190000');
  const nowMs = Date.parse('2026-10-10T02:57:00Z');
  const card = buildSelectedVesselCard(makeRecord({
    mmsi: '241190000', name: 'MINERVA ZEN', type: 'Tanker', speed: 13.1, course: 253, heading: 252,
    rateOfTurn: 0, aisClass: 'A', imo: '', draughtM: 11, lon: -74.2, lat: 34, navStatus: 0,
    lastPositionUtc: '2026-10-10T02:57:00Z', lastPositionEpoch: nowMs / 1000,
  }), nowMs, null, []);
  assert.deepEqual(card.details, [
    '13.1 kn (24 km/h) · COG 253° (W) · HDG 252° · ROT 0°/min',
    'Chemical/Oil Products Tanker · under way using engine',
    'IMO 9410909 · AIS class A · 183 × 32 m · draught 11.0 m',
    'built 2009 · GT \u202f29\u202f442 · DWT 52\u202f941 t'.replace('GT \u202f', 'GT '),
  ]);
  assert.deepEqual(card.footer, ['AISStream · POS: 02:57:00Z', 'MMSI 241190000 · Local time 21:57 (UTC\u22125)']);
  _resetVesselInfoForTest();
});
