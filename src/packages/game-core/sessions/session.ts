import { MESSAGE_KEYS } from "../../localization/keys";
import type { Card, PlayableCard } from "../cards/card";
import { CARD_TYPES, type CardType } from "../cards/taxonomy";
import { eligibleCards, type EligibilityRequest } from "../eligibility/cardEligibility";
import type { CardAppearance } from "../history/history";
import type { GameProfile, PlayerBoundaries } from "../profiles/gameProfile";
import type { RandomSource } from "../random/randomSource";
import { CardPoolExhaustedError, selectWeighted } from "../selection/weightedSelection";

export const GAME_MODES = {
    CLASSIC: "CLASSIC_TRUTH_OR_DARE",
    RANDOM: "RANDOM_TRUTH_OR_DARE",
    NEVER_HAVE_I_EVER: "NEVER_HAVE_I_EVER",
    LETS_TALK: "LETS_TALK",
} as const;
export type GameMode = (typeof GAME_MODES)[keyof typeof GAME_MODES];

export const NEVER_HAVE_I_EVER_REVEAL_MODES = {
    ANONYMOUS_AGGREGATE: "ANONYMOUS_AGGREGATE",
    NAMED_ANSWERS: "NAMED_ANSWERS",
} as const;
export type NeverHaveIEverRevealMode =
    (typeof NEVER_HAVE_I_EVER_REVEAL_MODES)[keyof typeof NEVER_HAVE_I_EVER_REVEAL_MODES];

export const SESSION_STATES = {
    WAITING_FOR_PLAYER: "WAITING_FOR_PLAYER",
    CHOOSING_CARD_TYPE: "CHOOSING_CARD_TYPE",
    SELECTING_CARD: "SELECTING_CARD",
    SHOWING_CARD: "SHOWING_CARD",
    WAITING_FOR_RESOLUTION: "WAITING_FOR_RESOLUTION",
    COLLECTING_ANSWERS: "COLLECTING_ANSWERS",
    SHOWING_RESULTS: "SHOWING_RESULTS",
    TRANSITION: "TRANSITION",
    NEXT_PLAYER: "NEXT_PLAYER",
    ENDED: "ENDED",
} as const;
export type SessionState = (typeof SESSION_STATES)[keyof typeof SESSION_STATES];

export type Player = { id: string; name: string };
export type Vote = "YES" | "NO";
export type GameSessionOptions = {
    id: string;
    startedAt?: number;
    mode: GameMode;
    players: readonly Player[];
    profile: GameProfile;
    maximumIntensity?: number;
    groupHistoryCardIds?: ReadonlySet<Card["id"]>;
    boundariesByPlayer?: ReadonlyMap<string, PlayerBoundaries>;
    cardLocale: string;
    neverHaveIEverRevealMode?: NeverHaveIEverRevealMode;
};
export type GameSessionRuntimeState = {
    version: 1;
    id: string;
    startedAt: number;
    mode: GameMode;
    players: Player[];
    profile: {
        id: string;
        name: string;
        enabledQuestionCategoryIds: string[];
        enabledDareTypeIds: string[];
        blockedOperationalFlags: string[];
        maximumIntensity: 1 | 2 | 3 | 4 | 5;
        randomQuestionRatio: number;
        maximumTypeStreak: number;
        letsTalkMetaInterval: number;
    };
    revision: number;
    state: SessionState;
    roundNumber: number;
    activePlayerIndex: number;
    currentCard: PlayableCard | null;
    sessionHistory: CardAppearance[];
    votes: [string, Vote][];
    voterIds?: string[];
    shownTypeCounts: { QUESTION: number; DARE: number };
    questionsSinceMeta: number;
    turnsCompletedInRound: number;
    lastCardTypes: CardType[];
    maximumIntensity: number;
    groupHistoryCardIds: Card["id"][];
    boundariesByPlayer: [
        string,
        {
            disabledQuestionCategoryIds: string[];
            disabledDareTypeIds: string[];
            blockedOperationalFlags: string[];
        },
    ][];
    pendingCardType: CardType | null;
    cardLocale: string;
    neverHaveIEverRevealMode?: NeverHaveIEverRevealMode;
};

