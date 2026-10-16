// Transport proof for the AISStream watchdog's central design choice:
// teardown must be ws.terminate(), never a graceful close().
//
// This is the assumption the reverted watchdog got wrong. It is pinned here
// against a real black-hole peer — a server that completes the websocket
// handshake and then never speaks again, which is exactly how AISStream fails
// (upstream: handshake succeeds, no frames, no error, no close). Everything
// runs on an ephemeral localhost port; no network access is involved.
//
// Hang-proofing (2026-10-16). Under the full parallel `npm test` this file once
// held the whole suite for 29 minutes: a worker with no CPU, the black hole
// still listening, no test ever finishing. The only wait in here that could
// do that was a bare `await 'open'` on the built-in WebSocket: when its
// loopback connect sporadically fails, undici reports it solely through
// 'error' + 'close' events (the error even carries an empty message), 'open'
// never fires, and the runner gave a test no time limit. `ws` at least throws
// an unhandled 'error' in the same situation. So every socket wait below is
// bounded and rejects with whatever is known, teardown is idempotent and
// verified by a test of its own, and no socket is ever created without being
// tracked for teardown.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash } from 'node:crypto';
import WebSocketImpl from 'ws';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Upper bound for any single socket event this file waits on. Loopback events
 * take milliseconds; the bound only exists so that a wait can never be silent.
 * Generous on purpose: a starved worker under the parallel suite has been
 * measured at several seconds per step.
 */
const EVENT_LIMIT_MS = 10_000;

/** readyState value shared by `ws` and the built-in WebSocket. */
const CLOSED = 3;

/**
 * A websocket peer that upgrades the connection and then goes silent forever.
 * It never sends frames and never answers a close frame, so a graceful close
 * handshake can never complete.
 */
function startBlackHoleServer() {
  let liveConnections = 0;
  /** Every accepted socket, so teardown can destroy the wedged ones. */
  const accepted = new Set();
  let closing = null;
  const server = net.createServer((socket) => {
    liveConnections += 1;
    accepted.add(socket);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      if (!buffer.includes('\r\n\r\n')) return;
      const key = /sec-websocket-key:\s*(.+)\r\n/i.exec(buffer)?.[1]?.trim();
      if (!key) return;
      const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
        + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      buffer = '';
      // ...and then nothing, ever. Incoming CLOSE frames are ignored.
    });
    socket.on('close', () => {
      liveConnections -= 1;
      accepted.delete(socket);
    });
    socket.on('error', () => {});
  });

  return {
    server,
    listen: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(`ws://127.0.0.1:${server.address().port}`));
    }),
    get liveConnections() { return liveConnections; },
    /**
     * Idempotent: the after() hook and the teardown test both call it.
     * A socket this suite deliberately wedged in CLOSING keeps the event loop
     * alive forever; server.close() only stops new accepts, so the wedged
     * connections have to be destroyed by hand.
     */
    close: () => {
      closing ??= (async () => {
        // destroy() tears the handle down asynchronously; 'close' is the proof.
        const gone = [...accepted].map((socket) => new Promise((resolve) => {
          socket.once('close', resolve);
          socket.destroy();
        }));
        await Promise.all([
          ...gone,
          new Promise((resolve) => server.close(() => resolve())),
        ]);
      })();
      return closing;
    },
  };
}

