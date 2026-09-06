import { prepareEligibility, eligibilityReasons } from "../eligibility/cardEligibility";
import {
    WeightedCardReservoir,
    type CardStream,
    type CardCandidate,
    type CardHistoryContext,
    type SessionHistoryIndex,
} from "../selection/cardStream";
import {
    sessionPolicyResolver,
    type SessionPolicySnapshot,
    type CatalogProvenance,
} from "../policies/sessionPolicy";
import { MESSAGE_KEYS } from "../../localization/keys";
import type { Card } from "../cards/card";
import { CARD_TYPES, type CardType } from "../cards/taxonomy";
import { intensityMaximumScoreForProgress, type Intensity } from "../cards/intensity";
import { type EligibilityRequest } from "../eligibility/cardEligibility";
import type { CardAppearance } from "../history/history";
import type { GameProfile, PlayerBoundaries } from "../profiles/gameProfile";
import {
    SOCIAL_SENSITIVITIES,
    SOCIAL_SENSITIVITY_ORDER,
    type SocialSensitivity,
} from "../cards/socialSensitivity";
import { emptySessionCardPolicy, type SessionCardPolicyInput } from "../policies/cardPolicy";
import type { RandomSource } from "../random/randomSource";
import { CardPoolExhaustedError } from "../selection/weightedSelection";

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
    groupHistoryCardIds?: ReadonlySet<Card["id"]>;
    boundariesByPlayer?: ReadonlyMap<string, PlayerBoundaries>;
    cardLocale: string;
    cardFallbackEnabled?: boolean;
    cardFallbackLocales?: readonly string[];
    neverHaveIEverRevealMode?: NeverHaveIEverRevealMode;
    catalog?: CatalogProvenance | null;
    policySnapshot?: SessionPolicySnapshot | null;
    historyContext?: CardHistoryContext | null;
    sessionCardPolicy?: SessionCardPolicyInput;
};
export type GameSessionRuntimeState = {
    version: 7;
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
        maximumSocialSensitivity?: SocialSensitivity;
        startingIntensity: 1 | 2 | 3 | 4 | 5;
        maximumIntensity: Intensity;
        intensityProgressionUnit: "ROUNDS" | "CARDS";
        intensityProgressionInterval: number;
        intensityProgressionIncrement: number;
        randomQuestionRatio: number;
        maximumTypeStreak: number;
        letsTalkMetaInterval: number;
    };
    revision: number;
    state: SessionState;
    roundNumber: number;
    activePlayerIndex: number;
    currentCard: Card | null;
    sessionHistory: CardAppearance[];
    votes: [string, Vote][];
    voterIds?: string[];
    shownTypeCounts: { QUESTION: number; DARE: number };
    questionsSinceMeta: number;
    turnsCompletedInRound: number;
    lastCardTypes: CardType[];
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
    cardFallbackEnabled?: boolean;
    cardFallbackLocales?: string[];
    neverHaveIEverRevealMode?: NeverHaveIEverRevealMode;
    catalog: CatalogProvenance | null;
    policySnapshot: SessionPolicySnapshot | null;
    historyContext: CardHistoryContext | null;
    cardsShown: number;
    poolRevision: number;
    historyIndex: SessionHistoryIndex;
    sessionCardPolicy: SessionCardPolicyInput;
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
    readonly cardFallbackEnabled: boolean;
    readonly cardFallbackLocales: readonly string[];
    readonly neverHaveIEverRevealMode: NeverHaveIEverRevealMode;
    readonly catalog: CatalogProvenance | null;
    policySnapshot: SessionPolicySnapshot | null;
    readonly historyContext: CardHistoryContext | null;
    cardsShown = 0;
    private poolRevision = 0;
    private readonly historyIndex = new Map<Card["id"], number>();
    private resolvePolicy: <T extends Card>(card: T) => T;
    readonly sessionCardPolicy: SessionCardPolicyInput;
    readonly votes = new Map<string, Vote>();
    readonly shownTypeCounts = { [CARD_TYPES.QUESTION]: 0, [CARD_TYPES.DARE]: 0 };
    players: Player[];
    revision = 0;
    state: SessionState;
    roundNumber = 1;
    activePlayerIndex: number;
    currentCard: Card | null = null;
    questionsSinceMeta = 0;
    private turnsCompletedInRound = 0;
    private lastCardTypes: CardType[] = [];
    private readonly groupHistoryCardIds: ReadonlySet<Card["id"]>;
    private readonly boundariesByPlayer: Map<string, PlayerBoundaries>;
    private pendingCardType: CardType | null = null;
    private voterIds: string[] = [];
    private pendingCount?: { revision: number; value: Promise<number> };
    private remainingCount: {
        revision: number;
        value: number;
    } | null = null;

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
        this.cardFallbackEnabled = options.cardFallbackEnabled ?? false;
        this.cardFallbackLocales = [...(options.cardFallbackLocales ?? [])];
        this.neverHaveIEverRevealMode =
            options.neverHaveIEverRevealMode ?? NEVER_HAVE_I_EVER_REVEAL_MODES.ANONYMOUS_AGGREGATE;
        this.catalog = options.catalog ?? null;
        this.policySnapshot = options.policySnapshot ?? null;
        this.historyContext = options.historyContext ?? null;
        this.resolvePolicy = sessionPolicyResolver(
            this.policySnapshot,
            options.sessionCardPolicy ?? emptySessionCardPolicy(),
        );
        this.sessionCardPolicy = options.sessionCardPolicy ?? emptySessionCardPolicy();
        this.groupHistoryCardIds = options.groupHistoryCardIds ?? new Set();
        const playerIds = new Set(this.players.map(({ id }) => id));
        this.boundariesByPlayer = new Map(
            [...(options.boundariesByPlayer ?? [])].filter(([id]) => playerIds.has(id)),
        );
        // A restored, ended Session can legitimately have no players after the
        // final participant leaves. New Sessions are still rejected above unless
        // they have at least two players.
        this.activePlayerIndex =
            !restoring && this.players.length ? random.nextInt(this.players.length) : 0;
        this.state =
            options.mode === GAME_MODES.CLASSIC
                ? SESSION_STATES.CHOOSING_CARD_TYPE
                : SESSION_STATES.WAITING_FOR_PLAYER;
    }

    static restore(runtime: GameSessionRuntimeState, random: RandomSource): GameSession {
        if (runtime.version !== 7)
            throw new Error(`Unsupported GameSession runtime version ${runtime.version}`);
        // JSON cannot represent Set and Map. Rehydrate those domain collections
        // explicitly so persistence remains an adapter concern, not a domain dependency.
        const profile = {
            ...runtime.profile,
            maximumSocialSensitivity:
                runtime.profile.maximumSocialSensitivity ?? SOCIAL_SENSITIVITIES.EXPLICIT,
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
                groupHistoryCardIds: new Set(runtime.groupHistoryCardIds),
                boundariesByPlayer,
                cardLocale: runtime.cardLocale,
                cardFallbackEnabled: runtime.cardFallbackEnabled,
                cardFallbackLocales: runtime.cardFallbackLocales,
                neverHaveIEverRevealMode: runtime.neverHaveIEverRevealMode,
                catalog: runtime.catalog,
                policySnapshot: runtime.policySnapshot,
                historyContext: runtime.historyContext,
                sessionCardPolicy: runtime.sessionCardPolicy,
            },
            random,
            true,
        );
        session.revision = runtime.revision;
        session.state = runtime.state;
        if (session.state === SESSION_STATES.ENDED) session.boundariesByPlayer.clear();
        session.roundNumber = runtime.roundNumber;
        session.activePlayerIndex = runtime.activePlayerIndex;
        session.currentCard = runtime.currentCard;
        session.sessionHistory.push(...runtime.sessionHistory.slice(-2));
        session.cardsShown = runtime.cardsShown;
        session.poolRevision = runtime.poolRevision;
        for (const [id, sequence] of runtime.historyIndex) session.historyIndex.set(id, sequence);
        if (session.historyContext)
            for (const appearance of session.sessionHistory)
                session.historyIndex.set(appearance.cardId, appearance.sequence);
        session.votes.clear();
        for (const [id, vote] of runtime.votes) session.votes.set(id, vote);
        session.shownTypeCounts.QUESTION = runtime.shownTypeCounts.QUESTION;
        session.shownTypeCounts.DARE = runtime.shownTypeCounts.DARE;
        session.questionsSinceMeta = runtime.questionsSinceMeta;
        session.turnsCompletedInRound = runtime.turnsCompletedInRound;
        session.lastCardTypes = [...runtime.lastCardTypes];
        session.pendingCardType = runtime.pendingCardType;
        session.voterIds = [];
        if (runtime.voterIds) {
            session.voterIds = [...runtime.voterIds];
        } else if (runtime.mode === GAME_MODES.NEVER_HAVE_I_EVER && runtime.currentCard) {
            session.voterIds = runtime.players.map(({ id }) => id);
        }
        return session;
    }

    toRuntimeState(): GameSessionRuntimeState {
        // Keep this representation versioned and JSON-safe for restart/reconnect recovery.
        return {
            version: 7,
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
            cardFallbackEnabled: this.cardFallbackEnabled,
            cardFallbackLocales: [...this.cardFallbackLocales],
            neverHaveIEverRevealMode: this.neverHaveIEverRevealMode,
            catalog: this.catalog,
            policySnapshot: this.policySnapshot,
            historyContext: this.historyContext,
            cardsShown: this.cardsShown,
            poolRevision: this.poolRevision,
            historyIndex: [...this.historyIndex],
            sessionCardPolicy: this.sessionCardPolicy,
        };
    }

    fork(random: RandomSource): GameSession {
        const proposed = GameSession.restore(this.toRuntimeState(), random);
        proposed.remainingCount = this.remainingCount;
        return proposed;
    }

    get historyIndexSize(): number {
        return this.historyIndex.size;
    }

    get activePlayer(): Player | null {
        return this.mode === GAME_MODES.NEVER_HAVE_I_EVER
            ? null
            : (this.players[this.activePlayerIndex] ?? null);
    }

    get currentMaximumIntensityScore(): number {
        return intensityMaximumScoreForProgress(this.profile, {
            roundNumber: this.roundNumber,
            cardsShown: this.cardsShown,
        });
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

    /** Every count consumes the complete metadata stream, without choosing a Card. */
    async hasEligibleCards(cards: CardStream): Promise<boolean> {
        const pools = await this.scanPools(cards, false);
        this.remainingCount = {
            revision: this.poolRevision,
            value: pools.QUESTION.count + pools.DARE.count + pools.CONVERSATION_META.count,
        };
        if (this.mode === GAME_MODES.NEVER_HAVE_I_EVER || this.mode === GAME_MODES.LETS_TALK)
            return pools.QUESTION.count > 0;
        return pools.QUESTION.count + pools.DARE.count > 0;
    }

    async remainingEligibleCardCount(cards: CardStream): Promise<number> {
        if (this.state === SESSION_STATES.ENDED) return 0;
        if (this.remainingCount?.revision === this.poolRevision) return this.remainingCount.value;
        const revision = this.poolRevision;
        if (this.pendingCount?.revision === revision) return this.pendingCount.value;
        const value = this.scanPools(cards, false).then((pools) => {
            const count = pools.QUESTION.count + pools.DARE.count + pools.CONVERSATION_META.count;
            if (this.poolRevision === revision) this.remainingCount = { revision, value: count };
            return count;
        });
        this.pendingCount = { revision, value };
        try {
            return await value;
        } finally {
            if (this.pendingCount?.value === value) this.pendingCount = undefined;
        }
    }

    /** Removes players after an intentional leave or an expired reconnect grace period. */
    removePlayers(expectedRevision: number, playerIds: ReadonlySet<string>): void {
        this.assertRevision(expectedRevision);
        if (this.state === SESSION_STATES.ENDED) return;
        const previousPlayers = [...this.players];
        const previousActiveId = this.activePlayer?.id ?? null;
        const activePlayerWasRemoved = previousActiveId ? playerIds.has(previousActiveId) : false;
        this.players = this.players.filter(({ id }) => !playerIds.has(id));
        if (this.players.length === previousPlayers.length) return;
        for (const playerId of playerIds) {
            this.votes.delete(playerId);
            this.boundariesByPlayer.delete(playerId);
        }
        this.voterIds = this.voterIds.filter((id) => !playerIds.has(id));
        if (!this.players.length) {
            this.state = SESSION_STATES.ENDED;
            this.currentCard = null;
            this.pendingCardType = null;
            this.poolRevision++;
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
        if (
            activePlayerWasRemoved &&
            this.mode !== GAME_MODES.NEVER_HAVE_I_EVER &&
            this.currentCard
        ) {
            // A Card belongs to the turn for which it was drawn. Never pass it
            // silently to a different active player.
            this.currentCard = null;
            this.pendingCardType = null;
            this.votes.clear();
            this.voterIds = [];
            this.state =
                this.mode === GAME_MODES.CLASSIC
                    ? SESSION_STATES.CHOOSING_CARD_TYPE
                    : SESSION_STATES.WAITING_FOR_PLAYER;
        }
        this.poolRevision++;
        this.revision++;
    }

    /** Adds newly connected Room players without restarting or recreating the Session. */
    addPlayers(
        expectedRevision: number,
        players: readonly Player[],
        boundariesByPlayer: ReadonlyMap<string, PlayerBoundaries>,
    ): void {
        this.assertRevision(expectedRevision);
        if (this.state === SESSION_STATES.ENDED) return;
        const existing = new Set(this.players.map(({ id }) => id));
        const added = players.filter(({ id }) => !existing.has(id));
        if (!added.length) return;
        if (new Set(added.map(({ id }) => id)).size !== added.length)
            throw new Error(MESSAGE_KEYS.GAME_PLAYER_IDS_UNIQUE);
        for (const player of added) {
            const boundaries = boundariesByPlayer.get(player.id);
            if (!boundaries) throw new Error(MESSAGE_KEYS.ROOM_ENROLLMENT_REQUIRED);
        }
        for (const player of added) {
            const boundaries = boundariesByPlayer.get(player.id)!;
            this.boundariesByPlayer.set(player.id, {
                disabledQuestionCategoryIds: new Set(boundaries.disabledQuestionCategoryIds),
                disabledDareTypeIds: new Set(boundaries.disabledDareTypeIds),
                blockedOperationalFlags: new Set(boundaries.blockedOperationalFlags),
            });
        }
        this.players = [...this.players, ...added.map((player) => ({ ...player }))];
        this.poolRevision++;
        this.revision++;
    }

    async chooseCardType(
        expectedRevision: number,
        cardType: typeof CARD_TYPES.QUESTION | typeof CARD_TYPES.DARE,
        cards: CardStream,
    ): Promise<Card> {
        this.assertRevision(expectedRevision);
        this.assertState("chooseCardType", SESSION_STATES.CHOOSING_CARD_TYPE);
        if (this.mode !== GAME_MODES.CLASSIC)
            throw new InvalidGameStateError(this.state, "chooseCardType");
        const pools = await this.scanPools(cards, true, cardType);
        return this.showSelection(pools[cardType].selected, cardType);
    }

    async startTurn(expectedRevision: number, cards: CardStream): Promise<Card> {
        this.assertRevision(expectedRevision);
        this.assertState("startTurn", SESSION_STATES.WAITING_FOR_PLAYER);
        if (this.mode === GAME_MODES.CLASSIC)
            throw new InvalidGameStateError(this.state, "startTurn");
        const pools = await this.scanPools(cards, true);
        let type: CardType = CARD_TYPES.QUESTION;
        if (this.mode === GAME_MODES.RANDOM) {
            type = this.balancedRandomType(pools.QUESTION.count > 0, pools.DARE.count > 0);
        } else if (
            this.mode === GAME_MODES.LETS_TALK &&
            this.questionsSinceMeta >= this.profile.letsTalkMetaInterval &&
            pools.CONVERSATION_META.count > 0
        ) {
            type = CARD_TYPES.CONVERSATION_META;
        }
        return this.showSelection(pools[type].selected, type);
    }

    async skipCard(expectedRevision: number, cards: CardStream): Promise<Card | null> {
        return this.replaceCard(expectedRevision, cards, "skipCard", "SKIPPED");
    }

    async vetoCard(expectedRevision: number, cards: CardStream): Promise<Card | null> {
        return this.replaceCard(expectedRevision, cards, "vetoCard", "VETOED");
    }

    private async replaceCard(
        expectedRevision: number,
        cards: CardStream,
        command: "skipCard" | "vetoCard",
        reason: "SKIPPED" | "VETOED",
    ): Promise<Card | null> {
        this.assertRevision(expectedRevision);
        this.assertState(command, SESSION_STATES.SHOWING_CARD, SESSION_STATES.COLLECTING_ANSWERS);
        if (!this.pendingCardType) throw new InvalidGameStateError(this.state, command);
        // Finish the scan before mutating state: a failed read cannot lose the current Card.
        const pools = await this.scanPools(cards, true, this.pendingCardType);
        const appearance = this.sessionHistory.at(-1);
        if (appearance) {
            appearance.skipped = reason === "SKIPPED";
            appearance.vetoed = reason === "VETOED";
        }
        this.votes.clear();
        this.voterIds = [];
        this.currentCard = null;
        const selected = pools[this.pendingCardType].selected;
        if (selected) return this.commitShown(selected);
        this.pendingCardType = null;
        this.state =
            this.mode === GAME_MODES.CLASSIC
                ? SESSION_STATES.CHOOSING_CARD_TYPE
                : SESSION_STATES.WAITING_FOR_PLAYER;
        this.poolRevision++;
        this.revision++;
        return null;
    }

    private showSelection(card: Card | null, type: CardType): Card {
        if (!card) throw new CardPoolExhaustedError();
        this.pendingCardType = type;
        return this.commitShown(card);
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
        const appearance = this.sessionHistory.at(-1)!;
        if (appearance && !appearance.skipped && !appearance.vetoed) appearance.completed = true;
        this.currentCard = null;
        this.pendingCardType = null;
        this.votes.clear();
        this.voterIds = [];
        if (this.mode === GAME_MODES.NEVER_HAVE_I_EVER) this.roundNumber++;
        else this.rotatePlayer();
        this.state =
            this.mode === GAME_MODES.CLASSIC
                ? SESSION_STATES.CHOOSING_CARD_TYPE
                : SESSION_STATES.WAITING_FOR_PLAYER;
        this.poolRevision++;
        this.revision++;
    }

    end(expectedRevision: number): void {
        this.assertRevision(expectedRevision);
        if (this.state === SESSION_STATES.ENDED) throw new InvalidGameStateError(this.state, "end");
        this.state = SESSION_STATES.ENDED;
        this.currentCard = null;
        this.pendingCardType = null;
        this.votes.clear();
        this.voterIds = [];
        this.boundariesByPlayer.clear();
        this.historyIndex.clear();
        this.policySnapshot = null;
        this.resolvePolicy = (card) => card;
        this.poolRevision++;
        this.revision++;
    }

    private async scanPools(cards: CardStream, draw: boolean, onlyType?: CardType) {
        const pools = {
            QUESTION: new WeightedCardReservoir(),
            DARE: new WeightedCardReservoir(),
            CONVERSATION_META: new WeightedCardReservoir(),
        };
        const requests = new Map<CardType, EligibilityRequest>();
        for (const type of Object.values(CARD_TYPES)) {
            if (onlyType && type !== onlyType) continue;
            if (this.mode === GAME_MODES.NEVER_HAVE_I_EVER && type !== CARD_TYPES.QUESTION)
                continue;
            if (this.mode === GAME_MODES.LETS_TALK && type === CARD_TYPES.DARE) continue;
            if (
                (this.mode === GAME_MODES.CLASSIC || this.mode === GAME_MODES.RANDOM) &&
                type === CARD_TYPES.CONVERSATION_META
            )
                continue;
            const boundaries =
                type === CARD_TYPES.DARE ||
                type === CARD_TYPES.CONVERSATION_META ||
                this.mode === GAME_MODES.NEVER_HAVE_I_EVER
                    ? this.players.map(
                          (player) => this.boundariesByPlayer.get(player.id) ?? EMPTY_BOUNDARIES,
                      )
                    : [
                          this.boundariesByPlayer.get(this.activePlayer?.id ?? "") ??
                              EMPTY_BOUNDARIES,
                      ];
            requests.set(
                type,
                prepareEligibility({
                    cardType: type,
                    requireYesNoAnswer: this.mode === GAME_MODES.NEVER_HAVE_I_EVER,
                    profile: this.profile,
                    boundaries,
                    maximumIntensityScore: this.currentMaximumIntensityScore,
                    sessionHistory: this.sessionHistory,
                    cardsShown: this.cardsShown,
                    lastSequenceByCardId: this.historyIndex,
                    groupHistoryCardIds: this.groupHistoryCardIds,
                    playerCount: this.players.length,
                }),
            );
        }
        for await (const candidate of cards) {
            const request = requests.get(candidate.cardType);
            if (!request) continue;
            const card = this.resolvePolicy(candidate);
            const indexed = { ...request };
            if (candidate.lastShownSequence !== undefined) {
                indexed.lastSequenceByCardId = new Map();
                if (candidate.lastShownSequence !== null)
                    (indexed.lastSequenceByCardId as Map<Card["id"], number>).set(
                        card.id,
                        candidate.lastShownSequence,
                    );
            }
            if (candidate.seenInGroup !== undefined)
                indexed.groupHistoryCardIds = candidate.seenInGroup
                    ? new Set([card.id])
                    : new Set();
            if (eligibilityReasons(card, indexed).length === 0)
                pools[card.cardType].add(card, draw ? this.random : undefined);
        }
        return pools;
    }

    private commitShown(card: Card): Card {
        this.currentCard = card;
        this.cardsShown++;
        if (!this.historyContext) this.historyIndex.set(card.id, this.cardsShown);
        if (this.sessionHistory.length >= 2) this.sessionHistory.shift();
        this.sessionHistory.push({
            cardId: card.id,
            sequence: this.cardsShown,
            roundNumber: this.roundNumber,
            playerId: this.activePlayer?.id ?? null,
            skipped: false,
            completed: false,
            vetoed: false,
        });
        if (this.historyContext) {
            this.historyIndex.clear();
            for (const appearance of this.sessionHistory)
                this.historyIndex.set(appearance.cardId, appearance.sequence);
        }
        if (card.cardType === CARD_TYPES.QUESTION || card.cardType === CARD_TYPES.DARE) {
            this.shownTypeCounts[card.cardType]++;
            this.lastCardTypes.push(card.cardType);
            this.lastCardTypes = this.lastCardTypes.slice(-this.profile.maximumTypeStreak);
        }
        if (this.mode === GAME_MODES.LETS_TALK) {
            if (card.cardType === CARD_TYPES.CONVERSATION_META) this.questionsSinceMeta = 0;
            else if (card.cardType === CARD_TYPES.QUESTION) this.questionsSinceMeta++;
        }
        this.state =
            this.mode === GAME_MODES.NEVER_HAVE_I_EVER
                ? SESSION_STATES.COLLECTING_ANSWERS
                : SESSION_STATES.SHOWING_CARD;
        this.voterIds =
            this.mode === GAME_MODES.NEVER_HAVE_I_EVER ? this.players.map(({ id }) => id) : [];
        this.poolRevision++;
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

/** Membership transitions need only the hot runtime fields. They neither select a
 * Card nor inspect appearance history, so persistence need not hydrate immutable
 * catalogs, policy or history just to close a Room or remove a participant. */
export function reconcileSessionMembership(
    runtime: GameSessionRuntimeState,
    remainingPlayerIds: ReadonlySet<string>,
    roomClosed: boolean,
): GameSessionRuntimeState {
    if (runtime.state === SESSION_STATES.ENDED) return runtime;
    const removed = new Set(
        runtime.players.filter(({ id }) => !remainingPlayerIds.has(id)).map(({ id }) => id),
    );
    if (!roomClosed && !removed.size) return runtime;
    const unexpectedRandom = (): never => {
        throw new Error("Membership changes cannot draw random values");
    };
    const proposed = GameSession.restore(runtime, {
        nextFloat: unexpectedRandom,
        nextInt: unexpectedRandom,
    });
    proposed.removePlayers(runtime.revision, removed);
    if (roomClosed && proposed.state !== SESSION_STATES.ENDED) proposed.end(proposed.revision);
    return proposed.toRuntimeState();
}