export class StaleSessionRevisionError extends Error {
    readonly code = "STALE_SESSION_REVISION";
    constructor(
        readonly expected: number,
        readonly received: number,
    ) {
        super(MESSAGE_KEYS.GAME_STALE_REVISION);
        this.name = "StaleSessionRevisionError";
    }
}
export class InvalidGameStateError extends Error {
    readonly code = "INVALID_GAME_STATE";
    constructor(
        readonly state: SessionState,
        readonly command: string,
    ) {
        super(MESSAGE_KEYS.GAME_INVALID_STATE);
        this.name = "InvalidGameStateError";
    }
}

const EMPTY_BOUNDARIES: PlayerBoundaries = {
    disabledQuestionCategoryIds: new Set(),
    disabledDareTypeIds: new Set(),
    blockedOperationalFlags: new Set(),
};

export class GameSession {
    readonly id: string;
    readonly startedAt: number;
    readonly mode: GameMode;
    readonly profile: GameProfile;
    readonly sessionHistory: CardAppearance[] = [];
    readonly cardLocale: string;
    readonly neverHaveIEverRevealMode: NeverHaveIEverRevealMode;
    readonly votes = new Map<string, Vote>();
    readonly shownTypeCounts = { [CARD_TYPES.QUESTION]: 0, [CARD_TYPES.DARE]: 0 };
    players: Player[];
    revision = 0;
    state: SessionState;
    roundNumber = 1;
    activePlayerIndex: number;
    currentCard: PlayableCard | null = null;
    questionsSinceMeta = 0;
    private turnsCompletedInRound = 0;
    private lastCardTypes: CardType[] = [];
    private readonly maximumIntensity: number;
    private readonly groupHistoryCardIds: ReadonlySet<Card["id"]>;
    private readonly boundariesByPlayer: ReadonlyMap<string, PlayerBoundaries>;
    private pendingCardType: CardType | null = null;
    private voterIds: string[] = [];

    constructor(
        options: GameSessionOptions,
        private readonly random: RandomSource,
        restoring = false,
    ) {
        if (!restoring && options.players.length < 2)
            throw new Error(MESSAGE_KEYS.GAME_MINIMUM_PLAYERS);
        if (new Set(options.players.map((player) => player.id)).size !== options.players.length)
            throw new Error(MESSAGE_KEYS.GAME_PLAYER_IDS_UNIQUE);
        this.id = options.id;
        this.startedAt = options.startedAt ?? Date.now();
        this.mode = options.mode;
        this.players = [...options.players];
        this.profile = options.profile;
        this.cardLocale = options.cardLocale;
        this.neverHaveIEverRevealMode =
            options.neverHaveIEverRevealMode ?? NEVER_HAVE_I_EVER_REVEAL_MODES.ANONYMOUS_AGGREGATE;
        this.maximumIntensity = options.maximumIntensity ?? options.profile.maximumIntensity;
        this.groupHistoryCardIds = options.groupHistoryCardIds ?? new Set();
        this.boundariesByPlayer = options.boundariesByPlayer ?? new Map();
        // A restored, ended Session can legitimately have no players after the
        // final participant leaves. New Sessions are still rejected above unless
        // they have at least two players.
        this.activePlayerIndex = this.players.length ? random.nextInt(this.players.length) : 0;
        this.state =
            options.mode === GAME_MODES.CLASSIC
                ? SESSION_STATES.CHOOSING_CARD_TYPE
                : SESSION_STATES.WAITING_FOR_PLAYER;
    }

