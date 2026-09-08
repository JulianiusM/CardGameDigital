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

Each server-web version produces both editions from the same source SHA and release
version. Server and browser code are built together in each job:

- `portable` supplies local/LAN defaults, an application executable, all runtime
  dependencies, and a writable SQLite data directory. Extract the entire archive into
  a writable directory and run `party-game.exe` on Windows or `./party-game` on Linux
  and macOS. Open `http://localhost:3000/play/`. No installation, network download,
  Node/npm, database service, or configuration is needed. A browser is the game client.
- `public` supplies only the managed application distributable. Start it with the
  infrastructure's Node 24 process: `node /absolute/path/to/main.cjs`. The operator
  provides Node 24.7 or newer within 24.x, the locked JavaScript production packages,
  MariaDB/MySQL, HTTPS proxy, stable secrets, and mail. No native npm binding or compiler
  is required; Node provides Argon2id and catalog-validation SQLite internally.
  The artifact never includes Node, `node_modules`, native bindings, or service/container
  infrastructure. Provision dependencies before deployment using its `package.json` and
  `package-lock.json`. Preserve the hidden `.npmrc`: plain `npm ci` in the extracted
  directory omits development and optional dependencies and disables install scripts.
  Provisioning elsewhere uses `npm ci --omit=dev --omit=optional --ignore-scripts`, with
  an ancestor `node_modules` directory or `NODE_PATH` exposing them to Node.
  Application startup does not run npm or install anything.

The portable matrix builds on each target rather than cross-copying native modules:

| Runtime platform | Architecture |
| ---------------- | ------------ |
| Linux            | x64, arm64   |
| Windows          | x64, arm64   |
| macOS            | x64, arm64   |

Portable directory and archive basenames are:

```text
party-game-server-web-{version}-portable-{node-platform}-{node-architecture}
```

The public directory/archive basename is `party-game-server-web-{version}-public`.
It is built once and used on every supported host. All seven archives use `.tar.gz`.

Server-web tags use `server-web-v{version}`. The Kodi client uses
`kodi-client-v{version}`; a future Android-family client uses its own
`android-tv-client-v{version}` namespace.

## Application archive contents

Every server-web edition contains:

- the compiled server and the complete Vite web output;
- an edition entrypoint and non-secret defaults in `config/settings.csv`;
- the exact validated Card catalog and bundled help/media assets;
- protocol-v4 JSON schemas and manifest;
- `LICENSE.md`, lockfile, CycloneDX SBOM, and `release-manifest.json`.

Portable archives additionally contain the platform-native production graph and a Node
single executable application embedding the startup bootstrap. The executable loads the
adjacent application and dependencies without an installed runtime or shell wrapper.
`NODE-LICENSE.txt` carries the embedded runtime's notices.
macOS executables are ad-hoc signed after injection. OS download trust prompts still
follow the host's policy; release automation does not claim publisher notarization.

Public archives contain `main.cjs`, `.npmrc`, and deployment documentation. They contain no runtime,
modules, native binaries, or initial data directory. The operator owns process supervision,
dependencies, writable service state, and infrastructure upgrades. The public manifest and derived
lockfile exclude the local `better-sqlite3` driver and build dependencies. Retained
packages must match the source lock exactly. Public SBOMs describe that public graph;
source/development and portable packages retain the required SQLite driver.

Both entrypoints load edition defaults before starting the shared server. Resolution is
built-in defaults → edition defaults → operator CSV (`SETTINGS_FILE`, or `settings.csv`)
→ environment. Missing edition defaults abort startup. Custom CSV files do not discard
the edition defaults. Portable data paths resolve beside the executable even when launched
from another working directory; an explicit relative `SETTINGS_FILE` still resolves from
the caller's original directory. Public startup preserves the service working directory,
which should be persistent, writable, and outside the release. Assets always resolve from
the application directory. Keep portable `data/` when replacing application files.

Portable defaults select local, no accounts, SQLite, `data/game.sqlite`, dual-stack
`::`:3000, and local discovery/display bootstrap. Public defaults select public, enforced
security, accounts, MariaDB, `127.0.0.1`:3000 behind a reverse proxy, and disabled local
discovery/display bootstrap. Set `HTTP_BIND` for a remote proxy. Public startup refuses
missing required service configuration; deployment-specific hosts, credentials, secrets,
and URLs are never invented or bundled. See [infrastructure](infrastructure.md).

