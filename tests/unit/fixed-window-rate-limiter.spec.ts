import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../../apps/server/src/modules/fixedWindowRateLimiter";

describe("FixedWindowRateLimiter", () => {
    it("shares a limit by stable key and resets only after the window", () => {
        const limiter = new FixedWindowRateLimiter(1_000, 2);

        expect(limiter.consume("participant", 0)).toBe(true);
        expect(limiter.consume("participant", 100)).toBe(true);
        expect(limiter.consume("participant", 999)).toBe(false);
        expect(limiter.consume("other", 999)).toBe(true);
        expect(limiter.consume("participant", 1_000)).toBe(true);
    });
});
