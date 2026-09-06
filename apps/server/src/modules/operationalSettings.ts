import { z } from "zod";
import {
    DEFAULT_GAME_RESOURCE_LIMITS,
    type GameResourceLimits,
} from "../../../../packages/application/gameResourceLimits";
import { DEFAULT_PERSISTENCE_WORK_LIMITS } from "../../../../packages/persistence/persistenceWorkLimits";
import { MAX_WEBSOCKET_MESSAGE_BYTES } from "../../../../packages/protocol/limits";

const integer = z
    .union([z.number(), z.string().trim().min(1)])
    .transform(Number)
    .pipe(z.number().int().safe());
const positive = integer.pipe(z.number().positive());
const nonnegative = integer.pipe(z.number().nonnegative());
// Node timers clamp larger values to one millisecond; reject instead.
const timer = positive.pipe(z.number().max(2_147_483_647));
const seconds = positive.refine(
    (value) =>
        Number.isSafeInteger(value * 1000) &&
        Number.isFinite(new Date(Date.now() + value * 1000).getTime()),
    "must fit the clock and Date range",
);
const messageQueueBytes = positive.pipe(z.number().min(MAX_WEBSOCKET_MESSAGE_BYTES));

export const operationalSettingsDefaults = {
    ...DEFAULT_GAME_RESOURCE_LIMITS,
    ...DEFAULT_PERSISTENCE_WORK_LIMITS,
    gameMaintenanceIntervalMs: 60000,
    gameHttpConcurrentRequests: 8,
    gameHttpTerminalRequests: 2,
    gameWorkRetryAfterSeconds: 1,
    policyConcurrentWork: 2,
    policyConcurrentImports: 1,
    rateLimiterMaximumKeys: 10000,
    gameCreationRateWindowMs: 900000,
    gameCreationRatePerPrincipal: 60,
    gameCreationRateProcess: 120,
    roomCreationRatePerAddress: 120,
    policyRateWindowMs: 60000,
    policyRatePerPrincipal: 60,
    policyRatePerAddress: 600,
    policyRateProcess: 240,
    couchRateWindowMs: 60000,
    couchRatePerGame: 120,
    roomJoinRateWindowMs: 900000,
    roomJoinRatePerAddress: 2000,
    webSocketMaximumConnections: 2000,
    webSocketConcurrentAuthentications: 32,
    webSocketHelloTimeoutMs: 5000,
    webSocketAuthenticationTimeoutMs: 30000,
    webSocketQueuedMessages: 32,
    webSocketQueuedBytesPerSocket: 8388608,
    webSocketQueuedBytesProcess: 33554432,
    webSocketSendBytesPerSocket: 8388608,
    webSocketSendBytesProcess: 33554432,
    webSocketBroadcastBatchPeers: 16,
    webSocketBroadcastBatchBytes: 4194304,
    webSocketRefreshCoalesceMs: 50,
    webSocketHeartbeatIntervalMs: 5000,
    webSocketHeartbeatFastPathBytes: 1024,
    roomReconciliationIntervalMs: 1000,
    webSocketRateWindowMs: 10000,
    webSocketRatePerSocket: 30,
    roomCommandRateWindowMs: 60000,
    roomCommandRatePerParticipant: 120,
    devicePairingRateWindowMs: 900000,
    devicePairingRatePerParticipant: 10,
};

