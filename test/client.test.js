// -----------------------------------------------------------------------------
// The ZeroTier API clients, on the fixtures: Central (spec examples) and a
// self-hosted controller (real answers of ZeroTier 1.14.2).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseControllerUrl, parseNetworks } from '../src/config.js';
import {
  CentralClient,
  ControllerClient,
  ERROR_KINDS,
  createClient,
} from '../src/zerotier/client.js';
import {
  CENTRAL_CLOCK,
  CENTRAL_TOKEN,
  CONTROLLER_CLOCK,
  CONTROLLER_TOKEN,
  CONTROLLER_URL,
  FIXTURES,
  FakeCentral,
  FakeController,
  NETWORK_ID,
  createNetwork,
} from './helpers/fakeZeroTier.js';
import { createClock } from './helpers/world.js';

function central(options = {}) {
  const clock = createClock(CENTRAL_CLOCK);
  const api = new FakeCentral({ clock, ...options });
  const client = new CentralClient({
    token: CENTRAL_TOKEN,
    request: createNetwork({ central: api }),
    ...options.client,
  });
  return { clock, api, client };
}

function controller(options = {}) {
  const clock = createClock(CONTROLLER_CLOCK);
  const api = new FakeController({ clock, ...options });
  const client = new ControllerClient({
    url: CONTROLLER_URL,
    token: CONTROLLER_TOKEN,
    request: createNetwork({ controller: api }),
    ...options.client,
  });
  return { clock, api, client };
}

test('Central: members with their presence, hidden ones skipped', async () => {
  const { client, clock, api } = central();
  const { networks } = await client.read(clock.now());
  assert.equal(networks.length, 1);
  assert.equal(networks[0].name, 'home');
  const byNode = Object.fromEntries(networks[0].members.map((m) => [m.nodeId, m]));
  assert.deepEqual(Object.keys(byNode).sort(), [
    'a1a2a3a4a5',
    'b1b2b3b4b5',
    'c0ffee1234',
    'd1d2d3d4d5',
  ]);
  assert.deepEqual(byNode.c0ffee1234, {
    nodeId: 'c0ffee1234',
    name: 'Laptop',
    authorized: true,
    ips: ['192.0.2.30'],
    version: '1.14.2',
    online: true,
    lastSeen: CENTRAL_CLOCK - 40_000,
  });
  assert.equal(byNode.a1a2a3a4a5.online, false, 'seen two days ago');
  assert.deepEqual(byNode.a1a2a3a4a5.ips, ['192.0.2.31', 'fd00::31']);
  assert.equal(byNode.b1b2b3b4b5.name, 'b1b2b3b4b5', 'no name: the node id');
  assert.equal(byNode.b1b2b3b4b5.authorized, false);
  assert.deepEqual(
    [byNode.d1d2d3d4d5.online, byNode.d1d2d3d4d5.lastSeen, byNode.d1d2d3d4d5.version],
    [false, null, null],
    'never seen',
  );
  assert.deepEqual(
    api.requests.map((r) => r.path),
    ['/api/v1/network', `/api/v1/network/${NETWORK_ID}/member`],
  );
});

test('Central: the presence is computed on the clock of Central, older lastOnline read', async () => {
  const { client, api } = central({ members: FIXTURES.central.lastOnline });
  // The container's clock is an hour late: Central's own clock decides.
  const { networks } = await client.read(api.clock.now() - 3_600_000);
  assert.equal(networks[0].members[0].online, true);
  assert.equal(networks[0].members[0].lastSeen, CENTRAL_CLOCK - 60_000);
  assert.equal(networks[0].members[0].version, '1.10.6');
});

test('Central: errors are classified, the token never appears in them', async () => {
  const cases = [
    [{ client: { token: 'wrong' } }, ERROR_KINDS.AUTH],
    [{ status: 429 }, ERROR_KINDS.RATE_LIMITED],
    [{ status: 500 }, ERROR_KINDS.HTTP],
    [{ online: false }, ERROR_KINDS.UNREACHABLE],
    [{ client: { networks: ['ffffffffffffffff'] } }, ERROR_KINDS.NOT_FOUND],
  ];
  for (const [options, kind] of cases) {
    const { client, api } = central(options);
    if (options.status) {
      api.status = options.status;
    }
    if (options.online === false) {
      api.online = false;
    }
    await assert.rejects(client.read(), (err) => {
      assert.equal(err.kind, kind, JSON.stringify(options));
      assert.ok(!err.message.includes(CENTRAL_TOKEN) && !err.message.includes('wrong'));
      return true;
    });
  }
});

test('Central: authorizing a member posts its config', async () => {
  const { client, api } = central();
  await client.setAuthorized(NETWORK_ID, 'b1b2b3b4b5', true);
  assert.equal(api.members.find((m) => m.nodeId === 'b1b2b3b4b5').config.authorized, true);
});

test('controller 1.14: one listing per network, presence from the peers', async () => {
  const { client, clock, api } = controller();
  const { networks } = await client.read(clock.now());
  assert.equal(client.version, '1.14.2');
  assert.deepEqual(networks[0].members, [
    {
      nodeId: '8056c2e21c',
      name: '8056c2e21c',
      authorized: true,
      ips: ['192.0.2.250'],
      version: '1.14.2',
      online: true,
      lastSeen: CONTROLLER_CLOCK,
    },
    {
      nodeId: 'c0ffee1234',
      name: 'Laptop',
      authorized: true,
      ips: ['192.0.2.30'],
      version: '1.14.2',
      online: true,
      lastSeen: Math.max(...FIXTURES.controller.peersDirect.at(-1).paths.map((p) => p.lastReceive)),
    },
  ]);
  assert.deepEqual(
    api.requests.map((r) => r.path),
    [
      '/status',
      '/unstable/controller/network',
      '/peer',
      `/unstable/controller/network/${NETWORK_ID}/member`,
    ],
  );
});

