// -----------------------------------------------------------------------------
// In-memory ZeroTier APIs, built on the fixtures: ZeroTier Central (from the
// examples of its OpenAPI spec) and a self-hosted controller (real answers of
// ZeroTier 1.14.2 in Docker, anonymized). Both answer through `request`, the
// seam of src/zerotier/http.js; tests never touch the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const load = (path) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8'));

export const FIXTURES = {
  central: {
    networks: load('central/networks.json'),
    members: load('central/members.json'),
    lastOnline: load('central/members-last-online.json'),
  },
  controller: {
    status: load('controller/status.json'),
    networks: load('controller/unstable-networks.json'),
    members: load('controller/unstable-members.json'),
    network: load('controller/network.json'),
    memberMap: load('controller/member-map.json'),
    pending: load('controller/member-pending.json'),
    authorized: load('controller/member-authorized.json'),
    peersDirect: load('controller/peers-direct.json'),
    peersRelay: load('controller/peers-relay.json'),
  },
};

export const CENTRAL_TOKEN = 'central-token-123';
export const CONTROLLER_TOKEN = 'zt1-authtoken-456';
export const CONTROLLER_URL = 'http://192.0.2.10:9993';
export const NETWORK_ID = '8056c2e21c000001';
// Central fixtures: the time of Central when it answered.
export const CENTRAL_CLOCK = FIXTURES.central.members[0].clock;
// Controller fixtures: the clock of /status, 5 s after the last path heard.
export const CONTROLLER_CLOCK = FIXTURES.controller.status.clock;

const json = (status, body) => ({ status, headers: {}, body: JSON.stringify(body) });

export class FakeCentral {
  constructor({ clock, members = FIXTURES.central.members } = {}) {
    this.clock = clock;
    this.networks = structuredClone(FIXTURES.central.networks);
    this.members = structuredClone(members);
    this.online = true;
    this.status = null; // force an HTTP status on every request
    this.requests = [];
  }

  find(name) {
    return this.members.find((member) => member.name === name);
  }

  /** The member checks in now (online) or stopped long ago (offline). */
  setOnline(name, online) {
    this.find(name).lastSeen = online ? this.clock.now() : this.clock.now() - 3_600_000;
  }

  join(nodeId, { authorized = false, name = '' } = {}) {
    const member = structuredClone(FIXTURES.central.members[0]);
    Object.assign(member, { nodeId, id: `${NETWORK_ID}-${nodeId}`, name });
    member.config = { ...member.config, id: nodeId, authorized, ipAssignments: [] };
    member.lastSeen = this.clock.now();
    this.members.push(member);
    return member;
  }

  handle(url, { method, headers, json: body }) {
    if (!this.online) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (headers.authorization !== `token ${CENTRAL_TOKEN}`) {
      return json(401, { message: 'unauthorized' });
    }
    if (this.status) {
      return json(this.status, {});
    }
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const now = this.clock.now();
    if (method === 'GET' && path === '/network') {
      return json(200, this.networks);
    }
    let match = path.match(/^\/network\/([0-9a-f]{16})\/member$/);
    if (method === 'GET' && match) {
      if (!this.networks.some((network) => network.id === match[1])) {
        return json(404, {});
      }
      return json(
        200,
        this.members.map((member) => ({ ...member, clock: now })),
      );
    }
    match = path.match(/^\/network\/([0-9a-f]{16})\/member\/([0-9a-f]{10})$/);
    if (method === 'POST' && match) {
      const member = this.members.find((candidate) => candidate.nodeId === match[2]);
      if (!member) {
        return json(404, {});
      }
      member.config.authorized = body.config.authorized;
      return json(200, member);
    }
    return json(404, {});
  }
}

export class FakeController {
  constructor({ clock, legacy = false, relay = false, controller = true } = {}) {
    this.clock = clock;
    this.legacy = legacy;
    this.controller = controller;
    this.status = structuredClone(FIXTURES.controller.status);
    this.network = structuredClone(FIXTURES.controller.network);
    this.members = structuredClone(FIXTURES.controller.members.data);
    this.peers = structuredClone(
      relay ? FIXTURES.controller.peersRelay : FIXTURES.controller.peersDirect,
    );
    this.online = true;
    this.requests = [];
  }

  find(name) {
    return this.members.find((member) => member.name === name);
  }

  peer(address) {
    return this.peers.find((peer) => peer.address === address);
  }

  /** The peer pinged the controller now. */
  heard(address) {
    for (const path of this.peer(address).paths) {
      path.lastReceive = this.clock.now();
    }
  }

  /** The node forgot the peer (stopped for minutes). */
  forget(address) {
    this.peers = this.peers.filter((peer) => peer.address !== address);
  }

  join(address, { authorized = false } = {}) {
    const member = structuredClone(FIXTURES.controller.pending);
    Object.assign(member, { address, id: address, authorized });
    delete member.name;
    this.members.push(member);
    this.peers.push({ ...structuredClone(FIXTURES.controller.peersRelay.at(-1)), address });
    return member;
  }

  handle(url, { method, headers, json: body }) {
    if (!this.online) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (headers['x-zt1-auth'] !== CONTROLLER_TOKEN) {
      return json(401, {});
    }
    const path = url.pathname;
    const now = this.clock.now();
    if (path === '/status') {
      return json(200, { ...this.status, clock: now });
    }
    if (path === '/peer') {
      return json(200, this.peers);
    }
    if (!this.controller) {
      return json(404, {});
    }
    if (path === '/unstable/controller/network' && !this.legacy) {
      return json(200, {
        data: [this.network],
        meta: { networkCount: 1 },
      });
    }
    if (path === `/unstable/controller/network/${NETWORK_ID}/member` && !this.legacy) {
      return json(200, { data: this.members, meta: { totalCount: this.members.length } });
    }
    if (path === '/controller/network') {
      return json(200, [NETWORK_ID]);
    }
    if (path === `/controller/network/${NETWORK_ID}`) {
      return json(200, this.network);
    }
    if (path === `/controller/network/${NETWORK_ID}/member`) {
      return json(200, Object.fromEntries(this.members.map((member) => [member.id, 3])));
    }
    const match = path.match(/^\/controller\/network\/[0-9a-f]{16}\/member\/([0-9a-f]{10})$/);
    if (match) {
      const member = this.members.find((candidate) => candidate.id === match[1]);
      if (!member) {
        return json(404, {});
      }
      if (method === 'POST') {
        member.authorized = body.authorized;
      }
      return json(200, member);
    }
    return json(404, {});
  }
}

/** The `request` seam: routes by origin to the fakes, refuses anything else. */
export function createNetwork({ central, controller }) {
  return async function request(raw, options = {}) {
    const url = new URL(raw);
    const call = {
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      json: options.json,
    };
    const target =
      url.origin === 'https://api.zerotier.com'
        ? central
        : url.origin === CONTROLLER_URL
          ? controller
          : null;
    if (!target) {
      const error = new Error('getaddrinfo ENOTFOUND');
      error.code = 'ENOTFOUND';
      throw error;
    }
    target.requests.push({ method: call.method, path: url.pathname });
    return target.handle(url, call);
  };
}
