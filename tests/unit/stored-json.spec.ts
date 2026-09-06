import { describe, expect, it } from "vitest";
import {
    MAXIMUM_STORED_JSON_BYTES,
    readStoredJson,
    writeStoredJson,
} from "../../packages/persistence/storedJson";
import { largeRuntime } from "../support/largeRuntime";
import {
    configurePersistenceWorkLimits,
    persistenceWorkLimits,
} from "../../packages/persistence/persistenceWorkLimits";

describe("bounded hot JSON storage", () => {
    it("uses the configured codec budget and releases it after compression", async () => {
        const previous = persistenceWorkLimits();
        configurePersistenceWorkLimits({ ...previous, storedJsonConcurrentCodecs: 1 });
        const payload = { value: "x".repeat(70_000) };
        const first = writeStoredJson(payload);
        try {
            await expect(writeStoredJson(payload)).rejects.toMatchObject({
                code: "SESSION_CAPACITY_EXCEEDED",
            });
            const stored = await first;
            expect(await readStoredJson(stored)).toEqual(payload);
        } finally {
            await first;
            configurePersistenceWorkLimits(previous);
        }
    });
    it("round-trips a maximum roster and boundaries without a large SQL value", async () => {
        const runtime = largeRuntime();
        expect(Buffer.byteLength(JSON.stringify(runtime))).toBeGreaterThan(256 * 1024);
        const stored = await writeStoredJson(runtime);
        expect(Buffer.byteLength(stored)).toBeLessThan(MAXIMUM_STORED_JSON_BYTES);
        expect(JSON.parse(stored).$encoding).toBe("brotli-json/v1");
        expect(await readStoredJson(stored)).toEqual(runtime);
    });

    it("leaves small records as ordinary JSON and rejects corrupt envelopes", async () => {
        expect(await writeStoredJson({ version: 7, state: "ENDED" })).toBe(
            '{"version":7,"state":"ENDED"}',
        );
        const stored = JSON.parse(await writeStoredJson(largeRuntime()));
        stored.digest = "0".repeat(64);
        await expect(readStoredJson(JSON.stringify(stored))).rejects.toThrow("digest or length");
        stored.bytes = 4 * 1024 * 1024 + 1;
        await expect(readStoredJson(JSON.stringify(stored))).rejects.toThrow("encoding");
    });
});
