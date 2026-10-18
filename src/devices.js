// -----------------------------------------------------------------------------
// Gladys devices: one per ZeroTier network, one per member of a network.
//
// Identity: a network is its 16-character id (`network:<nwid>`); a member is
// the network id and its 10-character node id (`member:<nwid>-<node>`), the
// id Central gives it too. The same node in two networks is two devices: its
// authorization is per network.
//
// Member features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - online: presence-sensor/binary (src/zerotier/client.js tells how);
//   - authorized: switch/binary, read only unless the configuration allows
//     authorizing members from Gladys;
//   - last seen, managed IP address, ZeroTier version: text/text (Gladys has
//     no timestamp couple). The date changes only when the member comes online
//     or goes offline, not at each check-in of an online member.
// Network features: online members, members, pending authorizations
// (counter-sensor/integer).
//
// The devices are published with should_poll: false: the integration reads
// the API on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const NETWORK_TYPE = 'network';
export const MEMBER_TYPE = 'member';
export const NODE_PARAM = 'ZEROTIER_NODE_ID';
export const NETWORK_PARAM = 'ZEROTIER_NETWORK_ID';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  AUTHORIZED: 'authorized',
  LAST_SEEN: 'last_seen',
  IP: 'ip_address',
  VERSION: 'version',
  ONLINE_MEMBERS: 'online_members',
  MEMBERS: 'members',
  PENDING: 'pending',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.ONLINE]: 'Online',
    [FEATURE_KEYS.AUTHORIZED]: 'Authorized',
    [FEATURE_KEYS.LAST_SEEN]: 'Last seen',
    [FEATURE_KEYS.IP]: 'Managed IP address',
    [FEATURE_KEYS.VERSION]: 'ZeroTier version',
    [FEATURE_KEYS.ONLINE_MEMBERS]: 'Online members',
    [FEATURE_KEYS.MEMBERS]: 'Members',
    [FEATURE_KEYS.PENDING]: 'Awaiting authorization',
  },
  fr: {
    [FEATURE_KEYS.ONLINE]: 'En ligne',
    [FEATURE_KEYS.AUTHORIZED]: 'Autorisé',
    [FEATURE_KEYS.LAST_SEEN]: 'Vu pour la dernière fois',
    [FEATURE_KEYS.IP]: 'Adresse IP gérée',
    [FEATURE_KEYS.VERSION]: 'Version de ZeroTier',
    [FEATURE_KEYS.ONLINE_MEMBERS]: 'Membres en ligne',
    [FEATURE_KEYS.MEMBERS]: 'Membres',
    [FEATURE_KEYS.PENDING]: "En attente d'autorisation",
  },
  de: {
    [FEATURE_KEYS.ONLINE]: 'Online',
    [FEATURE_KEYS.AUTHORIZED]: 'Autorisiert',
    [FEATURE_KEYS.LAST_SEEN]: 'Zuletzt gesehen',
    [FEATURE_KEYS.IP]: 'Verwaltete IP-Adresse',
    [FEATURE_KEYS.VERSION]: 'ZeroTier-Version',
    [FEATURE_KEYS.ONLINE_MEMBERS]: 'Mitglieder online',
    [FEATURE_KEYS.MEMBERS]: 'Mitglieder',
    [FEATURE_KEYS.PENDING]: 'Warten auf Autorisierung',
  },
  es: {
    [FEATURE_KEYS.ONLINE]: 'En línea',
    [FEATURE_KEYS.AUTHORIZED]: 'Autorizado',
    [FEATURE_KEYS.LAST_SEEN]: 'Visto por última vez',
    [FEATURE_KEYS.IP]: 'Dirección IP gestionada',
    [FEATURE_KEYS.VERSION]: 'Versión de ZeroTier',
    [FEATURE_KEYS.ONLINE_MEMBERS]: 'Miembros en línea',
    [FEATURE_KEYS.MEMBERS]: 'Miembros',
    [FEATURE_KEYS.PENDING]: 'Pendientes de autorización',
  },
};

// Shown when a member has no managed address (a text state is never empty).
export const NO_IP = { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' };

// Display bound of the counters (the core never applies it on write).
const MAX_MEMBERS = 100_000;

const sensor = (category, type, extra = {}) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

const textFeature = () =>
  sensor(DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    max: 0,
  });