    static restore(runtime: GameSessionRuntimeState, random: RandomSource): GameSession {
        if (runtime.version !== 1)
            throw new Error(`Unsupported GameSession runtime version ${runtime.version}`);
        // JSON cannot represent Set and Map. Rehydrate those domain collections
        // explicitly so persistence remains an adapter concern, not a domain dependency.
        const profile = {
            ...runtime.profile,
            enabledQuestionCategoryIds: new Set(runtime.profile.enabledQuestionCategoryIds),
            enabledDareTypeIds: new Set(runtime.profile.enabledDareTypeIds),
            blockedOperationalFlags: new Set(runtime.profile.blockedOperationalFlags),
        } as GameProfile;
        const boundariesByPlayer = new Map(
            runtime.boundariesByPlayer.map(([id, boundary]) => [
                id,
                {
                    disabledQuestionCategoryIds: new Set(boundary.disabledQuestionCategoryIds),
                    disabledDareTypeIds: new Set(boundary.disabledDareTypeIds),
                    blockedOperationalFlags: new Set(boundary.blockedOperationalFlags),
                } as PlayerBoundaries,
            ]),
        );
        const session = new GameSession(
            {
                id: runtime.id,
                startedAt: runtime.startedAt,
                mode: runtime.mode,
                players: runtime.players,
                profile,
                maximumIntensity: runtime.maximumIntensity,
                groupHistoryCardIds: new Set(runtime.groupHistoryCardIds),
                boundariesByPlayer,
                cardLocale: runtime.cardLocale,
                neverHaveIEverRevealMode: runtime.neverHaveIEverRevealMode,
            },
            random,
            true,
        );
        session.revision = runtime.revision;
        session.state = runtime.state;
        session.roundNumber = runtime.roundNumber;
        session.activePlayerIndex = runtime.activePlayerIndex;
        session.currentCard = runtime.currentCard;
        session.sessionHistory.push(...runtime.sessionHistory);
        session.votes.clear();
        for (const [id, vote] of runtime.votes) session.votes.set(id, vote);
        session.shownTypeCounts.QUESTION = runtime.shownTypeCounts.QUESTION;
        session.shownTypeCounts.DARE = runtime.shownTypeCounts.DARE;
        session.questionsSinceMeta = runtime.questionsSinceMeta;
        session.turnsCompletedInRound = runtime.turnsCompletedInRound;
        session.lastCardTypes = [...runtime.lastCardTypes];
        session.pendingCardType = runtime.pendingCardType;
        session.voterIds = runtime.voterIds
            ? [...runtime.voterIds]
            : runtime.mode === GAME_MODES.NEVER_HAVE_I_EVER && runtime.currentCard
              ? runtime.players.map(({ id }) => id)
              : [];
        return session;
    }

    toRuntimeState(): GameSessionRuntimeState {
        // Keep this representation versioned and JSON-safe for restart/reconnect recovery.
        return {
            version: 1,
            id: this.id,
            startedAt: this.startedAt,
            mode: this.mode,
            players: this.players.map((player) => ({ ...player })),
            profile: {
                ...this.profile,
                enabledQuestionCategoryIds: [...this.profile.enabledQuestionCategoryIds],
                enabledDareTypeIds: [...this.profile.enabledDareTypeIds],
                blockedOperationalFlags: [...this.profile.blockedOperationalFlags],
            },
            revision: this.revision,
            state: this.state,
            roundNumber: this.roundNumber,
            activePlayerIndex: this.activePlayerIndex,
            currentCard: this.currentCard,
            sessionHistory: this.sessionHistory.map((appearance) => ({ ...appearance })),
            votes: [...this.votes],
            voterIds: [...this.voterIds],
            shownTypeCounts: { ...this.shownTypeCounts },
            questionsSinceMeta: this.questionsSinceMeta,
            turnsCompletedInRound: this.turnsCompletedInRound,
            lastCardTypes: [...this.lastCardTypes],
            maximumIntensity: this.maximumIntensity,
            groupHistoryCardIds: [...this.groupHistoryCardIds],
            boundariesByPlayer: [...this.boundariesByPlayer].map(([id, boundary]) => [
                id,
                {
                    disabledQuestionCategoryIds: [...boundary.disabledQuestionCategoryIds],
                    disabledDareTypeIds: [...boundary.disabledDareTypeIds],
                    blockedOperationalFlags: [...boundary.blockedOperationalFlags],
                },
            ]),
            pendingCardType: this.pendingCardType,
            cardLocale: this.cardLocale,
            neverHaveIEverRevealMode: this.neverHaveIEverRevealMode,
        };
    }

    get activePlayer(): Player | null {
        return this.mode === GAME_MODES.NEVER_HAVE_I_EVER
            ? null
            : (this.players[this.activePlayerIndex] ?? null);
    }

    get votingPlayers(): readonly Player[] {
        const byId = new Map(this.players.map((player) => [player.id, player]));
        return this.voterIds.flatMap((id) => {
            const player = byId.get(id);
            return player ? [player] : [];
        });
    }

