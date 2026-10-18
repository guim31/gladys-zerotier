# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-18

### Added

- The members of your ZeroTier networks in Gladys, from ZeroTier Central (an
  API token) or from a self-hosted controller (its local API and
  `authtoken.secret`).
- One device per member: online, authorized (a switch, read only unless
  allowed in the configuration), last seen, managed IP address, ZeroTier
  version.
- One device per network: online members, members, members awaiting
  authorization.
- Scene triggers: a member comes online, goes offline, a new member awaits
  authorization, for one member, one network or any.
- A dashboard widget: who is online, who awaits authorization, when the others
  were last seen, for every network or one.
- A choice of networks to follow, a refresh interval from 30 seconds to 5
  minutes, a longer wait when Central refuses too many requests.
- Feature names, messages, widget and documentation in English, French, German
  and Spanish.

[Unreleased]: https://github.com/guim31/gladys-zerotier/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-zerotier/releases/tag/v1.0.0
