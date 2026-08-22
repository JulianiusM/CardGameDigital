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

`code`, not `message`, is the stable programmatic value. Validation responses may add
`details`. Account-sensitive endpoints are rate-limited.

## Discovery and operations

| Method | Path             | Result                                                        |
| ------ | ---------------- | ------------------------------------------------------------- |
| GET    | `/server-info`   | Deployment/auth availability and supported protocol versions. |
| GET    | `/healthz`       | Liveness (`ok`), outside `/api/v1`.                           |
| GET    | `/readyz`        | Database readiness (`ready`), outside `/api/v1`.              |
| GET    | `/game-profiles` | Localized immutable built-in profile summaries.               |
| GET    | `/help`          | Help document `{slug,title}` list for requested language.     |
| GET    | `/help/:slug`    | Rendered `{slug,title,html}` help document.                   |

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
        "configuration": {
            "enabledQuestionCategoryIds": ["CAT_EVERYDAY"],
            "enabledDareTypeIds": ["DARE_SILLY"],
            "blockedOperationalFlags": [],
            "maximumIntensity": 3,
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
Returns `201` with `roomId`, six-character `roomCode`, `participantId`,
`participantCredential`, and role `HOST`.

### `POST /rooms/:roomCode/participants`

```json
{ "displayName": "Sam", "role": "PLAYER" }
```

Role is `PLAYER` or `DISPLAY`; HTTP cannot create another host. Returns the same join
credential shape with `201`. The room code is public and suitable for QR codes. The
participant credential is secret and must only be stored on the joining device.
Realtime play continues over WebSocket.

## Couch sessions

Couch sessions are single-device and server-authoritative. Runtime, shown-card history,
and the final ended state are persisted; an optional owned `groupId` applies durable
Group history. The request language selects the card locale. Endpoints use a session
UUID and optimistic `revision`.

| Method | Path                          | Body                                                                                |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------- |
| POST   | `/couch/sessions`             | Mode, 2–20 player names, canonical configuration, profile/group/adult confirmation. |
| GET    | `/couch/sessions/:id`         | none                                                                                |
| POST   | `/couch/sessions/:id/start`   | `{revision}`                                                                        |
| POST   | `/couch/sessions/:id/choose`  | `{revision,cardType}`                                                               |
| POST   | `/couch/sessions/:id/skip`    | `{revision}`                                                                        |
| POST   | `/couch/sessions/:id/advance` | `{revision}`                                                                        |
| POST   | `/couch/sessions/:id/vote`    | `{revision,playerId,vote}`                                                          |
| POST   | `/couch/sessions/:id/end`     | `{revision}`                                                                        |

Conflicts return `409` for stale revisions, invalid state, or an exhausted localized
card pool. Missing sessions return `404`.

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
hashed; clients must not persist them after use.

## DataSpace resources

`/groups` and `/game-settings` require an authenticated, owned current DataSpace.
Groups support `GET`, `POST`, `PUT /:id`, `DELETE /:id`, and confirmed
`POST /:id/history-reset`. Resetting history advances the Group's history cutoff; it
does not delete the Group or historical Session/CardAppearance records. Game settings support
`GET` and `PUT` for preferred profile, intensity, question ratio, conversation interval,
and optional default group. Resource IDs are UUIDs and are always authorization-scoped
to the selected DataSpace.
