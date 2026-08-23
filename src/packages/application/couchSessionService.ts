import { MESSAGE_KEYS } from "../localization/keys";
import { randomUUID } from "node:crypto";
import {
    GameSession,
    type GameMode,
    CARD_TYPES,
    globalCardIntensityLevel,
    type DataSpaceId,
} from "../game-core";
import {
    DEFAULT_CARD_TRANSLATION_POLICY,
    type CardLocalizationPolicy,
    type CardRepository,
    type CouchSessionRepository,
} from "./repositories";
import type { RandomSource } from "../game-core";
import {
    profileRequiresAdultConfirmation,
    roomSettingsGameProfile,
    type EffectiveGameSettings,
} from "./roomGameSettings";
import {
    projectNeverHaveIEverVoting,
    type NeverHaveIEverVotingProjection,
} from "./neverHaveIEverVoting";
import { NEVER_HAVE_I_EVER_REVEAL_MODES, type NeverHaveIEverRevealMode } from "../game-core";

export type CreateCouchSession = {
    mode: GameMode;
    players: readonly { name: string }[];
    configuration: EffectiveGameSettings;
    profileId: string;
    adultContentConfirmed: boolean;
    cardLocale: string;
    neverHaveIEverRevealMode?: NeverHaveIEverRevealMode;
    groupId?: string | null;
    dataSpaceId?: DataSpaceId;
};

export type CouchSessionSnapshot = {
    id: string;
    startedAt: number;
    mode: GameMode;
    revision: number;
    state: string;
    roundNumber: number;
    activePlayer: { id: string; name: string } | null;
    players: readonly { id: string; name: string }[];
    currentCard: {
        id: string;
        cardText: string;
        cardType: string;
        intensity: number;
        questionCategoryId: string | null;
        dareTypeId: string | null;
    } | null;
    cardsShown: number;
    voteResult: { yes: number; no: number; total: number };
    votedPlayerIds: readonly string[];
    neverHaveIEverVoting: NeverHaveIEverVotingProjection | null;
    settings: {
        mode: GameMode;
        profileId: string;
        cardLocale: string;
        neverHaveIEverRevealMode: NeverHaveIEverRevealMode;
        configuration: EffectiveGameSettings;
    };
};

export class CouchSessionNotFoundError extends Error {
    readonly code = "SESSION_NOT_FOUND";
    constructor() {
        super(MESSAGE_KEYS.GAME_SESSION_NOT_FOUND);
    }
}

export class CouchSessionService {
    private readonly sessions = new Map<string, GameSession>();
    constructor(
        private readonly cards: CardRepository,
        private readonly random: RandomSource,
        private readonly cardTranslationPolicy: Pick<
            CardLocalizationPolicy,
            "missingTranslation" | "fallbackLocale"
        > = DEFAULT_CARD_TRANSLATION_POLICY,
        private readonly repository?: CouchSessionRepository,
    ) {}

    defaultCardLocale(): Promise<string> {
        return this.cards.defaultLocale();
    }

    async create(input: CreateCouchSession): Promise<CouchSessionSnapshot> {
        if (!(await this.cards.isLocaleActive(input.cardLocale))) {
            throw Object.assign(new Error(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE), {
                code: "CARD_LOCALE_UNAVAILABLE",
            });
        }
        if (profileRequiresAdultConfirmation(input.profileId) && !input.adultContentConfirmed) {
            throw Object.assign(new Error(MESSAGE_KEYS.GAME_ADULT_CONFIRMATION_REQUIRED), {
                code: "VALIDATION_ERROR",
            });
        }
        const gameProfile = roomSettingsGameProfile({
            mode: input.mode,
            profileId: input.profileId,
            groupId: input.groupId ?? null,
            adultContentConfirmed: input.adultContentConfirmed,
            cardLocale: input.cardLocale,
            neverHaveIEverRevealMode:
                input.neverHaveIEverRevealMode ??
                NEVER_HAVE_I_EVER_REVEAL_MODES.ANONYMOUS_AGGREGATE,
            configuration: input.configuration,
        });
        const groupHistoryCardIds =
            input.groupId && input.dataSpaceId && this.repository
                ? await this.repository.groupHistory(input.dataSpaceId, input.groupId)
                : new Set<never>();
        const session = new GameSession(
            {
                id: randomUUID(),
                startedAt: Date.now(),
                mode: input.mode,
                profile: gameProfile,
                players: input.players.map((player) => ({
                    id: randomUUID(),
                    name: player.name.trim(),
                })),
                cardLocale: input.cardLocale,
                neverHaveIEverRevealMode: input.neverHaveIEverRevealMode,
                groupHistoryCardIds,
            },
            this.random,
        );
        const cards = await this.cards.listActive({
            locale: session.cardLocale,
            ...this.cardTranslationPolicy,
        });
        if (!session.hasEligibleCards(cards)) {
            throw Object.assign(new Error(MESSAGE_KEYS.GAME_CARD_POOL_EXHAUSTED), {
                code: "CARD_POOL_EXHAUSTED",
            });
        }
        this.sessions.set(session.id, session);
        await this.repository?.save(
            session.toRuntimeState(),
            input.dataSpaceId
                ? { dataSpaceId: input.dataSpaceId, groupId: input.groupId ?? null }
                : undefined,
        );
        return this.snapshot(session);
    }

