import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { CardPolicyRepository } from "../../src/packages/application/cardPolicyRepository";
import { CardPolicyService } from "../../src/packages/application/cardPolicyService";
import type { CardPolicyRule, PlayableCard } from "../../src/packages/game-core";
import { card, profile } from "../support/game";
import {
    encodeCompiledCardPolicySnapshot,
    encodeGroupHistorySnapshot,
    SESSION_PAYLOAD_CHUNK_BYTES,
} from "../../src/packages/persistence/sessionImmutablePayloadStore";

const repository = {
    catalogProvenance: async () => ({
        catalogId: "scale-test",
        sequence: 1,
        catalogVersion: "scale-test-1",
        contract: "game-card-catalog/v2",
        artifactDigest: "0".repeat(64),
    }),
} as unknown as CardPolicyRepository;

function cards(count: number): PlayableCard[] {
    return Array.from({ length: count }, (_, index) =>
        card({
            id: `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}` as never,
            intensity: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
            cardText: `Scale Card ${index}`,
        }),
    );
}

function rules(): CardPolicyRule[] {
    return Array.from({ length: 200 }, (_, index) => {
        const intensity = ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5;
        return {
            id: `20000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
            name: `Scale rule ${index}`,
            order: index * 10,
            enabled: true,
            predicate: { minimumIntensity: intensity, maximumIntensity: intensity },
            directives: { weight: { mode: "SET", value: (index % 7) + 1 } },
        };
    });
}

async function compile(count: number) {
    const service = new CardPolicyService(repository);
    const started = performance.now();
    const compiled = await service.compileSessionCards({
        cards: cards(count),
        profile: profile(),
        sessionPolicy: {
            scopeDefault: {},
            conditionalRules: rules(),
            exactCards: [],
        },
    });
    return { compiled, elapsed: performance.now() - started };
}

describe("Card-policy scale", () => {
    it("compiles 10,000 Cards with hundreds of rules inside the setup-time budget", async () => {
        const { compiled, elapsed } = await compile(10_000);
        expect(compiled.cards).toHaveLength(10_000);
        expect(elapsed).toBeLessThan(5_000);
    }, 10_000);

    it("compiles 50,000 Cards once and keeps draw lookup constant-time", async () => {
        const { compiled, elapsed } = await compile(50_000);
        expect(compiled.cards).toHaveLength(50_000);
        expect(elapsed).toBeLessThan(20_000);

        const ids = compiled.cards.map(({ id }) => id);
        const entriesById = new Map(compiled.snapshot.cards.map((entry) => [entry[0], entry]));
        const lookupStarted = performance.now();
        let checksum = 0;
        for (let index = 0; index < 100_000; index++) {
            checksum += entriesById.get(ids[index % ids.length])![4];
        }
        expect(checksum).toBeGreaterThan(0);
        expect(performance.now() - lookupStarted).toBeLessThan(250);
        expect(JSON.stringify(compiled.snapshot).length).toBeLessThan(5 * 1024 * 1024);
        const encoded = encodeCompiledCardPolicySnapshot(compiled.snapshot);
        expect(encoded.chunks.length).toBeGreaterThan(1);
        expect(encoded.compressedByteLength).toBeLessThan(encoded.uncompressedByteLength);
        expect(
            Math.max(...encoded.chunks.map((chunk) => Buffer.byteLength(chunk, "utf8"))),
        ).toBeLessThanOrEqual(Math.ceil(SESSION_PAYLOAD_CHUNK_BYTES / 3) * 4);

        const groupHistory = encodeGroupHistorySnapshot(
            compiled.snapshot,
            encoded.digest,
            ids.filter((_, index) => index % 2 === 0),
        );
        expect(groupHistory.uncompressedByteLength).toBeLessThan(10_000);
        expect(
            Math.max(...groupHistory.chunks.map((chunk) => Buffer.byteLength(chunk, "utf8"))),
        ).toBeLessThanOrEqual(Math.ceil(SESSION_PAYLOAD_CHUNK_BYTES / 3) * 4);
    }, 30_000);
});
