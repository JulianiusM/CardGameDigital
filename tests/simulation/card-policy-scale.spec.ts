import { describe, expect, it } from "vitest";
import {
    GameSession,
    SequenceRandomSource,
    WeightedCardReservoir,
    type Card,
    type RandomSource,
} from "../../packages/game-core";
import { card, profile } from "../support/game";

const players = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
];
function metadata(): Card {
    const { cardText: _text, locale: _locale, ...value } = card({ id: "base" as never });
    return value;
}
function game(random: RandomSource = new SequenceRandomSource([0])) {
    return new GameSession(
        {
            id: "stream",
            mode: "CLASSIC_TRUTH_OR_DARE",
            players,
            profile: profile(),
            cardLocale: "en-GB",
        },
        random,
    );
}

describe("complete streaming Card selection", () => {
    it("can select the last eligible Card beyond 100,000 without retaining a catalog", async () => {
        const total = 100_001;
        let scanned = 0;
        let randomCalls = 0;
        const session = game({
            nextInt: () => 0,
            nextFloat: () => (++randomCalls === total ? 0.01 : 0.9),
        });
        async function* cards() {
            for (let i = 0; i < total; i++) {
                scanned++;
                yield { ...metadata(), id: String(i) as Card["id"] };
            }
        }
        expect((await session.chooseCardType(0, "QUESTION", cards())).id).toBe(String(total - 1));
        expect(scanned).toBe(total);
        expect(session.historyIndexSize).toBe(1);
        const json = JSON.stringify(session.toRuntimeState());
        expect(Buffer.byteLength(json)).toBeLessThan(5000);
        expect(json).not.toContain("cardText");
        expect(json).not.toContain("frozenCatalog");
    });

    it("reenters expired cooldowns with ordinary weight and no priority", async () => {
        let seed = 123456789;
        const random = {
            nextInt: () => 0,
            nextFloat: () => {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                return (seed + 0.5) / 4294967296;
            },
        };
        const expired = {
            ...metadata(),
            id: "expired" as Card["id"],
            repeatableInSession: true,
            repeatCooldown: 1,
            lastShownSequence: 1,
        };
        const fresh = { ...metadata(), id: "fresh" as Card["id"], lastShownSequence: null };
        let expiredWins = 0;
        for (let i = 0; i < 4000; i++) {
            const runtime = game().toRuntimeState();
            runtime.cardsShown = 2;
            const session = GameSession.restore(runtime, random);
            // Alternate order to cover both sides of a page boundary without priority.
            const cards = i % 2 ? [expired, fresh] : [fresh, expired];
            expiredWins += Number(
                (await session.chooseCardType(0, "QUESTION", cards)).id === expired.id,
            );
        }
        expect(expiredWins).toBeGreaterThan(1850);
        expect(expiredWins).toBeLessThan(2150);
        const beforeExpiry = game();
        expect(await beforeExpiry.remainingEligibleCardCount([expired, fresh])).toBe(1);
    });

    it("recomputes intensity and cooldown eligibility after each displayed Card", async () => {
        const session = new GameSession(
            {
                id: "progress",
                mode: "CLASSIC_TRUTH_OR_DARE",
                players,
                cardLocale: "en-GB",
                profile: profile({
                    intensityProgressionUnit: "CARDS",
                    intensityProgressionInterval: 1,
                    intensityProgressionIncrement: 4,
                }),
            },
            new SequenceRandomSource([0]),
        );
        const a = {
            ...metadata(),
            id: "a" as Card["id"],
            repeatableInSession: true,
            repeatCooldown: 1,
        };
        const b = { ...metadata(), id: "b" as Card["id"], intensity: 5 as const };
        const c = { ...metadata(), id: "c" as Card["id"], intensity: 5 as const };
        expect(await session.remainingEligibleCardCount([a, b, c])).toBe(1);
        await session.chooseCardType(0, "QUESTION", [a, b, c]);
        expect(await session.remainingEligibleCardCount([a, b, c])).toBe(2);
        await session.skipCard(1, [a, b, c]);
        expect(await session.remainingEligibleCardCount([a, b, c])).toBe(2);
    });

    it("bounds hot appearance state even after thousands of repeats", async () => {
        const session = game();
        const repeat = { ...metadata(), repeatableInSession: true, repeatCooldown: 0 };
        for (let i = 0; i < 2000; i++) {
            await session.chooseCardType(session.revision, "QUESTION", [repeat]);
            session.advance(session.revision);
        }
        expect(session.cardsShown).toBe(2000);
        expect(session.sessionHistory).toHaveLength(2);
        expect(session.historyIndexSize).toBe(1);
        expect(Buffer.byteLength(JSON.stringify(session.toRuntimeState()))).toBeLessThan(5000);
    });

    it("preserves weighted selection for extreme finite weights", () => {
        const reservoir = new WeightedCardReservoir();
        reservoir.add(
            { ...metadata(), id: "tiny" as never, weight: 1e-300 },
            new SequenceRandomSource([0.5]),
        );
        reservoir.add(
            { ...metadata(), id: "large" as never, weight: 1e300 },
            new SequenceRandomSource([0.5]),
        );
        expect(reservoir.selected?.id).toBe("large");
    });
});
