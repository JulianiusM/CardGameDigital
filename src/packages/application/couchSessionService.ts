import { MESSAGE_KEYS } from "../localization/keys";
import { randomUUID } from "node:crypto";
import {
    DARE_TYPES,
    GameSession,
    type GameMode,
    type GameProfile,
    QUESTION_CATEGORIES,
    CARD_TYPES,
    builtInGameProfile,
    validateGameProfile,
} from "../game-core";
import {
    DEFAULT_CARD_TRANSLATION_POLICY,
    type CardLocalizationPolicy,
    type CardRepository,
} from "./repositories";
import type { RandomSource } from "../game-core";

export type CreateCouchSession = {
    mode: GameMode;
    players: readonly { name: string }[];
    maximumIntensity: 1 | 2 | 3 | 4 | 5;
    randomQuestionRatio: number;
    letsTalkMetaInterval: number;
    profileId?: string;
    adultContentConfirmed?: boolean;
    cardLocale: string;
};

export type CouchSessionSnapshot = {
    id: string;
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
    ) {}

    create(input: CreateCouchSession): CouchSessionSnapshot {
        const selected = input.profileId ? builtInGameProfile(input.profileId) : null;
        if (selected?.requiresAdultConfirmation && !input.adultContentConfirmed) {
            throw Object.assign(new Error(MESSAGE_KEYS.GAME_ADULT_CONFIRMATION_REQUIRED), {
                code: "VALIDATION_ERROR",
            });
        }
        const gameProfile: GameProfile = validateGameProfile({
            id: selected?.id ?? "CUSTOM_COUCH",
            name: selected?.name ?? "CUSTOM_COUCH",
            enabledQuestionCategoryIds:
                selected?.enabledQuestionCategoryIds ?? new Set(Object.values(QUESTION_CATEGORIES)),
            enabledDareTypeIds: selected?.enabledDareTypeIds ?? new Set(Object.values(DARE_TYPES)),
            blockedOperationalFlags: selected?.blockedOperationalFlags ?? new Set(),
            maximumIntensity: Math.min(
                input.maximumIntensity,
                selected?.maximumIntensity ?? input.maximumIntensity,
            ) as 1 | 2 | 3 | 4 | 5,
            randomQuestionRatio: selected?.randomQuestionRatio ?? input.randomQuestionRatio,
            maximumTypeStreak: 3,
            letsTalkMetaInterval: input.letsTalkMetaInterval,
        });
        const session = new GameSession(
            {
                id: randomUUID(),
                mode: input.mode,
                profile: gameProfile,
                players: input.players.map((player) => ({
                    id: randomUUID(),
                    name: player.name.trim(),
                })),
                cardLocale: input.cardLocale,
            },
            this.random,
        );
        this.sessions.set(session.id, session);
        return this.snapshot(session);
    }

    get(id: string): CouchSessionSnapshot {
        return this.snapshot(this.require(id));
    }

    async startTurn(id: string, revision: number): Promise<CouchSessionSnapshot> {
        const session = this.require(id);
        session.startTurn(
            revision,
            await this.cards.listActive({
                locale: session.cardLocale,
                ...this.cardTranslationPolicy,
            }),
        );
        return this.snapshot(session);
    }
    async chooseCardType(
        id: string,
        revision: number,
        cardType: typeof CARD_TYPES.QUESTION | typeof CARD_TYPES.DARE,
    ): Promise<CouchSessionSnapshot> {
        const session = this.require(id);
        session.chooseCardType(
            revision,
            cardType,
            await this.cards.listActive({
                locale: session.cardLocale,
                ...this.cardTranslationPolicy,
            }),
        );
        return this.snapshot(session);
    }
    async skip(id: string, revision: number): Promise<CouchSessionSnapshot> {
        const session = this.require(id);
        session.skipCard(
            revision,
            await this.cards.listActive({
                locale: session.cardLocale,
                ...this.cardTranslationPolicy,
            }),
        );
        return this.snapshot(session);
    }
    advance(id: string, revision: number): CouchSessionSnapshot {
        const session = this.require(id);
        session.advance(revision);
        return this.snapshot(session);
    }
    vote(id: string, revision: number, playerId: string, vote: "YES" | "NO"): CouchSessionSnapshot {
        const session = this.require(id);
        session.submitVote(revision, playerId, vote);
        return this.snapshot(session);
    }
    end(id: string, revision: number): CouchSessionSnapshot {
        const session = this.require(id);
        session.end(revision);
        return this.snapshot(session);
    }

    private require(id: string): GameSession {
        const session = this.sessions.get(id);
        if (!session) throw new CouchSessionNotFoundError();
        return session;
    }
    private snapshot(session: GameSession): CouchSessionSnapshot {
        return {
            id: session.id,
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
                      intensity: session.currentCard.intensity,
                      questionCategoryId: session.currentCard.questionCategoryId,
                      dareTypeId: session.currentCard.dareTypeId,
                  }
                : null,
            cardsShown: session.sessionHistory.length,
            voteResult: session.voteResult(),
            votedPlayerIds: [...session.votes.keys()],
        };
    }
}
