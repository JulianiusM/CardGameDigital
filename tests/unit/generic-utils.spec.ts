import { describe, expect, it } from "vitest";
import { jsonReplacer, mergeUnique, normalizeToArray } from "../../src/modules/lib/util";

describe("generic collection utilities", () => {
    it("normalizes, merges and serializes without domain coupling", () => {
        expect(normalizeToArray("one")).toEqual(["one"]);
        expect(mergeUnique([1, 2], [2, 3])).toEqual([1, 2, 3]);
        expect(JSON.stringify(new Map([["answer", 42]]), jsonReplacer)).toContain(
            '"dataType":"Map"',
        );
    });
});
