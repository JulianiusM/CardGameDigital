import { describe, expect, it } from "vitest";
import { CryptoRandomSource } from "../../src/packages/application/cryptoRandomSource";

describe("production randomness adapter", () => {
    it("returns values within the domain contract", () => {
        const source = new CryptoRandomSource();
        for (let index = 0; index < 100; index++) {
            expect(source.nextInt(7)).toBeGreaterThanOrEqual(0);
            expect(source.nextInt(7)).toBeLessThan(7);
            expect(source.nextFloat()).toBeGreaterThanOrEqual(0);
            expect(source.nextFloat()).toBeLessThan(1);
        }
    });
});
