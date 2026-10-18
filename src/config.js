// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Two modes, one model: ZeroTier Central (cloud, an API token) or a
// self-hosted controller (the local API of a ZeroTier node and its
// authtoken.secret).
// -----------------------------------------------------------------------------

import { MODES } from './zerotier/client.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds. A member checks
// in with its controller about every minute: reading more often than every
// 30 seconds would not tell more, and Central counts every request.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  mode: MODES.CENTRAL,
  token: '',
  url: '',
  networks: '',
  poll_interval: '60',
  allow_authorize: false,
  language: 'fr',
};

export const DEFAULT_PORT = 9993;

/**
 * Parse the address of a self-hosted controller: a bare host or IP
 * (`192.0.2.10`, port 9993 then), `host:port`, or a URL. HTTP by default,
 * the path dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host:port`, null when unusable
 */
export function parseControllerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  // A bare http address means the node itself, on 9993; https:// without a
  // port is a reverse proxy, on 443.
  const explicitPort = /^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]*\]|[^/:?#]*):\d+/i.test(withScheme);
  if (!explicitPort && url.protocol === 'http:') {
    url.port = String(DEFAULT_PORT);
  }
  return url.origin;
}

/**
 * The network ids typed by the user: 16 hexadecimal characters each,
 * separated by commas, spaces or new lines. Anything else is reported.
 * @returns {{ ids: string[], invalid: string[] }}
 */
export function parseNetworks(raw) {
  const words = typeof raw === 'string' ? raw.split(/[\s,;]+/).filter(Boolean) : [];
  const ids = [];
  const invalid = [];
  for (const word of words) {
    const id = word.toLowerCase();
    if (/^[0-9a-f]{16}$/.test(id)) {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    } else {
      invalid.push(word);
    }
  }
  return { ids, invalid };
}

const isTrue = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const mode = Object.values(MODES).includes(source.mode) ? source.mode : DEFAULT_CONFIG.mode;
  const typed = typeof source.url === 'string' ? source.url.trim() : '';
  const url = parseControllerUrl(typed);
  const interval = POLL_INTERVALS.includes(String(source.poll_interval ?? ''))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  const networks = parseNetworks(source.networks);
  return {
    mode,
    // A token pasted with a new line or spaces around it.
    token: typeof source.token === 'string' ? source.token.trim() : '',
    url,
    invalidUrl: typed !== '' && url === null,
    networks: networks.ids,
    invalidNetworks: networks.invalid,
    pollIntervalMs: Number(interval) * 1000,
    allowAuthorize: isTrue(source.allow_authorize),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
