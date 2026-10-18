// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys: states, scene events, commands, the
// connection status, the container's own timer.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  CENTRAL_CONFIG,
  LOCAL_CONFIG,
  createAll,
  createWorld,
  memberIdsOf,
  networkIdsOf,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);

test('the first reading publishes devices, states and the connection, without scene event', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.discoveredDevices.length, 5);
  const network = networkIdsOf(w.gladys);
  assert.equal(w.fake.lastState(network.feature(FEATURE_KEYS.ONLINE_MEMBERS)), 2);
  assert.equal(w.fake.lastState(network.feature(FEATURE_KEYS.MEMBERS)), 4);
  assert.equal(w.fake.lastState(network.feature(FEATURE_KEYS.PENDING)), 1);
  const laptop = memberIdsOf(w.gladys, 'c0ffee1234');
  assert.equal(w.fake.lastState(laptop.feature(FEATURE_KEYS.ONLINE)), 1);
  assert.equal(w.fake.lastState(laptop.feature(FEATURE_KEYS.AUTHORIZED)), 1);
  assert.equal(w.fake.lastState(laptop.feature(FEATURE_KEYS.IP)), '192.0.2.30');
  assert.equal(w.fake.lastState(laptop.feature(FEATURE_KEYS.VERSION)), '1.14.2');
  assert.match(w.fake.lastState(laptop.feature(FEATURE_KEYS.LAST_SEEN)), /\d+\/\d+\/\d+/);
  const phone = memberIdsOf(w.gladys, 'd1d2d3d4d5');
  assert.equal(w.fake.lastState(phone.feature(FEATURE_KEYS.IP)), 'None');
  assert.equal(w.fake.lastState(phone.feature(FEATURE_KEYS.LAST_SEEN)), undefined);
  assert.deepEqual(new Set(w.fake.transports.map((entry) => entry.transport)), new Set(['cloud']));
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('online, offline and a new member awaiting authorization fire their scene events', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.clock.advance(60_000);
  w.central.setOnline('NAS', true);
  w.central.setOnline('Laptop', false);
  w.central.join('f1f2f3f4f5', { name: 'New phone' });
  await w.hub.poll();
  assert.deepEqual(
    events(w, TRIGGERS.ONLINE).map((event) => event.data.member),
    ['NAS'],
    'a new member awaiting authorization is not "online"',
  );
  assert.deepEqual(
    events(w, TRIGGERS.OFFLINE).map((event) => event.data.member),
    ['Laptop'],
  );
  const [pending] = events(w, TRIGGERS.PENDING);
  assert.deepEqual(pending.data, {
    device: memberIdsOf(w.gladys, 'f1f2f3f4f5').device,
    member: 'New phone',
    node_id: 'f1f2f3f4f5',
    network: 'home',
    network_device: networkIdsOf(w.gladys).device,
  });
  assert.equal(w.fake.discoveredDevices.length, 6);
  assert.equal(w.fake.lastState(networkIdsOf(w.gladys).feature(FEATURE_KEYS.PENDING)), 2);
  assert.ok(w.fake.widgetRefreshes.includes(WIDGET_KEY));
});

test('only changes are published; everything again when a device is added', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const before = w.fake.states.length;
  await w.hub.poll();
  assert.equal(w.fake.states.length, before, 'nothing changed');
  const device = w.fake.discoveredDevices.find((d) => d.name === 'NAS (ZeroTier)');
  await w.fake.deviceCreated(device);
  const sent = w.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.equal(sent.length, 5, 'every feature of the NAS');
  assert.ok(sent.every((id) => id.startsWith(`${device.external_id}:`)));
  assert.ok(w.fake.transports.some((entry) => entry.device_external_id === device.external_id));
});

test('the heartbeat sends every value again after 12 hours', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.central.members.forEach((member) => {
    if (member.lastSeen) {
      member.lastSeen = w.clock.now() - 3_600_000 * 24 * 3;
    }
  });
  await w.hub.poll();
  const before = w.fake.states.length;
  w.clock.advance(12 * 3_600_000);
  w.central.members.forEach((member) => {
    if (member.lastSeen) {
      member.lastSeen = w.clock.now() - 3_600_000 * 24 * 3;
    }
  });
  await w.hub.poll();
  assert.ok(w.fake.states.length - before >= 15, 'every value of every device');
});

test('the "Authorized" switch is read only by default, a command otherwise', async (t) => {
  const readOnly = await createWorld();
  t.after(() => readOnly.app.stop());
  await createAll(readOnly);
  const pendingDevice = (world) =>
    world.fake.discoveredDevices.find((d) => d.external_id.endsWith('b1b2b3b4b5'));
  const switchOf = (device) => device.features.find((f) => f.external_id.endsWith(':authorized'));
  assert.equal(switchOf(pendingDevice(readOnly)).read_only, true);
  const refused = await readOnly.fake.setValue(
    pendingDevice(readOnly),
    switchOf(pendingDevice(readOnly)),
    1,
  );
  assert.equal(refused.success, false);
  assert.match(refused.error, /off in the integration configuration/);

  const w = await createWorld({ config: { ...CENTRAL_CONFIG, allow_authorize: true } });
  t.after(() => w.app.stop());
  const device = pendingDevice(w);
  assert.equal(switchOf(device).read_only, false);
  const ack = await w.fake.setValue(device, switchOf(device), 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.central.members.find((m) => m.nodeId === 'b1b2b3b4b5').config.authorized, true);
  assert.equal(w.fake.lastState(switchOf(device).external_id), 1, 'read back');
  const online = device.features.find((f) => f.external_id.endsWith(':online'));
  const wrong = await w.fake.setValue(device, online, 1);
  assert.equal(wrong.success, false);
});

