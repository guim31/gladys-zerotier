// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the
// answers of ZeroTier Central (examples of its spec) and of a real
// self-hosted controller 1.14.2 (test/fixtures): online, offline, pending and
// never-seen members, direct and relayed peers, authorizing allowed or not,
// in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CENTRAL_CONFIG,
  FIXTURES,
  FakeCentral,
  LOCAL_CONFIG,
  createClock,
  createWorld,
} from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'Central: online, offline, pending, never seen, hidden', devices: 5 },
  {
    label: 'Central, an older answer with lastOnline',
    devices: 2,
    world: () => {
      const clock = createClock();
      return { clock, central: new FakeCentral({ clock, members: FIXTURES.central.lastOnline }) };
    },
  },
  { label: 'controller 1.14, direct path', devices: 3, world: () => ({ mode: 'local' }) },
  {
    label: 'controller, relayed peer',
    devices: 3,
    world: () => ({ mode: 'local', controllerOptions: { relay: true } }),
  },
  {
    label: 'controller before 1.12 (no /unstable)',
    devices: 3,
    world: () => ({ mode: 'local', controllerOptions: { legacy: true } }),
  },
  {
    label: 'authorizing allowed',
    devices: 5,
    world: () => ({ config: { ...CENTRAL_CONFIG, allow_authorize: true } }),
  },
  {
    label: 'French names',
    devices: 5,
    world: () => ({ config: { ...CENTRAL_CONFIG, language: 'fr' } }),
  },
  {
    label: 'German names',
    devices: 3,
    world: () => ({ mode: 'local', config: { ...LOCAL_CONFIG, language: 'de' } }),
  },
  {
    label: 'Spanish names',
    devices: 5,
    world: () => ({ config: { ...CENTRAL_CONFIG, language: 'es' } }),
  },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { gladys, app } = await createWorld(scenario.world?.() ?? {});
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, scenario.devices, 'the network and every visible member');

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(allowed.flat().includes(feature.unit), `${at}: unit not for its category`);
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the fixtures fits the declared bounds.
          const value = gladys.fake.lastState(feature.external_id);
          if (value === undefined) {
            // Only what ZeroTier does not know may be missing: the version or
            // the last check-in of a member never seen.
            assert.equal(feature.type, 'text', `${at}: no state published`);
            continue;
          }
          if (feature.category === 'text') {
            // A text/text state is never empty, or Gladys ignores it.
            assert.equal(typeof value, 'string', `${at}: ${value} is not a text`);
            assert.ok(value.trim().length > 0, `${at}: empty text`);
            continue;
          }
          assert.equal(typeof value, 'number', `${at}: ${value} is not a number`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
    } finally {
      await app.stop();
    }
  });
}