    isCurrentVoter(playerId: string): boolean {
        return this.voterIds.includes(playerId);
    }

    /** Checks the initial authoritative pool without selecting or relaxing any rule. */
    hasEligibleCards(cards: readonly PlayableCard[]): boolean {
        if (this.mode === GAME_MODES.NEVER_HAVE_I_EVER)
            return this.pool(cards, CARD_TYPES.QUESTION, true).length > 0;
        if (this.mode === GAME_MODES.LETS_TALK)
            return this.pool(cards, CARD_TYPES.QUESTION, false).length > 0;
        return (
            this.pool(cards, CARD_TYPES.QUESTION, false).length > 0 ||
            this.pool(cards, CARD_TYPES.DARE, false).length > 0
        );
    }

    /** Removes players after an intentional leave or an expired reconnect grace period. */
    removePlayers(expectedRevision: number, playerIds: ReadonlySet<string>): void {
        this.assertRevision(expectedRevision);
        if (this.state === SESSION_STATES.ENDED) return;
        const previousPlayers = [...this.players];
        const previousActiveId = this.activePlayer?.id ?? null;
        this.players = this.players.filter(({ id }) => !playerIds.has(id));
        if (this.players.length === previousPlayers.length) return;
        for (const playerId of playerIds) this.votes.delete(playerId);
        this.voterIds = this.voterIds.filter((id) => !playerIds.has(id));
        if (!this.players.length) {
            this.state = SESSION_STATES.ENDED;
            this.currentCard = null;
            this.revision++;
            return;
        }
        const activeStillPresent = previousActiveId
            ? this.players.findIndex(({ id }) => id === previousActiveId)
            : -1;
        if (activeStillPresent >= 0) this.activePlayerIndex = activeStillPresent;
        else {
            const previousActiveIndex = Math.max(
                0,
                previousPlayers.findIndex(({ id }) => id === previousActiveId),
            );
            const next = previousPlayers
                .slice(previousActiveIndex + 1)
                .concat(previousPlayers.slice(0, previousActiveIndex + 1))
                .find(({ id }) => this.players.some((player) => player.id === id));
            this.activePlayerIndex = Math.max(
                0,
                this.players.findIndex(({ id }) => id === next?.id),
            );
        }
        if (
            this.state === SESSION_STATES.COLLECTING_ANSWERS &&
            this.votes.size === this.voterIds.length
        )
            this.state = SESSION_STATES.SHOWING_RESULTS;
        this.revision++;
    }

    /** Adds newly connected Room players without restarting or recreating the Session. */
    addPlayers(expectedRevision: number, players: readonly Player[]): void {
        this.assertRevision(expectedRevision);
        if (this.state === SESSION_STATES.ENDED) return;
        const existing = new Set(this.players.map(({ id }) => id));
        const added = players.filter(({ id }) => !existing.has(id));
        if (!added.length) return;
        if (new Set(added.map(({ id }) => id)).size !== added.length)
            throw new Error(MESSAGE_KEYS.GAME_PLAYER_IDS_UNIQUE);
        this.players = [...this.players, ...added.map((player) => ({ ...player }))];
        this.revision++;
    }

    chooseCardType(
        expectedRevision: number,
        cardType: typeof CARD_TYPES.QUESTION | typeof CARD_TYPES.DARE,
        cards: readonly PlayableCard[],
    ): Card {
        this.assertRevision(expectedRevision);
        this.assertState("chooseCardType", SESSION_STATES.CHOOSING_CARD_TYPE);
        if (this.mode !== GAME_MODES.CLASSIC)
            throw new InvalidGameStateError(this.state, "chooseCardType");
        const selected = selectWeighted(this.pool(cards, cardType, false), this.random);
        this.pendingCardType = cardType;
        return this.commitShown(selected);
    }

