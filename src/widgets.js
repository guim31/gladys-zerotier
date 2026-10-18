// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `members`.
//
// The use case: "who is on the ZeroTier network right now, and is someone
// waiting to be let in?" at a glance. Two tiles (online members, members)
// and one status list: the members awaiting authorization first (something
// to do), then the online ones, then the others with the time they were last
// seen. One optional setting: a network device, to show only that network.
// No button: authorizing a member is the device switch (off by default), not
// a tap on a wall tablet.
//
// Budget (8 components, 2 texts at most): 2 values and 1 status list, or a
// single text when there is nothing to show. The values are sent as values,
// not bound to device features, so the widget works before the devices are
// added to Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { networkIds } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { pick } from './texts.js';

// Rows of the status list (one more says how many are not shown).
export const MAX_ROWS = 9;

export const TEXT = {
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  members: { en: 'Members', fr: 'Membres', de: 'Mitglieder', es: 'Miembros' },
  pending: {
    en: 'Awaiting authorization',
    fr: "En attente d'autorisation",
    de: 'Wartet auf Autorisierung',
    es: 'Pendiente de autorización',
  },
  never: { en: 'Never seen', fr: 'Jamais vu', de: 'Nie gesehen', es: 'Nunca visto' },
  more: {
    en: 'Other members',
    fr: 'Autres membres',
    de: 'Weitere Mitglieder',
    es: 'Otros miembros',
  },
  empty: {
    en: 'No member in this ZeroTier network yet.',
    fr: 'Aucun membre dans ce réseau ZeroTier pour le moment.',
    de: 'Noch kein Mitglied in diesem ZeroTier-Netzwerk.',
    es: 'Todavía no hay ningún miembro en esta red ZeroTier.',
  },
  waiting: {
    en: 'Waiting for the first reading of ZeroTier…',
    fr: 'En attente de la première lecture de ZeroTier…',
    de: 'Warte auf die erste Abfrage von ZeroTier…',
    es: 'Esperando la primera lectura de ZeroTier…',
  },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language, ttl = 60) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: fit(pick(text, language), 300) }],
  };
}

/** "5 min ago", "2 h ago", "3 days ago", in the language of the dashboard. */
export function ago(time, now, language) {
  const minutes = Math.max(1, Math.round((now - time) / 60_000));
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'always', style: 'short' });
  if (minutes < 60) {
    return format.format(-minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return format.format(-hours, 'hour');
  }
  return format.format(-Math.round(hours / 24), 'day');
}

/** Order: awaiting authorization, online (by name), offline (latest seen first). */
function rank(member) {
  if (!member.authorized) {
    return 0;
  }
  return member.online ? 1 : 2;
}

export function sortMembers(members) {
  return [...members].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 2 ? (b.lastSeen ?? 0) - (a.lastSeen ?? 0) : 0) ||
      a.name.localeCompare(b.name),
  );
}

function row(member, now, language) {
  const label = fit(member.name, 40);
  if (!member.authorized) {
    return {
      label,
      icon: 'user-plus',
      value: fit(pick(TEXT.pending, language), 40),
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (member.online) {
    return {
      label,
      icon: 'wifi',
      value: pick(TEXT.online, language),
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  return {
    label,
    icon: 'wifi-off',
    value: fit(
      member.lastSeen === null ? pick(TEXT.never, language) : ago(member.lastSeen, now, language),
      40,
    ),
    color: WIDGET_COLORS.NEUTRAL,
  };
}

async function get(hub, { language = 'en', settings = {} } = {}) {
  if (!hub.config) {
    return message(TEXT.waiting, language);
  }
  const problem = hub.configProblem();
  if (problem) {
    return message(problem, language);
  }
  if (hub.error) {
    return message(hub.errorMessage(), language, 30);
  }
  if (!hub.read) {
    return message(TEXT.waiting, language);
  }
  const wanted = typeof settings.network_device === 'string' ? settings.network_device : '';
  const networks = wanted
    ? hub.networks.filter((network) => networkIds(hub.gladys, network.id).device === wanted)
    : hub.networks;
  const members = sortMembers(networks.flatMap((network) => network.members));
  if (members.length === 0) {
    return message(TEXT.empty, language);
  }
  const now = hub.now();
  const online = members.filter((member) => member.online).length;
  const shown = members.length > MAX_ROWS + 1 ? members.slice(0, MAX_ROWS) : members;
  const items = shown.map((member) => row(member, now, language));
  if (shown.length < members.length) {
    items.push({
      label: pick(TEXT.more, language),
      icon: 'more-horizontal',
      value: members.length - shown.length,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return {
    ttl_seconds: 30,
    components: [
      {
        type: 'value',
        value: online,
        label: pick(TEXT.online, language),
        icon: 'users',
        color: online > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
      },
      {
        type: 'value',
        value: members.length,
        label: pick(TEXT.members, language),
        icon: 'globe',
      },
      { type: 'status', items },
    ],
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
