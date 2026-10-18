// -----------------------------------------------------------------------------
// The ZeroTier hub: reads the API (Central or a self-hosted controller) on a
// timer of the container, publishes the devices and their states when they
// change, fires the scene events on transitions, and authorizes or revokes
// members on request (off by default).
//
// Gladys never polls these devices (should_poll: false): the scene events must
// fire even for a member whose device was not added, the intervals offered
// (30 s to 5 min) are not all in the core's list, and a device created
// without should_poll is never polled by Gladys 5.2 (Gladys#3198).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  buildMemberDevice,
  buildNetworkDevice,
  countOnline,
  countPending,
  memberIds,
  memberOf,
  memberValues,
  networkIds,
  networkName,
  networkValues,
} from './devices.js';
import { ERROR_KINDS, MODES, createClient } from './zerotier/client.js';
import { COMMAND_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, pick, render } from './texts.js';

const logger = createLogger({ name: 'zerotier-hub' });

export const WIDGET_KEY = 'members';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  ONLINE: 'member_online',
  OFFLINE: 'member_offline',
  PENDING: 'member_pending',
});

export const HUB_TIMINGS = {
  // Every state is sent again at least this often, so that Gladys never shows
  // "no recent value" for a value that does not change.
  heartbeatMs: 12 * 60 * 60_000,
  // After a 429 of Central, the interval doubles at each refusal, up to this.
  maxBackoff: 8,
};

const MAX_STATES_PER_REQUEST = 100;