    startTurn(expectedRevision: number, cards: readonly PlayableCard[]): Card {
        this.assertRevision(expectedRevision);
        this.assertState("startTurn", SESSION_STATES.WAITING_FOR_PLAYER);
        if (this.mode === GAME_MODES.CLASSIC)
            throw new InvalidGameStateError(this.state, "startTurn");
        if (this.mode === GAME_MODES.RANDOM) {
            const questionPool = this.pool(cards, CARD_TYPES.QUESTION, false);
            const darePool = this.pool(cards, CARD_TYPES.DARE, false);
            const type = this.balancedRandomType(questionPool.length > 0, darePool.length > 0);
            const selected = selectWeighted(
                type === CARD_TYPES.QUESTION ? questionPool : darePool,
                this.random,
            );
            this.pendingCardType = type;
            return this.commitShown(selected);
        }
        if (this.mode === GAME_MODES.NEVER_HAVE_I_EVER) {
            const selected = selectWeighted(
                this.pool(cards, CARD_TYPES.QUESTION, true),
                this.random,
            );
            this.pendingCardType = CARD_TYPES.QUESTION;
            return this.commitShown(selected);
        }
        const metaDue = this.questionsSinceMeta >= this.profile.letsTalkMetaInterval;
        if (metaDue) {
            const metaPool = this.pool(cards, CARD_TYPES.CONVERSATION, false);
            if (metaPool.length) {
                const selected = selectWeighted(metaPool, this.random);
                this.pendingCardType = CARD_TYPES.CONVERSATION;
                return this.commitShown(selected);
            }
        }
        const selected = selectWeighted(this.pool(cards, CARD_TYPES.QUESTION, false), this.random);
        this.pendingCardType = CARD_TYPES.QUESTION;
        return this.commitShown(selected);
    }

    skipCard(expectedRevision: number, cards: readonly PlayableCard[]): Card {
        this.assertRevision(expectedRevision);
        this.assertState(
            "skipCard",
            SESSION_STATES.SHOWING_CARD,
            SESSION_STATES.COLLECTING_ANSWERS,
        );
        if (!this.pendingCardType) throw new InvalidGameStateError(this.state, "skipCard");
        const requireYesNo = this.mode === GAME_MODES.NEVER_HAVE_I_EVER;
        const selected = selectWeighted(
            this.pool(cards, this.pendingCardType, requireYesNo),
            this.random,
        );
        const appearance = this.sessionHistory[this.sessionHistory.length - 1];
        if (appearance) appearance.skipped = true;
        this.votes.clear();
        return this.commitShown(selected);
    }

    submitVote(expectedRevision: number, playerId: string, vote: Vote): void {
        this.assertRevision(expectedRevision);
        this.assertState("submitVote", SESSION_STATES.COLLECTING_ANSWERS);
        if (!this.isCurrentVoter(playerId)) throw new Error(MESSAGE_KEYS.GAME_UNKNOWN_PLAYER);
        if (this.votes.has(playerId)) throw new Error(MESSAGE_KEYS.GAME_ALREADY_VOTED);
        this.votes.set(playerId, vote);
        this.state =
            this.votes.size === this.voterIds.length
                ? SESSION_STATES.SHOWING_RESULTS
                : SESSION_STATES.COLLECTING_ANSWERS;
        this.revision++;
    }

    voteResult(): { yes: number; no: number; total: number } {
        let yes = 0;
        for (const vote of this.votes.values()) if (vote === "YES") yes++;
        return { yes, no: this.votes.size - yes, total: this.votes.size };
    }

    advance(expectedRevision: number): void {
        this.assertRevision(expectedRevision);
        this.assertState("advance", SESSION_STATES.SHOWING_CARD, SESSION_STATES.SHOWING_RESULTS);
        this.currentCard = null;
        this.pendingCardType = null;
        this.votes.clear();
        this.voterIds = [];
        if (this.mode !== GAME_MODES.NEVER_HAVE_I_EVER) this.rotatePlayer();
        this.state =
            this.mode === GAME_MODES.CLASSIC
                ? SESSION_STATES.CHOOSING_CARD_TYPE
                : SESSION_STATES.WAITING_FOR_PLAYER;
        this.revision++;
    }

    end(expectedRevision: number): void {
        this.assertRevision(expectedRevision);
        if (this.state === SESSION_STATES.ENDED) throw new InvalidGameStateError(this.state, "end");
        this.state = SESSION_STATES.ENDED;
        this.currentCard = null;
        this.votes.clear();
        this.voterIds = [];
        this.revision++;
    }

