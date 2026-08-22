import { describe, expect, it } from "vitest";
import { CouchSessionService } from "../../src/packages/application/couchSessionService";
import type { CardRepository } from "../../src/packages/application/repositories";
import { CARD_TYPES, GAME_MODES, SequenceRandomSource } from "../../src/packages/game-core";
import { card } from "../support/game";

const cards = [
    card({ id: "q" as never, repeatableInSession: true }),
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
    getById: async (id) => cards.find((entry) => entry.id === id) ?? null,
    listActive: async () => cards,
    findEligibleCandidates: async () => cards,
};
const input = (mode: (typeof GAME_MODES)[keyof typeof GAME_MODES]) => ({
    mode,
    players: [{ name: "Anna" }, { name: "Ben" }],
    maximumIntensity: 3 as const,
    randomQuestionRatio: 0.6,
    letsTalkMetaInterval: 2,
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
            expect(await service.get(snapshot.id)).toEqual(snapshot);
        }
    });

    it("returns only aggregate vote results while retaining vote progress", async () => {
        const service = new CouchSessionService(repository, new SequenceRandomSource([0]));
        let snapshot = await service.create(input(GAME_MODES.NEVER_HAVE_I_EVER));
        snapshot = await service.startTurn(snapshot.id, 0);
        snapshot = await service.vote(snapshot.id, 1, snapshot.players[0].id, "YES");
        expect(snapshot.voteResult).toEqual({ yes: 1, no: 0, total: 1 });
        expect(snapshot.votedPlayerIds).toEqual([snapshot.players[0].id]);
        expect(JSON.stringify(snapshot)).not.toContain('"YES"');
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