/** The local date and time, in the configured language (TZ of Gladys). */
export function formatDate(time, language) {
  if (time === null || time === undefined) {
    return null;
  }
  return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(time),
  );
}

// Order = display order in Gladys.
const MEMBER_FEATURES = [
  {
    key: FEATURE_KEYS.ONLINE,
    definition: () =>
      sensor(DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.BINARY),
    value: ({ member }) => (member.online ? 1 : 0),
  },
  {
    key: FEATURE_KEYS.AUTHORIZED,
    definition: ({ allowAuthorize }) => ({
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      read_only: !allowAuthorize,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    }),
    value: ({ member }) => (member.authorized ? 1 : 0),
  },
  {
    key: FEATURE_KEYS.LAST_SEEN,
    definition: textFeature,
    // `shownSeen`: frozen while online (src/hub.js).
    value: ({ member, language }) => formatDate(member.shownSeen ?? member.lastSeen, language),
  },
  {
    key: FEATURE_KEYS.IP,
    definition: textFeature,
    value: ({ member, language }) =>
      member.ips.length > 0 ? member.ips.join(', ') : (NO_IP[language] ?? NO_IP.en),
  },
  {
    key: FEATURE_KEYS.VERSION,
    definition: textFeature,
    value: ({ member }) => member.version,
  },
];

export const countOnline = (members) => members.filter((member) => member.online).length;
export const countPending = (members) => members.filter((member) => !member.authorized).length;

const NETWORK_FEATURES = [
  { key: FEATURE_KEYS.ONLINE_MEMBERS, value: ({ members }) => countOnline(members) },
  { key: FEATURE_KEYS.MEMBERS, value: ({ members }) => members.length },
  { key: FEATURE_KEYS.PENDING, value: ({ members }) => countPending(members) },
];

export const networkIds = (gladys, networkId) => gladys.externalIds(NETWORK_TYPE, networkId);
export const memberIds = (gladys, networkId, nodeId) =>
  gladys.externalIds(MEMBER_TYPE, `${networkId}-${nodeId}`);

/** { networkId, nodeId } of a member device external id, null for any other. */
export function memberOf(gladys, externalId) {
  const prefix = gladys.externalIds(MEMBER_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const match = externalId.slice(prefix.length).match(/^([0-9a-f]{16})-([0-9a-f]{10})$/);
  return match ? { networkId: match[1], nodeId: match[2] } : null;
}

export const networkName = (network) => `ZeroTier ${network.name}`;
export const memberName = (member) => `${member.name} (ZeroTier)`;

/** Discovery payload of a network device. */
export function buildNetworkDevice(gladys, network, { language = 'en' } = {}) {
  const ids = networkIds(gladys, network.id);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: networkName(network),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: NETWORK_PARAM, value: network.id }],
    features: NETWORK_FEATURES.map(({ key }) => ({
      ...sensor(DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER, {
        max: MAX_MEMBERS,
      }),
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/** Discovery payload of a member device. */
export function buildMemberDevice(
  gladys,
  network,
  member,
  { language = 'en', allowAuthorize = false } = {},
) {
  const ids = memberIds(gladys, network.id, member.nodeId);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: memberName(member),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: NETWORK_PARAM, value: network.id },
      { name: NODE_PARAM, value: member.nodeId },
    ],
    features: MEMBER_FEATURES.map(({ key, definition }) => ({
      ...definition({ allowAuthorize }),
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every feature of a member (null: nothing to publish).
 * @returns {Array<{ externalId: string, value: number|string|null }>}
 */
export function memberValues(gladys, network, member, { language = 'en' } = {}) {
  const ids = memberIds(gladys, network.id, member.nodeId);
  return MEMBER_FEATURES.map(({ key, value }) => ({
    externalId: ids.feature(key),
    value: value({ member, language }),
  }));
}

/** The value of every feature of a network. */
export function networkValues(gladys, network) {
  const ids = networkIds(gladys, network.id);
  return NETWORK_FEATURES.map(({ key, value }) => ({
    externalId: ids.feature(key),
    value: value({ members: network.members }),
  }));
}
