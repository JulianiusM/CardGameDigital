# HTTP API v1 contract

## Transport conventions

Base path: `/api/v1`. JSON requests use `Content-Type: application/json`. Send
`Accept-Language` for localized errors, help, profile names, and account email. Account
authentication uses the `connect.sid` HTTP-only session cookie; browser callers must use
same-origin credentials. Public deployments with `PUBLIC_RUNTIME_SECURITY=enforced`
reject state-changing requests whose `Origin`/`Referer` does not match `PUBLIC_URL`.

Successful bodies are JSON unless the status is `204`. Errors use:

```json
{
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "Localized human-readable text",
        "data": {}
    }
}
```

`code`, not `message`, is the stable programmatic value. Validation responses put Zod's
flattened issue structure in `data`. Business errors derive stable codes such as
`ACCOUNT_INVALID_CREDENTIALS`; an unknown endpoint returns `REQUEST_NOT_FOUND`, and
unexpected failures return `INTERNAL_ERROR` without serializing internal error data.
Account-sensitive endpoints are rate-limited under enforced public security. Every API
response uses `Cache-Control: no-store` and includes a server-generated `X-Request-ID`.

## Discovery and operations

| Method | Path                           | Result                                                                                                                    |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/server-info`                 | Stable installation identity, capabilities, endpoints, discovery status, deployment policy, protocols, and Room capacity. |
| GET    | `/healthz`                     | Liveness (`ok`), outside `/api/v1`.                                                                                       |
| GET    | `/readyz`                      | Database readiness (`ready`), outside `/api/v1`.                                                                          |
| GET    | `/game-profiles`               | Localized immutable built-in profile summaries.                                                                           |
| GET    | `/help`                        | Explicitly ordered Help document `{slug,title}` list for requested language.                                              |
| GET    | `/help/:slug`                  | Rendered `{slug,title,html}` help document.                                                                               |
| GET    | `/catalog/locales`             | Active database Card locales, default locale, and coverage.                                                               |
| GET    | `/catalog/taxonomies?locale=L` | Database taxonomy labels for Card locale `L`.                                                                             |

`GET /game-profiles` returns the five immutable built-ins
`PROFILE_CHILD_FRIENDLY`, `PROFILE_ACQUAINTANCES`, `PROFILE_FRIENDS`,
`PROFILE_CLOSE_FRIENDS`, and `PROFILE_SPICY`, followed by editable `PROFILE_CUSTOM`.
`PROFILE_SPICY` requires adult confirmation. The unreleased
`PROFILE_COLLEAGUES`, `PROFILE_BEST_FRIENDS`, `PROFILE_COUPLES`, and
`PROFILE_COUPLES_SPICY` identifiers are removed rather than aliased; this is an
intentional pre-release compatibility break. The schema migration converts persisted
DataSpace, Group, Room, and active-session values to their canonical replacements
before those records are exposed to the API.

Help HTML is generated from trusted bundled Markdown; it is not user-authored content. The
single `docs/user-guide/topics.json` manifest defines stable slugs and spaced numeric positions
for every locale. Adding or repositioning a topic does not require renaming documents or changing
the API or browser tab implementation.

`GET /server-info` returns `deploymentMode`, `publicRuntimeSecurity` (`enforced` or
`development`), `authenticationAvailable`, `protocolVersions`, the authoritative
`roomCapacity` ceilings, and `roomAccess`. It also returns the stable installation UUID
`serverId`, sanitized `displayName`, and:

```json
{
    "capabilities": {
        "localNetworkDiscovery": true,
        "displayBootstrapRoomCreation": true
    },
    "localNetworkDiscovery": {
        "advertising": true,
        "serviceType": "_partycard._tcp",
        "txtVersion": 1
    },
    "endpoints": {
        "apiBasePath": "/api/v1",
        "webSocketPath": "/ws",
        "roomJoinPathTemplate": "/play/?room={roomCode}"
    }
}
```

`localNetworkDiscovery` capability means the binary and effective deployment policy
support it; `advertising` separately reports whether at least one eligible interface is
currently published. `displayBootstrapRoomCreation` is true only when policy, schema,
Room service, and stable encrypted replay protection are available. Endpoint values are
validated same-origin relative paths and never contain credentials. `roomAccess` contains nullable
`configuredBaseUrl` and `availableBaseUrls`. In local mode the configured value is null
unless `PUBLIC_URL` was explicitly set, and the available list contains detected
credential-free origins for eligible physical interfaces. Virtual adapters and
scope-dependent link-local IPv6 addresses are excluded; each interface contributes at
most one global/unique-local IPv6 origin, with global preferred. In public mode both
fields contain only the required configured origin. The runtime-security and discovery
fields are informational for clients and operations; clients receive no additional
authority from them.

`GET /catalog/taxonomies` always returns Question Categories and DareTypes in the
canonical order declared by `game-core/cards/taxonomy.ts`; database/content ordering
never controls choice-group presentation.

## Rooms

### `POST /rooms`

```json
{
    "displayName": "Alex",
    "persistence": "EPHEMERAL",
    "bootstrapMode": "CREATOR_HOST",
    "settings": {
        "mode": "CLASSIC_TRUTH_OR_DARE",
        "profileId": "PROFILE_FRIENDS",
        "groupId": null,
        "adultContentConfirmed": false,
        "cardLocale": "de-DE",
        "cardFallbackEnabled": false,
        "cardFallbackLocales": [],
        "cardPolicy": {
            "scopeDefault": {},
            "conditionalRules": [],
            "exactCards": []
        },
        "neverHaveIEverRevealMode": "ANONYMOUS_AGGREGATE",
        "configuration": {
            "enabledQuestionCategoryIds": ["CAT_EVERYDAY"],
            "enabledDareTypeIds": ["DARE_SILLY"],
            "blockedOperationalFlags": [],
            "maximumSocialSensitivity": "PERSONAL",
            "startingIntensity": 1,
            "maximumIntensity": 3,
            "intensityProgressionUnit": "CARDS",
            "intensityProgressionInterval": 2,
            "intensityProgressionIncrement": 1,
            "randomQuestionRatio": 0.6,
            "maximumTypeStreak": 3,
            "letsTalkMetaInterval": 5
        }
    }
}
```

`persistence` is `EPHEMERAL` or `DATASPACE`. Ephemeral Rooms allow anonymous use.
DataSpace Rooms require an authenticated session and owned current DataSpace.
The web client selects `DATASPACE` whenever a local or authenticated DataSpace is
available, including quick games without a Group, so DataSpace Card policy still applies.
Anonymous public quick games remain `EPHEMERAL` and use Catalog plus Session policy.
`settings` is optional only to support callers that deliberately accept the documented
server default; when supplied, its Group must belong to the selected DataSpace.
`neverHaveIEverRevealMode` is `ANONYMOUS_AGGREGATE` or `NAMED_ANSWERS` and defaults to
anonymous when omitted. It is relevant only to Never Have I Ever, is copied into the
Session at start, and cannot be changed while that Session is active.
`configuration.startingIntensity` and `maximumIntensity` are public 1–5 levels with start
less than or equal to end. `intensityProgressionUnit` is `ROUNDS` or `CARDS`, and
`intensityProgressionInterval` is a positive integer up to 100.
`intensityProgressionIncrement` accepts half-steps from 0.5 through 4 internal score
points. Runtime increases the fine-grained score ceiling by that increment after each
interval until the end. Omitted progression fields default to start 1, Card-based pacing,
interval 2, and increment 1; response snapshots always include them.
`configuration.maximumSocialSensitivity` is independent from intensity and accepts
`GENERAL`, `PERSONAL`, `CLOSE_PERSONAL`, `DEEP_PERSONAL`, `INTIMATE`, or `EXPLICIT`.
Omission defaults to `EXPLICIT` for additive compatibility. The chosen profile and
explicit Card policies apply any separate taxonomy or operational restrictions.
`cardFallbackEnabled` defaults to false. When true, `cardFallbackLocales` must contain a
non-empty, unique, ordered list of active Card locales and must not contain the primary
`cardLocale`. The server validates all entries and resolves missing Card text in that
exact order.
`bootstrapMode` defaults to `CREATOR_HOST`. It returns `201` with `roomId`, six-character
`roomCode`, `participantId`, `participantCredential`, role `HOST`, the resolved
`bootstrapMode`, and `hostStatus`. Before that creator authenticates over WebSocket,
`hostStatus` is `CONNECTING` with its participant identity and activation deadline.

`DISPLAY_WAITING_FOR_HOST` is the setup wizard's **TV + phones** opening mode. It creates
exactly one creator participant with role `DISPLAY`, no synthetic or temporary Host, and
returns:

```json
{
    "roomId": "1c886905-9dce-4b9d-9bfa-21748472fd91",
    "roomCode": "AB12CD",
    "participantId": "4c72ae95-830a-4c75-9a42-243bedba4187",
    "participantCredential": "<bearer-secret>",
    "role": "DISPLAY",
    "bootstrapMode": "DISPLAY_WAITING_FOR_HOST",
    "hostStatus": {
        "state": "AWAITING_FIRST_HOST",
        "participantId": null,
        "displayName": null,
        "deadline": null
    }
}
```

This mode requires exactly one `Idempotency-Key` header. The value is normalized to
lowercase and must be a canonical UUIDv4; duplicate fields, comma-combined values,
query/body keys, and other UUID versions are rejected. `CREATOR_HOST` may also opt into
the same semantics. The fingerprint covers the caller-supplied parsed JSON, preserving
omitted versus explicit fields. Within the installation, route, and authenticated
account/local/anonymous principal namespace, an identical retry returns the original
`201` body—including the same credential—and never creates another Room. Reusing a key
with a different body is a conflict. A successful replay includes
`Idempotency-Replayed: true`; the original response does not.

Only HMAC digests of the principal namespace and key are stored. Credential-bearing
replay bodies use installation-scoped AES-256-GCM protection with purpose-separated
keys and bound metadata. Retained records identify the derived lookup and replay keys so
startup can fail closed on unsafe secret rotation. When the creator credential becomes terminal, ciphertext is
erased and a bounded `RESOURCE_GONE` tombstone prevents the known key from silently
creating a replacement Room.

Stable create errors are:

| Code                              | Status | Meaning                                                                          |
| --------------------------------- | -----: | -------------------------------------------------------------------------------- |
| `ROOM_BOOTSTRAP_MODE_UNSUPPORTED` |    409 | Display bootstrap is disabled or replay protection is unavailable.               |
| `IDEMPOTENCY_KEY_REQUIRED`        |    400 | Display bootstrap omitted the header.                                            |
| `IDEMPOTENCY_KEY_INVALID`         |    400 | Header multiplicity or UUIDv4 syntax is invalid.                                 |
| `IDEMPOTENCY_KEY_REUSED`          |    409 | The scoped key has a different request fingerprint.                              |
| `IDEMPOTENCY_REQUEST_IN_PROGRESS` |    409 | The matching create is still committing; retry after the supplied `Retry-After`. |
| `IDEMPOTENCY_RESULT_GONE`         |    410 | The original credential is terminal and its replay body was erased.              |

### `POST /rooms/:roomCode/participants`

```json
{ "displayName": "Sam", "role": "PLAYER" }
```

Role is `PLAYER` or `DISPLAY`; HTTP cannot create another host. Returns the same join
credential shape with `201`. HTTP join does not reserve Host authority: in a
display-bootstrap Room, the first credential-authenticated `PLAYER` whose WebSocket
activation commits is atomically promoted and receives authoritative role `HOST` in
`server.hello`. A `DISPLAY` is never eligible. The room code is public and suitable for QR codes. The
participant credential is secret and must only be stored on the joining device.
Realtime play continues over WebSocket. A Room accepts the server-configured number of
active device participants and represented players (100 each by default, configurable
with `ROOM_MAX_PARTICIPANTS` and `ROOM_MAX_PLAYERS`); excess joins return
`409 ROOM_FULL`. Enforced public deployments rate-limit Room creation and joins per
source address. `/server-info` and every authoritative Room snapshot expose these two
limits.

## Couch sessions

Couch sessions are single-device and server-authoritative. Creation accepts
`persistence: "EPHEMERAL" | "DATASPACE"` and defaults to `EPHEMERAL`. Ephemeral Couch
sessions work without an account in local and public deployments, remain in process
memory only, and create no Couch Session, CardAppearance, Group-history, or DataSpace
rows. DataSpace Couch sessions require the authenticated account's current DataSpace;
their runtime, shown-card history, and final ended state are persisted for restart
recovery and export. A `groupId` is accepted only for DataSpace persistence and must
belong to that current DataSpace.

An optional `cardLocale` selects an active database Card locale; omission at the API
boundary uses the catalog default. The web setup UX normally supplies its interface-
matched or explicitly remembered choice. Optional `cardFallbackEnabled` and ordered
`cardFallbackLocales` use the same validation and resolution rules as Room settings.
Endpoints use a
session UUID and optimistic `revision`. Every read and command for a DataSpace Couch
session is authorized against the current account-owned DataSpace.

| Method | Path                          | Body                                                                                                                           |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/couch/sessions`             | Persistence, mode, 2–20 player names, canonical configuration, profile/group/adult confirmation, Card locale, and reveal mode. |
| GET    | `/couch/sessions/:id`         | none                                                                                                                           |
| POST   | `/couch/sessions/:id/start`   | `{revision}`                                                                                                                   |
| POST   | `/couch/sessions/:id/choose`  | `{revision,cardType}`                                                                                                          |
| POST   | `/couch/sessions/:id/skip`    | `{revision}`                                                                                                                   |
| POST   | `/couch/sessions/:id/advance` | `{revision}`                                                                                                                   |
| POST   | `/couch/sessions/:id/vote`    | `{revision,playerId,vote}`                                                                                                     |
| POST   | `/couch/sessions/:id/end`     | `{revision}`                                                                                                                   |

