import { SessionCache } from "./sessionCache";
import { DEFAULT_GAME_RESOURCE_LIMITS, type GameResourceLimits } from "./gameResourceLimits";
import { CommandQueue } from "./commandQueue";
import { withSessionCreationCapacity } from "./sessionCreationCapacity";
import { consentCheckedCards, currentSessionCard } from "./sessionCards";
import { MESSAGE_KEYS } from "../localization/keys";
import { randomUUID } from "node:crypto";
import {
    GameSession,
    type GameMode,
    CARD_TYPES,
    type DataSpaceId,
    type RandomSource,
    NEVER_HAVE_I_EVER_REVEAL_MODES,
    type NeverHaveIEverRevealMode,
    type SessionCardPolicyInput,
} from "../game-core";
import {
    DEFAULT_CARD_TRANSLATION_POLICY,
    type CardLocalizationPolicy,
    type CardRepository,
    type CouchSessionRepository,
} from "./repositories";
import { roomSettingsGameProfile, type EffectiveGameSettings } from "./roomGameSettings";
import {
    projectNeverHaveIEverVoting,
    projectVoteResult,
    type NeverHaveIEverVotingProjection,
} from "./neverHaveIEverVoting";
import { projectCardIntensities } from "./cardIntensityProjection";
import type { CardPolicyService } from "./cardPolicyService";
import { requiresAdultConfirmation } from "./adultConfirmation";