export const operationalSettingsShape = {
    sessionCacheMaximumEntries: positive,
    sessionCacheMaximumBytes: positive,
    sessionIdleTtlSeconds: seconds,
    endedTemporaryRetentionSeconds: seconds,
    roomLifetimeSeconds: seconds,
    sessionConcurrentStarts: positive,
    couchCommandQueuePerGame: positive,
    couchCommandQueueMaximum: positive,
    couchCommandQueueTerminalPerGame: nonnegative,
    couchCommandQueueTerminalMaximum: nonnegative,
    roomCommandQueuePerGame: positive,
    roomCommandQueueMaximum: positive,
    roomCommandQueueTerminalPerGame: nonnegative,
    roomCommandQueueTerminalMaximum: nonnegative,
    retainedRoomCapacity: positive,
    savedCouchCapacity: positive,
    temporaryRoomSessionCapacity: positive,
    gameRetentionBatchSize: positive,
    cardConcurrentScans: positive,
    policyConcurrentDecodes: positive,
    storedJsonConcurrentCodecs: positive,
    policyInputCacheMaximumEntries: positive,
    policyInputMaximumBytes: positive,
    immutablePayloadCleanupBatchSize: positive,
    gameMaintenanceIntervalMs: timer,
    gameHttpConcurrentRequests: positive,
    gameHttpTerminalRequests: nonnegative,
    gameWorkRetryAfterSeconds: seconds,
    policyConcurrentWork: positive,
    policyConcurrentImports: positive,
    rateLimiterMaximumKeys: positive,
    gameCreationRateWindowMs: timer,
    gameCreationRatePerPrincipal: positive,
    gameCreationRateProcess: positive,
    roomCreationRatePerAddress: positive,
    policyRateWindowMs: timer,
    policyRatePerPrincipal: positive,
    policyRatePerAddress: positive,
    policyRateProcess: positive,
    couchRateWindowMs: timer,
    couchRatePerGame: positive,
    roomJoinRateWindowMs: timer,
    roomJoinRatePerAddress: positive,
    webSocketMaximumConnections: positive,
    webSocketConcurrentAuthentications: positive,
    webSocketHelloTimeoutMs: timer,
    webSocketAuthenticationTimeoutMs: timer,
    webSocketQueuedMessages: positive,
    webSocketQueuedBytesPerSocket: messageQueueBytes,
    webSocketQueuedBytesProcess: messageQueueBytes,
    webSocketSendBytesPerSocket: messageQueueBytes,
    webSocketSendBytesProcess: messageQueueBytes,
    webSocketBroadcastBatchPeers: positive,
    webSocketBroadcastBatchBytes: positive,
    webSocketRefreshCoalesceMs: timer,
    webSocketHeartbeatIntervalMs: timer,
    webSocketHeartbeatFastPathBytes: positive.pipe(z.number().max(MAX_WEBSOCKET_MESSAGE_BYTES)),
    roomReconciliationIntervalMs: timer,
    webSocketRateWindowMs: timer,
    webSocketRatePerSocket: positive,
    roomCommandRateWindowMs: timer,
    roomCommandRatePerParticipant: positive,
    devicePairingRateWindowMs: timer,
    devicePairingRatePerParticipant: positive,
};

