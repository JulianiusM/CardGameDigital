/** Defaults for library consumers. The server injects validated deployment settings. */
const defaults = {
    sessionCacheMaximumEntries: 128,
    sessionCacheMaximumBytes: 134217728,
    sessionIdleTtlSeconds: 86400,
    endedTemporaryRetentionSeconds: 900,
    roomLifetimeSeconds: 86400,
    sessionConcurrentStarts: 2,
    couchCommandQueuePerGame: 16,
    couchCommandQueueMaximum: 256,
    couchCommandQueueTerminalPerGame: 2,
    couchCommandQueueTerminalMaximum: 16,
    roomCommandQueuePerGame: 1024,
    roomCommandQueueMaximum: 2048,
    roomCommandQueueTerminalPerGame: 1024,
    roomCommandQueueTerminalMaximum: 2048,
    retainedRoomCapacity: 256,
    savedCouchCapacity: 128,
    temporaryRoomSessionCapacity: 32,
    gameRetentionBatchSize: 16,
};

export type GameResourceLimits = Readonly<typeof defaults>;
export const DEFAULT_GAME_RESOURCE_LIMITS: GameResourceLimits = Object.freeze(defaults);