test('controller: a stopped member goes offline, as seen on 1.14.2', async () => {
  const { client, clock, api } = controller();
  const laptop = async () =>
    (await client.read(clock.now())).networks[0].members.find((m) => m.name === 'Laptop');
  assert.equal((await laptop()).online, true);
  const heard = (await laptop()).lastSeen;
  // Paths still "active", but not heard for 3 minutes.
  clock.advance(3 * 60_000);
  assert.equal((await laptop()).online, false);
  // About 4 minutes after: the paths go, the peer looks relayed.
  api.peer('c0ffee1234').paths = [];
  clock.advance(60_000);
  assert.deepEqual([(await laptop()).online, (await laptop()).lastSeen], [false, heard]);
  // About 9 minutes after: the node drops the peer (the hub keeps the date).
  api.forget('c0ffee1234');
  clock.advance(5 * 60_000);
  assert.deepEqual([(await laptop()).online, (await laptop()).lastSeen], [false, null]);
  // Back.
  api.peers.push(structuredClone(FIXTURES.controller.peersDirect.at(-1)));
  api.heard('c0ffee1234');
  assert.equal((await laptop()).online, true);
});

test('controller: a member that moved behind a relay is online again once clearly alive', async () => {
  const { client, clock, api } = controller();
  const laptop = async () =>
    (await client.read(clock.now())).networks[0].members.find((m) => m.name === 'Laptop');
  await laptop();
  api.peer('c0ffee1234').paths = [];
  clock.advance(5 * 60_000);
  assert.equal((await laptop()).online, false, 'like a stopped member, for a while');
  clock.advance(8 * 60_000);
  assert.equal((await laptop()).online, true, 'still listed after 13 minutes: relayed');
});

test('controller: a relayed member (no path ever) is online once listed for 2 minutes', async () => {
  const { client, clock } = controller({ relay: true });
  const laptop = async () =>
    (await client.read(clock.now())).networks[0].members.find((m) => m.name === 'Laptop');
  assert.equal((await laptop()).online, false, 'maybe a stub of the controller');
  clock.advance(2 * 60_000);
  const member = await laptop();
  assert.equal(member.online, true);
  assert.equal(member.version, '1.14.2', 'the version of the member record');
});

test('controller: the stub of a stopped member, listed a few seconds, is not online', async () => {
  // Seen on 1.14.2: authorizing a stopped member lists it without path briefly.
  const { client, clock, api } = controller({ relay: true });
  const laptop = async () =>
    (await client.read(clock.now())).networks[0].members.find((m) => m.name === 'Laptop');
  assert.equal((await laptop()).online, false);
  api.forget('c0ffee1234');
  clock.advance(30_000);
  assert.equal((await laptop()).online, false);
  api.peers.push(structuredClone(FIXTURES.controller.peersRelay.at(-1)));
  clock.advance(2 * 60_000);
  assert.equal((await laptop()).online, false, 'listed again: the 2 minutes start over');
});

test('controller before 1.12: falls back to one request per member, once', async () => {
  const { client, clock, api } = controller({ legacy: true });
  const first = await client.read(clock.now());
  assert.equal(first.networks[0].name, 'home');
  assert.equal(first.networks[0].members.length, 2);
  api.requests.length = 0;
  await client.read(clock.now());
  assert.ok(!api.requests.some((r) => r.path.startsWith('/unstable')), 'not tried again');
  assert.ok(api.requests.some((r) => r.path.endsWith('/member/c0ffee1234')));
});

test('controller: a node that is not a controller, a refused token', async () => {
  await assert.rejects(controller({ controller: false }).client.read(), {
    kind: ERROR_KINDS.NOT_CONTROLLER,
  });
  await assert.rejects(controller({ client: { token: 'nope' } }).client.read(), {
    kind: ERROR_KINDS.AUTH,
  });
});

test('controller: authorizing a member posts { authorized }', async () => {
  const { client, api } = controller();
  await client.setAuthorized(NETWORK_ID, 'c0ffee1234', false);
  assert.equal(api.find('Laptop').authorized, false);
});

test('configuration: addresses, network ids, client choice', () => {
  assert.equal(parseControllerUrl('192.0.2.10'), 'http://192.0.2.10:9993');
  assert.equal(parseControllerUrl('192.0.2.10:9994'), 'http://192.0.2.10:9994');
  assert.equal(parseControllerUrl('http://192.0.2.10:80'), 'http://192.0.2.10');
  assert.equal(parseControllerUrl('https://zt.example.com/'), 'https://zt.example.com');
  assert.equal(parseControllerUrl('http://user:pw@192.0.2.10'), null);
  assert.equal(parseControllerUrl('ftp://192.0.2.10'), null);
  assert.deepEqual(parseNetworks(' 8056C2E21C000001, 8056c2e21c000001;abc '), {
    ids: ['8056c2e21c000001'],
    invalid: ['abc'],
  });
  const config = normalizeConfig({ mode: 'local', token: ' t \n', url: '192.0.2.10' });
  assert.equal(config.token, 't');
  assert.ok(createClient(config) instanceof ControllerClient);
  assert.ok(createClient(normalizeConfig({ token: 't' })) instanceof CentralClient);
  assert.equal(createClient(normalizeConfig({ mode: 'local', token: 't' })), null);
  assert.equal(createClient(normalizeConfig({})), null);
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 60_000);
});