export type CreateCouchSession = {
    persistence: "EPHEMERAL" | "DATASPACE";
    mode: GameMode;
    players: readonly { name: string }[];
    configuration: EffectiveGameSettings;
    profileId: string;
    adultContentConfirmed: boolean;
    cardLocale: string;
    cardFallbackEnabled?: boolean;
    cardFallbackLocales?: readonly string[];
    neverHaveIEverRevealMode?: NeverHaveIEverRevealMode;
    groupId?: string | null;
    dataSpaceId?: DataSpaceId;
    cardPolicy?: SessionCardPolicyInput;
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
        cardIntensity: number;
        intensity: number;
        questionCategoryId: string | null;
        dareTypeId: string | null;
    } | null;
    cardsShown: number;
    remainingCardCount: number;
    voteResult: { yes: number; no: number; total: number };
    votedPlayerIds: readonly string[];
    neverHaveIEverVoting: NeverHaveIEverVotingProjection | null;
    persistence: "EPHEMERAL" | "DATASPACE";
    settings: {
        mode: GameMode;
        profileId: string;
        cardLocale: string;
        cardFallbackEnabled: boolean;
        cardFallbackLocales: readonly string[];
        neverHaveIEverRevealMode: NeverHaveIEverRevealMode;
        cardPolicy: SessionCardPolicyInput;
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
    private readonly sessions: SessionCache;
    private readonly owners = new WeakMap<GameSession, DataSpaceId | null>();
    private readonly queues: CommandQueue;
    constructor(
        private readonly cards: CardRepository,
        private readonly random: RandomSource,
        private readonly cardTranslationPolicy: Pick<
            CardLocalizationPolicy,
            "missingTranslation" | "fallbackLocales"
        > = DEFAULT_CARD_TRANSLATION_POLICY,
        private readonly repository?: CouchSessionRepository,
        private readonly cardPolicies?: CardPolicyService,
        private readonly limits: GameResourceLimits = DEFAULT_GAME_RESOURCE_LIMITS,
    ) {
        this.sessions = new SessionCache(limits);
        this.queues = new CommandQueue(
            limits.couchCommandQueuePerGame,
            limits.couchCommandQueueMaximum,
            limits.couchCommandQueueTerminalPerGame,
            limits.couchCommandQueueTerminalMaximum,
        );
    }

    defaultCardLocale(): Promise<string> {
        return this.cards.defaultLocale();
    }

    async create(input: CreateCouchSession): Promise<CouchSessionSnapshot> {
        return withSessionCreationCapacity(
            () => this.createWithinCapacity(input),
            this.limits.sessionConcurrentStarts,
        );
    }

    private async createWithinCapacity(input: CreateCouchSession): Promise<CouchSessionSnapshot> {
        if (input.persistence === "DATASPACE" && (!input.dataSpaceId || !this.repository)) {
            throw Object.assign(new Error(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED), {
                code: "NOT_AUTHORIZED",
            });
        }
        if (input.persistence === "EPHEMERAL" && (input.dataSpaceId || input.groupId)) {
            throw Object.assign(new Error(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED), {
                code: "NOT_AUTHORIZED",
            });
        }
        const fallbackLocales = await this.validateCardLocales(input);
        const gameProfile = roomSettingsGameProfile({
            mode: input.mode,
            profileId: input.profileId,
            groupId: input.groupId ?? null,
            adultContentConfirmed: input.adultContentConfirmed,
            cardLocale: input.cardLocale,
            cardFallbackEnabled: input.cardFallbackEnabled ?? false,
            cardFallbackLocales: fallbackLocales,
            neverHaveIEverRevealMode:
                input.neverHaveIEverRevealMode ??
                NEVER_HAVE_I_EVER_REVEAL_MODES.ANONYMOUS_AGGREGATE,
            cardPolicy: input.cardPolicy ?? {
                scopeDefault: {},
                conditionalRules: [],
                exactCards: [],
            },
            configuration: input.configuration,
        });
        const sessionId = randomUUID();
        const startedAt = Date.now();
        const sessionPlayers = input.players.map((player) => ({
            id: randomUUID(),
            name: player.name.trim(),
        }));
        const catalog = await this.cards.catalogProvenance();
        const policySnapshot = (await this.cardPolicies?.captureSessionPolicy(input)) ?? null;
        const sessionPolicy = input.cardPolicy ?? {
            scopeDefault: {},
            conditionalRules: [],
            exactCards: [],
        };
        const group =
            input.groupId && input.dataSpaceId
                ? await this.cards.groupHistoryWindow(input.dataSpaceId, input.groupId, startedAt)
                : null;
        const session = new GameSession(
            {
                id: sessionId,
                startedAt,
                mode: input.mode,
                profile: gameProfile,
                players: sessionPlayers,
                cardLocale: input.cardLocale,
                cardFallbackEnabled: input.cardFallbackEnabled,
                cardFallbackLocales: fallbackLocales,
                neverHaveIEverRevealMode: input.neverHaveIEverRevealMode,
                catalog,
                policySnapshot,
                historyContext:
                    input.persistence === "DATASPACE"
                        ? { sessionId, topology: "COUCH", group }
                        : null,
                sessionCardPolicy: sessionPolicy,
            },
            this.random,
        );
        // Reserve an unsaved game before the first scan. Failed creation releases it.
        this.sessions.set(session.id, session, input.persistence === "DATASPACE");
        try {
            if (
                !(await session.hasEligibleCards(
                    consentCheckedCards(
                        session,
                        this.cards.scan(this.localizationPolicy(session), session.historyContext),
                        input.adultContentConfirmed,
                    ),
                ))
            ) {
                throw Object.assign(new Error(MESSAGE_KEYS.GAME_CARD_POOL_EXHAUSTED), {
                    code: "CARD_POOL_EXHAUSTED",
                });
            }
            if (input.persistence === "DATASPACE" && input.dataSpaceId) {
                await this.repository?.save(session.toRuntimeState(), null, {
                    dataSpaceId: input.dataSpaceId,
                    groupId: input.groupId ?? null,
                });
            }
            this.sessions.set(session.id, session, input.persistence === "DATASPACE");
            this.owners.set(
                session,
                input.persistence === "DATASPACE" ? (input.dataSpaceId ?? null) : null,
            );
            return this.snapshot(session);
        } catch (error) {
            this.sessions.delete(session.id);
            throw error;
        }
    }

    private async validateCardLocales(input: CreateCouchSession) {
        if (!(await this.cards.isLocaleActive(input.cardLocale))) {
            throw Object.assign(new Error(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE), {
                code: "CARD_LOCALE_UNAVAILABLE",
            });
        }
        if (input.cardFallbackEnabled && !input.cardFallbackLocales?.length) {
            throw Object.assign(new Error(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE), {
                code: "CARD_LOCALE_UNAVAILABLE",
            });
        }
        const fallbackLocales = [...(input.cardFallbackLocales ?? [])];
        const normalizedFallbacks = fallbackLocales.map((entry) => entry.toLowerCase());
        if (
            new Set(normalizedFallbacks).size !== normalizedFallbacks.length ||
            normalizedFallbacks.includes(input.cardLocale.toLowerCase())
        ) {
            throw Object.assign(new Error(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE), {
                code: "CARD_LOCALE_UNAVAILABLE",
            });
        }
        for (const fallbackLocale of fallbackLocales) {
            if (!(await this.cards.isLocaleActive(fallbackLocale))) {
                throw Object.assign(new Error(MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE), {
                    code: "CARD_LOCALE_UNAVAILABLE",
                });
            }
        }
        return fallbackLocales;
    }

    async ownerDataSpaceId(id: string): Promise<DataSpaceId | null> {
        const session = await this.require(id);
        return this.owners.get(session) ?? null;
    }

    async get(id: string): Promise<CouchSessionSnapshot> {
        return this.snapshot(await this.require(id));
    }

    async startTurn(id: string, revision: number): Promise<CouchSessionSnapshot> {
        return this.mutate(id, async (session) => {
            await session.startTurn(
                revision,
                this.cards.scan(this.localizationPolicy(session), session.historyContext),
            );
        });
    }
    async chooseCardType(
        id: string,
        revision: number,
        cardType: typeof CARD_TYPES.QUESTION | typeof CARD_TYPES.DARE,
    ): Promise<CouchSessionSnapshot> {
        return this.mutate(id, async (session) => {
            await session.chooseCardType(
                revision,
                cardType,
                this.cards.scan(this.localizationPolicy(session), session.historyContext),
            );
        });
    }
    async skip(id: string, revision: number): Promise<CouchSessionSnapshot> {
        return this.mutate(id, async (session) => {
            await session.skipCard(
                revision,
                this.cards.scan(this.localizationPolicy(session), session.historyContext),
            );
        });
    }
    async advance(id: string, revision: number): Promise<CouchSessionSnapshot> {
        return this.mutate(id, (session) => {
            session.advance(revision);
        });
    }
    async vote(
        id: string,
        revision: number,
        playerId: string,
        vote: "YES" | "NO",
    ): Promise<CouchSessionSnapshot> {
        return this.mutate(id, (session) => {
            session.submitVote(revision, playerId, vote);
        });
    }
    async end(id: string, revision: number): Promise<CouchSessionSnapshot> {
        return this.mutate(
            id,
            (session) => {
                session.end(revision);
            },
            true,
        );
    }

    pruneSessions(at = Date.now()): number {
        return this.sessions.prune(at);
    }

    private async require(id: string): Promise<GameSession> {
        const session = this.sessions.get(id);
        if (
            session &&
            session.state !== "ENDED" &&
            session.catalog?.artifactDigest !==
                (await this.cards.catalogProvenance()).artifactDigest
        ) {
            session.end(session.revision);
            this.sessions.set(id, session, Boolean(this.owners.get(session)));
        }
        if (session && !this.owners.get(session)) return session;
        if (session && (await this.repository?.revision(id)) === session.revision) return session;
        this.sessions.delete(id);
        const runtime = await this.repository?.load(id);
        if (!runtime) throw new CouchSessionNotFoundError();
        const owner = await this.repository?.ownerDataSpaceId(id);
        if (!owner) throw new CouchSessionNotFoundError();
        const restored = GameSession.restore(runtime, this.random);
        this.sessions.set(id, restored);
        this.owners.set(restored, owner);
        return restored;
    }
    private mutate(
        id: string,
        change: (session: GameSession) => void | Promise<void>,
        terminal = false,
    ): Promise<CouchSessionSnapshot> {
        return this.queues.run(
            id,
            async () => {
                const current = await this.require(id);
                const proposed = current.fork(this.random);
                this.owners.set(proposed, this.owners.get(current) ?? null);
                await change(proposed);
                await this.persist(proposed, current.revision);
                this.sessions.set(id, proposed, Boolean(this.owners.get(proposed)));
                return this.snapshot(proposed);
            },
            terminal,
        );
    }
    private async persist(session: GameSession, expectedRevision: number): Promise<void> {
        if (this.owners.get(session))
            await this.repository?.save(session.toRuntimeState(), expectedRevision);
    }
    private async snapshot(session: GameSession): Promise<CouchSessionSnapshot> {
        const currentCard = await currentSessionCard(
            session,
            this.cards,
            this.localizationPolicy(session),
        );
        const voting = projectNeverHaveIEverVoting(session);
        return {
            id: session.id,
            startedAt: session.startedAt,
            mode: session.mode,
            revision: session.revision,
            state: session.state,
            roundNumber: session.roundNumber,
            activePlayer: session.activePlayer,
            players: session.players.map((player) => ({ ...player })),
            currentCard: currentCard
                ? {
                      id: currentCard.id,
                      cardText: currentCard.cardText,
                      cardType: currentCard.cardType,
                      ...projectCardIntensities(currentCard),
                      questionCategoryId: currentCard.questionCategoryId,
                      dareTypeId: currentCard.dareTypeId,
                  }
                : null,
            cardsShown: session.cardsShown,
            remainingCardCount: await session.remainingEligibleCardCount(
                this.cards.scan(this.localizationPolicy(session), session.historyContext),
            ),
            voteResult: projectVoteResult(voting),
            votedPlayerIds: [...session.votes.keys()],
            neverHaveIEverVoting: voting,
            persistence: this.owners.get(session) ? "DATASPACE" : "EPHEMERAL",
            settings: {
                mode: session.mode,
                profileId: session.profile.id,
                cardLocale: session.cardLocale,
                cardFallbackEnabled: session.cardFallbackEnabled,
                cardFallbackLocales: [...session.cardFallbackLocales],
                neverHaveIEverRevealMode: session.neverHaveIEverRevealMode,
                cardPolicy: session.sessionCardPolicy,
                configuration: {
                    enabledQuestionCategoryIds: [...session.profile.enabledQuestionCategoryIds],
                    enabledDareTypeIds: [...session.profile.enabledDareTypeIds],
                    blockedOperationalFlags: [...session.profile.blockedOperationalFlags],
                    maximumSocialSensitivity: session.profile.maximumSocialSensitivity,
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

    private localizationPolicy(
        session: Pick<GameSession, "cardLocale" | "cardFallbackEnabled" | "cardFallbackLocales">,
    ): CardLocalizationPolicy {
        if (session.cardFallbackEnabled) {
            return {
                locale: session.cardLocale,
                missingTranslation: "FALLBACK",
                fallbackLocales: session.cardFallbackLocales,
            };
        }
        return { locale: session.cardLocale, ...this.cardTranslationPolicy };
    }
}
