import { describe, expect, it } from "vitest";
import { updateLinkedRange } from "../../apps/web/src/linkedRange";

describe("linked range controls", () => {
    it("moves start down with an end handle that crosses it", () => {
        expect(updateLinkedRange({ start: 4, end: 5 }, "end", 3, 1, 5)).toEqual({
            start: 3,
            end: 3,
        });
    });

    it("moves end up with a start handle that crosses it", () => {
        expect(updateLinkedRange({ start: 1, end: 2 }, "start", 4, 1, 5)).toEqual({
            start: 4,
            end: 4,
        });
    });

    it("keeps both handles independently adjustable across the complete range", () => {
        expect(updateLinkedRange({ start: 2, end: 4 }, "start", 1, 1, 5)).toEqual({
            start: 1,
            end: 4,
        });
        expect(updateLinkedRange({ start: 2, end: 4 }, "end", 5, 1, 5)).toEqual({
            start: 2,
            end: 5,
        });
    });
});
