# Native Kodi client

`apps/kodi` is the native **Party Game TV** script add-on for Kodi 21/Omega and
newer. It is an independently versioned thin client for HTTP API v1 and WebSocket
protocol v2. The server remains authoritative for Card eligibility, localized Card
text, turns, votes, roles, revisions, persistence, and host selection.

## Player flows

The add-on is operable with D-pad, OK, Back, and Context Menu only. It provides:

- Couch Play for every server-supported game mode, including direct per-player Never
  Have I Ever ballots with identical collection flow for both reveal modes, recovery
  after ambiguous commands, and replay;
- the complete pending-game setup path: server, Group or quick round, mode, profile,
  players, locale/fallback order, settings, Session Card-policy defaults, ordered
  conditional rules, exact-Card exceptions, preview, and review;
- **Host a Room**, which creates a `DISPLAY_WAITING_FOR_HOST` Room with an idempotency
  key, persists recovery data before connecting, shows the safe join QR/code, and waits
  for the first authenticated player phone to become Host;
- **Display a Room**, which joins an existing code strictly as `DISPLAY`;
- hosted lobby, active-stage, Host reconnect/replacement, Room closure, leave, and
  restart-recovery presentations without exposing Host or private-player actions;
- bounded DNS-SD/mDNS discovery plus a direct same-machine default-port probe,
  saved-server probing and deletion, manual local/public endpoints, stable-server-ID
  deduplication, readiness polling, and diagnostics;
- built-in localized Help before server selection plus server-backed Help with a
  persistent topic navigator and bounded document paging;
- bounded four-Card pages with external pagination and command bars, player/member
  submenus, complete lobby settings and join information, fixed auto-paged rosters,
  and an active Card stage matching the approved web information hierarchy. The
  automatic-paging preference is a minimum dwell: a page with an overflowing player
  or result name remains until its longest visible marquee has completed;
- English, German, Kodi/system language selection, display name, and
  automatic public-roster paging;
- capability-gated OAuth device linking, token refresh/rotation, revocation, and
  unlinking for servers that explicitly publish the native authorization contract.

Kodi's native **Add-on information → Settings** dialog exposes the preferred server
URL, discovery switch, display name, language, and automatic-paging
preferences. The preferred URL is validated automatically at launch,
and disabling discovery prevents multicast browsing while preserving manual entry.
The same preferences remain available in the television UI and stay synchronized with
Kodi's add-on settings.

The current local server explicitly advertises native device authorization as
unavailable. The add-on therefore omits the irrelevant link action and explains that
the local deployment already uses its shared DataSpace. It does not guess endpoint
paths or scopes.

## Runtime architecture

`addon.xml` exposes the empirically verified Kodi/Omega dual entry. Its first extension
is an `xbmc.python.pluginsource` entry for `game.py` that provides `game`; native
selection under **Add-ons → Game add-ons** invokes that entry. `game.py` completes the
plugin directory transaction before opening the native window, preventing RetroPlayer
from treating the add-on as a ROM. A second `xbmc.python.script` entry exposes
`addon.py` as `executable`. The D-pad QA driver supplies an explicit private plugin
parameter to `Addons.ExecuteAddon`; fixture parameters use the same route. Kodi's
Home-screen **Games** item remains the ROM/source library, not this add-on's launch
surface.

`addon.py` composes one `WindowXMLDialog` shell, an immutable application state, a pure
reducer, effect workers, and a GUI-thread event queue. HTTP, DNS-SD, WebSocket,
validation, persistence, QR generation, and token polling do not run on the GUI thread.
Async results carry operation and server identity so late responses cannot mutate a
newer route or selected server.

The runtime is syntax-checked against Python 3.8 because some Kodi 21 distributions
still embed that interpreter. Confirmed Exit to Kodi transitions the application to
`STOPPING`, preserves recoverable active-game state, and returns to Kodi's Home window.
Shutdown bounds worker joins below Kodi's five-second script deadline; blocked network
work can only remain on daemon workers and cannot hold Kodi open.