test('an outage: one status, devices unreachable, no state; back to normal after', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.central.online = false;
  await w.hub.poll();
  await w.hub.poll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  assert.ok(w.fake.transports.some((entry) => entry.transport === 'unreachable'));
  w.central.online = true;
  await w.hub.poll();
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.transports.at(-1).transport, 'cloud');
  assert.deepEqual(w.fake.sceneEvents, [], 'no member changed');
});

test('Central says 429: the next readings wait longer, until it answers', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.central.status = 429;
  await w.hub.poll();
  assert.equal(w.hub.backoff, 2);
  await w.hub.poll();
  await w.hub.poll();
  await w.hub.poll();
  assert.equal(w.hub.backoff, 8, 'capped');
  assert.match(w.fake.connectionStatus.message.fr, /trop de requêtes/);
  w.central.status = null;
  await w.hub.poll();
  assert.equal(w.hub.backoff, 1);
});

test('configuration problems are said in the status, nothing is read', async (t) => {
  for (const [config, expected] of [
    [{ mode: 'central' }, /API token/],
    [{ mode: 'local', token: 'x' }, /address of your controller/],
    [{ mode: 'local', token: 'x', url: 'ftp://x' }, /not understood/],
    [{ mode: 'central', token: 'x', networks: 'home' }, /Network ids not understood.*home/],
  ]) {
    const w = await createWorld({ config: { ...config, language: 'en' } });
    t.after(() => w.app.stop());
    assert.equal(w.fake.connectionStatus.connected, false);
    assert.match(w.fake.connectionStatus.message.en, expected);
    assert.deepEqual(w.central.requests, []);
    assert.deepEqual(w.fake.discoveredDevices, []);
  }
});

test('a network of the configuration that does not exist is named in the status', async (t) => {
  const w = await createWorld({
    config: { ...CENTRAL_CONFIG, networks: 'ffffffffffffffff' },
  });
  t.after(() => w.app.stop());
  assert.match(w.fake.connectionStatus.message.en, /network not found.*ffffffffffffffff/);
});

test('"Test the connection" reports each network', async (t) => {
  const w = await createWorld({ config: { ...CENTRAL_CONFIG, language: 'fr' } });
  t.after(() => w.app.stop());
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.fr,
    "ZeroTier home : 4 membre(s), 2 en ligne, 1 en attente d'autorisation",
  );
  w.central.online = false;
  const failed = await w.fake.action('test_connection', {});
  assert.match(failed.data.message.en, /does not answer/);
});

test('a self-hosted controller: local transport, a stopped member goes offline', async (t) => {
  const w = await createWorld({ mode: 'local' });
  t.after(() => w.app.stop());
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.discoveredDevices.length, 3);
  assert.deepEqual(new Set(w.fake.transports.map((entry) => entry.transport)), new Set(['local']));
  const laptop = memberIdsOf(w.gladys, 'c0ffee1234');
  w.clock.advance(4 * 60_000);
  w.controller.peer('c0ffee1234').paths = [];
  await w.hub.poll();
  assert.equal(w.fake.lastState(laptop.feature(FEATURE_KEYS.ONLINE)), 0);
  assert.deepEqual(
    events(w, TRIGGERS.OFFLINE).map((event) => event.data.member),
    ['Laptop'],
  );
  // The controller node itself stays online.
  assert.equal(w.fake.lastState(memberIdsOf(w.gladys, '8056c2e21c').feature('online')), 1);
});

test('a new token starts over without scene events; a new language republishes texts', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  await w.fake.configUpdated({ ...LOCAL_CONFIG, url: '192.0.2.10:9993' });
  assert.equal(w.fake.discoveredDevices.length, 3);
  assert.deepEqual(w.fake.sceneEvents, []);
  const before = w.fake.states.length;
  await w.fake.configUpdated({ ...LOCAL_CONFIG, url: '192.0.2.10:9993', language: 'de' });
  const texts = w.fake.states.slice(before).filter((state) => state.text !== undefined);
  assert.ok(texts.length > 0, 'dates in German');
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('the container reads ZeroTier on its own timer, without Gladys polling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ timers: true });
  t.after(() => w.app.stop());
  const reads = () => w.central.requests.filter((r) => r.path === '/api/v1/network').length;
  assert.equal(reads(), 1);
  w.central.setOnline('NAS', true);
  t.mock.timers.tick(60_000);
  // Let the reading's promises settle.
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(reads(), 2);
  assert.deepEqual(
    events(w, TRIGGERS.ONLINE).map((event) => event.data.member),
    ['NAS'],
  );
  assert.equal(
    w.fake.discoveredDevices.every((device) => device.should_poll === false),
    true,
  );
});