export const operationalSettingsKeys = {
    SESSION_CACHE_MAXIMUM_ENTRIES: "sessionCacheMaximumEntries",
    SESSION_CACHE_MAXIMUM_BYTES: "sessionCacheMaximumBytes",
    SESSION_IDLE_TTL_SECONDS: "sessionIdleTtlSeconds",
    ENDED_TEMPORARY_RETENTION_SECONDS: "endedTemporaryRetentionSeconds",
    ROOM_LIFETIME_SECONDS: "roomLifetimeSeconds",
    SESSION_CONCURRENT_STARTS: "sessionConcurrentStarts",
    COUCH_COMMAND_QUEUE_PER_GAME: "couchCommandQueuePerGame",
    COUCH_COMMAND_QUEUE_MAXIMUM: "couchCommandQueueMaximum",
    COUCH_COMMAND_QUEUE_TERMINAL_PER_GAME: "couchCommandQueueTerminalPerGame",
    COUCH_COMMAND_QUEUE_TERMINAL_MAXIMUM: "couchCommandQueueTerminalMaximum",
    ROOM_COMMAND_QUEUE_PER_GAME: "roomCommandQueuePerGame",
    ROOM_COMMAND_QUEUE_MAXIMUM: "roomCommandQueueMaximum",
    ROOM_COMMAND_QUEUE_TERMINAL_PER_GAME: "roomCommandQueueTerminalPerGame",
    ROOM_COMMAND_QUEUE_TERMINAL_MAXIMUM: "roomCommandQueueTerminalMaximum",
    RETAINED_ROOM_CAPACITY: "retainedRoomCapacity",
    SAVED_COUCH_CAPACITY: "savedCouchCapacity",
    TEMPORARY_ROOM_SESSION_CAPACITY: "temporaryRoomSessionCapacity",
    GAME_RETENTION_BATCH_SIZE: "gameRetentionBatchSize",
    CARD_CONCURRENT_SCANS: "cardConcurrentScans",
    POLICY_CONCURRENT_DECODES: "policyConcurrentDecodes",
    STORED_JSON_CONCURRENT_CODECS: "storedJsonConcurrentCodecs",
    POLICY_INPUT_CACHE_MAXIMUM_ENTRIES: "policyInputCacheMaximumEntries",
    POLICY_INPUT_MAXIMUM_BYTES: "policyInputMaximumBytes",
    IMMUTABLE_PAYLOAD_CLEANUP_BATCH_SIZE: "immutablePayloadCleanupBatchSize",
    GAME_MAINTENANCE_INTERVAL_MS: "gameMaintenanceIntervalMs",
    GAME_HTTP_CONCURRENT_REQUESTS: "gameHttpConcurrentRequests",
    GAME_HTTP_TERMINAL_REQUESTS: "gameHttpTerminalRequests",
    GAME_WORK_RETRY_AFTER_SECONDS: "gameWorkRetryAfterSeconds",
    POLICY_CONCURRENT_WORK: "policyConcurrentWork",
    POLICY_CONCURRENT_IMPORTS: "policyConcurrentImports",
    RATE_LIMITER_MAXIMUM_KEYS: "rateLimiterMaximumKeys",
    GAME_CREATION_RATE_WINDOW_MS: "gameCreationRateWindowMs",
    GAME_CREATION_RATE_PER_PRINCIPAL: "gameCreationRatePerPrincipal",
    GAME_CREATION_RATE_PROCESS: "gameCreationRateProcess",
    ROOM_CREATION_RATE_PER_ADDRESS: "roomCreationRatePerAddress",
    POLICY_RATE_WINDOW_MS: "policyRateWindowMs",
    POLICY_RATE_PER_PRINCIPAL: "policyRatePerPrincipal",
    POLICY_RATE_PER_ADDRESS: "policyRatePerAddress",
    POLICY_RATE_PROCESS: "policyRateProcess",
    COUCH_RATE_WINDOW_MS: "couchRateWindowMs",
    COUCH_RATE_PER_GAME: "couchRatePerGame",
    ROOM_JOIN_RATE_WINDOW_MS: "roomJoinRateWindowMs",
    ROOM_JOIN_RATE_PER_ADDRESS: "roomJoinRatePerAddress",
    WEBSOCKET_MAXIMUM_CONNECTIONS: "webSocketMaximumConnections",
    WEBSOCKET_CONCURRENT_AUTHENTICATIONS: "webSocketConcurrentAuthentications",
    WEBSOCKET_HELLO_TIMEOUT_MS: "webSocketHelloTimeoutMs",
    WEBSOCKET_AUTHENTICATION_TIMEOUT_MS: "webSocketAuthenticationTimeoutMs",
    WEBSOCKET_QUEUED_MESSAGES: "webSocketQueuedMessages",
    WEBSOCKET_QUEUED_BYTES_PER_SOCKET: "webSocketQueuedBytesPerSocket",
    WEBSOCKET_QUEUED_BYTES_PROCESS: "webSocketQueuedBytesProcess",
    WEBSOCKET_SEND_BYTES_PER_SOCKET: "webSocketSendBytesPerSocket",
    WEBSOCKET_SEND_BYTES_PROCESS: "webSocketSendBytesProcess",
    WEBSOCKET_BROADCAST_BATCH_PEERS: "webSocketBroadcastBatchPeers",
    WEBSOCKET_BROADCAST_BATCH_BYTES: "webSocketBroadcastBatchBytes",
    WEBSOCKET_REFRESH_COALESCE_MS: "webSocketRefreshCoalesceMs",
    WEBSOCKET_HEARTBEAT_INTERVAL_MS: "webSocketHeartbeatIntervalMs",
    WEBSOCKET_HEARTBEAT_FAST_PATH_BYTES: "webSocketHeartbeatFastPathBytes",
    ROOM_RECONCILIATION_INTERVAL_MS: "roomReconciliationIntervalMs",
    WEBSOCKET_RATE_WINDOW_MS: "webSocketRateWindowMs",
    WEBSOCKET_RATE_PER_SOCKET: "webSocketRatePerSocket",
    ROOM_COMMAND_RATE_WINDOW_MS: "roomCommandRateWindowMs",
    ROOM_COMMAND_RATE_PER_PARTICIPANT: "roomCommandRatePerParticipant",
    DEVICE_PAIRING_RATE_WINDOW_MS: "devicePairingRateWindowMs",
    DEVICE_PAIRING_RATE_PER_PARTICIPANT: "devicePairingRatePerParticipant",
} satisfies Record<string, keyof typeof operationalSettingsDefaults>;

