# Release bundle contract

## Release units

`server-web` is one release unit. The authoritative server and the browser client are
always built, versioned, tested, archived, tagged, and published together. Neither
component has an independent release version or independently published artifact.

Native clients are different release units because they have platform-specific UI,
store, signing, and update lifecycles. The reserved release-unit names are
`kodi-client` and `android-tv-client`. A native-client release must use its own version,
manifest, workflow, tag namespace, and archive; it must not be placed inside a
`server-web` archive. Native clients remain thin protocol consumers and do not package
server rules or the Card catalog.

## Server-web editions and targets

Each server-web version produces both editions from the same build output:

- `portable` supplies local/LAN defaults and a writable SQLite data directory.
- `public` supplies enforced-public defaults. It still requires deployment services
  such as MariaDB, HTTPS proxying, secrets, authentication, and mail configuration, but
  it does not require Node, npm, build tools, or separately installed JavaScript/native
  packages.

The release matrix builds on each target rather than cross-copying native modules:

| Runtime platform | Architecture |
| ---------------- | ------------ |
| Linux            | x64, arm64   |
| Windows          | x64, arm64   |
| macOS            | x64, arm64   |

The directory and archive basename is:

```text
party-game-server-web-{version}-{edition}-{node-platform}-{node-architecture}
```

Server-web tags use `server-web-v{version}`. The Kodi client uses
`kodi-client-v{version}`; a future Android-family client uses its own
`android-tv-client-v{version}` namespace.

## Standalone archive contents

Every server-web edition contains:

- the compiled server and the complete Vite web output;
- the matching Node runtime and platform-native production dependency graph;
- a platform launcher and non-secret edition settings template;
- the exact validated Card catalog and bundled help/media assets;
- protocol-v2 JSON schemas and manifest;
- `LICENSE.md`, lockfile, CycloneDX SBOM, and `release-manifest.json`.

The launcher uses only files inside the extracted archive. Settings from the operator's
environment override the bundled non-secret template. Local runtime data and public
deployment databases must live outside versioned application files during upgrades.

## Release manifest v1

`release-manifest.json` uses format `party-game-release/v1` and records:

- `releaseUnit: "server-web"`;
- one `version` copied to both `components.server` and `components.web`;
- edition, Node platform, and architecture;
- protocol version;
- bundled Node name/version;
- `productionDependenciesBundled: true`;
- an empty `externalSoftwareDependencies` array.

Packaging and smoke validation reject a server/web version mismatch, a missing embedded
runtime, missing native dependencies, a platform mismatch, or disagreement with the
protocol manifest.

## Kodi client artifact

The implemented `kodi-client` release takes its version from
`apps/kodi/addon.xml` and produces:

```text
script.partycard.tv-{version}.zip
script.partycard.tv-{version}.zip.sha256
script.partycard.tv-{version}.cdx.json
script.partycard.tv-{version}.provenance.json
```

The ZIP contains exactly one `script.partycard.tv/` root and only runtime source,
language files, generated protocol/design data, skin XML/media, notices, and add-on
metadata. It excludes tests, developer tools, caches, `.pyc` files, profile data,
saved servers, and credentials. Paths, entry order, timestamps, and Unix mode bits are
normalized, and the release workflow packages twice and compares SHA-256 digests.

The manifest exposes exactly two production runtime extensions in a fixed order. The
first is `xbmc.python.pluginsource`, launches `game.py`, and provides `game`; the second
is `xbmc.python.script`, launches `addon.py`, and provides `executable`. Kodi lists the
first entry under **Add-ons → Game add-ons**. Native selection invokes `game.py`, which
finishes the plugin directory transaction before opening the shared native runtime.
Automation supplies an explicit private parameter through `Addons.ExecuteAddon` rather
than relying on its parameterless folder navigation. Kodi's Home-screen **Games** item
is the ROM/source library and is outside this launch contract.

The companion checksum covers the ZIP. The CycloneDX document inventories the Kodi
Python runtime contract and bundled QR implementation. Provenance records the ZIP
digest, protocol version, deterministic timestamp, source boundary, and the digest of
every packaged file. These files are published by the independent
`kodi-client-v{version}` workflow; they are never copied into a server-web edition.

Repository packaging validates structure and reproducibility. Installation and launch
of the resulting ZIP on the supported Kodi/platform/skin/remote matrix is a separate
release gate and cannot be inferred from CPython tests.
Package verification requires both production entry points and their exact manifest
order while rejecting any additional runtime extension or development fixture launcher
below `tools/`.

## Compatibility impact

This contract replaces the old generic `party-game-{version}-...` archive names,
`v{version}` tag namespace, and `package:portable` / `package:public` commands. Release
automation and consumers must use the server-web namespaced equivalents. HTTP and
WebSocket wire contracts are unchanged.

Adding the concrete Kodi artifact is additive to that release-unit contract. The Kodi
version is independent and compatibility is negotiated through HTTP API v1,
WebSocket protocol v2, and advertised server capabilities. The additive native-device
authorization fields in server information default to disabled/null, so existing
clients and deployments retain their prior behavior.

Restoring the empirically verified dual Kodi entry changes only native add-on launch and
packaging behavior. HTTP API v1 and WebSocket protocol v2 are unchanged.