Conflicts return `409` for stale revisions, invalid state, or an exhausted localized
card pool. Missing sessions return `404`.

Couch snapshots use the same `neverHaveIEverVoting` projection as Room snapshots. It
contains reveal mode and ordered `PENDING`/`VOTED` progress while collecting. `result`
is null until completion. Anonymous results contain counts only; named results then add
ordered `{playerId,displayName,vote}` entries. Individual values are never copied into
CardAppearance or Group history.

Every Couch snapshot also includes additive `remainingCardCount`, calculated by the
authoritative engine after the current profile, boundaries, progression, policies, and
Session/Group history are applied. It is response-only display information.

The additive `currentCard.cardIntensity` in Couch and Room snapshots is the Card's
relative 1–5 position within its Question Category or DareType. The existing
`currentCard.intensity` remains the derived global 1–5 band. Clients should use
the taxonomy to choose a visual family and `intensity` to tune the global animated
backdrop; they may present both intensity values to players.

## Accounts

Local account endpoints may be disabled by deployment configuration.

| Method | Path                                     | Authentication | Purpose                                                            |
| ------ | ---------------------------------------- | -------------- | ------------------------------------------------------------------ |
| GET    | `/account/configuration`                 | no             | Available login methods, OIDC label, and public legal URLs.        |
| GET    | `/account/status`                        | no             | Deployment/login/legal capabilities and optional account snapshot. |
| POST   | `/account/register`                      | no             | Create inactive account and send activation mail.                  |
| POST   | `/account/activation-requests`           | no             | Resend activation without exposing account existence.              |
| POST   | `/account/activate`                      | no             | Consume one-time activation token.                                 |
| POST   | `/account/login`                         | no             | Establish account session.                                         |
| POST   | `/account/logout`                        | optional       | Destroy current session.                                           |
| POST   | `/account/password-reset-requests`       | no             | Send reset mail without exposing account existence.                |
| POST   | `/account/password-resets`               | no             | Consume reset token and set Argon2id password.                     |
| GET    | `/account/oidc/login`                    | no             | Redirect to configured OIDC provider.                              |
| GET    | `/account/oidc/callback`                 | provider       | Complete Authorization Code flow.                                  |
| GET    | `/account/me`                            | yes            | Account and selected DataSpace snapshot.                           |
| POST   | `/account/data-spaces`                   | yes            | Create and select a DataSpace.                                     |
| DELETE | `/account/data-spaces/:id`               | yes            | Permanently delete an owned, non-final DataSpace.                  |
| PUT    | `/account/data-spaces/current`           | yes            | Rename/default current DataSpace.                                  |
| PUT    | `/account/data-spaces/current-selection` | yes            | Select an owned DataSpace.                                         |
| PUT    | `/account/language-preferences`          | yes            | Partially update account-owned language choices and order.         |
| GET    | `/account/sessions`                      | yes            | List account sessions.                                             |
| DELETE | `/account/sessions/:id`                  | yes            | Revoke a session.                                                  |
| GET    | `/account/export`                        | yes            | Download account-owned JSON data.                                  |
| DELETE | `/account/me`                            | yes            | Delete account after username confirmation.                        |

