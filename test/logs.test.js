// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a token. (Adapted from guim31/gladys-wg-easy.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CENTRAL_CONFIG, LOCAL_CONFIG, createWorld } from './helpers/world.js';

/** Capture the lines of the SDK logger at `level`. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

test('a normal reading cycle writes nothing at info, members coming and going included', async (t) => {
  const logs = captureLogs(t);
  const w = await createWorld();
  t.after(() => w.app.stop());
  assert.ok(logs.texts().some((text) => text.includes('connected, 1 network(s), 4 member(s)')));
  logs.clear();
  for (let i = 0; i < 10; i += 1) {
    w.clock.advance(60_000);
    w.central.setOnline('NAS', i % 2 === 0);
    await w.hub.poll();
  }
  w.central.join('f1f2f3f4f5');
  await w.hub.poll();
  assert.deepEqual(logs.texts(), []);
});

test('an outage is logged once when it starts and once when it ends', async (t) => {
  const logs = captureLogs(t);
  const w = await createWorld();
  t.after(() => w.app.stop());
  logs.clear();
  w.central.online = false;
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(60_000);
    await w.hub.poll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  w.central.online = true;
  await w.hub.poll();
  assert.equal(logs.lines.length, 2);
  assert.match(logs.texts()[1], /connection restored/);
});

test('the token is never written, even in debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  for (const config of [
    { ...CENTRAL_CONFIG, token: 'wrong-secret-token' },
    { ...LOCAL_CONFIG, token: 'wrong-secret-token' },
    { ...CENTRAL_CONFIG, allow_authorize: true },
  ]) {
    const w = await createWorld({ mode: config.mode, config });
    t.after(() => w.app.stop());
    await w.hub.poll();
    await w.fake.action('test_connection', {});
  }
  const all = logs.texts().join('\n');
  assert.ok(logs.lines.length > 0);
  assert.ok(!all.includes('secret-token'), 'no token in the logs');
  assert.ok(!all.includes('central-token-123'));
});