    private pool(
        cards: readonly PlayableCard[],
        cardType: CardType,
        requireYesNo: boolean,
    ): readonly PlayableCard[] {
        const boundaries =
            cardType === CARD_TYPES.DARE || this.mode === GAME_MODES.NEVER_HAVE_I_EVER
                ? this.players.map(
                      (player) => this.boundariesByPlayer.get(player.id) ?? EMPTY_BOUNDARIES,
                  )
                : [this.boundariesByPlayer.get(this.activePlayer?.id ?? "") ?? EMPTY_BOUNDARIES];
        const request: EligibilityRequest = {
            cardType,
            requireYesNoAnswer: requireYesNo,
            profile: this.profile,
            boundaries,
            maximumIntensity: this.maximumIntensity,
            sessionHistory: this.sessionHistory,
            groupHistoryCardIds: this.groupHistoryCardIds,
        };
        return eligibleCards(cards, request);
    }

    private commitShown(card: PlayableCard): PlayableCard {
        this.currentCard = card;
        this.sessionHistory.push({
            cardId: card.id,
            sequence: this.sessionHistory.length + 1,
            roundNumber: this.roundNumber,
            playerId: this.activePlayer?.id ?? null,
            skipped: false,
        });
        if (card.cardType === CARD_TYPES.QUESTION || card.cardType === CARD_TYPES.DARE) {
            this.shownTypeCounts[card.cardType]++;
            this.lastCardTypes.push(card.cardType);
            this.lastCardTypes = this.lastCardTypes.slice(-this.profile.maximumTypeStreak);
        }
        if (this.mode === GAME_MODES.LETS_TALK) {
            if (card.cardType === CARD_TYPES.CONVERSATION) this.questionsSinceMeta = 0;
            else if (card.cardType === CARD_TYPES.QUESTION) this.questionsSinceMeta++;
        }
        this.state =
            this.mode === GAME_MODES.NEVER_HAVE_I_EVER
                ? SESSION_STATES.COLLECTING_ANSWERS
                : SESSION_STATES.SHOWING_CARD;
        this.voterIds =
            this.mode === GAME_MODES.NEVER_HAVE_I_EVER ? this.players.map(({ id }) => id) : [];
        this.revision++;
        return card;
    }

    private balancedRandomType(
        questionAvailable: boolean,
        dareAvailable: boolean,
    ): typeof CARD_TYPES.QUESTION | typeof CARD_TYPES.DARE {
        if (!questionAvailable && !dareAvailable) throw new CardPoolExhaustedError();
        if (!questionAvailable) return CARD_TYPES.DARE;
        if (!dareAvailable) return CARD_TYPES.QUESTION;
        const streakType =
            this.lastCardTypes.length >= this.profile.maximumTypeStreak &&
            this.lastCardTypes.every((type) => type === this.lastCardTypes[0])
                ? this.lastCardTypes[0]
                : null;
        if (streakType === CARD_TYPES.QUESTION) return CARD_TYPES.DARE;
        if (streakType === CARD_TYPES.DARE) return CARD_TYPES.QUESTION;
        const totalAfter = this.shownTypeCounts.QUESTION + this.shownTypeCounts.DARE + 1;
        const questionError = Math.abs(
            (this.shownTypeCounts.QUESTION + 1) / totalAfter - this.profile.randomQuestionRatio,
        );
        const dareError = Math.abs(
            this.shownTypeCounts.QUESTION / totalAfter - this.profile.randomQuestionRatio,
        );
        if (questionError === dareError)
            return this.random.nextInt(2) === 0 ? CARD_TYPES.QUESTION : CARD_TYPES.DARE;
        return questionError < dareError ? CARD_TYPES.QUESTION : CARD_TYPES.DARE;
    }

    private rotatePlayer(): void {
        this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
        this.turnsCompletedInRound++;
        if (this.turnsCompletedInRound >= this.players.length) {
            this.roundNumber++;
            this.turnsCompletedInRound = 0;
        }
    }

    private assertRevision(expectedRevision: number): void {
        if (expectedRevision !== this.revision)
            throw new StaleSessionRevisionError(this.revision, expectedRevision);
    }
    private assertState(command: string, ...allowed: SessionState[]): void {
        if (!allowed.includes(this.state)) throw new InvalidGameStateError(this.state, command);
    }
}
