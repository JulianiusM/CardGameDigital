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

| Method | Path                           | Result                                                                       |
| ------ | ------------------------------ | ---------------------------------------------------------------------------- |
| GET    | `/server-info`                 | Deployment/runtime-security/auth availability, protocols, and Room capacity. |
| GET    | `/healthz`                     | Liveness (`ok`), outside `/api/v1`.                                          |
| GET    | `/readyz`                      | Database readiness (`ready`), outside `/api/v1`.                             |
| GET    | `/game-profiles`               | Localized immutable built-in profile summaries.                              |
| GET    | `/help`                        | Explicitly ordered Help document `{slug,title}` list for requested language. |
| GET    | `/help/:slug`                  | Rendered `{slug,title,html}` help document.                                  |
| GET    | `/catalog/locales`             | Active database Card locales, default locale, and coverage.                  |
| GET    | `/catalog/taxonomies?locale=L` | Database taxonomy labels for Card locale `L`.                                |

Help HTML is generated from trusted bundled Markdown; it is not user-authored content. The
single `docs/user-guide/topics.json` manifest defines stable slugs and spaced numeric positions
for every locale. Adding or repositioning a topic does not require renaming documents or changing
the API or browser tab implementation.

`GET /server-info` returns `deploymentMode`, `publicRuntimeSecurity` (`enforced` or
`development`), `authenticationAvailable`, `protocolVersions`, and the authoritative
`roomCapacity` ceilings. The runtime-security field is informational for clients and
operations; clients receive no additional authority from it.

## Rooms

### `POST /rooms`

```json
{
    "displayName": "Alex",
    "persistence": "EPHEMERAL",
    "settings": {
        "mode": "CLASSIC_TRUTH_OR_DARE",
        "profileId": "PROFILE_FRIENDS",
        "groupId": null,
        "adultContentConfirmed": false,
        "cardLocale": "de-DE",
        "cardFallbackEnabled": false,
        "cardFallbackLocales": [],
        "neverHaveIEverRevealMode": "ANONYMOUS_AGGREGATE",
        "configuration": {
            "enabledQuestionCategoryIds": ["CAT_EVERYDAY"],
            "enabledDareTypeIds": ["DARE_SILLY"],
            "blockedOperationalFlags": [],
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
`cardFallbackEnabled` defaults to false. When true, `cardFallbackLocales` must contain a
non-empty, unique, ordered list of active Card locales and must not contain the primary
`cardLocale`. The server validates all entries and resolves missing Card text in that
exact order.
Returns `201` with `roomId`, six-character `roomCode`, `participantId`,
`participantCredential`, and role `HOST`.

### `POST /rooms/:roomCode/participants`

```json
{ "displayName": "Sam", "role": "PLAYER" }
```

Role is `PLAYER` or `DISPLAY`; HTTP cannot create another host. Returns the same join
credential shape with `201`. The room code is public and suitable for QR codes. The
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

The additive `currentCard.cardIntensity` in Couch and Room snapshots is the Card's
relative 1–5 position within its Question Category or DareType. The existing
`currentCard.intensity` remains the derived global 1–5 band. Clients should use
`cardIntensity` to tune category/type-specific visual families and may present both
values to players.

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

Account export includes account/DataSpace metadata, groups, saved defaults, durable
Couch/Room Session metadata, and privacy-safe CardAppearance outcomes. It deliberately
excludes live runtime JSON and individual Never-Have-I-Ever answers. Account deletion
cascades through both Couch and Room data owned by the account's DataSpaces.

Deleting a DataSpace is ownership-checked and transactional. The final DataSpace cannot
be deleted (`409`). Deleting the selected DataSpace moves the session to a remaining
owned DataSpace; deleting a default promotes a remaining DataSpace. Database cascades
remove that DataSpace's groups, settings, durable Couch sessions, owned Rooms, Room
sessions, participants, and CardAppearances. The endpoint returns the updated account
snapshot. This is an additive HTTP contract change; the create response shape is
unchanged, although the newly created DataSpace is now selected immediately.

## DataSpace resources

`/groups` and `/game-settings` require an authenticated, owned current DataSpace.
Groups support `GET`, `POST`, `PUT /:id`, `DELETE /:id`, and confirmed
`POST /:id/history-reset`. Resetting history advances the Group's history cutoff; it
does not delete the Group or historical Session/CardAppearance records. Group responses
add nullable `customConfiguration` and `cardLanguageSettings` values. The latter contains
`{cardLocale,cardFallbackEnabled,cardFallbackLocales}`. Writes validate the complete
Custom schema, BCP-47-shaped unique locale order, and active Card catalog locales on the
server. Built-in profile updates preserve the Group's Custom snapshot. Game settings
support `GET` and `PUT` for preferred profile, start/end intensity, progression unit and
interval, progression increment, question ratio, conversation interval, optional
default group, `customConfiguration`, and nullable `cardLanguageSettings`. The Custom
value uses the canonical effective game settings schema (categories, DareTypes,
operational flags, intensity, pacing, ratio, streak, and conversation interval). It is
updated only when `preferredProfileId` is `PROFILE_CUSTOM`; other profile writes preserve
it. `GET` always returns it, using the neutral Custom seed until one has been saved. The
Card-language value has the same shape and server validation as its Group counterpart
and stores no-Group quick-round defaults separately. Resource IDs are UUIDs and are
always authorization-scoped to the selected DataSpace.

The two account configuration responses expose `imprintUrl` and `privacyPolicyUrl` as
empty strings when an administrator has not configured them. Non-empty values are
validated HTTP(S) URLs. These and the Group fields are additive `/api/v1` response fields;
existing clients may ignore them.

Deleting a Group is ownership-checked and transactional. It removes the Group and its
member list, clears it as the DataSpace default, and detaches durable Rooms, Sessions,
and CardAppearances from the deleted Group. Historical Sessions and appearances remain
as ungrouped account history.