export function validateOperationalSettings(
    value: typeof operationalSettingsDefaults & { roomMaximumParticipants: number },
    context: z.RefinementCtx,
): void {
    const atLeast = (
        key: keyof typeof operationalSettingsDefaults,
        minimum: number,
        reason: string,
    ) => {
        if (value[key] < minimum)
            context.addIssue({ code: "custom", path: [key], message: reason });
    };
    atLeast(
        "couchCommandQueueMaximum",
        value.couchCommandQueuePerGame,
        "must cover the per-game Couch queue",
    );
    atLeast(
        "roomCommandQueueMaximum",
        value.roomCommandQueuePerGame,
        "must cover the per-Room queue",
    );
    atLeast(
        "couchCommandQueueTerminalMaximum",
        value.couchCommandQueueTerminalPerGame,
        "must cover the per-game terminal allowance",
    );
    atLeast(
        "roomCommandQueueTerminalMaximum",
        value.webSocketMaximumConnections,
        "must reserve disconnect cleanup for WEBSOCKET_MAXIMUM_CONNECTIONS",
    );
    atLeast(
        "roomCommandQueueTerminalMaximum",
        value.roomCommandQueueTerminalPerGame,
        "must cover the per-Room terminal allowance",
    );
    atLeast(
        "roomCommandQueueTerminalPerGame",
        value.roomMaximumParticipants,
        "must reserve disconnect cleanup for ROOM_MAX_PARTICIPANTS",
    );
    atLeast(
        "webSocketQueuedBytesProcess",
        value.webSocketQueuedBytesPerSocket,
        "must cover one socket input budget",
    );
    atLeast(
        "webSocketSendBytesProcess",
        value.webSocketSendBytesPerSocket,
        "must cover one socket send budget",
    );
}

/** Pass only non-secret resource policy into application and persistence objects. */
export function gameResourceLimits(value: GameResourceLimits): GameResourceLimits {
    return {
        sessionCacheMaximumEntries: value.sessionCacheMaximumEntries,
        sessionCacheMaximumBytes: value.sessionCacheMaximumBytes,
        sessionIdleTtlSeconds: value.sessionIdleTtlSeconds,
        endedTemporaryRetentionSeconds: value.endedTemporaryRetentionSeconds,
        roomLifetimeSeconds: value.roomLifetimeSeconds,
        sessionConcurrentStarts: value.sessionConcurrentStarts,
        couchCommandQueuePerGame: value.couchCommandQueuePerGame,
        couchCommandQueueMaximum: value.couchCommandQueueMaximum,
        couchCommandQueueTerminalPerGame: value.couchCommandQueueTerminalPerGame,
        couchCommandQueueTerminalMaximum: value.couchCommandQueueTerminalMaximum,
        roomCommandQueuePerGame: value.roomCommandQueuePerGame,
        roomCommandQueueMaximum: value.roomCommandQueueMaximum,
        roomCommandQueueTerminalPerGame: value.roomCommandQueueTerminalPerGame,
        roomCommandQueueTerminalMaximum: value.roomCommandQueueTerminalMaximum,
        retainedRoomCapacity: value.retainedRoomCapacity,
        savedCouchCapacity: value.savedCouchCapacity,
        temporaryRoomSessionCapacity: value.temporaryRoomSessionCapacity,
        gameRetentionBatchSize: value.gameRetentionBatchSize,
    };
}