Shared TypeScript schemas, enums, fixtures, Golden Mischief token data, Card-family
mappings, uniquely named raster media, and the fallback WindowXML are generated into
`apps/kodi/resources`. The WindowXML comes from the tokenized source in
`tooling/kodi/templates`, so it stays self-contained without copying palette ownership or
depending on the active skin's includes and textures. Kodi does not contain a Card
catalog or a second game engine.

Stable browser/native product terms are authored in
`packages/localization/clientVocabulary.ts`. Kodi-only string names, numeric IDs, copy,
and native locale/settings definitions are authored in
`packages/localization/kodiCatalog.json`. Generation produces `strings.py`, both PO
files, `settings.xml`, and `native_settings_metadata.py`, and derives PO version headers
from `addon.xml`.

Non-secret preferences, saved origins, and a minimal recovery envelope use versioned,
atomic profile files. Corrupt files are quarantined. Participant and account tokens use
the separate secret store, are scoped to the exact stable server ID and normalized
origin, and never appear in QR codes, discovery packets, diagnostics, fixtures, or
informational logs.

## Discovery and transport

Local discovery browses `_partycard._tcp.local.` and treats every packet and TXT value
as untrusted. Candidates pass bounded DNS parsing, address classification, readiness,
`/api/v1/server-info` schema validation, compatible protocol checks, and stable identity
deduplication before selection. DNS-SD provides convenience, not trust; manual entry is
always available when multicast or cross-subnet discovery fails.

Before multicast browsing, the client also probes loopback and bounded local interface
addresses on the release-default port `3000`. This makes the common “Kodi and server on
the same machine” case independent of operating-system multicast loopback behavior.

Plain HTTP/WebSocket is accepted only for loopback, private, link-local, or `.local`
destinations that validate as a local deployment. Public/global servers require
HTTPS/WSS with certificate verification and TLS 1.2 or newer, including on Python 3.8.
Redirects are rejected, response and WebSocket message sizes are bounded,
and endpoint metadata must be same-origin relative paths. The client requests a fresh
snapshot after every WebSocket hello and resynchronizes after stale or ambiguous
commands.

An `ENDED` Session snapshot is not a closed Room. Kodi keeps the display credential and
socket attached, presents the completed-game summary as a waiting Room surface, and
returns to the lobby when the Host resets the Session for another game. Only the
authoritative Room-close transport outcome clears recovery and returns to the main
menu; the two lifecycle outcomes never share terminal actions.

## Build, test, and package

From the repository root:

```bash
npm run kodi:generate       # regenerate schemas, fixtures, tokens, strings, and media
npm run kodi:check          # drift, XML/static/privacy checks, and CPython unit tests
npm run kodi:package        # deterministic install ZIP plus release metadata
npm run kodi:package:verify -- artifacts/script.partycard.tv-0.3.4.zip
```

The package command writes these independent `kodi-client` release artifacts:

```text
artifacts/script.partycard.tv-{version}.zip
artifacts/script.partycard.tv-{version}.zip.sha256
artifacts/script.partycard.tv-{version}.cdx.json
artifacts/script.partycard.tv-{version}.provenance.json
```

The ZIP has one `script.partycard.tv/` root, normalized file order/timestamps/modes,
runtime files only, and no tests, caches, settings, registry, or credentials. The
`kodi-client-v{version}` workflow verifies reproducibility before it can publish.

For development, copy or link `apps/kodi` into Kodi's add-ons directory under the
exact name `script.partycard.tv`, then open **Add-ons → Game add-ons → Party Game TV**.
For a release install, use Kodi's **Install from zip file** action and select the
generated ZIP. The server must already be running and reachable; the add-on never
embeds or starts a server.

## Release verification boundary

The repository gates Python behavior, generated-contract parity, XML shape,
localization parity, privacy patterns, deterministic packaging, and the server's real
HTTP/WebSocket lifecycle. A release candidate must additionally be installed and run
on clean Kodi environments across the declared version/platform/skin/remote/network
matrix, including an offline LAN and representative low-powered hardware. Those
platform checks require Kodi binaries and physical or virtual target devices and must
be recorded by release QA; an automated repository run is not evidence that they
passed.
