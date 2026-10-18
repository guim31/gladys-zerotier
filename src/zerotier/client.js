// -----------------------------------------------------------------------------
// ZeroTier API clients, one per mode, both returning the same model:
//
//   { networks: [{ id, name, members: [{ nodeId, name, authorized, ips,
//     version, online, lastSeen }] }] }
//
// ZeroTier Central (cloud, https://api.zerotier.com/api/v1, `Authorization:
// token …`): `GET /network`, `GET /network/{id}/member`. A member has no
// "online" flag in the current API (spec.json of zerotier/go-ztcentral): only
// `lastSeen` (last check-in with the controller; `lastOnline` on older
// answers), in ms, next to `clock`, the time of Central when it answered. A
// member checks in about every minute: seen within 5 minutes means online.
// Central keeps deleted members as `hidden`: they are skipped.
//
// Self-hosted controller (the local API of a ZeroTier node, port 9993,
// `X-ZT1-Auth` with the content of `authtoken.secret`), checked on 1.14.2 in
// Docker (test/fixtures/controller): `/unstable/controller/network` and
// `/unstable/controller/network/{id}/member` list everything in one request
// (1.12 and later); older nodes answer 404 there, and the client falls back to
// `/controller/network/{id}/member` (a map id → revision) then one request per
// member. The controller stores no "last seen": the presence comes from the
// node's peers (`GET /peer`). A member pings its controller every minute.
// Seen on 1.14.2 after stopping a member: its paths keep `active: true` and
// `expired: false` for about 4 minutes (only `lastReceive` tells: heard
// within 3 minutes means online), then the paths go and the peer looks like a
// relayed one (no path, latency -1) until the node drops it, about 9 minutes
// after the stop. So a peer without path is online only if it never had a
// path to remember (a relayed member): the client keeps the last time each
// member was heard. The controller node itself is never one of its peers: it
// is online since it answers.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const MODES = Object.freeze({ CENTRAL: 'central', LOCAL: 'local' });

export const CENTRAL_URL = 'https://api.zerotier.com/api/v1';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall, allowManagementFrom
  AUTH: 'auth', // token refused
  NOT_FOUND: 'not_found', // a network of the configuration does not exist (or is not visible)
  NOT_CONTROLLER: 'not_controller', // a ZeroTier node, but not a controller
  RATE_LIMITED: 'rate_limited', // Central said 429
  HTTP: 'http', // any other answer
});

// Central: last check-in younger than this means online.
export const CENTRAL_ONLINE_WITHIN_MS = 5 * 60_000;
// Local: a direct path heard within this means online (pings every 60 s).
export const PEER_ONLINE_WITHIN_MS = 3 * 60_000;

export class ZeroTierError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status, network }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ZeroTierError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const NETWORK_ID = /^[0-9a-f]{16}$/;
const NODE_ID = /^[0-9a-f]{10}$/;

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

const toTime = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const ips = (value) =>
  Array.isArray(value) ? value.filter((ip) => typeof ip === 'string' && ip) : [];

/** "1.14.2" from vMajor/vMinor/vRev (-1 when the member never told). */
export function versionOf(major, minor, revision) {
  return [major, minor, revision].every((part) => Number.isInteger(part) && part >= 0)
    ? `${major}.${minor}.${revision}`
    : null;
}

const byName = (a, b) => a.name.localeCompare(b.name) || a.nodeId.localeCompare(b.nodeId);

class BaseClient {
  /**
   * @param {object} options
   * @param {string} options.token API token (never logged)
   * @param {string[]} [options.networks] network ids to read, all when empty
   * @param {Function} [options.request] HTTP seam (src/zerotier/http.js)
   */
  constructor({ token, networks = [], request = httpRequest }) {
    this.token = token;
    this.wanted = networks;
    this.request = request;
  }

