import { describe, expect, it, vi } from "vitest";
import { GameSession, SequenceRandomSource } from "../../packages/game-core";
import {
    SessionCache,
    SESSION_CACHE_BYTES,
    SESSION_CACHE_ENTRIES,
    SESSION_IDLE_TTL_MS,
    ENDED_EPHEMERAL_TTL_MS,
} from "../../packages/application/sessionCache";
import { withSessionCreationCapacity } from "../../packages/application/sessionCreationCapacity";
import { profile } from "../support/game";
import { CommandQueue } from "../../packages/application/commandQueue";
import { DEFAULT_GAME_RESOURCE_LIMITS } from "../../packages/application/gameResourceLimits";

function session(id: string) {
    return new GameSession(
        {
            id,
            mode: "CLASSIC_TRUTH_OR_DARE",
            players: [
                { id: "a", name: "A" },
                { id: "b", name: "B" },
            ],
            profile: profile(),
            cardLocale: "en-GB",
        },
        new SequenceRandomSource([0]),
    );
}

describe("Session resource admission", () => {
    it("enforces configured cache capacity and expiry without extending ended summaries", () => {
        vi.useFakeTimers();
        try {
            const cache = new SessionCache({
                ...DEFAULT_GAME_RESOURCE_LIMITS,
                sessionCacheMaximumEntries: 1,
                sessionIdleTtlSeconds: 3,
                endedTemporaryRetentionSeconds: 1,
            });
            const game = session("configured");
            cache.set(game.id, game, false);
            expect(() => cache.set("excess", session("excess"), false)).toThrow();
            game.end(game.revision);
            cache.set(game.id, game, false);
            vi.advanceTimersByTime(999);
            expect(cache.get(game.id)).toBe(game);
            vi.advanceTimersByTime(1);
            expect(cache.prune()).toBe(1);
            cache.set("idle", session("idle"), false);
            vi.advanceTimersByTime(3000);
            expect(cache.prune()).toBe(1);
            const small = new SessionCache({
                ...DEFAULT_GAME_RESOURCE_LIMITS,
                sessionCacheMaximumBytes: 1,
            });
            expect(() => small.set("large", session("large"), false)).toThrow();
            expect(small.statistics().bytes).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
    it("reclaims idle memory without another get/set and does not extend ended summaries on reads", () => {
        vi.useFakeTimers();
        try {
            const cache = new SessionCache();
            for (let cycle = 0; cycle < 20; cycle++) {
                for (let index = 0; index < 40; index++) {
                    const game = session(`${cycle}:${index}`);
                    cache.set(game.id, game, false);
                    game.end(game.revision);
                    cache.set(game.id, game, false);
                }
                vi.advanceTimersByTime(ENDED_EPHEMERAL_TTL_MS - 1);
                expect(cache.get(`${cycle}:0`)).toBeDefined();
                vi.advanceTimersByTime(1);
                expect(cache.prune()).toBe(40);
                expect(cache.statistics()).toEqual({ entries: 0, bytes: 0 });
            }
            cache.set("abandoned", session("abandoned"), false);
            vi.advanceTimersByTime(SESSION_IDLE_TTL_MS);
            expect(cache.prune()).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("bounds pending commands, reserves terminal work, and recovers after failure", async () => {
        const queue = new CommandQueue(2, 2);
        let finish!: () => void;
        const blocked = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const first = queue.run("game", () => blocked);
        const second = queue.run("game", async () => {
            throw new Error("commit failed");
        });
        const rejected = expect(second).rejects.toThrow("commit failed");
        await expect(queue.run("game", async () => undefined)).rejects.toMatchObject({
            code: "SESSION_CAPACITY_EXCEEDED",
        });
        const ended = queue.run("game", async () => "ended", true);
        finish();
        await first;
        await rejected;
        expect(await ended).toBe("ended");
        expect(await queue.run("game", async () => "new")).toBe("new");
    });
    it("evicts recoverable entries while preserving active ephemeral games", () => {
        const cache = new SessionCache();
        const active = session("active");
        cache.set("active", active, false);
        for (let index = 0; index < SESSION_CACHE_ENTRIES + 10; index++)
            cache.set(String(index), session(String(index)));
        expect(cache.get("active")).toBe(active);
        expect(cache.statistics().entries).toBeLessThanOrEqual(SESSION_CACHE_ENTRIES);
        expect(cache.statistics().bytes).toBeLessThanOrEqual(SESSION_CACHE_BYTES);
    });
    it("rejects excess ephemeral admission without losing games and reclaims idle games", () => {
        vi.useFakeTimers();
        try {
            const cache = new SessionCache();
            for (let i = 0; i < SESSION_CACHE_ENTRIES; i++)
                cache.set(String(i), session(String(i)), false);
            expect(() => cache.set("extra", session("extra"), false)).toThrow(
                "game.sessionCapacityExceeded",
            );
            expect(cache.get("0")).toBeDefined();
            vi.advanceTimersByTime(SESSION_IDLE_TTL_MS + 1);
            cache.set("extra", session("extra"), false);
            expect(cache.statistics().entries).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
    it("rejects excess start work before executing its callback", async () => {
        let finish!: () => void;
        const blocked = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const first = withSessionCreationCapacity(() => blocked, 3);
        const second = withSessionCreationCapacity(() => blocked, 3);
        const third = withSessionCreationCapacity(() => blocked, 3);
        let called = false;
        await expect(
            withSessionCreationCapacity(async () => {
                called = true;
            }, 3),
        ).rejects.toMatchObject({ code: "SESSION_CAPACITY_EXCEEDED" });
        expect(called).toBe(false);
        finish();
        await Promise.all([first, second, third]);
    });
});