## Release manifest v2

`release-manifest.json` uses format `party-game-release/v2` and records:

- `releaseUnit: "server-web"`;
- one `version` copied to both `components.server` and `components.web`;
- edition, entrypoint, and target (public uses `platform: "any"`, `architecture: "any"`);
- immutable `sourceRevision` (the 40-character Git SHA);
- protocol version;
- Node name/version and whether it is bundled;
- `productionDependenciesBundled` (true only for portable);
- `externalSoftwareDependencies` (empty for portable; `node` and
  `production-node-packages` for public). Public Node version is the requirement `>=24.7.0 <25.0.0`;
  portable records the exact embedded version.

Packaging and verification reject component/version/target/protocol mismatches, missing
portable dependencies, and infrastructure accidentally included in public output. Smoke
tests copy the archive contents outside the checkout into paths containing spaces, clear
PATH and inherited application settings, launch the actual entrypoint from another working
directory, wait for migrations/catalog readiness, and fetch the browser and its JavaScript.
Portable must create its SQLite data without any deployment configuration. Public must
reject unconfigured enforced startup; its isolated asset/startup smoke explicitly uses
the development override with accounts and MariaDB. It installs the release's locked
dependencies outside the checkout through plain `npm ci`, rejects native modules, checks
password hashing, then exercises migrations, catalog startup, assets, and anonymous play.
It requires a disposable `TEST_DB_*` profile (or `tests/.env.test.local`) and resets that
exact test schema. CI and the public release job provision MariaDB for this check.
Separate public-account suites cover enforced production persistence/authentication;
the smoke does not certify a real managed deployment.

The workflow pins validation, reusable CI, packaging, and publication to the dispatch SHA.
CI and packages apply the requested version without creating a new commit. Every manifest
must match that SHA/version, and publication verifies all six portable targets plus the
single public archive, rejects duplicates, then tags the tested source directly. The branch
is never advanced by release automation. Rebuilding a tag uses the version from the release
manifest (apply it with `npm version --no-git-tag-version` and `RELEASE_VERSION`), which
can differ from the source package's development version.
Conflicting releases are serialized. Formatting and desktop/phone visual tests are CI gates.

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

Public installations now require Node `>=24.7.0 <25.0.0` and omit optional dependencies.
Upload hidden files so `.npmrc` reaches managed hosting; alternatively pass the documented
install flags explicitly. Existing Argon2id v19 passwords created by this application's
19 MiB/two-pass/one-lane profile remain valid without a reset or database migration.
Local SQLite persistence still requires the `better-sqlite3` package from the source or portable graph. HTTP,
WebSocket, database schema, and manifest format v2 remain unchanged.

Manifest v2 and the public platform-independent archive replace the former v1 contract
that embedded infrastructure in both editions. Public deployment automation must provide
Node/dependencies and invoke `main.cjs`; portable users start `party-game[.exe]` instead of
`start.cmd`/`start.sh`. Consumers expecting twelve platform/edition archives must accept
six portable archives and one public archive. HTTP and WebSocket contracts are unchanged.

This contract replaces the old generic `party-game-{version}-...` archive names,
`v{version}` tag namespace, and `package:portable` / `package:public` commands. Release
automation and consumers must use the server-web namespaced equivalents. HTTP and
WebSocket wire contracts are unchanged.

Adding the concrete Kodi artifact is additive to that release-unit contract. The Kodi
version is independent and compatibility is negotiated through HTTP API v1,
WebSocket protocol v4, and advertised server capabilities. The additive native-device
authorization fields in server information default to disabled/null, so existing
clients and deployments retain their prior behavior.

Restoring the empirically verified dual Kodi entry changes only native add-on launch and
packaging behavior; it does not change HTTP or WebSocket wire semantics. Corrective
Phase 2 separately advanced WebSocket to v3 for mandatory late-join enrollment. Phase 4
advances it to v4 for the shared 4 MiB and 1,000-participant receive guarantee. Current
server-web and Kodi 0.4.0 packages advertise v4 and must be upgraded together.