Activation/reset tokens are one-time bearer values sent by email. Stored values are
hashed; the browser removes them from the visible URL/history immediately after reading
the link, and clients must not persist them after use. Successful password reset revokes
every existing login session for that account. The server-side session stores only the
numeric user ID and selected DataSpace ID; session listing/revocation uses a separate
indexed owner column rather than scanning personal data in serialized session JSON.

Account snapshots include nullable `languagePreferences`. It remains `null` until a
person manually changes interface system/manual mode, interface language, Card language,
or fallback order. Once present it contains
`{useSystemLanguage,interfaceLocale,cardLocale,fallbackLocales}`. Locale tags are
validated BCP-47-shaped strings and `fallbackLocales` is unique and ordered. These
preferences belong to the User across DataSpaces. `PUT /account/language-preferences`
accepts a strict non-empty partial object and returns the updated account snapshot.

Every authenticated account has at least one owned DataSpace. Registration and OIDC
just-in-time provisioning establish it, while login and authenticated-session validation
repair older accounts that have none. A missing/deleted server-side selection falls back
to an owned DataSpace and is persisted in the session. An ID that still exists under a
different owner is rejected; the repair path never accepts a client-supplied ownership
boundary.

Account export version 3 includes account/DataSpace metadata, groups, saved defaults,
durable Couch/Room Session metadata, Card-policy defaults/rules/exact-Card records, and
privacy-safe CardAppearance outcomes. It deliberately excludes live runtime JSON and
individual Never-Have-I-Ever answers. Account deletion cascades through both Couch and
Room data owned by the account's DataSpaces.

