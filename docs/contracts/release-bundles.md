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

Server-web tags use `server-web-v{version}`. Future native clients must use a distinct
namespace such as `kodi-client-v{version}` or `android-tv-client-v{version}`.

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

## Compatibility impact

This contract replaces the old generic `party-game-{version}-...` archive names,
`v{version}` tag namespace, and `package:portable` / `package:public` commands. Release
automation and consumers must use the server-web namespaced equivalents. HTTP and
WebSocket wire contracts are unchanged.
