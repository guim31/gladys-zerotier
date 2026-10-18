// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, command
// errors. Four languages, the four of the Gladys interface; German says "du",
// Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './zerotier/client.js';

/** The text of `language`, English when missing. */
export const pick = (text, language) =>
  typeof text === 'string' ? text : (text?.[language] ?? text?.en ?? '');

/** Replace `{name}` placeholders in every language of a text. */
export function render(text, values) {
  return Object.fromEntries(
    Object.entries(text).map(([language, value]) => [
      language,
      value.replace(/\{(\w+)\}/g, (all, key) => (key in values ? String(values[key]) : all)),
    ]),
  );
}

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noToken: {
    en: 'Enter your ZeroTier API token in the configuration.',
    fr: 'Saisissez votre jeton d’API ZeroTier dans la configuration.',
    de: 'Gib dein ZeroTier-API-Token in der Konfiguration ein.',
    es: 'Introduzca su token de API de ZeroTier en la configuración.',
  },
  noUrl: {
    en: 'Enter the address of your controller in the configuration.',
    fr: "Saisissez l'adresse de votre contrôleur dans la configuration.",
    de: 'Gib die Adresse deines Controllers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su controlador en la configuración.',
  },
  invalidUrl: {
    en: 'Controller address not understood, e.g. 192.168.1.2:9993',
    fr: 'Adresse du contrôleur incomprise, ex. 192.168.1.2:9993',
    de: 'Adresse des Controllers nicht verstanden, z. B. 192.168.1.2:9993',
    es: 'Dirección del controlador no válida, p. ej. 192.168.1.2:9993',
  },
  invalidNetworks: {
    en: 'Network ids not understood (16 characters each): {ids}',
    fr: 'Identifiants de réseau incompris (16 caractères chacun) : {ids}',
    de: 'Netzwerk-IDs nicht verstanden (je 16 Zeichen): {ids}',
    es: 'Identificadores de red no válidos (16 caracteres cada uno): {ids}',
  },
};

// One short explanation per error kind (src/zerotier/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'ZeroTier does not answer (address, port, allowManagementFrom?)',
    fr: 'ZeroTier ne répond pas (adresse, port, allowManagementFrom ?)',
    de: 'ZeroTier antwortet nicht (Adresse, Port, allowManagementFrom?)',
    es: 'ZeroTier no responde (¿dirección, puerto, allowManagementFrom?)',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API token refused',
    fr: "jeton d'API refusé",
    de: 'API-Token abgelehnt',
    es: 'token de API rechazado',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'network not found: check its id and the token',
    fr: 'réseau introuvable : vérifiez son identifiant et le jeton',
    de: 'Netzwerk nicht gefunden: Prüfe seine ID und das Token',
    es: 'red no encontrada: compruebe su identificador y el token',
  },
  [ERROR_KINDS.NOT_CONTROLLER]: {
    en: 'this ZeroTier node is not a network controller',
    fr: "ce nœud ZeroTier n'est pas un contrôleur de réseau",
    de: 'dieser ZeroTier-Knoten ist kein Netzwerk-Controller',
    es: 'este nodo ZeroTier no es un controlador de red',
  },
  [ERROR_KINDS.RATE_LIMITED]: {
    en: 'too many requests to ZeroTier Central: read less often',
    fr: 'trop de requêtes vers ZeroTier Central : lisez moins souvent',
    de: 'zu viele Anfragen an ZeroTier Central: Lies seltener',
    es: 'demasiadas solicitudes a ZeroTier Central: lea con menos frecuencia',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer from ZeroTier',
    fr: 'réponse inattendue de ZeroTier',
    de: 'unerwartete Antwort von ZeroTier',
    es: 'respuesta inesperada de ZeroTier',
  },
};

export const COMMAND_TEXT = {
  readOnly: {
    en: 'Authorizing members from Gladys is off in the integration configuration.',
    fr: "L'autorisation des membres depuis Gladys est désactivée dans la configuration de l'intégration.",
    de: 'Das Autorisieren von Mitgliedern aus Gladys ist in der Konfiguration der Integration deaktiviert.',
    es: 'La autorización de miembros desde Gladys está desactivada en la configuración de la integración.',
  },
  unknownMember: {
    en: 'This member is no longer in the ZeroTier network.',
    fr: "Ce membre n'est plus dans le réseau ZeroTier.",
    de: 'Dieses Mitglied ist nicht mehr im ZeroTier-Netzwerk.',
    es: 'Este miembro ya no está en la red ZeroTier.',
  },
};

// "Test the connection": one line per network.
export const REPORT_TEXT = {
  en: {
    network: (name, members, online, pending) =>
      `${name}: ${members} member(s), ${online} online, ${pending} awaiting authorization`,
    none: 'Connected, but no network is visible with this token.',
    waiting: 'Waiting for the first reading…',
  },
  fr: {
    network: (name, members, online, pending) =>
      `${name} : ${members} membre(s), ${online} en ligne, ${pending} en attente d'autorisation`,
    none: 'Connecté, mais aucun réseau n’est visible avec ce jeton.',
    waiting: 'En attente de la première lecture…',
  },
  de: {
    network: (name, members, online, pending) =>
      `${name}: ${members} Mitglied(er), ${online} online, ${pending} warten auf Autorisierung`,
    none: 'Verbunden, aber mit diesem Token ist kein Netzwerk sichtbar.',
    waiting: 'Warte auf die erste Abfrage…',
  },
  es: {
    network: (name, members, online, pending) =>
      `${name}: ${members} miembro(s), ${online} en línea, ${pending} pendientes de autorización`,
    none: 'Conectado, pero no hay ninguna red visible con este token.',
    waiting: 'Esperando la primera lectura…',
  },
};