Deleting a DataSpace is ownership-checked and transactional. The final DataSpace cannot
be deleted (`409`). Deleting the selected DataSpace moves the session to a remaining
owned DataSpace; deleting a default promotes a remaining DataSpace. Database cascades
remove that DataSpace's groups, settings, durable Couch sessions, owned Rooms, Room
sessions, participants, and CardAppearances. The endpoint returns the updated account
snapshot. This is an additive HTTP contract change; the create response shape is
unchanged, although the newly created DataSpace is now selected immediately.

## DataSpace resources

`/groups` and `/game-settings` resolve the singleton local DataSpace in none-auth mode or
require an authenticated, owned current DataSpace in public mode.
Groups support `GET`, `POST`, `PUT /:id`, `DELETE /:id`, and confirmed
`POST /:id/history-reset`. Resetting history advances the Group's history cutoff; it
does not delete the Group or historical Session/CardAppearance records. Group responses
add nullable `customConfiguration` and `cardLanguageSettings` values. The latter contains
`{cardLocale,cardFallbackEnabled,cardFallbackLocales}`. Writes validate the complete
Custom schema, BCP-47-shaped unique locale order, and active Card catalog locales on the
server. Built-in profile updates preserve the Group's Custom snapshot. Game settings
support `GET` and `PUT` for preferred profile, start/end intensity, maximum social
sensitivity, progression unit and interval, progression increment, question ratio,
conversation interval, optional
default group, `customConfiguration`, and nullable `cardLanguageSettings`. The Custom
value uses the canonical effective game settings schema (categories, DareTypes,
operational flags, maximum social sensitivity, intensity, pacing, ratio, streak, and
conversation interval). It is
updated only when `preferredProfileId` is `PROFILE_CUSTOM`; other profile writes preserve
it. `GET` always returns it, using the neutral Custom seed until one has been saved. The
Card-language value has the same shape and server validation as its Group counterpart
and stores no-Group quick-round defaults separately. Resource IDs are UUIDs and are
always authorization-scoped to the selected DataSpace.

