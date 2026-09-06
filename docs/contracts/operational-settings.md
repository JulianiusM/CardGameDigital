# Operational settings

These deployment settings are read through the existing environment/CSV settings
loader. Use `KEY,value` in `SETTINGS_FILE`; environment values override CSV values.
The normal `E2E_KEY` override remains available in the E2E runtime. Restart the
server to apply changes. Invalid values fail startup; they are never silently clamped.

Defaults retain the Phase 6 behavior. All values are finite, safe integers. Counts
and byte budgets are positive; explicitly documented extra terminal allowances may
be zero. Names ending in `_MS` use milliseconds; names ending in `_SECONDS` use
seconds. Node timer/window settings must be at most 2,147,483,647 ms. Retention
durations must fit integer millisecond arithmetic and the supported Date range.

The settings schema, environment names and defaults are maintained in
[operationalSettings.ts](../../apps/server/src/modules/operationalSettings.ts).
Application services receive only resource policy, without server credentials or
transport dependencies. Process-wide scan/codec budgets are configured before
database initialization, covering nested repositories and startup/terminal cleanup.

## Game lifetime, caches and persistence admission

| Setting                                 |   Default | Meaning                                                                                                                               |
| --------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_CACHE_MAXIMUM_ENTRIES`         |       128 | Entries per Room or Couch service cache.                                                                                              |
| `SESSION_CACHE_MAXIMUM_BYTES`           | 134217728 | Estimated data bytes per service cache; includes policy, history and roster accounting.                                               |
| `SESSION_IDLE_TTL_SECONDS`              |     86400 | Idle lifetime for an unsaved cached Couch game; inactivity before ending saved Couch runtime. Saved-game reads do not renew activity. |
| `ENDED_TEMPORARY_RETENTION_SECONDS`     |       900 | Ended unsaved Couch summary lifetime and grace period before purging ended temporary database records.                                |
| `ROOM_LIFETIME_SECONDS`                 |     86400 | Lifetime assigned to a newly created Room; existing persisted expiry timestamps remain authoritative.                                 |
| `SESSION_CONCURRENT_STARTS`             |         2 | Process-wide simultaneous Session starts, shared by Room and Couch services.                                                          |
| `COUCH_COMMAND_QUEUE_PER_GAME`          |        16 | Ordinary pending commands per Couch game.                                                                                             |
| `COUCH_COMMAND_QUEUE_MAXIMUM`           |       256 | Ordinary pending Couch commands per service.                                                                                          |
| `COUCH_COMMAND_QUEUE_TERMINAL_PER_GAME` |         2 | Extra end-command slots per Couch game; zero is permitted.                                                                            |
| `COUCH_COMMAND_QUEUE_TERMINAL_MAXIMUM`  |        16 | Extra end-command slots per Couch service; zero is permitted.                                                                         |
| `ROOM_COMMAND_QUEUE_PER_GAME`           |      1024 | Ordinary pending commands per Room.                                                                                                   |
| `ROOM_COMMAND_QUEUE_MAXIMUM`            |      2048 | Ordinary pending Room commands per service.                                                                                           |
| `ROOM_COMMAND_QUEUE_TERMINAL_PER_GAME`  |      1024 | Extra terminal/lifecycle slots per Room; must cover ROOM_MAX_PARTICIPANTS.                                                            |
| `ROOM_COMMAND_QUEUE_TERMINAL_MAXIMUM`   |      2048 | Extra terminal/lifecycle slots per service; must cover WEBSOCKET_MAXIMUM_CONNECTIONS.                                                 |
| `RETAINED_ROOM_CAPACITY`                |       256 | Database admission count: retained unowned Rooms plus open owned Rooms.                                                               |
| `SAVED_COUCH_CAPACITY`                  |       128 | Database admission count for active persisted Couch games.                                                                            |
| `TEMPORARY_ROOM_SESSION_CAPACITY`       |        32 | Retained Session records allowed in each unowned Room.                                                                                |
| `GAME_RETENTION_BATCH_SIZE`             |        16 | Maximum records per retention category in one maintenance pass.                                                                       |

## Shared persistence work

| Setting                                |   Default | Meaning                                                                                                              |
| -------------------------------------- | --------: | -------------------------------------------------------------------------------------------------------------------- |
| `CARD_CONCURRENT_SCANS`                |         4 | Process-wide concurrent metadata scans across all repositories, including policy previews.                           |
| `POLICY_CONCURRENT_DECODES`            |         2 | Process-wide uncached sparse-policy decodes; concurrent reads of one digest still share work.                        |
| `STORED_JSON_CONCURRENT_CODECS`        |         4 | Process-wide compressed runtime/settings JSON encodes or decodes.                                                    |
| `POLICY_INPUT_CACHE_MAXIMUM_ENTRIES`   |       128 | Weak-reference digest entries retained per database connection.                                                      |
| `POLICY_INPUT_MAXIMUM_BYTES`           | 134217728 | Uncompressed sparse-policy input bytes per shared blob, on write and recovery.                                       |
| `IMMUTABLE_PAYLOAD_CLEANUP_BATCH_SIZE` |        16 | Orphan payloads examined/deleted in each reference-safe collection pass, including terminal/account/catalog cleanup. |

## HTTP work, public quotas and realtime delivery

| Setting                                |  Default | Meaning                                                                                                            |
| -------------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------ |
| `GAME_MAINTENANCE_INTERVAL_MS`         |    60000 | Interval between non-overlapping maintenance ticks; startup also runs a pass.                                      |
| `GAME_HTTP_CONCURRENT_REQUESTS`        |        8 | Ordinary game HTTP requests admitted before body parsing; async work keeps its slot after disconnect.              |
| `GAME_HTTP_TERMINAL_REQUESTS`          |        2 | Extra HTTP slots for Couch end requests; zero is permitted.                                                        |
| `GAME_WORK_RETRY_AFTER_SECONDS`        |        1 | Retry-After guidance for HTTP in-flight admission rejection.                                                       |
| `POLICY_CONCURRENT_WORK`               |        2 | Concurrent policy preview/search/bulk operations.                                                                  |
| `POLICY_CONCURRENT_IMPORTS`            |        1 | Concurrent authenticated policy imports, including parsing and the completed transaction.                          |
| `RATE_LIMITER_MAXIMUM_KEYS`            |    10000 | Maximum identities retained by each bounded game/participant rate limiter.                                         |
| `GAME_CREATION_RATE_WINDOW_MS`         |   900000 | Window for shared Couch/Room creation quotas and the Room creation address guard.                                  |
| `GAME_CREATION_RATE_PER_PRINCIPAL`     |       60 | Couch/Room creation requests per account or anonymous address per creation window.                                 |
| `GAME_CREATION_RATE_PROCESS`           |      120 | Couch/Room creation requests process-wide per creation window.                                                     |
| `ROOM_CREATION_RATE_PER_ADDRESS`       |      120 | Room creation requests per source address per creation window.                                                     |
| `POLICY_RATE_WINDOW_MS`                |    60000 | Window for Card-policy request quotas.                                                                             |
| `POLICY_RATE_PER_PRINCIPAL`            |       60 | Card-policy requests per account or anonymous address per policy window.                                           |
| `POLICY_RATE_PER_ADDRESS`              |      600 | Card-policy requests per source address per policy window.                                                         |
| `POLICY_RATE_PROCESS`                  |      240 | Card-policy requests process-wide per policy window.                                                               |
| `COUCH_RATE_WINDOW_MS`                 |    60000 | Window for existing Couch game requests.                                                                           |
| `COUCH_RATE_PER_GAME`                  |      120 | Requests per existing Couch game per window; end remains exempt.                                                   |
| `ROOM_JOIN_RATE_WINDOW_MS`             |   900000 | Window for the Room join address guard.                                                                            |
| `ROOM_JOIN_RATE_PER_ADDRESS`           |     2000 | Room joins per source address per join window; size this for shared-LAN devices.                                   |
| `WEBSOCKET_MAXIMUM_CONNECTIONS`        |     2000 | Admitted simultaneous WebSocket connections process-wide.                                                          |
| `WEBSOCKET_CONCURRENT_AUTHENTICATIONS` |       32 | Concurrent admitted credential authentications.                                                                    |
| `WEBSOCKET_HELLO_TIMEOUT_MS`           |     5000 | Time to submit client.hello after connecting.                                                                      |
| `WEBSOCKET_AUTHENTICATION_TIMEOUT_MS`  |    30000 | Time allowed for an admitted authentication to finish.                                                             |
| `WEBSOCKET_QUEUED_MESSAGES`            |       32 | Pending incoming messages per socket.                                                                              |
| `WEBSOCKET_QUEUED_BYTES_PER_SOCKET`    |  8388608 | Queued incoming message bytes per socket; at least one complete v4 maximum message.                                |
| `WEBSOCKET_QUEUED_BYTES_PROCESS`       | 33554432 | Queued incoming message bytes process-wide; at least the per-socket budget.                                        |
| `WEBSOCKET_SEND_BYTES_PER_SOCKET`      |  8388608 | Buffered outgoing message bytes per socket; at least one complete v4 maximum message.                              |
| `WEBSOCKET_SEND_BYTES_PROCESS`         | 33554432 | Outstanding outgoing message bytes process-wide; at least the per-socket budget.                                   |
| `WEBSOCKET_BROADCAST_BATCH_PEERS`      |       16 | Recipients processed before yielding the broadcast to other I/O.                                                   |
| `WEBSOCKET_BROADCAST_BATCH_BYTES`      |  4194304 | Queued broadcast bytes before yielding; a complete message is still sent atomically.                               |
| `WEBSOCKET_REFRESH_COALESCE_MS`        |       50 | Delay for coalescing shared reconnect/voting refreshes; direct command replies remain immediate.                   |
| `WEBSOCKET_HEARTBEAT_INTERVAL_MS`      |     5000 | Transport ping/pong polling interval.                                                                              |
| `ROOM_RECONCILIATION_INTERVAL_MS`      |     1000 | Interval between persisted Room lifecycle reconciliation passes.                                                   |
| `WEBSOCKET_RATE_WINDOW_MS`             |    10000 | Public per-socket message rate window, including heartbeat messages.                                               |
| `WEBSOCKET_RATE_PER_SOCKET`            |       30 | Messages per socket per window under enforced public security.                                                     |
| `ROOM_COMMAND_RATE_WINDOW_MS`          |    60000 | Public participant-stable game-command rate window.                                                                |
| `ROOM_COMMAND_RATE_PER_PARTICIPANT`    |      120 | Game commands per participant per command window, across reconnects.                                               |
| `DEVICE_PAIRING_RATE_WINDOW_MS`        |   900000 | Public participant-stable device-pairing rate window.                                                              |
| `DEVICE_PAIRING_RATE_PER_PARTICIPANT`  |       10 | Device-player pairing changes per participant per pairing window.                                                  |
| `WEBSOCKET_HEARTBEAT_FAST_PATH_BYTES`  |     1024 | Maximum authenticated application-ping bytes inspected outside the game queue; cannot exceed the v4 message limit. |

## Valid combinations and compatibility

Per-service command capacities must cover their corresponding per-game capacities.
The same applies to terminal allowances. Room terminal allowances additionally cover
the configured participant/connection counts so overload can still record disconnects.
Global WebSocket input/output byte budgets must cover their per-socket budgets, and
each must allow a complete 4,194,304-byte v4 message. Rate windows apply only with
enforced public security; resource admission applies in all deployment modes.

Changing these settings does not alter HTTP payloads, WebSocket v4, authoritative
revisions, voting privacy, catalog lifetime or saved Group history. Protocol/schema
byte ceilings remain fixed: ordinary HTTP JSON and v4 messages allow 4 MiB, and
authenticated policy import allows 64 MiB. Configurable queue byte budgets control
buffered work rather than negotiating a smaller protocol receive capacity.

Storage format and SQL packet boundaries remain fixed: 24 KiB binary payload chunks,
512 KiB encoded hot JSON and 4 MiB decoded hot JSON. The 256-Card metadata page is
the existing full-stream selection implementation, not a catalog-size admission limit.
Benchmark latency/query/heap assertions are regression acceptance criteria, not
runtime quotas. Their previous measurements used the defaults.

Lowering admission capacities preserves existing records; additional games wait for
capacity. Lowering a retention duration applies to the original persisted activity/end
timestamps on the next pass, without giving games a new lease. A Room's lifetime is
assigned at creation, so changing its default affects new Rooms. Unsaved Couch games
still cannot survive a process restart. Saved appearances and Group history are not
automatically deleted.

Keep `POLICY_INPUT_MAXIMUM_BYTES` large enough for retained policy blobs when changing
deployment settings or restoring a backup; lowering it can reject recovery of an
existing larger blob. Cache byte estimates are admission accounting, not total RSS.
Raising work budgets requires corresponding CPU, memory, database and network capacity.

For example, a CSV configuration can retain idle Couch games for two days, retain ended
temporary records for half an hour, and admit more work:

```csv
SESSION_IDLE_TTL_SECONDS,172800
ENDED_TEMPORARY_RETENTION_SECONDS,1800
GAME_RETENTION_BATCH_SIZE,32
GAME_MAINTENANCE_INTERVAL_MS,30000
GAME_HTTP_CONCURRENT_REQUESTS,12
RETAINED_ROOM_CAPACITY,512
WEBSOCKET_MAXIMUM_CONNECTIONS,4000
ROOM_COMMAND_QUEUE_TERMINAL_MAXIMUM,4096
```
