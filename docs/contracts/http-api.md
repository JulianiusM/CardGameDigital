# HTTP API v1 contract

## Transport conventions

Base path: `/api/v1`. JSON requests use `Content-Type: application/json`. Send
`Accept-Language` for localized errors, help, profile names, and account email. Account
authentication uses the `connect.sid` HTTP-only session cookie; browser callers must use
same-origin credentials. Public deployments reject state-changing requests whose
`Origin`/`Referer` does not match `PUBLIC_URL`.

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
Account-sensitive endpoints are rate-limited. Every API response uses
`Cache-Control: no-store` and includes a server-generated `X-Request-ID`.

## Discovery and operations

| Method | Path                           | Result                                                        |
| ------ | ------------------------------ | ------------------------------------------------------------- |
| GET    | `/server-info`                 | Deployment/auth availability and supported protocol versions. |
| GET    | `/healthz`                     | Liveness (`ok`), outside `/api/v1`.                           |
| GET    | `/readyz`                      | Database readiness (`ready`), outside `/api/v1`.              |
| GET    | `/game-profiles`               | Localized immutable built-in profile summaries.               |
| GET    | `/help`                        | Help document `{slug,title}` list for requested language.     |
| GET    | `/help/:slug`                  | Rendered `{slug,title,html}` help document.                   |
| GET    | `/catalog/locales`             | Active database Card locales, default locale, and coverage.   |
| GET    | `/catalog/taxonomies?locale=L` | Database taxonomy labels for Card locale `L`.                 |

Help HTML is generated from trusted bundled Markdown; it is not user-authored content.

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
Returns `201` with `roomId`, six-character `roomCode`, `participantId`,
`participantCredential`, and role `HOST`.

### `POST /rooms/:roomCode/participants`

```json
{ "displayName": "Sam", "role": "PLAYER" }
```

Role is `PLAYER` or `DISPLAY`; HTTP cannot create another host. Returns the same join
credential shape with `201`. The room code is public and suitable for QR codes. The
participant credential is secret and must only be stored on the joining device.
Realtime play continues over WebSocket. A Room accepts at most 20 active device
participants and 20 represented players; excess joins return `409 ROOM_FULL`. Public
deployments rate-limit Room creation and joins per source address.

## Couch sessions

Couch sessions are single-device and server-authoritative. Runtime, shown-card history,
and the final ended state are persisted; an optional owned `groupId` applies durable
Group history. An optional `cardLocale` selects an active database Card locale; omission
uses the catalog default and never derives Card language from UI language. Endpoints use a session
UUID and optimistic `revision`.

| Method | Path                          | Body                                                                                                              |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| POST   | `/couch/sessions`             | Mode, 2–20 player names, canonical configuration, profile/group/adult confirmation, Card locale, and reveal mode. |
| GET    | `/couch/sessions/:id`         | none                                                                                                              |
| POST   | `/couch/sessions/:id/start`   | `{revision}`                                                                                                      |
| POST   | `/couch/sessions/:id/choose`  | `{revision,cardType}`                                                                                             |
| POST   | `/couch/sessions/:id/skip`    | `{revision}`                                                                                                      |
| POST   | `/couch/sessions/:id/advance` | `{revision}`                                                                                                      |
| POST   | `/couch/sessions/:id/vote`    | `{revision,playerId,vote}`                                                                                        |
| POST   | `/couch/sessions/:id/end`     | `{revision}`                                                                                                      |

Conflicts return `409` for stale revisions, invalid state, or an exhausted localized
card pool. Missing sessions return `404`.

Couch snapshots use the same `neverHaveIEverVoting` projection as Room snapshots. It
contains reveal mode and ordered `PENDING`/`VOTED` progress while collecting. `result`
is null until completion. Anonymous results contain counts only; named results then add
ordered `{playerId,displayName,vote}` entries. Individual values are never copied into
CardAppearance or Group history.

The `currentCard.intensity` in Couch and Room snapshots is the derived global 1–5 band,
not the producer's relative per-taxonomy position.

## Accounts

Local account endpoints may be disabled by deployment configuration.

| Method | Path                                     | Authentication | Purpose                                             |
| ------ | ---------------------------------------- | -------------- | --------------------------------------------------- |
| GET    | `/account/configuration`                 | no             | Available login methods and OIDC label.             |
| POST   | `/account/register`                      | no             | Create inactive account and send activation mail.   |
| POST   | `/account/activate`                      | no             | Consume one-time activation token.                  |
| POST   | `/account/login`                         | no             | Establish account session.                          |
| POST   | `/account/logout`                        | optional       | Destroy current session.                            |
| POST   | `/account/password-reset-requests`       | no             | Send reset mail without exposing account existence. |
| POST   | `/account/password-resets`               | no             | Consume reset token and set Argon2id password.      |
| GET    | `/account/oidc/login`                    | no             | Redirect to configured OIDC provider.               |
| GET    | `/account/oidc/callback`                 | provider       | Complete Authorization Code flow.                   |
| GET    | `/account/me`                            | yes            | Account and selected DataSpace snapshot.            |
| POST   | `/account/data-spaces`                   | yes            | Create DataSpace.                                   |
| PUT    | `/account/data-spaces/current`           | yes            | Rename/default current DataSpace.                   |
| PUT    | `/account/data-spaces/current-selection` | yes            | Select an owned DataSpace.                          |
| GET    | `/account/sessions`                      | yes            | List account sessions.                              |
| DELETE | `/account/sessions/:id`                  | yes            | Revoke a session.                                   |
| GET    | `/account/export`                        | yes            | Download account-owned JSON data.                   |
| DELETE | `/account/me`                            | yes            | Delete account after username confirmation.         |

Activation/reset tokens are one-time bearer values sent by email. Stored values are
hashed; the browser removes them from the visible URL/history immediately after reading
the link, and clients must not persist them after use.

## DataSpace resources

`/groups` and `/game-settings` require an authenticated, owned current DataSpace.
Groups support `GET`, `POST`, `PUT /:id`, `DELETE /:id`, and confirmed
`POST /:id/history-reset`. Resetting history advances the Group's history cutoff; it
does not delete the Group or historical Session/CardAppearance records. Game settings
support `GET` and `PUT` for preferred profile, start/end intensity, progression unit and
interval, progression increment, question ratio, conversation interval, and optional
default group. Resource IDs are UUIDs and are always authorization-scoped to the selected
DataSpace.