`GET /game-settings` returns
`{settings,dataSpace:{id,name}}`. The small DataSpace projection lets setup and the main
menu identify the ownership boundary currently in use without loading Account data; it
works in both the one-DataSpace none-auth deployment and an authenticated public
deployment. `PUT /game-settings` returns the same projection. An omitted
`maximumSocialSensitivity` is interpreted as `EXPLICIT`, preserving the previously
unrestricted sensitivity behavior for older `/api/v1` clients.

The two account configuration responses expose `imprintUrl` and `privacyPolicyUrl` as
empty strings when an administrator has not configured them. Non-empty values are
validated HTTP(S) URLs. These and the Group fields are additive `/api/v1` response fields;
existing clients may ignore them.

Deleting a Group is ownership-checked and transactional. It removes the Group and its
member list, clears it as the DataSpace default, and detaches durable Rooms, Sessions,
and CardAppearances from the deleted Group. Historical Sessions and appearances remain
as ungrouped account history.

## Scoped Card policy

Card management is additive under `/card-policy`. In a none-auth deployment the routes
operate on the installation's local DataSpace. In a public deployment they require an
authenticated current DataSpace. Supplying `groupId` selects an owned Group in that
DataSpace; an absent `groupId` selects the DataSpace scope.

| Method | Path                                       | Purpose                                                 |
| ------ | ------------------------------------------ | ------------------------------------------------------- |
| GET    | `/card-policy/export`                      | Download one portable selected-scope policy package.    |
| POST   | `/card-policy/import`                      | Atomically replace one scope from a validated package.  |
| GET    | `/card-policy/default`                     | Read the selected sparse scope default.                 |
| PUT    | `/card-policy/default`                     | Replace the sparse scope-default directives.            |
| GET    | `/card-policy/rules`                       | Read ordered conditional rules.                         |
| POST   | `/card-policy/rules`                       | Append a conditional rule.                              |
| PUT    | `/card-policy/rules/:id`                   | Replace one conditional rule.                           |
| DELETE | `/card-policy/rules/:id`                   | Delete one conditional rule.                            |
| POST   | `/card-policy/rules/reorder`               | Persist the complete rule order.                        |
| POST   | `/card-policy/rules/preview`               | Preview a predicate against the installed catalog.      |
| POST   | `/card-policy/session/rules/preview`       | Preview a pending Session rule without persistence.     |
| POST   | `/card-policy/session/eligibility-preview` | Count Cards eligible for a pending game.                |
| POST   | `/card-policy/session/cards`               | Search/resolve Cards for a pending Session policy.      |
| GET    | `/card-policy/cards`                       | Cursor-search Cards and effective/provenance metadata.  |
| POST   | `/card-policy/cards/bulk`                  | Materialize exact overrides for a confirmed result set. |
| GET    | `/card-policy/cards/:cardId`               | Read one exact-Card override.                           |
| PUT    | `/card-policy/cards/:cardId`               | Replace one exact-Card override.                        |
| DELETE | `/card-policy/cards/:cardId`               | Delete one exact-Card override.                         |

