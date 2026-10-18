# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

The integration keeps nothing in `/data`. The ZeroTier token (a Central API
token, or the `authtoken.secret` of a self-hosted controller) is stored by
Gladys in the integration configuration; it is sent only to ZeroTier Central
(`https://api.zerotier.com`) or to the controller address of the
configuration, and never written to the logs. With the configuration option
"Allow authorizing members", Gladys can authorize or revoke members of your
networks: it is off by default.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
ZeroTier, ZeroTier Central and the controllers the integration talks to.
