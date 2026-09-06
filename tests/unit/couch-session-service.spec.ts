import type { TestCardRepository as CardRepository } from "../support/game";
import { testCatalogAccess } from "../support/game";
import { describe, expect, it } from "vitest";
import { CouchSessionService } from "../../packages/application/couchSessionService";
import { DEFAULT_GAME_RESOURCE_LIMITS } from "../../packages/application/gameResourceLimits";
import type { CouchSessionRepository } from "../../packages/application/repositories";
import {
    CARD_TYPES,
    GAME_MODES,
    SequenceRandomSource,
    type GameSessionRuntimeState,
} from "../../packages/game-core";
import { card } from "../support/game";
import { effectiveSettingsFromProfile } from "../../packages/application/roomGameSettings";
const cards = [
    card({ id: "q" as never, intensity: 3, repeatableInSession: true }),
    card({ id: "yes" as never, yesNoAnswerPossible: true, repeatableInSession: true }),
    card({
        id: "d" as never,
        cardType: CARD_TYPES.DARE,
        questionCategoryId: null,
        dareTypeId: "DARE_SILLY",
        repeatableInSession: true,
    }),
    card({ id: "meta" as never, cardType: CARD_TYPES.CONVERSATION_META, questionCategoryId: null }),
];
const repository: CardRepository = {
    isLocaleActive: async () => true,
    defaultLocale: async () => "en-GB",
    getById: async (id) => cards.find((entry) => entry.id === id) ?? null,
    ...testCatalogAccess,
    listActive: async () => cards,
    findEligibleCandidates: async () => cards,
};
const input = (mode: (typeof GAME_MODES)[keyof typeof GAME_MODES]) => ({
    persistence: "EPHEMERAL" as const,
    mode,
    players: [{ name: "Anna" }, { name: "Ben" }],
    configuration: {
        ...effectiveSettingsFromProfile("PROFILE_FRIENDS"),
        letsTalkMetaInterval: 2,
    },
    profileId: "PROFILE_FRIENDS",
    adultContentConfirmed: false,
    cardLocale: "en-GB",
});
describe("CouchSessionService", () => {
    it("injects the configured cache admission policy without losing the active game", async () => {
        const service = new CouchSessionService(
            repository,
            new SequenceRandomSource([0]),
            undefined,
            undefined,
            undefined,
            { ...DEFAULT_GAME_RESOURCE_LIMITS, sessionCacheMaximumEntries: 1 },
        );
        const first = await service.create(input(GAME_MODES.CLASSIC));
        await expect(service.create(input(GAME_MODES.CLASSIC))).rejects.toMatchObject({
            code: "SESSION_CAPACITY_EXCEEDED",
        });
        expect((await service.get(first.id)).id).toBe(first.id);
    });
    it("validates and applies an ordered per-game Card fallback policy", async () => {
        let localization: Parameters<CardRepository["listActive"]>[0] | undefined;
        const observingRepository: CardRepository = {
            ...repository,
            ...testCatalogAccess,
            listActive: async (policy) => {
                localization = policy;
                return cards;
            },
        };
        const service = new CouchSessionService(observingRepository, new SequenceRandomSource([0]));
        const created = await service.create({
            ...input(GAME_MODES.CLASSIC),
            cardFallbackEnabled: true,
            cardFallbackLocales: ["fr-FR", "de-DE"],
        });
        expect(localization).toEqual({
            locale: "en-GB",
            missingTranslation: "FALLBACK",
            fallbackLocales: ["fr-FR", "de-DE"],
        });
        expect(created.settings).toMatchObject({
            cardFallbackEnabled: true,
            cardFallbackLocales: ["fr-FR", "de-DE"],
        });
        await expect(
            service.create({
                ...input(GAME_MODES.CLASSIC),
                cardFallbackEnabled: true,
                cardFallbackLocales: ["en-GB"],
            }),
        ).rejects.toMatchObject({ code: "CARD_LOCALE_UNAVAILABLE" });
    });
    it("rejects a one-player Couch session in the application/domain path", async () => {
        const service = new CouchSessionService(repository, new SequenceRandomSource([0]));
        await expect(
            service.create({ ...input(GAME_MODES.CLASSIC), players: [{ name: "Solo" }] }),
        ).rejects.toThrow("game.minimumPlayers");
    });
    it("keeps Couch Sessions authoritative on the server for every game mode", async () => {
        for (const mode of Object.values(GAME_MODES)) {
            const service = new CouchSessionService(repository, new SequenceRandomSource([0]));
            let snapshot = await service.create(input(mode));
            expect(snapshot.revision).toBe(0);
            snapshot =
                mode === GAME_MODES.CLASSIC
                    ? await service.chooseCardType(
                          snapshot.id,
                          snapshot.revision,
                          CARD_TYPES.QUESTION,
                      )
                    : await service.startTurn(snapshot.id, snapshot.revision);
            expect(snapshot.revision).toBe(1);
            expect(snapshot.currentCard).not.toBeNull();
            if (mode === GAME_MODES.CLASSIC) {
                expect(snapshot.currentCard).toMatchObject({
                    cardIntensity: 3,
                    intensity: 1,
                });
            }
            expect(await service.get(snapshot.id)).toEqual(snapshot);
        }
    });
    it("returns privacy-safe progress and aggregate-only anonymous results", async () => {
        const service = new CouchSessionService(repository, new SequenceRandomSource([0]));
        let snapshot = await service.create(input(GAME_MODES.NEVER_HAVE_I_EVER));
        snapshot = await service.startTurn(snapshot.id, 0);
        snapshot = await service.vote(snapshot.id, 1, snapshot.players[0].id, "YES");
        expect(snapshot.voteResult).toEqual({ yes: 0, no: 0, total: 0 });
        expect(snapshot.votedPlayerIds).toEqual([snapshot.players[0].id]);
        expect(snapshot.neverHaveIEverVoting?.progress.map(({ status }) => status)).toEqual([
            "VOTED",
            "PENDING",
        ]);
        expect(snapshot.neverHaveIEverVoting?.result).toBeNull();
        expect(JSON.stringify(snapshot)).not.toContain('"YES"');
        snapshot = await service.vote(snapshot.id, 2, snapshot.players[1].id, "NO");
        expect(snapshot.neverHaveIEverVoting?.result).toEqual({ yes: 1, no: 1, total: 2 });
    });
    it("reveals named answers only after every Couch voter has answered", async () => {
        const service = new CouchSessionService(repository, new SequenceRandomSource([0]));
        let snapshot = await service.create({
            ...input(GAME_MODES.NEVER_HAVE_I_EVER),
            neverHaveIEverRevealMode: "NAMED_ANSWERS",
        });
        expect(snapshot.settings).toMatchObject({
            mode: GAME_MODES.NEVER_HAVE_I_EVER,
            profileId: "PROFILE_FRIENDS",
            cardLocale: "en-GB",
            neverHaveIEverRevealMode: "NAMED_ANSWERS",
        });
        snapshot = await service.startTurn(snapshot.id, 0);
        snapshot = await service.vote(snapshot.id, 1, snapshot.players[0].id, "YES");
        expect(JSON.stringify(snapshot.neverHaveIEverVoting)).not.toContain('"YES"');
        snapshot = await service.vote(snapshot.id, 2, snapshot.players[1].id, "NO");
        expect(snapshot.neverHaveIEverVoting?.result?.namedAnswers).toEqual([
            { playerId: snapshot.players[0].id, displayName: "Anna", vote: "YES" },
            { playerId: snapshot.players[1].id, displayName: "Ben", vote: "NO" },
        ]);
    });
    it("allows a Spicy label edited down to a non-adult configuration", async () => {
        const service = new CouchSessionService(repository, new SequenceRandomSource([0]));
        await expect(
            service.create({
                ...input(GAME_MODES.CLASSIC),
                profileId: "PROFILE_SPICY",
            }),
        ).resolves.toMatchObject({ revision: 0 });
        expect(
            await service.create({
                ...input(GAME_MODES.CLASSIC),
                profileId: "PROFILE_SPICY",
                adultContentConfirmed: true,
            }),
        ).toMatchObject({ revision: 0 });
    });
    it("keeps the cached Session unchanged when persistence rejects a command", async () => {
        let stored: GameSessionRuntimeState | null = null;
        let rejectNextSave = false;
        const persistence: CouchSessionRepository = {
            revision: async () => stored?.revision ?? null,
            load: async () => stored,
            ownerDataSpaceId: async () => "00000000-0000-4000-8000-000000000001" as never,
            save: async (runtime) => {
                if (rejectNextSave) {
                    rejectNextSave = false;
                    throw new Error("persistence unavailable");
                }
                stored = structuredClone(runtime);
            },
        };
        const service = new CouchSessionService(
            repository,
            new SequenceRandomSource([0]),
            undefined,
            persistence,
        );
        const created = await service.create({
            ...input(GAME_MODES.CLASSIC),
            persistence: "DATASPACE",
            dataSpaceId: "00000000-0000-4000-8000-000000000001" as never,
        });
        rejectNextSave = true;
        await expect(
            service.chooseCardType(created.id, created.revision, CARD_TYPES.QUESTION),
        ).rejects.toThrow("persistence unavailable");
        expect(await service.get(created.id)).toEqual(created);
        expect((stored as GameSessionRuntimeState | null)?.revision).toBe(created.revision);
        const committed = await service.chooseCardType(
            created.id,
            created.revision,
            CARD_TYPES.QUESTION,
        );
        expect(committed.revision).toBe(created.revision + 1);
    });
    it("serializes concurrent commands for the same Couch Session", async () => {
        const service = new CouchSessionService(repository, new SequenceRandomSource([0]));
        const created = await service.create(input(GAME_MODES.RANDOM));
        const results = await Promise.allSettled([
            service.startTurn(created.id, created.revision),
            service.startTurn(created.id, created.revision),
        ]);
        expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
        expect((await service.get(created.id)).revision).toBe(created.revision + 1);
    });
});