Policy writes use optimistic `expectedRevision`; stale writes return `409`. Directives
are sparse and use `INHERIT` to restore the lower scope. Availability is
`INHERIT | INCLUDE | EXCLUDE`; boolean values are
`INHERIT | ENABLE | DISABLE`; scalar/range values are objects with mode
`INHERIT | CATALOG | SET` and a `value` only for `SET`.

`DELETE /card-policy/rules/:id` and `DELETE /card-policy/cards/:cardId` carry
`expectedRevision` as a required non-negative decimal query parameter. As with every
URL query value it is encoded as text on the wire and parsed to an integer at the HTTP
boundary before the repository receives it.

Portable scope packages use the closed `party-game-card-policy/v2` format and contain a
Scope Default, ordered rules, and exact Card UUID policies without source ownership IDs.
Import validates every directive, predicate, Card reference, and player-count range
before replacing the target scope in one transaction. The earlier v1 package is not
accepted; callers must emit the closed v2 shape.
Retired Card references remain valid because Catalog reconciliation never hard-deletes
historical Cards. Imported rule IDs are regenerated for the target ownership boundary.

Bulk exact-Card writes submit the same server-side facets as Card search plus the result
count the person confirmed. The server recomputes the complete match set and returns
`409 POLICY_RESULT_SET_CHANGED` if that count changed, preventing a stale confirmation
from silently targeting a different set. Text-filtered bulk changes materialize stable
Card UUID policies; they never persist localized text as a rule predicate.

