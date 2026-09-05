# SonarQube security review decisions

Reviewed on 2026-09-05 against the `master` analysis at 14:47:19 +02:00.
These decisions apply to the listed occurrences, not to every use of their rules.
Reassess them if the transport policy, use of a hash, or packaged file changes.

## Protocol constants and non-network strings

The following findings are false positives for the identified uses:

| Rule               | File                                                  | Reason                                                                                                                                                                                                                                                                                                                                                                                         | Issue IDs                                                                                                              |
| ------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `python:S1313`     | `apps/kodi/resources/lib/discovery/address_policy.py` | The three IPv4 networks implement the private-address allowlist defined by [RFC 1918, section 3](https://www.rfc-editor.org/rfc/rfc1918.html#section-3). They classify candidate addresses; they are not destination servers.                                                                                                                                                                  | `9238a2c6-b2b7-487b-a42f-3e5b725cfee2`, `34ba808d-d56c-4646-b18e-af75ad485ffa`, `b03d84d5-b5aa-44ac-ad36-ce5d62f2fddf` |
| `python:S1313`     | `apps/kodi/resources/lib/discovery/mdns.py`           | The IPv4 and IPv6 multicast groups and port 5353 are specified by [RFC 6762, section 3](https://www.rfc-editor.org/rfc/rfc6762.html#section-3). Discovery candidates still pass the address policy and server probe.                                                                                                                                                                           | `f21065d6-99cd-44a4-8c78-46f103365b71`, `9d47c2a6-f2eb-4b5e-8357-c3f7b18eff1f`                                         |
| `python:S4790`     | `apps/kodi/resources/lib/transport/websocket.py`      | SHA-1 computes the required WebSocket accept proof from the public client nonce and protocol GUID. It does not hash passwords or authenticate the server. [RFC 6455, sections 4.1 and 10.8](https://www.rfc-editor.org/rfc/rfc6455.html#section-10.8) require this construction and explain why it does not depend on collision resistance. Public transport uses verified TLS.                | `71d9e5e4-3a0d-47d2-8344-093783aa2cfc`                                                                                 |
| `python:S5332`     | `apps/kodi/resources/lib/presentation.py`             | The string comparison only selects the HTTP/HTTPS label displayed for an already selected server. It performs no network I/O and does not authorize a transport.                                                                                                                                                                                                                               | `f76f7435-6593-40e5-a1e7-1b47b4f159cb`                                                                                 |
| `typescript:S5332` | `tooling/kodi/generateArtifacts.ts`                   | The HTTP address is written to a generated local-server test fixture. It contains no credentials and opens no connection. Local HTTP behavior is part of the fixture's purpose.                                                                                                                                                                                                                | `54d3e588-f36d-4b28-a45a-9868fcc9380b`                                                                                 |
| `typescript:S2612` | `tooling/release/package.ts`                          | Mode `0755` applies only to the bundled Node executable: the owner may write it; group and other users may only read and execute it. It grants neither shared write access nor setuid/setgid bits. The [release contract](../contracts/release-bundles.md#standalone-archive-contents) requires an executable runtime in the distributable archive. No secret or data file receives this mode. | `602a8df6-aa53-4a8a-96b4-9f570cd1c3cf`                                                                                 |

## Accepted local HTTP policy

The two `python:S5332` findings at the same local-probe origin construction in
`apps/kodi/resources/lib/discovery/mdns.py` are accepted:
`26d8b1d7-228d-4c63-8a5c-21e6f13a97cb` and
`9c1a415d-19eb-4465-b487-2d7026d1f84f`.

Cleartext HTTP does not provide confidentiality on the local network. Its use here
is the explicit local-deployment policy in the
[Kodi transport documentation](../KODI_CLIENT.md#discovery-and-transport) and
[infrastructure contract](../contracts/infrastructure.md#room-access-discovery).
The probes cover loopback and local interface addresses. Before use,
`validate_transport` checks resolved addresses and the probe validates the server's
deployment mode and contract. Public/global servers must use HTTPS; HTTPS and WSS
require TLS 1.2 or newer with certificate and hostname verification. Redirects are
rejected. This acceptance does not extend to public HTTP or to bypassing those checks.

## Verification

The Kodi address-policy, HTTP, DNS/mDNS, and WebSocket tests cover allowed local
destinations, rejected public cleartext transport, server probing, and the WebSocket
handshake. The release checks verify the add-on's manifest and packaged contents.
The source fixes associated with this analysis preserve HTTP/WebSocket wire contracts
and the existing LAN and release behavior. No global rule exclusions or `NOSONAR`
comments are added.