    async get(id: string): Promise<CouchSessionSnapshot> {
        return this.snapshot(await this.require(id));
    }

    async startTurn(id: string, revision: number): Promise<CouchSessionSnapshot> {
        const session = await this.require(id);
        session.startTurn(
            revision,
            await this.cards.listActive({
                locale: session.cardLocale,
                ...this.cardTranslationPolicy,
            }),
        );
        await this.persist(session);
        return this.snapshot(session);
    }
    async chooseCardType(
        id: string,
        revision: number,
        cardType: typeof CARD_TYPES.QUESTION | typeof CARD_TYPES.DARE,
    ): Promise<CouchSessionSnapshot> {
        const session = await this.require(id);
        session.chooseCardType(
            revision,
            cardType,
            await this.cards.listActive({
                locale: session.cardLocale,
                ...this.cardTranslationPolicy,
            }),
        );
        await this.persist(session);
        return this.snapshot(session);
    }
    async skip(id: string, revision: number): Promise<CouchSessionSnapshot> {
        const session = await this.require(id);
        session.skipCard(
            revision,
            await this.cards.listActive({
                locale: session.cardLocale,
                ...this.cardTranslationPolicy,
            }),
        );
        await this.persist(session);
        return this.snapshot(session);
    }
    async advance(id: string, revision: number): Promise<CouchSessionSnapshot> {
        const session = await this.require(id);
        session.advance(revision);
        await this.persist(session);
        return this.snapshot(session);
    }
    async vote(
        id: string,
        revision: number,
        playerId: string,
        vote: "YES" | "NO",
    ): Promise<CouchSessionSnapshot> {
        const session = await this.require(id);
        session.submitVote(revision, playerId, vote);
        await this.persist(session);
        return this.snapshot(session);
    }
    async end(id: string, revision: number): Promise<CouchSessionSnapshot> {
        const session = await this.require(id);
        session.end(revision);
        await this.persist(session);
        return this.snapshot(session);
    }

    private async require(id: string): Promise<GameSession> {
        const session = this.sessions.get(id);
        if (session) return session;
        const runtime = await this.repository?.load(id);
        if (!runtime) throw new CouchSessionNotFoundError();
        const restored = GameSession.restore(runtime, this.random);
        this.sessions.set(id, restored);
        return restored;
    }
    private async persist(session: GameSession): Promise<void> {
        await this.repository?.save(session.toRuntimeState());
    }
    private snapshot(session: GameSession): CouchSessionSnapshot {
        return {
            id: session.id,
            startedAt: session.startedAt,
            mode: session.mode,
            revision: session.revision,
            state: session.state,
            roundNumber: session.roundNumber,
            activePlayer: session.activePlayer,
            players: session.players.map((player) => ({ ...player })),
            currentCard: session.currentCard
                ? {
                      id: session.currentCard.id,
                      cardText: session.currentCard.cardText,
                      cardType: session.currentCard.cardType,
                      intensity: globalCardIntensityLevel(session.currentCard),
                      questionCategoryId: session.currentCard.questionCategoryId,
                      dareTypeId: session.currentCard.dareTypeId,
                  }
                : null,
            cardsShown: session.sessionHistory.length,
            voteResult: session.voteResult(),
            votedPlayerIds: [...session.votes.keys()],
            neverHaveIEverVoting: projectNeverHaveIEverVoting(session),
            settings: {
                mode: session.mode,
                profileId: session.profile.id,
                cardLocale: session.cardLocale,
                neverHaveIEverRevealMode: session.neverHaveIEverRevealMode,
                configuration: {
                    enabledQuestionCategoryIds: [...session.profile.enabledQuestionCategoryIds],
                    enabledDareTypeIds: [...session.profile.enabledDareTypeIds],
                    blockedOperationalFlags: [...session.profile.blockedOperationalFlags],
                    startingIntensity: session.profile.startingIntensity,
                    maximumIntensity: session.profile.maximumIntensity,
                    intensityProgressionUnit: session.profile.intensityProgressionUnit,
                    intensityProgressionInterval: session.profile.intensityProgressionInterval,
                    intensityProgressionIncrement: session.profile.intensityProgressionIncrement,
                    randomQuestionRatio: session.profile.randomQuestionRatio,
                    maximumTypeStreak: session.profile.maximumTypeStreak,
                    letsTalkMetaInterval: session.profile.letsTalkMetaInterval,
                },
            },
        };
    }
}
