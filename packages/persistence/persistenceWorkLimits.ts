/** Process-wide work budgets are configured before database initialization.
 * Reconfiguration changes limits only; it never resets in-flight work counters. */
const defaults = {
    cardConcurrentScans: 4,
    policyConcurrentDecodes: 2,
    storedJsonConcurrentCodecs: 4,
    policyInputCacheMaximumEntries: 128,
    policyInputMaximumBytes: 134217728,
    immutablePayloadCleanupBatchSize: 16,
};

export type PersistenceWorkLimits = Readonly<typeof defaults>;
export const DEFAULT_PERSISTENCE_WORK_LIMITS: PersistenceWorkLimits = Object.freeze(defaults);
let configured: PersistenceWorkLimits = DEFAULT_PERSISTENCE_WORK_LIMITS;

export function configurePersistenceWorkLimits(limits: PersistenceWorkLimits): void {
    configured = Object.freeze({
        cardConcurrentScans: limits.cardConcurrentScans,
        policyConcurrentDecodes: limits.policyConcurrentDecodes,
        storedJsonConcurrentCodecs: limits.storedJsonConcurrentCodecs,
        policyInputCacheMaximumEntries: limits.policyInputCacheMaximumEntries,
        policyInputMaximumBytes: limits.policyInputMaximumBytes,
        immutablePayloadCleanupBatchSize: limits.immutablePayloadCleanupBatchSize,
    });
}

export function persistenceWorkLimits(): PersistenceWorkLimits {
    return configured;
}
