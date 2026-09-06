import { MESSAGE_KEYS } from "../localization/keys";
import type { GameSession } from "../game-core";
import { DEFAULT_GAME_RESOURCE_LIMITS, type GameResourceLimits } from "./gameResourceLimits";

export const SESSION_CACHE_BYTES = DEFAULT_GAME_RESOURCE_LIMITS.sessionCacheMaximumBytes;
export const SESSION_CACHE_ENTRIES = DEFAULT_GAME_RESOURCE_LIMITS.sessionCacheMaximumEntries;
export const SESSION_IDLE_TTL_MS = DEFAULT_GAME_RESOURCE_LIMITS.sessionIdleTtlSeconds * 1000;
export const ENDED_EPHEMERAL_TTL_MS =
    DEFAULT_GAME_RESOURCE_LIMITS.endedTemporaryRetentionSeconds * 1000;
const policySizes = new WeakMap<object, number>();

function weight(session: GameSession): number {
    let policyBytes = policySizes.get(session.sessionCardPolicy);
    if (policyBytes === undefined) {
        policyBytes = new TextEncoder().encode(
            JSON.stringify(session.sessionCardPolicy),
        ).byteLength;
        policySizes.set(session.sessionCardPolicy, policyBytes);
    }
    // Conservative accounting includes sparse policy and history index overhead. This is an admission budget, not a claim about exact heap bytes.
    return (
        64 * 1024 +
        session.historyIndexSize * 128 +
        policySnapshotWeight(session.policySnapshot) +
        session.sessionHistory.length * 256 +
        session.players.length * 1024 +
        policyBytes * 3
    );
}

export class SessionCache {
    private readonly entries = new Map<
        string,
        {
            session: GameSession;
            persistent: boolean;
            bytes: number;
            accessedAt: number;
            endedAt: number | null;
        }
    >();
    private bytes = 0;
    constructor(
        private readonly limits: GameResourceLimits = DEFAULT_GAME_RESOURCE_LIMITS,
        private readonly onEvict: (id: string) => void = () => undefined,
    ) {}

    get(id: string): GameSession | undefined {
        const entry = this.entries.get(id);
        if (!entry) return undefined;
        if (this.expired(entry, Date.now())) {
            this.delete(id);
            this.onEvict(id);
            return undefined;
        }
        entry.accessedAt = Date.now();
        this.entries.delete(id);
        this.entries.set(id, entry);
        return entry.session;
    }

    set(id: string, session: GameSession, persistent = true): void {
        this.prune();
        const bytes = weight(session);
        const previous = this.entries.get(id);
        let total = this.bytes - (previous?.bytes ?? 0) + bytes;
        let count = this.entries.size + Number(!previous);
        const evict: string[] = [];
        for (const [candidate, entry] of this.entries) {
            if (
                total <= this.limits.sessionCacheMaximumBytes &&
                count <= this.limits.sessionCacheMaximumEntries
            )
                break;
            if (candidate === id || (!entry.persistent && entry.session.state !== "ENDED"))
                continue;
            evict.push(candidate);
            total -= entry.bytes;
            count--;
        }
        if (
            total > this.limits.sessionCacheMaximumBytes ||
            count > this.limits.sessionCacheMaximumEntries
        ) {
            if (persistent) {
                this.delete(id);
                return;
            }
            throw Object.assign(new Error(MESSAGE_KEYS.GAME_SESSION_CAPACITY_EXCEEDED), {
                code: "SESSION_CAPACITY_EXCEEDED",
                status: 429,
            });
        }
        for (const candidate of evict) {
            this.delete(candidate);
            this.onEvict(candidate);
        }
        this.delete(id);
        this.entries.set(id, {
            session,
            persistent,
            bytes,
            accessedAt: Date.now(),
            endedAt: session.state === "ENDED" ? (previous?.endedAt ?? Date.now()) : null,
        });
        this.bytes += bytes;
    }

    /** Called by maintenance even when no further game requests arrive. */
    prune(at = Date.now()): number {
        let removed = 0;
        for (const [id, entry] of this.entries) {
            if (!this.expired(entry, at)) continue;
            this.delete(id);
            this.onEvict(id);
            removed++;
        }
        return removed;
    }

    private expired(
        entry: { persistent: boolean; accessedAt: number; endedAt: number | null },
        at: number,
    ): boolean {
        if (!entry.persistent && entry.endedAt !== null)
            return at - entry.endedAt >= this.limits.endedTemporaryRetentionSeconds * 1000;
        return at - entry.accessedAt >= this.limits.sessionIdleTtlSeconds * 1000;
    }

    delete(id: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        this.bytes -= entry.bytes;
        this.entries.delete(id);
    }

    statistics() {
        return { entries: this.entries.size, bytes: this.bytes };
    }
}

function policySnapshotWeight(snapshot: GameSession["policySnapshot"]): number {
    if (!snapshot) return 0;
    let bytes = policySizes.get(snapshot);
    if (bytes !== undefined) return bytes;
    bytes = 0;
    for (const scope of [snapshot.dataSpace, snapshot.group]) {
        if (!scope) continue;
        bytes += JSON.stringify(scope.scopeDefault).length * 6;
        for (const rule of scope.conditionalRules) bytes += JSON.stringify(rule).length * 6;
        for (const exact of scope.exactCards) bytes += JSON.stringify(exact).length * 6 + 128;
    }
    policySizes.set(snapshot, bytes);
    return bytes;
}