export class ZeroTierHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {Function} [options.request] HTTP seam (src/zerotier/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    /** Networks of the last successful reading, in API order. */
    this.networks = [];
    this.read = false;
    this.error = null;
    this.backoff = 1;
    /** Last value published per feature external id. */
    this.published = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.heartbeatAt = 0;
    this.pollTimer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (connected, lost, back, user commands). A
  // problem that repeats every cycle is logged once at its own level, then at
  // debug until it clears. LOG_LEVEL=debug shows everything.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key) {
    this.warned.delete(key);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const signature = JSON.stringify([config.mode, config.token, config.url, config.networks]);
    if (signature !== this.signature || config.invalidNetworks.length > 0) {
      // Another API, token or set of networks: start over, without scene
      // events for what the first reading finds.
      this.signature = signature;
      this.client = config.invalidNetworks.length > 0 ? null : createClient(config, this.request);
      this.networks = [];
      this.read = false;
      this.error = null;
      this.backoff = 1;
      this.published.clear();
      this.transports.clear();
    } else if (previous && previous.language !== config.language) {
      // Last seen and "None" are localized texts.
      this.published.clear();
    }
    this.discovered = null;
    try {
      // Fresh: a reading in flight may have published before the change.
      await this.poll({ fresh: true });
    } finally {
      // Even after an unexpected error: the timer keeps reading.
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.polling?.catch(() => {});
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Poll failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs * this.backoff);
  }

  // --- Reading ---------------------------------------------------------------

  /**
   * Read the API and apply what changed. Concurrent calls share the read;
   * `fresh` reads again after the one in flight (the configuration changed).
   */
  poll({ fresh = false } = {}) {
    if (this.polling && !fresh) {
      return this.polling;
    }
    const previous = this.polling ?? Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(() => this.readApi())
      .finally(() => {
        if (this.polling === current) {
          this.polling = null;
        }
      });
    this.polling = current;
    return current;
  }

  /** Gladys asks for a refresh (onPoll): read now. */
  async pollDevice() {
    await this.poll();
  }

  async readApi() {
    const client = this.client;
    if (!client) {
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    let result;
    try {
      result = await client.read(this.now());
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      // Reconfigured during the reading: this one is stale.
      if (client === this.client && !this.stopped) {
        await this.applyFailure(err);
      }
      return;
    }
    if (client === this.client && !this.stopped) {
      await this.applySuccess(result.networks);
    }
  }

  get transport() {
    return this.config.mode === MODES.LOCAL ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD;
  }

  get sourceName() {
    return this.config.mode === MODES.LOCAL ? `controller ${this.config.url}` : 'ZeroTier Central';
  }

  async applySuccess(networks) {
    let widgetChanged = this.error !== null || !this.read;
    if (this.error) {
      logger.info(`${this.sourceName}: connection restored`);
    } else if (!this.read) {
      const members = networks.reduce((sum, network) => sum + network.members.length, 0);
      logger.info(
        `${this.sourceName}: connected, ${networks.length} network(s), ${members} member(s)`,
      );
    }
    this.error = null;
    this.backoff = 1;
    this.resolved('read');

    const before = new Map(this.networks.map((network) => [network.id, network]));
    const events = [];
    const gone = [];
    for (const network of networks) {
      const old = before.get(network.id);
      const oldMembers = new Map((old?.members ?? []).map((member) => [member.nodeId, member]));
      for (const member of network.members) {
        const prev = oldMembers.get(member.nodeId);
        // The controller forgets a peer that stopped: keep the last time seen.
        member.lastSeen ??= prev?.lastSeen ?? null;
        widgetChanged ||=
          !prev ||
          prev.online !== member.online ||
          prev.authorized !== member.authorized ||
          prev.name !== member.name;
        // No event at the first reading (what was the state before?), nor for
        // a network that just appeared (every member would be "new").
        if (!this.read || !old) {
          continue;
        }
        if (!prev && !member.authorized) {
          // A stranger knocking: "awaiting authorization", not "online".
          events.push([TRIGGERS.PENDING, network, member]);
          continue;
        }
        if ((prev?.online ?? false) !== member.online) {
          events.push([member.online ? TRIGGERS.ONLINE : TRIGGERS.OFFLINE, network, member]);
        }
      }
      for (const member of old?.members ?? []) {
        if (!network.members.some((candidate) => candidate.nodeId === member.nodeId)) {
          gone.push({ network, member });
        }
      }
    }
    for (const network of this.networks) {
      if (!networks.some((candidate) => candidate.id === network.id)) {
        widgetChanged = true;
        for (const member of network.members) {
          gone.push({ network, member });
        }
      }
    }
    widgetChanged ||= gone.length > 0;
    this.networks = networks;
    this.read = true;

    await this.forget(gone);
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports(true);
    await this.publishConnectionStatus();
    for (const [key, network, member] of events) {
      await this.fire(key, network, member);
    }
    if (widgetChanged) {
      this.refreshWidget();
    }
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message, network: err.network ?? null };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.sourceName}: ${err.message}`);
    } else {
      logger.debug(`${this.sourceName}: ${err.message} (again)`);
    }
    this.backoff =
      err.kind === ERROR_KINDS.RATE_LIMITED
        ? Math.min(this.backoff * 2, this.timings.maxBackoff)
        : 1;
    await this.publishDevices();
    await this.publishTransports(false);
    await this.publishConnectionStatus();
    if (wasError !== err.kind) {
      this.refreshWidget();
    }
  }

  refreshWidget() {
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Members gone from the API: their devices stay in Gladys, shown offline. */
  async forget(entries) {
    const states = [];
    for (const { network, member } of entries) {
      logger.debug(`Member ${member.name} left network ${network.name}`);
      const ids = memberIds(this.gladys, network.id, member.nodeId);
      for (const externalId of [...this.published.keys()]) {
        if (externalId.startsWith(`${ids.device}:`)) {
          this.published.delete(externalId);
        }
      }
      this.transports.delete(ids.device);
      if (member.online) {
        states.push({ device_feature_external_id: ids.feature(FEATURE_KEYS.ONLINE), state: 0 });
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishStates(states);
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async fire(key, network, member) {
    logger.debug(`Member ${member.name}: ${key}`);
    try {
      await this.gladys.publishSceneEvent(key, {
        device: memberIds(this.gladys, network.id, member.nodeId).device,
        member: member.name,
        node_id: member.nodeId,
        network: network.name,
        network_device: networkIds(this.gladys, network.id).device,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys --------------------------------------------------

  devices() {
    const options = { language: this.config.language, allowAuthorize: this.config.allowAuthorize };
    return this.networks.flatMap((network) => [
      buildNetworkDevice(this.gladys, network, options),
      ...network.members.map((member) => buildMemberDevice(this.gladys, network, member, options)),
    ]);
  }

  /** Publish the discovered devices when the list changes (names, members, options). */
  async publishDevices({ force = false } = {}) {
    const devices = this.devices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  values() {
    const language = this.config.language;
    return this.networks.flatMap((network) => [
      ...networkValues(this.gladys, network),
      ...network.members.flatMap((member) =>
        memberValues(this.gladys, network, member, { language }),
      ),
    ]);
  }

  /** Publish what changed (`only`: one device, everything). */
  async publishStates({ force = false, only = null } = {}) {
    if (!this.read || this.error) {
      return;
    }
    const now = this.now();
    const heartbeat = !only && now - this.heartbeatAt >= this.timings.heartbeatMs;
    const states = [];
    for (const { externalId, value } of this.values()) {
      if (value === null || (only && !externalId.startsWith(`${only}:`))) {
        continue;
      }
      if (!force && !heartbeat && this.published.get(externalId) === value) {
        continue;
      }
      // A text/text feature takes `text`, every other one a numeric `state`.
      states.push(
        typeof value === 'string'
          ? { device_feature_external_id: externalId, text: value }
          : { device_feature_external_id: externalId, state: value },
      );
    }
    let failed = false;
    for (let at = 0; at < states.length; at += MAX_STATES_PER_REQUEST) {
      const batch = states.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(batch);
        for (const state of batch) {
          this.published.set(state.device_feature_external_id, state.state ?? state.text);
        }
        this.resolved('states');
      } catch (err) {
        failed = true;
        this.problem('states', `States refused: ${err.message}`);
      }
    }
    if (heartbeat && !failed) {
      this.heartbeatAt = now;
    }
  }

  /** The transport badge of every device: the API mode, or unreachable. */
  async publishTransports(reachable) {
    const transport = reachable ? this.transport : DEVICE_TRANSPORTS.UNREACHABLE;
    const entries = [];
    for (const network of this.networks) {
      const ids = [
        networkIds(this.gladys, network.id).device,
        ...network.members.map(
          (member) => memberIds(this.gladys, network.id, member.nodeId).device,
        ),
      ];
      for (const externalId of ids) {
        if (this.transports.get(externalId) !== transport) {
          entries.push({ external_id: externalId, transport });
        }
      }
    }
    // The SDK takes 100 entries per call.
    for (let at = 0; at < entries.length; at += 100) {
      const batch = entries.slice(at, at + 100);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.resolved('transports');
      } catch (err) {
        this.problem('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The problem of the configuration, as a message, or null. */
  configProblem() {
    const { config } = this;
    if (config.invalidNetworks.length > 0) {
      return render(CONNECTION_TEXT.invalidNetworks, { ids: config.invalidNetworks.join(', ') });
    }
    if (!config.token) {
      return CONNECTION_TEXT.noToken;
    }
    if (config.mode === MODES.LOCAL && !config.url) {
      return config.invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl;
    }
    return null;
  }

  /** The error of the last reading, as a message (the network named when known). */
  errorMessage() {
    const text = ERROR_TEXT[this.error.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP];
    if (!this.error.network) {
      return text;
    }
    return Object.fromEntries(
      Object.entries(text).map(([language, value]) => [
        language,
        `${value} (${this.error.network})`,
      ]),
    );
  }

  connectionStatus() {
    const problem = this.configProblem();
    if (problem) {
      return { connected: false, message: problem };
    }
    if (this.error) {
      return { connected: false, message: this.errorMessage() };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  isOurDevice(externalId) {
    return (
      memberOf(this.gladys, externalId) !== null ||
      this.networks.some((network) => networkIds(this.gladys, network.id).device === externalId)
    );
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!this.isOurDevice(device.external_id)) {
      return;
    }
    await this.publishStates({ force: true, only: device.external_id });
    // Sent before the device existed, the transport was dropped by Gladys.
    this.transports.delete(device.external_id);
    if (this.read || this.error) {
      await this.publishTransports(this.error === null);
    }
    this.refreshWidget();
  }

  /** "Search" in the Discovery tab: publish the devices again, read the API. */
  async rediscover() {
    this.discovered = null;
    await this.poll();
  }

  /** A member of the last reading, with its network. */
  findMember(networkId, nodeId) {
    const network = this.networks.find((candidate) => candidate.id === networkId);
    const member = network?.members.find((candidate) => candidate.nodeId === nodeId);
    return member ? { network, member } : null;
  }

  // --- Commands --------------------------------------------------------------

  /** The "Authorized" switch of a member device. */
  async setValue(device, feature, value) {
    const target = memberOf(this.gladys, device.external_id);
    if (
      !target ||
      feature.external_id !==
        memberIds(this.gladys, target.networkId, target.nodeId).feature(FEATURE_KEYS.AUTHORIZED)
    ) {
      throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
    const language = this.config.language;
    if (!this.config.allowAuthorize) {
      throw new Error(pick(COMMAND_TEXT.readOnly, language));
    }
    const found = this.findMember(target.networkId, target.nodeId);
    if (!found || !this.client) {
      throw new Error(pick(COMMAND_TEXT.unknownMember, language));
    }
    const authorized = Number(value) === 1;
    try {
      await this.client.setAuthorized(target.networkId, target.nodeId, authorized);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.warn(`Member ${found.member.name}: command failed: ${err.message}`);
      throw new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], language), {
        cause: err,
      });
    }
    logger.info(
      `Member ${found.member.name} ${authorized ? 'authorized' : 'deauthorized'} on ${found.network.name}`,
    );
    // Read back: the switch shows what ZeroTier really did.
    await this.poll({ fresh: true });
  }

  // --- Configuration actions -------------------------------------------------

  /** "Test the connection": read now, one line per network. */
  async testConnection() {
    await this.poll({ fresh: true });
    const problem = this.configProblem();
    if (problem) {
      return problem;
    }
    if (this.error) {
      return this.errorMessage();
    }
    return Object.fromEntries(
      Object.entries(REPORT_TEXT).map(([language, text]) => [
        language,
        !this.read
          ? text.waiting
          : this.networks.length === 0
            ? text.none
            : this.networks
                .map((network) =>
                  text.network(
                    networkName(network),
                    network.members.length,
                    countOnline(network.members),
                    countPending(network.members),
                  ),
                )
                .join('\n'),
      ]),
    );
  }
}
