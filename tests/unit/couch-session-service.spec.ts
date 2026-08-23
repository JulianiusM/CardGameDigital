import { describe, expect, it } from "vitest";
import { CouchSessionService } from "../../src/packages/application/couchSessionService";
import type { CardRepository } from "../../src/packages/application/repositories";
import { CARD_TYPES, GAME_MODES, SequenceRandomSource } from "../../src/packages/game-core";
import { card } from "../support/game";
import { effectiveSettingsFromProfile } from "../../src/packages/application/roomGameSettings";

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
    card({ id: "meta" as never, cardType: CARD_TYPES.CONVERSATION, questionCategoryId: null }),
];
const repository: CardRepository = {
    isLocaleActive: async () => true,
    defaultLocale: async () => "en-GB",
    getById: async (id) => cards.find((entry) => entry.id === id) ?? null,
    listActive: async () => cards,
    findEligibleCandidates: async () => cards,
};
const input = (mode: (typeof GAME_MODES)[keyof typeof GAME_MODES]) => ({
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
            if (mode === GAME_MODES.CLASSIC) expect(snapshot.currentCard?.intensity).toBe(1);
            expect(await service.get(snapshot.id)).toEqual(snapshot);
        }
    });

    it("returns privacy-safe progress and aggregate-only anonymous results", async () => {
        const service = new CouchSessionService(repository, new SequenceRandomSource([0]));
        let snapshot = await service.create(input(GAME_MODES.NEVER_HAVE_I_EVER));
        snapshot = await service.startTurn(snapshot.id, 0);
        snapshot = await service.vote(snapshot.id, 1, snapshot.players[0].id, "YES");
        expect(snapshot.voteResult).toEqual({ yes: 1, no: 0, total: 1 });
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

    it("applies the selected profile and requires confirmation for adult profiles", async () => {
        const service = new CouchSessionService(repository, new SequenceRandomSource([0]));
        await expect(
            service.create({
                ...input(GAME_MODES.CLASSIC),
                profileId: "PROFILE_COUPLES_SPICY",
            }),
        ).rejects.toThrow("game.adultConfirmationRequired");
        expect(
            await service.create({
                ...input(GAME_MODES.CLASSIC),
                profileId: "PROFILE_COUPLES_SPICY",
                adultContentConfirmed: true,
            }),
        ).toMatchObject({ revision: 0 });
    });
});