  async call(url, { method = 'GET', json, network } = {}) {
    let response;
    try {
      response = await this.request(url, { method, json, headers: this.headers() });
    } catch (err) {
      throw new ZeroTierError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }
    const { status } = response;
    if (status === 401 || status === 403) {
      throw new ZeroTierError(ERROR_KINDS.AUTH, `Token refused (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new ZeroTierError(ERROR_KINDS.NOT_FOUND, `Not found: ${new URL(url).pathname}`, {
        status,
        network,
      });
    }
    if (status === 429) {
      throw new ZeroTierError(ERROR_KINDS.RATE_LIMITED, 'Rate limited (HTTP 429)', { status });
    }
    if (status < 200 || status >= 300) {
      throw new ZeroTierError(ERROR_KINDS.HTTP, `HTTP ${status} on ${new URL(url).pathname}`, {
        status,
      });
    }
    const data = parseJson(response.body);
    if (data === undefined) {
      throw new ZeroTierError(ERROR_KINDS.HTTP, `Not JSON on ${new URL(url).pathname}`, {
        status,
      });
    }
    return data;
  }

  /** The network ids to read among the ones the API lists. */
  select(available) {
    if (this.wanted.length === 0) {
      return available;
    }
    const missing = this.wanted.find((id) => !available.includes(id));
    if (missing) {
      throw new ZeroTierError(ERROR_KINDS.NOT_FOUND, `Network ${missing} not found`, {
        network: missing,
      });
    }
    return this.wanted;
  }
}

export class CentralClient extends BaseClient {
  constructor(options) {
    super(options);
    this.mode = MODES.CENTRAL;
    this.base = CENTRAL_URL;
  }

  headers() {
    return { authorization: `token ${this.token}` };
  }

  /** @param {object} raw a member of `GET /network/{id}/member` */
  static parseMember(raw, now) {
    const nodeId = text(raw?.nodeId) ?? text(raw?.config?.id);
    if (!nodeId || !NODE_ID.test(nodeId) || raw.hidden === true) {
      return null;
    }
    const lastSeen = toTime(raw.lastSeen) ?? toTime(raw.lastOnline);
    // Central's own clock: no skew with the container's.
    const clock = toTime(raw.clock) ?? now;
    const config = raw.config ?? {};
    return {
      nodeId,
      name: text(raw.name) ?? nodeId,
      authorized: config.authorized === true,
      ips: ips(config.ipAssignments),
      version:
        text(raw.clientVersion) ?? versionOf(config.vMajor, config.vMinor, config.vRev) ?? null,
      online: lastSeen !== null && clock - lastSeen < CENTRAL_ONLINE_WITHIN_MS,
      lastSeen,
    };
  }

  async read(now = Date.now()) {
    const list = await this.call(`${this.base}/network`);
    if (!Array.isArray(list)) {
      throw new ZeroTierError(ERROR_KINDS.HTTP, 'Unexpected network list');
    }
    const names = new Map(
      list
        .filter((network) => NETWORK_ID.test(network?.id ?? ''))
        .map((network) => [network.id, text(network.config?.name) ?? network.id]),
    );
    const networks = [];
    for (const id of this.select([...names.keys()])) {
      const members = await this.call(`${this.base}/network/${id}/member`, { network: id });
      if (!Array.isArray(members)) {
        throw new ZeroTierError(ERROR_KINDS.HTTP, 'Unexpected member list');
      }
      networks.push({
        id,
        name: names.get(id),
        members: members
          .map((raw) => CentralClient.parseMember(raw, now))
          .filter(Boolean)
          .sort(byName),
      });
    }
    return { networks };
  }

  async setAuthorized(networkId, nodeId, authorized) {
    await this.call(`${this.base}/network/${networkId}/member/${nodeId}`, {
      method: 'POST',
      json: { config: { authorized } },
      network: networkId,
    });
  }
}

export class ControllerClient extends BaseClient {
  /** @param {object} options see BaseClient, plus `url` (http://host:9993) */
  constructor(options) {
    super(options);
    this.mode = MODES.LOCAL;
    this.base = options.url;
    // null: not known yet; false: the node has no /unstable listing (before 1.12).
    this.unstable = null;
    this.version = null;
    /** Last `lastReceive` of a direct path, per node id. */
    this.lastHeard = new Map();
  }

  headers() {
    return { 'x-zt1-auth': this.token };
  }

  /**
   * Presence of a member, from the node's peers.
   * @param {object|undefined} peer its entry of `/peer`
   * @param {number} clock the node's clock
   * @param {number|null} heard the last time a direct path was heard, if any
   */
  static presence(peer, clock, heard = null) {
    if (!peer) {
      return { online: false, lastSeen: heard };
    }
    const paths = Array.isArray(peer.paths) ? peer.paths : [];
    const times = paths.map((path) => toTime(path?.lastReceive)).filter((time) => time !== null);
    if (times.length > 0) {
      const lastSeen = Math.max(...times);
      return { online: clock - lastSeen < PEER_ONLINE_WITHIN_MS, lastSeen };
    }
    if (heard !== null) {
      // Its direct paths expired: a member that stopped, still listed.
      return { online: clock - heard < PEER_ONLINE_WITHIN_MS, lastSeen: heard };
    }
    // Relayed: no path to read, but the node still hears from it.
    return { online: true, lastSeen: clock };
  }

  /** @param {object} raw a controller member; `peers` by address */
  static parseMember(raw, { peers, self, clock, lastHeard = new Map() }) {
    const nodeId = text(raw?.address) ?? text(raw?.id);
    if (!nodeId || !NODE_ID.test(nodeId)) {
      return null;
    }
    const peer = peers.get(nodeId);
    const { online, lastSeen } =
      nodeId === self
        ? { online: true, lastSeen: clock }
        : ControllerClient.presence(peer, clock, lastHeard.get(nodeId) ?? null);
    return {
      nodeId,
      name: text(raw.name) ?? nodeId,
      authorized: raw.authorized === true,
      ips: ips(raw.ipAssignments),
      version:
        versionOf(raw.vMajor, raw.vMinor, raw.vRev) ??
        versionOf(peer?.versionMajor, peer?.versionMinor, peer?.versionRev),
      online,
      lastSeen,
    };
  }

  async listNetworks() {
    if (this.unstable !== false) {
      try {
        const answer = await this.call(`${this.base}/unstable/controller/network`);
        this.unstable = true;
        return (Array.isArray(answer?.data) ? answer.data : []).map((network) => ({
          id: network?.id,
          name: text(network?.name),
        }));
      } catch (err) {
        if (err.kind !== ERROR_KINDS.NOT_FOUND) {
          throw err;
        }
        this.unstable = false;
      }
    }
    const ids = await this.call(`${this.base}/controller/network`);
    if (!Array.isArray(ids)) {
      throw new ZeroTierError(ERROR_KINDS.HTTP, 'Unexpected network list');
    }
    const networks = [];
    for (const id of ids.filter((value) => NETWORK_ID.test(value))) {
      const network = await this.call(`${this.base}/controller/network/${id}`, { network: id });
      networks.push({ id, name: text(network?.name) });
    }
    return networks;
  }

  async listMembers(id) {
    if (this.unstable) {
      const answer = await this.call(`${this.base}/unstable/controller/network/${id}/member`, {
        network: id,
      });
      return Array.isArray(answer?.data) ? answer.data : [];
    }
    const map = await this.call(`${this.base}/controller/network/${id}/member`, { network: id });
    const members = [];
    for (const nodeId of Object.keys(map ?? {}).filter((key) => NODE_ID.test(key))) {
      members.push(
        await this.call(`${this.base}/controller/network/${id}/member/${nodeId}`, { network: id }),
      );
    }
    return members;
  }

  async read(now = Date.now()) {
    const status = await this.call(`${this.base}/status`);
    const self = text(status?.address);
    this.version = text(status?.version);
    const clock = toTime(status?.clock) ?? now;
    let networks;
    try {
      networks = await this.listNetworks();
    } catch (err) {
      // A node that is not a controller answers 404 on /controller.
      if (err.kind === ERROR_KINDS.NOT_FOUND) {
        throw new ZeroTierError(ERROR_KINDS.NOT_CONTROLLER, 'This node is not a controller');
      }
      throw err;
    }
    const known = networks.filter((network) => NETWORK_ID.test(network.id ?? ''));
    const names = new Map(known.map((network) => [network.id, network.name ?? network.id]));
    const peerList = await this.call(`${this.base}/peer`);
    const peers = new Map(
      (Array.isArray(peerList) ? peerList : [])
        .filter((peer) => peer?.role === 'LEAF' && typeof peer.address === 'string')
        .map((peer) => [peer.address, peer]),
    );
    for (const [address, peer] of peers) {
      const times = (Array.isArray(peer.paths) ? peer.paths : [])
        .map((path) => toTime(path?.lastReceive))
        .filter((time) => time !== null);
      if (times.length > 0) {
        this.lastHeard.set(address, Math.max(...times));
      }
    }
    const result = [];
    for (const id of this.select([...names.keys()])) {
      const members = await this.listMembers(id);
      result.push({
        id,
        name: names.get(id),
        members: members
          .map((raw) =>
            ControllerClient.parseMember(raw, { peers, self, clock, lastHeard: this.lastHeard }),
          )
          .filter(Boolean)
          .sort(byName),
      });
    }
    return { networks: result };
  }

  async setAuthorized(networkId, nodeId, authorized) {
    await this.call(`${this.base}/controller/network/${networkId}/member/${nodeId}`, {
      method: 'POST',
      json: { authorized },
      network: networkId,
    });
  }
}

/** The client of a normalized configuration, null when it cannot work. */
export function createClient(config, request) {
  if (!config.token) {
    return null;
  }
  if (config.mode === MODES.LOCAL) {
    return config.url
      ? new ControllerClient({
          url: config.url,
          token: config.token,
          networks: config.networks,
          request,
        })
      : null;
  }
  return new CentralClient({ token: config.token, networks: config.networks, request });
}
