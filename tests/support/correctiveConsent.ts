import { TypeOrmCardRepository } from "../../packages/persistence/TypeOrmCardRepository";
import { testCatalogAccess } from "./game";
import type { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";
import { CouchSessionService } from "../../packages/application/couchSessionService";
import { RoomService } from "../../packages/application/roomService";
import { CardPolicyService } from "../../packages/application/cardPolicyService";
import {
    defaultRoomGameSettings,
    effectiveSettingsFromProfile,
    roomSettingsGameProfile,
    type RoomGameSettings,
} from "../../packages/application/roomGameSettings";
import {
    CARD_TYPES,
    DARE_TYPES,
    GAME_MODES,
    GameSession,
    SequenceRandomSource,
    type CardId,
    type DataSpaceId,
    type GameMode,
    type PlayableCard,
} from "../../packages/game-core";
import { TypeOrmRealtimeRoomRepository } from "../../packages/persistence/TypeOrmRealtimeRoomRepository";
import { TypeOrmCouchSessionRepository } from "../../packages/persistence/TypeOrmCouchSessionRepository";
import { TypeOrmCardPolicyRepository } from "../../packages/persistence/TypeOrmCardPolicyRepository";
import { CardEntity } from "../../packages/persistence/entities/card/CardEntity";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { boundaries, card } from "./game";
import { expectHiddenVotingAnswers } from "./votingPrivacy";
export function correctiveConsentTests(getSource: () => DataSource): void {
    async function fixture(mode: GameMode = GAME_MODES.CLASSIC) {
        const source = getSource();
        const stored = await source
            .getRepository(CardEntity)
            .find({ take: 4, select: { id: true } });
        const playable = [
            card({ id: stored[0].id as CardId, yesNoAnswerPossible: true }),
            card({
                id: stored[1].id as CardId,
                cardType: CARD_TYPES.DARE,
                questionCategoryId: null,
                dareTypeId: DARE_TYPES.SILLY,
            }),
            card({
                id: stored[2].id as CardId,
                cardType: CARD_TYPES.DARE,
                questionCategoryId: null,
                dareTypeId: DARE_TYPES.SEX,
                socialSensitivity: "EXPLICIT",
            }),
            card({
                id: stored[3].id as CardId,
                cardType: CARD_TYPES.DARE,
                questionCategoryId: null,
                dareTypeId: DARE_TYPES.TOUCH,
            }),
        ];
        let selected: readonly PlayableCard[] = playable;
        const cards = {
            ...testCatalogAccess,
            catalogProvenance: () =>
                new TypeOrmCardRepository(source.getRepository(CardEntity)).catalogProvenance(),
            async *scan(
                localization: import("../../packages/application/repositories").CardLocalizationPolicy,
                history?: import("../../packages/game-core").CardHistoryContext | null,
            ) {
                const selected = new Map((await this.listActive()).map((card) => [card.id, card]));
                const stored = new TypeOrmCardRepository(source.getRepository(CardEntity));
                for await (const candidate of stored.scan(
                    { locale: await stored.defaultLocale(), missingTranslation: "EXCLUDE" },
                    history,
                )) {
                    const card = selected.get(candidate.id);
                    if (card)
                        yield {
                            ...card,
                            lastShownSequence: candidate.lastShownSequence,
                            seenInGroup: candidate.seenInGroup,
                        };
                }
            },
            listActive: async () => selected,
            getById: async (id: CardId) => selected.find((card) => card.id === id) ?? null,
            defaultLocale: async () => "de-DE",
            isLocaleActive: async () => true,
            findEligibleCandidates: async () => selected,
        };
        const repository = new TypeOrmRealtimeRoomRepository(source);
        const couchRepository = new TypeOrmCouchSessionRepository(source);
        const policies = new CardPolicyService(new TypeOrmCardPolicyRepository(source));
        const random = () => new SequenceRandomSource([0]);
        const service = new RoomService(
            repository,
            cards,
            random(),
            undefined,
            undefined,
            policies,
        );
        const couch = new CouchSessionService(
            cards,
            random(),
            undefined,
            couchRepository,
            policies,
        );
        const space = await source
            .getRepository(DataSpace)
            .save({ name: "Consent regression", defaultForOwner: false });
        const settings: RoomGameSettings = { ...defaultRoomGameSettings(), mode };
        async function room(overrides: Partial<RoomGameSettings> = {}) {
            const joined = await service.createRoom("Host", space.id, {
                ...settings,
                ...overrides,
            });
            const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
            const displayJoin = await service.joinRoom(joined.roomCode, "Screen", "DISPLAY");
            const host = (await service.authenticate(
                joined.roomCode,
                joined.participantCredential,
            ))!;
            const player = (await service.authenticate(
                joined.roomCode,
                playerJoin.participantCredential,
            ))!;
            const display = (await service.authenticate(
                joined.roomCode,
                displayJoin.participantCredential,
            ))!;
            return {
                joined,
                host,
                player,
                display,
                start: () =>
                    service.execute(joined.roomId, host, {
                        type: "command.startSession",
                        revision: null,
                        payload: {},
                    }),
            };
        }
        return {
            source,
            cards,
            playable,
            policies,
            random,
            service,
            couch,
            repository,
            couchRepository,
            room,
            settings,
            select: (cards: readonly PlayableCard[]) => {
                selected = cards;
            },
            createCouch: (overrides: Partial<RoomGameSettings> = {}) =>
                couch.create({
                    ...settings,
                    ...overrides,
                    persistence: "DATASPACE",
                    dataSpaceId: space.id as DataSpaceId,
                    players: [{ name: "Host" }, { name: "Player" }],
                }),
        };
    }
    describe("corrective consent and refusal", () => {
        it.each(["COUCH", "ROOM"] as const)(
            "%s gates effective adult settings in every supported locale",
            async (topology) => {
                const f = await fixture();
                const create = async (settings: Partial<RoomGameSettings>) =>
                    topology === "COUCH"
                        ? f.createCouch(settings)
                        : (await f.room(settings)).start();
                for (const cardLocale of ["de-DE", "en-GB", "en-US"]) {
                    for (const profileId of ["PROFILE_CUSTOM", "PROFILE_FRIENDS"]) {
                        const settings = {
                            profileId,
                            cardLocale,
                            configuration: effectiveSettingsFromProfile("PROFILE_SPICY"),
                        };
                        await expect(create(settings)).rejects.toThrow(/adultConfirmationRequired/);
                        await expect(
                            create({ ...settings, adultContentConfirmed: true }),
                        ).resolves.toBeDefined();
                    }
                    await expect(create({ cardLocale })).resolves.toBeDefined();
                }
            },
        );
        it.each(["COUCH", "ROOM"] as const)(
            "%s accounts for policy availability and sensitivity overrides",
            async (topology) => {
                const f = await fixture();
                const create = async (settings: Partial<RoomGameSettings>) =>
                    topology === "COUCH"
                        ? f.createCouch(settings)
                        : (await f.room(settings)).start();
                const adult = {
                    ...f.settings,
                    profileId: "PROFILE_CUSTOM",
                    configuration: effectiveSettingsFromProfile("PROFILE_SPICY"),
                };
                const excluded = {
                    ...adult,
                    cardPolicy: {
                        ...adult.cardPolicy,
                        exactCards: [
                            {
                                cardId: f.playable[2].id,
                                directives: { availability: "EXCLUDE" as const },
                            },
                        ],
                    },
                };
                await expect(create(excluded)).resolves.toBeDefined();
                const downgraded = {
                    ...adult,
                    configuration: {
                        ...adult.configuration,
                        maximumSocialSensitivity: "GENERAL" as const,
                    },
                    cardPolicy: {
                        ...adult.cardPolicy,
                        scopeDefault: {
                            socialSensitivity: { mode: "SET" as const, value: "GENERAL" as const },
                        },
                    },
                };
                await expect(create(downgraded)).rejects.toThrow(/adultConfirmationRequired/);
                const preview = await f.policies.eligibilityPreview({
                    cards: f.playable,
                    profile: roomSettingsGameProfile(downgraded),
                    sessionPolicy: downgraded.cardPolicy,
                    mode: downgraded.mode,
                    playerCount: 2,
                    groupHistoryCardIds: new Set(),
                });
                expect(preview.adultConfirmationRequired).toBe(true);
                f.select([f.playable[0]]);
                await expect(
                    create({
                        ...adult,
                        cardPolicy: {
                            ...adult.cardPolicy,
                            scopeDefault: { socialSensitivity: { mode: "SET", value: "EXPLICIT" } },
                        },
                    }),
                ).rejects.toThrow(/adultConfirmationRequired/);
            },
        );
        for (const mode of Object.values(GAME_MODES)) {
            it.each(["COUCH", "SKIP", "VETO"] as const)(
                `${mode} commits exhausted %s without retaining the refused Card or votes`,
                async (action) => {
                    const f = await fixture(mode);
                    f.select([f.playable[0]]);
                    if (action === "COUCH") {
                        let snapshot = await f.createCouch();
                        snapshot =
                            mode === GAME_MODES.CLASSIC
                                ? await f.couch.chooseCardType(
                                      snapshot.id,
                                      snapshot.revision,
                                      CARD_TYPES.QUESTION,
                                  )
                                : await f.couch.startTurn(snapshot.id, snapshot.revision);
                        if (mode === GAME_MODES.NEVER_HAVE_I_EVER)
                            snapshot = await f.couch.vote(
                                snapshot.id,
                                snapshot.revision,
                                snapshot.players[0].id,
                                "YES",
                            );
                        const refused = await f.couch.skip(snapshot.id, snapshot.revision);
                        expect(refused).toMatchObject({
                            revision: snapshot.revision + 1,
                            currentCard: null,
                            remainingCardCount: 0,
                        });
                        expectHiddenVotingAnswers(refused);
                        expect(await f.couchRepository.load(snapshot.id)).toMatchObject({
                            votes: [],
                            voterIds: [],
                            sessionHistory: [{ skipped: true, vetoed: false, completed: false }],
                        });
                        expect((await f.couch.end(snapshot.id, refused.revision)).state).toBe(
                            "ENDED",
                        );
                        return;
                    }
                    const r = await f.room();
                    const started = await r.start();
                    const chooser =
                        started.session!.activePlayer?.id === r.player.id ? r.player : r.host;
                    let shown = await f.service.execute(
                        r.joined.roomId,
                        chooser,
                        mode === GAME_MODES.CLASSIC
                            ? {
                                  type: "command.chooseCardType",
                                  revision: 0,
                                  payload: { cardType: "QUESTION" },
                              }
                            : { type: "command.startTurn", revision: 0, payload: {} },
                    );
                    if (mode === GAME_MODES.NEVER_HAVE_I_EVER)
                        shown = await f.service.execute(r.joined.roomId, r.host, {
                            type: "command.submitVote",
                            revision: shown.session!.revision,
                            payload: { vote: "YES" },
                        });
                    const refused = await f.service.execute(
                        r.joined.roomId,
                        action === "VETO" ? r.player : r.host,
                        {
                            type: action === "VETO" ? "command.vetoCard" : "command.skipCard",
                            revision: shown.session!.revision,
                            payload: {},
                        },
                    );
                    for (const viewer of [r.host, r.player, r.display]) {
                        const snapshot = await f.service.snapshot(r.joined.roomId, viewer);
                        expect(snapshot.session).toMatchObject({
                            revision: shown.session!.revision + 1,
                            currentCard: null,
                            remainingCardCount: 0,
                        });
                        expectHiddenVotingAnswers(snapshot);
                    }
                    expect(await f.repository.loadRuntime(r.joined.roomId)).toMatchObject({
                        votes: [],
                        voterIds: [],
                        sessionHistory: [
                            {
                                skipped: action === "SKIP",
                                vetoed: action === "VETO",
                                completed: false,
                            },
                        ],
                    });
                    await f.service.execute(r.joined.roomId, r.host, {
                        type: "command.endSession",
                        revision: refused.session!.revision,
                        payload: {},
                    });
                },
            );
        }
        it("enrolls private choices atomically, freezes current voters and applies exclusions to the next group Card after reload", async () => {
            const f = await fixture(GAME_MODES.NEVER_HAVE_I_EVER);
            const r = await f.room();
            await r.start();
            await f.service.execute(r.joined.roomId, r.host, {
                type: "command.startTurn",
                revision: 0,
                payload: {},
            });
            const joined = await f.service.joinRoom(r.joined.roomCode, "Late", "PLAYER");
            const late = (await f.service.authenticate(
                joined.roomCode,
                joined.participantCredential,
            ))!;
            expect((await f.service.snapshot(joined.roomId, late)).session?.players).toHaveLength(
                2,
            );
            const command = {
                type: "command.setBoundaries" as const,
                revision: null,
                payload: {
                    disabledQuestionCategoryIds: [],
                    disabledDareTypeIds: [DARE_TYPES.SILLY],
                    blockedOperationalFlags: [],
                },
            };
            const enrolled = await f.service.execute(joined.roomId, late, command);
            expect(enrolled.session?.players).toHaveLength(3);
            expect(enrolled.session?.neverHaveIEverVoting?.progress).toHaveLength(2);
            expect(enrolled.session?.availableActions).not.toContain("SUBMIT_VOTE");
            await expect(f.service.execute(joined.roomId, late, command)).rejects.toThrow(
                /boundariesLocked/,
            );
            for (const viewer of [r.host, r.player, r.display, late]) {
                const serialized = JSON.stringify(await f.service.snapshot(joined.roomId, viewer));
                expect(serialized).not.toContain("disabledDareTypeIds");
            }
            const persisted = (await f.repository.loadRuntime(joined.roomId))!;
            expect(persisted.boundariesByPlayer).toContainEqual([
                late.id,
                {
                    disabledQuestionCategoryIds: [],
                    disabledDareTypeIds: [DARE_TYPES.SILLY],
                    blockedOperationalFlags: [],
                },
            ]);
            const restarted = new RoomService(f.repository, f.cards, f.random());
            const reconnected = (await restarted.authenticate(
                joined.roomCode,
                joined.participantCredential,
            ))!;
            expect(
                (await restarted.snapshot(joined.roomId, reconnected)).session?.neverHaveIEverVoting
                    ?.progress,
            ).toHaveLength(2);
        });
        it("serializes a next-Card draw behind enrollment and applies every represented player's exclusions", async () => {
            const f = await fixture();
            const r = await f.room({
                configuration: { ...f.settings.configuration, startingIntensity: 3 },
            });
            const started = await r.start();
            const chooser = started.session!.activePlayer!.id === r.host.id ? r.host : r.player;
            const joined = await f.service.joinRoom(r.joined.roomCode, "Late", "PLAYER");
            const extraId = "362a1748-ab5f-4d75-84da-9b18d9b62620";
            await f.repository.saveDevicePlayers(joined.participantId, [
                { id: extraId, name: "Extra" },
            ]);
            const late = (await f.service.authenticate(
                joined.roomCode,
                joined.participantCredential,
            ))!;
            await expect(
                f.service.execute(joined.roomId, late, {
                    type: "command.vetoCard",
                    revision: 0,
                    payload: {},
                }),
            ).rejects.toThrow(/enrollmentRequired/);
            const [enrolled, drawn] = await Promise.all([
                f.service.execute(joined.roomId, late, {
                    type: "command.setBoundaries",
                    revision: null,
                    payload: {
                        disabledQuestionCategoryIds: [],
                        disabledDareTypeIds: [DARE_TYPES.SILLY],
                        blockedOperationalFlags: [],
                    },
                }),
                f.service.execute(joined.roomId, chooser, {
                    type: "command.chooseCardType",
                    revision: 1,
                    payload: { cardType: "DARE" },
                }),
            ]);
            expect(enrolled.session!.revision).toBe(1);
            expect(drawn.session!.currentCard!.id).toBe(f.playable[3].id);
            const runtime = (await f.repository.loadRuntime(joined.roomId))!;
            expect(runtime.players).toHaveLength(4);
            for (const id of [late.id, extraId])
                expect(runtime.boundariesByPlayer).toContainEqual([
                    id,
                    {
                        disabledQuestionCategoryIds: [],
                        disabledDareTypeIds: [DARE_TYPES.SILLY],
                        blockedOperationalFlags: [],
                    },
                ]);
        });
        it("rejects stale or terminal enrollment without saving boundaries or publishing an expanded roster", async () => {
            const f = await fixture();
            const r = await f.room();
            await r.start();
            const joined = await f.service.joinRoom(r.joined.roomCode, "Late", "PLAYER");
            const late = (await f.service.authenticate(
                joined.roomCode,
                joined.participantCredential,
            ))!;
            const current = (await f.repository.loadRuntime(joined.roomId))!;
            const proposed = GameSession.restore(current, f.random());
            const choices = boundaries({ disabledDareTypeIds: new Set([DARE_TYPES.SILLY]) });
            proposed.addPlayers(
                current.revision,
                [{ id: late.id, name: late.displayName }],
                new Map([[late.id, choices]]),
            );
            const draw = GameSession.restore(current, f.random());
            await draw.chooseCardType(current.revision, CARD_TYPES.QUESTION, f.playable);
            await f.repository.commitRuntime(
                joined.roomId,
                current.revision,
                draw.toRuntimeState(),
            );
            await expect(
                f.repository.commitRuntime(
                    joined.roomId,
                    current.revision,
                    proposed.toRuntimeState(),
                    { enrollment: { participantId: late.id, boundaries: choices } },
                ),
            ).rejects.toMatchObject({ code: "STALE_SESSION_REVISION" });
            expect((await f.repository.listBoundaries(joined.roomId)).has(late.id)).toBe(false);
            expect((await f.repository.loadRuntime(joined.roomId))!.players).toHaveLength(2);
            const retry = GameSession.restore(draw.toRuntimeState(), f.random());
            retry.addPlayers(
                draw.revision,
                [{ id: late.id, name: late.displayName }],
                new Map([[late.id, choices]]),
            );
            const invalidHistory = retry.toRuntimeState();
            invalidHistory.sessionHistory.push({
                ...invalidHistory.sessionHistory[0],
                sequence: 2,
                cardId: "ffffffff-ffff-4fff-8fff-ffffffffffff" as CardId,
            });
            // Force a failure after saving the enrollment row and runtime CAS, proving rollback.
            await expect(
                f.repository.commitRuntime(joined.roomId, draw.revision, invalidHistory, {
                    enrollment: { participantId: late.id, boundaries: choices },
                }),
            ).rejects.toThrow();
            expect((await f.repository.listBoundaries(joined.roomId)).has(late.id)).toBe(false);
            expect((await f.repository.loadRuntime(joined.roomId))!.players).toHaveLength(2);
            await f.repository.applyLifecycleTransition({
                type: "LEAVE",
                roomId: joined.roomId,
                participantId: late.id,
                at: Date.now(),
            });
            await expect(
                f.repository.commitRuntime(
                    joined.roomId,
                    draw.revision,
                    { ...proposed.toRuntimeState(), revision: draw.revision + 1 },
                    { enrollment: { participantId: late.id, boundaries: choices } },
                ),
            ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
            expect((await f.repository.listBoundaries(joined.roomId)).has(late.id)).toBe(false);
        });
    });
}