Card search accepts `limit` from 1 through 50 (default 24) and an optional opaque UUID
`cursor`. It returns `{cards,total,nextCursor}`. `total` describes the complete filtered
result, `cards` contains only the requested page, and `nextCursor` is `null` at the end.
Changing any facet starts a new cursor sequence. Each Card result contains localized
text, stable taxonomy/lifecycle metadata, producer values, effective values, local
directives, optimistic local revision, and per-property provenance.

Rule-preview responses contain `{matchCount,cards}`. `matchCount` covers the complete
installed catalog after predicate evaluation; `cards` is only a bounded localized sample
for confirmation and must not be interpreted as the full result. Persistent and pending
Session preview endpoints share these semantics. A preview is read-only and never
activates or saves a rule.

`POST /card-policy/session/eligibility-preview` accepts either
`{settings:<canonical RoomGameSettings>,playerCount}` for pending setup changes or
`{roomCode,participantCredential}` for the authoritative settings and connected roster
of an existing Room. It returns
`{total,availableAtStart,byType,atStartByType,playerCount}`. `total` is the
mode-relevant pool at the configured maximum global intensity; `availableAtStart` uses
the configured starting intensity. The server applies Card localization/fallback,
profile taxonomy and maximum social sensitivity, DataSpace/Group/Session policy, Card
player-count ranges, lifecycle, and shared Group history. It deliberately
does not receive or reveal private participant boundaries, so those may reduce the pool
when a Session actually starts. The endpoint is read-only. Anonymous public quick games
may call the pending-settings form only without a Group; a Group preview requires
authenticated ownership of the selected DataSpace and Group. The Room form instead
requires a valid participant credential, resolves the policy owner on the server, never
changes presence, and does not expose DataSpace policy details or the credential in a URL.

The server resolves Catalog metadata, then DataSpace scope default, ordered DataSpace
rules, DataSpace exact Card, Group scope default, ordered Group rules, Group exact Card,
Session property directives, and finally Session availability. A deliberate one-Session
`INCLUDE` can reverse persistent availability. Lifecycle, localization, profile
taxonomy/sensitivity, adult confirmation, and player-count validity remain
non-overridable engine gates. Session start compiles the effective policy and Catalog
provenance into an immutable runtime snapshot. Card draw additionally checks the
authoritative current player count.

The optional `settings.cardPolicy` object on Room and Couch creation contains only
Session-scope `scopeDefault`, ordered `conditionalRules`, and `exactCards`. Omission means
all Session directives inherit. `PROFILE_CHILD_FRIENDLY` supplies the child-safe
quick-start content combination as ordinary editable profile settings. Extra preset
fields and endpoints from the earlier unreleased shape are not part of this contract. The
portable policy format changes from v1 to v2 for the same reason.
