// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake ZeroTier API (Central
// or a self-hosted controller) on a fake network and a manual clock, with the
// integration wired on top through registerHandlers. No timer runs unless
// `timers: true` (with node:test mock timers): the tests read the API with
// `world.hub.poll()`. (Adapted from guim31/gladys-wg-easy.)
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { memberIds, networkIds } from '../../src/devices.js';
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
} from './fakeZeroTier.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';
// Dates are formatted in the time zone of Gladys.
process.env.TZ = 'Europe/Paris';

/** A manual clock. */
export function createClock(start = CENTRAL_CLOCK) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CENTRAL_CONFIG = { mode: 'central', token: CENTRAL_TOKEN, language: 'en' };
export const LOCAL_CONFIG = {
  mode: 'local',
  token: CONTROLLER_TOKEN,
  url: '192.0.2.10',
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {'central'|'local'} [options.mode]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.controllerOptions] FakeController options
 */
export async function createWorld({
  mode = 'central',
  clock = createClock(mode === 'local' ? CONTROLLER_CLOCK : CENTRAL_CLOCK),
  central = new FakeCentral({ clock }),
  controller,
  controllerOptions = {},
  config = mode === 'local' ? LOCAL_CONFIG : CENTRAL_CONFIG,
  devices = [],
  connect = true,
  timings = {},
  timers = false,
} = {}) {
  const local = controller ?? new FakeController({ clock, ...controllerOptions });
  const network = createNetwork({ central, controller: local });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    request: network,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    central,
    controller: local,
    api: mode === 'local' ? local : central,
    app,
    hub: app.hub,
    clock,
  };
}

export const memberIdsOf = (gladys, nodeId) => memberIds(gladys, NETWORK_ID, nodeId);
export const networkIdsOf = (gladys) => networkIds(gladys, NETWORK_ID);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { CONTROLLER_URL, FIXTURES, FakeCentral, FakeController, NETWORK_ID };
