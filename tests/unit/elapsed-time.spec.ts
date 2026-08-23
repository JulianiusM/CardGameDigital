import { describe, expect, it } from "vitest";
import { elapsedMinutes } from "../../apps/web/src/elapsedTime";

describe("elapsed Session time", () => {
    it("uses the authoritative Session start instead of client observation time", () => {
        const now = Date.UTC(2026, 7, 23, 12, 5, 10);
        expect(elapsedMinutes(now - 4 * 60_000 - 35_000, now)).toBe(5);
        expect(elapsedMinutes(now - 20_000, now)).toBe(1);
    });
});
