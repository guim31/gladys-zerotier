// -----------------------------------------------------------------------------
// The `members` dashboard widget: content within the core vocabulary and
// budget (validateWidgetContent), order of the rows, network setting, messages.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { MAX_ROWS } from '../src/widgets.js';
import { createWorld, networkIdsOf } from './helpers/world.js';

async function content(w, { language = 'en', settings = {} } = {}) {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const tree = ack.data.content;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

test('two tiles and one row per member: pending first, then online, then offline', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const [online, total, status] = (await content(w)).components;
  assert.equal(online.value, 2);
  assert.equal(total.value, 4);
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['b1b2b3b4b5', 'Awaiting authorization'],
      ['Laptop', 'Online'],
      ['NAS', '2 days ago'],
      ['Old phone', 'Never seen'],
    ],
  );
});

test('the network setting filters, a big network is cut with a counter row', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  for (let i = 0; i < 12; i += 1) {
    w.central.join(`f0f0f0f0${String(i).padStart(2, '0')}`, {
      authorized: true,
      name: `Node ${i}`,
    });
  }
  await w.hub.poll();
  const tree = await content(w, { settings: { network_device: networkIdsOf(w.gladys).device } });
  const status = tree.components[2];
  assert.equal(status.items.length, MAX_ROWS + 1);
  assert.equal(status.items.at(-1).value, 16 - MAX_ROWS);
  const other = await content(w, { settings: { network_device: 'zerotier:network:unknown' } });
  assert.equal(other.components[0].type, 'text');
});

test('messages: configuration problem, outage, in the dashboard language', async (t) => {
  const empty = await createWorld({ config: { language: 'en' } });
  t.after(() => empty.app.stop());
  assert.match((await content(empty, { language: 'de' })).components[0].text, /API-Token/);
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.central.online = false;
  await w.hub.poll();
  assert.match((await content(w, { language: 'fr' })).components[0].text, /ne répond pas/);
});
