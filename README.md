# ZeroTier for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for
[ZeroTier](https://www.zerotier.com): who is online on your ZeroTier networks,
and who is waiting to be let in, right in Gladys. It reads **ZeroTier
Central** (the cloud) or a **self-hosted controller**.

## Features

- **One device per member**: online, authorized (a switch, read only unless
  allowed in the configuration), last seen, managed IP address, ZeroTier
  version.
- **One device per network**: online members, members, members awaiting
  authorization.
- **Dashboard widget** _ZeroTier members_: who awaits authorization, who is
  online, when the others were last seen; every network or one.
- **Scene triggers**: _ZeroTier member online_, _ZeroTier member offline_,
  _New member awaiting authorization_, for one member, one network or any.
- **Two modes, one model**: ZeroTier Central (API token) or a self-hosted
  controller (its local API on port 9993 and `authtoken.secret`).
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- ZeroTier Central: an API token of the account that owns the networks.
- Self-hosted controller: the controller node reachable from Gladys on port
  9993, the content of its `authtoken.secret`, and the address of Gladys
  allowed by `allowManagementFrom` in its `local.conf`.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-zerotier`.
2. In the **Configuration** screen, choose the controller (Central or
   self-hosted), paste the token (and the controller address), then **Test
   the connection**.
3. In the **Discovery** tab, add the networks and members to follow.

The full documentation, shown by Gladys, is in [`docs/`](docs/en.md)
([fr](docs/fr.md), [de](docs/de.md), [es](docs/es.md)).

## How it works

- **Central** (`https://api.zerotier.com/api/v1`, `Authorization: token …`):
  `GET /network`, then `GET /network/{id}/member` for each network followed.
  The current API has no "online" flag: a member is online when its
  `lastSeen` (its last check-in, about every minute) is less than 5 minutes
  old, on the clock of Central. Members deleted in Central (`hidden`) are
  skipped.
- **Self-hosted controller** (`X-ZT1-Auth`): `GET /status`, then
  `/unstable/controller/network` and `/unstable/controller/network/{id}/member`
  (ZeroTier 1.12 and later; one request per member on older nodes), and
  `GET /peer`: the controller stores no "last seen", so a member is online
  when the controller heard from it less than 3 minutes ago (a direct path's
  `lastReceive`). A relayed member (no direct path) counts as online while the
  node lists it.
- The API is read every 30 s to 5 min (1 min by default), on the integration's
  own timer: the devices are published with `should_poll: false`. Nothing is
  written to `/data`.
- Authorizing or revoking a member (`POST …/member/{id}`) only happens when the
  configuration allows it.

## Checked on a real controller

Run in Docker, on a dedicated network, with no port published: a ZeroTier
**1.14.2** controller (`zerotier/zerotier`) that creates a private network, a
second node that joins it, is authorized, then stopped, and a third node that
asks to join. The integration image ran under the constraints of the Gladys
sandbox (read-only root, no capability, 256 MB): the reading of the
controller (both the `/unstable` listing and the older per-member path), a
refused token, a wrong port, an unknown network, authorizing and revoking a
member, the widget, a member going offline once stopped and a new member
awaiting authorization, with their scene events. The answers are recorded,
anonymized, in `test/fixtures/controller/`.

**Developed without a ZeroTier Central account: feedback welcome.** The
Central mode follows the official API specification
([`spec.json`](https://github.com/zerotier/go-ztcentral/blob/main/spec.json) of
`go-ztcentral`); its fixtures (`test/fixtures/central/`) are built from the
examples of that specification. A real Gladys instance was not used either
(the tests use the fake Gladys of the SDK).

## Limitations

- One controller (or one Central account) per installation.
- A member is seen offline up to 5 minutes (Central) or 3 minutes (self-hosted
  controller) after it stops, plus one reading; up to about 9 minutes for a
  relayed member of a self-hosted controller.
- The last seen date of a self-hosted controller is kept in memory: unknown
  again after a restart of the integration, until the member is seen.
- No creation of networks, no renaming or deletion of members: that stays in
  Central or on the controller.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and in-memory ZeroTier APIs (`test/helpers/fakeZeroTier.js`) built from the
fixtures. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [ZeroTier](https://github.com/zerotier/ZeroTierOne) by ZeroTier, Inc.: this
  integration only talks to its HTTP APIs; no code was copied.
- The Central API model comes from the specification of
  [go-ztcentral](https://github.com/zerotier/go-ztcentral) (BSD-3-Clause).
- The architecture and the conformity tests follow
  [gladys-wg-easy](https://github.com/guim31/gladys-wg-easy) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by ZeroTier, Inc.
"ZeroTier" is a trademark of ZeroTier, Inc.

## License

Apache-2.0