/** Resolve to true if `event` fires on `emitter` within `ms`. */
function firedWithin(subscribe, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    subscribe(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Every client socket this file creates, so teardown can prove they all died. */
const clients = new Set();

/** Register a client socket for teardown; returns it for chaining. */
function track(socket) {
  clients.add(socket);
  return socket;
}

/**
 * Wait for `socket` (either `ws` or the built-in WebSocket — both expose
 * addEventListener) to open. Rejects, never hangs: an 'error' or 'close'
 * before 'open' rejects with everything the socket reports, and silence
 * rejects after EVENT_LIMIT_MS. The built-in WebSocket's error event carries an
 * empty TypeError for a failed connect, so the close code is reported too.
 */
function opened(socket, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what}: no open/error/close event within ${EVENT_LIMIT_MS} ms`)),
      EVENT_LIMIT_MS,
    );
    const settle = (fn) => (event) => {
      clearTimeout(timer);
      fn(event);
    };
    socket.addEventListener('open', settle(resolve), { once: true });
    socket.addEventListener('error', settle((event) => {
      const detail = event.error?.message || event.message || '(no detail from the socket)';
      reject(new Error(`${what}: failed to open — ${detail}`, { cause: event.error }));
    }), { once: true });
    socket.addEventListener('close', settle((event) => {
      reject(new Error(`${what}: closed before opening (code ${event.code})`));
    }), { once: true });
  });
}

/**
 * Wait for 'close' on a socket; rejects after EVENT_LIMIT_MS instead of
 * hanging. Subscribe BEFORE triggering the close: the built-in WebSocket fires
 * 'close' synchronously from close() when it is still CONNECTING, and then
 * leaves readyState at CLOSING, so neither the event nor the state alone can be
 * polled afterwards.
 */
function closed(socket, what) {
  if (socket.readyState === CLOSED) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what}: still readyState ${socket.readyState} after ${EVENT_LIMIT_MS} ms`)),
      EVENT_LIMIT_MS,
    );
    socket.addEventListener('close', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** Poll `predicate` on the event loop until true or `ms` elapsed; returns the final value. */
async function settled(predicate, ms) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

/** Live TCP handles of this process (sockets and listeners), by provider name. */
function tcpHandles() {
  return process.getActiveResourcesInfo().filter((name) => name.startsWith('TCP'));
}

const blackHole = startBlackHoleServer();
const url = await blackHole.listen();

let teardownPromise = null;
/**
 * Release everything this file created, from both ends, and only resolve once
 * every client socket has reported 'close'. Idempotent so that the after()
 * backstop and the teardown test can share it.
 */
function teardown() {
  teardownPromise ??= (async () => {
    const allClosed = [...clients].map((socket, i) => closed(socket, `client #${i}`));
    for (const socket of clients) {
      if (socket.readyState === CLOSED) continue;
      if (typeof socket.terminate === 'function') socket.terminate();
      else socket.close();
    }
    await blackHole.close();
    await Promise.all(allClosed);
  })();
  return teardownPromise;
}
after(() => teardown());

test('ws.terminate() hard-aborts a black-holed socket and frees the connection slot', async () => {
  const socket = track(new WebSocketImpl(url));
  await opened(socket, 'ws client');
  assert.equal(socket.readyState, WebSocketImpl.OPEN);
  assert.equal(typeof socket.terminate, 'function', 'the adapter depends on terminate()');
  assert.equal(blackHole.liveConnections, 1);

  const closedInTime = firedWithin((done) => socket.once('close', done), 1_000);
  const startedAt = Date.now();
  socket.terminate();

  assert.equal(await closedInTime, true, 'terminate() must complete against a silent peer');
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(socket.readyState, WebSocketImpl.CLOSED);

  // The TCP connection is genuinely gone — this is what protects AISStream's
  // one-connection-per-key limit when the watchdog recycles.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(blackHole.liveConnections, 0, 'the socket slot must actually be released');
});

test('the built-in WebSocket close() never completes on a black-holed socket', async () => {
  // This is the regression that wedged the reverted watchdog: Node's global
  // WebSocket exposes no terminate(), and close() waits for a close frame the
  // dead peer will never send. If a future Node release fixes this, the
  // assertion below fails loudly and the design can be revisited.
  assert.equal(typeof WebSocket, 'function');
  assert.equal(
    typeof WebSocket.prototype.terminate, 'undefined',
    'built-in WebSocket has no hard-abort; that is why ws is a dependency',
  );

  const socket = track(new WebSocket(url));
  await opened(socket, 'built-in WebSocket');
  assert.equal(socket.readyState, WebSocket.OPEN);

  const closedInTime = firedWithin(
    (done) => socket.addEventListener('close', done, { once: true }),
    1_500,
  );
  socket.close(1000, 'watchdog recycle');
  assert.equal(socket.readyState, WebSocket.CLOSING);

  assert.equal(await closedInTime, false, 'close() hangs in CLOSING — measured well past 30s by hand');
  assert.equal(socket.readyState, WebSocket.CLOSING, 'the socket slot is never handed back');
});

test('a terminated socket hands the single connection slot straight to its replacement', async () => {
  const first = track(new WebSocketImpl(url));
  await opened(first, 'first ws client');
  first.terminate();
  await closed(first, 'first ws client');

  // The watchdog's reconnect happens right here; it must not be refused.
  const second = track(new WebSocketImpl(url));
  await opened(second, 'second ws client');
  assert.equal(second.readyState, WebSocketImpl.OPEN);

  second.terminate();
  await closed(second, 'second ws client');
});

test('a socket that fails to open rejects with what it knows instead of waiting forever', async () => {
  // A peer this file owns, so no other test process can take its port: it
  // accepts the TCP connection and drops it before any handshake. (Dialling a
  // port that was merely released is a race under the parallel suite — a
  // sibling worker's listen(0) can land on it within milliseconds.)
  const dead = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const deadUrl = `ws://127.0.0.1:${dead.address().port}`;
  try {
    // ws surfaces the real error; the built-in WebSocket only reports a failed
    // connect as an error event with an empty message plus close 1006, and a
    // bare `await 'open'` on it would never settle — the 29-minute hang.
    const viaWs = track(new WebSocketImpl(deadUrl));
    await assert.rejects(opened(viaWs, 'ws to a dead peer'), /ws to a dead peer: failed to open — \S+/);
    assert.equal(viaWs.readyState, WebSocketImpl.CLOSED);

    const viaBuiltIn = track(new WebSocket(deadUrl));
    const builtInClosed = closed(viaBuiltIn, 'built-in WebSocket to a dead peer');
    await assert.rejects(
      opened(viaBuiltIn, 'built-in WebSocket to a dead peer'),
      /dead peer: (failed to open|closed before opening)/,
    );
    await builtInClosed;
    assert.equal(viaBuiltIn.readyState, CLOSED);
  } finally {
    await new Promise((resolve) => dead.close(resolve));
  }
});

test('teardown destroys every socket from both ends and the listener, so the worker can exit', async () => {
  // Precondition: the previous tests left exactly the handle that would keep a
  // worker alive forever — the built-in socket wedged in CLOSING.
  const wedged = [...clients].filter((socket) => socket.readyState !== CLOSED);
  assert.equal(wedged.length, 1, 'one built-in socket is expected to be stuck in CLOSING');
  assert.equal(wedged[0].readyState, WebSocket.CLOSING);
  assert.ok(tcpHandles().includes('TCPServerWrap'), 'the black hole is still listening before teardown');

  await teardown();
  await teardown(); // idempotent: the after() backstop reuses the same promise

  for (const socket of clients) assert.equal(socket.readyState, CLOSED);
  assert.equal(blackHole.liveConnections, 0);
  assert.equal(blackHole.server.listening, false);
  assert.equal(
    await settled(() => tcpHandles().length === 0, EVENT_LIMIT_MS), true,
    `TCP handles still alive after teardown: ${tcpHandles().join(', ')}`,
  );
});
