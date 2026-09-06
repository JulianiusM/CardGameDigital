# Party Game TV for Kodi

This directory contains the native Kodi 21/Omega script add-on. It is a thin client for
the server-authoritative HTTP API v1 and WebSocket protocol v4; it does not bundle Cards
or gameplay rules.

## Developer checks

From the repository root:

```bash
npm run kodi:generate
npm run kodi:check
npm run kodi:package
```

`kodi:package` writes an installable ZIP, SHA-256 checksum, CycloneDX SBOM, and source
provenance manifest to `artifacts/`. The ZIP contains only the add-on, never tests,
profile data, credentials, or build caches.

For an unpacked development install, link or copy `apps/kodi` to Kodi's add-ons
directory as `script.partycard.tv`. Open **Add-ons → Game add-ons → Party Game TV**.
Kodi's Home-screen **Games** item is its ROM/source library, not the launch surface for
native Game add-ons. Manual server entry remains available when multicast discovery is
blocked.

Open **Party Game TV → Add-on information → Settings** to configure a preferred
server URL, local discovery, display name, language, and automatic paging.
Settings are read on every launch;
preferences changed inside the client are written back to Kodi's add-on settings.
The chosen paging interval is a minimum: Room rosters and named results wait longer
when necessary for the longest visible player-name marquee to finish.

The server browser probes the default same-machine endpoint directly before listening
for DNS-SD, so a server on `localhost:3000` remains discoverable on platforms that do
not loop multicast packets back to Kodi. Selecting a server opens its details; saved
servers can be removed there.

Setup uses bounded Card collections with explicit command bars: choosing an option never
looks the same as moving focus, player and Group-member edits open a submenu, and no
collection combines scrolling with pagination. Built-in Help remains available before a
server is selected. Local deployments omit device linking because their shared DataSpace
is already active.

During play, the TV follows the web stage hierarchy: fixed status and roster regions, an
explicit current player with adaptive contrast, and a centered Card containing its type,
localized classification, complete dynamically fitted text, Card intensity, and game
intensity. Card-family backgrounds are generated from the authoritative Golden Mischief
VID palette.

## Deterministic visual fixtures

The visual fixture launcher is development-only. With Kodi stopped, make a fresh
unpacked copy of `apps/kodi` at Kodi's exact add-on path
`addons/script.partycard.tv`. Then replace only that copy's `game.py` with
`tools/visual_fixture_launcher.py`; do not replace the repository's `game.py`. Kodi
passes the driver's private parameters through the same Game plugin entry used by
native add-on selection.

For example, from the repository root in PowerShell, after choosing an empty target:

```powershell
$sourceClient = (Resolve-Path "apps/kodi").Path
$developmentAddon = Join-Path $env:APPDATA "Kodi\addons\script.partycard.tv"
if (Test-Path -LiteralPath $developmentAddon) {
    throw "Choose an empty development add-on target."
}
Copy-Item -LiteralPath $sourceClient -Destination $developmentAddon -Recurse
Copy-Item -LiteralPath "$developmentAddon\tools\visual_fixture_launcher.py" `
    -Destination "$developmentAddon\game.py" -Force
```

Start Kodi, then use only the bounded driver commands. A normal launch still runs the
production client; `LaunchFixture` selects a deterministic fixture explicitly. The
driver's default 60-second launch deadline accommodates a clean Kodi/Omega cold start:

```powershell
powershell -File apps/kodi/tools/kodi_visual_driver.ps1 LaunchAddon `
    -OutputDirectory artifacts/kodi-dpad-verification
powershell -File apps/kodi/tools/kodi_visual_driver.ps1 LaunchFixture `
    -Scenario named-first -Locale de-DE `
    -OutputDirectory artifacts/kodi-dpad-verification
```

`-Locale` is restricted to `en-GB` and `de-DE`. It is carried only in the private
fixture query, appears as `details.locale` in `actions.jsonl`, and is supplied to the
fixture's in-memory locale provider. It never changes Kodi's language or the user's
saved add-on settings. Every fixture has an explicit German projection, including the
10,000-character Card and 40-character unbreakable player-name cases.

The German D-pad audit covers these fixtures:

| Fixtures                                                                                                               | Required assertions                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home-recovery`, `help-long`                                                                                           | Help can be entered from and returned to Home; topic, Back, and page controls follow their visible hierarchy; all Help sentences and destructive recovery copy remain complete.                                                                                                                                                          |
| `diagnostics-long`                                                                                                     | Diagnostic typography is consistent; the UUID stays on one line; long origins remain within their detail band.                                                                                                                                                                                                                           |
| `setup-profile-unselected`, `setup-intensity`, `exact-search`                                                          | No profile starts selected; German profile and range copy is complete; Down visits the second card row before pagination; exact-search always reports the same four-page total.                                                                                                                                                          |
| `setup-card-policy`, `setup-card-rule-values`                                                                          | German Card-policy badges remain complete; every multi-select facet exposes separate All/None shortcuts outside its value grid.                                                                                                                                                                                                          |
| `couch-voters-9`, `couch-voter-page-complete`, `couch-voters-1000-final`, `private-choice`, `private-choice-anonymous` | Four voters and Skip form one navigation row; a completed voter page focuses Next voters; the fixed final-page status says `Abstimmungsseite 250 von 250`; selecting Skip simulates a fresh Card, returns to voter page 1, and focuses the first participant; both reveal modes open the same direct ballot with Yes—not Cancel—focused. |
| `named-first`, `named-middle`, `named-last`                                                                            | Named reveal begins at page 1, keeps five names per result column, scrolls exceptional names without force-breaking, and exposes only Continue.                                                                                                                                                                                          |
| `lobby-worst-*`, `lobby-worst-address-5`                                                                               | Eight fixed roster rows, the complete Room code, one complete URL, and German device-owner text are visible; exceptional names scroll inside fixed rows.                                                                                                                                                                                 |
| `room-game-worst-*`, `room-game-marquee-timing`                                                                        | Five fixed roster entries, complete Room code/status/Card text, aligned current-player band, and a dwell long enough for the longest visible marquee.                                                                                                                                                                                    |
| `room-ended-open`                                                                                                      | An ended but open Room remains attached with explanatory German copy and no terminal summary actions.                                                                                                                                                                                                                                    |

Use only the driver's physical-key commands for the audit. `Focus` records the focused
control and semantic action, `Capture` records the same snapshot beside the PNG, and
`Back` closes a fixture promptly. In particular, do not use Kodi's mouse pointer or
arbitrary JSON-RPC input during D-pad verification.

Before deployment, the fixture data and launcher dispatch can be checked without Kodi:

```powershell
python -B apps/kodi/tools/visual_fixture.py --check
python -B -m unittest discover -s apps/kodi/tests `
    -p "test_visual_fixture_launcher.py"
```

After visual QA, remove the unpacked development copy and install the verified release
ZIP. The release packager excludes all of `tools/`, including both fixture entry points;
the package contains the production `game.py` Game plugin and `addon.py` script entry
points.

## Compatibility and trust

- Kodi 21/Omega or newer. Runtime source remains compatible with the Python 3.8
  interpreter used by some Kodi 21 platform builds.
- Local plaintext HTTP is accepted only for loopback, private, link-local, or `.local`
  destinations that identify themselves as a local deployment.
- Public/global servers require HTTPS/WSS.
- The TV always joins Rooms as `DISPLAY`; Room and participant credentials never enter
  the join URL or QR code.
- Account/device linking is shown only when the selected server advertises the optional
  native-device authorization capability and endpoints.
